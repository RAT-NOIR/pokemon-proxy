// node test-recepteur-pokedata.js — le relevé PASSIF au clic (userscript-pokedata.user.js + recepteur-pokedata.js) et la liste des pages à ouvrir.
// Aucune requête vers la source ; le récepteur écoute 127.0.0.1 sur un port éphémère, dossier TEMPORAIRE.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const P = require('./collecte-cartes/pokedata');
const R = require('./recepteur-pokedata');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const IMG = (set, f) => `https://pokemoncardimages.pokedata.io/images/${set}/${f}`;
const bon = () => ({ schema: 1, set: 'Trick or Trade 2024', url: 'https://www.pokedata.io/set/Trick+or+Trade+2024', cartes: [{ numero: '037a', nom: 'Mimikyu', img: IMG('Trick+or+Trade+2024', '037a.webp') }, { numero: '057a', nom: 'Gengar', img: IMG('Trick+or+Trade+2024', '057a.webp') }], diag: { imgs: 2, exemples: ['<img src="x">'], complet: false } });

(async () => {
    // ── la liste des pages à ouvrir : ≤ 10, toutes valables ───────────────────────────────────────────────────────────────
    verifier('pages à ouvrir : au plus 10, toutes des pages de set de la table, adresses valables et distinctes', [P.PAGES_A_OUVRIR.length <= 10, P.PAGES_A_OUVRIR.length, P.PAGES_A_OUVRIR.every(u => P.urlPageValide(u)), new Set(P.PAGES_A_OUVRIR).size === P.PAGES_A_OUVRIR.length], [true, 10, true, true]);
    verifier('pages à ouvrir : Trick or Trade 2024 et McDonald\'s Promos 2019 (le plus gros trou) en font partie', [P.PAGES_A_OUVRIR.includes(P.urlPageDuSet('Trick or Trade 2024')), P.PAGES_A_OUVRIR.includes(P.urlPageDuSet("McDonald's Promos 2019"))], [true, true]);

    // ── le schéma du relevé ──────────────────────────────────────────────────────────────────────────────────────────────
    verifier('schéma : un relevé conforme est accepté', R.validerReleve(bon()).ok, true);
    const cas = {
        'schéma inconnu': o => { o.schema = 2; }, 'set hors de la table': o => { o.set = 'Nope Set'; }, 'adresse de page d\'un autre hôte': o => { o.url = 'https://autre.example/set/x'; },
        'adresse de page d\'API': o => { o.url = 'https://www.pokedata.io/api/set/x'; }, 'image _240w': o => { o.cartes[0].img = IMG('Trick+or+Trade+2024', '037a_240w.webp'); }, 'image d\'un autre hôte': o => { o.cartes[0].img = 'https://autre.example/x.webp'; },
        'image d\'un autre set que celui de la page': o => { o.cartes[0].img = IMG('Pitch+Black', '037a.webp'); }, 'clé en trop': o => { o.cartes[0].prix = '3 €'; }, 'clé de relevé en trop': o => { o.cookie = 'x'; },
        'numéro non conforme': o => { o.cartes[0].numero = '../x'; }, 'nom trop long': o => { o.cartes[0].nom = 'x'.repeat(400); }, 'trop de cartes': o => { o.cartes = Array.from({ length: 1001 }, () => o.cartes[0]); }, 'corps non objet': o => { throw 0; }
    };
    for (const [nom, f] of Object.entries(cas)) { const o = bon(); let v; try { f(o); v = R.validerReleve(o); } catch { v = R.validerReleve('x'); } verifier(`schéma refusé : ${nom}`, v.ok, false); }

    // ── le serveur : gardes d'entrée et écriture ─────────────────────────────────────────────────────────────────────────
    const dos = fs.mkdtempSync(path.join(os.tmpdir(), 'pdt-rec-'));
    const srv = R.creerServeur({ dossier: dos });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const poster = (corps, { chemin = '/releve', methode = 'POST', entetes = {} } = {}) => new Promise(res => {
        const data = typeof corps === 'string' ? corps : JSON.stringify(corps);
        const rq = http.request({ host: '127.0.0.1', port, path: chemin, method: methode, headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(data), ...entetes } }, rs => { let t = ''; rs.on('data', c => t += c); rs.on('end', () => res({ statut: rs.statusCode, corps: t })); });
        rq.on('error', e => res({ erreur: e.code })); rq.end(data);
    });
    let r = await poster(bon());
    verifier('POST conforme : 200, un fichier releve--*.json (schéma 1) et un diag--*.json écrits', [r.statut, fs.readdirSync(dos).filter(f => /^releve--.*\.json$/.test(f)).length, fs.readdirSync(dos).filter(f => /^diag--.*\.json$/.test(f)).length], [200, 1, 1]);
    const lu = P.lireReleves(dos);
    verifier('le relevé écrit est relu par lireReleves (le plan le consomme) : 2 cartes, set de la table', [lu.cartes.length, lu.cartes[0].set, lu.ignores.length], [2, 'Trick or Trade 2024', 0]);
    verifier('le plan retrouve « 037a » depuis ce relevé (Mimikyu, slug …-037)', P.apparier({ trous: [{ idProduct: 1, carteId: 1, slugSet: 'Trick-or-Trade-2024', numeroFiche: null, slugProduit: 'Mimikyu-BOO24PAF-037', carte: { _id: 1, nomEn: 'Mimikyu', images: [] } }], cartes: lu.cartes, noms: new Map([['Trick-or-Trade-2024', new Map([['mimikyu', new Set([1])]])]]) }).plan.map(u => u.url), [IMG('Trick+or+Trade+2024', '037a.webp')]);
    verifier('GET : 405', (await poster('', { methode: 'GET' })).statut, 405);
    verifier('mauvais chemin : 404', (await poster(bon(), { chemin: '/autre' })).statut, 404);
    verifier('sans l\'en-tête de marque : refusé (403)', (await poster(bon(), { entetes: { 'X-Rat-Market': 'non' } })).statut, 403);
    verifier('Origin d\'un autre site : refusée (403)', (await poster(bon(), { entetes: { Origin: 'https://autre.example' } })).statut, 403);
    verifier('Origin https://www.pokedata.io : acceptée', (await poster(bon(), { entetes: { Origin: 'https://www.pokedata.io' } })).statut, 200);
    verifier('Host étranger : refusé', (await poster(bon(), { entetes: { Host: 'evil.example' } })).statut, 403);
    verifier('Content-Type autre que JSON : 415', (await poster(bon(), { entetes: { 'Content-Type': 'text/plain' } })).statut, 415);
    verifier('JSON illisible : 400', (await poster('{pas du json')).statut, 400);
    verifier('corps trop gros : 413', (await poster(JSON.stringify({ x: 'y'.repeat(1.2 * 1024 * 1024) }))).statut, 413);
    verifier('relevé non conforme : 400/422 et RIEN d\'écrit en plus', await (async () => { const avant = fs.readdirSync(dos).length; const o = bon(); o.cartes[0].img = IMG('Trick+or+Trade+2024', '037a_240w.webp'); const x = await poster(o); return [[400, 422].includes(x.statut), fs.readdirSync(dos).length === avant]; })(), [true, true]);
    // un flux SANS Content-Length déclaré : la borne se compte sur le flux
    verifier('corps de 1,2 Mo sans Content-Length (flux) : 413, la borne se compte aussi sur le flux', await new Promise(res => {
        const rq = http.request({ host: '127.0.0.1', port, path: '/releve', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Transfer-Encoding': 'chunked' } }, rs => { rs.resume(); rs.on('end', () => res(rs.statusCode)); });
        rq.on('error', e => res(e.code)); rq.write('{"x":"'); rq.write('y'.repeat(1.2 * 1024 * 1024)); rq.end('"}');
    }), 413);
    srv.close();
    verifier('le récepteur écoute 127.0.0.1 seulement (l\'hôte n\'est pas réglable)', [R.HOTE, /listen\([^)]*0\.0\.0\.0/.test(fs.readFileSync(path.join(__dirname, 'recepteur-pokedata.js'), 'utf8'))], ['127.0.0.1', false]);

    // ── le userscript : passif ───────────────────────────────────────────────────────────────────────────────────────────
    const us = fs.readFileSync(path.join(__dirname, 'userscript-pokedata.user.js'), 'utf8');
    verifier('userscript : ne tourne que sur les pages de set (@match), ne parle qu\'à 127.0.0.1', [/@match\s+https:\/\/www\.pokedata\.io\/set\/\*/.test(us), (us.match(/@match/g) || []).length, /@connect\s+127\.0\.0\.1/.test(us), /@connect\s+(?!127\.0\.0\.1)\S+/.test(us)], [true, 1, true, false]);
    verifier('userscript : aucune navigation, aucun clic automatique, aucun fetch/XHR vers la source (GM_xmlhttpRequest vers 127.0.0.1 seul)', [/location\.(href|assign|replace)\s*=|window\.open|\.click\(\)|\bfetch\(|new XMLHttpRequest|\.submit\(\)/.test(us), /GM_xmlhttpRequest/.test(us), /http:\/\/127\.0\.0\.1:8767\/releve/.test(us)], [false, true, true]);
    verifier('userscript : transforme les vignettes _240w en adresse pleine taille et ne lit aucun cookie ni stockage', [/_240w/.test(us) && /replace\(/.test(us), /document\.cookie|localStorage|sessionStorage|GM_getValue|GM_setValue/.test(us)], [true, false]);
    // le userscript EXÉCUTÉ dans un DOM simulé : une vignette _240w ressort en pleine taille, un clic envoie UN POST à 127.0.0.1, rien d'autre
    { const vm = require('vm'); const posts = []; let clic = null;
      const img = (src, alt) => ({ currentSrc: src, src, alt, title: '', getAttribute: () => null, closest: () => ({ getAttribute: () => '', outerHTML: '<div>carte</div>' }) });
      const bouton = { style: {}, addEventListener: (e, f) => { clic = f; }, set textContent(v) { } };
      const ctx = { document: { images: [img(IMG('Trick+or+Trade+2024', '037a_240w.webp'), 'Mimikyu'), img(IMG('Trick+or+Trade+2024', '037a_240w.webp'), 'Mimikyu'), img('https://autre.example/x.webp', 'X'), img(IMG('Trick+or+Trade+2024', '057a.webp'), 'Gengar')], createElement: () => bouton, body: { appendChild() { } } },
          location: { pathname: '/set/Trick+or+Trade+2024', origin: 'https://www.pokedata.io' }, GM_xmlhttpRequest: o => posts.push(o), setTimeout: () => { } };
      vm.runInNewContext(us, ctx); clic();
      const env = posts[0] && JSON.parse(posts[0].data);
      verifier('userscript exécuté : un clic = UN POST vers 127.0.0.1, la vignette _240w ressort en pleine taille, doublons et autres hôtes écartés', [posts.length, posts[0]?.url, env?.cartes.map(c => [c.numero, c.nom, c.img]), R.validerReleve(env).ok],
          [1, 'http://127.0.0.1:8767/releve', [['037a', 'Mimikyu', IMG('Trick+or+Trade+2024', '037a.webp')], ['057a', 'Gengar', IMG('Trick+or+Trade+2024', '057a.webp')]], true]); }
    verifier('userscript : la marque et la valeur du récepteur sont les mêmes que celles du récepteur', us.includes(R.ENTETE_MARQUE) && us.includes(R.VALEUR_MARQUE), true);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });
