'use strict';
// node audit-catalogue/controler-cache.js — le cache local existant (labo-embedding\cache-visuels\manifeste.json, fait par cacher-stock.js) : combien de NOS visuels servis il couvre, et
// l'empreinte tirée de sa copie pleine résolution (hauteur 1 024) est-elle la même que celle de la vignette R2 de 200 px ? LECTURE SEULE du cache (jamais modifié).
const fs = require('fs');
const path = require('path');
const E = require('./empreinte');
const { lireJson, sortie, ecrireJson } = require('./ecrire');
const { lireJeu } = require('./lancer-comparaison');

const CACHE = 'C:\\Users\\Yung\\Desktop\\labo-embedding\\cache-visuels';
(async () => {
    const man = JSON.parse(fs.readFileSync(path.join(CACHE, 'manifeste.json'), 'utf8'));
    const produits = lireJson('etat-produits.json');
    const servis = produits.filter(p => p.visuel.entree);
    const parCle = new Map(man.visuels.map(v => [v.cle, v]));
    const avecGrande = servis.filter(p => p.visuel.entree.grande?.cle);
    const couverts = avecGrande.filter(p => parCle.has(p.visuel.entree.grande.cle));
    const clesServies = new Set(avecGrande.map(p => p.visuel.entree.grande.cle)), clesCouvertes = [...clesServies].filter(c => parCle.has(c));
    const nous = lireJeu('empreintes-nous');
    console.log(`DÉNOMINATEURS : manifeste ${man.n} visuels (créé ${man.cree}) · produits servis ${servis.length}, dont avec fichier « grande » ${avecGrande.length} · fichiers « grande » distincts servis ${clesServies.size}`);
    console.log(`COUVERTURE du cache : ${couverts.length}/${avecGrande.length} produits servis (${(100 * couverts.length / avecGrande.length).toFixed(1)} %) · ${clesCouvertes.length}/${clesServies.size} fichiers distincts · à compléter : ${clesServies.size - clesCouvertes.length}`);
    // l'équivalence : empreinte(copie du cache) contre empreinte(vignette R2), sur 300 produits couverts répartis
    const pas = Math.max(1, Math.floor(couverts.length / 300)), ech = couverts.filter((_, i) => i % pas === 0).slice(0, 300);
    const ds = [];
    for (const p of ech) {
        const v = parCle.get(p.visuel.entree.grande.cle), iN = nous.index.get(p.visuel.entree.vignette.cle);
        if (iN === undefined || !nous.empreinte(iN)) continue;
        const fpCache = await E.empreinteDe(fs.readFileSync(path.join(CACHE, 'img', v.fichier)));
        const d = E.distance(fpCache, nous.empreinte(iN)).distance;
        if (Number.isFinite(d)) ds.push(d);
    }
    ds.sort((a, b) => a - b);
    const q = f => ds[Math.min(ds.length - 1, Math.floor(f * ds.length))];
    const res = { le: new Date().toISOString(), manifeste: man.n, servis: servis.length, avecGrande: avecGrande.length, couverts: couverts.length, fichiersDistincts: clesServies.size, fichiersCouverts: clesCouvertes.length,
        equivalence: { n: ds.length, mediane: +q(0.5).toFixed(4), p95: +q(0.95).toFixed(4), max: +ds[ds.length - 1].toFixed(4) } };
    ecrireJson('controle-cache.json', res, { indent: 1 });
    console.log(`ÉQUIVALENCE copie du cache (1 024 px) ↔ vignette R2 (200 px), ${ds.length} produits : distance médiane ${res.equivalence.mediane}, p95 ${res.equivalence.p95}, max ${res.equivalence.max}`);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
