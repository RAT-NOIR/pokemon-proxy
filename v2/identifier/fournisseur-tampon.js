'use strict';
// F1-TAMPON — le FOURNISSEUR de production de la lecture du tampon (`deps.lectureTampon`), branché par le montage derrière V2_LECTURE_TAMPON ET V2_EMPREINTE_EXTENSION.
// Le client du modèle (`post`) est celui de la chaîne, ENVELOPPÉ par le plafond GLOBAL de dépense (argent/depense-modele.js::envelopper, la même fonction que la seconde lecture : aucune copie) : plafond atteint,
// l'appel n'est pas émis, la lecture échoue, la question reste. Ce module n'importe AUCUN client réseau : `post` est injecté (axios.post au montage, un faux dans les bancs).
const LT = require('./lecture-tampon');
const I = require('./seconde-lecture-image');

const MODELE = 'google/gemini-3-flash-preview';                                   // le modèle de la chaîne (index.js : MODELE_IA)

/** @returns le fournisseur, ou null (clé absente, client absent, dépense absente : on le DIT au montage, la question reste) */
function creerFournisseurTampon({ post, cle, depense, modele = MODELE } = {}) {
    if (typeof post !== 'function' || typeof cle !== 'string' || !cle || !depense || typeof depense.envelopper !== 'function') return null;
    const lecteur = I.creerLecteurTampon({ post: depense.envelopper(post), modele, cle });
    return LT.creerFournisseur({ preparer: I.creerPreparateurTampon(), lecteur });
}

module.exports = { creerFournisseurTampon, MODELE };
