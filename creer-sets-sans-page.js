// ============================================================
// CRÉER LES SETS DES EXPANSIONS SANS PAGE — depuis l'export Cardmarket et nos apprentissages (ordre du testeur, 2026-10-04 : « les 75 sets
// à créer et les 4 chinois n'attendent pas : crée-les à partir de l'export Cardmarket et de nos apprentissages (nom, numéro, expansion),
// avec des fiches simples et des visuels TCGdex quand ils existent. On enrichit ensuite. »)
// ============================================================
//   node creer-sets-sans-page.js --liste=<LISTE-EXPANSIONS-SANS-PAGE.json du site>                 (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=sets,cartes,cartes_produits -- node creer-sets-sans-page.js --liste=… --attendu=<sets>:<lignes> --ecrire
//   puis : node rapatrier-noms-sets.js --ecrire (le site ne publie pas un set sans nomAffichage) et la revalidation des sets créés
// ⚠️ RELECTURE (sous-agent, 2026-10-04), corrigée avant toute écriture : pas de fiche simple dans un set EXISTANT (il a une ligne de table :
// une vraie page arrivée plus tard ferait doublon, et `collecteur-texte.js --reparser` levait sur une carte sans page) ; les cartes
// s'écrivent AVANT les lignes de jointure (une panne entre les deux laissait des lignes « déjà jointes » sans le slug sur la carte) ; une
// fiche simple déjà en base se retrouve par (set, nom, numéro) au lieu de recalculer son `_id` ; ses impressions portent `illustrateur:
// null` et sa raison ; la désignation ne voit jamais une fiche simple.
// POUR CHAQUE EXPANSION que la table TIRAGES nomme (UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : une expansion absente de la table ne
// reçoit rien, et le plan la liste avec ce qu'on sait d'elle) :
//   · LE SET : `_id` = le slugSet Cardmarket majoritaire appris (numeros_cartes) ; `idExpansion`, `code` (le codeSet appris), `region`
//     (jp, sinon intl — la règle du site), `tirage` (celui de la table, avec sa PREUVE écrite), `bulba.expansion` = le nom lisible du slug
//     (lisible(), la règle des noms d'affichage) — seulement si AUCUNE carte en base ne déclare déjà ce couple (tirage, nom) : sinon des
//     fiches étrangères naîtraient dans le set, et le set est refusé. Un set qui existe déjà (les 4 chinois « à collecter ») garde tout.
//   · LES RÉIMPRESSIONS : la désignation croisée de collecte-cartes/cle-nom-attaques.js (métacarte ∧ nom + attaques ∧ carte déjà imprimée
//     dans le tirage — calibrée 31 702 justes, 0 faux de la clé ; 0,21 % d'un autre texte quand le texte manque chez nous), écrite comme
//     poser-par-metacarte.js l'écrit (`preuve: 'metacarte+nom+attaques'`, `numeroFiche: null` : aucune page ne déclare ce numéro).
//   · LES FICHES SIMPLES : les produits que la désignation ne rattache pas reçoivent une carte « simple », une par (nom, numéro) — le
//     nom anglais Cardmarket (sans les attaques entre crochets), les attaques lues dans ces crochets, une impression (tirage du set, nom
//     d'expansion du set, numéro appris) marquée `source: 'cardmarket'`. `_id` NÉGATIF (− le plus petit idProduct du groupe) : il ne
//     peut pas rencontrer un pageid Bulbapedia. `ficheSimple` dit d'où vient chaque champ. À ENRICHIR : le jour où la page de la carte
//     existe chez nous, la fiche simple se remplace (ses lignes se repointent) — rien ne la fait passer pour une page.
//   · AUCUNE IMAGE ici (le worker est le seul collecteur) : les visuels TCGdex demandent une ligne de table et une unité de file.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--liste=.+\.json$/, /^--attendu=\d+:\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --liste=<fichier.json>, --attendu=<sets>:<lignes>, --ecrire`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const LISTE = arg('liste'), ECRIRE = process.argv.includes('--ecrire');
const ATTENDU = arg('attendu')?.split(':').map(Number) ?? null;
if (!LISTE) { console.error('❌ --liste=<LISTE-EXPANSIONS-SANS-PAGE.json> requis'); process.exit(2); }
if (ECRIRE && !ATTENDU) { console.error('❌ --ecrire exige --attendu=<sets>:<lignes> (le compte du plan, relu)'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { produitsDeLExpansion, decomposerNomCardmarket, estCarteCode, clesNom, nomJointDe } = require('./collecte-cartes/jointure');
const { indexer, indexerMetacartes, designerCroise } = require('./collecte-cartes/cle-nom-attaques');
const { lisible } = require('./collecte-cartes/nom-affichage');

// LE TIRAGE DE CHAQUE EXPANSION, AVEC SA PREUVE (2026-10-04). Les preuves admises, et elles seules :
//   codes_set — la région que codes_set écrit (japonais / occidental), quand rien ne la contredit ;
//   famille   — les sets EN BASE dont le code est de la même famille ont tous ce tirage ;
//   nom       — le nom Cardmarket de l'expansion dit la langue ;
//   CS…C      — le suffixe « C » des codes chinois de Cardmarket (§39), sur un code « CS…C » ;
//   asymétrie — des produits désignés sont des cartes imprimées au Japon et JAMAIS dans le tirage occidental ;
//   set       — le set existe déjà en base avec ce tirage.
// Ce qui n'a aucune de ces preuves n'est PAS ici : A-VALIDER.md le propose au testeur.
const TIRAGES = {
    6168: ['zh-hans', 'set : Adventure-Special-Pack existe (zh-hans)'], 6111: ['zh-hans', 'set : Gem-Pack-Vol-2 existe (zh-hans)'],
    6361: ['zh-hans', 'set : Travel-Special-Pack existe (zh-hans)'], 6579: ['zh-hans', 'set : Land-of-Kitakami-Special-Pack existe (zh-hans)'],
    3600: ['jp', 'codes_set : japonais (sA)'], 5723: ['jp', 'codes_set : japonais (pcgG)'], 3595: ['jp', 'codes_set : japonais (sC)'],
    4246: ['jp', 'codes_set : japonais (smL)'], 5718: ['jp', 'codes_set : japonais (pcgL)'], 4250: ['jp', 'codes_set : japonais (smI)'],
    4515: ['jp', 'codes_set : japonais (sKV)'], 5219: ['jp', 'codes_set : japonais (svAL)'], 5299: ['jp', 'codes_set : japonais (svC)'],
    6017: ['jp', 'codes_set : japonais (svOD)'], 6016: ['jp', 'codes_set : japonais (svOM)'], 5865: ['jp', 'codes_set : japonais (advI)'],
    5866: ['jp', 'codes_set : japonais (advH)'], 4381: ['jp', 'codes_set : japonais (sp5) ; famille sp1, sp2, sp4, sp6 : jp'], 4217: ['jp', 'codes_set : japonais (CS1)'],
    4347: ['intl', 'codes_set : occidental (CEL)'], 2361: ['intl', 'codes_set : occidental (MCD18F) ; TCGdex « Collection McDonald\'s 2018 » (data/, cardmarket 2361)'], 1623: ['intl', 'codes_set : occidental (MCD11)'],
    6596: ['idth', 'famille : MA1, MA4, MA6 sont idth (MA5)'], 6417: ['idth', 'famille : MA1, MA4, MA6 sont idth (MA2)'],
    2070: ['intl', 'famille : TK5, TK6, TK7, TK8 sont intl (TK11)'], 1627: ['intl', 'famille : TK5, TK6, TK7, TK8 sont intl (TK2)'], 1628: ['intl', 'famille : TK5, TK6, TK7, TK8 sont intl (TK3)'],
    5877: ['jp', 'famille : ADV2, ADV3, ADV4 sont jp (ADV1)'], 3738: ['intl', 'famille : MCD14, MCD16, MCD17, MCD22 sont intl (MCD25)'], 2404: ['intl', 'famille : MCD14, MCD16, MCD17, MCD22 sont intl (MCD18)'],
    6774: ['zh-hans', 'nom : « 30th Celebration Simplified Chinese Premium Deck Set »'], 6514: ['zh-hans', 'nom : « 30th Anniversary Celebration Simplified Chinese » (codes_set dit japonais : le nom le contredit, §28)'],
    6683: ['zh-hans', 'nom : « M-P Simplified Chinese Promos »'], 5960: ['zh-hant', 'nom : « Traditional Chinese Products »'],
    6405: ['zh-hans', 'CS…C : CSCC'], 6404: ['zh-hans', 'CS…C : CSBC'],
    4339: ['jp', 'asymétrie : désignés en jp 1, en intl 0'], 4340: ['jp', 'asymétrie : désignés en jp 1, en intl 0'], 6638: ['jp', 'asymétrie : désignés en jp 1, en intl 0'],
    6637: ['jp', 'asymétrie : désignés en jp 1, en intl 0'], 6639: ['jp', 'asymétrie : désignés en jp 3, en intl 0'], 4343: ['jp', 'asymétrie : désignés en jp 8, en intl 0'],
    5060: ['jp', 'asymétrie : désignés en jp 2, en intl 0'],
    // (2026-10-07, testeur : « les sets sans page : propose toi-même la meilleure preuve de tirage pour chacun et applique-la ») — lues sur
    // nos données, zéro requête : l'asymétrie CHINOISE (les cartes désignées sont imprimées en zh-hans, jamais en zh-hant) et la famille
    // 🔴 6700 (AS4 Sky Ruler) disait ici « zh-hans, asymétrie » — FAUX : l'asymétrie ne peut voir que les tirages déjà en base, et aucune
    // carte SM n'y est imprimée en indonésien ou en thaï (corrigé le 2026-10-07, feu vert du testeur : corriger-tirage-sans-page.js).
    // La série AS est indonésienne et thaïe (2026-10-07, zéro requête) : TCGdex data-asia/SM/AS1a…AS4b (noms `id`, et `th` pour AS1 ;
    // dates `id` 2019-08-09, `th` 2019-02-01 pour AS1) ; page « Sky Ruler (ATCG) » (copie Wayback) : « exclusively available in
    // Indonesian and Thai » ; le slug Cardmarket de 6703 dit « ID-TH ». Aucun fichier de carte chez TCGdex pour ces quatre sets.
    6700: ['idth', 'TCGdex data-asia AS4a/AS4b « Booster Pack Penguasa Langit » (id) ; page « Sky Ruler (ATCG) » : « exclusively available in Indonesian and Thai » (AS4)'],
    6701: ['idth', 'TCGdex data-asia AS3a/AS3b « Booster Pack Bayangan Tersembunyi » (id) ; famille AS1, AS2, AS4 : idth (AS3)'],
    6702: ['idth', 'TCGdex data-asia AS1a/AS1b « Matahari & Bulan: Hantaman Pertama » (id) et « ซันแอนด์มูน เฟิร์สอิมแพค » (th) (AS1)'],
    6703: ['idth', 'nom : « Legends Awakened ID-TH » (slug Cardmarket) ; TCGdex data-asia AS2a/AS2b « Booster Pack Kebangkitan Legenda » (id) (AS2)'],
    6635: ['zh-hans', 'famille : CSVM1C est zh-hans (CSVM2) ; asymétrie : 30 désignés, 25 en zh-hans seul, 1 en zh-hant seul'],
    3354: ['intl', 'famille : MCD14, MCD16, MCD17, MCD22 sont intl (MCD19F)'],
    // (2026-10-07, testeur : « crée leurs sets par la voie normale (preuve de tirage, date, logo composé si besoin) ») — lues sur nos données
    // et le clone TCGdex, zéro requête :
    5526: ['intl', 'pages de cartes : Potion et Switch déclarent « My First Battle » en intl (decks Pikachu, Bulbasaur, Charmander, Squirtle)'],
    6600: ['id', 'TCGdex : le set indonésien SV3s « Kilau Hitam » porte le code Cardmarket SV3s (et « kilau hitam » = « black sparkle ») ; aucun set thaï de ce code'],
    6767: ['intl', 'famille : 30C est intl (30th-Celebration) (x30C, ses Additionals)']
};
// LES CARTES DÉCLARANTES (2026-10-07, testeur : « My First Battle : feu vert, rattache les 8 produits à Potion et Switch, sous la garde ») :
// pour ces expansions, des cartes de la base déclarent DÉJÀ le nom d'expansion — la garde « des cartes en base déclarent déjà … » refuserait
// le set, parce que leurs fiches naîtraient dans le set À CÔTÉ de fiches simples des mêmes produits (des doublons). Ici, au lieu de refuser :
// chaque produit dont le nom est celui d'UNE carte déclarante est joint à cette carte (preuve `carte-declarante`), et le set est REFUSÉ si
// une carte déclarante n'est couverte par AUCUN produit (sa fiche naîtrait seule, sans produit) ou si un nom désigne deux déclarantes.
const DECLARANTES = { 5526: 'My First Battle' };
const RISQUE = 'désignation croisée calibrée sur 63 129 produits joints par le numéro : 0 faux de la clé, vraie carte présente ; 0,21 % d\'un autre texte désigné quand le texte manque chez nous (9 391 chinois)';
const nuNom = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const nuNum = n => { const s = String(n ?? '').trim(); return s ? s.replace(/^0+(?=\d)/, '').toUpperCase() : null; };

(async () => {
    const liste = JSON.parse(fs.readFileSync(LISTE, 'utf8')).sansPage;
    if (!Array.isArray(liste) || !liste.length) throw new Error('liste vide ou sans « sansPage »');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const toutes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'bulba.titre': 1, sets: 1, ficheSimple: 1, 'impressions.numero': 1 } });
    // la désignation ne voit que des CARTES (des pages) : une fiche simple n'est pas un texte de jeu
    const cartes = toutes.filter(c => !c.ficheSimple);
    // les fiches simples déjà en base, par (set, nom, numéro) : une reprise les retrouve au lieu d'en fabriquer une seconde
    const simplesExistantes = new Map(); for (const c of toutes.filter(c => c.ficheSimple)) for (const s of c.sets || []) simplesExistantes.set(`${s}|${String(c.nomEn ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()}|${String(c.impressions?.[0]?.numero ?? '').trim().replace(/^0+(?=\d)/, '').toUpperCase() || `p${-c._id}`}`, c._id);
    const lignes = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1 } });
    const dejaJoints = new Set(lignes.map(l => l.idProduct));
    const metaDe = new Map((await lireMongo(prod.db.collection('catalogue_produits'), {}, { nom: 'catalogue_produits', projection: { idProduct: 1, idMetacard: 1 } })).map(p => [p.idProduct, p.idMetacard ?? null]));
    const ctx = { index: indexer(cartes), parMeta: indexerMetacartes(lignes, id => metaDe.get(id)), metacarteDe: id => metaDe.get(id) };
    const setsBase = new Map((await cx.db.collection('sets').find({}, { projection: { idExpansion: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const declare = new Set(); for (const c of cartes) for (const i of c.impressions || []) if (i?.tirage && i.expansion) declare.add(`${i.tirage}|${i.expansion}`);
    // un AUTRE set qui porte déjà ce nom d'expansion dans ce tirage (relecture : le contrôle ne regardait que les cartes)
    for (const s of setsBase.values()) for (const n of [].concat(s.bulba?.expansion ?? [])) if (n) declare.add(`${s.tirage ?? s.region}|${n}`);
    const idsPris = new Set(toutes.map(c => c._id));
    const plan = [], refus = [];
    const log = console.log;
    for (const e of liste) {
        const exp = e.idExpansion, T = TIRAGES[exp];
        console.log = () => { }; const P = await produitsDeLExpansion(prod, exp); console.log = log;
        const appris = await prod.db.collection('numeros_cartes').find({ idExpansion: exp }, { projection: { idProduct: 1, slugSet: 1, codeSet: 1, numero: 1, slug: 1 } }).toArray();
        const compte = (xs, k) => { const m = {}; for (const x of xs) if (x[k]) m[x[k]] = (m[x[k]] ?? 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
        const slugs = compte([...P, ...appris], 'slugSet'), codes = compte(appris, 'codeSet');
        const resume = `exp ${exp} · ${P.length} produits au catalogue, ${appris.length} appris · slug ${slugs[0]?.[0] ?? '—'} · code ${codes[0]?.[0] ?? '—'}`;
        if (!T) { refus.push({ exp, raison: 'tirage sans preuve admise : proposé dans A-VALIDER.md', resume, slug: slugs[0]?.[0] ?? null, code: codes[0]?.[0] ?? null, produits: P.length }); continue; }
        if (!slugs.length) { refus.push({ exp, raison: 'aucun slugSet appris : ni nom ni produit (apparue après l\'export du 24/09)', resume }); continue; }
        if (slugs.length > 1 && slugs[1][1] * 4 > slugs[0][1]) { refus.push({ exp, raison: `slugSet ambigu (${slugs.map(([s, n]) => `${s}×${n}`).join(', ')})`, resume }); continue; }
        const slug = slugs[0][0], [tirage, preuveTirage] = T;
        const existant = setsBase.get(slug);
        if (existant && !(Array.isArray(existant.idExpansion) ? existant.idExpansion : [existant.idExpansion]).includes(exp)) { refus.push({ exp, raison: `un set « ${slug} » existe déjà pour une AUTRE expansion (${JSON.stringify(existant.idExpansion)})`, resume }); continue; }
        if (existant && (existant.tirage ?? existant.region) !== tirage) { refus.push({ exp, raison: `le set existant est en ${existant.tirage ?? existant.region}, la table dit ${tirage}`, resume }); continue; }
        const nomDecl = DECLARANTES[exp] ?? null;
        const nomExp = existant ? (Array.isArray(existant.bulba?.expansion) ? existant.bulba.expansion[0] : existant.bulba?.expansion) ?? null : (nomDecl ?? lisible(slug));
        const aJoindre = P.filter(p => !dejaJoints.has(p.idProduct) && !estCarteCode(p.name ?? ''));
        const designes = [], simples = new Map();
        let sansFiche = 0;
        // les cartes déclarantes (DECLARANTES) : celles dont une impression porte (tirage, nom d'expansion déclaré)
        const declarantes = nomDecl ? cartes.filter(c => (c.impressions || []).some(i => i?.tirage === tirage && i.expansion === nomDecl)) : [];
        let ambiguDecl = null;
        for (const p of aJoindre) {
            if (nomDecl) {
                const nomP = (p.nom || decomposerNomCardmarket(p.name ?? '').nom || '').trim();
                const dd = declarantes.filter(c => clesNom(nomJointDe(c)).some(k => clesNom(nomP).includes(k)));
                if (dd.length > 1) { ambiguDecl = `« ${nomP} » désigne ${dd.length} cartes déclarantes`; break; }
                if (dd.length === 1) { designes.push({ p, carte: dd[0], declarante: true }); continue; }
            }
            const d = designerCroise(ctx, p, { tirage });
            if (d.carte) { designes.push({ p, carte: d.carte }); continue; }
            // un set EXISTANT a une ligne de table : sa collecte joindra ses vraies pages ; une fiche simple y ferait doublon
            if (existant) { sansFiche++; continue; }
            const nom = (p.nom || decomposerNomCardmarket(p.name ?? '').nom || '').trim();
            if (!nom) continue;
            const k = `${nuNom(nom)}|${nuNum(p.numero) ?? `p${p.idProduct}`}`;
            const g = simples.get(k) || simples.set(k, { nom, numero: p.numero ?? null, attaques: p.attaques || [], produits: [] }).get(k);
            g.produits.push(p);
        }
        // (2026-10-07) UNE RÉIMPRESSION DÉSIGNÉE A `numeroFiche: null` : si une même carte reçoit dans CE set des produits de DEUX numéros
        // (Sky Ruler : Zygarde GX b098 et b206), le site lui montre une fiche sans numéro dont les liens ouvrent deux cartes — une fiche
        // mélangée de plus, contre le cliquet du site (rat-market-site scripts/mesurer-liens-multiples.mjs : il ne peut que baisser). Ces
        // produits ne sont pas désignés : ils deviennent des fiches simples, une par (nom, numéro), comme ce que la désignation ne rattache pas.
        if (!existant) {
            const parCarte = new Map(); for (const d of designes) (parCarte.get(d.carte._id) || parCarte.set(d.carte._id, []).get(d.carte._id)).push(d);
            for (const [, ds] of parCarte) {
                // une carte DÉCLARANTE reçoit tous ses produits (My First Battle : la même Potion dans quatre decks, sans numéro)
                if (ds.some(d => d.declarante)) continue;
                if (new Set(ds.map(d => nuNum(d.p.numero) ?? `p${d.p.idProduct}`)).size < 2) continue;
                for (const d of ds) {
                    // (relecture) un produit sans nom lisible ne peut pas devenir une fiche simple : il reste désigné, jamais perdu en silence
                    const nom = (d.p.nom || decomposerNomCardmarket(d.p.name ?? '').nom || '').trim(); if (!nom) continue;
                    designes.splice(designes.indexOf(d), 1);
                    const k = `${nuNom(nom)}|${nuNum(d.p.numero) ?? `p${d.p.idProduct}`}`;
                    (simples.get(k) || simples.set(k, { nom, numero: d.p.numero ?? null, attaques: d.p.attaques || [], produits: [], horsDesignation: 'la carte désignée aurait reçu plusieurs numéros dans ce set' }).get(k)).produits.push(d.p);
                }
            }
        }
        // une fiche simple porte une impression (tirage, nom d'expansion) : refusée si une carte en base déclare déjà ce couple — elle
        // ferait naître ses fiches dans le set (sauf un set existant, dont le nom d'expansion est déjà le sien)
        if (nomDecl) {
            if (ambiguDecl) { refus.push({ exp, raison: `cartes déclarantes : ${ambiguDecl}`, resume }); continue; }
            if (!declarantes.length) { refus.push({ exp, raison: `aucune carte ne déclare « ${nomDecl} » en ${tirage}`, resume }); continue; }
            const couvertes = new Set(designes.filter(d => d.declarante).map(d => d.carte._id));
            const seules = declarantes.filter(c => !couvertes.has(c._id));
            if (seules.length) { refus.push({ exp, raison: `carte(s) déclarante(s) sans produit : ${seules.map(c => `${c._id} « ${c.nomEn} »`).join(', ')}`, resume }); continue; }
            const autreSet = [...setsBase.values()].find(s => (s.tirage ?? s.region) === tirage && [].concat(s.bulba?.expansion ?? []).includes(nomDecl));
            if (autreSet) { refus.push({ exp, raison: `« ${nomDecl} » est déjà l'expansion du set ${autreSet._id}`, resume }); continue; }
        }
        // le nom déclaré, dont TOUTES les cartes déclarantes reçoivent leurs produits ici, n'est pas un conflit : c'est le but
        const conflit = !existant && nomExp && declare.has(`${tirage}|${nomExp}`) && nomExp !== nomDecl;
        if (conflit) { refus.push({ exp, raison: `des cartes en base déclarent déjà « ${nomExp} » en ${tirage} : un bulba.expansion ferait naître leurs fiches ici`, resume }); continue; }
        if (!nomExp && simples.size) { refus.push({ exp, raison: 'set existant sans bulba.expansion : une fiche simple n\'aurait pas d\'impression lisible', resume }); continue; }
        for (const [k, g] of simples) {
            const ex = simplesExistantes.get(`${slug}|${k}`);
            if (ex != null) { g.id = ex; g.existante = true; continue; }   // reprise : la fiche simple est déjà là, ses produits s'y ajoutent
            g.id = -Math.min(...g.produits.map(p => p.idProduct));
            if (idsPris.has(g.id)) throw new Error(`fiche simple ${g.id} : identifiant déjà pris par une autre carte`);
        }
        plan.push({ exp, slug, existant: !!existant, tirage, preuveTirage, region: tirage === 'jp' ? 'jp' : 'intl', code: codes[0]?.[0] ?? null, nomExp, produits: P.length, deja: P.filter(p => dejaJoints.has(p.idProduct)).length, designes, simples: [...simples.values()], sansFiche });
    }
    const nLignes = plan.reduce((s, x) => s + x.designes.length + x.simples.reduce((t, g) => t + g.produits.length, 0), 0);
    console.log(`DÉNOMINATEUR : ${liste.length} expansions dans la liste du site · dans la table TIRAGES ${liste.filter(e => TIRAGES[e.idExpansion]).length} · au plan ${plan.length} (dont ${plan.filter(x => x.existant).length} sets existants) · refusées ${refus.length}`);
    for (const x of plan) console.log(`   ${x.existant ? '·' : '+'} ${String(x.exp).padEnd(5)} ${x.slug.padEnd(52)} ${x.tirage.padEnd(7)} code ${String(x.code).padEnd(7)} · ${x.produits} produits (déjà joints ${x.deja}) → réimpressions désignées ${x.designes.length} · fiches simples ${x.simples.length} (${x.simples.reduce((t, g) => t + g.produits.length, 0)} produits${x.simples.some(g => g.existante) ? `, dont ${x.simples.filter(g => g.existante).length} déjà en base` : ''})${x.sansFiche ? ` · ${x.sansFiche} laissés à la collecte du set (set existant : pas de fiche simple)` : ''} · « ${x.nomExp} » · ${x.preuveTirage}`);
    console.log(`REFUSÉES (${refus.length}) :`); for (const r of refus) console.log(`   ✗ ${r.resume} — ${r.raison}`);
    console.log(`TOTAL : ${plan.filter(x => !x.existant).length} sets à créer · ${nLignes} lignes de jointure (${plan.reduce((s, x) => s + x.designes.length, 0)} réimpressions désignées, ${nLignes - plan.reduce((s, x) => s + x.designes.length, 0)} produits en ${plan.reduce((s, x) => s + x.simples.length, 0)} fiches simples)`);
    // 20 réimpressions tirées au sort, pour les regarder
    let g = 20261004; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    const tous = plan.flatMap(x => x.designes.map(d => ({ ...d, x })));
    console.log('20 RÉIMPRESSIONS TIRÉES AU SORT :'); for (const d of [...tous].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${d.x.slug} n°${d.p.numero ?? '—'} « ${d.p.name} » → ${d.carte._id} « ${d.carte.bulba?.titre ?? d.carte.nomEn} »`);
    fs.writeFileSync(path.join(__dirname, 'sets-sans-page-refusees.json'), JSON.stringify(refus, null, 1));
    if (!ECRIRE) { console.log('(plan seul — --ecrire --attendu=<sets à créer>:<lignes> sous lot-additif.js)'); await fermer(); return; }
    if (ATTENDU[0] !== plan.filter(x => !x.existant).length || ATTENDU[1] !== nLignes) { console.error(`❌ ARRÊT : le plan rend ${plan.filter(x => !x.existant).length}:${nLignes}, attendu ${ATTENDU.join(':')}`); await fermer(); process.exit(1); }

    const le = new Date(), CP = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes'), S = cx.db.collection('sets');
    let setsCrees = 0, lignesPosees = 0, simplesCreees = 0;
    for (const x of plan) {
        if (!x.existant) setsCrees += (await S.updateOne({ _id: x.slug }, { $setOnInsert: {
            code: x.code ?? x.slug, idExpansion: [x.exp], nomEn: null, nomJa: null, nomJaTraduit: null, region: x.region, tirage: x.tirage, totalImprime: null,
            creeDepuis: { le, source: 'export Cardmarket du 24/09 + numeros_cartes (apprentissage)', tirage: x.preuveTirage, demande: 'testeur 2026-10-04 : « crée-les à partir de l\'export Cardmarket et de nos apprentissages »' },
            bulba: { titre: null, expansion: x.simples.length ? x.nomExp : null, motifTitres: `aucune page de set chez nous : réimpressions jointes par la désignation croisée, autres produits en fiches simples (nom et numéro Cardmarket) — à enrichir` },
            collecteLe: le, version: 1 } }, { upsert: true })).upsertedCount;
        // les réimpressions, comme poser-par-metacarte.js — la CARTE d'abord (idempotent), la ligne ensuite : une panne entre les deux ne
        // laisse plus une ligne « déjà jointe » dont la carte n'aurait jamais reçu le slug (relecture du 2026-10-04)
        if (x.designes.length) {
            const parCarte = new Map(); for (const d of x.designes) { const v = parCarte.get(d.carte._id) || parCarte.set(d.carte._id, { ids: [], metas: new Set() }).get(d.carte._id); v.ids.push(d.p.idProduct); if (metaDe.get(d.p.idProduct) != null) v.metas.add(metaDe.get(d.p.idProduct)); }
            await C.bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] }, sets: x.slug } } } })), { ordered: false });
            const r = await CP.bulkWrite(x.designes.map(d => ({ updateOne: { filter: { _id: `${d.carte._id}|${d.p.idProduct}` }, update: { $setOnInsert: {
                // (2026-10-07) dans un set NEUF, le numéro Cardmarket du produit — le numéro de CE set, celui que la règle anti-mélange
                // ci-dessus compare : sans lui, le site lit le slug, et un « Caterpie-V2 » sans numéro y comptait pour une autre carte que
                // « Caterpie-V1-MCD19F2 » (14 fiches mélangées sur McDonald's 2019-2). Un set existant garde la règle d'avant (null).
                carteId: d.carte._id, idProduct: d.p.idProduct, idExpansion: x.exp, tirage: x.tirage, preuve: d.declarante ? 'carte-declarante' : 'metacarte+nom+attaques', slug: d.p.slug ?? null, slugSet: x.slug, numeroFiche: x.existant ? null : (d.p.numero ?? null),
                detail: d.declarante
                    ? `exp ${x.exp} « ${d.p.name} » → « ${d.carte.bulba?.titre ?? d.carte.nomEn} » : la SEULE carte de la base qui déclare « ${x.nomExp} » (${x.tirage}) sous ce nom — décision du testeur du 2026-10-07`
                    : `exp ${x.exp} n°${d.p.numero ?? '—'} « ${d.p.name} » → « ${d.carte.bulba?.titre ?? d.carte.nomEn} » : métacarte Cardmarket ${metaDe.get(d.p.idProduct)} (une seule carte chez nous) = nom + attaques · carte déjà imprimée en ${x.tirage} · ${RISQUE}`,
                verifieLe: le, route: `sans-page:${x.exp}` } }, upsert: true } })), { ordered: false });
            lignesPosees += r.upsertedCount;
        }
        // les fiches simples — la carte d'abord ; une fiche déjà en base (reprise) reçoit seulement ses produits nouveaux
        for (const g of x.simples) {
            const ids = g.produits.map(p => p.idProduct), metas = [...new Set(g.produits.map(p => metaDe.get(p.idProduct)).filter(m => m != null))];
            const u = g.existante
                ? await C.updateOne({ _id: g.id, ficheSimple: { $exists: true } }, { $addToSet: { 'liens.idProduct': { $each: ids }, 'liens.idMetacards': { $each: metas }, sets: x.slug } })
                : await C.updateOne({ _id: g.id }, { $setOnInsert: {
                    nomEn: g.nom, sets: [x.slug], attaques: g.attaques.map(nom => ({ nom })),
                    // l'illustrateur : null AVEC sa raison (la forme de construire-illustrateurs.js) — absent, il serait compté « jamais regardé »
                    impressions: [{ tirage: x.tirage, expansion: x.nomExp, numero: g.numero ?? null, source: 'cardmarket', illustrateur: null, illustrateurPreuve: 'fiche simple : aucune page de carte chez nous, Cardmarket ne nomme pas l\'illustrateur' }],
                    liens: { idProduct: ids, idMetacards: metas },
                    ficheSimple: { le, source: 'export Cardmarket du 24/09 (nom, attaques) + numeros_cartes (numéro)', motif: 'aucune page de carte chez nous pour ce produit — fiche simple, à enrichir (la page réelle la remplacera ; ses lignes cartes_produits seront repointées)' }
                } }, { upsert: true });
            simplesCreees += u.upsertedCount ?? 0;
            const r = await CP.bulkWrite(g.produits.map(p => ({ updateOne: { filter: { _id: `${g.id}|${p.idProduct}` }, update: { $setOnInsert: {
                carteId: g.id, idProduct: p.idProduct, idExpansion: x.exp, tirage: x.tirage, preuve: 'fiche-simple', slug: p.slug ?? null, slugSet: x.slug, numeroFiche: g.numero ?? null,
                detail: `fiche simple : « ${p.name} » n°${p.numero ?? '—'} — nom et numéro Cardmarket, aucune page de carte chez nous`, verifieLe: le, route: `sans-page:${x.exp}` } }, upsert: true } })), { ordered: false });
            lignesPosees += r.upsertedCount;
        }
    }
    const reluLignes = await CP.countDocuments({ route: { $in: plan.map(x => `sans-page:${x.exp}`) } });
    const reluSets = await S.countDocuments({ _id: { $in: plan.map(x => x.slug) } });
    console.log(`${setsCrees === ATTENDU[0] && reluLignes === nLignes ? '✅' : '🔴'} sets créés ${setsCrees} · lignes posées ${lignesPosees} · fiches simples créées ${simplesCreees} · RELU : ${reluLignes} lignes « sans-page » (attendu ${nLignes}) · ${reluSets} sets présents sur ${plan.length}`);
    console.log(`SETS : ${plan.map(x => x.slug).join(',')}`);
    if (setsCrees !== ATTENDU[0] || reluLignes !== nLignes) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
