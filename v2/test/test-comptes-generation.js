'use strict';
// O3 tour 2 (I-A) — la réinitialisation ferme l'accès aussi pour une requête EN VOL : une GÉNÉRATION sur le compte (`comptes.generation`, incrémentée EN PREMIER par un `$inc` atomique),
// enregistrée sur la session, le code de liaison et l'installation liée ; un porteur n'est résolu que si la génération de l'objet est ÉGALE à celle du compte (champ absent : jamais égal).
// Un ORDRE d'opérations (sessions, puis installations, puis codes) ne ferme pas une requête déjà partie ; une génération, si. Les trois courses de la relecture sont rejouées par injection.
const express = require('express');
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles'); const pret = require('../pret');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe'); const liaison = require('../installations/liaison');
const { resoudrePorteur } = require('../porteur'); const registre = require('../registre'); const { creerCourrierMemoire } = require('../comptes/courrier');
(async () => {
    await H.ouvrirBac('test-comptes-generation.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    A.registre.fournir('courrier', creerCourrierMemoire()); A.registre.fournir('turnstile', { verifier: async () => true });
    const { assembler } = require('../index'); const app = express(); app.set('trust proxy', true); app.use(express.json()); pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../installations/monter'), require('../comptes/monter')], cfg, {}));
    const srv = await H.serveur(app); let n = 0;
    const SITE = { ...A.SITE }, EXT = { origin: cfg.origines.extension };
    const post = (ch, corps, entetes = {}) => H.appel(srv.url, ch, { methode: 'POST', corps, entetes: { ...A.ip(++n), ...entetes } });
    const MDP = 'mot-de-passe-du-tiers', MDP2 = 'mot-de-passe-de-la-victime';
    const resoudre = async entetes => { const q = { headers: entetes, ip: '1.1.1.1', get(k) { return this.headers[k.toLowerCase()]; } }; await resoudrePorteur(cfg)(q, { status() { return this; }, json() { return this; }, setHeader() { } }, () => { }); return q.v2; };
    let nc = 0;
    const nouveauCompte = async () => {
        const email = `gen${++nc}@exemple.fr`, c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: await P.hacher(MDP) }), { verifie: true, offertesAccordeesLe: new Date(), solde: { accueil: 25, achete: 0 } });
        await db.col('comptes').insertOne(c); return c;
    };
    const connexion = async c => { const r = await post('/api/compte/connexion', { email: c.email, motDePasse: MDP }, SITE); return { r, cookie: String(r.entetes['set-cookie'] || '').split(';')[0] }; };
    const reinit = async (c, mdp = MDP2) => { const j = J.genererJeton(); await db.col('liens_email').insertOne({ empreinte: J.empreinte(j), type: 'reinit', compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), utiliseLe: null }); return post('/api/compte/reinitialiser', { jeton: j, motDePasse: mdp }, SITE); };
    const instAnon = async () => { const jeton = J.genererJeton(), i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'tiers' }); await db.col('installations').insertOne(i); return { i, jeton }; };
    const code = ck => post('/api/compte/code', {}, { ...SITE, cookie: ck });
    const genDe = async c => (await db.col('comptes').findOne({ _id: c._id })).generation;

    // ---- la génération elle-même
    {
        const c = await nouveauCompte(); const { cookie } = await connexion(c); const code0 = await code(cookie);
        H.v('A1. un compte neuf a la génération 0 ; la session et le code créés la portent', [await genDe(c), (await db.col('sessions').findOne({ compteId: c._id })).generation, (await db.col('codes_liaison').findOne({ compteId: c._id })).generation], [0, 0, 0]);
        const { i, jeton } = await instAnon(); const lie = await post('/api/compte/lier', { code: code0.json.code }, { authorization: `Bearer ${jeton}`, ...EXT });
        const inst = await db.col('installations').findOne({ _id: i._id });
        H.v('A2. l\'installation liée porte la génération du code', [lie.statut, inst.generation], [200, 0]);
        const avantP = await resoudre({ cookie }), avantI = await resoudre({ authorization: `Bearer ${lie.json.jetonInstallation}` });
        H.v('A3. (avant) la session et l\'installation liée résolvent un porteur compte', [avantP.porteur && avantP.porteur.type, avantI.porteur && avantI.porteur.type], ['compte', 'compte']);
        await reinit(c);
        H.v('A4. la réinitialisation incrémente la génération (1) ; une seconde (2)', [await genDe(c), (await reinit(c, 'encore-un-mot-de-passe-9'), await genDe(c))], [1, 2]);
        // sessions et installations posées DIRECTEMENT à l'ancienne génération, malgré le ménage : elles ne valent rien
        const tokS = J.genererJeton(); await db.col('sessions').insertOne({ tokenEmpreinte: J.empreinte(tokS), compteId: c._id, generation: 0, creeLe: new Date(), vueLe: new Date(), expireLe: new Date(Date.now() + 864e5) });
        const tokI = J.genererJeton(); await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(tokI), essais: 0, libelle: 'vieille' }), compteId: c._id, generation: 0 });
        const rS = await resoudre({ cookie: `rm_session=${tokS}` }), rI = await resoudre({ authorization: `Bearer ${tokI}` });
        H.v('A5. une session et une installation liée de l\'ANCIENNE génération : session refusée (401), installation traitée comme anonyme', [rS.porteur, rS.echec, rI.porteur && rI.porteur.type, rI.porteur && rI.porteur.compte], [null, 'session-absente', 'installation', null]);
        // champ absent : jamais égal
        const tokS2 = J.genererJeton(); await db.col('sessions').insertOne({ tokenEmpreinte: J.empreinte(tokS2), compteId: c._id, creeLe: new Date(), vueLe: new Date(), expireLe: new Date(Date.now() + 864e5) });
        const tokI2 = J.genererJeton(); await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(tokI2), essais: 0, libelle: 'sans' }), compteId: c._id, generation: undefined });
        const g2 = await genDe(c);
        const rS2 = await resoudre({ cookie: `rm_session=${tokS2}` }), rI2 = await resoudre({ authorization: `Bearer ${tokI2}` });
        H.v('A6. champ absent jamais égal : une session sans génération est refusée, une installation liée sans génération est anonyme', [rS2.porteur, rI2.porteur && rI2.porteur.type, g2], [null, 'installation', 2]);
        const c3 = await nouveauCompte(); await db.col('comptes').updateOne({ _id: c3._id }, { $unset: { generation: '' } });
        const tokS3 = J.genererJeton(); await db.col('sessions').insertOne({ tokenEmpreinte: J.empreinte(tokS3), compteId: c3._id, generation: 0, creeLe: new Date(), vueLe: new Date(), expireLe: new Date(Date.now() + 864e5) });
        H.v('A7. … et un COMPTE sans génération ne valide aucune session (les deux doivent être présentes)', (await resoudre({ cookie: `rm_session=${tokS3}` })).porteur, null);
        const tokS4 = J.genererJeton(); await db.col('sessions').insertOne({ tokenEmpreinte: J.empreinte(tokS4), compteId: c3._id, creeLe: new Date(), vueLe: new Date(), expireLe: new Date(Date.now() + 864e5) });
        const tokI4 = J.genererJeton(); await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(tokI4), essais: 0, libelle: 'sans-sans' }), compteId: c3._id, generation: undefined });
        H.v('A8. … et quand le compte ET l\'objet n\'ont PAS de génération, ils ne sont pas « égaux » pour autant : session refusée, installation anonyme', [(await resoudre({ cookie: `rm_session=${tokS4}` })).porteur, (await resoudre({ authorization: `Bearer ${tokI4}` })).porteur.type], [null, 'installation']);
    }

    // ---- course 1 : une liaison EN VOL avec un code encore vivant, pendant la réinitialisation
    {
        const c = await nouveauCompte(); const { cookie } = await connexion(c); const cd = await code(cookie);
        const { i, jeton } = await instAnon(); const argent = registre.obtenir('argent');
        const proto = Object.getPrototypeOf(db.col('codes_liaison')), orig = proto.deleteMany; let enVol = null;
        proto.deleteMany = async function (f, ...r) { if (this.collectionName.endsWith('codes_liaison') && !enVol) { enVol = await liaison.lier({ installation: i, code: cd.json.code, argent }); } return orig.call(this, f, ...r); };
        let rr; try { rr = await reinit(c); } finally { proto.deleteMany = orig; }
        const apres = await db.col('installations').findOne({ _id: i._id }), porteur = (await resoudre({ authorization: `Bearer ${jeton}` })).porteur;
        H.v('C1. liaison en vol (code vivant) pendant la réinitialisation : réinitialisation 200, liaison REFUSÉE, installation sans compte, jeton anonyme', [rr.statut, enVol && enVol.ok === true, apres.compteId, porteur && porteur.type], [200, false, null, 'installation']);
        const nouveau = await resoudre({ authorization: `Bearer ${jeton}` });
        H.v('C1b. … le jeton de l\'installation ne résout aucun porteur compte', nouveau.porteur && nouveau.porteur.compte, null);
    }
    // ---- course 2 : une demande de code EN VOL (porteur résolu avant la réinitialisation, code écrit après)
    {
        const c = await nouveauCompte(); const { cookie } = await connexion(c);
        const proto = Object.getPrototypeOf(db.col('codes_liaison')), orig = proto.insertOne; let ranger = false;
        proto.insertOne = async function (...a) { if (this.collectionName.endsWith('codes_liaison') && !ranger) { ranger = true; await reinit(c); } return orig.apply(this, a); };
        let cd; try { cd = await code(cookie); } finally { proto.insertOne = orig; }
        const { i, jeton } = await instAnon();
        const lie = await post('/api/compte/lier', { code: cd.json && cd.json.code }, { authorization: `Bearer ${jeton}`, ...EXT });
        const apres = await db.col('installations').findOne({ _id: i._id });
        H.v('C2. demande de code en vol (écrite APRÈS la réinitialisation) : le code ne lie rien (404), l\'installation reste sans compte', [lie.statut, apres.compteId], [404, null]);
    }
    // ---- course 2b : la réinitialisation passe ENTRE la résolution du porteur et le début de `creerCode` (la génération doit venir du porteur résolu, pas être relue à l'écriture)
    {
        const c = await nouveauCompte(); const { cookie } = await connexion(c);
        const proto = Object.getPrototypeOf(db.col('comptes')), orig = proto.findOne; let ranger = false;
        proto.findOne = async function (f, o, ...r) { const res = await orig.call(this, f, o, ...r); if (this.collectionName.endsWith('comptes') && f && f._id && !(o && o.projection) && !ranger) { ranger = true; proto.findOne = orig; await reinit(c); } return res; };
        let cd; try { cd = await code(cookie); } finally { proto.findOne = orig; }
        const { i, jeton } = await instAnon();
        const lie = await post('/api/compte/lier', { code: cd.json && cd.json.code }, { authorization: `Bearer ${jeton}`, ...EXT });
        H.v('C2b. réinitialisation entre la résolution du porteur et l\'écriture du code : le code porte la génération du PORTEUR résolu, il ne lie rien (404)', [ranger, lie.statut, (await db.col('installations').findOne({ _id: i._id })).compteId], [true, 404, null]);
    }
    // ---- course 3 : une connexion EN VOL, mot de passe vérifié AVANT la réinitialisation
    {
        const c = await nouveauCompte(); const orig = P.verifier; let fait = false;
        P.verifier = async (m, rec) => { const r = await orig(m, rec); if (!fait) { fait = true; await reinit(c); } return r; };
        let conn; try { conn = await connexion(c); } finally { P.verifier = orig; }
        const rP = await resoudre({ cookie: conn.cookie });
        H.v('C3. connexion en vol (ancien mot de passe vérifié avant la réinitialisation) : le cookie obtenu ne résout AUCUN porteur', [fait, rP.porteur], [true, null]);
        const bon = await post('/api/compte/connexion', { email: c.email, motDePasse: MDP2 }, SITE);
        H.v('C3b. … et la connexion avec le NOUVEAU mot de passe donne une session valide', [bon.statut, (await resoudre({ cookie: String(bon.entetes['set-cookie']).split(';')[0] })).porteur.type], [200, 'compte']);
    }
    // ---- course 4 : la réinitialisation passe ENTRE l'écriture de la liaison et la fin de `lier` : la liaison est défaite, l'installation n'est pas laissée « liée » à une génération révolue
    {
        const c = await nouveauCompte(); const { cookie } = await connexion(c); const cd = await code(cookie);
        const { i, jeton } = await instAnon(); const argent = registre.obtenir('argent');
        const proto = Object.getPrototypeOf(db.col('installations')), orig = proto.updateOne; let fait = false;
        proto.updateOne = async function (f, ...r) { const res = await orig.call(this, f, ...r); if (this.collectionName.endsWith('installations') && f && f.compteId === null && f.revoqueeLe === null && !fait) { fait = true; await reinit(c); } return res; };
        let lie; try { lie = await liaison.lier({ installation: i, code: cd.json.code, argent }); } finally { proto.updateOne = orig; }
        const apres = await db.col('installations').findOne({ _id: i._id });
        H.v('C4. réinitialisation entre l\'écriture de la liaison et sa fin : 404, installation DÉLIÉE (compteId null, jeton d\'origine), aucun porteur compte', [fait, lie.statut, apres.compteId, apres.jetonEmpreinte === J.empreinte(jeton), (await resoudre({ authorization: `Bearer ${jeton}` })).porteur.type], [true, 404, null, true, 'installation']);
    }
    // ---- liaison : refus au moment de l'écriture si la génération du code n'est plus celle du compte
    {
        const c = await nouveauCompte(); const { cookie } = await connexion(c); const cd = await code(cookie);
        await db.col('comptes').updateOne({ _id: c._id }, { $inc: { generation: 1 } });   // la génération bouge sans autre ménage (code vivant)
        const { i, jeton } = await instAnon();
        const lie = await post('/api/compte/lier', { code: cd.json.code }, { authorization: `Bearer ${jeton}`, ...EXT });
        H.v('L1. un code d\'une génération révolue est refusé même vivant (404) ; l\'installation reste sans compte', [lie.statut, (await db.col('installations').findOne({ _id: i._id })).compteId], [404, null]);
    }
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
