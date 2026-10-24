'use strict';
// ============================================================
// LES DÉFINITIONS DE L'AUDIT — pures (aucune base, aucun fichier), chacune écrite par ce qu'elle AUTORISE
// ============================================================
// Brief S8/AUDIT (testeur, 2026-10-24). Ce module ne lit rien : il reçoit ce que l'API a décidé (`decider`, `lireEntree`) et ce que la règle du
// site a attribué (`fichesDesProduits`), et il classe. Il ne recopie AUCUNE règle de ces deux chaînes : il en lit les SORTIES.

// ── VISUEL : la classe PRINCIPALE suit l'ordre MANQUANT > EMPRUNTÉ > BASSE DÉFINITION > (à comparer). La comparaison à la copie locale
// Cardmarket s'affiche à côté, jamais à la place : un produit EMPRUNTÉ ou en basse définition est AUSSI comparé.
/**
 * @param {{ servi: null | { visuel: string, basseDefinition?: boolean|null, imageEmprunteeTirage?: boolean|null }, motifManquant?: string }} e
 *   `servi` : l'entrée que l'API construirait pour le produit (decider PUIS lireEntree ok), ou null.
 * @returns {{ classe: 'MANQUANT'|'EMPRUNTE'|'BASSE_DEFINITION'|'A_COMPARER', motifs: string[] }}
 */
function classerVisuel({ servi, motifManquant } = {}) {
    if (!servi) return { classe: 'MANQUANT', motifs: [motifManquant || 'inconnu'] };
    const motifs = [];
    if (servi.visuel === 'substitut' || servi.visuel === 'autre-tirage') motifs.push(servi.visuel);
    // `=== true` seulement : un champ absent ou null n'est pas un oui (un journal a une histoire, §3)
    if (servi.imageEmprunteeTirage === true) motifs.push('image-empruntee-tirage');
    const basse = servi.basseDefinition === true;
    if (basse) motifs.push('basse-definition');
    const emprunte = motifs.some(m => m !== 'basse-definition');
    return { classe: emprunte ? 'EMPRUNTE' : basse ? 'BASSE_DEFINITION' : 'A_COMPARER', motifs };
}

// ── COMPARAISON : « comparable » seulement si TOUT est là. L'ordre des motifs est fixe (le premier qui manque le dit).
/** @returns {{ comparable: boolean, motif: string|null }} */
function etatComparaison({ copieLocale, placeholderCm, empreinteNous, empreinteCm, distance }) {
    if (!copieLocale) return { comparable: false, motif: 'pas-de-copie-locale' };
    if (placeholderCm) return { comparable: false, motif: 'copie-cardmarket-non-disponible' };
    if (!empreinteNous) return { comparable: false, motif: 'visuel-nous-illisible' };
    if (!empreinteCm) return { comparable: false, motif: 'empreinte-cardmarket-inexploitable' };
    if (!Number.isFinite(distance)) return { comparable: false, motif: 'distance-non-finie' };
    return { comparable: true, motif: null };
}

// ── DEUXIÈME PASSAGE : les seuils viennent du coordinateur (planche de calibration), jamais d'ici. Sans eux, ou incohérents : on LÈVE.
/**
 * @returns {'MANQUANT'|'EMPRUNTE'|'BASSE_DEFINITION'|'CONFORME'|'PROBABLEMENT_FAUX'|'INVERIFIABLE'}
 * Les trois classes principales gardent leur nom ; la zone ENTRE les deux seuils est INVÉRIFIABLE (l'empreinte ne conclut pas).
 */
function classerFinal({ classe, comparaison, distance, seuils }) {
    if (!seuils || !Number.isFinite(seuils.conforme) || !Number.isFinite(seuils.faux) || seuils.conforme >= seuils.faux)
        throw new Error('classerFinal : seuils absents ou incohérents (conforme doit être < faux) — les seuils sont fixés par le coordinateur sur la planche, jamais devinés');
    if (classe !== 'A_COMPARER') return classe;
    if (!comparaison?.comparable || !Number.isFinite(distance)) return 'INVERIFIABLE';
    if (distance <= seuils.conforme) return 'CONFORME';
    if (distance >= seuils.faux) return 'PROBABLEMENT_FAUX';
    return 'INVERIFIABLE';
}

// ── FICHE
// Preuve FAIBLE = le nom est la seule donnée de la clé (§48 : une clé par le nom seule laisse ~0,28 % de fiches fausses, et 82 faux sur les compilations de
// réimpressions). Énumérée, jamais un motif : `set+nom+attaques`, `metacarte+nom+attaques`, `nom+tcgdex+base`… portent un second témoin et n'y sont PAS.
const PREUVES_NOM_SEUL = Object.freeze(['set+nom', 'setlist+nom']);
const MOTIFS_FICHE = Object.freeze(['plusieurs-cartes', 'preuve-nom-seul', 'sans-numero-set-numerote', 'contredite-par-le-nom']);

/**
 * @param {{ lignes: Array<{carteId:number, preuve?:string}>, ficheSite: null | {carteId:number, numero:string|null}, temoinContredit?: boolean, setANumeros?: boolean }} e
 *   `lignes` : les lignes cartes_produits du produit ; `ficheSite` : la fiche que la règle du site lui attribue (fichesDesProduits), ou null ;
 *   `temoinContredit` : temoinDuNom (jointure.js) désigne une AUTRE carte du set pour le nom du produit ; `setANumeros` : le set a au moins une fiche numérotée.
 * @returns {{ classe: 'SANS_LIGNE'|'LIGNE_SANS_FICHE'|'FICHE_DOUTEUSE'|'FICHE_OK', motifs: string[] }}
 */
function classerFiche({ lignes, ficheSite, temoinContredit = false, setANumeros = false }) {
    if (!lignes || !lignes.length) return { classe: 'SANS_LIGNE', motifs: [] };
    const plusieurs = new Set(lignes.map(l => l.carteId)).size > 1;
    // un produit joint à deux cartes n'a aucune fiche chez le site (« un produit servi sur deux fiches n'en désigne aucune ») : sa classe est LIGNE_SANS_FICHE, le motif reste écrit
    if (!ficheSite) return { classe: 'LIGNE_SANS_FICHE', motifs: plusieurs ? ['plusieurs-cartes'] : [] };
    const motifs = [];
    if (plusieurs) motifs.push('plusieurs-cartes');
    // le NOM SEUL se juge sur la carte de la fiche : une preuve par le numéro sur CETTE carte sauve la fiche. Une preuve absente est inconnue, pas faible.
    const duneFiche = lignes.filter(l => l.carteId === ficheSite.carteId);
    const preuves = duneFiche.map(l => l.preuve).filter(Boolean);
    if (preuves.length && preuves.every(p => PREUVES_NOM_SEUL.includes(p))) motifs.push('preuve-nom-seul');
    if ((ficheSite.numero === null || ficheSite.numero === undefined) && setANumeros) motifs.push('sans-numero-set-numerote');
    if (temoinContredit) motifs.push('contredite-par-le-nom');
    return { classe: motifs.length ? 'FICHE_DOUTEUSE' : 'FICHE_OK', motifs };
}

module.exports = { classerVisuel, etatComparaison, classerFinal, classerFiche, PREUVES_NOM_SEUL, MOTIFS_FICHE };
