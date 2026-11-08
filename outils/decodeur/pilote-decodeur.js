'use strict';
// Pilote LOCAL de la preuve du décodeur : un serveur 127.0.0.1 en node pur (aucun paquet), des fichiers en LISTE FERMÉE (ceux de v2/banc-telephone/public), le modèle local, puis Chrome headless (profil neuf, CDP)
// qui ouvre outils/decodeur/preuve-page.js et rend les empreintes des deux chaînes. En parallèle, node décode les 30 mêmes JPEG avec le MÊME décodeur : les empreintes doivent être égales à celles de Chrome.
//   node outils\decodeur\pilote-decodeur.js [--modele=<fichier.onnx>] [--sortie=<fichier.json>]
// Aucun réseau externe, aucune base. Arrêt de Chrome par PID.
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const MODELE = arg('modele', 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx');
const SORTIE = arg('sortie', '');
const PUB = path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public');
const JS = 'text/javascript; charset=utf-8';
const FICHIERS = { '/pub/empreinte.js': ['empreinte.js', JS], '/pub/moteur-ort.js': ['moteur-ort.js', JS], '/pub/decodeur.mjs': ['decodeur.mjs', JS], '/pub/decodeur-jpeg.mjs': ['decodeur-jpeg.mjs', JS], '/pub/decodeur-png.mjs': ['decodeur-png.mjs', JS],
    '/pub/decodeur-webp.mjs': ['decodeur-webp.mjs', JS], '/pub/decodeur-webp-tables.mjs': ['decodeur-webp-tables.mjs', JS], '/pub/lot.json': ['lot.json', 'application/json'],
    '/pub/ort/ort.wasm.bundle.min.mjs': ['ort/ort.wasm.bundle.min.mjs', JS], '/pub/ort/ort-wasm-simd-threaded.wasm': ['ort/ort-wasm-simd-threaded.wasm', 'application/wasm'] };
const ISO = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    for (const [k, v] of Object.entries(ISO)) res.setHeader(k, v);
    if (u === '/preuve') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end('<!doctype html><meta charset="utf-8"><title>preuve</title><script type="module" src="/preuve.js"></script>'); }
    if (u === '/preuve.js') { res.setHeader('Content-Type', JS); return fs.createReadStream(path.join(__dirname, 'preuve-page.js')).pipe(res); }
    if (u === '/fx') { res.setHeader('Content-Type', 'application/json'); return fs.createReadStream(path.join(__dirname, '..', '..', 'v2', 'test', 'fixtures-decodeur', 'pil-synthetique.json')).pipe(res); }
    if (u === '/modele') { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(fs.statSync(MODELE).size)); return fs.createReadStream(MODELE).pipe(res); }
    const f = FICHIERS[u];
    if (f) { res.setHeader('Content-Type', f[1]); return fs.createReadStream(path.join(PUB, f[0])).pipe(res); }
    res.statusCode = 404; res.end();
});
const attente = ms => new Promise(r => setTimeout(r, ms));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port, dbg = 19500 + Math.floor(Math.random() * 90);
    const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-decodeur-'));
    const chrome = cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`, '--disable-extensions', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
    let sortie = 0;
    try {
        let cible = null;
        for (let i = 0; i < 60 && !cible; i++) { await attente(500); try { cible = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page'); } catch { /* pas encore */ } }
        if (!cible) throw new Error('pas de cible CDP');
        const ws = new WebSocket(cible.webSocketDebuggerUrl); await new Promise((r, k) => { ws.onopen = r; ws.onerror = k; });
        let id = 0; const cdp = (method, params = {}) => new Promise(r => { const n = ++id; const h = ev => { const d = JSON.parse(ev.data); if (d.id === n) { ws.removeEventListener('message', h); r(d); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: n, method, params })); });
        const evalue = async (expression, attendre = false) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: attendre, returnByValue: true, timeout: 900000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result && r.result.result && r.result.result.value; };
        await cdp('Page.enable'); await cdp('Runtime.enable');
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/preuve` });
        for (let i = 0; i < 60; i++) { await attente(500); if (await evalue('Boolean(window.__pret)')) break; }
        const chromeRes = JSON.parse(await evalue('window.__preuve().then(r => JSON.stringify(r))', true));
        const exif = JSON.parse(await evalue('window.__exif().then(r => JSON.stringify(r))', true));
        console.log('EXIF et décodage du navigateur sur les cas synthétiques de Pillow :', JSON.stringify(exif));
        // node : le même décodeur, les mêmes 30 JPEG
        const D = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href), E = await import(pathToFileURL(path.join(PUB, 'empreinte.js')).href);
        const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
        let nodeEgalChrome = 0, tenseursIdentiques = 0, rgbIdentiques = 0, vecteursIdentiques = 0, pilEgal = 0, pilN = 0, navEgalPil = 0, minCosRef = 1, minCosNav = 1, minCosDecNav = 1;
        for (const c of chromeRes.cartes) {
            const carte = lot.cartes.find(x => x.id === c.id), r = D.decoder(Buffer.from(carte.jpg, 'base64'), { orientation: 'aucune' });
            const t = E.versTenseur(r.rgb, r.largeur, r.hauteur);
            if (sha(r.rgb) === c.rgbDecodeur && sha(Buffer.from(t.buffer)) === c.tenseurDecodeur) nodeEgalChrome++;
            if (c.tenseursIdentiques) tenseursIdentiques++;
            if (c.octetsRgbDifferents === 0) rgbIdentiques++;
            if (c.vecteurDecodeur === c.vecteurNavigateur) vecteursIdentiques++;
            if (c.tenseurDecodeurEgalPil !== undefined) { pilN++; if (c.tenseurDecodeurEgalPil) pilEgal++; if (c.tenseurNavigateurEgalPil) navEgalPil++; }
            minCosRef = Math.min(minCosRef, c.cosDecodeurRef); minCosNav = Math.min(minCosNav, c.cosNavigateurRef); minCosDecNav = Math.min(minCosDecNav, c.cosDecodeurNavigateur);
        }
        const bilan = { ua: chromeRes.ua, isole: chromeRes.isole, fils: chromeRes.fils, dureeMs: chromeRes.dureeMs, msDecodeurParCarte: chromeRes.msDecodeurMedianeCarte, msNavigateurParCarte: chromeRes.msNavigateurMedianeCarte, cartes: chromeRes.cartes.length,
            nodeEgalChrome_rgb_et_tenseur: nodeEgalChrome, rgbNavigateurEgalDecodeur: rgbIdentiques, tenseursNavigateurEgalDecodeur: tenseursIdentiques, vecteursNavigateurEgalDecodeur: vecteursIdentiques,
            modeleSeul: { cartes: pilN, tenseurDecodeurEgalPil: pilEgal, tenseurNavigateurEgalPil: navEgalPil }, cosMinDecodeurContreRefNative: minCosRef, cosMinNavigateurContreRefNative: minCosNav, cosMinDecodeurContreNavigateur: minCosDecNav };
        console.log(JSON.stringify(bilan, null, 1));
        if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify({ bilan, chrome: chromeRes }, null, 1));
        if (nodeEgalChrome !== chromeRes.cartes.length) sortie = 3;
        ws.close();
    } catch (e) { console.log('ERREUR pilote', e.stack); sortie = 1; }
    try { cp.execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* deja arrete */ }
    srv.close();
    setTimeout(() => { try { for (const f of fs.readdirSync(profil)) fs.rmSync(path.join(profil, f), { recursive: true, force: true }); fs.rmdirSync(profil); } catch { /* profil jetable */ } process.exit(sortie); }, 1500);
})();
