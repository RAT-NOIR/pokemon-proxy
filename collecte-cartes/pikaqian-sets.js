// ============================================================
// LES SETS QUE PIKAQIAN SERT — une ligne par set zh-hans de notre base ; ÉCRITE PAR CE QU'ELLE AUTORISE (§51)
// ============================================================
// Générée le 2026-10-11 depuis la MESURE du 2026-10-10 (MESURE-PIKAQIAN.md §6-7) et la lecture seule de la base `cartes` (sets au tirage
// `zh-hans`, leur code Cardmarket `sets.code`, leurs produits joints) : 95 sets au tirage zh-hans, 91 dont le code a une page chez pikaqian.
// `codePk` : le code que pikaqian écrit dans l'adresse — le code Cardmarket en minuscules (CSV10C → csv10c, CS1bC → cs1bc, 151C → 151c,
// CSM2.5C → csm2.5c), les promos sous `promo-*` (SV-P/CS → promo-sv-p). Un code ne se traduit pas (§39).
// 🕳️ Sans page chez pikaqian, donc sans ligne (trous nommés) : CSMPC Battle Party Set (305 produits joints), CSVM1C Master Strategy (82),
// CSVM2 Master Strategy Vol. 2 (97), 30thDC 30th Celebration Premium Deck Set (45).
// 🔑 Seules 3 pages sont MESURÉES (CSV10C, CS1bC, 151C : 675 appariés sur 678) ; les 88 autres ne le sont pas, et leur appariement n'est pas
// promis — la PREUVE par produit (collecte-cartes/pikaqian.js) décide à chaque collecte, un doute est un trou. La garde de la page est
// la majorité de ses tuiles au code du set (`verdictDePage`), pas un nombre de cartes qu'on n'a pas mesuré.
// `trous` : les produits joints le 2026-10-11, pour l'ordre de passage (plus gros d'abord) — jamais une promesse.
const lignes = require('./pikaqian-sets.json');
const TABLE_PIKAQIAN = Object.freeze(lignes.map(l => Object.freeze({ ...l, site: 'pikaqian' })));
const lignePikaqian = slug => TABLE_PIKAQIAN.find(l => l.slug === slug) || null;
/** L'unité de file d'une ligne — la forme que l'outil d'enfilage insère et que la garde du collecteur (`releve`) accepte, mot pour mot. */
const uniteDeLaLigne = L => ({ _id: `pikaqian/${L.slug}`, source: 'pikaqian', slugSet: L.slug, code: L.code, codePk: L.codePk, langue: L.langue, trous: L.trous });
module.exports = { TABLE_PIKAQIAN, lignePikaqian, uniteDeLaLigne };
