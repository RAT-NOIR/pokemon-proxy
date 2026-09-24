// node test-nom-affichage.js — le nom affiché d'un set (collecte-cartes/nom-affichage.js) : le piège de l'homologue, les
// collisions contre les noms DÉJÀ affichés, et un nom posé jamais retouché. États fabriqués (§41 : la garde doit savoir dire non).
const { proposerNoms } = require('./collecte-cartes/nom-affichage');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const sets = [
    { _id: 'Expansion-Pack', region: 'jp', nomAffichage: 'Expansion Pack' },                                   // déjà publié : intouchable
    { _id: 'Base-Set', region: 'intl', nomEn: 'Base Set' },                                                   // occidental : nomEn
    { _id: 'Black-Bolt-JP', region: 'jp', nomAffichage: 'Black Bolt JP' },
    { _id: 'Rocket-Gang-X', region: 'jp', nomEn: 'Team Rocket', nomJaTraduit: 'Rocket Gang' },                 // japonais : JAMAIS nomEn
    { _id: 'Double-A', region: 'intl', nomEn: 'Expansion Pack' },                                              // collision avec un nom publié
    { _id: 'Jumeau-1', region: 'intl', nomEn: 'Même Nom' }, { _id: 'Jumeau-2', region: 'intl', nomEn: 'Même Nom' }   // deux candidats au même nom
];
const parSlug = new Map([['Rocket-Gang-X', { code: 'RGX', exp: 1, region: 'japonais' }], ['Double-A', { code: 'DA', exp: 2, region: 'occidental' }],
    ['Jumeau-1', { code: 'J1', exp: 3, region: 'occidental' }], ['Jumeau-2', { code: 'J2', exp: 3, region: 'occidental' }]]);
const slugs = new Map([[1, 'Rocket-Gang-Cardmarket'], [2, 'Double-A-Cardmarket'], [3, 'Jumeau-Cardmarket']]);
const { proposes, refuses } = proposerNoms(sets, parSlug, slugs);
const nomDe = id => proposes.find(p => p.s._id === id)?.a;

verifier('un set déjà nommé ne reçoit AUCUNE proposition', proposes.some(p => ['Expansion-Pack', 'Black-Bolt-JP'].includes(p.s._id)), false);
verifier('occidental : nomEn', nomDe('Base-Set'), { nom: 'Base Set', source: 'nomEn' });
verifier('japonais : jamais nomEn (le jumeau), le nom Cardmarket', nomDe('Rocket-Gang-X'), { nom: 'Rocket Gang Cardmarket', source: 'cardmarket' });
verifier('collision avec un nom PUBLIÉ : départagé par Cardmarket', nomDe('Double-A')?.nom, 'Double A Cardmarket');
verifier('deux candidats au même nom ET au même nom Cardmarket : départagés par le slug', [nomDe('Jumeau-1')?.nom, nomDe('Jumeau-2')?.nom], ['Jumeau 1', 'Jumeau 2']);
// un set que RIEN ne sépare : même nom, même slug lisible qu'un nom déjà publié
const r2 = proposerNoms([{ _id: 'X', region: 'intl', nomAffichage: 'Pris' }, { _id: 'Pris', region: 'intl', nomEn: 'Pris' }], new Map(), new Map());
verifier('rien ne sépare : AUCUN nom, et la raison est écrite', [r2.proposes.length, r2.refuses.length, /déjà affiché par X/.test(r2.refuses[0]?.raison || '')], [0, 1, true]);
// 🔴 LA CONVENTION EST L'ANGLAIS (mesurée le 2026-09-24 : 439 noms posés, 0 en français seul) — un nomFr ne passe JAMAIS
// devant, ni sur un occidental (« Set de Base » pour Base Set), ni sur un japonais.
const r3 = proposerNoms([{ _id: 'Base-Set', region: 'intl', nomEn: 'Base Set', nomFr: 'Set de Base' }, { _id: 'Forbidden-Light-JP', region: 'jp', nomFr: 'Lumière Interdite', nomJaTraduit: 'Forbidden Light' }],
    new Map([['Forbidden-Light-JP', { code: 'SM6', exp: 9, region: 'japonais' }]]), new Map([[9, 'Forbidden-Light-JP']]));
verifier('occidental avec nomFr : le nom ANGLAIS (nomEn), jamais le français', r3.proposes.find(p => p.s._id === 'Base-Set')?.a, { nom: 'Base Set', source: 'nomEn' });
verifier('japonais avec nomFr : le nom Cardmarket, jamais le français', r3.proposes.find(p => p.s._id === 'Forbidden-Light-JP')?.a, { nom: 'Forbidden Light JP', source: 'cardmarket' });
verifier('tous les noms proposés sont distincts entre eux et des noms publiés', new Set([...proposes.map(p => p.a.nom), 'Expansion Pack', 'Black Bolt JP']).size, proposes.length + 2);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
