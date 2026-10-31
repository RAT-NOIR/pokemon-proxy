'use strict';
// G-GROUPE (lot du 31/10, brief de l'agent API) — ORDONNER un groupe de 2 à 5 candidats que le texte ne sépare pas, avec les mesures de zones que le CLIENT a calculées (calcul-client.js).
// Pourquoi : la règle G (regle-g.js) VÉRIFIE un candidat déjà désigné ; elle ne départage pas un groupe. La chaîne héritée le faisait (departage-image.js, inliers de l'ORB entre la photo et chaque candidat) ;
// couper l'héritée sans remplaçant ferait redevenir des questions des réponses justes.
// Ce que fait ce module : rien d'autre qu'une DÉCISION PURE `{ change, tete, ordre, ecart }` ou `{ change:false, motif }`. Il ne sert rien au client, n'écrit rien, ne promeut rien : le niveau servi ne monte pas
// (la question reste une question ; l'ordre servi reste celui du contrat, par idProduct, CONTRAT-2 §3.1). Sa sortie est journalisée dans le complément du scan (calcul-client-route.js) ; c'est au branchement
// décidé par la coordination (PROBABLE, réponse sous réserve) de la lire.
// 🔑 LA RÈGLE EST ÉCRITE PAR CE QU'ELLE AUTORISE : un candidat ne passe en tête que si
//   (1) le groupe compte 2 à 5 produits distincts ;  (2) chacun a un visuel PROPRE connu (pas de visuel emprunté à un autre tirage, pas de clé inconnue) ;
//   (3) CHAQUE visuel du groupe a une mesure de zones lisible (inliers entier de 0 à 300, zones dans [-1, 1]) — une mesure absente ne se remplace pas : un inconnu pourrait être la vérité ;
//   (4) le candidat de tête est le seul de son visuel (deux produits au même visuel ne se départagent pas par l'image) ;
//   (5) ses inliers atteignent le plancher de la zone clé de G (SEUILS_G.inliers_min), sans quoi la mesure ne dit pas que la photo s'aligne sur son scan ;
//   (6) son avance sur le meilleur des AUTRES visuels est d'au moins `ecartMin` inliers (seuil inclus), choisi sur le RÉGLAGE seul (v2/mesures/analyser-g-groupe.js).
// Tout le reste ne change RIEN. Ne lève jamais.
const G = require('../../ratmarket/decision-g');

const GROUPE_MIN = 2, GROUPE_MAX = 5;
const INLIERS_MAX = 300;                                         // calcul-client.js::INLIERS_MAX — la borne du contrat
const PLANCHER_INLIERS = G.SEUILS_G.inliers_min;                 // la zone clé de G : « inliers_min » (40)
const ZONES = Object.freeze(['haut', 'illustration', 'bandeau', 'texte', 'bas']);

const nombre = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const non = motif => ({ change: false, motif });

/** Une mesure de zones lisible : inliers entier de 0 à 300 ET les cinq zones dans [-1, 1]. */
function zonesLisibles(zn) {
    return Boolean(zn) && typeof zn === 'object' && Number.isInteger(zn.inliers) && zn.inliers >= 0 && zn.inliers <= INLIERS_MAX && ZONES.every(k => nombre(zn[k], -1, 1));
}

/** Le groupe est-il une liste de 2 à 5 { id entier, cle } aux id distincts ? */
function groupeValide(groupe) {
    if (!Array.isArray(groupe) || groupe.length < GROUPE_MIN || groupe.length > GROUPE_MAX) return false;
    if (!groupe.every(c => c && typeof c === 'object' && Number.isInteger(c.id))) return false;
    return new Set(groupe.map(c => c.id)).size === groupe.length;
}

/**
 * @param groupe   [{ id: idProduct, cle: clé du visuel propre | null }] (2 à 5)
 * @param zones    cle => { haut, illustration, bandeau, texte, bas, inliers } | null — les mesures du client
 * @param ecartMin l'avance minimale en inliers (entier > 0)
 * @returns {{change:true, tete:number, ordre:number[], ecart:number, inliersTete:number, inliersSecond:number} | {change:false, motif:string}}
 */
