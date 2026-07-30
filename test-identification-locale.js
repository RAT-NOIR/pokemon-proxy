// ============================================================
// TEST DU CHEMIN D'IDENTIFICATION LOCALE — en BAC À SABLE
// ============================================================
// Il exerce la VRAIE fonction (identification-locale.js), pas une réimplémentation.
// C'est la leçon de l'épisode « aucunRang1 » : une simulation qui recopie la logique peut
// réussir là où le code déployé échoue, parce qu'elle ne voit pas le même vivier. Ici
// l'assertion porte sur la fonction que le serveur appellera.
//
// PROTOCOLE :
//   1. LECTURE de la production pour récupérer les VRAIS documents des cas testés
//      (catalogue_produits, numeros_cartes, codes_set, guide_prix). Aucune écriture.
//   2. ÉCRITURE de ces documents dans test_scratch, et uniquement là. Le script REFUSE
//      de continuer si la base d'écriture n'est pas test_scratch.
//   3. Exécution de identifierEnLocal, assertions.
//   4. Nettoyage complet, avec vérification du nettoyage.
//
// ⚠️ La base de PRODUCTION de ce projet s'appelle « test ». Le bac à sable est
//    « test_scratch ». Un underscore les sépare — voir mongo-connexion.js.
//
// USAGE : node test-identification-locale.js

require('dotenv').config();
const mongoose = require('mongoose');

const BASE_PROD = 'test';
const BASE_SCRATCH = 'test_scratch';
const libre = () => new mongoose.Schema({}, { strict: false });

