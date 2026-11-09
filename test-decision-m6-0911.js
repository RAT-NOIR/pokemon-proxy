// Banc de la décision 2026-11-09-m6 (Storm Emeralda, 3 produits V2 de stades) : données seulement, aucune connexion.
const { DECISIONS } = require('./poser-fiches-prouvees');
const { VOIES } = require('./collecte-cartes/fiches-prouvees');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom} : ${e.message}`); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const d = DECISIONS['2026-11-09-m6'] || [];
t('liste fermée : 3 produits distincts, bonnes cartes', () => eq(d.map(x => [x.idProduct, x.carteId, x.numeroFiche]), [[900083, 359046, '072'], [900085, 358151, '074'], [900089, 359375, '076']]));
t('set et tirage', () => eq(d.map(x => [x.code, x.idExpansion, x.slugSet, x.tirage, x.voie, x.expansionImpression, x.ajoutSet]), Array(3).fill(['m6', 6636, 'Storm-Emeralda', 'jp', 'impression-numero', 'Storm Emeralda', false])));
t('voie connue', () => eq(d.map(x => VOIES.includes(x.voie)), [true, true, true]));
t('preuve : au moins 2 sources, références en URL', () => eq(d.map(x => [x.preuve?.sources?.length >= 2, (x.preuve?.references || []).length >= 2 && x.preuve.references.every(r => /^https:\/\//.test(r))]), Array(3).fill([true, true])));
console.log(`${ko ? 'ROUGE' : 'VERT'} : ${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
