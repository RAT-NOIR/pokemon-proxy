// ============================================================
// AUDIT DES VISUELS MANQUANTS, TOUTES RÉGIONS — chaque fiche publiée sans visuel, dans UNE case (demande du testeur, 2026-10-05)
// ============================================================
//   node audit-visuels-manquants.mjs [--espece=Mimikyu]
// LES FICHES SONT CELLES DU SITE : construites par ses fonctions IMPORTÉES (entreesDuDocument, fichesDuDocument, setParImpression,
// ordonnerEtSlugger, refusDuVisuel), sur les sets que le site publie — exactement comme son propre audit
// (rat-market-site/scripts/auditer-visuels-non-servis.mjs, qui sert de témoin : mêmes totaux attendus). Un contrôle qui réécrit la
// règle se trompe de règle.
// UNE case par fiche sans visuel, la première qui s'applique :
//   A  EN BASE, NON SERVIE   a-refus:<cause>   une image de la fiche est en base, la garde du site la refuse (langue…)
//                            a-autre-numero   la carte a une image dans ce set, mais à un autre numéro
//   B  SOURCE EXISTANTE      b-artofpkm-jamais-collecte · b-artofpkm-refuse:<phase> · b-echec (téléchargement en échec)
//                            b-tcgdex (cache TCGdex : l'image existe) · b-occidental:<cas> (audit occidental du 2026-09-26)
//                            b-a-confirmer:<raison> (une source pourrait l'avoir, jamais lue)
//   C  AUCUNE SOURCE         c-<raison> — la preuve de chaque source interrogée, écrite
// LECTURE SEULE. Aucune requête à une source ; aucune requête HTTP (la règle importée EST ce que le site sert ; le cache de page
// se vérifie à part, `--production` de l'audit du site). Sortie : LISTE-VISUELS-MANQUANTS.json, triée par rareté (SR, SAR, AR,
// alternatives d'abord) puis par prix décroissant.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const R = 'C:/Users/Yung/Desktop/pokemon-proxy', S = 'C:/Users/Yung/Desktop/rat-market-site';
const require = createRequire(`${R}/package.json`);
process.chdir(R);
require('dotenv').config({ path: `${R}/.env` });
const AUTORISES = [/^--espece=[^\s]+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --espece=<nom anglais>`); process.exit(2); }
const ESPECE = process.argv.find(a => a.startsWith('--espece='))?.slice(9) ?? null;
const site = async f => import(pathToFileURL(`${S}/lib/${f}`).href);
const { estAdditionals } = await site('additionals.ts');
const { entreesDuDocument, expansionsDuSet, ordonnerEtSlugger, tirageDuSet } = await site('entreesDuSet.ts');
const { normaliserNumero } = await site('imageDeLImpression.ts');
const { fichesDuDocument, setParImpression } = await site('impressionsDuSet.ts');
const { refusDuVisuel } = await site('langueDuVisuel.ts');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { sourceDe } = require('./collecte-cartes/sources-sets');

/** Recopiée MOT POUR MOT de rat-market-site/scripts/auditer-visuels-non-servis.mjs (le script s'exécute à l'import : on ne peut
 *  pas l'importer). Le rang d'une rareté : SR, SAR, AR, alternatives d'abord (demande du testeur). */
function rangDeRarete(rarete) {
    const r = (rarete ?? '').trim();
    if (/^(SR|UR|HR|SSR)$|secret|ultra|hyper|rare rainbow|rare holo (gx|ex|v|vmax|vstar) full|full art/i.test(r)) return 1;
    if (/^(SAR|CSR)$|special (illustration|art) rare/i.test(r)) return 2;
    if (/^(AR|CHR)$|^illustration rare$|art rare|character/i.test(r)) return 3;
    if (/alt|shiny|gallery|radiant|amazing|prism|star|☆|gold|^TG|^S$|^K$|^A$|^ACE/i.test(r)) return 4;
    if (/holo|^RR+$|^R$|rare|double|^PR$|promo/i.test(r)) return 5;
    return 6;
}
const CHINOIS = new Set(['zh-hans', 'zh-hant']);
const PREUVE_CHINOIS = 'plancher chinois (CLAUDE.md §42, 2026-09-21) : artofpkm ne porte pas le chinois (table des sources) · aucune page de carte Bulbapedia ne déclare un tirage chinois · aucune galerie sur les 136 pages (ATCG/SCTCG/TCTCG) · TCGdex zh-tw sans image · CGU de pokemon.cn et de TPC Asie : copie interdite';

const t0 = Date.now();
const { cartes: cx, prod: px, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
const db = cx.db;
const tousSets = await db.collection('sets').find({}, { projection: { nomAffichage: 1, region: 1, tirage: 1, code: 1, idExpansion: 1, 'bulba.expansion': 1 } }).toArray();
const publies = new Map(tousSets.filter(s => typeof s.nomAffichage === 'string' && !estAdditionals(s._id) && s.bulba)
    .map(s => [s._id, { ...s, tirage: tirageDuSet(s), expansions: expansionsDuSet(s) }]));
const parSet = new Map();
for await (const d of db.collection('cartes').find({ nomEn: { $type: 'string', $ne: '' } }, { projection: { nomEn: 1, nomFr: 1, type: 1, illustrateur: 1, sets: 1, 'liens.idProduct': 1, impressions: 1, images: 1 } })) {
    for (const slug of d.sets ?? []) {
        const set = publies.get(slug); if (!set) continue;
        const doc = { _id: d._id, nomEn: d.nomEn, nomFr: d.nomFr, type: d.type ?? null, illustrateur: d.illustrateur ?? null, idp: d.liens?.idProduct?.[0] ?? 0,
            imps: (d.impressions ?? []).filter(i => i.tirage === set.tirage && set.expansions.includes(i.expansion)), imgs: (d.images ?? []).filter(m => m.set === slug) };
        (parSet.get(slug) || parSet.set(slug, []).get(slug)).push(doc);
    }
}
// les fiches sans visuel, construites par les fonctions du site
const sans = [];
let nFiches = 0, nAvec = 0;
for (const [slug, docs] of parSet) {
    const set = publies.get(slug);
    const documents = docs.map(d => ({ d, fiches: fichesDuDocument(d.imps), images: d.imgs }));
    const parImpression = setParImpression(documents);
    const brutes = documents.flatMap(({ d, fiches }) => entreesDuDocument(d, fiches, set.tirage, parImpression, 'X').map(e => ({ ...e, _doc: d })));
    for (const e of ordonnerEtSlugger(brutes)) {
        nFiches++;
        if (e.imageUrl) { nAvec++; continue; }
        sans.push({ set, e });
    }
}
console.log(`DÉNOMINATEUR : ${publies.size} sets publiés · ${nFiches} fiches · ${nAvec} avec visuel · ${sans.length} SANS visuel (témoin : l'audit du site, 61 432 / 44 399 / 17 033 le 2026-10-05 à 20:39 UTC)`);

// ── les sources, lues une fois
const etats = new Map((await db.collection('collecte_images_etat').find({ _id: { $regex: '^artofpkm/' } }, { projection: { phase: 1, entrees: 1 } }).toArray())
    .map(e => [e._id.slice(9), { phase: e.phase, listees: Object.values(e.entrees || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0) }]));
const imgsDocs = new Map();   // carteId|set -> [états]
for await (const im of db.collection('images').find({ carteId: { $ne: null } }, { projection: { carteId: 1, set: 1, etat: 1, numero: 1 } }))
    (imgsDocs.get(`${im.carteId}|${im.set}`) || imgsDocs.set(`${im.carteId}|${im.set}`, []).get(`${im.carteId}|${im.set}`)).push(im);
const orphelinesParSet = new Map();
const servies = new Set(await db.collection('cartes').distinct('images.cleR2'));
for await (const im of db.collection('images').find({ etat: 'ok', $or: [{ carteId: null }, { carteId: { $exists: false } }] }, { projection: { cleR2: 1, set: 1 } }))
    if (!servies.has(im.cleR2)) orphelinesParSet.set(im.set, (orphelinesParSet.get(im.set) ?? 0) + 1);
const tcg = new Map((await db.collection('tcgdex_sets').find({ _id: { $regex: '^(id|th)/' } }, { projection: { cartes: 1 } }).toArray()).map(x => [x._id, x.cartes || []]));
let occ = new Map(), occLe = null;
if (fs.existsSync(`${R}/audit-occidental.json`)) {
    const A = JSON.parse(fs.readFileSync(`${R}/audit-occidental.json`, 'utf8'));
    occLe = A.genere ?? fs.statSync(`${R}/audit-occidental.json`).mtime.toISOString();
    occ = new Map((A.cartes || []).map(l => [`${l.set}|${l.carteId}|${normaliserNumero(l.numero)}`, l]));
}

function classer({ set, e }) {
    const d = e._doc, voulu = normaliserNumero(e.numero);
    const pourElle = d.imgs.filter(m => voulu === null || normaliserNumero(m.numero) === voulu || normaliserNumero(m.numero) === null);
    if (pourElle.length) return { cas: `a-refus:${pourElle.map(m => m.cleR2 ? refusDuVisuel(m, set.tirage) : 'sans-cle')[0]}`, preuve: pourElle.map(m => m.cleR2).join(', ') };
    if (d.imgs.length) return { cas: 'a-autre-numero', preuve: `images du set aux n° ${d.imgs.map(m => m.numero ?? '—').join(', ')}, fiche n°${e.numero ?? '—'}` };
    const docsImg = imgsDocs.get(`${d._id}|${set._id}`) || [];
    const enEchec = docsImg.find(i => ['echec', 'trop-petit', 'retire'].includes(i.etat));
    if (enEchec) return { cas: enEchec.etat === 'echec' ? 'b-echec' : `c-${enEchec.etat}`, preuve: `document images ${enEchec._id} (${enEchec.etat})` };
    if (CHINOIS.has(set.tirage)) return { cas: 'c-plancher-chinois', preuve: PREUVE_CHINOIS };
    if (set.tirage === 'jp') {
        const src = sourceDe(set.code, 'artofpkm');
        if (!src) return { cas: 'b-a-confirmer:artofpkm-non-apparie', preuve: `aucune source artofpkm déclarée pour ${set.code} (sources-sets : ni table ni appariement automatique)` };
        const st = etats.get(set._id);
        if (!st) return { cas: 'b-artofpkm-jamais-collecte', preuve: `artofpkm ${JSON.stringify(src.ids)} déclaré, aucun état de collecte` };
        if (st.phase !== 'verifie') return { cas: `b-artofpkm-refuse:${st.phase}`, preuve: `artofpkm ${JSON.stringify(src.ids)} : phase ${st.phase}, ${st.listees} entrées listées` };
        if (orphelinesParSet.get(set._id)) return { cas: 'a-orpheline-du-set', preuve: `${orphelinesParSet.get(set._id)} image(s) artofpkm du set servie(s) par aucune carte : à rapprocher` };
        return { cas: st.listees ? 'c-artofpkm-ne-la-liste-pas' : 'c-artofpkm-liste-vide', preuve: `artofpkm ${JSON.stringify(src.ids)} « ${src.noms.join(' / ')} » : ${st.listees} entrées listées, toutes jointes` };
    }
    if (set.tirage === 'intl') {
        const o = occ.get(`${set._id}|${d._id}|${voulu}`);
        if (o) return { cas: o.cas === 'c' ? 'c-occidental' : `b-occidental:${o.cas}`, preuve: `audit occidental du ${occLe} : ${o.detail ?? ''} ${(o.preuves || []).join(' · ')}`.trim() };
        return { cas: 'b-a-confirmer:occidental-hors-audit', preuve: `fiche absente de l'audit occidental du ${occLe ?? '?'} (set ou carte postérieurs)` };
    }
    if (['id', 'th', 'idth'].includes(set.tirage)) {
        const lang = set.tirage === 'th' ? 'th' : 'id', cartes = tcg.get(`${lang}/${set.code}`);
        if (!cartes) return { cas: 'b-a-confirmer:tcgdex-jamais-lu', preuve: `TCGdex ${lang}/${set.code} absent du cache (lus : ${[...tcg.keys()].join(', ')})` };
        const c = cartes.find(x => normaliserNumero(x.localId) === voulu);
        if (c?.image) return { cas: 'b-tcgdex', preuve: `TCGdex ${lang}/${set.code} n°${c.localId} porte une image` };
        return { cas: 'c-tcgdex-sans-image', preuve: `TCGdex ${lang}/${set.code} : ${c ? `n°${c.localId} sans image` : `n°${e.numero} absent`} (cache)` };
    }
    return { cas: `c-tirage-${set.tirage}`, preuve: 'tirage sans source connue' };
}

// prix : le produit de la fiche (cartes_produits : carte, expansion du set, numéro de fiche) → guide_prix.trend
const cles = sans.map(({ set, e }) => ({ carteId: e._doc._id, exps: [].concat(set.idExpansion ?? []), num: normaliserNumero(e.numero) }));
const cps = await db.collection('cartes_produits').find({ carteId: { $in: [...new Set(cles.map(c => c.carteId))] } }, { projection: { carteId: 1, idExpansion: 1, numeroFiche: 1, idProduct: 1 } }).toArray();
const prix = new Map((await px.db.collection('guide_prix').find({ idProduct: { $in: cps.map(c => c.idProduct) } }, { projection: { idProduct: 1, trend: 1 } }).toArray()).map(p => [p.idProduct, p.trend]));
const lignes = sans.map((x, i) => {
    const k = cles[i];
    const ps = cps.filter(c => c.carteId === k.carteId && k.exps.includes(c.idExpansion) && (k.num === null || normaliserNumero(c.numeroFiche) === k.num || c.numeroFiche == null));
    const trend = Math.max(...ps.map(p => prix.get(p.idProduct) ?? -1), -1);
    const { cas, preuve } = classer(x);
    return { set: x.set._id, tirage: x.set.tirage, url: `/fr/sets/${x.set._id}/${x.e.slug}`, numero: x.e.numero ?? null, nom: x.e.nomFr ?? x.e.nomEn, nomEn: x.e.nomEn,
        rarete: x.e.rarete ?? null, rang: rangDeRarete(x.e.rarete), prix: trend >= 0 ? trend : null, produits: ps.map(p => p.idProduct), famille: cas[0].toUpperCase(), cas, preuve };
});
lignes.sort((a, b) => a.rang - b.rang || (b.prix ?? -1) - (a.prix ?? -1));
const compte = (f) => { const m = {}; for (const l of lignes) { const k = f(l); m[k] = (m[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
const totaux = { fiches: nFiches, avecVisuel: nAvec, sansVisuel: lignes.length, parFamille: compte(l => l.famille), parCas: compte(l => l.cas), parTirage: compte(l => l.tirage),
    familleParTirage: compte(l => `${l.tirage} ${l.famille}`), parRang: compte(l => l.rang) };
fs.writeFileSync(`${R}/LISTE-VISUELS-MANQUANTS.json`, JSON.stringify({ mesureLe: new Date().toISOString(), totaux, lignes }, null, 1));
console.log(JSON.stringify(totaux, null, 1));
console.log('\nLES 25 PREMIÈRES (rareté, puis prix) :');
for (const l of lignes.slice(0, 25)) console.log(`   ${l.cas.padEnd(34)} ${String(l.prix ?? '—').padStart(8)} € · ${l.rarete ?? '—'} · ${l.url}`);
if (ESPECE) {
    const re = new RegExp(ESPECE, 'i'), m = lignes.filter(l => re.test(l.nomEn));
    console.log(`\n${ESPECE} : ${m.length} fiche(s) sans visuel`);
    for (const l of m) console.log(`   ${l.cas.padEnd(34)} ${l.tirage.padEnd(8)} ${l.url} · ${l.rarete ?? '—'} · ${l.prix ?? '—'} € · ${l.preuve.slice(0, 160)}`);
}
console.log(`\n${Math.round((Date.now() - t0) / 1000)} s · écrit LISTE-VISUELS-MANQUANTS.json`);
await fermer();
