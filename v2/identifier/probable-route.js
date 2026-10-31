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
    if (!groupe && cfg.empreinteExtension === true && entree.empreintes && version && typeof version.entree === 'function') {
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
                cosinus = P.cosinusDes({ ids, cles, similarites: ordre => p.courant.index.similarites(p.v.vecteur, ordre), redressee: true });
            }
        } catch { cosinus = null; }
    }
    const d = P.decider({ ids, produits, lu, cosinus, groupe, cosinusMin: cfg.probableCosinusMin });
    if (!d) return null;
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

module.exports = { groupeParLesDonnees, consulterProbable, avecNiveau, niveauDe, actif, estGroupe };
