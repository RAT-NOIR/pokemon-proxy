'use strict';
// Banc de outils/retirer-worktree.js. TOUT vit dans un dossier temporaire créé ici (fs.mkdtempSync sous os.tmpdir()) : aucun dossier réel du poste
// n'est nommé, aucune jonction ne vise un dossier qui n'est pas à ce banc. Aucune base, aucun réseau (git local seulement).
// Pas de _harnais.js : il charge dotenv et mongoose, ce banc n'en a pas besoin (et ne doit pas lire .env). Même format de bilan que H.bilan().
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
// un monde : base/temoin (+ temoin2) et base/copie avec DEUX jonctions (une en tête, une cachée au fond) vers les témoins.
// Un lien est aussi posé DANS le témoin vers témoin2 : une traversée naïve viderait les deux.
function monde() {
    const base = path.join(ROOT, `w${++n}`);
    const temoin = path.join(base, 'temoin'), temoin2 = path.join(base, 'temoin2'), copie = path.join(base, 'copie');
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

try {
    const gitExe = T.trouverGit();
    const git = (cwd, ...a) => spawnSync(gitExe, ['-c', 'user.name=banc', '-c', 'user.email=banc@example.invalid', ...a], { cwd, encoding: 'utf8' });

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
        const j = lignesJournal().filter(l => l.dossier.toLowerCase().endsWith('copie') && l.dossier.includes(path.basename(w.base)));
        v('1. une ligne de journal pour ce retrait', j.length, 1);
        const j0 = j[0] || { liens: [], date: '', issue: '' };
        v('1. le journal nomme 2 liens retirés', (j0.liens || []).length, 2);
        vrai('1. le journal porte les cibles, la date UTC et l\'issue ok', j0.liens.length > 0 && j0.liens.every(l => l.cible) && /Z$/.test(j0.date) && j0.issue === 'ok');
    }

    // 2. un VRAI worktree git, avec une jonction vers le témoin
    {
        const base = path.join(ROOT, `w${++n}`); fs.mkdirSync(base);
        const depot = path.join(base, 'depot'), wt = path.join(base, 'wt'), temoin = path.join(base, 'temoin'), temoin2 = path.join(base, 'temoin2');
        fairetemoin(temoin, 'un'); fairetemoin(temoin2, 'deux'); jonction(temoin2, path.join(temoin, 'sub', 'vers-t2'));
        fs.mkdirSync(depot);
        git(depot, 'init', '-q'); fs.writeFileSync(path.join(depot, 'f.txt'), 'f');
        git(depot, 'add', 'f.txt'); const c = git(depot, 'commit', '-q', '-m', 'init');
        v('2. (préparation) le commit du dépôt temporaire passe', c.status, 0);
        const a = git(depot, 'worktree', 'add', '-q', '-b', 'banc', wt);
        v('2. (préparation) git worktree add', a.status, 0);
        jonction(temoin, path.join(wt, 'node_modules'));
        fs.mkdirSync(path.join(wt, 'x', 'y'), { recursive: true }); jonction(temoin2, path.join(wt, 'x', 'y', 'cache'));
        const avantT = photo(temoin), avantT2 = photo(temoin2);
        const r = T.retirer(wt, opts());
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
        const reel = path.join(base, 'reel'); fs.mkdirSync(reel); fs.writeFileSync(path.join(reel, 'f'), 'f');
        const lien = path.join(base, 'lien'); jonction(reel, lien);
        refus('un dossier qui est lui-même un lien', lien);
        vrai('4. lien : le lien et sa cible sont intacts', existe(lien) && existe(path.join(reel, 'f')));
        // un dépôt principal (.git réel)
        const depot = path.join(base, 'depot'); fs.mkdirSync(path.join(depot, '.git'), { recursive: true }); fs.writeFileSync(path.join(depot, 'f'), 'f');
        refus('un dépôt principal (.git réel)', depot); vrai('4. dépôt : intact', existe(path.join(depot, 'f')) && existe(path.join(depot, '.git')));
        // absent
        refus('un dossier absent', path.join(base, 'absent'));
        // la racine elle-même, et son parent
        refus('la racine elle-même', ROOT); refus('le parent de la racine', path.dirname(ROOT));
        vrai('4. la racine est intacte', existe(base));
        // un chemin qui traverse une jonction vers l'extérieur
        const cible = path.join(HORS, 'cible'); fs.mkdirSync(cible); fs.writeFileSync(path.join(cible, 'f'), 'f');
        jonction(HORS, path.join(base, 'passage'));
        refus('un chemin qui passe par une jonction vers l\'extérieur', path.join(base, 'passage', 'cible'));
        vrai('4. passage : la cible extérieure est intacte', existe(path.join(cible, 'f')));
        // un fichier, pas un dossier
        fs.writeFileSync(path.join(base, 'fichier.txt'), 'x'); refus('un fichier', path.join(base, 'fichier.txt'));
        // racine par défaut : un dossier du banc n'y est pas (la racine par défaut est une constante de l'outil, rien de réel n'est visé)
        const r = T.retirer(reel, { executer: true, sortie: muet });
        vrai('4. sans racine de banc, un dossier temporaire est refusé (racine par défaut)', r.code !== 0 && existe(path.join(reel, 'f')));
        // racines de banc invalides
        const r1 = T.retirer(reel, opts({ racine: TMP })); vrai('4. racine de banc = le dossier temporaire lui-même : refus', r1.code !== 0);
        const r2 = T.retirer(reel, opts({ racine: path.join(TMP, '..', 'rm-racine-hors-temp-banc') })); vrai('4. racine de banc hors du dossier temporaire : refus', r2.code !== 0);
        const r3 = T.retirer(reel, opts({ racine: path.dirname(TMP) })); vrai('4. racine de banc parente du dossier temporaire : refus', r3.code !== 0);
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
        jonction(w2.base, path.join(w2.copie, 'lien-parent'));
        const rp = T.retirer(w2.copie, opts());
        vrai('4. un lien dont la cible CONTIENT le dossier : refus, rien retiré', rp.code !== 0 && existe(path.join(w2.copie, 'node_modules')));
        fs.rmdirSync(path.join(w2.copie, 'lien-parent'));
        T.retirer(w2.copie, opts());
    }

    // 4b. un lien cassé (cible absente) se retire
    {
        const w = monde();
        const mort = path.join(w.base, 'mort'); fs.mkdirSync(mort); jonction(mort, path.join(w.copie, 'casse')); fs.rmdirSync(mort);
        const r = T.retirer(w.copie, opts());
        v('4b. lien cassé : code 0', r.code, 0);
        vrai('4b. la copie a disparu, le témoin est intact', !existe(w.copie) && JSON.stringify(photo(w.temoin)) === JSON.stringify(w.avantT));
    }

    // 5. le PLAN ne supprime rien
    {
        const w = monde();
        const avantBase = photo(w.base); let sortie = '';
        const r = T.retirer(w.copie, { executer: false, racine: ROOT, journal: JOURNAL, sortie: (s) => { sortie += s + '\n'; } });
        v('5. plan : code 0', r.code, 0);
        v('5. plan : l\'arbre et les témoins sont identiques', photo(w.base), avantBase);
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
    }
} catch (e) {
    console.log(`❌ exception du banc : ${e && e.stack || e}`); ko++;
} finally {
    try { nettoyerBanc(); } catch (e) { console.log(`❌ nettoyage : ${e.message}`); ko++; }
    vrai('nettoyage : le dossier du banc est retiré', !existe(ROOT) && !existe(HORS));
    bilan();
}
