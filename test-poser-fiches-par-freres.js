// node test-poser-fiches-par-freres.js — L'OUTIL D'ÉCRITURE (lot M2) sur une FAUSSE BASE en mémoire. Aucun réseau, aucune vraie base, aucune règle du site réelle
// (un faux site, dont le comportement est choisi par le banc). Monde : un set intl SetX (expansion 7), quatre cartes Mon1..Mon4 à trois produits joints chacune
// (vérité connue, métacartes 11..14) ; quatre produits CIBLES non joints : 501 (frères de Mon1 : fiche AVEC numéro), 502 (Mon2 : carte absente du clone, fiche SANS
// numéro), 504 (Mon4 : TCGdex le nomme avec un tampon, fiche SANS numéro), 509 (aucun frère : refus). TOOL_DIR=<dossier> : copie MUTÉE de l'outil.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { executer, PREUVE } = require(path.join(DIR, 'poser-fiches-par-freres.js'));
const Cal = require(path.join(DIR, 'collecte-cartes', 'calibration-freres-metacarte'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── la fausse base (même forme que celle de SEA-2 : $setOnInsert, $addToSet/$each, upsert) ──
function fakeDb(init) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, structuredClone(d)]))]));
    const stats = { upserts: 0, panneAvantCartes: false, perdreDerniereLigne: false, perdreOperationsCartes: false, effacerNumeros: false };
    const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
    const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? (v && typeof v === 'object' && v.$in ? v.$in.includes(d._id) : d._id === v) : get(d, k) === v);
    const appliquer = (d, u, cree) => {
        if (u.$setOnInsert && cree) for (const [k, v] of Object.entries(u.$setOnInsert)) set(d, k, v);
        for (const [k, v] of Object.entries(u.$addToSet || {})) { const t = get(d, k) || []; for (const x of (v.$each || [v])) if (!t.some(y => JSON.stringify(y) === JSON.stringify(x))) t.push(x); set(d, k, t); }
    };
    const col = nom => { const m = cols.get(nom) || cols.set(nom, new Map()).get(nom); return {
        collectionName: nom,
        find: f => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f || {})).map(d => structuredClone(d)) }),
        countDocuments: async () => m.size,
        async bulkWrite(ops) {
            if (nom === 'cartes' && stats.panneAvantCartes) { stats.panneAvantCartes = false; throw new Error('PANNE simulée avant l\'écriture des cartes'); }
            if (nom === 'cartes_produits' && stats.perdreDerniereLigne) ops = ops.slice(0, -1);
            if (nom === 'cartes' && stats.perdreOperationsCartes) ops = ops.slice(0, -1);
            for (const { updateOne: { filter, update, upsert } } of ops) {
                let d = m.get(filter._id), cree = false;
                if (!d) { if (!upsert) continue; d = { _id: filter._id }; m.set(d._id, d); cree = true; stats.upserts++; }
                appliquer(d, update, cree);
                if (nom === 'cartes_produits' && stats.effacerNumeros) d.numeroFiche = null;   // une écriture qui range une ligne SANS son numéro, sans erreur
            }
            return { upsertedCount: 0 };
        }
    }; };
    return { collection: col, stats, brut: nom => [...cols.get(nom).values()].map(d => structuredClone(d)) };
}

