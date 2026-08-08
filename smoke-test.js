// ============================================================
// SMOKE TEST — la classe d'erreurs que `node --check` ne voit pas
// ============================================================
// POURQUOI IL EXISTE. Deux pannes sont parties EN PRODUCTION alors que toutes les
// vérifications étaient au vert :
//   - un `index.js` réencodé en double UTF-8 (1695 séquences abîmées) ;
//   - un `numeroDepuisSlug` appelé mais jamais importé, qui cassait /api/apprendre-lot.
// `node --check` PARSE le fichier, il ne l'exécute pas : un identifiant manquant ne
// casse qu'à l'exécution de sa ligne, donc en production, et de préférence sur un
// endpoint rarement appelé. Les tests unitaires, eux, n'ont jamais chargé index.js.
//
// CE TEST FERME LA CLASSE ENTIÈRE, pas les deux instances :
//   1. il CHARGE réellement chaque module (un import manquant ou un fichier corrompu
//      lève ici, pas chez l'utilisateur) ;
//   2. il DÉMARRE le vrai serveur, contre test_scratch, sur un port libre ;
//   3. il appelle CHAQUE route une fois et vérifie le code de retour attendu.
//
// ⚠️ CE QU'IL NE FAIT PAS, ET C'EST VOULU :
//   - aucun appel à l'IA (payant) : les routes de scan sont appelées SANS image, ce qui
//     les arrête dans `exigerImage`, donc APRÈS le routage et les gardes mais AVANT
//     toute dépense et tout décompte de crédit ;
//   - aucun appel Stripe réel ni à Cardmarket ;
//   - aucune écriture ailleurs que dans test_scratch, et le script REFUSE de démarrer
//     si la base n'est pas celle-là.
// Il valide le CÂBLAGE et l'ACCESSIBILITÉ, pas la logique métier — celle-ci a ses
// propres suites (scoring.js, test-acces.js, test-identification-locale.js).
//
// USAGE :  node smoke-test.js
// À lancer avant chaque push.

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const BASE_SCRATCH = 'test_scratch';
const JETON = process.env.JETON_API || 'jeton-smoke-test';

let echecs = 0;
function verifier(libelle, obtenu, attendu) {
    const ok = Array.isArray(attendu) ? attendu.includes(obtenu) : obtenu === attendu;
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle} : ${obtenu}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    return ok;
}

// ---- 1. CHARGEMENT RÉEL DES MODULES ------------------------------------
// C'est l'étape qui aurait attrapé les deux pannes. Un require() exécute le module :
// les destructurations sont résolues, les erreurs de syntaxe ET d'encodage lèvent.
function chargerLesModules() {
    console.log('\n=== 1. Chargement réel des modules ===');
    const modules = ['./scoring', './acces', './journal-scans', './identification-locale', './mongo-connexion', './pokedex'];
    for (const m of modules) {
        try {
            const mod = require(m);
            const noms = Object.keys(mod);
            verifier(`${m} chargé (${noms.length} exports)`, noms.length > 0, true);
        } catch (e) {
            echecs++;
            console.log(`  ❌ ${m} : ${e.message}`);
        }
    }
    // index.js n'est PAS requis ici : il démarre un serveur. Il est chargé à l'étape 2,
    // dans un processus séparé, ce qui teste exactement ce que fait Render.
}

// ---- 1 bis. LES IMPORTS MANQUANTS QUE L'EXÉCUTION NE RÉVÈLE PAS ---------
// Le démarrage du serveur n'exécute PAS le corps des routes. Un helper appelé dans une
// branche rarement prise — un `return` d'échec, un catch — reste donc invisible même
// quand tout est vert. C'est littéralement la panne `numeroDepuisSlug` : elle vivait
// dans /api/apprendre-lot, une route que rien n'appelait au démarrage.
//
// Ce contrôle est STATIQUE et général : pour chaque module local, il compare ce que le
// module EXPORTE, ce qu'index.js IMPORTE, et ce qu'index.js UTILISE. Un nom utilisé,
// exporté quelque part, mais absent de la ligne d'import est une panne à retardement.
// Les noms qu'index.js définit lui-même sont écartés — ce sont des homonymes, pas des
// oublis.
// ⚠️ CE CONTRÔLE A ÉTÉ DÉPLACÉ ET GÉNÉRALISÉ — voir verifier-sources.js et
// test-chargement.js. Il ne portait que sur index.js ; il porte maintenant sur les 51
// fichiers du projet, y compris les outils en ligne de commande que RIEN ne chargeait.
// C'est ce trou qui a laissé partir un `const lignes` déclaré deux fois dans
// saisir-verites.js, avec huit suites au vert.
// La fonction ci-dessous délègue : en garder une seconde copie ici la ferait diverger de
// l'autre au premier correctif — deuxième principe, quatre fois vérifié cette semaine.
function verifierLesImports() {
    console.log('\n=== 1 bis. Imports : utilisés mais jamais importés ===');
    const { verifierImports } = require('./verifier-sources');
    const oublis = verifierImports(path.join(__dirname, 'index.js'))
        .map(o => `${o.nom} (exporté par ${o.module})`);
    verifier(`aucun identifiant utilisé sans être importé`, oublis.length, 0);
    for (const o of oublis) console.log(`     ❌ ${o}`);
    console.log(`     (le projet entier est couvert par : node test-chargement.js)`);
}

