'use strict';
// Pilote LOCAL de la page de banc téléphone : un serveur 127.0.0.1 qui monte les VRAIES routes de la page (v2/banc-telephone/routes.js : page, fichiers, CSP, isolement), un faux
// GET /api/modele-empreinte/<sha256> qui sert le fichier du modèle local (le vrai renvoie un 302 vers R2 : le CORS du bucket n'est pas éprouvé ici) et un faux dépôt de résultats (validation réelle, mémoire),
// puis un Chrome headless (profil neuf, CDP) qui ouvre la page et lance la mesure. Aucun réseau externe, aucune base. Arrêt par PID.
//   node outils\banc-telephone\pilote-local.js [--moteur=wasm|webgpu|tous] [--iso=0] [--modele=<fichier.onnx>] [--delai=600]
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const MOTEUR = arg('moteur', 'wasm'), ISO = arg('iso', '1'), DELAI = Number(arg('delai', '600'));
const MODELE = arg('modele', 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx');
const express = require('express');
const routes = require('../../v2/banc-telephone/routes');
const S = require('../../v2/banc-telephone/stockage');
const lot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'lot.json'), 'utf8'));
const cfg = { modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: lot.modeleSha256, octets: fs.statSync(MODELE).size } };
const deposes = [];
const app = express(); app.use(express.json());
app.get(`/api/modele-empreinte/${lot.modeleSha256}`, (req, res) => { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(fs.statSync(MODELE).size)); fs.createReadStream(MODELE).pipe(res); });
app.post('/api/banc/telephone/resultat', (req, res) => { const v = S.valider(req.body); if (!v.ok) { deposes.push({ refuse: v.detail }); return res.status(400).json({ success: false, detail: v.detail }); } deposes.push(v.doc); res.status(201).json({ success: true, id: 'local' }); });
const router = express.Router(); routes.monter(router, cfg, { envBancTelephone: { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg' } }); app.use(router);
const srv = http.createServer(app);
const attente = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port, dbg = 19400 + Math.floor(Math.random() * 90);
    const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-banc-tel-'));
    const chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
    let sortie = 0;
    try {
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const ws = new WebSocket(cible.webSocketDebuggerUrl); await new Promise((r, k) => { ws.onopen = r; ws.onerror = k; });
        let id = 0; const cdp = (method, params = {}) => new Promise(r => { const n = ++id; const h = ev => { const d = JSON.parse(ev.data); if (d.id === n) { ws.removeEventListener('message', h); r(d); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: n, method, params })); });
        const evalue = async (expression, attendre = false) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: attendre, returnByValue: true, timeout: DELAI * 1000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
        await cdp('Page.enable'); await cdp('Runtime.enable');
        const url = `http://127.0.0.1:${port}/api/banc/telephone${ISO === '0' ? '?iso=0' : ''}`;
        await cdp('Page.navigate', { url });
        for (let i = 0; i < 60; i++) { await attente(500); if (await evalue('Boolean(window.__banc)')) break; }
        const avant = await evalue('JSON.stringify({isole: self.crossOriginIsolated, nav: navigator.userAgent, gpu: typeof navigator.gpu, coeurs: navigator.hardwareConcurrency})');
        console.log('page ouverte :', avant);
        const t = Date.now();
        for (const m of (MOTEUR === 'tous' ? ['wasm', 'webgpu'] : [MOTEUR])) await evalue(`window.__banc.lancer(${JSON.stringify(m)})`, true);
        const ecran = JSON.parse(await evalue(`JSON.stringify({ mot: document.getElementById('verdictMot').textContent, detail: document.getElementById('verdictDetail').textContent, l1: document.getElementById('ligne1').textContent, l2: document.getElementById('ligne2').textContent, l3: document.getElementById('ligne3').textContent, envoi: document.getElementById('envoi').textContent, journal: document.getElementById('journal').textContent })`));
        console.log(`mesure ${MOTEUR} terminée en ${Math.round((Date.now() - t) / 1000)} s`);
        console.log(JSON.stringify(ecran, null, 1));
        console.log('déposé :', JSON.stringify(deposes.map(d => d.refuse ? d : { moteur: d.mesure.moteur, verdict: d.mesure.verdict, cosMin: d.mesure.cosMin, cosMinModeleSeul: d.mesure.cosMinModeleSeul, cosMinContreWasm: d.mesure.cosMinContreWasm, fils: d.mesure.fils, medianeMs: d.mesure.medianeMs, isole: d.isole, shaVerifie: d.shaVerifie, erreur: d.mesure.erreur })));
        if (!deposes.length || deposes.some(d => d.refuse)) sortie = 2;
        if (MOTEUR === 'wasm' && ecran.mot !== 'IDENTIQUE') sortie = 3;
        ws.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); sortie = 1; }
    try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* deja arrete */ }
    srv.close();
    setTimeout(() => { try { for (const f of fs.readdirSync(profil)) fs.rmSync(path.join(profil, f), { recursive: true, force: true }); fs.rmdirSync(profil); } catch { /* profil jetable */ } process.exit(sortie); }, 1500);
})();
