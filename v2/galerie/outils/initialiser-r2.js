'use strict';
// OUTIL D'EXPLOITATION — POSER LES MARQUEURS DES DEUX BUCKETS R2 DE LA COMMUNAUTÉ (lancé UNE fois, à la main, par un administrateur ; jamais par le serveur).
//   node v2/galerie/outils/initialiser-r2.js --confirmer-initialisation
// Les buckets (V2_GALERIE_R2_BUCKET_PRIVE et V2_GALERIE_R2_BUCKET_PUBLIC) sont créés par l'éditeur ; cet outil n'en crée aucun. Il y pose un objet marqueur (`galerie/marqueur-prive.json`, `galerie/pub/marqueur.json`)
// que le serveur exige avant de brancher la Communauté : un bucket sans marqueur (par exemple un bucket de production désigné par erreur) est refusé (cause « marqueur-r2-absent »).
// Un marqueur déjà posé n'est pas réécrit. Le client R2 est celui du serveur (clés d'écriture de la Communauté, deux buckets déclarés).
const R2 = require('../r2');

/** @param stockage le stockage R2 de la Communauté (r2.creerStockage). */
async function poserMarqueurs(stockage) {
    const poses = [];
    for (const [role, cle] of [['prive', R2.MARQUEUR_PRIVE], ['public', R2.MARQUEUR_PUBLIC]]) {
        if (await stockage.tete(cle)) continue;
        await stockage.ecrire(cle, Buffer.from(JSON.stringify({ galerie: true, role, version: 1 })), 'application/json');
        poses.push(role);
    }
    return { ok: true, poses };
}

async function main(argv, env = process.env) {
    if (!argv.includes('--confirmer-initialisation') || argv.some(a => a !== '--confirmer-initialisation')) { console.error('❌ usage : node v2/galerie/outils/initialiser-r2.js --confirmer-initialisation (aucun autre argument)'); return 1; }
    const c = R2.lireConfigR2(env);
    if (!c.ok) { console.error(`❌ stockage refusé : ${c.raison}`); return 1; }
    try { const r = await poserMarqueurs(R2.creerStockage(c.c, { env })); console.log(`✅ marqueurs posés : ${r.poses.length ? r.poses.join(', ') : 'aucun (déjà en place)'}`); return 0; }
    catch (e) { console.error(`❌ échec R2 (${(e && e.name) || 'erreur'})`); return 1; }
}
if (require.main === module) {
    require('dotenv').config();
    main(process.argv.slice(2)).then(c => process.exit(c)).catch(() => { console.error('❌ échec'); process.exit(1); });
}
module.exports = { poserMarqueurs, main };
