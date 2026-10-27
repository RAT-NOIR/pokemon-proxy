// node test-numero-fiche-lettre.js — `numeroFiche` avec sa lettre (collecte-cartes/numero-fiche-lettre.js + poser-numero-fiche-lettre.js).
// Base EN MÉMOIRE, aucune requête, jamais une vraie base ni un dossier du testeur (sauvegardes dans un dossier temporaire).
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const N = require(path.join(DIR, 'collecte-cartes', 'numero-fiche-lettre.js'));
const P = require(path.join(DIR, 'poser-numero-fiche-lettre.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`); } };

function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        const x = d[k];
        if (v === null) return x === null || x === undefined;
        if (v && typeof v === 'object' && !Array.isArray(v)) { if ('$in' in v) return v.$in.includes(x); return false; }
        return x === v;
    });
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const writes = [];
    const collection = n => ({
        find(f) { return { toArray: async () => structuredClone(tous(n, f)) }; },
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        async updateOne(f, u) {
            const d = tous(n, f)[0]; if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d);
            for (const [k, v] of Object.entries(u.$set || {})) d[k] = structuredClone(v);
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            writes.push({ n, f, u });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit'); }, async insertOne() { throw new Error('insertOne : interdit'); },
        async deleteOne() { throw new Error('deleteOne : interdit'); }, async deleteMany() { throw new Error('deleteMany : interdit'); }, async replaceOne() { throw new Error('replaceOne : interdit'); }
    });
    return { db: { collection }, col, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}
const trie = x => Array.isArray(x) ? x.map(trie) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, trie(x[k])])) : x;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'numlettre-'));

// la liste fermée : Regigigas « 84 » → « 84a » ; un produit sans numeroFiche ; un déjà fait ; un conflit ; un sans ligne ; deux lignes ; une mauvaise forme
const PRODUITS = [
    { idProduct: 321170, carte: 'Regigigas', numero: '84a' },
    { idProduct: 448188, carte: 'Pokégear 3.0', numero: '182a' },
    { idProduct: 100003, carte: 'Déjà', numero: '10b' },
    { idProduct: 100004, carte: 'Conflit', numero: '84a' },
    { idProduct: 100005, carte: 'SansLigne', numero: '5a' },
    { idProduct: 100006, carte: 'DeuxLignes', numero: '6a' },
    { idProduct: 100007, carte: 'MauvaiseForme', numero: '182' },
    { idProduct: 100008, carte: 'Zeros', numero: '7a' }
];
function monde() {
    const B = fausseBase();
    const L = (idProduct, extra = {}) => { const l = { _id: `${idProduct}|c`, idProduct, carteId: idProduct, slugSet: 'Set-A', idExpansion: 1, ...extra }; B.col('cartes_produits').set(l._id, l); return l; };
    L(321170, { numeroFiche: '84' });
    L(448188, { slugSet: 'Unbroken-Bonds' });                       // champ ABSENT
    L(100003, { numeroFiche: '10b', numeroFicheAvant: '10' });
    L(100004, { numeroFiche: '85' });
    L(100006); B.col('cartes_produits').set('autre', { _id: 'autre', idProduct: 100006, carteId: 2, slugSet: 'Set-A', numeroFiche: null });
    L(100007);
    L(100008, { numeroFiche: '007' });
    return B;
}
const lire = async (db, produits = PRODUITS) => P.lireLignes(db, produits);

