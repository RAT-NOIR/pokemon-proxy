// ============================================================
// TABLE zh -> clé de comparaison (PREUVE PAR LE SET, 2026-10-31) — fonctions PURES + un lecteur du clone TCGdex (MIT, déjà cloné, aucune requête)
// ============================================================
// La traduction d'un nom chinois ne se DEVINE pas. Deux tables ouvertes, rien d'autre :
//   1. TCGdex `data-asia` : chaque carte porte son nom `zh-tw` ET son `dexId` (Pokémon), ou un `thirdParty.cardmarket` (idProduct -> nom Cardmarket, Dresseurs/Énergies) ;
//   2. les paires (nom chinois, nom anglais) que la SOURCE ELLE-MÊME publie sur ses pages de carte (kado.hk : « 比卡超 Captain Pikachu »), lues par le script de simulation.
// Une clé de Pokémon est le n° de Pokédex (« D25 ») : le nom d'espèce se traduit, le préfixe de forme (« Captain », « Hisuian ») non — la comparaison se fait donc à l'espèce.
// Une clé d'autre carte est le nom anglais normalisé (« Nboss'sorders »). Un nom absent des tables est INTRADUISIBLE : discordance, jamais approximation.
const { normaliserNom, decomposerNomCardmarket } = require('./jointure');

/** « 皮卡丘 ex » -> « 皮卡丘 » : seuls les marqueurs de règle en lettres latines, en suffixe. */
const SUFFIXE_REGLE = /\s*(?:ex|EX|GX|VMAX|VSTAR|V-UNION|VUNION|BREAK|V)\s*$/;
function baseZh(nom) {
    let s = String(nom ?? '').normalize('NFKC').replace(/\s+/g, '');
    for (let i = 0; i < 2; i++) s = s.replace(SUFFIXE_REGLE, '');
    return s;
}

