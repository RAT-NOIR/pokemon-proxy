// ============================================================
// LE COMMIT D'UN PROCESSUS LOCAL — vérifiable, ou absent (2026-10-17, worker Render suspendu : toute la collecte tourne sur le PC)
// ============================================================
// 🔑 La balise (balise-worker.js) disait « local » pour tout processus hors Render, et la garde du commit (remettre-en-file.js, etatDuWorker)
// BLOQUE sur « local » : un arbre de travail n'est pas un commit. Sans worker Render, la garde bloquerait donc pour toujours.
// Ce module rend la seule chose qu'un processus local PEUT prouver : `git rev-parse HEAD` quand l'arbre SUIVI est propre (aucune modification
// de fichier suivi : `git status --porcelain --untracked-files=no` vide). Alors HEAD est exactement le code qui tourne.
// Arbre sale, git en panne, sortie illisible : AUCUN commit (le champ est absent de la balise) — la garde dit « n'écrit pas son commit »
// et BLOQUE, comme aujourd'hui. « Je ne sais pas » n'est jamais un commit (§51 : une garde s'écrit par ce qu'elle autorise).
// Sur Render, RENDER_GIT_COMMIT fait foi (un déploiement est un commit propre). Une variable VERSION posée à la main ne prouve rien :
// elle n'est plus lue ici, seul git atteste.
const path = require('path');
const { execFileSync } = require('child_process');
const { gitExe } = require('./tables-du-commit');

const RACINE = path.join(__dirname, '..');
const SHA = /^[0-9a-f]{40}$/;

const gitReel = args => execFileSync(gitExe(), args, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });

/** @returns {{commit: string|null, raison: string}} le commit sur 12 caractères (comme VERSION), ou null avec la raison. */
function commitVerifiable({ env = process.env, git = gitReel } = {}) {
    if (env.RENDER_GIT_COMMIT) return { commit: String(env.RENDER_GIT_COMMIT).slice(0, 12), raison: 'déploiement Render' };
    try {
        const sale = String(git(['status', '--porcelain', '--untracked-files=no'])).trim();
        if (sale) return { commit: null, raison: `arbre suivi sale (${sale.split('\n').length} fichier(s) modifié(s)) : le code qui tourne n'est pas un commit` };
        const head = String(git(['rev-parse', 'HEAD'])).trim();
        if (!SHA.test(head)) return { commit: null, raison: `git rev-parse HEAD illisible : « ${head.slice(0, 60)} »` };
        return { commit: head.slice(0, 12), raison: 'arbre suivi propre : HEAD' };
    } catch (e) {
        return { commit: null, raison: `git n'a pas pu conclure : ${e.message}` };
    }
}

module.exports = { commitVerifiable };
