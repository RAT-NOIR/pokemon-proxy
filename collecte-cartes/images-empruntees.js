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

// PHASE 3b (T4, 2026-10-24, accordé par le testeur) : DES PRODUITS d'un set, jamais le set. Les 3 réimpressions Southeast-Asia-Promos écrites au lot 2b (901074 Glass Trumpet, 901104 Budew, 901109 Fan Rotom,
// preuve `reimpression+origine+numero`) n'ont pas de visuel propre : l'API leur sert le visuel d'un AUTRE tirage (`autre-tirage`). Ordre : « comme image empruntée (imageEmprunteeTirage), affichée avec la mention
// et exclue de l'identification. Elle sera remplacée dès qu'un vrai scan existe. » L'origine se lit sur la ligne de réimpression, comme pour Trick or Trade 2024 (set et numéro d'origine → entrée de la même carte).
// LISTE FERMÉE DE PRODUITS : les 81 autres lignes du set (et tout 4e produit) restent HORS PÉRIMÈTRE — comptées (`horsListe`), jamais écrites. Le set n'entre PAS dans PERIMETRE (son banc : 9 sets, inchangé).
const SETS_BORNES = Object.freeze({ 'Southeast-Asia-Promos': Object.freeze([901074, 901104, 901109]) });
const setBorne = s => Object.prototype.hasOwnProperty.call(SETS_BORNES, s);
const estBorne = (s, idProduct) => setBorne(s) && SETS_BORNES[s].includes(idProduct);
/** Tout ce que l'outil LIT (le périmètre entier + les sets dont une liste de produits est admise). */
const SETS_LUS = Object.freeze([...PERIMETRE, ...Object.keys(SETS_BORNES)]);

/** WCD : toute clé de set qui COMMENCE par « WCD » (casse et espaces ignorés) — refusée, jamais écrite. */
const estWCD = s => /^wcd/i.test(String(s ?? '').trim());
const dansLePerimetre = s => !estWCD(s) && PERIMETRE.includes(s);
/** Une ligne est-elle dans le champ d'écriture ? Un set du périmètre (tous ses produits), ou UN des produits d'une liste fermée. WCD : jamais. */
const dansLeChamp = (s, idProduct) => !estWCD(s) && (dansLePerimetre(s) || estBorne(s, idProduct));
/** Le substitut d'une ligne sans `visuelSubstitut` se DÉRIVE de son origine (Trick or Trade 2024, et les produits des listes fermées). */
const derivableDeLOrigine = (s, idProduct) => !estWCD(s) && (SETS_TRICK_OR_TRADE.includes(s) || estBorne(s, idProduct));
/** Le tampon que l'image NE montre PAS : « Play! Pokémon » pour les Prize Packs seulement (rien pour Battle Academy et Trick or Trade). */
const tamponDuSet = s => (SETS_PRIZE_PACK.includes(s) ? TAMPON_PRIZE_PACK : null);

/** Chaque slug du périmètre doit exister dans `sets` (lu en base) : un slug absent est une liste périmée, pas un set vide. */
function verifierPerimetre(idsDeSets) {
    const ids = new Set(idsDeSets || []);
    if (!ids.size) throw new Error('périmètre : aucun set lu — base introuvable ou sonde cassée');
    const absents = PERIMETRE.filter(s => !ids.has(s));
    if (absents.length) throw new Error(`périmètre : set(s) introuvable(s) en base : ${absents.join(', ')}`);
}

/** Les sets à liste fermée doivent exister en base (un slug absent est une liste périmée, pas un set vide). */
function verifierBornes(idsDeSets) {
    const ids = new Set(idsDeSets || []);
    const absents = Object.keys(SETS_BORNES).filter(s => !ids.has(s));
    if (absents.length) throw new Error(`sets à liste fermée : introuvable(s) en base : ${absents.join(', ')}`);
}

