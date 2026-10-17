// node test-sonde-scrydex-decks.js — la sonde BORNÉE du serveur d'images pour les decks TCG Classic ×3 et My First Battle, SANS réseau (transport factice, pause factice).
// Ce que le banc garde :
//   · le PLAN : liste fermée, ≤ 3 identifiants par set, UNE adresse par identifiant, ≤ 12 sondes (+ robots.txt), le fichier écrit = le plan construit ;
//   · la VALIDATION s'écrit par ce qu'elle autorise : tout ce qui n'est pas une adresse `/pokemon/<id>-<n>/large` de l'hôte d'images, en https, sans requête ni port, est refusé ;
//   · l'EXÉCUTION : robots.txt d'abord et respecté, cadence ≥ 5 s (jamais en dessous, même si on la demande), redirections non suivies, arrêt DÉFINITIF au premier 403/429/défi,
//     seules les adresses du plan sont demandées.
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const P = require('./collecte-cartes/ptcgio');
const S = require('./sonde-scrydex-decks');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const HOTE = P.HOTE_SCRYDEX_NOM;
const SLUGS = ['Pokemon-Trading-Card-Game-Classic-Blastoise-Suicune-ex-Deck', 'Pokemon-Trading-Card-Game-Classic-Venusaur-Lugia-ex-Deck', 'Pokemon-Trading-Card-Game-Classic-Charizard-Ho-Oh-ex-Deck', 'My-First-Battle'];
const FICHIER_PLAN = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/SCRYDEX-DECKS/sonde-plan.json';

