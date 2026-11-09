'use strict';
// BANC-TELEPHONE — les routes. Montées SEULEMENT si garde.lire() est actif (essai, drapeau) : sinon elles n'existent pas, 404 natif pour tous.
//   GET  /api/banc/telephone                 la page (HTML, CSP stricte, isolement COOP/COEP sauf ?iso=0)
//   GET  /api/banc/telephone/<fichier>       ses fichiers, UNE LISTE FERMÉE (jamais un chemin lu dans la requête) : app.js, app.css, empreinte.js, moteur-ort.js, lot.json, ort/…
//   POST /api/banc/telephone/resultat        le dépôt d'une mesure (JSON ≤ 8 Ko, liste fermée de champs, par IP et par heure, 200 documents au plus)
// Le modèle n'est PAS servi ici : la page le télécharge par GET /api/modele-empreinte/<sha256> (302 vers R2), comme l'extension. Aucun prix, aucun compte, aucun secret.
const fs = require('fs');
const path = require('path');
const { repondreErreur } = require('../erreurs');
const L = require('../transport/limites');
const { ipKeyGenerator } = require('express-rate-limit');
const G = require('./garde');
const S = require('./stockage');

const PUBLIC = path.join(__dirname, 'public');
const JS = 'text/javascript; charset=utf-8';
// chemin servi → { fichier, type }. Les noms sont ceux du disque ; aucune partie de l'URL n'entre dans un chemin de fichier.
const FICHIERS = Object.freeze({
    '/api/banc/telephone/app.js': { f: 'app.js', t: JS },
    '/api/banc/telephone/app.css': { f: 'app.css', t: 'text/css; charset=utf-8' },
    '/api/banc/telephone/empreinte.js': { f: 'empreinte.js', t: JS },
    '/api/banc/telephone/moteur-ort.js': { f: 'moteur-ort.js', t: JS },
    '/api/banc/telephone/verdict.mjs': { f: 'verdict.mjs', t: JS },
    '/api/banc/telephone/lot.json': { f: 'lot.json', t: 'application/json; charset=utf-8' },
    // le décodeur d'images Rat-Market (JavaScript pur, aucun .wasm : donc aucune règle CSP de plus que « self »)
    '/api/banc/telephone/decodeur.mjs': { f: 'decodeur.mjs', t: JS },
    '/api/banc/telephone/decodeur-jpeg.mjs': { f: 'decodeur-jpeg.mjs', t: JS },
    '/api/banc/telephone/decodeur-png.mjs': { f: 'decodeur-png.mjs', t: JS },
    '/api/banc/telephone/decodeur-webp.mjs': { f: 'decodeur-webp.mjs', t: JS },
    '/api/banc/telephone/decodeur-webp-tables.mjs': { f: 'decodeur-webp-tables.mjs', t: JS },
    // la detection deterministe (detection.mjs : JavaScript pur + OpenCV.js de l'extension, sa licence Apache-2.0) et son test (page, lot compose de visuels publics sur fonds synthetiques)
    '/api/banc/telephone/detection.mjs': { f: 'detection.mjs', t: JS },
    '/api/banc/telephone/detection-page.mjs': { f: 'detection-page.mjs', t: JS },
    '/api/banc/telephone/grandes-page.mjs': { f: 'grandes-page.mjs', t: JS },
    '/api/banc/telephone/lot-detection.json': { f: 'lot-detection.json', t: 'application/json; charset=utf-8' },
    '/api/banc/telephone/opencv/opencv.js': { f: 'opencv/opencv.js', t: JS },
    '/api/banc/telephone/opencv/opencv_js.wasm': { f: 'opencv/opencv_js.wasm', t: 'application/wasm' },
    '/api/banc/telephone/ort/ort.wasm.bundle.min.mjs': { f: 'ort/ort.wasm.bundle.min.mjs', t: JS },
    '/api/banc/telephone/ort/ort.webgpu.bundle.min.mjs': { f: 'ort/ort.webgpu.bundle.min.mjs', t: JS },
    '/api/banc/telephone/ort/ort-wasm-simd-threaded.wasm': { f: 'ort/ort-wasm-simd-threaded.wasm', t: 'application/wasm' },
    '/api/banc/telephone/ort/ort-wasm-simd-threaded.asyncify.wasm': { f: 'ort/ort-wasm-simd-threaded.asyncify.wasm', t: 'application/wasm' }
});
const ISOLEMENT = Object.freeze({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
const GLOBAL_HEURE = 120;   // toutes IP confondues (M3)
const IP_HEURE = 30;   // « quelques » dépôts par heure et par IP ; deux téléphones sur un même Wi-Fi partagent l'adresse, et une mesure en dépose deux (WASM, WebGPU)

/** La CSP de la page : tout est « self », l'hôte R2 exact (téléchargement du modèle, après la redirection) est le seul autre hôte ; WebAssembly permis (wasm-unsafe-eval), pas d'eval JavaScript. */
function csp(hoteR2) {
    return ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self'", "img-src 'self'", `connect-src 'self'${hoteR2 ? ' https://' + hoteR2 : ''}`,
        "worker-src 'self' blob:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');
}
const echapper = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

function monter(router, cfg, deps = {}) {
    const env = deps.envBancTelephone || process.env;
    const garde = G.lire(env);
    if (!garde.actif) return false;                                                    // l'absence : aucune route, 404 natif
    // M2 : la base de l'essai, par son NOM, ou rien : ni route, ni page. Dit au démarrage (une page absente sans explication se cherche longtemps). Vérifié encore à chaque écriture (stockage.js).
    const baseAttendue = typeof deps.baseAttendueBancTelephone === 'string' ? deps.baseAttendueBancTelephone : G.BASE_ESSAI;
    const baseLue = deps.nomBaseBancTelephone !== undefined ? deps.nomBaseBancTelephone : String(env.MONGODB_BASE || '').trim();
    if (baseLue !== baseAttendue) { console.error(`⚠️ [v2 banc-telephone] NON MONTÉ : la base est « ${String(baseLue).slice(0, 40) || '(MONGODB_BASE absente)'} », pas « ${baseAttendue} » (la page n'écrit que dans la base de l'essai)`); return false; }
    const m = (cfg && cfg.modeleEmpreinte) || {};
    const hote = G.hoteR2(env);
    const globalHeure = Number.isInteger(deps.globalHeureBancTelephone) && deps.globalHeureBancTelephone >= 1 ? deps.globalHeureBancTelephone : GLOBAL_HEURE;
    const gabarit = fs.readFileSync(path.join(PUBLIC, 'page.html'), 'utf8');
    const ipHeure = Number.isInteger(deps.ipHeureBancTelephone) && deps.ipHeureBancTelephone >= 1 ? deps.ipHeureBancTelephone : IP_HEURE;
    const maxDocuments = Number.isInteger(deps.documentsMaxBancTelephone) && deps.documentsMaxBancTelephone >= 1 ? deps.documentsMaxBancTelephone : S.DOCUMENTS_MAX;

    router.get('/api/banc/telephone', (req, res) => {
        const isole = req.query && req.query.iso !== '0';                              // ?iso=0 : la page sans isolement (un seul fil sur Safari) pour comparer
        // m4 : remplacement PAR FONCTION (une chaîne de remplacement interprète « $& », « $` »… : une valeur de configuration ne doit jamais s'y prêter)
        const html = gabarit.replace('__MODELE_SHA__', () => echapper(m.sha256 || '')).replace('__MODELE_OCTETS__', () => echapper(m.octets || 0)).replace('__ISOLEMENT__', () => (isole ? 'oui' : 'non'));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', csp(hote));
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        if (isole) for (const [k, v] of Object.entries(ISOLEMENT)) res.setHeader(k, v);
        return res.status(200).send(html);
    });
    for (const [chemin, { f, t }] of Object.entries(FICHIERS)) {
        router.get(chemin, (req, res) => {
            const disque = path.join(PUBLIC, f);
            fs.stat(disque, (e, st) => {
                if (e || !st.isFile()) return res.status(404).end();
                res.setHeader('Content-Type', t); res.setHeader('Content-Length', String(st.size));
                res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
                for (const [k, v] of Object.entries(ISOLEMENT)) res.setHeader(k, v);
                const flux = fs.createReadStream(disque);
                flux.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
                flux.pipe(res);
            });
        });
    }
    // M3 : l'IP passe par ipKeyGenerator (IPv6 regroupée par /56, comme installations/routes.js) ; ET un plafond GLOBAL (toutes IP) : l'IP seule se contourne en changeant d'adresse.
    // Le plafond global est compté APRÈS celui de l'IP : un appelant déjà refusé ne consomme pas le global. Bruit possible, essai seulement.
    const parIp = L.limiteur({ nom: 'banc-telephone-resultat', max: ipHeure, fenetreMs: 3600e3, cle: q => L.empreinteIp(ipKeyGenerator(String(q.ip || '?'))) });
    const global_ = L.limiteur({ nom: 'banc-telephone-resultat-global', max: globalHeure, fenetreMs: 3600e3, cle: () => 'toutes-les-ip' });
    router.post('/api/banc/telephone/resultat', parIp, global_, async (req, res) => {
        const cl = req.headers['content-length'];
        if (cl !== undefined && (!/^\d{1,10}$/.test(String(cl)) || Number(cl) > S.OCTETS_MAX)) return repondreErreur(res, 'ENTREE', undefined, { detail: 'trop-gros' }, 413);
        const v = S.valider(req.body);
        if (!v.ok) return repondreErreur(res, 'ENTREE', undefined, { detail: v.detail }, v.detail === 'trop-gros' ? 413 : undefined);
        try { const id = await S.stocker(v.doc, { max: maxDocuments, baseAttendue }); return res.status(201).json({ success: true, id }); }
        catch (e) { console.error(`❌ [v2 banc-telephone] stockage (${(e && (e.code || e.name)) || 'erreur'})`); return repondreErreur(res, 'INDISPONIBLE'); }
    });
    return true;
}

module.exports = { monter, csp, FICHIERS, IP_HEURE, GLOBAL_HEURE };
