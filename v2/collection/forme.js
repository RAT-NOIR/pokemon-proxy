'use strict';
// Ma collection — la FORME d'une clé de fiche et d'un slug de set. Le serveur ne PEUT PAS vérifier qu'une clé désigne une fiche réelle (l'API ne lit jamais la base `cartes`,
// voir identifier/catalogue.js) : il valide la forme, et la garde est écrite par ce qu'elle AUTORISE.
// Jeu de caractères DÉRIVÉ des données du site (v2/test/test-collection-forme.js le confronte à 40 444 impressions, lecture seule) :
//   · numéro : lettres, chiffres, espace, « ( ) . ! ? - » (« Recommended Rules No. 2 », « SWSH155 (Top Left) », « ! », « ? »), 32 caractères au plus, ni espace de tête ni de queue ;
//     jamais « | » (séparateur de la clé), ni « < » (reste de commentaire wikitext dans 2 numéros corrompus à la source : ils sont refusés, et dits) ;
//   · slug : lettres, chiffres, « - », et « / » (les codes de set comme `S-P/ID`) ; 80 caractères au plus ; ni début ni fin sur « - » ou « / », jamais « // ».
const CARACTERES_NUMERO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ().!?-';
const NUMERO = /^[A-Za-z0-9().!?-](?:[A-Za-z0-9 ().!?-]{0,30}[A-Za-z0-9().!?-])?$/;
const CLE = /^([1-9][0-9]{0,11})\|(.+)$/s;
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9/-]{0,78}[A-Za-z0-9])?$/;

const cleValide = c => {
    if (typeof c !== 'string') return false;
    const m = CLE.exec(c);
    return Boolean(m) && NUMERO.test(m[2]);
};
const slugValide = s => typeof s === 'string' && SLUG.test(s) && !s.includes('//');
module.exports = { cleValide, slugValide, CARACTERES_NUMERO, NUMERO, CLE, SLUG };
