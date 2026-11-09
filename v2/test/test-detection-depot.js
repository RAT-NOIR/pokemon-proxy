'use strict';
// Le DEPOT du test de detection (stockage.js, mesure.detection) : liste fermee, aucune valeur libre. Node pur, aucune base ouverte (valider() ne touche pas la base).
const S = require(process.env.RM_STOCKAGE || '../banc-telephone/stockage');   // RM_STOCKAGE : rejouer contre l'ANCIEN stockage (rouge vu)
let ok = 0, ko = 0;
const vrai = (nom, cond, detail) => { if (cond) ok++; else { ko++; console.log(`❌ ${nom}${detail ? ' — ' + detail : ''}`); } };
const detection = (o = {}) => ({ version: 'rm-detection-1', nImages: 12, nIdentiques: 12, nRgb640: 12, nQuads: 12, nCartes: 12, voieCanvas: 9, voiePillow: 3, ecarts: '', empreinteLot: 'a'.repeat(64), msOpencv: 410, msMediane: 85, msTotal: 1100, jsHeapMo: 12.3, jsHeapApresMo: 40.1, wasmHeapMo: 33, erreur: null, ...o });
const doc = (det, mesure = {}) => ({ v: 1, runId: '0123456789abcdef', modeleSha: '0'.repeat(64), ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', isole: true, coeurs: 6, memoireAppareilGo: null, gpuDispo: false, mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', detection: det, ...mesure } });

vrai('1. un depot de detection complet est accepte', S.valider(doc(detection())).ok === true, JSON.stringify(S.valider(doc(detection()))));
vrai('1. des mesures absentes (null) sont permises (iPhone : pas de performance.memory)', S.valider(doc(detection({ jsHeapMo: null, jsHeapApresMo: null, wasmHeapMo: null, empreinteLot: null }))).ok === true);
vrai('1. une erreur nommee (texte court) est permise', S.valider(doc(detection({ erreur: 'opencv non initialise' }), { verdict: 'ERREUR' })).ok === true);
for (const [nom, d] of [
    ['un champ inconnu', detection({ photo: 'x' })], ['un compte hors bornes', detection({ nIdentiques: 101 })], ['un compte non entier', detection({ nQuads: 1.5 })], ['une empreinte non hexadecimale', detection({ empreinteLot: 'Z'.repeat(64) })],
    ['des ecarts trop longs', detection({ ecarts: 'x'.repeat(201) })], ['un texte non ASCII', detection({ erreur: 'é' })], ['une duree negative', detection({ msTotal: -1 })], ['une version trop longue', detection({ version: 'v'.repeat(31) })]]) {
    const v = S.valider(doc(d));
    vrai(`2. refuse : ${nom}`, v.ok === false && /^champ/.test(v.detail), JSON.stringify(v));
}
vrai('3. un objet detection imbrique inconnu est refuse', S.valider(doc({ ...detection(), imbrique: { a: 1 } })).ok === false);
vrai('3. la mesure du modele (sans detection) reste acceptee', S.valider({ ...doc(null), mesure: { moteur: 'wasm', verdict: 'IDENTIQUE' } }).ok === true);
vrai('3. le document reste sous la borne de taille', Buffer.byteLength(JSON.stringify(doc(detection({ ecarts: 'x'.repeat(200) }))), 'utf8') < S.OCTETS_MAX);
// ── les grandes photos : mesure.grandesPhotos, liste fermee a trois niveaux (depot, photo, moteur), six photos au plus, aucune image ──
const mot = (o = {}) => ({ ok: true, code: null, redressee: true, nCartes: 2, rgb640: 'c'.repeat(64), quads: 'd'.repeat(64), carte: 'e'.repeat(64), dim640: '640x480', ms: 210, ...o });
const ph = (o = {}) => ({ sha256Fichier: 'f'.repeat(64), format: 'jpeg', octets: 5400000, largeur: 4032, hauteur: 3024, orientation: 1, prereduit: true, voie: 'canvas-high', rm: mot(), nav: mot(), ecartQuadPct: 0.4, memeCarte: true, ...o });
const gp = (photos, extra = {}) => doc(null, { grandesPhotos: { version: 'rm-detection-2', photos, ...extra } });
vrai('4. un depot de grandes photos complet est accepte', S.valider(gp([ph(), ph()])).ok === true, JSON.stringify(S.valider(gp([ph()]))));
vrai('4. un moteur en erreur (code du decodeur, aucune empreinte) est accepte', S.valider(gp([ph({ rm: mot({ ok: false, code: 'NON_SUPPORTE', redressee: false, nCartes: 0, rgb640: null, quads: null, carte: null, dim640: null }), ecartQuadPct: null, memeCarte: null, voie: null, prereduit: null, largeur: null, hauteur: null, orientation: null })])).ok === true);
for (const [nom, d] of [['une cle inconnue dans la photo', gp([ph({ idProduct: 5 })])], ['une cle inconnue dans rm', gp([ph({ rm: mot({ pixels: 'x' }) })])], ['une cle inconnue dans nav', gp([ph({ nav: mot({ image: 'x' }) })])], ['une cle inconnue dans grandesPhotos', gp([ph()], { note: 'x' })],
    ['zero photo', gp([])], ['sept photos', gp([1, 2, 3, 4, 5, 6, 7].map(() => ph()))], ['un format inconnu', gp([ph({ format: 'tiff' })])], ['un sha256 mal forme', gp([ph({ sha256Fichier: 'x' })])], ['un ecart negatif', gp([ph({ ecartQuadPct: -1 })])], ['une voie inconnue', gp([ph({ voie: 'gpu' })])], ['un nom de fichier', gp([ph({ nom: 'IMG_0001.jpg' })])]]) {
    const v = S.valider(d);
    vrai(`4. refuse : ${nom}`, v.ok === false && /^(champ|forme)/.test(v.detail), JSON.stringify(v));
}
vrai('4. six photos tiennent sous la borne de taille', Buffer.byteLength(JSON.stringify(gp([1, 2, 3, 4, 5, 6].map(() => ph()))), 'utf8') < S.OCTETS_MAX);

