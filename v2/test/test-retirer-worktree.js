'use strict';
// Banc de outils/retirer-worktree.js. TOUT vit dans un dossier temporaire créé ici (fs.mkdtempSync sous os.tmpdir()) : aucun dossier réel du poste
// n'est retiré, aucune jonction ne vise un dossier qui n'est pas à ce banc. Aucune base, aucun réseau (git local seulement).
// Pas de _harnais.js : il charge dotenv et mongoose, ce banc n'en a pas besoin (et ne doit pas lire .env). Même format de bilan que H.bilan().
// La racine du banc porte le MARQUEUR que ce banc écrit lui-même : sans lui, l'outil refuse toute racine de banc (tour 1, M1).
// Les copies sont des ENFANTS DIRECTS de <racine>\_mutants (l'outil n'admet que ça, plus les worktrees enregistrés).
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const T = require('../../outils/retirer-worktree');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}
const vrai = (nom, cond) => v(nom, Boolean(cond), true);
function bilan() { console.log(`\n${ok} réussis, ${ko} échoués`); process.exitCode = ko ? 1 : 0; }

delete process.env.RM_RETRAIT_RACINE_BANC; delete process.env.RM_RETRAIT_JOURNAL;
const TMP = fs.realpathSync.native(os.tmpdir());
const ROOT = fs.mkdtempSync(path.join(TMP, 'rm-retrait-'));
const HORS = fs.mkdtempSync(path.join(TMP, 'rm-retrait-hors-'));       // un voisin de ROOT, hors de la racine du banc
const MUT = path.join(ROOT, '_mutants'); fs.mkdirSync(MUT);
fs.writeFileSync(path.join(ROOT, T.MARQUEUR_BANC || '.rm-retrait-banc'), T.JETON_BANC || 'rm-retrait-banc-v1');   // le marqueur, écrit par le banc
const JOURNAL = path.join(ROOT, 'journal.jsonl');
const muet = () => {};
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const existe = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// photo exacte d'un arbre : chemin -> type, ou taille:sha1. Les liens sont notés « lien » et JAMAIS suivis.
function photo(dir) {
    const m = {};
    const marche = (d, rel) => {
        for (const e of fs.readdirSync(d).sort()) {
            const p = path.join(d, e), r = rel ? rel + '/' + e : e, s = fs.lstatSync(p);
            if (s.isSymbolicLink()) m[r] = 'lien';
            else if (s.isDirectory()) { m[r] = 'dossier'; marche(p, r); }
            else m[r] = `${s.size}:${sha1(fs.readFileSync(p))}`;
        }
    };
    marche(dir, '');
    return m;
}
// nettoyage du banc : délie d'abord (sans suivre), puis supprime. Écrit ICI, indépendamment de l'outil testé.
function delier(dir) {
    for (const e of fs.readdirSync(dir)) {
        const p = path.join(dir, e), s = fs.lstatSync(p);
        if (s.isSymbolicLink()) { try { fs.rmdirSync(p); } catch { fs.unlinkSync(p); } }
        else if (s.isDirectory()) delier(p);
    }
}
function nettoyerBanc() { for (const d of [ROOT, HORS]) { if (existe(d)) { delier(d); fs.rmSync(d, { recursive: true, force: true }); } } }

