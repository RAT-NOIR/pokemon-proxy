'use strict';
// LOT STRIPE-V2 — la configuration des abonnements. Le drapeau V2_ABONNEMENTS est ÉTEINT par défaut : il ne s'allume que par « 1 » EXACTEMENT.
// ÉCRITE POUR NE JAMAIS LEVER : un réglage mal écrit ne doit jamais coûter un 503 à toute la v2 (cf. V2_RESOLUTION_CARDMARKET dans config.js). Une variable manquante ou fausse
// rend `pret: false` et la liste de ses NOMS (jamais une valeur) : les routes d'abonnement répondent alors 503, tout le reste de la v2 continue.
//
// Les variables (NOMS seulement ; aucune valeur ne figure dans le dépôt) :
//   V2_ABONNEMENTS            « 1 » allume la route de webhook et les trois routes d'abonnement
//   V2_STRIPE_MODE            « test » ou « live » (OBLIGATOIRE : la clé doit être du même mode, sinon rien ne s'allume)
//   V2_STRIPE_CLE             la clé secrète (sk_test_…/sk_live_…) ou restreinte (rk_…) du mode
//   V2_STRIPE_WEBHOOK_SECRET  le secret de l'endpoint de webhook v2 (whsec_…)
//   V2_STRIPE_PRIX_PRO_MOIS · V2_STRIPE_PRIX_PRO_AN · V2_STRIPE_PRIX_FONDATEURS_MOIS · V2_STRIPE_PRIX_FONDATEURS_AN   les identifiants price_…
//   V2_STRIPE_PORTAIL_CONFIG_PRO · V2_STRIPE_PORTAIL_CONFIG_FONDATEURS   les DEUX configurations du portail client (bpc_…), une par offre : chacune n'expose que les deux prix de SON offre
//                             (un portail unique laisserait un abonné Pro passer au prix Fondateurs sans code ni place). Celle des Fondateurs est facultative ; sans elle l'offre Fondateurs reste FERMÉE.
//   V2_FONDATEURS_PLACES      le nombre de places Fondateurs (100 par défaut, de 1 à 1000)
//   V2_FONDATEURS_CODE        la valeur du code Fondateurs  — OU —  V2_FONDATEURS_CODE_EMPREINTE  son empreinte sha256 en hexadécimal (jamais les deux)
const crypto = require('crypto');

const NOMS = Object.freeze({
    mode: 'V2_STRIPE_MODE', cle: 'V2_STRIPE_CLE', webhook: 'V2_STRIPE_WEBHOOK_SECRET', portail: Object.freeze({ pro: 'V2_STRIPE_PORTAIL_CONFIG_PRO', fondateurs: 'V2_STRIPE_PORTAIL_CONFIG_FONDATEURS' }),
    prix: Object.freeze({ pro: Object.freeze({ mois: 'V2_STRIPE_PRIX_PRO_MOIS', an: 'V2_STRIPE_PRIX_PRO_AN' }), fondateurs: Object.freeze({ mois: 'V2_STRIPE_PRIX_FONDATEURS_MOIS', an: 'V2_STRIPE_PRIX_FONDATEURS_AN' }) }),
    places: 'V2_FONDATEURS_PLACES', code: 'V2_FONDATEURS_CODE', codeEmpreinte: 'V2_FONDATEURS_CODE_EMPREINTE'
});
const PLACES_DEFAUT = 100, PLACES_MAX = 1000;
const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest();
/** La forme canonique d'un code saisi : espaces retirés, majuscules. Le MÊME traitement pour la valeur en variable et pour la saisie. */
const normaliserCode = s => String(s).normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const vide = v => v === undefined || v === null || String(v).trim() === '';

