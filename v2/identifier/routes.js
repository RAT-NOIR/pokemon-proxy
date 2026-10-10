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
const { adapter, codeLangueDe, prixLiveDe } = require('./adaptateur');
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
        let annonce;
        try { annonce = preparerAnnonce({ title: entree.title, description: entree.description }, cfg); }
        catch (e) { journalErreur('annonce', e); return repondreErreur(res, 'SERVEUR'); }            // avant tout débit : rien à rendre
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
        // 🔑 TOUT ce qui suit le débit est sous UN filet : une exception, d'où qu'elle vienne, rend le crédit (voir le catch).
        let reqH = null, rembourserOrigine = null, sortie, lecture = null;
        const rembourserMoi = (motif) => reqH.credit.v2.rembourser(reqH, motif, { compteur: 'panne' });
        try {
            reqH = {
                body: { imageUrls: entree.imageUrls, title: annonce.titre, vintedEtat: entree.vintedEtat, prixVinted: entree.prixVinted, vintedUrl: entree.vintedUrl, versionExtension: entree.versionExtension, userId },
                ip: req.ip, headers: {}, scanIdImpose: scanId,
                credit: argent.creditPourReq(porteur, credit, { scanId })
            };
            // Ruling n°2 (2026-10-10) : un REFUS de la chaîne par égalité (≥ 2 candidats) devient une QUESTION, réservée comme une ambiguë. La chaîne rembourse un refus
            // d'office ; ce remboursement est donc DIFFÉRÉ (ni fait, ni compté au plafond des pannes). Si l'adaptateur en fait une question, on RÉSERVE le crédit encore
            // pris (plus bas) ; sinon (introuvable, panne) le filet le rend. Le crédit n'est jamais perdu : il est rendu OU réservé.
            rembourserOrigine = reqH.credit.v2.rembourser;
            reqH.credit.v2.rembourser = async (r, motif, opts) => {
                if (MOTIFS_REFUS_EN_QUESTION.includes(motif) && !r.scanRembourse) { r.refusDiffere = motif; return false; }
                return rembourserOrigine(r, motif, opts);
            };
            sortie = await dansUnScan(async () => {
                const fr = fauxRes();
                let exception = null;
                try { await deps.gererIdentifier(reqH, fr); } catch (e) { exception = e; journalErreur('chaîne héritée', e); }
                let resultat;
                if (exception || !fr.headersSent) resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
                else {
                    // 5. le catalogue de l'API pour les produits que la chaîne désigne, puis l'adaptation
                    const c = fr.corps && typeof fr.corps === 'object' ? fr.corps : {};
                    // B1b.5 : ce que /reponse ne pourra pas relire (la langue lue et la stratégie reverse) pour fabriquer le prixLive d'une carte tranchée
                    lecture = { codeLangue: codeLangueDe(c), reverseStrategie: c.reverse && typeof c.reverse.strategie === 'string' ? c.reverse.strategie : null };
                    const ids = [...entiers(c.candidats), ...(c.carte && Number.isInteger(c.carte.idProduct) ? [c.carte.idProduct] : [])];
                    let produits = null;
                    try { produits = await catalogue.lire(ids); } catch (e) { journalErreur('catalogue', e); }
                    resultat = produits === null ? { issue: 'panne', analyse: null, erreur: { code: 'INDISPONIBLE' } }
                        : (deps.adapter || adapter)({ statutHttp: fr.statut, corps: fr.corps }, { produits, langueInterface: entree.langueInterface, cfg, ficheServie: false });
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
                // m1 : une question qui n'a pas de réservation derrière elle n'est répondable par personne. Repli REMBOURSÉ : on garde les candidats, montrés gratuitement
                // (table du plan). Repli NON remboursé (double panne : question non écrite ET remboursement en échec), ou aucun règlement : ce n'est plus un a-trancher,
                // c'est une PANNE SERVEUR avec la facturation de non-remboursement — un client ne paie jamais une question qui n'existe pas.
                if (resultat.issue === 'question' && !admin && credit && !reqH.questionId && !reqH.scanRendu) {
                    console.error(`🔴 [v2 identifier] scan ${scanId} (${porteur.type}:${porteur.id}) : question NON écrite et crédit NON rendu (${raisonNonRemboursement() ?? 'cause inconnue'}) — panne SERVEUR, à la réconciliation`);
                    resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
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
                return { resultat, facturation: facturationDe(resultat.issue, faits), lecture };
            });
        } catch (e) {
            // I1 : une exception hors de tout try interne (adaptateur, facturation, creditPourReq…). Le débit est pris : il est RENDU ici (idempotent : une seule fois par scan,
            // la claim rb|scanId), puis on répond SERVEUR avec la facturation qui dit ce qui s'est réellement passé.
            journalErreur('décision', e);
            let rendu = false, cause = null;
            if (!admin && credit && !(reqH && reqH.scanRembourse)) {
                try {
                    await dansUnScan(async () => {
                        if (reqH && reqH.credit && reqH.credit.v2 && rembourserOrigine) rendu = Boolean(await rembourserOrigine(reqH, 'panne-SERVEUR', { compteur: 'panne' }));   // annule aussi une question réservée
                        else { const r = await argent.rembourser(porteur, credit, 'panne-SERVEUR', { scanId, compteur: 'panne' }); rendu = Boolean(r && r.rendu); cause = r && r.raisonNonRembourse; }
                        if (!rendu && !cause) cause = raisonNonRemboursement();
                    });
                } catch (e2) { journalErreur('remboursement après exception', e2); }
                if (!rendu) console.error(`🔴 [v2 identifier] scan ${scanId} (${porteur.type}:${porteur.id}) : exception ET crédit NON rendu (${cause ?? 'erreur'}) — à la réconciliation`);
            } else rendu = Boolean(reqH && reqH.scanRendu);
            let facturation;
            try { facturation = facturationDe('panne', { admin, rendu, question: false, cause: rendu ? null : (cause ? raisonPublique(cause) : 'erreur') }); }
            catch (e3) { journalErreur('facturation après exception', e3); facturation = { debite: rendu || admin ? 0 : 1, reserve: 0, rembourse: rendu, motif: admin ? 'administrateur' : 'panne', raisonNonRembourse: rendu || admin ? null : 'erreur' }; }
            const s = await soldeSur();
            return repondreErreur(res, 'SERVEUR', undefined, { facturation, ...(s !== undefined ? { solde: s } : {}) });
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
                // B1b.5 : de quoi servir /reponse sans relire le catalogue — l'état, la question, la zone (aucune donnée de l'annonce) et la lecture de la langue
                cartes: cartes.map((c, i) => ({ idProduct: c.carte ? c.carte.idProduct : null, statut: c.statut, raison: c.raison, etat: c.etat ?? null, question: c.question ?? null, zone: c.zone ?? null,
                    ...(i === 0 && sortie.lecture ? { lecture: sortie.lecture } : {}) })),
                produits: cartes.flatMap(c => (c.carte ? [c.carte] : c.candidats)), facturation,
                creeLe: maintenant, expireLe: new Date(maintenant.getTime() + cfg.retention.analysesMois * 30.5 * 86400e3)
            });
        } catch (e) { journalErreur('analyses', e); }
        try { await conserverAnnonce(String(scanId), { titre: annonce.titre, description: annonce.description, expurgeeParServeur: annonce.expurgeeParServeur }, cfg); } catch (e) { journalErreur('annonces', e); }
        // 10. la réponse
        return res.status(200).json({ success: true, contrat: 2, scanId: String(scanId), analyse, facturation, ...(solde !== undefined ? { solde } : {}) });
    };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// B1b.5 — traiterReponse : la réponse à une question (POST /api/identifier/reponse { scanId, carte = 0, choix }).
