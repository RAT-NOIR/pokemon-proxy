// Banc de poser-lignes-energies-deux-sources.js — données FABRIQUÉES, aucune base, aucune requête.
const { planifier, verifierAttendu, executer, ARGUMENTS_AUTORISES } = require('./poser-lignes-energies-deux-sources');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu ${a}\n   attendu ${b}`); } };

const SET = 'Intro-Pack-Neo-Totodile';
const Ls = new Map([[SET, { exp: 5062, tirage: 'jp', slugSet: SET, code: 'IPNT' }]]);
const prod = (idProduct, name, numero) => ({ idProduct, name, numero, idMetacard: 9000 + idProduct });
const produitsParExp = new Map([[5062, [prod(1, 'Water Energy', 5), prod(2, 'Lightning Energy', 6), prod(3, 'Water Energy', 11), prod(4, 'Pikachu [Gnaw]', 1), prod(5, 'Dark Energy', 8), prod(6, 'Psychic Energy', 7)]]]);
const carte = (id, nomEn, extra = {}) => ({ _id: id, nomEn, sets: [SET], ...extra });
const cartes = () => new Map([[SET, [carte(13683, 'Water Energy'), carte(13684, 'Basic Lightning Energy'), carte(13685, 'Psychic Energy'), carte(13685.5, 'Basic Psychic Energy'), carte(888, 'Dark Energy'),carte(777, 'Water Energy', { ficheSimple: { le: 1 } })]]]);
const rel = (s, numero, nom) => ({ source: s, ref: `n°${numero}`, set: SET, numero: String(numero), nom });
const entree = (numero, nom, rels) => ({ ok: true, sources: ['cardmarket'], concordantes: rels ?? [rel('ppd', numero, nom), rel('btq-ok2', numero, nom)], set: SET, numero: String(numero), nom, exp: 5062 });
const P = (liste, o = {}) => planifier({ liste, Ls, produitsParExp, cartesDuSet: cartes(), ...o });

// 1. la concordance des deux sources → une ligne, sur la carte unique du type, additive et neutre
const a = P({ 1: entree(5, 'Water Energy'), 2: entree(6, 'Lightning Energy') });
verifier('concordance ppd + btq-ok2 → 2 lignes, aucune refusée', [a.lignes.length, a.refus.length], [2, 0]);
verifier('la ligne : _id carte|produit, carte du type (« Basic » accepté), numeroFiche = le numéro, preuve neutre', [a.lignes[0]._id, a.lignes[1]._id, a.lignes[0].numeroFiche, a.lignes[0].preuve, a.lignes[0].slug], ['13683|1', '13684|2', '5', 'deux-sources:faits+numero', null]);
verifier('aucun nom de site dans la ligne posée (ni packmagik, ni pokepedia, ni tcgsync)', /packmagik|pokepedia|tcgsync|tradingcard/i.test(JSON.stringify(a.lignes)), false);
verifier('la fiche simple homonyme (777) n\'est jamais choisie : 13683 reste l\'unique carte « Water Energy »', a.lignes[0].carteId, 13683);
// 2. type discordant
verifier('type discordant chez btq-ok2 (Fire au lieu de Water) → refus', (r => [r.lignes.length, r.refus.length])(P({ 1: entree(5, 'Water Energy', [rel('ppd', 5, 'Water Energy'), rel('btq-ok2', 5, 'Fire Energy')]) })), [0, 1]);
verifier('numéro discordant chez ppd (n°6 pour le produit n°5) → refus', P({ 1: entree(5, 'Water Energy', [rel('ppd', 6, 'Water Energy'), rel('btq-ok2', 5, 'Water Energy')]) }).lignes.length, 0);
// 3. une seule source
verifier('une seule source (ppd seule) → refus', (r => [r.lignes.length, r.refus.length])(P({ 1: entree(5, 'Water Energy', [rel('ppd', 5, 'Water Energy')]) })), [0, 1]);
verifier('une seule source (btq-ok2 seule) → refus', P({ 1: entree(5, 'Water Energy', [rel('btq-ok2', 5, 'Water Energy')]) }).lignes.length, 0);
verifier('deux relevés de la MÊME source ne font pas les deux', P({ 1: entree(5, 'Water Energy', [rel('ppd', 5, 'Water Energy'), rel('ppd', 5, 'Water Energy')]) }).lignes.length, 0);
verifier('une source exclue ou inconnue (packmagik) ne remplace pas btq-ok2 → refus', P({ 1: entree(5, 'Water Energy', [rel('ppd', 5, 'Water Energy'), rel('packmagik', 5, 'Water Energy')]) }).lignes.length, 0);
// 4. ligne existante
const e = P({ 1: entree(5, 'Water Energy') }, { existants: new Set([1]) });
verifier('ligne existante → « déjà », jamais réécrite', [e.lignes.length, e.deja.length, e.refus.length], [0, 1, 0]);
// 5. ligne détachée
verifier('ligne détachée (13683|1) → refus', (r => [r.lignes.length, /détachée/.test(r.refus[0]?.raison)])(P({ 1: entree(5, 'Water Energy') }, { interdits: new Set(['13683|1']) })), [0, true]);
verifier('la détachée d\'un AUTRE produit ne bloque pas celui-ci', P({ 3: entree(11, 'Water Energy') }, { interdits: new Set(['13683|1']) }).lignes.length, 1);
// 6. type à deux cartes / aucune carte
verifier('type à DEUX cartes (Psychic + Basic Psychic) → refus', (r => [r.lignes.length, /2 carte/.test(r.refus[0]?.raison)])(P({ 6: entree(7, 'Psychic Energy') })), [0, true]);
const sansCarte = P({ 1: entree(5, 'Water Energy') }, { cartesDuSet: new Map([[SET, [carte(777, 'Water Energy', { ficheSimple: { le: 1 } })]]]) });
verifier('type sans carte d\'énergie de base (fiche simple seule) → refus', [sansCarte.lignes.length, /0 carte/.test(sansCarte.refus[0]?.raison)], [0, true]);
// 7. périmètre
verifier('produit hors de l\'expansion → refus', P({ 99: entree(5, 'Water Energy') }).lignes.length, 0);
verifier('énergie hors table fermée (Dark Energy) → refus', P({ 5: entree(8, 'Dark Energy') }).lignes.length, 0);
verifier('non-énergie (Pikachu) → refus', P({ 4: entree(1, 'Pikachu') }).lignes.length, 0);
verifier('set inconnu de l\'outil → refus', P({ 1: { ...entree(5, 'Water Energy'), set: 'Autre-Set' } }).lignes.length, 0);
verifier('le numéro du produit (appris) prime : relevés concordants au n°9 pour un produit n°5 → refus', P({ 1: entree(9, 'Water Energy') }).lignes.length, 0);
// 8. --attendu et arguments
verifier('verifierAttendu : absent → non ; différent → non ; égal → oui', [verifierAttendu({ lignes: [1, 2] }, undefined).ok, verifierAttendu({ lignes: [1, 2] }, 3).ok, verifierAttendu({ lignes: [1, 2] }, 2).ok], [false, false, true]);
verifier('liste blanche : --ecrire, --attendu=N, --liste=x.json passent ; --code=, --force, --attendu=x non', [['--ecrire', '--attendu=25', '--liste=a.json'].every(x => ARGUMENTS_AUTORISES.some(r => r.test(x))), ['--code=IPNT', '--force', '--attendu=x'].some(x => ARGUMENTS_AUTORISES.some(r => r.test(x)))], [true, false]);

(async () => {
    const msgs = [], connecte = [];
    const base = { ouvrirConnexions: async () => { connecte.push(1); throw new Error('ne doit pas se connecter'); }, lireListe: () => ({}), log: () => { }, err: m => msgs.push(m) };
    verifier('--ecrire sans --attendu → code 2, aucune connexion ouverte', [await executer({ ...base, argv: ['--liste=x.json', '--ecrire'] }), connecte.length], [2, 0]);
    verifier('argument inconnu → code 2, aucune connexion', [await executer({ ...base, argv: ['--liste=x.json', '--code=IPNT'] }), connecte.length], [2, 0]);
    verifier('liste illisible → code 2, aucune connexion', [await executer({ ...base, lireListe: () => { throw new Error('boum'); }, argv: ['--liste=x.json'] }), connecte.length], [2, 0]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
