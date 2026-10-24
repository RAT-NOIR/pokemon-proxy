// node test-mutants-separation.js — MUTANTS de la séparation par variante (PHASE 3b, T3) : chaque mutation casse UN comportement ; test-separer-variantes-phase2.js doit ÉCHOUER (mutant tué).
// Le fichier est restauré à l'octet près dans `finally`. NODE_PATH = node_modules du dépôt principal.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const M = 'collecte-cartes/phase3b-separation.js', S = 'separer-variantes-phase2.js', W = 'collecte-cartes/phase2-variantes.js', B = 'test-separer-variantes-phase2.js';
const MUTANTS = [
    { nom: 'écriture : les entrées avant les lignes', fichier: M, de: 'return [...lignes, ...entrees];\n}\n\n/** LE MANIFESTE', vers: 'return [...entrees, ...lignes];\n}\n\n/** LE MANIFESTE' },
    { nom: 'écriture : une ligne peut déjà porter une variante (filtre sans $exists)', fichier: M, de: "variante: { $exists: false }, variantePreuve: { $exists: false } }, update: { $set: { variante: l.cible", vers: "variante: { $exists: true }, variantePreuve: { $exists: false } }, update: { $set: { variante: l.cible" },
    { nom: 'écriture : une entrée peut déjà être marquée (filtre sans $exists)', fichier: M, de: "partageeTamponNonSepare: { $exists: false }, produitsPartages: { $exists: false } }), update", vers: "produitsPartages: { $exists: false } }), update" },
    { nom: 'garde : une entrée à true est écrite', fichier: M, de: 'if (e.partageeTamponNonSepare === true) {', vers: 'if (false) {' },
    { nom: 'garde : une entrée à null est écrite', fichier: M, de: "if (e.partageeTamponNonSepare !== undefined && e.partageeTamponNonSepare !== false) {", vers: 'if (false) {' },
    { nom: 'garde : une entrée avec liste produitsPartages est écrite', fichier: M, de: "if (Array.isArray(e.produitsPartages) ? e.produitsPartages.length : e.produitsPartages !== undefined && e.produitsPartages !== null) {", vers: 'if (false) {' },
    { nom: 'garde : holo/non-holo accepté', fichier: M, de: 'if (e.partageeHoloNonHolo === true) {', vers: 'if (false) {' },
    { nom: 'garde : une clé portée par plusieurs entrées est écrite', fichier: M, de: 'if (portees.get(g.cleR2) !== 1) {', vers: 'if (false) {' },
    { nom: 'garde : une variante égale avec une AUTRE preuve passe pour « deja »', fichier: M, de: 'l.variante === w.cible && l.variantePreuve === w.preuve', vers: 'l.variante === w.cible' },
    { nom: 'garde : une cible sans jeton qui porte une variante passe', fichier: M, de: "if (ls.some(l => !vide(l.variante))) { motif = 'cible-sans-jeton-avec-variante';", vers: "if (false) { motif = 'cible-sans-jeton-avec-variante';" },
    { nom: 'garde : les produits servis par la clé ne sont plus comparés', fichier: M, de: "if (JSON.stringify(servis) !== JSON.stringify(attendus) && !(deja && JSON.stringify(servis) === JSON.stringify(servisFinal))) {", vers: 'if (false) {' },
    { nom: 'garde : un refus au plan n\'arrête plus', fichier: M, de: "if (k.refus) return `${k.refus} groupe(s)", vers: "if (false) return `${k.refus} groupe(s)" },
    { nom: 'garde : --attendu n\'est plus comparé aux lignes du plan', fichier: M, de: 'if (!Number.isInteger(attendu) || attendu !== k.lignes) return', vers: 'if (false) return' },
    { nom: 'garde : la table accordée n\'est plus comparée', fichier: M, de: 'if (k.entrees !== attenduTable.entrees ||', vers: 'if (false &&' },
    { nom: 'exécution : les cibles ne sont plus comptées avant la première écriture', fichier: M, de: 'if (n !== 1) throw new Error(`${quoi} : une cible est absente', vers: 'if (false) throw new Error(`${quoi} : une cible est absente' },
    { nom: 'exécution : le nombre modifié n\'est plus relu', fichier: M, de: 'if (modifiees !== ops.length) throw', vers: 'if (false) throw' },
    { nom: 'manifeste : la preuve écrite n\'est plus comparée à la table', fichier: M, de: ' || l.ecrit?.variantePreuve !== t.preuve) throw', vers: ') throw' },
    { nom: 'manifeste : le lot n\'est plus vérifié', fichier: M, de: 'if (!m || m.lot !== LOT) throw', vers: 'if (false) throw' },
    { nom: 'retrait : les écarts avec l\'état courant ne sont plus lus', fichier: M, de: "c[0].variantePreuve !== l.ecrit.variantePreuve) ecarts.push", vers: "false) ecarts.push" },
    { nom: 'retrait : le filtre d\'une ligne ne porte plus la preuve écrite', fichier: M, de: 'variante: l.ecrit.variante, variantePreuve: l.ecrit.variantePreuve }, update: { $unset', vers: 'variante: l.ecrit.variante }, update: { $unset' },
    { nom: 'retrait : le filtre d\'une entrée ne porte plus l\'état écrit', fichier: M, de: "filtreEntree(x, { partageeTamponNonSepare: false, produitsPartages: { $exists: false } }), update: { $unset", vers: "filtreEntree(x, { produitsPartages: { $exists: false } }), update: { $unset" },
    { nom: 'outil : --ecrire accepté hors lot-additif', fichier: S, de: 'if (ECRIRE) { try { P.garderSousLot', vers: 'if (false) { try { P.garderSousLot' },
    { nom: 'outil : --ecrire sans --attendu accepté', fichier: S, de: "if (ECRIRE && !Number.isInteger(ATTENDU)) {", vers: 'if (false) {' },
    { nom: 'outil : --ecrire sans --manifeste accepté', fichier: S, de: "if ((ECRIRE || RETIRER) && !MANIFESTE) {", vers: 'if (false) {' },
    { nom: 'outil : le motif d\'arrêt n\'est plus appelé', fichier: S, de: 'if (arret) {', vers: 'if (false) {' },
    { nom: 'outil : le verdict de l\'API n\'arrête plus l\'écriture', fichier: S, de: "if (!verdict.ok || ct.nouveaux.length || !siteOk) {", vers: 'if (false) {' },
    { nom: 'outil : un refus de contrat n\'arrête plus l\'écriture', fichier: S, de: "if (!verdict.ok || ct.nouveaux.length || !siteOk) {", vers: 'if (!verdict.ok || !siteOk) {' },
    { nom: 'outil : la relecture n\'arrête plus (code 0 quoi qu\'elle voie)', fichier: S, de: 'return tout && reel.ok ? 0 : 1;', vers: 'return 0;' },
    { nom: 'outil : le retrait ne vérifie plus l\'état courant', fichier: S, de: 'if (ecarts.length) { err(', vers: 'if (false) { err(' },
    { nom: 'outil : le retrait ne compare plus --attendu au manifeste', fichier: S, de: 'if (ATTENDU !== m.lignes.length) {', vers: 'if (false) {' },
    { nom: 'verdict : une cible sans jeton encore servie passe', fichier: S, de: 'if (sansJetonPerdues.length !== sansJeton.length) raisons.push', vers: 'if (false) raisons.push' },
    { nom: 'verdict : un juste perdu passe', fichier: S, de: 'if (justesPerdus.length) raisons.push', vers: 'if (false) raisons.push' },
    { nom: 'verdict : un autre produit perdu passe', fichier: S, de: 'if (cmp.autresPerdus.length) raisons.push', vers: 'if (false) raisons.push' },
    { nom: 'groupes : l\'état final (idempotence) n\'est plus admis', fichier: W, de: " && JSON.stringify(servisCle) !== JSON.stringify(finals)) throw", vers: ') throw' },
    { nom: 'groupes : une cible non lue à l\'oeil passe', fichier: W, de: 'if (!lu.has(x.idProduct)) throw', vers: 'if (false) throw' }
];

let tues = 0; const survivants = [];
for (const m of MUTANTS) {
    const chemin = path.join(__dirname, m.fichier);
    const original = fs.readFileSync(chemin);
    const src = original.toString('utf8').replace(/\r\n/g, '\n');
    try {
        if (!src.includes(m.de)) { survivants.push(`${m.nom} : MOTIF INTROUVABLE`); console.log(`❓ MOTIF INTROUVABLE : ${m.nom}`); continue; }
        fs.writeFileSync(chemin, src.replace(m.de, () => m.vers));
        const r = spawnSync(process.execPath, [path.join(__dirname, B)], { encoding: 'utf8', timeout: 180000, env: process.env });
        if (r.status !== 0) { tues++; console.log(`☠️  tué : ${m.nom}`); }
        else { survivants.push(m.nom); console.log(`🧟 SURVIVANT : ${m.nom}`); }
    } finally { fs.writeFileSync(chemin, original); }
}
console.log(`\nmutants : ${tues} tués sur ${MUTANTS.length}${survivants.length ? ' — survivants : ' + survivants.join(' ; ') : ''}`);
process.exit(survivants.length ? 1 : 0);
