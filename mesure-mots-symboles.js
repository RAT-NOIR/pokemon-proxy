// Les descriptions de symboles du prompt partagent-elles des mots ?
// LE PIÈGE MESURÉ : « eclair » était décrit comme « un éclat EN ÉTOILE bleu et violet »
// alors que « etoile » est une autre valeur de l'énumération. Le modèle a rendu « etoile »
// sur une carte N4. Ce n'est pas une hallucination : c'est le mot que le prompt lui a
// donné. Tout mot partagé entre deux descriptions est le même piège.
// LECTURE SEULE sur la source. MESURE SEULEMENT.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
// Les lignes de l'énumération : - "valeur" : description.
const lignes = [...source.matchAll(/^- "([a-z0-9-]+)"(?:, "[a-z0-9-]+")* : (.+)$/gm)]
    .map(m => ({ valeur: m[1], desc: m[2] }));

// Mots vides : ils sont partout et ne discriminent rien.
const VIDES = new Set(['un', 'une', 'le', 'la', 'les', 'de', 'des', 'du', 'et', 'ou', 'a', 'à',
    'au', 'aux', 'en', 'dans', 'sur', 'avec', 'sans', 'par', 'pour', 'ce', 'cet', 'cette',
    'son', 'sa', 'ses', 'il', 'elle', 'est', 'sont', 'qui', 'que', 'quel', 'plein', 'pleine',
    'petit', 'petite', 'grand', 'grande', 'contenant', 'vue', 'vide', 'seule', 'chiffre',
    'carte', 'set', 'symbole', 'lis', 'c', 'si', 'mais', 'non', 'pas', 'ne', 'y', 'd', 'l',
    'reponds', 'réponds', 'tu', 'te', 'se', 'sa', 'aucun', 'aucune', 'autre', 'autres',
    'cinq', 'deux', 'trois', 'quatre', 'meme', 'même', 'comme', 'leur', 'plus', 'tres', 'très']);

const motsDe = s => [...new Set(String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/).filter(m => m.length >= 3 && !VIDES.has(m)))];

console.log(`${lignes.length} entrées d'énumération lues dans le prompt\n`);

const parMot = new Map();
for (const l of lignes) {
    for (const m of motsDe(l.desc)) {
        if (!parMot.has(m)) parMot.set(m, []);
        parMot.get(m).push(l.valeur);
    }
}

// ⚠️ LE CAS LE PLUS DANGEREUX : une description contient le NOM d'une autre valeur.
console.log('══ UNE DESCRIPTION CONTIENT-ELLE LE NOM D\'UNE AUTRE VALEUR ? ══');
const noms = new Set(lignes.map(l => l.valeur));
let pieges = 0;
for (const l of lignes) {
    for (const m of motsDe(l.desc)) {
        if (noms.has(m) && m !== l.valeur) {
            pieges++;
            console.log(`   ❌ « ${l.valeur} » contient le mot « ${m} », qui est une AUTRE valeur`);
            console.log(`        ${l.desc}`);
        }
    }
}
if (!pieges) console.log('   ✅ aucune');

console.log('\n══ MOTS PARTAGÉS PAR PLUSIEURS DESCRIPTIONS ══');
const partages = [...parMot.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
if (!partages.length) console.log('   ✅ aucun');
for (const [m, vs] of partages) console.log(`   « ${m} » -> ${vs.join(', ')}`);
