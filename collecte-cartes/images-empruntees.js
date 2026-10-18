// ============================================================
// LOT TAMPONNEES — l'image du tirage normal, EMPRUNTÉE, pour les réimpressions tamponnées sans scan propre (module pur)
// ============================================================
// Décision du testeur (2026-10-17 soir) : « Tamponnées sans source ouverte (Prize Packs S5-S9, Battle Academy, Trick or Trade 2024) : l'image du tirage normal est permise
// POUR L'AFFICHAGE SEULEMENT, avec `tamponNonRepresente`, la mention du site « tampon non représenté », et `imageEmprunteeTirage: true` (exclue de l'archive servie à
// l'identification). WCD : NON (bordure, dos, signature diffèrent) — les WCD restent sans visuel. »
//
// L'image à emprunter est celle que `cartes_produits.visuelSubstitut` porte déjà (le scan de la carte d'ORIGINE, choisi et relu le 26/09) : aucune nouvelle sélection,
// aucune requête. Le lot pose UNE entrée dans `cartes.images` de la carte, pour le set de la ligne, et rien d'autre (aucun document `images`).
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : le périmètre est une liste FERMÉE de slugSet ; tout slug « WCD… » est de surcroît refusé nommément ; une entrée
// existante du set (vrai scan, basse définition, empruntée d'un autre lot) n'est jamais touchée et couvre la ligne.
const { cleNumero } = require('./jointure');

const SOURCE = 'emprunt';
const LOT = 'emprunt-2026-10';
const MARQUE = LOT;
const LANGUE_PREUVE = 'image du tirage normal empruntée (tampon non représenté)';
const TAMPON_PRIZE_PACK = 'Play! Pokémon';

const SETS_PRIZE_PACK = Object.freeze(['Five', 'Six', 'Seven', 'Eight', 'Nine'].map(x => `Play-Pokemon-Prize-Pack-Series-${x}`));
const SETS_BATTLE_ACADEMY = Object.freeze(['Battle-Academy-2020', 'Battle-Academy-2022', 'Battle-Academy-2024']);
const SETS_TRICK_OR_TRADE = Object.freeze(['Trick-or-Trade-2024']);
const PERIMETRE = Object.freeze([...SETS_PRIZE_PACK, ...SETS_BATTLE_ACADEMY, ...SETS_TRICK_OR_TRADE]);

/** WCD : toute clé de set qui COMMENCE par « WCD » (casse et espaces ignorés) — refusée, jamais écrite. */
const estWCD = s => /^wcd/i.test(String(s ?? '').trim());
const dansLePerimetre = s => !estWCD(s) && PERIMETRE.includes(s);
/** Le tampon que l'image NE montre PAS : « Play! Pokémon » pour les Prize Packs seulement (rien pour Battle Academy et Trick or Trade). */
const tamponDuSet = s => (SETS_PRIZE_PACK.includes(s) ? TAMPON_PRIZE_PACK : null);

/** Chaque slug du périmètre doit exister dans `sets` (lu en base) : un slug absent est une liste périmée, pas un set vide. */
function verifierPerimetre(idsDeSets) {
    const ids = new Set(idsDeSets || []);
    if (!ids.size) throw new Error('périmètre : aucun set lu — base introuvable ou sonde cassée');
    const absents = PERIMETRE.filter(s => !ids.has(s));
    if (absents.length) throw new Error(`périmètre : set(s) introuvable(s) en base : ${absents.join(', ')}`);
}

const entier = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const copie = v => (v == null ? v : JSON.parse(JSON.stringify(v), (k, x) => x));
const numeroDeLigne = l => { const s = l.numeroFiche == null ? '' : String(l.numeroFiche).trim(); return s === '' ? null : s; };

/** Une entrée du set couvre-t-elle déjà la ligne ? Sans numéro : toute entrée du set. Avec numéro : même clé de numéro, ou numéro inconnu (prudence : elle peut être la même impression). */
function couverte(images, set, numero) {
    const duSet = (images || []).filter(e => e && e.set === set);
    if (numero == null) return duSet.length > 0;
    const cle = cleNumero(numero);
    return duSet.some(e => e.numero == null || String(e.numero).trim() === '' || cleNumero(e.numero) === cle);
}

const compteurs = () => ({ lignes: 0, cibles: 0, ajouts: 0, deja: 0, sansSubstitut: 0, sansCarte: 0, refus: 0 });

