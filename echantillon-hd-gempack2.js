'use strict';
// Second échantillon : la même image du CDN de PC, SANS le paramètre content-type, avec un paramètre de taille (format=1500w / 2500w / original).
const fs = require('fs');
const EX = require('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/EXPLORATION/_outils/explorer.js');
const sharp = require('C:/Users/Yung/Desktop/pokemon-proxy/node_modules/sharp');
const G = require('./collecte-cartes/sources-gempack');
const CACHE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/cache';
(async () => {
    const pc4 = G.lirePokeCottage(fs.readFileSync(`${CACHE}/pc-gem-pack-vol-4-card-list.html`, 'utf8'));
    const nav = await EX.ouvrir();
    try {
        const base = pc4.cartes[6].src.split('?')[0];
        for (const q of ['?format=1500w', '?format=2500w', '?format=original']) {
            const r = await nav.image(base + q, { set: '_echantillons-hd-gempack', pageUrl: 'https://pokecottage.com/', lu: { echantillon: 'sans content-type ' + q }, nom: 'pc4-ponyta-ir-sans-ct' + q.replace('?format=', '-') });
            console.log(q, r.erreur || `${r.largeur}x${r.hauteur} ${r.format} ${r.octets} octets`);
        }
    } finally { console.log(JSON.stringify(nav.bilan())); await nav.fermerTout(); }
})();
