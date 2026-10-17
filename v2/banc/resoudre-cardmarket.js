'use strict';
// RESOUDRE-CARDMARKET — POST /api/banc/resoudre-cardmarket { url } : l'administrateur colle l'adresse d'une page produit Cardmarket, l'API rend l'idProduct, SANS charger la page (aucune requête vers Cardmarket).
// Derrière le drapeau V2_RESOLUTION_CARDMARKET=1 (monter.js ne monte la route que s'il est allumé : éteint, c'est le 404 natif pour tous). Lecture seule : aucune écriture, aucun argent.
// Écrit par ce qu'il AUTORISE :
//   · l'accès : la garde de rôle de /api/banc/etiquette, réutilisée telle quelle (rôle administrateur RELU en base ; tout le reste est le 404 natif), AVANT le limiteur et AVANT la lecture du corps ;
//   · le corps : { url } et rien d'autre, une chaîne de 2 048 caractères au plus ;
//   · l'adresse : seulement la page exacte d'un produit Pokémon (couplePourLien, la garde de lien-cardmarket.js) ; la requête et l'ancre sont ignorées ;
//   · la résolution : le couple (slugSet, slug) lu dans `numeros_cartes`, une des trois collections de la liste fermée de catalogue.js (la même base que la chaîne ; jamais `cartes`). Un produit n'est rendu
//     que si le catalogue SAIT le décrire (nom Cardmarket + set nommable) : sinon il est « inconnu », jamais un identifiant sans nom.
const { repondreErreur, CODES } = require('../erreurs');
const { colLue } = require('../identifier/catalogue');
const { couplePourLien, lienCanonique } = require('../identifier/lien-cardmarket');

const URL_MAX = 2048;
const IDS_MAX = 20;                                               // borne de lecture : assez pour compter une ambiguïté, jamais une liste ouverte
const journal = (quoi, e) => console.error(`❌ [v2 banc-resoudre-cardmarket] ${quoi} (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message : il peut citer une adresse
// `INTROUVABLE` n'est pas dans la liste fermée des codes (erreurs.js) : on prend ce que prennent les routes du banc pour « inconnu », 404 CODE_INVALIDE, et `detail` dit pourquoi.
const CODE_INCONNU = Object.hasOwn(CODES, 'INTROUVABLE') ? 'INTROUVABLE' : 'CODE_INVALIDE';

/** { detail } si le corps est refusé, sinon { url }. Pure. */
function lireCorps(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { detail: 'corps' };
    if (Object.keys(b).some(k => k !== 'url')) return { detail: 'champ-inconnu' };
    if (typeof b.url !== 'string' || b.url.length > URL_MAX) return { detail: 'url' };
    return { url: b.url };
}

/** Les idProduct distincts que `numeros_cartes` rattache à ce couple exact (la casse compte). Une lecture qui échoue LÈVE. */
async function trouverIdsParDefaut(slugSet, slug) {
    const lignes = await colLue('numeros_cartes').find({ slugSet, slug }, { projection: { idProduct: 1 } }).limit(IDS_MAX).toArray();
    return [...new Set(lignes.map(l => l.idProduct).filter(Number.isSafeInteger))];
}

function traiterResolution(cfg, deps = {}) {
    let catalogueParDefaut = null;
    const catalogueDe = () => deps.catalogue || (catalogueParDefaut = catalogueParDefaut || require('../identifier/catalogue').creerCatalogue({ cfg }));
    const trouverIds = deps.trouverIds || trouverIdsParDefaut;
    return async function traiterResolutionV2(req, res) {
        if (!(req.v2 && req.v2.porteur)) return repondreErreur(res, 'INDISPONIBLE');
        const lu = lireCorps(req.body);
        if (lu.detail) return repondreErreur(res, 'ENTREE', undefined, { detail: lu.detail });
        const couple = couplePourLien(lu.url);
        if (!couple) return repondreErreur(res, 'ENTREE', 'Adresse Cardmarket non reconnue : la page exacte d\'un produit est attendue', { detail: 'adresse-non-produit' }, 422);
        let ids;
        try { ids = await trouverIds(couple.slugSet, couple.slug); }
        catch (e) { journal('couple', e); return repondreErreur(res, 'INDISPONIBLE'); }
        ids = [...new Set(Array.isArray(ids) ? ids : [])];
        if (ids.length === 0) return repondreErreur(res, CODE_INCONNU, 'Aucun produit ne porte cette adresse', { detail: 'produit-inconnu' }, 404);
        if (ids.length > 1) return repondreErreur(res, 'CONFLIT', `${ids.length} produits portent cette adresse : aucun n'est désigné`, { detail: 'ambigu' });
        let table;
        try { table = await catalogueDe().lire(ids); }
        catch (e) { journal('catalogue', e); return repondreErreur(res, 'INDISPONIBLE'); }
        const p = table instanceof Map ? table.get(ids[0]) : null;
        const lien = p ? lienCanonique(couple.slugSet, couple.slug) : null;
        if (!p || !lien) return repondreErreur(res, CODE_INCONNU, 'Aucun produit ne porte cette adresse', { detail: 'produit-inconnu' }, 404);   // une ligne que le catalogue ne sait pas nommer n'est pas un produit rendable
        return res.status(200).json({ success: true, idProduct: p.idProduct, nom: p.nomCardmarket, set: { slug: p.set.slug, nom: p.set.nom }, numero: p.numero, lien });
    };
}

module.exports = { traiterResolution, lireCorps, trouverIdsParDefaut, URL_MAX, CODE_INCONNU };
