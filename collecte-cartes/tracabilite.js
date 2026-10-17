// ============================================================
// TRAÇABILITÉ COMMUNE DES IMAGES — doctrine de collecte du testeur (2026-10-17), article 6
// ============================================================
// « Traçabilité : source, adresse d'origine, date, et retirable: true sur chaque image. L'outil de retrait retire une source entière en une commande […]. Aucun nom de source n'apparaît en public. »
// UNE règle (§21 bis), appelée par CHAQUE collecteur d'images, pour le document `images` ET l'entrée `cartes.images` :
//   · `retirable: true` ;
//   · `urlOriginal` : l'adresse d'origine du fichier, OBLIGATOIRE — une écriture sans elle LÈVE ;
//   · `collecteLe` : la date du téléchargement quand le collecteur la connaît (document : `telechargeLe`, ou la date du cache disque pour pokemon.com) ; à défaut, la date d'ÉCRITURE
//     (celle de la jointure pour l'entrée d'un document ancien). Une image sans date ne s'écrit pas.
// La SOURCE vit déjà dans `source` (champ interne, jamais publié) ; ce module n'ajoute aucun champ qui la nomme.
// Écrit par ce qu'il autorise : une adresse = une chaîne non vide, une date = une Date valide (ou une chaîne qui en donne une).
const dateDe = v => {
    const d = v instanceof Date ? v : (typeof v === 'string' && v ? new Date(v) : null);
    return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Les champs de traçabilité d'une image écrite. LÈVE sans adresse d'origine ou sans date valable. */
function champsTracabilite({ urlOriginal, collecteLe } = {}) {
    if (typeof urlOriginal !== 'string' || !urlOriginal.trim()) throw new Error('traçabilité : adresse d\'origine (urlOriginal) absente — une image sans elle ne s\'écrit pas');
    const date = dateDe(collecteLe);
    if (!date) throw new Error('traçabilité : date de collecte (collecteLe) absente ou invalide — une image sans date ne s\'écrit pas');
    return { retirable: true, urlOriginal, collecteLe: date };
}

/** Les mêmes champs pour l'ENTRÉE d'une jointure, relus sur le document `images` : sa date de collecte, sinon son téléchargement, sinon la date d'écriture (`maintenant`). */
function champsDeLEntree(doc, maintenant = new Date()) {
    return champsTracabilite({ urlOriginal: doc?.urlOriginal, collecteLe: dateDe(doc?.collecteLe) ?? dateDe(doc?.telechargeLe) ?? maintenant });
}

module.exports = { champsTracabilite, champsDeLEntree };
