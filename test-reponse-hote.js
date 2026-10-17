// node test-reponse-hote.js — la règle commune de réponse des hôtes d'images (collecte-cartes/reponse-hote.js), au niveau du MODULE.
// Fonctions pures : aucune requête, aucune base. Un test par cas de la décision du testeur du 2026-10-18 (fausse page introuvable, défi, plus de 20 d'affilée)
// et des rulings du coordinateur (liste fermée d'issues, « challenge » seul = ambigu, empreinte connue, inattendue, compteur par hôte).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const R = require('./collecte-cartes/reponse-hote');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]);
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]);
const html = t => Buffer.from(`<html><body>${t}</body></html>`);
const PAGE = html('Page introuvable');
const cl = (o) => R.classerReponseImage(o);
const issue = o => cl(o).issue;

// ── les trois issues qui laissent continuer ───────────────────────────────────────────────────────────────────────────────
verifier('200 image/png aux octets PNG → image', cl({ statut: 200, typeContenu: 'image/png', entetes: {}, debutCorps: PNG }).issue, 'image');
verifier('200 image/jpeg, image/webp, image/gif aux bons octets → image', [issue({ statut: 200, typeContenu: 'image/jpeg', debutCorps: JPEG }), issue({ statut: 200, typeContenu: 'image/webp', debutCorps: WEBP }), issue({ statut: 200, typeContenu: 'image/gif', debutCorps: GIF })], ['image', 'image', 'image']);
verifier('404 → absente', cl({ statut: 404, typeContenu: 'text/html', debutCorps: PAGE }).issue, 'absente');
verifier('404 sans corps ni type → absente', issue({ statut: 404 }), 'absente');
{
    const c = cl({ statut: 200, typeContenu: 'text/html; charset=utf-8', entetes: {}, debutCorps: PAGE });
    verifier('200 text/html sans marqueur → fausse-absente, avec l\'empreinte sha256 du corps lu', [c.issue, c.empreinte], ['fausse-absente', sha(PAGE)]);
    verifier('la même page deux fois → la même empreinte', cl({ statut: 200, typeContenu: 'text/html', debutCorps: Buffer.from(PAGE) }).empreinte, c.empreinte);
    verifier('une autre page → une autre empreinte', cl({ statut: 200, typeContenu: 'text/html', debutCorps: html('Une autre page') }).empreinte === c.empreinte, false);
}
// M3 (correction 1) : la recherche des marqueurs porte sur 512 Ko ; un corps COUPÉ à la borne, sans marqueur, ne prouve rien → inattendue (pause), jamais une absence
const GROS = Buffer.concat([PAGE, Buffer.alloc(R.BORNE_CORPS + 1000, 0x20)]);
verifier('M3 : la borne de lecture est 512 Ko', R.BORNE_CORPS, 512 * 1024);
verifier('M3 : un corps plus grand que la borne, sans marqueur dans les 512 premiers Ko → inattendue (pas fausse-absente)', cl({ statut: 200, typeContenu: 'text/html', debutCorps: GROS }).issue, 'inattendue');
verifier('M3 : un marqueur à 100 Ko (au-delà de 64 Ko) est vu → defi', issue({ statut: 200, typeContenu: 'text/html', debutCorps: Buffer.concat([Buffer.from('<html>'), Buffer.alloc(100000, 0x20), Buffer.from('<div class="g-recaptcha"></div></html>')]) }), 'defi');
verifier('M3 : un corps de la taille de la borne moins un octet (non coupé) reste une fausse-absente', issue({ statut: 200, typeContenu: 'text/html', debutCorps: Buffer.concat([PAGE, Buffer.alloc(R.BORNE_CORPS - PAGE.length - 1, 0x20)]) }), 'fausse-absente');
{
    const u16 = t => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]);
    const u16be = t => { const b = Buffer.from(t, 'utf16le'); for (let i = 0; i < b.length; i += 2) { const x = b[i]; b[i] = b[i + 1]; b[i + 1] = x; } return Buffer.concat([Buffer.from([0xfe, 0xff]), b]); };
    verifier('M3 : une page UTF-16 (BOM) sans marqueur est décodée → fausse-absente', issue({ statut: 200, typeContenu: 'text/html', debutCorps: u16('<html>Page introuvable</html>') }), 'fausse-absente');
    verifier('M3 : une page UTF-16 (BOM) portant un captcha → defi', issue({ statut: 200, typeContenu: 'text/html', debutCorps: u16('<html><div class="g-recaptcha"></div></html>') }), 'defi');
    verifier('M3 : une page UTF-16 BE (BOM) portant « Just a moment » → defi', issue({ statut: 200, typeContenu: 'text/html', debutCorps: u16be('<html>Just a moment...</html>') }), 'defi');
    verifier('M3 : une page UTF-16 (BOM) portant « Gym Challenge » → ambigue', issue({ statut: 200, typeContenu: 'text/html', debutCorps: u16('<html>Gym Challenge</html>') }), 'ambigue');
    verifier('M3 : un corps indécodable (octets de contrôle, ni BOM ni texte) sous text/html → inattendue', issue({ statut: 200, typeContenu: 'text/html', debutCorps: Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03, 0x00, 0xff, 0x00, 0x00, 0x04, 0x00, 0x00, 0x05]) }), 'inattendue');
    verifier('M3 : une page UTF-16 sans BOM (NUL entre les lettres) → inattendue (indécodable)', issue({ statut: 200, typeContenu: 'text/html', debutCorps: Buffer.from('<html>Page</html>', 'utf16le') }), 'inattendue');
}
verifier('le type est lu sans tenir compte de la casse ni du charset', issue({ statut: 200, typeContenu: 'TEXT/HTML; Charset=UTF-8', debutCorps: PAGE }), 'fausse-absente');

