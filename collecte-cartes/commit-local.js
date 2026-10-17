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

/**
 * 🔴 LE COMMIT SE FIGE AU DÉMARRAGE (relecture 1, §23 : « poussé n'est pas déployé » déplacé en local). HEAD propre prouve ce qui est SUR LE DISQUE,
 * pas le code CHARGÉ en mémoire : après un `git pull` à arbre propre, un commit relu à chaque battement dirait B pendant que le processus applique A.
 * Le résolveur lit HEAD une fois, à sa création (le démarrage) ; ensuite il ne confirme ce commit que si l'arbre suivi est propre ET HEAD inchangé.
 * Au premier écart, la perte est DÉFINITIVE pour la vie du processus (un `require` tardif a pu charger l'autre code). Départ sale : aucun commit, toujours.
 * @returns {() => {commit: string|null, raison: string}}
 */
function fabriquerResolveur({ env = process.env, git = gitReel } = {}) {
    const depart = commitVerifiable({ env, git });
    if (env.RENDER_GIT_COMMIT) return () => depart;
    let perdu = depart.commit ? null : `processus local démarré sur un arbre modifié ou git illisible (${depart.raison})`;
    return () => {
        if (perdu) return { commit: null, raison: `processus local, arbre modifié ou HEAD changé : ${perdu}` };
        const maintenant = commitVerifiable({ env, git });
        if (maintenant.commit !== depart.commit)
            perdu = maintenant.commit ? `HEAD a changé depuis le démarrage (${depart.commit} → ${maintenant.commit}) : le code chargé n'est plus celui du disque, redémarrer`
                : `l'arbre suivi a été modifié depuis le démarrage (${maintenant.raison}) : redémarrer`;
        return perdu ? { commit: null, raison: `processus local, arbre modifié ou HEAD changé : ${perdu}` } : depart;
    };
}

module.exports = { commitVerifiable, fabriquerResolveur };
