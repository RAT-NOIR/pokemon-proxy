// BANC PUR — collecte-cartes/journal-imports.js : file-a-l-arret.js doit lire le journal des imports là où il est ÉCRIT.
// Contexte (2026-10-24) : depuis le 17/10 les imports passent par GitHub Actions (imports-cardmarket-ci.js), qui écrit `import-quotidien/<nom>`
// et `alerte/import-<nom>` dans la collection `imports_ci_etat` de la base de PRODUCTION `test` ; file-a-l-arret.js ne lisait que
// `collecte_images_etat` de la base `cartes` (journal du worker Render suspendu) : il affichait « dernier passage 2026-10-17 » alors que la base
// de production portait le 24/10. Aucune base, aucun réseau : des collections factices.
//   node test-journal-imports.js
const assert = require('assert');
const J = require('./collecte-cartes/journal-imports');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`🔴 ${nom} : ${e.message}`); } };
const d = iso => new Date(iso);

/** Une base factice : { collectionNom: [docs] } ; trace les collections ouvertes. */
function baseFactice(contenu, { casse = false } = {}) {
    const ouvertes = [];
    return {
        ouvertes,
        collection(nom) {
            ouvertes.push(nom);
            return { find(filtre) { return { toArray: async () => { if (casse) throw new Error('lecture refusée'); return (contenu[nom] || []).filter(x => filtre._id.test(x._id)); } }; } };
        }
    };
}
const imp = (nom, dernierEssai, extra = {}) => ({ _id: `import-quotidien/${nom}`, dernierEssai: d(dernierEssai), dernierResultat: 'importe', dernierCode: 0, succesLe: dernierEssai.slice(0, 10), enCours: false, ...extra });
const alerte = (nom, extra = {}) => ({ _id: `alerte/import-${nom}`, active: true, depuis: d('2026-10-24T05:00:00Z'), constateLe: d('2026-10-24T05:00:00Z'), code: 1, essais: 1, extrait: 'x', ...extra });

