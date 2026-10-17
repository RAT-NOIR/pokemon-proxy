// node test-mutants-bulba.js — les MUTANTS : chaque garde des modules du lot BULBA-DONNEES est cassée volontairement (une ligne de code remplacée), et la suite de bancs
// du module DOIT alors échouer. Un mutant qui survit est une garde que rien ne vérifie (« le test n'est pas refuse-t-elle quand il faut, mais SAIT-ELLE refuser »).
const fs = require('fs');
const path = require('path');
const Module = require('module');

const C = path.join(__dirname, 'collecte-cartes');
/** Charge `fichier` avec UNE substitution de texte (le motif doit apparaître exactement une fois), sans rien écrire sur le disque. */
function charger(fichier, ancien, nouveau) {
    const src = fs.readFileSync(fichier, 'utf8');
    const n = src.split(ancien).length - 1;
    if (n !== 1) throw new Error(`motif ${n === 0 ? 'absent' : 'multiple (' + n + ')'} dans ${path.basename(fichier)} : ${ancien.slice(0, 70)}`);
    const m = new Module(fichier, module); m.filename = fichier; m.paths = Module._nodeModulePaths(path.dirname(fichier));
    m._compile(src.replace(ancien, () => nouveau), fichier);
    return m.exports;
}

const SUITES = {
    confronter: [require('./test-confronter-bulba').suite, path.join(C, 'confronter-bulba.js')],
    alias: [require('./test-alias-sets-bulba').suite, path.join(C, 'alias-sets-bulba.js')],
    arbitrage: [require('./test-arbitrage-bulba').suite, path.join(C, 'arbitrage-bulba.js')],
    provenance: [require('./test-provenance-bulba').suite, path.join(C, 'provenance-bulba.js')],
};
// [module, nom du mutant, motif exact, remplacement]
const MUTANTS = [
    ['confronter', 'le nom n’est plus un témoin', "if (norm(c.name) !== norm(k.nomEn)) { appar.intl.nomDiff++; continue; }", ''],
    ['confronter', 'un numéro à deux cartes est tranché', "if (cs.length > 1) { appar.intl.doublon++; continue; }", ''],
    ['confronter', 'les variantes TCGdex ne suivent plus la rareté', "src === 'tdx' && Array.isArray(c.variants)", 'false'],
    ['confronter', 'l’alias de code japonais est ignoré', "if (AL.jp[kn] && AL.jp[kn].length) codes = AL.jp[kn];", 'if (false) codes = [];'],
    ['confronter', 'l’alias de set intl est ignoré', "if (al && Array.isArray(al[src]) && al[src].length) sks = al[src];", 'if (false) sks = [];'],
    ['confronter', 'les appariements ne portent plus le verdict du nom', "nomOk: norm(c.name) === norm(k.nomEn) });", 'nomOk: true });'],
    ['alias', 'le numéro seul prouve (piège des petits entiers)', "cleNum(num) + '\\u0000' + norm(nom)", "cleNum(num) + '\\u0000'"],
    ['alias', 'seuil minimal de paires à 1', 'minPaires: 5, couvBulbaMin', 'minPaires: 1, couvBulbaMin'],
    ['alias', 'un rival de taille comparable n’est plus ambigu', "if (e.paires >= seuils.rivalMin * el[0].paires) return sortie([], 'ambigu');", ''],
    ['alias', 'les parties d’une réunion peuvent se chevaucher', 'if (!chevauche) {', 'if (true) {'],
    ['alias', 'la table fermée n’exige plus le seuil de paires', 'p.paires >= seuils.minPaires &&', ''],
    ['alias', 'la table fermée n’exige plus de preuve du tout', 'typeof p.cle === \'string\' && p.cle.length > 0\n        && p.paires', 'typeof p.cle === \'string\' && p.cle.length > 0 || true\n        && p.paires'],
    ['arbitrage', 'la table des Pokédex est ignorée', 'const T = ctx.dexDuNom ? ctx.dexDuNom(l.contexte.nomEn) : null;', 'const T = null;'],
    ['arbitrage', 'un seul témoin suffit à corriger', 'filter(g => g.length >= 2)', 'filter(g => g.length >= 1)'],
    ['arbitrage', 'l’illustrateur d’un Dresseur se corrige', "l.contexte.categorie !== 'pokemon'", 'false'],
    ['arbitrage', 'toute convention est acceptée (pureté)', 'pu >= purete', 'true'],
    ['arbitrage', 'une convention à une seule observation', 'o.n >= minObs', 'true'],
    ['arbitrage', 'TCGdex « Rare » n’est plus neutre', "norm(tdx[1].valeur) === 'rare' && /rare/i.test(B)", 'false'],
    ['arbitrage', 'les variantes sans holo ne corrigent plus', 'if (variants && variants.nonHolo) {', 'if (false) {'],
    ['arbitrage', 'le périmètre d’un set se corrige', 'Math.abs(Number(r.correction) - Number(l.bulba)) > 2', 'false'],
    ['arbitrage', 'l’orthographe d’une attaque se corrige', "if (ko.some(([, x]) => memeAttaquesAPeuPres", 'if (false && ko.some(([, x]) => memeAttaquesAPeuPres'],
    ['arbitrage', 'la lignée TCGdex vaut une preuve forte', "const forte = concordantes.some(([s]) => s === 'jp' || s === 'pkc');", 'const forte = true;'],
    ['arbitrage', 'les synonymes de rareté sont ignorés', 'if (canonRarete(B) === canonRarete(x.valeur)) return', 'if (false) return'],
    ['provenance', 'un désaccord non arbitré est confirmé', 'return reconf({ contredit: nomsSources(ko) });', 'return { source: SOURCE, confirmePar: nomsSources(ko) };'],
    ['provenance', 'une valeur sans comparaison est confirmée', 'if (!ligne) return reconf();', 'if (!ligne) return { source: SOURCE, confirmePar: [] };'],
    ['provenance', 'la fusion écrase toujours (non idempotent)', 'if (!ancienne) return { entree: neuve, change: true };', 'return { entree: neuve, change: true };'],
    ['provenance', 'une confirmation peut se dégrader', 'if (ancienne.aReconfirmer && !neuve.aReconfirmer) return { entree: neuve, change: true };', 'if (neuve.aReconfirmer !== ancienne.aReconfirmer) return { entree: neuve, change: true };'],
    ['provenance', 'l’inclusion devient une confirmation pleine', 'partiel: true, ', ''],
    ['provenance', 'le nom est confirmé sans le témoin du nom', 'a.tirage === tir && a.nomOk', 'a.tirage === tir'],
    ['provenance', 'le numéro est confirmé sans le témoin du nom', 'a.idx === idx && a.nomOk', 'a.idx === idx'],
    ['provenance', 'l’écriture sort de « provenance. »', "champs['provenance.' + nom] = entree;", 'champs[nom] = entree;'],
    ['provenance', 'une date d’un autre fournisseur reçoit une provenance Bulbapedia', ' && bulba(s.dateSortieEnSource)', ''],
    ['provenance', 'les impressions à clé en double se confondent', 'const kk = n === 1 ? base : `${base}#${n}`;', 'const kk = base;'],
    ['provenance', 'une date d’un autre fournisseur est lue comme Bulbapedia (source jamais lue)', "if (!vide(s.dateSortieEn) && bulba(s.dateSortieEnSource))", 'if (!vide(s.dateSortieEn))'],
    ['provenance', 'l’arbitrage « juste » est ignoré', "arbitrage && arbitrage.verdict === 'juste'", 'false'],
    ['provenance', 'les tables comptent comme sources', 'const temoins = nomsSources((arbitrage.temoins || []).map(t => t.source));', "const temoins = [...new Set((arbitrage.temoins || []).map(t => t.source))];"],
];

