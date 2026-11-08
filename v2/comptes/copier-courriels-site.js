'use strict';
// BREVO — l'OUTIL qui refait la copie EMBARQUÉE des gabarits de courriel du site (rat-market-site/lib/courriels.ts et sa fermeture), et la vérifie.
//   node v2/comptes/copier-courriels-site.js              refait v2/comptes/courriels-site/ depuis le site AU COMMIT NOMMÉ (`git show`)
//   node v2/comptes/copier-courriels-site.js --verifier   code 0 : conforme à l'ÉPINGLE ; 1 : DÉRIVE (fichiers nommés) ; 2 : non vérifié (site ou commit absent, dit). `main` du site n'entre pas dans le verdict :
//   sa dérive est un AVERTISSEMENT (deriveDuSite) et se résorbe par `node v2/comptes/resynchroniser-courriels-site.js` (banc : test-courriels-auto.js).
// Même mécanisme que v2/chargeur/copier-regle-site.js (dont les fonctions sont reprises, pas recopiées) : le site n'existe pas sur Render et le serveur y tourne en Node 22, qui n'exécute pas
// le TypeScript. On embarque des `.mjs` produits par retrait des types, avec le sha256 de chaque source. Le gabarit du site est le texte des courriels : il n'est JAMAIS retouché ici.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const R = require('../chargeur/copier-regle-site');

const DOSSIER = path.join(__dirname, 'courriels-site');
const SITE_LIB = R.SITE_LIB, REPO_SITE = R.REPO_SITE;
// LE COMMIT NOMMÉ du site dont la copie est tirée (main du site au 2026-11-08 matin : 1ee401e ; avant : 67d259e, puis f17614c du 2026-11-01). Depuis f17614c, le lot « source
// unique de l'offre » du site a retiré SCANS_ACCUEIL et ANALYSES_SANS_COMPTE de site.ts et fait lire à tarifs.ts ses quotas dans le nouveau lib/offre.ts (3 et 10, inchangés) ;
// de 67d259e à 1ee401e, seul offre.ts bouge (« au lancement » retiré, PLAFOND_PRO_CGV à 200, texte du scanner web) ; prix et quotas inchangés.
// Le changer est un geste volontaire : relancer l'outil, relire le diff des .mjs.
const COMMIT = '1ee401e';
// la fermeture TRANSITIVE des imports de courriels.ts (vérifiée par `fermeture` : tout import relatif hors de cette liste fait lever l'outil)
const SOURCES = Object.freeze(['courriels.ts', 'courrielsGabarit.ts', 'site.ts', 'extension.ts', 'tarifs.ts', 'montants.ts', 'offre.ts']);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const produire = (src, repo = REPO_SITE, commit = COMMIT) => R.produire(src || R.lecteurGit(repo, commit), SOURCES);
/** Refait la copie depuis le commit ÉPINGLÉ (par défaut COMMIT) ; `commit`/`repo` injectables pour la resynchronisation et les bancs. */
function ecrire(src, dossier = DOSSIER, { commit: ref = COMMIT, repo = REPO_SITE } = {}) {
    const { sources, fichiers } = produire(src, repo, ref);
    fs.mkdirSync(dossier, { recursive: true });
    const produits = {};
    for (const [nom, buf] of Object.entries(fichiers)) { fs.writeFileSync(path.join(dossier, nom), buf); produits[nom] = sha(buf); }
    const commit = R.commitComplet(repo, ref);
    fs.writeFileSync(path.join(dossier, 'empreintes.json'), JSON.stringify({ commentaire: `sha256 des fichiers SOURCE du site (rat-market-site/lib, lus au commit ${ref} par git show) et des fichiers produits ici ; refait par v2/comptes/copier-courriels-site.js`, commit, sources, produits }, null, 2) + '\n');
    return { sources, produits, commit };
}
/**
 * VERDICT DÉTERMINISTE du verrou : la copie committée est EXACTEMENT ce que l'outil produit à partir du commit ÉPINGLÉ (`git show <commit>:lib/<nom>`, jamais l'arbre de travail
 * du site, jamais `main`). Ce que fait le site après l'épingle n'y entre pas : voir deriveDuSite (avertissement).
 * → { etat: 'ok'|'derive'|'non-verifie', derives, raison? }
 *   'derive'      : copie retouchée à la main, ou différente de ce que produit l'épingle (échec).
 *   'non-verifie' : dépôt du site absent, ou commit épinglé introuvable dedans (raison dite). Le banc l'affiche en tête et ne le range JAMAIS sous « conforme à l'épingle » ;
 *                   la partie qui ne dépend pas du site (copie non retouchée vs empreintes.json) reste jugée, et échoue avant ce point si elle est fausse.
 */
