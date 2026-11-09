'use strict';
// VÉRIFIER-ABSENCE-PARCOURS — la condition de l'éditeur, lue STRICTEMENT : « l'exemption et la route d'administration des parcours du site sont ABSENTES du code servi en production ».
//   node outils/verifier-absence-parcours.js <dossier>                         vérifie un arbre (par exemple le commit de production à la bascule) : OUI (code 0) ou NON (code 1)
//   node outils/verifier-absence-parcours.js --deriver <source> <destination>  DÉRIVE l'arbre de production (étape de bascule, fonction unique `deriver`) puis le vérifie
// Écrite par ce qu'elle AUTORISE : l'arbre passe seulement si TOUT ceci est vrai —
//   · `<dossier>/v2` existe, se lit, n'est pas un lien ;
//   · sous `v2/` (node_modules seul sauté), AUCUN élément nommé « essai-parcours », à n'importe quelle profondeur ;
//   · sous `v2/`, AUCUN lien symbolique ni jonction (une faute, jamais un saut silencieux) ;
//   · aucun fichier JavaScript de `v2/` (hors `v2/test`) ni de la racine du dossier ne porte une SIGNATURE de contenu de l'exemption ou de la route (le NOM d'un dossier ne prouve rien : un module copié sous un
//     autre nom donne NON), sauf les couples (fichier, signature) de la table fermée USAGES_TOLERES.
// Tout le reste échoue, y compris ce qu'on ne sait pas lire. Sortie : les CHEMINS fautifs, jamais un contenu. Lecture seule (sauf `deriver`, qui n'écrit que sa destination).
// SCANNÉ : `v2/` (hors `v2/test`), `collecte-cartes/` et `ratmarket/` (v2 les charge), les fichiers JS de la racine. NON SCANNÉ, dit ici pour qu'on ne le croie pas couvert : `outils/`, `rapports/`, tout autre dossier de la racine,
// les fichiers non JavaScript (JSON, Markdown), et tout code qui construirait une signature par concaténation de chaînes.
const fs = require('fs'), path = require('path');
const MOTIF = 'essai-parcours';
const MARQUE_DEBUT = '// >>> PARCOURS-SITE-DEBUT', MARQUE_FIN = '// <<< PARCOURS-SITE-FIN';
const SIGNATURES = Object.freeze([MOTIF, '/api/essai/lien-confirmation', 'v2_essai_adresses_mesure', 'x-rat-market-mesure', 'v2_secret_mesure']);   // comparées en minuscules
// TABLE FERMÉE des usages légitimes : des outils CLIENTS (ils envoient le secret, ils ne dispensent de rien). Chaque couple est écrit à la main avec sa raison ; rien d'autre ne passe.
const USAGES_TOLERES = Object.freeze([
    { fichier: 'v2/admin/abonnements/parcours-test.js', signatures: ['v2_secret_mesure', 'x-rat-market-mesure', 'v2_essai_adresses_mesure'],
      raison: 'outil en ligne de commande côté client : lit V2_SECRET_MESURE dans l\'environnement de l\'opérateur, l\'envoie en en-tête à l\'essai ; nomme V2_ESSAI_ADRESSES_MESURE dans ses messages. Aucune décision de dispense.' },
    { fichier: 'v2/mesures/connexion-essai.js', signatures: ['v2_secret_mesure', 'x-rat-market-mesure'],
      raison: 'outil de mesure côté client (série, juge en un clic) : lit V2_SECRET_MESURE chez l\'opérateur et pose l\'en-tête sur sa requête de connexion. Aucune décision de dispense.' }
]);
const toleree = (fichier, signature) => USAGES_TOLERES.some(u => u.fichier === fichier && u.signatures.includes(signature));
const EST_JS = /\.(?:js|cjs|mjs)$/;
const DOSSIERS_SERVIS = Object.freeze(['collecte-cartes', 'ratmarket']);   // hors v2/, mais chargés par v2 (v2/db.js, v2/identifier/…) : scannés et copiés avec lui

