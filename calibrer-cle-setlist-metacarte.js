// node calibrer-cle-setlist-metacarte.js --codes=S-P/ID,… --export=<export>.json [--rapport=<fichier>.json]      LECTURE SEULE (rien n'est écrit)
// CALIBRATION de la clé « métacarte ∧ Setlist du set » : collecte-cartes/calibration-setlist-metacarte.js (UNE définition, rejouée par l'outil d'écriture).
// Épreuves A, B, C sur les sets demandés + D (le DANGER : métacarte >= 2 frères ET homonyme dans la Setlist) sur TOUS les sets de la table lisibles ;
// chacune imprime ses cas ATTEINTS. Puis la SIMULATION du plan de chaque set demandé.
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const J = require('./collecte-cartes/jointure');
const { indexerMetacartes } = require('./collecte-cartes/cle-nom-attaques');
const { lireSetlistDuSet, planDuSet } = require('./collecte-cartes/cle-setlist-metacarte');
const { calibrer, verdict, imprimer, chargerExport } = require('./collecte-cartes/calibration-setlist-metacarte');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');

if (require.main !== module) return;
const AUTORISES = [/^--codes=[\w.,/-]+$/, /^--export=.+\.json$/, /^--rapport=.+\.json$/, /^--sans-danger$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CODES = (arg('codes') || '').split(',').filter(Boolean), EXPORT = arg('export');
if (!CODES.length || !EXPORT) { console.error('❌ --codes=<CODE>[,…] et --export=<fichier>.json obligatoires'); process.exit(2); }
const toutes = [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE].filter(l => l.code && l.slugSet && l.bulba);
const ligne = code => toutes.find(l => l.code === code) || null;

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const lignesEcrites = CODES.map(c => { const L = ligne(c); if (!L) throw new Error(`ligne absente de la table : ${c}`); return L; });
    const parSlug = new Map(); for (const l of toutes) if (!parSlug.has(l.slugSet)) parSlug.set(l.slugSet, l);
    const lire = L => lireSetlistDuSet({ db: cx.db, r2, bucket: process.env.R2_BUCKET_BRUT, L });
    const cal = await calibrer({ db: cx.db, exportPath: EXPORT, lignesEcrites, lignesDanger: process.argv.includes('--sans-danger') ? lignesEcrites : [...parSlug.values()], lireSetlist: lire, log: console.log });
    imprimer(cal, console.log);
    const v = verdict(cal);
    console.log(v.ok ? '   ✅ la garde d\'écriture passerait' : `   🔴 la garde d'écriture REFUSERAIT : ${v.refus.join(' · ')}`);
    for (const f of [...cal.total.A.faux, ...cal.danger.A.faux, ...cal.danger.C.faux].slice(0, 400)) console.log(`      ⚠️ ${f}`);

    // simulation du plan de chaque set demandé
    const exp = chargerExport(EXPORT);
    const lignes = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
    const metaDe = id => exp.get(id)?.idMetacard ?? null;
    const base = { parMeta: indexerMetacartes(lignes, metaDe), metacarteDe: metaDe };
    const jointsIds = new Set(lignes.map(l => l.idProduct));
    const rapport = { le: new Date().toISOString(), export: EXPORT, calibration: cal, verdict: v, sets: {}, designations: [] };
    for (const L of lignesEcrites) {
        const S = await lire(L);
        const produits = await J.produitsDeLExpansion(prod, L.exp);
        const expansion = [].concat(L.bulba.expansion)[0];
        const P = planDuSet({ base, entrees: S.entrees, produits, lignesDuSet: lignes.filter(l => l.slugSet === L.slugSet), jointsIds, tirage: L.bulba.tirage, expansion });
        const raisons = {};
        for (const r of P.refus) { const m = r.raison.replace(/\(.*\)/, '(…)').replace(/\d+/g, '#'); raisons[m] = (raisons[m] || 0) + 1; }
        if (P.ecartes.length) raisons['écarté : fiche mélangée / impression sans numéro'] = P.ecartes.length;
        console.log(`\n■ ${L.code} (${L.slugSet}) SIMULATION : ${P.retenus.length} lignes · ${new Set(P.retenus.map(x => x.d.carte._id)).size} cartes · ${P.impressions.size} impressions · écartés ${P.ecartes.length} · refusés ${P.refus.length}`);
        for (const [r, n] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)} · ${r}`);
        rapport.sets[L.code] = { slugSet: L.slugSet, tirage: L.bulba.tirage, expansion, lignes: P.retenus.length, cartes: new Set(P.retenus.map(x => x.d.carte._id)).size, impressions: P.impressions.size, ecartes: P.ecartes.length, raisons };
        for (const x of P.retenus) rapport.designations.push({ code: L.code, slugSet: L.slugSet, idProduct: x.p.idProduct, nom: x.p.name, carteId: x.d.carte._id, numero: x.d.numero });
    }
    if (arg('rapport')) { fs.writeFileSync(arg('rapport'), JSON.stringify(rapport, null, 1)); console.log(`\nrapport local écrit (INFORMATIF : l'outil d'écriture ne le lit pas) : ${arg('rapport')}`); }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
