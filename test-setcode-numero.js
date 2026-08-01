// ============================================================
// TEST DU CHEMIN « setCode lu + numéro lu » ET DE SON VETO
// ============================================================
// Ce test appelle les VRAIES fonctions d'index.js, pas une réécriture. C'est délibéré :
// la seule contradiction sérieuse de ce chantier — « la simulation dit 3 candidats, la
// production en rend 2 » — venait d'un script de mesure qui réimplémentait la règle et
// oubliait la préférence stricte pour l'égalité exacte. Un test qui réécrit le code testé
// ne teste que sa propre réécriture.
//
// LECTURE SEULE, sur la base de PRODUCTION. Aucune de ces fonctions n'écrit ; le test non
// plus. Les valeurs attendues viennent du catalogue Cardmarket réel et du journal de
// production, jamais d'une supposition.
//
// USAGE : node test-setcode-numero.js

require('dotenv').config();
const mongoose = require('mongoose');
const { trouverParSetCodeEtNumero, nomOpposeUnVeto } = require('./index');

let ok = 0, ko = 0;
function verifier(libelle, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`  ${bon ? '✅' : '❌'} ${libelle} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}

(async () => {
    // index.js ouvre SA PROPRE connexion au chargement. On l'attend au lieu d'en ouvrir une
    // seconde : les fonctions testées lisent `mongoose.connection.readyState`, donc elles
    // doivent voir exactement la connexion que le serveur utiliserait.
    const debut = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - debut < 30000) {
        await new Promise(r => setTimeout(r, 100));
    }
    if (mongoose.connection.readyState !== 1) { console.error('❌ MongoDB non connecté.'); process.exit(1); }
    console.log(`\nbase : ${mongoose.connection.db.databaseName} (lecture seule)\n`);

    // ---- 1. LE CAS QUI MOTIVE LE CHEMIN ------------------------------------
    // Aquali δ : TCGdex avait trouvé la bonne carte, et le catalogue a été interrogé
    // avec le nom d'affichage japonais « Vaporeon（デルタ種）» -> 0 candidat.
    console.log('=== 1. Aquali δ — PCG6 + 030 ===');
    {
        const r = await trouverParSetCodeEtNumero('PCG6', '030');
        verifier('un seul produit', r.length, 1);
        verifier('c\'est le bon idProduct', r[0]?.idProduct, 765019);
    }

    // ---- 2. L'ALIAS e-Reader -----------------------------------------------
    // Le marquage physique lu sur la carte est « e2 », le code Cardmarket est « EC2 ».
    console.log('\n=== 2. L\'alias E1..E5 -> EC1..EC5 s\'applique au code LU ===');
    {
        const r = await trouverParSetCodeEtNumero('e2', '063');
        verifier('e2+063 -> un produit', r.length, 1);
        verifier('c\'est le Porygon2 d\'EC2', r[0]?.idProduct, 651965);
    }

    // ---- 3. LE VETO : le cas Meowth ----------------------------------------
    // « e3 » lu pour « e4 » : le chemin désigne un Dodrio. Le nom doit le refuser.
    console.log('\n=== 3. Le veto — « e3 » lu pour « e4 » désigne un Dodrio ===');
    {
        const r = await trouverParSetCodeEtNumero('e3', '062');
        verifier('e3+062 -> un produit', r.length, 1);
        verifier('c\'est bien le Dodrio d\'EC3', r[0]?.idProduct, 652056);
        const avis = await nomOpposeUnVeto(
            { name: 'Meowth', number: '062', nomBrut: 'ニャース', nomConfiance: 'haute' }, r[0]
        );
        verifier('le veto REFUSE Dodrio', avis.veto, true);
        console.log(`       raison : ${avis.raison}`);
    }

    // ---- 4. LES DEUX GARDE-FOUS DU VETO ------------------------------------
    console.log('\n=== 4. Les deux garde-fous ===');
    {
        const r = await trouverParSetCodeEtNumero('e3', '062');   // Dodrio

        // (b) confiance non haute -> désarmé. Sans cela, un nom halluciné opposerait son
        // veto à un code correct : le bug d'origine reconstruit à l'envers.
        const basse = await nomOpposeUnVeto({ name: 'Meowth', number: '062', nomConfiance: 'basse' }, r[0]);
        verifier('confiance basse -> veto DÉSARMÉ', basse.veto, false);
        const absente = await nomOpposeUnVeto({ name: 'Meowth', number: '062' }, r[0]);
        verifier('confiance absente -> veto DÉSARMÉ', absente.veto, false);

        // (a) PREUVE POSITIVE. « Kahili » est la vraie hallucination du corpus (Dana
        // s'appelle « Méridia » en français). Piège mesuré : « Kahili » désigne 8 produits
        // RÉELS au catalogue — la carte existe. Ce qui n'existe pas, c'est un Kahili AU
        // NUMÉRO LU. C'est cette seconde condition, et elle seule, qui sépare une lecture
        // de code fautive (Meowth) d'une lecture de nom fautive (Kahili).
        const halluciné = await nomOpposeUnVeto({ name: 'Kahili', number: '173', nomConfiance: 'haute' }, r[0]);
        verifier('nom halluciné -> pas de preuve au n°173, on LAISSE PASSER', halluciné.veto, false);
        console.log(`       raison : ${halluciné.raison}`);

        // Le même nom, SANS numéro lu : la preuve ne peut pas être établie.
        const sansNum = await nomOpposeUnVeto({ name: 'Meowth', nomConfiance: 'haute' }, r[0]);
        verifier('aucun numéro lu -> veto impossible', sansNum.veto, false);

        // Concordance : le vrai Meowth d'EC4 ne doit évidemment pas être refusé.
        const vrai = await trouverParSetCodeEtNumero('e4', '062');
        verifier('e4+062 -> le Meowth d\'EC4', vrai[0]?.idProduct, 653971);
        const avisVrai = await nomOpposeUnVeto({ name: 'Meowth', number: '062', nomBrut: 'ニャース', nomConfiance: 'haute' }, vrai[0]);
        verifier('le veto LAISSE PASSER le bon Meowth', avisVrai.veto, false);

        // Le Flareon/Turtonator, le verdict le plus cher du journal : 0,02 € au lieu de
        // 239,94 €. Rendu avec confiance (incertain=false) le 30 juillet.
        const turtonator = await trouverParSetCodeEtNumero('m3', '017');
        if (turtonator.length === 1) {
            const avisT = await nomOpposeUnVeto({ name: 'Flareon', number: '017', nomBrut: 'ブースター', nomConfiance: 'haute' }, turtonator[0]);
            verifier('le veto REFUSE Turtonator pour un Flareon', avisT.veto, true);
            console.log(`       raison : ${avisT.raison}`);
        } else {
            console.log(`  ℹ️ m3+017 rend ${turtonator.length} produit(s) — cas non rejouable par ce chemin.`);
        }
    }

    // ---- 5. LES CAS OÙ LE CHEMIN NE PEUT PAS RÉPONDRE ----------------------
    // Ils comptent autant que les autres : c'est ce qui justifie que le nom prenne le
    // relais ensuite, plutôt que de déclarer un échec.
    console.log('\n=== 5. Ce que le chemin ne couvre pas, et doit rendre proprement ===');
    {
        // ROG : 65 produits, 65 déjà lus, AUCUN numéro publié par Cardmarket.
        verifier('ROG+149 (Dracolosse obscur) -> aucun produit', (await trouverParSetCodeEtNumero('ROG', '149')).length, 0);
        verifier('setCode absent -> aucun produit', (await trouverParSetCodeEtNumero(null, '053')).length, 0);
        verifier('numéro absent -> aucun produit', (await trouverParSetCodeEtNumero('ROG', null)).length, 0);
        verifier('code inconnu du catalogue -> aucun produit', (await trouverParSetCodeEtNumero('ZZZZ9', '001')).length, 0);
    }

    console.log(`\n${ko === 0 ? '🎉' : '💥'} ${ok}/${ok + ko} assertions passées.`);
    await mongoose.disconnect();
    process.exit(ko === 0 ? 0 : 1);
})().catch(async e => {
    console.error('❌ ERREUR', e.message, e.stack);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
