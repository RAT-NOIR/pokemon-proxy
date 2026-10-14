'use strict';
// Scellé d'une réponse d'idempotence qui porte un JETON (installation, liaison). La base n'a jamais de jeton en clair (seule son empreinte, installations.jetonEmpreinte) : la réponse
// conservée 24 h pour le rejeu serait sinon le seul endroit où un jeton vivant dormirait en clair. AES-256-GCM, clé dérivée du secret du serveur (V2_SECRET_EMPREINTE), et le claim
// (`cle`, qui nomme le porteur, la route et la clé) lié comme donnée authentifiée : une réponse scellée recopiée sous un autre claim ne s'ouvre pas.
// Écrit par ce qu'il AUTORISE : tout ce qui n'est pas un scellé valide LÈVE, jamais un repli sur le texte brut.
const crypto = require('crypto');
const PREFIXE = 'sc1.';
const cleDe = secret => {
    if (typeof secret !== 'string' || secret.length < 16) throw new Error('scellé : secret absent ou trop court');
    return crypto.createHash('sha256').update(`rm-idempotence-scelle|${secret}`).digest();
};
function fermer(texte, secret, claim) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', cleDe(secret), iv);
    c.setAAD(Buffer.from(String(claim), 'utf8'));
    const ct = Buffer.concat([c.update(String(texte), 'utf8'), c.final()]);
    return PREFIXE + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function ouvrir(scelle, secret, claim) {
    if (typeof scelle !== 'string' || !scelle.startsWith(PREFIXE)) throw new Error('scellé : forme inconnue');
    const b = Buffer.from(scelle.slice(PREFIXE.length), 'base64url');
    if (b.length < 29) throw new Error('scellé : trop court');
    const d = crypto.createDecipheriv('aes-256-gcm', cleDe(secret), b.subarray(0, 12));
    d.setAAD(Buffer.from(String(claim), 'utf8')); d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
module.exports = { fermer, ouvrir, PREFIXE };