function signaturesDe(fichierRel, chemin, fautes) {
    let texte; try { texte = fs.readFileSync(chemin, 'utf8').toLowerCase(); } catch { fautes.push(`${fichierRel} illisible`); return; }
    for (const s of SIGNATURES) if (texte.includes(s) && !toleree(fichierRel, s)) fautes.push(`${fichierRel} porte la signature « ${s} »`);
}

/** → { ok: boolean, fautes: string[] } */
function verifier(dossier) {
    const fautes = [];
    if (typeof dossier !== 'string' || !dossier) return { ok: false, fautes: ['dossier non donné'] };
    const v2 = path.join(dossier, 'v2');
    try {
        const l = fs.lstatSync(v2);
        if (l.isSymbolicLink()) return { ok: false, fautes: ['v2 est un lien symbolique ou une jonction'] };
        if (!l.isDirectory()) return { ok: false, fautes: ['v2 n\'est pas un dossier'] };
    } catch { return { ok: false, fautes: ['v2 introuvable ou illisible : arbre non vérifiable'] }; }
    // la racine : les fichiers JS servis (index.js, …), non récursif
    try { for (const e of fs.readdirSync(dossier, { withFileTypes: true })) if (e.isFile() && EST_JS.test(e.name)) signaturesDe(e.name, path.join(dossier, e.name), fautes); }
    catch { fautes.push('racine illisible'); }
    // `v2/` (v2/test : noms et liens contrôlés, contenu non lu) puis `collecte-cartes/`, que v2 charge (v2/db.js, chargeur/…) : c'est du code servi aussi
    const marcher = (d, base, rel, dansTest) => {
        let entrees; try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { fautes.push(`${base}${rel ? `/${rel}` : ''} illisible`); return; }
        for (const e of entrees) {
            const r = rel ? `${rel}/${e.name}` : e.name, complet = `${base}/${r}`;
            if (e.isSymbolicLink()) { fautes.push(`${complet} est un lien symbolique ou une jonction (jamais suivi)`); continue; }
            if (e.name === MOTIF) { fautes.push(`${complet} porte le nom ${MOTIF}`); continue; }
            if (e.isDirectory()) { if (e.name !== 'node_modules') marcher(path.join(d, e.name), base, r, dansTest || (base === 'v2' && r === 'test')); }
            else if (!dansTest && EST_JS.test(e.name)) signaturesDe(complet, path.join(d, e.name), fautes);
        }
    };
    marcher(v2, 'v2', '', false);
    for (const nom of DOSSIERS_SERVIS) {
        const chemin = path.join(dossier, nom);
        try { const l = fs.lstatSync(chemin); if (l.isSymbolicLink()) fautes.push(`${nom} est un lien symbolique ou une jonction (jamais suivi)`); else if (l.isDirectory()) marcher(chemin, nom, '', false); } catch { /* absent : rien à lire */ }
    }
    return { ok: fautes.length === 0, fautes };
}

/** Copie récursive de `v2` sans test/, node_modules/, ni élément nommé MOTIF ; un lien est une erreur (jamais suivi). `retire` reçoit ce qui a été écarté. */
function copierV2(src, dest, rel, retire) {
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isSymbolicLink()) throw new Error(`lien symbolique ou jonction dans la source : v2/${r} (refus, rien n'est suivi)`);
        if (e.name === MOTIF) { retire.push(`v2/${r}`); continue; }
        if (e.isDirectory()) { if (e.name === 'node_modules' || r === 'test') { retire.push(`v2/${r}`); continue; } copierV2(path.join(src, e.name), path.join(dest, e.name), r, retire); }
        else fs.copyFileSync(path.join(src, e.name), path.join(dest, e.name));
    }
}

