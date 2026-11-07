// node test-deduction-page-route.js — banc PUR (aucune base, aucun réseau) : sur la ROUTE (/api/apprendre-lot → apprendreLot), l'ADRESSE de la
// page (`urlPage`, userscript 1.13) prouve l'expansion NEUVE, comme `expansionParLaPage` le fait déjà sur la voie du journal.
// Cas du testeur, 2026-11-01 : expansion 6704 (Storm Emeralda / Delta Reign, 141 produits, tous « cardImageNotAvailable ») — le serveur a
// reçu 141 cartes et refusé les 141 : « slugSet porté par 0 expansions apprises ». apprendreLot est appelé EXACTEMENT comme la route
// (index.js : apprendreLot(cartes, { numeros, catalogue, decoderCodeSet, memoriserCodeSet, userId })) sur des collections factices.
const { apprendreLot, normaliserCarte } = require('./collecte-cartes/deduire-produit');
const { decoderCodeSet } = require('./collecte-cartes/codes-set');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── collections factices : find().toArray(), distinct, countDocuments, bulkWrite, findOne, updateOne (upsert $setOnInsert / $set)
function correspond(doc, filtre) {
    return Object.entries(filtre || {}).every(([k, cond]) => {
        if (k === '$or') return cond.some(f => correspond(doc, f));
        const v = doc[k];
        if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
            return Object.entries(cond).every(([op, x]) => {
                if (op === '$in') return x.includes(v);
                if (op === '$ne') return v !== x;
                if (op === '$type') return x === 'string' ? typeof v === 'string' : false;
                throw new Error(`opérateur non géré par le banc : ${op}`);
            });
        }
        return v === cond;
    });
}
function collection(docs) {
    return {
        docs,
        find: f => ({ toArray: async () => docs.filter(d => correspond(d, f)).map(d => ({ ...d })) }),
        distinct: async (champ, f) => [...new Set(docs.filter(d => correspond(d, f)).map(d => d[champ]))],
        countDocuments: async f => docs.filter(d => correspond(d, f)).length,
        findOne: async f => { const d = docs.find(x => correspond(x, f)); return d ? { ...d } : null; },
        bulkWrite: async () => { throw new Error('bulkWrite inattendu : ces lots ne portent aucune carte lue'); },
        updateOne: async (f, u, o = {}) => {
            const d = docs.find(x => correspond(x, f));
            if (d) { if (!u.$set) return { modifiedCount: 0 }; Object.assign(d, u.$set); return { modifiedCount: 1 }; }
            if (o.upsert && u.$setOnInsert) { docs.push({ ...u.$setOnInsert }); return { upsertedCount: 1 }; }
            return { upsertedCount: 0, modifiedCount: 0 };
        }
    };
}
const URL_6704 = '/en/Pokemon/Products/Singles?searchMode=v2&idCategory=51&idExpansion=6704&idRarity=0&sortBy=name_asc';
const CAT = [
    { idProduct: 11, idExpansion: 6704, name: 'Heracross [Spike Draw | High Horsepower]' },
    { idProduct: 12, idExpansion: 6704, name: 'Surskit [Multiply | Bug Bite]' },
    { idProduct: 13, idExpansion: 6704, name: 'Masquerain [Frightening Pattern | Bug Out]' },
    { idProduct: 14, idExpansion: 6704, name: 'Masquerain [Frightening Pattern | Bug Out]' }
];
const vignette = (slug, urlPage) => ({ idProduct: null, slug, slugSet: 'Delta-Reign', nomFr: slug, sansImage: true, ...(urlPage !== undefined ? { urlPage } : {}) });
const silence = { log() {}, warn() {}, error() {} };
async function lot(cartes, appris = []) {
    const numeros = collection(appris.map(d => ({ ...d }))), catalogue = collection(CAT.map(d => ({ ...d })));
    const memo = [];
    const r = await apprendreLot(cartes, { numeros, catalogue, decoderCodeSet, memoriserCodeSet: async (...a) => { memo.push(a); }, journal: silence, userId: 'banc' });
    return { r, numeros };
}

