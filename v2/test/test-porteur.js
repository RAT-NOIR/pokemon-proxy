'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const S = require('../comptes/sessions'); const { resoudrePorteur, exigerInstallation, exigerSession } = require('../porteur'); const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const faux = (hdr = {}, ip = '1.2.3.4') => ({ headers: Object.fromEntries(Object.entries(hdr).map(([k, v]) => [k.toLowerCase(), v])), ip, get(n) { return this.headers[n.toLowerCase()]; } });
const lancer = async (mw, req) => { let suite = false; const res = { s: null, j: null, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; }, setHeader() {} }; await mw(req, res, () => { suite = true; }); return { suite, res }; };
(async () => {
    await H.ouvrirBac('test-porteur.js'); await M.creerIndex();
    const jeton = J.genererJeton();
    const inst = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'Chrome' });
    await db.col('installations').insertOne(inst);
    // Bearer valide
    let r = faux({ Authorization: `Bearer ${jeton}` }); await lancer(resoudrePorteur(cfg), r);
    H.v('Bearer valide : porteur installation non liée', [r.v2.porteur.type, r.v2.porteur.id, r.v2.porteur.compte], ['installation', inst._id, null]);
    const ok0 = await lancer(exigerInstallation, r);
    H.v('exigerInstallation laisse passer un Bearer valide', ok0.suite, true);
    // sans rien
    r = faux({}); await lancer(resoudrePorteur(cfg), r);
    H.v('ni Bearer ni cookie : personne', [r.v2.porteur, r.v2.echec], [null, 'jeton-absent']);
    // x-jeton public ignoré
    r = faux({ 'x-jeton': jeton }); await lancer(resoudrePorteur(cfg), r);
    H.v('x-jeton ignoré (ne porte rien)', [r.v2.porteur, r.v2.echec], [null, 'jeton-absent']);
    // jeton inconnu / forme invalide / absent
    r = faux({ Authorization: 'Bearer ' + J.genererJeton() }); await lancer(resoudrePorteur(cfg), r);
    H.v('jeton inconnu', [r.v2.porteur, r.v2.echec], [null, 'jeton-inconnu']);
    r = faux({ Authorization: 'Bearer a b' }); await lancer(resoudrePorteur(cfg), r);
    H.v('forme invalide', r.v2.echec, 'jeton-absent');
    // installation révoquée
    await db.col('installations').updateOne({ _id: inst._id }, { $set: { revoqueeLe: new Date() } });
    r = faux({ Authorization: `Bearer ${jeton}` }); await lancer(resoudrePorteur(cfg), r);
    H.v('installation révoquée', [r.v2.porteur, r.v2.echec], [null, 'installation-revoquee']);
    const x1 = await lancer(exigerInstallation, r);
    H.v('exigerInstallation => 401 JETON', [x1.suite, x1.res.s, x1.res.j.erreur.code], [false, 401, 'JETON']);
    // session : cookie valide, rôle administrateur lu en base, expirée refusée
    const c = M.nouveauCompte({ email: 'a@exemple.fr', emailCle: 'a@exemple.fr', motDePasse: {} }); c.role = 'administrateur'; c.verifie = true;
    await db.col('comptes').insertOne(c);
    const s = await S.creerSession(c._id);
    r = faux({ Cookie: `autre=1; rm_session=${s.token}; z=2` }); await lancer(resoudrePorteur(cfg), r);
    H.v('cookie valide : porteur compte, administrateur', [r.v2.porteur.type, String(r.v2.porteur.id), r.v2.porteur.administrateur], ['compte', String(c._id), true]);
    const okS = await lancer(exigerSession, r); H.v('exigerSession laisse passer', okS.suite, true);
    const sess0 = await db.col('sessions').findOne({});
    H.vrai('la session en base ne porte que l\'empreinte du jeton', !JSON.stringify(sess0).includes(s.token));
    // cookie inconnu
    r = faux({ Cookie: 'rm_session=' + J.genererJeton() }); await lancer(resoudrePorteur(cfg), r);
    H.v('cookie inconnu', [r.v2.porteur, r.v2.echec], [null, 'session-absente']);
    // glissement : vue il y a 1 h => inchangée ; il y a 25 h => repoussée
    const maintenant = Date.now();
    const base0 = new Date(maintenant + 10 * 86400e3);
    await db.col('sessions').updateOne({}, { $set: { vueLe: new Date(maintenant - 3600e3), expireLe: base0 } });
    r = faux({ Cookie: `rm_session=${s.token}` }); await lancer(resoudrePorteur(cfg), r);
    let ap = await db.col('sessions').findOne({});
    H.v('vue il y a 1 h : expireLe inchangé (pas une écriture par requête)', ap.expireLe.getTime(), base0.getTime());
    await db.col('sessions').updateOne({}, { $set: { vueLe: new Date(maintenant - 25 * 3600e3) } });
    r = faux({ Cookie: `rm_session=${s.token}` }); await lancer(resoudrePorteur(cfg), r);
    ap = await db.col('sessions').findOne({});
    H.vrai('vue il y a 25 h : expireLe repoussé à now+30 j', Math.abs(ap.expireLe.getTime() - (Date.now() + 30 * 86400e3)) < 10000 && ap.vueLe.getTime() > maintenant - 5000);
    // expirée
    await db.col('sessions').updateOne({}, { $set: { expireLe: new Date(Date.now() - 1000) } });
    r = faux({ Cookie: `rm_session=${s.token}` }); await lancer(resoudrePorteur(cfg), r);
    H.v('session expirée refusée (même avant le passage du TTL Mongo)', [r.v2.porteur, r.v2.echec], [null, 'session-expiree']);
    const x2 = await lancer(exigerSession, r); H.v('exigerSession => 401 SESSION', [x2.res.s, x2.res.j.erreur.code], [401, 'SESSION']);
    // un Bearer d'installation n'ouvre pas exigerSession
    const jeton2 = J.genererJeton(); const inst2 = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton2), essais: 3, libelle: 'x' });
    await db.col('installations').insertOne(inst2);
    r = faux({ Authorization: `Bearer ${jeton2}` }); await lancer(resoudrePorteur(cfg), r);
    const x3 = await lancer(exigerSession, r); H.v('Bearer ne passe pas exigerSession', [x3.suite, x3.res.j.erreur.code], [false, 'SESSION']);
    // un cookie ne passe pas exigerInstallation
    const s3 = await S.creerSession(c._id); r = faux({ Cookie: `rm_session=${s3.token}` }); await lancer(resoudrePorteur(cfg), r);
    const x4 = await lancer(exigerInstallation, r); H.v('cookie ne passe pas exigerInstallation', [x4.suite, x4.res.j.erreur.code], [false, 'JETON']);
    // jamais de rôle venu de la requête
    await db.col('comptes').updateOne({ _id: c._id }, { $unset: { role: '' } });
    const s2 = await S.creerSession(c._id); r = faux({ Cookie: `rm_session=${s2.token}` }); r.body = { role: 'administrateur' }; await lancer(resoudrePorteur(cfg), r);
    H.v('rôle du corps ignoré', r.v2.porteur.administrateur, false);
    // compte supprimé : session orpheline refusée
    await db.col('comptes').deleteOne({ _id: c._id });
    r = faux({ Cookie: `rm_session=${s2.token}` }); await lancer(resoudrePorteur(cfg), r);
    H.v('session dont le compte a disparu : refusée', [r.v2.porteur, r.v2.echec], [null, 'session-absente']);
    // origine du site : exacte, sinon 403 ORIGINE ; sans Origin => refus (fermé)
    const org = S.exigerOrigineSite(cfg);
    H.v('Origin exacte + X-Rat-Market', (await lancer(org, faux({ Origin: 'https://rat-market.fr', 'X-Rat-Market': '1' }))).suite, true);
    H.v('Origin voisine refusée', (await lancer(org, faux({ Origin: 'https://rat-market.fr.evil.fr', 'X-Rat-Market': '1' }))).suite, false);
    H.v('X-Rat-Market absent refusé', (await lancer(org, faux({ Origin: 'https://rat-market.fr' }))).suite, false);
    H.v('sans Origin refusé', (await lancer(org, faux({ 'X-Rat-Market': '1' }))).suite, false);
    const o2 = await lancer(org, faux({}));
    H.v('refus = 403 ORIGINE', [o2.res.s, o2.res.j.erreur.code], [403, 'ORIGINE']);
    // cookie : attributs exacts
    H.v('cookie de session', S.cookieSession('T', cfg), 'rm_session=T; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000');
    H.v('cookie sans Secure uniquement si V2_COOKIE_SECURE=0', S.cookieSession('T', lireConfig({ V2_COOKIE_SECURE: '0' })), 'rm_session=T; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000');
    H.vrai('cookie d\'effacement', /^rm_session=; .*Max-Age=0/.test(S.cookieEffacement(cfg)));
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