// ── le défi : les marqueurs TECHNIQUES, à tout statut ─────────────────────────────────────────────────────────────────────
const MARQUEURS = ['Just a moment...', 'cf-chl-bypass', '__cf_chl_tk=abc', 'cf_chl_opt = {}', '/cdn-cgi/challenge-platform/h/b/orchestrate', 'https://challenges.cloudflare.com/x/api.js',
    '<form action="/cdn-cgi/challenge">', '<div class="cf-challenge-running">', '<div class="g-recaptcha"></div>', '<div class="h-captcha"></div>', 'Please solve the CAPTCHA', 'cf-turnstile-response',
    '<script src="/_Incapsula_Resource?SWJIYLWA=1"></script>', 'Request unsuccessful. Incapsula incident ID: 1', 'Attention Required! | Cloudflare'];
for (const m of MARQUEURS) verifier(`marqueur « ${m.slice(0, 40)} » dans une page 200 → defi`, issue({ statut: 200, typeContenu: 'text/html', debutCorps: html(m) }), 'defi');
verifier('un marqueur technique derrière un 404 → defi (un défi caché derrière un 404 se voit)', issue({ statut: 404, typeContenu: 'text/html', debutCorps: html('Just a moment...') }), 'defi');
verifier('un marqueur technique derrière un 503 → defi', issue({ statut: 503, typeContenu: 'text/html', debutCorps: html('challenge-platform') }), 'defi');
verifier('en-tête cf-mitigated: challenge → defi, même sur un 200 image', issue({ statut: 200, typeContenu: 'image/png', entetes: { 'cf-mitigated': 'challenge' }, debutCorps: PNG }), 'defi');
verifier('les en-têtes sont lus sans tenir compte de la casse (CF-Mitigated)', issue({ statut: 200, typeContenu: 'text/html', entetes: { 'CF-Mitigated': 'challenge' }, debutCorps: PAGE }), 'defi');
verifier('x-cdn: Imperva avec un corps qui n\'est pas une image → defi', issue({ statut: 200, typeContenu: 'text/html', entetes: { 'x-cdn': 'Imperva' }, debutCorps: PAGE }), 'defi');
verifier('x-cdn: Imperva avec une VRAIE image → image (le corps n\'est pas un défi)', issue({ statut: 200, typeContenu: 'image/png', entetes: { 'x-cdn': 'Imperva' }, debutCorps: PNG }), 'image');
verifier('un marqueur technique dans des octets d\'image faux → defi', issue({ statut: 200, typeContenu: 'image/png', debutCorps: Buffer.from('<html>Just a moment</html>') }), 'defi');
for (const s of [401, 403, 410, 429]) verifier(`statut ${s} → defi, quel que soit le corps (ici une vraie image)`, [issue({ statut: s, typeContenu: 'image/png', debutCorps: PNG }), issue({ statut: s })], ['defi', 'defi']);
verifier('503 avec un marqueur → defi', issue({ statut: 503, typeContenu: 'text/html', debutCorps: html('Just a moment...') }), 'defi');
verifier('503 sans marqueur → transitoire', issue({ statut: 503, typeContenu: 'text/html', debutCorps: html('Service indisponible') }), 'transitoire');
verifier('500, 502, 504 sans marqueur → transitoire', [500, 502, 504].map(s => issue({ statut: s, debutCorps: PAGE })), ['transitoire', 'transitoire', 'transitoire']);

