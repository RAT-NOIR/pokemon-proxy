// node mutants-pokedata.js — les MUTANTS : chaque garde est cassée à tour de rôle (copie en mémoire, fichier restauré dans un finally) ; le banc concerné DOIT échouer.
// Un mutant qui survit est une garde que le banc ne garde pas.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const M = 'collecte-cartes/pokedata.js', K = 'collecteur-images-pokedata.js', R = 'retirer-visuels-pokedata.js';
const TP = 'test-pokedata.js', TC = 'test-collecteur-pokedata.js';
const mutants = [
    // (deux couches contre _240w : la garde explicite ET le jeu de caractères du nom de fichier ; un mutant qui n'en casse qu'une survit par construction — il faut casser les deux)
    [M, 'URL image : _240w accepté (garde explicite ET jeu de caractères du fichier cassés)', ["/\\.\\.|\\\\|_240w/i.test(url)) return false;", "/\\.\\./.test(url)) return false;", "([A-Za-z0-9-]{1,12})\\.webp$/", "([A-Za-z0-9_-]{1,20})\\.webp$/"], null, TP],
    [M, 'URL image : n\'importe quel hôte', "u.hostname !== HOTE_IMAGES || u.port", "u.hostname === '' || u.port", TP],
    [M, 'URL image : set hors table accepté', "return !!m && nomDeSegment(m[1]) !== null;\n}\n/** Une adresse de PAGE", "return !!m;\n}\n/** Une adresse de PAGE", TP],
    [M, 'URL page : set hors table accepté', "return !!m && nomDeSegment(m[1]) !== null;\n}\nconst urlPageDuSet", "return !!m;\n}\nconst urlPageDuSet", TP],
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
