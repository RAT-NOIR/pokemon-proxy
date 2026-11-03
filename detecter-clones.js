'use strict';
// ============================================================
// DETECTER-CLONES — LECTURE SEULE (agent catalogue, 2026-11-03). Aucune base : le CACHE de l'audit suffit.
//   node detecter-clones.js [--cache=<lecture.json>]
// Écrit rat-market-travail/catalogue/clones/CLONES.json (la décision complète) et CLONES.md. Garde d'écriture : ce dossier seul.
// 🔑 Règles du site IMPORTÉES comme audit-sets.js les importe (impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet) ; la règle de classement vit dans
//    collecte-cartes/clones.js (module pur, banc test-clones.js).
// ============================================================
const fs = require('fs');
const path = require('path');
const { autoriser } = require('./collecte-cartes/garde-ecriture');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue';
const DOSSIER_CLONES = path.join(DOSSIER, 'clones');
const LIB_SITE = 'C:/Users/Yung/Desktop/rat-market-site/lib';

const args = process.argv.slice(2);
const inconnu = args.filter(a => !/^--cache=.+$/.test(a));
if (inconnu.length) { console.error(`argument inconnu : ${inconnu.join(' ')} (une ligne de commande est une garde : rien ne s'ouvre sur un drapeau non reconnu)`); process.exit(2); }
const cacheArg = (args.find(a => a.startsWith('--cache=')) || '').slice(8) || path.join(DOSSIER, 'audit-cache', 'lecture.json');

function formaterMd(r, le, cache) {
    const D = r.denominateurs, out = [];
    out.push('# CLONES — fiches hors composition (lecture seule)', '');
    out.push(`Généré le ${le} · outil : detecter-clones.js (module collecte-cartes/clones.js) · cache : ${cache}`, '');
    out.push('Un clone = appartenance `cartes.sets` sans produit rattaché dans le set, sans produit SANS_LIGNE du set qui puisse être le sien, et dont la carte a sa vraie fiche ailleurs.', '');
    out.push('## Dénominateurs', '');
    out.push(`- sets lus ${D.sets} · publiés ${D.setsPublies} · cartes ${D.cartes} · lignes cartes_produits ${D.lignes} · produits Cardmarket ${D.produits}`);
    out.push(`- appartenances auditées (carte x set publié avec produits) ${D.appartenancesAuditees} · dont avec un produit dans le set ${D.avecProduitDansLeSet}`, '');
    out.push('## Totaux', '');
    out.push(`- **clones ${r.clones.length}** · jointures-a-faire ${r.jointures.length} · orphelins ${r.orphelins.length} · sets sans produit ${r.setsSansProduit.length} (${r.setsSansProduit.reduce((a, s) => a + s.cartes, 0)} cartes)`);
    const imgs = r.clones.reduce((a, c) => a + c.images.length, 0), cop = r.clones.reduce((a, c) => a + c.images.filter(i => i.action === 'copier').length, 0);
    out.push(`- entrées d'images concernées ${imgs} (dont ${cop} copiées vers la vraie fiche, ${imgs - cop} retirées sans copie)`, '');
    out.push('### Clones par motif x tirage', '', '| tirage | produit-ailleurs | composition-autre-region | total |', '|---|---|---|---|');
    for (const [t, m] of Object.entries(r.parTirage).sort()) out.push(`| ${t} | ${m['produit-ailleurs'] || 0} | ${m['composition-autre-region'] || 0} | ${(m['produit-ailleurs'] || 0) + (m['composition-autre-region'] || 0)} |`);
    out.push('', `### Les ${Math.min(30, Object.keys(r.parSet).length)} sets les plus touchés`, '');
    for (const [s, n] of Object.entries(r.parSet).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 30)) out.push(`- ${s} : ${n}`);
    out.push('', '### 20 exemples « clone -> vraie fiche »', '');
    const vus = new Set(), ex = [];
    for (const c of r.clones) { if (vus.has(c.set) && ex.length < 12) continue; vus.add(c.set); ex.push(c); if (ex.length >= 20) break; }
    for (const c of ex) out.push(`- ${c.nomEn ?? '?'} (${c.carteId}) dans ${c.set} [${c.tirageSet}] -> ${c.vraieFiche ? `${c.vraieFiche.slugSet}${c.vraieFiche.numeroFiche ? ' / ' + c.vraieFiche.numeroFiche : ''}` : 'aucune fiche publiée'} · ${c.motif}`);
    const parSet = l => { const m = {}; for (const x of l) m[x.set] = (m[x.set] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); };
    const ai = r.aInstruire || [], aiRaison = {};
    for (const x of ai) aiRaison[x.raison] = (aiRaison[x.raison] || 0) + 1;
    out.push('', `### À INSTRUIRE (jamais supprimés par le lot) : ${ai.length}`, '', Object.entries(aiRaison).map(([k, n]) => `${k} ${n}`).join(' · ') || '—', '');
    for (const x of ai.slice(0, 20)) out.push(`- ${x.nomEn ?? '?'} (${x.carteId}) dans ${x.set} [${x.tirageSet}] · ${x.motif} · ${x.raison} -> ${x.vraieFiche ? x.vraieFiche.slugSet : 'aucune fiche publiée'}`);
    out.push('', '### jointures-a-faire (PAS des clones) par set', '', parSet(r.jointures).slice(0, 40).map(([s, n]) => `${s} ${n}`).join(' · ') || '—');
    out.push('', '### orphelins (PAS des clones) par set', '', parSet(r.orphelins).slice(0, 40).map(([s, n]) => `${s} ${n}`).join(' · ') || '—');
    out.push('', '### sets sans produit Cardmarket (jamais vidés)', '', r.setsSansProduit.map(s => `${s.set} (${s.cartes})`).join(' · ') || '—', '');
    return out.join('\n');
}

