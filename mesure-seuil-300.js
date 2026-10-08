// node mesure-seuil-300.js — MESURE AVANT/APRÈS de la règle `largeurMinDe` (décision 4 du testeur, 2026-10-08).
// LECTURE SEULE sur la base `cartes`, ZÉRO requête externe, aucune remise en file. Imprime ses dénominateurs.
// Avant = seuil unique 350 ; après = largeurMinDe(source) (300 pour tpc-asie / pokemon-card-com / pokemon-com).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { LARGEUR_MIN, largeurMinDe } = require('./collecte-cartes/seuils-images');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    try {
        // 1. documents `images`. Le champ de largeur de l'ORIGINAL est `wOriginal` (TPC, TCGdex) ou `w` (artofpkm, Bulbapedia) —
        //    lu comme le collecteur l'écrit (collecteur-images*.js).
        const total = await cx.db.collection('images').countDocuments({});
        const tp = await lireMongo(cx.db.collection('images'), { etat: 'trop-petit' }, { nom: 'images trop-petit', videAutorise: 'aucun visuel jugé trop petit : bon résultat possible', projection: { source: 1, set: 1, w: 1, wOriginal: 1 } });
        console.log(`\n══ 1. documents images : ${total} au total, ${tp.length} en etat « trop-petit » (seuil unique ${LARGEUR_MIN} avant) ══`);
        const par = new Map();
        let sansLargeur = 0;
        for (const d of tp) {
            const w = d.wOriginal ?? d.w;
            if (!w) { sansLargeur++; continue; }
            const k = `${d.source ?? '(sans source)'} | ${d.set ?? '(sans set)'}`;
            const g = par.get(k) || { source: d.source, n: 0, admis: 0, minW: 1e9, maxW: 0 };
            g.n++; g.minW = Math.min(g.minW, w); g.maxW = Math.max(g.maxW, w);
            if (w >= largeurMinDe(d.source)) g.admis++;
            par.set(k, g);
        }
        console.log(`   dont sans largeur lisible : ${sansLargeur} (non classables)`);
        const parSource = new Map();
        for (const [k, g] of [...par].sort((a, b) => b[1].admis - a[1].admis || b[1].n - a[1].n)) {
            const s = g.source ?? '(sans source)';
            const t = parSource.get(s) || { n: 0, admis: 0, sets: 0, setsAvecGain: 0 };
            t.n += g.n; t.admis += g.admis; t.sets++; if (g.admis) t.setsAvecGain++;
            parSource.set(s, t);
        }
        console.log('   PAR SOURCE (trop-petit avec largeur → admis par la nouvelle règle) :');
        for (const [s, t] of parSource) console.log(`     ${s.padEnd(18)} ${String(t.n).padStart(6)} trop-petit · ${String(t.admis).padStart(5)} admis · ${t.setsAvecGain}/${t.sets} sets concernés`);
        console.log('   PAR SET (seuls ceux qui gagnent) :');
        for (const [k, g] of [...par].filter(([, g]) => g.admis).sort((a, b) => b[1].admis - a[1].admis)) console.log(`     ${k.padEnd(60)} ${g.admis}/${g.n} admis (largeurs ${g.minW}–${g.maxW})`);

        // 2. le cas cité par le testeur : les visuels TPC indonésiens « Scarlet & Violet »
        const tpcId = await lireMongo(cx.db.collection('images'), { source: 'tpc-asie' }, { nom: 'images tpc-asie', videAutorise: 'aucun visuel TPC collecté', projection: { set: 1, etat: 1, w: 1, wOriginal: 1 } });
        const etats = {};
        for (const d of tpcId) { const k = `${d.set} | ${d.etat}`; etats[k] = (etats[k] || 0) + 1; }
        console.log(`\n══ 2. documents images source « tpc-asie » : ${tpcId.length} ══`);
        for (const [k, n] of Object.entries(etats).sort()) console.log(`     ${k.padEnd(60)} ${n}`);
        const ss = tp.filter(d => d.source === 'tpc-asie' && /Scarlet-Violet/i.test(d.set || ''));
        const ssLargeurs = {};
        for (const d of ss) { const w = d.wOriginal ?? d.w ?? '?'; ssLargeurs[w] = (ssLargeurs[w] || 0) + 1; }
        console.log(`   tpc-asie « Scarlet-Violet* » trop-petit : ${ss.length} (largeurs ${JSON.stringify(ssLargeurs)}) → admis à ${largeurMinDe('tpc-asie')} px : ${ss.filter(d => (d.wOriginal ?? d.w) >= largeurMinDe('tpc-asie')).length}`);

        // 3. unités de file refusées à la résolution
        const file = await lireMongo(cx.db.collection('file_images'), {}, { nom: 'file_images', projection: { etat: 1, resultat: 1, source: 1 } });
        const refus = file.filter(u => u.etat === 'refuse' && u.resultat === 'refuse-resolution');
        const parSrcUnite = {};
        for (const u of refus) parSrcUnite[u.source ?? '(sans source)'] = (parSrcUnite[u.source ?? '(sans source)'] || 0) + 1;
        console.log(`\n══ 3. file_images : ${file.length} unités, ${refus.length} « refuse-resolution » ${JSON.stringify(parSrcUnite)} ══`);

        // 4. mesures des états de collecte, par source (`<source>/<slug>`) : sets dont la MÉDIANE change de côté
        const etat = await lireMongo(cx.db.collection('collecte_images_etat'), {}, { nom: 'collecte_images_etat', projection: { mesure: 1, infosListe: 1, mesures: 1 } });
        const gagne = {}, vus = {};
        let sansMesure = 0;
        for (const e of etat) {
            if (String(e._id).startsWith('alerte/')) continue;
            const src = String(e._id).split('/')[0];
            let m = e.mesure?.mediane ?? null;
            if (m == null) {
                const ws = [...(e.infosListe || []).map(x => x?.w), ...Object.values(e.mesures || {}).flat().map(x => x?.w)].filter(Boolean).sort((a, b) => a - b);
                if (ws.length) m = ws[Math.floor(ws.length / 2)];
            }
            if (m == null) { sansMesure++; continue; }
            vus[src] = (vus[src] || 0) + 1;
            if (m < LARGEUR_MIN && m >= largeurMinDe(src)) { (gagne[src] ||= []).push(`${String(e._id).split('/').slice(1).join('/')}(${m})`); }
        }
        console.log(`\n══ 4. collecte_images_etat : ${etat.length} documents, ${sansMesure} sans mesure, mesurés par source ${JSON.stringify(vus)} ══`);
        console.log(`   sets dont la médiane passe de « sous 350 » à « admise » : ${JSON.stringify(Object.fromEntries(Object.entries(gagne).map(([k, v]) => [k, v.length])))}`);
        for (const [k, v] of Object.entries(gagne)) console.log(`     ${k} : ${v.join(', ')}`);
    } finally { await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
