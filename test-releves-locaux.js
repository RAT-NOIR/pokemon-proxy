// node test-releves-locaux.js — le rattachement PikaQian → set et sa CALIBRATION, sur des fichiers FABRIQUÉS dans le dossier temporaire (aucun réseau, aucune base).
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du module (le rouge se voit en cassant le code).
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { relevesPikaqian, calibrer } = require(path.join(DIR, 'collecte-cartes', 'releves-locaux.js'));
const { juger, SOURCES_ADMISES } = require(path.join(DIR, 'collecte-cartes', 'deux-sources.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'releves-locaux-'));
const ecrire = (rel, obj) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj)); };
const tuiles = (n, f) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, nom: f(i), numero: String(i + 1).padStart(3, '0'), code: 'x' }));
const table = [{ codePk: 'setbon', slug: 'Set-Bon' }, { codePk: 'setfaux', slug: 'Set-Faux' }, { codePk: 'setpetit', slug: 'Set-Petit' }];
ecrire('pikaqian-passif/setbon/page.json', { tuiles: tuiles(30, i => `Mon${i}`) });
ecrire('pikaqian-passif/setfaux/page.json', { tuiles: tuiles(30, i => `Autre${i}`) });
ecrire('pikaqian-passif/setpetit/page.json', { tuiles: tuiles(5, i => `Mon${i}`) });
ecrire('pikaqian-passif/inconnu/page.json', { tuiles: tuiles(3, i => `Zz${i}`) });
ecrire('pikaqian/apprises/setbon--1.json', { code: 'setbon', tuiles: tuiles(30, i => `Mon${i}`) });   // la même page vue par les « apprises » : pas de doublon

const R = relevesPikaqian(tmp, table);
verifier('relevés : 30 + 30 + 5 tuiles, la page « apprises » identique ne double RIEN, la page sans set de la table est NOMMÉE et ignorée', [R.releves.length, R.pagesSansSet], [65, ['inconnu']]);
verifier('   chaque relevé porte le slug de la TABLE (jamais un set deviné par le nom)', [...new Set(R.releves.map(r => r.set))].sort(), ['Set-Bon', 'Set-Faux', 'Set-Petit']);

// les produits JOINTS (vérité de Cardmarket) : Set-Bon concorde sur 25, Set-Faux contredit (autres noms aux mêmes numéros), Set-Petit concorde mais sur 5 seulement
const joints = [];
for (let i = 0; i < 25; i++) joints.push({ idProduct: 100 + i, set: 'Set-Bon', numero: String(i + 1), nom: `Mon${i}` });
for (let i = 0; i < 25; i++) joints.push({ idProduct: 200 + i, set: 'Set-Faux', numero: String(i + 1), nom: `Mon${i}` });
for (let i = 0; i < 5; i++) joints.push({ idProduct: 300 + i, set: 'Set-Petit', numero: String(i + 1), nom: `Mon${i}` });
const C = calibrer(R.releves, joints);
verifier('calibration : Set-Bon (25 accords, 0 conflit) est CALIBRÉ ; Set-Faux (25 conflits) et Set-Petit (5 accords seulement, minimum 20) ne le sont PAS', [C.calibres, C.parSet['Set-Bon'].accords, C.parSet['Set-Faux'].conflits, C.parSet['Set-Petit'].accords], [['Set-Bon'], 25, 25, 5]);
verifier('   un seul conflit suffit à refuser un set (0 faux exigé)', calibrer(R.releves, [...joints, { idProduct: 999, set: 'Set-Bon', numero: '30', nom: 'Pas Du Tout' }]).calibres, []);
verifier('   un produit joint SANS numéro n\'est jamais compté comme accord', calibrer(R.releves, [{ idProduct: 1, set: 'Set-Bon', numero: null, nom: 'Mon0' }]).parSet['Set-Bon'].compares, 0);

// le jugement : Cardmarket + UNE source indépendante concordante ; Bulbapedia refusée ; deux relevés de la même source ne font pas deux sources
const produit = { set: 'Set-Bon', numero: '3', nom: 'Mon2' };
const j1 = juger(produit, R.releves.filter(r => r.set === 'Set-Bon' && r.numero === '003'));
verifier('juger : la tuile PikaQian au même set, même numéro, même nom → ok, sources = cardmarket + pikaqian', [j1.ok, j1.sources], [true, ['cardmarket', 'pikaqian']]);
verifier('juger : le même nom à un AUTRE numéro, ou dans un autre set, ne concorde pas', [juger(produit, R.releves.filter(r => r.set === 'Set-Bon' && r.numero === '004')).ok, juger(produit, R.releves.filter(r => r.set === 'Set-Faux' && r.numero === '003')).ok], [false, false]);
verifier('juger : une source « bulbapedia » est REFUSÉE par son nom, même si tout concorde', juger(produit, [{ source: 'bulbapedia', set: 'Set-Bon', numero: '3', nom: 'Mon2' }]).ok, false);
verifier('juger : type-null, pdt, ctr, pkc, pokellector, pokemon-com sont des sources admises ; « setlist » et « bulbapedia-r2 » ne le sont pas', [['type-null', 'pdt', 'ctr', 'pkc', 'pokellector', 'pokemon-com'].every(s => SOURCES_ADMISES.includes(s)), ['setlist', 'bulbapedia-r2', 'bulbapedia'].some(s => SOURCES_ADMISES.includes(s))], [true, false]);

console.log(`\n${ok} passés, ${ko} en échec`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(ko ? 1 : 0);
