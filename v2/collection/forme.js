'use strict';
// Ma collection — la FORME d'une clé de fiche et d'un slug de set. Le serveur ne PEUT PAS vérifier qu'une clé désigne une fiche réelle (l'API ne lit jamais la base `cartes`,
// voir identifier/catalogue.js) : il valide la forme, et la garde est écrite par ce qu'elle AUTORISE.
// Jeu de caractères DÉRIVÉ des données du site (v2/test/test-collection-forme.js le confronte à 40 444 impressions, lecture seule) :
//   · numéro : lettres, chiffres, espace, « ( ) . ! ? - » (« Recommended Rules No. 2 », « SWSH155 (Top Left) », « ! », « ? »), 32 caractères au plus, ni espace de tête ni de queue ;
//     jamais « | » (séparateur de la clé), ni « < » (reste de commentaire wikitext dans 2 numéros corrompus à la source : ils sont refusés, et dits) ;
//   · slug : lettres, chiffres, « - », et « / » (les codes de set comme `S-P/ID`) ; 80 caractères au plus ; ni début ni fin sur « - » ou « / », jamais « // ».
const CARACTERES_NUMERO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ().!?-';
const NUMERO = /^[A-Za-z0-9().!?-](?:[A-Za-z0-9 ().!?-]{0,30}[A-Za-z0-9().!?-])?$/;
// idInterne : un entier sans zéro de tête, 12 chiffres au plus, NÉGATIF pour une fiche simple (`_id < 0` de la carte : 1 512 le 2026-10-11, ruling 8 bis) — jamais « -0 », jamais « + ».
const CLE = /^(-?[1-9][0-9]{0,11})\|(.+)$/s;
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9/-]{0,78}[A-Za-z0-9])?$/;

const cleValide = c => {
    if (typeof c !== 'string') return false;
    const m = CLE.exec(c);
    return Boolean(m) && NUMERO.test(m[2]);
};
const slugValide = s => typeof s === 'string' && SLUG.test(s) && !s.includes('//');
// L5/L6 — ÉTAT et LANGUE d'un exemplaire : deux listes FERMÉES (une valeur hors liste est refusée, jamais normalisée). L'échelle des états est celle de Cardmarket pour les cartes à l'unité, sans
// (MT mint, ajouté au tour de correction : le site K5 le liste) : NM near mint, EX excellent, GD good, LP light played, PL played, PO poor. Les langues sont celles du catalogue (identifier/produit.js::LANGUES, que
// test-collection-exemplaires.js confronte) plus `id` et `th`, les deux tirages d'Asie du Sud-Est du catalogue. Ajouter une valeur est additif ; en retirer une ne l'est pas.
const ETATS = Object.freeze(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
const LANGUES = Object.freeze(['fr', 'en', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'cs', 'hu', 'ja', 'ko', 'zh-hans', 'zh-hant', 'id', 'th']);
const etatValide = x => typeof x === 'string' && ETATS.includes(x);
const langueValide = x => typeof x === 'string' && LANGUES.includes(x);
// idProduct (route par produit) : un entier décimal sans zéro de tête, 10 chiffres au plus (les identifiants Cardmarket tiennent sur 7), jamais de signe, d'espace ni d'exposant.
const ID_PRODUIT = /^[1-9][0-9]{0,9}$/;
const idProduitValide = s => typeof s === 'string' && ID_PRODUIT.test(s);
module.exports = { ETATS, LANGUES, etatValide, langueValide, idProduitValide, cleValide, slugValide, CARACTERES_NUMERO, NUMERO, CLE, SLUG };
