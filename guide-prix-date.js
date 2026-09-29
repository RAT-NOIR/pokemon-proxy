// LA DATE DU GUIDE DES PRIX DANS LA RÉPONSE DE L'API — décision du testeur, 2026-09-28 : « API : renvoie la date du guide des prix »
// (guide : API et extension uniquement, JAMAIS affiché sur le site).
//
// D'où vient la date : import-price-guide.js écrit sur chaque ligne de `guide_prix` la date du FICHIER (`guideDu` = son createdAt),
// et dans `guide_prix_meta` ({ _id: 'dernier' }) celle du guide le plus récent importé. Un produit absent du dernier guide garde son
// dernier prix ET sa date : c'est ce qui rend un prix périmé LISIBLE, au lieu de le laisser passer pour un prix du jour.
//
// Ce que la réponse porte, et rien d'autre — des FAITS, aucun seuil : combien de jours rend un prix « trop vieux » dépend de la
// carte (22,6 % des cartes à 10–50 € ont bougé de plus de 20 % en 28 jours, mesure de l'en-tête d'import-price-guide.js) ; c'est
// à l'extension de décider comment le montrer.
//   · `dernierGuide`          : le guide le plus récent importé, ou null (méta absente — imports d'avant le 2026-09-28) ;
//   · `guideDuGagnant`        : le guide dont vient le prix du gagnant, ou null (aucune ligne, ou ligne d'avant le champ) ;
//   · `ageJours`              : jours ENTIERS entre ce guide et le moment de la réponse, ou null ;
//   · `absentDuDernierGuide`  : true = le produit n'était pas dans le dernier guide, son prix vient d'un guide plus ancien ;
//                               null = on ne sait pas (une des deux dates manque) — jamais `false` par défaut.
const JOUR_MS = 86400000;
const iso = d => (d instanceof Date && !Number.isNaN(d.getTime())) ? d.toISOString() : null;

function blocGuidePrix({ guideDuGagnant = null, dernierGuide = null, maintenant = new Date() } = {}) {
    const g = iso(guideDuGagnant) ? guideDuGagnant : null, der = iso(dernierGuide) ? dernierGuide : null;
    return {
        dernierGuide: iso(der),
        guideDuGagnant: iso(g),
        ageJours: g ? Math.max(0, Math.floor((maintenant.getTime() - g.getTime()) / JOUR_MS)) : null,
        absentDuDernierGuide: g && der ? g.getTime() < der.getTime() : null
    };
}

module.exports = { blocGuidePrix, iso };
