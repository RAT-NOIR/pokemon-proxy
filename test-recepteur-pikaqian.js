// node test-recepteur-pikaqian.js — le RÉCEPTEUR passif de PikaQian (recepteur-pikaqian.js). Aucun réseau extérieur : un serveur sur un port ÉPHÉMÈRE de 127.0.0.1,
// des pages fabriquées au format mesuré le 2026-10-10 (collecte-cartes/pikaqian.js l. 39), un dossier temporaire HORS du dépôt.
// PK_RECEPTEUR (rouge-recepteur-pikaqian.js) : un récepteur MUTANT à tester à la place du vrai — chaque garde retirée, seule, doit faire échouer ce banc.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const P = require('./collecte-cartes/pikaqian');
const R = require(process.env.PK_RECEPTEUR ? path.resolve(process.env.PK_RECEPTEUR) : './recepteur-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tuile = (n, code, num, nom) => `<a class="w-full group" data-discover="true" href="/cards/${UUID(n)}"><div class="x"><img alt="${nom}" src="https://images.pikaqian.com/${code}/${UUID(n)}.webp" loading="lazy"/></div><h2 class="t">${nom}</h2><p class="font-mono text-xs">${code}<!-- --> · ${num}</p></a>`;
const page = (...t) => `<!DOCTYPE html><html><head><title>Set</title></head><body>${t.join('')}</body></html>`;
// le flux Remix échappé qui déclare l'adresse officielle d'UNE carte (forme de lireOrigines)
const flux = (n, officielle) => `<script>window.__r.push("{\\"id\\",\\"${UUID(n)}\\",\\"native_image_url\\",\\"https://pokipair.example/x.png\\",\\"we_chat_image_url\\",\\"${officielle}\\"}")</script>`;
const OFFICIELLE = 'https://cdn.pokemon-tcg.cn/cards/0123456789abcdef0123456789abcdef.png';
const TROIS = [tuile(1, 'cs1bc', '001', 'Pikachu'), tuile(2, 'cs1bc', '002', 'Raichu'), tuile(3, 'cs1bc', '003', 'Pichu')];
const BONNE = page(...TROIS) + flux(2, OFFICIELLE);
const URL_BONNE = 'https://pikaqian.com/sets/cs1bc';
const corpsBon = { url: URL_BONNE, html: BONNE };

const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-pk-'));

function envoyer(port, { methode = 'POST', chemin = '/apprendre', entetes = {}, corps = null, brut = null } = {}) {
    return new Promise(resolve => {
        const donnees = brut ?? (corps == null ? null : JSON.stringify(corps));
        const h = { ...entetes };
        if (donnees != null) h['Content-Length'] = Buffer.byteLength(donnees);
        const req = http.request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: h }, res => {
            const morceaux = [];
            res.on('data', c => morceaux.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j, entetes: res.headers }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        if (donnees != null) req.write(donnees);
        req.end();
    });
}
// la requête CONFORME : tout ce que la garde autorise, SANS Origin (le userscript n'en dépend pas)
const BON = { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE };
const sans = (h, cle) => { const c = { ...h }; delete c[cle]; return c; };
const fichiers = () => fs.readdirSync(dossierTmp).sort();

(async () => {
    const journal = [];
    const srv = await R.demarrer({ port: 0, dossier: dossierTmp, attendu: () => null, journal: m => journal.push(m) });
    const port = srv.port;
    try {
        verifier('le serveur écoute 127.0.0.1 et nulle autre adresse', srv.adresse, '127.0.0.1');

        // ── ce que la garde AUTORISE : une page bien formée, avec ou sans Origin, d'une extension, ou de pikaqian.com
        let r = await envoyer(port, { entetes: BON, corps: corpsBon });
        verifier('page conforme, SANS Origin : 200, ok, ancres 3, tuiles lues 3, au code 3, flux présent, adresses officielles 1', [r.status, r.json?.ok, r.json?.ancres, r.json?.tuilesLues, r.json?.tuilesAuCode, r.json?.flux, r.json?.officielles], [200, true, 3, 3, 3, 'present', 1]);
        verifier('… pas d\'anomalie de flux', r.json?.anomalie, undefined);
        verifier('un fichier écrit, nommé par le code du set', [fichiers().length, /^cs1bc--\d{8}T\d{6}Z\.json$/.test(fichiers()[0] || '')], [1, true]);
        const f = JSON.parse(fs.readFileSync(path.join(dossierTmp, fichiers()[0]), 'utf8'));
        verifier('le fichier : code, adresse, date, sha256 du HTML, verdict, ancres, flux', [f.code, f.url, typeof f.le, f.sha256, f.verdict.ok, f.ancres, f.flux], ['cs1bc', URL_BONNE, 'string', require('crypto').createHash('sha256').update(BONNE).digest('hex'), true, 3, 'present']);
        verifier('le fichier porte les tuiles lues (lireTuiles de production) et les origines déclarées (lireOrigines)', [f.tuiles, f.origines], [P.lireTuiles(BONNE), [[UUID(2), { native: 'https://pokipair.example/x.png', officielle: OFFICIELLE }]]]);
        verifier('le HTML lui-même n\'est PAS gardé', JSON.stringify(f).includes('<html'), false);
        verifier('aucun en-tête d\'accès croisé dans la réponse', r.entetes['access-control-allow-origin'], undefined);
        verifier('chaque page reçue est imprimée (ancres et tuiles)', journal.length >= 1 && /cs1bc/.test(journal[0]) && /3 ancres, 3 tuiles/.test(journal[0]), true);
        for (const [nom, origine] of [['Origin https://pikaqian.com', 'https://pikaqian.com'], ['Origin d\'extension Chrome', 'chrome-extension://abcdefghijklmnop'], ['Origin d\'extension Firefox', 'moz-extension://1234-abcd']]) {
            const x = await envoyer(port, { entetes: { ...BON, Origin: origine }, corps: corpsBon });
            verifier(`${nom} : acceptée (200)`, x.status, 200);
        }

        // ── ce qu'elle REFUSE, chaque refus pris SEUL (tout le reste est conforme) : rien d'écrit
        const avant = fichiers().length;
        const refus = async (nom, o, statut, motif = null) => {
            const x = await envoyer(port, o);
            verifier(`${nom} : refusé (${statut}${motif ? `, motif ${motif}` : ''}), rien d'écrit`, [x.status, motif ? motif.test(x.json?.motif || '') : true, fichiers().length === avant], [statut, true, true]);
            return x;
        };
        await refus('une autre Origin web', { entetes: { ...BON, Origin: 'https://exemple.test' }, corps: corpsBon }, 403, /Origin/);
        await refus('Origin « null » (iframe, fichier local)', { entetes: { ...BON, Origin: 'null' }, corps: corpsBon }, 403, /Origin/);
        await refus('Origin avec un suffixe (pikaqian.com.evil.test)', { entetes: { ...BON, Origin: 'https://pikaqian.com.evil.test' }, corps: corpsBon }, 403, /Origin/);
        await refus('Origin en http', { entetes: { ...BON, Origin: 'http://pikaqian.com' }, corps: corpsBon }, 403, /Origin/);
        await refus('Origin d\'extension avec un chemin', { entetes: { ...BON, Origin: 'chrome-extension://abc/x' }, corps: corpsBon }, 403, /Origin/);
        await refus('en-tête X-Rat-Market absent', { entetes: sans(BON, 'X-Rat-Market'), corps: corpsBon }, 403, /x-rat-market/);
        await refus('en-tête X-Rat-Market d\'une autre valeur', { entetes: { ...BON, 'X-Rat-Market': 'autre' }, corps: corpsBon }, 403, /x-rat-market/);
        await refus('Host qui n\'est pas 127.0.0.1 / localhost (DNS rebinding)', { entetes: { ...BON, Host: 'evil.test' }, corps: corpsBon }, 403, /Host/);
        await refus('Content-Type absent', { entetes: sans(BON, 'Content-Type'), corps: corpsBon }, 415);
        await refus('Content-Type text/plain (le « requête simple » d\'une page)', { entetes: { ...BON, 'Content-Type': 'text/plain' }, corps: corpsBon }, 415);
        await refus('méthode GET', { methode: 'GET', entetes: BON }, 405);
        await refus('méthode PUT', { methode: 'PUT', entetes: BON, corps: corpsBon }, 405);
        const opt = await refus('méthode OPTIONS (le prévol d\'une page)', { methode: 'OPTIONS', entetes: { Origin: 'https://exemple.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-rat-market', 'Access-Control-Request-Private-Network': 'true' } }, 405);
        verifier('… sans aucun en-tête CORS ni accès au réseau privé dans la réponse', [opt.entetes['access-control-allow-origin'], opt.entetes['access-control-allow-private-network'], opt.entetes['access-control-allow-headers']], [undefined, undefined, undefined]);
        await refus('chemin /autre', { chemin: '/autre', entetes: BON, corps: corpsBon }, 404);
        await refus('chemin /apprendre?x=1', { chemin: '/apprendre?x=1', entetes: BON, corps: corpsBon }, 404);
        await refus('chemin /apprendre/', { chemin: '/apprendre/', entetes: BON, corps: corpsBon }, 404);
        const motifAdresse = /n'est pas la page d'un set/;
        await refus('adresse d\'un autre site', { entetes: BON, corps: { url: 'https://exemple.test/sets/cs1bc', html: BONNE } }, 422, motifAdresse);
        await refus('adresse http', { entetes: BON, corps: { url: 'http://pikaqian.com/sets/cs1bc', html: BONNE } }, 422, motifAdresse);
        await refus('adresse avec requête', { entetes: BON, corps: { url: `${URL_BONNE}?a=1`, html: BONNE } }, 422, motifAdresse);
        await refus('adresse hors motif de code (majuscules)', { entetes: BON, corps: { url: 'https://pikaqian.com/sets/CS1BC', html: BONNE } }, 422, motifAdresse);
        await refus('adresse hors motif (/cards/<uuid>)', { entetes: BON, corps: { url: `https://pikaqian.com/cards/${UUID(1)}`, html: BONNE } }, 422, motifAdresse);
        await refus('adresse hors motif (traversée)', { entetes: BON, corps: { url: 'https://pikaqian.com/sets/../api/x', html: BONNE } }, 422, motifAdresse);
        await refus('JSON illisible', { entetes: BON, brut: '{pas du json' }, 400);
        await refus('corps qui n\'est pas un objet (tableau)', { entetes: BON, brut: '[1,2]' }, 400, /objet/);
        await refus('corps qui n\'est pas un objet (null)', { entetes: BON, brut: 'null' }, 400, /objet/);
        await refus('clé inconnue dans le corps (cookie)', { entetes: BON, corps: { ...corpsBon, cookie: 'a=b' } }, 400, /seules url et html/);
        await refus('html pas une chaîne', { entetes: BON, corps: { url: URL_BONNE, html: 42 } }, 400, /chaînes/);
        // la page que verdictDePage refuse : la majorité des tuiles n'est pas au code du set
        const autre = page(tuile(1, 'csv10c', '001', 'A'), tuile(2, 'csv10c', '002', 'B'), tuile(3, 'cs1bc', '003', 'C'));
        await refus('page dont la majorité des tuiles n\'est pas au code du set', { entetes: BON, corps: { url: URL_BONNE, html: autre } }, 422, /ne désigne pas ce set/);
        await refus('page sans aucune tuile lisible', { entetes: BON, corps: { url: URL_BONNE, html: '<html><body>Just a moment</body></html>' } }, 422, /plus la forme mesurée/);
        // PAGE PARTIELLE : une ancre de carte que lireTuiles ne sait pas lire (ni image ni titre) — 4 ancres, 3 tuiles
        const partielle = page(...TROIS, `<a href="/cards/${UUID(9)}">carte en cours de chargement</a>`);
        const part = await refus('page partielle (ancres non lues)', { entetes: BON, corps: { url: URL_BONNE, html: partielle } }, 422, /page partielle ou forme changée : 4 ancres, 3 tuiles/);
        verifier('… la réponse renvoie les deux comptes', [part.json?.ancres, part.json?.tuilesLues], [4, 3]);
        // PAGE INCOMPLÈTE : la mesure du set (pikaqian-sets.json) connaît le nombre de tuiles, la table de production par défaut le dit pour cs1bc (315)
        const srvTable = await R.demarrer({ port: 0, dossier: dossierTmp, journal: () => { } });
        const inc = await envoyer(srvTable.port, { entetes: BON, corps: corpsBon });
        verifier('table de production : cs1bc = 315 tuiles relevées, une page de 3 est « incomplète » (422), rien d\'écrit', [inc.status, /page incomplète : 3 tuiles lues, 315 relevées/.test(inc.json?.motif || ''), fichiers().length === avant], [422, true, true]);
        await srvTable.fermer();
        const srv5 = await R.demarrer({ port: 0, dossier: dossierTmp, attendu: c => (c === 'cs1bc' ? 5 : null), journal: () => { } });
        const inc5 = await envoyer(srv5.port, { entetes: BON, corps: corpsBon });
        verifier('attendu 5, tuiles 3 : « page incomplète »', [inc5.status, /page incomplète/.test(inc5.json?.motif || '')], [422, true]);
        const srv3 = await R.demarrer({ port: 0, dossier: dossierTmp, attendu: c => (c === 'cs1bc' ? 3 : null), journal: () => { } });
        const exact = await envoyer(srv3.port, { entetes: BON, corps: corpsBon });
        verifier('attendu 3, tuiles 3 : acceptée', exact.status, 200);
        await srv5.fermer(); await srv3.fermer();

        // ── le flux de données : « absent » (anomalie) ≠ « présent, 0 adresse officielle » (normal)
        const dejaLa = new Set(fichiers());
        const sansFlux = await envoyer(port, { entetes: BON, corps: { url: URL_BONNE, html: page(...TROIS) } });
        verifier('flux ABSENT : accepté, mais signalé comme anomalie, 0 adresse', [sansFlux.status, sansFlux.json?.flux, sansFlux.json?.officielles, /FLUX DE DONNÉES ABSENT/.test(sansFlux.json?.anomalie || '')], [200, 'absent', 0, true]);
        verifier('… et l\'anomalie est imprimée', journal.some(l => /FLUX DE DONNÉES ABSENT/.test(l)), true);
        const nouveau = fichiers().filter(n => !dejaLa.has(n));
        verifier('… le fichier le dit', nouveau.some(n => JSON.parse(fs.readFileSync(path.join(dossierTmp, n), 'utf8')).flux === 'absent'), true);
        const fluxZero = await envoyer(port, { entetes: BON, corps: { url: URL_BONNE, html: page(...TROIS) + '<script>window.__reactRouterContext = {};</script>' } });
        verifier('flux PRÉSENT sans adresse officielle : le résultat normal, aucune anomalie', [fluxZero.status, fluxZero.json?.flux, fluxZero.json?.officielles, fluxZero.json?.anomalie], [200, 'present', 0, undefined]);

        // ── un corps trop gros : plafond de pikaqian.js. 413 EXACT ; si le serveur coupe la connexion, preuve qu'il n'a rien écrit ET qu'il répond encore ensuite
        verifier('PAGE_MAX_OCTETS est exporté par pikaqian.js (8 Mo)', P.PAGE_MAX_OCTETS, 8 * 1024 * 1024);
        const nAvantGros = fichiers().length;
        const vivant = async () => (await envoyer(port, { methode: 'GET', entetes: BON })).status === 405;
        const gros = await envoyer(port, { entetes: BON, brut: 'x'.repeat(P.PAGE_MAX_OCTETS + 1) });
        verifier('corps de PAGE_MAX_OCTETS + 1 octets : 413 exact, ou coupure avec rien d\'écrit ET le récepteur répond encore', [gros.status === 413 || (gros.status === 0 && fichiers().length === nAvantGros && await vivant()), fichiers().length === nAvantGros], [true, true]);

        // ── un second apprentissage du même set s'ajoute (une page par fichier, jamais écrasée)
        const nAvant2 = fichiers().length;
        await new Promise(res => setTimeout(res, 1100));
        r = await envoyer(port, { entetes: BON, corps: corpsBon });
        verifier('la même page une seconde fois : un fichier de plus, les premiers intacts', [r.status, fichiers().length], [200, nAvant2 + 1]);
    } finally { await srv.fermer(); }

    // ── le plafond est une option : un petit plafond refuse un corps réel qui le dépasse
    const petit = await R.demarrer({ port: 0, dossier: dossierTmp, maxOctets: 500, attendu: () => null, journal: () => { } });
    const nPetit = fichiers().length;
    const gros2 = Buffer.byteLength(JSON.stringify(corpsBon)) > 500;
    const p = await envoyer(petit.port, { entetes: BON, corps: corpsBon });
    verifier('plafond abaissé à 500 octets : la page fait plus de 500 octets et est refusée par 413 EXACT (Content-Length déclaré)', [gros2, p.status, fichiers().length === nPetit], [true, 413, true]);
    // le même plafond, sans Content-Length véridique : le flux reçu est compté (Transfer-Encoding: chunked)
    const chunk = await new Promise(resolve => {
        const req = http.request({ host: '127.0.0.1', port: petit.port, method: 'POST', path: '/apprendre', headers: { ...BON } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', e => resolve(e.code || 0));
        req.write(JSON.stringify(corpsBon)); req.end();
    });
    const vivantPetit = (await envoyer(petit.port, { methode: 'GET', entetes: BON })).status === 405;
    verifier('corps en morceaux (sans Content-Length) au-dessus du plafond : 413 exact, ou coupure avec rien d\'écrit ET le récepteur répond encore', [chunk === 413 || ((chunk === 0 || chunk === 'ECONNRESET') && vivantPetit), fichiers().length === nPetit], [true, true]);
    await petit.fermer();

    // ── l'hôte d'écoute n'est pas réglable : aucune option pour sortir de 127.0.0.1
    verifier('demarrer ignore une option « hote » (jamais 0.0.0.0)', await (async () => { const s = await R.demarrer({ port: 0, dossier: dossierTmp, hote: '0.0.0.0', journal: () => { } }); const a = s.adresse; await s.fermer(); return a; })(), '127.0.0.1');
    // ── le dossier ne doit jamais être dans le dépôt
    if (!process.env.PK_RECEPTEUR) {
        let leve = null; try { await R.demarrer({ port: 0, dossier: path.join(__dirname, 'apprises-test'), journal: () => { } }); } catch (e) { leve = e.message; }
        verifier('un dossier DANS le dépôt : démarrage refusé', /dépôt/.test(leve || ''), true);
        verifier('… et rien n\'a été créé', fs.existsSync(path.join(__dirname, 'apprises-test')), false);
    }

    // ── la ligne de commande : un argument inconnu refuse avant tout (code 2)
    const cli = args => spawnSync(process.execPath, [path.join(__dirname, 'recepteur-pikaqian.js'), ...args], { encoding: 'utf8', timeout: 15000 });
    for (const a of [['--hote=0.0.0.0'], ['--port=abc'], ['--port=80'], ['--inconnu'], ['--dossier=']]) {
        const c = cli(a);
        verifier(`CLI ${a.join(' ')} : refusé, code 2`, c.status, 2);
    }

    fs.rmSync(dossierTmp, { recursive: true, force: true });
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc interrompu :', e); process.exit(1); });
