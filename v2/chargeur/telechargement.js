'use strict';
// COTES-VISUELS, tour 1 — le TÉLÉCHARGEMENT de l'archive précalculée sur l'hôte public R2 : lecture seule d'une URL publique, jamais d'identifiant. Écrit par ce qu'il AUTORISE :
// https, l'hôte est l'un des hôtes publics de la configuration, ni identifiant ni port, AUCUNE redirection suivie, un délai, une taille maximale (annoncée ET comptée à la lecture).
// Un refus lève une erreur NOMMÉE (jamais le texte du pilote ni l'URL entière). Le chargeur en fait un échec journalisé ; le prochain essai est le rechargement quotidien.
const TAILLE_MAX = 64 * 1048576, DELAI_MS = 60 * 1000;

class Telechargement extends Error { constructor(motif) { super(motif); this.name = 'Telechargement'; this.motif = motif; } }
const refuser = m => { throw new Telechargement(m); };

/** @param url string ; @param hotes les hôtes publics permis ; @param fetchFn injectable (les bancs : aucun réseau réel) @returns {Promise<Buffer>} */
async function telecharger(url, { hotes, fetchFn = globalThis.fetch, max = TAILLE_MAX, delaiMs = DELAI_MS } = {}) {
    let u; try { u = new URL(url); } catch { refuser('adresse illisible'); }
    if (u.protocol !== 'https:') refuser('adresse non https');
    if (u.username || u.password || u.port) refuser('adresse avec identifiant ou port');
    if (!Array.isArray(hotes) || !hotes.includes(u.hostname)) refuser('hôte hors des hôtes publics');
    let r;
    try { r = await fetchFn(u.href, { redirect: 'error', signal: AbortSignal.timeout(delaiMs), headers: { Accept: 'application/gzip, application/octet-stream' } }); }
    catch (e) { refuser(e && e.name === 'TimeoutError' ? 'délai dépassé' : 'réseau indisponible ou redirection refusée'); }
    if (!r || r.status !== 200) refuser(`réponse ${r ? r.status : 'absente'} (attendu 200)`);
    const annonce = Number(r.headers && r.headers.get ? r.headers.get('content-length') : NaN);
    if (Number.isFinite(annonce) && annonce > max) refuser('fichier plus grand que la taille permise (annoncée)');
    const morceaux = []; let total = 0;
    try {
        for await (const m of r.body) { total += m.length; if (total > max) refuser('fichier plus grand que la taille permise (lue)'); morceaux.push(Buffer.from(m)); }
    } catch (e) { if (e instanceof Telechargement) throw e; refuser('lecture interrompue'); }
    if (total === 0) refuser('fichier vide');
    return Buffer.concat(morceaux, total);
}
module.exports = { telecharger, Telechargement, TAILLE_MAX, DELAI_MS };
