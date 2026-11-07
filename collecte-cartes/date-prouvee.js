'use strict';
// ============================================================
// DATE PROUVÉE (chasse du 2026-11-07) — règle PURE : une entrée de PREUVES.json + l'état d'un set → ce qu'on pose, ou le refus.
// Aucune base, aucun réseau. Mêmes champs et mêmes formes que poser-dates-sets.js (CLAUDE.md §63, §65, §66) :
//   jour    → dateSortieJa (region jp) ou dateSortieEn (region intl, chinois/indonésien/thaï compris), « January 14, 2022 », + `<champ>Source`, dateSortiePoseeLe
//   mois    → dateSortieMois { iso « 2006-03 », texte « March 2006 », source, le } SEULEMENT (jamais de jour inventé)
//   periode → periodeDistribution { texte, debut, fin, debutIso, source, le } SEULEMENT
// Une garde s'écrit par ce qu'elle AUTORISE : tout ce qui n'est pas explicitement admis est un refus.
//   • jamais d'écrasement : un set qui porte déjà un dateSortie* (même vide : '' est une valeur) est refusé ;
//   • deux sources distinctes de rang >= wiki (officielle, boutique, wiki), ou une officielle seule ; `base` = témoin sans voix ;
//   • codes neutres S1, S2… seuls en base ; aucune phrase ne nomme une autre date complète que celle posée ;
//   • une divergence (une source ou `contre` donne un autre jour) n'écrit rien, SAUF si une source OFFICIELLE porte la date posée : elle l'emporte et la divergence
//     est notée dans `dateSortieDivergence` { codes, valeurs, le } (décision de l'utilisateur, 2026-11-07) ; deux officielles divergentes = refus ;
//   • la base ne reçoit que des CODES de sources et leurs phrases — jamais d'adresse ni de nom d'hôte.
// ============================================================
const SOURCE_LOT = 'chasse-2026-11-07';
const MOIS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const VOIX = new Set(['officielle', 'boutique', 'wiki']);
const RANGS = new Set([...VOIX, 'base']);
const RE_CODE_NEUTRE = /^S\d+$/;
// Toutes les dates COMPLÈTES d'un texte (ISO, « March 27th 2020 », « 27 mars 2020 », « 14. Januar 2022 »), en ISO.
const NOMS_MOIS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
    januar: 1, februar: 2, marz: 3, juni: 6, juli: 7, oktober: 10, dezember: 12,
    // abréviations (accents retirés avant la lecture : « déc. » → « dec. »)
    jan: 1, janv: 1, feb: 2, fev: 2, fevr: 2, mar: 3, apr: 4, avr: 4, jun: 6, jul: 7, juil: 7, aug: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12 };
/**
 * Toutes les dates COMPLÈTES d'un texte, en ISO : « 2022-01-14 », « March 27th 2020 », « Dec 4, 2020 », « 27 mars 2020 », « 4 déc. 2020 », « 14. Januar 2022 »,
 * « 4th of December 2020 », « 2020年12月4日 », « 2020/12/04 ». Une forme numérique « 4/12/2020 » / « 04.12.2020 » est ambiguë : le jeton porte ses lectures
 * valides jointes par « | » (jour/mois et mois/jour) ; une date impossible donne « invalide:… ».
 */
