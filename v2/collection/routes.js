'use strict';
// Ma collection — GET /api/collection, GET /api/collection/valeur (L6), GET /api/collection/sets/:slug, PUT /api/collection/sets/:slug/fiches/:cle, PUT /api/collection/sets/:slug/fiches/:cle/exemplaires (K5, L5/L6),
// PUT /api/collection/produits/:idproduct (L5), sur la SESSION du compte (comme le scanner : mêmes gardes, réutilisées).
//   · LIRE demande une session (cookie) ; ÉCRIRE demande en plus l'Origin exacte du site + X-Rat-Market, un compte VÉRIFIÉ (données stockées sur la grappe de production) et passe par un limiteur par compte ;
//   · l'ORDRE : identité, session, origine, vérification, limite, puis la forme (chemin, corps), puis l'écriture — un refus de forme est un refus compté, jamais une écriture ;
//   · la clé d'une fiche est `idInterne|numero` (forme.js) : le serveur ne peut pas vérifier qu'elle désigne une fiche réelle, il en juge la forme.
const { repondreErreur } = require('../erreurs');
const L = require('../transport/limites');
const S = require('../comptes/sessions');
const { resoudrePorteur, exigerSession } = require('../porteur');
const F = require('./forme');
const svc = require('./service');
const { cotesDuSet } = require('./cotes');
const etat = require('../chargeur/etat');
const REESSAI_CATALOGUE_S = 5;                                  // le même délai que service.js : le chargement vient en quelques secondes
const VALEUR_SETS_MAX = 200;                                    // la valeur totale lit les cotes set par set (une requête du guide chacun) : au-delà, elle est PARTIELLE et le dit
// GET /api/collection/valeur fait jusqu'à 200 lectures de set et 200 requêtes du guide par appel (relecture 2) : un limiteur de LECTURE par compte (30 par heure, constante écrite, posée sans mesure d'usage réel) ET un
// cache par compte (60 s au plus, borné à 1 000 comptes), INVALIDÉ à chaque écriture de la collection de CE compte. Le site décide s'il affiche la valeur.
const VALEUR_LECTURES_PAR_HEURE = 30, VALEUR_CACHE_MS = 60e3, VALEUR_CACHE_COMPTES = 1000;
// DÉCISION DE L'UTILISATEUR (31/10, maintenue le 07/11) : AUCUNE valeur Cardmarket dans les routes de la collection (ni `cotes` par fiche, ni valeur totale), même pour les cartes possédées, tant que l'accord de Cardmarket
// n'existe pas. Tout le code qui sert un prix (`cotes` de GET /sets/{slug}, GET /api/collection/valeur) est derrière UN drapeau, `cfg.collection.cotes` (V2_COLLECTION_COTES, ÉTEINT par défaut, refusé hors banc : config.js).
// Éteint : `cotes` est ABSENT de la réponse du set, le guide n'est pas lu, et /valeur n'est pas montée (404 natif).

