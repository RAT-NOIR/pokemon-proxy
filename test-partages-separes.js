// node test-partages-separes.js — PARTAGES-SEPARES : retirer produitsPartages des paires Staff/Jumbo séparées par la variante (collecte-cartes/partages-separes.js + retirer-partages-separes.js).
// Base EN MÉMOIRE, aucune requête, jamais une vraie base ni un dossier du testeur (les sauvegardes vont dans un dossier temporaire).
// Ce que le banc garde : seules les paires séparées par la variante (staff|jumbo + normale, mêmes lignes de la même carte) sont des cibles ; les Prize Packs et les paires non séparables ne bougent JAMAIS ;
// le geste est un $unset de produitsPartages SEUL ; l'avant est sauvegardé AVANT la première écriture et --restaurer le remet exactement ; --attendu refuse avant d'écrire ; idempotent.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const path = require('path');
const fs = require('fs');
const os = require('os');
const DIR = process.env.TOOL_DIR || __dirname;
const S = require(path.join(DIR, 'collecte-cartes', 'partages-separes.js'));
const G = require(path.join(DIR, 'collecte-cartes', 'garde-lot.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`); } };

function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) ? x.flatMap(e => e?.[p]) : x?.[p], o);
    const egal = (x, v) => JSON.stringify(x) === JSON.stringify(v);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        const x = lire(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if ('$in' in v) return (Array.isArray(x) ? x : [x]).some(y => v.$in.includes(y));
            if ('$exists' in v) return (x !== undefined) === v.$exists;
            return false;
        }
        if (Array.isArray(v)) return egal(x, v);
        return Array.isArray(x) ? x.includes(v) : x === v;
    });
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const filtreOk = (e, nomVar, fl) => Object.entries(fl).every(([k, v]) => {
        const champ = k.slice(nomVar.length + 1), x = e[champ];
        if (v && typeof v === 'object' && !Array.isArray(v) && '$exists' in v) return (x !== undefined) === v.$exists;
        return egal(x, v);
    });
    const elements = (d, chemin, filtres, nomVar) => (d[chemin] || []).filter(e => e && (filtres || []).some(fl => filtreOk(e, nomVar, fl)));
    function appliquer(d, u, o) {
        const cibles = new Map();
        for (const k of [...Object.keys(u.$set || {}), ...Object.keys(u.$unset || {})]) { const m = /^([^.]+)\.\$\[(\w+)\]\./.exec(k); if (m && !cibles.has(`${m[1]}.${m[2]}`)) cibles.set(`${m[1]}.${m[2]}`, elements(d, m[1], o.arrayFilters, m[2])); }
        for (const [mode, champs] of [['$set', u.$set || {}], ['$unset', u.$unset || {}]]) {
            for (const [k, v] of Object.entries(champs)) {
                const m = /^([^.]+)\.\$\[(\w+)\]\.(.+)$/.exec(k);
                if (m) { for (const e of cibles.get(`${m[1]}.${m[2]}`)) { if (mode === '$set') e[m[3]] = structuredClone(v); else delete e[m[3]]; } }
                else if (mode === '$set') d[k] = structuredClone(v); else delete d[k];
            }
        }
    }
    const writes = [];
    const collection = n => ({
        find(f) { const r = { toArray: async () => structuredClone(tous(n, f)), project() { return r; } }; return r; },
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        async updateOne(f, u, o = {}) {
            const d = tous(n, f)[0]; if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d); appliquer(d, u, o);
            writes.push({ n, f, u, o });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit'); }, async insertOne() { throw new Error('insertOne : interdit'); },
        async deleteOne() { throw new Error('deleteOne : interdit'); }, async deleteMany() { throw new Error('deleteMany : interdit'); }, async replaceOne() { throw new Error('replaceOne : interdit'); }
    });
    return { db: { collection }, col, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}

