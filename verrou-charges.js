// ============================================================
// LES CHARGES DU VERROU — EXTRAITES DU JOURNAL, JAMAIS ÉCRITES À LA MAIN
// ============================================================
// LA RÈGLE, ET ELLE EST LE CŒUR DU DISPOSITIF. Une réponse d'IA rédigée à la main serait
// exactement le stub qu'on a payé deux fois : une SECONDE SOURCE DE VÉRITÉ, qui ressemble
// à la vraie et qui en diverge en silence. Le deuxième principe vaut pour le CONTENU comme
// pour le CONTENANT — l'objet « scoring » fabriqué à la main dans index.js avait trois
// fonctions sur quatre, et cinquante-deux assertions certifiaient un appel qui n'existait
// nulle part en production.
// Donc : tout ce que le verrou rejoue sort de scans RÉELS. Ce fichier ne fabrique rien.
// Il choisit, il copie, il trace d'où ça vient.
//
// ⚠️ DEUX RÈGLES DE SÉLECTION, ET LA PREMIÈRE M'AVAIT MANQUÉ AU PREMIER JET :
//   1. LA LIGNE DOIT AVOIR ABOUTI (`idProduct` non nul). Un scan qui a ÉCHOUÉ en production
//      ne peut pas traverser la route : il ressort à « carte introuvable » ligne 2769, très
//      loin du code à protéger. Mes deux premières charges étaient deux échecs, le verrou a
//      affiché huit ✅ et n'a rien vérifié du tout.
//   2. LA PLUS RÉCENTE de sa cellule, parce que c'est celle qui ressemble le plus à ce que
//      le modèle rend aujourd'hui.
//
// DEUX PHASES :
//   1. EXTRACTION — les lectures depuis `journal_scans`, plus une TRANCHE du catalogue de
//      production copiée dans test_scratch (sans elle, la chaîne sort par « aucun candidat »
//      avant d'avoir traversé quoi que ce soit).
//   2. ENREGISTREMENT — on rejoue les charges une fois AVEC le réseau ouvert et on capture
//      chaque réponse TCGdex. Le verrou les rejouera hors ligne.
//      ⚠️ POURQUOI. La première version rendait TCGdex muet, « limite assumée ». Mesuré
//      ensuite : muet, ZÉRO ligne du journal n'atteint le code à protéger. Ce n'était pas
//      une limite, c'était une impasse.
//
// ⚠️ CE QUI N'EST PAS DANS LE JOURNAL, mis à null EXPLICITEMENT plutôt que deviné :
// `motif`, `reverse`, `rareteElevee`, `etatEstime`, `etatConfiance`, et le titre de
// l'annonce. Conséquence à connaître : les branches qu'ils pilotent — le routage du motif
// de reverse en particulier — ne sont PAS exercées. Le correctif est W1 : journaliser la
// réponse IA brute, qui est la première jonction de la chaîne au même titre que `nomExact`.
//
// LECTURE SEULE sur la production. ÉCRITURE uniquement dans test_scratch.
// USAGE :  node verrou-charges.js --base=test

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const S = require('./scoring');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');
const { empreintePrompt } = require('./verrou/empreinte');
const { demarrer, appeler } = require('./verrou/serveur');

const SCRATCH = 'test_scratch';
const SORTIE = path.join(__dirname, 'verrou', 'charges.json');
const SORTIE_TCGDEX = path.join(__dirname, 'verrou', 'tcgdex.json');
const JETON = process.env.JETON_API || 'jeton-verrou';
const USER_VERROU = 'verrou-avant-push';

// ⚠️ NOMMER LA BASE OU REFUSER. La base de production s'appelle « test » : une commande
// lancée sans réfléchir ne doit jamais pouvoir y écrire par défaut.
const arg = process.argv.find(a => a.startsWith('--base='));
if (!arg) {
    console.error('❌ Base non nommée. Usage : node verrou-charges.js --base=test');
    console.error('   (lecture seule sur cette base ; les écritures vont dans test_scratch)');
    process.exit(1);
}
const BASE = arg.slice('--base='.length);
const codesTable = SETS_VINTAGE_JAPONAIS.map(s => S.normaliserCodeSet(s.code));

