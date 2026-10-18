'use strict';
// COTES-VISUELS — l'OUTIL qui refait la copie EMBARQUÉE des règles du site (rat-market-site/lib), et la vérifie.
//   node v2/chargeur/copier-regle-site.js              refait v2/chargeur/regle-site/ depuis le site AU COMMIT NOMMÉ (`git show`, Node 24+ : stripTypeScriptTypes)
//   node v2/chargeur/copier-regle-site.js --verifier   code 0 : la copie est conforme au commit nommé ET le main du site ne l'a pas changé ; 1 : DÉRIVE (fichiers nommés) ; 2 : site absent (non vérifié, dit)
// Pourquoi une copie : le dossier du site N'EXISTE PAS sur Render, et le serveur y tourne en Node 22.x, qui n'exécute pas le TypeScript. On embarque donc des `.mjs` PRODUITS par
// retrait des types (la source du site n'est jamais modifiée), avec l'empreinte sha256 de chaque fichier source. Le banc test-chargeur-regle-site.js échoue quand le site diffère
// de son empreinte (jamais de dérive silencieuse) et dit « site absent » quand il n'est pas là. Une seule copie de choisirVisuel : celle de exporter-donnees-logos-site.js.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { execFileSync } = require('child_process');

const DOSSIER = path.join(__dirname, 'regle-site');
const SITE_LIB = path.join(__dirname, '..', '..', '..', 'rat-market-site', 'lib');
const REPO_SITE = path.dirname(SITE_LIB);
// LE COMMIT NOMMÉ du site dont la copie est tirée (RESYNC-REGLE-SITE : le dernier commit du site qui touche l'une des huit sources, cardmarket.ts ; avant lui 35ed580, lot 2-A, le filtre par deck). Les sources se lisent par `git show <commit>:lib/<fichier>` (octets du commit, jamais ceux de l'arbre de travail, que les fins de ligne du poste changent).
// Le changer est un geste volontaire : on relance l'outil, on relit le diff des .mjs, et empreintes.json porte le commit (forme complète).
const COMMIT = '4d1344d';
// la fermeture TRANSITIVE des imports des modules dont la décision a besoin (fichesDuDocument/setParImpression/impressionDuSet, produitsDeLaFiche/cardmarketUrl, visuelAdmisPourLaRegion, normaliserNumero)
const TS = Object.freeze(['imageDeLImpression.ts', 'impressionDuSet.ts', 'impressionsDuSet.ts', 'cardmarket.ts', 'langueDuVisuel.ts', 'expressionsSures.ts']);
const JSONS = Object.freeze(['visuels-japonais-sur-sets-intl.json', 'visuels-anglais-regardes.json']);
const SOURCES = Object.freeze([...TS, ...JSONS]);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sortie = nom => nom.replace(/\.ts$/, '.mjs');

// GARDE DE FERMETURE, écrite par ce qu'elle AUTORISE : une importation relative n'est admise que si elle vise, dans le même dossier, un fichier de la liste des sources
// (avec son extension .ts/.json, ou sans extension = un .ts). Tout le reste lève en nommant l'importeur et le fichier visé. Les importations non relatives (node:, paquets) sont hors du champ.
const IMPORT_RELATIF = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']*)["']/g;
function fermeture(nom, code, sources = SOURCES) {
    for (const m of code.matchAll(IMPORT_RELATIF)) {
        const spec = m[1];
        const visee = spec.startsWith('./') ? spec.slice(2) : null;
        // sans extension : le réécrivain ne touche que « .ts », la copie .mjs ne se résoudrait pas — refusé même si le fichier est dans la liste
        const fichier = visee === null ? null : (/\.(ts|json)$/.test(visee) ? visee : visee + '.ts');
        const admis = visee !== null && /\.(ts|json)$/.test(visee) && !visee.includes('/') && sources.includes(visee);
        if (!admis)
            throw new Error(`fermeture : ${nom} importe « ${spec} » (${fichier === null ? 'hors du dossier' : fichier}), absent de la liste des sources ou sans extension — l'ajouter à TS/JSONS dans copier-regle-site.js, ou la copie embarquée serait cassée`);
    }
}

