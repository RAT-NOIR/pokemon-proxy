// ============================================================
// BASSE DÉFINITION — la marque, et le remplacement automatique (décision du testeur, 2026-10-12)
// ============================================================
// « Seuil des sources OFFICIELLES (TPC Asie, pokemon-card.com) : 257 px. Chaque image sous 350 px reçoit une marque basseDefinition: true, que le
// site lira pour ne jamais l'agrandir au-delà de sa taille réelle. Une meilleure image de même impression la remplace automatiquement dès qu'une
// source la fournit. Le seuil de 350 px des autres sources ne change pas. »
//
// UNE règle, appelée par tous les collecteurs (§21 bis) :
//   · LA MARQUE (`marqueDe`) : d'après la largeur de l'ORIGINAL (seuils-images.js `estBasseDefinition`) — jamais un nombre recopié ici.
//     C'est l'original qui borne l'agrandissement : le fichier servi (WebP, 700 px au plus) n'est jamais agrandi à l'encodage, donc pour une image
//     sous 350 px, `w` (servi) = largeur de l'original ; le site ne doit pas la montrer plus large que `w`.
//   · LE REMPLACEMENT (`entreesARemplacer`, `remplacerBasseDefinition`) : une candidate NON marquée prend la place d'une entrée marquée de
//     `cartes.images` quand elles désignent la MÊME impression (même set, même numéro — `cleNumero`, la clé de la jointure) ET la MÊME langue.
//     Écrite par ce qu'elle AUTORISE : les deux langues doivent être CONNUES (non null) et égales ; la candidate ne doit être ni marquée ni
//     d'une largeur d'original basse ; l'entrée remplacée doit porter la marque. Tout le reste ne bouge pas. JAMAIS L'INVERSE : une image de
//     basse définition ne remplace jamais une image sans la marque.
//   · LA TRAÇABILITÉ : le document `images` de l'entrée remplacée RESTE (il n'est pas supprimé) ; son `etat` passe à `remplace`, avec
//     `remplacePar` (source, cleR2 de la remplaçante) et `remplaceLe`.
//
// Qui l'appelle : collecteur-images.js (artofpkm), collecteur-images-bulba.js, collecteur-images-tcgdex.js — les jointures qui posent une entrée
// NON marquée — ET, depuis le 2026-10-17 (BASSE-DEF, voir plus bas), les collecteurs TPC, PikaQian, pokemontcg.io, Pokumon et pokemon.com : ils comblaient
// les visuels MANQUANTS (`dejaServi`) et comptaient une entrée marquée comme « servie » ; elle est désormais remplaçable par leur image non marquée.
const { estBasseDefinition, largeurOriginaleDe } = require('./seuils-images');
const { cleNumero } = require('./jointure');

/** La marque d'un document `images` (ou d'une entrée) d'après la largeur de l'original : `{ basseDefinition: true }` ou `{}`. */
function marqueDe(doc) {
    // la marque DÉJÀ posée sur le document (collecteur, ou rattrapage `poser-basse-definition.js`) est reprise telle quelle : l'entrée d'une jointure
    // rejouée (pull + push d'une entrée neuve) la garde ; à défaut, d'après la largeur de l'original
    if (doc?.basseDefinition === true) return { basseDefinition: true };
    return estBasseDefinition(largeurOriginaleDe(doc)) ? { basseDefinition: true } : {};
}

// ➕ 2026-10-17, DOCTRINE DE COLLECTE du testeur (article 4) : « un remplacement est permis si l'image actuelle est fausse, en basse définition ou empruntée, ou si la nouvelle est la même impression
// et nettement plus grande. Une image correcte au-dessus du seuil n'est jamais remplacée par une image équivalente. Cela s'applique à toutes les sources. »
// « Nettement » = au moins RATIO_NETTEMENT_PLUS_GRANDE fois la largeur de l'ORIGINAL de l'image actuelle (400 → 600 admis, 400 → 599 refusé). Une largeur inconnue ne prouve rien : rien ne sort.
const RATIO_NETTEMENT_PLUS_GRANDE = 1.5;
// « fausse » : une entrée de la table fermée de corrections (`corrections-images.js`, clés `source|cleR2`) — jamais déduite.
const { IMAGES_DECLAREES_FAUSSES } = require('./corrections-images');
const FAUSSES = new Set(IMAGES_DECLAREES_FAUSSES);

