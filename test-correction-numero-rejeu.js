// Une correction de numéro (corriger-numero-impression.js) survit à un rejeu : reporterChampsPoses (impressions-posees.js), le point commun
// de collecteur-texte.js, page-de-carte.js, rejouer-impressions.js et champs-du-rejeu.js.
const { reporterChampsPoses, CHAMPS_CORRECTION_NUMERO } = require('./collecte-cartes/impressions-posees');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom} : ${e.message}`); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const D = new Date('2026-11-09T10:00:00Z');
const parseur = (n, extra = {}) => ({ tirage: 'jp', expansion: 'Ultra Sun', deck: null, numero: n, total: '066', rarete: 'C', ...extra });
const corrigee = (extra = {}) => parseur('056', { numeroAvant: '055', numeroCorrigeLe: D, numeroCorrigeMotif: 'deux sources', ...extra });
const autre = { tirage: 'intl', expansion: 'Ultra Sun', deck: null, numero: '119', total: '156' };

t('liste fermée des champs de correction', () => eq(CHAMPS_CORRECTION_NUMERO, ['numeroAvant', 'numeroCorrigeLe', 'numeroCorrigeMotif']));
t('le parseur rend jp|Ultra Sun|055 : l\'impression reste à 056, garde numeroAvant, date et motif, sans doublon', () => {
    const r = reporterChampsPoses([corrigee(), autre], [parseur('055'), autre]);
    eq(r.impressions.length, 2);
    eq(r.impressions[0], parseur('056', { numeroAvant: '055', numeroCorrigeLe: D, numeroCorrigeMotif: 'deux sources' }));
    eq(r.impressions[1], autre);
    eq(r.impressions.filter(i => i.numero === '055').length, 0);
});
t('les champs du parseur (total, rareté) restent ceux du parseur', () => eq(reporterChampsPoses([corrigee({ rarete: 'XX' })], [parseur('055', { rarete: 'U' })]).impressions[0].rarete, 'U'));
t('compté à part', () => eq(reporterChampsPoses([corrigee()], [parseur('055')]).corrigees, 1));
t('idempotent : un second rejeu rend le même résultat', () => {
    const a = reporterChampsPoses([corrigee()], [parseur('055')]).impressions;
    eq(reporterChampsPoses(a, [parseur('055')]).impressions, a);
});
t('si le parseur rend déjà 056, la sienne vaut et la correction est sans objet (pas de doublon)', () => {
    const r = reporterChampsPoses([corrigee()], [parseur('056')]);
    eq(r.impressions, [parseur('056')]); eq(r.corrigees, 0);
});
t('si le parseur ne rend plus 055 ni 056, l\'impression corrigée n\'est pas inventée', () => eq(reporterChampsPoses([corrigee()], [parseur('070')]).impressions.map(i => i.numero), ['070']));
t('une autre impression du même set au parseur à 055 n\'est pas touchée si la clé diffère (autre deck)', () => {
    const r = reporterChampsPoses([corrigee()], [parseur('055', { deck: 'X' })]);
    eq(r.impressions.map(i => `${i.deck}|${i.numero}`), ['X|055']);
});
t('sans marque de correction : comportement inchangé (numéro corrigé à l\'œil perdu, comptée)', () => {
    const r = reporterChampsPoses([parseur('056', { illustrateur: 'A' })], [parseur('055')]);
    eq(r.impressions.map(i => i.numero), ['055']); eq(r.perdus, 1);
});
t('deux 055 rendus par le parseur : aucune devinette, rien n\'est remplacé', () => eq(reporterChampsPoses([corrigee()], [parseur('055'), parseur('055')]).impressions.map(i => i.numero), ['055', '055']));
console.log(`${ko ? 'ROUGE' : 'VERT'} : ${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