const nomErreur = e => (e && e.name) || 'Error';           // jamais e.message : un pilote peut y mettre une adresse
const indispo = res => repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
// Le corps : { possedee: booléen } ; l'extension FACULTATIVE { possedee: true, quantite: n } (n entier de 1 à 99) pour les doubles. `quantite` absente : 1 sur une clé neuve, inchangée sur une clé déjà cochée. Tout autre champ ou type : 400 ENTREE, le `detail` nomme
// le champ fautif (`quantite` pour une quantité hors 1…99, un type faux, ou une quantité avec `possedee: false` ; `possedee` pour tout le reste).
function lireCorps(b, max) {
    if (b === null || typeof b !== 'object' || Array.isArray(b) || typeof b.possedee !== 'boolean') return { detail: 'possedee' };
    if (Object.keys(b).some(k => k !== 'possedee' && k !== 'quantite')) return { detail: 'possedee' };
    if (!Object.hasOwn(b, 'quantite')) return { possedee: b.possedee, quantite: undefined };       // absente : 1 sur une clé neuve, INCHANGÉE sur une clé déjà cochée (service.js)
    if (b.possedee !== true || !Number.isInteger(b.quantite) || b.quantite < 1 || b.quantite > max) return { detail: 'quantite' };
    return { possedee: true, quantite: b.quantite };
}
// K5 (le site, O13) : { exemplaires: [{ etat: <liste fermée>|null, langue: <liste fermée>|null }] }, AU PLUS `max` éléments (la quantité maximale d'une fiche). Les deux clés sont obligatoires dans chaque élément (null admis) ;
// tout autre champ, type ou valeur hors liste : 400 ENTREE, detail `exemplaires` (la structure), `etat` ou `langue` (une valeur).
function lireExemplaires(b, max) {
    if (b === null || typeof b !== 'object' || Array.isArray(b) || !Array.isArray(b.exemplaires) || Object.keys(b).some(k => k !== 'exemplaires') || b.exemplaires.length > max) return { detail: 'exemplaires' };
    for (const x of b.exemplaires) {
        if (x === null || typeof x !== 'object' || Array.isArray(x) || !Object.hasOwn(x, 'etat') || !Object.hasOwn(x, 'langue') || Object.keys(x).some(k => k !== 'etat' && k !== 'langue')) return { detail: 'exemplaires' };
        if (x.etat !== null && !F.etatValide(x.etat)) return { detail: 'etat' };
        if (x.langue !== null && !F.langueValide(x.langue)) return { detail: 'langue' };
    }
    return { exemplaires: b.exemplaires.map(x => ({ etat: x.etat, langue: x.langue })) };
}
const MESSAGES_BORNE = Object.freeze({
    'borne-compte': n => `Au plus ${n} fiches cochées au total sur un compte`,
    'borne-sets': n => `Au plus ${n} sets avec des fiches cochées par compte`,
    'borne-hors': n => `Au plus ${n} fiches cochées hors du catalogue sur un compte`,
    'borne-quantites': n => `Au plus ${n} fiches avec une quantité de plus d'un exemplaire par compte`,
    'borne-exemplaires': n => `Au plus ${n} entrées de détail (état, langue) par compte`,
    'reessayer': () => 'Écritures simultanées : réessayez',
    'exemplaires': () =>'Le détail (état, langue) doit porter sur une fiche cochée et ne peut pas dépasser sa quantité ; la quantité ne peut pas passer sous le détail',
    'borne-service': () => 'Limite atteinte pour l\'ensemble du service (budget de stockage partagé), pas pour votre compte'
});
// un compte dont l'adresse n'est pas confirmée n'écrit pas : même refus que le scanner pour ses crédits (403 VERIFICATION), sans solde (aucun crédit n'est en jeu)
function exigerVerifie(req, res, next) {
    return req.v2.porteur.compte && req.v2.porteur.compte.verifie === true ? next() : repondreErreur(res, 'VERIFICATION', 'Confirmez votre adresse e-mail pour enregistrer votre collection');
}

