'use strict';
// UN SEUL outil pour retirer un worktree ou une copie du poste, SANS JAMAIS toucher aux cibles de ses jonctions (décision du testeur, 2026-10-13).
//
// POURQUOI : le 2026-10-12 à 21:54:11 UTC, `git worktree remove --force` sur une copie à jonctions a TRAVERSÉ les jonctions et vidé quatre dossiers
// du dépôt principal, dont `Logo FR` et `apport-manuel` (fichiers du testeur que git ne suit pas).
//
//   node outils/retirer-worktree.js <dossier>              le PLAN (lecture seule) : liens, cibles, comptes. Ne supprime rien.
//   node outils/retirer-worktree.js <dossier> --executer   la procédure, avec arrêt à la première anomalie (code de sortie non nul).
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : le dossier doit être réel (pas un lien, chemin sans lien), exister, être un dossier, se trouver
// STRICTEMENT sous la racine permise (casse ignorée, chemins résolus) et ne pas être un dépôt principal (dossier .git réel). Tout le reste est refusé.
// Aucune dépendance : bibliothèque standard seulement. Aucun secret n'est lu ni affiché.
//
// CODES DE SORTIE : 0 fait (ou plan) · 1 refus d'entrée · 2 erreur · 3 refus en cours de route (cible changée, lien resté ou réapparu) · 4 échec de
// la suppression · 5 ALERTE : une cible a changé APRÈS la suppression.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');

const RACINE_PAR_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\api';
const JOURNAL_PAR_DEFAUT = path.join(RACINE_PAR_DEFAUT, 'journal-retraits.jsonl');

class Refus extends Error { constructor(code, issue, message) { super(message); this.code = code; this.issue = issue; } }

const cle = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p));
// « STRICTEMENT sous » : ni égal, ni parent, ni voisin. Casse ignorée sous Windows.
function sousStrict(parent, enfant) {
    const r = path.relative(cle(path.resolve(parent)), cle(path.resolve(enfant)));
    return r !== '' && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r);
}
const reel = (p) => fs.realpathSync.native(p);
const lstatOuNull = (p) => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; } };

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

// La racine permise : la constante, ou (BANCS SEULEMENT) une racine STRICTEMENT sous le dossier temporaire du système, avec un journal à elle,
// lui aussi sous le dossier temporaire. Un journal de banc sans racine de banc, ou l'inverse, est refusé : un banc n'écrit jamais au journal réel.
function resoudreRacine(opts) {
    const banc = opts.racine !== undefined && opts.racine !== null && opts.racine !== '';
    if (!banc) {
        if (opts.journal) throw new Refus(1, 'refus-entree', 'un journal de banc sans racine de banc est refusé');
        let r; try { r = reel(RACINE_PAR_DEFAUT); } catch { throw new Refus(1, 'refus-entree', 'la racine permise est absente de ce poste'); }
        return { racine: r, journal: JOURNAL_PAR_DEFAUT, banc: false };
    }
    if (!opts.journal) throw new Refus(1, 'refus-entree', 'une racine de banc exige un journal de banc');
    const tmp = reel(os.tmpdir());
    let r; try { r = reel(opts.racine); } catch { throw new Refus(1, 'refus-entree', 'racine de banc absente'); }
    if (!sousStrict(tmp, r)) throw new Refus(1, 'refus-entree', 'racine de banc refusée : elle doit être STRICTEMENT sous le dossier temporaire du système');
    let jd; try { jd = reel(path.dirname(path.resolve(opts.journal))); } catch { throw new Refus(1, 'refus-entree', 'dossier du journal de banc absent'); }
    const j = path.join(jd, path.basename(opts.journal));
    if (!sousStrict(tmp, j)) throw new Refus(1, 'refus-entree', 'journal de banc refusé : il doit être STRICTEMENT sous le dossier temporaire du système');
    return { racine: r, journal: j, banc: true };
}

