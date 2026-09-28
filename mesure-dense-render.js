// ============================================================================
// MÉMOIRE ET TEMPS DE RÉPONSE DU MODÈLE DENSE SUR LA MACHINE DE L'API (décision du testeur, 2026-09-27 : « autorisé pour le service de
// l'API côté serveur, pas dans l'extension. Mesure la mémoire et le temps de réponse sur Render avant de le brancher »)
// ============================================================================
// Rien n'est branché : ce script reproduit, dans un processus seul, ce que la route ferait par requête — encoder une photo (DINOv2
// small quantifié, 384 dimensions) puis chercher le plus proche dans tout le stock (46 436 vecteurs, float32 puis int8).
// AUTONOME, À DESSEIN : le service de l'API n'a ni accès R2 ni les vecteurs. Les vecteurs sont SYNTHÉTIQUES (même nombre, même
// dimension, normés) et les photos aussi (bruit, 600×825) : la mémoire et le temps ne dépendent que des tailles, pas du contenu. La
// JUSTESSE (int8 contre float32 : 19/20 le 2026-09-27) se mesure sur les vrais vecteurs, au labo — pas ici.
// Seul téléchargement : le modèle Xenova/dinov2-small, depuis Hugging Face, au premier lancement.
//
// ÉTAPES (shell Render du service de l'API, serveur au repos — le processus s'ajoute à lui dans la même limite mémoire) :
//   mkdir -p /tmp/dense && cp mesure-dense-render.js /tmp/dense/ && cd /tmp/dense
//   npm init -y > /dev/null && npm install --no-audit --no-fund @xenova/transformers@2.17.2
//   node mesure-dense-render.js --threads=1
// puis copier le JSON imprimé. /tmp s'efface au prochain redéploiement : rien ne reste dans le service.
const fs = require('fs'), os = require('os');
const AUTORISES = [/^--threads=\d+$/, /^--vecteurs=\d+$/, /^--requetes=\d+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --threads=N, --vecteurs=N, --requetes=N`); process.exit(2); }
const arg = (n, d) => Number(process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d);
const THREADS = arg('threads', 0) || null, N = arg('vecteurs', 46436), REQ = arg('requetes', 20), DIM = 384;
const mo = () => Math.round(process.memoryUsage().rss / 1e6);
const med = a => { const t = [...a].sort((x, y) => x - y); return t[Math.floor(t.length / 2)]; };
const p95 = a => { const t = [...a].sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(t.length * 0.95))]; };
// la limite mémoire du conteneur (cgroup v2 puis v1) et ce qu'il consomme déjà — serveur compris
const lire = f => { try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) { return null; } };
const cgroup = () => {
    const max = lire('/sys/fs/cgroup/memory.max') ?? lire('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    const cur = lire('/sys/fs/cgroup/memory.current') ?? lire('/sys/fs/cgroup/memory/memory.usage_in_bytes');
    const enMo = v => (v == null || v === 'max' || Number(v) > 1e15) ? v : Math.round(Number(v) / 1e6);
    return { limiteMo: enMo(max), utiliseMo: enMo(cur) };
};
(async () => {
    const r = { le: new Date().toISOString(), conteneurAvant: cgroup(), rssVide: mo() };
    const { AutoProcessor, AutoModel, RawImage, env } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    if (THREADS) env.backends.onnx.wasm.numThreads = THREADS;
    let t = Date.now();
    const proc = await AutoProcessor.from_pretrained('Xenova/dinov2-small');
    const modele = await AutoModel.from_pretrained('Xenova/dinov2-small', { quantized: true });
    r.chargementModeleMs = Date.now() - t; r.rssApresModele = mo();
    // le stock : N vecteurs normés (float32), puis leur copie int8 (quantification symétrique ×127) — comme au labo
    t = Date.now();
    const F = new Float32Array(N * DIM);
    for (let i = 0; i < N; i++) { let s = 0; for (let k = 0; k < DIM; k++) { const x = Math.random() * 2 - 1; F[i * DIM + k] = x; s += x * x; } s = Math.sqrt(s); for (let k = 0; k < DIM; k++) F[i * DIM + k] /= s; }
    r.vecteurs = N; r.fabricationVecteursMs = Date.now() - t; r.rssApresVecteursF32 = mo();
    const Q = new Int8Array(N * DIM); for (let i = 0; i < N * DIM; i++) Q[i] = Math.max(-127, Math.min(127, Math.round(F[i] * 127)));
    r.rssApresInt8 = mo();
    const encoder = async img => {
        const sortie = await modele(await proc(img));
        const tt = sortie.pooler_output ?? sortie.last_hidden_state;
        const d = sortie.pooler_output ? tt.data : tt.data.slice(0, DIM);
        let s = 0; for (const x of d) s += x * x; s = Math.sqrt(s) || 1;
        return Float32Array.from(d, x => x / s);
    };
    const chercherF32 = v => { let best = -2, bi = -1; for (let i = 0; i < N; i++) { let s = 0; const b = i * DIM; for (let k = 0; k < DIM; k++) s += v[k] * F[b + k]; if (s > best) { best = s; bi = i; } } return bi; };
    const chercherI8 = v => { const q = Int8Array.from(v, x => Math.round(x * 127)); let best = -1e9, bi = -1; for (let i = 0; i < N; i++) { let s = 0; const b = i * DIM; for (let k = 0; k < DIM; k++) s += q[k] * Q[b + k]; if (s > best) { best = s; bi = i; } } return bi; };
    const tEnc = [], tF32 = [], tI8 = [];
    for (let j = 0; j < REQ; j++) {
        // une « photo » de la taille d'un scan (600×825, RVB, bruit) : le préprocesseur la ramène à 224, comme une vraie
        const px = new Uint8ClampedArray(600 * 825 * 3); for (let i = 0; i < px.length; i++) px[i] = (Math.random() * 256) | 0;
        const img = new RawImage(px, 600, 825, 3);
        let t0 = Date.now(); const v = await encoder(img); tEnc.push(Date.now() - t0);
        t0 = Date.now(); chercherF32(v); tF32.push(Date.now() - t0);
        t0 = Date.now(); chercherI8(v); tI8.push(Date.now() - t0);
    }
    r.requetes = REQ; r.rssMax = mo(); r.conteneurApres = cgroup();
    r.encodageMs = { mediane: med(tEnc), p95: p95(tEnc) };
    r.rechercheF32Ms = { mediane: med(tF32), p95: p95(tF32) };
    r.rechercheInt8Ms = { mediane: med(tI8), p95: p95(tI8) };
    r.reponseTotaleMs = { mediane: med(tEnc) + med(tI8), p95: p95(tEnc) + p95(tI8) };
    r.machine = { plateforme: process.platform, cpus: os.cpus().length, modele: os.cpus()[0]?.model, memoireTotaleMo: Math.round(os.totalmem() / 1e6), node: process.version, threads: THREADS ?? 'défaut' };
    r.nature = 'vecteurs et photos SYNTHÉTIQUES (même taille) : mémoire et temps seulement, jamais la justesse';
    console.log(JSON.stringify(r, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
