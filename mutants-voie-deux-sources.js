// MUTANTS — chaque garde de la 5e voie est CASSÉE à tour de rôle ; le banc test-voie-deux-sources.js doit alors ÉCHOUER (sinon la garde n'est pas gardée). Le fichier est toujours restauré.
//   node mutants-voie-deux-sources.js
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const F = path.join(__dirname, 'collecte-cartes', 'fiches-prouvees.js'), V = path.join(__dirname, 'collecte-cartes', 'voie-deux-sources.js'), D = path.join(__dirname, 'collecte-cartes', 'deux-sources.js');
const MUTANTS = [
    ['la contradiction ne refuse plus', F, "if (contre.length) refus.push(`deux-sources : contradiction", "if (false) refus.push(`deux-sources : contradiction"],
    ['le rejeu de la seconde source ne refuse plus', F, "if (!r.ok) refus.push(`deux-sources : la seconde source ne tient pas au rejeu", "if (false) refus.push(`deux-sources : la seconde source ne tient pas au rejeu"],
    ['la fiche simple désignée ne refuse plus', F, "if (carte.ficheSimple) refus.push(", "if (false) refus.push("],
    ['la carte hors du set ne refuse plus', F, "if (!(carte.sets || []).includes(entree.slugSet)) refus.push(", "if (false) refus.push("],
    // (mutant ÉQUIVALENT retiré : « le produit sans numéro ne refuse plus » — rejouer() refuse déjà un numéro nul, le garde de prouver() n'est que le message nommé)
    ['les autres candidates ne refusent plus', F, "else if (autres.length) refus.push(`deux-sources", "else if (false) refus.push(`deux-sources"],
    ['le départage écarte toute fiche simple (même au bon numéro)', F, "return !(connus.size && !connus.has(n));", "return false;"],
    ['le départage n\'écarte jamais', F, "return !(connus.size && !connus.has(n));", "return true;"],
    ['le départage écarte une fiche simple SANS numéro connu', F, "return !(connus.size && !connus.has(n));", "return !connus.has(n);"],
    ['le départage écarte aussi les vraies cartes', F, "if (!c.ficheSimple) return true;", "if (false) return true;"],
    ['un nom illisible devient une contradiction', D, "return Boolean(m) && nomLisible(m[1]);", "return Boolean(m);"],
    ['une contradiction lisible n\'en est plus une', D, "return Boolean(m) && nomLisible(m[1]);", "return false;"],
    ['A2 : le planificateur ne passe plus par poser-numerotation', V, "const R = NUM.planifier({ lignes: virtuelles,", "const R = NUM.planifier({ lignes: [].concat(virtuelles.length ? [] : []),"],
    ['un produit qui a déjà une ligne est repris', V, "if (autres.length) { non(", "if (false) { non("],
    ['la matière spéciale est reprise', V, "if (estMatiereSpeciale(e.idProduct)) { non(", "if (false) { non("],
    ['--attendu ne compte plus', V, "if (plan.lignes.length !== attendu) return", "if (false) return"],
    ['--attendu tolère les refus', V, "if (plan.refus && plan.refus.length) return", "if (false) return"],
    ['les impressions sont posées même si les lignes ne se relisent pas', V, "if (!(r.lignes === plan.lignes.length && rl.ok && routees === plan.lignes.length)) {", "if (false) {"],
    ['les impressions d\'abord', V, "const r = await ecrireFiches(db, plan.lignes, metaDe, new Map());", "await ecrireLot({ db, R: { aPoser: plan.R.aPoser, numerosFiche: [] }, preuveDe: () => 'x', nomListe, log, err }); const r = await ecrireFiches(db, plan.lignes, metaDe, new Map());"]
];
let tues = 0, vivants = [];
for (const [nom, fichier, de, vers] of MUTANTS) {
    const original = fs.readFileSync(fichier, 'utf8');
    if (!original.includes(de)) { console.log(`  ⚠️ ${nom} : motif introuvable (le mutant n'a pas été appliqué)`); vivants.push(nom + ' (motif introuvable)'); continue; }
    try {
        fs.writeFileSync(fichier, original.replace(de, vers));
        const r = spawnSync(process.execPath, [path.join(__dirname, 'test-voie-deux-sources.js')], { encoding: 'utf8', env: process.env });
        if (r.status !== 0) { tues++; console.log(`  ✅ tué : ${nom}`); } else { vivants.push(nom); console.log(`  ❌ VIVANT : ${nom}`); }
    } finally { fs.writeFileSync(fichier, original); }
}
console.log(`\n${tues} mutants tués sur ${MUTANTS.length}${vivants.length ? ` · vivants : ${vivants.join(' | ')}` : ''}`);
process.exitCode = vivants.length ? 1 : 0;
