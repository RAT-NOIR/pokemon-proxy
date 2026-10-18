// node test-reponse-hote-axios.js — la règle commune de réponse (collecte-cartes/reponse-hote.js) pour les trois clients à transport axios : artofpkm, Bulbapedia, TCGdex.
// Aucune requête (transports simulés), aucune base réelle, dossiers de pause TEMPORAIRES. Pour chacun : 200 text/html → absente (on passe à la suivante) ; défi → arrêt
// définitif (erreur `bloque`, plus aucune requête) ; 21 fausses absences d'affilée → pause (erreur `pauseHote`, pas un arrêt) ; une image remet à zéro ; un 404 ne compte pas.
// Et, pour le collecteur artofpkm (collecteur-images.js), le câblage : défi → « arret-hote », pause → « pause-hote », fausse absence → la carte est un échec, la passe continue.
require('./bancs-dossier-arrets');      // les arrêts et pauses durables d'hôtes : un dossier TEMPORAIRE, jamais le vrai (correction 2, M1)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.env.R2_BUCKET_IMAGES = 'bucket-faux';
const RH = require('./collecte-cartes/reponse-hote');
const { issueDeLUnite } = require('./collecte-cartes/issue-unite');
const AP = require('./collecte-cartes/artofpkm');
const BU = require('./collecte-cartes/bulba');
const TG = require('./collecte-cartes/tcgdex');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const dp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rh-axios-'));
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]);
const FAUSSE = '<html><body>Page introuvable</body></html>';
const sansLever = async f => { try { return { ok: await f() }; } catch (e) { return { e }; } };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
    // ════════════ ARTOFPKM ════════════
    const rep = (status, type, data, h = {}) => ({ status, headers: { 'content-type': type, ...h }, data });
    const appels = [];
    let dirA = null;
    const brancher = (f, dir = dp()) => { appels.length = 0; dirA = dir; AP.regler({ transport: async (url, opt) => { appels.push(url); const r = f(url); if (opt?.validateStatus && !opt.validateStatus(r.status)) throw Object.assign(new Error('Request failed with status code ' + r.status), { response: r }); return r; }, delaiMs: 0, reessaiMs: 0, dossierPauses: dir }); };
    const U = i => `https://cdn.artofpkm.com/x${i}`;
    brancher(() => rep(200, 'text/html; charset=utf-8', Buffer.from(FAUSSE)));
    let x = await sansLever(() => AP.telecharger(U(1)));
    verifier('ARTOFPKM : 200 text/html sans marqueur → fichier ABSENT (erreur « absente », pas un blocage ni une pause), comptée', [x.e?.absente, !!x.e?.bloque, !!x.e?.pauseHote, AP.rapportReponses()[0]?.fausses], [true, false, false, 1]);
    brancher(() => rep(200, 'text/html', Buffer.from(FAUSSE)));
    let nuls = 0; for (let i = 0; i < 20; i++) if ((await sansLever(() => AP.telecharger(U(i)))).e?.absente) nuls++;
    x = await sansLever(() => AP.telecharger(U(21)));
    verifier('ARTOFPKM : 20 fausses absences d\'affilée → on continue ; la 21e → PAUSE (pas un arrêt définitif)', [nuls, !!x.e?.pauseHote, !!x.e?.bloque], [20, true, false]);
    const av0 = appels.length; const xs = await sansLever(() => AP.telecharger(U(21.5)));
    verifier('ARTOFPKM : …et la pause TIENT pour le reste de la passe : aucune requête de plus', [!!xs.e?.pauseHote, appels.length === av0], [true, true]);
    // I3 : l'unité SUIVANTE (le collecteur n'a plus de « nouvelle passe ») ne fait AUCUNE requête : la pause vit pour le processus
    const av = appels.length;
    x = await sansLever(() => AP.telecharger(U(22)));
    const xl = await sansLever(() => AP.pageCarte(1, 2));
    verifier('I3 ARTOFPKM : deux unités de suite — la seconde, après la pause, ne fait AUCUNE requête (image ni page)', [appels.length - av, !!x.e?.pauseHote, !!xl.e?.pauseHote], [0, true, true]);
    AP.regler({ dossierPauses: dp(), delaiMs: 0, reessaiMs: 0 });
    x = await sansLever(() => AP.telecharger(U(23)));
    verifier('I3 ARTOFPKM : un NOUVEAU processus (registre vierge) repart à zéro', [x.e?.absente, !!x.e?.pauseHote], [true, false]);
    brancher(u => (/img/.test(u) ? rep(200, 'image/png', PNG) : rep(200, 'text/html', Buffer.from(FAUSSE))));
    for (let i = 0; i < 20; i++) await sansLever(() => AP.telecharger(U(i)));
    const im = await AP.telecharger('https://cdn.artofpkm.com/img');
    for (let i = 0; i < 20; i++) await sansLever(() => AP.telecharger(U(100 + i)));
    verifier('ARTOFPKM : une image rend ses octets et remet le compteur à zéro (20 + image + 20 → pas de pause)', [im.octets, AP.rapportReponses()[0].pause], [PNG.length, false]);
    brancher(u => (/introuvable/.test(u) ? rep(404, 'text/html', Buffer.from('non')) : rep(200, 'text/html', Buffer.from(FAUSSE))));
    for (let i = 0; i < 20; i++) await sansLever(() => AP.telecharger(U(i)));
    for (let i = 0; i < 5; i++) await sansLever(() => AP.telecharger(`https://cdn.artofpkm.com/introuvable${i}`));
    x = await sansLever(() => AP.telecharger(U(500)));
    verifier('ARTOFPKM : un vrai 404 ne remet pas à zéro (la 21e fausse met en pause)', [!!x.e?.pauseHote], [true]);
    for (const [nom, r] of [['403', rep(403, 'text/html', Buffer.from('non'))], ['429', rep(429, 'text/html', Buffer.from('non'))], ['410', rep(410, 'text/html', Buffer.from('gone'))], ['401', rep(401, 'text/html', Buffer.from('login'))],
        ['Just a moment', rep(200, 'text/html', Buffer.from('<title>Just a moment...</title>'))], ['cf-mitigated', rep(200, 'image/png', PNG, { 'cf-mitigated': 'challenge' })], ['captcha', rep(200, 'text/html', Buffer.from('<div class="g-recaptcha">'))]]) {
        brancher(() => r);
        x = await sansLever(() => AP.telecharger(U(1)));
        const nD = appels.length; const yD = await sansLever(() => AP.telecharger(U(2))); const pD = await sansLever(() => AP.pageCarte(1, 2));
        verifier(`ARTOFPKM : défi (${nom}) → arrêt DÉFINITIF (erreur « bloque ») ET DURABLE (I2) : fichier d'arrêt écrit, l'unité suivante (image ou page) ne fait AUCUNE requête`, [!!x.e?.bloque, !!x.e?.arretDefinitif, !!RH.hoteArrete('artofpkm.com', dirA), !!yD.e?.bloque, !!pD.e?.bloque, appels.length === nD], [true, true, true, true, true, true]);
    }
    brancher(() => rep(200, 'text/html', Buffer.from('<nav>Gym Challenge</nav>')));
    x = await sansLever(() => AP.telecharger(U(1)));
    brancher(() => rep(200, 'text/html', Buffer.from('<nav>Gym Challenge</nav>')));
    x = await sansLever(() => AP.telecharger(U(1)));
    const n1 = appels.length; const x2 = await sansLever(() => AP.telecharger(U(2)));
    verifier('ARTOFPKM : « Gym Challenge » seul = ambiguë → pause PERSISTANTE (fichier), puis AUCUNE requête tant qu\'il tient', [!!x.e?.pauseHote, !!x.e?.pausePersistante, !!x.e?.bloque, fs.existsSync(x.e?.fichier || ''), !!x2.e?.pauseHote, appels.length === n1], [true, true, false, true, true, true]);
    brancher(() => rep(200, 'application/json', Buffer.from('{}')));
    x = await sansLever(() => AP.enTeteImage(U(1)));
    verifier('ARTOFPKM : 200 JSON pour une image (mesure) = inattendue → pause', [!!x.e?.pauseHote, x.e?.issue], [true, 'inattendue']);
    brancher(() => rep(206, 'image/png', PNG, { 'content-range': 'bytes 0-48/49' }));
    x = await sansLever(() => AP.enTeteImage(U(1)));
    verifier('ARTOFPKM : un 206 (début de fichier pour la mesure) est jugé comme un 200 image', [!!x.e, x.ok?.fmt], [false, 'png']);
    // I1 : un 503 « Just a moment » est un DÉFI (axios ne lève plus sur un 5xx) ; un 503 sans marqueur garde l'ancien chemin (UN réessai)
    brancher(() => rep(503, 'text/html', Buffer.from('<title>Just a moment...</title>')));
    x = await sansLever(() => AP.telecharger(U(1)));
    verifier('I1 ARTOFPKM : 503 avec « Just a moment » (image) → arrêt DÉFINITIF et durable, UNE seule requête (pas de réessai)', [!!x.e?.bloque, !!RH.hoteArrete('artofpkm.com', dirA), appels.length], [true, true, 1]);
    brancher(() => rep(503, 'text/html', Buffer.from('<title>Just a moment...</title>')));
    x = await sansLever(() => AP.pageCarte(1, 2));
    verifier('I1 ARTOFPKM : 503 avec « Just a moment » (page) → arrêt DÉFINITIF et durable, UNE seule requête', [!!x.e?.bloque, !!RH.hoteArrete('artofpkm.com', dirA), appels.length], [true, true, 1]);
    brancher(() => rep(503, 'text/html', Buffer.from('maintenance')));
    x = await sansLever(() => AP.telecharger(U(1)));
    verifier('I1 ARTOFPKM : 503 SANS marqueur → l\'ancien chemin : UN réessai puis une erreur ordinaire (ni blocage, ni pause, aucun arrêt durable)', [!!x.e?.bloque, !!x.e?.pauseHote, appels.length, RH.hoteArrete('artofpkm.com', dirA)], [false, false, 2, null]);
    brancher(() => rep(500, 'application/json', Buffer.from('{"e":1}')));
    x = await sansLever(() => AP.pageCarte(1, 2));
    verifier('I1 ARTOFPKM : 500 JSON (page) → erreur ordinaire après UN réessai', [!!x.e?.bloque, appels.length], [false, 2]);
    // CORRECTION 2 (F5) : une page (liste, carte) au corps INDÉCODABLE n'est pas « sans défi » : PAUSE de la source (fermé), pas un arrêt durable
    brancher(() => rep(200, 'text/html', Buffer.from([0x3c, 0x68, 0x00, 0x74, 0x00, 0x6d, 0x00, 0x6c, 0x00, 0x00])));
    x = await sansLever(() => AP.pageCarte(1, 2));
    verifier('F5 ARTOFPKM : une page au corps indécodable → PAUSE de la source (pauseHote), aucun arrêt durable, UNE requête', [!!x.e?.pauseHote, !!x.e?.bloque, RH.hoteArrete('artofpkm.com', dirA), appels.length], [true, false, null, 1]);
    // I2 : l'arrêt durable survit à un NOUVEAU processus (registre vierge) tant que le fichier est là
    brancher(() => rep(403, 'text/html', Buffer.from('non')));
    x = await sansLever(() => AP.telecharger(U(1)));
    AP.regler({ dossierPauses: dirA, delaiMs: 0, reessaiMs: 0 });
    const nP = appels.length; const z = await sansLever(() => AP.telecharger(U(2)));
    verifier('I2 ARTOFPKM : après un redémarrage (registre vierge), le fichier d\'arrêt retient l\'hôte : AUCUNE requête', [!!z.e?.bloque, appels.length === nP], [true, true]);

    // le COLLECTEUR artofpkm (collecteur-images.js) : le câblage de l'arrêt, de la pause et de la fausse absence
    {
        const r2 = require('./collecte-cartes/r2');
        const { collecterSet } = require('./collecteur-images.js');
        const silencieux = async f => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; console.error = e; } };
        const fausseBase = () => {
            const col = new Map();
            const lire = (o, k) => k.split('.').reduce((v, p) => v?.[p], o);
            const ecrire = (o, k, v) => { const ps = k.split('.'); let y = o; for (const p of ps.slice(0, -1)) y = y[p] ??= {}; y[ps.at(-1)] = v; };
            const appliquer = (d, u) => { for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v); for (const k of Object.keys(u.$unset || {})) delete d[k]; };
            const req = d => ({ lean: async () => structuredClone(d), select() { return this; } });
            const echecs = [];
            const EtatImages = { findById: id => req(col.get(id) ?? null), async updateOne(f, u) { const d = col.get(f._id); if (!d) return { matchedCount: 0 }; appliquer(d, u); return { matchedCount: 1 }; },
                findOneAndUpdate(f, u) { let d = col.get(f._id); if (!d) { d = { _id: f._id, ...(u.$setOnInsert || {}) }; col.set(d._id, d); } appliquer(d, u); return { lean: async () => structuredClone(d) }; } };
            const Image = { find: () => req([]), findById: () => req(null), countDocuments: async () => 3, async updateOne(f, u) { if (u.$set?.etat === 'echec') echecs.push(f._id); return { matchedCount: 0 }; } };
            const vide = { find: () => req([]), findById: () => req(null), countDocuments: async () => 3, updateOne: async () => ({ matchedCount: 0 }) };
            return { M: { Carte: vide, Image, EtatImages, Set: vide, Etat: { findById: () => req(null) }, Reste: vide }, echecs };
        };
        const entree = (sid, n) => ({ titre: `C${n}`, sourceSetId: sid, n, original: `https://cdn.faux/${sid}-${n}`, cleCdn: `${sid}-${n}`, vignette: null });
        const brancherC = fauxTelecharger => {
            const apps = []; AP.listerSet = async () => { const l = [1, 2, 3].map(n => entree(649, n)); Object.defineProperty(l, 'pages', { value: [{ lot: 1, chemin: 'sets/176/cards', lues: 3, nouvelles: 3, suites: [] }] }); return l; };
            AP.enTeteImage = async () => ({ fmt: 'webp', w: 500, h: 700, octets: 1000, type: 'image/webp' });
            AP.pageCarte = async () => ({}); AP.telecharger = async u => { apps.push(u); return fauxTelecharger(u, apps.length); }; r2.deposerBinaire = async () => { };
            return apps;
        };
        const doss = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-axios-col-'));
        let B = fausseBase(), apps = brancherC(() => { throw Object.assign(new Error('artofpkm.com BLOQUÉ (HTTP 403)'), { bloque: true, arretDefinitif: true, hote: 'cdn.artofpkm.com' }); });
        let r = await silencieux(() => collecterSet('DHD', B.M, doss));
        verifier('COLLECTEUR artofpkm : un défi → « arret-hote » (jamais « refuse »), une seule requête de fichier, aucun échec écrit, attente + arrêt du worker', [r.etat, apps.length, B.echecs.length, issueDeLUnite(r, {})], ['arret-hote', 1, 0, { etat: 'attente', arreter: true }]);
        B = fausseBase(); apps = brancherC(() => { throw Object.assign(new Error('cdn.artofpkm.com EN PAUSE'), { pauseHote: true, hote: 'cdn.artofpkm.com', issue: 'fausse-absente' }); });
        r = await silencieux(() => collecterSet('DHD', B.M, doss));
        verifier('COLLECTEUR artofpkm : une pause de l\'hôte → « pause-hote » avec la pause nommée, PAS un blocage, une seule requête, aucun échec écrit, attente + arrêt du worker', [r.etat, r.pauseHote?.hote, apps.length, B.echecs.length, issueDeLUnite(r, {})], ['pause-hote', 'cdn.artofpkm.com', 1, 0, { etat: 'attente', arreter: true }]);
        B = fausseBase(); apps = brancherC(() => { throw Object.assign(new Error('absent chez artofpkm (fausse-absente)'), { absente: true, status: 404, definitif: true }); });
        r = await silencieux(() => collecterSet('DHD', B.M, doss)).catch(() => ({ etat: 'jointure-non-simulee' }));        // (la jointure, après les téléchargements, n'est pas simulée par cette base)
        verifier('COLLECTEUR artofpkm : une fausse page introuvable → la carte est notée en échec, la passe CONTINUE (3 requêtes), aucun blocage', [r.etat === 'arret-hote', apps.length, B.echecs.length], [false, 3, 3]);
    }

    // ════════════ BULBAPEDIA ════════════
    {
        const mk = f => { const a = []; return { a, t: async url => { a.push(url); return f(url); } }; };
        const opt = (t, extra = {}) => ({ transport: t.t, delaiMs: 0, attendre: async () => { }, dossierPauses: dp(), ...extra });
        const H = 'https://archives.bulbagarden.net/media/upload';
        let t = mk(() => rep(200, 'text/html', Buffer.from(FAUSSE))); BU.regler();
        x = await sansLever(() => BU.telecharger(`${H}/a.png`, opt(t)));
        verifier('BULBAPEDIA : 200 text/html sans marqueur → fichier ABSENT (« absente »), ni blocage ni pause, comptée', [x.e?.absente, !!x.e?.bloque, !!x.e?.pauseHote, BU.rapportReponses()[0]?.fausses], [true, false, false, 1]);
        BU.regler(); let n = 0; const o20 = opt(t);
        for (let i = 0; i < 20; i++) if ((await sansLever(() => BU.telecharger(`${H}/a${i}.png`, o20))).e?.absente) n++;
        x = await sansLever(() => BU.telecharger(`${H}/a21.png`, o20));
        verifier('BULBAPEDIA : 20 fausses absences → on continue ; la 21e → PAUSE (pas un arrêt)', [n, !!x.e?.pauseHote, !!x.e?.bloque], [20, true, false]);
        for (const [nom, r] of [['403', rep(403, 'text/html', Buffer.from('non'))], ['429', rep(429, 'text/html', Buffer.from('non'))], ['410', rep(410, 'text/html', Buffer.from('g'))], ['401', rep(401, 'text/html', Buffer.from('l'))], ['cf-mitigated', rep(200, 'image/png', PNG, { 'cf-mitigated': 'challenge' })], ['Just a moment', rep(200, 'text/html', Buffer.from('Just a moment...'))]]) {
            t = mk(() => r); BU.regler();
            x = await sansLever(() => BU.telecharger(`${H}/a.png`, opt(t)));
            verifier(`BULBAPEDIA : défi (${nom}) → arrêt DÉFINITIF (erreur « bloque »), sans réessai (une seule requête)`, [!!x.e?.bloque, t.a.length], [true, 1]);
        }
        t = mk(() => rep(404, 'text/html', Buffer.from('non'))); BU.regler();
        x = await sansLever(() => BU.telecharger(`${H}/a.png`, opt(t)));
        verifier('BULBAPEDIA : 404 → absente (plus une erreur de transport), sans réessai', [x.e?.absente, t.a.length], [true, 1]);
        t = mk(() => rep(200, 'image/png', PNG)); BU.regler();
        x = await sansLever(() => BU.telecharger(`${H}/a.png`, opt(t)));
        verifier('BULBAPEDIA : une image rend ses octets', [x.ok?.buffer.length], [PNG.length]);
        t = mk(() => rep(200, 'text/html', Buffer.from('<nav>Gym Challenge</nav>'))); BU.regler();
        const dB = dp();
        x = await sansLever(() => BU.telecharger(`${H}/a.png`, opt(t, { dossierPauses: dB })));
        BU.regler();       // une AUTRE passe : seul le fichier de pause persistante retient l'hôte
        const x2 = await sansLever(() => BU.telecharger(`${H}/b.png`, opt(t, { dossierPauses: dB })));
        verifier('BULBAPEDIA : « Gym Challenge » seul = ambiguë → pause PERSISTANTE, puis aucune requête tant que le fichier tient', [!!x.e?.pausePersistante, !!x2.e?.pauseHote, t.a.length], [true, true, 1]);
    }

    // ── CORRECTION 2 (F4) : un défi sur l'API Bulbapedia (api.php) écrit l'arrêt durable de la source ──
    {
        const axiosO = require('axios').get; const dA2 = dp();
        const stub = (status, data, h = {}) => async (url, o) => { const r = { status, headers: { 'content-type': typeof data === 'string' ? 'text/html' : 'application/json', ...h }, data }; if (status >= 400) throw Object.assign(new Error('Request failed with status code ' + status), { response: r }); return r; };
        try {
            BU.regler({ dossierPauses: dA2 });
            require('axios').get = stub(403, '<html>Forbidden</html>', { 'cf-mitigated': 'challenge' });
            const xa = await sansLever(() => BU.api({ action: 'query' }));
            const arret = RH.hoteArrete('bulbagarden.net', dA2);
            require('axios').get = stub(200, { query: { pages: [] } });
            const xb = await sansLever(() => BU.api({ action: 'query' }));
            verifier('F4 BULBAPEDIA : un 403 « cf-mitigated » sur api.php → erreur `bloque` ET arrêt durable écrit pour bulbagarden.net ; la requête suivante (API comme image) ne part pas', [!!xa.e?.bloque, !!arret, !!xb.e?.bloque], [true, true, true]);
            BU.regler({ dossierPauses: dp() });
            require('axios').get = stub(200, { query: { pages: [{ title: 'x' }] } });
            const xc = await sansLever(() => BU.api({ action: 'query' }));
            verifier('F4 BULBAPEDIA : une réponse JSON normale passe toujours (aucun arrêt)', [xc.e?.message ?? null, !!xc.ok], [null, true]);

        } finally { require('axios').get = axiosO; BU.regler(); }
    }

    // ── Bulbapedia : I1 (503), I2 (arrêt durable), I3 (le registre du processus) ──
    {
        const mk2 = fn => { const a = []; return { a, t: async url => { a.push(url); return fn(url); } }; };
        const H = 'https://archives.bulbagarden.net/media/upload';
        const dB = dp();
        const opt2 = tt => ({ transport: tt.t, delaiMs: 0, attendre: async () => { }, dossierPauses: dB });
        BU.regler();
        let t = mk2(() => rep(503, 'text/html', Buffer.from('<title>Just a moment...</title>')));
        let x = await sansLever(() => BU.telecharger(H + '/a.png', opt2(t)));
        verifier('I1 BULBAPEDIA : 503 avec « Just a moment » → arrêt DÉFINITIF et durable (fichier), UNE seule requête (pas de réessai de 60 s)', [!!x.e?.bloque, !!RH.hoteArrete('bulbagarden.net', dB), t.a.length], [true, true, 1]);
        const t2 = mk2(() => rep(200, 'image/png', PNG));
        const y = await sansLever(() => BU.telecharger(H + '/b.png', opt2(t2)));
        BU.regler({ dossierPauses: dB });
        const yApi = await sansLever(() => BU.api({ action: 'query' }));
        const z = await sansLever(() => BU.telecharger('https://bulbapedia.bulbagarden.net/media/upload/c.png', opt2(t2)));
        verifier('I2 BULBAPEDIA : l\'unité suivante (autre hôte de la même source, nouveau processus) ne fait AUCUNE requête tant que le fichier d\'arrêt tient — image comme API', [!!y.e?.bloque, !!yApi.e?.bloque, !!z.e?.bloque, t2.a.length], [true, true, true, 0]);
        const t3 = mk2(() => rep(503, 'text/html', Buffer.from('maintenance'))); BU.regler();
        x = await sansLever(() => BU.telecharger(H + '/a.png', { transport: t3.t, delaiMs: 0, attendre: async () => { }, dossierPauses: dp() }));
        verifier('I1 BULBAPEDIA : 503 SANS marqueur → l\'ancien chemin : UN réessai (2 requêtes) puis une erreur ordinaire, ni blocage ni pause', [!!x.e?.bloque, !!x.e?.pauseHote, t3.a.length], [false, false, 2]);
        BU.regler(); const dC = dp();
        const t4 = mk2(() => rep(200, 'text/html', Buffer.from(FAUSSE)));
        for (let i = 0; i < 21; i++) await sansLever(() => BU.telecharger(H + '/f' + i + '.png', { transport: t4.t, delaiMs: 0, attendre: async () => { }, dossierPauses: dC }));
        const av = t4.a.length; const u2 = await sansLever(() => BU.telecharger(H + '/autre-unite.png', { transport: t4.t, delaiMs: 0, attendre: async () => { }, dossierPauses: dC }));
        verifier('I3 BULBAPEDIA : deux unités de suite — la seconde, après la pause de la première, ne fait AUCUNE requête', [!!u2.e?.pauseHote, t4.a.length - av], [true, 0]);
        BU.regler();
        // I1 : le transport PAR DÉFAUT (axios simulé qui honore validateStatus) laisse passer un 503 « Just a moment » jusqu'au module
        const axiosOrigine = require('axios').get; const dD = dp(); const appD = [];
        require('axios').get = async (url, o) => { appD.push(url); const r = rep(503, 'text/html', Buffer.from('<title>Just a moment...</title>')); if (o?.validateStatus && !o.validateStatus(r.status)) throw Object.assign(new Error('Request failed with status code 503'), { response: r }); return r; };
        try {
            const xD = await sansLever(() => BU.telecharger(H + '/a.png', { delaiMs: 0, attendre: async () => { }, dossierPauses: dD }));
            verifier('I1 BULBAPEDIA (transport par défaut) : un 503 « Just a moment » atteint le module → arrêt DÉFINITIF et durable, UNE requête', [!!xD.e?.bloque, !!RH.hoteArrete('bulbagarden.net', dD), appD.length], [true, true, 1]);
            BU.regler();
            appD.length = 0; require('axios').get = async (url, o) => { appD.push(url); const r = rep(503, 'text/html', Buffer.from('maintenance')); if (o?.validateStatus && !o.validateStatus(r.status)) throw Object.assign(new Error('Request failed with status code 503'), { response: r }); return r; };
            const xE = await sansLever(() => BU.telecharger(H + '/a.png', { delaiMs: 0, attendre: async () => { }, dossierPauses: dp() }));
            verifier('I1 BULBAPEDIA (transport par défaut) : un 503 SANS marqueur est réessayé UNE fois (2 requêtes) puis erreur ordinaire', [!!xE.e?.bloque, !!xE.e?.pauseHote, appD.length], [false, false, 2]);
        } finally { require('axios').get = axiosOrigine; BU.regler(); }
    }

    // ════════════ TCGDEX ════════════
    {
        const URLT = i => `https://assets.tcgdex.net/en/sv/sv1/${i}/high.png`;
        const mkc = (f, o = {}) => { if (!o.processus) RH.reinitialiserSuiviProcessus(); const a = []; return { a, c: TG.fabriquerClient({ transport: { async get(url, opt) { a.push(url); return f(url); } }, cadenceMs: 0, reessaiMs: 0, verrou: { tenu: true, perdu: false }, dossierPauses: dp(), ...o }) }; };
        const img = (status, type, octets, extra = {}) => ({ status, type, octets, ...extra });
        let k = mkc(() => img(200, 'text/html; charset=utf-8', Buffer.from(FAUSSE)));
        verifier('TCGDEX : 200 text/html sans marqueur → null (absent), ni blocage ni pause, comptée', [await k.c.telecharger(URLT(1)), !!k.c.bloque(), !!k.c.pause(), k.c.suivi().rapport('tcgdex.net').fausses], [null, false, false, 1]);
        k = mkc(() => img(200, 'text/html', Buffer.from(FAUSSE)));
        n = 0; for (let i = 0; i < 20; i++) if ((await k.c.telecharger(URLT(i))) === null) n++;
        x = await sansLever(() => k.c.telecharger(URLT(21)));
        const avt = k.a.length; const x3 = await sansLever(() => k.c.telecharger(URLT(22)));
        verifier('TCGDEX : 20 fausses absences → on continue ; la 21e → PAUSE (pas un arrêt), puis plus aucune requête', [n, !!x.e?.pauseHote, !!x.e?.bloque, !!x3.e?.pauseHote, k.a.length === avt], [20, true, false, true, true]);
        k = mkc(u => (/\/img\//.test(u) ? img(200, 'image/png', PNG) : img(200, 'text/html', Buffer.from(FAUSSE))));
        for (let i = 0; i < 20; i++) await k.c.telecharger(URLT(i));
        const b = await k.c.telecharger(URLT('img'));
        for (let i = 100; i < 120; i++) await k.c.telecharger(URLT(i));
        verifier('TCGDEX : une image remet le compteur à zéro', [Buffer.isBuffer(b), !!k.c.pause()], [true, false]);
        k = mkc(u => (/introuvable/.test(u) ? img(404, 'text/html', Buffer.from('non')) : img(200, 'text/html', Buffer.from(FAUSSE))));
        for (let i = 0; i < 20; i++) await k.c.telecharger(URLT(i));
        for (let i = 0; i < 5; i++) await k.c.telecharger(URLT(`introuvable${i}`));
        x = await sansLever(() => k.c.telecharger(URLT(500)));
        verifier('TCGDEX : un vrai 404 ne remet pas à zéro (la 21e fausse met en pause)', [!!x.e?.pauseHote], [true]);
        for (const [nom, r] of [['403', img(403, 'text/html', Buffer.from('non'))], ['429', img(429, 'text/html', Buffer.from('n'))], ['410', img(410, 'text/html', Buffer.from('g'))], ['401', img(401, 'text/html', Buffer.from('l'))], ['cf-mitigated', img(200, 'image/png', PNG, { cfMitigated: 'challenge' })], ['captcha', img(200, 'text/html', Buffer.from('<div class="g-recaptcha">'))]]) {
            k = mkc(() => r);
            x = await sansLever(() => k.c.telecharger(URLT(1)));
            const apres = k.a.length; const y = await sansLever(() => k.c.telecharger(URLT(2)));
            verifier(`TCGDEX : défi (${nom}) → arrêt DÉFINITIF (« bloque »), sans réessai, et plus aucune requête ensuite`, [!!x.e?.bloque, k.a.length, !!y.e?.bloque, k.a.length === apres, !!k.c.bloque()], [true, 1, true, true, true]);
        }
        const dT = dp();
        k = mkc(() => img(200, 'text/html', Buffer.from('<nav>Gym Challenge</nav>')), { dossierPauses: dT });
        x = await sansLever(() => k.c.telecharger(URLT(1)));
        const k2 = mkc(() => img(200, 'image/png', PNG), { dossierPauses: dT });
        const y = await sansLever(() => k2.c.telecharger(URLT(2)));
        verifier('TCGDEX : « Gym Challenge » seul = ambiguë → pause PERSISTANTE ; un autre client, tant que le fichier tient : aucune requête', [!!x.e?.pausePersistante, !!y.e?.pauseHote, k2.a.length], [true, true, 0]);
        k = mkc(() => img(200, 'image/png', Buffer.from('pas une image')));
        x = await sansLever(() => k.c.telecharger(URLT(1)));
        verifier('TCGDEX : 200 image/png aux octets faux = inattendue → pause', [!!x.e?.pauseHote, x.e?.issue], [true, 'inattendue']);
        k = mkc(() => PNG);
        verifier('TCGDEX : un Buffer nu (transport de banc) est jugé comme une image', Buffer.isBuffer(await k.c.telecharger(URLT(1))), true);
        // I1 / I2 / I3 : 503 défi, arrêt durable pour l'unité suivante, registre du processus
        const dD = dp();
        k = mkc(() => img(503, 'text/html', Buffer.from('<title>Just a moment...</title>')), { dossierPauses: dD });
        x = await sansLever(() => k.c.telecharger(URLT(1)));
        verifier('I1 TCGDEX : 503 avec « Just a moment » → arrêt DÉFINITIF et durable (fichier), UNE seule requête (pas de réessai)', [!!x.e?.bloque, !!RH.hoteArrete('tcgdex.net', dD), k.a.length], [true, true, 1]);
        const kSuite = mkc(() => PNG, { dossierPauses: dD, processus: true });
        const ySuite = await sansLever(() => kSuite.c.telecharger(URLT(2)));
        const jSuite = await sansLever(() => kSuite.c.getJSON('https://api.tcgdex.net/v2/en/sets'));
        verifier('I2 TCGDEX : l\'unité suivante (nouveau client) ne fait AUCUNE requête tant que le fichier d\'arrêt tient — fichier comme API', [!!ySuite.e?.bloque, !!jSuite.e?.bloque, kSuite.a.length], [true, true, 0]);
        k = mkc(() => img(503, 'text/html', Buffer.from('maintenance')), { dossierPauses: dp() });
        x = await sansLever(() => k.c.telecharger(URLT(1)));
        verifier('I1 TCGDEX : 503 SANS marqueur → l\'ancien chemin : un réessai (2 requêtes) puis une erreur ordinaire, ni blocage ni pause', [!!x.e?.bloque, !!x.e?.pauseHote, k.a.length], [false, false, 2]);
        const dE = dp();
        k = mkc(() => img(200, 'text/html', Buffer.from(FAUSSE)), { dossierPauses: dE });
        for (let i = 0; i < 21; i++) await sansLever(() => k.c.telecharger(URLT(i)));
        const kBis = mkc(() => PNG, { dossierPauses: dE, processus: true });
        const uBis = await sansLever(() => kBis.c.telecharger(URLT(99)));
        verifier('I3 TCGDEX : deux unités de suite (deux clients) — la seconde, après la pause de la première, ne fait AUCUNE requête', [!!uBis.e?.pauseHote, kBis.a.length], [true, 0]);
        RH.reinitialiserSuiviProcessus();
        void sha;
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ le banc a levé :', e.stack); process.exit(1); });
