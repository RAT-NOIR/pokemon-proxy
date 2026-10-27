'use strict';
// INST-BANC — l'exemption de la limite « 2 installations par IP et par jour » (`inst-ip`) du SEUL compte de mesure. Écrite par ce qu'elle AUTORISE : un seul chemin mène à « exempté ».
//   1. le drapeau est allumé (cfg.installationBancExempte, V2_INSTALLATION_BANC_EXEMPTE=1, éteint par défaut) ;
//   2. la requête porte les en-têtes DU SITE (Origin exacte + X-Rat-Market, comme les routes de compte) et aucun Bearer : un navigateur tiers ne les produit pas, et un cookie seul ne suffit pas ;
//   3. une SESSION de compte valide, résolue par resoudrePorteur (la fonction des routes de compte, jamais une copie) : cookie connu, non expiré, génération du compte égale, compte confirmé ;
//   4. le compte, LU EN BASE par cette même résolution pendant la requête (jamais dans le cookie), est à la fois `banc === true`, `role === 'administrateur'` et `verifie === true`.
// Tout le reste — session absente, expirée, révoquée, compte non banc, lecture en échec, exception — rend `null` : la limite d'aujourd'hui s'applique. Aucune variable, aucun en-tête, aucun paramètre ni
// aucun champ du corps ne déclenche l'exemption à lui seul. Le limiteur horaire `inst-req-ip` et l'idempotence restent pour tout le monde, banc compris (ils précèdent cette garde dans la route).
const { resoudrePorteur } = require('../porteur'); const S = require('../comptes/sessions');

/** @returns {(req) => Promise<string|null>} l'identifiant (texte) du compte de mesure qui peut être exempté, sinon null — jamais d'exception. */
function exemptionBanc(cfg) {
    const resoudre = resoudrePorteur(cfg);
    return async function compteExempte(req) {
        try {
            if (cfg.installationBancExempte !== true) return null;
            if (!(req.headers.origin === cfg.origines.site && req.get('x-rat-market') === '1')) return null;
            if (req.headers.authorization !== undefined) return null;       // une requête d'installation (Bearer) n'est pas une session de site
            if (!S.lireCookie(req)) return null;
            // resoudrePorteur répond lui-même (res) quand sa lecture lève ; ici une réponse n'est jamais envoyée : un res muet note l'échec, et l'échec vaut « pas exempté ».
            const avant = req.v2; let echec = false, suite = false, lu = null;
            const resMuet = { status() { echec = true; return this; }, json() { echec = true; return this; }, setHeader() { } };
            try { await resoudre(req, resMuet, () => { suite = true; }); }
            finally { lu = req.v2; req.v2 = avant; }     // la requête retrouve l'état qu'elle avait : l'identité résolue ici ne sert à rien d'autre
            if (echec || !suite || !lu || !lu.porteur) return null;
            const p = lu.porteur, c = p.compte;
            if (p.type !== 'compte' || p.surface !== 'scanner' || !lu.session || !c) return null;
            if (c.banc !== true || c.role !== 'administrateur' || c.verifie !== true) return null;
            return String(c._id);
        } catch { return null; }
    };
}
module.exports = { exemptionBanc };
