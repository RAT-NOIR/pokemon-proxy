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

// ── 2026-11-01 : énergies Intro Pack Neo — deux sources de FAITS admises sous un code NEUTRE (aucun nom de site dans un champ posé) ; packmagik est ÉCARTÉE (conditions : accord requis) ──
const en = { set: 'Intro-Pack-Neo-Totodile', numero: '5', nom: 'Water Energy' };
const rp = { source: 'ppd', set: en.set, numero: '5', nom: 'Water Energy', ref: 'n°5' }, rt = { source: 'btq-ok2', set: en.set, numero: '5', nom: 'Water Energy', ref: 'n°5' };
verifier('énergies Neo : deux relevés concordants (ppd + btq-ok2) sont admis, sources = cardmarket + ppd + btq-ok2', (j => [j.ok, j.sources])(juger(en, [rp, rt])), [true, ['cardmarket', 'ppd', 'btq-ok2']]);
verifier('énergies Neo : chacun des deux codes admet à lui seul (Cardmarket + une source indépendante)', [juger(en, [rp]).ok, juger(en, [rt]).ok], [true, true]);
verifier('énergies Neo : un type discordant au même numéro (Fire Energy) est refusé pour les deux', [juger(en, [{ ...rp, nom: 'Fire Energy' }]).ok, juger(en, [{ ...rt, nom: 'Fire Energy' }]).ok], [false, false]);
verifier('énergies Neo : packmagik (« packmagik » / « pmk ») reste hors de la liste admise', juger(en, [{ ...rp, source: 'packmagik' }, { ...rp, source: 'pmk' }]).ok, false);
verifier('énergies Neo : « tcs » (code de la source tcgcsv) n\'est PAS admis ; la boutique a son code propre « btq-ok2 »', [SOURCES_ADMISES.includes('tcs'), SOURCES_ADMISES.includes('btq-ok2'), SOURCES_ADMISES.includes('ppd')], [false, true, true]);

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

// ── 2026-11-08 : « ldc » (liste de chasse), code NEUTRE, admis SEULEMENT pour quatre sets chinois calibrés fiables (décision du testeur) ──
const DS = require(path.join(DIR, 'collecte-cartes', 'deux-sources.js'));
const SL = DS.SETS_LISTE_DE_CHASSE;
const LISTE4 = ['30th-Celebration-Simplified-Chinese', 'Chasing-Glory-Together', 'Battle-Party-Dream-Together', 'Battle-Party-Shining-Dream'];
verifier('ldc : « ldc » est dans SOURCES_ADMISES ; SETS_LISTE_DE_CHASSE est gelée et porte exactement les quatre slugs', [SOURCES_ADMISES.includes('ldc'), Array.isArray(SL) && Object.isFrozen(SL), SL ? [...SL].sort() : null], [true, true, [...LISTE4].sort()]);
const ldc = (set, numero, nom, extra = {}) => ({ source: 'ldc', set, numero, nom, ref: 'W3 n°' + numero, ...extra });
verifier('ldc : acceptée sur chacun des quatre sets (même set, numéro, nom), sources = cardmarket + ldc', LISTE4.map(s => { const j = juger({ set: s, numero: '12', nom: 'Exeggutor' }, [ldc(s, '012', 'Exeggutor')]); return [j.ok, j.sources]; }), LISTE4.map(() => [true, ['cardmarket', 'ldc']]));
const jAutre = juger({ set: 'Set-Bon', numero: '12', nom: 'Exeggutor' }, [ldc('Set-Bon', '012', 'Exeggutor')]);
verifier('ldc : REFUSÉE sur un set hors de la liste, refus nommé', [jAutre.ok, jAutre.refusees.map(r => r.source), /liste de chasse/.test(jAutre.refusees[0]?.raison ?? '')], [false, ['ldc'], true]);
const P4 = { set: LISTE4[0], numero: '12', nom: 'Exeggutor' };
verifier('ldc : nom discordant refusé ; numéro discordant refusé ; set du relevé différent refusé', [juger(P4, [ldc(LISTE4[0], '012', 'Raichu')]).ok, juger(P4, [ldc(LISTE4[0], '013', 'Exeggutor')]).ok, juger(P4, [ldc(LISTE4[1], '012', 'Exeggutor')]).ok], [false, false, false]);
verifier('ldc : pas de repli par le Pokédex (nom illisible ou absent + même n° de Pokédex → refus)', [juger(P4, [ldc(LISTE4[0], '012', '椰蛋树', { dex: [103] })], { dexProduit: [103] }).ok, juger(P4, [ldc(LISTE4[0], '012', null, { dex: [103] })], { dexProduit: [103] }).ok], [false, false]);
verifier('ldc : Bulbapedia reste refusée même au milieu d\'un set de la liste', juger(P4, [{ source: 'bulbapedia', set: LISTE4[0], numero: '12', nom: 'Exeggutor' }, { source: 'setlist', set: LISTE4[0], numero: '12', nom: 'Exeggutor' }]).ok, false);
const cl = { source: 'ldc', ref: 'W3 n°012', set: LISTE4[0], numero: '012', nom: 'Exeggutor', par: 'nom' };
verifier('ldc rejouer : saine sur un set de la liste → ok ; sur un autre set → refus nommé ; nom ou numéro discordant → refus', [rejouer(P4, [cl]).ok, rejouer({ ...P4, set: 'Set-Bon' }, [{ ...cl, set: 'Set-Bon' }]).ok, /liste de chasse/.test(rejouer({ ...P4, set: 'Set-Bon' }, [{ ...cl, set: 'Set-Bon' }]).motifs[0] ?? ''), rejouer(P4, [{ ...cl, nom: 'Raichu' }]).ok, rejouer(P4, [{ ...cl, numero: '013' }]).ok], [true, false, true, false, false]);
verifier('ldc rejouer : par « pokedex » avec nom illisible ne passe PAS pour ldc', rejouer(P4, [{ ...cl, nom: '椰蛋树', par: 'pokedex' }]).ok, false);

console.log(`\n${ok} passés, ${ko} en échec`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(ko ? 1 : 0);
