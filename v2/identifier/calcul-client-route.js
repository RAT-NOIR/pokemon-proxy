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
const GG = require('./g-groupe');
const PR = require('./probable-route');
const G = require('../../ratmarket/decision-g');
const registre = require('../registre');
const { col } = require('../db');
const { repondreErreur } = require('../erreurs');
const { offreSur, avecOffre } = require('../argent/offre-sur');
const PRO = require('./reserve-pro-prix');      // PRO-PRIX-RESERVE : la décision unique du prix par état et par langue (réservé à Pro)
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
function preparerComplement({ cfg, scanId, attente, corpsChaine, resultat, maintenant = Date.now(), cleDe = null, probableG = null }) {
    if (!cfg || !cfg.empreinte || typeof cfg.empreinte.secret !== 'string' || !cfg.images || !Array.isArray(cfg.images.hotesPublics) || !cfg.images.hotesPublics[0]) return null;
    if (!resultat || resultat.issue !== 'question' || !resultat.analyse || !Array.isArray(resultat.analyse.cartes) || !resultat.analyse.cartes[0]) return null;
    if (resultat.confirmationNombreux !== undefined) return null;                  // R5 : cette question n'est JAMAIS promue (promotion-g.js) — demander des mesures serait les faire calculer pour rien
    if (!attente || !attente.ctx || !attente.ligne) return null;
    const ens = MC.ensembleFerme(attente.ctx, attente.ligne);
    if (!ens && cfg.gGroupe !== true) return null;
    // G-GROUPE (V2_G_GROUPE, éteint par défaut : rien de ce bloc ne s'exécute et la demande est celle d'avant, octet pour octet) : les zones de chaque visuel de la question s'ajoutent à la demande
    // quand elles tiennent dans MESURES_MAX — elles ordonnent le groupe (g-groupe.js), elles ne changent aucune décision de G. Même une demande de G vide (G refuse avant toute mesure) peut porter le groupe,
    // et même une demande de G trop grande (ensemble nul : plus de MESURES_MAX mesures, G se tait comme avant) : le client ne mesure alors que le groupe.
    let mesures = ens ? ens.mesures : [], refsDemande = ens ? ens.refs : [], groupe = null;
    if (cfg.gGroupe === true) {
        const gr = GG.groupeDeLaQuestion(((resultat.analyse.cartes[0].candidats) || []).map(x => x && x.idProduct), cleDe || GG.cleDeLaVersion(require('../chargeur/etat').version()));
        const ajout = gr ? GG.demandeDuGroupe({ groupe: gr, deja: mesures, max: MC.MESURES_MAX }) : null;
        if (ajout) { mesures = [...mesures, ...ajout]; refsDemande = [...refsDemande, ...gr.map(c => c.cle).filter((k, i, a) => !refsDemande.includes(k) && a.indexOf(k) === i)]; groupe = gr; }
    }
    if (mesures.length === 0) return null;
    const index = identiteIndex(etatEmpreintes().courante());
    if (!index) return null;
    const hote = cfg.images.hotesPublics[0];
    const references = refsDemande.map(ref => ({ ref, url: urlDe(hote, ref), sha256: null, octets: null }));
    const refsJeton = references.map(r => ({ ref: r.ref, sha256: r.sha256 }));
    const exp = maintenant + VALIDITE_MS;
    const jeton = MC.signerJeton({ scanId: String(scanId), mesures, refs: refsJeton, exp }, cfg.empreinte.secret);
    const c0 = resultat.analyse.cartes[0];
    return {
        public: { jeton, expireDans: VALIDITE_MS / 1000, mesures, references },
        stocke: { mesures, refs: refsJeton, ligne: { top: attente.ligne.top.map(([k, s]) => [k, s]), essai: attente.ligne.essai }, exp: new Date(exp), index,
            corps: corpsGarde(corpsChaine), ids: (c0.candidats || []).map(x => x.idProduct).filter(Number.isInteger), consomme: false, ...(groupe ? { groupe } : {}),
            // G-GROUPE → PROBABLE : ce que la désignation relira au second envoi (version de l'extension, trace des groupes, cosinus de chaque candidat) — seulement si les DEUX drapeaux sont allumés et que le groupe est demandé
            ...(groupe && probableG && cfg.probable === true ? { probableG } : {}) }
    };
}

