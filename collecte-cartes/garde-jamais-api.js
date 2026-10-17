// ============================================================
// LA GARDE STATIQUE « JAMAIS D'API » — le dépôt ne contient aucune adresse d'API pokemontcg.io ni Scrydex (2026-10-17)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « une garde qui fait échouer tout code appelant l'API pokemontcg.io ou Scrydex (seuls les hôtes d'images sont
// permis) ». La moitié exécution est dans collecte-cartes/ptcgio.js (hoteDeLUrl) ; celle-ci lit les fichiers SUIVIS par git (la liste vient de
// `git ls-files`, sans node_modules) et juge chaque mention de `pokemontcg.io` ou de `scrydex.com` par ce qu'elle AUTORISE :
//   · un des deux hôtes d'images (collecte-cartes/hotes-images-ptcgio.js — la liste n'est pas recopiée ici) ;
//   · le NOM nu « pokemontcg.io » / « scrydex.com » dans une phrase ou une valeur (SOURCE = 'pokemontcg.io'), qui n'est pas une adresse :
//     ni précédé de « :// », ni suivi d'un « / ».
// Tout le reste — api.pokemontcg.io, api.scrydex.com, www.scrydex.com, un sous-domaine, un hôte d'images suivi d'un suffixe (« …io.evil.example »),
// une adresse nue avec chemin — est une violation, nommée avec son fichier et sa ligne.
// Portée honnête : le banc lit des TEXTES. Une adresse bâtie à l'exécution par morceaux ne s'y lit pas ; c'est la moitié exécution qui la refuse.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { HOTES_IMAGES } = require('./hotes-images-ptcgio');

const JETON = /[a-z0-9._-]*(?:pokemontcg\.io|scrydex\.com)(?:\.[a-z0-9-]+)*/gi;
const NOMS_NUS = new Set(['pokemontcg.io', 'scrydex.com']);
const ROUTES_API = /^\/(?:v\d+|api|cards|sets|rarities|types|subtypes|supertypes|pokemon\/v\d+)(?![a-z0-9])/i;
const TAILLE_MAX = 20 * 1024 * 1024;

/** Les violations d'un texte : [{ fichier, ligne, jeton }]. */
function analyserTexte(fichier, texte) {
    const violations = [];
    String(texte).split(/\r?\n/).forEach((contenu, i) => {
        for (const m of contenu.matchAll(JETON)) {
            const jeton = m[0].toLowerCase().replace(/\.+$/, '');
            if (HOTES_IMAGES.includes(jeton)) continue;
            if (NOMS_NUS.has(jeton)) {
                const avant = contenu.slice(Math.max(0, m.index - 3), m.index), suite = contenu.slice(m.index + m[0].length);
                // le nom nu dans une phrase ou une valeur (SOURCE = 'pokemontcg.io') n'est pas une adresse ; suivi d'un « / », il peut être un préfixe de clé R2
                // (`pokemontcg.io/Celebrations/…`) : seule exception écrite par ses refus, parce que les deux se ressemblent — un chemin de ROUTE d'API est refusé.
                if (avant !== '://' && !(suite[0] === '/' && ROUTES_API.test(suite))) continue;
            }
            violations.push({ fichier, ligne: i + 1, jeton: m[0] });
        }
    });
    return violations;
}

/** Scanne une liste de fichiers. `lire(f)` rend le texte, ou null pour un fichier qu'on ne lit pas (binaire, trop gros, absent). Lève si rien n'a été lu. */
function scannerFichiers({ liste, lire }) {
    const violations = [];
    let lus = 0, ignores = 0;
    for (const f of liste) {
        if (f.split('/').includes('node_modules')) { ignores++; continue; }
        const texte = lire(f);
        if (texte == null) { ignores++; continue; }
        lus++;
        violations.push(...analyserTexte(f, texte));
    }
    if (!lus) throw new Error(`garde « jamais d'API » : aucun fichier lu sur ${liste.length} — un scan qui ne lit rien ne prouve rien`);
    return { violations, lus, ignores };
}

function trouverGit() {
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return 'git'; } catch { /* git n'est pas dans le PATH ici : GitHub Desktop */ }
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    const versions = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^app-/.test(d)).sort().reverse() : [];
    for (const v of versions) { const g = path.join(base, v, 'resources', 'app', 'git', 'cmd', 'git.exe'); if (fs.existsSync(g)) return g; }
    throw new Error('garde « jamais d\'API » : git introuvable — impossible de lister les fichiers suivis, donc de conclure');
}

/** Scanne les fichiers SUIVIS du dépôt `racine` (git ls-files, sans node_modules). */
function scannerDepot(racine) {
    const sortie = execFileSync(trouverGit(), ['ls-files', '-z'], { cwd: racine, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
    const liste = sortie.split('\0').filter(Boolean);
    return scannerFichiers({
        liste,
        lire: f => {
            let tampon;
            try { const p = path.join(racine, f); if (fs.statSync(p).size > TAILLE_MAX) return null; tampon = fs.readFileSync(p); } catch { return null; }
            return tampon.subarray(0, 8000).includes(0) ? null : tampon.toString('utf8');
        }
    });
}

module.exports = { analyserTexte, scannerFichiers, scannerDepot };