// un transport factice : enregistre chaque adresse demandée, rend la réponse prévue (par défaut 404)
function faux(reponses = {}, parDefaut = { status: 404, type: 'image/png' }) {
    const vus = [];
    return { vus, async get(url, o) { vus.push(url); const r = typeof reponses[url] === 'function' ? reponses[url]() : (reponses[url] ?? (url.endsWith('/robots.txt') ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nAllow: /\n' } : parDefaut)); if (r instanceof Error) throw r; return r; } };
}
const pauses = [];
const pauseFausse = ms => { pauses.push(ms); return Promise.resolve(); };
let horloge = 0;
const maintenant = () => horloge;
const avancer = ms => { horloge += ms; };
const pauseAvance = ms => { pauses.push(ms); avancer(ms); return Promise.resolve(); };

(async () => {
    // ── 1. le plan ───────────────────────────────────────────────────────────────────────────────────────────────────
    const plan = S.construirePlan();
    const parSlug = new Map();
    for (const s of plan.sondes) { if (!parSlug.has(s.slug)) parSlug.set(s.slug, []); parSlug.get(s.slug).push(s); }
    verifier('le plan couvre les quatre sets, et eux seuls', [...parSlug.keys()].sort(), [...SLUGS].sort());
    verifier('≤ 12 sondes (robots.txt à part)', plan.sondes.length <= 12 && plan.sondes.length >= 4, true);
    verifier('≤ 3 identifiants par set, UNE adresse par identifiant', [...parSlug.values()].every(l => l.length <= 3 && new Set(l.map(s => s.id)).size === l.length), true);
    verifier('une seule adresse par identifiant sur tout le plan', new Set(plan.sondes.map(s => s.id)).size === plan.sondes.length, true);
    verifier('chaque adresse est `/pokemon/<id>-<n>/large` de l\'hôte d\'images, en https', plan.sondes.every(s => s.url === `https://${HOTE}/pokemon/${s.id}-${s.n}/large`), true);
    verifier('chaque sonde porte sa RAISON écrite', plan.sondes.every(s => typeof s.raison === 'string' && s.raison.length > 20), true);
    verifier('les trois Classic sondent un numéro dont on connaît la carte (nom + idProduct + numéro Cardmarket)', plan.sondes.filter(s => /Classic/.test(s.slug)).every(s => s.carteAttendue && s.carteAttendue.nom && s.carteAttendue.idProduct && s.carteAttendue.numeroCm), true);
    verifier('robots.txt de l\'hôte est dans le plan', plan.robots, `https://${HOTE}/robots.txt`);
    verifier('le plan passe sa propre validation', (() => { try { S.validerPlan(plan); return true; } catch (e) { return e.message; } })(), true);
    verifier('le fichier sonde-plan.json EST le plan construit', fs.existsSync(FICHIER_PLAN) ? JSON.parse(fs.readFileSync(FICHIER_PLAN, 'utf8')) : null, JSON.parse(JSON.stringify(plan)));

    // ── 2. la validation, écrite par ce qu'elle autorise ─────────────────────────────────────────────────────────────
    const base = JSON.parse(JSON.stringify(plan));
    const refus = (nom, muter) => { const p = JSON.parse(JSON.stringify(base)); muter(p); let m = null; try { S.validerPlan(p); } catch (e) { m = e.message; } verifier(`validation : ${nom}`, m !== null, true); };
    refus('13 sondes', p => { for (let i = 0; i < 4; i++) p.sondes.push({ ...p.sondes[0], id: `zz${i}` + 'a', url: `https://${HOTE}/pokemon/zz${i}a-1/large` }); });
    refus('un 4e identifiant pour un set (le total reste ≤ 12 : seule la règle par set mord)', p => { const mfb = p.sondes.find(s => s.slug === 'My-First-Battle'); p.sondes.push({ ...mfb, id: 'qqqq', url: `https://${HOTE}/pokemon/qqqq-${mfb.n}/large` }); if (p.sondes.length > 12) throw new Error('le banc suppose un plan de ≤ 11 sondes'); });
    refus('deux adresses pour un même identifiant', p => { p.sondes[0] = { ...p.sondes[0], url: `https://${HOTE}/pokemon/${p.sondes[0].id}-${p.sondes[0].n + 1}/large` }; p.sondes.push({ ...p.sondes[0], n: p.sondes[0].n + 2, url: `https://${HOTE}/pokemon/${p.sondes[0].id}-${p.sondes[0].n + 2}/large` }); });
    refus('une adresse qui ne correspond pas à (id, n)', p => { p.sondes[0].url = `https://${HOTE}/pokemon/${p.sondes[0].id}-99/large`; });
    refus('un autre hôte', p => { p.sondes[0].url = `https://example.org/pokemon/${p.sondes[0].id}-${p.sondes[0].n}/large`; });
    refus('http', p => { p.sondes[0].url = p.sondes[0].url.replace('https:', 'http:'); });
    refus('une requête dans l\'adresse', p => { p.sondes[0].url += '?x=1'; });
    refus('un port', p => { p.sondes[0].url = p.sondes[0].url.replace(HOTE, `${HOTE}:8443`); });
    refus('des identifiants dans l\'adresse', p => { p.sondes[0].url = p.sondes[0].url.replace('https://', 'https://u:p@'); });
    refus('un identifiant en majuscules', p => { p.sondes[0].id = 'CLB'; p.sondes[0].url = `https://${HOTE}/pokemon/CLB-${p.sondes[0].n}/large`; });
    refus('un identifiant à barre', p => { p.sondes[0].id = 'a/b'; p.sondes[0].url = `https://${HOTE}/pokemon/a/b-${p.sondes[0].n}/large`; });
    refus('un chemin d\'API', p => { p.sondes[0].url = `https://${HOTE}/v2/cards`; });
    refus('un set inconnu', p => { p.sondes[0].slug = 'Celebrations'; });
    refus('robots.txt d\'un autre hôte', p => { p.robots = 'https://example.org/robots.txt'; });
    refus('une adresse en double', p => { p.sondes.push({ ...p.sondes[0] }); });
    refus('un plan sans sondes', p => { p.sondes = []; });

    // ── 3. l'exécution ───────────────────────────────────────────────────────────────────────────────────────────────
    // 3a. tout en 404 : robots.txt d'abord, puis les adresses du plan dans l'ordre, rien d'autre ; cadence ≥ 5 s
    pauses.length = 0; horloge = 1e6;
    let t = faux();
    let r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant, cadenceMs: 5000 });
    verifier('robots.txt est la PREMIÈRE requête', t.vus[0], plan.robots);
    verifier('puis exactement les adresses du plan, dans l\'ordre, et rien d\'autre', t.vus.slice(1), plan.sondes.map(s => s.url));
    verifier('toutes absentes : 404 rendu comme « absent », la sonde continue', r.resultats.map(x => x.etat), plan.sondes.map(() => 'absent'));
    verifier('cadence : chaque attente demandée est ≥ 5 s', pauses.length > 0 && pauses.every(ms => ms >= 5000), true);
    verifier('pas de blocage déclaré', r.bloque, null);

    // 3b. une cadence demandée trop basse est relevée à 5 s
    pauses.length = 0; horloge = 1e6;
    t = faux();
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant, cadenceMs: 500 });
    verifier('cadence 500 ms demandée → au moins 5 s tenues', pauses.every(ms => ms >= 5000) && pauses.length > 0, true);

    // 3c. une réponse 200 image : ses octets, sa taille, son empreinte sont écrits
    const png = await sharp({ create: { width: 654, height: 914, channels: 3, background: { r: 200, g: 180, b: 40 } } }).png().toBuffer();
    const premiere = plan.sondes[0];
    t = faux({ [premiere.url]: { status: 200, type: 'image/png', octets: png } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    const x0 = r.resultats[0];
    verifier('200 image : etat « repond », dimensions, octets, sha256', [x0.etat, x0.w, x0.h, x0.octets, x0.sha256], ['repond', 654, 914, png.length, crypto.createHash('sha256').update(png).digest('hex')]);
    verifier('200 image : le plan continue (les autres adresses sont demandées)', t.vus.length, 1 + plan.sondes.length);

    // 3d. 200 mais pas une image (une page, un faux 200) : « pas-une-image », pas de répond
    t = faux({ [premiere.url]: { status: 200, type: 'text/html', texte: '<html>pas une image</html>' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('200 non-image : jamais « repond »', r.resultats[0].etat, 'pas-une-image');

    // 3e. une redirection n'est JAMAIS suivie
    t = faux({ [premiere.url]: { status: 302, location: 'https://example.org/ailleurs' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('redirection : notée, non suivie (l\'adresse de destination n\'est jamais demandée)', [r.resultats[0].etat, r.resultats[0].location, t.vus.includes('https://example.org/ailleurs')], ['redirection', 'https://example.org/ailleurs', false]);

    // 3f. arrêt DÉFINITIF au 1er 403 / 429 / cf-mitigated / défi : plus aucune requête, le reste « non-lancee »
    for (const [nom, rep] of [['403', { status: 403, type: 'text/html', texte: 'Forbidden' }], ['429', { status: 429, type: 'text/html', texte: 'Too Many' }],
        ['cf-mitigated', { status: 200, type: 'text/html', texte: 'x', cfMitigated: 'challenge' }], ['défi dans la page', { status: 200, type: 'text/html', texte: '<title>Just a moment...</title>' }]]) {
        t = faux({ [plan.sondes[1].url]: rep });
        horloge = 1e6;
        r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
        verifier(`arrêt définitif au premier ${nom} : requêtes = robots + 2 sondes, pas une de plus`, t.vus.length, 3);
        verifier(`${nom} : l'état dit BLOQUE, le reste n'est pas lancé`, [r.resultats[1].etat, r.resultats.slice(2).every(y => y.etat === 'non-lancee'), !!r.bloque], ['bloque', true, true]);
    }
    // un 403 sur robots.txt arrête avant toute image
    t = faux({ [plan.robots]: { status: 403, type: 'text/html', texte: 'Forbidden' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('403 sur robots.txt : aucune image demandée', [t.vus.length, !!r.bloque], [1, true]);

    // 3g. robots.txt : Disallow respecté, illisible = on ne conclut pas, Crawl-delay appliqué ou arrêt
    t = faux({ [plan.robots]: { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /pokemon/\n' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('robots.txt interdit /pokemon/ : aucune image demandée, tout « interdit-par-robots »', [t.vus.length, r.resultats.every(y => y.etat === 'interdit-par-robots')], [1, true]);
    t = faux({ [plan.robots]: { status: 500, type: 'text/html', texte: 'oups' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('robots.txt illisible (500) : on ne peut pas conclure, aucune image', [t.vus.length, r.resultats.every(y => y.etat === 'non-lancee'), !!r.arret], [1, true, true]);
    t = faux({ [plan.robots]: { status: 404, type: 'text/html', texte: 'nope' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('robots.txt absent (404) : pas de règle, la sonde se fait', t.vus.length, 1 + plan.sondes.length);
    pauses.length = 0;
    t = faux({ [plan.robots]: { status: 200, type: 'text/plain', texte: 'User-agent: *\nCrawl-delay: 12\nAllow: /\n' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant, cadenceMs: 5000 });
    verifier('Crawl-delay 12 s : la cadence monte à 12 s', pauses.length > 0 && pauses.every(ms => ms >= 12000), true);
    t = faux({ [plan.robots]: { status: 200, type: 'text/plain', texte: 'User-agent: *\nCrawl-delay: 120\n' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('Crawl-delay 120 s (> 60) : on s\'arrête, aucune image', [t.vus.length, !!r.arret], [1, true]);

    // 3h. une erreur réseau ou un 5xx : notés, aucun réessai (une adresse = une requête)
    t = faux({ [plan.sondes[0].url]: new Error('ETIMEDOUT') });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('erreur réseau : notée, pas de réessai, la sonde continue', [r.resultats[0].etat, t.vus.filter(u => u === plan.sondes[0].url).length, t.vus.length], ['erreur', 1, 1 + plan.sondes.length]);
    t = faux({ [plan.sondes[0].url]: { status: 503, type: 'text/html', texte: 'down' } });
    horloge = 1e6;
    r = await S.sonder({ plan, transport: t, pause: pauseAvance, maintenant });
    verifier('503 : noté « erreur », une seule requête sur cette adresse', [r.resultats[0].etat, t.vus.filter(u => u === plan.sondes[0].url).length], ['erreur', 1]);

    // 3i. un plan invalide ne lance AUCUNE requête
    const mauvais = JSON.parse(JSON.stringify(plan)); mauvais.sondes[0].url = 'https://example.org/x';
    t = faux();
    let leve = null; try { await S.sonder({ plan: mauvais, transport: t, pause: pauseAvance, maintenant }); } catch (e) { leve = e.message; }
    verifier('plan invalide : lève, zéro requête', [!!leve, t.vus.length], [true, 0]);

    // 3j. le transport par défaut est celui du client gardé (hôte d'images seulement) ; le script lui-même ne lance rien à l'import
    verifier('transport par défaut = transportFetch du client (garde d\'hôte au dernier mètre)', S.TRANSPORT_PAR_DEFAUT === P.transportFetch, true);
    verifier('agent = celui du dépôt', S.UA, P.UA);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