// Les six cas remontés en production. Pour chacun, le résultat ATTENDU est celui qu'on a
// mesuré dans la base réelle — aucune valeur inventée.
const CAS = [
    {
        nom: 'Arbok holo 099/128 (e-Series 1)',
        lu: { nomLu: 'Arbok', numeroLu: '099', regionAttendue: 'japonais' },
        attendu: 650689, prixAttendu: 160.08, codeAttendu: 'EC1'
    },
    {
        nom: 'Rhydon 055/088 (e-Series 4)',
        lu: { nomLu: 'Rhydon', numeroLu: '055', regionAttendue: 'japonais' },
        attendu: 653962, prixAttendu: 72.22, codeAttendu: 'EC4'
    },
    {
        nom: 'Ledian 007/088 (e-Series 4)',
        lu: { nomLu: 'Ledian', numeroLu: '007', regionAttendue: 'japonais' },
        attendu: 653888, prixAttendu: 147.94, codeAttendu: 'EC4',
        // Le cas qui prouve que la région travaille : l'homonyme XY occidental coûte
        // 0,23 € et serait retenu sans elle.
        doitEcarter: 281344
    },
    {
        nom: 'Carabaffe 019 — nom FRANÇAIS, via nomFr',
        lu: { nomLu: 'Carabaffe', numeroLu: '019', regionAttendue: 'japonais' },
        // DEUX candidats japonais à égalité (95 points chacun) : PCG8 019 à 3,76 € et
        // pcgA 019 à 8,32 €. Seul le total 029 les départagerait, et on ne sait pas le
        // dériver (29,6 % de justes, piste écartée). Le comportement ATTENDU n'est donc
        // pas de trancher, c'est de le SIGNALER.
        //
        // ⚠️ DEUX, ET NON TROIS. Un troisième produit existe au n°019 « sur les chiffres »
        // — EC1 « S19 », à 48,01 € — mais il est écarté par la préférence STRICTE pour
        // l'égalité exacte (voir comparerNumeros) : « 019 » et « S19 » ne coïncident que
        // sur les chiffres, et deux candidats coïncident exactement. C'est la règle qui
        // évite de mélanger les numéros à préfixe (TG09, S19, 001C) avec les numéros nus.
        attendEgalite: 2
    },
    {
        nom: 'Wartortle 019 — même carte, nom ANGLAIS',
        lu: { nomLu: 'Wartortle', numeroLu: '019', regionAttendue: 'japonais' },
        attendEgalite: 2
    },
    {
        nom: 'Scizor 074 (e-Series 3) — non-régression',
        lu: { nomLu: 'Scizor', numeroLu: '074', regionAttendue: 'japonais', setCodeLu: 'EC3' },
        attendu: 652068, codeAttendu: 'EC3'
    },
    // ---- L'ARBITRAGE DU NOM ------------------------------------------------
    // Ces cas décident si TCGdex a le droit d'écarter le nom lu. Quand il trouve la carte
    // SANS le nom, il conclut « nom suspect » — inférence fausse dès qu'il n'a pas le set.
    {
        nom: 'ARBITRAGE — Flareon 017 : TCGdex n\'a pas le set, le nom est JUSTE',
        // Trace réelle : total 088 imprimé et correct (EC4 « Split Earth »), mais le seul
        // set de 88 cartes connu de TCGdex est « Perfect Order » (2025). Il a donc rendu
        // « Turtonator » à 0,02 € — et le serveur l'a appris. Le catalogue local corrobore.
        lu: { nomLu: 'Flareon', numeroLu: '017', regionAttendue: 'japonais', total: '088' },
        attendu: 653910, prixAttendu: 239.94, codeAttendu: 'EC4'
    },
    {
        nom: 'ARBITRAGE — Pyroli 017 : la même carte, nom FRANÇAIS',
        lu: { nomLu: 'Pyroli', numeroLu: '017', regionAttendue: 'japonais', total: '088' },
        attendu: 653910, codeAttendu: 'EC4'
    },
    {
        nom: 'ARBITRAGE — Nix 180 : « Nix » EST le nom français de Nita',
        // Je prenais ce cas pour une hallucination : nos noms de catalogue sont anglais,
        // et la lecture était en réalité correcte. nomFr le résout directement.
        lu: { nomLu: 'Nix', numeroLu: '180', regionAttendue: 'occidental', total: '181' },
        attendu: 369105, codeAttendu: 'TEU',
        // TEU a de vraies reverses : l'incertitude est ici MÉRITÉE.
        attendMotifARouter: true
    },
    {
        nom: 'ARBITRAGE — Vesper 175 : nom français d\'Evelyn',
        lu: { nomLu: 'Vesper', numeroLu: '175', regionAttendue: 'occidental', total: '181' },
        attendu: 369100, codeAttendu: 'TEU', attendMotifARouter: true
    },
    {
        nom: 'ARBITRAGE — Kahili 173 : la VRAIE hallucination, doit être REFUSÉE',
        // Dana s'appelle « Méridia » en français, pas « Kahili ». Aucun produit de ce nom
        // ne porte le n°173 : le nom n'est pas corroboré, et le chemin total+numéro doit
        // garder la main. C'est le test qui empêche l'arbitrage de tout avaler.
        lu: { nomLu: 'Kahili', numeroLu: '173', regionAttendue: 'occidental', total: '181' },
        attendNull: true
    },
    {
        nom: 'Numéro absent -> refus explicite',
        lu: { nomLu: 'Arbok', numeroLu: null, regionAttendue: 'japonais' },
        attendNull: true
    },
    {
        nom: 'Nom inconnu du catalogue -> refus explicite',
        lu: { nomLu: 'Zzzzzznexistepas', numeroLu: '099', regionAttendue: 'japonais' },
        attendNull: true
    }
];

// Les noms dont il faut copier les produits (tous ceux qui portent un de ces noms, en
// anglais comme en français, pour que le vivier du bac à sable soit RÉALISTE).
const NOMS_A_COPIER = ['Arbok', 'Rhydon', 'Ledian', 'Wartortle', 'Scizor', 'Flareon', 'Nita', 'Evelyn', 'Dana', 'Kahili'];
// Les noms FRANÇAIS testés, à retrouver via nomFr : ils n'existent pas côté catalogue,
// qui est en anglais. « Nix » = Nita, « Vesper » = Evelyn, « Pyroli » = Flareon.
const NOMS_FR_A_COPIER = [/^Carabaffe$/i, /^Pyroli$/i, /^Nix$/i, /^Vesper$/i, /^Méridia$/i];

