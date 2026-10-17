// node test-pikaqian.js — pikaqian.com : le CLIENT (hôtes fermés, robots, redirections, défi, erreur répétée, cadence), la LECTURE de la page de
// set, la PREUVE par produit, le plan, le seuil de largeur et le plan de retrait. Aucune requête réelle : transport simulé, horloge simulée.
// PK_MODULE (banc des mutants, rouge-pikaqian.js) : un module à tester à la place du vrai.
const fs = require('fs');
const path = require('path');
const P = require(process.env.PK_MODULE ? path.resolve(process.env.PK_MODULE) : './collecte-cartes/pikaqian');
const S = require('./collecte-cartes/seuils-images');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── une page de set au format MESURÉ le 2026-10-10 (MESURE-PIKAQIAN.md §4) ───────────────────────────────────────────
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tuile = (n, code, num, nom, { src } = {}) => `<a class="w-full group" data-discover="true" href="/cards/${UUID(n)}"><div class="x"><img alt="${nom}" src="${src ?? `https://images.pikaqian.com/${code}/${UUID(n)}.webp`}" loading="lazy"/></div><h2 class="t">${nom}</h2><p class="font-mono text-xs">${code}<!-- --> · ${num}</p></a>`;
const page = (...tuiles) => `<!DOCTYPE html><html><head><title>Set</title></head><body><nav><a href="/sets">Sets</a></nav>${tuiles.join('')}</body></html>`;

// ── le réseau simulé et l'horloge ───────────────────────────────────────────────────────────────────────────────────
function monde({ repondre, cadence = 10000, verrou = { tenu: true, perdu: false }, dossierPauses = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pq-pauses-')) } = {}) {
    require('./collecte-cartes/reponse-hote').reinitialiserSuiviProcessus(); let t = 1_000_000;
    const appels = [];
    const transport = { async get(url, o) { appels.push({ url, t, binaire: !!o?.binaire }); return repondre(url, o, appels.length); } };
    const client = P.fabriquerClientPikaqian({ transport, cadenceMs: cadence, verrou, horloge: () => t, pause: async ms => { t += ms; }, dossierPauses });
    return { client, appels, avancer: ms => { t += ms; } };
}
const ROBOTS = 'User-agent: *\nDisallow: /api/\nDisallow: /admin/\nDisallow: /auth/\nDisallow: /login\nDisallow: /logout\nDisallow: /currency\nSitemap: https://pikaqian.com/sitemap.xml\n';
const HTML = page(tuile(1, 'cs1bc', '001', 'Pikachu'));
const normal = (extra = {}) => (url, o) => {
    if (extra[url]) return extra[url](url, o);
    if (url.endsWith('/robots.txt')) return url.startsWith('https://pikaqian.com') ? { status: 200, texte: ROBOTS } : { status: 404, texte: '' };
    if (url.includes('/sets/')) return { status: 200, type: 'text/html', texte: HTML };
    if (url.endsWith('.webp')) return { status: 200, type: 'image/webp', octets: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]) };   // (REPONSE-HOTE : la règle commune exige les OCTETS d'un webp, pas le mot « webp »)
    return { status: 404, texte: 'non' };
};
const chemins = appels => appels.map(a => a.url.replace('https://', ''));

