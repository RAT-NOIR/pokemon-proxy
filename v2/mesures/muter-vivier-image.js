'use strict';
// VIVIER-IMAGE — les MUTANTS : chaque mutation d'une ligne qui porte le vivier élargi doit faire ÉCHOUER un banc (test-vivier-image.js, ou l'intégration test-sur-par-image-integration.js pour le branchement de la route).
//   node v2/mesures/muter-vivier-image.js
// Un mutant = le fichier de production modifié sur place, le temps d'UN banc, puis RESTAURÉ à l'octet (contrôle de l'empreinte avant et après, y compris si le banc plante). Hors suite (lancer-tout ne l'exécute pas : pas de test-*).
// Un mutant qui survit = une ligne du vivier que rien ne garde.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const racine = path.join(__dirname, '..', '..');
const R = 'v2/identifier/sur-par-image-route.js', C = 'v2/config.js', RT = 'v2/identifier/routes.js';
const T = 'v2/test/test-vivier-image.js', TI = 'v2/test/test-sur-par-image-integration.js';
const MUTANTS = [
    [R, T, 'drapeau ignoré : le vivier est toujours élargi, V2_VIVIER_IMAGE éteint ou non', 'const elargir = cfg.vivierImage === true;', 'const elargir = true;'],
    [C, T, 'drapeau allumé par défaut dans la configuration', "booleen('V2_VIVIER_IMAGE', env.V2_VIVIER_IMAGE, false)", "booleen('V2_VIVIER_IMAGE', env.V2_VIVIER_IMAGE, true)"],
    [R, T, 'top 5 non fusionné : les produits ajoutés sont lus mais ne sont pas jugés', 'liste = [...ids, ...extras];', 'liste = ids;'],
    [R, T, 'dédoublonnage retiré : un produit vu deux fois (ou déjà candidat) est ajouté deux fois', 'if (Number.isInteger(id) && !vus.has(id)) { vus.add(id); extras.push(id); }', 'if (Number.isInteger(id)) { extras.push(id); }'],
    [R, T, 'le top passe de 5 à 6 visuels', 'const K_VIVIER = 5;', 'const K_VIVIER = 6;'],
    [R, T, 'le vivier est élargi même quand la règle d\'avant a tranché', 'if (!d.sur && elargir && p.e0.redressee === true) {', 'if (elargir && p.e0.redressee === true) {'],
    [R, T, 'le vivier est élargi sur une photo non redressée (catalogue lu pour rien)', 'if (!d.sur && elargir && p.e0.redressee === true) {', 'if (!d.sur && elargir) {'],
    [R, T, 'les lignes de catalogue lues ne sont pas jointes aux produits', 'prods = new Map(produits); for (const [k, v] of lignes) prods.set(k, v);', 'prods = produits;'],
    [R, T, 'une panne du catalogue ne ferme plus la question (le motif d\'avant reste)', "else { vivier.charge = false; d = { sur: false, motif: 'vivier-indisponible' }; }", 'else { vivier.charge = false; }'],
    [R, T, 'une question à un seul candidat n\'est jamais relue', 'ids.length < (elargir ? 1 : 2)', 'ids.length < 2'],
    [R, T, 'l\'affirmation du vivier ne passe plus les lignes lues', 'aff = affirmer(d.produit, vivier ? prods : undefined, critere);', 'aff = affirmer(d.produit, undefined, critere);'],
    [R, T, 'le critère journalisé ne nomme plus le périmètre élargi', 'const critere = vivier ? critereVivier(d, vivier) : critereImage(d);', 'const critere = critereImage(d);'],
    [RT, TI, 'la route ne passe plus le lecteur de catalogue au vivier', 'charger: cfg.vivierImage === true ? ids => catalogue.lire(ids) : undefined,', '']
];
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let survivants = 0;
const avant = {};
for (const f of new Set(MUTANTS.map(m => m[0]))) avant[f] = { chemin: path.join(racine, f), octets: fs.readFileSync(path.join(racine, f)), sha: sha(path.join(racine, f)) };
try {
    for (const [fichier, banc, nom, de, vers] of MUTANTS) {
        const a = avant[fichier], src = a.octets.toString('utf8'), n = src.split(de).length - 1;
        if (n !== 1) { console.log(`🔴 mutant non applicable (${n} occurrences de « ${de} ») : ${nom}`); survivants++; continue; }
        try {
            fs.writeFileSync(a.chemin, src.replace(de, () => vers));
            const r = spawnSync(process.execPath, [path.join(racine, banc)], { cwd: racine, encoding: 'utf8', timeout: 240000, env: { ...process.env, MONGOMS_DOWNLOAD_DIR: process.env.MONGOMS_DOWNLOAD_DIR || 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\.banc-local\\cache-mongod' } });
            const tue = r.status !== 0 && /❌/.test(r.stdout || '');                 // tué par une assertion, pas par un plantage sans rapport
            console.log(`${tue ? '✅ tué' : '🔴 SURVIT'} (${path.basename(banc)}) : ${nom}`);
            if (!tue) survivants++;
        } finally { fs.writeFileSync(a.chemin, a.octets); }
    }
} finally {
    for (const [f, a] of Object.entries(avant)) { fs.writeFileSync(a.chemin, a.octets); if (sha(a.chemin) !== a.sha) { console.log(`🔴 ${f} N'EST PAS RESTAURÉ`); survivants++; } }
}
console.log(`${MUTANTS.length - survivants}/${MUTANTS.length} mutants tués`);
process.exit(survivants ? 1 : 0);
