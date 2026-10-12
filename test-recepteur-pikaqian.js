// node test-recepteur-pikaqian.js — le RÉCEPTEUR passif de PikaQian (recepteur-pikaqian.js). Aucun réseau extérieur : un serveur sur un port ÉPHÉMÈRE de 127.0.0.1,
// des pages fabriquées au format mesuré le 2026-10-10 (collecte-cartes/pikaqian.js l. 39), un dossier temporaire HORS du dépôt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const P = require('./collecte-cartes/pikaqian');
const R = require('./recepteur-pikaqian');

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
const BONNE = page(tuile(1, 'cs1bc', '001', 'Pikachu'), tuile(2, 'cs1bc', '002', 'Raichu'), tuile(3, 'cs1bc', '003', 'Pichu')) + flux(2, OFFICIELLE);

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
const BON = { 'Content-Type': 'application/json', Origin: 'https://pikaqian.com' };
const fichiers = () => fs.readdirSync(dossierTmp).sort();

(async () => {
    const journal = [];
    const srv = await R.demarrer({ port: 0, dossier: dossierTmp, journal: m => journal.push(m) });
    const port = srv.port;
    try {
        verifier('le serveur écoute 127.0.0.1 et nulle autre adresse', srv.adresse, '127.0.0.1');

        // ── ce que la garde AUTORISE : une page bien formée
        let r = await envoyer(port, { entetes: BON, corps: { url: 'https://pikaqian.com/sets/cs1bc', html: BONNE } });
        verifier('page conforme : 200, ok, tuiles lues 3, au code 3, adresses officielles 1', [r.status, r.json?.ok, r.json?.tuilesLues, r.json?.tuilesAuCode, r.json?.officielles], [200, true, 3, 3, 1]);
        verifier('un fichier écrit, nommé par le code du set', [fichiers().length, /^cs1bc--\d{8}T\d{6}Z\.json$/.test(fichiers()[0] || '')], [1, true]);
        const f = JSON.parse(fs.readFileSync(path.join(dossierTmp, fichiers()[0]), 'utf8'));
        verifier('le fichier : code, adresse, date, sha256 du HTML, verdict', [f.code, f.url, typeof f.le, f.sha256, f.verdict.ok], ['cs1bc', 'https://pikaqian.com/sets/cs1bc', 'string', require('crypto').createHash('sha256').update(BONNE).digest('hex'), true]);
        verifier('le fichier porte les tuiles lues (lireTuiles de production) et les origines déclarées (lireOrigines)', [f.tuiles, f.origines], [P.lireTuiles(BONNE), [[UUID(2), { native: 'https://pokipair.example/x.png', officielle: OFFICIELLE }]]]);
        verifier('le HTML lui-même n\'est PAS gardé', JSON.stringify(f).includes('<html'), false);
        verifier('aucun en-tête d\'accès croisé dans la réponse', r.entetes['access-control-allow-origin'], undefined);
        verifier('chaque page reçue est imprimée', journal.length >= 1 && /cs1bc/.test(journal[0]), true);

        // ── ce qu'elle REFUSE (rien d'écrit à chaque fois)
        const avant = fichiers().length;
        const refus = async (nom, o, statut) => {
            const x = await envoyer(port, o);
            verifier(`${nom} : refusé (${statut}), rien d'écrit`, [x.status, fichiers().length === avant], [statut, true]);
            return x;
        };
        const corpsBon = { url: 'https://pikaqian.com/sets/cs1bc', html: BONNE };
        await refus('une autre Origin', { entetes: { ...BON, Origin: 'https://exemple.test' }, corps: corpsBon }, 403);
        await refus('Origin avec un suffixe (pikaqian.com.evil.test)', { entetes: { ...BON, Origin: 'https://pikaqian.com.evil.test' }, corps: corpsBon }, 403);
        await refus('Origin en http', { entetes: { ...BON, Origin: 'http://pikaqian.com' }, corps: corpsBon }, 403);
        await refus('pas d\'Origin', { entetes: { 'Content-Type': 'application/json' }, corps: corpsBon }, 403);
        await refus('Host qui n\'est pas 127.0.0.1 / localhost (DNS rebinding)', { entetes: { ...BON, Host: 'evil.test' }, corps: corpsBon }, 403);
        await refus('Content-Type absent', { entetes: { Origin: 'https://pikaqian.com' }, corps: corpsBon }, 415);
        await refus('Content-Type text/plain', { entetes: { ...BON, 'Content-Type': 'text/plain' }, corps: corpsBon }, 415);
        await refus('méthode GET', { methode: 'GET', entetes: BON }, 405);
        await refus('méthode PUT', { methode: 'PUT', entetes: BON, corps: corpsBon }, 405);
        await refus('méthode OPTIONS', { methode: 'OPTIONS', entetes: BON }, 405);
        await refus('chemin /autre', { chemin: '/autre', entetes: BON, corps: corpsBon }, 404);
        await refus('chemin /apprendre?x=1', { chemin: '/apprendre?x=1', entetes: BON, corps: corpsBon }, 404);
        await refus('chemin /apprendre/', { chemin: '/apprendre/', entetes: BON, corps: corpsBon }, 404);
        await refus('adresse d\'un autre site', { entetes: BON, corps: { url: 'https://exemple.test/sets/cs1bc', html: BONNE } }, 422);
        await refus('adresse http', { entetes: BON, corps: { url: 'http://pikaqian.com/sets/cs1bc', html: BONNE } }, 422);
        await refus('adresse avec requête', { entetes: BON, corps: { url: 'https://pikaqian.com/sets/cs1bc?a=1', html: BONNE } }, 422);
        await refus('adresse hors motif de code (majuscules)', { entetes: BON, corps: { url: 'https://pikaqian.com/sets/CS1BC', html: BONNE } }, 422);
        await refus('adresse hors motif (/cards/<uuid>)', { entetes: BON, corps: { url: `https://pikaqian.com/cards/${UUID(1)}`, html: BONNE } }, 422);
        await refus('adresse hors motif (traversée)', { entetes: BON, corps: { url: 'https://pikaqian.com/sets/../api/x', html: BONNE } }, 422);
        await refus('JSON illisible', { entetes: BON, brut: '{pas du json' }, 400);
        await refus('clé inconnue dans le corps (cookie)', { entetes: BON, corps: { ...corpsBon, cookie: 'a=b' } }, 400);
        await refus('html absent', { entetes: BON, corps: { url: corpsBon.url } }, 400);
        await refus('html pas une chaîne', { entetes: BON, corps: { url: corpsBon.url, html: 42 } }, 400);
        // la page que verdictDePage refuse : la majorité des tuiles n'est pas au code du set
        const autre = page(tuile(1, 'csv10c', '001', 'A'), tuile(2, 'csv10c', '002', 'B'), tuile(3, 'cs1bc', '003', 'C'));
        const x = await refus('page dont la majorité des tuiles n\'est pas au code du set', { entetes: BON, corps: { url: corpsBon.url, html: autre } }, 422);
        verifier('… et la raison est celle de verdictDePage', /ne désigne pas ce set/.test(x.json?.motif || ''), true);
        const vide = await refus('page sans aucune tuile lisible', { entetes: BON, corps: { url: corpsBon.url, html: '<html><body>Just a moment</body></html>' } }, 422);
        verifier('… raison : plus la forme mesurée', /plus la forme mesurée/.test(vide.json?.motif || ''), true);
        // un corps trop gros : plafond de pikaqian.js, par la déclaration ET par le flux réel
        verifier('PAGE_MAX_OCTETS est exporté par pikaqian.js (8 Mo)', P.PAGE_MAX_OCTETS, 8 * 1024 * 1024);
        const gros = await envoyer(port, { entetes: BON, brut: 'x'.repeat(P.PAGE_MAX_OCTETS + 1) });
        verifier('corps de PAGE_MAX_OCTETS + 1 octets : refusé (413, ou connexion coupée), rien d\'écrit', [[413, 0].includes(gros.status) ? 'refusé' : `statut ${gros.status}`, fichiers().length === avant], ['refusé', true]);

        // ── un second apprentissage du même set s'ajoute (une page par fichier, jamais écrasée)
        await new Promise(res => setTimeout(res, 1100));
        r = await envoyer(port, { entetes: BON, corps: corpsBon });
        verifier('la même page une seconde fois : un second fichier, le premier intact', [r.status, fichiers().length], [200, 2]);
    } finally { await srv.fermer(); }

    // ── le plafond est une option : un petit plafond refuse un corps réel qui le dépasse (flux, sans Content-Length vrai)
    const petit = await R.demarrer({ port: 0, dossier: dossierTmp, maxOctets: 500, journal: () => { } });
    const avantPetit = fichiers().length;
    const p = await envoyer(petit.port, { entetes: BON, corps: { url: 'https://pikaqian.com/sets/cs1bc', html: BONNE } });
    verifier('plafond abaissé à 500 octets : une page de plus de 500 octets est refusée (413)', [Buffer.byteLength(JSON.stringify({ url: 'https://pikaqian.com/sets/cs1bc', html: BONNE })) > 500, p.status, fichiers().length === avantPetit], [true, 413, true]);
    // le même plafond, sans Content-Length véridique : le flux reçu est compté (Transfer-Encoding: chunked)
    const chunk = await new Promise(resolve => {
        const req = http.request({ host: '127.0.0.1', port: petit.port, method: 'POST', path: '/apprendre', headers: { ...BON } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', e => resolve(e.code || 0));
        req.write(JSON.stringify({ url: 'https://pikaqian.com/sets/cs1bc', html: BONNE })); req.end();
    });
    verifier('corps en morceaux (sans Content-Length) au-dessus du plafond : 413 ou coupure, rien d\'écrit', [[413, 0, 'ECONNRESET'].includes(chunk), fichiers().length === avantPetit], [true, true]);
    await petit.fermer();

    // ── l'hôte d'écoute n'est pas réglable : aucune option pour sortir de 127.0.0.1
    verifier('demarrer ignore une option « hote » (jamais 0.0.0.0)', await (async () => { const s = await R.demarrer({ port: 0, dossier: dossierTmp, hote: '0.0.0.0', journal: () => { } }); const a = s.adresse; await s.fermer(); return a; })(), '127.0.0.1');
    // ── le dossier ne doit jamais être dans le dépôt
    let leve = null; try { await R.demarrer({ port: 0, dossier: path.join(__dirname, 'apprises-test'), journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('un dossier DANS le dépôt : démarrage refusé', /dépôt/.test(leve || ''), true);
    verifier('… et rien n\'a été créé', fs.existsSync(path.join(__dirname, 'apprises-test')), false);

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
