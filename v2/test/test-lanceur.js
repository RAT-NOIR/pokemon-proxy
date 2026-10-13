'use strict';
// Le lanceur ne compte vert qu'un banc qui sort en 0 ET dont la DERNIÈRE ligne non vide est l'unique bilan « N réussis, 0 échoués »
// avec N > 0 ; et il refuse tout argument non reconnu AVANT de lancer quoi que ce soit.
// Faux bancs dans fixtures-lanceur/ (sous-dossier : le lanceur normal ne les voit pas). AUCUNE base Mongo n'est touchée ici :
// pour les cas d'arguments, le lanceur est COPIÉ dans un dossier jetable à côté d'un faux banc, de sorte que « la suite normale »
// y soit inoffensive (si le lanceur ignorait un argument, il lancerait ce faux banc et non les vrais).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const H = require('./_harnais');
const LANCEUR = path.join(__dirname, 'lancer-tout.js');
const FIX = path.join(__dirname, 'fixtures-lanceur');

if (process.env.RM_LANCEUR_IMBRIQUE) { H.vrai('imbrication évitée (lanceur ancien qui ignore --dossier)', true); H.bilan(); return; }

// RM_LANCEUR_SANS_ESPION=1 : seul ce banc le pose, pour jouer des COPIES du lanceur qui n'ont pas l'armeur de l'espion à côté (tour 1, M-4 : sinon l'absence de l'armeur FAIT ÉCHOUER le lanceur)
const env = { ...process.env, RM_LANCEUR_IMBRIQUE: '1', RM_LANCEUR_SANS_ESPION: '1' };
// cwd = le dossier du script : un chemin vide ou relatif ne peut jamais viser la racine du dépôt (ses test-*.js écrivent dans Mongo).
const lancer = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, timeout: 120000, cwd: path.dirname(script) });
const jetable = () => fs.mkdtempSync(path.join(__dirname, '.jetable-lanceur-'));   // DANS v2/test : l'unique racine permise
const nettoyer = (d) => fs.rmSync(d, { recursive: true, force: true });
const seul = (nom) => { const d = jetable(); fs.copyFileSync(path.join(FIX, nom), path.join(d, nom)); return d; };

// 1. jugement des bancs
for (const nom of ['test-suspens.js', 'test-zero-reussite.js', 'test-echec-et-reussite.js', 'test-deux-bilans.js', 'test-texte-apres.js']) {
    const d = seul(nom); const r = lancer(LANCEUR, `--dossier=${d}`);
    H.v(`${nom} : le lanceur sort en code 1`, r.status, 1);
    H.vrai(`${nom} : le lanceur le NOMME en rouge`, new RegExp(`🔴 ${nom}`).test(r.stdout || ''));
    nettoyer(d);
}
{
    const d = seul('test-vert.js'); const r = lancer(LANCEUR, `--dossier=${d}`);
    H.v('test-vert.js : un banc avec bilan 3/0 en dernière ligne est compté vert (code 0)', r.status, 0);
    nettoyer(d);
    const vide = jetable();
    H.v('dossier sans banc : code 1', lancer(LANCEUR, `--dossier=${vide}`).status, 1);
    nettoyer(vide);
}

// 2. arguments : tout ce qui n'est pas reconnu est refusé AVANT de lancer un banc
{
    const bac = jetable();                                          // dossier du lanceur COPIÉ : sa « suite normale » = un faux banc vert
    fs.copyFileSync(LANCEUR, path.join(bac, 'lancer-tout.js'));
    fs.copyFileSync(path.join(FIX, 'test-vert.js'), path.join(bac, 'test-vert.js'));
    const dehors = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-lanceur-'));   // hors de la racine permise
    fs.copyFileSync(path.join(FIX, 'test-vert.js'), path.join(dehors, 'test-vert.js'));
    const copie = path.join(bac, 'lancer-tout.js');
    const temoin = lancer(copie);
    H.v('témoin : sans argument, le lanceur copié lance son faux banc vert (code 0)', temoin.status, 0);
    for (const [nom, args] of [['faute de frappe --dosier=x', ['--dosier=x']], ['--dossier sans =', ['--dossier']], ['--dossier= vide', ['--dossier=']],
        ['argument quelconque', ['bonjour']], ['--dossier= hors de v2/test', [`--dossier=${dehors}`]], ['--dossier= avec .. qui sort', [`--dossier=${path.join(bac, '..', '..')}`]]]) {
        const r = lancer(copie, ...args);
        H.v(`${nom} : refus, code 1`, r.status, 1);
        H.vrai(`${nom} : refusé AVANT de lancer un banc (aucun « === »)`, !/===/.test(r.stdout || ''));
    }
    // M-4 : sans l'armeur de l'espion à côté ET sans la variable posée par ce banc, le lanceur REFUSE (une suppression ou un renommage de l'armeur ne désarme pas les suites en silence)
    const nu = { ...env }; delete nu.RM_LANCEUR_SANS_ESPION;
    const sansArmeur = spawnSync(process.execPath, [copie], { encoding: 'utf8', env: nu, timeout: 120000, cwd: path.dirname(copie) });
    H.v('lanceur sans l\'armeur de l\'espion et sans la variable de banc : refus, code 1, avant de lancer un banc', [sansArmeur.status, /espion/i.test(`${sansArmeur.stdout}${sansArmeur.stderr}`), !/===/.test(sansArmeur.stdout || '')], [1, true, true]);
    nettoyer(dehors); nettoyer(bac);
}
H.bilan();