let survivants = 0, tues = 0;
const log = console.log;
for (const [mod, nom, ancien, nouveau] of MUTANTS) {
    const [suite, fichier] = SUITES[mod];
    let r;
    console.log = () => {};
    try { r = suite(charger(fichier, ancien, nouveau)); } catch (e) { r = { ok: 0, ko: 1, erreur: e.message }; }
    console.log = log;
    const tue = r.ko > 0;
    tue ? tues++ : survivants++;
    log(`${tue ? '☠️  tué     ' : '🔴 SURVIT  '} [${mod}] ${nom}${r.erreur ? '  (exception : ' + r.erreur.slice(0, 80) + ')' : ''}`);
}
// la suite non mutée doit rester verte (sinon « tout est tué » ne prouve rien)
let verts = 0;
console.log = () => {};
const base = Object.fromEntries(Object.entries(SUITES).map(([k, [suite, f]]) => [k, suite(require(f))]));
console.log = log;
for (const [k, r] of Object.entries(base)) { log(`${r.ko === 0 ? '✅' : '❌'} suite non mutée [${k}] : ${r.ok} passés, ${r.ko} en échec`); if (r.ko === 0) verts++; }
log(`\n${MUTANTS.length} mutants : ${tues} tués, ${survivants} survivants · suites non mutées vertes : ${verts}/${Object.keys(SUITES).length}`);
if (survivants || verts !== Object.keys(SUITES).length) process.exit(1);
