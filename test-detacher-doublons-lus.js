// node test-detacher-doublons-lus.js — détacher les deux doublons M2/M6 d'EX Trainer Kit 2 (collecte-cartes/detacher-doublons-lus.js + detacher-doublons-lus.js).
// Base EN MÉMOIRE, aucune requête, jamais une vraie base ni un dossier du testeur (sauvegardes dans un dossier temporaire).
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const D = require(path.join(DIR, 'collecte-cartes', 'detacher-doublons-lus.js'));
const CLI = require(path.join(DIR, 'detacher-doublons-lus.js'));

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
        if (k === 'images.cleR2') { const vals = (d.images || []).map(i => i.cleR2); return v && '$ne' in v ? !vals.includes(v.$ne) : vals.includes(v); }
        const x = d[k];
        if (v && typeof v === 'object' && '$elemMatch' in v) return (x || []).some(e => Object.entries(v.$elemMatch).every(([a, b]) => e[a] === b));
        if (v === null) return x === null || x === undefined;
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
            for (const [k, c] of Object.entries(u.$pull || {})) d[k] = d[k].filter(e => !Object.entries(c).every(([a, b]) => e[a] === b));
            for (const [k, v] of Object.entries(u.$push || {})) d[k] = [...(d[k] || []), structuredClone(v)];
            writes.push({ n, f, u });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit'); }, async insertOne() { throw new Error('insertOne : interdit'); },
        async deleteOne() { throw new Error('deleteOne : interdit'); }, async deleteMany() { throw new Error('deleteMany : interdit'); }, async replaceOne() { throw new Error('replaceOne : interdit'); }
    });
    return { db: { collection }, col, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}
const SET = 'EX-Trainer-Kit-2';
function monde({ sansPkc = [], numeroPkc = null, etat = 'ok' } = {}) {
    const B = fausseBase();
    for (const e of D.LISTE) {
        const images = [{ set: SET, source: 'pokemontcg.io', cleR2: e.cleGardee, numero: e.numeroGarde, preuve: 'p', vignette: { cleR2: `vignettes/${e.cleGardee}` } }];
        if (!sansPkc.includes(e.carteId)) images.push({ set: SET, source: 'pkc', cleR2: e.cleDetachee, numero: numeroPkc, vignette: { cleR2: `vignettes/${e.cleDetachee}` } });
        B.col('cartes').set(e.carteId, { _id: e.carteId, nomEn: e.nom, images: [...images, { set: 'Autre', source: 'tcgdex', cleR2: `tcgdex/Autre/${e.carteId}.webp`, numero: '9' }] });
        B.col('images').set(`g${e.carteId}`, { _id: `g${e.carteId}`, source: 'pokemontcg.io', carteId: e.carteId, set: SET, cleR2: e.cleGardee, etat: 'ok' });
        B.col('images').set(`f${e.carteId}`, { _id: `f${e.carteId}`, source: 'pkc', carteId: e.carteId, set: SET, cleR2: e.cleDetachee, etat, retirable: true });
    }
    return B;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dbl-'));
const ecrireFichier = (f, o) => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
const trie = x => Array.isArray(x) ? x.map(trie) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, trie(x[k])])) : x;

