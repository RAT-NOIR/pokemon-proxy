'use strict';
// GALERIE — la PAGE d'un classeur (arbitrage O15) : `Page = { nb: 4|9|12|16, blocs: [{ c, r, l, h, genre: "carte"|"art", contenu: {type:"carte",cle,setSlug} | {type:"art",artId} | null }] }`.
// Écrit par ce qu'il AUTORISE : tout ce qui n'est pas dans la liste (clé en trop, genre inconnu, bloc hors de la grille, art d'une taille hors des quatre formats) est refusé avec le `detail` du refus.
//   · la grille d'une page de `nb` pochettes : 4 → 2 colonnes × 2 rangées, 9 → 3×3, 12 → 4×3, 16 → 4×4 (colonnes × rangées) ; `c` et `r` comptent depuis 0 ; `l` et `h` sont en pochettes ;
//   · une carte occupe UNE pochette ; un art occupe l'un des quatre formats de la banque (1×1 « 1 », 2×1 « 2h », 1×2 « 2v », 2×2 « 4 ») ;
//   · `contenu: null` est une pochette ou une zone VIDE (une reprise vide les cartes ; une illustration disparue se lit null) ;
//   · au plus 16 blocs par page, de 1 à 100 pages (50 doubles pages) ; rien ici ne lit une base (l'existence d'un art se juge dans classeurs.js).
const F = require('./forme');
const { cleValide, slugValide } = require('../collection/forme');

const GRILLES = Object.freeze({ 4: [2, 2], 9: [3, 3], 12: [4, 3], 16: [4, 4] });          // [colonnes, rangées]
const NB = Object.freeze([4, 9, 12, 16]);
const TAILLE_FORMAT = Object.freeze({ '1': [1, 1], '2h': [2, 1], '2v': [1, 2], '4': [2, 2] });
const BLOCS_MAX = 16, PAGES_MAX = 100;
const CLES_BLOC = Object.freeze(['c', 'r', 'l', 'h', 'genre', 'contenu']);

const formatDe = (l, h) => Object.keys(TAILLE_FORMAT).find(k => TAILLE_FORMAT[k][0] === l && TAILLE_FORMAT[k][1] === h) || null;
const entier = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Un bloc, validé. { bloc } | { detail }. Le bloc rendu est une COPIE aux seules clés permises. */
function lireBloc(b, grille) {
    if (!F.objet(b) || !F.cles(b, CLES_BLOC)) return { detail: 'bloc' };
    const [cols, rangs] = grille;
    if (!entier(b.c, 0, cols - 1) || !entier(b.r, 0, rangs - 1) || !entier(b.l, 1, cols) || !entier(b.h, 1, rangs) || b.c + b.l > cols || b.r + b.h > rangs) return { detail: 'bloc-hors-grille' };
    if (b.genre !== 'carte' && b.genre !== 'art') return { detail: 'bloc-genre' };
    if (b.genre === 'carte' ? (b.l !== 1 || b.h !== 1) : formatDe(b.l, b.h) === null) return { detail: 'bloc-genre' };
    const base = { c: b.c, r: b.r, l: b.l, h: b.h, genre: b.genre };
    const k = b.contenu === undefined ? null : b.contenu;
    if (k === null) return { bloc: { ...base, contenu: null } };
    if (!F.objet(k) || typeof k.type !== 'string') return { detail: 'contenu' };
    if (k.type === 'carte') {
        if (b.genre !== 'carte') return { detail: 'bloc-genre' };
        if (!F.cles(k, ['type', 'cle', 'setSlug'])) return { detail: 'contenu' };
        if (!cleValide(k.cle)) return { detail: 'cle' };
        if (!slugValide(k.setSlug)) return { detail: 'set-slug' };
        return { bloc: { ...base, contenu: { type: 'carte', cle: k.cle, setSlug: k.setSlug } } };
    }
    if (k.type === 'art') {
        if (b.genre !== 'art') return { detail: 'bloc-genre' };
        if (!F.cles(k, ['type', 'artId'])) return { detail: 'contenu' };
        if (!F.idValide(k.artId)) return { detail: 'art-id' };
        return { bloc: { ...base, contenu: { type: 'art', artId: k.artId } } };
    }
    return { detail: 'contenu' };
}
/** Une page, validée. { page } | { detail }. */
function lirePage(p) {
    if (!F.objet(p) || !F.cles(p, ['nb', 'blocs'])) return { detail: 'page' };
    if (!NB.includes(p.nb)) return { detail: 'page-nb' };
    if (!Array.isArray(p.blocs) || p.blocs.length > BLOCS_MAX) return { detail: 'bloc' };
    const blocs = [];
    for (const b of p.blocs) { const r = lireBloc(b, GRILLES[p.nb]); if (r.detail) return { detail: r.detail }; blocs.push(r.bloc); }
    return { page: { nb: p.nb, blocs } };
}
/** Les pages d'un classeur. { pages } | { detail } | { borne: 'borne-doubles-pages' } (plus de 100 pages = plus de 50 doubles pages). */
function lirePages(liste) {
    if (!Array.isArray(liste) || liste.length < 1) return { detail: 'pages' };
    if (liste.length > PAGES_MAX) return { borne: 'borne-doubles-pages' };
    const pages = [];
    for (const p of liste) { const r = lirePage(p); if (r.detail) return { detail: r.detail }; pages.push(r.page); }
    return { pages };
}