// LES TROIS CELLULES, définies par le CHEMIN DE CODE qu'elles empruntent — pas par l'ère
// ni par le goût. Chacune DÉCLARE LA PROFONDEUR qu'elle doit atteindre : sans ça, une
// charge qui sort au bout de trois lignes ressemble à une charge qui a tout traversé.
const CELLULES = [
    {
        nom: 'asiatique · setCode HORS table close',
        pourquoi: 'le chemin exact du plantage memeCodeParConventionX du 4 août',
        profondeurExigee: 'perimetre-vintage',
        test: d => S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase())
            && !!S.normaliserCodeSet(d.setCode)
            && !codesTable.includes(S.ALIAS_CODES_LUS.get(S.normaliserCodeSet(d.setCode)) || S.normaliserCodeSet(d.setCode))
    },
    {
        nom: 'asiatique · aucun setCode lu',
        pourquoi: 'sortie anticipée de la table close : la branche qui NE plantait pas',
        profondeurExigee: 'perimetre-vintage',
        test: d => S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase()) && !S.normaliserCodeSet(d.setCode)
    },
    {
        nom: 'occidentale',
        pourquoi: 'toutes les gardes du chantier sont conditionnées à LANGUES_ASIATIQUES : sans elle, une régression occidentale est invisible',
        profondeurExigee: 'perimetre-vintage',
        test: d => !S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase())
    }
];

