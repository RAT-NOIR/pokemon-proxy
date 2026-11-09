'use strict';
// SAUVEGARDES — l'outil d'initialisation du bucket : pose le MARQUEUR (`sauvegardes-v2/marqueur-prive.json`) que le service exige avant sa première écriture. À lancer UNE fois, à la main, après avoir
// vérifié que le bucket est PRIVÉ (accès r2.dev éteint, aucun domaine personnalisé). Lit les variables V2_SAUVEGARDE_* ; n'imprime aucune valeur.
const { lireConfigSauvegardes } = require('./config');
const { creerStockageR2 } = require('./stockage-r2');
(async () => {
    const r = lireConfigSauvegardes(process.env);
    if (!r.ok) { console.error(`❌ configuration : ${r.raison || 'aucune variable V2_SAUVEGARDE_*'}`); process.exit(1); }
    const s = creerStockageR2(r.c);
    await s.poserMarqueur();
    await s.verifierMarqueur();
    console.log('✅ marqueur posé et relu');
})().catch(e => { console.error(`❌ marqueur non posé (${(e && (e.code || e.name)) || 'erreur'})`); process.exit(1); });