function lireAbonnements(env = process.env) {
    const actif = env.V2_ABONNEMENTS === '1';
    const base = { actif, pret: false, manquantes: [], invalides: [], mode: null, cle: null, webhookSecret: null, portail: { pro: null, fondateurs: null }, prix: { pro: { mois: null, an: null }, fondateurs: { mois: null, an: null } },
        prixParId: {}, fondateurs: { ouvert: false, places: PLACES_DEFAUT, empreinteCode: null }, avertissements: [] };
    if (!actif) return Object.freeze(base);
    const manque = n => base.manquantes.push(n), faux = n => base.invalides.push(n);
    // le mode d'abord : la clé en dépend
    const mode = String(env[NOMS.mode] || '').trim();
    if (!mode) manque(NOMS.mode); else if (mode !== 'test' && mode !== 'live') faux(NOMS.mode); else base.mode = mode;
    const cle = env[NOMS.cle];
    if (vide(cle)) manque(NOMS.cle);
    else if (base.mode && !new RegExp(`^(sk|rk)_${base.mode}_[A-Za-z0-9]+$`).test(String(cle).trim())) faux(NOMS.cle);   // une clé Live sur un service « test » (ou l'inverse) n'allume RIEN
    else if (base.mode) base.cle = String(cle).trim();
    const secret = env[NOMS.webhook];
    if (vide(secret)) manque(NOMS.webhook); else if (!/^whsec_[A-Za-z0-9]+$/.test(String(secret).trim())) faux(NOMS.webhook); else base.webhookSecret = String(secret).trim();
    for (const [offre, nom] of Object.entries(NOMS.portail)) {
        const v = env[nom];
        if (vide(v)) { if (offre === 'pro') manque(nom); continue; }
        if (!/^bpc_[A-Za-z0-9]+$/.test(String(v).trim())) faux(nom); else base.portail[offre] = String(v).trim();
    }
    // deux offres, deux configurations DISTINCTES : la même pour les deux rouvrirait le passage de l'une à l'autre
    if (base.portail.pro && base.portail.pro === base.portail.fondateurs) { faux(NOMS.portail.pro); faux(NOMS.portail.fondateurs); base.portail.pro = base.portail.fondateurs = null; }
    // Pro : obligatoire. Fondateurs : facultatif (ouvert seulement si ses deux prix ET son code sont là).
    for (const offre of ['pro', 'fondateurs']) for (const periode of ['mois', 'an']) {
        const nom = NOMS.prix[offre][periode], v = env[nom];
        if (vide(v)) { if (offre === 'pro') manque(nom); continue; }
        if (!/^price_[A-Za-z0-9]+$/.test(String(v).trim())) { faux(nom); continue; }
        const id = String(v).trim();
        // les quatre prix sont DISTINCTS : deux offres sur le même price_ seraient indiscernables au webhook (on ne devine pas laquelle) — les deux variables sont fausses
        if (base.prixParId[id]) { const autre = base.prixParId[id]; faux(nom); faux(NOMS.prix[autre.offre][autre.periode]); base.prix[autre.offre][autre.periode] = null; delete base.prixParId[id]; continue; }
        base.prix[offre][periode] = id; base.prixParId[id] = { offre, periode };
    }
    // les places
    const places = env[NOMS.places];
    if (!vide(places)) { const n = /^\d+$/.test(String(places).trim()) ? Number(places) : NaN; if (!Number.isInteger(n) || n < 1 || n > PLACES_MAX) faux(NOMS.places); else base.fondateurs.places = n; }
    // le code Fondateurs : la valeur OU l'empreinte, jamais les deux (deux sources = une qui ment)
    const code = env[NOMS.code], emp = env[NOMS.codeEmpreinte];
    if (!vide(code) && !vide(emp)) { faux(NOMS.code); faux(NOMS.codeEmpreinte); }
    else if (!vide(code)) { const n = normaliserCode(code); if (n.length < 6) faux(NOMS.code); else base.fondateurs.empreinteCode = sha256(n).toString('hex'); }   // en hexadécimal : la configuration est gelée en profondeur (un Buffer ne se gèle pas)
    else if (!vide(emp)) { if (!/^[0-9a-f]{64}$/i.test(String(emp).trim())) faux(NOMS.codeEmpreinte); else base.fondateurs.empreinteCode = String(emp).trim().toLowerCase(); }
    base.fondateurs.ouvert = Boolean(base.fondateurs.empreinteCode && base.prix.fondateurs.mois && base.prix.fondateurs.an && base.portail.fondateurs);
    base.pret = base.manquantes.length === 0 && base.invalides.length === 0 && Boolean(base.prix.pro.mois && base.prix.pro.an && base.portail.pro);
    if (!base.pret) base.avertissements.push(`abonnements : configuration incomplète — manquantes : ${base.manquantes.join(', ') || '(aucune)'} ; invalides : ${base.invalides.join(', ') || '(aucune)'}`);
    // la clé et le secret ne s'ÉNUMÈRENT pas : un JSON.stringify(cfg) ou un console.log(cfg) égaré ne les imprime jamais
    for (const k of ['cle', 'webhookSecret']) Object.defineProperty(base, k, { value: base[k], enumerable: false, writable: false, configurable: false });
    Object.defineProperty(base.fondateurs, 'empreinteCode', { value: base.fondateurs.empreinteCode, enumerable: false, writable: false, configurable: false });   // l'empreinte d'un code court se retrouve par force brute
    return Object.freeze(base);
}
/** Le code saisi correspond-il à l'empreinte configurée ? Comparaison à temps constant. */
function codeFondateursValide(saisie, empreinteHex) {
    if (typeof empreinteHex !== 'string' || !/^[0-9a-f]{64}$/.test(empreinteHex) || typeof saisie !== 'string' || saisie.length > 200) return false;
    const n = normaliserCode(saisie);
    return n.length >= 1 && crypto.timingSafeEqual(sha256(n), Buffer.from(empreinteHex, 'hex'));
}
module.exports = { lireAbonnements, codeFondateursValide, normaliserCode, NOMS, PLACES_DEFAUT, PLACES_MAX };
