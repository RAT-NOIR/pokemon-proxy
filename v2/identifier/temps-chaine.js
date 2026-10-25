'use strict';
// LOT TEMPS-CHAINE — les changements de TEMPS de la chaîne d'identification (critère du lancement : p95 < 5 s pour une photo, 0 faux, sans perte de justesse).
// Décomposition mesurée (journal rm_essai, 326 scans) : l'appel au modèle ~3 s au p50, le reste du gestionnaire ~0,6 s, mais la QUEUE vient d'ailleurs :
//   · 9 scans sur 326 passent ~10 s dans le catalogue — la recherche « n° N dans tout le catalogue » relit TOUT numeros_cartes (≈ 70 000 documents) à chaque appel ;
//   · 4 scans passent ~6 s à télécharger la photo pour un départage par l'image dont le résultat est ensuite JETÉ (le symbole ou l'attaque a déjà décidé) ;
//   · 7 scans passent 9 à 18 s dans l'appel au fournisseur (incident de fournisseur : hors de portée d'ici).
// Ce module ne porte QUE de la logique pure ; les trois points d'appel sont dans index.js (une ligne chacun).
//
// RÈGLE DES RÉGLAGES : écrits par ce qu'ils AUTORISENT. Seule la valeur « 1 » allume ; tout le reste (absent, « true », « oui ») laisse la chaîne telle qu'elle était.
// Le pré-filtre du numéro n'a PAS de réglage : il rend exactement les mêmes produits (preuve : v2/test/test-temps-chaine.js, fuzz + mongod en mémoire).

const FILTRE_PARTOUT_ORIGINE = Object.freeze({
    $or: [{ numero: { $type: 'string', $ne: '' } }, { numeroUrl: { $type: 'string', $ne: '' } }]
});

// Le MOTIF (chaîne, syntaxe commune à JavaScript et à PCRE de MongoDB) qui retient tout candidat que comparerNumeros (scoring.js) pourrait retenir.
// comparerNumeros retient un candidat quand (a) numeroComplet est égal — donc le PREMIER groupe de chiffres vaut le même entier — ou (b) chiffresDuNumero est égal — le PREMIER groupe,
// encore. Dans les deux cas : le premier groupe de chiffres du candidat, zéros de tête compris, vaut le premier groupe du numéro lu. Le motif ne dit que cela :
//   ^[^0-9]*   tout ce qui précède le premier chiffre (préfixe de lettres, espace, tiret…)
//   0*N        des zéros, puis les chiffres du numéro lu sans zéro de tête
//   (?![0-9])  et le groupe finit là (« 17 » n'est pas « 7 »)
// null = pas de pré-filtre : aucun chiffre (l'égalité de TEXTE reste possible entre deux numéros sans chiffre), ou plus de 15 chiffres (parseInt n'est plus exact).
function motifNumeroPartout(numeroLu) {
    if (numeroLu === null || numeroLu === undefined) return null;
    const m = String(numeroLu).match(/\d+/);
    if (!m || m[0].length > 15) return null;
    const n = String(parseInt(m[0], 10));
    return `^[^0-9]*0*${n}(?![0-9])`;
}

// Le filtre Mongo de « tout le catalogue au numéro N ». Il CONSERVE la condition d'origine (une chaîne non vide quelque part) et y ajoute le motif sur l'un OU l'autre champ ;
// un champ qui n'est pas une chaîne (ancienne écriture en nombre) reste retenu : le tri exact, après coup, est toujours celui de la production (comparerNumeros).
function filtreNumeroPartout(numeroLu) {
    const motif = motifNumeroPartout(numeroLu);
    if (motif === null) return FILTRE_PARTOUT_ORIGINE;
    const horsChaine = ['double', 'int', 'long', 'decimal', 'array', 'object', 'bool'];
    return {
        $and: [
            FILTRE_PARTOUT_ORIGINE,
            { $or: [{ numero: { $regex: motif } }, { numeroUrl: { $regex: motif } }, { numero: { $type: horsChaine } }, { numeroUrl: { $type: horsChaine } }] }
        ]
    };
}

