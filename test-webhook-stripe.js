// ============================================================================
// LE REJEU STRIPE — UNE PARADE DONT LE SUCCÈS NE LAISSE AUCUNE TRACE
// ============================================================================
// POURQUOI CE FICHIER EXISTE, ET POURQUOI IL NE DÉPEND D'AUCUNE DONNÉE DE PRODUCTION.
// Stripe REJOUE tout événement non acquitté : timeout, redéploiement Render, 500 passager.
// Ce n'est pas un scénario adverse, c'est une garantie du protocole — donc un cas de
// FONCTIONNEMENT NORMAL. Sans déduplication, un même paiement crédite deux fois.
//
//   ⚠️ ET CETTE PARADE NE PEUT PAS ÊTRE PROUVÉE PAR LA BASE. Un rejeu correctement
//   dédupliqué n'écrit RIEN : l'insertion échoue, la transaction est annulée. « Zéro
//   doublon en production » est donc compatible avec « le verrou a bloqué des rejeux »
//   ET avec « aucun rejeu n'a jamais eu lieu ». Vérifié le 2026-08-19 : 4 événements,
//   0 doublon, et rien qui permette de choisir entre les deux lectures.
//   Une parade dont le succès est invisible ne se mesure pas — elle s'EXERCE.
//
// CE QUI EST VÉRIFIÉ, ET LE 3e EST CELUI QUI COMPTE :
//   1. un événement crédite une fois ;
//   2. le MÊME eventId rejoué ne crédite pas, et répond 2xx — un 4xx/5xx ferait rejouer
//      Stripe indéfiniment sur un événement que le rejeu ne réparera jamais ;
//   3. DEUX APPELS CONCURRENTS sur le même eventId ne créditent QU'UNE FOIS. C'est
//      l'assertion qui manquerait à un test naïf : une déduplication écrite en
//      « lire puis écrire » passe les cas 1 et 2 et ÉCHOUE celui-ci, parce que les deux
//      lectures ont lieu avant les deux écritures. Ici c'est l'INSERTION qui fait verrou
//      (index unique -> 11000), et c'est ça qu'on prouve.
//   4. une signature invalide ne crédite rien et répond 400 ;
//   5. un événement d'un autre type est acquitté sans rien écrire.
//
// ⚠️ BASE : test_scratch, JAMAIS la production. La base de prod s'appelle « test ».
// ⚠️ AUCUN APPEL À STRIPE. `constructEvent` et `generateTestHeaderString` sont de la
// cryptographie LOCALE : elles ne touchent pas le réseau. Les clés ci-dessous sont donc
// des chaînes de test, et aucune requête ne part chez Stripe.
// USAGE : node test-webhook-stripe.js
process.env.MONGODB_BASE = 'test_scratch';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_pour_signature_locale';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_verrou_rejeu';
process.env.PORT = '0';
require('dotenv').config();
// dotenv ne DOIT PAS réécrire ce qu'on vient de poser : il n'écrase jamais une variable
// déjà définie, mais le secret webhook, lui, doit être le nôtre pour signer localement.
process.env.MONGODB_BASE = 'test_scratch';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_verrou_rejeu';

const http = require('http');
const mongoose = require('mongoose');
const Stripe = require('stripe');

