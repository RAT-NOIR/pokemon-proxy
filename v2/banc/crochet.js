'use strict';
// B6.4 — le crochet du banc réel dans /api/identifier et /api/identifier/reponse. Appelé APRÈS la réponse calculée : il ne rend rien, n'est jamais attendu,
// ne lève jamais, et sa sortie n'entre dans aucune réponse (les corps de B1b sont identiques avec et sans banc).
// Écrit par ce qu'il AUTORISE : on ne conserve que si (1) le corps porte un consentement valide, (2) un crochet `deps.detection` est branché (ABSENT en
// production : tant que le serveur ne détecte pas la carte, rien n'est conservé), (3) la requête est UNE carte — un LOT ne conserve rien : la détection
// juge une carte, pas une pile —, (4) le verdict est ferme (`identifiee`) ou une question (`a-trancher`). Tout le reste : rien, sans bruit.
// `deps.detection({ scanId, imageUrls })` → Promise<{ imageRedressee: Buffer, detectionSure: boolean, versionModele?: string } | null>.
// Il n'est appelé qu'APRÈS un consentement valide : sans consentement, la photo n'est même pas regardée.
const registre = require('../registre');
const { lireConsentement } = require('./consentement');

const journal = (ou, e) => console.error(`❌ [v2 banc-crochet] ${ou} (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message

/**
 * Le consentement ouvre-t-il la conservation POUR CETTE REQUÊTE ? Valide (B6.1) ET — écrit par ce qu'on autorise — d'une empreinte DIFFÉRENTE de celle du jeton d'accès
 * du porteur : un client qui enverrait son jeton Bearer comme `consentementBanc.jeton` donnerait à ses lignes la MÊME empreinte que `installations.jetonEmpreinte`
 * (même sha256), donc relierait le banc à l'installation. Sans porteur lisible on ne conclut pas : refus. Rien n'est dit au client (comme un consentement invalide).
 */
function consentementAutorise(req, cfg) {
    try {
        const c = lireConsentement(req && req.body, cfg);
        if (!c.valide) return false;
        const p = req && req.v2 && req.v2.porteur;
        if (!p) return false;
        const acces = [p.installation && p.installation.jetonEmpreinte, req.v2.session && req.v2.session.tokenEmpreinte].filter(x => typeof x === 'string' && x);
        return acces.every(e => e !== c.jetonEmpreinte);
    } catch { return false; }
}

/** Après /api/identifier.`analyse` est celle de la réponse ; `req.entree.imageUrls` les images de l'annonce. Rend undefined, tout de suite. */
function apresIdentifier({ cfg, deps, req, scanId, analyse }) {
    try {
        if (!deps || typeof deps.detection !== 'function') return;                         // la production d'aujourd'hui : rien n'est conservé
        if (!consentementAutorise(req, cfg)) return;                                        // sans consentement valide (et distinct du jeton d'accès) : ni détecteur, ni ligne, ni objet
        if (!analyse || analyse.statut === 'lot' || !Array.isArray(analyse.cartes) || analyse.cartes.length !== 1) return;   // un lot ne conserve rien
        const c = analyse.cartes[0];
        let issue, idProduct = null;
        if (c.statut === 'identifiee' && c.carte && Number.isSafeInteger(c.carte.idProduct) && c.carte.idProduct > 0) { issue = 'affirmee'; idProduct = c.carte.idProduct; }
        else if (c.statut === 'a-trancher') issue = 'question';
        else return;                                                                        // introuvable, panne : rien
        let banc; try { banc = registre.obtenir('banc'); } catch { return; }                // aucun banc fourni : rien, sans bruit
        const id = String(scanId);
        const imageUrls = Array.isArray(req.entree && req.entree.imageUrls) ? [...req.entree.imageUrls] : [];
        Promise.resolve().then(() => deps.detection({ scanId: id, imageUrls })).then(d => {
            if (!d || d.detectionSure !== true || !Buffer.isBuffer(d.imageRedressee)) return;
            return banc.apresVerdict({ corps: req.body, scanId: id, carte: 0, issue, idProduct, imageRedressee: d.imageRedressee, detectionSure: true, versionModele: d.versionModele });
        }).catch(e => journal('détection ou écriture', e));
    } catch (e) { journal('apresIdentifier', e); }
}

/** Après /api/identifier/reponse, une fois le porteur vérifié et la réponse acceptée. `idProduct` : celui du choix (null pour un abandon). */
function apresReponse({ cfg, req, scanId, carte, choix, idProduct }) {
    try {
        let banc; try { banc = registre.obtenir('banc'); } catch { return; }                // aucun banc fourni : rien, sans bruit
        // un abandon ne demande aucun consentement (effacer n'est jamais conserver) ; une confirmation, si : valide et distinct du jeton d'accès
        const abandon = choix === 'aucune' || choix === 'ne-sait-pas';
        if (!abandon && !consentementAutorise(req, cfg)) return;
        Promise.resolve(banc.apresReponse({ corps: req && req.body, scanId: String(scanId), carte, choix, idProduct })).catch(e => journal('apresReponse', e));
    } catch (e) { journal('apresReponse', e); }
    void cfg;
}

module.exports = { apresIdentifier, apresReponse, consentementAutorise };
