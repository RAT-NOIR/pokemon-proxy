'use strict';
// GARDE-CONTRADICTION (2026-10-17, « priorité absolue » du testeur : 0 faux affirmé) — jamais un verdict SÛR quand un champ LU sur la photo contredit le gagnant ET désigne un autre candidat du vivier.
// Module PUR (ni base, ni réseau). Cas fondateur S41 : la photo montre la Magneton Aquapolis 22/147 (code lu « AQU », attaque « Steel Wave », carte TCGdex ecard2-22) ; la chaîne a affirmé EX Legend Maker 22/92 (même numéro 22).
// Les quatre contradictions étaient LUES et journalisées ; aucune ne comptait (scoring.js : le total n'est jamais comparé à un candidat, l'attaque ne sert qu'à départager des ex aequo, la carte TCGdex n'est lue que si aucun
// code n'est connu, et « AQU » ne s'apparente pas à « AQ » — 2 caractères sous LONGUEUR_MIN_PARENTE — donc le critère de set donnait le même malus aux deux).
// 🔑 Écrite par ce qu'elle AUTORISE : l'affirmation passe SEULEMENT si aucun champ lu ne contredit le gagnant en désignant un autre candidat. Un champ INCONNU d'un côté (ligne sans total, sans attaque, sans set TCGdex) ou NON LU
// ne contredit rien. Une contradiction que personne ne vient étayer (aucun autre candidat compatible) ne fabrique PAS une question : la carte imprime parfois un autre code que Cardmarket, la lecture se trompe — c'est le §72.
// Les comparaisons sont celles de la production (scoring.js : normaliserTotal, ALIAS_CODES_LUS ; seconde-lecture.js::comparer : numéro et code ; departage-attaque.js : attaques) — jamais une copie (§21 bis).
// CE QUI VÉTO UN CANDIDAT (jamais le code seul : un code lu ne retire un candidat que si un AUTRE le porte, §72) : le numéro, le total, l'attaque ou le set TCGdex de la carte, quand ils le contredisent.
const S = require('../../scoring');
const { attaquesDe, normaliserAttaque } = require('../../departage-attaque');
const { comparer } = require('./seconde-lecture');
const { nomCompatible, formesLuesDe } = require('./nom-compatible');
const { idsAffirmes } = require('./jumeaux');

const CHAMPS = Object.freeze(['numero', 'code', 'total', 'attaque', 'setTcgdex', 'symbole']);
const VETOS = Object.freeze(['numero', 'total', 'attaque', 'setTcgdex']);          // le code et le symbole étayent ou contredisent le GAGNANT ; ils ne retirent jamais un candidat
const VIVIER_MAX = 400;                                                              // au plus 400 lignes du vivier chargées (routes.js, lot.js) ; au-delà, la garde juge le sous-ensemble chargé et le DIT (compteurs)
const compte = { jugees: 0, contradictions: 0, sansVivier: 0, vivierTronque: 0 };
const compteurs = () => ({ ...compte });

const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const entiers = xs => (Array.isArray(xs) ? xs.filter(Number.isInteger) : []);

/** La lecture de la photo, telle que la chaîne héritée la rend : les champs de `carte` (numero, total, setCode, tcgdexId) complétés par le bloc `lectureGarde` (symbole, attaque, vivier). null si rien n'est exploitable. */
function lectureDe(corps) {
    if (!corps || typeof corps !== 'object' || corps.success !== true) return null;
    const c = corps.carte && typeof corps.carte === 'object' ? corps.carte : {};
    const g = corps.lectureGarde && typeof corps.lectureGarde === 'object' ? corps.lectureGarde : {};
    return {
        numero: texte(String(g.numero ?? c.numero ?? '')) , setCode: texte(g.setCode ?? c.setCode), total: texte(String(g.total ?? c.total ?? '')),
        symboleSet: texte(g.symboleSet), attaque: texte(g.attaque), attaqueConfiance: texte(g.attaqueConfiance),
        tcgdexId: texte(g.carteTcgdexId ?? c.tcgdexId), totalHorsTailleDeSet: g.totalHorsTailleDeSet === true, vivierIds: entiers(g.vivierIds)
    };
}
/** Les idProduct du vivier que la route doit charger pour que la garde puisse juger (au plus VIVIER_MAX). [] sans bloc `lectureGarde`. */
function idsDeLaGarde(corps) {
    const l = lectureDe(corps);
    if (!l || !idsAffirmes(corps).length) return [];                                   // seuls l'affirmé et le candidat UNIQUE passent par la garde : un autre résultat ne charge rien
    if (l.vivierIds.length > VIVIER_MAX) compte.vivierTronque++;
    return l.vivierIds.slice(0, VIVIER_MAX);
}

