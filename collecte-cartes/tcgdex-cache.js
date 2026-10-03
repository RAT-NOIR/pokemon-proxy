// ============================================================
// CE QUE TCGdex A DÉJÀ RÉPONDU — collection `tcgdex_sets` (base `cartes`), et l'appariement expansion → set TCGdex
// ============================================================
// LA REPRISE du §38 : un set lu ne se redemande pas. Un outil qui refait tout à chaque lancement est un outil qu'on n'ose
// pas relancer — donc un outil qu'on lance d'une traite, donc exactement celui qui martèle. Le collecteur d'images et
// les illustrateurs lisent le MÊME cache : la liste d'un set sert aux deux, une seule fois.
// 🔑 L'APPARIEMENT EST L'ÉGALITÉ DU NOM NORMALISÉ, JAMAIS L'INCLUSION (§31 : « M-P Promotional cards » contient
// « P Promotional Cards »). Un nom qui désigne deux sets TCGdex ne désigne rien.
const { normaliserNom } = require('./jointure');
const { estDuSet } = require('./tcgdex');

const COLLECTION = 'tcgdex_sets';

async function listeEn(db, client, { rafraichir = false } = {}) {
    const c = db.collection(COLLECTION);
    const d = rafraichir ? null : await c.findOne({ _id: 'en/__liste__' });
    if (d?.sets?.length) return d.sets;
    const sets = await client.setsEn();
    if (!Array.isArray(sets) || !sets.length) throw new Error('TCGdex : la liste des sets anglais est vide — je ne conclus rien sur un vide');
    const propres = sets.map(s => ({ id: s.id, name: s.name, cardCount: s.cardCount ?? null }));
    await c.updateOne({ _id: 'en/__liste__' }, { $set: { sets: propres, lu: new Date() } }, { upsert: true });
    return propres;
}

async function cartesEn(db, client, id) {
    const c = db.collection(COLLECTION);
    const d = await c.findOne({ _id: `en/${id}` });
    // le set EXACT à la relecture aussi (collecte-cartes/tcgdex.js, `estDuSet`) : le cache garde des cartes écrites par l'ancien
    // filtre « contient » (`en/30th` porte 30 `30th-c`) — les retirer du cache est une suppression, elle attend son feu vert
    if (Array.isArray(d?.cartes)) return { cartes: d.cartes.filter(x => estDuSet(id, x)), cache: true };
    const cartes = await client.cartesDuSet(id);
    await c.updateOne({ _id: `en/${id}` }, { $set: { cartes, n: cartes.length, lu: new Date() } }, { upsert: true });
    return { cartes, cache: false };
}

// ➕ 2026-09-29 : une AUTRE langue (client.setsLangue / setLangue, langues autorisées dans tcgdex.js). Même reprise : `<langue>/__liste__`
// et `<langue>/<set>`, lus une fois. Un set sans carte n'est pas un vide à croire : il lève (§41), il ne s'écrit pas.
async function listeLangue(db, client, langue) {
    const c = db.collection(COLLECTION);
    const d = await c.findOne({ _id: `${langue}/__liste__` });
    if (d?.sets?.length) return d.sets;
    if (!client) return null;
    const sets = await client.setsLangue(langue);
    if (!Array.isArray(sets) || !sets.length) throw new Error(`TCGdex : la liste des sets « ${langue} » est vide — je ne conclus rien sur un vide`);
    const propres = sets.map(s => ({ id: s.id, name: s.name, cardCount: s.cardCount ?? null }));
    await c.updateOne({ _id: `${langue}/__liste__` }, { $set: { sets: propres, lu: new Date() } }, { upsert: true });
    return propres;
}
async function cartesLangue(db, client, langue, id) {
    const c = db.collection(COLLECTION);
    const d = await c.findOne({ _id: `${langue}/${id}` });
    if (Array.isArray(d?.cartes)) return { cartes: d.cartes.filter(x => estDuSet(id, x)), cache: true };
    if (!client) return null;
    const set = await client.setLangue(langue, id);
    const cartes = (set?.cards || []).map(x => ({ id: x.id, localId: x.localId, name: x.name, image: x.image ?? null })).filter(x => estDuSet(id, x));
    if (!cartes.length) throw new Error(`TCGdex ${langue}/${id} : aucune carte — je ne conclus rien sur un vide`);
    await c.updateOne({ _id: `${langue}/${id}` }, { $set: { cartes, n: cartes.length, nom: set.name ?? null, lu: new Date() } }, { upsert: true });
    return { cartes, cache: false };
}

