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
    ['alias', 'le seuil de paires disparaît de la preuve', 'e.paires >= s.minPaires && (', '('],
    ['alias', 'la table fermée n’exige plus de preuve du tout', '&& preuveSuffisante(p, seuils);', '|| true;'],
    ['alias', 'une inclusion à sens unique est admise sous 20 paires', '(e.couvBulba >= s.couvBulbaMin || e.paires >= s.minPairesContenue)', 'true'],
    ['alias', 'l’inclusion à sens unique n’est plus un refus motivé', "? 'inclusion-a-sens-unique' : 'aucun-candidat'", "? 'aucun-candidat' : 'aucun-candidat'"],
    ['confronter', 'l’illustrateur se confirme par inclusion de sous-chaîne', 'return !!A && !!S && A === S; };', 'return !!A && !!S && (A === S || S.includes(A) || A.includes(S)); };'],
    ['arbitrage', 'toute fausse est consommable par le lot 5', "a.solidite === 'forte'", 'true'],
    ['arbitrage', 'la majorité simple n’est plus de solidité forte', "accord.map(([source, valeur]) => ({ source, valeur })), 'forte');", 'accord.map(([source, valeur]) => ({ source, valeur })));'],
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
    ['provenance', 'un désaccord non arbitré est confirmé', "return reconf('desaccord', contre);", "return { confirmePar: nomsSources(ko), accord: 'plein', empreinteValeur: emp };"],
    ['provenance', 'une valeur sans comparaison est confirmée', "if (!ligne) return reconf('non-couvert');", "if (!ligne) return { confirmePar: [], accord: 'plein', empreinteValeur: emp };"],
    ['provenance', 'la valeur changée garde sa confirmation (empreinte ignorée)', 'if (ancienne.empreinteValeur !== neuve.empreinteValeur) return { entree: neuve, change: true };', ''],
    ['provenance', 'l’inclusion est comptée comme accord plein', "accord: 'partiel', empreinteValeur: emp", "accord: 'plein', empreinteValeur: emp"],
    ['provenance', 'le meilleur accord n’améliore plus une entrée', 'const mieux = (RANG[neuve.accord] || 0) > (RANG[ancienne.accord] || 0);', 'const mieux = false;'],
    ['provenance', 'une provenance étrangère de document est fusionnée', "if (etat === 'etrangere') { etrangere('cartes', k._id, 'provenance', true); continue; }", ''],
    ['provenance', 'une entrée de champ étrangère est écrasée', "if (ancienne !== undefined && !formeConnue(ancienne)) { etrangere(collection, _id, 'provenance.' + nom, false); return; }", ''],
    ['provenance', 'des impressions non tableau sont lues comme vides', 'if (p0.impressions !== undefined && !Array.isArray(p0.impressions)) {', 'if (false) {'],
    ['provenance', 'une sous-entrée d’impression étrangère est écrasée', "if (ancienne !== undefined && !formeConnue(ancienne)) { etrangere('cartes', k._id, `provenance.impressions[${kk}].${nom}`, false); continue; }", ''],
    ['provenance', 'un champ de set d’origine inconnue reçoit la provenance Bulbapedia', "if (typeof src === 'string' && /^bulbapedia/.test(src)) retenus.push(ch); else sansOrigine.push(ch);", 'retenus.push(ch);'],
    ['provenance', 'une entrée d’impression vide { k } est écrite', 'if (changeCet) {', 'if (true) {'],
    ['provenance', 'source et date ne sont plus posées au document', "champs['provenance.source'] = SOURCE; champs['provenance.le'] = maintenant;", ''],
    ['provenance', 'l’empreinte du plan dépend de la date', "canon(ecritures, ['le', 'provenance.le'])", 'canon(ecritures, [])'],
    ['provenance', 'le contenu des écritures n’est plus comparé au plan', 'if (plan.empreinteEcritures !== recalcul.empreinteEcritures)', 'if (false)'],
    ['provenance', '--sources / --variants libres avec --ecrire', 'options[o] != null && options[o] !== (plan.options || {})[o]', 'false'],
    ['provenance', 'l’empreinte donnée n’est plus comparée au fichier', 'if (shaFichier !== empreinteDonnee)', 'if (false)'],
    ['provenance', 'modifiedCount n’est plus comparé', '(Number.isFinite(modifies) && Number.isFinite(documents) && modifies !== documents)', 'false'],
    ['provenance', '--ecrire sans plan accepté', "if (!plan) erreurs.push(", 'if (false) erreurs.push('],
    ['provenance', 'confirmationValide ignore la valeur courante', 'x.empreinteValeur === empreinteValeur(valeur)', 'true'],
    ['provenance', 'la fusion écrase toujours (non idempotent)', 'if (!ancienne) return { entree: neuve, change: true };', 'return { entree: neuve, change: true };'],
    ['provenance', 'une confirmation peut se dégrader', 'if (ancienne.aReconfirmer && !neuve.aReconfirmer) return { entree: neuve, change: true };', 'if (neuve.aReconfirmer !== ancienne.aReconfirmer) return { entree: neuve, change: true };'],
    ['provenance', 'le nom est confirmé sans le témoin du nom', 'a.tirage === tir && a.nomOk', 'a.tirage === tir'],
    ['provenance', 'le numéro est confirmé sans le témoin du nom', 'a.idx === idx && a.nomOk', 'a.idx === idx'],
    ['provenance', 'l’écriture sort de « provenance. »', "champs['provenance.' + nom] = entree;", 'champs[nom] = entree;'],
    ['provenance', 'les impressions à clé en double se confondent', "return n === 1 ? base : `${base}#${n}`;", 'return base;'],
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
    // un motif introuvable n'est PAS un mutant tué : c'est un mutant invalide (le code a changé), il fait échouer le banc
    if (r.erreur && /^motif (absent|multiple)/.test(r.erreur)) { survivants++; log(`🔴 INVALIDE [${mod}] ${nom} — ${r.erreur.slice(0, 120)}`); continue; }
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
