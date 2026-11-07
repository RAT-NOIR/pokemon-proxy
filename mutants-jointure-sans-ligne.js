'use strict';
// MUTANTS de collecte-cartes/jointure-sans-ligne.js — chaque garde est CASSÉE à tour de rôle ; test-jointure-sans-ligne.js doit alors ÉCHOUER. Le fichier est toujours restauré (try/finally).
//   node mutants-jointure-sans-ligne.js
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const F = path.join(__dirname, 'collecte-cartes', 'jointure-sans-ligne.js');
const TEST = path.join(__dirname, 'test-jointure-sans-ligne.js');
const MUTANTS = [
    ['le témoin du nom est retiré', "if (temoinDuNom(cartes, p.idExpansion)(laCarte, { nom: d.nom, attaques: d.attaques })) return refus('nom-contredit');", "if (false) return refus('nom-contredit');"],
    ['nom-inclus est accepté', "return refus(inclus ? 'nom-inclus-seulement' : 'aucun-produit');", "if (inclus) return { ligne: ligneDe(sansLigne[0], 'set+nom-seul', null, 'x') }; return refus('aucun-produit');"],
    ['deux produits au numéro sont acceptés', "if (auNumero.length > 1) return refus('plusieurs-produits-au-numero');", "if (false) return refus('plusieurs-produits-au-numero');"],
    ['numeroFiche oublié', "ligneDe(p, 'set+numero', String(num),", "ligneDe(p, 'set+numero', null,"],
    ['slugSet de repli perdu', "slugSet: p.slugSet ?? set._id ?? null", "slugSet: p.slugSet ?? null"],
    ['la garde du nom seul est retirée', "if (!g.gardees.length) return parAttaques() || refus('nom-ambigu');", "if (false) return refus('nom-ambigu');"],
    ['la carte déjà jointe est rejointe', "if (lignesDuSet.some(couvre)) return refus('carte-deja-jointe-dans-le-set');", "if (false) return refus('carte-deja-jointe-dans-le-set');"],
    ['le produit déjà joint est repris (numéro)', "if (prisIds.has(p.idProduct)) return refus('produit-deja-joint');\n        if (!sansLigne", "if (false) return refus('produit-deja-joint');\n        if (!sansLigne"],
    ['le produit déjà joint est repris (nom seul)', "const p = auNom[0];\n    if (prisIds.has(p.idProduct)) return refus('produit-deja-joint');", "const p = auNom[0];\n    if (false) return refus('produit-deja-joint');"],
    ['les produits d\'une autre expansion comptent', "const tous = (produitsDuSet || produitsSansLigne).filter(p => idsExpansion.includes(p.idExpansion));", "const tous = (produitsDuSet || produitsSansLigne);"],
    ['les impressions d\'un autre set comptent', "const imps = (carte.impressions || []).filter(i => impressionDuSet(i, cible) && (cleEntree", "const imps = (carte.impressions || []).filter(i => true || (cleEntree"],
    ['la preuve du nom seul se dit « numero »', "ligneDe(p, 'set+nom-seul', null,", "ligneDe(p, 'set+numero', null,"],
    ['le détail ne nomme plus le périmètre', "parmi les ${sansLigne.length} produits sans ligne de l'expansion ${p.idExpansion} ; nom ne désignant", "; nom ne désignant"],
    ['un produit joint dans un autre set est repris (numéro)', "if (!sansLigne.some(q => q.idProduct === p.idProduct)) return refus('produit-deja-joint');", "if (false) return refus('produit-deja-joint');"],
    ['le numéro contradictoire n\'arrête plus la voie du nom', "if (numP !== null && clesCarte.size && !clesCarte.has(numP)) return refus('nom-contredit-numero');", "if (false) return refus('nom-contredit-numero');"],
    ['le détail dit de nouveau « nom concordant »', "; nom ne désignant aucune autre carte du set (", "; nom concordant ("],
    ['attaques : une autre carte du nom qui les porte toutes n\'arrête plus', "if (homonymes.some(c => c._id !== carte._id && tient(dp, attDe(c)))) return null;", "if (false) return null;"],
    ['attaques : une seule attaque commune suffit (plus « toutes »)', "d.attaques.every(a => set.has(cleAttaque(a)))", "d.attaques.some(a => set.has(cleAttaque(a)))"],
    ['entrée : une ligne d\'un autre numéro couvre l\'entrée', "? cleDe(l.numeroFiche) === cleEntree :", "? true :"],
    ['entrée : une ligne sans numeroFiche couvre toutes les entrées', ": (nEntreesCarte || 1) === 1));", ": true));"],
    ['entrée : les impressions des autres numéros comptent', "(cleEntree === null || cleN(i.numero) === cleEntree)", "true"],
    ['entrée : un produit sans numéro se joint par le nom à une carte à plusieurs entrées', "if (restreint && numP === null) return refus('plusieurs-entrees-sans-numero');", ""],
    ['entrée : la voie nom+attaques joint un produit sans numéro (carte à plusieurs entrées)', "if (restreint && numP === null) return null;", ""],
    ['attaques : un produit nu est tenu pour un candidat', "d.attaques.length > 0 && d.attaques.every", "d.attaques.every"],
    ['attaques : un homonyme sans attaque connue n\'arrête plus', "attDe(c).size === 0)) return null;", "false)) return null;"],
    ['attaques : le numéro d\'une autre carte n\'arrête plus', "if (numP !== null && !clesCarte.size && cartes.some(", "if (false && cartes.some("],
    ['attaques : le numéro contredit n\'arrête plus', "if (numP !== null && clesCarte.size && !clesCarte.has(numP)) return null;", "if (false) return null;"],
    ['attaques : le produit déjà joint est repris', "if (!sansLigne.some(q => q.idProduct === p.idProduct) || prisIds.has(p.idProduct)) return null;", "if (false) return null;"],
    ['attaques : deux candidats (mêmes attaques) sont acceptés', "if (candidats.length !== 1) return null;", "if (candidats.length < 1) return null;"],
    ['attaques : le détail ne nomme plus le périmètre', "parmi les ${homonymes.length} cartes du nom et les ${auNom.length} produits du nom (expansion ${p.idExpansion})", "(expansion ${p.idExpansion})"],
    ['attaques : la voie ne sert plus la garde du nom seul', "if (!g.gardees.length) return parAttaques() || refus('nom-ambigu');", "if (!g.gardees.length) return refus('nom-ambigu');"],
    ['attaques : la preuve se dit « nom-seul »', "ligneDe(p, 'set+nom+attaques', null,", "ligneDe(p, 'set+nom-seul', null,"]
];
let tues = 0; const vivants = [];
// copie de sauvegarde de l'original AVANT toute mutation : restaurée en finally, y compris sur arrêt brutal (le .avant-mutants survit et se restaure à la main)
const SAUVEGARDE = `${F}.avant-mutants`, ORIGINAL = fs.readFileSync(F, 'utf8');
if (fs.existsSync(SAUVEGARDE)) { console.error(`❌ ${SAUVEGARDE} existe : un arrêt brutal précédent a laissé un original à restaurer à la main. Rien n'a été muté.`); process.exit(2); }
fs.writeFileSync(SAUVEGARDE, ORIGINAL);
try {
    for (const [nom, de, vers] of MUTANTS) {
        if (!ORIGINAL.includes(de)) { console.log(`  ⚠️ ${nom} : motif introuvable (le mutant n'a pas été appliqué)`); vivants.push(`${nom} (motif introuvable)`); continue; }
        try {
            fs.writeFileSync(F, ORIGINAL.replace(de, vers));
            const r = spawnSync(process.execPath, [TEST], { encoding: 'utf8', env: process.env });
            if (r.status !== 0) { tues++; console.log(`  ✅ tué : ${nom}`); } else { vivants.push(nom); console.log(`  ❌ VIVANT : ${nom}`); }
        } finally { fs.writeFileSync(F, ORIGINAL); }
    }
} finally { fs.writeFileSync(F, ORIGINAL); fs.unlinkSync(SAUVEGARDE); }
console.log(`\n${tues} mutants tués sur ${MUTANTS.length}${vivants.length ? ` · vivants : ${vivants.join(' | ')}` : ''}`);
process.exitCode = vivants.length ? 1 : 0;
