'use strict';
// GARDE-CONTRADICTION (2026-10-17, « priorité absolue » du testeur : 0 faux affirmé) — jamais un verdict SÛR quand un champ LU sur la photo contredit le gagnant ET désigne un autre candidat du vivier.
// Module PUR (ni base, ni réseau). Cas fondateur S41 : la photo montre la Magneton Aquapolis 22/147 (code lu « AQU », attaque « Steel Wave », carte TCGdex ecard2-22) ; la chaîne a affirmé EX Legend Maker 22/92 (même numéro 22).
// Les quatre contradictions étaient LUES et journalisées ; aucune ne comptait (scoring.js : le total n'est jamais comparé à un candidat, l'attaque ne sert qu'à départager des ex aequo, la carte TCGdex n'est lue que si aucun
// code n'est connu, et « AQU » ne s'apparente pas à « AQ » — 2 caractères sous LONGUEUR_MIN_PARENTE — donc le critère de set donnait le même malus aux deux).
// 🔑 Écrite par ce qu'elle AUTORISE : l'affirmation passe SEULEMENT si aucun champ lu ne contredit le gagnant en désignant un autre candidat. Un champ INCONNU d'un côté (ligne sans total, sans attaque, sans set TCGdex) ou NON LU
// ne contredit rien. Les comparaisons sont celles de la production (scoring.js : normaliserTotal, ALIAS_CODES_LUS ; seconde-lecture.js::comparer : numéro et code ; departage-attaque.js : attaques) — jamais une copie (§21 bis).
// TOUR 1 (ruling du coordinateur, en attendant le testeur) : une contradiction sur le NUMÉRO ou le TOTAL — les deux seuls champs sans bruit sur le banc réel — ôte TOUJOURS le verdict sûr, même sans candidat désigné
// (`fort`) ; les autres champs (code, attaque, symbole, set TCGdex, langue) ne le font que s'ils désignent un autre candidat : la carte imprime parfois un autre code que Cardmarket, l'attaque se traduit ou se lit mal (§72).
// CE QUI VÉTO UN CANDIDAT (jamais le code seul) : voir VETOS. La LANGUE lue est comparée au TIRAGE de la ligne (colonne des jumeaux) : mesurée sans aucun désaccord sur les 291 cartes étiquetées dont le tirage est connu.
const S = require('../../scoring');
const { attaquesDe, normaliserAttaque } = require('../../departage-attaque');
const { comparer } = require('./seconde-lecture');
const { nomCompatible, formesLuesDe } = require('./nom-compatible');
const { idsAffirmes } = require('./jumeaux');

const CHAMPS = Object.freeze(['numero', 'code', 'total', 'attaque', 'setTcgdex', 'symbole', 'langue']);
// TOUR 1 : l'ATTAQUE n'est plus un veto. Mesuré sur tout le banc étiqueté : avec elle, les 3 Dark Tyranitar affirmés 908322 (vérité 907909) restent sûrs, la lecture « Crush » écartant aussi la vraie carte (Grind | Spinning Tail |
// Bite Off) ; sans elle, les 3 sont rétrogradés en question qui contient la vérité, 0 sûr juste perdu. Elle reste une CONTRADICTION du gagnant (et un soutien d'un candidat), jamais un motif d'écarter un candidat désigné.
// 🔑 UNE CONSTANTE (décision du testeur, tour 2) : le veto de LANGUE (un candidat dont le tirage contredit la langue lue n'est jamais désigné). Allumé : 0 désaccord sur 291 cartes étiquetées au tirage connu. L'éteindre ne retire pas
// la langue des champs qui contredisent le GAGNANT. Tenu par un banc (cas Dark Tyranitar 7a).
const VETO_LANGUE = true;
const VETOS = Object.freeze(['numero', 'total', 'setTcgdex', ...(VETO_LANGUE ? ['langue'] : [])]);   // le code, le symbole et l'attaque étayent ou contredisent le GAGNANT ; ils ne retirent jamais un candidat
const FORTS = Object.freeze(['numero', 'total']);                                    // une contradiction sur l'un d'eux ôte le sûr même sans candidat désigné
// 🔑 UNE CONSTANTE, pas une variable d'environnement (décision du testeur, I0) : false = le sûr est gardé quand un champ autre que numéro/total contredit sans désigner personne (comportement livré) ;
// true = variante (a) STRICTE : toute contradiction d'un champ FIABLE (numéro, total, attaque lue en confiance HAUTE, set TCGdex) ôte le sûr même sans candidat désigné. Le code (variante b) est écarté. Les deux sont testés.
const VARIANTE_STRICTE = false;
const STRICTS = Object.freeze(['numero', 'total', 'attaque', 'setTcgdex']);
const VIVIER_MAX = 400;                                                             // au plus 400 lignes du vivier chargées (routes.js, lot.js) ; au-delà, la garde juge le sous-ensemble chargé et le DIT (compteurs)
const compte = { jugees: 0, contradictions: 0, fortes: 0, sansVivier: 0, vivierTronque: 0, sansBloc: 0 };
const compteurs = () => ({ ...compte });

