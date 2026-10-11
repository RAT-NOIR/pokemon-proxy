'use strict';
// COTES-VISUELS, tour 1 — le SCRIPT AUTONOME qui précalcule l'archive compacte des visuels et du lien fiche → produits, HORS de l'API (il est destiné au worker de l'agent catalogue : l'API, sur
// une offre gratuite qui se met en veille et redémarre ~11 fois par jour, ne recalcule pas 380 s de lecture à chaque réveil — elle télécharge l'archive et la charge en ~0,1 s).
//   node v2/migrations/construire-fichier-visuels.js --vers=<archive.rmv.gz> [--catalogue=<products_singles_6.json>]
// LECTURE SEULE : `cartes` par MONGODB_CARTES_LECTURE_URI (la même garde que l'API : variables, privilèges, façade à trois collections) ; le catalogue (idProduct → idMetacard) vient de l'export
// Cardmarket local (--catalogue=) ou de `test` par MONGODB_LECTURE_URI (privilèges jugés par la même garde, façade de lecture). Il n'écrit QUE le fichier --vers (par un fichier temporaire puis un
// renommage : jamais une archive à moitié écrite). Il ne dépose rien sur R2 : le dépôt est le geste de celui qui l'héberge (clé `visuels.cle` de la configuration, hôte public).
// Même calcul (calculer), même format (format.js) que la voie « fil » de l'API. 0 visuel ou 0 lien : AUCUN fichier n'est écrit.
const fs = require('fs'); const path = require('path');

async function principal(argv = process.argv, env = process.env) {
    const arg = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const vers = arg('vers'), catalogueJson = arg('catalogue');
    const stop = m => { console.error(`❌ ARRÊT : ${m}`); return 1; };
    if (!vers) return stop('--vers=<archive.rmv.gz> est requis');
    const LS = require('../chargeur/lecture-seule');
    const j = LS.jugerVariables(env); if (!j.ok) return stop(j.raison);                        // refus AVANT toute connexion
    const { fabriquerFichier } = require('../chargeur/precalcul'); const { sourceCartes } = require('../chargeur/source');
    let catalogue = new Map();
    if (catalogueJson) {
        for (const p of JSON.parse(fs.readFileSync(catalogueJson, 'utf8')).products) catalogue.set(p.idProduct, p.idMetacard);
    } else {
        const uri = env.MONGODB_LECTURE_URI; if (!uri) return stop('ni --catalogue= ni MONGODB_LECTURE_URI : le catalogue (idMetacard) manque');
        const mongoose = require('mongoose'); const { facadeLecture } = require('../../collecte-cartes/facade-lecture');
        const cx = await mongoose.createConnection(uri, { dbName: 'test', serverSelectionTimeoutMS: 20000 }).asPromise();
        try {
            const p = LS.jugerPrivileges(await cx.db.admin().command({ connectionStatus: 1, showPrivileges: true }));
            if (!p.ok) return stop(`MONGODB_LECTURE_URI : ${p.raison}`);
            const f = facadeLecture(cx.db);
            for await (const c of f.collection('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } })) catalogue.set(c.idProduct, c.idMetacard);
        } finally { await cx.close(); }
    }
    let f;
    try { f = await fabriquerFichier({ source: () => sourceCartes({ env }), catalogue }); }
    catch (e) { return stop(e && e.motif ? e.motif : `calcul impossible (${(e && (e.name || e.code)) || 'erreur'})`); }
    const tmp = `${vers}.tmp-${process.pid}`;
    fs.mkdirSync(path.dirname(path.resolve(vers)), { recursive: true });
    fs.writeFileSync(tmp, f.gz); fs.renameSync(tmp, vers);
    const c = f.comptes;
    console.log(`✅ ${vers} : ${(f.brut.length / 1048576).toFixed(1)} Mo brut, ${(f.gz.length / 1048576).toFixed(2)} Mo compressé, calculé en ${(f.dureeMs / 1000).toFixed(0)} s`);
    console.log(`   sets ${c.sets} · cartes ${c.cartes} · cartes_produits ${c.produits} · catalogue ${c.catalogue} · entrées ${c.visuels} · refusées ${c.refusees} · fiches liées ${c.fichesLiees} (produits ${c.produitsLies}, sets ${c.setsAvecLiens})`);
    return 0;
}
module.exports = { principal };

if (require.main === module) {
    require('dotenv').config();
    principal().then(code => process.exit(code)).catch(e => { console.error('❌', (e && (e.name || e.code)) || 'erreur'); process.exit(1); });
}