// ── « challenge » seul : ambigu ───────────────────────────────────────────────────────────────────────────────────────────
{
    const menu = html('<nav>Gym Heroes · Gym Challenge · Challenge from the Darkness</nav><p>Page introuvable</p>');
    const c = cl({ statut: 200, typeContenu: 'text/html', debutCorps: menu });
    verifier('« Gym Challenge » dans le menu d\'une page introuvable → ambigue (jamais defi), avec l\'empreinte', [c.issue, c.empreinte], ['ambigue', sha(menu)]);
    verifier('« challenge » seul, sans aucun marqueur technique → ambigue', issue({ statut: 200, typeContenu: 'text/html', debutCorps: html('A challenge for you') }), 'ambigue');
    verifier('« Challenge » en majuscules → ambigue', issue({ statut: 200, typeContenu: 'text/html', debutCorps: html('CHALLENGE') }), 'ambigue');
    verifier('« challenge » ET un marqueur technique → defi (le marqueur prouve)', issue({ statut: 200, typeContenu: 'text/html', debutCorps: html('Gym Challenge captcha') }), 'defi');
    verifier('un vrai 404 dont la page cite « Gym Challenge » reste absente (le statut dit l\'absence)', issue({ statut: 404, typeContenu: 'text/html', debutCorps: menu }), 'absente');
    // empreinte connue
    verifier('une empreinte CONNUE → fausse-absente, même si la page cite « challenge »', cl({ statut: 200, typeContenu: 'text/html', debutCorps: menu, empreintesConnues: [sha(menu)] }), { issue: 'fausse-absente', motif: 'page introuvable connue (empreinte déclarée par le coordinateur)', empreinte: sha(menu) });
    verifier('une empreinte connue ne couvre pas une autre page', issue({ statut: 200, typeContenu: 'text/html', debutCorps: html('challenge ailleurs'), empreintesConnues: [sha(menu)] }), 'ambigue');
    verifier('une empreinte connue ne rend pas un défi à marqueur technique inoffensif', issue({ statut: 200, typeContenu: 'text/html', debutCorps: html('Just a moment...'), empreintesConnues: [sha(html('Just a moment...'))] }), 'defi');
}

// ── inattendue : tout le reste ────────────────────────────────────────────────────────────────────────────────────────────
verifier('3xx non suivi → inattendue', [301, 302, 307].map(s => issue({ statut: s, entetes: { location: 'https://autre.example/x' } })), ['inattendue', 'inattendue', 'inattendue']);
verifier('200 application/json → inattendue', issue({ statut: 200, typeContenu: 'application/json', debutCorps: Buffer.from('{"a":1}') }), 'inattendue');
verifier('200 sans Content-Type → inattendue', issue({ statut: 200, debutCorps: PNG }), 'inattendue');
verifier('200 image/png aux octets qui ne sont pas une image → inattendue', issue({ statut: 200, typeContenu: 'image/png', debutCorps: Buffer.from('ceci n\'est pas une image') }), 'inattendue');
verifier('200 image/png sans aucun corps lu → inattendue (rien ne prouve l\'image)', issue({ statut: 200, typeContenu: 'image/png' }), 'inattendue');
verifier('400, 402, 451 → inattendue', [400, 402, 451].map(s => issue({ statut: s, typeContenu: 'text/html', debutCorps: PAGE })), ['inattendue', 'inattendue', 'inattendue']);
verifier('200 text/plain → inattendue', issue({ statut: 200, typeContenu: 'text/plain', debutCorps: Buffer.from('bonjour') }), 'inattendue');
verifier('la liste des issues est FERMÉE : toute réponse en rend une', R.ISSUES, ['image', 'absente', 'fausse-absente', 'defi', 'ambigue', 'transitoire', 'inattendue']);
{
    const toutes = [];
    for (const statut of [0, 100, 200, 204, 206, 301, 400, 404, 418, 500, 503, 999]) for (const typeContenu of [undefined, '', 'image/png', 'text/html', 'application/json', 'x/y']) for (const debutCorps of [undefined, PNG, PAGE, Buffer.alloc(0)]) toutes.push(issue({ statut, typeContenu, debutCorps }));
    verifier('sur 288 réponses fabriquées, l\'issue est TOUJOURS dans la liste fermée', toutes.every(i => R.ISSUES.includes(i)), true);
    verifier('une entrée absurde (rien, null) ne lève pas : inattendue', [issue({}), issue({ statut: null }), issue({ statut: 'abc' })], ['inattendue', 'inattendue', 'inattendue']);
}
verifier('seules image, absente et fausse-absente laissent continuer', R.LAISSENT_CONTINUER, ['image', 'absente', 'fausse-absente']);

// ── le compteur par hôte ──────────────────────────────────────────────────────────────────────────────────────────────────
const FAUSSE = cl({ statut: 200, typeContenu: 'text/html', debutCorps: PAGE });
const IMAGE = cl({ statut: 200, typeContenu: 'image/png', debutCorps: PNG });
const ABSENTE = cl({ statut: 404 });
{
    const s = R.suiviHote();
    const r = [];
    for (let i = 0; i < 20; i++) r.push(s.noter('h.example', FAUSSE).pause);
    verifier('compteur : 20 fausses absences d\'affilée → on continue', r.some(Boolean), false);
    verifier('compteur : la 21e → pause', s.noter('h.example', FAUSSE).pause, true);
    verifier('compteur : la pause est collante dans la passe', s.noter('h.example', IMAGE).pause, true);
}
{
    const s = R.suiviHote();
    for (let i = 0; i < 20; i++) s.noter('h.example', FAUSSE);
    s.noter('h.example', IMAGE);
    const r = [];
    for (let i = 0; i < 20; i++) r.push(s.noter('h.example', FAUSSE).pause);
    verifier('compteur : une image remet à zéro (20 + image + 20 → pas de pause)', r.some(Boolean), false);
    verifier('compteur : …et la 21e après l\'image → pause', s.noter('h.example', FAUSSE).pause, true);
}
{
    const s = R.suiviHote();
    for (let i = 0; i < 20; i++) s.noter('h.example', FAUSSE);
    for (let i = 0; i < 5; i++) s.noter('h.example', ABSENTE);
    verifier('compteur : un vrai 404 ne remet pas à zéro (20 fausses + 5 × 404 + 1 fausse → pause)', s.noter('h.example', FAUSSE).pause, true);
    const t = R.suiviHote();
    for (let i = 0; i < 19; i++) t.noter('h.example', FAUSSE);
    for (let i = 0; i < 30; i++) t.noter('h.example', ABSENTE);
    verifier('compteur : un vrai 404 ne compte pas (19 fausses + 30 × 404 + 1 fausse → pas de pause)', t.noter('h.example', FAUSSE).pause, false);
}
{
    const s = R.suiviHote();
    for (let i = 0; i < 25; i++) s.noter('a.example', FAUSSE);
    verifier('compteur : un hôte en pause n\'arrête pas un autre hôte', s.noter('b.example', FAUSSE).pause, false);
    const autre = cl({ statut: 200, typeContenu: 'text/html', debutCorps: html('une autre page introuvable') });
    const t = R.suiviHote();
    for (let i = 0; i < 3; i++) t.noter('h.example', FAUSSE);
    for (let i = 0; i < 2; i++) t.noter('h.example', autre);
    const rap = t.rapport('h.example');
    verifier('rapport : le nombre de fausses absences, les empreintes distinctes avec leur nombre, l\'hôte non pausé', [rap.fausses, rap.empreintes, rap.pause, rap.hote],
        [5, [{ empreinte: FAUSSE.empreinte, n: 3 }, { empreinte: autre.empreinte, n: 2 }], false, 'h.example']);
    verifier('rapport : un hôte jamais vu est vide, pas absent', R.suiviHote().rapport('x.example'), { hote: 'x.example', fausses: 0, consecutives: 0, empreintes: [], pause: false });
    verifier('compteur : un nouveau suivi (une nouvelle passe) repart de zéro', R.suiviHote().rapport('a.example').consecutives, 0);
    const u = R.suiviHote();
    for (let i = 0; i < 21; i++) u.noter('h.example', FAUSSE);
    verifier('rapport : l\'hôte en pause est nommé', [u.rapport('h.example').pause, u.hotesEnPause()], [true, ['h.example']]);
    verifier('compteur : un autre seuil se règle (seuil 2 → la 3e fausse pause)', (() => { const v = R.suiviHote({ seuil: 2 }); v.noter('h', FAUSSE); v.noter('h', FAUSSE); return v.noter('h', FAUSSE).pause; })(), true);
    verifier('compteur : seuil invalide refusé (jamais un seuil qui ne mord sur rien)', (() => { try { R.suiviHote({ seuil: 0 }); return 'accepté'; } catch { return 'refusé'; } })(), 'refusé');
}

