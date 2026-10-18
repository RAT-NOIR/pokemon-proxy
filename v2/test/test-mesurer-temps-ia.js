'use strict';
// Le banc de l'outil de mesure de l'appel au modèle (v2/mesures/mesurer-temps-ia.js) : le PLAFOND DE DÉPENSE tient, d'un lancement à l'autre ; les comparaisons de lecture jugent ce qu'elles doivent.
const M = require('../mesures/mesurer-temps-ia');
let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => { const bon = JSON.stringify(obtenu) === JSON.stringify(attendu); console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); bon ? ok++ : ko++; };

console.log('=== le carnet : le plafond tient ===');
{
    const disque = {};
    const mk = (extra = {}) => M.creerCarnet({ fichier: 'depense.json', plafondUsd: 0.01, ecrire: (f, t) => { disque[f] = t; }, lire: f => { if (!(f in disque)) throw new Error('absent'); return disque[f]; }, ...extra });
    let c = mk();
    v('un carnet neuf peut appeler (rien dépensé, aucun appel observé : réserve = la marge seule)', c.peutAppeler(), true);
    c.compter(0.003); c.compter(0.003);
    v('0,006 $ dépensés, pire appel 0,003 : 0,006 + 0,003 + 0,004 = 0,013 > 0,01 : ARRÊT', c.peutAppeler(), false);
    v('l\'arrêt est écrit avec sa raison', /plafond 0\.01/.test(c.etat().arret || ''), true);
    c = mk();
    v('relancé : le cumul est RELU du disque (0,006), le plafond tient d\'un lancement à l\'autre', [c.etat().cumulUsd, c.peutAppeler()], [0.006, false]);
    const d2 = {}; const c2 = M.creerCarnet({ fichier: 'x', plafondUsd: 0.05, ecrire: (f, t) => { d2[f] = t; }, lire: () => { throw new Error('absent'); } });
    c2.compter(0.003);
    c2.compter(undefined);
    v('un coût ILLISIBLE n\'est jamais 0 : il compte le plus grand de (pire connu, 0,0075 $)', Math.round(c2.etat().cumulUsd * 10000) / 10000, 0.0105);
    v('...et il est compté', c2.etat().sansCout, 1);
    const c3 = M.creerCarnet({ fichier: 'y', plafondUsd: 0.05, ecrire: () => { }, lire: () => { throw new Error('absent'); } });
    c3.compter(null);
    v('un coût illisible sans aucun appel observé : 0,0075 $ (jamais 0)', c3.etat().cumulUsd, 0.0075);
    const c4 = M.creerCarnet({ fichier: 'z', plafondUsd: 0.60, depart: 0.5, ecrire: () => { }, lire: () => { throw new Error('absent'); } });
    v('départ déjà dépensé 0,50 $ : 0,50 + 0 + 0,004 est sous 0,60 : peut appeler', c4.peutAppeler(), true);
    for (let i = 0; i < 40; i++) { if (!c4.peutAppeler()) break; c4.compter(0.0033); }
    v('la boucle s\'arrête avant 0,60 $ et ne le franchit jamais', c4.etat().cumulUsd <= 0.60, true);
    v('...tout près du plafond (au plus une marge + un appel en dessous)', c4.etat().cumulUsd > 0.60 - 0.0033 - M.MARGE_USD - 1e-9, true);
}

console.log('=== les comparaisons ===');
v('numéro : zéros de tête ignorés', M.numeroOk('088', '88'), 'exact');
v('numéro : préfixe différent, mêmes chiffres', M.numeroOk('SV14', '14'), 'chiffres');
v('numéro : faux', M.numeroOk('17', '71'), 'faux');
v('numéro absent : non jugé', M.numeroOk(null, '71'), null);
v('nom : casse et ponctuation ignorées', M.nomOk('Simisear VSTAR', 'Simisear VSTAR [Fireball Fever | Ember Star]'), true);
v('nom : un autre Pokémon', M.nomOk('Pikachu', 'Raichu [Thunder]'), false);
v('code : absent de la vérité, non jugé', M.codeOk('PAL', null), null);
v('code : s12a = S12A', M.codeOk('S12a', 's12a'), true);
const a = { name: 'Mew', number: '008', total: '64', setCode: 'PAL', language: 'FR', symboleSet: 'aucun', illustrateur: 'X' };
const b = { name: 'mew', number: '8', total: '064', setCode: 'pal', language: 'FR', symboleSet: 'aucun', illustrateur: 'Y' };
v('deux lectures qui ne diffèrent que par la forme sont la même lecture (illustrateur exclu des champs de la chaîne)', M.memeLecture(a, b, M.CHAMPS_CHAINE), true);
v('un total différent est vu', M.champsDifferents(a, { ...b, total: '65' }, M.CHAMPS_CHAINE), ['total']);
v('la chaîne ne lit pas l\'illustrateur', M.CHAMPS_CHAINE.includes('illustrateur'), false);
v('JSON entouré de balises', M.extraireJson('```json\n{"a":1}\n```'), { a: 1 });
v('JSON invalide : null', M.extraireJson('pas du json'), null);
v('percentile 95 de 20 valeurs = la 19e', M.pct(Array.from({ length: 20 }, (_, i) => i + 1), 0.95), 19);

console.log('=== la projection du p95 ===');
{
    const { projeter } = require('../mesures/projeter-p95');
    const base = { msIA: 3000, msCatalogue: 600, imageMs: 0, imageStatut: 'hors-condition' };
    v('sans règle : inchangé', projeter(base).total, 3600);
    v('R1 : un catalogue de 10 s retombe à la valeur typique donnée', projeter({ ...base, msCatalogue: 10000 }, { catApresMs: 800 }).cat, 800);
    v('R1 : sans valeur donnée, rien n\'est inventé', projeter({ ...base, msCatalogue: 10000 }, {}).cat, 10000);
    v('R1 : un catalogue de 2 s ne bouge pas', projeter({ ...base, msCatalogue: 2000 }, { catApresMs: 800 }).cat, 2000);
    v('R2 : l\'image prioritaire tombe à 0', projeter({ ...base, imageMs: 5700, imageStatut: 'abstention-attaque-prioritaire' }).img, 0);
    v('R2 : un vrai départage garde son temps', projeter({ ...base, imageMs: 770, imageStatut: 'departage' }).img, 770);
    v('R3 : le gain s\'applique à un appel normal', projeter(base, { gainIaMs: 400 }).ia, 2600);
    v('R3 : un incident de fournisseur (17 s) n\'est pas touché', projeter({ ...base, msIA: 17000 }, { gainIaMs: 400 }).ia, 17000);
    v('R3 : jamais sous 1 s', projeter({ ...base, msIA: 1200 }, { gainIaMs: 400 }).ia, 1000);
}

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exitCode = ko ? 1 : 0;
