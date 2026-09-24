// node test-impressions-posees.js — un parseur qui réécrit `impressions` en entier n'efface plus les champs posés APRÈS lui
// (collecte-cartes/impressions-posees.js). Le cas réel : les recollectes du 2026-09-24 (xASC, HSP) ont effacé 2 179
// illustrateurs posés par construire-illustrateurs.js.
const { reporterChampsPoses } = require('./collecte-cartes/impressions-posees');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const imp = (numero, extra = {}) => ({ tirage: 'jp', expansion: 'Alolan Moonlight', deck: null, numero, total: '050', ...extra });
const anciennes = [imp('011', { illustrateur: 'OOYAMA', illustrateurPreuve: 'TCGdex SM2L-011' }), { tirage: 'intl', expansion: 'Guardians Rising', deck: null, numero: '36', illustrateur: null, illustrateurPreuve: 'silence' }];

const R1 = reporterChampsPoses(anciennes, [imp('011'), { tirage: 'intl', expansion: 'Guardians Rising', deck: null, numero: '36' }]);
verifier('même clé : l\'illustrateur et sa preuve sont reportés', R1.impressions[0], imp('011', { illustrateur: 'OOYAMA', illustrateurPreuve: 'TCGdex SM2L-011' }));
verifier('un illustrateur NULL avec sa preuve se reporte aussi (le silence est une information)', [R1.impressions[1].illustrateur, R1.impressions[1].illustrateurPreuve], [null, 'silence']);
verifier('compte : 2 reportées, 0 perdue', [R1.reportes, R1.perdus], [2, 0]);

const R2 = reporterChampsPoses(anciennes, [imp('012'), { tirage: 'intl', expansion: 'Guardians Rising', deck: null, numero: '36' }]);
verifier('numéro CORRIGÉ (011 → 012) : rien n\'est reporté — c\'était l\'illustrateur d\'un autre numéro', 'illustrateur' in R2.impressions[0], false);
verifier('et la perte est COMPTÉE, pas tue', R2.perdus, 1);

const R3 = reporterChampsPoses(anciennes, [imp('011', { illustrateur: 'Aya Kusube' })]);
verifier('un champ déjà rendu par le parseur n\'est jamais écrasé', R3.impressions[0].illustrateur, 'Aya Kusube');
verifier('rien d\'ancien (carte neuve) : les impressions passent telles quelles', reporterChampsPoses(undefined, [imp('001')]).impressions, [imp('001')]);
verifier('le tableau d\'entrée n\'est pas modifié', 'illustrateur' in imp('011'), false);

// 2026-09-24 : une impression ÉCRITE DEPUIS LA SETLIST (tirages chinois, ID, TH : la page de carte ne les déclare pas) n'est
// pas rendue par le parseur. Une relecture de la page la perdait en entier — Lady 136/182 de Storming Emergence Radiant.
const zh = n => ({ tirage: 'zh-hans', expansion: 'Storming Emergence Radiant', numero: n, total: null, deck: null, rarete: null, source: 'setlist' });
const R4 = reporterChampsPoses([imp('011'), zh('136'), zh('182')], [imp('011')]);
verifier('une impression posée depuis la Setlist, absente du parseur, est GARDÉE', R4.impressions.map(i => `${i.tirage}|${i.numero}`), ['jp|011', 'zh-hans|136', 'zh-hans|182']);
verifier('et comptée à part', R4.gardees, 2);
const R5 = reporterChampsPoses([zh('136')], [{ ...zh('136'), source: undefined, rarete: 'SR' }].map(({ source, ...i }) => i));
verifier('si le parseur rend désormais la même clé, c\'est la sienne qui vaut (pas de doublon)', [R5.impressions.length, R5.impressions[0].rarete, R5.gardees], [1, 'SR', 0]);
verifier('une impression SANS source posée qui disparaît n\'est pas gardée (le parseur fait foi)', reporterChampsPoses([imp('099')], [imp('011')]).impressions.map(i => i.numero), ['011']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
