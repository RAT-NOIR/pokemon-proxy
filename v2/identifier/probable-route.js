'use strict';
// PROBABLE — la DÉCISION de la route (la règle pure est identifier/probable.js, signal A). DERRIÈRE V2_PROBABLE (éteint : rien n'est lu, rien n'est calculé) ET une extension >= 2.0.1.
// Consultée à la FIN de la décision d'une carte (après la chaîne, la seconde lecture, le tampon, la règle G, SUR-PAR-IMAGE et les marqueurs : le point où tous les sûrs sont passés), sur UNE question seulement.
// Jamais : un sûr, un introuvable, une panne, une confirmation à UN candidat, un lot, une question refusée (motif) ou contradictoire. Elle ne peut que DÉSIGNER l'un des candidats déjà offerts : elle n'en ajoute ni n'en retire.
// L'image : le vecteur de l'extension (si V2_EMPREINTE_EXTENSION est allumé et que la requête en porte un), l'index EN PLACE, les visuels de l'archive — aux seules conditions de la mesure (photo redressée, visuel propre).
// Une question de GROUPE (même dessin, marqueur différent : la garde des marqueurs ou le jumbo l'a posée) ne se tranche JAMAIS par l'image.
const P = require('./probable');
const GC = require('./garde-contradiction');
const { preparerVecteur } = require('./voisins-empreinte');
const GM = require('./garde-marqueurs'), PR = require('./prix-repli');
const { emprunteDe } = require('./sur-par-image-route');
const { estMentionDAffichage } = require('./emprunt');

const actif = (cfg, entree) => Boolean(cfg && cfg.probable === true && entree && P.versionAuMoins(entree.versionExtension, cfg.versionMinProbable));
/** Une question de groupe : la trace des marqueurs dit que la garde des groupes (question / en erreur) ou le titre jumbo a parlé. */
const estGroupe = t => Boolean(t && ((t.garde && (t.garde.issue === 'question' || t.garde.issue === 'en-erreur')) || t.regle === 'jumbo-titre'));

/** Deux candidats de MÊME DESSIN (même fiche et même visuel, ou visuel emprunté de l'un à l'autre : garde-marqueurs.js::memeDessin) : l'image ne les sépare pas. Ce qui ne se lit pas est un groupe (défaut fermé). */
function groupeParLesDonnees(version, ids) {
    try {
        if (!version || typeof version.entree !== 'function') return true;
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (GM.memeDessin(version, ids[i], ids[j], { avecEmprunt: true })) return true;
        return false;
    } catch { return true; }
}

/** Le candidat `id` est-il de MÊME DESSIN qu'un autre candidat ? Ce qui ne se lit pas (version absente, exception) est un groupe : défaut fermé. */
function dansUnGroupe(version, id, ids) {
    try {
        if (!version || typeof version.entree !== 'function') return true;
        // TOUR 4 : « entrée inconnue » vaut groupe — `memeDessin` rend false quand l'entrée d'un des deux produits manque à l'archive ; on ne s'y fie pas : une entrée ABSENTE pour le désigné OU pour un autre candidat est un groupe
        // (memeDessin lui-même n'est pas touché : SUR-PAR-IMAGE le lit aussi).
        if (!version.entree(id) || ids.some(autre => !version.entree(autre))) return true;
        return ids.some(autre => autre !== id && GM.memeDessin(version, id, autre, { avecEmprunt: true }));
    } catch { return true; }
}

/**
 * Les cosinus des candidats (photo ↔ visuel PROPRE), à partir du vecteur de l'extension et de l'index en place ; null si le vecteur manque, est refusé, ou si la photo n'est pas redressée. UNE définition : consulterProbable
 * et la désignation de G-GROUPE (preparerComplement) la lisent toutes deux. @returns (idProduct) => number | null, ou null
 */