// Rien n'est débité ici : le scan l'a été, et c'est ce débit-là qui est la facture. Répondre par un candidat le confirme (débité UNE fois) ; `aucune` et
// `ne-sait-pas` rendent le crédit ; une question de lot ne coûte ni ne rend rien. Toute la machine à états (prise conditionnelle, rejeu, conflit, 24 h) est celle
// de argent/questions.js : cette fonction ne la recopie pas, elle traduit son résultat en carte du contrat.
// La carte rendue se fabrique depuis la ligne `analyses` (les Produit des candidats y ont été écrits à l'analyse) : aucune relecture du catalogue.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
const CHOIX_REPONSE = Object.freeze(['a', 'b', 'c', 'aucune', 'ne-sait-pas']);
const FORME_ID = /^[0-9a-f]{24}$/i;
const produitsDe = (an, ids) => ids.map(id => (an.produits || []).find(p => p && p.idProduct === id)).filter(Boolean);

// La carte du contrat pour une réponse donnée. null si elle ne peut pas être fabriquée (produit absent de la ligne analyses).
function carteRepondue(an, entree, index, choix, idProduct) {
    if (choix === 'aucune') return { index, statut: 'introuvable', carte: null, candidats: [], question: null, raison: 'hors-catalogue', etat: null, prixLive: null, zone: null };
    if (choix === 'ne-sait-pas') {
        const ids = ((entree.question && entree.question.choix) || []).map(c => c.idProduct);
        const cands = produitsDe(an, ids);
        if (!entree.question || cands.length !== ids.length || cands.length < 2) return null;
        return { index, statut: 'a-trancher', carte: null, candidats: cands, question: entree.question, raison: null, etat: entree.etat ?? null, prixLive: null, zone: entree.zone ?? null };
    }
    const produit = produitsDe(an, [idProduct])[0];
    if (!produit || !entree.etat) return null;
    const l = entree.lecture || {};
    const prixLive = prixLiveDe({ codeLangue: l.codeLangue, reverse: l.reverseStrategie ? { strategie: l.reverseStrategie } : null }, idProduct, entree.etat);
    return { index, statut: 'identifiee', carte: produit, candidats: [], question: null, raison: null, etat: entree.etat, prixLive, zone: null };
}

