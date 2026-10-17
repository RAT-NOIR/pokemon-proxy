// node test-collecteur-pokellector.js — le collecteur POKELLECTOR (collecteur-images-pokellector.js) : relevé de pages, plan, téléchargement, écriture, planche, retrait, ligne de commande.
// Aucune requête (transport simulé ; global.fetch REMPLACÉ par un piège qui lève), aucune base réelle (base en mémoire), aucun R2 (faux dépôt), dossiers de travail TEMPORAIRES
// (jamais un vrai chemin du testeur). Les pages et images de la sonde du 2026-10-17 (fixtures/pokellector/) servent de pages réelles. Ce que le banc garde :
//   · RELEVER : une page n'est demandée que si son adresse figure dans une page déjà lue ; robots.txt d'abord ; cadence ≥ 5 s ; plafond ; blocage = ARRÊT DÉFINITIF partagé avec le téléchargement ;
//   · PLANIFIER (0 requête) : le plan sort du cache seul ; aucune adresse construite ; une page de carte non relevée est « à relever » ;
//   · TÉLÉCHARGER : seules les adresses du plan présentes dans le relevé ; une vignette (< 570 px) ou un dos de carte n'entre pas ; 401/403/410/429/HTML/3xx = arrêt définitif ;
//   · ÉCRIRE : depuis le cache seulement, additif, --attendu, clé R2 neutre, aucun champ public ne nomme la source ; RETIRER : exactement le lot.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pokellector');
const C = require('./collecteur-images-pokellector');
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

