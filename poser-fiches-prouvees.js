// ============================================================
// DES FICHES POSÉES D'UNE LISTE FERMÉE, PROUVÉES AU MOMENT D'ÉCRIRE (lot CAND-FICHES, 2026-10-17)
// ============================================================
//   node poser-fiches-prouvees.js --decision=2026-10-17                                   (SIMULATION : lecture seule, rien n'est écrit)
//   node lot-additif.js --quoi="CAND-FICHES : 8 fiches prouvées" --collections=cartes,cartes_produits -- node poser-fiches-prouvees.js --decision=2026-10-17 --attendu=8 --ecrire
//
// UNE LISTE FERMÉE PAR DÉCISION (comme detacher-lignes-prouvees.js) : l'outil ne décide pas ce qui est juste, il applique une décision prise sur une preuve et la
// REJOUE à l'écriture avec les fonctions de production — la clé nom + attaques (cle-nom-attaques.js), le témoin du nom de joindre() (jointure.js: temoinDuNom),
// la métacarte, le niveau, et la voie (collecte-cartes/fiches-prouvees.js). Une seule preuve qui ne tient plus : le produit est REFUSÉ, nommé, et `--attendu` arrête.
// ADDITIF PUR : la ligne `cartes_produits` en `$setOnInsert` (jamais une ligne existante réécrite, quelle que soit sa preuve) ; sur `cartes`, un `$addToSet` de
// `liens.idProduct` (EN FIN : le repère d'adresse du site, liens.idProduct[0], ne bouge pas), `liens.idMetacards` et — là où la décision le dit — `sets` : la liste
// fermée de regle-r-fiches.js (`garderEcritureSite`), nomEn jamais nommé. AUCUNE impression, AUCUNE image : un visuel d'un autre tirage n'est pas celui-ci (§19).
// Un produit qui a déjà une ligne (n'importe quelle carte) est refusé : on ne pose que des lignes ABSENTES, le reste est une modification qui attend son feu vert.
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const { prouver } = require('./collecte-cartes/fiches-prouvees');
const R = require('./collecte-cartes/regle-r-fiches');

const ROUTE = 'CAND-FICHES-2026-10-17';
const DECISIONS = {
    // Les 8 produits « APPRIS, sans ligne cartes_produits » (cause 2) des 13 candidates du banc réel (candidates-sans-vignette.json). Chaque voie est DÉCLARÉE ici,
    // avec ce qui la distingue : le numéro suffixé que la CARTE déclare elle-même (143a), S01 = 001/029 d'une autre extension de la carte, la Setlist, l'extension.
    '2026-10-17': [
        { idProduct: 582672, carteId: 240358, code: 'CEC', idExpansion: 2644, slugSet: 'Cosmic-Eclipse', voie: 'impression-numero', tirage: 'intl', numeroFiche: '143a', ajoutSet: false },
        { idProduct: 654763, carteId: 41165, code: 'EC1', idExpansion: 5021, slugSet: 'Base-Expansion-Pack', voie: 'impression-equivalente', tirage: 'jp', expansionImpression: 'Pokémon-e Starter Deck', prefixe: 'S', total: '029', numeroFiche: null, ajoutSet: true },
        // S05 : Cardmarket écrit « Hyptnotic Gaze » (faute de frappe d'UNE lettre) ; la carte et la métacarte 212835 (celle du produit) portent « Hypnotic Gaze »
        { idProduct: 654767, carteId: 29246, code: 'EC1', idExpansion: 5021, slugSet: 'Base-Expansion-Pack', voie: 'impression-equivalente', tirage: 'jp', expansionImpression: 'Pokémon-e Starter Deck', prefixe: 'S', total: '029', numeroFiche: null, ajoutSet: true, fautesDeFrappe: [['Hyptnotic Gaze', 'Hypnotic Gaze']] },
        { idProduct: 677601, carteId: 71404, code: 'Pt3', idExpansion: 4286, slugSet: 'Beat-of-the-Frontier', voie: 'setlist', tirage: 'jp', numeroFiche: '050', ajoutSet: false },
        { idProduct: 696058, carteId: 263369, code: 'S-P', idExpansion: 3214, slugSet: 'Sword-Shield-Promos', voie: 'impression-du-tirage', tirage: 'jp', expansionImpression: 'S-P Promotional cards', numeroFiche: null, ajoutSet: false },
        { idProduct: 698733, carteId: 32017, code: 'DP3p', idExpansion: 4311, slugSet: 'Palkia-LVX-Constructed-Standard-Deck', voie: 'impression-du-tirage', tirage: 'jp', expansionImpression: 'Palkia LV.X Constructed Standard Deck', numeroFiche: null, ajoutSet: true },
        { idProduct: 698734, carteId: 32017, code: 'DP3p', idExpansion: 4311, slugSet: 'Palkia-LVX-Constructed-Standard-Deck', voie: 'impression-du-tirage', tirage: 'jp', expansionImpression: 'Palkia LV.X Constructed Standard Deck', numeroFiche: null, ajoutSet: true },
        { idProduct: 859904, carteId: 328069, code: 'SV-P/TH', idExpansion: 6128, slugSet: 'Scarlet-Violet-Thai-Promos', voie: 'setlist', tirage: 'th', numeroFiche: null, ajoutSet: true },
    ],
};

