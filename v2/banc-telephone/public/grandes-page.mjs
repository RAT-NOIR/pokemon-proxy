// LE TEST DES GRANDES PHOTOS de la page de banc : l'editeur choisit des photos prises avec le telephone (12 Mpx), la page fait tourner, SUR CET APPAREIL, deux chaines sur les memes octets :
//   « rm »  : la chaine Rat-Market (detecter() : decodeur JavaScript, pre-reduction entiere a 800 px, canvas « high » emule, OpenCV, redressement) — la meme sur tous les appareils ;
//   « nav » : la chaine SERVIE aujourd'hui (createImageBitmap, reduction a 640 par le canvas du navigateur sur la photo entiere, puis la MEME OpenCV et le MEME redressement).
// Resultat PAR MOTEUR (l'agent utilisateur du depot dit lequel) : redressee ou non, nombre de cartes, SHA-256 du RGB 640, des quadrilateres et de la carte redressee, temps, et l'ecart des deux quadrilateres.
// AUCUNE IMAGE n'est envoyee, ni conservee par la page (les octets vivent le temps d'une photo) ; le depot est a liste fermee (stockage.js, mesure.grandesPhotos) : des empreintes et des nombres. Le SHA-256 du fichier
// permet de retrouver la photo cote ordinateur (meme fichier -> chaine node) et de relier, plus tard, une verite (idProduct) fournie a part. Ne touche ni mesurer(), ni le verdict du modele, ni ses seuils.
import { detecter, quadrilateres, redresser, dimensions640, sha256, empreinteQuads, VERSION_DETECTION } from './detection.mjs';
import { obtenirOpenCV } from './detection-page.mjs';

export const PHOTOS_PAR_DEPOT = 6;
const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, '?');
const hex16 = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Le format reconnu aux premiers octets (jamais au nom du fichier). */
export function formatDe(o) {
  if (o.length > 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return 'jpeg';
  if (o.length > 8 && o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47) return 'png';
  if (o.length > 12 && o[0] === 0x52 && o[1] === 0x49 && o[2] === 0x46 && o[3] === 0x46 && o[8] === 0x57 && o[9] === 0x45 && o[10] === 0x42 && o[11] === 0x50) return 'webp';
  if (o.length > 12 && o[4] === 0x66 && o[5] === 0x74 && o[6] === 0x79 && o[7] === 0x70) return 'heic';   // boite ftyp : HEIC / HEIF / AVIF, que le decodeur refuse
  return 'autre';
}
/** Deplacement maximal des coins de deux quadrilateres, en POUR CENT de la diagonale de l'image 640 (un quadrilateres a 3 % ou plus est une AUTRE carte pour la detection). */
export function ecartQuadPct(qa, qb, dim) {
  const diag = Math.sqrt(dim[0] * dim[0] + dim[1] * dim[1]);
  return Math.round(1000 * Math.max(...qa.map((p, i) => Math.sqrt((p[0] - qb[i][0]) ** 2 + (p[1] - qb[i][1]) ** 2))) / diag) / 10;
}
const VIDE = { ok: false, code: null, redressee: false, nCartes: 0, rgb640: null, quads: null, carte: null, dim640: null, ms: null };
const code = (e) => ascii((e && (e.code || e.name)) || 'erreur').slice(0, 30);

/** La chaine du navigateur (voir l'en-tete) : rend { ...resume, quad } ; ne leve jamais. */
async function chaineNavigateur(cv, octets) {
  const t0 = performance.now();
  try {
    const bmp = await createImageBitmap(new Blob([octets]));
    const { W, H } = dimensions640(bmp.width, bmp.height);
    const toile = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const x = toile.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, W, H);
    bmp.close();
    const rgba = x.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
    toile.width = 0; toile.height = 0;
    const det = quadrilateres(cv, rgb, W, H);
    const r = { ok: true, code: null, redressee: false, nCartes: det.gardes.length, rgb640: sha256(rgb), quads: empreinteQuads(det.gardes), carte: null, dim640: `${W}x${H}`, ms: 0, quad: null };
    if (det.gardes.length) { r.redressee = true; r.quad = det.gardes[0].quad.map((p) => [p.x, p.y]); r.carte = sha256(redresser(cv, rgb, W, H, det.gardes[0])); }
    r.ms = Math.round(performance.now() - t0);
    return r;
  } catch (e) { return { ...VIDE, code: code(e), ms: Math.round(performance.now() - t0), quad: null }; }
}