const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const entiers = xs => (Array.isArray(xs) ? xs.filter(Number.isInteger) : []);

/** La lecture de la photo, telle que la chaîne héritée la rend : les champs de `carte` (numero, total, setCode, tcgdexId, langue) complétés par le bloc `lectureGarde` (symbole, attaque, vivier). null si rien n'est exploitable. */
function lectureDe(corps) {
    if (!corps || typeof corps !== 'object' || corps.success !== true) return null;
    const c = corps.carte && typeof corps.carte === 'object' ? corps.carte : {};
    const g = corps.lectureGarde && typeof corps.lectureGarde === 'object' ? corps.lectureGarde : {};
    return {
        numero: texte(String(g.numero ?? c.numero ?? '')), setCode: texte(g.setCode ?? c.setCode), total: texte(String(g.total ?? c.total ?? '')),
        symboleSet: texte(g.symboleSet), attaque: texte(g.attaque), attaqueConfiance: texte(g.attaqueConfiance), langue: texte(g.langue ?? c.langue),
        tcgdexId: texte(g.carteTcgdexId ?? c.tcgdexId), totalHorsTailleDeSet: g.totalHorsTailleDeSet === true, vivierIds: entiers(g.vivierIds)
    };
}
/** Le bloc `lectureGarde` que la chaîne héritée pose dans sa réponse pour une requête v2 (index.js) — une seule écriture, testée sans serveur. */
function blocLectureGarde({ cardInfo, tcgdexId, totalHorsTailleDeSet, produits } = {}) {
    const ci = cardInfo && typeof cardInfo === 'object' ? cardInfo : {};
    return {
        numero: ci.number ?? null, total: ci.total ?? null, setCode: ci.setCode ?? null, symboleSet: ci.symboleSet ?? null, langue: ci.language ?? null,
        attaque: ci.attaque ?? null, attaqueConfiance: ci.attaqueConfiance ?? null, carteTcgdexId: tcgdexId ?? null,
        totalHorsTailleDeSet: totalHorsTailleDeSet === true, vivierIds: (Array.isArray(produits) ? produits : []).map(p => p && p.idProduct).filter(Number.isInteger)
    };
}
/** Les idProduct du vivier que la route doit charger pour que la garde puisse juger (au plus VIVIER_MAX). [] sans bloc `lectureGarde`. Pour une affirmation, un candidat UNIQUE, ou une ambiguë à 3 candidats au plus (le filtre de nom peut la réduire à un). */
function idsDeLaGarde(corps) {
    const l = lectureDe(corps);
    if (!l) return [];
    const nC = Array.isArray(corps.candidats) ? corps.candidats.length : 0;
    const ambigue = corps.carte && corps.carte.ambigu === true && nC >= 1 && nC <= 3;
    if (!idsAffirmes(corps).length && !ambigue) return [];                             // une question à plus de 3 candidats, un refus : rien à charger
    if (l.vivierIds.length > VIVIER_MAX) compte.vivierTronque++;
    return l.vivierIds.slice(0, VIVIER_MAX);
}

