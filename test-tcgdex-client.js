// node test-tcgdex-client.js — le client TCGdex (collecte-cartes/tcgdex.js), SANS réseau : un faux transport.
// Ce qu'un client d'une source externe doit porter (§38) : une CADENCE tenue dans une file, un RÉESSAI BORNÉ, une
// garde qui échoue FERMÉE — pas de verrou global tenu, pas de requête. On le fait dire non avant de lui faire confiance (§41).
const { fabriquerClient } = require('./collecte-cartes/tcgdex');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const tenu = { tenu: true, perdu: false };
const faux = (reponses) => {
    const t = { appels: [], enVol: 0, maxEnVol: 0, departs: [] };
    const repondre = async (url) => {
        t.appels.push(url); t.departs.push(Date.now()); t.enVol++; t.maxEnVol = Math.max(t.maxEnVol, t.enVol);
        await new Promise(r => setTimeout(r, 5));
        t.enVol--;
        const r = reponses.shift();
        if (r instanceof Error) throw r;
        return r;
    };
    t.get = url => repondre(url); t.post = (url, corps) => repondre(`${url} ${corps.query}`);
    return t;
};
const erreur = status => Object.assign(new Error(`HTTP ${status}`), { status });

(async () => {
    // 1. LA GARDE FERMÉE
    const sans = fabriquerClient({ transport: faux([{}]), cadenceMs: 1, reessaiMs: 1 });
    verifier('aucun verrou lié : la requête est refusée', await sans.getJSON('/x').then(() => 'passe', e => /verrou/.test(e.message) ? 'refus' : e.message), 'refus');
    const perdu = fabriquerClient({ transport: faux([{}]), cadenceMs: 1, reessaiMs: 1, verrou: { tenu: false, perdu: true } });
    verifier('verrou perdu : la requête est refusée', await perdu.getJSON('/x').then(() => 'passe', e => /verrou/.test(e.message) ? 'refus' : e.message), 'refus');

    // 2. LA CADENCE, dans une file : trois appels lancés ensemble partent un par un, espacés
    const t = faux([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const c = fabriquerClient({ transport: t, cadenceMs: 60, reessaiMs: 1, verrou: tenu });
    const r = await Promise.all([c.getJSON('/1'), c.getJSON('/2'), c.getJSON('/3')]);
    verifier('trois réponses, dans l\'ordre', r.map(x => x.a), [1, 2, 3]);
    verifier('jamais deux requêtes en vol', t.maxEnVol, 1);
    const ecarts = t.departs.slice(1).map((d, i) => d - t.departs[i]);
    verifier('départs espacés d\'au moins la cadence', ecarts.every(e => e >= 55), true);
    verifier('compte des requêtes', c.compteRequetes(), 3);

    // 3. LE RÉESSAI BORNÉ : un échec passe, deux échecs lèvent, un 404 rend null sans réessai
    const t2 = faux([erreur(502), { ok: true }]);
    const c2 = fabriquerClient({ transport: t2, cadenceMs: 1, reessaiMs: 1, verrou: tenu });
    verifier('un 502 puis un succès : succès, deux appels', [await c2.getJSON('/y'), t2.appels.length], [{ ok: true }, 2]);
    const t3 = faux([erreur(502), erreur(502), { jamais: true }]);
    const c3 = fabriquerClient({ transport: t3, cadenceMs: 1, reessaiMs: 1, verrou: tenu });
    verifier('deux 502 : lève, et s\'arrête là', [await c3.getJSON('/z').then(() => 'passe', () => 'leve'), t3.appels.length], ['leve', 2]);
    const t4 = faux([erreur(404)]);
    const c4 = fabriquerClient({ transport: t4, cadenceMs: 1, reessaiMs: 1, verrou: tenu });
    verifier('un 404 : null, un seul appel', [await c4.getJSON('/w'), t4.appels.length], [null, 1]);

    // 4. LES CARTES D'UN SET : pages de 100 jusqu'à une page courte, et rien d'un autre set
    const page = (n, id, depuis) => ({ data: { cards: Array.from({ length: n }, (_, i) => ({ id: `${id}-${depuis + i + 1}`, localId: String(depuis + i + 1), name: 'X', illustrator: 'Y', image: 'u' })) } });
    const p3 = page(37, 'sm1', 200); p3.data.cards.push({ id: 'sm1a-1', localId: '1', name: 'intrus', illustrator: 'Z', image: 'v' });
    const t5 = faux([page(100, 'sm1', 0), page(100, 'sm1', 100), p3]);
    const c5 = fabriquerClient({ transport: t5, cadenceMs: 1, cadenceGraphqlMs: 1, reessaiMs: 1, verrou: tenu });
    const cartes = await c5.cartesDuSet('sm1');
    verifier('pagination : 237 cartes du set, l\'intrus d\'un autre set écarté', [cartes.length, cartes.some(x => x.id === 'sm1a-1')], [237, false]);
    verifier('pagination : trois requêtes', t5.appels.length, 3);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
