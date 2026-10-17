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
    [M, 'le nom ne contredit plus', "return !!c.nom && nomNorm(c.nom) === nomNorm(t.carte.nomEn);", "return true;", TP],
    [M, 'une lettre se lit sans nom unique', "if (!chezNous || chezNous.size !== 1 || !chezNous.has(t.carte._id)) {", "if (false) {", TP],
    [M, 'la base du numéro ne retire plus la lettre', "k.replace(/(\\d)[A-Z]+$/, '$1')", "k", TP],
    [M, 'une image correcte est remplacée par une équivalente', "if (raisons.some(r => r === null)) { reste(t, 'deja-servi'); continue; }", "", TP],
    [M, 'seuil « nettement plus grande » à 1', "const PLUS_GRANDE = 1.5;", "const PLUS_GRANDE = 0.1;", TP],
    [M, 'clé R2 non neutre', "`pdt/${slugSet}/${cleNum(numero)}", "`pokedata/${slugSet}/${cleNum(numero)}", TP],
    [M, 'retirable: false', "retirable: true, lot: LOT", "retirable: false, lot: LOT", TP],
    [M, 'la langue nomme la source', "visuel pleine taille d\\'un set déclaré anglais par la source,", "visuel pokedata,", TP],
    [M, 'le slug MCD145 lu comme un numéro', "segs.length > 1 && /^\\d+$/.test(segs.at(-1))", "/\\d+$/.test(segs.at(-1))", TP],
    [M, 'planRetrait ne filtre plus le lot', "const duLot = e => e?.source === SOURCE && e.lot === LOT;", "const duLot = e => e?.source === SOURCE;", TP],
    [K, '401 n\'arrête plus', "[401, 403, 410, 429].includes(r.status)", "[403, 410, 429].includes(r.status)", TC],
    [K, '410 n\'arrête plus', "[401, 403, 410, 429].includes(r.status)", "[401, 403, 429].includes(r.status)", TC],
    [K, 'les 3xx n\'arrêtent plus', "|| (r.status >= 300 && r.status < 400) || !!r.cfMitigated", "|| !!r.cfMitigated", TC],
    [K, 'le plancher de cadence disparaît', "Math.max(cadenceMs, P.CADENCE_MIN_MS)", "cadenceMs", TC],
    [K, 'le fichier d\'arrêt ne bloque plus', "if (fs.existsSync(fichierArret(dossierCache))) return", "if (false) return", TC],
    [K, 'le dos de carte est gardé', "if (P.estDosDeCarte(r.octets)) {", "if (false) {", TC],
    [K, 'la forme inattendue est gardée', "if (ratio < RATIO_MIN || ratio > RATIO_MAX) {", "if (false) {", TC],
    [K, 'les octets non WebP sont acceptés', "if (!WEBP_OK(r.octets)) return arret", "if (false) return arret", TC],
    [K, 'une réponse non HTML est acceptée comme page', "if (!/html/i.test(r.type || '') || typeof r.texte !== 'string' || !/<html/i.test(r.texte)) return arret", "if (false) return arret", TC],
    [K, 'le garde de l\'hôte du transport disparaît', "if (url !== robotsDe(genre) && !GENRES[genre].valide(url)) throw", "if (false) throw", TC],
    [K, '--attendu n\'est plus vérifié', "if (attendu != null && attendu !== reel) {", "if (false) {", TC],
    [K, '--remplacer accepte un idProduct inconnu', "if (inconnus.length) {", "if (false) {", TC],
    [K, 'le seuil de largeur disparaît (vrai)', "petit: !meta.width || meta.width < seuil", "petit: false", TC],
    [K, 'un autre tirage que l\'occidental est accepté', "if ((set.tirage ?? set.region) !== 'intl') {", "if (false) {", TC],
    [K, 'une image d\'une autre source cède plus', "if (T.dejaServi({ images: admises }, slug, im.numero ?? null)) {", "if (false) {", TC],
    // ── correction 1 : la construction directe et l'échantillon
    [M, 'construire : plus de zéros à gauche', "brut.padStart(3, '0')", "brut", TP],
    [M, 'construire : le suffixe « a » disparaît', "'Trick or Trade 2024': 'a'", "'Trick or Trade 2024': ''", TP],
    [M, 'construire : le suffixe « a » est posé partout', "${SUFFIXE_PAR_SET[nomSet] ?? ''}", "a", TP],
    [M, 'construire : un set hors de la liste anglaise est construit', "if (!SETS_ANGLAIS.includes(nomSet)) return { motif: 'set-hors-liste' };", "", TP],
    [M, 'construire : un numéro à préfixe est deviné (les deux gardes cassées)', ["(/^\\d{1,4}$/.test(fiche) ? fiche : null)", "fiche", "if (brut == null || !/^\\d{1,4}$/.test(brut)) return", "if (brut == null) return"], null, TP],
    [M, 'échantillon : non réparti (tout dans le premier set)', "for (const g of groupes.values()) if (tour < g.length && choix.length < n && !vus.has(g[tour].url)) {", "for (const g of groupes.values()) for (let tour = 0; tour < g.length; tour++) if (choix.length < n && !vus.has(g[tour].url)) {", TP],
    [M, 'échantillon : graine ignorée', "let a = graine >>> 0;", "let a = 12345;", TP],
    [K, 'robotsDejaLu : une lecture non-404 dispense aussi', "const sansRobots = robotsDejaLu?.status === 404;", "const sansRobots = !!robotsDejaLu;", TC],
    [K, 'robotsDejaLu : l\'échantillon relit robots.txt', "robotsDejaLu: ROBOTS_LU });", "});", TC],
    [K, 'taux : les 404 comptent comme des réponses', "if (s === 'ok') t.repondent++;", "if (s === 'ok' || s === 'absent') t.repondent++;", TC],
    [K, 'planche : plus d\'étiquette de notre fiche', "const ligne1 = `${u.ligne} ${u.numeroReleve}`, ligne2 = `fiche : ${u.nomEn ?? '?'}`;", "const ligne1 = `${u.ligne} ${u.numeroReleve}`, ligne2 = '';", TC],
    [K, 'CLI : --construit seul accepté', "const construitMal = args.includes('--construit') && !modes.some", "const construitMal = false && !modes.some", TC],
    [RC, 'récepteur : une adresse d\'image hors règle est acceptée', "if (!P.urlImageValide(c.img)) return non(422,", "if (false) return non(422,", TR],
    [RC, 'récepteur : une image d\'un autre set est acceptée', "!== o.set) return non(422, `carte ${i} : l'image", "=== 'x') return non(422, `carte ${i} : l'image", TR],
    [RC, 'récepteur : la marque n\'est plus exigée', "if (req.headers[ENTETE_MARQUE.toLowerCase()] !== VALEUR_MARQUE) return", "if (false) return", TR],
    [RC, 'récepteur : toute origine acceptée', "if (origine !== undefined && origine !== ORIGINE_SITE && !ORIGINE_EXTENSION.test(origine)) return", "if (false) return", TR],
    [RC, 'récepteur : le Host n\'est plus contrôlé', "if (!/^(127\\.0\\.0\\.1|localhost):\\d+$/.test(hote)) return", "if (false) return", TR],
    [RC, 'récepteur : le corps n\'est pas borné', "if (taille > CORPS_MAX_OCTETS) trop = true; else morceaux.push(c);", "morceaux.push(c);", TR],
    [US, 'userscript : la vignette _240w n\'est plus ramenée à la pleine taille', "String(src || '').replace(/_240w(?=\\.webp)/, '')", "String(src || '')", TR],
    [US, 'userscript : navigation automatique', "bouton.addEventListener('click', envoyer);", "bouton.addEventListener('click', envoyer); location.href = RECEPTEUR;", TR],
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
