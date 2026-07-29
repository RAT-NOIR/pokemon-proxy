// ============================================================
// MODULE SCORING — départage plusieurs idProduct candidats
// ============================================================
// Combine des signaux (numéro, set, variante, image, prix, région) pour trouver
// LE bon idProduct parmi plusieurs cartes de même nom. Aucun critère ne décide
// seul : c'est le score total qui tranche, ce qui rend le système robuste aux
// erreurs individuelles (IA qui lit mal, hash d'image imprécis, etc.).
//
// Ce module est PUR (pas d'appels réseau) : on lui passe les candidats déjà
// enrichis, il calcule les scores. Testable isolément (bloc en bas).

// ---- Poids des critères (ajustables) ----
const POIDS = {
    numero: 50,    // fort : "184" == "184"
    set: 40,       // fort : bon set (Destined Rivals)
    setPartiel: 15,// faible : le code du candidat DÉRIVE de celui lu (sous-set, expansion
                   // compagnone). Volontairement très inférieur à `set` : "SV-P/CS" n'est
                   // pas "SV-P", et le critère doit rester capable de les distinguer.
    motif: 45,     // fort et SYMÉTRIQUE : le motif de reverse vient du catalogue TCGdex,
                   // qui fait autorité. Le bonus va au produit visé, le malus aux AUTRES
                   // impressions connues de la même carte (le « veto du catalogue »).
                   // 45 suffit : il faut renverser au pire 25 points d'écart de critère
                   // set, et 90 points de balancier rendent le classement décisif.
    variante: 35,  // départage V1/V2/V3 — OVERRIDE MANUEL UNIQUEMENT, plus rien ne le dérive
    image: 25,     // moyen : ressemblance visuelle (max si distance=0)
    prix: 25,      // moyen : prix cohérent avec la rareté lue
    region: 45,    // fort : la région (occidental/japonais) doit correspondre
    secret: 30     // départage secret rare (n° > total) vs numéro normal — robuste aux erreurs d'OCR sur le n°
};

const DISTANCE_IMAGE_MAX = 64; // hash 8x8 = 64 bits

// ============================================================
// Normalisation et comparaison des CODES DE SET
// ============================================================

/**
 * Normalise un code de set avant comparaison, en trois étapes :
 *   1. DÉCODAGE URL. Le codeSet est extrait d'une URL d'image Cardmarket
 *      (.../51/SV-P%2FCS/851878/851878.jpg) et a longtemps été stocké tel quel,
 *      donc encodé : "SV-P%2FCS" au lieu de "SV-P/CS". Sans décodage, l'étape 3
 *      laisse un "2F" parasite au milieu du code ("SVP2FCS") qui rend toute
 *      comparaison fausse. On décode ICI, à la lecture, pour que le scoring soit
 *      juste même sur les documents que nettoyer-codeset.js n'a pas encore
 *      nettoyés (1844 documents concernés, 14 codes distincts, %2F et %2B).
 *   2. Majuscules.
 *   3. Suppression de tout caractère non alphanumérique (tirets, slashs, points, +).
 */
function normaliserCodeSet(code) {
    if (!code) return null;
    let s = String(code);
    // decodeURIComponent lève une URIError sur une séquence malformée (ex: "100%") :
    // on retombe alors sur la chaîne brute plutôt que de faire échouer tout le scoring.
    if (s.includes('%')) { try { s = decodeURIComponent(s); } catch (_) { /* chaîne gardée telle quelle */ } }
    const norm = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return norm || null;
}

/**
 * Deux codes normalisés sont-ils APPARENTÉS (l'un dérive de l'autre) ?
 *   - sous-set        : lu "SV-P" (SVP) vs candidat "SV-P/CS" (SVPCS)  -> oui
 *   - expansion compagnone : lu "PRE" vs candidat "xPRE" (XPRE)        -> oui
 *   - sets distincts  : lu "PAL" vs candidat "PAF"                     -> NON
 *
 * On teste le préfixe en retirant un "X" initial d'UN SEUL côté à la fois : c'est
 * suffisant pour rapprocher "PRE" de "XPRE", et ça évite de retirer le X des deux
 * côtés (ce qui rapprocherait des codes sans rapport). Garde-fou supplémentaire :
 * on ne retire le X que s'il reste au moins 2 caractères, sinon un vrai code court
 * commençant par X (le set "XY" !) se réduirait à "Y" et matcherait n'importe quoi.
 *
 * ⚠️ Apparenté n'est JAMAIS égal : l'appelant doit accorder un bonus PARTIEL
 * (POIDS.setPartiel), jamais le bonus plein — sinon le critère ne discriminerait
 * plus un set de son sous-set, ce qui est exactement le bug qu'on corrige.
 */
// Longueur minimale de la partie commune pour qu'une parenté soit crédible.
// ⚠️ MESURÉ, pas choisi. Sur les 747 codes du catalogue, 822 paires décrochaient un
// bonus partiel ; 618 d'entre elles (75 %) ne partageaient que DEUX caractères, et
// toutes étaient fautives : "sv9a"~"SV", "DRI"~"DR", "FLF"~"FL", et surtout "mC"~"MCD"
// — c'est cette dernière qui a fait gagner un produit japonais sans rapport contre le
// McDonald's japonais à 1 034 €, en lui offrant un +15 imérité.
// À 3 caractères, tout ce qui est légitime survit : "PRE"~"xPRE", "DRI"~"xDRI",
// "SM-P"~"SM-P/CS", "MCD"~"MCDP", "MCD"~"MCD11".
const LONGUEUR_MIN_PARENTE = 3;

function codesApparentes(a, b) {
    if (!a || !b || a === b) return false;
    const sansX = s => (s.startsWith('X') && s.length >= 3) ? s.slice(1) : s;
    // Le plus COURT des deux doit être un préfixe du plus long, ET faire au moins
    // LONGUEUR_MIN_PARENTE caractères : sans ce plancher, n'importe quel code de deux
    // lettres est préfixe d'une multitude de codes plus longs, au hasard de l'alphabet.
    const prefixe = (x, y) => {
        if (!x || !y) return false;
        const [court, long] = x.length <= y.length ? [x, y] : [y, x];
        return court.length >= LONGUEUR_MIN_PARENTE && long.startsWith(court);
    };
    return prefixe(a, b) || prefixe(sansX(a), b) || prefixe(a, sansX(b));
}

// ============================================================
// MOTIFS DE REVERSE — l'autorité est le catalogue TCGdex, jamais une règle fixe
// ============================================================
// Aucune règle déduite du nom, du slug ou du numéro de variante Cardmarket ne peut
// fonctionner, c'est MESURÉ :
//   - le n° de variante V1/V2/V3 n'a pas de sémantique stable : la Poké Ball est V1
//     dans xPRE mais V1 = Friend Ball dans xASC ; et dans un set classique (OBF),
//     "V2" désigne un HOLO à 37 €, pas la reverse.
//   - le mécanisme lui-même change de set en set : dans Lost Origin et Prismatic
//     Evolutions la reverse partage l'idProduct de la normale (il faut un filtre
//     d'offres), alors que dans Ascended Heroes le reverse à symboles de type est un
//     produit distinct.
// En revanche `variants_detailed` (TCGdex) donne, pour chaque impression d'une carte,
// son motif ET l'idProduct Cardmarket correspondant. Couverture mesurée : 100 % des
// variantes sur les sets qui ont des motifs (Prismatic Evolutions, Black Bolt, White
// Flare, Ascended Heroes), le seul trou étant "S&V Energy". C'est donc la SOURCE, et
// les fonctions ci-dessous ne font que la lire.

// --- Vocabulaire des `foil` observé sur TCGdex (13 valeurs, relevé exhaustif) ---
// Famille "ball" : motifs de reverse CIBLABLES. Un vendeur les écrit dans son titre
// et l'IA peut voir qu'il y a des balls répétées sur le fond.
const FOILS_BALL = ['pokeball', 'friendball', 'loveball', 'quickball', 'team-rocket'];
// La Master Ball a sa propre classe : c'est l'aberration de prix (0,43 € -> 24 € sur
// la même carte) et elle est visuellement distinctive.
const FOIL_MASTERBALL = 'masterball';
// `energy` = le reverse traditionnel à symboles de type, quand Cardmarket en fait un
// produit distinct (Ascended Heroes). Ailleurs (Prismatic Evolutions), le même motif
// est porté par l'entrée `reverse` SANS foil. Les deux sont donc la même classe.
const FOIL_REVERSE_CLASSIQUE = 'energy';
// Finitions de TEXTURE, liées à la rareté (cartes gold/secrètes). Identifiables pour
// le VETO — ce sont des variantes connues de la carte, donc des produits à écarter
// quand on en vise un autre — mais JAMAIS ciblables : un vendeur ne les nomme pas et
// l'IA ne peut pas les distinguer de façon fiable.
const FOILS_TEXTURE = ['gold', 'cosmos', 'tinsel', 'cracked-ice', 'rainbow', 'league'];

// Les 4 classes de motif que l'IA peut affirmer (énumération GROSSIÈRE et volontaire :
// demander le nom exact du ball ne marche pas — l'identification visuelle du ball
// précis a échoué sur un cas réel, un Rayquaza Friend Ball lu "Poké Ball").
const MOTIFS_CIBLABLES = ['aucun', 'reverse-classique', 'ball', 'masterball'];

/**
 * Lit `variants_detailed` (TCGdex) et en tire tout ce qui sert au routage.
 * PURE : aucun réseau, aucune base. Tolère un tableau absent, vide ou malformé.
 *
 * @param {Array} variantsDetailed  tel que renvoyé par /v2/en/cards/{id}
 * @returns {{
 *   entrees: Array,                    // {type, foil, idProduct} normalisées
 *   parMotif: object,                  // classe de motif -> [idProduct] (routables)
 *   strategieParIdProduct: Map,        // idProduct -> 'filtre-url' | 'produit-distinct'
 *   tousIdProducts: Array,             // toutes les variantes connues de la carte
 *   aDesMotifsSpeciaux: boolean,       // la carte a-t-elle un motif ball/masterball ?
 *   motifsDisponibles: Array           // classes réellement routables
 * }}
 */