// ── la réaction : une seule table de décision ─────────────────────────────────────────────────────────────────────────────
{
    const s = R.suiviHote();
    const a = (c, hote = 'h.example') => R.reagir(s, hote, c).action;
    verifier('réaction : image → continuer', a(IMAGE), 'continuer');
    verifier('réaction : absente → absente', a(ABSENTE), 'absente');
    verifier('réaction : fausse-absente → absente (on passe à la suivante)', a(FAUSSE), 'absente');
    verifier('réaction : defi → arret-definitif', a(cl({ statut: 403 })), 'arret-definitif');
    verifier('réaction : ambigue → pause-persistante', a(cl({ statut: 200, typeContenu: 'text/html', debutCorps: html('challenge') })), 'pause-persistante');
    verifier('réaction : transitoire → transitoire', a(cl({ statut: 502 })), 'transitoire');
    verifier('réaction : inattendue → pause', a(cl({ statut: 302 })), 'pause');
    const t = R.suiviHote();
    for (let i = 0; i < 20; i++) R.reagir(t, 'h.example', FAUSSE);
    const dernier = R.reagir(t, 'h.example', FAUSSE);
    verifier('réaction : la 21e fausse absence → pause, motif qui nomme le compte et l\'hôte', [dernier.action, /21/.test(dernier.motif), /h\.example/.test(dernier.motif)], ['pause', true, true]);
    verifier('M2 : sans suivi, RIEN ne passe (fermé par défaut) : fausse-absente, image et absente → pause', ['fausse', 'image', 'absente'].map(k => R.reagir(null, 'h.example', { fausse: FAUSSE, image: IMAGE, absente: ABSENTE }[k]).action), ['pause', 'pause', 'pause']);
    verifier('M2 : sans suivi, un défi reste un arrêt définitif (jamais plus ouvert)', R.reagir(null, 'h.example', cl({ statut: 403 })).action, 'arret-definitif');
    verifier('M2 : une issue INCONNUE bloque (pause), elle ne passe pas', [R.reagir(R.suiviHote(), 'h.example', { issue: 'zzz', motif: 'x' }).action, R.reagir(R.suiviHote(), 'h.example', null).action, R.reagir(R.suiviHote(), 'h.example', {}).action], ['pause', 'pause', 'pause']);
    verifier('M2 : les seules actions qui laissent continuer sont continuer et absente', (() => { const out = new Set(); for (const i of [...R.ISSUES, 'zzz', undefined]) out.add(R.reagir(R.suiviHote(), 'h', { issue: i, motif: 'm' }).action); return [...out].sort(); })(), ['absente', 'arret-definitif', 'continuer', 'pause', 'pause-persistante', 'transitoire']);
}

