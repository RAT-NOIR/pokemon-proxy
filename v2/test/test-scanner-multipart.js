'use strict';
// B9.1 : le corps multipart du scanner. Aucune base : le module ne touche que le flux de la requête.
const { Readable } = require('stream');
const H = require('./_harnais');
const { lireMultipart } = require('../scanner/multipart');

const B = 'xXboundaryXx';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(100, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(100, 7)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 '), Buffer.alloc(100, 7)]);
const heic = marque => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.from(marque), Buffer.alloc(100, 7)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 7)]);

function partie(nom, contenu, { fichier, type, b = B } = {}) {
    const tete = `--${b}\r\nContent-Disposition: form-data; name="${nom}"${fichier !== undefined ? `; filename="${fichier}"` : ''}\r\n` +
        (type ? `Content-Type: ${type}\r\n` : '') + '\r\n';
    return Buffer.concat([Buffer.from(tete), Buffer.isBuffer(contenu) ? contenu : Buffer.from(String(contenu)), Buffer.from('\r\n')]);
}
const fin = (b = B) => Buffer.from(`--${b}--\r\n`);
// Fausse requête : un flux lisible + ses en-têtes. `lus` compte les octets réellement tirés du flux.
function requete(corps, { entetes = {}, ct = `multipart/form-data; boundary=${B}`, cl = true } = {}) {
    const etat = { lus: 0 };
    const morceaux = Buffer.isBuffer(corps) ? Array.from({ length: Math.ceil(corps.length / 65536) || 1 }, (_, i) => corps.subarray(i * 65536, (i + 1) * 65536)) : corps;
    const req = Readable.from((function* () { for (const m of morceaux) { etat.lus += m.length; yield m; } })(), { objectMode: false });
    req.headers = { ...(ct ? { 'content-type': ct } : {}), ...(cl && Buffer.isBuffer(corps) ? { 'content-length': String(corps.length) } : {}), ...entetes };
    req.etat = etat;
    return req;
}
async function essayer(req, opts) { try { return { ok: await lireMultipart(req, opts) }; } catch (e) { return { err: e }; } }
const forme = r => r.err ? [r.err.code, r.err.detail, r.err.statut] : ['ok'];
const corpsOk = (img, src = 'camera', extra = Buffer.alloc(0)) => Buffer.concat([partie('source', src), partie('image', img, { fichier: 'a.jpg', type: 'image/jpeg' }), extra, fin()]);

