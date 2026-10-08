// Banc du réessai espacé de Bulbapedia (décision 5 du testeur, 2026-10-08). Aucun réseau : faux client, fausse horloge, faux magasin.
const assert = require('assert');
const E = require('./collecte-cartes/bulba-espacement');

let ok = 0, ko = 0;
async function t(nom, f) { try { await f(); ok++; console.log('  ok   ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + (e && e.message)); } }

const H = o => ({ get: k => o[String(k).toLowerCase()] ?? null, has: k => String(k).toLowerCase() in o });
const rep = (status, h = {}, texte = '') => ({ status, headers: H(h), texte });
const ROBOTS = 'User-agent: *\nCrawl-delay: 5\nDisallow: /w/index.php?*action=history\n';
const SERVI = rep(200, { server: 'cloudflare', 'cf-ray': 'abc-CDG', 'content-type': 'text/plain' }, ROBOTS);
const DEFI = rep(403, { server: 'cloudflare', 'cf-mitigated': 'challenge', 'cf-ray': 'x' }, '<html>Just a moment...</html>');

function banc(reponses, { allume = true, t0 = Date.parse('2026-10-08T12:00:00Z') } = {}) {
    const etat = { now: t0, doc: null, requetes: 0 };
    const file = [...reponses];
    const client = async () => { etat.requetes++; const r = file.length > 1 ? file.shift() : file[0]; if (r instanceof Error) throw r; return r; };
    const magasin = { lire: async () => etat.doc, ecrire: async d => { etat.doc = { ...d }; } };
    const essai = E.fabriquerEssaiEspace({ client, magasin, maintenant: () => etat.now, allume });
    return { etat, essai };
}

(async () => {
    console.log('verdictDe');
    await t('200 sans défi = SERVI', () => assert.strictEqual(E.verdictDe(SERVI).verdict, 'SERVI'));
    await t('403 cf-mitigated: challenge = DEFI', () => assert.strictEqual(E.verdictDe(DEFI).verdict, 'DEFI'));
    await t('200 portant une page de défi = DEFI (pas SERVI)', () => assert.strictEqual(E.verdictDe(rep(200, { server: 'cloudflare' }, '<title>Just a moment...</title>')).verdict, 'DEFI'));
    await t('403 cloudflare sans cf-mitigated mais page de défi = DEFI', () => assert.strictEqual(E.verdictDe(rep(403, { server: 'cloudflare' }, 'Checking your browser... cf-chl')).verdict, 'DEFI'));
    await t('429 = AUTRE avec retry-after', () => { const v = E.verdictDe(rep(429, { 'retry-after': '120' })); assert.strictEqual(v.verdict, 'AUTRE'); assert.ok(/429/.test(v.motif)); });
    await t('503 = AUTRE', () => assert.strictEqual(E.verdictDe(rep(503)).verdict, 'AUTRE'));
    await t('302 = AUTRE (jamais suivie)', () => assert.strictEqual(E.verdictDe(rep(302, { location: 'https://x' })).verdict, 'AUTRE'));
    await t('robots.txt qui interdit /w/api.php = AUTRE', () => assert.strictEqual(E.verdictDe(rep(200, {}, 'User-agent: *\nDisallow: /w/\n')).verdict, 'AUTRE'));
    await t('aucune réponse exploitable (null) = AUTRE', () => assert.strictEqual(E.verdictDe(null).verdict, 'AUTRE'));

    console.log('machine d\'état');
    await t('ÉTEINT : aucune requête, quoi qu\'il arrive', async () => {
        const b = banc([SERVI], { allume: false });
        for (let i = 0; i < 3; i++) { const r = await b.essai.essayer(); assert.strictEqual(r.envoye, false); }
        assert.strictEqual(b.etat.requetes, 0);
    });
    await t('allumé par défaut : NON (garde ouverte = faux)', async () => {
        const client = async () => { throw new Error('requête partie'); };
        const e = E.fabriquerEssaiEspace({ client, magasin: { lire: async () => null, ecrire: async () => { } }, maintenant: () => 0 });
        assert.strictEqual((await e.essayer()).envoye, false);
    });
    await t('SERVI : une requête, état écrit, pas de suspension', async () => {
        const b = banc([SERVI]); const r = await b.essai.essayer();
        assert.strictEqual(b.etat.requetes, 1); assert.strictEqual(r.verdict, 'SERVI'); assert.strictEqual(b.etat.doc.active, false);
    });
    await t('SERVI puis nouvel essai avant la cadence : AUCUNE requête', async () => {
        const b = banc([SERVI]); await b.essai.essayer();
        b.etat.now += E.CADENCE_ESSAI_MS - 1; const r = await b.essai.essayer();
        assert.strictEqual(r.envoye, false); assert.strictEqual(b.etat.requetes, 1);
        b.etat.now += 1; await b.essai.essayer(); assert.strictEqual(b.etat.requetes, 2);
    });
    await t('DÉFI : suspendu jusqu\'à T, motif et date écrits, alerte active', async () => {
        const b = banc([DEFI]); const t0 = b.etat.now; const r = await b.essai.essayer();
        assert.strictEqual(r.verdict, 'DEFI');
        const d = b.etat.doc;
        assert.strictEqual(d.active, true); assert.strictEqual(d._id, 'alerte/source-bloquee/bulbapedia');
        assert.strictEqual(d.jusqua, t0 + E.SUSPENSION_DEFI_MS); assert.strictEqual(d.depuis, t0);
        assert.ok(/cf-mitigated|challenge|défi/i.test(d.motif));
    });
    await t('DÉFI : pas une seule requête de plus avant l\'échéance (1000 essais)', async () => {
        const b = banc([DEFI, SERVI]); const t0 = b.etat.now; await b.essai.essayer();
        for (let i = 1; i <= 1000; i++) { b.etat.now = t0 + Math.floor(E.SUSPENSION_DEFI_MS * i / 1001); const r = await b.essai.essayer(); assert.strictEqual(r.envoye, false); }
        assert.strictEqual(b.etat.requetes, 1);
    });
    await t('DÉFI : à l\'échéance, UN essai unique ; s\'il re-défie, nouvelle suspension complète', async () => {
        const b = banc([DEFI, DEFI]); const t0 = b.etat.now; await b.essai.essayer();
        b.etat.now = t0 + E.SUSPENSION_DEFI_MS; await b.essai.essayer();
        assert.strictEqual(b.etat.requetes, 2); assert.strictEqual(b.etat.doc.jusqua, b.etat.now + E.SUSPENSION_DEFI_MS);
        await b.essai.essayer(); assert.strictEqual(b.etat.requetes, 2);
    });
    await t('DÉFI puis SERVI à l\'échéance : la suspension est levée', async () => {
        const b = banc([DEFI, SERVI]); const t0 = b.etat.now; await b.essai.essayer();
        b.etat.now = t0 + E.SUSPENSION_DEFI_MS; const r = await b.essai.essayer();
        assert.strictEqual(r.verdict, 'SERVI'); assert.strictEqual(b.etat.doc.active, false);
    });
    await t('AUTRE (429/503/réseau) : suspension aussi (la garde autorise SERVI seul), sans réessai', async () => {
        for (const x of [rep(429, { 'retry-after': '5' }), rep(503), new Error('ECONNRESET')]) {
            const b = banc([x]); const r = await b.essai.essayer();
            assert.strictEqual(r.verdict, 'AUTRE'); assert.strictEqual(b.etat.doc.active, true);
            assert.strictEqual(b.etat.doc.jusqua, b.etat.now + E.SUSPENSION_AUTRE_MS);
            await b.essai.essayer(); assert.strictEqual(b.etat.requetes, 1);
        }
    });
    await t('retry-after plus long que la suspension : on prend le plus long', async () => {
        const b = banc([rep(429, { 'retry-after': String(30 * 24 * 3600) })]); await b.essai.essayer();
        assert.ok(b.etat.doc.jusqua >= b.etat.now + 30 * 24 * 3600 * 1000);
    });
    await t('magasin illisible : on ne peut pas conclure, AUCUNE requête', async () => {
        let n = 0; const e = E.fabriquerEssaiEspace({ client: async () => { n++; return SERVI; }, magasin: { lire: async () => { throw new Error('mongo down'); }, ecrire: async () => { } }, maintenant: () => 0, allume: true });
        const r = await e.essayer(); assert.strictEqual(r.envoye, false); assert.strictEqual(n, 0);
    });
    await t('écriture de la suspension impossible après un défi : le dit (ne passe pas sous silence)', async () => {
        const e = E.fabriquerEssaiEspace({ client: async () => DEFI, magasin: { lire: async () => null, ecrire: async () => { throw new Error('mongo down'); } }, maintenant: () => 0, allume: true });
        await assert.rejects(() => e.essayer(), /mongo down/);
    });
    await t('état corrompu (jusqua absent mais active) : traité comme suspendu', async () => {
        let n = 0; const e = E.fabriquerEssaiEspace({ client: async () => { n++; return SERVI; }, magasin: { lire: async () => ({ active: true }), ecrire: async () => { } }, maintenant: () => 5, allume: true });
        assert.strictEqual((await e.essayer()).envoye, false); assert.strictEqual(n, 0);
    });

    console.log('client direct');
    await t('une seule requête, en-têtes = User-Agent seul, redirect manual, aucune file ni verrou', async () => {
        const appels = [];
        const fetchFaux = async (url, opts) => { appels.push({ url, opts }); return { status: 200, headers: { get: k => (k === 'server' ? 'cloudflare' : null), has: () => false }, text: async () => ROBOTS }; };
        const c = E.fabriquerClientDirect(fetchFaux); const r = await c();
        assert.strictEqual(appels.length, 1); assert.strictEqual(appels[0].url, 'https://bulbapedia.bulbagarden.net/robots.txt');
        assert.deepStrictEqual(Object.keys(appels[0].opts.headers), ['User-Agent']); assert.strictEqual(appels[0].opts.redirect, 'manual');
        assert.strictEqual(r.status, 200);
    });
    await t('le User-Agent est celui de bulba.js (même identité honnête)', () => assert.strictEqual(E.UA, require('./collecte-cartes/bulba').UA));
    await t('cadence d\'essai > DELAI_MS de bulba.js, suspension défi > suspension autre', () => {
        assert.ok(E.CADENCE_ESSAI_MS > require('./collecte-cartes/bulba').DELAI_MS); assert.ok(E.SUSPENSION_DEFI_MS > E.SUSPENSION_AUTRE_MS);
    });
    await t('sources-en-service : Bulbapedia reste SUSPENDU (rien n\'est allumé dans ce lot)', () => {
        const S = require('./collecte-cartes/sources-en-service'); assert.strictEqual(S.enService('bulbapedia'), false);
    });

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();
