'use strict';
// Lot O3 (audit de sécurité, pré-inscription d'une adresse tierce) : un compte non confirmé est INACTIF (aucun porteur), un seul courriel de
// confirmation par adresse et par 24 h (compteur persistant), purge à 48 h (l'adresse redevient libre), réponse identique à l'octet.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { creerCourrierMemoire } = require('../comptes/courrier'); const svc = require('../comptes/service'); const liaison = require('../installations/liaison');
const Pg = (() => { try { return require('../comptes/purge'); } catch { return {}; } })();   // module du lot : absent = chaque assertion rougit, le banc ne plante pas
const HEURE = 3600e3;
(async () => {
    await H.ouvrirBac('test-comptes-o3.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    const srv = await A.demarrer(cfg); let n = 0;
    const MDP = 'mot-de-passe-du-tiers', MDP_VICTIME = 'mot-de-passe-de-la-victime';
    const post = (chemin, corps, entetes = {}) => H.appel(srv.url, chemin, { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(++n), ...entetes } });
    const ins = async (email, mdp = MDP) => { const r = await post('/api/compte/inscription', { email, motDePasse: mdp, turnstile: 'ok' }); await A.attendre(); return r; };
    const renv = async email => { const r = await post('/api/compte/renvoyer-verification', { email }); await A.attendre(); return r; };
    const conn = (email, mdp) => post('/api/compte/connexion', { email, motDePasse: mdp });
    const compteDe = email => db.col('comptes').findOne({ emailCle: email.toLowerCase() });
    const vieillir = (id, heures) => db.col('comptes').updateOne({ _id: id }, { $set: { creeLe: new Date(Date.now() - heures * HEURE) } });
    const liberer = () => db.col('limites').updateMany({ cle: /^confirmation:/ }, { $set: { expireLe: new Date(Date.now() - 1000) } });   // simule « le dernier courriel date de plus de 24 h »
    const jetonDe = e => new URL(e.lien).searchParams.get('jeton');
    const purger = (maintenant = new Date()) => (Pg.purgerNonConfirmes ? Pg.purgerNonConfirmes({ cfg, maintenant }) : Promise.resolve({ purges: -1, gardes: -1, examines: -1 }));
    const sansDate = r => JSON.stringify([r.statut, Object.entries(r.entetes).filter(([k]) => k !== 'date').sort(), r.texte]);

    // ============================ ruling 1 : inactif jusqu'au clic ============================
    await ins('victime@exemple.fr');
    const nv = await compteDe('victime@exemple.fr');
    H.v('1a. inscription : compte inactif, 0 crédit', [nv.verifie, nv.solde, nv.offertesAccordeesLe], [false, { accueil: 0, achete: 0 }, null]);
    const espion = []; const f0 = P.verifierFactice, v0 = P.verifier;
    P.verifierFactice = async m => { espion.push('factice'); return f0(m); }; P.verifier = async (m, r) => { espion.push('verifier'); return v0(m, r); };
    const bon = await conn('victime@exemple.fr', MDP), faux = await conn('victime@exemple.fr', MDP + 'x'), inconnu = await conn('personne@exemple.fr', MDP);
    P.verifierFactice = f0; P.verifier = v0;
    H.v('1b. connexion d\'un compte non confirmé AVEC LE BON mot de passe : 401 IDENTIFIANTS', [bon.statut, bon.json && bon.json.erreur && bon.json.erreur.code], [401, 'IDENTIFIANTS']);
    H.v('1c. réponse identique à l\'octet à celle d\'un mauvais mot de passe et d\'une adresse inconnue (statut, en-têtes sans date, corps)', [sansDate(bon) === sansDate(faux), sansDate(bon) === sansDate(inconnu)], [true, true]);
    H.vrai('1d. aucun Set-Cookie sur le refus d\'un compte non confirmé', !bon.entetes['set-cookie']);
    H.v('1e. même calcul scrypt : non confirmé = verifier (pas de factice), faux = verifier, inconnu = factice', espion, ['verifier', 'verifier', 'factice']);
    H.v('1f. aucune session créée', await db.col('sessions').countDocuments({}), 0);

    // tous les chemins qui donnent un porteur à un compte
    //  (1) connecter -> creerSession (1b)  (2) liaison.lier par code  (3) resoudrePorteur sur une session existante  (4) resoudrePorteur sur une installation liée
    //  (5) reinitialiser (le lien de réinitialisation prouve la boîte ET le mot de passe est choisi par son titulaire : seul chemin légitime d'activation avec le clic)
    const jetonCode = 'ABC123';
    await db.col('codes_liaison').insertOne({ codeEmpreinte: J.empreinte(jetonCode), compteId: nv._id, creeLe: new Date(), expireLe: new Date(Date.now() + 600e3), utiliseLe: null });
    const inst = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte('jeton-inst-o3'), essais: 3, libelle: 'x' }); await db.col('installations').insertOne(inst);
    const lie = await liaison.lier({ installation: inst, code: jetonCode, argent: { fusionnerALaLiaison: async () => { } } });
    H.v('2a. liaison par un code qui désigne un compte non confirmé : refusée (CODE_INVALIDE), installation non liée', [lie.statut, lie.code, (await db.col('installations').findOne({ _id: inst._id })).compteId], [404, 'CODE_INVALIDE', null]);
    const { resoudrePorteur } = require('../porteur');
    const resoudre = async entetes => { const q = { headers: entetes, ip: '1.1.1.1', get(k) { return this.headers[k.toLowerCase()]; } }; await resoudrePorteur(cfg)(q, { status() { return this; }, json() { return this; }, setHeader() { } }, () => { }); return q.v2; };
    const tokS = J.genererJeton();
    await db.col('sessions').insertOne({ tokenEmpreinte: J.empreinte(tokS), compteId: nv._id, creeLe: new Date(), vueLe: new Date(), expireLe: new Date(Date.now() + 864e5) });
    const rs = await resoudre({ cookie: `rm_session=${tokS}` });
    H.v('3a. une session (héritée) qui désigne un compte non confirmé ne donne aucun porteur', [rs.porteur, rs.echec], [null, 'session-absente']);
    const tokI = J.genererJeton();
    await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(tokI), essais: 3, libelle: 'y' }), compteId: nv._id });
    const ri = await resoudre({ authorization: `Bearer ${tokI}` });
    H.v('4a. une installation liée à un compte non confirmé n\'est pas un porteur COMPTE', [ri.porteur && ri.porteur.type, ri.porteur && ri.porteur.compte], ['installation', null]);
    await db.col('sessions').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('codes_liaison').deleteMany({});

    // ============================ ruling 2 : un courriel de confirmation par adresse et par 24 h ============================
    H.v('5a. inscription : 1 courrier de confirmation', courrier.envoyes.filter(e => e.type === 'verification').length, 1);
    await renv('victime@exemple.fr'); await renv('victime@exemple.fr');
    H.v('5b. renvois dans les 24 h : aucun courrier de plus (inscription + renvoi = même compteur)', courrier.envoyes.filter(e => e.type === 'verification').length, 1);
    await ins('victime@exemple.fr', 'autre-mot-de-passe-1');
    H.v('5c. nouvelle inscription de la même adresse dans les 24 h : aucun courrier de plus', courrier.envoyes.filter(e => e.type === 'verification').length, 1);
    const cles = await db.col('limites').find({ cle: /^confirmation:/ }).toArray();
    H.v('5d. le compteur est un document PERSISTANT de `limites`, par empreinte (jamais l\'adresse en clair), expirant à +24 h', [cles.length, JSON.stringify(cles).includes('victime'), Boolean(cles[0]) && Math.abs(cles[0].expireLe.getTime() - (Date.now() + 24 * HEURE)) < 10000], [1, false, true]);
    // redémarrage : modules rechargés, le compteur est en base
    const gardes = {};
    for (const k of Object.keys(require.cache)) if (/v2[\\/](comptes[\\/]service|transport[\\/]limites)\.js$/.test(k)) { gardes[k] = require.cache[k]; delete require.cache[k]; }
    const svc2 = require('../comptes/service');
    for (const k of Object.keys(require.cache)) if (/v2[\\/](comptes[\\/]service|transport[\\/]limites)\.js$/.test(k) && gardes[k]) require.cache[k] = gardes[k];   // le serveur et A.attendre gardent LEURS modules
    await svc2.renvoyerVerification({ email: 'victime@exemple.fr', cfg, courrier }); await svc2.attendre();
    H.v('5e. après « redémarrage » (modules rechargés) : toujours refusé, le compteur survit', courrier.envoyes.filter(e => e.type === 'verification').length, 1);
    // frontière exacte : on part du dernier courriel (t0 = expireLe - 24 h)
    const t0 = new Date((cles[0] ? cles[0].expireLe.getTime() : Date.now() + 24 * HEURE) - 24 * HEURE);
    await svc2.renvoyerVerification({ email: 'victime@exemple.fr', cfg, courrier, maintenant: new Date(t0.getTime() + 24 * HEURE - 1000) }); await svc2.attendre();
    const avant24 = courrier.envoyes.filter(e => e.type === 'verification').length;
    await svc2.renvoyerVerification({ email: 'victime@exemple.fr', cfg, courrier, maintenant: new Date(t0.getTime() + 24 * HEURE) }); await svc2.attendre();
    H.v('5f. à 23 h 59 min 59 s : refusé ; à 24 h pile : un courrier part', [avant24, courrier.envoyes.filter(e => e.type === 'verification').length], [1, 2]);
    await liberer();
    const avantRafale = courrier.envoyes.filter(e => e.type === 'verification').length;
    await Promise.all(Array.from({ length: 8 }, () => svc2.renvoyerVerification({ email: 'victime@exemple.fr', cfg, courrier }))); await svc2.attendre();
    H.v('5g. 8 renvois SIMULTANÉS : exactement 1 courrier (réservation atomique)', courrier.envoyes.filter(e => e.type === 'verification').length - avantRafale, 1);
    // la limite O1 du mot de passe oublié est une AUTRE limite
    const avantReinit = courrier.envoyes.filter(e => e.type === 'reinit').length;
    for (let i = 0; i < 4; i++) { await post('/api/compte/mot-de-passe-oublie', { email: 'victime@exemple.fr' }); await A.attendre(); }
    H.v('5h. O1 inchangée : 3 courriels de réinitialisation par adresse et par heure (4 demandes)', courrier.envoyes.filter(e => e.type === 'reinit').length - avantReinit, 3);

    // ============================ ruling 6 : le texte du courriel ============================
    const dernier = courrier.envoyes.filter(e => e.type === 'verification').pop();
    H.vrai('6a. le courriel de confirmation dit que celui qui n\'est pas à l\'origine de l\'inscription peut l\'ignorer', typeof dernier.texte === 'string' && /pas à l.origine de cette inscription, ignorez ce message/.test(dernier.texte));
    H.vrai('6b. … et que le compte sera supprimé sous 48 heures', /supprimé sous 48 heures/.test(dernier.texte || ''));
    H.vrai('6c. … et porte le lien, sans mot de passe', (dernier.texte || '').includes(dernier.lien) && !(dernier.texte || '').includes(MDP));

    // ============================ ruling 3 : purge à 48 h ============================
    H.vrai('7a. le module de purge existe', typeof Pg.purgerNonConfirmes === 'function');
    const avantInstant = async () => Object.fromEntries(await Promise.all(['comptes', 'liens_email', 'sessions', 'mouvements', 'installations', 'codes_liaison', 'hebdo', 'analyses', 'questions', 'plafonds', 'collection_fiches', 'adresses_octroyees', 'limites'].map(async c => [c, await db.col(c).countDocuments({})])));
    await vieillir(nv._id, 47.99);   // 47 h 59 min 24 s
    const ref = await avantInstant();
    const p47 = await purger();
    H.v('7b. non confirmé à 47 h 59 : jamais purgé', [(await compteDe('victime@exemple.fr')) !== null, p47.purges], [true, 0]);
    // confirmé à 47 h 59 puis bien plus tard : jamais purgé
    const jc = jetonDe(courrier.envoyes.filter(e => e.type === 'verification').pop());
    H.v('7c. le clic à 47 h 59 active le compte et accorde les 25', [(await post('/api/compte/verification', { jeton: jc })).statut, (await compteDe('victime@exemple.fr')).solde.accueil], [200, 25]);
    await vieillir(nv._id, 24 * 30);
    const pc = await purger();
    H.v('7d. compte CONFIRMÉ de 30 jours : jamais purgé', [(await compteDe('victime@exemple.fr')) !== null, pc.purges], [true, 0]);

    // un compte jamais confirmé : 0 crédit, 0 session, 0 mouvement, et RIEN d'autre ne disparaît avec lui
    courrier.envoyes.length = 0; await liberer();
    await ins('jamais@exemple.fr');
    const j = await compteDe('jamais@exemple.fr');
    await conn('jamais@exemple.fr', MDP); await post('/api/compte/mot-de-passe-oublie', { email: 'jamais@exemple.fr' }); await A.attendre();
    const cid = { compteId: j._id };
    H.v('8a. un compte non confirmé a 0 crédit, 0 session, 0 mouvement, 0 installation, 0 code, 0 hebdo, 0 fiche', [j.solde,
        await db.col('sessions').countDocuments(cid), await db.col('mouvements').countDocuments(cid), await db.col('installations').countDocuments(cid),
        await db.col('codes_liaison').countDocuments(cid), await db.col('hebdo').countDocuments(cid), await db.col('collection_fiches').countDocuments(cid),
        await db.col('analyses').countDocuments({ porteur: { $in: [`compte:${j._id}`, String(j._id)] } })], [{ accueil: 0, achete: 0 }, 0, 0, 0, 0, 0, 0, 0]);
    const liensDuCompte = await db.col('liens_email').countDocuments(cid);
    await vieillir(j._id, 47.99); const avantJ = await avantInstant();
    await purger();
    H.v('8b. à 47 h 59 : rien ne bouge', await avantInstant(), avantJ);
    await vieillir(j._id, 48.02);
    const aP = await avantInstant();
    const pj = await purger();
    const apP = await avantInstant();
    const diff = Object.fromEntries(Object.keys(aP).map(k => [k, apP[k] - aP[k]]).filter(([, d]) => d !== 0));
    H.v('8c. à 48 h 01 : purgé ; seuls `comptes` (−1) et ses liens de courriel changent, toutes collections confondues', [pj.purges, diff], [1, { comptes: -1, liens_email: -liensDuCompte }]);
    H.vrai('8d. le compte purgé avait au moins un lien (le test ne compte pas du vide)', liensDuCompte >= 2);

    // l'adresse redevient libre, les offertes sont accordées à la confirmation suivante
    H.v('9a. aucune empreinte d\'octroi pour l\'adresse du compte purgé (il n\'a jamais rien reçu)', await db.col('adresses_octroyees').countDocuments({ empreinte: svc.empreinteAdresse('jamais@exemple.fr', cfg) }), 0);
    courrier.envoyes.length = 0; await liberer();
    const re = await ins('jamais@exemple.fr', MDP_VICTIME);
    const j2 = await compteDe('jamais@exemple.fr');
    H.v('9b. nouvelle inscription après purge : 202, nouveau compte, courrier de confirmation', [re.statut, j2 && !j2._id.equals(j._id), courrier.envoyes.length], [202, true, 1]);
    const rc = await post('/api/compte/verification', { jeton: jetonDe(courrier.envoyes[0]) });
    H.v('9c. la confirmation suivante reçoit les 25 offertes', [rc.statut, (await compteDe('jamais@exemple.fr')).solde.accueil, (await conn('jamais@exemple.fr', MDP_VICTIME)).statut], [200, 25, 200]);

    // fenêtre entre 48 h et le prochain balayage : l'adresse est libre « à l'usage », sans attendre la passe
    courrier.envoyes.length = 0; await liberer();
    await ins('perimee@exemple.fr', MDP); const pm = await compteDe('perimee@exemple.fr'); const lienPm = jetonDe(courrier.envoyes[0]);
    await vieillir(pm._id, 49); await liberer();
    const clicPm = await post('/api/compte/verification', { jeton: lienPm }); const apresPm = await db.col('comptes').findOne({ _id: pm._id });
    H.v('10a. un lien de confirmation reçu avant 48 h, cliqué après : refusé (404), compte non activé', [clicPm.statut, !(apresPm && apresPm.verifie)], [404, true]);
    await ins('perimee3@exemple.fr', MDP); const pm3 = await compteDe('perimee3@exemple.fr'); await vieillir(pm3._id, 49); await liberer(); courrier.envoyes.length = 0;
    await ins('perimee3@exemple.fr', MDP_VICTIME);
    const pm2 = await compteDe('perimee3@exemple.fr');
    H.v('10b. inscription sur une adresse dont le compte a plus de 48 h (balayage pas encore passé) : le compte périmé est remplacé par le nouveau, qui reçoit son courriel', [pm2 && !pm2._id.equals(pm3._id), pm2 && pm2.verifie, courrier.envoyes.length, (await conn('perimee3@exemple.fr', MDP_VICTIME)).statut], [true, false, 1, 401]);
    await vieillir(pm2._id, 49); await liberer(); courrier.envoyes.length = 0;
    await renv('perimee3@exemple.fr');
    H.v('10c. renvoi pour un compte de plus de 48 h : aucun courrier (il est périmé)', courrier.envoyes.length, 0);
    {   // le lien de RÉINITIALISATION d'un compte périmé est refusé aussi (il ne réactive pas un compte de plus de 48 h), et le refus ne brûle pas un lien pour rien
        await ins('perimee2@exemple.fr'); const c = await compteDe('perimee2@exemple.fr'); const jr = J.genererJeton();
        await db.col('liens_email').insertOne({ empreinte: J.empreinte(jr), type: 'reinit', compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), utiliseLe: null });
        await vieillir(c._id, 49);
        const rr = await post('/api/compte/reinitialiser', { jeton: jr, motDePasse: 'nouveau-mot-de-passe-xyz' });
        const ap = await db.col('comptes').findOne({ _id: c._id });
        H.v('10d. lien de réinitialisation d\'un compte non confirmé de plus de 48 h : refusé (404), compte ni activé ni modifié', [rr.statut, !(ap && ap.verifie)], [404, true]);
    }
    await purger();   // le balayage ramasse ce qui reste de périmé : la suite repart d'une base sans compte de plus de 48 h

    // ---- course clic / purge ----
    let confirmesEtPresents = 0, purgesEtNonConfirmes = 0, incoherents = 0;
    for (let i = 0; i < 24; i++) {
        const email = `course${i}@exemple.fr`; await ins(email); const c = await compteDe(email);
        const lienC = jetonDe(courrier.envoyes[courrier.envoyes.length - 1]);
        await vieillir(c._id, 47.99); const t = new Date();
        const [rep] = await Promise.all([svc.verifierAdresse({ jeton: lienC, cfg, maintenant: t }), purger(new Date(t.getTime() + 5 * 60e3))]);
        const apres = await db.col('comptes').findOne({ _id: c._id });
        if (apres && apres.verifie && rep.statut === 200) confirmesEtPresents++;
        else if (!apres && rep.statut !== 200) purgesEtNonConfirmes++;
        else incoherents++;
    }
    H.v('11a. 24 courses clic / purge : jamais « confirmé ET supprimé » ni « 200 sur un compte absent » (incohérents = 0)', incoherents, 0);
    console.log(`   (course : ${confirmesEtPresents} confirmés et présents, ${purgesEtNonConfirmes} purgés et non confirmés)`);
    // fenêtre forcée : la purge frappe ENTRE la lecture du compte et l'écriture de l'octroi
    {
        await ins('fenetre@exemple.fr'); const c = await compteDe('fenetre@exemple.fr'); const lienF = jetonDe(courrier.envoyes[courrier.envoyes.length - 1]);
        const proto = Object.getPrototypeOf(db.col('comptes')); const orig = proto.updateOne; let frappe = 0;
        proto.updateOne = async function (filtre, ...r) { if (this.collectionName.endsWith('comptes') && filtre && filtre.offertesAccordeesLe === null && !frappe) { frappe++; await this.deleteOne({ _id: filtre._id }); } return orig.call(this, filtre, ...r); };
        let rep; try { rep = await svc.verifierAdresse({ jeton: lienF, cfg }); } finally { proto.updateOne = orig; }
        H.v('11b. compte supprimé entre la lecture et l\'octroi : la vérification répond « lien invalide », jamais 200', [frappe, rep.statut], [1, 404]);
        void c;
    }
    // ordres déterministes
    {
        await ins('ordre1@exemple.fr'); const c = await compteDe('ordre1@exemple.fr'); const l = jetonDe(courrier.envoyes[courrier.envoyes.length - 1]);
        await vieillir(c._id, 47.99); const t = new Date();
        const r = await svc.verifierAdresse({ jeton: l, cfg, maintenant: t }); const p = await purger(new Date(t.getTime() + 5 * 60e3));
        H.v('11c. clic PUIS purge : compte confirmé et présent', [r.statut, p.purges, (await db.col('comptes').findOne({ _id: c._id })).verifie], [200, 0, true]);
        await ins('ordre2@exemple.fr'); const d = await compteDe('ordre2@exemple.fr'); const l2 = jetonDe(courrier.envoyes[courrier.envoyes.length - 1]);
        await vieillir(d._id, 47.99); const t2 = new Date();
        const p2 = await purger(new Date(t2.getTime() + 5 * 60e3)); const r2 = await svc.verifierAdresse({ jeton: l2, cfg, maintenant: t2 });
        H.v('11d. purge PUIS clic : compte absent, clic refusé', [p2.purges, r2.statut, await db.col('comptes').findOne({ _id: d._id })], [1, 404, null]);
    }
    // la purge n'efface que ce qu'elle peut prouver vierge
    {
        // 11e : le DOCUMENT lu par le balayage peut être périmé (le clic est passé entre la lecture et la suppression) : la suppression porte l'état dans son filtre
        await ins('perime-lu@exemple.fr'); const c = await compteDe('perime-lu@exemple.fr'); await vieillir(c._id, 60);
        const lu = await db.col('comptes').findOne({ _id: c._id });   // vu non confirmé et périmé...
        await db.col('comptes').updateOne({ _id: c._id }, { $set: { verifie: true, verifieLe: new Date() } });   // ...puis confirmé avant la suppression
        H.v('11e. document lu non confirmé, compte confirmé entre-temps : la suppression refuse (compte présent et confirmé)', [Pg.purgerCompte ? await Pg.purgerCompte(lu, cfg, new Date()) : null, ((await db.col('comptes').findOne({ _id: c._id })) || {}).verifie], ['garde', true]);
        const vieux = new Date(Date.now() - 100 * HEURE);
        H.v('11f. perime() : faux pour un confirmé, un champ absent, une date illisible ; vrai pour un non confirmé de 100 h', Pg.perime ? [Pg.perime({ verifie: true, creeLe: vieux }, cfg), Pg.perime({ creeLe: vieux }, cfg), Pg.perime({ verifie: false, creeLe: 'hier' }, cfg), Pg.perime({ verifie: false, creeLe: vieux }, cfg)] : null, [false, false, false, true]);
    }
    {
        await ins('creditee@exemple.fr'); const c = await compteDe('creditee@exemple.fr');
        await db.col('comptes').updateOne({ _id: c._id }, { $set: { 'solde.achete': 5 } }); await vieillir(c._id, 100);
        const p = await purger();
        H.v('12a. un compte non confirmé qui porterait un crédit n\'est JAMAIS purgé (gardé, compté)', [(await db.col('comptes').findOne({ _id: c._id })) !== null, p.purges, p.gardes], [true, 0, 1]);
        await ins('liee@exemple.fr'); const d = await compteDe('liee@exemple.fr');
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte('x-liee'), essais: 0, libelle: 'z' }), compteId: d._id }); await vieillir(d._id, 100);
        const p2 = await purger();
        H.v('12b. … ni un compte qui porterait une installation liée', [(await db.col('comptes').findOne({ _id: d._id })) !== null, p2.purges, p2.gardes], [true, 0, 2]);
        await db.col('comptes').deleteMany({ _id: { $in: [c._id, d._id] } }); await db.col('installations').deleteMany({});
    }

    // ---- balayage au démarrage + périodique ----
    {
        const poses = []; const faux = { setTimeout: (f, ms) => { poses.push(['differe', ms]); return { unref() { }, f }; }, setInterval: (f, ms) => { poses.push(['intervalle', ms]); return { unref() { }, f }; }, clearTimeout() { }, clearInterval() { } };
        if (Pg.demarrerPurge) Pg.demarrerPurge({ cfg, minuteurs: faux });
        H.v('13a. une passe différée au démarrage PUIS une passe périodique (toutes les heures), minuteurs non retenus (unref)', poses, [['differe', 60000], ['intervalle', 3600000]]);
        if (Pg.arreterPurge) Pg.arreterPurge();
        let appele = 0; const r = Pg.purgerUneFois ? await Pg.purgerUneFois({ cfg, etatMongo: () => 0, purge: async () => { appele++; return {}; } }) : null;
        H.v('13b. Mongo non prêt : la passe ne fait rien', [r, appele], [false, 0]);
    }

    // ============================ ruling 4 : réponse identique à l'octet ============================
    {
        const cas = {};
        const MAIL = () => courrier.envoyes.filter(e => e.type === 'verification').length;
        // inscription : neuve / confirmée / non confirmée <24h / non confirmée >24h / purgée
        const repI = {}; const mailI = {};
        let m0 = MAIL(); repI.neuve = await ins('ib-neuve@exemple.fr'); mailI.neuve = MAIL() - m0;
        await ins('ib-conf@exemple.fr'); const cf = await compteDe('ib-conf@exemple.fr'); await db.col('comptes').updateOne({ _id: cf._id }, { $set: { verifie: true, verifieLe: new Date() } });
        m0 = MAIL(); repI.confirmee = await ins('ib-conf@exemple.fr'); mailI.confirmee = MAIL() - m0;
        await ins('ib-attente@exemple.fr');
        m0 = MAIL(); repI.attenteMoins24 = await ins('ib-attente@exemple.fr'); mailI.attenteMoins24 = MAIL() - m0;
        await liberer();
        m0 = MAIL(); repI.attentePlus24 = await ins('ib-attente@exemple.fr'); mailI.attentePlus24 = MAIL() - m0;
        await ins('ib-purgee@exemple.fr'); const pu = await compteDe('ib-purgee@exemple.fr'); await vieillir(pu._id, 60); await purger(); await liberer();
        H.v('14a. (setup) l\'adresse purgée est bien libre', await compteDe('ib-purgee@exemple.fr'), null);
        m0 = MAIL(); repI.purgee = await ins('ib-purgee@exemple.fr'); mailI.purgee = MAIL() - m0;
        H.v('14b. inscription : les 5 situations produisent bien des effets DIFFÉRENTS (courriers : neuve 1, confirmée 0, attente <24 h 0, attente >24 h 1, purgée 1)', mailI, { neuve: 1, confirmee: 0, attenteMoins24: 0, attentePlus24: 1, purgee: 1 });
        const refI = sansDate(repI.neuve);
        H.v('14c. inscription : statut, en-têtes (hors date) et corps IDENTIQUES à l\'octet dans les 5 situations', Object.fromEntries(Object.entries(repI).map(([k, r]) => [k, sansDate(r) === refI])), { neuve: true, confirmee: true, attenteMoins24: true, attentePlus24: true, purgee: true });
        H.v('14d. … et c\'est un 202 { success: true }', [repI.neuve.statut, repI.neuve.json], [202, { success: true }]);
        // renvoi : neuve (inconnue) / confirmée / non confirmée <24h / >24h / purgée (inconnue)
        const repR = {}, mailR = {};
        await liberer();
        m0 = MAIL(); repR.neuve = await renv('rb-neuve@exemple.fr'); mailR.neuve = MAIL() - m0;
        m0 = MAIL(); repR.confirmee = await renv('ib-conf@exemple.fr'); mailR.confirmee = MAIL() - m0;
        await ins('rb-attente@exemple.fr');
        m0 = MAIL(); repR.attenteMoins24 = await renv('rb-attente@exemple.fr'); mailR.attenteMoins24 = MAIL() - m0;
        await liberer();
        m0 = MAIL(); repR.attentePlus24 = await renv('rb-attente@exemple.fr'); mailR.attentePlus24 = MAIL() - m0;
        await ins('rb-purgee@exemple.fr'); const pr = await compteDe('rb-purgee@exemple.fr'); await vieillir(pr._id, 60); await purger();
        m0 = MAIL(); repR.purgee = await renv('rb-purgee@exemple.fr'); mailR.purgee = MAIL() - m0;
        H.v('14e. renvoi : les 5 situations produisent bien des effets DIFFÉRENTS (courriers : inconnue 0, confirmée 0, attente <24 h 0, attente >24 h 1, purgée 0)', mailR, { neuve: 0, confirmee: 0, attenteMoins24: 0, attentePlus24: 1, purgee: 0 });
        const refR = sansDate(repR.neuve);
        H.v('14f. renvoi : statut, en-têtes (hors date) et corps IDENTIQUES à l\'octet dans les 5 situations', Object.fromEntries(Object.entries(repR).map(([k, r]) => [k, sansDate(r) === refR])), { neuve: true, confirmee: true, attenteMoins24: true, attentePlus24: true, purgee: true });
        void cas;
    }

    // ============================ ruling 5 : le premier inscrit garde la place ============================
    {
        await ins('place@exemple.fr', 'premier-mot-de-passe'); const avant = await compteDe('place@exemple.fr'); await liberer();
        const m0 = courrier.envoyes.length; await ins('place@exemple.fr', 'second-mot-de-passe');
        const apres = await compteDe('place@exemple.fr');
        H.v('15a. réinscription d\'une adresse en attente : ni le mot de passe, ni rien d\'autre ne change (document identique)', JSON.stringify(apres), JSON.stringify(avant));
        H.v('15b. … un courriel part si la limite le permet (ici oui : dernier courriel > 24 h), vers le premier inscrit', [courrier.envoyes.length - m0, courrier.envoyes[courrier.envoyes.length - 1].email], [1, 'place@exemple.fr']);
        H.v('15c. le mot de passe du second inscrit ne fonctionne pas, même après confirmation', await (async () => { await post('/api/compte/verification', { jeton: jetonDe(courrier.envoyes[courrier.envoyes.length - 1]) }); return [(await conn('place@exemple.fr', 'second-mot-de-passe')).statut, (await conn('place@exemple.fr', 'premier-mot-de-passe')).statut]; })(), [401, 200]);
    }

    // ============================ ruling 7 : le risque résiduel, CARACTÉRISÉ (non corrigé) ============================
    {
        courrier.envoyes.length = 0; await liberer();
        await ins('cible@exemple.fr', 'mot-de-passe-de-l-attaquant');                      // le tiers s'inscrit avec l'adresse de la victime
        const lien1 = jetonDe(courrier.envoyes[0]);
        H.v('16a. RÉSIDUEL : la victime clique le lien du courriel de l\'inscription du tiers -> compte actif, mot de passe du TIERS', [(await post('/api/compte/verification', { jeton: lien1 })).statut, (await conn('cible@exemple.fr', 'mot-de-passe-de-l-attaquant')).statut], [200, 200]);
        const sessionsTiers = await db.col('sessions').countDocuments({ compteId: (await compteDe('cible@exemple.fr'))._id });
        const rr = await post('/api/compte/mot-de-passe-oublie', { email: 'cible@exemple.fr' }); await A.attendre();
        const rein = courrier.envoyes.filter(e => e.type === 'reinit').pop();
        await post('/api/compte/reinitialiser', { jeton: jetonDe(rein), motDePasse: MDP_VICTIME });
        H.v('16b. la réinitialisation par la victime révoque tout : sessions du tiers supprimées, son mot de passe ne marche plus', [rr.statut, sessionsTiers > 0, await db.col('sessions').countDocuments({ compteId: (await compteDe('cible@exemple.fr'))._id }), (await conn('cible@exemple.fr', 'mot-de-passe-de-l-attaquant')).statut, (await conn('cible@exemple.fr', MDP_VICTIME)).statut], [202, true, 0, 401, 200]);
        // chemin 2 : le renvoi demandé par la victime elle-même
        courrier.envoyes.length = 0; await liberer();
        await ins('cible2@exemple.fr', 'mot-de-passe-de-l-attaquant'); await liberer(); courrier.envoyes.length = 0;
        await renv('cible2@exemple.fr');
        H.v('16c. RÉSIDUEL : la victime demande elle-même un renvoi puis clique -> compte actif, mot de passe du TIERS', [courrier.envoyes.length, (await post('/api/compte/verification', { jeton: jetonDe(courrier.envoyes[0]) })).statut, (await conn('cible2@exemple.fr', 'mot-de-passe-de-l-attaquant')).statut], [1, 200, 200]);
    }

    // ============================ ruling 9 (vérifiable ici) : rien ne touche le code hérité ============================
    H.vrai('17a. le module de purge n\'est chargé que par les montages v2 (le serveur hérité ne le référence pas)', (() => {
        const fs = require('fs'), path = require('path'); const racine = path.join(__dirname, '..', '..');
        const lire = f => fs.readFileSync(path.join(racine, f), 'utf8');
        return !/comptes[\\/]purge/.test(lire('index.js')) && /process\.env\.RM_API_V2 === '1' \? require\('\.\/v2'\)/.test(lire('index.js'));
    })());

    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
