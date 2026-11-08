'use strict';
// Pilote LOCAL du TEST DE DETECTION de la page de banc : les vraies routes (routes.js : page, fichiers, CSP, isolement), un faux depot (validation REELLE du schema, en memoire), Chrome headless (profil neuf, CDP) qui clique
// « Tester la detection ». Aucun reseau externe, aucune base. Arret de Chrome par PID, profil jetable retire (il ne contient aucune jonction : cree par ce script).
//   node outils\detection\pilote-detection.js [--mutation=<nom>]     (--mutation : sert une detection.mjs modifiee, pour voir la page dire ECART)
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const MUT = arg('mutation', '');
const express = require('express');
const routes = require('../../v2/banc-telephone/routes');
const S = require('../../v2/banc-telephone/stockage');
const PUB = path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public');
const cfg = { modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2', octets: 1 } };
const deposes = [];
const app = express(); app.use(require('../../v2/banc-telephone/corps').analyseur()); app.use(express.json());
if (MUT === 'quad') {   // une detection qui depend d'un seuil different : la page doit le voir
    const t = fs.readFileSync(path.join(PUB, 'detection.mjs'), 'utf8').replace('/ RATIO > 0.15', '/ RATIO > 0.02');
    app.get('/api/banc/telephone/detection.mjs', (req, res) => { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.end(t); });
}
app.post('/api/banc/telephone/resultat', (req, res) => { const v = S.valider(req.body); if (!v.ok) { deposes.push({ refuse: v.detail }); return res.status(400).json({ success: false, detail: v.detail }); } deposes.push(v.doc); res.status(201).json({ success: true, id: 'local' }); });
const router = express.Router(); routes.monter(router, cfg, { envBancTelephone: { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai' } }); app.use(router);
const srv = http.createServer(app);
const attente = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port, dbg = 19700 + Math.floor(Math.random() * 90);
    const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-det-'));
    const chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
    let sortie = 0;
    try {
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const ws = new WebSocket(cible.webSocketDebuggerUrl); await new Promise((r, k) => { ws.onopen = r; ws.onerror = k; });
        let id = 0; const cdp = (method, params = {}) => new Promise(r => { const n = ++id; const h = ev => { const d = JSON.parse(ev.data); if (d.id === n) { ws.removeEventListener('message', h); r(d); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: n, method, params })); });
        const evalue = async (expression, attendre = false) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: attendre, returnByValue: true, timeout: 300000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
        const erreursConsole = [];
        ws.addEventListener('message', ev => { const d = JSON.parse(ev.data); if (d.method === 'Runtime.exceptionThrown') erreursConsole.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200)); if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/Failed to load resource/.test(d.params.entry.text)) erreursConsole.push(d.params.entry.text.slice(0, 200)); });
        await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/api/banc/telephone` });
        for (let i = 0; i < 60; i++) { await attente(500); if (await evalue('Boolean(document.getElementById("btnDetection"))')) break; }
        await attente(1500);
        const t = Date.now();
        await evalue('document.getElementById("btnDetection").click()');
        for (let i = 0; i < 240; i++) { await attente(500); if (await evalue('document.getElementById("detectionEnvoi").textContent.length > 0')) break; }
        const ecran = JSON.parse(await evalue(`JSON.stringify({ mot: document.getElementById('detectionVerdict').textContent, detail: document.getElementById('detectionDetail').textContent, temps: document.getElementById('detectionTemps').textContent, envoi: document.getElementById('detectionEnvoi').textContent })`));
        console.log(`test termine en ${Math.round((Date.now() - t) / 1000)} s`);
        console.log(JSON.stringify(ecran, null, 1));
        const d = deposes[0];
        console.log('depose :', d && d.mesure ? JSON.stringify({ verdict: d.mesure.verdict, detection: d.mesure.detection, isole: d.isole, ua: d.ua }, null, 1) : JSON.stringify(deposes));
        if (erreursConsole.length) console.log('erreurs console (CSP, JS) :', erreursConsole.slice(0, 5));
        if (!d || d.refuse || !d.mesure.detection) sortie = 2;
        else if (!MUT && (d.mesure.verdict !== 'IDENTIQUE' || d.mesure.detection.nIdentiques !== 12 || erreursConsole.length)) sortie = 3;
        else if (MUT && d.mesure.verdict !== 'ECART') sortie = 4;
        ws.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); sortie = 1; }
    try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* deja arrete */ }
    srv.close();
    setTimeout(() => { try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil jetable */ } process.exit(sortie); }, 2000);
})();
