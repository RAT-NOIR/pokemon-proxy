'use strict';
// INST-BANC — l'exemption de la limite « 2 installations par IP et par jour » (`inst-ip`) du compte de mesure et (COMPTE-TEST, plus bas) du compte de test ordinaire, et d'eux seuls. Écrite par ce qu'elle AUTORISE.
// Pour le compte de MESURE, un seul chemin mène à « exempté » :
//   1. le drapeau est allumé (cfg.installationBancExempte, V2_INSTALLATION_BANC_EXEMPTE=1, éteint par défaut) ;
//   2. la requête porte les en-têtes DU SITE (Origin exacte + X-Rat-Market, comme les routes de compte) et aucun Bearer : un navigateur tiers ne les produit pas, et un cookie seul ne suffit pas ;
//   3. une SESSION de compte valide, résolue par resoudrePorteur (la fonction des routes de compte, jamais une copie) : cookie connu, non expiré, génération du compte égale, compte confirmé ;
//   4. le compte, LU EN BASE par cette même résolution pendant la requête (jamais dans le cookie), est à la fois `banc === true`, `role === 'administrateur'` et `verifie === true`.
// Tout le reste — session absente, expirée, révoquée, compte non banc, lecture en échec, exception — rend `null` : la limite d'aujourd'hui s'applique. Aucune variable, aucun en-tête, aucun paramètre ni
// aucun champ du corps ne déclenche l'exemption à lui seul. Le limiteur horaire `inst-req-ip` et l'idempotence restent pour tout le monde, banc compris (ils précèdent cette garde dans la route).
// COMPTE-TEST (01/11) — la liste fermée compte DEUX comptes de banc, et pas un de plus : le compte de MESURE (banc + administrateur, ci-dessus) et le compte de TEST ORDINAIRE, que ce fichier reconnaît ainsi :
//   · l'adresse réservée `banc-ordinaire@rat-market.invalid` (domaine .invalid, RFC 2606) ET les deux marques `banc === true` et `bancOrdinaire === true`, posées par v2/admin/compte-essai.js --banc --ordinaire sur l'essai seulement
//     (jamais l'adresse seule, jamais une marque seule) ; confirmé ; AUCUN rôle (un compte qui porte un rôle, même faux, n'y est pas) ;
//   · et la base RÉELLE connectée est celle de l'essai (`rm_essai`, ou `test_scratch` sous BANC_ISOLE=1 pour les bancs) : en production, ou sur toute autre base, ce compte n'est pas exempté (l'exemption est inopérante).
// Cette exemption ne vaut QUE pour la limite d'installations : le compte de test garde ses débits, quotas, plafonds et sa surface de compte gratuit ordinaire.
const { resoudrePorteur } = require('../porteur'); const S = require('../comptes/sessions'); const { emailCle } = require('../comptes/email-cle');
const ADRESSE_ORDINAIRE = 'banc-ordinaire@rat-market.invalid';

/** Le nom de la base RÉELLEMENT connectée (jamais une étiquette de configuration). Peut lever : l'appelant traite toute exception comme « pas la base de l'essai ». */
const nomBaseReelle = () => require('../db').base().databaseName;
/** La base de l'essai, d'après son nom (pure). `test_scratch` n'est admise que sous BANC_ISOLE=1 (un nom n'est pas une preuve : il existe aussi sur la production). */
function baseDeLEssai(nom, env = process.env) { return nom === 'rm_essai' || (nom === 'test_scratch' && env && env.BANC_ISOLE === '1'); }
/** Le compte de test ordinaire, lu en base (pure) : les deux marques strictes, l'adresse réservée, confirmé, aucun rôle. */
function estCompteDeTestOrdinaire(c) {
    return Boolean(c) && c.banc === true && c.bancOrdinaire === true && c.verifie === true && (c.role === undefined || c.role === null) && typeof c.emailCle === 'string' && c.emailCle === emailCle(ADRESSE_ORDINAIRE);
}

/** @returns {(req) => Promise<string|null>} l'identifiant (texte) du compte de mesure ou du compte de test ordinaire qui peut être exempté, sinon null — jamais d'exception. `deps.nomBase` : la lecture du nom de la base (un banc l'injecte). */
function exemptionBanc(cfg, deps = {}) {
    const resoudre = resoudrePorteur(cfg);
    const nomBase = deps && typeof deps.nomBase === 'function' ? deps.nomBase : nomBaseReelle;
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
            const mesure = c.banc === true && c.role === 'administrateur' && c.verifie === true;
            if (!mesure && !(estCompteDeTestOrdinaire(c) && baseDeLEssai(nomBase()))) return null;     // la lecture du nom qui lève : catch ci-dessous, « pas exempté »
            return String(c._id);
        } catch { return null; }
    };
}
module.exports = { exemptionBanc, ADRESSE_ORDINAIRE, baseDeLEssai, estCompteDeTestOrdinaire };
