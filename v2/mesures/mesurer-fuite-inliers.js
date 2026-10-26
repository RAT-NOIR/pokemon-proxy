'use strict';
// FUITE-INLIERS — le banc LONG de inliers() : N tours (deux appels chacun) sur deux photos réelles du dépôt (verrou/photos) ou, à défaut, deux cartes fabriquées ; aucun réseau.
//   node v2/mesures/mesurer-fuite-inliers.js [--appels=5000] [--pas=500] [--sortie=f.json]      (FUITE_INLIERS_MODULE=<chemin> pour juger un autre departage-image.js, relatif à ce fichier)
// Rend : un relevé tous les `pas` tours (mémoire WASM, objets C++ vivants, RSS, tas JS), puis les PENTES en Ko par appel d'inliers() mesurées après la chauffe (100 tours).
// Code de sortie 1 si la borne de pente-inliers.js tombe (croissance WASM > 0 ou objet C++ vivant).
const path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
if (!global.gc) { const r = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status); }
// `--sans-instrument` : l'instrument des vivants (qui retient chaque enveloppe embind dans un Set jusqu'au relevé suivant) n'est pas armé — seuls RSS et tas sont relevés, sans le biais qu'il ajoute.
if (!process.argv.includes('--sans-instrument')) require('../test/_embind-vivants').armer();            // AVANT tout require d'opencv
const P = require('./pente-inliers');
const D = require(process.env.FUITE_INLIERS_MODULE ? path.resolve(__dirname, process.env.FUITE_INLIERS_MODULE) : '../../departage-image');
const N = Number(arg('appels', 5000)), PAS = Number(arg('pas', 500)), SORTIE = arg('sortie', null);
(async () => {
    const r = await P.mesurer({ D, appels: N, pas: PAS, dossier: path.join(__dirname, '..', '..', 'verrou', 'photos') });
    const mo = x => +(x / 1048576).toFixed(1);
    for (const x of r.releves) console.log(JSON.stringify({ tours: x.appels, wasmMo: mo(x.wasm), vivants: x.vivants, rssMo: mo(x.rss), tasMo: mo(x.tas) }));
    const ap = (r.fin.appels - r.chauffe.appels) * 2 || 1;                       // appels d'inliers() entre la chauffe et la fin
    const pente = { wasmKoParAppel: +((r.fin.wasm - r.chauffe.wasm) / 1024 / ap).toFixed(3), vivantsParAppel: +((r.fin.vivants - r.chauffe.vivants) / ap).toFixed(3), tasJsKoParAppel: +((r.fin.tas - r.chauffe.tas) / 1024 / ap).toFixed(3), rssKoParAppel: +((r.fin.rss - r.chauffe.rss) / 1024 / ap).toFixed(3) };
    console.log(`pente après la chauffe, sur ${ap} appels d'inliers() : ${JSON.stringify(pente)} · inliers [différente, identique] : ${JSON.stringify(r.inliers)}`);
    const ok = r.croissanceWasmOctets <= P.BORNE_WASM_OCTETS && r.vivantsMax <= P.BORNE_VIVANTS;
    console.log(`${ok ? '✅' : '🔴'} borne : croissance WASM ${r.croissanceWasmOctets} octets (max ${P.BORNE_WASM_OCTETS}), objets vivants au pire ${r.vivantsMax} (max ${P.BORNE_VIVANTS})`);
    if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify({ releves: r.releves, pente, inliers: r.inliers }, null, 1));
    process.exit(ok ? 0 : 1);
})().catch(e => { console.log('ERREUR', e.stack); process.exit(1); });
