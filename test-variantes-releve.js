// node test-variantes-releve.js — TAMPONS-RELEVE B : variantes des V2 tamponnés du relevé du testeur (collecte-cartes/variantes-releve.js).
// Faux objets seulement (base en mémoire, CSV en chaîne) : aucune base réelle, aucun dossier du testeur, aucune requête réseau. Ce que le banc garde :
//   · le vocabulaire est FERMÉ (ni « autre » ni « enseigne », ordre de la liste) ; la table des 13 est confrontée au CSV (colonne, mots de l'URL) ;
//   · V1 « normale » seulement si le plus ancien STRICTEMENT, sans étiquette, non désigné par le relevé ; l'entrée d'image n'est écrite que si la séparation est prouvée ET qu'aucun autre produit ne partage la fiche ;
//   · jamais de produitsPartages ; sauvegarde AVANT la première écriture ; restauration champ par champ ; idempotence ; `--attendu` refuse AVANT d'écrire.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const R = require(path.join(DIR, 'collecte-cartes', 'variantes-releve.js'));
const P = require(path.join(DIR, 'collecte-cartes', 'pokumon.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.message).split('\n')[0]}`); } };
const leve = async f => { try { await f(); return null; } catch (e) { return String(e.message); } };

// ── une base en mémoire : seulement les formes de requête de l'outil ──
const lire = (d, cle) => { const [t, ...r] = cle.split('.'); const v = d[t]; return r.length ? (Array.isArray(v) ? v.map(x => x?.[r.join('.')]) : [v?.[r.join('.')]]) : [v]; };
const correspond = (d, f) => Object.entries(f).every(([k, c]) => lire(d, k).some(x => (c && typeof c === 'object' && '$in' in c) ? c.$in.includes(x) : x === c));
function fausseBase({ produits, cartes, images }) {
    const col = { cartes_produits: new Map(produits.map(l => [l._id, structuredClone(l)])), cartes: new Map(cartes.map(c => [c._id, structuredClone(c)])), images: new Map(images.map(d => [d._id, structuredClone(d)])) };
    const journal = [];
    const collection = n => ({
        find(f = {}) { const r = { toArray: async () => structuredClone([...col[n].values()].filter(d => correspond(d, f))), project() { return r; } }; return r; },
        async updateOne(f, u, o) {
            const d = col[n].get(f._id); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d); journal.push({ n, f, u });
            const cible = (k) => {
                const m = /^images\.\$\[e\]\.(.+)$/.exec(k);
                if (!m) return [d, k];
                const af = o.arrayFilters[0], e = d.images.find(x => x['e.set'] === undefined && x.set === af['e.set'] && x.cleR2 === af['e.cleR2']);
                return [e, m[1]];
            };
            for (const [k, v] of Object.entries(u.$set || {})) { const [t, c] = cible(k); t[c] = structuredClone(v); }
            for (const k of Object.keys(u.$unset || {})) { const [t, c] = cible(k); delete t[c]; }
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        }
    });
    return { db: { collection }, col, journal, instantane: () => JSON.stringify([...col.cartes_produits.values(), ...col.cartes.values(), ...col.images.values()]) };
}

// ── le monde : la carte 1 (set S, n° 8) a V1 99 (2019) et V2 100 (2020) ; la carte 2 a trois produits ──
const LP = (idProduct, carteId, slugSet, numeroFiche, extra = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, slugSet, numeroFiche, ...extra });
const ENTREE = (set, numero, cleR2, extra = {}) => ({ set, numero, cleR2, source: 'tcgdex', ...extra });
const monde = (o = {}) => ({
    produits: [LP(100, 1, 'S', '8'), LP(99, 1, 'S', '8'), LP(98, 1, 'S', '25'), ...(o.plus || [])],
    cartes: [{ _id: 1, images: [ENTREE('S', '8', 'k8', o.entree), ENTREE('S', '25', 'k25')] }, ...(o.cartes || [])],
    images: [{ _id: 'd8', cleR2: 'k8', carteId: 1, set: 'S' }, { _id: 'd25', cleR2: 'k25', carteId: 1, set: 'S' }, ...(o.docs || [])]
});
const DATES = new Map([[99, '2019-01-01'], [100, '2020-02-02'], [98, '2019-05-05'], [97, '2021-01-01']]);
const F = (o = {}) => ({ idProduct: 100, jetons: ['prerelease'], variante: 'prerelease', colonne: 'Prerelease', url: 'https://x/prerelease', reserve: null, ...o });
const plan = (w, { fiches = [F()], dates = DATES, idsReleve = new Set([100]), etiquettes = new Map(), normalesVues = new Set([99]) } = {}) => R.construirePlan({ cartesDb: w.db, fiches, dates, idsReleve, etiquettes, normalesVues });

