'use strict';
// GUICHET (passage 8) — CALIBRATION de la 3e concordance (zone SOUPLE du catalogue : pHash <= 6 ET ORB >= 30 ; catalogue collecte-cartes/concordance-image.js SEUIL_SOUPLE ; strict : pHash <= 2 ET ORB >= 40)
// sur des paires dont la vérité est LUE À L'ŒIL (e12-calib.json : champ `eye` « same » / « differ »), paires prises dans ech-*.json ; images lues sur le bucket PUBLIC R2 (outil réparé). Elle doit savoir dire NON.
const fs = require('fs'), path = require('path');
const T8 = require('./t8-preuve2');
const { API } = require('C:\\Users\\Yung\\rat-market-travail\\api\\atlas\\garde-secrets');
const D = require(path.join(API, 'departage-image.js'));
const calib = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, 'e12-calib.json'), 'utf8')).map(x => [x.id, x]));
(async () => {
    const { cv } = await D.outils();
    const paires = new Map();
    for (const f of ['ech-meme.json', 'ech-different.json', 'ech-indec.json', 'ech-soeurMeme.json', 'ech-soeurDiff.json']) for (const x of JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'))) paires.set(x.a + '|' + x.b, x);
    const res = [];
    for (const x of paires.values()) {
        const c = calib.get(x.id); if (!c || !['same', 'differ'].includes(c.eye) || x.a === x.b) continue;
        const A = await T8.lire(x.a), B = await T8.lire(x.b); if (!A || !B) { res.push({ id: x.id, eye: c.eye, manque: true }); continue; }
        const ph = T8.ham(await T8.phash(A), await T8.phash(B));
        const da = await D.decrire(A), db = await D.decrire(B);
        res.push({ id: x.id, tag: x.tag, eye: c.eye, ph, orbPlein: da && db ? D.inliers(cv, da, db) : null });
    }
    const mesures = res.filter(r => !r.manque && r.orbPlein !== null);
    fs.writeFileSync(path.join(__dirname, 't6-calib3.json'), JSON.stringify(res));
    console.log('paires étiquetées à l\'œil', res.length, 'mesurées', mesures.length, 'manquantes', res.filter(r => r.manque).length);
    const same = mesures.filter(r => r.eye === 'same'), diff = mesures.filter(r => r.eye === 'differ');
    console.log('dont même dessin', same.length, 'dessin différent', diff.length);
    const S = { 'souple (pHash<=6 ET ORB>=30)': r => r.ph <= 6 && r.orbPlein >= 30, 'strict (pHash<=2 ET ORB>=40)': r => r.ph <= 2 && r.orbPlein >= 40, 'pHash<=6 seul': r => r.ph <= 6, 'ORB>=30 seul': r => r.orbPlein >= 30 };
    for (const [nom, f] of Object.entries(S)) console.log(nom.padEnd(34), 'même dessin acceptées', same.filter(f).length + '/' + same.length, '| FAUSSES CONCORDANCES (dessin différent accepté)', diff.filter(f).length + '/' + diff.length);
    console.log('pHash differ :', diff.map(r => r.ph).sort((a, b) => a - b).join(' ')); console.log('ORB plein differ :', diff.map(r => r.orbPlein).sort((a, b) => a - b).join(' '));
    console.log('pHash same :', same.map(r => r.ph).sort((a, b) => a - b).join(' ')); console.log('ORB plein same :', same.map(r => r.orbPlein).sort((a, b) => a - b).join(' '));
    process.exit(0);
})().catch(e => { console.log('ERREUR', e && e.message); process.exit(1); });