/** Une photo -> l'enregistrement du depot (aucun octet de l'image dedans). `octets` : Uint8Array. */
export async function mesurerPhoto(cv, octets) {
  const rec = { sha256Fichier: sha256(octets), format: formatDe(octets), octets: octets.length, largeur: null, hauteur: null, orientation: null, prereduit: null, voie: null, rm: { ...VIDE }, nav: { ...VIDE }, ecartQuadPct: null, memeCarte: null };
  let qrm = null;
  try {
    const r = detecter(cv, octets);
    rec.largeur = r.largeur; rec.hauteur = r.hauteur; rec.orientation = r.orientationAppliquee || 1; rec.prereduit = Boolean(r.prereduction); rec.voie = r.voie;
    rec.rm = { ok: true, code: null, redressee: r.redressee, nCartes: r.nCartes, rgb640: r.empreintes.rgb640, quads: r.empreintes.quads, carte: r.empreintes.carte, dim640: `${r.dim640[0]}x${r.dim640[1]}`, ms: Object.values(r.ms).reduce((a, b) => a + b, 0) };
    qrm = r.quad;
  } catch (e) { rec.rm = { ...VIDE, code: code(e) }; }
  const n = await chaineNavigateur(cv, octets);
  const { quad: qnav, ...resume } = n; rec.nav = resume;
  if (qrm && qnav && rec.rm.dim640) { const [a, b] = rec.rm.dim640.split('x').map(Number); rec.ecartQuadPct = ecartQuadPct(qrm, qnav, [a, b]); rec.memeCarte = rec.ecartQuadPct < 3; }
  return rec;
}

export function documentDepot(photos, meta = {}) {
  return { v: 1, runId: hex16(), modeleSha: /^[0-9a-f]{64}$/.test(meta.modeleSha || '') ? meta.modeleSha : '0'.repeat(64), ua: ascii(navigator.userAgent).slice(0, 300), isole: globalThis.crossOriginIsolated === true,
    coeurs: Number.isInteger(navigator.hardwareConcurrency) && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null, memoireAppareilGo: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null, gpuDispo: false,
    mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', grandesPhotos: { version: VERSION_DETECTION, photos } } };
}

// ── l'ecran (aucun innerHTML : du texte seulement) ──
const $ = (id) => document.getElementById(id);
function ligne(rec, nom) {
  const li = document.createElement('li');
  const e = (m) => (m.ok ? (m.redressee ? `redressée (${m.nCartes} candidat${m.nCartes > 1 ? 's' : ''}, ${m.ms} ms)` : `aucune carte (${m.ms} ms)`) : `ERREUR ${m.code}`);
  li.textContent = `${ascii(nom).slice(0, 30)} · ${rec.format} ${rec.largeur ?? '?'}×${rec.hauteur ?? '?'} ${rec.octets > 0 ? Math.round(rec.octets / 1024) + ' Ko' : ''} · rm : ${e(rec.rm)} · navigateur : ${e(rec.nav)}${rec.ecartQuadPct !== null ? ` · écart ${String(rec.ecartQuadPct).replace('.', ',')} % ${rec.memeCarte ? '(même carte)' : '(AUTRE CARTE)'}` : ''}${rec.rm.rgb640 && rec.nav.rgb640 ? ` · pixels 640 ${rec.rm.rgb640 === rec.nav.rgb640 ? 'identiques' : 'différents'}` : ''}`;
  return li;
}
async function envoyer(photos) {
  const doc = documentDepot(photos, { modeleSha: (document.querySelector('meta[name="modele-sha256"]') || {}).content });
  $('grandesBrut').textContent = JSON.stringify(doc);
  try { const r = await fetch('/api/banc/telephone/resultat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) }); return r.ok ? 'déposé' : `refusé (HTTP ${r.status})`; } catch { return 'dépôt impossible'; }
}
async function lancer() {
  const bouton = $('btnGrandes'), fichiers = Array.from($('fichiersGrandes').files || []);
  if (!fichiers.length) { $('grandesEtat').textContent = 'Choisissez d\'abord des photos.'; return; }
  bouton.disabled = true; $('grandesListe').textContent = '';
  let cv;
  try { $('grandesEtat').textContent = 'Chargement d\'OpenCV…'; cv = await obtenirOpenCV(); } catch (e) { $('grandesEtat').textContent = `OpenCV indisponible : ${code(e)}`; bouton.disabled = false; return; }
  let lot = [], deposes = 0, statuts = [];
  for (let i = 0; i < fichiers.length; i++) {
    $('grandesEtat').textContent = `Photo ${i + 1} sur ${fichiers.length}…`;
    let rec;
    try { rec = await mesurerPhoto(cv, new Uint8Array(await fichiers[i].arrayBuffer())); } catch (e) { rec = { sha256Fichier: '0'.repeat(64), format: 'autre', octets: 0, largeur: null, hauteur: null, orientation: null, prereduit: null, voie: null, rm: { ...VIDE, code: code(e) }, nav: { ...VIDE, code: code(e) }, ecartQuadPct: null, memeCarte: null }; }
    $('grandesListe').appendChild(ligne(rec, 'photo ' + (i + 1)));
    lot.push(rec);
    if (lot.length === PHOTOS_PAR_DEPOT || i === fichiers.length - 1) { statuts.push(await envoyer(lot)); deposes += lot.length; lot = []; }
  }
  $('grandesEtat').textContent = `${fichiers.length} photo(s) mesurée(s) · dépôts : ${statuts.join(', ')} · aucune image n'a été envoyée ni conservée.`;
  bouton.disabled = false;
}
if (typeof document !== 'undefined' && document.getElementById('btnGrandes')) document.getElementById('btnGrandes').addEventListener('click', lancer);