let echecs = 0;
function verifier(libelle, obtenu, attendu) {
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    return ok;
}

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI absent du .env');
        process.exit(1);
    }

    // ---- 1. LECTURE de la production ---------------------------------------
    await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE_PROD });
    if (mongoose.connection.db.databaseName !== BASE_PROD) {
        console.error(`❌ ARRÊT : base "${mongoose.connection.db.databaseName}" au lieu de "${BASE_PROD}".`);
        process.exit(1);
    }
    console.log(`🗄️  Lecture depuis "${BASE_PROD}" (production, LECTURE SEULE)`);

    const CatP = mongoose.model('CatP', libre(), 'catalogue_produits');
    const NumP = mongoose.model('NumP', libre(), 'numeros_cartes');
    const CsP = mongoose.model('CsP', libre(), 'codes_set');
    const GuP = mongoose.model('GuP', libre(), 'guide_prix');

    const regexNoms = NOMS_A_COPIER.map(n => new RegExp(`^${n}(\\s*\\[|$)`, 'i'));
    let produits = [];
    for (const r of regexNoms) produits.push(...await CatP.find({ name: r }).lean());
    // Plus tout produit dont le nomFr correspond à un des cas français testés.
    const idsFr = (await NumP.find({ nomFr: { $in: NOMS_FR_A_COPIER } }, { idProduct: 1 }).lean()).map(d => d.idProduct);
    if (idsFr.length) produits.push(...await CatP.find({ idProduct: { $in: idsFr } }).lean());
    const ids = [...new Set(produits.map(p => p.idProduct))];
    produits = [...new Map(produits.map(p => [p.idProduct, p])).values()];

    // ⚠️ On copie les EXPANSIONS ENTIÈRES des candidats, pas seulement les produits qui
    // portent les noms testés. C'est indispensable au contrôle `motifARouter` : il compte
    // les prix holo de toute l'expansion pour savoir si elle contient des impressions
    // reverse. Sur un sous-ensemble, une expansion à reverses pourrait passer pour une
    // expansion sans, et le test validerait un faux « pas de motif à router ».
    const exps = [...new Set(produits.map(p => p.idExpansion).filter(e => e != null))];
    const produitsExps = await CatP.find({ idExpansion: { $in: exps } }).lean();
    produits = [...new Map([...produits, ...produitsExps].map(p => [p.idProduct, p])).values()];
    const idsComplets = produits.map(p => p.idProduct);
    const numeros = await NumP.find({ idProduct: { $in: idsComplets } }).lean();
    const codes = await CsP.find({ idExpansion: { $in: exps } }).lean();
    const guides = await GuP.find({ idProduct: { $in: idsComplets } }).lean();
    console.log(`   copié : ${produits.length} produits, ${numeros.length} numéros, ${codes.length} codes de set, ${guides.length} prix`);
    await mongoose.disconnect();

    // ---- 2. ÉCRITURE en bac à sable, et NULLE PART AILLEURS ----------------
    await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE_SCRATCH });
    const base = mongoose.connection.db.databaseName;
    if (base !== BASE_SCRATCH) {
        console.error(`❌ ARRÊT : base d'écriture "${base}" au lieu de "${BASE_SCRATCH}". Rien n'a été écrit.`);
        process.exit(1);
    }
    console.log(`🗄️  Écriture dans "${base}" (bac à sable)\n`);

    // Les modèles du MODULE TESTÉ pointent sur les mêmes collections : on écrit via des
    // modèles distincts, mais dans la base scratch, donc la fonction lira bien nos copies.
    const CatS = mongoose.model('CatS', libre(), 'catalogue_produits');
    const NumS = mongoose.model('NumS', libre(), 'numeros_cartes');
    const CsS = mongoose.model('CsS', libre(), 'codes_set');
    const GuS = mongoose.model('GuS', libre(), 'guide_prix');

    const nettoyer = async () => {
        await CatS.deleteMany({}); await NumS.deleteMany({});
        await CsS.deleteMany({}); await GuS.deleteMany({});
    };
    await nettoyer();
    const sansId = d => { const o = { ...d }; delete o._id; return o; };
    if (produits.length) await CatS.insertMany(produits.map(sansId));
    if (numeros.length) await NumS.insertMany(numeros.map(sansId));
    if (codes.length) await CsS.insertMany(codes.map(sansId));
    if (guides.length) await GuS.insertMany(guides.map(sansId));

    // ---- 3. LA VRAIE FONCTION ---------------------------------------------
    // Requise APRÈS la connexion, pour que ses modèles guardés se posent sur la base
    // scratch. C'est bien le module de production qui est exercé.
    const { identifierEnLocal } = require('./identification-locale');

    for (const cas of CAS) {
        console.log(`\n=== ${cas.nom} ===`);
        const r = await identifierEnLocal(cas.lu);

        if (cas.attendNull) {
            verifier('refus explicite (null)', r, null);
            continue;
        }
        if (!r) { echecs++; console.log('  ❌ la fonction a rendu null alors qu\'un résultat était attendu'); continue; }

        const g = r.gagnant?.candidat;
        console.log(`  vivier ${r.produits.length} candidat(s) via ${r.voie} (${r.raison}), écart de score ${r.ecartScore}`);
        for (const s of r.scores.slice(0, 4)) {
            console.log(`     ${String(s.candidat.idProduct).padEnd(9)} code=${String(s.candidat.codeSet).padEnd(9)} n°=${String(s.candidat.numeroCardmarket).padEnd(5)} region=${String(s.candidat.region).padEnd(11)} prix=${String(s.candidat.prix).padEnd(9)} score=${s.score}`);
        }

        if (cas.attendEgalite) {
            verifier(`${cas.attendEgalite} candidats`, r.produits.length, cas.attendEgalite);
            verifier('égalité au sommet SIGNALÉE (rien ne départage)', r.egaliteAuSommet, true);
            verifier('   ... et écart de score nul', r.ecartScore, 0);
        } else {
            verifier('le bon produit gagne', g?.idProduct, cas.attendu);
            if (cas.codeAttendu) verifier(`   ... dans l'expansion ${cas.codeAttendu}`, g?.codeSet, cas.codeAttendu);
            if (cas.prixAttendu != null) verifier('   ... au bon prix', g?.prix, cas.prixAttendu);
            if (cas.doitEcarter) {
                const rangEcarte = r.scores.findIndex(s => s.candidat.idProduct === cas.doitEcarter);
                verifier(`   ... et l'homonyme occidental ${cas.doitEcarter} est derrière`, rangEcarte > 0, true);
            }
            verifier('   ... rang du numéro = 1', r.rangs.rangGagnant, 1);
        }
        // L'incertitude n'est plus systématique : elle est JUSTIFIÉE ou elle tombe.
        // Mesuré : les 521 produits des cinq séries e-Reader n'ont AUCUN trendHolo > 0,
        // donc aucune impression reverse à router — marquer douteux un prix juste userait
        // le drapeau pour rien. Sur les cas à égalité, en revanche, elle est méritée.
        if (cas.attendEgalite) {
            verifier('incertain — car rien ne départage les deux premiers', r.incertain, true);
        } else if (cas.attendMotifARouter) {
            // Set moderne : il a de vraies reverses, l'incertitude est méritée.
            verifier('cette expansion A des reverses -> motif à router', r.motifARouter, true);
            verifier('   ... donc marqué incertain, à juste titre', r.incertain, true);
        } else {
            verifier('aucun motif de reverse à router dans cette expansion', r.motifARouter, false);
            verifier('   ... donc PAS marqué incertain (identification nette)', r.incertain, false);
        }
    }

    // ---- 4. Nettoyage, vérifié --------------------------------------------
    await nettoyer();
    const restes = await CatS.countDocuments({}) + await NumS.countDocuments({})
        + await CsS.countDocuments({}) + await GuS.countDocuments({});
    console.log(`\n🧹 Nettoyage : ${restes} document(s) résiduel(s) dans "${base}" (attendu : 0).`);
    if (restes !== 0) echecs++;

    await mongoose.disconnect();
    console.log(`\n${echecs === 0 ? '🎉 Tous les cas passent.' : `⚠️ ${echecs} assertion(s) en échec.`}`);
    process.exit(echecs === 0 ? 0 : 1);
}

main().catch(async e => {
    console.error('❌ Erreur :', e.message, e.stack);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
