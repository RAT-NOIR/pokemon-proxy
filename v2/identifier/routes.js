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
// B8.1 : une URL d'un hôte AUTORISÉ que deux analyseurs liraient différemment est refusée : une barre oblique inverse (WHATWG la lit comme « / », d'autres analyseurs comme la fin
// d'un identifiant : « https://images1.vinted.net\@evil.example/ » — l'URL part chez un tiers : le modèle), un identifiant ou mot de passe (`user@hôte`), un port, un espace ou un caractère
// de contrôle. Jugée APRÈS la liste blanche d'hôtes : un hôte hostile garde son refus « image-hote ».
const urlAmbigue = (u) => {
    if (/[\\\s\u0000-\u001f\u007f]/.test(u)) return true;
    try { const p = new URL(u); return p.username !== '' || p.password !== '' || p.port !== ''; } catch { return true; }
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
    if (corps.vintedEtat != null && typeof corps.vintedEtat !== 'string') return refus('ENTREE', 'vintedEtat invalide', 'vinted-etat');   // B8.1 : jamais ignoré en silence (avant : un objet donnait 200)
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
        if (urlAmbigue(u)) return refus('ENTREE', 'imageUrls : URL ambiguë (identifiant, port, barre inverse ou espace)', 'image-url');
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
const RG = require('./regle-g');                 // appelée À TRAVERS l'objet du module (RG.decisionRegleG) : un banc peut l'espionner
const { arbitrer } = require('./arbitrage-g');
const { executerLot } = require('./lot');
const MS = require('../argent/marque-scan');
const { cartesParScanMax } = require('./cartes-par-scan');

// Les motifs par lesquels la chaîne héritée REFUSE par égalité (et rembourse d'office) : index.js ~4846 et ~5019.
const MOTIFS_REFUS_EN_QUESTION = Object.freeze(['egalite-parfaite', 'nom-contredit-egalite', 'nom-contredit-sans-repli']);

// B1b.8 : un crochet `identifierLot` qui rend UN résultat ne fait pas un lot. Ce résultat tient lieu de réponse de la chaîne héritée, avec ses deux effets de bord sur le
// crédit que la vraie chaîne produit seule (la requête du crochet n'en porte pas) : une ambiguë POSE sa question, un refus par égalité est un remboursement DIFFÉRÉ (devient question).
// Tout le reste (introuvable, panne) est rendu par le filet de traiterIdentifier.
function chaineDepuisResultat(r) {
    return async (req, res) => {
        const corps = r && r.corps && typeof r.corps === 'object' ? r.corps : null;
        if (r && r.statutHttp === 200 && corps) {
            if (corps.success === true && corps.carte && corps.carte.ambigu === true)
                await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'lot-un-resultat', candidats: entiers(corps.candidats) });
            else if (corps.success === false && corps.natureRefus === 'refus-delibere' && MOTIFS_REFUS_EN_QUESTION.includes(corps.motifRefus))
                await req.credit.v2.rembourser(req, corps.motifRefus);
        }
        res.status((r && Number.isInteger(r.statutHttp)) ? r.statutHttp : 500).json(corps);
    };
}

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

// ── B1b.7 : la règle G, DERRIÈRE son interrupteur (V2_REGLE_G ET un fournisseur deps.voisins). Elle est consultée APRÈS la chaîne héritée (jamais à sa place) :
// seul un désaccord est un fait à journaliser, et le plus PRUDENT l'emporte (arbitrage-g.js). Elle ne peut que RENDRE PLUS PRUDENT : jamais promouvoir un
// introuvable ni une question en affirmation. Une règle G qui ne répond pas, lève ou ne tranche pas : la chaîne héritée décide, sans effet sur le débit.
// @returns null (rien à dire) | { resultat, desaccord, questionNeuve } — questionNeuve : une affirmation de la chaîne est devenue une QUESTION (son crédit doit être RÉSERVÉ).
// Le fournisseur de voisins est appelé APRÈS le débit : sa durée est BORNÉE (un fournisseur qui ne répond pas ne doit jamais garder une requête payée en suspens).
// Dépassement => la chaîne décide, journal du code seul. (deps.delaiVoisinsMs : surcharge pour les bancs.)
const DELAI_VOISINS_MS = 2000;
const CANDIDATS_MAX = 3;                         // la limite d'une question : celle que l'adaptateur applique déjà (question(), slice(0, 3))
function avecBorne(fonction, ms) {
    let minuteur;
    const borne = new Promise((_, rejeter) => { minuteur = setTimeout(() => rejeter(Object.assign(new Error('voisins : délai dépassé'), { code: 'VOISINS_DELAI' })), ms); });
    const promesse = Promise.resolve().then(fonction);
    promesse.catch(() => { });                   // une résolution ou un rejet TARDIF n'est jamais une erreur non gérée
    return Promise.race([promesse, borne]).finally(() => clearTimeout(minuteur));
}
const INTROUVABLE_REGLE_G = Object.freeze({ success: false, natureRefus: 'refus-delibere', motifRefus: 'numero-illisible' });   // -> introuvable « photo-illisible » : on ne sait pas, on n'affirme pas l'absence

