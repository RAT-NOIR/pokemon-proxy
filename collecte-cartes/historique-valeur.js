// ============================================================================
// L'HISTORIQUE DE VALEUR DES SETS — décision du testeur, 2026-10-08 : « À chaque import du guide, enregistre un instantané par set : date, valeur
// totale (somme des tendances Cardmarket), carte phare et son prix. L'historique par carte va dans des fichiers sur R2, pas dans Mongo. »
// ============================================================================
// DÉFINITION (écrite ici, relue par les bancs) :
//  · UN SET = un document `sets` de la base `cartes` qui porte un `nomAffichage` (les sets PUBLIÉS) ; ses produits sont ceux du catalogue
//    (`catalogue_produits`, base de production) dont l'`idExpansion` est dans `set.idExpansion`, HORS cartes-code (`estCarteCode`, jointure.js :
//    la définition unique, celle de mesure-catalogue.js) — `produits` = leur nombre.
//  · UNE TENDANCE = le champ `trend` du guide des prix, nombre fini STRICTEMENT positif (0 = pas de prix), sur une ligne de `guide_prix` dont
//    `guideDu` est celui du dernier guide : un produit absent du dernier guide garde son prix daté (import-price-guide.js), ce prix périmé
//    n'est PAS dans la somme. Un produit sans tendance est exclu de la somme ET compté : `produitsValorises` sur `produits`.
//  · valeur = somme des tendances, calculée en centimes entiers ; carte phare = la tendance la plus haute, égalité → le plus petit idProduct.
//  · LA DATE est celle du GUIDE (`guide_prix_meta.guideDu`, jour UTC), jamais l'heure de l'import. Clé d'une ligne : `<slug du set>|<AAAA-MM-JJ>`.
// OÙ ÇA S'ÉCRIT : lignes dans `cartes.histo_valeur_sets` (grappe `cartes`, jamais la production) ; historique par carte dans
// `historique-prix/AAAA-MM-JJ.json.gz` du bucket PRIVÉ (R2_BUCKET_BRUT), un fichier par guide : { guideDu, tendances: { idProduct: trend } }.
// IDEMPOTENT : une ligne est un upsert sur sa clé, un fichier déjà présent n'est pas réécrit ; un guide déjà historisé ne fait rien.
// Une lecture qui ne peut pas conclure (méta absente, aucun set publié, aucun produit, aucune ligne au guide) LÈVE : un zéro fabriqué ne s'écrit pas.
const zlib = require('zlib');
const { estCarteCode } = require('./jointure');

const COLLECTION = 'histo_valeur_sets';
const prefixe = jour => `historique-prix/${jour}.json.gz`;
const tendanceValide = t => typeof t === 'number' && Number.isFinite(t) && t > 0;

/** Pure. Une ligne par set : valeur, produits, produitsValorises, phare. `tendances` : Map idProduct -> trend (valides seulement). */
function calculerInstantanes({ sets, produits, tendances, jour, guideDu }) {
    const parExp = new Map();
    for (const p of produits) { if (estCarteCode(p.name)) continue; (parExp.get(p.idExpansion) || parExp.set(p.idExpansion, []).get(p.idExpansion)).push(p); }
    return sets.map(s => {
        const vus = new Map();   // un idProduct n'est compté qu'une fois par set
        for (const e of s.idExpansion || []) for (const p of parExp.get(e) || []) vus.set(p.idProduct, p);
        let centimes = 0, valorises = 0, phare = null;
        for (const p of [...vus.values()].sort((a, b) => a.idProduct - b.idProduct)) {
            const t = tendances.get(p.idProduct);
            if (!tendanceValide(t)) continue;
            centimes += Math.round(t * 100); valorises++;
            if (!phare || t > phare.prix) phare = { idProduct: p.idProduct, nom: p.name, prix: t };   // ordre croissant d'idProduct : l'égalité garde le plus petit
        }
        return { _id: `${s._id}|${jour}`, set: s._id, jour, guideDu, valeur: centimes / 100, produits: vus.size, produitsValorises: valorises, phare };
    });
}

/** Pure. Le fichier du jour (gzip) : idProduct -> tendance. */
function fichierDuJour(tendances, guideDu) {
    const obj = {}; for (const [id, t] of [...tendances].sort((a, b) => a[0] - b[0])) obj[id] = t;
    return zlib.gzipSync(Buffer.from(JSON.stringify({ guideDu: guideDu.toISOString(), tendances: obj })));
}

/** Lit tout ce qu'il faut (lecture seule) et calcule. Lève si la lecture ne peut pas conclure. */
async function preparer({ prod, cartes }) {
    const meta = await prod.collection('guide_prix_meta').findOne({ _id: 'dernier' });
    const guideDu = meta?.guideDu;
    if (!(guideDu instanceof Date) || Number.isNaN(guideDu.getTime())) throw new Error('guide_prix_meta absente ou sans guideDu : je ne sais pas de quel guide il s\'agit');
    const jour = guideDu.toISOString().slice(0, 10);
    const sets = await cartes.collection('sets').find({ nomAffichage: { $type: 'string' } }, { projection: { idExpansion: 1 } }).toArray();
    if (!sets.length) throw new Error('aucun set publié (nomAffichage) dans cartes.sets : rien à historiser');
    const exps = [...new Set(sets.flatMap(s => s.idExpansion || []))];
    const produits = await prod.collection('catalogue_produits').find({ idExpansion: { $in: exps } }, { projection: { idProduct: 1, idExpansion: 1, name: 1 } }).toArray();
    if (!produits.length) throw new Error(`aucun produit au catalogue pour ${exps.length} expansions de sets publiés : lecture vide, rien n'est écrit`);
    const tendances = new Map();
    let lignesDuGuide = 0;
    for await (const g of prod.collection('guide_prix').find({ guideDu }, { projection: { idProduct: 1, trend: 1 } })) { lignesDuGuide++; if (tendanceValide(g.trend)) tendances.set(g.idProduct, g.trend); }
    if (!lignesDuGuide) throw new Error(`aucune ligne de guide_prix au guide du ${guideDu.toISOString()} : rien n'est écrit`);
    // le nom de la carte phare vient du catalogue : on ne le projette que pour les produits retenus (calculerInstantanes)
    return { guideDu, jour, lignes: calculerInstantanes({ sets, produits, tendances, jour, guideDu }), tendances, lignesDuGuide, produits: produits.length };
}

