// ============================================================
// LES FICHES D'UNE EXPANSION SANS PAGE DE CARTE — désignation croisée (métacarte ∧ nom + attaques ∧ tirage déjà imprimé)
// ============================================================
//   node poser-par-metacarte.js --codes=CBB3C,CBB4C,CBB5C,CBB6C                                  (mesure, 20 tirés au sort)
//   node lot-additif.js --quoi="…" --collections=sets -- node poser-par-metacarte.js --codes=… --attendu=CBB3C:92,… --ecrire
//
// 🔑 LA DEMANDE (testeur, 2026-09-26) : « Gem Pack 3 à 6 : mesure le rattachement par le nom et les attaques sous garde calibrée,
// puis écris ce qui passe. » Leurs Setlists sont des liens rouges (§43, §65), TCGdex déclare les sets sans un fichier de carte : la
// jointure par la page est impossible. Ce sont des réimpressions chinoises de cartes dont le TEXTE est chez nous.
// La désignation est `designerCroise` (collecte-cartes/cle-nom-attaques.js), la fonction même que calibrer-nom-attaques.js mesure :
//   calibrée sur 63 129 produits joints par le numéro, vraie carte présente : 31 702 justes, 0 faux de la clé — les 17 « contradic-
//   tions » ouvertes une à une sont 17 jointures par le numéro FAUSSES chez nous (Umbreon ex → Energy Sticker, Garchomp SP Half Deck
//   joint au deck de Dragons Exalted…) ; vraie carte RETIRÉE (un texte absent de chez nous) : 20 désignations d'un autre texte sur
//   9 391 produits chinois (0,21 %) — le risque qui reste, écrit dans la preuve de chaque ligne.
// Garde de plus, ici : un set ne s'écrit qu'avec son attendu (`--attendu=CODE:N`), mesuré en simulation APRÈS les tirés au sort.
// ⚠️ PAS de garde « un numéro = une carte » : le numéro Cardmarket d'un Gem Pack est un GROUPE (la Setlist écrit « 01 01/15 » …
// « 01 15/15 », et le groupe 01 de Vol. 2 réunit Eevee, Eevee V et Eevee VMAX). Écrite puis mesurée, elle refusait 59 produits
// justes de Vol. 1 et Vol. 3 : elle supposait une forme de numérotation que ces sets n'ont pas. La désignation se fait par produit.
// Ce qui s'écrit (ajout pur) : la ligne de jointure (`preuve: 'metacarte+nom+attaques'`, `numeroFiche: null` — le numéro Cardmarket
// est celui du Gem Pack, aucune carte ne le déclare, on n'en invente pas), `liens` de la carte, le set s'il manque (tirage de la
// ligne, page de la ligne, `bulba.expansion` NULL : aucune carte ne déclare ce tirage, et une expansion déclarée ferait naître d'autres
// fiches), et le slug dans `cartes.sets`. AUCUNE image : un visuel d'un autre tirage n'est pas celui-ci (§19).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
const { indexer, indexerMetacartes, designerCroise } = require('./collecte-cartes/cle-nom-attaques');
const { ligne } = require('./collecte-cartes/table-sets');