function analyserVariantes(variantsDetailed) {
    const entrees = [];
    if (Array.isArray(variantsDetailed)) {
        for (const v of variantsDetailed) {
            if (!v || typeof v !== 'object') continue;
            entrees.push({
                type: v.type ?? null,
                foil: v.foil ?? null,
                // L'idProduct est fourni PAR VARIANTE quand TCGdex a le prix Cardmarket
                // de cette impression. Absent sur les vieux sets (le prix n'existe qu'au
                // niveau carte) : la variante est alors connue mais NON ROUTABLE.
                idProduct: v.pricing?.cardmarket?.idProduct ?? null
            });
        }
    }

    // Un idProduct qui porte AUSSI une impression non-reverse sans foil (normal/holo)
    // est un produit PARTAGÉ : sa fiche Cardmarket affiche par défaut le prix de la
    // version non-reverse, et la reverse ne s'obtient qu'au filtre d'offres
    // (isReverseHolo=Y côté extension, champ trendHolo côté guide de prix).
    const idsNonReverse = new Set(
        entrees.filter(e => e.type !== 'reverse' && !e.foil && e.idProduct).map(e => e.idProduct)
    );

    const strategieParIdProduct = new Map();
    for (const e of entrees) {
        // La stratégie ne décrit QUE la façon de lire une reverse : on ne l'attribue
        // donc qu'aux entrées reverse, pour ne pas étiqueter à tort un produit normal.
        if (!e.idProduct || e.type !== 'reverse') continue;
        strategieParIdProduct.set(e.idProduct, idsNonReverse.has(e.idProduct) ? 'filtre-url' : 'produit-distinct');
    }

    const parMotif = { 'aucun': [], 'reverse-classique': [], 'ball': [], 'masterball': [] };
    for (const e of entrees) {
        if (!e.idProduct) continue;           // connue mais non routable
        if (e.type === 'reverse') {
            if (!e.foil || e.foil === FOIL_REVERSE_CLASSIQUE) parMotif['reverse-classique'].push(e.idProduct);
            else if (e.foil === FOIL_MASTERBALL) parMotif['masterball'].push(e.idProduct);
            else if (FOILS_BALL.includes(e.foil)) parMotif['ball'].push(e.idProduct);
            // foil de texture sur une reverse : ni ciblable, ni classée -> veto seulement
        } else if (!e.foil) {
            parMotif['aucun'].push(e.idProduct);
        }
    }

    // ⚠️ Calculé sur TOUTES les entrées, y compris celles SANS idProduct : c'est la
    // condition qui déclenche le repli (« la carte a un motif mais il n'est pas
    // résolvable »). La mesurer sur les seules entrées routables la rendrait toujours
    // fausse au moment où elle sert.
    const aDesMotifsSpeciaux = entrees.some(e =>
        e.type === 'reverse' && e.foil && (e.foil === FOIL_MASTERBALL || FOILS_BALL.includes(e.foil))
    );

    return {
        entrees,
        parMotif,
        strategieParIdProduct,
        tousIdProducts: [...new Set(entrees.map(e => e.idProduct).filter(Boolean))],
        aDesMotifsSpeciaux,
        // Sert au LOG de diagnostic : on n'y liste que les motifs de reverse, pas la
        // classe 'aucun' (qui décrit simplement l'existence du produit normal et
        // n'apprend rien sur les motifs disponibles).
        motifsDisponibles: MOTIFS_CIBLABLES.filter(m => m !== 'aucun' && parMotif[m].length > 0)
    };
}

/**
 * Prix de référence d'un produit.
 * @param {object} guide  un document de la collection guide_prix
 * @param {boolean} estReverse  l'impression VISÉE est-elle une reverse ?
 *
 * Le guide Cardmarket porte DEUX séries de prix par produit : `trend` (impression
 * normale) et `trendHolo` (impression reverse/holo). Le bon champ dépend UNIQUEMENT
 * de la nature de l'impression qu'on veut coter — PAS de la façon dont l'extension
 * ira la lire.
 *
 * ⚠️ NE PAS confondre avec la stratégie ('filtre-url' / 'produit-distinct'), qui dit
 * à l'extension COMMENT atteindre l'offre sur le site. Les avoir confondus produisait
 * exactement le bug d'origine, déplacé d'une branche à l'autre : les produits de motif
 * (Poké Ball, Master Ball, Friend Ball) sont des produits DISTINCTS, mais ils ne se
 * vendent QU'EN reverse holo — leur prix est donc dans les champs *Holo, comme pour
 * un produit partagé. Mesuré : Master Ball 806449 -> trend 0,50 € mais trendHolo
 * 24,13 € (relevé manuel 29,07 €). Lire `trend` sous-cotait d'un facteur 48.
 * Symétriquement, une impression NON reverse (motif "aucun") doit lire `trend` :
 * 805422 -> trend 0,17 € et non trendHolo 0,43 €, sinon on SURESTIME une carte banale
 * et on annonce une bonne affaire qui n'en est pas.
 */
function prixDeReference(guide, estReverse = false) {
    if (!guide) return null;
    // ⚠️ Un 0 n'est PAS un prix, c'est une absence de cotation — et le guide Cardmarket
    // en contient beaucoup (804328 : trend 0 alors que sa reverse cote 21,53 €).
    // L'ancienne chaîne en `??` s'arrêtait dessus, 0 n'étant pas nullish, et renvoyait
    // « 0 € » : verdict absurde, et depuis que le départage prend le moins cher, un 0
    // gagnait systématiquement. On traite donc 0 et négatif comme une valeur absente.
    const valide = v => (typeof v === 'number' && v > 0) ? v : null;
    if (estReverse) {
        const holo = valide(guide.trendHolo) ?? valide(guide.avgHolo);
        if (holo != null) return holo;
        // Pas de cotation holo : on retombe sur le prix normal plutôt que de ne rien
        // renvoyer — mieux vaut un prix approché qu'un « prix indisponible ».
    }
    // Même ORDRE de replis qu'à l'origine, en sautant les valeurs non cotées.
    return valide(guide.trend) ?? valide(guide.avg) ?? valide(guide.avg7)
        ?? valide(guide.avg30) ?? valide(guide.trendHolo) ?? valide(guide.avgHolo) ?? null;
}

/**
 * Repère un motif nommé dans le titre d'une annonce Vinted.
 * Insensible à la casse, aux accents et aux espaces/tirets internes : "Master Ball",
 * "masterball", "MASTER-BALL" et "Reverse Pokéball" sont tous reconnus.
 * PURE et testable — même approche que le fix "jumbo" côté extension.
 */
function motifDuTitre(titre) {
    if (!titre) return null;
    const t = String(titre)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // « poké » -> « poke »
        .toLowerCase()
        .replace(/[\s\-_]/g, '');                          // « master ball » -> « masterball »
    // La Master Ball d'abord : "masterball" contient "ball", l'ordre des tests compte.
    if (t.includes('masterball')) return 'masterball';
    if (FOILS_BALL.some(f => t.includes(f.replace('-', '')))) return 'ball';
    if (t.includes('ball')) return 'ball';   // "reverse ball", "ball pattern"
    return null;
}

/**
 * Arbitre entre ce que l'IA a vu, ce que le titre annonce et ce que la carte POSSÈDE,
 * puis renvoie les produits à viser.
 *
 * Règles (validées) :
 *   - l'IA dit s'il y a un motif (elle voit l'objet) ;
 *   - le titre dit LEQUEL quand il le nomme (le vendeur a la carte en main, et c'est
 *     l'axe où le visuel se trompe) ;
 *   - le CATALOGUE A TOUJOURS LE VETO : un motif absent de la carte est ignoré ;
 *   - divergence irréconciliable -> aucun ciblage, le moins cher gagne (décision
 *     produit B) et la carte est marquée incertaine.
 *
 * @returns {{etat:'resolu'|'aucun-motif'|'non-resolu', cible:string|null,
 *            vises:Array, autresVariantes:Array, raison:string|null}}
 *   - 'resolu'      : on sait quel produit viser -> routage normal
 *   - 'aucun-motif' : la carte n'a aucun motif spécial -> routage normal, CONFIANT.
 *                     Ce n'est PAS un échec : c'est le cas de l'immense majorité des
 *                     cartes (tous les sets d'avant Prismatic Evolutions).
 *   - 'non-resolu'  : la carte A un motif mais on n'arrive pas à le cibler ->
 *                     repli + carteIncertaine + log distinct.
 */
function resoudreMotif(analyse, motifIA, titre) {
    const vide = { cible: null, vises: [], autresVariantes: [], raison: null };
    if (!analyse || analyse.entrees.length === 0) {
        // Pas de table du tout : on ne peut ni cibler ni prétendre qu'il n'y a pas de
        // motif. Sans motif spécial connu, il n'y a rien à résoudre -> état normal.
        return { etat: 'aucun-motif', ...vide };
    }

    const motifTitre = motifDuTitre(titre);
    const dispo = m => analyse.parMotif[m] && analyse.parMotif[m].length > 0;
    const finir = (cible, raison = null) => {
        const vises = analyse.parMotif[cible] || [];
        return {
            etat: 'resolu', cible, vises, raison,
            // VETO : toutes les autres impressions connues de la carte sont écartées.
            // Seulement quand on a une cible positive — sinon on pénaliserait à l'aveugle.
            autresVariantes: analyse.tousIdProducts.filter(id => !vises.includes(id))
        };
    };

    // L'IA n'a pas su juger. S'il n'y a aucun motif spécial sur la carte, il n'y avait
    // rien à juger -> normal. Sinon on ne peut pas trancher -> repli.
    if (!motifIA || motifIA === 'indetermine') {
        if (!analyse.aDesMotifsSpeciaux) return { etat: 'aucun-motif', ...vide };
        return { etat: 'non-resolu', ...vide, raison: 'ia-indeterminee' };
    }

    // Conflit franc : le vendeur nomme un motif que la carte possède, mais l'IA affirme
    // qu'il n'y en a pas. Aucun des deux ne peut être arbitré -> borne basse + incertain.
    if (motifIA === 'aucun' && motifTitre && dispo(motifTitre)) {
        return { etat: 'non-resolu', ...vide, raison: 'conflit-ia-titre' };
    }

    if (motifIA === 'aucun') return finir('aucun');

    // L'IA voit un motif spécial. Le titre a priorité sur SON IDENTITÉ s'il en nomme un
    // que la carte possède réellement.
    if ((motifIA === 'ball' || motifIA === 'masterball') && motifTitre && dispo(motifTitre)) {
        return finir(motifTitre, motifTitre !== motifIA ? 'titre-prime-sur-ia' : null);
    }

    // Veto : le motif lu n'existe pas sur cette carte. S'il n'existe aucun motif spécial,
    // ce que l'IA a pris pour des balls est le reverse ordinaire -> on y retombe, et
    // c'est un résultat RÉSOLU (le catalogue a tranché), pas un échec.
    if ((motifIA === 'ball' || motifIA === 'masterball') && !dispo(motifIA)) {
        if (!analyse.aDesMotifsSpeciaux && dispo('reverse-classique')) {
            return finir('reverse-classique', 'veto-catalogue-aucun-motif-special');
        }
        // La carte A des motifs, mais pas celui-là (ou il n'est pas routable) -> repli.
        return { etat: 'non-resolu', ...vide, raison: 'motif-absent-ou-sans-idproduct' };
    }

    if (!dispo(motifIA)) {
        // 'reverse-classique' demandé mais non routable (ex. S&V Energy).
        if (analyse.aDesMotifsSpeciaux) return { etat: 'non-resolu', ...vide, raison: 'motif-sans-idproduct' };
        return { etat: 'aucun-motif', ...vide };
    }
    return finir(motifIA);
}

// Les classes de motif qui désignent une impression REVERSE. Sert à choisir le champ
// de prix (voir prixDeReference) : 'aucun' est une impression normale, tout le reste
// est une reverse — qu'elle soit portée par un produit partagé ou par un produit dédié.
const MOTIFS_REVERSE = ['reverse-classique', 'ball', 'masterball'];

/**
 * L'impression qu'on cote est-elle une reverse ?
 * @param {string|null} cibleMotif  la cible retenue par resoudreMotif
 * @param {boolean|null} reverseLueParIA  repli quand aucune cible n'a été résolue
 *   (vieux sets : variants_detailed existe mais sans idProduct par variante, donc
 *   aucune cible n'est routable alors que la carte PEUT être une reverse).
 */
function impressionEstReverse(cibleMotif, reverseLueParIA = false) {
    if (cibleMotif) return MOTIFS_REVERSE.includes(cibleMotif);
    return reverseLueParIA === true;
}

// ============================================================
// HIÉRARCHIE DE CONFIANCE : numéro + total  >  set déclaré  >  NOM
// ============================================================
// Le NOM est le signal le plus fragile de la chaîne : il dépend d'une lecture OCR, de
// la langue imprimée sur la carte, et il peut être FAUX TOUT EN EXISTANT AILLEURS —
// auquel cas aucune étape en aval ne peut le suspecter. Cas réel : une carte "Dana"
// (Team Up 173/181) lue "Kahili", qui est un vrai nom de carte mais dans Lost Thunder.
// Le numéro et le total, eux, étaient justes.
//
// Le TOTAL est un discriminant de SET mesuré comme fort : sur 216 sets TCGdex et 112
// tailles distinctes, 55 % des tailles n'appartiennent qu'à un seul set. Team Up est
// le SEUL set à 181 cartes ; Lost Thunder en a 214, il était donc exclu d'office.
// ⚠️ MAIS il s'effondre sous 30 cartes (18 sets font exactement 30 : les trainer kits,
// 16 % de tailles isolées seulement). Le total doit donc RESTREINDRE les candidats,
// jamais décider seul, et ne jamais réduire l'ensemble à zéro.