const ordre = (a, b) => a.r - b.r || a.c - b.c;
/** Les identifiants d'art cités par des pages (sans doublon). */
const artsCites = pages => [...new Set(pages.flatMap(p => p.blocs).filter(b => b.contenu && b.contenu.type === 'art').map(b => b.contenu.artId))];
/** Les clés de carte, dans l'ordre de lecture (pages, puis rangées, puis colonnes). */
const cartesDans = pages => pages.flatMap(p => [...p.blocs].sort(ordre).filter(b => b.contenu && b.contenu.type === 'carte').map(b => b.contenu));
/** La forme de la LECTURE publique d'une page : les arts POSÉS { art, col, row, fmt } et les pochettes de cartes (rangée par rangée, `nb` cases, null quand vide). */
function versArtsEtCartes(page) {
    const [cols] = GRILLES[page.nb];
    const arts = [...page.blocs].sort(ordre).filter(b => b.contenu && b.contenu.type === 'art').map(b => ({ art: b.contenu.artId, col: b.c, row: b.r, fmt: formatDe(b.l, b.h) }));
    const cartes = Array(page.nb).fill(null);
    for (const b of page.blocs) if (b.contenu && b.contenu.type === 'carte') cartes[b.r * cols + b.c] = { cle: b.contenu.cle, setSlug: b.contenu.setSlug };
    return { arts, cartes };
}
/** L'inverse, pour l'EXPLOITATION (et les bancs) qui posent une page avec des arts et des pochettes : { nb, blocs }. */
function depuisArtsEtCartes(nb, arts, cartes) {
    const [cols] = GRILLES[nb];
    const blocs = [];
    for (const a of arts) { const [l, h] = TAILLE_FORMAT[a.fmt]; blocs.push({ c: a.col, r: a.row, l, h, genre: 'art', contenu: { type: 'art', artId: a.art } }); }
    cartes.forEach((k, i) => { if (k) blocs.push({ c: i % cols, r: Math.floor(i / cols), l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle: k.cle, setSlug: k.setSlug || null } }); });
    return { nb, blocs };
}
const doublesPages = n => Math.ceil(n / 2);

module.exports = { GRILLES, NB, TAILLE_FORMAT, BLOCS_MAX, PAGES_MAX, formatDe, lireBloc, lirePage, lirePages, artsCites, cartesDans, versArtsEtCartes, depuisArtsEtCartes, doublesPages };