(async () => {
    await t('le journal de la CI (base test, imports_ci_etat), plus récent que celui du worker, l\'emporte — le cas réel du 24/10', async () => {
        const cartes = baseFactice({ collecte_images_etat: [imp('guide', '2026-10-17T05:03:25Z'), imp('catalogue', '2026-10-17T12:16:52Z')] });
        const prod = baseFactice({ imports_ci_etat: [imp('guide', '2026-10-24T08:30:24Z'), imp('catalogue', '2026-10-23T17:15:00Z')] });
        const r = await J.lireJournauxImports({ cartes, prod });
        const g = r.imports.find(i => i._id === 'import-quotidien/guide'), c = r.imports.find(i => i._id === 'import-quotidien/catalogue');
        assert.equal(r.imports.length, 2);
        assert.equal(g.dernierEssai.toISOString(), '2026-10-24T08:30:24.000Z');
        assert.equal(g.source, 'ci');
        assert.equal(c.dernierEssai.toISOString(), '2026-10-23T17:15:00.000Z');
        assert.equal(r.erreurProd, null);
    });
    await t('elle lit la BONNE collection de chaque base (collecte_images_etat sur cartes, imports_ci_etat sur la production)', async () => {
        const cartes = baseFactice({}), prod = baseFactice({});
        await J.lireJournauxImports({ cartes, prod });
        assert.ok(cartes.ouvertes.includes('collecte_images_etat'), `cartes : ${cartes.ouvertes}`);
        assert.ok(prod.ouvertes.includes('imports_ci_etat'), `production : ${prod.ouvertes}`);
        assert.ok(!prod.ouvertes.includes('collecte_images_etat'));
    });
    await t('un journal du worker plus récent que celui de la CI l\'emporte (un passage local, hier, ne doit pas être masqué)', async () => {
        const cartes = baseFactice({ collecte_images_etat: [imp('guide', '2026-10-25T05:00:00Z')] });
        const prod = baseFactice({ imports_ci_etat: [imp('guide', '2026-10-24T08:30:24Z')] });
        const r = await J.lireJournauxImports({ cartes, prod });
        assert.equal(r.imports[0].source, 'worker');
        assert.equal(r.imports[0].dernierEssai.toISOString(), '2026-10-25T05:00:00.000Z');
    });
    await t('un import présent d\'un seul côté est rendu tel quel, avec sa source', async () => {
        const r = await J.lireJournauxImports({ cartes: baseFactice({ collecte_images_etat: [imp('catalogue', '2026-10-17T12:16:52Z')] }), prod: baseFactice({ imports_ci_etat: [imp('guide', '2026-10-24T08:30:24Z')] }) });
        assert.deepEqual(r.imports.map(i => [i._id, i.source]).sort(), [['import-quotidien/catalogue', 'worker'], ['import-quotidien/guide', 'ci']]);
    });
    await t('production illisible : le journal du worker est rendu ET l\'erreur est dite (jamais « tout va bien » par silence)', async () => {
        const r = await J.lireJournauxImports({ cartes: baseFactice({ collecte_images_etat: [imp('guide', '2026-10-17T05:03:25Z')] }), prod: baseFactice({}, { casse: true }) });
        assert.equal(r.imports.length, 1);
        assert.match(String(r.erreurProd), /lecture refusée/);
    });
    await t('production absente (null) : l\'absence est dite, pas un silence', async () => {
        const r = await J.lireJournauxImports({ cartes: baseFactice({ collecte_images_etat: [] }), prod: null });
        assert.match(String(r.erreurProd), /production non ouverte/);
    });
    await t('les alertes d\'import ACTIVES de la CI remontent ; une alerte levée non', async () => {
        const prod = baseFactice({ imports_ci_etat: [alerte('guide'), alerte('catalogue', { active: false })] });
        const r = await J.lireJournauxImports({ cartes: baseFactice({}), prod });
        assert.deepEqual(r.alertes.map(a => a._id), ['alerte/import-guide']);
    });
    await t('une alerte active d\'un côté et levée de l\'autre : la plus récente décide', async () => {
        const cartes = baseFactice({ collecte_images_etat: [alerte('guide', { constateLe: d('2026-10-17T05:00:00Z') })] });
        const prod = baseFactice({ imports_ci_etat: [alerte('guide', { active: false, constateLe: d('2026-10-24T05:00:00Z') })] });
        assert.equal((await J.lireJournauxImports({ cartes, prod })).alertes.length, 0);
    });
    await t('importEnCours : un import « en cours » de la CI depuis moins de 45 min est du travail ; au-delà, non', async () => {
        const maintenant = d('2026-10-24T09:00:00Z');
        assert.equal(J.importEnCours([{ ...imp('guide', '2026-10-24T08:30:00Z'), enCours: true }], maintenant), true);
        assert.equal(J.importEnCours([{ ...imp('guide', '2026-10-24T07:00:00Z'), enCours: true }], maintenant), false);
        assert.equal(J.importEnCours([imp('guide', '2026-10-24T08:59:00Z')], maintenant), false);
    });
    await t('ligneImport : la date du dernier passage, le résultat, le jour de l\'import ET la source sont dits', async () => {
        const l = J.ligneImport({ ...imp('guide', '2026-10-24T08:30:24.037Z'), source: 'ci' }, d('2026-10-24T09:00:00Z'));
        assert.match(l, /import quotidien guide/);
        assert.match(l, /dernier passage 2026-10-24T08:30:24\.037Z/);
        assert.match(l, /importe \(code 0\)/);
        assert.match(l, /dernier import 2026-10-24/);
        assert.match(l, /source ci/);
    });
    await t('ligneImport : un import « en cours » depuis plus de 45 min est dit interrompu', async () => {
        const l = J.ligneImport({ ...imp('guide', '2026-10-24T07:00:00Z'), enCours: true, source: 'ci' }, d('2026-10-24T09:00:00Z'));
        assert.match(l, /interrompu/);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
