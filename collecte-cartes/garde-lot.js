// ============================================================
// LA GARDE DE LOT : fiches, illustrateurs, images et noms, comparés SET PAR SET avant et après chaque lot (2026-09-24)
// ============================================================
// 🔴 LA RÈGLE DU TESTEUR (2026-09-24), après trois lots dits additifs qui ont effacé à côté de ce qu'ils ajoutaient (§59) :
// « une recollecte réécrit, elle n'est pas additive ». Chaque lot compare donc automatiquement ses compteurs PAR GROUPE ;
// un seul compteur qui baisse sans avoir été annoncé par la simulation arrête le lot, qui se restaure depuis sa sauvegarde
// et le journalise (lot-additif.js). Un TOTAL ne suffit pas : xASC ajoutait 262 fiches et effaçait 1 363 illustrateurs.
//
// 🔑 LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE. Une baisse passe dans deux cas, et deux seulement :
//   1. ANNONCÉE — la simulation du lot l'a comptée, et la baisse réelle ne la dépasse pas ;
//   2. IMAGES d'un set où le WORKER a travaillé pendant la fenêtre du lot — prouvé par `collecte_images_etat`, jamais
//      supposé. Le worker retire puis remet les images d'un set en trois écritures séparées (collecteur-images-tcgdex.js).
// Tout le reste bloque, un groupe qui disparaît compris (baisse jusqu'à 0).
//
// Les compteurs se comptent dans des DOCUMENTS, par une seule fonction : le « avant » dans la sauvegarde elle-même (ce qu'on
// restaurerait), le « après » dans la base, et le banc (test-garde-lot.js) dans des documents fabriqués. Même code partout :
// la sonde ne diverge pas de la production (en tête du catalogue).
const { EJSON } = require('mongodb').BSON;

// L'ordre est celui de l'impression ; chaque compteur nomme son groupe.
const COMPTEURS = Object.freeze({
    'fiches': 'produits distincts rattachés à une carte, par expansion Cardmarket (cartes_produits.idExpansion)',
    'cartes': 'cartes membres du set (cartes.sets)',
    'noms-cartes': 'cartes du set qui portent un nomEn',
    'illustrateurs': 'impressions qui portent le champ illustrateur (null compris : il porte sa raison), par tirage et expansion',
    'illustrateurs-nommes': 'impressions dont l\'illustrateur est un nom',
    'images': 'entrées de cartes.images, par set',
    'nom-affiche': 'le set porte un nomAffichage'
});

/** @returns {Map<string, number>} « <compteur> <groupe> » → n */
function compterEtat({ cartes = [], cartesProduits = [], sets = [] }) {
    const m = new Map();
    const inc = k => m.set(k, (m.get(k) || 0) + 1);
    const vus = new Set();
    for (const l of cartesProduits) {
        const k = `${l.idExpansion}|${l.idProduct}`;
        if (vus.has(k)) continue;
        vus.add(k);
        inc(`fiches exp:${l.idExpansion}`);
    }
    for (const c of cartes) {
        for (const s of new Set(c.sets || [])) {
            inc(`cartes set:${s}`);
            if (c.nomEn) inc(`noms-cartes set:${s}`);
        }
        for (const i of c.impressions || []) {
            if (!i) continue;
            const g = `imp:${i.tirage}|${i.expansion}`;
            if ('illustrateur' in i) inc(`illustrateurs ${g}`);
            if (typeof i.illustrateur === 'string' && i.illustrateur) inc(`illustrateurs-nommes ${g}`);
        }
        for (const im of c.images || []) if (im) inc(`images set:${im.set}`);
    }
    for (const s of sets) if (s.nomAffichage) inc(`nom-affiche set:${s._id}`);
    return m;
}

const decouper = cle => { const i = cle.indexOf(' '); return [cle.slice(0, i), cle.slice(i + 1)]; };