const totalDe = x => S.normaliserTotal(x).total;
// Le set TCGdex de la carte lue (« ecard2-22 » → « ecard2 ») ne se compare qu'à un set de la MÊME FAMILLE d'identifiants : même classe de casse (les séries japonaises TCGdex sont en capitales : E2, PMCG4, SM10a ;
// les sets occidentaux appris en minuscules : ecard2, base5, sv03.5) ET même préfixe de lettres (sv03.5 / sv04, swsh12.5 / swsh12). Une série japonaise face à un set occidental, ou ecard2 face à ex12 : inconnu, jamais une contradiction.
const setTcgdexDe = id => { const s = texte(id); if (!s || !s.includes('-')) return null; return s.slice(0, s.lastIndexOf('-')) || null; };
const familleDe = id => { const m = String(id).match(/^[A-Za-z]+(?:-[A-Za-z]+)*?(?=\d|$)/); return m ? m[0].toLowerCase() : null; };
const classeDe = id => (/^[A-Z]/.test(id) ? 'majuscule' : 'minuscule');
function memeSetTcgdex(lu, ligne) {
    if (!lu || !ligne) return null;
    if (lu === ligne) return true;
    const f = familleDe(lu), g = familleDe(ligne);
    return f && g && f === g && classeDe(lu) === classeDe(ligne) ? false : null;
}
// La langue lue (EN, FR, JP, ZH…) face au tirage de la ligne (intl, jp, zh-hans, zh-hant, ko ; id, th, idth : inconnu). true / false / null (inconnu d'un côté ou tirage hors table).
const OUEST = new Set(['EN', 'FR', 'DE', 'ES', 'IT', 'PT', 'NL', 'RU', 'PL', 'CS', 'HU']);   // LANGUE-DECISIVE : les 11 langues occidentales du code fermé de l'extension (la chaîne héritée n'en lit que 8 ; PL, CS, HU n'ajoutent rien tant qu'elle ne les lit pas)
function langueCompatible(langue, tirage) {
    const l = texte(langue) ? langue.trim().toUpperCase().replace(/^JA$/, 'JP') : null, t = texte(tirage) ? tirage.trim().toLowerCase() : null;
    if (!l || !t) return null;
    const attendu = t === 'intl' ? (OUEST.has(l) ? true : ['JP', 'ZH', 'KR'].includes(l) ? false : null)
        : t === 'jp' ? (l === 'JP' ? true : OUEST.has(l) || ['ZH', 'KR'].includes(l) ? false : null)
            : t === 'zh-hans' || t === 'zh-hant' ? (l === 'ZH' ? true : OUEST.has(l) || ['JP', 'KR'].includes(l) ? false : null)
                : t === 'ko' ? (l === 'KR' ? true : OUEST.has(l) || ['JP', 'ZH'].includes(l) ? false : null) : null;
    return attendu;
}

