'use strict';
// Ma collection — GET /api/collection, GET /api/collection/sets/:slug, PUT /api/collection/sets/:slug/fiches/:cle, PUT /api/collection/produits/:idproduct (L5), sur la SESSION du compte (comme le scanner : mêmes gardes, réutilisées).
//   L5/L6 : `etat` et `langue` (listes fermées, forme.js) désignent une variante d'exemplaire — additifs, voir CONTRAT-API-V2.md §1.8.
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

const nomErreur = e => (e && e.name) || 'Error';           // jamais e.message : un pilote peut y mettre une adresse
const indispo = res => repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
// Le corps : { possedee: booléen } ; l'extension FACULTATIVE { possedee: true, quantite: n } (n entier de 1 à 99) pour les doubles. `quantite` absente : 1 sur une clé neuve, inchangée sur une clé déjà cochée. Tout autre champ ou type : 400 ENTREE, le `detail` nomme
// le champ fautif (`quantite` pour une quantité hors 1…99, un type faux, ou une quantité avec `possedee: false` ; `possedee` pour tout le reste).
// L5/L6 — extension facultative : `etat` (F.ETATS) et/ou `langue` (F.LANGUES) désignent une VARIANTE d'exemplaire de la fiche : { possedee: true, etat?, langue?, quantite? } fixe la quantité de CETTE variante ;
// { possedee: false, etat?, langue? } la retire. Un corps sans etat ni langue est lu exactement comme avant (`variante` faux, aucune clé de plus dans le résultat d'avant). Valeur hors liste, null, type faux :
// 400 ENTREE, detail `etat` ou `langue`.
function lireCorps(b, max) {
    if (b === null || typeof b !== 'object' || Array.isArray(b) || typeof b.possedee !== 'boolean') return { detail: 'possedee' };
    if (Object.keys(b).some(k => k !== 'possedee' && k !== 'quantite' && k !== 'etat' && k !== 'langue')) return { detail: 'possedee' };
    if (Object.hasOwn(b, 'etat') && !F.etatValide(b.etat)) return { detail: 'etat' };
    if (Object.hasOwn(b, 'langue') && !F.langueValide(b.langue)) return { detail: 'langue' };
    const variante = Object.hasOwn(b, 'etat') || Object.hasOwn(b, 'langue');
    const plus = variante ? { ...(Object.hasOwn(b, 'etat') ? { etat: b.etat } : {}), ...(Object.hasOwn(b, 'langue') ? { langue: b.langue } : {}), variante: true } : { variante: false };
    if (!Object.hasOwn(b, 'quantite')) return { possedee: b.possedee, quantite: undefined, ...plus };       // absente : 1 sur une clé neuve, INCHANGÉE sur une clé déjà cochée (service.js)
    if (b.possedee !== true || !Number.isInteger(b.quantite) || b.quantite < 1 || b.quantite > max) return { detail: 'quantite' };
    return { possedee: true, quantite: b.quantite, ...plus };
}
const MESSAGES_BORNE = Object.freeze({
    'borne-compte': n => `Au plus ${n} fiches cochées au total sur un compte`,
    'borne-sets': n => `Au plus ${n} sets avec des fiches cochées par compte`,
    'borne-hors': n => `Au plus ${n} fiches cochées hors du catalogue sur un compte`,
    'borne-quantites': n => `Au plus ${n} fiches avec une quantité de plus d'un exemplaire par compte`,
    'borne-quantite': n => `Au plus ${n} exemplaires d'une même fiche`,
    'borne-exemplaires': n => `Au plus ${n} exemplaires détaillés (état, langue) par compte`,
    'exemplaires': () => 'La quantité est inférieure au détail (état, langue) déjà enregistré pour cette fiche',
    'borne-service': () => 'Limite atteinte pour l\'ensemble du service (budget de stockage partagé), pas pour votre compte'
});
// un compte dont l'adresse n'est pas confirmée n'écrit pas : même refus que le scanner pour ses crédits (403 VERIFICATION), sans solde (aucun crédit n'est en jeu)
function exigerVerifie(req, res, next) {
    return req.v2.porteur.compte && req.v2.porteur.compte.verifie === true ? next() : repondreErreur(res, 'VERIFICATION', 'Confirmez votre adresse e-mail pour enregistrer votre collection');
}

