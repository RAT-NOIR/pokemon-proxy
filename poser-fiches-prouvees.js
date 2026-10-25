// ============================================================
// DES FICHES POSÉES D'UNE LISTE FERMÉE, PROUVÉES AU MOMENT D'ÉCRIRE (lot CAND-FICHES, 2026-10-17)
// ============================================================
//   node poser-fiches-prouvees.js --decision=2026-10-17                                   (SIMULATION : lecture seule, rien n'est écrit)
//   node lot-additif.js --quoi="CAND-FICHES : 8 fiches prouvées" --collections=cartes,cartes_produits -- node poser-fiches-prouvees.js --decision=2026-10-17 --attendu=8 --attendu-sets=1 --ecrire
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
const { preverifierLignes } = require('./collecte-cartes/lignes-detachees');

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
    // API-52 L3 (coordinateur, 2026-10-25) : SEULEMENT les produits dont DEUX sources concordent (Cardmarket + une seconde). Exclus, « à instruire : une seule source » : 877355 Jirachi (carte -892515)
    // et 653505 Sonia (carte 246287), Cardmarket seul. `preuve` est la référence de la décision (jamais écrite sur la ligne : planifier() ne la lit pas). Aucune appartenance de set (ajoutSet false) : les sets sont déjà portés par les cartes.
    '2026-10-25': [
        { idProduct: 311408, carteId: 214539, code: 'XYPR', idExpansion: 1612, slugSet: 'XY-Black-Star-Promos', voie: 'impression-numero', tirage: 'intl', prefixeNumero: 'XY', numeroFiche: 'XY177a', ajoutSet: false,
            preuve: { sources: ['Cardmarket (n°177a, Karen, slug Karen-V2-XYPRXY177a)', 'TCGdex xyp-XY177a (Karen, Supporter), lu le 2026-10-25'], references: ['https://api.tcgdex.net/v2/en/cards/xyp-XY177a', 'https://pkmncards.com/card/karen-xy-promos-xyp-xy177a/'] } },
        { idProduct: 571909, carteId: 39452, code: 'UNP', idExpansion: 4170, slugSet: 'Unnumbered-Promos', voie: 'impression-du-tirage', tirage: 'jp', expansionImpression: 'Unnumbered Promotional cards', numeroFiche: null, ajoutSet: false,
            preuve: { sources: ['Cardmarket (Entei [Bolt | Protective Flame], sans numéro)', 'TCGdex basep-34 (Poké-Power Bolt + attaque Protective Flame = carte 39452 ; la carte 24448 n\'a que Mega Flame), lu le 2026-10-25'], references: ['https://api.tcgdex.net/v2/en/cards/basep-34'] } },
        { idProduct: 449878, carteId: 225372, code: 'UPR', idExpansion: 2065, slugSet: 'Ultra-Prism', voie: 'impression-numero', tirage: 'intl', metacarteAbsenteDeLaCarte: true, numeroFiche: '153a', ajoutSet: false,
            preuve: { sources: ['Cardmarket (n°153a, slug Lusamine-V3-CIN153a)', 'pkmncards en_US-SM5-153a-lusamine (sitemap en cache pkmn_card-sitemap8.xml l.2650-2653, lastmod 2024-03-23)'], references: ['https://pkmncards.com/card/lusamine-ultra-prism-upr-153a/', 'https://pkmncards.com/wp-content/uploads/en_US-SM5-153a-lusamine_1st-yaa.jpg'] } },
        { idProduct: 449883, carteId: 225372, code: 'UPR', idExpansion: 2065, slugSet: 'Ultra-Prism', voie: 'impression-numero', tirage: 'intl', metacarteAbsenteDeLaCarte: true, numeroFiche: '153a', ajoutSet: false,
            preuve: { sources: ['Cardmarket (n°153a, slug Lusamine-V4-CIN153a)', 'pkmncards en_US-SM5-153a-lusamine (sitemap en cache pkmn_card-sitemap8.xml l.2650-2653, lastmod 2024-03-23)'], references: ['https://pkmncards.com/card/lusamine-ultra-prism-upr-153a/', 'https://pkmncards.com/wp-content/uploads/en_US-SM5-153a-lusamine_1st-yaa.jpg'] } },
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
    await preverifierLignes(db, lignes);        // D1 : une ligne détachée dans le lot fait lever le lot ENTIER, avant la première écriture
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

/**
 * L'APPARTENANCE AU SET (`cartes.sets`) — ARBITRAGE DU TESTEUR, RÈGLE R (regle-r-fiches.js, 2026-10-08) : « tout le reste BLOQUE ». Une carte ne rejoint un set que si
 * `juger(entree)` (= R.jugerRegleR, la règle de PRODUCTION, jamais une copie) l'autorise ; sinon sa LIGNE est écrite quand même, sans l'appartenance, et la cause est nommée.
 * @returns {{ ajouts: Map<number, Set<string>>, decisions: object[], autorisees: number, refusees: number, parCause: object }}
 */
function appartenances({ entrees, lignes, juger }) {
    const ajouts = new Map(), decisions = [], parCause = {};
    let autorisees = 0, refusees = 0;
    for (const e of entrees) {
        if (!e.ajoutSet || !lignes.some(l => l._id === `${e.carteId}|${e.idProduct}`)) continue;
        const j = juger(e);
        decisions.push({ idProduct: e.idProduct, carteId: e.carteId, code: e.code, slugSet: e.slugSet, autorise: !!j.autorise, regle: j.regle ?? null, cause: j.cause, raison: j.raison });
        if (j.autorise) { autorisees++; (ajouts.get(e.carteId) || ajouts.set(e.carteId, new Set()).get(e.carteId)).add(e.slugSet); }
        else { refusees++; parCause[j.cause] = (parCause[j.cause] || 0) + 1; }
    }
    return { ajouts, decisions, autorisees, refusees, parCause };
}

/**
 * LA RELECTURE APRÈS ÉCRITURE : les lignes, et sur `cartes` les `liens.idProduct`, `liens.idMetacards` et `sets` attendus, et le repère d'adresse
 * (`liens.idProduct[0]`) tel qu'il était avant. `repereAvant` : carteId → premier idProduct lu avant d'écrire.
 */
async function relire(db, lignes, metaDe, ajoutsSets, repereAvant) {
    const presentes = await db.collection('cartes_produits').countDocuments({ _id: { $in: lignes.map(l => l._id) } });
    const parCarte = new Map();
    for (const l of lignes) (parCarte.get(l.carteId) || parCarte.set(l.carteId, []).get(l.carteId)).push(l);
    let bonnes = 0; const reperesBouges = [], manques = [];
    for (const [id, ls] of parCarte) {
        const c = await db.collection('cartes').findOne({ _id: id }, { projection: { liens: 1, sets: 1 } });
        const ids = c?.liens?.idProduct || [], metas = c?.liens?.idMetacards || [], sets = c?.sets || [];
        const manque = [
            ...ls.filter(l => !ids.includes(l.idProduct)).map(l => `liens.idProduct ${l.idProduct}`),
            ...ls.filter(l => metaDe.get(l.idProduct) != null && !metas.includes(metaDe.get(l.idProduct))).map(l => `liens.idMetacards ${metaDe.get(l.idProduct)}`),
            ...(ajoutsSets.get(id) || []).filter(s => !sets.includes(s)).map(s => `sets ${s}`),
        ];
        if (repereAvant.has(id) && ids[0] !== repereAvant.get(id)) reperesBouges.push(id);
        if (manque.length) manques.push([id, manque]);
        if (!manque.length && !reperesBouges.includes(id)) bonnes++;
    }
    return { ok: presentes === lignes.length && bonnes === parCarte.size, lignes: `${presentes}/${lignes.length}`, cartes: `${bonnes}/${parCarte.size}`, reperesBouges, manques };
}

/** Les trois fonctions du site que la règle R lit (regle-r-fiches.js `chargerSite` les cherche à côté du dépôt ; ici le site vit sur le Bureau) — IMPORTÉES, jamais recopiées. */
async function siteDeR() {
    const { pathToFileURL } = require('url'), path = require('path');
    const lib = 'C:/Users/Yung/Desktop/rat-market-site/lib';
    const lireTs = f => import(pathToFileURL(path.join(lib, f)).href);
    const [e, i] = await Promise.all([lireTs('entreesDuSet.ts'), lireTs('imageDeLImpression.ts')]);
    const site = { tirageDuSet: e.tirageDuSet, expansionsDuSet: e.expansionsDuSet, normaliserNumero: i.normaliserNumero };
    for (const [k, f] of Object.entries(site)) if (typeof f !== 'function') throw new Error(`${k} absent de ${lib}`);
    return site;
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
async function simulerServis({ cartesDb, lecture, plan, entrees, ajoutsSets }) {
    const S = require('./collecte-cartes/simuler-servis');
    const regles = await S.reglesDuSite();
    const slugs = [...new Set(entrees.map(e => e.slugSet))];
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
    const AUTORISES = [/^--decision=[\d-]+$/, /^--attendu=\d+$/, /^--attendu-sets=\d+$/, /^--ecrire$/];
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
        // LA RÈGLE R DE PRODUCTION décide de chaque appartenance (importée : regle-r-fiches.js, lireBases/construireContexte/jugerRegleR)
        const { ligne: ligneDeTable } = require('./collecte-cartes/table-sets');
        const { lireMongo } = require('./collecte-cartes/lecture-sure');
        const ctxR = R.construireContexte(await R.lireBases(cartesDb, lireMongo), await siteDeR());
        const parId = new Map(lecture.cartes.map(c => [c._id, c]));
        const juger = e => {
            const lecturesExp = lecture.produits.get(e.idExpansion) || [];
            const p = lecturesExp.find(x => x.idProduct === e.idProduct);
            return R.jugerRegleR(ctxR, { L: ligneDeTable(e.code), p, X: parId.get(e.carteId), numDe: new Map(lecturesExp.map(x => [x.idProduct, x.numero])) });
        };
        const ap = appartenances({ entrees, lignes: plan.lignes, juger });
        for (const d of ap.decisions) log(`   ${d.autorise ? '✅ appartenance AUTORISÉE' : '⛔ appartenance REFUSÉE (la ligne s\'écrit quand même)'} · produit ${d.idProduct} carte ${d.carteId} → ${d.slugSet} · règle R ${d.regle ?? '—'} cause ${d.cause} : ${d.raison}`);
        log(`   APPARTENANCES : ${ap.autorisees} autorisée(s) par la règle R · ${ap.refusees} refusée(s) ${JSON.stringify(ap.parCause)} · (cartes.sets, $addToSet seulement ; liens.idProduct[0] et nomEn ne bougent pas)`);
        const ajoutsSets = new Map([...ap.ajouts].map(([c, s]) => [c, [...s]]));
        for (const s of await simulerServis({ cartesDb, lecture, plan, entrees, ajoutsSets })) log(`   SERVIS ${s.slug} : ${s.avant} → ${s.apres} sur ${s.produitsDuSet} lignes · gagnés ${JSON.stringify(s.gagnes)} · perdus ${JSON.stringify(s.perdus)} · lignes posées ${JSON.stringify(s.lignesPosees)}`);
        if (!ecrire) { log('   (simulation — lot-additif.js … -- node poser-fiches-prouvees.js --decision=… --attendu=N --ecrire)'); return 0; }
        const v = verifierAttendu(plan, arg('attendu') === undefined ? undefined : Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        if (arg('attendu-sets') === undefined || ap.autorisees !== Number(arg('attendu-sets'))) { err(`❌ ARRÊT : ${ap.autorisees} appartenance(s) autorisée(s) par la règle R, --attendu-sets=${arg('attendu-sets') ?? 'non donné'} — rien n'est écrit`); return 1; }
        const metaDe = new Map([...lecture.produits.values()].flat().map(p => [p.idProduct, p.idMetacard]));
        const repereAvant = new Map(plan.lignes.map(l => [l.carteId, parId.get(l.carteId)?.liens?.idProduct?.[0]]).filter(([, v]) => v !== undefined));
        const r = await ecrireFiches(cartesDb, plan.lignes, metaDe, ajoutsSets);
        const rl = await relire(cartesDb, plan.lignes, metaDe, ajoutsSets, repereAvant);
        const routees = await cartesDb.collection('cartes_produits').countDocuments({ _id: { $in: plan.lignes.map(l => l._id) }, preuve: 'fiche-prouvee', route: ROUTE });
        log(`\n   ✅ lignes posées ${r.lignes}/${plan.lignes.length} · cartes modifiées ${r.cartes} · relu : lignes ${rl.lignes} (dont à notre route ${routees}) · cartes (liens, métacartes, sets) ${rl.cartes} · repères d'adresse bougés ${JSON.stringify(rl.reperesBouges)}${rl.manques.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}`);
        return r.lignes === plan.lignes.length && rl.ok && routees === plan.lignes.length ? 0 : 1;
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

module.exports = { planifier, verifierAttendu, ecrireFiches, appartenances, relire, executer, DECISIONS, ROUTE };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    executer({ argv: process.argv.slice(2), ouvrirLecture, ouvrirEcriture: () => require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
