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

// ── D4 (2026-10-24) : le repli par le Pokédex ne vaut que pour un nom ILLISIBLE (absent ou non latin), jamais pour un nom lisible et discordant ──
const { rejouer, nomLisible } = require(path.join(DIR, 'collecte-cartes', 'deux-sources.js'));
const pk = { set: 'Set-Bon', numero: '3', nom: 'Pikachu' };
const rel = (nom, dex = [25]) => ({ source: 'tpc-asie', set: 'Set-Bon', numero: '003', nom, dex });
verifier('D4 : un nom LISIBLE et discordant (« Raichu ») malgré le même n° de Pokédex est REFUSÉ (désaccord, pas un repli)', juger(pk, [rel('Raichu')], { dexProduit: [25] }).ok, false);
verifier('D4 : un nom japonais (illisible) + le même n° de Pokédex est ACCEPTÉ, par le Pokédex', (j => [j.ok, j.concordantes[0]?.par])(juger(pk, [rel('ピカチュウ')], { dexProduit: [25] })), [true, 'pokedex']);
verifier('D4 : un nom ABSENT + le même n° de Pokédex est ACCEPTÉ ; le mauvais n° de Pokédex est refusé', [juger(pk, [rel(null)], { dexProduit: [25] }).ok, juger(pk, [rel('ピカチュウ', [26])], { dexProduit: [25] }).ok], [true, false]);
verifier('D4 : nomLisible : latin oui ; japonais, chinois, thaï, vide, null non', [nomLisible('Mew ex'), nomLisible("Pokémon Catcher"), nomLisible('ピカチュウ'), nomLisible('皮卡丘'), nomLisible('พิคาชู'), nomLisible(''), nomLisible(null)], [true, true, false, false, false, false, false]);

// ── D3 : rejouer() relit les concordantes ; sans concordante, ou avec une source exclue/inconnue, un set ou un numéro différent, un nom discordant → refus ──
const bonne = { source: 'pikaqian', ref: 'r', set: 'Set-Bon', numero: '003', nom: 'Pikachu', par: 'nom' };
verifier('D3 rejouer : une concordante saine → ok', rejouer(pk, [bonne]).ok, true);
verifier('D3 rejouer : aucune concordante (liste vide, absente) → refus', [rejouer(pk, []).ok, rejouer(pk, undefined).ok], [false, false]);
verifier('D3 rejouer : source « bulbapedia » / « setlist » / « bulbapedia-r2 » → refus ; source inconnue → refus', ['bulbapedia', 'setlist', 'bulbapedia-r2', 'inconnue'].map(s => rejouer(pk, [{ ...bonne, source: s }]).ok), [false, false, false, false]);
verifier('D3 rejouer : set différent, numéro différent, nom discordant → refus', [rejouer(pk, [{ ...bonne, set: 'Autre' }]).ok, rejouer(pk, [{ ...bonne, numero: '4' }]).ok, rejouer(pk, [{ ...bonne, nom: 'Raichu' }]).ok], [false, false, false]);
verifier('D3 rejouer : une SEULE concordante fautive parmi deux saines refuse tout', rejouer(pk, [bonne, { ...bonne, source: 'bulbapedia' }]).ok, false);
verifier('D3 rejouer : par « pokedex » ne passe que pour un nom illisible', [rejouer(pk, [{ ...bonne, nom: 'ピカチュウ', par: 'pokedex' }]).ok, rejouer(pk, [{ ...bonne, nom: 'Raichu', par: 'pokedex' }]).ok], [true, false]);

console.log(`\n${ok} passés, ${ko} en échec`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(ko ? 1 : 0);
