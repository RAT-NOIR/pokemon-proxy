// ============================================================
// INTÉGRER UN NOUVEL EXPORT CARDMARKET — la procédure, en une commande (2026-09-24)
// ============================================================
//   node integrer-export.js <products_singles_*.json>
//        MESURE, lecture seule : le diff contre `catalogue_produits`, par expansion, et les trois nombres du chantier
//        calculés sur l'EXPORT (pas sur ce que nous avons appris).
//   node integrer-export.js <products_singles_*.json> --ecrire --confirmer-production
//        1. SAUVEGARDE RÉELLE de catalogue_produits, numeros_cartes, codes_set (relue) ;
//        2. IMPORT dans `catalogue_produits` (production) ;
//        3. VÉRIFICATION : le diff relancé doit rendre ZÉRO nouveau, zéro changé ;
//        4. APPRENTISSAGE Cardmarket des expansions touchées (apprendre-set.js : navigateur, 20-45 s par page,
//           Cloudflare peut demander une case) — s'ARRÊTE au premier 1015 et imprime la commande de reprise ;
//        5. imprime la suite, qui ne s'automatise pas encore : lignes de table, texte, commit + déploiement, images.
//
// Quatre ou cinq exports par an : la procédure vit ICI, pas dans une mémoire. Chaque étape est un outil du dépôt, appelé
// tel quel — jamais une copie de sa règle (§21 bis). Une étape qui échoue ARRÊTE la suite : on n'importe pas sans
// sauvegarde relue, on n'apprend pas sur un import non vérifié.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const fichier = process.argv.slice(2).find(a => !a.startsWith('--'));
const ecrire = process.argv.includes('--ecrire');
if (!fichier || !fs.existsSync(fichier)) { console.error('Usage : node integrer-export.js <products_singles_*.json> [--ecrire --confirmer-production]'); process.exit(2); }
if (ecrire && !process.argv.includes('--confirmer-production')) { console.error('❌ --ecrire écrit en PRODUCTION (`test`) : ajouter --confirmer-production.'); process.exit(2); }

const RAPPORTS = path.join(__dirname, 'collecte-cartes', 'rapports');
const lancer = (titre, args, env = {}) => {
    console.log(`\n▶▶ ${titre}\n   node ${args.join(' ')}`);
    const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    if (r.status !== 0) { console.error(`\n❌ ARRÊT : « ${titre} » a rendu ${r.status}. Rien de ce qui suit n'est lancé.`); process.exit(r.status || 1); }
};
const dernierDiff = () => {
    const base = `diff-${path.basename(fichier, '.json')}-`;
    const l = fs.readdirSync(RAPPORTS).filter(f => f.startsWith(base)).sort();
    if (!l.length) throw new Error('le diff n\'a écrit aucun rapport — je ne devine pas les expansions touchées');
    return JSON.parse(fs.readFileSync(path.join(RAPPORTS, l.at(-1)), 'utf8'));
};

lancer('LE DIFF (lecture seule)', ['mesure-diff-catalogue.js', '--base=test', fichier]);
const avant = dernierDiff();
lancer('LES TROIS NOMBRES, SUR L\'EXPORT (lecture seule)', ['mesure-catalogue.js', `--export=${fichier}`]);
if (!ecrire) { console.log('\n(mesure seule — --ecrire --confirmer-production pour sauvegarder, importer, vérifier et apprendre)'); process.exit(0); }

const jour = new Date().toISOString().slice(0, 10);
lancer('SAUVEGARDE RÉELLE (relue)', ['backup-collections.js', '--base=test', '--collections=catalogue_produits,numeros_cartes,codes_set', `--dossier=backup-${jour}-avant-export`]);
lancer('IMPORT dans catalogue_produits', ['import-catalogue.js', fichier, '--base=test', '--confirmer-production']);
lancer('VÉRIFICATION : le diff relancé', ['mesure-diff-catalogue.js', '--base=test', fichier]);
const apres = dernierDiff();
if (apres.nouveaux || apres.nomChange?.length || apres.expChange?.length) { console.error(`❌ ARRÊT : après import, le diff rend encore ${apres.nouveaux} nouveaux, ${apres.nomChange?.length} noms, ${apres.expChange?.length} expansions changés.`); process.exit(1); }
console.log('   ✅ import vérifié : le diff relancé rend zéro');

// les expansions à apprendre : celles qui reçoivent des produits, hors expansions de cartes-code seules
const aApprendre = [...(avant.neuves || []), ...(avant.connues || [])].filter(l => l.n > (l.cartesCode ?? 0)).map(l => String(l.id));
if (aApprendre.length) lancer(`APPRENTISSAGE Cardmarket de ${aApprendre.length} expansions (s'arrête au premier 1015)`, ['apprendre-set.js', '--base=test', ...aApprendre], { MONGODB_BASE: 'test' });

console.log(`
▶▶ LA SUITE, À LA MAIN TANT QU'ELLE N'A PAS TOURNÉ UNE FOIS D'UN BOUT À L'AUTRE (CLAUDE.md §56) :
   node collecte-cartes/generer-table-auto.js          lignes candidates des expansions apprises (Bulbapedia, verrou)
   node collecte-cartes/verifier-table.js --auto       admission, critères imprimés
   node collecteur-texte.js --set=<code>               le texte, une ligne admise à la fois (témoin du nom dans joindre())
   commit des tables + push NOMMÉ + redéploiement      le worker lit les tables de SON commit
   node remettre-en-file.js --ecrire                   les images — la garde du commit bloque tant que ce n'est pas déployé`);
