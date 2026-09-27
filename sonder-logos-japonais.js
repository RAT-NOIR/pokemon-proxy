// ============================================================
// LES LOGOS JAPONAIS SUR L'ARCHIVE BULBAGARDEN — sets japonais publiés sans logo (demande du testeur, 2026-09-27)
// ============================================================
//   node sonder-logos-japonais.js            (archive R2 seule : les candidats, 0 requête)
//   node sonder-logos-japonais.js --sonder   (+ imageinfo sur l'archive Bulbagarden, lots de 50 titres, sous le verrou global
//                                             Bulbapedia — 1 requête / 5 s ; écrit DEMANDE-LOGOS-JAPONAIS.md)
// Les candidats d'un set, dans cet ordre :
//   1. un fichier « … Logo JP » CITÉ par sa propre page (archive R2, `sets.bulba.cleR2`) et qui porte SON code (« M1S Logo JP.png »
//      pour m1S ; le code sans le « x » des Additionals) — trouvé à zéro requête : la page d'un couple cite le logo de chaque moitié,
//      et collecter-logos-sets.js ne lisait que le `setlogo` de l'infobox (celui du couple, refusé à bon droit) ;
//   2. les noms CONVENTIONNELS « <CODE> Logo JP.png » (code tel quel, en majuscules, sans le « x »).
// Rien n'est écrit en base : la demande repasse par collecter-logos-demande.js, qui rejuge chaque ligne (langue, couple, générique).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--sonder$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --sonder`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const r2 = require('./collecte-cartes/r2');
const bulba = require('./collecte-cartes/bulba');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');

const sansX = c => String(c).replace(/^x(?=[a-z]*\d|[A-Z])/i, '');
const nuFichier = f => String(f).replace(/_/g, ' ').trim().toLowerCase();

(async () => {
    const sonder = process.argv.includes('--sonder');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const sets = (await cx.db.collection('sets').find({ nomAffichage: { $type: 'string' }, 'logo.cleR2': { $exists: false } }, { projection: { code: 1, tirage: 1, region: 1, nomAffichage: 1, 'bulba.cleR2': 1, 'bulba.titre': 1 } }).toArray())
        .filter(s => (s.tirage ?? s.region) === 'jp');
    const pages = new Map();
    const lignes = [], illisibles = [];
    for (const s of sets) {
        let cites = [];
        if (s.bulba?.cleR2) {
            let t = pages.get(s.bulba.cleR2);
            // une page illisible n'est pas « une page qui ne cite rien » : elle se compte et se nomme (revue du 2026-09-27)
            if (t == null) { try { t = await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2); } catch (e) { t = ''; illisibles.push(`${s.code} (${e.message})`); } pages.set(s.bulba.cleR2, t); }
            cites = [...new Set([...t.matchAll(/([^\[\]|=\n{}]*Logo JP\.(?:png|jpg))/g)].map(m => m[1].trim()))];
        }
        const codes = [...new Set([s.code, sansX(s.code)].filter(Boolean))];
        // 1. cité par sa page ET portant son code (le fichier commence par le code, casse ignorée)
        const citeDuSet = cites.filter(f => codes.some(c => nuFichier(f).startsWith(`${c.toLowerCase()} logo jp`)));
        // 2. conventionnels
        const conv = [...new Set(codes.flatMap(c => [`${c} Logo JP.png`, `${c.toUpperCase()} Logo JP.png`, `${c[0].toUpperCase()}${c.slice(1)} Logo JP.png`]))];
        // un fichier cité SANS code (« 30th Celebration Logo JP.png ») n'est candidat que s'il est le SEUL « Logo JP » de la page
        const citeSeul = !citeDuSet.length && cites.length === 1 ? cites : [];
        lignes.push({ slug: s._id, code: s.code, nom: s.nomAffichage, titre: s.bulba?.titre ?? null, candidats: [...new Set([...citeDuSet, ...citeSeul, ...conv])], citeDuSet, citeSeul });
    }
    const titres = [...new Set(lignes.flatMap(l => l.candidats))];
    if (illisibles.length) console.log(`   🔴 ${illisibles.length} page(s) archivée(s) ILLISIBLE(S) sur R2 — leurs logos cités ne sont pas vus : ${illisibles.slice(0, 8).join(', ')}`);
    console.log(`DÉNOMINATEUR : ${sets.length} sets japonais publiés sans logo · ${lignes.filter(l => l.titre).length} avec une page archivée · ${lignes.filter(l => l.citeDuSet.length).length} dont la page cite un « Logo JP » à leur code · ${lignes.filter(l => l.citeSeul.length).length} un seul « Logo JP » sans code · ${titres.length} noms de fichier candidats`);
    if (!sonder) { console.log('   (archive seule — --sonder interroge Bulbagarden)'); await fermer(); return; }
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'sonde-logos-jp' }, surPerte: () => {}, nom: 'verrou global bulbapedia (logos japonais)' });
    for (let essai = 0; ; essai++) {
        const tenu = await verrou.prendre();
        if (!tenu) break;
        if (essai === 0) console.log(`⏳ verrou Bulbapedia tenu par pid ${tenu.pid} sur ${tenu.hote} — j'attends.`);
        if (essai > 450) throw new Error('verrou Bulbapedia non obtenu en 15 min — rien sondé');
        await new Promise(r => setTimeout(r, 2000));
    }
    let trouve;
    try {
        const avant = bulba.compteRequetes();
        const infos = await bulba.imageinfoDe(titres.map(f => `File:${f}`));
        console.log(`   sondage Bulbagarden : ${titres.length} noms, ${bulba.compteRequetes() - avant} requête(s)`);
        trouve = new Map([...infos].filter(([, v]) => v?.url).map(([k, v]) => [nuFichier(k.replace(/^File:/, '')), v]));
    } finally { await verrou.rendre(); }
    const retenus = [];
    for (const l of lignes) {
        const hit = l.candidats.map(f => [f, trouve.get(nuFichier(f))]).find(([, v]) => v);
        if (hit) { l.fichier = hit[0]; l.url = hit[1].url; l.dim = `${hit[1].width}×${hit[1].height}`; l.origine = l.citeDuSet.includes(hit[0]) ? 'cité par la page, à son code' : l.citeSeul.includes(hit[0]) ? 'seul « Logo JP » cité par la page' : 'nom conventionnel'; retenus.push(l); }
    }
    console.log(`   trouvés : ${retenus.length} sur ${lignes.length} · ${JSON.stringify(retenus.reduce((o, l) => (o[l.origine] = (o[l.origine] || 0) + 1, o), {}))}`);
    for (const l of retenus) console.log(`   ${l.code.padEnd(8)} ${l.slug.padEnd(40)} ← ${l.fichier} ${l.dim} (${l.origine})`);
    fs.writeFileSync(path.join(__dirname, 'DEMANDE-LOGOS-JAPONAIS.md'), `# Logos japonais trouvés sur l'archive Bulbagarden (${new Date().toISOString().slice(0, 10)}, sonder-logos-japonais.js)\n\nChaque ligne est RE-JUGÉE par collecter-logos-demande.js (langue, couple, générique) avant tout téléchargement.\n\n${retenus.map(l => `- ${l.slug} (jp, ${l.code}) → **${l.url}**`).join('\n')}\n`);
    console.log(`\nécrit : DEMANDE-LOGOS-JAPONAIS.md (${retenus.length} lignes)`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
