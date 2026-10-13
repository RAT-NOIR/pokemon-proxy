'use strict';
// UN SEUL outil pour retirer un worktree ou une copie du poste, SANS JAMAIS toucher aux cibles de ses jonctions (décision du testeur, 2026-10-13).
//
// POURQUOI : le 2026-10-12 à 21:54:11 UTC, `git worktree remove --force` sur une copie à jonctions a TRAVERSÉ les jonctions et vidé quatre dossiers
// du dépôt principal, dont `Logo FR` et `apport-manuel` (fichiers du testeur que git ne suit pas).
//
//   node outils/retirer-worktree.js <dossier>              le PLAN (lecture seule) : liens, cibles, comptes, git status. Ne supprime rien.
//   node outils/retirer-worktree.js <dossier> --executer   la procédure, avec arrêt à la première anomalie (code de sortie non nul).
//   …  --jeter-modifications                               seule façon de retirer un worktree SALE ; le journal liste ce qui est jeté.
//
// SEULE LA LIGNE DE COMMANDE EST UN POINT D'ENTRÉE SÛR. Les options de la fonction `retirer(dossier, opts)` (racine, journal, depots, instrumentReanalyse,
// lancerGit, lireDossier, avantGeste, apres*) sont réservées au banc : un script qui fait `require` de ce fichier les contourne.
//
// LA SUPPRESSION N'EST PLUS DÉLÉGUÉE À GIT. Ordre, avec arrêt à la première anomalie :
//   1. admission et contrôles, SANS aucune action : forme admise, aucun worktree enregistré ni .git dessous, worktree non verrouillé, propre (git status) ;
//   2. inventaire, retrait de CHAQUE lien seul, recompte des cibles (fichiers, octets, dossiers, liens, dernière modification) ;
//   3. RENOMMAGE de la copie en quarantaine (<nom>.retrait-<horodatage>, même parent) : son chemin n'est plus connu des autres processus ;
//   4. inventaire Node PUIS instrument indépendant (PowerShell, attribut ReparsePoint) sur le chemin RENOMMÉ ; un point : arrêt, la copie reste en quarantaine ;
//   5. suppression en Node, entrée par entrée, `lstat` juste avant chaque geste : un lien est retiré comme lien (jamais parcouru) et signalé ; un point
//      de réanalyse qui n'est pas un lien arrête ; un dossier est vidé puis retiré par `rmdirSync` NON récursif ; un fichier par `unlinkSync`.
//      Aucune suppression récursive de bibliothèque, nulle part ;
//   6. worktree enregistré : `git worktree prune` (métadonnées seulement), puis vérification qu'il n'est plus listé ;
//   7. recompte final des cibles : un écart est une ALERTE ROUGE.
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE, ET RIEN D'AUTRE :
//   (a) un worktree ENREGISTRÉ (`git worktree list --porcelain` de l'un des dépôts connus) situé STRICTEMENT sous `…\rat-market-travail\api\` ;
//   (b) un enfant DIRECT de `…\rat-market-travail\api\_mutants\`.
// Jamais un dépôt principal, jamais `api\` lui-même, jamais `node22`, jamais un sous-dossier d'un worktree, jamais un lien.
// Refus dur, quel que soit l'environnement : tout chemin qui contient un dossier d'apports (Logo FR, apport-manuel, Desktop\LOGO, Logo JP, Logo ZH,
// GABARIT-pokecardex). Les variables de banc (RM_RETRAIT_RACINE_BANC, RM_RETRAIT_JOURNAL) ne valent que si la racine qu'elles nomment est sous
// C:\Users\Yung\AppData\Local\Temp (écrit EN DUR : ni os.tmpdir(), ni TEMP, ni TMP) ET porte le marqueur que le banc écrit lui-même ; sinon : refus.
// Aucune dépendance : bibliothèque standard seulement. Aucun secret n'est lu ni affiché.
//
// CODES DE SORTIE : 0 fait (ou plan) · 1 refus d'entrée · 2 erreur · 3 refus en cours de route (cible changée, lien resté ou réapparu, point de
// réanalyse resté, instrument indépendant muet, renommage impossible) · 4 échec de la suppression ou de `prune` · 5 ALERTE : une cible a changé APRÈS la suppression.
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const RACINE_PAR_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\api';
const JOURNAL_PAR_DEFAUT = path.join(RACINE_PAR_DEFAUT, 'journal-retraits.jsonl');
const DEPOTS_PAR_DEFAUT = ['C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2', 'C:\\Users\\Yung\\Desktop\\pokemon-proxy'];
const TEMP_EN_DUR = 'C:\\Users\\Yung\\AppData\\Local\\Temp';   // jamais os.tmpdir() : TEMP et TMP sont sous le contrôle de l'environnement
const MARQUEUR_BANC = '.rm-retrait-banc';          // fichier que SEUL le banc écrit dans sa racine, avec ce contenu exact
const JETON_BANC = 'rm-retrait-banc-v1';
const NOMS_APPORTS = ['logo fr', 'apport-manuel', 'logo jp', 'logo zh', 'gabarit-pokecardex'];
const FIN_INSTRUMENT = 'RM-FIN';

