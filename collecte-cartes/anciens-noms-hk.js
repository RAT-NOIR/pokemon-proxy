// ============================================================
// ANCIENS NOMS DE HONG KONG DES ESPÈCES, PAR N° DE POKÉDEX — deux sources, concordance obligatoire (2026-10-31, décision de l'éditeur) — fonctions PURES, aucun réseau
// ============================================================
// Les cartes chinoises de Hong Kong (Gem Pack 4 et 5…) portent d'anciens noms d'espèces (比卡超, 護主犬, 噴墨海馬…) que ni PokeAPI ni Wikidata (zh-hk = repli taïwanais) ne donnent.
// Sources AUTORISÉES, et elles seules : wiki.52poke.com (tableau des noms de la page de l'espèce, CC BY-NC-SA) et zh.wikipedia.org (hôte DISTINCT de en.wikipedia.org, CC BY-SA).
// RÈGLE : un nom n'est admis que si les DEUX sources le donnent pour le MÊME n° de Pokédex — jamais par le nom d'un produit Cardmarket. Une contradiction (autre n°) ou une ambiguïté
// (un même nom pour deux n°, dans une source ou entre les deux) RETIRE le nom, et il est rendu dans `contestes` pour que fusionnerEspeces le retire AUSSI des autres tables.
// Ce module ne lit que du texte déjà obtenu : la politesse réseau (robots.txt, Crawl-delay, arrêts d'hôte) est celle de recolter-anciens-noms-hk.js / recolte-hote.js.
'use strict';

const nz = s => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
const HAN = /\p{Script=Han}/u;
const texte = html => String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/**
 * Une page d'espèce de wiki.52poke.com : { ok, dex, hk:[noms de Hong Kong, en caractères chinois] } | { ok:false, raison }.
 * Le n° est celui du BLOC national de la page (« #0025 ») ; les noms viennent des lignes « 中文 / 香港 » du tableau des noms de la forme de base (classe varname1).
 * Un nom de Hong Kong peut être une transcription mandarine (皮卡丘) ou cantonaise (比卡超) : tous sont gardés, le croisement décide. Un nom en lettres latines (« Pikachu », chaîne câblée) n'est pas un nom chinois.
 */
function lirePage52poke(html) {
    const h = String(html ?? '');
    const m = /title="宝可梦列表（按全国图鉴编号）">#(\d{3,4})<\/a>/.exec(h);
    if (!m) return { ok: false, raison: 'aucun numéro national (#NNNN) dans le bloc de la page' };
    const i = h.indexOf('wiki-nametable');
    if (i < 0) return { ok: false, raison: 'aucun tableau des noms (wiki-nametable) dans la page' };
    const debut = h.lastIndexOf('<table', i), fin = h.indexOf('</table>', i);
    const tableau = h.slice(debut, fin < 0 ? undefined : fin);
    const hk = [];
    for (const tr of tableau.split(/<tr[\s>]/).slice(1)) {
        if (!/varname1/.test(tr.slice(0, 80))) continue;
        const cases = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => texte(c[1]).trim());
        if (cases.length < 3 || cases[0] !== '中文' || cases[1] !== '香港') continue;
        for (const ligne of cases[2].split('\n')) {
            const nom = nz(ligne);
            if (nom && HAN.test(nom) && !hk.includes(nom)) hk.push(nom);
        }
    }
    return { ok: true, dex: Number(m[1]), hk };
}

function verifierSource(s, lequel) {
    if (!s || typeof s !== 'object') return;
    if (!s.source) throw new Error(`source ${lequel} : le nom de la source est obligatoire`);
    if (!s.licence || !s.luLe) throw new Error(`source « ${s.source} » : la licence et la date de lecture sont obligatoires (provenance de la table)`);
}
function indexer(s) {
    const parNom = new Map();
    for (const [dex, noms] of Object.entries(s.parDex || {})) for (const n of noms) { const k = nz(n); if (!k) continue; if (!parNom.has(k)) parNom.set(k, new Set()); parNom.get(k).add(Number(dex)); }
    return parNom;
}

