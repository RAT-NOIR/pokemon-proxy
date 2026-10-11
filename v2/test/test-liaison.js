'use strict';
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const S = require('../comptes/sessions');
(async () => {
    await H.ouvrirBac('test-liaison.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const fusions = []; let fusionCasse = false;
    A.registre.fournir('argent', {
        solde: async p => ({ total: p.installation ? p.installation.essais : 0, compte: Boolean(p.compte) }),
        // O3 tour 2 (I-B) : faux FIDÈLE à la signature réelle (`{ compteId, installationId }`) ; panne par exception OU par `{ ok:false }` comme le vrai module
        fusionnerALaLiaison: async o => { if (fusionCasse === true) throw new Error('boum'); if (fusionCasse === 'ok-faux') return { ok: false, raison: 'compte-inconnu' }; return require('./_fusion-fidele').fusionFidele(fusions)(o); }
    });
    const srv = await A.demarrer(cfg);
    let n = 0;
    const creerCompte = async (email, verifie = true) => { const c = M.nouveauCompte({ email, emailCle: email, motDePasse: {} }); c.verifie = verifie; await db.col('comptes').insertOne(c); const s = await S.creerSession(c._id); return { c, cookie: `rm_session=${s.token}` }; };
    const creerInst = async (essais = 0) => { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'Chrome' }); await db.col('installations').insertOne(i); return { i, jeton }; };
    const site = (cookie, ipn = ++n) => ({ ...A.SITE, ...A.ip(ipn), cookie });
    const bearer = (jeton, ipn = ++n) => ({ authorization: `Bearer ${jeton}`, ...A.ip(ipn) });
    const code = cookie => H.appel(srv.url, '/api/compte/code', { methode: 'POST', corps: {}, entetes: site(cookie) });
    const lier = (jeton, c, ipn) => H.appel(srv.url, '/api/compte/lier', { methode: 'POST', corps: { code: c }, entetes: bearer(jeton, ipn) });
    const posterCode = async (compteId, texte, decalageMs = 600e3) => { await db.col('codes_liaison').insertOne({ codeEmpreinte: J.empreinte(texte), compteId, generation: 0, creeLe: new Date(), expireLe: new Date(Date.now() + decalageMs), utiliseLe: null }); return texte; };   // O3 tour 2 : un code porte la génération du compte (0 à la création)

    const { c: cA, cookie: ckA } = await creerCompte('vous@exemple.fr', true);   // 9 : O3 — un compte non confirmé n'est plus un porteur (il ne peut ni créer un code ni être lié : test-comptes-o3.js 2a) ; ce banc juge la liaison d'un compte CONFIRMÉ
    // 1
    const r1 = await code(ckA);
    H.v('code : 200, 6 caractères [A-Z0-9], expire fourni', [r1.statut, /^[A-Z0-9]{6}$/.test(r1.json.code), typeof r1.json.expire], [200, true, 'string']);
    const doc = await db.col('codes_liaison').findOne({});
    H.v('base : empreinte seule, +10 min', [doc.codeEmpreinte === J.empreinte(r1.json.code), JSON.stringify(doc).includes(r1.json.code), Math.abs(doc.expireLe.getTime() - (Date.now() + 600e3)) < 5000], [true, false, true]);
    const r1b = await code(ckA), r1c = await code(ckA), r1d = await code(ckA);
    H.v('3 vivants au plus : les 3 premiers passent, le 4e est 429 DEBIT avec reessayerDans (4 demandes)', [r1b.statut, r1c.statut, r1d.statut, r1d.json.erreur.code, r1d.json.erreur.reessayerDans > 0, await db.col('codes_liaison').countDocuments({})], [200, 200, 429, 'DEBIT', true, 3]);
    const sc = await H.appel(srv.url, '/api/compte/code', { methode: 'POST', corps: {}, entetes: { ...A.SITE, ...A.ip(++n) } });
    H.v('code sans session : 401 SESSION', [sc.statut, sc.json.erreur.code], [401, 'SESSION']);
    const so = await H.appel(srv.url, '/api/compte/code', { methode: 'POST', corps: {}, entetes: { ...A.ip(++n), cookie: ckA } });
    H.v('code sans Origin : 403 ORIGINE', so.statut, 403);
    const { i: iInst, jeton: jInst } = await creerInst(0);
    const sb = await H.appel(srv.url, '/api/compte/code', { methode: 'POST', corps: {}, entetes: { ...site(''), authorization: `Bearer ${jInst}` } });
    H.v('code avec un Bearer d\'installation : 401 SESSION', [sb.statut, sb.json.erreur.code], [401, 'SESSION']);
    // 2 lier
    const { i: i1, jeton: j1 } = await creerInst(0);
    const rl = await lier(j1, r1.json.code);
    const apres = await db.col('installations').findOne({ _id: i1._id });
    H.v('lier : 200, compte masqué, nouveau jeton', [rl.statut, rl.json.success, rl.json.compte, rl.json.jetonInstallation.length, rl.json.jetonInstallation !== j1], [200, true, { emailMasque: 'v•••@exemple.fr', verifie: true }, 43, true]);
    H.v('installation liée, empreinte du NOUVEAU jeton', [String(apres.compteId), apres.lieeLe instanceof Date, apres.jetonEmpreinte === J.empreinte(rl.json.jetonInstallation)], [String(cA._id), true, true]);
    // O3 tour 2 (I-B) : l'ancienne assertion figeait la MAUVAISE forme `{ installation, compteId }` (la vraie fusion attend `installationId` et rendait `ok:false` sans que rien ne le voie)
    H.v('fusionnerALaLiaison appelé UNE fois avec la forme RÉELLE { compteId, installationId } (et rien d\'autre)', [fusions.length, fusions[0].installationId === i1._id, String(fusions[0].compteId), Object.keys(fusions[0]).sort()], [1, true, String(cA._id), ['compteId', 'installationId']]);
    const ancien = await H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: bearer(j1) });
    H.v('l\'ancien jeton : 401 JETON', [ancien.statut, ancien.json.erreur.code], [401, 'JETON']);
    // 3 usage unique / échu
    const { jeton: j2 } = await creerInst(0);
    const rej = await lier(j2, r1.json.code);
    H.v('code rejoué (autre installation) : 404 CODE_INVALIDE', [rej.statut, rej.json.erreur.code], [404, 'CODE_INVALIDE']);
    const ech = await posterCode(cA._id, 'ECHU01', -1000);
    const re = await lier(j2, ech);
    H.v('code échu : 410 CODE_EXPIRE', [re.statut, re.json.erreur.code], [410, 'CODE_EXPIRE']);
    H.v('format invalide / non-texte : 404', [(await lier(j2, 'abc')).statut, (await lier(j2, 42)).statut], [404, 404]);
    // 4 déjà liée : code non consommé
    const bon = await posterCode(cA._id, 'BON123');
    const dl = await lier(rl.json.jetonInstallation, bon);
    H.v('installation déjà liée : 409 DEJA_LIE', [dl.statut, dl.json.erreur.code], [409, 'DEJA_LIE']);
    H.v('le code n\'est PAS consommé', (await db.col('codes_liaison').findOne({ codeEmpreinte: J.empreinte(bon) })).utiliseLe, null);
    const { jeton: j3 } = await creerInst(0);
    H.v('…et sert encore sur une autre installation', (await lier(j3, bon)).statut, 200);
    // 5 force brute
    const { jeton: jf } = await creerInst(0); const bon2 = await posterCode(cA._id, 'CIBLE9');
    const essais = []; for (let k = 0; k < 5; k++) essais.push((await lier(jf, 'FAUX0' + k)).statut);
    const sixieme = await lier(jf, bon2);
    H.v('5 tentatives traitées (404), la 6e (BON code) est 429 (6 tentatives)', [essais.every(x => x === 404), sixieme.statut, sixieme.json.erreur.code], [true, 429, 'DEBIT']);
    H.v('le bon code n\'a pas été brûlé par le refus', (await db.col('codes_liaison').findOne({ codeEmpreinte: J.empreinte(bon2) })).utiliseLe, null);
    const insts = []; for (let k = 0; k < 21; k++) insts.push((await creerInst(0)).jeton);
    const ipFixe = 4242; const sts = []; for (const jt of insts) sts.push((await lier(jt, 'NOPE00', ipFixe)).statut);
    H.v('21 tentatives, 21 installations, une même IP : 20 traitées, la 21e est 429', [sts.slice(0, 20).every(x => x === 404), sts[20]], [true, 429]);
    // 6 : 30 simultanées
    const rapide = await posterCode(cA._id, 'RUEE30');
    const ins30 = []; for (let k = 0; k < 30; k++) ins30.push((await creerInst(0)).jeton);
    const res30 = await Promise.all(ins30.map((jt, k) => lier(jt, rapide, 7000 + k)));
    H.v('30 liaisons simultanées du même code : exactement 1 réussit (30 requêtes)', [res30.filter(x => x.statut === 200).length, res30.filter(x => x.statut === 404).length], [1, 29]);
    H.v('et une seule installation de plus est liée', await db.col('installations').countDocuments({ compteId: cA._id }), 3);
    // rollback si l'argent casse
    const { jeton: jr } = await creerInst(0); const cr = await posterCode(cA._id, 'ROLL01'); fusionCasse = true;
    const rr = await lier(jr, cr); fusionCasse = false;
    const ir = await db.col('installations').findOne({ jetonEmpreinte: J.empreinte(jr) });
    H.v('argent en panne : 503, installation non liée, ancien jeton intact, code rendu', [rr.statut, Boolean(ir) && ir.compteId, (await db.col('codes_liaison').findOne({ codeEmpreinte: J.empreinte(cr) })).utiliseLe], [503, null, null]);
    // la fusion qui rend `{ ok:false }` SANS lever (le vrai module : installation ou compte inconnu) défait la liaison comme une exception (O3 tour 2, I-B)
    const { jeton: jo } = await creerInst(0); const co = await posterCode(cA._id, 'OKFAUX'); fusionCasse = 'ok-faux';
    const ro = await lier(jo, co); fusionCasse = false;
    const io = await db.col('installations').findOne({ jetonEmpreinte: J.empreinte(jo) });
    H.v('fusion { ok:false } : 503, installation non liée, ancien jeton intact, code rendu', [ro.statut, Boolean(io) && io.compteId, (await db.col('codes_liaison').findOne({ codeEmpreinte: J.empreinte(co) })).utiliseLe], [503, null, null]);
    // 7 délier
    const dj = rl.json.jetonInstallation;
    const dd = await H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: bearer(dj) });
    const ap2 = await db.col('installations').findOne({ _id: i1._id });
    H.v('délier : 200 + solde, compteId null, essais inchangés à 0', [dd.statut, dd.json.success, ap2.compteId, ap2.essais], [200, true, null, 0]);
    H.v('le jeton reste valide après délier', (await H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: bearer(dj) })).statut, 200);
    // 8 révoquer
    const { c: cB, cookie: ckB } = await creerCompte('autre@exemple.fr');
    const rev = (cookie, id) => H.appel(srv.url, `/api/compte/installations/${id}`, { methode: 'DELETE', entetes: site(cookie) });
    const { i: iB, jeton: jB } = await creerInst(0); await db.col('installations').updateOne({ _id: iB._id }, { $set: { compteId: cB._id } });
    const croise = await rev(ckA, iB._id);
    H.v('l\'installation d\'un AUTRE compte : 404, rien de révoqué', [croise.statut, (await db.col('installations').findOne({ _id: iB._id })).revoqueeLe], [404, null]);
    H.v('identifiant inexistant / mal formé : 404', [(await rev(ckA, 'f'.repeat(32))).statut, (await rev(ckA, 'x')).statut], [404, 404]);
    const okRev = await rev(ckB, iB._id);
    const aB = await db.col('installations').findOne({ _id: iB._id });
    H.v('révoquer la sienne : 200, revoqueeLe posé, empreinte remplacée', [okRev.statut, aB.revoqueeLe instanceof Date, aB.jetonEmpreinte !== J.empreinte(jB)], [200, true, true]);
    const apresRev = await H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: bearer(jB) });
    H.v('jeton révoqué : 401 JETON', [apresRev.statut, apresRev.json.erreur.code], [401, 'JETON']);
    const sansOrigine = await H.appel(srv.url, `/api/compte/installations/${iB._id}`, { methode: 'DELETE', entetes: { cookie: ckB, ...A.ip(++n) } });
    H.v('DELETE sans Origin : 403', sansOrigine.statut, 403);
    // collision de code (index unique) : un réessai, puis 503
    const { c: cC, cookie: ckC } = await creerCompte('collision@exemple.fr');
    await db.col('codes_liaison').insertOne({ codeEmpreinte: J.empreinte('COLL01'), compteId: cA._id, creeLe: new Date(), expireLe: new Date(Date.now() + 600e3), utiliseLe: null });
    const vraiGen = J.genererCode; let suite = ['COLL01', 'NEWC02']; J.genererCode = () => suite.shift();
    const col1 = await code(ckC);
    H.v('une collision puis un tirage libre : 200 avec le second code (réessai unique)', [col1.statut, col1.json.code], [200, 'NEWC02']);
    J.genererCode = () => 'COLL01';
    const col2 = await code(ckC);
    J.genererCode = vraiGen;
    H.v('deux collisions de suite : 503 INDISPONIBLE (pas de boucle)', [col2.statut, col2.json.erreur.code], [503, 'INDISPONIBLE']);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