// ➕ Correction 3 — « MÊME IMPRESSION » ne se réduit pas à (set, numéro, langue) : une variante tamponnée / non séparée / à note de variante est une AUTRE impression, et « une réimpression tamponnée ne reçoit
// JAMAIS l'image d'une autre impression ». Le remplacement « nettement plus grande » n'est donc permis que si les DEUX côtés portent EXACTEMENT les mêmes marqueurs (absents des deux côtés compris) ;
// un marqueur de faux type (null, false, chaîne vide, liste vide) vaut absent. Liste FERMÉE des marqueurs que les collecteurs écrivent sur une entrée : une variante qu'on ne sait pas nommer ne s'y
// trouve pas — un collecteur qui ajoute un marqueur de variante à ses entrées doit l'ajouter ICI.
const MARQUEURS_DE_VARIANTE = Object.freeze(['noteVariante', 'tamponNonRepresente', 'imageEmprunteeTirage', 'partageeHoloNonHolo', 'partageeTamponNonSepare', 'produitsPartages']);
const marqueurDe = (x, k) => { const v = x?.[k]; return v === undefined || v === null || v === false || v === '' || (Array.isArray(v) && !v.length) ? null : JSON.stringify(v); };
const memeVarianteHors = (a, b, exclus = []) => MARQUEURS_DE_VARIANTE.every(k => exclus.includes(k) || marqueurDe(a, k) === marqueurDe(b, k));
const memeVariante = (a, b) => memeVarianteHors(a, b);

// ➕ Correction 4 — LE TAMPON D'UNE ENTRÉE EMPRUNTÉE. Une entrée `imageEmprunteeTirage` montre l'image d'un AUTRE tirage (un scan simple sous une réimpression tamponnée) ; `tamponNonRepresente` dit le tampon
// qu'elle NE montre PAS (« Staff », « Play! Pokémon »). Elle n'est remplacée que par le VRAI scan tamponné : la candidate doit porter un marqueur POSITIF de tampon, égal à ce libellé. Une image simple
// non tamponnée ne la remplace JAMAIS (elle serait aussi fausse, et le marquage s'effacerait).
// MESURÉ (2026-10-17) : AUCUN collecteur n'écrit un champ positif de tampon sur ses entrées — Pokumon garde le tampon sur le DOCUMENT (`marque`, texte libre), `partageeHoloNonHolo` n'est pas un tampon,
// `noteVariante` (pokemontcg.io) note une variante non séparée, pas un tampon. La liste est donc VIDE et AUCUN remplacement d'une entrée empruntée ne sort, tant qu'un collecteur n'écrit pas ce champ
// (et ne l'ajoute pas ici). Écrit par ce qu'il autorise : liste vide = rien n'est autorisé.
const CHAMPS_TAMPON_POSITIFS = Object.freeze([]);
const tamponPositifEgal = (e, c, champs) => typeof e?.tamponNonRepresente === 'string' && e.tamponNonRepresente !== '' && champs.some(k => c?.[k] === e.tamponNonRepresente);

// Largeur de la candidate. SANS `wOriginal` (une entrée de jointure dont le document n'avait pas la largeur de l'original) : repli sur `w`, la largeur SERVIE (≤ 700), qui SOUS-ESTIME l'original.
// C'est volontaire et prudent : une largeur sous-estimée ne fait jamais remplacer de trop (le ratio n'est atteint qu'avec plus de pixels). Ce n'est pas « l'original des deux côtés » — on ne le prétend pas.
const largeurDeCandidate = c => {
    const w = typeof c?.wOriginal === 'number' && c.wOriginal > 0 ? c.wOriginal : (typeof c?.w === 'number' && c.w > 0 ? c.w : null);
    return w;
};

/**
 * Les entrées de `images` (celles d'une carte) qu'une candidate non marquée remplace. Pure. Une entrée de MÊME impression (set, numéro, langue connue et égale) sort si elle est : de basse
 * définition (`basseDefinition`), empruntée à un autre tirage (`imageEmprunteeTirage`), déclarée fausse (table fermée), ou nettement plus petite que la candidate (RATIO_NETTEMENT_PLUS_GRANDE).
 * Tout le reste ne bouge pas — en particulier une image correcte au-dessus du seuil face à une équivalente.
 */
function entreesARemplacer(images, candidat, { fausses = FAUSSES, champsTampon = CHAMPS_TAMPON_POSITIFS } = {}) {
    if (!Array.isArray(images) || !candidat || typeof candidat !== 'object') return [];
    if (candidat.basseDefinition === true || estBasseDefinition(largeurOriginaleDe(candidat))) return [];      // une image basse ne remplace jamais
    if (typeof candidat.langue !== 'string' || !candidat.langue) return [];                                     // langue inconnue : on ne remplace pas
    const numero = cleNumero(candidat.numero);
    const wC = largeurDeCandidate(candidat);
    return images.filter(e => {
        if (!e || e.set !== candidat.set || cleNumero(e.numero) !== numero) return false;
        if (!(typeof e.langue === 'string' && e.langue === candidat.langue)) return false;
        if (e.source === candidat.source && e.cleR2 === candidat.cleR2) return false;
        // basse définition ou fausse : seulement à IMPRESSION identique (mêmes marqueurs de variante / de tampon des deux côtés) — une variante tamponnée n'est pas évincée par l'image d'une autre impression
        if (e.basseDefinition === true || fausses.has(`${e.source}|${e.cleR2}`)) return memeVariante(e, candidat);
        // empruntée : seulement par le VRAI scan tamponné (marqueur positif égal), les autres marqueurs identiques
        if (e.imageEmprunteeTirage === true) return tamponPositifEgal(e, candidat, champsTampon) && memeVarianteHors(e, candidat, ['imageEmprunteeTirage', 'tamponNonRepresente']);
        const wE = largeurOriginaleDe(e);
        return wE != null && wC != null && wC >= RATIO_NETTEMENT_PLUS_GRANDE * wE && memeVariante(e, candidat);
    });
}

/**
 * Applique le remplacement pour UNE candidate sur UNE carte : retire de `cartes.images` les entrées que `entreesARemplacer` désigne (le `$pull` porte
 * (set, source, cleR2) : UNE entrée, jamais plus), et marque leurs documents `images` « remplace ». Rend le nombre d'entrées remplacées.
 * À appeler AVANT de poser la candidate. `M` : les modèles de la base `cartes` (Carte, Image).
 */
async function remplacerBasseDefinition(M, carteId, candidat, { maintenant = new Date() } = {}) {
    const c = await M.Carte.findById(carteId).select('images').lean();
    const aRemplacer = entreesARemplacer(c?.images, candidat);
    for (const e of aRemplacer) {
        await M.Carte.updateOne({ _id: carteId }, { $pull: { images: { set: e.set, source: e.source, cleR2: e.cleR2 } } });   // (set, source, cleR2) désigne UNE entrée
        await M.Image.updateOne({ source: e.source, set: e.set, cleR2: e.cleR2, etat: 'ok' }, { $set: { etat: 'remplace', remplacePar: { source: candidat.source, cleR2: candidat.cleR2 }, remplaceLe: maintenant } });
    }
    return aRemplacer.length;
}