/** git, résolu à chaque fois depuis GitHub Desktop (jamais un chemin de version écrit en dur) ; LÈVE s'il est introuvable. `env` injectable pour le banc. */
function trouverGit(env = process.env) {
    const base = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'GitHubDesktop');
    let versions = [];
    try { versions = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && /^app-/.test(e.name)).map(e => e.name).sort().reverse(); } catch { /* introuvable ci-dessous */ }
    for (const v of versions) { const g = path.join(base, v, 'resources', 'app', 'git', 'cmd', 'git.exe'); if (fs.existsSync(g)) return g; }
    throw new Error(`git introuvable (${base ?? '%LOCALAPPDATA% absent'}\\app-*\\resources\\app\\git\\cmd\\git.exe) — la copie se lit au commit nommé, il faut git`);
}
/** Un lecteur de sources au COMMIT nommé : nom → Buffer (les octets de `git show <ref>:lib/<nom>`). Lève si le commit ou le fichier n'existe pas. Lecture seule. */
function lecteurGit(repo = REPO_SITE, ref = COMMIT) {
    return nom => {
        try { return execFileSync(trouverGit(), ['-C', repo, 'show', `${ref}:lib/${nom}`], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { throw new Error(`lecture de ${nom} au commit ${ref} impossible (commit ou fichier introuvable) : ${String(e.stderr || e).trim().split('\n')[0]}`); }
    };
}
/** Un lecteur de dossier (l'arbre tel quel) : pour les bancs, qui fabriquent des dérives. */
const lecteurDossier = dossier => nom => fs.readFileSync(path.join(dossier, nom));
const commitComplet = (repo = REPO_SITE, ref = COMMIT) => execFileSync(trouverGit(), ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Produit la copie en mémoire : { sources: {nom: sha}, fichiers: {nomSortie: Buffer} }. `src` : un lecteur (nom → Buffer, par défaut le commit nommé) ou un dossier. Lève si une source manque, si une importation relative sort de la liste (fermeture) ou si le retrait des types n'existe pas. */
function produire(src = lecteurGit(), liste = SOURCES) {
    const lire = typeof src === 'function' ? src : lecteurDossier(src);
    const { stripTypeScriptTypes } = require('node:module');
    if (typeof stripTypeScriptTypes !== 'function') throw new Error('node:module.stripTypeScriptTypes absent (Node 23.2+ requis pour REFAIRE la copie ; l\'exécution de la copie n\'en a pas besoin)');
    const sources = {}, fichiers = {};
    for (const nom of liste) {
        const brut = lire(nom);
        sources[nom] = sha(brut);
        if (nom.endsWith('.json')) { fichiers[nom] = brut; continue; }
        const nu = stripTypeScriptTypes(brut.toString('utf8'), { mode: 'strip' });
        fermeture(nom, nu, liste);
        const code = nu.replace(/(from\s+["']\.\/[^"']+)\.ts(["'])/g, '$1.mjs$2');
        fichiers[sortie(nom)] = Buffer.from(code, 'utf8');
    }
    return { sources, fichiers };
}

function ecrire(src = lecteurGit(), dossier = DOSSIER, commit = commitComplet()) {
    const { sources, fichiers } = produire(src);
    fs.mkdirSync(dossier, { recursive: true });
    const produits = {};
    for (const [nom, buf] of Object.entries(fichiers)) { fs.writeFileSync(path.join(dossier, nom), buf); produits[nom] = sha(buf); }
    fs.writeFileSync(path.join(dossier, 'empreintes.json'), JSON.stringify({ commentaire: `sha256 des fichiers SOURCE du site (rat-market-site/lib, lus au commit ${COMMIT} par git show) et des fichiers produits ici ; refait par v2/chargeur/copier-regle-site.js`, commit, sources, produits }, null, 2) + '\n');
    return { sources, produits, commit };
}

/**
 * @param lecteurs `{ pin, main }` : la lecture du commit NOMMÉ (la copie en est tirée) et celle du `main` du site (le banc de dérive dit quand le `main` change un de ces fichiers). Par défaut : git, en lecture seule.
 * @returns {{ etat: 'ok'|'derive'|'site-absent', derives: string[], regenerationSautee?: boolean }}
 */
function verifier({ siteLib = SITE_LIB, dossier = DOSSIER, lecteurs = null } = {}) {
    if (!fs.existsSync(siteLib)) return { etat: 'site-absent', derives: [] };
    const repo = path.dirname(siteLib);
    const { pin, main } = lecteurs || { pin: lecteurGit(repo, COMMIT), main: lecteurGit(repo, 'main') };
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8'));
    const derives = [];
    // 1. le commit nommé porte bien les empreintes ; 2. le `main` du site aussi (sinon il a bougé depuis : la dérive est dite, nommée)
    for (const nom of SOURCES) {
        for (const lire of [pin, main]) {
            let h = null; try { h = sha(lire(nom)); } catch { /* manquant : dérive */ }
            if (h !== emp.sources[nom] && !derives.includes(nom)) derives.push(nom);
        }
    }
    if (derives.length) return { etat: 'derive', derives };
    // les sources sont celles de l'empreinte : la copie embarquée doit être EXACTEMENT ce que l'outil en produit
    if (!lecteurs && emp.commit !== commitComplet(repo)) return { etat: 'derive', derives: ['empreintes.json (commit)'] };
    if (typeof require('node:module').stripTypeScriptTypes !== 'function') return { etat: 'ok', derives: [], regenerationSautee: true };
    const { fichiers } = produire(pin);        // toute autre erreur (fermeture, source manquante) REMONTE : jamais un « ok » qui l'avale
    for (const [nom, buf] of Object.entries(fichiers)) { let h = null; try { h = sha(fs.readFileSync(path.join(dossier, nom))); } catch { /* manquant */ } if (h !== sha(buf)) derives.push(nom); }
    return derives.length ? { etat: 'derive', derives } : { etat: 'ok', derives: [] };
}

module.exports = { produire, ecrire, verifier, fermeture, trouverGit, lecteurGit, lecteurDossier, commitComplet, COMMIT, REPO_SITE, DOSSIER, SITE_LIB, SOURCES };

if (require.main === module) {
    if (process.argv.includes('--verifier')) {
        const r = verifier();
        if (r.etat === 'site-absent') { console.log(`⚠️ site absent (${SITE_LIB}) : copie NON vérifiée`); process.exit(2); }
        if (r.etat === 'derive') { console.error(`🔴 DÉRIVE : ${r.derives.join(', ')} — relancer node v2/chargeur/copier-regle-site.js`); process.exit(1); }
        console.log(`✅ copie conforme au site (${SOURCES.length} sources)${r.regenerationSautee ? ' — régénération sautée (Node sans stripTypeScriptTypes)' : ''}`); process.exit(0);
    }
    const r = ecrire();
    console.log(`copie refaite au commit ${r.commit} : ${Object.keys(r.produits).length} fichiers, ${SOURCES.length} sources empreintées`);
}
