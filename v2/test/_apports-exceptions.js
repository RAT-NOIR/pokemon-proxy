'use strict';
// TESTS-APPORTS / MOYENS-B2b point 7 — LA liste des dossiers d'apports et des exceptions nommées, partagée par la garde sur le TEXTE (test-garde-apports.js) et par l'ESPION des lectures de fichiers
// (_espion-fs.js). Une seule définition (§21 bis : deux listes divergent toujours).
// comparés SANS casse (Windows ouvre « logo fr » comme « Logo FR »), après uniformisation des séparateurs en « / »
const INTERDITS = ['Logo FR', 'apport-manuel', 'Logo JP', 'Logo ZH', 'verrou/photos', 'Desktop/LOGO', 'GABARIT-pokecardex'];
// Chemins du Bureau qu'un fichier a le droit de nommer (début du chemin, séparateurs « / »), PAR FICHIER de banc. AUCUN n'est un dossier rempli à la main par le testeur.
const EXCEPTIONS = {
    'test-abus-routes.js': { 'extension v2/src/fond/fausses': 'fausses réponses versionnées de l\'extension (dépôt voisin) ; le banc se passe du dossier absent', 'pokemon-proxy-api-v2/.superpowers/sdd/PLAN-API-V2/progress.md': 'journal de lots du plan, lecture seule (RM_PROGRESS)' },
    // Tour 3 (M-E) : trois fichiers de DONNÉES du site, lus par ce banc (RM_SITE) — en lecture seule ; plus la clé nue qui ouvrait le site entier (son .env compris) en lecture et en écriture
    'test-collection-forme.js': { 'rat-market-site/archives/CORRECTION-ILLUSTRATEURS.json': 'données du site lues (jeu de caractères des clés), pas un apport manuel', 'rat-market-site/lib/logos-officiels.json': 'données du site lues (slugs), pas un apport manuel', 'rat-market-site/LISTE-FICHES-SANS-VISUEL.json': 'données du site lues (clés et slugs), pas un apport manuel' },
    // découvertes par l'ESPION des fichiers (_espion-fs.js, MOYENS-B2b) : ces deux bancs construisent le chemin du site par path.join (la garde sur le texte ne le voyait pas).
    // Tour 1 : ils ne lisent que rat-market-site/lib (vérifié : seuls des readFileSync et le côté SOURCE d'un copyFileSync y sont refusés sans exception) — et en LECTURE SEULE (LECTURE_SEULE ci-dessous).
    'test-chargeur-decision.js': { 'rat-market-site/lib': 'code du site (lib/*.ts, lib/*.json), pas un apport manuel : la copie embarquée de la règle est comparée à lui' },
    'test-chargeur-regle-site.js': { 'rat-market-site/lib': 'code du site (lib/*.ts, lib/*.json), pas un apport manuel : la copie embarquée de la règle est régénérée et comparée' },
    'test-contrat-extension.js': { 'extension v2/src/fond/fausses': 'fausses réponses versionnées de l\'extension (RM_EXTENSION_FAUSSES)' },
    'test-identifier-adaptateur.js': { 'extension v2/src/fond/fausses': 'fausses réponses versionnées de l\'extension' },
    'test-identifier-regle-g.js': { 'labo-embedding/rm/fixtures-g': 'fixtures du labo (argument de ligne de commande par défaut)' },
    'test-identifier-regle-g-route.js': { 'labo-embedding/rm/fixtures-g': 'fixtures du labo (argument de ligne de commande par défaut)' },
    // outils de mesure hors lancer-tout : le chemin exact d'une sauvegarde de lot et du cache mongod, jamais le dossier entier du Bureau
    'mesurer-collection.js': { 'pokemon-proxy/backup-2026-10-10-lot-075226': 'sauvegarde de lot (lecture)' },
    'mesurer-memoire.js': { 'pokemon-proxy/backup-2026-10-10-lot-075226': 'sauvegarde de lot (lecture)', 'pokemon-proxy/.banc-local/cache-mongod': 'cache mongod (MONGOMS_DOWNLOAD_DIR)' },
    'test-collections-partagees.js': { 'pokemon-proxy/mesures/taille-bases.jsonl': 'COMMENTAIRE seulement : source du relevé épinglé, jamais lu' },
};
// Les exceptions que l'espion n'ouvre qu'en LECTURE (fichier de banc -> clés de EXCEPTIONS). Toute autre exception garde le droit d'avant.
const LECTURE_SEULE = {
    'test-collection-forme.js': ['rat-market-site/archives/CORRECTION-ILLUSTRATEURS.json', 'rat-market-site/lib/logos-officiels.json', 'rat-market-site/LISTE-FICHES-SANS-VISUEL.json'],
    'test-chargeur-decision.js': ['rat-market-site/lib'],
    'test-chargeur-regle-site.js': ['rat-market-site/lib'],
};

