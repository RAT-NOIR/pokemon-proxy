// ============================================================
// POSER LE MARQUEUR DE CONFIRMATION PAR DEUX SOURCES SUR LES LIGNES DOUTEUSES (B1, 2026-10-26)
// ============================================================
//   node poser-confirmations.js --liste=<releves.json> --simuler                                     (lecture seule : plan + contrôle, RIEN n'est écrit)
//   node lot-additif.js --quoi="B1 : N confirmations par deux sources" --collections=cartes,cartes_produits -- node poser-confirmations.js --liste=<releves.json> --ecrire --attendu=N
//
// La liste (`--liste`) ne porte que des RELEVÉS : pour chaque produit, les concordantes et les refus que `juger` (collecte-cartes/deux-sources.js) a rendus lors d'un scan (scanner-deux-sources.js),
// avec la carte que la ligne désigne. L'outil ne la croit pas : à l'écriture il REJOUE, contre le produit et la ligne tels qu'ils sont EN BASE à cet instant,
//   · `juger` (production) sur ces relevés — deux sources, dont une indépendante de Cardmarket ET de Bulbapedia, qui concordent sur le set, le numéro et le nom ;
//   · aucune contradiction lisible d'une autre source (`confirmation.contradictions`) ;
//   · la ligne est LA ligne du produit (une seule, la carte des sources), sa preuve est FAIBLE (`set+nom` / `setlist+nom` : classement.js::PREUVES_NOM_SEUL), elle ne porte pas encore de confirmation ;
//   · la carte désignée porte le numéro (cleNumero de production) et le témoin du nom de `joindre()` (jointure.js::temoinDuNom) ne la contredit pas ni ne se tait.
// Un seul doute : le produit est REFUSÉ, nommé, et `--attendu` arrête tout. ADDITIF PUR : un `$set` du champ `confirmation` SEUL, sur une ligne qui n'en a pas (`confirmation: { $exists: false }`),
// jamais `preuve` ni un autre champ, jamais un upsert. Ni le site (SPEC_PRODUIT) ni l'API (PROJECTIONS.cartes_produits) ne lisent ce champ : seul l'audit le lit (audit-catalogue/etat-api.js).
const { juger } = require('./collecte-cartes/deux-sources');
const { cleNumero, decomposerNomCardmarket, temoinDuNom, clesNom, nomJointDe } = require('./collecte-cartes/jointure');
const { PREUVES_NOM_SEUL } = require('./audit-catalogue/classement');
const K = require('./collecte-cartes/confirmation');

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) ? Object.fromEntries(Object.keys(x).sort().map(c => [c, x[c]])) : x));
const sansConfirmation = l => { const { [K.CHAMP]: _, ...reste } = l || {}; return reste; };

// LISTE FERMÉE des cas génériques (décision du testeur 26/10), écrite par ce qu'elle AUTORISE.
const TYPES_ENERGIE = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy'];
const ENERGIES_DE_BASE = new Set(TYPES_ENERGIE.flatMap(t => clesNom(`${t} Energy`)));
const TIRAGES_CHINOIS = ['zh-hans', 'zh-hant'];
/** @returns {'energie-de-base'|'promo-chinoise-jointure-virtuelle'|null} — appelée seulement quand la carte n'a pas d'impression du set au numéro. */
function casGenerique(carte, set) {
    // (a) énergie de base : la carte jointe est « <Type> Energy » (clesNom de production), types énumérés
    if (clesNom(nomJointDe(carte)).some(k => ENERGIES_DE_BASE.has(k))) return 'energie-de-base';
    // (b) promo chinoise à jointure VIRTUELLE (§42) : le set est d'un tirage chinois lu en base, et la carte n'a AUCUNE impression de ce tirage (la jointure vit dans cartes_produits)
    if (set && TIRAGES_CHINOIS.includes(set.tirage) && !(carte.impressions || []).some(i => i && i.tirage === set.tirage)) return 'promo-chinoise-jointure-virtuelle';
    return null;
}

/**
 * @param {{ entrees: Array<{idProduct:number, carteId:number, concordantes:object[], refusees?:object[]}>,
 *           lecture: { lignes: Map<number, object[]>, produits: Map<number, {idProduct, idExpansion?, set, numero, name}>, cartes: Map<number, object>, cartesDuSet: (slug:string) => object[] },
 *           le?: Date }} e
 * @returns {{ ecrire: Array<{_id, carteId, idProduct, confirmation}>, refus: Array<{idProduct, raison}>, deja: Array<{_id}> }}
 */
