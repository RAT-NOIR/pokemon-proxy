// ============================================================
// UN SET PARTIEL — Promos (2107) : on publie ce qui se prouve, on complète ensuite (décision du testeur, 2026-10-12)
// ============================================================
// 🔑 LA VOIE EST CELLE DES RÉIMPRESSIONS À CODE D'ORIGINE (poser-reimpressions.js, §49/§62), PAS UNE TROISIÈME : 53 des produits de 2107
// écrivent dans leur slug le code et le numéro du tirage d'ORIGINE (`Ultra-Ball-V1-PRBRS-150` = Brilliant Stars n°150). Le décodage
// et la résolution (code → expansions → numéro → produit d'origine → la carte qu'il désigne déjà) vivent ICI, UNE fois, et
// poser-reimpressions.js les appelle (§21 bis : deux exemplaires d'une règle divergent).
// 🔑 CE QUE CE MODULE AJOUTE : l'EXPANSION n'a pas de tirage prouvé (les 40 autres produits n'ont pas de code d'origine). Le set naît
// donc PARTIEL — `sets.partiel` dit « N produits sur M », ce que le site peut afficher — et son tirage `intl` n'est prouvé QUE par les
// produits prouvés, chacun par une impression intl de sa carte au numéro d'origine. Les autres restent sans fiche, chacun avec sa
// raison dans `restes` (jamais « absent », §36).
// ⚠️ LE TÉMOIN DU NOM est `temoinDuNom` de jointure.js (la fonction de production, §21 bis), appelé sur le pool des cartes du set d'origine
// AVEC la carte désignée ajoutée : sans cela le témoin se tait sur une carte qu'il ne connaît pas (« je ne sais pas » ≠ « tout va bien »).
// Il ne parle que pour CONTREDIRE ; la preuve exige en plus que le nom CONCORDE (un écart de forme n'est pas une preuve : un doute est un trou).
const { cleNumero, normaliserNom, decomposerNomCardmarket, estCarteCode, temoinDuNom, clesNom, nomJointDe } = require('./jointure');
const { compatible } = require('./cle-nom-attaques');
const { LANGUES_INTL } = require('./langues-intl');

const echapper = s => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const PREUVE = 'reimpression+origine+numero';

/** `Ultra-Ball-V1-PRBRS-150` + `PR` → { code: 'BRS', num: '150' } ; null si le slug ne porte pas de code d'origine. (Recopie MOT POUR MOT de poser-reimpressions.js, qui l'importe désormais.) */
function decoderOrigine(slug, CODE) {
    if (!slug) return null;
    const MOTIF = new RegExp(`-${echapper(CODE)}([A-Z][A-Za-z0-9]*?)-([0-9]+[A-Za-z]?)$`);
    const m = MOTIF.exec(String(slug).replace(/-V\d+(?=-|$)/, ''));
    return m ? { code: m[1], num: m[2] } : null;
}

/**
 * (S6, 2026-10-12) LA FORME « CODE COLLÉ AU NUMÉRO » : Cardmarket écrit parfois l'origine sans le préfixe de l'expansion et sans tiret
 * (`Rainbow-Energy-TR17` = Team Rocket n°17). Elle ne se lit QUE sur demande (ctx.formeCollee) : poser-reimpressions.js, qui partage
 * resoudreProduit, ne change pas. Le code de l'expansion elle-même (`Fire-Energy-PR14` sous PR) est CIRCULAIRE : jamais décodé.
 */
function decoderCollee(slug, CODE) {
    if (!slug) return null;
    const m = /-([A-Z]{2,5})(\d+[A-Za-z]?)$/.exec(String(slug).replace(/-V\d+(?=-|$)/, ''));
    return m && m[1] !== CODE ? { code: m[1], num: m[2] } : null;
}

