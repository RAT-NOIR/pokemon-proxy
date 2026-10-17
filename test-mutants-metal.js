// node test-mutants-metal.js — MUTANTS du lot METAL : chaque mutation casse UN comportement ; le banc concerné doit ÉCHOUER (mutant tué). Le fichier est restauré à l'octet près dans `finally`.
// (on mute le fichier de la copie de travail puis on le restaure : jamais un fichier hors de ce dépôt)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MUTANTS = [
    { nom: 'détecteur : tout est « or » (valMax 5)', fichier: 'collecte-cartes/metal-detect.js', de: 'valMax: 0.62 }', vers: 'valMax: 5 }', banc: 'test-metal-detect.js' },
    { nom: 'détecteur : l\'écart de luminosité ne compte plus', fichier: 'collecte-cartes/metal-detect.js', de: 'const ECART_MIN = 0.25;', vers: 'const ECART_MIN = -9;', banc: 'test-metal-detect.js' },
    { nom: 'détecteur : « metal » sans frère normal clair (la garde du frère saute)', fichier: 'collecte-cartes/metal-detect.js', de: "if (!claires.length) return { verdict: 'douteux'", vers: "if (false) return { verdict: 'douteux'", banc: 'test-metal-detect.js', note: 'équivalent possible : Math.max() vide = -Infinity' },
    { nom: 'détecteur : l\'argent n\'est plus reconnu', fichier: 'collecte-cartes/metal-detect.js', de: "if (e.borderS < ARGENT.satMax", vers: "if (false && e.borderS < ARGENT.satMax", banc: 'test-metal-detect.js' },
    { nom: 'table : estMatiereSpeciale rend toujours faux', fichier: 'collecte-cartes/matiere-speciale.js', de: "return Number.isInteger(n) && Object.hasOwn(PRODUITS_MATIERE_SPECIALE, n);", vers: 'return false;', banc: 'test-matiere-speciale.js' },
    { nom: 'table : la garde d\'écriture ne lève plus', fichier: 'collecte-cartes/matiere-speciale.js', de: 'if (trouves.length) throw', vers: 'if (false) throw', banc: 'test-matiere-speciale.js' },
    { nom: 'jointure : `attache` ne lit plus la table', fichier: 'collecte-cartes/jointure.js', de: 'if (estMatiereSpeciale(p.idProduct)) return;', vers: '', banc: 'test-matiere-speciale.js' },
    { nom: 'ecrire-jointure : la garde est retirée', fichier: 'collecte-cartes/ecrire-jointure.js', de: "garderMatiereSpeciale(J.lignes.map(l => l.idProduct), `ecrireJointure ${slug}`);", vers: '', banc: 'test-matiere-speciale.js' },
    { nom: 'poser-par-metacarte : la garde est retirée', fichier: 'poser-par-metacarte.js', de: "try { garderMatiereSpeciale(aEcrire.map(x => x.p.idProduct), 'poser-par-metacarte'); }", vers: 'try { }', banc: 'test-matiere-speciale.js' },
    { nom: 'poser-fiches-par-freres : la garde est retirée', fichier: 'poser-fiches-par-freres.js', de: "try { garderMatiereSpeciale(aEcrire.map(x => x.p.idProduct), 'poser-fiches-par-freres'); }", vers: 'try { }', banc: 'test-matiere-speciale.js' },
    { nom: 'poser-fiches-par-setlist : la garde est retirée', fichier: 'poser-fiches-par-setlist.js', de: "try { garderMatiereSpeciale(aEcrire.map(x => x.p.idProduct), 'poser-fiches-par-setlist'); }", vers: 'try { }', banc: 'test-matiere-speciale.js' },
    { nom: 'retrait : le plan détache TOUTES les lignes', fichier: 'retirer-scan-faux-metal.js', de: 'lignes.filter(l => ids.has(Number(l.idProduct)))', vers: 'lignes.filter(l => true)', banc: 'test-retirer-scan-faux-metal.js' },
    { nom: 'retrait : --attendu ne refuse plus un compte qui diffère', fichier: 'retirer-scan-faux-metal.js', de: 'attendu !== n) throw', vers: 'false) throw', banc: 'test-retirer-scan-faux-metal.js' },
    { nom: 'retrait : --ecrire sans --attendu passe', fichier: 'retirer-scan-faux-metal.js', de: 'if (ecrire && !Number.isInteger(attendu)) throw', vers: 'if (false) throw', banc: 'test-retirer-scan-faux-metal.js' },
    { nom: 'retrait : la sauvegarde n\'est plus écrite', fichier: 'retirer-scan-faux-metal.js', de: "ecrireFichier('sauvegarde',", vers: "void ('sauvegarde',", banc: 'test-retirer-scan-faux-metal.js' },
    { nom: 'retrait : l\'à blanc écrit en base (le mode « ecrire » est forcé)', fichier: 'retirer-scan-faux-metal.js', de: 'if (!ecrire) {\n        ecrireFichier(\'plan\'', vers: 'if (false) {\n        ecrireFichier(\'plan\'', banc: 'test-retirer-scan-faux-metal.js' },
    { nom: 'retrait : liens.idProduct n\'est plus nettoyé', fichier: 'retirer-scan-faux-metal.js', de: "for (const x of plan.liens) await C.updateOne(", vers: "for (const x of []) await C.updateOne(", banc: 'test-retirer-scan-faux-metal.js' },
];

let tues = 0, survivants = [];
for (const m of MUTANTS) {
    const chemin = path.join(__dirname, m.fichier);
    const original = fs.readFileSync(chemin);
    const src = original.toString('utf8').replace(/\r\n/g, '\n');
    try {
        if (!src.includes(m.de)) { survivants.push(`${m.nom} : MOTIF INTROUVABLE (le mutant n'a rien muté)`); continue; }
        fs.writeFileSync(chemin, src.replace(m.de, m.vers));
        const r = spawnSync(process.execPath, [path.join(__dirname, m.banc)], { encoding: 'utf8', timeout: 120000 });
        if (r.status !== 0) { tues++; console.log(`☠️  tué : ${m.nom}`); }
        else { survivants.push(`${m.nom}${m.note ? ' (' + m.note + ')' : ''}`); console.log(`🧟 SURVIVANT : ${m.nom}`); }
    } finally { fs.writeFileSync(chemin, original); }
}
console.log(`\nmutants : ${tues} tués sur ${MUTANTS.length}${survivants.length ? ' — survivants : ' + survivants.join(' ; ') : ''}`);
process.exit(survivants.length ? 1 : 0);