/**
 * L'unique entrée : historise le DERNIER guide en base. Idempotente. Rend { statut: 'ecrit' | 'deja-historise', jour, lignes, fichier }. Lève sur toute erreur
 * (l'import du guide appelle `historiserSansEchec`). `ecrire: false` = simulation : lit et calcule, n'écrit ni ligne ni fichier.
 */
async function historiserGuide({ prod, cartes, r2, bucket, journal = console, ecrire = true }) {
    const P = await preparer({ prod, cartes });
    const cle = prefixe(P.jour);
    const H = cartes.collection(COLLECTION);
    const dejaLignes = await H.countDocuments({ jour: P.jour });
    const dejaFichier = await r2.existe(bucket, cle);
    const buf = fichierDuJour(P.tendances, P.guideDu);
    const resume = { jour: P.jour, lignes: P.lignes.length, fichier: { cle, octets: buf.length, tendances: P.tendances.size, dejaPresent: dejaFichier }, dejaLignes };
    if (!ecrire) return { statut: 'simulation', ...resume, aEcrire: P.lignes };
    if (dejaLignes >= P.lignes.length && dejaFichier) { journal.log(`ℹ️ historique de valeur : le guide du ${P.jour} est déjà historisé (${dejaLignes} lignes, fichier présent) — rien écrit`); return { statut: 'deja-historise', ...resume }; }
    if (!dejaFichier) await r2.deposerBinaire(bucket, cle, buf, 'application/gzip');
    if (dejaLignes < P.lignes.length) await H.bulkWrite(P.lignes.map(l => ({ replaceOne: { filter: { _id: l._id }, replacement: l, upsert: true } })), { ordered: false });
    journal.log(`✅ historique de valeur : guide du ${P.jour} — ${P.lignes.length} lignes ${COLLECTION}${dejaFichier ? '' : `, fichier ${cle} (${(buf.length / 1024).toFixed(0)} Ko, ${P.tendances.size} tendances)`}`);
    return { statut: 'ecrit', ...resume };
}

/** Pour l'import du guide : NE LÈVE JAMAIS. Un échec de l'historique ne fait pas échouer l'import ; il se journalise (la reprise du lendemain, ou de la commande, complète). */
async function historiserSansEchec(args) {
    try { return await historiserGuide(args); }
    catch (e) {
        const msg = String(e?.message || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 300);
        try { (args.journal || console).error(`⚠️ historique de valeur NON écrit (l'import du guide, lui, a réussi) : ${msg}`); } catch (_) { /* le journal ne doit pas non plus lever */ }
        return { statut: 'echec', erreur: msg };
    }
}

/**
 * Le crochet de l'import quotidien du guide : ouvre ses propres connexions (production en LECTURE, `cartes` en écriture), historise, referme. NE LÈVE JAMAIS.
 * À n'appeler qu'après un import RÉUSSI (code 0 de import-price-guide.js) : un « rien de neuf » sort avant et n'arrive jamais ici.
 */
async function historiserApresImport({ base, baseCartes = 'cartes', env = process.env, mongoose, r2, journal = console }) {
    let cxProd = null, cxCartes = null;
    try {
        if (!env.MONGODB_URI || !env.MONGODB_CARTES_URI || !env.R2_BUCKET_BRUT) throw new Error(`variable absente : ${['MONGODB_URI', 'MONGODB_CARTES_URI', 'R2_BUCKET_BRUT'].filter(v => !env[v]).join(', ')}`);
        cxProd = await mongoose.createConnection(env.MONGODB_URI, { dbName: base }).asPromise();
        cxCartes = await mongoose.createConnection(env.MONGODB_CARTES_URI, { dbName: baseCartes }).asPromise();
        if (cxCartes.db.databaseName !== baseCartes) throw new Error(`base connectée « ${cxCartes.db.databaseName} », attendue « ${baseCartes} »`);
        return await historiserSansEchec({ prod: cxProd.db, cartes: cxCartes.db, r2, bucket: env.R2_BUCKET_BRUT, journal });
    } catch (e) {
        const msg = String(e?.message || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 300);
        try { journal.error(`⚠️ historique de valeur NON écrit (l'import du guide, lui, a réussi) : ${msg}`); } catch (_) { /* rien */ }
        return { statut: 'echec', erreur: msg };
    } finally {
        await Promise.allSettled([cxProd?.close(), cxCartes?.close()]);
    }
}

module.exports = { historiserApresImport, COLLECTION, prefixe, tendanceValide, calculerInstantanes, fichierDuJour, preparer, historiserGuide, historiserSansEchec };
