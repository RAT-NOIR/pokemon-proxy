// ============================================================
// LA JOINTURE D'UNE IMAGE artofpkm À UNE FICHE SIMPLE — le numéro ET le nom, deux éléments indépendants (T3d, 2026-10-12)
// ============================================================
// 🔴 LA CAUSE. Une fiche simple (set « sans page », creer-sets-sans-page.js) porte UNE impression
//    { tirage, expansion: lisible(slug), numero, source: 'cardmarket' } — le nom lisible du SLUG, sans ponctuation. La ligne de table, elle,
//    nomme l'expansion telle que la déclarent les pages de carte (« Movie Commemoration VS Pack: Aura's Lucario », « Sun & Moon Family
//    Pokémon Card Game »). `impsDe` de `joindreImages` compare l'expansion à l'égalité : il ne voyait aucune fiche simple (SMF 13 cartes sur 51,
//    MAL 1 sur 20), la clé par numéro ne désignait rien, l'image — en base, au bon numéro — retombait sur le repli par le nom, puis en reste
//    (`image-sans-carte`, `image-sous-section-non-confirmee`, `image-vers-plusieurs-cartes`).
// ✅ LA RÈGLE, écrite par ce qu'elle AUTORISE : une image se joint à une fiche simple si et seulement si
//    (1) la carte est une fiche simple DU SET (`ficheSimple` posé, le slug dans `sets`), et son impression de Cardmarket pour (tirage,
//        lisible(slug)) porte le MÊME numéro que l'image (`cleNumero`, préfixe alphabétique gardé, §21 bis) ;
//    (2) ET le nom de l'image est celui de la carte — le témoin du nom de jointure.js, côté POSITIF : `clesNom(nomJointDe(carte))` et
//        `clesNom(nom de l'image)` ont une clé en commun, la comparaison même de `temoinDuNom`. Pas de nom, pas de jointure : un numéro
//        seul peut désigner la mauvaise carte (§16, « 0 ambigu ne veut pas dire 0 faux »).
//    Un nom variant (« Ash Ketchum's » pour « Ash's », « Professor's Research » pour « Professor's Research - Professor Birch ») ne passe
//    PAS : la seule règle de forme en production (`declarantePrefixeMemeNumero`, declarantes.js) lit l'autre sens (le nom du PRODUIT préfixé
//    par celui de la carte) ; il reste un trou, nommé en reste.
// ⚠️ STRICTEMENT ADDITIVE : l'appelant ne consulte cette voie que lorsque la clé par numéro ordinaire n'a rien désigné.
const { clesNom, nomJointDe, cleNumero, normaliserNom } = require('./jointure');
const { lisible } = require('./nom-affichage');

// la normalisation du nom d'une image (déplacée de collecteur-images.js : une seule définition). Les crochets de Cardmarket portent des
// attaques et sont lus ailleurs ; ici, sur des noms source, ils n'ont pas d'autre usage que la lettre.
const nomImage = n => normaliserNom(String(n ?? '').replace(/[\[\]]/g, ' '));

/** L'expansion que creer-sets-sans-page.js écrit sur l'impression d'une fiche simple (`nomExp` = `lisible(slug)`). */
const expansionDeFicheSimple = slug => lisible(slug);

/** Les impressions de Cardmarket par lesquelles une fiche simple appartient à CE set. */
function impressionsFicheSimple(c, { slug, tirage }) {
    if (!c?.ficheSimple || !Array.isArray(c.sets) || !c.sets.includes(slug)) return [];
    return (c.impressions || []).filter(i => i && i.source === 'cardmarket' && i.tirage === tirage && i.expansion === expansionDeFicheSimple(slug));
}

/**
 * @param im     le document image ({ numero, nomEn })
 * @param cartes les cartes du set (`sets: slug`)
 * @param o      { slug, tirage }
 * @returns les fiches simples dont le numéro ET le nom sont ceux de l'image ([] si l'un des deux manque ou diffère)
 */
function candidatesParFicheSimple(im, cartes, o) {
    const k = cleNumero(im?.numero);
    if (!k || !im?.nomEn) return [];
    const clesImage = clesNom(String(im.nomEn).replace(/[\[\]]/g, ' '));
    return cartes.filter(c => c.nomEn
        && impressionsFicheSimple(c, o).some(i => cleNumero(i.numero) === k)
        && clesNom(nomJointDe(c)).some(x => clesImage.includes(x)));
}

module.exports = { candidatesParFicheSimple, impressionsFicheSimple, expansionDeFicheSimple, nomImage };