function planifier({ entrees, lecture, le = new Date() }) {
    const ecrire = [], refus = [], deja = [];
    for (const e of entrees) {
        const no = raison => { refus.push({ idProduct: e.idProduct, raison }); };
        const p = lecture.produits.get(e.idProduct);
        if (!p) { no(`produit ${e.idProduct} absent du catalogue`); continue; }
        if (p.set == null || String(p.set).trim() === '') { no(`produit ${e.idProduct} : set Cardmarket appris absent — je ne peux pas conclure`); continue; }
        if (p.numero == null || String(p.numero).trim() === '') { no(`produit ${e.idProduct} : numéro Cardmarket appris absent — rien à confirmer`); continue; }
        const lignes = lecture.lignes.get(e.idProduct) || [];
        if (!lignes.length) { no(`produit ${e.idProduct} : aucune ligne cartes_produits`); continue; }
        if (lignes.length !== 1) { no(`produit ${e.idProduct} : ${lignes.length} lignes (${lignes.map(l => l.carteId).join(', ')}) — une confirmation ne se pose que sur la ligne unique du produit`); continue; }
        const ligne = lignes[0];
        if (ligne.carteId !== e.carteId) { no(`la ligne du produit désigne la carte ${ligne.carteId}, les sources la carte ${e.carteId}`); continue; }
        if (!PREUVES_NOM_SEUL.includes(ligne.preuve)) { no(`preuve de la ligne « ${ligne.preuve ?? 'absente'} » : pas une preuve faible (${PREUVES_NOM_SEUL.join(', ')}) — rien à lever`); continue; }
        const dn = decomposerNomCardmarket(p.name);
        const produit = { set: p.set, numero: String(p.numero), nom: dn.nom };
        // les deux sources, REJOUÉES par la règle de production sur les relevés (jamais un `ok` lu dans un fichier)
        const j = juger(produit, e.concordantes || []);
        if (!j.ok) { no(`les deux sources ne concordent plus sur (${produit.set}, n°${produit.numero}, « ${produit.nom} ») : ${j.raison} ${j.refusees.map(r => r.raison).join(' ; ')}`.trim()); continue; }
        const contr = K.contradictions(e.refusees);
        if (contr.length) { no(`contradiction entre sources : ${contr.map(c => `${c.source} ${c.raison}`).join(' ; ')}`); continue; }
        // la ligne désigne bien la carte : le numéro (cleNumero) sur la carte, puis le témoin du nom
        const carte = lecture.cartes.get(e.carteId);
        if (!carte) { no(`carte ${e.carteId} absente de la base`); continue; }
        if (!carte.nomEn) { no(`carte ${e.carteId} sans nom : le témoin du nom est muet, je ne conclus pas`); continue; }
        // I1 : le NOM de la carte est celui du produit (clés de nom de production, « Basic Water Energy » = « Water Energy ») : le témoin du nom ne dit que « une autre carte le porte mieux »
        const kc = clesNom(nomJointDe(carte)), kp = clesNom(dn.nom);
        if (!kp.some(k => kc.includes(k))) { no(`le nom de la carte ${e.carteId} « ${carte.nomEn} » n'est pas celui du produit « ${dn.nom} » — la ligne ne désigne pas la carte des sources`); continue; }
        // I2 : le numéro est celui d'une impression de CE set (expansion du set de la ligne) ; une énergie de base générique sans impression dans le set est refusée (aucune règle de production ne la traite)
        const cle = cleNumero(produit.numero);
        const expSet = [].concat(lecture.sets?.get(p.set)?.bulba?.expansion ?? []).filter(Boolean);
        let generique;
        if (!expSet.length || !(carte.impressions || []).some(i => i && i.numero != null && cleNumero(String(i.numero)) === cle && expSet.includes(i.expansion))) {
            // décision du testeur (26/10) : liste FERMÉE de deux cas où l'absence de marque de set est la réalité du visuel ; tout le reste reste refusé
            generique = casGenerique(carte, lecture.sets?.get(p.set));
            // une énergie de base générique garde le contrôle faible d'avant (la carte porte CE numéro, dans un set quelconque) : sans lui, 3 énergies sans numéro (279093, 525175, 279094) restent refusées (consigne du testeur)
            if (generique === 'energie-de-base' && !(carte.impressions || []).some(i => i && i.numero != null && cleNumero(String(i.numero)) === cle)) { no(`sans-numero : la carte ${e.carteId} (énergie de base) ne porte aucune impression au numéro ${produit.numero} — la ligne ne désigne pas la carte des sources`); continue; }
            if (!generique) { no(`carte-sans-impression-du-set : la carte ${e.carteId} ne porte aucune impression de « ${expSet.join(' / ') || 'set sans nom d\'expansion'} » au numéro ${produit.numero} — la ligne ne désigne pas la carte des sources`); continue; }
        }
        const autres = temoinDuNom(lecture.cartesDuSet(p.set), p.idExpansion ?? null)(carte, { nom: dn.nom, attaques: dn.attaques });
        if (autres) { no(`le témoin du nom contredit la carte ${e.carteId} « ${carte.nomEn} » pour « ${dn.nom} » : ${autres.slice(0, 3).map(c => `${c._id} « ${c.nomEn} »`).join(', ')}`); continue; }
        const confirmation = K.construire({ carteId: e.carteId, produit, concordantes: j.concordantes, le, ...(generique ? { generique } : {}) });
        // cohérence finale : ce qu'on va écrire est valide contre la ligne telle qu'elle est (la même fonction que l'audit rejouera)
        const v = K.confirmationConcorde(confirmation, { ligne, produit });
        if (!v.ok) { no(`la confirmation construite ne concorde pas avec la ligne : ${v.motifs.join(' ; ')}`); continue; }
        if (ligne[K.CHAMP] !== undefined && ligne[K.CHAMP] !== null) {
            const meme = K.confirmationConcorde(ligne[K.CHAMP], { ligne, produit }).ok;
            if (meme) deja.push({ _id: ligne._id }); else no(`la ligne porte déjà une confirmation qui ne concorde plus — on n'écrase jamais une valeur (à traiter à la main)`);
            continue;
        }
        ecrire.push({ _id: ligne._id, carteId: e.carteId, idProduct: e.idProduct, preuve: ligne.preuve, confirmation });
    }
    return { ecrire, refus, deja };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.ecrire.length !== attendu) return { ok: false, raison: `le plan compte ${plan.ecrire.length} confirmation(s), attendu ${attendu}` };
    return { ok: true };
}

