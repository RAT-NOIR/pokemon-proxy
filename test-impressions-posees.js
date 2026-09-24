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

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