/**
 * Sets dont la taille officielle correspond au total imprimé.
 * PURE : on lui passe la liste des sets (telle que renvoyée par /v2/en/sets).
 * @returns {Array} les sets compatibles ; [] si le total est inconnu ou sans correspondance
 */
function setsCompatiblesAvecTotal(sets, total) {
    const t = parseInt(String(total ?? '').replace(/\D/g, ''), 10);
    if (!Array.isArray(sets) || !Number.isFinite(t) || t <= 0) return [];
    // `official` = le dénominateur imprimé sur la carte (X/official). `total` inclut les
    // secrètes, qui ne sont PAS au dénominateur — on ne l'accepte qu'en repli.
    return sets.filter(s => (s?.cardCount?.official ?? null) === t
        || (s?.cardCount?.official == null && (s?.cardCount?.total ?? null) === t));
}

// Chiffres d'un numéro. ⚠️ STRICTEMENT la même normalisation que le critère numéro et
// que l'extension : ne pas la modifier ici sans la modifier partout.
const chiffresDuNumero = n => { const m = String(n).match(/\d+/); return m ? String(parseInt(m[0], 10)) : null; };

// Forme complète normalisée, préfixe COMPRIS : "TG09" -> "TG9", "001C" -> "1C".
// N'REMPLACE PAS la normalisation ci-dessus : elle s'y ajoute, uniquement pour
// préférer une égalité exacte à une égalité de chiffres.
const numeroComplet = n => String(n).trim().toUpperCase().replace(/(\d+)/, d => String(parseInt(d, 10)));

/**
 * Compare un numéro lu à un numéro de candidat.
 * @returns {'exact'|'chiffres'|null}
 *
 * La distinction est NÉCESSAIRE : les numéros à préfixe alphabétique sont fréquents
 * (1936 documents en base : "TG09", "SV14", "001C"...) et ils COLLISIONNENT avec les
 * numéros nus dans la même expansion — mesuré : l'expansion 3630 contient "SV14" ET
 * "14", l'expansion 4361 contient "001C", "001L", "001P" et "001M". Apparier sur les
 * seuls chiffres y ramènerait plusieurs produits sans distinction, d'où la préférence
 * stricte pour l'égalité exacte.
 */
function comparerNumeros(lu, candidat) {
    if (lu == null || candidat == null) return null;
    if (numeroComplet(lu) === numeroComplet(candidat)) return 'exact';
    const a = chiffresDuNumero(lu), b = chiffresDuNumero(candidat);
    return (a && b && a === b) ? 'chiffres' : null;
}

/**
 * Numéro de carte déduit du SLUG Cardmarket, avec le code de set en désambiguïsateur.
 *
 * POURQUOI CETTE FONCTION EXISTE. Le slug d'une fiche a la forme
 * `Nom[-Lv12][-V2]-CODEnnn`, où le code de set et le numéro sont COLLÉS. L'ancienne
 * règle prenait les chiffres de fin (`/(\d+)$/`) et avalait donc ceux du code :
 *     "Porygon-Z-sI100340"  code sI100  -> 100340   au lieu de 340
 *     "Alakazam-B21"        code B2     ->     21   au lieu de 1
 *     "Mewtwo-V-UNION-V3"   code SWSH   ->      3   (c'est le marqueur de VARIANTE)
 * Taux d'erreur mesuré sur 6854 documents témoins (ceux qui portent aussi un numéro
 * lu dans le TITRE, lequel fait foi et sert d'arbitre gratuit) : 28,4 %.
 * Avec la règle ci-dessous : 0,2 %, et ZÉRO régression — aucun cas que l'ancienne
 * règle réussissait n'est cassé, elle s'abstient seulement 232 fois de plus.
 *
 * L'ABSTENTION EST UN RÉSULTAT. Renvoyer null vaut mieux qu'un numéro plausible et
 * faux : un candidat sans numéro connu se classe « inconnu » (rang 2), alors qu'un
 * faux numéro crédible le fait gagner contre la bonne carte.
 *
 * ⚠️ Cette fonction est le SEUL endroit où cette règle est écrite. Elle est appelée
 * par live-cardmarket.js (à la lecture) et par nettoyer-slugs.js (au rattrapage) :
 * si les deux divergeaient, les documents d'avant et d'après ne voudraient plus dire
 * la même chose.
 *
 * @param {string} slug     dernier segment de l'URL, query string DÉJÀ retirée
 * @param {string|null} codeSet  code de set du produit (ex "sI100", "B2", "mC")
 * @returns {string|null}   le numéro, ou null si on ne sait pas
 */
function numeroDepuisSlug(slug, codeSet) {
    const segments = String(slug || '').split('-').filter(Boolean);
    // On remonte les marqueurs de FIN qui ne sont pas des numéros : la variante
    // Cardmarket (V1/V2/V3) et le niveau des vieilles cartes (Lv65).
    let i = segments.length - 1;
    while (i >= 0 && /^(V\d+|Lv\d+)$/i.test(segments[i])) i--;
    if (i < 0) return null;

    let queue = String(segments[i]).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const code = codeSet ? normaliserCodeSet(codeSet) : null;
    if (code && queue.startsWith(code)) queue = queue.slice(code.length);

    // Ce qui reste doit COMMENCER par un chiffre. Sinon le segment est du texte
    // ("Online-Code-Card-...-PKM"), et il n'y a pas de numéro à en tirer.
    const m = /^\d/.test(queue) ? queue.match(/^(\d+)/) : null;
    if (!m) return null;
    // "AR000", "SV000" : aucune carte ne porte le numéro 0. C'est un remplissage du
    // slug, pas un numéro — 6 documents témoins le confirment.
    if (/^0+$/.test(m[1])) return null;
    return m[1];
}

/**
 * RANG d'un candidat vis-à-vis du numéro lu. Trois états, et pas deux : la nuance
 * porte sur la différence entre « je ne sais pas » et « je sais que non ».
 *
 *   1 -> son numéro CORRESPOND à celui lu           : candidat légitime
 *   2 -> son numéro est INCONNU (jamais appris)     : rien ne l'accuse, rien ne l'appuie
 *   3 -> son numéro est connu et CONTREDIT le lu    : le catalogue le disculpe
 *
 * Le rang 3 est le seul apport réel par rapport au score actuel : aujourd'hui un
 * candidat dont le numéro contredit la photo perd des points mais reste en course, et
 * il gagne dès que les autres critères le rattrapent — c'est le mécanisme du cas
 * Scizor (5 points contre 20 : un malus de −50 ne l'aurait pas renversé, seul un
 * classement par rangs le peut).
 *
 * @param {string|number|null} numeroLu        ce que l'IA a lu sur la photo
 * @param {string|number|null} numeroCandidat  le numéro du candidat en base
 * @returns {1|2|3|null}  null si rien n'a été lu — il n'y a alors pas de rang à établir
 */
function rangDuNumero(numeroLu, numeroCandidat) {
    const lu = numeroLu != null ? String(numeroLu).trim() : '';
    if (!lu) return null;
    const cand = numeroCandidat != null ? String(numeroCandidat).trim() : '';
    if (!cand) return 2;
    return comparerNumeros(lu, cand) ? 1 : 3;
}

/**
 * Normalise le champ `total` lu par l'IA (le "Y" de X/Y).
 * On prend le DERNIER groupe de chiffres : quand l'IA recopie la fraction entière
 * ("184/182"), le total est le nombre d'APRÈS le slash. Prendre le premier donnerait
 * 184, c'est-à-dire le NUMÉRO — donc "numéro == total", ce qui désactive la détection
 * de secret rare dont dépendent les cas Roserade 184/182 et Fezandipiti 288/217.
 * Sur une valeur à un seul groupe ("182", "TG30"), premier et dernier sont identiques.
 * @returns {{total:string|null, brutIgnore:string|null}} brutIgnore = valeur non
 *   numérique écartée (ex. "SV-P"), à signaler dans les logs par l'appelant.
 */
function normaliserTotal(valeur) {
    const brut = valeur != null ? String(valeur).trim() : '';
    if (!brut) return { total: null, brutIgnore: null };
    const groupes = brut.match(/\d+/g);
    if (!groupes) return { total: null, brutIgnore: brut };
    return { total: groupes[groupes.length - 1], brutIgnore: null };
}

/**
 * Note un candidat.
 * @param {object} candidat  { idProduct, idExpansion, numeroCardmarket, variante, prix, distanceImage }
 * @param {object} lu        ce que l'IA/TCGdex ont lu : { numero, total, setCode,
 *                           idExpansionsAttendues, rareteElevee, regionAttendue,
 *                           motif } — `motif` étant le résultat de resoudreMotif().
 * @returns {{score:number, detail:object}}
 */
