// node test-recepteur-collectorviper.js — le RÉCEPTEUR passif de Collectorviper (recepteur-collectorviper.js). Aucun réseau extérieur : un serveur sur un port ÉPHÉMÈRE de 127.0.0.1,
// des messages fabriqués, un dossier temporaire HORS du dépôt (jamais un dossier du testeur).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const R = require(process.env.CV_RECEPTEUR ? path.resolve(process.env.CV_RECEPTEUR) : './recepteur-collectorviper');
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const URL_BONNE = 'https://collectorviper.livejournal.com/339.html';
const PAQUET = '20261017T120000Z-a1b2c3d4';
const SIGNATURE_PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const png = (n = 40, graine = 1) => Buffer.concat([SIGNATURE_PNG, Buffer.alloc(n, graine)]);
const msgImage = (indice, extra = {}, octets = png(40, indice)) => ({ schema: 1, type: 'image', paquet: PAQUET, url: URL_BONNE, indice, mime: 'image/png', donnees: octets.toString('base64'), ...extra });
const entree = (indice, extra = {}) => ({ indice, src: `https://exemple-cdn.test/img/${indice}.jpg`, w: 500, h: 700, alt: `Carte ${indice}`, title: '', legende: `Carte ${indice} — Neo Genesis`, intertitre: 'Neo Genesis', etat: 'lue', raison: '', ...extra });
const msgPage = (images, extra = {}) => ({ schema: 1, type: 'page', paquet: PAQUET, url: URL_BONNE, titre: 'Master Collection Scans Catalogue', images, ...extra });

const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-cv-'));
function envoyer(port, { methode = 'POST', chemin = '/releve', entetes = {}, corps = null, brut = null } = {}) {
    return new Promise(resolve => {
        const donnees = brut ?? (corps == null ? null : JSON.stringify(corps));
        const h = { ...entetes };
        if (donnees != null) h['Content-Length'] = Buffer.byteLength(donnees);
        const req = http.request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: h }, res => {
            const m = [];
            res.on('data', c => m.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j, entetes: res.headers }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        if (donnees != null) req.write(donnees);
        req.end();
    });
}
const BON = { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE };
const sans = (h, cle) => { const c = { ...h }; delete c[cle]; return c; };
const tout = d => { const sortie = []; const rec = x => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) rec(p); else sortie.push(path.relative(dossierTmp, p)); } }; rec(d); return sortie.sort(); };

