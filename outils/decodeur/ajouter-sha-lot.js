'use strict';
// Ajoute à chaque carte de v2/banc-telephone/public/lot.json le champ `rgbSha256` : l'empreinte SHA-256 des octets RGB que PILLOW décode du JPEG de la carte (vérité fabriquée par references-lot.py,
// v2/test/fixtures-decodeur/pil-lot.json). La page compare à cette empreinte le décodage Rat-Market : « identique à la référence » devient un constat fait sur l'appareil.
// Insertion TEXTUELLE après `"id":"vNN",` (le reste du fichier, 8 Mo, ne bouge pas d'un octet) ; idempotent ; refuse si une carte manque.
//   node outils/decodeur/ajouter-sha-lot.js
const fs = require('fs');
const path = require('path');
const lotPath = path.join(__dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'lot.json');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'v2', 'test', 'fixtures-decodeur', 'pil-lot.json'), 'utf8')).cartes;
let t = fs.readFileSync(lotPath, 'utf8');
const lot = JSON.parse(t);
let n = 0;
for (const c of lot.cartes) {
    const r = ref[c.id];
    if (!r || !/^[0-9a-f]{64}$/.test(r.sha256)) throw new Error('empreinte PIL absente pour ' + c.id);
    if (c.rgbSha256) { if (c.rgbSha256 !== r.sha256) throw new Error('empreinte différente déjà posée pour ' + c.id); continue; }
    const motif = `"id":"${c.id}",`;
    if (t.split(motif).length !== 2) throw new Error('motif introuvable ou ambigu : ' + motif);
    t = t.replace(motif, () => `${motif}"rgbSha256":"${r.sha256}",`); n++;
}
const verif = JSON.parse(t);
if (verif.cartes.length !== lot.cartes.length || !verif.cartes.every(c => ref[c.id].sha256 === c.rgbSha256)) throw new Error('vérification finale échouée');
fs.writeFileSync(lotPath, t);
console.log(`${n} cartes complétées, ${lot.cartes.length} au total`);
