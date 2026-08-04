// ============================================================
// LES CHARGES DU VERROU — EXTRAITES DU JOURNAL, JAMAIS ÉCRITES À LA MAIN
// ============================================================
// LA RÈGLE, ET ELLE EST LE CŒUR DU DISPOSITIF. Une réponse d'IA rédigée à la main serait
// exactement le stub qu'on vient de payer deux fois : une SECONDE SOURCE DE VÉRITÉ, qui
// ressemble à la vraie et qui en diverge en silence. Le deuxième principe vaut pour le
// CONTENU comme pour le CONTENANT — l'objet « scoring » fabriqué à la main dans index.js
// avait trois fonctions sur quatre, et cinquante-deux assertions certifiaient un appel qui
// n'existait nulle part en production.
// Donc : tout ce que le verrou rejoue sort de `journal_scans`, c'est-à-dire de scans
// RÉELS. Ce fichier ne fabrique rien. Il choisit, il copie, il trace d'où ça vient.
//
// CE QUI EST EXTRAIT :
//   - la lecture de l'IA, champ par champ (nom, numéro, total, setCode, langue, rareté,
//     nomBrut, nomConfiance, symboleSet) telle qu'enregistrée ;
//   - l'URL de la photo, qui sert de clé de rejeu ;
//   - une TRANCHE du catalogue de production, copiée dans test_scratch, pour que la
//     chaîne trouve de vrais produits au lieu de sortir par « aucun candidat ».
//
// ⚠️ CE QUI N'EST PAS DANS LE JOURNAL, et qui est donc mis à null EXPLICITEMENT plutôt que
// deviné : `motif`, `reverse`, `rareteElevee`, `etatEstime`, `etatConfiance`, et le titre
// de l'annonce. Ces champs sortent pourtant de l'IA. C'est une lacune du journal, pas du
// verrou, et elle a une conséquence à connaître : les branches pilotées par ces champs —
// le routage du motif de reverse en particulier — ne sont PAS exercées.
// LE CORRECTIF EST DÉJÀ IDENTIFIÉ : journaliser la réponse IA brute (c'est la première
// jonction de la chaîne, au même titre que `nomExact`). Le jour où ce sera fait, ce fichier
// n'aura qu'à lire un champ de plus et les charges deviendront intégrales.
//
// LECTURE SEULE sur la production. ÉCRITURE uniquement dans test_scratch.
// USAGE :
//   node verrou-charges.js --base=test        extrait, écrit verrou/charges.json + la tranche

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const S = require('./scoring');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');
const { empreintePrompt } = require('./verrou/empreinte');

const SCRATCH = 'test_scratch';
const SORTIE = path.join(__dirname, 'verrou', 'charges.json');
const ASIATIQUES = S.LANGUES_ASIATIQUES;

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
// ni par le goût. La première est celle qui a tué la production le 4 août : un setCode lu
// qui ne figure pas dans la table close fait entrer dans `setCodeCompatibleVintage`
// jusqu'à la ligne qui appelait une fonction absente.
const CELLULES = [
    {
        nom: 'asiatique · setCode HORS table close',
        pourquoi: 'le chemin exact du plantage memeCodeParConventionX',
        test: d => ASIATIQUES.includes(String(d.langue || '').toUpperCase())
            && !!S.normaliserCodeSet(d.setCode)
            && !codesTable.includes(S.ALIAS_CODES_LUS.get(S.normaliserCodeSet(d.setCode)) || S.normaliserCodeSet(d.setCode))
    },
    {
        nom: 'asiatique · aucun setCode lu',
        pourquoi: 'sortie anticipée de la table close : la branche qui NE plantait pas',
        test: d => ASIATIQUES.includes(String(d.langue || '').toUpperCase()) && !S.normaliserCodeSet(d.setCode)
    },
    {
        nom: 'occidentale',
        pourquoi: 'toutes les gardes du chantier sont conditionnées à LANGUES_ASIATIQUES : sans elle, une régression occidentale est invisible',
        test: d => !ASIATIQUES.includes(String(d.langue || '').toUpperCase())
    }
];

(async () => {
    const prod = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    console.log(`lecture  : ${prod.db.databaseName}`);
    if (prod.db.databaseName === SCRATCH) {
        console.error('❌ La base de lecture ne peut pas être le bac à sable.');
        process.exit(1);
    }

    const journal = await prod.collection('journal_scans').find({}).sort({ le: -1 }).toArray();
    console.log(`${journal.length} lignes au journal\n`);

    const charges = [];
    for (const c of CELLULES) {
        // La ligne la PLUS RÉCENTE de la cellule qui porte une photo et une lecture
        // exploitable. La plus récente, parce que c'est celle qui ressemble le plus à ce
        // que le modèle rend aujourd'hui.
        const d = journal.find(x => x.imageUrl && x.nom && c.test(x));
        if (!d) { console.log(`⚠️ ${c.nom} : aucune ligne — cellule vide, le verrou le dira`); continue; }
        charges.push({
            cellule: c.nom,
            pourquoi: c.pourquoi,
            // LA PROVENANCE, pour qu'on puisse toujours remonter au scan d'origine.
            source: { _id: String(d._id), le: d.le, version: d.version ?? null },
            imageUrl: d.imageUrl,
            // La lecture, champ par champ, telle qu'elle a été enregistrée.
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
        console.log(`     "${d.nom}" n°${d.numero ?? '—'} setCode=${d.setCode ?? '—'} ${d.langue} — scan du ${d.le?.toISOString?.().slice(0, 16)}`);
    }

    // ── LA TRANCHE DE CATALOGUE ──────────────────────────────────────────────
    // Sans elle, la chaîne sort par « aucun candidat » AVANT d'avoir traversé quoi que ce
    // soit d'intéressant. Avec elle, elle va jusqu'au verdict. Copiée depuis la production,
    // jamais fabriquée : ce sont de vrais produits, de vrais numéros, de vrais codes.
    console.log('\n── tranche de catalogue -> test_scratch ──');
    const noms = [...new Set(charges.map(c => c.lecture.name).filter(Boolean))];
    const ouNom = { $or: noms.map(n => ({ name: new RegExp(echapper(n), 'i') })) };
    const produits = await prod.collection('catalogue_produits').find(ouNom).limit(3000).toArray();
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

    const empreinte = empreintePrompt();
    fs.writeFileSync(SORTIE, JSON.stringify({
        // ⚠️ CE BLOC EST CE QUI PERMET DE SAVOIR QUE LES CHARGES ONT VIEILLI.
        extraitLe: new Date().toISOString(),
        extraitDe: prod.db.databaseName,
        empreintePrompt: empreinte,
        commentRafraichir: 'node verrou-charges.js --base=test',
        charges
    }, null, 2), 'utf8');
    console.log(`\n📝 ${SORTIE}`);
    console.log(`   ${charges.length}/3 cellules · empreinte du prompt ${empreinte.hash} (${empreinte.modele})`);

    await prod.close(); await bac.close();
})();

function echapper(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
