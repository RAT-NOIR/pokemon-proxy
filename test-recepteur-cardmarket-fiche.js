// node test-recepteur-cardmarket-fiche.js — le RÉCEPTEUR passif des fiches Cardmarket (recepteur-cardmarket-fiche.js). Aucun réseau extérieur : un serveur sur un port ÉPHÉMÈRE
// de 127.0.0.1, des messages fabriqués, un dossier temporaire HORS du dépôt (jamais un dossier du testeur).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const R = require(process.env.CMF_RECEPTEUR ? path.resolve(process.env.CMF_RECEPTEUR) : './recepteur-cardmarket-fiche');
const LISTE = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'cm-passif-liste.json'), 'utf8'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const V1 = LISTE[0].versions[0], V2 = LISTE[0].versions[1];
const URL_V1 = V1.url, URL_V2 = V2.url;
const URL_HORS = 'https://www.cardmarket.com/en/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58';
const SIG_PNG = Buffer.from('89504e470d0a1a0a', 'hex'), SIG_JPG = Buffer.from('ffd8ffe0', 'hex');
const sharp = require('sharp');
// de VRAIES images (8 × 10 px) : le récepteur les décode ; les fausses (en-tête + remplissage) servent aux seuls bancs de signature
const IMG_W = 8, IMG_H = 10;
const vraie = async (fmt, g) => sharp({ create: { width: IMG_W, height: IMG_H, channels: 3, background: { r: g * 40, g: 10, b: 200 } } })[fmt]().toBuffer();
const REELLES = {};
const png = (g = 1, n = 40) => REELLES['png' + g] || Buffer.concat([SIG_PNG, Buffer.alloc(n, g)]);
const jpg = (g = 1, n = 40) => REELLES['jpeg' + g] || Buffer.concat([SIG_JPG, Buffer.alloc(n, g)]);
const fauxPng = (n = 40) => Buffer.concat([SIG_PNG, Buffer.alloc(n, 7)]);
let compteur = 0;
const paquet = () => `20261017T1200${String(compteur++).padStart(2, '0')}Z-a1b2c3d4`;
const msg = (extra = {}, octets = png(1)) => ({
    schema: 1, paquet: paquet(), url: URL_V1, titre: 'Meganium (MEP001)', nom: 'Meganium', idProduct: V1.idProduct, imageMotif: null, imageSrc: `https://images-exemple.test/51/MEP/${V1.idProduct}/${V1.idProduct}.jpg`, w: IMG_W, h: IMG_H,
    mime: 'image/png', pixels: octets.toString('base64'), pixelsMotif: null, verdictTesteur: 'tampon-visible', ...extra
});
const sansPixels = (extra = {}) => msg({ mime: null, pixels: null, pixelsMotif: 'canvas-protege', ...extra });

