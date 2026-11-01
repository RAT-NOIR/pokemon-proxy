// ============================================================
// UN RELEVÉ DE DATES SOURCÉ HORS BULBAPEDIA — lu par poser-dates-sets.js (--releves=<fichier.json>)
// ============================================================
// Format d'une entrée (clé = _id du set) :
//   { jour: "January 25, 2019", url, sources2: [url | { url, jour?, citation?, lu? }], citation, lu: "AAAA-MM-JJ" }
// Les clés qui commencent par « _ » (_format, _EN_ATTENTE) sont IGNORÉES et COMPTÉES : rien de ce qu'elles portent n'est écrit.
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : une entrée n'est ADMISE que si elle porte un jour complet, au moins DEUX adresses
// https distinctes, une citation, une date de lecture, et qu'aucune source ne donne un autre jour. Tout le reste est REFUSÉ avec sa
// raison — un relevé incomplet, à une seule source ou discordant n'écrit rien.
// Le rang : « officielle » si une des adresses est d'un domaine officiel (liste fermée ci-dessous), sinon « tierce » (sous Bulbapedia).
// Ce module ne lit ni la base ni le réseau ; jourComplet / isoPartiel sont INJECTÉS (une seule définition, celle de poser-dates-sets.js).

// Le petit ensemble STABLE : les domaines des éditeurs officiels (The Pokémon Company et ses sites régionaux). Tout autre est tiers.
const DOMAINES_OFFICIELS = ['pokemon.com', 'pokemon.cn', 'pokemon-card.com', 'pokemon.co.jp'];
const hoteDe = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
const estOfficiel = url => { const h = hoteDe(url); return !!h && DOMAINES_OFFICIELS.some(d => h === d || h.endsWith(`.${d}`)); };
const rangDe = urls => (urls.some(estOfficiel) ? 'officielle' : 'tierce');
const cleUrl = url => { try { const u = new URL(url); return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`; } catch { return null; } };
const LU = /^\d{4}-\d{2}-\d{2}$/;

function lireReleves(brut, { jourComplet, isoPartiel }) {
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) throw new Error('relevé de dates : un objet { _id du set: entrée } est attendu');
    const cles = Object.keys(brut);
    const ignorees = cles.filter(k => k.startsWith('_'));
    const entrees = cles.filter(k => !k.startsWith('_'));
    // Un instrument qui ne lit rien ne rend pas « zéro » : il lève (un fichier sans entrée est un fichier mal nommé).
    if (!entrees.length) throw new Error(`relevé de dates : aucune entrée lisible (clés vues : ${cles.join(', ') || 'aucune'})`);
    const admis = {}, refus = [];
    for (const id of entrees) {
        const e = brut[id];
        const raisons = [];
        if (!e || typeof e !== 'object' || Array.isArray(e)) { refus.push({ id, raison: 'entrée qui n\'est pas un objet' }); continue; }
        const jour = jourComplet(e.jour);
        if (!jour) raisons.push(`jour absent ou pas un jour complet (« ${String(e.jour ?? '')} »)`);
        const citation = typeof e.citation === 'string' ? e.citation.trim() : '';
        if (!citation) raisons.push('citation manquante');
        const lu = typeof e.lu === 'string' ? e.lu.trim() : '';
        if (!LU.test(lu)) raisons.push(`date de lecture manquante ou mal formée (« ${lu} »)`);
        // Les sources : la première (url du relevé) puis sources2 ; une chaîne hérite de la citation et de la lecture de l'entrée.
        const brutes = [{ url: e.url, jour: null, citation, lu }, ...(Array.isArray(e.sources2) ? e.sources2 : []).map(s => (typeof s === 'string' ? { url: s } : s || {}))];
        const sources = brutes.map(s => ({ url: typeof s.url === 'string' ? s.url.trim() : '', jour: s.jour ?? null, citation: (typeof s.citation === 'string' && s.citation.trim()) || citation, lu: (typeof s.lu === 'string' && s.lu.trim()) || lu }));
        const manquantes = sources.filter(s => !s.url);
        if (manquantes.length) raisons.push(brutes[0].url ? 'une source sans url' : 'url manquante');
        const avecUrl = sources.filter(s => s.url);
        if (avecUrl.some(s => !/^https:\/\//i.test(s.url))) raisons.push('une url n\'est pas en https');
        const distinctes = new Set(avecUrl.map(s => cleUrl(s.url)).filter(Boolean));
        if (distinctes.size < 2) raisons.push(`deux sources distinctes sont exigées (${distinctes.size} lue${distinctes.size > 1 ? 's' : ''})`);
        for (const s of avecUrl) {
            if (!s.jour) continue;
            const j = jourComplet(s.jour);
            if (!j || j !== jour) raisons.push(`discordance au jour près : ${s.url} dit « ${s.jour} », le relevé « ${e.jour} »`);
            if (!LU.test(s.lu) || !s.citation) raisons.push(`la source ${s.url} n'a pas de citation ou de lecture`);
        }
        if (raisons.length) { refus.push({ id, raison: raisons.join(' ; ') }); continue; }
        admis[id] = { jour, iso: isoPartiel(jour), rang: rangDe(avecUrl.map(s => s.url)), sources: avecUrl.map(s => ({ url: s.url, citation: s.citation, lu: s.lu })), citation, lu };
    }
    return { admis, refus, denominateur: { cles: cles.length, ignorees: ignorees.length, ignoreesNoms: ignorees, entrees: entrees.length, admises: Object.keys(admis).length, refusees: refus.length } };
}

/** « source » écrite dans la base : de quoi relire chaque lecture sans rouvrir le fichier. */
const sourceEcrite = a => `relevé ${a.rang} à deux sources concordantes (${a.jour}) : ${a.sources.map(s => `${s.url} (lu le ${s.lu})`).join(' + ')} — « ${a.citation} »`;

module.exports = { lireReleves, rangDe, estOfficiel, sourceEcrite, DOMAINES_OFFICIELS };
