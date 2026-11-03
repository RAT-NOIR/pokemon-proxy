'use strict';
// Mutants de collecte-cartes/slug-produit.js : chacun doit faire ÉCHOUER test-slug-produit.js. Original restauré en finally.
const fs = require('fs');
const path = require('path');

const CIBLE = path.join(__dirname, 'collecte-cartes', 'slug-produit.js');
const SAUVE = CIBLE + '.sauvegarde-mutants';
const original = fs.readFileSync(CIBLE, 'utf8');

const MUTANTS = [
    ['(a) slug déjà posé accepté', "if (plein(ligne && ligne.slug)) return { refus: 'slug-deja-pose' };", ''],
    ['(b) produit non appris accepté', "if (!appris) return { refus: 'produit-non-appris' };", 'if (!appris) appris = {};'],
    ['(c) slug non appris accepté', "if (!plein(appris.slug)) return { refus: 'slug-non-appris' };", ''],
    ['(d) slug pollué accepté', "if (!FORME_SLUG.test(appris.slug)) return { refus: 'slug-pollue' };", ''],
    ['(d) ? accepté', '/^[A-Za-z0-9]+(-', '/^[A-Za-z0-9?]+(-'],
    ['(d) / accepté', '/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;', '/^[A-Za-z0-9/]+(-[A-Za-z0-9]+)*$/;'],
    ['(d) liste blanche remplacée par liste noire', '!FORME_SLUG.test(appris.slug)', '/[?\\s/]/.test(appris.slug)'],
    ['(1) ambigu non refusé', "if (appris.ambigu) return { refus: 'produit-ambigu' };", ''],
    ['(1) slugs distincts non vus', 'slugs.size > 1 || sets.size > 1', 'sets.size > 1'],
    ['(1) slugSets distincts non vus', 'slugs.size > 1 || sets.size > 1', 'slugs.size > 1'],
    ['(1) même slug jugé ambigu', 'slugs.size > 1 ||', 'docs.length > 1 ||'],
    ['(e) expansion différente acceptée', "if (appris.idExpansion != null && appris.idExpansion !== ligne.idExpansion) return { refus: 'expansion-differente' };", ''],
    ['(e) expansion absente refusée', 'appris.idExpansion != null &&', 'true &&'],
    ['(f) slugSet différent accepté', "if (sLigne && sAppris && sLigne !== sAppris) return { refus: 'slugSet-different' };", ''],
    ['(g) slugSet jamais posé', 'if (!sLigne && sAppris) set.slugSet = sAppris;', ''],
    ['(g) slugSet toujours écrasé', 'if (!sLigne && sAppris) set.slugSet = sAppris;', 'if (sAppris) set.slugSet = sAppris;'],
    ['RAISONS non gelée', 'const RAISONS = Object.freeze([', 'const RAISONS = (['],
];

let tues = 0;
try {
    fs.writeFileSync(SAUVE, original);
    for (const [nom, de, vers] of MUTANTS) {
        if (!original.includes(de)) throw new Error(`mutant « ${nom} » : motif introuvable dans l'original`);
        fs.writeFileSync(CIBLE, original.replace(de, vers));
        // banc rejoué dans le processus (caches vidés), sans child_process : une assertion qui lève = mutant tué
        for (const k of Object.keys(require.cache)) if (/slug-produit\.js$/.test(k) || /test-slug-produit\.js$/.test(k)) delete require.cache[k];
        const logOrig = console.log; console.log = () => {};
        let tue = false;
        try { require('./test-slug-produit.js'); } catch (e) { tue = true; } finally { console.log = logOrig; }
        if (tue) tues++;
        console.log(`${tue ? 'tué    ' : 'SURVIVANT'}  ${nom}`);
    }
} finally {
    fs.writeFileSync(CIBLE, original);
    try { fs.unlinkSync(SAUVE); } catch (e) { /* déjà absent */ }
}
console.log(`${tues} tués sur ${MUTANTS.length}`);
process.exitCode = tues === MUTANTS.length ? 0 : 1;