const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-cmf-'));
function envoyer(port, { methode = 'POST', chemin = '/releve', entetes = {}, corps = null, brut = null } = {}) {
    return new Promise(resolve => {
        const donnees = brut ?? (corps == null ? null : JSON.stringify(corps));
        const h = { ...entetes };
        if (donnees != null) h['Content-Length'] = Buffer.byteLength(donnees);
        const req = http.request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: h }, res => {
            const m = [];
            res.on('data', c => m.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        if (donnees != null) req.write(donnees);
        req.end();
    });
}
const BON = { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE };
const sans = (h, cle) => { const c = { ...h }; delete c[cle]; return c; };
const fichiers = () => fs.readdirSync(dossierTmp).sort();
const statut = o => R.jugerMessage(JSON.stringify(o)).statut;

(async () => {
    for (const g of [1, 2, 3]) { REELLES['png' + g] = await vraie('png', g); REELLES['jpeg' + g] = await vraie('jpeg', g); }
    // ── schéma, pur
    verifier('message valide (PNG) : 200', statut(msg()), 200);
    verifier('message valide (JPEG) : 200', statut(msg({ mime: 'image/jpeg' }, jpg())), 200);
    verifier('sans pixels (canvas protégé) : 200', statut(sansPixels()), 200);
    verifier('adresse hors des 64 : ACCEPTÉE', statut(msg({ url: URL_HORS })), 200);
    verifier('une clé de trop : 400', statut(msg({ extra: 1 })), 400);
    verifier('une clé manquante : 400', (() => { const o = msg(); delete o.nom; return statut(o); })(), 400);
    verifier('schema ≠ 1 : 400', statut(msg({ schema: 2 })), 400);
    verifier('paquet mal formé : 400', statut(msg({ paquet: '../../x' })), 400);
    verifier('corps non JSON : 400', R.jugerMessage('pas du json').statut, 400);
    verifier('corps tableau : 400', R.jugerMessage('[]').statut, 400);
    verifier('verdict hors des trois : 400', statut(msg({ verdictTesteur: 'peut-être' })), 400);
    for (const v of ['tampon-visible', 'pas-de-tampon', 'ne-sais-pas']) verifier(`verdict « ${v} » accepté`, statut(msg({ verdictTesteur: v })), 200);
    verifier('adresse : autre hôte : 422', statut(msg({ url: 'https://evil.example/en/Pokemon/Products/Singles/A/B' })), 422);
    verifier('adresse : http : 422', statut(msg({ url: URL_V1.replace('https', 'http') })), 422);
    verifier('adresse : hors de /Pokemon/Products/Singles/ : 422', statut(msg({ url: 'https://www.cardmarket.com/en/Magic/Products/Singles/A/B' })), 422);
    verifier('adresse : page de liste (un seul segment) : 422', statut(msg({ url: 'https://www.cardmarket.com/en/Pokemon/Products/Singles/SV-Black-Star-Promos' })), 422);
    verifier('adresse : avec ancre, requête, port ou identifiants : 422', ['#x', '?a=1'].map(s => statut(msg({ url: URL_V1 + s }))).concat(statut(msg({ url: URL_V1.replace('www.cardmarket.com', 'www.cardmarket.com:8443') })), statut(msg({ url: URL_V1.replace('https://', 'https://u:p@') }))), [422, 422, 422, 422]);
    verifier('pixels : du texte en base64 (pas une image) : 415', statut(msg({}, Buffer.from('ceci n\'est pas une image'))), 415);
    verifier('pixels : en-tête PNG mais mime jpeg déclaré : 415', statut(msg({ mime: 'image/jpeg' }, png())), 415);
    verifier('pixels : en-tête JPEG mais mime png déclaré : 415', statut(msg({}, jpg())), 415);
    verifier('pixels : base64 invalide : 400', statut(msg({ pixels: 'pas@base64!' })), 400);
    verifier('pixels : au-delà de la borne d\'image : 413', statut(msg({}, Buffer.concat([SIG_PNG, Buffer.alloc(R.IMAGE_OCTETS_MAX + 10)]))), 413);
    verifier('mime inconnu (image/gif) : 400', statut(msg({ mime: 'image/gif' })), 400);
    verifier('pixels fournis mais motif aussi : 400', statut(msg({ pixelsMotif: 'canvas-protege' })), 400);
    verifier('pas de pixels et pas de motif : 400', statut(msg({ mime: null, pixels: null, pixelsMotif: null })), 400);
    verifier('pas de pixels mais mime déclaré : 400', statut(msg({ pixels: null, pixelsMotif: 'canvas-protege' })), 400);
    verifier('imageMotif inconnu : 400', statut(sansPixels({ imageMotif: 'autre', imageSrc: '', idProduct: null })), 400);
    verifier('imageMotif « image-du-produit-introuvable » : accepté sans image ni adresse d\'image', statut(sansPixels({ imageMotif: 'image-du-produit-introuvable', pixelsMotif: 'aucune-image', imageSrc: '', idProduct: null })), 200);
    verifier('imageMotif avec des pixels : 400', statut(msg({ imageMotif: 'image-du-produit-introuvable', imageSrc: '' })), 400);
    verifier('imageMotif avec une adresse d\'image : 400', statut(sansPixels({ imageMotif: 'image-du-produit-introuvable', pixelsMotif: 'aucune-image' })), 400);
    verifier('motif inconnu : 400', statut(sansPixels({ pixelsMotif: 'autre' })), 400);
    for (const mo of ['canvas-protege', 'image-non-chargee', 'aucune-image', 'trop-volumineuse']) verifier(`motif « ${mo} » accepté`, statut(sansPixels({ pixelsMotif: mo })), 200);
    verifier('idProduct non entier : 400', statut(msg({ idProduct: '894262' })), 400);
    verifier('idProduct null accepté', statut(msg({ idProduct: null })), 200);
    verifier('imageSrc non https : 400', statut(msg({ imageSrc: 'http://x.test/a.jpg' })), 400);
    verifier('titre trop long : 400', statut(msg({ titre: 'x'.repeat(301) })), 400);
    verifier('dimensions négatives : 400', statut(msg({ w: -1 })), 400);

    // ── reconnaissance
    const rec = R.reconnaitre(URL_V2);
    verifier('reconnaître : V2 de la paire #1, tampon attendu', [rec.n, rec.v, rec.tampon, rec.set], [1, 'V2', LISTE[0].tampon, LISTE[0].set]);
    verifier('reconnaître : la langue ne compte pas (/fr/)', R.reconnaitre(URL_V2.replace('/en/', '/fr/')).v, 'V2');
    verifier('reconnaître : hors liste → null', R.reconnaitre(URL_HORS), null);
    verifier('les 128 adresses de la liste sont reconnues', LISTE.flatMap(p => p.versions).every(v => R.reconnaitre(v.url)), true);

    // ── garde du dossier d'écriture
    const refus = async (dossier, racine) => { try { await R.demarrer({ port: 0, dossier, racine }); return null; } catch (e) { return e.message; } };
    verifier('dossier hors de la racine autorisée : refusé', /racine/.test(await refus(path.join(dossierTmp, '..', 'hors-racine-cmf'), dossierTmp) || ''), true);
    verifier('dossier dans le dépôt : refusé', /dépôt/.test(await refus(path.join(__dirname, 'sous-dossier-test'), __dirname) || ''), true);
    verifier('dossier d\'apports manuels (nom « apport-manuel » sous la racine du banc) : refusé', /apports manuels/.test(await refus(path.join(dossierTmp, 'apport-manuel'), dossierTmp) || ''), true);
    verifier('la racine par défaut est celle du chantier, le dossier par défaut est cardmarket-passif', [R.RACINE_AUTORISEE, R.DOSSIER_DEFAUT], ['C:\\Users\\Yung\\rat-market-travail\\catalogue', 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\cardmarket-passif']);

    // ── HTTP
    const journal = [];
    const srv = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierTmp, journal: m => journal.push(m) });
    const port = srv.port;
    try {
        verifier('le serveur écoute 127.0.0.1 seul', srv.adresse, '127.0.0.1');
        verifier('port par défaut 8768 (≠ 8765, 8766, 8767)', R.PORT_DEFAUT, 8768);
        verifier('origine attendue : https://www.cardmarket.com', R.ORIGINE_ATTENDUE, 'https://www.cardmarket.com');

        let m1 = msg();
        let r = await envoyer(port, { entetes: BON, corps: m1 });
        verifier('relevé valide SANS Origin : 200, paire reconnue (#1, V1, tampon), 1 sur 128', [r.status, r.json?.ok, r.json?.paire?.n, r.json?.paire?.version, r.json?.paire?.tamponAttendu, r.json?.horsDesSoixanteQuatre, r.json?.relevees, r.json?.sur], [200, true, 1, 'V1', LISTE[0].tampon, false, 1, 128]);
        verifier('… un .json et l\'image décodée à côté (même nom), rien d\'autre', fichiers().map(f => path.extname(f)), ['.json', '.png']);
        const base = fichiers()[0].replace(/\.json$/, '');
        const lu = JSON.parse(fs.readFileSync(path.join(dossierTmp, base + '.json'), 'utf8'));
        verifier('.json : adresse, verdict, paire, sha256 de l\'image, pas de base64 dans le json', [lu.url, lu.verdictTesteur, lu.paire.n, lu.sha256 === crypto.createHash('sha256').update(png(1)).digest('hex'), 'pixels' in lu], [URL_V1, 'tampon-visible', 1, true, false]);
        verifier('image décodée octet pour octet', fs.readFileSync(path.join(dossierTmp, base + '.png')).equals(png(1)), true);
        verifier('le journal imprime la paire et le compte', journal.some(l => /1\/128|1 sur 128/.test(l)), true);

        // la même adresse, un second clic : un NOUVEAU relevé (paquet différent), le compte ne change pas
        r = await envoyer(port, { entetes: BON, corps: msg({ verdictTesteur: 'pas-de-tampon' }) });
        verifier('second relevé de la même adresse : 200, toujours 1 sur 128 (adresses distinctes), 4 fichiers', [r.status, r.json?.relevees, fichiers().length], [200, 1, 4]);
        r = await envoyer(port, { entetes: BON, corps: msg({ url: URL_V2, mime: 'image/jpeg', verdictTesteur: 'ne-sais-pas' }, jpg(3)) });
        verifier('V2 relevée (JPEG) : 2 sur 128, extension .jpg', [r.status, r.json?.paire?.version, r.json?.relevees, fichiers().filter(f => f.endsWith('.jpg')).length], [200, 'V2', 2, 1]);
        r = await envoyer(port, { entetes: BON, corps: msg({ url: URL_HORS }) });
        verifier('adresse hors des 64 : 200, marquée « hors des 64 », paire null, le compte ne bouge pas', [r.status, r.json?.paire, r.json?.horsDesSoixanteQuatre, r.json?.relevees], [200, null, true, 2]);
        r = await envoyer(port, { entetes: BON, corps: sansPixels() });
        verifier('canvas protégé : 200, un .json SANS image à côté', [r.status, fichiers().length], [200, 4 + 2 + 2 + 1]);

        // jamais d'écrasement : même paquet rejoué
        const rejeu = msg({ paquet: '20261017T130000Z-deadbeef' });
        await envoyer(port, { entetes: BON, corps: rejeu });
        const avant = fs.readdirSync(dossierTmp).map(f => [f, fs.readFileSync(path.join(dossierTmp, f)).toString('hex')]);
        r = await envoyer(port, { entetes: BON, corps: { ...rejeu, verdictTesteur: 'pas-de-tampon' } });
        const apres = fs.readdirSync(dossierTmp).map(f => [f, fs.readFileSync(path.join(dossierTmp, f)).toString('hex')]);
        verifier('même paquet rejoué : 409 et AUCUN fichier modifié ni ajouté', [r.status, JSON.stringify(apres) === JSON.stringify(avant)], [409, true]);

        // image rattachée : l'idProduct lu dans l'adresse de l'image doit être celui de l'adresse de la paire
        r = await envoyer(port, { entetes: BON, corps: msg() });
        verifier('image du bon produit : imageDiscordante false', [r.status, r.json?.imageDiscordante, r.json?.sansImageRattachee], [200, false, false]);
        r = await envoyer(port, { entetes: BON, corps: msg({ idProduct: V2.idProduct, imageSrc: `https://images-exemple.test/51/MEP/${V2.idProduct}/${V2.idProduct}.jpg` }) });
        const disc = fichiers().filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dossierTmp, f), 'utf8'))).find(j => j.fichierImage && r.json?.fichier && `${j.fichierImage}`.startsWith(r.json.fichier));
        verifier('image d\'un AUTRE produit (celui de la V2 sur l\'adresse V1) : relevé GARDÉ mais imageDiscordante true, réponse et json', [r.status, r.json?.imageDiscordante, disc?.imageDiscordante], [200, true, true]);
        r = await envoyer(port, { entetes: BON, corps: msg({ imageSrc: 'https://images-exemple.test/photo-sans-id.jpg' }) });
        verifier('adresse d\'image sans idProduct lisible, sur une paire de la liste : discordante', [r.status, r.json?.imageDiscordante], [200, true]);
        r = await envoyer(port, { entetes: BON, corps: msg({ url: URL_HORS, idProduct: 5, imageSrc: 'https://images-exemple.test/51/BS/5/5.jpg' }) });
        verifier('hors des 64 : jamais « discordante » (rien à recouper), marqué hors des 64', [r.status, r.json?.imageDiscordante, r.json?.horsDesSoixanteQuatre], [200, false, true]);
        r = await envoyer(port, { entetes: BON, corps: sansPixels({ imageMotif: 'image-du-produit-introuvable', pixelsMotif: 'aucune-image', imageSrc: '', idProduct: null, verdictTesteur: 'pas-de-tampon' }) });
        verifier('image du produit introuvable : relevé gardé, marqué « sans image rattachée »', [r.status, r.json?.sansImageRattachee, r.json?.imageDiscordante], [200, true, false]);

        // décodage borné
        r = await envoyer(port, { entetes: BON, corps: msg({}, fauxPng()) });
        verifier('PNG à l\'en-tête valide mais non décodable : 415 avec motif', [r.status, /décod/.test(r.json?.motif || '')], [415, true]);
        r = await envoyer(port, { entetes: BON, corps: msg({ w: IMG_W + 1 }) });
        verifier('largeur déclarée ≠ largeur décodée : 422', [r.status, /dimensions/.test(r.json?.motif || '')], [422, true]);
        r = await envoyer(port, { entetes: BON, corps: msg({ h: IMG_H + 1 }) });
        verifier('hauteur déclarée ≠ hauteur décodée : 422', r.status, 422);
        const vaste = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
        r = await envoyer(port, { entetes: BON, corps: msg({ w: 4000, h: 4000 }, vaste) });
        verifier('image au-delà de la limite de pixels (4000 × 4000) : 413, jamais décodée', [r.status, /pixels/.test(r.json?.motif || '')], [413, true]);
        verifier('la limite de pixels est exportée et vaut 12 millions', R.PIXELS_MAX, 12000000);
        r = await envoyer(port, { entetes: BON, corps: msg({ mime: 'image/jpeg' }, jpg(2)) });
        verifier('JPEG réel, mime jpeg : décodé, 200', r.status, 200);

        // corps > 4 Mo SANS Content-Length honnête : transfert par morceaux (chunked) — la garde « flux » doit couper
        const chunked = await new Promise(resolve => {
            const s = net.connect(port, '127.0.0.1', () => {
                s.write(`POST /releve HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nX-Rat-Market: ${R.VALEUR_MARQUE}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n`);
                const bloc = Buffer.alloc(1024 * 1024, 97);
                for (let i = 0; i < 6; i++) { s.write(`${bloc.length.toString(16)}\r\n`); s.write(bloc); s.write('\r\n'); }
                s.write('0\r\n\r\n');
            });
            let t = '';
            s.on('data', c => { t += c; });
            s.on('close', () => resolve(Number((/^HTTP\/1\.1 (\d{3})/.exec(t) || [])[1] || 0)));
            s.on('error', () => { });
            setTimeout(() => { s.destroy(); resolve(-1); }, 8000);
        });
        verifier('corps de 6 Mo en chunked (aucun Content-Length) : 413 par la garde de flux', chunked, 413);

        // refus
        const n0 = fichiers().length;
        const cas = [
            ['GET : 405', { methode: 'GET', entetes: BON }, 405],
            ['mauvais chemin : 404', { chemin: '/autre', entetes: BON, corps: msg() }, 404],
            ['chemin avec requête : 404', { chemin: '/releve?x=1', entetes: BON, corps: msg() }, 404],
            ['Origin d\'un autre site : 403', { entetes: { ...BON, Origin: 'https://evil.example' }, corps: msg() }, 403],
            ['Origin cardmarket mais sans le « www » : 403', { entetes: { ...BON, Origin: 'https://cardmarket.com' }, corps: msg() }, 403],
            ['en-tête fixe absent : 403', { entetes: sans(BON, 'X-Rat-Market'), corps: msg() }, 403],
            ['en-tête fixe faux : 403', { entetes: { ...BON, 'X-Rat-Market': 'non' }, corps: msg() }, 403],
            ['Content-Type text/plain : 415', { entetes: { ...BON, 'Content-Type': 'text/plain' }, corps: msg() }, 415],
            ['Host étranger : 403', { entetes: { ...BON, Host: 'evil.example' }, corps: msg() }, 403],
            ['clés en trop : 400', { entetes: BON, corps: msg({ extra: 1 }) }, 400],
            ['adresse d\'un autre hôte : 422', { entetes: BON, corps: msg({ url: 'https://evil.example/en/Pokemon/Products/Singles/A/B' }) }, 422],
            ['pixels qui ne sont pas une image : 415', { entetes: BON, corps: msg({}, Buffer.from('texte')) }, 415]
        ];
        for (const [nom, o, attendu] of cas) { r = await envoyer(port, o); verifier(`${nom}`, r.status, attendu); }
        r = await envoyer(port, { entetes: { ...BON, Origin: 'https://www.cardmarket.com' }, corps: msg() });
        verifier('Origin https://www.cardmarket.com : acceptée', r.status, 200);
        r = await envoyer(port, { entetes: { ...BON, Origin: 'chrome-extension://abcdefabcdefabcdef' }, corps: msg() });
        verifier('Origin d\'extension : tolérée', r.status, 200);
        verifier('les refus n\'ont écrit AUCUN fichier (seuls les 2 relevés acceptés ci-dessus en ont ajouté)', fichiers().length, n0 + 4);

        // taille
        // corps DÉCLARÉ trop gros : une socket brute, des en-têtes seulement (aucun corps de 4 Mo à pousser : un client qui écrit après la fermeture du serveur ferait un test instable)
        const declareGros = await new Promise(resolve => {
            const s = net.connect(port, '127.0.0.1', () => s.write(`POST /releve HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nX-Rat-Market: ${R.VALEUR_MARQUE}\r\nContent-Length: ${R.CORPS_MAX_OCTETS + 10}\r\nConnection: close\r\n\r\n`));
            let t = '';
            s.on('data', c => { t += c; });
            s.on('close', () => resolve(Number((/^HTTP\/1\.1 (\d{3})/.exec(t) || [])[1] || 0)));
            s.on('error', () => resolve(0));
        });
        verifier('corps déclaré au-delà de 4 Mo : 413', declareGros, 413);
        verifier('la borne est bien de 4 Mo', R.CORPS_MAX_OCTETS, 4 * 1024 * 1024);
        verifier('aucun chemin d\'écriture hors du dossier : les noms de fichiers sont <slug>--<paquet>', fichiers().every(f => /^[a-z0-9-]+--\d{8}T\d{6}Z-[a-f0-9]{8}\.(json|png|jpg)$/.test(f)), true);
        verifier('un slug piégé ne sort pas du dossier (jugerMessage refuse « .. »)', statut(msg({ url: 'https://www.cardmarket.com/en/Pokemon/Products/Singles/..%2F..%2Fx/y' })), 422);
    } finally { await srv.fermer(); }

    // plafond d'écriture
    const dossierPlein = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-cmf-plein-'));
    const s2 = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierPlein, maxReleves: 2, journal: () => { } });
    try {
        const a = await envoyer(s2.port, { entetes: BON, corps: msg() }), b = await envoyer(s2.port, { entetes: BON, corps: msg() }), c = await envoyer(s2.port, { entetes: BON, corps: msg() });
        verifier('plafond de relevés sur disque : le troisième est refusé (507)', [a.status, b.status, c.status], [200, 200, 507]);
    } finally { await s2.fermer(); }

    fs.rmSync(dossierTmp, { recursive: true, force: true });
    fs.rmSync(dossierPlein, { recursive: true, force: true });
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