/** Lit un fichier de carte TCGdex (.ts) : nom zh-tw, dexId, catégorie, idProduct Cardmarket. */
function lireCarteTs(texte) {
    const bloc = /\bname:\s*\{([\s\S]*?)\}/.exec(texte);
    const zh = bloc ? /['"]zh-tw['"]:\s*(["'`])((?:(?!\1)[\s\S])*?)\1/.exec(bloc[1]) : null;
    const dex = /\bdexId:\s*\[([\d,\s]*)\]/.exec(texte);
    const cat = /\bcategory:\s*["'](\w+)["']/.exec(texte);
    return {
        nomZh: zh ? zh[2] : null,
        dex: dex ? dex[1].split(',').map(x => parseInt(x, 10)).filter(Number.isFinite) : [],
        categorie: cat ? cat[1] : null,
        cardmarket: [...texte.matchAll(/\bcardmarket:\s*(\d+)/g)].map(m => Number(m[1]))
    };
}

const cleDex = dex => 'D' + [...new Set(dex)].sort((a, b) => a - b).join('+');
const cleNom = nom => 'N' + normaliserNom(nom);

/**
 * Agrège des cartes lues en table { baseZh -> clé }. Un nom qui désigne deux clés différentes est RETIRÉ (ambigu), pas arbitré.
 * @param {Array<{nomZh, dex, categorie, cardmarket}>} cartes
 * @param {(idProduct:number)=>(string|null)} nomCardmarketDe   nom Cardmarket d'un idProduct (catalogue), pour les cartes qui ne sont pas des Pokémon
 */
function agregerTable(cartes, nomCardmarketDe = () => null) {
    const vus = new Map(); const ambigus = new Set(); let sansNom = 0, sansCle = 0;
    const poser = (zh, cle) => { if (vus.has(zh) && vus.get(zh) !== cle) ambigus.add(zh); else vus.set(zh, cle); };
    for (const c of cartes) {
        if (!c.nomZh) { sansNom++; continue; }
        if (c.categorie === 'Pokemon' && c.dex.length) { poser(baseZh(c.nomZh), cleDex(c.dex)); continue; }
        let cle = null;
        for (const id of c.cardmarket) { const n = nomCardmarketDe(id); if (n) { cle = cleNom(decomposerNomCardmarket(n).nom); break; } }
        if (cle) poser(String(c.nomZh).normalize('NFKC').replace(/\s+/g, ''), cle); else sansCle++;
    }
    for (const a of ambigus) vus.delete(a);
    return { table: Object.fromEntries(vus), stats: { cartes: cartes.length, sansNom, sansCle, ambigus: ambigus.size, entrees: vus.size } };
}

/** Clé d'un nom Cardmarket : l'espèce (n° de Pokédex, en retirant au besoin des mots de TÊTE : « Captain », « Hisuian », « Lillie's »), sinon le nom normalisé. dexids = pokedex-dexids.json. */
function fabriquerCleProduit(dexids) {
    return name => {
        const nom = decomposerNomCardmarket(name).nom;
        const mots = nom.split(/\s+/).filter(Boolean);
        for (let i = 0; i < mots.length; i++) {
            const d = dexids[normaliserNom(mots.slice(i).join(' '))];
            if (d && d.length) return cleDex(d);
        }
        return nom ? cleNom(nom) : null;
    };
}

/**
 * NOMS D'ESPÈCES : table multilingue de PokeAPI (data/v2/csv/pokemon_species_names.csv), langues 4 = zh-hant et 12 = zh-hans (languages.csv).
 * LICENCE (lue le 2026-10-31 dans LICENSE.md du dépôt) : BSD 3-Clause, « Copyright (c) 2013-2023 Paul Hallett and PokéAPI contributors » ;
 * https://github.com/PokeAPI/pokeapi/blob/master/LICENSE.md ; les noms de Pokémon sont des marques de Nintendo. Copie locale datée : FICHES-SET/pokeapi/ (une requête par fichier, lue hors ligne ensuite).
 * Un nom chinois partagé par deux espèces est RETIRÉ (ambigu).
 */
function lireEspecesPokeApi(csv) {
    const vus = new Map(), ambigus = new Set();
    for (const ligne of String(csv).split(/\r?\n/).slice(1)) {
        const m = /^(\d+),(4|12),([^,]*),/.exec(ligne);
        if (!m) continue;
        const zh = m[3].normalize('NFKC').replace(/\s+/g, ''), cle = 'D' + m[1];
        if (!zh) continue;
        if (vus.has(zh) && vus.get(zh) !== cle) ambigus.add(zh); else vus.set(zh, cle);
    }
    for (const a of ambigus) vus.delete(a);
    return { table: Object.fromEntries(vus), stats: { entrees: vus.size, ambigus: ambigus.size } };
}

/**
 * NOMS D'ESPÈCES, 2e source INDÉPENDANTE : Wikidata (CC0), libellés zh-hk / zh-hant / zh-hans, joints par le N° DE POKÉDEX NATIONAL (propriété P1685) — JAMAIS par un nom de produit Cardmarket.
 * Entrée : le JSON de résultats SPARQL { results: { bindings: [{ n, hk?, hant?, hans? }] } } (ou tout export qui s'y ramène). La provenance est OBLIGATOIRE : { licence, luLe }.
 * Un libellé partagé par deux numéros est RETIRÉ (ambigu) ; un numéro qui n'est pas un entier est ignoré et compté.
 */
function lireEspecesWikidata(json, { licence, luLe, variantes = null } = {}) {
    if (!licence || !luLe) throw new Error('lireEspecesWikidata : la licence et la date de lecture sont obligatoires (provenance de la table)');
    const vus = new Map(), ambigus = new Set(); let illisibles = 0;
    for (const b of (json && json.results && json.results.bindings) || []) {
        const brut = b.n && b.n.value;
        if (!/^\d+$/.test(String(brut ?? ''))) { illisibles++; continue; }
        const cle = 'D' + Number(brut);
        // libellés de Wikidata par variante de chinois : zh-hk, zh-hant, zh-hans, et les variantes régionales (zh-mo « 比卡超 » porte le nom de Hong Kong/Macao quand zh-hk n'est qu'un repli), zh
        for (const champ of ['hk', 'hant', 'hans', 'cn', 'tw', 'mo', 'sg', 'my', 'zh'].filter(c => !variantes || variantes.includes(c))) {
            const zh = b[champ] && String(b[champ].value).normalize('NFKC').replace(/\s+/g, '');
            if (!zh) continue;
            if (vus.has(zh) && vus.get(zh) !== cle) ambigus.add(zh); else vus.set(zh, cle);
        }
    }
    for (const a of ambigus) vus.delete(a);
    // `contestes` : les libellés ambigus pour Wikidata ; fusionnerEspeces les retire AUSSI de l'autre table (un nom contesté ne traduit rien)
    return { table: Object.fromEntries(vus), contestes: [...ambigus], stats: { entrees: vus.size, ambigus: ambigus.size, numerosIllisibles: illisibles }, meta: { source: 'Wikidata', licence, luLe } };
}

/** PokeAPI OU Wikidata : un nom connu d'une seule source est admis ; connu des deux pour deux espèces différentes, il est RETIRÉ (contradiction), jamais arbitré. */
function fusionnerEspeces(a, b, contestes = []) {
    const sortie = new Map(Object.entries(a)), retires = new Set(contestes.filter(c => sortie.has(c)));
    for (const [zh, cle] of Object.entries(b)) { if (sortie.has(zh) && sortie.get(zh) !== cle) retires.add(zh); else sortie.set(zh, cle); }
    for (const r of retires) sortie.delete(r);
    return { table: Object.fromEntries(sortie), stats: { entrees: sortie.size, contradictions: retires.size } };
}

/** Traducteur : un nom en lettres latines est son propre nom ; une ESPÈCE vient de la table PokeAPI ; tout le reste (Dresseurs, objets, énergies) de la table TCGdex/base (clés « N… » seulement). Sinon null = intraduisible. */
function fabriquerTraducteur({ tableEspeces = {}, tableAutres = {}, cleProduit }) {
    const LATIN = /^[\x20-\x7EÀ-ɏ'’·\-:.&!]+$/;
    return nomZh => {
        const brut = String(nomZh ?? '').normalize('NFKC').trim();
        if (!brut) return null;
        if (LATIN.test(brut)) return cleProduit(brut);
        const plein = brut.replace(/\s+/g, ''), b = baseZh(brut);
        if (tableEspeces[b]) return tableEspeces[b];
        if (tableEspeces[plein]) return tableEspeces[plein];
        const a = tableAutres[plein] ?? null;
        return a && a[0] === 'N' ? a : null;
    };
}
module.exports = { baseZh, lireCarteTs, agregerTable, fabriquerCleProduit, fabriquerTraducteur, lireEspecesPokeApi, lireEspecesWikidata, fusionnerEspeces, cleDex, cleNom };
