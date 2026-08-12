// ============================================================
// TEST DE /api/retour-live — les trois gardes, exercées pour de vrai
// ============================================================
// POURQUOI CE TEST EXISTE. Cette route est la SEULE qui modifie une ligne de journal déjà
// écrite, au lieu d'en ajouter une. Et la donnée qu'elle reçoit — le prix live — est
// exactement celle qui servira à calibrer un seuil. Une route qui accepterait des prix
// arbitraires pour des scans arbitraires empoisonnerait la seule mesure qui doit rester
// propre, et la pollution ne se verrait qu'au moment de calibrer, six semaines plus tard,
// sans moyen de savoir quelles lignes écarter.
//
// LES TROIS GARDES, ET CE QUI SE PASSERAIT SANS ELLES :
//   1. le scanId doit EXISTER            -> sinon des lignes fantômes, ou des CastError en 500
//   2. il doit APPARTENIR au userId      -> l'identifiant voyage dans une réponse HTTP, ce
//                                           n'est pas un secret : sans cette garde,
//                                           n'importe qui écrit dans la ligne d'un autre
//   3. un SECOND retour est REFUSÉ       -> un prix live est une observation datée ;
//                                           l'écraser effacerait la première sans trace et
//                                           permettrait de pousser une valeur jusqu'à ce
//                                           qu'elle arrange
//
// ⚠️ ON TESTE LA ROUTE, PAS UNE RÉIMPLÉMENTATION. Le serveur réel est démarré, hors ligne,
// et interrogé en HTTP — c'est la leçon du stub fabriqué à la main : une simulation qui
// « vérifie » un chemin que la production n'emprunte pas ne prouve rien.
//
// BASE : test_scratch, JAMAIS la production. Le refus est explicite plus bas.
// USAGE : node test-retour-live.js

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const { demarrer, appeler } = require('./verrou/serveur');
const { JournalScan } = require('./journal-scans');

const BASE = 'test_scratch';
// ⚠️ La base de PRODUCTION s'appelle « test ». Ce n'est pas un nom de bac à sable, et
// c'est exactement le piège : un test qui écrit dans « test » écrit chez les clients.
if ((process.env.MONGODB_BASE || BASE) !== BASE) {
    console.error(`❌ REFUS : ce test écrit. Seule « ${BASE} » est acceptée.`);
    process.exit(1);
}

const JETON = process.env.JETON_API || 'jeton-retour-live';
const MOI = `__test-retour-${Date.now()}`;
const AUTRE = `${MOI}-autre`;