// ── l'adaptateur des clients (transports { status, type, texte | octets, cfMitigated, imperva }) ────────────────────────────
{
    const e = R.entreeDepuisClient({ status: 200, type: 'image/png', octets: PNG, cfMitigated: null });
    verifier('adaptateur : une image', [e.statut, e.typeContenu, Buffer.isBuffer(e.debutCorps), issue(e)], [200, 'image/png', true, 'image']);
    verifier('adaptateur : un texte devient un corps borné', issue(R.entreeDepuisClient({ status: 200, type: 'text/html', texte: '<html>page</html>' })), 'fausse-absente');
    verifier('adaptateur : cfMitigated devient l\'en-tête cf-mitigated', issue(R.entreeDepuisClient({ status: 200, type: 'image/png', octets: PNG, cfMitigated: 'challenge' })), 'defi');
    verifier('adaptateur : imperva devient x-cdn: Imperva (corps non image → defi, vraie image → image)', [issue(R.entreeDepuisClient({ status: 200, type: 'text/html', texte: 'page', imperva: true })), issue(R.entreeDepuisClient({ status: 200, type: 'image/png', octets: PNG, imperva: true }))], ['defi', 'image']);
    verifier('adaptateur : un 404 sans corps lu', issue(R.entreeDepuisClient({ status: 404, type: 'text/html' })), 'absente');
    verifier('adaptateur : borne optionnelle (5000 caractères pour une page, comme avant)', R.entreeDepuisClient({ status: 200, type: 'text/html', texte: 'x'.repeat(9000) }, { borne: 5000 }).debutCorps.length, 5000);
    verifier('adaptateur : le corps ne dépasse jamais la borne (512 Ko)', R.entreeDepuisClient({ status: 200, type: 'application/octet-stream', octets: Buffer.alloc(700000) }).debutCorps.length, 512 * 1024);
}

// ── I2 : l'ARRÊT DURABLE d'un hôte (le même fichier persistant que la pause ambiguë, nature distincte) ─────────────────────
{
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-arret-'));
    verifier('I2 : aucun arrêt tant que rien n\'est écrit', [R.hoteArrete('h.example', d), R.hoteArrete('autre.example', d)], [null, null]);
    const f = R.arretHote('h.example', 'HTTP 403 sur https://h.example/x.png', { dossier: d, url: 'https://h.example/x.png?jeton=secret' });
    const a = R.hoteArrete('h.example', d);
    verifier('I2 : l\'arrêt est écrit (nature « arret-definitif », motif, adresse sans paramètres, date)', [fs.existsSync(f), a.nature, a.motif, a.url, typeof a.le], [true, 'arret-definitif', 'HTTP 403 sur https://h.example/x.png', 'https://h.example/x.png', 'string']);
    verifier('I2 : le fichier d\'arrêt n\'est pas celui de la pause (nature distincte)', [R.fichierArret(d, 'h.example') !== R.fichierPause(d, 'h.example'), R.lirePausePersistante(d, 'h.example')], [true, null]);
    verifier('I2 : l\'arrêt d\'un hôte ne vaut pas pour un autre', R.hoteArrete('autre.example', d), null);
    verifier('I2 : un fichier d\'arrêt illisible vaut ARRÊT (je ne sais pas = arrêt)', (() => { fs.writeFileSync(R.fichierArret(d, 'casse.example'), '{pas du json'); return R.hoteArrete('casse.example', d)?.illisible === true; })(), true);
    verifier('I2 : garderHote lève un arrêt DÉFINITIF (bloque) avant toute requête', (() => { try { R.garderHote('h.example', d); return null; } catch (e) { return [e.bloque, e.arretDefinitif, !!e.pauseHote, e.fichier === R.fichierArret(d, 'h.example')]; } })(), [true, true, false, true]);
    verifier('I2 : l\'écriture d\'un arrêt qui échoue LÈVE (jamais un silence)', (() => { try { R.arretHote('h.example', 'm', { dossier: path.join(f, 'impossible') }); return 'rendu'; } catch { return 'levé'; } })(), 'levé');
    verifier('I2 : la racine d\'un hôte (artofpkm.com pour cdn.artofpkm.com)', [R.hoteRacine('cdn.artofpkm.com'), R.hoteRacine('www.artofpkm.com'), R.hoteRacine('archives.bulbagarden.net'), R.hoteRacine('localhost'), R.hoteRacine('h.example')], ['artofpkm.com', 'artofpkm.com', 'bulbagarden.net', 'localhost', 'h.example']);
    fs.rmSync(d, { recursive: true, force: true });
}

