// ============================================================
// CONSTRUIRE L'INDEX DES SYMBOLES — collecte-cartes/index-symboles.json, lu par l'API (collecte-cartes/index-symboles.js)
// ============================================================
//   node construire-index-symboles.js            (mesure : signatures et discrimination, rien d'écrit)
//   node construire-index-symboles.js --ecrire   (écrit le fichier d'index — un fichier du dépôt, AUCUNE écriture en base)
// Une entrée par IMAGE de symbole d'un set : `sets.symbole` (celui que le site affiche) et `sets.symbolesIdentification` (ptcg-assets),
// dédoublonnées par objet R2. Lecture seule de la base `cartes` et du bucket d'images. À relancer quand un symbole est posé.
// Le dénominateur imprimé : combien d'images, combien de sets, et combien de sets ont un voisin d'un AUTRE set à moins de
// ECART_NON_MESURE de 1 — par le MÊME fichier (partagé : l'étoile PROMO) ou par des fichiers différents que la signature ne sépare pas
// (les boîtes de code modernes) : ceux-là ne désigneront jamais un set seuls.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const { signatureSymbole, normaliser, correlation, ECART_NON_MESURE, COTE } = require('./collecte-cartes/index-symboles');
const SORTIE = path.join(__dirname, 'collecte-cartes', 'index-symboles.json');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const total = await cx.db.collection('sets').countDocuments({});
    const sets = await cx.db.collection('sets').find({ $or: [{ 'symbole.cleR2': { $type: 'string' } }, { 'symbolesIdentification.0': { $exists: true } }] },
        { projection: { code: 1, tirage: 1, region: 1, idExpansion: 1, symbole: 1, symbolesIdentification: 1 } }).toArray();
    await fermer();
    if (!total || !sets.length) { console.error(`❌ ${total} sets en base, ${sets.length} avec un symbole : rien à indexer (base ou champ faux ?)`); process.exit(1); }
    const bucket = process.env.R2_BUCKET_IMAGES; await r2.verifierBucket(bucket);
    const entrees = [];
    for (const s of sets) {
        const vues = new Set();
        for (const [role, e] of [['affiche', s.symbole], ...(s.symbolesIdentification || []).map(x => ['identification', x])]) {
            if (!e?.cleR2 || vues.has(e.cleR2)) continue;
            vues.add(e.cleR2);
            const sig = await signatureSymbole(await r2.lireBinaire(bucket, e.cleR2));
            entrees.push({ slug: s._id, code: s.code, tirage: s.tirage ?? s.region, idExpansion: s.idExpansion ?? [], role, source: e.source, cleR2: e.cleR2, sha1: e.sha1 ?? null, w: e.w ?? null, h: e.h ?? null, ...sig });
        }
    }
    // la discrimination, PAR SET (relecture du 2026-09-28 : compter des images comptait les paires deux fois) : pour chaque set, sa
    // meilleure corrélation à une image d'un AUTRE set — et, au-dessus de 1 − ECART, deux causes séparées : le MÊME fichier (partagé,
    // l'étoile PROMO, un set et ses Additionals) ou des fichiers DIFFÉRENTS que la signature ne sépare pas (les boîtes de code 30×17)
    const norm = entrees.map(e => normaliser(e.vecteur));
    const parSet = new Map();
    entrees.forEach((e, i) => {
        let best = -1, qui = null, meme = false;
        entrees.forEach((f, j) => { if (f.slug === e.slug) return; const r = correlation(norm[i], norm[j]); if (r > best) { best = r; qui = f; } });
        e.plusProcheAutreSet = qui ? { slug: qui.slug, correlation: Math.round(best * 1000) / 1000, memeFichier: !!e.sha1 && e.sha1 === qui.sha1 } : null;
        meme = !!e.plusProcheAutreSet?.memeFichier;
        const p = parSet.get(e.slug);
        if (!p || best > p.best) parSet.set(e.slug, { best, qui: qui?.slug, code: e.code, meme });
    });
    const tranches = { 'même fichier qu\'un autre set': 0, '≥ 0,97, fichiers différents (indistincts)': 0, '0,90–0,97': 0, '0,80–0,90': 0, '< 0,80': 0 };
    const indistincts = [];
    for (const [slug, p] of parSet) {
        if (p.best >= 1 - ECART_NON_MESURE && p.meme) tranches['même fichier qu\'un autre set']++;
        else if (p.best >= 1 - ECART_NON_MESURE) { tranches['≥ 0,97, fichiers différents (indistincts)']++; indistincts.push(`${p.code}~${p.qui}`); }
        else if (p.best >= 0.9) tranches['0,90–0,97']++; else if (p.best >= 0.8) tranches['0,80–0,90']++; else tranches['< 0,80']++;
    }
    console.log(`DÉNOMINATEUR : ${total} sets en base · ${sets.length} avec au moins un symbole · ${entrees.length} images indexées (${COTE}×${COTE})`);
    console.log(`par SET, le plus proche d'un AUTRE set : ${Object.entries(tranches).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`indistincts (la signature ne les sépare pas — une boîte de code se LIT) : ${indistincts.slice(0, 14).join(', ')}${indistincts.length > 14 ? ' …' : ''}`);
    if (!process.argv.includes('--ecrire')) { console.log('   (mesure seule — --ecrire pour écrire collecte-cartes/index-symboles.json)'); return; }
    fs.writeFileSync(SORTIE, JSON.stringify({ construitLe: new Date().toISOString(), cote: COTE, n: entrees.length, entrees }) + '\n');
    console.log(`✅ écrit ${path.relative(__dirname, SORTIE)} : ${entrees.length} images, ${(fs.statSync(SORTIE).size / 1024).toFixed(0)} Ko`);
})().catch(e => { console.error(e); process.exit(1); });
