'use strict';
// COTES-VISUELS, tour 2 — l'AUTHENTICITÉ de l'archive : un HMAC-SHA256 (secret partagé producteur / API, variable V2_VISUELS_HMAC) posé sur l'archive compressée. Le sha256 interne de format.js
// prouve l'intégrité, pas que le fichier vient du producteur : qui sait écrire l'objet fabrique un fichier cohérent. Le HMAC est vérifié AVANT toute décompression (un faux HMAC n'ouvre rien).
//   RMVS | archive gzip | HMAC-SHA256(secret, RMVS | archive gzip) (32 octets)
// Écrit par ce qu'il AUTORISE : taille, magie, longueur du secret, puis comparaison à temps constant. Un refus est un FormatInvalide nommé (échec de chargement : l'ancienne version reste).
const crypto = require('crypto');
const { FormatInvalide, PLAFONDS } = require('./format');

const MAGIE = Buffer.from('RMVS'), TAG = 32, SECRET_MIN = 32;
const secretValide = s => typeof s === 'string' && s.length >= SECRET_MIN;
const refuser = m => { throw new FormatInvalide(m); };
const hmac = (secret, corps) => crypto.createHmac('sha256', secret).update(corps).digest();

function sceller(archive, secret) {
    if (!secretValide(secret)) refuser(`secret HMAC absent ou trop court (${SECRET_MIN} caractères au moins)`);
    if (!Buffer.isBuffer(archive)) refuser('ce n\'est pas un tampon');
    const corps = Buffer.concat([MAGIE, archive]);
    return Buffer.concat([corps, hmac(secret, corps)]);
}
/** @returns {Buffer} l'archive gzip, après vérification de la taille, de la magie et du HMAC — avant toute décompression. */
function ouvrir(scelle, secret, { max = PLAFONDS.archive + MAGIE.length + TAG } = {}) {
    if (!secretValide(secret)) refuser(`secret HMAC absent ou trop court (${SECRET_MIN} caractères au moins)`);
    if (!Buffer.isBuffer(scelle)) refuser('ce n\'est pas un tampon');
    if (scelle.length > max) refuser(`objet plus grand que la taille permise (${Math.round(PLAFONDS.archive / 1048576)} Mo compressé)`);
    if (scelle.length < MAGIE.length + TAG + 1) refuser('objet trop court');
    if (!scelle.subarray(0, MAGIE.length).equals(MAGIE)) refuser('magie de scellement fausse');
    const corps = scelle.subarray(0, scelle.length - TAG), tag = scelle.subarray(scelle.length - TAG);
    if (!crypto.timingSafeEqual(hmac(secret, corps), tag)) refuser('HMAC faux : archive non authentique');
    return corps.subarray(MAGIE.length);
}
module.exports = { sceller, ouvrir, secretValide, SECRET_MIN, MAGIE, TAG };