function datesDansTexte(texte) {
    const t = String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const noms = Object.keys(NOMS_MOIS).sort((x, y) => y.length - x.length).join('|'), sortie = new Set();
    const iso = (a, mo, j) => `${a}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
    const ajouter = (a, mo, j) => { const s = iso(a, mo, j); sortie.add(isoValide(s) ? s : `invalide:${s}`); };
    for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) ajouter(m[1], Number(m[2]), Number(m[3]));
    for (const m of t.matchAll(/\b(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/g)) ajouter(m[1], Number(m[2]), Number(m[3]));
    for (const m of t.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) ajouter(m[1], Number(m[2]), Number(m[3]));
    for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(?:of\\s+)?(${noms})\\b\\.?\\s*,?\\s*(\\d{4})\\b`, 'g'))) ajouter(m[3], NOMS_MOIS[m[2]], Number(m[1]));
    for (const m of t.matchAll(new RegExp(`\\b(${noms})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'g'))) ajouter(m[3], NOMS_MOIS[m[1]], Number(m[2]));
    for (const m of t.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
        const lectures = [iso(m[3], Number(m[2]), Number(m[1])), iso(m[3], Number(m[1]), Number(m[2]))].filter((x, i, l) => isoValide(x) && l.indexOf(x) === i);
        sortie.add(lectures.length ? lectures.join('|') : `invalide:${m[0]}`);
    }
    return [...sortie];
}const PRECISIONS = new Set(['jour', 'mois', 'periode']);
const CHAMP_DE_REGION = { jp: 'dateSortieJa', intl: 'dateSortieEn' };
const present = v => v !== null && v !== undefined;
const RE_HOTE = /(https?:|www\.|\/\/|\b[a-z0-9-]+\.(com|net|org|fr|de|io|co|info|eu|jp|cn|tw|tv|me|gg|app)\b)/i;

function isoValide(iso) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(iso || ''));
    if (!m) return null;
    const a = Number(m[1]), mo = Number(m[2]), j = m[3] === undefined ? null : Number(m[3]);
    if (a < 1996 || a > 2035 || mo < 1 || mo > 12) return null;
    if (j !== null) { const d = new Date(Date.UTC(a, mo - 1, j)); if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null; }
    return { a, mo, j };
}
/** « 2022-01-14 » → « January 14, 2022 » (format de la base) ; « 2006-03 » → « March 2006 ». */
function texteDeIso(iso) {
    const p = isoValide(iso);
    if (!p) return null;
    return p.j === null ? `${MOIS[p.mo - 1]} ${p.a}` : `${MOIS[p.mo - 1]} ${p.j}, ${p.a}`;
}

/**
 * @param {object|null} set     document `sets` (au moins _id, region, et les champs de date)
 * @param {object} preuve       entrée { slugSet, date: { valeur, precision, fin?, contre?, sources: [{ code, rang, phrase, adresse?, valeur? }] } }
 * @param {{maintenant?: Date}} [opts]
 * @returns {{set: object, champs: string[]}|{refus: string, detail?: string}}
 */
function dateAPoser(set, preuve, opts = {}) {
    const maintenant = opts.maintenant || new Date();
    const R = (refus, detail) => ({ refus, ...(detail ? { detail } : {}) });
    if (!set || typeof set !== 'object') return R('set-introuvable');
    if (['dateSortie', 'dateSortieEn', 'dateSortieJa', 'dateSortieMois'].some(k => present(set[k]))) return R('deja-datee');
    const d = preuve && preuve.date;
    if (!d || typeof d !== 'object') return R('sans-date');
    if (!PRECISIONS.has(d.precision)) return R('precision-inconnue', String(d.precision));
    if (d.precision === 'periode' && present(set.periodeDistribution)) return R('deja-datee');
    if (!isoValide(d.valeur)) return R('valeur-illisible', String(d.valeur));
    if (d.precision === 'jour' && String(d.valeur).length !== 10) return R('valeur-illisible', 'jour attendu : ' + d.valeur);
    if (d.precision === 'mois' && String(d.valeur).length !== 7) return R('valeur-illisible', 'mois attendu : ' + d.valeur);
    // une période n'est posée que FERMÉE et prouvée des deux bouts : une fin absente ou contestée (P-Promos) est une période non établie
    if (d.precision === 'periode' && !isoValide(d.fin)) return R('periode-non-etablie', 'fin : ' + d.fin);
    const champ = CHAMP_DE_REGION[set.region];
    if (!champ) return R('region-inconnue', String(set.region));
    // sources : distinctes par code, rang connu, phrase écrite. Le rang `base` est un TÉMOIN SANS VOIX : il ne compte pas et n'est pas écrit.
    const toutes = (Array.isArray(d.sources) ? d.sources : []).filter(s => s && typeof s === 'object');
    if (toutes.some(s => typeof s.code !== 'string' || !RE_CODE_NEUTRE.test(s.code))) return R('code-non-neutre', 'les codes en base sont S1, S2… (la table code → site reste dans PREUVES.json)');
    const vues = new Map();
    let sansSite = 0;
    for (const s of toutes) {
        if (!VOIX.has(s.rang) || typeof s.phrase !== 'string' || !s.phrase.trim()) continue;
        // deux codes du même SITE sont une seule source (le premier est gardé)
        // une source sans `site` (chaîne non vide) ne vote pas : sans site, deux codes pourraient être le même site
        if (typeof s.site !== 'string' || !s.site) { sansSite++; continue; }
        if (!vues.has(s.site)) vues.set(s.site, s);
    }
    let sources = [...vues.values()];
    const temoins = toutes.filter(s => s.rang === 'base').length;
    if (!(sources.length >= 2 || sources.some(s => s.rang === 'officielle'))) return R(sansSite ? 'site-absent' : 'sources-insuffisantes', `${sources.length} source(s) de rang >= wiki ; ${temoins} source(s) de rang base = témoins sans voix (il faut 2 sources >= wiki concordantes, ou 1 officielle)`);
    // DIVERGENCE (décision de l'utilisateur, 2026-11-07) : une source OFFICIELLE qui porte la valeur posée l'emporte, et la divergence est NOTÉE ;
    // sans officielle, ou si une officielle contredit (une officielle ne l'emporte pas sur une officielle) : refus.
    const contres = Array.isArray(d.contre) ? d.contre : [];
    const divergentes = toutes.filter(s => present(s.valeur) && s.valeur !== d.valeur);
    let divergence = null;
    if (contres.length || divergentes.length) {
        if (divergentes.some(s => s.rang === 'officielle') || contres.some(c => c && typeof c === 'object' && c.rang === 'officielle')) return R('divergence', 'deux sources officielles divergent');
        if (!sources.some(s => s.rang === 'officielle')) return R('divergence');
        const codes = divergentes.map(s => s.code), valeurs = divergentes.map(s => s.valeur);
        for (const c of contres) {
            const v = typeof c === 'string' ? c : c && typeof c === 'object' ? c.valeur : null;
            if (c && typeof c === 'object' && present(c.code)) { if (typeof c.code !== 'string' || !RE_CODE_NEUTRE.test(c.code)) return R('code-non-neutre', 'contre'); codes.push(c.code); }
            valeurs.push(v);
        }
        if (valeurs.some(v => !isoValide(v))) return R('divergence', 'valeur divergente illisible');
        divergence = { codes: [...new Set(codes)], valeurs: [...new Set(valeurs)], le: maintenant };
        // une source divergente n'est pas une preuve de la date posée : elle n'est notée que dans la divergence
        sources = sources.filter(s => !(present(s.valeur) && s.valeur !== d.valeur));
    }
    if (sources.some(s => RE_HOTE.test(s.code) || RE_HOTE.test(s.phrase))) return R('adresse-dans-la-phrase');
    // une phrase écrite en base ne nomme jamais une autre date complète que celle posée
    const permises = new Set([d.valeur, d.fin].filter(x => typeof x === 'string' && x.length === 10));
    for (const s of sources) { const autre = datesDansTexte(s.phrase).find(x => !x.split('|').some(i => permises.has(i))); if (autre) return R('phrase-autre-date', `${s.code} nomme ${autre}`); }
    // notes (ex. seconde vague) : écrites à part, ne votent pas, peuvent nommer une autre date ; mêmes gardes de code neutre et d'hôte
    const notes = Array.isArray(d.notes) ? d.notes : [];
    for (const n of notes) {
        if (!n || typeof n.code !== 'string' || !RE_CODE_NEUTRE.test(n.code)) return R('code-non-neutre', 'note');
        if (typeof n.phrase !== 'string' || !n.phrase.trim() || typeof n.note !== 'string' || !n.note.trim() || !RANGS.has(n.rang)) return R('note-illisible');
        if (RE_HOTE.test(n.phrase) || RE_HOTE.test(n.note)) return R('adresse-dans-la-phrase', 'note');
    }
    const preuves = [...sources.map(s => ({ code: s.code, rang: s.rang, phrase: s.phrase.trim() })), ...notes.map(n => ({ code: n.code, rang: n.rang, phrase: n.phrase.trim(), note: n.note.trim() }))];
    const source = `${SOURCE_LOT} · ${sources.map(s => s.code).join('+')}`;
    const commun = { dateSortieSource: SOURCE_LOT, dateSortiePreuves: preuves, dateSortiePoseeLe: maintenant, ...(divergence ? { dateSortieDivergence: divergence } : {}) };
    if (d.precision === 'jour') {
        return { set: { [champ]: texteDeIso(d.valeur), [`${champ}Source`]: source, ...commun }, champs: [champ] };
    }
    if (d.precision === 'mois') {
        return { set: { dateSortieMois: { iso: d.valeur, texte: texteDeIso(d.valeur), source, le: maintenant }, ...commun }, champs: ['dateSortieMois'] };
    }
    const debut = texteDeIso(d.valeur), fin = texteDeIso(d.fin);
    return { set: { periodeDistribution: { texte: `${debut} - ${fin}`, debut, fin, debutIso: d.valeur, source, le: maintenant }, ...commun }, champs: ['periodeDistribution'] };
}

/** La ligne imprimée par la simulation pour une date à poser (le CLI imprime par cette fonction) ; la divergence notée y figure, codes et valeurs seulement. */
function lignePosee(d) {
    const p = d.set.dateSortiePreuves, v = d.set.dateSortieDivergence;
    return `   POSÉ   ${d.slugSet} → ${d.champs.join(',')} = ${JSON.stringify(d.set[d.champs[0]])} · ${p.filter(x => !x.note).map(x => x.code).join('+')}${p.some(x => x.note) ? ` · notes : ${p.filter(x => x.note).map(x => `${x.code} « ${x.note} »`).join(' ; ')}` : ''}${v ? ` · divergence notée : ${v.codes.join('+') || '—'} → ${v.valeurs.join(', ')}` : ''}`;
}

/** Le plan sur tout le fichier. Dénominateur = entrées. Un slugSet répété ne se pose qu'une fois. */
function planDesDates(preuves, setsParId, opts = {}) {
    const posees = [], refus = [], vus = new Set();
    for (const p of preuves) {
        const slugSet = p && p.slugSet;
        if (vus.has(slugSet)) { refus.push({ slugSet, refus: 'doublon-dans-le-fichier' }); continue; }
        vus.add(slugSet);
        const vivant = setsParId.get(slugSet) || null;
        const r = dateAPoser(vivant, p, opts);
        if (r.set) posees.push({ slugSet, set: r.set, champs: r.champs, region: vivant.region, tirage: vivant.tirage ?? null }); else refus.push({ slugSet, refus: r.refus, detail: r.detail });
    }
    return { entrees: preuves.length, posees, refus };
}

/**
 * Le filtre de l'updateOne d'écriture, extrait pour être testé : l'écriture n'a lieu que si le set est encore dans l'état planifié (même region/tirage,
 * aucune date posée entre-temps). `set` = le document $set du plan, `plan` = son entrée { slugSet, champs, region, tirage } ; le champ doit être dans `set`.
 */
function filtreEcriture(set, plan) {
    const champ = plan && plan.champs && plan.champs[0];
    if (!champ || !set || !(champ in set)) throw new Error('filtreEcriture : champ de date absent du plan ou du document à poser');
    const f = { _id: plan.slugSet, region: plan.region, tirage: plan.tirage ?? null, dateSortie: null, dateSortieEn: null, dateSortieJa: null, dateSortieMois: { $exists: false } };
    if (champ === 'periodeDistribution') f.periodeDistribution = { $exists: false };
    return f;
}

/** Compare region/tirage du plan à ceux de l'état VIVANT relu juste avant d'écrire ; renvoie la liste des écarts (vide = ok). Un set absent est un écart. */
function ecartsRegionTirage(plan, vivantsParId) {
    const ecarts = [];
    for (const d of plan.posees) {
        const v = vivantsParId.get(d.slugSet);
        if (!v) { ecarts.push(`${d.slugSet} : absent de l'état vivant`); continue; }
        if (v.region !== d.region || (v.tirage ?? null) !== (d.tirage ?? null)) ecarts.push(`${d.slugSet} : region/tirage ${d.region}/${d.tirage} au plan, ${v.region}/${v.tirage ?? null} en vivant`);
    }
    return ecarts;
}

module.exports = { dateAPoser, planDesDates, lignePosee, filtreEcriture, ecartsRegionTirage, datesDansTexte, texteDeIso, isoValide, SOURCE_LOT, RANGS, VOIX };
