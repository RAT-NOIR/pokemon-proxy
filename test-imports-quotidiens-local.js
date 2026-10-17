// BANC — imports-quotidiens-local.js + collecte-cartes/verrou-pid.js : UNE passe locale des imports quotidiens (le worker Render est suspendu).
//   node test-imports-quotidiens-local.js
// Aucun import n'est exécuté, aucune base, aucun réseau : collection en mémoire, lanceur factice, fichiers dans un dossier temporaire.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const VP = require('./collecte-cartes/verrou-pid');
const L = require('./imports-quotidiens-local');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`🔴 ${nom} : ${e.message}`); } };
const a = iso => new Date(iso);
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verrou-pid-'));
const fichier = nom => path.join(dossier, nom);

function collection() {
    const docs = new Map();
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? d._id === v : (v && typeof v === 'object' && '$ne' in v) ? d[k] !== v.$ne : d[k] === v);
    return {
        docs,
        async findOne(f) { return [...docs.values()].find(d => correspond(d, f)) ?? null; },
        async updateOne(f, u, o = {}) {
            let d = [...docs.values()].find(x => correspond(x, f));
            if (!d) { if (!o.upsert) return { matchedCount: 0 }; d = { _id: f._id }; docs.set(d._id, d); Object.assign(d, u.$setOnInsert || {}); }
            Object.assign(d, u.$set || {});
            for (const [k, v] of Object.entries(u.$push || {})) { const l = [...(d[k] || []), ...(v.$each || [v])]; d[k] = v.$slice ? l.slice(v.$slice) : l; }
            return { matchedCount: 1 };
        }
    };
}
const journal = () => { const l = []; return { l, log: m => l.push(m), warn: m => l.push(m), error: m => l.push(m) }; };

