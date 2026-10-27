'use strict';
// Lot B1b — routes de /api/identifier (contrat 2). PREMIÈRE PARTIE (B1b.1) : l'entrée est validée AVANT tout débit.
// `validerEntree` n'écrit nulle part : un refus ici ne touche ni `mouvements` ni aucune autre collection.
const { repondreErreur } = require('../erreurs');
const { HOTES_PHOTO_AUTORISES } = require('../../departage-image');   // la liste blanche de la production, pas une copie
const { lireEnveloppe } = require('./voisins-empreinte');             // MODELE-VISUEL-API : la forme des empreintes de l'extension

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

// PHOTOS-MULTIPLES (7d) : `photoIds: [{ index, photoId }]` (au plus 8, un par index, l'index existe dans imageUrls et va de 0 à 7) ou l'ancien `photoId` seul (= l'index 0). Pure ; ne lit PAS le magasin.
// (C2, C3) Le `photoId` SEUL, mal formé, est `photo-id` ; DANS `photoIds` (de 1 à 8 couples), un `photoId` mal formé comme toute autre forme absurde est `photo-ids`. Bien formé mais inconnu, expiré, d'un autre porteur ou servi : jugé PLUS TARD (rattacherPhotos), ignoré.
const FORME_PHOTO_ID = /^[0-9a-f]{32}$/;
const PHOTO_INDEX_MAX = 7;
function lirePhotoIds(corps, nUrls) {
    const a = k => Object.prototype.hasOwnProperty.call(corps, k);
    if (a('photoId') && a('photoIds')) return { erreur: 'photo-ids' };
    if (a('photoId')) return typeof corps.photoId === 'string' && FORME_PHOTO_ID.test(corps.photoId) ? { photoIds: [{ index: 0, photoId: corps.photoId }] } : { erreur: 'photo-id' };
    if (!a('photoIds')) return { photoIds: [] };
    const l = corps.photoIds;
    if (!Array.isArray(l) || l.length < 1 || l.length > PHOTO_INDEX_MAX + 1) return { erreur: 'photo-ids' };
    const vus = new Set(), sortie = [];
    for (const e of l) {
        if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k => k !== 'index' && k !== 'photoId')) return { erreur: 'photo-ids' };
        if (!Number.isInteger(e.index) || e.index < 0 || e.index > PHOTO_INDEX_MAX || e.index >= nUrls) return { erreur: 'photo-ids' };
        if (typeof e.photoId !== 'string' || !FORME_PHOTO_ID.test(e.photoId)) return { erreur: 'photo-ids' };
        if (vus.has(e.index)) return { erreur: 'photo-ids' };
        vus.add(e.index); sortie.push({ index: e.index, photoId: e.photoId });
    }
    return { photoIds: sortie };
}

// PHOTOS-MULTIPLES (7d) : appelée par traiterIdentifier une fois la requête ACCEPTÉE (après la validation du corps, les plafonds, la prise de la clé d'idempotence, le débit ou le passage de l'administrateur, et le frein de dépense du modèle),
// JUSTE AVANT la chaîne : les photos reçues pour ce scan sortent alors du magasin (UNE FOIS chacune) et rejoignent `req.entree` : `photosRecues` ([{ index, octets, modele }], l'index DÉCLARÉ ici) et `imageOctets` (celle d'index le plus bas,
// 1 600 px : la seconde lecture lit une carte). Une requête refusée avant cet endroit laisse ses photos au magasin pour son rejeu (120 s). Absente, expirée, d'un autre porteur, déjà servie : ignorée, sans erreur. Ne lève jamais.
// I-2 : à la FIN de la réponse (`close`, après `finish` ou une coupure), les octets sont libérés (photos-recues.js::libererPhotos) : 30 s de service + un scan de 90 s au plus = 120 s au plus en mémoire.
function rattacherPhotos(req, deps = {}, res = null) {
    try {
        const entree = req && req.entree;
        const demandees = entree && Array.isArray(entree.photoIds) ? entree.photoIds : [];
        const p = req.v2 && req.v2.porteur;
        if (!demandees.length || !p || entree.photosRecues) return;
        const m = require('./photos-recues').magasin(deps), cle = `${p.type}:${p.id}`, recues = [], dureesDepot = [];
        let depotMin = Infinity;
        for (const d of demandees) { const x = m.prendre(cle, d.photoId); if (x) { recues.push({ index: d.index, octets: x.octets, modele: x.modele }); if (x.durees) dureesDepot.push(x.durees); if (Number.isFinite(x.depotA) && x.depotA < depotMin) depotMin = x.depotA; } }
        if (recues.length) {
            // TEMPS-ETAPES : la durée du dépôt (POST /api/photo) de la photo la plus longue à déposer ; non énumérable (jamais sérialisée avec l'entrée)
            const maxDe = k => dureesDepot.map(x => x[k]).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), -1);
            if (dureesDepot.length) Object.defineProperty(entree, 'photoDureesMs', { value: { totalMs: maxDe('totalMs'), traitementMs: maxDe('traitementMs') }, enumerable: false, configurable: true });
            const PR = require('./photos-recues');
            recues.sort((a, b) => a.index - b.index); entree.photosRecues = recues; entree.imageOctets = recues[0].octets;
            entree.photosRecuesPourCeScan = true;          // N-1 : des photos ont été reçues pour CE scan ; plus aucune étape ne retombe sur les URLs de l'annonce (imagesDeLaChaine, photo-admin), même une fois les octets libérés
            // I-2 : LE SERVEUR tient la borne de 90 s (au plus tôt de : dépôt de la plus ancienne + 120 s, début de l'analyse + 90 s). À l'arrêt : le signal part vers les appels en cours, l'analyse finit par le chemin d'échec existant
            // (le crédit pris est rendu) et les octets sont libérés. La fin de la réponse retire le minuteur et libère les octets.
            const borne = PR.poserBorne(entree, m, Number.isFinite(depotMin) ? depotMin : (typeof m.maintenant === 'function' ? m.maintenant() : Date.now()));
            entree.arret = borne;
            if (res && typeof res.once === 'function') res.once('close', () => { borne.annuler(); PR.libererPhotos(entree); });
        }
    } catch (e) { console.error(`❌ [v2 photos-recues] rattachement (${(e && (e.code || e.name)) || 'erreur'})`); }
}

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
    // PHOTOS-MULTIPLES (7d) : SEULEMENT drapeau allumé. Éteint, `photoIds` et `photoId` sont des champs inconnus comme aujourd'hui (ignorés, jamais une erreur) et `entree` n'a pas une clé de plus.
    let photoIds = null;
    if (cfg.photosMultiples === true) {
        const p = lirePhotoIds(corps, urls.length);
        if (p.erreur) return refus('ENTREE', 'photoIds invalide', p.erreur);
        photoIds = p.photoIds;
    }
    // MODELE-VISUEL-API : `empreintes` / `modeleEmpreinte` ne sont LUS que si V2_EMPREINTE_EXTENSION=1 (éteint : la requête est jugée comme avant, octet pour octet). Une enveloppe fautive ne refuse JAMAIS la requête :
    // l'empreinte est un plus, jamais un passage obligé ; le défaut est dit dans la réponse (`empreinte`, code « invalide »).
    const empreintes = cfg.empreinteExtension === true ? lireEnveloppe(corps, urls.length) : null;
    // CALCUL-CLIENT : `capacitesClient` n'est LU que si V2_MESURES_CLIENT=1 (éteint : un champ inconnu, ignoré comme aujourd'hui). Il ne refuse jamais la requête : seule la valeur exacte « mesures-1 » dans un tableau compte.
    const mesuresClient = cfg.mesuresClient === true && Array.isArray(corps.capacitesClient) && corps.capacitesClient.length <= 8 && corps.capacitesClient.includes('mesures-1');
    return { entree: {
        ...(photoIds ? { photoIds } : {}),
        ...(mesuresClient ? { mesuresClient: true } : {}),
        imageUrls: [...urls], title: (corps.title || '').slice(0, TITRE_MAX), description: (corps.description || '').slice(0, DESCRIPTION_MAX),
        prixVinted: prix, devise, marche: corps.marche, vintedUrl,
        vintedEtat: typeof corps.vintedEtat === 'string' ? corps.vintedEtat.slice(0, 100) : null,   // REÇU et JOURNALISÉ, jamais utilisé (ETAT-VENDEUR, 2026-10-18) : passé à la chaîne héritée, qui le journalise et ne le lit pour aucune décision ; borné (mineur reporté de B1b.1)
        langueInterface: corps.langueInterface === 'en' ? 'en' : 'fr', versionExtension: corps.versionExtension.trim(),
        ...(empreintes ? { empreintes } : {})
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
const { adapter, codeLangueDe, prixLiveDe, affirmerParLaRoute } = require('./adaptateur');
const { appliquerMarqueurs } = require('./garde-marqueurs');        // MARQUEURS : le jumbo par le titre et la garde des groupes, derrière V2_JUMBO_TITRE et V2_GARDE_MARQUEURS (éteints : jamais appelée)
const { fournisseurParDefaut, idsAffirmes, idsACharger } = require('./jumeaux');
const { idsDeLaGarde } = require('./garde-contradiction');
const { preparer: preparerLD } = require('./langue-decisive-charge');
const etatChargeur = require('../chargeur/etat');
const { creerCatalogue } = require('./catalogue');
const { regleVerdict: regleVerdictBrute, cacheDuModule: cacheTaux } = require('./taux');
const regleVerdict = devise => regleVerdictBrute(devise, { cache: cacheTaux });        // PERF-SCAN P3 : le taux du jour, gardé 120 s par (devise, jour de Paris), vidé par l'écriture des taux (taux.js)
const { avecRepliAnalyse, analyseAvecRepli } = require('./prix-repli');
const { preparerAnnonce } = require('../annonce/verifier');
const { conserverAnnonce } = require('../annonce/conservation');
const { facturation: fabriquerFacturation, raisonPublique } = require('../argent/facturation');
const { offreSur, avecOffre, offreRefusee } = require('../argent/offre-sur');
const { dansUnScan, raisonNonRemboursement, noterNonRemboursement } = require('../../sources');
const { col } = require('../db');
const { choixPour } = require('../choix');
const SL = require('./seconde-lecture');
const TE = require('./temps-etapes');             // TEMPS-ETAPES : les durées par étape (analyses.durees) et les quatre coupes de temps (éteintes par défaut)
const { consulterLectureTampon } = require('./lecture-tampon-route');       // F1-TAMPON : la décision vit dans son module (aucun appel réseau, aucun téléchargement)
const { consulterSurParImage } = require('./sur-par-image-route');         // SUR-PAR-IMAGE : la décision vit dans son module (pure sur le vecteur de l'extension, aucun appel réseau)
const RG = require('./regle-g');                 // appelée À TRAVERS l'objet du module (RG.decisionRegleG) : un banc peut l'espionner
const { arbitrer } = require('./arbitrage-g');
const { executerLot } = require('./lot');
const MS = require('../argent/marque-scan');
const DEPENSE = require('../argent/depense-modele');
const { natureDuMotif } = require('../argent/nature-du-motif');
const PS = require('../argent/poche-servie');      // ACHETE-AVANT-JOUR : facturation.poche
// FREIN-CONSTATES : la garde de dépense du modèle de cette configuration (un banc en injecte une par deps.depenseModele ; sinon celle du processus)
const depenseDe = (cfg, deps) => (deps && deps.depenseModele && typeof deps.depenseModele.autorise === 'function' ? deps.depenseModele : DEPENSE.pourConfig(cfg));
const { cartesParScanMax } = require('./cartes-par-scan');
const { imagesDeLaChaine } = require('./photos-recues');   // PHOTOS-MULTIPLES (7d) : les images que la chaîne reçoit (les octets des photos reçues, ou les URLs de l'annonce)

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
function avecBorne(fonction, ms, nom = 'voisins', code = 'VOISINS_DELAI') {
    let minuteur;
    const borne = new Promise((_, rejeter) => { minuteur = setTimeout(() => rejeter(Object.assign(new Error(`${nom} : délai dépassé`), { code })), ms); });
    const promesse = Promise.resolve().then(fonction);
    promesse.catch(() => { });                   // une résolution ou un rejet TARDIF n'est jamais une erreur non gérée
    return Promise.race([promesse, borne]).finally(() => clearTimeout(minuteur));
}
// ── SECONDE-LECTURE (§72), DERRIÈRE son interrupteur (V2_SECONDE_LECTURE ET un fournisseur deps.secondeLecture). Consultée APRÈS l'adaptateur, sur UN seul cas : la chaîne a AFFIRMÉ P, la garde des
// jumeaux en a fait une QUESTION (P et 1 ou 2 jumeaux, tous au catalogue de l'API), et la première lecture a lu au moins le code ou le numéro. Elle ne peut que CONFIRMER P (seconde-lecture.js::decider) :
// toute autre issue (autre lecture, rien de lisible, échec, délai, deuxième passage) laisse la réponse d'AVANT, sans débit ni remboursement de plus. Le fournisseur est appelé APRÈS le débit : sa durée
// est BORNÉE (deps.delaiSecondeMs en banc). Chaque appel TENTÉ est compté (le coût) et la trace va dans `analyses.secondeLecture` — jamais dans la réponse.
// @returns null (pas le cas visé : rien d'appelé, rien de noté) | { resultat?, trace } — resultat : l'affirmation, SEULEMENT si la seconde lecture confirme.
const DELAI_SECONDE_MS = 20000;
async function consulterSecondeLecture({ deps, cfg, entree, scanId, resultat, corpsChaine, produits, jumeaux, rejouer }) {
    if (!(cfg && cfg.secondeLecture === true && deps && typeof deps.secondeLecture === 'function')) return null;
    const c = corpsChaine && typeof corpsChaine === 'object' ? corpsChaine : null, carte = c && c.carte;
    if (!resultat || resultat.issue !== 'question' || resultat.motif || resultat.contradiction || !c || c.success !== true || !carte || carte.ambigu !== false || !Number.isInteger(carte.idProduct)) return null;
    let p, js;
    try {
        const r = typeof jumeaux === 'function' ? jumeaux(carte.idProduct) : null;
        if (!r || r.conclu !== true || !Array.isArray(r.ids) || !r.ids.every(Number.isInteger)) return null;
        const ids = [...new Set(r.ids)].filter(i => i !== carte.idProduct);
        if (!(produits instanceof Map) || !produits.has(carte.idProduct) || ids.some(i => !produits.has(i))) return null;
        p = produits.get(carte.idProduct); js = ids.map(i => produits.get(i));
    } catch { return null; }
    const premiere = { setCode: carte.setCode, numero: carte.numero, langue: carte.langue };
    if (!SL.besoin({ p, jumeaux: js, premiere }).declencher) return null;
    if (!SL.premiereFois(String(scanId))) return { trace: { declenchee: false, appels: 0, issue: 'deja-tentee', raison: 'ce scan a déjà eu sa seconde lecture' } };
    SL.noter('declenchees');
    // TOUR 1 (coût exact) : le compteur ÉCRIT au compteur global à chaque appel, au moment où il part — un appel tardif d'un fournisseur sourd au signal est donc compté lui aussi ; le signal d'abandon
    // tombe au délai, et le fournisseur n'envoie plus d'appel après lui. Aucun téléchargement (décision 4) : les OCTETS de l'image viennent de l'appelant (entree.imageOctets, un jour l'extension), jamais d'une URL.
    let appels = 0;
    const compteur = { get appels() { return appels; }, set appels(v) { if (Number.isInteger(v) && v > appels) { SL.noter('appels', v - appels); appels = v; } } };
    const abandon = new AbortController();
    if (entree && entree.arret && entree.arret.signal) { if (entree.arret.signal.aborted) abandon.abort(); else entree.arret.signal.addEventListener('abort', () => abandon.abort(), { once: true }); }      // I-2 : la borne du scan annule aussi la seconde lecture
    let lu = null, issue = null, raison = null;
    try {
        const ms = Number.isFinite(deps.delaiSecondeMs) && deps.delaiSecondeMs > 0 ? deps.delaiSecondeMs : DELAI_SECONDE_MS;
        lu = await avecBorne(() => deps.secondeLecture({ image: entree && entree.imageOctets, corps: c, scanId: String(scanId), compteur, signal: abandon.signal }), ms, 'seconde lecture', 'SECONDE_DELAI');
    } catch (e) {
        issue = e && e.code === 'SECONDE_DELAI' ? 'delai' : 'echec'; raison = issue === 'delai' ? 'délai dépassé' : 'le fournisseur a levé';
        if (issue === 'delai') abandon.abort(); else journalErreur('seconde lecture', e);
    }
    const trace = () => ({ declenchee: true, appels: compteur.appels, issue, raison });
    if (!issue) {
        if (!lu || typeof lu !== 'object') { issue = 'rien'; raison = 'le fournisseur n\'a rien rendu'; }
        else if (lu.sansImage === true) { issue = 'sans-image'; raison = 'aucun octet d\'image fourni : pas de seconde lecture'; SL.noter('nonFaisables'); console.log(`🔎 [v2 seconde-lecture] scan=${scanId} sans-image appels=${compteur.appels}`); return { trace: trace() }; }
        else if (lu.echec === true) { issue = 'echec'; raison = String(lu.raison || 'échec de la lecture').slice(0, 200); }
        else {
            if (compteur.appels === 0 && Array.isArray(lu.essais) && lu.essais.length === 0) SL.noter('nonFaisables');     // aucune bande à lire (pas de recadrage possible) : rien n'a coûté, rien n'a été lu
            const d = SL.decider({ p, jumeaux: js, premiere, seconde: lu });
            raison = d.raison;
            if (d.confirme) {
                let aff = null;
                try { aff = rejouer(id => (id === carte.idProduct ? { conclu: true, ids: [] } : jumeaux(id))); } catch (e) { journalErreur('seconde lecture (affirmation)', e); }
                if (aff && aff.issue === 'affirmee') { issue = 'confirmee'; SL.noter('confirmees'); console.log(`🔎 [v2 seconde-lecture] scan=${scanId} confirmée appels=${compteur.appels}`); return { resultat: aff, trace: trace() }; }
                issue = 'non-confirmee'; raison = 'la confirmation n\'a pas pu produire une affirmation';
            } else issue = 'non-confirmee';
        }
    }
    if (issue === 'echec' || issue === 'delai') SL.noter('echecs'); else SL.noter('nonConfirmees');
    console.log(`🔎 [v2 seconde-lecture] scan=${scanId} ${issue} appels=${compteur.appels}`);
    return { trace: trace() };
}
const INTROUVABLE_REGLE_G = Object.freeze({ success: false, natureRefus: 'refus-delibere', motifRefus: 'numero-illisible' });   // -> introuvable « photo-illisible » : on ne sait pas, on n'affirme pas l'absence

async function consulterRegleG({ deps, cfg, entree, scanId, resultat, corpsChaine, produits, catalogue, adapterFn }) {
    let d;
    try {
        const ms = Number.isFinite(deps.delaiVoisinsMs) && deps.delaiVoisinsMs > 0 ? deps.delaiVoisinsMs : DELAI_VOISINS_MS;
        const v = await avecBorne(() => deps.voisins({ imageUrls: imagesDeLaChaine(entree), scanId: String(scanId) }), ms);
        if (!v) return null;
        d = RG.decisionRegleG({ ligne: v.ligne, nEssais: v.nEssais, mesures: v.mesures, contexteG: v.contexteG }, v.seuils);
    } catch (e) { journalErreur('règle G', e); return null; }
    if (!d) return null;
    return appliquerDecisionG({ cfg, entree, resultat, corpsChaine, produits, catalogue, adapterFn, d });
}

// La décision de G, appliquée à la réponse de la chaîne. Extraite de consulterRegleG (MODELE-VISUEL-API) pour que la voie du vecteur de l'extension (consulterEmpreinte) applique le MÊME code : `arbitre` vaut
// l'arbitrage prudent d'arbitrage-g.js par défaut (la voie de V2_REGLE_G ne bouge pas d'un octet) ; la voie du vecteur y met l'arbitrage AVEC promotion (promotion-g.js), qui peut répondre « promouvoir ».
// @returns { resultat, desaccord, questionNeuve, promotion?, concordante? }
async function appliquerDecisionG({ cfg, entree, resultat, corpsChaine, produits, catalogue, adapterFn, d, arbitre = arbitrer, jumeaux = null }) {
    const c0 = resultat.analyse.cartes[0];
    const arb = arbitre({ issue: resultat.issue, ids: c0.carte ? [c0.carte.idProduct] : c0.candidats.map(x => x.idProduct), confirmationNombreux: resultat.confirmationNombreux }, d);
    if (arb.action === 'garder') return { resultat, desaccord: arb.desaccord, questionNeuve: false };
    if (arb.action === 'promouvoir') {
        // PROMOTION (règle (b) de la mesure combinée) : la chaîne posait une question, G AFFIRME Q et la garde (2) l'a laissé passer. Q est affirmé SANS la garde des jumeaux : G a jugé les jumeaux au niveau du visuel
        // (même précédent que la seconde lecture, qui confirme par `rejouer`). Tout ce qui empêche de fabriquer cette affirmation laisse la réponse de la CHAÎNE (jamais pire que la chaîne seule).
        const Q = arb.ids[0], garder = retenue => ({ resultat, desaccord: { ...arb.desaccord, retenue }, questionNeuve: false });
        const tout = new Map(produits);
        try { if (!tout.has(Q)) for (const [k, p] of await catalogue.lire([Q])) tout.set(k, p); } catch (e) { journalErreur('catalogue (promotion)', e); return garder('promotion-impossible'); }
        if (!tout.has(Q)) return garder('promotion-impossible');
        const c = corpsChaine || {};
        const corps = { ...c, success: true, carte: { ...(c.carte || {}), idProduct: Q, ambigu: false }, candidats: [{ idProduct: Q }] };
        let r = null;
        try { r = adapterFn({ statutHttp: 200, corps }, { produits: tout, langueInterface: entree.langueInterface, cfg, ficheServie: false, jumeaux: id => (id === Q ? { conclu: true, ids: [] } : (typeof jumeaux === 'function' ? jumeaux(id) : { conclu: false, ids: [] })) }); }
        catch (e) { journalErreur('promotion (adaptateur)', e); return garder('promotion-impossible'); }
        if (!r || r.issue !== 'affirmee' || !r.analyse || r.analyse.cartes[0].carte.idProduct !== Q) return garder('promotion-impossible');
        return { resultat: r, desaccord: arb.desaccord, questionNeuve: false, promotion: true, concordante: arb.concordante === true };
    }
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

// ── MODELE-VISUEL-API : la règle G alimentée par le VECTEUR de l'extension (V2_EMPREINTE_EXTENSION). Consultée APRÈS la chaîne héritée, à sa suite, jamais à sa place. Le fournisseur (voisins-empreinte.js) vérifie le vecteur,
// cherche les voisins dans l'index de l'API et mesure la garde des zones ; la décision est celle de la règle G ; l'arbitrage est celui de la mesure combinée (promotion-g.js : l'arbitrage prudent pour une chaîne qui affirme,
// plus la promotion d'une question quand G affirme et que la garde (2) laisse passer). 🔴 L'INTROUVABLE de la chaîne n'est JAMAIS promu ici (`depuisIntrouvable` reste faux) : la chaîne l'a déjà REMBOURSÉ, une
// affirmation après un remboursement serait un scan gratuit (2 des 44 promotions de la mesure) ; et la garde (2) ne peut pas juger un refus, qui ne porte aucune lecture.
// @returns { resultat, desaccord, questionNeuve, promotion?, empreinte: { public: {utilisee, code}, influence, promotion, lectureConcordante } } — ne lève jamais ; `empreinte.public` est ce que la réponse dit.
// TEMPS-ETAPES : `prechargee` (V2_TE_EMPREINTE_TOT) est la promesse du MÊME fournisseur, lancée dès que la requête a été acceptée (pendant l'attente du modèle) : on attend SON résultat au lieu d'appeler le fournisseur ici.
// Le fournisseur ne lit que `entree` (jamais la chaîne) : son résultat est le même, parti plus tôt. La borne (`delaiVoisinsMs`) court à partir de CETTE attente, comme avant ; un rejet est jugé ici, comme avant.
async function consulterEmpreinte({ deps, cfg, fournisseur, entree, scanId, resultat, corpsChaine, produits, catalogue, adapterFn, jumeaux, prechargee = null, chrono = null }) {
    const sans = code => ({ resultat, desaccord: null, questionNeuve: false, empreinte: { public: { utilisee: false, code }, influence: false, promotion: false, lectureConcordante: false } });
    let v;
    try {
        const ms = Number.isFinite(deps.delaiVoisinsMs) && deps.delaiVoisinsMs > 0 ? deps.delaiVoisinsMs : DELAI_VOISINS_MS;
        const normal = () => (chrono ? chrono.mesurer('empreinte', () => fournisseur({ entree, scanId: String(scanId), chrono })) : fournisseur({ entree, scanId: String(scanId) }));
        // Voie (b) : le délai des mesures (2 s) et la file (3 à la fois) du fournisseur couraient pendant le calcul de la chaîne ; sur 0,15 vCPU la précharge peut en sortir « indisponible » (ou lever) alors que la voie normale,
        // lancée chaîne finie, aurait conclu. Une issue « indisponible », ou un rejet, de la voie anticipée est donc RELANCÉE par la voie normale : on ne perd jamais un déclassement que G aurait imposé. Toute autre issue
        // (réussie, « muette », « invalide », « modele-inconnu ») est déterministe : gardée telle quelle.
        const appel = prechargee === null ? normal : async () => {
            let r = null;
            try { r = await prechargee; } catch { r = null; }
            return r && !(r.ok === false && r.code === 'indisponible') ? r : normal();
        };
        v = await avecBorne(appel, ms, 'voisins (empreinte)');
    } catch (e) { journalErreur('empreinte (voisins)', e); return sans('indisponible'); }
    if (!v || v.ok !== true) {
        const s = sans(v && CODES_EMPREINTE.includes(v.code) ? v.code : 'indisponible');
        // CALCUL-CLIENT : la règle attend des mesures que le serveur ne calcule pas (V2_ORB_SERVEUR=0) — ce qu'il faut pour les demander au client ; INTERNE (jamais servi, jamais écrit tel quel)
        if (v && v.code === 'muette' && v.attente && v.attente.ligne && v.attente.ctx) s.empreinte.attente = v.attente;
        return s;
    }
    let d;
    try { d = RG.decisionRegleG({ ligne: v.ligne, nEssais: v.nEssais, mesures: v.mesures, contexteG: v.contexteG }, v.seuils); }
    catch (e) { journalErreur('empreinte (règle G)', e); return sans('indisponible'); }
    if (!d) return sans('muette');
    const c = corpsChaine && typeof corpsChaine === 'object' ? corpsChaine : {};
    // la garde (2) n'est jugée que là où elle peut servir : la chaîne n'affirme pas et G affirme
    let garde = null;
    if (resultat.issue === 'question' && d.issue === 'affirmee') {
        const tout = new Map(produits || []);
        try { if (!tout.has(d.produit)) for (const [k, p] of await catalogue.lire([d.produit])) tout.set(k, p); } catch (e) { journalErreur('catalogue (garde de la promotion)', e); }
        garde = PG.evaluerGarde({ corps: c, gagnant: d.produit, produits: tout });
    }
    let r;
    try { r = await appliquerDecisionG({ cfg, entree, resultat, corpsChaine, produits, catalogue, adapterFn, d, jumeaux, arbitre: (ch, g) => PG.arbitrerAvecPromotion(ch, g, { garde, depuisIntrouvable: false }) }); }
    catch (e) { journalErreur('empreinte (décision)', e); return sans('indisponible'); }
    const influence = r.resultat !== resultat;
    return { ...r, empreinte: { public: { utilisee: true, code: null }, influence, promotion: r.promotion === true, lectureConcordante: r.promotion === true && r.concordante === true } };
}
const CODES_EMPREINTE = require('./voisins-empreinte').CODES;
const PG = require('./promotion-g');

function traiterIdentifier(cfg, deps = {}) {
    const catalogue = deps.catalogue || creerCatalogue({ cfg });
    // PERF-SCAN P2 : V2_INDEX_AU_DEMARRAGE=1 construit les index du catalogue (code × numéro, familles) dès la connexion à la base, avant le trafic, au lieu de pendant les premiers scans. Éteint par défaut : la route est celle d'avant.
    // ⚠️ Allumé, R4 et la désignation sont OUVERTES dès le premier scan (avant : fermées tant que l'index se construisait en arrière-plan) — c'est l'état de régime, pas un changement de règle.
    if (!deps.catalogue && process.env.V2_INDEX_AU_DEMARRAGE === '1' && typeof catalogue.prechauffer === 'function') catalogue.prechauffer().catch(() => { });
    // MODELE-VISUEL-API : le fournisseur du vecteur de l'extension — celui du banc (deps.voisinsEmpreinte) ou celui de la production (index en place ; les PIXELS sont la carte redressée jointe par l'extension, les scans
    // viennent de NOTRE bucket public de visuels ou de deps.scanEmpreinte en banc). Le serveur ne télécharge jamais la photo.
    const fournisseurEmpreinte = cfg.empreinteExtension === true
        ? (typeof deps.voisinsEmpreinte === 'function' ? deps.voisinsEmpreinte : require('./voisins-empreinte').creerFournisseurEmpreinte({ cfg, scan: typeof deps.scanEmpreinte === 'function' ? deps.scanEmpreinte : require('./voisins-empreinte').scanArchivePublic({ hote: cfg.images.hotesPublics[0] }), zones: deps.zonesEmpreinte || null, orbServeur: cfg.orbServeur !== false, ...(Number.isFinite(deps.delaiVoisinsMs) && deps.delaiVoisinsMs > 0 ? { delaiMs: deps.delaiVoisinsMs } : {}) }))
        : null;
    const interne = async function traiterIdentifierV2(req, res, etat) {
        const porteur = req.v2 && req.v2.porteur, entree = req.entree;
        let argent;
        try {
            argent = registre.obtenir('argent');
            if (!porteur || !entree || typeof deps.gererIdentifier !== 'function') throw new Error('montage incomplet');
        } catch (e) { journalErreur('montage', e); return repondreErreur(res, 'INDISPONIBLE'); }
        const T = TE.creerChrono(), te = TE.reglages(cfg);        // TEMPS-ETAPES : le chronomètre de CE scan (nombres seulement, liste fermée d'étapes) et les coupes de temps (V2_TE_*, éteintes par défaut)
        const soldeSur = async () => { try { return await argent.solde(porteur); } catch (e) { journalErreur('solde', e); return undefined; } };
        const offreP = () => offreSur(porteur, argent);

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
            // OFFRE-QUOTA : plus de recharge (`achat` n'est plus joint) ; le refus QUOTA joint l'offre, restant 0
            const extra = { facturation: null };
            if (code !== 'EN_RECONCILIATION') {
                const s = await soldeSur(); if (s !== undefined) extra.solde = s;
                const o = await offreP(); if (o !== undefined) extra.offre = code === 'QUOTA' ? offreRefusee(o) : o;
            }
            return repondreErreur(res, code, undefined, extra);
        }
        // une clé déjà débitée par une requête qui n'a pas abouti : jamais un second appel à la chaîne sur ce débit (la réconciliation tranche)
        if (debit.rejoue) return repondreErreur(res, 'DEBIT', undefined, { reessayerDans: 2 });

        const admin = debit.administrateur === true, credit = admin ? null : (debit.credit ?? null);
        const userId = `v2:${porteur.type}:${porteur.id}`;
        // ACHETE-AVANT-JOUR : d'où vient l'analyse (`facturation.poche`), posé sur la RÉPONSE seulement ; un lot qui chevauche les deux poches dit "jour" (voir argent/poche-servie.js)
        const poche = () => PS.pocheDuScan(porteur, scanId, credit, typeof deps.identifierLot === 'function');
        // 4. la chaîne héritée, avec le DOUBLE de res ; tout ce qui suit se décide dans le contexte de CE scan (la cause d'un non-remboursement s'y note)
        // 🔑 TOUT ce qui suit le débit est sous UN filet : une exception, d'où qu'elle vienne, rend le crédit (voir le catch).
        let reqH = null, rembourserOrigine = null, sortie, lecture = null, desaccordG = null, traceSeconde = null, traceTampon = null, empreinteInfo = null, traceImage = null, complement = null, traceMarqueurs = null;
        // `parLaGarde` : le refus est celui de la garde des jumeaux (le NÔTRE) → nature `jumeaux`, une unité (une carte), constatée par le serveur et rendue SANS plafond (PLAFOND-DECLARE)
        // FREIN-CONSTATES : la nature vient du MOTIF, par l'unique fonction `natureDuMotif` : une panne de NOTRE côté (`panne-*`, INDISPONIBLE compris) est hors plafond, un introuvable est un constat plafonné
        const rembourserMoi = (motif, parLaGarde = false) => reqH.credit.v2.rembourser(reqH, motif, parLaGarde ? { compteur: 'jumeaux', unites: 1 } : { compteur: natureDuMotif(motif) });
        // B1b.8 : le crochet `deps.identifierLot` ABSENT (ou autre chose qu'une fonction) => une seule carte, comme avant le lot, octet pour octet. Présent, la requête est
        // un LOT : v2/identifier/lot.js (coût par tranche de 10, ordre par valeur, supplément tout-ou-rien). La règle G ne s'y applique jamais : elle juge UNE carte et
        // n'est consultée que dans la branche à une carte ci-dessous.
        // ✅ O5 (M5 de B1b.8) : un arrêt du processus entre le débit (ou le supplément) et la réponse laissait un DÉBIT À VIE (jusqu'à 10 crédits) que la réconciliation ne voyait pas.
        // La marque de livraison ouverte plus haut (v2/argent/marque-scan.js) couvre TOUS les débits du scan, supplément compris : la passe de rattrapage rend le scan, ou le confirme.
        const modeLot = typeof deps.identifierLot === 'function';
        let erreurLot = null, injecte = null;
        try {
            // FREIN-CONSTATES : le plafond GLOBAL de dépense du modèle, relu en base AVANT toute lecture. Atteint (ou compte illisible : échec fermé), AUCUN appel au modèle n'a lieu : le scan rend la panne
            // INDISPONIBLE (503), remboursée HORS plafond (c'est notre limite, pas la faute du client), le motif `depense-modele-plafond` n'est écrit que par le module de dépense (journal au passage du seuil, alerte en base, compteurs).
            const depense = depenseDe(cfg, deps);
            if (depense && !(await depense.autorise()).ok) {
                sortie = await dansUnScan(async () => {
                    reqH = { ip: req.ip, headers: {}, scanIdImpose: scanId, credit: argent.creditPourReq(porteur, credit, { scanId }) };
                    if (credit) { try { await rembourserMoi(`panne-INDISPONIBLE`); } catch (e) { journalErreur('remboursement', e); } }
                    const faits = { admin, rendu: Boolean(reqH.scanRendu), question: false, cause: reqH.scanRendu ? null : raisonNonRemboursement() };
                    return { resultat: { issue: 'panne', analyse: null, erreur: { code: 'INDISPONIBLE' } }, facturation: facturationDe('panne', faits), lecture: null, desaccord: null };
                });
                reqH = null;
            }
            // PHOTOS-MULTIPLES (7d) : la requête est ACCEPTÉE (corps validé, plafonds passés, clé d'idempotence prise, débit fait, dépense du modèle permise) : c'est ICI, et pas avant, que les photos sortent du magasin.
            if (!sortie) {
                rattacherPhotos(req, deps, res);
                const pd = entree.photoDureesMs;                                  // TEMPS-ETAPES : le dépôt de la photo (la requête qui précède le scan), s'il y en a eu un
                if (pd) { T.poser('photo', pd.totalMs); T.poser('photoTraitement', pd.traitementMs); }
            }
            if (modeLot && !sortie) {
                const l = await executerLot({ cfg, deps, catalogue, argent, porteur, entree, annonce, scanId, cleDebit, admin, credit, ip: req.ip, userId, facturationDe });
                if (l.erreur) erreurLot = l.erreur; else if ('unique' in l) injecte = l.unique; else sortie = l.sortie;     // la présence se teste par la FORME, jamais par la valeur
            }
            // Pas de lot (crochet absent) OU un crochet qui n'a rendu qu'UN résultat : la branche UNE-CARTE (règle G, question réservée, sans-prix), qui reçoit ce résultat
            // comme réponse de la chaîne — sans la rappeler (un seul appel de lecture).
            if (!sortie && !erreurLot) {
            reqH = {
                body: { imageUrls: imagesDeLaChaine(entree), title: annonce.titre, vintedEtat: entree.vintedEtat, prixVinted: entree.prixVinted, vintedUrl: entree.vintedUrl, versionExtension: entree.versionExtension, userId },
                ip: req.ip, headers: {}, scanIdImpose: scanId,
                credit: argent.creditPourReq(porteur, credit, { scanId }),
                dureesChaine: {}          // TEMPS-ETAPES : la chaîne héritée y note ses durées (lecture, état, catalogue, image) ; rien d'autre n'en est repris
            };
            // TEMPS-ETAPES (V2_TE_EMPREINTE_TOT) : le fournisseur d'empreinte (recherche des voisins + garde des zones) ne lit que `entree` : il part DÈS MAINTENANT, pendant l'attente du modèle, et la fin de la
            // chaîne n'attend plus que son résultat. Une seule promesse par requête, jamais sans vecteur. Ce bloc n'est atteint que pour UNE carte (un lot de plusieurs cartes a déjà son résultat plus haut : la règle G ne
            // s'y applique pas, rien n'est lancé d'avance pour lui) ; un lot qui ne rend qu'UNE carte passe ici, et la règle G s'y applique comme à toute carte. Départ au tour suivant (setImmediate) : la chaîne a eu le temps
            // d'émettre son appel au modèle avant que la recherche (du calcul) ne prenne le processus. Son rejet éventuel est jugé au moment de l'attente (consulterEmpreinte), jamais ici.
            let empreintePrechargee = null;
            if (te.empreinteTot && fournisseurEmpreinte && entree.empreintes) {
                empreintePrechargee = new Promise(r => setImmediate(r)).then(() => T.mesurer('empreinte', () => fournisseurEmpreinte({ entree, scanId: String(scanId), chrono: T })));
                empreintePrechargee.catch(() => { });
            }
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
                if (entree.arret) reqH.signalArret = entree.arret.signal;           // I-2 : la chaîne reçoit le signal d'arrêt de la borne du scan (annule l'appel au modèle en cours)
                try { await T.mesurer('chaine', () => require('./photos-recues').avecArret(entree.arret && entree.arret.signal, (injecte ? chaineDepuisResultat(injecte) : deps.gererIdentifier)(reqH, fr))); } catch (e) { exception = e; journalErreur('chaîne héritée', e); }
                for (const k of ['lecture', 'etat', 'catalogue', 'image']) T.poser(k, reqH.dureesChaine ? reqH.dureesChaine[k] : undefined);       // TEMPS-ETAPES : seuls ces quatre noms, et seulement des nombres valides, passent du gestionnaire hérité au journal
                let resultat, produits = null;
                let derniereQuestion = null;           // MARQUEURS : la dernière QUESTION vue avant qu'une étape la change en affirmation (la garde des groupes la rend telle quelle)
                const noterQuestion = () => { if (resultat && resultat.issue === 'question') derniereQuestion = resultat; };
                if (exception || !fr.headersSent) resultat = { issue: 'panne', analyse: null, erreur: { code: 'SERVEUR' } };
                else {
                    // 5. le catalogue de l'API pour les produits que la chaîne désigne, puis l'adaptation
                    const c = fr.corps && typeof fr.corps === 'object' ? fr.corps : {};
                    // B1b.5 : ce que /reponse ne pourra pas relire (la langue lue et la stratégie reverse) pour fabriquer le prixLive d'une carte tranchée
                    lecture = { codeLangue: codeLangueDe(c), reverseStrategie: c.reverse && typeof c.reverse.strategie === 'string' ? c.reverse.strategie : null };
                    // JUMEAU-V2 : UNE version de la colonne des jumeaux pour toute la requête (jamais deux versions mêlées) ; un jumeau qui tient dans une question est chargé avec la carte affirmée
                    // (le produit affirmé est vérifié contre le catalogue d'aujourd'hui : un produit plus récent que l'archive sous SA métacarte le rend indisponible pour ce scan seul)
                    const version0 = etatChargeur.version();                  // UNE lecture de la version pour toute la requête (m-1) : passée au premier appel ET à preparer
                    const jumeaux0 = deps.jumeaux || await T.mesurer('base', () => fournisseurParDefaut(catalogue, version0, idsAffirmes(c)));
                    const ids = [...entiers(c.candidats), ...(c.carte && Number.isInteger(c.carte.idProduct) ? [c.carte.idProduct] : []), ...idsACharger(c, jumeaux0), ...idsDeLaGarde(c)];     // GARDE-CONTRADICTION : le vivier lu par la chaîne, pour juger les champs lus contre les autres candidats
                    try { produits = await T.mesurer('base', () => catalogue.lire(ids)); } catch (e) { journalErreur('catalogue', e); }
                    // LANGUE-DECISIVE (B1, M2) : les jumeaux des candidats que la photo pourrait laisser seuls, et l'index code × numéro du catalogue entier (R4)
                    let jumeaux = jumeaux0, ctxLD = {};
                    if (produits !== null) { const pr = await T.mesurer('base', () => preparerLD({ corpsListe: [c], produits, jumeaux: jumeaux0, catalogue, version: version0, deps })); produits = pr.produits; jumeaux = pr.jumeaux; if (pr.codeNumeroExiste) ctxLD = { codeNumeroExiste: pr.codeNumeroExiste }; }
                    resultat = produits === null ? { issue: 'panne', analyse: null, erreur: { code: 'INDISPONIBLE' } }
                        : (deps.adapter || adapter)({ statutHttp: fr.statut, corps: fr.corps }, { produits, langueInterface: entree.langueInterface, cfg, ficheServie: false, jumeaux, ...ctxLD });
                    noterQuestion();
                    // SECONDE-LECTURE : seulement le cas visé, derrière son interrupteur ; la réponse d'avant reste si elle ne CONFIRME pas (jamais pire). AVANT la réservation ci-dessous : une affirmation confirmée n'en a pas.
                    if (resultat.issue === 'question') {
                        const rejouer = jum => (deps.adapter || adapter)({ statutHttp: fr.statut, corps: fr.corps }, { produits, langueInterface: entree.langueInterface, cfg, ficheServie: false, jumeaux: jum, ...ctxLD });
                        let sl = null;
                        try { sl = await T.mesurer('seconde', () => consulterSecondeLecture({ deps, cfg, entree, scanId, resultat, corpsChaine: c, produits, jumeaux, rejouer })); } catch (e) { journalErreur('seconde lecture', e); }
                        if (sl) { traceSeconde = sl.trace; if (sl.resultat) resultat = sl.resultat; }
                    }
                    noterQuestion();
                    // F1-TAMPON puis LOT TAMPONS : lire les marques (liste fermée) pour trancher une paire séparée ; ou la mention de la règle 2 des prix. Derrière son interrupteur ; la réponse d'avant reste si la preuve n'est pas faite.
                    if (resultat.issue === 'question' || resultat.issue === 'affirmee') {
                        try {
                            const lt = await T.mesurer('tampon', () => consulterLectureTampon({ deps, cfg, entree, scanId, resultat, corpsChaine: c, produits, version: version0, avecBorne,
                                affirmer: (id, surcharge, critere) => affirmerParLaRoute(c, id, { produits: surcharge || produits, langueInterface: entree.langueInterface, cfg, ficheServie: false }, critere), journal: journalErreur }));
                            if (lt) { traceTampon = lt.trace; if (lt.resultat) resultat = lt.resultat; }
                        } catch (e) { journalErreur('lecture du tampon', e); }
                    }
                    noterQuestion();
                    // une AFFIRMATION de la chaîne devenue une question (le produit a des jumeaux) : son crédit est encore pris, il est RÉSERVÉ plus bas, comme pour la règle G
                    if (resultat.issue === 'question' && c.success === true && c.carte && c.carte.ambigu === false) reqH.regleGRaison = 'jumeaux';
                    // MODELE-VISUEL-API : le vecteur de l'extension, si (et seulement si) V2_EMPREINTE_EXTENSION est allumé ET que la requête en porte ; jamais sur une panne. La voie V2_REGLE_G ci-dessous reste pour les requêtes sans vecteur.
                    if (resultat.issue !== 'panne' && fournisseurEmpreinte && entree.empreintes) {
                        if (te.orbUtile && resultat.issue === 'introuvable') {
                            // TEMPS-ETAPES (V2_TE_ORB_UTILE) : la règle G ne peut RIEN changer à un introuvable de la chaîne — arbitrer() rend « garder » quel que soit G, et l'introuvable ne se promeut jamais (depuisIntrouvable: false ;
                            // l'introuvable est déjà remboursé) : la recherche des voisins et la garde des zones (l'ORB) ne sont pas lancées. Ce que la réponse en dit : G se tait.
                            empreinteInfo = { public: { utilisee: false, code: 'muette' }, influence: false, promotion: false, lectureConcordante: false };
                        } else {
                            const g = await consulterEmpreinte({ deps, cfg, fournisseur: fournisseurEmpreinte, entree, scanId, resultat, corpsChaine: c, produits, catalogue, adapterFn: deps.adapter || adapter, jumeaux, prechargee: empreintePrechargee, chrono: T });
                            resultat = g.resultat; desaccordG = g.desaccord; empreinteInfo = g.empreinte;
                            if (g.questionNeuve) reqH.regleGRaison = 'regle-g';
                            if (desaccordG) console.warn(`⚠️ [v2 règle G] desaccordRegleG scan=${scanId} ${JSON.stringify(desaccordG)}`);
                        }
                    } else
                    // B1b.7 : la règle G, si (et seulement si) l'interrupteur est allumé ET qu'un fournisseur de voisins est branché ; jamais sur une panne
                    if (resultat.issue !== 'panne' && RG.regleGActive(cfg, deps)) {
                        const g = await consulterRegleG({ deps, cfg, entree, scanId, resultat, corpsChaine: c, produits, catalogue, adapterFn: deps.adapter || adapter });
                        if (g) {
                            resultat = g.resultat; desaccordG = g.desaccord;
                            if (g.questionNeuve) reqH.regleGRaison = 'regle-g';        // l'affirmation de la chaîne est devenue une question : son crédit est RÉSERVÉ plus bas
                            if (desaccordG) console.warn(`⚠️ [v2 règle G] desaccordRegleG scan=${scanId} ${JSON.stringify(desaccordG)}`);
                        }
                    }
                    // SUR-PAR-IMAGE : une question que rien n'a tranchée, relue par le vecteur de l'extension (derrière V2_SUR_PAR_IMAGE ET V2_EMPREINTE_EXTENSION). Jamais quand la règle G a déjà changé le résultat ou
                    // contredit la chaîne (deux sources en conflit ne donnent pas un sûr), jamais sur autre chose qu'une question. La réponse d'avant reste si la preuve n'est pas faite.
                    if (resultat.issue === 'question' && cfg.surParImage === true && entree.empreintes && !desaccordG && !(empreinteInfo && empreinteInfo.influence)) {
                        try {
                            const si = await T.mesurer('sur', () => consulterSurParImage({ cfg, entree, resultat, corpsChaine: c, produits, version: version0, jumeaux, affirmer: (id, surcharge, critere) => affirmerParLaRoute(c, id, { produits: surcharge || produits, langueInterface: entree.langueInterface, cfg, ficheServie: false }, critere),
                                charger: cfg.vivierImage === true ? ids => catalogue.lire(ids) : undefined,         // VIVIER-IMAGE : les lignes des produits ajoutés au vivier (éteint : rien n'est passé, rien n'est lu)
                                marquesLues: traceTampon && Array.isArray(traceTampon.marques) ? traceTampon.marques : null, journal: journalErreur, chrono: T }));
                            if (si) {
                                traceImage = si.trace;
                                if (si.resultat) { resultat = si.resultat; empreinteInfo = { public: { utilisee: true, code: null }, influence: true, promotion: false, lectureConcordante: false }; }
                            }
                        } catch (e) { journalErreur('sur par l\'image', e); }
                    }
                    // MARQUEURS (CONTRAT-MARQUEURS.md §5) : le point de sortie UNIQUE de tous les sûrs d'une carte (chaîne, désignation, critère A, seconde lecture, tampon, règle G, SUR-PAR-IMAGE sont passés).
                    // (1) V2_JUMBO_TITRE : une question { Jumbo, sans Jumbo } de même dessin + un titre sans négation → le Jumbo ; (2) V2_GARDE_MARQUEURS : un sûr avec un rival de groupe → la question d'avant, sauf signal réel.
                    // Éteints, rien n'est lu. Une chaîne qui avait affirmé P et qui redevient question réserve son crédit comme pour un jumeau (regleGRaison). Une exception laisse la réponse d'avant.
                    if (resultat.issue === 'question' || resultat.issue === 'affirmee') {
                        noterQuestion();
                        try {
                            const gm = appliquerMarqueurs({ cfg, titre: annonce.titre, resultat, derniereQuestion, c, desaccordG, empreinteInfo, produits, version: version0, langueInterface: entree.langueInterface, jumeaux, journal: journalErreur });
                            if (gm) {
                                traceMarqueurs = gm.trace;
                                if (gm.resultat) {
                                    const avant = resultat; resultat = gm.resultat;
                                    if (resultat.issue === 'question' && avant.issue === 'affirmee' && !reqH.questionId && c.success === true && c.carte && c.carte.ambigu === false) reqH.regleGRaison = 'jumeaux';
                                }
                            }
                        } catch (e) { journalErreur('marqueurs', e); }
                    }
                    // CALCUL-CLIENT : une QUESTION que la règle G aurait pu trancher avec des mesures que le serveur ne calcule pas (V2_ORB_SERVEUR=0) — on demande ces mesures au client qui l'annonce. Jamais quand G a
                    // déjà changé le résultat ou contredit la chaîne, jamais sur autre chose qu'une question (le second envoi ne peut que PROMOUVOIR). Un échec ici n'enlève rien : le premier verdict reste, sans complément.
                    if (resultat.issue === 'question' && cfg.mesuresClient === true && entree.mesuresClient === true && empreinteInfo && empreinteInfo.attente && !desaccordG && !empreinteInfo.influence) {
                        try { complement = require('./calcul-client-route').preparerComplement({ cfg, scanId, attente: empreinteInfo.attente, corpsChaine: c, resultat, maintenant: typeof deps.maintenant === 'function' ? deps.maintenant() : Date.now() }); }
                        catch (e) { journalErreur('complément des mesures', e); complement = null; }
                    }
                }
                // CRITERE-A (relecture r1, C1) : une AFFIRMATION qui remplace une question que la CHAÎNE a déjà réservée (voie « candidat unique » : poserQuestion avant l'adaptateur) règle cette réservation
                // comme une RÉPONSE par ce candidat — le chemin existant du grand livre (`argent.repondreQuestion` : en-attente -> repondue, réserve -> débité) — sinon la réponse dit « débité », le livre
                // « réservé » et le balayage à 24 h rend le crédit. Réglage impossible : exception, le filet ci-dessous rend le crédit (jamais un scan gratuit ni une question qui traîne).
                if (resultat.issue === 'affirmee' && reqH.questionId && !admin && credit) {
                    const idP = resultat.analyse.cartes[0].carte.idProduct;
                    const choixP = choixPour([idP]).map(x => ({ id: x.id, idProduct: x.idProduct }));
                    await col('questions_v2').updateOne({ _id: `${scanId}:0`, etat: 'en-attente' }, { $set: { choix: choixP } });
                    const rep = await argent.repondreQuestion(porteur, { scanId, carte: 0, choix: choixP[0].id });
                    if (!rep || rep.statut !== 200 || rep.etat !== 'repondue') throw new Error(`question réservée non réglée par l'affirmation (${(rep && (rep.statut || rep.code)) || 'aucune réponse'})`);
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
                    // un refus de la garde des jumeaux (resultat.motif) est NOTRE refus : rendu dans le compteur dédié `jumeaux` (l'unicité par scan reste)
                    try { await rembourserMoi(resultat.issue === 'panne' ? `panne-${resultat.erreur.code}` : 'introuvable', Boolean(resultat.motif)); } catch (e) { journalErreur('remboursement', e); }
                }
                const faits = { admin, rendu: Boolean(reqH.scanRendu), question: Boolean(reqH.questionId) && resultat.issue === 'question', cause: reqH.scanRendu ? null : raisonNonRemboursement() };
                // I-2 : la borne du scan est atteinte pendant les étapes qui suivent la chaîne (catalogue, seconde lecture, règle G) : l'analyse finit en ÉCHEC par le chemin d'exception existant (ci-dessous : le crédit pris est rendu)
                if (entree.arret && entree.arret.signal.aborted && resultat.issue !== 'panne') throw Object.assign(new Error('borne du scan atteinte'), { code: 'BORNE_PHOTOS' });
                return { resultat, facturation: facturationDe(resultat.issue, faits), lecture, desaccord: desaccordG, motif: resultat.motif ?? null, ...(traceSeconde ? { secondeLecture: traceSeconde } : {}), ...(traceTampon ? { lectureTampon: traceTampon } : {}), ...(empreinteInfo ? { empreinte: empreinteInfo } : {}), ...(traceImage ? { surParImage: traceImage } : {}), ...(traceMarqueurs ? { regleMarqueurs: traceMarqueurs } : {}),
                    ...(complement && resultat.issue === 'question' ? { complement } : {}) };     // CALCUL-CLIENT : seulement si la question a TENU jusqu'ici (une question non écrite est devenue une panne : pas de complément)
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
                        if (reqH && reqH.credit && reqH.credit.v2 && rembourserOrigine) rendu = Boolean(await rembourserOrigine(reqH, 'panne-SERVEUR', { compteur: natureDuMotif('panne-SERVEUR') }));   // annule aussi une question réservée
                        else { const r = await argent.rembourser(porteur, credit, 'panne-SERVEUR', { scanId, compteur: natureDuMotif('panne-SERVEUR') }); rendu = Boolean(r && r.rendu); cause = r && r.raisonNonRembourse; }
                        if (!rendu && !cause) cause = raisonNonRemboursement();
                    });
                } catch (e2) { journalErreur('remboursement après exception', e2); }
                if (!rendu) console.error(`🔴 [v2 identifier] scan ${scanId} (${porteur.type}:${porteur.id}) : exception ET crédit NON rendu (${cause ?? 'erreur'}) — à la réconciliation`);
            } else rendu = Boolean(reqH && reqH.scanRendu);
            let facturation;
            try { facturation = facturationDe('panne', { admin, rendu, question: false, cause: rendu ? null : (cause ? raisonPublique(cause) : 'erreur') }); }
            catch (e3) { journalErreur('facturation après exception', e3); facturation = { debite: rendu || admin ? 0 : 1, reserve: 0, rembourse: rendu, motif: admin ? 'administrateur' : 'panne', raisonNonRembourse: rendu || admin ? null : 'erreur' }; }
            const s = await soldeSur(), o = await offreP();
            await fermer();                                // le scan est rendu (ou dit non rendu) : le résultat est produit
            return repondreErreur(res, 'SERVEUR', undefined, { facturation: PS.avecPoche(facturation, await poche()), ...(s !== undefined ? { solde: s } : {}), ...avecOffre(o) });
        }
        // 7. le solde, relu APRÈS les mouvements
        // TEMPS-ETAPES (V2_TE_FIN_PARALLELE) : sur le chemin NORMAL (ni lot refusé, ni panne), le solde, l'offre et la règle de verdict (taux) sont trois LECTURES indépendantes : elles partent ensemble. Elles ne dépendent ni
        // l'une de l'autre ni d'aucune écriture de la requête (le solde est relu APRÈS les mouvements, qui sont tous faits à ce point). Éteint, ou chemin d'erreur : l'ordre d'avant (solde, offre, puis taux plus bas).
        let solde, offre, regle = null, regleLue = false;
        if (te.finParallele && !erreurLot && sortie && sortie.resultat && sortie.resultat.issue !== 'panne') {
            const [s, o, r] = await T.mesurer('base', () => Promise.all([soldeSur(), offreP(), regleVerdict(entree.devise).then(x => ({ ok: true, x }), e => ({ ok: false, e }))]));
            solde = s; offre = o; regleLue = true;
            if (r.ok) regle = r.x; else journalErreur('taux', r.e);
        } else {
            solde = await T.mesurer('base', () => soldeSur()); offre = await T.mesurer('base', () => offreP());
        }
        if (erreurLot) {                              // un lot qu'on ne peut pas payer (QUOTA « lot-trop-grand »…) : le crédit initial est déjà rendu, la facturation le dit
            await fermer();
            return repondreErreur(res, erreurLot.code, undefined, { facturation: PS.avecPoche(erreurLot.facturation, credit ? credit.poche : null),...(erreurLot.detail !== undefined ? { detail: erreurLot.detail } : {}),
                ...(solde !== undefined ? { solde } : {}), ...avecOffre(erreurLot.code === 'QUOTA' && erreurLot.detail !== 'lot-trop-grand' ? offreRefusee(offre) : offre) });   // lot-trop-grand : les unités sont rendues, l'offre relue dit le VRAI restant (relecture 1, I-2)
        }
        const { resultat, facturation } = sortie;
        if (resultat.issue === 'panne') {
            await fermer();
            return repondreErreur(res, resultat.erreur.code, undefined, { facturation: PS.avecPoche(facturation, await poche()), ...(solde !== undefined ? { solde } : {}), ...avecOffre(offre) });
        }
        // 8. la règle de verdict (au scanner : null — la surface le dit ; ici l'extension)
        if (!regleLue) { try { regle = await T.mesurer('base', () => regleVerdict(entree.devise)); } catch (e) { journalErreur('taux', e); } }
        // MODELE-VISUEL-API : la version du modèle que le serveur attend, et où le télécharger. Servie ICI (et non dans /ping) parce que l'extension lit déjà `regleVerdict` à chaque réponse, qu'elle est versionnée avec le
        // contrat, et que /ping reste un sondage de santé sans configuration. Éteint, ou version non configurée : le champ n'existe pas (la réponse est celle d'avant, octet pour octet).
        const me = cfg.empreinteExtension === true && regle && cfg.modeleEmpreinte && cfg.modeleEmpreinte.id && cfg.modeleEmpreinte.sha256 ? cfg.modeleEmpreinte : null;
        if (me) regle = { ...regle, modeleEmpreinte: { id: me.id, sha256: me.sha256, url: me.url ?? null, octets: me.octets ?? null } };
        // PHOTOS-MULTIPLES (7d, C4) : quand `photoIds` (ou l'ancien `photoId`) est envoyé, l'analyse dit quelles photos ont été REÇUES : `photosRecues`, les index reçus en ordre croissant (tableau vide si aucune), et `photoRecue`, vrai
        // SI ET SEULEMENT SI l'index 0 est reçu. Rien n'est ajouté sans `photoIds` (ni drapeau éteint : `entree.photoIds` n'existe alors pas) : la réponse est celle d'avant, octet pour octet.
        const photosDites = Array.isArray(entree.photoIds) && entree.photoIds.length ? (() => { const idx = (entree.photosRecues || []).map(p => p.index).sort((a, b) => a - b); return { photosRecues: idx, photoRecue: idx.includes(0) }; })() : null;
        // PRIX-LISIBLE : une carte identifiée dont l'analyse n'a rien dicté à lire (langue non lue, état non retenu) reçoit le repli honnête `prixRepli` SI sa fiche a une donnée de prix ; toute autre carte est rendue telle quelle.
        // Posé ICI, après la lecture du tampon (qui peut refaire le Produit) : le guide du repli est celui de la carte servie. Rien n'en entre dans la ligne `analyses` (elle est écrite depuis `analyse.cartes` : le repli se recalcule à la demande).
        const analyse = { ...analyseAvecRepli(resultat.analyse), regleVerdict: regle, ...(photosDites || {}) };
        // 9. les écritures annexes : sans effet sur la réponse
        // TEMPS-ETAPES (V2_TE_FIN_PARALLELE) : la ligne `analyses` et l'annonce sont deux écritures INDÉPENDANTES (chacune sous son propre filet, aucune ne lit l'autre) : elles partent ensemble, et la clôture de la marque
        // (ci-dessous) attend les DEUX, comme avant. Éteint : l'une puis l'autre, l'ordre d'avant.
        const ecrireAnalyse = async () => { try {
            const maintenant = new Date();
            // B1b.8 : pour un lot, la ligne `analyses` range les cartes dans l'ordre d'ENTRÉE (cartes[carte] = la carte `index` de /reponse), la réponse dans l'ordre des valeurs
            // ETAT-FOURCHETTE (M1) : la ligne `analyses` range les produits TELS QUE LE CATALOGUE LES A RENDUS (resultat.analyse, avant le repli et la mention d'état non estimable) : la mention est une décision de CE scan,
            // elle se recalcule à la demande (retour en direct, réponse à une question) depuis l'état retenu de la ligne, jamais depuis un guide déjà marqué.
            const cartes = sortie.cartesEntree || resultat.analyse.cartes;
            await col('analyses').insertOne({
                _id: scanId, porteur: `${porteur.type}:${porteur.id}`, surface: porteur.surface, statut: analyse.statut,
                ...(porteur.compte && porteur.compte.banc === true ? { banc: true } : {}),           // le compte de MESURE : exclu des statistiques d'usage (journal-hors-banc.js)
                // B1b.5 : de quoi servir /reponse sans relire le catalogue — l'état, la question, la zone (aucune donnée de l'annonce) et la lecture de la langue
                cartes: cartes.map((c, i) => ({ idProduct: c.carte ? c.carte.idProduct : null, statut: c.statut, raison: c.raison, etat: c.etat ?? null, question: c.question ?? null, zone: c.zone ?? null,
                    ...(sortie.lectures ? { lecture: sortie.lectures[i] } : i === 0 && sortie.lecture ? { lecture: sortie.lecture } : {}),
                    ...((sortie.motifs ? sortie.motifs[i] : i === 0 ? sortie.motif : null) ? { motifJumeaux: sortie.motifs ? sortie.motifs[i] : sortie.motif } : {}) })),     // JUMEAU-V2 : le motif de la garde, PAR CARTE (interne, jamais servi)
                produits: cartes.flatMap(c => (c.carte ? [c.carte] : c.candidats)), facturation,
                versionChaine: (cfg.versions && cfg.versions.chaine) || null, versionModele: (cfg.versions && cfg.versions.modele) || null,   // ETIQUETAGE-A : le code et le modèle qui ont répondu (interne, jamais servi) ; la base « Gemini seul » de la mesure
                ...(sortie.motif ? { motifJumeaux: sortie.motif } : {}),                    // JUMEAU-V2 : le motif distinct d'un introuvable de la garde (jamais servi au client : le contrat public ne change pas)
                ...(sortie.secondeLecture ? { secondeLecture: sortie.secondeLecture } : {}),     // SECONDE-LECTURE : ce qu'elle a COÛTÉ (appels) et son issue — interne, jamais servi
                ...(sortie.lectureTampon ? { lectureTampon: sortie.lectureTampon } : {}),        // F1-TAMPON : idem pour la lecture du tampon
                ...(sortie.regleMarqueurs ? { regleMarqueurs: sortie.regleMarqueurs } : {}),     // MARQUEURS : le jumbo par le titre / la garde des groupes (issue, produit, rivaux, critère) — interne, jamais servi
                ...(sortie.surParImage ? { surParImage: sortie.surParImage } : {}),              // SUR-PAR-IMAGE : l'issue de la règle (sûr, se tait + motif) — interne, jamais servie
                ...(sortie.desaccord ? { desaccordRegleG: sortie.desaccord } : {}),          // B1b.7 : un désaccord règle G / chaîne héritée n'est jamais tranché en silence
                // MODELE-VISUEL-API : ce que le VECTEUR de l'extension a fait de ce scan (interne, jamais servi tel quel) — de quoi EXCLURE des statistiques et des bancs les résultats qu'il a changés sans lecture concordante
                ...(sortie.empreinte ? { empreinteExtension: { utilisee: sortie.empreinte.public.utilisee, code: sortie.empreinte.public.code, influence: sortie.empreinte.influence, promotion: sortie.empreinte.promotion, lectureConcordante: sortie.empreinte.lectureConcordante, modele: cfg.modeleEmpreinte ? cfg.modeleEmpreinte.id : null } } : {}),
                ...(sortie.complement ? { complementMesures: sortie.complement.stocke } : {}),     // CALCUL-CLIENT : ce que le second envoi relit (mesures demandées, ligne, références, échéance) — interne, jamais servi
                durees: T.exporter(),                                                       // TEMPS-ETAPES : les durées par étape (ms, entiers), additif et interne — jamais servi ; `total` court jusqu'à CETTE écriture
                creeLe: maintenant, expireLe: new Date(maintenant.getTime() + cfg.retention.analysesMois * 30.5 * 86400e3)
            });
        } catch (e) { journalErreur('analyses', e); } };
        const ecrireAnnonce = async () => { try { await conserverAnnonce(String(scanId), { titre: annonce.titre, description: annonce.description, expurgeeParServeur: annonce.expurgeeParServeur }, cfg); } catch (e) { journalErreur('annonces', e); } };
        if (te.finParallele) await T.mesurer('base', () => Promise.all([ecrireAnalyse(), ecrireAnnonce()]));
        else { await T.mesurer('base', ecrireAnalyse); await T.mesurer('base', ecrireAnnonce); }
        // La clôture est la DERNIÈRE opération d'argent de la requête : un arrêt avant elle se rattrape (la marque reste ouverte, la passe rend ou confirme). Au scanner, le remboursement
        // `sans-prix` se fait DANS res.json (scanner/routes.js, habiller) : c'est lui qui clôt, après ce geste ; le battement reste alors vivant jusque-là (etat.differe).
        // Le gestionnaire VIVANT ferme `livre` lui-même, que le client soit encore là ou non : une coupure du client ne rend rien.
        if (req.marqueFermeeParLaReponse === true) { req.fermerMarque = fermer; etat.differe = true; } else await fermer();
        // 10. la réponse (B6.4 : le crochet du banc réel — jamais attendu, ne lève jamais, rien n'en entre dans la réponse)
        // MODELE-VISUEL-API (tour 2, I1 — ruling du coordinateur) : un résultat que le vecteur de l'extension a CHANGÉ (promotion, question neuve) n'est JAMAIS écrit dans une donnée partagée (banc réel, statistiques, communauté, cache) :
        // « lecture concordante » veut dire « non contredite », et un client choisit entre les produits qui partagent les champs lus. Il ne sert que la réponse de son auteur, son journal et sa facturation. Seul un résultat que
        // le vecteur n'a pas changé passe comme avant.
        const emp = sortie.empreinte;
        if (!(emp && emp.influence)) require('../banc/crochet').apresIdentifier({ cfg, deps, req, scanId, analyse });
        // ETIQUETAGE-B : la photo d'un scan de l'ADMINISTRATEUR seul (rôle relu en base par le crochet) ; jamais attendue, ne lève jamais, rien n'entre dans la réponse
        if (admin) require('../banc/photo-admin').apresIdentifierAdmin({ cfg, deps, req, scanId, porteur }).catch(() => { });
        return res.status(200).json({ success: true, contrat: 2, scanId: String(scanId), analyse, facturation: PS.avecPoche(facturation, await poche()),...(solde !== undefined ? { solde } : {}), ...avecOffre(offre),
            ...(sortie.empreinte ? { empreinte: sortie.empreinte.public } : {}),          // MODELE-VISUEL-API : seulement quand la requête portait des empreintes et que le drapeau est allumé
            ...(sortie.complement ? { complement: sortie.complement.public } : {}) });     // CALCUL-CLIENT : seulement drapeau allumé, client qui l'annonce, question que des mesures pourraient trancher
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
        if (!entree.question || cands.length !== ids.length || cands.length < 1) return null;     // UN-CANDIDAT (D1) : une question de confirmation a UN candidat, `ne-sait-pas` la laisse posée
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
        const offreP = () => offreSur(porteur, argent);
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

        let facturation, idProduct = null, le = new Date(), enAttente = false, declaration = null;
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
            if (r.statut === 410) { const s = await soldeSur(), o = await offreP(); return repondreErreur(res, 'CODE_EXPIRE', 'La question a expiré', { facturation: r.facturation, ...(r.declaration ? { declaration: r.declaration } : {}), ...(s !== undefined ? { solde: s } : {}), ...avecOffre(o) }); }
            if (r.statut !== 200 || !r.question) { console.error(`🔴 [v2 reponse] statut inattendu ${r.statut} pour ${scanId}`); return repondreErreur(res, 'SERVEUR'); }
            facturation = r.facturation; enAttente = r.remboursementEnAttente === true; declaration = r.declaration || null;
            idProduct = r.question.reponse && r.question.reponse.idProduct != null ? r.question.reponse.idProduct : null;
            le = (r.question.reponse && r.question.reponse.le) || le;
        }
        const resolueBrute = carteRepondue(an, entree, carte, choix, idProduct);
        const resolue = resolueBrute && avecRepliAnalyse(resolueBrute);      // PRIX-LISIBLE : le repli honnête d'une carte tranchée dont l'analyse n'a rien dicté à lire (null reste null)
        if (!resolue) { console.error(`🔴 [v2 reponse] scan ${scanId} : la carte ne peut pas être fabriquée depuis analyses (la question, elle, est réglée)`); return repondreErreur(res, 'SERVEUR'); }
        // 9. la réponse est une VÉRITÉ : écrite une fois (la première gagne), sans jamais changer la réponse au client
        try { await col('analyses').updateOne({ _id: scanId, [`cartes.${carte}.reponse`]: { $exists: false } }, { $set: { [`cartes.${carte}.reponse`]: { choix, idProduct, le } } }); }
        catch (e) { journalErreur('vérité de la réponse', e); }
        const solde = await soldeSur(), offre = await offreP();
        // B6.4 : le crochet du banc réel, APRÈS la vérification du porteur (analyses) et l'acceptation de la réponse ; jamais attendu, ne lève jamais
        require('../banc/crochet').apresReponse({ cfg, req, scanId: b.scanId, carte, choix, idProduct });
        return res.status(200).json({ success: true, carte: resolue, facturation, ...(enAttente ? { remboursementEnAttente: true } : {}), ...(declaration ? { declaration } : {}), ...(solde !== undefined ? { solde } : {}), ...avecOffre(offre) });     // remboursementEnAttente : additif, présent SEULEMENT quand un remboursement de lot dû n'est pas encore fait (le balayage le fera)
    };
}

module.exports = { DELAI_VOISINS_MS, consulterSecondeLecture, validerEntree, rattacherPhotos, lirePhotoIds, verifierEntree, comparerVersions, traiterIdentifier, traiterReponse, facturationDe, carteRepondue };
