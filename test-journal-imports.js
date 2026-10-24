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
    // ---- tour de correction 1 ----
    await t('A-1 verdict : journal de la CI illisible + rien n\'écrit -> JAMAIS « FILE À L\'ARRÊT » : état inconnu, sortie 2, et le message le dit', async () => {
        const v = J.verdictFile({ bouge: false, erreurProd: 'lecture refusée', fraisMin: 3, verrouGlobal: false });
        assert.equal(v.etat, 'inconnu');
        assert.equal(v.code, 2);
        assert.ok(!/✅/.test(v.message) && !/À L'ARRÊT/.test(v.message), v.message);
        assert.match(v.message, /INCONNU/);
        assert.match(v.message, /lecture refusée/);
    });
    await t('A-1 verdict : journal lu + rien n\'écrit -> à l\'arrêt, sortie 0 (le cas normal reste vert)', async () => {
        const v = J.verdictFile({ bouge: false, erreurProd: null, fraisMin: 3, verrouGlobal: true });
        assert.equal(v.etat, 'arret'); assert.equal(v.code, 0);
        assert.match(v.message, /FILE À L'ARRÊT/); assert.match(v.message, /verrou global/);
    });
    await t('A-1 verdict : quelque chose écrit -> « LA FILE ÉCRIT », sortie 1, journal lu ou non (écrire est un fait connu)', async () => {
        for (const erreurProd of [null, 'x']) {
            const v = J.verdictFile({ bouge: true, erreurProd, fraisMin: 3, verrouGlobal: false });
            assert.equal(v.etat, 'ecrit'); assert.equal(v.code, 1); assert.match(v.message, /LA FILE ÉCRIT/);
        }
    });
    await t('A-2 alerte : la levée (resolueLe) plus tardive que la constatation l\'emporte, même si le côté qui la porte garde un constateLe ancien', async () => {
        const cartes = baseFactice({ collecte_images_etat: [alerte('guide', { constateLe: d('2026-10-20T05:00:00Z'), depuis: d('2026-10-20T05:00:00Z') })] });
        const prod = baseFactice({ imports_ci_etat: [alerte('guide', { active: false, constateLe: d('2026-10-19T05:00:00Z'), depuis: d('2026-10-19T05:00:00Z'), resolueLe: d('2026-10-24T09:00:00Z') })] });
        assert.equal((await J.lireJournauxImports({ cartes, prod })).alertes.length, 0);
    });
    await t('A-2 alerte : une alerte levée puis RÉOUVERTE (constateLe plus tardif que resolueLe) reste active', async () => {
        const cartes = baseFactice({});
        const prod = baseFactice({ imports_ci_etat: [alerte('guide', { active: true, resolueLe: d('2026-10-22T09:00:00Z'), constateLe: d('2026-10-24T05:00:00Z') })] });
        assert.equal((await J.lireJournauxImports({ cartes, prod })).alertes.length, 1);
    });
    await t('A-3 égalité de dernierEssai entre les deux journaux : la CI l\'emporte (échoue si l\'ordre des sources est inversé)', async () => {
        const cartes = baseFactice({ collecte_images_etat: [imp('guide', '2026-10-24T08:30:24Z', { dernierResultat: 'depuis-worker' })] });
        const prod = baseFactice({ imports_ci_etat: [imp('guide', '2026-10-24T08:30:24Z', { dernierResultat: 'depuis-ci' })] });
        const r = await J.lireJournauxImports({ cartes, prod });
        assert.equal(r.imports.length, 1);
        assert.equal(r.imports[0].source, 'ci');
        assert.equal(r.imports[0].dernierResultat, 'depuis-ci');
    });
    await t('A-4 erreurProd est masquée comme le fait imports-cardmarket-ci (une fin d\'URI sans préfixe ne fuit pas)', async () => {
        const prod = baseFactice({}, { casse: false });
        prod.collection = () => ({ find: () => ({ toArray: async () => { throw new Error('échec sur u:MOTDEPASSE-SECRET@cluster0.abcde.mongodb.net/test'); } }) });
        const r = await J.lireJournauxImports({ cartes: baseFactice({}), prod });
        assert.ok(r.erreurProd && !/MOTDEPASSE-SECRET/.test(r.erreurProd), r.erreurProd);
    });
    await t('A-4 le module réutilise masquerSecrets de imports-cardmarket-ci.js (pas de copie)', async () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, 'collecte-cartes', 'journal-imports.js'), 'utf8');
        assert.match(src, /require\('\.\.\/imports-cardmarket-ci'\)/);
        assert.ok(!/function masquerSecrets/.test(src));
    });
    const srcOutil = () => require('fs').readFileSync(require('path').join(__dirname, 'file-a-l-arret.js'), 'utf8');
    await t('A-5 file-a-l-arret.js s\'ouvre en lectureSeule (la garde d\'écriture ne doit pas bloquer un outil qui n\'écrit pas) ET n\'écrit nulle part', async () => {
        const s = srcOutil();
        assert.match(s, /ouvrirConnexions\(\{[^}]*lectureSeule:\s*true[^}]*\}\)/);
        assert.ok(!/\.(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndDelete|drop)\(|\$out|\$merge/.test(s), 'une écriture est apparue dans l\'outil');
    });
    await t('A-1 file-a-l-arret.js décide par verdictFile et masque son .catch final', async () => {
        const s = srcOutil();
        assert.match(s, /verdictFile\(/);
        assert.match(s, /masquerSecrets/);
        assert.ok(!/console\.error\(e\)/.test(s), 'le .catch final imprime encore l\'erreur brute');
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