// ── I3 : le suivi vit par HÔTE pour toute la durée du PROCESSUS ──────────────────────────────────────────────────────────────
{
    R.reinitialiserSuiviProcessus();
    const S = R.suiviDuProcessus();
    verifier('I3 : le registre du processus est UN objet, le même à chaque appel', R.suiviDuProcessus() === S, true);
    for (let i = 0; i < 21; i++) S.noter('h.example', FAUSSE);
    verifier('I3 : une pause « plus de 20 » du registre tient pour tout le processus', [R.suiviDuProcessus().rapport('h.example').pause, (() => { try { R.garderHote('h.example', os.tmpdir(), R.suiviDuProcessus()); return null; } catch (e) { return [!!e.pauseHote, !!e.pausePersistante, !!e.bloque]; } })()], [true, [true, false, false]]);
    verifier('I3 : …et ne touche pas un autre hôte', (() => { try { R.garderHote('b.example', os.tmpdir(), R.suiviDuProcessus()); return 'passe'; } catch { return 'bloque'; } })(), 'passe');
    verifier('I3 : un nouveau suiviHote() (un banc, un nouveau processus) repart de zéro', R.suiviHote().rapport('h.example').pause, false);
    R.reinitialiserSuiviProcessus();
    verifier('I3 : le registre se réinitialise (nouveau processus simulé)', R.suiviDuProcessus().rapport('h.example').pause, false);
    const S2 = R.suiviDuProcessus();
    R.reagir(S2, 'i.example', cl({ statut: 302 }));
    verifier('I3 : une issue « inattendue » met AUSSI l\'hôte en pause pour le processus', [S2.rapport('i.example').pause, (() => { try { R.garderHote('i.example', os.tmpdir(), S2); return null; } catch (e) { return !!e.pauseHote; } })()], [true, true]);
    R.reinitialiserSuiviProcessus();
}

// ── M2 : l'écriture d'une pause qui échoue LÈVE une pauseHote ─────────────────────────────────────────────────────────────────
{
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-ecr-'));
    const fichierObstacle = path.join(d, 'obstacle'); fs.writeFileSync(fichierObstacle, 'x');
    const menu = html('<nav>Gym Challenge</nav>');
    let e = null; try { R.traiterImage({ status: 200, type: 'text/html', texte: '<nav>Gym Challenge</nav>' }, { suivi: R.suiviHote(), hote: 'h.example', url: 'https://h.example/a.png', dossierPauses: path.join(fichierObstacle, 'sous') }); } catch (x) { e = x; }
    verifier('M2 : l\'écriture de la pause persistante impossible → LÈVE une pauseHote (le client s\'arrête), pas une exception ordinaire', [!!e?.pauseHote, !!e?.ecritureEchouee], [true, true]);
    void menu; fs.rmSync(d, { recursive: true, force: true });
}

