// Banc de la sonde du serveur d'images officiel (cdn.pokemon-tcg.cn). Aucun réseau : faux transport, fausse pause, faux magasin.
const assert = require('assert');
const sharp = require('sharp');
const S = require('./collecte-cartes/sonde-cdn-pokemon-tcg');
const P = require('./collecte-cartes/pikaqian');

let ok = 0, ko = 0;
async function t(nom, f) { try { await f(); ok++; console.log('  ok   ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + (e && e.message)); } }

const A = n => `https://cdn.pokemon-tcg.cn/cards/${String(n).padStart(32, 'A')}.png`;
const ROBOTS_OK = { status: 200, type: 'text/plain', server: 'nginx', texte: 'User-agent: *\nDisallow: /admin/\n' };
const DEFI = { status: 403, type: 'text/html', server: 'cloudflare', cfMitigated: 'challenge', texte: 'Just a moment...' };

function fausseCollection() {
    const docs = new Map(), journal = [];
    return {
        docs, journal,
        findOne: async f => { const d = docs.get(f._id); return d ? structuredClone(d) : null; },
        insertOne: async d => { journal.push('insertOne'); if (docs.has(d._id)) throw new Error('E11000'); docs.set(d._id, structuredClone(d)); },
        updateOne: async (f, u) => { journal.push('updateOne'); const d = docs.get(f._id); if (!d) return { matchedCount: 0 }; Object.assign(d, structuredClone(u.$set)); return { matchedCount: 1 }; },
        findOneAndUpdate: async (f, u) => { const d = docs.get(f._id); if (!d || Object.entries(f).some(([k, v]) => d[k] !== v)) return null; Object.assign(d, structuredClone(u.$set)); return structuredClone(d); }
    };
}
async function png(w, h) { return sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } }).png().toBuffer(); }

async function banc({ adresses = [A(1), A(2), A(3)], reponses = {}, robots = ROBOTS_OK } = {}) {
    const E = fausseCollection(), vu = [], pauses = [];
    const horloge = { now: Date.parse('2026-10-12T09:00:00Z') };
    const img = await png(300, 419);
    const transport = {
        get: async (url, o = {}) => {
            vu.push({ url, binaire: !!o.binaire, t: horloge.now });
            if (url.endsWith('/robots.txt')) return robots instanceof Error ? Promise.reject(robots) : robots;
            const r = reponses[url] ?? { status: 200, type: 'image/png', server: 'nginx', corps: img, contentLength: img.length };
            if (r instanceof Error) throw r;
            return r;
        }
    };
    const sonde = S.fabriquerSonde({ E, trouverAdresses: async () => adresses, transport, pause: async ms => { pauses.push(ms); horloge.now += ms; }, maintenant: () => horloge.now });
    return { E, vu, pauses, horloge, sonde };
}

