'use strict';
// GUICHET 01/11 — TAMPONNÉES : ce que le repli refuse (991), ligne par ligne, avec la nature de l'image refusée. Lecture seule de `cartes` ; rien n'est écrit, aucune archive publiée.
// Sortie : t1-refuses.json (idProduct, famille, set, numeroFiche, image refusée : set, source, drapeaux, langue, cleR2), et un résumé imprimé.
const path = require('path'), fs = require('fs');
const { ENV } = require('C:\\Users\\Yung\\rat-market-travail\\api\\atlas\\garde-secrets');
const WT = 'C:\\Users\\Yung\\rat-market-travail\\api\\v2-guichet', ARCH = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\';
const env = { ...process.env, ...ENV };
(async () => {
    const { sourceCartes } = require(path.join(WT, 'v2', 'chargeur', 'source'));
    const { fabriquerFichier } = require(path.join(WT, 'v2', 'chargeur', 'precalcul'));
    const D = require(path.join(WT, 'v2', 'chargeur', 'decision'));
    const src = await sourceCartes({ env }); if (!src.ok) { console.log('ARRÊT source :', src.raison); process.exit(1); }
    const cat = new Map(); for (const p of JSON.parse(fs.readFileSync(ARCH + 'catalogue-filtre-2026-10-26.json', 'utf8')).products) cat.set(p.idProduct, p.idMetacard);
    const refuses = [];
    const decider = args => D.decider({ ...args, sink: args.sink ? { ...args.sink, refuse: r => refuses.push({
        idProduct: r.ligne.idProduct, refus: r.refus, set: r.set._id, tirage: r.set.tirage ?? r.set.region, nomSet: r.set.nomAffichage, numeroFiche: r.ligne.numeroFiche ?? null, slug: r.ligne.slug, visuel: r.visuel,
        im: r.im && { set: r.im.set, source: r.im.source, numero: r.im.numero ?? null, langue: r.im.langue ?? null, w: r.im.w, h: r.im.h, emp: r.im.imageEmprunteeTirage === true, diff: r.im.differenceEmprunt ?? null, tampon: r.im.tamponNonRepresente ?? null, cleR2: r.im.cleR2 } }) } : args.sink });
    await fabriquerFichier({ source: async () => ({ ...src, fermer: async () => { } }), catalogue: cat, secret: env.V2_VISUELS_HMAC, decider });
    fs.writeFileSync(ARCH + 'essais-repli\\t1-refuses.json', JSON.stringify(refuses));
    const T = {}; for (const r of refuses) { const k = r.refus + ' | set ' + (r.im ? (r.im.set === r.set ? 'propre' : 'autre') : '-') + ' | ' + (r.im ? r.im.source + (r.im.emp ? ' EMP' : '') + (r.im.diff ? ' ' + r.im.diff : '') : '-') + ' | vis ' + r.visuel; T[k] = (T[k] || 0) + 1; }
    console.log('refusés', refuses.length); console.log(JSON.stringify(Object.entries(T).sort((a, b) => b[1] - a[1]), null, 1));
    try { await src.fermer(); } catch { }
    process.exit(0);
})().catch(e => { console.log('ERREUR', e && e.message, String(e && e.stack).split('\n').slice(1, 4).join('|')); process.exit(1); });
