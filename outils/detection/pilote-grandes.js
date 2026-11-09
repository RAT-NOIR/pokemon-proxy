'use strict';
// Pilote LOCAL de la section « Photos du telephone » de la page de banc : vraies routes, faux depot (validation REELLE), Chrome headless (profil neuf, CDP) ; les fichiers sont donnes au selecteur par DOM.setFileInputFiles (comme un telephone qui en choisit).
//   node outils\detection\pilote-grandes.js <fichier.jpg> [<fichier.jpg> ...]        (au plus 12 ; les images ne sont lues que par le navigateur local, jamais envoyees : le faux depot ne recoit que des empreintes)
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const FICHIERS = process.argv.slice(2).map((f) => path.resolve(f));
const express = require('express');
const routes = require('../../v2/banc-telephone/routes');
const S = require('../../v2/banc-telephone/stockage');
const cfg = { modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2', octets: 1 } };
const deposes = [];
const app = express(); app.use(require('../../v2/banc-telephone/corps').analyseur()); app.use(express.json());
app.post('/api/banc/telephone/resultat', (req, res) => { const v = S.valider(req.body); if (!v.ok) { deposes.push({ refuse: v.detail }); return res.status(400).json({ success: false, detail: v.detail }); } deposes.push(v.doc); res.status(201).json({ success: true, id: 'local' }); });
const router = express.Router(); routes.monter(router, cfg, { envBancTelephone: { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai' } }); app.use(router);
const srv = http.createServer(app);
const attente = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port, dbg = 19800 + Math.floor(Math.random() * 90);
    const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-gr-'));
    const chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
    let sortie = 0;
    try {
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((x) => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const ws = new WebSocket(cible.webSocketDebuggerUrl); await new Promise((r, k) => { ws.onopen = r; ws.onerror = k; });
        let id = 0; const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === n) { ws.removeEventListener('message', h); r(d); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: n, method, params })); });
        const evalue = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
        const erreursConsole = [];
        ws.addEventListener('message', (ev) => { const d = JSON.parse(ev.data); if (d.method === 'Runtime.exceptionThrown') erreursConsole.push(JSON.stringify(d.params.exceptionDetails).slice(0, 300)); if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/Failed to load resource/.test(d.params.entry.text)) erreursConsole.push(d.params.entry.text.slice(0, 200)); });
        await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable'); await cdp('DOM.enable');
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/api/banc/telephone` });
        for (let i = 0; i < 60; i++) { await attente(500); if (await evalue('Boolean(document.getElementById("btnGrandes"))')) break; }
        await attente(1500);
        const doc = (await cdp('DOM.getDocument')).result.root.nodeId;
        const noeud = (await cdp('DOM.querySelector', { nodeId: doc, selector: '#fichiersGrandes' })).result.nodeId;
        await cdp('DOM.setFileInputFiles', { files: FICHIERS, nodeId: noeud });
        const t = Date.now();
        await evalue('document.getElementById("btnGrandes").click()');
        let etat = '';
        for (let i = 0; i < 1200; i++) { await attente(500); etat = await evalue('document.getElementById("grandesEtat").textContent'); if (/mesurée\(s\)/.test(etat)) break; }
        const lignes = JSON.parse(await evalue('JSON.stringify(Array.from(document.querySelectorAll("#grandesListe li")).map(li => li.textContent))'));
        const mem = await evalue('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null');
        console.log(`mesure terminee en ${Math.round((Date.now() - t) / 1000)} s (${FICHIERS.length} fichier(s)) ; tas JS ${mem} Mo\n${etat}`);
        for (const l of lignes) console.log(' ', l);
        console.log('depots :', deposes.map((d) => (d.refuse ? 'REFUSE ' + d.refuse : `${d.mesure.grandesPhotos.photos.length} photo(s)`)).join(', '));
        const toutes = deposes.flatMap((d) => (d.mesure && d.mesure.grandesPhotos ? d.mesure.grandesPhotos.photos : []));
        console.log('aucun octet d\'image dans les depots :', JSON.stringify(deposes).length < 20000 && !/"b64"|data:image/.test(JSON.stringify(deposes)));
        if (toutes.length) console.log('1re photo deposee :', JSON.stringify(toutes[0]));
        if (erreursConsole.length) console.log('erreurs console :', erreursConsole.slice(0, 4));
        if (deposes.some((d) => d.refuse) || toutes.length !== FICHIERS.length || erreursConsole.length) sortie = 3;
        ws.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); sortie = 1; }
    try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* deja arrete */ }
    srv.close();
    setTimeout(() => { try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil jetable */ } process.exit(sortie); }, 2000);
})();
