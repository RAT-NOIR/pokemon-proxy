// Extrait, des pages réelles en cache, les EXTRAITS qui servent de fixtures aux bancs (aucune requête réseau). Usage : node extraire-fixtures-gempack.js
const fs = require('fs'), path = require('path');
const CACHE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/cache';
const SORTIE = path.join(__dirname, 'fixtures-gempack');
fs.mkdirSync(SORTIE, { recursive: true });
const lire = f => fs.readFileSync(path.join(CACHE, f), 'utf8');

// SC vol. 4 : début de « Card List » (groupes 01 et 02), le groupe 10 SANS légendes (Chatot), le début de « Exclusives »
{
    const h = lire('sc-gem-pack-vol-4-card-list.html');
    const iCL = h.search(/<h2[^>]*>(?:(?!<\/h2>)[\s\S])*Card List/i);
    const iH3 = n => h.indexOf(`(${n})</strong></h3>`);
    const debut = h.lastIndexOf('<h3', iH3('01'));
    const finG2 = h.lastIndexOf('<h3', iH3('03'));
    const g10 = h.lastIndexOf('<h3', iH3('10')), g11 = h.lastIndexOf('<h3', iH3('11'));
    const iEx = h.search(/<h2[^>]*>(?:(?!<\/h2>)[\s\S])*Exclusives/i);
    const fin = h.indexOf('</h2>', iEx) + 5;
    const exFig = h.slice(fin, fin + 3500);
    const p3 = h.lastIndexOf('<h3', iH3('03'));
    const g3 = h.slice(p3, h.lastIndexOf('<h3', iH3('04')));
    const g3court = g3.slice(0, g3.indexOf('</figure>', g3.indexOf('03 02')) + 9) + '\n</div></figure>';   // ses 2 premières légendes (« 03 01-07 », « 03 02-07 » : tiret au lieu de la barre)
    const titreCL = h.slice(iCL, h.indexOf('</h2>', iCL) + 5);
    const sortie = '<!-- extrait réel : sc-gem-pack-vol-4-card-list.html -->\n' + titreCL + '\n' + h.slice(debut, finG2) + '\n<!-- groupe 03 tronqué -->\n' + g3court + '\n<!-- groupe 10 -->\n' + h.slice(g10, g11) + '\n<!-- fin de la liste -->\n' + h.slice(iEx, fin) + '\n' + exFig + '\n';
    fs.writeFileSync(path.join(SORTIE, 'sc-vol4-extrait.html'), sortie);
    console.log('sc-vol4-extrait.html', sortie.length);
}
// SC vol. 5 : la section « Exclusives » répète des cartes de la liste (doublons de (groupe, rang)) — extrait d'un groupe de la liste ET du début d'Exclusives
{
    const h = lire('sc-gem-pack-vol-5-card-list.html');
    const iCL = h.search(/<h2[^>]*>(?:(?!<\/h2>)[\s\S])*Card List/i);
    const titreCL = h.slice(iCL, h.indexOf('</h2>', iCL) + 5);
    const iH3 = n => h.indexOf(`(${n})</strong></h3>`);
    const debut = h.lastIndexOf('<h3', iH3('01')), fin1 = h.lastIndexOf('<h3', iH3('02'));
    const iEx = h.search(/<h2[^>]*>(?:(?!<\/h2>)[\s\S])*Exclusives/i);
    const sortie = '<!-- extrait réel : sc-gem-pack-vol-5-card-list.html -->\n' + titreCL + '\n' + h.slice(debut, fin1) + '\n<!-- fin de la liste -->\n' + h.slice(iEx, iEx + 6000) + '\n';
    fs.writeFileSync(path.join(SORTIE, 'sc-vol5-extrait.html'), sortie);
    console.log('sc-vol5-extrait.html', sortie.length);
}
// PC vol. 4 : le début (g:r), la jonction avec la numérotation séquentielle (typos réels : 8:8, 12:05, 183a, « double »), deux images qui ne sont pas des cartes
{
    const h = lire('pc-gem-pack-vol-4-card-list.html');
    const cartes = [...h.matchAll(/<a class="card [^"]*"[^>]*>\s*<img[^>]*>\s*<\/a>/g)].map(m => m[0]);
    const choisir = re => cartes.filter(c => re.test(c));
    const lot = [...cartes.slice(0, 8), ...choisir(/8%3A8_triple/), ...choisir(/12%3A05_rare/), ...choisir(/%3A7_triple-rare/).slice(0, 2),...choisir(/Card-List-79_|Card-List-176|183a_double|Card-List-183_rare/)];
    const sortie = '<!-- extrait réel : pc-gem-pack-vol-4-card-list.html -->\n<img alt="PokéCottage" src="https://images.squarespace-cdn.com/content/x/logo.png">\n' + [...new Set(lot)].join('\n') + '\n';
    fs.writeFileSync(path.join(SORTIE, 'pc-vol4-extrait.html'), sortie);
    console.log('pc-vol4-extrait.html', sortie.length, 'cartes', [...new Set(lot)].length);
}
// PC vol. 6 : l'AUTRE gabarit (galerie « pc-set-card-gallery-card » : nom, numéro « 01 01/07 » et rareté dans la page) — 8 premières cartes, 1 dernière
{
    const h = lire('pc-gem-pack-vol-6-card-list.html');
    const arts = [...h.matchAll(/<article class="pc-set-card-gallery-card"[\s\S]*?<\/article>/g)].map(m => m[0]);
    const sortie = '<!-- extrait réel : pc-gem-pack-vol-6-card-list.html (' + arts.length + ' cartes dans la page) -->\n<div class="pc-set-card-gallery">\n' + [...arts.slice(0, 8), arts[arts.length - 1]].join('\n') + '\n</div>\n';
    fs.writeFileSync(path.join(SORTIE, 'pc-vol6-extrait.html'), sortie);
    console.log('pc-vol6-extrait.html', sortie.length, 'sur', arts.length);
}
// ppr (source chinoise en cache) : 2 groupes de CBB4C
{
    const j = JSON.parse(fs.readFileSync('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/RECOLTE/releves-ppr.json', 'utf8'));
    const r = j.CBB4C;
    fs.writeFileSync(path.join(SORTIE, 'ppr-cbb4c-extrait.json'), JSON.stringify({ code: 'CBB4C', annonce: r.annonce, tuiles: r.tuiles.filter(t => ['01', '02', '10'].includes(t.groupe)).map(({ numero, nom, variante, rarete, groupe, rang, total, cachee }) => ({ numero, nom, variante, rarete, groupe, rang, total, cachee })) }, null, 1));
    console.log('ppr-cbb4c-extrait.json', r.tuiles.filter(t => ['01', '02', '10'].includes(t.groupe)).length, 'tuiles');
}
