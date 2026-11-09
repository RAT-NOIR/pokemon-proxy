// Banc de la décision 2026-11-09-560010 (Nest Ball, Ultra Sun n°056) : données seulement, aucune connexion.
const { DECISIONS } = require('./poser-fiches-prouvees');
const { VOIES } = require('./collecte-cartes/fiches-prouvees');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom} : ${e.message}`); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const d = DECISIONS['2026-11-09-560010'] || [];
t('liste fermée : un produit, une carte', () => eq(d.map(x => [x.idProduct, x.carteId, x.numeroFiche]), [[560010, 217135, '056']]));
t('set, tirage, voie, expansion', () => eq(d.map(x => [x.idExpansion, x.slugSet, x.tirage, x.voie, x.expansionImpression, x.ajoutSet]), [[3911, 'Ultra-Sun', 'jp', 'impression-numero', 'Ultra Sun', false]]));
t('voie connue', () => eq(d.map(x => VOIES.includes(x.voie)), [true]));
t('preuve : deux sources, références https', () => eq(d.map(x => [x.preuve?.sources?.length >= 2, (x.preuve?.references || []).length >= 2 && x.preuve.references.every(r => /^https:\/\//.test(r))]), [[true, true]]));
console.log(`${ko ? 'ROUGE' : 'VERT'} : ${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
