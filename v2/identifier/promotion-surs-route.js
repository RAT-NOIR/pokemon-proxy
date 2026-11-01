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

/**
 * L'ÉTAPE des leviers ET la décision de la promotion, telles que la route les enchaîne (relecture I4 : exécutable par un banc, sans base). Drapeau éteint, le résultat est EXACTEMENT celui de l'étape seule :
 * `resultat = lv.resultat || resultat`, `probableDecide = lv.probable`, la trace des marqueurs et la trace de promotion inchangées.
 * @param noter   (resultat) => void : la route y note la dernière QUESTION vue (celle que la garde des marqueurs rend si elle refuse le sûr)
 * @param appliquer  l'étape (leviers-abde.js::appliquerLeviers par défaut, injectable en banc)
 * @returns { resultat, probableDecide, traceMarqueurs, tracePromotion }
 */
async function etapeLeviers({ cfg, entree, resultat, c, produits, version, traceMarqueurs = null, catalogue, ctxQuestion, memo, noter = () => { }, affirmer, marqueurs, journal = () => { }, appliquer = require('./leviers-abde').appliquerLeviers, etat } = {}) {
    let res = resultat, probableDecide = null, tm = traceMarqueurs, tracePromotion = null;
    const lv = await appliquer({ cfg, entree, resultat, corpsChaine: c, produits, version, traceMarqueurs, catalogue, ctxQuestion, memo, ...(etat ? { etat } : {}) });
    if (lv) {
        if (lv.resultat) res = lv.resultat;
        probableDecide = lv.probable;
        if (lv.promotion) {
            noter(res);
            const pr = promouvoirDansLaRoute({ cfg, lv, journal, affirmer, marqueurs });
            if (pr) {
                tracePromotion = pr.trace;
                if (pr.resultat) { res = pr.resultat; probableDecide = null; if (pr.traceMarqueurs) tm = pr.traceMarqueurs; }       // la trace de la première garde n'est écrasée que par un sûr CONFIRMÉ (relecture M2)
                else if (pr.traceMarqueurs) tracePromotion = { ...pr.trace, marqueurs: pr.traceMarqueurs };
            }
        }
    }
    return { resultat: res, probableDecide, traceMarqueurs: tm, tracePromotion };
}

module.exports = { promouvoirDansLaRoute, etapeLeviers };
