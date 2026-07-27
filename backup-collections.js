// ============================================================
// SAUVEGARDE DE COLLECTIONS — export JSON, LECTURE SEULE
// ============================================================
// À lancer AVANT toute opération d'écriture en masse (nettoyer-codeset.js,
// import-catalogue.js, prefill-tcgdex.js --ecrire...).
//
// LECTURE SEULE côté base : uniquement countDocuments et un curseur find. Aucune
// écriture, aucun index créé. Les seuls fichiers écrits sont locaux.
//
// USAGE (la base doit être NOMMÉE, le script refuse de la deviner) :
//   node backup-collections.js --base=test
//   node backup-collections.js --base=test --collections=numeros_cartes,codes_set
//   node backup-collections.js --base=test --dossier=backup-2026-07-27
//
// Par défaut : les deux collections que nettoyer-codeset.js modifie, dans un dossier
// horodaté du jour. Les dossiers backup-*/ sont ignorés par git (.gitignore).
//
// Export en FLUX (curseur -> fichier) plutôt qu'en mémoire : numeros_cartes fait ~70 000
// documents. Format : tableau JSON valide, réimportable via `mongoimport --jsonArray`.

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { connecterMongo } = require('./mongo-connexion');

function option(nom, defaut) {
    const arg = process.argv.find(a => a.startsWith(`--${nom}=`));
    return arg ? arg.slice(nom.length + 3).trim() : defaut;
}

const COLLECTIONS = option('collections', 'numeros_cartes,codes_set').split(',').map(s => s.trim()).filter(Boolean);
const DOSSIER = path.join(__dirname, option('dossier', `backup-${new Date().toISOString().slice(0, 10)}`));

function taille(octets) {
    return octets > 1024 * 1024
        ? (octets / 1024 / 1024).toFixed(1) + ' Mo'
        : (octets / 1024).toFixed(1) + ' Ko';
}

async function exporter(db, nom) {
    const fichier = path.join(DOSSIER, `${nom}.json`);
    // On n'écrase JAMAIS une sauvegarde existante : remplacer silencieusement un état
    // d'origine par un état déjà modifié rendrait la sauvegarde inutile au moment même
    // où on en aurait besoin.
    if (fs.existsSync(fichier)) {
        throw new Error(`${fichier} existe déjà — je refuse de l'écraser. Renomme ou supprime le dossier.`);
    }

    const attendu = await db.collection(nom).countDocuments({});
    const flux = fs.createWriteStream(fichier, { encoding: 'utf8' });
    const ecrire = t => new Promise(r => flux.write(t) ? r() : flux.once('drain', r));

    await ecrire('[\n');
    let ecrits = 0;
    for await (const doc of db.collection(nom).find({})) {
        await ecrire((ecrits ? ',\n' : '') + JSON.stringify(doc));
        ecrits++;
        if (ecrits % 10000 === 0) process.stdout.write(`\r   ${nom} : ${ecrits}/${attendu}...`);
    }
    await ecrire('\n]\n');
    await new Promise(r => flux.end(r));

    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    return { nom, attendu, ecrits, octets: fs.statSync(fichier).size, fichier };
}

async function main() {
    await connecterMongo({ script: 'backup-collections.js', ecrit: false });
    const db = mongoose.connection.db;

    const existantes = (await db.listCollections().toArray()).map(c => c.name);
    const manquantes = COLLECTIONS.filter(c => !existantes.includes(c));
    if (manquantes.length) {
        throw new Error(`collection(s) introuvable(s) : ${manquantes.join(', ')}`);
    }

    fs.mkdirSync(DOSSIER, { recursive: true });

    const resultats = [];
    for (const nom of COLLECTIONS) resultats.push(await exporter(db, nom));

    console.log('\nSauvegarde terminée :\n');
    console.log('  collection            documents      taille');
    console.log('  ' + '-'.repeat(50));
    let total = 0, incoherent = false;
    for (const r of resultats) {
        const ok = r.ecrits === r.attendu;
        if (!ok) incoherent = true;
        console.log(`  ${r.nom.padEnd(22)}${String(r.ecrits).padEnd(15)}${taille(r.octets).padStart(9)}  ${ok ? '✅' : `❌ ${r.attendu} attendus`}`);
        total += r.ecrits;
    }
    console.log(`\n  TOTAL : ${total} documents dans ${DOSSIER}`);

    // Contrôle de relecture : un fichier tronqué ou mal échappé ne se verrait pas
    // autrement, et une sauvegarde illisible ne vaut rien.
    console.log('\nVérification de relecture :');
    for (const r of resultats) {
        const relu = JSON.parse(fs.readFileSync(r.fichier, 'utf8'));
        const ok = Array.isArray(relu) && relu.length === r.ecrits;
        if (!ok) incoherent = true;
        console.log(`  ${r.nom.padEnd(22)}${Array.isArray(relu) ? relu.length : '?'} documents relus ${ok ? '✅' : '❌'}`);
    }

    await mongoose.disconnect();
    if (incoherent) {
        console.error('\n❌ Sauvegarde INCOHÉRENTE — ne lance aucune écriture en base.');
        process.exit(1);
    }
}

main().catch(async e => {
    console.error('❌ Erreur :', e.message);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
