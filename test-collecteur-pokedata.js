// node test-collecteur-pokedata.js — le collecteur (collecteur-images-pokedata.js) en phases, le retrait et les gardes.
// Aucune requête (transport simulé ; global.fetch REMPLACÉ par un piège qui lève), aucune base réelle (base en mémoire), aucun R2 (faux dépôt), dossiers TEMPORAIRES
// (jamais un vrai chemin du testeur). Ce que le banc garde :
//   · TÉLÉCHARGER (images ET pages) : seules les adresses valables ; robots.txt d'abord ; cadence ≥ 5 s ; plafond ; 401/403/410/429/défi/HTML/3xx/octets inattendus => ARRÊT DÉFINITIF
//     (fichier d'arrêt, relance refusée) ; 404 => absent ; 5xx / coupure => interrompu sans arrêt ; dos de carte et forme inattendue refusés ;
//   · ÉCRIRE : depuis le cache seulement, additif, clé R2 neutre, traçabilité, seuil 350, --attendu, remplacement derrière --remplacer, aucun champ public avec « pokedata » ;
//   · RETIRER : toute la source, en une commande, à blanc par défaut.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pokedata');
const C = require('./collecteur-images-pokedata');
const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

function fausseBase({ dataSize = 1000, indexSize = 100 } = {}) {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) && !/^\d+$/.test(p) ? x.flatMap(e => e?.[p]) : x?.[p], o);
    const ecrireChamp = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
        ? ('$in' in v ? v.$in.includes(lire(d, k)) : '$ne' in v ? lire(d, k) !== v.$ne : '$exists' in v ? (lire(d, k) !== undefined) === v.$exists : false)
        : (x => Array.isArray(x) ? x.includes(v) : x === v)(lire(d, k)));
    const appliquer = (d, u) => {
        for (const [k, v] of Object.entries(u.$set || {})) ecrireChamp(d, k, v);
        for (const k of Object.keys(u.$unset || {})) delete d[k];
        for (const [k, v] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !accepte(e, v));
        for (const [k, v] of Object.entries(u.$push || {})) (d[k] ??= []).push(...(v.$each || [v]));
    };
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const collection = n => ({
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        find(f) { return { toArray: async () => structuredClone(tous(n, f)) }; },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne(f, u, o = {}) {
            let d = tous(n, f)[0];
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id, ...(u.$setOnInsert || {}) }; col(n).set(d._id, d); }
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        }
    });
    const db = { collection, async command(c) { if (c.dbStats) return { dataSize, indexSize }; throw new Error(`commande inattendue ${JSON.stringify(c)}`); } };
    const modele = n => ({
        db: { db },
        findById: id => ({ select: () => ({ lean: async () => structuredClone(col(n).get(id) ?? null) }) }),
        find: f => ({ lean: async () => structuredClone(tous(n, f)) }),
        updateOne: (f, u, o) => collection(n).updateOne(f, u, o)
    });
    return { cols, col, db, M: { Carte: modele('cartes'), Image: modele('images'), Set: modele('sets'), EtatImages: modele('collecte_images_etat') } };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdt-banc-'));
const IMG = (set, f) => `https://pokemoncardimages.pokedata.io/images/${set}/${f}`;
const SLUG = 'Trick-or-Trade-2024';