// ── la détection de défi pour les requêtes qui ne sont PAS des images (robots.txt, listes, pages) ─────────────────────────
verifier('détection : robots.txt 403 → défi', R.detecterDefi({ statut: 403, typeContenu: 'text/html', debutCorps: PAGE }) !== null, true);
verifier('détection : une liste JSON qui cite « Gym Challenge » n\'est ni défi ni ambiguë', R.detecterDefi({ statut: 200, typeContenu: 'application/json', debutCorps: Buffer.from('{"titre":"Gym Challenge"}') }), null);
verifier('détection : une page HTML qui cite « challenge » n\'est pas un défi (seul le marqueur technique prouve)', R.detecterDefi({ statut: 200, typeContenu: 'text/html', debutCorps: html('Gym Challenge') }), null);
verifier('détection : un marqueur technique dans une page → défi', R.detecterDefi({ statut: 200, typeContenu: 'text/html', debutCorps: html('captcha') }) !== null, true);
verifier('détection : 429 → défi', R.detecterDefi({ statut: 429 }) !== null, true);

// ── la pause persistante et l'extrait borné ───────────────────────────────────────────────────────────────────────────────
{
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-banc-'));
    const menu = html('<nav>Gym Challenge</nav>' + 'x'.repeat(5000));
    const c = cl({ statut: 200, typeContenu: 'text/html', entetes: { 'set-cookie': 'secret=1', authorization: 'Bearer zzz' }, debutCorps: menu });
    verifier('pause persistante : aucune pause tant que rien n\'est écrit', R.lirePausePersistante(d, 'h.example'), null);
    const f = R.ecrirePausePersistante(d, 'h.example', { classement: c, debutCorps: menu, url: 'https://h.example/img/1.png' });
    const lu = R.lirePausePersistante(d, 'h.example');
    verifier('pause persistante : le fichier nomme l\'hôte, l\'empreinte, l\'adresse', [lu.hote, lu.empreinte, lu.url, fs.existsSync(f)], ['h.example', c.empreinte, 'https://h.example/img/1.png', true]);
    verifier('pause persistante : l\'extrait est borné à 500 caractères', lu.extrait.length <= 500 && lu.extrait.length > 0, true);
    verifier('pause persistante : ni en-tête ni secret dans le fichier', /secret|Bearer|set-cookie|authorization/i.test(fs.readFileSync(f, 'utf8')), false);
    verifier('pause persistante : la pause d\'un hôte ne vaut pas pour un autre', R.lirePausePersistante(d, 'autre.example'), null);
    verifier('pause persistante : le nom de fichier ne sort pas du dossier (hôte hostile)', path.dirname(R.fichierPause(d, '../../x')) === path.resolve(d), true);
    verifier('pause persistante : un fichier illisible BLOQUE (je ne sais pas = pause)', (() => { fs.writeFileSync(R.fichierPause(d, 'casse.example'), '{pas du json'); const p = R.lirePausePersistante(d, 'casse.example'); return p && p.illisible === true; })(), true);
    fs.rmSync(d, { recursive: true, force: true });
}

// ── les empreintes connues (fichier de données, une liste par hôte) ───────────────────────────────────────────────────────
{
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-connues-'));
    const f = path.join(d, 'connues.json');
    fs.writeFileSync(f, JSON.stringify({ 'h.example': [sha(PAGE)], 'vide.example': [] }));
    verifier('empreintes connues : la liste de l\'hôte', R.empreintesConnues('h.example', f), [sha(PAGE)]);
    verifier('empreintes connues : un hôte sans liste → liste vide', R.empreintesConnues('inconnu.example', f), []);
    verifier('empreintes connues : un fichier illisible LÈVE (jamais un repli sur le vide)', (() => { try { R.empreintesConnues('h.example', path.join(d, 'absent.json')); return 'rendu'; } catch { return 'levé'; } })(), 'levé');
    fs.writeFileSync(f, JSON.stringify({ 'h.example': ['pas-un-sha'] }));
    verifier('empreintes connues : une valeur qui n\'est pas un sha256 LÈVE', (() => { try { R.empreintesConnues('h.example', f); return 'rendu'; } catch { return 'levé'; } })(), 'levé');
    verifier('empreintes connues : le fichier du dépôt existe et se lit', Array.isArray(R.empreintesConnues('h.example')), true);
    fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
