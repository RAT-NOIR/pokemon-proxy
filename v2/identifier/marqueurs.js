'use strict';
// MARQUEURS (27/10, CONTRAT-MARQUEURS.md) — les bandeaux d'affichage d'un produit : la LISTE FERMÉE des types, leurs paramètres, leurs libellés FR/EN (40 caractères au plus), leur dérivation
// depuis ce qui est DÉJÀ prouvé, et la fusion avec ce que le catalogue écrit. Module PUR : ni base, ni réseau, ni image — un marqueur ne se pose JAMAIS d'après une image.
// 🔑 Écrit par ce qu'il AUTORISE : un type n'existe que s'il est dans TYPES ; un paramètre n'existe que s'il est déclaré par son type et dans sa forme ; tout le reste (type inconnu, paramètre en trop,
// forme hors liste) rend null, jamais corrigé en silence. `[]` = prouvé sans marqueur ; `null` = on ne sait pas (jamais « aucun marqueur »).
// La table du §3 du contrat et ce module disent la même chose : test-marqueurs.js lit le contrat et le compare. Les MARQUES viennent de marques-tampon.js (une seule définition, pas de recopie).
const MT = require('./marques-tampon');
const { couplePourLien } = require('./lien-cardmarket');

/** Le slugSet d'une impression ou d'une entrée, lu sur son lien Cardmarket (la seule trace du set qu'elle porte), ou null. */
const slugSetDuLien = lien => { const c = couplePourLien(lien); return c ? c.slugSet : null; };
const LIBELLE_MAX = 40;                                                                 // §2 : libelle.fr et libelle.en, 40 caractères au plus
const MARQUEURS_MAX = 4;                                                                 // §2 : 0 à 4 éléments
const ANNEE_MIN = 1996, ANNEE_MAX = 2099;
const JOUEUR_MAX = 24;
const JOUEUR_FORME = /^[\p{L}][\p{L} '.-]*$/u;                                           // lettres, espaces, ', -, . (§2) ; commence par une lettre : jamais une chaîne de ponctuation
const SUFFIXE_RANG_EN = Object.freeze(['st', 'nd', 'rd', 'th']);

// Les gabarits à paramètre facultatif : trois formes, essayées dans l'ordre (complète, courte, sans le facultatif) ; la première qui tient en LIBELLE_MAX est rendue.
const WCD_GABARITS = Object.freeze({
    fr: Object.freeze(['Deck Championnats du monde {annee} · {joueur}', 'Deck Mondiaux {annee} · {joueur}', 'Deck Championnats du monde {annee}']),
    en: Object.freeze(['World Championships Deck {annee} · {joueur}', 'Worlds Deck {annee} · {joueur}', 'World Championships Deck {annee}'])
});

const fixe = (type, fr, en) => ({ type, params: [], formes: () => ({ fr: [fr], en: [en] }), libelle: Object.freeze({ fr, en }) });
/** LA table (§3), dans l'ORDRE d'affichage. */
const TYPES = Object.freeze([
    fixe('JUMBO', 'Carte Jumbo', 'Jumbo card'),
    { type: 'WCD', params: ['annee', 'joueur'], obligatoires: ['annee'], formes: () => WCD_GABARITS },
    fixe('NON_LEGAL', 'Non autorisée en tournoi', 'Not tournament legal'),
    fixe('EDITION_1', '1re édition', '1st Edition'),
    fixe('SHADOWLESS', 'Sans ombre', 'Shadowless'),
    fixe('STAFF', 'Tampon Staff', 'Staff stamp'),
    fixe('PRERELEASE', 'Tampon Avant-première', 'Prerelease stamp'),
    fixe('LEAGUE', 'Tampon Ligue', 'League stamp'),
    fixe('CHAMPIONSHIP', 'Tampon Championnat', 'Championship stamp'),
    { type: 'PLACE', params: ['rang'], obligatoires: ['rang'],
      formes: p => ({ fr: [p.rang === 1 ? 'Tampon {rang}re place' : 'Tampon {rang}e place'], en: [`{rang}${SUFFIXE_RANG_EN[p.rang - 1]} Place stamp`] }) },
    fixe('PROFESSOR', 'Tampon Professor Program', 'Professor Program stamp'),
    fixe('PLAY_POKEMON', 'Tampon Play! Pokémon', 'Play! Pokémon stamp'),
    fixe('TRICK_OR_TRADE', 'Tampon Trick or Trade', 'Trick or Trade stamp'),
    fixe('BATTLE_ACADEMY', 'Battle Academy', 'Battle Academy'),
    fixe('ANNIVERSAIRE_25', 'Logo 25e anniversaire', '25th Anniversary logo'),
    fixe('POKEMON_CENTER', 'Tampon Pokémon Center', 'Pokémon Center stamp'),
    fixe('GAMESTOP', 'Tampon GameStop', 'GameStop stamp'),
    fixe('TOYS_R_US', 'Tampon Toys"R"Us', 'Toys"R"Us stamp'),
    fixe('KFC', 'Tampon KFC', 'KFC stamp'),
    fixe('INDOMILK', 'Tampon Indomilk', 'Indomilk stamp'),
    fixe('ORIGINS', 'Tampon Origins Game Fair', 'Origins Game Fair stamp'),
    fixe('SNOWFLAKE', 'Tampon Flocon', 'Snowflake stamp'),
    fixe('COSMO', 'Holo Cosmos', 'Cosmos holo'),
    fixe('MCDONALDS', 'Promo McDonald\'s', 'McDonald\'s promo')
]);
const PAR_TYPE = new Map(TYPES.map((t, i) => [t.type, { ...t, rang: i }]));
const NOMS_TYPES = Object.freeze(TYPES.map(t => t.type));

// ── Les formes de paramètres : chacune écrite par ce qu'elle autorise.
const FORMES_PARAMS = Object.freeze({
    annee: v => Number.isInteger(v) && v >= ANNEE_MIN && v <= ANNEE_MAX,
    joueur: v => typeof v === 'string' && v === v.trim() && v.length >= 1 && v.length <= JOUEUR_MAX && JOUEUR_FORME.test(v),
    rang: v => Number.isInteger(v) && v >= 1 && v <= 4
});

/** Les paramètres d'un élément, dans leur forme canonique (ordre de déclaration du type, facultatifs absents omis), ou null : un paramètre inconnu, hors forme, ou un obligatoire absent. */
function paramsCanoniques(def, params) {
    const p = params === undefined ? {} : params;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    for (const k of Object.keys(p)) if (!def.params.includes(k)) return null;
    const sortie = {};
    for (const k of def.params) {
        if (p[k] === undefined) { if ((def.obligatoires || []).includes(k)) return null; continue; }
        if (!FORMES_PARAMS[k](p[k])) return null;
        sortie[k] = p[k];
    }
    return Object.freeze(sortie);
}

const remplir = (g, p) => g.replace(/\{(\w+)\}/g, (_, k) => String(p[k]));
const manque = (g, p) => [...g.matchAll(/\{(\w+)\}/g)].some(m => p[m[1]] === undefined);
/**
 * Le libellé { fr, en } d'un type et de ses paramètres (§2 « Le rendu à 40 caractères »). LÈVE si le type ou les paramètres sont hors liste, ou si aucun gabarit ne tient en 40 :
 * c'est une faute du contrat, jamais un libellé tronqué en silence.
 */
function rendre(type, params) {
    const def = PAR_TYPE.get(type);
    if (!def) throw new Error(`marqueurs.rendre : type hors liste "${type}"`);
    const p = paramsCanoniques(def, params);
    if (p === null) throw new Error(`marqueurs.rendre : paramètres invalides pour ${type}`);
    const formes = def.formes(p), sortie = {};
    for (const langue of ['fr', 'en']) {
        const t = formes[langue].filter(g => !manque(g, p)).map(g => remplir(g, p)).find(s => s.length <= LIBELLE_MAX);
        if (t === undefined) throw new Error(`marqueurs.rendre : aucun gabarit ${langue} de ${type} ne tient en ${LIBELLE_MAX} caractères`);
        sortie[langue] = t;
    }
    return Object.freeze(sortie);
}

/**
 * Un élément (écrit par le catalogue, sans `libelle`, ou servi, avec) -> l'élément CANONIQUE { type, params, libelle } ou null. Le libelle reçu n'est jamais repris : il est re-rendu.
 * Un champ en plus de type / params / libelle, un type hors liste, un paramètre inconnu ou hors forme : null.
 */
function valider(element) {
    if (!element || typeof element !== 'object' || Array.isArray(element)) return null;
    for (const k of Object.keys(element)) if (!['type', 'params', 'libelle'].includes(k)) return null;
    const def = typeof element.type === 'string' ? PAR_TYPE.get(element.type) : undefined;
    if (!def) return null;
    const params = paramsCanoniques(def, element.params);
    if (params === null) return null;
    let libelle;
    try { libelle = rendre(def.type, params); } catch { return null; }
    return Object.freeze({ type: def.type, params, libelle });
}

// ── La dérivation (§4.1) : de ce qui est déjà PROUVÉ, et de rien d'autre.
// marque (marques-tampon.js) -> type ; l'écart entre les deux listes lève AU CHARGEMENT (une marque sans bandeau serait une marque muette).
const TYPE_DE_MARQUE = Object.freeze({ staff: 'STAFF', prerelease: 'PRERELEASE', league: 'LEAGUE', championship: 'CHAMPIONSHIP', professor: 'PROFESSOR', 'play-pokemon': 'PLAY_POKEMON',
    'toys-r-us': 'TOYS_R_US', gamestop: 'GAMESTOP', kfc: 'KFC', indomilk: 'INDOMILK', cosmo: 'COSMO', snowflake: 'SNOWFLAKE',
    'place-1': 'PLACE', 'place-2': 'PLACE', 'place-3': 'PLACE', 'place-4': 'PLACE' });
{
    const a = [...MT.MARQUES].sort().join(), b = Object.keys(TYPE_DE_MARQUE).sort().join();
    if (a !== b) throw new Error(`marqueurs.js : TYPE_DE_MARQUE et MARQUES (marques-tampon.js) divergent — ${a} / ${b}`);
    for (const t of Object.values(TYPE_DE_MARQUE)) if (!PAR_TYPE.has(t)) throw new Error(`marqueurs.js : type de marque hors table ${t}`);
}
const ANNEE_SLUG = /^(\d{4})$/;
/** L'année d'un slugSet `WCD-<aaaa>` (1996 à 2099), ou null : le seul endroit où cette forme est lue (marqueursDuSet, setWcdDeLEntree). */
function anneeDuSetWcd(slugSet) {
    const m = typeof slugSet === 'string' ? /^WCD-(\d{4})$/.exec(slugSet) : null;
    return m && FORMES_PARAMS.annee(Number(m[1])) ? Number(m[1]) : null;
}
/**
 * Une entrée d'archive (validation d'entrée, visuels.js::lireEntree) est-elle celle d'un produit d'un set `WCD-<aaaa>` ? Deux preuves portées par l'ENTRÉE elle-même (c'est tout ce que la validation relit, y compris à
 * l'archive chargée) : le slugSet du lien Cardmarket, ou le nom affiché « WCD <aaaa> ». Rien d'autre (un nom approchant, une année hors plage, un set inconnu : faux).
 */
function setWcdDeLEntree(e) {
    const o = e && typeof e === 'object' ? e : {};
    if (anneeDuSetWcd(slugSetDuLien(o.lien)) !== null) return true;
    const m = typeof o.setNom === 'string' ? /^WCD (\d{4})$/.exec(o.setNom) : null;
    return m !== null && anneeDuSetWcd(`WCD-${m[1]}`) !== null;
}
/** Les marqueurs que le SET porte à tous ses produits (§3, familles de set) : [{ type, params }], ou []. Le slug est celui de `slugSet` ; rien d'autre n'est lu. */
function marqueursDuSet(slugSet) {
    if (typeof slugSet !== 'string') return [];
    let m;
    if (anneeDuSetWcd(slugSet) !== null) return [{ type: 'WCD', params: { annee: anneeDuSetWcd(slugSet) } }, { type: 'NON_LEGAL', params: {} }];
    if (/^Play-Pokemon-Prize-Pack-Series-[A-Za-z]+$/.test(slugSet)) return [{ type: 'PLAY_POKEMON', params: {} }];
    if (slugSet === 'Trick-or-Trade' || ((m = /^Trick-or-Trade-(\d{4})$/.exec(slugSet)) && ANNEE_SLUG.test(m[1]))) return [{ type: 'TRICK_OR_TRADE', params: {} }];
    if ((m = /^Battle-Academy-(\d{4})$/.exec(slugSet)) && ANNEE_SLUG.test(m[1])) return [{ type: 'BATTLE_ACADEMY', params: {} }];
    if (/^McDonalds-[A-Za-z0-9-]+$/.test(slugSet)) return [{ type: 'MCDONALDS', params: {} }];
    return [];
}
/** Les marques d'un produit sont PROUVÉES si c'est [] (la normale) ou exactement un ensemble canonique de la liste (comme produit.js::marquesDe) ; tout le reste (null, hors liste, autre ordre) : non. */
function marquesCanoniques(m) {
    if (!Array.isArray(m)) return false;
    if (m.length === 0) return true;
    const e = MT.ensembleDe(m);
    return e !== null && e.length === m.length && e.every((x, i) => x === m[i]);
}
const dansOrdre = (liste) => liste.sort((a, b) => PAR_TYPE.get(a.type).rang - PAR_TYPE.get(b.type).rang);

/**
 * Les marqueurs DÉRIVÉS d'un produit. @param produit { variante, marques, set: { slug } } — les champs PROUVÉS (la forme servie par produit.js) ; `slugSet` peut remplacer `set.slug`.
 * @returns le tableau canonique (dans l'ordre de la table, sans doublon de type, éventuellement VIDE = prouvé sans marqueur), ou null (on ne sait pas : ni variante prouvée, ni règle de set ;
 * ou plus de 4 éléments, ce que le contrat n'admet pas).
 */
function deriver(produit) {
    const p = produit && typeof produit === 'object' ? produit : {};
    const slugSet = typeof p.slugSet === 'string' ? p.slugSet : (p.set && typeof p.set === 'object' ? p.set.slug : null);
    const brut = [];
    let prouve = false;
    if (marquesCanoniques(p.marques)) {
        prouve = true;                                                                   // marques PROUVÉES (variante de l'archive) : [] pour la normale, sinon un ensemble canonique de la liste
        for (const m of p.marques) {
            const t = TYPE_DE_MARQUE[m];
            const rang = /^place-(\d)$/.exec(m);
            brut.push({ type: t, params: rang ? { rang: Number(rang[1]) } : {} });
        }
    }
    if (p.variante === 'jumbo') { prouve = true; brut.push({ type: 'JUMBO', params: {} }, { type: 'NON_LEGAL', params: {} }); }
    if (p.variante === 'premiere-edition') { prouve = true; brut.push({ type: 'EDITION_1', params: {} }); }
    const duSet = marqueursDuSet(slugSet);
    if (duSet.length) prouve = true;
    brut.push(...duSet);
    if (!prouve) return null;
    const vus = new Set(), sortie = [];
    for (const e of dansOrdre(brut)) {
        if (vus.has(e.type)) continue;
        vus.add(e.type);
        const v = valider(e);
        if (v === null) return null;                                                     // une dérivation qui ne tient pas dans la table est une faute : on ne sait pas
        sortie.push(v);
    }
    return sortie.length <= MARQUEURS_MAX ? Object.freeze(sortie) : null;
}


/**
 * §4.2 et 4.4 : le dérivé l'emporte sur un écrit du même type qui le contredit. @param derives le retour de deriver() (tableau ou null) ; @param ecrits la liste écrite par le catalogue (ou autre chose : ignorée).
 * @returns { marqueurs: tableau | null, contradictions, invalides, doublons, trop } — les éléments invalides, les doublons de type et les contradictions sont COMPTÉS ici, jamais réparés. Une liste écrite
 * vide ne prouve rien (null si rien d'autre) ; au-delà de 4 éléments le résultat est null et `trop` vaut 1.
 */
function fusionner(derives, ecrits) {
    const compte = { contradictions: 0, invalides: 0, doublons: 0, trop: 0 };
    const base = Array.isArray(derives) ? derives : null;
    const parType = new Map((base || []).map(e => [e.type, e]));
    const ajouts = [];
    if (Array.isArray(ecrits)) {
        const vusEcrits = new Set();
        for (const brut of ecrits) {
            const v = valider(brut);
            if (v === null) { compte.invalides++; continue; }
            if (vusEcrits.has(v.type)) { compte.doublons++; continue; }
            vusEcrits.add(v.type);
            const d = parType.get(v.type);
            if (d) { if (JSON.stringify(d.params) !== JSON.stringify(v.params)) compte.contradictions++; continue; }       // le dérivé l'emporte
            ajouts.push(v);
        }
    }
    if (base === null && ajouts.length === 0) return { marqueurs: null, ...compte };
    const tous = dansOrdre([...(base || []), ...ajouts]);
    if (tous.length > MARQUEURS_MAX) return { marqueurs: null, ...compte, trop: 1 };
    return { marqueurs: Object.freeze(tous), ...compte };
}

/** Raccourci pour le produit servi : le tableau fusionné seul (les comptes se lisent par fusionner). */
const marqueursDe = (produit, ecrits) => fusionner(deriver(produit), ecrits).marqueurs;

module.exports = { TYPES, NOMS_TYPES, LIBELLE_MAX, MARQUEURS_MAX, WCD_GABARITS, TYPE_DE_MARQUE, FORMES_PARAMS, valider, rendre, deriver, fusionner, marqueursDe, marqueursDuSet, slugSetDuLien, anneeDuSetWcd, setWcdDeLEntree };