/**
 * Tour 1 (I-3) — une exception est écrite par ce qu'on AUTORISE : une clé est un chemin RELATIF au Bureau, en « / », de segments non vides, ni « . » ni « .. », qui ne désigne pas le Bureau lui-même
 * (ni un lecteur, ni la racine), qui n'est pas absolue et ne tombe pas dans un dossier d'apports ; chaque exception porte une raison écrite. LÈVE au chargement : un élargissement (clé vide =
 * le Bureau entier) tue la garde sur le texte ET l'espion, qui chargent tous deux ce module.
 */
function valider(exceptions = EXCEPTIONS, lectureSeule = LECTURE_SEULE) {
    const faute = (nom, cle, pourquoi) => { throw new Error(`exception refusée (${nom} : « ${cle} ») : ${pourquoi}`); };
    // Tour 2 (I-A) : une exception désigne un dossier ou un fichier PRÉCIS qui ne CONTIENT aucun dossier protégé. Les chemins protégés (relatifs au Bureau, en minuscules) : chaque dossier d'apports, nu et sous les
    // deux dépôts du testeur (le principal et celui de l'API), plus le jeu de photos du verrou sous les deux. Une clé égale à l'un d'eux OU qui en est l'ANCÊTRE (« pokemon-proxy » contient « Logo FR ») est refusée.
    const path = require('path'), fs = require('fs');
    const protegesRel = [];
    for (const i of INTERDITS) { const n = i.toLowerCase().replace(/^desktop\//, ''); protegesRel.push(n, `pokemon-proxy/${n}`, `pokemon-proxy-api-v2/${n}`); }
    // Tour 3 (M-E) : les fichiers `.env` sont protégés aussi (celui du site et ceux des deux dépôts) — une clé qui les contient ou les désigne est refusée, comme tout segment `.env*`
    protegesRel.push('rat-market-site/.env', 'pokemon-proxy/.env', 'pokemon-proxy-api-v2/.env');
    const bureau = path.join(require('os').homedir(), 'Desktop');
    const reel = p => { let abs = path.resolve(p); const reste = []; for (;;) { try { return path.join(fs.realpathSync.native(abs), ...reste.reverse()).replace(/[\\/]+/g, '/').toLowerCase(); } catch { const parent = path.dirname(abs); if (parent === abs) return path.resolve(p).replace(/[\\/]+/g, '/').toLowerCase(); reste.push(path.basename(abs)); abs = parent; } } };
    for (const [nom, ex] of Object.entries(exceptions)) {
        for (const [cle, raison] of Object.entries(ex || {})) {
            if (typeof cle !== 'string' || cle.trim() === '') faute(nom, cle, 'clé vide');
            if (/\\/.test(cle)) faute(nom, cle, 'séparateurs « / » seulement');
            if (/^[a-z]:/i.test(cle) || cle.startsWith('/')) faute(nom, cle, 'chemin absolu ou racine : une clé est relative au Bureau');
            const segments = cle.split('/');
            if (segments.some(s => s.trim() === '' || s === '.' || s === '..')) faute(nom, cle, 'segment vide, « . » ou « .. »');
            if (['desktop', 'bureau'].includes(segments[0].toLowerCase())) faute(nom, cle, 'désigne le Bureau lui-même, pas un chemin nommé en dessous');
            if (segments.some(s => /[~*?<>|"]/.test(s) || /[. ]$/.test(s))) faute(nom, cle, 'segment avec un joker, un nom court 8.3 (~), un caractère interdit ou un point ou espace final');
            const bas = cle.toLowerCase();
            for (const i of INTERDITS) if (bas.includes(i.toLowerCase())) faute(nom, cle, `tombe dans un dossier d'apports (${i})`);
            if (segments.some(s => /^\.env/i.test(s))) faute(nom, cle, 'désigne un fichier .env');
            // ni égale, ni ANCÊTRE (tour 2), ni DESCENDANTE (tour 3 : « LOGO/sub » ouvre le dossier du testeur par le dessous) d'un chemin protégé
            for (const p of protegesRel) if (p === bas || p.startsWith(`${bas}/`) || bas.startsWith(`${p}/`)) faute(nom, cle, `est, CONTIENT ou est SOUS le chemin protégé « ${p} » (une exception nomme un chemin précis, sans aucun lien avec eux)`);
            // le chemin RÉEL (jonctions suivies) : la clé résolue sous le Bureau, dans les deux sens, comme ci-dessus
            const kr = reel(path.join(bureau, cle));
            for (const p of protegesRel) { const pr = reel(path.join(bureau, p)); if (pr === kr || pr.startsWith(`${kr}/`) || kr.startsWith(`${pr}/`)) faute(nom, cle, `son chemin réel touche « ${p} »`); }
            if (typeof raison !== 'string' || raison.trim() === '') faute(nom, cle, 'raison écrite exigée');
        }
    }
    for (const [nom, cles] of Object.entries(lectureSeule)) for (const cle of cles) if (!Object.keys((exceptions[nom]) || {}).includes(cle)) faute(nom, cle, 'LECTURE_SEULE ne désigne aucune exception de ce fichier');
    return true;
}
valider();
module.exports = { INTERDITS, EXCEPTIONS, LECTURE_SEULE, valider };
