'use strict';
// LANGUE-DECISIVE (2026-10-17, nuit) — ce que la PHOTO dit (langue du texte, illustration, attaque, code) tranche une QUESTION de la garde contradiction ou des jumeaux, à 0 faux.
// Cas fondateur du testeur : « わるいバンギラス » 144/103, annonce « Tyranitar sombre 143/103 m6a » ; la chaîne affirme l'impression chinoise simplifiée, la garde pose une question à trois ; la bonne réponse est l'impression japonaise.
// Module PUR (ni base, ni réseau, ni modèle). Aucune règle recopiée (§21 bis) : la compatibilité langue/tirage est `garde-contradiction.langueCompatible` (UNE fonction, étendue), la concordance du numéro
// et du code est `seconde-lecture.comparer`, l'attaque est `garde-contradiction.statuts`, le nom est `nom-compatible.nomCompatible`.
// 🔑 Écrit par ce qu'il AUTORISE : un candidat n'est retiré que par une règle ALLUMÉE, sur une donnée CONNUE des deux côtés ; au moindre doute rien n'est retiré. Si tous les candidats seraient retirés,
// la question d'origine reste (on n'invente jamais une absence). Chaque règle porte sa constante et son compteur ; chacune a été MESURÉE seule puis combinée sur tout le banc étiqueté
// (lot-LANGUE-DECISIVE-report.md) : une règle qui crée un seul faux reste ÉTEINTE, et c'est écrit ici.
const { lectureDe, statuts, contredire, langueCompatible, VETOS, VIVIER_MAX } = require('./garde-contradiction');
const { comparer } = require('./seconde-lecture');
const { formesLuesDe, nomCompatible } = require('./nom-compatible');

// ÉTAT LIVRÉ DES RÈGLES (`ctx.langueDecisive` les surcharge pour les bancs et la mesure). Mesuré le 2026-10-17 sur les 320 cartes du banc étiqueté (rm_essai, lecture) par le VRAI chemin :
//   R1 ALLUMÉE  : 0 faux, 0 vérité retirée, 4 questions réduites de 3 à 2 (les trois Dark Tyranitar du testeur et une quatrième) ; aucun sûr à elle seule.
//   R4 ALLUMÉE  : 0 faux, +14 sûrs justes (Trainer Gallery « TG », Magneton, séries SV…), 0 perdu, 0 produit changé.
//   R2 ÉTEINTE  : 0 faux avec deux seuils, +1 sûr seule, +3 avec R4 — mais la photo et les vecteurs ne sont pas encore fournis à l'adaptateur par la route (ctx.scoresImage), et la calibration tient sur 153 lignes ;
//                 allumée sans score elle ne ferait rien. Elle s'allume ici le jour où la route l'alimente (un lot à part).
//   R2 bis ÉTEINTE : 0 faux mais aucun sûr de plus que R1 + R2 (elle réduit une question de 3 à 2) ; « Crush » contredit aussi la vraie carte du cas fondateur ; la garde dit « l'attaque est une contradiction, pas un veto ».
const REGLES = Object.freeze({ R1: true, R2: false, R2BIS: false, R4: true });
// S de la R2, en inliers ORB/RANSAC (departage-image.js, la fonction de la route), fixé sur le banc (mesure : lot-LANGUE-DECISIVE-report.md). UN SEUL SEUIL NE TIENT PAS : la photo entière contre une vignette de
// 270 px donne 0 inlier à la vraie carte sur ~12 % des lignes et jusqu'à 39 à une AUTRE carte (aucun S entre 8 et 35 ne laisse la vérité en place). La règle a donc DEUX seuils :
//   un candidat est retiré s'il est RECONNU PAR PERSONNE (score <= BAS) ET qu'un autre candidat de la question est RECONNU NETTEMENT (score >= HAUT) ;
//   BAS = 4, HAUT = 20 : sur les 153 lignes-question du banc dont la vérité est parmi les choix, le plus haut score d'un autre candidat à côté d'une vérité <= 4 est 6 ; HAUT est 14 au-dessus (marge nommée : 14 inliers).
const SEUIL_IMAGE = Object.freeze({ bas: 4, haut: 20 });

const compte = { jugees: 0, retraits: { R1: 0, R2: 0, R2BIS: 0 }, tousRetires: 0, affirmees: 0, nonAffirmables: 0 };
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

// ── R4 : le code lu ne désigne AUCUN produit du vivier (« s8a-P » pris pour le logo des 25 ans). Écrit par ce qui est AUTORISÉ : le code est lu, le vivier est connu et ENTIÈREMENT chargé.
function codeSansDesignation({ corps, produits } = {}) {
    const lu = lectureDe(corps);
    if (!lu || !texte(lu.setCode) || !(produits instanceof Map) || !lu.vivierIds.length || lu.vivierIds.length > VIVIER_MAX) return false;
    if (lu.vivierIds.some(id => !produits.has(id))) return false;
    return !lu.vivierIds.some(id => comparer({ numero: lu.numero, setCode: lu.setCode }, produits.get(id)).concorde.includes('code'));
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
    if (!retires.length) return rien;
    if (!restants.length) { compte.tousRetires++; return rien; }
    for (const r of retires) compte.retraits[r.regle]++;
    return { ids: restants, retires };
}

/**
 * Le candidat SEUL qui reste est-il un SÛR ? Les conditions du critère A, appliquées à lui : aucun champ VETO (numéro, total, set TCGdex, langue) ne le contredit ; la garde contradiction ne répond pas ;
 * le numéro lu concorde exactement ; le code lu concorde, OU (R4) il ne désigne personne dans le vivier ; le nom lu ne le contredit pas. L'attaque et le symbole ne sont pas des vetos (l'attaque lue est bruyante).
 */
function affirmableSeul({ corps, id, produits, regles = REGLES } = {}) {
    const non = raison => { compte.nonAffirmables++; return { affirme: false, raison }; };
    try {
        const lu = lectureDe(corps);
        if (!lu || !(corps.lectureGarde && typeof corps.lectureGarde === 'object') || !(produits instanceof Map) || !produits.has(id)) return non('lecture ou ligne absente');
        const L = produits.get(id);
        if (contredire({ corps, gagnant: id, produits })) return non('la garde contradiction répond');
        const st = statuts(lu, L);
        const veto = VETOS.filter(k => st[k] === 'ko');
        if (veto.length) return non(`un champ veto contredit (${veto.join(', ')})`);
        const cmp = comparer({ numero: lu.numero, setCode: lu.setCode }, L);
        if (!cmp.concorde.includes('numero')) return non('le numéro lu ne concorde pas exactement');
        const sansDesignation = regles.R4 === true && codeSansDesignation({ corps, produits });
        if (!cmp.concorde.includes('code') && !sansDesignation) return non('le code lu ne concorde pas');
        const formes = formesLuesDe(corps);
        if (formes.length && !nomCompatible(formes, L)) return non('le nom lu contredit le produit');
        compte.affirmees++;
        return { affirme: true, raison: `numéro ${lu.numero} concordant${cmp.concorde.includes('code') ? `, code ${lu.setCode} concordant` : `, code lu ${lu.setCode} sans désignation (R4)`}` };
    } catch (e) {
        return non(`décision impossible (${(e && e.name) || 'erreur'})`);
    }
}

module.exports = { langueCertaine, langueDeTirage, codeSansDesignation, reduire, affirmableSeul, compteurs, REGLES, SEUIL_IMAGE };
