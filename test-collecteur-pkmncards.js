// node test-collecteur-pkmncards.js — le collecteur de scans (collecteur-images-pkmncards.js) en TROIS PHASES + planche, le retrait et les gardes (lot PKMNCARDS, 2026-10-17).
// Aucune requête (transport simulé ; global.fetch REMPLACÉ par un piège qui lève), aucune base réelle (base en mémoire), aucun R2 (faux dépôt), dossiers TEMPORAIRES (jamais un vrai chemin du testeur).
//   · TÉLÉCHARGER : seules les adresses du plan présentes mot pour mot dans le sitemap ; robots.txt lu d'abord et respecté (le VRAI robots.txt de la source en fixture) ; cadence ≥ 5 s ; plafond = adresses + 1 ;
//     403 / 429 / HTML / cf-mitigated / 3xx / octets qui ne sont pas une image => ARRÊT DÉFINITIF (fichier d'arrêt) ; 404 => absent ; 5xx / coupure => interrompu SANS fichier ;
//   · CONTRÔLER : dos de carte, taille, rapport, même empreinte sous deux adresses ; la PLANCHER que le coordinateur regarde ;
//   · ÉCRIRE : depuis le cache seulement (0 requête), ajout ou remplacement, seuil, --attendu, rejets, aucun champ public ne nomme la source, vignettes, garde de lot ; RETIRER : exactement le lot.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pkmncards');
const C = require('./collecteur-images-pkmncards');
const RH = require('./collecte-cartes/reponse-hote');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
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

