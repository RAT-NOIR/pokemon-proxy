'use strict';
// COTES-VISUELS, tours 1-2 — la voie « FICHIER PRÉCALCULÉ » : la même décision, calculée HORS de l'API (un script autonome), écrite au format de format.js, compressée, SCELLÉE (HMAC) ; l'API ne fait que
// lire l'objet R2 privé et le charger. Les deux voies partagent calculer() et format.js : un seul calcul, un seul format.
// Le producteur ne publie JAMAIS ce que le consommateur refuserait : il fait un ALLER-RETOUR complet (désérialise sa propre sortie avec le code du consommateur, rejuge chaque entrée) et refuse sinon.
const { calculer } = require('./calcul');
const F = require('./format');
const { rejugerEntreesParPaquets } = require('./version');
const { sceller } = require('./scellement');

const echec = motif => Object.assign(new Error('archive refusée'), { motif });

/** Calcule, sérialise, vérifie par aller-retour, scelle. @returns {{ brut, gz, scelle, comptes, entree, dureeMs }} — n'écrit rien : l'appelant dépose le fichier. */
async function fabriquerFichier({ source, catalogue, regle = () => require('./regle-site').regleEmbarquee(), decider, secret = null }) {
    const t0 = Date.now();
    const src = await source();
    if (!src.ok) throw echec(src.raison);
    let r;
    try { r = await calculer({ sets: src.sets, docs: src.docs, lignes: src.lignes, metacarte: catalogue, regle: await regle(), decider }); } finally { try { await src.fermer(); } catch { /* déjà fermée */ } }
    if (!r.version) throw echec('0 visuel sur une base non vide : aucun fichier écrit');
    if (r.comptes.fichesLiees === 0) throw echec('0 lien fiche → produits : aucun fichier écrit');
    const entree = { sets: r.comptes.sets, cartes: r.comptes.cartes, produits: r.comptes.produits, catalogue: r.comptes.catalogue };
    const brut = F.serialiser(r.version, { entree });
    const gz = await F.compresser(brut);
    // ALLER-RETOUR : le consommateur lirait-il ce que je m'apprête à publier ? (identifiants uniques, structure, validation de chaque entrée, comptes)
    let relu;
    try { relu = F.deserialiser(await F.decompresser(gz)); } catch (e) { throw echec(`aller-retour : le consommateur refuse l'archive (${e && e.motif ? e.motif : (e && e.name) || 'erreur'}) : aucun fichier écrit`); }
    const rj = await rejugerEntreesParPaquets(relu);
    if (!rj.ok) throw echec(`aller-retour : ${rj.refusees} entrée(s) rejetée(s) par la validation d'entrée (${Object.entries(rj.motifs).map(([m, n]) => `${m} : ${n}`).join(' ; ')}) : aucun fichier écrit`);
    if (relu.comptes.visuels !== r.comptes.visuels || relu.comptes.fichesLiees !== r.comptes.fichesLiees) throw echec('aller-retour : les comptes relus diffèrent des comptes calculés : aucun fichier écrit');
    return { brut, gz, scelle: secret ? sceller(gz, secret) : null, comptes: r.comptes, entree, dureeMs: Date.now() - t0 };
}
module.exports = { fabriquerFichier };
