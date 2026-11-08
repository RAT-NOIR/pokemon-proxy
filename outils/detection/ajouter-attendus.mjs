// Ajoute au lot compose (fabriquer-lot-detection.py) les ATTENDUS calcules par la chaine node : v2/banc-telephone/public/lot-detection.json.
//   node ajouter-attendus.mjs <lot-sans-attendus.json>
// Les attendus ne valent que par leur CONFRONTATION : le banc node les rejoue (test-detection.js §5) et Chrome les rejoue dans la page (page de banc, test de detection) ; sur un telephone, c'est la page qui compare.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chargerCv } from './chaine-node.mjs';
const ICI = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ICI, '..', '..', 'v2', 'banc-telephone', 'public');
const D = await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href);
const cv = await chargerCv();
const lot = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const im of lot.images) {
  const r = D.detecter(cv, new Uint8Array(Buffer.from(im.b64, 'base64')));
  im.attendu = { redressee: r.redressee, nCartes: r.nCartes, quad: r.quad, dim640: r.dim640, voie: r.voie, empreintes: r.empreintes };
  console.log(im.id, im.format, im.largeur + 'x' + im.hauteur, '->', r.dim640.join('x'), r.voie, 'cartes', r.nCartes, r.redressee ? 'redressee' : 'NON REDRESSEE');
}
lot.detection = D.VERSION_DETECTION;
fs.writeFileSync(path.join(PUB, 'lot-detection.json'), JSON.stringify(lot));
console.log('ecrit', fs.statSync(path.join(PUB, 'lot-detection.json')).size, 'octets');
process.exit(0);
