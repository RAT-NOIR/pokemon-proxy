// node test-userscript-apprentissage.js — banc du userscript 1.5 dans un VRAI Chrome (Puppeteer), SANS UNE REQUÊTE vers Cardmarket : l'interception répond à la
// navigation avec une galerie fabriquée (la structure que le script lit : a.galleryBox, img data-echo, h2 « (CODE n°) »),
// et bloque toute autre requête. GM_* et le serveur sont simulés : 503 → /ping → 429 (reset 2 s) → 200.
const R = __dirname;
const fs = require('fs');
const puppeteer = require(`${R}/node_modules/puppeteer`);
const SCRIPT = fs.readFileSync(`${R}/userscript-apprentissage.js`, 'utf8');
const URL1 = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/30th-Celebration';
const carte = (id, slug, nom, n) => `<a class="galleryBox" href="/fr/Pokemon/Products/Singles/30th-Celebration/${slug}"><img data-echo="https://product-images.s3.cardmarket.com/51/30C/${id}/${id}.jpg" alt="${nom}"><h2>${nom} (30C ${n})</h2></a>`;
const HTML = `<!doctype html><html><head><title>30th Celebration</title></head><body>
${carte(907765, 'Exeggcute-30C001', 'Noeunoeuf', '001')}${carte(907766, 'Alolan-Exeggutor-V1-30C002', "Noadkoko d'Alola", '002')}${carte(907767, 'Volbeat-30C003?language=2', 'Muciole', '003')}
<ul class="pagination"><li><a href="${URL1}?site=2">2</a></li><li><span>10</span></li></ul></body></html>`;

// Les shims : stockage GM en mémoire de la page, et un serveur scripté. Chaque appel est journalisé dans window.__appels.
const SHIMS = (etatInitial, reponses) => `
window.__store = ${JSON.stringify(etatInitial)};
window.GM_getValue = (k, d) => (k in window.__store ? JSON.parse(JSON.stringify(window.__store[k])) : d);
window.GM_setValue = (k, v) => { window.__store[k] = JSON.parse(JSON.stringify(v)); };
window.__appels = []; window.__reponses = ${JSON.stringify(reponses)};
window.GM_xmlhttpRequest = o => {
  const chemin = o.url.replace(/^https?:\\/\\/[^/]+/, '');
  window.__appels.push({ chemin, corps: o.data ? JSON.parse(o.data) : null, t: Date.now() });
  const r = chemin === '/ping' ? { status: 200, corps: { ok: true, mongo: true } } : (window.__reponses.shift() || { status: 500, corps: { success: false } });
  setTimeout(() => o.onload({ status: r.status, responseText: JSON.stringify(r.corps), responseHeaders: r.entetes || '' }), 50);
};`;
const OK = (n) => ({ status: 200, entetes: 'ratelimit-remaining: 117\r\nratelimit-reset: 3500', corps: { success: true, recus: n, nouvelles: n, ameliorees: 0, dejaExactes: 0, completees: 0, sansNumero: 0, idExpansion: 6601, idExpansions: [6601], couverture: { produits: 191, avecNumero: 103, pourcent: 54 } } });

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

async function charger(navigateur, etat, reponses, attenteMs) {
    const page = await navigateur.newPage();
    const sorties = [];
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.isNavigationRequest() && req.url().startsWith('https://www.cardmarket.com/')) { sorties.push(req.url()); return req.respond({ status: 200, contentType: 'text/html', body: HTML }); }
        sorties.push('BLOQUÉE ' + req.url()); req.abort();
    });
    await page.evaluateOnNewDocument(SHIMS(etat, reponses));
    await page.goto(URL1, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: SCRIPT });
    await new Promise(r => setTimeout(r, attenteMs));
    const res = await page.evaluate(() => ({ appels: window.__appels, store: window.__store, panneau: document.body.lastElementChild.innerText }));
    await page.close();
    return { ...res, sorties };
}

