// Banc pur du jeton d'API : faux req/res, aucune base, aucun serveur.
// La garde s'écrit par ce qu'elle AUTORISE : un jeton serveur configuré ET un en-tête x-jeton égal.
const fs = require('fs');
const path = require('path');

let ok = 0, total = 0;
function verifier(nom, cond) {
    total++;
    if (cond) { ok++; console.log('  ok   ' + nom); } else console.log('  ECHEC ' + nom);
}

let creerVerifierJeton;
try {
    ({ creerVerifierJeton } = require('./jeton-api'));
} catch (e) {
    console.log('ECHEC : module jeton-api.js absent ou illisible (' + e.message + ')');
}

function jouer(valeurServeur, entete) {
    const appels = { next: 0, statut: null, corps: null, journal: [] };
    const journal = { error: (...a) => appels.journal.push(a.join(' ')), warn: (...a) => appels.journal.push(a.join(' ')) };
    const mw = creerVerifierJeton(valeurServeur, journal);
    const req = { headers: entete === undefined ? {} : { 'x-jeton': entete } };
    const res = { status(c) { appels.statut = c; return this; }, json(o) { appels.corps = o; return this; } };
    mw(req, res, () => { appels.next++; });
    return appels;
}

const SECRET = 'secret-de-test-0123456789';

if (creerVerifierJeton) {
    for (const [nom, v] of [['absente (undefined)', undefined], ['null', null], ['vide', ''], ['blanche', '   \t ']]) {
        const r = jouer(v, SECRET);
        verifier(`variable ${nom} : 503, next jamais appele`, r.statut === 503 && r.next === 0 && r.corps && r.corps.success === false);
        verifier(`variable ${nom} : journal nomme JETON_API, sans valeur`,
            r.journal.length >= 1 && r.journal.every(l => l.includes('JETON_API') && !l.includes(SECRET)));
    }
    const sansEntete = jouer('', undefined);
    verifier('variable absente + en-tete absent : 503', sansEntete.statut === 503 && sansEntete.next === 0);

    const bon = jouer(SECRET, SECRET);
    verifier('bon jeton : next appele, aucune reponse', bon.next === 1 && bon.statut === null);

    const cas = [
        ['jeton different', 'autre-secret-de-test-0123456'],
        ['en-tete absent', undefined],
        ['en-tete tableau', [SECRET]],
        ['longueur differente', SECRET + 'x'],
        ['meme longueur, contenu different', SECRET.slice(0, -1) + 'Z'],
        ['en-tete vide', ''],
    ];
    for (const [nom, e] of cas) {
        const r = jouer(SECRET, e);
        verifier(`${nom} : 401 et next jamais appele`, r.statut === 401 && r.next === 0 && r.corps.error === 'Non autorisé');
    }

    // Exception dans la comparaison : refus, jamais next.
    const appels = { next: 0, statut: null };
    const mw = creerVerifierJeton(SECRET, { error() {}, warn() {} });
    const req = { headers: { get 'x-jeton'() { throw new Error('boum'); } } };
    const res = { status(c) { appels.statut = c; return this; }, json() { return this; } };
    let leve = false;
    try { mw(req, res, () => { appels.next++; }); } catch { leve = true; }
    verifier('exception pendant la lecture : refus, pas de next, pas de throw', !leve && appels.next === 0 && appels.statut >= 400);
}

// Test STATIQUE sur index.js
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const garde = src.match(/^const\s+(\w+)\s*=\s*creerVerifierJeton\(\s*process\.env\.JETON_API\s*\)/m);
verifier('index.js construit la garde par creerVerifierJeton(process.env.JETON_API) depuis ./jeton-api',
    !!garde && /require\(\s*['"]\.\/jeton-api['"]\s*\)/.test(src));
const fnJeton = src.match(/^function\s+verifierJeton\s*\(\s*req\s*,\s*res\s*,\s*next\s*\)\s*\{([\s\S]*?)^\}/m);
verifier('index.js : verifierJeton est une fonction de premier niveau (vue par chemin-du-scan et le cliquet)', !!fnJeton);
verifier('verifierJeton delegue a la garde construite par creerVerifierJeton',
    !!fnJeton && !!garde && new RegExp(`return\\s+${garde[1]}\\(\\s*req\\s*,\\s*res\\s*,\\s*next\\s*\\)`).test(fnJeton[1]) && !/next\(\)/.test(fnJeton[1]));
verifier('index.js : aucun "return next()" conditionne a l\'absence du jeton',
    !/if\s*\(\s*!\s*JETON_API\s*\)\s*return\s+next\(\)/.test(src) && !/if\s*\(\s*!\s*process\.env\.JETON_API\s*\)[^;\n]*next\(\)/.test(src));
verifier('index.js : plus de message "accepte toute requete locale"', !/accepte toute requête/.test(src));

console.log(`${ok}/${total}`);
process.exit(ok === total ? 0 : 1);
