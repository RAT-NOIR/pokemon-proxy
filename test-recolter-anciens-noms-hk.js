// Banc de recolter-anciens-noms-hk.js : le script de bout en bout avec le VRAI client poli et un transport factice (aucun réseau, aucune base). La page servie est l'extrait RÉEL de Pikachu.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./recolter-anciens-noms-hk');
const A = require('./collecte-cartes/anciens-noms-hk');
const PIKACHU = fs.readFileSync(path.join(__dirname, 'fixtures-anciens-noms-hk', '52poke-025-pikachu.html'), 'utf8');
const ROBOTS = 'User-agent: *\nDisallow: /index.php\nDisallow: /wiki/Special:\nCrawl-delay: 500\n';
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.message).split('\n')[0]); } };
const frais = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rahk-'));
    const especes = path.join(d, 'jalon.json');
    fs.writeFileSync(especes, JSON.stringify({ especes: [{ dex: 25, en: 'Pikachu', labels: { 'zh-hans': '皮卡丘' } }, { dex: 26, en: 'Raichu', labels: { 'zh-hans': '雷丘' } }] }));
    return { d, sortie: path.join(d, 'sortie'), especes, pauses: path.join(d, 'pauses') };
};
const transport = (appels, { robots = ROBOTS, statutPage = 200 } = {}) => ({ async get(url) {
    appels.push(url);
    if (url.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: robots };
    return statutPage === 200 ? { status: 200, type: 'text/html; charset=UTF-8', texte: PIKACHU } : { status: statutPage, type: 'text/html', texte: 'interdit' };
} });
const lancer = (f, extra = [], dep = {}) => R.main(['--source=52poke', `--sortie=${f.sortie}`, `--especes=${f.especes}`, ...extra], { dossierPauses: f.pauses, ...dep });

(async () => {
    await t('un argument inconnu, ou ni --source ni --croiser -> 2 avant toute requête', async () => {
        const appels = [], f = frais();
        assert.strictEqual(await R.main(['--source=52poke', '--x=1', `--sortie=${f.sortie}`], { transport: transport(appels), dossierPauses: f.pauses }), 2);
        assert.strictEqual(await R.main([`--sortie=${f.sortie}`], { transport: transport(appels), dossierPauses: f.pauses }), 2);
        assert.strictEqual(appels.length, 0);
    });
    await t('bout en bout : robots (Crawl-delay 500 s) lu, cadence de 500 s entre deux requêtes, n° lu SUR la page ; la page dont le n° n\'est pas celui attendu est REFUSÉE (code 5)', async () => {
        const appels = [], pauses = [], f = frais();
        const code = await lancer(f, [], { transport: transport(appels), pause: async ms => { pauses.push(ms); } });
        assert.strictEqual(code, 5);   // « 雷丘 » est servie avec la page de Pikachu (n° 25 ≠ 26) : refusée
        const s = JSON.parse(fs.readFileSync(path.join(f.sortie, 'source-52poke.json'), 'utf8'));
        assert.deepStrictEqual(s.parDex, { 25: ['皮卡丘', '比卡超'] });
        assert.strictEqual(s.licence, 'CC BY-NC-SA 3.0');
        assert.strictEqual(s.pages[1].ok, false);
        assert.match(s.pages[1].raison, /n° 25, pas 26/);
        assert.strictEqual(appels.length, 3);   // robots + 2 pages
        assert.ok(pauses.some(ms => ms >= 499000 && ms <= 500000), 'une pause de ~500 s entre deux requêtes : ' + JSON.stringify(pauses));
    });
    await t('reprise : un second lancement ne redemande rien (cache), mêmes résultats', async () => {
        const appels = [], f = frais();
        await lancer(f, [], { transport: transport(appels), pause: async () => {} });
        const avant = appels.length;
        const code = await lancer(f, [], { transport: transport(appels), pause: async () => {} });
        assert.strictEqual(code, 5);
        assert.strictEqual(appels.length, avant);
    });
    await t('CADENCE ENTRE PROCESSUS : une requête réseau du journal vieille de 100 s fait attendre ~400 s avant la suivante (le client seul ne le saurait pas)', async () => {
        const appels = [], pauses = [], f = frais();
        fs.mkdirSync(f.sortie, { recursive: true });
        fs.writeFileSync(path.join(f.sortie, 'journal-requetes.jsonl'), JSON.stringify({ le: new Date(Date.now() - 100000).toISOString(), hote: 'wiki.52poke.com', chemin: '/wiki/x', status: 200 }) + '\n');
        await lancer(f, [], { transport: transport(appels), pause: async ms => { pauses.push(ms); } });
        assert.ok(pauses[0] >= 399000 && pauses[0] <= 400000, 'première pause ~400 s : ' + JSON.stringify(pauses));
    });
    await t('un robots.txt dont le Crawl-delay dépasse la cadence prévue n\'est pas contourné : le client refuse (code 4), aucune page demandée', async () => {
        const appels = [], f = frais();
        const code = await lancer(f, [], { transport: transport(appels, { robots: 'User-agent: *\nCrawl-delay: 900\n' }), pause: async () => {} });
        assert.strictEqual(code, 4);
        assert.strictEqual(appels.length, 1);
    });
    await t('un robots.txt qui interdit /wiki/ -> aucune page demandée', async () => {
        const appels = [], f = frais();
        const code = await lancer(f, [], { transport: transport(appels, { robots: 'User-agent: *\nDisallow: /wiki/\nCrawl-delay: 500\n' }), pause: async () => {} });
        assert.notStrictEqual(code, 0);
        assert.strictEqual(appels.filter(u => !u.endsWith('/robots.txt')).length, 0);
    });
    await t('un 403 sur une page = ARRÊT D\'HÔTE écrit (code 3) ; le lancement suivant n\'envoie AUCUNE requête (code 3)', async () => {
        const appels = [], f = frais();
        const c1 = await lancer(f, [], { transport: transport(appels, { statutPage: 403 }), pause: async () => {} });
        assert.strictEqual(c1, 3);
        assert.ok(fs.readdirSync(f.pauses).some(n => /ARRET-HOTE-wiki\.52poke\.com/.test(n)));
        const avant = appels.length;
        assert.strictEqual(await lancer(f, [], { transport: transport(appels), pause: async () => {} }), 3);
        assert.strictEqual(appels.length, avant);
    });
    await t('--croiser : une seule source -> aucun nom admis (fichier écrit, entrées vides) ; avec les deux sources concordantes -> 比卡超 admis avec ses deux provenances', async () => {
        const f = frais(); fs.mkdirSync(f.sortie, { recursive: true });
        fs.writeFileSync(path.join(f.sortie, 'source-52poke.json'), JSON.stringify({ source: '52poke', licence: 'CC BY-NC-SA 3.0', luLe: '2026-10-31', parDex: { 25: ['比卡超'] } }));
        assert.strictEqual(await R.main(['--croiser', `--sortie=${f.sortie}`]), 0);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(f.sortie, 'anciens-noms-hk.json'), 'utf8')).entrees, []);
        fs.writeFileSync(path.join(f.sortie, 'source-zhwiki.json'), JSON.stringify({ source: 'zhwiki', licence: 'CC BY-SA 4.0', luLe: '2026-10-31', parDex: { 25: ['比卡超'] } }));
        assert.strictEqual(await R.main(['--croiser', `--sortie=${f.sortie}`]), 0);
        const j = JSON.parse(fs.readFileSync(path.join(f.sortie, 'anciens-noms-hk.json'), 'utf8'));
        assert.strictEqual(A.lireAnciensNomsHk(j).table['比卡超'], 'D25');
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
