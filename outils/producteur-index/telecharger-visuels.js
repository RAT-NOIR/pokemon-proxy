'use strict';
// Telecharge les visuels (grande.cle) depuis NOTRE bucket public de visuels (GET sans cle), 4 requetes a la fois au plus, reprise (un fichier deja la n'est jamais retelecharge).
//   VOISINS_HOTE_VISUELS=<hote>.r2.dev node telecharger-visuels.js <liste.json> <dossier-images>
// liste = tableau de cles ; sortie : <dossier>/<sha1(cle)>.webp (ecrit en .part puis renomme). Aucun secret : lecture publique de notre propre bucket.
const fs = require('fs'), path = require('path'), https = require('https'), crypto = require('crypto');
const HOTE = process.env.VOISINS_HOTE_VISUELS;
const [listeChemin, IMG] = process.argv.slice(2);
if (!HOTE || !listeChemin || !IMG) { console.error('usage : VOISINS_HOTE_VISUELS=<hote> node telecharger-visuels.js <liste.json> <dossier-images>'); process.exit(2); }
fs.mkdirSync(IMG, { recursive: true });
const nomDe = cle => crypto.createHash('sha1').update(cle).digest('hex') + '.webp';
const get = cle => new Promise((ok, ko) => {
    const req = https.get({ host: HOTE, path: '/' + cle.split('/').map(encodeURIComponent).join('/'), timeout: 30000 }, r => {
        if (r.statusCode !== 200) { r.resume(); return ko(new Error('http ' + r.statusCode)); }
        const b = []; r.on('data', d => b.push(d)); r.on('end', () => ok(Buffer.concat(b)));
    });
    req.on('timeout', () => req.destroy(new Error('delai'))); req.on('error', ko);
});
(async () => {
    const liste = JSON.parse(fs.readFileSync(listeChemin, 'utf8'));
    const aFaire = liste.filter(c => !fs.existsSync(path.join(IMG, nomDe(c))));
    console.log(`liste ${liste.length} · deja la ${liste.length - aFaire.length} · a telecharger ${aFaire.length}`);
    let i = 0, ok = 0, ko = 0, octets = 0; const t0 = Date.now(); const erreurs = [];
    async function fil() {
        while (i < aFaire.length) {
            const cle = aFaire[i++];
            let err = null;
            for (let essai = 0; essai < 3; essai++) {
                try { const b = await get(cle); fs.writeFileSync(path.join(IMG, nomDe(cle) + '.part'), b); fs.renameSync(path.join(IMG, nomDe(cle) + '.part'), path.join(IMG, nomDe(cle))); octets += b.length; ok++; err = null; break; }
                catch (e) { err = e.message; await new Promise(r => setTimeout(r, 1500 * (essai + 1))); }
            }
            if (err) { ko++; erreurs.push({ cle, erreur: err }); }
            await new Promise(r => setTimeout(r, 40));
            if ((ok + ko) % 500 === 0) console.log(`${ok + ko}/${aFaire.length} · ok ${ok} · erreurs ${ko} · ${(octets / 1048576).toFixed(0)} Mo · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
    }
    await Promise.all([fil(), fil(), fil(), fil()]);
    if (erreurs.length) fs.writeFileSync(path.join(IMG, '..', 'telechargement-erreurs.json'), JSON.stringify(erreurs));
    console.log(`fini : ok ${ok} · erreurs ${ko} · ${(octets / 1048576).toFixed(0)} Mo · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