(async () => {
    // 1. le cas du testeur : deux vignettes, l'adresse de la page prouve l'expansion neuve
    const { r: r1, numeros: n1 } = await lot([vignette('Heracross', URL_6704), vignette('Surskit', URL_6704)]);
    verifier('1a. deux vignettes sans image, page idExpansion=6704 → 2 déduites', [r1.deduites, r1.nonDeduites], [2, 0]);
    verifier('1b. idsDeduits porte les deux produits', r1.idsDeduits.map(d => d.idProduct).sort(), [11, 12]);
    verifier('1c. lignes écrites : déduite, expansion 6704, preuve « expansion lue dans l\'adresse de la page »',
        n1.docs.length === 2 && n1.docs.every(d => d.certitude === 'deduite' && d.idExpansion === 6704 && /expansion lue dans l'adresse de la page/.test(d.preuveDeduction)), true);
    verifier('1d. la réponse porte idExpansion 6704 et une couverture', [r1.idExpansion, r1.couverture && r1.couverture.produits, r1.couverture && r1.couverture.appris], [6704, 4, 2]);

    // 2. sans urlPage : le comportement d'aujourd'hui, inchangé
    const { r: r2, numeros: n2 } = await lot([vignette('Heracross'), vignette('Surskit')]);
    verifier('2. sans urlPage → 0 déduite, « porté par # expansions »', [r2.deduites, n2.docs.length, Object.keys(r2.raisonsNonDeduites).every(k => /porté par # expansions/.test(k)), r2.idExpansion], [0, 0, true, null]);

    // 3. adresse d'une autre catégorie, ou à deux idExpansion → rien
    const { r: r3a } = await lot([vignette('Heracross', '/en/Pokemon/Products/Singles?idCategory=1&idExpansion=6704'), vignette('Surskit', '/en/Pokemon/Products/Singles?idCategory=1&idExpansion=6704')]);
    verifier('3a. idCategory=1 → 0 déduite', r3a.deduites, 0);
    const { r: r3b } = await lot([vignette('Heracross', '/en/Pokemon/Products/Singles?idExpansion=6704&idExpansion=6705'), vignette('Surskit', '/en/Pokemon/Products/Singles?idExpansion=6704&idExpansion=6705')]);
    verifier('3b. deux idExpansion → 0 déduite', [r3b.deduites, r3b.idExpansion], [0, null]);
    const { r: r3c } = await lot([vignette('Heracross', URL_6704), vignette('Surskit', '/en/Pokemon/Products/Singles?idCategory=51&idExpansion=6705')]);
    verifier('3c. deux vignettes du slugSet vues sous deux idExpansion → 0 déduite (TOUTES doivent le porter)', r3c.deduites, 0);

    // 4. un nom à deux produits non appris → refusé, les autres déduites
    const { r: r4 } = await lot([vignette('Heracross', URL_6704), vignette('Masquerain-V1', URL_6704), vignette('Surskit', URL_6704)]);
    verifier('4a. Masquerain (2 produits au nom) refusé, les deux autres déduites', [r4.deduites, r4.nonDeduites, r4.idsDeduits.map(d => d.idProduct).sort()], [2, 1, [11, 12]]);
    verifier('4b. …raison « # produits non appris »', Object.keys(r4.raisonsNonDeduites).some(k => /# produits non appris/.test(k)), true);

    // 5. normaliserCarte : urlPage bornée
    const base = { idProduct: null, slug: 'Heracross', slugSet: 'Delta-Reign', sansImage: true };
    verifier('5a. urlPage non-chaîne → null', [42, {}, ['/a'], true, null].map(x => normaliserCarte({ ...base, urlPage: x }).urlPage), [null, null, null, null, null]);
    verifier('5b. urlPage > 512 caractères → null', normaliserCarte({ ...base, urlPage: '/' + 'a'.repeat(512) }).urlPage, null);
    verifier('5c. urlPage de 512 caractères pile → gardée', normaliserCarte({ ...base, urlPage: '/' + 'a'.repeat(511) }).urlPage, '/' + 'a'.repeat(511));
    verifier('5d. urlPage ne commençant pas par « / » → null', ['https://x.example/a', 'en/Pokemon', ''].map(x => normaliserCarte({ ...base, urlPage: x }).urlPage), [null, null, null]);
    verifier('5e. urlPage valide → gardée telle quelle', normaliserCarte({ ...base, urlPage: URL_6704 }).urlPage, URL_6704);
    verifier('5f. urlPage absente → null', normaliserCarte(base).urlPage, null);

    // 6. l'expansion est DÉJÀ apprise (une ligne idExpansion 6704) → la page ne prouve rien (règle existante)
    const { r: r6, numeros: n6 } = await lot([vignette('Heracross', URL_6704), vignette('Surskit', URL_6704)], [{ idProduct: 99, idExpansion: 6704, slugSet: null, slug: null, numero: '5', source: 'cardmarket', certitude: 'exacte' }]);
    verifier('6. expansion déjà apprise → 0 déduite, « la page ne prouve rien », et la réponse reste « exp ? » (idExpansion null, pas de couverture)', [r6.deduites, n6.docs.length, Object.keys(r6.raisonsNonDeduites).some(k => /la page ne prouve rien/.test(k)), r6.idExpansion, r6.couverture], [0, 1, true, null, null]);
    // 3d. rien déduit malgré une page valide (nom inconnu du catalogue) → pas d'idExpansion non plus
    const { r: r7 } = await lot([vignette('Inconnu', URL_6704)]);
    verifier('7. page valide mais rien de déduit → idExpansion null (garde : au moins une déduite par la page)', [r7.deduites, r7.idExpansion, r7.couverture], [0, null, null]);

    // ══ CAS ADVERSES (second relecteur, 2026-11-07) : le client peut mentir sur `urlPage` — chaque cas DOIT finir en 0 ligne écrite ══
    const Q = '/en/Pokemon/Products/Singles';
    let adverses = 0;
    const rien = async (nom, cartes, appris = [], attenduSupp = null) => {
        adverses++;
        const { r, numeros } = await lot(cartes, appris);
        verifier(`ADV ${nom} → 0 déduite, 0 ligne ajoutée, aucune ligne déduite`,
            [r.deduites, numeros.docs.length - appris.length, numeros.docs.some(d => d.certitude === 'deduite' || d.source === 'cardmarket-deduit')], [0, 0, false]);
        if (attenduSupp) verifier(`ADV ${nom} (précision)`, attenduSupp(r), true);
    };
    const deux = u => [vignette('Heracross', u), vignette('Surskit', u)];
    // (a) l'expansion désignée a déjà des lignes apprises
    await rien('a1. expansion 6704 déjà apprise (idExpansion)', deux(URL_6704), [{ idProduct: 99, idExpansion: 6704, slugSet: 'Autre', slug: 'X', numero: '5', source: 'cardmarket', certitude: 'exacte' }]);
    await rien('a2. expansion déjà apprise par une ligne idExpansion=6704 sans slugSet', deux(URL_6704), [{ idProduct: 98, idExpansion: 6704, slugSet: null, slug: null, numero: '1', source: 'tcgdex', certitude: null }]);
    // (b) le slugSet de la vignette a déjà des lignes sous une AUTRE expansion
    await rien('b1. slugSet déjà appris sous l\'expansion 9999', deux(URL_6704), [{ idProduct: 97, idExpansion: 9999, slugSet: 'Delta-Reign', slug: 'Autre', numero: '5', source: 'cardmarket', certitude: 'exacte' }]);
    await rien('b2. slugSet déjà appris par une ligne à idExpansion null', deux(URL_6704), [{ idProduct: 96, idExpansion: null, slugSet: 'Delta-Reign', slug: 'Autre', numero: '5', source: 'cardmarket', certitude: 'exacte' }]);
    // (c) deux vignettes du même slugSet, deux expansions de page différentes
    await rien('c. deux pages d\'expansions différentes', [vignette('Heracross', URL_6704), vignette('Surskit', URL_6704.replace('6704', '6705'))]);
    await rien('c2. même vignette vue sous deux pages — l\'une sans preuve', [vignette('Heracross', URL_6704), vignette('Surskit', Q + '?idCategory=1&idExpansion=6704')]);
    // (d) une vignette avec urlPage, une autre du même slugSet sans
    await rien('d. une avec urlPage, une sans', [vignette('Heracross', URL_6704), vignette('Surskit')]);
    // (e) adresses malformées ou hors périmètre (toutes les vignettes du lot les portent)
    for (const [nom, u] of [
        ['e1. idExpansion doublé (même valeur)', Q + '?idCategory=51&idExpansion=6704&idExpansion=6704'],
        ['e2. idCategory=1', Q + '?idCategory=1&idExpansion=6704'],
        ['e3. idCategory=51 doublée', Q + '?idCategory=51&idCategory=51&idExpansion=6704'],
        ['e4. chemin Magic', '/en/Magic/Products/Singles?idExpansion=6704'],
        ['e5. segment slugSet différent', Q + '/Autre-Set?idExpansion=6704'],
        ['e6. page de produit (deux segments)', Q + '/Delta-Reign/Heracross?idExpansion=6704'],
        ['e7. URL absolue https', 'https://www.cardmarket.com' + Q + '?idExpansion=6704'],
        ['e8. URL sans hôte « // »', '//www.cardmarket.com' + Q + '?idExpansion=6704'],
        ['e9. défi __cf_chl_', Q + '?idExpansion=6704&__cf_chl_tk=abc'],
        ['e10. défi __cf_chl_ encodé en clé', Q + '?__cf_chl_rt_tk=x&idExpansion=6704'],
        ['e11. sans query', Q],
        ['e12. idExpansion=0', Q + '?idExpansion=0'],
        ['e13. idExpansion non numérique', Q + '?idExpansion=67a4'],
        ['e14. idExpansion géant', Q + '?idExpansion=99999999999999999999']
    ]) await rien(nom, deux(u));
    // (f) le slug est déjà porté par un produit appris d'une autre expansion
    await rien('f1. slug déjà porté ailleurs (idExpansion 7000)', deux(URL_6704), [{ idProduct: 95, idExpansion: 7000, slugSet: 'Delta-Reign', slug: 'Heracross', numero: '3', source: 'cardmarket', certitude: 'exacte' }]);
    await rien('f2. slug déjà porté par une ligne à idExpansion null', deux(URL_6704), [{ idProduct: 94, idExpansion: null, slugSet: 'Delta-Reign', slug: 'Heracross', numero: '3', source: 'cardmarket', certitude: 'exacte' }]);
    // (g) nom désignant deux produits non appris
    await rien('g1. Masquerain sans variante (2 produits)', [vignette('Masquerain', URL_6704)], [], r => Object.keys(r.raisonsNonDeduites).some(k => /lien sans variante|# produits non appris/.test(k)));
    await rien('g2. Masquerain-V1 (2 produits non appris)', [vignette('Masquerain-V1', URL_6704)]);
    // (h) deux vignettes désignant le même produit
    await rien('h. deux vignettes pour Heracross', [vignette('Heracross', URL_6704), vignette('Heracross', URL_6704)], [], r => Object.keys(r.raisonsNonDeduites).some(k => /vignettes désignent le produit/.test(k)));
    // (j) urlPage trop longue ou non-chaîne : normaliserCarte la rend null, le slugSet ne reçoit aucune preuve
    await rien('j1. urlPage de 513 caractères', deux(URL_6704 + '&x=' + 'a'.repeat(513 - URL_6704.length - 3)));
    await rien('j2. urlPage nombre', deux(6704));
    await rien('j3. urlPage objet', deux({ toString: () => URL_6704 }));
    await rien('j4. urlPage tableau', deux([URL_6704]));
    verifier('ADV j5. 513 caractères pile → null ; 512 pile → gardée', [normaliserCarte({ ...base, urlPage: URL_6704 + '&x=' + 'a'.repeat(513 - URL_6704.length - 3) }).urlPage, normaliserCarte({ ...base, urlPage: URL_6704 + '&x=' + 'a'.repeat(512 - URL_6704.length - 3) }).urlPage !== null], [null, true]);
    adverses++;

    // (i) une carte LUE avec image dans le même lot, à côté d'une vignette prouvée par la page : elle s'écrit normalement, la déduction aussi
    {
        adverses++;
        const numeros = collection([]);
        numeros.bulkWrite = async ops => { for (const { updateOne: { filter, update, upsert } } of ops) { let d = numeros.docs.find(x => x.idProduct === filter.idProduct); if (!d && upsert) { d = { idProduct: filter.idProduct }; numeros.docs.push(d); } if (d) Object.assign(d, update.$set); } };
        const catalogue = collection(CAT.map(d => ({ ...d })));
        const lue = { idProduct: 500, numero: '5', codeSet: 'XX', slug: 'Autre-Carte', slugSet: 'Autre-Set', nomFr: 'Autre' };
        const r = await apprendreLot([lue, vignette('Heracross', URL_6704)], { numeros, catalogue, decoderCodeSet, memoriserCodeSet: async () => {}, journal: silence, userId: 'banc' });
        const d500 = numeros.docs.find(d => d.idProduct === 500), d11 = numeros.docs.find(d => d.idProduct === 11);
        verifier('ADV i. carte lue écrite normalement (exacte), déduction par la page à côté (deduite)',
            [r.nouvelles, r.deduites, d500 && d500.certitude, d500 && d500.source, d500 && d500.numero, d11 && d11.certitude], [1, 1, 'exacte', 'cardmarket', '5', 'deduite']);
    }
    // (k) une déduction par la page : jamais « exacte », et l'adresse n'est écrite nulle part dans la ligne
    {
        adverses++;
        const { r, numeros } = await lot(deux(URL_6704));
        verifier('ADV k. lignes déduites par la page : certitude « deduite » seulement, source « cardmarket-deduit », aucune « exacte », aucun champ urlPage ni adresse',
            [r.deduites, numeros.docs.every(d => d.certitude === 'deduite' && d.source === 'cardmarket-deduit'), numeros.docs.some(d => d.certitude === 'exacte'), numeros.docs.some(d => 'urlPage' in d || JSON.stringify(d).includes('idCategory'))], [2, true, false, false]);
    }
    console.log(`(cas adverses : ${adverses} blocs)`);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
