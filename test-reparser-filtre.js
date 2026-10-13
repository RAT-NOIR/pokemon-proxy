// node test-reparser-filtre.js — `collecteur-texte.js --reparser` n'efface que ce que joindre() sait REFABRIQUER (§59, relecture B de SEA-2 I1).
// Faux modèles en mémoire. TOOL_DIR=<dossier> rejoue le banc contre une copie mutée.
const fs = require('fs');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { effacerRefabricables, PREUVES_DE_JOINDRE, PREUVES_GARDEES_PRODUITES } = require(path.join(DIR, 'collecte-cartes', 'preuves-jointure'));
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
        Carte: { findOne: f => ({ select: () => ({ lean: async () => structuredClone(cartes.get(f._id)) }) }),
            updateOne: async (f, u) => { const c = cartes.get(f._id); for (const [k, v] of Object.entries(u.$set || {})) { const p = k.split('.'); c[p[0]][p[1]] = v; } for (const k of Object.keys(u.$unset || {})) delete c.liens[k.split('.')[1]]; } }
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
    // ── tour 3 : la liste est LIÉE à jointure.js (§21 bis) — lue dans le SOURCE (non modifié : le worker le lit) ──
    // Les `preuve` que jointure.js produit : les littéraux « a+b[+c] » des lignes qui parlent de `preuve`, plus le gabarit `${source}+nom[+attaques]` avec les
    // valeurs de `source`. Si l'extraction ne trouve rien, le test échoue (un zéro sur un source non vide est un extracteur faux, §41).
    function preuvesProduites(texte) {
        const lignesPreuve = texte.split(/\r?\n/).filter(l => /preuve/.test(l));
        const litteraux = new Set(lignesPreuve.flatMap(l => [...l.matchAll(/'([a-z]+(?:\+[a-z]+)+)'/g)].map(m => m[1])));
        const sources = new Set([...(texte.match(/const source = [^;]*;/) || [''])[0].matchAll(/'([a-z]+)'/g)].map(m => m[1]));
        if (/`\$\{source\}\+nom\$\{[^`]*'\+attaques'[^`]*\}`/.test(texte)) for (const s of sources) { litteraux.add(`${s}+nom`); litteraux.add(`${s}+nom+attaques`); }
        return litteraux;
    }
    function classer(produites, effacables, gardees) {
        const problemes = [];
        for (const p of produites) if (!effacables.includes(p) && !gardees.includes(p)) problemes.push(`produite par jointure.js et classée nulle part : ${p}`);
        for (const e of effacables) if (!produites.has(e)) problemes.push(`effaçable mais jointure.js ne la produit plus : ${e}`);
        return problemes;
    }
    const jointureSrc = fs.readFileSync(path.join(DIR, 'collecte-cartes', 'jointure.js'), 'utf8');
    const produites = preuvesProduites(jointureSrc);
    verifier('l\'extracteur lit jointure.js : au moins les 6 preuves attendues (sinon l\'extracteur est faux, pas le fichier)', [...produites].sort(), ['set+nom', 'set+nom+attaques', 'set+numero', 'setlist+nom', 'setlist+nom+attaques', 'setlist+numero']);
    verifier('LIAISON : la liste effaçable (+ gardées explicites) est EXACTEMENT ce que jointure.js produit', classer(produites, PREUVES_DE_JOINDRE, PREUVES_GARDEES_PRODUITES), []);
    verifier('   une preuve FICTIVE dans la liste effaçable est détectée', classer(produites, [...PREUVES_DE_JOINDRE, 'fictive+x'], PREUVES_GARDEES_PRODUITES), ['effaçable mais jointure.js ne la produit plus : fictive+x']);
    verifier('   une preuve NEUVE produite par jointure.js et non classée est détectée', classer(new Set([...produites, 'neuve+preuve']), PREUVES_DE_JOINDRE, PREUVES_GARDEES_PRODUITES), ['produite par jointure.js et classée nulle part : neuve+preuve']);
    verifier('   … classée explicitement GARDÉE, elle est acceptée', classer(new Set([...produites, 'neuve+preuve']), PREUVES_DE_JOINDRE, ['neuve+preuve']), []);
    // ── lot M2 : la preuve des outils d'écriture est CLASSÉE (gardée par un rejeu), et liée au code qui la pose ──
    const P = require(path.join(DIR, 'collecte-cartes', 'preuves-jointure'));
    const outils = [['poser-fiches-par-setlist.js', 'metacarte+setlist'], ['poser-fiches-par-freres.js', 'metacarte+freres']];
    verifier('lot M2 : la liste des preuves d\'outils gardées par un rejeu est exactement celle des outils écrits', [...(P.PREUVES_D_OUTILS_GARDEES || [])].sort(), ['metacarte+freres', 'metacarte+setlist']);
    for (const [fichier, attendue] of outils) {
        const preuve = require(path.join(DIR, fichier)).PREUVE;
        verifier(`   ${fichier} : sa PREUVE exportée est « ${attendue} », classée gardée, absente de la liste effaçable, hors du filtre d'effacement`, [preuve, (P.PREUVES_D_OUTILS_GARDEES || []).includes(preuve), PREUVES_DE_JOINDRE.includes(preuve), P.filtreDeRegeneration([1], [5]).preuve.$in.includes(preuve)], [attendue, true, false, false]);
    }
    verifier('   le rejeu GARDE une ligne metacarte+freres (le faux modèle l\'efface seulement si elle est refabricable)', await (async () => { const w2 = monde(); w2.lignes.push({ _id: 'z', carteId: 1, idProduct: 99, idExpansion: 5, preuve: 'metacarte+freres' }); await effacerRefabricables(w2.M, [1, 2], [5]); return w2.lignes.some(l => l._id === 'z'); })(), true);
    // ── tour 1 du lot M2 : l'ORDRE de liens.idProduct se conserve (le repère d'adresse [0] du site) ──
    {
        const lignes = [
            { _id: 'a', carteId: 7, idProduct: 100, idExpansion: 5, preuve: 'set+numero' }, { _id: 'b', carteId: 7, idProduct: 200, idExpansion: 5, preuve: 'set+numero' },
            { _id: 'c', carteId: 7, idProduct: 501, idExpansion: 5, preuve: 'metacarte+freres' }];
        const cartes = new Map([[7, { _id: 7, liens: { idProduct: [100, 200, 501], idMetacards: [9] } }]]);
        const M3 = { CarteProduit: { deleteMany: async f => { for (let i = lignes.length - 1; i >= 0; i--) if (f.carteId.$in.includes(lignes[i].carteId) && f.idExpansion.$in.includes(lignes[i].idExpansion) && f.preuve.$in.includes(lignes[i].preuve)) lignes.splice(i, 1); },
            find: f => ({ select: () => ({ lean: async () => lignes.filter(l => l.carteId === f.carteId).map(l => ({ ...l })) }) }) },
            Carte: { findOne: f => ({ select: () => ({ lean: async () => structuredClone(cartes.get(f._id)) }) }),
                updateOne: async (f, u) => { const c = cartes.get(f._id); for (const [k, v] of Object.entries(u.$set || {})) { const p = k.split('.'); c[p[0]][p[1]] = v; } for (const k of Object.keys(u.$unset || {})) delete c.liens[k.split('.')[1]]; } } };
        const regen = await effacerRefabricables(M3, [7], [5]);
        for (const id of [100, 200]) if (!cartes.get(7).liens.idProduct.includes(id)) cartes.get(7).liens.idProduct.push(id);   // joindre() : $addToSet en fin
        verifier('le rejeu AJOUTE en fin ce qu\'il refait : sans correction, [100,200,501] devient [501,100,200] (le repère [0] bouge)', cartes.get(7).liens.idProduct, [501, 100, 200]);
        verifier('   restaurerOrdreLiens remet l\'ordre d\'AVANT (les ids présents gardent leur place, un id neuf s\'ajoute en fin)', await (async () => { cartes.get(7).liens.idProduct.push(777); await P.restaurerOrdreLiens(M3, regen.ordreAvant); return cartes.get(7).liens.idProduct; })(), [100, 200, 501, 777]);
        verifier('   un id d\'avant que le rejeu ne refait PAS disparaît (pas de lien sans ligne)', await (async () => { cartes.get(7).liens.idProduct = [501, 100]; await P.restaurerOrdreLiens(M3, regen.ordreAvant); return cartes.get(7).liens.idProduct; })(), [100, 501]);
    }
    // le câblage : collecteur-texte.js restaure l'ordre APRÈS la jointure
    verifier('collecteur-texte.js appelle restaurerOrdreLiens après la jointure', /if \(ordreAvant\) \{ const R = await restaurerOrdreLiens\(M, ordreAvant\)/.test(fs.readFileSync(path.join(DIR, 'collecteur-texte.js'), 'utf8')), true);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
