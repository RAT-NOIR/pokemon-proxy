// BANC — collecte-cartes/commit-local.js + balise-worker.js : la balise d'un processus LOCAL porte un commit VÉRIFIABLE
// (HEAD quand l'arbre suivi est propre), sinon l'ABSENCE de commit — la garde du commit BLOQUE alors, comme pour « local ».
//   node test-commit-local.js
// Aucune base, aucun réseau : un faux git, une fausse collection.
const assert = require('assert');
const CL = require('./collecte-cartes/commit-local');
const balise = require('./collecte-cartes/balise-worker');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`🔴 ${nom} : ${e.message}`); } };

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
// un faux git : rev-parse rend SHA, status --porcelain rend `sale` (vide = propre) ; `panne` fait échouer l'appel
const fauxGit = ({ sale = '', panne = null } = {}) => args => {
    if (panne === args[0]) throw new Error(`git ${args[0]} : échec simulé`);
    if (args[0] === 'rev-parse') return SHA + '\n';
    if (args[0] === 'status') return sale;
    throw new Error(`appel git inattendu : ${args.join(' ')}`);
};

(async () => {
    await t('Render : RENDER_GIT_COMMIT fait foi (déploiement = commit propre), git n\'est pas appelé', () => {
        const r = CL.commitVerifiable({ env: { RENDER_GIT_COMMIT: SHA }, git: () => { throw new Error('git appelé'); } });
        assert.equal(r.commit, SHA.slice(0, 12));
    });
    await t('local, arbre suivi propre : HEAD (12 caractères, comme VERSION)', () => {
        const r = CL.commitVerifiable({ env: {}, git: fauxGit() });
        assert.equal(r.commit, SHA.slice(0, 12));
    });
    await t('local, arbre suivi SALE : aucun commit, et la raison le dit', () => {
        const r = CL.commitVerifiable({ env: {}, git: fauxGit({ sale: ' M collecteur-images.js\n' }) });
        assert.equal(r.commit, null);
        assert.match(r.raison, /sale|modifi/i);
    });
    await t('local, git en panne (rev-parse) : aucun commit — « je ne sais pas » n\'est jamais un commit', () => {
        assert.equal(CL.commitVerifiable({ env: {}, git: fauxGit({ panne: 'rev-parse' }) }).commit, null);
    });
    await t('local, git en panne (status) : aucun commit', () => {
        assert.equal(CL.commitVerifiable({ env: {}, git: fauxGit({ panne: 'status' }) }).commit, null);
    });
    await t('local, rev-parse rend autre chose qu\'un SHA : aucun commit', () => {
        assert.equal(CL.commitVerifiable({ env: {}, git: args => (args[0] === 'status' ? '' : 'pas un sha') }).commit, null);
    });
    await t('une variable VERSION posée à la main ne vaut pas preuve (hors Render, seul git atteste)', () => {
        const r = CL.commitVerifiable({ env: { VERSION: 'deadbeefdead' }, git: fauxGit({ sale: ' M x.js\n' }) });
        assert.equal(r.commit, null);
    });

    // ── la balise écrite ─────────────────────────────────────────────────────────────────────────────────────────
    const fauxDb = () => { const docs = new Map(); return { docs, collection: () => ({ async updateOne(f, u) { docs.set(f._id, { ...(docs.get(f._id) || {}), ...u.$set }); } }) }; };
    await t('battre (arbre propre) : la balise porte le commit HEAD', async () => {
        const db = fauxDb();
        await balise.battre(db, 'repos', { commit: () => CL.commitVerifiable({ env: {}, git: fauxGit() }) });
        const b = [...db.docs.values()][0].balise;
        assert.equal(b.commit, SHA.slice(0, 12));
        assert.equal(b.etat, 'repos');
    });
    await t('battre (arbre sale) : la balise est posée SANS le champ commit (l\'absence est l\'information)', async () => {
        const db = fauxDb();
        await balise.battre(db, 'travail', { commit: () => CL.commitVerifiable({ env: {}, git: fauxGit({ sale: ' M a.js\n' }) }) });
        const b = [...db.docs.values()][0].balise;
        assert.ok(!('commit' in b), 'le champ commit doit être absent, pas « local » ni null');
        assert.ok(b.pid && b.hote && b.depuis);
    });
    await t('battre sans résolveur : ne lève pas et ne ment pas (jamais « local » écrit comme commit)', async () => {
        const db = fauxDb();
        await balise.battre(db, 'repos');
        const b = [...db.docs.values()][0].balise;
        assert.notEqual(b.commit, 'local');
    });

    console.log(`\n${ok} passés · ${ko} en échec`);
    if (ko) process.exit(1);
})();
