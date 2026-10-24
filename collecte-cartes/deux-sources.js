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
const SOURCES_ADMISES = Object.freeze(['tcgdex', 'tpc-asie', 'pokemon-card-com', 'artofpkm', 'pikaqian', 'pokumon', 'pokemontcg.io', 'tcgdex-api']);
/** Les sources EXCLUES, énumérées pour que le refus se nomme : Bulbapedia sous toutes ses formes. */
const SOURCES_EXCLUES = Object.freeze(['bulbapedia', 'bulbapedia-r2', 'setlist', 'wikitext', 'carte-bulbapedia']);

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
        const dexOk = !nomOk && Array.isArray(r.dex) && r.dex.length && Array.isArray(dexProduit) && dexProduit.length && r.dex.some(x => dexProduit.includes(x));
        if (!nomOk && !dexOk) { refusees.push({ source: r.source, ref: r.ref, raison: `nom discordant (« ${r.nom ?? '—'} » / « ${produit.nom} »)` }); continue; }
        concordantes.push({ source: r.source, ref: r.ref ?? null, set: r.set, numero: r.numero, nom: r.nom ?? null, par: nomOk ? 'nom' : 'pokedex' });
    }
    // INDÉPENDANCE : deux relevés de la MÊME source ne font pas deux sources
    const distinctes = [...new Set(concordantes.map(c => c.source))];
    const ok = distinctes.length >= 1;   // Cardmarket (1) + au moins UNE source indépendante concordante = deux sources
    return { ok, concordantes, refusees, sources: ok ? ['cardmarket', ...distinctes] : ['cardmarket'], raison: ok ? null : (relevés && relevés.length ? 'aucune source indépendante ne concorde sur le set, le numéro et le nom' : 'aucune seconde source ne porte ce produit') };
}

module.exports = { juger, SOURCES_ADMISES, SOURCES_EXCLUES, memeNom };