const setTcgdexDe = id => { const s = texte(id); if (!s || !s.includes('-')) return null; return s.slice(0, s.lastIndexOf('-')) || null; };
const totalDe = x => S.normaliserTotal(x).total;

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
    const sl = setTcgdexDe(lu.tcgdexId), sc = texte(ligne.setTcgdex);
    if (sl && sc) st.setTcgdex = sl === sc ? 'ok' : 'ko';
    const symbole = lu.symboleSet ? S.normaliserCodeSet(lu.symboleSet) : null, alias = symbole ? S.ALIAS_CODES_LUS.get(symbole) : null, code = S.normaliserCodeSet(ligne.set && ligne.set.code);
    if (alias && code) st.symbole = alias === code ? 'ok' : 'ko';                      // seul l'alias e-Reader (e1..e5) se lit : tout autre symbole ne dit rien d'un code (jamais deviné)
    return st;
}
function valeurDe(champ, ligne) {
    if (champ === 'numero') return ligne.numero ?? null;
    if (champ === 'code') return (ligne.set && ligne.set.code) ?? null;
    if (champ === 'total') return ligne.total ?? null;
    if (champ === 'attaque') return attaquesDe(ligne.nomCardmarket).join(' | ') || null;
    if (champ === 'setTcgdex') return ligne.setTcgdex ?? null;
    return (ligne.set && ligne.set.code) ?? null;
}
function valeurLue(champ, lu) {
    if (champ === 'numero') return lu.numero;
    if (champ === 'code') return lu.setCode;
    if (champ === 'total') return lu.total;
    if (champ === 'attaque') return lu.attaque;
    if (champ === 'setTcgdex') return setTcgdexDe(lu.tcgdexId);
    return lu.symboleSet;
}

/**
 * LA GARDE, appelable seule (CRITÈRE-A la réutilise) : le gagnant est-il contredit par un champ lu qui désigne un autre candidat ?
 * @param corps     la réponse de la chaîne héritée (success true) : `carte` + `lectureGarde`
 * @param gagnant   idProduct du produit que la chaîne affirme (ou du candidat unique)
 * @param produits  Map<idProduct, ligne de catalogue> : doit porter le gagnant ; le vivier (lectureGarde.vivierIds) y est cherché
 * @returns null (rien : l'affirmation reste permise) | { gagnant, contredit: [{ champ, lu, gagnant }], designe: [{ idProduct, soutiens: [champ] }] (triés : le plus étayé d'abord), resume }
 */
function contredire({ corps, gagnant, produits } = {}) {
    const lu = lectureDe(corps);
    if (!lu || !Number.isInteger(gagnant) || !(produits instanceof Map) || !produits.has(gagnant)) return null;
    const lg = produits.get(gagnant);
    compte.jugees++;
    const sg = statuts(lu, lg);
    const contredit = CHAMPS.filter(k => sg[k] === 'ko');
    if (!contredit.length) return null;                                                // rien ne contredit le gagnant : l'affirmation reste permise
    if (!lu.vivierIds.length) { compte.sansVivier++; return null; }                    // pas de vivier : personne à désigner, la garde ne peut que se taire (et le compte)
    const formes = formesLuesDe(corps);
    const designe = [];
    for (const id of lu.vivierIds) {
        if (id === gagnant || !produits.has(id)) continue;
        const ligne = produits.get(id), sc = statuts(lu, ligne);
        if (VETOS.some(k => sc[k] === 'ko')) continue;                                 // un autre candidat que le champ lu CONTREDIT n'est pas désigné
        const soutiens = contredit.filter(k => sc[k] === 'ok');
        if (!soutiens.length) continue;                                                // il faut qu'un champ qui contredit le gagnant soit CONCORDANT sur lui
        if (formes.length && !nomCompatible(formes, ligne)) continue;                  // CONFIRMATION-SURE : le nom lu en confiance haute le contredit
        designe.push({ idProduct: id, soutiens });
    }
    if (!designe.length) return null;                                                  // contradiction sans autre candidat compatible : pas de question fabriquée
    const rangs = new Map(entiers((corps.classement || []).map(c => c && c.idProduct)).map((id, i) => [id, i]));
    designe.sort((a, b) => b.soutiens.length - a.soutiens.length || (rangs.has(a.idProduct) ? rangs.get(a.idProduct) : Infinity) - (rangs.has(b.idProduct) ? rangs.get(b.idProduct) : Infinity) || a.idProduct - b.idProduct);
    compte.contradictions++;
    const detail = contredit.map(k => ({ champ: k, lu: valeurLue(k, lu), gagnant: valeurDe(k, lg) }));
    return { gagnant, contredit: detail, designe, resume: `contredit par ${detail.map(d => `${d.champ} (lu ${d.lu}, gagnant ${d.gagnant})`).join(', ')} ; désigne ${designe.map(d => d.idProduct).join(', ')}` };
}

module.exports = { contredire, statuts, lectureDe, idsDeLaGarde, compteurs, CHAMPS, VETOS, VIVIER_MAX };
