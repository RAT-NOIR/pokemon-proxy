// ============================================================
// LA RÈGLE DES DEUX SOURCES (décision du testeur, 2026-10-24) — pour toute FICHE SIMPLE (set, numéro, nom, langue)
// ============================================================
// « Permise SEULEMENT si au moins deux sources concordent sur le set, le numéro et le nom. Cardmarket (export, nom, slug appris) compte pour UNE seule
//   source. La seconde doit être indépendante. Sinon, le produit passe en « à instruire ». Une règle de correspondance non prouvée à 0 faux sur son
//   échantillon n'écrit rien. » + (précision du coordinateur) AUCUNE donnée BULBAPEDIA — archive R2, Setlists, wikitexts, cartes qui en viennent — ne compte
//   comme l'une des deux sources.
// Ce module est PUR : il juge des relevés déjà lus. Une garde s'écrit par ce qu'elle AUTORISE : une source est admise si son nom est dans SOURCES_ADMISES
// (liste fermée) ; toute autre — Bulbapedia en tête — est refusée, nommée.
const { clesNom, cleNumero } = require('./jointure');

/** Les sources indépendantes de Cardmarket ET de Bulbapedia, admises. Une source absente d'ici ne compte pas. */
// (2026-10-24, décision du testeur) la liste LOCALE : dépôts et JSON clonés (type-null, TCGdex, pokemontcg.io), relevés pokedata (pdt), CardTrader (ctr), Pokéllector, pkmncards (pkc), pokemon.com,
// pokemon-card.com, TPC Asie, Pokumon, PikaQian ; plus artofpkm (en cache) et l'API TCGdex (≤ 50 requêtes). Bulbapedia reste exclue par son nom.
const SOURCES_ADMISES = Object.freeze(['tcgdex', 'tpc-asie', 'pokemon-card-com', 'artofpkm', 'pikaqian', 'pokumon', 'pokemontcg.io', 'tcgdex-api', 'type-null', 'pdt', 'ctr', 'pokellector', 'pkc', 'pokemon-com']);
/** Les sources EXCLUES, énumérées pour que le refus se nomme : Bulbapedia sous toutes ses formes. */
const SOURCES_EXCLUES = Object.freeze(['bulbapedia', 'bulbapedia-r2', 'setlist', 'wikitext', 'carte-bulbapedia']);