/**
 * @param {{lignes: object[], cartes: Map<number, {_id, images}>}} etat   lignes de cartes_produits (périmètre + WCD), cartes du set avec leurs images
 * @returns {{ajouts, deja, sansSubstitut, sansCarte, refus, refusWCD, horsPerimetre, parSet}}
 */
function planifier(etat, { maintenant = new Date() } = {}) {
    const plan = { ajouts: [], deja: [], sansSubstitut: [], sansCarte: [], refus: [], refusWCD: [], horsPerimetre: 0, parSet: {} };
    const groupes = new Map();
    const bucket = s => (plan.parSet[s] ||= compteurs());
    for (const l of etat.lignes || []) {
        const set = l.slugSet;
        if (estWCD(set)) { const b = (plan.parSet.WCD ||= { lignes: 0, refusWCD: 0 }); b.lignes++; b.refusWCD++; plan.refusWCD.push({ idProduct: l.idProduct, slugSet: set }); continue; }
        if (!dansLePerimetre(set)) { plan.horsPerimetre++; continue; }
        const b = bucket(set); b.lignes++;
        const idProduct = l.idProduct;
        if (!entier(l.carteId)) { plan.sansCarte.push({ idProduct, slugSet: set }); b.sansCarte++; continue; }
        const sub = l.visuelSubstitut;
        if (!sub || typeof sub.cleR2 !== 'string' || !sub.cleR2) { plan.sansSubstitut.push({ idProduct, slugSet: set }); b.sansSubstitut++; continue; }
        const refus = raison => { plan.refus.push({ carteId: l.carteId, set, numero: numeroDeLigne(l), produits: [idProduct], raison }); b.refus++; };
        const c = etat.cartes.get(l.carteId);
        if (!c) { refus('carte introuvable en base'); continue; }
        if (!entier(sub.w) || !entier(sub.h)) { refus('substitut incomplet (largeur ou hauteur absente)'); continue; }
        const numero = numeroDeLigne(l);
        if (couverte(c.images, set, numero)) { plan.deja.push({ idProduct, carteId: l.carteId, set, numero }); b.deja++; continue; }
        const cle = `${l.carteId}|${set}|${numero == null ? '' : cleNumero(numero)}`;
        const g = groupes.get(cle);
        if (!g) groupes.set(cle, { carteId: l.carteId, set, numero, sub, carte: c, produits: [idProduct], diverge: false });
        else { g.produits.push(idProduct); if (g.sub.cleR2 !== sub.cleR2 || g.sub.w !== sub.w || g.sub.h !== sub.h) g.diverge = true; }
    }
    for (const g of groupes.values()) {
        const b = bucket(g.set);
        if (g.diverge) { plan.refus.push({ carteId: g.carteId, set: g.set, numero: g.numero, produits: g.produits, raison: 'les substituts des produits de ce set divergent (plusieurs images possibles) : rien posé' }); b.refus += g.produits.length; continue; }
        const origine = (g.carte.images || []).find(e => e && e.cleR2 === g.sub.cleR2 && e.vignette && typeof e.vignette === 'object');
        const entree = { set: g.set, numero: g.numero, cleR2: g.sub.cleR2, w: g.sub.w, h: g.sub.h };
        if (origine) entree.vignette = copie(origine.vignette);
        Object.assign(entree, { langue: 'en', languePreuve: LANGUE_PREUVE, source: SOURCE, lot: LOT, imageEmprunteeTirage: true });
        const tampon = tamponDuSet(g.set);
        if (tampon) entree.tamponNonRepresente = tampon;
        Object.assign(entree, { retirable: true, collecteLe: new Date(maintenant), jointeLe: new Date(maintenant) });
        plan.ajouts.push({ carteId: g.carteId, set: g.set, numero: g.numero, produits: g.produits, entree });
        b.cibles += g.produits.length; b.ajouts++;
    }
    return plan;
}

/** L'état après le plan (copie : l'entrée n'est pas modifiée). */
function appliquer(etat, plan) {
    const cartes = new Map([...etat.cartes].map(([id, c]) => [id, { ...c, images: (c.images || []).map(e => ({ ...e })) }]));
    for (const a of plan.ajouts) { const c = cartes.get(a.carteId); if (c) c.images.push({ ...a.entree, ...(a.entree.vignette ? { vignette: { ...a.entree.vignette } } : {}) }); }
    return { cartes };
}

