'use strict';
// outils/verifier-absence-parcours.js : il dit NON sur des arbres fabriqués où le module est présent ou référencé (et sur ce qu'il ne sait pas lire), OUI sur un arbre sans le module.
// Arbres fabriqués dans un dossier temporaire PROPRE à ce banc (sans jonction), retirés à la fin. Aucune base, aucun réseau.
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const H = require('./_harnais'); const { verifier } = require('../../outils/verifier-absence-parcours');
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'absence-parcours-'));
const arbre = (nom, fichiers) => { const d = path.join(racine, nom); for (const [rel, texte] of Object.entries(fichiers)) { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, texte); } fs.mkdirSync(path.join(d, 'v2'), { recursive: true }); return d; };
const BASE = { 'v2/config.js': "'use strict'; const mesure = { actif: false };\n", 'v2/comptes/routes.js': "'use strict'; // lit cfg.mesure\n", 'v2/garde-essai.js': "'use strict';\n" };
try {
    const sans = arbre('sans', BASE);
    H.v('arbre SANS le module et sans référence => OUI', verifier(sans), { ok: true, fautes: [] });
    const avecDossier = arbre('dossier', { ...BASE, 'v2/essai-parcours/index.js': "'use strict';\n" });
    H.v('arbre avec le dossier v2/essai-parcours => NON', [verifier(avecDossier).ok, verifier(avecDossier).fautes.some(f => f.includes('existe'))], [false, true]);
    const avecRef = arbre('ref', { ...BASE, 'v2/config.js': "const m = require('./essai-parcours').depuis(env);\n" });
    H.v('arbre sans le dossier mais où config.js fait référence au module => NON (le fichier fautif est nommé)', [verifier(avecRef).ok, verifier(avecRef).fautes], [false, ['v2/config.js fait référence à essai-parcours']]);
    const refCommentaire = arbre('commentaire', { ...BASE, 'v2/comptes/monter.js': "// voir v2/essai-parcours/\n" });
    H.v('une référence même en commentaire => NON (lecture stricte)', verifier(refCommentaire).ok, false);
    const refTest = arbre('test', { ...BASE, 'v2/test/test-x.js': "require('../essai-parcours');\n" });
    H.v('une référence sous v2/test seulement => OUI (les bancs ne sont pas du code servi)', verifier(refTest).ok, true);
    const refMjs = arbre('mjs', { ...BASE, 'v2/outil.mjs': "import('./essai-parcours/index.js');\n", 'v2/profond/a/b/c.cjs': "require('../../../essai-parcours');\n" });
    H.v('références en .mjs et .cjs, en profondeur => NON, les deux fichiers nommés', verifier(refMjs).fautes.length, 2);
    H.v('un fichier hors v2 (outils/, docs) qui cite le module ne compte pas', verifier(arbre('hors', { ...BASE, 'outils/x.js': "// essai-parcours\n", 'RAPPORT.md': 'essai-parcours' })).ok, true);
    H.v('arbre sans dossier v2 => NON (non vérifiable : jamais « tout va bien »)', [verifier(path.join(racine, 'inexistant')).ok, verifier('').ok, verifier(undefined).ok, verifier(42).ok], [false, false, false, false]);
    // la ligne de commande : code de sortie 0 / 1
    const cli = d => { try { execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'outils', 'verifier-absence-parcours.js'), d], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
    H.v('ligne de commande : code 0 sur l\'arbre sans module, 1 sur les arbres avec le dossier ou une référence, 1 sans argument', [cli(sans), cli(avecDossier), cli(avecRef), cli('')], [0, 1, 1, 1]);
    // l'arbre RÉEL de ce worktree : NON tant que le module existe (c'est le travail de la bascule de le retirer), et le fautif est bien le dossier
    const reel = verifier(path.join(__dirname, '..', '..'));
    H.v('l\'arbre de ce worktree dit NON (le module est là, le dossier est nommé) : la bascule de production doit le retirer', [reel.ok, reel.fautes.some(f => f === 'v2/essai-parcours existe')], [false, true]);
    // CONTRÔLE DE L'INSTRUMENT : retirer le dossier ET la référence d'une copie fabriquée de l'arbre fautif => OUI
    fs.rmSync(path.join(avecRef, 'v2', 'config.js')); fs.writeFileSync(path.join(avecRef, 'v2', 'config.js'), BASE['v2/config.js']);
    H.v('contrôle de l\'instrument : la même copie, la référence retirée, redevient OUI', verifier(avecRef).ok, true);
} finally { fs.rmSync(racine, { recursive: true, force: true }); }
H.bilan();
