'use strict';
// Lot B1b — routes de /api/identifier (contrat 2). PREMIÈRE PARTIE (B1b.1) : l'entrée est validée AVANT tout débit.
// `validerEntree` n'écrit nulle part : un refus ici ne touche ni `mouvements` ni aucune autre collection.
const { repondreErreur } = require('../erreurs');
const { HOTES_PHOTO_AUTORISES } = require('../../departage-image');   // la liste blanche de la production, pas une copie

const TITRE_MAX = 300, DESCRIPTION_MAX = 4000;

// Comparaison numérique `a.b.c` ('2.0.10' > '2.0.9'). Illisible => null (jamais un ordre inventé) : 'v2.0.0' et '2.0.0-beta' sont refusés (400 version).
function comparerVersions(a, b) {
    const lire = v => (typeof v === 'string' && /^\d+(\.\d+){0,2}$/.test(v.trim())) ? v.trim().split('.').map(Number) : null;
    const x = lire(a), y = lire(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
}

const refus = (code, message, detail) => ({ erreur: { code, message, ...(detail !== undefined ? { detail } : {}) } });
const hoteHttps = (u) => {
    if (typeof u !== 'string') return null;
    let p; try { p = new URL(u); } catch { return null; }
    return p.protocol === 'https:' ? p.hostname.toLowerCase() : null;     // le nom d'hôte PARSÉ, jamais la chaîne
};

// Fonction pure : { entree } ou { erreur: { code, message, detail? } }. Ordre : forme, version, marché, champs, images.
function verifierEntree(corps, cfg) {
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return refus('ENTREE', 'corps de requête invalide');
    const cmp = comparerVersions(corps.versionExtension, cfg.versionMinExtension);
    if (cmp === null) return refus('ENTREE', 'versionExtension illisible', 'version');
    if (cmp < 0) return refus('VERSION', `extension trop ancienne (minimum ${cfg.versionMinExtension})`);
    if (typeof corps.marche !== 'string' || !cfg.marches.includes(corps.marche)) return refus('MARCHE', 'marché non pris en charge');
    if (corps.title != null && typeof corps.title !== 'string') return refus('ENTREE', 'title invalide', 'title');
    if (corps.description != null && typeof corps.description !== 'string') return refus('ENTREE', 'description invalide', 'description');
    const prix = corps.prixVinted ?? null;
    if (prix !== null && !(typeof prix === 'number' && Number.isFinite(prix) && prix > 0)) return refus('ENTREE', 'prixVinted invalide', 'prix');
    const devise = corps.devise ?? null;
    if (devise !== null && !cfg.devises.includes(devise)) return refus('ENTREE', 'devise hors liste', 'devise');
    if (prix !== null && devise === null) return refus('ENTREE', 'devise manquante', 'devise');
    let vintedUrl = corps.vintedUrl ?? null;
    if (vintedUrl !== null) {
        const h = hoteHttps(vintedUrl);
        if (!h || !cfg.marches.includes(h.replace(/^www\./, ''))) return refus('ENTREE', 'vintedUrl invalide', 'vinted-url');
    }
    const urls = corps.imageUrls;
    if (urls !== undefined && urls !== null && !Array.isArray(urls)) return refus('ENTREE', 'imageUrls doit être un tableau', 'image-urls');
    if (Array.isArray(urls) && urls.length > cfg.images.imageUrlsMax) return refus('ENTREE', `au plus ${cfg.images.imageUrlsMax} images`, 'image-urls');
    for (const u of urls || []) {
        if (typeof u !== 'string') return refus('ENTREE', 'imageUrls : chaîne attendue', 'image-url');
        const h = hoteHttps(u);
        if (!h) return refus('ENTREE', 'imageUrls : URL https attendue', 'image-url');
        if (!HOTES_PHOTO_AUTORISES.some(re => re.test(h))) return refus('ENTREE', 'imageUrls : hôte non autorisé', 'image-hote');
    }
    if (!urls || !urls.length) return refus('IMAGE', 'aucune image à analyser', 'aucune-image');
    return { entree: {
        imageUrls: [...urls], title: (corps.title || '').slice(0, TITRE_MAX), description: (corps.description || '').slice(0, DESCRIPTION_MAX),
        prixVinted: prix, devise, marche: corps.marche, vintedUrl,
        vintedEtat: typeof corps.vintedEtat === 'string' ? corps.vintedEtat.slice(0, 100) : null,   // CONTRAT-2.md l. 24 : passé à la chaîne héritée (B1b.3) ; borné (mineur reporté de B1b.1)
        langueInterface: corps.langueInterface === 'en' ? 'en' : 'fr', versionExtension: corps.versionExtension.trim()
    } };
}

// Middleware : à placer APRÈS idempotente('identifier') et AVANT traiterIdentifier. Pose req.entree ; rien n'est débité ici.
function validerEntree(cfg) {
    return (req, res, next) => {
        const r = verifierEntree(req.body, cfg);
        if (r.erreur) return repondreErreur(res, r.erreur.code, r.erreur.message, r.erreur.detail !== undefined ? { detail: r.erreur.detail } : {});
        req.entree = r.entree;
        return next();
    };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// B1b.3 — traiterIdentifier : du débit à la réponse. C'est ici que l'argent rencontre la chaîne d'identification.
// Les dix étapes du plan (§14, Task B1b.3), dans cet ordre. Invariants qui se lisent dans le code :
//   · on n'appelle JAMAIS la chaîne héritée (donc jamais l'IA) sans avoir débité ;
//   · tout débit finit livré, réservé (question) ou remboursé : une panne et un « introuvable » sont toujours rendus, et si la chaîne ne l'a pas fait
//     elle-même (req.scanRembourse faux) c'est CETTE fonction qui le fait ;
//   · une écriture annexe (analyses, annonces) échoue sans jamais changer la réponse.
// La facturation dite au client est celle que le registre du scan a RÉELLEMENT produite (req.scanRendu / req.questionId / cause relue dans le contexte du
// scan) — jamais une valeur supposée par le type d'issue.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
const mongoose = require('mongoose');
const registre = require('../registre');
const { fauxRes } = require('./captureres');
const { adapter } = require('./adaptateur');
const { creerCatalogue } = require('./catalogue');
const { regleVerdict } = require('./taux');
const { preparerAnnonce } = require('../annonce/verifier');
const { conserverAnnonce } = require('../annonce/conservation');
const { facturation: fabriquerFacturation, raisonPublique } = require('../argent/facturation');
const { dansUnScan, raisonNonRemboursement, noterNonRemboursement } = require('../../sources');
const { col } = require('../db');

// Les motifs par lesquels la chaîne héritée REFUSE par égalité (et rembourse d'office) : index.js ~4846 et ~5019.
const MOTIFS_REFUS_EN_QUESTION = Object.freeze(['egalite-parfaite', 'nom-contredit-egalite', 'nom-contredit-sans-repli']);

const URL_RECHARGE = 'https://rat-market.fr/fr/compte#recharge';
const entiers = xs => [...new Set((Array.isArray(xs) ? xs : []).map(c => c && c.idProduct).filter(Number.isInteger))];
const journalErreur = (ou, e) => console.error(`❌ [v2 identifier] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);   // jamais e.message : il peut citer une donnée

// La facturation, d'après ce que le registre du scan a réellement fait. `faits` = { admin, rendu, question, cause }.
function facturationDe(issue, faits) {
    if (faits.admin) return fabriquerFacturation({ motif: 'administrateur', rembourse: false });
    const refuse = !faits.rendu && faits.cause === 'plafond-jour';                         // le remboursement a été REFUSÉ par le plafond du jour : la seule cause qui a un motif propre
    const nonRendu = { debite: 1, reserve: 0, rembourse: false, raisonNonRembourse: faits.cause ?? 'erreur' };
    if (issue === 'affirmee') return fabriquerFacturation({ debite: 1, rembourse: false, motif: 'affirmee' });
    if (issue === 'question') {
        if (faits.question) return fabriquerFacturation({ debite: 0, reserve: 1, rembourse: false, motif: 'question' });
        if (faits.rendu) return fabriquerFacturation({ debite: 0, rembourse: true, motif: 'question' });
        return fabriquerFacturation({ ...nonRendu, motif: refuse ? 'plafond-jour' : 'question' });
    }
    const motif = issue === 'introuvable' ? 'introuvable' : 'panne';
    if (faits.rendu) return fabriquerFacturation({ debite: 0, rembourse: true, motif });
    return fabriquerFacturation({ ...nonRendu, motif: refuse ? 'plafond-jour' : motif });
}

function traiterIdentifier(cfg, deps = {}) {
    const catalogue = deps.catalogue || creerCatalogue({ cfg });
    return async function traiterIdentifierV2(req, res) {
        const porteur = req.v2 && req.v2.porteur, entree = req.entree;
        let argent;
        try {
            argent = registre.obtenir('argent');
            if (!porteur || !entree || typeof deps.gererIdentifier !== 'function') throw new Error('montage incomplet');
        } catch (e) { journalErreur('montage', e); return repondreErreur(res, 'INDISPONIBLE'); }
        const soldeSur = async () => { try { return await argent.solde(porteur); } catch (e) { journalErreur('solde', e); return undefined; } };

        // 1. l'annonce est une DONNÉE : expurgée avant tout usage
        const annonce = preparerAnnonce({ title: entree.title, description: entree.description }, cfg);
        // 2. l'identifiant du scan (le MÊME pour le débit, la question, le journal hérité, analyses) et la clé de débit, préfixée par le porteur
        const scanId = new mongoose.Types.ObjectId();
        const cleIdem = req.headers['idempotency-key'];
        const cleDebit = `scan|${porteur.type}:${porteur.id}|${cleIdem}`;
        // 3. LE DÉBIT, avant toute chose
        let debit;
        try { debit = await argent.debiter(porteur, { scanId, cleIdempotence: cleDebit }); }
        catch (e) { journalErreur('débit', e); return repondreErreur(res, 'INDISPONIBLE'); }
        if (!debit || !debit.ok) {
            const code = debit && ['QUOTA', 'VERIFICATION', 'EN_RECONCILIATION'].includes(debit.code) ? debit.code : 'INDISPONIBLE';
            if (code === 'INDISPONIBLE') return repondreErreur(res, code);
            const extra = { facturation: null, ...(code === 'QUOTA' && porteur.type === 'compte' ? { achat: { url: URL_RECHARGE } } : {}) };
            if (code !== 'EN_RECONCILIATION') { const s = await soldeSur(); if (s !== undefined) extra.solde = s; }
            return repondreErreur(res, code, undefined, extra);
        }
        // une clé déjà débitée par une requête qui n'a pas abouti : jamais un second appel à la chaîne sur ce débit (la réconciliation tranche)
        if (debit.rejoue) return repondreErreur(res, 'DEBIT', undefined, { reessayerDans: 2 });

        const admin = debit.administrateur === true, credit = admin ? null : (debit.credit ?? null);
        const userId = `v2:${porteur.type}:${porteur.id}`;
        // 4. la chaîne héritée, avec le DOUBLE de res ; tout ce qui suit se décide dans le contexte de CE scan (la cause d'un non-remboursement s'y note)
        const reqH = {
            body: { imageUrls: entree.imageUrls, title: annonce.titre, vintedEtat: entree.vintedEtat, prixVinted: entree.prixVinted, vintedUrl: entree.vintedUrl, versionExtension: entree.versionExtension, userId },
            ip: req.ip, headers: {}, scanIdImpose: scanId,
            credit: argent.creditPourReq(porteur, credit, { scanId })
        };
        const rembourserMoi = (motif) => reqH.credit.v2.rembourser(reqH, motif, { compteur: 'panne' });
        // Ruling n°2 (2026-10-10) : un REFUS de la chaîne par égalité (≥ 2 candidats) devient une QUESTION, réservée comme une ambiguë. La chaîne rembourse un refus
        // d'office ; ce remboursement est donc DIFFÉRÉ (ni fait, ni compté au plafond des pannes). Si l'adaptateur en fait une question, on RÉSERVE le crédit encore
        // pris (plus bas) ; sinon (introuvable, panne) le filet le rend. Le crédit n'est jamais perdu : il est rendu OU réservé.
        const rembourserOrigine = reqH.credit.v2.rembourser;
        reqH.credit.v2.rembourser = async (r, motif, opts) => {
            if (MOTIFS_REFUS_EN_QUESTION.includes(motif) && !r.scanRembourse) { r.refusDiffere = motif; return false; }
            return rembourserOrigine(r, motif, opts);
        };
        let sortie;
        try {
            sortie = await dansUnScan(async () => {
                const fr = fauxRes();
                let exception = null;
                try { await deps.gererIdentifier(reqH, fr); } catch (e) { exception = e; journalErreur('chaîne héritée', e); }
                let resultat;
                if (exception || !fr.headersSent) resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
                else {
                    // 5. le catalogue de l'API pour les produits que la chaîne désigne, puis l'adaptation
                    const c = fr.corps && typeof fr.corps === 'object' ? fr.corps : {};
                    const ids = [...entiers(c.candidats), ...(c.carte && Number.isInteger(c.carte.idProduct) ? [c.carte.idProduct] : [])];
                    let produits = null;
                    try { produits = await catalogue.lire(ids); } catch (e) { journalErreur('catalogue', e); }
                    resultat = produits === null ? { issue: 'panne', analyse: null, erreur: { code: 'INDISPONIBLE' } }
                        : adapter({ statutHttp: fr.statut, corps: fr.corps }, { produits, langueInterface: entree.langueInterface, cfg, ficheServie: false });
                }
                // une question née d'un REFUS (remboursement différé) : la chaîne ne l'a pas posée, on la RÉSERVE ici, avec les choix du contrat
                if (resultat.issue === 'question' && reqH.refusDiffere && !reqH.questionId && !admin && credit) {
                    let r = null;
                    try {
                        const choix = resultat.question.choix.map(x => ({ id: x.id, idProduct: x.idProduct }));
                        r = await argent.reserverQuestion(porteur, credit, { scanId, carte: 0, raison: reqH.refusDiffere, candidats: choix.map(x => x.idProduct), choix });
                    } catch (e) { journalErreur('réservation de la question', e); }
                    if (r && r.etat === 'en-attente') reqH.questionId = scanId;
                    else if (r && r.etat === 'remboursee') { reqH.scanRembourse = true; reqH.scanRendu = true; }                        // le repli a rendu le crédit à l'émission
                    else if (r && r.etat === 'non-remboursee') { reqH.scanRembourse = true; noterNonRemboursement(raisonPublique(r.raisonNonRembourse)); }
                    else resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };                                    // jamais un a-trancher sans question répondable
                }
                // la question réservée par la chaîne doit porter les choix DU CONTRAT (choixPour) : le pont ne connaît que les idProduct
                if (resultat.issue === 'question' && reqH.questionId) {
                    let ok = false;
                    try {
                        const r = await col('questions').updateOne({ _id: `${scanId}:0`, etat: 'en-attente' }, { $set: { choix: resultat.question.choix.map(x => ({ id: x.id, idProduct: x.idProduct })) } });
                        ok = r.matchedCount === 1;
                    } catch (e) { journalErreur('choix de la question', e); }
                    if (!ok) resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
                }
                // le filet : une panne ou un « introuvable » sont TOUJOURS rendus ; si la chaîne ne l'a pas tenté, c'est ici (annule aussi une question réservée)
                if (!admin && credit && (resultat.issue === 'panne' || resultat.issue === 'introuvable') && !reqH.scanRembourse) {
                    try { await rembourserMoi(resultat.issue === 'panne' ? `panne-${resultat.erreur.code}` : 'introuvable'); } catch (e) { journalErreur('remboursement', e); }
                }
                const faits = { admin, rendu: Boolean(reqH.scanRendu), question: Boolean(reqH.questionId) && resultat.issue === 'question', cause: reqH.scanRendu ? null : raisonNonRemboursement() };
                return { resultat, facturation: facturationDe(resultat.issue, faits) };
            });
        } catch (e) {
            journalErreur('décision', e);
            return repondreErreur(res, 'SERVEUR');                 // dernier recours : le débit est dans le journal des mouvements, la réconciliation le voit
        }
        const { resultat, facturation } = sortie;
        // 7. le solde, relu APRÈS les mouvements
        const solde = await soldeSur();
        if (resultat.issue === 'panne') {
            return repondreErreur(res, resultat.erreur.code, undefined, { facturation, ...(solde !== undefined ? { solde } : {}) });
        }
        // 8. la règle de verdict (au scanner : null — la surface le dit ; ici l'extension)
        let regle = null;
        try { regle = await regleVerdict(entree.devise); } catch (e) { journalErreur('taux', e); }
        const analyse = { ...resultat.analyse, regleVerdict: regle };
        // 9. les écritures annexes : sans effet sur la réponse
        try {
            const maintenant = new Date();
            const cartes = analyse.cartes;
            await col('analyses').insertOne({
                _id: scanId, porteur: `${porteur.type}:${porteur.id}`, surface: porteur.surface, statut: analyse.statut,
                cartes: cartes.map(c => ({ idProduct: c.carte ? c.carte.idProduct : null, statut: c.statut, raison: c.raison })),
                produits: cartes.flatMap(c => (c.carte ? [c.carte] : c.candidats)), facturation,
                creeLe: maintenant, expireLe: new Date(maintenant.getTime() + cfg.retention.analysesMois * 30.5 * 86400e3)
            });
        } catch (e) { journalErreur('analyses', e); }
        try { await conserverAnnonce(String(scanId), { titre: annonce.titre, description: annonce.description, expurgeeParServeur: annonce.expurgeeParServeur }, cfg); } catch (e) { journalErreur('annonces', e); }
        // 10. la réponse
        return res.status(200).json({ success: true, contrat: 2, scanId: String(scanId), analyse, facturation, ...(solde !== undefined ? { solde } : {}) });
    };
}

module.exports = { validerEntree, verifierEntree, comparerVersions, traiterIdentifier, facturationDe };
