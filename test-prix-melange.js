// node test-prix-melange.js — PRIX-MELANGE : repérer les fiches Cardmarket (UN seul idProduct) dont une version tamponnée existe, et marquer `prixMelangeTampon: true` (collecte-cartes/prix-melange.js).
// Faux objets seulement : aucune base réelle, aucune requête réseau. Ce que le banc garde :
//   · une fiche n'est marquée que si UN SEUL produit existe pour la carte (export), pas déjà séparée (variante, 64 paires), nom concordant, rattachement non ambigu ;
//   · la liste des tampons est FERMÉE ; un tampon d'une variante qui a son propre produit n'est jamais attribué à la fiche de base ;
//   · l'écriture : trois champs, additive, idempotente, `--attendu` refuse AVANT d'écrire, la simulation n'écrit rien.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const path = require('path');
const fs = require('fs');
const os = require('os');
const DIR = process.env.TOOL_DIR || __dirname;
const M = require(path.join(DIR, 'collecte-cartes', 'prix-melange.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.message).split('\n')[0]}`); } };

// ── une base en mémoire (les seules formes de requête de l'outil) ──
function fausseBase(lignes) {
    const col = new Map(lignes.map(l => [l._id, structuredClone(l)]));
    const writes = [];
    const collection = n => ({
        find() { const r = { toArray: async () => (n === 'cartes_produits' ? structuredClone([...col.values()]) : []), project() { return r; } }; return r; },
        async updateOne(f, u) {
            const d = col.get(f._id); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d);
            for (const [k, v] of Object.entries(u.$set || {})) d[k] = structuredClone(v);
            writes.push({ f, u });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit à cet outil'); },
        async insertOne() { throw new Error('insertOne : interdit à cet outil'); },
        async deleteOne() { throw new Error('deleteOne : interdit à cet outil'); },
        async deleteMany() { throw new Error('deleteMany : interdit à cet outil'); },
        async replaceOne() { throw new Error('replaceOne : interdit à cet outil'); }
    });
    return { db: { collection }, col, writes, instantane: () => JSON.stringify([...col.values()]) };
}

// ── le monde ──
const P = (idProduct, name, idExpansion, idMetacard) => ({ idProduct, name, idExpansion, idMetacard });
const PRODUITS = [
    P(1001, 'Electivire [Intense Voltage | Giga Impact]', 100, 500),   // un seul produit
    P(1002, 'Pikachu [Thunder Jolt]', 100, 501), P(1003, 'Pikachu [Thunder Jolt]', 100, 501),   // une paire V1/V2
    P(1004, 'Zekrom ex [Slash | Voltage Burst]', 200, 600), P(1005, 'Zekrom ex [Slash | Voltage Burst]', 300, 600),   // même métacarte, deux expansions
    P(1006, 'Super Rod', 100, 700), P(1007, 'Super Rod', 100, 700),   // même métacarte, même expansion, deux NUMÉROS (réimpression)
    P(1008, 'Arctozolt [Freezing Headbutt]', 5241, 800),               // une promo Black Star simple
    P(1009, 'Meganium [Wild Growth | Solar Beam]', 5241, 810), P(1010, 'Meganium [Wild Growth | Solar Beam]', 5241, 810),   // une des 64 paires
    P(1011, 'Chansey [Double-edge]', 100, 900),                        // produit déjà séparé (variante)
    P(1012, 'Snorlax [Body Slam]', 100, 910),                          // produit SANS ligne cartes_produits
    P(1013, 'Mewtwo [Psychic]', 100, 920),                             // nom différent du témoin
    P(1014, 'Metang δ Delta Species [Sharp Claws | Magnetic Blast]', 100, 930)   // Cardmarket écrit « Delta Species » après le δ
];
const L = (idProduct, carteId, slugSet, idExpansion, numeroFiche, extra = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, slugSet, idExpansion, numeroFiche, nomCarte: null, impNumero: null, impTotal: null, ...extra });
const LIGNES = [
    L(1001, 11, 'Diamond-Pearl', 100, '3', { nomCarte: 'Electivire', impNumero: '3', impTotal: '130' }),
    L(1002, 12, 'Diamond-Pearl', 100, '4', { nomCarte: 'Pikachu' }), L(1003, 12, 'Diamond-Pearl', 100, '4', { nomCarte: 'Pikachu' }),
    L(1004, 13, 'Black-Bolt', 200, '34', { nomCarte: 'Zekrom ex' }), L(1005, 13, 'Other-Set', 300, '34', { nomCarte: 'Zekrom ex' }),
    L(1006, 14, 'Diamond-Pearl', 100, '188', { nomCarte: 'Super Rod' }), L(1007, 14, 'Diamond-Pearl', 100, '276', { nomCarte: 'Super Rod' }),
    L(1008, 15, 'SV-Black-Star-Promos', 5241, '115', { nomCarte: 'Arctozolt' }),
    L(1009, 16, 'MEP-Black-Star-Promos', 5241, '001', { nomCarte: 'Meganium' }), L(1010, 16, 'MEP-Black-Star-Promos', 5241, '001', { nomCarte: 'Meganium' }),
    L(1011, 17, 'Diamond-Pearl', 100, '9', { nomCarte: 'Chansey', variante: 'staff' }),
    L(1013, 19, 'Diamond-Pearl', 100, '20', { nomCarte: 'Mewtwo' }),
    L(1014, 21, 'Diamond-Pearl', 100, '49', { nomCarte: 'Metang δ' }),
    L(3000, 31, 'Diamond-Pearl', 100, '3', { nomCarte: 'Electivire' })   // une ligne dont le produit n'est PAS à l'export : jamais un candidat
];
const EXCLUS = new Set([1009, 1010]);
const T = (o) => ({ source: 'tcgdex-clone', enregistrement: 'S/Set/3.ts', nom: 'Electivire', numero: '3', total: null, tampons: ['staff'], expansions: [100], idProduct: null, ...o });
const plan = (temoins, extra = {}) => M.construirePlan({ temoins, produits: PRODUITS, lignes: LIGNES, exclus: EXCLUS, ...extra });
const ids = p => p.fiches.map(f => f.idProduct);
const motifs = p => p.sautes.map(s => s.motif);

(async () => {
    // ── la liste fermée des tampons ──
    await essayer('tampons : staff', () => verifier('staff', M.tamponsDesStamps(['staff']), ['staff']));
    await essayer('tampons : pre-release', () => verifier('pre-release → prerelease', M.tamponsDesStamps(['pre-release']), ['prerelease']));
    await essayer('tampons : staff + autre', () => verifier('un autre tampon ne gêne pas staff', M.tamponsDesStamps(['regional-championships', 'staff']), ['staff']));
    await essayer('tampons : staff + prerelease', () => verifier('staff + pre-release → staff-prerelease', M.tamponsDesStamps(['pre-release', 'staff']), ['staff-prerelease']));
    await essayer('tampons : league', () => verifier('ultra-ball-league → league', M.tamponsDesStamps(['ultra-ball-league']), ['league']));
    await essayer('tampons : play', () => verifier('play-pokemon', M.tamponsDesStamps(['play-pokemon']), ['play-pokemon']));
    await essayer('tampons : hors liste', () => verifier('set-logo, 1st-edition, worlds-2024 : hors liste fermée', M.tamponsDesStamps(['set-logo', '1st-edition', 'worlds-2024', 'player-rewards-program']), []));
    await essayer('tampons : liste fermée', () => verifier('la liste fermée', M.TAMPONS_FERMES, ['staff', 'prerelease', 'staff-prerelease', 'play-pokemon', 'league', 'championship', 'autre']));

    // ── TCGdex : une variante qui a SON produit n'est pas mélangée ──
    await essayer('variante avec produit propre', () => {
        const r = M.tamponsDeCarteTcgdex([{ stamp: ['staff'], cardmarket: 555 }, { stamp: ['pre-release'], cardmarket: null }, { stamp: [], cardmarket: null }], new Set([555, 1001]));
        verifier('staff (produit propre présent dans l\'export) ignoré, prerelease gardé', r.tampons, ['prerelease']);
    });
    await essayer('variante dont l\'id est absent de l\'export', () => {
        const r = M.tamponsDeCarteTcgdex([{ stamp: ['staff'], cardmarket: 999999 }], new Set([1001]));
        verifier('id propre absent de l\'export : le tampon reste mélangé', r.tampons, ['staff']);
    });

    // ── Pokumon : les mots du titre ──
    await essayer('pokumon staff', () => verifier('Staff X → staff', M.tamponsPokumon({ nom: 'Staff Machamp', titre: 'Staff Machamp (9/101 National Championships Special Print)', set: 'National Championships Special Print', evenements: [5091] }), { tampons: ['staff'] }));
    await essayer('pokumon prerelease', () => verifier('set « Prerelease » → prerelease', M.tamponsPokumon({ nom: 'Kirlia', titre: 'Kirlia (53/132 Secret Wonders Prerelease Special Print)', set: 'Secret Wonders Prerelease Special Print', evenements: [5282] }), { tampons: ['prerelease'] }));
    await essayer('pokumon league', () => verifier('set « Pokemon League » → league', M.tamponsPokumon({ nom: 'Chikorita', titre: 'Chikorita (1/122 Pokemon League Special Print)', set: 'Pokemon League Special Print', evenements: [2056] }), { tampons: ['league'] }));
    await essayer('pokumon prize pack', () => verifier('Prize Pack : écarté (son produit est distinct)', M.tamponsPokumon({ nom: 'Play Pokemon Rillaboom', titre: 'Play Pokemon Rillaboom (014/202 Play Pokemon Prize Pack Series 1 Special Print)', set: 'Play Pokemon Prize Pack Series 1 Special Print', evenements: [7720] }), { tampons: [], motif: 'prize-pack-produit-distinct' }));
    await essayer('pokumon jumbo', () => verifier('Jumbo : écarté', M.tamponsPokumon({ nom: 'Jumbo Stamp Pikachu V', titre: 'Jumbo Stamp Pikachu V (043/185 Vivid Voltage Purchase campaign Special Print)', set: 'Vivid Voltage Purchase campaign Special Print', evenements: [1] }), { tampons: [], motif: 'jumbo' }));
    await essayer('pokumon carte nommée Staff', () => verifier('« League Staff » est un nom de carte, pas un tampon', M.tamponsPokumon({ nom: 'League Staff', titre: 'League Staff (153/185 Vivid Voltage Special Print)', set: 'Vivid Voltage Special Print', evenements: [1] }), { tampons: [] }));
    await essayer('pokumon championnat staff', () => verifier('« North American Championships Staff X » → staff', M.tamponsPokumon({ nom: 'North American Championships Staff Quick Ball', titre: 'x', set: 'International Championships North America Special Print', evenements: [1] }), { tampons: ['staff'] }));
    await essayer('pokumon staff + prerelease', () => verifier('Staff + set Prerelease → staff-prerelease', M.tamponsPokumon({ nom: 'Staff Gigalith', titre: 'x', set: 'Emerging Powers Prerelease Special Print', evenements: [1] }), { tampons: ['staff-prerelease'] }));
    await essayer('pokumon kit de prerelease', () => verifier('un kit de prerelease / deck thématique n\'est pas un tampon', M.tamponsPokumon({ nom: 'Non-holo Delphox', titre: 'x', set: 'Fates Collide Prerelease Kit,Sky Guardian Theme Deck Special Print', evenements: [1] }), { tampons: [] }));
    await essayer('pokumon place de league', () => verifier('« First Place X » : écarté, nommé', M.tamponsPokumon({ nom: 'First Place Tsareena', titre: 'x', set: 'Pokemon League Special Print', evenements: [2056] }), { tampons: [], motif: 'place-de-league' }));
    await essayer('métacarte inconnue', () => {
        const p = M.construirePlan({ temoins: [T({ idProduct: 1015, nom: 'Vide', numero: '1' })], produits: [...PRODUITS, P(1015, 'Vide', 100, 0)], lignes: LIGNES, exclus: EXCLUS });
        verifier('sans idMetacard, l\'unicité ne se prouve pas : sauté', [ids(p), motifs(p)], [[], ['metacarte-inconnue']]);
    });
    await essayer('pokumon sans mot', () => verifier('aucun mot : aucun tampon', M.tamponsPokumon({ nom: 'Pikachu', titre: 'Pikachu (58/102 Top Deck Magazine Special Print)', set: 'Top Deck Magazine Special Print', evenements: [1] }), { tampons: [] }));
    await essayer('pokumon temoins', () => {
        const r = M.temoinsPokumon([
            { id: 1, nom: 'Staff Machamp', titre: 'Staff Machamp (9/101 National Championships Special Print)', set: 'National Championships Special Print', numero: '9', total: '101', evenements: [5091], anglais: true },
            { id: 2, nom: 'Play Pokemon Rillaboom', titre: 'x', set: 'Play Pokemon Prize Pack Series 1 Special Print', numero: '014', total: '202', evenements: [7720], anglais: true },
            { id: 3, nom: 'Staff Arctozolt', titre: 'Staff Arctozolt (SWSH036 English Promo)', set: 'English Promo', numero: 'SWSH036', total: null, evenements: [6715], anglais: true },
            { id: 4, nom: 'Staff Thwackey', titre: 'Staff Thwackey (SVP115 English Promo)', set: 'English Promo', numero: 'SVP115', total: null, evenements: [8014], anglais: true },
            { id: 5, nom: 'Staff Machamp', titre: 'Staff Machamp (JA)', set: 'National Championships Special Print', numero: '9', total: '101', evenements: [5091], anglais: false }
        ]);
        verifier('témoins : nom sans mot, ancrage par total ou par préfixe de promo, Prize Pack et non-anglais écartés', [r.temoins.map(t => [t.nom, t.numero, t.total, t.slugSets || null, t.tampons.join()]), r.ecartes.map(e => e.motif)],
            [[['Machamp', '9', '101', null, 'staff'], ['Arctozolt', '36', null, ['SWSH-Black-Star-Promos'], 'staff'], ['Thwackey', '115', null, ['SV-Black-Star-Promos'], 'staff']], ['prize-pack-produit-distinct', 'pas-anglais']]);
    });

    // ── le plan ──
    await essayer('une carte à tampon connu et un seul produit : marquée (idProduct du clone)', () => {
        const p = plan([T({ idProduct: 1001 })]);
        verifier('marquée', [ids(p), p.fiches[0]?.tampons, p.fiches[0]?.rows, p.sautes.length], [[1001], ['staff'], ['11|1001'], 0]);
    });
    await essayer('numéro + nom (sans idProduct) : marquée', () => {
        const p = plan([T({ idProduct: null })]);
        verifier('marquée par set + numéro + nom', [ids(p), p.fiches[0]?.preuves[0]?.mode], [[1001], 'set+numero+nom']);
    });
    await essayer('deux produits (paire) : non marquée', () => {
        const p = plan([T({ nom: 'Pikachu', numero: '4', idProduct: 1002 })]);
        verifier('paire : non marquée, motif nommé', [ids(p), motifs(p)], [[], ['plusieurs-produits-pour-la-carte']]);
    });
    await essayer('deux produits sans idProduct (paire par numéro)', () => {
        const p = plan([T({ nom: 'Pikachu', numero: '4' })]);
        verifier('paire : non marquée', [ids(p), motifs(p)], [[], ['plusieurs-produits-pour-la-carte']]);
    });
    await essayer('les 64 paires exclues', () => {
        const p = plan([T({ nom: 'Meganium', numero: '1', expansions: [5241], idProduct: 1009 })]);
        verifier('64 paires : exclue même si la source nomme un produit', [ids(p), motifs(p)], [[], ['paire-black-star-exclue']]);
    });
    await essayer('ligne déjà séparée (variante)', () => {
        const p = plan([T({ nom: 'Chansey', numero: '9', idProduct: 1011 })]);
        verifier('déjà séparée : non marquée', [ids(p), motifs(p)], [[], ['deja-separee-par-variante']]);
    });
    await essayer('métacarte partagée entre deux expansions : pas un frère', () => {
        const p = plan([T({ nom: 'Zekrom ex', numero: '34', expansions: [200], idProduct: 1004 })]);
        verifier('autre expansion : n\'est pas un produit frère', ids(p), [1004]);
    });
    await essayer('même expansion, même métacarte, autre numéro : pas un frère (réimpression)', () => {
        const p = plan([T({ nom: 'Super Rod', numero: '188', idProduct: null })]);
        verifier('deux numéros distincts connus : un seul produit pour ce numéro', ids(p), [1006]);
    });
    await essayer('même expansion, même métacarte, sans ligne : frère présumé', () => {
        const p = plan([T({ nom: 'Super Rod', numero: '188', idProduct: 1006 })], { lignes: LIGNES.filter(l => l.idProduct !== 1007 && l.idProduct !== 1006) });
        verifier('sans lignes, le frère ne se disculpe pas : sauté', [ids(p), motifs(p)], [[], ['plusieurs-produits-pour-la-carte']]);
    });
    await essayer('nom différent : sauté et listé', () => {
        const p = plan([T({ nom: 'Mew', numero: '20' })]);
        verifier('nom contredit : sauté', [ids(p), motifs(p)], [[], ['nom-different']]);
    });
    await essayer('δ Delta Species', () => {
        const a = plan([T({ nom: 'Metang δ', numero: '49' })]), b = plan([T({ nom: 'Metang δ Delta Species', numero: '49', source: 'pokumon', enregistrement: 'pokumon:5' })]);
        verifier('« Delta Species » ne contredit pas le nom, des deux côtés', [ids(a), ids(b)], [[1014], [1014]]);
    });
    await essayer('idProduct absent de l\'export', () => {
        const p = plan([T({ idProduct: 999999 })]);
        verifier('produit inconnu de l\'export : sauté, nommé', [ids(p), motifs(p)], [[], ['produit-absent-de-l-export']]);
    });
    await essayer('idProduct du clone dans une autre expansion', () => {
        const p = plan([T({ idProduct: 1004, nom: 'Zekrom ex', numero: '34', expansions: [100] })]);
        verifier('expansion contredite : sautée', [ids(p), motifs(p)], [[], ['expansion-differente']]);
    });
    await essayer('aucune fiche', () => {
        const p = plan([T({ nom: 'Inconnu', numero: '99' })]);
        verifier('aucune fiche : sautée', [ids(p), motifs(p)], [[], ['aucune-fiche']]);
    });
    await essayer('rattachement ambigu (deux produits distincts de métacartes distinctes au même numéro)', () => {
        const autres = [...PRODUITS, P(2001, 'Electivire [Giga Impact]', 100, 5000)];
        const lignes = [...LIGNES, L(2001, 77, 'Diamond-Pearl', 100, '3', { nomCarte: 'Electivire' })];
        const p = M.construirePlan({ temoins: [T()], produits: autres, lignes, exclus: EXCLUS });
        verifier('deux fiches candidates : ambigu, sauté', [ids(p), motifs(p)], [[], ['plusieurs-produits-pour-la-carte']]);
    });
    await essayer('témoin sans ancrage', () => {
        const p = plan([T({ expansions: null, total: null, slugSets: null })]);
        verifier('ni expansion, ni total, ni promo : sauté', [ids(p), motifs(p)], [[], ['temoin-sans-ancrage']]);
    });
    await essayer('total imprimé exigé', () => {
        const bon = plan([T({ expansions: null, total: '130', source: 'pokumon', enregistrement: 'pokumon:1' })]);
        const mauvais = plan([T({ expansions: null, total: '131', source: 'pokumon', enregistrement: 'pokumon:2' })]);
        verifier('total concordant marque, total différent saute', [ids(bon), ids(mauvais), motifs(mauvais)], [[1001], [], ['aucune-fiche']]);
    });
    await essayer('promo Black Star par préfixe', () => {
        const p = plan([T({ source: 'pokumon', enregistrement: 'pokumon:3', nom: 'Arctozolt', numero: '115', expansions: null, slugSets: ['SV-Black-Star-Promos'] })]);
        verifier('promo simple : marquée', [ids(p), p.fiches[0]?.set], [[1008], 'SV-Black-Star-Promos']);
    });
    await essayer('produit sans ligne', () => {
        const p = plan([T({ nom: 'Snorlax', numero: '20', idProduct: 1012 })]);
        verifier('sans ligne : listé à part, non marqué', [ids(p), p.sansLigne.map(s => s.idProduct), p.comptes.sansLigne], [[], [1012], 1]);
    });
    await essayer('union de deux sources', () => {
        const p = plan([T({ idProduct: 1001 }), T({ source: 'pokumon', enregistrement: 'pokumon:9', tampons: ['prerelease'], expansions: null, total: '130', idProduct: null })]);
        verifier('tampons réunis, deux preuves, comptes par source et par tampon', [ids(p), p.fiches[0]?.tampons, p.fiches[0]?.preuves.length, p.comptes.parSource, p.comptes.parTampon], [[1001], ['prerelease', 'staff'], 2, { pokumon: 1, 'tcgdex-clone': 1 }, { prerelease: 1, staff: 1 }]);
    });
    await essayer('tampon hors liste : ignoré', () => {
        const p = plan([T({ tampons: [] })]);
        verifier('sans tampon de la liste : rien', [ids(p), p.fiches.length], [[], 0]);
    });
    await essayer('écartés de la source repris dans les sautés', () => {
        const p = plan([], { ecartes: [{ source: 'pokumon', enregistrement: 'pokumon:2', motif: 'prize-pack-produit-distinct' }] });
        verifier('écarté listé avec son motif', [motifs(p), p.comptes.parMotif], [['prize-pack-produit-distinct'], { 'prize-pack-produit-distinct': 1 }]);
    });
    await essayer('le plan ne modifie pas ses entrées', () => {
        const avant = JSON.stringify([PRODUITS, LIGNES]); plan([T({ idProduct: 1001 })]);
        verifier('entrées intactes', JSON.stringify([PRODUITS, LIGNES]), avant);
    });

    // ── l'écriture ──
    const fiches1001 = () => plan([T({ idProduct: 1001 })]);
    await essayer('à blanc n\'écrit rien', async () => {
        const f = fausseBase(LIGNES); const avant = f.instantane();
        const r = await M.appliquer(f.db, fiches1001(), { ecrire: false });
        verifier('à blanc : rien écrit, un à écrire', [f.writes.length, f.instantane() === avant, r.aEcrire, r.dejaFait], [0, true, 1, false]);
    });
    await essayer('--ecrire exige --attendu', async () => {
        const f = fausseBase(LIGNES); let msg = null;
        try { await M.appliquer(f.db, fiches1001(), { ecrire: true }); } catch (e) { msg = e.message; }
        verifier('sans attendu : refus, rien écrit', [/attendu/.test(msg || ''), f.writes.length], [true, 0]);
    });
    await essayer('--attendu différent refuse avant d\'écrire', async () => {
        const f = fausseBase(LIGNES); let msg = null;
        try { await M.appliquer(f.db, fiches1001(), { ecrire: true, attendu: 2 }); } catch (e) { msg = e.message; }
        verifier('compte différent : refus avant toute écriture', [/attendu=2/.test(msg || ''), f.writes.length], [true, 0]);
    });
    await essayer('écriture : trois champs, rien d\'autre', async () => {
        const f = fausseBase(LIGNES); const avant = structuredClone(f.col.get('11|1001'));
        const r = await M.appliquer(f.db, fiches1001(), { ecrire: true, attendu: 1 });
        const apres = f.col.get('11|1001');
        const { prixMelangeTampon, tamponsConnus, prixMelangeTamponPreuve, ...reste } = apres;
        verifier('trois champs posés, le reste intact', [prixMelangeTampon, tamponsConnus, Array.isArray(prixMelangeTamponPreuve) && prixMelangeTamponPreuve.length, reste, r.ecrit], [true, ['staff'], 1, avant, 1]);
        verifier('aucune autre ligne touchée', [...f.col.values()].filter(l => l.prixMelangeTampon).map(l => l._id), ['11|1001']);
        verifier('un seul $set, sur ces trois champs', Object.keys(f.writes[0].u.$set).sort(), M.CHAMPS.slice().sort());
    });
    await essayer('idempotence', async () => {
        const f = fausseBase(LIGNES);
        await M.appliquer(f.db, fiches1001(), { ecrire: true, attendu: 1 });
        const n = f.writes.length, snap = f.instantane();
        const r = await M.appliquer(f.db, fiches1001(), { ecrire: true, attendu: 1 });
        verifier('deuxième passe : rien réécrit', [f.writes.length, f.instantane() === snap, r.ecrit, r.dejaFait], [n, true, 0, true]);
    });
    await essayer('les 64 paires et les variantes ne sont jamais écrites', async () => {
        const f = fausseBase(LIGNES);
        const p = plan([T({ idProduct: 1001 }), T({ nom: 'Meganium', numero: '1', expansions: [5241], idProduct: 1009 }), T({ nom: 'Chansey', numero: '9', idProduct: 1011 })]);
        await M.appliquer(f.db, p, { ecrire: true, attendu: 1 });
        verifier('seul 1001 est marqué', [...f.col.values()].filter(l => l.prixMelangeTampon).map(l => l.idProduct), [1001]);
    });
    await essayer('une fiche à plusieurs lignes : toutes marquées', async () => {
        const lignes = [...LIGNES, L(1001, 88, 'Diamond-Pearl', 100, '3', { nomCarte: 'Electivire' })];
        const p = M.construirePlan({ temoins: [T({ idProduct: 1001 })], produits: PRODUITS, lignes, exclus: EXCLUS });
        const f = fausseBase(lignes);
        await M.appliquer(f.db, p, { ecrire: true, attendu: 1 });
        verifier('deux lignes du même idProduct', [...f.col.values()].filter(l => l.prixMelangeTampon).map(l => l._id).sort(), ['11|1001', '88|1001']);
    });
    await essayer('une ligne devenue séparée entre la simulation et l\'écriture n\'est pas écrite', async () => {
        const f = fausseBase(LIGNES); f.col.get('11|1001').variante = 'staff';
        const r = await M.appliquer(f.db, fiches1001(), { ecrire: true, attendu: 1 });
        verifier('ligne séparée : sautée à l\'écriture', [f.writes.length, r.ecrit, r.sautees], [0, 0, 1]);
    });
    await essayer('écriture sans effet', async () => {
        const f = fausseBase(LIGNES); let msg = null;
        const vraie = f.db.collection;
        f.db.collection = n => ({ ...vraie(n), async updateOne() { return { matchedCount: 1, modifiedCount: 0 }; } });
        try { await M.appliquer(f.db, fiches1001(), { ecrire: true, attendu: 1 }); } catch (e) { msg = e.message; }
        verifier('une écriture qui ne change rien arrête le lot', /inchang/.test(msg || ''), true);
    });
    await essayer('ligne disparue', async () => {
        const f = fausseBase(LIGNES.filter(l => l.idProduct !== 1001)); let msg = null;
        try { await M.appliquer(f.db, fiches1001(), { ecrire: true, attendu: 1 }); } catch (e) { msg = e.message; }
        verifier('ligne introuvable : arrêt nommé', /introuvable|inchang/.test(msg || ''), true);
    });
    await essayer('lireLignes', async () => {
        const f = fausseBase(LIGNES);
        const l = await M.lireLignes(f.db);
        verifier('lit les lignes (sans la base réelle)', [l.length, l.find(x => x.idProduct === 1001)?._id], [LIGNES.length, '11|1001']);
    });

    // ── lecture du clone TCGdex (fichiers .ts, jamais évalués) ──
    await essayer('clone TCGdex', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-pm-'));
        try {
            const s = path.join(tmp, 'data', 'Diamond & Pearl'); fs.mkdirSync(path.join(s, 'Diamond & Pearl'), { recursive: true });
            fs.writeFileSync(path.join(s, 'Diamond & Pearl.ts'), 'import { Set } from \'../../interfaces\'\nconst set: Set = {\n\tid: "dp1",\n\tname: { en: "Diamond & Pearl" },\n\tthirdParty: {\n\t\tcardmarket: 100\n\t}\n}\nexport default set\n');
            fs.writeFileSync(path.join(s, 'Diamond & Pearl', '3.ts'), 'const card: Card = {\n\tname: {\n\t\ten: "Electivire",\n\t\tfr: "Élekable"\n\t},\n\tthirdParty: {\n\t\tcardmarket: 1001\n\t},\n\tvariants: [\n\t\t{ type: "holo" },\n\t\t{\n\t\t\ttype: "normal",\n\t\t\tstamp: ["regional-championships","staff"]\n\t\t},\n\t\t{\n\t\t\ttype: "normal",\n\t\t\tstamp: ["pre-release"],\n\t\t\tthirdParty: { cardmarket: 1002 }\n\t\t}\n\t]\n}\nexport default card\n');
            fs.writeFileSync(path.join(s, 'Diamond & Pearl', '4.ts'), 'const card: Card = {\n\tname: { en: "Sans tampon" },\n\tvariants: [{ type: "holo" }]\n}\nexport default card\n');
            const r = M.lireTemoinsClone(path.join(tmp, 'data'), new Set([1001, 1002]));
            verifier('un témoin : nom, numéro, expansion du set, idProduct de la carte, tampons des variantes sans produit propre', r.temoins.map(t => [t.source, t.enregistrement, t.nom, t.numero, t.expansions, t.idProduct, t.tampons]),
                [['tcgdex-clone', 'Diamond & Pearl/Diamond & Pearl/3.ts', 'Electivire', '3', [100], 1001, ['staff']]]);
            verifier('comptes lus', [r.nSets, r.nCartes, r.hors], [1, 2, {}]);
            fs.writeFileSync(path.join(s, 'Diamond & Pearl', '5.ts'), 'const card: Card = {\n\tvariants: [\n\t\t{\n\t\t\ttype: "normal",\n\t\t\tstamp: ["staff"]\n\t\t}\n\t]\n}\nexport default card\n');
            const sn = M.lireTemoinsClone(path.join(tmp, 'data'), new Set([1001]));
            verifier('une carte à tampon sans nom : comptée, pas de témoin', [sn.sansNom, sn.temoins.length], [1, 1]);
            const vide = path.join(tmp, 'vide', 'data'); fs.mkdirSync(vide, { recursive: true });
            let msg = null; try { M.lireTemoinsClone(vide, new Set()); } catch (e) { msg = e.message; }
            verifier('un clone vide lève (un zéro n\'est pas un résultat)', /lecture fausse/.test(msg || ''), true);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    // ── LOT TAMPONS-RELEVE : troisième source (relevé du testeur) et fiches sœurs ──
    const CSV = 'annonce_vinted;idProduct;stamp;fiche_cardmarket_propre\n"https://x/1";1002;"Staff + Championship";non\n"https://x/2";1001;"Autre";non\n"https://x/3";1008;"Staff";oui\n"https://x/4";1012;"Staff + Prerelease";non\n"https://x/5";1004;"Inconnu";non\n';
    await essayer('relevé : liste fermée étendue', () => verifier('championship et autre ajoutés', [M.TAMPONS_FERMES.includes('championship'), M.TAMPONS_FERMES.includes('autre'), M.TAMPONS_FERMES.includes('staff')], [true, true, true]));
    await essayer('relevé : table fermée', () => verifier('la table', M.TAMPONS_RELEVE, { 'Staff': ['staff'], 'Prerelease': ['prerelease'], 'Staff + Prerelease': ['staff', 'prerelease'], 'League': ['league'], 'Championship': ['championship'], 'Staff + Championship': ['staff', 'championship'], 'Staff + Autre': ['staff', 'autre'], 'Autre': ['autre'] }));
    await essayer('relevé : lecture du CSV', () => {
        const r = M.temoinsReleve(CSV);
        verifier('seules les lignes « non » à stamp connu deviennent témoins', r.temoins.map(t => [t.idProduct, t.tampons, t.source]), [[1002, ['staff', 'championship'], 'releve-testeur'], [1001, ['autre'], 'releve-testeur'], [1012, ['staff', 'prerelease'], 'releve-testeur']]);
        verifier('stamp hors table : écarté, nommé', r.ecartes.map(e => [e.motif, e.idProduct]), [['stamp-hors-table', 1004]]);
        verifier('dénominateur', [r.lues, r.non], [5, 4]);
    });
    await essayer('relevé : entête inconnue', () => { let msg = null; try { M.temoinsReleve('a;b\n1;2\n'); } catch (e) { msg = e.message; } verifier('entête fausse : refus', /entête/.test(msg || ''), true); });
    await essayer('relevé : sur une paire, les frères ne comptent pas (le testeur a désigné le produit)', () => {
        const p = plan([{ source: 'releve-testeur', enregistrement: 'releve:1002', idProduct: 1002, tampons: ['staff'], libelle: 'relevé du testeur, 2026-10-18 (Staff)' }]);
        verifier('marquée malgré le frère', [ids(p), p.fiches[0]?.preuveTexte, p.fiches[0]?.preuves[0]?.mode], [[1002], ['relevé du testeur, 2026-10-18 (Staff)'], 'releve-testeur']);
    });
    await essayer('relevé : garde sur ce que la source n\'a pas utilisé', () => {
        const R = o => ({ source: 'releve-testeur', enregistrement: `releve:${o.idProduct}`, tampons: ['staff'], libelle: 'x', ...o });
        const p = plan([R({ idProduct: 1011 }), R({ idProduct: 1009 }), R({ idProduct: 424242 }), R({ idProduct: 1012 })]);
        verifier('ligne séparée, paire Black Star, produit absent, produit sans ligne : tous sautés pour leur motif', [ids(p), motifs(p), p.sansLigne.length], [[], ['deja-separee-par-variante', 'paire-black-star-exclue', 'produit-absent-de-l-export', 'ligne-absente'], 0]);
        const q = plan([R({ idProduct: 1001 })], { lignes: LIGNES.map(l => l.idProduct === 1001 ? { ...l, prixMelangeTampon: true } : l) });
        verifier('déjà marquée : ne se réécrit pas', [ids(q), motifs(q)], [[], ['deja-marquee']]);
        const phrase = 'relevé du testeur, 2026-10-18 (x)';
        const q2 = plan([R({ idProduct: 1001, libelle: phrase })], { lignes: LIGNES.map(l => l.idProduct === 1001 ? { ...l, prixMelangeTampon: true, marquagePreuve: [phrase] } : l) });
        verifier('déjà marquée PAR le relevé : reste dans le plan (la revérification après écriture ne perd rien)', [ids(q2), motifs(q2)], [[1001], []]);
    });
    await essayer('appliquer : un marquage plus riche déjà posé n\'est pas réécrit', async () => {
        const f = fausseBase(LIGNES); Object.assign(f.col.get('11|1001'), { prixMelangeTampon: true, tamponsConnus: ['autre', 'staff'], prixMelangeTamponPreuve: ['a', 'b'] });
        const p = plan([T({ idProduct: 1001 })]); p.fiches[0].preuveTexte = ['a'];
        const r = await M.appliquer(f.db, p, { ecrire: true, attendu: 1 });
        verifier('plan inclus dans le marquage : rien réécrit', [f.writes.length, r.deja, r.dejaFait], [0, 1, true]);
        const g = fausseBase(LIGNES); Object.assign(g.col.get('11|1001'), { prixMelangeTampon: true, tamponsConnus: ['prerelease'], prixMelangeTamponPreuve: ['a'] });
        const q = plan([T({ idProduct: 1001 })]);
        const r2 = await M.appliquer(g.db, q, { ecrire: true, attendu: 1 });
        verifier('plan plus riche : écrit', [g.writes.length, r2.ecrit], [1, 1]);
    });
    await essayer('« Stamped Cosmos Holofoil X » : le nom de la carte', () => {
        const r = M.temoinsPokumon([{ id: 7, nom: 'Stamped Cosmos Holofoil Zygarde', titre: 'x', set: 'Pokemon League Special Print', numero: '72', total: '131', evenements: [1], anglais: true }]);
        verifier('préfixe d\'impression retiré, tampon league', [r.temoins[0]?.nom, r.temoins[0]?.tampons], ['Zygarde', ['league']]);
    });
    await essayer('clone sans expansion : ancrage par le nom EXACT du set', () => {
        const prods = [P(5001, 'Tropical Wind [Aero Slice]', 700, 6001)], lg = [L(5001, 61, 'DP-Black-Star-Promos', 700, 'DP05', { nomCarte: 'Tropical Wind' })];
        const t = T({ nom: 'Tropical Wind', numero: 'DP05', expansions: null, total: null, setNom: 'DP Black Star Promos', tampons: ['league'] });
        const p = M.construirePlan({ temoins: [t], produits: prods, lignes: lg });
        verifier('set nommé comme un slugSet existant : ancré, marqué', [ids(p), p.fiches[0]?.set], [[5001], 'DP-Black-Star-Promos']);
        const q = M.construirePlan({ temoins: [{ ...t, setNom: 'Autre Promos' }], produits: prods, lignes: lg });
        verifier('nom de set sans slugSet égal : toujours sans ancrage', motifs(q), ['temoin-sans-ancrage']);
    });
    // « 121 » et « 121a » : une VERSION à produit dédié, pas une réimpression — les 6 paires RÉELLES relevées par la relecture (idProduct du « a », idProduct du numéro normal, nom, set, expansion, numéro, total)
    const REELLES = [[449138, 297573, 'Choice Band', 'Guardians-Rising', 1800, '121', '145'], [371641, 297580, 'Max Potion', 'Guardians-Rising', 1800, '128', '145'], [450308, 297582, 'Rescue Stretcher', 'Guardians-Rising', 1800, '130', '145'],
        [448148, 299516, 'Kiawe', 'Burning-Shadows', 1824, '116', '147'], [448158, 355625, 'Metal Frying Pan', 'Forbidden-Light', 1860, '112', '131'], [450048, 365821, 'Net Ball', 'Lost-Thunder', 1900, '187', '214']];
    for (const [idA, idB, nom, set, exp, n, total] of REELLES) {
        await essayer(`suffixe réel : ${nom} ${n}a`, () => {
            const meta = 7000 + idB % 1000, prods = [P(idA, nom, exp, meta), P(idB, nom, exp, meta)];
            const lg = [L(idA, 81, set, exp, `${n}a`, { nomCarte: nom, impTotal: total }), L(idB, 82, set, exp, n, { nomCarte: nom, impTotal: total })];
            const t = { source: 'pokumon', enregistrement: `pokumon:${idA}`, nom, numero: `${n}a`, total, tampons: ['staff'], idProduct: null };
            const p = M.construirePlan({ temoins: [t], produits: prods, lignes: lg });
            verifier('le produit « a » a son frère au numéro normal : sauté, jamais marqué', [ids(p), motifs(p)], [[], ['plusieurs-produits-pour-la-carte']]);
            const q = M.construirePlan({ temoins: [{ ...t, numero: n }], produits: prods, lignes: lg });
            verifier('le numéro normal : le « a » est un frère, sauté aussi', ids(q), []);
        });
    }
    await essayer('suffixe : deux numéros disjoints qui ne diffèrent pas par une lettre restent une réimpression', () => {
        const prods = [P(8001, 'Super Rod', 100, 700), P(8002, 'Super Rod', 100, 700)];
        const lg = [L(8001, 91, 'Diamond-Pearl', 100, '188'), L(8002, 91, 'Diamond-Pearl', 100, '276')];
        verifier('188 contre 276 : marquée', ids(M.construirePlan({ temoins: [T({ nom: 'Super Rod', numero: '188', idProduct: 8001 })], produits: prods, lignes: lg })), [8001]);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
