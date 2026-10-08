'use strict';
// Liste FERMÉE des codes (CONTRAT-2 §5 + ajouts additifs du plan, §5 Q12/Q13). Un code absent d'ici ne sort jamais.
const CODES = Object.freeze({
    JETON: 401, VERIFICATION: 403, QUOTA: 429, DEBIT: 429, INDISPONIBLE: 503, IMAGE: 200, IA: 200, SERVEUR: 500, VERSION: 426, MARCHE: 422,
    SESSION: 401, ORIGINE: 403, IDENTIFIANTS: 401, MOT_DE_PASSE_FAIBLE: 422, CODE_INVALIDE: 404, CODE_EXPIRE: 410, DEJA_LIE: 409,
    CONFLIT: 409, CREDITS_ACHETES: 409, ENTREE: 400
});
function corpsErreur(code, message, extra = {}) {
    if (!Object.hasOwn(CODES, code)) throw new Error(`code d'erreur inconnu : ${code}`);
    const erreur = { code, message };
    if (extra.detail !== undefined) erreur.detail = extra.detail;
    if (extra.reessayerDans !== undefined) erreur.reessayerDans = extra.reessayerDans;
    const corps = { success: false, erreur, facturation: extra.facturation ?? null };
    if (extra.solde !== undefined) corps.solde = extra.solde;
    if (extra.achat !== undefined) corps.achat = extra.achat;
    return corps;
}
function repondreErreur(res, code, message, extra = {}, statut) {
    const corps = corpsErreur(code, message, extra);
    if (extra.reessayerDans !== undefined && typeof res.setHeader === 'function') res.setHeader('Retry-After', String(extra.reessayerDans));
    return res.status(statut ?? CODES[code]).json(corps);
}
module.exports = { CODES, corpsErreur, repondreErreur };
