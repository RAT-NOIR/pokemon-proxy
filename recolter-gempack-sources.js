'use strict';
// Récolte (lecture seule, hors base) des pages de listes de deux sources de cartes chinoises, vers le cache GEMPACK-SOURCES.
// Limites : mécanique d'EXPLORATION (explorer.js : robots.txt de chaque hôte lu et respecté, >= 1,2 s par hôte, arrêt au premier 401/403/410/429/défi/connexion, profil Chrome VIERGE, aucune redirection hors hôte).
// Usage : node recolter-gempack-sources.js <genre>:<slug> [<genre>:<slug> ...]   genre = pc (page pokecottage /chinese-sets/<slug>, défilée) | sc (page simplifiedcollector /<slug>/) | pcbib (bibliothèque) | scurl (slug = chemin complet sur l'hôte)
//   ->  cache/<genre>-<slug>.html + .extrait.json + journal-requetes.jsonl (heure, adresse, code HTTP)
const fs = require('fs'), path = require('path');
const EX = require('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/EXPLORATION/_outils/explorer.js');
const RACINE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES';
const CACHE = RACINE + '/cache';
const JOURNAL = RACINE + '/journal-requetes.jsonl';
const URLS = {
    pc: slug => `https://pokecottage.com/chinese-sets/${slug}`,
    sc: slug => `https://simplifiedcollector.com/${slug}/`,
    pcbib: () => 'https://pokecottage.com/card-list-library?filter=chinese',
    pcurl: slug => `https://pokecottage.com/${slug}`
};
(async () => {
    const demandes = process.argv.slice(2).map(a => { const i = a.indexOf(':'); return [a.slice(0, i), a.slice(i + 1)]; });
    fs.mkdirSync(CACHE, { recursive: true });
    const nav = await EX.ouvrir();
    try {
        for (const [genre, slug] of demandes) {
            if (!URLS[genre]) { console.log('genre inconnu', genre); continue; }
            const url = URLS[genre](slug);
            const fichier = path.join(CACHE, `${genre}-${(slug || 'bibliotheque').replace(/[^A-Za-z0-9.-]+/g, '_')}.html`);
            if (fs.existsSync(fichier)) { console.log('déjà au cache', path.basename(fichier)); continue; }
            const t = new Date().toISOString();
            const r = await nav.page(url, { attendre: 2500, defiler: genre !== 'sc' });
            fs.appendFileSync(JOURNAL, JSON.stringify({ heure: t, url, genre, status: r.status || null, erreur: r.erreur || null, octets: r.html ? r.html.length : 0 }) + '\n');
            if (r.erreur) { console.log('ERREUR', url, r.erreur); if (/hote ferme|defi/.test(r.erreur)) break; continue; }
            fs.writeFileSync(fichier, r.html);
            fs.writeFileSync(fichier.replace(/\.html$/, '.extrait.json'), JSON.stringify({ url, titre: r.titre, imgs: r.imgs, liens: r.liens }, null, 1));
            console.log(r.status, path.basename(fichier), '|', r.titre, '| octets', r.html.length, 'imgs', r.imgs.length, 'liens', r.liens.length);
        }
    } finally { console.log(JSON.stringify(nav.bilan())); await nav.fermerTout(); }
})();