/**
 * Une cause pour UN produit appris (même ordre que poser-reimpressions.js : deja, nonDecode, codeInconnu, numeroAbsent, origineSansCarte, ambigu, resolu).
 * ctx : { expsDuCode: Map<code, Set<idExpansion>>, parExpNum: Map<'exp|numeroClé', idProduct[]>, cartesDe: Map<idProduct, Set<carteId>>,
 *         origines?: Map<idProduct, {code, num, langue, ligne, titre, page}>  (S6 : TABLE FERMÉE, prioritaire sur le slug),
 *         formeCollee?: boolean  (S6 : opt-in) }
 * Le résultat dit sa `source` : 'table' | 'slug' | 'slug-collee'.
 */
function resoudreProduit(p, CODE, ctx) {
    if (ctx.cartesDe.has(p.idProduct)) return { cause: 'deja', ...p };
    const t = ctx.origines && ctx.origines.get(p.idProduct);
    let d = null, source = null, plus = {};
    if (t && t.code) { d = { code: t.code, num: t.num }; source = 'table'; plus = { langue: t.langue, ligne: t.ligne, titre: t.titre, page: t.page }; }
    else if ((d = decoderOrigine(p.slug, CODE))) source = 'slug';
    else if (ctx.formeCollee && (d = decoderCollee(p.slug, CODE))) source = 'slug-collee';
    if (!d) return { cause: 'nonDecode', ...p };
    const exps = ctx.expsDuCode.get(d.code);
    if (!exps) return { cause: 'codeInconnu', ...p, code: d.code };
    const cands = [...exps].flatMap(e => ctx.parExpNum.get(`${e}|${cleNumero(d.num)}`) || []);
    if (!cands.length) return { cause: 'numeroAbsent', ...p, code: d.code, num: d.num };
    const cs = new Set(cands.flatMap(id => [...(ctx.cartesDe.get(id) || [])]));
    if (!cs.size) return { cause: 'origineSansCarte', ...p, code: d.code, num: d.num };
    if (cs.size > 1) return { cause: 'ambigu', ...p, code: d.code, num: d.num };
    return { cause: 'resolu', ...p, code: d.code, num: d.num, cands, carteId: [...cs][0], source, ...plus };
}

const RAISONS = {
    'produit-non-appris': 'produit jamais appris : aucune ligne numeros_cartes, donc ni slug ni code d\'origine à lire',
    'sans-code-origine': 'le slug ne porte pas de code d\'origine (ni set ni numéro du tirage d\'origine) : rien ne désigne sa carte',
    'code-inconnu': 'le code d\'origine du slug n\'est dans aucune expansion apprise (codes_set)',
    'numero-absent': 'le numéro d\'origine n\'existe dans aucune expansion de ce code',
    'origine-sans-carte': 'le produit d\'origine existe mais n\'a pas de carte chez nous',
    'origine-ambigue': 'le produit d\'origine désigne plusieurs cartes : on ne choisit pas',
    'carte-sans-nom': 'la carte désignée n\'a pas de nom : le témoin du nom n\'a rien à dire',
    'nom-non-concordant': 'le nom du produit ne concorde pas avec celui de la carte désignée, sans désigner une autre carte (écart de forme) : un doute est un trou',
    'origine-sans-impression-intl': 'la carte désignée n\'a pas d\'impression intl à ce numéro : le tirage intl du set ne se prouve pas par ce produit',
    'fiche-contredite-par-le-nom': 'le numéro d\'origine désigne une carte que le nom du produit contredit (le nom désigne une AUTRE carte du set d\'origine)',
    'langue-hors-tirage': 'la page de l\'expansion dit que ce produit est une impression dans une langue qui n\'est pas du tirage intl (chinois, coréen) : il ne se range pas dans un set intl',
    'attaques-non-concordantes': 'les attaques que Cardmarket écrit entre crochets ne sont pas EXACTEMENT celles de la carte que la page désigne : deux témoins indépendants en désaccord, un doute est un trou',
    'titre-non-concordant': 'le titre de la page de la carte désignée n\'est pas celui que la ligne de la page de l\'expansion cite : la table et la base ne parlent pas de la même carte',
};
const CAUSE_RESTE = { nonDecode: 'sans-code-origine', codeInconnu: 'code-inconnu', numeroAbsent: 'numero-absent', origineSansCarte: 'origine-sans-carte', ambigu: 'origine-ambigue' };