class Refus extends Error { constructor(code, issue, message) { super(message); this.code = code; this.issue = issue; } }

const cle = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p));
// « STRICTEMENT sous » : ni égal, ni parent, ni voisin. Casse ignorée sous Windows.
function sousStrict(parent, enfant) {
    const r = path.relative(cle(path.resolve(parent)), cle(path.resolve(enfant)));
    return r !== '' && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r);
}
const reel = (p) => fs.realpathSync.native(p);
const lstatOuNull = (p) => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; } };
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Un chemin qui contient un dossier d'apports (insensible à la casse). `LOGO` ne compte que directement sous `Desktop`.
function estDossierApports(chemin) {
    const parts = String(chemin).split(/[\\/]+/).filter(Boolean).map(s => s.toLowerCase());
    for (let i = 0; i < parts.length; i++) {
        if (NOMS_APPORTS.includes(parts[i])) return parts[i];
        if (parts[i] === 'logo' && i > 0 && parts[i - 1] === 'desktop') return 'desktop\\logo';
    }
    return null;
}

function trouverGit() {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    let apps;
    try { apps = fs.readdirSync(base).filter(n => /^app-/.test(n)); } catch { apps = []; }
    if (!apps.length) throw new Refus(2, 'erreur', 'git introuvable sous %LOCALAPPDATA%\\GitHubDesktop\\app-*');
    apps.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).reverse();
    const exe = path.join(base, apps[0], 'resources', 'app', 'git', 'cmd', 'git.exe');
    if (!fs.existsSync(exe)) throw new Refus(2, 'erreur', 'git introuvable : ' + exe);
    return exe;
}

// La racine permise : la constante, ou (BANCS SEULEMENT) une racine STRICTEMENT sous le Temp écrit en dur, qui porte le marqueur du banc, avec un
// journal à elle sous ce même Temp. Un journal de banc sans racine de banc, ou l'inverse, est refusé.
function resoudreRacine(opts) {
    const banc = opts.racine !== undefined && opts.racine !== null && opts.racine !== '';
    if (!banc) {
        if (opts.journal) throw new Refus(1, 'refus-entree', 'un journal de banc sans racine de banc est refusé');
        let r; try { r = reel(RACINE_PAR_DEFAUT); } catch { throw new Refus(1, 'refus-entree', 'la racine permise est absente de ce poste'); }
        return { racine: r, journal: JOURNAL_PAR_DEFAUT, banc: false, depots: DEPOTS_PAR_DEFAUT };
    }
    if (!opts.journal) throw new Refus(1, 'refus-entree', 'une racine de banc exige un journal de banc');
    let tmp; try { tmp = reel(TEMP_EN_DUR); } catch { throw new Refus(1, 'refus-entree', 'le dossier Temp écrit en dur est absent de ce poste : aucune racine de banc'); }
    let r; try { r = reel(opts.racine); } catch { throw new Refus(1, 'refus-entree', 'racine de banc absente'); }
    if (!sousStrict(tmp, r)) throw new Refus(1, 'refus-entree', `racine de banc refusée : elle doit être STRICTEMENT sous ${TEMP_EN_DUR} (écrit en dur, jamais TEMP ni TMP)`);
    let contenu = null; try { contenu = fs.readFileSync(path.join(r, MARQUEUR_BANC), 'utf8').trim(); } catch { /* absent */ }
    if (contenu !== JETON_BANC) throw new Refus(1, 'refus-entree', `racine de banc refusée : le marqueur ${MARQUEUR_BANC} que le banc écrit lui-même est absent ou faux`);
    let jd; try { jd = reel(path.dirname(path.resolve(opts.journal))); } catch { throw new Refus(1, 'refus-entree', 'dossier du journal de banc absent'); }
    const j = path.join(jd, path.basename(opts.journal));
    if (!sousStrict(tmp, j)) throw new Refus(1, 'refus-entree', `journal de banc refusé : il doit être STRICTEMENT sous ${TEMP_EN_DUR}`);
    return { racine: r, journal: j, banc: true, depots: Array.isArray(opts.depots) ? opts.depots : [] };
}