function verifier({ siteLib = SITE_LIB, dossier = DOSSIER, commit = COMMIT } = {}) {
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8'));
    const derives = [];
    // 1. sans le site : chaque fichier produit est tel que l'outil l'a écrit (empreinte de la copie)
    for (const [nom, h] of Object.entries(emp.produits)) { let h2 = null; try { h2 = sha(fs.readFileSync(path.join(dossier, nom))); } catch { /* manquant */ } if (h2 !== h) derives.push(nom); }
    if (derives.length) return { etat: 'derive', derives };
    if (!fs.existsSync(siteLib)) return { etat: 'non-verifie', raison: 'site-absent', derives: [] };
    const repo = path.dirname(siteLib);
    let complet; try { complet = R.commitComplet(repo, commit); } catch { return { etat: 'non-verifie', raison: 'commit-absent', derives: [] }; }
    if (emp.commit !== complet) return { etat: 'derive', derives: ['empreintes.json (commit)'] };
    if (typeof require('node:module').stripTypeScriptTypes !== 'function') return { etat: 'ok', derives: [], regenerationSautee: true };
    const pin = R.lecteurGit(repo, commit);
    for (const nom of SOURCES) { let h = null; try { h = sha(pin(nom)); } catch { /* manquant */ } if (h !== emp.sources[nom]) derives.push(nom); }
    if (derives.length) return { etat: 'derive', derives };
    const { fichiers } = produire(pin);        // toute autre erreur (fermeture, source manquante) REMONTE : jamais un « ok » qui l'avale
    for (const [nom, buf] of Object.entries(fichiers)) { let h = null; try { h = sha(fs.readFileSync(path.join(dossier, nom))); } catch { /* manquant */ } if (h !== sha(buf)) derives.push(nom); }
    return derives.length ? { etat: 'derive', derives } : { etat: 'ok', derives: [] };
}
/**
 * AVERTISSEMENT (jamais un échec) : le site a-t-il changé des sources depuis l'épingle ? Compare les sources de `ref` (main) aux empreintes de la copie, par `git show`.
 * → { etat: 'a-jour'|'avance'|'indetermine', changees, tete?, raison? }
 */
function deriveDuSite({ siteLib = SITE_LIB, dossier = DOSSIER, ref = 'main' } = {}) {
    if (!fs.existsSync(siteLib)) return { etat: 'indetermine', changees: [], raison: 'site-absent' };
    const repo = path.dirname(siteLib);
    let tete; try { tete = R.commitComplet(repo, ref); } catch { return { etat: 'indetermine', changees: [], raison: `${ref}-introuvable` }; }
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8'));
    const lire = R.lecteurGit(repo, tete), changees = [];
    for (const nom of SOURCES) { let h = null; try { h = sha(lire(nom)); } catch { /* retirée du site : changée */ } if (h !== emp.sources[nom]) changees.push(nom); }
    return { etat: changees.length ? 'avance' : 'a-jour', changees, tete };
}
const avertissement = (d, commit = COMMIT) => d.etat === 'avance'
    ? `⚠️ AVERTISSEMENT (n'échoue pas le verrou) : le site a changé ${d.changees.length} des ${SOURCES.length} sources depuis le commit épinglé ${commit} (${d.changees.join(', ')}; tête ${d.tete.slice(0, 7)}) → lancer \`node v2/comptes/resynchroniser-courriels-site.js\``
    : d.etat === 'indetermine' ? `⚠️ dérive du site NON mesurée (${d.raison})` : `✅ le site n'a changé aucune des ${SOURCES.length} sources depuis l'épingle ${commit}`;
module.exports = { produire, ecrire, verifier, deriveDuSite, avertissement, fermeture: R.fermeture, COMMIT, SOURCES, DOSSIER, SITE_LIB, REPO_SITE, FICHIER: __filename };

if (require.main === module) {
    if (process.argv.includes('--verifier')) {
        const r = verifier();
        if (r.etat === 'non-verifie') { console.log(`⚠️ copie NON vérifiée (${r.raison}) : ${SITE_LIB}`); process.exit(2); }
        if (r.etat === 'derive') { console.error(`🔴 DÉRIVE : ${r.derives.join(', ')} — relancer node v2/comptes/copier-courriels-site.js`); process.exit(1); }
        console.log(`✅ copie conforme à l'épingle ${COMMIT} (${SOURCES.length} sources)`); console.log(avertissement(deriveDuSite())); process.exit(0);
    }
    const r = ecrire();
    console.log(`copie refaite au commit ${r.commit} : ${Object.keys(r.produits).length} fichiers`);
}
