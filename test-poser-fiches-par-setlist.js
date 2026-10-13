// node test-poser-fiches-par-setlist.js — L'OUTIL D'ÉCRITURE (lot SEA-2, tour 1) sur une FAUSSE BASE en mémoire. Aucun réseau, aucune vraie base.
// Monde : 4 cartes à une Setlist ; 3 produits frères joints par carte (vérité connue) ; 2 produits cibles non joints (T1 -> carte 1 n°1, T2 -> carte 2 n°2) ;
// un homonyme de la carte 3 dans la Setlist (le cas dangereux). Les noms et attaques suivent le format Cardmarket « Nom [Attaque | Attaque] ».
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de l'outil (le rouge se voit en cassant le code, pas en supposant).
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { executer } = require(path.join(DIR, 'poser-fiches-par-setlist.js'));
const { decomposerNomCardmarket } = require(path.join(DIR, 'collecte-cartes', 'jointure'));
const { verdict, MINIMUMS } = require(path.join(DIR, 'collecte-cartes', 'calibration-setlist-metacarte'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── la fausse base ──
function fakeDb(init) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, structuredClone(d)]))]));
    const stats = { upserts: 0, ecritures: 0, panneAvantCartes: false, perdreDerniereLigne: false, perdreImpressions: false };
    const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
    const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => {
        if (k === '_id') return v && typeof v === 'object' && v.$in ? v.$in.includes(d._id) : d._id === v;
        if (v && v.$not && v.$not.$elemMatch) return !(get(d, k) || []).some(e => Object.entries(v.$not.$elemMatch).every(([a, b]) => e[a] === b));
        return get(d, k) === v;
    });
    const appliquer = (d, u, cree) => {
        if (u.$setOnInsert && cree) for (const [k, v] of Object.entries(u.$setOnInsert)) set(d, k, v);
        for (const [k, v] of Object.entries(u.$addToSet || {})) { const t = get(d, k) || []; for (const x of (v.$each || [v])) if (!t.some(y => JSON.stringify(y) === JSON.stringify(x))) t.push(x); set(d, k, t); }
        for (const [k, v] of Object.entries(u.$push || {})) { const t = get(d, k) || []; t.push(structuredClone(v)); set(d, k, t); }
        for (const [k, v] of Object.entries(u.$set || {})) set(d, k, v);
    };
    const col = nom => { const m = cols.get(nom) || cols.set(nom, new Map()).get(nom); return {
        find: f => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f || {})).map(d => structuredClone(d)) }),
        countDocuments: async () => m.size,
        async updateOne(f, u, o = {}) { if (stats.perdreImpressions && u.$push) return { matchedCount: 0, modifiedCount: 0 }; const d =[...m.values()].find(x => correspond(x, f)); if (!d) return { matchedCount: 0, modifiedCount: 0 }; appliquer(d, u, false); stats.ecritures++; return { matchedCount: 1, modifiedCount: 1 }; },
        async bulkWrite(ops) {
            if (nom === 'cartes' && stats.panneAvantCartes) { stats.panneAvantCartes = false; throw new Error('PANNE simulée avant l\'écriture des cartes'); }
            if (nom === 'cartes_produits' && stats.perdreDerniereLigne) ops = ops.slice(0, -1);   // une écriture qui perd une ligne SANS erreur
            for (const { updateOne: { filter, update, upsert } } of ops) {
                let d = m.get(filter._id), cree = false;
                if (!d) { if (!upsert) continue; d = { _id: filter._id }; m.set(d._id, d); cree = true; stats.upserts++; }
                appliquer(d, update, cree); stats.ecritures++;
            }
            return { upsertedCount: 0 };
        }
    }; };
    return { collection: col, stats, brut: nom => [...cols.get(nom).values()].map(d => structuredClone(d)) };
}

