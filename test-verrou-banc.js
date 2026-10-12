// TEST — verrou/environnement-banc.js : la garde que verrou-avant-push.js applique APRÈS banc.appliquer() et AVANT toute connexion ou tout serveur fils.
//   node test-verrou-banc.js      -> code 0 si tout passe. Pur : aucune base, aucun réseau, des environnements FABRIQUÉS (hôtes fictifs).
// Le test qui compte : la garde SAIT-ELLE dire NON ? (CLAUDE.md §41/§51) — chaque environnement dangereux ci-dessous doit être refusé.
const fs = require('fs');
const path = require('path');
const { verifierEnvironnementBanc, jetonOuRefus, uriDuBanc } = require('./verrou/environnement-banc');

let ok = 0, ko = 0;
const verifier = (nom, cond) => { if (cond) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}`); } };

const PROD = 'mongodb+srv://u:p@cluster0.prodx.mongodb.net/';
const CARTES = 'mongodb+srv://u2:p2@cluster1.cartx.mongodb.net/';
const BANC = 'mongodb://127.0.0.1:41234/';
// un environnement SAIN tel que appliquer() le laisse : toutes les variables MONGODB_*URI valent le banc, les clés R2 de production sont vidées
const sain = () => ({
    BANC_ISOLE: '1', BANC_HOTES: '127.0.0.1',
    MONGODB_URI: BANC, MONGODB_CARTES_URI: BANC, MONGODB_TEST_URI: BANC, MONGODB_LECTURE_URI: BANC, MONGODB_CARTES_LECTURE_URI: BANC,
    R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', JETON_API: 'jeton-de-test'
});

console.log('--- environnement sain : le SEUL chemin qui passe ---');
verifier('environnement de banc appliqué : accepté', verifierEnvironnementBanc(sain()).ok === true);
verifier('uriDuBanc rend l\'URI du banc', uriDuBanc(sain()) === BANC);

console.log('--- environnements dangereux : tous refusés ---');
const cas = {
    'banc.appliquer() jamais appelé (BANC_ISOLE absent), URI de production': { ...sain(), BANC_ISOLE: undefined, MONGODB_URI: PROD },
    'BANC_ISOLE=0': { ...sain(), BANC_ISOLE: '0' },
    'BANC_HOTES vide': { ...sain(), BANC_HOTES: '' },
    'MONGODB_URI = production': { ...sain(), MONGODB_URI: PROD },
    'MONGODB_URI absente': (() => { const e = sain(); delete e.MONGODB_URI; return e; })(),
    'MONGODB_URI illisible': { ...sain(), MONGODB_URI: 'pas-une-uri' },
    'MONGODB_CARTES_URI = production (un fils la lirait)': { ...sain(), MONGODB_CARTES_URI: CARTES },
    'MONGODB_LECTURE_URI laissée à la production dans l\'environnement hérité': { ...sain(), MONGODB_LECTURE_URI: PROD },
    'une variable MONGODB_* inconnue pointe la production': { ...sain(), MONGODB_AUTRE_URI: PROD },
    'MONGODB_URI sur le banc mais hôte de production en second': { ...sain(), MONGODB_URI: 'mongodb://127.0.0.1:41234,cluster0-shard-00-00.prodx.mongodb.net:27017/' },
    'clé R2 de production encore présente (id)': { ...sain(), R2_ACCESS_KEY_ID: 'abc' },
    'clé R2 de production encore présente (secret)': { ...sain(), R2_SECRET_ACCESS_KEY: 'xyz' },
    'environnement vide': {}
};
for (const [nom, env] of Object.entries(cas)) {
    const v = verifierEnvironnementBanc(env);
    verifier(`refusé : ${nom}`, v.ok === false && typeof v.raison === 'string' && v.raison.length > 0);
    // aucune valeur d'URI dans le message
    verifier(`  ↳ le message ne contient aucune valeur d'URI (${nom})`, !/prodx|cartx|u:p|u2:p2/.test(v.raison || ''));
}
let leve = false; try { uriDuBanc({ ...sain(), MONGODB_URI: PROD }); } catch (_) { leve = true; }
verifier('uriDuBanc LÈVE sur un environnement dangereux (jamais l\'URI de production)', leve);

console.log('--- jeton : plus de repli en dur ---');
verifier('JETON_API présent : accepté', jetonOuRefus({ JETON_API: 'abc' }).jeton === 'abc');
for (const [nom, env] of Object.entries({ 'absent': {}, 'vide': { JETON_API: '' }, 'blancs': { JETON_API: '   ' } })) {
    const j = jetonOuRefus(env);
    verifier(`refusé : JETON_API ${nom}`, j.ok === false && !j.jeton);
}

