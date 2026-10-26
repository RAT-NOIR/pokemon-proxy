// MUTANTS — chaque garde de la 5e voie est CASSÉE à tour de rôle ; le banc test-voie-deux-sources.js doit alors ÉCHOUER (sinon la garde n'est pas gardée). Le fichier est toujours restauré.
//   node mutants-voie-deux-sources.js
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const F = path.join(__dirname, 'collecte-cartes', 'fiches-prouvees.js'), V = path.join(__dirname, 'collecte-cartes', 'voie-deux-sources.js'), D = path.join(__dirname, 'collecte-cartes', 'deux-sources.js');
const MUTANTS = [
    ['la contradiction ne refuse plus', F, "if (contre.length) refus.push(`deux-sources : contradiction", "if (false) refus.push(`deux-sources : contradiction"],
    ['le rejeu de la seconde source ne refuse plus', F, "if (!r.ok) refus.push(`deux-sources : la seconde source ne tient pas au rejeu", "if (false) refus.push(`deux-sources : la seconde source ne tient pas au rejeu"],
    ['la fiche simple désignée ne refuse plus', F, "if (carte.ficheSimple) refus.push(", "if (false) refus.push("],
    ['la carte hors du set ne refuse plus', F, "if (!(carte.sets || []).includes(entree.slugSet)) refus.push(", "if (false) refus.push("],
    ['le départage par le set de la fiche simple est retiré', F, "if (slugSet != null && (c.sets || []).length && !c.sets.includes(slugSet)) return false;", "if (false) return false;"],
    ['le départage par le set écarte aussi une fiche simple sans set connu', F, "if (slugSet != null && (c.sets || []).length && !c.sets.includes(slugSet)) return false;", "if (slugSet != null && !(c.sets || []).includes(slugSet)) return false;"],
    ['une finition est excusée sans comparer au nom du produit', D, "&& nuNom(m[1].replace(FINITION_EN_SUFFIXE, '')) === nuNom(nomProduit)) return false;", ") return false;"],
    // (mutant ÉQUIVALENT retiré : « une finition est excusée même sans nom de produit » — nuNom(null) vaut '' et ne peut égaler un nom non vide ; le garde `nomProduit != null` n'est que lisible)
    ['aucune finition n\'est excusée', D, "if (nomProduit != null && FINITION_EN_SUFFIXE.test(m[1])", "if (false && FINITION_EN_SUFFIXE.test(m[1])"],
    // (mutant ÉQUIVALENT retiré : « le produit sans numéro ne refuse plus » — rejouer() refuse déjà un numéro nul, le garde de prouver() n'est que le message nommé)
    ['les autres candidates ne refusent plus', F, "else if (autres.length) refus.push(`deux-sources", "else if (false) refus.push(`deux-sources"],
    ['le départage écarte toute fiche simple (même au bon numéro)', F, "return !(connus.size && !connus.has(n));", "return false;"],
    ['le départage n\'écarte jamais', F, "return !(connus.size && !connus.has(n));", "return true;"],
    ['le départage écarte une fiche simple SANS numéro connu', F, "return !(connus.size && !connus.has(n));", "return !connus.has(n);"],
    ['le départage écarte aussi les vraies cartes', F, "if (!c.ficheSimple) return true;", "if (false) return true;"],
    ['un nom illisible devient une contradiction', D, "if (!m || !nomLisible(m[1])) return false;", "if (!m) return false;"],
    ['une contradiction lisible n\'en est plus une', D, "if (!m || !nomLisible(m[1])) return false;", "return false;"],
    ['A2 : le planificateur ne passe plus par poser-numerotation', V, "const R = NUM.planifier({ lignes: virtuelles,", "const R = NUM.planifier({ lignes: [].concat(virtuelles.length ? [] : []),"],
    ['un produit qui a déjà une ligne est repris', V, "if (autres.length) { non(", "if (false) { non("],
    ['la matière spéciale est reprise', V, "if (estMatiereSpeciale(e.idProduct)) { non(", "if (false) { non("],
    ['--attendu ne compte plus', V, "if (plan.lignes.length !== attendu) return", "if (false) return"],
    ['--attendu tolère les refus', V, "if (plan.refus && plan.refus.length) return", "if (false) return"],
    ['les impressions sont posées même si les lignes ne se relisent pas', V, "if (!(r.lignes === plan.lignes.length && rl.ok && routees === plan.lignes.length)) {", "if (false) {"],
    ['les impressions d\'abord', V, "const r = await ecrireFiches(db, plan.lignes, metaDe, new Map());", "await ecrireLot({ db, R: { aPoser: plan.R.aPoser, numerosFiche: [] }, preuveDe: () => 'x', nomListe, log, err }); const r = await ecrireFiches(db, plan.lignes, metaDe, new Map());"]
];
const C = path.join(__dirname, 'poser-fiches-voie-deux-sources.js');
// les mutants de l'OUTIL (banc test-poser-fiches-voie-deux-sources.js)
const MUTANTS_OUTIL = [
    ['--ecrire accepté hors lot-additif', C, "try { require('./collecte-cartes/phase2-visuels').garderSousLot(", "try { (() => {})("],
    ['--ecrire sans --seulement/--attendu', C, "if (!arg('seulement') || arg('attendu') === undefined) {", "if (false) {"],
    ['un argument inconnu passe', C, "if (inconnus.length || !arg('liste') || ecrire === simuler) {", "if (!arg('liste') || ecrire === simuler) {"],
    ['les deux modes ensemble passent', C, "|| ecrire === simuler) {", "|| (!ecrire && !simuler)) {"],
    ['un produit non confirmé entre dans le plan', C, "if (!d.ok) { refus.push(", "if (false) { refus.push("],
    ['--seulement hors liste ne refuse plus', C, "if (absents.length) {", "if (false) {"],
    ['la liste prête n\'est plus écrite', C, "if (arg('pret')) ecrireFichier(", "if (false) ecrireFichier("]
];
let tues = 0, vivants = [];
const TESTS = { [C]: 'test-poser-fiches-voie-deux-sources.js' };
for (const [nom, fichier, de, vers] of [...MUTANTS, ...MUTANTS_OUTIL]) {
    const original = fs.readFileSync(fichier, 'utf8');
    if (!original.includes(de)) { console.log(`  ⚠️ ${nom} : motif introuvable (le mutant n'a pas été appliqué)`); vivants.push(nom + ' (motif introuvable)'); continue; }
    try {
        fs.writeFileSync(fichier, original.replace(de, vers));
        const r = spawnSync(process.execPath, [path.join(__dirname, TESTS[fichier] || 'test-voie-deux-sources.js')], { encoding: 'utf8', env: process.env });
        if (r.status !== 0) { tues++; console.log(`  ✅ tué : ${nom}`); } else { vivants.push(nom); console.log(`  ❌ VIVANT : ${nom}`); }
    } finally { fs.writeFileSync(fichier, original); }
}
console.log(`\n${tues} mutants tués sur ${MUTANTS.length + MUTANTS_OUTIL.length}${vivants.length ? ` · vivants : ${vivants.join(' | ')}` : ''}`);
process.exitCode = vivants.length ? 1 : 0;
