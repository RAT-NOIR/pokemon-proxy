'use strict';
// CALCUL-CLIENT (2026-10-26, décision de l'éditeur) — les deux moitiés serveur du contrat « calcul client » (DEMANDE-SERVEUR-EXTENSION.md, entrée « API — 26/10 (nuit) ») :
//   · preparerComplement (appelée par POST /api/identifier, V2_MESURES_CLIENT=1, V2_ORB_SERVEUR=0) : une QUESTION que la règle G aurait pu trancher avec des mesures d'image. On dit au client lesquelles calculer
//     (l'ensemble fermé, calcul-client.js), sur quelles références (les visuels publics de l'archive), sous un jeton signé ; on garde dans la ligne `analyses` ce que le second envoi relira ;
//   · traiterMesures (POST /api/identifier/mesures) : les résultats du client, vérifiés (jeton, un seul envoi, forme, bornes, cohérence), la règle G rejouée DESSUS, puis EXACTEMENT l'arbitrage de la voie du vecteur
//     (promotion-g.js : la garde (2) contre la lecture de la chaîne). Une promotion règle la question réservée comme une réponse par ce candidat (argent.repondreQuestion, le chemin de CRITERE-A) : un seul débit.
// Ce que le second envoi ne fait JAMAIS : rétrograder (un sûr, un refus, un « je ne sais pas » ne passent pas ici), désigner un produit hors des candidats de la question, écrire une VÉRITÉ (`cartes.N.reponse`, lue par les
// mesures comme la réponse d'une personne) ni une donnée partagée (banc réel) : un résultat changé par le client ne sert que son auteur (même règle que MODELE-VISUEL-API, routes.js).
// Écrit par ce qu'il AUTORISE : tout doute laisse le premier verdict, `change: false`, sans erreur pour l'utilisateur.
const mongoose = require('mongoose');
const MC = require('./calcul-client');
const RG = require('./regle-g');
const PG = require('./promotion-g');
const G = require('../../ratmarket/decision-g');
const registre = require('../registre');
const { col } = require('../db');
const { repondreErreur } = require('../erreurs');
const { offreSur, avecOffre } = require('../argent/offre-sur');
const { facturation: fabriquerFacturation } = require('../argent/facturation');

