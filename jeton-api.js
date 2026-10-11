// Jeton partagé extension ⇄ serveur (en-tête `x-jeton`).
// Garde écrite par ce qu'elle AUTORISE : un seul chemin mène à next() — un jeton serveur CONFIGURÉ
// (chaîne non vide après trim) ET un en-tête `x-jeton` de type chaîne qui lui est égal, comparé en
// temps constant. Tout le reste refuse, exception comprise. Jamais de valeur imprimée.
const crypto = require('crypto');

function creerVerifierJeton(valeurDuJeton, journal = console) {
    const attendu = typeof valeurDuJeton === 'string' ? valeurDuJeton.trim() : '';
    const configure = attendu.length > 0;
    const attenduBuf = configure ? Buffer.from(attendu, 'utf8') : null;

    function dire(message) {
        try { journal.error(message); } catch { /* le journal ne doit jamais ouvrir la garde */ }
    }

    return function verifierJeton(req, res, next) {
        try {
            if (!configure) {
                dire('🚫 Requête refusée (503) : JETON_API n\'est pas configuré — les routes protégées sont fermées.');
                return res.status(503).json({ success: false, error: 'Service indisponible : authentification non configurée' });
            }
            const recu = req.headers['x-jeton'];
            if (typeof recu === 'string') {
                const recuBuf = Buffer.from(recu, 'utf8');
                if (recuBuf.length === attenduBuf.length && crypto.timingSafeEqual(recuBuf, attenduBuf)) {
                    return next();
                }
            }
            dire('🚫 Requête refusée (401) : en-tête x-jeton absent ou invalide (JETON_API configuré).');
            return res.status(401).json({ success: false, error: 'Non autorisé' });
        } catch (e) {
            dire('🚫 Requête refusée : erreur pendant la vérification du jeton JETON_API (' + (e && e.name) + ').');
            try { return res.status(401).json({ success: false, error: 'Non autorisé' }); } catch { return undefined; }
        }
    };
}

module.exports = { creerVerifierJeton };