function ordonnerGroupe(entree) {
    try {
        const { groupe, zones, ecartMin, plancher = PLANCHER_INLIERS } = entree || {};
        if (!groupeValide(groupe)) return non('groupe-hors-bornes');
        if (!(typeof ecartMin === 'number' && Number.isFinite(ecartMin) && ecartMin > 0) || !(typeof plancher === 'number' && Number.isFinite(plancher) && plancher >= 0)) return non('seuil-invalide');
        if (groupe.some(c => typeof c.cle !== 'string' || c.cle === '')) return non('visuel-inconnu');
        if (typeof zones !== 'function') return non('mesure-absente');
        // une mesure par VISUEL (deux produits au même visuel ont la même)
        const mesure = new Map();
        for (const c of groupe) {
            if (mesure.has(c.cle)) continue;
            const zn = zones(c.cle);
            if (!zonesLisibles(zn)) return non('mesure-absente');
            mesure.set(c.cle, zn.inliers);
        }
        const rang = [...groupe].map((c, i) => ({ ...c, inliers: mesure.get(c.cle), i })).sort((a, b) => b.inliers - a.inliers || a.i - b.i);
        const tete = rang[0];
        if (groupe.filter(c => c.cle === tete.cle).length > 1) return non('ex-aequo-visuel');
        const autres = rang.filter(c => c.cle !== tete.cle);
        if (!autres.length) return non('ex-aequo-visuel');                            // tout le groupe sur un seul visuel : l'image ne sépare rien
        if (tete.inliers < plancher) return non('plancher');
        const second = autres[0];
        const ecart = tete.inliers - second.inliers;
        if (ecart < ecartMin) return non('ecart-insuffisant');
        return { change: true, tete: tete.id, ordre: rang.map(c => c.id), ecart, inliersTete: tete.inliers, inliersSecond: second.inliers };
    } catch { return non('erreur'); }
}

/**
 * Les mesures de zones à AJOUTER à la demande du client pour que le groupe soit ordonnable : une par visuel du groupe pas déjà demandé.
 * null : le groupe n'est pas ordonnable (invalide, un candidat sans visuel propre, ou la demande dépasserait `max`) — la demande d'avant n'est alors pas touchée ; [] : rien à ajouter.
 */
function demandeDuGroupe(entree) {
    try {
        const { groupe, deja, max } = entree || {};
        if (!groupeValide(groupe) || !Array.isArray(deja) || !Number.isInteger(max)) return null;
        if (groupe.some(c => typeof c.cle !== 'string' || c.cle === '')) return null;
        const ontDesZones = new Set(deja.filter(m => m && m.type === 'zones').map(m => m.ref));
        const ajout = [];
        for (const c of groupe) if (!ontDesZones.has(c.cle) && !ajout.some(m => m.ref === c.cle)) ajout.push({ type: 'zones', ref: c.cle });
        return deja.length + ajout.length > max ? null : ajout;
    } catch { return null; }
}

/** La clé du visuel PROPRE d'un produit dans la version de l'archive en place (`entree(id).grande.cle`), null si le visuel est emprunté (ou l'emprunt inconnu), absent, ou la version illisible. */
function cleDeLaVersion(version) {
    return id => {
        try {
            if (!version || typeof version.entree !== 'function' || typeof version.empruntDe !== 'function') return null;
            if (version.empruntDe(id) !== false) return null;                          // emprunté OU inconnu : pas un visuel propre (défaut fermé, comme emprunt.js)
            const e = version.entree(id);
            return e && e.grande && typeof e.grande.cle === 'string' && e.grande.cle ? e.grande.cle : null;
        } catch { return null; }
    };
}

/** Le groupe d'une question : ses idProduct (2 à 5, entiers, distincts) avec leur clé de visuel ; null sinon. */
function groupeDeLaQuestion(ids, cleDe) {
    try {
        if (!Array.isArray(ids) || ids.length < GROUPE_MIN || ids.length > GROUPE_MAX || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length || typeof cleDe !== 'function') return null;
        return ids.map(id => ({ id, cle: cleDe(id) ?? null }));
    } catch { return null; }
}

module.exports = { ordonnerGroupe, demandeDuGroupe, cleDeLaVersion, groupeDeLaQuestion, zonesLisibles, GROUPE_MIN, GROUPE_MAX, PLANCHER_INLIERS, INLIERS_MAX };
