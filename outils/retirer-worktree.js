'use strict';
// UN SEUL outil pour retirer un worktree ou une copie du poste, SANS JAMAIS toucher aux cibles de ses jonctions (décision du testeur, 2026-10-13).
//
// POURQUOI : le 2026-10-12 à 21:54:11 UTC, `git worktree remove --force` sur une copie à jonctions a TRAVERSÉ les jonctions et vidé quatre dossiers
// du dépôt principal, dont `Logo FR` et `apport-manuel` (fichiers du testeur que git ne suit pas).
//
//   node outils/retirer-worktree.js <dossier>              le PLAN (lecture seule) : liens, cibles, comptes. Ne supprime rien.
//   node outils/retirer-worktree.js <dossier> --executer   la procédure, avec arrêt à la première anomalie (code de sortie non nul).
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE, ET RIEN D'AUTRE :
//   (a) un worktree ENREGISTRÉ (`git worktree list --porcelain` de l'un des dépôts connus) situé STRICTEMENT sous `…\rat-market-travail\api\` ;
//   (b) un enfant DIRECT de `…\rat-market-travail\api\_mutants\`.
// Jamais un dépôt principal, jamais `api\` lui-même, jamais `node22`, jamais un sous-dossier d'un worktree, jamais un lien.
// Refus dur, quel que soit l'environnement : tout chemin qui contient un dossier d'apports (Logo FR, apport-manuel, Desktop\LOGO, Logo JP, Logo ZH,
// GABARIT-pokecardex). Les variables de banc (RM_RETRAIT_RACINE_BANC, RM_RETRAIT_JOURNAL) ne valent que si la racine qu'elles nomment est sous le
// dossier temporaire ET porte le marqueur que le banc écrit lui-même ; sinon : refus.
// Aucune dépendance : bibliothèque standard seulement. Aucun secret n'est lu ni affiché.
//
// CODES DE SORTIE : 0 fait (ou plan) · 1 refus d'entrée · 2 erreur · 3 refus en cours de route (cible changée, lien resté ou réapparu, point de
// réanalyse resté, instrument indépendant muet) · 4 échec de la suppression · 5 ALERTE : une cible a changé APRÈS la suppression.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');

const RACINE_PAR_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\api';
const JOURNAL_PAR_DEFAUT = path.join(RACINE_PAR_DEFAUT, 'journal-retraits.jsonl');
const DEPOTS_PAR_DEFAUT = ['C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2', 'C:\\Users\\Yung\\Desktop\\pokemon-proxy'];
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

// La racine permise : la constante, ou (BANCS SEULEMENT) une racine STRICTEMENT sous le dossier temporaire, qui porte le marqueur du banc, avec un
// journal à elle sous le dossier temporaire. Un journal de banc sans racine de banc, ou l'inverse, est refusé.
function resoudreRacine(opts) {
    const banc = opts.racine !== undefined && opts.racine !== null && opts.racine !== '';
    if (!banc) {
        if (opts.journal) throw new Refus(1, 'refus-entree', 'un journal de banc sans racine de banc est refusé');
        let r; try { r = reel(RACINE_PAR_DEFAUT); } catch { throw new Refus(1, 'refus-entree', 'la racine permise est absente de ce poste'); }
        return { racine: r, journal: JOURNAL_PAR_DEFAUT, banc: false, depots: DEPOTS_PAR_DEFAUT };
    }
    if (!opts.journal) throw new Refus(1, 'refus-entree', 'une racine de banc exige un journal de banc');
    const tmp = reel(os.tmpdir());
    let r; try { r = reel(opts.racine); } catch { throw new Refus(1, 'refus-entree', 'racine de banc absente'); }
    if (!sousStrict(tmp, r)) throw new Refus(1, 'refus-entree', 'racine de banc refusée : elle doit être STRICTEMENT sous le dossier temporaire du système');
    let contenu = null; try { contenu = fs.readFileSync(path.join(r, MARQUEUR_BANC), 'utf8').trim(); } catch { /* absent */ }
    if (contenu !== JETON_BANC) throw new Refus(1, 'refus-entree', `racine de banc refusée : le marqueur ${MARQUEUR_BANC} que le banc écrit lui-même est absent ou faux`);
    let jd; try { jd = reel(path.dirname(path.resolve(opts.journal))); } catch { throw new Refus(1, 'refus-entree', 'dossier du journal de banc absent'); }
    const j = path.join(jd, path.basename(opts.journal));
    if (!sousStrict(tmp, j)) throw new Refus(1, 'refus-entree', 'journal de banc refusé : il doit être STRICTEMENT sous le dossier temporaire du système');
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

// Comptes d'une cible : fichiers, octets, dossiers, liens (comptés, jamais suivis) et la DERNIÈRE MODIFICATION (mtime maximal de tout ce qu'elle contient).
function instantane(cible) {
    if (cible === null) return { absente: true };
    const s = lstatOuNull(cible);
    if (!s) return { absente: true };
    const c = { fichiers: 0, octets: 0, dossiers: 0, liens: 0, modif: s.mtimeMs };
    if (!s.isDirectory()) { c.fichiers = 1; c.octets = s.size; return c; }
    const pile = [cible];
    while (pile.length) {
        const d = pile.pop();
        for (const e of fs.readdirSync(d)) {
            const p = path.join(d, e), t = fs.lstatSync(p);
            if (t.mtimeMs > c.modif) c.modif = t.mtimeMs;
            if (t.isSymbolicLink()) c.liens++;
            else if (t.isDirectory()) { c.dossiers++; pile.push(p); }
            else { c.fichiers++; c.octets += t.size; }
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

function retirer(dossierBrut, opts = {}) {
    const sortie = typeof opts.sortie === 'function' ? opts.sortie : (s) => console.log(s);
    const executer = opts.executer === true;
    const rec = { date: new Date().toISOString(), dossier: String(dossierBrut), liens: [], avant: null, apres: null, apports: [], issue: null };
    let ctxJournal = null;
    const ecrireJournal = () => {
        if (!executer || !ctxJournal) return;
        try { fs.appendFileSync(ctxJournal, JSON.stringify(rec) + '\n'); } catch (e) { sortie(`⚠️ journal non écrit : ${e.message}`); }
    };
    const fin = (code, issue, message) => {
        rec.issue = issue; rec.message = message; sortie(message); ecrireJournal();
        return { code, issue, message, liens: rec.liens, avant: rec.avant, apres: rec.apres };
    };
    let entree;
    try {
        const ctx = resoudreRacine(opts);
        entree = verifierEntree(dossierBrut, ctx.racine);
        admettre(entree.dossier, entree, ctx);
        if (executer) { fs.appendFileSync(ctx.journal, ''); ctxJournal = ctx.journal; }   // le journal doit être écrivable AVANT de supprimer quoi que ce soit
    } catch (e) {
        const m = e instanceof Refus ? `🔴 REFUS : ${e.message}` : `🔴 ERREUR : ${e.message}`;
        sortie(m);
        return { code: e instanceof Refus ? e.code : 2, issue: e instanceof Refus ? e.issue : 'erreur', message: m, liens: [], avant: null, apres: null };
    }
    rec.dossier = entree.dossier;
    try {
        const dossier = entree.dossier;
        const lire = typeof opts.lireDossier === 'function' ? opts.lireDossier : fs.readdirSync;   // INJECTION DE BANC (rien en production)
        // 2. inventaire et comptes AVANT
        const liens = inventaire(dossier, lire);
        const cibles = new Map();   // clé de la cible réelle -> { cible, avant, apports }
        for (const l of liens) {
            let apports = null;
            if (l.cible !== null) {
                if (cle(l.cible) === cle(dossier) || sousStrict(dossier, l.cible) || sousStrict(l.cible, dossier))
                    throw new Refus(3, 'refus-cible-interne', `lien ${l.rel} : sa cible ${l.cible} est dans le dossier, ou le contient : impossible de vérifier qu'elle reste intacte`);
                apports = estDossierApports(l.cible);
                if (!cibles.has(cle(l.cible))) cibles.set(cle(l.cible), { cible: l.cible, avant: instantane(l.cible), apports });
            }
            rec.liens.push({ chemin: l.rel, cible: l.cible || `(cassé) ${l.litteral}`, ...(apports ? { apports: true } : {}) });
        }
        rec.avant = [...cibles.values()].map(c => ({ cible: c.cible, ...c.avant }));
        sortie(`${executer ? 'RETRAIT' : 'PLAN'} ${dossier}`);
        sortie(`type : ${entree.worktree ? 'worktree git lié (dépôt ' + entree.worktree.repo + ')' : 'copie simple (sans .git)'}`);
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
        const git = entree.worktree ? trouverGit() : null;
        const contexte = { dossier, cibles: [...cibles.values()].map(c => c.cible) };
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
        // 6. juste avant de supprimer : dernier inventaire Node (zéro lien), PUIS un instrument INDÉPENDANT de Node (attribut de réanalyse)
        const derniers = inventaire(dossier, lire);
        if (derniers.length) throw new Refus(3, 'refus-lien-reapparu', `un lien est apparu avant la suppression : ${derniers.map(l => l.rel).join(', ')} ; le dossier reste en place`);
        const ind = reanalyse(dossier, opts.instrumentReanalyse);                           // INJECTION DE BANC : opts.instrumentReanalyse
        if (!ind.ok) throw new Refus(3, 'refus-instrument', `l'instrument indépendant (PowerShell, attribut ReparsePoint) n'a pas pu conclure : ${ind.raison} ; je ne sais pas, donc je ne supprime rien ; le dossier reste en place`);
        if (ind.points.length) throw new Refus(3, 'refus-reanalyse', `${ind.points.length} point(s) de réanalyse restent dans le dossier (vus par l'attribut, pas par lstat) : ${ind.points.slice(0, 5).join(', ')} ; rien n'est supprimé`);
        if (entree.worktree) {
            const lanceurGit = typeof opts.lancerGit === 'function' ? opts.lancerGit : (args) => spawnSync(git, args, { encoding: 'utf8' });   // INJECTION DE BANC
            const r = lanceurGit(['-C', entree.worktree.repo, 'worktree', 'remove', '--force', dossier]);
            if (r.status !== 0) throw new Refus(4, 'echec-git', `git worktree remove a échoué (code ${r.status}) : ${String(r.stderr || '').trim().slice(0, 500)}`);
        } else {
            fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        }
        if (lstatOuNull(dossier)) throw new Refus(4, 'echec-suppression', `le dossier existe encore après la suppression : ${dossier}`);
        if (typeof opts.apresSuppression === 'function') opts.apresSuppression(contexte);    // POINT D'INJECTION DE BANC (rien en production)
        // 7. recompte final
        const finaux = compare();
        rec.apres = [...cibles.values()].map(c => ({ cible: c.cible, ...instantane(c.cible) }));
        notePourApports();
        if (finaux.length) return fin(5, 'ALERTE-cible-changee-apres', `🚨🚨 ALERTE ROUGE : une cible a changé APRÈS la suppression : ${finaux.join(' | ')}`);
        return fin(0, 'ok', `✅ retiré : ${dossier} (${liens.length} lien(s) retiré(s) seuls, ${cibles.size} cible(s) recomptée(s) ; comptes identiques : fichiers, octets, dossiers, liens, dernière modification)`);
    } catch (e) {
        if (e instanceof Refus) return fin(e.code, e.issue, `🔴 REFUS : ${e.message}`);
        return fin(2, 'erreur', `🔴 ERREUR : ${e && e.message || e}`);
    }
}

function main(argv, env) {
    const refuser = (m) => { console.error(`🔴 REFUS : ${m}\nusage : node outils/retirer-worktree.js <dossier> [--executer]`); return 1; };
    const dossiers = argv.filter(a => !a.startsWith('--')), drap = argv.filter(a => a.startsWith('--'));
    if (drap.some(d => d !== '--executer') || drap.length > 1) return refuser(`argument non reconnu : ${drap.filter(d => d !== '--executer').join(' ') || drap.join(' ')}`);
    if (dossiers.length !== 1) return refuser(`il faut exactement un dossier (donné : ${dossiers.length})`);
    const opts = { executer: drap.length === 1 };
    if (env.RM_RETRAIT_RACINE_BANC) opts.racine = env.RM_RETRAIT_RACINE_BANC;     // ne vaut que sous le dossier temporaire ET avec le marqueur du banc
    if (env.RM_RETRAIT_JOURNAL) opts.journal = env.RM_RETRAIT_JOURNAL;
    return retirer(dossiers[0], opts).code;
}

module.exports = { retirer, trouverGit, inventaire, instantane, verifierEntree, retirerLien, reanalyse, estDossierApports, RACINE_PAR_DEFAUT, MARQUEUR_BANC, JETON_BANC };
if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);
