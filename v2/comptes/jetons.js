'use strict';
const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const genererJeton = (octets = 32) => crypto.randomBytes(octets).toString('base64url');
const genererCode = (longueur = 6) => Array.from({ length: longueur }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const empreinte = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const egalite = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
module.exports = { genererJeton, genererCode, empreinte, egalite };