(async () => {
    const prod = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    console.log(`lecture  : ${prod.db.databaseName} (aucune écriture)`);
    if (prod.db.databaseName === SCRATCH) {
        console.error('❌ La base de lecture ne peut pas être le bac à sable.');
        process.exit(1);
    }

    const journal = await prod.collection('journal_scans').find({}).sort({ le: -1 }).toArray();
    // ⚠️ LA CONDITION QUI MANQUAIT : `idProduct` non nul. Voir l'en-tête.
    const abouties = journal.filter(d => d.idProduct != null && d.imageUrl && d.nom);
    console.log(`${journal.length} lignes au journal · ${abouties.length} ont abouti ET portent une photo\n`);

    console.log('── phase 1 : les charges ──');
    const charges = [];
    for (const c of CELLULES) {
        const d = abouties.find(c.test);
        if (!d) {
            // Une cellule vide n'est pas une panne du code : c'est un manque de données.
            // Le verrou le dira en AVERTISSEMENT, jamais en échec — un verrou rouge en
            // permanence est un verrou qu'on apprend à ignorer.
            console.log(`⚠️ ${c.nom} : aucune ligne aboutie avec photo — cellule vide`);
            continue;
        }
        charges.push({
            cellule: c.nom,
            pourquoi: c.pourquoi,
            profondeurExigee: c.profondeurExigee,
            source: { _id: String(d._id), le: d.le, version: d.version ?? null, idProduct: d.idProduct },
            imageUrl: d.imageUrl,
            lecture: {
                name: d.nom,
                number: d.numero ?? null,
                total: d.total ?? null,
                setCode: d.setCode ?? null,
                language: d.langue ?? 'EN',
                rarete: d.rarete ?? null,
                nomBrut: d.nomBrut ?? null,
                nomConfiance: d.nomConfiance ?? null,
                symboleSet: d.symboleSet ?? null,
                // ⚠️ ABSENTS DU JOURNAL — null EXPLICITE, jamais une valeur inventée.
                motif: null, reverse: null, rareteElevee: null,
                etatEstime: null, etatConfiance: null
            },
            champsAbsentsDuJournal: ['motif', 'reverse', 'rareteElevee', 'etatEstime', 'etatConfiance', 'title']
        });
        console.log(`✅ ${c.nom}`);
        console.log(`     "${d.nom}" n°${d.numero ?? '—'} setCode=${d.setCode ?? '—'} ${d.langue} -> ${d.idProduct}  (${d.le?.toISOString?.().slice(0, 16)})`);
        console.log(`     profondeur exigée : ${c.profondeurExigee}`);
    }
    if (!charges.length) {
        console.error('\n❌ Aucune charge extractible. Scanne quelques cartes, puis relance.');
        process.exit(1);
    }

    // ── LA TRANCHE DE CATALOGUE ──────────────────────────────────────────────
    // Copiée depuis la production, jamais fabriquée : vrais produits, vrais numéros,
    // vrais codes. Élargie au GAGNANT de chaque charge et à toute son expansion — sans
    // ça, le produit que la production avait retenu peut manquer du vivier.
    console.log('\n── tranche de catalogue -> test_scratch ──');
    const noms = [...new Set(charges.map(c => c.lecture.name).filter(Boolean))];
    const gagnants = charges.map(c => c.source.idProduct).filter(v => v != null);
    const numGagnants = await prod.collection('numeros_cartes')
        .find({ idProduct: { $in: gagnants } }, { projection: { idExpansion: 1 } }).toArray();
    const expansions = [...new Set(numGagnants.map(n => n.idExpansion).filter(v => v != null))];
    const idsExpansion = (await prod.collection('numeros_cartes')
        .find({ idExpansion: { $in: expansions } }, { projection: { idProduct: 1 } }).toArray())
        .map(n => n.idProduct);

    const produits = await prod.collection('catalogue_produits').find({
        $or: [
            ...noms.map(n => ({ name: new RegExp(echapper(n), 'i') })),
            { idProduct: { $in: [...gagnants, ...idsExpansion] } }
        ]
    }).limit(6000).toArray();
    const ids = produits.map(p => p.idProduct);
    const numeros = await prod.collection('numeros_cartes').find({ idProduct: { $in: ids } }).toArray();
    const prix = await prod.collection('guide_prix').find({ idProduct: { $in: ids } }).toArray();
    // TOUS les codes de set : 747 lignes minuscules, et `lireTousLesCodesSet` les lit tous
    // pour distinguer une contradiction d'un bruit d'OCR (quatrième principe). En donner
    // une partie fausserait précisément cette distinction.
    const codes = await prod.collection('codes_set').find({}).toArray();

    const bac = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: SCRATCH }).asPromise();
    if (bac.db.databaseName !== SCRATCH) {
        console.error(`❌ ARRÊT : écriture visée sur "${bac.db.databaseName}" au lieu de ${SCRATCH}.`);
        process.exit(1);
    }
    for (const [nom, docs] of [['catalogue_produits', produits], ['numeros_cartes', numeros],
    ['guide_prix', prix], ['codes_set', codes]]) {
        await bac.collection(nom).deleteMany({});
        if (docs.length) await bac.collection(nom).insertMany(docs);
        console.log(`   ${nom.padEnd(20)} ${docs.length}`);
    }
    // Chaque gagnant est-il bien dans la tranche ? Si non, la charge ne pourra pas aboutir
    // et il vaut mieux le savoir ici que dans un verrou rouge sans explication.
    for (const c of charges) {
        const present = ids.includes(c.source.idProduct);
        console.log(`   gagnant ${c.source.idProduct} (${c.lecture.name}) : ${present ? 'présent' : '⚠️ ABSENT de la tranche'}`);
    }

    const empreinte = empreintePrompt();
    fs.writeFileSync(SORTIE, JSON.stringify({
        extraitLe: new Date().toISOString(),
        extraitDe: prod.db.databaseName,
        empreintePrompt: empreinte,
        commentRafraichir: 'node verrou-charges.js --base=test',
        charges
    }, null, 2), 'utf8');
    console.log(`\n📝 ${SORTIE} — ${charges.length}/3 cellules · empreinte ${empreinte.hash}`);
    await prod.close();

    // ── PHASE 2 : ENREGISTREMENT DE TCGdex ───────────────────────────────────
    console.log('\n── phase 2 : enregistrement des réponses TCGdex (réseau OUVERT) ──');
    const srv = await demarrer(path.join(__dirname, 'verrou', 'enregistreur.js'), {
        VERROU_CHARGES: SORTIE,
        VERROU_ENREGISTRER: SORTIE_TCGDEX,
        JETON_API: JETON,
        OPENROUTER_API_KEY: ''   // l'IA est rejouée ; aucune clé ne doit servir
    });
    if (!await srv.attendreMongo()) {
        console.error('❌ Mongo non connecté côté serveur d\'enregistrement.');
        srv.enfant.kill(); process.exit(1);
    }
    for (const c of charges) {
        const r = await appeler(srv.port, 'POST', '/api/identifier', {
            userId: USER_VERROU, imageUrls: [c.imageUrl], title: null, vintedEtat: null
        }, JETON);
        console.log(`   ${c.lecture.name.padEnd(18)} -> ${r.json?.success ? 'succès' : `échec : ${r.json?.error ?? r.status}`}`);
    }
    // Vidage explicite : sur Windows, SIGTERM n'est pas toujours délivré au processus Node.
    await new Promise(resolve => {
        srv.enfant.once('message', m => { if (m === 'vide') resolve(); });
        srv.enfant.send('vider');
        setTimeout(resolve, 5000);
    });
    srv.enfant.kill();

    if (fs.existsSync(SORTIE_TCGDEX)) {
        const t = JSON.parse(fs.readFileSync(SORTIE_TCGDEX, 'utf8'));
        console.log(`\n📝 ${SORTIE_TCGDEX} — ${t.nb} réponse(s) TCGdex enregistrées`);
    } else {
        console.log(`\n⚠️ ${SORTIE_TCGDEX} non écrit — le verrou tournera sans réponses TCGdex.`);
    }

    // Nettoyage du bac : les lignes de journal et le crédit créés par l'enregistrement.
    const nj = await bac.collection('journal_scans').deleteMany({ userId: USER_VERROU });
    const nc = await bac.collection('credits').deleteMany({ userId: USER_VERROU });
    console.log(`🧹 test_scratch : ${nj.deletedCount} ligne(s) de journal, ${nc.deletedCount} crédit(s) supprimés.`);
    await bac.close();
    process.exit(0);
})();

function echapper(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
