// BANC — imports-cardmarket-ci.js : UNE passe d'import pour GitHub Actions. Aucun réseau, aucune base : une collection en mémoire, un
// lanceur factice, un faux ouvreur de base. Cas : dû / pas dû / déjà fait / échec -> 1 / rien de neuf -> 0 / variable absente -> 1 sans requête.
//   node test-imports-cardmarket-ci.js
const assert = require('assert');
const fs = require('fs'), path = require('path');
const CI = require('./imports-cardmarket-ci');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`🔴 ${nom} : ${e.message}`); } };
const a = iso => new Date(iso);

function collection() {
    const docs = new Map();
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? d._id === v : (v && typeof v === 'object' && '$ne' in v) ? d[k] !== v.$ne : d[k] === v);
    return {
        docs,
        async findOne(f) { const d = [...docs.values()].find(x => correspond(x, f)); return d ? JSON.parse(JSON.stringify(d), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v)) ? new Date(v) : v) : null; },
        async updateOne(f, u, o = {}) {
            let d = [...docs.values()].find(x => correspond(x, f));
            if (!d) { if (!o.upsert) return { matchedCount: 0 }; d = { _id: f._id }; docs.set(d._id, d); Object.assign(d, u.$setOnInsert || {}); }
            Object.assign(d, u.$set || {});
            for (const [k, v] of Object.entries(u.$push || {})) { const l = [...(d[k] || []), ...(v.$each || [v])]; d[k] = v.$slice ? l.slice(v.$slice) : l; }
            return { matchedCount: 1 };
        }
    };
}
const ENV = { MONGODB_URI: 'mongodb+srv://u:SECRET-XYZ@h/x', R2_BUCKET_BRUT: 'b', R2_ACCESS_KEY_ID: 'SECRET-KEY', R2_SECRET_ACCESS_KEY: 'SECRET-SEC', R2_ACCOUNT_ID: 'acct' };
function banc({ E = collection(), env = ENV, lance = [], code = 0, extrait = 'ok' } = {}) {
    const sortie = [], ouvertures = [];
    const journal = { log: m => sortie.push(String(m)), error: m => sortie.push(String(m)), warn: m => sortie.push(String(m)) };
    const lancerScript = async script => { lance.push(script); return { code, dureeS: 1, extrait }; };
    const ouvrirE = async () => { ouvertures.push(1); return { E, fermer: async () => { } }; };
    const passe = (argv, iso) => CI.passeCI({ argv, env, ouvrirE, lancerScript, maintenant: () => a(iso), journal });
    return { E, lance, sortie, ouvertures, passe };
}

(async () => {
    await t('guide dû à 05:10 : le guide seul est lancé, sortie 0', async () => {
        const b = banc();
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T05:10:00Z'), 0);
        assert.deepEqual(b.lance, ['import-guide-quotidien.js']);
    });
    await t('rien dû à 04:00 (auto) : aucun lancement, sortie 0', async () => {
        const b = banc();
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T04:00:00Z'), 0);
        assert.deepEqual(b.lance, []);
    });
    await t('déjà fait : la seconde passe du jour ne refait rien (journal en base)', async () => {
        const b = banc();
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T05:10:00Z'), 0);
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T05:40:00Z'), 0);
        assert.deepEqual(b.lance, ['import-guide-quotidien.js']);
    });
    await t('12:20 avec le guide déjà fait : le catalogue seul', async () => {
        const b = banc();
        await b.passe(['--import=auto'], '2026-10-18T05:10:00Z');
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T12:20:00Z'), 0);
        assert.deepEqual(b.lance, ['import-guide-quotidien.js', 'import-catalogue-quotidien.js']);
    });
    await t('--import=catalogue à 05:10 (pas dû) : rien, sortie 0 ; --import=guide à 12:20 sans journal : le guide est dû', async () => {
        const b = banc();
        assert.equal(await b.passe(['--import=catalogue'], '2026-10-18T05:10:00Z'), 0);
        assert.deepEqual(b.lance, []);
        assert.equal(await b.passe(['--import=guide'], '2026-10-18T12:20:00Z'), 0);
        assert.deepEqual(b.lance, ['import-guide-quotidien.js'], 'le catalogue n\'est pas touché par --import=guide');
    });
    await t('échec : sortie 1 et alerte active en base', async () => {
        const b = banc({ code: 1, extrait: '🔴 fichier tronqué' });
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T05:10:00Z'), 1);
        assert.equal((await b.E.findOne({ _id: 'alerte/import-guide' })).active, true);
    });
    await t('« rien de neuf » : sortie 0 (ce n\'est pas un échec), le jour est clos', async () => {
        const b = banc({ extrait: 'ℹ️ rien de neuf : 304' });
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T05:10:00Z'), 0);
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T07:10:00Z'), 0);
        assert.equal(b.lance.length, 1);
    });
    await t('variable absente : sortie 1, AUCUNE base ouverte, AUCUN lancement, seul le NOM est dit', async () => {
        const env = { ...ENV }; delete env.R2_SECRET_ACCESS_KEY;
        const b = banc({ env });
        assert.equal(await b.passe(['--import=auto'], '2026-10-18T05:10:00Z'), 1);
        assert.equal(b.ouvertures.length, 0); assert.deepEqual(b.lance, []);
        assert.match(b.sortie.join('\n'), /R2_SECRET_ACCESS_KEY/);
    });
    await t('argument inconnu ou --import invalide : sortie 1, rien d\'ouvert', async () => {
        const b = banc();
        assert.equal(await b.passe(['--import=tout'], '2026-10-18T05:10:00Z'), 1);
        assert.equal(await b.passe(['--bidule'], '2026-10-18T05:10:00Z'), 1);
        assert.equal(b.ouvertures.length, 0);
    });
    await t('jamais une valeur de secret dans la sortie', async () => {
        const b = banc({ code: 1, extrait: 'boum' });
        await b.passe(['--import=auto'], '2026-10-18T05:10:00Z');
        const env = { ...ENV }; delete env.R2_BUCKET_BRUT;
        await banc({ env }).passe(['--import=auto'], '2026-10-18T05:10:00Z');
        assert.ok(!/SECRET-/.test(b.sortie.join('\n')));
    });
    await t('échec : nom, code et extrait sont imprimés, MASQUÉS (valeurs des variables secrètes et URI mongodb)', async () => {
        const extrait = 'connexion mongodb+srv://admin:MOTDEPASSE@cluster0.x.mongodb.net/test refusée ; clé SECRET-KEY ; sec SECRET-SEC ; compte acct-long';
        const env = { ...ENV, R2_ACCOUNT_ID: 'acct-long' };
        const sortie = [], journal = { log: m => sortie.push(String(m)), error: m => sortie.push(String(m)), warn: m => sortie.push(String(m)) };
        const E = collection();
        const code = await CI.passeCI({ argv: ['--import=guide'], env, ouvrirE: async () => ({ E, fermer: async () => { } }), lancerScript: async () => ({ code: 7, dureeS: 1, extrait }), maintenant: () => a('2026-10-18T05:10:00Z'), journal });
        const s = sortie.join('\n');
        assert.equal(code, 1); assert.match(s, /guide/); assert.match(s, /code 7/); assert.match(s, /refusée/);
        for (const v of ['MOTDEPASSE', 'SECRET-KEY', 'SECRET-SEC', 'acct-long', 'cluster0']) assert.ok(!s.includes(v), `fuite : ${v}`);
        assert.match(s, /mongodb:\/\/\*\*\*/);
    });
    await t('masquer : une valeur courte (< 4 car.) n\'est pas masquée partout ; vide ignorée', () => {
        assert.equal(CI.masquerSecrets('abc b', { R2_BUCKET_BRUT: 'b', MONGODB_URI: '' }), 'abc b');
    });
    await t('échec déjà constaté aujourd\'hui mais non rejouable (moins d\'1 h) : la passe reste ROUGE, pas "rien de dû"', async () => {
        const b = banc({ code: 1, extrait: 'boum' });
        assert.equal(await b.passe(['--import=guide'], '2026-10-18T05:10:00Z'), 1);
        assert.equal(await b.passe(['--import=guide'], '2026-10-18T05:30:00Z'), 1);
        assert.equal(b.lance.length, 1);
        assert.equal(await b.passe(['--import=guide'], '2026-10-19T04:00:00Z'), 0, 'le lendemain avant l\'heure : rien de dû, vert');
    });
    await t('le journal des imports du dépôt (importsQuotidiens) accepte `seulement` et reste inchangé sans lui', async () => {
        const IQ = require('./collecte-cartes/imports-quotidiens');
        const E = collection(), lances = [];
        const lancer = async s => { lances.push(s); return { code: 0, dureeS: 1, extrait: 'ok' }; };
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-18T13:00:00Z'), journal: { log() { }, error() { } }, seulement: ['catalogue'] });
        assert.deepEqual(lances, ['import-catalogue-quotidien.js']);
    });

    // le workflow
    const wf = path.join(__dirname, '.github', 'workflows', 'imports-cardmarket.yml');
    await t('workflow : horaires, permissions, concurrency, versions précises, secrets, timeout', () => {
        const y = fs.readFileSync(wf, 'utf8');
        assert.match(y, /cron: '0 5 \* \* \*'/); assert.match(y, /cron: '15 12 \* \* \*'/);
        assert.match(y, /workflow_dispatch:/); assert.match(y, /guide[\s\S]*catalogue[\s\S]*auto|options:/);
        assert.match(y, /permissions:\s*\n\s+contents: read/);
        assert.match(y, /group: imports-cardmarket/); assert.match(y, /cancel-in-progress: false/);
        assert.match(y, /actions\/checkout@v\d+\b/); assert.match(y, /actions\/setup-node@v\d+\b/);
        assert.doesNotMatch(y, /@(main|master)\b/);
        assert.match(y, /node-version: '?22/); assert.match(y, /npm ci/);
        assert.match(y, /MONGODB_URI: \$\{\{ secrets\.MONGODB_URI_IMPORTS \}\}/);
        for (const n of ['R2_BUCKET_BRUT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_ENDPOINT']) assert.match(y, new RegExp(`${n}: \\$\\{\\{ secrets\\.${n} \\}\\}`));
        assert.match(y, /timeout-minutes: \d+/); assert.match(y, /node imports-cardmarket-ci\.js/);
        assert.doesNotMatch(y, /mongodb(\+srv)?:\/\//);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
