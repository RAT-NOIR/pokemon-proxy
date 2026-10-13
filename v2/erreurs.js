'use strict';
// Liste FERMÉE des codes (CONTRAT-2 §5 + ajouts additifs du plan, §5 Q12/Q13). Un code absent d'ici ne sort jamais.
const CODES = Object.freeze({
    JETON: 401, VERIFICATION: 403, QUOTA: 429, DEBIT: 429, INDISPONIBLE: 503, IMAGE: 200, IA: 200, SERVEUR: 500, VERSION: 426, MARCHE: 422,
    SESSION: 401, ORIGINE: 403, IDENTIFIANTS: 401, MOT_DE_PASSE_FAIBLE: 422, CODE_INVALIDE: 404, CODE_EXPIRE: 410, DEJA_LIE: 409,
    CONFLIT: 409, CREDITS_ACHETES: 409, ENTREE: 400,
    EN_RECONCILIATION: 409   // B3 tour 5 : clé rejouée dont la ligne de débit attend la réconciliation — ni rejouée ni redébitée, aucun crédit ni remboursement associé
});
// Messages STABLES des codes émis par la couche argent (le texte ne change pas d'un appel à l'autre).
const MESSAGES = Object.freeze({
    EN_RECONCILIATION: 'paiement en cours de réconciliation, réessayer plus tard',
    QUOTA: 'Plus de crédit disponible', VERIFICATION: 'Confirmez votre adresse e-mail pour utiliser vos crédits', DEBIT: 'Requête identique en cours de traitement',
    INDISPONIBLE: 'Service momentanément indisponible', IA: 'La lecture de la carte a échoué', SERVEUR: 'Erreur interne du serveur', ENTREE: 'Requête invalide'
});
function corpsErreur(code, message, extra = {}) {
    if (!Object.hasOwn(CODES, code)) throw new Error(`code d'erreur inconnu : ${code}`);
    // message absent : le message STABLE du code (mineur B3 reporté) — jamais « undefined » dans un corps d'erreur
    const erreur = { code, message: typeof message === 'string' && message ? message : (MESSAGES[code] ?? code) };
    if (extra.detail !== undefined) erreur.detail = extra.detail;
    if (extra.reessayerDans !== undefined) erreur.reessayerDans = extra.reessayerDans;
    const corps = { success: false, erreur, facturation: extra.facturation ?? null };
    if (extra.solde !== undefined) corps.solde = extra.solde;
    // OFFRE-QUOTA : `achat` n'existe plus (la vente est arrêtée) — un appelant qui en passerait un est ignoré, aucun lien de vente ne sort jamais d'un corps d'erreur
    if (extra.offre !== undefined) corps.offre = extra.offre;   // OFFRE-QUOTA : { nom, restant, remiseAZero } — le refus QUOTA joint l'offre (restant 0)
    return corps;
}
function repondreErreur(res, code, message, extra = {}, statut) {
    const corps = corpsErreur(code, message, extra);
    if (extra.reessayerDans !== undefined && typeof res.setHeader === 'function') res.setHeader('Retry-After', String(extra.reessayerDans));
    return res.status(statut ?? CODES[code]).json(corps);
}
module.exports = { CODES, MESSAGES, corpsErreur, repondreErreur };
