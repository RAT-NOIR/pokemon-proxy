'use strict';
// Pilote de MESURE du « premier scan » de la page de banc téléphone (Chrome headless, profil nommé, CDP) : mêmes routes que la page, faux GET /api/modele-empreinte (servi depuis le disque, débit limitable), faux dépôt.
// CE N'EST PAS UN iPHONE : Chrome de bureau, CPU ralentie sur le fil principal seulement (Emulation.setCPUThrottlingRate ne touche pas les fils WASM), réseau local limité par --debit.
//   node outils\banc-telephone\pilote-premier-scan.js --etiquette=x [--dossier=banc-telephone] [--cpu=4] [--debit=27] [--profil=<dir>] [--scans=3] [--override={json}] [--query=...] [--ua=iphone]
//        [--modele=<fichier.onnx>] [--vecs=<fichier.bin>] [--json=<fichier.json>] [--attente-pret=1]
// --dossier : un dossier frère de v2/banc-telephone (copie de l'état d'AVANT, pour mesurer avant et après dans les MÊMES conditions).
// --profil  : dossier de profil Chrome CONSERVÉ (le cache y reste) : deux lancements successifs sur le même profil = « à froid » puis « au retour ». Sans lui : profil jetable.
// --override : options de session WASM ajoutées à celles de la page (E.session.options) — pour les expériences seulement.
// Aucun réseau externe ; arrêt de Chrome par PID.
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os'), crypto = require('crypto');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ETIQ = arg('etiquette', 'mesure'), DOSSIER = arg('dossier', 'banc-telephone'), CPU = Number(arg('cpu', '1')), DEBIT = Number(arg('debit', '0')), PROFIL = arg('profil', ''), SCANS = Number(arg('scans', '2')),
    OVERRIDE = arg('override', ''), QUERY = arg('query', ''), VECS = arg('vecs', ''), JSON_OUT = arg('json', ''), UA = arg('ua', ''), DELAI = Number(arg('delai', '600'));