function scorerCandidat(candidat, lu) {
    let score = 0;
    const detail = {};

    // 1. NUMÉRO : le numéro Cardmarket du candidat == numéro lu sur la carte ?
    //    Le poids dépend de la CERTITUDE du numéro : un numéro scrapé sur Cardmarket
    //    fait foi (50 pts), un numéro déduit de TCGdex (départagé par prix, ou set
    //    partagé JP/international) peut être faux -> il oriente sans écraser (25 pts).
    if (lu.numero != null && candidat.numeroCardmarket != null) {
        // On compare sur la PREMIÈRE suite de chiffres, ce qui gère aussi bien les
        // préfixes de set (SWSH261 -> 261, TG06 -> 6, GG70 -> 70) que les suffixes
        // de réimpression (15A1 -> 15, le "A1" = Celebrations Classic Collection).
        // Le catalogue stocke "261" ou "15A1" ; l'IA lit "261" ou "15".
        const norm = n => { const m = String(n).match(/\d+/); return m ? String(parseInt(m[0], 10)) : '0'; };
        const nCand = norm(candidat.numeroCardmarket);
        const nLu = norm(lu.numero);
        const fiable = candidat.certitudeNumero !== 'heuristique';
        const poids = fiable ? POIDS.numero : Math.round(POIDS.numero / 2);
        if (nCand === nLu) {
            score += poids;
            detail.numero = `+${poids} (match ${nLu}${fiable ? '' : ', numéro estimé'})`;
        } else {
            detail.numero = `0 (candidat ${nCand} ≠ lu ${nLu})`;
        }
    } else detail.numero = '0 (numéro manquant)';

    // 2. SET : le candidat est-il dans l'expansion attendue ?
    //    Le setCode/stamp lu par l'IA PRIME : une réimpression (Celebrations, Trainer
    //    Gallery, 151...) reprend un ancien numéro, TCGdex matche alors le set d'origine
    //    par le numéro. Le stamp tranche : un candidat dont le code RÉEL contredit le
    //    stamp est une édition démontrablement fausse -> malus ; un candidat dont le
    //    code == le stamp est la bonne édition -> bonus, même si TCGdex ne le relie pas.
    //    Trois issues possibles quand les deux codes sont connus :
    //      - IDENTIQUES         -> bonus PLEIN
    //      - APPARENTÉS         -> bonus PARTIEL (sous-set ou expansion compagnone :
    //        "SV-P" vs "SV-P/CS", "PRE" vs "xPRE"). Sans ce cas intermédiaire, le bon
    //        produit prenait le MÊME malus qu'un set sans aucun rapport, alors que le
    //        set de base encaissait le bonus plein : 80 points d'écart injustifiés.
    //      - SANS RAPPORT       -> malus plein (édition démontrablement fausse)
    const attendues = lu.idExpansionsAttendues || (lu.idExpansionAttendu != null ? [lu.idExpansionAttendu] : []);
    const codeIA = normaliserCodeSet(lu.setCode);
    const codeCand = normaliserCodeSet(candidat.codeSet);
    if (codeIA && codeCand && codeIA === codeCand) {
        score += POIDS.set; detail.set = `+${POIDS.set} (code ${candidat.codeSet} = stamp lu)`;
    } else if (codeIA && codeCand && codesApparentes(codeIA, codeCand)) {
        score += POIDS.setPartiel;
        detail.set = `+${POIDS.setPartiel} (code ${candidat.codeSet} apparenté au stamp lu ${lu.setCode}, mais pas identique)`;
    } else if (codeIA && codeCand) {
        score -= POIDS.set; detail.set = `-${POIDS.set} (code ${candidat.codeSet} ≠ stamp lu ${lu.setCode})`;
    } else if (attendues.length && candidat.idExpansion != null) {
        if (attendues.includes(candidat.idExpansion)) { score += POIDS.set; detail.set = `+${POIDS.set} (bon set)`; }
        else { detail.set = `0 (exp ${candidat.idExpansion} hors du set attendu)`; }
    } else detail.set = '0 (set non déterminé)';

    // 3. VARIANTE (reverse vs normale) : DÉPARTAGE À NUMÉRO ÉGAL.
    //    Sur certains sets, une même carte a 2-3 idProducts au MÊME numéro
    //    (normale=V1, reverse=V2, illustration=V3). Le critère numéro leur donne
    //    à tous +50 -> égalité. Ce critère les sépare, MAIS seulement quand deux
    //    conditions sont réunies :
    //      - on sait QUELLE variante viser (voir ci-dessous)
    //      - la variante du candidat est CONNUE en base (sets appris avec --maj)
    //    Sans l'une des deux (set "allégé", ou cible indécidable), il reste neutre :
    //    on ne pénalise jamais sur une donnée absente.
    //
    //    ⚠️ PLUS AUCUNE DÉRIVATION AUTOMATIQUE. La règle "reverse -> V2" a été
    //    SUPPRIMÉE : elle est fausse par principe (V1/V2/V3 n'a pas de sémantique
    //    stable), et dans Obsidian Flames elle visait un HOLO à 37,44 €. C'est le
    //    critère `motif` ci-dessous, alimenté par le catalogue TCGdex, qui route
    //    désormais. `lu.varianteAttendue` n'est plus qu'une surcharge manuelle
    //    explicite : aucun appelant ne la renseigne en production.
    const varianteAttendue = lu.varianteAttendue || null;
    if (varianteAttendue && candidat.variante) {
        if (candidat.variante === varianteAttendue) {
            score += POIDS.variante;
            detail.variante = `+${POIDS.variante} (${candidat.variante} = attendu)`;
        } else {
            score -= POIDS.variante;
            detail.variante = `-${POIDS.variante} (${candidat.variante} ≠ attendu ${varianteAttendue})`;
        }
    } else detail.variante = '0 (variante indéterminée)';

    // 3bis. MOTIF DE REVERSE : le critère qui route réellement.
    //    `lu.motif` vient de resoudreMotif() : `vises` = les idProduct qui portent le
    //    motif retenu, `autresVariantes` = les autres impressions CONNUES de la même
    //    carte. Le malus est le « veto du catalogue » : si TCGdex nous dit que la Poké
    //    Ball est le produit 806448, alors le produit de base 805422 est démontrablement
    //    la mauvaise cible, exactement comme un code de set qui contredit le stamp.
    //    Un candidat ABSENT de la table (autre édition, autre set) n'est pas touché :
    //    on ne pénalise pas ce que la table ne décrit pas.
    //    Quand aucune cible n'a été résolue, le critère est entièrement inerte.
    if (lu.motif && Array.isArray(lu.motif.vises) && lu.motif.vises.length) {
        if (lu.motif.vises.includes(candidat.idProduct)) {
            score += POIDS.motif;
            detail.motif = `+${POIDS.motif} (motif ${lu.motif.cible} -> ce produit)`;
        } else if ((lu.motif.autresVariantes || []).includes(candidat.idProduct)) {
            score -= POIDS.motif;
            detail.motif = `-${POIDS.motif} (autre impression connue de la carte, motif attendu ${lu.motif.cible})`;
        } else detail.motif = '0 (produit hors table des variantes)';
    } else detail.motif = '0 (pas de motif ciblé)';

    // 4. IMAGE : plus la distance de hash est faible, plus le bonus est élevé
    if (typeof candidat.distanceImage === 'number') {
        const bonus = Math.round(POIDS.image * (1 - candidat.distanceImage / DISTANCE_IMAGE_MAX));
        score += bonus; detail.image = `+${bonus} (distance ${candidat.distanceImage}/64)`;
    } else detail.image = '0 (pas d\'image)';

    // 5. PRIX cohérent avec la rareté lue :
    //    - si carte "secrète"/IR (numéro > total) attendue -> on favorise un prix ÉLEVÉ
    //    - sinon (carte normale) -> on favorise un prix BAS
    //    ⚠️ SAUF pour les PROMOS, où le critère est NEUTRALISÉ. Une promo va de 0,10 € à
    //    plusieurs centaines d'euros (mesuré : le bon Magikarp promo chinois 024 cote
    //    114,80 €, le mauvais candidat 0,29 €) : l'hypothèse « pas une rareté spéciale,
    //    donc pas chère » n'a aucun fondement sur cette famille, et elle récompensait
    //    activement le mauvais produit de 25 points. On ne juge pas sur une hypothèse
    //    qu'on sait fausse — même principe que « on ne pénalise pas une donnée absente ».
    const estPromo = String(lu.rarete || '').toLowerCase() === 'promo';
    if (estPromo) {
        detail.prix = '0 (promo : le prix ne dit rien de la rareté)';
    } else if (typeof candidat.prix === 'number') {
        const estCher = candidat.prix >= 3; // seuil simple : au-dessus de 3€ = probablement une carte "à valeur"
        if (lu.rareteElevee && estCher) { score += POIDS.prix; detail.prix = `+${POIDS.prix} (IR attendue, prix élevé ${candidat.prix}€)`; }
        else if (!lu.rareteElevee && !estCher) { score += POIDS.prix; detail.prix = `+${POIDS.prix} (carte normale, prix bas ${candidat.prix}€)`; }
        else detail.prix = `0 (prix ${candidat.prix}€ incohérent avec rareté lue)`;
    } else detail.prix = '0 (pas de prix)';

    // 6. RÉGION : occidental (FR/EN...) vs japonais. Gros malus si ça se contredit
    //    (évite de choisir l'édition japonaise pour une carte française).
    if (lu.regionAttendue && candidat.region) {
        if (candidat.region === lu.regionAttendue) { score += POIDS.region; detail.region = `+${POIDS.region} (${candidat.region})`; }
        else { score -= POIDS.region; detail.region = `-${POIDS.region} (candidat ${candidat.region} ≠ attendu ${lu.regionAttendue})`; }
    } else detail.region = '0 (région indéterminée)';

    // 7. COHÉRENCE SECRET RARE : si le numéro lu dépasse le total (ex: 228/217), la
    //    carte est un SECRET/alt-art -> son produit Cardmarket a lui aussi un numéro
    //    AU-DESSUS du total. On favorise les candidats "secrets", on pénalise les
    //    numéros normaux. Robuste aux erreurs d'OCR sur ces tout petits numéros :
    //    288 lu "228" garde le bon candidat car 288 > 217 (secret), pas 142.
    const luNum = lu.numero != null ? parseInt(String(lu.numero).match(/\d+/)?.[0] ?? '', 10) : NaN;
    const totNum = lu.total != null ? parseInt(String(lu.total).match(/\d+/)?.[0] ?? '', 10) : NaN;
    const luEstSecret = Number.isFinite(luNum) && Number.isFinite(totNum) && luNum > totNum;
    if (luEstSecret && candidat.numeroCardmarket != null) {
        const candNum = parseInt(String(candidat.numeroCardmarket).match(/\d+/)?.[0] ?? '', 10);
        if (Number.isFinite(candNum)) {
            if (candNum > totNum) { score += POIDS.secret; detail.secret = `+${POIDS.secret} (secret n°${candNum} > total ${totNum})`; }
            else { score -= POIDS.secret; detail.secret = `-${POIDS.secret} (n°${candNum} normal, mais secret attendu)`; }
        } else detail.secret = '0 (numéro candidat illisible)';
    } else detail.secret = '0 (pas un secret rare)';

    return { score, detail };
}

/**
 * Classe tous les candidats et renvoie le meilleur + le niveau de confiance.
 * @returns {{gagnant, scores, confiant:boolean, strategieReverse:string|null}}
 *   Chaque entrée de `scores` porte sa PROPRE `strategie` ('filtre-url' |
 *   'produit-distinct' | null) : sur une même carte les deux mécanismes coexistent
 *   (PRE 033 : le produit de base a besoin du filtre d'offres pour sa reverse
 *   ordinaire, tandis que les Poké Ball / Master Ball sont des produits distincts).
 *   Une stratégie globale serait donc forcément fausse pour une partie du classement.
 *   `strategieReverse` est celle du GAGNANT, par commodité pour la route.
 */
function choisirMeilleur(candidats, lu) {
    const strategies = lu.motif?.strategieParIdProduct instanceof Map
        ? lu.motif.strategieParIdProduct
        : new Map();

    const scores = candidats.map(c => ({
        candidat: c,
        // Stratégie de lecture du prix POUR CE CANDIDAT, telle que la donne le catalogue.
        strategie: strategies.get(c.idProduct) ?? null,
        ...scorerCandidat(c, lu)
    }));

    // Tri par score décroissant. À SCORE ÉGAL, on prend le MOINS CHER.
    // ⚠️ DÉCISION PRODUIT ASSUMÉE, pas un effet de bord. Quand plusieurs variantes V
    // du même numéro coexistent dans une expansion compagnone, RIEN dans le catalogue
    // ne dit laquelle porte le motif spécial (Poké Ball, Master Ball) : les slugs ne
    // l'encodent pas, la rareté affichée est ★ pour toutes, et isReverseHolo=Y est un
    // filtre d'offres, pas une identité de produit. Les écarts sont pourtant réels
    // (xASC153 : V1 ~1,53 € / V2 ~0,35 €). On choisit délibérément la BORNE BASSE, la
    // route posant par ailleurs `carteIncertaine` : sous-estimer fait rater une bonne
    // affaire, surestimer fait SURPAYER — l'erreur coûteuse est la seconde.
    // Un prix inconnu passe en dernier : rien ne garantit qu'il soit bas.
    // (Avant ce tri, ce comportement se produisait par ACCIDENT, via le seul critère
    // prix "< 3 € -> +25". Il est désormais explicite, commenté et testé.)
    // Un prix nul ou négatif = pas de cotation, PAS une aubaine : il passe en dernier
    // comme un prix inconnu, sinon il raflerait tous les départages.
    const prixTri = c => (typeof c.prix === 'number' && c.prix > 0) ? c.prix : Infinity;
    scores.sort((a, b) => (b.score - a.score) || (prixTri(a.candidat) - prixTri(b.candidat)));

    const meilleur = scores[0];
    const second = scores[1];
    // Confiance haute si le meilleur devance nettement le 2e (écart >= 30 points)
    const confiant = !second || (meilleur.score - second.score) >= 30;

    return {
        gagnant: meilleur,
        scores,
        confiant,
        strategieReverse: meilleur ? (meilleur.strategie ?? null) : null
    };
}

