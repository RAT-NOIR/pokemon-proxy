// ============================================================
// TEST DU JOURNAL DES ÉCHECS — écrit pour de vrai, relit, nettoie
// ============================================================
// POURQUOI CE TEST EXISTE. `enregistrerEchec` est FIRE-AND-FORGET : elle avale ses
// propres erreurs, par conception (un scan déjà perdu ne doit pas l'être deux fois
// parce que sa statistique n'a pas pu s'écrire). Conséquence directe : si elle ne
// marchait pas du tout, RIEN ne le dirait. Ni le smoke test, ni les routes, ni les
// logs. Le seul moyen de savoir qu'elle écrit est d'aller regarder ce qu'elle a écrit.
//
// CE QU'IL VÉRIFIE, ET QUI NE SE DÉDUIT PAS DU CODE :
//   1. la ligne d'échec est bien écrite, avec resultat='echec' ;
//   2. `cardInfo` est correctement aplati — c'est là qu'un champ se perd en silence ;
//   3. `rang` et `setCodeAccord` ne sont PLUS écrits (supprimés le 2026-08-18, champs
//      dérivés que rien ne lisait) ET que leur formule de recalcul les retrouve depuis
//      les champs journalisés — sinon « recalculable » n'est qu'une promesse ;
//   4. `rembourse` distingue false de null : « remboursement tenté et refusé » n'est
//      pas « pas de remboursement du tout » ;
//   5. un succès reste un succès (resultat='succes' sans qu'aucun appelant le passe) ;
//   6. l'index TTL est bien celui du champ `le`, et à 90 jours.
//
// BASE : test_scratch, JAMAIS la production. Le refus est explicite plus bas.
// USAGE : node test-journal-echecs.js

require('dotenv').config();
const mongoose = require('mongoose');
const { enregistrerScan, enregistrerEchec, JournalScan, RETENTION_JOURS, memeCode } = require('./journal-scans');
// ⚠️ IMPORTÉE, JAMAIS RECOPIÉE. `rangDuNumero` est la fonction qui écrivait le champ
// `rang` avant sa suppression : c'est elle qui doit prouver qu'il reste recalculable,
// pas une réimplémentation, qui ne démontrerait que sa propre cohérence.
const { rangDuNumero } = require('./scoring');

const BASE = process.env.MONGODB_BASE || 'test_scratch';
// ⚠️ La base de PRODUCTION s'appelle « test ». Ce n'est pas un nom de bac à sable et
// c'est exactement le piège : un test qui écrit dans « test » écrit chez les clients.
if (BASE !== 'test_scratch') {
    console.error(`❌ REFUS : ce test écrit. Base demandée « ${BASE} », seule « test_scratch » est acceptée.`);
    process.exit(1);
}

// Marqueur unique : le nettoyage final ne supprimera QUE les lignes de ce test, même si
// la collection contient déjà autre chose.
const MARQUEUR = `__test-echecs-${Date.now()}`;

