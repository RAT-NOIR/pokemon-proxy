'use strict';
// Ma collection — le stockage COMPACT (COLLECTION-COMPACTE). Deux collections de la base de l'API :
//   · `collection_registre` : un document par SET, { _id: slug, cles: [idInterne|numero…] }. La POSITION d'une clé est son indice dans `cles`. AJOUT SEULEMENT : jamais de retrait, de
//     réordonnancement ni de réutilisation d'une case, même pour une fiche que le catalogue a retirée — un bit qui glisserait d'une case montrerait au client une carte qu'il n'a pas (une ERREUR, pas
//     un trou). L'ajout est ATOMIQUE et UNIQUE (`$push` filtré sur `cles: { $ne: cle }`, relecture de l'indice) ; le registre ne porte aucun compte, ni date, ni IP.
//     Une clé n'y entre que si le catalogue EN MÉMOIRE (v2/chargeur) la connaît pour CE set : personne ne peut remplir le registre d'un set avec des clés inventées (ce qui bloquerait les autres comptes).
//   · `collection_fiches` : un document par (compte, set), { compteId, set, mots, hors, qte, majLe }. `mots` est le bitmap des positions du registre, en mots de 64 bits, un OBJET { indiceDuMot: Long } :
//     `$bit` (`or` pour cocher, `and` pour décocher) est atomique, idempotent, crée le mot absent et ne demande aucune prolongation préalable — un tableau de mots, lui, se prolonge avant l'écriture
//     (« lire, prolonger, écrire » : une course) et `$bit` sur un `null` de remplissage échoue. `hors` : les clés que le registre n'a pas (une fiche sans produit, un set absent du catalogue, aucun catalogue
//     chargé) ; `qte` : { position: n } pour une clé du registre à n ≥ 2 ; une clé `hors` à n ≥ 2 porte sa quantité à côté d'elle (« cle\nN » : le saut de ligne ne peut pas figurer dans une clé).
//   · UNE CLÉ NE VIT QU'À UN ENDROIT pour un compte : une clé déjà dans `hors` y reste (pas de migration), cocher une clé déjà cochée ne change rien, décocher la retire des deux endroits ; la lecture rend
//     l'union triée sans doublon et `possedees` = bits à 1 + longueur de `hors`.
// BORNES (cfg.collection) : clés par COMPTE (bits + hors), clés HORS catalogue par compte, sets par compte : jugées AVANT l'écriture. Deux écritures simultanées d'un même compte peuvent donc passer ensemble
//   le contrôle : le dépassement est BORNÉ par le nombre d'écritures en vol (au plus le limiteur d'écriture, 1 000 par heure, chacune ajoutant une seule clé) ; l'écriture suivante voit le vrai total.
// BUDGET EN OCTETS (plafond du SERVICE, tous comptes confondus, registre compris) : un compteur UNIQUE { cle: 'collection-octets', n }. Une écriture RÉSERVE AVANT d'écrire, d'un seul `$inc` CONDITIONNEL
//   (`n + coût ≤ plafond`), le coût au PIRE du modèle mesuré (couts.js) ; le surplus est rendu quand l'écriture n'a rien ajouté. Retrait réel, document vidé supprimé et suppression de compte rendent ce qu'ils
//   ont RÉELLEMENT retiré (le modèle de ce qui était stocké). Au montage le compteur est RECOMPTÉ depuis `collStats` (`size` + `totalIndexSize`) des DEUX collections ; un recompte qui échoue FERME les
//   écritures (503) et se rejoue à l'écriture suivante ; un compteur ABSENT les ferme aussi (seul le recompte le crée) ; il ne descend jamais sous 0. Toute dérive possible va vers le HAUT (fermeture).
// Le stockage ne juge pas si une clé désigne une fiche réelle autrement que par l'appartenance au catalogue chargé : la forme est jugée à la porte (forme.js).
const crypto = require('crypto');
const { Long } = require('mongoose').mongo;
const { col, base } = require('../db');
const etat = require('../chargeur/etat');
const C = require('./couts');
const NOM = 'collection_fiches', REGISTRE = 'collection_registre', COMPTEURS = 'compteurs', CLE_TOTAL = 'collection-octets';
const LECTURE = { promoteLongs: false };                       // les mots sont des Long : jamais promus en nombre (un entier de 64 bits ne tient pas dans un Number)
const PROJ = { set: 1, mots: 1, hors: 1, qte: 1, epoque: 1 };
const REESSAI_CATALOGUE_S = 5;                                  // « le catalogue n'est pas chargé » : le chargement vient en quelques secondes, le site réessaie