module.exports = {
    scorerCandidat, choisirMeilleur, POIDS,
    normaliserCodeSet, codesApparentes,
    analyserVariantes, resoudreMotif, motifDuTitre, normaliserTotal,
    prixDeReference, impressionEstReverse,
    setsCompatiblesAvecTotal, comparerNumeros, chiffresDuNumero, rangDuNumero,
    numeroDepuisSlug,
    MOTIFS_CIBLABLES, MOTIFS_REVERSE, FOILS_BALL, FOILS_TEXTURE
};

// ---- Tests isolés ----
if (require.main === module) {
    let echecs = 0;

    // ---- Jeux de données RÉELS, copiés de l'API TCGdex (/v2/en/cards/{id}) ----
    // Réduits aux seuls champs que analyserVariantes lit. Les idProduct ont été
    // recoupés un par un avec notre collection guide_prix.
    const VD_ESPEON_PRE = [ // sv08.5-033 — Mentali, Évolutions Prismatiques
        { type: 'reverse', size: 'standard', pricing: { cardmarket: { idProduct: 805422 } } }, // reverse classique
        { type: 'holo', size: 'standard', pricing: { cardmarket: { idProduct: 805422 } } },   // même produit -> partagé
        { type: 'reverse', size: 'standard', foil: 'pokeball', pricing: { cardmarket: { idProduct: 806448 } } },
        { type: 'reverse', size: 'standard', foil: 'masterball', pricing: { cardmarket: { idProduct: 806449 } } },
        { type: 'holo', size: 'standard', foil: 'cosmos', pricing: { cardmarket: { idProduct: 858733 } } },
    ];
    const VD_PIKACHU_LOR = [ // swsh11-052 — Pikachu, Lost Origin
        { type: 'normal', size: 'standard', pricing: { cardmarket: { idProduct: 674062 } } },
        { type: 'reverse', size: 'standard', pricing: { cardmarket: { idProduct: 674062 } } }, // MÊME produit
    ];

    const verifier = (nom, obtenu, attendu) => {
        const ok = obtenu === attendu;
        console.log(`${ok ? '✅' : '❌'} ${nom} : ${obtenu}${ok ? '' : ` (attendu ${attendu})`}`);
        if (!ok) echecs++;
    };

    // --- Test 1 : Cynthia's Roserade IR (184/182 Destined Rivals) ---
    console.log('=== Test 1 : secret rare (numéro > total) ===');
    {
        const lu = { numero: 184, total: 182, idExpansionAttendu: 6096, rareteElevee: true, regionAttendue: 'occidental' };
        const candidats = [
            { idProduct: 826058, idExpansion: 6096, numeroCardmarket: 184, prix: 12.79, region: 'occidental' }, // la vraie IR
            { idProduct: 825882, idExpansion: 6096, numeroCardmarket: 8,   prix: 0.10,  region: 'occidental' },
            { idProduct: 861964, idExpansion: 6413, numeroCardmarket: 139, prix: 30.00, region: 'occidental' },
            { idProduct: 816658, idExpansion: 6037, numeroCardmarket: 5,   prix: 0.09,  region: 'japonais' },
        ];
        const { gagnant } = choisirMeilleur(candidats, lu);
        verifier('gagnant', gagnant.candidat.idProduct, 826058);
    }

    // --- Test 2 : REVERSE à numéro égal (le cas Mentali OBF 086) — RÉÉCRIT ---
    // ⚠️ L'attendu précédent (« la reverse = 727069, la variante V2 ») était FAUX, et
    // ce test vert protégeait le bug. Vérité TCGdex, recoupée avec notre guide_prix :
    //     725166  normal/— + reverse/—   trend 0,11 € / trendHolo 0,88 €
    //     727069  holo/—                 trend 37,44 €   <-- la "variante V2" de l'URL
    //     804328  reverse/—              trendHolo 21,53 €
    // Autrement dit : dans Obsidian Flames la reverse ORDINAIRE est portée par le
    // produit de BASE 725166 (partagé avec la normale, donc lisible seulement au
    // filtre d'offres), et 727069 — que l'ancien test désignait comme "la reverse" —
    // est un HOLO à 37,44 € qu'il ne faut JAMAIS viser pour une reverse.
    // Le départage entre les deux entrées `reverse/—` (725166 et 804328) est obtenu
    // par le tri « moins cher » de la décision produit B, sans règle ad hoc.
    console.log('\n=== Test 2 : reverse OBF 086 -> produit de base + filtre d\'URL ===');
    {
        const analyse = analyserVariantes([
            { type: 'normal', pricing: { cardmarket: { idProduct: 725166 } } },
            { type: 'holo', pricing: { cardmarket: { idProduct: 727069 } } },
            { type: 'reverse', pricing: { cardmarket: { idProduct: 725166 } } },
            { type: 'reverse', pricing: { cardmarket: { idProduct: 804328 } } },
        ]);
        const motif = resoudreMotif(analyse, 'reverse-classique', 'Mentali Obsidian Flames 086');
        const lu = {
            numero: 86, idExpansionsAttendues: [5385], rareteElevee: false,
            regionAttendue: 'occidental',
            motif: { ...motif, strategieParIdProduct: analyse.strategieParIdProduct }
        };
        const candidats = [
            { idProduct: 725166, idExpansion: 5385, numeroCardmarket: 86, variante: 'V1', prix: 0.11, region: 'occidental' },
            { idProduct: 727069, idExpansion: 5385, numeroCardmarket: 86, variante: 'V2', prix: 37.44, region: 'occidental' },
            { idProduct: 804328, idExpansion: 5385, numeroCardmarket: 86, variante: 'V3', prix: 21.53, region: 'occidental' },
        ];
        const { gagnant, confiant, scores } = choisirMeilleur(candidats, lu);
        verifier('motif résolu', motif.etat, 'resolu');
        verifier('gagnant = le produit de base 725166', gagnant.candidat.idProduct, 725166);
        verifier('stratégie = filtre d\'URL (produit partagé)', gagnant.strategie, 'filtre-url');
        verifier('le holo à 37,44 € est écarté', gagnant.candidat.idProduct !== 727069, true);
        verifier('   ... et pénalisé par le veto', scores.find(s => s.candidat.idProduct === 727069).detail.motif.startsWith('-'), true);
        // Prix de référence : le produit étant PARTAGÉ, c'est trendHolo qui vaut, pas
        // trend (0,11 € = la commune). Valeurs réelles de notre guide_prix.
        verifier('prix de référence = trendHolo', prixDeReference({ trend: 0.11, trendHolo: 0.88 }, gagnant.strategie), 0.88);
        // ⚠️ Confiance BASSE et c'est VOULU : deux produits (725166 et 804328) portent
        // une entrée `reverse/—` sur cette carte, TCGdex ne les distingue pas davantage.
        // On prend le moins cher (décision produit B) et on l'annonce comme incertain,
        // plutôt que de simuler une certitude qu'on n'a pas.
        verifier('confiance basse (2 produits portent ce motif)', confiant, false);
    }

    // --- Test 3 : set "allégé" (aucune variante connue) -> critère neutre, pas de régression ---
    console.log('\n=== Test 3 : variante inconnue -> neutre ===');
    {
        const lu = { numero: 86, idExpansionsAttendues: [5385], rareteElevee: false, regionAttendue: 'occidental', varianteAttendue: 'V2' };
        const candidats = [
            { idProduct: 725166, idExpansion: 5385, numeroCardmarket: 86, variante: null, prix: 0.50, region: 'occidental' },
            { idProduct: 727069, idExpansion: 5385, numeroCardmarket: 86, variante: null, prix: 1.20, region: 'occidental' },
        ];
        const { scores } = choisirMeilleur(candidats, lu);
        // Sans variante en base, les deux gardent le même score (numéro+set+région) : aucun malus injuste
        verifier('scores égaux (pas de malus sur donnée absente)', scores[0].score, scores[1].score);
    }

    // --- Test 4 : STAMP départage une réimpression (le cas Venusaur Celebrations) ---
    // Venusaur 15/102 existe en Base Set/Expansion Pack ET en Celebrations (même n°).
    // TCGdex matche l'ancien set par le numéro -> expansion attendue = l'ancien set.
    // L'IA a lu le stamp "CEL". Le candidat à l'ancien code ("EXP") contredit "CEL"
    // -> malus. La Celebrations (code encore INCONNU) doit passer devant SANS que son
    // code soit appris (grâce au malus sur la contradiction).
    console.log('\n=== Test 4 : stamp (réimpression Celebrations) ===');
    {
        const lu = { numero: 15, setCode: 'CEL', idExpansionsAttendues: [4169], rareteElevee: false, regionAttendue: 'occidental' };
        const candidats = [
            { idProduct: 557654, idExpansion: 4169, numeroCardmarket: 15, codeSet: 'EXP', prix: 60, region: 'occidental' }, // ancien set (contredit)
            { idProduct: 576773, idExpansion: 4347, numeroCardmarket: '15A1', codeSet: null, prix: 18, region: 'occidental' }, // Celebrations, code pas encore appris
        ];
        const { gagnant } = choisirMeilleur(candidats, lu);
        verifier('gagnant = Celebrations (malus sur le code qui contredit)', gagnant.candidat.idProduct, 576773);
    }

    // --- Test 5 : stamp CONFIRME un candidat une fois son code appris ---
    console.log('\n=== Test 5 : stamp confirme la réimpression (code appris) ===');
    {
        const lu = { numero: 15, setCode: 'CEL', idExpansionsAttendues: [4169], rareteElevee: false, regionAttendue: 'occidental' };
        const candidats = [
            { idProduct: 557654, idExpansion: 4169, numeroCardmarket: 15, codeSet: 'EXP', prix: 60, region: 'occidental' },
            { idProduct: 576773, idExpansion: 4347, numeroCardmarket: '15A1', codeSet: 'CEL', prix: 18, region: 'occidental' }, // code appris = CEL
        ];
        const { gagnant } = choisirMeilleur(candidats, lu);
        verifier('gagnant = Celebrations (code confirme)', gagnant.candidat.idProduct, 576773);
    }

    // --- Test 6 : secret rare avec numéro MAL LU (le cas Favianos/Fezandipiti ex) ---
    // Carte 288/217 (secret) mais l'IA lit "228". Les deux candidats ASC font 0 sur le
    // numéro exact ; c'est la cohérence "secret" qui doit choisir le 288 (> total 217).
    console.log('\n=== Test 6 : secret rare à numéro mal lu (288 lu 228) ===');
    {
        const lu = { numero: 228, total: 217, idExpansionsAttendues: [6395], rareteElevee: true, regionAttendue: 'occidental' };
        const candidats = [
            { idProduct: 869753, idExpansion: 6395, numeroCardmarket: 142, region: 'occidental' }, // normale (n° < total)
            { idProduct: 869899, idExpansion: 6395, numeroCardmarket: 288, region: 'occidental' }, // le SIR (n° > total)
        ];
        const { gagnant } = choisirMeilleur(candidats, lu);
        verifier('gagnant = le SIR n°288 (cohérence secret)', gagnant.candidat.idProduct, 869899);
    }

    // --- Test 7 : CRITÈRE SET isolé — exact / partiel / sans rapport ---
    // Candidats réduits au seul codeSet : tous les autres critères sont neutres, donc
    // le score EST la contribution du critère set. C'est ce qui rend le test lisible.
    console.log('\n=== Test 7 : critère set — exact vs partiel vs sans rapport ===');
    {
        const scoreSet = (setCodeLu, codeSetCandidat) =>
            scorerCandidat({ codeSet: codeSetCandidat }, { setCode: setCodeLu }).score;

        verifier('"PRE" vs "PRE" -> bonus plein', scoreSet('PRE', 'PRE'), 40);
        verifier('"PRE" vs "xPRE" -> partiel (expansion compagnone)', scoreSet('PRE', 'xPRE'), 15);
        verifier('"SV-P" vs "SV-P/CS" -> partiel (sous-set)', scoreSet('SV-P', 'SV-P/CS'), 15);
        // Le cas réel du bug Magikarp : la valeur en base est encore URL-ENCODÉE.
        // Le décodage à la comparaison doit la rattraper sans attendre le backfill.
        verifier('"SV-P" vs "SV-P%2FCS" (encodé) -> partiel', scoreSet('SV-P', 'SV-P%2FCS'), 15);
        // ⚠️ LA DISCRIMINATION NE DOIT PAS ÊTRE CASSÉE : deux sets distincts qui
        // partagent un début de code restent en contradiction -> malus PLEIN.
        verifier('"PAL" vs "PAF" -> malus plein (sets distincts)', scoreSet('PAL', 'PAF'), -40);
        // Garde-fou du "X" initial : sans le minimum de longueur, le set "XY" se
        // réduirait à "Y" et deviendrait apparenté à n'importe quel code en Y.
        verifier('"XY" vs "YCS" -> malus plein (pas de dérive sur le X)', scoreSet('XY', 'YCS'), -40);
        // Un partiel ne devient JAMAIS un exact : l'écart doit rester de 25 points.
        verifier('exact devance partiel de 25', scoreSet('PRE', 'PRE') - scoreSet('PRE', 'xPRE'), 25);

        // ---- Plancher de longueur sur la parenté (mesuré : 618 paires fautives) ----
        // Le cas réel : le code japonais "mC" décrochait +15 face au stamp "MCD" lu par
        // l'IA, et faisait gagner un produit sans rapport contre le McDonald's japonais.
        verifier('"MCD" vs "mC" -> malus (2 car. communs, insuffisant)', scoreSet('MCD', 'mC'), -40);
        verifier('"MCD" vs "MCDP" -> partiel (3 car.)', scoreSet('MCD', 'MCDP'), 15);
        verifier('"MCD" vs "MCD11" -> partiel (3 car.)', scoreSet('MCD', 'MCD11'), 15);
        verifier('"EC" vs "EC3" -> malus (2 car. communs)', scoreSet('EC', 'EC3'), -40);
        verifier('"DRI" vs "DR" -> malus (2 car. communs)', scoreSet('DRI', 'DR'), -40);
        verifier('"SM-P" vs "SM-P/CS" -> partiel conservé', scoreSet('SM-P', 'SM-P/CS'), 15);
    }

    // --- Test 8 : lecture du motif dans le TITRE de l'annonce ---
    // Même approche que le fix "jumbo" côté extension : insensible à la casse, aux
    // accents et aux séparateurs. L'ordre des tests compte ("masterball" contient "ball").
    console.log('\n=== Test 8 : motif nommé dans le titre Vinted ===');
    {
        verifier('« Reverse Pokeball »', motifDuTitre('Carte Pokémon Mentali Reverse Pokeball | Évolutions Prismatiques 033/131 FR'), 'ball');
        verifier('« Poké Ball » (accent + espace)', motifDuTitre('Mentali Poké Ball 033/131'), 'ball');
        verifier('« MASTER-BALL » (casse + tiret)', motifDuTitre('Espeon MASTER-BALL 033'), 'masterball');
        verifier('« masterball » prime sur « ball »', motifDuTitre('reverse masterball'), 'masterball');
        verifier('titre sans motif', motifDuTitre('Carte Pokémon Pikachu Lost Origin 052/196'), null);
        verifier('titre absent', motifDuTitre(null), null);
    }

    // --- Test 9 : stratégie de lecture DÉDUITE de la table, par produit ---
    // Sur UNE MÊME carte les deux mécanismes coexistent : le produit de base porte la
    // reverse ordinaire (donc filtre d'offres), les motifs sont des produits distincts.
    // C'est ce qui rend une stratégie globale impossible.
    console.log('\n=== Test 9 : stratégie par produit (Espeon PRE 033) ===');
    {
        const a = analyserVariantes(VD_ESPEON_PRE);
        verifier('base 805422 (partagé avec le holo) -> filtre d\'URL', a.strategieParIdProduct.get(805422), 'filtre-url');
        verifier('Poké Ball 806448 -> produit distinct', a.strategieParIdProduct.get(806448), 'produit-distinct');
        verifier('Master Ball 806449 -> produit distinct', a.strategieParIdProduct.get(806449), 'produit-distinct');
        verifier('motifs routables détectés', a.motifsDisponibles.join(','), 'reverse-classique,ball,masterball');
        verifier('la carte a des motifs spéciaux', a.aDesMotifsSpeciaux, true);
    }

    // --- Test 10 : Espeon PRE 033 — les 4 motifs routent vers 4 produits ---
    // Écart de prix réel sur la MÊME carte : 0,26 € / 0,46 € / 1,58 € / 29,07 €.
    console.log('\n=== Test 10 : Espeon PRE 033, routage à 4 voies ===');
    {
        const a = analyserVariantes(VD_ESPEON_PRE);
        const router = (motifIA, titre) => {
            const m = resoudreMotif(a, motifIA, titre);
            const lu = { numero: '033', setCode: 'PRE', rareteElevee: false, regionAttendue: 'occidental',
                         motif: { ...m, strategieParIdProduct: a.strategieParIdProduct } };
            const candidats = [
                { idProduct: 805422, idExpansion: 5944, numeroCardmarket: '033', codeSet: 'PRE',  prix: 0.17, region: 'occidental' },
                { idProduct: 806448, idExpansion: 6009, numeroCardmarket: '033', codeSet: 'xPRE', prix: 2.48, region: 'occidental' },
                { idProduct: 806449, idExpansion: 6009, numeroCardmarket: '033', codeSet: 'xPRE', prix: 0.50, region: 'occidental' },
                { idProduct: 858733, idExpansion: 6009, numeroCardmarket: '033', codeSet: 'xPRE', prix: 4.58, region: 'occidental' },
            ];
            const r = choisirMeilleur(candidats, lu);
            return { id: r.gagnant.candidat.idProduct, strat: r.gagnant.strategie, etat: m.etat, confiant: r.confiant };
        };

        const commune = router('aucun', 'Mentali Évolutions Prismatiques 033/131');
        verifier('motif "aucun" -> produit de base', commune.id, 805422);

        const classique = router('reverse-classique', 'Mentali reverse 033/131');
        verifier('reverse classique -> produit de base', classique.id, 805422);
        verifier('   ... avec filtre d\'URL', classique.strat, 'filtre-url');

        // Le cas du bug B : l'IA ne voit pas le motif, mais le vendeur l'écrit.
        const pokeball = router('ball', 'Carte Pokémon Mentali Reverse Pokeball | Évolutions Prismatiques 033/131 FR');
        verifier('Poké Ball -> 806448', pokeball.id, 806448);
        verifier('   ... produit distinct', pokeball.strat, 'produit-distinct');
        verifier('   ... confiance haute', pokeball.confiant, true);

        const master = router('masterball', 'Mentali Master Ball 033/131');
        verifier('Master Ball -> 806449', master.id, 806449);

        // Le titre nomme la Master Ball alors que l'IA n'a vu que « des balls » :
        // le titre a priorité sur l'IDENTITÉ du motif (axe où le visuel se trompe).
        const arbitrage = router('ball', 'Mentali MASTERBALL reverse 033/131');
        verifier('titre "masterball" prime sur IA "ball"', arbitrage.id, 806449);
    }

    // --- Test 11 : Rayquaza ASC 153 — pas de Poké Ball sur cette carte ---
    // Le catalogue a le VETO : la carte n'a que friendball et energy. Une lecture
    // "ball" doit donc router vers la Friend Ball, pas inventer une Poké Ball.
    console.log('\n=== Test 11 : Rayquaza ASC 153 (friendball / energy) ===');
    {
        const a = analyserVariantes([
            { type: 'holo', pricing: { cardmarket: { idProduct: 869764 } } },
            { type: 'reverse', foil: 'friendball', pricing: { cardmarket: { idProduct: 870373 } } },
            { type: 'reverse', foil: 'energy', pricing: { cardmarket: { idProduct: 870374 } } },
        ]);
        const lu = m => ({ numero: '153', setCode: 'ASC', rareteElevee: false, regionAttendue: 'occidental',
                           motif: { ...m, strategieParIdProduct: a.strategieParIdProduct } });
        const candidats = [
            { idProduct: 869764, idExpansion: 6395, numeroCardmarket: '153', codeSet: 'ASC',  prix: 0.12, region: 'occidental' },
            { idProduct: 870373, idExpansion: 6455, numeroCardmarket: '153', codeSet: 'xASC', prix: 4.48, region: 'occidental' },
            { idProduct: 870374, idExpansion: 6455, numeroCardmarket: '153', codeSet: 'xASC', prix: 0.16, region: 'occidental' },
        ];
        const ball = resoudreMotif(a, 'ball', 'Rayquaza reverse pokeball ASC 153');
        verifier('« pokeball » au titre -> résolu en Friend Ball (veto)', choisirMeilleur(candidats, lu(ball)).gagnant.candidat.idProduct, 870373);
        const energie = resoudreMotif(a, 'reverse-classique', 'Rayquaza reverse 153');
        verifier('reverse à symboles de type -> 870374', choisirMeilleur(candidats, lu(energie)).gagnant.candidat.idProduct, 870374);
        verifier('   ... produit distinct (pas de filtre)', a.strategieParIdProduct.get(870374), 'produit-distinct');
    }

    // --- Test 12 : Pikachu LOR 052 — la reverse n'est PAS un produit distinct ---
    console.log('\n=== Test 12 : Pikachu LOR 052 (produit partagé) ===');
    {
        const a = analyserVariantes(VD_PIKACHU_LOR);
        const m = resoudreMotif(a, 'reverse-classique', 'Carte Pokémon Pikachu Lost Origin 052/196 reverse');
        const lu = { numero: '052', setCode: 'LOR', rareteElevee: false, regionAttendue: 'occidental',
                     motif: { ...m, strategieParIdProduct: a.strategieParIdProduct } };
        const r = choisirMeilleur([
            { idProduct: 674062, idExpansion: 5093, numeroCardmarket: '052', codeSet: 'LOR', variante: 'V1', prix: 0.27, region: 'occidental' }
        ], lu);
        verifier('gagnant = le produit unique', r.gagnant.candidat.idProduct, 674062);
        verifier('stratégie = filtre d\'URL', r.gagnant.strategie, 'filtre-url');
        verifier('aucun malus de variante', r.gagnant.detail.variante, '0 (variante indéterminée)');
    }

    // --- Test 13 : LES TROIS ÉTATS DU REPLI (garde-fou verrouillé par test) ---
    // Le repli et le drapeau carteIncertaine ne doivent se déclencher QUE sur
    // « la carte A un motif ET il n'est pas résolvable ». JAMAIS sur « pas
    // d'idProduct par variante » : sinon les vieux sets, que le chemin catalogue
    // résout parfaitement, seraient tous marqués incertains -> drapeau vidé de sens.
    console.log('\n=== Test 13 : les 3 états de résolution du motif ===');
    {
        const avecMotifs = analyserVariantes(VD_ESPEON_PRE);
        const sansMotif = analyserVariantes(VD_PIKACHU_LOR);
        // Vieux set : variantes CONNUES mais aucune avec idProduct (pricing au seul
        // niveau carte). C'est le cas des 86 % de cartes hors sets récents.
        const vieuxSet = analyserVariantes([
            { type: 'holo', pricing: null },
            { type: 'holo', pricing: null },
        ]);

        // 1) résolu
        verifier('motif présent et ciblable -> resolu', resoudreMotif(avecMotifs, 'masterball', null).etat, 'resolu');
        // 2) aucun motif : NORMAL et confiant, pas un échec
        verifier('carte sans motif spécial -> aucun-motif', resoudreMotif(sansMotif, 'indetermine', null).etat, 'aucun-motif');
        verifier('vieux set sans idProduct -> aucun-motif', resoudreMotif(vieuxSet, 'reverse-classique', null).etat, 'aucun-motif');
        verifier('   ... et PAS de carte incertaine', resoudreMotif(vieuxSet, 'reverse-classique', null).raison, null);
        verifier('table absente -> aucun-motif', resoudreMotif(analyserVariantes(null), 'ball', null).etat, 'aucun-motif');
        // 3) motif présent mais non résolvable -> repli + carteIncertaine + log
        verifier('IA indéterminée sur carte à motifs -> non-resolu', resoudreMotif(avecMotifs, 'indetermine', null).etat, 'non-resolu');
        verifier('   ... raison', resoudreMotif(avecMotifs, 'indetermine', null).raison, 'ia-indeterminee');
        verifier('conflit IA/titre -> non-resolu', resoudreMotif(avecMotifs, 'aucun', 'Mentali masterball').etat, 'non-resolu');
        verifier('   ... raison', resoudreMotif(avecMotifs, 'aucun', 'Mentali masterball').raison, 'conflit-ia-titre');
        // Motif présent sur la carte mais sans idProduct (le cas "S&V Energy")
        const motifSansId = analyserVariantes([
            { type: 'normal', pricing: { cardmarket: { idProduct: 111 } } },
            { type: 'reverse', foil: 'pokeball', pricing: null },
        ]);
        verifier('motif sans idProduct -> non-resolu', resoudreMotif(motifSansId, 'ball', null).etat, 'non-resolu');
        verifier('   ... raison', resoudreMotif(motifSansId, 'ball', null).raison, 'motif-absent-ou-sans-idproduct');
        // Aucun ciblage -> le critère motif reste totalement inerte
        const inerte = resoudreMotif(avecMotifs, 'indetermine', null);
        verifier('non-resolu => aucun produit visé', inerte.vises.length, 0);
        verifier('non-resolu => aucun veto appliqué', inerte.autresVariantes.length, 0);
    }

    // --- Test 14 : NON-RÉGRESSION sur `total` (secret rare) ---
    // L'IA recopie parfois la fraction entière dans `total`. Prendre le PREMIER groupe
    // de chiffres donnerait le NUMÉRO, donc "numéro == total", ce qui désactive la
    // détection de secret rare — exactement les deux cas ci-dessous.
    console.log('\n=== Test 14 : normalisation de `total` et secret rare ===');
    {
        verifier('"184/182" -> 182', normaliserTotal('184/182').total, '182');
        verifier('"025/165" -> 165', normaliserTotal('025/165').total, '165');
        verifier('"182" inchangé', normaliserTotal('182').total, '182');
        verifier('"TG30" -> 30', normaliserTotal('TG30').total, '30');
        verifier('"SV-P" -> null', normaliserTotal('SV-P').total, null);
        verifier('"SV-P" signalé à l\'appelant', normaliserTotal('SV-P').brutIgnore, 'SV-P');
        verifier('vide -> null', normaliserTotal('').total, null);

        // Roserade 184/182 : le total mal normalisé tuait le critère secret.
        const luRoserade = { numero: 184, total: normaliserTotal('184/182').total, idExpansionAttendu: 6096, rareteElevee: true, regionAttendue: 'occidental' };
        const roserade = choisirMeilleur([
            { idProduct: 826058, idExpansion: 6096, numeroCardmarket: 184, prix: 12.79, region: 'occidental' },
            { idProduct: 825882, idExpansion: 6096, numeroCardmarket: 8, prix: 0.10, region: 'occidental' },
        ], luRoserade);
        verifier('Roserade 184/182 -> l\'IR', roserade.gagnant.candidat.idProduct, 826058);
        verifier('   ... critère secret ACTIF', roserade.gagnant.detail.secret.startsWith('+'), true);

        // Fezandipiti 288/217 : numéro MAL LU (228), c'est le critère secret qui sauve.
        const luFez = { numero: 228, total: normaliserTotal('288/217').total, idExpansionsAttendues: [6395], rareteElevee: true, regionAttendue: 'occidental' };
        const fez = choisirMeilleur([
            { idProduct: 869753, idExpansion: 6395, numeroCardmarket: 142, region: 'occidental' },
            { idProduct: 869899, idExpansion: 6395, numeroCardmarket: 288, region: 'occidental' },
        ], luFez);
        verifier('Fezandipiti 288/217 -> le SIR', fez.gagnant.candidat.idProduct, 869899);
        verifier('   ... critère secret ACTIF', fez.gagnant.detail.secret.startsWith('+'), true);
    }

    // --- Test 15 : Magikarp promo chinois (bug A) ---
    // Deux produits au n°024 : le bon dans un SOUS-SET ("SV-P/CS", encore URL-encodé
    // en base), le mauvais dans un set sans rapport ("CSM2aC") qui décroche le bonus
    // de région japonaise (+45) parce que son code contient une minuscule.
    // Aucun motif ici : c'est le bonus PARTIEL de set qui doit renverser l'écart.
    console.log('\n=== Test 15 : Magikarp promo chinois (sous-set vs set sans rapport) ===');
    {
        const lu = { numero: '024', setCode: 'SV-P', rareteElevee: false, regionAttendue: 'japonais' };
        const { gagnant, scores } = choisirMeilleur([
            // region null : regionDuCodeSet ne classe pas les codes à séparateurs (voir index.js)
            { idProduct: 851878, idExpansion: 6328, numeroCardmarket: '024', codeSet: 'SV-P%2FCS', prix: 0.50, region: null },
            { idProduct: 849438, idExpansion: 6319, numeroCardmarket: '024', codeSet: 'CSM2aC', prix: 0.30, region: 'japonais' },
        ], lu);
        verifier('gagnant = le bon produit SV-P/CS', gagnant.candidat.idProduct, 851878);
        verifier('critère motif inerte (aucune table)', scores[0].detail.motif, '0 (pas de motif ciblé)');
    }

    // --- Test 17 : CHOIX DU CHAMP DE PRIX — les 4 lignes figées ---
    // Vérité de référence : relevés manuels sur Cardmarket (colonne "relevé"), qui
    // disent QUEL CHAMP est le bon. Les montants asservis, eux, sont les valeurs
    // réelles de notre guide_prix (aucun chiffre inventé) : trend et trendHolo sont
    // des tendances, le relevé manuel est un prix d'offre du jour — ils ne coïncident
    // pas au centime, mais ils désignent sans ambiguïté le même champ.
    //
    //                        relevé manuel   trend   trendHolo   champ correct
    //   Espeon masterball        29,07 €      0,50     24,13      trendHolo
    //   Espeon pokeball           1,58 €      2,48      1,66      trendHolo
    //   Rayquaza friendball       1,53 €      4,48      1,34      trendHolo
    //   Espeon COMMUNE            0,26 €      0,17      0,43      trend
    //
    // ⚠️ Le piège corrigé ici : les produits de motif sont des produits DISTINCTS, mais
    // ils ne se vendent QU'EN reverse holo. Choisir le champ d'après la stratégie de
    // lecture ('produit-distinct' -> trend) reproduisait le bug d'origine sur l'autre
    // branche, en sortant la Master Ball à 0,50 € au lieu de 24 €.
    console.log('\n=== Test 17 : champ de prix (reverse -> trendHolo, normale -> trend) ===');
    {
        const G_MASTERBALL = { trend: 0.5, avg: null, avg7: 0.5, avg30: 0.5, trendHolo: 24.13, avgHolo: 25.42 };
        const G_POKEBALL = { trend: 2.48, avg: 2.34, avg7: 1.49, avg30: 1.49, trendHolo: 1.66, avgHolo: 1.72 };
        const G_FRIENDBALL = { trend: 4.48, avg: null, avg7: null, avg30: null, trendHolo: 1.34, avgHolo: null };
        const G_BASE_PRE = { trend: 0.17, avg: 0.25, avg7: 0.21, avg30: 0.19, trendHolo: 0.43, avgHolo: 0.41 };

        verifier('Master Ball (produit distinct) -> trendHolo', prixDeReference(G_MASTERBALL, true), 24.13);
        verifier('Poké Ball (produit distinct) -> trendHolo', prixDeReference(G_POKEBALL, true), 1.66);
        verifier('Friend Ball (produit distinct) -> trendHolo', prixDeReference(G_FRIENDBALL, true), 1.34);
        verifier('COMMUNE (motif aucun) -> trend', prixDeReference(G_BASE_PRE, false), 0.17);
        // Le produit PARTAGÉ suit la même règle : c'est l'impression qui décide.
        verifier('LOR 052 reverse (produit partagé) -> trendHolo', prixDeReference({ trend: 0.27, trendHolo: 10.13 }, true), 10.13);
        verifier('LOR 052 normale -> trend', prixDeReference({ trend: 0.27, trendHolo: 10.13 }, false), 0.27);
        // trendHolo non coté (= 0) : on retombe sur le prix normal plutôt que rien.
        verifier('trendHolo à 0 -> repli sur trend', prixDeReference({ trend: 4.58, trendHolo: 0 }, true), 4.58);
        verifier('trend à 0 -> repli, jamais 0 €', prixDeReference({ trend: 0, avg: null, trendHolo: 21.53 }, false), 21.53);

        // La bascule vient du MOTIF, pas de la stratégie de lecture.
        verifier('motif masterball => impression reverse', impressionEstReverse('masterball', false), true);
        verifier('motif ball => impression reverse', impressionEstReverse('ball', false), true);
        verifier('motif reverse-classique => reverse', impressionEstReverse('reverse-classique', false), true);
        verifier('motif aucun => PAS reverse', impressionEstReverse('aucun', true), false);
        verifier('aucune cible => on suit la lecture IA', impressionEstReverse(null, true), true);
        verifier('aucune cible, pas de reverse lue => normale', impressionEstReverse(null, false), false);
    }

    // --- Test 18 : critère prix NEUTRALISÉ sur les promos (bug A) ---
    // Prix réels de guide_prix : le BON produit (851878, promo chinoise SV-P/CS) cote
    // 114,80 € — le prix Vinted de 115 € était donc correct — et le mauvais 0,29 €.
    // L'hypothèse "carte non-rare => prix bas" offrait +25 au mauvais candidat.
    console.log('\n=== Test 18 : promo -> le prix ne juge plus la rareté ===');
    {
        const candidats = [
            { idProduct: 851878, idExpansion: 6328, numeroCardmarket: '024', codeSet: 'SV-P%2FCS', prix: 114.8, region: null },
            { idProduct: 849438, idExpansion: 6319, numeroCardmarket: '024', codeSet: 'CSM2aC', prix: 0.29, region: 'japonais' },
        ];
        const base = { numero: '024', setCode: 'SV-P', rareteElevee: false, regionAttendue: 'japonais' };

        const sansPromo = choisirMeilleur(candidats, base);
        verifier('sans le correctif : le MAUVAIS produit gagne', sansPromo.gagnant.candidat.idProduct, 849438);

        const avecPromo = choisirMeilleur(candidats, { ...base, rarete: 'promo' });
        verifier('rarete=promo : le BON produit gagne', avecPromo.gagnant.candidat.idProduct, 851878);
        verifier('   ... critère prix neutralisé', avecPromo.scores[0].detail.prix, '0 (promo : le prix ne dit rien de la rareté)');
        // Marge : elle repose entièrement sur setPartiel (voir la note de sensibilité).
        verifier('   ... marge de 10 points', avecPromo.scores[0].score - avecPromo.scores[1].score, 10);
    }

    // --- Test 19 : le TOTAL comme discriminant de SET (cas Dana lue "Kahili") ---
    // Tailles officielles RÉELLES relevées sur TCGdex (/v2/en/sets).
    console.log('\n=== Test 19 : le total restreint les sets ===');
    {
        const SETS = [   // extrait réel, champs tels que TCGdex les renvoie
            { id: 'sm9', name: 'Team Up', cardCount: { official: 181, total: 196 } },
            { id: 'sm8', name: 'Lost Thunder', cardCount: { official: 214, total: 240 } },
            { id: 'sm7', name: 'Celestial Storm', cardCount: { official: 168, total: 183 } },
            { id: 'tk-hs-r', name: 'HS Trainer Kit (Raichu)', cardCount: { official: 30, total: 30 } },
            { id: 'tk-hs-g', name: 'HS Trainer Kit (Gyarados)', cardCount: { official: 30, total: 30 } },
        ];
        const ids = t => setsCompatiblesAvecTotal(SETS, t).map(s => s.id).join(',');
        verifier('total 181 -> Team Up SEUL', ids(181), 'sm9');
        verifier('   ... Lost Thunder (214) exclu', setsCompatiblesAvecTotal(SETS, 181).some(s => s.id === 'sm8'), false);
        verifier('total 214 -> Lost Thunder', ids(214), 'sm8');
        // Le total ne doit PAS prétendre trancher là où il est faible : 18 sets réels
        // font exactement 30 cartes (trainer kits). On les renvoie tous, l'appelant
        // décidera que c'est trop peu discriminant.
        verifier('total 30 -> plusieurs sets (discriminant faible)', ids(30), 'tk-hs-r,tk-hs-g');
        verifier('total absent -> aucune restriction', setsCompatiblesAvecTotal(SETS, null).length, 0);
        verifier('total inconnu -> aucune restriction', setsCompatiblesAvecTotal(SETS, 999).length, 0);
        // "196" est le total AVEC les secrètes : il n'est pas au dénominateur imprimé.
        verifier('total avec secrètes non retenu', setsCompatiblesAvecTotal(SETS, 196).length, 0);
    }

    // --- Test 20 : comparaison de numéros à PRÉFIXE (collisions réelles) ---
    // Cas mesurés en base : l'expansion 3630 contient "SV14" ET "14" ; l'expansion 4361
    // contient "001C", "001L", "001P", "001M" — apparier sur les chiffres seuls y
    // ramènerait plusieurs produits indistinguables.
    console.log('\n=== Test 20 : numéros à préfixe et collisions ===');
    {
        verifier('"173" vs "173" -> exact', comparerNumeros('173', '173'), 'exact');
        verifier('"TG09" vs "TG09" -> exact', comparerNumeros('TG09', 'TG09'), 'exact');
        verifier('"TG9" vs "TG09" -> exact (zéro de tête)', comparerNumeros('TG9', 'TG09'), 'exact');
        verifier('"SV14" vs "14" -> chiffres seulement', comparerNumeros('SV14', '14'), 'chiffres');
        verifier('"14" vs "SV14" -> chiffres seulement', comparerNumeros('14', 'SV14'), 'chiffres');
        verifier('"001C" vs "001L" -> chiffres seulement', comparerNumeros('001C', '001L'), 'chiffres');
        verifier('"173" vs "174" -> aucune', comparerNumeros('173', '174'), null);
        verifier('numéro absent -> aucune', comparerNumeros(null, '173'), null);
        // ⚠️ La normalisation en chiffres reste STRICTEMENT celle du critère numéro et
        // de l'extension : toute divergence recréerait un bug de prix.
        verifier('chiffres de "TG09" == chiffres de "9"', chiffresDuNumero('TG09'), chiffresDuNumero('9'));

        // --- RANGS. Trois états, la nuance étant entre « inconnu » et « contredit ».
        // Mesurés en production par le journal des scans AVANT d'en faire un critère de
        // classement : c'est la fréquence réelle du rang 3 qui dira si le mécanisme sert.
        verifier('lu 173, candidat 173 -> rang 1', rangDuNumero('173', '173'), 1);
        verifier('lu 14, candidat "SV14" -> rang 1 (chiffres suffisent)', rangDuNumero('14', 'SV14'), 1);
        verifier('lu 173, candidat inconnu -> rang 2', rangDuNumero('173', null), 2);
        verifier('lu 173, candidat "" -> rang 2 (vide == inconnu)', rangDuNumero('173', ''), 2);
        verifier('lu 173, candidat 174 -> rang 3 (contredit)', rangDuNumero('173', '174'), 3);
        verifier('rien lu -> pas de rang', rangDuNumero(null, '173'), null);
        verifier('lu vide -> pas de rang', rangDuNumero('  ', '173'), null);
        // Le cas Scizor : le numéro lu (074) contre un candidat occidental n°074 d'un
        // autre set reste rang 1 — le rang ne remplace pas le critère set, il l'assiste.
        verifier('lu 074, candidat 074 d\'un autre set -> rang 1', rangDuNumero('074', '74'), 1);
    }

    // --- Test 22 : numéro déduit du SLUG (code de set collé au numéro) ---
    // Tous les slugs ci-dessous sont RÉELS, relevés dans numeros_cartes, avec leur
    // vrai codeSet et le `numero` du titre qui sert d'arbitre. L'ancienne règle
    // (/(\d+)$/) se trompait sur 28,4 % des 6854 documents témoins ; celle-ci sur 0,2 %.
    console.log('\n=== Test 22 : numéro déduit du slug Cardmarket ===');
    {
        // Cas nominal : le code se détache proprement.
        verifier('"Rotom-mC248" + code mC -> 248', numeroDepuisSlug('Rotom-mC248', 'mC'), '248');
        // Code à suffixe numérique COLLÉ au numéro — l'ancienne règle rendait 100340.
        verifier('"Porygon-Z-sI100340" + code sI100 -> 340', numeroDepuisSlug('Porygon-Z-sI100340', 'sI100'), '340');
        // Un seul chiffre de code, un seul de numéro : l'ancienne règle rendait 21.
        verifier('"Alakazam-B21" + code B2 -> 1', numeroDepuisSlug('Alakazam-B21', 'B2'), '1');
        verifier('"Mewtwo-B210" + code B2 -> 10', numeroDepuisSlug('Mewtwo-B210', 'B2'), '10');
        // Marqueur de VARIANTE final : ce n'est pas un numéro. Ancienne règle : 3.
        verifier('"Mewtwo-V-UNION-V3" -> null (V3 = variante)', numeroDepuisSlug('Mewtwo-V-UNION-V3', 'SWSH'), null);
        // Le niveau des vieilles cartes n'est pas un numéro non plus.
        verifier('"Pikachu-Lv12-EP08" + code EP08 -> null', numeroDepuisSlug('Pikachu-Lv12-EP08', 'EP08'), null);
        // Slug qui s'arrête au code : rien à extraire, on s'abstient.
        verifier('"Arcanine-Lv48-DP3" + code DP3 -> null', numeroDepuisSlug('Arcanine-Lv48-DP3', 'DP3'), null);
        verifier('"Moo-Moo-Milk-N1" + code N1 -> null', numeroDepuisSlug('Moo-Moo-Milk-N1', 'N1'), null);
        // Numéro dans son propre segment : le code n'y est pas, on prend tel quel.
        verifier('"Flygon-Lv65-WCD09RR-005" -> 005', numeroDepuisSlug('Flygon-Lv65-WCD09RR-005', 'WCD09'), '005');
        // Remplissage à zéro : ce n'est pas un numéro de carte.
        verifier('"Raichu-Lv46-V2-AR000" + code AR -> null', numeroDepuisSlug('Raichu-Lv46-V2-AR000', 'AR'), null);
        // Pas de numéro du tout (les Code Card, avant qu'on les écarte du vivier).
        verifier('"Online-Code-Card-Hoopa-V-Box" -> null', numeroDepuisSlug('Online-Code-Card-Hoopa-V-Box', 'PKM'), null);
        // Code inconnu : on ne détache rien, mais on ne renvoie pas n'importe quoi.
        verifier('"Rotom-mC248" sans code -> null (MC248 ne commence pas par un chiffre)', numeroDepuisSlug('Rotom-mC248', null), null);
        verifier('slug vide -> null', numeroDepuisSlug('', 'ABC'), null);
        verifier('slug absent -> null', numeroDepuisSlug(null, 'ABC'), null);
    }

    // --- Test 21 : RÉGRESSION Dana/Kahili — nom faux mais plausible ---
    // L'IA a lu "Kahili" au lieu de "Dana" : un nom qui EXISTE, mais dans Lost Thunder.
    // Numéro et total étaient justes (173/181). Team Up est le seul set à 181 cartes,
    // et son expansion Cardmarket est 2407. Tous les produits "Kahili" réels sont
    // ailleurs (2370, 3324, 3876, 6329, 6581) : restreindre à l'expansion du total
    // suffit à les écarter tous. Prix issus de guide_prix, aucun inventé.
    console.log('\n=== Test 21 : régression Dana 173/181 lue "Kahili" ===');
    {
        const lu = {
            numero: '173', total: '181', rareteElevee: true, regionAttendue: 'occidental',
            idExpansionsAttendues: [2407]   // déduit du total 181 -> sm9 -> exp 2407
        };
        const candidats = [
            // le BON produit, atteint par le numéro dans l'expansion du total
            { idProduct: 369098, idExpansion: 2407, numeroCardmarket: '173', codeSet: 'TEU', variante: 'V2', prix: 92.02, region: 'occidental' },
            // les "Kahili" réels du catalogue, tous hors de l'expansion attendue
            { idProduct: 365814, idExpansion: 2370, numeroCardmarket: '179', codeSet: 'LOT', prix: 0.30, region: 'occidental' },
            { idProduct: 365843, idExpansion: 2370, numeroCardmarket: '210', codeSet: 'LOT', prix: 1.20, region: 'occidental' },
            { idProduct: 558943, idExpansion: 3876, numeroCardmarket: '055', codeSet: 'sm7a', prix: 0.50, region: 'japonais' },
        ];
        const { gagnant, confiant } = choisirMeilleur(candidats, lu);
        verifier('gagnant = Dana TEU 173', gagnant.candidat.idProduct, 369098);
        verifier('   ... et non le Kahili retenu avant (365843)', gagnant.candidat.idProduct !== 365843, true);
        verifier('   ... confiance haute', confiant, true);
    }

    // --- Test 22 : non-régression — sans motif ciblé, rien ne bouge ---
    console.log('\n=== Test 16 : aucun motif ciblé -> critères motif et variante inertes ===');
    {
        const lu = { numero: 153, rareteElevee: false, regionAttendue: 'occidental' };
        const { scores, strategieReverse } = choisirMeilleur([
            { idProduct: 870373, idExpansion: 6455, numeroCardmarket: '153', codeSet: 'xASC', variante: 'V1', prix: 1.53, region: 'occidental' },
            { idProduct: 870374, idExpansion: 6455, numeroCardmarket: '153', codeSet: 'xASC', variante: 'V2', prix: 0.35, region: 'occidental' },
        ], lu);
        verifier('aucune stratégie annoncée', strategieReverse, null);
        verifier('scores égaux', scores[0].score, scores[1].score);
        verifier('le moins cher en tête (décision B)', scores[0].candidat.idProduct, 870374);
    }

    console.log(`\n${echecs === 0 ? '🎉 Tous les tests passent.' : `⚠️ ${echecs} test(s) en échec.`}`);
    process.exit(echecs === 0 ? 0 : 1);
}
