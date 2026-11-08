'use strict';
// Les six fichiers copiés SANS CHANGEMENT de l'extension v2 (empreinte.js, moteur-ort.js, quatre fichiers d'onnxruntime-web 1.30.0) : empreintes sha256 COMPLÈTES, épinglées dans v2/banc-telephone/copies-extension.json
// (le banc test-banc-telephone-tour1.js les relit), et comparées au DÉPÔT DE L'EXTENSION quand il est présent sur ce poste (les fichiers texte sans leurs fins de ligne CRLF).
//   node outils\banc-telephone\verifier-copies.js            compare les copies, l'épingle et le dépôt de l'extension (code 1 au premier écart)
//   node outils\banc-telephone\verifier-copies.js --ecrire   (ré)écrit l'épingle depuis les copies, APRÈS avoir exigé qu'elles égalent le dépôt de l'extension s'il est présent
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const PUB = path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public');
const EPINGLE = path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'copies-extension.json');
const EXT = 'C:\\Users\\Yung\\Desktop\\extension v2';
const FICHIERS = {
    empreinte: ['empreinte.js', 'src\\calcul\\empreinte.js', true], moteur: ['moteur-ort.js', 'src\\calcul\\moteur-ort.js', true],
    wasmBundle: ['ort\\ort.wasm.bundle.min.mjs', 'dist\\calcul\\ort\\ort.wasm.bundle.min.mjs', true], gpuBundle: ['ort\\ort.webgpu.bundle.min.mjs', 'dist\\calcul\\ort\\ort.webgpu.bundle.min.mjs', true],
    wasm: ['ort\\ort-wasm-simd-threaded.wasm', 'dist\\calcul\\ort\\ort-wasm-simd-threaded.wasm', false], asyncify: ['ort\\ort-wasm-simd-threaded.asyncify.wasm', 'dist\\calcul\\ort\\ort-wasm-simd-threaded.asyncify.wasm', false],
    // la detection deterministe : OpenCV.js du build REDUIT de l'extension (sources dans src\calcul\opencv, jamais modifiees)
    opencvJs: ['opencv\\opencv.js', 'src\\calcul\\opencv\\opencv.js', true], opencvWasm: ['opencv\\opencv_js.wasm', 'src\\calcul\\opencv\\opencv_js.wasm', false]
};
const hacher = (p, texte) => { const b = fs.readFileSync(p); return crypto.createHash('sha256').update(texte ? Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : b).digest('hex'); };
const ecrire = process.argv.includes('--ecrire');
let ko = 0;
const lu = {}, presentExt = fs.existsSync(EXT);
for (const [nom, [copie, source, texte]] of Object.entries(FICHIERS)) {
    lu[nom] = hacher(path.join(PUB, copie), texte);
    if (presentExt) {
        const h = hacher(path.join(EXT, source), texte);
        console.log(`${h === lu[nom] ? 'OK  ' : 'ECART'} ${copie} = extension v2 ${source}`);
        if (h !== lu[nom]) ko++;
    }
}
if (!presentExt) console.log('dépôt de l\'extension absent de ce poste : seule l\'épingle est vérifiée');
if (ecrire) {
    if (ko) { console.error('refus : une copie diffère du dépôt de l\'extension'); process.exit(1); }
    fs.writeFileSync(EPINGLE, JSON.stringify({ note: 'sha256 complets des copies de l\'extension v2 ; fichiers texte empreints sans CRLF ; outils/banc-telephone/verifier-copies.js --ecrire', sha256: lu }, null, 1) + '\n');
    console.log('épingle écrite :', EPINGLE);
} else {
    const ep = JSON.parse(fs.readFileSync(EPINGLE, 'utf8')).sha256;
    for (const nom of Object.keys(FICHIERS)) { const bon = ep[nom] === lu[nom]; console.log(`${bon ? 'OK  ' : 'ECART'} épingle ${nom}`); if (!bon) ko++; }
}
process.exit(ko ? 1 : 0);
