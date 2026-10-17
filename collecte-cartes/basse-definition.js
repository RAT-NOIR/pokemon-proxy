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
// NON marquée — ET, depuis le 2026-10-17 (BASSE-DEF, voir plus bas), les collecteurs TPC, PikaQian, pokemontcg.io, Pokumon et pokemon.com : ils comblaient
// les visuels MANQUANTS (`dejaServi`) et comptaient une entrée marquée comme « servie » ; elle est désormais remplaçable par leur image non marquée.
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

// ============================================================
// ➕ 2026-10-17 (BASSE-DEF) — LE REMPLACEMENT PAR TOUS LES COLLECTEURS (décision du testeur : « une image basseDefinition est remplacée automatiquement dès qu'une source
// au-dessus du seuil existe pour ce produit, avec l'ancienne adresse gardée dans l'historique »).
// ============================================================
// Les collecteurs « combleurs » (TPC, PikaQian, pokemontcg.io, Pokumon, pokemon.com) s'arrêtaient à `dejaServi` : une entrée marquée comptait comme servie. Ils appellent désormais
// LES MÊMES fonctions que les trois jointures (artofpkm, Bulbapedia, TCGdex) — aucune copie de la règle (§21 bis) :
//   · AU PLAN (`sansRemplacables`) : une entrée marquée d'une AUTRE source, de même (set, numéro, langue connue), ne compte pas comme « servie » — la carte est un trou que la source
//     peut combler, À CONDITION que son image sorte non marquée (sinon, à la jointure, elle cède). Une entrée marquée de la MÊME source n'est jamais remplaçable : le même fichier
//     reviendrait, au même nombre de pixels. Langue inconnue du candidat : rien n'est remplaçable (une garde s'écrit par ce qu'elle autorise).
//   · À LA JOINTURE (`arbitrer`) : la décision d'une candidate — quelles entrées sortent (`entreesARemplacer`), la fiche reste-t-elle servie une fois celles-là sorties. Une candidate
//     marquée ne fait sortir personne et cède : une basse définition ne remplace JAMAIS une image non marquée, ni une autre basse définition.
//   · LE GESTE (`remplacerBasseDefinition`, ci-dessus) : l'entrée sort de `cartes.images`, le document `images` RESTE (`etat: 'remplace'`, `remplacePar`, `remplaceLe`) avec son
//     `urlOriginal`, sa `cleR2`, ses largeurs : c'est « l'ancienne adresse gardée dans l'historique ». Le collecteur note l'`empreinteEntree` de chaque entrée sortie pour sa garde
//     interne (les entrées des autres sources doivent rester les mêmes, moins celles-là) ; la garde de LOT voit un échange 1 pour 1 (images du set inchangées, vignette refaite).
/** La clé d'une entrée dans la garde interne des collecteurs (`compterEntrees`) : carte|source|set|numéro|cleR2. */
const empreinteEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;

/**
 * La carte telle que la voit le PLAN d'une source `source` qui écrira en `langue` au `numero` du `set` : sans les entrées marquées qu'une image non marquée de cette source
 * remplacerait. Rend une COPIE (la carte d'origine n'est pas modifiée). Pure.
 */
function sansRemplacables(carte, { set, numero, langue, source, wOriginal } = {}) {
    const images = Array.isArray(carte?.images) ? carte.images : [];
    // `wOriginal` : la largeur de l'image que la source donnera, quand le plan la connaît (l'index de Pokumon la porte) ; inconnue, la candidate est supposée non marquée
    const sortent = entreesARemplacer(images, { set, numero, langue, source, cleR2: null, wOriginal })
        .filter(e => e.source !== source);
    return { ...(carte || {}), images: images.filter(e => !sortent.includes(e)) };
}

/**
 * L'ARBITRAGE d'une candidate à la jointure. `autres` : les entrées de la carte qui ne sont pas les nôtres ; `candidat` : l'entrée qu'on va poser (set, source, cleR2, numero, langue,
 * marque / largeur) ; `servi(restantes)` : le prédicat « déjà servi » de CE collecteur sur les entrées qui resteraient. @returns {{sortantes: object[], servie: boolean}}
 * `servie` vrai : la candidate CÈDE (elle n'est pas posée, rien ne sort). Faux : le collecteur appelle `remplacerBasseDefinition` (s'il y a des sortantes) puis pose la candidate.
 */
function arbitrer(autres, candidat, servi) {
    const liste = Array.isArray(autres) ? autres : [];
    const sortantes = entreesARemplacer(liste, candidat);
    return { sortantes, servie: !!servi(liste.filter(e => !sortantes.includes(e))) };
}

module.exports = { marqueDe, entreesARemplacer, remplacerBasseDefinition, empreinteEntree, sansRemplacables, arbitrer };
