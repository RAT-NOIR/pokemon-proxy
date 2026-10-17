'use strict';
// LANGUE-DECISIVE (2026-10-17, nuit) — ce que la PHOTO dit (langue du texte, illustration, attaque, code) tranche une QUESTION de la garde contradiction ou des jumeaux, à 0 faux.
// Cas fondateur du testeur : « わるいバンギラス » 144/103, annonce « Tyranitar sombre 143/103 m6a » ; la chaîne affirme l'impression chinoise simplifiée, la garde pose une question à trois ; la bonne réponse est l'impression japonaise.
// Module PUR (ni base, ni réseau, ni modèle). Aucune règle recopiée (§21 bis) : la compatibilité langue/tirage est `garde-contradiction.langueCompatible` (UNE fonction, étendue), la concordance du numéro
// et du code est `seconde-lecture.comparer`, l'attaque est `garde-contradiction.statuts`, le nom est `nom-compatible.nomCompatible`.
// 🔑 Écrit par ce qu'il AUTORISE : un candidat n'est retiré que par une règle ALLUMÉE, sur une donnée CONNUE des deux côtés ; au moindre doute rien n'est retiré. Si tous les candidats seraient retirés,
// la question d'origine reste (on n'invente jamais une absence). Chaque règle porte sa constante et son compteur ; chacune a été MESURÉE seule puis combinée sur tout le banc étiqueté
// (lot-LANGUE-DECISIVE-report.md) : une règle qui crée un seul faux reste ÉTEINTE, et c'est écrit ici.
const S = require('../../scoring');
const { lectureDe, statuts, contredire, langueCompatible, VIVIER_MAX } = require('./garde-contradiction');
const { comparer } = require('./seconde-lecture');
const { idsAffirmes } = require('./jumeaux');

// ÉTAT LIVRÉ DES RÈGLES (`ctx.langueDecisive` les surcharge pour les bancs et la mesure). Mesuré le 2026-10-17 sur les 320 cartes du banc étiqueté (rm_essai, lecture) par le VRAI chemin :
//   R1 ALLUMÉE  : 0 faux, 0 vérité retirée, 4 questions réduites de 3 à 2 (les trois Dark Tyranitar du testeur et une quatrième) ; aucun sûr à elle seule.
//   R4 ALLUMÉE  : 0 faux, +14 sûrs justes (Trainer Gallery « TG », Magneton, séries SV…), 0 perdu, 0 produit changé.
//   R2 ÉTEINTE  : 0 faux avec deux seuils, +1 sûr seule, +3 avec R4 — mais la photo et les vecteurs ne sont pas encore fournis à l'adaptateur par la route (ctx.scoresImage), et la calibration tient sur 153 lignes ;
//                 allumée sans score elle ne ferait rien. Elle s'allume ici le jour où la route l'alimente (un lot à part).
//   R2 bis ÉTEINTE : 0 faux mais aucun sûr de plus que R1 + R2 (elle réduit une question de 3 à 2) ; « Crush » contredit aussi la vraie carte du cas fondateur ; la garde dit « l'attaque est une contradiction, pas un veto ».
//   R5 ALLUMÉE  (tour de correction 1) : un candidat d'un set SANS numérotation est retiré quand le numéro et le total sont lus et qu'un autre candidat hors liste a un total concordant ; liste FIGÉE ci-dessous.
//   Tour de correction 1 : la résolution d'un candidat SEUL applique TOUTES les conditions du critère A (`critere-a.conditions`) et la garde des jumeaux du candidat ; R4 se juge sur le CATALOGUE ENTIER (code × numéro).
const REGLES = Object.freeze({ R1: true, R2: false, R2BIS: false, R4: true, R5: true });
// R5 — LES SETS SANS NUMÉROTATION, liste FIGÉE (jamais calculée à l'exécution), en idExpansion Cardmarket, 9 sets. Preuve : expansions dont 100 % des produits (hors cartes-code) sont sans numéro au catalogue (numero ET numeroUrl
// nuls) ET dont l'archive Bulbapedia ne porte AUCUN numéro jp (0 page manquante, témoin contrôlé sur ADV1, PCG1, PCG2 : VERIF-R5-SETS-SANS-NUMERO.md). Un set non prouvé SORT de la liste ; un set nouveau n'y entre jamais seul.
// EXCLUS (décision du coordinateur, 2026-10-18) : DP2 (4317), DP4d (4308), DP4m (4309), HRDK (4303) et EP08 (4306). Les cartes Pokémon des sets DP impriment en bas à droite un « DPBP#nnn » (Remoraid DPBP#280, Magmortar
// DPBP#150, vus sur les scans) : un numéro imprimé qui n'est pas un numéro de collection, que la lecture peut prendre pour un numéro ; et l'absence de numéro chez Bulbapedia y est moins sûre (HRDK, EP08 non prouvés
// à l'œil). R5 se déclenche en plus SEULEMENT sur un numéro au format collection : numéro ET total lus (un numéro seul, comme 280, ne déclenche jamais R5).
const SANS_NUMEROTATION = Object.freeze([
    { idExpansion: 4169, nom: 'Expansion Pack (EXP)' }, { idExpansion: 4465, nom: 'Rocket Gang (ROG)' }, { idExpansion: 4463, nom: 'Pokémon Jungle (PJU)' },
    { idExpansion: 4464, nom: 'Mystery of the Fossils (MFO)' }, { idExpansion: 4357, nom: 'Southern Islands JP (SI-JP)' }, { idExpansion: 4506, nom: 'Gold, Silver, to a New World... (N1)' },
    { idExpansion: 4507, nom: 'Crossing the Ruins... (N2)' }, { idExpansion: 4508, nom: 'Awakening Legends (N3)' }, { idExpansion: 4509, nom: 'Darkness, and to Light... (N4)' }
].map(x => Object.freeze(x)));const SANS_NUMEROTATION_IDS = new Set(SANS_NUMEROTATION.map(x => x.idExpansion));
// S de la R2, en inliers ORB/RANSAC (departage-image.js, la fonction de la route), fixé sur le banc (mesure : lot-LANGUE-DECISIVE-report.md). UN SEUL SEUIL NE TIENT PAS : la photo entière contre une vignette de
// 270 px donne 0 inlier à la vraie carte sur ~12 % des lignes et jusqu'à 39 à une AUTRE carte (aucun S entre 8 et 35 ne laisse la vérité en place). La règle a donc DEUX seuils :
//   un candidat est retiré s'il est RECONNU PAR PERSONNE (score <= BAS) ET qu'un autre candidat de la question est RECONNU NETTEMENT (score >= HAUT) ;
//   BAS = 4, HAUT = 20 : sur les 153 lignes-question du banc dont la vérité est parmi les choix, le plus haut score d'un autre candidat à côté d'une vérité <= 4 est 6 ; HAUT est 14 au-dessus (marge nommée : 14 inliers).
const SEUIL_IMAGE = Object.freeze({ bas: 4, haut: 20 });

