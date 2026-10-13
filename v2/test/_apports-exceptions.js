'use strict';
// TESTS-APPORTS / MOYENS-B2b point 7 — LA liste des dossiers d'apports et des exceptions nommées, partagée par la garde sur le TEXTE (test-garde-apports.js) et par l'ESPION des lectures de fichiers
// (_espion-fs.js). Une seule définition (§21 bis : deux listes divergent toujours).
// comparés SANS casse (Windows ouvre « logo fr » comme « Logo FR »), après uniformisation des séparateurs en « / »
const INTERDITS = ['Logo FR', 'apport-manuel', 'Logo JP', 'Logo ZH', 'verrou/photos', 'Desktop/LOGO', 'GABARIT-pokecardex'];
// Chemins du Bureau qu'un fichier a le droit de nommer (début du chemin, séparateurs « / »), PAR FICHIER de banc. AUCUN n'est un dossier rempli à la main par le testeur.
const EXCEPTIONS = {
    'test-abus-routes.js': { 'extension v2/src/fond/fausses': 'fausses réponses versionnées de l\'extension (dépôt voisin) ; le banc se passe du dossier absent', 'pokemon-proxy-api-v2/.superpowers/sdd/PLAN-API-V2/progress.md': 'journal de lots du plan, lecture seule (RM_PROGRESS)' },
    'test-collection-forme.js': { 'rat-market-site': 'code du site (lib/*.ts), pas un apport manuel (RM_SITE)' },
    // découvertes par l'ESPION des fichiers (_espion-fs.js, MOYENS-B2b) : ces deux bancs construisent le chemin du site par path.join (la garde sur le texte ne le voyait pas)
    'test-chargeur-decision.js': { 'rat-market-site': 'code du site (lib/*.ts), pas un apport manuel : la copie embarquée de la règle est comparée à lui' },
    'test-chargeur-regle-site.js': { 'rat-market-site': 'code du site (lib/*.ts), pas un apport manuel : la copie embarquée de la règle est régénérée et comparée' },
    'test-contrat-extension.js': { 'extension v2/src/fond/fausses': 'fausses réponses versionnées de l\'extension (RM_EXTENSION_FAUSSES)' },
    'test-identifier-adaptateur.js': { 'extension v2/src/fond/fausses': 'fausses réponses versionnées de l\'extension' },
    'test-identifier-regle-g.js': { 'labo-embedding/rm/fixtures-g': 'fixtures du labo (argument de ligne de commande par défaut)' },
    'test-identifier-regle-g-route.js': { 'labo-embedding/rm/fixtures-g': 'fixtures du labo (argument de ligne de commande par défaut)' },
    // outils de mesure hors lancer-tout : le chemin exact d'une sauvegarde de lot et du cache mongod, jamais le dossier entier du Bureau
    'mesurer-collection.js': { 'pokemon-proxy/backup-2026-10-10-lot-075226': 'sauvegarde de lot (lecture)' },
    'mesurer-memoire.js': { 'pokemon-proxy/backup-2026-10-10-lot-075226': 'sauvegarde de lot (lecture)', 'pokemon-proxy/.banc-local/cache-mongod': 'cache mongod (MONGOMS_DOWNLOAD_DIR)' },
    'test-collections-partagees.js': { 'pokemon-proxy/mesures/taille-bases.jsonl': 'COMMENTAIRE seulement : source du relevé épinglé, jamais lu' },
};
module.exports = { INTERDITS, EXCEPTIONS };