// Refus d'entrée. Retourne { dossier (réel), worktree: null | { repo } }.
function verifierEntree(brut, racine) {
    if (typeof brut !== 'string' || !brut.trim()) throw new Refus(1, 'refus-entree', 'aucun dossier donné');
    const abs = path.resolve(brut);
    const st = lstatOuNull(abs);
    if (!st) throw new Refus(1, 'refus-entree', `dossier absent : ${abs}`);
    if (st.isSymbolicLink()) throw new Refus(1, 'refus-entree', `le dossier est lui-même un lien (jonction ou lien symbolique) : ${abs}`);
    if (!st.isDirectory()) throw new Refus(1, 'refus-entree', `ce n'est pas un dossier : ${abs}`);
    const r = reel(abs);
    if (cle(r) !== cle(abs)) throw new Refus(1, 'refus-entree', `le chemin traverse un lien ou un nom court (réel : ${r}) : donne le chemin réel`);
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

// Inventaire des liens de l'arbre, par lstat, SANS JAMAIS descendre dans un lien.
function inventaire(dossier) {
    const liens = [], pile = [dossier];
    while (pile.length) {
        const d = pile.pop();
        for (const e of fs.readdirSync(d)) {
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

// Comptes d'une cible : fichiers, octets, dossiers, liens (comptés, jamais suivis).
function instantane(cible) {
    if (cible === null) return { absente: true };
    const s = lstatOuNull(cible);
    if (!s) return { absente: true };
    const c = { fichiers: 0, octets: 0, dossiers: 0, liens: 0 };
    if (!s.isDirectory()) { c.fichiers = 1; c.octets = s.size; return c; }
    const pile = [cible];
    while (pile.length) {
        const d = pile.pop();
        for (const e of fs.readdirSync(d)) {
            const p = path.join(d, e), t = fs.lstatSync(p);
            if (t.isSymbolicLink()) c.liens++;
            else if (t.isDirectory()) { c.dossiers++; pile.push(p); }
            else { c.fichiers++; c.octets += t.size; }
        }
    }
    return c;
}
const ecart = (a, b) => {
    if (a.absente || b.absente) return a.absente && b.absente ? null : (a.absente ? 'absente puis présente' : 'présente puis absente');
    const parts = [];
    for (const k of ['fichiers', 'octets', 'dossiers', 'liens']) if (a[k] !== b[k]) parts.push(`${k} ${a[k]} puis ${b[k]} (${b[k] - a[k] > 0 ? '+' : ''}${b[k] - a[k]})`);
    return parts.length ? parts.join(', ') : null;
};

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
    const rec = { date: new Date().toISOString(), dossier: String(dossierBrut), liens: [], avant: null, apres: null, issue: null };
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
        const { racine, journal } = resoudreRacine(opts);
        entree = verifierEntree(dossierBrut, racine);
        if (executer) { fs.appendFileSync(journal, ''); ctxJournal = journal; }   // le journal doit être écrivable AVANT de supprimer quoi que ce soit
    } catch (e) {
        const m = e instanceof Refus ? `🔴 REFUS : ${e.message}` : `🔴 ERREUR : ${e.message}`;
        sortie(m);
        return { code: e instanceof Refus ? e.code : 2, issue: e instanceof Refus ? e.issue : 'erreur', message: m, liens: [], avant: null, apres: null };
    }
    rec.dossier = entree.dossier;
    try {
        const dossier = entree.dossier;
        // 2. inventaire et comptes AVANT
        const liens = inventaire(dossier);
        const cibles = new Map();   // clé de la cible réelle -> { cible, avant }
        for (const l of liens) {
            if (l.cible !== null) {
                if (cle(l.cible) === cle(dossier) || sousStrict(dossier, l.cible) || sousStrict(l.cible, dossier))
                    throw new Refus(3, 'refus-cible-interne', `lien ${l.rel} : sa cible ${l.cible} est dans le dossier, ou le contient : impossible de vérifier qu'elle reste intacte`);
                if (!cibles.has(cle(l.cible))) cibles.set(cle(l.cible), { cible: l.cible, avant: instantane(l.cible) });
            }
            rec.liens.push({ chemin: l.rel, cible: l.cible || `(cassé) ${l.litteral}` });
        }
        rec.avant = [...cibles.values()].map(c => ({ cible: c.cible, ...c.avant }));
        sortie(`${executer ? 'RETRAIT' : 'PLAN'} ${dossier}`);
        sortie(`type : ${entree.worktree ? 'worktree git lié (dépôt ' + entree.worktree.repo + ')' : 'copie simple (sans .git)'}`);
        sortie(`${liens.length} lien(s) dans l'arbre, ${cibles.size} cible(s) distincte(s)`);
        for (const l of liens) {
            const c = l.cible !== null ? cibles.get(cle(l.cible)).avant : null;
            sortie(`  lien ${l.rel} -> ${l.cible || '(cassé : ' + l.litteral + ')'}${c ? `  [${c.absente ? 'cible absente' : `${c.fichiers} fichiers, ${c.octets} octets, ${c.dossiers} dossiers, ${c.liens} liens`}]` : ''}`);
        }
        if (!executer) { sortie('(plan : rien n\'a été supprimé)'); return { code: 0, issue: 'plan', message: 'plan', liens: rec.liens, avant: rec.avant, apres: null }; }
        const git = entree.worktree ? trouverGit() : null;
        const contexte = { dossier, cibles: [...cibles.values()].map(c => c.cible) };
        const compare = () => {
            const diffs = [];
            for (const c of cibles.values()) { const e = ecart(c.avant, instantane(c.cible)); if (e) diffs.push(`${c.cible} : ${e}`); }
            return diffs;
        };
        // 3. retrait de CHAQUE lien, seul
        const retires = [];
        try { for (const l of liens) { retirerLien(l.chemin); retires.push(l.rel); } }
        catch (e) {
            const diffs = compare();
            throw new Refus(3, 'refus-retrait-lien', `échec au retrait d'un lien (${e.message}) ; liens déjà retirés : ${retires.length}/${liens.length}${diffs.length ? ' ; CIBLES CHANGÉES : ' + diffs.join(' | ') : ' ; cibles intactes'} ; le dossier reste en place`);
        }
        // 4. nouvel inventaire : plus AUCUN lien
        const restes = inventaire(dossier);
        if (restes.length) throw new Refus(3, 'refus-lien-reste', `il reste ${restes.length} lien(s) après le retrait : ${restes.map(l => l.rel).join(', ')} ; le dossier reste en place`);
        if (typeof opts.apresRetraitLiens === 'function') opts.apresRetraitLiens(contexte);   // POINT D'INJECTION DE BANC (rien en production)
        // 5. recompte des cibles
        const diffs = compare();
        rec.apres = [...cibles.values()].map(c => ({ cible: c.cible, ...instantane(c.cible) }));
        if (diffs.length) throw new Refus(3, 'refus-cible-changee', `CIBLE CHANGÉE pendant le retrait, je m'arrête : ${diffs.join(' | ')} ; le dossier reste en place`);
        if (typeof opts.apresRecompte === 'function') opts.apresRecompte(contexte);          // POINT D'INJECTION DE BANC (rien en production)
        // 6. juste avant de supprimer : dernier inventaire, zéro lien
        const derniers = inventaire(dossier);
        if (derniers.length) throw new Refus(3, 'refus-lien-reapparu', `un lien est apparu avant la suppression : ${derniers.map(l => l.rel).join(', ')} ; le dossier reste en place`);
        if (entree.worktree) {
            const r = spawnSync(git, ['-C', entree.worktree.repo, 'worktree', 'remove', '--force', dossier], { encoding: 'utf8' });
            if (r.status !== 0) throw new Refus(4, 'echec-git', `git worktree remove a échoué (code ${r.status}) : ${String(r.stderr || '').trim().slice(0, 500)}`);
        } else {
            fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        }
        if (lstatOuNull(dossier)) throw new Refus(4, 'echec-suppression', `le dossier existe encore après la suppression : ${dossier}`);
        // 7. recompte final
        const finaux = compare();
        rec.apres = [...cibles.values()].map(c => ({ cible: c.cible, ...instantane(c.cible) }));
        if (finaux.length) return fin(5, 'ALERTE-cible-changee-apres', `🚨🚨 ALERTE ROUGE : une cible a changé APRÈS la suppression : ${finaux.join(' | ')}`);
        return fin(0, 'ok', `✅ retiré : ${dossier} (${liens.length} lien(s) retiré(s) seuls, ${cibles.size} cible(s) recomptée(s), écart nul)`);
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
    if (env.RM_RETRAIT_RACINE_BANC) opts.racine = env.RM_RETRAIT_RACINE_BANC;
    if (env.RM_RETRAIT_JOURNAL) opts.journal = env.RM_RETRAIT_JOURNAL;
    return retirer(dossiers[0], opts).code;
}

module.exports = { retirer, trouverGit, inventaire, instantane, verifierEntree, retirerLien, RACINE_PAR_DEFAUT };
if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);
