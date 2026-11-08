'use strict';
// Pilote de la page de banc téléphone sur l'APPLICATION ENTIÈRE (index.js avec la v2, comme test-montage.js : verrou/serveur.js) + un Chrome headless qui ouvre la VRAIE adresse de la page.
// Contrairement à pilote-local.js (les routes de la page seules), celui-ci traverse la garde CORS héritée, le profil CORS de la page, l'analyseur de 8 Ko, les gardes de la v2 et la base (banc, en mémoire, base nommée rm_essai).
// Seul le modèle est simulé : le vrai GET /api/modele-empreinte/<sha256> répond 302 vers R2 (hors de portée ici) ; Chrome (CDP, Fetch.fulfillRequest) le sert depuis le fichier local, SANS toucher aux autres requêtes.
// L'adresse ouverte porte le vrai en-tête Origin de l'essai ? Non : 127.0.0.1 (le profil CORS de l'essai ne s'y applique pas) — l'origine de l'essai est éprouvée par test-banc-telephone-cors.js ; ici, l'ORIGINE
// locale est ajoutée à la liste par la variable V2_ORIGINE_EXTENSION_DEV ? Non (refusée hors banc) : on pose l'en-tête Origin de l'essai par CDP (Network.setExtraHTTPHeaders) sur chaque requête de la page.
//   node outils\banc-telephone\pilote-app-entiere.js [--moteur=wasm|webgpu|tous] [--iso=0]
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const MOTEUR = arg('moteur', 'wasm'), ISO = arg('iso', '1');
const MODELE = 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx';
const MODELE_BUF = fs.readFileSync(MODELE);      // lu AVANT le harnais : le harnais arme l'espion des fichiers (aucune lecture hors du dépôt ensuite)
const { demarrer, RACINE } = require('../../verrou/serveur');
const H = require('../../v2/test/_harnais');
const lot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'lot.json'), 'utf8'));
const attente = ms => new Promise(r => setTimeout(r, ms));
const ESSAI = 'https://rat-market-api-essai.onrender.com';