/**
 * @param {Map} avant @param {Map} apres
 * @param {{annonces?: Object<string, number>, setsDuWorker?: Set<string>}} [o]
 * @returns {{baisses: object[], nonAutorisees: object[], hausses: Object<string, number>, groupes: number, annoncesNonRealisees: object[]}}
 */
function comparer(avant, apres, { annonces = {}, setsDuWorker = new Set() } = {}) {
    const baisses = [], hausses = {};
    for (const [cle, n] of avant) {
        const m = apres.get(cle) || 0;
        if (m >= n) continue;
        const [compteur, groupe] = decouper(cle);
        const baisse = n - m, annonce = annonces[cle] || 0;
        const autorisee = baisse <= annonce ? 'annoncée'
            : compteur === 'images' && setsDuWorker.has(groupe.replace(/^set:/, '')) ? 'worker' : null;
        baisses.push({ cle, compteur, groupe, avant: n, apres: m, baisse, annonce, autorisee });
    }
    for (const [cle, m] of apres) {
        const d = m - (avant.get(cle) || 0);
        if (d > 0) { const [compteur] = decouper(cle); hausses[compteur] = (hausses[compteur] || 0) + d; }
    }
    const annoncesNonRealisees = Object.entries(annonces)
        .map(([cle, a]) => ({ cle, annonce: a, baisse: baisses.find(b => b.cle === cle)?.baisse || 0 }))
        .filter(x => x.baisse !== x.annonce);
    return { baisses, nonAutorisees: baisses.filter(b => !b.autorisee), hausses, groupes: new Set([...avant.keys(), ...apres.keys()]).size, annoncesNonRealisees };
}

/** Une annonce qui nomme un compteur inconnu est une faute de frappe : elle laisserait la vraie baisse non annoncée. */
function validerAnnonces(annonces) {
    const fautes = Object.keys(annonces).filter(k => !(decouper(k)[0] in COMPTEURS) || !(Number.isInteger(annonces[k]) && annonces[k] > 0));
    if (fautes.length) throw new Error(`annonce(s) invalide(s) : ${fautes.join(' · ')} — compteurs connus : ${Object.keys(COMPTEURS).join(', ')} ; valeur = entier > 0`);
}

// Une forme canonique : types BSON explicites (12 n'est pas « 12 », une Date n'est pas sa chaîne), clés triées à toute
// profondeur (l'ordre des champs d'un document n'est pas une différence).
const trier = v => Array.isArray(v) ? v.map(trier)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, trier(v[k])])) : v;
const canon = v => JSON.stringify(trier(EJSON.serialize({ v }, { relaxed: false })));
const cleDoc = id => canon(id);

/**
 * Ce qu'il faut écrire pour ramener `actuels` à `sauves`, sauf les champs `garder(doc)` (ceux du worker), laissés tels
 * qu'ils sont maintenant. @param {Map} sauves @param {Map} actuels — clé : cleDoc(_id)
 */
function planRestauration(sauves, actuels, { garder = () => [] } = {}) {
    const plan = { inserer: [], supprimer: [], remplacer: [], champs: {} };
    for (const [k, d] of sauves) {
        const a = actuels.get(k);
        if (!a) { plan.inserer.push(d); continue; }
        const cible = { ...d };
        for (const f of garder(d, a)) { if (f in a) cible[f] = a[f]; else delete cible[f]; }
        const differents = [...new Set([...Object.keys(cible), ...Object.keys(a)])].filter(f => canon(cible[f]) !== canon(a[f]));
        if (!differents.length) continue;
        for (const f of differents) plan.champs[f] = (plan.champs[f] || 0) + 1;
        plan.remplacer.push(cible);
    }
    for (const [k, a] of actuels) if (!sauves.has(k)) plan.supprimer.push(a._id);
    return plan;
}

module.exports = { COMPTEURS, compterEtat, comparer, validerAnnonces, planRestauration, cleDoc, canon };
