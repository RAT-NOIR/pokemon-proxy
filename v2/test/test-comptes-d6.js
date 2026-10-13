'use strict';
// Lot O3-RESIDU (décision D6 du testeur) : le mot de passe d'un compte se choisit AU CLIC de confirmation, plus à l'inscription.
// Scénario du tiers : il inscrit l'adresse d'une victime ; la victime clique le lien reçu ; le compte ne doit JAMAIS s'ouvrir avec un secret que le tiers connaît.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { creerCourrierMemoire } = require('../comptes/courrier'); const svc = require('../comptes/service');
const HEURE = 3600e3;
(async () => {
    await H.ouvrirBac('test-comptes-d6.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    const srv = await A.demarrer(cfg); let n = 0;
    const TIERS = 'mot-de-passe-du-tiers', VICTIME = 'mot-de-passe-de-la-victime', AUTRE = 'un-autre-mot-de-passe-choisi';
    const post = (chemin, corps, entetes = {}) => H.appel(srv.url, chemin, { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(++n), ...entetes } });
    const ins = async (email, extra = {}) => { const r = await post('/api/compte/inscription', { email, turnstile: 'ok', ...extra }); await A.attendre(); return r; };
    const conn = (email, mdp) => post('/api/compte/connexion', { email, motDePasse: mdp });
    const compteDe = email => db.col('comptes').findOne({ emailCle: email.toLowerCase() });
    const dernierLien = () => new URL(courrier.envoyes.filter(e => e.type === 'verification').pop().lien).searchParams.get('jeton');
    const liberer = () => db.col('limites').updateMany({ cle: /^confirmation:/ }, { $set: { expireLe: new Date(Date.now() - 1000) } });
    const confirmer = (jeton, motDePasse) => post('/api/compte/verification', motDePasse === undefined ? { jeton } : { jeton, motDePasse });
    const lienPour = async (c, decalageMs = 24 * HEURE) => { const jeton = J.genererJeton(); await db.col('liens_email').insertOne({ empreinte: J.empreinte(jeton), type: 'verification', compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + decalageMs), utiliseLe: null }); return jeton; };

    // ---- 1 : l'inscription ne prend plus de mot de passe ----
    const r1 = await ins('victime@exemple.fr');
    const c1 = await compteDe('victime@exemple.fr');
    H.v('D6-1a. inscription SANS mot de passe : 202 { success: true }', [r1.statut, r1.json], [202, { success: true }]);
    H.v('D6-1b. le compte est inactif, sans mot de passe (null), 0 crédit, sans offertes', [c1.verifie, c1.motDePasse, c1.solde, c1.offertesAccordeesLe], [false, null, { accueil: 0, achete: 0 }, null]);
    H.v('D6-1c. un courriel de confirmation est parti', courrier.envoyes.filter(e => e.type === 'verification').length, 1);
    const avant = await db.col('comptes').countDocuments({}), mails = courrier.envoyes.length; await liberer();
    const rP = await ins('tiers-pre@exemple.fr', { motDePasse: TIERS });
    H.v('D6-1d. inscription AVEC un mot de passe : refusée (422 ENTREE, detail mot-de-passe-non-attendu)', [rP.statut, rP.json && rP.json.erreur && rP.json.erreur.code, rP.json && rP.json.erreur && rP.json.erreur.detail], [422, 'ENTREE', 'mot-de-passe-non-attendu']);
    H.v('D6-1e. … aucun compte créé, aucun courriel, rien de haché', [await db.col('comptes').countDocuments({}) - avant, courrier.envoyes.length - mails], [0, 0]);
    for (const v of [null, '', 12, {}, TIERS]) {
        const r = await ins('tiers-pre@exemple.fr', { motDePasse: v });
        H.v(`D6-1f. la simple PRÉSENCE du champ est refusée, quelle que soit sa valeur (${JSON.stringify(v)})`, r.statut, 422);
    }
    H.v('D6-1g. aucune de ces tentatives n\'a laissé de compte', await compteDe('tiers-pre@exemple.fr'), null);

    // ---- 2 : le scénario du tiers (O3 résiduel) ----
    // le tiers ne peut plus poser de secret ; la victime choisit le sien au clic ; seul le sien ouvre le compte
    await liberer(); courrier.envoyes.length = 0;
    await ins('cible@exemple.fr');
    const lienCible = dernierLien();
    const avantClic = [(await conn('cible@exemple.fr', TIERS)).statut, (await conn('cible@exemple.fr', '')).statut];
    const clic = await confirmer(lienCible, VICTIME);
    const apres = [(await conn('cible@exemple.fr', TIERS)).statut, (await conn('cible@exemple.fr', VICTIME)).statut];
    H.v('D6-2a. SCÉNARIO DU TIERS : avant le clic aucune connexion ; la victime choisit son mot de passe au clic (200) ; le secret du tiers échoue (401), celui de la victime ouvre (200)', [avantClic, clic.statut, apres], [[401, 401], 200, [401, 200]]);
    // legacy : un compte créé AVANT ce lot porte le hachage du tiers, non confirmé
    await liberer(); courrier.envoyes.length = 0;
    const leg = M.nouveauCompte({ email: 'legacy@exemple.fr', emailCle: 'legacy@exemple.fr', motDePasse: await P.hacher(TIERS) });
    await db.col('comptes').insertOne(leg); const lienLeg = await lienPour(leg);
    const aLeg = [(await conn('legacy@exemple.fr', TIERS)).statut];
    const cLeg = await confirmer(lienLeg, VICTIME);
    H.v('D6-2b. compte hérité (non confirmé, hachage du tiers) : refus tant que non confirmé, le clic REMPLACE le mot de passe par celui du clic', [aLeg, cLeg.statut, (await conn('legacy@exemple.fr', TIERS)).statut, (await conn('legacy@exemple.fr', VICTIME)).statut], [[401], 200, 401, 200]);
    // renvoi demandé par la victime : le compte n'a aucun secret à voler
    await liberer(); courrier.envoyes.length = 0;
    await ins('cible2@exemple.fr'); await liberer(); await post('/api/compte/renvoyer-verification', { email: 'cible2@exemple.fr' }); await A.attendre();
    const lienR = dernierLien();
    H.v('D6-2c. renvoi puis clic : le compte s\'active avec le mot de passe du clic seulement', [(await confirmer(lienR, VICTIME)).statut, (await conn('cible2@exemple.fr', TIERS)).statut, (await conn('cible2@exemple.fr', VICTIME)).statut], [200, 401, 200]);

    // ---- 3 : la confirmation ----
    await liberer(); courrier.envoyes.length = 0;
    await ins('conf@exemple.fr'); const jc = dernierLien();
    const sans = await confirmer(jc), typ = await confirmer(jc, 12), nul = await confirmer(jc, null), obj = await confirmer(jc, {});
    H.v('D6-3a. confirmation sans mot de passe / non-texte : 400 ENTREE, le lien n\'est pas brûlé, le compte reste inactif', [[sans, typ, nul, obj].map(r => [r.statut, r.json.erreur.code]), (await db.col('liens_email').findOne({ empreinte: J.empreinte(jc) })).utiliseLe, (await compteDe('conf@exemple.fr')).verifie], [[[400, 'ENTREE'], [400, 'ENTREE'], [400, 'ENTREE'], [400, 'ENTREE']], null, false]);
    const faibles = {};
    for (const [k, v] of Object.entries({ court: 'abc', neufCaracteres: '123456789', trop: 'x'.repeat(201), adresse: 'conf@exemple.fr' })) { const r = await confirmer(jc, v); faibles[k] = [r.statut, r.json.erreur.code, r.json.erreur.detail]; }
    H.v('D6-3b. mot de passe refusé par la politique (mêmes règles que la réinitialisation) : 422 MOT_DE_PASSE_FAIBLE avec son detail', faibles, { court: [422, 'MOT_DE_PASSE_FAIBLE', 'trop-court'], neufCaracteres: [422, 'MOT_DE_PASSE_FAIBLE', 'trop-court'], trop: [422, 'MOT_DE_PASSE_FAIBLE', 'trop-long'], adresse: [422, 'MOT_DE_PASSE_FAIBLE', 'egal-a-l-adresse'] });
    H.v('D6-3c. … un refus de politique ne brûle pas le lien et n\'active rien', [(await db.col('liens_email').findOne({ empreinte: J.empreinte(jc) })).utiliseLe, (await compteDe('conf@exemple.fr')).verifie, (await compteDe('conf@exemple.fr')).motDePasse], [null, false, null]);
    const ok = await confirmer(jc, VICTIME);
    const cc = await compteDe('conf@exemple.fr');
    H.v('D6-3d. le lien et un bon mot de passe : 200 { success, verifie }', [ok.statut, ok.json], [200, { success: true, verifie: true }]);
    H.v('D6-3e. le compte est actif avec les 25 offertes, un hachage scrypt du mot de passe choisi (jamais le clair)', [cc.verifie, cc.solde.accueil, cc.motDePasse && cc.motDePasse.algo, await P.verifier(VICTIME, cc.motDePasse), JSON.stringify(cc).includes(VICTIME)], [true, 25, 'scrypt', true, false]);
    H.v('D6-3f. connexion avec ce mot de passe : 200', (await conn('conf@exemple.fr', VICTIME)).statut, 200);
    H.vrai('D6-3f bis. le lien utilisé est marqué utilisé (usage unique tenu dans la base, pas seulement par l\'état du compte)', (await db.col('liens_email').findOne({ empreinte: J.empreinte(jc) })).utiliseLe instanceof Date);
    const rej = await confirmer(jc, AUTRE);
    H.v('D6-3g. le lien est à usage unique : rejeu 404 CODE_INVALIDE, le mot de passe ne change pas', [rej.statut, rej.json.erreur.code, (await conn('conf@exemple.fr', VICTIME)).statut, (await conn('conf@exemple.fr', AUTRE)).statut], [404, 'CODE_INVALIDE', 200, 401]);
    // lien expiré, inconnu, du mauvais type
    const ce = M.nouveauCompte({ email: 'exp@exemple.fr', emailCle: 'exp@exemple.fr', motDePasse: null }); await db.col('comptes').insertOne(ce);
    const rExp = await confirmer(await lienPour(ce, -1000), VICTIME);
    H.v('D6-3h. lien expiré : 410 CODE_EXPIRE, compte inactif et sans mot de passe', [rExp.statut, rExp.json.erreur.code, (await db.col('comptes').findOne({ _id: ce._id })).verifie, (await db.col('comptes').findOne({ _id: ce._id })).motDePasse], [410, 'CODE_EXPIRE', false, null]);
    const rIn = await confirmer(J.genererJeton(), VICTIME);
    H.v('D6-3i. lien inconnu : 404 CODE_INVALIDE', [rIn.statut, rIn.json.erreur.code], [404, 'CODE_INVALIDE']);

    // ---- 4 : concurrence et états croisés ----
    const cr = M.nouveauCompte({ email: 'course@exemple.fr', emailCle: 'course@exemple.fr', motDePasse: null }); await db.col('comptes').insertOne(cr);
    const jr = await lienPour(cr);
    const mdps = Array.from({ length: 8 }, (_, i) => `mot-de-passe-concurrent-${i}`);
    const rafale = await Promise.all(mdps.map(m => confirmer(jr, m)));
    const gagnants = rafale.map((r, i) => (r.statut === 200 ? mdps[i] : null)).filter(Boolean);
    const stocke = (await db.col('comptes').findOne({ _id: cr._id })).motDePasse;
    H.v('D6-4a. 8 clics SIMULTANÉS sur un même lien avec 8 mots de passe : un seul 200, et le mot de passe stocké est CELUI du 200 (pas celui d\'un perdant)', [gagnants.length, gagnants.length === 1 && await P.verifier(gagnants[0], stocke), (await db.col('comptes').findOne({ _id: cr._id })).solde.accueil, await db.col('mouvements').countDocuments({ compteId: cr._id })], [1, true, 25, 1]);
    // un second lien vivant pour un compte DÉJÀ confirmé ne change pas son mot de passe
    const j2 = await lienPour(cr);
    const r2 = await confirmer(j2, AUTRE);
    H.v('D6-4b. un second lien (renvoi) cliqué après la confirmation : 404, le mot de passe ne change pas', [r2.statut, gagnants.length === 1 && await P.verifier(gagnants[0], (await db.col('comptes').findOne({ _id: cr._id })).motDePasse), await P.verifier(AUTRE, (await db.col('comptes').findOne({ _id: cr._id })).motDePasse)], [404, true, false]);
    // les autres liens vivants de la confirmation sont brûlés avec elle
    const cm = M.nouveauCompte({ email: 'multi@exemple.fr', emailCle: 'multi@exemple.fr', motDePasse: null }); await db.col('comptes').insertOne(cm);
    const lm = [await lienPour(cm), await lienPour(cm), await lienPour(cm)];
    await confirmer(lm[0], VICTIME);
    H.v('D6-4c. la confirmation brûle aussi les autres liens de vérification vivants du compte', await db.col('liens_email').countDocuments({ compteId: cm._id, type: 'verification', utiliseLe: null }), 0);
    // compte activé par la réinitialisation (chemin légitime) : le lien de vérification restant ne peut plus rien
    const cn = M.nouveauCompte({ email: 'reinit@exemple.fr', emailCle: 'reinit@exemple.fr', motDePasse: null }); await db.col('comptes').insertOne(cn);
    const lv = await lienPour(cn); const lr = J.genererJeton();
    await db.col('liens_email').insertOne({ empreinte: J.empreinte(lr), type: 'reinit', compteId: cn._id, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), utiliseLe: null });
    const rr = await post('/api/compte/reinitialiser', { jeton: lr, motDePasse: VICTIME });
    const rv = await confirmer(lv, AUTRE);
    H.v('D6-4d. compte activé par la réinitialisation : le lien de vérification resté vivant est refusé (404) et ne remplace pas le mot de passe', [rr.statut, rv.statut, (await conn('reinit@exemple.fr', VICTIME)).statut, (await conn('reinit@exemple.fr', AUTRE)).statut], [200, 404, 200, 401]);
    // compte périmé (48 h) : pas d'activation
    const cp = M.nouveauCompte({ email: 'perime@exemple.fr', emailCle: 'perime@exemple.fr', motDePasse: null, now: new Date(Date.now() - 49 * HEURE) }); await db.col('comptes').insertOne(cp);
    const rp = await confirmer(await lienPour(cp), VICTIME);
    H.v('D6-4e. lien cliqué après 48 h : 404, compte non activé (purgé)', [rp.statut, (await db.col('comptes').findOne({ _id: cp._id }))], [404, null]);

    // ---- 5 : panne d'écriture entre le brûlage du lien et l'activation ----
    {
        const cx = M.nouveauCompte({ email: 'panne@exemple.fr', emailCle: 'panne@exemple.fr', motDePasse: null }); await db.col('comptes').insertOne(cx);
        const jx = await lienPour(cx);
        const proto = Object.getPrototypeOf(db.col('comptes')); const orig = proto.updateOne; let frappe = 0;
        proto.updateOne = async function (filtre, ...r) { if (this.collectionName.endsWith('comptes') && filtre && filtre._id && String(filtre._id) === String(cx._id) && !frappe) { frappe++; throw new Error('panne'); } return orig.call(this, filtre, ...r); };
        let rep; try { rep = await confirmer(jx, VICTIME); } finally { proto.updateOne = orig; }
        const lien = await db.col('liens_email').findOne({ empreinte: J.empreinte(jx) });
        H.v('D6-5a. écriture en panne : 503, le lien n\'est PAS perdu (rejouable), compte inactif sans mot de passe', [frappe, rep.statut, lien.utiliseLe, (await db.col('comptes').findOne({ _id: cx._id })).verifie, (await db.col('comptes').findOne({ _id: cx._id })).motDePasse], [1, 503, null, false, null]);
        H.v('D6-5b. … et le rejeu aboutit', [(await confirmer(jx, VICTIME)).statut, (await conn('panne@exemple.fr', VICTIME)).statut], [200, 200]);
    }

    // ---- 5 bis : l'adresse a déjà reçu ses offertes (compte supprimé puis recréé) ; et une activation concurrente par un autre chemin ----
    {
        const hashConcurrent = await P.hacher('mot-de-passe-du-concurrent');
        const prep = async nom => { const c = M.nouveauCompte({ email: `${nom}@exemple.fr`, emailCle: `${nom}@exemple.fr`, motDePasse: null }); await db.col('comptes').insertOne(c); return { c, jeton: await lienPour(c) }; };
        const recu = c => db.col('comptes').findOne({ _id: c._id });
        // 8a : empreinte d'octroi présente -> activation SANS offerte, avec le mot de passe du clic
        const a = await prep('empreinte-d6');
        await db.col('adresses_octroyees').insertOne({ empreinte: svc.empreinteAdresse(a.c.emailCle, cfg), creeLe: new Date(), expireLe: new Date(Date.now() + 365 * 864e5) });
        const ra = await confirmer(a.jeton, VICTIME), ca = await recu(a.c);
        H.v('D6-8a. adresse déjà gratifiée : 200, compte actif avec le mot de passe choisi au clic, aucune offerte', [ra.statut, ca.verifie, ca.solde.accueil, await P.verifier(VICTIME, ca.motDePasse), (await conn('empreinte-d6@exemple.fr', VICTIME)).statut], [200, true, 0, true, 200]);
        // 8b / 8c : un autre chemin active le compte ENTRE la lecture et l'écriture ; ce clic ne doit ni répondre 200 ni écraser le mot de passe de l'autre
        const proto = Object.getPrototypeOf(db.col('comptes')); const orig = proto.updateOne;
        const concurrent = async (cible, quand) => {
            let frappe = 0;
            proto.updateOne = async function (filtre, ...r) {
                if (this.collectionName.endsWith('comptes') && filtre && String(filtre._id) === String(cible.c._id) && filtre.verifie === false && quand(filtre) && !frappe) {
                    frappe++; await orig.call(this, { _id: cible.c._id }, { $set: { verifie: true, verifieLe: new Date(), motDePasse: hashConcurrent } });
                }
                return orig.call(this, filtre, ...r);
            };
            try { return { rep: await confirmer(cible.jeton, AUTRE), frappe }; } finally { proto.updateOne = orig; }
        };
        const b = await prep('concurrent-seconde-branche');
        await db.col('adresses_octroyees').insertOne({ empreinte: svc.empreinteAdresse(b.c.emailCle, cfg), creeLe: new Date(), expireLe: new Date(Date.now() + 365 * 864e5) });
        const rb = await concurrent(b, f => !('offertesAccordeesLe' in f)), cb = await recu(b.c);
        H.v('D6-8b. activation concurrente (adresse déjà gratifiée) : ce clic répond 404 et le mot de passe de l\'autre chemin reste', [rb.frappe, rb.rep.statut, await P.verifier('mot-de-passe-du-concurrent', cb.motDePasse), await P.verifier(AUTRE, cb.motDePasse)], [1, 404, true, false]);
        const c = await prep('concurrent-premiere-branche');
        const rc = await concurrent(c, f => 'offertesAccordeesLe' in f), cc2 = await recu(c.c);
        H.v('D6-8c. activation concurrente (première écriture) : ce clic répond 404, le mot de passe de l\'autre chemin reste, aucune offerte octroyée par ce clic', [rc.frappe, rc.rep.statut, await P.verifier('mot-de-passe-du-concurrent', cc2.motDePasse), await P.verifier(AUTRE, cc2.motDePasse), cc2.solde.accueil, await db.col('mouvements').countDocuments({ compteId: c.c._id })], [1, 404, true, false, 0, 0]);
    }

    // ---- 6 : connexion d'un compte sans mot de passe : même calcul, même réponse ----
    {
        await ins('sanssecret@exemple.fr');
        const espion = []; const f0 = P.verifierFactice, v0 = P.verifier;
        P.verifierFactice = async m => { espion.push('factice'); return f0(m); }; P.verifier = async (m, r) => { espion.push('verifier'); return v0(m, r); };
        let sans1, inconnu, faux;
        try { sans1 = await conn('sanssecret@exemple.fr', TIERS); inconnu = await conn('personne@exemple.fr', TIERS); faux = await conn('conf@exemple.fr', TIERS); } finally { P.verifierFactice = f0; P.verifier = v0; }
        const sansDate = r => JSON.stringify([r.statut, Object.entries(r.entetes).filter(([k]) => k !== 'date').sort(), r.texte]);
        H.v('D6-6a. un compte sans mot de passe paie le MÊME scrypt qu\'une adresse inconnue (jamais de sortie rapide qui le distinguerait d\'un mauvais mot de passe)', espion, ['factice', 'factice', 'verifier']);
        H.v('D6-6b. … et répond à l\'octet comme un mauvais mot de passe et une adresse inconnue (401 IDENTIFIANTS)', [sans1.statut, sansDate(sans1) === sansDate(inconnu), sansDate(sans1) === sansDate(faux)], [401, true, true]);
        const bon = await conn('sanssecret@exemple.fr', ''), nulMdp = await post('/api/compte/connexion', { email: 'sanssecret@exemple.fr' });
        H.v('D6-6c. mot de passe vide ou absent sur un compte sans mot de passe : 401, jamais une session', [bon.statut, nulMdp.statut, await db.col('sessions').countDocuments({ compteId: (await compteDe('sanssecret@exemple.fr'))._id })], [401, 401, 0]);
    }

    // ---- 7 : ce qui ne change pas ----
    {
        await liberer(); courrier.envoyes.length = 0;
        await ins('stable@exemple.fr'); const avantDoc = JSON.stringify(await compteDe('stable@exemple.fr')); await liberer();
        await ins('stable@exemple.fr'); await A.attendre();
        H.v('D6-7a. réinscription d\'une adresse en attente : le document est identique (le premier inscrit garde la place), un courriel part si la limite le permet', [JSON.stringify(await compteDe('stable@exemple.fr')) === avantDoc, courrier.envoyes.filter(e => e.type === 'verification').length], [true, 2]);
        const r1 = await ins('stable@exemple.fr'), r2 = await ins('inconnue-d6@exemple.fr'), r3 = await ins('conf@exemple.fr');
        const sd = r => JSON.stringify([r.statut, Object.entries(r.entetes).filter(([k]) => k !== 'date').sort(), r.texte]);
        H.v('D6-7b. l\'inscription répond à l\'octet pareil pour une adresse neuve, en attente ou déjà confirmée', [sd(r1) === sd(r2), sd(r2) === sd(r3)], [true, true]);
    }
    void svc;
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
