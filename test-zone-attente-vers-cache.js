// Banc de collecte-cartes/zone-attente-vers-cache.js et de zone-attente-vers-cache.js (ligne de commande) : des dossiers TEMPORAIRES fabriqués, aucun dossier du testeur, aucun réseau.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const sharp = require('sharp');
const Z = require('./collecte-cartes/zone-attente-vers-cache');
const HOTE = require('./collecte-cartes/recolte-hote');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const png = async c => sharp({ create: { width: 50, height: 70, channels: 3, background: c } }).png().toBuffer();
const frais = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zav-')); const zone = path.join(d, 'zone'), cache = path.join(d, 'CACHE'); fs.mkdirSync(zone); fs.mkdirSync(cache); return { d, zone, cache }; };
const deposer = async (zone, nom, couleur, url) => { const b = await png(couleur); fs.writeFileSync(path.join(zone, nom), b); fs.writeFileSync(path.join(zone, nom + '.provenance.json'), JSON.stringify({ urlPage: 'https://exemple.test/page', urlImage: url, date: '2026-10-31T22:12:37.213Z', largeur: 50, hauteur: 70 })); return b; };
const U = n => `https://img.exemple.test/a/${n}.png?x=1`;

(async () => {
    await t('lireDossier : une entrée par image portant sa provenance (adresse, date) ; les fichiers sans provenance sont refusés et nommés', async () => {
        const { zone } = frais(); await deposer(zone, '001.png', '#ff0000', U(1)); fs.writeFileSync(path.join(zone, 'orpheline.png'), await png('#00ff00'));
        const r = Z.lireDossier(zone);
        assert.strictEqual(r.entrees.length, 1); assert.strictEqual(r.entrees[0].url, U(1)); assert.strictEqual(r.entrees[0].fichier, path.join(zone, '001.png'));
        assert.strictEqual(r.refus.length, 1); assert.match(r.refus[0].raison, /provenance/);
    });
    await t('planifier : une image neuve est « a-ecrire », avec son sha256 et son nom de cache (celui de la production)', async () => {
        const { zone, cache } = frais(); const b = await deposer(zone, '001.png', '#ff0000', U(1));
        const p = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache });
        assert.strictEqual(p.aEcrire.length, 1); assert.strictEqual(p.aEcrire[0].sha256, sha(b)); assert.strictEqual(p.aEcrire[0].nom, HOTE.nomCache(U(1)));
        assert.deepStrictEqual(p.denominateurs, { entrees: 1, aEcrire: 1, dejaAuCache: 0, refusees: 0 });
    });
    await t('ecrire : la paire .json/.bin du cache partagé (statut ok, sha256, octets) ; lireDuCache la relit à l\'identique ; la zone d\'attente n\'est PAS touchée', async () => {
        const { zone, cache } = frais(); const b = await deposer(zone, '001.png', '#ff0000', U(1));
        const p = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache });
        const avant = fs.readdirSync(zone).sort();
        const r = await Z.ecrire({ plan: p, cache });
        assert.strictEqual(r.ecrites, 1); assert.strictEqual(r.relues, 1);
        const c = HOTE.lireDuCache(cache, U(1));
        assert.ok(c && c.octets.equals(b)); assert.strictEqual(c.meta.statut, 'ok'); assert.strictEqual(c.meta.sha256, sha(b)); assert.strictEqual(c.meta.octets, b.length); assert.strictEqual(c.meta.url, U(1));
        assert.deepStrictEqual(fs.readdirSync(zone).sort(), avant);
        assert.ok(fs.existsSync(path.join(zone, '001.png')));
    });
    await t('idempotent : relancé, rien n\'est réécrit (déjà au cache, même sha256)', async () => {
        const { zone, cache } = frais(); await deposer(zone, '001.png', '#ff0000', U(1));
        await Z.ecrire({ plan: await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache }), cache });
        const p2 = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache });
        assert.strictEqual(p2.aEcrire.length, 0); assert.strictEqual(p2.denominateurs.dejaAuCache, 1);
    });
    await t('NON : une adresse déjà au cache avec D\'AUTRES octets n\'est JAMAIS écrasée (refus nommé)', async () => {
        const { zone, cache } = frais(); await deposer(zone, '001.png', '#ff0000', U(1));
        fs.writeFileSync(path.join(cache, HOTE.nomCache(U(1)).replace(/\.json$/, '.bin')), await png('#0000ff'));
        fs.writeFileSync(path.join(cache, HOTE.nomCache(U(1))), JSON.stringify({ url: U(1), statut: 'ok', sha256: sha(await png('#0000ff')) }));
        const p = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache });
        assert.strictEqual(p.aEcrire.length, 0); assert.strictEqual(p.refus.length, 1); assert.match(p.refus[0].raison, /écras|autres octets/);
    });
    await t('NON : deux fichiers pour UNE adresse mais des octets différents — doublon refusé, aucun n\'est écrit', async () => {
        const { zone, cache } = frais(); await deposer(zone, '001.png', '#ff0000', U(1)); await deposer(zone, '002.png', '#00ff00', U(1));
        const p = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache });
        assert.strictEqual(p.aEcrire.length, 0); assert.ok(p.refus.length >= 1); assert.match(p.refus[0].raison, /même adresse/);
    });
    await t('NON : un fichier illisible (pas une image) ou vide est refusé', async () => {
        const { zone, cache } = frais(); fs.writeFileSync(path.join(zone, 'x.png'), 'pas une image'); fs.writeFileSync(path.join(zone, 'x.png.provenance.json'), JSON.stringify({ urlImage: U(9), date: '2026-10-31T00:00:00Z' }));
        fs.writeFileSync(path.join(zone, 'v.png'), ''); fs.writeFileSync(path.join(zone, 'v.png.provenance.json'), JSON.stringify({ urlImage: U(8), date: '2026-10-31T00:00:00Z' }));
        const p = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache });
        assert.strictEqual(p.aEcrire.length, 0); assert.strictEqual(p.refus.length, 2);
    });
    await t('NON : une adresse non https, ou un sha256 annoncé qui n\'est pas celui du fichier, est refusé', async () => {
        const { zone, cache } = frais(); const b = await deposer(zone, '001.png', '#ff0000', 'http://img.exemple.test/a.png');
        let p = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache }); assert.strictEqual(p.aEcrire.length, 0); assert.match(p.refus[0].raison, /https/);
        const e = [{ url: U(2), fichier: path.join(zone, '001.png'), sha256: 'a'.repeat(64) }];
        p = await Z.planifier({ entrees: e, cache }); assert.strictEqual(p.aEcrire.length, 0); assert.match(p.refus[0].raison, /sha256/);
        p = await Z.planifier({ entrees: [{ url: U(2), fichier: path.join(zone, '001.png'), sha256: sha(b) }], cache }); assert.strictEqual(p.aEcrire.length, 1);
    });
    await t('lireManifeste : la forme générique { entrees: [{ url, fichier, sha256? }] } (les 10 visuels déjà prouvés d\'un autre dossier) ; une entrée mal formée lève', async () => {
        const { zone, cache } = frais(); const b = await deposer(zone, '001.png', '#ff0000', U(1));
        const e = Z.lireManifeste({ entrees: [{ idProduct: 1, url: U(5), fichier: path.join(zone, '001.png'), sha256: sha(b) }] });
        assert.strictEqual(e.length, 1); assert.strictEqual((await Z.planifier({ entrees: e, cache })).aEcrire.length, 1);
        assert.throws(() => Z.lireManifeste({ entrees: [{ url: U(5) }] }), /fichier/);
        assert.throws(() => Z.lireManifeste({}), /entrees/);
    });
    await t('verifierArguments : écrite par ce qu\'elle AUTORISE ; --ecrire exige --attendu ; un seul mode', () => {
        assert.ok(Z.verifierArguments(['--dossier=a', '--cache=b']) == null);
        assert.ok(Z.verifierArguments(['--manifeste=a.json', '--cache=b', '--ecrire', '--attendu=3']) == null);
        assert.match(Z.verifierArguments(['--dossier=a', '--cache=b', '--ecrire']), /--attendu/);
        assert.match(Z.verifierArguments(['--cache=b']), /--dossier|--manifeste/);
        assert.match(Z.verifierArguments(['--dossier=a', '--manifeste=b.json', '--cache=c']), /un seul/);
        assert.match(Z.verifierArguments(['--dossier=a', '--cache=b', '--supprimer']), /argument inconnu/);
        assert.match(Z.verifierArguments(['--dossier=a']), /--cache/);
    });
    await t('executer : simulation par défaut (rien d\'écrit) ; --ecrire --attendu=N juste écrit ; un attendu faux n\'écrit RIEN', async () => {
        const { zone, cache } = frais(); await deposer(zone, '001.png', '#ff0000', U(1)); await deposer(zone, '002.png', '#00ff00', U(2));
        const sortie = [], log = l => sortie.push(l);
        assert.strictEqual(await Z.executer({ argv: [`--dossier=${zone}`, `--cache=${cache}`], log, err: log }), 0);
        assert.strictEqual(fs.readdirSync(cache).length, 0);
        assert.strictEqual(await Z.executer({ argv: [`--dossier=${zone}`, `--cache=${cache}`, '--ecrire', '--attendu=5'], log, err: log }), 1);
        assert.strictEqual(fs.readdirSync(cache).length, 0);
        assert.strictEqual(await Z.executer({ argv: [`--dossier=${zone}`, `--cache=${cache}`, '--ecrire', '--attendu=2'], log, err: log }), 0);
        assert.strictEqual(fs.readdirSync(cache).length, 4);
    });
    await t('NON : une fiche de cache existante SANS octets (absence, pause) n\'est jamais écrasée', async () => {
        const { zone, cache } = frais(); await deposer(zone, '001.png', '#ff0000', U(1));
        fs.writeFileSync(path.join(cache, HOTE.nomCache(U(1))), JSON.stringify({ url: U(1), statut: 'absent' }));
        const p = await Z.planifier({ entrees: Z.lireDossier(zone).entrees, cache });
        assert.strictEqual(p.aEcrire.length, 0); assert.match(p.refus[0].raison, /fiche de cache existe/);
    });
    await t('executer : un lot avec UN refus n\'écrit rien, même avec le bon --attendu (le lot est EXACTEMENT celui de la simulation)', async () => {
        const { zone, cache } = frais(); await deposer(zone, '001.png', '#ff0000', U(1)); fs.writeFileSync(path.join(zone, 'sans-provenance.png'), await png('#00ff00'));
        const l = () => {};
        assert.strictEqual(await Z.executer({ argv: [`--dossier=${zone}`, `--cache=${cache}`, '--ecrire', '--attendu=1'], log: l, err: l }), 1);
        assert.strictEqual(fs.readdirSync(cache).length, 0);
    });
    await t('executer : un cache qui ne s\'appelle pas « CACHE » est refusé (rien n\'est écrit)', async () => {
        const { d, zone } = frais(); const autre = path.join(d, 'AUTRE'); fs.mkdirSync(autre); await deposer(zone, '001.png', '#ff0000', U(1));
        const l = () => {};
        assert.strictEqual(await Z.executer({ argv: [`--dossier=${zone}`, `--cache=${autre}`, '--ecrire', '--attendu=1'], log: l, err: l }), 2);
        assert.strictEqual(fs.readdirSync(autre).length, 0);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
