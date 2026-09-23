// ============================================================
// CE QUE TCGdex A DÉJÀ RÉPONDU — collection `tcgdex_sets` (base `cartes`), et l'appariement expansion → set TCGdex
// ============================================================
// LA REPRISE du §38 : un set lu ne se redemande pas. Un outil qui refait tout à chaque lancement est un outil qu'on n'ose
// pas relancer — donc un outil qu'on lance d'une traite, donc exactement celui qui martèle. Le collecteur d'images et
// les illustrateurs lisent le MÊME cache : la liste d'un set sert aux deux, une seule fois.
// 🔑 L'APPARIEMENT EST L'ÉGALITÉ DU NOM NORMALISÉ, JAMAIS L'INCLUSION (§31 : « M-P Promotional cards » contient
// « P Promotional Cards »). Un nom qui désigne deux sets TCGdex ne désigne rien.
const { normaliserNom } = require('./jointure');

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
    if (Array.isArray(d?.cartes)) return { cartes: d.cartes, cache: true };
    const cartes = await client.cartesDuSet(id);
    await c.updateOne({ _id: `en/${id}` }, { $set: { cartes, n: cartes.length, lu: new Date() } }, { upsert: true });
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
    return nom => {
        const exact = essayer(normaliserNom(nom));
        if (exact) return exact;
        if (!/^EX\s+\S/i.test(nom)) return null;
        const v = essayer(normaliserNom(nom.replace(/^EX\s+/i, '')));
        return v ? { ...v, variante: 'sans le préfixe « EX »' } : null;
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

module.exports = { COLLECTION, listeEn, cartesEn, fabriquerAppariement, setDeLaLigne };
