'use strict';
// Mesure (lecture seule des fichiers déjà déposés) : largeurs RÉELLES lues par sharp et netteté d'aller-retour x0,5 (celle de EXPLORATION/_outils/nettete-dossiers.js) pour les dossiers pc-/sc-GemPack-volN.
// Étalons de l'exploration : 350 px natif 7,7 ; 710 px natif 8,0 ; 868 px (Serebii) 6,5 ; "965 px" agrandi 2,2. Usage : node mesurer-images-gempack.js [--echantillon=8]
const fs = require('fs'), path = require('path');
const sharp = require('C:/Users/Yung/Desktop/pokemon-proxy/node_modules/sharp');
const B = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/EXPLORATION';
const N = Number((process.argv.find(a => a.startsWith('--echantillon=')) || '').slice(14)) || 8;
async function err(f) {
    const m = await sharp(f).metadata();
    const g = await sharp(f).flatten({ background: '#fff' }).greyscale().raw().toBuffer();
    const petit = await sharp(f).flatten({ background: '#fff' }).greyscale().resize(Math.round(m.width * 0.5), Math.round(m.height * 0.5), { kernel: 'lanczos3' }).png().toBuffer();
    const back = await sharp(petit).resize(m.width, m.height, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
    let s = 0; for (let i = 0; i < g.length; i++) s += Math.abs(g[i] - back[i]);
    return +(s / g.length).toFixed(2);
}
(async () => {
    const sortie = {};
    for (const d of fs.readdirSync(B).filter(x => /^(pc|sc)-GemPack-vol\d+$/.test(x))) {
        const fichiers = fs.readdirSync(path.join(B, d)).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
        const largeurs = {}, tailles = [];
        for (const f of fichiers) { const p = JSON.parse(fs.readFileSync(path.join(B, d, f + '.provenance.json'), 'utf8')); const k = `${p.largeur}x${p.hauteur}`; largeurs[k] = (largeurs[k] || 0) + 1; tailles.push(p.largeur); }
        tailles.sort((a, b) => a - b);
        const pas = Math.max(1, Math.floor(fichiers.length / N)), choix = []; for (let i = 0; i < fichiers.length && choix.length < N; i += pas) choix.push(fichiers[i]);
        const erreurs = []; for (const f of choix) { try { erreurs.push({ f, e: await err(path.join(B, d, f)) }); } catch (e) { erreurs.push({ f, erreur: e.message }); } }
        const top = Object.entries(largeurs).sort((a, b) => b[1] - a[1]).slice(0, 6);
        sortie[d] = { fichiers: fichiers.length, mediane: tailles[Math.floor(tailles.length / 2)], min: tailles[0], max: tailles[tailles.length - 1], formats: top, netteteEchantillon: erreurs };
        console.log(`${d} : ${fichiers.length} fichiers · largeur min/médiane/max ${tailles[0]}/${tailles[Math.floor(tailles.length / 2)]}/${tailles[tailles.length - 1]} · formats ${top.map(([k, n]) => k + '×' + n).join(', ')} · aller-retour ${erreurs.map(x => x.e ?? 'ERR').join(' ')}`);
    }
    fs.writeFileSync('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/mesure-images.json', JSON.stringify(sortie, null, 1));
})();
