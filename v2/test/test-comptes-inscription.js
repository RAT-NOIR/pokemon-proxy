'use strict';
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons');
const { creerCourrierMemoire } = require('../comptes/courrier'); const { verifierTurnstile } = require('../comptes/turnstile');
(async () => {
    await H.ouvrirBac('test-comptes-inscription.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); const appelsT = [];
    const turnstile = { verifier: async (jeton, ip) => { appelsT.push([jeton, ip]); return jeton !== 'mauvais'; } };
    A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile);
    const srv = await A.demarrer(cfg);
    let n = 0;
    const ins = (corps, entetes = {}, ipn = ++n) => H.appel(srv.url, '/api/compte/inscription', { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(ipn), ...entetes } });
    const MDP = 'un-mot-de-passe-solide';

    // 9 : journaux captés pendant toute la 1re inscription
    const trace = []; const orig = { log: console.log, warn: console.warn, error: console.error };
    for (const k of Object.keys(orig)) console[k] = (...a) => trace.push(a.join(' '));
    const r1 = await ins({ email: 'Alice@Exemple.fr', motDePasse: MDP, turnstile: 'ok' });
    Object.assign(console, orig);
    H.v('inscription valide : 202 { success:true }', [r1.statut, r1.json], [202, { success: true }]);
    H.vrai(`l'adresse et le mot de passe n'apparaissent pas dans les journaux (${trace.length} lignes captées)`, !trace.join('\n').includes('alice@') && !trace.join('\n').toLowerCase().includes('exemple.fr') && !trace.join('\n').includes(MDP));
    // 1
    const c = await db.col('comptes').findOne({ emailCle: 'alice@exemple.fr' });
    H.v('compte neutre', [c.verifie, c.offertesAccordeesLe, c.solde.accueil, c.motDePasse.algo, c.role], [false, null, 0, 'scrypt', undefined]);
    H.vrai('aucun mot de passe en clair dans le document', !JSON.stringify(c).includes(MDP));
    // 2
    const liens = await db.col('liens_email').find({}).toArray();
    H.v('un lien de vérification écrit', [liens.length, liens[0].type, liens[0].compteId.equals(c._id), liens[0].utiliseLe], [1, 'verification', true, null]);
    H.vrai('expireLe = +24 h ± 5 s', Math.abs(liens[0].expireLe.getTime() - (Date.now() + 24 * 3600e3)) < 5000);
    H.v('un courrier envoyé', [courrier.envoyes.length, courrier.envoyes[0].type, courrier.envoyes[0].email], [1, 'verification', 'Alice@Exemple.fr']);
    const mail = courrier.envoyes[0].lien; const jeton = new URL(mail).searchParams.get('jeton');
    H.v('le lien en clair porte le jeton, la base n\'a que l\'empreinte', [mail.startsWith('https://rat-market.fr/fr/verification?jeton='), liens[0].empreinte === J.empreinte(jeton), JSON.stringify(liens).includes(jeton)], [true, true, false]);
    // 3 anti-énumération
    const r2 = await ins({ email: 'Alice@Exemple.fr', motDePasse: MDP, turnstile: 'ok' });
    H.v('même e-mail : 202 identique octet pour octet', r2.texte, r1.texte);
    H.v('aucun second compte, aucun second lien, aucun second courrier', [await db.col('comptes').countDocuments({}), await db.col('liens_email').countDocuments({}), courrier.envoyes.length], [1, 1, 1]);
    // 4
    await ins({ email: 'a.b@gmail.com', motDePasse: MDP, turnstile: 'ok' });
    const r4 = await ins({ email: 'A.B+x@Gmail.com', motDePasse: MDP, turnstile: 'ok' });
    H.v('autre écriture Gmail : 202, toujours UN compte pour ab@gmail.com', [r4.statut, await db.col('comptes').countDocuments({ emailCle: 'ab@gmail.com' })], [202, 1]);
    // 5
    const j = await ins({ email: 'x@mailinator.com', motDePasse: MDP, turnstile: 'ok' });
    H.v('jetable : 422 ENTREE/adresse-refusee', [j.statut, j.json.erreur.code, j.json.erreur.detail], [422, 'ENTREE', 'adresse-refusee']);
    const inv = await ins({ email: 'pas-une-adresse', motDePasse: MDP, turnstile: 'ok' });
    H.v('adresse invalide', [inv.statut, inv.json.erreur.code, inv.json.erreur.detail], [422, 'ENTREE', 'adresse-invalide']);
    const nt = await ins({ email: 42, motDePasse: MDP, turnstile: 'ok' });
    H.v('adresse non-texte', [nt.statut, nt.json.erreur.detail], [422, 'adresse-invalide']);
    const faible = await ins({ email: 'faible@exemple.fr', motDePasse: '123456789', turnstile: 'ok' });
    H.v('9 caractères : 422 MOT_DE_PASSE_FAIBLE', [faible.statut, faible.json.erreur.code], [422, 'MOT_DE_PASSE_FAIBLE']);
    H.v('aucun compte pour jetable / invalide / faible', await db.col('comptes').countDocuments({ emailCle: { $in: ['x@mailinator.com', 'faible@exemple.fr'] } }), 0);
    // 6
    const avant = await db.col('comptes').countDocuments({});
    const t = await ins({ email: 'robot@exemple.fr', motDePasse: MDP, turnstile: 'mauvais' });
    H.v('Turnstile faux : 422 defi-anti-robot, aucun compte', [t.statut, t.json.erreur.detail, await db.col('comptes').countDocuments({}) - avant], [422, 'defi-anti-robot', 0]);
    const t0 = await ins({ email: 'robot@exemple.fr', motDePasse: MDP });
    H.v('Turnstile absent du corps : refusé aussi', [t0.statut, t0.json.erreur.detail], [422, 'defi-anti-robot']);
    A.registre.vider(); A.registre.fournir('courrier', courrier);
    const t3 = await ins({ email: 'sans@exemple.fr', motDePasse: MDP, turnstile: 'ok' });
    H.v('Turnstile non fourni et V2_TURNSTILE≠off : 503 (fail-closed), aucun compte', [t3.statut, t3.json.erreur.code, await db.col('comptes').countDocuments({ emailCle: 'sans@exemple.fr' })], [503, 'INDISPONIBLE', 0]);
    A.registre.fournir('turnstile', turnstile);
    A.registre.vider(); A.registre.fournir('turnstile', turnstile);
    const t4 = await ins({ email: 'sanscourrier@exemple.fr', motDePasse: MDP, turnstile: 'ok' });
    H.v('courrier non fourni : 503 (jamais un compte qu\'on ne pourra pas vérifier)', [t4.statut, await db.col('comptes').countDocuments({ emailCle: 'sanscourrier@exemple.fr' })], [503, 0]);
    A.registre.fournir('courrier', courrier);
    await srv.fermer();
    const srvOff = await A.demarrer(lireConfig({ MONGODB_BASE: 'test_scratch', V2_TURNSTILE: 'off' }));
    const appelsAvant = appelsT.length;
    const off = await H.appel(srvOff.url, '/api/compte/inscription', { methode: 'POST', corps: { email: 'off@exemple.fr', motDePasse: MDP }, entetes: { ...A.SITE, ...A.ip(777) } });
    H.v('V2_TURNSTILE=off : passe sans appeler verifier', [off.statut, appelsT.length - appelsAvant], [202, 0]);
    await srvOff.fermer();
    const srv2 = await A.demarrer(cfg);
    const ins2 = (corps, entetes = {}, ipn = ++n) => H.appel(srv2.url, '/api/compte/inscription', { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(ipn), ...entetes } });
    // 7
    const r7 = await ins2({ email: 'pirate@exemple.fr', motDePasse: MDP, turnstile: 'ok', role: 'administrateur', verifie: true, solde: { accueil: 999 }, offertesAccordeesLe: new Date() });
    const p = await db.col('comptes').findOne({ emailCle: 'pirate@exemple.fr' });
    H.v('champs de privilège du corps ignorés', [r7.statut, p.role, p.verifie, p.solde.accueil, p.offertesAccordeesLe], [202, undefined, false, 0, null]);
    // 8
    const so = await H.appel(srv2.url, '/api/compte/inscription', { methode: 'POST', corps: { email: 'o@exemple.fr', motDePasse: MDP, turnstile: 'ok' }, entetes: A.ip(5000) });
    H.v('sans Origin/X-Rat-Market : 403 ORIGINE', [so.statut, so.json.erreur.code], [403, 'ORIGINE']);
    const mo = await H.appel(srv2.url, '/api/compte/inscription', { methode: 'POST', corps: { email: 'o@exemple.fr', motDePasse: MDP, turnstile: 'ok' }, entetes: { origin: 'https://evil.fr', 'x-rat-market': '1', ...A.ip(5001) } });
    H.v('mauvaise origine : 403', mo.statut, 403);
    const codes = []; for (let i = 0; i < 11; i++) codes.push((await ins2({ email: `rafale${i}@exemple.fr`, motDePasse: MDP, turnstile: 'ok' }, {}, 6000)).statut);
    H.v('11 requêtes de la même IP dans l\'heure : 10 passent, la 11e est 429 (11 requêtes)', [codes.filter(x => x === 202).length, codes[10]], [10, 429]);
    await srv2.fermer();

    // Turnstile réel : fetch injecté, aucune requête réelle
    const vus = []; const fetchFaux = async (url, o) => { vus.push([url, String(o.body)]); return { ok: true, json: async () => ({ success: true }) }; };
    H.v('turnstile réel : success true', await verifierTurnstile('tok', '1.2.3.4', { fetch: fetchFaux, secret: 'S' }), true);
    H.v('turnstile réel : POST formulaire vers siteverify', [vus[0][0], vus[0][1]], ['https://challenges.cloudflare.com/turnstile/v0/siteverify', 'secret=S&response=tok&remoteip=1.2.3.4']);
    H.v('turnstile réel : success false => false', await verifierTurnstile('t', 'ip', { fetch: async () => ({ ok: true, json: async () => ({ success: false }) }), secret: 'S' }), false);
    H.v('turnstile réel : réponse non 2xx => false', await verifierTurnstile('t', 'ip', { fetch: async () => ({ ok: false, json: async () => ({ success: true }) }), secret: 'S' }), false);
    let leve = null; try { await verifierTurnstile('t', 'ip', { fetch: fetchFaux, secret: '' }); } catch (e) { leve = e.message; }
    H.v('turnstile réel : secret absent => lève', leve, 'turnstile-non-configure');
    let brevo = null; try { require('../comptes/courrier').creerCourrierBrevo({ cle: 'k' }); } catch (e) { brevo = e.message; }
    H.v('pilote Brevo : non implémenté (aucun envoi réel possible)', brevo, 'non-implemente');
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