let ok = 0, ko = 0;
function verifier(libelle, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`  ${bon ? '✅' : '❌'} ${libelle} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}

// L'écriture est fire-and-forget : elle n'est pas terminée quand la fonction rend la
// main. On attend la ligne au lieu de dormir une durée choisie au hasard.
async function attendreLigne(filtre, limiteMs = 5000) {
    const debut = Date.now();
    while (Date.now() - debut < limiteMs) {
        const doc = await JournalScan.findOne(filtre).lean();
        if (doc) return doc;
        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE });
    const reelle = mongoose.connection.db.databaseName;
    if (reelle !== 'test_scratch') {
        console.error(`❌ REFUS : connecté à « ${reelle} », pas à test_scratch.`);
        process.exit(1);
    }
    console.log(`Base : ${reelle}\n`);

    // ---- 1. UN ÉCHEC AVEC LECTURE IA -------------------------------------------
    // Le cas Dracolosse, tel que la trace réelle le donne : nomBrut en katakana, aucun
    // total imprimé (les japonaises d'avant 2000 n'en portent pas), setCode lu « ROG ».
    console.log('=== 1. Échec « carte-introuvable », avec ce que l\'IA avait lu ===');
    enregistrerEchec({
        route: 'identifier', userId: MARQUEUR,
        cardInfo: {
            name: 'Dark Dragonite', number: '149', total: null, setCode: 'ROG',
            language: 'JP', rarete: 'Holo Rare', nomBrut: 'わるいカイリュー', nomConfiance: 'haute',
            // ⚠️ VALEUR RÉELLE, PAS UNE FIXTURE INVENTÉE : « R » est le symbole que l'IA
            // rend sur les Rocket Gang, et le journal de production en porte 14.
            symboleSet: 'R'
        },
        motifEchec: 'carte-introuvable', rembourse: true,
        // Le vivier au moment du refus : deux produits vus par le scoring, aucun retenu.
        vivierIds: [585151, 650617], vivierTaille: 2,
        symboleDepartage: 'symbole « R » lu, mais aucun ex aequo ne le porte',
        // Les deux URL qui rendent la ligne revérifiable des mois plus tard.
        imageUrl: 'https://images1.vinted.net/t/00_01234_photo.jpeg',
        vintedUrl: 'https://www.vinted.fr/items/1234567890-carte-pokemon'
    });
    const echec = await attendreLigne({ userId: MARQUEUR, motifEchec: 'carte-introuvable' });
    if (!echec) {
        console.log('  ❌ AUCUNE ligne écrite — le journal des échecs ne fonctionne pas.');
        ko++;
    } else {
        verifier('resultat', echec.resultat, 'echec');
        verifier('motifEchec', echec.motifEchec, 'carte-introuvable');
        verifier('rembourse', echec.rembourse, true);
        verifier('route', echec.route, 'identifier');
        // L'aplatissement de cardInfo : name -> nom, number -> numero, language -> langue.
        // Trois renommages, trois occasions de perdre un champ sans que rien ne proteste.
        verifier('nom', echec.nom, 'Dark Dragonite');
        verifier('numero', echec.numero, '149');
        verifier('setCode', echec.setCode, 'ROG');
        verifier('langue', echec.langue, 'JP');
        verifier('rarete', echec.rarete, 'Holo Rare');
        verifier('nomBrut', echec.nomBrut, 'わるいカイリュー');
        verifier('nomConfiance', echec.nomConfiance, 'haute');
        // ════════════════════════════════════════════════════════════════════
        // 🔴 LES TROIS ASSERTIONS QUI AURAIENT ATTRAPÉ LE TROU — 2026-09-02
        // ════════════════════════════════════════════════════════════════════
        // `symboleSet` était le SEUL champ de `cardInfo` que `enregistrerEchec` n'aplatissait
        // pas. Résultat en production : « symbole non lu, 30 fois sur 30 » sur la voie du
        // refus — un zéro parfait, qui a été lu comme un taux de lecture pendant des
        // semaines alors qu'il décrivait un transport manquant.
        // ⚠️ CE FICHIER ÉTAIT VERT PENDANT TOUT CE TEMPS, et il l'était légitimement : il
        // vérifiait sept champs de `cardInfo` sur huit. Le trou n'était pas dans une
        // assertion fausse, il était dans une assertion ABSENTE — et une assertion absente
        // ne se voit jamais, par construction. C'est le point 2 de l'en-tête (« c'est là
        // qu'un champ se perd en silence ») qui s'est vérifié sur le champ non couvert.
        // 🔑 LA RÈGLE QU'ON EN TIRE : quand un test aplatit un objet, il doit couvrir
        // TOUS ses champs, pas un échantillon. Un échantillon prouve que l'aplatissement
        // existe ; il ne prouve rien sur le champ qu'il ne nomme pas.
        verifier('symboleSet aplati depuis cardInfo', echec.symboleSet, 'R');
        // Le vivier sur une ligne de refus : sans lui, « la bonne carte y était-elle ? »
        // n'a pas de réponse, et c'est la question qui sépare défaut de vivier et défaut
        // de départage. Absent de 32 refus sur 35 au 2026-09-02.
        verifier('vivierIds écrit sur un refus', echec.vivierIds, [585151, 650617]);
        verifier('vivierTaille écrite sur un refus', echec.vivierTaille, 2);
        // La phrase du symbole, MÊME quand il n'a rien tranché : c'est ce cas-là qu'on
        // cherchait, et il était invisible.
        verifier('symboleDepartage écrit sur un refus',
            echec.symboleDepartage, 'symbole « R » lu, mais aucun ex aequo ne le porte');
        // total absent de la carte -> absent de la ligne. C'est une information, pas un trou.
        verifier('total (aucun imprimé sur la carte)', echec.total ?? null, null);
        // ⚠️ `rang` a été SUPPRIMÉ le 2026-08-18 (champ dérivé, jamais lu). Le point qui
        // ne se déduit pas du code reste vrai et se vérifie maintenant sur la FORMULE :
        // rangDuNumero('149', null) rend 2, et ce 2 ne doit jamais compter sur un échec,
        // où il n'y a pas de gagnant du tout.
        verifier('`rang` n\'est plus écrit sur un échec', echec.rang ?? null, null);
        verifier('  ... et sa formule rend bien null sur un échec',
            echec.motifEchec ? null : rangDuNumero(echec.numero, echec.numeroGagnant), null);
        verifier('  ... alors que rangDuNumero seul rendrait 2', rangDuNumero(echec.numero, null), 2);
        verifier('idProduct nul', echec.idProduct ?? null, null);
        // Sans ces deux URL, une ligne d'échec ne peut plus être revérifiée dès que
        // l'annonce disparaît — c'est ce qui a coûté trois lignes du premier banc.
        verifier('imageUrl conservée', echec.imageUrl, 'https://images1.vinted.net/t/00_01234_photo.jpeg');
        verifier('vintedUrl conservée', echec.vintedUrl, 'https://www.vinted.fr/items/1234567890-carte-pokemon');
    }

    // ---- 2. L'IA N'A RIEN RENDU ------------------------------------------------
    console.log('\n=== 2. Échec « ia-echec » : la lecture elle-même a échoué ===');
    enregistrerEchec({
        route: 'identifier', userId: MARQUEUR, cardInfo: null,
        motifEchec: 'ia-echec', rembourse: false
    });
    const iaEchec = await attendreLigne({ userId: MARQUEUR, motifEchec: 'ia-echec' });
    if (!iaEchec) { console.log('  ❌ aucune ligne'); ko++; }
    else {
        verifier('resultat', iaEchec.resultat, 'echec');
        // false = remboursement TENTÉ et refusé (plafond, poche pleine, Mongo absent).
        // null aurait voulu dire « pas de remboursement du tout ». Ce n'est pas pareil,
        // et c'est la différence entre « scan payé pour rien » et « rien à rendre ».
        verifier('rembourse=false, pas null', iaEchec.rembourse, false);
        verifier('nom absent (rien n\'a été lu)', iaEchec.nom ?? null, null);
    }

    // ---- 3. UN SUCCÈS RESTE UN SUCCÈS ------------------------------------------
    // Aucun appelant du chemin nominal ne passe `resultat` : il doit se déduire de
    // l'ABSENCE de motifEchec. Si ce test tombe, les lignes de succès sont classées
    // en échec et toute la mesure s'inverse.
    console.log('\n=== 3. Le chemin de succès n\'est pas touché ===');
    enregistrerScan({
        route: 'identifier', userId: MARQUEUR,
        nom: 'Charmander', numero: '4', langue: 'EN', idProduct: 999999999
    });
    const succes = await attendreLigne({ userId: MARQUEUR, nom: 'Charmander' });
    if (!succes) { console.log('  ❌ aucune ligne'); ko++; }
    else {
        verifier('resultat', succes.resultat, 'succes');
        verifier('motifEchec absent', succes.motifEchec ?? null, null);
        verifier('rembourse absent', succes.rembourse ?? null, null);

        // ── LES DEUX CHAMPS DÉRIVÉS SUPPRIMÉS LE 2026-08-18 ────────────────────
        // ⚠️ UNE PROMESSE DE RECALCUL LAISSÉE EN COMMENTAIRE N'ENGAGE PERSONNE. Les
        // deux champs ont été supprimés parce qu'ils se recalculent depuis des sources
        // journalisées ; ce qui suit vérifie que c'est encore vrai à chaque exécution,
        // avec les fonctions nommées dans les commentaires de suppression.
        verifier('`rang` n\'est plus écrit', succes.rang ?? null, null);
        verifier('`setCodeAccord` n\'est plus écrit', succes.setCodeAccord ?? null, null);
        // idProduct inexistant au catalogue -> pas de numéro gagnant -> rang 2
        // (« son numéro est inconnu »). C'est ce que le champ valait avant, et c'est ce
        // que sa formule doit continuer à rendre depuis la ligne seule.
        verifier('  ... mais la FORMULE de `rang` le retrouve depuis la ligne',
            succes.motifEchec ? null : rangDuNumero(succes.numero, succes.numeroGagnant), 2);
        verifier('  ... et celle de `setCodeAccord` aussi',
            memeCode(succes.setCode, succes.codeSetGagnant), null);
    }

    // ---- 4. LE TTL -------------------------------------------------------------
    // Le journal ne doit pas croître sans surveillance. L'index TTL est la seule chose
    // qui l'en empêche, et personne ne s'apercevrait de sa disparition avant longtemps.
    console.log('\n=== 4. L\'index TTL ===');
    const index = await JournalScan.collection.indexes();
    const ttl = index.find(i => i.expireAfterSeconds != null);
    verifier('un index TTL existe', Boolean(ttl), true);
    if (ttl) {
        verifier('il porte sur le champ `le`', Object.keys(ttl.key)[0], 'le');
        verifier(`durée = ${RETENTION_JOURS} jours`, ttl.expireAfterSeconds, RETENTION_JOURS * 86400);
    }

    // ---- NETTOYAGE -------------------------------------------------------------
    const supprimes = await JournalScan.deleteMany({ userId: MARQUEUR });
    const restants = await JournalScan.countDocuments({ userId: MARQUEUR });
    console.log(`\n🧹 ${supprimes.deletedCount} ligne(s) de test supprimée(s), ${restants} restante(s).`);
    if (restants !== 0) { console.log('  ❌ nettoyage incomplet'); ko++; }

    console.log(`\n${ko === 0 ? '🎉' : '💥'} ${ok}/${ok + ko} assertions passées.`);
    await mongoose.disconnect();
    process.exit(ko === 0 ? 0 : 1);
})().catch(async e => {
    console.error('❌ ERREUR', e.message, e.stack);
    try { await JournalScan.deleteMany({ userId: MARQUEUR }); await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