let ok = 0, ko = 0;
function verifier(libelle, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`  ${bon ? '✅' : '❌'} ${libelle} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE });
    if (mongoose.connection.db.databaseName !== BASE) {
        console.error(`❌ REFUS : connecté à « ${mongoose.connection.db.databaseName} ».`);
        process.exit(1);
    }

    // Une ligne de scan réelle, écrite par le vrai modèle — pas un document bricolé.
    const scan = await JournalScan.create({ route: 'identifier', userId: MOI, idProduct: 606889, nom: 'Dark Porygon2' });
    const scanId = String(scan._id);
    const inconnu = String(new mongoose.Types.ObjectId());

    // ⚠️ LE FAUX RÉSEAU EST ARMÉ ALORS QUE CETTE ROUTE N'APPELLE RIEN — et c'est le
    // point. Il LÈVE sur tout appel sortant non enregistré : si /api/retour-live se
    // mettait un jour à interroger TCGdex ou le modèle, ce test le verrait au lieu de
    // laisser passer un appel réseau ajouté sans y penser dans une fonction en amont.
    // (Il refuse aussi de démarrer sans VERROU_CHARGES, d'où le fichier passé ici.)
    const srv = await demarrer(path.join(__dirname, 'verrou', 'faux-reseau.js'), {
        JETON_API: JETON, OPENROUTER_API_KEY: '', MONGODB_BASE: BASE,
        VERROU_CHARGES: path.join(__dirname, 'verrou', 'charges.json')
    });
    if (!await srv.attendreMongo()) { console.error('❌ Mongo non connecté côté serveur.'); process.exit(1); }

    const poster = (corps, jeton = JETON) => appeler(srv.port, 'POST', '/api/retour-live', corps, jeton);

    console.log('\n=== Le jeton est exigé ===');
    verifier('sans jeton -> 401', (await poster({ userId: MOI, scanId, prixLive: 12 }, 'mauvais')).status, 401);

    console.log('\n=== Entrées invalides : 400, jamais 500 ===');
    verifier('sans scanId -> 400', (await poster({ userId: MOI, prixLive: 12 })).status, 400);
    verifier('scanId mal formé -> 400 (et non un CastError en 500)', (await poster({ userId: MOI, scanId: 'pas-un-objectid', prixLive: 12 })).status, 400);
    verifier('prixLive à 0 -> 400 (un 0 n\'est pas un prix)', (await poster({ userId: MOI, scanId, prixLive: 0 })).status, 400);
    verifier('prixLive négatif -> 400', (await poster({ userId: MOI, scanId, prixLive: -3 })).status, 400);
    verifier('état hors énumération -> 400', (await poster({ userId: MOI, scanId, prixLive: 12, prixLiveEtat: 'PARFAIT' })).status, 400);

    console.log('\n=== GARDE 1 — le scanId doit exister ===');
    verifier('scanId inconnu -> 404', (await poster({ userId: MOI, scanId: inconnu, prixLive: 12 })).status, 404);

    console.log('\n=== GARDE 2 — le scanId doit appartenir au posteur ===');
    verifier('scan d\'un autre userId -> 403', (await poster({ userId: AUTRE, scanId, prixLive: 12 })).status, 403);
    const apresTentative = await JournalScan.findById(scanId).lean();
    verifier('   ... et la ligne n\'a PAS été touchée', apresTentative.prixLive ?? null, null);

    console.log('\n=== Le retour légitime passe, et écrit ce qu\'on lui donne ===');
    verifier('retour valide -> 200', (await poster({
        userId: MOI, scanId, prixLive: 24.13, prixLiveEtat: 'ex', prixLiveCodeLangue: 7,
        prixLiveTendance: 29.07, prixLiveNM: 31.5,
        // ⚠️ « pastèque » n'est pas un état : la clé doit être ÉCARTÉE, pas stockée.
        grilleLive: { NM: 31.5, ex: 24.13, GD: 24.13, 'pastèque': 9 },
        // Compteurs VOLONTAIREMENT FAUX : la grille doit faire foi et le désaccord être tracé.
        grilleNbEtats: 99, grilleValeursDistinctes: 99
    })).status, 200);
    const ecrite = await JournalScan.findById(scanId).lean();
    verifier('   prixLive écrit', ecrite.prixLive, 24.13);
    verifier('   état normalisé en majuscules', ecrite.prixLiveEtat, 'EX');
    verifier('   code langue écrit', ecrite.prixLiveCodeLangue, 7);
    verifier('   retourLe horodaté', ecrite.retourLe instanceof Date, true);
    verifier('   tendance écrite', ecrite.prixLiveTendance, 29.07);
    verifier('   prix NM écrit', ecrite.prixLiveNM, 31.5);
    // La grille est une Map côté mongoose : on la relit en objet pour comparer.
    const g = ecrite.grilleLive instanceof Map ? Object.fromEntries(ecrite.grilleLive) : ecrite.grilleLive;
    verifier('   grille normalisée, clé hors ORDRE_ETATS écartée', g, { NM: 31.5, EX: 24.13, GD: 24.13 });
    // ⚠️ LE POINT QUI COMPTE : les compteurs sont DÉDUITS de la grille, pas recopiés.
    // Envoyés à 99/99, ils ressortent à 3/2 — une seule source pour un même fait.
    verifier('   nbEtats DÉDUIT de la grille (99 envoyé, ignoré)', ecrite.grilleNbEtats, 3);
    verifier('   valeurs distinctes DÉDUITES (24,13 compte une fois)', ecrite.grilleValeursDistinctes, 2);
    // ⚠️ CE QUI NE DOIT PAS AVOIR BOUGÉ. La route COMPLÈTE une ligne, elle ne la réécrit
    // pas : un $set trop large effacerait le scan lui-même, et personne ne le verrait.
    verifier('   idProduct intact', ecrite.idProduct, 606889);
    verifier('   userId intact', ecrite.userId, MOI);

    console.log('\n=== GARDE 3 — un second retour est REFUSÉ, pas écrasé ===');
    verifier('second retour -> 409', (await poster({ userId: MOI, scanId, prixLive: 999 })).status, 409);
    const apresSecond = await JournalScan.findById(scanId).lean();
    verifier('   ... et le premier prix est INTACT', apresSecond.prixLive, 24.13);

    console.log('\n=== Sans grille, les deux entiers sont pris tels quels ===');
    // Ce sont alors les SEULS témoins de la forme de l'offre : les refuser reviendrait à
    // exiger la grille complète, que l'extension ne peut pas toujours lire.
    const scan2 = await JournalScan.create({ route: 'identifier', userId: MOI, idProduct: 1, nom: 'sans-grille' });
    verifier('retour sans grille -> 200', (await poster({
        userId: MOI, scanId: String(scan2._id), prixLive: 0.02,
        grilleNbEtats: 2, grilleValeursDistinctes: 1
    })).status, 200);
    const sansGrille = await JournalScan.findById(scan2._id).lean();
    verifier('   nbEtats conservé', sansGrille.grilleNbEtats, 2);
    verifier('   valeurs distinctes conservées (grille plate)', sansGrille.grilleValeursDistinctes, 1);
    verifier('   aucune grille inventée', sansGrille.grilleLive ?? null, null);

    console.log('\n=== Aucun crédit débité ===');
    // La route ne passe pas par verifierAcces : renvoyer une mesure ne doit rien coûter,
    // sinon personne ne la renvoie et la donnée n'existe jamais.
    const credits = await mongoose.connection.db.collection('credits').findOne({ userId: MOI });
    verifier('aucune ligne de crédit créée pour ce userId', credits ?? null, null);

    // ── Nettoyage : uniquement les lignes de ce test ──────────────────────────
    await JournalScan.deleteMany({ userId: { $in: [MOI, AUTRE] } });
    try { srv.enfant.send('arret'); } catch (_) { srv.enfant.kill(); }
    await mongoose.disconnect();

    console.log(`\n${ko === 0 ? '🎉' : '❌'} ${ok} vérification(s) passées, ${ko} en échec.`);
    setTimeout(() => { try { srv.enfant.kill(); } catch (_) { } process.exit(ko === 0 ? 0 : 1); }, 1500);
})().catch(e => { console.error(e.stack); process.exit(1); });
