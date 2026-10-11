'use strict';
// COTES-VISUELS, tour 1 — l'ENFANT de la mesure : un processus neuf qui charge comme l'API le fait.
//   --mode=fil       (défaut) le chargeur de production : calcul dans un FIL plafonné, bascule ; --rechargements=N
//   --mode=fichier   --fichier=<archive> : la voie précalculée, lue depuis un fichier local (le téléchargement R2 se mesurera plus tard)
//   --mode=construire --vers=<archive> : le script autonome (hors de l'API) qui écrit le fichier compact
//   banc : lancé avec `-r mesure-preload.js` et MESURE_URI (base en mémoire) ; --reel : la vraie base par la lecture seule (garde des privilèges d'abord ; jamais un banc automatisé).
// mémoire : process.memoryUsage() (rss = TOUT le processus, fil compris), maxRSS du système (pic réel du processus entier), échantillon toutes les 20 ms ; retard de la boucle d'événements.
const fs = require('fs'); const path = require('path'); const { monitorEventLoopDelay } = require('perf_hooks');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const Mo = o => Math.round(o / 1048576 * 10) / 10;
const mem = () => { global.gc && global.gc(); const m = process.memoryUsage(); return { rss: Mo(m.rss), heap: Mo(m.heapUsed), externe: Mo(m.external + m.arrayBuffers) }; };

(async () => {
    const reel = process.argv.includes('--reel');
    const mode = arg('mode', 'fil');
    const C = require('../../chargeur/chargeur');
    const etat = require('../../chargeur/etat');
    const { facadeLecture } = require('../../../collecte-cartes/facade-lecture');
    const LS = require('../../chargeur/lecture-seule');
    const mongoose = require('mongoose');
    let catalogue = async () => new Map(), fin = async () => { };
    if (mode !== 'fichier') {
        if (reel) {
            // la vraie base : catalogue de `test` par MONGODB_LECTURE_URI (mêmes privilèges jugés par la même garde), cartes par MONGODB_CARTES_LECTURE_URI (garde dans le fil)
            require('dotenv').config({ path: arg('env', path.join(__dirname, '..', '..', '..', '.env')) });
            const uriTest = process.env.MONGODB_LECTURE_URI;
            if (!uriTest) { console.error('MONGODB_LECTURE_URI absente : arrêt'); process.exit(1); }
            const cxT = await mongoose.createConnection(uriTest, { dbName: 'test', serverSelectionTimeoutMS: 20000 }).asPromise();
            const jp = LS.jugerPrivileges(await cxT.db.admin().command({ connectionStatus: 1, showPrivileges: true }));
            if (!jp.ok) { await cxT.close(); console.error(`refus : l'utilisateur de lecture de test n'est pas prouvé en lecture seule (${jp.raison})`); process.exit(1); }
            const lt = facadeLecture(cxT.db, () => cxT.close());
            catalogue = async () => { const m = new Map(); for await (const c of lt.collection('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } })) m.set(c.idProduct, c.idMetacard); return m; };
            fin = async () => { await cxT.close(); };
        } else {
            const cxA = await mongoose.createConnection(process.env.MESURE_URI, { dbName: 'api_banc' }).asPromise();
            catalogue = async () => { const m = new Map(); for await (const c of cxA.db.collection('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } })) m.set(c.idProduct, c.idMetacard); return m; };
            fin = async () => { await cxA.close(); };
        }
    }
    const journal = [];
    const sortie = { reel, mode, node: process.version, limiteTasMo: Mo(require('v8').getHeapStatistics().heap_size_limit) };

    if (mode === 'construire') {
        const { fabriquerFichier } = require('../../chargeur/precalcul');
        const { sourceCartes } = require('../../chargeur/source');
        const cat = await catalogue();
        sortie.base = mem();
        const h = monitorEventLoopDelay({ resolution: 5 }); h.enable();
        const t0 = Date.now();
        const f = await fabriquerFichier({ source: () => sourceCartes({ env: process.env }), catalogue: cat });
        h.disable();
        fs.writeFileSync(arg('vers'), f.gz);
        sortie.construction = { dureeS: Math.round((Date.now() - t0) / 100) / 10, brutMo: Mo(f.brut.length), gzMo: Mo(f.gz.length), brutOctets: f.brut.length, gzOctets: f.gz.length, maxRssMo: Mo(process.resourceUsage().maxRSS * 1024), apres: mem(), retardBoucleMaxMs: Math.round(h.max / 1e6), comptes: f.comptes };
        console.log('MESURE ' + JSON.stringify({ ...sortie, journal }));
        await fin(); process.exit(0);
    }

    const executer = mode === 'fichier' ? C.executerDepuisFichier({ lireFichier: () => fs.promises.readFile(arg('fichier')) }) : undefined;
    const ch = C.creerChargeur({ catalogue, executer, journal: m => journal.push(m), env: process.env });
    sortie.base = mem();
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
        await new Promise(res => setTimeout(res, 1500));                            // le fil libère sa mémoire après sa mort : on laisse le système la reprendre
        const apres = mem();
        sortie.chargements.push({ rang: i + 1, ok: r.ok, motif: r.motif, dureeS: Math.round(duree * 10) / 10, avant, apres, picRssEchantillonMo: Mo(picRss), picHeapEchantillonMo: Mo(picHeap),
            maxRssProcessusMo: Mo(maxApres), retardBoucleMaxMs: Math.round(h.max / 1e6), retardBoucleP99Ms: Math.round(h.percentile(99) / 1e6), comptes: r.comptes });
    }
    const v = etat.version();
    sortie.version = v ? { ...v.comptes, octets: v.octets, chargeLe: v.chargeLe } : null;
    sortie.formeGardeeMo = v ? { total: Mo(v.octets.total), colonnes: Mo(v.octets.colonnes), chaines: Mo(v.octets.chaines) } : null;
    sortie.journal = journal;
    console.log('MESURE ' + JSON.stringify(sortie));
    await fin();
    process.exit(0);
})().catch(e => { console.error('❌ mesure :', (e && (e.name || e.code)) || 'erreur'); process.exit(1); });
