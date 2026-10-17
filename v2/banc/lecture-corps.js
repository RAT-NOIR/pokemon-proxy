'use strict';
// La lecture BORNÉE d'un corps binaire, partagée par POST /api/banc/photo et POST /api/photo (§21 bis : une seule définition, deux routes). Appelée APRÈS toutes les gardes d'avant lecture.
// Lit au plus `longueur` octets (le Content-Length annoncé) et au plus `delaiMs` ms : un client lent est coupé (socket détruite). Rejette avec un `code` : TROP (plus que annoncé), COURT (moins),
// COUPE (le client a coupé), LENT (délai dépassé). Ne journalise rien : le corps n'est jamais écrit nulle part.
function lireCorpsBorne(req, longueur, delaiMs) {
    return new Promise((resolve, reject) => {
        const morceaux = []; let total = 0, fini = false;
        const clore = (f, v) => { if (fini) return; fini = true; clearTimeout(minute); req.removeListener('data', surDonnee); req.removeListener('end', surFin); req.removeListener('error', surErreur); req.removeListener('aborted', surErreur); f(v); };
        const surDonnee = c => { total += c.length; if (total > longueur) { req.pause(); clore(reject, Object.assign(new Error('trop'), { code: 'TROP' })); return; } morceaux.push(c); };
        const surFin = () => (total === longueur ? clore(resolve, Buffer.concat(morceaux, total)) : clore(reject, Object.assign(new Error('court'), { code: 'COURT' })));
        const surErreur = () => clore(reject, Object.assign(new Error('coupe'), { code: 'COUPE' }));
        const minute = setTimeout(() => { if (fini) return; try { req.socket.destroy(); } catch { /* déjà fermée */ } clore(reject, Object.assign(new Error('lent'), { code: 'LENT' })); }, delaiMs);
        minute.unref();
        req.on('data', surDonnee); req.on('end', surFin); req.on('error', surErreur); req.on('aborted', surErreur);
    });
}
module.exports = { lireCorpsBorne };