(async () => {
    // ════ 1. LE CLIENT ═══════════════════════════════════════════════════════════════════════════════════════════
    verifier('les constantes : source, lot, mention, cadence 10 s', [P.SOURCE, P.LOT, P.MENTION, P.CADENCE_MS], ['pikaqian', 'pikaqian-2026-10', '© Pokémon / The Pokémon Company', 10000]);
    let w = monde({ repondre: normal(), verrou: null });
    let e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('sans verrou lié : aucune requête', [!!e, w.appels.length], [true, 0]);
    w = monde({ repondre: normal(), verrou: { tenu: true, perdu: true } });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('verrou PERDU : aucune requête', [!!e, w.appels.length], [true, 0]);
    w = monde({ repondre: normal(), verrou: { tenu: false, perdu: false } });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('verrou non tenu : aucune requête', [!!e, w.appels.length], [true, 0]);

    w = monde({ repondre: normal() });
    const h = await w.client.page('https://pikaqian.com/sets/cs1bc');
    verifier('robots.txt lu AVANT la page, puis la page ; la page est rendue', [chemins(w.appels), h === HTML], [['pikaqian.com/robots.txt', 'pikaqian.com/sets/cs1bc'], true]);
    const img = await w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp');
    verifier('l\'hôte d\'images : SON robots.txt d\'abord (lu une fois), puis l\'image', [chemins(w.appels).slice(2), Buffer.isBuffer(img)], [['images.pikaqian.com/robots.txt', 'images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'], true]);
    await w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(2) + '.webp');
    await w.client.page('https://pikaqian.com/sets/csv10c');
    verifier('chaque robots.txt n\'est lu qu\'UNE fois', chemins(w.appels).filter(c => c.endsWith('robots.txt')).length, 2);
    verifier('requêtes comptées, par hôte', [w.client.compteRequetes(), w.client.requetesParHote()], [6, { 'pikaqian.com': 3, 'images.pikaqian.com': 3 }]);

    // hôtes FERMÉS, https seulement
    for (const [nom, url] of [['un autre hôte', 'https://cardmarket.com/sets/cs1bc'], ['http en clair', 'http://pikaqian.com/sets/cs1bc'], ['un sous-domaine inconnu', 'https://cdn.pikaqian.com/sets/cs1bc'],
        ['un identifiant dans l\'adresse', 'https://user:pw@pikaqian.com/sets/cs1bc'], ['un autre port', 'https://pikaqian.com:8443/sets/cs1bc'], ['une requête (query)', 'https://pikaqian.com/sets/cs1bc?x=1']]) {
        w = monde({ repondre: normal() });
        e = await leve(() => w.client.page(url));
        verifier(`refusé sans requête : ${nom}`, [!!e, w.appels.length], [true, 0]);
    }
    // chemins énumérés : jamais /api/, /admin/, /auth/, /login, /logout, /currency, ni une page de carte
    for (const c of ['/api/cards', '/api/', '/admin/x', '/auth/x', '/login', '/logout', '/currency', '/cards/' + UUID(1), '/sets', '/sets/', '/sets/../api/x', '/sitemap.xml']) {
        w = monde({ repondre: normal() });
        e = await leve(() => w.client.page('https://pikaqian.com' + c));
        verifier(`chemin refusé sans requête : ${c}`, [!!e, w.appels.length], [true, 0]);
    }
    w = monde({ repondre: normal() });
    e = await leve(() => w.client.image('https://images.pikaqian.com/api/x.webp'));
    verifier('image : /api/ refusé sans requête', [!!e, w.appels.length], [true, 0]);
    e = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/pas-un-uuid.webp'));
    verifier('image : une adresse hors du motif /<code>/<uuid>.webp refusée', [!!e, w.appels.length], [true, 0]);
    e = await leve(() => w.client.page('https://images.pikaqian.com/sets/cs1bc'));
    verifier('page demandée sur l\'hôte d\'images : refusé', [!!e, w.appels.length], [true, 0]);
    // 🔴 LA GARDE DE CHEMINS SE TIENT SEULE : un robots.txt qui n'interdit RIEN ne doit pas ouvrir /api/ — c'est la liste d'interdits du client qui refuse, sans requête
    const robotsOuvert = { 'https://pikaqian.com/robots.txt': () => ({ status: 200, texte: 'User-agent: *\nAllow: /\n' }), 'https://images.pikaqian.com/robots.txt': () => ({ status: 200, texte: 'User-agent: *\nAllow: /\n' }) };
    for (const c of ['/api/cards', '/api/sets/cs1bc', '/admin/x', '/auth/login', '/login', '/logout', '/currency']) {
        w = monde({ repondre: normal(robotsOuvert) });
        e = await leve(() => w.client.page('https://pikaqian.com' + c));
        const e2 = await leve(() => w.client.image('https://images.pikaqian.com' + c));
        verifier(`robots.txt OUVERT : ${c} refusé par la garde de chemins elle-même (message « interdit »), 0 requête`, [/interdit/.test(e?.message ?? ''), /interdit/.test(e2?.message ?? ''), w.appels.length], [true, true, 0]);
    }

    // robots.txt qui interdit une page : AUCUNE requête vers elle (même si l'allow-list la laisserait passer)
    w = monde({ repondre: normal({ 'https://pikaqian.com/robots.txt': () => ({ status: 200, texte: 'User-agent: *\nDisallow: /sets/cs1bc\n' }) }) });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('robots.txt interdit la page → aucune requête vers elle', [e?.robots === true, chemins(w.appels)], [true, ['pikaqian.com/robots.txt']]);
    // robots.txt illisible (500) : on ne conclut pas, aucune page
    w = monde({ repondre: normal({ 'https://pikaqian.com/robots.txt': () => ({ status: 500, texte: 'oups' }) }) });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('robots.txt illisible (500) → aucune page demandée', [e?.robots === true, chemins(w.appels)], [true, ['pikaqian.com/robots.txt']]);
    // robots.txt de l'hôte d'images : AccessDenied d'un S3 sans cette clé = pas de robots.txt (clé absente) ; un 403 sans cette marque = BLOQUÉ
    const s3 = { status: 403, type: 'application/xml', server: 'AmazonS3', texte: '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>' };
    w = monde({ repondre: normal({ 'https://images.pikaqian.com/robots.txt': () => s3 }) });
    const i2 = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'));
    verifier('robots.txt d\'images en AccessDenied S3 → pas de robots.txt, l\'image est demandée', [i2, chemins(w.appels).length], [null, 2]);
    w = monde({ repondre: normal({ 'https://images.pikaqian.com/robots.txt': () => ({ status: 403, texte: 'Forbidden' }) }) });
    e = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'));
    verifier('robots.txt en 403 sans marque S3 → BLOQUÉ, l\'image n\'est pas demandée', [e?.bloque === true, chemins(w.appels).length], [true, 1]);
    for (const [nom, rep] of [['le corps AccessDenied, via CloudFront mais serveur Cloudflare', { ...s3, server: 'cloudflare', via: '1.1 abc.cloudfront.net (CloudFront)' }], ['le corps AccessDenied mais un serveur Cloudflare', { ...s3, server: 'cloudflare' }], ['le corps AccessDenied mais cf-mitigated', { ...s3, cfMitigated: 'challenge' }],
        ['le corps AccessDenied sans aucun en-tête S3', { status: 403, texte: s3.texte }], ['un serveur S3 mais un corps qui n\'est pas AccessDenied', { ...s3, texte: '<html>Forbidden</html>' }]]) {
        w = monde({ repondre: normal({ 'https://images.pikaqian.com/robots.txt': () => rep }) });
        e = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'));
        verifier(`robots.txt d'images en 403 avec ${nom} → BLOQUÉ (seule la marque S3 COMPLÈTE le tolère)`, [e?.bloque === true, chemins(w.appels).length], [true, 1]);
    }

    // redirections : même hôte seulement, trois sauts, robots relu
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => ({ status: 301, location: '/sets/cs1bc-bis' }), 'https://pikaqian.com/sets/cs1bc-bis': () => ({ status: 200, texte: HTML }) }) });
    verifier('redirection vers le même hôte : suivie', [await w.client.page('https://pikaqian.com/sets/cs1bc') === HTML, chemins(w.appels).slice(-2)], [true, ['pikaqian.com/sets/cs1bc', 'pikaqian.com/sets/cs1bc-bis']]);
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => ({ status: 302, location: 'https://ailleurs.example/sets/x' }) }) });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('redirection vers un AUTRE hôte : refusée, rien n\'est demandé là-bas', [!!e, chemins(w.appels).some(c => c.includes('ailleurs'))], [true, false]);
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => ({ status: 302, location: 'https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp' }) }) });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('redirection vers l\'autre hôte DU SITE (images) : refusée aussi (l\'hôte de départ seul)', [!!e, chemins(w.appels).some(c => c.startsWith('images.'))], [true, false]);
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => ({ status: 302, location: '/api/cards' }) }) });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('redirection vers /api/ : refusée, jamais demandée', [!!e, chemins(w.appels).some(c => c.includes('/api/'))], [true, false]);
    let n = 0;
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => ({ status: 302, location: '/sets/cs1bc' }) }) });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('une boucle de redirections : arrêt après 3 sauts', [!!e, chemins(w.appels).filter(c => c === 'pikaqian.com/sets/cs1bc').length], [true, 4]);

    // 404 : la page n'existe pas — pas une erreur
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/zz': () => ({ status: 404, texte: 'non' }) }) });
    verifier('404 → null, et ce n\'est pas un échec (le compteur d\'erreurs de suite reste à 0)', [await w.client.page('https://pikaqian.com/sets/zz'), w.client.bloque()], [null, null]);

    // LE DÉFI : arrêt, plus aucune requête
    for (const [nom, rep] of [['403', () => ({ status: 403, texte: 'Forbidden' })], ['429', () => ({ status: 429, texte: 'slow' })],
        ['cf-mitigated sur un 200', () => ({ status: 200, cfMitigated: 'challenge', texte: HTML })], ['page « Just a moment » en 200', () => ({ status: 200, texte: '<html><title>Just a moment...</title></html>' })],
        ['page « Just a moment » en 503', () => ({ status: 503, texte: '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b"></script></html>' })]]) {
        w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': rep }) });
        e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
        const avant = w.appels.length;
        const e2 = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'));
        verifier(`défi (${nom}) : bloqué, et plus AUCUNE requête ensuite`, [e?.bloque === true, e2?.bloque === true, w.appels.length === avant, !!w.client.bloque()], [true, true, true, true]);
    }

    // L'ERREUR RÉPÉTÉE : deux échecs de suite → arrêt ; un succès entre les deux remet le compteur à zéro
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => ({ status: 500, texte: 'oups' }) }) });
    const e1 = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    const apresUne = w.client.bloque();
    const ee = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    const avant2 = w.appels.length;
    const e3 = await leve(() => w.client.page('https://pikaqian.com/sets/csv10c'));
    verifier('un 500 : une erreur, pas d\'arrêt ; le second de suite : ARRÊT (repetee) ; ensuite 0 requête', [!!e1, apresUne, ee?.arret === true && ee?.repetee === true, e3?.arret === true, w.appels.length === avant2], [true, null, true, true, true]);
    let k = 0;
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => (k++ % 2 === 0 ? { status: 500, texte: 'oups' } : { status: 200, texte: HTML }) }) });
    const issue = async () => { try { return (await w.client.page('https://pikaqian.com/sets/cs1bc')) === HTML ? 'ok' : 'autre'; } catch (e) { return e.arret ? 'ARRET' : 'echec'; } };
    verifier('échec, succès, échec, succès : jamais deux de suite → pas d\'arrêt', [await issue(), await issue(), await issue(), await issue(), w.client.arret()], ['echec', 'ok', 'echec', 'ok', null]);
    w = monde({ repondre: normal({ ['https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp']: () => { throw Object.assign(new Error('ETIMEDOUT x'), { reseau: true }); } }) });
    await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'));
    const rs = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'));
    verifier('deux coupures réseau de suite → arrêt aussi', [rs?.arret === true, rs?.repetee === true], [true, true]);
    w = monde({ repondre: normal({ ['https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp']: () => ({ status: 200, type: 'text/html', texte: '<html>pas une image</html>' }) }) });
    verifier('REPONSE-HOTE : un 200 text/html à la place de l\'image = fausse page introuvable → null (absente), ni erreur ni blocage, comptée', [await w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'), !!w.client.bloque(), !!w.client.pause(), w.client.suivi().rapport('images.pikaqian.com').fausses], [null, false, false, 1]);
    w = monde({ repondre: normal({ ['https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp']: () => ({ status: 200, type: 'application/json', texte: '{"a":1}' }) }) });
    e = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp'));
    verifier('une réponse qui n\'est pas une image (JSON) : une erreur nommée — une PAUSE de l\'hôte (inattendue), pas un blocage', [/n'est pas une image/.test(e?.message ?? ''), e?.pauseHote === true, !!e?.bloque, e?.issue], [true, true, false, 'inattendue']);
    {
        const RH = require('./collecte-cartes/reponse-hote');
        const U = n => `https://images.pikaqian.com/cs1bc/${UUID(n)}.webp`;
        const PAGE = { status: 200, type: 'text/html; charset=utf-8', texte: '<html>Page introuvable</html>' };
        // (on prouve les 20/21 sur des adresses distinctes, toutes servies par la même fausse page)
        w = monde({ repondre: url => (url.endsWith('.webp') ? PAGE : normal({})(url)) });
        w.client.fixerSuite(0);
        let nuls = 0; for (let i = 1; i <= 20; i++) if ((await w.client.image(U(i))) === null) nuls++;
        e = await leve(() => w.client.image(U(21)));
        verifier('REPONSE-HOTE : 20 fausses absences d\'affilée → on continue ; la 21e → PAUSE (pas un blocage, pas d\'arrêt)', [nuls, e?.pauseHote === true, !!e?.bloque, w.client.bloque(), w.client.arret(), !!w.client.pause()], [20, true, false, null, null, true]);
        const e22 = await leve(() => w.client.image(U(22)));
        verifier('REPONSE-HOTE : …plus aucune requête pendant la pause', [e22?.pauseHote === true], [true]);
        w = monde({ repondre: url => (url.endsWith('.webp') ? { status: 200, type: 'text/html', texte: '<nav>Gym Challenge</nav>' } : normal({})(url)) });
        e = await leve(() => w.client.image(U(1)));
        verifier('REPONSE-HOTE : « Gym Challenge » seul = ambiguë → pause PERSISTANTE (fichier), pas un blocage', [e?.pauseHote === true, e?.pausePersistante === true, !!e?.bloque], [true, true, false]);
        void RH;
    }
    w = monde({ repondre: normal({ ['https://images.pikaqian.com/cs1bc/' + UUID(3) + '.webp']: () => ({ status: 404, texte: '<Error/>' }) }) });
    verifier('image en 404 → null', await w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(3) + '.webp'), null);

    // le compteur d'échecs de suite PERSISTÉ : relu au début d'une unité (fixerSuite), un seul échec de plus suffit à l'arrêt ; un succès le remet à zéro
    w = monde({ repondre: normal({ 'https://pikaqian.com/sets/cs1bc': () => ({ status: 500, texte: 'oups' }) }) });
    w.client.fixerSuite(1);
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('compteur relu à 1 : le premier échec de cette unité est le deuxième de suite → ARRÊT (repetee)', [e?.arret === true && e?.repetee === true, w.client.suiteEchecs()], [true, 2]);
    w = monde({ repondre: normal() });
    w.client.fixerSuite(1);
    await w.client.page('https://pikaqian.com/sets/cs1bc');
    verifier('compteur relu à 1, puis un succès → remis à zéro', w.client.suiteEchecs(), 0);
    // un fichier que l'appelant ne sait pas lire compte comme un échec (deux de suite → arrêt)
    w = monde({ repondre: normal() });
    const illisible = async () => { throw new Error('Input buffer contains unsupported image format'); };
    const i1 = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp', illisible));
    const i3 = await leve(() => w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(2) + '.webp', illisible));
    verifier('deux images illisibles de suite → arrêt ; la première est une erreur simple', [i1?.illisible === true && !i1.arret, i3?.arret === true && i3?.repetee === true], [true, true]);
    // le PLAFOND de requêtes de l'unité
    w = monde({ repondre: normal() });
    w.client.plafonner(2);
    await w.client.page('https://pikaqian.com/sets/cs1bc');
    e = await leve(() => w.client.page('https://pikaqian.com/sets/csv10c'));
    verifier('plafond de 2 requêtes (robots.txt + page) : la suivante est refusée sans requête', [e?.plafond === true, w.appels.length], [true, 2]);
    // la lecture BORNÉE du corps, avec ou sans content-length
    const corps = (taille, entetes = {}) => new Response(new ReadableStream({ start(c) { for (let i = 0; i < taille; i += 10) c.enqueue(new Uint8Array(Math.min(10, taille - i))); c.close(); } }), { headers: entetes });
    verifier('lireBorne : un corps sous le plafond est rendu en entier', (await P.lireBorne(corps(25), 30)).length, 25);
    e = await leve(() => P.lireBorne(corps(100), 30));
    verifier('lireBorne : un corps SANS content-length qui dépasse le plafond est coupé', [e?.reseau === true, /plus de 30 octets/.test(e?.message ?? '')], [true, true]);
    e = await leve(() => P.lireBorne(corps(10, { 'content-length': '5000' }), 30));
    verifier('lireBorne : un content-length au-dessus du plafond est refusé avant toute lecture', e?.reseau === true, true);

    // LA CADENCE : ≥ 10 s entre deux requêtes quelles qu'elles soient (hôtes confondus), dans une FILE
    w = monde({ repondre: normal() });
    await Promise.all([w.client.page('https://pikaqian.com/sets/cs1bc'), w.client.page('https://pikaqian.com/sets/csv10c'), w.client.image('https://images.pikaqian.com/cs1bc/' + UUID(1) + '.webp')]);
    const ecarts = w.appels.slice(1).map((a, i) => a.t - w.appels[i].t);
    verifier('trois appelants concurrents : tous les écarts ≥ 10 s (une file, pas une boucle)', [ecarts.length, ecarts.every(x => x >= 10000)], [w.appels.length - 1, true]);
    w = monde({ repondre: normal(), cadence: 100 });
    verifier('une cadence demandée sous 10 s est RELEVÉE à 10 s', w.client.cadence(), 10000);
    w = monde({ repondre: normal({ 'https://pikaqian.com/robots.txt': () => ({ status: 200, texte: 'User-agent: *\nCrawl-delay: 25\n' }) }) });
    await w.client.page('https://pikaqian.com/sets/cs1bc'); await w.client.page('https://pikaqian.com/sets/csv10c');
    verifier('Crawl-delay 25 s : la cadence passe à 25 s', [w.client.cadence(), w.appels[2].t - w.appels[1].t >= 25000], [25000, true]);
    w = monde({ repondre: normal({ 'https://pikaqian.com/robots.txt': () => ({ status: 200, texte: 'User-agent: *\nCrawl-delay: 90\n' }) }) });
    e = await leve(() => w.client.page('https://pikaqian.com/sets/cs1bc'));
    verifier('Crawl-delay 90 s (> 60) : le site demande qu\'on ne vienne pas → arrêt', [e?.bloque === true, chemins(w.appels)], [true, ['pikaqian.com/robots.txt']]);

    // ════ 2. LA PAGE DE SET ═════════════════════════════════════════════════════════════════════════════════════
    const H = page(tuile(1, 'cs1bc', '001', 'Pikachu'), tuile(2, 'cs1bc', '001', 'Pikachu Reverse Holo'), tuile(3, 'cs1bc', '002', 'Farfetch&#x27;d &amp; Co'),
        tuile(4, 'cs1bc', '003', 'Eevee', { src: 'https://autre.example/x.webp' }));
    const L = P.lireTuiles(H);
    verifier('lireTuiles : id, nom (entités décodées), code, numéro, adresse d\'image', L.map(t => [t.id === UUID(1) || undefined, t.nom, t.code, t.numero]).slice(0, 3),
        [[true, 'Pikachu', 'cs1bc', '001'], [undefined, 'Pikachu Reverse Holo', 'cs1bc', '001'], [undefined, 'Farfetch\'d & Co', 'cs1bc', '002']]);
    verifier('lireTuiles : l\'adresse d\'image est celle de la tuile', L[0].img, `https://images.pikaqian.com/cs1bc/${UUID(1)}.webp`);
    verifier('lireTuiles : une page sans tuile → []', [P.lireTuiles('<html>rien</html>'), P.lireTuiles(null)], [[], []]);
    verifier('lireTuiles : un lien /cards/ sans image ni titre n\'est pas une tuile', P.lireTuiles(`<a href="/cards/${UUID(9)}">voir</a>`), []);
    // une page de 700 tuiles se lit vite (pas de retour arrière quadratique)
    const grosse = page(...Array.from({ length: 700 }, (_, i) => tuile(i + 1, 'csv10c', String(i + 1).padStart(3, '0'), `Carte ${i}`))) + '<a href="/cards/' + UUID(9999) + '">'.repeat(2000);
    const t0 = Date.now(); const G = P.lireTuiles(grosse);
    verifier('700 tuiles lues, moins d\'une seconde, même avec 2 000 ancres sans corps', [G.length, Date.now() - t0 < 1000], [700, true]);
    verifier('estFoil : suffixes de foil connus, et rien d\'autre', ['Pikachu Reverse Holo', 'Shaymin Master Ball Holo', 'Shaymin Pokeball Holo', 'Pikachu', 'Pikachu ex', 'Holo Charizard'].map(P.estFoil), [true, true, true, false, false, false]);

    // le balisage RÉEL (fixture : 3 tuiles brutes de /sets/cs1bc lues le 2026-10-11, dont une paire base/foil au même numéro)
    const dossierFix = path.join(__dirname, 'collecte-cartes', 'pikaqian-fixtures');
    const reel = P.lireTuiles(fs.readFileSync(path.join(dossierFix, 'cs1bc-tuiles.html'), 'utf8'));
    verifier('balisage réel : 5 tuiles lues, entités décodées (« Professor\'s Research Professor Magnolia »), code cs1bc', [reel.length, reel.map(t => t.nom), [...new Set(reel.map(t => t.code))]],
        [5, ['Zamazenta V', 'Zamazenta V', 'Zamazenta V', 'Professor\'s Research Professor Magnolia', 'Professor\'s Research Professor Magnolia Reverse Holo'], ['cs1bc']]);
    verifier('   numéro, adresse d\'image = images.pikaqian.com/<code>/<uuid de la tuile>.webp, foil reconnu (la dernière tuile est le foil de l\'avant-dernière)', [reel[0].numero, reel.every(t => t.img === P.urlImage('cs1bc', t.id)), reel.map(t => P.estFoil(t.nom)), reel[3].numero === reel[4].numero],
        ['193', true, [false, false, false, false, true], true]);
    // les adresses d'ORIGINE déclarées : le flux réel (fixture) — native_image_url = pokipair.com, l'officielle = we_chat_image_url (cdn.pokemon-tcg.cn)
    const flux = fs.readFileSync(path.join(dossierFix, 'cs1bc-flux.txt'), 'utf8');
    const O = P.lireOrigines(`<script>window.__remixContext.streamController.enqueue("[${flux}")</script>`);
    verifier('lireOrigines sur le flux RÉEL : la carte embarquée, son native_image_url (pokipair.com, tiers) et son adresse officielle (cdn.pokemon-tcg.cn)', [[...O.keys()], O.get('9febb5b9-087c-42cd-9ff3-c97efc275217')],
        [['9febb5b9-087c-42cd-9ff3-c97efc275217'], { native: 'https://pokipair.com/wp-content/uploads/2024/09/CS1B-Dynamax-Clash-Simplified-Chinese-Pokemon-311.png', officielle: 'https://cdn.pokemon-tcg.cn/cards/A07CD8EE291149F2BD45798D796F82A2.png' }]);
    verifier('lireOrigines : une page sans flux, ou sans ces champs → Map vide ; une adresse we_chat hors cdn.pokemon-tcg.cn n\'est pas « officielle »', [P.lireOrigines('<html></html>').size, P.lireOrigines(null).size,
        P.lireOrigines('"id","00000000-0000-4000-8000-000000000001","we_chat_image_url","https://ailleurs.example/x.png"').get(UUID(1))?.officielle ?? null], [0, 0, null]);

    // ════ 3. LA PREUVE ET LE PLAN ═════════════════════════════════════════════════════════════════════════════
    const carte = (id, nomEn, images = []) => ({ _id: id, nomEn, images });
    const trou = (c, numeroFiche, idProduct = c._id * 10) => ({ carte: c, numeroFiche, idProduct });
    const T = (n, num, nom, extra) => P.lireTuiles(tuile(n, 'cs1bc', num, nom, extra))[0];
    const plan = (trous, tuiles, code = 'cs1bc', slug = 'Dynamax-Clash-Flame') => P.planifierPikaqian({ trous, tuiles, code, slug });
    let R = plan([trou(carte(1, 'Pikachu'), '001')], [T(1, '001', 'Pikachu'), T(2, '001', 'Pikachu Reverse Holo')]);
    verifier('numéro + base sans foil unique + nom concordant → prouvé, c\'est la tuile SANS suffixe', [R.plan.length, R.plan[0]?.tuile?.id === UUID(1), R.restes.length], [1, true, 0]);
    verifier('   la preuve nomme le set, le numéro, le nom et la tuile', [/cs1bc/.test(R.plan[0]?.preuve), /001/.test(R.plan[0]?.preuve), /Pikachu/.test(R.plan[0]?.preuve), !!R.plan[0]?.preuve?.includes(UUID(1))], [true, true, true, true]);
    verifier('   le numéro de la tuile fait l\'adresse : « 1 » et « 001 » sont le même numéro', plan([trou(carte(1, 'Pikachu'), '1')], [T(1, '001', 'Pikachu')]).plan.length, 1);
    R = plan([trou(carte(1, 'Pikachu'), '001')], [T(2, '001', 'Pikachu Reverse Holo')]);
    verifier('seule une tuile FOIL au numéro → un trou nommé', [R.plan.length, R.restes[0]?.motif], [0, 'tuile-a-suffixe']);
    // la règle s'écrit par ce qu'elle AUTORISE : la tuile de base est celle dont le nom ne laisse AUCUN suffixe, connu ou non
    R = plan([trou(carte(1, 'Shaymin'), '007')], [T(7, '007', 'Shaymin Rainbow Foil')]);
    verifier('« Shaymin Rainbow Foil » SEULE au numéro (suffixe inconnu) → un trou, et le suffixe inconnu est COMPTÉ', [R.plan.length, R.restes[0]?.motif, R.suffixesInconnus.map(s => s.nom)], [0, 'tuile-a-suffixe', ['Shaymin Rainbow Foil']]);
    R = plan([trou(carte(1, 'Shaymin'), '007')], [T(7, '007', 'Shaymin Rainbow Foil'), T(8, '007', 'Shaymin')]);
    verifier('   avec sa base au même numéro : la base est prouvée, le suffixe inconnu compté quand même', [R.plan.map(p => p.tuile.nom), R.suffixesInconnus.length], [['Shaymin'], 1]);
    R = plan([trou(carte(1, 'Pikachu'), '001')], [T(1, '001', 'Pikachu'), T(2, '001', 'Pikachu Reverse Holo')]);
    verifier('   un suffixe CONNU (Holo) n\'est pas compté comme inconnu', R.suffixesInconnus.length, 0);
    R = plan([trou(carte(1, 'Pikachu'), '001')], [T(2, '001', 'Pikachu ex')]);
    verifier('   « Pikachu ex » pour notre « Pikachu » : pas la tuile de base', [R.plan.length, R.restes[0]?.motif], [0, 'tuile-a-suffixe']);
    R = plan([trou(carte(1, 'Pikachu'), '001')], [T(1, '001', 'Pikachu'), T(5, '001', 'Pikachu')]);
    verifier('DEUX tuiles sans foil au même numéro → un trou (ambigu), jamais la première', [R.plan.length, R.restes[0]?.motif], [0, 'tuile-ambigue']);
    R = plan([trou(carte(1, 'Emcee\'s Hype'), '010')], [T(1, '010', 'Iris\'s Fighting Spirit')]);
    verifier('nom anglais divergent → un trou (numéro et set concordent, le nom non)', [R.plan.length, R.restes[0]?.motif], [0, 'nom-different']);
    R = plan([trou(carte(1, 'Team Rocket\'s Energy'), '010')], [T(1, '010', 'Team Rocket Energy')]);
    verifier('   « Team Rocket\'s Energy » contre « Team Rocket Energy » : un trou, comme à la mesure', R.restes[0]?.motif, 'nom-different');
    R = plan([trou(carte(1, 'Farfetch\'d'), '002')], [T(3, '002', 'Farfetch’d')]);
    verifier('   la normalisation est celle de la production (apostrophe typographique)', R.plan.length, 1);
    R = plan([trou(carte(1, 'Pikachu'), '005')], [T(1, '001', 'Pikachu')]);
    verifier('numéro absent de la page → trou « absente-de-la-source »', R.restes[0]?.motif, 'absente-de-la-source');
    R = plan([trou(carte(1, 'Pikachu'), null)], [T(1, '001', 'Pikachu')]);
    verifier('produit sans numéro → trou « sans-numero »', R.restes[0]?.motif, 'sans-numero');
    R = plan([trou({ _id: 1, images: [] }, '001')], [T(1, '001', 'Pikachu')]);
    verifier('carte sans nom anglais → trou « sans-nom »', R.restes[0]?.motif, 'sans-nom');
    R = plan([trou(carte(1, 'Eevee'), '003')], [T(4, '003', 'Eevee', { src: 'https://autre.example/x.webp' })]);
    verifier('adresse d\'image hors de images.pikaqian.com → trou « image-incoherente »', R.restes[0]?.motif, 'image-incoherente');
    R = plan([trou(carte(1, 'Eevee'), '003')], [P.lireTuiles(tuile(4, 'cs1bc', '003', 'Eevee', { src: `https://images.pikaqian.com/csv10c/${UUID(4)}.webp` }))[0]]);
    verifier('adresse d\'image d\'un AUTRE set → trou « image-incoherente »', R.restes[0]?.motif, 'image-incoherente');
    R = plan([trou(carte(1, 'Eevee'), '003')], [P.lireTuiles(tuile(4, 'cs1bc', '003', 'Eevee', { src: `https://images.pikaqian.com/cs1bc/${UUID(77)}.webp` }))[0]]);
    verifier('adresse d\'image d\'une AUTRE carte (uuid ≠ celui de la tuile) → trou « image-incoherente »', R.restes[0]?.motif, 'image-incoherente');
    const tuileAutreSet = P.lireTuiles(tuile(6, 'csv10c', '001', 'Pikachu'))[0];
    R = plan([trou(carte(1, 'Pikachu'), '001')], [tuileAutreSet]);
    verifier('une tuile dont le code n\'est pas celui du set n\'est jamais candidate', [R.plan.length, R.restes[0]?.motif], [0, 'absente-de-la-source']);
    // additif : déjà servie → ni plan ni reste
    const servie = carte(1, 'Pikachu', [{ set: 'Dynamax-Clash-Flame', source: 'tcgdex', numero: '001' }]);
    R = plan([trou(servie, '001')], [T(1, '001', 'Pikachu')]);
    verifier('carte déjà servie à ce numéro par une autre source : jamais touchée (ni plan ni reste)', [R.plan.length, R.restes.length], [0, 0]);
    // deux produits (V1/V2) d'une même carte au même numéro : un seul visuel
    R = plan([trou(carte(1, 'Pikachu'), '001', 11), trou(carte(1, 'Pikachu'), '001', 12)], [T(1, '001', 'Pikachu')]);
    verifier('deux produits, une carte, un numéro : un seul visuel', [R.plan.length, R.restes.length], [1, 0]);
    // deux CARTES au même numéro (fiche et produit divergent) : chacune a sa preuve par le nom
    R = plan([trou(carte(1, 'Pikachu'), '001'), trou(carte(2, 'Raichu'), '001')], [T(1, '001', 'Pikachu')]);
    verifier('deux cartes au même numéro : celle dont le nom concorde est prouvée, l\'autre est un trou', [R.plan.map(p => p.carteId), R.restes.map(r => [r.carteId, r.motif])], [[1], [[2, 'nom-different']]]);
    verifier('le plan porte l\'adresse de l\'image', R.plan[0]?.url, `https://images.pikaqian.com/cs1bc/${UUID(1)}.webp`);

    // la page désigne-t-elle ce set ? majorité des tuiles au code du set, sinon refus
    verifier('pageDuSet : toutes les tuiles au code du set → ok', P.verdictDePage({ tuiles: [T(1, '001', 'A'), T(2, '002', 'B')], code: 'cs1bc' }).ok, true);
    verifier('pageDuSet : aucune tuile → refus', P.verdictDePage({ tuiles: [], code: 'cs1bc' }).ok, false);
    verifier('pageDuSet : la majorité des tuiles à un AUTRE code → refus', P.verdictDePage({ tuiles: [tuileAutreSet, tuileAutreSet, T(1, '001', 'A')], code: 'cs1bc' }).ok, false);
    verifier('pageDuSet : une tuile étrangère sur deux (égalité) → refus', P.verdictDePage({ tuiles: [tuileAutreSet, T(1, '001', 'A')], code: 'cs1bc' }).ok, false);

    // ════ 4. LE SEUIL ═════════════════════════════════════════════════════════════════════════════════════════
    verifier('largeurMinDe(\'pikaqian\') = 300 (décision du testeur 2026-10-11 : usage vignette 157 px)', S.largeurMinDe('pikaqian'), 300);
    verifier('les autres sources ne bougent pas', ['bulbapedia', 'artofpkm', 'tcgdex', 'pokemontcg.io', 'quelque-part', 'PIKAQIAN', 'Pikaqian', '', undefined, 'constructor'].map(S.largeurMinDe), [350, 350, 350, 350, 350, 350, 350, 350, 350, 350]);
    verifier('les sources TPC sont à 257 (décision du testeur, 2026-10-12) ; PikaQian, qui n\'est pas officielle, garde 300', ['tpc-asie', 'pokemon-card-com', 'pokemon-com'].map(S.largeurMinDe), [257, 257, 257]);
    verifier('aRejuger(pikaqian, trop-petit à 350 de 320 px) → oui (le seuil a baissé)', S.aRejuger({ wOriginal: 320 }, 'pikaqian'), true);
    verifier('sourceDeUnite : le préfixe « pikaqian/ » est une source connue', S.sourceDeUnite({ _id: 'pikaqian/Dynamax-Clash-Flame' }, 'artofpkm'), 'pikaqian');

    // ════ 5. LE RETRAIT ═══════════════════════════════════════════════════════════════════════════════════════
    const cartes = [
        { _id: 1, images: [{ set: 'X', source: 'pikaqian', lot: 'pikaqian-2026-10', cleR2: 'pikaqian/a.webp', vignette: { cleR2: 'vignettes/pikaqian/a.webp' } }, { set: 'X', source: 'tcgdex', lot: 'pikaqian-2026-10', cleR2: 'tcgdex/b.webp' }] },
        { _id: 2, images: [{ set: 'Y', source: 'tpc-asie', lot: 'tpc-2026-10', cleR2: 'tpc/c.webp' }] },
        { _id: 3, images: [{ set: 'Z', source: 'pikaqian', lot: 'pikaqian-autre', cleR2: 'pikaqian/d.webp' }] }
    ];
    verifier('planRetraitPikaqian : EXACTEMENT source pikaqian ET lot pikaqian-2026-10 (vignette comprise)', P.planRetraitPikaqian(cartes), { cartes: [1], entrees: 1, cles: ['pikaqian/a.webp', 'vignettes/pikaqian/a.webp'] });
    verifier('idImagePikaqian', P.idImagePikaqian('Dynamax-Clash-Flame', 12, '001'), 'pikaqian/Dynamax-Clash-Flame/12/001/zh-hans');

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