/** La décision sur les résultats du client, puis l'arbitrage de la voie du vecteur. { promouvoir: idProduct } | { issue: '<raison>' } — ne lève jamais. */
async function juger(args) {
    const j = await jugerG(args);
    // G-GROUPE (V2_G_GROUPE) : quand la règle G n'a rien promu, le groupe de la question est ordonné par les zones que le client a mesurées. Une décision journalisée, jamais servie, jamais une promotion
    // (le niveau ne monte pas). Éteint, ou sans groupe demandé, ou mesures invalides : le résultat de G est rendu tel quel.
    if (!args || args.gGroupe !== true || !args.cm || !Array.isArray(args.cm.groupe) || Number.isInteger(j.promouvoir)) return j;
    try {
        if (!MC.validerResultats(args.cm.mesures, args.resultats).ok) return j;
        const zones = new Map(); args.cm.mesures.forEach((d, i) => { if (d.type === 'zones') zones.set(d.ref, args.resultats[i]); });
        return { ...j, ordreGroupe: GG.ordonnerGroupe({ groupe: args.cm.groupe, zones: k => zones.get(k) ?? null, ecartMin: args.ecartMin }) };
    } catch (e) { journalErreur('g-groupe', e); return j; }
}
/**
 * LA GARDE DE LA LECTURE de la photo (garde (2)) pour un produit que le second envoi s'apprête à FAIRE PASSER (promotion de G, ou tête du groupe devenue probable) : UNE fonction, lue par les deux chemins.
 * Les lignes du catalogue du produit, des candidats et du vivier de la chaîne, puis PG.evaluerGarde. @returns {{garde: object} | {issue: 'catalogue-indisponible'}}
 */
async function gardeDeLaLecture({ cm, produit, catalogue }) {
    const lus = new Map();
    const ids = [...new Set([...cm.ids, produit, ...((cm.corps.lectureGarde && Array.isArray(cm.corps.lectureGarde.vivierIds)) ? cm.corps.lectureGarde.vivierIds.filter(Number.isInteger).slice(0, 400) : [])])];
    try { for (const [k, p] of await catalogue.lire(ids)) lus.set(k, p); } catch (e) { journalErreur('catalogue (garde)', e); return { issue: 'catalogue-indisponible' }; }
    return { garde: PG.evaluerGarde({ corps: cm.corps, gagnant: produit, produits: lus }) };
}
async function jugerG({ cm, resultats, catalogue }) {
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
        const g = await gardeDeLaLecture({ cm, produit: d.produit, catalogue });
        if (g.issue) return { issue: g.issue };
        const garde = g.garde;
        const arb = PG.arbitrerAvecPromotion({ issue: 'question', ids: cm.ids }, d, { garde, depuisIntrouvable: false });
        if (arb.action !== 'promouvoir') return { issue: (arb.desaccord && arb.desaccord.retenue) || arb.action };
        return { promouvoir: arb.ids[0], concordante: arb.concordante === true };
    } catch (e) { journalErreur('jugement', e); return { issue: 'erreur' }; }
}

/**
 * G-GROUPE → PROBABLE. La tête du groupe (ordre.tete) devient le probable de la question SI ET SEULEMENT SI : PROBABLE n'avait rien désigné ; la question est encore posée, sans réponse ; TOUTES les gardes de PROBABLE
 * passent (probable-route.js::designerTeteDeGroupe : version de l'extension, I3 groupes, vecteur exigé et cosinus minimal, I2 prix de guide servi) ; la carte à servir peut être fabriquée ; le débit atomique
 * (I1) passe par argent.passerEnProbable. Le marqueur d'analyse est écrit AVANT le débit et retiré si le débit échoue : jamais un débit sans marqueur. Ne lève jamais.
 * @returns {{reponse: {carte, facturation, solde?, offre?}} | {refus: string}}
 */