async function consulterRegleG({ deps, cfg, entree, scanId, resultat, corpsChaine, produits, catalogue, adapterFn }) {
    let d;
    try {
        const ms = Number.isFinite(deps.delaiVoisinsMs) && deps.delaiVoisinsMs > 0 ? deps.delaiVoisinsMs : DELAI_VOISINS_MS;
        const v = await avecBorne(() => deps.voisins({ imageUrls: entree.imageUrls, scanId: String(scanId) }), ms);
        if (!v) return null;
        d = RG.decisionRegleG({ ligne: v.ligne, nEssais: v.nEssais, mesures: v.mesures, contexteG: v.contexteG }, v.seuils);
    } catch (e) { journalErreur('règle G', e); return null; }
    if (!d) return null;
    const c0 = resultat.analyse.cartes[0];
    const arb = arbitrer({ issue: resultat.issue, ids: c0.carte ? [c0.carte.idProduct] : c0.candidats.map(x => x.idProduct) }, d);
    if (arb.action === 'garder') return { resultat, desaccord: arb.desaccord, questionNeuve: false };
    // la lecture du catalogue peut TOMBER : c'est une panne (remboursée par le filet de l'appelant), jamais une absence
    const tout = new Map(produits);
    try {
        const manquants = arb.ids.filter(id => !tout.has(id));
        if (manquants.length) for (const [k, p] of await catalogue.lire(manquants)) tout.set(k, p);
    } catch (e) {
        journalErreur('catalogue (règle G)', e);
        return { resultat: { issue: 'panne', analyse: null, erreur: { code: 'INDISPONIBLE' } }, desaccord: { ...arb.desaccord, retenue: 'panne-catalogue' }, questionNeuve: false };
    }
    const ctx = { produits: tout, langueInterface: entree.langueInterface, cfg, ficheServie: false };
    const c = corpsChaine || {};
    const question = ids => {
        try {
            const r = adapterFn({ statutHttp: 200, corps: { success: true, carte: { ...(c.carte || {}), idProduct: ids[0], ambigu: true }, candidats: ids.map(idProduct => ({ idProduct })), etat: c.etat, codeLangue: c.codeLangue, reverse: c.reverse } }, ctx);
            return r && r.issue === 'question' ? r : null;
        } catch (e) { journalErreur('règle G (question)', e); return null; }
    };
    // 1. la question de G telle quelle, si TOUS ses candidats sont au catalogue de l'API
    let r = arb.ids.every(id => tout.has(id)) ? question(arb.ids) : null;
    if (r) return { resultat: r, desaccord: arb.desaccord, questionNeuve: true };
    // 2. repli, jamais vers l'affirmation (le moins prudent) : {candidat de la chaîne} ∪ {candidats de G PRÉSENTS}, dédoublonnés, plafonnés ; ≥ 2 => question
    const presents = [...new Set([...(c0.carte ? [c0.carte.idProduct] : []), ...arb.ids])].filter(id => tout.has(id)).slice(0, CANDIDATS_MAX);
    r = presents.length >= 2 ? question(presents) : null;
    if (r) return { resultat: r, desaccord: arb.desaccord, questionNeuve: true };
    // 3. sinon : introuvable (le crédit est rendu par le filet de l'appelant). Jamais « identifiee » : la chaîne a affirmé, G en doute, et on ne peut pas poser la question.
    let intro = null;
    try { intro = adapterFn({ statutHttp: 200, corps: INTROUVABLE_REGLE_G }, ctx); } catch (e) { journalErreur('règle G (introuvable)', e); }
    if (!intro || intro.issue !== 'introuvable') intro = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
    return { resultat: intro, desaccord: { ...arb.desaccord, retenue: 'introuvable-regle-g' }, questionNeuve: false };
}

function traiterIdentifier(cfg, deps = {}) {
    const catalogue = deps.catalogue || creerCatalogue({ cfg });
    const interne = async function traiterIdentifierV2(req, res, etat) {
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
        // 2 bis. O5 — LA MARQUE DE LIVRAISON, avant le débit (v2/argent/marque-scan.js) : aucun crédit n'est pris sans marque, pour une carte comme pour un lot, extension comme scanner.
        // Ouverte AVANT le débit (et non après) pour qu'aucun arrêt du processus ne tombe entre la prise du crédit et l'écriture de la marque ; retirée si le débit n'a rien pris.
        // Tant que ce gestionnaire traite, il BAT (suivre) ; il CLÔT la marque lui-même quand il a PRODUIT le résultat (fermer, plus bas), que le client soit encore là ou non : une coupure du
        // client ne rend jamais un scan. Une marque qui ne s'écrit pas BLOQUE : rien n'est débité, 503. Une marque dont le battement s'est arrêté (processus mort) est rendue ou confirmée par la passe.
        try { await MS.ouvrir({ scanId, porteur, cleDebit, cleClaim: (req.idempotence && req.idempotence.cle) || null }); }
        catch (e) { journalErreur('marque de livraison', e); return repondreErreur(res, 'INDISPONIBLE'); }
        etat.suivi = MS.suivre(scanId);
        const sansMarque = async () => { try { await MS.retirer(scanId); } catch (e) { journalErreur('retrait de la marque', e); } };   // un retrait raté laisse une marque que la passe clora (aucun débit : rien à rendre)
        const fermer = async () => { if (etat.suivi) etat.suivi.arreter(); try { await MS.clore(scanId); } catch (e) { journalErreur('clôture de la marque', e); } };   // un échec laisse la marque : la passe la confirme (analyse écrite) ou la rend
        // 3. LE DÉBIT, avant toute chose
        let debit;
        // (un débit qui LÈVE garde sa marque OUVERTE, battement arrêté : le crédit a pu être pris, la passe le dira — jamais close ici)
        try { debit = await argent.debiter(porteur, { scanId, cleIdempotence: cleDebit }); }
        catch (e) { journalErreur('débit', e); return repondreErreur(res, 'INDISPONIBLE'); }
        // ni refus, ni rejeu, ni administrateur ne prennent de crédit : pas de marque
        if (!debit || !debit.ok || debit.rejoue || debit.administrateur === true) await sansMarque();
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
        let reqH = null, rembourserOrigine = null, sortie, lecture = null, desaccordG = null;
        const rembourserMoi = (motif) => reqH.credit.v2.rembourser(reqH, motif, { compteur: 'panne' });
        // B1b.8 : le crochet `deps.identifierLot` ABSENT (ou autre chose qu'une fonction) => une seule carte, comme avant le lot, octet pour octet. Présent, la requête est
        // un LOT : v2/identifier/lot.js (coût par tranche de 10, ordre par valeur, supplément tout-ou-rien). La règle G ne s'y applique jamais : elle juge UNE carte et
        // n'est consultée que dans la branche à une carte ci-dessous.
        // ✅ O5 (M5 de B1b.8) : un arrêt du processus entre le débit (ou le supplément) et la réponse laissait un DÉBIT À VIE (jusqu'à 10 crédits) que la réconciliation ne voyait pas.
        // La marque de livraison ouverte plus haut (v2/argent/marque-scan.js) couvre TOUS les débits du scan, supplément compris : la passe de rattrapage rend le scan, ou le confirme.
        const modeLot = typeof deps.identifierLot === 'function';
        let erreurLot = null, injecte = null;
        try {
            if (modeLot) {
                const l = await executerLot({ cfg, deps, catalogue, argent, porteur, entree, annonce, scanId, cleDebit, admin, credit, ip: req.ip, userId, facturationDe });
                if (l.erreur) erreurLot = l.erreur; else if ('unique' in l) injecte = l.unique; else sortie = l.sortie;     // la présence se teste par la FORME, jamais par la valeur
            }
            // Pas de lot (crochet absent) OU un crochet qui n'a rendu qu'UN résultat : la branche UNE-CARTE (règle G, question réservée, sans-prix), qui reçoit ce résultat
            // comme réponse de la chaîne — sans la rappeler (un seul appel de lecture).
            if (!sortie && !erreurLot) {
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
                try { await (injecte ? chaineDepuisResultat(injecte) : deps.gererIdentifier)(reqH, fr); } catch (e) { exception = e; journalErreur('chaîne héritée', e); }
                let resultat, produits = null;
                if (exception || !fr.headersSent) resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
                else {
                    // 5. le catalogue de l'API pour les produits que la chaîne désigne, puis l'adaptation
                    const c = fr.corps && typeof fr.corps === 'object' ? fr.corps : {};
                    // B1b.5 : ce que /reponse ne pourra pas relire (la langue lue et la stratégie reverse) pour fabriquer le prixLive d'une carte tranchée
                    lecture = { codeLangue: codeLangueDe(c), reverseStrategie: c.reverse && typeof c.reverse.strategie === 'string' ? c.reverse.strategie : null };
                    const ids = [...entiers(c.candidats), ...(c.carte && Number.isInteger(c.carte.idProduct) ? [c.carte.idProduct] : [])];
                    try { produits = await catalogue.lire(ids); } catch (e) { journalErreur('catalogue', e); }
                    resultat = produits === null ? { issue: 'panne', analyse: null, erreur: { code: 'INDISPONIBLE' } }
                        : (deps.adapter || adapter)({ statutHttp: fr.statut, corps: fr.corps }, { produits, langueInterface: entree.langueInterface, cfg, ficheServie: false });
                    // B1b.7 : la règle G, si (et seulement si) l'interrupteur est allumé ET qu'un fournisseur de voisins est branché ; jamais sur une panne
                    if (resultat.issue !== 'panne' && RG.regleGActive(cfg, deps)) {
                        const g = await consulterRegleG({ deps, cfg, entree, scanId, resultat, corpsChaine: c, produits, catalogue, adapterFn: deps.adapter || adapter });
                        if (g) {
                            resultat = g.resultat; desaccordG = g.desaccord;
                            if (g.questionNeuve) reqH.regleGRaison = 'regle-g';        // l'affirmation de la chaîne est devenue une question : son crédit est RÉSERVÉ plus bas
                            if (desaccordG) console.warn(`⚠️ [v2 règle G] desaccordRegleG scan=${scanId} ${JSON.stringify(desaccordG)}`);
                        }
                    }
                }
                // une question née d'un REFUS (remboursement différé) : la chaîne ne l'a pas posée, on la RÉSERVE ici, avec les choix du contrat
                // (B1b.7 : même chemin pour une affirmation de la chaîne que la règle G transforme en question — son crédit est encore pris, on le réserve)
                if (resultat.issue === 'question' && (reqH.refusDiffere || reqH.regleGRaison) && !reqH.questionId && !admin && credit) {
                    let r = null;
                    try {
                        const choix = resultat.question.choix.map(x => ({ id: x.id, idProduct: x.idProduct }));
                        r = await argent.reserverQuestion(porteur, credit, { scanId, carte: 0, raison: reqH.refusDiffere || reqH.regleGRaison, candidats: choix.map(x => x.idProduct), choix });
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
                        const r = await col('questions_v2').updateOne({ _id: `${scanId}:0`, etat: 'en-attente' }, { $set: { choix: resultat.question.choix.map(x => ({ id: x.id, idProduct: x.idProduct })) } });
                        ok = r.matchedCount === 1;
                    } catch (e) { journalErreur('choix de la question', e); }
                    if (!ok) resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
                }
                // le filet : une panne ou un « introuvable » sont TOUJOURS rendus ; si la chaîne ne l'a pas tenté, c'est ici (annule aussi une question réservée)
                if (!admin && credit && (resultat.issue === 'panne' || resultat.issue === 'introuvable') && !reqH.scanRembourse) {
                    try { await rembourserMoi(resultat.issue === 'panne' ? `panne-${resultat.erreur.code}` : 'introuvable'); } catch (e) { journalErreur('remboursement', e); }
                }
                const faits = { admin, rendu: Boolean(reqH.scanRendu), question: Boolean(reqH.questionId) && resultat.issue === 'question', cause: reqH.scanRendu ? null : raisonNonRemboursement() };
                return { resultat, facturation: facturationDe(resultat.issue, faits), lecture, desaccord: desaccordG };
            });
            }
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
            await fermer();                                // le scan est rendu (ou dit non rendu) : le résultat est produit
            return repondreErreur(res, 'SERVEUR', undefined, { facturation, ...(s !== undefined ? { solde: s } : {}) });
        }
        // 7. le solde, relu APRÈS les mouvements
        const solde = await soldeSur();
        if (erreurLot) {                              // un lot qu'on ne peut pas payer (QUOTA « lot-trop-grand »…) : le crédit initial est déjà rendu, la facturation le dit
            await fermer();
            return repondreErreur(res, erreurLot.code, undefined, { facturation: erreurLot.facturation, ...(erreurLot.detail !== undefined ? { detail: erreurLot.detail } : {}),
                ...(erreurLot.code === 'QUOTA' && porteur.type === 'compte' ? { achat: { url: URL_RECHARGE } } : {}), ...(solde !== undefined ? { solde } : {}) });
        }
        const { resultat, facturation } = sortie;
        if (resultat.issue === 'panne') {
            await fermer();
            return repondreErreur(res, resultat.erreur.code, undefined, { facturation, ...(solde !== undefined ? { solde } : {}) });
        }
        // 8. la règle de verdict (au scanner : null — la surface le dit ; ici l'extension)
        let regle = null;
        try { regle = await regleVerdict(entree.devise); } catch (e) { journalErreur('taux', e); }
        const analyse = { ...resultat.analyse, regleVerdict: regle };
        // 9. les écritures annexes : sans effet sur la réponse
        try {
            const maintenant = new Date();
            // B1b.8 : pour un lot, la ligne `analyses` range les cartes dans l'ordre d'ENTRÉE (cartes[carte] = la carte `index` de /reponse), la réponse dans l'ordre des valeurs
            const cartes = sortie.cartesEntree || analyse.cartes;
            await col('analyses').insertOne({
                _id: scanId, porteur: `${porteur.type}:${porteur.id}`, surface: porteur.surface, statut: analyse.statut,
                // B1b.5 : de quoi servir /reponse sans relire le catalogue — l'état, la question, la zone (aucune donnée de l'annonce) et la lecture de la langue
                cartes: cartes.map((c, i) => ({ idProduct: c.carte ? c.carte.idProduct : null, statut: c.statut, raison: c.raison, etat: c.etat ?? null, question: c.question ?? null, zone: c.zone ?? null,
                    ...(sortie.lectures ? { lecture: sortie.lectures[i] } : i === 0 && sortie.lecture ? { lecture: sortie.lecture } : {}) })),
                produits: cartes.flatMap(c => (c.carte ? [c.carte] : c.candidats)), facturation,
                ...(sortie.desaccord ? { desaccordRegleG: sortie.desaccord } : {}),          // B1b.7 : un désaccord règle G / chaîne héritée n'est jamais tranché en silence
                creeLe: maintenant, expireLe: new Date(maintenant.getTime() + cfg.retention.analysesMois * 30.5 * 86400e3)
            });
        } catch (e) { journalErreur('analyses', e); }
        try { await conserverAnnonce(String(scanId), { titre: annonce.titre, description: annonce.description, expurgeeParServeur: annonce.expurgeeParServeur }, cfg); } catch (e) { journalErreur('annonces', e); }
        // La clôture est la DERNIÈRE opération d'argent de la requête : un arrêt avant elle se rattrape (la marque reste ouverte, la passe rend ou confirme). Au scanner, le remboursement
        // `sans-prix` se fait DANS res.json (scanner/routes.js, habiller) : c'est lui qui clôt, après ce geste ; le battement reste alors vivant jusque-là (etat.differe).
        // Le gestionnaire VIVANT ferme `livre` lui-même, que le client soit encore là ou non : une coupure du client ne rend rien.
        if (req.marqueFermeeParLaReponse === true) { req.fermerMarque = fermer; etat.differe = true; } else await fermer();
        // 10. la réponse (B6.4 : le crochet du banc réel — jamais attendu, ne lève jamais, rien n'en entre dans la réponse)
        require('../banc/crochet').apresIdentifier({ cfg, deps, req, scanId, analyse });
        return res.status(200).json({ success: true, contrat: 2, scanId: String(scanId), analyse, facturation, ...(solde !== undefined ? { solde } : {}) });
    };
    return async function traiterIdentifierV2(req, res) {
        const etat = { suivi: null, differe: false };
        // le battement s'arrête quoi qu'il arrive (sauf clôture différée à la réponse : elle l'arrête elle-même, le filet de 30 min couvre un oubli)
        try { return await interne(req, res, etat); } finally { if (etat.suivi && !etat.differe) etat.suivi.arreter(); }
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
        if (!Number.isInteger(carte) || carte < 0 || carte >= cartesParScanMax(cfg)) return entreeInvalide('carte');
        if (typeof b.choix !== 'string' || !CHOIX_REPONSE.includes(b.choix)) return entreeInvalide('choix');
        const choix = b.choix;
        const scanId = new mongoose.Types.ObjectId(b.scanId);                  // une chaîne ne sert à aucun filtre : analyses, mouvements et questions portent un ObjectId
        const soldeSur = async () => { try { return await argent.solde(porteur); } catch (e) { journalErreur('solde', e); return undefined; } };
        // la ligne du scan, À CE PORTEUR : celle d'un autre porteur n'existe pas (404, jamais 403)
        let an;
        try { an = await col('analyses').findOne({ _id: scanId, porteur: `${porteur.type}:${porteur.id}` }); }
        catch (e) { journalErreur('analyses', e); return repondreErreur(res, 'INDISPONIBLE'); }
        if (!an) {
            // Pas de ligne analyses À CE PORTEUR. Si la QUESTION de ce porteur existe, c'est une panne de notre côté (l'écriture annexe de l'analyse a échoué) : 404 voudrait dire
            // « scan d'un autre porteur » et ferait abandonner à tort. 503 INDISPONIBLE, réessayable, question intacte (le balayage la rend à 24 h si rien ne revient).
            // Sans question non plus : le scan n'existe pas pour ce porteur => 404.
            let q = null;
            try { q = await col('questions_v2').findOne({ _id: `${scanId}:${carte}`, 'porteur.type': porteur.type, 'porteur.id': porteur.id }, { projection: { _id: 1 } }); }
            catch (e) { journalErreur('question', e); return repondreErreur(res, 'INDISPONIBLE'); }
            if (q) { console.error(`🔴 [v2 reponse] scan ${scanId} (${porteur.type}:${porteur.id}) : question présente, ligne analyses ABSENTE — réponse refusée en 503, question intacte`); return repondreErreur(res, 'INDISPONIBLE', undefined, { detail: 'analyse-absente' }); }
            return repondreErreur(res, 'CODE_INVALIDE', 'Question introuvable');
        }
        const entree = Array.isArray(an.cartes) ? an.cartes[carte] : null;
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
            if (r.statut === 410) { const s = await soldeSur(); return repondreErreur(res, 'CODE_EXPIRE', 'La question a expiré', { facturation: r.facturation, ...(s !== undefined ? { solde: s } : {}) }); }
            if (r.statut !== 200 || !r.question) { console.error(`🔴 [v2 reponse] statut inattendu ${r.statut} pour ${scanId}`); return repondreErreur(res, 'SERVEUR'); }
            facturation = r.facturation;
            idProduct = r.question.reponse && r.question.reponse.idProduct != null ? r.question.reponse.idProduct : null;
            le = (r.question.reponse && r.question.reponse.le) || le;
        }
        const resolue = carteRepondue(an, entree, carte, choix, idProduct);
        if (!resolue) { console.error(`🔴 [v2 reponse] scan ${scanId} : la carte ne peut pas être fabriquée depuis analyses (la question, elle, est réglée)`); return repondreErreur(res, 'SERVEUR'); }
        // 9. la réponse est une VÉRITÉ : écrite une fois (la première gagne), sans jamais changer la réponse au client
        try { await col('analyses').updateOne({ _id: scanId, [`cartes.${carte}.reponse`]: { $exists: false } }, { $set: { [`cartes.${carte}.reponse`]: { choix, idProduct, le } } }); }
        catch (e) { journalErreur('vérité de la réponse', e); }
        const solde = await soldeSur();
        // B6.4 : le crochet du banc réel, APRÈS la vérification du porteur (analyses) et l'acceptation de la réponse ; jamais attendu, ne lève jamais
        require('../banc/crochet').apresReponse({ cfg, req, scanId: b.scanId, carte, choix, idProduct });
        return res.status(200).json({ success: true, carte: resolue, facturation, ...(solde !== undefined ? { solde } : {}) });
    };
}

module.exports = { DELAI_VOISINS_MS, validerEntree, verifierEntree, comparerVersions, traiterIdentifier, traiterReponse, facturationDe, URL_RECHARGE };