(async () => {
    console.log('adresseAutorisee (par ce qu\'elle autorise)');
    await t('accepte l\'adresse réelle de nos données', () => assert.strictEqual(S.adresseAutorisee('https://cdn.pokemon-tcg.cn/cards/A07CD8EE291149F2BD45798D796F82A2.png'), true));
    await t('refuse http, autre hôte, sous-domaine piégé, port, identifiants, requête, fragment, "..", doubles barres, racine seule', () => {
        for (const u of ['http://cdn.pokemon-tcg.cn/cards/a.png', 'https://pokipair.com/x.png', 'https://cdn.pokemon-tcg.cn.evil.com/cards/a.png', 'https://evil.com/cdn.pokemon-tcg.cn/a.png',
            'https://cdn.pokemon-tcg.cn:8443/cards/a.png', 'https://u:p@cdn.pokemon-tcg.cn/cards/a.png', 'https://cdn.pokemon-tcg.cn/cards/a.png?x=1', 'https://cdn.pokemon-tcg.cn/cards/a.png#f',
            'https://cdn.pokemon-tcg.cn/cards/../admin', 'https://cdn.pokemon-tcg.cn//cards/a.png', 'https://cdn.pokemon-tcg.cn/', 'https://www.pokemon-tcg.cn/cards/a.png', '', null, undefined, 42])
            assert.strictEqual(S.adresseAutorisee(u), false, String(u));
    });

    console.log('le déroulé');
    await t('robots.txt d\'abord, puis 3 images, à 10 s d\'intervalle ; l\'état « faite » et chaque résultat écrits', async () => {
        const b = await banc(); const r = await b.sonde.executer();
        assert.strictEqual(r.etat, 'faite'); assert.strictEqual(b.vu.length, 4); assert.ok(b.vu[0].url.endsWith('/cdn.pokemon-tcg.cn/robots.txt') || b.vu[0].url === 'https://cdn.pokemon-tcg.cn/robots.txt');
        assert.deepStrictEqual(b.vu.slice(1).map(x => x.url), [A(1), A(2), A(3)]);
        assert.deepStrictEqual(b.pauses, [10000, 10000, 10000]); for (let i = 1; i < b.vu.length; i++) assert.ok(b.vu[i].t - b.vu[i - 1].t >= 10000);
        const d = b.E.docs.get(S.ID_SONDE); assert.strictEqual(d.etat, 'faite'); assert.strictEqual(d.resultats.length, 3); assert.strictEqual(d.requetes, 4);
        const r0 = d.resultats[0]; assert.strictEqual(r0.statut, 200); assert.strictEqual(r0.type, 'image/png'); assert.strictEqual(r0.largeur, 300); assert.strictEqual(r0.hauteur, 419); assert.strictEqual(r0.format, 'png'); assert.ok(r0.octets > 0); assert.strictEqual(r0.serveur, 'nginx');
        assert.strictEqual(d.robots.statut, 200);
    });
    await t('ne stocke pas l\'image : aucun Buffer dans le document, aucune écriture hors de lui', async () => {
        const b = await banc(); await b.sonde.executer();
        const d = b.E.docs.get(S.ID_SONDE); const json = JSON.stringify(d); assert.ok(json.length < 4000, 'document léger (' + json.length + ')');
        const cherche = x => x && typeof x === 'object' && (Buffer.isBuffer(x) || x instanceof Uint8Array || Object.values(x).some(cherche)); assert.ok(!cherche(d));
        assert.deepStrictEqual([...b.E.docs.keys()], [S.ID_SONDE]);
    });
    await t('au plus 3 images même si la base en propose dix', async () => {
        const b = await banc({ adresses: Array.from({ length: 10 }, (_, i) => A(i + 1)) }); await b.sonde.executer(); assert.strictEqual(b.vu.length, 4);
    });
    await t('moins de 3 adresses : celles qui existent, et le nombre dit', async () => {
        const b = await banc({ adresses: [A(1)] }); const r = await b.sonde.executer();
        assert.strictEqual(r.etat, 'faite'); assert.strictEqual(b.vu.length, 2); assert.strictEqual(b.E.docs.get(S.ID_SONDE).adressesDisponibles, 1);
        assert.ok(/1 adresse\(s\) disponible\(s\)/.test(S.formater(b.E.docs.get(S.ID_SONDE))));
    });
    await t('idempotente : une seconde exécution, et une troisième, ne demandent RIEN', async () => {
        const b = await banc(); await b.sonde.executer(); const n = b.vu.length;
        assert.strictEqual((await b.sonde.executer()).envoye, false); assert.strictEqual((await b.sonde.executer()).envoye, false); assert.strictEqual(b.vu.length, n);
    });
    await t('deux workers : une seule sonde part', async () => {
        const E = fausseCollection(); let n = 0; const mk = () => S.fabriquerSonde({ E, trouverAdresses: async () => [A(1)], transport: { get: async u => { n++; return u.endsWith('robots.txt') ? ROBOTS_OK : { status: 200, type: 'image/png', corps: await png(3, 3) }; } }, pause: async () => { }, maintenant: () => 1e12 });
        const [a, c] = await Promise.all([mk().executer(), mk().executer()]);
        assert.strictEqual([a, c].filter(x => x.envoye).length, 1); assert.strictEqual(n, 2);
    });
    await t('un état « en-cours » laissé par un redéploiement ferme la porte (pas de rejeu à l\'aveugle) et la lecture le dit', async () => {
        const b = await banc(); b.E.docs.set(S.ID_SONDE, { _id: S.ID_SONDE, etat: 'en-cours', debute: 5 });
        assert.strictEqual((await b.sonde.executer()).envoye, false); assert.strictEqual(b.vu.length, 0); assert.ok(/NON FINIE/.test(S.formater(b.E.docs.get(S.ID_SONDE))));
    });

    console.log('arrêts');
    await t('robots.txt en défi (403 cf-mitigated) : écrit, arrêt, AUCUNE image demandée', async () => {
        const b = await banc({ robots: DEFI }); const r = await b.sonde.executer();
        assert.strictEqual(r.etat, 'defi'); assert.strictEqual(b.vu.length, 1); assert.strictEqual(b.E.docs.get(S.ID_SONDE).robots.cfMitigated, 'challenge');
        assert.strictEqual((await b.sonde.executer()).envoye, false); assert.strictEqual(b.vu.length, 1);
    });
    await t('robots.txt qui interdit le chemin : écrit, arrêt, aucune image', async () => {
        const b = await banc({ robots: { ...ROBOTS_OK, texte: 'User-agent: *\nDisallow: /cards/\n' } }); const r = await b.sonde.executer();
        assert.strictEqual(r.etat, 'robots-refuse'); assert.strictEqual(b.vu.length, 1);
    });
    await t('robots.txt illisible (500, HTML, coupure) : écrit, arrêt, aucune image', async () => {
        for (const robots of [{ status: 500, type: 'text/html', texte: 'x' }, { status: 200, type: 'text/html', texte: '<html>' }, new Error('ECONNRESET')]) {
            const b = await banc({ robots }); const r = await b.sonde.executer(); assert.strictEqual(r.etat, 'robots-illisible'); assert.strictEqual(b.vu.length, 1);
        }
    });
    await t('robots.txt absent (404) : permis, les images partent', async () => {
        const b = await banc({ robots: { status: 404, type: 'text/html', texte: 'nope' } }); assert.strictEqual((await b.sonde.executer()).etat, 'faite'); assert.strictEqual(b.vu.length, 4);
    });
    await t('un défi sur la première image : les deux autres ne sont PAS demandées', async () => {
        const b = await banc({ reponses: { [A(1)]: { status: 403, type: 'text/html', server: 'cloudflare', cfMitigated: 'challenge', texte: 'Just a moment' } } }); const r = await b.sonde.executer();
        assert.strictEqual(r.etat, 'defi'); assert.strictEqual(b.vu.length, 2); assert.strictEqual(b.E.docs.get(S.ID_SONDE).resultats[0].defi, true);
    });
    await t('un 403 / 404 sans défi : noté, les suivantes partent ; une redirection est notée, JAMAIS suivie', async () => {
        const b = await banc({ reponses: { [A(1)]: { status: 404, type: 'text/html', texte: 'no' }, [A(2)]: { status: 302, type: '', location: 'https://ailleurs.example/x.png' } } }); await b.sonde.executer();
        const d = b.E.docs.get(S.ID_SONDE); assert.deepStrictEqual(d.resultats.map(x => x.statut), [404, 302, 200]); assert.strictEqual(d.resultats[1].location, 'https://ailleurs.example/x.png');
        assert.ok(!b.vu.some(x => /ailleurs/.test(x.url)));
    });
    await t('une réponse 200 qui n\'est pas une image : statut et type notés, aucun octet mesuré, pas de plantage', async () => {
        const b = await banc({ reponses: { [A(1)]: { status: 200, type: 'text/html', texte: '<html>' } } }); await b.sonde.executer();
        const r0 = b.E.docs.get(S.ID_SONDE).resultats[0]; assert.strictEqual(r0.type, 'text/html'); assert.ok(r0.octets == null);
    });
    await t('un fichier illisible par sharp : octets notés, erreurMesure, la sonde continue', async () => {
        const b = await banc({ reponses: { [A(1)]: { status: 200, type: 'image/png', corps: Buffer.from('pas une image') } } }); await b.sonde.executer();
        const r0 = b.E.docs.get(S.ID_SONDE).resultats[0]; assert.strictEqual(r0.octets, 13); assert.ok(r0.erreurMesure); assert.strictEqual(b.E.docs.get(S.ID_SONDE).resultats.length, 3);
    });
    await t('une coupure réseau sur une image : notée, la sonde continue', async () => {
        const b = await banc({ reponses: { [A(2)]: new Error('ETIMEDOUT x') } }); await b.sonde.executer();
        const d = b.E.docs.get(S.ID_SONDE); assert.ok(d.resultats[1].erreur); assert.strictEqual(d.etat, 'faite');
    });
    await t('Crawl-delay du robots.txt de l\'hôte : l\'intervalle ne descend jamais sous lui', async () => {
        const b = await banc({ robots: { ...ROBOTS_OK, texte: 'User-agent: *\nCrawl-delay: 25\n' } }); await b.sonde.executer(); assert.deepStrictEqual(b.pauses, [25000, 25000, 25000]);
    });
    await t('une adresse hors garde dans les données n\'est JAMAIS demandée', async () => {
        const b = await banc({ adresses: ['https://pokipair.com/x.png', 'http://cdn.pokemon-tcg.cn/a.png', A(1)] }); await b.sonde.executer();
        assert.deepStrictEqual(b.vu.map(x => x.url), ['https://cdn.pokemon-tcg.cn/robots.txt', A(1)]);
    });

    console.log('aucune adresse en base');
    await t('aucune adresse : AUCUNE requête réseau, l\'état « en attente d\'adresses », base relue dans 24 h seulement', async () => {
        const b = await banc({ adresses: [] }); const r = await b.sonde.executer();
        assert.strictEqual(r.envoye, false); assert.strictEqual(b.vu.length, 0); assert.strictEqual(b.E.docs.get(S.ID_SONDE).etat, 'en-attente-adresses');
        let lectures = 0; const E = b.E; const s2 = S.fabriquerSonde({ E, trouverAdresses: async () => { lectures++; return [A(1)]; }, transport: { get: async () => { throw new Error('réseau'); } }, pause: async () => { }, maintenant: () => b.horloge.now + S.REVERIFIER_ADRESSES_MS - 1 });
        assert.strictEqual((await s2.executer()).envoye, false); assert.strictEqual(lectures, 0);
    });
    await t('les adresses arrivent plus tard (24 h après) : la sonde part, une seule fois', async () => {
        const b = await banc({ adresses: [] }); await b.sonde.executer();
        const E = b.E; let n = 0; const s2 = S.fabriquerSonde({ E, trouverAdresses: async () => [A(1)], transport: { get: async u => { n++; return u.endsWith('robots.txt') ? ROBOTS_OK : { status: 200, type: 'image/png', corps: await png(5, 5) }; } }, pause: async () => { }, maintenant: () => b.horloge.now + S.REVERIFIER_ADRESSES_MS });
        assert.strictEqual((await s2.executer()).etat, 'faite'); assert.strictEqual(n, 2); assert.strictEqual((await s2.executer()).envoye, false); assert.strictEqual(n, 2);
    });
    await t('état illisible (lecture en erreur, échéance non finie) : on ne conclut pas, aucune requête', async () => {
        const b = await banc(); b.E.findOne = async () => { throw new Error('mongo down'); }; assert.strictEqual((await b.sonde.executer()).envoye, false); assert.strictEqual(b.vu.length, 0);
        const c = await banc(); c.E.docs.set(S.ID_SONDE, { _id: S.ID_SONDE, etat: 'en-attente-adresses' }); assert.strictEqual((await c.sonde.executer()).envoye, false); assert.strictEqual(c.vu.length, 0);
    });

    console.log('nos données');
    await t('adressesDeNosDonnees : lit images.urlOfficielle des visuels pikaqian, distinctes, filtrées par la garde, 3 au plus', async () => {
        const requetes = [];
        const db = { collection: nom => ({ find: f => { requetes.push([nom, f]); const c = { project: () => c, sort: () => c, limit: () => c, toArray: async () => [{ urlOfficielle: A(2) }, { urlOfficielle: A(2) }, { urlOfficielle: 'https://pokipair.com/x.png' }, { urlOfficielle: A(1) }, { urlOfficielle: A(3) }, { urlOfficielle: A(4) }] }; return c; } }) };
        const r = await S.adressesDeNosDonnees(db); assert.deepStrictEqual(r, [A(2), A(1), A(3)]); assert.strictEqual(requetes[0][0], 'images'); assert.strictEqual(requetes[0][1].source, 'pikaqian');
    });
    await t('la forme réelle de nos données passe la garde (adresse relevée dans le flux de la page CS1bC)', () => assert.strictEqual(S.adresseAutorisee('https://cdn.pokemon-tcg.cn/cards/A07CD8EE291149F2BD45798D796F82A2.png'), true));

    console.log('l\'identification et l\'outil de lecture');
    await t('le transport n\'envoie que User-Agent et Accept, redirect manual (lecture de la source, 0 requête)', () => {
        const src = require('fs').readFileSync(require.resolve('./collecte-cartes/sonde-cdn-pokemon-tcg'), 'utf8').replace(/\/\/.*$/gm, '');
        assert.ok(/headers: \{ 'User-Agent': UA, Accept:/.test(src)); assert.ok(/redirect: 'manual'/.test(src)); assert.ok(!/cookie|Authorization|Referer|puppeteer|playwright|process\.env|proxy/i.test(src));
        assert.ok(!/browser|Mozilla|Chrome|Safari/i.test(P.UA));
    });
    await t('I3 : le transport par défaut envoie, sur robots.txt ET sur l\'image, le User-Agent honnête P.UA (valeur testée, fetch simulé)', async () => {
        // 2026-10-13 : le transport réel est FERMÉ (source passive). Le banc le rouvre le temps du test pour garder l'identification testée.
        const SPm = require('./collecte-cartes/source-passive'), vraiPassif = SPm.estPassive; SPm.estPassive = () => false;
        const vus = []; const vrai = global.fetch;
        global.fetch = async (url, opts) => { vus.push({ url, h: opts.headers, redirect: opts.redirect }); const h = new Map([['content-type', url.endsWith('robots.txt') ? 'text/plain' : 'image/png']]); const corps = url.endsWith('robots.txt') ? Buffer.from('User-agent: *\n') : await png(4, 4);
            return { status: 200, ok: true, headers: { get: k => h.get(k) ?? null }, arrayBuffer: async () => corps }; };
        try { const E = fausseCollection(); await S.fabriquerSonde({ E, trouverAdresses: async () => [A(1)], pause: async () => { } }).executer(); } finally { global.fetch = vrai; SPm.estPassive = vraiPassif; }
        assert.strictEqual(vus.length, 2); for (const v of vus) { assert.strictEqual(v.h['User-Agent'], P.UA); assert.strictEqual(v.redirect, 'manual'); }
        assert.ok(/rat-market-catalogue\/\d/.test(P.UA) && !/mozilla|chrome|safari|axios/i.test(P.UA));
    });
    await t('formater imprime l\'état, le robots et chaque image ; un document absent se dit', async () => {
        const b = await banc(); await b.sonde.executer(); const txt = S.formater(b.E.docs.get(S.ID_SONDE));
        assert.ok(/faite/.test(txt) && /robots\.txt : HTTP 200/.test(txt) && /300×419 png/.test(txt)); assert.ok(/jamais lancée/.test(S.formater(null)));
    });
    await t('la sonde est branchée au worker par passerLesTaches (une panne de la sonde ne coupe pas la tentative pikaqian)', async () => {
        const R = require('./collecte-cartes/reessai-pikaqian'); const erreurs = [];
        const db = { collection: () => ({ findOne: async () => null, find: () => { throw new Error('boum'); } }) };
        const r = await R.passerLesTaches(db, { enService: () => true, journal: { log() { }, error: m => erreurs.push(m) }, fetchImpl: async () => { throw new Error('aucun réseau dans le banc'); } });
        assert.strictEqual(r.pikaqian.envoye, false); assert.ok(r.sonde.erreur || r.sonde.envoye === false);
    });

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();