/** Un `$set` de `confirmation` seul, par _id, uniquement là où elle n'existe pas. Jamais d'upsert. */
async function ecrireConfirmations(db, lignes) {
    let posees = 0;
    for (const l of lignes) {
        const r = await db.collection('cartes_produits').updateOne({ _id: l._id, carteId: l.carteId, preuve: l.preuve, [K.CHAMP]: { $exists: false } }, { $set: { [K.CHAMP]: l.confirmation } });
        posees += r.modifiedCount || 0;
    }
    return { posees };
}

/** La relecture : la confirmation est là, identique, et AUCUN autre champ de la ligne n'a bougé. `avant` : les lignes lues avant d'écrire. */
async function relire(db, lignes, avant) {
    const ids = lignes.map(l => l._id);
    const apres = await db.collection('cartes_produits').find({ _id: { $in: ids } }).toArray();
    const parId = new Map(apres.map(d => [d._id, d])), avantId = new Map(avant.map(d => [d._id, d]));
    const manques = [], alteres = [];
    for (const l of lignes) {
        const d = parId.get(l._id);
        if (!d || !d[K.CHAMP] || stable(d[K.CHAMP]) !== stable(l.confirmation)) { manques.push(l._id); continue; }
        if (stable(sansConfirmation(d)) !== stable(sansConfirmation(avantId.get(l._id)))) alteres.push(l._id);
    }
    return { ok: !manques.length && !alteres.length && apres.length === ids.length, presentes: `${ids.length - manques.length}/${ids.length}`, manques, alteres };
}