const numeroBrut = n => String(n ?? '').split('/')[0];

/**
 * Classe les produits d'une expansion en : prouves, contredits (par le nom), restes (avec raison), deja (déjà jointes), horsDenominateur (cartes-code).
 * @param {{produits: {idProduct, slug, name, appris: boolean, slugSet?, idExpansion?}[], CODE: string, ctx: object, cartesParId: Map<*, object>, poolDe: (x: object) => object[]}} o
 *   `poolDe(x)` : les cartes du set d'ORIGINE de x (le témoin du nom compare à elles).
 */
function classerProduits({ produits, CODE, ctx, cartesParId, poolDe }) {
    const R = { prouves: [], contredits: [], restes: [], deja: [], horsDenominateur: [] };
    const reste = (x, cause) => R.restes.push({ ...x, cause, raison: RAISONS[cause] });
    for (const p of produits) {
        if (estCarteCode(p.name)) { R.horsDenominateur.push(p); continue; }
        if (ctx.cartesDe.has(p.idProduct)) { R.deja.push(p); continue; }
        if (!p.appris) { reste(p, 'produit-non-appris'); continue; }
        // (S6) une langue que la page de l'expansion range hors du tirage intl : refusée AVANT toute résolution (l'ordre ne la laisse pas se perdre en « code inconnu »)
        const tp = ctx.origines && ctx.origines.get(p.idProduct);
        if (tp && !LANGUES_INTL.includes(tp.langue)) { reste({ ...p, langue: tp.langue, ligne: tp.ligne }, 'langue-hors-tirage'); continue; }
        const x = resoudreProduit(p, CODE, ctx);
        if (x.cause !== 'resolu') { reste(x, CAUSE_RESTE[x.cause]); continue; }
        const carte = cartesParId.get(x.carteId);
        if (!carte || !carte.nomEn) { reste(x, 'carte-sans-nom'); continue; }
        const d = decomposerNomCardmarket(p.name);
        // (S6) table fermée : DEUX témoins indépendants doivent s'accorder AVANT le nom — la page (numéro → carte, par son titre) et Cardmarket (attaques entre crochets)
        if (x.source === 'table' && ctx.verifierAttaques) {
            if (x.titre && (carte.bulba && carte.bulba.titre) !== x.titre) { reste(x, 'titre-non-concordant'); continue; }
            if (!compatible(carte, d, 'egales')) { reste(x, 'attaques-non-concordantes'); continue; }
        }
        const pool = new Map(poolDe(x).map(c => [c._id, c])); pool.set(carte._id, carte);
        const autres = temoinDuNom([...pool.values()])(carte, d);
        if (autres) { R.contredits.push({ ...x, autres, cause: 'fiche-contredite-par-le-nom', raison: RAISONS['fiche-contredite-par-le-nom'] }); continue; }
        const kp = clesNom(d.nom), kc = clesNom(nomJointDe(carte));
        if (!kp.some(k => kc.includes(k))) { reste(x, 'nom-non-concordant'); continue; }
        if (!(carte.impressions || []).some(i => i && i.tirage === 'intl' && i.numero != null && cleNumero(numeroBrut(i.numero)) === cleNumero(x.num))) { reste(x, 'origine-sans-impression-intl'); continue; }
        R.prouves.push(x);
    }
    return R;
}