const H = `https://${P.HOTE}`;
const UP = f => `${H}/wp-content/uploads/${f}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pkc-banc-'));
const dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
const robotsReel = fs.readFileSync(path.join(__dirname, 'fixtures', 'pkmncards-robots.txt'), 'utf8').replace(/@@HOTE@@/g, H);

(async () => {
    const png = (w, h = Math.round(w * 1.397), fond = { r: 30, g: 120, b: 200 }) => sharp({ create: { width: w, height: h, channels: 3, background: fond } }).png().toBuffer();
    const jpg = (w, h = Math.round(w * 1.397)) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } } }).jpeg().toBuffer();
    const grand = await png(733, 1024), petit = await png(300), autre = await png(733, 1024, { r: 90, g: 140, b: 60 });
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async (u, init) => { vusFetch.push([String(u), init]); throw new Error('réseau interdit dans le banc'); };

    // un plan de trois unités du lot « mcdo » (Match Battle 2023) : un AJOUT, un REMPLACEMENT d'une basse définition (320 px), une 3e sous le seuil de la source
    const U = (carteId, numero, f, o = {}) => ({ carteId, nomEn: `Carte ${carteId}`, slugSet: 'McDonalds-Match-Battle-2023', numero, produits: [900 + carteId], pkcSet: 'mcdonalds-match-battle-2023', numeroPkc: numero, nomPkc: `carte ${carteId}`, url: UP(f), loc: `${H}/card/x/`, voie: 'set+numero+nom', preuve: `set mcdonalds-match-battle-2023 n°${numero}`, action: 'ajout', remplace: [], aRegarder: false, ...o });
    const plan = [U(1, '001', 'm23_en_001_std.png'), U(2, '002', 'm23_en_002_std.png', { action: 'remplacement', remplace: [{ source: 'pokumon', cleR2: 'pokumon/old-2.webp', numero: '002', w: 320, langue: 'en' }] }), U(3, '003', 'm23_en_003_std.png')];
    const entreesSitemap = plan.map(u => ({ loc: u.loc, img: u.url }));

    // ── 1. LES ADRESSES AUTORISÉES ─────────────────────────────────────────────────────────────────────────────────────────────
    const aut = C.urlsAutorisees([...plan, { ...plan[0], url: UP('absente-du-sitemap.png') }, { ...plan[0], url: 'https://autre.example/x.png' }, { ...plan[0], url: `${H}/?s=pikachu` }], entreesSitemap);
    verifier('adresses : celles du plan présentes mot pour mot dans le sitemap passent ; hors sitemap, autre hôte, recherche (?s=) sont refusées et nommées', [aut.ok.length, aut.refusees.map(r => r.motif)], [3, ['hors-sitemap', 'adresse-hors-regle', 'adresse-hors-regle']]);

    // ── 2. TÉLÉCHARGER ───────────────────────────────────────────────────────────────────────────────────────────────────────────
    const reseau = rep => { const appels = []; return { appels, async get(url, o) { appels.push(url); return rep(url, o); } }; };
    const robotsLibre = { status: 200, type: 'text/plain', texte: robotsReel };           // le VRAI robots.txt de la source : « Disallow: /*?s= » seul
    const normal = (url, o) => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: /m23_en_003/.test(url) ? petit : grand };
    const horloge = () => { let t = 1e6; const attentes = []; return { now: () => t, pause: async ms => { attentes.push(ms); t += ms; }, avance: ms => { t += ms; }, attentes }; };
    const lancer = (urls, tr, d, h = horloge(), o = {}) => (o.processus || require('./collecte-cartes/reponse-hote').reinitialiserSuiviProcessus(), C.telecharger({ urls, dossierCache: d, transport: tr, pause: h.pause, now: h.now, ...o }));
    const urls = plan.map(p => p.url);

    let d = tmp(), h = horloge(), tr = reseau(normal);
    let r = await lancer(urls, tr, d, h);
    verifier('télécharger : robots.txt D\'ABORD, puis les 3 images — 4 requêtes, plafond = 3 + 1', [tr.appels[0], tr.appels.length, r.plafond, r.etat], [P.ROBOTS, 4, 4, 'termine']);
    verifier('cadence : entre deux requêtes, jamais moins de 5 s', [h.attentes.length >= 3 && h.attentes.every(ms => ms >= 5000)], [true]);
    { const h0 = horloge(), tr0 = reseau(normal); await lancer(urls, tr0, tmp(), h0, { cadenceMs: 0 });
      verifier('cadence : un réglage à 0 est RELEVÉ à 5 s (plancher imposé)', [tr0.appels.length, h0.attentes.length, h0.attentes.every(ms => ms >= 5000)], [4, 3, true]); }
    { const trp = reseau(normal), rp = await lancer(urls, trp, tmp(), horloge(), { plafond: 2 });
      verifier('plafond : à 2 requêtes (robots + 1 image) le téléchargement s\'arrête, sans fichier d\'arrêt', [rp.etat, trp.appels.length, /plafond/.test(rp.motif || '')], ['interrompu', 2, true]); }
    const idx = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8'));
    verifier('cache : une entrée par adresse (fichier, sha256, largeur, hauteur) ; le fichier existe', [Object.keys(idx.images).length, Object.values(idx.images).every(e => e.statut === 'ok' && /^[0-9a-f]{64}$/.test(e.sha256) && e.w > 0 && e.h > 0 && fs.existsSync(path.join(d, e.fichier)))], [3, true]);
    verifier('cache : le fichier garde le nom de l\'adresse (à plat) ; largeurs 733, 733, 300', Object.values(idx.images).map(e => [e.fichier.replace(/\\/g, '/'), e.w]), [['img/m23_en_001_std.png', 733], ['img/m23_en_002_std.png', 733], ['img/m23_en_003_std.png', 300]]);
    tr = reseau(normal); r = await lancer(urls, tr, d);
    verifier('reprise : tout est en cache => zéro requête (pas même robots.txt)', [r.etat, tr.appels.length], ['rien-a-faire', 0]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /wp-content/\n' } : normal(url));
    r = await lancer(urls, tr, d);
    verifier('robots.txt qui interdit /wp-content/ : aucune image demandée, « robots-interdit », pas de fichier d\'arrêt', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['robots-interdit', 1, false]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /\n' } : normal(url));
    r = await lancer(urls, tr, d);
    verifier('robots.txt qui interdit la racine : aucune image demandée', [r.etat, tr.appels.length], ['robots-interdit', 1]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nCrawl-delay: 20\n' } : normal(url)); h = horloge();
    r = await lancer(urls, tr, d, h);
    verifier('Crawl-delay de 20 s : la cadence monte à 20 s', [r.etat, h.attentes.every(ms => ms >= 20000)], ['termine', true]);
    d = tmp(); tr = reseau(normal);
    r = await lancer(['https://autre.example/x.png', `${H}/?s=pikachu`, `${H}/card/x/`, `${H}/wp-content/uploads/../secret.png`, UP('a.png') + '?x=1'], tr, d);
    verifier('télécharger : autre hôte, recherche (?s=), page de carte, remontée, paramètre -> refusés AVANT toute requête (même pas robots.txt)', [r.etat, tr.appels.length, r.refusees.length], ['rien-a-faire', 0, 5]);
    // arrêt définitif
    const defis = [['403', () => ({ status: 403, type: 'text/html', texte: 'non' })], ['429', () => ({ status: 429, type: 'text/html', texte: 'non' })], ['HTML au lieu d\'une image', () => ({ status: 200, type: 'text/html', texte: '<html>Just a moment</html>' })],
        ['cf-mitigated', () => ({ status: 200, type: 'image/png', octets: grand, cfMitigated: 'challenge' })],
        ['Imperva avec un corps qui n\'est pas une image (REPONSE-HOTE : l\'en-tête seul ne prouve rien)', () => ({ status: 200, type: 'text/html', texte: '<html><body>page</body></html>', imperva: true })],
        ['octets qui ne sont pas une image mais portent un marqueur de défi', () => ({ status: 200, type: 'image/png', octets: Buffer.from('<html>Just a moment</html>') })], ['403 à corps VIDE', () => ({ status: 403, type: '', texte: '' })],
        ['403 dont le corps est une IMAGE', () => ({ status: 403, type: 'image/png', octets: grand })], ['429 à corps vide', () => ({ status: 429 })], ['429 dont le corps est une image', () => ({ status: 429, type: 'image/png', octets: grand })],
        ['401 (connexion obligatoire)', () => ({ status: 401, type: 'text/html', texte: 'login' })], ['410 (disparue : pas un « absent »)', () => ({ status: 410, type: 'text/html', texte: 'gone' })],
        ['captcha dans une page à la place de l\'image', () => ({ status: 200, type: 'text/html', texte: '<div class="g-recaptcha"></div>' })]];
    // REPONSE-HOTE (2026-10-18) : ce qui n'était plus un arrêt définitif — la fausse page introuvable (absente), l'inattendu (PAUSE de l'hôte), l'ambigu (pause persistante)
    {
        const dp = () => tmp();
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /m23_en_002/.test(url) ? { status: 200, type: 'text/html', texte: '<html><body>Page introuvable</body></html>' } : normal(url));
        r = await lancer(urls, tr, d, horloge(), { dossierPauses: dp() });
        const idxF = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images;
        verifier('REPONSE-HOTE : un 200 text/html SANS marqueur → absente (empreinte gardée), on passe à la suivante, AUCUN arrêt', [r.etat, Object.values(idxF).filter(e => e.statut === 'fausse-absente' && e.n === 1 && /^[0-9a-f]{64}$/.test(e.empreinte || '')).length, Object.values(idxF).filter(e => e.statut === 'ok').length, fs.existsSync(C.fichierArret(d)), r.reponsesHotes.map(h => [h.hote, h.fausses, h.empreintes.length])], ['termine', 1, 2, false, [['pkmncards.com', 1, 1]]]);
        // I3 (correction 1) : deux unités de suite — la seconde, après la pause de la première (réponse inattendue), ne fait AUCUNE requête
        {
            const t1 = reseau(url => (/robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'application/json', texte: '{}' }));
            const a = await lancer(urls, t1, tmp(), horloge(), { dossierPauses: dp() });
            const t2 = reseau(normal); const b = await lancer(urls, t2, tmp(), horloge(), { dossierPauses: dp(), processus: true });
            verifier('I3 pkmncards : deux unités de suite — la seconde ne fait AUCUNE requête (pas même robots.txt)', [a.etat, b.etat, t2.appels.length], ['pause-hote', 'pause-hote', 0]);
        }
        // M4 (correction 1) : une fausse absence N'EST PAS un absent définitif — redemandée UNE fois, pas avant 24 h ; une seconde fausse absence la rend définitive
        {
            const hM = horloge(), fausseB = url => (/m23_en_002/.test(url) ? { status: 200, type: 'text/html', texte: '<html><body>Page introuvable</body></html>' } : null);
            const dM = tmp(); const mk = f => reseau(url => (/robots\.txt$/.test(url) ? robotsLibre : (f(url) ?? normal(url))));
            await lancer(urls, mk(fausseB), dM, hM, { dossierPauses: dp() });
            const lireB = () => Object.values(JSON.parse(fs.readFileSync(path.join(dM, 'index.json'), 'utf8')).images).find(e => e.statut !== 'ok');
            const e1 = lireB();
            hM.avance(3600 * 1000);
            let trM = mk(fausseB); let rM = await lancer(urls, trM, dM, hM, { dossierPauses: dp() });
            verifier('M4 : une heure plus tard, la fausse absence n\'est PAS redemandée (moins de 24 h) : rien à faire, zéro requête', [e1.statut, e1.n, /^[0-9a-f]{64}$/.test(e1.empreinte || ''), typeof e1.le, rM.etat, trM.appels.length], ['fausse-absente', 1, true, 'string', 'rien-a-faire', 0]);
            hM.avance(25 * 3600 * 1000);
            trM = mk(fausseB); rM = await lancer(urls, trM, dM, hM, { dossierPauses: dp() });
            const e2 = lireB();
            verifier('M4 : 25 h plus tard, elle est redemandée UNE fois (robots + 1 image) ; une SECONDE fausse absence la rend DÉFINITIVE (absent, secondeFois)', [rM.etat, trM.appels.length, e2.statut, e2.fausseAbsente, e2.secondeFois], ['termine', 2, 'absent', true, true]);
            hM.avance(48 * 3600 * 1000);
            trM = mk(fausseB); rM = await lancer(urls, trM, dM, hM, { dossierPauses: dp() });
            verifier('M4 : devenue définitive, elle ne se redemande plus jamais', [rM.etat, trM.appels.length], ['rien-a-faire', 0]);
            const dM2 = tmp(); const hM2 = horloge();
            await lancer(urls, mk(fausseB), dM2, hM2, { dossierPauses: dp() });
            hM2.avance(25 * 3600 * 1000);
            trM = mk(() => null); await lancer(urls, trM, dM2, hM2, { dossierPauses: dp() });
            const e3 = JSON.parse(fs.readFileSync(path.join(dM2, 'index.json'), 'utf8')).images[urls[1]];
            verifier('M4 : si la page redonne l\'image à la seconde demande, elle entre au cache (ok)', [e3.statut, trM.appels.length], ['ok', 2]);
        }
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'text/html', texte: '<html><body>Page introuvable</body></html>' });
        r = await lancer(urls, tr, d, horloge(), { suivi: RH.suiviHote({ seuil: 1 }), dossierPauses: dp() });
        verifier('REPONSE-HOTE : au-delà du seuil de fausses absences d\'affilée → PAUSE de l\'hôte (« pause-hote »), AUCUN fichier d\'arrêt définitif, robots + 2 images seulement (le seuil du banc est 1 : le plan n\'a que 3 fichiers ; le 21 est prouvé au module)', [r.etat, fs.existsSync(C.fichierArret(d)), tr.appels.length, r.pauseHote?.hote, r.reponsesHotes[0].fausses], ['pause-hote', false, 3, 'pkmncards.com', 2]);
        tr = reseau(normal); const rSuite = await lancer(urls, tr, d, horloge(), { dossierPauses: dp() });
        verifier('REPONSE-HOTE : …et la passe SUIVANTE repart (une pause n\'est pas un arrêt définitif)', [rSuite.etat, tr.appels.length], ['termine', 3]);   // robots + les 2 images restantes : la 1re absence est au cache
        d = tmp(); const dPause = dp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'text/html', texte: '<nav>Gym Heroes · Gym Challenge</nav>' });
        r = await lancer(urls, tr, d, horloge(), { dossierPauses: dPause });
        verifier('REPONSE-HOTE : « Gym Challenge » seul = ambiguë → pause PERSISTANTE (fichier daté qui nomme l\'empreinte), pas d\'arrêt définitif', [r.etat, r.pauseHote?.persistante, fs.existsSync(C.fichierArret(d)), tr.appels.length, /^[0-9a-f]{64}$/.test(RH.lirePausePersistante(dPause, 'pkmncards.com')?.empreinte || '')], ['pause-hote', true, false, 2, true]);
        tr = reseau(normal); const rP = await lancer(urls, tr, d, horloge(), { dossierPauses: dPause });
        verifier('REPONSE-HOTE : …tant que le fichier de pause tient, AUCUNE requête (pas même robots.txt)', [rP.etat, tr.appels.length], ['pause-hote', 0]);
        for (const [nom, rep] of [['redirection 302', () => ({ status: 302, location: 'https://autre.example/x' })], ['octets qui ne sont pas une image (sans marqueur)', () => ({ status: 200, type: 'image/png', octets: Buffer.from('<html>defi</html>') })],
            ['402 (mur payant)', () => ({ status: 402, type: 'text/html', texte: 'pay' })], ['451 (statut inattendu)', () => ({ status: 451, type: 'text/html', texte: 'x' })], ['200 JSON', () => ({ status: 200, type: 'application/json', texte: '{}' })],
            ['une PNG déclarée .png mais dont les octets sont ceux d\'un JPEG', () => ({ status: 200, type: 'image/jpeg', octets: Buffer.from('ffd8ffe000104a464946000101000001', 'hex') })]]) {
            d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : rep());
            r = await lancer(urls, tr, d, horloge(), { dossierPauses: dp() });
            verifier(`REPONSE-HOTE : ${nom} = inattendue → PAUSE de l'hôte, jamais un arrêt définitif (robots + 1 image)`, [r.etat, fs.existsSync(C.fichierArret(d)), tr.appels.length], ['pause-hote', false, 2]);
        }
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: grand, imperva: true });
        r = await lancer(urls, tr, d, horloge(), { dossierPauses: dp() });
        verifier('REPONSE-HOTE : une vraie image servie derrière Imperva est une image', [r.etat, fs.existsSync(C.fichierArret(d))], ['termine', false]);
    }
    for (const [nom, rep] of defis) {
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : rep());
        r = await lancer(urls, tr, d);
        verifier(`défi (${nom}) : ARRÊT DÉFINITIF dès la première image, fichier d'arrêt écrit (robots + 1 image seulement)`, [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['arret-definitif', 2, true]);
        tr = reseau(normal);
        const r2 = await lancer(urls, tr, d);
        verifier('   le lancement suivant REFUSE de partir tant que le fichier existe (zéro requête)', [r2.etat, tr.appels.length], ['refuse-arret', 0]);
    }
    for (const st of [403, 401, 410, 429, 402]) {
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: st, type: 'text/html', texte: 'non' } : normal(url));
        r = await lancer(urls, tr, d);
        verifier(`robots.txt en ${st} : arrêt définitif, une seule requête, fichier d'arrêt, relance refusée`, [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d)), (await lancer(urls, reseau(normal), d)).etat], ['arret-definitif', 1, true, 'refuse-arret']);
    }
    // un 5xx INTERROMPT une fois ; le deuxième de suite (sans réussite entre) est un arrêt définitif
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 503, type: 'text/html', texte: 'x' });
    r = await lancer(urls, tr, d); const r5 = await lancer(urls, reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 503, type: 'text/html', texte: 'x' }), d);
    verifier('5xx deux lancements de suite sans réussite entre : 1er « interrompu », 2e ARRÊT DÉFINITIF avec fichier', [r.etat, r5.etat, fs.existsSync(C.fichierArret(d))], ['interrompu', 'arret-definitif', true]);
    d = tmp(); await lancer(urls, reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 503, type: 'text/html', texte: 'x' }), d);
    const r6 = await lancer(urls, reseau(normal), d); const r7 = await lancer(urls, reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 503, type: 'text/html', texte: 'x' }), tmp());
    verifier('5xx puis une réussite : le compteur repart (pas d\'arrêt)', [r6.etat, r7.etat, fs.existsSync(C.fichierArret(d))], ['termine', 'interrompu', false]);
    // (correction 3) le compteur de 5xx ne vaut que pour des 5xx RAPPROCHÉS (6 h) ; une réponse valide (image reçue, 404) le remet à zéro
    { const h5 = horloge(), rep503 = url => /robots\.txt$/.test(url) ? robotsLibre : { status: 503, type: 'text/html', texte: 'x' };
      d = tmp(); const a1 = await lancer(urls, reseau(rep503), d, h5); h5.avance(7 * 3600 * 1000); const a2 = await lancer(urls, reseau(rep503), d, h5);
      verifier('5xx espacés de 7 h : le second INTERROMPT (nouvel incident), pas d\'arrêt définitif', [a1.etat, a2.etat, fs.existsSync(C.fichierArret(d))], ['interrompu', 'interrompu', false]);
      d = tmp(); await lancer(urls, reseau(rep503), d, h5); h5.avance(60 * 1000); const a3 = await lancer(urls, reseau(rep503), d, h5);
      verifier('5xx à une minute d\'intervalle : le second est un ARRÊT définitif', [a3.etat, fs.existsSync(C.fichierArret(d))], ['arret-definitif', true]);
      d = tmp(); await lancer(urls, reseau(rep503), d, h5);
      await lancer(urls, reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 404, type: 'text/html', texte: '404' }), d, h5);
      verifier('un 404 (réponse valide) remet le compteur à zéro dans l\'index', JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).cinqCents ?? null, null); }
    // (correction 3) le plafond d'octets agit AVANT et PENDANT la lecture du corps (le transport réel)
    { const fo = global.fetch; let lu = false;      // (`lu` : inutilisable seul — un ReadableStream tire une première fois à sa création ; on mesure ce qui RESTE du corps)
      const flux = (n, entetes) => new Response(new ReadableStream({ pull(c) { lu = true; c.enqueue(new Uint8Array(Math.min(64, n.reste))); n.reste -= 64; if (n.reste <= 0) c.close(); } }), { status: 200, headers: { 'content-type': 'image/png', ...entetes } });
      try {
          const c1 = { reste: 10 * 1024 * 1024 }; global.fetch = async () => flux(c1, { 'content-length': String(10 * 1024 * 1024) });
          const t1 = await C.transportFetch.get(UP('a.png'), { binaire: true, octetsMax: 1000 });
          verifier('transport réel : un content-length au-delà du plafond refuse AVANT de lire le corps (presque rien n\'en est tiré)', [t1.tropVolumineux === true, Buffer.isBuffer(t1.octets), c1.reste > 10 * 1024 * 1024 - 1024], [true, false, true]);
          const compte = { reste: 5000 }; global.fetch = async () => flux(compte, {});
          const t2 = await C.transportFetch.get(UP('a.png'), { binaire: true, octetsMax: 1000 });
          verifier('transport réel : sans content-length, la lecture est COUPÉE au plafond (bien moins que le corps entier)', [t2.tropVolumineux === true, Buffer.isBuffer(t2.octets), compte.reste > 3000], [true, false, true]);
          global.fetch = async () => flux({ reste: 640 }, { 'content-length': '640' });
          const t3 = await C.transportFetch.get(UP('a.png'), { binaire: true, octetsMax: 1000 });
          verifier('transport réel : une image sous le plafond est lue en entier', [t3.tropVolumineux, t3.octets?.length], [undefined, 640]);
      } finally { global.fetch = fo; }
      d = tmp(); const rv = await lancer(urls.slice(0, 1), reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', tropVolumineux: true }), d);
      verifier('télécharger : une réponse « trop volumineuse » du transport est notée « refuse / trop-volumineuse », sans arrêt', [rv.etat, JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images[urls[0]]?.motif, fs.existsSync(C.fichierArret(d))], ['termine', 'trop-volumineuse', false]); }
    // plafond d'octets : une image trop volumineuse est refusée et notée, la collecte continue
    d = tmp(); tr = reseau(normal);
    r = await lancer(urls, tr, d, horloge(), { octetsMax: 100 });
    const idxV = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images;
    verifier('plafond d\'octets : toute image au-delà est refusée (« trop-volumineuse », notée), rien n\'est écrit dans img/, pas d\'arrêt ; la constante est nommée', [r.etat, Object.values(idxV).filter(e => e.statut === 'refuse' && e.motif === 'trop-volumineuse').length, fs.readdirSync(path.join(d, 'img')).length, C.OCTETS_MAX_PAR_IMAGE > 1e6], ['termine', 3, 0, true]);
    d = tmp(); tr = reseau(normal); r = await lancer(urls, tr, d);
    d = tmp(); await lancer(urls, reseau(normal), d, horloge(), { octetsMax: 100 });
    tr = reseau(normal); const rr2 = await lancer(urls, tr, d);
    verifier('   (une image refusée pour son poids n\'est pas redemandée à la relance)', [rr2.etat, tr.appels.length], ['rien-a-faire', 0]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 404, type: 'text/html', texte: '<html>404 - Not Found</html>' } : normal(url));
    r = await lancer(urls, tr, d);
    verifier('robots.txt 404 sans marqueur de défi : aucune règle, le téléchargement se POURSUIT', [r.etat, tr.appels.length], ['termine', 4]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 404, type: 'text/html', texte: '<title>Just a moment...</title>' } : normal(url));
    r = await lancer(urls, tr, d);
    verifier('robots.txt 404 AVEC marqueur de défi : arrêt définitif', [r.etat, fs.existsSync(C.fichierArret(d))], ['arret-definitif', true]);
    // 404 : absent, on continue ; 5xx : interrompu sans arrêt
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /m23_en_002/.test(url) ? { status: 404, type: 'text/html', texte: '<html>404</html>' } : { status: 200, type: 'image/png', octets: grand });
    r = await lancer(urls, tr, d);
    const idx2 = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images;
    verifier('404 : l\'adresse est notée « absent », les autres continuent, pas d\'arrêt', [r.etat, idx2[urls[1]]?.statut, Object.values(idx2).filter(e => e.statut === 'ok').length, fs.existsSync(C.fichierArret(d))], ['termine', 'absent', 2, false]);
    d = tmp(); let n = 0; tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : (++n === 2 ? { status: 503, type: 'text/html', texte: 'x' } : { status: 200, type: 'image/png', octets: grand }));
    r = await lancer(urls, tr, d);
    verifier('5xx : « interrompu » (une image obtenue), PAS de fichier d\'arrêt, pas de réessai (robots + 2 requêtes)', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['interrompu', 3, false]);
    tr = reseau(normal); r = await lancer(urls, tr, d);
    verifier('   la reprise ne redemande que le reste (robots.txt + 2 images)', [r.etat, tr.appels.length], ['termine', 3]);
    d = tmp(); tr = reseau(url => { if (/robots\.txt$/.test(url)) return robotsLibre; throw Object.assign(new Error('ECONNRESET'), { reseau: true }); });
    r = await lancer(urls, tr, d);
    verifier('coupure réseau : « interrompu », pas d\'arrêt définitif', [r.etat, fs.existsSync(C.fichierArret(d))], ['interrompu', false]);
    // un JPEG est une image attendue pour une adresse .jpg
    d = tmp(); const jp = await jpg(733); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/jpeg', octets: jp });
    r = await lancer([UP('unown-unseen-forces-uf-b.jpg')], tr, d);
    verifier('un JPEG pour une adresse .jpg : accepté (la source sert aussi des JPEG)', [r.etat, Object.values(JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images)[0]?.w], ['termine', 733]);

    // le CLI : aucune sortie forcée, codes de sortie sur de vrais processus, sans réseau
    verifier('le CLI ne contient AUCUN process.exit( (process.exitCode seulement)', /process\.exit\(/.test(fs.readFileSync(path.join(__dirname, 'collecteur-images-pkmncards.js'), 'utf8')), false);
    { const { spawnSync } = require('child_process'); const dos0 = tmp();
      fs.mkdirSync(path.join(dos0, 'cache')); fs.mkdirSync(path.join(dos0, 'sitemaps')); fs.mkdirSync(path.join(dos0, 'lot'));
      fs.writeFileSync(path.join(dos0, 'lot', 'plan-kits.json'), JSON.stringify({ plan: [], restes: [] }));
      fs.writeFileSync(path.join(dos0, 'sitemaps', 'pkmn_card-sitemap.xml'), fs.readFileSync(path.join(__dirname, 'fixtures', 'pkmncards-extrait-sitemap.xml'), 'utf8').replace(/@@HOTE@@/g, H));
      const lancerCli = a => spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-pkmncards.js'), ...a], { encoding: 'utf8', cwd: dos0, env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
      const base = ['--lot=kits', `--cache=${path.join(dos0, 'cache')}`, `--sitemaps=${path.join(dos0, 'sitemaps')}`, `--dossier=${path.join(dos0, 'lot')}`];
      const ok0 = lancerCli(['--telecharger', ...base]);
      verifier('CLI --telecharger sans adresse à demander : code 0, aucune assertion libuv, stderr vide', [ok0.status, /Assertion failed/.test(ok0.stderr || ''), (ok0.stderr || '').trim()], [0, false, '']);
      verifier('CLI avec un argument inconnu : code 2 propre', [lancerCli(['--inconnu', '--lot=kits']).status, /argument inconnu/.test(lancerCli(['--inconnu', '--lot=kits']).stderr || '')], [2, true]);
      verifier('CLI sans --lot, ou avec un lot inconnu : code 2', [lancerCli(['--plan']).status, lancerCli(['--plan', '--lot=tout']).status], [2, 2]);
      verifier('CLI --ecrire sans --attendu : code 2 ; --attendu sans --ecrire : code 2 ; deux modes : code 2', [lancerCli(['--ecrire', '--lot=kits']).status, lancerCli(['--attendu=3', '--lot=kits']).status, lancerCli(['--plan', '--telecharger', '--lot=kits']).status], [2, 2, 2]);
      verifier('CLI : la recherche (?s=) ou une adresse en argument est un argument inconnu', lancerCli(['--plan', '--lot=kits', '--url=' + H + '/?s=x']).status, 2);
      fs.writeFileSync(path.join(dos0, 'cache', 'ARRET-DEFINITIF.json'), '{}');
      const refuse = lancerCli(['--telecharger', ...base]);
      verifier('CLI --telecharger avec un fichier d\'arrêt : code 1 propre', [refuse.status, /Assertion failed/.test(refuse.stderr || '')], [1, false]); }

    // le transport RÉEL : agent honnête seul, redirection jamais suivie, garde de l'adresse avant fetch
    vusFetch.length = 0;
    let err = null; try { await C.transportFetch.get(UP('m23_en_001_std.png'), { binaire: true }); } catch (e) { err = e; }
    verifier('transport réel : les en-têtes se réduisent à l\'agent du dépôt (aucun en-tête de navigateur, aucun cookie), redirect « manual »', [vusFetch.length, Object.keys(vusFetch[0]?.[1]?.headers || {}), vusFetch[0]?.[1]?.redirect, vusFetch[0]?.[1]?.headers?.['User-Agent'] === P.UA && !/Mozilla/i.test(P.UA)], [1, ['User-Agent'], 'manual', true]);
    for (const u of ['https://autre.example/x.png', `${H}/?s=pikachu`, `${H}/card/x-xy-trainer-kit-latios-tk8o-1/`, `${H}/`, `http://${P.HOTE}/robots.txt`]) {
        vusFetch.length = 0; err = null;
        try { await C.transportFetch.get(u, {}); } catch (e) { err = e; }
        verifier(`transport réel : ${u.replace(H, '…').slice(0, 40)} refusé AVANT fetch`, [!!err, vusFetch.length], [true, 0]);
    }
    { const fo = global.fetch; global.fetch = async () => new Response('<html>Just a moment</html>', { status: 404, headers: { 'content-type': 'text/html' } });
      try { const t = await C.transportFetch.get(P.ROBOTS, {}); verifier('transport réel : un 404 rend son corps (le défi caché derrière un 404 se voit)', [t.status, /just a moment/i.test(t.texte || '')], [404, true]); } finally { global.fetch = fo; } }

    // ── 3. CONTRÔLER le cache, et la PLANCHE ─────────────────────────────────────────────────────────────────────────────────────
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /m23_en_001/.test(url) ? { status: 200, type: 'image/png', octets: dos } : /m23_en_003/.test(url) ? { status: 200, type: 'image/png', octets: petit } : { status: 200, type: 'image/png', octets: grand });
    await lancer(urls, tr, d);
    const ctl = await C.controlerCache(plan, d);
    verifier('contrôle du cache : le dos (empreinte) et l\'image sous 350 px sont refusés avec leur motif ; la bonne passe', [ctl.get(urls[0]), ctl.get(urls[2]), ctl.has(urls[1])], ['dos-de-carte', 'trop-petit', false]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: grand });
    await lancer(urls, tr, d);
    const ctl2 = await C.controlerCache(plan, d);
    // le contrôle visuel automatique : une carte flottant dans un cadre blanc ou noir est refusée ; une carte cadrée serré (bords non uniformes ou colorés) passe
    const cadre = async (fond, w = 733, h = 1024, m = 60) => sharp({ create: { width: w, height: h, channels: 3, background: fond } }).composite([{ input: await sharp({ create: { width: w - 2 * m, height: h - 2 * m, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer(), left: m, top: m }]).png().toBuffer();
    verifier('contrôle visuel : carte dans un cadre BLANC / NOIR plus large -> « fond-ou-cadre-trop-large » ; cadre COLORÉ (une bordure de carte) ou plein cadre -> passe',
        [await C.controleVisuel(await cadre({ r: 255, g: 255, b: 255 })), await C.controleVisuel(await cadre({ r: 0, g: 0, b: 0 })), await C.controleVisuel(await cadre({ r: 240, g: 200, b: 30 })), await C.controleVisuel(grand), await C.controleVisuel(Buffer.from('pas une image'))],
        ['fond-ou-cadre-trop-large', 'fond-ou-cadre-trop-large', null, null, 'image-illisible']);
    { const dvv = tmp(); const blanc = await cadre({ r: 255, g: 255, b: 255 });
      await lancer([urls[0]], reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: blanc }), dvv);
      verifier('contrôle du cache : le motif visuel est rendu avec les autres (fond-ou-cadre-trop-large)', (await C.controlerCache([plan[0]], dvv)).get(urls[0]), 'fond-ou-cadre-trop-large'); }
    // le rapport d'une carte : bornes exactes (0,69 – 0,74)
    verifier('contrôle qualité : rapport 0,684 (trop étroit) et 0,742 (trop large) refusés ; 0,716 et 0,732 passent', [[700, 1024], [760, 1024], [733, 1024], [750, 1024]].map(([w, h]) => P.controlerImage({ octets: Buffer.from('x'), w, h })), ['rapport-hors-carte', 'rapport-hors-carte', null, null]);
    // l'échantillon à graine fixe
    { const gros = Array.from({ length: 300 }, (_, i) => ({ ...plan[0], carteId: i, produits: [i] }));
      const a = C.tirerEchantillon(gros, 50), b2 = C.tirerEchantillon(gros, 50), c2 = C.tirerEchantillon(gros, 50, 7);
      verifier('échantillon : la graine est FIXE et exportée (imprimée par --planche), le tirage ne touche pas à Math.random', [C.GRAINE_ECHANTILLON, /Math\.random/.test(C.tirerEchantillon.toString())], [20261017, false]);
      verifier('échantillon : 50 sur 300, MÊME graine = MÊME tirage, autre graine = autre tirage, ordre du plan conservé, sans doublon', [a.length, JSON.stringify(a) === JSON.stringify(b2), JSON.stringify(a) === JSON.stringify(c2), new Set(a.map(x => x.carteId)).size, a.every((x, i) => i === 0 || a[i - 1].carteId < x.carteId)], [50, true, false, 50, true]); }
    verifier('contrôle du cache : trois adresses, UNE même empreinte (un espace réservé) -> les trois refusées', [[...ctl2.values()]], [['meme-image-plusieurs-adresses', 'meme-image-plusieurs-adresses', 'meme-image-plusieurs-adresses']]);
    // la planche
    d = tmp(); const sortie = tmp();
    tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: /m23_en_002/.test(url) ? autre : grand });
    await lancer(urls.slice(0, 2), tr, d);
    const anc = tmp(); fs.writeFileSync(path.join(anc, 'old-2.webp'), await sharp(await png(320)).webp().toBuffer());
    const planche = await C.planche({ unites: plan.slice(0, 2), dossierCache: d, sortie, lot: 'mcdo', parPage: 1, dossierAnciennes: anc });
    verifier('planche : une page par unité (parPage 1), fichiers PNG écrits, la correspondance page -> produits écrite', [planche.pages.length, planche.pages.every(p => fs.existsSync(p.fichier) && p.fichier.endsWith('.png')), planche.pages.map(p => p.produits)], [2, true, [[901], [902]]]);
    const meta = await sharp(planche.pages[0].fichier).metadata();
    verifier('planche : l\'image porte la vignette de la source (largeur et hauteur de page positives)', [meta.width > 200 && meta.height > 200, meta.format], [true, 'png']);
    const pl2 = await C.planche({ unites: plan.slice(0, 2), dossierCache: d, sortie: tmp(), lot: 'mcdo', parPage: 6 });
    verifier('planche : deux unités, six par page -> une page ; sans dossier d\'anciennes images, le remplacement le DIT (texte), il ne plante pas', [pl2.pages.length, pl2.pages[0].produits], [1, [901, 902]]);
    const sans = await C.planche({ unites: [plan[2]], dossierCache: d, sortie: tmp(), lot: 'mcdo', parPage: 6 });
    verifier('planche : une unité dont l\'image n\'est pas en cache est NOMMÉE (hors cache), jamais une case vide silencieuse', [sans.pages.length, sans.horsCache], [0, [903]]);

    // ── 4. ÉCRIRE : depuis le cache seulement ─────────────────────────────────────────────────────────────────────────────────────
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    const dc = tmp(); const tr0 = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /m23_en_003/.test(url) ? { status: 200, type: 'image/png', octets: petit } : { status: 200, type: 'image/png', octets: /m23_en_002/.test(url) ? autre : grand });
    await lancer(urls, tr0, dc);
    const VIEUX = { set: 'McDonalds-Match-Battle-2023', source: 'pokumon', numero: '002', cleR2: 'pokumon/old-2.webp', langue: 'en', w: 320, basseDefinition: true, vignette: { cleR2: 'vignettes/pokumon/old-2.webp' } };
    const semer = B => {
        B.col('sets').set('McDonalds-Match-Battle-2023', { _id: 'McDonalds-Match-Battle-2023', tirage: 'intl', region: 'intl' });
        for (const [id, num] of [[1, '001'], [2, '002'], [3, '003']]) {
            B.col('cartes').set(id, { _id: id, nomEn: `Carte ${id}`, images: [{ set: 'Autre', source: 'tcgdex', numero: '1', cleR2: 'tcgdex/x.webp', langue: 'en' }, ...(id === 2 ? [{ ...VIEUX }] : [])] });
            B.col('cartes_produits').set(`${id}|${900 + id}`, { _id: `${id}|${900 + id}`, carteId: id, idProduct: 900 + id, numeroFiche: num, slugSet: 'McDonalds-Match-Battle-2023' });
        }
        B.col('images').set('pokumon-old-2', { _id: 'pokumon-old-2', source: 'pokumon', set: 'McDonalds-Match-Battle-2023', carteId: 2, cleR2: VIEUX.cleR2, etat: 'ok', basseDefinition: true });
    };
    const depotsDe = () => { const l = []; return { l, f: async (...a) => l.push(a) }; };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const vignetterBanc = () => (db, slug, o) => vignetterApresJointure(db, slug, { ...o, journal: { error() { } }, assurer: async (db2, { slug: s }) => { let k = 0; for (const c of await db2.collection('cartes').find({}).toArray()) { let t = false; const images = (c.images || []).map(e => { if (e.set !== s || !e.cleR2 || e.vignette) return e; t = true; k++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2}`, w: 200, h: 279 } }; }); if (t) await db2.collection('cartes').updateOne({ _id: c._id }, { $set: { images } }); } return { entrees: k, cles: k, traitees: k, fabriquees: k, deja: 0, depuisDocument: 0, echecs: [], interrompu: false, sets: k ? [s] : [] }; } });
    const ecrire = async (B, o = {}) => { const dp = depotsDe(); const q = silencieux(); try { const b = await C.ecrire(o.plan || plan, B.M, { dossierCache: o.dossierCache || dc, attendu: o.attendu, rejets: o.rejets, deposer: dp.f, vignetter: vignetterBanc(), fabriquerVerrouSet: verrouSet }); return { b, dp }; } finally { q(); } };
    let B = fausseBase(); semer(B);
    verifier('--attendu qui diffère du compte réel (2 à écrire : la 3e est sous le seuil de 350 px) : REFUSÉ avant toute écriture', await (async () => { const { b, dp } = await ecrire(B, { attendu: 3 }); return [b.code, b.etat, dp.l.length, B.col('images').size]; })(), [2, 'refuse-attendu', 0, 1]);
    let { b, dp } = await ecrire(B, { attendu: 2 });
    verifier('écrire : 2 images écrites (un ajout, un remplacement), la 3e (300 px) est sous le seuil ; code 0 ; AUCUNE requête', [b.code, dp.l.length, vusFetch.length], [0, 2, 0]);
    const doc = B.col('images').get('pkc/McDonalds-Match-Battle-2023/1/001/en');
    verifier('le document `images` : source, lot, mention, langue, état, produits, largeurs, SANS marque de basse définition', [doc.source, doc.lot, doc.mention, doc.langue, doc.etat, doc.produits, doc.wOriginal, doc.hOriginal, doc.basseDefinition], ['pkc', 'pkc-2026-10', '© Pokémon / The Pokémon Company', 'en', 'ok', [901], 733, 1024, undefined]);
    verifier('   R2 AVANT la ligne : clé pkc/<set>/<n°>-<carte>-en.webp, WebP', [dp.l[0][1], dp.l[0][3]], ['pkc/McDonalds-Match-Battle-2023/001-1-en.webp', 'image/webp']);
    verifier('le document de l\'image sous le seuil : « trop-petit », seuil 350, rien de joint', [B.col('images').get('pkc/McDonalds-Match-Battle-2023/3/003/en')?.etat, B.col('images').get('pkc/McDonalds-Match-Battle-2023/3/003/en')?.seuilApplique, B.col('cartes').get(3).images.length], ['trop-petit', 350, 1]);
    const e1 = B.col('cartes').get(1).images.find(e => e.source === 'pkc');
    verifier('l\'entrée de la carte : set, source, lot, mention, langue, numéro, vignette ; l\'autre source INTACTE', [e1.set, e1.source, e1.lot, e1.mention, e1.langue, e1.numero, !!e1.vignette?.cleR2, B.col('cartes').get(1).images.find(e => e.source === 'tcgdex').cleR2], ['McDonalds-Match-Battle-2023', 'pkc', 'pkc-2026-10', '© Pokémon / The Pokémon Company', 'en', '001', true, 'tcgdex/x.webp']);
    // 🔑 TRAÇABILITÉ (doctrine du 2026-10-17) : CHAQUE image écrite est retirable, porte son adresse d'origine et sa date de collecte (celle du téléchargement, lue dans le cache) — sinon le banc échoue
    { const idxC = JSON.parse(fs.readFileSync(path.join(dc, 'index.json'), 'utf8')).images;
      const docsEcrits = [...B.col('images').values()].filter(x => x.source === 'pkc' && x.etat === 'ok');
      const entreesEcrites = [...B.col('cartes').values()].flatMap(c => (c.images || []).filter(e => e.source === 'pkc'));
      const dateOk = (v, url) => v instanceof Date && !isNaN(v) && v.toISOString() === idxC[url].le;
      verifier('traçabilité : chaque DOCUMENT écrit porte retirable: true, urlOriginal et collecteLe = la date du téléchargement', [docsEcrits.length, docsEcrits.every(x => x.retirable === true && P.urlImageValide(x.urlOriginal) && dateOk(x.collecteLe, x.urlOriginal))], [2, true]);
      verifier('traçabilité : chaque ENTRÉE de cartes.images porte retirable: true et collecteLe', [entreesEcrites.length, entreesEcrites.every(e => e.retirable === true && e.collecteLe instanceof Date && !isNaN(e.collecteLe))], [2, true]); }
    verifier('REMPLACEMENT : l\'entrée basse définition sort de cartes.images, la nôtre entre au même (set, numéro) sans marque ; les autres sources restent', [B.col('cartes').get(2).images.map(e => `${e.source}:${e.numero ?? ''}:${e.basseDefinition === true}`).sort()], [['pkc:002:false', 'tcgdex:1:false']]);
    verifier('   le document de l\'ancienne image N\'EST PAS supprimé : état « remplace », la remplaçante, son adresse d\'origine intacte ; le nouveau document garde l\'historique', [B.col('images').get('pokumon-old-2')?.etat, B.col('images').get('pokumon-old-2')?.remplacePar, B.col('images').get('pkc/McDonalds-Match-Battle-2023/2/002/en')?.remplaceDes?.[0]?.cleR2], ['remplace', { source: 'pkc', cleR2: 'pkc/McDonalds-Match-Battle-2023/002-2-en.webp' }, 'pokumon/old-2.webp']);
    // (correction 2, doctrine) l'adresse d'origine est sur CHAQUE image, document ET entrée ; elle est le SEUL champ qui porte l'hôte
    verifier('traçabilité : l\'entrée de cartes.images porte urlOriginal = l\'adresse d\'origine ; aucun AUTRE champ (entrée, document, preuve de langue) ne nomme la source', [e1.urlOriginal === plan[0].url, B.col('cartes').get(2).images.filter(e => e.source === 'pkc').every(e => P.urlImageValide(e.urlOriginal)),
        Object.entries(e1).filter(([k, v]) => k !== 'urlOriginal' && /pkmncards/i.test(JSON.stringify(v))).map(([k]) => k), /pkmn|cards\.com/i.test(e1.languePreuve || ''), Object.entries(doc).filter(([, v]) => /pkmncards/i.test(JSON.stringify(v))).map(([k]) => k)], [true, true, [], false, ['urlOriginal']]);
    verifier('le bilan du set : garde verte, 2 joints, 1 remplacée ; la garde de lot VOIT les images', [B.col('sets').get('McDonalds-Match-Battle-2023').visuelsPkc?.garde?.ok, B.col('sets').get('McDonalds-Match-Battle-2023').visuelsPkc?.joints, B.col('sets').get('McDonalds-Match-Battle-2023').visuelsPkc?.garde?.remplacees], [true, 2, 1]);
    const avant0 = compterEtat({ cartes: [{ _id: 1, sets: ['McDonalds-Match-Battle-2023'], images: [] }] }), apres0 = compterEtat({ cartes: [{ _id: 1, sets: ['McDonalds-Match-Battle-2023'], images: [e1] }] });
    verifier('la garde de lot compte la hausse des images (par set), aucune baisse', [apres0.get('images set:McDonalds-Match-Battle-2023'), comparer(avant0, apres0).baisses.length], [1, 0]);
    ({ b, dp } = await ecrire(B, { attendu: 2 }));
    verifier('rejeu : rien de redéposé, une entrée par fiche (idempotent)', [dp.l.length, B.col('cartes').get(1).images.filter(e => e.source === 'pkc').length, B.col('cartes').get(2).images.filter(e => e.source === 'pkc').length], [0, 1, 1]);
    // la marque pas encore posée : une entrée de 320 px sans basseDefinition est remplacée aussi
    B = fausseBase(); semer(B); { const c2 = B.col('cartes').get(2); c2.images = c2.images.map(e => e.source === 'pokumon' ? (({ basseDefinition, ...x }) => x)(e) : e); B.col('images').get('pokumon-old-2').basseDefinition = undefined; }
    ({ b, dp } = await ecrire(B, { attendu: 2 }));
    verifier('remplacement d\'une entrée de 320 px dont la marque n\'est pas encore posée (lue sur sa largeur) : remplacée, une seule entrée au numéro', [b.code, B.col('cartes').get(2).images.filter(e => e.set === 'McDonalds-Match-Battle-2023').map(e => e.source)], [0, ['pkc']]);
    // une autre source pose le numéro (HAUTE définition) entre deux passages : la nôtre CÈDE, l'entrée de l'autre est intacte
    B = fausseBase(); semer(B);
    B.col('cartes').get(1).images.push({ set: 'McDonalds-Match-Battle-2023', source: 'tcgdex', numero: '001', cleR2: 'tcgdex/b.webp', langue: 'en', w: 600 });
    ({ b, dp } = await ecrire(B, { attendu: 2 }));
    verifier('additif : une autre source a servi ce numéro entre-temps => la nôtre CÈDE, l\'entrée de l\'autre est intacte', [b.resultats[0].dejaParAutre, B.col('cartes').get(1).images.filter(e => e.source === 'pkc').length, B.col('cartes').get(1).images.find(e => e.cleR2 === 'tcgdex/b.webp')?.w], [1, 0, 600]);
    // rejets du coordinateur et contrôle
    B = fausseBase(); semer(B);
    const dcR = tmp(); fs.cpSync(dc, dcR, { recursive: true });                  // le rejet se PERSISTE dans le cache : celui-ci a donc le sien
    ({ b, dp } = await ecrire(B, { dossierCache: dcR, attendu: 1, rejets: new Map([[902, 'filigrane']]) }));
    const persiste = fs.existsSync(C.fichierRejets(dcR)) ? [...C.lireRejets(dcR)] : null;
    // 🔑 (correction 2) un rejet du coordinateur est définitif : un --ecrire relancé SANS --rejets=, sur la même base, sur une base neuve (même cache) ou après qu'un autre processus a remis la base à neuf, ne l'écrit jamais
    { const { b: b2, dp: dp2 } = await ecrire(B, { dossierCache: dcR, attendu: 1 });
      verifier('rejet PERSISTÉ : le motif est dans REJETS.json du cache ; relancé SANS --rejets= (même base), l\'image rejetée n\'est pas écrite', [persiste, b2.code, dp2.l.length, B.col('images').get('pkc/McDonalds-Match-Battle-2023/2/002/en')?.etat], [[[902, 'filigrane']], 0, 0, 'rejete']);
      const B2 = fausseBase(); semer(B2); const { b: b3 } = await ecrire(B2, { dossierCache: dcR, attendu: 1 });
      verifier('rejet PERSISTÉ : relancé SANS --rejets= sur une base NEUVE (même cache), toujours pas écrite ; --attendu compte sans elle', [b3.code, B2.col('cartes').get(2).images.some(e => e.source === 'pkc')], [0, false]);
      const B3 = fausseBase(); semer(B3); B3.col('images').set('pkc/McDonalds-Match-Battle-2023/2/002/en', { _id: 'pkc/McDonalds-Match-Battle-2023/2/002/en', source: 'pkc', etat: 'rejete', rejetPar: 'coordinateur', rejetMotif: 'étiquette' });
      const { b: b4 } = await ecrire(B3, { dossierCache: dc, attendu: 1 });
      verifier('rejet inscrit sur le DOCUMENT (état « rejete », par le coordinateur) : sauté même sans fichier de rejets', [b4.code, B3.col('cartes').get(2).images.some(e => e.source === 'pkc')], [0, false]); }
    verifier('rejets : l\'image rejetée à la planche n\'est pas écrite, son document dit « rejete » et le motif ; l\'ancienne entrée basse reste', [b.code, dp.l.length, B.col('images').get('pkc/McDonalds-Match-Battle-2023/2/002/en')?.etat, B.col('images').get('pkc/McDonalds-Match-Battle-2023/2/002/en')?.rejetMotif, B.col('cartes').get(2).images.some(e => e.source === 'pokumon' && e.cleR2 === VIEUX.cleR2)], [0, 1, 'rejete', 'filigrane', true]);
    const dd = tmp(); await lancer([urls[0]], reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: dos }), dd);
    B = fausseBase(); semer(B);
    ({ b, dp } = await ecrire(B, { plan: [plan[0]], dossierCache: dd, attendu: 0 }));
    verifier('un dos de carte dans le cache : jamais écrit, noté « rejete » (dos-de-carte), code non nul', [dp.l.length, B.col('images').get('pkc/McDonalds-Match-Battle-2023/1/001/en')?.rejetMotif, b.code === 0], [0, 'dos-de-carte', false]);
    // set dont le tirage n'est pas occidental
    B = fausseBase(); semer(B); B.col('sets').get('McDonalds-Match-Battle-2023').tirage = 'jp'; B.col('sets').get('McDonalds-Match-Battle-2023').region = 'jp';
    ({ b, dp } = await ecrire(B, { attendu: 2 }));
    verifier('un set dont le tirage n\'est pas occidental : refusé, rien déposé', [b.resultats[0].etat, dp.l.length], ['refuse-set', 0]);
    // le cache absent ou altéré
    B = fausseBase(); semer(B);
    const dc2 = tmp(); await lancer(urls.slice(0, 2), reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: /m23_en_002/.test(url) ? autre : grand }), dc2);
    ({ b, dp } = await ecrire(B, { dossierCache: dc2, attendu: 2 }));
    verifier('une adresse du plan absente du cache n\'est pas écrite (« hors-cache »), les autres le sont', [b.horsCache, dp.l.length], [1, 2]);
    const i3 = JSON.parse(fs.readFileSync(path.join(dc2, 'index.json'), 'utf8')); const f0 = Object.values(i3.images)[0].fichier; fs.writeFileSync(path.join(dc2, f0), Buffer.from('altéré'));
    B = fausseBase(); semer(B);
    ({ b, dp } = await ecrire(B, { dossierCache: dc2, attendu: 1 }));
    verifier('un fichier du cache dont le sha256 ne correspond plus est refusé (« cache-altere »)', [b.altere, dp.l.length], [1, 1]);
    // l'annonce de la garde de lot
    const ann = C.annonceRemplacement([{ _id: 2, sets: ['McDonalds-Match-Battle-2023'], images: [{ ...VIEUX }] }], plan.slice(1, 2));
    verifier('annonce pour lot-additif : la baisse des vignettes de l\'entrée remplacée est annoncée ; sans remplacement, aucune annonce', [Object.keys(ann).length > 0, Object.keys(C.annonceRemplacement([{ _id: 1, sets: ['McDonalds-Match-Battle-2023'], images: [] }], [plan[0]])).length], [true, 0]);

    // ── 5. RETIRER : exactement le lot ────────────────────────────────────────────────────────────────────────────────────────────
    const { retirerLot } = require('./retirer-visuels-pkmncards');
    // (BASSE-DEF) la règle commune exige le DOCUMENT `images` de l'entrée actuelle : sans lui, rien ne sort et la nôtre CÈDE ; avec un document qui porte un tampon, c'est une autre impression
    { const Bs = fausseBase(); semer(Bs); Bs.cols.get('images').delete('pokumon-old-2');
      const { b: bs } = await ecrire(Bs, { plan: [plan[1]], attendu: 1 });
      verifier('SANS le document de l\'entrée basse définition : rien ne sort (elle reste), la nôtre cède ; garde verte', [Bs.col('cartes').get(2).images.map(e => e.source).sort(), bs.resultats[0].dejaParAutre, bs.code], [['pokumon', 'tcgdex'], 1, 0]);
      const Bt = fausseBase(); semer(Bt); Bt.col('images').get('pokumon-old-2').tampon = 'Staff';
      await ecrire(Bt, { plan: [plan[1]], attendu: 1 });
      verifier('le DOCUMENT de l\'entrée porte un tampon que notre scan n\'a pas : une autre impression, rien ne sort', [Bt.col('cartes').get(2).images.some(e => e.source === 'pokumon'), Bt.col('cartes').get(2).images.some(e => e.source === 'pkc')], [true, false]);
      const Bw = fausseBase(); semer(Bw); Bw.col('cartes').get(2).images = Bw.col('cartes').get(2).images.map(e => e.source === 'pokumon' ? { ...e, w: 400, basseDefinition: undefined } : e);
      await ecrire(Bw, { plan: [plan[1]], attendu: 1 });
      verifier('une entrée de 400 px (document présent), notre image de 733 : NETTEMENT plus grande (>= 1,5 x) -> elle sort', [Bw.col('cartes').get(2).images.some(e => e.source === 'pokumon'), Bw.col('cartes').get(2).images.some(e => e.source === 'pkc')], [false, true]);
      const Bx = fausseBase(); semer(Bx); Bx.col('cartes').get(2).images = Bx.col('cartes').get(2).images.map(e => e.source === 'pokumon' ? { ...e, w: 600, basseDefinition: undefined } : e);
      await ecrire(Bx, { plan: [plan[1]], attendu: 1 });
      verifier('une entrée de 600 px, correcte au-dessus du seuil : JAMAIS remplacée par une équivalente (733 < 900) ; la nôtre cède', [Bx.col('cartes').get(2).images.some(e => e.source === 'pokumon'), Bx.col('cartes').get(2).images.some(e => e.source === 'pkc')], [true, false]); }
    // la traçabilité vient du module COMMUN (une seule définition) : aucune copie locale des champs
    verifier('traçabilité : le collecteur appelle collecte-cartes/tracabilite.js et ne réécrit pas `retirable: true` lui-même', [/require\('\.\/collecte-cartes\/tracabilite'\)/.test(fs.readFileSync(path.join(__dirname, 'collecteur-images-pkmncards.js'), 'utf8')), /retirable: true/.test(fs.readFileSync(path.join(__dirname, 'collecteur-images-pkmncards.js'), 'utf8').replace(/\/\/.*$/gm, ''))], [true, false]);
    // un remplacement d'une image FAUSSE (scan japonais refusé) : l'unité du plan la nomme, elle sort, l'ancienne est gardée (état « remplace »)
    { const Bj = fausseBase(); semer(Bj);
      Bj.col('cartes').get(1).images.push({ set: 'McDonalds-Match-Battle-2023', source: 'bulbapedia', numero: '001', cleR2: 'bulbapedia/ja-1.webp', langue: 'ja', w: 868 });
      Bj.col('images').set('bj1', { _id: 'bj1', source: 'bulbapedia', set: 'McDonalds-Match-Battle-2023', carteId: 1, cleR2: 'bulbapedia/ja-1.webp', etat: 'ok', langue: 'ja' });
      const pj = [{ ...plan[0], action: 'remplacement', remplace: [{ source: 'bulbapedia', cleR2: 'bulbapedia/ja-1.webp', numero: '001', w: 868, langue: 'ja', motif: 'fausse : langue:ja' }] }];
      const { b: bj } = await ecrire(Bj, { plan: pj, attendu: 1 });
      verifier('écrire : l\'entrée japonaise NOMMÉE par le plan sort, la nôtre entre ; l\'ancien document reste, « remplace »', [bj.code, Bj.col('cartes').get(1).images.map(e => e.source).sort(), Bj.col('images').get('bj1').etat], [0, ['pkc', 'tcgdex'], 'remplace']);
      const Bk = fausseBase(); semer(Bk);
      Bk.col('cartes').get(1).images.push({ set: 'McDonalds-Match-Battle-2023', source: 'bulbapedia', numero: '001', cleR2: 'bulbapedia/ja-1.webp', langue: 'ja', w: 868 });
      await ecrire(Bk, { plan: [plan[0]], attendu: 1 });
      verifier('écrire : une entrée que le plan ne nomme PAS n\'est jamais retirée', [Bk.col('cartes').get(1).images.some(e => e.cleR2 === 'bulbapedia/ja-1.webp')], [true]); }
    B = fausseBase(); semer(B);
    await ecrire(B, { attendu: 2 });
    B.col('cartes').get(1).images.push({ set: 'McDonalds-Match-Battle-2023', source: 'pkc', lot: 'autre-lot', numero: '009', cleR2: 'pkc/autre.webp' });
    const photo = () => JSON.stringify([...B.cols].map(([k, m]) => [k, [...m.entries()]]));
    const avantBlanc = photo();
    const sup = []; const sansEcrire = await retirerLot(B.db, { ecrire: false });
    verifier('retrait À BLANC : AUCUNE écriture — la base entière est identique, avant et après', photo() === avantBlanc, true);
    verifier('retrait À BLANC : annonce les documents à retirer (toute la source) et les clés R2', [sansEcrire.docs, sansEcrire.cles.length > 0], [3, true]);       // 2 images écrites + le document « trop-petit » : TOUS les documents de la source
    { const { spawnSync } = require('child_process'); const cli = a => spawnSync(process.execPath, [path.join(__dirname, 'retirer-visuels-pkmncards.js'), ...a], { encoding: 'utf8', env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
      verifier('retrait CLI : un argument inconnu -> code 2 ; --effacer-r2 sans --ecrire -> code 2 (aucune connexion)', [cli(['--tout']).status, cli(['--effacer-r2']).status], [2, 2]); }
    verifier('retrait À BLANC : comptes sur TOUTE la source (les deux lots), une entrée à rétablir, rien n\'est modifié', [sansEcrire.entrees, sansEcrire.cartes.length, sansEcrire.retablies, B.col('cartes').get(1).images.some(e => e.source === 'pkc' && e.lot === 'pkc-2026-10'), B.col('images').get('pokumon-old-2').etat], [3, 2, 1, true, 'remplace']);
    const rr = await retirerLot(B.db, { ecrire: true, effacerR2: true, supprimer: async (bk, cles) => sup.push(...cles), verifierBucket: async () => { }, bucket: 'bucket-banc' });
    verifier('retrait : TOUTE la source sort (même un autre lot) en une commande ; l\'autre source reste ; les documents passent à « retire »', [B.col('cartes').get(1).images.some(e => e.source === 'pkc'), B.col('cartes').get(1).images.some(e => e.source === 'tcgdex'), B.col('images').get('pkc/McDonalds-Match-Battle-2023/1/001/en').etat, rr.reste, rr.nRet], [false, true, 'retire', 0, 1]);
    verifier('   les clés R2 effacées (images + vignettes) sont celles de la source seule', [sup.length > 0 && sup.every(c => c.startsWith('pkc/') || c.startsWith('vignettes/pkc/'))], [true]);
    verifier('   et la remplacée est RÉTABLIE : l\'ancienne entrée basse définition revient dans cartes.images, son document repasse à « ok »', [B.col('cartes').get(2).images.some(e => e.source === 'pokumon' && e.cleR2 === VIEUX.cleR2 && e.basseDefinition === true), B.col('images').get('pokumon-old-2')?.etat, B.col('images').get('pokumon-old-2')?.remplacePar], [true, 'ok', undefined]);

    global.fetch = fetchOrigine;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
