// ============================================================
// LES SOURCES D'IMAGES DE LA VERSION POUSSÉE — ce que le worker Render connaît vraiment
// ============================================================
// Le worker trouve la source d'un set dans `sources-sets.js` DE SON COMMIT. Une source ajoutée localement et pas encore
// poussée n'existe pas pour lui : un set enfilé sur cette source finit en `refuse-source`, hors de la file pour toujours
// (§23). Jusqu'au 2026-09-15 la règle était « garder sources-sets.js local identique au commit déployé » — tenable pour
// une session, pas pour trois jours de sources trouvées à la main. Ici on lit la version de `origin/main` (git show) :
// c'est une borne PRUDENTE, un push fait ailleurs sans fetch ne fait que retarder l'enfilage, jamais l'avancer.
// ⚠️ Poussé n'est pas redéployé : le testeur redéploie après chaque push (règle de fonctionnement du 2026-09-15).
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

function git() {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    const app = fs.existsSync(base) ? fs.readdirSync(base).filter(d => d.startsWith('app-')).sort().pop() : null;
    return app ? path.join(base, app, 'resources', 'app', 'git', 'cmd', 'git.exe') : 'git';
}

/** @returns {{ sourceDe: (code:string)=>object|null, ref: string, commit: string } | { erreur: string }} */
function sourcesDeployees(ref = 'origin/main') {
    try {
        const racine = path.join(__dirname, '..');
        const lire = f => execFileSync(git(), ['show', `${ref}:collecte-cartes/${f}`], { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const commit = execFileSync(git(), ['rev-parse', '--short', ref], { cwd: racine, encoding: 'utf8' }).trim();
        const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-deployees-'));
        fs.writeFileSync(path.join(dossier, 'sources-sets.js'), lire('sources-sets.js'));
        fs.writeFileSync(path.join(dossier, 'sources-sets-auto.json'), lire('sources-sets-auto.json'));
        const { sourceDe } = require(path.join(dossier, 'sources-sets.js'));
        return { sourceDe, ref, commit };
    } catch (e) { return { erreur: `sources de ${ref} illisibles : ${e.message.split('\n')[0]}` }; }
}

/**
 * Le worker de la version poussée sait-il AIGUILLER la file sur `source` ? Ajouté le 2026-09-19 avec les images
 * Bulbapedia : une entrée `source: 'bulbapedia'` prise par un worker qui l'ignore serait collectée comme de
 * l'artofpkm, refusée faute de source, et sortie de la file POUR TOUJOURS (§23). Même famille que la garde
 * ci-dessus : ce qui n'est pas dans le commit du worker n'existe pas pour lui.
 * @returns {{ sait: boolean, commit?: string, erreur?: string }}
 */
function aiguillageDeploye(ref = 'origin/main') {
    try {
        const racine = path.join(__dirname, '..');
        const src = execFileSync(git(), ['show', `${ref}:collecteur-images.js`], { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const commit = execFileSync(git(), ['rev-parse', '--short', ref], { cwd: racine, encoding: 'utf8' }).trim();
        return { sait: /sourceDuSet === 'bulbapedia'/.test(src), commit };
    } catch (e) { return { sait: false, erreur: `collecteur-images.js de ${ref} illisible : ${e.message.split('\n')[0]}` }; }
}

/**
 * La LIGNE DE TABLE du set existe-t-elle dans la version poussée ? Ajoutée le 2026-09-19 avec les 10 « Additionals »
 * occidentales : la garde d'à côté vérifiait la SOURCE d'images et l'AIGUILLAGE, jamais la ligne elle-même. Un set
 * occidental n'a pas besoin de source (son visuel vient de la page de la carte), donc il passait la garde — et le
 * worker, qui ne connaît que la table de SON commit, recevait un code inconnu. C'est le §21 bis, encore : une garde
 * corrigée d'un côté, laissée de l'autre.
 * @returns {{ connait: (code:string)=>boolean, codes: Set<string>, commit: string } | { erreur: string }}
 */
function lignesDeployees(ref = 'origin/main') {
    try {
        const racine = path.join(__dirname, '..');
        const lire = f => execFileSync(git(), ['show', `${ref}:collecte-cartes/${f}`], { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const commit = execFileSync(git(), ['rev-parse', '--short', ref], { cwd: racine, encoding: 'utf8' }).trim();
        // On ne CHARGE pas la table déployée (elle lit la base et d'autres modules) : on lit les CODES, qui sont le
        // seul fait dont on a besoin ici. `code: 'xPRE'` dans le .js, `"code": "xPRE"` dans le .json.
        const codes = new Set();
        for (const src of [lire('table-sets.js'), lire('table-sets-auto.json')])
            for (const m of src.matchAll(/["']?code["']?\s*:\s*['"]([^'"]+)['"]/g)) codes.add(m[1]);
        return { connait: code => codes.has(code), codes, commit };
    } catch (e) { return { erreur: `table de ${ref} illisible : ${e.message.split('\n')[0]}` }; }
}

module.exports = { sourcesDeployees, aiguillageDeploye, lignesDeployees };
