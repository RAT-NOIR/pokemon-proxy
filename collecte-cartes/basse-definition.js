// ============================================================
// BASSE DÉFINITION — la marque, et le remplacement automatique (décision du testeur, 2026-10-12)
// ============================================================
// « Seuil des sources OFFICIELLES (TPC Asie, pokemon-card.com) : 257 px. Chaque image sous 350 px reçoit une marque basseDefinition: true, que le
// site lira pour ne jamais l'agrandir au-delà de sa taille réelle. Une meilleure image de même impression la remplace automatiquement dès qu'une
// source la fournit. Le seuil de 350 px des autres sources ne change pas. »
//
// UNE règle, appelée par tous les collecteurs (§21 bis) :
//   · LA MARQUE (`marqueDe`) : d'après la largeur de l'ORIGINAL (seuils-images.js `estBasseDefinition`) — jamais un nombre recopié ici.
//     C'est l'original qui borne l'agrandissement : le fichier servi (WebP, 700 px au plus) n'est jamais agrandi à l'encodage, donc pour une image
//     sous 350 px, `w` (servi) = largeur de l'original ; le site ne doit pas la montrer plus large que `w`.
//   · LE REMPLACEMENT (`entreesARemplacer`, `remplacerBasseDefinition`) : une candidate NON marquée prend la place d'une entrée marquée de
//     `cartes.images` quand elles désignent la MÊME impression (même set, même numéro — `cleNumero`, la clé de la jointure) ET la MÊME langue.
//     Écrite par ce qu'elle AUTORISE : les deux langues doivent être CONNUES (non null) et égales ; la candidate ne doit être ni marquée ni
//     d'une largeur d'original basse ; l'entrée remplacée doit porter la marque. Tout le reste ne bouge pas. JAMAIS L'INVERSE : une image de
//     basse définition ne remplace jamais une image sans la marque.
//   · LA TRAÇABILITÉ : le document `images` de l'entrée remplacée RESTE (il n'est pas supprimé) ; son `etat` passe à `remplace`, avec
//     `remplacePar` (source, cleR2 de la remplaçante) et `remplaceLe`.
//
// Qui l'appelle : collecteur-images.js (artofpkm), collecteur-images-bulba.js, collecteur-images-tcgdex.js — les jointures qui posent une entrée
// NON marquée. Les collecteurs TPC, PikaQian et pokemontcg.io ne comblent que les visuels MANQUANTS (`dejaServi`) : une entrée marquée compte
// comme « servie », ils ne l'atteignent pas (TPC et PikaQian posent la marque ; ptcgio n'écrit que des originaux ≥ 350).
const { estBasseDefinition, largeurOriginaleDe } = require('./seuils-images');
const { cleNumero } = require('./jointure');

/** La marque d'un document `images` (ou d'une entrée) d'après la largeur de l'original : `{ basseDefinition: true }` ou `{}`. */
function marqueDe(doc) {
    // la marque DÉJÀ posée sur le document (collecteur, ou rattrapage `poser-basse-definition.js`) est reprise telle quelle : l'entrée d'une jointure
    // rejouée (pull + push d'une entrée neuve) la garde ; à défaut, d'après la largeur de l'original
    if (doc?.basseDefinition === true) return { basseDefinition: true };
    return estBasseDefinition(largeurOriginaleDe(doc)) ? { basseDefinition: true } : {};
}

/** Les entrées de `images` (celles d'une carte) qu'une candidate non marquée remplace. Pure. */
function entreesARemplacer(images, candidat) {
    if (!Array.isArray(images) || !candidat || typeof candidat !== 'object') return [];
    if (candidat.basseDefinition === true || estBasseDefinition(largeurOriginaleDe(candidat))) return [];      // une image basse ne remplace jamais
    if (typeof candidat.langue !== 'string' || !candidat.langue) return [];                                     // langue inconnue : on ne remplace pas
    const numero = cleNumero(candidat.numero);
    return images.filter(e => e && e.basseDefinition === true
        && e.set === candidat.set
        && cleNumero(e.numero) === numero
        && typeof e.langue === 'string' && e.langue === candidat.langue
        && !(e.source === candidat.source && e.cleR2 === candidat.cleR2));
}

/**
 * Applique le remplacement pour UNE candidate sur UNE carte : retire de `cartes.images` les entrées marquées qu'elle remplace (le `$pull` porte
 * la marque : il ne peut jamais retirer une entrée non marquée), et marque leurs documents `images` « remplace ». Rend le nombre d'entrées remplacées.
 * À appeler AVANT de poser la candidate. `M` : les modèles de la base `cartes` (Carte, Image).
 */
async function remplacerBasseDefinition(M, carteId, candidat, { maintenant = new Date() } = {}) {
    const c = await M.Carte.findById(carteId).select('images').lean();
    const aRemplacer = entreesARemplacer(c?.images, candidat);
    for (const e of aRemplacer) {
        await M.Carte.updateOne({ _id: carteId }, { $pull: { images: { set: e.set, source: e.source, cleR2: e.cleR2, basseDefinition: true } } });
        await M.Image.updateOne({ source: e.source, set: e.set, cleR2: e.cleR2, etat: 'ok' }, { $set: { etat: 'remplace', remplacePar: { source: candidat.source, cleR2: candidat.cleR2 }, remplaceLe: maintenant } });
    }
    return aRemplacer.length;
}

module.exports = { marqueDe, entreesARemplacer, remplacerBasseDefinition };
