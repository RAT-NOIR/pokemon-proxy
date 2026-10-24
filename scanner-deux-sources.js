// ============================================================
// PHASE 3a — la RÈGLE DES DEUX SOURCES, appliquée aux produits SANS LIGNE (mesure seule : copies locales + clone TCGdex local, 0 requête)
// ============================================================
//   node scanner-deux-sources.js --cache=<dossier> --diag=<diag-produits.json> --clone=<clone tcgdex> --sortie=<fichier.json> [--api=<releves-api.json>]
// Pour chaque produit : Cardmarket (export + numeros_cartes) = UNE source ; les autres sont lues dans les relevés indépendants de Cardmarket ET de Bulbapedia :
//   · `images` (hors source « bulbapedia ») : artofpkm, pikaqian, tpc-asie, pokumon, pokemontcg.io, tcgdex… — set (notre slug), numéro, nom ;
//   · `tpc_fiches` : TPC Asie / pokemon-card.com — le dénominateur imprimé (« M-P ») désigne la liste de la ligne TPC du set (tpc-sets.js) ; numéro, nom ;
//   · le clone TCGdex : le set TCGdex est relié à l'expansion Cardmarket (`thirdParty.cardmarket`), l'idProduct ou le numéro local désigne la carte ;
//   · `--api` : des relevés lus à l'API TCGdex (≤ 50 requêtes, 5 s d'intervalle), fichier produit par releve-tcgdex-api.js.
// Le jugement est celui de collecte-cartes/deux-sources.js (pur, liste fermée de sources admises, Bulbapedia refusée par son nom).
const fs = require('fs');
const path = require('path');
const { juger } = require('./collecte-cartes/deux-sources');
const { cleNumero, decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const { TABLE_TPC } = require('./collecte-cartes/tpc-sets');
const { lireClone } = require('./poser-cartes-tcgdex');
const { champSur } = require('./collecte-cartes/lecture-sure');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CACHE = arg('cache'), DIAG = arg('diag'), CLONE = arg('clone'), SORTIE = arg('sortie'), API = arg('api');
if (!CACHE || !DIAG || !CLONE || !SORTIE) { console.error('usage : --cache= --diag= --clone= --sortie= [--api=]'); process.exit(2); }
const L = n => JSON.parse(fs.readFileSync(path.join(CACHE, `${n}.json`), 'utf8'));
const DEX = JSON.parse(fs.readFileSync(path.join(__dirname, 'pokedex-dexids.json'), 'utf8'));
const cleDex = s => String(s || '').toLowerCase().replace(/[^a-z0-9δ]+/g, '');

const diag = JSON.parse(fs.readFileSync(DIAG, 'utf8'));
const nc = new Map(L('numeros_cartes').map(n => [n.idProduct, n]));
const cat = new Map(L('catalogue_produits').map(c => [c.idProduct, c]));
const images = L('images_autres'), tpc = L('tpc_fiches');
champSur(images, 'set', { collection: 'images (hors Bulbapedia)' }); champSur(tpc, 'fiche.numero', { collection: 'tpc_fiches' });
const clone = lireClone(CLONE);
console.log(`DÉNOMINATEURS : produits ${diag.reduce((t, e) => t + e.sansLigne, 0)} · images hors Bulbapedia ${images.length} · tpc_fiches ${tpc.length} · clone TCGdex ${clone.cartes.length} cartes / ${clone.sets.size} sets`);
if (!clone.cartes.length) throw new Error('clone vide');

// --- index des relevés
const parSetNum = new Map();   // `${set}|${numero}` -> relevés
const ajouter = (set, numero, r) => { if (!set || numero == null || String(numero).trim() === '') return; const k = `${set}|${cleNumero(String(numero))}`; (parSetNum.get(k) || parSetNum.set(k, []).get(k)).push({ ...r, set, numero }); };
const SOURCE_IMAGES = { artofpkm: 'artofpkm', pikaqian: 'pikaqian', 'tpc-asie': 'tpc-asie', 'pokemon-card-com': 'pokemon-card-com', pokumon: 'pokumon', 'pokemontcg.io': 'pokemontcg.io', tcgdex: 'tcgdex', ctr: 'ctr', pkc: 'pkc', pdt: 'pdt', pokellector: 'pokellector' };
for (const im of images) {
    const s = SOURCE_IMAGES[im.source]; if (!s) continue;
    ajouter(im.set, im.numero, { source: s, nom: im.nomEn ?? (im.titre ? String(im.titre).split(',')[0] : null), ref: `images ${im._id}` });
}
// TPC : la ligne TPC du set désigne (site, langue, code imprimé)
for (const f of tpc) {
    const lignes = TABLE_TPC.filter(l => l.site === (f.site === 'tpc-asie' ? 'tpc-asie' : 'pokemon-card-com') && l.langue === f.langue && (f.fiche?.denominateur ?? null) != null && String(l.code) === String(f.fiche.denominateur));
    for (const l of lignes) ajouter(l.slug, f.fiche.numero, { source: f.site === 'tpc-asie' ? 'tpc-asie' : 'pokemon-card-com', nom: f.fiche.nom, dex: f.fiche.dex ? [].concat(f.fiche.dex) : null, ref: f.url ?? `${f.site}/${f.langue}/${f.idFiche}` });
}
// TCGdex (clone) : par idProduct, sinon par (expansion Cardmarket du set TCGdex, numéro local)
const parId = new Map(); for (const c of clone.cartes) for (const id of c.ids) (parId.get(id) || parId.set(id, []).get(id)).push(c);
const expDuDossier = new Map([...clone.sets].map(([d, s]) => [d, s.exp]));
const parExpNum = new Map(); for (const c of clone.cartes) { const e = expDuDossier.get(c.dossier); if (e) (parExpNum.get(`${e}|${cleNumero(c.localId)}`) || parExpNum.set(`${e}|${cleNumero(c.localId)}`, []).get(`${e}|${cleNumero(c.localId)}`)).push(c); }
const releveApi = API ? JSON.parse(fs.readFileSync(API, 'utf8')) : {};

const res = {}; const parSource = {}; let n = 0, ok = 0, okNeufs = 0, neufs = 0;
for (const e of diag) for (const p of e.produits) {
    n++;
    const N = nc.get(p.idProduct); const set = N?.slugSet ?? null;
    const dn = decomposerNomCardmarket(p.name);
    const produit = { set, numero: N?.numero ?? null, nom: dn.nom };
    const rel = [...(set && produit.numero != null ? parSetNum.get(`${set}|${cleNumero(String(produit.numero))}`) || [] : [])];
    const expP = cat.get(p.idProduct)?.idExpansion;
    for (const c of parId.get(p.idProduct) || []) rel.push({ source: 'tcgdex', set: expDuDossier.get(c.dossier) === expP ? set : `exp ${expDuDossier.get(c.dossier)}`, numero: c.localId, nom: c.en, dex: c.dex, ref: c.tcgdexId });
    if (!(parId.get(p.idProduct) || []).length && produit.numero != null) for (const c of parExpNum.get(`${expP}|${cleNumero(String(produit.numero))}`) || []) rel.push({ source: 'tcgdex', set, numero: c.localId, nom: c.en, dex: c.dex, ref: c.tcgdexId });
    for (const r of releveApi[p.idProduct] || []) rel.push({ ...r, set: r.set ?? set });
    const dexProduit = DEX[cleDex(dn.nom)] ?? null;
    const j = juger(produit, rel, { dexProduit });
    res[p.idProduct] = { exp: e.exp, set, numero: produit.numero, nom: produit.nom, neuf: !!p.nouveau, ...j };
    if (p.nouveau) neufs++;
    if (j.ok) { ok++; if (p.nouveau) okNeufs++; for (const s of j.sources.filter(x => x !== 'cardmarket')) parSource[s] = (parSource[s] || 0) + 1; }
}
console.log(`PASSENT la règle des deux sources : ${ok} / ${n} (dont neufs ≥ 917000 : ${okNeufs} / ${neufs}) · par source indépendante : ${JSON.stringify(parSource)}`);
fs.writeFileSync(SORTIE, JSON.stringify(res));
