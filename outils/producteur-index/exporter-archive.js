'use strict';
// Ouvre une archive des visuels (.rmv) EXACTEMENT comme l'API l'ouvre (v2/chargeur : scellement HMAC verifie AVANT toute decompression, puis format.js) et l'exporte en JSON simple :
//   entrees.json    { chargeLe, n, entrees: [{ id, g, v, gw, gh, m, meta, set, num, lien }] }   g = cle du grand visuel, v = vignette, m = mention (autre tirage), meta = idMetacard
//   catalogue.json  { n, cat: [{ id, meta, exp, num, tir }] }                                  la colonne des jumeaux : TOUT le catalogue (produits avec ou sans visuel)
// Usage : node exporter-archive.js <archive.rmv> <dossier-de-sortie>
// Le secret HMAC (V2_VISUELS_HMAC) est lu dans l'environnement ; sinon dans le .env dont le CHEMIN est donne par V2_ENV_FICHIER. Il n'est JAMAIS imprime, ni dans un message d'erreur.
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..', '..');
const S = require(path.join(RACINE, 'v2', 'chargeur', 'scellement'));
const F = require(path.join(RACINE, 'v2', 'chargeur', 'format'));

async function ouvrir(fichier) {
    if (!process.env.V2_VISUELS_HMAC && process.env.V2_ENV_FICHIER) require(path.join(RACINE, 'node_modules', 'dotenv')).config({ path: process.env.V2_ENV_FICHIER, quiet: true });
    const hmac = process.env.V2_VISUELS_HMAC;
    if (!hmac) throw new Error('V2_VISUELS_HMAC absente (ni dans l\'environnement, ni dans le fichier V2_ENV_FICHIER)');
    return F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(fichier), hmac)));
}
module.exports = { ouvrir };

if (require.main === module) {
    (async () => {
        const [fichier, sortie] = process.argv.slice(2);
        if (!fichier || !sortie) { console.error('usage : node exporter-archive.js <archive.rmv> <dossier-de-sortie>'); process.exit(2); }
        const A = await ouvrir(fichier);
        const ids = Array.from(A.identifiants());
        const entrees = ids.map(id => { const e = A.entree(id); return { id, g: e.grande.cle, v: e.vignette.cle, gw: e.grande.w, gh: e.grande.h, m: e.mention, meta: e.idMetacard, set: e.setNom, num: e.numero, lien: e.lien }; });
        const jum = A.paquet().donnees.jum;
        if (!jum) throw new Error('l\'archive n\'a pas la colonne des jumeaux (catalogue complet)');
        const cat = []; for (let i = 0; i < jum.id.length; i++) cat.push({ id: jum.id[i], meta: jum.meta[i], exp: jum.exp[i], num: jum.num[i], tir: jum.tir[i] });
        fs.mkdirSync(sortie, { recursive: true });
        fs.writeFileSync(path.join(sortie, 'entrees.json'), JSON.stringify({ chargeLe: A.chargeLe, n: ids.length, entrees }));
        fs.writeFileSync(path.join(sortie, 'catalogue.json'), JSON.stringify({ n: cat.length, cat }));
        console.log(`entrees ${entrees.length} · visuels distincts ${new Set(entrees.map(e => e.g)).size} · catalogue ${cat.length} · chargeLe ${A.chargeLe}`);
    })().catch(e => { console.error('ERREUR', e && e.name, e && e.message); process.exit(1); });
}