(async () => {
    const t0 = Date.now();
    const { classerClones } = require('./collecte-cartes/clones');
    const { chargerReglesSite } = require('./collecte-cartes/charger-regles-site');
    const { impressionDuSet, normaliserNumero } = await chargerReglesSite({ lib: LIB_SITE });
    const { expansionsDuSet, tirageDuSet } = await import(require('url').pathToFileURL(`${LIB_SITE}/entreesDuSet.ts`).href);
    const regles = { impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet };
    for (const [k, f] of Object.entries(regles)) if (typeof f !== 'function') throw new Error(`règle du site non importée : ${k}`);
    const lecture = JSON.parse(fs.readFileSync(cacheArg, 'utf8'));
    if (lecture.formatCache !== 2) throw new Error('cache d\'un autre format que 2 : relancer audit-sets.js');
    console.log(`lecture relue du cache (${lecture.le})`);
    const r = classerClones(lecture, regles);
    const D = r.denominateurs;
    console.log(`dénominateurs : ${JSON.stringify(D)}`);
    const le = new Date().toISOString();
    fs.mkdirSync(DOSSIER_CLONES, { recursive: true });
    const jsonSortie = autoriser(path.join(DOSSIER_CLONES, 'CLONES.json'), [DOSSIER_CLONES]), mdSortie = autoriser(path.join(DOSSIER_CLONES, 'CLONES.md'), [DOSSIER_CLONES]);
    fs.writeFileSync(jsonSortie, JSON.stringify({ le, lectureDu: lecture.le, ...r }));
    fs.writeFileSync(mdSortie, formaterMd(r, le, cacheArg));
    console.log(`clones ${r.clones.length} · par motif ${JSON.stringify(r.parMotif)} · par tirage ${JSON.stringify(r.parTirage)}`);
    console.log(`à instruire (non supprimables) ${r.aInstruire.length} · jointures-a-faire ${r.jointures.length} · orphelins ${r.orphelins.length} · sets sans produit ${r.setsSansProduit.length}`);
    console.log(`écrit ${jsonSortie} et ${mdSortie} · ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