/** Le champ `sets.partiel` : le compte prouvé / total que le site peut afficher. Total = les produits de l'expansion hors cartes-code. */
function partielDe(C, { chemin = 'slug → code d\'origine → produit d\'origine → une seule carte → son nom concorde → impression intl à ce numéro' } = {}) {
    const prouves = C.prouves.length, restes = C.restes.length, contredits = C.contredits.length, dejaJoints = C.deja.length;
    const total = prouves + restes + contredits + dejaJoints;
    return {
        prouves, total, restes, contredits, dejaJoints, horsDenominateur: C.horsDenominateur.length,
        mention: `Set partiel : ${prouves} produit${prouves > 1 ? 's' : ''} sur ${total} ${prouves > 1 ? 'ont' : 'a'} une fiche prouvée ; les autres n'en ont pas encore (raison de chacun dans \`restes\`).`,
        tirage: 'intl',
        tiragePreuve: `l'expansion n'a pas de tirage prouvé en entier ; le tirage intl n'est prouvé QUE par les ${prouves} produits prouvés (${chemin})`
    };
}

/** Le document `sets` (forme de creer-sets-reimpressions.js) + `partiel`. Sans nom : `nommerLesNouveaux` le pose avant l'insertion. `lecture` : comment l'origine est lue (défaut : le slug Cardmarket). */
function docSetPartiel({ slug, code, exps, route, partiel, le, lecture = 'par le slug Cardmarket' }) {
    return {
        _id: slug, code, idExpansion: [...exps], nomEn: null, nomJa: null, nomJaTraduit: null, region: 'intl', tirage: 'intl', totalImprime: null,
        reimpressions: route,
        bulba: { titre: null, expansion: null, motifTitres: `réimpressions (${route}) : produits joints à leur carte d'origine ${lecture} — fiche sans numéro, sans visuel ; SET PARTIEL (${partiel.prouves}/${partiel.total})` },
        partiel, collecteLe: le, version: 1
    };
}

/** Un document `restes` par produit non prouvé (contredit compris), avec sa raison. Les prouvés n'y sont jamais. */
function restesDe(slug, C, le) {
    return [...C.restes, ...C.contredits].map(x => ({
        set: slug, type: `partiel-${x.cause}`, idProduct: x.idProduct,
        detail: `${x.idProduct} « ${x.name} »${x.slug ? ` (slug ${x.slug})` : ''} : ${x.raison}${x.autres ? ` — le nom désigne ${x.autres.map(c => `« ${c.nomEn} »`).join(', ')}` : ''}`,
        le
    }));
}

/** Les lignes `cartes_produits` des produits prouvés : la forme de poser-reimpressions.js (preuve, route, origine, slug, slugSet, detail). Aucune clé de visuel. */
function lignesDe({ slugSet, CODE, classement, idExpansion, le }) {
    return classement.prouves.map(x => {
        const table = x.source === 'table', collee = x.source === 'slug-collee';
        return {
            _id: `${x.carteId}|${x.idProduct}`, carteId: x.carteId, idProduct: x.idProduct, idExpansion: x.idExpansion ?? idExpansion, tirage: 'intl', preuve: PREUVE,
            slug: x.slug, slugSet: x.slugSet ?? slugSet, origine: table ? { code: x.code, numero: x.num, source: 'table' } : collee ? { code: x.code, numero: x.num, source: 'slug-collee' } : { code: x.code, numero: x.num },
            detail: table
                ? `table fermée (${x.page}) : ligne « ${x.ligne} » (${x.langue}) → tirage d'origine ${x.code} n°${x.num} → produit(s) ${x.cands.join('/')} → une seule carte « ${x.titre} » → attaques de Cardmarket = celles de la carte → nom concordant (témoin du nom de la jointure)`
                : `slug ${x.slug} → tirage d'origine ${x.code} n°${x.num}${collee ? ' (code collé au numéro, sans préfixe)' : ''} → produit(s) ${x.cands.join('/')} → une seule carte → nom concordant (témoin du nom de la jointure)`,
            verifieLe: le, route: CODE
        };
    });
}

module.exports = { PREUVE, RAISONS, LANGUES_INTL, decoderOrigine, decoderCollee, resoudreProduit, classerProduits, partielDe, docSetPartiel, restesDe, lignesDe };
