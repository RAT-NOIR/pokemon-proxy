// ============================================================
// CALIBRATION DU TÉMOIN DES IMAGES artofpkm — LECTURE SEULE, ZÉRO ÉCRITURE
//   node calibrer-temoin-artofpkm.js [--json=<fichier>]
// ============================================================
// §22 : une règle se mesure sur ce qui MARCHE avant d'être câblée. Cet instrument rejoue le témoin de production
// (collecte-cartes/temoin-images-artofpkm.js — la MÊME fonction, jamais une copie) sur chaque entrée artofpkm SERVIE
// (`cartes.images`), jointe à son document `images` par cleR2, avec les cartes que la production lui donnerait :
// celles du slug (receveuses) et toutes celles qui déclarent l'impression (témoins, `filtreCartesDuSet`).
// Dénominateur imprimé. Les 5 faux prouvés et les 10 suspects de l'audit du 2026-10-08 sont les témoins de l'instrument.
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { TABLE } = require('./collecte-cartes/table-sets');
const { filtreCartesDuSet } = require('./collecte-cartes/tcgdex-appariement');
const { fabriquerTemoinImages } = require('./collecte-cartes/temoin-images-artofpkm');

const PROUVES = ['artofpkm/538/8.webp', 'artofpkm/28/25.webp', 'artofpkm/28/27.webp', 'artofpkm/28/40.webp', 'artofpkm/478/323.webp'];
const SUSPECTS = ['artofpkm/64/64.webp', 'artofpkm/64/65.webp', 'artofpkm/64/66.webp', 'artofpkm/64/67.webp', 'artofpkm/64/68.webp', 'artofpkm/64/69.webp',
    'artofpkm/400/73.webp', 'artofpkm/592/116.webp', 'artofpkm/592/123.webp'];

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ buckets: [], production: false });
    const M = modeles(cx);
    const cartesAvecImage = await M.Carte.find({ 'images.source': 'artofpkm' }).select('_id nomEn nomJa niveau impressions sets images').lean();
    const docs = await M.Image.find({ source: 'artofpkm', etat: 'ok' }).select('_id cleR2 set sourceSetId numero nomEn nomJa titre').lean();
    const parCle = new Map(docs.map(d => [d.cleR2, d]));
    const lignesDe = slug => TABLE.filter(l => l.slugSet === slug);
    const contexte = new Map();
    const ctx = async slug => {
        if (contexte.has(slug)) return contexte.get(slug);
        const ls = lignesDe(slug);
        const par = new Map();
        for (const l of ls) {
            const tirage = l.bulba.tirage || 'jp', exp = [].concat(l.bulba.expansion);
            const pool = await M.Carte.find(filtreCartesDuSet(slug, exp, tirage)).select('_id nomEn nomJa niveau impressions sets attaques').lean();
            par.set(l, { tirage, exp, pool });
        }
        const r = { ls, par, temoin: ls.map(l => fabriquerTemoinImages({ ligne: l, cartes: par.get(l).pool, slug })) };
        contexte.set(slug, r); return r;
    };
    let entrees = 0, sansDoc = 0, sansLigne = 0;
    const refus = [];
    for (const c of cartesAvecImage) {
        for (const e of c.images || []) {
            if (e.source !== 'artofpkm') continue;
            entrees++;
            const im = parCle.get(e.cleR2);
            if (!im) { sansDoc++; continue; }
            const x = await ctx(e.set);
            if (!x.ls.length) { sansLigne++; continue; }
            // porteuse admise par au moins une ligne du slug
            const imfull = { ...im, numero: e.numero ?? im.numero };
            for (const t of x.temoin) {
                const v = t(imfull, c);
                if (v) { refus.push({ cleR2: e.cleR2, set: e.set, numero: e.numero, carte: c._id, nomCarte: c.nomEn, nomJaCarte: c.nomJa, imageEn: im.nomEn, imageJa: im.nomJa, regle: v.regle, raison: v.raison, autres: (v.autres || []).map(a => `${a._id} « ${a.nomEn} »`) }); break; }
            }
        }
    }
    console.log(`DÉNOMINATEUR : ${entrees} entrées artofpkm servies (${cartesAvecImage.length} cartes) · ${sansDoc} sans document images · ${sansLigne} sans ligne de table · ${entrees - sansDoc - sansLigne} jugées`);
    const prouves = refus.filter(r => PROUVES.includes(r.cleR2)), suspects = refus.filter(r => SUSPECTS.includes(r.cleR2));
    const reste = refus.filter(r => !PROUVES.includes(r.cleR2) && !SUSPECTS.includes(r.cleR2));
    console.log(`REFUSÉES : ${refus.length} · prouvés ${prouves.length}/${PROUVES.length} · suspects ${suspects.length}/${SUSPECTS.length} (+1 hors liste connue éventuel) · RESTE ${reste.length}`);
    const par = {}; for (const r of refus) par[r.regle] = (par[r.regle] || 0) + 1;
    console.log('par règle', JSON.stringify(par));
    console.log('PROUVÉS non refusés :', PROUVES.filter(k => !refus.some(r => r.cleR2 === k)));
    console.log('SUSPECTS non refusés :', SUSPECTS.filter(k => !refus.some(r => r.cleR2 === k)));
    for (const r of reste) console.log('RESTE', JSON.stringify(r));
    const f = process.argv.find(a => a.startsWith('--json='));
    if (f) fs.writeFileSync(f.slice(7), JSON.stringify(refus, null, 1));
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