// ── le monde ──
const attaquesDe = i => [`Aa${i}`, `Bb${i}`];
const nomP = i => `Mon${i} [${attaquesDe(i).join(' | ')}]`;
const SET = { _id: 'SetX', code: 'X', idExpansion: [7], tirage: 'intl', region: 'intl', bulba: { expansion: 'X Expansion' } };
const SETJ = { _id: 'SetJ', code: 'J', idExpansion: [8], tirage: 'jp', region: 'jp', bulba: { expansion: 'J' } };
function monde({ veriteFausse = false, exportDecale = false, carteSansRepere = false, imageCarte2 = false } = {}) {
    const cartes = [1, 2, 3, 4].map(i => ({ _id: 1000 + i, nomEn: `Mon${i}`, attaques: attaquesDe(i).map(nom => ({ nom })), niveau: null, sets: ['SetX'], impressions: [], images: [], liens: { idProduct: [100 + i, 200 + i, 300 + i], idMetacards: [10 + i] } }));
    cartes[0].images.push({ set: 'SetX', numero: '1', cleR2: 'k1', source: 'bulbapedia' });
    if (imageCarte2) cartes[1].images.push({ set: 'SetX', numero: '2', cleR2: 'k2', source: 'bulbapedia' });
    if (veriteFausse) cartes[1].attaques = attaquesDe(1).map(nom => ({ nom }));
    if (carteSansRepere) cartes[1].liens = { idProduct: [], idMetacards: [] };
    const produits = [], lignes = [];
    for (const i of [1, 2, 3, 4]) for (const k of [1, 2, 3]) { const id = 100 * k + i, cid = veriteFausse && id === 101 ? 1002 : 1000 + i; produits.push([id, nomP(i), 10 + i, 7]); lignes.push({ _id: `${cid}|${id}`, idProduct: id, carteId: cid, idExpansion: 7, slugSet: 'SetX', numeroFiche: String(i), preuve: 'set+numero' }); }
    produits.push([501, nomP(1), 11, 7], [502, nomP(2), 12, 7], [504, nomP(4), 14, 7], [509, 'Inconnu [Zz | Yy]', 99, 7], [510, 'X Online Code Card', 77, 7]);
    const decale = exportDecale ? 9000000 : 0;
    const chemin = path.join(os.tmpdir(), `export-test-freres-${process.pid}-${exportDecale ? 'decale' : 'bon'}.json`);
    fs.writeFileSync(chemin, JSON.stringify({ products: produits.map(([idProduct, name, idMetacard, idExpansion]) => ({ idProduct: idProduct + decale, name, idMetacard, idExpansion })) }));
    return { db: fakeDb({ cartes_produits: lignes, cartes, sets: [SET, SETJ] }), chemin };
}
const cloneFake = ({ vide = false } = {}) => vide ? null : ({ nSets: 1, nCartes: 3, parProduit: new Map([[504, [{ setId: 'sm3', localId: '4', variante: { type: 'reverse', foil: null, stamp: ['staff'], cardmarket: 504 } }]]]), setsParExpansion: new Map([[7, ['sm3']]]),
    carte: (s, l) => (s === 'sm3' && l === '1') ? { cardmarket: 1, variantes: [{ type: 'normal', foil: null, stamp: [], cardmarket: null }] } : null });
// `unSeulVisuel` : la règle du site (visuelDuProduit / imageDeLImpression) sert le SEUL visuel d'une carte à un produit SANS numéro — un numeroFiche absent
// n'est donc pas « aucun visuel » quand la carte n'a qu'un scan dans le set (constaté en réel : MEP, Pikachu n°093)
const siteFake = ({ perdre = false, unSeulVisuel = false } = {}) => ({ regle: {}, refusDuVisuel: () => null,
    fichesDesProduits: (r, set, docs, lignes) => { const fiche = new Map(); for (const l of lignes) fiche.set(l.idProduct, { carteId: l.carteId, numero: l.numeroFiche ?? null }); if (perdre && lignes.length > 12) fiche.delete(101); return { fiche, doubles: 0 }; },
    imageDeLImpression: (entrees, numero) => numero == null ? (unSeulVisuel && entrees.length === 1 ? entrees[0] : null) : (entrees.find(e => String(e.numero) === String(numero)) ?? null) });