/** nom d'expansion (Bulbapedia) → set TCGdex, par égalité du nom normalisé ; `ambigu` si deux sets portent ce nom. */
function fabriquerAppariement(sets) {
    const parNom = new Map();
    for (const s of sets) { const k = normaliserNom(s.name); (parNom.get(k) || parNom.set(k, []).get(k)).push(s); }
    // 🔑 UNE SEULE VARIANTE, NOMMÉE : Bulbapedia écrit « EX Unseen Forces », TCGdex « Unseen Forces » — 49 expansions,
    // 2 640 impressions sans set au premier passage (§30 : l'orthographe d'une source cherchée chez l'autre rend un vide).
    // Elle ne joue que si l'égalité exacte a échoué, exige l'unicité, et se DIT dans le résultat (`variante`).
    const essayer = k => { const l = parNom.get(k) || []; return l.length === 1 ? { set: l[0] } : l.length ? { ambigu: l.map(s => s.id) } : null; };
    // ➕ 2026-09-26 (soir) : la seconde, NOMMÉE elle aussi — Bulbapedia écrit « Platinum: Arceus », TCGdex « Arceus » (pl4) ;
    // l'audit occidental rangeait ses 111 cartes en « aucun set TCGdex » (§30). Mesuré : une seule ligne porte ce préfixe (AR).
    const PREFIXES = [{ re: /^EX\s+(?=\S)/i, dit: 'sans le préfixe « EX »' }, { re: /^Platinum:\s*(?=\S)/i, dit: 'sans le préfixe « Platinum: »' }];
    return nom => {
        const exact = essayer(normaliserNom(nom));
        if (exact) return exact;
        const p = PREFIXES.find(x => x.re.test(nom));
        if (!p) return null;
        const v = essayer(normaliserNom(nom.replace(p.re, '')));
        return v ? { ...v, variante: p.dit } : null;
    };
}

/** Le set TCGdex d'une LIGNE de table : tous ses noms d'expansion doivent désigner le MÊME set, sinon rien. */
function setDeLaLigne(L, apparier) {
    const noms = [].concat(L?.bulba?.expansion || []);
    if (!noms.length) return { motif: 'la ligne ne nomme aucune expansion' };
    const r = noms.map(n => ({ n, a: apparier(n) }));
    const amb = r.find(x => x.a?.ambigu); if (amb) return { motif: `« ${amb.n} » désigne plusieurs sets TCGdex : ${amb.a.ambigu.join(', ')}` };
    const ids = [...new Set(r.filter(x => x.a?.set).map(x => x.a.set.id))];
    if (!ids.length) return { motif: `aucun set TCGdex ne s'appelle ${noms.map(n => `« ${n} »`).join(' ou ')}` };
    if (ids.length > 1 || r.some(x => !x.a)) return { motif: `les noms de la ligne désignent des sets différents : ${r.map(x => `${x.n} → ${x.a?.set?.id ?? '∅'}`).join(', ')}` };
    return { set: r[0].a.set };
}

// 🔑 LES SOUS-SETS QUE TCGdex RANGE À PART et que Bulbapedia range DANS l'expansion (numéros TG01…, GG01…) : sans eux, les
// 190 impressions TG/GG de cinq sets tombaient en « absente-de-tcgdex » — dont 50 scans japonais de Brilliant Stars et
// Lost Origin (2026-09-23). L'orthographe d'une source cherchée chez l'autre rend un vide (§30) : c'était celle-là.
// Énumérés par ce qu'ils SONT (le petit ensemble stable des suffixes), et par le nom EXACT « <set> <suffixe> » — jamais
// par l'inclusion (§31) : « Stars » ne prend pas « Brilliant Stars Trainer Gallery ».
// ➕ 2026-09-26 (soir) : « Shiny Vault » (SV1…SV94) — Hidden Fates (sma) et Shining Fates (swsh4.5sv), mesurés : ce sont les
// deux seuls noms de la liste qui le portent, et Bulbapedia range ces cartes dans l'expansion (HIF : 69 + 94 = 163/163).
const SUFFIXES_COMPAGNONS = ['Trainer Gallery', 'Galarian Gallery', 'Shiny Vault'];
function compagnonsDuSet(set, sets) {
    const voulus = new Set(SUFFIXES_COMPAGNONS.map(s => normaliserNom(`${set.name} ${s}`)));
    return sets.filter(s => s.id !== set.id && voulus.has(normaliserNom(s.name)));
}

module.exports = { COLLECTION, listeEn, cartesEn, listeLangue, cartesLangue, fabriquerAppariement, setDeLaLigne, compagnonsDuSet, SUFFIXES_COMPAGNONS };
