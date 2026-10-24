// ============================================================
// LA LISTE `--seulement` D'UN LOT (PHASE 3a-SUITE) — local, aucune base, aucune requête
// ============================================================
//   node construire-liste-lot.js --confirmation=<deux-sources-plans>.json --plan=<nom du plan> --sauf=<produits-detaches-phase2.json> --sortie=<liste>.json
// `--confirmation` est la sortie de `scanner-deux-sources.js --plans=` (par plan, par ligne : ok = confirmée par une source indépendante de Cardmarket et de Bulbapedia). La liste écrite
// est celle que l'outil de pose lit par `--seulement` (collecte-cartes/lot-seulement.js) : confirmées, moins les produits détachés par décision, moins la matière spéciale.
// Sortie : S8\PHASE3A-SUITE seulement (collecte-cartes/garde-ecriture.js::autoriser) ; elle imprime les exclus un à un, avec leur motif.
const fs = require('fs');
const path = require('path');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { estMatiereSpeciale } = require('./collecte-cartes/matiere-speciale');
const { construire, filtrerParCodes } = require('./collecte-cartes/lot-seulement');
const { lireSauf } = require('./collecte-cartes/produits-sauf');

const RACINE_SORTIES = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\PHASE3A-SUITE';
const AUTORISES = [/^--confirmation=.+\.json$/, /^--plan=[\w.-]+$/, /^--sauf=.+\.json$/, /^--sortie=.+\.json$/, /^--codes=[\w.,/-]+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CONF = arg('confirmation'), PLAN = arg('plan'), SAUF = arg('sauf'), SORTIE = arg('sortie');
if (!CONF || !PLAN || !SAUF || !SORTIE) { console.error('usage : --confirmation= --plan= --sauf= --sortie='); process.exit(2); }
try {
    const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'));
    if (!conf[PLAN]) throw new Error(`le plan « ${PLAN} » n'est pas dans la confirmation (${Object.keys(conf).join(', ')})`);
    const codes = (arg('codes') || '').split(',').filter(Boolean);
    const detail = codes.length ? filtrerParCodes(conf[PLAN].detail, codes) : conf[PLAN].detail;
    const sauf = lireSauf(SAUF);
    const { ids, refuses } = construire({ detail, sauf, estMatiere: estMatiereSpeciale });
    const sortie = autoriser(SORTIE, [RACINE_SORTIES]);
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    fs.writeFileSync(sortie, JSON.stringify(ids));
    console.log(`DÉNOMINATEUR : ${detail.length} lignes au plan « ${PLAN} » · ${ids.length} confirmées et libres · ${refuses.length} exclues`);
    for (const r of refuses) console.log(`   ✗ ${r.idProduct} : ${r.motif}`);
    console.log(`✅ liste écrite : ${sortie} (${ids.length} idProduct)`);
} catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