const compte = { jugees: 0, retraits: { R1: 0, R2: 0, R2BIS: 0, R5: 0 }, tousRetires: 0, affirmees: 0, nonAffirmables: 0 };
const compteurs = () => ({ ...compte, retraits: { ...compte.retraits } });

const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);

// ── la LANGUE LUE avec certitude : la langue du modèle ET l'écriture du nom brut concordent (par ce qui est AUTORISÉ ; le reste est « pas certain »)
const KANA = /[぀-ヿㇰ-ㇿ]/, HANGUL = /[ᄀ-ᇿ가-힯]/, HAN = /[㐀-䶿一-鿿]/, CYRILLIQUE = /[Ѐ-ӿ]/, LATIN = /[A-Za-zÀ-ɏ]/;
const ECRITURES = { ja: ['JP'], ko: ['KR'], zh: ['ZH'], ru: ['RU'], latin: ['EN', 'FR', 'DE', 'ES', 'IT', 'PT', 'NL', 'PL', 'CS', 'HU'] };
function ecritureDe(nomBrut) {
    const n = texte(nomBrut);
    if (!n) return null;
    if (KANA.test(n)) return 'ja';
    if (HANGUL.test(n)) return 'ko';
    if (HAN.test(n)) return 'zh';
    if (CYRILLIQUE.test(n)) return 'ru';
    if (LATIN.test(n)) return 'latin';
    return null;
}
const normLangue = x => { const l = texte(x) ? x.trim().toUpperCase() : null; return l === 'JA' ? 'JP' : l === 'KO' ? 'KR' : l && /^ZH(-|$)/.test(l) ? 'ZH' : l; };
/** { famille: 'ja'|'ko'|'zh'|'ouest', code } | null. `code` : le code fermé de l'extension (fr en de es it pt nl pl ru cs hu ja ko zh-hans zh-hant) ; null quand il ne se lit pas (le chinois : la variante ne se lit pas). */
function langueCertaine({ langue, nomBrut } = {}) {
    const l = normLangue(langue), e = ecritureDe(nomBrut);
    if (!l || !e || !ECRITURES[e].includes(l)) return null;
    if (e === 'ja') return { famille: 'ja', code: 'ja' };
    if (e === 'ko') return { famille: 'ko', code: 'ko' };
    if (e === 'zh') return { famille: 'zh', code: null };
    return { famille: 'ouest', code: l.toLowerCase() };
}
const LEGACY = { ja: 'JP', ko: 'KR', zh: 'ZH' };