function routesCollection(router, cfg) {
    const parCompte = L.limiteur({ nom: 'collection', max: cfg.limites.collectionEcrituresParCompteHeure, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
    const LECTURE = [resoudrePorteur(cfg), exigerSession];
    const parLectureValeur = L.limiteur({ nom: 'collection-valeur', max: VALEUR_LECTURES_PAR_HEURE, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
    const cacheValeur = new Map();                                  // compteId → { jusqua, corps } ; vidé pour CE compte à chaque écriture de sa collection
    const invalider = id => cacheValeur.delete(String(id));
    const ECRITURE = [resoudrePorteur(cfg), exigerSession, S.exigerOrigineSite(cfg), exigerVerifie, parCompte];
    const entree = (res, detail) => repondreErreur(res, 'ENTREE', 'Requête invalide', { detail });
    const compteId = req => req.v2.porteur.id;
    const indisponibleCatalogue = res => repondreErreur(res, 'INDISPONIBLE', 'Le catalogue des fiches n\'est pas encore chargé : réessayez dans quelques secondes', { detail: 'catalogue', reessayerDans: REESSAI_CATALOGUE_S });
    const refus = (res, r) => (r.refus === 'concurrence'
        ? repondreErreur(res, 'INDISPONIBLE', 'Écritures simultanées sur cette fiche : réessayez dans un instant', { detail: 'reessayer', reessayerDans: 1 })
        : r.refus === 'catalogue'
        ? repondreErreur(res, 'INDISPONIBLE', 'Le catalogue des fiches n\'est pas encore chargé : réessayez dans quelques secondes', { detail: 'catalogue', reessayerDans: r.reessayerDans })
        : repondreErreur(res, 'CONFLIT', MESSAGES_BORNE[r.refus](r.borne), { detail: r.refus }));

    router.get('/api/collection', ...LECTURE, async (req, res) => {
        try {
            const sets = await svc.lireSets(compteId(req));
            res.setHeader('Cache-Control', 'no-store');
            // `doublons` (L6) : Σ(quantité − 1) du set, ABSENT d'un set sans double (la réponse d'avant, à l'octet près)
            return res.status(200).json({ success: true, sets: sets.map(s => ({ slug: s.slug, possedees: s.possedees, majLe: s.majLe.toISOString(), ...(s.doublons > 0 ? { doublons: s.doublons } : {}) })) });
        } catch (e) { console.error(`❌ [v2 collection] lecture des sets : ${nomErreur(e)}`); return indispo(res); }
    });

    // L6 — la VALEUR TOTALE de ma collection. NON MONTÉE par défaut (drapeau V2_COLLECTION_COTES éteint : décision du 31/10 maintenue, aucune valeur Cardmarket) — 404 natif. Allumée (bancs seulement), au propriétaire connecté SEULEMENT : sous la même LECTURE (cookie de session), `no-store`, et nulle part ailleurs. La somme de
    // tendance du guide × quantité des fiches qui ont une cote (collection/cotes.js : la règle de la cote d'une fiche) ; les exemplaires sans cote sont comptés à part (jamais estimés). Au plus VALEUR_SETS_MAX sets : au-delà,
    // `partielle` vaut true. Aucune écriture, aucun stockage.
    if (cfg.collection.cotes === true) router.get('/api/collection/valeur', ...LECTURE, parLectureValeur, async (req, res) => {
        try {
            const dejaCalcule = cacheValeur.get(String(compteId(req)));
            if (dejaCalcule && dejaCalcule.jusqua > Date.now()) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json(dejaCalcule.corps); }
            const sets = await svc.lireSets(compteId(req));
            let valeur = 0, nb = 0, sansCote = 0, partielle = sets.length > VALEUR_SETS_MAX;
            for (const s of sets.slice(0, VALEUR_SETS_MAX)) {
                const set = await svc.lireSet(compteId(req), s.slug);
                let cotes = {};
                try { cotes = await cotesDuSet(s.slug); } catch (e) { partielle = true; console.error(`❌ [v2 collection] valeur (le guide ne répond pas pour un set) : ${nomErreur(e)}`); }
                for (const k of set.cles) {
                    const q = set.quantites[k] || 1, c = cotes[k];
                    nb += q;
                    if (c && typeof c.tendance === 'number') valeur += c.tendance * q; else sansCote += q;
                }
            }
            res.setHeader('Cache-Control', 'no-store');
            const corps = { success: true, valeurTotale: Math.round(valeur * 100) / 100, devise: 'EUR', nbExemplaires: nb, sansCote, partielle };
            if (cacheValeur.size >= VALEUR_CACHE_COMPTES) cacheValeur.delete(cacheValeur.keys().next().value);
            cacheValeur.set(String(compteId(req)), { jusqua: Date.now() + VALEUR_CACHE_MS, corps });
            return res.status(200).json(corps);
        } catch (e) { console.error(`❌ [v2 collection] valeur : ${nomErreur(e)}`); return indispo(res); }
    });

    router.get('/api/collection/sets/:slug', ...LECTURE, async (req, res) => {
        try {
            if (!F.slugValide(req.params.slug)) return entree(res, 'slug');
            const s = await svc.lireSet(compteId(req), req.params.slug);
            res.setHeader('Cache-Control', 'no-store');
            // `cotes` : la cote du guide de chaque fiche du set connue du lien EN MÉMOIRE (collection/cotes.js, CONTRAT-API-V2.md §1.8). Aucun chargement réussi, ou une panne du guide : {} — le site lit {} comme « null pour toute fiche ».
            //   Drapeau ÉTEINT (le défaut, décision du 31/10) : pas de champ `cotes`, le guide n'est pas lu.
            const avecCotes = cfg.collection.cotes === true; let cotes = {};
            if (avecCotes) { try { cotes = await cotesDuSet(req.params.slug); } catch (e) { console.error(`❌ [v2 collection] cotes (le guide ne répond pas, {} rendu) : ${nomErreur(e)}`); } }
            // `quantites` : seulement les clés à n ≥ 2, et le champ ABSENT quand il n'y en a aucune (la réponse d'avant, à l'octet près)
            const quantites = Object.keys(s.quantites).length ? { quantites: s.quantites } : {};
            // `exemplaires` (K5) : UN élément { etat, langue } par exemplaire détaillé, ABSENT quand aucune fiche du set n'en porte (la réponse d'avant, à l'octet près)
            const exemplaires = Object.keys(s.exemplaires).length ? { exemplaires: s.exemplaires } : {};
            return res.status(200).json({ success: true, set: req.params.slug, possedees: s.cles, ...quantites, ...exemplaires, ...(avecCotes ? { cotes } : {}), majLe: s.majLe ? s.majLe.toISOString() : null });
        } catch (e) { console.error(`❌ [v2 collection] lecture d'un set : ${nomErreur(e)}`); return indispo(res); }
    });

    // L'écriture d'UNE fiche (slug, cle) : la même pour le PUT par fiche et pour le PUT par produit (une seule définition, §21 bis). `plus` : les champs ajoutés à la réponse (la fiche résolue, pour le produit).
    // La réponse porte aussi la fiche à jour (`quantite`, `exemplaires`) QUAND elle a un détail, et seulement alors (la réponse d'avant, à l'octet près, pour toute autre fiche).
    async function ecrireFiche(req, res, slug, cle, corps, plus = {}) {
        let r;
        try { r = await svc.cocher({ compteId: compteId(req), slug, cle, possedee: corps.possedee, quantite: corps.quantite, cfg }); } finally { invalider(compteId(req)); }
        // aucun catalogue chargé et la clé n'est pas encore au registre : RIEN n'est écrit, le site réessaie dans quelques secondes (le chargement part au démarrage de l'instance)
        if (r.refus) return refus(res, r);
        // r3 : l'écriture A EU LIEU ; une erreur en lisant le détail pour la réponse ne doit pas faire croire à un échec — réponse de succès minimale (le détail se relit par GET)
        let detail = {};
        if (corps.possedee) { try { detail = await svc.detailDeLaFiche(compteId(req), slug, cle); } catch (e) { console.error(`❌ [v2 collection] détail de la fiche après écriture (réponse minimale) : ${nomErreur(e)}`); } }
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, possedees: r.possedees, ...plus, ...detail });
    }

    router.put('/api/collection/sets/:slug/fiches/:cle', ...ECRITURE, async (req, res) => {
        try {
            if (!F.slugValide(req.params.slug)) return entree(res, 'slug');
            if (!F.cleValide(req.params.cle)) return entree(res, 'cle');
            const corps = lireCorps(req.body, cfg.collection.quantiteMax);
            if (corps.detail) return entree(res, corps.detail);
            return await ecrireFiche(req, res, req.params.slug, req.params.cle, corps);
        } catch (e) { console.error(`❌ [v2 collection] écriture : ${nomErreur(e)}`); return indispo(res); }
    });

    // K5 — PUT /api/collection/sets/:slug/fiches/:cle/exemplaires : REMPLACE tout le détail (état, langue) des exemplaires d'une fiche COCHÉE. Mêmes gardes et même ordre que le PUT par fiche. Réponse { success, exemplaires } : la
    // liste développée du détail STOCKÉ (un élément { null, null } du corps est un exemplaire non précisé : il n'est pas stocké, il ne revient pas).
    router.put('/api/collection/sets/:slug/fiches/:cle/exemplaires', ...ECRITURE, async (req, res) => {
        try {
            if (!F.slugValide(req.params.slug)) return entree(res, 'slug');
            if (!F.cleValide(req.params.cle)) return entree(res, 'cle');
            const corps = lireExemplaires(req.body, cfg.collection.quantiteMax);
            if (corps.detail) return entree(res, corps.detail);
            let r;
            try { r = await svc.remplacerExemplaires({ compteId: compteId(req), slug: req.params.slug, cle: req.params.cle, elements: corps.exemplaires, cfg }); } finally { invalider(compteId(req)); }
            if (r.refus) return refus(res, r);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, exemplaires: r.exemplaires });
        } catch (e) { console.error(`❌ [v2 collection] détail des exemplaires : ${nomErreur(e)}`); return indispo(res); }
    });

    // L5 — PUT /api/collection/produits/:idproduct : l'ajout depuis un verdict ou une recherche. Le produit se résout en UNE fiche par l'index inverse du catalogue CHARGÉ (jamais une devinette) :
    //   aucun catalogue (ou un index qui ne répond pas, ou une fiche résolue que la forme refuse) → 503 `catalogue` ; aucune fiche → 404 INTROUVABLE ; plusieurs fiches distinctes → 409 CONFLIT `ambigu` (les candidates
    //   nommées, le site choisit et écrit par fiche) ; une seule → exactement le PUT par fiche. L'ordre des refus est celui du PUT par fiche : session, origine, vérification, limite, forme (idProduct, corps), puis la résolution.
    //   `no-store` sur TOUTES les réponses de la route (relecture 2).
    router.put('/api/collection/produits/:idproduct', ...ECRITURE, async (req, res) => {
        try {
            res.setHeader('Cache-Control', 'no-store');
            if (!F.idProduitValide(req.params.idproduct)) return entree(res, 'idProduct');
            const corps = lireCorps(req.body, cfg.collection.quantiteMax);
            if (corps.detail) return entree(res, corps.detail);
            let candidates = null;
            try { const v = etat.version(); candidates = v && typeof v.fichesDuProduit === 'function' ? v.fichesDuProduit(Number(req.params.idproduct)) : null; } catch (e) { candidates = null; }
            if (candidates === null) return indisponibleCatalogue(res);
            if (candidates.length === 0) return repondreErreur(res, 'INTROUVABLE', 'Aucune fiche du catalogue ne porte ce produit', { detail: 'produit' });
            if (candidates.length > 1) return repondreErreur(res, 'CONFLIT', 'Ce produit désigne plusieurs fiches : choisissez la fiche', { detail: 'ambigu', fiches: candidates.slice(0, 10) });
            const { set, cle } = candidates[0];
            // la fiche résolue est RE-JUGÉE par la forme, comme celle d'un PUT par fiche (relecture 1, m1) : une garde qui ne peut pas conclure bloque
            if (!F.slugValide(set) || !F.cleValide(cle)) return indisponibleCatalogue(res);
            return await ecrireFiche(req, res, set, cle, corps, { set, cle });
        } catch (e) { console.error(`❌ [v2 collection] écriture par produit : ${nomErreur(e)}`); return indispo(res); }
    });
}
module.exports = { routesCollection, lireCorps, lireExemplaires, VALEUR_LECTURES_PAR_HEURE };