(async () => {
    // ── le verrou par PID ─────────────────────────────────────────────────────────────────────────────────────────────
    await t('verrou : libre → pris, le fichier porte le PID', () => {
        const r = VP.prendre(fichier('a.pid'), { pid: 1111, maintenant: a('2026-10-17T20:00:00Z'), vivant: () => true });
        assert.equal(r.ok, true);
        assert.equal(JSON.parse(fs.readFileSync(fichier('a.pid'), 'utf8')).pid, 1111);
    });
    await t('verrou : tenu par un PID VIVANT et récent → refusé, le détenteur est nommé', () => {
        const r = VP.prendre(fichier('a.pid'), { pid: 2222, maintenant: a('2026-10-17T20:10:00Z'), vivant: pid => pid === 1111 });
        assert.equal(r.ok, false);
        assert.equal(r.detenteur.pid, 1111);
    });
    await t('verrou : détenteur MORT → repris (un processus tué ne libère rien)', () => {
        const r = VP.prendre(fichier('a.pid'), { pid: 3333, maintenant: a('2026-10-17T20:20:00Z'), vivant: () => false });
        assert.equal(r.ok, true);
        assert.equal(JSON.parse(fs.readFileSync(fichier('a.pid'), 'utf8')).pid, 3333);
    });
    await t('verrou : PID vivant mais verrou plus vieux que la durée max → repris (PID réutilisé par Windows)', () => {
        const r = VP.prendre(fichier('a.pid'), { pid: 4444, maintenant: a('2026-10-17T23:30:00Z'), vivant: () => true, dureeMaxMs: 90 * 60000 });
        assert.equal(r.ok, true);
    });
    await t('verrou : fichier illisible → refus (je ne sais pas), jamais une prise', () => {
        fs.writeFileSync(fichier('b.pid'), '{pas du json');
        const r = VP.prendre(fichier('b.pid'), { pid: 5, maintenant: a('2026-10-17T20:00:00Z'), vivant: () => false });
        assert.equal(r.ok, false);
        assert.match(r.raison, /illisible/);
    });
    await t('verrou : rendre ne supprime que SON verrou', () => {
        VP.prendre(fichier('c.pid'), { pid: 10, maintenant: a('2026-10-17T20:00:00Z'), vivant: () => false });
        assert.equal(VP.rendre(fichier('c.pid'), 99), false);
        assert.ok(fs.existsSync(fichier('c.pid')));
        assert.equal(VP.rendre(fichier('c.pid'), 10), true);
        assert.ok(!fs.existsSync(fichier('c.pid')));
    });
    await t('verrou : deux prises simultanées (création exclusive) → une seule gagne', () => {
        const un = VP.prendre(fichier('d.pid'), { pid: 1, maintenant: a('2026-10-17T20:00:00Z'), vivant: () => true });
        const deux = VP.prendre(fichier('d.pid'), { pid: 2, maintenant: a('2026-10-17T20:00:01Z'), vivant: () => true });
        assert.deepEqual([un.ok, deux.ok], [true, false]);
    });

    // ── la passe ──────────────────────────────────────────────────────────────────────────────────────────────────────
    await t('la passe pose IMPORTS_QUOTIDIENS=1 explicitement (le lanceur local n\'attend pas qu\'on l\'ait posé)', () => {
        const env = {};
        L.poserEnvironnement(env);
        assert.equal(env.IMPORTS_QUOTIDIENS, '1');
        assert.equal(require('./collecte-cartes/imports-quotidiens').actif(env), true);
    });
    await t('la passe réutilise importsQuotidiens : avant 5 h UTC, aucun script lancé', async () => {
        const E = collection(), j = journal(), lances = [];
        const r = await L.passe({ E, verrouFichier: fichier('p1.pid'), lancerScript: async s => { lances.push(s); return { code: 0, dureeS: 1, extrait: '' }; }, maintenant: () => a('2026-10-17T04:00:00Z'), journal: j, pid: 1, vivant: () => false });
        assert.equal(r.etat, 'rien-a-faire');
        assert.deepEqual(lances, []);
        assert.ok(!fs.existsSync(fichier('p1.pid')), 'le verrou est rendu');
    });
    await t('la passe à 13 h UTC : les deux scripts sont lancés avec les ARGS de la définition unique, journal écrit en base', async () => {
        const E = collection(), j = journal(), lances = [];
        const IQ = require('./collecte-cartes/imports-quotidiens');
        const r = await L.passe({ E, verrouFichier: fichier('p2.pid'), lancerScript: async (s, args) => { lances.push([s, args]); return { code: 0, dureeS: 2, extrait: 'ok' }; }, maintenant: () => a('2026-10-17T13:00:00Z'), journal: j, pid: 1, vivant: () => false });
        assert.equal(r.etat, 'passe');
        assert.deepEqual(lances.map(x => x[0]).sort(), ['import-catalogue-quotidien.js', 'import-guide-quotidien.js']);
        assert.deepEqual(lances[0][1], IQ.ARGS);
        assert.equal((await E.findOne({ _id: 'import-quotidien/guide' })).succesLe, '2026-10-17');
        assert.equal((await E.findOne({ _id: 'import-quotidien/catalogue' })).succesLe, '2026-10-17');
    });
    await t('deux passes le même jour : la seconde ne relance rien (déjà importé)', async () => {
        const E = collection(), lances = [];
        const lanceur = async s => { lances.push(s); return { code: 0, dureeS: 1, extrait: '' }; };
        const base = { E, verrouFichier: fichier('p3.pid'), lancerScript: lanceur, maintenant: () => a('2026-10-17T13:00:00Z'), journal: journal(), pid: 1, vivant: () => false };
        await L.passe(base); const n = lances.length; await L.passe({ ...base, maintenant: () => a('2026-10-17T14:00:00Z') });
        assert.equal(lances.length, n);
    });
    await t('verrou tenu par un PID vivant : la passe s\'abstient, ne lance rien et ne touche pas à la base', async () => {
        const E = collection(), j = journal(), lances = [];
        VP.prendre(fichier('p4.pid'), { pid: 777, maintenant: a('2026-10-17T13:00:00Z'), vivant: () => true });
        const r = await L.passe({ E, verrouFichier: fichier('p4.pid'), lancerScript: async s => { lances.push(s); return { code: 0, dureeS: 1, extrait: '' }; }, maintenant: () => a('2026-10-17T13:05:00Z'), journal: j, pid: 888, vivant: pid => pid === 777 });
        assert.equal(r.etat, 'verrou-tenu');
        assert.deepEqual(lances, []);
        assert.equal(E.docs.size, 0);
        assert.ok(fs.existsSync(fichier('p4.pid')), 'le verrou de l\'autre n\'est pas rendu');
    });
    await t('un import en ÉCHEC : alerte écrite par le module existant, la passe ne lève pas et rend le verrou', async () => {
        const E = collection(), j = journal();
        const r = await L.passe({ E, verrouFichier: fichier('p5.pid'), lancerScript: async () => ({ code: 1, dureeS: 1, extrait: 'boum' }), maintenant: () => a('2026-10-17T13:00:00Z'), journal: j, pid: 1, vivant: () => false });
        assert.equal(r.etat, 'passe');
        assert.equal((await E.findOne({ _id: 'alerte/import-guide' })).active, true);
        assert.ok(!fs.existsSync(fichier('p5.pid')));
    });
    await t('le verrou est rendu même si la base lève', async () => {
        const E = { findOne: async () => { throw new Error('base injoignable'); }, updateOne: async () => { } };
        await assert.rejects(L.passe({ E, verrouFichier: fichier('p6.pid'), lancerScript: async () => ({ code: 0 }), maintenant: () => a('2026-10-17T13:00:00Z'), journal: journal(), pid: 1, vivant: () => false }));
        assert.ok(!fs.existsSync(fichier('p6.pid')));
    });
    await t('le journal local est horodaté', () => {
        const l = [];
        const j = L.journalHorodate({ ecrire: m => l.push(m), maintenant: () => a('2026-10-17T13:00:00Z') });
        j.log('bonjour'); j.error('mal');
        assert.match(l[0], /^2026-10-17T13:00:00\.000Z .*bonjour/);
        assert.match(l[1], /^2026-10-17T13:00:00\.000Z .*mal/);
    });
    await t('hygiène : ni le lanceur ni le .cmd ne tuent un processus par nom ; le .cmd redirige lui-même la sortie', () => {
        const js = fs.readFileSync(path.join(__dirname, 'imports-quotidiens-local.js'), 'utf8');
        const cmd = fs.readFileSync(path.join(__dirname, 'imports-quotidiens-local.cmd'), 'utf8');
        for (const s of [js, cmd]) assert.ok(!/taskkill\s+\/im|Stop-Process\s+-Name|pkill|killall/i.test(s));
        assert.match(cmd, /journaux-locaux/);
        assert.match(cmd, /imports-quotidiens-local\.js >> "%DOSSIER%/);
        assert.match(cmd, /imports-quotidiens-local\.js/);
    });

    fs.rmSync(dossier, { recursive: true, force: true });
    console.log(`\n${ok} passés · ${ko} en échec`);
    if (ko) process.exit(1);
})();