// ============================================================
// ➕ 2026-10-17 (BASSE-DEF) — LE REMPLACEMENT PAR TOUS LES COLLECTEURS (décision du testeur : « une image basseDefinition est remplacée automatiquement dès qu'une source
// au-dessus du seuil existe pour ce produit, avec l'ancienne adresse gardée dans l'historique »).
// ============================================================
// Les collecteurs « combleurs » (TPC, PikaQian, pokemontcg.io, Pokumon, pokemon.com) s'arrêtaient à `dejaServi` : une entrée marquée comptait comme servie. Ils appellent désormais
// LES MÊMES fonctions que les trois jointures (artofpkm, Bulbapedia, TCGdex) — aucune copie de la règle (§21 bis) :
//   · AU PLAN (`sansRemplacables`) : une entrée marquée d'une AUTRE source, de même (set, numéro, langue connue), ne compte pas comme « servie » — la carte est un trou que la source
//     peut combler, À CONDITION que son image sorte non marquée (sinon, à la jointure, elle cède). Une entrée marquée de la MÊME source n'est jamais remplaçable : le même fichier
//     reviendrait, au même nombre de pixels. Langue inconnue du candidat : rien n'est remplaçable (une garde s'écrit par ce qu'elle autorise).
//   · À LA JOINTURE (`arbitrer`) : la décision d'une candidate — quelles entrées sortent (`entreesARemplacer`), la fiche reste-t-elle servie une fois celles-là sorties. Une candidate
//     marquée ne fait sortir personne et cède : une basse définition ne remplace JAMAIS une image non marquée, ni une autre basse définition.
//   · LE GESTE (`remplacerBasseDefinition`, ci-dessus) : l'entrée sort de `cartes.images`, le document `images` RESTE (`etat: 'remplace'`, `remplacePar`, `remplaceLe`) avec son
//     `urlOriginal`, sa `cleR2`, ses largeurs : c'est « l'ancienne adresse gardée dans l'historique ». Le collecteur note l'`empreinteEntree` de chaque entrée sortie pour sa garde
//     interne (les entrées des autres sources doivent rester les mêmes, moins celles-là) ; la garde de LOT voit un échange 1 pour 1 (images du set inchangées, vignette refaite).
/** La clé d'une entrée dans la garde interne des collecteurs (`compterEntrees`) : carte|source|set|numéro|cleR2. */
const empreinteEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;

/**
 * La carte telle que la voit le PLAN d'une source `source` qui écrira en `langue` au `numero` du `set` : sans les entrées marquées qu'une image non marquée de cette source
 * remplacerait. Rend une COPIE (la carte d'origine n'est pas modifiée). Pure.
 */
function sansRemplacables(carte, { set, numero, langue, source, wOriginal } = {}) {
    const images = Array.isArray(carte?.images) ? carte.images : [];
    // `wOriginal` : la largeur de l'image que la source donnera, quand le plan la connaît (l'index de Pokumon la porte) ; inconnue, la candidate est supposée non marquée
    const sortent = entreesARemplacer(images, { set, numero, langue, source, cleR2: null, wOriginal })
        .filter(e => e.source !== source);
    return { ...(carte || {}), images: images.filter(e => !sortent.includes(e)) };
}

/**
 * L'ARBITRAGE d'une candidate à la jointure. `autres` : les entrées de la carte qui ne sont pas les nôtres ; `candidat` : l'entrée qu'on va poser (set, source, cleR2, numero, langue,
 * marque / largeur) ; `servi(restantes)` : le prédicat « déjà servi » de CE collecteur sur les entrées qui resteraient. @returns {{sortantes: object[], servie: boolean}}
 * `servie` vrai : la candidate CÈDE (elle n'est pas posée, rien ne sort). Faux : le collecteur appelle `remplacerBasseDefinition` (s'il y a des sortantes) puis pose la candidate.
 */
function arbitrer(autres, candidat, servi) {
    const liste = Array.isArray(autres) ? autres : [];
    const sortantes = entreesARemplacer(liste, candidat);
    return { sortantes, servie: !!servi(liste.filter(e => !sortantes.includes(e))) };
}

module.exports = { marqueDe, entreesARemplacer, remplacerBasseDefinition, empreinteEntree, sansRemplacables, arbitrer, RATIO_NETTEMENT_PLUS_GRANDE, MARQUEURS_DE_VARIANTE, CHAMPS_TAMPON_POSITIFS };
