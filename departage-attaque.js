// ============================================================================
// LE DÉPARTAGE PAR L'ATTAQUE — même forme que `departagerParSymbole`
// ============================================================================
// POURQUOI IL EXISTE. Mesuré le 2026-09-05 sur les 89 lignes du banc : 45 produisent une
// égalité parfaite au sommet du scoring. Sur ces 45 :
//     · 16 groupes réunissent des `idMetacard` DIFFÉRENTS  -> l'attaque peut trancher ;
//     · 29 groupes sont entièrement dans la MÊME métacarte -> aucune lecture ne le pourra.
// Et là où ça décide vraiment : la vérité est dans le groupe 12 fois sur 45, et l'attaque
// isolerait un candidat UNIQUE 10 fois sur 12.
// Le cas qui a ouvert la piste est Ho-Oh n°250 : `654129` (« Rainbow Burn », métacarte
// 266314) et `274593` (« Stoke | Sacred Fire | Dive Bomb », métacarte 212454) ne sont pas
// deux impressions d'une même carte — ce sont deux CARTES, et l'attaque est imprimée dessus.
//
// ⚠️ CE N'EST PAS UNE INVENTION, C'EST UNE COPIE. La forme est celle de
// `departagerParSymbole` (sets-vintage-japonais.js), mesurée 12/12 en production : quatre
// verrous, un avis rendu, AUCUN score touché, et une phrase rendue MÊME quand il ne tranche
// pas. Ce qui change est la source du signal, pas la mécanique.
//
// ════════════════════════════════════════════════════════════════════════════
// 🔑 ON TRANCHE SUR `idMetacard`, ON CHERCHE PAR LE NOM D'ATTAQUE
// ════════════════════════════════════════════════════════════════════════════
// `idMetacard` est présent sur 73 188 produits sur 73 188 (100 %, mesuré) et c'est LUI que
// Cardmarket utilise pour dire « Reprints: Show Versions ». Deux produits de la même
// métacarte sont la même carte imprimée ailleurs ; deux métacartes sont deux cartes.
// La chaîne « [Rainbow Burn] » sert seulement à savoir QUELLE métacarte viser. La décision,
// elle, porte sur l'identifiant — jamais sur une comparaison de texte entre deux produits.
//
// ════════════════════════════════════════════════════════════════════════════
// 🔑 COMMENT ON BORNE UNE RÉPONSE LIBRE — le point dur, et il est déjà résolu ailleurs
// ════════════════════════════════════════════════════════════════════════════
// `symboleSet` est une énumération FERMÉE : le prompt liste les valeurs, et une valeur hors
// liste est un défaut. L'attaque ne peut pas l'être — il en existe des milliers, et la
// prochaine extension en ajoutera. On ne borne donc PAS la réponse, ON BORNE CE QU'ELLE DOIT
// RENCONTRER : une attaque lue qui ne correspond à aucun candidat ne prouve rien, une qui en
// désigne plusieurs ne départage rien. Dans les deux cas on se tait.
// 🔑 C'EST LE CATALOGUE QUI FERME L'ÉNUMÉRATION, A POSTERIORI. Une réponse libre inventée
// par le modèle ne peut pas produire un faux départage : pour tromper, elle devrait tomber
// EXACTEMENT sur le nom d'attaque d'un et un seul candidat du groupe. Le risque n'est pas
// nul, il est borné par la même jointure qui rend le signal utile.
//
// ⚠️ ET LA LECTURE NON LATINE — レインボーバーン CONTRE « Rainbow Burn »
// Les noms du catalogue sont ANGLAIS (« Ho-Oh [Rainbow Burn] »). Une carte japonaise porte
// レインボーバーン. Aucune comparaison de chaînes ne les rapprochera, et translittérer
// nous-mêmes serait réinventer un dictionnaire que nous n'avons pas.
// 🔑 LA SORTIE EST CELLE QUI EST DÉJÀ EN PRODUCTION POUR LE NOM DE LA CARTE, et elle est
// mesurée : le prompt demande DEUX champs — `nomBrut` (tel qu'imprimé, katakana) et `name`
// (l'anglais officiel, « translittérer PUIS traduire »), plus `nomConfiance`. On copie
// exactement ça : `attaqueBrute` / `attaque` / `attaqueConfiance`.
//   · c'est le MODÈLE qui translittère, pas nous — il le fait déjà pour ワンリキー = Machop ;
//   · s'il lit les katakana mais ne sait pas les rendre en anglais, il met `attaque` à null
//     et on s'abstient. Une translittération douteuse ne doit jamais devenir un départage ;
//   · `attaqueConfiance: 'basse'` vaut abstention, au même titre que `null`.
// ⚠️ CE QUE ÇA NE COUVRE PAS, ET IL FAUT LE DIRE : si le modèle translittère MAL vers un nom
// d'attaque qui existe chez un autre candidat du groupe, le verrou 2 ne le verra pas — il
// comptera un seul correspondant, et ce sera le mauvais. C'est le risque résiduel de ce
// dispositif, il n'est pas mesuré, et c'est pour ça que la sortie reste une SUGGESTION.
// ============================================================================