/** Une sélection de sets (`--sets=`) : une liste NON VIDE, sans doublon, de slugs du champ de lecture. LÈVE sinon (jamais « tout » par défaut). */
function verifierSelection(sets) {
    if (!Array.isArray(sets) || !sets.length) throw new Error('sélection de sets vide : rien à planifier (omettre --sets pour tout le périmètre)');
    const doublons = sets.filter((s, i) => sets.indexOf(s) !== i);
    if (doublons.length) throw new Error(`sélection de sets en doublon : ${[...new Set(doublons)].join(', ')}`);
    const inconnus = sets.filter(s => !SETS_LUS.includes(s));
    if (inconnus.length) throw new Error(`sélection de sets hors du champ de lecture : ${inconnus.join(', ')}`);
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

/** Ce que la jointure d'une ligne Trick or Trade dit de son origine : `{ idProduct, numero }` (réimpression) ou `{ nomSet, numero }` (métacarte), ou `{ refus }`. */
function origineDeLaLigne(l) {
    const detail = String(l.detail ?? '');
    if (l.preuve === 'reimpression+origine+numero') {
        const ids = /produit\(s\) (\d+(?:\/\d+)*)/.exec(detail);
        const num = l.origine?.numero ?? (/tirage d'origine \S+ n°(\S+)/.exec(detail) || [])[1];
        if (!ids || num == null || String(num).trim() === '') return { refus: 'origine illisible : produit d\'origine ou numéro absent du detail de la jointure' };
        return { idProduct: Number(ids[1].split('/')[0]), numero: String(num).trim() };
    }
    if (l.preuve === 'metacarte+nom+attaques') {
        const tous = [...detail.matchAll(/« [^»]*? \(([^()]+?) (\d+)\) »/g)];
        if (!tous.length) return { refus: 'origine illisible : aucun « Nom (Set N) » dans le detail de la jointure' };
        const m = tous[tous.length - 1];
        return { nomSet: m[1], numero: m[2] };
    }
    return { refus: `preuve de jointure sans origine lisible (${l.preuve ?? 'aucune'})` };
}

/** Le substitut d'une ligne Trick or Trade : l'UNIQUE entrée `cartes.images` de la même carte, dans le set d'origine, au numéro d'origine, en langue « en ». Sinon un refus nommé. */
function substitutDepuisOrigine(l, carte, etat) {
    const o = origineDeLaLigne(l);
    if (o.refus) return { refus: `Trick or Trade : ${o.refus}` };
    let setOrigine;
    if (o.idProduct != null) {
        const p = etat.produits?.get(o.idProduct);
        if (!p || typeof p.slugSet !== 'string' || !p.slugSet) return { refus: `Trick or Trade : le produit d'origine ${o.idProduct} n'a pas de ligne cartes_produits (set d'origine inconnu)` };
        setOrigine = p.slugSet;
    } else {
        // égalité exacte : d'abord le nomAffichage (le nom du set lui-même), puis seulement à défaut nomEn (qui est aussi celui d'un jumeau d'une autre région)
        const parAffichage = etat.setsParNomAffichage?.get(o.nomSet) || [];
        const ids = parAffichage.length ? parAffichage : (etat.setsParNom?.get(o.nomSet) || []);
        if (ids.length !== 1) return { refus: `Trick or Trade : le nom de set « ${o.nomSet} » désigne ${ids.length} set(s) (égalité exacte, un seul attendu)` };
        setOrigine = ids[0];
    }
    const cle = cleNumero(o.numero);
    const trouvees = (carte.images || []).filter(e => e && e.set === setOrigine && e.langue === 'en' && cleNumero(e.numero) === cle);
    if (trouvees.length !== 1) return { refus: `Trick or Trade : ${trouvees.length} entrée(s) d'image en « en » dans ${setOrigine} au n°${o.numero} pour cette carte (une seule attendue)` };
    const e = trouvees[0];
    if (typeof e.cleR2 !== 'string' || !e.cleR2 || !entier(e.w) || !entier(e.h)) return { refus: `Trick or Trade : l'entrée d'origine de ${setOrigine} n°${o.numero} n'a pas de clé ou de taille` };
    return { sub: { cleR2: e.cleR2, w: e.w, h: e.h } };
}

/**
 * La mention que la fiche rend VRAIMENT pour une entrée empruntée (la sélection du site, `imageServieDe`, par suffixe de cleR2 sur TOUTES les images de la carte, sans le set)
 * et celle qu'elle rendrait si le site cherchait d'abord dans le set de l'entrée. Les deux fonctions du site sont injectées (importées de sa lib par le script).
 */
function mentionServie({ images, cleR2, set, imageServieDe, mentionDuVisuelEmprunte }) {
    const url = `https://exemple.invalide/${cleR2}`;
    return { reelle: mentionDuVisuelEmprunte(imageServieDe(images, url)), siCorrectif: mentionDuVisuelEmprunte(imageServieDe((images || []).filter(e => e && e.set === set), url)) };
}

const compteurs = () => ({ lignes: 0, cibles: 0, ajouts: 0, deja: 0, sansSubstitut: 0, sansCarte: 0, refus: 0 });

/**
 * @param {{lignes: object[], cartes: Map<number, {_id, images}>}} etat   lignes de cartes_produits (périmètre + WCD), cartes du set avec leurs images
 * @returns {{ajouts, deja, sansSubstitut, sansCarte, refus, refusWCD, horsPerimetre, parSet}}
 */
function planifier(etat, { maintenant = new Date(), sets = null } = {}) {
    const plan = { ajouts: [], deja: [], sansSubstitut: [], sansCarte: [], refus: [], refusWCD: [], horsPerimetre: 0, horsListe: 0, horsSelection: 0, parSet: {} };
    // PHASE 3b : `sets` = une SÉLECTION (liste de slugs du champ de lecture) ; les lignes des autres sets ne sont ni planifiées ni écrites, seulement comptées (`horsSelection`). Sans sélection : comportement d'origine.
    if (sets !== null) verifierSelection(sets);
    const groupes = new Map();
    const bucket = s => (plan.parSet[s] ||= compteurs());
    for (const l of etat.lignes || []) {
        const set = l.slugSet;
        if (estWCD(set)) { const b = (plan.parSet.WCD ||= { lignes: 0, refusWCD: 0 }); b.lignes++; b.refusWCD++; plan.refusWCD.push({ idProduct: l.idProduct, slugSet: set }); continue; }
        if (sets !== null && !sets.includes(set)) { plan.horsSelection++; continue; }
        if (!dansLeChamp(set, l.idProduct)) { if (setBorne(set)) plan.horsListe++; else plan.horsPerimetre++; continue; }
        const b = bucket(set); b.lignes++;
        const idProduct = l.idProduct;
        if (!entier(l.carteId)) { plan.sansCarte.push({ idProduct, slugSet: set }); b.sansCarte++; continue; }
        let sub = l.visuelSubstitut;
        const aSubstitut = !!sub && typeof sub.cleR2 === 'string' && !!sub.cleR2;
        // Trick or Trade 2024 n'a pas de visuelSubstitut : son image est l'entrée de la même carte dans le set d'ORIGINE (liste fermée : ce set seulement)
        const depuisOrigine = !aSubstitut && derivableDeLOrigine(set, idProduct);
        if (!aSubstitut && !depuisOrigine) { plan.sansSubstitut.push({ idProduct, slugSet: set }); b.sansSubstitut++; continue; }
        const refus = raison => { plan.refus.push({ carteId: l.carteId, set, numero: numeroDeLigne(l), produits: [idProduct], raison }); b.refus++; };
        const c = etat.cartes.get(l.carteId);
        if (!c) { refus('carte introuvable en base'); continue; }
        if (aSubstitut && (!entier(sub.w) || !entier(sub.h))) { refus('substitut incomplet (largeur ou hauteur absente)'); continue; }
        const numero = numeroDeLigne(l);
        if (couverte(c.images, set, numero)) { plan.deja.push({ idProduct, carteId: l.carteId, set, numero }); b.deja++; continue; }
        if (depuisOrigine) { const d = substitutDepuisOrigine(l, c, etat); if (d.refus) { refus(d.refus); continue; } sub = d.sub; }
        const cle = `${l.carteId}|${set}|${numero == null ? '' : cleNumero(numero)}`;
        const g = groupes.get(cle);
        if (!g) groupes.set(cle, { carteId: l.carteId, set, numero, sub, carte: c, produits: [idProduct], diverge: false });
        else { g.produits.push(idProduct); if (g.sub.cleR2 !== sub.cleR2 || g.sub.w !== sub.w || g.sub.h !== sub.h) g.diverge = true; }
    }
    for (const g of groupes.values()) {
        const b = bucket(g.set);
        // PHASE 3b : une entrée est par (carte, SET), pas par produit — dans un set à liste fermée, elle servirait AUSSI les autres produits de la même carte dans ce set (essai du 24/10 : les 3 produits ordonnés ont 4 frères,
        // V1/V2 de la même carte, qui perdraient leur service d'API et recevraient l'image sans que personne ne l'ait accordé). Écrit par ce qu'il autorise : la liste doit COUVRIR tous les produits de la carte dans ce set.
        if (setBorne(g.set)) {
            const freres = [...new Set((etat.lignes || []).filter(l => l.carteId === g.carteId && l.slugSet === g.set && !estBorne(g.set, l.idProduct)).map(l => l.idProduct))].sort((x, y) => x - y);
            if (freres.length) { plan.refus.push({ carteId: g.carteId, set: g.set, numero: g.numero, produits: g.produits, freres, raison: `l'entrée (carte, set) serait partagée avec ${freres.length} produit(s) du même set HORS de la liste fermée : ${freres.join(', ')} — un emprunt sert TOUS les produits de la carte dans ce set : rien posé (étendre la liste demande l'accord du testeur)` }); b.refus += g.produits.length; continue; }
        }
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

/** Les produits du plan qui ne sont PAS dans le champ d'écriture (jamais attendu : planifier() ne retient que le champ) — le script s'arrête s'il en voit un. */
function produitsHorsChamp(plan) {
    return (plan.ajouts || []).flatMap(a => (a.produits || []).filter(id => !dansLeChamp(a.set, id)).map(id => `${a.set}:${id}`));
}

/**
 * Ce que la décision de l'API a le droit de faire à ce lot (PHASE 3b) : une image empruntée n'est jamais servie à l'identification, donc les produits du plan qui étaient servis SORTENT — et c'est tout.
 * @param cmp  P.compareEntrees(avant.entrees, apres.entrees, idsPlan) · @param idsPlan les produits du plan · @param contratNouveaux le nombre de refus nouveaux du contrat de l'API
 * @returns {{ok: boolean, raisons: string[]}}  ok = AUCUN autre produit perdu, changé ou gagné, et zéro refus nouveau
 */
function verdictApi({ cmp, idsPlan, contratNouveaux }) {
    const raisons = [];
    const horsPlan = cmp.perdus.filter(id => !idsPlan.includes(id));
    if (horsPlan.length || cmp.autresPerdus.length) raisons.push(`produits perdus HORS du plan : ${[...new Set([...horsPlan, ...cmp.autresPerdus])].join(',')}`);
    if (cmp.changes.length) raisons.push(`produits changés : ${cmp.changes.join(',')}`);
    if (cmp.gagnes.length) raisons.push(`produits gagnés : ${cmp.gagnes.join(',')}`);
    if (contratNouveaux > 0) raisons.push(`${contratNouveaux} refus nouveau(x) du contrat de l'API`);
    return { ok: !raisons.length, raisons };
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

module.exports = { origineDeLaLigne, mentionServie, motifDArret, garderSousLot, SOURCE, LOT, MARQUE, LANGUE_PREUVE, TAMPON_PRIZE_PACK, SETS_PRIZE_PACK, SETS_BATTLE_ACADEMY, SETS_TRICK_OR_TRADE, PERIMETRE, estWCD, dansLePerimetre, tamponDuSet, verifierPerimetre,
    SETS_BORNES, SETS_LUS, setBorne, estBorne, dansLeChamp, derivableDeLOrigine, verifierBornes, verifierSelection, produitsHorsChamp, verdictApi,
    planifier, appliquer, manifeste, totalManifeste, decisionManifeste, retirer, operationsVersMongo, operationsDeRetrait };
