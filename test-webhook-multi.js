// ============================================================================
// WEBHOOK-MULTI — la vérification de signature accepte, pendant une rotation de secret, une LISTE de secrets
// ============================================================================
// Contexte : pendant 24 h deux points d'arrivée Stripe envoient chaque événement à la même adresse, chacun signé de SON
// secret. La route essaie STRIPE_WEBHOOK_SECRET puis STRIPE_WEBHOOK_SECRET_ANCIEN (optionnel, vide = absent).
// Ce banc FABRIQUE ses secrets et ses signatures (stripe.webhooks.generateTestHeaderString : cryptographie locale) ;
// aucun .env lu, aucune requête vers Stripe (le client `stripe` du serveur est REMPLACÉ par un faux qui lève), base mémoire /
// test_scratch comme test-webhook-stripe.js. USAGE : node test-webhook-multi.js
const crypto = require('crypto');
const alea = n => { let s = ''; while (s.length < n) s += crypto.randomBytes(48).toString('base64').replace(/[^A-Z]/g, ''); return s.slice(0, n); };

const NOUVEAU = 'whsec_' + alea(32), ANCIEN = 'whsec_' + alea(32), TIERS = 'whsec_' + alea(32);
const CLE_STRIPE = 'sk_live_' + alea(40);

process.env.MONGODB_BASE = 'test_scratch';
process.env.STRIPE_SECRET_KEY = CLE_STRIPE;
process.env.PORT = '0';
require('dotenv').config();
process.env.MONGODB_BASE = 'test_scratch';
process.env.STRIPE_SECRET_KEY = CLE_STRIPE;               // jamais la clé du .env
process.env.STRIPE_WEBHOOK_SECRET = NOUVEAU;
delete process.env.STRIPE_WEBHOOK_SECRET_ANCIEN;

const http = require('http');
const mongoose = require('mongoose');
const RealStripe = require('stripe');
const { viderBac } = require('./verrou/bac');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

// Le client Stripe du serveur est remplacé AVANT le require d'index.js : webhooks = le vrai (local), tout le reste LÈVE avec
// un message qui porte la clé factice — c'est la forme d'une erreur réelle de Stripe (« Invalid API Key provided: sk_…****xxxx »).
const MESSAGE_FACTICE = `Invalid API Key provided: ${CLE_STRIPE.slice(0, 8)}********${CLE_STRIPE.slice(-4)} (clé complète ${CLE_STRIPE})`;
const erreurFactice = () => Object.assign(new Error(MESSAGE_FACTICE), { type: 'StripeAuthenticationError', code: 'api_key_invalid', statusCode: 401 });
const chemin = require.resolve('stripe');
function fauxClient(cle) {
    const reel = RealStripe(cle);
    const leve = async () => { throw erreurFactice(); };
    return {
        webhooks: reel.webhooks,
        paymentIntents: { retrieve: leve },
        charges: { retrieve: leve },
        checkout: { sessions: { list: leve, create: leve } }
    };
}
require.cache[chemin].exports = fauxClient;

// Tout ce que le serveur écrit en console est capté (pour la recherche de fuite).
let sortie = '';
for (const m of ['log', 'warn', 'error', 'info']) {
    const orig = console[m].bind(console);
    console[m] = (...a) => { sortie += a.map(x => (typeof x === 'string' ? x : (x && x.message) || String(x))).join(' ') + '\n'; orig(...a); };
}