// ── les bits
const masque = b => (b < 32 ? Long.fromBits(1 << b, 0) : Long.fromBits(0, 1 << (b - 32)));
const inverse = b => { const m = masque(b); return Long.fromBits(~m.low, ~m.high); };
const enBigInt = x => (x === undefined || x === null ? 0n : typeof x === 'bigint' ? x : typeof x === 'number' ? BigInt.asUintN(64, BigInt(x)) : BigInt.asUintN(64, x.toBigInt()));
const popcount = x => { let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
const nbBits = mots => Object.values(mots || {}).reduce((n, w) => n + popcount(enBigInt(w)), 0);
const bitPose = (doc, p) => Boolean(doc && doc.mots && (enBigInt(doc.mots[Math.floor(p / 64)]) >> BigInt(p % 64)) & 1n);
const positionsPosees = mots => {
    const out = [];
    for (const [i, w] of Object.entries(mots || {})) { const x = enBigInt(w); for (let b = 0; b < 64; b++) if ((x >> BigInt(b)) & 1n) out.push(Number(i) * 64 + b); }
    return out.sort((a, b) => a - b);
};
const nbCoches = doc => nbBits(doc.mots) + (doc.hors ? doc.hors.length : 0);
const quantiteBit = (doc, p) => (doc.qte && doc.qte[p] >= 2 ? doc.qte[p] : 1);
const indexHors = (hors, cle) => (hors || []).findIndex(e => C.lireElementHors(e).cle === cle);

// ── le catalogue chargé (EN MÉMOIRE, COTES-VISUELS) : la clé est-elle connue de CE set ? Un cache borné par version (la version est gelée et remplacée d'un geste).
const CACHE_SETS = 16;
const caches = new WeakMap();
/** true : le catalogue chargé connaît la clé pour ce set ; false : un catalogue CHARGÉ ne la connaît pas (une fiche sans produit) ; null : on ne sait pas (aucun catalogue, ou un catalogue qui lève). */
function connue(slug, cle) {
    let v; try { v = etat.version(); } catch (e) { return null; }
    if (!v) return null;                                                       // aucun catalogue chargé : une clé neuve ne s'écrit nulle part (jamais rangée dans `hors` par accident)
    try {
        let m = caches.get(v); if (!m) { m = new Map(); caches.set(v, m); }
        let s = m.get(slug);
        if (!s) { s = new Set(v.fichesDuSet(slug).map(f => f.cle)); if (m.size >= CACHE_SETS) m.delete(m.keys().next().value); m.set(slug, s); }
        return s.has(cle);
    } catch (e) { return null; }                                               // un catalogue qui lève n'est pas un catalogue qui connaît : « je ne sais pas » n'est jamais « inconnue »
}

// ── le compteur global (en OCTETS)
async function reserver(cfg, cout) {
    const filtre = { cle: CLE_TOTAL, n: { $lte: cfg.collection.octetsService - cout } };
    if ((await col(COMPTEURS).findOneAndUpdate(filtre, { $inc: { n: cout } })) !== null) return true;           // JAMAIS d'upsert : seul le recompte crée le compteur
    if (!(await col(COMPTEURS).findOne({ cle: CLE_TOTAL }, { projection: { _id: 1 } }))) { initialisation = null; throw new Error('compteur-absent'); }   // ABSENT : cette écriture ferme (503) et la suivante rejoue le recompte, seul à créer le compteur
    return false;                                                                                            // présent : le plafond est atteint
}
async function rendre(k) {
    if (k > 0) await col(COMPTEURS).updateOne({ cle: CLE_TOTAL }, [{ $set: { n: { $max: [0, { $subtract: ['$n', k] }] } } }]);
}
async function forcer(k) {                                                    // un coût réel PLUS GRAND que la réservation (un concurrent a supprimé le document entre la lecture et l'écriture) : on le compte quand même
    if (k > 0) await col(COMPTEURS).updateOne({ cle: CLE_TOTAL }, { $inc: { n: k } });
}
async function octetsDe(nom) {
    try { const st = await base().command({ collStats: col(nom).collectionName }); return Number(st.size) + Number(st.totalIndexSize); }
    catch (e) { if (e && (e.code === 26 || e.codeName === 'NamespaceNotFound')) return 0; throw e; }      // une collection pas encore créée pèse 0 ; toute autre erreur FERME les écritures
}
/** Recompte depuis `collStats` des DEUX collections (le registre est partagé mais il occupe la grappe : il se compte). Corrige un compteur faux, vers le haut comme vers le bas, ou absent. Rend le total. */
async function recompter(cfg) {
    const n = (await octetsDe(NOM)) + (await octetsDe(REGISTRE));
    await col(COMPTEURS).updateOne({ cle: CLE_TOTAL }, { $set: { n } }, { upsert: true });
    return n;
}
let initialisation = null;
/** Lancé au MONTAGE du lot. Un échec (base pas encore prête) n'est pas définitif : la première écriture le rejoue. */
function initialiser(cfg) {
    initialisation = recompter(cfg).catch(e => { initialisation = null; throw e; });
    dernierRecompte = initialisation;
    return initialisation;
}
// B2b tour 2 : la promesse du DERNIER recompte lancé (réussi, en cours ou en échec), exposée aux bancs par `monter.pret` — jamais attendue en production (le démarrage de l'API n'attend pas le recompte ; la première
// écriture le rejoue en cas d'échec). `avecDelai` : une attente qui expire LÈVE, un échec remonte (aucune sortie silencieuse).
let dernierRecompte = null;
function avecDelai(promesse, ms, nom) {
    let minuteur; const expire = new Promise((_, ko) => { minuteur = setTimeout(() => ko(new Error(`${nom} : pas abouti en ${ms} ms`)), ms); });
    return Promise.race([promesse, expire]).finally(() => clearTimeout(minuteur));
}
const attendreInitialisation = (ms = 30000) => (dernierRecompte ? avecDelai(dernierRecompte, ms, 'recompte du compteur de la collection') : Promise.resolve(null));
const assurer = cfg => initialisation || initialiser(cfg);

// ── le registre
// L'ÉPOQUE : chaque document de registre porte une valeur aléatoire posée à sa création (`$setOnInsert`) ; chaque document de compte porte celle du registre contre lequel ses bits ont été écrits.
// Un registre perdu, vidé ou recréé seul change d'époque : les bits des comptes ne désignent plus les mêmes cartes, et rien d'autre ne le dirait — ils sont alors ILLISIBLES (503, journal), jamais lus.
class RegistreIllisible extends Error { constructor(motif) { super(motif); this.name = 'RegistreIllisible'; } }
function illisible(slug, motif) {
    console.error(`❌ [v2 collection] registre recréé ou corrompu : bits illisibles (set ${slug}, ${motif}) — rien n'est lu ni écrit pour ce document`);
    return new RegistreIllisible(motif);
}
/** Le registre du set : { existe, pos (de la clé, -1 si absente), epoque, n (nombre de cases) }. */
async function positionDuRegistre(slug, cle) {
    const r = await col(REGISTRE).aggregate([{ $match: { _id: slug } }, { $project: { i: { $indexOfArray: ['$cles', cle] }, epoque: 1, n: { $size: '$cles' } } }]).toArray();
    return r.length ? { existe: true, pos: r[0].i, epoque: r[0].epoque, n: r[0].n } : { existe: false, pos: -1, epoque: null, n: 0 };
}
/** Les bits d'un document de compte ne se lisent que contre le registre de LEUR époque, et ne vont jamais au-delà de ses cases. Une garde qui ne peut pas conclure BLOQUE. */
function verifierBits(doc, meta, slug) {
    const positions = positionsPosees(doc && doc.mots);
    if (!positions.length) return;                                             // aucun bit : rien à lire, rien à contredire
    if (!meta.existe) throw illisible(slug, 'registre absent');
    if (!doc.epoque || doc.epoque !== meta.epoque) throw illisible(slug, 'époque différente');
    if (positions[positions.length - 1] >= meta.n) throw illisible(slug, 'bit au-delà du registre');
}
/** Ajoute la clé (UNE position, même à 50 simultanés) et rend sa position ; `ajoute`/`docCree` disent ce que CET appel a écrit (le coût du registre ne se paie qu'une fois). */
async function ajouterAuRegistre(slug, cle) {
    let r = null;
    for (let essai = 0; essai < 5; essai++) {
        try { r = await col(REGISTRE).updateOne({ _id: slug, cles: { $ne: cle } }, { $push: { cles: cle }, $setOnInsert: { epoque: crypto.randomBytes(8).toString('hex') } }, { upsert: true }); break; }
        catch (e) {
            if (!(e && e.code === 11000)) throw e;                                  // doublon d'_id : le document existe — soit il porte DÉJÀ la clé (un concurrent l'a posée), soit il vient d'être créé par une autre clé et l'upsert perdant doit REJOUER
            const deja = await positionDuRegistre(slug, cle);
            if (deja.pos >= 0) return { pos: deja.pos, epoque: deja.epoque, ajoute: false, docCree: false };
        }
    }
    const p = await positionDuRegistre(slug, cle);
    if (p.pos < 0) throw new Error('registre-introuvable');
    return { pos: p.pos, epoque: p.epoque, ajoute: Boolean(r && (r.modifiedCount === 1 || r.upsertedCount === 1)), docCree: Boolean(r && r.upsertedCount === 1) };
}

// ── lectures
const docsDuCompte = compteId => col(NOM).find({ compteId }, { projection: { set: 1, mots: 1, hors: 1, qte: 1 }, ...LECTURE }).toArray();
async function totalDuCompte(compteId) { return (await docsDuCompte(compteId)).reduce((n, d) => n + nbCoches(d), 0); }
/** Les clés à quantité ≥ 2 d'un document : les entrées `qte` (registre) et les clés `hors` qui portent « \n N ». */
const nbQuantites = d => Object.keys(d.qte || {}).length + (d.hors || []).filter(e => e.includes('\n')).length;
/** Où est la clé pour ce compte ? { doc, h (indice dans hors, -1), reg (le registre du set), qAvant (0 : pas cochée) }. LÈVE RegistreIllisible si les bits du document ne se lisent pas contre ce registre. */
async function situation(compteId, slug, cle) {
    const doc = await col(NOM).findOne({ compteId, set: slug }, { projection: PROJ, ...LECTURE });
    const h = doc ? indexHors(doc.hors, cle) : -1;
    const reg = await positionDuRegistre(slug, cle);
    verifierBits(doc, reg, slug);
    const qAvant = h >= 0 ? C.lireElementHors(doc.hors[h]).q : (doc && reg.pos >= 0 && bitPose(doc, reg.pos) ? quantiteBit(doc, reg.pos) : 0);
    return { doc, h, reg, qAvant };
}

// ── écritures
const sansCe = cle => ({ $ne: [{ $arrayElemAt: [{ $split: ['$$this', '\n'] }, 0] }, { $literal: cle }] });   // les éléments de `hors` qui ne sont PAS cette clé (avec ou sans quantité)
async function ecrireBit(c, { compteId, slug, p, q, epoque, maintenant }) {
    const champ = `mots.${Math.floor(p / 64)}`, b = p % 64;
    const maj = { $bit: { [champ]: { or: masque(b) } }, $set: { majLe: maintenant, epoque }, $setOnInsert: { hors: [] } };
    if (q >= 2) maj.$set[`qte.${p}`] = q; else maj.$unset = { [`qte.${p}`]: '' };
    return c.findOneAndUpdate({ compteId, set: slug }, maj, { upsert: true, returnDocument: 'before', projection: PROJ, ...LECTURE });
}
async function ecrireHors(c, { compteId, slug, cle, q, maintenant }) {
    const pipe = [{ $set: { hors: { $concatArrays: [{ $filter: { input: { $ifNull: ['$hors', []] }, cond: sansCe(cle) } }, [{ $literal: C.elementHors(cle, q) }]] }, majLe: { $literal: maintenant } } }];
    return c.findOneAndUpdate({ compteId, set: slug }, pipe, { upsert: true, returnDocument: 'before', projection: PROJ, ...LECTURE });
}

/** La clé est-elle AUSSI un bit de ce document ? (la position se relit : un concurrent a pu l'ajouter au registre depuis) */
async function doublonAvecBit(c, compteId, slug, cle) {
    const r = await positionDuRegistre(slug, cle);
    if (r.pos < 0) return -1;
    return bitPose(await c.findOne({ compteId, set: slug }, { projection: { mots: 1 }, ...LECTURE }), r.pos) ? r.pos : -1;
}
/** UN SEUL ARBITRE par clé et par document : `hors` GAGNE. La seule reprise qui existe retire le BIT, et seulement CONDITIONNELLE à l'état exact lu : le bit est encore posé ET `hors` porte encore la clé. Elle ne retire jamais
 *  de `hors` ce qu'un autre cochage vient d'y écrire (deux reprises qui se retiraient l'une l'autre perdaient la coche). Rend true si elle a retiré le bit. */
async function reprendreBit(c, compteId, slug, cle, p) {
    const champ = `mots.${Math.floor(p / 64)}`, b = p % 64;
    const filtre = { compteId, set: slug, [champ]: { $bitsAllSet: [b] }, $expr: { $in: [{ $literal: cle }, { $map: { input: { $ifNull: ['$hors', []] }, in: { $arrayElemAt: [{ $split: ['$$this', '\n'] }, 0] } } }] } };
    return Boolean(await c.findOneAndUpdate(filtre, { $bit: { [champ]: { and: inverse(b) } }, $unset: { [`qte.${p}`]: '' } }, { returnDocument: 'before', projection: { _id: 1 } }));
}
/** Retire la clé de `hors` (avec sa quantité) ; rend l'élément retiré, ou null s'il n'y était pas. */
async function retirerDeHors(c, compteId, slug, cle, maintenant) {
    const filtre = { compteId, set: slug, $expr: { $in: [{ $literal: cle }, { $map: { input: { $ifNull: ['$hors', []] }, in: { $arrayElemAt: [{ $split: ['$$this', '\n'] }, 0] } } }] } };
    const avant = await c.findOneAndUpdate(filtre, [{ $set: { hors: { $filter: { input: { $ifNull: ['$hors', []] }, cond: sansCe(cle) } }, majLe: { $literal: maintenant } } }], { returnDocument: 'before', projection: { hors: 1 } });
    return avant ? avant.hors[indexHors(avant.hors, cle)] : null;
}

async function ajouter(a, essai = 0) {
    const { compteId, slug, cle, cfg } = a, c = col(NOM);
    await assurer(cfg);
    const { doc, h, reg, qAvant } = await situation(compteId, slug, cle);
    const q = a.quantite === undefined ? (qAvant > 0 ? qAvant : 1) : a.quantite;                             // `quantite` absente : 1 sur une clé NEUVE, INCHANGÉE sur une clé déjà cochée (un ancien onglet ne rétrograde pas un double)
    if (qAvant === q) return { possedees: nbCoches(doc) };                                                  // idempotent : rien ne change, rien n'est consommé, même au plafond
    const pos = reg.pos;
    // ORDRE DE DÉCISION : (1) la clé est déjà dans `hors` → elle y reste ; (2) elle est déjà au registre (sa position est en base) → bit ; (3) sinon le catalogue CHARGÉ tranche : il la connaît → ajout au registre,
    // il ne la connaît pas → `hors` (une fiche sans produit) ; aucun catalogue chargé → on n'écrit RIEN (503 « catalogue ») : `hors` ne reçoit jamais une clé par accident.
    let registre;
    if (h >= 0) registre = false;
    else if (pos >= 0) registre = true;
    else {
        const v = connue(slug, cle);
        if (v === null) return { refus: 'catalogue', reessayerDans: REESSAI_CATALOGUE_S };
        registre = v;
    }
    const nouvelle = qAvant === 0, montee = q >= 2 && qAvant < 2;
    if (nouvelle || montee) {                                                                                // les bornes (une quantité qui change sans franchir 2 n'ajoute rien)
        const tous = await docsDuCompte(compteId);
        if (nouvelle) {
            const total = tous.reduce((n, d) => n + nbCoches(d), 0);
            if (total >= cfg.collection.clesParCompte) return { refus: 'borne-compte', borne: cfg.collection.clesParCompte };
            if (!doc && tous.length >= cfg.collection.setsParCompte) return { refus: 'borne-sets', borne: cfg.collection.setsParCompte };
            if (!registre && tous.reduce((n, d) => n + (d.hors ? d.hors.length : 0), 0) >= cfg.collection.horsCatalogueParCompte) return { refus: 'borne-hors', borne: cfg.collection.horsCatalogueParCompte };
        }
        if (montee && tous.reduce((n, d) => n + nbQuantites(d), 0) >= cfg.collection.quantitesParCompte) return { refus: 'borne-quantites', borne: cfg.collection.quantitesParCompte };
    }
    // le coût AU PIRE, en octets : un document neuf, un mot neuf, une entrée de registre (et son document), une quantité, ou une clé `hors`
    let cout = doc ? 0 : C.document(slug);
    if (registre) {
        if (pos < 0 || !doc || !doc.mots || doc.mots[Math.floor(pos / 64)] === undefined) cout += C.mot;
        if (pos < 0) { cout += C.registreEntree(cle); if (!reg.existe) cout += C.registreDocument(slug); }
        if (q >= 2 && !(doc && doc.qte && doc.qte[pos] >= 2)) cout += C.qte;
    } else cout += C.hors(cle, q) - (h >= 0 ? C.hors(cle, qAvant) : 0);
    const reserve = Math.max(0, cout);
    if (reserve > 0 && !(await reserver(cfg, reserve))) {
        const now = await situation(compteId, slug, cle);                                                    // la clé a pu arriver entre-temps (même clé simultanée) : idempotent, pas un refus
        return now.qAvant === q ? { possedees: nbCoches(now.doc) } : { refus: 'borne-service', borne: cfg.collection.octetsService };
    }
    let avant, payeRegistre = 0, p = pos, epoque = reg.epoque, doublon = false;
    try {
        if (registre) {
            if (p < 0) { const r = await ajouterAuRegistre(slug, cle); p = r.pos; epoque = r.epoque; payeRegistre = (r.ajoute ? C.registreEntree(cle) : 0) + (r.docCree ? C.registreDocument(slug) : 0); }
            avant = await ecrireBit(c, { compteId, slug, p, q, epoque, maintenant: a.maintenant });
        } else {
            avant = await ecrireHors(c, { compteId, slug, cle, q, maintenant: a.maintenant });
            const dp = await doublonAvecBit(c, compteId, slug, cle);                                         // la course INVERSE : un autre PUT de la même clé a posé le bit (le catalogue venait de la connaître) pendant ce temps
            doublon = dp >= 0;
            if (doublon) { await reprendreBit(c, compteId, slug, cle, dp); }                                 // `hors` GAGNE : c'est le BIT qu'on reprend, jamais `hors`
        }
    } catch (e) {
        await rendre(reserve - payeRegistre);                                                                // rien n'a été ajouté au compte : le registre, lui, est payé
        if (e && e.code === 11000 && essai < 3) return ajouter(a, essai + 1);                                // création simultanée du même document (index unique) : on rejoue
        throw e;
    }
    let reel;
    if (registre) {
        if (avant && indexHors(avant.hors, cle) >= 0) {                                                      // la clé est arrivée en `hors` entre la lecture et l'écriture : une clé ne vit qu'à UN endroit, le bit est repris
            await reprendreBit(c, compteId, slug, cle, p);                                                   // `hors` GAGNE, et la reprise est conditionnelle à ce qu'on a lu
        }
        const motAbsent = !avant || !avant.mots || avant.mots[Math.floor(p / 64)] === undefined, avait = Boolean(avant && avant.qte && avant.qte[p] >= 2);
        reel = (avant ? 0 : C.document(slug)) + (motAbsent ? C.mot : 0) + (q >= 2 && !avait ? C.qte : 0) - (q < 2 && avait ? C.qte : 0) + payeRegistre;
    } else {
        const i = avant ? indexHors(avant.hors, cle) : -1;
        reel = (avant ? 0 : C.document(slug)) + C.hors(cle, q) - (i >= 0 ? C.hors(cle, C.lireElementHors(avant.hors[i]).q) : 0);
    }
    const delta = reserve - reel;
    if (delta > 0) await rendre(delta);
    if (delta < 0) await forcer(-delta);
    const apres = await c.findOne({ compteId, set: slug }, { projection: { mots: 1, hors: 1 }, ...LECTURE });
    return { possedees: apres ? nbCoches(apres) : 0 };
}

/** Le document n'a plus aucun bit à 1 ni aucune clé `hors` : le test est celui de la BASE, au moment de la suppression (une clé remise entre-temps l'en empêche). */
const VIDE = { $expr: { $and: [
    { $eq: [{ $size: { $ifNull: ['$hors', []] } }, 0] },
    { $eq: [{ $size: { $filter: { input: { $objectToArray: { $ifNull: ['$mots', {}] } }, cond: { $ne: ['$$this.v', 0] } } } }, 0] }] } };

async function retirer({ compteId, slug, cle, maintenant }) {
    const c = col(NOM);
    const doc = await c.findOne({ compteId, set: slug }, { projection: PROJ, ...LECTURE });
    if (!doc) return { possedees: 0 };
    const reg = await positionDuRegistre(slug, cle);
    verifierBits(doc, reg, slug);                                                                           // décocher reste permis SANS catalogue, jamais sur des bits illisibles
    let rendu = 0, change = false;
    if (indexHors(doc.hors, cle) >= 0) {
        const retire = await retirerDeHors(c, compteId, slug, cle, maintenant);
        if (retire) { rendu += C.hors(cle, C.lireElementHors(retire).q); change = true; }
    }
    if (reg.pos >= 0) {
        const w = `mots.${Math.floor(reg.pos / 64)}`, b = reg.pos % 64;
        const avant = await c.findOneAndUpdate({ compteId, set: slug, [w]: { $bitsAllSet: [b] } }, { $bit: { [w]: { and: inverse(b) } }, $unset: { [`qte.${reg.pos}`]: '' }, $set: { majLe: maintenant } },
            { returnDocument: 'before', projection: { qte: 1 }, ...LECTURE });
        if (avant) { change = true; if (avant.qte && avant.qte[reg.pos] >= 2) rendu += C.qte; }
    }
    if (change) {
        const supprime = await c.findOneAndDelete({ compteId, set: slug, ...VIDE }, { projection: PROJ, ...LECTURE });   // plus rien : le document disparaît (sauf si une clé vient d'y être remise)
        if (supprime) rendu += C.coutDuDocument(supprime);
    }
    await rendre(rendu);
    const apres = await c.findOne({ compteId, set: slug }, { projection: { mots: 1, hors: 1 }, ...LECTURE });
    return { possedees: apres ? nbCoches(apres) : 0 };
}

/** Coche (`possedee` true, avec sa `quantite` de 1 à 99 : absente = 1 sur une clé neuve, INCHANGÉE sur une clé déjà cochée) ou décoche (false, qui efface la quantité) ; les deux sont idempotents.
 *  Rend { possedees }, ou { refus: 'borne-compte'|'borne-sets'|'borne-hors'|'borne-quantites'|'borne-service', borne }, ou { refus: 'catalogue', reessayerDans } (aucun catalogue chargé et la clé n'est pas encore au registre :
 *  rien n'est écrit). LÈVE RegistreIllisible quand les bits du document ne se lisent pas contre le registre. */
function cocher({ compteId, slug, cle, possedee, quantite, cfg, maintenant = new Date() }) {
    if (!possedee) return retirer({ compteId, slug, cle, maintenant });
    if (quantite !== undefined && (!Number.isInteger(quantite) || quantite < 1 || quantite > cfg.collection.quantiteMax)) throw new Error('quantite');   // les routes la refusent déjà en 400 : ceci ne s'atteint pas par HTTP
    return ajouter({ compteId, slug, cle, quantite, cfg, maintenant });
}

/** Les mots d'un document, lus contre le registre de LEUR époque (LÈVE RegistreIllisible sinon). */
async function metaDuRegistre(slug) {
    const r = await col(REGISTRE).aggregate([{ $match: { _id: slug } }, { $project: { epoque: 1, n: { $size: '$cles' } } }]).toArray();
    return r.length ? { existe: true, epoque: r[0].epoque, n: r[0].n } : { existe: false, epoque: null, n: 0 };
}
async function lireSet(compteId, slug) {
    const doc = await col(NOM).findOne({ compteId, set: slug }, { ...LECTURE });
    if (!doc) return { cles: [], quantites: {}, majLe: null };
    const toutes = new Map();                                                                                // clé → quantité
    for (const e of doc.hors || []) { const { cle, q } = C.lireElementHors(e); toutes.set(cle, q); }
    const positions = positionsPosees(doc.mots);
    if (positions.length) {
        verifierBits(doc, await metaDuRegistre(slug), slug);
        const reg = await col(REGISTRE).findOne({ _id: slug });
        for (const p of positions) { const k = reg.cles[p]; if (!toutes.has(k)) toutes.set(k, quantiteBit(doc, p)); }
    }
    const cles = [...toutes.keys()].sort(), quantites = {};
    for (const k of cles) if (toutes.get(k) >= 2) quantites[k] = toutes.get(k);
    return { cles, quantites, majLe: doc.majLe };
}

/** Les sets où au moins une fiche est cochée : [{ slug, possedees, majLe }], triés par slug. LÈVE RegistreIllisible si les bits d'un set ne se lisent pas : `possedees` et `lireSet` ne divergent jamais. */
async function lireSets(compteId) {
    const docs = await col(NOM).find({ compteId }, { projection: { set: 1, mots: 1, hors: 1, majLe: 1, epoque: 1 }, ...LECTURE }).toArray();
    const avecBits = docs.filter(d => nbBits(d.mots) > 0);
    if (avecBits.length) {
        const metas = new Map((await col(REGISTRE).aggregate([{ $match: { _id: { $in: avecBits.map(d => d.set) } } }, { $project: { epoque: 1, n: { $size: '$cles' } } }]).toArray()).map(r => [r._id, { existe: true, epoque: r.epoque, n: r.n }]));
        for (const d of avecBits) verifierBits(d, metas.get(d.set) || { existe: false, epoque: null, n: 0 }, d.set);
    }
    return docs.map(d => ({ slug: d.set, possedees: nbCoches(d), majLe: d.majLe })).filter(s => s.possedees > 0).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** La collection d'un compte part avec lui (comptes/service.js supprimerCompte). Document par document (au plus `setsParCompte`) : chaque suppression rend le MODÈLE de ce qu'elle a RÉELLEMENT retiré, jamais une
 *  lecture d'avant : un retrait en vol a déjà rendu sa part. Le registre est partagé : il ne se rend jamais. */
async function supprimerDuCompte(compteId, cfg) {
    let n = 0, rendu = 0;
    for (;;) {
        const d = await col(NOM).findOneAndDelete({ compteId }, { projection: PROJ, ...LECTURE });
        if (!d) break;
        n++; rendu += C.coutDuDocument(d);
    }
    await rendre(rendu);
    return n;
}
module.exports = { NOM, REGISTRE, RegistreIllisible, cocher, lireSet, lireSets, totalDuCompte, supprimerDuCompte, recompter, initialiser, attendreInitialisation, avecDelai };
// Limite connue (M-C, relecture finale) : le recompte est ABSOLU ; avec plusieurs instances, un recompte lancé pendant que l'autre écrit peut écraser des incréments en vol (dérive basse d'au plus le nombre d'écritures en vol). Une seule instance aujourd'hui.