/** Le code fermé de la langue d'un TIRAGE (contrat 7a, `impressions[].langue`) : jamais deviné — `intl` (plusieurs langues), `id`, `th`, `idth` et tout le reste : null. */
function langueDeTirage(tirage) {
    const t = texte(tirage) ? tirage.trim().toLowerCase() : null;
    return t === 'jp' ? 'ja' : t === 'zh-hans' || t === 'zh-hant' || t === 'ko' ? t : null;
}

/**
 * L'INDEX code × numéro du CATALOGUE ENTIER (M2). Entrée : des lignes { codeSet, numero, numeroUrl } (numeros_cartes). Clé : les chiffres du numéro (scoring.chiffresDuNumero) ; valeur : les codes de set normalisés.
 * `existe(setCode, numero)` : un produit du catalogue porte-t-il ce code (concordance de `seconde-lecture.comparer`, la définition de la production) ET ce numéro (mêmes chiffres : plus large que « exact »,
 * donc plus BLOQUANT) ? Taille : une chaîne courte par couple (chiffres, code) distinct (~ quelques dizaines de milliers de couples, quelques Mo).
 */
function creerIndexCodeNumero(lignes) {
    const parChiffres = new Map();
    let taille = 0;
    for (const l of (lignes || [])) {
        const code = l && texte(l.codeSet) ? S.normaliserCodeSet(l.codeSet) : null;
        const num = l ? (texte(l.numero == null ? null : String(l.numero)) || texte(l.numeroUrl == null ? null : String(l.numeroUrl))) : null;
        const k = num ? S.chiffresDuNumero(num) : null;
        if (!code || !k) continue;
        if (!parChiffres.has(k)) parChiffres.set(k, new Set());
        const codes = parChiffres.get(k);
        if (!codes.has(code)) { codes.add(code); taille++; }
    }
    return {
        taille,
        existe(setCode, numero) {
            const num = numero == null ? null : texte(String(numero));
            const k = num ? S.chiffresDuNumero(num) : null;
            if (!texte(setCode) || !k) return false;
            const codes = parChiffres.get(k);
            if (!codes) return false;
            for (const ec of codes) if (comparer({ numero: num, setCode }, { numero: num, set: { code: ec } }).concorde.includes('code')) return true;
            return false;
        }
    };
}

// ── R4 : le code lu ne désigne AUCUN produit — ni du vivier (« s8a-P » pris pour le logo des 25 ans), ni du CATALOGUE ENTIER avec ce numéro (M2 : un code bien lu qui désigne la vraie carte hors du vivier BLOQUE).
// Écrit par ce qui est AUTORISÉ : le code ET le numéro sont lus, le vivier est connu et ENTIÈREMENT chargé, et l'index du catalogue (`catalogueExiste`) est fourni et répond FAUX franc. Index absent ou qui lève : fermée.
function codeSansDesignation({ corps, produits, catalogueExiste } = {}) {
    const lu = lectureDe(corps);
    if (!lu || !texte(lu.setCode) || !texte(lu.numero) || typeof catalogueExiste !== 'function' || !(produits instanceof Map) || !lu.vivierIds.length || lu.vivierIds.length > VIVIER_MAX) return false;
    if (lu.vivierIds.some(id => !produits.has(id))) return false;
    if (lu.vivierIds.some(id => comparer({ numero: lu.numero, setCode: lu.setCode }, produits.get(id)).concorde.includes('code'))) return false;
    try { return catalogueExiste(lu.setCode, lu.numero) === false; } catch { return false; }
}

/** Les candidats qu'une réduction pourrait LAISSER SEULS (la route charge leurs jumeaux avant l'adaptation) : ceux que la garde contradiction désigne à côté du produit affirmé. [] si rien ne contredit. */
function candidatsDeReduction({ corps, produits } = {}) {
    try {
        const w = idsAffirmes(corps)[0];
        if (!Number.isInteger(w) || !(produits instanceof Map)) return [];
        const g = contredire({ corps, gagnant: w, produits });
        return g ? g.designe.map(d => d.idProduct).filter(Number.isInteger) : [];
    } catch { return []; }
}

/**
 * Retire de `ids` les candidats que la photo écarte. @returns { ids, retires: [{ id, regle }] } ; si tous seraient retirés : { ids (d'origine), retires: [] }.
 * `scoresImage` : Map<idProduct, inliers> de la photo contre le visuel de chaque candidat (departage-image.js::inliers), ABSENTE ou incomplète : R2 ne juge pas les absents.
 */
