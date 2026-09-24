// node test-issue-unite.js — ce que le worker fait d'une unité finie. LOR et CRE (2026-09-24) sont sortis `refuse` pour
// 2 et 3 réponses 503 du CDN TCGdex : une surcharge passagère prise pour un verdict sur le set. Le §17 le disait pour
// un set interrompu — « un arrêt n'est pas un verdict » —, le §38 exige une REPRISE : une unité dont les seuls échecs
// sont transitoires revient en file, EN QUEUE et pas avant 10 min, bornée à 3 passages ; ensuite elle refuse et le dit.
const { issueDeLUnite, echecTransitoire, TENTATIVES_MAX } = require('./collecte-cartes/issue-unite');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const maintenant = new Date('2026-09-24T12:00:00Z');
const sans = (o, ...cles) => Object.fromEntries(Object.entries(o).filter(([k]) => !cles.includes(k)));

verifier('verifie → fait', issueDeLUnite({ etat: 'verifie' }, {}, maintenant), { etat: 'fait', arreter: false });
verifier('interrompu → attente, et le worker s\'arrête', issueDeLUnite({ etat: 'interrompu' }, {}, maintenant), { etat: 'attente', arreter: true });
const r1 = issueDeLUnite({ etat: 'incomplet-transitoire' }, {}, maintenant);
verifier('1er passage transitoire → attente en queue, tentative 1, pas avant 10 min, on continue',
    sans(r1, 'pasAvant'), { etat: 'attente', arreter: false, enQueue: true, tentatives: 1 });
verifier('   pasAvant = maintenant + 10 min', r1.pasAvant?.toISOString(), '2026-09-24T12:10:00.000Z');
verifier('2e passage transitoire → attente, tentative 2', sans(issueDeLUnite({ etat: 'incomplet-transitoire' }, { tentatives: 1 }, maintenant), 'pasAvant'),
    { etat: 'attente', arreter: false, enQueue: true, tentatives: 2 });
verifier(`${TENTATIVES_MAX}e passage transitoire → refuse, et le compte est écrit`, issueDeLUnite({ etat: 'incomplet-transitoire' }, { tentatives: TENTATIVES_MAX - 1 }, maintenant),
    { etat: 'refuse', arreter: false, tentatives: TENTATIVES_MAX });
verifier('incomplet (échec non transitoire) → refuse', issueDeLUnite({ etat: 'incomplet' }, {}, maintenant), { etat: 'refuse', arreter: false });
verifier('un état inconnu → refuse (la garde s\'écrit par ce qu\'elle autorise)', issueDeLUnite({ etat: 'quelque-chose' }, {}, maintenant), { etat: 'refuse', arreter: false });

const err = (message, status) => Object.assign(new Error(message), status ? { status } : {});
verifier('503 → transitoire', echecTransitoire(err('503 https://assets.tcgdex.net/en/swsh/swsh6/51/high.png', 503)), true);
verifier('502 → transitoire', echecTransitoire(err('502 https://x', 502)), true);
verifier('ECONNRESET → transitoire', echecTransitoire(err('ECONNRESET https://x')), true);
verifier('ETIMEDOUT / ECONNABORTED → transitoire', [echecTransitoire(err('ETIMEDOUT https://x')), echecTransitoire(err('ECONNABORTED https://x'))], [true, true]);
verifier('l\'erreur ÉCRITE en base (message seul, sans status) : « 503 https://… » → transitoire', echecTransitoire({ message: '503 https://assets.tcgdex.net/en/swsh/swsh11/178/high.png' }), true);
verifier('   « 404 https://… » écrit en base → définitif', echecTransitoire({ message: '404 https://x' }), false);
verifier('404 « absent chez TCGdex » → définitif', echecTransitoire(err('absent chez TCGdex (404)')), false);
verifier('une image illisible (sharp) → définitif', echecTransitoire(err('Input buffer contains unsupported image format')), false);
verifier('un verrou perdu → définitif pour ce passage (l\'unité est interrompue, pas incomplète)', echecTransitoire(err('TCGdex : verrou global PERDU — pas de requête sans verrou')), false);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
