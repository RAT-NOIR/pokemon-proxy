// BANC TELEPHONE — la page de mesure (GET /api/banc/telephone). Même modèle servi (téléchargé par GET /api/modele-empreinte/<sha256>, 302 vers R2, vérifié par son sha256),
// même moteur (onnxruntime-web 1.30.0 : ort.wasm.bundle.min.mjs, wasmPaths, fils = nombreDeFils, proxy = false ; WebGPU : ort.webgpu.bundle.min.mjs, asyncify, 1 fil, repli de sonde et de session bornés)
// et même prétraitement que l'extension v2 : empreinte.js et moteur-ort.js sont les fichiers de l'extension, COPIÉS SANS CHANGEMENT (redimPIL, versTenseur, normaliserL2, encoderVecteur ; cosinus, sonderAdaptateur, creerSessionGpu).
// Entrée : 30 cartes de CATALOGUE (v2/banc-telephone/public/lot.json : JPEG 420 x 587, q 0,92 — la carte redressée du contrat) et, pour chacune, le vecteur de RÉFÉRENCE calculé en natif (onnxruntime CPU, Python, PIL).
// Deux mesures de fidélité : « chaîne complète » (JPEG décodé par ce navigateur → redimPIL → modèle) et « modèle seul » (les 224 x 224 octets PIL → modèle) pour les 12 premières cartes : elles séparent le décodeur du modèle.
// Aucun innerHTML : tout passe par textContent.
import { versTenseur, normaliserL2, vecteurDepuisSortie, nombreDeFils, COTE_MODELE } from './empreinte.js';
import { cosinus, course, sonderAdaptateur, creerSessionGpu } from './moteur-ort.js';

const $ = id => document.getElementById(id);
const meta = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || '';
const SHA = meta('modele-sha256'), OCTETS = Number(meta('modele-octets')) || 0;
const SEUIL_IDENTIQUE = 0.9999;
const aleaHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const E = { modele: null, shaVerifie: null, telechargementMs: null, verifShaMs: null, lot: null, vecWasm: null, runId: aleaHex(8), decodeurOptions: null, gpu: null, mesures: {} };

// ── affichage
const ascii = s => String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '?');
const arrondi = (x, d = 3) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const f = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');
function ligne(tableId, k, v) { const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td'); a.textContent = k; b.textContent = String(v); tr.append(a, b); $(tableId).append(tr); }
const t0 = performance.now();
const journal = m => { $('journal').textContent += `[${((performance.now() - t0) / 1000).toFixed(1)} s] ${m}\n`; };
const etat = (mot, detail, classe) => { $('verdictMot').textContent = mot; $('verdictDetail').textContent = detail || ''; $('verdict').className = `verdict ${classe}`; };
let stockage = null; try { stockage = window.localStorage; } catch { stockage = null; }
const etape = x => { try { if (stockage) stockage.setItem('rm-banc-etape', x); } catch { /* sans stockage */ } };
const pause = () => new Promise(r => setTimeout(r, 0));
// une erreur de CETTE page porte un code lisible (`detail`) ; pour toute autre exception, seul le nom est dit (jamais le texte d'une exception du navigateur).
class ErreurBanc extends Error { constructor(detail) { super(); this.detail = detail; } }
const texteErreur = e => ascii(e && (typeof e.detail === 'string' ? e.detail : e.name) || 'erreur').slice(0, 200);

// ── l'appareil
function decrireAppareil() {
    const gpuOk = typeof navigator.gpu !== 'undefined';
    const lignes = [['agent utilisateur', ascii(navigator.userAgent)], ['crossOriginIsolated', self.crossOriginIsolated === true ? 'oui' : 'non'], ['isolement demandé à la page', meta('isolement-demande') || '?'],
        ['cœurs logiques', navigator.hardwareConcurrency || 'inconnu'], ['mémoire de l\'appareil (Go, arrondie)', navigator.deviceMemory === undefined ? 'non disponible' : navigator.deviceMemory],
        ['SharedArrayBuffer', typeof SharedArrayBuffer === 'function' ? 'oui' : 'non'], ['WebAssembly', typeof WebAssembly === 'object' ? 'oui' : 'non'], ['navigator.gpu (WebGPU)', gpuOk ? 'présent' : 'absent'],
        ['performance.memory', performance.memory ? 'disponible' : 'non disponible'], ['measureUserAgentSpecificMemory', self.crossOriginIsolated === true && performance.measureUserAgentSpecificMemory ? 'disponible' : 'non disponible'],
        ['modèle attendu (sha256)', SHA ? SHA.slice(0, 12) + '…' : 'NON CONFIGURÉ'], ['modèle attendu (octets)', OCTETS || 'inconnu']];
    for (const [k, v] of lignes) ligne('appareil', k, v);
    $('btnGpu').disabled = !gpuOk;
    if (!gpuOk) $('btnGpu').textContent = 'WebGPU absent sur cet appareil';
}
function avertirReprise() {
    let x = null; try { x = stockage && stockage.getItem('rm-banc-etape'); } catch { x = null; }
    if (x && x !== 'fini') { journal(`ATTENTION : la mesure précédente s'est arrêtée à l'étape « ${x} » (onglet fermé par le navigateur ? mémoire ?).`); etat('PRÊT', `La mesure précédente s'est arrêtée à « ${x} ».`, 'attente'); }
}

// ── octets
const b64vers = s => { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
const mediane = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : null; };
const rgbaVersRgb = (rgba, n) => { const rgb = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; } return rgb; };   // pur.js de l'extension

