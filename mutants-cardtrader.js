// Mutants de collecte-cartes/cardtrader.js : chaque mutation est appliquée à une COPIE (cardtrader.mut.js, effacée ensuite) ; les bancs doivent ÉCHOUER. Un mutant qui survit = un banc qui ne garde rien.
//   node mutants-cardtrader.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, 'collecte-cartes', 'cardtrader.js');
const MUT = path.join(__dirname, 'collecte-cartes', 'cardtrader.mut.js');
const BANCS = ['test-cardtrader.js', 'test-cardtrader-lot.js'];

const MUTANTS = [
    ['supprimer le seuil de largeur', 'return w >= largeurMinDe(SOURCE) ?', 'return true ?'],
    ['abaisser le seuil à un plancher de 200 px', 'return w >= largeurMinDe(SOURCE) ?', 'return w >= 200 ?'],
    ['accepter une vignette en og:image', "if (v === '') return { url: u, via: 'og' };", "if (v === '' || v) return { url: u, via: 'og' };"],
    ['accepter une vignette dans la page (variante quelconque)', "const show = trouvees.find(u => classer(u) === 'show');", 'const show = trouvees.find(u => classer(u) !== null);'],
    ['accepter le dos de la carte (deux endroits)', ['blueprints/image/${id}/([^/?#]+)', '(/uploads/blueprints/image/${id}/[^"'], ['blueprints/(?:back_)?image/${id}/([^/?#]+)', '(/uploads/blueprints/(?:back_)?image/${id}/[^"']],
    ['accepter un ambigu', "if (p.statut === 'apparie') {", "if (p.statut === 'apparie' || p.statut === 'ambigu') {"],
    ['accepter un « à réserve »', "if (p.reserve) raison = 'a-reserve';", "if (false) raison = 'a-reserve';"],
    ['accepter un apparié sans carte', "else if (!Number.isInteger(p.carteId)) raison = 'sans-carte';", ''],
    ['écrire un conflit (deux blueprints pour une carte)', 'if (new Set(g.map(x => x.p.blueprint)).size > 1) {', 'if (false) {'],
    ['nommer la source dans la clé R2', 'const cleR2 = (slugSet, numero, carteId) => `${SOURCE}/', 'const cleR2 = (slugSet, numero, carteId) => `cardtrader/'],
    ['nommer la source dans le lot', "const LOT = 'ctr-2026-10';", "const LOT = 'cardtrader-2026-10';"],
    ['suivre une redirection (le client ne la juge plus)', 'const x = RH.lireImage(r, { suivi, hote: SOURCE_RACINE, url, dossierPauses });', "const x = r.octets ? { octets: r.octets } : { absente: true, issue: 'absente' };"],
    ['suivre une redirection (fetch)', "redirect: 'manual'", "redirect: 'follow'"],
    ['remplacer une image correcte au-dessus du seuil', "if (restantes.some(e => e.set === cand.set && memeNumero(e, cand.numero))) return {", 'if (false) return {'],
    ['ignorer le plafond de requêtes', 'if (n >= plafond) throw Object.assign(new Error(`plafond de requêtes atteint (${plafond})`), { plafond: true });\n        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }\n        dernier = now(); n++;\n        const r = await transport.get(url, { binaire: true });', 'if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }\n        dernier = now(); n++;\n        const r = await transport.get(url, { binaire: true });'],
    ['cadence sous 5 s', 'const cadence = Math.max(cadenceMs, CADENCE_MIN_MS);', 'const cadence = cadenceMs;'],
    ['image hors de /uploads/blueprints/image/', "!CHEMIN_IMAGE.test(new URL(url).pathname)", 'false'],
];

let survivants = 0, tues = 0;
const original = fs.readFileSync(SRC, 'utf8');
try {
    for (const [nom, de, vers] of MUTANTS) {
        const des = Array.isArray(de) ? de : [de], verss = Array.isArray(vers) ? vers : [vers];
        let ecrit = original, applicable = true;
        des.forEach((d, i) => { const n = ecrit.split(d).length - 1; if (n !== 1) { console.log(`❌ ${nom} : le motif « ${d.slice(0, 50)} » apparaît ${n} fois (1 attendu) — mutant non applicable`); applicable = false; } else ecrit = ecrit.replace(d, () => verss[i]); });
        if (!applicable) { survivants++; continue; }
        fs.writeFileSync(MUT, ecrit);
        const verdicts = BANCS.map(b => spawnSync(process.execPath, [path.join(__dirname, b)], { env: { ...process.env, CTR_MODULE: './collecte-cartes/cardtrader.mut.js' }, encoding: 'utf8', timeout: 120000 }));
        const tue = verdicts.some(v => v.status !== 0);
        console.log(`${tue ? '✅ tué ' : '🔴 SURVIT'} : ${nom}${tue ? ` (${BANCS.filter((b, i) => verdicts[i].status !== 0).join(', ')})` : ''}`);
        if (tue) tues++; else survivants++;
    }
} finally { try { fs.unlinkSync(MUT); } catch { /* absent */ } }
console.log(`${tues} tués, ${survivants} survivants sur ${MUTANTS.length}`);
process.exitCode = survivants ? 1 : 0;