function cosinusDesCandidats({ cfg, entree, ids, version, etat = require('./etat-empreintes'), memo = false, note = () => { } }) {
    try {
        const voulu = cfg.modeleEmpreinte && cfg.modeleEmpreinte.id && cfg.modeleEmpreinte.sha256 ? { id: cfg.modeleEmpreinte.id, sha256: cfg.modeleEmpreinte.sha256 } : null;
        const p = preparerVecteur({ entree, voulu, etat, memo });
        if (!p.ok) note(`vecteur-${p.code}`); else if (p.e0.redressee !== true) note('non-redressee'); else note('cosinus');
        if (p.ok && p.e0.redressee === true) {
            const empr = emprunteDe(version), cles = new Map();
            for (const id of ids) {
                const e = version.entree(id);
                // un visuel EMPRUNTÉ (marqué par la colonne des emprunts, ou porteur d'une mention d'un autre tirage) n'a pas de visuel propre. « Inconnu » (null) n'est pas « emprunté » : la mesure du lot compte propre
                // tout visuel sans mention (une entrée sans mention est le scan du tirage), c'est ce que le seuil du cosinus a été calibré sur.
                const emprunte = (empr && empr(id) === true) || Boolean(e && e.mention && !estMentionDAffichage(e));
                if (e && !emprunte && e.grande && typeof e.grande.cle === 'string' && e.grande.cle) cles.set(id, e.grande.cle);
            }
            return P.cosinusDes({ ids, cles, similarites: ordre => p.courant.index.similarites(p.v.vecteur, ordre), redressee: true });
        }
        return null;
    } catch { return null; }
}

/**
 * G-GROUPE → PROBABLE : une tête posée par g-groupe.js (second envoi des mesures) devient une désignation candidate du niveau « probable » SEULEMENT si TOUTES les gardes de PROBABLE passent, relues ici
 * sur ce que le premier envoi a gardé (`probableG` : version de l'extension, trace des groupes, cosinus du désigné) et sur la ligne `analyses` (le prix de guide servi). Écrite par ce qu'elle AUTORISE : un seul
 * chemin mène à { idProduct }, tout le reste est { refus: <motif> } — jamais une exception, jamais « je ne sais pas » pris pour « oui ».
 *   I3 : le désigné n'est dans aucun groupe de même dessin (marqueurs, ou données : une entrée absente de l'archive = groupe) · VECTEUR EXIGÉ et COSINUS ≥ minimum (P.cosinusAdmis, la même définition que decider) ·
 *   I2 : un prix de guide servi · extension >= versionMinProbable · 2 ou 3 candidats, le désigné parmi eux.
 * Le débit (I1, atomique) n'est PAS ici : il passe par argent.passerEnProbable, la fonction existante de PROBABLE.
 */
function designerTeteDeGroupe({ cfg, versionExtension, tete, ids, version, groupeMarqueurs, cosinus, prixGuide, garde }) {
    try {
        if (!(cfg && cfg.probable === true && cfg.gGroupe === true)) return { refus: 'drapeaux' };
        if (!P.versionAuMoins(versionExtension, cfg.versionMinProbable)) return { refus: 'version-extension' };
        if (!Array.isArray(ids) || ids.length < 2 || ids.length > 3 || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length || !ids.includes(tete)) return { refus: 'candidats' };
        if (groupeMarqueurs !== false) return { refus: 'groupe' };                                  // vrai OU absent OU illisible : un groupe (défaut fermé)
        if (dansUnGroupe(version, tete, ids)) return { refus: 'groupe' };                           // I3
        if (!P.cosinusAdmis(Number.isFinite(cosinus) ? cosinus : null, { cosinusMin: cfg.probableCosinusMin, vecteurExige: cfg.probableVecteurExige })) return { refus: 'cosinus' };
        if (PR.depuisGuide(prixGuide, 'tendance-seule') === null) return { refus: 'sans-prix' };    // I2
        // LA LECTURE DE LA PHOTO : la garde (2) de la promotion de G (promotion-g.js::evaluerGarde, rendue par calcul-client-route.js::gardeDeLaLecture), avec la MEME exigence que arbitrerAvecPromotion :
        // jugeable ET non contredite. Contredite, indecise ou lecture illisible : la question reste.
        if (!(garde && typeof garde === 'object' && garde.jugeable === true && garde.contredit === false)) return { refus: 'lecture' };
        return { idProduct: tete, signal: 'G' };
    } catch { return { refus: 'erreur' }; }
}

/**
 * @returns null (aucun probable) | { idProduct, signal, contredits, detail }
 */
