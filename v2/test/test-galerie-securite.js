'use strict';
// GALERIE, TOUR 1 — LA SÉCURITÉ (relectures 1 et 2) : (S-I1) l'objet `attente/` est SUPPRIMÉ au refus, au retrait et après l'acceptation ; (S-I2) la mémoire de la recompression (12 Mpx, un seul décodage, cache et concurrence de sharp) ;
// (S-I3) Turnstile : pas de clés factices en production, `hostname` et `action` comparés, un jeton rejoué refusé ; (I-I3, I-I4) les suppressions R2 qui échouent entrent dans une file rejouée par un BALAYEUR, qui retire aussi
// les orphelins de plus de 24 h ; (S-I4) cache serveur de `tendances` et `/filtres`, plafond de décalage, recherche `q` ancrée et indexée.
// Écrit AVANT le code (le rouge a été vu), chaque garde neuve a son mutant sur le code RÉEL (le texte du module, un fragment retiré).
const A = require('./_aide-galerie');
const H = A.H;

(async () => {
    const B = await A.outillerBanc('test-galerie-securite.js');
    const { G, F, svc, sv, stockage, brut, appel, lire, compte, code, detail, deposer, artPublic, publier } = B;
    const I = require('../galerie/images'); const Bal = require('../galerie/balayeur'); const { lireGalerie } = require('../galerie/config');
    const sharp = require('sharp');
    const admin = await compte({ role: 'administrateur' }, 'chef-modo'), luma = await compte({}, 'luma'), noa = await compte({}, 'noa');
    const decision = (id, corps, c = admin) => appel(sv, 'POST', `/api/admin/moderation/${id}/decision`, { c, corps });
    const present = cle => stockage.objets.has(cle);
    const objetsAttente = id => [present(`galerie/attente/${id}.webp`), present(`galerie/attente/${id}-480.webp`)];
    const objetsPub = id => [present(`galerie/pub/${id}.webp`), present(`galerie/pub/${id}-480.webp`)];

    // ═══ 1. (S-I1) l'objet attente/ ne survit à AUCUNE décision ═══
    {
        const a1 = (await deposer(sv, luma, { nom: 'Accepté' })).id, a2 = (await deposer(sv, luma, { nom: 'Refusé' })).id, a3 = (await deposer(sv, luma, { nom: 'Retiré plus tard' })).id;
        H.v('1. avant toute décision : attente/ porte les deux objets, rien en pub/', [objetsAttente(a1), objetsPub(a1)], [[true, true], [false, false]]);
        await decision(`art.${a1}`, { decision: 'accepter' });
        H.v('   ACCEPTÉ : la copie publique existe ET l\'objet attente/ est supprimé (la copie pub/ suffit)', [objetsPub(a1), objetsAttente(a1)], [[true, true], [false, false]]);
        await decision(`art.${a2}`, { decision: 'refuser', motif: 'droits', precision: 'Copie d\'une illustration.' });
        H.v('   REFUSÉ : l\'objet attente/ est supprimé, rien n\'a été copié en public', [objetsAttente(a2), objetsPub(a2)], [[false, false], [false, false]]);
        await decision(`art.${a3}`, { decision: 'accepter' });
        stockage.poser(`galerie/attente/${a3}.webp`, Buffer.from('reste d\'avant'));           // un reste d'une version d'avant : le retrait ne le laisse pas
        await decision(`art.${a3}`, { decision: 'retirer', motif: 'choquant' });
        H.v('   RETIRÉ après acceptation : les copies pub/ ET attente/ sont supprimées', [objetsPub(a3), objetsAttente(a3)], [[false, false], [false, false]]);
        H.v('   (HEAD sur attente/ ne trouve plus rien pour les trois)', await Promise.all([a1, a2, a3].map(i => stockage.tete(`galerie/attente/${i}.webp`))), [null, null, null]);

        // l'échec d'une suppression se COMPTE : il entre dans la file de reprise, la décision, elle, est prise
        const a4 = (await deposer(sv, luma, { nom: 'Panne' })).id;
        stockage.panneSuppression = true;
        const refus = await decision(`art.${a4}`, { decision: 'refuser', motif: 'autre' });
        stockage.panneSuppression = false;
        const file = await brut('purges_r2').find({}).toArray();
        H.v('   une suppression qui ÉCHOUE : la décision passe (200), les deux clés entrent dans purges_r2 avec leur raison', [refus.statut, file.map(f => f._id).sort(), file.every(f => f.raison === 'refus' && f.essais === 0)], [200, [`galerie/attente/${a4}-480.webp`, `galerie/attente/${a4}.webp`].sort(), true]);
        const p1 = await Bal.passe({ stockage, secret: B.cfg.empreinte.secret });
        H.v('   le balayeur rejoue la file : les objets disparaissent et la file se vide', [p1.purgesRejouees, objetsAttente(a4), await brut('purges_r2').countDocuments({})], [2, [false, false], 0]);

        // MUTANTS sur le code réel
        const montrer = async (rempl, nom, attendu) => {
            const m = A.charger('service.js', rempl);
            const id = (await deposer(sv, luma, { nom })).id;
            const r = await m.decider({ id: `art.${id}`, decision: attendu.decision, motif: attendu.motif || null, moderateur: { compteId: admin.id, droit: 'administrateur' }, stockage, secret: B.cfg.empreinte.secret });
            return { r, att: objetsAttente(id), pub: objetsPub(id), id };
        };
        const rM = await montrer([["if (decision === 'refuser' && type === 'banque') await purgerAttente(stockage, d, 'refus');", "if (false) await purgerAttente(stockage, d, 'refus');"]], 'Mutant refus', { decision: 'refuser', motif: 'autre' });
        H.v('   MUTANT « le refus ne supprime plus attente/ » : l\'objet reste lisible', rM.att, [true, true]);
        const rA = await montrer([["await purgerAttente(stockage, d, 'acceptation');", "0 && await purgerAttente(stockage, d, 'acceptation');"]], 'Mutant accepte', { decision: 'accepter' });
        H.v('   MUTANT « l\'acceptation ne supprime plus attente/ » : l\'objet reste, en plus de la copie publique', [rA.att, rA.pub], [[true, true], [true, true]]);
        const rR = await montrer([["await purgerCopies(stockage, d, 'retrait');", "0 && await purgerCopies(stockage, d, 'retrait');"]], 'Mutant retrait', { decision: 'accepter' });
        const mm = A.charger('service.js', [["await purgerCopies(stockage, d, 'retrait');", "0 && await purgerCopies(stockage, d, 'retrait');"]]);
        await mm.decider({ id: `art.${rR.id}`, decision: 'retirer', motif: 'droits', moderateur: { compteId: admin.id, droit: 'administrateur' }, stockage, secret: B.cfg.empreinte.secret });
        H.v('   MUTANT « le retrait ne supprime plus les copies » : pub/ reste servi après le retrait', objetsPub(rR.id), [true, true]);
    }

    // ═══ 2. (S-I2) la mémoire de la recompression ═══
    {
        H.v('2. borne de pixels par défaut : 12 Mpx (au lieu de 24), servie par /api/illustrations/bornes', [lireGalerie(A.ENV_VALIDE).bornes.pixelsMax, (await lire(sv, '/api/illustrations/bornes')).json.pixelsMax], [12000000, 12000000]);
        H.v('   la valeur reste réglable, mais plafonnée à 24 Mpx (au-delà : le lot ne se monte pas)', [lireGalerie({ ...A.ENV_VALIDE, V2_ILLUSTRATION_PIXELS_MAX: '20000000' }).pret, lireGalerie({ ...A.ENV_VALIDE, V2_ILLUSTRATION_PIXELS_MAX: '40000000' }).pret], [true, false]);
        const buf = await B.png(600, 800), BORNES = { pixelsMax: 12e6, octetsMax: 8 * 1024 * 1024 };
        const avant = I.compteur.decodages;
        await I.traiter(buf, BORNES);
        H.v('   UN SEUL décodage de l\'image reçue (la vignette est dérivée de la sortie de 2 000 px)', I.compteur.decodages - avant, 1);
        const av2 = I.compteur.decodages;
        await I.traiter(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), BORNES).catch(() => { });
        await I.traiter(await B.png(1300, 1300), { ...BORNES, pixelsMax: 1e6 }).catch(() => { });
        H.v('   une image refusée (signature, pixels) n\'est JAMAIS décodée', I.compteur.decodages - av2, 0);
        const log = []; const oc = sharp.cache, oco = sharp.concurrency; const prevCache = sharp.cache(), prevConc = sharp.concurrency();
        sharp.cache = v => { log.push(['cache', v]); return oc.call(sharp, v); }; sharp.concurrency = v => { log.push(['conc', v]); return oco.call(sharp, v); };
        try { await I.traiter(buf, BORNES); } finally { sharp.cache = oc; sharp.concurrency = oco; }
        const l = log.filter(x => x[1] !== undefined), maxima = c => [c.memory.max, c.files.max, c.items.max].join();
        H.v('   pendant le traitement : sharp.cache(false) et sharp.concurrency(1) ; après : les réglages d\'avant sont RÉTABLIS (le scanner ne les subit pas)', [l[0], l[1], typeof l[l.length - 2][1], l[l.length - 1][1] === prevConc, maxima(sharp.cache()) === maxima(prevCache)], [['cache', false], ['conc', 1], 'object', true, true]);
        // MUTANTS
        const m1 = A.charger('images.js', [["sharp.cache(false);", "/* sans cache */"], ["sharp.concurrency(1);", "/* sans concurrence */"]]);
        const log2 = []; sharp.cache = v => { log2.push(['cache', v]); return oc.call(sharp, v); }; sharp.concurrency = v => { log2.push(['conc', v]); return oco.call(sharp, v); };
        try { await m1.traiter(buf, BORNES); } finally { sharp.cache = oc; sharp.concurrency = oco; }
        H.v('   MUTANT « ni cache(false) ni concurrency(1) » : plus aucun réglage', log2.filter(x => x[1] === false || x[1] === 1).length, 0);
        const m2 = A.charger('images.js', [["const vignette = await sharp(principale.data)", "const vignette = await base()"]]);
        const av3 = m2.compteur.decodages; await m2.traiter(buf, BORNES);
        H.v('   MUTANT « la vignette redécode l\'image reçue » : DEUX décodages', m2.compteur.decodages - av3, 2);
    }

    // ═══ 3. (S-I3) Turnstile ═══
    {
        const FACTICES = ['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA'];
        const pret = (x) => lireGalerie({ ...A.ENV_VALIDE, ...x });
        H.v('3. une clé secrète FACTICE de Cloudflare avec NODE_ENV=production : le lot ne se monte pas, la raison NOMME la variable', FACTICES.map(k => { const c = pret({ V2_GALERIE_TURNSTILE_SECRET: k, NODE_ENV: 'production' }); return [c.pret, /V2_GALERIE_TURNSTILE_SECRET/.test(c.raison || '')]; }), FACTICES.map(() => [false, true]));
        H.v('   idem avec V2_CIBLE=prod', FACTICES.map(k => pret({ V2_GALERIE_TURNSTILE_SECRET: k, V2_CIBLE: 'prod' }).pret), [false, false, false]);
        H.v('   la même clé factice hors production (essai, banc) : admise ; V2_CIBLE=essai l\'admet même sous NODE_ENV=production', [pret({ V2_GALERIE_TURNSTILE_SECRET: FACTICES[0] }).pret, pret({ V2_GALERIE_TURNSTILE_SECRET: FACTICES[0], NODE_ENV: 'production', V2_CIBLE: 'essai' }).pret], [true, true]);
        H.v('   une vraie clé en production : admise ; aucune clé : admise (les signalements anonymes répondent 503)', [pret({ NODE_ENV: 'production' }).pret, pret({ NODE_ENV: 'production', V2_GALERIE_TURNSTILE_SECRET: undefined }).pret], [true, true]);
        H.vrai('   la raison n\'imprime pas la clé', !/1x0{10}/.test(pret({ V2_GALERIE_TURNSTILE_SECRET: FACTICES[0], NODE_ENV: 'production' }).raison));
        const cible = `galerie:${await publier(luma)}`;
        const sig = (jeton, ip) => H.appel(sv.url, '/api/signalements', { methode: 'POST', corps: { cible, motif: 'autre', turnstile: jeton }, entetes: { origin: B.SITE, 'x-rat-market': '1', 'x-forwarded-for': ip || B.IP() } });
        const ts = B.turnstile;
        ts.hostname = 'rat-market.fr'; ts.action = 'signalement';
        H.v('   hostname du site + action attendue : 201', (await sig('jeton-valide-a')).statut, 201);
        ts.hostname = 'www.rat-market.fr'; H.v('   le www du site est admis aussi', (await sig('jeton-valide-b')).statut, 201);
        ts.hostname = 'evil.example'; const x1 = await sig('jeton-valide-c');
        H.v('   un jeton produit pour un AUTRE site (hostname) : 422 defi-anti-robot', [x1.statut, detail(x1)], [422, 'defi-anti-robot']);
        ts.hostname = 'rat-market.fr'; ts.action = 'autre-action'; H.v('   un jeton produit pour une AUTRE action : 422', (await sig('jeton-valide-d')).statut, 422);
        ts.action = null; H.v('   un jeton sans action : 422', (await sig('jeton-valide-e')).statut, 422);
        ts.hostname = null; ts.action = 'signalement'; H.v('   un jeton sans hostname : 422', (await sig('jeton-valide-f')).statut, 422);
        ts.hostname = 'rat-market.fr';
        const avant = ts.appels.length;
        const premier = await sig('jeton-valide-g'), rejoue = await sig('jeton-valide-g');
        H.v('   un jeton REJOUÉ est refusé (422) sans rappeler le fournisseur', [premier.statut, rejoue.statut, detail(rejoue), ts.appels.length - avant], [201, 422, 'defi-anti-robot', 1]);
        const stockes = await brut('jetons_turnstile').find({}).toArray();
        H.v('   le jeton n\'est jamais conservé : seule son empreinte, avec une expiration courte', [stockes.length > 0, JSON.stringify(stockes).includes('jeton-valide'), stockes.every(s => /^[0-9a-f]{64}$/.test(s.h) && s.expireLe > new Date())], [true, false, true]);
        // clés factices hors production : le fournisseur de TEST répond hostname example.com et aucune action : on ne les exige pas
        const bFact = await B.serveur(B.variante({}), { env: { ...B.envCfg, V2_GALERIE_TURNSTILE_SECRET: FACTICES[0] }, ts: A.fauxTurnstile({ secretAttendu: FACTICES[0], hostname: 'example.com', action: null }) });
        const rf = await H.appel(bFact.url, '/api/signalements', { methode: 'POST', corps: { cible, motif: 'autre', turnstile: 'jeton-valide-h' }, entetes: { origin: B.SITE, 'x-rat-market': '1', 'x-forwarded-for': B.IP() } });
        H.v('   avec la clé de TEST hors production : le hostname example.com et l\'absence d\'action sont admis', rf.statut, 201);
        // MUTANTS
        const attendu = async (rempl, jeton, ts2) => { const s = await B.serveur(B.cfg, { routes: A.charger('routes.js', rempl), ts: ts2 }); const r = await H.appel(s.url, '/api/signalements', { methode: 'POST', corps: { cible, motif: 'autre', turnstile: jeton }, entetes: { origin: B.SITE, 'x-rat-market': '1', 'x-forwarded-for': B.IP() } }); return r.statut; };
        const mauvaisHote = A.fauxTurnstile({ hostname: 'evil.example' }), mauvaiseAction = A.fauxTurnstile({ action: 'autre' }), memeJeton = A.fauxTurnstile();
        H.v('   MUTANT « le hostname n\'est plus comparé » : le jeton d\'un autre site passe (réel : 422)', [(await attendu([], 'jeton-valide-i', mauvaisHote)), (await attendu([["hotesDuSite, action: 'signalement' }", "hotesDuSite: null, action: 'signalement' }"]], 'jeton-valide-j', mauvaisHote))], [422, 201]);
        H.v('   MUTANT « l\'action n\'est plus comparée »', [(await attendu([], 'jeton-valide-k', mauvaiseAction)), (await attendu([["action: 'signalement' }", "action: null }"]], 'jeton-valide-l', mauvaiseAction))], [422, 201]);
        const dbl = async (rempl) => { const s = await B.serveur(B.cfg, { routes: A.charger('routes.js', rempl), ts: memeJeton }); const f = () => H.appel(s.url, '/api/signalements', { methode: 'POST', corps: { cible, motif: 'autre', turnstile: 'jeton-valide-m' + rempl.length }, entetes: { origin: B.SITE, 'x-rat-market': '1', 'x-forwarded-for': B.IP() } }); await f(); return (await f()).statut; };
        H.v('   MUTANT « le rejeu n\'est plus vu » : le même jeton passe deux fois', [await dbl([]), await dbl([["if (!(await svc.jetonNeuf(b.turnstile)))", "if (false)"]])], [422, 201]);
        const mc = A.charger('config.js', [["if (FACTICES.includes(secretTurnstile)", "if (false && FACTICES.includes(secretTurnstile)"]]);
        H.v('   MUTANT « les clés factices ne sont plus refusées en production »', [pret({ V2_GALERIE_TURNSTILE_SECRET: FACTICES[0], NODE_ENV: 'production' }).pret, mc.lireGalerie({ ...A.ENV_VALIDE, V2_GALERIE_TURNSTILE_SECRET: FACTICES[0], NODE_ENV: 'production' }).pret], [false, true]);
    }

    // ═══ 4. (I-I3, I-I4) orphelins et RGPD : le balayeur ═══
    {
        const sec = B.cfg.empreinte.secret, H24 = 24 * 3600e3;
        const vieux = (k, age) => stockage.poser(k, Buffer.from('x'), age);
        // un compte qui part : ses objets, ses dépôts expirés (sans document), et une panne R2 qui ne se perd pas
        const partant = await compte({}, 'partant-r2'); const ref = svc.refCompte(partant.id, sec);
        const art = (await deposer(sv, partant, { nom: 'Du partant' })).id;
        vieux(`galerie/depot/${ref}/expire1`, 30 * 3600e3); vieux(`galerie/depot/${ref}/expire2`, 40 * 3600e3);
        stockage.panneSuppression = true;
        const n = await svc.supprimerDuCompte(partant.id, stockage, sec);
        const file = (await brut('purges_r2').find({}).toArray()).map(f => f._id).sort();
        H.v('4. suppression de compte avec R2 en panne : RIEN n\'est avalé — chaque clé (art, vignette, dépôts expirés SANS document) entre dans purges_r2', [file.includes(`galerie/attente/${art}.webp`), file.includes(`galerie/depot/${ref}/expire1`), file.includes(`galerie/depot/${ref}/expire2`), n.purgesEnFile >= 4], [true, true, true, true]);
        stockage.panneSuppression = false;
        const p = await Bal.passe({ stockage, secret: sec });
        H.v('   la panne levée, le balayeur rejoue : les objets du compte disparaissent, la file est vide', [p.purgesRejouees >= 4, present(`galerie/depot/${ref}/expire1`), present(`galerie/attente/${art}.webp`), await brut('purges_r2').countDocuments({})], [true, false, false, 0]);
        // la panne persiste : l'entrée reste, avec un essai de plus
        await brut('purges_r2').insertOne({ _id: 'galerie/attente/rate.webp', raison: 'refus', le: new Date(), essais: 0 }); stockage.poser('galerie/attente/rate.webp', Buffer.from('x'));
        stockage.panneSuppression = true; const pp = await Bal.passe({ stockage, secret: sec }); stockage.panneSuppression = false;
        H.v('   si la suppression échoue encore : l\'entrée reste, essais + 1, comptée dans le rapport de passe', [await brut('purges_r2').findOne({ _id: 'galerie/attente/rate.webp' }).then(x => x.essais), pp.purgesEchouees], [1, 1]);
        await Bal.passe({ stockage, secret: sec });
        // les orphelins
        const aOrph = await artPublic(luma, { etat: 'en-attente', publieLe: null });
        vieux('galerie/depot/xxxxxxxxxxxxxxxx/orphelin-vieux', 25 * 3600e3); vieux('galerie/depot/xxxxxxxxxxxxxxxx/orphelin-recent', 3600e3);
        vieux('galerie/attente/sansdoc-vieux.webp', 30 * 3600e3); vieux(`galerie/attente/${aOrph}.webp`, 30 * 3600e3);
        const aRetire = await artPublic(luma, { etat: 'retire' }); vieux(`galerie/attente/${aRetire}.webp`, 30 * 3600e3);
        await brut('depots').insertOne({ _id: 'depotvalide0000000000', compteId: luma.id, cle: 'galerie/depot/yyyyyyyyyyyyyyyy/depotvalide0000000000', type: 'image/png', octets: 1, etat: 'ouvert', creeLe: new Date(), finaliseAvant: new Date(Date.now() + 1e6), purgeLe: new Date(Date.now() + 1e8), artId: null });
        vieux('galerie/depot/yyyyyyyyyyyyyyyy/depotvalide0000000000', 26 * 3600e3);
        const po = await Bal.passe({ stockage, secret: sec });
        H.v('   orphelins : un depot/ de plus de 24 h SANS document est retiré ; un récent reste ; un depot/ avec document reste', [present('galerie/depot/xxxxxxxxxxxxxxxx/orphelin-vieux'), present('galerie/depot/xxxxxxxxxxxxxxxx/orphelin-recent'), present('galerie/depot/yyyyyyyyyyyyyyyy/depotvalide0000000000')], [false, true, true]);
        H.v('   attente/ : sans document → retiré ; document « en-attente » → GARDÉ (c\'est l\'objet que le modérateur doit voir) ; document retiré → retiré', [present('galerie/attente/sansdoc-vieux.webp'), present(`galerie/attente/${aOrph}.webp`), present(`galerie/attente/${aRetire}.webp`)], [false, true, false]);
        const j = await brut('balayages').find({}).sort({ le: -1 }).limit(1).next();
        H.v('   chaque passe est JOURNALISÉE dans balayages (décomptes, durée, conservation 12 mois) et le rapport rendu dit la même chose', [j.orphelins, po.orphelins, j.conserveJusqua > j.le, typeof j.dureeMs], [3, 3, true, 'number']);
        // bornée
        for (let i = 0; i < 7; i++) vieux(`galerie/attente/borne-${i}.webp`, 30 * 3600e3);
        const pb = await Bal.passe({ stockage, secret: sec, limite: 3 });
        H.v('   une passe est BORNÉE (3 suppressions ici) : elle le dit, et la suivante continue', [pb.orphelins, pb.limiteAtteinte, [...stockage.objets.keys()].filter(k => k.startsWith('galerie/attente/borne-')).length], [3, true, 4]);
        await Bal.passe({ stockage, secret: sec, limite: 50 });
        H.v('   (la passe suivante finit le travail)', [...stockage.objets.keys()].filter(k => k.startsWith('galerie/attente/borne-')).length, 0);
        // un seul balayeur à la fois
        const [x, y] = await Promise.all([Bal.passe({ stockage, secret: sec }), Bal.passe({ stockage, secret: sec })]);
        H.v('   deux passes simultanées : une seule travaille (verrou), l\'autre est ignorée', [x.ignoree === true, y.ignoree === true].filter(Boolean).length, 1);
        // le minuteur du montage
        const monter = require('../galerie/monter'); const express = require('express');
        await monter.arreter();
        const r = express.Router();
        const Gr = require('../galerie/grappe'), init = require('../galerie/outils/initialiser-base');
        await init.initialiserBase(B.dbG);
        const stk = A.fauxStockage(); stk.poser('galerie/depot/zzzzzzzzzzzzzzzz/vieux', Buffer.from('x'), 48 * 3600e3);
        monter.routes(r, B.cfg, { env: B.envCfg, stockage: stk, intervalleBalayageMs: 40, ouvrirBase: async () => ({ db: B.dbG, fermer: async () => { } }) });
        await monter.pret(); await new Promise(res => setTimeout(res, 400));
        H.v('   monté (balayage non coupé) : le minuteur lance des passes tout seul et retire l\'orphelin ; arrêté, il se tait', [stk.objets.has('galerie/depot/zzzzzzzzzzzzzzzz/vieux'), (await brut('balayages').countDocuments({})) > 2], [false, true]);
        await monter.arreter(); G.brancher(B.dbG);
        const nb = await brut('balayages').countDocuments({}); await new Promise(res => setTimeout(res, 200));
        H.v('   (après arreter() plus aucune passe)', await brut('balayages').countDocuments({}), nb);
        // MUTANTS
        const mAge = A.charger('balayeur.js', [["if (age < ageMs) continue;", "if (false) continue;"]]);
        stockage.poser('galerie/depot/xxxxxxxxxxxxxxxx/tout-neuf', Buffer.from('x'), 1000);
        await mAge.passe({ stockage, secret: sec });
        H.v('   MUTANT « l\'âge n\'est plus jugé » : un objet de 1 s est supprimé (le réel le garde)', present('galerie/depot/xxxxxxxxxxxxxxxx/tout-neuf'), false);
        stockage.poser('galerie/depot/xxxxxxxxxxxxxxxx/tout-neuf2', Buffer.from('x'), 1000); await Bal.passe({ stockage, secret: sec });
        H.v('   (le réel garde l\'objet de 1 s)', present('galerie/depot/xxxxxxxxxxxxxxxx/tout-neuf2'), true);
        const aGarde = await artPublic(luma, { etat: 'en-attente', publieLe: null }); stockage.poser(`galerie/attente/${aGarde}.webp`, Buffer.from('x'), 40 * 3600e3);
        const mDoc = A.charger('balayeur.js', [["if (art && (art.etat === 'en-attente' || art.etat === 'prive')) continue;", "if (false) continue;"]]);
        await mDoc.passe({ stockage, secret: sec });
        H.v('   MUTANT « le document en attente n\'est plus protégé » : l\'objet que le modérateur doit voir est supprimé', present(`galerie/attente/${aGarde}.webp`), false);
        const mRej = A.charger('balayeur.js', [["await rejouerPurges(", "0 && await rejouerPurges("]]);
        await brut('purges_r2').insertOne({ _id: 'galerie/attente/rejeu.webp', raison: 'refus', le: new Date(), essais: 0 }); stockage.poser('galerie/attente/rejeu.webp', Buffer.from('x'));
        await mRej.passe({ stockage, secret: sec });
        H.v('   MUTANT « la file de reprise n\'est plus rejouée » : l\'entrée et l\'objet restent', [await brut('purges_r2').countDocuments({ _id: 'galerie/attente/rejeu.webp' }), present('galerie/attente/rejeu.webp')], [1, true]);
        await Bal.passe({ stockage, secret: sec });
        const mAvale = A.charger('service.js', [["await G.col('purges_r2').updateOne({ _id: cle }", "0 && await G.col('purges_r2').updateOne({ _id: cle }"]]);
        const p2 = await compte({}, 'partant-mutant'); const art2 = (await deposer(sv, p2, { nom: 'x' })).id;
        stockage.panneSuppression = true; await mAvale.supprimerDuCompte(p2.id, stockage, sec); stockage.panneSuppression = false;
        H.v('   MUTANT « la panne R2 est de nouveau avalée » : rien n\'entre dans la file, l\'objet orphelin n\'est plus retrouvé', [await brut('purges_r2').countDocuments({ _id: `galerie/attente/${art2}.webp` }), present(`galerie/attente/${art2}.webp`)], [0, true]);
        await Bal.passe({ stockage, secret: sec });
    }

    // ═══ 5. (S-I4) cache, décalage, recherche ═══
    {
        const horloge = { t: Date.now() };
        const sc = await B.serveur(B.cfg, { deps: { memoTtlMs: 60000, maintenant: () => new Date(horloge.t) } });
        const compteurs = {}; const colOrig = G.col;
        G.col = n => { const c = colOrig(n); return new Proxy(c, { get(t, k) { if (k === 'aggregate') return (...a) => { compteurs[n] = (compteurs[n] || 0) + 1; return t.aggregate(...a); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }); };
        try {
            await lire(sc, '/api/galerie/filtres'); const f1 = compteurs.publications; await lire(sc, '/api/galerie/filtres'); await lire(sc, '/api/galerie/filtres');
            H.v('5. /filtres est mémoïsé côté serveur (60 s ici) : les trois appels ne coûtent que les cinq agrégations du premier', [f1, compteurs.publications], [5, 5]);
            horloge.t += 61000; await lire(sc, '/api/galerie/filtres');
            H.v('   le délai écoulé, la lecture est refaite', compteurs.publications, 10);
            await lire(sc, '/api/galerie?tri=tendances'); const t1 = compteurs.votes || 0; await lire(sc, '/api/galerie?tri=tendances'); await lire(sc, '/api/galerie?tri=tendances');
            H.v('   tri=tendances est mémoïsé (clé = paramètres normalisés) : une agrégation de votes pour trois appels', [t1, compteurs.votes], [1, 1]);
            await lire(sc, '/api/galerie?tri=tendances&set=Base-Set'); H.v('   des paramètres différents ne partagent pas l\'entrée', compteurs.votes, 2);
            // MUTANT : sans mémo
            const mm = A.charger('memo.js', [["if (ttlMs <= 0) return fn();", "return fn();"], ["const e = tenues.get(cle);", "const e = null;"]]);
            const m = mm.creerMemo({ ttlMs: 60000, maintenant: () => new Date(horloge.t) }); let n = 0; await m.obtenir('k', async () => ++n); await m.obtenir('k', async () => ++n);
            H.v('   MUTANT « le mémo ne retient plus rien » : deux appels, deux calculs (le réel : un)', [n, await (async () => { const r = require('../galerie/memo').creerMemo({ ttlMs: 60000, maintenant: () => new Date(horloge.t) }); let k = 0; await r.obtenir('k', async () => ++k); await r.obtenir('k', async () => ++k); return k; })()], [2, 1]);
        } finally { G.col = colOrig; }
        const cap = await lire(sv, `/api/galerie?suite=${F.ecrireSuite(2001)}`), ok = await lire(sv, `/api/galerie?suite=${F.ecrireSuite(2000)}`);
        H.v('   plafond de décalage : 2 000 (au-delà : 400 ENTREE suite)', [ok.statut, cap.statut, detail(cap)], [200, 400, 'suite']);
        // la recherche q
        await artPublic(luma, { nom: 'Fond doux', mots: svc.motsDe('Fond doux', 'luma') }); await artPublic(noa, { nom: 'Bande large', mots: svc.motsDe('Bande large', 'noa') });
        const rq = async q => (await lire(sv, `/api/banque?q=${encodeURIComponent(q)}`));
        H.v('   q ancrée au PRÉFIXE d\'un mot du nom ou du pseudo : « dou » trouve « Fond doux », « NOA » trouve noa, « fo dou » (deux préfixes) aussi', [(await rq('dou')).json.arts.length, (await rq('NOA')).json.arts.length, (await rq('fo dou')).json.arts.length], [1, 1, 1]);
        H.v('   le milieu d\'un mot ne correspond plus (« oux ») ; moins de 2 caractères : 400 ; un caractère spécial est inerte (« .* »)', [(await rq('oux')).json.arts.length, (await rq('a')).statut, (await rq('.*')).json.arts.length], [0, 400, 0]);
        const plan = JSON.stringify(await brut('arts').find(svc.filtreRecherche('dou')).explain('queryPlanner'));
        H.v('   la recherche utilise l\'INDEX multiclé des mots (IXSCAN, jamais COLLSCAN)', [plan.includes('IXSCAN'), plan.includes('COLLSCAN'), plan.includes('mots_1_etat_1')], [true, false, true]);
        const mq = A.charger('service.js', [["{ mots: { $elemMatch: { $gte: w, $lt: w + FIN } } }", "{ nom: { $regex: w, $options: 'i' } }"]]);
        H.v('   MUTANT « la recherche redevient une regex non ancrée » : « oux » trouve, et le plan n\'est plus indexé', [(await brut('arts').countDocuments(svc.filtreRecherche('oux'))), (await brut('arts').countDocuments(mq.filtreRecherche('oux')))], [0, 1]);
        // changer de pseudo met à jour la recherche
        await svc.poserPseudo(noa.id, 'noa-bis');
        H.v('   un changement de pseudo met à jour les mots de recherche des arts', [(await rq('noa-bis')).json.arts.length > 0], [true]);
    }
    await B.fermer();
    H.bilan();
})();
