// ============================================================
// LE NUMÉRO IMPRIMÉ DES WCD ET DES PRIZE PACKS — le lanceur (la logique, ses gardes et leur raison : collecte-cartes/numeros-imprimes.js)
// ============================================================
//   node poser-numeros-imprimes.js --lectures=<fichier>.json                                  (simulation, par défaut : rien n'est écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits,sets -- node poser-numeros-imprimes.js --lectures=<f>.json --attendu=<N> --ecrire
//
// `--lectures` : un tableau de { idProduct, carteId, set, numeroLu, totalLu, marque: 'WCD'|'tampon', cleR2, luPar, luLe }, écrit par une LECTURE de scan
// (jamais par un slug seul). `--attendu=N` : le nombre d'IMPRESSIONS de la simulation, exigé par --ecrire ; il ne colle plus -> rien ne s'écrit.
// Argument inconnu (dont --force, qui n'existe pas) : refusé avant toute connexion. Seul le coordinateur lance --ecrire.
// La règle du site est IMPORTÉE (exporter-donnees-logos-site.js::regleDuSite / fichesDesProduits ; lib/imageDeLImpression.ts et lib/langueDuVisuel.ts du site) :
// SITE_LIB=<dossier lib du site> (défaut ../rat-market-site/lib), RACINE_SITE=<dossier dont le voisin porte la règle> (défaut : ce dépôt).
// AJOUTS SEULEMENT : $push d'impressions, $set de numeroFiche là où il est nul ou absent, $set de bulba.expansion là où elle est nulle (jamais une valeur nulle).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { ouvrirSimulation } = require('./collecte-cartes/ouvrir-lecture');
const NI = require('./collecte-cartes/numeros-imprimes');
const X = require('./exporter-donnees-logos-site');

(async () => {
    const A = NI.analyserArgs(process.argv.slice(2));
    if (A.erreur) { console.error(`❌ ${A.erreur}`); process.exit(2); }
    let lectures;
    try { lectures = JSON.parse(fs.readFileSync(A.lectures, 'utf8')); } catch (e) { console.error(`❌ le fichier de lectures ne se lit pas (${e.message}) — rien n'est fait`); process.exit(2); }
    const SITE_LIB = process.env.SITE_LIB || path.join(__dirname, '..', 'rat-market-site', 'lib');
    const lire = f => import(pathToFileURL(path.join(SITE_LIB, f)).href);
    const [Lg, Im] = await Promise.all([lire('langueDuVisuel.ts'), lire('imageDeLImpression.ts')]);
    const deps = { regle: await X.regleDuSite(process.env.RACINE_SITE || __dirname), fichesDesProduits: X.fichesDesProduits, refusDuVisuel: Lg.refusDuVisuel, imageDeLImpression: Im.imageDeLImpression };
    for (const [k, f] of Object.entries(deps)) if (k !== 'regle' && typeof f !== 'function') throw new Error(`${k} absent de ${SITE_LIB}`);
    // la SIMULATION lit par la connexion de LECTURE SEULE (ouvrir-lecture.js) ; seule l'écriture ouvre l'autre
    const { cartes: cx, fermer } = A.ecrire ? await ouvrirConnexions({ production: false, buckets: [] }) : await ouvrirSimulation({ viaEcriture: A.viaEcriture, ouvrirConnexions });
    try {
        const { code } = await NI.executer({ db: cx.db, deps, lectures, attendu: A.attendu, ecrire: A.ecrire });
        process.exitCode = code;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });
