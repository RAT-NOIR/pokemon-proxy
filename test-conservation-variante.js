// node test-conservation-variante.js — un rejeu `collecteur-texte.js --reparser` doit GARDER une ligne cartes_produits portant `variante` (posée par poser-variante-staff.js).
// Le filtre d'effacement est évalué sur des lignes fabriquées, dont celle d'une preuve réelle des 122 (set+numero). TOOL_DIR=<dossier> rejoue le banc contre une copie mutée.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const P = require(path.join(DIR, 'collecte-cartes', 'preuves-jointure.js'));
const filtre = P.filtreDeRegeneration([195232], [2916]);
const efface = l => filtre.carteId.$in.includes(l.carteId) && filtre.idExpansion.$in.includes(l.idExpansion) && filtre.preuve.$in.includes(l.preuve)
    && Object.entries(filtre).filter(([, v]) => '$exists' in v).every(([k, v]) => (l[k] !== undefined) === v.$exists);
const base = { carteId: 195232, idExpansion: 2916, preuve: 'set+numero' };
const cas = [['sans variante (refabricable)', base, true], ['variante + preuve', { ...base, variante: 'staff', variantePreuve: 'x' }, false], ['variante seule', { ...base, variante: 'jumbo' }, false], ['variantePreuve seule', { ...base, variantePreuve: 'x' }, false]];
let ko = 0;
for (const [nom, l, attendu] of cas) { const ok = efface(l) === attendu; if (!ok) ko++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${efface(l) ? 'effacée' : 'gardée'}`); }
console.log(`\n${cas.length - ko} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
