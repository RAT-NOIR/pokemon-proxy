'use strict';
// MODELE-VISUEL-API — la PROMOTION par la règle G : la « règle (b) » de l'issue (2) de la mesure combinée (rat-market-travail\api\mesure-combinee\RAPPORT.md, étude-sans-service\combinee.js).
// Module PUR : aucune base, aucun réseau. Deux fonctions.
//   · evaluerGarde : la garde (2) — le produit que G désigne passe GC.contredire (garde-contradiction.js, appelée telle quelle) avec la LECTURE de la chaîne. Elle dit si elle a pu JUGER,
//     si elle a contredit, et si la lecture est CONCORDANTE (aucun champ lu ne contredit le produit ET au moins un champ lu le confirme : « rien ne contredit » n'est pas « quelque chose concorde »).
//   · arbitrerAvecPromotion : l'arbitrage PRUDENT d'arbitrage-g.js, INCHANGÉ pour une chaîne qui affirme (un désaccord est une question, jamais tranché en silence), plus la PROMOTION : quand la chaîne
//     pose une question (ou rend un introuvable) et que G AFFIRME Q, Q est affirmé SI la garde (2) a pu juger et n'a rien contredit. Écrit par ce qu'il AUTORISE : une garde absente, muette ou mal formée
//     n'autorise rien ; l'introuvable de la chaîne (crédit déjà rendu par elle) ne se promeut que si l'appelant l'autorise (`depuisIntrouvable`), et la route ne l'autorise pas (voir routes.js).
// Rien de recopié : l'arbitrage et la garde sont les modules de production.
const { arbitrer } = require('./arbitrage-g');
const GC = require('./garde-contradiction');

const ACTIONS = Object.freeze(['garder', 'question', 'promouvoir']);
const NON_JUGEABLE = Object.freeze({ jugeable: false, contredit: null, concordante: false, resume: null });

/**
 * @param {{corps: object, gagnant: number, produits: Map}} o   `corps` : la réponse de la chaîne (success true, `carte` + `lectureGarde`) ; `produits` : les lignes du catalogue (le produit de G et le vivier)
 * @returns {{jugeable: boolean, contredit: boolean|null, concordante: boolean, resume: string|null}} — ne lève jamais
 */
function evaluerGarde({ corps, gagnant, produits } = {}) {
    try {
        if (!(produits instanceof Map) || !Number.isInteger(gagnant) || !produits.has(gagnant)) return NON_JUGEABLE;
        const lu = GC.lectureDe(corps);
        if (!lu) return NON_JUGEABLE;                                                  // un refus de la chaîne ne porte pas de lecture : la garde ne peut rien dire
        const r = GC.contredire({ corps, gagnant, produits });
        if (r) return { jugeable: true, contredit: true, concordante: false, resume: r.resume };
        const champs = Object.values(GC.statuts(lu, produits.get(gagnant)));
        return { jugeable: true, contredit: false, concordante: champs.includes('ok') && !champs.includes('ko'), resume: null };
    } catch { return NON_JUGEABLE; }
}

const gardeBienFormee = g => g && typeof g === 'object' && typeof g.jugeable === 'boolean' && typeof g.contredit !== 'undefined' && (g.contredit === null || typeof g.contredit === 'boolean');

/**
 * @param chaine  { issue: 'affirmee'|'question'|'introuvable', ids }
 * @param g       la sortie de decisionRegleG (affirmee | question)
 * @param o       { garde: evaluerGarde(...) du produit de G (nécessaire seulement si la chaîne n'affirme pas et que G affirme), depuisIntrouvable: false }
 * @returns {{action: 'garder'|'question'|'promouvoir', ids?: number[], desaccord: object|null, promotion: boolean, concordante?: boolean}}
 */
function arbitrerAvecPromotion(chaine, g, { garde, depuisIntrouvable = false } = {}) {
    const base = arbitrer(chaine, g);
    if (!chaine || chaine.issue === 'affirmee') return { ...base, promotion: false };
    if (!g || g.issue !== 'affirmee' || !Number.isInteger(g.produit)) return { ...base, promotion: false };
    if (chaine.issue !== 'question' && !(chaine.issue === 'introuvable' && depuisIntrouvable === true)) return { ...base, promotion: false };
    const desaccord = retenue => ({ chaine: chaine.issue, regleG: 'affirmee', retenue, produitsChaine: chaine.ids, produitsRegleG: [g.produit] });
    if (!gardeBienFormee(garde)) return { action: 'garder', desaccord: desaccord('garde-muette'), promotion: false };
    if (garde.jugeable !== true) return { action: 'garder', desaccord: desaccord('garde-muette'), promotion: false };          // une garde qui n'a pas pu juger n'autorise rien
    if (garde.contredit !== false) return { action: 'garder', desaccord: desaccord('garde-contradiction'), promotion: false };   // contredit (true) ou indécis (null) : la chaîne garde sa réponse
    return { action: 'promouvoir', ids: [g.produit], desaccord: desaccord('promotion'), promotion: true, concordante: garde.concordante === true };
}

module.exports = { evaluerGarde, arbitrerAvecPromotion, ACTIONS };