async function lire({ cartesDb, prodDb, entrees }) {
    const { lireMongo } = require('./collecte-cartes/lecture-sure');
    const ids = entrees.map(e => e.idProduct), carteIds = [...new Set(entrees.map(e => e.carteId))];
    const lignesBrutes = await lireMongo(cartesDb.collection('cartes_produits'), { idProduct: { $in: ids } }, { nom: 'cartes_produits', videAutorise: 'les produits listés peuvent tous avoir perdu leur ligne : le plan les refuse un par un, nommés' });
    const lignes = new Map();
    for (const l of lignesBrutes) (lignes.get(l.idProduct) || lignes.set(l.idProduct, []).get(l.idProduct)).push(l);
    const cat = await lireMongo(prodDb.collection('catalogue_produits'), { idProduct: { $in: ids } }, { nom: 'catalogue_produits', projection: { _id: 0, idProduct: 1, name: 1, idExpansion: 1 } });
    const nc = await lireMongo(prodDb.collection('numeros_cartes'), { idProduct: { $in: ids } }, { nom: 'numeros_cartes', videAutorise: 'un produit jamais appris n\'a pas de ligne : le plan le refuse, nommé', projection: { _id: 0, idProduct: 1, slugSet: 1, numero: 1 } });
    const ncDe = new Map(nc.map(n => [n.idProduct, n]));
    const produits = new Map(cat.map(c => [c.idProduct, { idProduct: c.idProduct, idExpansion: c.idExpansion, name: c.name, set: ncDe.get(c.idProduct)?.slugSet ?? null, numero: ncDe.get(c.idProduct)?.numero ?? null }]));
    const proj = { nomEn: 1, niveau: 1, 'attaques.nom': 1, 'impressions.numero': 1, 'impressions.expansion': 1, 'impressions.tirage': 1, sets: 1 };
    const cartesLues = await lireMongo(cartesDb.collection('cartes'), { _id: { $in: carteIds } }, { nom: 'cartes', projection: proj, videAutorise: 'les cartes listées ont pu disparaître : le plan les refuse, nommées' });
    const cartes = new Map(cartesLues.map(c => [c._id, c]));
    const parSet = new Map();
    for (const slug of new Set([...produits.values()].map(p => p.set).filter(Boolean)))
        parSet.set(slug, await lireMongo(cartesDb.collection('cartes'), { sets: slug }, { nom: 'cartes', projection: proj, videAutorise: `le set ${slug} peut n'avoir aucune carte` }));
    const slugs = [...parSet.keys()];
    const setsLus = slugs.length ? await lireMongo(cartesDb.collection('sets'), { _id: { $in: slugs } }, { nom: 'sets', projection: { 'bulba.expansion': 1, tirage: 1 }, videAutorise: 'aucun des sets des produits listés n\'existe : le plan refuse chaque produit, nommé' }) : [];
    const sets = new Map(setsLus.map(x => [x._id, x]));
    return { lignes, produits, cartes, sets, cartesDuSet: slug => parSet.get(slug) || [], lignesBrutes };
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, lireListe, log = console.log, err = console.error, garde }) {
    const AUTORISES = [/^--liste=.+\.json$/, /^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire'), simuler = argv.includes('--simuler');
    if (inconnus.length || !arg('liste') || ecrire === simuler) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --liste=<releves.json> (--simuler | --ecrire --attendu=N), l'un des deux exactement`); return 2; }
    if (ecrire) {
        garde();   // --ecrire hors de lot-additif.js : refusé avant toute connexion
        if (arg('attendu') === undefined) { err('❌ ARRÊT : --attendu=N obligatoire pour écrire — rien n\'est écrit'); return 1; }
    }
    const entrees = lireListe(arg('liste'));
    if (!Array.isArray(entrees) || !entrees.length) { err('❌ liste vide ou illisible : une simulation sur du vide ne mesure rien'); return 2; }
    const cx = ecrire ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const cartesDb = cx.cartes.db, prodDb = cx.prod.db;
        const lecture = await lire({ cartesDb, prodDb, entrees });
        const plan = planifier({ entrees, lecture });
        log(`   LISTE : ${entrees.length} produit(s) · lignes lues ${lecture.lignesBrutes.length}`);
        for (const l of plan.ecrire) log(`   + ${l._id} (carte ${l.carteId}) sources ${l.confirmation.sources.join(' + ')} · n°${l.confirmation.valeurs.numero} « ${l.confirmation.valeurs.nom} » (${l.confirmation.valeurs.set})`);
        for (const r of plan.refus) log(`   - REFUS ${r.idProduct} : ${r.raison}`);
        for (const d of plan.deja) log(`   = déjà confirmée ${d._id} : jamais réécrite`);
        log(`\n   PLAN : ${plan.ecrire.length} confirmation(s) à poser · ${plan.refus.length} refus · ${plan.deja.length} déjà`);
        if (!ecrire) { log('   (simulation — rien n\'est écrit ; pour écrire : lot-additif.js … -- node poser-confirmations.js --liste=… --ecrire --attendu=N)'); return 0; }
        const v = verifierAttendu(plan, Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const avant = plan.ecrire.map(l => (lecture.lignes.get(l.idProduct) || [])[0]);
        const r = await ecrireConfirmations(cartesDb, plan.ecrire);
        const rl = await relire(cartesDb, plan.ecrire, avant);
        log(`\n   ${r.posees === plan.ecrire.length && rl.ok ? '✅' : '❌'} confirmations posées ${r.posees}/${plan.ecrire.length} · relu : ${rl.presentes}${rl.manques.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}${rl.alteres.length ? ` · AUTRES CHAMPS BOUGÉS ${JSON.stringify(rl.alteres)}` : ''}`);
        return r.posees === plan.ecrire.length && rl.ok ? 0 : 1;
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

module.exports = { casGenerique, planifier, verifierAttendu, ecrireConfirmations, relire, lire, executer };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    const fs = require('fs');
    executer({ argv: process.argv.slice(2), ouvrirLecture, ouvrirEcriture: () => require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }),
        lireListe: f => JSON.parse(fs.readFileSync(f, 'utf8')), garde: () => require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
