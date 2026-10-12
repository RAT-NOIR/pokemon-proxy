// Banc du réessai espacé de PikaQian (décision du testeur, 2026-10-12) : « au moins 6 h, puis 24 h, en s'identifiant honnêtement ; trois blocages,
// et la source est suspendue ». Aucun réseau : faux client, fausse horloge, faux magasin, fausse file.
const assert = require('assert');
const fs = require('fs');
const R = require('./collecte-cartes/reessai-pikaqian');
const P = require('./collecte-cartes/pikaqian');

let ok = 0, ko = 0;
async function t(nom, f) { try { await f(); ok++; console.log('  ok   ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + (e && e.message)); } }

const HEURE = 3600 * 1000;
const T1 = Date.parse('2026-10-12T02:14:33Z');           // le blocage n°1 : celui de l'alerte déjà en base
const H = o => ({ get: k => o[String(k).toLowerCase()] ?? null });
const rep = (status, h = {}, texte = '') => ({ status, headers: H(h), texte });
const ROBOTS = 'User-agent: *\nDisallow: /api/\nDisallow: /admin/\n';
const SERVI = rep(200, { 'content-type': 'text/plain; charset=utf-8', server: 'cloudflare' }, ROBOTS);
const DEFI = rep(403, { server: 'cloudflare', 'cf-mitigated': 'challenge', 'cf-ray': 'x' }, '<html>Just a moment...</html>');
const LEGACY = () => ({ _id: P.ID_ALERTE, active: true, depuis: new Date(T1), constateLe: new Date(T1), motif: "pikaqian BLOQUÉ (HTTP 403, cf-mitigated challenge) sur https://pikaqian.com/robots.txt — on s'arrête, plus aucune requête", status: 403, unite: 'pikaqian/Dynamax-Clash-Flame', requetes: 1 });

function banc(reponses, { doc = LEGACY(), t0 = T1 + 6 * HEURE, surServi = null } = {}) {
    const etat = { now: t0, doc, requetes: 0, ecritures: 0 };
    const file = [...reponses];
    const client = async () => { etat.requetes++; const r = file.length > 1 ? file.shift() : file[0]; if (r instanceof Error) throw r; return r; };
    const magasin = {
        lire: async () => (etat.doc ? structuredClone(etat.doc) : null),          // Mongo rend des Date, pas des chaînes
        reserver: async (lu, now) => { etat.doc = { ...etat.doc, dernierEssai: now, reserve: true }; return true; },
        ecrire: async ({ _id, ...d }) => { etat.ecritures++; etat.doc = { ...etat.doc, ...d }; }
    };
    const essai = R.fabriquerEssai({ client, magasin, maintenant: () => etat.now, surServi });
    return { etat, essai };
}

(async () => {
    console.log('lecture des blocages (en base, pas en mémoire)');
    await t('l\'alerte écrite par le collecteur (sans tableau) est le blocage n°1 : 02:14:33, robots.txt, 403', () => {
        const b = R.blocagesDe(LEGACY());
        assert.strictEqual(b.length, 1); assert.strictEqual(b[0].le, T1); assert.strictEqual(b[0].url, 'https://pikaqian.com/robots.txt'); assert.strictEqual(b[0].status, 403);
    });
    await t('un tableau `blocages` fait foi (date, adresse, statut)', () => {
        const b = R.blocagesDe({ active: true, blocages: [{ le: 5, url: 'u', status: 403 }, { le: 9, url: 'v', status: 429 }] });
        assert.deepStrictEqual(b.map(x => x.le), [5, 9]);
    });
    await t('illisible : date non finie, tableau non tableau, alerte sans date → null (on ne conclut pas)', () => {
        for (const e of [{ active: true, blocages: [{ le: 'x' }] }, { active: true, blocages: 'oui' }, { active: true }, { active: true, depuis: 'hier' }, null, [], 'x'])
            assert.strictEqual(R.blocagesDe(e), null);
    });

    console.log('calendrier : 6 h après le n°1, 24 h après le n°2, suspendue au n°3');
    await t('première tentative au plus tôt à 08:14:33 UTC : pas une requête avant, une seule à la seconde exacte', async () => {
        const b = banc([DEFI], { t0: T1 });
        for (const dt of [0, 60e3, 3 * HEURE, 6 * HEURE - 1]) { b.etat.now = T1 + dt; const r = await b.essai.essayer(); assert.strictEqual(r.envoye, false, 'dt=' + dt); }
        assert.strictEqual(b.etat.requetes, 0);
        b.etat.now = T1 + 6 * HEURE; const r = await b.essai.essayer(); assert.strictEqual(r.envoye, true); assert.strictEqual(b.etat.requetes, 1);
        assert.strictEqual(new Date(T1 + 6 * HEURE).toISOString(), '2026-10-12T08:14:33.000Z');
    });
    await t('défi à la tentative 1 = blocage n°2 (date, adresse, statut écrits) ; prochaine au plus tôt 24 h plus tard', async () => {
        const b = banc([DEFI]); const t = b.etat.now; const r = await b.essai.essayer();
        assert.strictEqual(r.verdict, 'DEFI');
        const d = b.etat.doc; assert.strictEqual(d.active, true); assert.strictEqual(d.suspendue, false);
        assert.strictEqual(d.blocages.length, 2); assert.strictEqual(d.blocages[0].le, T1); assert.strictEqual(d.blocages[1].le, t);
        assert.strictEqual(d.blocages[1].url, 'https://pikaqian.com/robots.txt'); assert.strictEqual(d.blocages[1].status, 403);
        assert.strictEqual(d.pasAvant, t + 24 * HEURE);
        b.etat.now = t + 24 * HEURE - 1; assert.strictEqual((await b.essai.essayer()).envoye, false); assert.strictEqual(b.etat.requetes, 1);
    });
    await t('défi à la tentative 2 (24 h) = blocage n°3 : SUSPENDUE, plus aucune tentative pendant un an (1000 essais)', async () => {
        const b = banc([DEFI]); await b.essai.essayer();
        b.etat.now += 24 * HEURE; await b.essai.essayer();
        const d = b.etat.doc; assert.strictEqual(b.etat.requetes, 2);
        assert.strictEqual(d.blocages.length, 3); assert.strictEqual(d.suspendue, true); assert.strictEqual(d.active, true); assert.strictEqual(d.pasAvant, null);
        for (let i = 1; i <= 1000; i++) { b.etat.now += 365 * 24 * HEURE / 1000; const r = await b.essai.essayer(); assert.strictEqual(r.envoye, false); }
        assert.strictEqual(b.etat.requetes, 2);
    });
    await t('le compteur vit en base : un redéploiement (nouvelle machine, même magasin) ne le remet pas à zéro', async () => {
        const b = banc([DEFI]); await b.essai.essayer();
        const memeMagasin = { lire: async () => structuredClone(b.etat.doc), reserver: async (l, now) => { b.etat.doc = { ...b.etat.doc, dernierEssai: now }; return true; }, ecrire: async ({ _id, ...d }) => { b.etat.doc = { ...b.etat.doc, ...d }; } };
        const neuve = R.fabriquerEssai({ client: async () => { b.etat.requetes++; return DEFI; }, magasin: memeMagasin, maintenant: () => b.etat.now });
        b.etat.now += 23 * HEURE; assert.strictEqual((await neuve.essayer()).envoye, false);
        b.etat.now += 1 * HEURE; await neuve.essayer(); assert.strictEqual(b.etat.doc.suspendue, true);
    });
    await t('Retry-After plus long que le délai : on prend le plus long', async () => {
        const b = banc([rep(429, { 'retry-after': String(3 * 24 * 3600) })]); const t = b.etat.now; await b.essai.essayer();
        assert.ok(b.etat.doc.pasAvant >= t + 3 * 24 * HEURE);
    });
    await t('429 compte comme blocage (même définition que le client : P.defi)', async () => {
        const b = banc([rep(429)]); await b.essai.essayer(); assert.strictEqual(b.etat.doc.blocages.length, 2); assert.strictEqual(b.etat.doc.blocages[1].status, 429);
    });
    await t('AUTRE (503, réseau) : ne compte PAS comme blocage, mais aucun réessai avant 24 h ; l\'état migré est écrit', async () => {
        for (const x of [rep(503), new Error('ECONNRESET'), rep(302, { location: 'https://x' })]) {
            const b = banc([x]); const t = b.etat.now; const r = await b.essai.essayer();
            assert.strictEqual(r.verdict, 'AUTRE'); assert.strictEqual(b.etat.doc.blocages.length, 1); assert.strictEqual(b.etat.doc.suspendue, false); assert.strictEqual(b.etat.doc.pasAvant, t + 24 * HEURE);
            b.etat.now = t + 24 * HEURE - 1; await b.essai.essayer(); assert.strictEqual(b.etat.requetes, 1);
        }
    });

    console.log('si elle passe');
    await t('SERVI : l\'alerte est levée, l\'historique des blocages gardé, le compteur repart à zéro', async () => {
        const b = banc([SERVI]); const r = await b.essai.essayer();
        assert.strictEqual(r.verdict, 'SERVI'); const d = b.etat.doc;
        assert.strictEqual(d.active, false); assert.strictEqual(d.suspendue, false); assert.deepStrictEqual(d.blocages, []); assert.strictEqual(d.historiqueBlocages.length, 1); assert.strictEqual(d.historiqueBlocages[0].le, T1);
    });
    await t('SERVI : `surServi` (la remise en file des unités) part AVANT l\'écriture de l\'état', async () => {
        const ordre = []; const b = banc([SERVI], { surServi: async () => { ordre.push('remise'); assert.strictEqual(b.etat.doc.active, true); } });
        await b.essai.essayer(); ordre.push('etat-ecrit'); assert.deepStrictEqual(ordre, ['remise', 'etat-ecrit']); assert.strictEqual(b.etat.doc.active, false);
    });
    await t('SERVI mais la remise en file échoue : l\'alerte RESTE (aucune unité n\'est laissée refusée sous une alerte levée)', async () => {
        const b = banc([SERVI], { surServi: async () => { throw new Error('mongo down'); } });
        await assert.rejects(() => b.essai.essayer(), /mongo down/); assert.strictEqual(b.etat.doc.active, true); assert.strictEqual(b.etat.ecritures, 0);
    });

    console.log('garde d\'état : sans état lisible, pas de tentative');
    const sans = async (doc, nom, t0 = T1 + 365 * 24 * HEURE) => t(nom, async () => { const b = banc([SERVI], { doc, t0 }); const r = await b.essai.essayer(); assert.strictEqual(r.envoye, false); assert.strictEqual(b.etat.requetes, 0); });
    await sans(null, 'aucun état en base : pas de tentative (rien ne dit qu\'il y a un blocage à retenter)');
    await sans({ _id: P.ID_ALERTE }, 'état {} : bloque');
    await sans({ _id: P.ID_ALERTE, active: 'true', depuis: new Date(T1) }, 'active en chaîne : bloque');
    await sans({ _id: P.ID_ALERTE, active: true }, 'alerte active sans date ni tableau : bloque');
    await sans({ _id: P.ID_ALERTE, active: true, blocages: [] }, 'tableau vide sur alerte active : bloque');
    await sans({ _id: P.ID_ALERTE, active: true, blocages: [{ le: 'x' }] }, 'blocage à date illisible : bloque');
    await sans({ _id: P.ID_ALERTE, active: false, blocages: [] }, 'alerte déjà levée : rien à retenter');
    await sans({ _id: P.ID_ALERTE, active: true, suspendue: true, blocages: [{ le: T1 }, { le: T1 + 1 }, { le: T1 + 2 }], pasAvant: null }, 'suspendue : bloque');
    await sans({ _id: P.ID_ALERTE, active: true, blocages: [{ le: T1 }, { le: T1 + 1 }, { le: T1 + 2 }] }, 'trois blocages sans drapeau : suspendue quand même (la garde ne dépend pas du drapeau)');
    await sans({ _id: P.ID_ALERTE, active: true, blocages: [{ le: T1 }, { le: T1 + 1 }, { le: T1 + 2 }, { le: T1 + 3 }] }, 'quatre blocages : bloque');
    await t('éteint par défaut : fabriquerEssai ne parle qu\'avec allume === true, jamais autre chose', async () => {
        let n = 0; const e = R.fabriquerEssai({ client: async () => { n++; return SERVI; }, magasin: { lire: async () => LEGACY(), reserver: async () => true, ecrire: async () => { } }, maintenant: () => T1 + 7 * HEURE, allume: 'oui' });
        assert.strictEqual((await e.essayer()).envoye, false); assert.strictEqual(n, 0);
    });
    await t('réservation refusée (un autre worker a pris l\'essai) : aucune requête', async () => {
        let n = 0; const e = R.fabriquerEssai({ client: async () => { n++; return SERVI; }, magasin: { lire: async () => LEGACY(), reserver: async () => false, ecrire: async () => { } }, maintenant: () => T1 + 7 * HEURE });
        assert.strictEqual((await e.essayer()).envoye, false); assert.strictEqual(n, 0);
    });
    await t('une réservation sans réponse (crash après la prise) : pas de nouvel essai avant 6 h', async () => {
        const b = banc([SERVI]); b.etat.doc = { ...LEGACY(), dernierEssai: b.etat.now };
        b.etat.now += 6 * HEURE - 1; assert.strictEqual((await b.essai.essayer()).envoye, false); assert.strictEqual(b.etat.requetes, 0);
    });

    console.log('le verdict d\'une réponse');
    await t('200 text/plain avec User-agent et /sets/ permis = SERVI', () => assert.strictEqual(R.verdictDe(SERVI).verdict, 'SERVI'));
    await t('404 sans marque de défi = SERVI (robots absent, comme le client)', () => assert.strictEqual(R.verdictDe(rep(404, { server: 'cloudflare' }, 'not found')).verdict, 'SERVI'));
    await t('404 portant cf-mitigated = DEFI', () => assert.strictEqual(R.verdictDe(rep(404, { 'cf-mitigated': 'challenge' })).verdict, 'DEFI'));
    await t('403 / 429 / page de défi en 200 = DEFI', () => {
        for (const x of [DEFI, rep(403), rep(429), rep(200, { 'content-type': 'text/html' }, '<title>Just a moment...</title>')]) assert.strictEqual(R.verdictDe(x).verdict, 'DEFI');
    });
    await t('200 HTML sans défi, corps vide, ligne User-agent absente = AUTRE (SERVI seulement sur un vrai robots.txt)', () => {
        for (const x of [rep(200, { 'content-type': 'text/html' }, '<html>ok</html>'), rep(200, { 'content-type': 'text/plain' }, ''), rep(200, { 'content-type': 'text/plain' }, 'hello'), rep(200, { 'content-type': 'text/html' }, ROBOTS)]) assert.strictEqual(R.verdictDe(x).verdict, 'AUTRE');
    });
    await t('robots.txt qui interdit /sets/ à notre agent = AUTRE ; Crawl-delay au-delà de 60 s = AUTRE', () => {
        assert.strictEqual(R.verdictDe(rep(200, { 'content-type': 'text/plain' }, 'User-agent: *\nDisallow: /sets/\n')).verdict, 'AUTRE');
        assert.strictEqual(R.verdictDe(rep(200, { 'content-type': 'text/plain' }, 'User-agent: *\nCrawl-delay: 120\n')).verdict, 'AUTRE');
    });
    await t('null / sans statut / 5xx / 3xx = AUTRE', () => { for (const x of [null, {}, rep(503), rep(301)]) assert.strictEqual(R.verdictDe(x).verdict, 'AUTRE'); });

    console.log('l\'identification : honnête, jamais un navigateur');
    await t('une requête, vers https://pikaqian.com/robots.txt, en-têtes = User-Agent seul, redirect manual, rien d\'autre', async () => {
        const appels = [];
        const c = R.fabriquerClientDirect(async (url, opts) => { appels.push({ url, opts }); return { status: 200, headers: H({}), text: async () => ROBOTS }; });
        await c();
        assert.strictEqual(appels.length, 1); assert.strictEqual(appels[0].url, 'https://pikaqian.com/robots.txt');
        assert.deepStrictEqual(Object.keys(appels[0].opts.headers), ['User-Agent']); assert.strictEqual(appels[0].opts.redirect, 'manual');
        assert.ok(!('credentials' in appels[0].opts) && !('cookie' in appels[0].opts.headers));
    });
    await t('le User-Agent est celui du dépôt (nom + contact), et n\'imite aucun navigateur', () => {
        assert.strictEqual(R.UA, P.UA);
        assert.ok(/rat-market-catalogue\/\d/.test(R.UA), 'un nom'); assert.ok(/https:\/\/rat-market\.fr/.test(R.UA), 'un contact');
        assert.ok(!/mozilla|chrome|safari|firefox|gecko|webkit|applewebkit|edg\/|opera|msie|trident|headless|puppeteer|playwright/i.test(R.UA), 'aucun jeton de navigateur');
    });
    await t('aucun changement d\'adresse : la source du client direct ne lit ni proxy ni variable d\'environnement', () => {
        const src = fs.readFileSync(require.resolve('./collecte-cartes/reessai-pikaqian'), 'utf8');
        assert.ok(!/process\.env|proxy|HTTPS?_PROXY|puppeteer|playwright|cookie/i.test(src.replace(/\/\/.*$/gm, '')), 'pas de proxy, de navigateur automatisé ni de cookie dans le code');
    });

    console.log('noterBlocage : le collecteur compte ses blocages en base aussi');
    function fausseCollection(doc) {
        const d = { docs: new Map(doc ? [[doc._id, doc]] : []), journal: [] };
        d.findOne = async f => { const x = d.docs.get(f._id); return x ? structuredClone(x) : null; };
        d.updateOne = async (f, u, o) => { d.journal.push([f, u, o]); let x = d.docs.get(f._id); if (!x) { if (!o?.upsert) return { matchedCount: 0 }; x = { _id: f._id }; d.docs.set(f._id, x); } Object.assign(x, u.$set); return { matchedCount: 1 }; };
        return d;
    }
    await t('sur l\'alerte ancienne (sans tableau) : le blocage n°1 est gardé, le nouveau devient le n°2', async () => {
        const c = fausseCollection(LEGACY()); const now = T1 + 7 * HEURE;
        const r = await R.noterBlocage(c, { unite: 'pikaqian/X', motif: 'BLOQUÉ', status: 403, url: 'https://pikaqian.com/sets/cs1bc', requetes: 2 }, now);
        const d = c.docs.get(P.ID_ALERTE); assert.strictEqual(d.blocages.length, 2); assert.strictEqual(d.blocages[0].le, T1); assert.strictEqual(d.blocages[1].le, now); assert.strictEqual(d.blocages[1].url, 'https://pikaqian.com/sets/cs1bc');
        assert.strictEqual(d.active, true); assert.strictEqual(d.suspendue, false); assert.strictEqual(d.pasAvant, now + 24 * HEURE); assert.strictEqual(r.n, 2);
    });
    await t('sans alerte : n°1, retentable 6 h plus tard ; au troisième : suspendue', async () => {
        const c = fausseCollection(null); const now = T1;
        await R.noterBlocage(c, { unite: 'u', motif: 'm', status: 403 }, now);
        assert.strictEqual(c.docs.get(P.ID_ALERTE).pasAvant, now + 6 * HEURE);
        await R.noterBlocage(c, { unite: 'u', motif: 'm', status: 403 }, now + 7 * HEURE); await R.noterBlocage(c, { unite: 'u', motif: 'm', status: 403 }, now + 31 * HEURE);
        const d = c.docs.get(P.ID_ALERTE); assert.strictEqual(d.suspendue, true); assert.strictEqual(d.pasAvant, null); assert.strictEqual(d.blocages.length, 3);
    });
    await t('le collecteur passe par noterBlocage (conclureBloque), pas par un $set qui effacerait le compte', () => {
        const src = fs.readFileSync(require.resolve('./collecteur-images-pikaqian.js'), 'utf8');
        assert.ok(/noterBlocage\(/.test(src)); assert.ok(!/updateOne\(\{ _id: P\.ID_ALERTE \}/.test(src));
    });

    console.log('magasinMongo : l\'alerte ancienne n\'a pas de dernierEssai');
    await t('la prise atomique filtre sur l\'ABSENCE de dernierEssai ; l\'écriture est un $set par _id (jamais _id dans $set)', async () => {
        const journal = [];
        const col = { findOne: async () => null, findOneAndUpdate: async (f, u) => { journal.push(['f1u', f, u]); return { _id: 'x' }; }, updateOne: async (f, u, o) => { journal.push(['u1', f, u, o]); } };
        const m = R.magasinMongo(col); assert.strictEqual(await m.reserver(LEGACY(), 10), true);
        assert.deepStrictEqual(journal[0][1], { _id: P.ID_ALERTE, active: true, dernierEssai: { $exists: false } });
        await m.ecrire({ _id: P.ID_ALERTE, active: false }); assert.deepStrictEqual(journal[1][1], { _id: P.ID_ALERTE }); assert.ok(!('_id' in journal[1][2].$set));
    });

    console.log('remise en file des unités refusées pour blocage');
    function fausseFile(unites) {
        const f = { unites: unites.map(u => ({ ...u })) };
        const corr = (u, flt) => Object.entries(flt).every(([k, v]) => u[k] === v);
        f.find = flt => { let r = f.unites.filter(u => corr(u, flt)); const c = { sort: s => { const [k, sens] = Object.entries(s)[0]; r = [...r].sort((a, b) => sens * ((a[k] ?? 0) - (b[k] ?? 0))); return c; }, limit: n => { r = r.slice(0, n); return c; }, toArray: async () => r.map(x => ({ ...x })) }; return c; };
        f.updateOne = async (flt, upd) => { const u = f.unites.find(x => corr(x, flt)); if (!u) return { modifiedCount: 0 }; Object.assign(u, upd.$set); for (const k of Object.keys(upd.$unset || {})) delete u[k]; return { modifiedCount: 1 }; };
        return f;
    }
    const U = (id, extra) => ({ _id: id, source: 'pikaqian', etat: 'refuse', resultat: 'refuse-source-bloquee', ordre: 1, erreur: 'x', pris: new Date(), ...extra });
    await t('les unités pikaqian refusées pour blocage repassent en attente, EN QUEUE et dans leur ordre ; rien d\'autre ne bouge', async () => {
        const f = fausseFile([U('pikaqian/c', { ordre: 9 }), U('pikaqian/a', { ordre: 3 }), U('pikaqian/b', { ordre: 5 }),
            U('pikaqian/taille', { resultat: 'refuse-taille-base', ordre: 4 }), U('tcgdex/z', { source: 'tcgdex', ordre: 7 }), U('pikaqian/deja', { etat: 'attente', resultat: undefined, ordre: 8 }), U('artofpkm/q', { source: 'artofpkm', etat: 'attente', resultat: undefined, ordre: 20 })]);
        const r = await R.remettreEnFile(f, new Date(T1));
        assert.strictEqual(r.remises, 3);
        const par = id => f.unites.find(u => u._id === id);
        assert.deepStrictEqual(['a', 'b', 'c'].map(x => par('pikaqian/' + x).etat), ['attente', 'attente', 'attente']);
        const o = ['a', 'b', 'c'].map(x => par('pikaqian/' + x).ordre); assert.ok(o[0] < o[1] && o[1] < o[2] && o[0] > 20, 'après la dernière unité de la file (' + o + ')');
        assert.ok(!('erreur' in par('pikaqian/a')) && !('pris' in par('pikaqian/a')));
        assert.strictEqual(par('pikaqian/taille').etat, 'refuse'); assert.strictEqual(par('tcgdex/z').etat, 'refuse'); assert.strictEqual(par('artofpkm/q').ordre, 20);
        assert.ok(par('pikaqian/a').remisEnFileMotif);
    });
    await t('idempotent : une seconde remise ne trouve plus rien', async () => {
        const f = fausseFile([U('pikaqian/a')]); await R.remettreEnFile(f, new Date()); assert.strictEqual((await R.remettreEnFile(f, new Date())).remises, 0);
    });

    console.log('branchement dans le worker');
    await t('le worker appelle passerLesTaches de reessai-pikaqian, dans un try (une panne ne tue pas la boucle)', () => {
        const src = fs.readFileSync(require.resolve('./collecteur-images.js'), 'utf8');
        assert.ok(/reessai-pikaqian/.test(src)); assert.ok(/try \{ await passerLesTachesSources\(/.test(src));
    });
    await t('la tâche ne part que si pikaqian est EN SERVICE (sources-en-service.js)', async () => {
        const S = require('./collecte-cartes/sources-en-service'); assert.strictEqual(S.enService('pikaqian'), true);
        let n = 0; const r = await R.passerLesTaches({ collection: () => { n++; return {}; } }, { enService: () => false, journal: { log() { }, error() { } } });
        assert.strictEqual(n, 0); assert.ok(/service/.test(r.pikaqian.raison));
    });
    await t('la garde du commit du worker (REGLES) porte les fichiers neufs', () => {
        const { REGLES } = require('./remettre-en-file');
        for (const f of ['collecte-cartes/reessai-pikaqian.js', 'collecte-cartes/bulba-espacement.js', 'collecte-cartes/sonde-cdn-pokemon-tcg.js']) assert.ok(REGLES.includes(f), f);
    });
    await t('Bulbapedia reste SUSPENDU : rien d\'allumé pour lui', () => assert.strictEqual(require('./collecte-cartes/sources-en-service').enService('bulbapedia'), false));

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();