/** lecture : { cartes, produits: Map(idExpansion → produits), existants: Map(_id → ligne), lignesDuProduit?: Map(idProduct → [_id]), etats?: Map(slugSet → collecte_etat) } */
function planifier({ entrees, lecture, le = new Date() }) {
    const parId = new Map(lecture.cartes.map(c => [c._id, c]));
    const lignes = [], refus = [], deja = [];
    for (const e of entrees) {
        const p0 = (lecture.produits.get(e.idExpansion) || []).find(p => p.idProduct === e.idProduct);
        if (!p0) { refus.push({ idProduct: e.idProduct, raison: `produit ${e.idProduct} absent du catalogue de l'expansion ${e.idExpansion}` }); continue; }
        const _id = `${e.carteId}|${e.idProduct}`;
        if (lecture.existants.has(_id)) { deja.push({ _id, preuve: lecture.existants.get(_id).preuve }); continue; }
        const autres = lecture.lignesDuProduit?.get(e.idProduct) || [];
        if (autres.length) { refus.push({ idProduct: e.idProduct, raison: `le produit a déjà ${autres.length} ligne(s) (${autres.slice(0, 3).join(', ')}) : on ne pose que des lignes absentes` }); continue; }
        const carte = parId.get(e.carteId);
        if (!carte) { refus.push({ idProduct: e.idProduct, raison: `carte ${e.carteId} absente de la base` }); continue; }
        const produit = { ...p0, niveau: decomposerNomCardmarket(p0.name).niveau };
        const cartesDuSet = lecture.cartes.filter(c => (c.sets || []).includes(e.slugSet));
        const r = prouver({ entree: e, produit, carte, cartesDuSet, cartesPourCle: lecture.cartes, etatSetlist: lecture.etats?.get(e.slugSet) ?? null });
        if (!r.ok) { refus.push({ idProduct: e.idProduct, raison: r.refus.join(' ; ') }); continue; }
        lignes.push({
            _id, carteId: e.carteId, idProduct: e.idProduct, idExpansion: e.idExpansion, tirage: e.tirage, preuve: 'fiche-prouvee', slug: p0.slug ?? null, slugSet: e.slugSet, numeroFiche: e.numeroFiche ?? null,
            detail: `${e.code} n°${p0.numero ?? '—'} « ${p0.name} » → ${e.carteId} « ${carte.nomEn} » : voie ${e.voie} · ${r.temoins.join(' · ')}`, verifieLe: le, route: ROUTE,
        });
    }
    return { lignes, refus, deja };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.lignes.length !== attendu) return { ok: false, raison: `le plan compte ${plan.lignes.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

/**
 * `metaDe` : idProduct → idMetacard ; `ajoutsSets` : carteId → [slug de set à ajouter]. Rend { lignes, cartes } = ce qui a réellement été modifié.
 * Sur `cartes` : UNIQUEMENT les opérations de la liste fermée du site (R.operationsCartes + R.garderEcritureSite, qui LÈVE sinon).
 */
async function ecrireFiches(db, lignes, metaDe, ajoutsSets = new Map()) {
    let n = 0;
    for (const l of lignes) n += (await db.collection('cartes_produits').updateOne({ _id: l._id }, { $setOnInsert: l }, { upsert: true })).upsertedCount;
    const parCarte = new Map();
    for (const l of lignes) {
        const w = parCarte.get(l.carteId) || parCarte.set(l.carteId, { ids: [], metas: new Set(), sets: new Set() }).get(l.carteId);
        w.ids.push(l.idProduct); if (metaDe.get(l.idProduct) != null) w.metas.add(metaDe.get(l.idProduct));
        for (const s of ajoutsSets.get(l.carteId) || []) w.sets.add(s);
    }
    const ops = R.operationsCartes(parCarte);
    R.garderEcritureSite(ops);
    const rc = ops.length ? await db.collection('cartes').bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };
    return { lignes: n, cartes: rc.modifiedCount };
}

async function lire({ cartesDb, prodDb, entrees }) {
    const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
    const cartes = await cartesDb.collection('cartes').find({}, { projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, impressions: 1, sets: 1, liens: 1, images: 1, 'bulba.titre': 1 } }).toArray();
    if (!cartes.length) throw new Error('lecture vide : aucune carte (grappe fausse ?)');
    const produits = new Map();
    for (const exp of new Set(entrees.map(e => e.idExpansion))) produits.set(exp, await produitsDeLExpansion({ db: prodDb }, exp));
    const ids = entrees.map(e => e.idProduct);
    const dejaLa = await cartesDb.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
    const existants = new Map(dejaLa.map(l => [l._id, l])), lignesDuProduit = new Map();
    for (const l of dejaLa) (lignesDuProduit.get(l.idProduct) || lignesDuProduit.set(l.idProduct, []).get(l.idProduct)).push(l._id);
    const etats = new Map();
    for (const slug of new Set(entrees.filter(e => e.voie === 'setlist').map(e => e.slugSet))) { const d = await cartesDb.collection('collecte_etat').findOne({ _id: slug }, { projection: { pages: 1 } }); if (d) etats.set(slug, d); }
    return { cartes, produits, existants, lignesDuProduit, etats };
}

/** Le gain en produits SERVIS, par la règle du site importée (collecte-cartes/simuler-servis.js) — avant, après, et ce qui bougerait AILLEURS. */
async function simulerServis({ cartesDb, lecture, plan, entrees }) {
    const S = require('./collecte-cartes/simuler-servis');
    const regles = await S.reglesDuSite();
    const slugs = [...new Set(entrees.map(e => e.slugSet))];
    const ajoutsSets = new Map(entrees.filter(e => e.ajoutSet).map(e => [e.carteId, []]));
    for (const e of entrees) if (e.ajoutSet) ajoutsSets.get(e.carteId).push(e.slugSet);
    const sorties = [];
    for (const slug of slugs) {
        const set = await cartesDb.collection('sets').findOne({ _id: slug });
        const exps = [].concat(set.idExpansion ?? []);
        const cartes = lecture.cartes.filter(c => (c.sets || []).includes(slug) || plan.lignes.some(l => l.carteId === c._id && l.slugSet === slug));
        const lignes = await cartesDb.collection('cartes_produits').find({ idExpansion: { $in: exps } }).toArray();
        const ajouts = plan.lignes.filter(l => l.slugSet === slug);
        const avant = await S.produitsServis({ setsDocs: [set], cartes, lignes, regles });
        const apres = await S.produitsServis({ setsDocs: [set], cartes, lignes, ajouts, ajoutsSets, regles });
        sorties.push({ slug, produitsDuSet: lignes.length, avant: avant.size, apres: apres.size, gagnes: [...apres].filter(x => !avant.has(x)), perdus: [...avant].filter(x => !apres.has(x)), lignesPosees: ajouts.map(l => l.idProduct) });
    }
    return sorties;
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, log = console.log, err = console.error }) {
    const AUTORISES = [/^--decision=[\d-]+$/, /^--attendu=\d+$/, /^--ecrire$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    if (inconnus.length || !arg('decision')) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--decision=<date> obligatoire (décisions : ${Object.keys(DECISIONS).join(', ')})`); return 2; }
    const entrees = DECISIONS[arg('decision')];
    if (!entrees) { err(`❌ décision « ${arg('decision')} » inconnue (${Object.keys(DECISIONS).join(', ')})`); return 2; }
    const ecrire = argv.includes('--ecrire');
    const cx = ecrire ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const cartesDb = cx.cartes.db, prodDb = cx.prod.db;
        const lecture = await lire({ cartesDb, prodDb, entrees });
        const plan = planifier({ entrees, lecture });
        log(`   DÉCISION ${arg('decision')} : ${entrees.length} produits listés · ${lecture.cartes.length} cartes lues`);
        for (const l of plan.lignes) log(`   + ${l._id} (${l.slugSet}, numeroFiche ${l.numeroFiche ?? '—'}) ${l.detail}`);
        for (const r of plan.refus) log(`   - REFUS ${r.idProduct} : ${r.raison}`);
        for (const d of plan.deja) log(`   = déjà là ${d._id} (${d.preuve}) : jamais réécrite`);
        const sansRepere = R.cartesSansRepere(lecture.cartes, plan.lignes.map(l => l.carteId));
        log(`\n   PLAN : ${plan.lignes.length} ligne(s) à poser · ${plan.refus.length} refus · ${plan.deja.length} déjà · cartes sans repère d'adresse (liens.idProduct vide) : ${sansRepere.length}${sansRepere.length ? ` — ${sansRepere.join(', ')}` : ''}`);
        const ajoutsSets = new Map();
        for (const e of entrees) if (e.ajoutSet && plan.lignes.some(l => l._id === `${e.carteId}|${e.idProduct}`)) { const s = ajoutsSets.get(e.carteId) || ajoutsSets.set(e.carteId, new Set()).get(e.carteId); s.add(e.slugSet); }
        for (const [c, s] of ajoutsSets) log(`   appartenance ajoutée : carte ${c} → ${[...s].join(', ')} (cartes.sets, $addToSet)`);
        for (const s of await simulerServis({ cartesDb, lecture, plan, entrees })) log(`   SERVIS ${s.slug} : ${s.avant} → ${s.apres} sur ${s.produitsDuSet} lignes · gagnés ${JSON.stringify(s.gagnes)} · perdus ${JSON.stringify(s.perdus)} · lignes posées ${JSON.stringify(s.lignesPosees)}`);
        if (!ecrire) { log('   (simulation — lot-additif.js … -- node poser-fiches-prouvees.js --decision=… --attendu=N --ecrire)'); return 0; }
        const v = verifierAttendu(plan, arg('attendu') === undefined ? undefined : Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const metaDe = new Map([...lecture.produits.values()].flat().map(p => [p.idProduct, p.idMetacard]));
        const r = await ecrireFiches(cartesDb, plan.lignes, metaDe, new Map([...ajoutsSets].map(([c, s]) => [c, [...s]])));
        const relues = await cartesDb.collection('cartes_produits').countDocuments({ _id: { $in: plan.lignes.map(l => l._id) }, preuve: 'fiche-prouvee', route: ROUTE });
        log(`\n   ✅ lignes posées ${r.lignes}/${plan.lignes.length} · cartes modifiées ${r.cartes} · relu : ${relues}/${plan.lignes.length}`);
        return r.lignes === plan.lignes.length && relues === plan.lignes.length ? 0 : 1;
    } finally { await cx.fermer(); }
}

/** Connexions de LECTURE SEULE (utilisateurs Atlas de lecture) : la simulation n'ouvre jamais une URI d'écriture. */
async function ouvrirLecture() {
    const { MongoClient } = require('mongodb');
    const u1 = process.env.MONGODB_CARTES_LECTURE_URI, u2 = process.env.MONGODB_LECTURE_URI;
    if (!u1 || !u2) throw new Error('MONGODB_CARTES_LECTURE_URI et MONGODB_LECTURE_URI obligatoires pour la simulation (lecture seule)');
    const a = new MongoClient(u1), b = new MongoClient(u2);
    await Promise.all([a.connect(), b.connect()]);
    const cartes = a.db('cartes'), prod = b.db('test');
    for (const [nom, db] of [['cartes', cartes], ['test', prod]]) if (!(await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error(`base « ${nom} » vide : grappe fausse ?`);
    return { cartes: { db: cartes }, prod: { db: prod }, fermer: async () => { await Promise.allSettled([a.close(), b.close()]); } };
}

module.exports = { planifier, verifierAttendu, ecrireFiches, executer, DECISIONS, ROUTE };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    executer({ argv: process.argv.slice(2), ouvrirLecture, ouvrirEcriture: () => require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
