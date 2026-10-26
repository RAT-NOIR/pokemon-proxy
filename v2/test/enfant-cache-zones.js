'use strict';
// CACHE-ZONES — l'ENFANT de test-cache-zones.js : charge ratmarket/zones.js sous l'environnement que son parent a posé (RM_CACHE_SCANS, RM_CACHE_PAIRES) et imprime, en JSON sur la dernière ligne,
// les bornes lues et ce que les caches deviennent sous une série de scans FABRIQUÉS (graine fixe, aucun fichier, aucun réseau). Un chargement qui lève sort avec le message de l'erreur.
const sharp = require('sharp');
const Z = require(process.env.CACHE_ZONES_MODULE || '../../ratmarket/zones');   // CACHE_ZONES_MODULE : réservé au lanceur de mutants
const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
function fabriquer(seed, l = 420, h = 587) {
    const r = graine(seed), b = Buffer.alloc(l * h * 3, 128);
    for (let k = 0; k < 260; k++) {
        const x0 = Math.floor(r() * (l - 20)), y0 = Math.floor(r() * (h - 20)), w = 8 + Math.floor(r() * 70), hh = 8 + Math.floor(r() * 70), c = Math.floor(r() * 256);
        for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = x0; x < Math.min(l, x0 + w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = c; }
    }
    return b;
}
const png = b => sharp(b, { raw: { width: 420, height: 587, channels: 3 } }).png().toBuffer();
(async () => {
    const sortie = { CACHE_SCANS: Z.CACHE_SCANS, CACHE_PAIRES: Z.CACHE_PAIRES };
    if (process.argv.includes('--remplir')) {
        const src = {}; for (let i = 0; i < 7; i++) src[i] = { cle: 's' + i, octets: await png(fabriquer(100 + i)) };
        for (let i = 0; i < 6; i++) await Z.scan(src[i]);
        sortie.scansApres6 = [...Z._scans.keys()];
        await Z.scan(src[2]);                                   // s2 vient d'être servi : il ne doit plus être le prochain à partir
        await Z.scan(src[6]);
        sortie.scansApres7 = [...Z._scans.keys()];
        const photo = await Z.photoGrise(fabriquer(100), 420, 587);
        try { for (let i = 0; i < 5; i++) await Z.comparerPaire(photo, src[i], src[i + 1]); } finally { photo.delete(); }
        sortie.paires = [...Z._paires.keys()];
        sortie.scansFin = Z._scans.size;
    }
    console.log(JSON.stringify(sortie));
})().catch(e => { console.error('ERREUR_ENFANT ' + e.message); process.exit(3); });