// Refus d'entrée (le dossier est-il ce qu'il prétend être ?). Retourne { dossier (réel), worktree: null | { repo } }.
function verifierEntree(brut, racine) {
    if (typeof brut !== 'string' || !brut.trim()) throw new Refus(1, 'refus-entree', 'aucun dossier donné');
    const abs = path.resolve(brut);
    const st = lstatOuNull(abs);
    if (!st) throw new Refus(1, 'refus-entree', `dossier absent : ${abs}`);
    if (st.isSymbolicLink()) throw new Refus(1, 'refus-entree', `le dossier est lui-même un lien (jonction ou lien symbolique) : ${abs}`);
    if (!st.isDirectory()) throw new Refus(1, 'refus-entree', `ce n'est pas un dossier : ${abs}`);
    const r = reel(abs);
    if (cle(r) !== cle(abs)) throw new Refus(1, 'refus-entree', `le chemin traverse un lien ou un nom court (réel : ${r}) : donne le chemin réel`);
    const ap = estDossierApports(r);
    if (ap) throw new Refus(1, 'refus-apports', `le chemin contient un dossier d'apports manuels (« ${ap} ») : jamais retiré, quel que soit l'environnement (${r})`);
    if (!sousStrict(racine, r)) throw new Refus(1, 'refus-entree', `dossier hors de la racine permise (ou égal à elle) : ${r}`);
    const g = lstatOuNull(path.join(r, '.git'));
    if (!g) return { dossier: r, worktree: null };
    if (g.isSymbolicLink()) throw new Refus(1, 'refus-entree', `.git est un lien : refusé (${r})`);
    if (g.isDirectory()) throw new Refus(1, 'refus-entree', `dépôt principal (dossier .git réel) : refusé (${r})`);
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(r, '.git'), 'utf8'));
    if (!m) throw new Refus(1, 'refus-entree', `.git illisible : ni dossier ni fichier gitdir (${r})`);
    const gitdir = path.resolve(r, m[1]);
    const cd = lstatOuNull(path.join(gitdir, 'commondir'));
    if (!lstatOuNull(gitdir) || !cd) throw new Refus(1, 'refus-entree', `worktree orphelin : son dépôt est introuvable (${r})`);
    const commun = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
    const repo = path.basename(commun).toLowerCase() === '.git' ? path.dirname(commun) : commun;
    if (!lstatOuNull(repo)) throw new Refus(1, 'refus-entree', `worktree orphelin : son dépôt est introuvable (${r})`);
    return { dossier: r, worktree: { repo } };
}

// Chemins des worktrees ENREGISTRÉS par git dans les dépôts connus (le premier de chaque liste est le dépôt principal : écarté).
function worktreesEnregistres(depots, git) {
    const res = new Set();
    for (const d of depots) {
        const r = spawnSync(git, ['-C', d, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
        if (r.error || r.status !== 0) continue;
        String(r.stdout).replace(/\r/g, '').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9)).slice(1)
            .forEach(n => res.add(cle(path.resolve(n))));
    }
    return res;
}

// Ce que l'outil AUTORISE, et rien d'autre : (a) un worktree enregistré sous la racine ; (b) un enfant direct de _mutants.
function admettre(r, entree, ctx) {
    if (entree.worktree) {
        const enregistres = worktreesEnregistres(ctx.depots, trouverGit());
        if (!enregistres.has(cle(r))) throw new Refus(1, 'refus-non-enregistre', `ce worktree n'est enregistré (git worktree list) dans aucun des dépôts connus (${ctx.depots.length}) : refusé (${r})`);
        return;
    }
    const mutants = path.join(ctx.racine, '_mutants');
    if (cle(path.dirname(r)) !== cle(mutants))
        throw new Refus(1, 'refus-non-admis', `ni un worktree enregistré, ni un enfant DIRECT de ${mutants} : refusé (${r})`);
}

// Premier `.git` (fichier ou dossier) trouvé SOUS la racine du dossier, à n'importe quelle profondeur ; les liens ne sont jamais suivis.
function trouverGitDedans(dossier) {
    const pile = [dossier];
    while (pile.length) {
        const d = pile.pop();
        for (const e of fs.readdirSync(d)) {
            const p = path.join(d, e), s = fs.lstatSync(p);
            if (e === '.git' && d !== dossier) return p;
            if (s.isSymbolicLink() || e === '.git') continue;
            if (s.isDirectory()) pile.push(p);
        }
    }
    return null;
}

