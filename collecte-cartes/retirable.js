// ============================================================
// RETIRABLE (testeur, 2026-10-17) — `retirable: true` sur les visuels Bulbapedia SERVIS et les visuels TPC Asie (Taïwan) déjà en base
// ============================================================
// Décisions du testeur : « Les 566 images Bulbapedia servies : on les GARDE, sans les remplacer. […] Marque-les source: "bulbapedia" et retirable: true, comme les autres. »
// et « Taïwan reste ouvert […] chaque image porte source: "tpc-asie" et retirable: true […] les 159 visuels déjà en base restent, et sont marqués retirables s'ils ne le sont pas déjà. »
//
// UN SEUL CHAMP, `retirable: true`, sur l'entrée `cartes.images` et sur le document `images` du même fichier. Rien d'autre (ni `urlOriginal`, ni `collecteLe`).
// ADDITIF : seulement là où le champ est ABSENT ; une valeur déjà présente (true, ou autre) n'est jamais réécrite ; idempotent.
//
// ÉCRIT PAR CE QU'IL AUTORISE (la cohorte est une liste fermée) :
//   · Bulbapedia : l'entrée `cartes.images` de source `bulbapedia` ADMISE par la règle du site (`visuelAdmisPourLaRegion`, IMPORTÉE : un scan japonais sous un set international
//     n'est pas servi ; un set au tirage inconnu n'est pas jugé), et le document `images` de source `bulbapedia` qui porte la même clé R2 ;
//   · TPC Asie : toute entrée `cartes.images` source `tpc-asie` et langue `zh-hant`, et tout document `images` source `tpc-asie` langue `zh-hant`.
// Le reste de la base n'est ni lu pour être écrit, ni écrit.

const SOURCES = Object.freeze({ bulbapedia: 'bulbapedia', tpc: 'tpc-asie' });
const LANGUE_TPC = 'zh-hant';

const estBase = db => db && typeof db.collection === 'function';

/**
 * @param {{cartesDb: object, admis: (visuel: object, tirage: string) => boolean}} o  `admis` : la règle du site, `regleDuSite().visuelAdmisPourLaRegion`.
 * @returns {Promise<{entrees: object[], documents: object[], comptes: object}>} Rien n'est écrit.
 */
async function construirePlan({ cartesDb, admis }) {
    if (!estBase(cartesDb)) throw new Error('cartesDb : une base (collection()) est requise');
    if (typeof admis !== 'function') throw new Error('admis : la règle du site (visuelAdmisPourLaRegion) est requise, jamais recopiée');
    const sets = await cartesDb.collection('sets').find({}).project({ tirage: 1, region: 1 }).toArray();
    if (!sets.length) throw new Error('collection « sets » vide ou mal nommée : la règle du site ne peut pas juger (§41)');
    const tirageDe = new Map(sets.map(s => [s._id, s.tirage ?? s.region ?? null]));
    const cartes = await cartesDb.collection('cartes').find({ 'images.source': { $in: [SOURCES.bulbapedia, SOURCES.tpc] } }).project({ images: 1 }).toArray();

    const c = { cohorte: 0, entrees: { bulbapedia: 0, 'tpc-asie': 0, dejaBulbapedia: 0 }, documents: { bulbapedia: 0, 'tpc-asie': 0, dejaBulbapedia: 0 }, bulbapediaRefuseeParLaRegle: 0, bulbapediaSetInconnu: 0, autreValeur: 0 };
    const entrees = [], vues = new Set(), clesBulba = new Set();
    for (const carte of cartes) for (const e of carte.images || []) {
        if (!e || !e.cleR2) continue;
        let source = null;
        if (e.source === SOURCES.bulbapedia) {
            const tir = tirageDe.get(e.set);
            if (!tir) { c.bulbapediaSetInconnu++; continue; }
            if (!admis(e, tir)) { c.bulbapediaRefuseeParLaRegle++; continue; }
            source = 'bulbapedia';
        } else if (e.source === SOURCES.tpc && e.langue === LANGUE_TPC) source = 'tpc-asie';
        else continue;
        const cle = `${carte._id}|${e.set}|${e.cleR2}`;
        if (vues.has(cle)) continue;   // une même entrée dupliquée ne se compte et ne s'écrit qu'une fois
        vues.add(cle);
        c.cohorte++;
        if (source === 'bulbapedia') clesBulba.add(e.cleR2);
        if (e.retirable === true) { if (source === 'bulbapedia') c.entrees.dejaBulbapedia++; continue; }
        if ('retirable' in e) { c.autreValeur++; continue; }
        c.entrees[source]++;
        entrees.push({ carteId: carte._id, set: e.set, cleR2: e.cleR2, source });
    }

    const docs = [];
    if (clesBulba.size) for (const d of await cartesDb.collection('images').find({ source: SOURCES.bulbapedia, cleR2: { $in: [...clesBulba] } }).toArray()) docs.push({ d, source: 'bulbapedia' });
    for (const d of await cartesDb.collection('images').find({ source: SOURCES.tpc, langue: LANGUE_TPC }).toArray()) docs.push({ d, source: 'tpc-asie' });
    const documents = [];
    for (const { d, source } of docs) {
        if (d.retirable === true) { if (source === 'bulbapedia') c.documents.dejaBulbapedia++; continue; }
        if ('retirable' in d) { c.autreValeur++; continue; }
        c.documents[source]++;
        documents.push({ _id: d._id, cleR2: d.cleR2, source });
    }
    return { entrees, documents, comptes: c };
}

/** `ecrire: false` (défaut) : la simulation rend les comptes. `attendu` (OBLIGATOIRE à l'écriture) est comparé à la cohorte AVANT toute écriture. */
async function appliquer(cartesDb, plan, { ecrire = false, attendu } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (la cohorte lue à la simulation) : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== plan.comptes.cohorte) throw new Error(`--attendu=${attendu} mais la cohorte compte ${plan.comptes.cohorte} entrée(s) : rien n'est écrit`);
    const r = { entrees: plan.entrees.length, documents: plan.documents.length, dejaFait: !plan.entrees.length && !plan.documents.length };
    if (!ecrire) return r;
    for (const p of plan.entrees) {
        const res = await cartesDb.collection('cartes').updateOne({ _id: p.carteId },
            { $set: { 'images.$[e].retirable': true } },
            { arrayFilters: [{ 'e.set': p.set, 'e.cleR2': p.cleR2, 'e.retirable': { $exists: false } }] });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`entrée introuvable ou déjà marquée : carte ${p.carteId}, ${p.set}, ${p.cleR2} — arrêt (rejouer : idempotent)`);
    }
    for (const p of plan.documents) {
        const res = await cartesDb.collection('images').updateOne({ _id: p._id, retirable: { $exists: false } }, { $set: { retirable: true } });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`document images introuvable ou déjà marqué : ${p._id} — arrêt (rejouer : idempotent)`);
    }
    return r;
}

module.exports = { SOURCES, LANGUE_TPC, construirePlan, appliquer };