// ── le modèle : par l'API (302 vers R2), vérifié par son sha256 — comme l'extension
async function chargerModele() {
    if (E.modele) return E.modele;
    if (!/^[0-9a-f]{64}$/.test(SHA)) throw new ErreurBanc('modele-non-configure : l\'API ne publie aucun sha256 de modèle');
    etape('telechargement-modele');
    const t = performance.now();
    let rep;
    try { rep = await fetch(`/api/modele-empreinte/${SHA}`, { credentials: 'omit', cache: 'no-store' }); }
    catch (e) { throw new ErreurBanc('telechargement-modele-bloque : la requete a ete refusee par le navigateur (CORS du bucket R2 pour cette origine ?)'); }
    if (!rep.ok) throw new ErreurBanc(`telechargement-modele : HTTP ${rep.status}`);
    const total = Number(rep.headers.get('content-length')) || OCTETS;
    if (!total) throw new ErreurBanc('telechargement-modele : taille inconnue');
    const tampon = new Uint8Array(total); let recu = 0;
    const lecteur = rep.body.getReader();
    for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        if (recu + value.length > total) throw new ErreurBanc('telechargement-modele : plus d\'octets que annonce');
        tampon.set(value, recu); recu += value.length;
        if (((recu / 1048576) | 0) % 5 === 0) etat('TÉLÉCHARGEMENT', `${f(recu / 1048576, 0)} / ${f(total / 1048576, 0)} Mo`, 'attente');
    }
    if (recu !== total) throw new ErreurBanc(`telechargement-modele : ${recu} octets recus sur ${total}`);
    E.telechargementMs = performance.now() - t;
    journal(`modèle reçu : ${recu} octets en ${f(E.telechargementMs / 1000, 1)} s`);
    if (self.crypto && crypto.subtle) {
        etape('verification-sha256'); etat('VÉRIFICATION', 'sha256 du modèle…', 'attente');
        const tv = performance.now();
        const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', tampon)), b => b.toString(16).padStart(2, '0')).join('');
        E.verifShaMs = performance.now() - tv; E.shaVerifie = h === SHA;
        if (!E.shaVerifie) throw new ErreurBanc('modele-sha256-different : le fichier recu n\'est pas le modele attendu');
        journal(`sha256 vérifié (${f(E.verifShaMs / 1000, 1)} s)`);
    } else { E.shaVerifie = null; journal('sha256 NON vérifié (crypto.subtle absent : contexte non sécurisé)'); }
    E.modele = tampon;
    return tampon;
}
async function chargerLot() {
    if (E.lot) return E.lot;
    etape('lot'); const r = await fetch('/api/banc/telephone/lot.json', { cache: 'no-store' });
    if (!r.ok) throw new ErreurBanc(`lot : HTTP ${r.status}`);
    const lot = await r.json();
    if (lot.modeleSha256 !== SHA) throw new ErreurBanc('lot-pour-un-autre-modele : les references ne sont pas celles du modele servi');
    for (const c of lot.cartes) { c.refV = new Float32Array(b64vers(c.ref).buffer); if (c.px) c.pxV = b64vers(c.px); }
    E.lot = lot; return lot;
}