(async () => {
    await essayer('liste', () => {
        verifier('liste fermée : 2 lignes (45331 M2, 45339 M6), preuve consignée', [D.LISTE.map(e => [e.carteId, e.numeroGarde, e.cleDetachee.startsWith('pkc/')]), D.LISTE.every(e => /2026-10-27/.test(e.preuve) && /feu vert/.test(e.preuve))], [[[45331, 'M2', true], [45339, 'M6', true]], true]);
    });
    await essayer('simulation', async () => {
        const B = monde();
        const plan = await D.simuler(B.db);
        verifier('simulation : 2 à détacher, 0 refus, avec vignette ; rien d\'écrit', [plan.aDetacher.length, plan.refus.length, plan.aDetacher.every(x => x.avecVignette), B.writes.length], [2, 0, true, 0]);
        verifier('annonce : images set + vignettes-set set', D.annonce(plan), { 'images set:EX-Trainer-Kit-2': 2, 'vignettes-set set:EX-Trainer-Kit-2': 2 });
    });
    await essayer('refus', async () => {
        const deja = await D.simuler(monde({ sansPkc: [45331, 45339] }).db);
        verifier('déjà fait : refus « rien à détacher » ×2', [deja.aDetacher.length, deja.refus.filter(r => /rien à détacher/.test(r.raison)).length], [0, 2]);
        const pasNul = await D.simuler(monde({ numeroPkc: '2' }).db);
        verifier('l\'entrée pkc porte un numero : refus (écrit par ce qu\'on autorise)', [pasNul.aDetacher.length, pasNul.refus.every(r => /numero null|pas \(source pkc/.test(r.raison))], [0, true]);
        const B = monde(); B.col('cartes').get(45331).images.find(i => i.source === 'pokemontcg.io').numero = null;
        verifier('l\'entrée à garder n\'a plus son numéro M2 : refus de cette ligne seule', [(await D.simuler(B.db)).aDetacher.map(x => x.entree.carteId), (await D.simuler(B.db)).refus.map(r => r.entree.carteId)], [[45339], [45331]]);
        const B2 = monde(); B2.col('cartes').get(45339).images.push({ ...B2.col('cartes').get(45339).images[1] });
        verifier('deux entrées identiques à détacher : refus (une seule attendue)', (await D.simuler(B2.db)).refus.map(r => /2 entrées/.test(r.raison)), [true]);
        const B3 = monde({ etat: 'retire' });
        verifier('document images déjà « retire » : refus', (await D.simuler(B3.db)).refus.length, 2);
        const B4 = monde(); B4.col('images').delete('f45331');
        verifier('document images absent : refus', (await D.simuler(B4.db)).refus.map(r => /0 document/.test(r.raison)), [true]);
        const B5 = monde(); B5.col('cartes').delete(45339);
        verifier('carte absente : refus', (await D.simuler(B5.db)).refus.map(r => /absente/.test(r.raison)), [true]);
    });
    await essayer('ecriture', async () => {
        const B = monde(); const f = path.join(tmp(), 'sauve.json');
        const avant = trie(JSON.parse(B.instantane()));
        const plan = await D.simuler(B.db);
        let m = null; try { await D.detacher(B.db, plan, { ecrireFichier }); } catch (e) { m = e.message; }
        verifier('sans sauvegarde : refuse avant d\'écrire', [/sauvegarde/.test(m || ''), B.writes.length], [true, 0]);
        const n = await D.detacher(B.db, plan, { sauvegarde: f, ecrireFichier });
        verifier('écriture : 2 détachées ; cartes : il reste la gardée et l\'autre set', [n, B.col('cartes').get(45331).images.map(i => i.cleR2), B.col('cartes').get(45339).images.length], [2, ['pokemontcg.io/EX-Trainer-Kit-2/M2-45331-en.webp', 'tcgdex/Autre/45331.webp'], 2]);
        const d = B.col('images').get('f45331');
        verifier('document images : etat retire + retireLe + retireMotif ; le gardé intact', [d.etat, d.retireLe instanceof Date, /2026-10-27/.test(d.retireMotif), B.col('images').get('g45331').etat], ['retire', true, true, 'ok']);
        verifier('seules cartes et images écrites, deux écritures chacune', [[...new Set(B.writes.map(w => w.n))].sort(), B.writes.length], [['cartes', 'images'], 4]);
        const s = JSON.parse(fs.readFileSync(f, 'utf8'));
        verifier('sauvegarde : 2 entrées complètes avec leur vignette', [s.lignes.length, s.lignes.every(l => l.entree.source === 'pkc' && l.entree.vignette)], [2, true]);
        const nw = B.writes.length;
        verifier('rejoué : plus rien à détacher (2 refus « rien à détacher »)', [(await D.simuler(B.db)).aDetacher.length, B.writes.length - nw], [0, 0]);
        let m2 = null; try { await D.restaurer(B.db, s, { ecrire: true, attendu: 3 }); } catch (e) { m2 = e.message; }
        verifier('restauration : --attendu faux refuse', [/3/.test(m2 || ''), B.writes.length - nw], [true, 0]);
        const r = await D.restaurer(B.db, s, { ecrire: true, attendu: 2 });
        verifier('restauration : 2 rendues, relu', [r.lignes, r.relu], [2, { rendues: 2 }]);
        const apres = trie(JSON.parse(B.instantane()));
        const normImages = x => JSON.stringify(x, (k, v) => (k === 'images' && Array.isArray(v) ? v.map(e => e.cleR2).sort() : v));
        verifier('restauration : le monde est celui d\'avant (ordre des entrées mis à part)', normImages(apres) === normImages(avant), true);
        let m3 = null; try { await D.restaurer(B.db, s, { ecrire: true, attendu: 2 }); } catch (e) { m3 = e.message; }
        verifier('restauration rejouée : refuse (déjà restaurée)', /déjà restaurée/.test(m3 || ''), true);
    });
    await essayer('entre plan et ecriture', async () => {
        const B = monde(); const f = path.join(tmp(), 'c.json');
        const plan = await D.simuler(B.db);
        B.col('images').get('f45339').etat = 'retire';   // quelqu'un l'a retiré entre-temps
        let m = null; try { await D.detacher(B.db, plan, { sauvegarde: f, ecrireFichier }); } catch (e) { m = e.message; }
        verifier('document déjà retiré entre plan et écriture : le lot s\'arrête (rien n\'est forcé)', /introuvable à l'état ok/.test(m || ''), true);
    });
    await essayer('executeur', async () => {
        const B = monde(); const sortie = []; const f = path.join(tmp(), 'e.json');
        const base = { db: B.db, log: s => sortie.push(s), ecrireFichier };
        const r = await CLI.executer({ ...base });
        const txt = sortie.join('\n');
        verifier('essai à blanc : 2 à détacher, annonce imprimée, rien d\'écrit', [B.writes.length, r.plan.aDetacher.length, /ANNONCE des baisses[^\n]*images set:EX-Trainer-Kit-2[^\n]*vignettes-set set:EX-Trainer-Kit-2/.test(txt)], [0, 2, true]);
        let m = null; try { await CLI.executer({ ...base, ecrire: true, attendu: 1, sauvegarde: f }); } catch (e) { m = e.message; }
        verifier('--attendu ≠ plan : arrêt avant d\'écrire', [/1/.test(m || ''), B.writes.length], [true, 0]);
        let m2 = null; try { await CLI.executer({ ...base, ecrire: true, attendu: 2, sauvegarde: f, garde: () => { throw new Error('hors lot'); } }); } catch (e) { m2 = e.message; }
        verifier('la garde de lot est appelée avant toute écriture', [/hors lot/.test(m2 || ''), B.writes.length], [true, 0]);
        await CLI.executer({ ...base, ecrire: true, attendu: 2, sauvegarde: f });
        verifier('écriture de bout en bout : relue (0 entrée restante à détacher)', /relu : 0 entrée/.test(sortie.join('\n')), true);
    });
    await essayer('script', () => {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'detacher-doublons-lus.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '', MONGODB_CARTES_LECTURE_URI: '' } });
        verifier('argument inconnu → 2', [lancer('--bidon').status, lancer('--ecrire=1').status], [2, 2]);
        verifier('--ecrire sans --attendu → 2 ; sans --sauvegarde → 2', [lancer('--ecrire').status, lancer('--ecrire', '--attendu=2').status], [2, 2]);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });
