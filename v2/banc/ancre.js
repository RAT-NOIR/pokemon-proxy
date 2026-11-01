'use strict';
// BANC-200 (tour 1, relecture 1 I2) — l'ANCRE d'un seau scellé : un petit fichier VERSIONNÉ dans le dépôt (`v2/bancs/ancres/<seauId>.json`) qui recopie la tête de chaîne et l'empreinte du scellé. La chaîne en base ne prouve que sa propre
// cohérence (quiconque écrit la base peut recalculer toutes les mailles) ; l'ancre vit HORS de la base, dans git, et c'est ce que `verifier` compare. Ce module ne fait que LIRE ; l'écriture est l'outil v2/mesures/ancrer-seau.js.
const fs = require('fs');
const path = require('path');

const DOSSIER = path.join(__dirname, '..', 'bancs', 'ancres');
const FORME_SEAU = /^[0-9a-f]{16}$/;
const CHAMPS = Object.freeze(['seauId', 'nom', 'type', 'n', 'empreinte', 'tete', 'photosEmpreinte', 'veritesEmpreinte', 'empreinteScellee', 'scelleLe']);

/** @returns {object|null} l'ancre du seau, ou null si aucun fichier n'existe. Un fichier illisible LÈVE (on ne prend pas un fichier cassé pour une absence). */
function lireAncre(seauId, dossier = DOSSIER) {
    if (typeof seauId !== 'string' || !FORME_SEAU.test(seauId)) throw Object.assign(new Error('seau-id'), { code: 'ENTREE' });
    const f = path.join(dossier, `${seauId}.json`);
    if (!fs.existsSync(f)) return null;
    const a = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!a || a.seauId !== seauId) throw Object.assign(new Error('ancre illisible'), { code: 'ANCRE_ILLISIBLE' });
    return a;
}
module.exports = { lireAncre, DOSSIER, CHAMPS };
