// ============================================================
// LA PREUVE 404 DES « TCGdex SANS IMAGE » — le chemin standard de l'asset, demandé, par échantillon (2026-09-26, soir)
// ============================================================
//   node verifier-assets-tcgdex.js [--par-set=3]
//
// L'audit occidental range en c) les cartes dont l'API TCGdex ne déclare pas d'image. L'API n'est qu'un témoin : le §61 a
// montré qu'il faut aussi DEMANDER le fichier au chemin standard (assets.tcgdex.net/en/<série>/<set>/<localId>/high.png).
// Ceci le fait, sous le verrou TCGdex et avec le client de production (cadence, un réessai), sur un échantillon de N cartes
// par set TCGdex (les premières, triées), et écrit le résultat dans audit-occidental-assets.json. Un 200 retrouvé contredit
// l'API : la carte passe en b), et c'est imprimé. Aucune image n'est gardée (le worker est le seul collecteur).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--par-set=\d+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --par-set=N`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { fabriquerClient, VERROU_GLOBAL, VERROU_GLOBAL_MS } = require('./collecte-cartes/tcgdex');
const { lireSetsTcgdex } = require('./poser-dates-sets');

(async () => {
    const parSet = Number((process.argv.find(a => a.startsWith('--par-set=')) || '--par-set=3').slice(10));
    const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-occidental.json'), 'utf8'));
    const lignes = A.cartes.filter(l => l.cas === 'c' && l.tcgdexVerif?.length);
    const clone = path.join(process.env.TEMP || '', 'claude', 'c--Users-Yung-Desktop-pokemon-proxy', '65a1ec64-f853-444c-840c-b5a38ebe8695', 'scratchpad', 'cards-database');
    if (!fs.existsSync(clone)) throw new Error(`clone TCGdex absent (${clone}) : la série d'un set ne se lit pas, je ne construis aucune URL`);
    const tcg = lireSetsTcgdex(clone, 'data');
    const serieDe = new Map();
    for (const s of tcg) { const f = path.join(clone, s.fichier.split('/').slice(0, 2).join('/') + '.ts'); const id = fs.existsSync(f) ? /\bid:\s*["']([^"']+)["']/.exec(fs.readFileSync(f, 'utf8'))?.[1] : null; if (id) serieDe.set(s.id, id); }
    // un id de carte TCGdex = <set>-<localId> ; le set peut contenir des tirets (tk-xy-n) : on le retrouve par la liste des sets
    const setsConnus = [...serieDe.keys()].sort((a, b) => b.length - a.length);
    const decouper = id => { const s = setsConnus.find(x => id.startsWith(`${x}-`)); return s ? { set: s, localId: id.slice(s.length + 1) } : null; };
    const parTcgSet = new Map();
    for (const l of lignes) for (const id of l.tcgdexVerif) { const d = decouper(id); if (!d) continue; (parTcgSet.get(d.set) || parTcgSet.set(d.set, []).get(d.set)).push({ id, ...d, l }); }
    const echantillon = [...parTcgSet.values()].flatMap(v => [...new Map(v.map(x => [x.id, x])).values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).slice(0, parSet));
    console.log(`DÉNOMINATEUR : ${lignes.length} cartes c) avec un id TCGdex sans image · ${parTcgSet.size} sets TCGdex · échantillon ${echantillon.length} (${parSet} par set)`);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    const vt = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_GLOBAL, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'preuve-404' }, nom: 'verrou global tcgdex (preuve 404)' });
    for (let essai = 0; ; essai++) {
        const t = await vt.prendre();
        if (!t) break;
        if (essai === 0) console.log(`⏳ verrou tcgdex tenu par pid ${t.pid} sur ${t.hote} — j'attends (30 min au plus).`);
        if (essai > 900) { console.error('❌ verrou non obtenu — rien vérifié'); await fermer(); process.exit(1); }
        await new Promise(r => setTimeout(r, 2000));
    }
    const client = fabriquerClient({ verrou: vt });
    const res = [];
    try {
        for (const x of echantillon) {
            const url = `https://assets.tcgdex.net/en/${serieDe.get(x.set)}/${x.set}/${x.localId}/high.png`;
            let etat;
            try { const b = await client.telecharger(url); etat = b ? `200 (${b.length} octets) — CONTREDIT L'API` : '404'; }
            catch (e) { etat = `erreur : ${e.message}`; }
            res.push({ set: x.set, id: x.id, url, etat, carte: `${x.l.code} n°${x.l.numero} ${x.l.nomEn}` });
            console.log(`   ${etat.padEnd(10)} ${url}`);
        }
    } finally { await vt.rendre(); }
    const le = new Date().toISOString();
    fs.writeFileSync(path.join(__dirname, 'audit-occidental-assets.json'), JSON.stringify({ le, parSet, sets: parTcgSet.size, verifies: res }, null, 1));
    const c = {}; for (const r of res) { const k = r.etat.split(' ')[0]; c[k] = (c[k] || 0) + 1; }
    console.log(`\n${le} : ${JSON.stringify(c)} sur ${res.length} URL · écrit audit-occidental-assets.json`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