const SV = 'SV-Black-Star-Promos', SWSH = 'SWSH-Black-Star-Promos';
// { c: carteId, set, n, ids: [V1, V2], tn: libellé, sep: séparée par la variante ? }
const PAIRES = [
    { c: 1001, set: SV, n: '004', ids: [11, 12], tn: 'Staff', cle: 'tcgdex/SV/004-1001.webp' },
    { c: 1002, set: SWSH, n: 'SWSH111', ids: [21, 22], tn: 'Staff', cle: 'tcgdex/SWSH/111-1002.webp' },
    { c: 1003, set: SWSH, n: 'SWSH195', ids: [31, 32], tn: 'Jumbo', cle: 'tcgdex/SWSH/195-1003.webp' },
    { c: 1004, set: SV, n: '018', ids: [41, 42], tn: 'Jumbo', cle: 'tcgdex/SV/018-1004.webp' }
];
function monde() {
    const B = fausseBase();
    const set = (n, d) => B.col(n).set(d._id, d);
    const ajoute = (p, { sep = true, sansDoc = false, variantes = null, docDiff = false } = {}) => {
        const type = p.tn === 'Jumbo' ? 'jumbo' : 'staff';
        const v = variantes || (sep ? ['normale', type] : [undefined, undefined]);
        p.ids.forEach((id, i) => set('cartes_produits', { _id: `${p.c}|${id}|${p.set}`, carteId: p.c, idProduct: id, slugSet: p.set, numeroFiche: p.n, ...(v[i] ? { variante: v[i], variantePreuve: 'x' } : {}) }));
        // un produit d'un AUTRE set, servi par la même carte, que la paire ne cite pas (le cas signalé par l'API)
        set('cartes_produits', { _id: `${p.c}|${p.ids[0] + 1000}|Thai`, carteId: p.c, idProduct: p.ids[0] + 1000, slugSet: 'Thai-Promos', numeroFiche: p.n });
        set('cartes', { _id: p.c, nomEn: `Carte ${p.c}`, sets: [p.set], images: [
            { set: p.set, source: 'tcgdex', cleR2: p.cle, numero: p.n, w: 600, h: 825, produitsPartages: p.ids, partageeTamponNonSepare: sep ? false : true, tamponNonRepresente: p.tn },
            { set: p.set, source: 'bulbapedia', cleR2: `bulbapedia/autre-${p.c}.webp`, numero: '777', w: 600, h: 825 }] });
        if (!sansDoc) set('images', { _id: p.cle.replace(/\.webp$/, ''), source: 'tcgdex', set: p.set, carteId: p.c, numero: p.n, cleR2: p.cle, etat: 'ok', produitsPartages: docDiff ? [1, 2] : p.ids, partageeTamponNonSepare: sep ? false : true, tamponNonRepresente: p.tn });
    };
    for (const p of PAIRES) ajoute(p);
    // non séparable (une des 3) : marque gardée
    ajoute({ c: 1005, set: SV, n: '045', ids: [51, 52], tn: 'Staff', cle: 'tcgdex/SV/045-1005.webp' }, { sep: false });
    set('cartes', { _id: 2001, nomEn: 'Pack', sets: ['PP'], images: [{ set: 'PP', source: 'pokumon', cleR2: 'pokumon/pp.webp', numero: '1', partageeHoloNonHolo: true, produitsPartages: [9, 10] }] });
    set('images', { _id: 'pokumon/pp', source: 'pokumon', set: 'PP', carteId: 2001, cleR2: 'pokumon/pp.webp', partageeHoloNonHolo: true, produitsPartages: [9, 10] });
    return { B, ajoute, set };
}
const entreeDe = (B, c, cle) => B.col('cartes').get(c).images.find(e => e.cleR2 === cle);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psep-'));