let echecs = 0;
const v = (nom, obtenu, attendu) => {
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : `  (attendu ${JSON.stringify(attendu)})`}`);
};

const evenement = (id, userId, scans, type = 'checkout.session.completed') => JSON.stringify({
    id, type,
    data: { object: { payment_status: 'paid', metadata: { userId, scans: String(scans) }, customer_details: { email: 'x@example.test' } } }
});
function poster(port, corps, signature) {
    return new Promise(resolve => {
        const buf = Buffer.from(corps, 'utf8');
        const req = http.request({
            host: '127.0.0.1', port, path: '/api/webhook-stripe', method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': buf.length, ...(signature ? { 'stripe-signature': signature } : {}) }
        }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, brut: b })); });
        req.on('error', e => resolve({ status: 0, brut: e.message }));
        req.write(buf); req.end();
    });
}

(async () => {
    (await ouvrirBanc()).appliquer();
    const { app } = require('./index');
    const { Credit } = require('./acces');
    const stripeReel = RealStripe(CLE_STRIPE);

    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.readyState !== 1) { console.error('❌ Mongo non connecté.'); process.exit(1); }
    const base = mongoose.connection.db.databaseName;
    if (base !== 'test_scratch') { console.error(`❌ REFUS : base « ${base} », attendu « test_scratch ».`); process.exit(1); }

    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;

    const EvenementStripe = mongoose.model('EvenementStripe');
    const marque = `T-multi-${Date.now()}`;
    const signer = (corps, secret) => stripeReel.webhooks.generateTestHeaderString({ payload: corps, secret });
    const solde = async u => (await Credit.findOne({ userId: u }).lean())?.soldeScans ?? null;
    const marques = id => EvenementStripe.countDocuments({ eventId: id });

    // Un cas = un événement neuf, signé (ou non) ; rend {statut, crédit} pour que chaque ligne dise AUSSI ce qui n'a pas été écrit.
    let n = 0;
    async function cas(secretSignature, ancienPose) {
        if (ancienPose === undefined) delete process.env.STRIPE_WEBHOOK_SECRET_ANCIEN; else process.env.STRIPE_WEBHOOK_SECRET_ANCIEN = ancienPose;
        const id = `${marque}-e${++n}`, u = `${marque}-u${n}`;
        const corps = evenement(id, u, 10);
        const r = await poster(port, corps, secretSignature === null ? null : signer(corps, secretSignature));
        return { statut: r.status, brut: r.brut, credit: await solde(u), marques: await marques(id) };
    }
    const resume = r => [r.statut, r.credit, r.marques];

    // ── 1. _ANCIEN ABSENT : le comportement d'aujourd'hui ────────────────
    console.log('--- 1. _ANCIEN absent ---');
    v('signé du nouveau -> 200, crédité, une marque', resume(await cas(NOUVEAU, undefined)), [200, 10, 1]);
    v('signé de l\'ancien -> 400, rien d\'écrit', resume(await cas(ANCIEN, undefined)), [400, null, 0]);
    v('signé d\'un troisième -> 400, rien d\'écrit', resume(await cas(TIERS, undefined)), [400, null, 0]);
    v('sans en-tête -> 400, rien d\'écrit', resume(await cas(null, undefined)), [400, null, 0]);

    // ── 2. _ANCIEN VIDE = ABSENT ─────────────────────────────────────────
    console.log('\n--- 2. _ANCIEN vide (= absent) ---');
    v('signé de l\'ancien, _ANCIEN vide -> 400', resume(await cas(ANCIEN, '')), [400, null, 0]);
    v('sans en-tête, _ANCIEN vide -> 400 (jamais accepté sans signature)', resume(await cas(null, '')), [400, null, 0]);
    v('secret vide « fabriqué » (signé de la chaîne vide), _ANCIEN vide -> 400', resume(await cas('', '')), [400, null, 0]);
    v('_ANCIEN d\'espaces seuls = absent : signé de l\'ancien refusé', resume(await cas(ANCIEN, '   ')), [400, null, 0]);
    v('signé du nouveau, _ANCIEN vide -> 200', resume(await cas(NOUVEAU, '')), [200, 10, 1]);

    // ── 3. _ANCIEN POSÉ : les deux sont valides, un troisième non ────────
    console.log('\n--- 3. _ANCIEN posé ---');
    v('signé de l\'ancien -> 200, crédité, une marque', resume(await cas(ANCIEN, ANCIEN)), [200, 10, 1]);
    v('signé du nouveau -> 200, crédité, une marque', resume(await cas(NOUVEAU, ANCIEN)), [200, 10, 1]);
    v('signé d\'un troisième -> 400, rien d\'écrit', resume(await cas(TIERS, ANCIEN)), [400, null, 0]);
    v('sans en-tête -> 400, rien d\'écrit', resume(await cas(null, ANCIEN)), [400, null, 0]);
    v('signé de la chaîne vide -> 400', resume(await cas('', ANCIEN)), [400, null, 0]);

    // ── 4. LE MÊME ÉVÉNEMENT, LIVRÉ PAR LES DEUX POINTS ──────────────────
    console.log('\n--- 4. un même event.id livré par les deux points : UN crédit ---');
    process.env.STRIPE_WEBHOOK_SECRET_ANCIEN = ANCIEN;
    for (const [libelle, premier, second] of [['nouveau puis ancien', NOUVEAU, ANCIEN], ['ancien puis nouveau', ANCIEN, NOUVEAU], ['ancien puis ancien', ANCIEN, ANCIEN]]) {
        const id = `${marque}-dbl-${++n}`, u = `${marque}-ud${n}`;
        const corps = evenement(id, u, 20);
        const a = await poster(port, corps, signer(corps, premier));
        const b = await poster(port, corps, signer(corps, second));
        v(`${libelle} : les deux acquittées en 200`, [a.status, b.status], [200, 200]);
        v(`   crédité UNE fois (20, pas 40)`, await solde(u), 20);
        v(`   une seule marque`, await marques(id), 1);
    }
    {   // simultanées
        const id = `${marque}-simul-${++n}`, u = `${marque}-us${n}`;
        const corps = evenement(id, u, 30);
        const [a, b] = await Promise.all([poster(port, corps, signer(corps, NOUVEAU)), poster(port, corps, signer(corps, ANCIEN))]);
        v('simultanées (une signature de chaque point) : 200 et 200', [a.status, b.status], [200, 200]);
        v('   crédité UNE fois (30, pas 60)', await solde(u), 30);
    }
    {   // « déjà traité » est bien le chemin pris par la seconde livraison
        const id = `${marque}-dej-${++n}`, u = `${marque}-uj${n}`;
        const corps = evenement(id, u, 5);
        await poster(port, corps, signer(corps, NOUVEAU));
        const avant = sortie.length;
        await poster(port, corps, signer(corps, ANCIEN));
        v('la seconde livraison (autre secret) répond « déjà traité — ignoré »', /déjà traité — ignoré/.test(sortie.slice(avant)), true);
    }

    // ── 5. LE 400 NE RÉVÈLE NI LE SECRET, NI LEQUEL A ÉCHOUÉ, NI COMBIEN ──
    console.log('\n--- 5. le 400 ---');
    {
        const sans = await cas(TIERS, undefined);
        const avec = await cas(TIERS, ANCIEN);
        v('même corps de réponse avec ou sans _ANCIEN (forme inchangée, nombre de secrets invisible)', sans.brut === avec.brut, true);
        v('aucun secret, ni fragment de 4 caractères, dans le corps du 400',
            [NOUVEAU, ANCIEN, TIERS].every(s => { for (let i = 6; i + 4 <= s.length; i++) if (avec.brut.includes(s.slice(i, i + 4))) return false; return true; }), true);
        const entete = await cas(null, ANCIEN);
        const entete2 = await cas(null, undefined);
        v('en-tête absent : même corps avec ou sans _ANCIEN', entete.brut === entete2.brut, true);
    }
    {
        const fuites = [];
        for (const [nom, s] of [['nouveau', NOUVEAU], ['ancien', ANCIEN], ['tiers', TIERS]]) for (let i = 6; i + 4 <= s.length; i++) { const k = sortie.indexOf(s.slice(i, i + 4)); if (k >= 0) fuites.push(`${nom}@${i}: …${JSON.stringify(sortie.slice(Math.max(0, k - 25), k + 29))}`); }
        v('aucun secret de webhook (ni fragment de 4 caractères) dans ce que le serveur a écrit', fuites, []);
    }

    // ── 6. 503 « Stripe non configuré » reste sur la présence du secret PRINCIPAL ──
    console.log('\n--- 6. 503 ---');
    {
        const sauve = process.env.STRIPE_WEBHOOK_SECRET;
        process.env.STRIPE_WEBHOOK_SECRET = '';
        const r1 = await cas(ANCIEN, ANCIEN);
        v('principal absent, _ANCIEN posé -> 503 (la liste ne remplace pas le principal)', resume(r1), [503, null, 0]);
        process.env.STRIPE_WEBHOOK_SECRET = sauve;
    }

    // ── 7. LES JOURNAUX D'ERREUR STRIPE N'IMPRIMENT PLUS LE MESSAGE BRUT ──
    console.log('\n--- 7. erreurs Stripe : type, code, statusCode seulement ---');
    {
        delete process.env.STRIPE_WEBHOOK_SECRET_ANCIEN;
        const avant = sortie.length;
        const u = `${marque}-ur`;
        // (a) charge.refunded sans métadonnées : PaymentIntent puis session lèvent (les deux journaux de metadonneesDuPaiement)
        const c1 = JSON.stringify({ id: `${marque}-r1`, type: 'charge.refunded', data: { object: { id: 'ch_x', amount: 500, amount_refunded: 500, payment_intent: 'pi_x' }, previous_attributes: { amount_refunded: 0 } } });
        v('remboursement sans métadonnées, Stripe en erreur -> acquitté 200', (await poster(port, c1, signer(c1, NOUVEAU))).status, 200);
        // (b) litige avec métadonnées : la lecture du montant de la charge lève (journal de montantDeLaCharge)
        const c2 = JSON.stringify({ id: `${marque}-r2`, type: 'charge.dispute.created', data: { object: { id: 'dp_x', amount: 500, charge: 'ch_x', metadata: { userId: u, scans: '20' } } } });
        v('litige, lecture de la charge en erreur -> acquitté 200', (await poster(port, c2, signer(c2, NOUVEAU))).status, 200);
        const ecrit = sortie.slice(avant);
        v('les trois journaux d\'erreur Stripe ont bien écrit (le banc mord)', [/PaymentIntent pi_x illisible/.test(ecrit), /session du PaymentIntent pi_x illisible/.test(ecrit), /charge ch_x illisible/.test(ecrit)], [true, true, true]);
        let fuite = [];
        for (let i = 8; i + 4 <= CLE_STRIPE.length; i++) if (ecrit.includes(CLE_STRIPE.slice(i, i + 4))) fuite.push(i);
        v('aucune sous-chaîne de 4 caractères de la clé Stripe dans ce qui est écrit', fuite, []);
        v('le type, le code et le statusCode sont dits', /StripeAuthenticationError/.test(ecrit) && /api_key_invalid/.test(ecrit) && /401/.test(ecrit), true);
    }
    {   // la fonction de résumé elle-même, et le 4e site (creer-recharge) lu dans la source
        const fs = require('fs');
        let M = null; try { M = require('./stripe-webhook'); } catch (_) { /* rouge attendu avant l'implémentation */ }
        v('le module expose resumeErreurStripe', typeof M?.resumeErreurStripe, 'function');
        const r = M?.resumeErreurStripe?.(erreurFactice()) ?? '';
        let f = 0; for (let i = 8; i + 4 <= CLE_STRIPE.length; i++) if (r.includes(CLE_STRIPE.slice(i, i + 4))) f++;
        v('   le résumé ne porte aucun fragment de la clé', f, 0);
        v('   une erreur sans type ni code ne casse pas le résumé', typeof M?.resumeErreurStripe?.(new Error(MESSAGE_FACTICE)), 'string');
        v('   un champ type piégé (message dans type) n\'est pas recopié', (M?.resumeErreurStripe?.({ type: MESSAGE_FACTICE, code: CLE_STRIPE }) ?? 'x').includes(CLE_STRIPE.slice(8, 12)), false);
        const src = fs.readFileSync(require('path').join(__dirname, 'index.js'), 'utf8');
        const l = src.split('\n').find(x => x.includes('[creer-recharge]')) || '';
        v('creer-recharge : le journal n\'imprime pas e.message', /e\.message/.test(l), false);
        v('   et il utilise le résumé', /resumeErreurStripe\(/.test(l), true);
    }

    // ── NETTOYAGE ────────────────────────────────────────────────────────
    const dc = await Credit.deleteMany({ userId: new RegExp('^' + marque) });
    const de = await EvenementStripe.deleteMany({ eventId: new RegExp('^' + marque) });
    console.log(`\n🧹 test_scratch : ${dc.deletedCount} crédit(s), ${de.deletedCount} marque(s) supprimées.`);
    console.log(echecs ? `\n❌ ${echecs} échec(s).` : '\n🎉 Tous les tests passent.');
    srv.close();
    await viderBac(mongoose.connection.db, { noms: ['credits', 'quotas_semaine', 'remboursements', 'remboursements_questions', 'questions', 'journal_scans', 'numeros_cartes', 'codes_set', 'references_image', 'catalogue_produits', 'guide_prix', 'cardprices', 'evenements_stripe'] });
    await mongoose.connection.close();
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