// Les champs de l'avis d'image quand on NE l'a PAS demandé : le symbole ou l'attaque a déjà décidé, l'avis de l'image était jeté (index.js : « abstention-…-prioritaire »).
// Même forme que departager() ; rien n'est inventé (aucun gagnant, aucun inlier), la durée est 0, et le motif DIT que ce n'est pas calculé.
const CAUSES_PRIORITAIRES = Object.freeze(['symbole', 'attaque']);
function champsImageNonCalcules(cause) {
    if (!CAUSES_PRIORITAIRES.includes(cause)) throw new Error(`champsImageNonCalcules : cause inconnue « ${cause} »`);
    return {
        imageStatut: `abstention-${cause}-prioritaire`,
        imageMotif: `non calculée : le ${cause} a décidé, l'avis de l'image n'aurait rien changé (V2_TC_IMAGE_PRIORITAIRE)`,
        imageGagnant: null,
        imageInliers: null,
        imageInliersSecond: null,
        imageRangDuGagnantScoring: null,
        imageCandidatsAvecVecteur: null,
        imageCandidatsGroupe: null,
        imagePoints: require('../../departage-image').N_POINTS,
        imageMs: 0
    };
}

// Le prompt ALLÉGÉ — 🔴 REJETÉ PAR LA MESURE (30 photos locales, 150 appels, 0,47 $) et NON BRANCHÉ dans index.js ; gardé ici pour que mesurer-temps-ia.js rejoue la mesure.
// Il retire les deux champs que RIEN ne lit (« illustrateur », « illustrateurConfiance » : « LECTURE SEULE », journalisés et c'est tout — index.js) et leur paragraphe, et demande le JSON
// sur UNE ligne. Ce qu'il a rendu : −16 % de jetons de sortie (170 → 142), −0,2 s au plus en médiane appariée (bruit v0/v0b : −0,06 s), MAIS le code du set lu 6/15 contre 8/15 (trois
// setCode devenus null : MA, TM, e1), 9/30 lectures identiques à v0 sur les champs de la chaîne contre 22/30 pour v0 contre lui-même. Il lit plus mal un champ décisif : rejeté.
// Une marque absente = le texte est rendu tel quel, jamais déformé.
const MARQUES = {
    gabarit: /"illustrateur": "[^"]*", "illustrateurConfiance": "[^"]*", /,
    paragraphe: /L'ILLUSTRATEUR — [\s\S]*?Ce champ ne sert à AUCUNE décision aujourd'hui : il est seulement enregistré\.\n\n/,
    consigne: 'Réponds UNIQUEMENT en JSON strict, sans texte ni markdown autour, format exact :'
};
const CONSIGNE_UNE_LIGNE = 'Réponds UNIQUEMENT en JSON strict sur UNE SEULE LIGNE (aucun retour à la ligne, aucune indentation), sans texte ni markdown autour, format exact :';
function allegerPrompt(prompt) {
    let p = String(prompt);
    if (!MARQUES.gabarit.test(p) || !MARQUES.paragraphe.test(p)) return String(prompt);     // les deux marques ou aucune : on ne déforme pas à moitié
    p = p.replace(MARQUES.gabarit, '').replace(MARQUES.paragraphe, '');
    if (p.includes(MARQUES.consigne)) p = p.replace(MARQUES.consigne, CONSIGNE_UNE_LIGNE);
    return p;
}

// Les réglages, lus dans l'environnement (jamais dans cfg : index.js est la chaîne héritée et ne reçoit pas cfg). Seule la valeur « 1 » allume.
function reglages(env = process.env) {
    return { imagePrioritaireSansCalcul: env.V2_TC_IMAGE_PRIORITAIRE === '1', secondeParallele: env.V2_TC_SECONDE_PARALLELE === '1' };
}

module.exports = { FILTRE_PARTOUT_ORIGINE, motifNumeroPartout, filtreNumeroPartout, champsImageNonCalcules, allegerPrompt, reglages };