// ── le document que la PAGE fabrique (grandes-page.mjs : mesurerPhoto + documentDepot) est accepte par la validation REELLE ; sous node il n'y a pas de createImageBitmap : le moteur « navigateur » rend un code, pas une exception ──
(async () => {
    const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
    const PUB = path.join(__dirname, '..', 'banc-telephone', 'public');
    const G = await import(pathToFileURL(path.join(PUB, 'grandes-page.mjs')).href);
    globalThis.Module = { wasmBinary: fs.readFileSync(path.join(PUB, 'opencv', 'opencv_js.wasm')) };
    const cv = await require(path.join(PUB, 'opencv', 'opencv.js'));
    const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot-detection.json'), 'utf8'));
    const photos = [];
    for (const im of lot.images.slice(0, 3)) photos.push(await G.mesurerPhoto(cv, new Uint8Array(Buffer.from(im.b64, 'base64'))));
    photos.push(await G.mesurerPhoto(cv, Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])));   // HEIC : refus du decodeur, FORMAT
    const d = G.documentDepot(photos);
    const v = S.valider(d);
    vrai('5. le document fabrique par la page (4 photos dont un HEIC refuse) est accepte par la validation reelle', v.ok === true, JSON.stringify(v));
    vrai('5. rm : la 1re photo est mesuree (redressee, empreintes de 64 hexadecimaux) ; HEIC : FORMAT sans empreinte', photos[0].rm.ok === true && /^[0-9a-f]{64}$/.test(photos[0].rm.rgb640) && photos[3].rm.ok === false && photos[3].rm.code === 'FORMAT' && photos[3].rm.rgb640 === null && photos[3].format === 'heic');
    vrai('5. nav sous node : code (pas d\'exception), pas d\'ecart de quadrilatere', photos[0].nav.ok === false && typeof photos[0].nav.code === 'string' && photos[0].ecartQuadPct === null && photos[0].memeCarte === null);
    vrai('5. le depot ne porte aucun octet d\'image (aucun champ de plus de 200 caracteres)', JSON.stringify(d, (k, x) => (typeof x === 'string' && x.length > 200 ? 'LONG' : x)).indexOf('LONG') < 0);
    vrai('5. formatDe par les octets : jpeg, png, webp, heic, autre', [G.formatDe(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), G.formatDe(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])), G.formatDe(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0])), G.formatDe(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0])), G.formatDe(Uint8Array.from([1, 2, 3]))].join() === 'jpeg,png,webp,heic,autre');
    vrai('5. ecartQuadPct : coins decales de 10 px sur une image 640x480 (diagonale 800) = 1,3 % ; identiques = 0 ; 3 % de seuil de « meme carte »', G.ecartQuadPct([[0, 0], [100, 0], [100, 100], [0, 100]], [[10, 0], [100, 0], [100, 100], [0, 100]], [640, 480]) === 1.3 && G.ecartQuadPct([[1, 2], [3, 4], [5, 6], [7, 8]], [[1, 2], [3, 4], [5, 6], [7, 8]], [640, 480]) === 0 && G.ecartQuadPct([[0, 0], [100, 0], [100, 100], [0, 100]], [[24, 0], [100, 0], [100, 100], [0, 100]], [640, 480]) === 3);
    console.log(`${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})();