(async () => {
    const webp = (w, h = Math.round(w * 1000 / 728)) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 200 } } }).webp().toBuffer();
    const grand = await webp(728), petit = await webp(200), moyen = await webp(300), carre = await webp(728, 728);
    const FIXE = tmp(); C.fixerDossierArret(FIXE);          // l'emplacement FIXE de l'arrêt pointe un dossier temporaire pour tout le banc (jamais le vrai cache du testeur)
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async (u, init) => { vusFetch.push([String(u), init]); throw new Error('réseau interdit dans le banc'); };

    const defs = [[1, 'Mimikyu', '037a', '037'], [2, 'Gengar', '057', '057'], [3, 'Pikachu', '018', '018'], [4, 'Darkrai', '136', '136']];
    const plan = defs.map(([id, nom, rel, num], i) => ({ carteId: id, nomEn: nom, slugSet: SLUG, numero: null, produits: [900 + i], ligne: 'Trick or Trade 2024', numeroReleve: rel, url: IMG('Trick+or+Trade+2024', `${rel}.webp`), voie: 'set+numero-du-slug+nom', preuve: `${rel}`, genre: 'ajout', releve: 'releve--x.json' }));
    plan[0].correspondance = { relevee: '037a', fiche: '37', preuve: 'banc' };          // « 037a » lue 37 (preuve dans le plan) : le numéro D'ÉCRITURE est 37
    const cartes = plan.map(p => ({ set: 'Trick or Trade 2024', numero: p.numeroReleve, nom: p.nomEn, img: p.url }));

    // ── 1. les adresses autorisées ───────────────────────────────────────────────────────────────────────────────────────
    const aut = C.urlsAutorisees([...plan, { ...plan[0], url: IMG('Trick+or+Trade+2024', '999.webp') }, { ...plan[0], url: IMG('Trick+or+Trade+2024', '037a_240w.webp') }, { ...plan[0], url: 'https://autre.example/x.webp' }], cartes);
    verifier('adresses : celles du plan présentes mot pour mot dans le relevé passent ; hors relevé, _240w et autre hôte sont refusées et nommées', [aut.ok.length, aut.refusees.map(r => r.motif)], [4, ['hors-releve', 'adresse-hors-regle', 'adresse-hors-regle']]);

    // ── 2. TÉLÉCHARGER ───────────────────────────────────────────────────────────────────────────────────────────────────
    const reseau = rep => { try { fs.unlinkSync(C.fichierArret(FIXE)); } catch { /* aucun arrêt fixe posé */ } const appels = [];      // (chaque scénario repart sans arrêt fixe)
         return { appels, async get(url, o) { appels.push(url); return rep(url, o); } }; };
    const estRobots = u => /\/robots\.txt$/.test(u);
    const robotsLibre = { status: 404, type: 'application/xml', texte: '<Error>NoSuchKey</Error>' };       // l'hôte d'images : 404, aucune règle
    const normal = (url) => estRobots(url) ? robotsLibre : { status: 200, type: 'image/webp', octets: grand };
    const horloge = () => { let t = 1e6; const attentes = []; return { now: () => t, pause: async ms => { attentes.push(ms); t += ms; }, attentes }; };
    const lancer = (urls, tr, d, h = horloge(), o = {}) => C.telecharger({ urls, dossierCache: d, transport: tr, pause: h.pause, now: h.now, ...o });
    const urls = plan.map(p => p.url);

    let d = tmp(), h = horloge(), tr = reseau(normal);
    let r = await lancer(urls, tr, d, h);
    verifier('télécharger : robots.txt de l\'hôte d\'images D\'ABORD, puis les 4 images — 5 requêtes, plafond 4 + 1', [tr.appels[0], tr.appels.length, r.plafond, r.etat], ['https://pokemoncardimages.pokedata.io/robots.txt', 5, 5, 'termine']);
    verifier('cadence : jamais moins de 5 s entre deux requêtes', [h.attentes.length >= 4 && h.attentes.every(ms => ms >= 5000)], [true]);
    { const h0 = horloge(), t0 = reseau(normal); await lancer(urls, t0, tmp(), h0, { cadenceMs: 0 }); verifier('cadence : un réglage à 0 est RELEVÉ à 5 s', [h0.attentes.length, h0.attentes.every(ms => ms >= 5000)], [4, true]); }
    { const tp = reseau(normal), rp = await lancer(urls, tp, tmp(), horloge(), { plafond: 3 }); verifier('plafond : à 3 requêtes le téléchargement s\'arrête, sans fichier d\'arrêt', [rp.etat, tp.appels.length], ['interrompu', 3]); }
    const idx = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8'));
    verifier('cache : une entrée par adresse (fichier, sha256, 728 de large, .webp)', [Object.keys(idx.images).length, Object.values(idx.images).every(e => e.statut === 'ok' && e.w === 728 && /^[0-9a-f]{64}$/.test(e.sha256) && /\.webp$/.test(e.fichier) && fs.existsSync(path.join(d, e.fichier)))], [4, true]);
    tr = reseau(normal); r = await lancer(urls, tr, d);
    verifier('reprise : tout est en cache => zéro requête', [r.etat, tr.appels.length], ['rien-a-faire', 0]);
    d = tmp(); tr = reseau(u => estRobots(u) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /images/\n' } : normal(u));
    r = await lancer(urls, tr, d);
    verifier('robots.txt qui interdit : aucune image demandée, « robots-interdit », pas de fichier d\'arrêt', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['robots-interdit', 1, false]);
    d = tmp(); tr = reseau(normal);
    r = await lancer(['https://autre.example/x.webp', IMG('Trick+or+Trade+2024', '037a_240w.webp'), 'https://pokemoncardimages.pokedata.io/api/cards/1.webp', IMG('Trick+or+Trade+2024', '037a.webp') + '?x=1'], tr, d);
    verifier('adresse hors règle (autre hôte, _240w, API, paramètre) : refusée AVANT toute requête, même pas robots.txt', [r.etat, tr.appels.length, r.refusees.length], ['rien-a-faire', 0, 4]);

    const defis = [['401', () => ({ status: 401, type: 'text/html', texte: 'non' })], ['403', () => ({ status: 403, type: 'text/html', texte: 'non' })], ['410', () => ({ status: 410, type: 'text/html', texte: 'parti' })], ['429', () => ({ status: 429, type: 'text/html', texte: 'non' })],
        ['HTML au lieu d\'une image', () => ({ status: 200, type: 'text/html', texte: '<html>Just a moment</html>' })], ['cf-mitigated', () => ({ status: 200, type: 'image/webp', octets: grand, cfMitigated: 'challenge' })],
        ['Imperva', () => ({ status: 200, type: 'image/webp', octets: grand, imperva: true })], ['redirection 302', () => ({ status: 302, location: 'https://autre.example/x' })], ['redirection 301', () => ({ status: 301, location: 'https://www.pokedata.io/' })],
        ['octets qui ne sont pas un WebP', () => ({ status: 200, type: 'image/webp', octets: Buffer.from('<html>defi</html>') })], ['403 à corps vide', () => ({ status: 403, type: '', texte: '' })],
        ['403 dont le corps est une image', () => ({ status: 403, type: 'image/webp', octets: grand })], ['429 à corps vide', () => ({ status: 429 })], ['connexion obligatoire (corps « sign in »)', () => ({ status: 200, type: 'text/html', texte: '<html>Please sign in to continue, captcha</html>' })]];
    for (const [nom, rep] of defis) {
        d = tmp(); tr = reseau(u => estRobots(u) ? robotsLibre : rep());
        r = await lancer(urls, tr, d);
        verifier(`défi (${nom}) : ARRÊT DÉFINITIF dès la première image (robots + 1 image), fichier d'arrêt écrit`, [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['arret-definitif', 2, true]);
        tr = reseau(normal); const r2 = await lancer(urls, tr, d);
        verifier('   le lancement suivant REFUSE de partir tant que le fichier existe (zéro requête)', [r2.etat, tr.appels.length], ['refuse-arret', 0]);
    }
    d = tmp(); tr = reseau(u => estRobots(u) ? { status: 403, type: 'text/html', texte: 'non' } : normal(u)); r = await lancer(urls, tr, d);
    verifier('robots.txt en 403 : arrêt définitif, une seule requête', [r.etat, tr.appels.length], ['arret-definitif', 1]);
    d = tmp(); tr = reseau(u => estRobots(u) ? { status: 404, type: 'text/html', texte: '<html><title>Just a moment...</title></html>' } : normal(u)); r = await lancer(urls, tr, d);
    verifier('robots.txt 404 AVEC marqueur de défi : arrêt définitif', [r.etat, tr.appels.length], ['arret-definitif', 1]);
    d = tmp(); tr = reseau(u => estRobots(u) ? robotsLibre : /136/.test(u) ? { status: 404, type: 'text/html', texte: '<Error>NoSuchKey</Error>' } : { status: 200, type: 'image/webp', octets: grand });
    r = await lancer(urls, tr, d);
    verifier('404 : « absent », les autres continuent, pas d\'arrêt', [r.etat, JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images[plan[3].url]?.statut, fs.existsSync(C.fichierArret(d))], ['termine', 'absent', false]);
    d = tmp(); let n = 0; tr = reseau(u => estRobots(u) ? robotsLibre : (++n === 2 ? { status: 503, type: 'text/html', texte: 'x' } : { status: 200, type: 'image/webp', octets: grand }));
    r = await lancer(urls, tr, d);
    verifier('5xx : « interrompu » sans fichier d\'arrêt, pas de réessai', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['interrompu', 3, false]);
    d = tmp(); tr = reseau(u => { if (estRobots(u)) return robotsLibre; throw Object.assign(new Error('ECONNRESET'), { reseau: true }); }); r = await lancer(urls, tr, d);
    verifier('coupure réseau : « interrompu », pas d\'arrêt définitif', [r.etat, fs.existsSync(C.fichierArret(d))], ['interrompu', false]);
    // le dos de carte et la forme inattendue : refusés, on continue, rien dans le cache
    const dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
    d = tmp(); tr = reseau(u => estRobots(u) ? robotsLibre : /037a/.test(u) ? { status: 200, type: 'image/png', octets: dos } : /057/.test(u) ? { status: 200, type: 'image/webp', octets: carre } : /018/.test(u) ? { status: 200, type: 'image/webp', octets: petit } : { status: 200, type: 'image/webp', octets: grand });
    r = await lancer(urls, tr, d);
    const ix = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images;
    verifier('dos de carte (empreinte) et image carrée : REFUSÉS (statuts nommés, rien en cache) ; une petite image de forme juste est gardée (le seuil se juge à l\'écriture) ; pas d\'arrêt', [r.etat, plan.map(p => ix[p.url]?.statut), fs.existsSync(C.fichierArret(d))], ['termine', ['dos-de-carte', 'forme-inattendue', 'ok', 'ok'], false]);

    // les PAGES : même discipline, hôte des pages, et l'image n'est pas une page
    const pageHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'pokedata-page-set-tot2024.html'), 'utf8');
    const pagesOk = u => estRobots(u) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow:\n' } : { status: 200, type: 'text/html; charset=utf-8', texte: pageHtml };
    const urlPage = P.urlPageDuSet('Trick or Trade 2024');
    d = tmp(); tr = reseau(pagesOk); h = horloge();
    r = await C.telecharger({ urls: [urlPage], dossierCache: d, genre: 'page', transport: tr, pause: h.pause, now: h.now });
    verifier('pages : robots.txt de www.pokedata.io d\'abord, puis la page du set ; 2 requêtes, mise en cache', [tr.appels, r.etat, fs.existsSync(path.join(d, 'index-pages.json'))], [['https://www.pokedata.io/robots.txt', urlPage], 'termine', true]);
    d = tmp(); tr = reseau(pagesOk);
    r = await C.telecharger({ urls: ['https://www.pokedata.io/api/set/Trick+or+Trade+2024', 'https://www.pokedata.io/set/Pitch+Black', 'https://www.pokedata.io/_next/static/chunks/pages/set/%5Bset_name%5D-cbb234bcbbd2895e.js', IMG('Trick+or+Trade+2024', '037a.webp')], dossierCache: d, genre: 'page', transport: tr });
    verifier('pages : une API, un set hors table, un fragment de code, une adresse d\'image => refusés AVANT toute requête', [r.etat, tr.appels.length, r.refusees.length], ['rien-a-faire', 0, 4]);
    d = tmp(); tr = reseau(u => estRobots(u) ? pagesOk(u) : { status: 403, type: 'text/html', texte: 'non' });
    r = await C.telecharger({ urls: [urlPage], dossierCache: d, genre: 'page', transport: tr });
    verifier('pages : 403 => ARRÊT DÉFINITIF DE LA SOURCE (le fichier d\'arrêt est commun : les images refusent de partir aussi)', [r.etat, (await lancer(urls, reseau(normal), d)).etat], ['arret-definitif', 'refuse-arret']);
    d = tmp(); tr = reseau(u => estRobots(u) ? pagesOk(u) : { status: 200, type: 'application/json', texte: '{"cards":[]}' });
    r = await C.telecharger({ urls: [urlPage], dossierCache: d, genre: 'page', transport: tr });
    verifier('pages : une réponse qui n\'est pas une page HTML (JSON) => arrêt définitif (rien d\'autre qu\'une page n\'est attendu)', r.etat, 'arret-definitif');
    // le relevé depuis les pages en cache : la page réelle ne porte AUCUNE carte => un compte nommé, jamais un relevé vide présenté comme complet
    d = tmp(); await C.telecharger({ urls: [urlPage], dossierCache: d, genre: 'page', transport: reseau(pagesOk), pause: async () => { }, now: horloge().now });
    const rv = C.releverDepuisPages({ dossierCache: d, urls: [urlPage] });
    verifier('relevé depuis la page réelle : 0 carte, motif « rendu-cote-client », aucun fichier de relevé écrit', [rv.ecrits.length, rv.sansCartes.map(x => x.motif), fs.existsSync(path.join(d, 'releves'))], [0, ['rendu-cote-client'], false]);

    // le CLI : sortie propre, arguments inconnus refusés avant toute connexion
    verifier('le CLI ne contient AUCUN process.exit( (process.exitCode seulement)', /process\.exit\(/.test(fs.readFileSync(path.join(__dirname, 'collecteur-images-pokedata.js'), 'utf8')), false);
    { const { spawnSync } = require('child_process'); const dos2 = tmp();
      const cli = a => spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-pokedata.js'), ...a], { encoding: 'utf8', cwd: dos2, env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
      for (const a of [['--inconnu'], ['--plan', '--ecrire'], ['--ecrire'], ['--attendu=3'], ['--telecharger', '--sets=../x']]) { const m = cli(a); verifier(`CLI ${a.join(' ')} : code 2 propre, refus avant toute connexion`, [m.status, /argument inconnu|un seul mode|exige/.test(m.stderr || ''), /Assertion failed/.test(m.stderr || '')], [2, true, false]); }
      fs.mkdirSync(path.join(dos2, 'cache')); fs.writeFileSync(path.join(dos2, 'plan.json'), JSON.stringify({ plan: [], remplacements: [], setsAReleve: [] })); fs.writeFileSync(path.join(dos2, 'cache', 'ARRET-DEFINITIF.json'), '{}');
      const m = cli(['--telecharger', `--cache=${path.join(dos2, 'cache')}`, `--sortie=${path.join(dos2, 'plan.json')}`, `--releves=${path.join(dos2, 'rel')}`]);
      verifier('CLI --telecharger avec un fichier d\'arrêt : code 1 propre, stderr sans assertion', [m.status, /Assertion failed/.test(m.stderr || '')], [1, false]); }

    // le transport RÉEL : agent honnête seul, redirection jamais suivie, garde de l'hôte avant fetch
    vusFetch.length = 0; let err = null;
    try { await C.transportFetch.get(plan[0].url, { genre: 'image', binaire: true }); } catch (e) { err = e; }
    verifier('transport réel : en-têtes = l\'agent du dépôt seul, redirect « manual », aucun cookie', [vusFetch.length, Object.keys(vusFetch[0]?.[1]?.headers || {}), vusFetch[0]?.[1]?.redirect, vusFetch[0]?.[1]?.credentials ?? null], [1, ['User-Agent'], 'manual', null]);
    for (const u of ['https://autre.example/x.webp', 'https://www.pokedata.io/api/sets', 'https://pokemoncardimages.pokedata.io/images/Trick+or+Trade+2024/037a_240w.webp']) {
        vusFetch.length = 0; err = null; try { await C.transportFetch.get(u, { genre: 'image' }); } catch (e) { err = e; }
        verifier(`transport réel : ${u.slice(8, 60)}… refusé AVANT fetch`, [!!err, vusFetch.length], [true, 0]);
    }
    vusFetch.length = 0; err = null; try { await C.transportFetch.get(IMG('Trick+or+Trade+2024', '037a.webp'), { genre: 'page' }); } catch (e) { err = e; }
    verifier('transport réel : une adresse d\'image demandée comme PAGE est refusée avant fetch', [!!err, vusFetch.length], [true, 0]);

    // ── 2 bis. CORRECTION 2 : aucune adresse ne se construit ; la décision sur une réponse est UNE fonction ; l'arrêt a un emplacement FIXE ─────────
    { const src = fs.readFileSync(path.join(__dirname, 'collecteur-images-pokedata.js'), 'utf8').replace(/(^|\s)\/\/.*$/gm, '$1');
      verifier('le collecteur n\'exporte ni ne contient aucun chemin de construction ni d\'échantillon d\'adresses construites', ['sonderEchantillon', 'tauxDeReponse', 'choisirEchantillon', 'construire'].filter(k => k in C || src.includes(k)), []);
      const { spawnSync } = require('child_process'); const dosC = tmp();
      const cliC = a => spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-pokedata.js'), ...a], { encoding: 'utf8', cwd: dosC, env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
      for (const a of [['--construire'], ['--sonde-echantillon=20'], ['--plan', '--construit'], ['--telecharger', '--construit'], ['--produits=x'], ['--plan-construit=x']]) { const x = cliC(a); verifier(`CLI ${a.join(' ')} : refusé (code 2), aucune connexion`, [x.status, /argument inconnu/.test(x.stderr || '')], [2, true]); } }
    // la décision : UNE fonction, ses quatre issues
    verifier('jugerReponse : 200 => recevoir ; 404 => absent ; 5xx => interrompu ; 401/403/410/429/3xx/cf/Imperva/marqueur => arret', [[200, 'x'], [404, ''], [503, ''], [401, ''], [403, ''], [410, ''], [429, ''], [302, ''], [200, 'Just a moment']].map(([st, t]) => C.jugerReponse({ status: st, texte: t }).action).concat(C.jugerReponse({ status: 200, cfMitigated: 'challenge' }).action, C.jugerReponse({ status: 200, imperva: true }).action), ['recevoir', 'absent', 'interrompu', 'arret', 'arret', 'arret', 'arret', 'arret', 'arret', 'arret', 'arret']);
    verifier('le corps de telecharger ne décide plus lui-même : il appelle jugerReponse (une seule définition de « arrêt / absent / interrompu »)', [/jugerReponse\(r, url\)/.test(fs.readFileSync(path.join(__dirname, 'collecteur-images-pokedata.js'), 'utf8')), (fs.readFileSync(path.join(__dirname, 'collecteur-images-pokedata.js'), 'utf8').match(/statut: 'absent', status/g) || []).length], [true, 1]);
    // l'emplacement FIXE de l'arrêt : un autre --cache ne contourne pas
    { const fixe = FIXE; const autreCache = tmp(), t = reseau(normal); fs.writeFileSync(C.fichierArret(fixe), '{}');
      const rf = await lancer(urls, t, autreCache);
      verifier('arrêt à emplacement FIXE : un fichier d\'arrêt à l\'endroit fixe refuse un téléchargement dans un AUTRE dossier de cache (zéro requête)', [rf.etat, t.appels.length], ['refuse-arret', 0]);
      const t2 = reseau(u => (estRobots(u) ? robotsLibre : { status: 403, type: 'text/html', texte: 'non' }));
      const autre2 = tmp(); const r2 = await lancer(urls, t2, autre2);
      verifier('un vrai défi écrit l\'arrêt AUSSI à l\'emplacement fixe (le dossier de travail et le fixe)', [r2.etat, fs.existsSync(C.fichierArret(autre2)), fs.existsSync(C.fichierArret(fixe))], ['arret-definitif', true, true]);
    }
    // la planche étiquetée : la vignette + le set / numéro de la source / nom de NOTRE fiche (images posées en cache, aucune requête)
    { const dP = tmp(); const set20 = ['Trick+or+Trade+2024', 'Pitch+Black', 'Chaos+Rising', 'Stellar+Crown'];
      const echant = Array.from({ length: 20 }, (_, i) => ({ carteId: 500 + i, nomEn: `Carte ${i}`, slugSet: `S${i % 4}`, ligne: set20[i % 4].replace(/\+/g, ' '), numeroReleve: String(i + 1).padStart(3, '0'), url: IMG(set20[i % 4], `${String(i + 1).padStart(3, '0')}.webp`) }));
      await lancer(echant.map(u => u.url), reseau(normal), dP);
      const pl = await C.fabriquerPlancheEtiquetee({ dossierCache: dP, echantillon: echant, sortie: path.join(dP, 'planche.png') });
      const mp = await sharp(path.join(dP, 'planche.png')).metadata();
      verifier('planche étiquetée : 20 vignettes, 5 par rang, une bande d\'étiquette sous chacune', [pl.images, mp.width, mp.height > 4 * 330], [20, 1200, true]);
      verifier('planche étiquetée : les étiquettes portent set, numéro de la source et nom de NOTRE fiche', pl.etiquettes.every(e => /Carte \d+/.test(e.ligne2) && /^[A-Za-z0-9 ']+ \d{3}$/.test(e.ligne1)), true); }

    // ── 3. ÉCRIRE : depuis le cache seulement ───────────────────────────────────────────────────────────────────────────────
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    const dc = tmp();
    await lancer(urls, reseau(u => estRobots(u) ? robotsLibre : /136/.test(u) ? { status: 200, type: 'image/webp', octets: moyen } : { status: 200, type: 'image/webp', octets: grand }), dc);
    const semer = B => {
        B.col('sets').set(SLUG, { _id: SLUG, tirage: 'intl', region: 'intl' });
        for (const [id, nom, , , prod] of defs.map((x, i) => [...x, 900 + i])) {
            B.col('cartes').set(id, { _id: id, nomEn: nom, images: [{ set: 'Autre', source: 'tcgdex', numero: '1', cleR2: 'tcgdex/x.webp', langue: 'en' }] });
            B.col('cartes_produits').set(`${id}|${prod}`, { _id: `${id}|${prod}`, carteId: id, idProduct: prod, numeroFiche: null, slugSet: SLUG });
        }
    };
    const depotsDe = () => { const l = []; return { l, f: async (...a) => l.push(a) }; };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const vignetterBanc = () => (db, slug, o) => vignetterApresJointure(db, slug, { ...o, journal: { error() { } }, assurer: async (db2, { slug: s }) => { let k = 0; for (const c of await db2.collection('cartes').find({}).toArray()) { let t = false; const images = (c.images || []).map(e => { if (e.set !== s || !e.cleR2 || e.vignette) return e; t = true; k++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2}`, w: 200, h: 279 } }; }); if (t) await db2.collection('cartes').updateOne({ _id: c._id }, { $set: { images } }); } return { entrees: k, cles: k, traitees: k, fabriquees: k, deja: 0, depuisDocument: 0, echecs: [], interrompu: false, sets: k ? [s] : [] }; } });
    const ecrire = async (B, o = {}) => { const dp = depotsDe(); const q = silencieux(); try { const b = await C.ecrire(o.plan || plan, B.M, { dossierCache: o.dossierCache || dc, attendu: o.attendu, remplacements: o.remplacements, remplacer: o.remplacer, deposer: dp.f, vignetter: vignetterBanc(), fabriquerVerrouSet: verrouSet }); return { b, dp }; } finally { q(); } };
    let B = fausseBase(); semer(B);
    verifier('--attendu qui diffère du compte réel (3 à écrire : l\'une, 300 px, est sous le seuil de 350) : REFUSÉ avant toute écriture', await (async () => { const { b, dp } = await ecrire(B, { attendu: 4 }); return [b.code, b.etat, dp.l.length, B.col('images').size]; })(), [2, 'refuse-attendu', 0, 0]);
    let { b, dp } = await ecrire(B, { attendu: 3 });
    verifier('écrire : 3 images écrites, la 4e (300 px) est « trop-petit » ; code 0 ; AUCUNE requête (fetch jamais appelé)', [b.code, dp.l.length, vusFetch.length], [0, 3, 0]);
    const doc = B.col('images').get(P.idImage(SLUG, 1, '37'));
    verifier('R2 AVANT la ligne : clé NEUVE pdt/…, WebP ; la clé ne contient pas le nom de la source', [dp.l[0][1], dp.l[0][3], dp.l.some(x => /pokedata/i.test(x[1]))], [P.cleR2(SLUG, '37', 1) === dp.l[0][1] ? dp.l[0][1] : 'cle-inattendue', 'image/webp', false]);
    verifier('le document `images` : source, lot, adresse d\'origine, retirable, date, mention, langue', [doc.source, doc.lot, doc.urlOriginal, doc.retirable, doc.collecteLe instanceof Date, doc.mention, doc.langue], ['pokedata', 'pokedata-2026-10', plan[0].url, true, true, P.MENTION, 'en']);
    verifier('le document de l\'image sous le seuil : « trop-petit », seuil 350, rien de joint', [B.col('images').get(P.idImage(SLUG, 4, '136'))?.etat, B.col('images').get(P.idImage(SLUG, 4, '136'))?.seuilApplique, B.col('cartes').get(4).images.length], ['trop-petit', 350, 1]);
    const e1 = B.col('cartes').get(1).images.find(e => e.source === 'pokedata');
    verifier('l\'entrée de la carte : set, source, lot, traçabilité, mention, langue ; l\'autre source INTACTE', [e1.set, e1.source, e1.lot, e1.retirable, e1.urlOriginal, e1.collecteLe instanceof Date, e1.mention, e1.langue, B.col('cartes').get(1).images.find(e => e.source === 'tcgdex').cleR2], [SLUG, 'pokedata', 'pokedata-2026-10', true, plan[0].url, true, P.MENTION, 'en', 'tcgdex/x.webp']);
    const publics = e => JSON.stringify([e.cleR2, e.vignette?.cleR2, e.attribution, e.mention, e.langue, e.languePreuve, e.numero, e.set, e.fmt]);
    verifier('AUCUN champ lu par le site ou l\'API (clé, vignette, attribution, mention, langue, preuve, numéro, set, format) ne contient « pokedata »', [publics(e1), publics(doc)].map(s => /pokedata/i.test(s)), [false, false]);
    verifier('le bilan du set ne porte pas le nom de la source dans son nom de champ', Object.keys(B.col('sets').get(SLUG)).some(k => /pokedata/i.test(k)), false);
    verifier('le bilan du set : garde verte, 3 joints', [B.col('sets').get(SLUG).bilanLotPdt?.garde?.ok, B.col('sets').get(SLUG).bilanLotPdt?.joints], [true, 3]);
    ({ b, dp } = await ecrire(B, { attendu: 3 }));
    verifier('rejeu : rien de redéposé, une entrée par fiche (idempotent)', [dp.l.length, B.col('cartes').get(1).images.filter(e => e.source === 'pokedata').length], [0, 1]);
    B = fausseBase(); semer(B); B.col('cartes').get(2).images.push({ set: SLUG, source: 'bulbapedia', numero: '057', cleR2: 'bulbapedia/b.webp', langue: 'en' });
    ({ b, dp } = await ecrire(B, { attendu: 3 }));
    verifier('additif : une autre source a servi ce numéro entre-temps => la nôtre CÈDE, l\'entrée de l\'autre est intacte', [b.resultats.find(x => x.code === SLUG).dejaParAutre, B.col('cartes').get(2).images.filter(e => e.source === 'pokedata').length, B.col('cartes').get(2).images.find(e => e.source === 'bulbapedia').cleR2], [1, 0, 'bulbapedia/b.webp']);
    B = fausseBase(); semer(B);
    const dc2 = tmp(); await lancer(urls.slice(0, 2), reseau(normal), dc2);
    ({ b, dp } = await ecrire(B, { dossierCache: dc2, attendu: 2 }));
    verifier('une adresse du plan absente du cache n\'est pas écrite (« hors-cache »)', [b.horsCache, dp.l.length], [2, 2]);
    const i3 = JSON.parse(fs.readFileSync(path.join(dc2, 'index.json'), 'utf8')); fs.writeFileSync(path.join(dc2, Object.values(i3.images)[0].fichier), Buffer.from('altéré'));
    B = fausseBase(); semer(B);
    ({ b, dp } = await ecrire(B, { dossierCache: dc2, attendu: 1 }));
    verifier('un fichier du cache dont le sha256 ne correspond plus est refusé', [b.altere, dp.l.length], [1, 1]);
    B = fausseBase(); semer(B); B.col('sets').set(SLUG, { _id: SLUG, tirage: 'jp', region: 'jp' });
    ({ b, dp } = await ecrire(B, { attendu: 3 }));
    verifier('un set dont le tirage n\'est pas occidental : refusé (la source ne sert que des cartes anglaises), rien déposé', [dp.l.length, b.resultats[0]?.etat], [0, 'refuse-set']);

    // ── 3 bis. LE REMPLACEMENT (doctrine) : préparé, jamais actif sans --remplacer ──────────────────────────────────────────
    const ANC = { set: SLUG, source: 'pokumon', numero: '037', cleR2: 'pokumon/anc.webp', langue: 'en', w: 320, wOriginal: 320, basseDefinition: true };
    const semerAnc = Bx => { semer(Bx); Bx.col('cartes').get(1).images.push({ ...ANC }); Bx.col('images').set('anc', { _id: 'anc', source: 'pokumon', set: SLUG, carteId: 1, cleR2: ANC.cleR2, etat: 'ok' }); };
    const remp = [{ ...plan[0], genre: 'remplacement', motifRemplacement: 'basse-definition', refusees: [{ cleR2: ANC.cleR2, source: 'pokumon', numero: '037', langue: 'en' }] }];
    B = fausseBase(); semerAnc(B);
    ({ b, dp } = await ecrire(B, { plan: [], remplacements: remp, attendu: 0 }));
    verifier('SANS --remplacer : rien ne bouge (ni l\'entrée en basse définition, ni le document, ni un dépôt R2)', [dp.l.length, B.col('cartes').get(1).images.map(e => e.source), B.col('images').get('anc').etat], [0, ['tcgdex', 'pokumon'], 'ok']);
    B = fausseBase(); semerAnc(B);
    ({ b, dp } = await ecrire(B, { plan: [], remplacements: remp, remplacer: [999], attendu: 0 }));
    verifier('--remplacer avec un idProduct hors des remplacements du plan : REFUSÉ avant toute écriture (liste fermée)', [b.code, b.etat, dp.l.length], [2, 'refuse-remplacer', 0]);
    B = fausseBase(); semerAnc(B);
    ({ b, dp } = await ecrire(B, { plan: [], remplacements: remp, remplacer: [900], attendu: 1 }));
    verifier('--remplacer=900 : l\'ancienne entrée sort, la nôtre entre au même (set, numéro) ; l\'autre source reste', [b.code, B.col('cartes').get(1).images.map(e => `${e.source}:${e.numero}`).sort()], [0, ['pokedata:37', 'tcgdex:1']]);
    verifier('   le document remplacé n\'est pas supprimé : état « remplace », motif et remplaçante écrits', [B.col('images').get('anc').etat, !!B.col('images').get('anc').remplaceMotif, B.col('images').get('anc').remplaceePar], ['remplace', true, P.idImage(SLUG, 1, '37')]);

    // ── 4. RETIRER : toute la source, en une commande, à blanc par défaut ────────────────────────────────────────────────────
    const { retirerLot } = require('./retirer-visuels-pokedata');
    B = fausseBase(); semer(B); await ecrire(B, { attendu: 3 });
    B.col('cartes').get(2).images.push({ set: SLUG, source: 'pokumon', lot: 'x', numero: '9', cleR2: 'pokumon/autre.webp' });
    const sup = []; const blanc = await retirerLot(B.db, {});
    verifier('retrait À BLANC par défaut : comptes, rien n\'est modifié', [blanc.entrees, blanc.cartes.length, B.col('cartes').get(1).images.some(e => e.source === 'pokedata')], [3, 3, true]);
    const rr = await retirerLot(B.db, { ecrire: true, effacerR2: true, supprimer: async (bk, cles) => sup.push(...cles), verifierBucket: async () => { }, bucket: 'bucket-banc' });
    verifier('retrait : toutes les entrées de la source sortent ; l\'autre source reste ; documents « retire » ; le bilan de set est nettoyé', [B.col('cartes').get(1).images.some(e => e.source === 'pokedata'), B.col('cartes').get(2).images.some(e => e.source === 'pokumon'), B.col('images').get(P.idImage(SLUG, 1, '37')).etat, B.col('sets').get(SLUG).bilanLotPdt, rr.reste], [false, true, 'retire', undefined, 0]);
    verifier('   les clés R2 effacées sont celles de la source seule (pdt/ et ses vignettes)', [sup.length > 0 && sup.every(c => c.startsWith('pdt/') || c.startsWith('vignettes/pdt/'))], [true]);
    { const Bs = fausseBase(); semer(Bs); await ecrire(Bs, { attendu: 3 }); Bs.col('cartes').get(1).images.find(e => e.source === 'pokedata').lot = 'pokedata-2099-01';
      const rs = await retirerLot(Bs.db, { ecrire: true });
      verifier('retrait de TOUTE la source : un autre lot de la même source part aussi (c\'est la source, pas un lot)', [Bs.col('cartes').get(1).images.some(e => e.source === 'pokedata'), rs.reste], [false, 0]); }

    global.fetch = fetchOrigine;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });
