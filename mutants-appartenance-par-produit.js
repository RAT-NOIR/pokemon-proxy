'use strict';
// Mutants de collecte-cartes/appartenance-par-produit.js (et de page-de-carte.js pour B) : chacun doit faire ÉCHOUER test-appartenance-par-produit.js.
// Originaux restaurés en finally. Sans child_process : le banc est rejoué dans le processus (il exporte une promesse qui REJETTE s'il échoue).
const fs = require('fs');
const path = require('path');

const FICHIERS = { module: path.join(__dirname, 'collecte-cartes', 'appartenance-par-produit.js'), page: path.join(__dirname, 'collecte-cartes', 'page-de-carte.js') };
const originaux = Object.fromEntries(Object.entries(FICHIERS).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));

const MUTANTS = [
    ['(a) ligne d\'un autre set acceptée', 'l.carteId === carteId && l.slugSet === slugSet', 'l.carteId === carteId'],
    ['(b) ligne d\'une autre carte acceptée', 'l.carteId === carteId && l.slugSet === slugSet', 'l.slugSet === slugSet'],
    ['(c) produit SANS_LIGNE attribué ignoré', "|| (produitsAttribues || []).some(p => p && p.fiche && p.fiche.carteId === carteId && p.fiche.setId === slugSet);", ';'],
    ['(d) produit attribué à un autre set accepté', 'p.fiche.carteId === carteId && p.fiche.setId === slugSet);', 'p.fiche.carteId === carteId);'],
    ['(e) déjà membre retiré de la liste (refusé à tort)', "if ((c.sets || []).includes(slugSet)) { dejaMembres.push(c._id); continue; }", ''],
    ['(f) slug vide accepté', "if (typeof slugSet !== 'string' || !slugSet.trim()) throw", 'if (false) throw'],
    ['(g) slug d\'espaces accepté', '|| !slugSet.trim()) throw', ') throw'],
    ['(h) sans produit : ajoutée quand même', 'else refusees.push({ carteId: c._id, raison: \'sans-produit-du-set\' });', 'else ajouter.push(c._id);'],
    ['(i) raison de refus altérée', "raison: 'sans-produit-du-set'", "raison: 'autre'"],
    ['(j) doublon de carte compté deux fois', 'if (!c || vus.has(c._id)) continue;', 'if (!c) continue;'],
    ['(k) set sans produit non détecté', 'const setSansProduit = !lignes.some', 'const setSansProduit = false && !lignes.some'],
    ['(A1) slugSet de la ligne forcé au slug (ligne du frère acceptée)', 'slugSet: l.slugSet ?? null }))', 'slugSet: "FORCE" }))'],
    ['(A2) lignes détachées non exclues', '.filter(l => !interdits.has(typeof l._id === \'string\' ? l._id : `${l.carteId}|${l.idProduct}`))', ''],
    ['(A3) lecture sans filtre d\'idExpansion', '{ carteId: { $in: cartes.map(c => c._id) }, idExpansion: exp }', '{ carteId: { $in: cartes.map(c => c._id) } }'],
    ['(A4) candidates : pages « manquant » incluses', "p.etat === 'ok' && p.pageid != null", 'p.pageid != null'],
    ['(A5) candidates : exécution courante ignorée', ', ...pagesEcrites])]', '])]'],
    ['(B) poserAppartenance sans garde (défaut permissif)', "if (typeof poserAppartenance !== 'boolean') throw", 'if (false) throw', 'page'],
];

(async () => {
    let tues = 0;
    try {
        for (const [nom, de, vers, cible = 'module'] of MUTANTS) {
            const original = originaux[cible];
            if (!original.includes(de)) throw new Error(`mutant « ${nom} » : motif introuvable dans l'original`);
            fs.writeFileSync(FICHIERS[cible], original.replace(de, vers));
            for (const k of Object.keys(require.cache)) if (/appartenance-par-produit\.js$|page-de-carte\.js$|test-appartenance-par-produit\.js$/.test(k)) delete require.cache[k];
            const logOrig = console.log; console.log = () => {};
            let tue = false;
            try { await require('./test-appartenance-par-produit.js'); } catch (e) { tue = true; } finally { console.log = logOrig; }
            fs.writeFileSync(FICHIERS[cible], original);
            if (tue) tues++;
            console.log(`${tue ? 'tué    ' : 'SURVIVANT'}  ${nom}`);
        }
    } finally {
        for (const [k, f] of Object.entries(FICHIERS)) fs.writeFileSync(f, originaux[k]);
    }
    console.log(`${tues} tués sur ${MUTANTS.length}`);
    process.exitCode = tues === MUTANTS.length ? 0 : 1;
})();