// Contrôles de l'étape 1 : LECTURE SEULE, avant toute action. Rend les lignes de `git status --porcelain` (worktree seulement).
function controlesAvantAction(dossier, entree, ctx, lanceurGit) {
    if (ctx.depots.length) {
        const enr = worktreesEnregistres(ctx.depots, trouverGit());
        for (const p of enr) if (sousStrict(dossier, p)) throw new Refus(1, 'refus-contient-worktree', `le dossier contient un worktree enregistré (${p}) : retire-le d'abord, avec cet outil`);
    }
    const dedans = trouverGitDedans(dossier);
    if (dedans) throw new Refus(1, 'refus-contient-git', `le dossier contient un .git à l'intérieur (${dedans}) : un dépôt ou un worktree s'y cache, refusé`);
    if (!entree.worktree) return [];
    const liste = lanceurGit(['-C', entree.worktree.repo, 'worktree', 'list', '--porcelain']);
    if (liste.status !== 0) throw new Refus(1, 'refus-liste-git', `git worktree list a échoué (code ${liste.status}) : je ne peux pas conclure sur le verrou`);
    const blocs = String(liste.stdout).replace(/\r/g, '').split(/\n\n+/);
    for (const b of blocs) {
        const lignes = b.split('\n');
        const wl = lignes.find(l => l.startsWith('worktree '));
        if (wl && cle(path.resolve(wl.slice(9))) === cle(dossier) && lignes.some(l => /^locked(\s|$)/.test(l)))
            throw new Refus(1, 'refus-verrou', `ce worktree est VERROUILLÉ par git (${lignes.find(l => /^locked/.test(l))}) : déverrouille-le toi-même (git worktree unlock), je ne force rien`);
    }
    const st = lanceurGit(['-C', dossier, 'status', '--porcelain']);
    if (st.status !== 0) throw new Refus(1, 'refus-status', `git status a échoué (code ${st.status}) : je ne peux pas dire si le worktree est propre`);
    return String(st.stdout).replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
}

// Inventaire des liens de l'arbre, par lstat, SANS JAMAIS descendre dans un lien.
function inventaire(dossier, lire = fs.readdirSync) {
    const liens = [], pile = [dossier];
    while (pile.length) {
        const d = pile.pop();
        for (const e of lire(d)) {
            const p = path.join(d, e), s = fs.lstatSync(p);
            if (s.isSymbolicLink()) {
                let cible = null; try { cible = reel(p); } catch { /* lien cassé */ }
                liens.push({ chemin: p, rel: path.relative(dossier, p), cible, cassee: cible === null, litteral: cible === null ? safeReadlink(p) : null });
            } else if (s.isDirectory()) pile.push(p);
        }
    }
    return liens.sort((a, b) => a.chemin.localeCompare(b.chemin));
}
function safeReadlink(p) { try { return fs.readlinkSync(p); } catch { return null; } }

// INSTRUMENT INDÉPENDANT DE NODE : PowerShell liste les points de réanalyse par leur ATTRIBUT (jonction, lien, point de montage, autre).
// Le chemin passe par une variable de l'environnement de l'enfant (jamais dans une chaîne de commande) ; spawnSync, tableau d'arguments, pas de shell.
// Il doit afficher la sentinelle de fin : un instrument muet, en erreur ou absent est un REFUS.
function reanalyse(dossier, instrument) {
    const script = "$ErrorActionPreference='Stop'; try { Get-ChildItem -LiteralPath $env:RM_RETRAIT_CIBLE -Recurse -Force -Attributes ReparsePoint | ForEach-Object { $_.FullName }; Write-Output '" + FIN_INSTRUMENT + "' } catch { [Console]::Error.WriteLine('ERREUR ' + $_.Exception.Message); exit 1 }";
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const lancer = typeof instrument === 'function' ? instrument
        : (d) => spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...process.env, RM_RETRAIT_CIBLE: d }, timeout: 120000 });
    let r;
    try { r = lancer(dossier); } catch (e) { return { ok: false, points: [], raison: `instrument en panne : ${e.message}` }; }
    if (!r || r.error) return { ok: false, points: [], raison: `instrument introuvable ou en erreur : ${r && r.error ? r.error.message : 'aucune réponse'}` };
    if (r.status !== 0) return { ok: false, points: [], raison: `instrument en échec (code ${r.status})` };
    const lignes = String(r.stdout || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!lignes.length || lignes[lignes.length - 1] !== FIN_INSTRUMENT) return { ok: false, points: [], raison: 'instrument muet ou illisible (sentinelle de fin absente)' };
    return { ok: true, points: lignes.slice(0, -1), raison: null };
}