// ── la carte : JPEG → pixels bruts (comme les références de l'extension : colorSpaceConversion « none ») → redimPIL → tenseur
async function decoderCarte(c) {
    const blob = new Blob([b64vers(c.jpg)], { type: 'image/jpeg' });
    let bmp;
    try { bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); if (E.decodeurOptions === null) E.decodeurOptions = true; }
    catch { bmp = await createImageBitmap(blob); E.decodeurOptions = false; }
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    const w = bmp.width, h = bmp.height, d = x.getImageData(0, 0, w, h);
    if (bmp.close) bmp.close();
    return { rgb: rgbaVersRgb(d.data, w * h), w, h };
}
const tenseurDepuisPx = px => { const n = COTE_MODELE * COTE_MODELE, t = new Float32Array(3 * n); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) t[k * n + i] = (px[i * 3 + k] / 255 - 0.5) / 0.5; return t; };

async function memoire() {
    const r = { jsHeapMo: null, uaMo: null };
    try { if (performance.memory) r.jsHeapMo = arrondi(performance.memory.usedJSHeapSize / 1048576, 1); } catch { /* non disponible */ }
    try {
        if (self.crossOriginIsolated === true && performance.measureUserAgentSpecificMemory) {
            const m = await course(performance.measureUserAgentSpecificMemory(), 8000);
            if (m.ok) r.uaMo = Math.round(m.valeur.bytes / 1048576);
        }
    } catch { /* non disponible */ }
    return r;
}