async function devenirProbable({ cfg, argent, porteur, scanId, an, entree, cm, ordre, catalogue }) {
    let debite = false, reponse = null, carteComplete = null, acces = true;
    try {
        if (!cm.probableG || typeof cm.probableG !== 'object') return { refus: 'sans-donnees' };
        const c0 = an.cartes[0];
        if (c0.probable || c0.reponse) return { refus: 'deja-designe-ou-repondu' };
        const ids = entree.question.choix.map(x => x && x.idProduct);
        const prod = (an.produits || []).find(p => p && p.idProduct === ordre.tete);
        const cos = cm.probableG.cosinus && typeof cm.probableG.cosinus === 'object' ? cm.probableG.cosinus[String(ordre.tete)] : null;
        // LA LECTURE DE LA PHOTO peut REFUSER la tête : la MÊME garde que la promotion de G (gardeDeLaLecture -> PG.evaluerGarde), pas une copie
        const g = await gardeDeLaLecture({ cm, produit: ordre.tete, catalogue });
        if (g.issue) return { refus: g.issue };
        const d = PR.designerTeteDeGroupe({ cfg, versionExtension: cm.probableG.versionExtension, tete: ordre.tete, ids, version: require('../chargeur/etat').version(), groupeMarqueurs: cm.probableG.groupeMarqueurs,
            cosinus: typeof cos === 'number' ? cos : null, prixGuide: prod ? prod.prixGuide : null, garde: g.garde });
        if (!Number.isInteger(d.idProduct)) return { refus: d.refus || 'refus' };
        const { carteRepondue } = require('./routes');
        const { avecRepliAnalyse } = require('./prix-repli');
        const { avecNiveau } = PR;
        const brute = carteRepondue(an, entree, 0, 'ne-sait-pas', null);
        const carte = brute && avecNiveau({ cartes: [avecRepliAnalyse(brute)] }, d).cartes[0];
        if (!carte) return { refus: 'carte' };                                        // la carte est fabriquée AVANT le débit : jamais un débit sans carte servable
        const admin = Boolean(an.facturation && an.facturation.motif === 'administrateur');
        const m = await col('analyses').updateOne({ _id: scanId, 'cartes.0.probable': { $exists: false } }, { $set: { 'cartes.0.probable': { idProduct: d.idProduct, signal: d.signal } } });
        if (!m || (m.matchedCount ?? m.modifiedCount ?? 0) < 1) return { refus: 'marqueur' };
        let ok = admin;
        if (!admin) { try { const r = await argent.passerEnProbable(porteur, { scanId, carte: 0 }); ok = Boolean(r && r.ok); } catch (e) { journalErreur('passage en probable', e); ok = false; } }
        if (!ok) {
            try { await col('analyses').updateOne({ _id: scanId, 'cartes.0.probable.signal': d.signal }, { $unset: { 'cartes.0.probable': '' } }); } catch (e) { journalErreur('marqueur probable retiré', e); }
            return { refus: 'debit' };
        }
        // ⚠️ À PARTIR D'ICI LE CRÉDIT EST DÉBITÉ : le client voit TOUJOURS ce qu'il a payé. Tout ce qui suit est gardé séparément, une panne se journalise et ne retire ni la carte ni la facturation.
        debite = true;
        let facturation;
        try { facturation = require('./routes').facturationDe('question', { admin, rendu: false, question: true, probable: true, cause: null }); }
        catch (e) { journalErreur('facturation du probable', e); facturation = fabriquerFacturation(admin ? { motif: 'administrateur', rembourse: false } : { debite: 1, reserve: 0, rembourse: false, motif: 'question' }); }
        let solde, offre;
        try { solde = await argent.solde(porteur); } catch (e) { journalErreur('solde', e); }
        try { offre = await offreSur(porteur, argent); } catch (e) { journalErreur('offre', e); }
        acces = PRO.accesPrixParEtat(cfg, offre); carteComplete = carte;
        reponse = { carte: PRO.carteSelonOffre(carte, acces), facturation, ...(solde !== undefined ? { solde } : {}), ...avecOffre(offre) };      // PRO-PRIX-RESERVE : la même décision (une carte à trancher n'a ni prixLive ni repli : garde par construction)
        return { reponse, carteComplete, acces };
    } catch (e) {
        journalErreur('probable de groupe', e);
        // une exception APRÈS le débit : la carte et la facturation sont déjà prêtes quand elles existent, elles sont servies ; jamais « change: false » sur un crédit débité
        if (debite && reponse) return { reponse, carteComplete, acces };
        if (debite) console.error(`🔴 [v2 mesures] scan ${scanId} : crédit débité (probable de groupe) et réponse non fabriquée — à la réconciliation`);
        return { refus: 'erreur' };
    }
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
        const noter = async (issue, ordreGroupe) => { try { await col('analyses').updateOne({ _id: scanId }, { $set: { 'complementMesures.issue': issue, ...(ordreGroupe ? { 'complementMesures.ordreGroupe': ordreGroupe } : {}) } }); } catch (e) { journalErreur('issue du complément', e); } };
        const inchange = async (issue, ordreGroupe) => { await noter(issue, ordreGroupe); return res.status(200).json({ success: true, scanId: b.scanId, change: false }); };

        const entree = Array.isArray(an.cartes) ? an.cartes[0] : null;
        if (!entree || entree.statut !== 'a-trancher' || !entree.question || !Array.isArray(entree.question.choix)) return inchange('plus-de-question');
        const j = await juger({ cm, resultats: b.resultats, catalogue, gGroupe: cfg.gGroupe === true, ecartMin: cfg.gGroupeEcart });
        if (!Number.isInteger(j.promouvoir)) {
            // G-GROUPE → PROBABLE (V2_G_GROUPE ET V2_PROBABLE) : la tête posée par g-groupe.js est une désignation CANDIDATE du niveau « probable » ; toutes les gardes de PROBABLE s'appliquent, le débit passe par
            // argent.passerEnProbable (la fonction de PROBABLE). Un refus laisse la question réservée : le résultat d'avant, `change: false`.
            if (cfg.gGroupe === true && cfg.probable === true && b.accepteProbable === true && j.ordreGroupe && j.ordreGroupe.change === true) {
                const p = await devenirProbable({ cfg, argent, porteur, scanId, an, entree, cm, ordre: j.ordreGroupe, catalogue });
                if (p.reponse) {
                    await noter('probable-groupe', { ...j.ordreGroupe, probable: 'servi' });
                    // PRO-PRIX-RESERVE (F5) : la même conservation que la promotion ci-dessous ; la carte « probable » est une question (ni prixLive ni repli) : la réduction n'y change rien, la conservation reste uniforme
                    if (p.carteComplete && p.reponse.carte !== p.carteComplete) PRO.conserverComplet(res, { success: true, scanId: b.scanId, change: true, ...p.reponse, carte: p.carteComplete }, { acces: p.acces });
                    return res.status(200).json({ success: true, scanId: b.scanId, change: true, ...p.reponse });
                }
                return inchange(j.issue || 'inchange', { ...j.ordreGroupe, probable: `refus:${p.refus}` });
            }
            return inchange(j.issue || 'inchange', j.ordreGroupe);
        }
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
        const carteComplete = brute && avecRepliAnalyse(brute);
        if (!carteComplete) { console.error(`🔴 [v2 mesures] scan ${scanId} : la carte promue ne peut pas être fabriquée depuis analyses (la question, elle, est réglée)`); await noter('carte-impossible'); return repondreErreur(res, 'SERVEUR'); }
        // le journal du scan : la promotion par les mesures du client — JAMAIS dans `cartes.0.reponse` (la vérité d'une personne), jamais dans le banc réel
        try { await col('analyses').updateOne({ _id: scanId }, { $set: { 'complementMesures.issue': 'promotion', 'complementMesures.produit': j.promouvoir, 'complementMesures.lectureConcordante': j.concordante, 'cartes.0.promotionMesures': { choix: cand.id, idProduct: j.promouvoir, le: new Date(maintenant()) } } }); }
        catch (e) { journalErreur('journal de la promotion', e); }
        let solde, offre;
        try { solde = await argent.solde(porteur); } catch (e) { journalErreur('solde', e); }
        try { offre = await offreSur(porteur, argent); } catch (e) { journalErreur('offre', e); }
        // PRO-PRIX-RESERVE : la décision unique sur l'offre relue ci-dessus ; la réponse COMPLÈTE est gardée pour le rejeu d'idempotence
        const acces = PRO.accesPrixParEtat(cfg, offre), carte = PRO.carteSelonOffre(carteComplete, acces);
        const corps = { success: true, scanId: b.scanId, change: true, carte, facturation, ...(solde !== undefined ? { solde } : {}), ...avecOffre(offre) };
        if (carte !== carteComplete) PRO.conserverComplet(res, { ...corps, carte: carteComplete }, { acces });
        return res.status(200).json(corps);
    };
}

module.exports = { preparerComplement, traiterMesures, corpsGarde, juger, VALIDITE_MS };