// ── le monde ──
const attaquesDe = i => [`Aa${i}`, `Bb${i}`];
const carte = (i, id = 1000 + i) => ({ _id: id, nomEn: `Mon${i}`, attaques: attaquesDe(i).map(nom => ({ nom })), impressions: [], sets: ['SetX'], liens: { idProduct: [] } });
const nomProduit = i => `Mon${i} [${attaquesDe(i).join(' | ')}]`;
const L = { code: 'X/ID', slugSet: 'SetX', exp: 1, bulba: { tirage: 'id', expansion: 'X Promo' } };
function monde({ veriteFausse = false, veriteContredite = false, impressionSansNumero = false, exportDecale = false, exportSansMetacarte = false, numeroPartage = false, impressionZeros = false } = {}) {
    const cartes = [1, 2, 3, 4].map(i => carte(i)); const homonyme = { ...carte(3, 1503) };
    // impressionZeros : l'impression « setlist » d'un outil antérieur est écrite « 001 » (zéro-remplissage) — le même numéro que « 1 » (cleNumero)
    if (impressionZeros) cartes[0].impressions.push({ tirage: 'id', expansion: 'X Promo', numero: '001', total: null, deck: null, rarete: null, source: 'setlist' });
    // veriteFausse : la ligne de vérité de P1 pointe la carte 2, dont les attaques SONT celles du produit (le témoin ne la contredit pas) → un vrai faux de l'épreuve A
    if (veriteFausse) cartes[1].attaques = attaquesDe(1).map(nom => ({ nom }));
    if (impressionSansNumero) cartes[1].impressions.push({ tirage: 'id', expansion: 'X Promo', numero: null, source: 'parseur' });
    const produits = [], lignes = [];
    const joint = (idProduct, i, meta, carteId = 1000 + i) => { produits.push({ idProduct, name: nomProduit(i), idMetacard: meta }); lignes.push({ _id: `${carteId}|${idProduct}`, carteId, idProduct, slugSet: 'SetX', numeroFiche: String(i), preuve: 'set+numero' }); };
    for (const i of [1, 2, 3, 4]) { joint(100 + i, i, 10 + i, (veriteFausse || veriteContredite) && i === 1 ? 1002 : 1000 + i); joint(200 + i, i, 10 + i); }
    joint(401, 1, 11); joint(403, 3, 13);
    produits.push({ idProduct: 301, name: nomProduit(1), idMetacard: 11 }, { idProduct: 302, name: nomProduit(2), idMetacard: 12 });
    const entrees = [...cartes.map((c, i) => ({ carte: c, numero: String(i + 1) })), { carte: homonyme, numero: '13' }];
    // numeroPartage : une AUTRE carte de la Setlist porte le n° 1 (le cas Pawmi / Squawkabilly ex, n° 17)
    if (numeroPartage) entrees.push({ carte: { ...carte(9, 1509), nomEn: 'Zzz', attaques: [{ nom: 'Zz' }] }, numero: '01' });
    const decale = exportDecale ? 9000000 : 0;
    const chemin = path.join(os.tmpdir(), `export-test-poser-fiches-${process.pid}-${exportDecale ? 'decale' : 'bon'}.json`);
    // un export dont les produits existent mais SANS idMetacard (le cas du relecteur A : « tout silence », sans erreur)
    fs.writeFileSync(chemin, JSON.stringify({ products: produits.map(p => { const q = { ...p, idProduct: p.idProduct + decale }; if (exportSansMetacarte) delete q.idMetacard; return q; }) }));
    const liste = produits.map(p => ({ idProduct: p.idProduct, name: p.name, slug: null, slugSet: 'SetX', ...decomposerNomCardmarket(p.name) }));
    return { db: fakeDb({ cartes_produits: lignes, cartes: [...cartes, homonyme] }), entrees, chemin, liste };
}
const MIN = { A: 1, D_A: 1, D_C: 1 };
async function lancer(w, argv, { minimums = MIN, avantOuvrir = null } = {}) {
    const sorties = [], erreurs = []; let ouvertures = 0;
    const code = await executer({ argv: [...argv, `--export=${w.chemin}`], table: [L], minimums, log: s => sorties.push(s), err: s => erreurs.push(s),
        ouvrir: async () => { ouvertures++; if (avantOuvrir) avantOuvrir(); return { db: w.db, fermer: async () => { } }; },
        lireSetlist: async () => ({ entrees: w.entrees }), produitsDe: async () => w.liste }).catch(e => { erreurs.push(`EXCEPTION ${e.message}`); return 99; });
    return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n'), ouvertures };
}
const lignesPosees = w => w.db.brut('cartes_produits').filter(l => l.preuve === 'metacarte+setlist');