(async () => {
    const journal = [];
    const srv = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierTmp, journal: m => journal.push(m) });
    const port = srv.port;
    try {
        verifier('le serveur écoute 127.0.0.1 et nulle autre adresse', srv.adresse, '127.0.0.1');
        verifier('le port par défaut n\'est ni 8765 (PikaQian) ni 8766 (pokemon.com)', [R.PORT_DEFAUT !== 8765, R.PORT_DEFAUT !== 8766, R.PORT_DEFAUT >= 1024], [true, true, true]);
        verifier('l\'origine attendue est celle de la page supposée', R.ORIGINE_ATTENDUE, 'https://collectorviper.livejournal.com');

        // ── un paquet complet : 1 lue, 1 illisible, 1 sous le seuil
        const sub = `339-html--${PAQUET}`;
        let r = await envoyer(port, { entetes: BON, corps: msgImage(1) });
        verifier('image valide, SANS Origin : 200 et le fichier est écrit sous <slug>--<paquet>/', [r.status, r.json?.ok, tout(dossierTmp)], [200, true, [`${sub}\\img-0001.png`]]);
        const lu = fs.readFileSync(path.join(dossierTmp, sub, 'img-0001.png'));
        verifier('… octet pour octet', lu.equals(png(40, 1)), true);
        const ill = entree(2, { etat: 'illisible', raison: 'illisible sans requête', w: 600, h: 800 });
        const sous = entree(3, { etat: 'sous-seuil', raison: 'sous le seuil', w: LARGEUR_MIN - 1, h: 300 });
        r = await envoyer(port, { entetes: BON, corps: msgPage([entree(1), ill, sous]) });
        verifier('page : 200, comptes vues 3 / lues 1 / illisibles 1 / sous le seuil 1 / manquantes 0, complet', [r.status, r.json?.comptes, r.json?.etat], [200, { vues: 3, lues: 1, illisibles: 1, sousSeuil: 1, manquantes: 0 }, 'complet']);
        const page = JSON.parse(fs.readFileSync(path.join(dossierTmp, sub, 'page.json'), 'utf8'));
        verifier('page.json : url, titre, comptes, et pour l\'image lue son fichier + sha256 + octets', [page.url, page.titre, page.comptes.vues, page.images[0].fichier, page.images[0].sha256 === crypto.createHash('sha256').update(png(40, 1)).digest('hex'), page.images[0].octets], [URL_BONNE, 'Master Collection Scans Catalogue', 3, 'img-0001.png', true, png(40, 1).length]);
        verifier('… l\'illisible et le sous-seuil n\'ont aucun fichier, mais leur raison', [page.images[1].fichier, page.images[1].raison, page.images[2].fichier, page.images[2].raison], [undefined, 'illisible sans requête', undefined, 'sous le seuil']);
        verifier('… l\'adresse, la légende et l\'intertitre sont gardés pour chaque image', [page.images[1].src, page.images[1].legende, page.images[1].intertitre], ['https://exemple-cdn.test/img/2.jpg', 'Carte 2 — Neo Genesis', 'Neo Genesis']);
        verifier('le journal imprime le compte', journal.some(l => /3 image/.test(l) && /1 lue/.test(l)), true);
        verifier('une seconde page pour le même paquet : 409, rien de réécrit', [(await envoyer(port, { entetes: BON, corps: msgPage([entree(1)]) })).status, JSON.parse(fs.readFileSync(path.join(dossierTmp, sub, 'page.json'), 'utf8')).comptes.vues], [409, 3]);
        verifier('une image pour un paquet CLOS : 409', (await envoyer(port, { entetes: BON, corps: msgImage(9) })).status, 409);

        // ── une image déclarée lue dont le fichier n'est jamais arrivé : dite manquante, jamais comptée lue
        const P2 = '20261017T120100Z-aaaaaaaa';
        const p2 = await envoyer(port, { entetes: BON, corps: msgPage([entree(1), entree(2)], { paquet: P2 }) });
        verifier('2 images déclarées lues, aucun fichier reçu : manquantes 2, lues 0, état incomplet', [p2.status, p2.json?.comptes.lues, p2.json?.comptes.manquantes, p2.json?.etat], [200, 0, 2, 'incomplet']);
        // ── un indice envoyé deux fois
        const P3 = '20261017T120200Z-bbbbbbbb';
        await envoyer(port, { entetes: BON, corps: msgImage(1, { paquet: P3 }) });
        verifier('la même image (même paquet, même indice) deux fois : 409', (await envoyer(port, { entetes: BON, corps: msgImage(1, { paquet: P3 }) })).status, 409);

        // ── LE NOM DE DOSSIER : le slug vient de l'adresse reçue ; chaque cas hostile donne un nom sûr, dans le dossier
        const BASE = 'https://collectorviper.livejournal.com/';
        const hostiles = [['..\\..\\x', '..%5C..%5Cx'], ['../x', '..%2Fx'], ['chemin absolu', '%2Fetc%2Fpasswd'], ['lecteur', 'C%3A%5CWindows%5Cx'], ['NUL', 'a%00b'], ['points', '..'], ['vide', ''], ['très long', 'a'.repeat(500)], ['majuscules', 'Neo%20Genesis%21.html']];
        const avantH = new Set(tout(dossierTmp));
        let n = 0;
        for (const [nom, valeur] of hostiles) {
            const slug = R.slugDe(BASE + valeur);
            verifier(`slug (${nom}) : [a-z0-9-] seulement, 1 à 40 caractères`, /^[a-z0-9-]{1,40}$/.test(slug), true);
            const pq = `20261017T13${String(10 + n).padStart(4, '0')}Z-${String(n).padStart(8, '0').replace(/\d/g, 'c')}`;
            n++;
            const x = await envoyer(port, { entetes: BON, corps: msgImage(1, { paquet: pq, url: BASE + valeur }) });
            verifier(`écriture (${nom}) : 200`, x.status, 200);
        }
        const nouveaux = tout(dossierTmp).filter(f => !avantH.has(f));
        verifier('… tout est écrit directement sous <slug>--<paquet>/img-NNNN.png', [nouveaux.length, nouveaux.every(f => /^[a-z0-9-]{1,40}--\d{8}T\d{6}Z-[a-f0-9]{8}\\img-0001\.png$/.test(f))], [hostiles.length, true]);
        verifier('… et rien n\'a été écrit au-dessus du dossier', fs.readdirSync(path.dirname(dossierTmp)).filter(f => /^(page|img|[a-z0-9-]+--\d{8}T)/.test(f) && f !== path.basename(dossierTmp) && /--\d{8}T/.test(f)).length, 0);

        // ── ce qu'elle REFUSE, chaque refus pris SEUL : rien d'écrit
        const avant = tout(dossierTmp).length;
        const refus = async (nom, o, statut, motif = null) => {
            const x = await envoyer(port, o);
            verifier(`${nom} : refusé (${statut}${motif ? `, motif ${motif}` : ''}), rien d'écrit`, [x.status, motif ? motif.test(x.json?.motif || '') : true, tout(dossierTmp).length === avant], [statut, true, true]);
            return x;
        };
        const NEUF = '20261017T140000Z-cafecafe';
        await refus('une autre Origin web', { entetes: { ...BON, Origin: 'https://exemple.test' }, corps: msgImage(1, { paquet: NEUF }) }, 403, /Origin/);
        await refus('Origin de pokemon.com', { entetes: { ...BON, Origin: 'https://www.pokemon.com' }, corps: msgImage(1, { paquet: NEUF }) }, 403, /Origin/);
        await refus('Origin livejournal.com sans sous-domaine', { entetes: { ...BON, Origin: 'https://livejournal.com' }, corps: msgImage(1, { paquet: NEUF }) }, 403, /Origin/);
        await refus('Origin avec suffixe', { entetes: { ...BON, Origin: 'https://collectorviper.livejournal.com.evil.test' }, corps: msgImage(1, { paquet: NEUF }) }, 403, /Origin/);
        await refus('Origin « null »', { entetes: { ...BON, Origin: 'null' }, corps: msgImage(1, { paquet: NEUF }) }, 403, /Origin/);
        await refus('Origin en http', { entetes: { ...BON, Origin: 'http://collectorviper.livejournal.com' }, corps: msgImage(1, { paquet: NEUF }) }, 403, /Origin/);
        await refus('en-tête X-Rat-Market absent', { entetes: sans(BON, 'X-Rat-Market'), corps: msgImage(1, { paquet: NEUF }) }, 403, /x-rat-market/);
        await refus('Host étranger', { entetes: { ...BON, Host: 'evil.test' }, corps: msgImage(1, { paquet: NEUF }) }, 403, /Host/);
        await refus('Content-Type text/plain', { entetes: { ...BON, 'Content-Type': 'text/plain' }, corps: msgImage(1, { paquet: NEUF }) }, 415);
        await refus('méthode GET', { methode: 'GET', entetes: BON }, 405);
        const opt = await refus('méthode OPTIONS', { methode: 'OPTIONS', entetes: { Origin: 'https://exemple.test', 'Access-Control-Request-Method': 'POST' } }, 405);
        verifier('… sans en-tête CORS', [opt.entetes['access-control-allow-origin'], opt.entetes['access-control-allow-private-network']], [undefined, undefined]);
        await refus('chemin /autre', { chemin: '/autre', entetes: BON, corps: msgImage(1, { paquet: NEUF }) }, 404);
        await refus('chemin /releve?x=1', { chemin: '/releve?x=1', entetes: BON, corps: msgImage(1, { paquet: NEUF }) }, 404);
        await refus('JSON illisible', { entetes: BON, brut: '{pas du json' }, 400);
        await refus('corps tableau', { entetes: BON, brut: '[1]' }, 400, /objet/);
        await refus('type inconnu', { entetes: BON, corps: { ...msgImage(1, { paquet: NEUF }), type: 'autre' } }, 400, /type/);
        await refus('image : clé en trop (cookie)', { entetes: BON, corps: { ...msgImage(1, { paquet: NEUF }), cookie: 'a=b' } }, 400, /clés/);
        await refus('image : clé manquante (donnees)', { entetes: BON, corps: (() => { const o = msgImage(1, { paquet: NEUF }); delete o.donnees; return o; })() }, 400, /clés/);
        await refus('schema ≠ 1', { entetes: BON, corps: msgImage(1, { paquet: NEUF, schema: 2 }) }, 400, /schema/);
        await refus('paquet mal formé', { entetes: BON, corps: msgImage(1, { paquet: '../x' }) }, 400, /paquet/);
        await refus('url d\'un autre site', { entetes: BON, corps: msgImage(1, { paquet: NEUF, url: 'https://exemple.test/339.html' }) }, 422, /adresse/);
        await refus('url pokemon.com', { entetes: BON, corps: msgImage(1, { paquet: NEUF, url: 'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/' }) }, 422, /adresse/);
        await refus('url en http', { entetes: BON, corps: msgImage(1, { paquet: NEUF, url: 'http://collectorviper.livejournal.com/339.html' }) }, 422, /adresse/);
        await refus('url avec identifiants', { entetes: BON, corps: msgImage(1, { paquet: NEUF, url: 'https://u:p@collectorviper.livejournal.com/339.html' }) }, 422, /adresse/);
        await refus('url sur un hôte à suffixe', { entetes: BON, corps: msgImage(1, { paquet: NEUF, url: 'https://collectorviper.livejournal.com.evil.test/339.html' }) }, 422, /adresse/);
        await refus('url sur un autre sous-domaine livejournal', { entetes: BON, corps: msgImage(1, { paquet: NEUF, url: 'https://autre.livejournal.com/339.html' }) }, 422, /adresse/);
        await refus('indice 0', { entetes: BON, corps: msgImage(0, { paquet: NEUF }) }, 400, /indice/);
        await refus('indice au-delà de IMAGES_MAX', { entetes: BON, corps: msgImage(R.IMAGES_MAX + 1, { paquet: NEUF }) }, 400, /indice/);
        await refus('indice non entier', { entetes: BON, corps: msgImage(1.5, { paquet: NEUF }) }, 400, /indice/);
        await refus('mime autre que image/png', { entetes: BON, corps: msgImage(1, { paquet: NEUF, mime: 'image/jpeg' }) }, 400, /mime/);
        await refus('octets qui ne sont pas un PNG', { entetes: BON, corps: msgImage(1, { paquet: NEUF }, Buffer.from('<html>pas une image</html>')) }, 415, /PNG/);
        await refus('données vides', { entetes: BON, corps: msgImage(1, { paquet: NEUF, donnees: '' }) }, 415, /PNG/);
        await refus('données qui ne sont pas du base64', { entetes: BON, corps: msgImage(1, { paquet: NEUF, donnees: '***pas du base64***' }) }, 400, /base64/);
        await refus('données de bonne longueur mais hors alphabet base64', { entetes: BON, corps: msgImage(1, { paquet: NEUF, donnees: '****AAAA' }) }, 400, /base64/);
        await refus('image au-dessus de IMAGE_OCTETS_MAX', { entetes: BON, corps: msgImage(1, { paquet: NEUF }, png(R.IMAGE_OCTETS_MAX + 1)) }, 413, /octets/);
        // page
        const pg = (images, extra = {}) => ({ entetes: BON, corps: msgPage(images, { paquet: NEUF, ...extra }) });
        await refus('page : clé en trop', { entetes: BON, corps: { ...msgPage([entree(1)], { paquet: NEUF }), cookie: 'x' } }, 400, /clés/);
        await refus('page : images pas un tableau', pg('x'), 400, /images/);
        await refus('page : plus de IMAGES_MAX images', pg(Array.from({ length: R.IMAGES_MAX + 1 }, (_, i) => entree(i + 1))), 400, /images/);
        await refus('page : entrée avec une clé en plus', pg([entree(1, { cookie: 'x' })]), 400, /image 0/);
        await refus('page : indice dupliqué', pg([entree(1), entree(1)]), 400, /indice/);
        await refus('page : état inconnu', pg([entree(1, { etat: 'peut-etre' })]), 400, /état/);
        await refus('page : lue sous le seuil de largeur', pg([entree(1, { w: LARGEUR_MIN - 1 })]), 422, /seuil/);
        await refus('page : « sous-seuil » déclaré pour une image assez large', pg([entree(1, { etat: 'sous-seuil', raison: 'sous le seuil', w: LARGEUR_MIN })]), 422, /seuil/);
        await refus('page : illisible sans raison', pg([entree(1, { etat: 'illisible', raison: '' })]), 400, /raison/);
        await refus('page : lue AVEC une raison', pg([entree(1, { raison: 'x' })]), 400, /raison/);
        await refus('page : src en http', pg([entree(1, { src: 'http://exemple.test/a.jpg' })]), 400, /src/);
        await refus('page : src data:', pg([entree(1, { src: 'data:image/png;base64,AAAA' })]), 400, /src/);
        await refus('page : largeur négative', pg([entree(1, { w: -1 })]), 400, /dimensions/);
        await refus('page : légende trop longue', pg([entree(1, { legende: 'x'.repeat(501) })]), 400, /légende/);

        // ── un corps trop gros
        const nAvantGros = tout(dossierTmp).length;
        const vivant = async () => (await envoyer(port, { methode: 'GET', entetes: BON })).status === 405;
        const gros = await envoyer(port, { entetes: BON, brut: 'x'.repeat(R.CORPS_MAX_OCTETS + 1) });
        verifier('corps de CORPS_MAX_OCTETS + 1 : 413 ou coupure, rien d\'écrit, récepteur vivant', [gros.status === 413 || (gros.status === 0 && await vivant()), tout(dossierTmp).length === nAvantGros], [true, true]);
        verifier('CORPS_MAX_OCTETS laisse passer une image au plafond (base64 compris)', R.CORPS_MAX_OCTETS > Math.ceil(R.IMAGE_OCTETS_MAX * 4 / 3), true);
    } finally { await srv.fermer(); }

    // ── le plafond est une option, compté sur la déclaration ET sur le flux
    const petit = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierTmp, maxOctets: 300, journal: () => { } });
    const nPetit = tout(dossierTmp).length;
    const p = await envoyer(petit.port, { entetes: BON, corps: msgImage(1, { paquet: '20261017T150000Z-deadbeef' }, png(600)) });
    verifier('plafond abaissé à 300 octets : 413 (Content-Length déclaré), rien d\'écrit', [p.status, tout(dossierTmp).length === nPetit], [413, true]);
    const chunk = await new Promise(resolve => {
        const req = http.request({ host: '127.0.0.1', port: petit.port, method: 'POST', path: '/releve', headers: { ...BON } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', e => resolve(e.code || 0));
        req.write(JSON.stringify(msgImage(1, { paquet: '20261017T150000Z-deadbeef' }, png(600)))); req.end();
    });
    verifier('corps en morceaux au-dessus du plafond : 413 ou coupure, rien d\'écrit', [chunk === 413 || chunk === 0 || chunk === 'ECONNRESET', tout(dossierTmp).length === nPetit], [true, true]);
    await petit.fermer();

    // ── un plafond du NOMBRE DE PAQUETS sur disque : un paquet de plus que le plafond est refusé (507), un paquet déjà ouvert continue
    const dossierPq = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-cv-pq-'));
    const lim = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierPq, maxPaquets: 2, journal: () => { } });
    const pq = i => `20261017T16000${i}Z-0000000${i}`;
    const sousDossiers = () => fs.readdirSync(dossierPq).length;
    const a1 = await envoyer(lim.port, { entetes: BON, corps: msgImage(1, { paquet: pq(1) }) });
    const a2 = await envoyer(lim.port, { entetes: BON, corps: msgImage(1, { paquet: pq(2) }) });
    const a3 = await envoyer(lim.port, { entetes: BON, corps: msgImage(1, { paquet: pq(3) }) });
    verifier('plafond de 2 paquets : les deux premiers passent, le troisième est refusé (507), rien créé pour lui', [a1.status, a2.status, a3.status, a3.json?.motif && /plafond/.test(a3.json.motif), sousDossiers()], [200, 200, 507, true, 2]);
    verifier('… un paquet DÉJÀ ouvert continue (image 2 du paquet 1)', (await envoyer(lim.port, { entetes: BON, corps: msgImage(2, { paquet: pq(1) }) })).status, 200);
    verifier('… la clôture d\'un paquet NEUF est refusée aussi (507), celle d\'un paquet ouvert passe', [(await envoyer(lim.port, { entetes: BON, corps: msgPage([entree(1)], { paquet: pq(3) }) })).status, (await envoyer(lim.port, { entetes: BON, corps: msgPage([entree(1)], { paquet: pq(1) }) })).status, sousDossiers()], [507, 200, 2]);
    await lim.fermer();
    fs.rmSync(dossierPq, { recursive: true, force: true });
    verifier('le plafond par défaut existe et est borné', [Number.isInteger(R.MAX_PAQUETS_DEFAUT), R.MAX_PAQUETS_DEFAUT > 0, R.MAX_PAQUETS_DEFAUT <= 5000], [true, true, true]);

    verifier('demarrer ignore une option « hote » (jamais 0.0.0.0)', await (async () => { const s = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierTmp, hote: '0.0.0.0', journal: () => { } }); const a = s.adresse; await s.fermer(); return a; })(), '127.0.0.1');

    // ── ÉCRITURE DANS LE SEUL DOSSIER PRÉVU
    let leve = null; try { await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: path.join(__dirname, 'cv-test'), journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('un dossier DANS le dépôt : démarrage refusé, rien créé', [/dépôt/.test(leve || ''), fs.existsSync(path.join(__dirname, 'cv-test'))], [true, false]);
    leve = null; try { await R.demarrer({ racine: dossierTmp, port: 0, dossier: path.join(os.tmpdir(), 'cv-hors-racine-' + process.pid), journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('un dossier HORS de la racine autorisée : démarrage refusé', /racine autorisée/.test(leve || ''), true);
    leve = null; const apports = path.join(dossierTmp, 'Logo FR'); try { await R.demarrer({ racine: dossierTmp, port: 0, dossier: apports, journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('un dossier nommé comme un dossier d\'apports manuels : refusé, rien créé', [/apports manuels/.test(leve || ''), fs.existsSync(apports)], [true, false]);
    verifier('le dossier par défaut est sous la racine du chantier, n\'est pas un dossier d\'apports, et se nomme collectorviper-passif', [R.dansRacineAutorisee(R.DOSSIER_DEFAUT), R.dansApportsManuels(R.DOSSIER_DEFAUT), path.basename(R.DOSSIER_DEFAUT)], [true, false, 'collectorviper-passif']);

    const cli = args => spawnSync(process.execPath, [path.join(__dirname, 'recepteur-collectorviper.js'), ...args], { encoding: 'utf8', timeout: 15000 });
    for (const a of [['--hote=0.0.0.0'], ['--port=abc'], ['--port=80'], ['--inconnu'], ['--dossier=']]) verifier(`CLI ${a.join(' ')} : refusé, code 2`, cli(a).status, 2);

    fs.rmSync(dossierTmp, { recursive: true, force: true });
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc interrompu :', e); process.exit(1); });
