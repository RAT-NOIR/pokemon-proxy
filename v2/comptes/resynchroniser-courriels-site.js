'use strict';
// BREVO — RESYNCHRONISE la copie embarquée des gabarits de courriel sur la tête de `main` du site, en un geste.
//   node v2/comptes/resynchroniser-courriels-site.js              met à jour COMMIT (v2/comptes/copier-courriels-site.js), régénère v2/comptes/courriels-site/, rejoue le banc de la copie,
//                                                                 imprime le diff du contenu SERVI (sources du site + lignes des .mjs). NE COMMITE PAS : le coordinateur nomme les fichiers.
//   node v2/comptes/resynchroniser-courriels-site.js --verifier   lecture seule : dit si le site a changé des sources depuis l'épingle (code 0 à jour, 1 avancé, 2 indéterminé)
// Il ne lit que des COMMITS du site (`git show`) : un arbre de travail du site qui a des modifications non commitées sur ces sources est REFUSÉ (rien n'est écrit).
// Il ne touche qu'à la constante COMMIT et aux fichiers générés (courriels-site/). Le verrou, lui, ne dépend jamais de `main` du site (voir copier-courriels-site.js : verifier / deriveDuSite).
const fs = require('fs'); const path = require('path'); const { execFileSync, spawnSync } = require('child_process');
const R = require('../chargeur/copier-regle-site');
const C = require('./copier-courriels-site');

const REGEX_COMMIT = /^const COMMIT = '([0-9a-f]+)';/m;

/** diff de lignes (préfixe/suffixe communs retirés, puis plus longue sous-suite commune) : [{ type: '-'|'+', ligne, n }] */
function diffLignes(avant, apres) {
    const a = avant.split('\n'), b = apres.split('\n');
    let d = 0; while (d < a.length && d < b.length && a[d] === b[d]) d++;
    let f = 0; while (f < a.length - d && f < b.length - d && a[a.length - 1 - f] === b[b.length - 1 - f]) f++;
    const x = a.slice(d, a.length - f), y = b.slice(d, b.length - f), out = [];
    const L = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
        if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; }
        else if (j >= y.length || (i < x.length && L[i + 1][j] >= L[i][j + 1])) { out.push({ type: '-', ligne: x[i], n: d + i + 1 }); i++; }
        else { out.push({ type: '+', ligne: y[j], n: d + j + 1 }); j++; }
    }
    return out;
}

