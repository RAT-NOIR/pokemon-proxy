'use strict';
// ============================================================
// LES DÉFINITIONS DE L'AUDIT — pures (aucune base, aucun fichier), chacune écrite par ce qu'elle AUTORISE
// ============================================================
// Brief S8/AUDIT (testeur, 2026-10-24). Ce module ne lit rien : il reçoit ce que l'API a décidé (`decider`, `lireEntree`) et ce que la règle du
// site a attribué (`fichesDesProduits`), et il classe. Il ne recopie AUCUNE règle de ces deux chaînes : il en lit les SORTIES.

const MOTIF_EMPRUNT_REFUSE = 'emprunt-refuse-par-api';
const FAMILLES_EMPRUNT_REFUSE = Object.freeze(['wcd', 'prize-packs', 'tamponnees-nommees', '30th-celebration']);   // celles de FAMILLES_SANS_REPLI (decision.js) que l'audit a rencontrées
const MOTIF_FINITION_OU_TAMPON = 'finition-ou-tampon-non-verifie';

// ── VISUEL : la classe PRINCIPALE suit l'ordre MANQUANT > EMPRUNTÉ > BASSE DÉFINITION > (à comparer). La comparaison à la copie locale
// Cardmarket s'affiche à côté, jamais à la place : un produit EMPRUNTÉ ou en basse définition est AUSSI comparé.
/**
 * @param {{ servi: null | { visuel: string, basseDefinition?: boolean|null, imageEmprunteeTirage?: boolean|null }, motifManquant?: string }} e
 *   `servi` : l'entrée que l'API construirait pour le produit (decider PUIS lireEntree ok), ou null.
 * @returns {{ classe: 'MANQUANT'|'EMPRUNTE'|'BASSE_DEFINITION'|'A_COMPARER', motifs: string[] }}
 */
function classerVisuel({ servi, motifManquant, refuse } = {}) {
    // SECOND PASSAGE : un visuel EMPRUNTÉ que l'API refuse de servir (repli-réimpressions) reste MANQUANT — c'est ce que l'API sert — mais porte le sous-motif `emprunt-refuse-par-api`,
    // compté à part (4 familles : FAMILLES_EMPRUNT_REFUSE). `refuse` : { famille, nature } (nature : substitut, autre-tirage ou image-empruntee-tirage).
    if (!servi) return { classe: 'MANQUANT', motifs: refuse ? [motifManquant || 'inconnu', MOTIF_EMPRUNT_REFUSE] : [motifManquant || 'inconnu'], ...(refuse ? { refuse } : {}) };
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

// ── SECOND PASSAGE (seuils.md, coordinateur, 24/10, après lecture des 200 paires de `calibration-200.json`, qui en est la RÉFÉRENCE) :
//   CONFORME d < 0,55 · INCERTAIN 0,55 ≤ d < 0,65 (une planche pour le testeur) · PROBABLEMENT FAUX d ≥ 0,65 · INVÉRIFIABLE : pas de copie, format, aplat.
// ⚠️ CONFORME dit « même ILLUSTRATION », pas « même impression » : l'empreinte ne voit ni la finition (holo, reverse, cosmos) ni un tampon hors de la fenêtre centrale (voir finitionOuTampon).
const SEUILS = Object.freeze({ conforme: 0.55, incertain: 0.65 });

// LE FORMAT : des cartes que l'empreinte du centre ne juge pas (une moitié de carte, un morceau de V-UNION, une carte surdimensionnée). Lu dans le NOM Cardmarket, quelle que soit la distance.
// Casse respectée : Cardmarket écrit ces marques en capitales ; « Tea Break », « Break Ground » ou « Legend Ceremony » sont des ATTAQUES (mesuré : 221 « break » sur 310 ne sont que dans des crochets).
const FORMAT = /\b(?:LEGEND|BREAK|V-UNION)\b|Oversized/;
const formatConcerne = nom => FORMAT.test(String(nom || ''));

function verifierSeuils(s) {
    if (!s || !Number.isFinite(s.conforme) || !Number.isFinite(s.incertain) || s.conforme >= s.incertain)
        throw new Error('seuils absents ou incohérents (conforme doit être < incertain) — ils sont fixés par le coordinateur sur la planche');
}

/**
 * La classe de COMPARAISON d'une paire (à côté de la classe principale du visuel). Le format passe avant tout, y compris avant l'absence de copie.
 * @returns {{ classe: 'CONFORME'|'INCERTAIN'|'PROBABLEMENT_FAUX'|'INVERIFIABLE', motif: string|null }}
 */
function classerComparaison({ comparaison, distance, nom, seuils = SEUILS }) {
    verifierSeuils(seuils);
    if (formatConcerne(nom)) return { classe: 'INVERIFIABLE', motif: 'format' };
    if (!comparaison?.comparable || !Number.isFinite(distance)) return { classe: 'INVERIFIABLE', motif: comparaison?.motif || 'distance-non-finie' };
    if (distance < seuils.conforme) return { classe: 'CONFORME', motif: null };
    if (distance < seuils.incertain) return { classe: 'INCERTAIN', motif: null };
    return { classe: 'PROBABLEMENT_FAUX', motif: null };
}

/**
 * La classe finale du visuel : MANQUANT, EMPRUNTÉ et BASSE DÉFINITION gardent leur nom (la comparaison s'affiche à côté) ; un « à comparer » prend la classe de sa comparaison.
 * @returns {'MANQUANT'|'EMPRUNTE'|'BASSE_DEFINITION'|'CONFORME'|'INCERTAIN'|'PROBABLEMENT_FAUX'|'INVERIFIABLE'}
 */
function classerFinal({ classe, comparaison, distance, nom, seuils = SEUILS }) {
    verifierSeuils(seuils);
    if (classe !== 'A_COMPARER') return classe;
    return classerComparaison({ comparaison, distance, nom, seuils }).classe;
}

/**
 * Ce que l'empreinte NE VOIT PAS : la finition et le tampon. Lu dans ce qu'on a déjà — le nom Cardmarket (HORS crochets : dedans ce sont des attaques), la tamponnée du set,
 * `variante`, `tamponNonRepresente`, `partageeHoloNonHolo`. Pas de détecteur de tampon sur l'image dans ce passage. `tamponProbable` est INJECTÉ (c'est celui de
 * exporter-donnees-logos-site.js ; ce module ne lit rien).
 * @returns {{ concerne: boolean, raisons: string[] }}
 */
const FINITION = /\b(?:Non-Holo|Holo|Reverse|Cosmos|Pattern|Version)\b/i;
function finitionOuTampon({ nom, slug, variante, tamponNonRepresente, partageeHoloNonHolo, setTamponnee, tamponProbable }) {
    if (typeof tamponProbable !== 'function') throw new Error('finitionOuTampon : tamponProbable (le prédicat de exporter-donnees-logos-site.js) est requis');
    const horsCrochets = String(nom || '').replace(/\[[^\]]*\]/g, ' ');
    const raisons = [];
    if (FINITION.test(horsCrochets)) raisons.push('nom-finition');
    if (tamponProbable(horsCrochets, slug)) raisons.push('nom-tampon');
    if (setTamponnee) raisons.push('set-tamponnee');
    if (typeof variante === 'string' && variante.trim() && variante.trim() !== 'normale') raisons.push('variante');
    if (typeof tamponNonRepresente === 'string' && tamponNonRepresente.trim()) raisons.push('tampon-non-represente');
    if (partageeHoloNonHolo === true) raisons.push('holo-partage');
    return { concerne: raisons.length > 0, raisons };
}

