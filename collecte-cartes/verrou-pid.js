// ============================================================
// UN VERROU PAR FICHIER DE PID — pour les passes locales planifiées (jamais vérifié par NOM de processus)
// ============================================================
// Le Planificateur de tâches de Windows relance la passe chaque heure : deux passes ne doivent jamais se chevaucher (l'import du catalogue
// peut durer plus d'une heure). Le fichier est créé en exclusivité (flag « wx » : atomique, une seule prise gagne) et porte { pid, hote, depuis }.
// Il est REPRIS seulement si (1) le PID n'existe plus — un processus tué ne libère rien — ou (2) il a plus de `dureeMaxMs` (Windows réutilise
// les PID). Fichier illisible : REFUS (« je ne sais pas » n'est pas une prise). Vérification par PID (signal 0, qui ne tue rien), jamais par nom.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DUREE_MAX_MS = 90 * 60 * 1000;   // deux imports × 30 min de délai maximal (imports-quotidiens.js) + marge

/** Le PID existe-t-il ? signal 0 : aucun effet sur le processus. EPERM = il existe (autre utilisateur). */
function pidVivant(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** @returns {{ok:true}|{ok:false, detenteur?:object, raison:string}} */
function prendre(fichier, { pid = process.pid, maintenant = new Date(), vivant = pidVivant, dureeMaxMs = DUREE_MAX_MS } = {}) {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    const contenu = JSON.stringify({ pid, hote: os.hostname(), depuis: maintenant.toISOString() });
    for (let tentative = 0; tentative < 2; tentative++) {
        try { fs.writeFileSync(fichier, contenu, { flag: 'wx' }); return { ok: true }; }
        catch (e) { if (e.code !== 'EEXIST') return { ok: false, raison: `écriture du verrou impossible : ${e.message}` }; }
        let d;
        try { d = JSON.parse(fs.readFileSync(fichier, 'utf8')); }
        catch (e) { return { ok: false, raison: `fichier de verrou illisible (${e.message}) : je ne sais pas qui le tient, je ne touche à rien` }; }
        if (!Number.isInteger(d?.pid) || !d.depuis || Number.isNaN(Date.parse(d.depuis))) return { ok: false, raison: 'fichier de verrou illisible (champs pid/depuis absents) : je ne touche à rien' };
        const age = maintenant.getTime() - Date.parse(d.depuis);
        if (vivant(d.pid) && age < dureeMaxMs) return { ok: false, detenteur: d, raison: `tenu par le pid ${d.pid} sur ${d.hote} depuis ${Math.round(age / 60000)} min` };
        // détenteur mort, ou verrou périmé : on le retire et on retente UNE fois (si un autre passe devant, la création exclusive le dira)
        try { fs.unlinkSync(fichier); } catch { /* déjà retiré par un autre */ }
    }
    return { ok: false, raison: 'verrou repris par un autre processus pendant la prise' };
}

/** Rend le verrou s'il est à CE pid. @returns {boolean} true si retiré. */
function rendre(fichier, pid = process.pid) {
    try {
        const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        if (d.pid !== pid) return false;
        fs.unlinkSync(fichier);
        return true;
    } catch { return false; }
}

module.exports = { prendre, rendre, pidVivant, DUREE_MAX_MS };