// --sans-fiche-melangee (2026-10-07, SV-P/CS) : une ligne posée a `numeroFiche: null` ; si la carte reçoit dans ce set des produits de
// DEUX numéros (Xatu n°078 et n°085), ou y porte déjà des impressions de l'expansion, le site lui montre UNE fiche sans numéro dont les
// liens ouvrent deux cartes — une fiche mélangée de plus, contre le cliquet du site (scripts/mesurer-liens-multiples.mjs : il ne peut
// que baisser). Ces produits sont écartés, nommés, et attendent leur impression par numéro (poser-impressions-par-numero.js).
const AUTORISES = [/^--codes=[\w.,/-]+$/, /^--attendu=[\w.:,/-]+$/, /^--ecrire$/, /^--export=.+\.json$/, /^--sans-fiche-melangee$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CODES = (arg('codes') || '').split(',').filter(Boolean), EXPORT = arg('export') || 'products_singles_24092026.json';
const ATTENDUS = Object.fromEntries((arg('attendu') || '').split(',').filter(Boolean).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
const ecrire = process.argv.includes('--ecrire');
const SANS_MELANGE = process.argv.includes('--sans-fiche-melangee');
if (!CODES.length) { console.error('❌ --codes=<CODE>[,…] obligatoire'); process.exit(2); }
const RISQUE = 'désignation croisée calibrée sur 63 129 produits joints par le numéro : 0 faux de la clé, vraie carte présente ; 0,21 % d\'un autre texte désigné quand le texte manque chez nous (9 391 chinois)';

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'bulba.titre': 1 } });
    const lignes = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1 } });
    const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const metaDe = new Map(catalogue.map(p => [p.idProduct, p.idMetacard ?? null]));
    const ctx = { index: indexer(cartes), parMeta: indexerMetacartes(lignes, id => metaDe.get(id)), metacarteDe: id => metaDe.get(id) };
    const dejaJoints = new Set(lignes.map(l => l.idProduct));
    const aEcrire = [], sets = [];
    for (const CODE of CODES) {
        const L = ligne(CODE);
        if (!L || !L.slugSet || !L.exp || !L.bulba?.tirage) { console.log(`\n■ ${CODE} : ligne absente ou incomplète — refusé`); continue; }
        const tousProduits = await produitsDeLExpansion(prod, L.exp);
        const produits = tousProduits.filter(p => !dejaJoints.has(p.idProduct));
        const res = produits.map(p => ({ p, d: designerCroise(ctx, p, { tirage: L.bulba.tirage }) }));
        let passent = res.filter(x => x.d.carte); const raisons = {};
        if (SANS_MELANGE) {
            // les numéros que la carte montrerait dans CE set : ses produits neufs et ceux déjà joints (numeroFiche, sinon numéro Cardmarket)
            const numDe = new Map(tousProduits.map(p => [p.idProduct, p.numero]));
            const nu = n => String(n ?? '?').replace(/^0+(?=\d)/, '');
            const parCarte = new Map(); for (const x of passent) (parCarte.get(x.d.carte._id) || parCarte.set(x.d.carte._id, []).get(x.d.carte._id)).push(x);
            const ecartes = new Set();
            for (const [id, xs] of parCarte) {
                const deja = lignes.filter(l => l.carteId === id && l.slugSet === L.slugSet).map(l => l.numeroFiche ?? numDe.get(l.idProduct));
                const numeros = new Set([...xs.map(x => x.p.numero), ...deja].map(nu));
                const imps = (xs[0].d.carte.impressions || []).filter(i => i && i.tirage === L.bulba.tirage && [].concat(L.bulba.expansion ?? []).includes(i.expansion)).length;
                if (numeros.size > 1 || imps) {
                    for (const x of xs) ecartes.add(x.p.idProduct);
                    const k = numeros.size > 1 ? `écarté (--sans-fiche-melangee) : la carte montrerait # numéros dans ce set` : 'écarté (--sans-fiche-melangee) : la carte porte déjà des impressions de l\'expansion';
                    raisons[k] = (raisons[k] || 0) + xs.length;
                    console.log(`   ⚠️ ${k.replace('#', numeros.size)} — ${id} « ${xs[0].d.carte.bulba?.titre ?? xs[0].d.carte.nomEn} » : ${xs.map(x => `n°${x.p.numero}`).join(', ')}${deja.length ? ` · déjà joints n°${deja.join(', ')}` : ''}`);
                }
            }
            passent = passent.filter(x => !ecartes.has(x.p.idProduct));
        }
        for (const x of res) if (!x.d.carte) { const k = x.d.raison.replace(/\(.*\)/, '(…)').replace(/n°\S+/, 'n°#').replace(/\d+ cartes/, '# cartes'); raisons[k] = (raisons[k] || 0) + 1; }
        console.log(`\n■ ${CODE} (exp ${L.exp}, ${L.slugSet}, tirage ${L.bulba.tirage}) · DÉNOMINATEUR : ${produits.length} produits non joints · PASSENT ${passent.length} · cartes distinctes ${new Set(passent.map(x => x.d.carte._id)).size}`);
        for (const [k, v] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)} · ${k}`);
        let g = 20260926 + L.exp; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
        console.log(`   20 TIRÉS AU SORT :`);
        for (const x of [...passent].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`      ${x.p.idProduct} n°${x.p.numero ?? '—'} « ${x.p.name} » → ${x.d.carte._id} « ${x.d.carte.bulba?.titre ?? x.d.carte.nomEn} »`);
        if (ecrire && ATTENDUS[CODE] !== passent.length) { console.error(`❌ ARRÊT : ${CODE} rend ${passent.length}, attendu ${ATTENDUS[CODE] ?? 'non donné'}`); await fermer(); process.exit(1); }
        aEcrire.push(...passent.map(x => ({ ...x, CODE, L })));
        if (passent.length) sets.push(L);
    }
    console.log(`\n   ${aEcrire.length} fiches à poser sur ${sets.length} sets${ecrire ? '' : ' — (mesure seule)'}`);
    if (!ecrire || !aEcrire.length) { await fermer(); return; }

    const le = new Date();
    const r = await cx.db.collection('cartes_produits').bulkWrite(aEcrire.map(x => ({ updateOne: { filter: { _id: `${x.d.carte._id}|${x.p.idProduct}` }, update: { $setOnInsert: {
        carteId: x.d.carte._id, idProduct: x.p.idProduct, idExpansion: x.L.exp, tirage: x.L.bulba.tirage, preuve: 'metacarte+nom+attaques', slug: x.p.slug ?? null, slugSet: x.p.slugSet ?? x.L.slugSet, numeroFiche: null,
        detail: `${x.CODE} n°${x.p.numero ?? '—'} « ${x.p.name} » → « ${x.d.carte.bulba?.titre ?? x.d.carte.nomEn} » : métacarte Cardmarket ${metaDe.get(x.p.idProduct)} (une seule carte chez nous) = nom + attaques (seule candidate, aucune voisine du nom ne partage une attaque) · carte déjà imprimée en ${x.L.bulba.tirage} · ${RISQUE}`,
        verifieLe: le, route: x.CODE } }, upsert: true } })), { ordered: false });
    const parCarte = new Map(); for (const x of aEcrire) { const v = parCarte.get(x.d.carte._id) || parCarte.set(x.d.carte._id, { ids: [], metas: new Set(), sets: new Set() }).get(x.d.carte._id); v.ids.push(x.p.idProduct); if (metaDe.get(x.p.idProduct) != null) v.metas.add(metaDe.get(x.p.idProduct)); v.sets.add(x.L.slugSet); }
    const rc = await cx.db.collection('cartes').bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] }, sets: { $each: [...v.sets] } } } } })), { ordered: false });
    let crees = 0;
    for (const L of sets) crees += (await cx.db.collection('sets').updateOne({ _id: L.slugSet }, { $setOnInsert: {
        code: L.code, idExpansion: [L.exp], nomEn: null, nomJa: null, nomJaTraduit: null, region: 'intl', tirage: L.bulba.tirage, totalImprime: null,
        reimpressions: 'metacarte', bulba: { titre: L.bulba.titre ?? null, expansion: null, motifTitres: `réimpressions sans page de carte (Setlist en liens rouges) : produits joints à leur carte par la désignation croisée (métacarte Cardmarket ∧ nom + attaques ∧ tirage déjà imprimé) — fiche sans numéro, sans visuel` },
        collecteLe: le, version: 1 } }, { upsert: true })).upsertedCount;
    const relu = await cx.db.collection('cartes_produits').countDocuments({ preuve: 'metacarte+nom+attaques', route: { $in: CODES } });
    console.log(`\n   ✅ lignes insérées ${r.upsertedCount} · cartes modifiées ${rc.modifiedCount} · sets créés ${crees} · RELU « metacarte+nom+attaques » pour ${CODES.join(',')} : ${relu} (attendu ${aEcrire.length})`);
    await fermer();
    if (relu !== aEcrire.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
