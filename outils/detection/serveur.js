'use strict';
// Serveur LOCAL (127.0.0.1) des pages de mesure de la detection deterministe. Aucun reseau externe, aucun secret.
//   node serveur.js <port> <dossier-sortie> <manifeste.json> [modele.onnx]
// Sert : /p/<page>.html|.mjs (outils/detection/pages), /m/<fichier> (les modules de v2/banc-telephone/public : decodeur*.mjs, detection*.mjs, ort/…),
//        /opencv.js et /opencv_js.wasm (copie de l'extension, lecture seule), /photo/<id> (le manifeste id -> fichier), /modele.onnx, /liste.json.
// Recoit : POST /bin/<nom> (octets bruts -> <dossier-sortie>/<nom>), POST /resultat (JSON -> <dossier-sortie>/resultat.json), GET /log?m=…
const http = require('http'), fs = require('fs'), path = require('path');
const [port, sortie, fManifeste, modele] = [Number(process.argv[2]), process.argv[3], process.argv[4], process.argv[5]];
const RACINE = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(RACINE, 'v2', 'banc-telephone', 'public');
const PAGES = path.join(__dirname, 'pages');
const OPENCV = process.env.OPENCV_DIR || path.join(PUBLIC, 'opencv');   // copie de celui de l'extension (sha256 identiques)
const manifeste = fManifeste && fManifeste !== '-' ? JSON.parse(fs.readFileSync(fManifeste, 'utf8')) : {};
const liste = Object.keys(manifeste).sort();
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html; charset=utf-8', '.onnx': 'application/octet-stream', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
const ISOLE = { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin' };
fs.mkdirSync(sortie, { recursive: true });
const fichier = (res, p) => {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Content-Length': fs.statSync(p).size, ...ISOLE });
  fs.createReadStream(p).pipe(res);
};
const sur = (nom) => /^[\w.\-]{1,80}$/.test(nom) && !nom.includes('..');
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  let m;
  if (req.method === 'POST' && (m = u.pathname.match(/^\/bin\/([\w.\-]{1,80})$/))) {
    const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => { fs.writeFileSync(path.join(sortie, m[1]), Buffer.concat(b)); res.writeHead(200, ISOLE); res.end('ok'); });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/resultat') {
    const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => { fs.writeFileSync(path.join(sortie, 'resultat.json'), Buffer.concat(b)); res.writeHead(200, ISOLE); res.end('ok'); });
    return;
  }
  if (u.pathname === '/log') { console.log('page:', u.searchParams.get('m')); res.writeHead(200, ISOLE); return res.end(); }
  if ((m = u.pathname.match(/^\/p\/([\w.\-]+)$/)) && sur(m[1])) return fichier(res, path.join(PAGES, m[1]));
  if ((m = u.pathname.match(/^\/m\/([\w.\-\/]+)$/)) && !m[1].includes('..')) return fichier(res, path.join(PUBLIC, m[1]));
  if (u.pathname === '/opencv.js') return fichier(res, path.join(OPENCV, 'opencv.js'));
  if (u.pathname === '/opencv_js.wasm') return fichier(res, path.join(OPENCV, 'opencv_js.wasm'));
  if (u.pathname === '/modele.onnx' && modele) return fichier(res, modele);
  if (u.pathname === '/liste.json') { res.writeHead(200, { 'Content-Type': 'application/json', ...ISOLE }); return res.end(JSON.stringify(liste)); }
  if ((m = u.pathname.match(/^\/photo\/([\w\-]{1,40})$/)) && manifeste[m[1]]) return fichier(res, manifeste[m[1]]);
  res.writeHead(404, ISOLE); res.end();
});
srv.listen(port, '127.0.0.1', () => console.log('ecoute', port));
