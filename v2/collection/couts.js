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
// (+ l'`epoque` du registre recopiée dans le document : type 1 + nom 7 + longueur 4 + 16 caractères + NUL = 29 o, d'où 330 et non 300)
const EPOQUE = 32;                                  // 29 o de BSON par champ + la granularité des pages d'index : +30,4 o mesurés par document de compte, +29,0 par registre (le banc de budget confronte à collStats un document et un registre AVEC et SANS époque)
const DOCUMENT_BASE = 300 + EPOQUE;
// le DOCUMENT du registre d'un set : `_id` = le slug (index `_id` compris), l'en-tête du tableau `cles`, et son `epoque` (29 o) : 90 + 30.
const REGISTRE_BASE = 90 + EPOQUE;

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

// ── L5/L6 : le DÉTAIL par exemplaire (`ex`), un tableau d'éléments « cle\netat\nlangue\nN » (état et langue vides = non précisés ; N de 1 à 99). Absent des documents d'avant : le coût d'un document sans `ex` n'a pas bougé.
//   · EX_BASE : le champ-tableau lui-même (type 1 + nom « ex\0 » 3 + longueur 4 + terminateur 1 = 9 o → 16), payé par la première entrée d'un document ;
//   · une entrée : l'en-tête d'élément (ELEMENT, 12 o) + la clé + 3 « \n » + l'état (≤ 2 o) + la langue (≤ 7 o : « zh-hans ») + N (≤ 2 o) — majorée aux plus longs admis, jamais une moyenne.
const EX_BASE = 16, EX_ETAT_MAX = 2, EX_LANGUE_MAX = 7, EX_QUANTITE_MAX = 2;
const exemplaire = cle => ELEMENT + octets(cle) + 3 + EX_ETAT_MAX + EX_LANGUE_MAX + EX_QUANTITE_MAX;
const elementEx = (cle, etat, langue, q) => `${cle}\n${etat || ''}\n${langue || ''}\n${q}`;
/** « cle\netat\nlangue\nN » → { cle, etat ('' = non précisé), langue, q }. */
function lireElementEx(e) {
    const p = e.split('\n');
    return { cle: p[0], etat: p[1] || '', langue: p[2] || '', q: Number(p[3]) };
}

/** Le coût MODÉLISÉ de ce qui est stocké dans un document de compte (ce qu'une suppression rend). `doc` : { set, mots, hors, qte, ex }. */
function coutDuDocument(doc) {
    let n = document(doc.set);
    n += Object.keys(doc.mots || {}).length * mot;
    for (const e of doc.hors || []) { const { cle, q } = lireElementHors(e); n += hors(cle, q); }
    n += Object.keys(doc.qte || {}).length * qte;
    if (doc.ex && doc.ex.length) { n += EX_BASE; for (const e of doc.ex) n += exemplaire(lireElementEx(e).cle); }
    return n;
}
module.exports = { EX_BASE, exemplaire, elementEx, lireElementEx, EPOQUE, octets, mot, qte, document, hors, registreEntree, registreDocument, elementHors, lireElementHors, coutDuDocument, DOCUMENT_BASE, REGISTRE_BASE, ELEMENT, SUFFIXE_QUANTITE };