const MODELE = arg('modele', 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx');
const racine = path.join(__dirname, '..', '..', 'v2', DOSSIER);
const express = require('express');
const routes = require(path.join(racine, 'routes'));
const S = require(path.join(racine, 'stockage'));
const lot = JSON.parse(fs.readFileSync(path.join(racine, 'public', 'lot.json'), 'utf8'));
const shaModele = crypto.createHash('sha256').update(fs.readFileSync(MODELE)).digest('hex');
const cfg = { modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: shaModele, octets: fs.statSync(MODELE).size } };
const deposes = [];
const app = express(); app.use(require(path.join(racine, 'corps')).analyseur()); app.use(express.json());
// --debit-api / --debit-modele (Mo/s) : le débit de CHAQUE hôte, côté serveur, sur les octets réellement envoyés (compressés ou non). Le modèle vient de R2 (rapide) et le reste de l'API (Render, mesuré ~1 Mo/s sur iPhone) :
// deux hôtes, deux débits ; Network.emulateNetworkConditions (--debit) ne sait donner qu'un débit unique, partagé.
const limiter = (res, Mo) => {
    const octetsParS = Mo * 1048576, ow = res.write.bind(res), oe = res.end.bind(res); let chaine = Promise.resolve(), prochain = Date.now();
    const envoyer = async c => { const b = Buffer.isBuffer(c) ? c : Buffer.from(c); const tranche = Math.max(65536, Math.round(octetsParS / 20)); for (let i = 0; i < b.length; i += tranche) { const s = b.subarray(i, i + tranche); ow(s); prochain = Math.max(prochain, Date.now()) + (s.length / octetsParS) * 1000; const attente = prochain - Date.now(); if (attente > 30) await new Promise(r => setTimeout(r, attente)); } };   // un seau de jetons : la résolution du minuteur (15 ms sous Windows) ne fait pas perdre de débit
    res.write = (c, ...r) => { if (c) chaine = chaine.then(() => envoyer(c)); const cb = r.find(x => typeof x === 'function'); if (cb) cb(); return true; };
    res.end = (c, ...r) => { chaine = chaine.then(async () => { if (c && typeof c !== 'function') await envoyer(c); oe(); }); return res; };
};
const DEBIT_API = Number(arg('debit-api', '0')), DEBIT_MODELE = Number(arg('debit-modele', '0'));
app.use((req, res, next) => { const Mo = req.path.startsWith('/api/modele-empreinte/') ? DEBIT_MODELE : req.path.startsWith('/api/banc/telephone/') && req.method === 'GET' ? DEBIT_API : 0; if (Mo > 0) limiter(res, Mo); next(); });
// un autre modèle que celui du lot : le lot est réécrit à la volée avec le sha du modèle servi (expérience seulement ; l'égalité au bit se juge ensuite contre les empreintes de référence)
if (shaModele !== lot.modeleSha256) app.get('/api/banc/telephone/lot.json', (req, res) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.send(JSON.stringify({ ...lot, modeleSha256: shaModele })); });
app.get(`/api/modele-empreinte/${shaModele}`, (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(fs.statSync(MODELE).size));
    res.setHeader('Access-Control-Allow-Origin', '*');
    fs.createReadStream(MODELE).pipe(res);
});
app.post('/api/banc/telephone/resultat', (req, res) => { const v = S.valider(req.body); if (!v.ok) { deposes.push({ refuse: v.detail }); return res.status(400).json({ success: false, detail: v.detail }); } deposes.push(v.doc); res.status(201).json({ success: true, id: 'local' }); });
const router = express.Router(); routes.monter(router, cfg, { envBancTelephone: { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai' } }); app.use(router);
const srv = http.createServer(app);
const attente = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    // --port : un port FIXE (le cache d'un navigateur est rangé par ORIGINE : « au retour » sur le même profil exige la même origine) ; sans lui, un port libre au hasard
    await new Promise(r => srv.listen(Number(arg('port', '0')), '127.0.0.1', r));
    const port = srv.address().port, dbg = 19500 + Math.floor(Math.random() * 90);
    const profil = PROFIL || fs.mkdtempSync(path.join(os.tmpdir(), 'rm-banc-ps-'));
    fs.mkdirSync(profil, { recursive: true });
    const chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
    let sortie = 0;
    try {
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const w = new WebSocket(cible.webSocketDebuggerUrl); await new Promise((r, k) => { w.onopen = r; w.onerror = k; });
        let n = 0; const cdp = (method, params = {}) => new Promise(r => { const i = ++n; const h = ev => { const d = JSON.parse(ev.data); if (d.id === i) { w.removeEventListener('message', h); r(d); } }; w.addEventListener('message', h); w.send(JSON.stringify({ id: i, method, params })); });
        const evalue = async (expression, attendre = false) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: attendre, returnByValue: true, timeout: DELAI * 1000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
        await cdp('Page.enable'); await cdp('Runtime.enable');
        if (UA === 'iphone') await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
        if (CPU > 1) await cdp('Emulation.setCPUThrottlingRate', { rate: CPU });
        if (DEBIT > 0) { await cdp('Network.enable'); await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: Math.round(DEBIT * 1048576), uploadThroughput: -1 }); }
        const tNav = Date.now();
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/api/banc/telephone${QUERY ? '?' + QUERY : ''}` });
        for (let i = 0; i < 120; i++) { await attente(250); if (await evalue('Boolean(window.__banc)')) break; }
        const tPageOuverte = Date.now() - tNav;
        if (OVERRIDE) await evalue(`Object.assign(window.__banc.E.session.options, ${OVERRIDE})`);   // avant le clic : la page ancienne ne crée sa session qu'au clic
        const info = JSON.parse(await evalue('JSON.stringify({isole: self.crossOriginIsolated, nav: navigator.userAgent, coeurs: navigator.hardwareConcurrency})'));
        // la page NOUVELLE prépare seule : on attend son « prêt » (honnêtement mesuré par elle) ; l'ancienne n'a pas E.prep : on lance tout de suite
        let attendPret = 0, aPrep = await evalue('Boolean(window.__banc.E && window.__banc.E.prep)');
        let prep = null;
        if (aPrep && arg('attente-pret', '1') === '1') {
            for (let i = 0; i < DELAI * 4; i++) { const p = JSON.parse(await evalue('JSON.stringify(window.__banc.E.prep)')); if (p && (p.etat === 'pret' || p.etat === 'echec' || p.etat === 'abandon')) { prep = p; break; } await attente(250); }
            attendPret = Date.now() - tNav;
        }
        // --eval-fichier=<js> : évalue ce fichier dans la page (expression asynchrone) et imprime le résultat ; --sans-clic=1 : s'arrête là (diagnostic)
        const EVAL = arg('eval-fichier', '');
        if (EVAL) { console.log('EVAL', JSON.stringify(await evalue(fs.readFileSync(EVAL, 'utf8'), true))); }
        if (arg('sans-clic', '') === '1') { try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* déjà arrêté */ } srv.close(); setTimeout(() => process.exit(0), 500); return; }
        // le premier clic, puis des scans de plus (même page, session déjà prête)
        // --sans-diagnostic=1 : la page saute le diagnostic des pixels et le test d'orientation (≈ 40 s de CPU, étrangers au scan) ; la mesure du scan, elle, ne change pas
        if (arg('sans-diagnostic', '') === '1') await evalue('(window.__banc.E.diagnostic = null, window.__banc.E.orientation = null, true)');
        const t1 = Date.now();
        await evalue('window.__banc.lancer("wasm")', true);
        const clic1Ms = Date.now() - t1;
        const mesures = deposes.filter(d => !d.refuse);
        const scans = [];
        for (let k = 0; k < SCANS; k++) { const t = Date.now(); await evalue('window.__banc.lancer("wasm")', true); scans.push(Date.now() - t); }
        const prepFin = aPrep ? JSON.parse(await evalue('JSON.stringify(window.__banc.E.prep)')) : null;
        const ecran = JSON.parse(await evalue(`JSON.stringify({ mot: document.getElementById('verdictMot').textContent, detail: document.getElementById('verdictDetail').textContent, l1: document.getElementById('ligne1').textContent, journal: document.getElementById('journal').textContent })`));
        if (VECS) {
            const b64 = await evalue(`(() => { const v = window.__banc.E.vecWasm; if (!v) return ''; const t = new Float32Array(v.length * 256); v.forEach((x, i) => t.set(x, i * 256)); let s = ''; const u = new Uint8Array(t.buffer); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); })()`);
            fs.writeFileSync(VECS, Buffer.from(b64, 'base64'));
        }
        const d1 = mesures[0] || null;
        const resume = { etiquette: ETIQ, dossier: DOSSIER, cpu: CPU, debitMoS: DEBIT || null, profilConserve: Boolean(PROFIL), ua: UA || 'chrome-bureau', info, override: OVERRIDE || null, tPageOuverteMs: tPageOuverte, tOuvertureAPretMs: aPrep ? attendPret : null, clic1Ms, scansSuivantsMs: scans,
            prep: prepFin, prepAvantClic: prep, depot1: d1 && d1.mesure ? { moteur: d1.mesure.moteur, verdict: d1.mesure.verdict, cosMin: d1.mesure.cosMin, filsDemandes: d1.mesure.filsDemandes, fils: d1.mesure.fils, creationSessionMs: d1.mesure.creationSessionMs, premiereMs: d1.mesure.premiereMs, medianeMs: d1.mesure.medianeMs, pretraitementMedianeMs: d1.mesure.pretraitementMedianeMs, premier: d1.mesure.premierScan || null, suite: d1.mesure.scansSuivants || null, entree: d1.mesure.entree && { chemin: d1.mesure.entree.chemin }, erreur: d1.mesure.erreur } : null,
            telechargementMs: d1 ? d1.telechargementMs : null, verifShaMs: d1 ? d1.verifShaMs : null, deposRefuses: deposes.filter(d => d.refuse), ecran: { mot: ecran.mot, detail: ecran.detail, l1: ecran.l1 } };
        console.log(JSON.stringify(resume, null, 1));
        if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ resume, journal: ecran.journal, depots: deposes.filter(d => !d.refuse).map(d => d.mesure) }, null, 1));
        if (!mesures.length) sortie = 2;
        // une fermeture NORMALE de la page (pagehide : le marqueur de préparation devient « ferme ») ; un Chrome tué en pleine page laisserait « pret » et la garde refuserait la préparation seule au retour, à raison
        await cdp('Page.navigate', { url: 'about:blank' }); await attente(7000);      // le localStorage de Chrome n'est écrit sur le disque que par lots (~5 s) : un Chrome tué avant perdrait « ferme »
        w.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); sortie = 1; }
    try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* déjà arrêté */ }
    srv.close();
    setTimeout(() => { if (!PROFIL) { try { for (const f of fs.readdirSync(profil)) fs.rmSync(path.join(profil, f), { recursive: true, force: true }); fs.rmdirSync(profil); } catch { /* profil jetable */ } } process.exit(sortie); }, 1500);
})();
