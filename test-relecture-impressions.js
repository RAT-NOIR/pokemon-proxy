// node test-relecture-impressions.js — la relecture des impressions (PHASE 3b, T1), sur des états FABRIQUÉS. Aucune base, aucun réseau.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { relireImpressions } = require(path.join(DIR, 'collecte-cartes', 'relecture-impressions'));
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const T = 'jp', E = 'XY-P Promotional cards';
const carte = (id, impressions) => [id, { _id: id, impressions }];
const ligne = (carteId, numero) => ({ carteId, tirage: T, expansion: E, numero });
const planif = (carteId, numero) => ({ carteId, imp: { tirage: T, expansion: E, numero, total: null, deck: null, rarete: null, source: 'setlist' } });
const r = (cartes, lignes, planifiees) => relireImpressions({ cartesParId: new Map(cartes), lignes, planifiees });
const resume = x => [x.ok, `${x.planifieesOk}/${x.planifieesTotal}`, `${x.lignesOk}/${x.lignesTotal}`];

// 1. le cas du lot 5b : l'impression est déjà là, d'une AUTRE source (absente), le plan n'en planifie aucune
verifier('impression déjà présente (source ABSENTE, posée par la page), rien de planifié -> OK (lot 5b XY-P)',
    resume(r([carte(1, [{ tirage: T, expansion: E, numero: '5' }]), carte(2, [{ tirage: T, expansion: E, numero: '7', source: 'parseur' }])], [ligne(1, '5'), ligne(2, '7')], [])), [true, '0/0', '2/2']);
// 2. aucune impression du tout : échoue (la garde ne devient pas permissive)
const aucune = r([carte(1, []), carte(2, [{ tirage: T, expansion: E, numero: '7' }])], [ligne(1, '5'), ligne(2, '7')], []);
verifier('une ligne SANS aucune impression du set -> ÉCHEC, nommée', [resume(aucune), aucune.manques.length, /ligne sans impression : carte 1/.test(aucune.manques[0])], [[false, '0/0', '1/2'], 1, true]);
// 3. impression planifiée absente : échoue même si une impression d'un AUTRE numéro existe
const absente = r([carte(1, [{ tirage: T, expansion: E, numero: '9', source: 'setlist' }])], [ligne(1, '5')], [planif(1, '5')]);
verifier('impression PLANIFIÉE absente (une autre existe, à un autre numéro) -> ÉCHEC', [resume(absente), absente.manques.length], [[false, '0/1', '0/1'], 2]);
// 3 bis. la planifiée absente SEULE (la ligne, elle, a son impression d'une autre source) : c'est la condition (1) qui doit échouer, pas la (2)
const absenteSeule = r([carte(1, [{ tirage: T, expansion: E, numero: '5' }]), carte(2, [])], [ligne(1, '5')], [planif(2, '7')]);
verifier('impression PLANIFIÉE absente SEULE (toutes les lignes ont la leur) -> ÉCHEC par la condition (1)', [resume(absenteSeule), absenteSeule.manques.length], [[false, '0/1', '1/1'], 1]);
// 4. planifiée et posée : OK
verifier('impression planifiée et présente (source setlist) -> OK', resume(r([carte(1, [{ tirage: T, expansion: E, numero: '5', source: 'setlist' }])], [ligne(1, '5')], [planif(1, '5')])), [true, '1/1', '1/1']);
// 5. cleNumero : « 005 » est « 5 »
verifier('« 005 » en base EST le n° 5 (cleNumero de la production)', resume(r([carte(1, [{ tirage: T, expansion: E, numero: '005' }])], [ligne(1, '5')], [planif(1, '5')])), [true, '1/1', '1/1']);
// 6. une carte absente de la relecture : échoue
verifier('carte absente de la relecture -> ÉCHEC', resume(r([], [ligne(1, '5')], [])), [false, '0/0', '0/1']);
// 7. mauvais tirage / mauvaise expansion : ne comptent pas
verifier('même numéro, AUTRE expansion ou AUTRE tirage -> ÉCHEC', [resume(r([carte(1, [{ tirage: T, expansion: 'Autre set', numero: '5' }])], [ligne(1, '5')], [])), resume(r([carte(1, [{ tirage: 'intl', expansion: E, numero: '5' }])], [ligne(1, '5')], []))], [[false, '0/0', '0/1'], [false, '0/0', '0/1']]);
// 8. dédoublonnage : deux lignes (deux produits) d'une même carte au même numéro = une impression
verifier('deux produits d\'une même carte au même numéro : une seule impression comptée', resume(r([carte(1, [{ tirage: T, expansion: E, numero: '5' }])], [ligne(1, '5'), ligne(1, '05')], [])), [true, '0/0', '1/1']);
// 9. dénominateur : zéro ligne ne devient pas un succès silencieux ici — le total est imprimé (c'est l'outil qui refuse 0 ligne avant)
verifier('rien à relire : 0/0, 0/0 (le dénominateur est rendu, c\'est l\'appelant qui juge)', resume(r([], [], [])), [true, '0/0', '0/0']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
