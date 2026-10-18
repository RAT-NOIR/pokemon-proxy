// node mutants-pokedata.js — les MUTANTS : chaque garde est cassée à tour de rôle (copie en mémoire, fichier restauré dans un finally) ; le banc concerné DOIT échouer.
// Un mutant qui survit est une garde que le banc ne garde pas.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const M = 'collecte-cartes/pokedata.js', K = 'collecteur-images-pokedata.js', R = 'retirer-visuels-pokedata.js';
const TP = 'test-pokedata.js', TC = 'test-collecteur-pokedata.js', TR = 'test-recepteur-pokedata.js', RC = 'recepteur-pokedata.js', US = 'userscript-pokedata.user.js';
const mutants = [
    // (deux couches contre _240w : la garde explicite ET le jeu de caractères du nom de fichier ; un mutant qui n'en casse qu'une survit par construction — il faut casser les deux)
    [M, 'URL image : _240w accepté (garde explicite ET jeu de caractères du fichier cassés)', ["/\\.\\.|\\\\|_240w/i.test(url)) return false;", "/\\.\\./.test(url)) return false;", "([A-Za-z0-9-]{1,12})\\.webp$/", "([A-Za-z0-9_-]{1,20})\\.webp$/"], null, TP],
    [M, 'URL image : n\'importe quel hôte', "u.hostname !== HOTE_IMAGES || u.port", "u.hostname === '' || u.port", TP],
    [M, 'URL image : set hors table accepté', "return !!m && nomDeSegment(m[1]) !== null;\n}\n/** Une adresse de PAGE", "return !!m;\n}\n/** Une adresse de PAGE", TP],
    [M, 'URL page : set hors table accepté', "return !!m && nomDeSegment(m[1], NOMS_UTILES) !== null;\n}\nconst urlPageDuSet", "return !!m;\n}\nconst urlPageDuSet", TP],
    [M, 'URL page : paramètres acceptés', "if (u.protocol !== 'https:' || u.hostname !== HOTE_PAGES || u.port || u.username || u.password || u.search || u.hash) return false;", "if (u.protocol !== 'https:' || u.hostname !== HOTE_PAGES) return false;", TP],
    [M, 'le nom ne contredit plus', "return nomNorm(c.nom) === fiche", "return true", TP],
    [M, 'une lettre se lit sans nom unique', "if (!chezNous || chezNous.size !== 1 || !chezNous.has(t.carte._id)) {", "if (false) {", TP],
    [M, 'la base du numéro ne retire plus la lettre', "k.replace(/(\\d)[A-Z]+$/, '$1')", "k", TP],
    [M, 'une image correcte est remplacée par une équivalente', "if (raisons.some(r => r === null)) { reste(t, 'deja-servi'); continue; }", "", TP],
    [M, 'seuil « nettement plus grande » à 1', "const PLUS_GRANDE = 1.5;", "const PLUS_GRANDE = 0.1;", TP],
    [M, 'clé R2 non neutre', "`pdt/${slugSet}/${cleNum(numero)}", "`pokedata/${slugSet}/${cleNum(numero)}", TP],
    [M, 'retirable: false', "retirable: true, lot: LOT", "retirable: false, lot: LOT", TP],
    [M, 'la langue nomme la source', "visuel pleine taille d\\'un set déclaré anglais par la source,", "visuel pokedata,", TP],
    [M, 'le slug MCD145 lu comme un numéro', "segs.length > 1 && /^\\d+$/.test(segs.at(-1))", "/\\d+$/.test(segs.at(-1))", TP],
    [M, 'planRetrait ne filtre plus le lot', "const duLot = e => e?.source === SOURCE && e.lot === LOT;", "const duLot = e => e?.source === SOURCE;", TP],
    [K, 'telecharger ne passe plus par la règle commune (traiterImage)', "const x = RH.traiterImage(r, { suivi, hote: hoteImages, url, dossierPauses, connues });", "const x = { action: 'absente', issue: 'absente', motif: 'x' };", TC],
    [K, 'l\'arrêt durable de l\'hôte n\'est plus lu (garderHote)', "try { RH.garderHote(hoteImages, dossierPauses, suivi); }", "try { /* rien */ }", TC],
    [K, 'l\'arrêt durable de l\'hôte n\'est plus posé', "posterArret(url, motif); for", "for", TC],
    [K, 'la fausse absence récente est redemandée', "&& !RH.fausseAbsenceRecente(index.images[u], now())", "", TC],
    [K, 'une absence ne passe plus par entreeAbsence (seconde fois)', "index.images[url] = RH.entreeAbsence(index.images[url], x, r.status, now());", "index.images[url] = { statut: 'absent', status: r.status, le: new Date().toISOString() };", TC],
    [M, 'le nom relevé n\'est plus dépouillé du numéro ni de la variante', "|| nomNorm(nomDepouille(c.nom, c.numero)) === fiche;", "|| false;", TP],
    [M, 'une reverse peut être retenue', "const normales = parBase.filter(c => !estReverse(c));", "const normales = parBase;", TP],
    [M, 'le dernier mot n\'est plus comparé au numéro sans zéros de tête', "const sansZeros = s => String(s).toLowerCase().replace(/^0+(?=\\d)/, '');", "const sansZeros = s => String(s).toLowerCase();", TP],
    [M, 'un numéro différent dans le nom est retiré', "if (dernier != null && num != null && (dernier === num || dernier === numSansR)) mots", "if (dernier != null && /^\\d+r?$/.test(dernier)) mots", TP],
    [RC, 'le récepteur ne journalise plus le relevé reçu', "journal(`reçu : ${o.set}", "(() => {})(`reçu : ${o.set}", TR],
    [RC, 'le récepteur recopie le contenu du corps dans le refus', "journal(`refusé : HTTP ${statut} — ${categorie}`)", "journal(`refusé : HTTP ${statut} — ${texte}`)", TR],
    [M, 'la source nomme l\'hôte (champ lu par le site)', "const SOURCE = 'pdt';", "const SOURCE = 'pokedata';", TP],
    [M, 'le lot nomme l\'hôte', "const LOT = 'pdt-2026-10';", "const LOT = 'pokedata-2026-10';", TP],
    [K, 'le plancher de cadence disparaît', "Math.max(cadenceMs, P.CADENCE_MIN_MS)", "cadenceMs", TC],
    [K, 'le dos de carte est gardé', "if (P.estDosDeCarte(r.octets)) {", "if (false) {", TC],
    [K, 'la forme inattendue est gardée', "if (ratio < RATIO_MIN || ratio > RATIO_MAX) {", "if (false) {", TC],
    [K, 'les octets non WebP sont acceptés', "if (!WEBP_OK(r.octets)) {", "if (false) {", TC],
    [K, 'le garde de l\'hôte du transport disparaît', "if (url !== robotsDe(genre) && !GENRES[genre].valide(url)) throw", "if (false) throw", TC],
    [K, '--attendu n\'est plus vérifié', "if (attendu != null && attendu !== reel) {", "if (false) {", TC],
    [K, '--remplacer accepte un idProduct inconnu', "if (inconnus.length) {", "if (false) {", TC],
    [K, 'le seuil de largeur disparaît (vrai)', "petit: !meta.width || meta.width < seuil", "petit: false", TC],
    [K, 'un autre tirage que l\'occidental est accepté', "if ((set.tirage ?? set.region) !== 'intl') {", "if (false) {", TC],
    [K, 'une image d\'une autre source cède plus', "if (T.dejaServi({ images: admises }, slug, im.numero ?? null)) {", "if (false) {", TC],
    // ── correction 1 : la construction directe et l'échantillon
    [K, 'planche : plus d\'étiquette de notre fiche', "const ligne1 = `${u.ligne} ${u.numeroReleve}`, ligne2 = `fiche : ${u.nomEn ?? '?'}`;", "const ligne1 = `${u.ligne} ${u.numeroReleve}`, ligne2 = '';", TC],
    [RC, 'récepteur : une adresse d\'image hors règle est acceptée', "if (!P.urlImageValide(c.img)) return non(422,", "if (false) return non(422,", TR],
    [RC, 'récepteur : une image d\'un autre set est acceptée', "!== o.set) return non(422, `carte ${i} : l'image", "=== 'x') return non(422, `carte ${i} : l'image", TR],
    [RC, 'récepteur : la marque n\'est plus exigée', "if (req.headers[ENTETE_MARQUE.toLowerCase()] !== VALEUR_MARQUE) return", "if (false) return", TR],
    [RC, 'récepteur : toute origine acceptée', "if (origine !== undefined && origine !== ORIGINE_SITE && !ORIGINE_EXTENSION.test(origine)) return", "if (false) return", TR],
    [RC, 'récepteur : le Host n\'est plus contrôlé', "if (!/^(127\\.0\\.0\\.1|localhost):\\d+$/.test(hote)) return", "if (false) return", TR],
    [RC, 'récepteur : le corps n\'est pas borné', "if (taille > CORPS_MAX_OCTETS) trop = true; else morceaux.push(c);", "morceaux.push(c);", TR],
    [US, 'userscript : la vignette _240w n\'est plus ramenée à la pleine taille', "String(src || '').replace(/_240w(?=\\.webp)/, '')", "String(src || '')", TR],
    [US, 'userscript : navigation automatique', "bouton.addEventListener('click', envoyer);", "bouton.addEventListener('click', envoyer); location.href = RECEPTEUR;", TR],
    // ── correction 2 : profil de garde, relevé borné, construction abandonnée, arrêt fixe, décision isolée
    ['collecte-cartes/garde-userscript-passif.js', 'garde : une @match hors liste est admise', "match: v => (profil.matchs ? profil.matchs.includes(v) : v === profil.match),", "match: v => true,", TR],
    ['collecte-cartes/garde-userscript-passif.js', 'garde : une @match manquante n\'est plus relevée', "if (profil.matchs) for (const m of profil.matchs) if (!matchsVus.includes(m)) v.push(", "if (false) for (const m of profil.matchs) if (!matchsVus.includes(m)) v.push(", TR],
    ['collecte-cartes/garde-userscript-passif.js', 'garde : outerHTML n\'est plus refusé (règle commune relâchée)', "'innerHTML', 'outerHTML', 'insertAdjacentHTML'", "'innerHTML', 'insertAdjacentHTML'", TR],
    ['collecte-cartes/garde-userscript-passif.js', 'garde : setTimeout n\'est plus refusé (règle commune relâchée)', "'scrollIntoView', 'setTimeout', 'setInterval'", "'scrollIntoView', 'setInterval'", TR],
    [RC, 'récepteur : un diag libre (HTML) est accepté', "estChaine(x, 300) && STRUCTURE.test(x)", "estChaine(x, 300)", TR],
    [RC, 'récepteur : la fusion perd l\'ancien relevé', "for (const c of ancien?.cartes ?? []) par.set(c.img, c);", "", TR],
    [RC, 'récepteur : « complet » redescend', "complet: (ancien?.complet === true) || o.diag.complet === true", "complet: o.diag.complet === true", TR],
    [RC, 'récepteur : un numéro contredit n\'est plus marqué', "...(c.numero !== fichier ? { numeroDoute: true } : {})", "", TR],
    [RC, 'récepteur : dossier dans le dépôt accepté', "if (dansLeDepot(dossier)) throw", "if (false) throw", TR],
    [RC, 'récepteur : dossier hors racine accepté', "if (!dansRacineAutorisee(dossier, racine)) throw", "if (false) throw", TR],
    [RC, 'récepteur : dossier d\'apports manuels accepté', "if (dansApportsManuels(dossier)) throw", "if (false) throw", TR],
    [M, 'lireReleves : un numéro douteux est utilisé', "if (c.numeroDoute === true) { douteuses++; continue; }", "", TP],
    [M, 'une fonction de construction est exportée', "    PAGES_A_OUVRIR, SETS_ANGLAIS, segmentDeSet, nomDepouille, estReverse,\n", "    PAGES_A_OUVRIR, SETS_ANGLAIS, segmentDeSet, nomDepouille, estReverse, construire: () => 1,\n", TP],
    [M, 'une adresse d\'image est assemblée par gabarit', "const urlPageDuSet =", "const fabriquer = n => `https://${HOTE_IMAGES}${PREFIXE_CHEMIN}x/${n}.webp`;\nconst urlPageDuSet =", TP],
    [K, 'la ligne de commande accepte --construire', "const AUTORISES = [/^--plan$/,", "const AUTORISES = [/^--construire$/, /^--plan$/,", TC],
    [K, 'le fichier d\'arrêt du dossier de travail n\'est plus lu', "[dossierCache, ARRET_FIXE].map(fichierArret).find", "[ARRET_FIXE].map(fichierArret).find", TC],
    [K, 'l\'arrêt à emplacement fixe n\'est plus lu', "[dossierCache, ARRET_FIXE].map(fichierArret).find", "[dossierCache].map(fichierArret).find", TC],
    [K, 'l\'arrêt n\'est plus écrit à l\'emplacement fixe', "new Set([dossierCache, ARRET_FIXE])", "new Set([dossierCache])", TC],
    // ── correction 3
    [K, 'la ligne de commande accepte de nouveau --releve', "const AUTORISES = [/^--plan$/, /^--telecharger$/,", "const AUTORISES = [/^--plan$/, /^--releve$/, /^--telecharger$/,", TC],
    [K, 'un genre « page » réapparaît', "image: { hote: P.HOTE_IMAGES, valide: P.urlImageValide, index: 'index.json', sous: 'img' }", "image: { hote: P.HOTE_IMAGES, valide: P.urlImageValide, index: 'index.json', sous: 'img' }, page: { hote: P.HOTE_PAGES, valide: P.urlPageValide, index: 'index-pages.json', sous: 'pages' }", TC],
    [K, 'chemins : le dépôt n\'est plus refusé', "if (dansLeDepot(dossier)) throw new Error(`--${nom}", "if (false) throw new Error(`--${nom}", TC],
    [K, 'chemins : la racine n\'est plus exigée', "if (!dansRacineAutorisee(dossier, racine)) throw new Error(`--${nom}", "if (false) throw new Error(`--${nom}", TC],
    [K, 'chemins : les apports manuels ne sont plus refusés', "if (dansApportsManuels(dossier)) throw new Error(`--${nom}", "if (false) throw new Error(`--${nom}", TC],
    [K, 'chemins : le fichier --sortie est jugé tel quel (et non son dossier)', "const dossier = nom === 'sortie' ? path.dirname(p) : p;", "const dossier = p;", TC],
    [K, 'chemins : --releves n\'est plus jugé', "verifierChemins({ cache: dossierCache, releves: dossierReleves, sortie: fichierPlan })", "verifierChemins({ cache: dossierCache, sortie: fichierPlan })", TC],
    [RC, 'récepteur : une erreur interne plante le processus (plus de try)', "} catch (e) { console.error(`récepteur : erreur interne (relevé existant corrompu ?) — ${e.message}`); if (!res.headersSent) fin(500, 'erreur interne : relevé existant illisible'); }", "} finally { }", TR],
    [K, 'le cache altéré est écrit', "if (sha('sha256', buffer) !== e.sha256) {", "if (false) {", TC],
    [K, 'la traçabilité est omise sur l\'entrée', "...P.tracer({ url: im.urlOriginal, le: im.collecteLe }) };", "};", TC],
    [R, 'le retrait ne couvre qu\'un lot', "$pull: { images: { source: P.SOURCE } }", "$pull: { images: { source: P.SOURCE, lot: P.LOT } }", TC],
    [R, 'le retrait écrit par défaut', "if (!ecrire) return plan;", "", TC]
];
let survivants = 0, tues = 0, inapplicables = 0;
for (const [f, nom, de, vers, test] of mutants) {
    const chemin = path.join(__dirname, f);
    const original = fs.readFileSync(chemin, 'utf8');
    const paires = Array.isArray(de) ? [[de[0], de[1]], [de[2], de[3]]] : [[de, vers]];
    const mauvais = paires.filter(([a, b]) => original.split(a).length - 1 !== 1 || a === b);
    if (mauvais.length) { inapplicables++; console.log(`⚠️  INAPPLICABLE : ${nom}`); continue; }
    try {
        let mute = original; for (const [a, b] of paires) mute = mute.replace(a, () => b);
        fs.writeFileSync(chemin, mute);
        const r = spawnSync(process.execPath, [path.join(__dirname, test)], { encoding: 'utf8', cwd: __dirname, env: process.env, timeout: 170000 });
        if (r.status !== 0) { tues++; console.log(`☠️  tué : ${nom}`); } else { survivants++; console.log(`🔴 SURVIVANT : ${nom}`); }
    } finally { fs.writeFileSync(chemin, original); }
}
console.log(`\n${tues} mutant(s) tué(s), ${survivants} survivant(s), ${inapplicables} inapplicable(s) sur ${mutants.length}`);
process.exitCode = survivants || inapplicables ? 1 : 0;
