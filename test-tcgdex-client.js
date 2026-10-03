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
    // 2026-09-26 (soir) : le filtre est un « contient », et `startsWith('30th-')` prenait `30th-c-001` (le set 30th-c) :
    // le cache `en/30th` portait 188 cartes pour 158. Une carte est du set quand son id est EXACTEMENT « <set>-<localId> ».
    const t6 = faux([{ data: { cards: [{ id: '30th-001', localId: '001', name: 'A' }, { id: '30th-c-001', localId: '001', name: 'B' }, { id: 'tk-xy-p-1', localId: '1', name: 'C' }] } }]);
    const c6 = fabriquerClient({ transport: t6, cadenceMs: 1, cadenceGraphqlMs: 1, reessaiMs: 1, verrou: tenu });
    verifier('« 30th » ne prend pas les cartes de « 30th-c »', (await c6.cartesDuSet('30th')).map(x => x.id), ['30th-001']);
    const t7 = faux([{ data: { cards: [{ id: 'tk-xy-p-1', localId: '1', name: 'C' }, { id: 'tk-xy-p-2', localId: '2', name: 'D' }] } }]);
    const c7 = fabriquerClient({ transport: t7, cadenceMs: 1, cadenceGraphqlMs: 1, reessaiMs: 1, verrou: tenu });
    verifier('un id de set à tirets (tk-xy-p) garde ses cartes', (await c7.cartesDuSet('tk-xy-p')).map(x => x.id), ['tk-xy-p-1', 'tk-xy-p-2']);

    // ➕ 2026-09-29 — une AUTRE langue : autorisée par la liste (id), refusée AVANT toute requête sinon ; l'URL est celle de la langue
    const t8 = faux([{ id: 'SV8s', cards: [] }]);
    const c8 = fabriquerClient({ transport: t8, cadenceMs: 1, reessaiMs: 1, verrou: tenu });
    verifier('langue id : l\'URL est /v2/id/sets/SV8s', [await c8.setLangue('id', 'SV8s').then(r => r.id), t8.appels[0]?.endsWith('/v2/id/sets/SV8s')], ['SV8s', true]);
    const t9 = faux([{}]);
    const c9 = fabriquerClient({ transport: t9, cadenceMs: 1, reessaiMs: 1, verrou: tenu });
    verifier('langue non autorisée (th) : refusée, aucune requête', [await c9.setLangue('th', 'SV8s').then(() => 'passe', e => /non autorisée/.test(e.message) ? 'refus' : e.message), t9.appels.length], ['refus', 0]);
    verifier('identifiant de set qui fermerait l\'URL : refusé, aucune requête', [await c9.setLangue('id', '../x').then(() => 'passe', e => /inattendu/.test(e.message) ? 'refus' : e.message), t9.appels.length], ['refus', 0]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