function routesCollection(router, cfg) {
    const parCompte = L.limiteur({ nom: 'collection', max: cfg.limites.collectionEcrituresParCompteHeure, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
    const LECTURE = [resoudrePorteur(cfg), exigerSession];
    const ECRITURE = [resoudrePorteur(cfg), exigerSession, S.exigerOrigineSite(cfg), exigerVerifie, parCompte];
    const entree = (res, detail) => repondreErreur(res, 'ENTREE', 'Requête invalide', { detail });
    const compteId = req => req.v2.porteur.id;

    router.get('/api/collection', ...LECTURE, async (req, res) => {
        try {
            const sets = await svc.lireSets(compteId(req));
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, sets: sets.map(s => ({ slug: s.slug, possedees: s.possedees, majLe: s.majLe.toISOString() })) });
        } catch (e) { console.error(`❌ [v2 collection] lecture des sets : ${nomErreur(e)}`); return indispo(res); }
    });

    router.get('/api/collection/sets/:slug', ...LECTURE, async (req, res) => {
        try {
            if (!F.slugValide(req.params.slug)) return entree(res, 'slug');
            const s = await svc.lireSet(compteId(req), req.params.slug);
            res.setHeader('Cache-Control', 'no-store');
            // `cotes` : la cote du guide de chaque fiche du set connue du lien EN MÉMOIRE (collection/cotes.js, CONTRAT-API-V2.md §1.8). Aucun chargement réussi, ou une panne du guide : {} — le site lit {} comme « null pour toute fiche ».
            let cotes = {};
            try { cotes = await cotesDuSet(req.params.slug); } catch (e) { console.error(`❌ [v2 collection] cotes (le guide ne répond pas, {} rendu) : ${nomErreur(e)}`); }
            // `quantites` : seulement les clés à n ≥ 2, et le champ ABSENT quand il n'y en a aucune (la réponse d'avant, à l'octet près)
            const quantites = Object.keys(s.quantites).length ? { quantites: s.quantites } : {};
            // `exemplaires` (L5/L6) : le détail par état et langue, ABSENT quand aucune fiche du set n'en porte (la réponse d'avant, à l'octet près)
            const exemplaires = Object.keys(s.exemplaires).length ? { exemplaires: s.exemplaires } : {};
            return res.status(200).json({ success: true, set: req.params.slug, possedees: s.cles, ...quantites, ...exemplaires, cotes, majLe: s.majLe ? s.majLe.toISOString() : null });
        } catch (e) { console.error(`❌ [v2 collection] lecture d'un set : ${nomErreur(e)}`); return indispo(res); }
    });

    // L'écriture d'UNE fiche (slug, cle) : la même pour le PUT par fiche et pour le PUT par produit (une seule définition, §21 bis). `plus` : les champs ajoutés à la réponse (la fiche résolue, pour le produit).
    async function ecrireFiche(req, res, slug, cle, corps, plus = {}) {
        const r = corps.variante
            ? await svc.ecrireVariante({ compteId: compteId(req), slug, cle, possedee: corps.possedee, quantite: corps.quantite, etat: corps.etat, langue: corps.langue, cfg })
            : await svc.cocher({ compteId: compteId(req), slug, cle, possedee: corps.possedee, quantite: corps.quantite, cfg });
        // aucun catalogue chargé et la clé n'est pas encore au registre : RIEN n'est écrit, le site réessaie dans quelques secondes (le chargement part au démarrage de l'instance)
        if (r.refus === 'catalogue') return repondreErreur(res, 'INDISPONIBLE', 'Le catalogue des fiches n\'est pas encore chargé : réessayez dans quelques secondes', { detail: 'catalogue', reessayerDans: r.reessayerDans });
        if (r.refus) return repondreErreur(res, 'CONFLIT', MESSAGES_BORNE[r.refus](r.borne), { detail: r.refus });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, possedees: r.possedees, ...plus });
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

    // L5 — PUT /api/collection/produits/:idProduct : l'ajout depuis un verdict ou une recherche. Le produit se résout en UNE fiche par l'index inverse du catalogue CHARGÉ (jamais une devinette) :
    //   aucun catalogue (ou un index qui ne répond pas) → 503 `catalogue` ; aucune fiche → 404 INTROUVABLE ; plusieurs fiches distinctes → 409 CONFLIT `ambigu` (les candidates nommées, le site choisit
    //   et écrit par fiche) ; une seule → exactement le PUT par fiche. L'ordre des refus est celui du PUT par fiche : session, origine, vérification, limite, forme (idProduct, corps), puis la résolution.
    router.put('/api/collection/produits/:idproduct', ...ECRITURE, async (req, res) => {
        try {
            if (!F.idProduitValide(req.params.idproduct)) return entree(res, 'idProduct');
            const corps = lireCorps(req.body, cfg.collection.quantiteMax);
            if (corps.detail) return entree(res, corps.detail);
            let candidates = null;
            try { const v = etat.version(); candidates = v && typeof v.fichesDuProduit === 'function' ? v.fichesDuProduit(Number(req.params.idproduct)) : null; } catch (e) { candidates = null; }
            if (candidates === null) return repondreErreur(res, 'INDISPONIBLE', 'Le catalogue des fiches n\'est pas encore chargé : réessayez dans quelques secondes', { detail: 'catalogue', reessayerDans: REESSAI_CATALOGUE_S });
            if (candidates.length === 0) return repondreErreur(res, 'INTROUVABLE', 'Aucune fiche du catalogue ne porte ce produit', { detail: 'produit' });
            if (candidates.length > 1) return repondreErreur(res, 'CONFLIT', 'Ce produit désigne plusieurs fiches : choisissez la fiche', { detail: 'ambigu', fiches: candidates.slice(0, 10) });
            const { set, cle } = candidates[0];
            return await ecrireFiche(req, res, set, cle, corps, { set, cle });
        } catch (e) { console.error(`❌ [v2 collection] écriture par produit : ${nomErreur(e)}`); return indispo(res); }
    });
}
module.exports = { routesCollection, lireCorps };