/**
 * Le croisement. a, b : { source, licence, luLe, parDex: { "25": ["比卡超", …] } }.
 * @returns {{ table:Object, contestes:string[], entrees:Array, retraits:Array, stats:Object, message:string, sources:Array }}
 */
function croiserAnciensNomsHk(a, b) {
    verifierSource(a, 'A'); verifierSource(b, 'B');
    const vide = message => ({ table: {}, contestes: [], entrees: [], retraits: [], stats: { admis: 0, contestes: 0, uneSeuleSource: 0 }, message, sources: [a, b].filter(Boolean).map(({ source, licence, luLe }) => ({ source, licence, luLe })) });
    if (!a || !b) return vide('deux sources sont exigées (52poke ET zh.wikipedia) : une seule est disponible, aucun nom admis');
    const ia = indexer(a), ib = indexer(b);
    const table = {}, entrees = [], retraits = [], contestes = [];
    let unique = 0;
    for (const nom of [...new Set([...ia.keys(), ...ib.keys()])].sort()) {
        const da = ia.get(nom), db = ib.get(nom);
        const retirer = motif => { contestes.push(nom); retraits.push({ nom, motif, dexA: da ? [...da] : [], dexB: db ? [...db] : [] }); };
        if ((da && da.size > 1) || (db && db.size > 1)) { retirer(`nom ambigu : donné pour plusieurs numéros de Pokédex par ${da && da.size > 1 ? a.source : b.source}`); continue; }
        if (!da || !db) { unique++; continue; }
        const x = [...da][0], y = [...db][0];
        if (x !== y) { retirer(`contradiction : n° ${x} pour ${a.source}, n° ${y} pour ${b.source}`); continue; }
        table[nom] = 'D' + x;
        entrees.push({ dex: x, nom, sources: [a, b].map(({ source, licence, luLe }) => ({ source, licence, luLe })) });
    }
    return {
        table, contestes, entrees, retraits, sources: [a, b].map(({ source, licence, luLe }) => ({ source, licence, luLe })),
        stats: { admis: entrees.length, contestes: contestes.length, uneSeuleSource: unique },
        message: `${entrees.length} nom(s) admis (donnés par les deux sources pour le même n°), ${contestes.length} contesté(s), ${unique} connu(s) d'une seule source`
    };
}

/** Le fichier anciens-noms-hk.json (JSON-sérialisable). */
function versFichier(r, luLe = new Date().toISOString()) {
    return { luLe, sources: r.sources, entrees: r.entrees, contestes: r.contestes, retraits: r.retraits, stats: r.stats };
}

/** Relit le fichier : la table { nom -> 'D<n°>' } et les contestés ; chaque entrée doit porter DEUX sources distinctes avec licence et date (sinon LÈVE). */
function lireAnciensNomsHk(json) {
    const vus = new Map(), ambigus = new Set(json && json.contestes ? json.contestes : []);
    for (const e of (json && json.entrees) || []) {
        const srcs = Array.isArray(e.sources) ? e.sources : [];
        if (new Set(srcs.map(s => s && s.source)).size < 2 || !srcs.every(s => s && s.licence && s.luLe)) throw new Error(`anciens noms de Hong Kong : « ${e.nom} » sans provenance de deux sources (source, licence, date de lecture)`);
        if (!Number.isInteger(e.dex)) throw new Error(`anciens noms de Hong Kong : « ${e.nom} » sans numéro de Pokédex`);
        const nom = nz(e.nom), cle = 'D' + e.dex;
        if (vus.has(nom) && vus.get(nom) !== cle) ambigus.add(nom); else vus.set(nom, cle);
    }
    for (const n of ambigus) vus.delete(n);
    return { table: Object.fromEntries(vus), contestes: [...ambigus], stats: { entrees: vus.size, contestes: ambigus.size }, meta: { sources: (json && json.sources) || [], luLe: json && json.luLe } };
}

module.exports = { lirePage52poke, croiserAnciensNomsHk, versFichier, lireAnciensNomsHk };