(async () => {
    await essayer('plan', async () => {
        const B = monde();
        const p = N.planifier(PRODUITS, await lire(B.db));
        verifier('plan : à poser 3 (Regigigas, Pokégear, zéros), déjà 1, refus 4', [p.pose.map(x => x.idProduct), p.deja.map(x => x.idProduct), p.refus.length], [[321170, 448188, 100008], [100003], 4]);
        verifier('« 84 » → « 84a » : avant « 84 » ; champ absent : avant null ; « 007 » → « 7a » accepté', p.pose.map(x => x.avant), ['84', null, '007']);
        const r = id => p.refus.find(x => x.idProduct === id)?.raison || '';
        verifier('refus nommés : conflit de chiffres, sans ligne, deux lignes, mauvaise forme', [/85/.test(r(100004)) && /chiffres/.test(r(100004)), /aucune ligne/.test(r(100005)), /2 lignes/.test(r(100006)), /forme/.test(r(100007))], [true, true, true, true]);
        verifier('la forme est écrite par ce qu\'elle autorise', ['84a', '5z', '84', 'a', '84A', '84ab', ' '].map(s => N.FORME.test(s)), [true, true, false, false, false, false, false]);
    });
    await essayer('ecriture', async () => {
        const B = monde(); const f = path.join(tmp(), 'avant.json');
        const avant = trie(JSON.parse(B.instantane()));
        const plan = N.planifier(PRODUITS, await lire(B.db));
        const sim = await P.appliquer(B.db, plan, { ecrire: false });
        verifier('à blanc : rien n\'écrit, 3 annoncées', [B.writes.length, sim.lignes], [0, 3]);
        let m1 = null; try { await P.appliquer(B.db, plan, { ecrire: true, attendu: 4, sauvegarde: f }); } catch (e) { m1 = e.message; }
        verifier('--attendu faux : refuse avant d\'écrire, pas de sauvegarde', [/4/.test(m1 || ''), B.writes.length, fs.existsSync(f)], [true, 0, false]);
        let m2 = null; try { await P.appliquer(B.db, plan, { ecrire: true, sauvegarde: f }); } catch (e) { m2 = e.message; }
        let m3 = null; try { await P.appliquer(B.db, plan, { ecrire: true, attendu: 3 }); } catch (e) { m3 = e.message; }
        verifier('sans --attendu / sans sauvegarde : refuse', [/attendu/.test(m2 || ''), /sauvegarde/.test(m3 || ''), B.writes.length], [true, true, 0]);
        // relecture du 27/10 : une sauvegarde EXISTANTE n'est jamais écrasée (une reprise mi-lot perdrait les valeurs d'avant des lignes déjà posées)
        const fx = path.join(tmp(), 'existe.json'); fs.writeFileSync(fx, '{"lignes":["ancienne"]}');
        let m6 = null; try { await P.appliquer(B.db, plan, { ecrire: true, attendu: 3, sauvegarde: fx }); } catch (e) { m6 = e.message; }
        verifier('sauvegarde déjà présente : refuse, rien écrit, fichier intact', [/existe/.test(m6 || ''), B.writes.length, fs.readFileSync(fx, 'utf8')], [true, 0, '{"lignes":["ancienne"]}']);
        const r = await P.appliquer(B.db, plan, { ecrire: true, attendu: 3, sauvegarde: f });
        verifier('écriture : 3 lignes, relu 3 posées', [r.lignes, r.relu], [3, { poses: 3 }]);
        const l = id => B.col('cartes_produits').get(`${id}|c`);
        verifier('champs posés (avant « 84 » / null conservés) et preuve', [l(321170).numeroFiche, l(321170).numeroFicheAvant, l(448188).numeroFiche, l(448188).numeroFicheAvant, 'numeroFicheAvant' in l(448188), /feu vert nommé/.test(l(321170).numeroFichePreuve)], ['84a', '84', '182a', null, true, true]);
        verifier('filtre conditionnel {_id, idProduct, numeroFiche: avant}, une écriture par ligne, seule cartes_produits', [B.writes.every(w => w.n === 'cartes_produits' && 'numeroFiche' in w.f && w.f.idProduct && w.f._id), B.writes.length], [true, 3]);
        verifier('refusées et déjà faites intactes', [l(100004).numeroFiche, l(100003).numeroFicheAvant], ['85', '10']);
        const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
        verifier('sauvegarde : 3 lignes avec valeur d\'avant (null compris)', sauve.lignes.map(x => x.avant), ['84', null, '007']);
        const nw = B.writes.length;
        const plan2 = N.planifier(PRODUITS, await lire(B.db));
        verifier('idempotence : rejoué, plus rien à poser (4 déjà)', [plan2.pose.length, plan2.deja.length, B.writes.length - nw], [0, 4, 0]);
        let m4 = null; try { await P.restaurer(B.db, f, { ecrire: true, attendu: 2 }); } catch (e) { m4 = e.message; }
        verifier('restauration : --attendu faux refuse', [/2/.test(m4 || ''), B.writes.length - nw], [true, 0]);
        const rr = await P.restaurer(B.db, f, { ecrire: true, attendu: 3 });
        verifier('restauration : 3 lignes, relu', [rr.lignes, rr.relu], [3, { restaurees: 3 }]);
        const apres = trie(JSON.parse(B.instantane()));
        // le champ numeroFiche absent à l'origine revient à null (équivalent pour Mongo) : on l'accepte, on compare le reste
        const norm = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'numeroFiche' && v === null ? undefined : v)));
        verifier('restauration : le monde est celui d\'avant (numeroFiche null ≡ absent)', JSON.stringify(norm(apres)) === JSON.stringify(norm(avant)), true);
        let m5 = null; try { await P.restaurer(B.db, f, { ecrire: true, attendu: 3 }); } catch (e) { m5 = e.message; }
        verifier('restauration rejouée : refuse', /déjà restaurée|introuvable/.test(m5 || ''), true);
    });
    await essayer('gardes', async () => {
        const B = monde(); const f = path.join(tmp(), 'g.json');
        const plan = N.planifier(PRODUITS, await lire(B.db));
        B.col('cartes_produits').get('321170|c').numeroFiche = '99';   // reposé entre le plan et l'écriture
        let m = null; try { await P.appliquer(B.db, plan, { ecrire: true, attendu: 3, sauvegarde: f }); } catch (e) { m = e.message; }
        verifier('valeur changée entre plan et écriture : l\'update conditionnel ne la touche pas, le lot s\'arrête', [/introuvable|inchangée|changé/.test(m || ''), B.col('cartes_produits').get('321170|c').numeroFiche], [true, '99']);
        const B2 = monde(); const f2 = path.join(tmp(), 'h.json');
        const plan2 = N.planifier(PRODUITS, await lire(B2.db));
        await P.appliquer(B2.db, plan2, { ecrire: true, attendu: 3, sauvegarde: f2 });
        B2.col('cartes_produits').get('321170|c').numeroFiche = '84z';
        let m6 = null; try { await P.restaurer(B2.db, f2, { ecrire: true, attendu: 3 }); } catch (e) { m6 = e.message; }
        verifier('--restaurer n\'écrase pas une valeur reposée depuis', [/introuvable|déjà restaurée/.test(m6 || ''), B2.col('cartes_produits').get('321170|c').numeroFiche], [true, '84z']);
    });
    await essayer('relu', async () => {
        const B = monde(); const f = path.join(tmp(), 'u.json');
        const vraie = B.db.collection;
        const db = { collection: n => { const c = vraie(n); return { ...c, updateOne: async (...a) => { await c.updateOne(a[0], { $set: {} }); return { matchedCount: 1, modifiedCount: 1 }; } }; } };
        const plan = N.planifier(PRODUITS, await lire(db));
        const r = await P.appliquer(db, plan, { ecrire: true, attendu: 3, sauvegarde: f });
        verifier('le compte réel est RELU : 3 lignes sans rien reçu sont vues', r.relu, { poses: 0 });
    });
    await essayer('executeur', async () => {
        const B = monde(); const sortie = []; const f = path.join(tmp(), 'e.json');
        const base = { cartesDb: B.db, produits: PRODUITS, log: s => sortie.push(s) };
        const r = await P.executer({ ...base });
        const txt = sortie.join('\n');
        verifier('essai à blanc : dénominateur 8, plan 3/1/4, garde simulée, sets touchés, rien d\'écrit', [B.writes.length, /liste : 8 produit/.test(txt), /3 à écrire/.test(txt), /GARDE DE LOT \(simulée\)/.test(txt), /Unbroken-Bonds/.test(txt), /essai à blanc/.test(txt)], [0, true, true, true, true, true]);
        verifier('exécuteur : le plan', [r.plan.pose.length, r.plan.deja.length, r.plan.refus.length], [3, 1, 4]);
        // sous-ensemble : Regigigas seul
        const sortie2 = []; const f2 = path.join(tmp(), 'e2.json');
        await P.executer({ ...base, log: s => sortie2.push(s), produitsFiltre: [321170], ecrire: true, attendu: 1, sauvegarde: f2 });
        verifier('--produits=321170 : une seule ligne écrite, « 84 » → « 84a »', [B.writes.length, B.col('cartes_produits').get('321170|c').numeroFiche, B.col('cartes_produits').get('448188|c').numeroFiche], [1, '84a', undefined]);
        let msg = null; try { await P.executer({ ...base, produitsFiltre: [999], attendu: 0 }); } catch (e) { msg = e.message; }
        verifier('un idProduct hors de la liste fermée : arrêt', /hors de la liste/.test(msg || ''), true);
        let msg2 = null; try { await P.executer({ ...base, ecrire: true, attendu: 5, sauvegarde: path.join(tmp(), 'x.json') }); } catch (e) { msg2 = e.message; }
        verifier('--attendu ≠ plan (filtré) : arrêt', /5/.test(msg2 || ''), true);
        let msg3 = null; try { await P.executer({ ...base, ecrire: true, attendu: 2, sauvegarde: path.join(tmp(), 'y.json'), garde: () => { throw new Error('hors lot'); } }); } catch (e) { msg3 = e.message; }
        verifier('la garde de lot est appelée avant toute écriture', /hors lot/.test(msg3 || ''), true);
    });
    await essayer('script', () => {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'poser-numero-fiche-lettre.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '', MONGODB_CARTES_LECTURE_URI: '' } });
        verifier('argument inconnu → 2 avant toute connexion', [lancer('--bidon').status, lancer('--ecrire=1').status], [2, 2]);
        verifier('--ecrire sans --attendu → 2 ; sans --sauvegarde → 2', [lancer('--ecrire').status, lancer('--ecrire', '--attendu=3').status], [2, 2]);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });
