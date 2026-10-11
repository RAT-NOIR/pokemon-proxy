'use strict';
// COLLECTION-COMPACTE — le MODÈLE DE COÛT, en OCTETS, de ce que « Ma collection » écrit dans la grappe de production (collections `collection_fiches` et `collection_registre`).
// Une écriture RÉSERVE ce modèle au pire cas AVANT d'écrire (service.js) ; le banc `test-collection-budget.js` le confronte à `collStats` (données + index, après `fsync` et une pause) sur des
// formes extrêmes et ÉCHOUE si une forme coûte plus que ce que le modèle réserve. Chaque constante est un MAJORANT mesuré (BSON : type 1 o + nom du champ + valeur), jamais une moyenne.
const octets = s => Buffer.byteLength(String(s), 'utf8');

// un mot de 64 bits dans `mots` : type (1) + nom « 0…1023 » (≤ 4 chiffres + NUL) + int64 (8) = 14 o → 16
const mot = 16;
// une entrée de `qte` : type (1) + nom « position » (≤ 5 chiffres + NUL) + int32 (4) = 11 o → 12
const qte = 12;
// un élément de tableau (`hors`, `cles` du registre) : type (1) + indice (≤ 5 chiffres + NUL) + longueur (4) + octets de la chaîne + NUL = 12 + octets
const ELEMENT = 12;
// la quantité d'une clé `hors` s'écrit à la suite de la clé : « \n » + 1 ou 2 chiffres (3 o au plus)
const SUFFIXE_QUANTITE = 3;
// le DOCUMENT d'un compte pour un set : `_id` (17), `compteId` (22), `set` (≥ 10 + octets), `majLe` (15), `mots`/`hors`/`qte` (au plus 3 sous-documents vides de 11 o), en-tête (5) ; l'entrée de l'index
// unique (compteId, set) et celle de `_id` (≥ 30 + 12 + octets du slug) — mesuré, voir le banc. Le slug compte deux fois (donnée et index).
const DOCUMENT_BASE = 300;
// le DOCUMENT du registre d'un set : `_id` = le slug (index `_id` compris), l'en-tête du tableau `cles`.
const REGISTRE_BASE = 90;

const document = slug => DOCUMENT_BASE + 2 * octets(slug);
const hors = (cle, q = 1) => ELEMENT + octets(cle) + (q >= 2 ? SUFFIXE_QUANTITE : 0);
const registreEntree = cle => ELEMENT + octets(cle);
const registreDocument = slug => REGISTRE_BASE + 2 * octets(slug);

// ── l'élément de `hors` : « cle » (quantité 1) ou « cle\nN » (N de 2 à 99). Le « \n » ne peut pas figurer dans une clé (forme.js : jamais de saut de ligne dans un numéro).
const elementHors = (cle, q) => (q >= 2 ? `${cle}\n${q}` : cle);
function lireElementHors(e) {
    const i = e.indexOf('\n');
    return i < 0 ? { cle: e, q: 1 } : { cle: e.slice(0, i), q: Number(e.slice(i + 1)) };
}

/** Le coût MODÉLISÉ de ce qui est stocké dans un document de compte (ce qu'une suppression rend). `doc` : { set, mots, hors, qte }. */
function coutDuDocument(doc) {
    let n = document(doc.set);
    n += Object.keys(doc.mots || {}).length * mot;
    for (const e of doc.hors || []) { const { cle, q } = lireElementHors(e); n += hors(cle, q); }
    n += Object.keys(doc.qte || {}).length * qte;
    return n;
}
module.exports = { octets, mot, qte, document, hors, registreEntree, registreDocument, elementHors, lireElementHors, coutDuDocument, DOCUMENT_BASE, REGISTRE_BASE, ELEMENT, SUFFIXE_QUANTITE };