function git(repo, args) { return execFileSync(R.trouverGit(), ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

/**
 * @param o.repo           dépôt du site (par défaut rat-market-site)
 * @param o.dossier        dossier de la copie
 * @param o.fichierCommit  fichier qui porte `const COMMIT = '…';`
 * @param o.lancerTest     () => { ok, texte } : le banc de la copie, rejoué APRÈS l'écriture
 * @param o.verifierSeulement lecture seule
 * Lève si le site est absent, si l'arbre du site a des modifications non commitées sur les sources, ou si le banc de la copie échoue (les fichiers restent écrits pour être relus).
 */
function resynchroniser({ repo = C.REPO_SITE, dossier = C.DOSSIER, fichierCommit = C.FICHIER, ref = 'main', verifierSeulement = false, lancerTest = null, sortie = console.log } = {}) {
    const siteLib = path.join(repo, 'lib');
    if (!fs.existsSync(siteLib)) throw new Error(`site absent (${siteLib}) : rien à resynchroniser`);
    const d = C.deriveDuSite({ siteLib, dossier, ref });
    if (d.etat === 'indetermine') throw new Error(`dérive du site indéterminée (${d.raison})`);
    sortie(C.avertissement(d, REGEX_COMMIT.exec(fs.readFileSync(fichierCommit, 'utf8'))?.[1] ?? C.COMMIT));
    if (verifierSeulement) return { ecrit: false, ...d };
    // l'arbre du site : on ne lit que des commits ; une modification non commitée sur une source ferait croire à une source qui n'existe pas dans le commit
    const sales = git(repo, ['status', '--porcelain', '--', ...C.SOURCES.map(n => `lib/${n}`)]).split('\n').filter(Boolean);
    if (sales.length) throw new Error(`REFUS : l'arbre du site a des modifications non commitées sur les sources (${sales.map(l => l.slice(3)).join(', ')}) — commiter ou annuler côté site ; rien n'est écrit`);
    if (d.etat === 'a-jour') { sortie('rien à faire : aucune des sources n\'a changé, épingle et copie laissées telles quelles'); return { ecrit: false, ...d }; }

    const ancien = REGEX_COMMIT.exec(fs.readFileSync(fichierCommit, 'utf8'));
    if (!ancien) throw new Error(`const COMMIT introuvable dans ${fichierCommit}`);
    const nouveau = git(repo, ['rev-parse', '--short=7', d.tete]).trim();
    const avant = {};
    for (const f of fs.existsSync(dossier) ? fs.readdirSync(dossier) : []) avant[f] = fs.readFileSync(path.join(dossier, f), 'utf8');
    // la SEULE ligne modifiée du fichier du copieur
    const texte = fs.readFileSync(fichierCommit, 'utf8');
    fs.writeFileSync(fichierCommit, texte.replace(REGEX_COMMIT, `const COMMIT = '${nouveau}';`));
    const r = C.ecrire(null, dossier, { commit: nouveau, repo });
    sortie(`épingle : ${ancien[1]} → ${nouveau} (${r.commit}) ; copie régénérée : ${Object.keys(r.produits).length} fichiers`);
    const test = lancerTest ? lancerTest({ commit: nouveau }) : { ok: true, texte: '' };
    sortie(test.ok ? '✅ banc de la copie : vert' : `🔴 banc de la copie : ÉCHEC\n${test.texte}`);

    // diff du contenu SERVI
    const modifies = [];
    for (const nom of fs.readdirSync(dossier).sort()) {
        const apres = fs.readFileSync(path.join(dossier, nom), 'utf8');
        if (avant[nom] === apres) continue;
        const dl = diffLignes(avant[nom] ?? '', apres);
        modifies.push(nom);
        sortie(`--- ${nom} : ${dl.filter(l => l.type === '-').length} lignes retirées, ${dl.filter(l => l.type === '+').length} ajoutées`);
        if (nom === 'empreintes.json') continue;           // sha et commit : lus dans le diff git
        for (const l of dl.slice(0, 300)) sortie(`${l.type} ${String(l.n).padStart(4)}  ${l.ligne}`);
        if (dl.length > 300) sortie(`   … ${dl.length - 300} lignes de plus (git diff les montre)`);
    }
    sortie(`sources du site changées : ${d.changees.join(', ')}`);
    const aCommiter = [path.relative(process.cwd(), fichierCommit), ...modifies.map(n => path.relative(process.cwd(), path.join(dossier, n)))];
    sortie(`NON COMMITÉ — fichiers à nommer un par un : ${aCommiter.join(' ')}`);
    if (!test.ok) throw new Error('le banc de la copie échoue après la resynchronisation');
    return { ecrit: true, ancien: ancien[1], nouveau, modifies, ...d };
}
module.exports = { resynchroniser, diffLignes };

if (require.main === module) {
    const verifierSeulement = process.argv.includes('--verifier');
    const lancerTest = ({ commit }) => {
        // le banc de la copie, dans un processus neuf (il relit COMMIT dans le fichier réécrit) ; son verdict ne dépend que de l'épingle
        const p = spawnSync(process.execPath, [path.join(__dirname, '..', 'test', 'test-courriels-site.js')], { encoding: 'utf8' });
        return { ok: p.status === 0, texte: (p.stdout || '').split('\n').filter(l => /❌|échoué/.test(l)).join('\n') + (p.stderr || '') };
    };
    try {
        const r = resynchroniser({ verifierSeulement, lancerTest });
        process.exit(verifierSeulement ? (r.etat === 'a-jour' ? 0 : 1) : 0);
    } catch (e) { console.error(`🔴 ${e.message}`); process.exit(verifierSeulement ? 2 : 1); }
}
