'use strict';
// SAUVEGARDES — AES-256-GCM en flux. Format d'un objet : « RMSAV1\0 » (7 octets) · nonce aléatoire (12) · texte chiffré · étiquette GCM (16).
// Le nonce est tiré au hasard à chaque objet (clé de 32 octets, objets peu nombreux : la marge de GCM est énorme) ; le contexte (aad) lie l'objet à sa base, sa sauvegarde et son nom.
// 🔑 L'ÉTIQUETTE EST VÉRIFIÉE AVANT TOUTE UTILISATION : le déchiffrement écrit dans un fichier de travail, vérifie l'étiquette à la fin, et SUPPRIME le fichier si elle ne tient pas.
// Rien n'est jamais rendu à l'appelant (ni analysé, ni inséré) avant ce contrôle.
const crypto = require('crypto');
const fs = require('fs');
const { refuser } = require('./erreurs');

const MAGIE = Buffer.from('RMSAV1\0', 'latin1'), NONCE = 12, ETIQUETTE = 16, EN_TETE = MAGIE.length + NONCE;

/** La clé, 64 chiffres hexadécimaux = 32 octets. Écrit par ce qu'il AUTORISE. */
function cleDepuisHex(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex.trim())) refuser('cle-invalide');
    return Buffer.from(hex.trim(), 'hex');
}

/** @param {AsyncIterable<Buffer>} source @returns {AsyncGenerator<Buffer>} */
async function* chiffrer(source, { cle, aad }) {
    if (!Buffer.isBuffer(cle) || cle.length !== 32) refuser('cle-invalide');
    const nonce = crypto.randomBytes(NONCE);
    const c = crypto.createCipheriv('aes-256-gcm', cle, nonce, { authTagLength: ETIQUETTE });
    c.setAAD(aad);
    yield Buffer.concat([MAGIE, nonce]);
    for await (const morceau of source) { const o = c.update(morceau); if (o.length) yield o; }
    const fin = c.final(); if (fin.length) yield fin;
    yield c.getAuthTag();
}

/** Déchiffre vers un fichier de travail ; lève (et supprime le fichier) si l'étiquette ne tient pas. @returns {{octets:number}} */
async function dechiffrerVersFichier(source, chemin, { cle, aad }) {
    if (!Buffer.isBuffer(cle) || cle.length !== 32) refuser('cle-invalide');
    const sortie = fs.createWriteStream(chemin, { flags: 'wx', mode: 0o600 });
    let ouvert = true, erreurSortie = null;
    sortie.on('error', e => { erreurSortie = e; });
    const ecrire = (b) => new Promise((res, rej) => { if (erreurSortie) return rej(erreurSortie); sortie.write(b, e => (e ? rej(e) : res())); });
    const fermer = () => new Promise(res => { if (!ouvert) return res(); ouvert = false; sortie.end(res); });
    const nettoyer = async () => { await fermer(); try { fs.rmSync(chemin, { force: true }); } catch { /* déjà absent */ } };
    try {
        let tete = Buffer.alloc(0), decipher = null, queue = Buffer.alloc(0), octets = 0;
        for await (const m of source) {
            let b = Buffer.from(m);
            if (!decipher) {
                tete = Buffer.concat([tete, b]);
                if (tete.length < EN_TETE) continue;
                if (!tete.subarray(0, MAGIE.length).equals(MAGIE)) refuser('format-inconnu');
                decipher = crypto.createDecipheriv('aes-256-gcm', cle, tete.subarray(MAGIE.length, EN_TETE), { authTagLength: ETIQUETTE });
                decipher.setAAD(aad);
                b = tete.subarray(EN_TETE);
            }
            if (!b.length) continue;
            const tout = Buffer.concat([queue, b]);
            if (tout.length <= ETIQUETTE) { queue = tout; continue; }
            const donnees = tout.subarray(0, tout.length - ETIQUETTE);
            queue = Buffer.from(tout.subarray(tout.length - ETIQUETTE));
            const clair = decipher.update(donnees);
            octets += clair.length;
            if (clair.length) await ecrire(clair);
        }
        if (!decipher) { if (tete.length >= MAGIE.length && !tete.subarray(0, MAGIE.length).equals(MAGIE)) refuser('format-inconnu'); refuser('etiquette-refusee'); }
        if (queue.length !== ETIQUETTE) refuser('etiquette-refusee');
        decipher.setAuthTag(queue);
        try { const fin = decipher.final(); if (fin.length) { await ecrire(fin); octets += fin.length; } }
        catch (e) { if (e && e.code === 'ERR_CRYPTO_INVALID_AUTH_TAG' || /authenticate|auth/i.test(String(e && e.message))) refuser('etiquette-refusee'); throw e; }
        await fermer();
        if (erreurSortie) throw erreurSortie;
        return { octets };
    } catch (e) {
        await nettoyer();
        throw e;
    }
}

/** Déchiffre en mémoire (le manifeste seulement : petit, plafonné par `max`) ; l'étiquette est vérifiée avant de rendre quoi que ce soit. */
async function dechiffrerVersBuffer(source, { cle, aad, max = 64 * 1024 * 1024 }) {
    if (!Buffer.isBuffer(cle) || cle.length !== 32) refuser('cle-invalide');
    const morceaux = []; let total = 0;
    for await (const m of source) { total += m.length; if (total > max + EN_TETE + ETIQUETTE) refuser('trop-grand'); morceaux.push(Buffer.from(m)); }
    const tout = Buffer.concat(morceaux);
    if (tout.length < EN_TETE + ETIQUETTE) { if (tout.length >= MAGIE.length && !tout.subarray(0, MAGIE.length).equals(MAGIE)) refuser('format-inconnu'); refuser('etiquette-refusee'); }
    if (!tout.subarray(0, MAGIE.length).equals(MAGIE)) refuser('format-inconnu');
    const d = crypto.createDecipheriv('aes-256-gcm', cle, tout.subarray(MAGIE.length, EN_TETE), { authTagLength: ETIQUETTE });
    d.setAAD(aad); d.setAuthTag(tout.subarray(tout.length - ETIQUETTE));
    try { return Buffer.concat([d.update(tout.subarray(EN_TETE, tout.length - ETIQUETTE)), d.final()]); }
    catch { refuser('etiquette-refusee'); }
}
module.exports = { cleDepuisHex, chiffrer, dechiffrerVersFichier, dechiffrerVersBuffer, MAGIE };
