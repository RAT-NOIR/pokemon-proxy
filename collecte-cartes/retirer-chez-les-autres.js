'use strict';
// ============================================================
// UNE CORRECTION ÉCRITE QUI NE RETIRE PAS L'ENTRÉE FAUSSE NE CORRIGE RIEN EN BASE — lot VIGN-SUITE, point 6 (2026-10-17)
// ============================================================
// `corrections-images.js` attribue un fichier à UNE carte (les 8 LV.X du 17/10). La jointure pose le fichier sur cette carte, mais l'entrée qu'une
// AUTRE carte du même set portait déjà (la carte de base, jointe par le nom seul) n'était jamais retirée : le `$pull` de la jointure ne vise que
// (set, numero) de la carte jointe (§59 : un geste qui ajoute et laisse à côté). Mesuré après le lot du 17/10 : 5 cartes de base gardaient
// le fichier LV.X en seconde entrée.
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : appelée SEULEMENT pour une image qui porte une correction lue à l'œil (liste fermée), sur le
// couple EXACT (set, cleR2), jamais sur la carte nommée, jamais dans un autre set.

/** @returns {Promise<number>} cartes dont l'entrée a été retirée */
async function retirerChezLesAutres(Carte, { carteId, set, cleR2 }) {
    if (carteId == null || typeof set !== 'string' || !set || typeof cleR2 !== 'string' || !cleR2) throw new Error('carteId, set et cleR2 requis : un retrait sans ces trois-là ne vise rien');
    const r = await Carte.updateMany({ _id: { $ne: carteId }, images: { $elemMatch: { set, cleR2 } } }, { $pull: { images: { set, cleR2 } } });
    return r.modifiedCount ?? 0;
}

module.exports = { retirerChezLesAutres };
