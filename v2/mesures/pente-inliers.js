'use strict';
// FUITE-INLIERS — la mesure de pente de inliers() : N appels sur deux paires FIXES (une différente, une identique), la mémoire WASM et les objets C++ vivants relevés tous les `pas` appels.
// Partagée par le banc court de la suite (v2/test/test-fuite-inliers.js), le banc long (v2/mesures/mesurer-fuite-inliers.js) et les mutants (v2/mesures/muter-fuite-inliers.js).
// ⚠️ À appeler APRÈS `require('../test/_embind-vivants').armer()` : la mémoire WASM se repère à l'instanciation d'opencv.
//
// LE SEUIL, fixé AVANT la correction et justifié : la mémoire WASM ne croît que par pages de 64 Kio. Après la chauffe (100 appels), un code sans fuite la laisse EXACTEMENT constante (mesuré : 0 octet sur
// 10 000 appels) ; une fuite de l'ancien inliers() (≈ 150 DMatchVector copiés par appel, ≈ 8,8 Kio selon le §15 du CLAUDE.md du catalogue) la fait croître de plusieurs pages en quelques dizaines d'appels.
// Borne : 0 octet de croissance WASM et 0 objet C++ vivant après la chauffe. Le RSS n'est PAS jugé ici : il fluctue de plusieurs Mo d'un relevé à l'autre (pages rendues à l'OS, tas JS) ; il est relevé pour mémoire.
const fs = require('fs'), path = require('path');
const V = require('../test/_embind-vivants');

const CHAUFFE = 100;
const BORNE_WASM_OCTETS = 0, BORNE_VIVANTS = 0;

/** Deux descripteurs fixes (ORB sur deux photos réelles du dépôt si `dossier` en porte deux, sinon cartes fabriquées). */
async function paires(D, dossier) {
    const sharp = require('sharp');
    let octets = [];
    try { octets = fs.readdirSync(dossier).filter(x => x.endsWith('.jpg')).sort().slice(0, 2).map(f => fs.readFileSync(path.join(dossier, f))); } catch { /* dossier absent */ }
    if (octets.length < 2) {
        const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
        const fab = seed => { const r = graine(seed), l = 420, h = 587, b = Buffer.alloc(l * h * 3, 128); for (let k = 0; k < 260; k++) { const x0 = Math.floor(r() * (l - 20)), y0 = Math.floor(r() * (h - 20)), w = 8 + Math.floor(r() * 70), hh = 8 + Math.floor(r() * 70), c = Math.floor(r() * 256); for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = x0; x < Math.min(l, x0 + w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = c; } } return b; };
        octets = await Promise.all([11, 12].map(s => sharp(fab(s), { raw: { width: 420, height: 587, channels: 3 } }).png().toBuffer()));
    }
    return [await D.decrire(octets[0]), await D.decrire(octets[1])];
}

/** → { releves, croissanceWasmOctets, vivantsMax, inliers: [différente, identique] } sur `appels` tours (deux inliers par tour). */
async function mesurer({ D, appels, pas = 500, dossier = null, gc = global.gc }) {
    const [a, b] = await paires(D, dossier);
    const { cv } = await D.outils();
    const releves = []; let derniers = null;
    for (let k = 1; k <= appels; k++) {
        derniers = [D.inliers(cv, a, b), D.inliers(cv, a, a)];
        if (k === CHAUFFE || k % pas === 0 || k === appels) {
            if (gc) gc();
            const m = process.memoryUsage();
            releves.push({ appels: k, wasm: V.octetsWasm(), vivants: V.vivants().n, rss: m.rss, tas: m.heapUsed });
        }
    }
    const chauffe = releves.find(r => r.appels === CHAUFFE) || releves[0], fin = releves[releves.length - 1];
    return { releves, croissanceWasmOctets: fin.wasm - chauffe.wasm, vivantsMax: Math.max(...releves.filter(r => r.appels >= CHAUFFE).map(r => r.vivants)), inliers: derniers, chauffe, fin };
}

/** Le jeu de paires FIXE de la preuve d'identité : 5 cartes fabriquées (dont une copie décalée de la première), les 25 paires ordonnées → 25 nombres d'inliers. Rien d'aléatoire. */
async function inliersDuJeuFixe(D) {
    const sharp = require('sharp');
    const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
    const fab = (seed, dx = 0, dy = 0) => { const r = graine(seed), l = 420, h = 587, b = Buffer.alloc(l * h * 3, 128); for (let k = 0; k < 260; k++) { const x0 = Math.floor(r() * (l - 20)), y0 = Math.floor(r() * (h - 20)), w = 8 + Math.floor(r() * 70), hh = 8 + Math.floor(r() * 70), c = Math.floor(r() * 256); for (let y = Math.max(0, y0 + dy); y < Math.min(h, y0 + dy + hh); y++) for (let x = Math.max(0, x0 + dx); x < Math.min(l, x0 + dx + w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = c; } } return b; };
    const png = b => sharp(b, { raw: { width: 420, height: 587, channels: 3 } }).png().toBuffer();
    const cartes = [fab(11), fab(11, 4, 3), fab(12), fab(13), fab(14)];
    const desc = []; for (const c of cartes) desc.push(await D.decrire(await png(c)));
    const { cv } = await D.outils();
    const out = []; for (const a of desc) for (const b of desc) out.push(D.inliers(cv, a, b));
    return out;
}

module.exports = { mesurer, inliersDuJeuFixe, CHAUFFE, BORNE_WASM_OCTETS, BORNE_VIVANTS };
