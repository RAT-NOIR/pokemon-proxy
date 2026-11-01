// Banc de la PORTE RÉSEAU (collecte-cartes/porte-reseau.js). Dossiers TEMPORAIRES seulement, transport FACTICE : aucune requête réelle, aucun vrai chemin du testeur.
// Chaque garde est prouvée par un REFUS sur un état fabriqué (une garde qui n'a jamais dit non n'est pas vérifiée) :
//   fermé · robots d'abord · robots respecté · défi -> arrêt · cadence · exclusions · journal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP_RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'porte-banc-'));
process.env.ARRETS_HOTES_DOSSIER = path.join(TMP_RACINE, 'arrets-env');
process.env.PORTE_RESEAU_DOSSIER = path.join(TMP_RACINE, 'porte-env');
const P = require('./collecte-cartes/porte-reseau');

let ok = 0, ko = 0;
const verifier = (cond, msg) => { if (cond) ok++; else { ko++; console.log(`🔴 ${msg}`); } };
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);

function banc() {
    const arrets = fs.mkdtempSync(path.join(TMP_RACINE, 'arrets-'));
    const porte = fs.mkdtempSync(path.join(TMP_RACINE, 'porte-'));
    const sorties = path.join(porte, 'sorties');       // D5 : la seule racine de sortie permise hors catalogue\ et scratchpad
    fs.mkdirSync(sorties, { recursive: true });
    let t = Date.parse('2026-11-01T10:00:00Z');
    const appels = [], reponses = {};
    const transport = { async get(url) { appels.push({ url, t }); const r = reponses[url]; if (r === undefined) throw new Error(`requête inattendue ${url}`); return typeof r === 'function' ? r() : r; } };
    const o = { transport, maintenant: () => t, pause: ms => { t += ms; }, dossierArrets: arrets, dossierPorte: porte };
    const journal = () => { const f = path.join(porte, 'journal.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
    return { arrets, porte, sorties, appels, reponses, o, journal, urls: () => appels.map(a => a.url), avancer: ms => { t += ms; }, maintenant: () => t };
}
const ROBOTS = texte => ({ status: 200, type: 'text/plain', texte });
const PAGE = texte => ({ status: 200, type: 'text/html; charset=utf-8', texte });
const fermer = (b, nom) => fs.writeFileSync(path.join(b.arrets, `ARRET-HOTE-${nom}.json`), JSON.stringify({ hote: nom, nature: 'arret-definitif', motif: 'banc' }));
async function lever(f) { try { await f(); return null; } catch (e) { return e; } }

(async () => {
    // ── 1. HÔTE FERMÉ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc(); fermer(b, 'www.misprint.com');
        for (const u of ['https://www.misprint.com/x', 'https://misprint.com/x', 'https://cdn.misprint.com/y.png']) {
            const v = await P.verdict(u, b.o);
            verifier(v.ok === false && /ferm|arr[êe]t/i.test(v.motif), `fermé : ${u} doit être refusé (${JSON.stringify(v)})`);
            const e = await lever(() => P.lire(u, { ...b.o, sortie: path.join(b.sorties, 'a') }));
            verifier(e && e.refus === true, `fermé : lire ${u} doit lever un refus`);
        }
        verifier(b.appels.length === 0, `fermé : le transport ne doit recevoir AUCUNE requête (reçu ${b.appels.length})`);
        const v2 = await P.verdict('https://autre.test/x', b.o);   // un autre hôte n'est pas fermé (robots demandé -> transport factice sans réponse -> refus de conclure)
        verifier(v2.ok === false && !/ferm/i.test(v2.motif), 'fermé : un autre hôte n\'est pas refusé comme fermé');
    }
    {   // fichier d'arrêt illisible = fermé ; dossier illisible = tout refusé
        const b = banc(); fs.writeFileSync(path.join(b.arrets, 'ARRET-HOTE-casse.test.json'), '{pas du json');
        const v = await P.verdict('https://casse.test/x', b.o);
        verifier(v.ok === false && b.appels.length === 0, 'fermé : un fichier d\'arrêt illisible ferme l\'hôte');
        const fichier = path.join(b.sorties, 'pas-un-dossier'); fs.writeFileSync(fichier, 'x');
        const v2 = await P.verdict('https://h.test/x', { ...b.o, dossierArrets: fichier });
        verifier(v2.ok === false && b.appels.length === 0, 'fermé : un dossier des arrêts illisible refuse tout');
    }
    // ── 2. ROBOTS D'ABORD (le cas pokebip) ──────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow:\n');
        b.reponses['https://h.test/p1'] = PAGE('<html>bonjour</html>');
        b.reponses['https://h.test/p2'] = PAGE('<html>deux</html>');
        const r = await P.lire('https://h.test/p1', { ...b.o, sortie: path.join(b.sorties, 'p1.html') });
        verifier(r.ok === true && b.urls()[0] === 'https://h.test/robots.txt' && b.urls()[1] === 'https://h.test/p1' && b.urls().length === 2,
            `robots d'abord : le transport doit voir robots.txt AVANT la page (vu ${JSON.stringify(b.urls())})`);
        verifier(fs.readFileSync(path.join(b.sorties, 'p1.html'), 'utf8').includes('bonjour'), 'robots d\'abord : la page est écrite');
        await P.lire('https://h.test/p2', { ...b.o, sortie: path.join(b.sorties, 'p2.html') });
        verifier(b.urls().filter(u => u.endsWith('/robots.txt')).length === 1, 'robots d\'abord : robots.txt en cache 24 h, pas redemandé');
        b.avancer(25 * 3600 * 1000);
        b.reponses['https://h.test/p3'] = PAGE('<html>trois</html>');
        await P.lire('https://h.test/p3', { ...b.o, sortie: path.join(b.sorties, 'p3.html') });
        verifier(b.urls().filter(u => u.endsWith('/robots.txt')).length === 2, 'robots d\'abord : robots.txt périmé (> 24 h) redemandé');
        const j = b.journal();
        verifier(j.filter(l => l.decision === 'requete').length === 5 && j.every(l => l.le && l.url && l.mode), `journal : une ligne par requête (robots compris) — vu ${j.length}`);
    }
    // ── 3. PAGE INTERDITE ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow: /cartes/\n');
        b.reponses['https://h.test/autre'] = PAGE('<p>ok</p>');
        const v = await P.verdict('https://h.test/cartes/1', b.o);
        verifier(v.ok === false && /robots/i.test(v.motif), `robots respecté : /cartes/1 refusé (${JSON.stringify(v)})`);
        const e = await lever(() => P.lire('https://h.test/cartes/1', { ...b.o, sortie: path.join(b.sorties, 'x') }));
        verifier(e && e.refus === true && !b.urls().includes('https://h.test/cartes/1'), 'robots respecté : la page interdite n\'est JAMAIS demandée');
        const v2 = await P.verdict('https://h.test/autre', b.o);
        verifier(v2.ok === true, '/autre est autorisé');
        const v3 = await P.verdict('https://h.test/autre?x=1', b.o);
        verifier(v3.ok === true, 'avec requête, toujours autorisé');
    }
    {   // la requête (query) compte
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow: /*?secret=\n');
        const v = await P.verdict('https://h.test/p?secret=1', b.o);
        verifier(v.ok === false, 'robots respecté : le chemin ET la requête sont jugés');
    }
    {   // un groupe propre à Claude-User, ou à ClaudeBot, qui interdit
        for (const agent of ['Claude-User', 'ClaudeBot', 'rat-market-catalogue']) {
            const b = banc();
            b.reponses['https://h.test/robots.txt'] = ROBOTS(`User-agent: *\nAllow: /\n\nUser-agent: ${agent}\nDisallow: /\n`);
            const v = await P.verdict('https://h.test/page', b.o);
            verifier(v.ok === false, `robots respecté : un groupe ${agent} qui interdit refuse (${JSON.stringify(v)})`);
        }
    }
    {   // Crawl-delay
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nCrawl-delay: 90\n');
        const v = await P.verdict('https://h.test/page', b.o);
        verifier(v.ok === false && /crawl/i.test(v.motif), 'Crawl-delay > 60 s : refus');
    }
    // ── 4. ROBOTS.TXT ILLISIBLE : on ne peut pas conclure ────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc(); b.reponses['https://h.test/robots.txt'] = { status: 403, type: 'text/html', texte: 'interdit' };
        const v = await P.verdict('https://h.test/p', b.o);
        verifier(v.ok === false && fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-h.test.json')), 'robots 403 : refus ET arrêt écrit pour la racine');
        const v2 = await P.verdict('https://h.test/p', b.o);
        verifier(v2.ok === false && /ferm|arr[êe]t/i.test(v2.motif) && b.appels.length === 1, 'robots 403 : l\'hôte est fermé ensuite (aucune seconde requête)');
    }
    {
        const b = banc(); b.reponses['https://sub.h.test/robots.txt'] = { status: 429, type: 'text/plain', texte: '' };
        await P.verdict('https://sub.h.test/p', b.o);
        verifier(fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-h.test.json')), 'robots 429 : l\'arrêt est écrit sur la RACINE');
    }
    {
        const b = banc(); b.reponses['https://h.test/robots.txt'] = { status: 503, type: 'text/plain', texte: 'indisponible' };
        const v = await P.verdict('https://h.test/p', b.o);
        verifier(v.ok === false && !fs.existsSync(path.join(b.porte, 'robots', 'h.test.json')) && !fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-h.test.json')), 'robots 503 : refus sans cache et sans arrêt');
    }
    {
        const b = banc(); b.reponses['https://h.test/robots.txt'] = { status: 200, type: 'text/html', texte: '<html><body>une page</body></html>' };
        const v = await P.verdict('https://h.test/p', b.o);
        verifier(v.ok === false && !fs.existsSync(path.join(b.porte, 'robots', 'h.test.json')), 'robots HTML 200 : refus, rien en cache');
    }
    {
        const b = banc(); b.reponses['https://h.test/robots.txt'] = { status: 404, type: 'text/html', texte: 'nf' };
        const v = await P.verdict('https://h.test/p', b.o);
        verifier(v.ok === true, 'robots 404 : « aucune règle », autorisé');
        const c = JSON.parse(fs.readFileSync(path.join(b.porte, 'robots', 'h.test.json'), 'utf8'));
        verifier(c.statut === 'absent' && c.status === 404 && c.le, 'robots 404 : mis en cache (statut absent)');
    }
    {   // redirection de robots.txt : même racine suivie (3 max), ailleurs = refus
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = { status: 301, location: 'https://www.h.test/robots.txt', type: '' };
        b.reponses['https://www.h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow:\n');
        const v = await P.verdict('https://h.test/p', b.o);
        verifier(v.ok === true, `robots redirigé dans la même racine : suivi (${JSON.stringify(v)})`);
        const b2 = banc(); b2.reponses['https://h.test/robots.txt'] = { status: 301, location: 'https://ailleurs.test/robots.txt', type: '' };
        const v2 = await P.verdict('https://h.test/p', b2.o);
        verifier(v2.ok === false && b2.appels.length === 1, 'robots redirigé ailleurs : refus, non suivi');
        const b3 = banc();
        for (let i = 0; i < 6; i++) b3.reponses[i ? `https://h.test/r${i}` : 'https://h.test/robots.txt'] = { status: 302, location: `https://h.test/r${i + 1}`, type: '' };
        const v3 = await P.verdict('https://h.test/p', b3.o);
        verifier(v3.ok === false && b3.appels.length <= 4, `robots : trois sauts au plus (${b3.appels.length} requêtes)`);
    }
    // ── 5. DÉFI -> ARRÊT ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow:\n');
        b.reponses['https://h.test/d'] = { status: 403, type: 'text/html', texte: '<html>Just a moment...</html>', cfMitigated: 'challenge' };
        const e = await lever(() => P.lire('https://h.test/d', { ...b.o, sortie: path.join(b.sorties, 'd') }));
        verifier(e && e.arret === true && fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-h.test.json')), 'défi 403 : arrêt écrit et erreur');
        verifier(!fs.existsSync(path.join(b.sorties, 'd')), 'défi : rien n\'est écrit en sortie');
        const v = await P.verdict('https://h.test/autre', b.o);
        verifier(v.ok === false, 'défi : l\'hôte est fermé ensuite');
    }
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b.reponses['https://h.test/m'] = { status: 200, type: 'text/html', texte: '<html><title>Just a moment...</title></html>' };
        const e = await lever(() => P.lire('https://h.test/m', { ...b.o, sortie: path.join(b.sorties, 'm') }));
        verifier(e && e.arret === true && fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-h.test.json')), 'défi « Just a moment » (HTTP 200) : arrêt');
    }
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b.reponses['https://h.test/l'] = { status: 429, type: 'text/plain', texte: 'trop' };
        const e = await lever(() => P.lire('https://h.test/l', { ...b.o, sortie: path.join(b.sorties, 'l') }));
        verifier(e && e.arret === true && fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-h.test.json')), '429 : arrêt');
    }
    {   // une page normale qui n'est pas 200 n'est pas écrite
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b.reponses['https://h.test/n'] = { status: 404, type: 'text/html', texte: 'introuvable' };
        const e = await lever(() => P.lire('https://h.test/n', { ...b.o, sortie: path.join(b.sorties, 'n') }));
        verifier(e && !e.arret && !e.refus && !fs.existsSync(path.join(b.sorties, 'n')), '404 : erreur simple, rien écrit, pas d\'arrêt');
    }
    // ── 6. CADENCE ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow:\n');
        b.reponses['https://h.test/a'] = PAGE('a'); b.reponses['https://www.h.test/b'] = PAGE('b');
        b.reponses['https://www.h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow:\n');
        await P.lire('https://h.test/a', { ...b.o, sortie: path.join(b.sorties, 'a') });
        await P.lire('https://www.h.test/b', { ...b.o, sortie: path.join(b.sorties, 'b') });
        let min = Infinity; for (let i = 1; i < b.appels.length; i++) min = Math.min(min, b.appels[i].t - b.appels[i - 1].t);
        verifier(b.appels.length === 4 && min >= 5000, `cadence : écart ≥ 5 s entre deux requêtes de la même racine (min ${min} ms sur ${b.appels.length})`);
    }
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nCrawl-delay: 12\n');
        b.reponses['https://h.test/a'] = PAGE('a'); b.reponses['https://h.test/b'] = PAGE('b');
        await P.lire('https://h.test/a', { ...b.o, sortie: path.join(b.sorties, 'a') });
        await P.lire('https://h.test/b', { ...b.o, sortie: path.join(b.sorties, 'b') });
        verifier(b.appels[2].t - b.appels[1].t >= 12000, `cadence : le Crawl-delay de 12 s est tenu (${b.appels[2].t - b.appels[1].t} ms)`);
    }
    // ── 7. EXCLUS PAR DÉCISION ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        for (const u of ['https://www.vinted.fr/items/1', 'https://vinted.com/x', 'https://www.vinted.co.uk/x', 'https://www.cardmarket.com/en/Pokemon', 'https://cardmarket.com/x', 'https://pokecardex-scans.b-cdn.net/a.jpg']) {
            const v = await P.verdict(u, b.o);
            verifier(v.ok === false, `exclu : ${u}`);
        }
        const vi = await P.verdict('https://www.pokecardex.com/img/a.jpg', { ...b.o, mode: 'image' });
        verifier(vi.ok === false, 'exclu : pokecardex en mode image');
        verifier(b.appels.length === 0, `exclus : aucune requête (${b.appels.length})`);
        b.reponses['https://www.pokecardex.com/robots.txt'] = ROBOTS('User-agent: *\nDisallow:\n');
        const vp = await P.verdict('https://www.pokecardex.com/series', { ...b.o, mode: 'page' });
        verifier(vp.ok === true, 'pokecardex.com : une page HTML se consulte (mode page)');
        const j = b.journal();
        verifier(j.filter(l => l.decision === 'refus').length === 7, `journal : une ligne par refus (${j.filter(l => l.decision === 'refus').length}/7)`);
    }
    {   // https seulement, ni identifiants ni port ; mode inconnu
        const b = banc();
        for (const u of ['http://h.test/x', 'https://user:pw@h.test/x', 'https://h.test:8443/x', 'pas une adresse', 'ftp://h.test/x', 'https://127.0.0.1/x', 'https://localhost/x']) {
            const v = await P.verdict(u, b.o);
            verifier(v.ok === false, `refusé : ${u}`);
        }
        const vm = await P.verdict('https://h.test/x', { ...b.o, mode: 'autre' });
        verifier(vm.ok === false, 'mode inconnu refusé');
        verifier(b.appels.length === 0, 'adresses illicites : aucune requête');
    }
    // ── 8. IMAGE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b.reponses['https://h.test/a.png'] = { status: 200, type: 'image/png', octets: PNG };
        const r = await P.lire('https://h.test/a.png', { ...b.o, mode: 'image', sortie: path.join(b.sorties, 'a.png') });
        verifier(r.ok === true && fs.readFileSync(path.join(b.sorties, 'a.png')).equals(PNG), 'image : octets écrits tels quels');
        b.reponses['https://h.test/b.png'] = { status: 403, type: 'text/html', texte: 'non' };
        const e = await lever(() => P.lire('https://h.test/b.png', { ...b.o, mode: 'image', sortie: path.join(b.sorties, 'b.png') }));
        verifier(e && e.arret === true && fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-h.test.json')), 'image : défi -> arrêt');
    }
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b.reponses['https://h.test/c.png'] = { status: 200, type: 'text/html', texte: '<html>page sans défi</html>' };
        const e = await lever(() => P.lire('https://h.test/c.png', { ...b.o, mode: 'image', sortie: path.join(b.sorties, 'c.png') }));
        verifier(e && !e.arret && !fs.existsSync(path.join(b.sorties, 'c.png')), 'image : un 200 HTML n\'est pas une image, rien écrit');
    }
    // ── 9. TEXTE RÉDUIT, REDIRECTIONS ───────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b.reponses['https://h.test/t'] = PAGE('<html><head><style>.a{color:red}</style><script>var secret=1;</script></head><body><h1>Titre</h1><p>Un &amp; deux</p><!-- note --></body></html>');
        await P.lire('https://h.test/t', { ...b.o, texte: true, sortie: path.join(b.sorties, 't.txt') });
        const t = fs.readFileSync(path.join(b.sorties, 't.txt'), 'utf8');
        verifier(t.includes('Titre') && t.includes('Un & deux') && !/secret|color:red|<|note/.test(t), `texte réduit : scripts, styles et balises retirés (${JSON.stringify(t)})`);
    }
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b.reponses['https://www.h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow: /b\n');
        b.reponses['https://h.test/a'] = { status: 301, location: 'https://www.h.test/b', type: '' };
        const e = await lever(() => P.lire('https://h.test/a', { ...b.o, sortie: path.join(b.sorties, 'a') }));
        verifier(e && e.refus === true && !b.urls().includes('https://www.h.test/b'), 'redirection dans la racine : le saut repasse le verdict (robots du nouvel hôte), refusé et jamais demandé');
        const b2 = banc();
        b2.reponses['https://h.test/robots.txt'] = ROBOTS('');
        b2.reponses['https://h.test/a'] = { status: 302, location: 'https://ailleurs.test/z', type: '' };
        const r = await P.lire('https://h.test/a', { ...b2.o, sortie: path.join(b2.sorties, 'a') });
        verifier(r.redirige === 'https://ailleurs.test/z' && b2.urls().length === 2 && !fs.existsSync(path.join(b2.sorties, 'a')), 'redirection ailleurs : location rendue, non suivie');
    }
    {   // le CLI : verifier / fermer / usage, par un vrai processus
        const { spawnSync } = require('child_process');
        const env = { ...process.env, ARRETS_HOTES_DOSSIER: path.join(TMP_RACINE, 'cli-arrets'), PORTE_RESEAU_DOSSIER: path.join(TMP_RACINE, 'cli-porte') };
        const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'collecte-cartes', 'porte-reseau.js'), ...a], { encoding: 'utf8', env });
        verifier(cli().status === 2, 'CLI : sans argument -> 2');
        verifier(cli('verifier').status === 2, 'CLI : verifier sans adresse -> 2');
        verifier(cli('inconnu', 'x').status === 2, 'CLI : commande inconnue -> 2');
        verifier(cli('verifier', 'https://www.vinted.fr/x', '--bizarre').status === 2, 'CLI : option inconnue -> 2');
        verifier(cli('verifier', 'https://www.vinted.fr/x').status === 3, 'CLI : exclu -> 3');
        verifier(cli('fermer', 'www.exemple.test', '--motif=banc').status === 0 && fs.existsSync(path.join(TMP_RACINE, 'cli-arrets', 'ARRET-HOTE-www.exemple.test.json')), 'CLI : fermer écrit l\'arrêt');
        verifier(cli('fermer', 'www.exemple.test').status === 2, 'CLI : fermer sans motif -> 2');
        verifier(cli('verifier', 'https://exemple.test/x').status === 3, 'CLI : hôte fermé (racine) -> 3, sans réseau');
        verifier(cli('lire', 'https://www.vinted.fr/x').status === 2, 'CLI : lire sans --sortie -> 2');
    }

    // ═══ TOUR 1 DE CORRECTION (relecture 1) : chaque attaque de la relecture est un cas du banc ═══════════════════════════════════════════════
    // ── D1 : le point final / la casse / %2e ne rouvrent pas un hôte fermé ──────────────────────────────────────────────────────────────────
    {
        const b = banc(); fermer(b, 'www.misprint.com');
        for (const u of ['https://www.misprint.com./x', 'https://misprint.com./x', 'https://cdn.misprint.com./y', 'https://www.misprint.com%2e/x', 'https://WWW.MISPRINT.COM/x', 'https://a.b.misprint.com./x', 'https://www.misprint。com/x']) {
            const v = await P.verdict(u, b.o);
            verifier(v.ok === false && /ferm/i.test(v.motif), `D1 : ${u} doit être refusé comme hôte fermé (${v.motif})`);
        }
        verifier(b.appels.length === 0, `D1 : aucune requête vers un hôte fermé (reçu ${b.appels.length})`);
        for (const u of ['https://www.vinted.fr./x', 'https://www.cardmarket.com./x', 'https://pokecardex.com./img/a.jpg']) {
            const v = await P.verdict(u, { ...b.o, mode: u.includes('img') ? 'image' : 'page' });
            verifier(v.ok === false, `D1 : exclu avec point final ${u}`);
        }
    }
    // ── noms non publics ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        for (const u of ['https://localhost./x', 'https://foo.local/x', 'https://foo.localhost/x', 'https://metadata.google.internal/x', 'https://0x7f.1/x', 'https://[::1]/x', 'https://127.1/x', 'https://2130706433/x', 'https://intranet/x', 'https://10.0.0.1/x', 'https://co.uk/x']) {
            const v = await P.verdict(u, b.o);
            verifier(v.ok === false, `nom non public refusé : ${u}`);
        }
        verifier(b.appels.length === 0, 'noms non publics : aucune requête');
    }
    // ── D6 : racine à deux niveaux ───────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://example.co.uk/robots.txt'] = ROBOTS(''); b.reponses['https://example.co.uk/d'] = { status: 403, type: 'text/html', texte: 'non' };
        const e = await lever(() => P.lire('https://example.co.uk/d', { ...b.o, sortie: path.join(b.sorties, 'd') }));
        verifier(e && e.arret === true && fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-example.co.uk.json')) && !fs.existsSync(path.join(b.arrets, 'ARRET-HOTE-co.uk.json')), 'D6 : un 403 sur example.co.uk écrit l\'arrêt de example.co.uk, jamais de co.uk');
        b.reponses['https://autresite.co.uk/robots.txt'] = ROBOTS('');
        const v = await P.verdict('https://autresite.co.uk/x', b.o);
        verifier(v.ok === true, `D6 : autresite.co.uk n'est pas fermé (${v.motif})`);
        const v2 = await P.verdict('https://www.example.co.uk/x', b.o);
        verifier(v2.ok === false && /ferm/i.test(v2.motif), 'D6 : www.example.co.uk reste fermé (même racine)');
    }
    // ── D7 : la vraie forme d'un ARRET-HOTE (nom logique, hôte réel dans `url`) ─────────────────────────────────────────────────────────
    {
        const b = banc();
        fs.writeFileSync(path.join(b.arrets, 'ARRET-HOTE-sources-r6-billsarchive.com.json'), JSON.stringify({ hote: 'sources-r6-billsarchive.com', nature: 'arret-definitif', motif: 'banc', url: 'https://bills-archive.nyc3.cdn.digitaloceanspaces.com/robots.txt' }));
        const v = await P.verdict('https://bills-archive.nyc3.cdn.digitaloceanspaces.com/a.png', b.o);
        verifier(v.ok === false && /ferm/i.test(v.motif) && b.appels.length === 0, 'D7 : l\'hôte du champ url est fermé');
        b.reponses['https://autre.nyc3.cdn.digitaloceanspaces.com/robots.txt'] = ROBOTS('');
        const v2 = await P.verdict('https://autre.nyc3.cdn.digitaloceanspaces.com/a.png', b.o);
        verifier(v2.ok === true, `D7 : un autre hôte du CDN partagé n'est PAS fermé (${v2.motif})`);
        fs.writeFileSync(path.join(b.arrets, 'ARRET-HOTE-nom-logique.json'), JSON.stringify({ hote: 'www.logique.test', motif: 'banc' }));
        const v3 = await P.verdict('https://logique.test/x', b.o);
        verifier(v3.ok === false && /ferm/i.test(v3.motif), 'D7 : le champ `hote` ferme avec sa racine');
    }
    // ── D3 : le chemin est normalisé avant robots ───────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow: /cartes/\nDisallow: /prive\n');
        for (const u of ['https://h.test/%63artes/1', 'https://h.test/%70rive', 'https://h.test//cartes/1', 'https://h.test/cartes%2F1', 'https://h.test/x/../cartes/1', 'https://h.test/./cartes/1', 'https://h.test/cartes/%31']) {
            const v = await P.verdict(u, b.o);
            verifier(v.ok === false, `D3 : ${u} doit être refusé`);
        }
        const ok1 = await P.verdict('https://h.test/CARTES/1', b.o);
        verifier(ok1.ok === true, 'D3 : la casse reste significative (RFC 9309)');
        const ok2 = await P.verdict('https://h.test/ok%2Fx', b.o);
        verifier(ok2.ok === true, 'D3 : un chemin autorisé encodé reste autorisé');
    }
    {   // M1 : groupe User-agent vide ignoré
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS('User-agent: *\nDisallow: /\n\nUser-agent:\nAllow: /\n');
        const v = await P.verdict('https://h.test/cartes/1', b.o);
        verifier(v.ok === false, 'M1 : un groupe User-agent vide n\'ouvre pas ce que * ferme');
    }
    // ── D8 : cadence atomique (deux lectures concurrentes) ──────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS(''); b.reponses['https://h.test/a'] = PAGE('a'); b.reponses['https://h.test/b'] = PAGE('b'); b.reponses['https://h.test/c'] = PAGE('c');
        await P.lire('https://h.test/a', { ...b.o, sortie: path.join(b.sorties, 'a') });
        let t = b.maintenant();
        const o = { ...b.o, maintenant: () => t, pause: async ms => { const cible = t + ms; await new Promise(r => setImmediate(r)); if (t < cible) t = cible; },
            transport: { async get(url) { b.appels.push({ url, t }); const r = b.reponses[url]; if (!r) throw new Error('inattendue ' + url); return r; } } };
        const avant = b.appels.length;
        await Promise.all([P.lire('https://h.test/b', { ...o, sortie: path.join(b.sorties, 'b') }), P.lire('https://h.test/c', { ...o, sortie: path.join(b.sorties, 'c') })]);
        const ts = b.appels.slice(avant - 1).map(x => x.t).sort((x, y) => x - y);
        let min = Infinity; for (let i = 1; i < ts.length; i++) min = Math.min(min, ts[i] - ts[i - 1]);
        verifier(ts.length === 3 && min >= 5000, `D8 : deux lectures concurrentes de la même racine : écart ≥ 5 s (min ${min} ms sur ${ts.length})`);
        verifier(fs.readdirSync(path.join(b.porte, 'cadence')).every(f => !f.endsWith('.lock')), 'D8 : aucun verrou ne reste');
    }
    {   // un verrou périmé (> 2 min) est repris
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS(''); b.reponses['https://h.test/a'] = PAGE('a');
        fs.mkdirSync(path.join(b.porte, 'cadence'), { recursive: true });
        fs.writeFileSync(path.join(b.porte, 'cadence', 'h.test.lock'), JSON.stringify({ le: b.maintenant() - 3 * 60 * 1000, pid: 1 }));
        const r = await P.lire('https://h.test/a', { ...b.o, sortie: path.join(b.sorties, 'a') });
        verifier(r.ok === true, 'D8 : un verrou périmé est repris');
    }
    // ── D5 : --sortie ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const b = banc();
        b.reponses['https://h.test/robots.txt'] = ROBOTS(''); b.reponses['https://h.test/a'] = PAGE('nouveau');
        const existant = path.join(b.sorties, 'existant.txt'); fs.mkdirSync(b.sorties, { recursive: true }); fs.writeFileSync(existant, 'précieux');
        const mauvaises = [existant, path.join(TMP_RACINE, 'hors', 'a.txt'), path.join(b.sorties, 'Logo FR', 'a.txt'), path.join(b.sorties, 'apport-manuel', 'a.txt'), path.join(b.sorties, '.claude', 'hooks', 'x.js'),
            path.join(b.sorties, 'worktrees', 'x'), path.join(b.sorties, 'pokemon-proxy-api-v2', 'x'), path.join(b.arrets, 'ARRET-HOTE-x.json'), path.join(b.porte, 'robots', 'h.test.json'), path.join(b.porte, 'journal.jsonl')];
        for (const s of mauvaises) {
            const e = await lever(() => P.lire('https://h.test/a', { ...b.o, sortie: s }));
            verifier(e && e.refus === true, `D5 : --sortie=${path.relative(TMP_RACINE, s)} doit être refusée`);
        }
        verifier(b.appels.length === 0 && fs.readFileSync(existant, 'utf8') === 'précieux', 'D5 : refus AVANT le réseau, fichier existant intact');
        const r = await P.lire('https://h.test/a', { ...b.o, sortie: path.join(b.sorties, 'neuf.txt') });
        verifier(r.ok === true && fs.readFileSync(path.join(b.sorties, 'neuf.txt'), 'utf8') === 'nouveau', 'D5 : sortie neuve sous sorties\\ permise');
        const racine = path.join(TMP_RACINE, 'catalogue-fictif');
        const c = { dossierArrets: path.join(racine, 'arrets-hotes'), dossierPorte: path.join(racine, 'porte-reseau') };
        verifier(P.sortiePermise(path.join(racine, 'notes', 'a.txt'), c, [racine]) === null, 'D5 : sous la racine déclarée : permis');
        verifier(P.sortiePermise(path.join(racine, 'arrets-hotes', 'x.txt'), c, [racine]) !== null, 'D5 : arrets-hotes exclu de la racine');
        verifier(P.sortiePermise(path.join(racine, 'porte-reseau', 'robots', 'x'), c, [racine]) !== null && P.sortiePermise(path.join(racine, 'porte-reseau', 'cadence', 'x'), c, [racine]) !== null, 'D5 : robots\\ et cadence\\ de la porte exclus');
        verifier(P.sortiePermise(path.join(racine, 'worktrees', 'c-x', 'a.js'), c, [racine]) !== null, 'D5 : worktrees exclu');
        verifier(P.sortiePermise(path.join(TMP_RACINE, 'ailleurs', 'a.txt'), c, [racine]) !== null, 'D5 : hors racines : refusé');
    }
    // ── le transport réel borné (serveur de BOUCLE LOCALE : aucun réseau) ───────────────────────────────────────────────────────────────
    {
        const http = require('http');
        const srv = http.createServer((req, res) => {
            if (req.url === '/gros') { res.writeHead(200, { 'content-type': 'text/plain' }); const bloc = Buffer.alloc(1024 * 1024, 97); let n = 0; const ecrire = () => { while (n < 14) { n++; if (!res.write(bloc)) { res.once('drain', ecrire); return; } } res.end(); }; ecrire(); }
            else if (req.url === '/lent') { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('debut'); }
            else if (req.url === '/redir') { res.writeHead(302, { location: 'https://ailleurs.test/' }); res.end(); }
            else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('petit'); }
        });
        await new Promise(r => srv.listen(0, '127.0.0.1', r));
        const base = `http://127.0.0.1:${srv.address().port}`;
        const tr = P.fabriquerTransportReel({ borne: 12 * 1024 * 1024, delaiMs: 400 });
        const petit = await tr.get(`${base}/petit`);
        verifier(petit.status === 200 && petit.texte === 'petit', 'transport réel : réponse normale');
        const eGros = await lever(() => P.fabriquerTransportReel({ borne: 12 * 1024 * 1024, delaiMs: 20000 }).get(`${base}/gros`));
        verifier(eGros && eGros.tropGrande === true, 'transport réel : 12 Mo dépassés -> coupé PENDANT la lecture');
        const t0 = Date.now(); const eLent = await lever(() => tr.get(`${base}/lent`));
        verifier(eLent && eLent.reseau === true && /ETIMEDOUT/.test(eLent.message) && Date.now() - t0 < 5000, 'transport réel : délai dépassé -> ETIMEDOUT');
        const redir = await tr.get(`${base}/redir`);
        verifier(redir.status === 302 && redir.location === 'https://ailleurs.test/', 'transport réel : redirection rendue sans être suivie');
        srv.closeAllConnections(); srv.close();
    }

    console.log(`\n${ok}/${ok + ko} assertions justes${ko ? ` — ${ko} en échec` : ''}`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.log(`🔴 le banc a planté : ${e.stack}`); process.exit(1); });
