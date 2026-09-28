// ============================================================
// LA LISTE DE L'USERSCRIPT — régénérée depuis LISTE-SEUL-CARDMARKET-*.json (apprendre-par-tcgdex.js), triée par VALEUR
// ============================================================
//   node generer-cibles-userscript.js --liste=LISTE-SEUL-CARDMARKET-2026-09-26.json            (mesure : ce qui entrerait, rien d'écrit)
//   node generer-cibles-userscript.js --liste=… --ecrire                                        (réécrit le bloc LISTE / CIBLES / PRODUITS_EXPORT)
//
// 🔑 LA DEMANDE (testeur, 2026-09-26) : « garde à jour LISTE-SEUL-CARDMARKET, triée par valeur, pour que mes passes Tampermonkey
// visent d'abord ce qui compte ». La liste de la 1.8 avait été posée À LA MAIN dans le script le 25/09 : sans outil, elle ne
// pouvait que vieillir (1 346 jamais appris annoncés, 741 aujourd'hui). Ce qui y entre :
//   · les produits JAMAIS APPRIS que TCGdex ne couvre pas, et les produits appris SANS SLUG (le slug n'est que chez Cardmarket) ;
//   · SEULEMENT s'ils avaient une offre au guide (30/08) : un produit sans offre n'apparaît pas dans les listes de Cardmarket
//     (journal 1.8 : BREAKthrough 36 jamais vus, 36 sans offre) — la passe ne le verrait pas, il attend une autre voie ;
//   · triés par VALEUR : expansions par valeur totale de leurs cibles, puis nombre de cibles.
// Le bloc remplacé est borné par deux lignes du script (« // La liste du » et « const PRODUITS_EXPORT ») : si l'une manque, rien
// n'est écrit. L'écriture passe par Node en UTF-8 — jamais par Set-Content (CLAUDE.md §3).
const fs = require('fs');
const path = require('path');
// (1.10, 2026-09-28) --pages=PAGES-UTILES-<date>.json (generer-pages-utiles.js) : la liste ordonnée des PAGES à visiter, écrite dans
// le même bloc (`PAGES_UTILES`) — l'userscript montre la prochaine et dit si la page ouverte en fait partie.
const AUTORISES = [/^--liste=.+\.json$/, /^--ecrire$/, /^--export=.+\.json$/, /^--pages=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const LISTE_F = arg('liste'), EXPORT = arg('export') || 'products_singles_24092026.json', ecrire = process.argv.includes('--ecrire');
if (!LISTE_F || !fs.existsSync(LISTE_F)) { console.error('❌ --liste=<LISTE-SEUL-CARDMARKET-*.json> requis'); process.exit(2); }
const SCRIPT = path.join(__dirname, 'userscript-apprentissage.js');

const L = JSON.parse(fs.readFileSync(LISTE_F, 'utf8'));
// relecture du 2026-09-28 : sans --pages, l'écriture posait `PAGES_UTILES = []` sans un mot — le panneau perdait sa liste de pages.
// L'écriture exige la liste de pages ; la mesure seule peut s'en passer.
if (ecrire && !arg('pages')) { console.error('❌ --ecrire exige --pages=PAGES-UTILES-<date>.json (generer-pages-utiles.js) : sans elle, PAGES_UTILES serait vidé'); process.exit(2); }
const PAGES = arg('pages') ? JSON.parse(fs.readFileSync(arg('pages'), 'utf8')) : null;
if (PAGES && (!Array.isArray(PAGES.pages) || !PAGES.pages.every(x => x.ordre && x.idExpansion && x.site && x.url && Array.isArray(x.cibles)))) { console.error(`❌ ${arg('pages')} : « pages » illisible (ordre, idExpansion, site, url, cibles)`); process.exit(1); }
// (1.11, 2026-09-28) le TRI de chaque page : « a » nom croissant, « d » nom décroissant (au-delà des 300 que Cardmarket montre), « q »
// recherche du nom (au milieu d'une liste de plus de 600). Une liste de pages d'avant (sans `tri`) est refusée : elle envoyait au-delà
// de la page 10, où Cardmarket ne montre rien — c'est ce qu'on corrige.
const TRI_COURT = { name_asc: 'a', name_desc: 'd', recherche: 'q' };
if (PAGES && !PAGES.pages.every(x => TRI_COURT[x.tri] && (x.tri !== 'recherche' || x.recherche) && (x.tri === 'recherche' || x.site <= 10))) { console.error(`❌ ${arg('pages')} : une page sans tri connu, recherche sans nom, ou au-delà de la page 10 — régénérer par generer-pages-utiles.js`); process.exit(1); }
if (PAGES) console.log(`PAGES UTILES : ${PAGES.pages.length} pages (${PAGES.pages.filter(x => x.sure).length} sûres) · ${PAGES.cibles} cibles · liste ${PAGES.liste}`);
if (!L.pourTaPasse || !L.sansSlug) throw new Error(`${LISTE_F} : ni « pourTaPasse » ni « sansSlug » — liste d'avant le 2026-09-26 soir, régénérer par apprendre-par-tcgdex.js`);
const cibles = [...L.pourTaPasse.produits.map(p => ({ ...p, k: 'J' })), ...L.sansSlug.produits.filter(p => p.visibleDansLesListes).map(p => ({ ...p, k: 'V' }))];
const parExp = new Map();
for (const p of cibles) {
    const e = parExp.get(p.idExpansion) || parExp.set(p.idExpansion, { idExpansion: p.idExpansion, code: p.code ?? null, slugSet: p.slugSet ?? null, J: 0, V: 0, valeur: 0, produits: [] }).get(p.idExpansion);
    e[p.k]++; e.valeur += p.prixTendance || 0; e.produits.push(p);
    if (!e.slugSet && p.slugSet) e.slugSet = p.slugSet;
}
const exps = [...parExp.values()].filter(e => e.idExpansion != null).sort((a, b) => b.valeur - a.valeur || (b.J + b.V) - (a.J + a.V));
const tousSingles = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
const nExport = new Map(); for (const p of tousSingles) nExport.set(p.idExpansion, (nExport.get(p.idExpansion) || 0) + 1);
const nomDe = new Map(tousSingles.map(p => [p.idProduct, p.name]));
const jamais = cibles.filter(c => c.k === 'J').length, vides = cibles.filter(c => c.k === 'V').length;
console.log(`DÉNOMINATEURS : ${L.jamaisAppris.total} jamais appris (dont ${L.pourTaPasse.total} visibles, ${L.invisibles.total} invisibles) · ${L.sansSlug.total} sans slug (dont ${vides} visibles) → ${cibles.length} cibles sur ${exps.length} expansions`);
for (const e of exps.slice(0, 12)) console.log(`   ${e.idExpansion} ${e.code ?? '—'} ${e.slugSet ?? ''} : ${e.J} jamais appris, ${e.V} slug vide · ${Math.round(e.valeur)} €`);

const libelle = e => `${[e.code, e.slugSet].filter(Boolean).join(' ') || e.idExpansion} — ${[e.J ? `${e.J} jamais appris` : null, e.V ? `${e.V} slug vide` : null].filter(Boolean).join(', ')} · ${Math.round(e.valeur)} €`;
// La date de la MESURE, pas celle du lancement (relecture du 2026-09-26) : une « galerie parcourue » ne compte que si elle l'a été
// après la mesure — et la mesure, c'est `genere` de la liste.
if (!L.genere || Number.isNaN(Date.parse(L.genere))) throw new Error(`${LISTE_F} : pas de date « genere » lisible — la liste ne dit pas quand elle a été mesurée`);
const maintenant = new Date(L.genere).toISOString().slice(0, 16) + ':00Z';
const bloc = [
    `  // La liste du ${new Date().toISOString().slice(0, 10)} (${path.basename(LISTE_F)}, generer-cibles-userscript.js) : ce que SEUL Cardmarket peut t'apprendre ET`,
    `  // que ta passe peut VOIR (une offre au guide du 30/08) — ${jamais} jamais appris, ${vides} au slug vide, ${exps.length} expansions, triées par VALEUR`,
    `  // (prix de tendance du guide). Les ${L.invisibles.total} invisibles (aucune offre : absents des listes Cardmarket) n'y sont pas.`,
    `  const LISTE = [${exps.map(e => JSON.stringify([e.idExpansion, libelle(e)])).join(',\n    ')}];`,
    '',
    '  // Les produits CIBLES, par expansion : [idProduct, « J » jamais appris | « V » slug vide, nom du catalogue], les plus chers d\'abord.',
    `  const CIBLES = ${JSON.stringify(Object.fromEntries(exps.map(e => [e.idExpansion, e.produits.sort((a, b) => (b.prixTendance ?? -1) - (a.prixTendance ?? -1)).map(p => [p.idProduct, p.k, nomDe.get(p.idProduct) ?? p.nom ?? null])])))};`,
    '',
    `  // Les PAGES UTILES (${PAGES ? path.basename(arg('pages')) : 'aucune liste de pages'}, generer-pages-utiles.js) : [ordre, idExpansion, page, sûre (1/0/null), voisine de marge (1/0),`,
    '  // [idProduct des cibles], code, slugSet, chemin, tri (« a » nom croissant, « d » décroissant, « q » recherche), nom cherché (« q » seulement)]',
    '  // — la page où chaque produit à apprendre se trouve, dans l\'ordre de valeur.',
    `  const PAGES_UTILES = ${JSON.stringify((PAGES?.pages || []).map(x => [x.ordre, x.idExpansion, x.site, x.sure == null ? null : x.sure ? 1 : 0, x.voisine ? 1 : 0, x.cibles.map(c => c.idProduct), x.code ?? null, x.slugSet, x.url, TRI_COURT[x.tri], x.recherche ?? null]))};`,
    '',
    '  // Le nombre de produits de chaque expansion de la liste dans l\'export Cardmarket du 24/09 (TOUS les Singles, cartes-code',
    '  // comprises : c\'est ce que la galerie montre). Comparé au total que Cardmarket annonce sur la page : s\'il est plus petit, un',
    '  // filtre ou une limite de la page masque des produits.',
    `  const PRODUITS_EXPORT = ${JSON.stringify(Object.fromEntries([...new Set([...exps.map(e => e.idExpansion)])].sort((a, b) => a - b).map(e => [e, nExport.get(e) ?? null])))};`
].join('\n');

const src = fs.readFileSync(SCRIPT, 'utf8');
const fin = src.includes('\r\n') ? '\r\n' : '\n';   // les fins de ligne du fichier, telles qu'elles sont (autocrlf)
const debut = src.search(/^  \/\/ La liste du /m);
const mFin = /^  const PRODUITS_EXPORT = .*$/m.exec(src);
const mMesure = /^  const MESURE_LISTE = Date\.parse\('[^']+'\);\r?$/m.exec(src);
if (debut < 0 || !mFin || mFin.index < debut || !mMesure) { console.error('❌ ARRÊT : les bornes du bloc (« // La liste du », « const PRODUITS_EXPORT », « const MESURE_LISTE ») ne sont pas toutes trouvées — rien n\'est écrit'); process.exit(1); }
// La zone remplacée doit être EXACTEMENT le bloc attendu : LISTE, CIBLES et PRODUITS_EXPORT, une fois chacun, et rien du code autour.
const zone = src.slice(debut, mFin.index + mFin[0].length);
const compte = re => (zone.match(re) || []).length;
// PAGES_UTILES : 0 fois dans un bloc d'avant la 1.10, 1 fois après — jamais plus
if (compte(/^  const LISTE = /gm) !== 1 || compte(/^  const CIBLES = /gm) !== 1 || compte(/^  const PRODUITS_EXPORT = /gm) !== 1 || compte(/^  const PAGES_UTILES = /gm) > 1 || compte(/^  (?:function|async function|const (?!LISTE |CIBLES |PRODUITS_EXPORT |PAGES_UTILES )\w+ =)/gm) !== 0) {
    console.error('❌ ARRÊT : la zone entre les bornes ne contient pas exactement LISTE, CIBLES, PRODUITS_EXPORT (et au plus un PAGES_UTILES) — rien n\'est écrit'); process.exit(1);
}
let neuf = src.slice(0, debut) + bloc.split('\n').join(fin) + src.slice(mFin.index + mFin[0].length);
neuf = neuf.replace(/^  const MESURE_LISTE = Date\.parse\('[^']+'\);(\r?)$/m, `  const MESURE_LISTE = Date.parse('${maintenant}');$1`);
// Le script réécrit doit COMPILER avant d'être écrit : un bloc tronqué ne part jamais dans Tampermonkey.
try { new (require('vm').Script)(neuf, { filename: 'userscript-apprentissage.js' }); } catch (e) { console.error(`❌ ARRÊT : le script réécrit ne compile pas (${e.message}) — rien n'est écrit`); process.exit(1); }
console.log(`\n   bloc : ${zone.length} → ${bloc.length} caractères · MESURE_LISTE → ${maintenant} · fins de ligne ${fin === '\r\n' ? 'CRLF' : 'LF'} · compilation ✅`);
if (!ecrire) { console.log('   (mesure seule — relancer avec --ecrire)'); process.exit(0); }
fs.writeFileSync(SCRIPT, neuf, 'utf8');
console.log(`   ✅ ${SCRIPT} réécrit : ${exps.length} expansions, ${cibles.length} cibles`);