/** (D4, 2026-10-24) Un nom est LISIBLE s'il est écrit en lettres latines : on peut alors le comparer au nôtre. Absent ou non latin (japonais, chinois, thaï), il ne se compare à rien — seul le n° de Pokédex le fait. */
const nomLisible = s => { const t = String(s ?? '').normalize('NFKC').trim(); return t !== '' && /^[\x20-\x7EÀ-ɏ♂♀'’é·・\-:.&]+$/.test(t); };
const nomCle = s => clesNom(String(s ?? ''));
const memeNom = (a, b) => { const A = nomCle(a); return nomCle(b).some(k => A.includes(k)); };

/**
 * @param {{set: string, numero: string|null, nom: string}} produit  ce que dit Cardmarket (export + numeros_cartes) : le slug du set, le numéro appris, le nom anglais (sans crochets)
 * @param {Array<{source: string, set: string, numero: string|null, nom?: string|null, dex?: number[]|null, ref?: string}>} relevés  ce que disent les autres sources
 * @param {{dexProduit?: number[]|null}} [o]  le n° de Pokédex du produit, pour une source dont le nom n'est pas lisible (ja, th, zh)
 * @returns {{ok: boolean, concordantes: Array, refusees: Array, raison: string|null}}
 */
function juger(produit, relevés, { dexProduit = null } = {}) {
    const concordantes = [], refusees = [];
    for (const r of relevés || []) {
        if (SOURCES_EXCLUES.includes(r.source) || !SOURCES_ADMISES.includes(r.source)) { refusees.push({ source: r.source, raison: SOURCES_EXCLUES.includes(r.source) ? 'source exclue (Bulbapedia)' : 'source hors de la liste admise' }); continue; }
        if (r.set !== produit.set) { refusees.push({ source: r.source, ref: r.ref, raison: `set différent (${r.set})` }); continue; }
        if (produit.numero == null || r.numero == null || cleNumero(String(r.numero)) !== cleNumero(String(produit.numero))) { refusees.push({ source: r.source, ref: r.ref, raison: `numéro différent (${r.numero} / ${produit.numero})` }); continue; }
        const nomOk = r.nom ? memeNom(produit.nom, r.nom) : false;
        // (D4) le repli par le Pokédex ne vaut QUE pour un nom illisible (absent ou non latin) : un nom lisible et discordant est un désaccord, jamais rattrapé par le numéro de Pokédex
        const dexOk = !nomOk && !nomLisible(r.nom) && Array.isArray(r.dex) && r.dex.length && Array.isArray(dexProduit) && dexProduit.length && r.dex.some(x => dexProduit.includes(x));
        if (!nomOk && !dexOk) { refusees.push({ source: r.source, ref: r.ref, raison: `nom discordant (« ${r.nom ?? '—'} » / « ${produit.nom} »)` }); continue; }
        concordantes.push({ source: r.source, ref: r.ref ?? null, set: r.set, numero: r.numero, nom: r.nom ?? null, par: nomOk ? 'nom' : 'pokedex' });
    }
    // INDÉPENDANCE : deux relevés de la MÊME source ne font pas deux sources
    const distinctes = [...new Set(concordantes.map(c => c.source))];
    const ok = distinctes.length >= 1;   // Cardmarket (1) + au moins UNE source indépendante concordante = deux sources
    return { ok, concordantes, refusees, sources: ok ? ['cardmarket', ...distinctes] : ['cardmarket'], raison: ok ? null : (relevés && relevés.length ? 'aucune source indépendante ne concorde sur le set, le numéro et le nom' : 'aucune seconde source ne porte ce produit') };
}

/**
 * (D3, 2026-10-24) REJOUER une confirmation sans se fier à un `ok` écrit : un outil d'écriture relit LUI-MÊME les concordantes d'un produit. Écrite par ce qu'elle AUTORISE :
 * au moins une concordante ; CHAQUE concordante vient d'une source de SOURCES_ADMISES et d'aucune de SOURCES_EXCLUES ; porte le set et le numéro du produit ; et son nom est celui du produit
 * (ou, pour un nom ILLISIBLE seulement, le même n° de Pokédex : `par === 'pokedex'`). Une seule concordante fautive refuse tout : une liste qui en porte une mauvaise n'est pas fiable.
 * @returns {{ok: boolean, motifs: string[]}}
 */
function rejouer(produit, concordantes) {
    const motifs = [];
    if (!Array.isArray(concordantes) || !concordantes.length) return { ok: false, motifs: ['aucune concordante : la seconde source n\'est pas écrite'] };
    for (const c of concordantes) {
        const nom = `source « ${c?.source} »`;
        if (!c || typeof c.source !== 'string') { motifs.push('une concordante sans source'); continue; }
        if (SOURCES_EXCLUES.includes(c.source)) { motifs.push(`${nom} : exclue (Bulbapedia)`); continue; }
        if (!SOURCES_ADMISES.includes(c.source)) { motifs.push(`${nom} : hors de la liste admise`); continue; }
        if (c.set !== produit.set) { motifs.push(`${nom} : set différent (${c.set} / ${produit.set})`); continue; }
        if (produit.numero == null || c.numero == null || cleNumero(String(c.numero)) !== cleNumero(String(produit.numero))) { motifs.push(`${nom} : numéro différent (${c.numero} / ${produit.numero})`); continue; }
        const nomOk = c.nom ? memeNom(produit.nom, c.nom) : false;
        const dexOk = !nomOk && c.par === 'pokedex' && !nomLisible(c.nom);
        if (!nomOk && !dexOk) motifs.push(`${nom} : nom discordant (« ${c.nom ?? '—'} » / « ${produit.nom} »)`);
    }
    return { ok: motifs.length === 0, motifs };
}

/**
 * (V5, 2026-10-26) Les CONTRADICTIONS d'une liste de refusées : un relevé d'une source admise, au MÊME (set, numéro), dont le nom est LISIBLE (lettres latines) et discorde. `juger` ne le voit pas : `ok` reste vrai
 * si une autre source concorde (D3 de la relecture du 24/10). Une voie qui écrit une ligne n'écrit pas contre un relevé lisible qui dit autre chose ; un nom illisible (japonais, chinois) ne contredit rien, il ne compare à rien.
 * Une FINITION en plus (« Pikachu Pokeball Holo » pour « Pikachu ») n'est PAS une contradiction : c'est la même carte dans une autre trame, et PikaQian la liste au même numéro. Écrit par ce qu'il autorise :
 * seule une liste FERMÉE de finitions (Pokeball / Master Ball / Reverse / Holo, en suffixe, une fois) et un reste STRICTEMENT égal au nom du produit (`nomProduit`, sans lui rien n'est excusé) ; tout autre mot
 * (« Alt Art », un autre nom) reste une contradiction — refuser plutôt que poser (0 faux).
 * @returns {object[]} les refusées qui contredisent
 */
const FINITION_EN_SUFFIXE = /\s+(?:(?:pok[eé] ?ball|master ?ball|reverse)(?:\s+holo)?|holo(?:\s+reverse)?)\s*$/i;
const nuNom = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9δ]+/g, '');
function contradictions(refusees, nomProduit = null) {
    return (refusees || []).filter(r => {
        const m = /^nom discordant \(« (.*) » \/ « (.*) »\)$/.exec(String(r?.raison ?? ''));
        if (!m || !nomLisible(m[1])) return false;
        if (nomProduit != null && FINITION_EN_SUFFIXE.test(m[1]) && nuNom(m[1].replace(FINITION_EN_SUFFIXE, '')) === nuNom(nomProduit)) return false;
        return true;
    });
}

module.exports = { juger, rejouer, contradictions, SOURCES_ADMISES, SOURCES_EXCLUES, memeNom, nomLisible };