// ── FICHE
// Preuve FAIBLE = le nom est la seule donnée de la clé (§48 : une clé par le nom seule laisse ~0,28 % de fiches fausses, et 82 faux sur les compilations de
// réimpressions). Énumérée, jamais un motif : `set+nom+attaques`, `metacarte+nom+attaques`, `nom+tcgdex+base`… portent un second témoin et n'y sont PAS.
const PREUVES_NOM_SEUL = Object.freeze(['set+nom', 'setlist+nom']);
const MOTIFS_FICHE = Object.freeze(['plusieurs-cartes', 'preuve-nom-seul', 'sans-numero', 'contredite-par-le-nom']);

/**
 * @param {{ lignes: Array<{carteId:number, preuve?:string}>, ficheSite: null | {carteId:number, numero:string|null}, temoinContredit?: boolean, setANumeros?: boolean }} e
 *   `lignes` : les lignes cartes_produits du produit ; `ficheSite` : la fiche que la règle du site lui attribue (fichesDesProduits), ou null ;
 *   `temoinContredit` : temoinDuNom (jointure.js) désigne une AUTRE carte du set pour le nom du produit ; `setANumeros` : le set a au moins une fiche numérotée.
 * @returns {{ classe: 'SANS_LIGNE'|'LIGNE_SANS_FICHE'|'FICHE_DOUTEUSE'|'FICHE_OK', motifs: string[] }}
 */
