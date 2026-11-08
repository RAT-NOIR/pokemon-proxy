'use strict';
// BREVO — l'OUTIL qui refait la copie EMBARQUÉE des gabarits de courriel du site (rat-market-site/lib/courriels.ts et sa fermeture), et la vérifie.
//   node v2/comptes/copier-courriels-site.js              refait v2/comptes/courriels-site/ depuis le site AU COMMIT NOMMÉ (`git show`)
//   node v2/comptes/copier-courriels-site.js --verifier   code 0 : conforme ; 1 : DÉRIVE (fichiers nommés) ; 2 : site absent (non vérifié, dit)
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

const produire = (src) => R.produire(src || R.lecteurGit(REPO_SITE, COMMIT), SOURCES);
function ecrire(src, dossier = DOSSIER) {
    const { sources, fichiers } = produire(src);
    fs.mkdirSync(dossier, { recursive: true });
    const produits = {};
    for (const [nom, buf] of Object.entries(fichiers)) { fs.writeFileSync(path.join(dossier, nom), buf); produits[nom] = sha(buf); }
    const commit = R.commitComplet(REPO_SITE, COMMIT);
    fs.writeFileSync(path.join(dossier, 'empreintes.json'), JSON.stringify({ commentaire: `sha256 des fichiers SOURCE du site (rat-market-site/lib, lus au commit ${COMMIT} par git show) et des fichiers produits ici ; refait par v2/comptes/copier-courriels-site.js`, commit, sources, produits }, null, 2) + '\n');
    return { sources, produits, commit };
}
/** → { etat: 'ok'|'derive'|'site-absent', derives }. Comme la règle du site : le commit nommé ET le main doivent porter les empreintes, et la copie doit être exactement ce que l'outil produit. */
function verifier({ siteLib = SITE_LIB, dossier = DOSSIER, lecteurs = null } = {}) {
    if (!fs.existsSync(siteLib)) return { etat: 'site-absent', derives: [] };
    const repo = path.dirname(siteLib);
    const { pin, main } = lecteurs || { pin: R.lecteurGit(repo, COMMIT), main: R.lecteurGit(repo, 'main') };
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8'));
    const derives = [];
    for (const nom of SOURCES) for (const lire of [pin, main]) {
        let h = null; try { h = sha(lire(nom)); } catch { /* manquant : dérive */ }
        if (h !== emp.sources[nom] && !derives.includes(nom)) derives.push(nom);
    }
    if (derives.length) return { etat: 'derive', derives };
    if (!lecteurs && emp.commit !== R.commitComplet(repo, COMMIT)) return { etat: 'derive', derives: ['empreintes.json (commit)'] };
    if (typeof require('node:module').stripTypeScriptTypes !== 'function') return { etat: 'ok', derives: [], regenerationSautee: true };
    const { fichiers } = produire(pin);
    for (const [nom, buf] of Object.entries(fichiers)) { let h = null; try { h = sha(fs.readFileSync(path.join(dossier, nom))); } catch { /* manquant */ } if (h !== sha(buf)) derives.push(nom); }
    return derives.length ? { etat: 'derive', derives } : { etat: 'ok', derives: [] };
}
module.exports = { produire, ecrire, verifier, fermeture: R.fermeture, COMMIT, SOURCES, DOSSIER, SITE_LIB };

if (require.main === module) {
    if (process.argv.includes('--verifier')) {
        const r = verifier();
        if (r.etat === 'site-absent') { console.log(`⚠️ site absent (${SITE_LIB}) : copie NON vérifiée`); process.exit(2); }
        if (r.etat === 'derive') { console.error(`🔴 DÉRIVE : ${r.derives.join(', ')} — relancer node v2/comptes/copier-courriels-site.js`); process.exit(1); }
        console.log(`✅ copie conforme au site (${SOURCES.length} sources)`); process.exit(0);
    }
    const r = ecrire();
    console.log(`copie refaite au commit ${r.commit} : ${Object.keys(r.produits).length} fichiers`);
}
