'use strict';
// Pose dans app.js les deux images EXIF embarquées (WebP 17 x 9 et JPEG 37 x 29, orientation 6) EXACTEMENT comme dans le jeu de preuve de Pillow (v2/test/fixtures-decodeur/pil-synthetique.json) :
// aucune recopie à la main d'une chaîne base64. Idempotent.   node outils/decodeur/poser-images-exif.js
const fs = require('fs');
const path = require('path');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'v2', 'test', 'fixtures-decodeur', 'pil-synthetique.json'), 'utf8')).cas;
const app = path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'app.js');
let t = fs.readFileSync(app, 'utf8');
for (const [constante, nom] of [['IMG_EXIF_WEBP', 'webp-exif-17x9'], ['IMG_EXIF_JPEG', 'jpeg-exif6-37x29']]) {
    const c = fx.find(x => x.nom === nom);
    const re = new RegExp(`const ${constante} = '[^']*';`);
    if (!re.test(t)) throw new Error('constante absente : ' + constante);
    t = t.replace(re, () => `const ${constante} = '${c.b64}';`);
}
fs.writeFileSync(app, t);
console.log('images EXIF posées');