/**
 * Normalise un nom d'attaque avant comparaison : casse, espaces, tirets, apostrophes et
 * ponctuation sautent. On ne touche PAS aux caractères non latins — s'ils arrivent ici,
 * ils ne matcheront rien, et c'est le comportement voulu (abstention, pas rapprochement).
 */
function normaliserAttaque(s) {
    return String(s ?? '')
        .toLowerCase()
        .replace(/[\s\-'’.,!:&()]/g, '');
}

/**
 * Les attaques d'un produit, lues dans son `name` Cardmarket.
 * Forme : « Ho-Oh [Stoke | Sacred Fire | Dive Bomb] » -> ['stoke','sacredfire','divebomb'].
 * Un nom sans crochets rend [] — 24,4 % du catalogue est dans ce cas (mesuré), et une
 * absence n'est PAS une non-correspondance : voir le verrou 4.
 */
function attaquesDe(nomProduit) {
    const m = String(nomProduit ?? '').match(/\[([^\]]+)\]\s*$/);
    if (!m) return [];
    return m[1].split('|').map(normaliserAttaque).filter(Boolean);
}

/**
 * Départage une égalité par l'attaque lue sur la photo.
 *
 * @param {string|null} attaqueLue        `cardInfo.attaque` — le nom ANGLAIS rendu par l'IA
 * @param {string|null} attaqueConfiance  'haute' | 'moyenne' | 'basse' | null
 * @param {Array} exAequo   [{ idProduct, name, idMetacard }] — les ex aequo AU SENS DU SCORING
 * @returns {{gagnant: object|null, raison: string}}
 *
 * ⚠️ NE MODIFIE AUCUN SCORE ET NE RÉORDONNE RIEN. Elle rend un AVIS ; c'est l'appelant qui
 * choisit, exactement comme pour le symbole. Et elle rend TOUJOURS une `raison`, même quand
 * elle ne tranche pas : sans cette phrase au journal, « l'attaque n'a pas départagé » serait
 * indistinguable de « il n'y avait pas d'égalité ».
 */
function departagerParAttaque(attaqueLue, attaqueConfiance, exAequo) {
    // ── VERROU 1 — rien sans lecture EXPLICITE ───────────────────────────────
    const lu = String(attaqueLue ?? '').trim();
    if (!lu) {
        return { gagnant: null, raison: 'aucune attaque lue — rien à départager' };
    }
    if (String(attaqueConfiance ?? '').toLowerCase() === 'basse') {
        return { gagnant: null, raison: `attaque « ${lu} » lue en confiance BASSE — on ne départage pas dessus` };
    }
    if (!Array.isArray(exAequo) || exAequo.length < 2) {
        return { gagnant: null, raison: 'moins de deux ex aequo — rien à départager' };
    }

    // ── VERROU 3 — jamais si tout le groupe est la MÊME carte ────────────────
    // Mesuré : 29 groupes sur 45 sont dans ce cas. L'attaque y est IDENTIQUE sur tous les
    // candidats ; « un seul la porte » y serait faux par construction, et un départage y
    // désignerait une impression au hasard. C'est la population de l'image et du symbole.
    const metacartes = new Set(exAequo.map(c => c?.idMetacard).filter(v => v != null));
    if (metacartes.size <= 1) {
        return {
            gagnant: null,
            raison: `attaque « ${lu} » lue, mais les ${exAequo.length} ex aequo sont la MÊME carte`
                + ` (métacarte ${[...metacartes][0] ?? 'inconnue'}) — l'attaque ne dit rien ici`
        };
    }

    // ── VERROU 4 — un candidat sans attaque connue n'est PAS un candidat écarté ──
    // Même principe que `s.symbole == null` chez le symbole : on ne pénalise pas une donnée
    // absente. Un produit dont le `name` ne porte pas de crochets ne correspond simplement
    // pas ; il reste dans le groupe et empêchera le départage s'il était le bon.
    const cible = normaliserAttaque(lu);
    const correspondants = exAequo.filter(c => attaquesDe(c?.name).includes(cible));

    // ── VERROU 2 — exactement UN, sinon on se tait ───────────────────────────
    if (correspondants.length === 1) {
        const g = correspondants[0];
        return {
            gagnant: g,
            raison: `attaque « ${lu} » lue, et ${g.idProduct} (métacarte ${g.idMetacard}) est le SEUL ex aequo à la porter`
        };
    }
    if (correspondants.length === 0) {
        return {
            gagnant: null,
            raison: `attaque « ${lu} » lue, mais aucun des ${exAequo.length} ex aequo ne la porte — elle ne prouve rien ici`
        };
    }
    return {
        gagnant: null,
        raison: `attaque « ${lu} » lue, mais ${correspondants.length} ex aequo la portent`
            + ` (${correspondants.map(c => c.idProduct).join(', ')}) — elle ne départage pas`
    };
}

module.exports = { departagerParAttaque, attaquesDe, normaliserAttaque };