(async () => {
    await H.ouvrirBancV2();
    const mongoose = require('mongoose'), M = require('../../v2/modeles');
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'rm_essai' }).asPromise();
    await M.creerIndex(undefined, nom => c.db.collection(nom));
    const srv = await demarrer(path.join(RACINE, 'verrou', 'faux-reseau.js'), {
        VERROU_CHARGES: path.join(RACINE, 'verrou', 'charges.json'), JETON_API: 'jeton-pilote-app', OPENROUTER_API_KEY: '', RM_API_V2: '1',
        V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai', V2_SECRET_EMPREINTE: 'e'.repeat(40),
        V2_EMPREINTE_EXTENSION: '1', V2_MODELE_EMPREINTE_ID: 'p8000-poids8s-1', V2_MODELE_EMPREINTE_SHA256: lot.modeleSha256, V2_MODELE_EMPREINTE_OCTETS: String(MODELE_BUF.length), V2_MODELE_EMPREINTE_OBJET: 'modeles/pilote-local'
    });
    let sortie = 0, chrome = null, profil = null;
    try {
        if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
        const base = `http://127.0.0.1:${srv.port}`;
        for (let i = 0; i < 80; i++) { const r = await fetch(`${base}/api/banc/etiquette`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (r.status === 401) break; await attente(250); }
        const dbg = 19500 + Math.floor(Math.random() * 90);
        profil = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-banc-app-'));
        chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const ws = new WebSocket(cible.webSocketDebuggerUrl); await new Promise((r, k) => { ws.onopen = r; ws.onerror = k; });
        let id = 0; const cdp = (method, params = {}) => new Promise(r => { const n = ++id; const h = ev => { const d = JSON.parse(ev.data); if (d.id === n) { ws.removeEventListener('message', h); r(d); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: n, method, params })); });
        const evalue = async (expression, attendre = false) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: attendre, returnByValue: true, timeout: 600000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
        const refus = [];
        const http = require('http');
        const serveurModele = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': MODELE_BUF.length, 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }); r.end(MODELE_BUF); });
        await new Promise(r => serveurModele.listen(0, '127.0.0.1', r)); const portModele = serveurModele.address().port;
        ws.addEventListener('message', async ev => {
            const d = JSON.parse(ev.data);
            if (d.method === 'Network.responseReceived' && d.params.response.status >= 400) refus.push(`${d.params.response.status} ${d.params.response.url}`);
            if (d.method === 'Log.entryAdded') console.log('   journal navigateur :', d.params.entry.level, String(d.params.entry.text).slice(0, 200), String(d.params.entry.url || '').slice(0, 120));
            if (d.method === 'Runtime.exceptionThrown') console.log('   exception page :', JSON.stringify(d.params.exceptionDetails).slice(0, 300));
            if (d.method === 'Fetch.requestPaused') {
                if (/\/api\/modele-empreinte\//.test(d.params.request.url)) {
                    ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId: d.params.requestId, url: `http://127.0.0.1:${portModele}/modele` } }));
                } else {
                    // Chrome envoie « Origin » à un script de type module et à un fetch (ici celui de 127.0.0.1) : sur la vraie adresse ce serait l'origine de l'essai ; on remplace SEULEMENT cet en-tête, quand le navigateur l'a posé
                    const h = Object.entries(d.params.request.headers).map(([name, value]) => ({ name, value: name.toLowerCase() === 'origin' ? ESSAI : value }));
                    ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId: d.params.requestId, headers: h } }));
                }
            }
        });
        await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable'); await cdp('Network.enable');
        await cdp('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
        await cdp('Page.navigate', { url: `${base}/api/banc/telephone${ISO === '0' ? '?iso=0' : ''}` });
        for (let i = 0; i < 60; i++) { await attente(500); if (await evalue('Boolean(window.__banc)')) break; }
        console.log('page ouverte :', await evalue('JSON.stringify({isole: self.crossOriginIsolated, ressources: performance.getEntriesByType(\'resource\').map(r => r.name.split(\'/\').pop()).slice(0, 12)})'));
        for (const m of (MOTEUR === 'tous' ? ['wasm', 'webgpu'] : [MOTEUR])) await evalue(`window.__banc.lancer(${JSON.stringify(m)})`, true);
        const ecran = JSON.parse(await evalue(`JSON.stringify({ mot: document.getElementById('verdictMot').textContent, l1: document.getElementById('ligne1').textContent, l2: document.getElementById('ligne2').textContent, l3: document.getElementById('ligne3').textContent, envoi: document.getElementById('envoi').textContent })`));
        console.log(JSON.stringify(ecran, null, 1));
        const docs = await c.db.collection('banc_telephone').find({}).sort({ _id: 1 }).toArray();
        console.log('déposés en base (rm_essai.banc_telephone) :', JSON.stringify(docs.map(d => ({ moteur: d.mesure.moteur, verdict: d.mesure.verdict, cosMin: d.mesure.cosMin, garde: d.mesure.gardeExtension }))));
        console.log('réponses >= 400 vues par le navigateur :', JSON.stringify(refus));
        if (!docs.length || refus.some(x => !/modele-empreinte|favicon/.test(x))) sortie = 2;
        if (MOTEUR === 'wasm' && ecran.mot !== 'IDENTIQUE') sortie = 3;
        ws.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); console.log(srv.lire().slice(-600)); sortie = 1; }
    try { if (chrome) cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* arrêté */ }
    srv.enfant.kill(); await c.close();
    setTimeout(() => { try { if (profil) { for (const f of fs.readdirSync(profil)) fs.rmSync(path.join(profil, f), { recursive: true, force: true }); fs.rmdirSync(profil); } } catch { /* jetable */ } process.exit(sortie); }, 1500);
})().catch(e => { console.error(e); process.exit(1); });
