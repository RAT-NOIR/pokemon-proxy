'use strict';
// COTES-VISUELS — UNE SEULE décision du visuel et du lien fiche → produits, pour le chargeur de l'API ET pour l'exporteur (v2/migrations/exporter-visuels.js) : jamais deux copies (§21 bis).
// Pure : ne lit rien, n'écrit rien, ne connaît ni Mongo ni le réseau — elle reçoit des tableaux. La règle du site (`regle`) est injectée : EMBARQUÉE pour le chargeur
// (v2/chargeur/regle-site), importée du site pour l'outil de comparaison. Le CHOIX du visuel est celui de exporter-donnees-logos-site.js (`choisirVisuel`, partagé avec l'export des logos).
//   · politique v2 : un produit sans fiche du site est écarté ; un substitut sans mention reste sans mention (la validation d'entrée le refusera, rien n'est inventé).
//   · le LIEN : set (slug) → clé de fiche `idInterne|numero` (collectionContrat.ts : cleFiche) → idProducts, avec `fichesDesProduits` du site (produitsDeLaFiche, fichesDuDocument).
// Rend la main à la boucle d'événements entre deux sets (l'API sert pendant le chargement) : async.
const L = () => require('../../exporter-donnees-logos-site');      // paresseux : ce module charge dotenv à l'import
const REGLE_REQUISE = ['fichesDuDocument', 'setParImpression', 'impressionDuSet', 'produitsDeLaFiche', 'visuelAdmisPourLaRegion', 'normaliserNumero', 'cardmarketUrl'];

const { lienServi } = require('../identifier/lien-cardmarket');       // LIEN-CARDMARKET : la garde unique, partagée avec la relecture (visuels.js) et le Produit
const { separeeParVariante } = require('../identifier/partage-variante');   // PARTAGES-VARIANTE : la forme « paire séparée par la variante », UNE définition (décision, validation d'entrée, structure, F1)
const entier = x => Number.isInteger(x) && x > 0;
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const fichierDe = (cle, w, h) => (typeof cle === 'string' && cle ? { cle, w, h } : null);
const ceder = () => new Promise(r => setImmediate(r));
/** Ce qui définit un set pour ses impressions (lib/impressionDuSet.ts : CibleDuSet) : le tirage, les expansions Bulbapedia et, quand le set en porte un, le deck. */
const cibleDuSet = s => ({ tirage: s.tirage ?? s.region, expansions: [].concat(s.bulba?.expansion ?? []), deck: s.deck });
/** La clé stable d'une fiche, comme lib/collectionContrat.ts::cleFiche (« - » pour une fiche sans numéro). */
const cleFiche = (idInterne, numero) => `${idInterne}|${numero ?? '-'}`;

// ── REPLI-REIMPRESSIONS (étape 6 du testeur) : « une réimpression 30th, comme une tamponnée, ne reçoit JAMAIS l'image d'une autre impression ».
// Une liste FERMÉE de familles, écrite par ce qu'elle AUTORISE (des slugSet énumérés, jamais un motif qui attraperait ce qu'on n'a pas lu). Pour un produit de ces familles, un visuel d'un AUTRE tirage
// (`autre-tirage`, ou un `substitut` dont le set n'est pas celui du produit) n'est PAS servi : AUCUNE ENTRÉE. Pas d'entrée « sans visuel » : le format et la validation d'entrée exigent une vignette,
// et tous les lecteurs (resoudre, impressions) la supposent ; l'honnêteté tient dans l'absence (un visuel absent est honnête, celui d'un autre tirage ne l'est pas — CLAUDE.md).
// Le filtre vient APRÈS choisirVisuel (la fonction PARTAGÉE avec l'export du site, non touchée).
// PREUVES (catalogue, relevées le 2026-10-17 : sets.json de `cartes`, slugSet = _id du set ; chiffres dans le rapport du lot) :
//   30th Celebration : les 8 sets dont le slugSet commence par « 30th- » (codes 30C, m6a, 30thC, MA6, mF, 30thDC, 30th-P, x30C) — « toutes les langues » ;
//   Prize Packs : « Play-Pokemon-Prize-Pack-Series-One » à « -Nine » (codes PPS1 à PPS9) ;
//   WCD : les 20 sets « WCD-aaaa » du catalogue (2004 à 2019, 2022 à 2025 ; WCD20 et WCD21 n'existent pas) ;
//   tamponnées nommées : les sets que la décision du testeur (2026-10-17, avis du catalogue) nomme « tamponnées sans source » dont l'image n'est que celle du tirage normal : Battle Academy 2020/2022/2024
//   et Trick or Trade 2024 (les autres Trick or Trade ne sont PAS nommés, ils ne sont pas dans la liste).
const FAMILLES_SANS_REPLI = Object.freeze({
    '30th-celebration': Object.freeze(['30th-Celebration', '30th-Celebration-JP', '30th-Celebration-Simplified-Chinese', '30th-Celebration-IDTH', '30th-Celebration-Premium-Deck-Set',
        '30th-Celebration-Simplified-Chinese-Premium-Deck-Set', '30th-Anniversary-Celebration-Simplified-Chinese', '30th-Celebration-Additionals']),
    'prize-packs': Object.freeze(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'].map(n => `Play-Pokemon-Prize-Pack-Series-${n}`)),
    wcd: Object.freeze([2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025].map(a => `WCD-${a}`)),
    'tamponnees-nommees': Object.freeze(['Battle-Academy-2020', 'Battle-Academy-2022', 'Battle-Academy-2024', 'Trick-or-Trade-2024'])
});
// Une tamponnée reconnue à son NOM Cardmarket (le slug en porte le jeton) : « Staff », « Prerelease ». Les slugs relevés : 4 « League-Staff », 0 « Prerelease » (la preuve est dans le rapport).
const JETON_TAMPON_NOM = /(^|-)(Staff|Prerelease|Pre-Release)(-|$)/i;
// Les familles qui RESSEMBLENT à une liste sans y figurer (un 31e set 30th, un WCD-2026, une Prize Pack Series Ten) : elles ne sont pas refusées (la liste est fermée), elles sont SIGNALÉES (d.familleHorsListe).
const RESSEMBLANCES = Object.freeze([/^30th-/, /^WCD-\d{4}$/, /^Play-Pokemon-Prize-Pack-Series-/]);
const NOMS_REFUS = Object.freeze([...Object.keys(FAMILLES_SANS_REPLI), 'staff-prerelease', 'image-empruntee']);
// LOT TAMPONS : la variante d'une ligne est un jeton de la liste FERMÉE du catalogue (identifier/marques-tampon.js : une marque, un ensemble de marques joint par « + », jumbo, normale), avec sa
// `variantePreuve`. La forme ancienne `staff-prerelease` se lit `staff+prerelease`. Une valeur hors de la liste est null ET comptée (varianteHorsListe) : jamais devinée, jamais perdue en silence.
const MT = require('../identifier/marques-tampon');
// basseDefinition (original sous 350 px) : le coordinateur MESURE puis tranche. false = les entrées sont GARDÉES (et portent le champ) ; true = une entrée basseDefinition n'est pas servie à l'identification
// (compteur d.basseDefinitionExclue). Le site, lui, continue d'afficher ces images ; le choix ne concerne que l'archive.
const EXCLURE_BASSE_DEFINITION = false;
const familleDuSet = id => { for (const [nom, liste] of Object.entries(FAMILLES_SANS_REPLI)) if (liste.includes(id)) return nom; return null; };
/**
 * MARQUE-EMPRUNT — le visuel choisi est-il EMPRUNTÉ à un autre tirage ? C'est la décision de `choisirVisuel` (`visuel`), jamais le texte de la mention : 'autre-tirage', ou un substitut dont le set n'est
 * pas celui du produit (même prédicat que `refusDeRepli`, qui juge le même fait pour les familles fermées). Un substitut dont le set est inconnu compte comme emprunté (dans le doute, la règle se tait).
 */
function estEmprunt({ im, set, visuel }) {
    return visuel === 'autre-tirage' || (visuel === 'substitut' && (!im || !im.set || !set || im.set !== set._id));
}
/**
 * Le visuel choisi doit-il être REFUSÉ ? @returns le nom du compteur (famille, 'staff-prerelease' ou 'image-empruntee'), ou null.
 *  · une image marquée imageEmprunteeTirage (l'image du tirage normal, pour l'AFFICHAGE seulement) n'est JAMAIS servie, famille ou non, du set ou non ;
 *  · un visuel d'un AUTRE tirage (autre-tirage, ou substitut dont le set n'est pas celui du produit) n'est pas servi aux familles ci-dessus ni aux produits dont le nom Cardmarket nomme un tampon.
 */
function refusDeRepli({ ligne, set, im, visuel }) {
    if (im && im.imageEmprunteeTirage === true) return 'image-empruntee';
    const autre = visuel === 'autre-tirage' || (visuel === 'substitut' && (!im || im.set !== set._id));
    if (!autre) return null;
    const f = familleDuSet(set._id);
    if (f) return f;
    return JETON_TAMPON_NOM.test(String(ligne.slug ?? '')) ? 'staff-prerelease' : null;
}
// ADMISSION-CATALOGUE (testeur, 2026-10-27) — deux entrées du catalogue que le repli ci-dessus refusait, admises par une règle FERMÉE, écrite par ce qu'elle AUTORISE :
//   (A) Battle Academy : le slug Cardmarket porte la POSITION du deck (« Potion-V2-BA20C37 », « Picnicker-BA24A34 »), le scan `prv` porte la position LUE sur l'image (numero « C37 » : silhouette + rond).
//       Deux sources indépendantes : le scan du set (source prv, preuveLue.regle, admis par la règle du site, jamais imageEmprunteeTirage) n'est servi qu'au produit dont le slug nomme SA position,
//       et seulement s'il est seul à cette position et le produit seul à la porter. Dans le même geste, un scan de position choisi pour un AUTRE produit (choisirVisuel donne le seul visuel du set
//       à tout produit sans numéro) est retiré : compté `positionContredite`.
//   (B) WCD : l'emprunt du catalogue (source « emprunt », imageEmprunteeTirage, differenceEmprunt « autre-tirage », lot des origines prouvées par deux sources) au numéro de la fiche est servi
//       pour l'AFFICHAGE, en « autre-tirage » avec sa mention : estEmprunt le marque, les règles d'image ne le lisent pas (identifier/emprunt.js).
const ANNEE_BA = /^Battle-Academy-20(\d{2})$/;
const POSITION_BA = /-BA(\d{2})([A-Z]{1,3}\d{0,3})$/;
const POSITION_LUE = /^[A-Z]{1,3}\d{0,3}$/;
const MENTION_WCD = 'Visuel de la même carte dans un autre tirage (carte d\'origine du deck) — pas le scan de ce produit';
/** La position du deck nommée par le slug, si l'année du slug est celle du set Battle Academy ; sinon null. */
function positionDuSlug(slug, setId) {
    const a = ANNEE_BA.exec(String(setId ?? '')), m = POSITION_BA.exec(String(slug ?? ''));
    return a && m && m[1] === a[1] ? m[2] : null;
}
const estScanDePosition = (im, setId) => Boolean(im && im.source === 'prv' && ANNEE_BA.test(String(setId ?? '')) && typeof im.numero === 'string' && POSITION_LUE.test(im.numero));
/** @returns { im, visuel, mention, nature } | null — `positions` : Map « carteId|set|position » → nombre de produits qui la portent. */
function admissionDuCatalogue({ ligne, set, carte, regle, positions }) {
    const f = familleDuSet(set._id), tir = set.tirage ?? set.region;
    const images = (carte.images || []).filter(m => m && m.set === set._id && m.cleR2);
    if (f === 'tamponnees-nommees') {
        const pos = positionDuSlug(ligne.slug, set._id);
        if (!pos || positions.get(`${ligne.carteId}|${set._id}|${pos}`) !== 1) return null;
        const c = images.filter(m => m.source === 'prv' && texte(m.preuveLueRegle) && m.imageEmprunteeTirage !== true && m.numero === pos && regle.visuelAdmisPourLaRegion(m, tir));
        return c.length === 1 ? { im: c[0], visuel: 'du-set', mention: null, nature: 'prv-position' } : null;
    }
    if (f === 'wcd') {
        // désignée : au numéro de la fiche ; ou, fiche SANS numéro (les WCD de Cardmarket n'en portent pas), la SEULE entrée de la carte dans le set, elle-même sans numéro (l'image d'origine est la même
        // pour toutes les variantes V1…Vn d'un deck : affichage seulement, marquée empruntée)
        const voulu = ligne.numeroFiche == null ? null : regle.normaliserNumero(ligne.numeroFiche);
        const c = images.filter(m => m.source === 'emprunt' && m.imageEmprunteeTirage === true && m.differenceEmprunt === 'autre-tirage' && !(tir !== 'jp' && m.langue === 'ja')
            && (voulu === null ? m.numero == null : m.numero != null && regle.normaliserNumero(m.numero) === voulu));
        const seule = voulu === null ? images.length === 1 : true;
        return c.length === 1 && seule ? { im: c[0], visuel: 'autre-tirage', mention: MENTION_WCD, nature: 'wcd-emprunt' } : null;
    }
    return null;
}
/**
 * basseDefinition à TROIS valeurs (la règle d'image exige `=== false`, défaut fermé : un `null` la fait taire) : le drapeau du catalogue s'il est booléen ; sinon la largeur de l'ORIGINAL (`im.w`, la même que
 * celle de la grande image) comparée au seuil de collecte (collecte-cartes/seuils-images.js::LARGEUR_MIN) — true dessous, false au seuil ou au-dessus ; null SEULEMENT quand la largeur est inconnue.
 */
function basseDefinitionDe(im) {
    if (typeof im.basseDefinition === 'boolean') return im.basseDefinition;
    if (Number.isInteger(im.w) && im.w > 0) return im.w < require('../../collecte-cartes/seuils-images').LARGEUR_MIN;
    return null;
}
/**
 * Les marquages d'un visuel pour UN produit : ceux de l'image servie, seulement si le produit figure dans sa liste de produits partagés, OU si l'image est servie à une paire SÉPARÉE PAR LA VARIANTE
 * (PARTAGES-VARIANTE : false, aucune liste, `variante` prouvée du produit servi — partage-variante.js) ; la basse définition suit l'image.
 */
function marquagesDe(im, idProduct, variante = null) {
    const liste = Array.isArray(im.produitsPartages) && im.produitsPartages.includes(idProduct);
    const paire = separeeParVariante(im, variante);
    const concerne = liste || paire;
    const bool = x => (typeof x === 'boolean' ? x : null);
    return { partageeHoloNonHolo: concerne ? bool(im.partageeHoloNonHolo) : null, partageeTamponNonSepare: concerne ? bool(im.partageeTamponNonSepare) : null,
        produitsPartages: liste ? [...im.produitsPartages] : null, tamponNonRepresente: concerne ? texte(im.tamponNonRepresente) : null, basseDefinition: basseDefinitionDe(im) };
}

/**
 * m2 : l'image porte un marquage de partage (ou une liste) qui ne tient pas pour CE produit : fail-closed. `variante` : la variante PROUVÉE du produit servi (varianteProuvee), ou null.
 * La seule exception à « un marquage de partage exige une liste qui contient le produit » : la paire séparée par la variante (false, aucune liste, staff|jumbo|normale prouvée).
 */
function partageIncoherent(im, idProduct, variante = null) {
    const partage = im.partageeHoloNonHolo === true || typeof im.partageeTamponNonSepare === 'boolean';
    const liste = Array.isArray(im.produitsPartages);
    if (!partage && !liste) return false;
    if (separeeParVariante(im, variante)) return false;
    return !(partage && liste && im.produitsPartages.includes(idProduct));
}
/** La variante d'une ligne SI elle a sa preuve, sans compter (varianteAvecPreuve compte, et ne passe qu'une fois par produit servi). */
const varianteProuvee = l => { const v = MT.normaliserVariante(l.variante); return v !== null && texte(l.variantePreuve) ? v : null; };
/** Une variante PRÉSENTE qui n'est pas dans la liste fermée (ni sa forme ancienne) : une valeur inconnue, à compter. */
const varianteHorsListe = l => l.variante !== undefined && l.variante !== null && MT.normaliserVariante(l.variante) === null;
/** m3 : la variante (une marque, un ensemble, jumbo, normale) n'est portée QUE si la ligne a sa preuve (variantePreuve non vide) ; sinon null, compté. Hors liste : null, comptée à part. */
function varianteAvecPreuve(l, d) {
    if (l.variante === undefined || l.variante === null) return null;
    const v = MT.normaliserVariante(l.variante);
    if (v === null) { d.varianteHorsListe = (d.varianteHorsListe || 0) + 1; return null; }
    if (!texte(l.variantePreuve)) { d.varianteSansPreuve++; return null; }
    return v;
}

function verifierRegle(regle) {
    for (const k of REGLE_REQUISE) if (!regle || typeof regle[k] !== 'function') throw new Error(`règle du site absente : ${k} — la décision s'arrête (jamais un repli)`);
}

/**
 * @param sets      documents `sets` (_id, idExpansion, nomAffichage, tirage, region, code, bulba.expansion, deck)
 * @param docs      documents `cartes` (_id, nomEn, sets, impressions, images)
 * @param lignes    documents `cartes_produits` (carteId, idProduct, idExpansion, numeroFiche, slug, slugSet, visuelSubstitut)
 * @param metacarte Map idProduct → idMetacard (le catalogue : sa taille est le dénominateur du catalogue)
 * @param regle     la règle du site (sept fonctions, dont impressionDuSet) ; @param journal fonction(texte)
 * @returns {Promise<{ entrees: object[], denominateurs: object, liens: Map<string, Map<string, number[]>> }>} — n'écrit rien nulle part.
 */
async function decider({ sets, docs, lignes, metacarte, regle, journal = () => { }, cederLaMain = true, sink = null, exclureBasseDefinition = EXCLURE_BASSE_DEFINITION }) {
    // `sink` { entree(e), lien(setId, cle, idProducts) } : les résultats sortent UN À UN (le chargeur les range en colonnes sans jamais tenir le tableau des entrées ni la Map des liens) ;
    // sans sink, ils sont rendus en tableau et en Map (les bancs, l'exporteur de comparaison).
    verifierRegle(regle);
    const Lg = L();
    if (!sets.length) throw new Error('aucun document dans `sets` : base fausse (un vide parfait n\'est pas « zéro visuel »)');
    if (!docs.length) throw new Error('aucun document dans `cartes` : base fausse');
    if (!lignes.length) throw new Error('aucune ligne dans `cartes_produits` : base fausse');
    if (!(metacarte instanceof Map) || !metacarte.size) throw new Error('catalogue_produits vide : base fausse');
    const pause = cederLaMain ? ceder : async () => { };
    const setsBase = new Map(sets.map(s => [s._id, s]));
    const carteDe = new Map(docs.map(d => [d._id, d]));
    // un substitut (cartes_produits.visuelSubstitut) nomme son fichier mais ne porte pas de vignette (mesuré : 3 219 sur 3 219) : la vignette est celle
    // de l'entrée cartes.images qui porte CE MÊME fichier (même cleR2 = même objet R2) ; aucune entrée ne le porte → pas de vignette, jamais devinée
    const vignetteDuFichier = new Map();
    for (const d of docs) for (const m of d.images || []) if (m?.cleR2 && m.vignette?.cleR2 && !vignetteDuFichier.has(m.cleR2)) vignetteDuFichier.set(m.cleR2, m.vignette);
    const parSet = new Map();
    for (const d of docs) for (const s of d.sets || []) { if (!parSet.has(s)) parSet.set(s, []); parSet.get(s).push(d); }

    // les candidats de chaque ligne : les sets dont elle porte le slugSet ou l'expansion (comme exporter-donnees-logos-site.js)
    const parExp = new Map(), parSlugSet = new Map();
    const exps = s => [].concat(s.idExpansion ?? []);
    for (const s of sets) for (const e of exps(s)) { if (!parExp.has(e)) parExp.set(e, []); parExp.get(e).push(s); }
    for (const s of sets) parSlugSet.set(s._id, s);
    const candidats = l => { const u = new Map(); for (const s of parExp.get(l.idExpansion) || []) u.set(s._id, s); if (l.slugSet && parSlugSet.has(l.slugSet)) u.set(l.slugSet, parSlugSet.get(l.slugSet)); return [...u.values()]; };

    // la fiche du site de chaque produit, set par set : sur TOUS les documents du set (la fiche par impression se décide sur le set entier)
    const lignesParSet = new Map();
    for (const l of lignes) for (const s of candidats(l)) { if (!lignesParSet.has(s._id)) lignesParSet.set(s._id, []); lignesParSet.get(s._id).push(l); }
    const fiches = new Map(), liens = new Map(), compte = { sets: 0, fiches: 0, produits: 0 };
    let n = 0;
    for (const [id, ls] of lignesParSet) {
        const s = setsBase.get(id), cible = cibleDuSet(s);
        // LA règle du site : les impressions de CE set (tirage, expansion, deck). fichesDesProduits (exporter-donnees-logos-site.js, hors v2/, non touché) filtre encore par tirage et expansion ;
        // elle reçoit ici des documents dont les impressions sont DÉJÀ celles du set, son filtre ne retire plus rien de plus.
        const membres = (parSet.get(id) || []).filter(d => typeof d.nomEn === 'string' && d.nomEn !== '')
            .map(d => ({ ...d, impressions: (d.impressions || []).filter(i => i && regle.impressionDuSet(i, cible)) }));
        const ids = new Set(membres.map(d => d._id));
        const fiche = Lg.fichesDesProduits(regle, s, membres, ls.filter(l => ids.has(l.carteId) && exps(s).includes(l.idExpansion))).fiche;
        fiches.set(id, fiche);
        const parCle = new Map();                                             // clé de fiche → idProducts (triés : une sortie stable)
        for (const [idProduct, f] of fiche) { const cle = cleFiche(f.carteId, f.numero); if (!parCle.has(cle)) parCle.set(cle, []); parCle.get(cle).push(idProduct); }
        for (const v of parCle.values()) v.sort((a, b) => a - b);
        if (parCle.size) {
            compte.sets++; compte.fiches += parCle.size;
            for (const v of parCle.values()) compte.produits += v.length;
            if (sink) { for (const [cle, ids] of parCle) sink.lien(id, cle, ids); } else liens.set(id, parCle);
        }
        if (++n % 20 === 0) await pause();
    }
    journal(`sets : ${sets.length} · cartes : ${docs.length} · cartes_produits : ${lignes.length} · catalogue : ${metacarte.size} · sets à fiches : ${compte.sets}`);
    const choisir = l => {
        const cs = candidats(l).map(s => ({ s, f: fiches.get(s._id)?.get(l.idProduct) }));
        const avec = cs.filter(x => x.f && x.f.carteId === l.carteId);
        return { ...(avec[0] || cs.find(x => exps(x.s).includes(l.idExpansion)) || cs[0] || {}), plusieurs: cs.length > 1 };
    };

    const d = { catalogue: metacarte.size, avecLigne: lignes.length, sansLigne: 0, duSet: 0, substitut: 0, autreTirage: 0, aucun: 0,
        aucunDetail: { 'carte absente': 0, 'aucun set candidat': 0, 'aucun visuel': 0 }, ecrites: 0, sansFicheDuSite: 0, rareteContredite: 0, idMetacardAbsent: 0, plusieursSets: 0,
        setsAvecLiens: compte.sets, fichesLiees: compte.fiches, produitsLies: compte.produits,
        // REPLI-REIMPRESSIONS : les produits dont le visuel d'un autre tirage (ou emprunté) n'est PAS servi, par famille — somme à part : avecLigne = ecrites + aucun + sansFicheDuSite + repliRefuse.total (+ doublons de lignes)
        basseDefinitionExclue: 0, partageIncoherent: 0, varianteSansPreuve: 0, varianteHorsListe: 0,
        repliRefuse: { total: 0, parFamille: Object.fromEntries(NOMS_REFUS.map(n => [n, 0])) },
        // les sets qui RESSEMBLENT à une famille sans figurer dans sa liste fermée : servis comme avant, mais nommés (une liste fermée qui vieillit ne doit pas vieillir en silence)
        familleHorsListe: sets.map(s => s._id).filter(id => RESSEMBLANCES.some(re => re.test(id)) && familleDuSet(id) === null).sort(),
        // les marquages portés par les entrées écrites
        marquees: { partages: 0, holo: 0, tampon: 0, basse: 0 }, melangeProduits: 0,
        // MARQUE-EMPRUNT : les produits distincts dont l'entrée écrite porte un visuel emprunté (sommes par nature : les lignes d'un même produit ne comptent qu'une fois)
        emprunts: 0, empruntsParNature: { 'autre-tirage': 0, substitut: 0 },
        // ADMISSION-CATALOGUE : les entrées admises par la règle fermée (à part du repli refusé), et les scans de position retirés d'un autre produit (somme : avecLigne compte aussi positionContredite)
        admisCatalogue: { 'prv-position': 0, 'wcd-emprunt': 0 }, positionContredite: 0 };
    const empruntes = new Set();
    const positions = new Map();
    for (const l of lignes) { const p = positionDuSlug(l.slug, l.slugSet); if (p) { const k = `${l.carteId}|${l.slugSet}|${p}`; positions.set(k, (positions.get(k) || 0) + 1); } }
    const vus = new Set(lignes.map(l => l.idProduct));
    for (const id of metacarte.keys()) if (!vus.has(id)) d.sansLigne++;
    vus.clear();
    const entrees = [];
    // JUMEAU-V2 : le créneau (expansion, numéro de fiche) et la langue de tirage de CHAQUE produit du catalogue, avec sa métacarte — le producteur de la colonne que la route lit pour ne jamais
    // affirmer un produit qui a un jumeau. Émis AVANT les écartements ci-dessous (un produit sans visuel ou sans fiche du site a quand même des jumeaux). Un produit du catalogue sans ligne :
    // créneau et langue INCONNUS (jamais devinés) ; un champ inconnu reste un jumeau côté route. Sans `sink`, la liste est rendue (les bancs).
    const jumeaux = [], emis = new Set(), melanges = new Set();
    const emettre = j => { if (sink) { if (typeof sink.jumeau === 'function') sink.jumeau(j); } else jumeaux.push(j); };
    const metaDe = id => (entier(metacarte.get(id)) ? metacarte.get(id) : null);
    n = 0;
    for (const l of lignes) {
        if (++n % 2000 === 0) await pause();
        const { s, f, plusieurs } = choisir(l), c = carteDe.get(l.carteId);
        emis.add(l.idProduct);
        // LOT TAMPONS (B, tour 1) : le prix de la fiche mélange-t-il la version normale et une version tamponnée ? Vient de la LIGNE (cartes_produits), === true seulement, et se pose pour CHAQUE ligne marquée,
        // ICI, avant tout écartement : la marque ne dépend d'AUCUN visuel (un produit sans entrée d'archive la porte aussi). Dénominateur : d.melangeProduits (les distincts de cartes_produits).
        if (l.prixMelangeTampon === true && entier(l.idProduct)) { melanges.add(l.idProduct); if (sink) { if (typeof sink.melange === 'function') sink.melange(l.idProduct); } }
        emettre({ idProduct: l.idProduct, idMetacard: metaDe(l.idProduct), idExpansion: entier(l.idExpansion) ? l.idExpansion : null,
            numero: l.numeroFiche == null ? null : texte(regle.normaliserNumero(l.numeroFiche)), tirage: s ? texte(s.tirage ?? s.region) : null });
        if (plusieurs) d.plusieursSets++;
        if (!c) { d.aucun++; d.aucunDetail['carte absente']++; continue; }
        if (!s) { d.aucun++; d.aucunDetail['aucun set candidat']++; continue; }
        const cibleS = cibleDuSet(s);
        // LE choix du visuel : la fonction des logos (un seul exemplaire). Politiques : un produit sans fiche du site est écarté, comme chez les logos
        // (le site ne le montre sur aucune fiche : aucun visuel « du set » à lui désigner) ; un substitut sans mention reste sans mention et
        // la validation d'entrée le refuse (elle exige une mention non vide), alors que les logos posent un repli.
        const choix = Lg.choisirVisuel({ ligne: l, carte: c, set: s, fiche: f, regle, setsBase, substitutSansMention: 'refus' });
        if (choix.sansFiche) { d.sansFicheDuSite++; continue; }
        let { im, visuel, mention } = choix;
        // ADMISSION-CATALOGUE (A) : un scan de position n'appartient qu'au produit dont le slug nomme cette position
        let contredit = false;
        if (visuel === 'du-set' && estScanDePosition(im, s._id) && positionDuSlug(l.slug, s._id) !== im.numero) { im = null; contredit = true; }
        // REPLI-REIMPRESSIONS : APRÈS le choix (la fonction partagée n'est pas touchée), AVANT toute entrée : jamais l'image d'un autre tirage à une réimpression
        let refus = im ? refusDeRepli({ ligne: l, set: s, im, visuel }) : null;
        if (!im || refus) {
            const a = admissionDuCatalogue({ ligne: l, set: s, carte: c, regle, positions });
            if (a) { ({ im, visuel, mention } = a); refus = null; contredit = false; d.admisCatalogue[a.nature]++; }
        }
        if (contredit) { d.positionContredite++; continue; }
        if (!im) { d.aucun++; d.aucunDetail['aucun visuel']++; continue; }
        if (refus) { d.repliRefuse.total++; d.repliRefuse.parFamille[refus]++; continue; }
        if (exclureBasseDefinition === true && im.basseDefinition === true) { d.basseDefinitionExclue++; continue; }
        // m2 (relecture r1) : une image marquée partagée dont le produit n'est PAS dans sa liste (ou dont la liste n'a pas de marquage) n'est pas servie à l'identification : fermé par défaut, compté
        if (partageIncoherent(im, l.idProduct, varianteProuvee(l))) { d.partageIncoherent++; if (varianteHorsListe(l)) d.varianteHorsListe++; continue; }
        if (visuel === 'du-set') d.duSet++; else if (visuel === 'substitut') d.substitut++; else d.autreTirage++;

        // rareté et total : les impressions de la carte, dans le tirage et l'expansion du set, AU numéro de la fiche
        const cle = x => regle.normaliserNumero(x) ?? '';
        const voulu = l.numeroFiche == null ? '' : cle(l.numeroFiche);
        const au = voulu ? (c.impressions || []).filter(i => i && regle.impressionDuSet(i, cibleS) && cle(i.numero) === voulu) : [];
        const valeur = champ => { const vs = [...new Set(au.map(i => texte(i[champ])).filter(Boolean))]; return vs.length === 1 ? vs[0] : null; };
        const distincts = champ => new Set(au.map(i => texte(i[champ])).filter(Boolean)).size;
        const rarete = valeur('rarete'), total = valeur('total');
        if (distincts('rarete') > 1 || distincts('total') > 1) d.rareteContredite++;
        const numero = l.numeroFiche == null ? null : String(l.numeroFiche);
        const idMetacard = entier(metacarte.get(l.idProduct)) ? metacarte.get(l.idProduct) : null;
        if (idMetacard === null) d.idMetacardAbsent++;
        const e = { idProduct: l.idProduct, visuel, mention, idMetacard, numero, rarete, total, variante: varianteAvecPreuve(l, d), setNom: texte(s.nomAffichage),
            // LIEN-CARDMARKET : numéro connu + slug et slugSet (cardmarketUrl les exige) + la MÊME garde que la relecture ; la rareté n'est plus exigée
            lien: entier(l.idProduct) ? lienServi(regle.cardmarketUrl({ slug: l.slug, slugSet: l.slugSet }), numero) : null,
            grande: entier(im.w) && entier(im.h) ? fichierDe(im.cleR2, im.w, im.h) : null };
        Object.assign(e, marquagesDe(im, l.idProduct, e.variante));
        const vs = im.vignette ?? vignetteDuFichier.get(im.cleR2);
        const v = vs && fichierDe(vs.cleR2, vs.w, vs.h);
        if (v) e.vignette = v;
        if (e.produitsPartages) d.marquees.partages++;
        if (e.partageeHoloNonHolo === true) d.marquees.holo++;
        if (e.partageeTamponNonSepare !== null) d.marquees.tampon++;
        if (e.basseDefinition === true) d.marquees.basse++;
        // MARQUE-EMPRUNT : posée AVEC l'entrée (le sink la range si l'entrée est admise) ; la nature vient de la décision, pas de la mention
        if (estEmprunt({ im, set: s, visuel })) {
            if (!empruntes.has(l.idProduct)) { empruntes.add(l.idProduct); d.emprunts++; d.empruntsParNature[visuel]++; }
            if (sink && typeof sink.emprunt === 'function') sink.emprunt(l.idProduct);
        }
        if (sink) sink.entree(e); else entrees.push(e);
        d.ecrites++;
    }
    for (const id of metacarte.keys()) if (!emis.has(id)) emettre({ idProduct: id, idMetacard: metaDe(id), idExpansion: null, numero: null, tirage: null });
    entrees.sort((a, b) => a.idProduct - b.idProduct);
    d.melangeProduits = melanges.size;
    return { entrees, denominateurs: d, liens, ...(sink ? {} : { jumeaux, melanges: [...melanges].sort((a, b) => a - b), emprunts: [...empruntes].sort((a, b) => a - b) }) };
}

module.exports = { decider, verifierRegle, cleFiche, REGLE_REQUISE, FAMILLES_SANS_REPLI, refusDeRepli, estEmprunt, positionDuSlug, admissionDuCatalogue, EXCLURE_BASSE_DEFINITION, partageIncoherent, varianteAvecPreuve };