const FX = path.join(__dirname, 'fixtures', 'pokellector');
const lireFx = f => fs.readFileSync(path.join(FX, f));
const IMG = 'https://den-cards.pokellector.com/392';
const URLI = (n, c, num, id, f = '.png') => `${IMG}/${n}.${c}.${num}.${id}${f}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pkl-banc-'));

(async () => {
    const png = w => sharp({ create: { width: w, height: Math.round(w * 1.39), channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
    const jpg = w => sharp({ create: { width: w, height: Math.round(w * 1.4), channels: 3, background: { r: 200, g: 120, b: 30 } } }).jpeg().toBuffer();
    const grand = await png(570), petit = await png(300), moyen = await png(569), grandJpg = await jpg(570);
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async (u, init) => { vusFetch.push([String(u), init]); throw new Error('réseau interdit dans le banc'); };

    const unite = (i, o = {}) => ({ carteId: 100 + i, nomEn: `Carte${i}`, slugSet: 'Twilight-Masquerade', numero: String(10 + i).padStart(3, '0'), produits: [900 + i], ligne: '/Twilight-Masquerade-Expansion/', numeroReleve: String(10 + i), cardId: String(53000 + i), url: URLI(`Carte${i}`, 'TWM', 10 + i, 53000 + i), forme: 'plein', voie: 'set+numero+nom', preuve: `set n°${10 + i}`, aRegarder: false, anglais: true, ...o });
    const plan = [0, 1, 2, 3].map(i => unite(i));
    const cartesRel = plan.map(p => ({ setHref: p.ligne, code: 'TWM', numero: p.numeroReleve, nom: p.nomEn, cardId: p.cardId, img: p.url, forme: 'plein' }));

    // ── 0. le transport RÉEL ───────────────────────────────────────────────────────────────────────────────────────────────
    vusFetch.length = 0;
    let err = null; try { await C.transportFetch.get(plan[0].url, { binaire: true }); } catch (e) { err = e; }
    verifier('transport réel : les en-têtes se réduisent à l\'agent du dépôt (aucun navigateur, aucun cookie), redirect « manual »', [vusFetch.length, Object.keys(vusFetch[0]?.[1]?.headers || {}), vusFetch[0]?.[1]?.redirect, vusFetch[0]?.[1]?.headers?.['User-Agent'] === P.UA && !/Mozilla/i.test(P.UA)], [1, ['User-Agent'], 'manual', true]);
    for (const u of ['https://autre.example/x.png', 'https://den-media.pokellector.com/logos/a.png', 'https://jp.pokellector.com/sets', 'https://www.pokellector.com/user/login', 'https://den-cards.pokellector.com/392/A.TWM.1.2.thumb.png']) {
        vusFetch.length = 0; err = null;
        try { await C.transportFetch.get(u, {}); } catch (e) { err = e; }
        verifier(`transport réel : ${u.replace('https://', '')} est refusé AVANT fetch`, [!!err, vusFetch.length], [true, 0]);
    }
    { const fo = global.fetch; global.fetch = async () => new Response('<html>Just a moment</html>', { status: 404, headers: { 'content-type': 'text/html' } });
      try { const t = await C.transportFetch.get('https://www.pokellector.com/sets', {}); verifier('transport réel : un 404 rend son corps (le défi caché derrière un 404 se voit)', [t.status, /just a moment/i.test(t.texte || '')], [404, true]); } finally { global.fetch = fo; } }
    { const fo = global.fetch; global.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://autre.example/' } });
      try { const t = await C.transportFetch.get('https://www.pokellector.com/sets', {}); verifier('transport réel : une redirection n\'est PAS suivie, elle est rendue (3xx + location)', [t.status, t.location], [302, 'https://autre.example/']); } finally { global.fetch = fo; } }

    // ── 1. TÉLÉCHARGER ─────────────────────────────────────────────────────────────────────────────────────────────────────
    const reseau = rep => { const appels = []; return { appels, async get(url, o) { appels.push(url); return rep(url, o); } }; };
    const robotsLibre = { status: 404, type: 'text/html', texte: '<html>Not Found</html>' };
    const normal = (url, o) => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: grand };
    const horloge = () => { let t = 1e6; const attentes = []; return { now: () => t, pause: async ms => { attentes.push(ms); t += ms; }, attentes }; };
    const lancer = (urls, tr, d, h = horloge(), o = {}) => C.telecharger({ urls, dossierCache: d, transport: tr, pause: h.pause, now: h.now, ...o });
    const idxDe = d => JSON.parse(fs.readFileSync(path.join(d, 'images', 'index.json'), 'utf8')).images;

    let d = tmp(), h = horloge(), tr = reseau(normal);
    let r = await lancer(plan.map(p => p.url), tr, d, h);
    verifier('télécharger : robots.txt D\'ABORD, puis les 4 images — 5 requêtes, plafond = 4 + 1', [tr.appels[0], tr.appels.length, r.plafond, r.etat], ['https://den-cards.pokellector.com/robots.txt', 5, 5, 'termine']);
    verifier('cadence : entre deux requêtes jamais moins de 5 s (4 attentes pour 5 requêtes)', [h.attentes.length === 4 && h.attentes.every(ms => ms >= 5000)], [true]);
    { const h0 = horloge(), t0 = reseau(normal); await lancer(plan.map(p => p.url), t0, tmp(), h0, { cadenceMs: 0 });
      verifier('cadence : un réglage à 0 est RELEVÉ au plancher (4 attentes ≥ 5 s pour 5 requêtes)', [t0.appels.length, h0.attentes.length, h0.attentes.every(ms => ms >= 5000)], [5, 4, true]); }
    { const dA = tmp(); fs.writeFileSync(C.fichierArret(dA), '{}'); const tA = reseau(normal); const fl = C.creerFlux({ dossierCache: dA, transport: tA, pause: async () => { }, now: Date.now });
      const rA = await fl.demander(plan[0].url, { image: true });
      verifier('le FLUX lui-même refuse de demander quand le fichier d\'arrêt existe (zéro requête, pas même robots.txt)', [rA.etat, tA.appels.length], ['refuse-arret', 0]);
      let eA = null; try { await C.creerFlux({ dossierCache: tmp(), transport: tA }).demander('https://autre.example/x.png', { image: true }); } catch (x) { eA = x; }
      verifier('le FLUX refuse une adresse hors règle en LEVANT (aucune requête)', [!!eA?.horsRegle, tA.appels.length], [true, 0]); }
    { const trp = reseau(normal), rp = await lancer(plan.map(p => p.url), trp, tmp(), horloge(), { plafond: 3 });
      verifier('plafond : à 3 requêtes le téléchargement s\'arrête sans fichier d\'arrêt', [rp.etat, trp.appels.length, /plafond/.test(rp.motif || '')], ['interrompu', 3, true]); }
    const idx = idxDe(d);
    verifier('cache : une entrée par adresse (fichier, sha256, 570 px) ; le fichier existe', [Object.keys(idx).length, Object.values(idx).every(e => e.statut === 'ok' && e.w === 570 && /^[0-9a-f]{64}$/.test(e.sha256) && fs.existsSync(path.join(d, 'images', e.fichier)))], [4, true]);
    tr = reseau(normal); r = await lancer(plan.map(p => p.url), tr, d);
    verifier('reprise : tout est en cache => zéro requête', [r.etat, tr.appels.length], ['rien-a-faire', 0]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /392/\n' } : normal(url));
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('robots.txt qui interdit : aucune image demandée, « robots-interdit », pas d\'arrêt définitif', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['robots-interdit', 1, false]);
    d = tmp(); tr = reseau(normal);
    r = await lancer(['https://autre.example/x.png', URLI('A', 'TWM', 1, 2, '.thumb.png'), `${IMG}/../x/A.TWM.1.2.png`, plan[0].url + '?x=1'], tr, d);
    verifier('une adresse hors hôte / vignette / remontée / paramètre est refusée AVANT toute requête (même pas robots.txt)', [r.etat, tr.appels.length, r.refusees.length], ['rien-a-faire', 0, 4]);
    // la vignette détectée à la LARGEUR : une image qui n'a pas 570 px n'entre pas
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /Carte1/.test(url) ? { status: 200, type: 'image/png', octets: petit } : /Carte2/.test(url) ? { status: 200, type: 'image/png', octets: moyen } : { status: 200, type: 'image/png', octets: grand });
    r = await lancer(plan.map(p => p.url), tr, d);
    const idl = idxDe(d);
    verifier('une image de 300 px et une de 569 px sont des VIGNETTES : « trop-petit », sans fichier gardé ; les deux autres entrent', [r.etat, idl[plan[1].url]?.statut, idl[plan[2].url]?.statut, idl[plan[1].url]?.w, Object.values(idl).filter(e => e.statut === 'ok').length, fs.readdirSync(path.join(d, 'images', 'img')).length], ['termine', 'trop-petit', 'trop-petit', 300, 2, 2]);
    // un dos de carte
    const dosFx = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /Carte0/.test(url) ? { status: 200, type: 'image/png', octets: dosFx } : { status: 200, type: 'image/png', octets: grand });
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('un DOS de carte (empreinte connue) est refusé : « dos-de-carte », rien gardé, les autres continuent', [r.etat, idxDe(d)[plan[0].url]?.statut, Object.values(idxDe(d)).filter(e => e.statut === 'ok').length], ['termine', 'dos-de-carte', 3]);
    // un .mobile.jpg
    d = tmp(); const um = unite(9, { url: URLI('Carte9', 'TWM', 19, 53009, '.mobile.jpg'), forme: 'mobile' });
    tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/jpeg', octets: grandJpg });
    r = await lancer([um.url], tr, d);
    verifier('un « .mobile.jpg » de 570 px entre (octets JPEG reconnus)', [r.etat, idxDe(d)[um.url]?.statut, idxDe(d)[um.url]?.w], ['termine', 'ok', 570]);

    // arrêt définitif
    const defis = [['401', () => ({ status: 401, type: 'text/html', texte: 'non' })], ['403', () => ({ status: 403, type: 'text/html', texte: 'non' })], ['410', () => ({ status: 410, type: 'text/html', texte: 'non' })], ['429', () => ({ status: 429, type: 'text/html', texte: 'non' })],
        ['HTML au lieu d\'une image', () => ({ status: 200, type: 'text/html', texte: '<html>ok</html>' })], ['cf-mitigated', () => ({ status: 200, type: 'image/png', octets: grand, cfMitigated: 'challenge' })], ['Imperva', () => ({ status: 200, type: 'image/png', octets: grand, imperva: true })],
        ['redirection 302', () => ({ status: 302, location: 'https://autre.example/x' })], ['octets qui ne sont pas une image', () => ({ status: 200, type: 'image/png', octets: Buffer.from('<html>defi</html>') })], ['429 à corps vide', () => ({ status: 429 })]];
    for (const [nom, rep] of defis) {
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : rep());
        r = await lancer(plan.map(p => p.url), tr, d);
        verifier(`défi (${nom}) : ARRÊT DÉFINITIF dès la première image, fichier d'arrêt écrit (robots + 1 image)`, [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['arret-definitif', 2, true]);
        tr = reseau(normal);
        const r2 = await lancer(plan.map(p => p.url), tr, d);
        verifier('   le lancement suivant REFUSE de partir tant que le fichier existe (zéro requête)', [r2.etat, tr.appels.length], ['refuse-arret', 0]);
    }
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 403, type: 'text/html', texte: 'non' } : normal(url));
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('robots.txt en 403 : arrêt définitif, une seule requête', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['arret-definitif', 1, true]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 404, type: 'text/html', texte: '<title>Just a moment...</title>' } : normal(url));
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('robots.txt 404 AVEC marqueur de défi : arrêt définitif', [r.etat, tr.appels.length], ['arret-definitif', 1]);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /Carte1/.test(url) ? { status: 404, type: 'text/html', texte: '<html>Not found</html>' } : { status: 200, type: 'image/png', octets: grand });
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('404 : l\'adresse est « absent », les autres continuent, pas d\'arrêt', [r.etat, idxDe(d)[plan[1].url]?.statut, Object.values(idxDe(d)).filter(e => e.statut === 'ok').length, fs.existsSync(C.fichierArret(d))], ['termine', 'absent', 3, false]);
    d = tmp(); let n = 0; tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : (++n === 2 ? { status: 503, type: 'text/html', texte: 'x' } : { status: 200, type: 'image/png', octets: grand }));
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('5xx : « interrompu » (une image obtenue), PAS de fichier d\'arrêt, pas de réessai', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['interrompu', 3, false]);
    tr = reseau(normal); r = await lancer(plan.map(p => p.url), tr, d);
    verifier('   la reprise ne redemande que le reste (robots.txt + 3 images)', [r.etat, tr.appels.length], ['termine', 4]);
    d = tmp(); tr = reseau(url => { if (/robots\.txt$/.test(url)) return robotsLibre; throw Object.assign(new Error('ECONNRESET'), { reseau: true }); });
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('coupure réseau : « interrompu », pas d\'arrêt définitif', [r.etat, fs.existsSync(C.fichierArret(d))], ['interrompu', false]);
    const aut = C.urlsAutorisees([...plan, { ...plan[0], url: URLI('Z', 'TWM', 1, 5) }, { ...plan[0], url: 'https://autre.example/x.png' }], cartesRel);
    verifier('adresses : celles du plan présentes mot pour mot dans le relevé passent ; hors relevé / autre hôte sont refusées et nommées', [aut.ok.length, aut.refusees.map(x => x.motif)], [4, ['hors-releve', 'adresse-hors-regle']]);

    // ── 2. RELEVER LES PAGES : une adresse relevée, jamais construite ──────────────────────────────────────────────────
    const htmlListe = lireFx('liste-sets.html').toString('utf8'), htmlSet = lireFx('set-twilight-masquerade.html').toString('utf8'), htmlFez = lireFx('carte-fezandipiti-96.html').toString('utf8');
    const pageOk = html => ({ status: 200, type: 'text/html; charset=UTF-8', texte: html });
    const SETS = 'https://www.pokellector.com/sets', SETTWM = 'https://www.pokellector.com/Twilight-Masquerade-Expansion/', FEZ = 'https://www.pokellector.com/Twilight-Masquerade-Expansion/Fezandipiti-Card-96';
    const sitePages = url => /robots\.txt$/.test(url) ? robotsLibre : url === SETS ? pageOk(htmlListe) : url === SETTWM ? pageOk(htmlSet) : url === FEZ ? pageOk(htmlFez) : { status: 404, type: 'text/html', texte: '<html>Not Found</html>' };
    d = tmp(); tr = reseau(sitePages);
    const etape1 = async () => ({ cibles: [{ url: SETS, fichier: 'liste-sets.html' }], autorisees: new Set([SETS]) });
    const etape2 = async () => ({ cibles: [{ url: SETTWM, fichier: P.fichierSet('/Twilight-Masquerade-Expansion/') }, { url: FEZ, fichier: P.fichierCarte('53249') }], autorisees: P.adressesDeLaPage(htmlListe) });
    h = horloge();
    r = await C.releverPages({ etapes: [etape1, etape2], dossierCache: d, transport: tr, pause: h.pause, now: h.now, plafond: 10 });
    verifier('relever : robots.txt de l\'hôte des pages D\'ABORD, puis la liste, puis le set ; la carte (absente de la liste) est refusée « hors-releve » SANS requête', [tr.appels[0], tr.appels.slice(1), r.etat, r.refusees.map(x => x.motif)], ['https://www.pokellector.com/robots.txt', [SETS, SETTWM], 'termine', ['hors-releve']]);
    verifier('   les pages sont gardées sous leurs noms ; cadence ≥ 5 s ; une page déjà en cache n\'est pas redemandée', [fs.existsSync(path.join(d, 'pages', 'liste-sets.html')), fs.existsSync(path.join(d, 'pages', 'set--Twilight-Masquerade-Expansion.html')), h.attentes.length === 2 && h.attentes.every(ms => ms >= 5000)], [true, true, true]);
    const etape3 = async () => ({ cibles: [{ url: FEZ, fichier: P.fichierCarte('53249') }], autorisees: P.adressesDeLaPage(htmlSet) });
    tr = reseau(sitePages); r = await C.releverPages({ etapes: [etape1, etape2, etape3], dossierCache: d, transport: tr, plafond: 10, pause: async () => { }, now: Date.now });
    verifier('relever : la carte relevée sur la page du set se demande (1 requête, robots.txt compris : 2) ; la liste et le set en cache ne se redemandent pas', [tr.appels.length, tr.appels.includes(FEZ), r.etat], [2, true, 'termine']);
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : sitePages(url));
    r = await C.releverPages({ etapes: [etape1, etape2, etape3], dossierCache: d, transport: tr, plafond: 3, pause: async () => { }, now: Date.now });
    verifier('relever : le plafond (3 requêtes) arrête avant la requête de trop, sans fichier d\'arrêt', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['interrompu', 3, false]);
    for (const [nom, rep] of [['403', { status: 403, type: 'text/html', texte: 'non' }], ['429', { status: 429, type: 'text/html', texte: 'non' }], ['302', { status: 302, location: 'https://autre.example/' }], ['défi dans la page', pageOk('<title>Just a moment...</title>')], ['une image à la place de la page', { status: 200, type: 'image/png', octets: grand }]]) {
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : rep);
        r = await C.releverPages({ etapes: [etape1, etape2], dossierCache: d, transport: tr, plafond: 10, pause: async () => { }, now: Date.now });
        verifier(`relever : ${nom} => ARRÊT DÉFINITIF, une seule page demandée`, [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], [nom === 'une image à la place de la page' ? 'interrompu' : 'arret-definitif', 2, nom !== 'une image à la place de la page']);
    }
    { let eP = null; try { await C.releverPages({ etapes: [etape1], dossierCache: tmp(), transport: reseau(sitePages) }); } catch (x) { eP = x; }
      verifier('relever : sans plafond de requêtes, il refuse de partir (il lève, aucune requête)', /plafond/.test(eP?.message || ''), true); }
    d = tmp(); fs.writeFileSync(C.fichierArret(d), '{}'); tr = reseau(sitePages);
    r = await C.releverPages({ etapes: [etape1], dossierCache: d, transport: tr, plafond: 10, pause: async () => { }, now: Date.now });
    verifier('relever refuse de partir si l\'arrêt définitif d\'un téléchargement existe (UN seul flux, un seul fichier d\'arrêt)', [r.etat, tr.appels.length], ['refuse-arret', 0]);
    d = tmp(); tr = reseau(sitePages);
    r = await C.releverPages({ etapes: [async () => ({ cibles: [{ url: 'https://www.pokellector.com/Twilight-Masquerade-Expansion/Fezandipiti-Card-96', fichier: 'x.html' }, { url: 'https://autre.example/', fichier: 'y.html' }], autorisees: new Set(['https://www.pokellector.com/Twilight-Masquerade-Expansion/Fezandipiti-Card-96', 'https://autre.example/']) }) ], dossierCache: d, transport: tr, plafond: 10, pause: async () => { }, now: Date.now });
    verifier('relever : une adresse hors de la liste fermée des hôtes est refusée AVANT toute requête, même si l\'appelant la déclare « relevée »', [r.refusees.map(x => x.motif), tr.appels.includes('https://autre.example/')], [['adresse-hors-regle'], false]);

    // ── 3. PLANIFIER (0 requête) depuis le cache de pages ──────────────────────────────────────────────────────────────────────
    const dp = tmp(); const pages = path.join(dp, 'pages'); fs.mkdirSync(pages);
    const copie = (f, dest) => fs.writeFileSync(path.join(pages, dest), lireFx(f));
    copie('liste-sets.html', 'liste-sets.html'); copie('set-twilight-masquerade.html', 'set--Twilight-Masquerade-Expansion.html'); copie('set-trick-or-trade-2024.html', 'set--Trick-or-Trade-2024-Collection.html');
    copie('carte-fezandipiti-96.html', 'carte--53249.html'); copie('carte-infernape-173.html', 'carte--53319.html'); copie('overlay-54075-tott.html', 'overlay--54075.html');
    const SETA = 'Twilight-Masquerade', SETB = 'Trick-or-Trade-2024';
    const semerPlan = B => {
        for (const s of [SETA, SETB, 'Set-Sans-Page']) B.col('sets').set(s, { _id: s, tirage: 'intl', region: 'intl' });
        B.col('sets').set('Set-Japon', { _id: 'Set-Japon', tirage: 'jp', region: 'jp' });
        const defs = [[11, 'Fezandipiti', SETA, '096', 'Fezandipiti-TWM096', 801], [11, 'Fezandipiti', SETA, '096', 'Fezandipiti-V2-TWM096', 802], [12, 'Infernape', SETA, '173', 'Infernape-TWM173', 803], [13, 'Tangela', SETA, '001', 'Tangela-TWM001', 804],
            [14, 'Munkidori', SETA, '095', 'Munkidori-TWM095', 805], [15, 'Fezandipiti', SETB, null, 'Fezandipiti-BOO24TWM-096', 806], [16, 'Zzz', 'Set-Sans-Page', '001', 'Zzz-001', 807], [17, 'Yyy', 'Set-Japon', '001', 'Yyy-001', 808]];
        for (const [id, nom, slug, num, sl, prod] of defs) {
            if (!B.col('cartes').has(id)) B.col('cartes').set(id, { _id: id, nomEn: nom, images: [] });
            B.col('cartes_produits').set(`${id}|${prod}`, { _id: `${id}|${prod}`, carteId: id, idProduct: prod, numeroFiche: num ?? undefined, slug: sl, slugSet: slug });
        }
    };
    let B = fausseBase(); semerPlan(B);
    const pl = await C.planifierDepuisBase(B.db, { dossierPages: pages, couverts: new Set([805]), refusSite: null });
    verifier('plan (0 requête) : Fezandipiti n°96 (V1 + V2, une unité), Infernape n°173, et la Fezandipiti TAMPONNÉE Trick or Trade 2024 (.mobile.jpg, à regarder)',
        pl.plan.map(p => [p.slugSet, p.produits, p.url.split('/').pop(), p.aRegarder]).sort((a, b) => String(a[0] + a[1]).localeCompare(String(b[0] + b[1]))),
        [['Trick-or-Trade-2024', [806], 'Fezandipiti.TWM.96.54075.mobile.jpg', true], ['Twilight-Masquerade', [801, 802], 'Fezandipiti.TWM.96.53249.png', false], ['Twilight-Masquerade', [803], 'Infernape.TWM.173.53319.png', false]]);
    verifier('plan : tous les motifs de reste sont nommés — couvert par une source plus grande, page de carte à relever, set sans page, tirage non intl ignoré', pl.restes.map(x => [x.idProduct, x.motif]).sort((a, b) => a[0] - b[0]),
        [[804, 'page-de-carte-a-relever'], [805, 'couvert-par-une-source-plus-grande'], [807, 'set-non-releve']]);
    verifier('plan : la page à relever est celle que le SET a relevée (jamais construite) ; le dénominateur est imprimé (sets de la table, produits examinés)', [pl.aReleve.map(a => a.url), pl.sets.map(s => s.slugSet).sort(), pl.examines], [['/Twilight-Masquerade-Expansion/Tangela-Card-1'], [SETB, SETA], 7]);
    verifier('plan : aucune adresse du plan n\'est construite — chacune figure dans une page du cache', pl.plan.every(p => ['carte--53249.html', 'carte--53319.html', 'overlay--54075.html'].some(f => fs.readFileSync(path.join(pages, f), 'utf8').includes(p.url))), true);
    verifier('plan : les produits des sets hors table / hors tirage intl ne sont pas examinés (le tirage jp n\'est jamais lu)', pl.restes.some(x => x.idProduct === 808), false);
    // une carte déjà servie n'est pas un trou
    B = fausseBase(); semerPlan(B); B.col('cartes').get(12).images.push({ set: SETA, source: 'tcgdex', numero: '173', cleR2: 'tcgdex/i.webp', langue: 'en' });
    verifier('plan : un visuel déjà servi au même numéro => « deja-servi », pas de plan', (await C.planifierDepuisBase(B.db, { dossierPages: pages, couverts: new Set(), refusSite: null })).restes.filter(x => x.motif === 'deja-servi').map(x => x.idProduct), [803]);
    // sans la liste des sets, le plan refuse (jamais de table devinée)
    { let e = null; try { await C.planifierDepuisBase(B.db, { dossierPages: tmp(), couverts: new Set(), refusSite: null }); } catch (x) { e = x; } verifier('plan : sans la liste des sets en cache => erreur nommée (« --releve d\'abord »), pas de plan vide', /liste des sets/.test(e?.message || ''), true); }
    // les plans des autres sources
    { const dd = tmp(); fs.writeFileSync(path.join(dd, 'plan-a.json'), JSON.stringify({ plan: [{ produits: [1, 2] }], remplacements: [{ produits: [3] }] })); fs.writeFileSync(path.join(dd, 'plan-b.json'), JSON.stringify({ plan: [{ produits: [4] }] })); fs.writeFileSync(path.join(dd, 'autre.json'), '{}');
      const cv = C.lireCouverts([dd]); verifier('couverts : les produits des plans pkmncards / pokedata (plan-*.json, plan et remplacements), dénominateur imprimé', [[...cv.produits].sort(), cv.fichiers], [[1, 2, 3, 4], 2]); }
    { let e = null; try { C.lireCouverts([path.join(tmp(), 'absent')]); } catch (x) { e = x; } verifier('couverts : un dossier introuvable LÈVE (jamais « rien n\'est couvert » par défaut)', !!e, true); }

    // ── 4. ÉCRIRE : depuis le cache seulement ───────────────────────────────────────────────────────────────────────────────
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    const dc = tmp(); const tr0 = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /Carte2/.test(url) ? { status: 200, type: 'image/png', octets: petit } : { status: 200, type: 'image/png', octets: grand });
    await lancer(plan.map(p => p.url), tr0, dc);
    const semer = Bx => {
        Bx.col('sets').set('Twilight-Masquerade', { _id: 'Twilight-Masquerade', tirage: 'intl', region: 'intl' });
        for (const p of plan) {
            Bx.col('cartes').set(p.carteId, { _id: p.carteId, nomEn: p.nomEn, images: [{ set: 'Autre', source: 'tcgdex', numero: '1', cleR2: 'tcgdex/x.webp', langue: 'en' }] });
            Bx.col('cartes_produits').set(`${p.carteId}|${p.produits[0]}`, { _id: `${p.carteId}|${p.produits[0]}`, carteId: p.carteId, idProduct: p.produits[0], numeroFiche: p.numero, slugSet: p.slugSet });
        }
    };
    const depotsDe = () => { const l = []; return { l, f: async (...a) => l.push(a) }; };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const vignetterBanc = () => (db, slug, o) => vignetterApresJointure(db, slug, { ...o, journal: { error() { } }, assurer: async (db2, { slug: s }) => { let k = 0; for (const c of await db2.collection('cartes').find({}).toArray()) { let t = false; const images = (c.images || []).map(e => { if (e.set !== s || !e.cleR2 || e.vignette) return e; t = true; k++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2}`, w: 200, h: 279 } }; }); if (t) await db2.collection('cartes').updateOne({ _id: c._id }, { $set: { images } }); } return { entrees: k, cles: k, traitees: k, fabriquees: k, deja: 0, depuisDocument: 0, echecs: [], interrompu: false, sets: k ? [s] : [] }; } });
    const ecrire = async (Bx, o = {}) => { const dpo = depotsDe(); const q = silencieux(); try { const b = await C.ecrire(o.plan || plan, Bx.M, { dossierCache: o.dossierCache || dc, attendu: o.attendu, remplacements: o.remplacements, remplacer: o.remplacer, deposer: dpo.f, vignetter: vignetterBanc(), fabriquerVerrouSet: verrouSet }); return { b, dp: dpo }; } finally { q(); } };
    B = fausseBase(); semer(B);
    vusFetch.length = 0;
    verifier('--attendu qui diffère du compte réel (3 à écrire : la 3e fait 300 px) : REFUSÉ avant toute écriture', await (async () => { const { b, dp: x } = await ecrire(B, { attendu: 4 }); return [b.code, b.etat, x.l.length, B.col('images').size]; })(), [2, 'refuse-attendu', 0, 0]);
    let { b, dp: dpe } = await ecrire(B, { attendu: 3 });
    verifier('écrire : 3 images écrites, la 300 px est une vignette (« trop-petit », seuil 570) ; code 0 ; AUCUNE requête', [b.code, dpe.l.length, vusFetch.length], [0, 3, 0]);
    const doc = B.col('images').get(P.idImage('Twilight-Masquerade', 100, '010'));
    verifier('le document `images` : source, lot, retirable, mention, langue, état, adresse d\'origine, collecteLe, produits, largeur', [doc.source, doc.lot, doc.retirable, doc.mention, doc.langue, doc.etat, doc.urlOriginal, doc.collecteLe instanceof Date, doc.produits, doc.wOriginal], ['pokellector', 'pokellector-2026-10', true, '© Pokémon / The Pokémon Company', 'en', 'ok', plan[0].url, true, [900], 570]);
    verifier('   R2 AVANT la ligne : clé NEUTRE (pkl/…), WebP', [dpe.l[0][1], dpe.l[0][3], dpe.l.every(x => !/pokellector/i.test(x[1]))], ['pkl/Twilight-Masquerade/010-100-en.webp', 'image/webp', true]);
    verifier('le document de la vignette : « trop-petit », seuil 570, largeur lue, rien de joint', [B.col('images').get(P.idImage('Twilight-Masquerade', 102, '012'))?.etat, B.col('images').get(P.idImage('Twilight-Masquerade', 102, '012'))?.seuilApplique, B.col('images').get(P.idImage('Twilight-Masquerade', 102, '012'))?.wOriginal, B.col('cartes').get(102).images.length], ['trop-petit', 570, 300, 1]);
    const e1 = B.col('cartes').get(100).images.find(e => e.source === 'pokellector');
    verifier('l\'entrée de la carte : set, source, lot, retirable, collecteLe, mention, langue, numéro, vignette ; l\'autre source INTACTE', [e1.set, e1.source, e1.lot, e1.retirable, e1.collecteLe instanceof Date, e1.mention, e1.langue, e1.numero, !!e1.vignette?.cleR2, B.col('cartes').get(100).images.find(e => e.source === 'tcgdex').cleR2], ['Twilight-Masquerade', 'pokellector', 'pokellector-2026-10', true, true, '© Pokémon / The Pokémon Company', 'en', '010', true, 'tcgdex/x.webp']);
    const publics = { ...e1 }; delete publics.source; delete publics.lot;
    verifier('AUCUN champ public (clé R2, vignette, mention, attribution, preuve de langue, adresse d\'origine) ne nomme la source ni l\'hôte', [JSON.stringify(publics).match(/pokellector|den-cards/i), 'urlOriginal' in e1], [null, false]);
    verifier('le bilan : dans la collection d\'état interne seulement, jamais sur `sets` (aucun champ de set ne porte le nom de la source)', [JSON.stringify(B.col('sets').get('Twilight-Masquerade')).includes('okellector'), B.col('collecte_images_etat').get('pokellector/Twilight-Masquerade')?.bilan?.garde?.ok, B.col('collecte_images_etat').get('pokellector/Twilight-Masquerade')?.bilan?.joints], [false, true, 3]);
    const avant0 = compterEtat({ cartes: [{ _id: 1, sets: ['Twilight-Masquerade'], images: [] }] }), apres0 = compterEtat({ cartes: [{ _id: 1, sets: ['Twilight-Masquerade'], images: [e1] }] });
    verifier('la garde de lot VOIT la hausse des images, et ne signale aucune baisse', [apres0.get('images set:Twilight-Masquerade') - (avant0.get('images set:Twilight-Masquerade') || 0), comparer(avant0, apres0).baisses.length], [1, 0]);
    ({ b, dp: dpe } = await ecrire(B, { attendu: 3 }));
    verifier('rejeu : rien de redéposé, une entrée par fiche (idempotent)', [dpe.l.length, B.col('cartes').get(100).images.filter(e => e.source === 'pokellector').length], [0, 1]);
    B = fausseBase(); semer(B);
    B.col('cartes').get(101).images.push({ set: 'Twilight-Masquerade', source: 'tcgdex', numero: '011', cleR2: 'tcgdex/b.webp', langue: 'en' });
    ({ b, dp: dpe } = await ecrire(B, { attendu: 3 }));
    verifier('additif : une autre source a servi ce numéro entre-temps => la nôtre CÈDE, l\'entrée de l\'autre est intacte', [b.resultats.find(x => x.code === 'Twilight-Masquerade').dejaParAutre, B.col('cartes').get(101).images.filter(e => e.source === 'pokellector').length, B.col('cartes').get(101).images.find(e => e.cleR2 === 'tcgdex/b.webp') != null], [1, 0, true]);
    B = fausseBase(); semer(B);
    const dc2 = tmp(); await lancer(plan.slice(0, 2).map(p => p.url), reseau(normal), dc2);
    ({ b, dp: dpe } = await ecrire(B, { dossierCache: dc2, attendu: 2 }));
    verifier('une adresse du plan absente du cache n\'est pas écrite (« hors-cache »)', [b.horsCache, dpe.l.length], [2, 2]);
    const i3 = idxDe(dc2); const f0 = Object.values(i3)[0].fichier; fs.writeFileSync(path.join(dc2, 'images', f0), Buffer.from('altéré'));
    B = fausseBase(); semer(B);
    ({ b, dp: dpe } = await ecrire(B, { dossierCache: dc2, attendu: 1 }));
    verifier('un fichier du cache dont le sha256 ne correspond plus est refusé', [b.altere, dpe.l.length], [1, 1]);
    // le tirage non intl, la base trop grosse
    B = fausseBase(); semer(B); B.col('sets').get('Twilight-Masquerade').tirage = 'jp'; B.col('sets').get('Twilight-Masquerade').region = 'jp';
    ({ b, dp: dpe } = await ecrire(B, { attendu: 3 }));
    verifier('un set dont le tirage n\'est pas intl : refusé (la source ne sert que des cartes anglaises), rien déposé', [dpe.l.length, b.resultats[0].etat], [0, 'refuse-set']);
    // remplacement préparé, jamais actif sans --remplacer
    const JAE = { set: 'Twilight-Masquerade', source: 'pokemon.com', numero: '010', cleR2: 'pokemon.com/ja-10.webp', langue: 'ja', w: 868, h: 1212 };
    const remp = [{ ...plan[0], refusees: [{ cleR2: JAE.cleR2, source: 'pokemon.com', numero: '010', langue: 'ja', motif: 'langue:ja' }], motif: 'entree-refusee-au-numero' }];
    const semerJa = Bx => { semer(Bx); Bx.col('cartes').get(100).images.push({ ...JAE }); Bx.col('images').set('bj', { _id: 'bj', source: 'pokemon.com', set: 'Twilight-Masquerade', carteId: 100, cleR2: JAE.cleR2, etat: 'ok', langue: 'ja' }); };
    B = fausseBase(); semerJa(B);
    ({ b, dp: dpe } = await ecrire(B, { plan: [], remplacements: remp, attendu: 0 }));
    verifier('SANS --remplacer : rien ne bouge', [dpe.l.length, B.col('cartes').get(100).images.map(e => e.source), B.col('images').get('bj').etat], [0, ['tcgdex', 'pokemon.com'], 'ok']);
    B = fausseBase(); semerJa(B);
    ({ b, dp: dpe } = await ecrire(B, { plan: [], remplacements: remp, remplacer: [999], attendu: 0 }));
    verifier('--remplacer avec un idProduct hors du motif : REFUSÉ avant toute écriture (liste fermée)', [b.code, b.etat, dpe.l.length], [2, 'refuse-remplacer', 0]);
    B = fausseBase(); semerJa(B);
    ({ b, dp: dpe } = await ecrire(B, { plan: [], remplacements: remp, remplacer: [900], attendu: 1 }));
    verifier('--remplacer=900 : l\'entrée refusée sort, la nôtre entre ; le document remplacé passe à « remplace » avec son motif', [b.code, B.col('cartes').get(100).images.map(e => `${e.source}:${e.numero}`).sort(), B.col('images').get('bj').etat, !!B.col('images').get('bj').remplaceMotif], [0, ['pokellector:010', 'tcgdex:1'], 'remplace', true]);
    const ann = C.annonceRemplacement([{ _id: 100, sets: ['Twilight-Masquerade'], images: [{ ...JAE, vignette: { cleR2: 'v/ja' } }] }], remp);
    verifier('annonce pour lot-additif : la baisse des vignettes de l\'entrée refusée est annoncée ; sans remplacement, aucune annonce', [Object.keys(ann).length > 0, Object.keys(C.annonceRemplacement([{ _id: 100, sets: ['Twilight-Masquerade'], images: [{ ...JAE }] }], [])).length], [true, 0]);

    // ── 5. LA PLANCHE (contrôle à l'œil) ───────────────────────────────────────────────────────────────────────────────────
    const ds = tmp(); const sortiePl = path.join(ds, 'planche');
    const rpl = await C.faireLaPlanche({ plan, dossierCache: dc, sortie: sortiePl, echantillon: 2 });
    const files = fs.readdirSync(sortiePl);
    const m0 = files.length ? await sharp(path.join(sortiePl, files[0])).metadata() : {};
    verifier('planche : un échantillon de 2 parmi les images en cache (la vignette de 300 px n\'y est pas), un PNG lisible, le plan de la planche est écrit', [rpl.n, files.filter(f => f.endsWith('.png')).length, m0.format, fs.existsSync(path.join(sortiePl, 'planche.json'))], [2, 1, 'png', true]);
    const rpl2 = await C.faireLaPlanche({ plan, dossierCache: dc, sortie: path.join(ds, 'p2'), echantillon: 50 });
    verifier('planche : plus d\'échantillon que d\'images => toutes celles du cache (3)', rpl2.n, 3);

    // ── 6. RETIRER : exactement le lot, à blanc par défaut ──────────────────────────────────────────────────────────────────
    const { retirerLot } = require('./retirer-visuels-pokellector');
    B = fausseBase(); semer(B);
    await ecrire(B, { attendu: 3 });
    B.col('cartes').get(103).images.push({ set: 'Twilight-Masquerade', source: 'pokellector', lot: 'autre-lot', numero: '013', cleR2: 'pkl/autre.webp' });
    const sup = []; const sansEcrire = await retirerLot(B.db, { ecrire: false });
    verifier('retrait à blanc : comptes, rien n\'est modifié', [sansEcrire.entrees, sansEcrire.cartes.length, B.col('cartes').get(100).images.some(e => e.source === 'pokellector')], [3, 3, true]);
    const rr = await retirerLot(B.db, { ecrire: true, effacerR2: true, supprimer: async (bk, cles) => sup.push(...cles), verifierBucket: async () => { }, bucket: 'bucket-banc' });
    verifier('retrait : les entrées du lot sortent ; l\'autre lot de la même source, l\'autre source restent ; documents du lot « retire »', [B.col('cartes').get(100).images.some(e => e.source === 'pokellector'), B.col('cartes').get(103).images.filter(e => e.source === 'pokellector').map(e => e.lot), B.col('cartes').get(100).images.some(e => e.source === 'tcgdex'), B.col('images').get(P.idImage('Twilight-Masquerade', 100, '010')).etat, rr.reste], [false, ['autre-lot'], true, 'retire', 0]);
    verifier('   et les clés R2 (images + vignettes) sont celles du lot seul, toutes neutres', [sup.length > 0 && sup.every(c => c.startsWith('pkl/') || c.startsWith('vignettes/pkl/'))], [true]);

    // ── 7. LA LIGNE DE COMMANDE ───────────────────────────────────────────────────────────────────────────────────────────────
    const src = fs.readFileSync(path.join(__dirname, 'collecteur-images-pokellector.js'), 'utf8');
    verifier('le CLI ne contient AUCUN process.exit( (process.exitCode seulement)', /process\.exit\(/.test(src), false);
    { const { spawnSync } = require('child_process'); const dos = tmp();
      const cli = a => spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-pokellector.js'), ...a], { encoding: 'utf8', cwd: dos, env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
      const m1 = cli(['--inconnu']);
      verifier('CLI : un argument inconnu => code 2 propre, avant toute connexion', [m1.status, /argument inconnu/.test(m1.stderr || ''), /Assertion failed/.test(m1.stderr || '')], [2, true, false]);
      verifier('CLI : --ecrire sans --attendu => code 2', cli(['--ecrire']).status, 2);
      verifier('CLI : --releve sans --plafond => code 2 (le plafond de requêtes est exigé)', cli(['--releve']).status, 2);
      verifier('CLI : deux modes à la fois => code 2', cli(['--plan', '--telecharger']).status, 2);
      fs.mkdirSync(path.join(dos, 'c', 'images'), { recursive: true }); fs.writeFileSync(path.join(dos, 'c', 'ARRET-DEFINITIF.json'), '{}');
      fs.writeFileSync(path.join(dos, 'plan.json'), JSON.stringify({ plan: [], remplacements: [] }));
      const refuse = cli(['--telecharger', `--sortie=${path.join(dos, 'plan.json')}`, `--cache=${path.join(dos, 'c')}`]);
      verifier('CLI --telecharger avec un fichier d\'arrêt : code 1 propre, aucune assertion libuv', [refuse.status, /Assertion failed/.test(refuse.stderr || '')], [1, false]);
      const rien = cli(['--telecharger', `--sortie=${path.join(dos, 'plan.json')}`, `--cache=${path.join(dos, 'c2')}`]);
      verifier('CLI --telecharger sans adresse à demander : code 0', rien.status, 0);
      const rr0 = spawnSync(process.execPath, [path.join(__dirname, 'retirer-visuels-pokellector.js'), '--effacer-r2'], { encoding: 'utf8', cwd: dos, env: process.env });
      verifier('retrait : --effacer-r2 sans --ecrire => code 2 (à blanc par défaut)', rr0.status, 2); }

    global.fetch = fetchOrigine;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