// ---- Utilitaires réseau -------------------------------------------------
function portLibre() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
        s.on('error', reject);
    });
}
function attendreServeur(port, timeoutMs = 30000) {
    const debut = Date.now();
    return new Promise((resolve, reject) => {
        const essai = () => {
            const s = net.connect(port, '127.0.0.1');
            s.on('connect', () => { s.destroy(); resolve(); });
            s.on('error', () => {
                s.destroy();
                if (Date.now() - debut > timeoutMs) reject(new Error('le serveur n\'a pas démarré à temps'));
                else setTimeout(essai, 250);
            });
        };
        essai();
    });
}
async function appeler(port, methode, chemin, { corps = null, jeton = true, brut = false } = {}) {
    const entetes = {};
    if (jeton) entetes['x-jeton'] = JETON;
    let body;
    if (corps !== null) {
        if (brut) { entetes['Content-Type'] = 'application/json'; body = corps; }
        else { entetes['Content-Type'] = 'application/json'; body = JSON.stringify(corps); }
    }
    const r = await fetch(`http://127.0.0.1:${port}${chemin}`, { method: methode, headers: entetes, body });
    let json = null;
    const texte = await r.text();
    try { json = JSON.parse(texte); } catch (_) { /* réponse texte, c'est permis */ }
    return { status: r.status, json, texte: texte.slice(0, 120) };
}

// ---- 2 et 3. DÉMARRAGE + APPEL DE CHAQUE ROUTE -------------------------
async function testerLesRoutes() {
    console.log('\n=== 2. Démarrage du serveur contre test_scratch ===');
    const port = await portLibre();
    const enfant = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
        env: {
            ...process.env,
            // ⚠️ LE VERROU : index.js s'arrête de lui-même si la base connectée n'est pas
            // celle-ci (voir le bloc MONGODB_BASE). Le smoke test ne peut donc pas
            // toucher la production, même par accident de configuration.
            MONGODB_BASE: BASE_SCRATCH,
            PORT: String(port),
            JETON_API: JETON,
            // Stripe volontairement absent : les routes de paiement doivent répondre 503
            // proprement plutôt que de planter, et c'est justement ce qu'on vérifie.
            STRIPE_SECRET_KEY: ''
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let sortie = '';
    enfant.stdout.on('data', d => { sortie += d.toString(); });
    enfant.stderr.on('data', d => { sortie += d.toString(); });
    const fini = new Promise(res => enfant.on('exit', code => res(code)));

    try {
        await attendreServeur(port);
    } catch (e) {
        echecs++;
        console.log(`  ❌ ${e.message}`);
        console.log('  --- sortie du serveur ---\n' + sortie.split('\n').map(l => '    ' + l).join('\n'));
        enfant.kill();
        return;
    }
    console.log(`  ✅ serveur démarré sur le port ${port}`);

    // ⚠️ Le port s'ouvre AVANT que Mongo soit connecté : app.listen ne dépend pas de la
    // connexion. Attendre le seul port testerait donc une base pas encore prête, et
    // c'est exactement le faux négatif qu'on a vu au premier passage. /ping expose
    // readyState : on l'interroge jusqu'à ce qu'il confirme.
    let mongoPret = false;
    for (let i = 0; i < 40 && !mongoPret; i++) {
        const p = await appeler(port, 'GET', '/ping', { jeton: false });
        mongoPret = p.json?.mongo === true;
        if (!mongoPret) await new Promise(r => setTimeout(r, 250));
    }
    verifier('MongoDB connecté (via /ping)', mongoPret, true);
    verifier('base annoncée = test_scratch', /base "test_scratch"/.test(sortie), true);

    console.log('\n=== 3. Chaque route, une fois ===');

    // --- Routes publiques ---
    let r = await appeler(port, 'GET', '/ping', { jeton: false });
    verifier('GET /ping -> 200', r.status, 200);
    verifier('   ... et répond ok:true', r.json?.ok, true);

    r = await appeler(port, 'GET', '/', { jeton: false });
    verifier('GET / -> 200', r.status, 200);

    // --- Le jeton protège-t-il vraiment ? ---
    // Une route accidentellement non protégée est un risque réel : on le teste.
    for (const chemin of ['/api/analyser', '/api/identifier', '/api/apprendre', '/api/apprendre-lot', '/api/solde']) {
        r = await appeler(port, 'POST', chemin, { corps: {}, jeton: false });
        verifier(`POST ${chemin} SANS jeton -> 401`, r.status, 401);
    }

    // --- Routes de scan : arrêtées par exigerImage, donc AVANT toute dépense ---
    // 200 + {success:false} est le contrat existant (voir exigerImage) : l'extension
    // déployée s'y attend, un 4xx casserait le client.
    for (const chemin of ['/api/analyser', '/api/identifier']) {
        r = await appeler(port, 'POST', chemin, { corps: { title: 'smoke test' } });
        verifier(`POST ${chemin} sans image -> 200`, r.status, 200);
        verifier(`   ... success:false, aucun crédit consommé`, r.json?.success, false);
        verifier(`   ... et le motif est bien l'image`, /image/i.test(r.json?.error || ''), true);
    }

    // --- Apprentissage : la route qui a cassé en production ---
    // On envoie une carte RÉALISTE pour que le chemin numeroDepuisSlug s'exécute
    // vraiment. C'est exactement ce qui manquait : l'import oublié n'a été découvert
    // qu'en production parce qu'aucun test n'appelait cette ligne.
    r = await appeler(port, 'POST', '/api/apprendre-lot', {
        corps: {
            cartes: [{
                idProduct: 999000001, numero: '248', codeSet: 'mC',
                nomFr: 'Motisma', slug: 'Rotom-mC248?language=2', slugSet: 'Smoke-Test'
            }]
        }
    });
    verifier('POST /api/apprendre-lot -> 200', r.status, 200);
    verifier('   ... success:true (le recalcul du numeroUrl s\'exécute)', r.json?.success, true);
    verifier('   ... une carte reçue', r.json?.recus, 1);

    r = await appeler(port, 'POST', '/api/apprendre-lot', { corps: { cartes: [] } });
    verifier('POST /api/apprendre-lot lot vide -> success:false', r.json?.success, false);

    r = await appeler(port, 'POST', '/api/apprendre', { corps: {} });
    verifier('POST /api/apprendre corps vide -> 200 + success:false', r.status, 200);

    // --- Solde ---
    r = await appeler(port, 'POST', '/api/solde', { corps: {} });
    verifier('POST /api/solde sans userId -> 400', r.status, 400);
    r = await appeler(port, 'POST', '/api/solde', { corps: { userId: 'SMOKE-TEST-USER' } });
    verifier('POST /api/solde avec userId -> 200', r.status, 200);
    verifier('   ... renvoie les deux poches', typeof r.json?.soldeGratuit === 'number' && typeof r.json?.soldeScans === 'number', true);

    // --- Paiement : Stripe absent -> 503 propre, jamais un crash ---
    r = await appeler(port, 'POST', '/api/creer-recharge', { corps: { userId: 'SMOKE-TEST-USER', packId: 'p20' } });
    verifier('POST /api/creer-recharge sans Stripe -> 503', r.status, 503);

    // --- Webhook Stripe : signature absente -> 503 (Stripe non configuré) ---
    r = await appeler(port, 'POST', '/api/webhook-stripe', { corps: '{}', brut: true, jeton: false });
    verifier('POST /api/webhook-stripe sans Stripe -> 503', r.status, 503);

    // --- Nettoyage de ce que le smoke test a écrit dans test_scratch ---
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE_SCRATCH });
    }
    if (mongoose.connection.db.databaseName !== BASE_SCRATCH) {
        echecs++;
        console.log(`  ❌ base de nettoyage inattendue : ${mongoose.connection.db.databaseName}`);
    } else {
        const N = mongoose.models.NumeroCarte || mongoose.model('NumeroCarteST', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
        const C = mongoose.models.Credit || mongoose.model('CreditST', new mongoose.Schema({}, { strict: false }), 'credits');
        const supprN = (await N.deleteMany({ idProduct: 999000001 })).deletedCount;
        const supprC = (await C.deleteMany({ userId: 'SMOKE-TEST-USER' })).deletedCount;
        console.log(`\n🧹 Nettoyage test_scratch : ${supprN} numéro(s), ${supprC} crédit(s) supprimé(s).`);
    }
    await mongoose.disconnect();

    enfant.kill();
    await fini;

    // Le serveur a-t-il crié pendant le test ? Une exception non capturée s'y verrait.
    const erreursGraves = sortie.split('\n').filter(l => /UnhandledPromiseRejection|is not defined|is not a function|SyntaxError|ReferenceError|TypeError/.test(l));
    verifier('aucune erreur grave dans la sortie du serveur', erreursGraves.length, 0);
    if (erreursGraves.length) for (const l of erreursGraves.slice(0, 8)) console.log('     ' + l.trim());
}

(async () => {
    console.log('SMOKE TEST — chargement, démarrage, et une passe sur chaque route');
    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI absent du .env — impossible de démarrer le serveur.');
        process.exit(1);
    }
    chargerLesModules();
    verifierLesImports();
    await testerLesRoutes();
    console.log(`\n${echecs === 0 ? '🎉 Smoke test au vert.' : `⚠️ ${echecs} vérification(s) en échec.`}`);
    process.exit(echecs === 0 ? 0 : 1);
})().catch(e => {
    console.error('❌ Smoke test interrompu :', e.message, e.stack);
    process.exit(1);
});
