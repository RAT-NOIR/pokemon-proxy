'use strict';
// B1a.1 — le Produit du contrat 2 (CONTRAT-2 §3.2), construit depuis une LIGNE de catalogue déjà lue. Module PUR.
// Écrit par ce qu'il AUTORISE : une valeur hors liste, un hôte hors liste blanche, un prix non daté => null (on n'affirme rien).
const { lireConfig } = require('../config');
const { lienServi } = require('./lien-cardmarket');
const { reservesDe, fiable, BASE_DE, badgeDe, versionDe } = require('./fiabilite-prix');

const VARIANTES = Object.freeze(['normale', 'reverse', 'holo', 'premiere-edition', 'tampon', 'jumbo']);
let CFG_DEFAUT = null;
const cfgDe = ctx => ctx.cfg || (CFG_DEFAUT || (CFG_DEFAUT = lireConfig()));

const texte = x => (typeof x === 'string' && x.trim() ? x : null);
const chaineOuNull = x => (typeof x === 'number' && Number.isFinite(x) ? String(x) : texte(x));
const entierPositif = x => Number.isInteger(x) && x > 0;

/** URL https dont l'hôte est EXACTEMENT dans la liste blanche (pas de userinfo, pas de port). */
function urlAdmise(u, hotes) {
    if (typeof u !== 'string') return null;
    let p; try { p = new URL(u); } catch { return null; }
    if (p.protocol !== 'https:' || p.username || p.password || p.port) return null;
    return hotes.includes(p.hostname) ? u : null;
}
function image(src, hotes, avecGrande) {
    if (!src || typeof src !== 'object') return null;
    const url = urlAdmise(src.url, hotes);
    if (!url || !entierPositif(src.w) || !entierPositif(src.h)) return null;
    if (!avecGrande) return Object.freeze({ url, w: src.w, h: src.h });
    const g = src.grande ? image(src.grande, hotes, false) : null;
    return Object.freeze({ url, w: src.w, h: src.h, grande: g });
}
const prix = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);   // un zéro n'est pas un prix (index.js:3675)
function dateDuGuide(d) {
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))) return d;
    return null;
}
/**
 * { trend, low, avg7, avg30, guideDu } -> { tendance, de, deBase, moyenne7, moyenne30, date, fiable, reserves } ; la date est celle du GUIDE, jamais celle de l'import.
 * F4-PRIX : `deBase` dit ce qu'est le « De » (l'offre la plus basse TOUS ÉTATS, jamais le prix de l'état retenu) ; `fiable`/`reserves` disent si le prix peut être présenté comme sûr
 * (écart de la tendance aux moyennes > 30 %, prix mélangé avec une version tamponnée : fiabilite-prix.js). `melange` = le `prixMelangeTampon` de la ligne du produit (catalogue), vrai seulement si === true.
 */
function prixGuideDe(g, melange = false, nonLu = false) {
    if (!g || typeof g !== 'object') return null;
    const date = dateDuGuide(g.guideDu);
    const tendance = prix(g.trend), de = prix(g.low), moyenne7 = prix(g.avg7), moyenne30 = prix(g.avg30);
    if (!date || (tendance === null && de === null && moyenne30 === null)) return null;
    const reserves = reservesDe({ tendance, moyenne7, moyenne30, prixMelangeTampon: melange, nonLu: nonLu === true });
    return Object.freeze({ tendance, de, deBase: BASE_DE, moyenne7, moyenne30, date, fiable: fiable(reserves), reserves });
}
// LIEN-CARDMARKET : un lien dès que le NUMÉRO est connu (la rareté n'est plus exigée), vers la page EXACTE du produit — la garde vit dans lien-cardmarket.js (un seul exemplaire).
const lienCardmarket = (u, numero) => lienServi(u, numero);
const varianteDe = x => (VARIANTES.includes(x) ? x : null);                            // jamais 'normale' deviné (CLAUDE.md §7)
function mention(m, langue) {
    if (m && typeof m === 'object') return texte(langue === 'fr' ? m.fr : m.en);
    return texte(m);
}

