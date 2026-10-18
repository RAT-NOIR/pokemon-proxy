// node mesurer-marqueurs-pages.js <dossier> [--lecture=5000] — M2 (correction 2) : combien de pages HTML archivées contiennent un marqueur de défi dans leurs N premiers caractères ?
// LECTURE SEULE, ZÉRO requête : on lit des fichiers .html/.htm/.txt déjà sur le disque (récursif), jamais le réseau. Même définition que la production : RH.detecterDefi (collecte-cartes/reponse-hote.js).
// Le compte par marqueur dit si « captcha » / « turnstile » nus déclenchent sur des pages RÉELLES (faux arrêt durable) avant d'allumer une source.
const fs = require('fs');
const path = require('path');
const RH = require('./collecte-cartes/reponse-hote');

function* fichiers(dossier) {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
        const p = path.join(dossier, e.name);
        if (e.isDirectory()) yield* fichiers(p); else if (/\.(html?|txt)$/i.test(e.name)) yield p;
    }
}
/** @returns {{pages: number, avecMarqueur: number, parMarqueur: Object<string, number>, exemples: string[]}} */
function mesurer(dossier, lecture = 5000) {
    const parMarqueur = {}, exemples = [];
    let pages = 0, avecMarqueur = 0;
    for (const f of fichiers(dossier)) {
        pages++;
        const corps = Buffer.from(fs.readFileSync(f, 'utf8').slice(0, lecture));
        const motif = RH.detecterDefi({ statut: 200, typeContenu: 'text/html', entetes: {}, debutCorps: corps });
        if (!motif) continue;
        avecMarqueur++;
        const nom = (/«\s*(.+?)\s*»/.exec(motif) || [])[1] || motif;
        parMarqueur[nom] = (parMarqueur[nom] || 0) + 1;
        if (exemples.length < 5) exemples.push(f);
    }
    return { pages, avecMarqueur, parMarqueur, exemples };
}
module.exports = { mesurer };

if (require.main === module) {
    const dossier = process.argv[2];
    if (!dossier || !fs.existsSync(dossier)) { console.error('usage : node mesurer-marqueurs-pages.js <dossier de pages archivées> [--lecture=5000]'); process.exit(2); }
    const lecture = Number((process.argv.find(a => a.startsWith('--lecture=')) || '').split('=')[1]) || 5000;
    const r = mesurer(dossier, lecture);
    console.log(`PAGES lues : ${r.pages} · avec un marqueur de défi dans les ${lecture} premiers caractères : ${r.avecMarqueur}`);
    console.log('par marqueur :', JSON.stringify(r.parMarqueur));
    for (const e of r.exemples) console.log('  exemple :', e);
    if (!r.pages) { console.error('⚠️ AUCUNE page lue : la mesure ne conclut rien (un vide n\'est pas un zéro).'); process.exit(3); }
}