(async () => {
    const navigateur = await puppeteer.launch({ headless: true });
    try {
        // 1. Auto au chargement : 503 → attente /ping → renvoi → 429 (reprise dans 2 s + 3 s) → 200.
        const A = await charger(navigateur, {}, [{ status: 503, corps: { success: false, error: 'Le serveur se réveille' } }, { status: 429, entetes: 'ratelimit-reset: 2\r\nratelimit-remaining: 0', corps: { success: false } }, OK(3)], 9000);
        const lots = A.appels.filter(x => x.chemin === '/api/apprendre-lot');
        // Toute requête autre que la navigation simulée est BLOQUÉE (jamais émise) ; la seule tentée est le favicon que
        // Chrome demande de lui-même. Le script, lui, n'en tente aucune vers Cardmarket.
        verifier('1. rien ne sort : seule requête tentée hors navigation = le favicon du navigateur, bloqué', A.sorties.filter(s => s.startsWith('BLOQUÉE')), ['BLOQUÉE https://www.cardmarket.com/favicon.ico']);
        verifier('   séquence : lot 503 → /ping → lot 429 → lot 200', A.appels.map(x => x.chemin === '/ping' ? 'ping' : 'lot'), ['lot', 'ping', 'lot', 'lot']);
        verifier('   chaque lot porte le userId', lots.every(l => /^rm-/.test(l.corps.userId)), true);
        verifier('   un seul envoi pour la page entière (3 cartes), pas de lots de 25', lots.map(l => l.corps.cartes.length), [3, 3, 3]);
        verifier('   slug nettoyé de sa query string, numéro du titre, code décodé', lots[0].corps.cartes[2], { idProduct: 907767, numero: '003', codeSet: '30C', nomFr: 'Muciole', variante: null, slug: 'Volbeat-30C003', slugSet: '30th-Celebration' });
        verifier('   la file est vide au succès', A.store.rm_file, []);
        verifier('   la page est marquée apprise', Object.keys(A.store.rm_pagesFaites || {}), ['/fr/Pokemon/Products/Singles/30th-Celebration']);
        verifier('   l\'expansion apprise pour ce slug : 6601', A.store.rm_slugExp, { '30th-Celebration': 6601 });
        verifier('   le panneau : rang dans la liste, couverture, budget', [/n° 1\/42/.test(A.panneau), /couverte à 54 %/.test(A.panneau), /reste 117 envoi/.test(A.panneau), /3 nouvelles/.test(A.panneau)], [true, true, true, true]);
        verifier('   la suivante de la liste est 6604 (filtre d\'expansion du site, sans perSite)', /suivante : 6604/.test(A.panneau), true);

        // 2. Page déjà apprise, rechargée : RIEN n'est envoyé (le budget de 120/h est gardé).
        const B = await charger(navigateur, A.store, [OK(3)], 1500);
        verifier('2. page déjà apprise : 0 envoi', B.appels.length, 0);
        verifier('   et le panneau le dit', /déjà apprise/.test(B.panneau), true);

        // 3. Une file laissée par des pages précédentes (même galerie) part GROUPÉE avec la page ouverte : UN envoi.
        const reste = { rm_file: [{ cle: '/fr/Pokemon/Products/Singles/30th-Celebration?site=2', slugSet: '30th-Celebration', cartes: [{ idProduct: 1, numero: '020', slugSet: '30th-Celebration' }, { idProduct: 2, numero: '021', slugSet: '30th-Celebration' }], le: 1 }] };
        const C = await charger(navigateur, reste, [OK(5)], 1500);
        verifier('3. file + page ouverte : un seul envoi de 5 cartes', C.appels.filter(x => x.chemin === '/api/apprendre-lot').map(l => l.corps.cartes.length), [5]);
        verifier('   file vide ensuite, deux pages marquées', [C.store.rm_file.length, Object.keys(C.store.rm_pagesFaites).length], [0, 2]);

        // 4. Un 400 ARRÊTE (défaut à corriger, pas à marteler) et GARDE la page dans la file.
        const D = await charger(navigateur, {}, [{ status: 400, corps: { success: false, error: 'Identifiant utilisateur manquant' } }, OK(3)], 1500);
        verifier('4. 400 : un seul essai, la page reste en file, le message le dit', [D.appels.length, D.store.rm_file.length, /version du script/.test(D.panneau)], [1, 1, true]);
    } finally { await navigateur.close(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(2); });