// CONTRAT 7a : les quinze langues de Cardmarket, en code fermé minuscule (idLanguage 2 1 3 4 5 8 12 13 9 14 15 7 10 6 11 ; extension v2, DEMANDE-SERVEUR-EXTENSION.md §Lot 8). Tout autre texte : null.
const LANGUES = Object.freeze(['fr', 'en', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'cs', 'hu', 'ja', 'ko', 'zh-hans', 'zh-hant']);
const langueFermee = x => (LANGUES.includes(x) ? x : null);

function impression(i, ctx) {
    const numero = chaineOuNull(i.numero), rarete = texte(i.rarete);
    return Object.freeze({
        idProduct: i.idProduct, numero, total: chaineOuNull(i.total), rarete, variante: varianteDe(i.variante),
        version: versionDe(i.version),                                                 // F4 (c) : V1, V2… — ce qui sépare deux produits au même set et au même numéro chez Cardmarket ; null = rien ne les sépare dans nos données
        langue: langueFermee(i.langue),   // CONTRAT 7a (ajout) : le code fermé de la langue de CETTE impression, ou null (jamais devinée)
        set: Object.freeze({ nom: texte(i.set && i.set.nom) }),
        lien: lienCardmarket(i.lien, numero), prixGuide: prixGuideDe(i.prixGuide, i.prixMelangeTampon === true, i.nonLu === true)
    });
}

/**
 * @param source  LIGNE de catalogue déjà lue (voir le brief B1a.1)
 * @param ctx     { langueInterface, ficheServie?, cfg? }
 */
function construireProduit(source, ctx = {}) {
    if (!source || !Number.isInteger(source.idProduct)) throw new Error('construireProduit : idProduct entier requis');
    if (!texte(source.nomCardmarket)) throw new Error('construireProduit : nomCardmarket requis');
    if (!source.set || !texte(source.set.slug) || !texte(source.set.nom)) throw new Error('construireProduit : set { slug, nom } requis');
    const hotes = cfgDe(ctx).images.hotesPublics;
    const fr = ctx.langueInterface === 'fr';                                           // une langue inconnue rend l'anglais (DEMANDE §12.5)
    const numero = chaineOuNull(source.numero), rarete = texte(source.rarete);
    const visuel = image(source.visuel, hotes, true);
    const s = source.set;
    return Object.freeze({
        idProduct: source.idProduct,
        nom: fr && texte(source.nomFr) ? source.nomFr : source.nomCardmarket,
        nomCardmarket: source.nomCardmarket,
        set: Object.freeze({ slug: s.slug, nom: s.nom, code: texte(s.code), tirage: texte(s.tirage), annee: Number.isInteger(s.annee) ? s.annee : null,
                             symbole: image(source.symbole, hotes, false), ...badgeDe(s) }),     // F4 (d) : badge + badgeSource (le code, sauf s'il se confond avec une série : alors le nom)
        numero, total: chaineOuNull(source.total), langue: texte(source.langue),
        variante: varianteDe(source.variante), version: versionDe(source.version), rarete,
        visuel: visuel && Object.freeze(visuel),
        visuelMention: visuel ? mention(source.visuelMention, ctx.langueInterface) : null,   // une mention n'accompagne qu'un visuel servi
        prixGuide: prixGuideDe(source.prixGuide, source.prixMelangeTampon === true, source.nonLu === true),
        // `source.lienCardmarket` = le lien de la FICHE PRODUIT (ligne de catalogue) ; `lien` d'une impression (i.lien, plus haut) = le lien de CETTE impression.
        liens: Object.freeze({ cardmarket: lienCardmarket(source.lienCardmarket, numero),
                               fiche: ctx.ficheServie ? `https://rat-market.fr/fr/p/${source.idProduct}` : null }),
        impressions: Object.freeze(Array.isArray(source.impressions) ? source.impressions.filter(i => i && Number.isInteger(i.idProduct)).map(i => impression(i, ctx)) : [])
    });
}
module.exports = { construireProduit, VARIANTES, LANGUES, urlAdmise };
