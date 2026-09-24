// node test-images-cle-partagee.js — une clé (carte, set, numéro) que plusieurs images DIFFÉRENTES partagent ne désigne
// aucune d'elles (collecte-cartes/images-cle-partagee.js). Cas réels du 2026-09-24, lus à l'œil : « Victory Ring » porte le
// « numéro » XY-P sur 24 images de 24 tournois différents ; la jointure n'en gardait qu'une, la dernière lue.
const { clesPartagees, numeroSansChiffre } = require('./collecte-cartes/images-cle-partagee');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const r = (carteId, numero, sha256) => ({ carteId, im: { numero, sha256 } });

verifier('numéro sans chiffre : XY-P, SM-P, S-P ; DPBP#444 et 012 en ont un', ['XY-P', 'SM-P', 'S-P', 'DPBP#444', '012', null].map(numeroSansChiffre), [true, true, true, false, false, false]);
const resolues = [
    r(1, 'XY-P', 'a'), r(1, 'XY-P', 'b'), r(1, 'XY-P', 'c'),     // Victory Ring : trois tournois, une clé → aucune
    r(2, 'XY-P', 'd'),                                            // Red Card : une seule image sous sa clé → jointe
    r(3, 'XY-P', 'e'), r(3, 'XY-P', 'e'),                         // la MÊME image deux fois (même sha) → pas une ambiguïté
    r(4, '012', 'f'), r(4, '012', 'g'),                           // un vrai numéro : la règle ne s'applique pas (§20, coût nul ailleurs)
    r(5, null, 'h'), r(5, null, 'i')                              // sans numéro (Gym, decks à emplacements) : inchangé
];
verifier('seule la clé à numéro sans chiffre portée par plusieurs images différentes est refusée', [...clesPartagees(resolues)], ['1|XY-P']);
verifier('aucune image résolue : aucune clé', [...clesPartagees([])], []);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