const VALIDITE_MS = 120e3, RESULTATS_MAX = MC.MESURES_MAX, FORME_ID = /^[0-9a-f]{24}$/i, OPENCV_MAX = 60, JETON_MAX = 200;
const journalErreur = (ou, e) => console.error(`❌ [v2 mesures] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);   // jamais e.message : il peut citer une donnée
const etatEmpreintes = () => require('./etat-empreintes');
const identiteIndex = courant => (courant && courant.meta && courant.meta.chargeLe instanceof Date && courant.meta.modele
    ? { chargeLe: courant.meta.chargeLe.toISOString(), n: courant.meta.n, modele: courant.meta.modele.sha256 } : null);
const memeIndex = (a, b) => Boolean(a && b && a.chargeLe === b.chargeLe && a.n === b.n && a.modele === b.modele);
const urlDe = (hote, cle) => `https://${hote}/${cle.split('/').map(encodeURIComponent).join('/')}`;

/** Ce que la garde (2) relira de la réponse de la chaîne (garde-contradiction.js::lectureDe, nom-compatible.js::formesLuesDe) : la carte lue, le bloc `lectureGarde`, les candidats (ids). */
function corpsGarde(c) {
    const corps = c && typeof c === 'object' ? c : {};
    return { success: corps.success === true, carte: corps.carte && typeof corps.carte === 'object' ? corps.carte : null,
        lectureGarde: corps.lectureGarde && typeof corps.lectureGarde === 'object' ? corps.lectureGarde : null,
        candidats: Array.isArray(corps.candidats) ? corps.candidats.filter(x => x && Number.isInteger(x.idProduct)).map(x => ({ idProduct: x.idProduct })) : [] };
}

/**
 * Le complément d'une question (phase 1). null : rien à demander (aucune mesure, plus de 12, voie « plus de 3 produits », index absent, configuration incomplète).
 * @returns {{ public: {jeton, expireDans, mesures, references}, stocke: object } | null}
 */
function preparerComplement({ cfg, scanId, attente, corpsChaine, resultat, maintenant = Date.now() }) {
    if (!cfg || !cfg.empreinte || typeof cfg.empreinte.secret !== 'string' || !cfg.images || !Array.isArray(cfg.images.hotesPublics) || !cfg.images.hotesPublics[0]) return null;
    if (!resultat || resultat.issue !== 'question' || !resultat.analyse || !Array.isArray(resultat.analyse.cartes) || !resultat.analyse.cartes[0]) return null;
    if (resultat.confirmationNombreux !== undefined) return null;                  // R5 : cette question n'est JAMAIS promue (promotion-g.js) — demander des mesures serait les faire calculer pour rien
    if (!attente || !attente.ctx || !attente.ligne) return null;
    const ens = MC.ensembleFerme(attente.ctx, attente.ligne);
    if (!ens || ens.mesures.length === 0) return null;
    const index = identiteIndex(etatEmpreintes().courante());
    if (!index) return null;
    const hote = cfg.images.hotesPublics[0];
    const references = ens.refs.map(ref => ({ ref, url: urlDe(hote, ref), sha256: null, octets: null }));
    const refsJeton = references.map(r => ({ ref: r.ref, sha256: r.sha256 }));
    const exp = maintenant + VALIDITE_MS;
    const jeton = MC.signerJeton({ scanId: String(scanId), mesures: ens.mesures, refs: refsJeton, exp }, cfg.empreinte.secret);
    const c0 = resultat.analyse.cartes[0];
    return {
        public: { jeton, expireDans: VALIDITE_MS / 1000, mesures: ens.mesures, references },
        stocke: { mesures: ens.mesures, refs: refsJeton, ligne: { top: attente.ligne.top.map(([k, s]) => [k, s]), essai: attente.ligne.essai }, exp: new Date(exp), index,
            corps: corpsGarde(corpsChaine), ids: (c0.candidats || []).map(x => x.idProduct).filter(Number.isInteger), consomme: false }
    };
}

/** La décision sur les résultats du client, puis l'arbitrage de la voie du vecteur. { promouvoir: idProduct } | { issue: '<raison>' } — ne lève jamais. */
async function juger({ cm, resultats, catalogue }) {
    try {
        const v = MC.validerResultats(cm.mesures, resultats);
        if (!v.ok) return { issue: `rejetees-${v.code}` };
        const courant = etatEmpreintes().courante();
        if (!memeIndex(identiteIndex(courant), cm.index)) return { issue: 'index-change' };
        const ctx = require('./emprunt').contexteDeLaRegle(courant.index.contexteG);          // le MÊME contexte que le fournisseur (voisins-empreinte.js) passe à la règle
        const paires = new Map(), zones = new Map();
        cm.mesures.forEach((d, i) => { const r = resultats[i]; if (d.type === 'paire') paires.set(`${d.a}|${d.b}`, [r.ecart, r.couverture]); else zones.set(d.ref, r); });
        const ABSENTE = new Error('mesure absente');
        const mesures = { comparerPaire: (a, b) => { const r = paires.get(`${a}|${b}`); if (!r) throw ABSENTE; return r; }, scoresZones: c => { const r = zones.get(c); if (!r) throw ABSENTE; return r; } };
        let d;
        try { d = RG.decisionRegleG({ ligne: cm.ligne, nEssais: 1, mesures, contexteG: ctx }, G.SEUILS_G); }
        catch (e) { return { issue: e === ABSENTE ? 'muette' : 'regle-en-erreur' }; }
        if (!d || d.issue !== 'affirmee' || !Number.isInteger(d.produit)) return { issue: 'sans-affirmation' };
        if (!cm.ids.includes(d.produit)) return { issue: 'hors-question' };                // le client ne peut désigner qu'un candidat de la question
        const lus = new Map();
        const ids = [...new Set([...cm.ids, d.produit, ...((cm.corps.lectureGarde && Array.isArray(cm.corps.lectureGarde.vivierIds)) ? cm.corps.lectureGarde.vivierIds.filter(Number.isInteger).slice(0, 400) : [])])];
        try { for (const [k, p] of await catalogue.lire(ids)) lus.set(k, p); } catch (e) { journalErreur('catalogue (garde)', e); return { issue: 'catalogue-indisponible' }; }
        const garde = PG.evaluerGarde({ corps: cm.corps, gagnant: d.produit, produits: lus });
        const arb = PG.arbitrerAvecPromotion({ issue: 'question', ids: cm.ids }, d, { garde, depuisIntrouvable: false });
        if (arb.action !== 'promouvoir') return { issue: (arb.desaccord && arb.desaccord.retenue) || arb.action };
        return { promouvoir: arb.ids[0], concordante: arb.concordante === true };
    } catch (e) { journalErreur('jugement', e); return { issue: 'erreur' }; }
}

function traiterMesures(cfg, deps = {}) {
    const catalogue = deps.catalogue || require('./catalogue').creerCatalogue({ cfg });
    const maintenant = () => (typeof deps.maintenant === 'function' ? deps.maintenant() : Date.now());
    return async function traiterMesuresV2(req, res) {
        const porteur = req.v2 && req.v2.porteur;
        let argent;
        try { argent = registre.obtenir('argent'); if (!porteur) throw new Error('montage incomplet'); }
        catch (e) { journalErreur('montage', e); return repondreErreur(res, 'INDISPONIBLE'); }
        const entreeInvalide = detail => repondreErreur(res, 'ENTREE', undefined, { detail });
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b)) return entreeInvalide('corps');
        if (typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return entreeInvalide('scan-id');
        if (typeof b.jeton !== 'string' || b.jeton.length === 0 || b.jeton.length > JETON_MAX) return entreeInvalide('jeton');
        if (b.opencv !== undefined && (typeof b.opencv !== 'string' || b.opencv.length > OPENCV_MAX)) return entreeInvalide('opencv');
        if (!Array.isArray(b.resultats) || b.resultats.length > RESULTATS_MAX) return entreeInvalide('resultats');
        const scanId = new mongoose.Types.ObjectId(b.scanId);
        const cleP = `${porteur.type}:${porteur.id}`;
        let an;
        try { an = await col('analyses').findOne({ _id: scanId, porteur: cleP }); }
        catch (e) { journalErreur('analyses', e); return repondreErreur(res, 'INDISPONIBLE'); }
        if (!an) return repondreErreur(res, 'CODE_INVALIDE', 'Scan introuvable');
        const cm = an.complementMesures;
        const expire = () => repondreErreur(res, 'CODE_EXPIRE', 'Les mesures ne sont plus attendues');
        if (!cm || !Array.isArray(cm.mesures) || !(cm.exp instanceof Date)) return expire();
        if (!MC.verifierJeton(b.jeton, { scanId: b.scanId.toLowerCase(), mesures: cm.mesures, refs: cm.refs, maintenant: maintenant() }, cfg.empreinte.secret)) return expire();
        // UN seul envoi par scan : la prise est atomique (le premier gagne, le second reçoit 409)
        let pris;
        try { pris = await col('analyses').updateOne({ _id: scanId, porteur: cleP, 'complementMesures.consomme': false }, { $set: { 'complementMesures.consomme': true, 'complementMesures.recuLe': new Date(maintenant()), 'complementMesures.opencv': typeof b.opencv === 'string' ? b.opencv : null } }); }
        catch (e) { journalErreur('prise du complément', e); return repondreErreur(res, 'INDISPONIBLE'); }
        if (!pris || pris.matchedCount !== 1) return repondreErreur(res, 'CONFLIT', 'Les mesures ont déjà été envoyées');
        const noter = async issue => { try { await col('analyses').updateOne({ _id: scanId }, { $set: { 'complementMesures.issue': issue } }); } catch (e) { journalErreur('issue du complément', e); } };
        const inchange = async issue => { await noter(issue); return res.status(200).json({ success: true, scanId: b.scanId, change: false }); };

        const entree = Array.isArray(an.cartes) ? an.cartes[0] : null;
        if (!entree || entree.statut !== 'a-trancher' || !entree.question || !Array.isArray(entree.question.choix)) return inchange('plus-de-question');
        const j = await juger({ cm, resultats: b.resultats, catalogue });
        if (!Number.isInteger(j.promouvoir)) return inchange(j.issue || 'inchange');
        const cand = entree.question.choix.find(x => x && x.idProduct === j.promouvoir);
        if (!cand || typeof cand.id !== 'string') return inchange('hors-question');

        // LA PROMOTION : la question réservée est réglée comme une réponse par ce candidat (un seul débit, la machine à états de argent/questions.js) ; un administrateur n'a rien réservé
        const admin = Boolean(an.facturation && an.facturation.motif === 'administrateur');
        let facturation;
        if (admin) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });
        else {
            let r;
            try { r = await argent.repondreQuestion(porteur, { scanId, carte: 0, choix: cand.id }); }
            catch (e) { journalErreur('repondreQuestion', e); await noter('reglement-indisponible'); return res.status(200).json({ success: true, scanId: b.scanId, change: false }); }
            // la personne a déjà répondu (409), la question a expiré (410) ou autre : la réponse de la personne, ou l'expiration, l'emporte — rien ne change
            if (!r || r.statut !== 200 || !r.question || !r.question.reponse || r.question.reponse.idProduct !== j.promouvoir) return inchange(`reglement-${(r && r.statut) || 'aucun'}`);
            facturation = r.facturation;
        }
        const { carteRepondue } = require('./routes');
        const { avecRepliAnalyse } = require('./prix-repli');
        const brute = carteRepondue(an, entree, 0, cand.id, j.promouvoir);
        const carte = brute && avecRepliAnalyse(brute);
        if (!carte) { console.error(`🔴 [v2 mesures] scan ${scanId} : la carte promue ne peut pas être fabriquée depuis analyses (la question, elle, est réglée)`); await noter('carte-impossible'); return repondreErreur(res, 'SERVEUR'); }
        // le journal du scan : la promotion par les mesures du client — JAMAIS dans `cartes.0.reponse` (la vérité d'une personne), jamais dans le banc réel
        try { await col('analyses').updateOne({ _id: scanId }, { $set: { 'complementMesures.issue': 'promotion', 'complementMesures.produit': j.promouvoir, 'complementMesures.lectureConcordante': j.concordante, 'cartes.0.promotionMesures': { choix: cand.id, idProduct: j.promouvoir, le: new Date(maintenant()) } } }); }
        catch (e) { journalErreur('journal de la promotion', e); }
        let solde, offre;
        try { solde = await argent.solde(porteur); } catch (e) { journalErreur('solde', e); }
        try { offre = await offreSur(porteur, argent); } catch (e) { journalErreur('offre', e); }
        return res.status(200).json({ success: true, scanId: b.scanId, change: true, carte, facturation, ...(solde !== undefined ? { solde } : {}), ...avecOffre(offre) });
    };
}

module.exports = { preparerComplement, traiterMesures, corpsGarde, VALIDITE_MS };
