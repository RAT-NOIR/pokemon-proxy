// TEST — collecte-cartes/verrou-source.js, sur un modèle EN MÉMOIRE. Aucune base, aucun réseau.
//   node test-verrou-source.js      -> code 0 si tout passe
// Le modèle factice imite ce que le verrou demande à Mongo : égalité sur chemins pointés, $exists,
// $lt, $or ; $set / $unset / $setOnInsert ; upsert qui lève 11000 quand l'_id existe et que le filtre
// ne matche pas. ⚠️ C'est un modèle de la sémantique, pas Mongo : il prouve la LOGIQUE du verrou.
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');

const lire = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function correspond(doc, f) {
    return Object.entries(f).every(([k, v]) => {
        if (k === '$or') return v.some(s => correspond(doc, s));
        const val = lire(doc, k);
        if (v && typeof v === 'object' && !(v instanceof Date)) {
            if ('$exists' in v) return (val !== undefined) === v.$exists;
            if ('$lt' in v) return val !== undefined && val < v.$lt;
        }
        return val instanceof Date && v instanceof Date ? +val === +v : val === v;
    });
}
function ecrire(o, p, v) { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) a = a[k] ??= {}; a[ks.at(-1)] = v; }
function effacer(o, p) { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) { a = a?.[k]; } if (a) delete a[ks.at(-1)]; }
function appliquer(doc, u, insertion) {
    for (const [p, v] of Object.entries(u.$set || {})) ecrire(doc, p, structuredClone(v));
    for (const p of Object.keys(u.$unset || {})) effacer(doc, p);
    if (insertion) for (const [p, v] of Object.entries(u.$setOnInsert || {})) ecrire(doc, p, structuredClone(v));
}
function modeleFactice() {
    const docs = new Map();
    const lean = v => ({ lean: async () => (v ? structuredClone(v) : null) });
    return {
        docs,
        findOneAndUpdate: (f, u, o) => ({
            lean: async () => {
                const d = docs.get(f._id);
                if (d && correspond(d, f)) { appliquer(d, u, false); return structuredClone(d); }
                if (d) { const e = new Error('E11000'); e.code = 11000; throw e; }
                if (!o.upsert) return null;
                const n = { _id: f._id }; appliquer(n, u, true); docs.set(f._id, n); return structuredClone(n);
            }
        }),
        updateOne: async (f, u) => {
            const d = docs.get(f._id);
            if (!d || !correspond(d, f)) return { matchedCount: 0, modifiedCount: 0 };
            appliquer(d, u, false); return { matchedCount: 1, modifiedCount: 1 };
        },
        findById: id => lean(docs.get(id))
    };
}

