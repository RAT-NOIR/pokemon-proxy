'use strict';
// Récupère, dans la ZONE D'ATTENTE (EXPLORATION/<pc|sc>-GemPack-volN/), les images d'une liste de Gem Pack, chacune avec son .provenance.json (largeur x hauteur RÉELLES lues par sharp). Rien en base, rien dans R2.
// Mêmes limites que l'exploration (explorer.js) : robots.txt de CHAQUE hôte lu et respecté, >= 1,2 s par hôte, arrêt au premier 401/403/410/429/défi, aucune redirection suivie.
// Reprise : un fichier déjà présent n'est jamais redemandé. Usage : node recolter-images-gempack.js <sc|pc> <volN: 4|5|6> [--limite=N]
const fs = require('fs'), path = require('path');
const EX = require('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/EXPLORATION/_outils/explorer.js');
const G = require('./collecte-cartes/sources-gempack');
const CACHE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/cache';
const [genre, vol] = process.argv.slice(2);
const limite = Number((process.argv.find(a => a.startsWith('--limite=')) || '').slice(9)) || Infinity;
const slug = `gem-pack-vol-${vol}-card-list`;
(async () => {
    const html = fs.readFileSync(`${CACHE}/${genre}-${slug}.html`, 'utf8');
    const liste = genre === 'sc' ? G.lireSimplifiedCollector(html).cartes : G.lirePokeCottage(html).cartes;
    const set = `${genre}-GemPack-vol${vol}`;
    const dossier = path.join(EX.BASE, set); fs.mkdirSync(dossier, { recursive: true });
    const pageUrl = genre === 'sc' ? `https://simplifiedcollector.com/${slug}/` : `https://pokecottage.com/chinese-sets/${slug}`;
    const nav = await EX.ouvrir();
    let faits = 0, saut = 0, echecs = 0;
    try {
        for (let i = 0; i < liste.length && faits + echecs < limite; i++) {
            const c = liste[i];
            const url = genre === 'sc' ? c.urlOriginal : c.src;
            const nom = genre === 'sc' ? `${String(c.groupe)}${String(c.rang).padStart(2, '0')}_${(c.nom || '').replace(/[^A-Za-z0-9]+/g, '-')}` : `${String(i + 1).padStart(3, '0')}${c.groupe ? '_' + c.groupe + String(c.rang).padStart(2, '0') : ''}_${(c.rareteTexte || c.categorie || 'x').replace(/[^A-Za-z0-9]+/g, '-')}`;
            if (fs.readdirSync(dossier).some(f => f.startsWith(nom + '.') && !f.endsWith('.json'))) { saut++; continue; }
            if (!url) { echecs++; console.log('sans adresse', nom); continue; }
            const lu = genre === 'sc' ? { groupe: c.groupe, rang: c.rang, total: c.total, nom: c.nom, finition: c.finitionTexte, classe: c.classe, rangDeclare: c.rangDeclare, largeurAnnoncee: c.largeurAnnoncee } : { position: c.position, rarete: c.rareteTexte, classeRarete: c.classe, fichier: c.fichier, groupe: c.groupe ?? null, rang: c.rang ?? null, nom: c.nom ?? null };
            const r = await nav.image(url, { set, pageUrl, lu: { ...lu, note: 'liste de set ; AUCUN rattachement à un produit Cardmarket (variantes indiscernables)' }, nom });
            if (r.erreur) { echecs++; console.log('ÉCHEC', nom, r.erreur); if (/hote ferme/.test(r.erreur)) break; continue; }
            faits++;
            if (faits % 25 === 0) console.log(`   ${faits} images (${r.largeur}x${r.hauteur})`);
        }
    } finally { console.log(`${set} : ${faits} récupérées, ${saut} déjà là, ${echecs} échecs · ` + JSON.stringify(nav.bilan())); await nav.fermerTout(); }
})();