const MIN = { A: 1, D_NOM: 0, D_FRERES: 0 };
async function lancer(w, argv, { minimums = MIN, clone = cloneFake(), site = siteFake(), sansTcgdex = false } = {}) {
    const sorties = [], erreurs = []; let ouvertures = 0;
    const code = await executer({ argv: [...argv, `--export=${w.chemin}`, ...(sansTcgdex ? [] : ['--tcgdex=/clone/data'])], minimums, log: s => sorties.push(s), err: s => erreurs.push(s),
        lireClone: () => { if (!clone) throw new Error('clone vide : 0 set'); return clone; }, chargerSite: async () => site,
        ouvrir: async () => { ouvertures++; return { db: w.db, fermer: async () => { } }; } }).catch(e => { erreurs.push(`EXCEPTION ${e.message}`); return 99; });
    return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n'), ouvertures };
}
const posees = w => w.db.brut('cartes_produits').filter(l => l.preuve === PREUVE);
const instantane = w => JSON.stringify([w.db.brut('cartes_produits'), w.db.brut('cartes')]);
const A = ['--codes=X'], ECR = ['--codes=X', '--attendu=X:3', '--avec-numero=X:1', '--ecrire'];

(async () => {
    // ── simulation ──
    let w = monde(); let avant = instantane(w);
    let r = await lancer(w, A);
    verifier('simulation : exit 0, 3 lignes planifiées dont 1 avec numeroFiche, RIEN d\'écrit, calibration rejouée avec ses cas ATTEINTS', [r.code, /3 lignes · 3 cartes · avec numeroFiche 1 · sans 2 · 1 refusés/.test(r.sorties), /ATTEINTS/.test(r.sorties), /CALIBRATION rejouée/.test(r.sorties), instantane(w) === avant], [0, true, true, true, true]);
    verifier('   la décomposition de la variante est imprimée (tampon / sans-preuve), avec ce que le cahier aurait posé', [/"tampon":1/.test(r.sorties), /"sans-preuve":2/.test(r.sorties), /que le cahier aurait posé : 2/.test(r.sorties)], [true, true, true]);
    verifier('   la simulation du SITE est imprimée : visuels servis 3 -> 4 (dont 1 des lignes ajoutées), 0 perdu', [/visuels servis 3 -> 4 \(dont 1 des lignes ajoutées\)/.test(r.sorties), /PERDUS fiches 0, visuels 0/.test(r.sorties)], [true, true]);
    verifier('   le dénominateur est imprimé (produits du set, déjà joints, sans ligne : la carte-code est exclue)', /4 produits du set|DÉNOMINATEUR 16 produits du set, 12 déjà joints, 4 sans ligne/.test(r.sorties), true);

    // ── écriture additive, relecture ──
    w = monde(); const ancien = w.db.brut('cartes_produits');
    r = await lancer(w, ECR);
    verifier('écriture : exit 0, relue ("écrit et relu"), 3 lignes metacarte+freres, numeroFiche = celui des frères pour 501, null pour 502 et 504', [r.code, /écrit et relu/.test(r.sorties), posees(w).map(l => `${l.idProduct}:${l.numeroFiche}`).sort()], [0, true, ['501:1', '502:null', '504:null']]);
    verifier('   additive : les lignes d\'avant sont inchangées, aucune impression ni image ajoutée, liens.idProduct ajoutés EN FIN, l\'ordre d\'avant conservé', [JSON.stringify(w.db.brut('cartes_produits').filter(l => l.preuve !== PREUVE)) === JSON.stringify(ancien),
        w.db.brut('cartes').every(c => c.impressions.length === 0), w.db.brut('cartes').find(c => c._id === 1001).liens.idProduct, w.db.brut('cartes').find(c => c._id === 1001).images.length], [true, true, [101, 201, 301, 501], 1]);
    verifier('   la ligne porte sa preuve, sa route, le set et la variante dans `detail`', [posees(w).every(l => l.route === 'X' && l.slugSet === 'SetX' && l.tirage === 'intl' && l.slug === null), /tampon/.test(posees(w).find(l => l.idProduct === 504).detail), /SANS numéro/.test(posees(w).find(l => l.idProduct === 502).detail)], [true, true, true]);
    const apres = instantane(w);
    r = await lancer(w, ECR);
    verifier('relance sur un lot DÉJÀ écrit : exit 0 (la relecture attend ce que le plan produit, pas autre chose), rien ne bouge', [r.code, instantane(w) === apres, /écrit et relu/.test(r.sorties)], [0, true, true]);

    // ── un numeroFiche absent n'est PAS « aucun visuel » : le site sert le seul scan d'une carte à un produit sans numéro ──
    w = monde({ imageCarte2: true }); avant = instantane(w);
    r = await lancer(w, A, { site: siteFake({ unSeulVisuel: true }) });
    verifier('la ligne 502 (numéro non posé : carte absente du clone) serait SERVIE par le seul scan de sa carte : elle est RETIRÉE du plan, nommée — 2 lignes restent', [r.code, /2 lignes · 2 cartes · avec numeroFiche 1 · sans 1 · 2 refusés/.test(r.sorties), /servirait à ce produit le scan de la carte 1002 sans preuve de variante/.test(r.sorties), instantane(w) === avant], [0, true, true, true]);
    r = await lancer(w, ['--codes=X', '--attendu=X:3', '--avec-numero=X:1', '--ecrire'], { site: siteFake({ unSeulVisuel: true }) });
    verifier('   --attendu 3 (le plan d\'avant la garde) est refusé : le compte attendu est celui du plan GARDÉ', [r.code, /rend 2 lignes, attendu 3/.test(r.erreurs), posees(w).length], [1, true, 0]);
    r = await lancer(w, ['--codes=X', '--attendu=X:2', '--avec-numero=X:1', '--ecrire'], { site: siteFake({ unSeulVisuel: true }) });
    verifier('   --attendu 2 : écrit et relu, sans la ligne 502', [r.code, posees(w).map(l => l.idProduct).sort()], [0, [501, 504]]);

    // ── refus avant toute écriture ──
    for (const [titre, argv, opt, attendu] of [
        ['--attendu faux (4 pour 3)', ['--codes=X', '--attendu=X:4', '--avec-numero=X:1', '--ecrire'], {}, /rend 3 lignes, attendu 4/],
        ['--avec-numero faux (2 pour 1) : le visuel est une décision séparée', ['--codes=X', '--attendu=X:3', '--avec-numero=X:2', '--ecrire'], {}, /avec numeroFiche, attendu 2/],
        ['calibration sous le minimum de cas atteints', ECR, { minimums: { A: 99, D_NOM: 0, D_FRERES: 0 } }, /calibration refuse/],
        ['la règle du site PERDRAIT une fiche', ECR, { site: siteFake({ perdre: true }) }, /perdrait 1 fiche/]]) {
        w = monde(); avant = instantane(w);
        r = await lancer(w, argv, opt);
        verifier(`refus : ${titre} → exit 1, rien d'écrit`, [r.code, attendu.test(r.erreurs), instantane(w) === avant], [1, true, true]);
    }
    w = monde({ veriteFausse: true }); avant = instantane(w);
    r = await lancer(w, ECR);
    verifier('refus : un FAUX à l\'épreuve A (la vérité de la base ≠ la carte des frères) → exit 1, rien d\'écrit, le faux est nommé', [r.code, /A \(vérité présente\) : 1 faux de carte/.test(r.sorties), /101/.test(r.sorties), instantane(w) === avant], [1, true, true, true]);
    r = await lancer(w, A);
    verifier('   en simulation le même faux est IMPRIMÉ mais la simulation va au bout (exit 0, rien d\'écrit)', [r.code, /CALIBRATION INSUFFISANTE/.test(r.sorties), instantane(w) === avant], [0, true, true]);
    w = monde({ carteSansRepere: true }); avant = instantane(w);
    r = await lancer(w, ECR);
    verifier('refus : une carte dont liens.idProduct est VIDE (son premier idProduct deviendrait son repère d\'adresse) → exit 1, rien d\'écrit', [r.code, /repère d'adresse/.test(r.erreurs), instantane(w) === avant], [1, true, true]);
    w = monde({ exportDecale: true }); avant = instantane(w);
    r = await lancer(w, ECR);
    verifier('refus : un export qui n\'apparie RIEN avec la base → la calibration LÈVE (§41), rien d\'écrit', [r.code, /0 des \d+ clés/.test(r.erreurs), instantane(w) === avant], [99, true, true]);
    w = monde();
    r = await lancer(w, ECR, { clone: null });
    verifier('refus : un clone TCGdex vide LÈVE avant d\'ouvrir la base (la décision du visuel en dépend)', [r.code, /clone vide/.test(r.erreurs), r.ouvertures], [99, true, 0]);
    for (const [titre, argv, code, motif] of [
        ['--codes en doublon', ['--codes=X,X', '--attendu=X:3', '--avec-numero=X:1', '--ecrire'], 2, /doublon/],
        ['--ecrire sans --attendu', ['--codes=X', '--avec-numero=X:1', '--ecrire'], 2, /--attendu=CODE:N ET --avec-numero/],
        ['--ecrire sans --avec-numero', ['--codes=X', '--attendu=X:3', '--ecrire'], 2, /--attendu=CODE:N ET --avec-numero/],
        ['--attendu pour un code non demandé', ['--codes=X', '--attendu=X:3,Q:1', '--avec-numero=X:1', '--ecrire'], 2, /non demandé/],
        ['un argument inconnu', ['--codes=X', '--force'], 2, /argument inconnu/],
        ['un code absent de la base', ['--codes=Z', '--attendu=Z:1', '--avec-numero=Z:0', '--ecrire'], 1, /0 set\(s\) de ce code/],
        ['un set japonais', ['--codes=J', '--attendu=J:1', '--avec-numero=J:0', '--ecrire'], 1, /l'outil ne vaut que pour l'intl/]]) {
        w = monde(); avant = instantane(w);
        r = await lancer(w, argv);
        verifier(`refus : ${titre} → exit ${code}, rien d'écrit`, [r.code, motif.test(r.erreurs), posees(w).length, instantane(w) === avant], [code, true, 0, true]);
    }
    w = monde(); r = await lancer(w, ['--codes=X', '--ecrire'], { sansTcgdex: true });
    verifier('refus : sans --tcgdex → exit 2', [r.code, r.ouvertures], [2, 0]);

    // ── reprise après un arrêt ──
    w = monde(); w.db.stats.panneAvantCartes = true;
    r = await lancer(w, ECR);
    const upsertsApresPanne = w.db.stats.upserts;
    verifier('arrêt au milieu (lignes posées, cartes pas encore) : la première exécution échoue', [r.code, posees(w).length], [99, 3]);
    r = await lancer(w, ECR);
    verifier('reprise : même plan (--attendu 3, --avec-numero 1), AUCUNE ligne reposée, cartes achevées, relecture OK', [r.code, w.db.stats.upserts - upsertsApresPanne, posees(w).length, w.db.brut('cartes').find(c => c._id === 1002).liens.idProduct.includes(502), /écrit et relu/.test(r.sorties)], [0, 0, 3, true, true]);

    // ── la RELECTURE en base ──
    w = monde(); w.db.stats.perdreDerniereLigne = true;
    r = await lancer(w, ECR);
    verifier('relecture : une écriture qui PERD une ligne sans erreur → exit 1, le dit (lignes 2/3)', [r.code, /relecture ne retrouve pas/.test(r.erreurs), /lignes \(preuve et numeroFiche du plan\) 2\/3/.test(r.sorties)], [1, true, true]);
    w = monde(); w.db.stats.perdreOperationsCartes = true;
    r = await lancer(w, ECR);
    verifier('relecture : des cartes non mises à jour (sans erreur) → exit 1 (cartes 2/3)', [r.code, /relecture ne retrouve pas/.test(r.erreurs), /cartes avec tous leurs idProduct et leur set 2\/3/.test(r.sorties)], [1, true, true]);

    w = monde(); w.db.stats.effacerNumeros = true;
    r = await lancer(w, ECR);
    verifier('relecture : une ligne écrite SANS son numeroFiche (le visuel est une décision séparée) → exit 1 (lignes 2/3 : le numéro du plan n\'est pas celui de la base)', [r.code, /relecture ne retrouve pas/.test(r.erreurs), /lignes \(preuve et numeroFiche du plan\) 2\/3/.test(r.sorties)], [1, true, true]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    try { for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(`export-test-freres-${process.pid}`)) fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { }
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
