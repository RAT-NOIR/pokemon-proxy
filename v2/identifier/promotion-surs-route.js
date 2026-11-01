'use strict';
// DECISION-SURS — la DÉCISION de la route : un probable que l'étape des leviers a PROUVÉ promouvable (leviers-abde.js, `promotion`) devient l'AFFIRMATION de ce produit, SI ET SEULEMENT SI l'affirmation se construit ET que la
// garde des marqueurs, relue sur ce SÛR par la même fonction que partout, ne le rend pas à la question. DERRIÈRE V2_PROMOTION_SURS (éteint : rien n'est lu, rien n'est appelé).
// 🔑 Écrite par ce qu'elle AUTORISE : un seul chemin mène à un `resultat` ; tout le reste (affirmation impossible, autre produit, garde qui répond ou qui lève, exception) laisse le probable d'AVANT, sans débit ni
// remboursement de plus : le règlement du crédit réservé est celui de la branche « affirmation » existante de routes.js (critère A), qui ne voit qu'un résultat `affirmee`.
/**
 * @param lv         ce que l'étape des leviers a rendu : { probable, promotion? }
 * @param affirmer   (idProduct, produitsSurcharge, critere) => le résultat d'une AFFIRMATION (adaptateur.affirmerParLaRoute), ou lève
 * @param marqueurs  (resultatAffirme, produits) => la sortie de appliquerMarqueurs (la garde des groupes relue sur ce sûr), ou null
 * @returns null (rien décidé) | { resultat?, traceMarqueurs?, trace } — `resultat` : l'affirmation, SEULEMENT si la preuve est faite
 */
function promouvoirDansLaRoute({ cfg, lv, affirmer, marqueurs, journal = () => { } } = {}) {
    try {
        if (!(cfg && cfg.promotionSurs === true)) return null;
        if (!lv || !lv.probable || !lv.promotion || !Number.isInteger(lv.probable.idProduct)) return null;
        const id = lv.probable.idProduct, p = lv.promotion;
        let aff = null;
        try { aff = affirmer(id, p.lignes, p.critere); } catch (e) { journal('promotion en sûr (affirmation)', e); }
        const c = aff && aff.issue === 'affirmee' && aff.analyse && Array.isArray(aff.analyse.cartes) ? aff.analyse.cartes[0] : null;
        if (!(c && c.carte && c.carte.idProduct === id)) return { trace: { issue: 'non-construite', regle: p.regle, produit: id } };
        let gm;
        try { gm = marqueurs(aff, p.lignes); } catch (e) { journal('promotion en sûr (marqueurs)', e); return { trace: { issue: 'garde-marqueurs-en-erreur', regle: p.regle, produit: id } }; }
        if (gm && gm.resultat) return { traceMarqueurs: gm.trace, trace: { issue: 'garde-marqueurs', regle: p.regle, produit: id } };       // la garde rend le sûr à la question : le probable reste
        return { resultat: aff, ...(gm && gm.trace ? { traceMarqueurs: gm.trace } : {}), trace: { issue: 'sur', regle: p.regle, produit: id, raison: p.raison } };
    } catch (e) { try { journal('promotion en sûr', e); } catch { /* journal muet */ } return null; }
}

module.exports = { promouvoirDansLaRoute };
