'use strict';
// TESTS-APPORTS (2026-10-13) — décision du testeur : aucun banc ne lit plus un dossier qu'il remplit à la main. Une garde s'écrit par ce qu'elle AUTORISE :
// les fichiers de v2/test/ ne nomment que (a) des fichiers suivis du dépôt, (b) le dossier temporaire, (c) .banc-local\cache-mongod par MONGOMS_DOWNLOAD_DIR,
// et (d) les EXCEPTIONS ci-dessous, nommées une à une (fichier, chemin) avec leur raison.
// PORTÉE, dite honnêtement : cette garde voit les NOMS et les CHEMINS ÉCRITS EN TOUTES LETTRES dans les fichiers de banc (.js, .mjs, .cjs, .json de v2/test/,
// hors le dossier fixtures/ qui ne porte que des données figées). Elle ne voit NI un chemin construit (path.join(…, '..', …), os.homedir()…), NI une
// lecture faite par du code de production que les bancs chargent.
const fs = require('fs'); const path = require('path');
const H = require('./_harnais');

// La liste des dossiers d'apports (INTERDITS) et les exceptions nommées fichier par fichier (EXCEPTIONS) vivent dans _apports-exceptions.js : l'ESPION des lectures de fichiers (_espion-fs.js) lit la MÊME définition.
const { INTERDITS, EXCEPTIONS } = require('./_apports-exceptions');
const ELLE_MEME = path.basename(__filename), LISTE = '_apports-exceptions.js';   // la liste partagée NOMME les dossiers interdits (c'est sa fonction) : elle est la définition, pas un usage
const sep = t => t.replace(/[\\/]+/g, '/');

// La garde sur du texte : renvoie la liste des fautes. Jouée aussi sur des états fabriqués.
function juger(nom, texte, exceptions = EXCEPTIONS) {
    const fautes = [], t = sep(texte), bas = t.toLowerCase();
    for (const i of INTERDITS) if (bas.includes(i.toLowerCase())) fautes.push(`${nom} nomme « ${i} »`);
    for (const m of t.matchAll(/[A-Za-z]:\/Users\/[^/'"]+\/Desktop\/([^'"\n(,]+)/g)) {
        const chemin = m[1].trim().toLowerCase();
        // chemin exact de l'exception, ou un sous-chemin de lui (jamais l'inverse : le dossier parent n'est pas permis)
        const permis = Object.keys(exceptions[nom] || {}).some(e => { const x = e.toLowerCase(); return chemin === x || chemin.startsWith(x + '/'); });
        if (!permis) fautes.push(`${nom} nomme le chemin du Bureau « ${m[1].trim()} », hors des exceptions nommées`);
    }
    if (/symlinkSync|'junction'|"junction"/.test(texte)) fautes.push(`${nom} crée une jonction ou un lien`);
    return fautes;
}

const EXT = /\.(js|mjs|cjs|json)$/;
const lister = (d, racine = true) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? ((e.name === 'node_modules' || (racine && e.name === 'fixtures')) ? [] : lister(path.join(d, e.name), false))
    : EXT.test(e.name) ? [path.join(d, e.name)] : []);
// fixtures/ ne porte que des données figées (référence gelée, table synthétique) — mais ses .js (le générateur) sont lus
const fixturesJs = fs.readdirSync(path.join(__dirname, 'fixtures')).filter(f => f.endsWith('.js')).map(f => path.join(__dirname, 'fixtures', f));
const fichiers = [...lister(__dirname), ...fixturesJs].filter(f => path.basename(f) !== ELLE_MEME && path.basename(f) !== LISTE);
H.v('la garde lit des fichiers de banc (dénominateur > 30)', fichiers.length > 30, true);
H.v('elle lit aussi des .json de v2/test (hors fixtures/)', fichiers.filter(f => f.endsWith('.json')).length >= 2, true);
const fautes = fichiers.flatMap(f => juger(path.basename(f), fs.readFileSync(f, 'utf8')));
H.v(`aucun des ${fichiers.length} fichiers (js, mjs, cjs, json) de v2/test ne nomme un dossier d'apports, un chemin du Bureau hors exceptions, ni ne crée de jonction`, fautes, []);

// SAIT-ELLE REFUSER ? états fabriqués : chacun doit être refusé, et un fichier sain ne doit pas l'être.
H.v('refuse « Logo FR » dans un chemin', juger('x.js', "path.join(R, 'Logo FR', 'WCD')").length, 1);
H.v('refuse la casse différente : « logo fr », « APPORT-MANUEL »', [juger('x.js', "'logo fr/WCD'").length, juger('x.js', "'APPORT-MANUEL/Deck JP'").length], [1, 1]);
H.v('refuse apport-manuel', juger('x.js', "'apport-manuel/Deck JP'").length, 1);
H.v('refuse Logo JP, Logo ZH, verrou\\photos et GABARIT-pokecardex', ['Logo JP', 'Logo ZH', 'verrou\\photos', 'GABARIT-pokecardex'].map(n => juger('x.js', `a ${n} b`).length), [1, 1, 1, 1]);
H.v('refuse Desktop\\LOGO', juger('x.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\LOGO\\\\a.png'").length >= 1, true);
H.v('refuse un dossier du Bureau inconnu', juger('x.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\inconnu\\\\a'").length, 1);
H.v('refuse une jonction', juger('x.js', "fs.symlinkSync(a, b, 'junction')").length, 1);
H.v('une exception nommée passe, pour son fichier seulement', [juger('test-collection-forme.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\rat-market-site'").length, juger('autre.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\rat-market-site'").length], [0, 1]);
H.v('l\'exception « pokemon-proxy » est un CHEMIN, plus le dossier entier', [
    juger('mesurer-memoire.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\pokemon-proxy\\\\backup-2026-10-10-lot-075226'").length,
    juger('mesurer-memoire.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\pokemon-proxy\\\\autre-dossier-du-testeur'").length,
    juger('mesurer-memoire.js', "'C:\\\\Users\\\\Yung\\\\Desktop\\\\pokemon-proxy'").length], [0, 1, 1]);
H.v('un fichier sain passe', juger('x.js', "path.join(__dirname, 'fixtures', 'a.json')"), []);
// Tour 1 (I-3) : les exceptions sont validées AU CHARGEMENT de la liste partagée (valider) ; une clé vide, « . », « .. », absolue ou dans un dossier d'apports est refusée. La mutation « clé vide » tue ce banc
// (et celui de l'espion) : le module de la liste lève dès son require.
const { valider } = require('./_apports-exceptions');
const refuse = ex => { try { valider(ex, {}); return false; } catch { return true; } };
H.v('une exception à clé vide, « . » ou « .. » est refusée (elle ouvrirait le Bureau entier) ; une clé nommée et raisonnée passe', [refuse({ 'x.js': { '': 'raison' } }), refuse({ 'x.js': { '.': 'raison' } }), refuse({ 'x.js': { '..': 'raison' } }), refuse({ 'x.js': { 'rat-market-site/lib': 'raison' } })], [true, true, true, false]);
H.bilan();
