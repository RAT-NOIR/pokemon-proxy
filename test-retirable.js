// node test-retirable.js — RETIRABLE : `retirable: true` sur les visuels Bulbapedia SERVIS et les visuels TPC Asie zh-hant (collecte-cartes/retirable.js + poser-retirable.js).
// Une base EN MÉMOIRE, aucune requête, rien sur R2, jamais la production. La règle du site (visuel admis pour la région) est IMPORTÉE, jamais recopiée.
// Ce que le banc garde :
//   · seuls les visuels Bulbapedia SERVIS (entrée cartes.images admise par la règle du site) et les tpc-asie zh-hant sont marqués ; tout le reste reste intact, champ par champ ;
//   · les documents `images` correspondants (même cleR2, même source) sont marqués, pas les autres ;
//   · idempotence ; simulation (à blanc) sans écriture ; --attendu qui refuse AVANT d'écrire ; --ecrire sans --attendu refuse ; aucun autre champ ne bouge.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const R = require(path.join(DIR, 'collecte-cartes', 'retirable.js'));
const X = require(path.join(DIR, 'exporter-donnees-logos-site.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.message).split('\n')[0]}`); } };
const refuse = async (nom, f, motif) => {
    try { await f(); ko++; console.log(`❌ ${nom}\n   aurait dû refuser`); } catch (e) {
        if (motif.test(e.message)) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   mauvais motif : ${e.message.split('\n')[0]}`); }
    }
};

// ── une base en mémoire (les seules formes de requête de l'outil) ──────────────────────────────────────────────────────────────────────────────────
function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) ? x.flatMap(e => e?.[p]) : x?.[p], o);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        const x = lire(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if ('$in' in v) return (Array.isArray(x) ? x : [x]).some(y => v.$in.includes(y));
            if ('$exists' in v) return (x !== undefined) === v.$exists;
            return false;
        }
        return Array.isArray(x) ? x.includes(v) : x === v;
    });
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const writes = [];
    const collection = n => ({
        find(f) { const r = { toArray: async () => structuredClone(tous(n, f)), project() { return r; } }; return r; },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne(f, u, o = {}) {
            const d = tous(n, f)[0]; if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d);
            for (const [k, v] of Object.entries(u.$set || {})) {
                const m = /^([^.]+)\.\$\[(\w+)\]\.(.+)$/.exec(k);
                if (m) {
                    const cibles = (d[m[1]] || []).filter(e => e && (o.arrayFilters || []).some(fl => Object.entries(fl).every(([kk, vv]) => { const x = e[kk.slice(m[2].length + 1)]; return vv && typeof vv === 'object' && '$exists' in vv ? (x !== undefined) === vv.$exists : x === vv; })));
                    for (const e of cibles) e[m[3]] = structuredClone(v);
                } else d[k] = structuredClone(v);
            }
            for (const k of Object.keys(u)) if (k !== '$set') throw new Error(`opérateur interdit à cet outil : ${k}`);
            writes.push({ n, f, u, o });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit à cet outil'); },
        async insertOne() { throw new Error('insertOne : interdit à cet outil'); },
        async deleteOne() { throw new Error('deleteOne : interdit à cet outil'); },
        async deleteMany() { throw new Error('deleteMany : interdit à cet outil'); },
        async replaceOne() { throw new Error('replaceOne : interdit à cet outil'); }
    });
    return { db: { collection }, col, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}

// ── le monde : un set international (en), un set japonais (ja), un set taïwanais (zh-hant) ───────────────────────────────────────────────────────
function monde() {
    const b = fausseBase();
    const set = (id, tirage) => b.col('sets').set(id, { _id: id, tirage });
    set('Set-Intl', 'intl'); set('Set-Jp', 'jp'); set('Set-Tw', 'zh-hant');
    const carte = (id, images) => b.col('cartes').set(id, { _id: id, nomEn: `C${id}`, images });
    const img = (cleR2, set, source, langue, extra = {}) => ({ set, source, cleR2, numero: '1', langue, w: 700, ...extra });
    // Bulbapedia servi, intl, en                      → MARQUÉ
    carte(1, [img('bulbapedia/a.png', 'Set-Intl', 'bulbapedia', 'en')]);
    // Bulbapedia servi + une entrée tcgdex autre      → seule l'entrée bulbapedia est marquée
    carte(2, [img('bulbapedia/b.png', 'Set-Intl', 'bulbapedia', 'en'), img('tcgdex/b.png', 'Set-Intl', 'tcgdex', 'en')]);
    // Bulbapedia ja sous un set intl : la règle du site le REFUSE (non servi) → NON marqué
    carte(3, [img('bulbapedia/c.png', 'Set-Intl', 'bulbapedia', 'ja')]);
    // Bulbapedia sous un set inconnu                  → NON marqué (tirage inconnu : on ne devine pas)
    carte(4, [img('bulbapedia/d.png', 'Set-Fantome', 'bulbapedia', 'en')]);
    // Bulbapedia servi dans un set jp (ja)            → MARQUÉ
    carte(5, [img('bulbapedia/e.png', 'Set-Jp', 'bulbapedia', 'ja')]);
    // tpc-asie zh-hant                                → MARQUÉ ; tpc-asie id/th → NON ; pikaqian zh-hant → NON
    carte(6, [img('tpc/f.png', 'Set-Tw', 'tpc-asie', 'zh-hant'), img('tpc/g.png', 'Set-Tw', 'tpc-asie', 'th'), img('pikaqian/h.png', 'Set-Tw', 'pikaqian', 'zh-hant')]);
    // déjà marqué (bulbapedia servi)                  → compté « déjà », pas réécrit
    carte(7, [img('bulbapedia/i.png', 'Set-Intl', 'bulbapedia', 'en', { retirable: true })]);
    // une autre carte sans rien
    carte(8, [img('artofpkm/j.png', 'Set-Jp', 'artofpkm', 'ja')]);
    const doc = (cleR2, source, langue, extra = {}) => b.col('images').set(cleR2, { _id: cleR2, cleR2, source, langue, etat: 'ok', w: 700, ...extra });
    doc('bulbapedia/a.png', 'bulbapedia', 'en'); doc('bulbapedia/b.png', 'bulbapedia', 'en'); doc('tcgdex/b.png', 'tcgdex', 'en');
    doc('bulbapedia/c.png', 'bulbapedia', 'ja'); doc('bulbapedia/d.png', 'bulbapedia', 'en'); doc('bulbapedia/e.png', 'bulbapedia', 'ja');
    doc('bulbapedia/z.png', 'bulbapedia', 'en');               // document Bulbapedia NON servi (aucune entrée cartes.images) → NON marqué
    doc('tpc/f.png', 'tpc-asie', 'zh-hant'); doc('tpc/g.png', 'tpc-asie', 'th'); doc('tpc/k.png', 'tpc-asie', 'zh-hant'); // k : tpc zh-hant sans entrée → marqué quand même (toutes)
    doc('pikaqian/h.png', 'pikaqian', 'zh-hant'); doc('bulbapedia/i.png', 'bulbapedia', 'en', { retirable: true });
    return b;
}

(async () => {
    const regle = await X.regleDuSite('C:/Users/Yung/Desktop/pokemon-proxy');
    const admis = regle.visuelAdmisPourLaRegion;
    const entrees = b => [...b.col('cartes').values()].flatMap(c => (c.images || []).filter(e => e.retirable === true).map(e => `${c._id}|${e.cleR2}`)).sort();
    const documents = b => [...b.col('images').values()].filter(d => d.retirable === true).map(d => d.cleR2).sort();

    await essayer('1. le plan ne prend que les servis Bulbapedia et les tpc-asie zh-hant', async () => {
        const b = monde(); const avant = b.instantane();
        const p = await R.construirePlan({ cartesDb: b.db, admis });
        verifier('1a. entrées à marquer', p.entrees.map(e => `${e.carteId}|${e.cleR2}`).sort(), ['1|bulbapedia/a.png', '2|bulbapedia/b.png', '5|bulbapedia/e.png', '6|tpc/f.png']);
        verifier('1b. documents à marquer', p.documents.map(d => d._id).sort(), ['bulbapedia/a.png', 'bulbapedia/b.png', 'bulbapedia/e.png', 'tpc/f.png', 'tpc/k.png']);
        verifier('1c. comptes par source', p.comptes, { cohorte: 5, entrees: { bulbapedia: 3, 'tpc-asie': 1, dejaBulbapedia: 1 }, documents: { bulbapedia: 3, 'tpc-asie': 2, dejaBulbapedia: 1 }, bulbapediaRefuseeParLaRegle: 1, bulbapediaSetInconnu: 1, autreValeur: 0 });
        verifier('1d. la construction du plan n\'écrit rien', b.instantane(), avant);
        verifier('1e. aucune écriture émise', b.writes.length, 0);
    });

    await essayer('2. à blanc (défaut) : rien n\'est écrit, les comptes sont rendus', async () => {
        const b = monde(); const avant = b.instantane();
        const p = await R.construirePlan({ cartesDb: b.db, admis });
        const r = await R.appliquer(b.db, p);
        verifier('2a. base inchangée', b.instantane(), avant);
        verifier('2b. comptes de la simulation', { e: r.entrees, d: r.documents, f: r.dejaFait }, { e: 4, d: 5, f: false });
    });

    await essayer('3. --ecrire pose retirable: true sur les seuls visés, et rien d\'autre', async () => {
        const b = monde();
        const avantCartes = structuredClone([...b.col('cartes').values()]), avantDocs = structuredClone([...b.col('images').values()]);
        const p = await R.construirePlan({ cartesDb: b.db, admis });
        await R.appliquer(b.db, p, { ecrire: true, attendu: 5 });
        verifier('3a. entrées marquées', entrees(b), ['1|bulbapedia/a.png', '2|bulbapedia/b.png', '5|bulbapedia/e.png', '6|tpc/f.png', '7|bulbapedia/i.png']);
        verifier('3b. documents marqués', documents(b), ['bulbapedia/a.png', 'bulbapedia/b.png', 'bulbapedia/e.png', 'bulbapedia/i.png', 'tpc/f.png', 'tpc/k.png']);
        // tout le reste est intact : on retire retirable de la base finale et on retrouve exactement l'état d'avant
        const nettoyer = l => l.map(d => { const c = structuredClone(d); delete c.retirable; for (const e of c.images || []) delete e.retirable; return c; });
        const apresCartes = [...b.col('cartes').values()], apresDocs = [...b.col('images').values()];
        verifier('3c. aucun autre champ ne bouge (cartes)', nettoyer(apresCartes), nettoyer(avantCartes));
        verifier('3d. aucun autre champ ne bouge (images)', nettoyer(apresDocs), nettoyer(avantDocs));
        verifier('3e. la valeur posée est le booléen true', [...apresCartes.flatMap(c => c.images), ...apresDocs].filter(x => 'retirable' in x).every(x => x.retirable === true), true);
        verifier('3f. une seule écriture par carte et par document marqué (4 + 5, la déjà-marquée exclue)', b.writes.length, 9);
    });

    await essayer('4. idempotent : rejoué, il ne réécrit rien', async () => {
        const b = monde();
        await R.appliquer(b.db, await R.construirePlan({ cartesDb: b.db, admis }), { ecrire: true, attendu: 5 });
        const apres1 = b.instantane(), n1 = b.writes.length;
        const p2 = await R.construirePlan({ cartesDb: b.db, admis });
        const r2 = await R.appliquer(b.db, p2, { ecrire: true, attendu: 5 });
        verifier('4a. base identique', b.instantane(), apres1);
        verifier('4b. aucune écriture au second passage', b.writes.length, n1);
        verifier('4c. dejaFait', r2.dejaFait, true);
        verifier('4d. la cohorte reste de 5 (le dénominateur ne rétrécit pas)', p2.comptes.cohorte, 5);
    });

    await essayer('5. un champ retirable DÉJÀ présent à false n\'est pas écrasé', async () => {
        const b = monde();
        b.col('cartes').get(1).images[0].retirable = false;
        const p = await R.construirePlan({ cartesDb: b.db, admis });
        await R.appliquer(b.db, p, { ecrire: true, attendu: 5 });
        verifier('5a. l\'entrée à false reste à false (additif : seulement là où le champ est absent)', b.col('cartes').get(1).images[0].retirable, false);
    });

    await refuse('6. --ecrire sans --attendu : refus avant toute écriture', async () => {
        const b = monde();
        try { await R.appliquer(b.db, await R.construirePlan({ cartesDb: b.db, admis }), { ecrire: true }); } finally { verifier('6a. rien écrit', b.writes.length, 0); }
    }, /--attendu/);

    await refuse('7. --attendu différent du compte : refus avant toute écriture', async () => {
        const b = monde();
        try { await R.appliquer(b.db, await R.construirePlan({ cartesDb: b.db, admis }), { ecrire: true, attendu: 6 }); } finally { verifier('7a. rien écrit', b.writes.length, 0); }
    }, /attendu=6.*5/);

    await essayer('8. le MUTANT : sans la règle du site, la Bulbapedia ja sous un set intl serait marquée (le banc doit le voir)', async () => {
        const b = monde();
        const p = await R.construirePlan({ cartesDb: b.db, admis: () => true });
        verifier('8a. avec une admission trop large la cohorte change (le banc 1c échouerait)', p.comptes.cohorte !== 5, true);
    });

    await essayer('9. la base de production est refusée : un objet sans collection() ne passe pas', async () => {
        let leve = false;
        try { await R.construirePlan({ cartesDb: null, admis }); } catch { leve = true; }
        verifier('9a. refus', leve, true);
    });

    await essayer('10. la garde de lot (garde-lot.js) ne voit aucune baisse : un ajout de champ ne fait bouger aucun compteur', async () => {
        const G = require(path.join(DIR, 'collecte-cartes', 'garde-lot.js'));
        const b = monde();
        const avant = G.compterEtat({ cartes: [...b.col('cartes').values()], sets: [...b.col('sets').values()] });
        await R.appliquer(b.db, await R.construirePlan({ cartesDb: b.db, admis }), { ecrire: true, attendu: 5 });
        const apres = G.compterEtat({ cartes: [...b.col('cartes').values()], sets: [...b.col('sets').values()] });
        const cmp = G.comparer(avant, apres, {});
        verifier('10a. 0 baisse non annoncée', cmp.nonAutorisees.length, 0);
        verifier('10b. aucune baisse du tout, aucune hausse', [cmp.baisses.length, Object.keys(cmp.hausses).length], [0, 0]);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
