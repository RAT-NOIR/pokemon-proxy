// node test-vignettes-apres-jointure.js — le chemin du rejeu de jointure rend leurs vignettes aux entrées réécrites.
// Banc par INJECTION (pas de R2 ni de base) : il prouve QUE `assurerVignettes` est appelé et avec QUELS arguments ; que la
// vignette revienne depuis le document `images` (depuisDocument) est la preuve de test-vignette-scratch.js (bout en bout, R2).
const fs = require('fs');
const path = require('path');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

(async () => {
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
    const appels = [];
    const assurer = async (db, o) => { appels.push({ db, o }); return { entrees: 3, cles: 2, traitees: 2, fabriquees: 0, deja: 0, depuisDocument: 2, echecs: [], interrompu: false, sets: ['Set-A', 'Set-B'] }; };
    const db = { fictive: true }, arreter = () => false;
    const r = await vignetterApresJointure(db, 'Set-A', { bucket: 'bucket-x', arreter, assurer });
    verifier('assurerVignettes est appelé une fois, sur la base donnée', [appels.length, appels[0].db === db], [1, true]);
    verifier('mêmes options que le worker : bucket, slug du set, parallèle 4, arrêt relayé', [appels[0].o.bucket, appels[0].o.slug, appels[0].o.parallele, appels[0].o.arreter === arreter], ['bucket-x', 'Set-A', 4, true]);
    verifier('le bilan est celui que le worker écrit (depuisDocument compris) et rend les sets vignettés', [r.vg.depuisDocument, r.vg.entrees, r.vg.echecs, r.sets], [2, 3, 0, ['Set-A', 'Set-B']]);
    const muet = { error() { } };
    const e = await vignetterApresJointure(db, 'Set-A', { bucket: 'b', journal: muet, assurer: async () => { throw new Error('R2 injoignable'); } });
    verifier('un échec ne lève pas : il est rendu, aucun set', [e.vg.erreur, e.sets], ['R2 injoignable', []]);

    // Le worker ET le rejeu passent par cette fonction (une seule définition) — lu dans le source, pas supposé.
    const src = fs.readFileSync(path.join(__dirname, 'collecteur-images.js'), 'utf8');
    verifier('collecteur-images.js appelle vignetterApresJointure à DEUX endroits (worker et rejeu)', (src.match(/vignetterApresJointure\(/g) || []).length, 2);
    verifier('collecteur-images.js n\'appelle plus assurerVignettes directement', /assurerVignettes\(/.test(src), false);
    const rejeu = src.slice(src.indexOf("if (arg('rejouer-jointure')) {"), src.indexOf('`--verrou` : QUI tient'));
    verifier('le rejeu en écriture appelle la fonction ; en --simuler, jamais (le continue précède)', [/vignetterApresJointure\(/.test(rejeu), rejeu.indexOf('continue;') < rejeu.indexOf('vignetterApresJointure(')], [true, true]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
