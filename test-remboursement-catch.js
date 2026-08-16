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
    const { Credit } = require('./acces');
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

    console.log(echecs ? `\n❌ ${echecs} échec(s).` : '\n🎉 Tous les tests passent.');
    await mongoose.connection.close();
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
