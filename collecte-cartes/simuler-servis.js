// ============================================================
// SIMULER LES PRODUITS SERVIS — la règle du site IMPORTÉE, sur des lignes qu'on N'A PAS ENCORE écrites (lot CAND-FICHES, 2026-10-17)
// ============================================================
// Une ligne `cartes_produits` n'est « servie » que si (1) la carte est membre du set (`cartes.sets`), (2) la fiche du site lui attribue le produit
// (fichesDesProduits, exporter-donnees-logos-site.js : la fonction même de l'export), (3) une image ADMISE de la carte, dans CE set, tombe au numéro
// de la fiche (imageDeLImpression + refusDuVisuel du site). Même définition que couverture\S7\COUV\etat-s7.js (§3-4), sans la lecture de toute la base :
// le calcul ne porte que sur les sets nommés. Aucune écriture : `ajouts` et `ajoutsSets` sont des objets en mémoire.
const path = require('path');
const { pathToFileURL } = require('url');
const exporteur = require('../exporter-donnees-logos-site');

const SITE_LIB = path.join('C:/Users/Yung/Desktop/rat-market-site', 'lib');   // le site, importé (jamais recopié)

async function reglesDuSite() {
    const lire = f => import(pathToFileURL(path.join(SITE_LIB, f)).href);
    const [N, L] = await Promise.all([lire('imageDeLImpression.ts'), lire('langueDuVisuel.ts')]);
    const r = { imageDeLImpression: N.imageDeLImpression, refusDuVisuel: L.refusDuVisuel, regle: await exporteur.regleDuSite('C:/Users/Yung/Desktop/pokemon-proxy') };
    for (const k of ['imageDeLImpression', 'refusDuVisuel']) if (typeof r[k] !== 'function') throw new Error(`${k} absent de ${SITE_LIB}`);
    return r;
}

/**
 * @param {object} o
 * @param {object[]} o.setsDocs   documents `sets` à évaluer (avec _id, tirage|region, bulba.expansion, idExpansion, code)
 * @param {object[]} o.cartes     cartes (impressions, images, nomEn, sets) — au moins celles qui touchent ces sets
 * @param {object[]} o.lignes     lignes cartes_produits existantes
 * @param {object[]} o.ajouts     lignes hypothétiques { carteId, idProduct, idExpansion, slug, slugSet, numeroFiche }
 * @param {Map<number,string[]>} o.ajoutsSets  carteId -> slugs de sets qu'un $addToSet ajouterait
 * @returns {Promise<Set<number>>} les idProduct servis
 */
async function produitsServis({ setsDocs, cartes, lignes, ajouts = [], ajoutsSets = new Map(), regles = null }) {
    const R = regles || await reglesDuSite();
    const toutes = [...lignes, ...ajouts];
    const servis = new Set();
    for (const s of setsDocs) {
        const exps = [].concat(s.idExpansion ?? []);
        const docs = cartes.filter(c => typeof c.nomEn === 'string' && c.nomEn !== '' && ((c.sets || []).includes(s._id) || (ajoutsSets.get(c._id) || []).includes(s._id)));
        const ids = new Set(docs.map(d => d._id));
        const ls = toutes.filter(l => exps.includes(l.idExpansion) && ids.has(l.carteId));
        const { fiche } = exporteur.fichesDesProduits(R.regle, s, docs, ls);
        const tir = s.tirage ?? s.region;
        const parId = new Map(cartes.map(c => [c._id, c]));
        for (const l of ls) {
            const F = fiche.get(l.idProduct);
            if (!F || F.carteId !== l.carteId) continue;
            const entrees = (parId.get(l.carteId)?.images || []).filter(e => e.set === s._id && e.cleR2);
            const admis = entrees.filter(e => R.refusDuVisuel(e, tir) === null);
            if (R.imageDeLImpression(admis, F.numero) !== null) servis.add(l.idProduct);
        }
    }
    return servis;
}

/** Diagnostic d'UN produit après ajout : sa fiche (numéro) et les entrées d'image de sa carte dans le set. */
async function diagnostic({ set, carte, idProduct, cartes, lignes, ajouts, ajoutsSets, regles = null }) {
    const R = regles || await reglesDuSite();
    const toutes = [...lignes, ...ajouts];
    const exps = [].concat(set.idExpansion ?? []);
    const docs = cartes.filter(c => typeof c.nomEn === 'string' && c.nomEn !== '' && ((c.sets || []).includes(set._id) || (ajoutsSets.get(c._id) || []).includes(set._id)));
    const ids = new Set(docs.map(d => d._id));
    const ls = toutes.filter(l => exps.includes(l.idExpansion) && ids.has(l.carteId));
    const { fiche, doubles } = exporteur.fichesDesProduits(R.regle, set, docs, ls);
    const F = fiche.get(idProduct) || null;
    const entrees = (carte.images || []).filter(e => e.set === set._id && e.cleR2);
    const tir = set.tirage ?? set.region;
    return { fiche: F ? { carteId: F.carteId, numero: F.numero } : null, doubles, entreesDuSet: entrees.map(e => ({ numero: e.numero, source: e.source, langue: e.langue, refus: R.refusDuVisuel(e, tir) })) };
}

module.exports = { produitsServis, diagnostic, reglesDuSite };
