'use strict';
// COTES-VISUELS, tour 1 — la voie « FICHIER PRÉCALCULÉ » : la même décision, calculée HORS de l'API (un script autonome), écrite au format de format.js, compressée ; l'API ne fait que lire
// le fichier (téléchargé plus tard depuis R2) et le charger. Les deux voies partagent calculer() et format.js : un seul calcul, un seul format.
const { calculer } = require('./calcul');
const F = require('./format');

/** Calcule et sérialise. @returns {{ brut: Buffer, gz: Buffer, comptes: object, entree: object, dureeMs: number }} — n'écrit rien : l'appelant dépose le fichier. */
async function fabriquerFichier({ source, catalogue, regle = () => require('./regle-site').regleEmbarquee(), decider }) {
    const t0 = Date.now();
    const src = await source();
    if (!src.ok) throw Object.assign(new Error('lecture refusée'), { motif: src.raison });
    let r;
    try { r = await calculer({ sets: src.sets, docs: src.docs, lignes: src.lignes, metacarte: catalogue, regle: await regle(), decider }); } finally { try { await src.fermer(); } catch { /* déjà fermée */ } }
    if (!r.version) throw Object.assign(new Error('rien d\'admissible'), { motif: '0 visuel sur une base non vide : aucun fichier écrit' });
    if (r.comptes.fichesLiees === 0) throw Object.assign(new Error('rien de lié'), { motif: '0 lien fiche → produits : aucun fichier écrit' });
    const entree = { sets: r.comptes.sets, cartes: r.comptes.cartes, produits: r.comptes.produits, catalogue: r.comptes.catalogue };
    const brut = F.serialiser(r.version, { entree });
    return { brut, gz: await F.compresser(brut), comptes: r.comptes, entree, dureeMs: Date.now() - t0 };
}
module.exports = { fabriquerFichier };