/** Le statut de CHAQUE champ lu face à UNE ligne de catalogue : 'ok' (concorde), 'ko' (contredit : les deux côtés connus et différents) ou '?' (un côté inconnu ou non lu — ne contredit rien). */
function statuts(lu, ligne) {
    const st = Object.fromEntries(CHAMPS.map(k => [k, '?']));
    if (!lu || !ligne) return st;
    const cmp = comparer({ numero: lu.numero, setCode: lu.setCode }, ligne);
    if (cmp.concorde.includes('numero')) st.numero = 'ok'; else if (cmp.contredit.includes('numero')) st.numero = 'ko';
    if (cmp.concorde.includes('code')) st.code = 'ok'; else if (cmp.contredit.includes('code')) st.code = 'ko';
    const tl = lu.totalHorsTailleDeSet ? null : totalDe(lu.total), tc = totalDe(ligne.total);   // un total qui ne correspond à la taille d'aucun set est une mauvaise lecture : il n'est pas lu
    if (tl && tc) st.total = tl === tc ? 'ok' : 'ko';
    const al = lu.attaque && String(lu.attaqueConfiance || '').toLowerCase() !== 'basse' ? normaliserAttaque(lu.attaque) : null, ac = attaquesDe(ligne.nomCardmarket);
    if (al && ac.length) st.attaque = ac.includes(al) ? 'ok' : 'ko';
    const ms = memeSetTcgdex(setTcgdexDe(lu.tcgdexId), texte(ligne.setTcgdex));
    if (ms !== null) st.setTcgdex = ms ? 'ok' : 'ko';
    const symbole = lu.symboleSet ? S.normaliserCodeSet(lu.symboleSet) : null, alias = symbole ? S.ALIAS_CODES_LUS.get(symbole) : null, code = S.normaliserCodeSet(ligne.set && ligne.set.code);
    if (alias && code) st.symbole = alias === code ? 'ok' : 'ko';                      // seul l'alias e-Reader (e1..e5) se lit : tout autre symbole ne dit rien d'un code (jamais deviné)
    const lc = langueCompatible(lu.langue, ligne.tirageSource);
    if (lc !== null) st.langue = lc ? 'ok' : 'ko';
    return st;
}
function valeurDe(champ, ligne) {
    if (champ === 'numero') return ligne.numero ?? null;
    if (champ === 'code' || champ === 'symbole') return (ligne.set && ligne.set.code) ?? null;
    if (champ === 'total') return ligne.total ?? null;
    if (champ === 'attaque') return attaquesDe(ligne.nomCardmarket).join(' | ') || null;
    if (champ === 'langue') return ligne.tirageSource ?? null;
    return ligne.setTcgdex ?? null;
}
function valeurLue(champ, lu) {
    if (champ === 'numero') return lu.numero;
    if (champ === 'code') return lu.setCode;
    if (champ === 'total') return lu.total;
    if (champ === 'attaque') return lu.attaque;
    if (champ === 'setTcgdex') return setTcgdexDe(lu.tcgdexId);
    if (champ === 'langue') return lu.langue;
    return lu.symboleSet;
}

/**
 * LA GARDE, appelable seule (CRITÈRE-A la réutilise) : le gagnant est-il contredit par un champ lu ?
 * @param corps     la réponse de la chaîne héritée (success true) : `carte` + `lectureGarde`
 * @param gagnant   idProduct du produit que la chaîne affirme (ou du candidat unique)
 * @param produits  Map<idProduct, ligne de catalogue> : doit porter le gagnant ; le vivier (lectureGarde.vivierIds) y est cherché
 * @param vetos     (mesure seulement) les champs qui écartent un candidat désigné ; défaut VETOS
 * @returns null (rien : l'affirmation reste permise) | { gagnant, contredit: [{ champ, lu, gagnant }], designe: [{ idProduct, soutiens: [champ] }] (triés : le plus étayé d'abord ; vide si `fort` seul), fort: boolean, resume }
 *          `fort` : le numéro ou le total contredit le gagnant — le verdict sûr est ôté même sans candidat désigné.
 */
