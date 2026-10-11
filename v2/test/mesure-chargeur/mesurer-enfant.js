'use strict';
// COTES-VISUELS — l'ENFANT de la mesure : un processus neuf qui charge comme l'API le fait, par le MÊME chemin (sourceCartes → decider → version compacte → bascule), contre l'URI d'un BANC
// (--uri=…, loopback) ou, quand le coordinateur l'a demandé et à la main, contre la vraie base par la lecture seule (--reel : garde des privilèges d'abord ; jamais un banc automatisé).
//   mémoire : process.memoryUsage() (rss, heapUsed), maxRSS du système (pic réel du processus), échantillon toutes les 20 ms pendant un chargement ; retard de la boucle d'événements.
const path = require('path'); const { monitorEventLoopDelay } = require('perf_hooks');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const Mo = o => Math.round(o / 1048576 * 10) / 10;
const mem = () => { global.gc && global.gc(); const m = process.memoryUsage(); return { rss: Mo(m.rss), heap: Mo(m.heapUsed), externe: Mo(m.external + m.arrayBuffers) }; };

(async () => {
    const reel = process.argv.includes('--reel');
    const { creerChargeur, sourceCartes } = require('../../chargeur/chargeur');
    const etat = require('../../chargeur/etat');
    const LS = require('../../chargeur/lecture-seule');
    const { facadeLecture } = require('../../../collecte-cartes/facade-lecture');
    const mongoose = require('mongoose');
    let source, catalogue, fin = async () => { };
    if (reel) {
        // lecture seule de la vraie base `cartes` : le MÊME chemin que l'API (garde des privilèges, puis façade restreinte). Le catalogue vient de `test` par MONGODB_LECTURE_URI (lecture seule aussi).
        require('dotenv').config({ path: arg('env', path.join(__dirname, '..', '..', '..', '.env')) });
        source = () => sourceCartes({ env: process.env });
        const uriTest = process.env.MONGODB_LECTURE_URI;
        if (!uriTest) { console.error('MONGODB_LECTURE_URI absente : arrêt'); process.exit(1); }
        const cxT = await mongoose.createConnection(uriTest, { dbName: 'test', serverSelectionTimeoutMS: 20000 }).asPromise();
        const jp = LS.jugerPrivileges(await cxT.db.admin().command({ connectionStatus: 1, showPrivileges: true }));      // la même garde que pour `cartes` : lecture seule prouvée avant toute lecture
        if (!jp.ok) { await cxT.close(); console.error(`refus : l'utilisateur de lecture de test n'est pas prouvé en lecture seule (${jp.raison})`); process.exit(1); }
        const lt = facadeLecture(cxT.db, () => cxT.close());
        catalogue = async () => { const m = new Map(); for await (const c of lt.collection('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } })) m.set(c.idProduct, c.idMetacard); return m; };
        fin = async () => { await cxT.close(); };
    } else {
        const uri = arg('uri', null);
        const cxC = await mongoose.createConnection(uri, { dbName: 'cartes' }).asPromise();
        const cxA = await mongoose.createConnection(uri, { dbName: 'api_banc' }).asPromise();
        source = () => sourceCartes({ ouvrir: async () => ({ ok: true, cartes: LS.restreindre(facadeLecture(cxC.db, () => { })) }) });
        catalogue = async () => { const m = new Map(); for await (const c of cxA.db.collection('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } })) m.set(c.idProduct, c.idMetacard); return m; };
        fin = async () => { await cxC.close(); await cxA.close(); };
    }
    const journal = [];
    const ch = creerChargeur({ source, catalogue, journal: m => journal.push(m) });
    const sortie = { reel, node: process.version, limiteTasMo: Mo(require('v8').getHeapStatistics().heap_size_limit) };
    sortie.base = mem();                                                         // le processus chargé de ses modules, avant tout chargement
    const nb = Number(arg('rechargements', '2'));
    sortie.chargements = [];
    for (let i = 0; i < nb; i++) {
        const h = monitorEventLoopDelay({ resolution: 5 }); h.enable();
        let picRss = 0, picHeap = 0;
        const t = setInterval(() => { const m = process.memoryUsage(); picRss = Math.max(picRss, m.rss); picHeap = Math.max(picHeap, m.heapUsed); }, 20);
        const avant = mem();
        const maxAvant = process.resourceUsage().maxRSS * 1024;
        const t0 = process.hrtime.bigint();
        const r = await ch.charger();
        const duree = Number(process.hrtime.bigint() - t0) / 1e9;
        clearInterval(t); h.disable();
        const maxApres = process.resourceUsage().maxRSS * 1024;
        const apres = mem();
        sortie.chargements.push({ rang: i + 1, ok: r.ok, motif: r.motif, dureeS: Math.round(duree * 10) / 10, avant, apres, picRssEchantillonMo: Mo(picRss), picHeapEchantillonMo: Mo(picHeap),
            maxRssProcessusMo: Mo(maxApres), maxRssAugmenteMo: Mo(maxApres - maxAvant), retardBoucleMaxMs: Math.round(h.max / 1e6), retardBoucleP99Ms: Math.round(h.percentile(99) / 1e6), comptes: r.comptes });
    }
    const v = etat.version();
    sortie.version = v ? { visuels: v.visuels.size, metacartes: v.parMetacarte.size, sets: v.liens.size, fiches: v.comptes.fichesLiees, produitsLies: v.comptes.produitsLies, refusees: v.comptes.refusees, motifs: v.comptes.motifs, chargeLe: v.chargeLe } : null;
    // taille de la forme compacte : tas retenu une fois la version seule en mémoire, moins le tas de base
    sortie.formeCompacteMo = Math.round((sortie.chargements[sortie.chargements.length - 1].apres.heap - sortie.base.heap) * 10) / 10;
    if (v) { const j = JSON.stringify([...v.visuels.values()]); sortie.visuelsEnJsonMo = Mo(j.length); }
    sortie.journal = journal;
    console.log('MESURE ' + JSON.stringify(sortie));
    await fin();
    process.exit(0);
})().catch(e => { console.error('❌ mesure :', (e && (e.name || e.code)) || 'erreur'); process.exit(1); });
