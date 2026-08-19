// ============================================================================
// LA CHAÎNE ARGENT NE PART JAMAIS SANS PREUVE
// ============================================================================
// CE QUI EST TESTÉ : `rembourserSiRienLivre`, LA FONCTION EXACTE que les deux `catch`
// appellent — pas une copie de sa logique. Un test qui réimplémente ce qu'il vérifie ne
// prouve rien : c'est l'erreur d'instrument n°3 de la liste (l'objet de scoring fabriqué
// à la main, 52 assertions vertes sur un appel qui tuait la production).
//
// LE CAS QUI L'A MOTIVÉ : deux scans du 2026-08-03 sortis en `erreur-serveur` avec
// `rembourse: false`. Crédit débité, rien livré, rien rendu. Un bug serveur facturé.
//
// ⚠️ BASE : test_scratch, JAMAIS la production. La base de prod s'appelle « test » — le
// piège est le nom, pas l'intention. Ce script REFUSE de tourner ailleurs.
// USAGE : node test-remboursement-catch.js
process.env.MONGODB_BASE = 'test_scratch';
require('dotenv').config();
const mongoose = require('mongoose');

let echecs = 0;
const v = (nom, obtenu, attendu) => {
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : `  (attendu ${JSON.stringify(attendu)})`}`);
};

(async () => {
    // ⚠️ L'ORDRE COMPTE : c'est `require('./index')` qui OUVRE la connexion Mongo (il le
    // fait au chargement, avec MONGODB_BASE lu en tête de ce fichier). Attendre la
    // connexion AVANT de le charger attend donc quelque chose que personne n'a demandé.
    const { rembourserSiRienLivre } = require('./index');
    const { Credit, Remboursement } = require('./acces');
    // ⚠️ CHAQUE CAS TOURNE DANS SON PROPRE CONTEXTE DE SCAN. `noterNonRemboursement`
    // n'écrit qu'UNE fois par contexte — le premier refus est celui qui compte — donc
    // partager un contexte entre deux cas ferait passer la raison du premier pour celle
    // du second, et le test se mentirait à lui-même.
    const { dansUnScan, raisonNonRemboursement, RAISONS_NON_REMBOURSE } = require('./sources');
    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.readyState !== 1) { console.error('❌ Mongo non connecté.'); process.exit(1); }
    // ⚠️ GARDE DURE : on ne touche pas la production, même par accident de variable.
    const base = mongoose.connection.db.databaseName;
    if (base !== 'test_scratch') {
        console.error(`❌ REFUS : base « ${base} », attendu « test_scratch ». La base de PROD s'appelle « test ».`);
        process.exit(1);
    }
    console.log(`base : ${base}\n`);

    const neuf = s => `T-catch-${s}-${Date.now()}`;

    // ── 1. RIEN N'A ÉTÉ LIVRÉ -> LE CRÉDIT EST RENDU ────────────────────
    {
        const u = neuf('rendu');
        await Credit.deleteOne({ userId: u });
        await Credit.create({ userId: u, soldeGratuit: 10, soldePayant: 0 });
        // Un `req` tel que la route l'a au moment du catch : le middleware a débité.
        const req = { credit: { userId: u, poche: 'accueil' } };
        const res = { headersSent: false };
        const rendu = await rembourserSiRienLivre(req, res, 'erreur-serveur');
        v('rien livré -> remboursé', rendu, true);
        v('   verrou anti-double posé sur la requête', req.scanRembourse, true);
        const c = await Credit.findOne({ userId: u }).lean();
        v('   solde accueil incrémenté (10 -> 11)', c.soldeGratuit, 11);
        await Credit.deleteOne({ userId: u });
    }

    // ── 2. UNE RÉPONSE EST DÉJÀ PARTIE -> ON NE REMBOURSE PAS ───────────
    // C'est l'objection qui bloquait le correctif, et elle reste vraie : rembourser
    // après une livraison offrirait un scan gratuit sur un résultat rendu.
    {
        const u = neuf('livre');
        await Credit.deleteOne({ userId: u });
        await Credit.create({ userId: u, soldeGratuit: 10, soldePayant: 0 });
        const req = { credit: { userId: u, poche: 'accueil' } };
        const res = { headersSent: true };
        const rendu = await rembourserSiRienLivre(req, res, 'erreur-serveur');
        v('réponse déjà envoyée -> NON remboursé', rendu, false);
        const c = await Credit.findOne({ userId: u }).lean();
        v('   solde INCHANGÉ (10)', c.soldeGratuit, 10);
        v('   et aucun verrou posé : le crédit reste remboursable ailleurs', req.scanRembourse, undefined);
        await Credit.deleteOne({ userId: u });
    }

    // ── 3. DOUBLE REMBOURSEMENT IMPOSSIBLE ──────────────────────────────
    // Garanti par `rembourserScan` (verrou `req.scanRembourse`), pas par la fonction
    // testée ici. On le vérifie quand même : c'est la garantie qui protège l'argent.
    {
        const u = neuf('double');
        await Credit.deleteOne({ userId: u });
        await Credit.create({ userId: u, soldeGratuit: 10, soldePayant: 0 });
        const req = { credit: { userId: u, poche: 'accueil' } };
        v('1er appel rembourse', await rembourserSiRienLivre(req, { headersSent: false }, 'erreur-serveur'), true);
        v('2e appel REFUSÉ', await rembourserSiRienLivre(req, { headersSent: false }, 'erreur-serveur'), false);
        const c = await Credit.findOne({ userId: u }).lean();
        v('   solde à 11, jamais 12', c.soldeGratuit, 11);
        await Credit.deleteOne({ userId: u });
    }

    // ── 4. AUCUN CRÉDIT DÉBITÉ (code maître) -> RIEN À RENDRE ───────────
    {
        const req = {};   // pas de req.credit : le middleware n'a rien débité
        v('aucun débit -> remboursement sans objet', await rembourserSiRienLivre(req, { headersSent: false }, 'erreur-serveur'), false);
    }

    // ── 6. `rembourse: false` DIT MAINTENANT POURQUOI ───────────────────
    // ⚠️ NEUF CAUSES SE CACHAIENT DERRIÈRE UN BOOLÉEN, et une seule est un préjudice.
    // Un test qui vérifie seulement « false » ne distingue pas « il n'y avait rien à
    // rendre » de « on a refusé de rendre » — et c'est de l'argent.
    console.log('\n── 6. la raison du non-remboursement, une valeur par cause ──');
    {
        const u = neuf('raison-ok');
        await Credit.deleteOne({ userId: u }); await Remboursement.deleteMany({ userId: u });
        await Credit.create({ userId: u, soldeGratuit: 10, soldePayant: 0 });
        await dansUnScan(async () => {
            const req = { credit: { userId: u, poche: 'accueil' } };
            v('remboursé -> aucune raison', await rembourserSiRienLivre(req, { headersSent: false }, 'x'), true);
            v('   raison null quand ça marche', raisonNonRemboursement(), null);
        });
        await dansUnScan(async () => {
            v('aucun débit -> « aucun-debit »',
                await rembourserSiRienLivre({}, { headersSent: false }, 'x') === false && raisonNonRemboursement(), 'aucun-debit');
        });
        await dansUnScan(async () => {
            const req = { credit: { userId: u, poche: 'accueil' } };
            v('réponse déjà partie -> « deja-livre »',
                await rembourserSiRienLivre(req, { headersSent: true }, 'x') === false && raisonNonRemboursement(), 'deja-livre');
        });
        await dansUnScan(async () => {
            const req = { credit: { userId: u, poche: 'accueil' } };
            await rembourserSiRienLivre(req, { headersSent: false }, 'x');
            v('2e appel dans la même requête -> « deja-rembourse »',
                await rembourserSiRienLivre(req, { headersSent: false }, 'x') === false && raisonNonRemboursement(), 'deja-rembourse');
        });
        await Credit.deleteOne({ userId: u }); await Remboursement.deleteMany({ userId: u });
    }

    // ── 7. LE PLAFOND ANTI-ABUS, EXERCÉ POUR LA PREMIÈRE FOIS ───────────
    // ⚠️ IL N'AVAIT JAMAIS ÉTÉ TESTÉ, et il a pourtant mordu six fois sur le bac à sable
    // sans que personne le voie — chaque cas ci-dessus prend un userId neuf, donc un
    // compteur à zéro, donc le plafond ne pouvait pas se déclencher. C'est un angle mort
    // par construction : les tests fabriquaient exactement les conditions où la règle ne
    // s'applique pas. Ici on la déclenche exprès.
    console.log('\n── 7. le plafond de 5 remboursements par jour ──');
    {
        const u = neuf('plafond');
        await Credit.deleteOne({ userId: u }); await Remboursement.deleteMany({ userId: u });
        await Credit.create({ userId: u, soldeGratuit: 0, soldePayant: 0 });
        let rendus = 0;
        for (let i = 1; i <= 5; i++) {
            await dansUnScan(async () => {
                if (await rembourserSiRienLivre({ credit: { userId: u, poche: 'accueil' } }, { headersSent: false }, 'x')) rendus++;
            });
        }
        v('les 5 premiers sont rendus', rendus, 5);
        const c5 = await Credit.findOne({ userId: u }).lean();
        v('   solde 0 -> 5', c5.soldeGratuit, 5);
        await dansUnScan(async () => {
            v('le 6e est REFUSÉ',
                await rembourserSiRienLivre({ credit: { userId: u, poche: 'accueil' } }, { headersSent: false }, 'x'), false);
            v('   et il dit pourquoi : « plafond-jour »', raisonNonRemboursement(), 'plafond-jour');
        });
        const c6 = await Credit.findOne({ userId: u }).lean();
        v('   le solde n\'a pas bougé (5, pas 6)', c6.soldeGratuit, 5);
        const compteur = await Remboursement.findOne({ userId: u }).lean();
        v('   le compteur reste à 5, le 6e n\'a pas consommé de jeton', compteur.count, 5);
        await Credit.deleteOne({ userId: u }); await Remboursement.deleteMany({ userId: u });
    }

    // ── 8. L'ÉNUMÉRATION EST FERMÉE ─────────────────────────────────────
    {
        const { noterNonRemboursement } = require('./sources');
        await dansUnScan(async () => {
            noterNonRemboursement('une-valeur-inventee');
            v('une valeur hors énumération est REFUSÉE', raisonNonRemboursement(), null);
        });
        v('l\'énumération compte 9 causes', RAISONS_NON_REMBOURSE.length, 9);
    }

    // ── 5. `res` ABSENT -> ON NE SUPPOSE PAS QU'UNE RÉPONSE EST PARTIE ──
    // Un `res` manquant ne doit pas faire perdre le remboursement à l'utilisateur :
    // dans le doute, on rend. Le doute ne se paie pas par le client.
    {
        const u = neuf('sansres');
        await Credit.deleteOne({ userId: u });
        await Credit.create({ userId: u, soldeGratuit: 10, soldePayant: 0 });
        const req = { credit: { userId: u, poche: 'accueil' } };
        v('res absent -> remboursé quand même', await rembourserSiRienLivre(req, null, 'erreur-serveur'), true);
        await Credit.deleteOne({ userId: u });
    }

    // ⚠️ TOUT OUTIL QUI FAIT ÉCRIRE UNE COLLECTION LA VIDE EN SORTANT. La règle est écrite
    // en tête de verrou-avant-push.js, et elle ne vaut que si elle s'applique partout :
    // ce fichier laissait derrière lui un document `remboursements` par cas remboursé. Ses
    // userId étant uniques à chaque exécution, ça n'a jamais rien faussé — mais « ça ne
    // fausse rien aujourd'hui » n'est pas une raison de laisser traîner l'état qui, chez
    // le verrou, a fini par faire mentir une assertion.
    const restes = await Remboursement.deleteMany({ userId: /^T-catch-/ });
    const creditsRestes = await Credit.deleteMany({ userId: /^T-catch-/ });
    console.log(`\n🧹 test_scratch : ${creditsRestes.deletedCount} crédit(s), ${restes.deletedCount} compteur(s) de remboursement supprimés.`);

    console.log(echecs ? `\n❌ ${echecs} échec(s).` : '\n🎉 Tous les tests passent.');
    await mongoose.connection.close();
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