(async () => {
    // (1) formats acceptés
    let r = await essayer(requete(corpsOk(JPEG)));
    H.v('JPEG + source=camera : ok', r.ok && [r.ok.champs.source, r.ok.image.type, r.ok.image.buffer.equals(JPEG)], ['camera', 'image/jpeg', true]);
    r = await essayer(requete(corpsOk(PNG, 'fichier')));
    H.v('PNG + source=fichier : ok', r.ok && [r.ok.champs.source, r.ok.image.type], ['fichier', 'image/png']);
    r = await essayer(requete(corpsOk(WEBP, 'collage')));
    H.v('WebP + source=collage : ok', r.ok && [r.ok.champs.source, r.ok.image.type], ['collage', 'image/webp']);
    for (const m of ['heic', 'heix', 'mif1']) {
        r = await essayer(requete(corpsOk(heic(m))));
        H.v(`HEIC (${m}) jugé sur ses octets : ok (le décodage relève de B9.2)`, r.ok && r.ok.image.type, 'image/heic');
    }
    r = await essayer(requete(corpsOk(heic('avif'))));
    H.v('ftyp d\'une autre marque (avif) : 415 format', forme(r), ['IMAGE', 'format', 415]);

    // (2) > 12 Mo : 413 et la lecture s'arrête
    const gros = [], MORCEAU = Buffer.alloc(65536, 1);
    for (let i = 0; i < 800; i++) gros.push(MORCEAU);               // 800 x 64 Kio = 50 Mio
    const reqGros = requete(gros, { cl: false });
    r = await essayer(reqGros);
    H.v('50 Mo sans Content-Length : 413 trop-lourde', forme(r), ['IMAGE', 'trop-lourde', 413]);
    H.vrai(`la lecture s'arrête au dépassement : ${reqGros.etat.lus} octets lus sur 52428800 (< 13 Mo)`, reqGros.etat.lus < 13 * 1024 * 1024);
    // un corps juste sous la limite passe, juste au-dessus échoue (limite paramétrable)
    r = await essayer(requete(corpsOk(JPEG)), { octetsMax: 50 });
    H.v('octetsMax=50 sur un corps plus gros : 413', forme(r), ['IMAGE', 'trop-lourde', 413]);

    // (9) Content-Length annoncé trop grand : refus AVANT toute lecture
    const reqCl = requete(gros, { entetes: { 'content-length': String(13 * 1024 * 1024) } });
    r = await essayer(reqCl);
    H.v('Content-Length 13 Mo : 413 trop-lourde', forme(r), ['IMAGE', 'trop-lourde', 413]);
    H.v('   aucun octet lu avant le refus', reqCl.etat.lus, 0);
    r = await essayer(requete(corpsOk(JPEG), { entetes: { 'content-length': 'abc' } }));
    H.v('Content-Length illisible : 400', forme(r), ['ENTREE', 'content-length', 400]);

    // (3) on juge les octets, pas l'en-tête
    r = await essayer(requete(Buffer.concat([partie('source', 'camera'), partie('image', EXE, { fichier: 'a.jpg', type: 'image/jpeg' }), fin()])));
    H.v('type annoncé image/jpeg, octets d\'exécutable : 415 format', forme(r), ['IMAGE', 'format', 415]);
    r = await essayer(requete(Buffer.concat([partie('source', 'camera'), partie('image', JPEG, { type: 'application/octet-stream' }), fin()])));
    H.v('type annoncé quelconque, octets JPEG : ok', r.ok && r.ok.image.type, 'image/jpeg');

    // (4) source
    for (const s of ['', 'CAMERA', 'url', 'camera ']) {
        r = await essayer(requete(corpsOk(JPEG, s)));
        H.v(`source=${JSON.stringify(s)} : 400`, forme(r), ['ENTREE', 'source', 400]);
    }
    r = await essayer(requete(Buffer.concat([partie('image', JPEG), fin()])));
    H.v('source absente : 400', forme(r), ['ENTREE', 'source', 400]);
    r = await essayer(requete(corpsOk(JPEG, 'camera', partie('source', 'fichier'))));
    H.v('deux parties source : 400', forme(r), ['ENTREE', 'source-en-double', 400]);
    r = await essayer(requete(corpsOk(JPEG, 'camera', partie('autre', 'x'))));
    H.v('champ inconnu : 400', forme(r), ['ENTREE', 'champ-inconnu', 400]);

    // (5) boundary et structure : 400, sans exception non structurée
    const ok = corpsOk(JPEG);
    r = await essayer(requete(ok, { ct: 'multipart/form-data' }));
    H.v('boundary absente : 400', forme(r), ['ENTREE', 'boundary', 400]);
    r = await essayer(requete(ok, { ct: null }));
    H.v('Content-Type absent : 400', forme(r), ['ENTREE', 'boundary', 400]);
    r = await essayer(requete(ok, { ct: `multipart/form-data; boundary=${B}; boundary=autre` }));
    H.v('boundary en double : 400', forme(r), ['ENTREE', 'boundary', 400]);
    r = await essayer(requete(ok, { ct: 'multipart/form-data; boundary=' + 'a'.repeat(71) }));
    H.v('boundary de 71 caractères : 400', forme(r), ['ENTREE', 'boundary', 400]);
    r = await essayer(requete(ok, { ct: 'application/json; boundary=' + B }));
    H.v('Content-Type non multipart : 400', forme(r), ['ENTREE', 'boundary', 400]);
    r = await essayer(requete(ok.subarray(0, ok.length - fin().length)));
    H.v('sans fermeture : 400', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(Buffer.concat([ok, Buffer.from('trailing')])));
    H.v('octets après la fermeture : 400', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(Buffer.concat([Buffer.from('prefixe\r\n'), ok])));
    H.v('préambule avant la première boundary : 400', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="source"\r\n\r\ncamera\r\n--${B}XX\r\n`)));
    H.v('délimiteur suivi de caractères inattendus : 400', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(Buffer.concat([Buffer.from(`--${B}\r\nX-Rien: 1\r\n\r\nabc\r\n`), fin()])));
    H.v('partie sans Content-Disposition name : 400', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(Buffer.from('n\'importe quoi')));
    H.v('corps qui n\'est pas du multipart : 400', forme(r), ['ENTREE', 'multipart', 400]);

    // (6) deux parties image
    r = await essayer(requete(corpsOk(JPEG, 'camera', partie('image', PNG))));
    H.v('deux parties image : 400', forme(r), ['ENTREE', 'image-en-double', 400]);

    // (7) corps vide / pas d'image
    r = await essayer(requete(Buffer.alloc(0)));
    H.v('corps vide : 422 aucune-carte', forme(r), ['IMAGE', 'aucune-carte', 422]);
    r = await essayer(requete(Buffer.concat([partie('source', 'camera'), fin()])));
    H.v('multipart sans partie image : 422 aucune-carte', forme(r), ['IMAGE', 'aucune-carte', 422]);
    r = await essayer(requete(Buffer.concat([partie('source', 'camera'), partie('image', Buffer.alloc(0), { fichier: 'a.jpg' }), fin()])));
    H.v('partie image vide : 422 aucune-carte', forme(r), ['IMAGE', 'aucune-carte', 422]);

    // (8) le nom de fichier n'est jamais utilisé
    const fs = require('fs'); const orig = { w: fs.writeFileSync, c: fs.createWriteStream, o: fs.openSync };
    let touche = 0; fs.writeFileSync = () => { touche++; }; fs.createWriteStream = () => { touche++; throw new Error('non'); }; fs.openSync = () => { touche++; throw new Error('non'); };
    r = await essayer(requete(Buffer.concat([partie('source', 'camera'), partie('image', JPEG, { fichier: '../../x', type: 'image/jpeg' }), fin()])));
    Object.assign(fs, { writeFileSync: orig.w, createWriteStream: orig.c, openSync: orig.o });
    H.vrai('nom de fichier "../../x" : lecture ok', r.ok);
    H.v('   aucun accès au système de fichiers', touche, 0);
    H.vrai('   le résultat ne porte aucune trace du nom', r.ok && !JSON.stringify(r.ok).includes('..') && !('fichier' in r.ok.image) && !('filename' in r.ok.image));
    H.v('   forme du résultat', r.ok && [Object.keys(r.ok).sort(), Object.keys(r.ok.image).sort()], [['champs', 'image'], ['buffer', 'type']]);

    // flux interrompu
    const coupee = new Readable({ read() { this.destroy(new Error('reset')); } }); coupee.headers = { 'content-type': `multipart/form-data; boundary=${B}` };
    r = await essayer(coupee);
    H.v('connexion coupée : 400 corps-interrompu', forme(r), ['ENTREE', 'corps-interrompu', 400]);

    // frontières de taille : l'IMAGE ≤ 12 Mo pile ; le CORPS ≤ 12 Mo + 64 Kio
    const MO12 = 12 * 1024 * 1024, MARGE = 64 * 1024;
    const jpegDe = n => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(n - 4, 9)]);
    r = await essayer(requete(corpsOk(jpegDe(MO12))));
    H.v('image de 12 Mo pile : acceptée', r.ok && r.ok.image.buffer.length, MO12);
    r = await essayer(requete(corpsOk(jpegDe(MO12 + 1))));
    H.v('image de 12 Mo + 1 : 413 trop-lourde', forme(r), ['IMAGE', 'trop-lourde', 413]);
    const reqPlafond = requete(corpsOk(jpegDe(MO12 + MARGE + 1)), { cl: false });
    r = await essayer(reqPlafond);
    H.v('corps au-delà de 12 Mo + 64 Kio (sans Content-Length) : 413', forme(r), ['IMAGE', 'trop-lourde', 413]);
    H.vrai(`   lecture arrêtée : ${reqPlafond.etat.lus} octets lus (< 12 Mo + 64 Kio + un morceau)`, reqPlafond.etat.lus <= MO12 + MARGE + 65536);
    r = await essayer(requete(corpsOk(jpegDe(100)), { entetes: { 'content-length': String(MO12 + MARGE + 1) } }));
    H.v('Content-Length de 12 Mo + 64 Kio + 1 : 413 avant lecture', forme(r), ['IMAGE', 'trop-lourde', 413]);

    // PARTIES_MAX : 9 parties refusées, 8 passent le compteur
    const parts = n => Buffer.concat([partie('source', 'camera'), partie('image', JPEG), ...Array.from({ length: n - 2 }, () => partie('x', 'y')), fin()]);
    r = await essayer(requete(parts(9)));
    H.v('9 parties : 400 multipart', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(parts(8)));
    H.v('8 parties : passe le compteur (refusée plus loin, champ inconnu)', forme(r), ['ENTREE', 'champ-inconnu', 400]);

    // boundary entre guillemets
    r = await essayer(requete(corpsOk(JPEG), { ct: `multipart/form-data; boundary="${B}"` }));
    H.v('boundary entre guillemets : ok', r.ok && r.ok.image.type, 'image/jpeg');

    // un \r\n-- dans les octets de l'image n'est pas un délimiteur tant que ce n'est pas LE délimiteur
    const piege = Buffer.concat([JPEG, Buffer.from('\r\n--'), Buffer.from('\r\n--xXbound'), Buffer.from([0, 0, 0]), Buffer.from('--\r\n'), JPEG]);
    r = await essayer(requete(corpsOk(piege)));
    H.v('"\\r\\n--" et un début de délimiteur dans l\'image : octets intacts', r.ok && r.ok.image.buffer.equals(piege), true);
    r = await essayer(requete(corpsOk(Buffer.concat([JPEG, Buffer.from(`\r\n--${B}`), JPEG]))));
    H.vrai('le vrai délimiteur dans les octets coupe la partie : refus structuré 400, jamais un faux accord', r.err && r.err.statut === 400);

    // octets nuls
    r = await essayer(requete(corpsOk(Buffer.concat([JPEG, Buffer.alloc(50, 0)]))));
    H.v('image contenant des octets nuls : ok', r.ok && r.ok.image.buffer.length, JPEG.length + 50);
    r = await essayer(requete(corpsOk(JPEG, 'camera\u0000')));
    H.v('source terminée par un octet nul : 400 source', forme(r), ['ENTREE', 'source', 400]);
    r = await essayer(requete(corpsOk(JPEG, 'came\u0000ra')));
    H.v('source avec un nul au milieu : 400 source', forme(r), ['ENTREE', 'source', 400]);
    r = await essayer(requete(Buffer.concat([partie('source', 'camera'), partie('image\u0000', JPEG), fin()])));
    H.v('nom de partie "image\\0" : 400 champ inconnu', forme(r), ['ENTREE', 'champ-inconnu', 400]);

    // Content-Length incohérent avec le corps
    const cOk = corpsOk(JPEG);
    r = await essayer(requete(cOk, { entetes: { 'content-length': String(cOk.length + 10) } }));
    H.v('Content-Length plus grand que le corps reçu : 400', forme(r), ['ENTREE', 'content-length', 400]);
    r = await essayer(requete(cOk, { entetes: { 'content-length': String(cOk.length - 10) } }));
    H.v('Content-Length plus petit que le corps reçu : 400', forme(r), ['ENTREE', 'content-length', 400]);
    const reqCourt = requete(gros, { entetes: { 'content-length': '100' } });
    r = await essayer(reqCourt);
    H.v('Content-Length 100 pour un flux plus gros : 400, lecture arrêtée très tôt (< 1 Mo lu)', [forme(r), reqCourt.etat.lus < 1024 * 1024], [['ENTREE', 'content-length', 400], true]);
    r = await essayer(requete(cOk, { entetes: { 'content-length': String(cOk.length) } }));
    H.v('Content-Length exact : ok', r.ok && r.ok.image.type, 'image/jpeg');

    // paramètres entre guillemets : un `name=` dans un filename n'est pas un paramètre
    const brut = disp => Buffer.concat([partie('source', 'camera'), Buffer.from(`--${B}\r\nContent-Disposition: ${disp}\r\n\r\n`), JPEG, Buffer.from('\r\n'), fin()]);
    r = await essayer(requete(brut('form-data; filename="a; name=\\"source\\""; name="image"')));
    H.v('filename contenant "; name=" échappé : la partie reste image', r.ok && r.ok.image.type, 'image/jpeg');
    r = await essayer(requete(brut('form-data; filename="x; name="source"; name="image"')));
    H.v('filename mal fermé laissant voir un name= : 400 (pas de lecture du faux name)', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(brut('form-data; name="image" intrus')));
    H.v('texte illisible après un paramètre : 400', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(brut('form-data; name="image"; ???')));
    H.v('paramètre mal formé : 400', forme(r), ['ENTREE', 'multipart', 400]);
    r = await essayer(requete(brut('form-data; name="image"; name="source"')));
    H.v('name en double : 400', forme(r), ['ENTREE', 'multipart', 400]);

    // échéance de lecture : horloge injectée, aucune attente réelle
    const minuterie = { cbs: [], effaces: 0, set(f, ms) { this.ms = ms; this.cbs.push(f); return this.cbs.length; }, clear() { this.effaces++; } };
    const lent = new Readable({ read() { } }); lent.headers = { 'content-type': `multipart/form-data; boundary=${B}` };
    const enCours = essayer(lent, { minuterie });
    lent.push(Buffer.from('--x'));                                   // un client qui goutte
    await new Promise(res => setImmediate(res));
    H.v('délai de lecture par défaut', minuterie.ms, 30000);
    minuterie.cbs[0]();                                               // l'échéance tombe
    r = await enCours;
    H.v('client lent : rejet structuré 408 délai', forme(r), ['ENTREE', 'delai', 408]);
    H.vrai('   le module ne détruit rien : c\'est au handler de répondre puis fermer', !lent.destroyed);
    H.vrai('   l\'erreur porte l\'indication de fermeture (fermer: true)', r.err && r.err.fermer === true);
    r = await essayer(requete(corpsOk(JPEG, 'zzz')));
    H.vrai('   une erreur ordinaire ne demande pas la fermeture', r.err && !r.err.fermer);

    // contrat avec un VRAI serveur : un client lent reçoit le 408 + Connection: close, puis la socket se ferme
    const net = require('net');
    const srvLent = await H.serveur(async (req, res) => {
        try { await lireMultipart(req, { delaiMs: 300 }); res.end('ok'); }
        catch (e) {
            res.statusCode = e.statut; res.setHeader('content-type', 'application/json');
            if (e.fermer) { res.setHeader('Connection', 'close'); res.on('finish', () => req.destroy()); }
            res.end(JSON.stringify({ code: e.code, detail: e.detail }));
        }
    });
    const reponse = await new Promise(resolve => {
        const s = net.connect(Number(new URL(srvLent.url).port), '127.0.0.1');
        let recu = '', ferme = false; const t0 = Date.now();
        s.on('connect', () => { s.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=${B}\r\nContent-Length: 5000\r\n\r\n--${B}`); });
        const goutte = setInterval(() => { if (!s.destroyed) s.write('x'); }, 100);   // un octet toutes les 100 ms
        s.on('data', d => { recu += d.toString('latin1'); });
        s.on('close', () => { ferme = true; clearInterval(goutte); resolve({ recu, ferme, ms: Date.now() - t0 }); });
        s.on('error', () => { });
        setTimeout(() => { clearInterval(goutte); if (!ferme) { s.destroy(); } }, 4000);
    });
    H.vrai('client lent, vrai serveur : la réponse HTTP 408 est bien reçue (pas un reset)', /^HTTP\/1\.1 408 /.test(reponse.recu));
    H.vrai('   avec Connection: close', /connection: close/i.test(reponse.recu));
    H.vrai(`   le corps structuré est lisible, puis la socket se ferme (${reponse.ms} ms)`, /"detail":"delai"/.test(reponse.recu) && reponse.ms < 3500);
    await srvLent.fermer();

    // mineurs : espace final de Content-Disposition, guillemet échappé dans le nom
    r = await essayer(requete(brut('form-data; name="image"  ')));
    H.v('espace final après Content-Disposition : toléré', r.ok && r.ok.image.type, 'image/jpeg');
    r = await essayer(requete(Buffer.concat([partie('source', 'camera'), partie('image\\"', JPEG), fin()])));
    H.v('nom de partie avec \\" : 400 champ inconnu (jamais pris pour "image")', forme(r), ['ENTREE', 'champ-inconnu', 400]);
    minuterie.effaces = 0;
    r = await essayer(requete(corpsOk(JPEG)), { minuterie });
    H.vrai('lecture normale : l\'échéance est effacée', r.ok && minuterie.effaces >= 1);

    // de bout en bout par un vrai serveur HTTP et le FormData de Node
    const srv = await H.serveur(async (req, res) => {
        let sortie; try { const m = await lireMultipart(req); sortie = { s: 200, j: { source: m.champs.source, type: m.image.type, n: m.image.buffer.length } }; }
        catch (e) { sortie = { s: e.statut, j: { code: e.code, detail: e.detail } }; }
        res.statusCode = sortie.s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(sortie.j));
    });
    const fd = new FormData(); fd.append('source', 'camera'); fd.append('image', new Blob([JPEG], { type: 'image/jpeg' }), '../../x.jpg');
    let rep = await fetch(srv.url, { method: 'POST', body: fd });
    H.v('vrai serveur + FormData : 200', [rep.status, await rep.json()], [200, { source: 'camera', type: 'image/jpeg', n: JPEG.length }]);
    const fd2 = new FormData(); fd2.append('source', 'camera'); fd2.append('image', new Blob([EXE], { type: 'image/jpeg' }), 'a.jpg');
    rep = await fetch(srv.url, { method: 'POST', body: fd2 });
    H.v('vrai serveur + exécutable déguisé : 415', [rep.status, await rep.json()], [415, { code: 'IMAGE', detail: 'format' }]);
    await srv.fermer();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
