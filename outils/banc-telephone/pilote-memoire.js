'use strict';
// Pilote de MESURE MÉMOIRE de la page de banc téléphone (Chrome headless, profil neuf, CDP) : même montage que pilote-local.js (vraies routes de la page, faux GET /api/modele-empreinte, faux dépôt),
// plus (1) l'échantillonnage de la mémoire PRIVÉE de chaque processus Chrome par son PID toutes les 100 ms (echantillonneur-memoire.ps1) et son maximum par phase,
// (2) l'extraction des 30 empreintes WASM de la page (E.vecWasm) en binaire, pour la comparaison AU BIT PRÈS (comparer-empreintes.js).
//   node outils\banc-telephone\pilote-memoire.js --etiquette=avant [--moteur=wasm|tous] [--query=webgpu=forcer] [--vecs=<fichier.bin>] [--json=<fichier.json>] [--iso=0]
// Aucun réseau externe ; arrêt de Chrome par PID.
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const MOTEUR = arg('moteur', 'wasm'), ISO = arg('iso', '1'), DELAI = Number(arg('delai', '900')), ETIQ = arg('etiquette', 'mesure'), QUERY = arg('query', ''), VECS = arg('vecs', ''), JSON_OUT = arg('json', '');
const MODELE = arg('modele', 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx');
const express = require('express');
const routes = require('../../v2/banc-telephone/routes');
const S = require('../../v2/banc-telephone/stockage');
const lot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'lot.json'), 'utf8'));
const cfg = { modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: lot.modeleSha256, octets: fs.statSync(MODELE).size } };
const deposes = [];
const app = express(); app.use(require('../../v2/banc-telephone/corps').analyseur()); app.use(express.json());
app.get(`/api/modele-empreinte/${lot.modeleSha256}`, (req, res) => { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(fs.statSync(MODELE).size)); fs.createReadStream(MODELE).pipe(res); });
app.post('/api/banc/telephone/resultat', (req, res) => { const v = S.valider(req.body); if (!v.ok) { deposes.push({ refuse: v.detail }); return res.status(400).json({ success: false, detail: v.detail }); } deposes.push(v.doc); res.status(201).json({ success: true, id: 'local' }); });
const router = express.Router(); routes.monter(router, cfg, { envBancTelephone: { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai' } }); app.use(router);
const srv = http.createServer(app);
const attente = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port, dbg = 19400 + Math.floor(Math.random() * 90);
    const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-banc-mem-'));
    const chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', '--enable-unsafe-webgpu', 'about:blank'], { stdio: 'ignore' });
    let sortie = 0, echant = null; const stop = path.join(profil, 'STOP'), fichierMem = path.join(os.tmpdir(), `rm-mem-${process.pid}.csv`);
    try {
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const ouvrir = async url => { const w = new WebSocket(url); await new Promise((r, k) => { w.onopen = r; w.onerror = k; }); let n = 0; const c = (method, params = {}) => new Promise(r => { const i = ++n; const h = ev => { const d = JSON.parse(ev.data); if (d.id === i) { w.removeEventListener('message', h); r(d); } }; w.addEventListener('message', h); w.send(JSON.stringify({ id: i, method, params })); }); return { w, c }; };
        const { w: ws, c: cdp } = await ouvrir(cible.webSocketDebuggerUrl);
        const nav = await ouvrir((await (await fetch(`http://127.0.0.1:${dbg}/json/version`)).json()).webSocketDebuggerUrl);
        const evalue = async (expression, attendre = false) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: attendre, returnByValue: true, timeout: DELAI * 1000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
        await cdp('Page.enable'); await cdp('Runtime.enable');
        // --ua=iphone | ipad-bureau : l'agent utilisateur et la plateforme d'un appareil iOS (la détection de la page se joue ainsi dans Chrome ; le moteur reste celui de Chrome)
        const UA = arg('ua', '');
        if (UA === 'iphone') await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
        if (UA === 'ipad-bureau') { await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15', platform: 'MacIntel' }); await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
        if (arg('sonde-gpu', '') === '1') {
            // RECENSEMENT des tampons WebGPU de la page (injecté AVANT ses scripts) : nombre, total créé, plus gros tampon, pic de tampons VIVANTS, limites du périphérique obtenu.
            await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { if (typeof GPUDevice === 'undefined') return;
                const S = window.__gpu = { n: 0, totalMo: 0, maxMo: 0, vivantsMo: 0, picVivantsMo: 0, plusGros: [], limites: null, peripheriques: 0 }; const taille = new WeakMap(), Mo = 1048576;
                const cb = GPUDevice.prototype.createBuffer; GPUDevice.prototype.createBuffer = function (d) { const b = cb.call(this, d); S.n++; S.totalMo += d.size / Mo; S.maxMo = Math.max(S.maxMo, d.size / Mo); S.vivantsMo += d.size / Mo; S.picVivantsMo = Math.max(S.picVivantsMo, S.vivantsMo); taille.set(b, d.size);
                    S.plusGros.push(d.size); if (S.plusGros.length > 400) { S.plusGros.sort((x, y) => y - x); S.plusGros.length = 5; } return b; };
                const dd = GPUBuffer.prototype.destroy; GPUBuffer.prototype.destroy = function () { const s = taille.get(this); if (s) { S.vivantsMo -= s / Mo; taille.delete(this); } return dd.call(this); };
                const rd = GPUAdapter.prototype.requestDevice; GPUAdapter.prototype.requestDevice = async function (d) { const dev = await rd.call(this, d); S.peripheriques++; S.limites = { maxBufferSize: dev.limits.maxBufferSize, maxStorageBufferBindingSize: dev.limits.maxStorageBufferBindingSize, demande: d && d.requiredLimits ? JSON.stringify(d.requiredLimits).slice(0, 300) : null }; return dev; };
            })();` });
        }
        if (arg('sonde-wasm', '') === '1') {
            // la TAILLE de chaque mémoire linéaire WebAssembly créée par la page (une par instance d'ORT : WASM, puis WebGPU/asyncify) : elle ne rétrécit jamais, même session libérée
            await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const M = WebAssembly.Memory, liste = []; WebAssembly.Memory = function (d) { const m = new M(d); liste.push(m); return m; }; WebAssembly.Memory.prototype = M.prototype; window.__tas = () => liste.map(m => Math.round(m.buffer.byteLength / 1048576)); })();` });
        }
        const q = [ISO === '0' ? 'iso=0' : '', QUERY].filter(Boolean).join('&');
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/api/banc/telephone${q ? '?' + q : ''}` });
        for (let i = 0; i < 60; i++) { await attente(500); if (await evalue('Boolean(window.__banc)')) break; }
        console.log('page ouverte :', await evalue('JSON.stringify({isole: self.crossOriginIsolated, nav: navigator.userAgent, gpu: typeof navigator.gpu, coeurs: navigator.hardwareConcurrency})'));
        const procs = (await nav.c('SystemInfo.getProcessInfo')).result.processInfo; const pids = procs.map(p => p.id);
        const ecranAvant = JSON.parse(await evalue(`JSON.stringify({ btnGpuDesactive: document.getElementById('btnGpu').disabled, btnGpuTexte: document.getElementById('btnGpu').textContent, avis: document.getElementById('avisMoteur').textContent, ios: [...document.querySelectorAll('#appareil tr')].filter(r => /iOS|WebGPU propos|options de session/.test(r.children[0].textContent)).map(r => r.children[0].textContent + ' = ' + r.children[1].textContent) })`));
        console.log('écran avant mesure :', JSON.stringify(ecranAvant));
        console.log('processus Chrome :', JSON.stringify(procs.map(p => ({ type: p.type, id: p.id }))));
        // l'échantillonneur : Start-Process caché, arguments en chaîne littérale (règle des sous-agents)
        const ps1 = path.join(__dirname, 'echantillonneur-memoire.ps1');
        echant = cp.spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Pids', pids.join(','), '-Sortie', fichierMem, '-Stop', stop, '-Max', '1500'], { stdio: 'ignore', windowsHide: true });
        await attente(1500);
        const phases = [];
        const marque = nom => phases.push({ nom, t: Date.now() });
        marque('debut');
        const tasWasm = [];
        for (const m of (MOTEUR === 'tous' ? ['wasm', 'webgpu'] : [MOTEUR])) {
            marque(`${m}-debut`); await evalue(`window.__banc.lancer(${JSON.stringify(m)})`, true); marque(`${m}-fin`); await attente(1500);
            if (arg('sonde-wasm', '') === '1') tasWasm.push({ apres: m, memoiresLineairesMo: JSON.parse(await evalue('JSON.stringify(window.__tas ? window.__tas() : null)')) });
        }
        marque('repos');
        const ecran = JSON.parse(await evalue(`JSON.stringify({ mot: document.getElementById('verdictMot').textContent, detail: document.getElementById('verdictDetail').textContent, l1: document.getElementById('ligne1').textContent, l2: document.getElementById('ligne2').textContent, envoi: document.getElementById('envoi').textContent, journal: document.getElementById('journal').textContent })`));
        console.log(JSON.stringify(ecran, null, 1));
        if (VECS) {
            const b64 = await evalue(`(() => { const v = window.__banc.E.vecWasm; if (!v) return ''; const t = new Float32Array(v.length * 256); v.forEach((x, i) => t.set(x, i * 256)); let s = ''; const u = new Uint8Array(t.buffer); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); })()`);
            fs.writeFileSync(VECS, Buffer.from(b64, 'base64')); console.log(`empreintes WASM écrites : ${VECS} (${Buffer.from(b64, 'base64').length} octets)`);
        }
        fs.writeFileSync(stop, '1');
        for (let i = 0; i < 100; i++) { await attente(200); try { if (/^P;/m.test(fs.readFileSync(fichierMem, 'utf8'))) break; } catch { /* fichier pas encore là */ } }     // l'échantillonneur écrit les pics exacts en sortant
        const brutMem = fs.readFileSync(fichierMem, 'utf8').trim().split('\n');
        const lignes = brutMem.filter(l => !l.startsWith('P;')).map(l => l.split(';').map(Number)).filter(l => l.length === 4 && Number.isFinite(l[2]));
        const type = Object.fromEntries(procs.map(p => [p.id, p.type]));
        // les pics EXACTS du système (PeakWorkingSet64, PeakPagefileUsage) : par type de processus, le plus gros
        const picsSysteme = {}; for (const l of brutMem.filter(x => x.startsWith('P;'))) { const [, pid, ws, pf] = l.split(';').map((x, i) => (i ? Number(x) : x)); const t = type[pid] || '?'; const o = picsSysteme[t] || (picsSysteme[t] = { workingSetMo: 0, memoirePriveeMo: 0 }); o.workingSetMo = Math.max(o.workingSetMo, Math.round(ws / 1048576)); o.memoirePriveeMo = Math.max(o.memoirePriveeMo, Math.round(pf / 1048576)); }
        const maxPhase = (a, b) => { // maximum, sur la fenêtre [a,b], de la mémoire privée par type de processus et de la somme à un même instant
            const parT = {}; const parInstant = {};
            for (const [t, pid, priv] of lignes) { if (t < a || t > b) continue; parT[type[pid]] = Math.max(parT[type[pid]] || 0, priv); parInstant[t] = (parInstant[t] || 0) + priv; }
            return { maxParType: Object.fromEntries(Object.entries(parT).map(([k, v]) => [k, Math.round(v / 1048576)])), maxSommeMo: Math.round(Math.max(0, ...Object.values(parInstant)) / 1048576) };
        };
        const resume = { etiquette: ETIQ, moteur: MOTEUR, query: QUERY, echantillons: lignes.length, picsSysteme, phases: {} };
        const debutRef = phases.find(p => p.nom === 'debut').t;
        resume.avantMo = Math.round(lignes.filter(l => l[0] <= debutRef).reduce((s, l) => Math.max(s, l[2]), 0) / 1048576);
        for (let i = 1; i < phases.length; i++) if (/-debut$/.test(phases[i].nom)) { const nom = phases[i].nom.replace(/-debut$/, ''); resume.phases[nom] = maxPhase(phases[i].t, phases[i + 1].t); }
        // le pic du processus de rendu (le plus gros) PAR ÉTAPE de la page (E.etapes : [[date, nom]…]) : dit à quelle étape la mémoire monte
        const etapes = JSON.parse(await evalue('JSON.stringify(window.__banc.E.etapes || [])'));        // [] pour l\'ancienne page (avant le lot iOS : elle n\'a pas ce journal)
        resume.etapes = [];
        for (let i = 0; i < etapes.length; i++) {
            const a = etapes[i][0], b = i + 1 < etapes.length ? etapes[i + 1][0] : Date.now();
            let mx = 0, gpu = 0; for (const [t, pid, priv] of lignes) { if (t < a || t > b) continue; if (type[pid] === 'renderer') mx = Math.max(mx, priv); if (type[pid] === 'GPU') gpu = Math.max(gpu, priv); }
            if (/carte|modele-seul/.test(etapes[i][1]) && resume.etapes.length && /carte|modele-seul/.test(resume.etapes[resume.etapes.length - 1].etape)) { const d = resume.etapes[resume.etapes.length - 1]; d.rendererMo = Math.max(d.rendererMo, Math.round(mx / 1048576)); d.gpuMo = Math.max(d.gpuMo, Math.round(gpu / 1048576)); continue; }
            resume.etapes.push({ etape: /carte|modele-seul/.test(etapes[i][1]) ? 'mesures (cartes)' : etapes[i][1], rendererMo: Math.round(mx / 1048576), gpuMo: Math.round(gpu / 1048576), dureeMs: b - a });
        }
        // la SÉRIE complète (un point par instant échantillonné : plus gros processus de rendu, processus GPU, étape en cours) pour lire OÙ monte la mémoire
        const SERIE = arg('serie', '');
        if (SERIE) {
            const instants = [...new Set(lignes.map(l => l[0]))].sort((x, y) => x - y), t0s = instants[0];
            const sortieSerie = ['t_ms;renduPriveMo;renduResidentMo;gpuPriveMo;etape'];
            for (const t of instants) {
                let r = 0, rw = 0, g = 0; for (const [tt, pid, priv, ws] of lignes) if (tt === t) { if (type[pid] === 'renderer') { r = Math.max(r, priv); rw = Math.max(rw, ws); } if (type[pid] === 'GPU') g = Math.max(g, priv); }
                let e = ''; for (const [te, nom] of etapes) if (te <= t) e = nom;
                sortieSerie.push(`${t - t0s};${Math.round(r / 1048576)};${Math.round(rw / 1048576)};${Math.round(g / 1048576)};${e}`);
            }
            fs.writeFileSync(SERIE, sortieSerie.join('\n'));
        }
        if (tasWasm.length) resume.memoiresLineaires = tasWasm;
        if (arg('sonde-gpu', '') === '1') { const g =JSON.parse(await evalue('JSON.stringify(window.__gpu || null)')); if (g) { g.plusGros = g.plusGros.sort((x, y) => y - x).slice(0, 5).map(x => Math.round(x / 1048576 * 100) / 100); for (const k of ['totalMo', 'maxMo', 'vivantsMo', 'picVivantsMo']) g[k] = Math.round(g[k] * 100) / 100; } resume.tamponsGpu = g; }
        resume.mesures = deposes.map(d => d.refuse ? d : { moteur: d.mesure.moteur, verdict: d.mesure.verdict, cosMin: d.mesure.cosMin, cosMinModeleSeul: d.mesure.cosMinModeleSeul, medianeMs: d.mesure.medianeMs, creationSessionMs: d.mesure.creationSessionMs, jsHeapApresCreationMo: d.mesure.jsHeapApresCreationMo, jsHeapFinMo: d.mesure.jsHeapFinMo, uaApresCreationMo: d.mesure.uaApresCreationMo, uaFinMo: d.mesure.uaFinMo, erreur: d.mesure.erreur, moteurDemande: d.mesure.moteurDemande, webgpuDesactive: d.mesure.webgpuDesactive, webgpuForce: d.mesure.webgpuForce, optionsSession: d.mesure.optionsSession, diagnostic: d.mesure.diagnosticPixels });
        resume.ecranAvant = ecranAvant;
        console.log(JSON.stringify(resume, null, 1));
        if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ resume, ecran }, null, 1));
        if (!deposes.length || deposes.some(d => d.refuse)) sortie = 2;
        ws.close(); nav.w.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); sortie = 1; }
    try { fs.writeFileSync(stop, '1'); } catch { /* profil déjà retiré */ }
    try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* déjà arrêté */ }
    if (echant) { await attente(800); try { cp.execFileSync('taskkill.exe', ['/PID', String(echant.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* déjà arrêté */ } }
    srv.close();
    setTimeout(() => { try { for (const f of fs.readdirSync(profil)) fs.rmSync(path.join(profil, f), { recursive: true, force: true }); fs.rmdirSync(profil); } catch { /* profil jetable */ } try { fs.unlinkSync(fichierMem); } catch { /* jetable */ } process.exit(sortie); }, 1500);
})();