// Comptes d'une cible : fichiers, octets, dossiers, liens (comptés, jamais suivis), la DERNIÈRE MODIFICATION (mtime maximal de tout ce qu'elle contient),
// et le premier dossier d'apports qu'elle CONTIENT (le parcours est déjà fait : coût nul).
function instantane(cible) {
    if (cible === null) return { absente: true };
    const s = lstatOuNull(cible);
    if (!s) return { absente: true };
    const c = { fichiers: 0, octets: 0, dossiers: 0, liens: 0, modif: s.mtimeMs, apportsDedans: null };
    if (!s.isDirectory()) { c.fichiers = 1; c.octets = s.size; return c; }
    const pile = [cible];
    while (pile.length) {
        const d = pile.pop();
        for (const e of fs.readdirSync(d)) {
            const p = path.join(d, e), t = fs.lstatSync(p);
            if (t.mtimeMs > c.modif) c.modif = t.mtimeMs;
            if (t.isSymbolicLink()) c.liens++;
            else if (t.isDirectory()) {
                c.dossiers++; pile.push(p);
                if (!c.apportsDedans && (NOMS_APPORTS.includes(e.toLowerCase()) || (e.toLowerCase() === 'logo' && path.basename(d).toLowerCase() === 'desktop'))) c.apportsDedans = p;
            } else { c.fichiers++; c.octets += t.size; }
        }
    }
    return c;
}
const iso = (ms) => new Date(ms).toISOString();
const ecart = (a, b) => {
    if (a.absente || b.absente) return a.absente && b.absente ? null : (a.absente ? 'absente puis présente' : 'présente puis absente');
    const parts = [];
    for (const k of ['fichiers', 'octets', 'dossiers', 'liens']) if (a[k] !== b[k]) parts.push(`${k} ${a[k]} puis ${b[k]} (${b[k] - a[k] > 0 ? '+' : ''}${b[k] - a[k]})`);
    if (a.modif !== b.modif) parts.push(`dernière modification ${iso(a.modif)} puis ${iso(b.modif)}`);
    return parts.length ? parts.join(', ') : null;
};
const decrire = (c) => (c.absente ? 'cible absente' : `${c.fichiers} fichiers, ${c.octets} octets, ${c.dossiers} dossiers, ${c.liens} liens, dernière modification ${iso(c.modif)}`);

// Réessaie un geste de suppression sur une erreur passagère (antivirus, indexeur), trois fois au plus.
function essayer(fn) {
    for (let i = 0; ; i++) {
        try { return fn(); }
        catch (e) { if (i < 3 && ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(e.code)) { dormir(200); continue; } throw e; }
    }
}

// Retire UN lien, sans suivre sa cible. rmdirSync (non récursif) retire une jonction ou un lien de dossier ; unlinkSync un lien de fichier.
function retirerLien(chemin) {
    const s = fs.lstatSync(chemin);
    if (!s.isSymbolicLink()) throw new Refus(3, 'refus-lien', `ce n'est plus un lien : ${chemin}`);
    try { fs.rmdirSync(chemin); }
    catch (e) {
        if (e.code === 'ENOTDIR' || e.code === 'EPERM' || e.code === 'EISDIR') fs.unlinkSync(chemin);
        else throw e;
    }
}

// SUPPRESSION EN NODE, entrée par entrée. `lstat` juste avant chaque geste ; le parent est revérifié (non lien) juste avant chaque geste ;
// un lien est retiré comme lien et noté ; aucune fonction récursive de bibliothèque.
function supprimerEntree(p, parent, rapport, avantGeste) {
    if (typeof avantGeste === 'function') avantGeste(p);                  // INJECTION DE BANC (rien en production)
    const verifierParent = () => {
        if (parent === null) return;
        const sp = lstatOuNull(parent);
        if (!sp || sp.isSymbolicLink() || !sp.isDirectory()) throw new Refus(4, 'arret-parent', `le dossier parent n'est plus un dossier réel (${parent}) : j'arrête sans rien supprimer de plus`);
    };
    const s = lstatOuNull(p);
    if (!s) return;
    if (s.isSymbolicLink()) { verifierParent(); retirerLien(p); rapport.liens.push(p); return; }
    if (s.isDirectory()) {
        if (cle(reel(p)) !== cle(path.resolve(p))) throw new Refus(4, 'arret-reanalyse', `un point de réanalyse qui n'est pas un lien est apparu (${p} -> ${reel(p)}) : j'arrête`);
        for (const e of fs.readdirSync(p)) supprimerEntree(path.join(p, e), p, rapport, avantGeste);
        verifierParent();
        const sd = lstatOuNull(p);
        if (sd && sd.isSymbolicLink()) { retirerLien(p); rapport.liens.push(p); return; }   // remplacé par un lien pendant que nous le vidions
        essayer(() => fs.rmdirSync(p));                                                      // NON récursif
        return;
    }
    verifierParent();
    essayer(() => fs.unlinkSync(p));
}

