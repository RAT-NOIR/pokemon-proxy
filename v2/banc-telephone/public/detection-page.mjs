// LE TEST DE DETECTION de la page de banc : la chaine decoder -> reduction 640 -> OpenCV.js -> redressement (detection.mjs), rejouee sur le lot COMPOSE (lot-detection.json : visuels publics du catalogue sur fonds synthetiques,
// aucune photo d'annonce) et confrontee aux ATTENDUS (quadrilateres, empreintes SHA-256 du RGB 640 et de la carte redressee) calcules par node et verifies dans Chrome. Sur un iPhone ou un Android :
// « IDENTIQUE » veut dire que ce moteur JavaScript et ce moteur WebAssembly rendent, octet pour octet, ce que rendent node et Chrome. Ne touche ni mesurer(), ni le verdict du modele, ni ses seuils.
import { detecter, sha256, VERSION_DETECTION } from './detection.mjs';

const $ = (id) => document.getElementById(id);
const meta = (n) => { const e = document.querySelector(`meta[name="${n}"]`); return e ? e.content : ''; };
const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, '?');
const mediane = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mo = (o) => (typeof o === 'number' ? Math.round(o / 1048576 * 10) / 10 : null);
const hex16 = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

async function chargerOpenCV() {
  // wasmBinary donne a Emscripten : aucune autre requete, et la meme voie que le Worker de l'extension. `Module` global retire apres usage (ORT n'en depend pas, mais la page ne doit pas le garder).
  window.Module = { wasmBinary: new Uint8Array(await (await fetch('/api/banc/telephone/opencv/opencv_js.wasm')).arrayBuffer()) };
  await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = '/api/banc/telephone/opencv/opencv.js'; s.onload = ok; s.onerror = () => ko(new Error('opencv.js')); document.head.appendChild(s); });
  const cv = await window.cv;
  try { delete window.Module; } catch { window.Module = undefined; }
  if (!cv || typeof cv.Mat !== 'function') throw new Error('opencv non initialise');
  return cv;
}

export async function executerTest() {
  const lot = await (await fetch('/api/banc/telephone/lot-detection.json')).json();
  const heap0 = performance.memory ? performance.memory.usedJSHeapSize : null;
  const t0 = performance.now();
  const cv = await chargerOpenCV();
  const msOpencv = Math.round(performance.now() - t0);
  const r = { version: VERSION_DETECTION, nImages: lot.images.length, nIdentiques: 0, nRgb640: 0, nQuads: 0, nCartes: 0, voieCanvas: 0, voiePillow: 0, ecarts: [], msOpencv, msMediane: null, msTotal: null, jsHeapMo: null, jsHeapApresMo: null, wasmHeapMo: null, erreur: null };
  const ms = []; const empreintes = [];
  const t1 = performance.now();
  for (const im of lot.images) {
    const binaire = atob(im.b64), octets = new Uint8Array(binaire.length); for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    const ta = performance.now();
    let d;
    try { d = detecter(cv, octets); } catch (e) { r.ecarts.push(`${im.id}:${ascii((e && (e.code || e.name)) || 'erreur')}`); continue; }
    ms.push(performance.now() - ta);
    const a = im.attendu, e = d.empreintes;
    const rgbOk = e.rgb640 === a.empreintes.rgb640, quadsOk = e.quads === a.empreintes.quads && JSON.stringify(d.quad) === JSON.stringify(a.quad), carteOk = e.carte === a.empreintes.carte;
    if (rgbOk) r.nRgb640++; if (quadsOk) r.nQuads++; if (carteOk) r.nCartes++;
    if (d.voie === 'canvas-high') r.voieCanvas++; else r.voiePillow++;
    if (rgbOk && quadsOk && carteOk && d.voie === a.voie) r.nIdentiques++; else r.ecarts.push(`${im.id}:${rgbOk ? '' : '640'}${quadsOk ? '' : 'Q'}${carteOk ? '' : 'C'}${d.voie === a.voie ? '' : 'V'}`);
    empreintes.push(`${im.id}|${e.rgb640}|${e.quads}|${e.carte}`);
  }
  r.msTotal = Math.round(performance.now() - t1); r.msMediane = Math.round(mediane(ms));
  r.empreinteLot = sha256(new TextEncoder().encode(empreintes.join('\n')));
  r.jsHeapMo = mo(heap0); r.jsHeapApresMo = performance.memory ? mo(performance.memory.usedJSHeapSize) : null;
  try { const h = cv.HEAPU8 || cv.HEAP8; r.wasmHeapMo = h ? mo(h.byteLength) : null; } catch { /* non exporte */ }
  r.verdict = r.nIdentiques === r.nImages && r.nImages > 0 ? 'IDENTIQUE' : 'ECART';
  r.empreinteAttendue = lot.images.length ? sha256(new TextEncoder().encode(lot.images.map((im) => `${im.id}|${im.attendu.empreintes.rgb640}|${im.attendu.empreintes.quads}|${im.attendu.empreintes.carte}`).join('\n'))) : null;
  return r;
}

