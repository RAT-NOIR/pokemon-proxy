'use strict';
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { resoudrePorteur } = require('../porteur');
(async () => {
    await H.ouvrirBac('test-comptes-connexion.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();   // B2b point 6 : plafonds de connexion par compte (10) et par IP (31), fenêtres FIXES d'une heure ; horloge des limiteurs fixée au milieu de l'heure
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const srv = await A.demarrer(cfg);
    let n = 0;
    const MDP = 'un-mot-de-passe-solide';
    const post = (chemin, corps, entetes = {}, avecSite = true) => H.appel(srv.url, chemin, { methode: 'POST', corps, entetes: { ...(avecSite ? A.SITE : {}), ...A.ip(++n), ...entetes } });
    const creer = async (email, verifie = true) => { const c = M.nouveauCompte({ email, emailCle: email.toLowerCase(), motDePasse: await P.hacher(MDP) }); c.verifie = verifie; await db.col('comptes').insertOne(c); return c; };
    const c = await creer('Bob@exemple.fr');
    const espion = []; const factice0 = P.verifierFactice; P.verifierFactice = async m => { espion.push(m); return factice0(m); };

    // 1
    const trace = []; const orig = { log: console.log, warn: console.warn, error: console.error };
    for (const k of Object.keys(orig)) console[k] = (...a) => trace.push(a.join(' '));
    const r1 = await post('/api/compte/connexion', { email: 'bob@EXEMPLE.fr', motDePasse: MDP });
    Object.assign(console, orig);
    const cookie = r1.entetes['set-cookie'];
    H.v('200 + compte', [r1.statut, r1.json.success, r1.json.compte.email, r1.json.compte.verifie, Object.keys(r1.json.compte).sort()], [200, true, 'Bob@exemple.fr', true, ['creeLe', 'email', 'verifie']]);
    H.vrai('Set-Cookie exact', /^rm_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/.test(cookie));
    const jetonSess = /rm_session=([^;]+)/.exec(cookie)[1];
    const sess = await db.col('sessions').find({}).toArray();
    H.v('session en base avec empreinte seule', [sess.length, sess[0].tokenEmpreinte === J.empreinte(jetonSess), JSON.stringify(sess).includes(jetonSess)], [1, true, false]);
    H.vrai('derniereConnexionLe posé', (await db.col('comptes').findOne({ _id: c._id })).derniereConnexionLe instanceof Date);
    H.v('aucun appel factice pour un compte connu', espion.length, 0);
    // 10
    H.vrai(`mot de passe absent de la réponse et des journaux (${trace.length} lignes captées)`, !r1.texte.includes(MDP) && !trace.join('\n').includes(MDP) && !trace.join('\n').toLowerCase().includes('bob@'));
    // 2 + 3
    const mauvais = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP + 'x' });
    const inconnu = await post('/api/compte/connexion', { email: 'personne@exemple.fr', motDePasse: MDP });
    const invalide = await post('/api/compte/connexion', { email: 'pas-une-adresse', motDePasse: MDP });
    const nontxt = await post('/api/compte/connexion', { email: 42, motDePasse: {} });
    H.v('mauvais mot de passe : 401 IDENTIFIANTS', [mauvais.statut, mauvais.json.erreur.code], [401, 'IDENTIFIANTS']);
    H.v('adresse inconnue / invalide / non-texte : même statut et MÊME corps (4 réponses)', [inconnu.texte === mauvais.texte, invalide.texte === mauvais.texte, nontxt.texte === mauvais.texte], [true, true, true]);
    H.v('verifierFactice appelé pour inconnue, invalide, non-texte (3 sur 3)', espion.length, 3);
    H.vrai('pas de Set-Cookie sur un échec', !mauvais.entetes['set-cookie'] && !inconnu.entetes['set-cookie']);
    // 5
    await creer('nonverifie@exemple.fr', false);
    const nv = await post('/api/compte/connexion', { email: 'nonverifie@exemple.fr', motDePasse: MDP });
    // O3 : un compte non confirmé est inactif — même réponse qu'un mauvais mot de passe (le détail est dans test-comptes-o3.js)
    H.v('compte non vérifié (bon mot de passe) : 401 IDENTIFIANTS, même corps qu\'un mauvais mot de passe', [nv.statut, nv.texte === mauvais.texte], [401, true]);
    // 4 : 10 essais/h/compte, adresses inconnues comprises
    await creer('cible@exemple.fr');
    const codes = []; for (let i = 0; i < 10; i++) codes.push((await post('/api/compte/connexion', { email: 'cible@exemple.fr', motDePasse: 'faux-faux-faux' })).statut);
    const bon = await post('/api/compte/connexion', { email: 'cible@exemple.fr', motDePasse: MDP });
    H.v('10 essais faux traités (401), la 11e tentative avec le BON mot de passe est 429 (11 tentatives)', [codes.every(x => x === 401), bon.statut, bon.json.erreur.code], [true, 429, 'DEBIT']);
    const ci = []; for (let i = 0; i < 11; i++) ci.push((await post('/api/compte/connexion', { email: 'fantome@exemple.fr', motDePasse: 'faux-faux-faux' })).statut);
    H.v('adresse INCONNUE : même plafond (10 × 401 puis 429), le plafond ne révèle rien', [ci.slice(0, 10).every(x => x === 401), ci[10]], [true, 429]);
    // 9
    const sansOrigine = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP }, {}, false);
    H.v('sans Origin : 403 ORIGINE, aucune session de plus', [sansOrigine.statut, await db.col('sessions').countDocuments({})], [403, 1]);   // O3 : le compte non vérifié ne reçoit plus de session
    // 8 glissement + 7 expiration, vus par le résolveur
    const faux = cookieTxt => ({ headers: { cookie: cookieTxt }, ip: '1.1.1.1', get(nom) { return this.headers[nom.toLowerCase()]; } });
    const resoudre = async cookieTxt => { const q = faux(cookieTxt); await resoudrePorteur(cfg)(q, { status() { return this; }, json() { return this; }, setHeader() {} }, () => {}); return q; };
    let q = await resoudre(`rm_session=${jetonSess}`);
    H.v('cookie de connexion résolu en porteur compte/scanner', [q.v2.porteur.type, q.v2.porteur.surface], ['compte', 'scanner']);
    const tok = J.empreinte(jetonSess);
    await db.col('sessions').updateOne({ tokenEmpreinte: tok }, { $set: { vueLe: new Date(Date.now() - 3600e3) } });
    const avant = (await db.col('sessions').findOne({ tokenEmpreinte: tok })).expireLe.getTime();
    await resoudre(`rm_session=${jetonSess}`);
    H.v('vue il y a 1 h : expireLe inchangé', (await db.col('sessions').findOne({ tokenEmpreinte: tok })).expireLe.getTime(), avant);
    await db.col('sessions').updateOne({ tokenEmpreinte: tok }, { $set: { vueLe: new Date(Date.now() - 25 * 3600e3), expireLe: new Date(Date.now() + 86400e3) } });
    await resoudre(`rm_session=${jetonSess}`);
    H.vrai('vue il y a 25 h : expireLe repoussé à +30 j', Math.abs((await db.col('sessions').findOne({ tokenEmpreinte: tok })).expireLe.getTime() - (Date.now() + 30 * 86400e3)) < 10000);
    await db.col('sessions').updateOne({ tokenEmpreinte: tok }, { $set: { creeLe: new Date(Date.now() - 31 * 86400e3), expireLe: new Date(Date.now() - 86400e3) } });
    q = await resoudre(`rm_session=${jetonSess}`);
    H.v('cookie rejoué après 31 jours : refusé', [q.v2.porteur, q.v2.echec], [null, 'session-expiree']);
    // 6 déconnexion
    const r2 = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP });
    const t2 = /rm_session=([^;]+)/.exec(r2.entetes['set-cookie'])[1];
    const sans = await post('/api/compte/deconnexion', {}, { cookie: `rm_session=${t2}` }, false);
    H.v('déconnexion sans Origin : 403 et la session survit', [sans.statut, await db.col('sessions').countDocuments({ tokenEmpreinte: J.empreinte(t2) })], [403, 1]);
    const dec = await post('/api/compte/deconnexion', {}, { cookie: `rm_session=${t2}` });
    H.v('déconnexion : 200 + cookie d\'effacement + session supprimée', [dec.statut, /^rm_session=; .*Max-Age=0/.test(dec.entetes['set-cookie']), await db.col('sessions').countDocuments({ tokenEmpreinte: J.empreinte(t2) })], [200, true, 0]);
    q = await resoudre(`rm_session=${t2}`);
    H.v('cookie rejoué après déconnexion : session-absente', [q.v2.porteur, q.v2.echec], [null, 'session-absente']);
    const dec2 = await post('/api/compte/deconnexion', {});
    H.v('déconnexion sans session : 200 (idempotente)', dec2.statut, 200);
    // I5 : limite par IP, distincte de celle du compte
    const s31 = []; for (let k = 0; k < 31; k++) s31.push((await H.appel(srv.url, '/api/compte/connexion', { methode: 'POST', corps: { email: `bourrage${k}@exemple.fr`, motDePasse: 'faux-faux-faux' }, entetes: { ...A.SITE, ...A.ip(9999) } })).statut);
    H.v('31 connexions, 31 adresses différentes, une même IP : 30 traitées (401), la 31e est 429 (31 requêtes)', [s31.slice(0, 30).every(x => x === 401), s31[30]], [true, 429]);
    const autreIp = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP });
    H.v('une autre IP n\'est pas touchée', autreIp.statut, 200);
    const ipBloquee = await H.appel(srv.url, '/api/compte/connexion', { methode: 'POST', corps: { email: 'bob@exemple.fr', motDePasse: MDP }, entetes: { ...A.SITE, ...A.ip(9999) } });
    H.v('l\'IP bloquée l\'est même avec le BON couple', ipBloquee.statut, 429);
    const cfgIp = lireConfig({ MONGODB_BASE: 'test_scratch', V2_CONNEXION_IP_HEURE: '2' });
    const srvIp = await A.demarrer(cfgIp);
    const si = []; for (let k = 0; k < 3; k++) si.push((await H.appel(srvIp.url, '/api/compte/connexion', { methode: 'POST', corps: { email: `reglage${k}@exemple.fr`, motDePasse: 'faux-faux-faux' }, entetes: { ...A.SITE, ...A.ip(9998) } })).statut);
    H.v('plafond réglé par V2_CONNEXION_IP_HEURE=2 : 401, 401, 429', si, [401, 401, 429]);
    await srvIp.fermer();
    P.verifierFactice = factice0;
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
