// BANC — le coût d'une attaque lu par collecte-cartes/wikitext.js (DATES-CORR, 2026-10-13).
// Ce que le REGARD a établi (20 cartes ouvertes, DATES-CORR-report.md) : `cost` ABSENT (8/8) et `cost=` VIDE (12/12) sont deux écritures de la même
// chose, une attaque SANS COÛT (la carte imprime le rond gris vide) : elles restent `[]` (« aucun coût »). Ce qui change : un coût NUMÉRIQUE
// (`cost=2`, Pikachu VMAX Raid Battle) n'est pas « aucun » — le type des énergies est inconnu : pas de `cout`, un `coutNombre`.
//   node test-wikitext-cout.js
const { faitsDeCarte, coutDeAttaque } = require('./collecte-cartes/wikitext');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const att = (...params) => `{{Cardtext/Attack|name=A|${params.join('|')}|damage=10}}`;
const lire = t => faitsDeCarte(t, 'Carte (Test 1)').attaques.map(a => ({ ...a }));

verifier('des énergies : la liste, inchangée', lire(att('cost={{e|Grass}}{{e|Colorless}}'))[0].cout, ['Grass', 'Colorless']);
verifier('`None` écrit par la source : inchangé', lire(att('cost={{e|None}}'))[0].cout, ['None']);
verifier('`cost=` VIDE : « aucun coût », [] (le regard : 12/12 des attaques sans coût)', lire(att('cost='))[0].cout, []);
verifier('`cost` ABSENT : [] aussi (le regard : 8/8 sans coût) — pas un champ manquant', (() => { const a = lire(att('effect=x'))[0]; return ['cout' in a, a.cout]; })(), [true, []]);
verifier('`cost=2` NUMÉRIQUE : pas de `cout`, un `coutNombre`', (() => { const a = lire(att('cost=2'))[0]; return ['cout' in a, a.coutNombre]; })(), [false, 2]);
verifier('`cost=3` : coutNombre 3', lire(att('cost=3'))[0].coutNombre, 3);
verifier('un texte de coût illisible n\'est pas « aucun » : pas de `cout`, rien de deviné', (() => { const a = lire(att('cost=Varies'))[0]; return ['cout' in a, 'coutNombre' in a]; })(), [false, false]);
verifier('un coût numérique ne touche pas les autres champs', (() => { const a = lire(att('cost=1'))[0]; return [a.nom, a.degats]; })(), ['A', '10']);
verifier('coutDeAttaque : les trois formes', [coutDeAttaque({ cost: '{{e|Fire}}' }), coutDeAttaque({}), coutDeAttaque({ cost: '1' })], [{ cout: ['Fire'] }, { cout: [] }, { coutNombre: 1 }]);
// le dédoublonnage des attaques identiques tient compte du coût numérique (deux coûts différents = deux attaques)
verifier('deux attaques de même nom, coût numérique différent : deux attaques', lire(att('cost=1') + '\n' + att('cost=2')).length, 2);
verifier('deux attaques identiques à coût numérique : fusionnées', lire(att('cost=1') + '\n' + att('cost=1')).length, 1);

// ── le SCHÉMA : écrit par mongoose, un coût numérique ne doit devenir ni `cout: []` ni perdre `coutNombre`
const mongoose = require('mongoose');
const cx = mongoose.createConnection();
const { Carte } = require('./collecte-cartes/schemas').modeles(cx);
const ecrit = attaques => new Carte({ _id: 1, attaques }).toObject().attaques;
const ancien = new mongoose.Schema({ attaques: [{ _id: false, nom: String, cout: [String] }] });
verifier('(témoin) l\'ANCIEN schéma `cout: [String]` fabrique [] pour un tableau absent — c\'est ce que le schéma neuf évite', new (cx.model('AncienCarte', ancien))({ attaques: [{ nom: 'A' }] }).toObject().attaques[0].cout, []);
verifier('schéma : coutNombre gardé, `cout` non fabriqué', (() => { const a = ecrit([{ nom: 'A', coutNombre: 2 }])[0]; return ['cout' in a, a.coutNombre]; })(), [false, 2]);
verifier('schéma : `cout: []` (sans coût) reste []', ecrit([{ nom: 'A', cout: [] }])[0].cout, []);
verifier('schéma : des énergies, inchangées', ecrit([{ nom: 'A', cout: ['Fire'] }])[0].cout, ['Fire']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