(async () => {
    // ── le vocabulaire fermé ──
    await essayer('vocabulaire', () => {
        for (const v of ['staff', 'staff+prerelease', 'league+place-2', 'toys-r-us+cosmo', 'normale', 'jumbo', 'staff+championship', 'prerelease+cosmo', 'gamestop', 'kfc', 'indomilk', 'professor']) verifier(`valide : ${v}`, R.varianteValide(v), true);
        for (const v of ['autre', 'enseigne', 'prerelease+staff', 'staff+staff', 'staff+', '', 'Staff', 'normale+staff', 'place-5', 'staff-prerelease', null]) verifier(`refusée : ${v}`, R.varianteValide(v), false);
    });
    await essayer('libellés', () => verifier('libellés', [R.libelleTampon('staff+prerelease'), R.libelleTampon('league+place-2'), R.libelleTampon('toys-r-us+cosmo'), R.libelleTampon('gamestop')], ['Staff + Prerelease', 'League + 2e place', 'Toys "R" Us + Cosmo', 'GameStop']));
    await essayer('libellé d\'une variante non tamponnée', async () => verifier('normale refusée', /pas une variante tamponnée/.test(await leve(() => R.libelleTampon('normale')) || ''), true));
    await essayer('étiquettes lues', () => verifier('motifs', [R.jetonsDeEtiquette('Stamp rerel lease'), R.jetonsDeEtiquette('GameStop Promo'), R.jetonsDeEtiquette('Snowflake Stamp Countdown Calendar Promo'), R.jetonsDeEtiquette('Staff Version'), R.jetonsDeEtiquette('rien'), R.jetonsDeEtiquette('Cosmos holo'), R.jetonsDeEtiquette('Snowflake Cosmos')], [['prerelease'], ['gamestop'], ['snowflake'], ['staff'], [], ['cosmo'], ['snowflake', 'cosmo']]));
    await essayer('snowflake après cosmo', () => verifier('ordre de la liste fermée', [R.JETONS.indexOf('snowflake') - R.JETONS.indexOf('cosmo'), R.varianteValide('cosmo+snowflake'), R.varianteValide('snowflake+cosmo'), R.libelleTampon('snowflake')], [1, true, false, 'Snowflake']));

    // ── la table des 13 face au CSV ──
    const CSV_URL = f => `https://v/${f.id}-${[...f.corrobore, ...f.ajouts.map(a => a.mot)].join('-')}`;
    const lignesCsv = (mod = x => x) => R.FICHES.map(f => mod({ url: CSV_URL(f), idProduct: f.id, stamp: f.colonne, propre: 'oui' }));
    await essayer('table : 13 fiches, variantes attendues', () => {
        const l = R.listeDesFiches(lignesCsv());
        verifier('13 variantes', l.map(f => f.variante), ['staff+prerelease', 'staff+prerelease', 'staff+championship', 'prerelease', 'prerelease', 'prerelease', 'snowflake', 'championship', 'league', 'toys-r-us', 'gamestop', 'toys-r-us+cosmo', 'league+place-1']);
        verifier('Frosmoth : la vignette fait foi, le conflit avec le relevé est signalé ; 3 frères lus', [l[12].vignettes, l[12].conflit, l[12].freres.map(x => x.variante)], [['1ST PLACE'], 'le relevé du testeur dit 2e place pour ce produit : signalé', ['league+place-2', 'league+place-3', 'league+place-4']]);
        verifier('Ogerpon : 1 frère lu, 2 sans jeton', [l[10].freres.map(x => [x.id, x.variante]), Object.keys(l[10].sansJeton)], [[[800148, 'cosmo']], ['771357', '786105']]);
        verifier('toutes valides', l.every(f => R.varianteValide(f.variante)), true);
        verifier('les réserves sont nommées', l.filter(f => f.reserve).map(f => f.idProduct), [882210, 449653]);
    });
    await essayer('table : colonne différente', async () => verifier('refus', /la colonne du relevé est « Staff »/.test(await leve(() => R.listeDesFiches(lignesCsv(x => x.idProduct === 275574 ? { ...x, stamp: 'Staff' } : x))) || ''), true));
    await essayer('table : mot absent de l\'URL', async () => verifier('refus', /ne figure pas dans l'URL/.test(await leve(() => R.listeDesFiches(lignesCsv(x => x.idProduct === 771356 ? { ...x, url: 'https://v/rien' } : x))) || ''), true));
    await essayer('table : fiche propre non', async () => verifier('refus', /ne traite que les « oui »/.test(await leve(() => R.listeDesFiches(lignesCsv(x => x.idProduct === 882210 ? { ...x, propre: 'non' } : x))) || ''), true));
    await essayer('table : fiche absente du relevé', async () => verifier('refus', /absente du relevé/.test(await leve(() => R.listeDesFiches(lignesCsv().slice(1))) || ''), true));
    await essayer('table : « Autre » sans titre qui précise', async () => verifier('un doute est un trou', /un doute est un trou/.test(await leve(() => R.listeDesFiches(lignesCsv(), [{ id: 708073, colonne: 'Autre', corrobore: [], ajouts: [] }])) || ''), true));
    await essayer('CSV', () => {
        const l = R.lireCsv('annonce_vinted;idProduct;stamp;fiche_cardmarket_propre\n"https://a/1";12;"Staff + Prerelease";oui\n');
        verifier('lecture', l, [{ url: 'https://a/1', idProduct: 12, stamp: 'Staff + Prerelease', propre: 'oui' }]);
    });

    // ── les corrections de la liste fermée (Doublade 877546, Delphox 884752) ──
    const CSV_C = [{ url: 'https://v/doublade-mep-067-prerelease', idProduct: 877546, stamp: 'Autre', propre: 'oui' }, { url: 'https://v/delphox-prerelease-promo', idProduct: 884752, stamp: 'Autre', propre: 'oui' }];
    await essayer('corrections : liste fermée de 2', async () => {
        const c = R.listeDesCorrections(CSV_C);
        verifier('deux, normale -> prerelease, preuve datée', [c.map(x => [x.idProduct, x.de, x.vers]), /feu vert du testeur du 2026-10-18/.test(c[0].preuve)], [[[877546, 'normale', 'prerelease'], [884752, 'normale', 'prerelease']], true]);
        verifier('une colonne différente refuse', /attend « Autre »/.test(await leve(() => R.listeDesCorrections([{ ...CSV_C[0], stamp: 'Staff' }, CSV_C[1]])) || ''), true);
        verifier('un mot absent refuse', /ne figure pas dans l'URL/.test(await leve(() => R.listeDesCorrections([{ ...CSV_C[0], url: 'https://v/x' }, CSV_C[1]])) || ''), true);
        verifier('une ligne absente refuse', /absente du relevé/.test(await leve(() => R.listeDesCorrections([CSV_C[0]])) || ''), true);
    });
    const monC = (o = {}) => ({ produits: [LP(877546, 3, 'MEP', '067', { variante: 'normale', variantePreuve: 'ancienne preuve V1 = normale', ...(o.l1 || {}) }), LP(879312, 3, 'MEP', '067', { variante: 'staff', variantePreuve: 'p2' })],
        cartes: [{ _id: 3, images: [ENTREE('MEP', '067', 'kc', { tamponNonRepresente: 'Staff', partageeTamponNonSepare: false })] }], images: [{ _id: 'dc', cleR2: 'kc', carteId: 3, set: 'MEP', tamponNonRepresente: 'Staff', partageeTamponNonSepare: false }] });
    const planC = (w, corrections) => R.construirePlan({ cartesDb: w.db, fiches: [], dates: DATES, idsReleve: new Set(), etiquettes: new Map(), corrections });
    await essayer('corrections : plan, écriture, entrée NON touchée, restauration exacte', async () => {
        const cor = R.listeDesCorrections(CSV_C).slice(0, 1), w = fausseBase(monC()), avant = w.instantane();
        const p = await planC(w, cor);
        verifier('une correction prouvée, V2 hors plan, entrée listée sans modification', [p.corrections.length, p.corrections[0].avant, p.corrections[0].entreesNonModifiees, R.operations(p).entrees.length, R.operations(p).docs.length], [1, 'normale', [{ set: 'MEP', cleR2: 'kc', source: 'tcgdex', tamponNonRepresente: 'Staff', partageeTamponNonSepare: false }], 0, 0]);
        verifier('attendu = fiches + corrections', /attendu=2 mais 1/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, attendu: 2, sauvegarder: async () => {} })) || ''), true);
        let sv = null;
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async o => { sv = JSON.parse(JSON.stringify(o)); } });
        verifier('prerelease + preuve ; le V2 et l\'entrée intacts', [w.col.cartes_produits.get('3|877546').variante, /feu vert du testeur/.test(w.col.cartes_produits.get('3|877546').variantePreuve), w.col.cartes_produits.get('3|879312').variante, w.journal.filter(j => j.n !== 'cartes_produits').length], ['prerelease', true, 'staff', 0]);
        const r = await R.restaurer(w.db, sv, { ecrire: true, attendu: 1 });
        verifier('restauration EXACTE (variante ET preuve d\'avant)', [r.restaurees, w.instantane() === avant], [1, true]);
        const w2 = fausseBase(monC()); const p2 = await planC(w2, cor);
        await R.appliquer(w2.db, p2, { ecrire: true, attendu: 1, sauvegarder: async () => {} });
        const p3 = await planC(w2, cor);
        verifier('idempotent', [p3.corrections[0].deja, (await R.appliquer(w2.db, p3, { ecrire: true, attendu: 1, sauvegarder: async () => { throw new Error('ne doit pas sauvegarder'); } })).dejaFait], [true, true]);
    });
    await essayer('corrections : la valeur d\'avant doit être exactement « normale »', async () => {
        const cor = R.listeDesCorrections(CSV_C).slice(0, 1);
        for (const v of ['staff', undefined, 'prerelease+cosmo']) {
            const w = fausseBase(monC({ l1: { variante: v, variantePreuve: v ? 'x' : undefined } })); const p = await planC(w, cor);
            verifier(`avant « ${v} » : refusée`, [p.corrections.length, /^correction : valeur-d-avant-inattendue/.test(p.refus[0]?.motif)], [0, true]);
        }
    });

    // ── le plan ──
    await essayer('plan nominal', async () => {
        const p = await plan(fausseBase(monde()));
        const i = p.items[0];
        verifier('V2 prerelease, V1 normale, entrée et document', [i.v2.variante, i.v1?.idProduct, i.entree?.cible, i.doc?._id, p.refus.length, i.freres], ['prerelease', 99, 'Prerelease', 'd8', 0, [99]]);
        verifier('la preuve nomme le relevé et la date', /relevé du testeur, 2026-10-18 \(annonce https:\/\/x\/prerelease, colonne « Prerelease »\)/.test(i.v2.preuve), true);
        verifier('la preuve du V1 est le regard du coordinateur, pas une date ni l\'OCR', [i.v1.preuve, /dateAdded|OCR/.test(i.v1.preuve)], [R.PREUVE_NORMALE, false]);
        verifier('le frère d\'un autre numéro n\'est pas un frère', i.freres.includes(98), false);
    });
    await essayer('V1 désigné par le relevé', async () => {
        const p = await plan(fausseBase(monde()), { idsReleve: new Set([100, 99]) });
        verifier('pas de normale, pas d\'entrée', [p.items[0].v1, p.items[0].v1Motif, p.items[0].entree], [null, 'designe-par-le-releve', null]);
    });
    await essayer('étiquette sur la vignette du V1', async () => {
        const p = await plan(fausseBase(monde()), { etiquettes: new Map([[99, 'Staff Version']]) });
        verifier('pas de normale', [p.items[0].v1, /^etiquette-lue/.test(p.items[0].v1Motif)], [null, true]);
    });
    await essayer('dates réelles qui CONTREDISENT (V1 plus récent ou égal)', async () => {
        const a = await plan(fausseBase(monde()), { dates: new Map([[99, '2021-01-01'], [100, '2020-02-02']]) });
        verifier('V1 plus récent : pas de normale', [a.items[0].v1, a.items[0].v1Motif], [null, 'date-contredit']);
        const b = await plan(fausseBase(monde()), { dates: new Map([[99, '2020-02-02'], [100, '2020-02-02']]) });
        verifier('égalité : pas de normale', [b.items[0].v1, b.items[0].v1Motif], [null, 'date-contredit']);
    });
    await essayer('dateReelle : la sentinelle et l\'illisible ne sont pas des dates', () => verifier('dateReelle', ['2019-01-01', '2019-01-01 10:20:30', '0000-00-00 00:00:00', '0000-00-00', '', null, undefined, 'hier', '2019-13-45 00:00:00', '1970-01-01'].map(R.dateReelle), [true, true, false, false, false, false, false, false, false, false]));
    await essayer('sentinelles : une date non réelle ne prouve rien, ne contredit rien', async () => {
        const S = '0000-00-00 00:00:00';
        for (const [nom, d] of [['0000 contre 0000', new Map([[99, S], [100, S]])], ['V1 0000 contre V2 réelle', new Map([[99, S], [100, '2020-02-02']])], ['V1 réelle contre V2 0000', new Map([[99, '2021-01-01'], [100, S]])], ['dates absentes', new Map()]]) {
            const p = await plan(fausseBase(monde()), { dates: d });
            verifier(`${nom} : le V1 est prouvé par la LISTE, la preuve ne cite aucune date`, [p.items[0].v1?.idProduct, p.items[0].v1?.preuve, p.items[0].v1Motif], [99, R.PREUVE_NORMALE, null]);
        }
    });
    await essayer('V1 hors de la liste des V1 regardés', async () => {
        const p = await plan(fausseBase(monde()), { normalesVues: new Set([12345]) });
        verifier('plus ancien, sans étiquette, hors relevé — mais pas regardé : pas de normale, pas d\'entrée', [p.items[0].v1, p.items[0].v1Motif, p.items[0].entree], [null, 'aucun-frere-dans-la-liste-des-v1-vus', null]);
        verifier('la liste réelle est fermée à 13', [R.NORMALES_VUES.size, [...R.NORMALES_VUES].sort((a, b) => a - b)], [13, [274061, 274145, 277333, 277715, 277806, 278344, 280131, 281026, 279780, 299511, 311922, 436454, 769198].sort((a, b) => a - b)]);
        verifier('la preuve écrite', R.PREUVE_NORMALE, 'vignette Cardmarket regardée par le coordinateur le 2026-10-18 : aucun tampon ni étiquette');
    });
    await essayer('frères lus à l\'œil (Frosmoth) : fiche entièrement séparée', async () => {
        const w = monde({ plus: [LP(101, 1, 'S', '8'), LP(102, 1, 'S', '8'), LP(103, 1, 'S', '8')] });
        const f = F({ variante: 'league+place-1', jetons: ['league', 'place-1'], vignettes: ['1ST PLACE'], conflit: 'le relevé du testeur dit 2e place pour ce produit : signalé',
            freres: [{ id: 101, variante: 'league+place-2', etiquette: '2ND PLACE' }, { id: 102, variante: 'league+place-3', etiquette: '3RD PLACE' }, { id: 103, variante: 'league+place-4', etiquette: '4TH PLACE' }] });
        const p = await plan(fausseBase(w), { fiches: [f] }), i = p.items[0];
        verifier('V1 + 4 places, entrée et document écrits, libellés distincts joints par « / »', [i.v1?.idProduct, i.freresVus.map(x => [x.idProduct, x.variante]), i.autres, i.entree?.cible, !!i.doc, R.operations(p).lignes.length],
            [99, [[101, 'league+place-2'], [102, 'league+place-3'], [103, 'league+place-4']], [], 'League + 1re place / League + 2e place / League + 3e place / League + 4e place', true, 5]);
        verifier('preuves : vignette regardée + conflit signalé', [/1ST PLACE.*signalé/.test(i.v2.preuve), i.freresVus[0].preuve], [true, 'vignette Cardmarket regardée par le coordinateur le 2026-10-18 : « 2ND PLACE »']);
        const w2 = monde({ plus: [LP(101, 1, 'S', '8', { variante: 'staff' }), LP(102, 1, 'S', '8'), LP(103, 1, 'S', '8')] });
        const q = await plan(fausseBase(w2), { fiches: [f] });
        verifier('un frère déjà marqué autrement : refusé, la fiche reste non séparée, pas d\'entrée', [q.items[0].freresVusRefus.length, q.items[0].autres, q.items[0].entree], [1, [101], null]);
    });
    await essayer('Ogerpon : frères sans jeton, fiche NON séparée', async () => {
        const w = monde({ plus: [LP(101, 1, 'S', '8'), LP(102, 1, 'S', '8'), LP(103, 1, 'S', '8')] });
        const f = F({ variante: 'gamestop', jetons: ['gamestop'], freres: [{ id: 101, variante: 'cosmo', etiquette: 'Cosmo Holo Box Set Promo' }] });
        const p = await plan(fausseBase(w), { fiches: [f] }), i = p.items[0];
        verifier('cosmo posé sur le frère lu ; 2 autres sans jeton ; pas d\'entrée', [i.freresVus.map(x => x.variante), i.autres, i.entree, /autres-produits-sur-la-fiche/.test(i.entreeMotif)], [['cosmo'], [102, 103], null, true]);
        const g = await plan(fausseBase(w), { fiches: [F({ variante: 'gamestop', jetons: ['gamestop'], freres: [{ id: 555, variante: 'cosmo', etiquette: 'x' }] })] });
        verifier('un frère lu qui n\'est pas sur la fiche : refusé, nommé', [g.items[0].freresVus.length, g.items[0].freresVusRefus], [0, ['555 : absent de la fiche']]);
    });
    await essayer('autre produit sur la fiche (V3)', async () => {
        const p = await plan(fausseBase(monde({ plus: [LP(97, 1, 'S', '8')] })));
        const i = p.items[0];
        verifier('V1 normale oui, entrée NON (un produit non séparé la partage), V3 ne reçoit rien', [i.v1?.idProduct, i.entree, /autres-produits-sur-la-fiche : 97/.test(i.entreeMotif), R.operations(p).lignes.map(l => l.idProduct)], [99, null, true, [100, 99]]);
    });
    await essayer('aucun frère', async () => {
        const w = monde(); w.produits = w.produits.filter(l => l.idProduct !== 99);
        const p = await plan(fausseBase(w));
        verifier('V2 seul : variante posée, ni V1 ni entrée', [p.items[0].v2.variante, p.items[0].v1, p.items[0].v1Motif, p.items[0].entree], ['prerelease', null, 'aucun-frere', null]);
    });
    await essayer('étiquette Cardmarket contredit le relevé', async () => {
        const p = await plan(fausseBase(monde()), { etiquettes: new Map([[100, 'GameStop Promo']]) });
        verifier('refusée', [p.items.length, /^etiquette-contredit/.test(p.refus[0]?.motif)], [0, true]);
    });
    await essayer('étiquette Cardmarket qui confirme', async () => {
        const p = await plan(fausseBase(monde()), { etiquettes: new Map([[100, 'Stamp rerel lease']]) });
        verifier('acceptée, citée dans la preuve', [p.items.length, /étiquette Cardmarket lue : « Stamp rerel lease »/.test(p.items[0].v2.preuve)], [1, true]);
    });
    await essayer('variante contraire', async () => {
        const w = monde(); w.produits[0].variante = 'staff';
        const p = await plan(fausseBase(w));
        verifier('V2 déjà marqué autrement : refusé', [p.items.length, /^variante-contraire/.test(p.refus[0].motif)], [0, true]);
        const w2 = monde(); w2.produits[1].variante = 'staff';
        const q = await plan(fausseBase(w2));
        verifier('V1 déjà marqué autrement : pas de normale', [q.items[0].v1, /^variante-contraire/.test(q.items[0].v1Motif)], [null, true]);
    });
    await essayer('produit sans ligne', async () => { const w = monde(); w.produits = w.produits.filter(l => l.idProduct !== 100); const p = await plan(fausseBase(w)); verifier('refus nommé', p.refus.map(r => r.motif), ['produit-sans-ligne']); });
    await essayer('entrée déjà marquée / ambiguë / tampon inattendu', async () => {
        const a = await plan(fausseBase(monde({ entree: { partageeTamponNonSepare: true } })));
        verifier('déjà marquée', [a.items[0].entree, a.items[0].entreeMotif], [null, 'entree-deja-marquee']);
        const b = await plan(fausseBase(monde({ entree: { produitsPartages: [99, 100] } })));
        verifier('produitsPartages présent : jamais touchée', [b.items[0].entree, b.items[0].entreeMotif], [null, 'entree-deja-marquee']);
        const w = monde(); w.cartes[0].images.push(ENTREE('S', '8', 'k8bis'));
        const c = await plan(fausseBase(w));
        verifier('deux entrées pour le numéro', [c.items[0].entree, c.items[0].entreeMotif], [null, 'entree-ambigue']);
        const d = await plan(fausseBase(monde({ entree: { tamponNonRepresente: 'Staff' } })));
        verifier('libellé différent présent', [d.items[0].entree, /^tampon-inattendu/.test(d.items[0].entreeMotif)], [null, true]);
    });
    await essayer('document partagé', async () => {
        const p = await plan(fausseBase(monde({ cartes: [{ _id: 5, images: [ENTREE('T', '1', 'k8')] }] })));
        verifier('le document sert aussi une autre carte : entrée seule', [!!p.items[0].entree, p.items[0].doc, p.items[0].docMotif], [true, null, 'document-partage']);
    });

    // ── l'écriture ──
    const prochaine = async (o = {}) => { const w = fausseBase(monde(o)); return { w, p: await plan(w) }; };
    await essayer('à blanc n\'écrit rien', async () => {
        const { w, p } = await prochaine(); const avant = w.instantane();
        const r = await R.appliquer(w.db, p, { ecrire: false });
        verifier('rien écrit, comptes', [w.journal.length, w.instantane() === avant, r.lignes, r.entrees, r.documents, r.dejaFait], [0, true, 2, 1, 1, false]);
    });
    await essayer('--ecrire exige --attendu et une sauvegarde', async () => {
        const { w, p } = await prochaine();
        verifier('sans attendu', [/attendu/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, sauvegarder: async () => {} })) || ''), w.journal.length], [true, 0]);
        verifier('attendu faux', [/attendu=3/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, attendu: 3, sauvegarder: async () => {} })) || ''), w.journal.length], [true, 0]);
        verifier('sans sauvegarde', [/sauvegarde/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, attendu: 1 })) || ''), w.journal.length], [true, 0]);
    });
    await essayer('écriture : champs exacts, sauvegarde AVANT', async () => {
        const { w, p } = await prochaine(); let sauvee = null, ecritesAvant = null;
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async o => { sauvee = o; ecritesAvant = w.journal.length; } });
        verifier('la sauvegarde est faite avant la première écriture', [ecritesAvant, sauvee.lignes.length, sauvee.entrees.length, sauvee.docs.length], [0, 2, 1, 1]);
        const l2 = w.col.cartes_produits.get('1|100'), l1 = w.col.cartes_produits.get('1|99'), e = w.col.cartes.get(1).images.find(x => x.cleR2 === 'k8'), d = w.col.images.get('d8');
        verifier('V2 et V1', [l2.variante, l1.variante, !!l2.variantePreuve, !!l1.variantePreuve], ['prerelease', 'normale', true, true]);
        verifier('entrée et document : séparé, libellé, jamais produitsPartages', [e.partageeTamponNonSepare, e.tamponNonRepresente, 'produitsPartages' in e, d.partageeTamponNonSepare, d.tamponNonRepresente, 'produitsPartages' in d], [false, 'Prerelease', false, false, 'Prerelease', false]);
        verifier('l\'autre numéro et la ligne voisine intacts', [w.col.cartes_produits.get('1|98').variante ?? null, w.col.cartes.get(1).images.find(x => x.cleR2 === 'k25').tamponNonRepresente ?? null, w.col.images.get('d25').partageeTamponNonSepare ?? null], [null, null, null]);
    });
    await essayer('idempotence', async () => {
        const { w, p } = await prochaine();
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async () => {} });
        const n = w.journal.length, snap = w.instantane();
        const p2 = await plan(w);
        let appels = 0;
        const r = await R.appliquer(w.db, p2, { ecrire: true, attendu: 1, sauvegarder: async () => { appels++; } });
        verifier('deuxième passe : rien réécrit, rien sauvegardé', [w.journal.length, w.instantane() === snap, r.dejaFait, appels], [n, true, true, 0]);
    });
    await essayer('écriture sans effet', async () => {
        const { w, p } = await prochaine(); const vraie = w.db.collection;
        w.db.collection = n => ({ ...vraie(n), async updateOne() { return { matchedCount: 1, modifiedCount: 0 }; } });
        verifier('arrêt', /inchang/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async () => {} })) || ''), true);
    });
    await essayer('restauration', async () => {
        const { w, p } = await prochaine(); const avant = w.instantane(); let sv = null;
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async o => { sv = JSON.parse(JSON.stringify(o)); } });
        const blanc = await R.restaurer(w.db, sv, { ecrire: false });
        verifier('à blanc : compte', [blanc.total, blanc.restaurees, blanc.changeesDepuis.length], [4, 4, 0]);
        verifier('sans attendu : refus', /attendu/.test(await leve(() => R.restaurer(w.db, sv, { ecrire: true })) || ''), true);
        const r = await R.restaurer(w.db, sv, { ecrire: true, attendu: 4 });
        verifier('tout restauré, état identique à l\'état d\'avant', [r.restaurees, w.instantane() === avant], [4, true]);
    });
    await essayer('restauration : un champ changé depuis est laissé', async () => {
        const { w, p } = await prochaine(); let sv = null;
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async o => { sv = JSON.parse(JSON.stringify(o)); } });
        w.col.cartes_produits.get('1|100').variante = 'staff';   // quelqu'un l'a changée depuis
        const r = await R.restaurer(w.db, sv, { ecrire: true, attendu: 4 });
        verifier('3 restaurées, 1 laissée et nommée', [r.restaurees, r.changeesDepuis], [3, ['ligne 1|100']]);
        verifier('la valeur d\'un tiers est intacte', w.col.cartes_produits.get('1|100').variante, 'staff');
    });

    // ── la garde « variante posée » du marquage des paires tampon ──
    await essayer('partage-tampon : aucune de ces fiches n\'est une promo Black Star', () => {
        const bsp = new Set(P.LIGNES_AUTRES.filter(l => l.famille === 'bsp').flatMap(l => l.slugs));
        const sets = ['Team-Rocket', 'Secret-Wonders', 'Plasma-Blast', 'Stormfront', 'EX-Power-Keepers', 'Gym-Heroes', 'Mysterious-Treasures', 'Noble-Victories', 'Black-White', 'Crimson-Invasion', 'Twilight-Masquerade', 'Burning-Shadows', 'Sword-Shield'];
        verifier('le groupage des paires tampon ne les voit pas', [bsp.size > 0, sets.filter(s => bsp.has(s))], [true, []]);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
