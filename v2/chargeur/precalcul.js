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
async function fabriquerFichier({ source, catalogue, regle = () => require('./regle-site').regleEmbarquee(), decider, secret = null, exclusions = null, verdictsEmprunts = null, jumbosVisuel = null }) {
    const t0 = Date.now();
    const src = await source();
    if (!src.ok) throw echec(src.raison);
    const comptesSource = src.comptes || null;            // EDITION-LOCALE : ce que la lecture a rejeté (imprimé par l'outil, jamais écrit dans l'archive)
    let r;
    try { r = await calculer({ sets: src.sets, docs: src.docs, lignes: src.lignes, metacarte: catalogue, regle: await regle(), decider, exclusions, verdictsEmprunts, jumbosVisuel }); } finally { try { await src.fermer(); } catch { /* déjà fermée */ } }
    if (!r.version) throw echec('0 visuel sur une base non vide : aucun fichier écrit');
    if (r.comptes.fichesLiees === 0) throw echec('0 lien fiche → produits : aucun fichier écrit');
    if (!r.version.colonneJumeaux) throw echec('JUMEAU-V2 : la version calculée n\'a pas la colonne des jumeaux (la route n\'affirmerait aucun produit) : aucun fichier écrit');
    if (!r.version.colonneMarquages) throw echec('REPLI-REIMPRESSIONS : la version calculée n\'a pas la colonne des marquages (la route ne saurait pas qu\'un produit est partagé) : aucun fichier écrit');
    const entree = { sets: r.comptes.sets, cartes: r.comptes.cartes, produits: r.comptes.produits, catalogue: r.comptes.catalogue,
        // m1 : les compteurs de REPLI voyagent dans l'en-tête, pour que le journal du chargeur les imprime aussi pour une archive précalculée
        repli: { repliRefuse: r.comptes.repliRefuse, familleHorsListe: r.comptes.familleHorsListe, basseDefinitionExclue: r.comptes.basseDefinitionExclue, partageIncoherent: r.comptes.partageIncoherent, varianteSansPreuve: r.comptes.varianteSansPreuve, varianteHorsListe: r.comptes.varianteHorsListe } };
    const brut = F.serialiser(r.version, { entree });
    const gz = await F.compresser(brut);
    // ALLER-RETOUR : le consommateur lirait-il ce que je m'apprête à publier ? (identifiants uniques, structure, validation de chaque entrée, comptes)
    let relu;
    try { relu = F.deserialiser(await F.decompresser(gz)); } catch (e) { throw echec(`aller-retour : le consommateur refuse l'archive (${e && e.motif ? e.motif : (e && e.name) || 'erreur'}) : aucun fichier écrit`); }
    const rj = await rejugerEntreesParPaquets(relu);
    if (!rj.ok) throw echec(`aller-retour : ${rj.refusees} entrée(s) rejetée(s) par la validation d'entrée (${Object.entries(rj.motifs).map(([m, n]) => `${m} : ${n}`).join(' ; ')}) : aucun fichier écrit`);
    if (relu.comptes.visuels !== r.comptes.visuels || relu.comptes.fichesLiees !== r.comptes.fichesLiees) throw echec('aller-retour : les comptes relus diffèrent des comptes calculés : aucun fichier écrit');
    if (!relu.colonneJumeaux || relu.comptes.jumeaux !== r.version.comptes.jumeaux) throw echec('aller-retour : la colonne des jumeaux relue diffère de celle calculée : aucun fichier écrit');
    if (!relu.colonneMarquages || JSON.stringify(relu.comptes.marquees) !== JSON.stringify(r.version.comptes.marquees)) throw echec('aller-retour : la colonne des marquages relue diffère de celle calculée : aucun fichier écrit');
    // MARQUE-EMPRUNT : la colonne des emprunts relue est celle qui a été calculée (la route ne saurait pas, sinon, quel visuel est emprunté)
    if (!r.version.colonneEmprunts) throw echec('MARQUE-EMPRUNT : la version calculée n\'a pas la colonne des emprunts (les règles d\'image ne sauraient pas qu\'un visuel est emprunté) : aucun fichier écrit');
    if (!relu.colonneEmprunts || relu.comptes.emprunts !== r.version.comptes.emprunts) throw echec('aller-retour : la colonne des emprunts relue diffère de celle calculée : aucun fichier écrit');
    // ARCHIVE-4 : la colonne des marqueurs écrits relue est celle qui a été calculée (la route ne saurait pas, sinon, ce que le catalogue a écrit)
    if (!r.version.colonneEcrits) throw echec('ARCHIVE-4 : la version calculée n\'a pas la colonne des marqueurs écrits (le service ne verrait pas les marqueurs du catalogue) : aucun fichier écrit');
    if (!relu.colonneEcrits || JSON.stringify(relu.comptes.ecrits) !== JSON.stringify(r.version.comptes.ecrits)) throw echec('aller-retour : la colonne des marqueurs écrits relue diffère de celle calculée : aucun fichier écrit');
    // JUMBO-VISUEL : la colonne des masqués relue est celle qui a été calculée (sans elle, un JUMBO différent retrouverait le scan de la carte normale)
    if (!r.version.colonneMasques) throw echec('JUMBO-VISUEL : la version calculée n\'a pas la colonne des masqués (un JUMBO différent retrouverait le scan de la carte normale) : aucun fichier écrit');
    if (!relu.colonneMasques || relu.comptes.masques !== r.version.comptes.masques) throw echec('aller-retour : la colonne des masqués relue diffère de celle calculée : aucun fichier écrit');
    // ARCHIVE-EXCLUSIONS : les compteurs relus sont ceux qui ont été calculés (et sans liste, aucun compteur d'exclusion n'a le droit d'exister)
    if (relu.comptes.exclus !== (exclusions ? r.comptes.exclus : undefined) || JSON.stringify(relu.comptes.exclusParMotif) !== JSON.stringify(exclusions ? r.comptes.exclusParMotif : undefined) || relu.comptes.partagesPerdus !== (exclusions ? 0 : undefined)) throw echec('aller-retour : les compteurs d\'exclusion relus diffèrent de ceux calculés : aucun fichier écrit');
    return { brut, gz, scelle: secret ? sceller(gz, secret) : null, comptes: r.comptes, comptesSource, entree, dureeMs: Date.now() - t0 };
}
module.exports = { fabriquerFichier };