// ── la mesure d'un moteur : `ort` (le module), `session`
async function mesurer(moteur, ort, session, filsDemandes, creationMs) {
    const lot = await chargerLot();
    const mem1 = await memoire();
    const fils = ort.env && ort.env.wasm ? Number(ort.env.wasm.numThreads) : null;
    const infer = async tenseur => {
        const a = performance.now();
        const sortie = await session.run({ pixel_values: new ort.Tensor('float32', tenseur, [1, 3, COTE_MODELE, COTE_MODELE]) });
        const ms = performance.now() - a;
        if (!sortie.emb || sortie.emb.dims.join(',') !== '1,256') throw new ErreurBanc('forme-de-emb');
        const emb = Array.from(sortie.emb.data); try { sortie.emb.dispose(); } catch { /* deja liberee */ }
        return { emb, ms };
    };
    const runs = [], pre = [], cos = [], vecs = []; let refuses = 0;
    for (let i = 0; i < lot.cartes.length; i++) {
        etat('MESURE', `${moteur.toUpperCase()} · carte ${i + 1}/${lot.cartes.length}`, 'attente'); etape(`${moteur}-carte-${i}`);
        const ta = performance.now();
        const { rgb, w, h } = await decoderCarte(lot.cartes[i]);
        const tenseur = versTenseur(rgb, w, h);
        pre.push(performance.now() - ta);
        const { emb, ms } = await infer(tenseur);
        runs.push(ms);
        const n = normaliserL2(emb);
        if (!n || !vecteurDepuisSortie(emb)) { refuses++; cos.push(0); vecs.push(null); } else { cos.push(cosinus(n, lot.cartes[i].refV)); vecs.push(Float32Array.from(n)); }
        await pause();
    }
    const cosPx = [];
    for (let i = 0; i < lot.cartes.length; i++) {
        if (!lot.cartes[i].pxV) continue;
        etape(`${moteur}-modele-seul-${i}`);
        const { emb } = await infer(tenseurDepuisPx(lot.cartes[i].pxV)); const n = normaliserL2(emb);
        cosPx.push(n ? cosinus(n, lot.cartes[i].refV) : 0); await pause();
    }
    const mem2 = await memoire();
    const m = { moteur, fils, filsDemandes, creationSessionMs: arrondi(creationMs, 1), premiereMs: arrondi(runs[0], 1), medianeMs: arrondi(mediane(runs.slice(1)), 1), p95Ms: arrondi(p95(runs.slice(1)), 1),
        pretraitementMedianeMs: arrondi(mediane(pre), 1), nEmpreintes: lot.cartes.length, nVecteursRefuses: refuses, cosMin: arrondi(Math.min(...cos), 7), cosMoy: arrondi(cos.reduce((s, x) => s + x, 0) / cos.length, 7),
        cosMinModeleSeul: cosPx.length ? arrondi(Math.min(...cosPx), 7) : null, nModeleSeul: cosPx.length,
        jsHeapApresCreationMo: mem1.jsHeapMo, jsHeapFinMo: mem2.jsHeapMo, uaApresCreationMo: mem1.uaMo, uaFinMo: mem2.uaMo };
    m.verdict = m.cosMin !== null && m.cosMin >= SEUIL_IDENTIQUE && refuses === 0 ? 'IDENTIQUE' : 'ECART';
    return { m, vecs };
}