(async () => {
    await essayer('plan', async () => {
        const { B } = monde();
        const p = await S.construirePlan({ cartesDb: B.db });
        verifier('plan : 4 cibles (2 Staff, 2 Jumbo) ; la paire non séparable est laissée avec sa raison', [p.cibles.map(t => t.carteId).sort(), p.laissees.map(l => [l.carteId, l.motif])], [[1001, 1002, 1003, 1004], [[1005, 'paire-non-separable']]]);
        verifier('plan : par type, et le Prize Pack est compté à part (jamais cible, jamais laissé)', [p.comptes.parType, p.comptes.holoIgnorees], [{ staff: 2, jumbo: 2 }, 1]);
        verifier('plan : le document de chaque cible est trouvé', p.cibles.map(t => t.idDoc).sort(), ['tcgdex/SV/004-1001', 'tcgdex/SV/018-1004', 'tcgdex/SWSH/111-1002', 'tcgdex/SWSH/195-1003']);
        verifier('plan : n\'écrit rien', B.writes.length, 0);
    });
    // chaque condition manquée = entrée laissée avec son motif
    const refus = [
        ['une ligne sans variante', c => c.B.col('cartes_produits').get('1001|11|' + SV) && delete c.B.col('cartes_produits').get('1001|11|' + SV).variante, 'variante-absente-ou-mixte'],
        ['les deux produits portent « staff » (pas de normale)', c => { c.B.col('cartes_produits').get('1001|11|' + SV).variante = 'staff'; }, 'variantes-inattendues'],
        ['un Staff sur une paire marquée Jumbo', c => { c.B.col('cartes_produits').get('1003|32|' + SWSH).variante = 'staff'; }, 'variantes-inattendues'],
        ['aucune ligne du produit pour CETTE carte', c => c.B.col('cartes_produits').delete('1002|22|' + SWSH), 'ligne-absente'],
        ['une ligne d\'une AUTRE carte ne prouve rien', c => { const l = c.B.col('cartes_produits').get('1002|22|' + SWSH); l.carteId = 9999; }, 'ligne-absente'],
        ['libellé hors Staff/Jumbo', c => { entreeDe(c.B, 1001, 'tcgdex/SV/004-1001.webp').tamponNonRepresente = 'Prerelease'; }, 'tampon-hors-staff-jumbo'],
        ['trois produits dans la liste', c => { entreeDe(c.B, 1001, 'tcgdex/SV/004-1001.webp').produitsPartages = [11, 12, 13]; }, 'produitsPartages-pas-deux'],
        ['document absent', c => c.B.col('images').delete('tcgdex/SV/004-1001'), 'document-absent'],
        ['document aux produits différents', c => { c.B.col('images').get('tcgdex/SV/004-1001').produitsPartages = [1, 2]; }, 'document-different'],
        ['document encore marqué non séparable', c => { c.B.col('images').get('tcgdex/SV/004-1001').partageeTamponNonSepare = true; }, 'document-different'],
        ['document au libellé différent', c => { c.B.col('images').get('tcgdex/SV/004-1001').tamponNonRepresente = 'Jumbo'; }, 'document-different'],
        ['deux documents pour la même entrée', c => c.B.col('images').set('doublon', { _id: 'doublon', set: SV, carteId: 1001, cleR2: 'tcgdex/SV/004-1001.webp', produitsPartages: [11, 12], partageeTamponNonSepare: false, tamponNonRepresente: 'Staff' }), 'document-ambigu'],
        ['marquage ni vrai ni faux', c => { delete entreeDe(c.B, 1001, 'tcgdex/SV/004-1001.webp').partageeTamponNonSepare; }, 'pas-une-paire-tampon']
    ];
    for (const [nom, f, motif] of refus) await essayer(nom, async () => {
        const m = monde(); f(m);
        const p = await S.construirePlan({ cartesDb: m.B.db });
        const l = p.laissees.find(x => x.carteId === (nom.includes('Staff sur une paire marquée Jumbo') ? 1003 : nom.includes('1002') || nom.includes('AUTRE carte') || nom.includes('CETTE carte') ? 1002 : 1001));
        verifier(`laissée : ${nom} → ${motif}`, [l?.motif, p.cibles.some(t => t.carteId === l?.carteId)], [motif, false]);
    });

    await essayer('ecriture', async () => {
        const { B } = monde(); const dir = tmp(); const f = path.join(dir, 'avant.json');
        const avant = JSON.parse(B.instantane());
        const p = await S.construirePlan({ cartesDb: B.db });
        const sim = await S.appliquer(B.db, p, { ecrire: false });
        verifier('à blanc : rien n\'est écrit, 4 entrées + 4 documents annoncés', [B.writes.length, sim.entrees, sim.documents], [0, 4, 4]);
        const r = await S.appliquer(B.db, p, { ecrire: true, attendu: 4, sauvegarde: f });
        verifier('écriture : 4 entrées, 4 documents, relu 0/0', [r.entrees, r.documents, r.relu], [4, 4, { entrees: 0, documents: 0 }]);
        for (const t of p.cibles) {
            const e = entreeDe(B, t.carteId, t.cleR2), d = B.col('images').get(t.idDoc);
            verifier(`écriture : ${t.carteId} produitsPartages retiré, partageeTamponNonSepare false et tamponNonRepresente gardés (entrée et document)`, [e.produitsPartages, e.partageeTamponNonSepare, e.tamponNonRepresente, d.produitsPartages, d.partageeTamponNonSepare, d.tamponNonRepresente], [undefined, false, t.tamponNonRepresente, undefined, false, t.tamponNonRepresente]);
        }
        verifier('écriture : la paire non séparable (1005) garde sa marque', [entreeDe(B, 1005, 'tcgdex/SV/045-1005.webp').produitsPartages, B.col('images').get('tcgdex/SV/045-1005').produitsPartages], [[51, 52], [51, 52]]);
        verifier('écriture : le Prize Pack garde sa marque (entrée et document)', [B.col('cartes').get(2001).images[0].produitsPartages, B.col('images').get('pokumon/pp').produitsPartages], [[9, 10], [9, 10]]);
        verifier('écriture : seuls cartes et images sont écrits', [...new Set(B.writes.map(w => w.n))].sort(), ['cartes', 'images']);
        verifier('écriture : chaque update est un $unset de produitsPartages seul, avec une condition', B.writes.every(w => Object.keys(w.u).join() === '$unset' && Object.keys(w.u.$unset).length === 1 && /produitsPartages$/.test(Object.keys(w.u.$unset)[0]) && (w.n === 'cartes' ? w.o.arrayFilters[0]['e.produitsPartages'] !== undefined : w.f.produitsPartages !== undefined)), true);
        // aucun autre champ n'a bougé : on remet le champ retiré et on retrouve l'avant
        const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
        verifier('sauvegarde : écrite, 4 cibles avec carteId, cleR2, idDoc et les valeurs d\'avant', [sauve.cibles.length, sauve.cibles.every(c => c.carteId && c.cleR2 && c.idDoc && Array.isArray(c.produitsPartages))], [4, true]);
        // idempotence
        const nw = B.writes.length;
        const p2 = await S.construirePlan({ cartesDb: B.db });
        const r2 = await S.appliquer(B.db, p2, { ecrire: true, attendu: 0, sauvegarde: f });
        verifier('idempotence : un second passage ne voit plus rien et n\'écrit rien', [p2.cibles.length, B.writes.length - nw, r2.dejaFait], [0, 0, true]);
        // restauration
        const rr = await S.restaurer(B.db, f, { ecrire: true, attendu: 4 });
        verifier('restauration : 4 entrées, 4 documents, relu 4/4', [rr.entrees, rr.documents, rr.relu], [4, 4, { entrees: 4, documents: 4 }]);
        const trie = x => Array.isArray(x) ? x.map(trie) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, trie(x[k])])) : x;   // l'ordre des clés d'un document n'est pas une donnée
        verifier('restauration : le monde est EXACTEMENT celui d\'avant (mêmes champs, mêmes valeurs)', JSON.stringify(trie(JSON.parse(B.instantane()))) === JSON.stringify(trie(avant)), true);
        let msg = null; try { await S.restaurer(B.db, f, { ecrire: true, attendu: 4 }); } catch (e) { msg = String(e.message); }
        verifier('restauration : rejouée, elle refuse (déjà restauré) plutôt que d\'écraser', /déjà restaur/.test(msg || ''), true);
    });
    await essayer('restauration gardée', async () => {
        const { B } = monde(); const f = path.join(tmp(), 'r.json');
        const p = await S.construirePlan({ cartesDb: B.db });
        await S.appliquer(B.db, p, { ecrire: true, attendu: 4, sauvegarde: f });
        const s = B.instantane(); let m1 = null;
        try { await S.restaurer(B.db, f, { ecrire: true, attendu: 61 }); } catch (e) { m1 = String(e.message); }
        verifier('--restaurer --attendu=61 pour 4 entrées : refuse AVANT d\'écrire', [/61/.test(m1 || ''), B.instantane() === s], [true, true]);
        entreeDe(B, 1002, 'tcgdex/SWSH/111-1002.webp').produitsPartages = [7, 8];   // quelqu'un a reposé une autre valeur depuis
        let m2 = null; try { await S.restaurer(B.db, f, { ecrire: true, attendu: 4 }); } catch (e) { m2 = String(e.message); }
        verifier('--restaurer n\'écrase pas une valeur reposée entre-temps (condition d\'absence) : elle s\'arrête', [/introuvable ou déjà restaurée/.test(m2 || ''), entreeDe(B, 1002, 'tcgdex/SWSH/111-1002.webp').produitsPartages], [true, [7, 8]]);
    });
    await essayer('relu', async () => {
        const { B } = monde(); const f = path.join(tmp(), 'u.json');
        // un document dont l'update « réussit » sans rien changer : le relu doit le voir
        const vraie = B.db.collection;
        const db = { collection: n => { const c = vraie(n); return n === 'images' ? { ...c, updateOne: async (...a) => { await c.updateOne(...a.slice(0, 1), { $set: {} }, a[2]); return { matchedCount: 1, modifiedCount: 1 }; } } : c; } };
        const p = await S.construirePlan({ cartesDb: db });
        const r = await S.appliquer(db, p, { ecrire: true, attendu: 4, sauvegarde: f });
        verifier('le compte réel est RELU après l\'écriture : 4 documents qui portent encore le champ sont vus', r.relu, { entrees: 0, documents: 4 });
    });
    await essayer('attendu', async () => {
        const { B } = monde(); const s = B.instantane(); const f = path.join(tmp(), 'a.json');
        const p = await S.construirePlan({ cartesDb: B.db });
        let m1 = null; try { await S.appliquer(B.db, p, { ecrire: true, attendu: 61, sauvegarde: f }); } catch (e) { m1 = String(e.message); }
        verifier('--attendu=61 alors que 4 cibles : refuse AVANT d\'écrire (rien d\'écrit, pas de sauvegarde)', [/61/.test(m1 || ''), B.writes.length, B.instantane() === s, fs.existsSync(f)], [true, 0, true, false]);
        let m2 = null; try { await S.appliquer(B.db, p, { ecrire: true, sauvegarde: f }); } catch (e) { m2 = String(e.message); }
        verifier('--ecrire sans --attendu : refuse', [typeof m2, B.writes.length], ['string', 0]);
        let m3 = null; try { await S.appliquer(B.db, p, { ecrire: true, attendu: 4 }); } catch (e) { m3 = String(e.message); }
        verifier('--ecrire sans sauvegarde : refuse, rien n\'est écrit', [/sauvegarde/.test(m3 || ''), B.writes.length], [true, 0]);
        // l'écriture est conditionnelle : un état qui a bougé entre le plan et l'écriture arrête tout
        entreeDe(B, 1003, 'tcgdex/SWSH/195-1003.webp').produitsPartages = [32, 31, 99];
        let m4 = null; try { await S.appliquer(B.db, p, { ecrire: true, attendu: 4, sauvegarde: f }); } catch (e) { m4 = String(e.message); }
        verifier('une entrée modifiée entre le plan et l\'écriture : l\'update conditionnel ne la touche pas et le lot s\'arrête', /introuvable ou inchangée/.test(m4 || ''), true);
        let m5 = null; try { await S.restaurer(B.db, f, { ecrire: true }); } catch (e) { m5 = String(e.message); }
        verifier('--restaurer --ecrire sans --attendu : refuse', typeof m5, 'string');
    });
    await essayer('annonce', async () => {
        const { B } = monde();
        const p = await S.construirePlan({ cartesDb: B.db });
        const a = await S.annonceDePlan(B.db, p);
        verifier('garde de lot : le retrait ne fait baisser AUCUN compteur (aucune annonce, 0 baisse non autorisée)', [a.annonces, a.baissesNonAutorisees], [{}, 0]);
        const lire = () => ({ cartes: [...B.col('cartes').values()].map(x => structuredClone(x)), cartesProduits: [], sets: [] });
        const avant = G.compterEtat(lire());
        await S.appliquer(B.db, p, { ecrire: true, attendu: 4, sauvegarde: path.join(tmp(), 'g.json') });
        verifier('garde de lot : rejouée sur le vrai avant/après, aucune baisse', G.comparer(avant, G.compterEtat(lire())).nonAutorisees.length, 0);
    });
    await essayer('script', () => {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'retirer-partages-separes.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        verifier('ligne de commande : argument inconnu → code 2 avant toute connexion', [lancer('--bidon').status, lancer('--ecrire=1').status], [2, 2]);
        verifier('ligne de commande : --ecrire sans --attendu → 2 ; sans --sauvegarde → 2', [lancer('--ecrire').status, lancer('--ecrire', '--attendu=61').status], [2, 2]);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });
