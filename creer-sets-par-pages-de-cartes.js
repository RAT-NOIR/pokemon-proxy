// ============================================================
// LES EXPANSIONS « SANS PAGE » QUE NOS CARTES DÉCLARENT DÉJÀ, SOUS UN AUTRE NOM (2026-10-07)
// ============================================================
//   node creer-sets-par-pages-de-cartes.js --calibrer                        (la clé rejouée sur les sets EXISTANTS, set caché : faux, justes)
//   node creer-sets-par-pages-de-cartes.js --liste=<sets-sans-page-refusees.json>   (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=sets,cartes,cartes_produits -- node creer-sets-par-pages-de-cartes.js --liste=… --attendu=<sets>:<lignes> --ecrire
//   puis : node rapatrier-noms-sets.js --ecrire (le site ne publie pas un set sans nomAffichage)
//
// POURQUOI : creer-sets-sans-page.js refuse 35 expansions « tirage sans preuve admise ». La preuve cherchée était dans le nom ou le code
// que CARDMARKET leur donne ; or nos propres cartes (pages Bulbapedia) déclarent déjà beaucoup de ces produits, sous le nom que BULBAPEDIA
// leur donne — « Everyone's Exciting Battle » pour Everyones-Exciting-Battle, « Beginning Set + » pour Beginning-Set-Plus, « 2023 Pokémon
// World Championships Yokohama Deck: Pikachu » pour World-Championships-2023-Yokohama-Deck-Pikachu (§30 : chercher l'orthographe d'une
// source chez une autre rend le même vide qu'une absence). L'impression de la page de carte donne à la fois le TIRAGE et le NOM d'expansion.
//
// LA CLÉ, ÉCRITE PAR CE QU'ELLE AUTORISE :
//   · le nom E (et son tirage T) se VOTE : un produit numéroté de l'expansion vote pour (T, E) quand une vraie carte (page, pas une fiche
//     simple) DE SON NOM porte une impression (T, E) à SON numéro Cardmarket ;
//   · (T, E) DÉSIGNE l'expansion si : ≥ 3 votes ; il est SEUL en tête (une égalité ne se tranche que par le nom de l'expansion Cardmarket,
//     mots égaux — « Beginning-Set-Plus » / « Beginning Set + ») ; et AUCUNE contradiction : pour TOUT produit numéroté dont le numéro est
//     porté sous (T, E) par au moins une carte de la base (fiches simples comprises), ce numéro est tenu par UNE seule carte, du nom du
//     produit — sinon (decks renumérotés sous un nom : « Pokémon Card Game Classic » n°001 est Bulbasaur, Charmander ET Squirtle) refus ;
//   · aucun set en base ne porte déjà (T, E) ;
//   · chaque produit est joint à la carte qui tient E/n (le nom en TÉMOIN : il doit être celui du produit), `numeroFiche` = le numéro tel
//     que l'impression l'écrit (le site compare par numeroComparable). Un produit sans numéro, ou dont le numéro n'est pas tenu : non joint.
// LA CALIBRATION (--calibrer) rejoue tout cela sur les sets EXISTANTS dont les produits sont déjà joints (par la Setlist, le numéro…), la
// vérité cachée : le nom choisi est-il celui du set ? les produits joints le sont-ils à la carte de la ligne existante ?
// CE QUI EST ÉCRIT : le set (bulba.expansion = E, tirage = T, sa preuve), les lignes de jointure, `sets` et `liens` sur les cartes. Aucune
// image (le worker est le seul collecteur), aucune fiche simple.
require('dotenv').config();
const fs = require('fs');
const AUTORISES = [/^--liste=.+\.json$/, /^--attendu=\d+:\d+$/, /^--ecrire$/, /^--calibrer$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --calibrer, --liste=<fichier.json>, --attendu=<sets>:<lignes>, --ecrire`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const LISTE = arg('liste'), ECRIRE = process.argv.includes('--ecrire'), CALIBRER = process.argv.includes('--calibrer');
const ATTENDU = arg('attendu')?.split(':').map(Number) ?? null;
if (!LISTE && !CALIBRER) { console.error('❌ --liste=<fichier.json> ou --calibrer requis'); process.exit(2); }
if (ECRIRE && (!ATTENDU || CALIBRER)) { console.error('❌ --ecrire exige --attendu=<sets>:<lignes> (le compte du plan, relu), et jamais --calibrer'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { decomposerNomCardmarket, estCarteCode } = require('./collecte-cartes/jointure');

const SOURCE = 'export Cardmarket + numeros_cartes (apprentissage) + impressions des pages de cartes';
const cle = n => { const s = String(n ?? '').split('/')[0].trim().toUpperCase(); return s && /\d/.test(s) ? s.replace(/^([A-Z-]*)0+(\d)/, '$1$2') : null; };
const plat = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/☆/g, 'goldstar').replace(/\+/g, 'plus').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
/** Le nom d'un produit Cardmarket, sans ses attaques entre crochets ni la variante d'illustration après « - ». */
const nomProduit = p => String(p.nom || decomposerNomCardmarket(p.name ?? '').nom || '').split(' - ')[0].trim();
const VIDES = new Set(['the', 'of', 'and', 'a', 'deck', 'decks', 'pack', 'packs', 'set', 'sets', 'box', 'promo', 'promos', 'promotional', 'card', 'cards', 'collection', 'pokemon', 'game', 'tcg', 'vs',
    // (relecture) des mots de GENRE de produit, partagés par des produits sans rapport (« X vs Y Deck Kit »)
    'kit', 'kits', 'expert', 'starter', 'trainer', 'energy', 'series', 'world', 'champion', 'championships', 'special', 'premium', 'gift', 'half', 'theme', 'battle']);
const mots = s => new Set(String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\+/g, ' plus ').replace(/'s\b/g, 's').replace(/\blv\.?x\b/g, 'lvx').split(/[^a-z0-9]+/).filter(m => m && !VIDES.has(m)));
// (relecture du 2026-10-07) un mot d'UNE lettre (« p », « t ») ne prouve rien seul : un mot commun d'au moins 3 lettres, ou les mêmes mots
const motsCommuns = (a, b) => { const A = mots(a), B = mots(b); return [...A].some(m => m.length >= 3 && B.has(m)) || (A.size > 0 && A.size === B.size && [...A].every(m => B.has(m))); };
const memesMots = (a, b) => { const m = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\+/g, ' plus ').replace(/&/g, ' and ').replace(/'s\b/g, 's').split(/[^a-z0-9]+/).filter(Boolean).sort().join(' '); return m(a) === m(b); };

/** Le cœur, pur : choisit (T, E) pour une expansion et rend ses jointures — ou un refus motivé. */
function designer({ produits, parNom, tenus, setsParNom, slugSet }) {
    const numerotes = produits.filter(p => cle(p.numero));
    // (relecture du 2026-10-07) un vote par NUMÉRO DISTINCT, pas par produit : V1/V2/V3 d'un même n°5 ne valent qu'un vote
    const votes = new Map();
    for (const p of numerotes) {
        const k = cle(p.numero);
        for (const c of parNom.get(plat(nomProduit(p))) || []) for (const i of c.impressions || []) if (i && typeof i.expansion === 'string' && i.tirage && cle(i.numero) === k) {
            const v = `${i.tirage}|${i.expansion}`; (votes.get(v) || votes.set(v, new Set()).get(v)).add(k);
        }
    }
    const distincts = new Set(numerotes.map(p => cle(p.numero))).size;
    const tri = [...votes].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]);
    // ≥ 3 numéros distincts, ET un quart des numéros de l'expansion (ou 10) : sur les autres, l'absence de contradiction ne prouve rien
    // (T-Promos : 3 numéros sur 24 — non démontré)
    if (!tri.length || tri[0][1] < 3 || (tri[0][1] * 4 < distincts && tri[0][1] < 10)) return { refus: `${tri[0]?.[1] ?? 0} numéro(s) distinct(s) au mieux sur ${distincts} (≥ 3, et ≥ 1/4 ou ≥ 10 exigés)`, tri };
    let gagnant = tri[0];
    const exAequo = tri.filter(([, v]) => v === tri[0][1]);
    if (exAequo.length > 1) {
        const parMots = exAequo.filter(([k]) => memesMots(k.split('|').slice(1).join('|'), String(slugSet ?? '').replace(/-/g, ' ')));
        if (parMots.length !== 1) return { refus: `égalité ${exAequo.map(([k, v]) => `« ${k} » ${v}`).join(' / ')} que le nom Cardmarket ne tranche pas`, tri };
        gagnant = parMots[0];
    }
    const [T, ...rest] = gagnant[0].split('|'); const E = rest.join('|');
    if (setsParNom.has(`${T}|${E}`)) return { refus: `« ${E} » (${T}) est déjà l'expansion du set ${setsParNom.get(`${T}|${E}`)}`, tri };
    // (2026-10-07) LE NOM CHOISI PARTAGE UN MOT SIGNIFICATIF AVEC CELUI DE CARDMARKET : Entry-Pack-DP votait « Movie Commemoration VS Pack:
    // Sea's Manaphy » (6 cartes réimprimées aux mêmes numéros) — un AUTRE produit ; le set porterait le nom d'un autre et ses fiches seraient
    // celles d'un autre tirage. Les réimpressions d'un produit sous un autre nom ne se nomment pas par cette clé.
    if (slugSet && !motsCommuns(E, String(slugSet).replace(/-/g, ' '))) return { refus: `« ${E} » (${T}, ${gagnant[1]} votes) ne partage aucun mot significatif avec « ${slugSet} » : le nom d'un autre produit`, tri };
    const joints = [], contradictions = [];
    for (const p of numerotes) {
        const h = tenus.get(`${T}|${E}|${cle(p.numero)}`);
        if (!h || !h.size) continue;
        const [[id, c]] = [...h];
        if (h.size === 1 && plat(c.nomEn) === plat(nomProduit(p))) joints.push({ p, carte: c, numeroFiche: c.numeroLu.get(`${T}|${E}|${cle(p.numero)}`) });
        else contradictions.push(`${p.numero} « ${nomProduit(p)} » ↔ ${[...h.values()].map(x => x.nomEn).join(' / ')}`);
    }
    if (contradictions.length) return { refus: `${contradictions.length} contradiction(s) sous « ${E} » (${T}) : ${contradictions.slice(0, 3).join(' ; ')}`, tri };
    return { T, E, votes: gagnant[1], joints, numerotes: numerotes.length, tri };
}

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const toutes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, ficheSimple: 1, sets: 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.numero': 1 } });
    const parNom = new Map(), tenus = new Map();
    for (const c of toutes) {
        c.numeroLu = new Map();
        for (const i of c.impressions || []) {
            if (!i || typeof i.expansion !== 'string' || !i.tirage || !cle(i.numero)) continue;
            const k = `${i.tirage}|${i.expansion}|${cle(i.numero)}`;
            (tenus.get(k) || tenus.set(k, new Map()).get(k)).set(c._id, c);
            if (!c.numeroLu.has(k)) c.numeroLu.set(k, String(i.numero));
        }
        if (!c.ficheSimple && c._id > 0 && c.nomEn) (parNom.get(plat(c.nomEn)) || parNom.set(plat(c.nomEn), []).get(plat(c.nomEn))).push(c);
    }
    const sets = await cx.db.collection('sets').find({}, { projection: { idExpansion: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1, 'creeDepuis.source': 1 } }).toArray();
    const setsParNom = new Map(); for (const s of sets) for (const n of [].concat(s.bulba?.expansion ?? [])) if (n) setsParNom.set(`${s.tirage ?? s.region}|${n}`, s._id);
    console.log(`DÉNOMINATEUR : ${toutes.length} cartes (${parNom.size} noms de vraies cartes) · ${tenus.size} couples (tirage, expansion, numéro) · ${sets.length} sets`);

    const produitsDe = async ids => {
        const cat = await prod.db.collection('catalogue_produits').find({ idExpansion: { $in: ids } }, { projection: { _id: 0, idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } }).toArray();
        const nc = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: cat.map(p => p.idProduct) } }, { projection: { _id: 0, idProduct: 1, numero: 1, slug: 1, slugSet: 1, codeSet: 1 } }).toArray()).map(n => [n.idProduct, n]));
        return cat.filter(p => !estCarteCode(p.name ?? '')).map(p => ({ ...p, ...decomposerNomCardmarket(p.name ?? ''), numero: nc.get(p.idProduct)?.numero ?? null, slug: nc.get(p.idProduct)?.slug ?? null, slugSet: nc.get(p.idProduct)?.slugSet ?? null, codeSet: nc.get(p.idProduct)?.codeSet ?? null }));
    };

    if (CALIBRER) {
        // la vérité : les lignes existantes (hors fiches simples et hors nos propres désignations par cette clé)
        const lignes = await lireMongo(cx.db.collection('cartes_produits'), { preuve: { $nin: ['fiche-simple', 'nom-carte+numero'] } }, { nom: 'cartes_produits', projection: { _id: 0, idProduct: 1, carteId: 1, slugSet: 1 } });
        const verite = new Map(); for (const l of lignes) (verite.get(l.idProduct) || verite.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);
        let jugees = 0, nomJuste = 0, nomFaux = 0, refusees = 0, jJustes = 0, jFaux = 0, jSansVerite = 0; const exFaux = [], exNom = [], sansVerite = {};
        for (const s of sets) {
            const propres = [].concat(s.bulba?.expansion ?? []).filter(Boolean); const ids = [].concat(s.idExpansion ?? []).filter(x => x != null);
            if (!propres.length || !ids.length) continue;
            const T0 = s.tirage ?? s.region;
            // le set CACHÉ : son nom ne compte pas comme « déjà pris »
            const sansLui = new Map([...setsParNom].filter(([k]) => !propres.some(n => k === `${T0}|${n}`)));
            const P = await produitsDe(ids);
            if (!P.some(p => verite.has(p.idProduct))) continue;
            jugees++;
            const r = designer({ produits: P, parNom, tenus, setsParNom: sansLui, slugSet: s._id });
            if (r.refus) { refusees++; continue; }
            if (r.T === T0 && propres.includes(r.E)) nomJuste++; else { nomFaux++; if (exNom.length < 20) exNom.push(`${s._id} [${T0}] « ${propres.join(' | ')} » → choisi « ${r.E} » (${r.T}) ${r.votes} votes`); }
            for (const j of r.joints) {
                const v = verite.get(j.p.idProduct);
                if (!v) { jSansVerite++; sansVerite[s._id] = [...(sansVerite[s._id] || []), `${j.p.idProduct} n°${j.p.numero} « ${j.p.name} » → ${j.carte._id}${j.carte.ficheSimple ? ' (fiche simple)' : ''}`]; continue; }
                if (v.has(j.carte._id)) jJustes++; else { jFaux++; if (exFaux.length < 12) exFaux.push(`${s._id} ${j.p.idProduct} n°${j.p.numero} « ${j.p.name} » → ${j.carte._id} « ${j.carte.nomEn} » ; vérité ${[...v].join(',')}`); }
            }
        }
        console.log(`\nCALIBRATION — sets jugés (produits déjà joints) : ${jugees} · la clé se tait (refus) ${refusees} · nom choisi : juste ${nomJuste}, AUTRE ${nomFaux}`);
        for (const e of exNom) console.log(`   nom autre : ${e}`);
        console.log(`jointures de la clé : justes ${jJustes} · FAUSSES ${jFaux} · sans vérité (produit non joint chez nous) ${jSansVerite}`);
        for (const e of exFaux) console.log(`   faux : ${e}`);
        // les produits que la clé joindrait dans un set EXISTANT et qui n'y ont aucune ligne : du travail, pas une mesure (rien n'est écrit)
        for (const [s, l] of Object.entries(sansVerite).sort((a, b) => b[1].length - a[1].length)) console.log(`   sans vérité · ${s} ${l.length} : ${l.slice(0, 3).join(' ; ')}`);
        await fermer(); return;
    }

    const liste = JSON.parse(fs.readFileSync(LISTE, 'utf8'));
    const exps = (Array.isArray(liste) ? liste : liste.sansPage ?? []).map(e => e.exp ?? e.idExpansion).filter(x => x != null);
    if (!exps.length) throw new Error('liste vide : ni tableau d\'objets { exp }, ni { sansPage: [{ idExpansion }] }');
    const lignesExistantes = new Set(await cx.db.collection('cartes_produits').distinct('idProduct'));
    // (relecture du 2026-10-07) LA REPRISE : un set que CET outil a créé (creeDepuis.source) se reprend — sinon une panne entre le set et ses
    // lignes laissait un set vide que le relancement refusait (« un set porte déjà cette expansion »). Ses lignes déjà posées comptent au plan
    // (upserts idempotents) : --attendu reste le même d'un lancement à l'autre.
    const nosLignes = new Set(await cx.db.collection('cartes_produits').distinct('idProduct', { route: /^pages-de-cartes:/ }));
    const plan = [], refus = [];
    for (const exp of exps) {
        const repris = sets.find(s => s.creeDepuis?.source === SOURCE && [].concat(s.idExpansion ?? []).includes(exp)) ?? null;
        if (!repris && sets.some(s => [].concat(s.idExpansion ?? []).includes(exp))) { refus.push(`${exp} : un set porte déjà cette expansion`); continue; }
        const P = await produitsDe([exp]);
        const compte = k => { const m = {}; for (const p of P) if (p[k]) m[p[k]] = (m[p[k]] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
        const slugs = compte('slugSet'), codes = compte('codeSet');
        if (!slugs.length) { refus.push(`${exp} : aucun slugSet appris`); continue; }
        if (slugs.length > 1 && slugs[1][1] * 4 > slugs[0][1]) { refus.push(`${exp} : slugSet ambigu (${slugs.map(([s, n]) => `${s}×${n}`).join(', ')})`); continue; }
        const slug = slugs[0][0];
        if (repris && repris._id !== slug) { refus.push(`${exp} : le set repris s'appelle ${repris._id}, le slug appris est ${slug}`); continue; }
        if (!repris && sets.some(s => s._id === slug)) { refus.push(`${exp} ${slug} : un set porte déjà ce slug`); continue; }
        const T0 = repris ? (repris.tirage ?? repris.region) : null, E0 = repris ? [].concat(repris.bulba?.expansion ?? []) : [];
        const r = designer({ produits: P, parNom, tenus, setsParNom: repris ? new Map([...setsParNom].filter(([k]) => !E0.some(n => k === `${T0}|${n}`))) : setsParNom, slugSet: slug });
        if (r.refus) { refus.push(`${exp} ${slug} : ${r.refus}`); continue; }
        if (repris && (r.T !== T0 || !E0.includes(r.E))) { refus.push(`${exp} ${slug} : repris en « ${E0.join(' | ')} » (${T0}), la clé choisit aujourd'hui « ${r.E} » (${r.T})`); continue; }
        const joints = r.joints.filter(j => !lignesExistantes.has(j.p.idProduct) || nosLignes.has(j.p.idProduct));
        plan.push({ exp, slug, repris: !!repris, code: codes[0]?.[0] ?? slug, T: r.T, E: r.E, votes: r.votes, numerotes: r.numerotes, produits: P.length, joints, deja: r.joints.length - joints.length });
    }
    const nLignes = plan.reduce((s, x) => s + x.joints.length, 0);
    console.log(`\nDÉNOMINATEUR : ${exps.length} expansions de la liste · au plan ${plan.length} · refusées ${refus.length}`);
    for (const x of plan) console.log(`   + ${String(x.exp).padEnd(5)} ${x.slug.padEnd(50)} ${x.T.padEnd(5)} « ${x.E} » · ${x.votes} votes · ${x.produits} produits, ${x.numerotes} numérotés → ${x.joints.length} jointures${x.deja ? ` (${x.deja} déjà jointes ailleurs)` : ''}`);
    for (const r of refus) console.log(`   ✗ ${r}`);
    console.log(`TOTAL : ${plan.length} sets à créer · ${nLignes} lignes de jointure`);
    let g = 20261007; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    console.log('15 JOINTURES TIRÉES AU SORT :');
    for (const j of plan.flatMap(x => x.joints.map(j => ({ ...j, x }))).sort(() => hasard() - 0.5).slice(0, 15)) console.log(`   ${j.x.slug} n°${j.p.numero} « ${j.p.name} » → ${j.carte._id} « ${j.carte.nomEn} » (${j.x.E} n°${j.numeroFiche})`);
    if (!ECRIRE) { console.log('(plan seul — --ecrire --attendu=<sets>:<lignes> sous lot-additif.js)'); await fermer(); return; }
    if (ATTENDU[0] !== plan.length || ATTENDU[1] !== nLignes) { console.error(`❌ ARRÊT : le plan rend ${plan.length}:${nLignes}, attendu ${ATTENDU.join(':')}`); await fermer(); process.exit(1); }

    const le = new Date(), CP = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes'), S = cx.db.collection('sets');
    let setsCrees = 0, lignesPosees = 0;
    for (const x of plan) {
        setsCrees += (await S.updateOne({ _id: x.slug }, { $setOnInsert: {
            code: x.code, idExpansion: [x.exp], nomEn: null, nomJa: null, nomJaTraduit: null, region: x.T === 'jp' ? 'jp' : 'intl', tirage: x.T, totalImprime: null,
            creeDepuis: { le, source: SOURCE, tirage: `pages de cartes : ${x.votes} numéros distincts au même nom et au même numéro sous « ${x.E} » (${x.T}), 0 contradiction`, demande: 'testeur 2026-10-07 : « propose toi-même la meilleure preuve de tirage pour chacun et applique-la »' },
            bulba: { titre: null, expansion: x.E, motifTitres: `aucune page de set chez nous : nom d'expansion lu sur les pages de cartes (creer-sets-par-pages-de-cartes.js)` },
            collecteLe: le, version: 1 } }, { upsert: true })).upsertedCount;
        // la CARTE d'abord, la ligne ensuite (une panne entre les deux ne laisse pas une ligne dont la carte n'a pas le slug) ; les métacartes
        // comme creer-sets-sans-page.js les pose
        const parCarte = new Map(); for (const j of x.joints) { const v = parCarte.get(j.carte._id) || parCarte.set(j.carte._id, { ids: [], metas: new Set() }).get(j.carte._id); v.ids.push(j.p.idProduct); if (j.p.idMetacard != null) v.metas.add(j.p.idMetacard); }
        if (parCarte.size) await C.bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] }, sets: x.slug } } } })), { ordered: false });
        if (x.joints.length) lignesPosees += (await CP.bulkWrite(x.joints.map(j => ({ updateOne: { filter: { _id: `${j.carte._id}|${j.p.idProduct}` }, update: { $setOnInsert: {
            carteId: j.carte._id, idProduct: j.p.idProduct, idExpansion: x.exp, tirage: x.T, preuve: 'nom-carte+numero', slug: j.p.slug ?? null, slugSet: x.slug, numeroFiche: j.numeroFiche,
            detail: `exp ${x.exp} n°${j.p.numero} « ${j.p.name} » → « ${j.carte.nomEn} » : la page de carte déclare « ${x.E} » n°${j.numeroFiche} (${x.T}), seule carte à ce numéro, du même nom ; « ${x.E} » désigne l'expansion (${x.votes} numéros distincts au même nom, 0 contradiction)`,
            verifieLe: le, route: `pages-de-cartes:${x.exp}` } }, upsert: true } })), { ordered: false })).upsertedCount;
    }
    const relu = await CP.countDocuments({ route: { $in: plan.map(x => `pages-de-cartes:${x.exp}`) } });
    const ok = setsCrees + plan.filter(x => x.repris).length === plan.length && relu === nLignes;
    console.log(`${ok ? '✅' : '🔴'} sets créés ${setsCrees}/${plan.length} (repris ${plan.filter(x => x.repris).length}) · lignes posées ${lignesPosees} · RELU ${relu} lignes « pages-de-cartes » (attendu ${nLignes})`);
    console.log(`SETS : ${plan.map(x => x.slug).join(',')}`);
    await fermer();
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