function retirer(dossierBrut, opts = {}) {
    const sortie = typeof opts.sortie === 'function' ? opts.sortie : (s) => console.log(s);
    const executer = opts.executer === true;
    const rec = { date: new Date().toISOString(), dossier: String(dossierBrut), liens: [], avant: null, apres: null, apports: [], jetes: [], liensTardifs: [], quarantaine: null, issue: null };
    let ctxJournal = null;
    const ecrireJournal = () => {
        if (!executer || !ctxJournal) return;
        try { fs.appendFileSync(ctxJournal, JSON.stringify(rec) + '\n'); } catch (e) { sortie(`⚠️ journal non écrit : ${e.message}`); }
    };
    const fin = (code, issue, message) => {
        rec.issue = issue; rec.message = message; sortie(message); ecrireJournal();
        return { code, issue, message, liens: rec.liens, avant: rec.avant, apres: rec.apres };
    };
    let entree, ctx;
    try {
        ctx = resoudreRacine(opts);
        entree = verifierEntree(dossierBrut, ctx.racine);
        admettre(entree.dossier, entree, ctx);
        if (executer) { fs.appendFileSync(ctx.journal, ''); ctxJournal = ctx.journal; }   // le journal doit être écrivable AVANT de supprimer quoi que ce soit
    } catch (e) {
        const m = e instanceof Refus ? `🔴 REFUS : ${e.message}` : `🔴 ERREUR : ${e.message}`;
        sortie(m);
        return { code: e instanceof Refus ? e.code : 2, issue: e instanceof Refus ? e.issue : 'erreur', message: m, liens: [], avant: null, apres: null };
    }
    rec.dossier = entree.dossier;
    let enQuarantaine = false;
    try {
        const dossier = entree.dossier;
        const lire = typeof opts.lireDossier === 'function' ? opts.lireDossier : fs.readdirSync;   // INJECTION DE BANC (rien en production)
        const git = (entree.worktree || ctx.depots.length) ? trouverGit() : null;
        const lanceurGit = typeof opts.lancerGit === 'function' ? opts.lancerGit : (args) => spawnSync(git, args, { encoding: 'utf8' });   // INJECTION DE BANC
        // 1. contrôles, lecture seule, avant toute action
        const sale = controlesAvantAction(dossier, entree, ctx, lanceurGit);
        if (sale.length && executer && opts.jeterModifications !== true)
            throw new Refus(1, 'refus-sale', `worktree SALE (${sale.length} entrée(s) de git status --porcelain : ${sale.slice(0, 5).join(' | ')}${sale.length > 5 ? ' | …' : ''}) : son travail non commité serait PERDU ; commite-le, ou relance avec --jeter-modifications`);
        if (sale.length && executer) rec.jetes = sale;
        // 2. inventaire et comptes AVANT
        const liens = inventaire(dossier, lire);
        const cibles = new Map();   // clé de la cible réelle -> { cible, avant, apports }
        for (const l of liens) {
            let apports = null;
            if (l.cible !== null) {
                if (cle(l.cible) === cle(dossier) || sousStrict(dossier, l.cible) || sousStrict(l.cible, dossier))
                    throw new Refus(3, 'refus-cible-interne', `lien ${l.rel} : sa cible ${l.cible} est dans le dossier, ou le contient : impossible de vérifier qu'elle reste intacte`);
                if (!cibles.has(cle(l.cible))) {
                    const avant = instantane(l.cible);
                    const nom = estDossierApports(l.cible) || (avant.apportsDedans ? `contient ${path.basename(avant.apportsDedans)}` : null);
                    cibles.set(cle(l.cible), { cible: l.cible, avant, apports: nom });
                }
                apports = cibles.get(cle(l.cible)).apports;
            }
            rec.liens.push({ chemin: l.rel, cible: l.cible || `(cassé) ${l.litteral}`, ...(apports ? { apports: true } : {}) });
        }
        rec.avant = [...cibles.values()].map(c => ({ cible: c.cible, ...c.avant }));
        sortie(`${executer ? 'RETRAIT' : 'PLAN'} ${dossier}`);
        sortie(`type : ${entree.worktree ? 'worktree git lié (dépôt ' + entree.worktree.repo + ')' : 'copie simple (sans .git)'}`);
        if (entree.worktree) {
            sortie(sale.length ? `git status --porcelain : ${sale.length} entrée(s) NON commitée(s) :` : 'git status --porcelain : propre (les fichiers ignorés ne comptent pas)');
            for (const l of sale) sortie(`    ${l}`);
            if (sale.length) sortie(`  🔴 ROUGE : ce worktree est SALE ; ${executer ? '--jeter-modifications est donné, ce travail sera jeté et listé au journal' : 'sans --jeter-modifications, --executer le refusera'}.`);
        }
        sortie(`${liens.length} lien(s) dans l'arbre, ${cibles.size} cible(s) distincte(s)`);
        for (const l of liens) {
            const c = l.cible !== null ? cibles.get(cle(l.cible)) : null;
            sortie(`  lien ${l.rel} -> ${l.cible || '(cassé : ' + l.litteral + ')'}${c ? `  [${decrire(c.avant)}]` : ''}`);
            if (c && c.apports) {
                sortie(`  🔴 ROUGE : la cible de ${l.rel} est un dossier d'apports manuels (« ${c.apports} ») : règle 3 du testeur, cette jonction n'aurait JAMAIS dû exister. Le lien seul sera retiré.`);
                sortie(`  🔴 ROUGE compte AVANT de la cible d'apports ${c.cible} : ${decrire(c.avant)}`);
            }
        }
        if (!executer) { sortie('(plan : rien n\'a été supprimé)'); return { code: 0, issue: 'plan', message: 'plan', liens: rec.liens, avant: rec.avant, apres: null }; }
        const contexte = { dossier, chemin: dossier, cibles: [...cibles.values()].map(c => c.cible) };
        const compare = () => {
            const diffs = [];
            for (const c of cibles.values()) { const e = ecart(c.avant, instantane(c.cible)); if (e) diffs.push(`${c.cible} : ${e}`); }
            return diffs;
        };
        const notePourApports = () => {
            rec.apports = [...cibles.values()].filter(c => c.apports).map(c => ({ cible: c.cible, avant: c.avant, apres: instantane(c.cible) }));
            for (const a of rec.apports) sortie(`  🔴 ROUGE compte APRÈS de la cible d'apports ${a.cible} : ${decrire(a.apres)}`);
        };
        // 3. retrait de CHAQUE lien, seul
        const retires = [];
        try { for (const l of liens) { retirerLien(l.chemin); retires.push(l.rel); } }
        catch (e) {
            const diffs = compare();
            throw new Refus(3, 'refus-retrait-lien', `échec au retrait d'un lien (${e.message}) ; liens déjà retirés : ${retires.length}/${liens.length}${diffs.length ? ' ; CIBLES CHANGÉES : ' + diffs.join(' | ') : ' ; comptes des cibles identiques'} ; le dossier reste en place`);
        }
        // 4. nouvel inventaire : plus AUCUN lien
        const restes = inventaire(dossier, lire);
        if (restes.length) throw new Refus(3, 'refus-lien-reste', `il reste ${restes.length} lien(s) après le retrait : ${restes.map(l => l.rel).join(', ')} ; le dossier reste en place`);
        if (typeof opts.apresRetraitLiens === 'function') opts.apresRetraitLiens(contexte);   // POINT D'INJECTION DE BANC (rien en production)
        // 5. recompte des cibles
        const diffs = compare();
        rec.apres = [...cibles.values()].map(c => ({ cible: c.cible, ...instantane(c.cible) }));
        notePourApports();
        if (diffs.length) throw new Refus(3, 'refus-cible-changee', `CIBLE CHANGÉE pendant le retrait, je m'arrête : ${diffs.join(' | ')} ; le dossier reste en place`);
        if (typeof opts.apresRecompte === 'function') opts.apresRecompte(contexte);          // POINT D'INJECTION DE BANC (rien en production)
        // 6. QUARANTAINE : le dossier est renommé (même parent) vers un nom que personne ne connaît
        let quar = null;
        for (let i = 0; i < 5 && !quar; i++) {
            const cand = path.join(path.dirname(dossier), `${path.basename(dossier)}.retrait-${new Date().toISOString().replace(/\D/g, '')}-${process.pid}-${Math.floor(Math.random() * 1e6).toString(36)}`);
            if (!lstatOuNull(cand)) quar = cand;
        }
        if (!quar) throw new Refus(3, 'refus-renommage', 'aucun nom de quarantaine libre ; le dossier reste en place');
        try { fs.renameSync(dossier, quar); }
        catch (e) { throw new Refus(3, 'refus-renommage', `le renommage en quarantaine a échoué (${e.code || e.message}) : un processus tient peut-être le dossier ; il reste en place, ses liens sont déjà retirés`); }
        enQuarantaine = true; rec.quarantaine = quar; contexte.chemin = quar;
        // 7. inventaire Node PUIS instrument indépendant, sur le chemin RENOMMÉ
        const derniers = inventaire(quar, lire);
        if (derniers.length) throw new Refus(3, 'refus-lien-reapparu', `un lien est apparu avant la suppression : ${derniers.map(l => l.rel).join(', ')}`);
        const ind = reanalyse(quar, opts.instrumentReanalyse);                               // INJECTION DE BANC : opts.instrumentReanalyse
        if (!ind.ok) throw new Refus(3, 'refus-instrument', `l'instrument indépendant (PowerShell, attribut ReparsePoint) n'a pas pu conclure : ${ind.raison} ; je ne sais pas, donc je ne supprime rien`);
        if (ind.points.length) throw new Refus(3, 'refus-reanalyse', `${ind.points.length} point(s) de réanalyse restent dans le dossier (vus par l'attribut, pas par lstat) : ${ind.points.slice(0, 5).join(', ')} ; rien n'est supprimé`);
        if (typeof opts.apresInstrument === 'function') opts.apresInstrument(contexte);      // POINT D'INJECTION DE BANC : le moment le plus tardif
        // 8. suppression en Node, entrée par entrée
        const rapport = { liens: [] };
        supprimerEntree(quar, null, rapport, opts.avantGeste);
        if (lstatOuNull(quar)) throw new Refus(4, 'echec-suppression', `la quarantaine existe encore après la suppression : ${quar}`);
        enQuarantaine = false;
        rec.liensTardifs = rapport.liens;
        // 9. worktree enregistré : prune (métadonnées seulement), puis il ne doit plus être listé
        if (entree.worktree) {
            const pr = lanceurGit(['-C', entree.worktree.repo, 'worktree', 'prune']);
            if (pr.status !== 0) throw new Refus(4, 'echec-git', `git worktree prune a échoué (code ${pr.status}) : ${String(pr.stderr || '').trim().slice(0, 500)} ; le dossier, lui, est déjà supprimé`);
            const li = lanceurGit(['-C', entree.worktree.repo, 'worktree', 'list', '--porcelain']);
            const encore = li.status === 0 && String(li.stdout).replace(/\r/g, '').split('\n').filter(l => l.startsWith('worktree ')).some(l => cle(path.resolve(l.slice(9))) === cle(dossier));
            if (li.status !== 0 || encore) throw new Refus(4, 'echec-prune', `le worktree est encore listé par git après prune (ou la liste est illisible) : ${dossier}`);
        }
        if (typeof opts.apresSuppression === 'function') opts.apresSuppression(contexte);    // POINT D'INJECTION DE BANC (rien en production)
        // 10. recompte final
        const finaux = compare();
        rec.apres = [...cibles.values()].map(c => ({ cible: c.cible, ...instantane(c.cible) }));
        notePourApports();
        if (finaux.length) return fin(5, 'ALERTE-cible-changee-apres', `🚨🚨 ALERTE ROUGE : une cible a changé APRÈS la suppression : ${finaux.join(' | ')}`);
        const tard = rapport.liens.length ? ` ; ⚠️ ${rapport.liens.length} lien(s) apparu(s) pendant la suppression, retiré(s) seuls et jamais parcourus : ${rapport.liens.join(', ')}` : '';
        return fin(0, 'ok', `✅ retiré : ${dossier} (${liens.length} lien(s) retiré(s) seuls, ${cibles.size} cible(s) recomptée(s) ; comptes identiques : fichiers, octets, dossiers, liens, dernière modification${tard})`);
    } catch (e) {
        const q = enQuarantaine && rec.quarantaine ? ` ; la copie reste en quarantaine :${rec.quarantaine}` : '';
        if (e instanceof Refus) return fin(e.code, e.issue, `🔴 REFUS : ${e.message}${q}`);
        return fin(2, 'erreur', `🔴 ERREUR : ${e && e.message || e}${q}`);
    }
}