function contredire({ corps, gagnant, produits, vetos = VETOS, stricte = VARIANTE_STRICTE, triAttaque = true } = {}) {
    const lu = lectureDe(corps);
    if (!lu || !Number.isInteger(gagnant) || !(produits instanceof Map) || !produits.has(gagnant)) return null;
    const lg = produits.get(gagnant);
    compte.jugees++;
    if (!(corps.lectureGarde && typeof corps.lectureGarde === 'object')) compte.sansBloc++;   // pas de vivier ni d'attaque : la garde ne juge que numéro, total, code, langue — et le DIT
    const sg = statuts(lu, lg);
    const contredit = CHAMPS.filter(k => sg[k] === 'ko');
    if (!contredit.length) return null;                                                // rien ne contredit le gagnant : l'affirmation reste permise
    const attaqueHaute = String(lu.attaqueConfiance || '').toLowerCase() === 'haute';
    const fort = contredit.some(k => FORTS.includes(k) || (stricte && STRICTS.includes(k) && (k !== 'attaque' || attaqueHaute)));
    const formes = formesLuesDe(corps);
    const designe = [];
    if (!lu.vivierIds.length) compte.sansVivier++;                                     // pas de vivier : personne à désigner (le DIT)
    for (const id of lu.vivierIds) {
        if (id === gagnant || !produits.has(id)) continue;
        const ligne = produits.get(id), sc = statuts(lu, ligne);
        if (vetos.some(k => sc[k] === 'ko')) continue;                                 // un autre candidat que le champ lu CONTREDIT n'est pas désigné
        const soutiens = contredit.filter(k => sc[k] === 'ok');
        if (!soutiens.length) continue;                                                // il faut qu'un champ qui contredit le gagnant soit CONCORDANT sur lui
        if (formes.length && !nomCompatible(formes, ligne)) continue;                  // CONFIRMATION-SURE : le nom lu en confiance haute le contredit
        designe.push({ idProduct: id, soutiens, attaque: sc.attaque });
    }
    // TOUR 2 (I-C) : l'attaque n'est pas un veto, mais elle TRIE et ÉCARTE avec repli. Parmi les désignés, un candidat que l'attaque lue CONTREDIT n'est retiré que s'il en reste au moins un autre dont l'attaque ne le contredit pas ;
    // si tous sont contredits (Dark Tyranitar : « Crush » contredisait la vérité elle-même) on les garde tous. À soutiens égaux, l'attaque qui concorde passe devant l'inconnue, devant celle qui contredit.
    // CRITERE-A (réserve I-C de la relecture r3) : le repli ne retire un contredit que si un AUTRE désigné a une attaque qui CONCORDE ; un désigné d'attaque inconnue ne suffit pas (l'attaque est contredite sur 32 % des lignes de vérité).
    if (triAttaque && designe.some(d => d.attaque === 'ok')) { for (let i = designe.length - 1; i >= 0; i--) if (designe[i].attaque === 'ko') designe.splice(i, 1); }
    if (!designe.length && !fort) return null;                                         // contradiction que personne n'étaye, hors numéro et total : pas de question fabriquée
    const rangs = new Map(entiers((corps.classement || []).map(c => c && c.idProduct)).map((id, i) => [id, i]));
    const poidsAttaque = d => (triAttaque ? (d.attaque === 'ok' ? 0 : d.attaque === 'ko' ? 2 : 1) : 0);
    designe.sort((a, b) => b.soutiens.length - a.soutiens.length || poidsAttaque(a) - poidsAttaque(b) || (rangs.has(a.idProduct) ? rangs.get(a.idProduct) : Infinity) - (rangs.has(b.idProduct) ? rangs.get(b.idProduct) : Infinity) || a.idProduct - b.idProduct);
    for (const d of designe) delete d.attaque;                                         // interne : la forme rendue est { idProduct, soutiens }
    compte.contradictions++;
    if (!designe.length) compte.fortes++;
    const detail = contredit.map(k => ({ champ: k, lu: valeurLue(k, lu), gagnant: valeurDe(k, lg) }));
    return { gagnant, contredit: detail, designe, fort, resume: `contredit par ${detail.map(d => `${d.champ} (lu ${d.lu}, gagnant ${d.gagnant})`).join(', ')} ; ${designe.length ? `désigne ${designe.map(d => d.idProduct).join(', ')}` : 'ne désigne personne (numéro ou total : le sûr est ôté)'}` };
}

module.exports = { contredire, statuts, lectureDe, blocLectureGarde, idsDeLaGarde, langueCompatible, memeSetTcgdex, compteurs, CHAMPS, VETOS, FORTS, STRICTS, VARIANTE_STRICTE, VETO_LANGUE, VIVIER_MAX };
