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
    // correction 1
    { nom: 'garde-lot : les lignes de la table ne sont plus comptées', fichier: 'collecte-cartes/garde-lot.js', de: "if (estMatiereSpeciale(l.idProduct)) inc(", vers: "if (false) inc(", banc: 'test-garde-matiere-speciale.js' },
    { nom: 'garde-lot : les liens.idProduct de la table ne sont plus comptés', fichier: 'collecte-cartes/garde-lot.js', de: "if (estMatiereSpeciale(id)) inc(", vers: "if (false) inc(", banc: 'test-garde-matiere-speciale.js' },
    { nom: 'garde-lot : une hausse « matiere-speciale » n\'arrête plus le lot', fichier: 'collecte-cartes/garde-lot.js', de: "if (compteur === 'matiere-speciale') { baisses.push(", vers: "if (compteur === 'matiere-speciale') { void (", banc: 'test-garde-matiere-speciale.js' },
    { nom: 'retrait : --ecrire accepté hors lot-additif', fichier: 'retirer-scan-faux-metal.js', de: 'if (!ecrire) return;\n    if (!env ||', vers: 'if (true) return;\n    if (!env ||', banc: 'test-retirer-scan-faux-metal.js' },
    { nom: 'lot-additif : ne pose plus LOT_ADDITIF_PID', fichier: 'lot-additif.js', de: 'LOT_ADDITIF_PID: String(process.pid)', vers: 'LOT_X: String(process.pid)', banc: 'test-retirer-scan-faux-metal.js' },
    // correction 2
    { nom: 'projection partagée : liens.idProduct retiré (garde des liens aveugle en production)', fichier: 'collecte-cartes/garde-lot.js', de: "'attaques', 'liens.idProduct', 'liens.idMetacard'", vers: "'attaques', 'liens.idMetacard'", banc: 'test-garde-matiere-speciale.js' },
    { nom: 'lot-additif : projection recopiée sans liens (constante partagée abandonnée)', fichier: 'lot-additif.js', de: '.project({ ...PROJECTION_ETAT.cartes })', vers: ".project({ sets: 1, nomEn: 1, categorie: 1 })", banc: 'test-garde-matiere-speciale.js' },
    { nom: 'garde-lot : compte par produit et non par ligne (remplacement 1 → 1 non vu)', fichier: 'collecte-cartes/garde-lot.js', de: 'ligne:${l._id ?? `${l.carteId}|${l.idProduct}`}', vers: 'ligne', banc: 'test-garde-matiere-speciale.js' },
    { nom: 'garde-lot : liens comptés par produit et non par couple carte/produit', fichier: 'collecte-cartes/garde-lot.js', de: 'lien:${c._id}', vers: 'lien', banc: 'test-garde-matiere-speciale.js' },
    { nom: 'table : frereNature absente', fichier: 'collecte-cartes/matiere-speciale.js', de: "frereNature: 'jumbo',", vers: '', banc: 'test-matiere-speciale.js' },
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