function consulterProbable({ cfg, entree, resultat, corpsChaine, produits, version, traceMarqueurs = null, lot = false, etat = require('./etat-empreintes'), memo = false, diag = null }) {
    if (!actif(cfg, entree) || lot) return null;
    if (!resultat || resultat.issue !== 'question' || resultat.motif || resultat.contradiction) return null;
    const cartes = resultat.analyse && Array.isArray(resultat.analyse.cartes) ? resultat.analyse.cartes : null;
    if (!cartes || cartes.length !== 1 || cartes[0].statut !== 'a-trancher' || !Array.isArray(cartes[0].candidats)) return null;
    const ids = cartes[0].candidats.map(x => x && x.idProduct);
    if (ids.length < 2 || ids.length > 3 || !ids.every(Number.isInteger)) return null;                 // une confirmation à UN candidat n'est jamais un probable
    const lu = GC.lectureDe(corpsChaine);
    if (!lu || !(produits instanceof Map)) return null;
    const groupe = estGroupe(traceMarqueurs) || groupeParLesDonnees(version, ids);       // I3 : le groupe se lit dans les DONNÉES (même fiche et même visuel), la trace des marqueurs n'est qu'un complément
    const note = r => { if (diag) diag.raison = r; };
    let cosinus = null;
    if (groupe) note('groupe');
    else if (!(cfg.empreinteExtension === true && entree.empreintes && version && typeof version.entree === 'function')) note('sans-vecteur');
    if (!groupe && cfg.empreinteExtension === true && entree.empreintes && version && typeof version.entree === 'function') cosinus = cosinusDesCandidats({ cfg, entree, ids, version, etat, memo, note });
    // GARDES FERMÉES : les valeurs de la configuration sont passées TELLES QUELLES ; `decider` ne lève une garde que sur `false` explicite (vecteur) ou un nombre fini (seuil, 0 explicite l'éteint)
    const d = P.decider({ ids, produits, lu, cosinus, groupe, cosinusMin: cfg.probableCosinusMin, vecteurExige: cfg.probableVecteurExige });
    if (!d) return null;
    // TOUR 3, I3 INCONDITIONNEL : un probable est INTERDIT dès que le candidat désigné est dans un groupe de même dessin (même fiche et même visuel, ou visuel emprunté), QUEL QUE SOIT l'état des drapeaux (marqueurs, vecteur exigé,
    // cosinus minimal) et même si la lecture contredit l'autre version : l'image ne prouve pas un marqueur, et la lecture seule ne suffit pas ici. Défaut fermé : une version qui ne sait pas le dire, ou qui lève, = groupe.
    if (estGroupe(traceMarqueurs) || dansUnGroupe(version, d.idProduct, ids)) return null;
    // I2 : « un probable affiché AVEC un prix » — le candidat désigné doit porter un prix servi (même règle que le repli de prix : un guide daté avec un prix). Sinon la question reste réservée comme avant.
    const c = cartes[0].candidats.find(x => x && x.idProduct === d.idProduct);
    if (!c || PR.depuisGuide(c.prixGuide, 'tendance-seule') === null) return null;
    return d;
}

/** La forme servie de la carte : `niveau` (liste fermée) et `probable`. null si le niveau n'est pas servi à cette requête (drapeau éteint ou extension plus ancienne que 2.0.1). */
function niveauDe(carte, probable) {
    if (!carte) return null;
    if (carte.statut === 'identifiee') return { niveau: 'sur', probable: null };
    if (carte.statut === 'a-trancher') return probable && Number.isInteger(probable.idProduct) ? { niveau: 'probable', probable: { idProduct: probable.idProduct, aConfirmer: true } } : { niveau: 'question', probable: null };
    return { niveau: null, probable: null };
}
/** Ajoute `niveau` et `probable` à chaque carte de l'analyse servie. L'analyse d'avant n'est pas modifiée. */
function avecNiveau(analyse, probable) {
    if (!analyse || !Array.isArray(analyse.cartes)) return analyse;
    return { ...analyse, cartes: analyse.cartes.map((c, i) => ({ ...c, ...niveauDe(c, analyse.cartes.length === 1 && i === 0 ? probable : null) })) };
}

module.exports = { dansUnGroupe, groupeParLesDonnees, consulterProbable, cosinusDesCandidats, designerTeteDeGroupe, avecNiveau, niveauDe, actif, estGroupe };
