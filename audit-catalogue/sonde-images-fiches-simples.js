'use strict';
// node audit-catalogue/sonde-images-fiches-simples.js — LECTURE SEULE. Pour chaque FICHE SIMPLE : une image de la collection `images` existe-t-elle au même (set, numéro) ? porte-t-elle le même nom ? la fiche
// la porte-t-elle déjà dans `cartes.images` ? Et la règle T3d (image-fiche-simple.js, expansion = lisible(slug)) la verrait-elle ? Mesure ce que le rejeu de jointure d'images GAGNERAIT, par source et par set.
const { ouvrirLecture } = require('./lecture-audit');
const { lireMongo } = require('../collecte-cartes/lecture-sure');
const { cleNumero, clesNom, nomJointDe } = require('../collecte-cartes/jointure');
const { impressionsFicheSimple } = require('../collecte-cartes/image-fiche-simple');

(async () => {
    const base = await ouvrirLecture();
    try {
        const cartes = await lireMongo(base.cartes.collection('cartes'), { ficheSimple: { $exists: true } }, { nom: 'cartes (fiches simples)', projection: { nomEn: 1, niveau: 1, sets: 1, impressions: 1, images: 1 } });
        const sets = new Map((await lireMongo(base.cartes.collection('sets'), {}, { nom: 'sets', projection: { tirage: 1, region: 1, 'bulba.expansion': 1 } })).map(s => [s._id, s]));
        const images = await lireMongo(base.cartes.collection('images'), { etat: 'ok' }, { nom: 'images', projection: { source: 1, set: 1, numero: 1, nomEn: 1, titre: 1, carteId: 1, cleR2: 1, w: 1, h: 1 } });
        console.log(`DÉNOMINATEURS : fiches simples ${cartes.length} · sets ${sets.size} · images ok ${images.length}`);
        const parSetNum = new Map();
        for (const im of images) { if (im.numero == null || !im.set) continue; const k = `${im.set}|${cleNumero(String(im.numero))}`; (parSetNum.get(k) || parSetNum.set(k, []).get(k)).push(im); }
        const res = { fiches: cartes.length, avecImageDuSet: 0, dejaPortee: 0, imageMemeNom: 0, aGagner: 0, t3dVoit: 0, aGagnerNonVuParT3d: 0, parSet: {}, parSource: {}, exemples: [] };
        for (const c of cartes) {
            const slug = (c.sets || [])[0], s = sets.get(slug); if (!s) continue;
            const tirage = s.tirage ?? s.region;
            const exps = [].concat(s.bulba?.expansion ?? []);
            const imp = (c.impressions || []).find(i => i && i.tirage === tirage && exps.includes(i.expansion)) || (c.impressions || [])[0];
            if (!imp || imp.numero == null) continue;
            const cles = clesNom(nomJointDe(c));
            const ims = parSetNum.get(`${slug}|${cleNumero(String(imp.numero))}`) || [];
            if (!ims.length) continue;
            res.avecImageDuSet++;
            const memeNom = ims.filter(im => im.nomEn && clesNom(String(im.nomEn).replace(/[\[\]]/g, ' ')).some(k => cles.includes(k)));
            if (memeNom.length) res.imageMemeNom++;
            const portee = (c.images || []).some(m => m && m.set === slug);
            if (portee) { res.dejaPortee++; continue; }
            if (!memeNom.length) continue;
            res.aGagner++;
            const t3d = impressionsFicheSimple(c, { slug, tirage }).length > 0;
            if (t3d) res.t3dVoit++; else res.aGagnerNonVuParT3d++;
            const k = `${slug}`; res.parSet[k] = (res.parSet[k] || 0) + 1;
            for (const src of new Set(memeNom.map(m => m.source))) res.parSource[src] = (res.parSource[src] || 0) + 1;
            if (res.exemples.length < 12) res.exemples.push({ carte: c._id, nom: c.nomEn, set: slug, numero: imp.numero, images: memeNom.map(m => `${m.source}:${m._id}`).slice(0, 2), t3d });
        }
        console.log(JSON.stringify(res, null, 1));
    } finally { await base.fermer(); }
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
