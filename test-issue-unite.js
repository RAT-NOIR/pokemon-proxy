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
// troisième relecture de l'occidental : un 429 (« trop de requêtes »), une résolution DNS ratée, une coupure réseau d'axios sont des
// causes PASSAGÈRES — les ranger en verdict définitif sortait l'impression du manque pour toujours
verifier('429, ENOTFOUND, ERR_NETWORK (vivants et écrits en base) → transitoires',
    [echecTransitoire(err('429 https://x', 429)), echecTransitoire({ message: '429 https://x' }), echecTransitoire(err('ENOTFOUND https://x')), echecTransitoire(err('ERR_NETWORK https://x'))], [true, true, true, true]);
verifier('404 « absent chez TCGdex » → définitif', echecTransitoire(err('absent chez TCGdex (404)')), false);
verifier('une image illisible (sharp) → définitif', echecTransitoire(err('Input buffer contains unsupported image format')), false);
verifier('un verrou perdu → définitif pour ce passage (l\'unité est interrompue, pas incomplète)', echecTransitoire(err('TCGdex : verrou global PERDU — pas de requête sans verrou')), false);

// ── CORRECTION 2 (I1) : un arrêt durable ou une pause d'hôte n'est PAS un verdict — l'unité revient en attente, le worker s'ARRÊTE pour cet hôte, rien n'est rangé en « refuse » ──
const ATTENTE_ARRET = { etat: 'attente', arreter: true };
for (const etat of ['arret-hote', 'pause-hote', 'bloque']) verifier(`I1 : « ${etat} » → attente, et le worker s'arrête`, issueDeLUnite({ etat }, {}, maintenant), ATTENTE_ARRET);
verifier('I1 : « incomplet » portant une pause d\'hôte → attente, le worker s\'arrête (jamais refuse)', issueDeLUnite({ etat: 'incomplet', pauseHote: { hote: 'tcgdex.net' } }, {}, maintenant), ATTENTE_ARRET);
verifier('I1 : « refuse-source-bloquee » portant un arrêt d\'hôte durable → attente, le worker s\'arrête', issueDeLUnite({ etat: 'refuse-source-bloquee', arretHote: { hote: 'artofpkm.com' } }, {}, maintenant), ATTENTE_ARRET);
verifier('I1 : « incomplet » SANS pause (un 404 sur 106) reste refuse', issueDeLUnite({ etat: 'incomplet', pauseHote: null }, {}, maintenant), { etat: 'refuse', arreter: false });
verifier('I1 : un arrêt d\'hôte ne compte pas comme tentative transitoire (aucune pasAvant, aucune tentative)', Object.keys(issueDeLUnite({ etat: 'arret-hote' }, { tentatives: 2 }, maintenant)).sort(), ['arreter', 'etat']);
const { bilanDeLException } = require('./collecte-cartes/issue-unite');
const ex = (message, props) => Object.assign(new Error(message), props);
verifier('I1 : une exception `bloque` (arrêt durable) → bilan « arret-hote », sans jointure, issue = attente + arrêt', [bilanDeLException('A', ex('artofpkm.com ARRÊTÉ', { bloque: true, arretDefinitif: true })).etat, bilanDeLException('A', ex('x', { bloque: true })).sansJointure, issueDeLUnite(bilanDeLException('A', ex('x', { bloque: true })), {}, maintenant)], ['arret-hote', true, ATTENTE_ARRET]);
verifier('I1 : une exception `pauseHote` → bilan « pause-hote », issue = attente + arrêt', [bilanDeLException('A', ex('x', { pauseHote: true })).etat, issueDeLUnite(bilanDeLException('A', ex('x', { pauseHote: true })), {}, maintenant)], ['pause-hote', ATTENTE_ARRET]);
verifier('I1 : une exception 503 → bilan « incomplet-transitoire » (inchangé) ; une autre → « erreur »', [bilanDeLException('A', ex('503 https://x', { status: 503 })).etat, bilanDeLException('A', ex('Input buffer contains unsupported image format')).etat], ['incomplet-transitoire', 'erreur']);
verifier('I1 : le bilan garde le code et le message de l\'exception', (b => [b.code, b.erreur])(bilanDeLException('SV1', ex('quelque chose', { pauseHote: true }))), ['SV1', 'quelque chose']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