function main(argv, env) {
    const refuser = (m) => { console.error(`🔴 REFUS : ${m}\nusage : node outils/retirer-worktree.js <dossier> [--executer] [--jeter-modifications]`); return 1; };
    const dossiers = argv.filter(a => !a.startsWith('--')), drap = argv.filter(a => a.startsWith('--'));
    const permis = ['--executer', '--jeter-modifications'];
    const inconnus = drap.filter(d => !permis.includes(d));
    if (inconnus.length || new Set(drap).size !== drap.length) return refuser(`argument non reconnu ou répété : ${(inconnus.length ? inconnus : drap).join(' ')}`);
    if (dossiers.length !== 1) return refuser(`il faut exactement un dossier (donné : ${dossiers.length})`);
    const opts = { executer: drap.includes('--executer'), jeterModifications: drap.includes('--jeter-modifications') };
    if (env.RM_RETRAIT_RACINE_BANC) opts.racine = env.RM_RETRAIT_RACINE_BANC;     // ne vaut que sous le Temp écrit en dur ET avec le marqueur du banc
    if (env.RM_RETRAIT_JOURNAL) opts.journal = env.RM_RETRAIT_JOURNAL;
    return retirer(dossiers[0], opts).code;
}

module.exports = { retirer, trouverGit, inventaire, instantane, verifierEntree, retirerLien, reanalyse, estDossierApports, RACINE_PAR_DEFAUT, MARQUEUR_BANC, JETON_BANC };
if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);
