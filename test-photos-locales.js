// Banc de verrou/photos-locales.js : une photo du jeu fixe est servie depuis le disque, une photo hors du jeu rend un 404 LOCAL, et
// aucun des deux n'atteint le réseau ; un autre hôte passe au `fetch` d'origine. Le `fetch` d'origine est un ESPION : s'il est appelé
// pour une photo, le banc échoue. Aucune requête réelle. Requiert le jeu (node verrou/constituer-photos.js --ecrire).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const appels = [];
globalThis.fetch = async (u) => { appels.push(String(u)); return new Response('espion', { status: 200 }); };
const P = require('./verrou/photos-locales');
const idx = P.lireIndex();
const urls = Object.keys(idx.photos);
const journal = { log: () => {} };
const J = P.installer({ journal, etiquette: 'banc' });
const cas = [
    ['le jeu n\'est pas vide', async () => assert.ok(urls.length > 0, 'jeu vide : lancer verrou/constituer-photos.js --ecrire')],
    ['une photo du jeu : 200, les octets du fichier, sans réseau', async () => {
        const u = urls[0], r = await fetch(u);
        assert.strictEqual(r.status, 200);
        const b = Buffer.from(await r.arrayBuffer());
        assert.strictEqual(crypto.createHash('sha256').update(b).digest('hex'), idx.photos[u].sha256);
        assert.strictEqual(appels.length, 0);
    }],
    ['une photo hors du jeu (vinted.net) : 404 local, sans réseau', async () => {
        const r = await fetch('https://images1.vinted.net/t/hors-du-jeu/f800/x.webp?s=1');
        assert.strictEqual(r.status, 404); assert.strictEqual(appels.length, 0);
    }],
    ['un sous-domaine vinted.net hors du jeu : 404 local', async () => {
        const r = await fetch('https://autre.images.vinted.net/x.jpg');
        assert.strictEqual(r.status, 404); assert.strictEqual(appels.length, 0);
    }],
    ['un objet Request vers une photo du jeu : servi', async () => {
        const r = await fetch(new Request(urls[0]));
        assert.strictEqual(r.status, 200); assert.strictEqual(appels.length, 0);
    }],
    ['un autre hôte passe au fetch d\'origine', async () => {
        const r = await fetch('https://exemple.invalid/x');
        assert.strictEqual(await r.text(), 'espion'); assert.deepStrictEqual(appels, ['https://exemple.invalid/x']);
    }],
    ['un hôte qui CONTIENT vinted.net sans l\'être n\'est pas une photo', async () => {
        appels.length = 0;
        await fetch('https://vinted.net.exemple.invalid/x');
        assert.strictEqual(appels.length, 1);
    }],
    ['aPhoto et l\'empreinte du jeu', async () => {
        assert.ok(J.aPhoto(urls[0])); assert.ok(!J.aPhoto('https://images1.vinted.net/absente'));
        assert.match(J.empreinte, /^[0-9a-f]{16}$/); assert.strictEqual(J.n, urls.length);
    }],
    ['l\'empreinte du jeu change si une photo change', async () => {
        const autre = { ...idx.photos, [urls[0]]: { ...idx.photos[urls[0]], sha256: '0'.repeat(64) } };
        assert.notStrictEqual(P.empreinteJeu(autre), P.empreinteJeu(idx.photos));
    }],
    ['la liste des hôtes photo est celle de departage-image.js', async () => {
        const { HOTES_PHOTO_AUTORISES } = require('./departage-image');
        assert.deepStrictEqual(P.HOTES_PHOTO.map(r => r.toString()), HOTES_PHOTO_AUTORISES.map(r => r.toString()));
    }],
    ['le dossier des photos n\'est pas commité', async () => {
        assert.ok(/^verrou\/photos\/$/m.test(fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8')));
    }],
];
(async () => {
    let ok = 0;
    for (const [nom, f] of cas) { try { await f(); ok++; console.log(`  ✅ ${nom}`); } catch (e) { console.log(`  🔴 ${nom} : ${e.message}`); } }
    console.log(`${ok}/${cas.length}`);
    if (ok !== cas.length) process.exit(1);
})();
