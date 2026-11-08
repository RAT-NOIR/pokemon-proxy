'use strict';
// Pilote LOCAL de la PAGE de banc téléphone AVEC le décodeur Rat-Market branché : les vraies routes (v2/banc-telephone/routes.js : page, fichiers, CSP, isolement), un faux
// GET /api/modele-empreinte/<sha256> qui sert le modèle local, un faux dépôt (validation RÉELLE du schéma, en mémoire), puis Chrome headless (profil neuf, CDP) qui lance la mesure WASM.
// Deux scénarios : normal (30 cartes par Rat-Market) et --refus=1 (la carte 5 est remplacée par un WebP SANS PERTE : Rat-Market le refuse NON_SUPPORTE, le navigateur le décode : la page doit retomber
// sur le navigateur, le dire « NON IDENTIQUE AU BIT », et déposer le chemin « mixte »). Aucun réseau externe, aucune base. Arrêt de Chrome par PID.
//   node outils\decodeur\pilote-page.js [--refus=1] [--modele=<fichier.onnx>]
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const REFUS = arg('refus', '0') === '1';
const MODELE = arg('modele', 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx');
const express = require('express');
const routes = require('../../v2/banc-telephone/routes');
const S = require('../../v2/banc-telephone/stockage');
const PUB = path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public');
const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
const cfg = { modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: lot.modeleSha256, octets: fs.statSync(MODELE).size } };
const deposes = [];
const app = express(); app.use(require('../../v2/banc-telephone/corps').analyseur()); app.use(express.json());
if (REFUS) {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'v2', 'test', 'fixtures-decodeur', 'pil-synthetique.json'), 'utf8')).cas.find(x => x.nom === 'webp-lossless-100x75');
    const modif = JSON.parse(JSON.stringify(lot)); modif.cartes[5].jpg = fx.b64;
    const texte = JSON.stringify(modif);
    app.get('/api/banc/telephone/lot.json', (req, res) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.end(texte); });
}
app.get(`/api/modele-empreinte/${lot.modeleSha256}`, (req, res) => { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(fs.statSync(MODELE).size)); fs.createReadStream(MODELE).pipe(res); });
app.post('/api/banc/telephone/resultat', (req, res) => { const v = S.valider(req.body); if (!v.ok) { deposes.push({ refuse: v.detail }); return res.status(400).json({ success: false, detail: v.detail }); } deposes.push(v.doc); res.status(201).json({ success: true, id: 'local' }); });
const router = express.Router(); routes.monter(router, cfg, { envBancTelephone: { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai' } }); app.use(router);
const srv = http.createServer(app);
const attente = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port, dbg = 19600 + Math.floor(Math.random() * 90);
    const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-page-'));
    const chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
    let sortie = 0;
    try {
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const ws = new WebSocket(cible.webSocketDebuggerUrl); await new Promise((r, k) => { ws.onopen = r; ws.onerror = k; });
        let id = 0; const cdp = (method, params = {}) => new Promise(r => { const n = ++id; const h = ev => { const d = JSON.parse(ev.data); if (d.id === n) { ws.removeEventListener('message', h); r(d); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: n, method, params })); });
        const evalue = async (expression, attendre = false) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: attendre, returnByValue: true, timeout: 900000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
        await cdp('Page.enable'); await cdp('Runtime.enable');
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/api/banc/telephone` });
        for (let i = 0; i < 60; i++) { await attente(500); if (await evalue('Boolean(window.__banc)')) break; }
        const t = Date.now();
        await evalue('window.__banc.lancer("wasm")', true);
        const ecran = JSON.parse(await evalue(`JSON.stringify({ mot: document.getElementById('verdictMot').textContent, detail: document.getElementById('verdictDetail').textContent, l1: document.getElementById('ligne1').textContent, l4: document.getElementById('ligne4').textContent, l5: document.getElementById('ligne5').textContent, envoi: document.getElementById('envoi').textContent })`));
        console.log(`mesure ${REFUS ? '(scénario refus) ' : ''}terminée en ${Math.round((Date.now() - t) / 1000)} s`);
        console.log(JSON.stringify(ecran, null, 1));
        const d = deposes[0];
        console.log('déposé :', d && d.mesure ? JSON.stringify({ verdict: d.mesure.verdict, cosMin: d.mesure.cosMin, cosMinModeleSeul: d.mesure.cosMinModeleSeul, entree: d.mesure.entree, orientationNavigateur: d.mesure.orientationNavigateur, medianePretraitementMs: d.mesure.pretraitementMedianeMs, ua: d.ua }, null, 1) : JSON.stringify(deposes));
        if (!d || d.refuse || !d.mesure.entree) sortie = 2;
        else if (!REFUS && (d.mesure.entree.chemin !== 'rm' || d.mesure.entree.identiqueAuBit !== true || d.mesure.verdict !== 'IDENTIQUE')) sortie = 3;
        else if (REFUS && (d.mesure.entree.chemin !== 'mixte' || d.mesure.entree.identiqueAuBit !== false || d.mesure.entree.refus.NON_SUPPORTE !== 1 || !/NON IDENTIQUE AU BIT/.test(ecran.l5))) sortie = 4;
        ws.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); sortie = 1; }
    try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* deja arrete */ }
    srv.close();
    setTimeout(() => { try { for (const f of fs.readdirSync(profil)) fs.rmSync(path.join(profil, f), { recursive: true, force: true }); fs.rmdirSync(profil); } catch { /* profil jetable */ } process.exit(sortie); }, 1500);
})();