function traiterReponse(cfg, deps = {}) {
    return async function traiterReponseV2(req, res) {
        const porteur = req.v2 && req.v2.porteur;
        let argent;
        try { argent = registre.obtenir('argent'); if (!porteur) throw new Error('montage incomplet'); }
        catch (e) { journalErreur('montage reponse', e); return repondreErreur(res, 'INDISPONIBLE'); }
        const entreeInvalide = detail => repondreErreur(res, 'ENTREE', undefined, { detail });
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b)) return entreeInvalide('corps');
        if (typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return entreeInvalide('scan-id');
        const carte = b.carte === undefined ? 0 : b.carte;
        if (!Number.isInteger(carte) || carte < 0 || carte > 99) return entreeInvalide('carte');
        if (typeof b.choix !== 'string' || !CHOIX_REPONSE.includes(b.choix)) return entreeInvalide('choix');
        const choix = b.choix;
        const scanId = new mongoose.Types.ObjectId(b.scanId);                  // une chaîne ne sert à aucun filtre : analyses, mouvements et questions portent un ObjectId
        const soldeSur = async () => { try { return await argent.solde(porteur); } catch (e) { journalErreur('solde', e); return undefined; } };
        // la ligne du scan, À CE PORTEUR : celle d'un autre porteur n'existe pas (404, jamais 403)
        let an;
        try { an = await col('analyses').findOne({ _id: scanId, porteur: `${porteur.type}:${porteur.id}` }); }
        catch (e) { journalErreur('analyses', e); return repondreErreur(res, 'INDISPONIBLE'); }
        const entree = an && Array.isArray(an.cartes) ? an.cartes[carte] : null;
        if (!entree || entree.statut !== 'a-trancher') return repondreErreur(res, 'CODE_INVALIDE', 'Question introuvable');
        const admin = Boolean(an.facturation && an.facturation.motif === 'administrateur');

        let facturation, idProduct = null, le = new Date();
        if (admin) {
            // un administrateur n'a rien débité : aucune question n'a été réservée. La réponse se résout sur la ligne analyses, et se rejoue / se contredit comme les autres.
            const ids = ((entree.question && entree.question.choix) || []);
            const dejaChoix = entree.reponse && entree.reponse.choix;
            if (dejaChoix && dejaChoix !== choix) return repondreErreur(res, 'CONFLIT', 'Une autre réponse a déjà été donnée');
            if (!dejaChoix) {
                const cand = ids.find(c => c.id === choix);
                if (!cand && !['aucune', 'ne-sait-pas'].includes(choix)) return entreeInvalide('choix');
                idProduct = cand ? cand.idProduct : null;
            } else { idProduct = entree.reponse.idProduct ?? null; le = entree.reponse.le || le; }
            facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });
        } else {
            let r;
            try { r = await argent.repondreQuestion(porteur, { scanId, carte, choix }); }
            catch (e) { journalErreur('repondreQuestion', e); return repondreErreur(res, 'INDISPONIBLE'); }
            if (r.statut === 404) return repondreErreur(res, 'CODE_INVALIDE', 'Question introuvable');
            if (r.statut === 400) return entreeInvalide('choix');
            if (r.statut === 409) return repondreErreur(res, 'CONFLIT', 'Une autre réponse a déjà été donnée');
            if (r.statut === 410) { const s = await soldeSur(); return repondreErreur(res, 'CODE_EXPIRE', 'La question a expiré', { facturation: { ...r.facturation, rembourse: Boolean(r.facturation.rembourse) }, ...(s !== undefined ? { solde: s } : {}) }); }
            if (r.statut !== 200 || !r.question) { console.error(`🔴 [v2 reponse] statut inattendu ${r.statut} pour ${scanId}`); return repondreErreur(res, 'SERVEUR'); }
            // argent/questions.js::facturationDe écrit `rembourse` en 0/1 ; le contrat (Facturation.rembourse) est un booléen : normalisé ici, à la frontière
            facturation = { ...r.facturation, rembourse: Boolean(r.facturation.rembourse) };
            idProduct = r.question.reponse && r.question.reponse.idProduct != null ? r.question.reponse.idProduct : null;
            le = (r.question.reponse && r.question.reponse.le) || le;
        }
        const resolue = carteRepondue(an, entree, carte, choix, idProduct);
        if (!resolue) { console.error(`🔴 [v2 reponse] scan ${scanId} : la carte ne peut pas être fabriquée depuis analyses (la question, elle, est réglée)`); return repondreErreur(res, 'SERVEUR'); }
        // 9. la réponse est une VÉRITÉ : écrite une fois (la première gagne), sans jamais changer la réponse au client
        try { await col('analyses').updateOne({ _id: scanId, [`cartes.${carte}.reponse`]: { $exists: false } }, { $set: { [`cartes.${carte}.reponse`]: { choix, idProduct, le } } }); }
        catch (e) { journalErreur('vérité de la réponse', e); }
        const solde = await soldeSur();
        return res.status(200).json({ success: true, carte: resolue, facturation, ...(solde !== undefined ? { solde } : {}) });
    };
}

module.exports = { validerEntree, verifierEntree, comparerVersions, traiterIdentifier, traiterReponse, facturationDe };