(async () => {
    // ── simulation : rien n'est écrit, et la calibration est rejouée ──
    let w = monde(); let avant = JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
    let r = await lancer(w, ['--codes=X/ID']);
    verifier('simulation : exit 0, 2 fiches planifiées, RIEN d\'écrit, la calibration est rejouée et imprimée (cas atteints)', [r.code, /2 fiches, 2 impressions/.test(r.sorties), /ATTEINTS/.test(r.sorties), /CALIBRATION rejouée/.test(r.sorties), JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]) === avant], [0, true, true, true, true]);

    // ── écriture additive, relecture ──
    w = monde(); avant = w.db.brut('cartes_produits').length; const ancien = w.db.brut('cartes_produits');
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('écriture : exit 0, relue en base ("écrit et relu"), 2 lignes metacarte+setlist, numéro = celui de la Setlist', [r.code, /écrit et relu/.test(r.sorties), lignesPosees(w).map(l => `${l.idProduct}:${l.numeroFiche}`).sort()], [0, true, ['301:1', '302:2']]);
    verifier('   additive : les lignes d\'avant sont inchangées, deux lignes de plus, une impression « setlist » par carte, liens et set ajoutés', [JSON.stringify(w.db.brut('cartes_produits').filter(l => l.preuve !== 'metacarte+setlist')) === JSON.stringify(ancien), w.db.brut('cartes_produits').length - avant,
        w.db.brut('cartes').filter(c => c.impressions.some(i => i.source === 'setlist')).map(c => c._id).sort(), w.db.brut('cartes').find(c => c._id === 1002).liens.idProduct],
        [true, 2, [1001, 1002], [302]]);

    // ── refus avant toute écriture ──
    w = monde(); avant = JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire'], { minimums: { A: 99, D_A: 1, D_C: 1 } });
    verifier('refus : calibration sous le minimum de cas atteints → exit 1, rien d\'écrit, dit pourquoi', [r.code, /minimum 99/.test(r.sorties), /calibration refuse/.test(r.erreurs), JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]) === avant], [1, true, true, true]);
    w = monde({ veriteFausse: true }); avant = JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('refus : un FAUX à l\'épreuve A (vérité de la base ≠ carte désignée) → exit 1, rien d\'écrit', [r.code, /faux de carte/.test(r.sorties), JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]) === avant], [1, true, true]);
    w = monde({ veriteContredite: true });
    r = await lancer(w, ['--codes=X/ID']);
    verifier('témoin sur la vérité : une ligne « vérité » dont la carte est CONTREDITE par les attaques du produit est écartée de la population et comptée (pas un faux de la clé)', [r.code, /CONTREDITES par les attaques du produit, écartées de la population : 1/.test(r.sorties), /faux de carte/.test(r.sorties)], [0, true, false]);
    w = monde(); avant = JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:3', '--ecrire']);
    verifier('refus : --attendu faux (3 pour 2) → exit 1, rien d\'écrit', [r.code, /rend 2, attendu 3/.test(r.erreurs), JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]) === avant], [1, true, true]);
    w = monde();
    r = await lancer(w, ['--codes=X/ID,Z/ZZ', '--attendu=X/ID:2,Z/ZZ:5', '--ecrire']);
    verifier('refus : un code hors de la table, MÊME avec son --attendu → exit 1, rien d\'écrit, la base n\'est pas ouverte', [r.code, /absent\(s\) de la table : Z\/ZZ/.test(r.erreurs), r.ouvertures, lignesPosees(w).length], [1, true, 0, 0]);
    w = monde();
    r = await lancer(w, ['--codes=X/ID,X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('refus : --codes en doublon refusé AVANT toute ouverture et toute écriture → exit 2', [r.code, /doublon/.test(r.erreurs), r.ouvertures, lignesPosees(w).length], [2, true, 0, 0]);
    w = monde();
    r = await lancer(w, ['--codes=X/ID', '--ecrire']);
    verifier('refus : --ecrire sans --attendu → exit 2, rien d\'écrit', [r.code, lignesPosees(w).length], [2, 0]);
    w = monde({ exportDecale: true }); avant = JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('refus : un export qui n\'apparie RIEN avec la base → la calibration LÈVE (§41), rien d\'écrit', [r.code, /0 des \d+ clés|appariement/.test(r.erreurs), JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]) === avant], [99, true, true]);

    w = monde({ exportSansMetacarte: true }); avant = JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('refus : un export dont les produits sont là mais SANS idMetacard (« tout silence ») → la calibration LÈVE, rien d\'écrit', [r.code, /PORTANT idMetacard/.test(r.erreurs), JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]) === avant], [99, true, true]);

    // ── reprise après un arrêt ──
    w = monde(); w.db.stats.panneAvantCartes = true;
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    const apresPanne = lignesPosees(w).length; const upsertsApresPanne = w.db.stats.upserts;
    verifier('arrêt au milieu (lignes posées, cartes pas encore) : la première exécution échoue', [r.code, apresPanne], [99, 2]);
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('reprise : même plan (--attendu 2), AUCUNE ligne reposée (upserts inchangés), cartes et impressions achevées, relecture OK', [r.code, w.db.stats.upserts - upsertsApresPanne, lignesPosees(w).length, /écrit et relu/.test(r.sorties)], [0, 0, 2, true]);
    const avantTroisieme = JSON.stringify(w.db.brut('cartes'));
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('relance sur un lot déjà écrit : idempotente (cartes inchangées, pas d\'impression en double)', [r.code, JSON.stringify(w.db.brut('cartes')) === avantTroisieme], [0, true]);

    // ── une impression du parseur au même set, sans numéro ──
    w = monde({ impressionSansNumero: true });
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:1', '--ecrire']);
    verifier('impression du parseur au même set SANS numéro : la carte est écartée (fiche mélangée), pas d\'impression en double', [r.code, lignesPosees(w).map(l => l.idProduct), w.db.brut('cartes').find(c => c._id === 1002).impressions.length], [0, [301], 1]);

    // ── garde (1), 2026-10-13 : un numéro de Setlist porté par DEUX cartes ou plus ne désigne aucune d'elles (le cas Pawmi / Gastly de M-P/ID) ──
    w = monde({ numeroPartage: true }); avant = JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
    r = await lancer(w, ['--codes=X/ID']);
    verifier('numéro partagé (simulation) : T1 (n°1, partagé avec « Zzz » au n° « 01 ») est REFUSÉ et nommé, T2 reste ; rien d\'écrit', [r.code, /1 fiches, 1 impressions/.test(r.sorties), /numéro de Setlist « 1 » porté par 2 cartes/.test(r.sorties), JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]) === avant], [0, true, true, true]);
    w = monde({ numeroPartage: true });
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('numéro partagé : --attendu 2 (l\'ancien plan) est REFUSÉ, rien d\'écrit', [r.code, /rend 1, attendu 2/.test(r.erreurs), lignesPosees(w).length], [1, true, 0]);
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:1', '--ecrire']);
    verifier('numéro partagé : --attendu 1 écrit la seule ligne sans collision (T2 -> n°2) et la relit', [r.code, lignesPosees(w).map(l => `${l.idProduct}:${l.numeroFiche}`)], [0, ['302:2']]);

    // ── 2026-10-13 : la relecture compare les numéros par cleNumero (« 001 » = « 1 »), pas à la lettre ──
    w = monde({ impressionZeros: true });
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('relecture : une impression « 001 » d\'un outil antérieur EST le n° 1 -> « écrit et relu », exit 0 (pas de faux négatif)', [r.code, /écrit et relu/.test(r.sorties), /impressions « setlist » 2\/2/.test(r.sorties), w.db.brut('cartes').find(c => c._id === 1001).impressions.length], [0, true, true, 1]);

    // ── tour 3 : la RELECTURE en base après l'écriture ──
    w = monde(); w.db.stats.perdreDerniereLigne = true;
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('relecture : une écriture qui PERD une ligne sans erreur → la relecture en base ne retrouve pas le compte → exit 1 (et le dit)', [r.code, /relecture ne retrouve pas/.test(r.erreurs), /RELECTURE : lignes 1\/2/.test(r.sorties)], [1, true, true]);
    w = monde(); w.db.stats.perdreImpressions = true;
    r = await lancer(w, ['--codes=X/ID', '--attendu=X/ID:2', '--ecrire']);
    verifier('relecture : des impressions non posées (sans erreur) → exit 1', [r.code, /relecture ne retrouve pas/.test(r.erreurs), /impressions « setlist » 0\/2/.test(r.sorties)], [1, true, true]);

    // ── tour 3 : le verdict, sur des états FABRIQUÉS en mémoire ──
    const sain = () => ({ total: { A: { fauxCarte: 0, fauxNumero: 0, formes: 0, atteints: 200 }, B: { fauxCarte: 0, atteints: 0 }, C: { fauxCarte: 0, atteints: 9 } }, danger: { A: { fauxCarte: 0, fauxNumero: 0, atteints: 200 }, C: { fauxCarte: 0, atteints: 47 } } });
    const v = (mod, mins = MINIMUMS) => { const c = sain(); mod(c); return verdict(c, mins); };
    verifier('verdict : un état sain (A et D-A à 200 atteints, B, C et D-C à 0 faux et peu de cas) PASSE — B, C, D-C n\'ont aucun minimum', v(() => { }).ok, true);
    verifier('verdict : 1 faux sur D-C SEUL → REFUSE (la vraie carte retirée entre dans la décision)', [v(c => { c.danger.C.fauxCarte = 1; }).ok, /D-C/.test(v(c => { c.danger.C.fauxCarte = 1; }).refus.join())], [false, true]);
    verifier('verdict : 1 faux sur C seul → REFUSE ; 1 faux sur B seul → REFUSE', [v(c => { c.total.C.fauxCarte = 1; }).ok, v(c => { c.total.B.fauxCarte = 1; }).ok], [false, false]);
    verifier('verdict : D-A à 99 cas atteints → REFUSE (minimum 100) ; à 100 → passe', [v(c => { c.danger.A.atteints = 99; }).ok, v(c => { c.danger.A.atteints = 100; }).ok], [false, true]);
    verifier('verdict : A à 99 cas atteints → REFUSE ; 1 faux de numéro sur D-A → REFUSE', [v(c => { c.total.A.atteints = 99; }).ok, v(c => { c.danger.A.fauxNumero = 1; }).ok], [false, false]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    try { for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(`export-test-poser-fiches-${process.pid}`)) fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { }
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