/** Ce que le lot a posé, pour le retirer exactement. Sans date : le manifeste du lot écrit est celui du lot simulé. */
const manifeste = plan => ({
    marque: MARQUE,
    entrees: plan.ajouts.map(a => ({ carteId: a.carteId, set: a.set, numero: a.numero, cleR2: a.entree.cleR2, produits: [...a.produits].sort((x, y) => x - y) }))
        .sort((x, y) => x.carteId - y.carteId || String(x.set).localeCompare(String(y.set)) || String(x.numero).localeCompare(String(y.numero))),
});
const totalManifeste = m => (m && Array.isArray(m.entrees) ? m.entrees.length : 0);
/** Une simulation relancée après l'écriture rend un plan VIDE : elle ne doit jamais écraser le manifeste dont le retrait dépend. */
function decisionManifeste(existant, nouveau) {
    if (totalManifeste(existant) > 0 && totalManifeste(nouveau) === 0) return { ecrire: false, raison: `le manifeste existant porte ${totalManifeste(existant)} entrée(s) : le plan vide (lot déjà écrit ?) ne l'écrase pas` };
    return { ecrire: true, raison: null };
}

const estLaNotre = (e, o) => e && e.set === o.set && e.cleR2 === o.cleR2 && e.source === SOURCE && e.lot === LOT && e.imageEmprunteeTirage === true && (e.numero ?? null) === (o.numero ?? null);
/** Le retrait en mémoire : seulement ce que le manifeste a posé (même set, clé, source, lot, numéro). */
function retirer(etat, m) {
    const cartes = new Map([...etat.cartes].map(([id, c]) => [id, { ...c, images: (c.images || []).map(e => ({ ...e })) }]));
    for (const o of m.entrees) { const c = cartes.get(o.carteId); if (c) c.images = c.images.filter(e => !estLaNotre(e, o)); }
    return { cartes };
}

/** Les écritures : un $push gardé (aucune entrée du set — au même numéro ou sans numéro — n'existe). Jamais le $set d'un tableau. */
function operationsVersMongo(plan) {
    return plan.ajouts.map(a => ({
        coll: 'cartes',
        filter: { _id: a.carteId, images: { $not: { $elemMatch: a.numero == null ? { set: a.set } : { set: a.set, numero: { $in: [a.numero, null] } } } } },
        update: { $push: { images: a.entree } },
    }));
}
function operationsDeRetrait(m) {
    return m.entrees.map(o => ({
        coll: 'cartes', filter: { _id: o.carteId },
        update: { $pull: { images: { set: o.set, cleR2: o.cleR2, source: SOURCE, lot: LOT, imageEmprunteeTirage: true, numero: o.numero ?? null } } },
    }));
}

/** Avant la première écriture : exactement le lot simulé. Rend le message d'arrêt, ou null. */
function motifDArret({ nbOperations, nbRefus, attendu }) {
    if (nbRefus) return `${nbRefus} refus au plan — rien n'est écrit`;
    if (!Number.isInteger(attendu) || attendu <= 0) return '--attendu absent — rien n\'est écrit';
    if (nbOperations !== attendu) return `${nbOperations} écritures, attendu ${attendu} — rien n'est écrit`;
    return null;
}

/** `--ecrire` ne tourne que SOUS lot-additif.js (sauvegarde, garde avant/après, restauration) : il pose LOT_ADDITIF_PID = son pid, et la commande en est l'enfant direct. */
function garderSousLot(env, ppid) {
    if (!env || !env.LOT_ADDITIF_PID || env.LOT_ADDITIF_PID !== String(ppid)) throw new Error('--ecrire refusé hors de lot-additif.js : node lot-additif.js --quoi="TAMPONNEES : N entrées" --collections=cartes --annonce=<annonce.json> -- node poser-images-empruntees.js --ecrire --attendu=N (rien n\'est écrit)');
}

module.exports = { motifDArret, garderSousLot, SOURCE, LOT, MARQUE, LANGUE_PREUVE, TAMPON_PRIZE_PACK, SETS_PRIZE_PACK, SETS_BATTLE_ACADEMY, SETS_TRICK_OR_TRADE, PERIMETRE, estWCD, dansLePerimetre, tamponDuSet, verifierPerimetre,
    planifier, appliquer, manifeste, totalManifeste, decisionManifeste, retirer, operationsVersMongo, operationsDeRetrait };
