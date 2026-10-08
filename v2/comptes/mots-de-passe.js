'use strict';
const crypto = require('crypto'), { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const PARAMS = { n: 32768, r: 8, p: 1, longueur: 64 };
const OPTIONS = { N: PARAMS.n, r: PARAMS.r, p: PARAMS.p, maxmem: 64 * 1024 * 1024 };  // 128*N*r = 32 Mio = la limite par défaut de Node : sans maxmem, scrypt LÈVE
function politique(mdp, emailCle) {
    const n = [...String(mdp ?? '')].length;
    if (n < 10) return 'trop-court';
    if (n > 200) return 'trop-long';
    if (emailCle && String(mdp).toLowerCase() === emailCle) return 'egal-a-l-adresse';
    return null;
}
async function hacher(mdp) {
    const sel = crypto.randomBytes(16);
    const hash = await scrypt(String(mdp).normalize('NFKC'), sel, PARAMS.longueur, OPTIONS);
    return { algo: 'scrypt', n: PARAMS.n, r: PARAMS.r, p: PARAMS.p, sel: sel.toString('hex'), hash: hash.toString('hex') };
}
async function verifier(mdp, rec) {
    if (!rec || rec.algo !== 'scrypt' || !rec.sel || !rec.hash) return false;
    try {
        const attendu = Buffer.from(rec.hash, 'hex');
        if (!attendu.length) return false;
        const obtenu = await scrypt(String(mdp).normalize('NFKC'), Buffer.from(rec.sel, 'hex'), attendu.length, { ...OPTIONS, N: rec.n, r: rec.r, p: rec.p });
        return obtenu.length === attendu.length && crypto.timingSafeEqual(obtenu, attendu);
    } catch { return false; }
}
const SEL_FACTICE = Buffer.alloc(16, 7);
async function verifierFactice(mdp) { await scrypt(String(mdp).normalize('NFKC'), SEL_FACTICE, PARAMS.longueur, OPTIONS); return false; }
module.exports = { politique, hacher, verifier, verifierFactice };