console.log('--- le code du verrou applique la garde (lecture du source) ---');
const src = fs.readFileSync(path.join(__dirname, 'verrou-avant-push.js'), 'utf8');
verifier('plus de repli « || \'jeton-verrou\' » dans verrou-avant-push.js', !/JETON_API\s*\|\|/.test(src) && !/jeton-verrou'/.test(src.replace(/USER_VERROU[^\n]*/g, '')));
verifier('plus aucune ouverture directe de process.env.MONGODB_URI dans verrou-avant-push.js', !/process\.env\.MONGODB_URI/.test(src));
verifier('la garde est appelée', /verifierEnvironnementBanc\(/.test(src) && /uriDuBanc\(/.test(src));
const iBanc = src.indexOf('banc.appliquer()'), iGarde = src.indexOf('verifierEnvironnementBanc(');
const iTranche = src.indexOf('copierTranche(prodT'), iDemarrer = src.indexOf('await demarrer(');
verifier('la garde passe APRÈS appliquer() et AVANT la tranche et le serveur fils', iBanc > -1 && iGarde > iBanc && iGarde < iTranche && iGarde < iDemarrer);

// Le cliquet lance des SUITES qui ouvrent chacune leur propre banc (ouvrirBanc) : elles exigent l'environnement d'ORIGINE (URI de lecture distincte de celle d'écriture).
// Héritant de l'environnement déjà remplacé par appliquer(), smoke-test.js refusait « hôte = production » (MONGODB_TEST_URI = MONGODB_URI = le banc du verrou) : rouge du 2026-10-12.
const iOrigine = src.indexOf('envOrigine = { ...process.env }');
verifier('l\'environnement d\'origine est copié AVANT banc.appliquer()', iOrigine > -1 && iOrigine < iBanc);
verifier('le cliquet reçoit l\'environnement ÉPURÉ de l\'origine (pas l\'origine brute)', /couverture-index\.js'[\s\S]{0,200}env:\s*environnementDuCliquet\(envOrigine,\s*nomsDuDotenv\(/.test(src) && !/env:\s*envOrigine\b/.test(src));

console.log('--- R8 B-I (tour 2) : l\'environnement du cliquet est une LISTE FERMÉE de ce qui est transmis ---');
{
    const { environnementDuCliquet, VARIABLES_TRANSMISES } = require('./verrou/environnement-banc');
    const { jugerLecture } = require('./collecte-cartes/base-banc');
    const origine = {
        // système (transmises) ; chemin du binaire mongod mis en cache (transmise) ; banc R2 (transmises)
        PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', TEMP: 'C:\\tmp', MONGOMS_DOWNLOAD_DIR: 'C:\\cache', R2_BUCKET_BANC: 'bucket-banc', R2_BANC_ACCESS_KEY_ID: 'banc-id', R2_BANC_SECRET_ACCESS_KEY: 'banc-secret',
        // lecture (transmises)
        MONGODB_LECTURE_URI: 'mongodb+srv://lecteur:MDP-LECTURE@cluster0.prodx.mongodb.net/test',
        MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://lecteur2:MDP-LECTURE2@cluster1.cartx.mongodb.net/cartes',
        // écriture de production : JAMAIS, ni la valeur, ni l'hôte avec un faux identifiant
        MONGODB_URI: 'mongodb+srv://ecrit:MOTDEPASSE-ECRITURE@cluster0.prodx.mongodb.net/test?retryWrites=true',
        MONGODB_CARTES_URI: 'mongodb+srv://ecrit2:MOTDEPASSE-CARTES@cluster1.cartx.mongodb.net/cartes',
        MONGODB_TEST_URI: 'mongodb://t:MDP-TEST@hote.test.example/x',
        R2_ACCESS_KEY_ID: 'CLE-R2-ID', R2_SECRET_ACCESS_KEY: 'CLE-R2-SECRET', R2_BUCKET_IMAGES: 'bucket-prod', R2_ENDPOINT: 'https://secret.r2.example',
        // inconnues : AUCUNE ne doit passer
        STRIPE_SECRET_KEY: 'sk_live_XXXX', OPENROUTER_API_KEY: 'OR-XXXX', X_URI: 'https://x.example/MDP-X', TOTO: 'toto', JETON_API: 'jeton-secret', MONGODB_AUTRE_URI: 'mongodb://autre:MDP-AUTRE@hote.autre.example/x',
        REVALIDATION_SECRET: 'rev', RUNPOD_API_KEY: 'rp'
    };
    const copie = JSON.stringify(origine);
    const e = environnementDuCliquet(origine, ['STRIPE_SECRET_KEY', 'OPENROUTER_API_KEY', 'MONGODB_URI', 'TOTO', 'MONGODB_LECTURE_URI']);
    verifier('l\'environnement d\'origine n\'est pas modifié', JSON.stringify(origine) === copie);
    for (const nom of ['STRIPE_SECRET_KEY', 'OPENROUTER_API_KEY', 'R2_ENDPOINT', 'X_URI', 'TOTO', 'JETON_API', 'MONGODB_AUTRE_URI', 'REVALIDATION_SECRET', 'RUNPOD_API_KEY', 'MONGODB_URI', 'MONGODB_CARTES_URI', 'MONGODB_TEST_URI', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_IMAGES'])
        verifier(`« ${nom} » n'atteint pas le cliquet (absente ou vidée)`, !e[nom]);
    const vu = JSON.stringify(e);
    for (const secret of ['MOTDEPASSE-ECRITURE', 'MOTDEPASSE-CARTES', 'MDP-TEST', 'MDP-AUTRE', 'MDP-X', 'CLE-R2', 'sk_live', 'OR-XXXX', 'jeton-secret', 'prodx.mongodb.net/test?retry', 'ecrit:', 'ecrit2:'])
        verifier(`aucune trace de « ${secret.slice(0, 8)}… » dans l'environnement rendu`, !vu.includes(secret));
    verifier('aucune variable ne désigne un hôte de PRODUCTION en écriture : seuls les URI de lecture portent un hôte', Object.entries(e).filter(([, v]) => /^mongodb/i.test(v)).map(([k]) => k).sort().join() === 'MONGODB_CARTES_LECTURE_URI,MONGODB_LECTURE_URI');
    verifier('les URI de LECTURE sont conservées', e.MONGODB_LECTURE_URI === origine.MONGODB_LECTURE_URI && e.MONGODB_CARTES_LECTURE_URI === origine.MONGODB_CARTES_LECTURE_URI);
    verifier('les variables système et de banc nommées passent', e.PATH === 'C:\\bin' && e.SystemRoot === 'C:\\Windows' && e.TEMP === 'C:\\tmp' && e.MONGOMS_DOWNLOAD_DIR === 'C:\\cache'
        && e.R2_BUCKET_BANC === 'bucket-banc' && e.R2_BANC_ACCESS_KEY_ID === 'banc-id' && e.R2_BANC_SECRET_ACCESS_KEY === 'banc-secret');
    verifier('dotenv : les noms du .env non transmis sont posés VIDES (une variable présente n\'est jamais remise par dotenv)', e.STRIPE_SECRET_KEY === '' && e.OPENROUTER_API_KEY === '' && e.MONGODB_URI === '' && e.TOTO === '');
    verifier('dotenv : une variable TRANSMISE n\'est pas vidée', e.MONGODB_LECTURE_URI === origine.MONGODB_LECTURE_URI);
    verifier('la liste fermée est une liste de NOMS exacts (aucun motif large)', Array.isArray(VARIABLES_TRANSMISES) && VARIABLES_TRANSMISES.every(n => typeof n === 'string' && /^[A-Za-z0-9_()]+$/.test(n)));
    verifier('aucun nom de la liste fermée ne désigne un secret connu', !VARIABLES_TRANSMISES.some(n => /STRIPE|OPENROUTER|JETON|SECRET|KEY|MONGODB_URI|MONGODB_CARTES_URI|MONGODB_TEST_URI|R2_ACCESS/.test(n.replace(/R2_BANC_SECRET_ACCESS_KEY|R2_BANC_ACCESS_KEY_ID/, ''))));
    verifier('un environnement vide donne un environnement sans variable de connexion', Object.keys(environnementDuCliquet({})).length === 0);
}

console.log('--- R8 A-I2 : verrou-charges.js applique la même garde et le même refus de jeton ---');
{
    const sc = fs.readFileSync(path.join(__dirname, 'verrou-charges.js'), 'utf8');
    verifier('verrou-charges.js : plus de repli de jeton en dur', !/JETON_API\s*\|\|/.test(sc) && !/'jeton-verrou'/.test(sc));
    verifier('verrou-charges.js : plus aucune ouverture directe de process.env.MONGODB_URI', !/process\.env\.MONGODB_URI/.test(sc));
    verifier('verrou-charges.js : la garde et le refus de jeton sont appelés', /verifierEnvironnementBanc\(/.test(sc) && /uriDuBanc\(/.test(sc) && /jetonOuRefus\(/.test(sc));
    const jc = sc.indexOf('jetonOuRefus('), ob = sc.indexOf('await ouvrirBanc('), ap = sc.indexOf('banc.appliquer()'), gu = sc.indexOf('verifierEnvironnementBanc('), cp = sc.indexOf('connexionProduction(mongoose');
    verifier('verrou-charges.js : jeton refusé AVANT ouvrirBanc ; garde APRÈS appliquer() et AVANT toute connexion', jc > -1 && jc < ob && ap > ob && gu > ap && gu < cp);
}

// Le cliquet ne doit lister que des suites qui DÉMARRENT : test-setcode-numero.js refuse depuis le 2026-10-08 (marqueur « REFUS DE DÉMARRER ») et faisait échouer le verrou à chaque passage.
const cliquetSrc = fs.readFileSync(path.join(__dirname, 'couverture-index.js'), 'utf8');
const liste = (cliquetSrc.match(/const SUITES_HORS_LIGNE = \[([\s\S]*?)\];/) || [])[1] || '';
const suitesListees = [...liste.replace(/\/\/.*$/gm, '').matchAll(/'([^']+\.js)'/g)].map(m => m[1]);
verifier(`la liste des suites du cliquet est lue (${suitesListees.length} suites)`, suitesListees.length >= 10);
const refusent = suitesListees.filter(s => /REFUS DE DÉMARRER/.test(fs.readFileSync(path.join(__dirname, s), 'utf8')));
verifier('aucune suite du cliquet ne refuse de démarrer', refusent.length === 0 && /SUITES_REFUSEES/.test(cliquetSrc));

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
