'use strict';
// TESTS-APPORTS (2026-10-13) — décision du testeur : aucun banc ne lit plus un dossier qu'il remplit à la main. Une garde s'écrit par ce qu'elle AUTORISE :
// les fichiers de v2/test/ ne nomment que (a) des fichiers suivis du dépôt, (b) le dossier temporaire, (c) .banc-local\cache-mongod par MONGOMS_DOWNLOAD_DIR,
// et (d) les EXCEPTIONS ci-dessous, nommées une à une avec leur raison. Tout dossier absolu du Bureau hors de cette liste fait échouer la garde,
// et tout nom de dossier d'apports (liste INTERDITS) aussi, où qu'il apparaisse dans un test-*.js, un _*.js ou un sous-dossier .js (sauf ce fichier).
const fs = require('fs'); const path = require('path');
const H = require('./_harnais');

const INTERDITS = ['Logo FR', 'apport-manuel', 'Logo JP', 'Logo ZH', 'verrou\\photos', 'verrou/photos', 'verrou\\\\photos', 'Desktop\\LOGO', 'Desktop\\\\LOGO', 'Desktop/LOGO', 'GABARIT-pokecardex'];
// Dossiers du Bureau qu'un fichier de banc a le droit de nommer : AUCUN n'est un dossier rempli à la main par le testeur.
const EXCEPTIONS = {
    'test-abus-routes.js': { 'extension v2': 'code de l\'extension (dépôt voisin, fausses réponses versionnées) ; le banc se passe du dossier absent', 'pokemon-proxy-api-v2': 'progress.md du plan, lecture seule du journal de lots (RM_PROGRESS)' },
    'test-collection-forme.js': { 'rat-market-site': 'code du site (lib/*.ts), pas un apport manuel (RM_SITE)' },
    'test-contrat-extension.js': { 'extension v2': 'code de l\'extension : fausses réponses versionnées (RM_EXTENSION_FAUSSES)' },
    'test-identifier-adaptateur.js': { 'extension v2': 'code de l\'extension : fausses réponses versionnées' },
    'test-identifier-regle-g.js': { 'labo-embedding': 'fixtures du labo (argument de ligne de commande par défaut)' },
    'test-identifier-regle-g-route.js': { 'labo-embedding': 'fixtures du labo (argument de ligne de commande par défaut)' },
    'mesurer-collection.js': { 'pokemon-proxy': 'outil de mesure (hors lancer-tout) : sauvegarde de lot backup-*, jamais un apport manuel' },
    'mesurer-memoire.js': { 'pokemon-proxy': 'outil de mesure (hors lancer-tout) : sauvegarde de lot backup-* et .banc-local\\cache-mongod (MONGOMS_DOWNLOAD_DIR)' },
    'test-collections-partagees.js': { 'pokemon-proxy': 'COMMENTAIRE seulement : source du relevé épinglé (mesures\\taille-bases.jsonl), jamais lu' },
};
const ELLE_MEME = path.basename(__filename);

// La garde sur du texte : renvoie la liste des fautes. Exportée en interne pour être jouée sur des états fabriqués.
function juger(nom, texte, exceptions = EXCEPTIONS) {
    const fautes = [];
    for (const i of INTERDITS) if (texte.includes(i)) fautes.push(`${nom} nomme « ${i} »`);
    for (const m of texte.matchAll(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/'"\s]+[\\/]+Desktop[\\/]+([^\\/'"]+)/g)) {
        if (!Object.hasOwn(exceptions[nom] || {}, m[1])) fautes.push(`${nom} nomme le dossier du Bureau « ${m[1]} », hors des exceptions nommées`);
    }
    if (/symlinkSync|'junction'|"junction"/.test(texte)) fautes.push(`${nom} crée une jonction ou un lien`);
    return fautes;
}

const lister = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : lister(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
const fichiers = lister(__dirname).filter(f => path.basename(f) !== ELLE_MEME);
H.v('la garde lit des fichiers de banc (dénominateur > 30)', fichiers.length > 30, true);
const fautes = fichiers.flatMap(f => juger(path.basename(f), fs.readFileSync(f, 'utf8')));
H.v(`aucun des ${fichiers.length} fichiers JS de v2/test ne nomme un dossier d'apports, un dossier du Bureau hors exceptions, ni ne crée de jonction`, fautes, []);

// SAIT-ELLE REFUSER ? états fabriqués : chacun doit être refusé, et un fichier sain ne doit pas l'être.
H.v('refuse « Logo FR » dans un chemin', juger('x.js', "path.join(R, 'Logo FR', 'WCD')").length, 1);
H.v('refuse apport-manuel', juger('x.js', "'apport-manuel/Deck JP'").length, 1);
H.v('refuse Logo JP, Logo ZH, verrou\\photos et GABARIT-pokecardex', ['Logo JP', 'Logo ZH', 'verrou\\photos', 'GABARIT-pokecardex'].map(n => juger('x.js', `a ${n} b`).length), [1, 1, 1, 1]);
H.v('refuse Desktop\\LOGO', juger('x.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\LOGO\\\\a.png'").length >= 1, true);
H.v('refuse un dossier du Bureau inconnu', juger('x.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\inconnu\\\\a'").length, 1);
H.v('refuse une jonction', juger('x.js', "fs.symlinkSync(a, b, 'junction')").length, 1);
H.v('une exception nommée passe, pour son fichier seulement', [juger('test-collection-forme.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\rat-market-site'").length, juger('autre.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\rat-market-site'").length], [0, 1]);
H.v('un fichier sain passe', juger('x.js', "path.join(__dirname, 'fixtures', 'a.json')"), []);
H.bilan();
