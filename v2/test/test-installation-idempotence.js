'use strict';
// LOT IDEMPOTENCE-INSTALLATION, B2 — POST /api/installation (champ `heritage`, Idempotency-Key, héritage qui lève) et POST /api/compte/lier (Idempotency-Key).
// Base EN MÉMOIRE, aucun réseau. L'héritage est le VRAI module (argent/heritage.js) sur de vrais portefeuilles `credits` semés ; seules ses pannes sont fabriquées.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const J = require('../comptes/jetons'); const S = require('../comptes/sessions'); const He = require('../argent/heritage'); const Of = require('../argent/offre');
const { fusionFidele } = require('./_fusion-fidele');

const sorties = [];
for (const m of ['log', 'error', 'warn', 'info']) { const o = console[m].bind(console); console[m] = (...a) => { sorties.push(a.map(String).join(' ')); o(...a); }; }
const attendre = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await H.ouvrirBac('test-installation-idempotence.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '500' });
    const fusions = []; let delaiFusion = 0, modeHeritage = 'reel'; const appelsHeritage = [];
    const casse = { solde: false, offre: false, avant: null };      // lectures fragiles de la route lier, mises en panne à la demande (r1 I2) ; `avant` : écriture jouée AVANT la panne (r2 M-C)
    A.registre.fournir('argent', {
        solde: async p => { if (casse.avant) await casse.avant(p); if (casse.solde) throw new Error('solde en panne'); return { total: p.installation ? p.installation.essais : 0, essai: p.installation ? p.installation.essais : 0 }; },
        offre: p => { if (casse.offre) throw new Error('offre en panne'); return Of.offre(p, cfg); },
        fusionnerALaLiaison: async o => { if (delaiFusion) await attendre(delaiFusion); return fusionFidele(fusions)(o); },
        reprendreHeritage: async o => {
            appelsHeritage.push(o.userId);
            if (modeHeritage === 'leve') throw new Error(`boum ${o.userId}`);
            const r = await He.reprendreHeritage(o, cfg);
            if (modeHeritage === 'leve-apres-commit') throw new Error('réponse perdue après la validation');
            return r;
        }
    });
    const srv = await A.demarrer(cfg);
    let nIp = 0; const ipNeuve = () => ++nIp;
    const wallet = (userId, o = {}) => db.col('credits').insertOne({ userId, soldeGratuit: 2, soldeScans: 0, email: null, ...o });
    const nInst = () => db.col('installations').countDocuments({});
    const cleI = (() => { let n = 0; return () => `banc-inst-${Date.now().toString(36)}-${++n}-`.padEnd(40, 'x'); })();      // 40 caractères : la clé de /api/installation tient lieu de secret (32 au moins)
    const poster = (corps, ipn, cle) => H.appel(srv.url, '/api/installation', { methode: 'POST', corps, entetes: { ...A.ip(ipn), ...(cle ? { 'idempotency-key': cle } : {}) } });
    const rejoue = r => r.entetes['idempotency-replayed'] === 'true';
    const code = r => r.json && r.json.erreur && r.json.erreur.code;

    // ═══ 1. le champ `heritage` : une valeur par issue réelle, aucune silencieuse ═══
    {
        const absent = await poster({ versionExtension: '2.0.0' }, ipNeuve());
        H.v('B2-1a. aucun userIdHerite envoyé : 201, heritage "absent"', [absent.statut, absent.json.heritage], [201, 'absent']);
        const nul = await poster({ versionExtension: '2.0.0', userIdHerite: null }, ipNeuve());
        H.v('     userIdHerite null : "absent" aussi', [nul.statut, nul.json.heritage], [201, 'absent']);
        await wallet('portefeuille-repris-0001', { soldeGratuit: 2 });
        const repris = await poster({ versionExtension: '2.0.0', userIdHerite: 'portefeuille-repris-0001' }, ipNeuve());
        H.v('B2-1b. portefeuille 1.0.x repris : 201, heritage "repris", portefeuille marqué migré', [repris.statut, repris.json.heritage, (await db.col('credits').findOne({ userId: 'portefeuille-repris-0001' })).migreVers === repris.json.installationId], [201, 'repris', true]);
        const inconnu = await poster({ versionExtension: '2.0.0', userIdHerite: 'portefeuille-inexistant' }, ipNeuve());
        H.v('B2-1c. userId sans portefeuille : 201, heritage "inconnu"', [inconnu.statut, inconnu.json.heritage], [201, 'inconnu']);
        await wallet('portefeuille-deja-migre', { soldeGratuit: 0, migreVers: 'autre-installation' });
        const dejaMigre = await poster({ versionExtension: '2.0.0', userIdHerite: 'portefeuille-deja-migre' }, ipNeuve());
        H.v('B2-1d. portefeuille déjà déplacé vers une autre installation : 201, heritage "deja-migre"', [dejaMigre.statut, dejaMigre.json.heritage], [201, 'deja-migre']);
        // userIdHerite envoyé mais inutilisable (non-texte, vide, > 80 caractères) : aucun portefeuille ne peut y répondre — "inconnu", jamais un silence
        const inutilisables = [];
        for (const v of [42, '', 'x'.repeat(81), { a: 1 }]) { appelsHeritage.length = 0; const r = await poster({ versionExtension: '2.0.0', userIdHerite: v }, ipNeuve()); inutilisables.push([r.statut, r.json.heritage, appelsHeritage.length]); }
        H.v('B2-1e. userIdHerite non-texte / vide / > 80 / objet : 201, heritage "inconnu", héritage non appelé', inutilisables, Array(4).fill([201, 'inconnu', 0]));
        // le plafond global des essais : l'installation naît (0 essai), l'héritage est refusé SANS toucher au portefeuille — valeur additive "plafond-global"
        const cfgPlafond = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '1' });
        await db.col('limites').deleteMany({});
        A.registre.fournir('argent', { ...A.registre.obtenir('argent'), reprendreHeritage: async o => He.reprendreHeritage(o, cfgPlafond) });
        const srvP = await A.demarrer(cfgPlafond); await wallet('portefeuille-plafond', { soldeGratuit: 2 });
        const p1 = await H.appel(srvP.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: A.ip(ipNeuve()) });
        const p2 = await H.appel(srvP.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0', userIdHerite: 'portefeuille-plafond' }, entetes: A.ip(ipNeuve()) });
        H.v('B2-1f. plafond global des essais atteint : 201, heritage "plafond-global" (portefeuille intact)', [p1.statut, p2.statut, p2.json.heritage, (await db.col('credits').findOne({ userId: 'portefeuille-plafond' })).migreVers === undefined], [201, 201, 'plafond-global', true]);
        await srvP.fermer();
        A.registre.fournir('argent', { ...A.registre.obtenir('argent'), reprendreHeritage: async o => { appelsHeritage.push(o.userId); if (modeHeritage === 'leve') throw new Error(`boum ${o.userId}`); const r = await He.reprendreHeritage(o, cfg); if (modeHeritage === 'leve-apres-commit') throw new Error('réponse perdue après la validation'); return r; } });
        await db.col('limites').deleteMany({});
    }

    // ═══ 2. Idempotency-Key sur /api/installation ═══
    {
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        await wallet('portefeuille-idem-0001', { soldeGratuit: 2 });
        const k = cleI(), corps = { versionExtension: '2.0.0', libelle: 'Chrome', userIdHerite: 'portefeuille-idem-0001' }; appelsHeritage.length = 0;
        const ipn = ipNeuve(), a = await poster(corps, ipn, k), b = await poster(corps, ipn, k);
        H.v('B2-2a. deux POST /api/installation de même clé : 201 et 201, MÊME installation, MÊME jeton, MÊME corps, le 2e marqué rejoué', [a.statut, b.statut, b.json.installationId === a.json.installationId, b.json.jetonInstallation === a.json.jetonInstallation, b.texte === a.texte, rejoue(a), rejoue(b)], [201, 201, true, true, true, false, true]);
        H.v('     UNE installation en base, l\'héritage a passé UNE fois (heritage "repris" rendu aux deux)', [await nInst(), appelsHeritage.length, a.json.heritage, b.json.heritage], [1, 1, 'repris', 'repris']);
        const stocke = await db.col('idempotence').find({}).toArray();
        H.vrai('     le jeton n\'est dans AUCUN document de la base en clair, idempotence comprise (la réponse conservée est scellée)', stocke.length === 1 && !JSON.stringify(stocke).includes(a.json.jetonInstallation) && !JSON.stringify(await db.col('installations').find({}).toArray()).includes(a.json.jetonInstallation));
        const dedie = await poster(corps, ipn, k);   // un troisième rejeu : toujours rien de plus
        H.v('     un 3e rejeu : toujours la même installation, toujours une seule en base', [dedie.json.installationId === a.json.installationId, await nInst()], [true, 1]);
        // la même clé avec un AUTRE corps : refus, rien créé (règle existante du dépôt)
        const autre = await poster({ ...corps, libelle: 'Firefox' }, ipn, k);
        H.v('B2-2b. même clé, corps différent : 422 ENTREE cle-reutilisee, rien créé', [autre.statut, code(autre), autre.json.erreur?.detail, await nInst()], [422, 'ENTREE', 'cle-reutilisee', 1]);
        // sans clé : le comportement d'aujourd'hui (deux installations)
        const s1 = await poster({ versionExtension: '2.0.0' }, ipNeuve()), s2 = await poster({ versionExtension: '2.0.0' }, ipNeuve());
        H.v('B2-2c. sans clé : deux installations distinctes, deux jetons (comportement d\'aujourd\'hui)', [s1.statut, s2.statut, s1.json.installationId !== s2.json.installationId, await nInst()], [201, 201, true, 3]);
        const mauvaise = await poster({ versionExtension: '2.0.0' }, ipNeuve(), 'court');
        H.v('B2-2d. clé de forme invalide : 400 ENTREE, rien créé', [mauvaise.statut, code(mauvaise), await nInst()], [400, 'ENTREE', 3]);
        // un rejeu ne consomme pas le plafond de 2 installations par IP et par jour : 1 installation + 3 rejeux, puis une 2e installation permise, la 3e refusée
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        const ip2 = ipNeuve(), kk = cleI();
        const r1 = await poster({ versionExtension: '2.0.0' }, ip2, kk); await poster({ versionExtension: '2.0.0' }, ip2, kk); await poster({ versionExtension: '2.0.0' }, ip2, kk);
        const r2 = await poster({ versionExtension: '2.0.0' }, ip2, cleI()), r3 = await poster({ versionExtension: '2.0.0' }, ip2, cleI());
        H.v('B2-2e. les rejeux ne comptent pas dans le plafond 2/IP/jour : 1 installation + 2 rejeux, puis une 2e permise (201) et la 3e refusée (429)', [r1.statut, r2.statut, r3.statut, code(r3), await nInst()], [201, 201, 429, 'DEBIT', 2]);
        H.v('     la 429 n\'est pas conservée : sa clé, rejouée, rend de nouveau le refus du limiteur et ne crée rien', [(await poster({ versionExtension: '2.0.0' }, ip2, cleI())).statut, await nInst()], [429, 2]);
        // claim en cours : un rejeu PENDANT la première requête ne crée rien (429 DEBIT reessayerDans 2)
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        const kp = cleI(), ipp = ipNeuve(); await db.col('idempotence').insertOne({ cle: `anonyme|installation|${kp}`, empreinteCorps: require('../transport/idempotence').empreinteDuCorps({ versionExtension: '2.0.0' }), etat: 'en-cours', proprietaire: 'x', creeLe: new Date(), expireLe: new Date(Date.now() + 60000) });
        const pendant = await poster({ versionExtension: '2.0.0' }, ipp, kp);
        H.v('B2-2f. claim en cours (première requête pas finie) : 429 DEBIT reessayerDans 2, rien créé', [pendant.statut, code(pendant), pendant.json.erreur?.reessayerDans, await nInst()], [429, 'DEBIT', 2, 0]);
        await db.col('idempotence').deleteMany({});
    }

    // ═══ 3. l'héritage lève : pas d'installation orpheline ═══
    {
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        await wallet('portefeuille-panne-0001', { soldeGratuit: 2 });
        const ipn = ipNeuve(), k = cleI(), corps = { versionExtension: '2.0.0', userIdHerite: 'portefeuille-panne-0001' };
        modeHeritage = 'leve'; sorties.length = 0;
        const e = await poster(corps, ipn, k);
        H.v('B2-3a. l\'héritage LÈVE : 503 INDISPONIBLE et AUCUNE installation orpheline (l\'installation créée est défaite)', [e.statut, code(e), e.json.jetonInstallation, await nInst()], [503, 'INDISPONIBLE', undefined, 0]);
        H.vrai('     le userId n\'est dans aucune ligne de console (l\'erreur de l\'héritage le cite)', !sorties.some(l => l.includes('portefeuille-panne-0001')));
        H.v('     le portefeuille 1.0.x est intact (pas migré)', (await db.col('credits').findOne({ userId: 'portefeuille-panne-0001' })).migreVers === undefined, true);
        modeHeritage = 'reel';
        const re = await poster(corps, ipn, k);
        H.v('B2-3b. le nouvel essai (même clé, même corps, héritage rétabli) : 201, UNE installation en tout, heritage "repris"', [re.statut, re.json.heritage, rejoue(re), await nInst()], [201, 'repris', false, 1]);
        const plus = await poster({ versionExtension: '2.0.0' }, ipn, cleI());
        H.v('     plafond 2/IP/jour : l\'essai raté et sa reprise sont les deux permis, la 3e requête de l\'IP est refusée', [plus.statut, code(plus), await nInst()], [429, 'DEBIT', 1]);
        // sans clé, même scénario : toujours aucune orpheline, un nouvel essai crée une seule installation
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('credits').deleteMany({});
        await wallet('portefeuille-panne-0002', { soldeGratuit: 2 });
        const ip3 = ipNeuve(); modeHeritage = 'leve';
        const s1 = await poster({ versionExtension: '2.0.0', userIdHerite: 'portefeuille-panne-0002' }, ip3);
        modeHeritage = 'reel';
        const s2 = await poster({ versionExtension: '2.0.0', userIdHerite: 'portefeuille-panne-0002' }, ip3);
        H.v('B2-3c. sans Idempotency-Key : 503 puis 201 "repris", une seule installation en base', [s1.statut, s2.statut, s2.json.heritage, await nInst()], [503, 201, 'repris', 1]);
        // l'héritage a VALIDÉ puis la réponse s'est perdue (il lève après coup) : l'installation HÉRITIÈRE est gardée, jamais défaite (elle porte les crédits déplacés)
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        await wallet('portefeuille-panne-0003', { soldeGratuit: 2 });
        modeHeritage = 'leve-apres-commit'; const k3 = cleI();
        const apres = await poster({ versionExtension: '2.0.0', userIdHerite: 'portefeuille-panne-0003' }, ipNeuve(), k3);
        const ins = await db.col('installations').find({}).toArray();
        H.v('B2-3d. l\'héritage a validé puis lève : 201 "repris", l\'installation qui porte les crédits est GARDÉE (une seule), jamais défaite', [apres.statut, apres.json.heritage, ins.length, ins[0] && ins[0].heriteEmpreinte !== null, ins[0] && ins[0]._id === apres.json.installationId], [201, 'repris', 1, true, true]);
        modeHeritage = 'reel';
    }

    // ═══ 4. /api/compte/lier ═══
    {
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        let n = 100;
        const creerCompte = async email => { const c = M.nouveauCompte({ email, emailCle: email, motDePasse: {} }); c.verifie = true; await db.col('comptes').insertOne(c); return c; };
        const creerInst = async () => { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'Chrome' }); await db.col('installations').insertOne(i); return { i, jeton }; };
        const posterCode = async (compteId, texte) => { await db.col('codes_liaison').insertOne({ codeEmpreinte: J.empreinte(texte), compteId, generation: 0, creeLe: new Date(), expireLe: new Date(Date.now() + 600e3), utiliseLe: null }); return texte; };
        const lier = (jeton, codeLiaison, cle, ipn = ++n) => H.appel(srv.url, '/api/compte/lier', { methode: 'POST', corps: { code: codeLiaison }, entetes: { authorization: `Bearer ${jeton}`, ...A.ip(ipn), ...(cle ? { 'idempotency-key': cle } : {}) } });
        const delier = jeton => H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: { authorization: `Bearer ${jeton}`, ...A.ip(++n) } });
        const cA = await creerCompte('lier-a@exemple.fr'), cB = await creerCompte('lier-b@exemple.fr');

        // 4a. la réponse s'est perdue : le rejeu (avec l'ANCIEN jeton, seul que le client possède) rend le MÊME nouveau jeton
        sorties.length = 0; fusions.length = 0;
        const x = await creerInst(), c1 = await posterCode(cA._id, 'AAA111'), k = cleI();
        const a = await lier(x.jeton, c1, k);
        const b = await lier(x.jeton, c1, k);
        const apresDoc = await db.col('installations').findOne({ _id: x.i._id });
        H.v('B2-4a. deux lier de même clé (le 2e avec l\'ANCIEN jeton, la réponse du 1er s\'étant perdue) : 200 et 200, même nouveau jeton, même corps, le 2e rejoué',
            [a.statut, b.statut, a.json.jetonInstallation === b.json.jetonInstallation, b.texte === a.texte, rejoue(a), rejoue(b), a.json.jetonInstallation !== x.jeton], [200, 200, true, true, false, true, true]);
        H.v('     UNE seule rotation : l\'installation porte l\'empreinte du jeton rendu, une fusion, un code consommé', [apresDoc.jetonEmpreinte === J.empreinte(a.json.jetonInstallation), fusions.length, (await db.col('codes_liaison').findOne({ codeEmpreinte: J.empreinte('AAA111') })).utiliseLe instanceof Date], [true, 1, true]);
        const ancienAilleurs = await delier(x.jeton);
        H.v('     l\'ancien jeton reste RÉVOQUÉ partout ailleurs (delier avec lui : 401 JETON) ; le nouveau marche', [ancienAilleurs.statut, code(ancienAilleurs), (await delier(a.json.jetonInstallation)).statut], [401, 'JETON', 200]);
        // 4b. le rejeu n'ouvre RIEN d'autre : autre clé, pas de clé, autre installation, jeton quelconque
        const x2 = await creerInst(), c2 = await posterCode(cA._id, 'AAA222'), k2 = cleI();
        const l2 = await lier(x2.jeton, c2, k2);
        const autreCle = await lier(x2.jeton, c2, cleI()), sansCle = await lier(x2.jeton, c2, null), faux = await lier(J.genererJeton(), c2, k2);
        H.v('B2-4b. l\'ancien jeton avec UNE AUTRE clé, SANS clé, ou un jeton quelconque avec la bonne clé : 401 JETON (rien n\'est rejoué, rien n\'est exécuté)', [autreCle.statut, code(autreCle), sansCle.statut, code(sansCle), faux.statut, code(faux)], [401, 'JETON', 401, 'JETON', 401, 'JETON']);
        const x3 = await creerInst(), vole = await lier(x3.jeton, c2, k2);
        H.vrai('     la clé d\'une AUTRE installation ne rend pas le jeton d\'autrui (c2 est déjà consommé : 404 CODE_INVALIDE, pas rejoué)', vole.statut === 404 && !vole.texte.includes(l2.json.jetonInstallation) && !rejoue(vole));
        // 4c. même clé, autre code : refus
        const x4 = await creerInst(), c4 = await posterCode(cA._id, 'AAA444'), k4 = cleI();
        await lier(x4.jeton, c4, k4);
        const autreCode = await lier(x4.jeton, await posterCode(cA._id, 'AAA445'), k4);
        H.v('B2-4c. même clé, autre code : 422 ENTREE cle-reutilisee (même avec l\'ancien jeton), le 2e code reste utilisable', [autreCode.statut, code(autreCode), autreCode.json.erreur?.detail, (await db.col('codes_liaison').findOne({ codeEmpreinte: J.empreinte('AAA445') })).utiliseLe], [422, 'ENTREE', 'cle-reutilisee', null]);
        // 4d. un échec n'est pas conservé : le code faux avec une clé, puis le bon code avec la MÊME clé et le MÊME jeton (toujours valide)
        const x5 = await creerInst(), k5 = cleI();
        const faussse = await lier(x5.jeton, 'ZZZ999', k5);
        const c5 = await posterCode(cA._id, 'AAA555');
        const bonne = await lier(x5.jeton, 'ZZZ999', k5);
        H.v('B2-4d. un code faux (404) n\'est pas figé : la même clé rejouée rend de nouveau 404 sans rien consommer', [faussse.statut, bonne.statut, rejoue(bonne)], [404, 404, false]);
        const ok5 = await lier(x5.jeton, c5, cleI());
        H.v('     et avec une autre clé le bon code lie (200)', ok5.statut, 200);
        // 4e. la fusion échoue : la liaison est défaite, l'ancien jeton reste valide ET aucun rejeu à jeton révoqué n'est ouvert
        const x6 = await creerInst(), c6 = await posterCode(cB._id, 'BBB666'), k6 = cleI(); fusions.length = 0;
        A.registre.fournir('argent', { ...A.registre.obtenir('argent'), fusionnerALaLiaison: async () => ({ ok: false, raison: 'compte-inconnu' }) });
        const echec = await lier(x6.jeton, c6, k6);
        const d6 = await db.col('installations').findOne({ _id: x6.i._id });
        H.v('B2-4e. la fusion échoue : 503, liaison défaite, l\'ancien jeton reste l\'empreinte courante, aucune fenêtre de rejeu laissée', [echec.statut, code(echec), d6.compteId, d6.jetonEmpreinte === J.empreinte(x6.jeton), d6.rejeuLiaison ?? null], [503, 'INDISPONIBLE', null, true, null]);
        A.registre.fournir('argent', { ...A.registre.obtenir('argent'), fusionnerALaLiaison: async o => { if (delaiFusion) await attendre(delaiFusion); return fusionFidele(fusions)(o); } });      // rétablit la fusion, garde solde/offre (et leurs pannes à la demande)
        const reessai = await lier(x6.jeton, c6, k6);
        H.v('     le nouvel essai (même clé, même code, ancien jeton), fusion rétablie : 200 — la 503 n\'avait rien conservé', [reessai.statut, rejoue(reessai)], [200, false]);
        // 4f. deux lier SIMULTANÉS de même clé (la fusion traîne) : une seule rotation, l'autre attend (429 DEBIT)
        const x7 = await creerInst(), c7 = await posterCode(cB._id, 'BBB777'), k7 = cleI(); delaiFusion = 600; fusions.length = 0;
        const [p1, p2] = await Promise.all([lier(x7.jeton, c7, k7), (async () => { await attendre(150); return lier(x7.jeton, c7, k7); })()]);
        delaiFusion = 0;
        H.v('B2-4f. deux lier simultanés de même clé : un 200, l\'autre 429 DEBIT reessayerDans 2, UNE fusion', [[p1.statut, p2.statut].sort(), code(p2), p2.json.erreur && p2.json.erreur.reessayerDans, fusions.length], [[200, 429], 'DEBIT', 2, 1]);
        const apres7 = await lier(x7.jeton, c7, k7);
        H.v('     le rejeu qui suit (ancien jeton) rend le jeton de la première', [apres7.statut, apres7.json.jetonInstallation === p1.json.jetonInstallation, rejoue(apres7)], [200, true, true]);
        // 4g. le nouveau jeton n'est dans aucun document en clair, ni dans la console
        const tous = []; for (const c of ['installations', 'idempotence', 'comptes', 'codes_liaison', 'mouvements', 'limites']) tous.push(...await db.col(c).find({}).toArray());
        const rendus = [a, l2, p1, reessai, ok5].map(r => r.json && r.json.jetonInstallation).filter(Boolean), base = JSON.stringify(tous);
        H.v(`B2-4g. les ${rendus.length} jetons rendus par lier : aucun en clair dans la base (${tous.length} documents lus, idempotence comprise) ni dans la console (${sorties.length} lignes)`,
            [rendus.length, rendus.some(t => base.includes(t)), sorties.some(l => rendus.some(t => l.includes(t)))], [5, false, false]);
    }
    // ═══ TOUR 1 (r1 I1) : la clé de /api/installation tient lieu de secret ═══
    {
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        const courte = await poster({ versionExtension: '2.0.0' }, ipNeuve(), 'AbCdEfGh'), trente1 = await poster({ versionExtension: '2.0.0' }, ipNeuve(), 'a'.repeat(31)), trente2 = await poster({ versionExtension: '2.0.0' }, ipNeuve(), 'a'.repeat(32));
        H.v('T1-I1a. clé de 8 et de 31 caractères : 400 ENTREE cle-trop-courte, rien créé ; 32 caractères : 201', [courte.statut, code(courte), courte.json.erreur?.detail, trente1.statut, trente1.json.erreur?.detail, trente2.statut, await nInst()], [400, 'ENTREE', 'cle-trop-courte', 400, 'cle-trop-courte', 201, 1]);
        H.v('     65 caractères et caractères hors jeu : 400', [(await poster({ versionExtension: '2.0.0' }, ipNeuve(), 'a'.repeat(65))).statut, (await poster({ versionExtension: '2.0.0' }, ipNeuve(), 'é'.repeat(40))).statut], [400, 400]);
        H.v('     la configuration : 30 requêtes par IP et par heure par défaut, V2_INSTALLATION_REQUETES_HEURE honorée', [cfg.limites.installationRequetesIpHeure, lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSTALLATION_REQUETES_HEURE: '7' }).limites.installationRequetesIpHeure], [30, 7]);
        // devinettes : toutes les requêtes d'une IP comptent, rejeux compris
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        const cfg5 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '500', V2_INSTALLATION_REQUETES_HEURE: '5' }), srv5 = await A.demarrer(cfg5);
        const ip5 = ipNeuve(), k5 = cleI(), vus = [];
        for (let i = 0; i < 8; i++) { const r = await H.appel(srv5.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...A.ip(ip5), 'idempotency-key': i === 0 ? k5 : cleI() + i } }); vus.push([r.statut, code(r)]); }
        const rejeuxHonnetes = []; await db.col('limites').deleteMany({}); await db.col('idempotence').deleteMany({});
        const ip6 = ipNeuve(), k6 = cleI(); for (let i = 0; i < 7; i++) { const r = await H.appel(srv5.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...A.ip(ip6), 'idempotency-key': k6 } }); rejeuxHonnetes.push(r.statut); }
        H.v('T1-I1b. 8 clés différentes depuis une IP (plafond 5 par heure) : la 6e requête et les suivantes sont refusées 429 DEBIT AVANT toute recherche de clé (3 refus) ; les 2 créations passent', [vus.slice(0, 2).map(v => v[0]), vus.slice(5).map(v => v.join(' '))], [[201, 201], Array(3).fill('429 DEBIT')]);
        H.v('     un créateur + rejeux de la MÊME clé : les rejeux comptent (1 création + 4 rejeux rendus, puis 429)', rejeuxHonnetes, [201, 201, 201, 201, 201, 429, 429]);
        await srv5.fermer();
        H.vrai('     l\'en-tête Idempotency-Key n\'apparaît dans aucune ligne de console', !sorties.some(l => l.includes(k5) || l.includes(k6)));
    }

    // ═══ TOUR 1 (r1 I2) : lier — le nouveau jeton n'est JAMAIS perdu une fois la rotation écrite ═══
    {
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        let n = 300;
        const lierT = (jeton, codeLiaison, cle) => H.appel(srv.url, '/api/compte/lier', { methode: 'POST', corps: { code: codeLiaison }, entetes: { authorization: `Bearer ${jeton}`, ...A.ip(++n), ...(cle ? { 'idempotency-key': cle } : {}) } });
        const c = M.nouveauCompte({ email: 'lier-t1@exemple.fr', emailCle: 'lier-t1@exemple.fr', motDePasse: {} }); c.verifie = true; await db.col('comptes').insertOne(c);
        for (const quoi of ['solde', 'offre']) {
            const jeton = J.genererJeton(), i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'Chrome' }); await db.col('installations').insertOne(i);
            const texte = quoi === 'solde' ? 'TTT111' : 'TTT222', k = cleI();
            await db.col('codes_liaison').insertOne({ codeEmpreinte: J.empreinte(texte), compteId: c._id, generation: 0, creeLe: new Date(), expireLe: new Date(Date.now() + 600e3), utiliseLe: null });
            casse[quoi] = true; sorties.length = 0;
            const e = await lierT(jeton, texte, k);
            casse[quoi] = false;
            const doc = await db.col('installations').findOne({ _id: i._id });
            H.v(`T1-I2 (${quoi} en panne après la rotation) : 503, la liaison au compte reste faite, l'ANCIEN jeton est remis en vigueur (empreinte d'origine), aucune fenêtre de rejeu`, [e.statut, code(e), String(doc.compteId) === String(c._id), doc.jetonEmpreinte === J.empreinte(jeton), doc.rejeuLiaison ?? null], [503, 'INDISPONIBLE', true, true, null]);
            const apres = await lierT(jeton, texte, k), seul = await H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: { authorization: `Bearer ${jeton}`, ...A.ip(++n) } });
            H.v(`     l'ancien jeton MARCHE encore (delier : 200) et le nouvel essai rend 409 DEJA_LIE, pas 401 JETON (le jeton n'est pas perdu)`, [apres.statut, code(apres), seul.statut], [409, 'DEJA_LIE', 200]);
        }
    }

    // ═══ TOUR 2 ═══
    {
        // M-E : un detail exact par cause
        await db.col('limites').deleteMany({});
        const d = async cle => (await poster({ versionExtension: '2.0.0' }, ipNeuve(), cle)).json.erreur?.detail;
        H.v('T2-E. clé de 65 caractères / avec un caractère hors jeu (é, espace) / de 31 caractères : detail cle-trop-longue / cle-caractere-interdit / cle-trop-courte', [await d('a'.repeat(65)), await d('é'.repeat(40)), await d('a'.repeat(20) + ' ' + 'a'.repeat(20)), await d('a'.repeat(31))], ['cle-trop-longue', 'cle-caractere-interdit', 'cle-caractere-interdit', 'cle-trop-courte']);

        // M-A : l'IPv6 est groupée par /56 sur les deux limiteurs par IP de /api/installation ; une IPv4 ne change pas
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        const cfg3 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '500', V2_INSTALLATION_REQUETES_HEURE: '3' }), srv3 = await A.demarrer(cfg3);
        const depuis = (url, adr, cle) => H.appel(url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { 'x-forwarded-for': adr, ...(cle ? { 'idempotency-key': cle } : {}) } });
        const kv6 = cleI(), v6 = [];
        for (const adr of ['2001:db8:1:200::1', '2001:db8:1:2aa::5', '2001:db8:1:2ff::9', '2001:db8:1:2fe::7', '2001:db8:1:300::1']) v6.push((await depuis(srv3.url, adr, kv6)).statut);
        H.v('T2-A1. requêtes/heure (plafond 3, une clé créée puis rejouée) : trois adresses IPv6 du MÊME /56 partagent le compteur, la 4e (même /56) est refusée 429 ; une adresse d\'un AUTRE /56 passe', v6, [201, 201, 201, 429, 201]);
        const v4 = []; for (const adr of ['198.51.100.7', '198.51.100.7', '198.51.100.7', '198.51.100.7', '198.51.100.8']) v4.push((await depuis(srv3.url, adr)).statut);
        H.v('T2-A2. IPv4 inchangée : par adresse exacte — 2 créations de .7 passent, la 3e et la 4e sont refusées 429, .8 passe', v4, [201, 201, 429, 429, 201]);
        await srv3.fermer();
        // créations par jour (2) : trois créations sans clé depuis trois adresses du même /56 → la 3e est refusée
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({});
        const cr = []; for (const adr of ['2001:db8:9:100::1', '2001:db8:9:1ab::2', '2001:db8:9:1ff::3']) cr.push((await depuis(srv.url, adr)).statut);
        H.v('T2-A3. plafond de 2 créations par jour : trois adresses IPv6 du même /56 → 201, 201, 429', cr, [201, 201, 429]);

        // M-C : la remise de l'ancien jeton est CONDITIONNELLE à l'empreinte du nouveau : une révocation jouée entre la rotation et la remise n'est pas annulée
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        const cc = M.nouveauCompte({ email: 'lier-t2@exemple.fr', emailCle: 'lier-t2@exemple.fr', motDePasse: {} }); cc.verifie = true; await db.col('comptes').insertOne(cc);
        const jeton = J.genererJeton(), inst = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'Chrome' }); await db.col('installations').insertOne(inst);
        await db.col('codes_liaison').insertOne({ codeEmpreinte: J.empreinte('UUU111'), compteId: cc._id, generation: 0, creeLe: new Date(), expireLe: new Date(Date.now() + 600e3), utiliseLe: null });
        casse.solde = true; casse.avant = async () => { await db.col('installations').updateOne({ _id: inst._id }, { $set: { revoqueeLe: new Date(), jetonEmpreinte: J.empreinte(`revoque|${J.genererJeton()}`) } }); };
        const rv = await H.appel(srv.url, '/api/compte/lier', { methode: 'POST', corps: { code: 'UUU111' }, entetes: { authorization: `Bearer ${jeton}`, ...A.ip(ipNeuve() + 400), 'idempotency-key': cleI() } });
        casse.solde = false; casse.avant = null;
        const dv = await db.col('installations').findOne({ _id: inst._id });
        const ancien = await H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: { authorization: `Bearer ${jeton}`, ...A.ip(ipNeuve() + 400) } });
        H.v('T2-C. installation révoquée entre la rotation et la remise : 503, la remise NE réactive PAS l\'ancien jeton (empreinte toujours révoquée, ancien jeton 401)', [rv.statut, dv.revoqueeLe instanceof Date, dv.jetonEmpreinte === J.empreinte(jeton), ancien.statut], [503, true, false, 401]);
    }

    // ═══ 5. le scellé de la réponse conservée ═══
    {
        const Sc = require('../transport/scelle'); const sec = cfg.empreinte.secret;
        const leve = f => { try { f(); return false; } catch { return true; } };
        const sc = Sc.fermer('{"jetonInstallation":"x"}', sec, 'anonyme|installation|k');
        H.v('B2-5a. scellé : aller-retour exact ; autre claim, autre secret, texte brut, scellé tronqué ou altéré : tous REFUSÉS (jamais de repli sur le texte brut)',
            [Sc.ouvrir(sc, sec, 'anonyme|installation|k'), leve(() => Sc.ouvrir(sc, sec, 'anonyme|installation|autre')), leve(() => Sc.ouvrir(sc, 'un-autre-secret-assez-long', 'anonyme|installation|k')), leve(() => Sc.ouvrir('{"jetonInstallation":"x"}', sec, 'c')), leve(() => Sc.ouvrir(sc.slice(0, 20), sec, 'anonyme|installation|k')),
                leve(() => Sc.ouvrir(sc.slice(0, -3) + (sc.endsWith('AAA') ? 'BBB' : 'AAA'), sec, 'anonyme|installation|k')), sc.includes('jeton')], ['{"jetonInstallation":"x"}', true, true, true, true, true, false]);
        await db.col('limites').deleteMany({}); await db.col('installations').deleteMany({}); await db.col('idempotence').deleteMany({});
        const kz = cleI(), ipz = ipNeuve(); await poster({ versionExtension: '2.0.0' }, ipz, kz);
        await db.col('idempotence').updateMany({}, { $set: { reponse: 'sc1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
        const casse = await poster({ versionExtension: '2.0.0' }, ipz, kz);
        H.v('B2-5b. une réponse conservée ILLISIBLE ne se rejoue pas et ne ré-exécute pas : 503 INDISPONIBLE, toujours une seule installation', [casse.statut, code(casse), await nInst()], [503, 'INDISPONIBLE', 1]);
    }
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
