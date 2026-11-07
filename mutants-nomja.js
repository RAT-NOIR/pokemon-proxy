// Mutants de la TABLE CROISÉE des noms japonais (preuves.js, 2026-11-03). EN MÉMOIRE : chaque mutant est écrit dans une COPIE (collecte-cartes/preuves-mutant-nomja.js), jamais dans preuves.js,
// puis la copie est supprimée. Un mutant qui survit = une garde que rien ne garde.   node mutants-nomja.js
'use strict';
const fs = require('fs');
const path = require('path');
const banc = require('./test-preuves-table-croisee');
const SRC = path.join(__dirname, 'collecte-cartes', 'preuves.js'), COPIE = path.join(__dirname, 'collecte-cartes', 'preuves-mutant-nomja.js');
const MUTANTS = [
    ['inclusion de nomEn acceptée (cartes ET unicité)', "const noms = table.parNomEn.get(en);\n    if (!noms || !noms.has(ja)) return null;\n    const ens = table.parNomJa.get(ja);\n    if (!ens || ens.size !== 1 || !ens.has(en)) return null;",
        "const noms = [...table.parNomEn].find(([k]) => k.includes(en) || en.includes(k))?.[1];\n    if (!noms || !noms.has(ja)) return null;\n    const ens = table.parNomJa.get(ja);\n    if (!ens || ens.size !== 1) return null;"],
    ['nomJa partagé par deux nomEn accepté', "if (!ens || ens.size !== 1 || !ens.has(en)) return null;", "if (!ens || !ens.has(en)) return null;"],
    ['table croisée ignorée', "const p = preuveParTableCroisee(lu.nom, nom, produit?.tableJaCroisee, produit?.carteId);", "const p = null;"],
    ['preuve sans source (carte non nommée)', "drapeaux.push(`nom-ja-par-table-d-un-autre-set:${p.carteId}`); return null;", "return null;"],
    ['la carte du produit comptée comme une autre', "return carteId === carteIdProduit ? null : { carteId };", "return { carteId };"],
    ['fiche simple (_id < 0) admise dans la table', "if (!(c?._id > 0) || !texte(c.nomEn) || !texte(c.nomJa)) continue;", "if (!texte(c.nomEn) || !texte(c.nomJa)) continue;"],
    ['périmètre : un Pokémon (catégorie pokemon) admis', "const horsPokemon = produit?.categorie != null ? produit.categorie !== 'pokemon' : !(nom && TPC.dexDuNom(nom));", "const horsPokemon = true;"],
    ['périmètre : catégorie inconnue = admis même avec Pokédex', ": !(nom && TPC.dexDuNom(nom));", ": true;"],
    ['« Basic X Energy » = « X Energy » (clés réduites à la plus courte)', ".sort().join('|') : '');", ".sort().pop() : '');"],
    ['table ouverte à toute langue lue', "if (tableUtilisable && horsPokemon) {\n        const p = preuveParTableCroisee", "if (t && horsPokemon) {\n        const p = preuveParTableCroisee"],
    ['nom lu non comparé à la table', "if (!noms || !noms.has(ja)) return null;", "if (!noms) return null;\n    if (!noms.has(ja)) return { carteId: -1 };"]
];
(async () => {
    const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
    let tues = 0; const survivants = [];
    try {
        // témoin : le banc passe sur l'original
        if (await banc.lancer(require('./collecte-cartes/preuves'), true)) throw new Error('le banc échoue sur l\'ORIGINAL');
        for (const [nom, de, vers] of MUTANTS) {
            if (!src.includes(de)) { survivants.push(`${nom} (motif introuvable : le mutant ne mord sur rien)`); continue; }
            fs.writeFileSync(COPIE, src.replace(de, () => vers));
            delete require.cache[require.resolve(COPIE)];
            let ko;
            try { ko = await banc.lancer(require(COPIE), true); } catch (e) { ko = 1; }
            (ko ? tues++ : survivants.push(nom));
        }
        // Collecteur : le banc pur ne l'exécute pas. Le mutant « table non transmise » est ANCRÉ (la ligne existe, la mutation la change) et son effet — ne rien transmettre — est exactement le cas du test 10 du banc :
        // une table absente ne produit JAMAIS d'acceptation (échec fermé). Ce n'est pas un test de plan (test-preuves.js est verrouillé par la porte tant qu'il diffère de HEAD).
        const col = fs.readFileSync(path.join(__dirname, 'collecteur-images-preuves.js'), 'utf8').replace(/\r\n/g, '\n');
        const ancre = "if (e.lu?.langue === 'ja') produit.tableJaCroisee = await tableCroisee();";
        if (!col.includes(ancre) || col.replace(ancre, '') === col) survivants.push('collecteur : ancre de transmission introuvable');
        else if (await banc.lancer({ ...require('./collecte-cartes/preuves'), evaluerPreuveLue: a => require('./collecte-cartes/preuves').evaluerPreuveLue({ ...a, produit: { ...a.produit, tableJaCroisee: undefined } }) }, true) === 0) survivants.push('collecteur : table non transmise (le banc ne l\'a pas vu)');
        else tues++;
    } finally { if (fs.existsSync(COPIE)) fs.unlinkSync(COPIE); }
    console.log(`${tues} tués sur ${MUTANTS.length + 1}`);
    for (const s of survivants) console.log(`SURVIVANT : ${s}`);
    process.exit(survivants.length ? 1 : 0);
})();