/** Le document depose : memes champs racine que la mesure du modele (liste fermee de stockage.js), `mesure.detection` en plus. */
export function documentDepot(r) {
  const det = { version: r.version, nImages: r.nImages, nIdentiques: r.nIdentiques, nRgb640: r.nRgb640, nQuads: r.nQuads, nCartes: r.nCartes, voieCanvas: r.voieCanvas, voiePillow: r.voiePillow,
    ecarts: r.ecarts.join(',').slice(0, 200), empreinteLot: r.empreinteLot || null, msOpencv: r.msOpencv, msMediane: r.msMediane, msTotal: r.msTotal, jsHeapMo: r.jsHeapMo, jsHeapApresMo: r.jsHeapApresMo, wasmHeapMo: r.wasmHeapMo, erreur: r.erreur ? ascii(r.erreur).slice(0, 200) : null };
  return { v: 1, runId: hex16(), modeleSha: /^[0-9a-f]{64}$/.test(meta('modele-sha256')) ? meta('modele-sha256') : '0'.repeat(64), ua: ascii(navigator.userAgent).slice(0, 300), isole: self.crossOriginIsolated === true,
    coeurs: Number.isInteger(navigator.hardwareConcurrency) && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null, memoireAppareilGo: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null, gpuDispo: false,
    mesure: { moteur: 'wasm', verdict: r.erreur ? 'ERREUR' : r.verdict, detection: det } };
}

function afficher(r) {
  const bandeau = $('detectionVerdict');
  bandeau.textContent = r.erreur ? 'ERREUR' : r.verdict;
  $('detectionDetail').textContent = r.erreur ? r.erreur : `${r.nIdentiques}/${r.nImages} images identiques aux attendus (640 : ${r.nRgb640}, quadrilatères : ${r.nQuads}, cartes : ${r.nCartes}) · voies canvas-high ${r.voieCanvas} / pillow ${r.voiePillow}${r.ecarts.length ? ' · écarts : ' + r.ecarts.join(' ') : ''}`;
  $('detectionTemps').textContent = r.erreur ? '' : `OpenCV ${r.msOpencv} ms · médiane ${r.msMediane} ms par image · total ${r.msTotal} ms · tas JS ${r.jsHeapMo ?? 'n/d'} → ${r.jsHeapApresMo ?? 'n/d'} Mo · tas WASM d'OpenCV ${r.wasmHeapMo ?? 'n/d'} Mo`;
}

async function lancer() {
  const bouton = $('btnDetection'); bouton.disabled = true;
  let r;
  try { r = await executerTest(); } catch (e) { r = { version: VERSION_DETECTION, nImages: 0, nIdentiques: 0, nRgb640: 0, nQuads: 0, nCartes: 0, voieCanvas: 0, voiePillow: 0, ecarts: [], msOpencv: null, msMediane: null, msTotal: null, erreur: ascii(String((e && e.message) || e)).slice(0, 200) }; }
  afficher(r);
  const doc = documentDepot(r);
  $('detectionBrut').textContent = JSON.stringify(doc);
  try {
    const rep = await fetch('/api/banc/telephone/resultat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
    $('detectionEnvoi').textContent = rep.ok ? 'Résultat déposé.' : `Dépôt refusé (HTTP ${rep.status}) : copier le résultat ci-dessous.`;
  } catch { $('detectionEnvoi').textContent = 'Dépôt impossible : copier le résultat ci-dessous.'; }
  bouton.disabled = false;
}
if (typeof document !== 'undefined' && $('btnDetection')) $('btnDetection').addEventListener('click', lancer);