function classerFiche({ lignes, ficheSite, temoinContredit = false, setANumeros = false, numeroConnu = false, confirmation = null }) {
    if (!lignes || !lignes.length) return { classe: 'SANS_LIGNE', motifs: [], infos: [] };
    const plusieurs = new Set(lignes.map(l => l.carteId)).size > 1;
    // un produit joint à deux cartes n'a aucune fiche chez le site (« un produit servi sur deux fiches n'en désigne aucune ») : sa classe est LIGNE_SANS_FICHE, le motif reste écrit
    if (!ficheSite) return { classe: 'LIGNE_SANS_FICHE', motifs: plusieurs ? ['plusieurs-cartes'] : [], infos: [] };
    const motifs = [];
    if (plusieurs) motifs.push('plusieurs-cartes');
    // le NOM SEUL se juge sur la carte de la fiche : une preuve par le numéro sur CETTE carte sauve la fiche. Une preuve absente est inconnue, pas faible.
    const duneFiche = lignes.filter(l => l.carteId === ficheSite.carteId);
    const preuves = duneFiche.map(l => l.preuve).filter(Boolean);
    // B1 (2026-10-26) : `confirmation` = { concorde } — le verdict de collecte-cartes/confirmation.js::confirmationConcorde sur la ligne de CETTE fiche, rejoué par l'appelant. Une confirmation par deux sources
    // lève le SEUL motif « preuve-nom-seul » (le nom seul est précisément ce qu'une seconde source indépendante vérifie) ; « plusieurs-cartes », « sans-numero » et « contredite-par-le-nom » restent (une
    // seconde source ne numérote pas la fiche du site et ne défait pas un produit joint à deux cartes). Une confirmation qui ne concorde plus (`concorde !== true`) est IGNORÉE et nommée dans `infos`.
    const infos = [];
    const nomSeul = preuves.length && preuves.every(p => PREUVES_NOM_SEUL.includes(p));
    const confirmee = confirmation !== null && confirmation !== undefined && confirmation.concorde === true;
    if (nomSeul && !confirmee) motifs.push('preuve-nom-seul');
    // `sans-numero` RESSERRÉE, décision du coordinateur après la relecture indépendante (M1) : la CONJONCTION « le set a au moins une fiche numérotée » ET « le numéro du produit est connu »
    // (numeros_cartes.numero, ou numeroFiche de la ligne). Sans la première moitié, ~1 216 fiches « n° ? » de sets sans aucune fiche numérotée (Gem Packs, Half Decks) entraient — exactement ce que
    // seuils.md voulait exclure. L'ANCIENNE définition (le set a des fiches numérotées, sans le numéro du produit) reste comptée à part, en INFORMATION : elle ne change ni la classe ni les motifs.
    const sansNumero = ficheSite.numero === null || ficheSite.numero === undefined;
    if (sansNumero && setANumeros === true && numeroConnu === true) motifs.push('sans-numero');
    if (temoinContredit) motifs.push('contredite-par-le-nom');
    if (sansNumero && setANumeros) infos.push('sans-numero-set-numerote');
    if (confirmee && nomSeul) { infos.push('confirmee-deux-sources'); if (confirmation.generique === true) infos.push('confirmee-generique'); }
    else if (confirmation !== null && confirmation !== undefined && !confirmee) infos.push('confirmation-ignoree');
    return { classe: motifs.length ? 'FICHE_DOUTEUSE' : 'FICHE_OK', motifs, infos };
}

// ── ENTRÉES D'UN MÊME PRODUIT (M4) : comme version.js:276-283 — UN produit, UNE entrée. Deux entrées VALIDES aux visuels identiques ⇒ une seule (la dernière, pour le reste) ; aux visuels
// DIFFÉRENTS ⇒ AUCUN visuel servi (« un visuel absent est honnête, celui d'un autre tirage ne l'est pas »). Le visuel = vignette, grande (clé, largeur, hauteur) : ce qui est AFFICHÉ.
const visuelDe = e => JSON.stringify([e.vignette?.cle ?? null, e.vignette?.w ?? null, e.vignette?.h ?? null, e.grande?.cle ?? null, e.grande?.w ?? null, e.grande?.h ?? null]);
/** @param {object[]} valides les entrées de `decider` que `lireEntree` a admises, pour UN produit. @returns {{ servi: object|null, contradictoire: boolean, doublons: number }} */
function departagerEntrees(valides) {
    if (!valides.length) return { servi: null, contradictoire: false, doublons: 0 };
    if (new Set(valides.map(visuelDe)).size > 1) return { servi: null, contradictoire: true, doublons: 0 };
    return { servi: valides[valides.length - 1], contradictoire: false, doublons: valides.length - 1 };
}

/**
 * Les motifs FINAUX d'un produit (une seule définition, testée) : les motifs de la classe, `format` DÈS QUE le nom correspond (L1 : y compris sur un MANQUANT, servi ou non), le motif de
 * comparaison d'un INVÉRIFIABLE, et `finition-ou-tampon-non-verifie` quand la comparaison est CONFORME et que la finition ou le tampon ne se lit pas.
 * @param {{ motifs: string[], nom: string, comparaison: null | {classe: string, motif: string|null}, classeVisuel: string, finition: null | {concerne: boolean, raisons: string[]} }} e
 * @returns {{ motifs: string[], finitionRaisons: string[] }}
 */
function motifsFinaux({ motifs, nom, comparaison, classeVisuel, finition }) {
    const m = [...motifs];
    if (formatConcerne(nom) && !m.includes('format')) m.push('format');
    if (classeVisuel === 'INVERIFIABLE' && comparaison?.motif && !m.includes(comparaison.motif)) m.push(comparaison.motif);
    const finitionRaisons = comparaison?.classe === 'CONFORME' && finition?.concerne ? finition.raisons : [];
    if (finitionRaisons.length) m.push(MOTIF_FINITION_OU_TAMPON);
    return { motifs: m, finitionRaisons };
}

module.exports = { classerVisuel, etatComparaison, classerComparaison, classerFinal, classerFiche, finitionOuTampon, formatConcerne, departagerEntrees, motifsFinaux, SEUILS, PREUVES_NOM_SEUL, MOTIFS_FICHE,
    MOTIF_EMPRUNT_REFUSE, FAMILLES_EMPRUNT_REFUSE, MOTIF_FINITION_OU_TAMPON };