let ok = 0, ko = 0;
const verifier = (nom, cond) => { if (cond) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}`); } };
const dormir = ms => new Promise(r => setTimeout(r, ms));
const podA = { pid: 52, hote: 'srv-…-25grd', jeton: 'A' };
const podB = { pid: 52, hote: 'srv-…-9xq7k', jeton: 'B' };
const podA2 = { pid: 52, hote: 'srv-…-25grd', jeton: 'A2' };   // conteneur relancé sur place : même pid, même hôte

(async () => {
    const silence = console.error; const warn = console.warn;
    console.error = () => { }; console.warn = () => { };
    try {
        const M = modeleFactice();
        const pertes = { A: 0, B: 0, A2: 0 };
        const V = (id, qui, cle, extra = {}) => fabriquerVerrou({ Modele: M, id, dureeMs: 3 * 60 * 1000, battementMs: 20, identite: qui, surPerte: () => pertes[cle]++, nom: cle, ...extra });

        console.log = (orig => (...a) => orig(...a))(console.log);
        const A = V('g', podA, 'A', { surInsertion: { phase: 'collecteur' } }), B = V('g', podB, 'B');
        verifier('A prend un verrou libre', (await A.prendre()) === null && M.docs.get('g').verrou.jeton === 'A' && M.docs.get('g').phase === 'collecteur');
        const tenuParA = await B.prendre();
        verifier('B ne prend pas un verrou frais, et dit qui le tient', tenuParA?.jeton === 'A' && tenuParA?.pid === 52);
        const A2 = V('g', podA2, 'A2');
        verifier('même pid ET même hôte, autre jeton : PAS le sien (pod relancé sur place)', (await A2.prendre())?.jeton === 'A');
        verifier('A tient', await A.tient());

        // DÉFAUT 1 — rendre n'efface que SON verrou
        await A.rendre();
        verifier('A rend : libre', M.docs.get('g').verrou === undefined);
        verifier('B prend après A', (await B.prendre()) === null);
        const r = await A.rendre();
        verifier('A rend une 2e fois : ne touche PAS au verrou de B', r.rendu === false && M.docs.get('g').verrou.jeton === 'B');
        const A3 = V('g', { ...podA, jeton: 'A3' }, 'A');
        await A3.rendre();
        verifier('un processus qui n\'a jamais pris ne rend rien', M.docs.get('g').verrou.jeton === 'B');

        // DÉFAUT 3 — le battement LIT son résultat : effacé par un tiers (ancien code) = perte
        delete M.docs.get('g').verrou;
        await dormir(80);
        verifier('battement à 0 document : B se sait PERDU, surPerte appelé une fois', B.perdu === true && pertes.B === 1);
        verifier('B ne tient plus', (await B.tient()) === false && pertes.B === 1);
        verifier('B perdu ne rend rien et ne recrée rien', (await B.rendre()).rendu === false && M.docs.get('g').verrou === undefined);

        // REVÉRIFICATION AVANT CHAQUE SET — verrou repris par un autre après expiration
        const C = V('h', podA, 'A'), D = V('h', podB, 'B');
        pertes.A = 0; pertes.B = 0;
        await C.prendre();
        M.docs.get('h').verrou.depuis = new Date(Date.now() - 4 * 60 * 1000);   // C ne bat plus depuis 4 min
        verifier('D prend un verrou dont le battement est périmé', (await D.prendre()) === null);
        verifier('C revérifie avant son set : non tenu, perte signalée', (await C.tient()) === false && C.perdu && pertes.A === 1);
        await C.rendre();
        verifier('C rend après perte : le verrou de D intact', M.docs.get('h').verrou.jeton === 'B');

        // ZOMBIE — verrou sans propriétaire
        M.docs.set('z', { _id: 'z', verrou: { depuis: new Date() } });
        verifier('un verrou sans pid se prend', (await V('z', podB, 'B').prendre()) === null);

        // BATTEMENT EN ÉCHEC RÉSEAU : pas une perte
        const E = V('e', podA, 'A');
        pertes.A = 0;
        await E.prendre();
        const upd = M.updateOne; M.updateOne = async () => { throw new Error('réseau'); };
        await dormir(80);
        verifier('battement en erreur réseau : PAS une perte', E.perdu === false && pertes.A === 0);
        M.updateOne = upd;
        await dormir(40);
        verifier('réseau revenu : le battement repasse et tient', E.perdu === false && (await E.tient()));
        // RENDRE POUR DORMIR, REPRENDRE AU RÉVEIL (2026-09-14) — et un tiers passe pendant le sommeil
        const W = V('w', podA, 'A'), X = V('w', podB, 'B');
        pertes.A = 0;
        await W.prendre(); await W.rendre();
        verifier('rendu pour dormir : ni tenu ni perdu, aucune perte signalée', !W.tenu && !W.perdu && pertes.A === 0);
        verifier('pendant le sommeil, un tiers prend le verrou', (await X.prendre()) === null);
        verifier('au réveil, le worker ATTEND : le verrou est au tiers', (await W.prendre())?.jeton === 'B');
        await X.rendre();
        verifier('le tiers rend : le worker reprend', (await W.prendre()) === null && W.tenu && (await W.tient()));
        for (const v of [A, B, A2, C, D, E, W, X]) await v.rendre();
    } finally { console.error = silence; console.warn = warn; }
    console.log(`\n${ok} / ${ok + ko} vérifications`);
    process.exit(ko ? 1 : 0);
})();
