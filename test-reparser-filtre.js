// node test-reparser-filtre.js — `collecteur-texte.js --reparser` n'efface que ce que joindre() sait REFABRIQUER (§59, relecture B de SEA-2 I1).
// Faux modèles en mémoire. TOOL_DIR=<dossier> rejoue le banc contre une copie mutée.
const fs = require('fs');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { effacerRefabricables, PREUVES_DE_JOINDRE } = require(path.join(DIR, 'collecte-cartes', 'preuves-jointure'));
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// le faux modèle : deleteMany applique le filtre ($in sur carteId, idExpansion, preuve) ; find().select().lean()
function monde() {
    const lignes = [
        { _id: 'a', carteId: 1, idProduct: 11, idExpansion: 5, preuve: 'set+numero' },
        { _id: 'b', carteId: 1, idProduct: 12, idExpansion: 5, preuve: 'setlist+nom+attaques' },
        { _id: 'c', carteId: 1, idProduct: 13, idExpansion: 5, preuve: 'metacarte+setlist' },
        { _id: 'd', carteId: 1, idProduct: 14, idExpansion: 5, preuve: 'metacarte+nom+attaques' },
        { _id: 'e', carteId: 1, idProduct: 15, idExpansion: 5, preuve: 'wcd+origine+numero' },
        { _id: 'f', carteId: 1, idProduct: 16, idExpansion: 5 },                       // aucune preuve : on ne sait pas, on GARDE
        { _id: 'g', carteId: 1, idProduct: 17, idExpansion: 6, preuve: 'set+numero' }, // une autre expansion : jamais touchée
        { _id: 'h', carteId: 2, idProduct: 21, idExpansion: 5, preuve: 'set+numero' }
    ];
    const cartes = new Map([[1, { _id: 1, liens: { idProduct: [11, 12, 13, 14, 15, 16, 17], idMetacards: [77] } }], [2, { _id: 2, liens: { idProduct: [21], idMetacards: [88] } }]]);
    const dedans = (f, d) => Object.entries(f).every(([k, v]) => v.$in.includes(d[k]));
    return { lignes, cartes, M: {
        CarteProduit: {
            deleteMany: async f => { for (let i = lignes.length - 1; i >= 0; i--) if (dedans(f, lignes[i])) lignes.splice(i, 1); },
            find: f => ({ select: () => ({ lean: async () => lignes.filter(l => l.carteId === f.carteId).map(l => ({ ...l })) }) })
        },
        Carte: { updateOne: async (f, u) => { const c = cartes.get(f._id); for (const [k, v] of Object.entries(u.$set || {})) { const p = k.split('.'); c[p[0]][p[1]] = v; } for (const k of Object.keys(u.$unset || {})) delete c.liens[k.split('.')[1]]; } }
    } };
}

(async () => {
    const w = monde();
    const r = await effacerRefabricables(w.M, [1, 2], [5]);
    verifier('un rejeu n\'efface que les lignes d\'une preuve que joindre() refabrique (set+numero, setlist+nom+attaques) dans l\'expansion du set', w.lignes.map(l => l._id).sort(), ['c', 'd', 'e', 'f', 'g']);
    verifier('   les lignes posées par d\'autres outils (metacarte+setlist, metacarte+nom+attaques, wcd…) et la ligne SANS preuve sont gardées', r.gardees, 4);
    verifier('   liens.idProduct se recompose depuis ce qui reste ; liens.idMetacards d\'une carte à lignes gardées est conservé', [w.cartes.get(1).liens.idProduct, w.cartes.get(1).liens.idMetacards], [[13, 14, 15, 16, 17], [77]]);
    verifier('   une carte sans ligne gardée voit ses liens recomposés (vides) et idMetacards remis à zéro comme avant', [w.cartes.get(2).liens.idProduct, w.cartes.get(2).liens.idMetacards], [[], []]);
    verifier('la liste fermée est exactement ce que joindre() produit', [...PREUVES_DE_JOINDRE].sort(), ['set+nom', 'set+nom+attaques', 'set+numero', 'setlist+nom', 'setlist+nom+attaques', 'setlist+numero']);
    // le câblage : collecteur-texte.js appelle effacerRefabricables et ne contient plus l'effacement nu
    const src = fs.readFileSync(path.join(DIR, 'collecteur-texte.js'), 'utf8');
    verifier('collecteur-texte.js --reparser passe par effacerRefabricables (pas de deleteMany nu sur cartes_produits)', [/effacerRefabricables\(M, idsCartes, expsDeCeSet\)/.test(src), /CarteProduit\.deleteMany\(\{ carteId: \{ \$in: idsCartes \}, idExpansion/.test(src)], [true, false]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
