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
    [R, T, 'garde du groupe de dessin et de top[1] retirée', 'if (d.sur) { const m = gardeVivier(d, liste, p, prods); if (m) d = { sur: false, motif: m }; }', ''],
    [R, T, 'garde : les produits du groupe ne sont plus exigés dans la liste', "for (const pr of lesProduits) if (!Array.isArray(pr) || !liste.includes(pr[0]) || !prods.has(pr[0])) return 'groupe-incomplet';", ''],
    [R, T, 'garde : les produits du groupe n\'ont plus besoin d\'une ligne dans les produits chargés', '|| !liste.includes(pr[0]) || !prods.has(pr[0])) return', '|| !liste.includes(pr[0])) return'],
    [R, T, 'garde : la clé n°1 elle-même n\'est plus à couvrir (ensemble vide sans groupe)', 'let ensemble = [cle];', 'let ensemble = [];'],
    [R, T, 'garde : un groupe qui ne contient pas la clé n°1 est toléré', '|| !membres.includes(cle)) return', ') return'],
    [R, T, 'garde : un top d\'un seul visuel autorise (écart non contrôlé)', "if (top.length < 2) return 'ecart-index';", ''],
    [R, T, 'garde : l\'écart contre top[1] n\'est plus exigé', "if (second && !(d.cosinus - second[1] >= SPI.MARGE)) return 'ecart-index';", ''],
    [RT, TI, 'la route ne passe plus le lecteur de catalogue au vivier', 'charger: cfg.vivierImage === true ? ids => catalogue.lire(ids) : undefined,', '']
];
// le cache du moteur de base de banc vient de l'environnement (MONGOMS_DOWNLOAD_DIR) : absent, le script refuse avant toute mutation
if (!process.env.MONGOMS_DOWNLOAD_DIR) { console.error('❌ ARRÊT : MONGOMS_DOWNLOAD_DIR doit être posé (dossier du cache du moteur de banc)'); process.exit(1); }
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
            const r = spawnSync(process.execPath, [path.join(racine, banc)], { cwd: racine, encoding: 'utf8', timeout: 240000, env: { ...process.env } });
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
