'use strict';
// MARQUE-EMPRUNT — ce que les RÈGLES D'IMAGE lisent de la marque d'emprunt de l'archive (version.empruntDe, posée à la construction d'après la décision `choisirVisuel`).
// Un visuel EMPRUNTÉ est le scan d'une AUTRE impression de la même carte (autre tirage, ou substitut d'un autre set) : ce n'est pas l'image du produit. Aucune règle d'image (G, départage par
// l'image, zone clé) ne tranche sur lui : pour elles, ce produit est « sans visuel propre ».
// DÉFAUT FERMÉ, écrit par ce qu'il AUTORISE : seul un `false` de la colonne dit « pas emprunté ». Une archive d'avant (null), une version absente ou illisible : emprunté (la règle se tait).
const etat = require('../chargeur/etat');

/** Vrai sauf si la version dit explicitement « pas emprunté » (false). null, version absente, fonction absente : vrai. */
function empruntOuInconnu(version, idProduct) {
    if (!version || typeof version.empruntDe !== 'function') return true;
    return version.empruntDe(idProduct) !== false;
}

/**
 * Le contexte de la règle G dont les produits EMPRUNTÉS ont quitté `produits[visuel]` pour rejoindre les « restes » (`invisibles`) des cartes de ce visuel : la règle 4 de decision-g.js
 * (« la carte a des impressions sans visuel : l'image ne peut pas les exclure ») s'applique alors d'elle-même, et la zone clé juge entre vrais jumeaux. Pur : le contexte reçu n'est jamais modifié ;
 * s'il n'y a rien à retirer, le MÊME objet est rendu. @param empruntDe fonction(idProduct) -> true | false | null (null = emprunté : défaut fermé).
 */
function contexteSansEmprunts(ctx, empruntDe) {
    const lire = id => { try { return empruntDe(id); } catch { return null; } };                  // une exception vaut « inconnu » : emprunté, la règle se tait
    const produits = new Map(), ajoutes = new Map();                       // carte (nombre) -> idProduct[] à ajouter aux restes
    let retire = 0;
    for (const [visuel, liste] of ctx.produits) {
        const gardes = [], empruntes = [];
        for (const p of liste) (lire(p[0]) !== false ? empruntes : gardes).push(p);
        if (!empruntes.length) { produits.set(visuel, liste); continue; }
        produits.set(visuel, gardes); retire += empruntes.length;
        for (const carte of ctx.carte.get(visuel) || []) {
            if (!ajoutes.has(carte)) ajoutes.set(carte, []);
            for (const [id] of empruntes) ajoutes.get(carte).push(id);
        }
    }
    if (!retire) return ctx;
    const invisibles = new Map(ctx.invisibles);
    for (const [carte, ids] of ajoutes) invisibles.set(carte, [...new Set([...(invisibles.get(carte) || []), ...ids])]);
    return { ...ctx, produits, invisibles };
}

// Le contexte amendé pour UNE version est gardé (contexte, version) -> amendé : la version bascule rarement, le contexte est celui de l'index en place.
const gardes = new WeakMap();
function contexteDeLaVersion(ctx, version) {
    let parVersion = gardes.get(ctx);
    if (!parVersion) { parVersion = new WeakMap(); gardes.set(ctx, parVersion); }
    if (!parVersion.has(version)) parVersion.set(version, contexteSansEmprunts(ctx, id => (typeof version.empruntDe === 'function' ? version.empruntDe(id) : null)));
    return parVersion.get(version);
}

/**
 * Le contexte que la règle G doit lire pour une requête : `emprunte` (fonction fournie, les bancs) ; sinon la version EN PLACE ; SANS version en place : tout est « inconnu » donc emprunté, G se tait (l'index d'empreintes se charge indépendamment de l'archive : rien n'autorise G à s'appuyer sur un visuel dont on ignore la nature).
 */
function contexteDeLaRegle(ctx, emprunte) {
    if (typeof emprunte === 'function') return contexteSansEmprunts(ctx, emprunte);
    const version = etat.version();
    return version ? contexteDeLaVersion(ctx, version) : contexteSansEmprunts(ctx, () => null);
}

module.exports = { empruntOuInconnu, contexteSansEmprunts, contexteDeLaRegle };