function fairetemoin(dir, marque) {
    fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'vide'));
    fs.writeFileSync(path.join(dir, 'a.txt'), `témoin ${marque} a\n`);
    fs.writeFileSync(path.join(dir, 'sub', 'b.bin'), Buffer.alloc(5000, marque.length + 7));
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'c.txt'), `témoin ${marque} c\n`);
    fs.writeFileSync(path.join(dir, 'sub', 'd.txt'), 'd');
}
const jonction = (cible, lien) => fs.symlinkSync(cible, lien, 'junction');
let n = 0;
// un monde : base/temoin (+ temoin2) et MUT/cN (enfant direct de _mutants) avec DEUX jonctions (une en tête, une cachée au fond) vers les témoins.
// Un lien est aussi posé DANS le témoin vers témoin2 : une traversée naïve viderait les deux.
function monde() {
    const k = ++n;
    const base = path.join(ROOT, `w${k}`);
    const temoin = path.join(base, 'temoin'), temoin2 = path.join(base, 'temoin2'), copie = path.join(MUT, `c${k}`);
    fs.mkdirSync(base); fairetemoin(temoin, 'un'); fairetemoin(temoin2, 'deux');
    jonction(temoin2, path.join(temoin, 'sub', 'vers-t2'));
    fs.mkdirSync(path.join(copie, 'a', 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(copie, 'index.js'), 'x');
    fs.writeFileSync(path.join(copie, 'a', 'b', 'c', 'profond.txt'), 'y');
    jonction(temoin, path.join(copie, 'node_modules'));
    jonction(temoin2, path.join(copie, 'a', 'b', 'c', 'cache'));
    return { base, temoin, temoin2, copie, avantT: photo(temoin), avantT2: photo(temoin2) };
}
const opts = (plus = {}) => ({ executer: true, racine: ROOT, journal: JOURNAL, sortie: muet, ...plus });
const lignesJournal = () => (existe(JOURNAL) ? fs.readFileSync(JOURNAL, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : []);
// un instrument de banc : rend ce qu'on lui dit (stdout = lignes, status, error)
const instrumentQui = (r) => () => r;

try {
    const gitExe = T.trouverGit();
    const git = (cwd, ...a) => spawnSync(gitExe, ['-c', 'user.name=banc', '-c', 'user.email=banc@example.invalid', ...a], { cwd, encoding: 'utf8' });
    // un dépôt temporaire avec un commit ; rend le dépôt
    const depotTemp = (base) => {
        const depot = path.join(base, 'depot'); fs.mkdirSync(depot);
        git(depot, 'init', '-q'); fs.writeFileSync(path.join(depot, 'f.txt'), 'f');
        git(depot, 'add', 'f.txt'); const c = git(depot, 'commit', '-q', '-m', 'init');
        v('(préparation) le commit du dépôt temporaire passe', c.status, 0);
        return depot;
    };
    const worktreeTemp = (depot, wt, avecJonctions, temoin, temoin2) => {
        const a = git(depot, 'worktree', 'add', '-q', '-b', 'b' + (++n), wt);
        v('(préparation) git worktree add', a.status, 0);
        if (avecJonctions) {
            jonction(temoin, path.join(wt, 'node_modules'));
            fs.mkdirSync(path.join(wt, 'x', 'y'), { recursive: true }); jonction(temoin2, path.join(wt, 'x', 'y', 'cache'));
        }
    };

    // 0. la MÉTHODE de retrait d'un lien ne touche pas la cible (sous Windows) : vérifiée à part de l'outil
    {
        const w = monde();
        const lien = path.join(w.base, 'lien-seul');
        jonction(w.temoin, lien);
        fs.rmdirSync(lien);
        vrai('0. rmdirSync sur une jonction : le lien a disparu', !existe(lien));
        v('0. rmdirSync sur une jonction : la cible est identique', photo(w.temoin), w.avantT);
        let fichierOk = 'non testé (privilège de lien symbolique de fichier absent)';
        try {
            const f = path.join(w.base, 'f.txt'); fs.writeFileSync(f, 'f'); const ls = path.join(w.base, 'lien-fichier');
            fs.symlinkSync(f, ls, 'file'); fs.unlinkSync(ls);
            fichierOk = existe(f) && !existe(ls);
        } catch (e) { if (!/EPERM|EACCES/.test(e.code || '')) throw e; }
        if (fichierOk === true) vrai('0. unlinkSync sur un lien de fichier : la cible reste', true); else console.log(`ℹ️ 0. lien de fichier : ${fichierOk}`);
    }

    // 1. le TÉMOIN DU TESTEUR : une copie avec une jonction vers le témoin, plus une seconde cachée dans un sous-dossier
    {
        const w = monde();
        const r = T.retirer(w.copie, opts());
        v('1. code 0', r.code, 0);
        vrai('1. la copie a disparu', !existe(w.copie));
        v('1. le témoin garde les mêmes fichiers, octets et sha1 (un par un)', photo(w.temoin), w.avantT);
        v('1. le second témoin aussi', photo(w.temoin2), w.avantT2);
        vrai('1. le message de succès dit ce qui a été comparé (pas « intactes » seul)', /comptes identiques : fichiers, octets, dossiers, liens, dernière modification/.test(String(r.message)));
        const j = lignesJournal().filter(l => l.dossier.toLowerCase().endsWith(path.basename(w.copie).toLowerCase()));
        v('1. une ligne de journal pour ce retrait', j.length, 1);
        const j0 = j[0] || { liens: [], date: '', issue: '' };
        v('1. le journal nomme 2 liens retirés', (j0.liens || []).length, 2);
        vrai('1. le journal porte les cibles, la date UTC et l\'issue ok', j0.liens.length > 0 && j0.liens.every(l => l.cible) && /Z$/.test(j0.date) && j0.issue === 'ok');
    }

    // 2. un VRAI worktree git ENREGISTRÉ, avec une jonction vers le témoin
    {
        const base = path.join(ROOT, `w${++n}`); fs.mkdirSync(base);
        const temoin = path.join(base, 'temoin'), temoin2 = path.join(base, 'temoin2'), wt = path.join(base, 'wt');
        fairetemoin(temoin, 'un'); fairetemoin(temoin2, 'deux'); jonction(temoin2, path.join(temoin, 'sub', 'vers-t2'));
        const depot = depotTemp(base);
        worktreeTemp(depot, wt, true, temoin, temoin2);
        const avantT = photo(temoin), avantT2 = photo(temoin2);
        // 2a. non enregistré dans les dépôts connus : refus, rien supprimé
        const rn = T.retirer(wt, opts({ depots: [] }));
        vrai('2a. un worktree absent des dépôts connus est refusé, rien n\'est supprimé', rn.code !== 0 && existe(wt) && existe(path.join(wt, 'node_modules')));
        // 2b. un sous-dossier d'un worktree : refus
        const rs = T.retirer(path.join(wt, 'x'), opts({ depots: [depot] }));
        vrai('2b. un sous-dossier d\'un worktree est refusé', rs.code !== 0 && existe(path.join(wt, 'x', 'y')));
        // 2c. code 4 : git échoue (injection) ; le worktree et les témoins restent
        const r4 = T.retirer(wt, opts({ depots: [depot], lancerGit: () => ({ status: 1, stderr: 'échec simulé par le banc' }) }));
        v('2c. git en échec : code 4', r4.code, 4);
        vrai('2c. git en échec : le worktree reste, le message dit l\'échec git, le journal le porte', existe(wt) && /git worktree remove a échoué/.test(String(r4.message)) && lignesJournal().some(l => l.issue === 'echec-git'));
        v('2c. git en échec : les témoins sont intacts (les liens étaient déjà retirés seuls)', [photo(temoin), photo(temoin2)], [avantT, avantT2]);
        // 2. le retrait réel
        const r = T.retirer(wt, opts({ depots: [depot] }));
        v('2. code 0', r.code, 0);
        vrai('2. le dossier du worktree a disparu', !existe(wt));
        const liste = git(depot, 'worktree', 'list', '--porcelain').stdout || '';
        const lignesWt = liste.replace(/\r/g, '').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9).replace(/\\/g, '/').toLowerCase());
        v('2. git worktree list ne porte plus que le dépôt principal (1 entrée)', lignesWt.length, 1);
        vrai('2. le worktree a disparu de git worktree list', !lignesWt.some(l => l.endsWith('/wt')));
        v('2. le témoin est intact', photo(temoin), avantT);
        v('2. le second témoin est intact', photo(temoin2), avantT2);
        vrai('2. le dépôt principal est intact', existe(path.join(depot, 'f.txt')) && existe(path.join(depot, '.git')));
    }

    // 3. une cible qui CHANGE pendant le retrait : refus, la copie reste, le message nomme la cible
    {
        const w = monde();
        let appels = 0;
        const r = T.retirer(w.copie, opts({ apresRetraitLiens: () => { appels++; fs.writeFileSync(path.join(w.temoin, 'ajout.txt'), 'x'); } }));
        v('3. le point d\'injection est appelé une fois', appels, 1);
        vrai('3. code non nul', r.code !== 0);
        vrai('3. la copie est toujours là', existe(w.copie) && existe(path.join(w.copie, 'index.js')));
        vrai('3. le message nomme la cible', String(r.message).toLowerCase().includes(fs.realpathSync.native(w.temoin).toLowerCase()));
        vrai('3. le message donne l\'écart', /fichier/.test(String(r.message)));
        // reprise : la cible est désormais stable, la copie n'a plus de lien : le même outil la retire
        const r2 = T.retirer(w.copie, opts());
        v('3. reprise sans injection : code 0', r2.code, 0);
        vrai('3. reprise : la copie a disparu', !existe(w.copie));
        const l = lignesJournal().filter(x => x.issue && x.issue !== 'ok' && /refus/.test(x.issue));
        vrai('3. le refus est au journal', l.length >= 1);
    }
    {   // 3b. un seul OCTET de plus dans un fichier existant
        const w = monde();
        const r = T.retirer(w.copie, opts({ apresRetraitLiens: () => fs.appendFileSync(path.join(w.temoin, 'a.txt'), 'z') }));
        vrai('3b. un octet de plus : refus', r.code !== 0 && existe(w.copie));
        vrai('3b. le message parle d\'octets', /octet/.test(String(r.message)));
        T.retirer(w.copie, opts());
    }
    {   // 3c. un lien qui réapparaît entre le recompte et la suppression : refus au dernier inventaire
        const w = monde();
        const r = T.retirer(w.copie, opts({ apresRecompte: () => jonction(w.temoin, path.join(w.copie, 'revenu')) }));
        vrai('3c. un lien réapparu : refus, la copie reste', r.code !== 0 && existe(w.copie));
        vrai('3c. le témoin est intact', JSON.stringify(photo(w.temoin)) === JSON.stringify(w.avantT));
        if (existe(w.copie)) delier(w.copie);
    }
    {   // 3d. une cible qui disparaît pendant le retrait (vidée) : refus
        const w = monde();
        const r = T.retirer(w.copie, opts({ apresRetraitLiens: () => fs.rmSync(path.join(w.temoin2, 'a.txt')) }));
        vrai('3d. un fichier de moins : refus', r.code !== 0 && existe(w.copie));
        T.retirer(w.copie, opts());
    }
    {   // 3e. I2 : un contenu REMPLACÉ À TAILLE ÉGALE, avec une date plus récente : arrêt (le compte seul ne le voyait pas)
        const w = monde();
        const f = path.join(w.temoin, 'a.txt'), taille = fs.statSync(f).size;
        const r = T.retirer(w.copie, opts({ apresRetraitLiens: () => { fs.writeFileSync(f, Buffer.alloc(taille, 'Z')); const t = new Date(Date.now() + 60000); fs.utimesSync(f, t, t); } }));
        vrai('3e. contenu remplacé à taille égale, date plus récente : refus, la copie reste', r.code !== 0 && existe(w.copie));
        vrai('3e. le message nomme la dernière modification', /dernière modification/.test(String(r.message)));
        T.retirer(w.copie, opts());
    }
    {   // 3f. code 5 : la cible change APRÈS la suppression (injection) : alerte rouge, code 5, au journal
        const w = monde();
        const r = T.retirer(w.copie, opts({ apresSuppression: () => fs.writeFileSync(path.join(w.temoin, 'apres.txt'), 'x') }));
        v('3f. cible changée après la suppression : code 5', r.code, 5);
        vrai('3f. ALERTE ROUGE dans le message et le journal', /ALERTE ROUGE/.test(String(r.message)) && lignesJournal().some(l => /ALERTE/.test(l.issue || '')));
        vrai('3f. la copie, elle, a bien disparu', !existe(w.copie));
    }

    // 3g. I1 : un instrument INDÉPENDANT de Node, juste avant la suppression
    {
        const w = monde();
        const avant = photo(w.base);
        const r = T.retirer(w.copie, opts({ instrumentReanalyse: instrumentQui({ status: 0, stdout: path.join(w.copie, 'point-de-montage-fictif') + '\r\n' + 'RM-FIN\r\n' }) }));
        vrai('3g. un point de réanalyse que lstat ne voit pas : refus, la copie reste', r.code !== 0 && existe(w.copie));
        vrai('3g. le message nomme le point', /point-de-montage-fictif/.test(String(r.message)));
        v('3g. les témoins sont intacts', photo(w.base), avant);
        const r1 = T.retirer(w.copie, opts({ instrumentReanalyse: instrumentQui({ status: 1, stdout: '', stderr: 'boum' }) }));
        vrai('3g. l\'instrument en échec : refus, rien n\'est supprimé', r1.code !== 0 && existe(w.copie) && /n'a pas pu conclure/.test(String(r1.message)));
        const r2 = T.retirer(w.copie, opts({ instrumentReanalyse: instrumentQui({ status: 0, stdout: '' }) }));
        vrai('3g. l\'instrument muet (pas de sentinelle de fin) : refus', r2.code !== 0 && existe(w.copie));
        const r3 = T.retirer(w.copie, opts({ instrumentReanalyse: instrumentQui({ error: new Error('ENOENT powershell') }) }));
        vrai('3g. l\'instrument introuvable : refus', r3.code !== 0 && existe(w.copie));
        const r4 = T.retirer(w.copie, opts({ instrumentReanalyse: () => { throw new Error('plantage'); } }));
        vrai('3g. l\'instrument qui lève : refus', r4.code !== 0 && existe(w.copie));
        v('3g. les témoins sont toujours intacts', [photo(w.temoin), photo(w.temoin2)], [w.avantT, w.avantT2]);
        // l'instrument RÉEL : il voit une jonction par l'attribut, il ne voit rien sur un arbre sans lien
        const w2 = monde();
        const reelAvec = T.reanalyse(w2.copie);
        vrai('3g. l\'instrument réel (PowerShell) répond', reelAvec.ok);
        vrai('3g. l\'instrument réel voit les jonctions par leur attribut', reelAvec.points.some(p => /node_modules$/i.test(p)) && reelAvec.points.some(p => /cache$/i.test(p)));
        const reelSans = T.reanalyse(w2.temoin2);
        vrai('3g. l\'instrument réel ne voit rien dans un arbre sans lien', reelSans.ok && reelSans.points.length === 0);
        T.retirer(w.copie, opts()); T.retirer(w2.copie, opts());
    }

    // 3h. M5 : un dossier ILLISIBLE pendant l'inventaire (injection) : refus, rien n'est supprimé
    {
        const w = monde();
        const racineLue = path.join(w.copie);
        const lireQuiLeve = (surAppel) => { let k = 0; return (d) => { if (d === racineLue) { k++; if (k === surAppel) { const e = new Error('EACCES simulé'); e.code = 'EACCES'; throw e; } } return fs.readdirSync(d); }; };
        const r1 = T.retirer(w.copie, opts({ lireDossier: lireQuiLeve(1) }));
        vrai('3h. illisible dès le premier inventaire : refus, aucun lien retiré', r1.code !== 0 && existe(path.join(w.copie, 'node_modules')) && existe(path.join(w.copie, 'a', 'b', 'c', 'cache')));
        const r3 = T.retirer(w.copie, opts({ lireDossier: lireQuiLeve(3) }));
        vrai('3h. illisible au dernier inventaire : refus, la copie reste', r3.code !== 0 && existe(w.copie));
        v('3h. les témoins sont intacts', [photo(w.temoin), photo(w.temoin2)], [w.avantT, w.avantT2]);
        T.retirer(w.copie, opts());
    }

    // 4. les refus d'entrée (rien n'est supprimé)
    {
        const base = path.join(ROOT, `w${++n}`); fs.mkdirSync(base);
        const refus = (nom, dossier, plus = {}) => {
            const r = T.retirer(dossier, opts(plus));
            vrai(`4. refus : ${nom} (code non nul)`, r.code !== 0);
            return r;
        };
        // hors de la racine permise
        const dehors = path.join(HORS, 'copie'); fs.mkdirSync(dehors); fs.writeFileSync(path.join(dehors, 'f'), 'f');
        refus('hors de la racine', dehors); vrai('4. hors racine : rien supprimé', existe(path.join(dehors, 'f')));
        // un lien (jonction) lui-même
        const reel = path.join(MUT, `reel${n}`); fs.mkdirSync(reel); fs.writeFileSync(path.join(reel, 'f'), 'f');
        const lien = path.join(MUT, `lien${n}`); jonction(reel, lien);
        refus('un dossier qui est lui-même un lien', lien);
        vrai('4. lien : le lien et sa cible sont intacts', existe(lien) && existe(path.join(reel, 'f')));
        fs.rmdirSync(lien);
        // un dépôt principal (.git réel)
        const depot = path.join(MUT, `depot${n}`); fs.mkdirSync(path.join(depot, '.git'), { recursive: true }); fs.writeFileSync(path.join(depot, 'f'), 'f');
        refus('un dépôt principal (.git réel)', depot); vrai('4. dépôt : intact', existe(path.join(depot, 'f')) && existe(path.join(depot, '.git')));
        // absent
        refus('un dossier absent', path.join(base, 'absent'));
        // la racine elle-même, son parent, et _mutants
        refus('la racine elle-même', ROOT); refus('le parent de la racine', path.dirname(ROOT)); refus('_mutants lui-même', MUT);
        vrai('4. la racine est intacte', existe(base) && existe(MUT));
        // un chemin qui traverse une jonction vers l'extérieur
        const cible = path.join(HORS, 'cible'); fs.mkdirSync(cible); fs.writeFileSync(path.join(cible, 'f'), 'f');
        jonction(HORS, path.join(MUT, 'passage'));
        refus('un chemin qui passe par une jonction vers l\'extérieur', path.join(MUT, 'passage', 'cible'));
        vrai('4. passage : la cible extérieure est intacte', existe(path.join(cible, 'f')));
        fs.rmdirSync(path.join(MUT, 'passage'));
        // un fichier, pas un dossier
        fs.writeFileSync(path.join(base, 'fichier.txt'), 'x'); refus('un fichier', path.join(base, 'fichier.txt'));
        // M4 : ce que l'outil n'AUTORISE pas, même sous la racine
        const node22 = path.join(ROOT, 'node22'); fs.mkdirSync(node22); fs.writeFileSync(path.join(node22, 'node.exe'), 'n');
        refus('un dossier enfant de la racine qui n\'est ni worktree enregistré ni enfant de _mutants (analogue de node22)', node22);
        vrai('4. node22 : intact', existe(path.join(node22, 'node.exe')));
        const petitFils = path.join(MUT, 'g', 'h'); fs.mkdirSync(petitFils, { recursive: true });
        refus('un petit-fils de _mutants', petitFils); vrai('4. petit-fils : intact', existe(petitFils));
        const sousCopie = path.join(reel, 'sous'); fs.mkdirSync(sousCopie);
        refus('un sous-dossier réel d\'une copie', sousCopie); vrai('4. sous-dossier : intact', existe(sousCopie));
        // racine par défaut : un dossier du banc n'y est pas (la racine par défaut est une constante de l'outil, rien de réel n'est visé)
        const r = T.retirer(reel, { executer: true, sortie: muet });
        vrai('4. sans racine de banc, un dossier temporaire est refusé (racine par défaut)', r.code !== 0 && existe(path.join(reel, 'f')));
        // racines de banc invalides
        const r1 = T.retirer(reel, opts({ racine: TMP })); vrai('4. racine de banc = le dossier temporaire lui-même : refus', r1.code !== 0);
        const r2 = T.retirer(reel, opts({ racine: path.join(TMP, '..', 'rm-racine-hors-temp-banc') })); vrai('4. racine de banc hors du dossier temporaire : refus', r2.code !== 0);
        const r3 = T.retirer(reel, opts({ racine: path.dirname(TMP) })); vrai('4. racine de banc parente du dossier temporaire : refus', r3.code !== 0);
        // M1 : le marqueur
        const sansMarq = path.join(ROOT, 'sans-marqueur'); fs.mkdirSync(path.join(sansMarq, '_mutants', 'x'), { recursive: true });
        const r4 = T.retirer(path.join(sansMarq, '_mutants', 'x'), opts({ racine: sansMarq }));
        vrai('4. racine de banc SANS le marqueur du banc : refus, rien supprimé', r4.code !== 0 && /marqueur/.test(String(r4.message)) && existe(path.join(sansMarq, '_mutants', 'x')));
        const faux = path.join(ROOT, 'marqueur-faux'); fs.mkdirSync(path.join(faux, '_mutants', 'x'), { recursive: true }); fs.writeFileSync(path.join(faux, '.rm-retrait-banc'), 'autre chose');
        const r5 = T.retirer(path.join(faux, '_mutants', 'x'), opts({ racine: faux }));
        vrai('4. racine de banc au marqueur FAUX : refus, rien supprimé', r5.code !== 0 && existe(path.join(faux, '_mutants', 'x')));
        vrai('4. rien n\'a été supprimé par les refus de racine', existe(path.join(reel, 'f')));
        // la casse ne compte pas
        const w = monde();
        const rc = T.retirer(w.copie, { ...opts({ racine: ROOT.toUpperCase() }), executer: false });
        v('4. la casse de la racine ne compte pas (plan : code 0)', rc.code, 0);
        const rd = T.retirer(w.copie.toUpperCase(), { ...opts(), executer: false });
        v('4. la casse du dossier ne compte pas (plan : code 0)', rd.code, 0);
        T.retirer(w.copie, opts());
        // une cible dans le dossier lui-même, ou qui le contient : impossible à vérifier, refus
        const w2 = monde();
        jonction(path.join(w2.copie, 'a'), path.join(w2.copie, 'lien-interne'));
        const ri = T.retirer(w2.copie, opts());
        vrai('4. un lien dont la cible est DANS le dossier : refus, rien retiré', ri.code !== 0 && existe(path.join(w2.copie, 'node_modules')) && existe(path.join(w2.copie, 'lien-interne')));
        fs.rmdirSync(path.join(w2.copie, 'lien-interne'));
        jonction(MUT, path.join(w2.copie, 'lien-parent'));
        const rp = T.retirer(w2.copie, opts());
        vrai('4. un lien dont la cible CONTIENT le dossier : refus, rien retiré', rp.code !== 0 && existe(path.join(w2.copie, 'node_modules')));
        fs.rmdirSync(path.join(w2.copie, 'lien-parent'));
        T.retirer(w2.copie, opts());
    }

    // 4a. M4 : les DOSSIERS D'APPORTS, refus dur (le nom suffit, quelle que soit la racine)
    {
        for (const nom of ['Logo FR', 'APPORT-MANUEL', 'logo jp', 'Logo ZH', 'gabarit-pokecardex']) {
            const d = path.join(MUT, nom); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'precieux.png'), 'p');
            const r = T.retirer(d, opts());
            vrai(`4a. « ${nom} » (enfant direct de _mutants, donc admissible sans ça) : refus apports, intact`, r.code !== 0 && /apports/.test(String(r.message)) && existe(path.join(d, 'precieux.png')));
        }
        const dl = path.join(ROOT, 'Desktop', 'LOGO'); fs.mkdirSync(dl, { recursive: true }); fs.writeFileSync(path.join(dl, 'p.png'), 'p');
        const rl = T.retirer(dl, opts());
        vrai('4a. …\\Desktop\\LOGO : refus apports, intact', rl.code !== 0 && /apports/.test(String(rl.message)) && existe(path.join(dl, 'p.png')));
        const est = typeof T.estDossierApports === 'function' ? T.estDossierApports : () => null;
        const ok1 = ['C:\\x\\Logo FR', 'c:\\x\\APPORT-MANUEL\\sous', 'C:\\Users\\u\\Desktop\\LOGO', 'D:/a/logo jp/b', 'x\\Logo ZH', 'x\\GABARIT-Pokecardex\\y'].map(est);
        vrai('4a. la fonction reconnaît les six noms (casse et séparateurs)', ok1.every(Boolean));
        const ko1 = ['C:\\x\\LOGO', 'C:\\x\\Logo FRx', 'C:\\x\\logos', 'C:\\x\\Desktop\\LOGOS'].map(est);
        vrai('4a. …et ne confond pas LOGO hors Desktop, ni un nom qui n\'est qu\'un préfixe', ko1.every(x => x === null));
    }

    // 4b. un lien cassé (cible absente) se retire
    {
        const w = monde();
        const mort = path.join(w.base, 'mort'); fs.mkdirSync(mort); jonction(mort, path.join(w.copie, 'casse')); fs.rmdirSync(mort);
        const r = T.retirer(w.copie, opts());
        v('4b. lien cassé : code 0', r.code, 0);
        vrai('4b. la copie a disparu, le témoin est intact', !existe(w.copie) && JSON.stringify(photo(w.temoin)) === JSON.stringify(w.avantT));
    }

    // 4c. M3 : une jonction vers un dossier d'APPORTS est signalée en ROUGE (plan et journal), retirée comme les autres, ses comptes imprimés à part
    {
        const w = monde();
        const apports = path.join(w.base, 'Logo FR'); fairetemoin(apports, 'apports');
        jonction(apports, path.join(w.copie, 'logos'));
        const avantA = photo(apports);
        let sortie = '';
        const rp = T.retirer(w.copie, { executer: false, racine: ROOT, journal: JOURNAL, sortie: (s) => { sortie += s + '\n'; } });
        v('4c. plan : code 0', rp.code, 0);
        vrai('4c. plan : ROUGE, dossier d\'apports, règle 3', /ROUGE/.test(sortie) && /apports manuels/.test(sortie) && /JAMAIS/.test(sortie));
        sortie = '';
        const re = T.retirer(w.copie, { executer: true, racine: ROOT, journal: JOURNAL, sortie: (s) => { sortie += s + '\n'; } });
        v('4c. exécution : code 0 (le lien seul est retiré)', re.code, 0);
        vrai('4c. la cible d\'apports est intacte', JSON.stringify(photo(apports)) === JSON.stringify(avantA));
        vrai('4c. ses comptes AVANT et APRÈS sont imprimés à part', /ROUGE compte AVANT de la cible d'apports/.test(sortie) && /ROUGE compte APRÈS de la cible d'apports/.test(sortie));
        const jl = lignesJournal().filter(l => l.dossier.toLowerCase().endsWith(path.basename(w.copie).toLowerCase())).pop() || { liens: [], apports: [] };
        vrai('4c. le journal marque la jonction d\'apports et porte les comptes avant/après', jl.liens.some(l => l.apports === true) && (jl.apports || []).length === 1 && jl.apports[0].avant && jl.apports[0].apres);
    }

    // 5. le PLAN ne supprime rien
    {
        const w = monde();
        const avantBase = photo(w.base), avantMut = photo(MUT); let sortie = '';
        const r = T.retirer(w.copie, { executer: false, racine: ROOT, journal: JOURNAL, sortie: (s) => { sortie += s + '\n'; } });
        v('5. plan : code 0', r.code, 0);
        v('5. plan : les témoins et l\'arbre sont identiques', [photo(w.base), photo(MUT)], [avantBase, avantMut]);
        vrai('5. plan : les 2 liens et leurs cibles sont imprimés', (sortie.match(/ -> /g) || []).length === 2 && sortie.toLowerCase().includes(fs.realpathSync.native(w.temoin).toLowerCase()));
        vrai('5. plan : les comptes de fichiers et d\'octets sont imprimés', /fichiers/.test(sortie) && /octets/.test(sortie));
        const nl = lignesJournal().length;
        T.retirer(w.copie, { executer: false, racine: ROOT, journal: JOURNAL, sortie: muet });
        v('5. plan : rien n\'est écrit au journal', lignesJournal().length, nl);
        T.retirer(w.copie, opts());
    }

    // 6. la ligne de commande
    {
        const outil = path.join(__dirname, '..', '..', 'outils', 'retirer-worktree.js');
        const j2 = path.join(ROOT, 'journal-cli.jsonl');
        const cli = (args, env = {}) => spawnSync(process.execPath, [outil, ...args], { encoding: 'utf8', env: { ...process.env, RM_RETRAIT_RACINE_BANC: ROOT, RM_RETRAIT_JOURNAL: j2, ...env } });
        const w = monde();
        const avantBase = photo(w.base);
        const p = cli([w.copie]);
        v('6. CLI plan : code 0', p.status, 0);
        v('6. CLI plan : rien de supprimé', photo(w.base), avantBase);
        const e = cli([w.copie, '--executer']);
        v('6. CLI --executer : code 0', e.status, 0);
        vrai('6. CLI --executer : la copie a disparu, le témoin est intact', !existe(w.copie) && JSON.stringify(photo(w.temoin)) === JSON.stringify(w.avantT));
        vrai('6. CLI : une ligne au journal du banc', existe(j2) && fs.readFileSync(j2, 'utf8').split(/\r?\n/).filter(Boolean).length === 1);
        const w2 = monde();
        vrai('6. CLI : un argument inconnu est refusé', cli([w2.copie, '--force']).status !== 0 && existe(w2.copie));
        vrai('6. CLI : deux dossiers sont refusés', cli([w2.copie, w2.base]).status !== 0 && existe(w2.copie));
        vrai('6. CLI : aucun dossier est refusé', cli([]).status !== 0);
        vrai('6. CLI : racine de banc hors du dossier temporaire : refus', cli([w2.copie, '--executer'], { RM_RETRAIT_RACINE_BANC: path.join(TMP, '..', 'rm-racine-hors-temp-banc') }).status !== 0 && existe(w2.copie));
        vrai('6. CLI : journal hors du dossier temporaire : refus', cli([w2.copie, '--executer'], { RM_RETRAIT_JOURNAL: path.join(TMP, '..', 'journal-hors-temp.jsonl') }).status !== 0 && existe(w2.copie));
        vrai('6. CLI : sans racine de banc, un dossier temporaire est refusé', cli([w2.copie, '--executer'], { RM_RETRAIT_RACINE_BANC: '' }).status !== 0 && existe(w2.copie));
        T.retirer(w2.copie, opts());
        // M1 : le cas démontré par la relecture : variables de banc + TEMP/TMP redirigés vers un faux « bureau » portant un « Logo FR »
        const faux = path.join(ROOT, 'faux-tmp'); const fauxBureau = path.join(faux, 'faux-bureau');
        const logo = path.join(fauxBureau, 'Logo FR'); fs.mkdirSync(logo, { recursive: true }); fs.writeFileSync(path.join(logo, 'precieux.png'), 'p');
        const envRedirige = { TEMP: faux, TMP: faux, RM_RETRAIT_RACINE_BANC: fauxBureau, RM_RETRAIT_JOURNAL: path.join(faux, 'j.jsonl') };
        const a = cli([logo, '--executer'], envRedirige);
        vrai('6. CLI relecture : variables + TEMP redirigé + Logo FR, sans marqueur : refus, intact', a.status !== 0 && existe(path.join(logo, 'precieux.png')));
        fs.writeFileSync(path.join(fauxBureau, '.rm-retrait-banc'), 'rm-retrait-banc-v1');   // même AVEC un marqueur copié, « Logo FR » reste refusé
        fs.mkdirSync(path.join(fauxBureau, '_mutants'), { recursive: true });
        const logoMut = path.join(fauxBureau, '_mutants', 'Logo FR'); fs.mkdirSync(logoMut); fs.writeFileSync(path.join(logoMut, 'precieux.png'), 'p');
        const b = cli([logoMut, '--executer'], envRedirige);
        vrai('6. CLI relecture : même avec un marqueur, un dossier d\'apports est refusé, intact', b.status !== 0 && existe(path.join(logoMut, 'precieux.png')) && /apports/.test(String(b.stdout) + String(b.stderr)));
        const c = cli([logo, '--executer'], envRedirige);
        vrai('6. CLI relecture : et le « Logo FR » hors _mutants reste refusé', c.status !== 0 && existe(path.join(logo, 'precieux.png')));
    }
} catch (e) {
    console.log(`❌ exception du banc : ${e && e.stack || e}`); ko++;
} finally {
    try { nettoyerBanc(); } catch (e) { console.log(`❌ nettoyage : ${e.message}`); ko++; }
    vrai('nettoyage : le dossier du banc est retiré', !existe(ROOT) && !existe(HORS));
    bilan();
}