function reduire({ ids, corps, produits, regles = REGLES, scoresImage = null } = {}) {
    const origine = Array.isArray(ids) ? ids.slice() : [];
    const rien = { ids: origine, retires: [] };
    const lu = lectureDe(corps);
    if (!lu || !(produits instanceof Map) || origine.length < 2) return rien;
    compte.jugees++;
    let restants = origine.slice();
    const retires = [];
    const retirer = (id, regle) => { restants = restants.filter(i => i !== id); retires.push({ id, regle }); };
    if (regles.R1) {
        const c = langueCertaine({ langue: lu.langue, nomBrut: corps && corps.carte && corps.carte.nomBrut });
        if (c) {
            const legacy = c.famille === 'ouest' ? c.code.toUpperCase() : LEGACY[c.famille];
            for (const id of [...restants]) { const L = produits.get(id); if (L && langueCompatible(legacy, L.tirageSource) === false) retirer(id, 'R1'); }
        }
    }
    if (regles.R2 && scoresImage instanceof Map) {
        const s = id => (scoresImage.has(id) && Number.isFinite(scoresImage.get(id)) ? scoresImage.get(id) : null);
        const hauts = restants.filter(id => s(id) !== null && s(id) >= SEUIL_IMAGE.haut);
        for (const id of [...restants]) if (s(id) !== null && s(id) <= SEUIL_IMAGE.bas && hauts.some(h => h !== id)) retirer(id, 'R2');   // la photo est comparable : un AUTRE candidat la reconnaît nettement
    }
    if (regles.R2BIS && String(lu.attaqueConfiance || '').toLowerCase() === 'haute') {
        const st = new Map(restants.filter(id => produits.has(id)).map(id => [id, statuts(lu, produits.get(id)).attaque]));
        if ([...st.values()].some(x => x === 'ok')) for (const [id, x] of st) if (x === 'ko') retirer(id, 'R2BIS');   // repli : jamais si l'attaque lue contredit tout le monde
    }
    // R5 : un candidat d'un set SANS NUMÉROTATION (liste figée) ne peut pas être la carte d'une photo qui montre un numéro ET un total : retiré quand un AUTRE candidat, hors liste, a un total qui concorde
    if (regles.R5 && lu.numero && lu.total && !lu.totalHorsTailleDeSet && restants.length >= 2) {
        const sans = id => { const L = produits.get(id); return Boolean(L) && SANS_NUMEROTATION_IDS.has(L.idExpansion); };
        const concorde = id => { const L = produits.get(id); return Boolean(L) && !sans(id) && statuts(lu, L).total === 'ok'; };
        if (restants.some(concorde)) for (const id of [...restants]) if (sans(id)) retirer(id, 'R5');
    }
    if (!retires.length) return rien;
    if (!restants.length) { compte.tousRetires++; return rien; }
    for (const r of retires) compte.retraits[r.regle]++;
    return { ids: restants, retires };
}

/**
 * Le candidat SEUL qui reste est-il un SÛR ? TOUTES les conditions du critère A (`critere-a.conditions`, la même fonction : jamais recopiée), appliquées à lui ET au groupe de ses jumeaux (`groupe` : les AUTRES
 * produits que la garde des jumeaux lui donne, lus dans la colonne des jumeaux — pas dans le vivier). `groupe` null (la garde n'a pas pu conclure : colonne absente, périmée, lignes manquantes) : refus.
 * Aucun champ lu en « ko » (attaque et symbole compris) sauf le code sous R4 ; le numéro lu ne concorde avec aucun jumeau.
 */
function affirmableSeul({ corps, id, produits, regles = REGLES, groupe = null, catalogueExiste } = {}) {
    const non = raison => { compte.nonAffirmables++; return { affirme: false, raison }; };
    try {
        if (!Array.isArray(groupe)) return non('la garde des jumeaux ne conclut pas pour ce candidat');
        const CA = require('./critere-a');                                              // à l'appel : critere-a.js importe ce module (cycle)
        const autres = [...new Set(groupe)].filter(i => i !== id);
        const c = CA.conditions({ corps, gagnant: id, autres, produits, r4: regles.R4 === true, catalogueExiste, toleres: regles.attaqueTolereeRestant === true ? ['attaque'] : [] });
        if (!c.ok) return non(c.raison);
        const lu = lectureDe(corps);
        compte.affirmees++;
        return { affirme: true, raison: `numéro ${lu.numero} concordant${c.codeParR4 ? `, code lu ${lu.setCode} sans désignation dans le catalogue (R4)` : `, code ${lu.setCode} concordant`}${autres.length ? `, seul parmi ${autres.length + 1} produits du groupe` : ''}` };
    } catch (e) {
        return non(`décision impossible (${(e && e.name) || 'erreur'})`);
    }
}

module.exports = { langueCertaine, langueDeTirage, codeSansDesignation, creerIndexCodeNumero, candidatsDeReduction, reduire, affirmableSeul, compteurs, REGLES, SEUIL_IMAGE, SANS_NUMEROTATION };
