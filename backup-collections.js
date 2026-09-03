// ============================================================
// SAUVEGARDE DE COLLECTIONS — export JSON, LECTURE SEULE
// ============================================================
// À lancer AVANT toute opération d'écriture en masse (nettoyer-codeset.js,
// import-catalogue.js, prefill-tcgdex.js --ecrire...).
//
// LECTURE SEULE côté base : uniquement countDocuments et un curseur find. Aucune
// écriture, aucun index créé. Les seuls fichiers écrits sont locaux.
//
// USAGE (la base ET les collections doivent être NOMMÉES — le script refuse de deviner) :
//   node backup-collections.js --base=test --collections=numeros_cartes,codes_set
//   node backup-collections.js --base=test --collections=... --dossier=backup-2026-07-27
//
// ════════════════════════════════════════════════════════════════════════════
// 🔴 IL Y AVAIT UN DÉFAUT PAR DÉFAUT, ET C'ÉTAIT UN CONTRÔLE QUI NE POUVAIT PAS
//    ÉCHOUER — corrigé le 2026-09-02
// ════════════════════════════════════════════════════════════════════════════
// `--collections` valait `numeros_cartes,codes_set` en l'absence d'argument. Ce défaut
// était JUSTE pour l'usage d'origine — protéger `nettoyer-codeset.js`, qui ne touche que
// ces deux tables — et il est devenu un piège dès qu'on a sauvegardé « avant une grosse
// opération » : DEUX collections sur douze, ~11,7 Mo sur 473, et l'on croit être couvert.
// ⚠️ Le testeur l'a dit mieux que moi : « je l'aurais lancée en me croyant couvert. C'est
// le genre de défaut qui ne se découvre qu'au moment de restaurer, c'est-à-dire trop tard. »
//
// DEUX SORTIES POSSIBLES, ET POURQUOI CELLE-CI :
//   · défaut = « le périmètre non régénérable » — REFUSÉE. Ce périmètre est un JUGEMENT
//     qui vieillit : une collection ajoutée demain n'y serait pas, et son absence ne se
//     verrait pas. C'est le défaut du compteur recopié (entrée 17), transposé aux données.
//   · 🔑 AUCUN DÉFAUT — RETENUE. L'appelant NOMME son périmètre, donc il l'a pensé. Et
//     le script imprime CE QU'IL NE SAUVEGARDE PAS, ce qui rend impossible de se croire
//     couvert par erreur : la liste des collections écartées est sous les yeux, à chaque
//     exécution, avec leur poids.
//
// ⚠️ ET UN PIÈGE QUI RESTE, PARCE QU'IL N'EST PAS DANS CE SCRIPT : `references_image`
// contient des Buffers. `JSON.stringify` les rend en TABLEAUX D'ENTIERS — 428,7 Mo de
// binaire deviennent ~1,5 à 2 Go de texte, très lentement. Le script avertit désormais
// avant de commencer, mais il obéit : c'est l'appelant qui décide.
//
// Les dossiers backup-*/ sont ignorés par git (.gitignore).
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

// ⚠️ PAS DE DÉFAUT. Voir l'en-tête : un défaut silencieux transformait ce script en
// contrôle qui ne peut pas échouer.
const ARG_COLLECTIONS = option('collections', null);
const COLLECTIONS = (ARG_COLLECTIONS || '').split(',').map(s => s.trim()).filter(Boolean);
// Les collections dont le contenu ne se REFAIT PAS. Elles ne sont pas un défaut — elles
// sont IMPRIMÉES quand elles manquent au périmètre demandé, pour que l'oubli se voie.
//   · `numeros_cartes` et `codes_set` sont APPRISES scan après scan : rien ne les rejoue.
//   · le journal et les comptes sont de la donnée de production.
// À l'inverse, `catalogue_produits` et `guide_prix` se réimportent depuis les exports
// Cardmarket, et `references_image` se régénère par `ecrire-descripteurs.js`.
const NON_REGENERABLES = ['numeros_cartes', 'codes_set', 'journal_scans', 'credits',
    'evenements_stripe', 'remboursements', 'quotas_semaine', 'quotas'];
// Celles dont l'export JSON est pathologique — voir l'en-tête.
const LOURDES_EN_JSON = ['references_image'];
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

    const existantes = (await db.listCollections().toArray()).map(c => c.name).sort();

    // ⚠️ REFUS PLUTÔT QUE DÉFAUT. Le message doit donner de quoi repartir, sinon il
    // pousse à recopier la première commande venue — celle qui sauvegardait deux
    // collections sur douze.
    if (!ARG_COLLECTIONS) {
        console.error('\n❌ REFUS : --collections est OBLIGATOIRE.');
        console.error('   Ce script n\'a plus de périmètre par défaut : il en avait un, et on');
        console.error('   pouvait se croire couvert en sauvegardant 2 collections sur 12.\n');
        console.error(`   Collections présentes dans « ${db.databaseName} » :`);
        for (const n of existantes) {
            const st = await db.command({ collStats: n }).catch(() => null);
            const nr = NON_REGENERABLES.includes(n) ? '  🔴 NON RÉGÉNÉRABLE' : '';
            const lo = LOURDES_EN_JSON.includes(n) ? '  ⚠️ lourde en JSON' : '';
            console.error(`     ${n.padEnd(22)} ${String(st?.count ?? '?').padStart(7)} docs ${taille(st?.storageSize ?? 0).padStart(9)}${nr}${lo}`);
        }
        console.error(`\n   Le périmètre NON RÉGÉNÉRABLE, si c'est ce que tu veux :`);
        console.error(`     --collections=${NON_REGENERABLES.filter(n => existantes.includes(n)).join(',')}`);
        process.exit(1);
    }

    const manquantes = COLLECTIONS.filter(c => !existantes.includes(c));
    if (manquantes.length) {
        throw new Error(`collection(s) introuvable(s) : ${manquantes.join(', ')}`);
    }

    // 🔑 CE QU'ON NE SAUVEGARDE PAS, IMPRIMÉ AVANT DE COMMENCER. C'est ça qui remplace le
    // défaut : on ne peut plus se croire couvert, la liste des écartées est sous les yeux.
    const ecartees = existantes.filter(c => !COLLECTIONS.includes(c));
    if (ecartees.length) {
        console.log(`\n⚠️ NON SAUVEGARDÉES (${ecartees.length} collection(s) sur ${existantes.length}) :`);
        for (const n of ecartees) {
            const st = await db.command({ collStats: n }).catch(() => null);
            const nr = NON_REGENERABLES.includes(n) ? '  🔴 NON RÉGÉNÉRABLE — es-tu sûr ?' : '  (régénérable)';
            console.log(`   ${n.padEnd(22)} ${String(st?.count ?? '?').padStart(7)} docs ${taille(st?.storageSize ?? 0).padStart(9)}${nr}`);
        }
    }
    for (const n of COLLECTIONS.filter(c => LOURDES_EN_JSON.includes(c))) {
        console.log(`\n⚠️ « ${n} » contient des Buffers : JSON.stringify les rend en TABLEAUX`);
        console.log(`   D'ENTIERS. Compte ~4× la taille binaire, et de longues minutes.`);
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
