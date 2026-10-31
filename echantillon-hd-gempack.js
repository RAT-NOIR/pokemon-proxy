'use strict';
// ÉCHANTILLON (quelques images) : la taille RÉELLE et la netteté (erreur d'aller-retour x0,5, celle de EXPLORATION/_outils/nettete-dossiers.js) des images de SC et de PC, selon le paramètre de taille du CDN.
// Mêmes limites que l'exploration (robots.txt de chaque hôte lu, >= 1,2 s par hôte, arrêt au premier 401/403/410/429/défi). Écrit dans EXPLORATION/_echantillons-hd-gempack/ (nouveau dossier).
const fs = require('fs'), path = require('path');
const EX = require('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/EXPLORATION/_outils/explorer.js');
const sharp = require('C:/Users/Yung/Desktop/pokemon-proxy/node_modules/sharp');
const G = require('./collecte-cartes/sources-gempack');
const CACHE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/cache';
async function err(f) {
    const m = await sharp(f).metadata();
    const g = await sharp(f).flatten({ background: '#fff' }).greyscale().raw().toBuffer();
    const petit = await sharp(f).flatten({ background: '#fff' }).greyscale().resize(Math.round(m.width * 0.5), Math.round(m.height * 0.5), { kernel: 'lanczos3' }).png().toBuffer();
    const back = await sharp(petit).resize(m.width, m.height, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
    let s = 0; for (let i = 0; i < g.length; i++) s += Math.abs(g[i] - back[i]);
    return +(s / g.length).toFixed(2);
}
(async () => {
    const sc4 = G.lireSimplifiedCollector(fs.readFileSync(`${CACHE}/sc-gem-pack-vol-4-card-list.html`, 'utf8'));
    const pc4 = G.lirePokeCottage(fs.readFileSync(`${CACHE}/pc-gem-pack-vol-4-card-list.html`, 'utf8'));
    const pc5 = G.lirePokeCottage(fs.readFileSync(`${CACHE}/pc-gem-pack-vol-5-card-list.html`, 'utf8'));
    const sc5 = G.lireSimplifiedCollector(fs.readFileSync(`${CACHE}/sc-gem-pack-vol-5-card-list.html`, 'utf8'));
    const nav = await EX.ouvrir();
    const lignes = [];
    try {
        const essais = [];
        const pick = (liste, i) => liste[i];
        for (const [etiq, liste, i] of [['pc4-ponyta-ir', pc4.cartes, 6], ['pc4-milieu', pc4.cartes, 100], ['pc5-ir', pc5.cartes, 6]]) {
            const base = liste[i].src;
            for (const suffixe of ['', '&format=1500w', '&format=2500w']) {
                const u = suffixe ? (base.includes('?') ? base + suffixe : base + suffixe.replace('&', '?')) : base;
                essais.push([etiq + (suffixe ? suffixe.replace('&format=', '-') : '-natif'), u, 'https://pokecottage.com/']);
            }
        }
        for (const [etiq, liste, i] of [['sc4-ponyta-ir', sc4.cartes, 6], ['sc4-milieu', sc4.cartes, 100], ['sc5-ir', sc5.cartes, 6]]) {
            essais.push([etiq + '-original', liste[i].urlOriginal, 'https://simplifiedcollector.com/']);
            const m = (liste[i].urlMiniature || '').replace(/-\d+x\d+(\.\w+)$/, '$1');
            if (liste[i].urlOriginal && /-(\d+)x(\d+)\.\w+$/.test(liste[i].urlMiniature || '')) essais.push([etiq + '-moyenne', liste[i].urlOriginal.replace(/\.(\w+)$/, '-733x1024.$1'), 'https://simplifiedcollector.com/']);
        }
        for (const [nom, url, ref] of essais) {
            const t = new Date().toISOString();
            const r = await nav.image(url, { set: '_echantillons-hd-gempack', pageUrl: ref, lu: { echantillon: nom }, nom });
            if (r.erreur) { lignes.push({ nom, url, t, erreur: r.erreur }); console.log(nom, 'ERREUR', r.erreur); continue; }
            const e = await err(r.fichier);
            lignes.push({ nom, url, t, largeur: r.largeur, hauteur: r.hauteur, octets: r.octets, format: r.format, erreurAllerRetour: e });
            console.log(nom, r.largeur + 'x' + r.hauteur, r.format, r.octets, 'octets', 'aller-retour', e);
        }
    } finally { console.log(JSON.stringify(nav.bilan())); await nav.fermerTout(); }
    fs.writeFileSync('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/echantillon-hd.json', JSON.stringify(lignes, null, 1));
})();