let echecs = 0;
const v = (nom, obtenu, attendu) => {
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : `  (attendu ${JSON.stringify(attendu)})`}`);
};

/** Un corps d'événement Stripe, dans la forme EXACTE que le handler déstructure. */
const evenement = (id, userId, scans, type = 'checkout.session.completed', payment_status = 'paid') => JSON.stringify({
    id, type,
    data: { object: { payment_status, metadata: { userId, scans: String(scans) }, customer_details: { email: 'x@example.test' } } }
});
/** Un `charge.refunded` : montants en centimes, `amount_refunded` CUMULÉ comme chez Stripe. */
const remboursement = (id, userId, scans, amount, amountRefunded, avant = 0) => JSON.stringify({
    id, type: 'charge.refunded',
    data: {
        object: { id: 'ch_test', amount, amount_refunded: amountRefunded, metadata: { userId, scans: String(scans) }, payment_intent: 'pi_test' },
        previous_attributes: { amount_refunded: avant }
    }
});

/** POST brut sur /api/webhook-stripe, avec une signature Stripe VALIDE. */
function poster(port, corps, signature) {
    return new Promise(resolve => {
        const buf = Buffer.from(corps, 'utf8');
        const req = http.request({
            host: '127.0.0.1', port, path: '/api/webhook-stripe', method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': buf.length,
                ...(signature ? { 'stripe-signature': signature } : {})
            }
        }, res => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => resolve({ status: res.statusCode, brut: b }));
        });
        req.on('error', e => resolve({ status: 0, brut: e.message }));
        req.write(buf);
        req.end();
    });
}

(async () => {
    // ⚠️ L'ORDRE COMPTE : c'est `require('./index')` qui ouvre la connexion Mongo ET met
    // le serveur en écoute, avec les variables posées ci-dessus.
    const { app } = require('./index');
    const { Credit } = require('./acces');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.readyState !== 1) { console.error('❌ Mongo non connecté.'); process.exit(1); }
    const base = mongoose.connection.db.databaseName;
    if (base !== 'test_scratch') {
        console.error(`❌ REFUS : base « ${base} », attendu « test_scratch ». La base de PROD s'appelle « test ».`);
        process.exit(1);
    }
    console.log(`base : ${base}`);

    // Serveur dédié à ce test, sur un port libre : on ne dépend pas de celui qu'index.js
    // a pris, et deux exécutions simultanées ne se marchent pas dessus.
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    console.log(`serveur de test : 127.0.0.1:${port}\n`);

    const EvenementStripe = mongoose.model('EvenementStripe');
    const marque = `T-webhook-${Date.now()}`;
    const U = `${marque}-u`;
    const signer = corps => stripe.webhooks.generateTestHeaderString({
        payload: corps, secret: process.env.STRIPE_WEBHOOK_SECRET
    });
    const solde = async () => (await Credit.findOne({ userId: U }).lean())?.soldeScans ?? null;

    // ── 1. UN ÉVÉNEMENT CRÉDITE UNE FOIS ────────────────────────────────
    console.log('--- 1. un événement crédite ---');
    {
        const corps = evenement(`${marque}-evt1`, U, 20);
        const r = await poster(port, corps, signer(corps));
        v('acquitté en 2xx', r.status, 200);
        v('   +20 scans crédités', await solde(), 20);
        v('   une marque d\'idempotence posée', await EvenementStripe.countDocuments({ eventId: `${marque}-evt1` }), 1);
    }

    // ── 2. LE REJEU DU MÊME eventId NE CRÉDITE PAS ──────────────────────
    console.log('\n--- 2. le rejeu du MÊME événement ---');
    {
        const corps = evenement(`${marque}-evt1`, U, 20);
        const r = await poster(port, corps, signer(corps));
        // ⚠️ 2xx OBLIGATOIRE. Un 4xx ou 5xx ferait rejouer Stripe indéfiniment un
        // événement que le rejeu ne réparera jamais — le contraire du but.
        v('rejeu ACQUITTÉ en 2xx (sinon Stripe rejoue sans fin)', r.status, 200);
        v('   le solde n\'a pas bougé (20, pas 40)', await solde(), 20);
        v('   toujours UNE seule marque', await EvenementStripe.countDocuments({ eventId: `${marque}-evt1` }), 1);
    }

    // ── 3. DEUX APPELS CONCURRENTS — c'est l'INSERTION qui bloque ────────
    console.log('\n--- 3. le VERROU lui-même : c\'est l\'insertion qui bloque ---');
    // ⚠️ CE CAS-CI EST DÉTERMINISTE, ET C'EST LUI QUI PROUVE. On insère deux fois le même
    // eventId directement : la seconde DOIT lever 11000. Sans cette assertion, on ne
    // ferait que constater que le handler se comporte bien — sans savoir si c'est grâce à
    // l'index unique ou à un hasard d'ordonnancement.
    // C'est la différence entre « ça marche » et « on sait pourquoi ça marche ».
    {
        const idVerrou = `${marque}-verrou`;
        await EvenementStripe.create([{ eventId: idVerrou }]);
        let code = null;
        try { await EvenementStripe.create([{ eventId: idVerrou }]); }
        catch (e) { code = e.code; }
        v('la 2e insertion du même eventId lève 11000 (index unique)', code, 11000);
        v('   et il n\'y a qu\'un document', await EvenementStripe.countDocuments({ eventId: idVerrou }), 1);
        await EvenementStripe.deleteMany({ eventId: idVerrou });
    }

    // ── 3 bis. DEUX APPELS SIMULTANÉS ───────────────────────────────────
    console.log('\n--- 3 bis. deux appels simultanés sur le même eventId ---');
    // ⚠️ CE QUE CE CAS PROUVE, ET CE QU'IL NE PROUVE PAS. Il envoie deux requêtes sans
    // attendre la première, mais RIEN NE GARANTIT qu'elles se chevauchent réellement : si
    // la première boucle sa transaction avant que la seconde n'insère, une déduplication
    // « lire puis écrire » passerait elle aussi. C'est un filet, pas une démonstration —
    // la démonstration est le cas 3, qui ne dépend d'aucun ordonnancement.
    {
        const corps = evenement(`${marque}-evt2`, U, 50);
        const sig = signer(corps);
        const [a, b] = await Promise.all([poster(port, corps, sig), poster(port, corps, sig)]);
        v('les deux appels sont acquittés', [a.status, b.status], [200, 200]);
        v('   +50 UNE SEULE FOIS (70, pas 120)', await solde(), 70);
        v('   une seule marque pour l\'événement', await EvenementStripe.countDocuments({ eventId: `${marque}-evt2` }), 1);
    }

    // ── 4. SIGNATURE INVALIDE -> RIEN ───────────────────────────────────
    console.log('\n--- 4. signature invalide ---');
    {
        const corps = evenement(`${marque}-evt3`, U, 200);
        const r = await poster(port, corps, 't=1,v1=faux');
        v('refusé en 400', r.status, 400);
        v('   aucun crédit', await solde(), 70);
        v('   aucune marque', await EvenementStripe.countDocuments({ eventId: `${marque}-evt3` }), 0);
    }

    // ── 5. UN AUTRE TYPE D'ÉVÉNEMENT EST ACQUITTÉ SANS RIEN ÉCRIRE ──────
    console.log('\n--- 5. un événement d\'un autre type ---');
    {
        const corps = evenement(`${marque}-evt4`, U, 200, 'payment_intent.succeeded');
        const r = await poster(port, corps, signer(corps));
        v('acquitté en 2xx', r.status, 200);
        v('   aucun crédit', await solde(), 70);
        v('   aucune marque (l\'événement n\'est pas le nôtre)',
            await EvenementStripe.countDocuments({ eventId: `${marque}-evt4` }), 0);
    }

    // ── 6. UN PAIEMENT NON ENCAISSÉ NE CRÉDITE PAS — 2026-09-06 ──────────
    console.log('\n--- 6. payment_status=unpaid ---');
    {
        const corps = evenement(`${marque}-evt5`, U, 200, 'checkout.session.completed', 'unpaid');
        const r = await poster(port, corps, signer(corps));
        v('acquitté en 2xx', r.status, 200);
        v('   aucun crédit', await solde(), 70);
        v('   aucune marque (l\'événement encaissé viendra avec son propre id)',
            await EvenementStripe.countDocuments({ eventId: `${marque}-evt5` }), 0);
    }

    // ── 7. UN REMBOURSEMENT DÉBITE, PROPORTIONNELLEMENT ──────────────────
    console.log('\n--- 7. charge.refunded ---');
    {
        // Pack de 20 scans à 5,00 €, remboursé en entier : -20.
        const corps = remboursement(`${marque}-evt6`, U, 20, 500, 500);
        const r = await poster(port, corps, signer(corps));
        v('acquitté en 2xx', r.status, 200);
        v('   -20 scans (70 -> 50)', await solde(), 50);
        const m = await EvenementStripe.findOne({ eventId: `${marque}-evt6` }).lean();
        v('   la marque porte le débit signé', [m?.type, m?.userId, m?.scans, m?.dette ?? null], ['charge.refunded', U, -20, null]);
        // Rejeu du même remboursement : rien ne bouge.
        const r2 = await poster(port, corps, signer(corps));
        v('   rejeu acquitté, solde inchangé', [r2.status, await solde()], [200, 50]);
        // Second remboursement PARTIEL sur la même charge : amount_refunded cumulé 750 sur
        // 1000, previous 500 -> la part de cet événement est 250/1000 d'un pack de 20 = 5.
        const c3 = remboursement(`${marque}-evt7`, U, 20, 1000, 750, 500);
        await poster(port, c3, signer(c3));
        v('   remboursement partiel : -5 (50 -> 45)', await solde(), 45);
    }

    // ── 8. LE SOLDE NE DESCEND JAMAIS SOUS ZÉRO : LA DETTE EST ÉCRITE ─────
    console.log('\n--- 8. remboursement d\'un solde déjà consommé ---');
    {
        const corps = remboursement(`${marque}-evt8`, U, 100, 2000, 2000);
        const r = await poster(port, corps, signer(corps));
        v('acquitté en 2xx', r.status, 200);
        v('   solde laissé à 0, jamais négatif', await solde(), 0);
        const m = await EvenementStripe.findOne({ eventId: `${marque}-evt8` }).lean();
        v('   la dette (100 - 45 = 55) est sur la marque', [m?.scans, m?.dette], [-100, 55]);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 9. MONGO PAS PRÊT -> 503, PUIS LE REJEU CRÉDITE — 2026-09-07
    // ══════════════════════════════════════════════════════════════════════
    // POURQUOI CE CAS EXISTE, ET POURQUOI ICI. `gererWebhookStripe` a gagné une garde
    // `readyState !== 1 -> 503` : sur une instance qui se réveille, le port écoute avant
    // que Mongo soit connecté, et un webhook acquitté sans marque ni crédit est un
    // PAIEMENT PERDU — Stripe ne rejoue que ce qu'il n'a pas vu acquitter. C'est la seule
    // garde du serveur dont l'échec se paie en euros, et elle n'était pas exercée.
    //
    // ⚠️ COMMENT ON OUVRE LA FENÊTRE, ET CE QUE ÇA TESTE. On ne peut pas rendre
    // `readyState` ≠ 1 dans CE processus : la connexion est réelle et partagée par tout le
    // fichier. On lance donc un SECOND serveur, enfant, avec un `MONGODB_URI` pointant un
    // hôte injoignable — `readyState` y reste 0 à vie, la fenêtre est ouverte de façon
    // DÉTERMINISTE. Le secret de signature est le même, donc l'événement est authentique
    // des deux côtés.
    // 🔑 CE QUE ÇA PROUVE : la GARDE (refuser plutôt qu'acquitter à vide) et le fait que le
    // REJEU crédite ensuite exactement une fois. Ça ne prouve PAS la course elle-même, qui
    // est transitoire par nature. Un test déterministe d'une garde vaut mieux qu'un test
    // intermittent d'une course — mais il ne faut pas lire l'un pour l'autre.
    console.log('\n--- 9. Mongo pas prêt : 503, puis le rejeu crédite ---');
    {
        const { spawn } = require('child_process');
        const net = require('net');
        const portFroid = await new Promise((r, j) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); s.on('error', j); });
        const froid = spawn(process.execPath, [require('path').join(__dirname, 'index.js')], {
            env: {
                ...process.env, PORT: String(portFroid), MONGODB_BASE: 'test_scratch',
                // Hôte injoignable : la connexion n'aboutira jamais, `readyState` reste 0.
                MONGODB_URI: 'mongodb://127.0.0.1:1/froid?serverSelectionTimeoutMS=200000'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let journalFroid = '';
        froid.stdout.on('data', d => { journalFroid += d; }); froid.stderr.on('data', d => { journalFroid += d; });
        try {
            // On attend que le port ÉCOUTE — c'est exactement la fenêtre qu'on veut.
            const t0 = Date.now();
            let ouvert = false;
            while (!ouvert && Date.now() - t0 < 40000) {
                await new Promise(r => { const s = net.connect(portFroid, '127.0.0.1'); s.on('connect', () => { s.destroy(); ouvert = true; r(); }); s.on('error', () => { s.destroy(); setTimeout(r, 200); }); });
            }
            v('le port écoute alors que Mongo n\'est pas connecté', ouvert, true);
            const p = await (await fetch(`http://127.0.0.1:${portFroid}/ping`)).json();
            v('   /ping confirme la fenêtre (mongo:false)', p.mongo, false);

            const corps = evenement(`${marque}-evt9`, U, 30);
            const sig = signer(corps);
            const rFroid = await poster(portFroid, corps, sig);
            // ⚠️ 503 ET NON 200 : un 2xx dirait à Stripe « c'est traité », et il ne
            // rejouerait jamais un paiement qui n'a laissé aucune trace.
            v('webhook sur serveur froid -> 503 (Stripe rejouera)', rFroid.status, 503);
            v('   AUCUNE marque posée', await EvenementStripe.countDocuments({ eventId: `${marque}-evt9` }), 0);
            v('   AUCUN crédit', await solde(), 0);

            // LE REJEU, sur le serveur chaud : c'est ce que Stripe fera de lui-même.
            const rChaud = await poster(port, corps, sig);
            v('rejeu sur serveur chaud -> 2xx', rChaud.status, 200);
            v('   +30 scans crédités, une seule fois', await solde(), 30);
            v('   une marque, et une seule', await EvenementStripe.countDocuments({ eventId: `${marque}-evt9` }), 1);

            // Et un SECOND rejeu ne double pas : la garde froide n'a pas cassé l'idempotence.
            const rTriple = await poster(port, corps, sig);
            v('   un troisième envoi n\'ajoute rien (30, pas 60)', [rTriple.status, await solde()], [200, 30]);
            v('   le refus froid est tracé côté serveur', /Mongo indisponible/.test(journalFroid), true);
        } finally { froid.kill(); }
    }

    // ── NETTOYAGE — tout outil qui fait écrire une collection la vide ───
    const dc = await Credit.deleteMany({ userId: /^T-webhook-/ });
    const de = await EvenementStripe.deleteMany({ eventId: /^T-webhook-/ });
    console.log(`\n🧹 test_scratch : ${dc.deletedCount} crédit(s), ${de.deletedCount} marque(s) d'événement supprimées.`);

    console.log(echecs ? `\n❌ ${echecs} échec(s).` : '\n🎉 Tous les tests passent.');
    srv.close();
    await mongoose.connection.close();
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