/** Le texte de config.js d'un arbre de production : le bloc balisé est REMPLACÉ par un `mesure` inerte. Deux marqueurs exigés, une seule fois chacun, dans l'ordre. */
function configDeProduction(texte) {
    const lignes = texte.split(/\r?\n/), d = [], f = [];
    lignes.forEach((l, i) => { if (l.trim().startsWith(MARQUE_DEBUT)) d.push(i); if (l.trim().startsWith(MARQUE_FIN)) f.push(i); });
    if (d.length !== 1 || f.length !== 1 || d[0] > f[0]) throw new Error('config.js : les deux marqueurs PARCOURS-SITE (début et fin) sont exigés, une seule fois chacun, dans l\'ordre : refus de deviner');
    const fin = texte.includes('\r\n') ? '\r\n' : '\n';
    return [...lignes.slice(0, d[0]), "    const mesure = { actif: false, raison: 'production' };", ...lignes.slice(f[0] + 1)].join(fin);
}

/**
 * LA DÉRIVATION DE L'ARBRE DE PRODUCTION — fonction unique, et c'est l'étape de bascule. Copie `<source>/v2` dans `<destination>/v2` SANS : le dossier du module (à toute profondeur), v2/test, node_modules ;
 * remplace le bloc balisé de v2/config.js par un `mesure` inerte. Refuse (sans rien écrire) si config.js n'a pas ses marqueurs ou si la source contient un lien ; la destination ne doit pas exister.
 * → { destination, retire: string[] }
 */
function deriver(source, destination) {
    if (typeof source !== 'string' || typeof destination !== 'string' || !source || !destination) throw new Error('source et destination exigées');
    if (path.resolve(source) === path.resolve(destination)) throw new Error('la destination est la source : la dérivation écrit un arbre NEUF, jamais en place');
    if (fs.existsSync(destination)) throw new Error('la destination existe déjà : refus de mélanger');
    const configSource = path.join(source, 'v2', 'config.js');
    let texte; try { texte = fs.readFileSync(configSource, 'utf8'); } catch { throw new Error('v2/config.js illisible dans la source'); }
    const config = configDeProduction(texte);   // lève AVANT toute écriture
    const retire = [];
    try { copierV2(path.join(source, 'v2'), path.join(destination, 'v2'), '', retire); }
    catch (e) { throw new Error(`dérivation interrompue (${e.message}) ; la destination partielle est à retirer à la main`); }
    for (const nom of DOSSIERS_SERVIS) {   // v2 les charge (v2/db.js → collecte-cartes, identifier/… → ratmarket) : ils font partie du code servi
        const src = path.join(source, nom); let existe = false; try { existe = fs.lstatSync(src).isDirectory(); } catch { /* absent */ }
        if (!existe) continue;
        const r2 = []; try { copierV2(src, path.join(destination, nom), '', r2); } catch (e) { throw new Error(`dérivation interrompue (${e.message}) ; la destination partielle est à retirer à la main`); }
        r2.forEach(x => retire.push(x.replace(/^v2\//, `${nom}/`)));
    }
    fs.writeFileSync(path.join(destination, 'v2', 'config.js'), config);
    retire.push('v2/config.js (bloc PARCOURS-SITE)');
    for (const e of fs.readdirSync(source, { withFileTypes: true })) if (e.isFile() && (EST_JS.test(e.name) || /\.json$/.test(e.name)) && e.name !== 'package-lock.json') fs.copyFileSync(path.join(source, e.name), path.join(destination, e.name));
    return { destination, retire };
}
module.exports = { verifier, deriver, configDeProduction, USAGES_TOLERES, SIGNATURES, MOTIF };

if (require.main === module) {
    const arg = process.argv.slice(2);
    let cible = arg[0];
    if (arg[0] === '--deriver') {
        try { const d = deriver(arg[1], arg[2]); console.log(`Dérivé : ${d.destination}`); for (const r of d.retire) console.log(`  retiré : ${r}`); cible = arg[2]; }
        catch (e) { console.log(`REFUS : ${e.message}`); process.exit(1); }
    }
    const r = verifier(cible);
    if (r.ok) { console.log('OUI : ni le dossier, ni signature de l\'exemption ou de la route d\'administration sous v2/ (hors v2/test) et à la racine ; aucun lien.'); process.exit(0); }
    console.log(`NON : ${r.fautes.length} faute(s)`); for (const f of r.fautes) console.log(`  - ${f}`);
    process.exit(1);
}
