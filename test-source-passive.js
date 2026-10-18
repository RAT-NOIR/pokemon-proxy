// Banc de la PARTIE 1 du lot P2 : le worker ne contacte plus PikaQian, par aucun chemin. Faux réseau qui ÉCHOUE au premier appel vers un hôte PikaQian
// (pikaqian.com, images.pikaqian.com, cdn.pokemon-tcg.cn) ; états fabriqués : unité en attente, alerte échue, alimentateur avec des trous PikaQian.
require('./bancs-dossier-arrets');      // les arrêts et pauses durables d'hôtes : un dossier TEMPORAIRE, jamais le vrai (correction 2, M1)
const assert = require('assert');
const fs = require('fs');

let ok = 0, ko = 0;
async function t(nom, f) { try { await f(); ok++; console.log('  ok   ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + (e && e.message)); } }

// ── le faux réseau : tout appel vers un hôte PikaQian est une faute, et il est compté ──
const HOTES = /(^|\.)pikaqian\.com$|(^|\.)pokemon-tcg\.cn$/i;
const appelsInterdits = [];
const hoteDe = u => { try { return new URL(typeof u === 'string' ? u : u?.url ?? String(u)).hostname; } catch { return ''; } };
const reseau = async (url) => {
    if (HOTES.test(hoteDe(url))) { appelsInterdits.push(String(url)); throw new Error('RÉSEAU INTERDIT : ' + url); }
    throw new Error('requête inattendue : ' + url);
};
global.fetch = reseau;

const SP = require('./collecte-cartes/source-passive');
const S = require('./collecte-cartes/sources-en-service');
const P = require('./collecte-cartes/pikaqian');
const R = require('./collecte-cartes/reessai-pikaqian');
const A = require('./collecte-cartes/alimentateur');
const HEURE = 3600 * 1000;
const T1 = Date.parse('2026-10-12T02:14:33Z');
const ECHUE = Date.parse('2026-10-13T18:53:59Z') + 1000;     // la tentative automatique prévue, échue
const ALERTE_ECHUE = () => ({ _id: P.ID_ALERTE, active: true, depuis: new Date(T1), constateLe: new Date(T1), status: 403, motif: 'pikaqian BLOQUÉ (HTTP 403) sur https://pikaqian.com/robots.txt', blocages: [{ le: T1, url: 'https://pikaqian.com/robots.txt', status: 403 }], pasAvant: Date.parse('2026-10-13T18:53:59Z'), dernierEssai: null });

(async () => {
    console.log('la décision a une seule adresse');
    await t('pikaqian n\'est plus dans SOURCES_EN_SERVICE ; elle est passive, motif écrit', () => {
        assert.strictEqual(S.enService('pikaqian'), false);
        assert.ok(!S.SOURCES_EN_SERVICE.has('pikaqian'));
        assert.strictEqual(SP.estPassive('pikaqian'), true);
        assert.strictEqual(SP.motifPassif('pikaqian'), 'source passive : visites du testeur seulement');
        assert.strictEqual(SP.estPassive('tcgdex'), false);
        assert.strictEqual(S.enService('artofpkm'), true); assert.strictEqual(S.enService('tcgdex'), true);
    });

    console.log('le worker : tâches espacées et sonde');
    await t('alerte ÉCHUE (18:53:59 passée) : passerLesTaches ne fait AUCUNE requête ni lecture de base', async () => {
        let lectures = 0;
        const db = { collection: () => { lectures++; return { findOne: async () => ALERTE_ECHUE(), findOneAndUpdate: async () => ({ _id: 'x' }), updateOne: async () => { }, find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }), toArray: async () => [] }) }; } };
        const r = await R.passerLesTaches(db, { journal: { log() { }, error() { } }, maintenant: () => ECHUE });
        assert.strictEqual(appelsInterdits.length, 0, appelsInterdits.join(','));
        assert.strictEqual(r.pikaqian.envoye, false); assert.strictEqual(r.sonde.envoye, false);
        assert.strictEqual(lectures, 0);
    });
    await t('même si on la déclare EN SERVICE de force (enService injecté) : la machine ne part pas et la sonde du CDN non plus', async () => {
        let lectures = 0;
        const db = { collection: () => { lectures++; return { findOne: async () => ALERTE_ECHUE(), findOneAndUpdate: async () => ({ _id: 'x' }), updateOne: async () => { throw new Error('écriture'); }, find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }), toArray: async () => [] }) }; } };
        const r = await R.passerLesTaches(db, { enService: () => true, journal: { log() { }, error() { } }, maintenant: () => ECHUE });
        assert.strictEqual(appelsInterdits.length, 0, appelsInterdits.join(','));
        assert.strictEqual(lectures, 0, 'estPassive de passerLesTaches : aucune lecture de base non plus');
        assert.strictEqual(r.pikaqian.envoye, false); assert.strictEqual(r.sonde.envoye, false);
    });
    await t('la machine d\'espacement, fabriquée SANS `allume`, ne part pas sur une alerte échue (fermée par défaut)', async () => {
        let n = 0;
        const magasin = { lire: async () => ALERTE_ECHUE(), reserver: async () => true, ecrire: async () => { } };
        const e = R.fabriquerEssai({ client: async () => { n++; return {}; }, magasin, maintenant: () => ECHUE });
        const r = await e.essayer();
        assert.strictEqual(r.envoye, false); assert.strictEqual(n, 0);
    });
    await t('noterBlocage ne programme plus aucune tentative : pasAvant reste null, aux trois blocages comme au premier', async () => {
        const docs = new Map();
        const c = { findOne: async f => (docs.get(f._id) ? structuredClone(docs.get(f._id)) : null), updateOne: async (f, u) => { const d = docs.get(f._id) ?? { _id: f._id }; Object.assign(d, structuredClone(u.$set)); docs.set(f._id, d); } };
        for (let i = 0; i < 3; i++) { await R.noterBlocage(c, { motif: 'm', status: 403 }, T1 + i * HEURE); assert.strictEqual(docs.get(P.ID_ALERTE).pasAvant, null, `après le blocage n°${i + 1}`); }
        assert.strictEqual(docs.get(P.ID_ALERTE).blocages.length, 3);
    });
    await t('la sonde du CDN ferme son transport : sans transport injecté, une adresse en base ne produit AUCUN appel (robots.txt compris)', async () => {
        const S2 = require('./collecte-cartes/sonde-cdn-pokemon-tcg');
        const docs = new Map();
        const E = { findOne: async f => docs.get(f._id) ?? null, insertOne: async d => { docs.set(d._id, structuredClone(d)); }, updateOne: async (f, u) => { Object.assign(docs.get(f._id), structuredClone(u.$set)); }, findOneAndUpdate: async () => null };
        const sonde = S2.fabriquerSonde({ E, trouverAdresses: async () => ['https://cdn.pokemon-tcg.cn/cards/0123456789abcdef0123456789abcdef.png'], pause: async () => { } });
        const r = await sonde.executer();
        assert.strictEqual(appelsInterdits.length, 0, appelsInterdits.join(','));
        assert.ok(/passive/.test(JSON.stringify(r) + JSON.stringify([...docs.values()])), 'la fermeture est écrite : ' + JSON.stringify(r));
    });

    console.log('l\'alerte n\'annonce plus de « prochaine tentative »');
    await t('la phrase de file-a-l-arret pour l\'alerte pikaqian dit « source passive », jamais « prochaine tentative »', () => {
        const phrase = SP.phraseAlerte(ALERTE_ECHUE());
        assert.ok(/source passive/.test(phrase), phrase); assert.ok(!/prochaine tentative/.test(phrase), phrase);
        const autre = SP.phraseAlerte({ _id: 'alerte/source-bloquee/tpc-asie', active: true, pasAvant: 5 });
        assert.strictEqual(autre, null, 'une autre alerte garde sa phrase d\'origine');
        const src = fs.readFileSync(require.resolve('./file-a-l-arret.js'), 'utf8');
        assert.ok(/phraseAlerte\(/.test(src), 'file-a-l-arret.js appelle phraseAlerte');
        // tour 2 : plus aucune phrase « prochaine tentative » en REPLI (aucune tentative n'est programmée, pour aucune source)
        assert.ok(!/prochaine tentative au plus tôt/.test(src.replace(/^\s*\/\/.*$/gm, '')), 'le repli ne promet plus de prochaine tentative');
        assert.ok(/aucune tentative automatique/.test(src), 'le repli le dit');
    });

    console.log('l\'unité déjà en file');
    await t('une unité pikaqian en attente se clôt avec le motif écrit : refusée, aucune requête', async () => {
        const f = { journal: [], updateOne: async (flt, upd) => { f.journal.push([flt, upd]); } };
        const r = await SP.cloreUnitePassive(f, { _id: 'pikaqian/Dynamax-Clash-Flame', source: 'pikaqian', etat: 'en-cours' }, new Date(0));
        assert.strictEqual(r.resultat, 'refuse-source-passive');
        const [flt, upd] = f.journal[0]; assert.deepStrictEqual(flt, { _id: 'pikaqian/Dynamax-Clash-Flame' });
        assert.strictEqual(upd.$set.etat, 'refuse'); assert.strictEqual(upd.$set.erreur, 'source passive : visites du testeur seulement'); assert.ok('pris' in upd.$unset);
        assert.strictEqual(appelsInterdits.length, 0);
        await assert.rejects(() => SP.cloreUnitePassive(f, { _id: 'x', source: 'tcgdex' }), /pas une source passive/);
    });
    await t('le worker aiguille une unité passive vers cloreUnitePassive AVANT toute branche de collecte', () => {
        const src = fs.readFileSync(require.resolve('./collecteur-images.js'), 'utf8');
        const i = src.indexOf('estPassive(sourceDuSet)'), j = src.indexOf("sourceDuSet === 'pikaqian'"), k = src.indexOf("if (sourceDuSet === 'bulbapedia')");
        assert.ok(i > 0, 'le worker lit estPassive'); assert.ok(i < k && i < j, 'avant les branches');
        assert.ok(/cloreUnitePassive\(File, suivant\)/.test(src));
    });
    await t('collecterSet appelé SANS client injecté (la voie du worker) refuse avant toute lecture de base ou requête', async () => {
        const C = require('./collecteur-images-pikaqian');
        const M = { Carte: { db: { get db() { throw new Error('la base n\'aurait pas dû être lue'); } } } };
        const r = await C.collecterSet({ _id: 'pikaqian/Dynamax-Clash-Flame', source: 'pikaqian', slugSet: 'Dynamax-Clash-Flame', code: 'CS1bC', codePk: 'cs1bc', langue: 'zh-hans' }, M, { verrou: { tenu: true, perdu: false } });
        assert.strictEqual(r.etat, 'refuse-source-passive'); assert.strictEqual(r.sansJointure, true);
        assert.strictEqual(appelsInterdits.length, 0);
    });
    await t('le client PikaQian réel (transport par défaut) refuse chaque requête : le faux réseau n\'est même pas appelé', async () => {
        const c = P.fabriquerClientPikaqian({ verrou: { tenu: true, perdu: false }, pause: async () => { } });
        await assert.rejects(() => c.page('https://pikaqian.com/sets/cs1bc'), /source passive/);
        const c2 = P.fabriquerClientPikaqian({ verrou: { tenu: true, perdu: false }, pause: async () => { } });
        await assert.rejects(() => c2.image('https://images.pikaqian.com/cs1bc/0d0e0f10-1111-4222-8333-444455556666.webp'), /source passive/);
        assert.strictEqual(appelsInterdits.length, 0);
    });

    console.log('l\'alimentateur et l\'enfilage');
    await t('alimentateur : des trous zh-hans / PikaQian ne produisent aucune unité pikaqian (règle par set ET sources officielles)', () => {
        const lignes = { 'Sparkling-Fable': { code: 'CSV1C', slugSet: 'Sparkling-Fable', bulba: { tirage: 'zh-hans' }, region: 'intl' } };
        const R1 = A.choisirUnites({ manques: [{ slug: 'Sparkling-Fable', n: 300, sans: 300 }], ligneDe: s => lignes[s] || null, sourceArtofpkm: () => false, setTcgdex: () => null, unites: new Map(), texteFini: () => null });
        assert.strictEqual(R1.inserer.length + R1.reprendre.length, 0);
        const table = [{ site: 'pikaqian', slug: 'Dynamax-Clash-Flame', code: 'CS1bC', langue: 'zh-hans', trous: 199 }];
        const R2 = A.choisirUnitesTpc({ table, unites: new Map(), max: 10, bloquees: new Set() });
        assert.strictEqual(R2.inserer.length + R2.reprendre.length, 0);
    });
    await t('enfiler-pikaqian : plus aucune unité ne s\'insère ni ne se reprend (« source passive »), même avec une table pleine', () => {
        const E = require('./enfiler-pikaqian');
        const { TABLE_PIKAQIAN } = require('./collecte-cartes/pikaqian-sets');
        const a = E.choisirUnitesPikaqian({ unites: new Map(), voulus: null });
        assert.strictEqual(a.inserer.length, 0); assert.strictEqual(a.repris.length, 0); assert.ok(a.ecartes.some(x => /source passive/.test(x.raison)));
        const slug = TABLE_PIKAQIAN[0].slug;
        const b = E.choisirUnitesPikaqian({ unites: new Map([[`pikaqian/${slug}`, { etat: 'refuse', resultat: 'refuse-source-bloquee' }]]), voulus: [slug], reprendre: true });
        assert.strictEqual(b.inserer.length + b.repris.length, 0);
    });

    console.log('fichiers de REGLES touchés');
    await t('les fichiers que le worker lit et qui portent la règle sont dans REGLES (la garde du commit les surveille)', () => {
        const { REGLES } = require('./remettre-en-file');
        for (const f of ['collecte-cartes/source-passive.js', 'collecte-cartes/sources-en-service.js', 'collecte-cartes/reessai-pikaqian.js', 'collecte-cartes/pikaqian.js', 'collecteur-images-pikaqian.js', 'collecteur-images.js'])
            assert.ok(REGLES.includes(f), f + ' absent de REGLES');
    });

    assert.strictEqual(appelsInterdits.length, 0, 'AUCUN appel vers un hôte PikaQian sur tout le banc : ' + appelsInterdits.join(','));
    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko}) · appels vers un hôte PikaQian : ${appelsInterdits.length}`);
    process.exit(ko ? 1 : 0);
})();
