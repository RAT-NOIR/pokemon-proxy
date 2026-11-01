// Lit, PAR LA PORTE RÉSEAU SEULEMENT, les pages Poképédia de CARTE listées dans collecte-cartes/pages-cartes-210.js (propriétaires : « Rafflesia-ex d'Erika »…).
// Une page déjà lue n'est pas relue ; un hôte fermé arrête le lot. Fichier : <pages>/carte-<id>.txt.
//   node collecter-pages-cartes-210.js [--pages=<dossier>]
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const inconnus = args.filter(a => !/^--pages=.+/.test(a));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const PAGES = path.resolve(args.find(a => a.startsWith('--pages='))?.slice(8) || 'C:/Users/Yung/rat-market-travail/catalogue/chasse/porte-sorties/noms-fr-379');
(async () => {
    const porte = require('./collecte-cartes/porte-reseau');
    const { PAGES_CARTES } = require('./collecte-cartes/pages-cartes-210');
    fs.mkdirSync(PAGES, { recursive: true });
    const bilan = { lues: 0, deja: 0, http: [], arret: null };
    for (const [id, url] of Object.entries(PAGES_CARTES)) {
        const f = path.join(PAGES, `carte-${id}.txt`);
        if (fs.existsSync(f)) { bilan.deja++; continue; }
        try { await porte.lire(url, { texte: true, sortie: f }); bilan.lues++; }
        catch (err) { if (err.arret) { bilan.arret = `hôte fermé : ${err.message}`; break; } bilan.http.push([id, err.status || err.message]); }
    }
    console.log(JSON.stringify(bilan, null, 1));
})().catch(e => { console.error('❌', e.message); process.exit(1); });