// ── WASM : exactement la chargerORT / creerWasm de l'extension
async function mesurerWasm() {
    etape('ort-wasm');
    const ort = await import('./ort/ort.wasm.bundle.min.mjs');
    ort.env.wasm.wasmPaths = { wasm: new URL('ort/ort-wasm-simd-threaded.wasm', import.meta.url).href };
    const demande = nombreDeFils(navigator.hardwareConcurrency);
    ort.env.wasm.numThreads = demande; ort.env.wasm.proxy = false;
    const modele = await chargerModele();
    etape('creation-session-wasm'); etat('SESSION', 'création de la session WASM…', 'attente');
    const ta = performance.now();
    const session = await ort.InferenceSession.create(modele, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const creation = performance.now() - ta; journal(`session WASM créée en ${f(creation, 0)} ms`);
    try {
        const { m, vecs } = await mesurer('wasm', ort, session, demande, creation);
        E.vecWasm = vecs; return m;
    } finally { try { await session.release(); } catch { /* deja liberee */ } }
}

// ── WebGPU : la sonde (2 s), la session (20 s) et le repli de l'extension (moteur-ort.js, sans changement)
async function mesurerGpu() {
    etape('sonde-gpu');
    const sonde = await sonderAdaptateur(navigator.gpu);
    if (!sonde.ok) return { moteur: 'webgpu', verdict: 'ERREUR', erreur: `webgpu-indisponible:${sonde.raison}` };
    E.gpu = { vendor: ascii(sonde.adaptateur.vendor).slice(0, 40), architecture: ascii(sonde.adaptateur.architecture).slice(0, 40) };
    journal(`adaptateur WebGPU : ${E.gpu.vendor} / ${E.gpu.architecture}`);
    etape('ort-webgpu');
    const ort = await import('./ort/ort.webgpu.bundle.min.mjs');
    ort.env.wasm.wasmPaths = { wasm: new URL('ort/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href };
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;      // le calcul est sur le GPU : pas de fils WASM de plus (extension : FILS_GPU)
    const modele = await chargerModele();
    etape('creation-session-gpu'); etat('SESSION', 'création de la session WebGPU…', 'attente');
    const ta = performance.now();
    const g = await creerSessionGpu({ ort, tampon: async () => modele.buffer });
    const creation = performance.now() - ta;
    if (!g.ok) return { moteur: 'webgpu', verdict: 'ERREUR', erreur: `${g.raison} (apres ${Math.round(creation)} ms)`, creationSessionMs: arrondi(creation, 1) };
    journal(`session WebGPU créée en ${f(creation, 0)} ms`);
    try {
        const { m, vecs } = await mesurer('webgpu', ort, g.session, 1, creation);
        if (E.vecWasm) {
            let mn = 1; for (let i = 0; i < vecs.length; i++) mn = Math.min(mn, vecs[i] && E.vecWasm[i] ? cosinus(vecs[i], E.vecWasm[i]) : 0);
            m.cosMinContreWasm = arrondi(mn, 7);
        } else m.cosMinContreWasm = null;
        return m;
    } finally { try { await g.session.release(); } catch { /* deja liberee */ } }
}

// ── l'envoi et l'écran
function document_(mesure) {
    return { v: 1, runId: E.runId, modeleSha: SHA || '0'.repeat(64), ua: ascii(navigator.userAgent).slice(0, 300), isole: self.crossOriginIsolated === true, coeurs: Number.isInteger(navigator.hardwareConcurrency) && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null,
        memoireAppareilGo: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null, gpuDispo: typeof navigator.gpu !== 'undefined', gpu: E.gpu, decodeurOptions: E.decodeurOptions,
        modeleOctets: E.modele ? E.modele.length : null, telechargementMs: arrondi(E.telechargementMs, 0), verifShaMs: arrondi(E.verifShaMs, 0), shaVerifie: E.shaVerifie, mesure };
}
async function envoyer(mesure) {
    const doc = document_(mesure);
    $('brut').textContent = JSON.stringify(doc, null, 1);
    $('envoi').textContent = 'Envoi du résultat…';
    try {
        const r = await fetch('/api/banc/telephone/resultat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
        $('envoi').textContent = r.status === 201 ? `Résultat envoyé (${mesure.moteur}). Rien d'autre à faire.` : `Résultat NON envoyé (HTTP ${r.status}) : recopiez le texte « Résultat à copier » ci-dessous.`;
    } catch { $('envoi').textContent = 'Résultat NON envoyé (réseau) : recopiez le texte « Résultat à copier » ci-dessous.'; }
}
function afficher(m) {
    const mem = m.uaFinMo != null ? `${m.uaFinMo} Mo (navigateur)` : m.jsHeapFinMo != null ? `${m.jsHeapFinMo} Mo (tas JS)` : 'non disponible';
    const moteur = String(m.moteur || '?').toUpperCase();
    if (m.verdict === 'ERREUR') { etat('ERREUR', m.erreur || '', 'ko'); $('ligne1').textContent = `1 · verdict : ERREUR (${moteur})`; $('ligne2').textContent = `2 · moteur : ${moteur}`; $('ligne3').textContent = `3 · ${m.erreur || ''}`; }
    else {
        const ok = m.verdict === 'IDENTIQUE';
        etat(ok ? 'IDENTIQUE' : `ÉCART ${f(m.cosMin, 5)}`, `${moteur} · cos min ${f(m.cosMin, 6)} sur ${m.nEmpreintes} cartes${m.cosMinModeleSeul != null ? ` · modèle seul ${f(m.cosMinModeleSeul, 6)}` : ''}`, ok ? 'ok' : 'ecart');
        $('ligne1').textContent = `1 · verdict : ${ok ? 'IDENTIQUE' : 'ÉCART'} (${moteur}) — cos min ${f(m.cosMin, 6)}`;
        $('ligne2').textContent = `2 · moteur : ${moteur} · ${m.fils == null ? '?' : m.fils} fil(s) · isolé ${self.crossOriginIsolated === true ? 'oui' : 'non'} · ${navigator.hardwareConcurrency || '?'} cœurs`;
        $('ligne3').textContent = `3 · médiane ${f(m.medianeMs, 0)} ms (1re ${f(m.premiereMs, 0)}, p95 ${f(m.p95Ms, 0)}) · mémoire ${mem}`;
    }
    const t = $('chiffres'); t.textContent = '';
    const dico = [['moteur', m.moteur], ['verdict', m.verdict], ['erreur', m.erreur || '—'], ['fils utilisés (demandés)', `${m.fils == null ? '—' : m.fils} (${m.filsDemandes == null ? '—' : m.filsDemandes})`],
        ['téléchargement du modèle (ms)', E.telechargementMs == null ? '—' : f(E.telechargementMs, 0)], ['vérification sha256 (ms)', E.verifShaMs == null ? '—' : f(E.verifShaMs, 0)], ['sha256 vérifié', E.shaVerifie === null ? 'non vérifiable' : E.shaVerifie ? 'oui' : 'NON'],
        ['création de la session (ms)', f(m.creationSessionMs, 0)], ['première empreinte (ms)', f(m.premiereMs, 0)], ['médiane (ms)', f(m.medianeMs, 0)], ['p95 (ms)', f(m.p95Ms, 0)], ['prétraitement médian : décodage + redimPIL (ms)', f(m.pretraitementMedianeMs, 0)],
        ['cos min / moyen, chaîne complète', `${f(m.cosMin, 7)} / ${f(m.cosMoy, 7)} (${m.nEmpreintes == null ? '—' : m.nEmpreintes} cartes)`], ['cos min, modèle seul', m.cosMinModeleSeul == null ? '—' : `${f(m.cosMinModeleSeul, 7)} (${m.nModeleSeul} cartes)`],
        ['vecteurs refusés par l\'encodeur', m.nVecteursRefuses == null ? '—' : m.nVecteursRefuses], ['cos min contre WASM (garde de l\'extension : 0,998)', m.cosMinContreWasm == null ? '—' : f(m.cosMinContreWasm, 7)],
        ['tas JS après création / fin (Mo)', `${m.jsHeapApresCreationMo == null ? 'non disponible' : f(m.jsHeapApresCreationMo, 1)} / ${m.jsHeapFinMo == null ? 'non disponible' : f(m.jsHeapFinMo, 1)}`],
        ['mémoire navigateur après création / fin (Mo)', `${m.uaApresCreationMo == null ? 'non disponible' : m.uaApresCreationMo} / ${m.uaFinMo == null ? 'non disponible' : m.uaFinMo}`], ['décodeur d\'image : options acceptées', E.decodeurOptions === null ? '—' : E.decodeurOptions ? 'oui' : 'non (repli sans options)']];
    for (const [k, v] of dico) ligne('chiffres', k, v);
}
async function lancer(moteur) {
    $('btnWasm').disabled = true; $('btnGpu').disabled = true;
    let m;
    try { m = moteur === 'wasm' ? await mesurerWasm() : await mesurerGpu(); }
    catch (e) { journal(`ERREUR ${texteErreur(e)}`); m = { moteur, verdict: 'ERREUR', erreur: texteErreur(e) }; }
    E.mesures[moteur] = m;
    afficher(m); etape('fini');
    await envoyer(m);
    $('btnWasm').disabled = false; $('btnGpu').disabled = typeof navigator.gpu === 'undefined';
}

decrireAppareil(); avertirReprise();
$('btnWasm').addEventListener('click', () => { lancer('wasm'); });
$('btnGpu').addEventListener('click', () => { lancer('webgpu'); });
window.addEventListener('error', e => journal(`ERREUR-JS non rattrapee, ligne ${Number(e.lineno) || 0}`));
window.addEventListener('unhandledrejection', e => journal(`REJET ${texteErreur(e.reason)}`));
// un point d'entrée pour le pilote local (headless) : lancer sans toucher les boutons
window.__banc = { lancer, E };
