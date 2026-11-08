'use strict';
// GALERIE — TOUR 1 de correction (trois relectures de L9 et L10) : chaque défaut est REJOUÉ sur le code réel (vrais appels simultanés sur mongod quand la course est le défaut, injection d'un événement entre la lecture et l'écriture
// quand il faut la rendre certaine) ET sur une COPIE MUTÉE du module (le fragment retiré du TEXTE, jamais du fichier) : le banc doit changer de résultat, sinon il ne prouve rien.
//   G1 jour civil de Paris · G2 publication orpheline · M1 bornes atomiques · M2 synchro plus ancienne · M3 état modéré écrasé · M4 rejeu de finaliser · M5 index · M6 illustrations privées rendues ·
//   M7 classeur retiré · M8 mise à jour orpheline · m1 quota effectif · m4 titre d'un art devenu public · m5 liste · m6 couverture · m7 PUT identique · m8 V2_PUBLICATIONS_JOUR.
const A = require('./_aide-galerie');
const H = A.H;

(async () => {
    const B = await A.outillerBanc('test-galerie-tour1.js');
    const { G, F, svc, compte, appel, code, detail, brut, sv, serveur, variante, artPublic, deposer, stockage } = B;
    const C = require('../galerie/classeurs'), I = require('../galerie/illustrations'), Q = require('../galerie/quota-publications'), D = require('../galerie/depot');
    const carte = (c, r, cle = '1234|001') => ({ c, r, l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle, setSlug: 'Base-Set' } });
    const bart = (c, r, artId) => ({ c, r, l: 1, h: 1, genre: 'art', contenu: { type: 'art', artId } });
    const pg = (blocs = [], nb = 9) => ({ nb, blocs });
    const CORPS = { certifieAuteur: true, cgu: '2026-10' };
    const creer = async (c, titre = 'T', pages = [pg([carte(0, 0)])], extra = {}) => (await C.creer({ compteId: c.id, champs: { titre, etiquettes: [], couleur: null, couverture: null, pages, ...extra }, max: 50 })).classeur;
    const publier = (c, id, m = C, corps = CORPS, plus = {}) => m.publier({ compteId: c.id, pseudo: c.pseudo, id, corps, ...plus });
    const nb = async (coll, f) => brut(coll).countDocuments(f);
    const pub1 = async id => brut('publications').findOne({ _id: id });
    /** Pendant que `fn` tourne, l'opération `op` de la collection `nom` est précédée de `evt` (un événement concurrent rendu CERTAIN entre la lecture et l'écriture). */
    async function avec(nom, op, evt, fn) {
        const col0 = G.col; let declenche = false;
        G.col = n => { const c = col0(n); if (n !== nom) return c; return new Proxy(c, { get(t, k) { if (k === op) return async (...a) => { if (!declenche) { declenche = true; await evt(); } return t[op](...a); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }); };
        try { return await fn(); } finally { G.col = col0; }
    }
    const luma = await compte({}, 'luma'), noa = await compte({}, 'noa'), modo = await compte({ role: 'moderateur' }, 'modo-tour1');

    // ═══ G1. LE QUOTA SUIT LE JOUR CIVIL DE PARIS (et non 24 h UTC) ═══
    {
        const reel = Q, mUtc = A.charger('quota-publications.js', [["const { jourDeParis } = require('../argent/offre');", "const jourDeParis = d => d.toISOString().slice(0, 10);"]]);
        const scene = async (m, label, t0, t1, ouvert) => {
            const horloge = { t: new Date(t0) }, q = m.creer({ max: 2, maintenant: () => horloge.t }), c = await compte({}, `g1-${label}-${Math.random().toString(36).slice(2, 6)}`);
            await q.reserver(c.id); await q.reserver(c.id);
            const plein = await q.reserver(c.id);
            horloge.t = new Date(t1);
            const apres = await q.reserver(c.id);
            return [plein.permis, apres.permis, ouvert];
        };
        // été : 21h30Z = 23h30 Paris (jour 10) ; 22h30Z = 00h30 Paris (jour 11), même jour UTC
        H.v('G1 été — à 23 h 30 Paris le jour est plein ; à 00 h 30 Paris (même jour UTC) il est rouvert', (await scene(reel, 'ete', '2026-06-10T21:30:00Z', '2026-06-10T22:30:00Z', null)).slice(0, 2), [false, true]);
        // hiver : 22h30Z = 23h30 Paris (jour 10) ; 23h30Z = 00h30 Paris (jour 11), même jour UTC
        H.v('G1 hiver — 23 h 30 puis 00 h 30 Paris, séparés par une heure : le jour change à minuit de Paris', (await scene(reel, 'hiver', '2026-01-10T22:30:00Z', '2026-01-10T23:30:00Z', null)).slice(0, 2), [false, true]);
        // passage à l'heure d'été (jour de 23 h) et d'hiver (jour de 25 h)
        H.v('G1 changement d\'heure de printemps (le 29 mars, jour de 23 h) — à 23 h 30 Paris plein, à 00 h 30 le 30 : rouvert', (await scene(reel, 'p', '2026-03-29T21:30:00Z', '2026-03-29T22:30:00Z', null)).slice(0, 2), [false, true]);
        H.v('G1 changement d\'heure d\'automne (le 25 octobre, jour de 25 h) — 00 h 30 CEST et 23 h 30 CET sont le MÊME jour (plein), 00 h 30 le 26 : rouvert', [(await scene(reel, 'a1', '2026-10-24T22:30:00Z', '2026-10-25T22:30:00Z', null)).slice(0, 2), (await scene(reel, 'a2', '2026-10-25T22:30:00Z', '2026-10-25T23:30:00Z', null)).slice(0, 2)], [[false, false], [false, true]]);
        H.v('   MUTANT « le jour est le jour UTC » : à 00 h 30 Paris (même jour UTC) le jour reste plein — le réel le rouvre', [(await scene(reel, 'm1', '2026-06-10T21:30:00Z', '2026-06-10T22:30:00Z', null))[1], (await scene(mUtc, 'm2', '2026-06-10T21:30:00Z', '2026-06-10T22:30:00Z', null))[1]], [true, false]);
        // par la route : 429 LIMITE_DEBIT et reessayerDans jusqu'au prochain minuit de Paris
        const h = { t: new Date('2026-06-10T21:30:00Z') };
        const svH = await serveur(variante({}, { publicationsCompteJour: 1 }), { deps: { maintenant: () => h.t } });
        const p = await compte({}, 'g1-route');
        const c1 = await creer(p), c2 = await creer(p, 'Deux');
        const pubR = id => appel(svH, 'POST', `/api/classeurs/${id}/publication`, { c: p, corps: CORPS });
        const r1 = await pubR(c1.id), r2 = await pubR(c2.id);
        H.v('G1 route — à 23 h 30 Paris : la 1re passe, la 2e est 429 LIMITE_DEBIT avec reessayerDans = 1 800 s (jusqu\'au minuit de Paris, pas 24 h)', [r1.statut, r2.statut, code(r2), r2.json.erreur.reessayerDans, r2.entetes['retry-after']], [200, 429, 'LIMITE_DEBIT', 1800, '1800']);
        h.t = new Date('2026-06-10T22:30:00Z');
        H.v('   à 00 h 30 Paris le lendemain : la publication repasse', (await pubR(c2.id)).statut, 200);
    }

    // ═══ m1. UNE PUBLICATION N'EST COMPTÉE QUE SI ELLE EST FAITE ═══
    {
        const svM = await serveur(variante({}, { publicationsCompteJour: 3 })), p = await compte({}, 'm1-compte');
        const q = Q.creer({ max: 3, maintenant: () => new Date() }), n = async () => (await q.lire(p.id)).n;
        const vide = await creer(p, 'Vide', [pg([])]), plein = await creer(p, 'Plein');
        const pubS = (id, corps = CORPS) => appel(svM, 'POST', `/api/classeurs/${id}/publication`, { c: p, corps });
        await pubS(F.nouvelId());
        await pubS(plein.id, { cgu: 'x' });
        await pubS(vide.id);
        await pubS('!!');
        H.v('m1 — un 404, un refus de forme (non certifié) et un classeur vide ne comptent PAS', await n(), 0);
        await pubS(plein.id);
        H.v('   la publication faite compte (1) ; la REJOUER (déjà en attente) ne compte pas de nouveau', [await n(), (await pubS(plein.id)).statut, await n()], [1, 200, 1]);
        const art = await artPublic(p, { etat: 'prive', publieLe: null }), pubI = () => appel(svM, 'POST', `/api/illustrations/${art}/publication`, { c: p, corps: CORPS });
        await pubI(); const apres1 = await n(); await pubI();
        H.v('   une illustration : sa publication compte (2) ; rejouée (déjà en attente), non ; un art d\'autrui (404) ou refusé (409), non', [apres1, await n(), (await appel(svM, 'POST', `/api/illustrations/${F.nouvelId()}/publication`, { c: p, corps: CORPS })).statut,
            (await appel(svM, 'POST', `/api/illustrations/${await artPublic(p, { etat: 'refuse', publieLe: null })}/publication`, { c: p, corps: CORPS })).statut, await n()], [2, 2, 404, 409, 2]);
        // atomicité : 6 publications SIMULTANÉES sur un quota de 3 → exactement 3 passent
        const q2 = Q.creer({ max: 3, maintenant: () => new Date() }), cc = await compte({}, 'm1-course');
        const rs = await Promise.all(Array.from({ length: 6 }, () => q2.reserver(cc.id)));
        const mSans = A.charger('quota-publications.js', [["{ cle, n: { $lt: max } }", "{ cle }"]]).creer({ max: 3, maintenant: () => new Date() }), c2 = await compte({}, 'm1-course2');
        const rm = await Promise.all(Array.from({ length: 6 }, () => mSans.reserver(c2.id)));
        H.v('   6 réservations SIMULTANÉES pour 3 places : exactement 3 permises ; MUTANT « sans le plafond dans le filtre » : les 6 passent', [rs.filter(x => x.permis).length, rm.filter(x => x.permis).length], [3, 6]);
    }

    // ═══ G2. UNE PUBLICATION NE RESTE JAMAIS SANS CLASSEUR (DELETE concurrent, compte supprimé) ═══
    {
        const p = await compte({}, 'g2-pub');
        const joue = async m => { const cl = await creer(p, 'Orphelin'); const r = await avec('publications', 'insertOne', () => brut('classeurs').deleteOne({ _id: cl.id }), () => publier(p, cl.id, m)); return [r.introuvable === true, await nb('publications', { _id: cl.id })]; };
        const mut = A.charger('classeurs.js', [["if (!vivant) {", "if (false) {"]]);
        H.v('G2 — le classeur est supprimé ENTRE la lecture et l\'écriture de la publication : introuvable, et AUCUNE publication orpheline', await joue(C), [true, 0]);
        H.v('   MUTANT « pas de relecture après l\'écriture » : la publication reste, sans classeur', (await joue(mut))[1], 1);
        // la synchronisation d'un PUT (classeur public ou en attente) : même défaut
        const sync = async m => {
            const cl = await creer(p, 'Sync'); await publier(p, cl.id);
            const d = await brut('classeurs').findOne({ _id: cl.id });
            await avec('publications', 'updateOne', () => brut('classeurs').deleteOne({ _id: cl.id }), () => m.synchroniser({ ...d, titre: 'Nouveau', version: d.version + 1 }, new Date()));
            return nb('publications', { _id: cl.id });
        };
        const mutS = A.charger('classeurs.js', [["if (!(await G.col('classeurs').findOne({ _id: d._id", "if (false && !(await G.col('classeurs').findOne({ _id: d._id"]]);
        H.v('   la synchronisation d\'un PUT concurrent d\'un DELETE : la publication part avec le classeur ; MUTANT : elle reste', [await sync(C), await sync(mutS)], [0, 1]);
        // la reprise (remix) d'un compte supprimé entre-temps
        const src = await creer(luma, 'Source'); await publier(luma, src.id); await brut('publications').updateOne({ _id: src.id }, { $set: { etat: 'public', publieLe: new Date() } });
        const remixe = async m => {
            const q = await compte({}, 'g2-remix-' + Math.random().toString(36).slice(2, 6));
            const r = await avec('classeurs', 'insertOne', () => brut('profils').deleteOne({ _id: q.id }), () => m.remixer({ compteId: q.id, id: src.id, max: 20 }));
            return [r.introuvable === true, await nb('classeurs', { auteurId: q.id })];
        };
        const mutR = A.charger('service.js', [["if (!(await G.col('profils').findOne({ _id: mien }", "if (false && !(await G.col('profils').findOne({ _id: mien }"]]);
        H.v('   le remix d\'un compte supprimé pendant la copie : aucune copie orpheline ; MUTANT : la copie reste', [await remixe(svc), (await remixe(mutR))[1]], [[true, 0], 1]);
    }

    // ═══ M1. LES BORNES SONT ATOMIQUES (appels simultanés) ═══
    {
        const cond = async (m, n, max, remix = 0) => {
            const p = await compte({}, 'm1-' + Math.random().toString(36).slice(2, 6));
            const taches = Array.from({ length: n }, () => m.creer({ compteId: p.id, champs: { titre: 'X', etiquettes: [], couleur: null, couverture: null, pages: [pg([carte(0, 0)])] }, max }));
            for (let i = 0; i < remix; i++) taches.push(svc.remixer({ compteId: p.id, id: SRC, max }));
            await Promise.all(taches);
            return nb('classeurs', { auteurId: p.id });
        };
        var SRC = (await (async () => { const s = await creer(luma, 'Src2'); await publier(luma, s.id); await brut('publications').updateOne({ _id: s.id }, { $set: { etat: 'public', publieLe: new Date() } }); return s; })()).id;
        const mutB = A.charger('classeurs.js', [["> max) { await G.col('classeurs').deleteOne", "> 1e9) { await G.col('classeurs').deleteOne"]]);
        const reel = await cond(C, 8, 3), cumul = await cond(C, 4, 3, 4), mut = await cond(mutB, 8, 3);
        H.v('M1 — 8 créations SIMULTANÉES sous une borne de 3 : jamais plus de 3 classeurs ; création et reprise (remix) comptent dans la MÊME borne (4 + 4 : jamais plus de 3) ; MUTANT « sans contrôle a posteriori » : 8', [reel <= 3, cumul <= 3, mut], [true, true, 8]);
        // la borne reste atteignable en séquence (les annulations n'ont rien laissé)
        const p = await compte({}, 'm1-seq'); const seq = [];
        for (let i = 0; i < 5; i++) seq.push(Boolean((await C.creer({ compteId: p.id, champs: { titre: 'S', etiquettes: [], couleur: null, couverture: null, pages: [pg()] }, max: 3 })).classeur));
        H.v('   en séquence : 3 créations passent, les suivantes sont refusées', seq, [true, true, true, false, false]);
        // 30 illustrations : dépôts simultanés
        const dep = async (m, n, max) => {
            const p2 = await compte({}, 'm1-dep-' + Math.random().toString(36).slice(2, 6));
            const rs = await Promise.all(Array.from({ length: n }, () => m.ouvrirDepot({ compteId: p2.id, ref: 'refcompte0001', type: 'image/png', octets: 1000, bornes: { octetsMax: 8e6, pixelsMax: 12e6, illustrationsMax: max }, stockage })));
            return [rs.filter(r => r.ok).length, await nb('depots', { compteId: p2.id })];
        };
        const mutD = A.charger('depot.js', [["> bornes.illustrationsMax) { await G.col('depots').deleteOne", "> 1e9) { await G.col('depots').deleteOne"]]);
        const dr = await dep(D, 6, 2), dm = await dep(mutD, 6, 2);
        H.v('M1 — 6 dépôts SIMULTANÉS sous une borne de 2 illustrations : jamais plus de 2 dépôts ouverts ; MUTANT : 6', [dr[0] <= 2 && dr[1] <= 2, dm[1]], [true, 6]);
    }

    // ═══ M2. UNE SYNCHRONISATION PLUS ANCIENNE N'ÉCRASE PAS UNE PLUS RÉCENTE ═══
    {
        const p = await compte({}, 'm2-sync');
        const scene = async (m, public_) => {
            const cl = await creer(p, 'v1'); await publier(p, cl.id);
            if (public_) await brut('publications').updateOne({ _id: cl.id }, { $set: { etat: 'public', publieLe: new Date() } });
            const d = await brut('classeurs').findOne({ _id: cl.id });
            const v = (n, t) => ({ ...d, titre: t, version: n });
            await m.synchroniser(v(3, 'v3'), new Date());
            await m.synchroniser(v(2, 'v2'), new Date());          // la plus ancienne arrive APRÈS
            const doc = public_ ? await brut('publications').findOne({ remplace: cl.id }) : await pub1(cl.id);
            return [doc.titre, doc.versionClasseur];
        };
        const mutE = A.charger('classeurs.js', [["{ _id: d._id, auteurId: d.auteurId, etat: 'en-attente', versionClasseur: { $not: { $gt: snap.versionClasseur } } }", "{ _id: d._id, auteurId: d.auteurId, etat: 'en-attente' }"]]);
        const mutP = A.charger('classeurs.js', [["{ remplace: id, auteurId, versionClasseur: { $not: { $gt: snap.versionClasseur } } }", "{ remplace: id, auteurId }"]]);
        H.v('M2 — la synchro v3 puis la v2 plus ancienne : la copie en attente garde v3 ; MUTANT sans la condition de version : v2', [await scene(C, false), await scene(mutE, false)], [['v3', 3], ['v2', 2]]);
        H.v('   idem pour la mise à jour d\'un classeur PUBLIC ; MUTANT : v2', [await scene(C, true), await scene(mutP, true)], [['v3', 3], ['v2', 2]]);
    }

    // ═══ M3. UN ÉTAT MODÉRÉ N'EST PAS ÉCRASÉ ENTRE LA LECTURE ET L'ÉCRITURE ═══
    {
        const p = await compte({}, 'm3-etat');
        const scene = async (m, nouvelEtat) => {
            const cl = await creer(p, 'Etat'); await publier(p, cl.id);                       // en attente
            const r = await avec('publications', 'updateOne', () => brut('publications').updateOne({ _id: cl.id }, { $set: { etat: nouvelEtat, publieLe: nouvelEtat === 'public' ? new Date() : null, motif: nouvelEtat === 'retire' ? { code: 'droits', texte: '' } : null } }),
                () => publier(p, cl.id, m, CORPS));
            return [(await pub1(cl.id)).etat, Boolean(r.conflit)];
        };
        const mutF = A.charger('classeurs.js', [["{ _id: id, auteurId: mien, etat: main.etat, versionClasseur", "{ _id: id, auteurId: mien, versionClasseur"]]);
        H.v('M3 — la modération ACCEPTE entre la lecture et l\'écriture : la publication reste « public » (la nouvelle copie attend à côté) ; MUTANT sans l\'état dans le filtre : écrasée en « en-attente »', [await scene(C, 'public'), await scene(mutF, 'public')], [['public', false], ['en-attente', false]]);
        H.v('   la modération RETIRE entre-temps : l\'état « retire » est gardé (409 etat côté route)', (await scene(C, 'retire'))[0], 'retire');
    }

    // ═══ M7. UN CLASSEUR RETIRÉ PAR LA MODÉRATION NE SE REPUBLIE PAS, ET SE DÉPUBLIE SANS PERDRE SON MOTIF ═══
    {
        const p = await compte({}, 'm7-retire');
        const cl = await creer(p, 'Retire'); await publier(p, cl.id);
        await brut('publications').updateOne({ _id: cl.id }, { $set: { etat: 'retire', motif: { code: 'droits', texte: 'scan' } } });
        const rp = await appel(svP(), 'POST', `/api/classeurs/${cl.id}/publication`, { c: p, corps: CORPS });
        H.v('M7 — republier un classeur « retire » : 409 CONFLIT etat (comme une illustration retirée), rien n\'est écrit', [rp.statut, code(rp), detail(rp), (await pub1(cl.id)).etat], [409, 'CONFLIT', 'etat', 'retire']);
        const dp = await appel(sv, 'DELETE', `/api/classeurs/${cl.id}/publication`, { c: p });
        H.v('   le dépublier : 200 mais la publication « retire » et son motif restent, l\'auteur lit toujours « retire »', [dp.statut, (await pub1(cl.id)).motif, dp.json.classeur.visibilite, dp.json.classeur.motif], [200, { code: 'droits', texte: 'scan' }, 'retire', { code: 'droits', texte: 'scan' }]);
        const mutR = A.charger('classeurs.js', [["!(d._id === id && d.etat === 'retire')", "true"]]);
        await mutR.depublier({ compteId: p.id, id: cl.id });
        H.v('   MUTANT « une publication retirée est effacée avec la dépublication » : la publication et son motif disparaissent', await nb('publications', { _id: cl.id }), 0);
    }
    function svP() { return sv; }

    // ═══ M6. UN CLASSEUR RETIRÉ RAMÈNE SES ILLUSTRATIONS PRIVÉES À « prive » ═══
    {
        const p = await compte({}, 'm6-libre');
        const etat = async id => (await brut('arts').findOne({ _id: id })).etat;
        const privee = () => artPublic(p, { etat: 'prive', publieLe: null });
        const a1 = await privee(), c1 = await creer(p, 'M6a', [pg([bart(0, 0, a1), carte(1, 0)])]);
        await publier(p, c1.id);
        const apres = await etat(a1); await C.depublier({ compteId: p.id, id: c1.id });
        H.v('M6 — publier un classeur passe son illustration privée « en-attente » ; le dépublier la ramène « prive »', [apres, await etat(a1), (await brut('arts').findOne({ _id: a1 })).viaClasseurs], ['en-attente', 'prive', []]);
        const a2 = await privee(), c2 = await creer(p, 'M6b', [pg([bart(0, 0, a2)])]), c3 = await creer(p, 'M6c', [pg([bart(0, 0, a2), carte(1, 0)])]);
        await publier(p, c2.id); await publier(p, c3.id);
        await C.depublier({ compteId: p.id, id: c2.id });
        const encore = await etat(a2); await C.supprimer({ compteId: p.id, id: c3.id });
        H.v('   citée par DEUX classeurs : le premier retiré la laisse « en-attente » (l\'autre la cite encore), le second (supprimé) la ramène « prive »', [encore, await etat(a2)], ['en-attente', 'prive']);
        const a3 = await privee(), c4 = await creer(p, 'M6d', [pg([bart(0, 0, a3)])]);
        await publier(p, c4.id); await I.publier({ compteId: p.id, pseudo: 'luma', id: a3, corps: CORPS });            // l'auteur la publie LUI-MÊME aussi
        await C.depublier({ compteId: p.id, id: c4.id });
        H.v('   publiée aussi par l\'auteur lui-même : le classeur retiré ne la ramène PAS à « prive »', await etat(a3), 'en-attente');
        const mutL = A.charger('classeurs.js', [["$set: { etat: 'prive', motif: null } }", "$set: { motif: null } }"]]);
        const a4 = await privee(), c5 = await creer(p, 'M6e', [pg([bart(0, 0, a4)])]); await publier(p, c5.id); await mutL.depublier({ compteId: p.id, id: c5.id });
        H.v('   MUTANT « les illustrations ne sont pas rendues » : elle reste « en-attente » (orpheline en modération)', await etat(a4), 'en-attente');
        // m6 : une illustration en COUVERTURE passe en modération comme celles des pages
        const a5 = await privee(), c6 = await creer(p, 'M6f', [pg([carte(0, 0)])], { couverture: { illustration: a5 } });
        await publier(p, c6.id);
        H.v('m6 — l\'illustration de la COUVERTURE passe « en-attente » avec le classeur, et revient « prive » au retrait', [await etat(a5), await (async () => { await C.depublier({ compteId: p.id, id: c6.id }); return etat(a5); })()], ['en-attente', 'prive']);
    }

    // ═══ M8. UNE MISE À JOUR EN ATTENTE NE SURVIT PAS À SA PUBLICATION ═══
    {
        const p = await compte({}, 'm8-orph');
        const monte = async () => {
            const cl = await creer(p, 'M8'); await publier(p, cl.id); await brut('publications').updateOne({ _id: cl.id }, { $set: { etat: 'public', publieLe: new Date() } });
            const d = await brut('classeurs').findOne({ _id: cl.id });
            await C.ecrire({ compteId: p.id, id: cl.id, champs: { titre: 'Autre', etiquettes: [], couleur: null, couverture: null, pages: d.pages }, version: d.version });
            return cl.id;
        };
        const decide = (m, id, decision, motif = 'droits') => m.decider({ id: `pub.${id}`, decision, motif, precision: null, moderateur: { compteId: modo.id, droit: 'moderateur' }, stockage, secret: 's', maintenant: new Date() });
        const id1 = await monte();
        H.v('instrument : une mise à jour attend à côté de la publication publique', await nb('publications', { remplace: id1, etat: 'en-attente' }), 1);
        await decide(svc, id1, 'retirer');
        H.v('M8 — la modération RETIRE la publication : la mise à jour en attente part avec elle (rien d\'orphelin en file)', [(await pub1(id1)).etat, await nb('publications', { remplace: id1 })], ['retire', 0]);
        const mutM = A.charger('service.js', [["if (decision === 'retirer' && type === 'galerie') await coll.deleteMany(", "if (false) await coll.deleteMany("]]);
        const id2 = await monte(); await decide(mutM, id2, 'retirer');
        H.v('   MUTANT « la mise à jour n\'est pas retirée » : elle reste en file, orpheline', await nb('publications', { remplace: id2, etat: 'en-attente' }), 1);
        // une orpheline EXISTANTE sort de la file : acceptée → conflit et la voici refusée ; refusée → refusée
        const pend = (await brut('publications').findOne({ remplace: id2 }))._id;
        const acc = await decide(svc, pend, 'accepter', null);
        H.v('   une orpheline existante : l\'accepter ne remplace rien (conflit) et elle SORT de la file (refusée « publication-retiree ») ; la refuser fonctionne aussi', [Boolean(acc.conflit), (await brut('publications').findOne({ _id: pend })).etat, (await brut('publications').findOne({ _id: pend })).motif.texte], [true, 'refuse', 'publication-retiree']);
        const id3 = await monte(); await brut('publications').deleteOne({ _id: id3 });                    // la publication a disparu, la mise à jour reste
        const pend3 = (await brut('publications').findOne({ remplace: id3 }))._id;
        H.v('   refuser une orpheline dont la publication n\'existe plus : 200 et elle sort de la file', [Boolean((await decide(svc, pend3, 'refuser')).ok), (await brut('publications').findOne({ _id: pend3 })).etat], [true, 'refuse']);
    }

    // ═══ M4. LE REJEU DE finaliser NE POSE QU'UN ART (index unique) ═══
    {
        const p = await compte({}, 'm4-rejeu');
        const d1 = await deposer(sv, p, { nom: 'Rejeu' });
        const objetsAvant = [...stockage.objets.keys()].filter(k => k.startsWith('galerie/attente/')).sort();
        const idx = (await brut('arts').indexes()).find(i => i.name === 'un_art_par_depot');
        H.v('M4 — l\'index unique partiel `un_art_par_depot` existe', [Boolean(idx), Boolean(idx && idx.unique)], [true, true]);
        // la reprise d'un dépôt « en-cours » trop vieux : le dépôt redevient ouvert, l'objet est de nouveau là, on finalise une seconde fois
        const rejouer = async () => {
            await brut('depots').updateOne({ _id: d1.depotId }, { $set: { etat: 'ouvert', priseLe: null } });
            stockage.deposer(d1.ouvert.json.urlDepot, await B.png(300, 419));
            return appel(sv, 'POST', `/api/illustrations/depot/${d1.depotId}/finaliser`, { c: p, corps: { nom: 'Rejeu', format: '1', certifieDroits: true, certifieNonOfficielle: true } });
        };
        const r = await rejouer();
        H.v('   la finalisation REPRISE rend le MÊME art (201), un seul art porte ce dépôt, et les objets de la seconde tentative sont partis', [r.statut, r.json.id === d1.id, await nb('arts', { depotId: d1.depotId }), [...stockage.objets.keys()].filter(k => k.startsWith('galerie/attente/')).sort()], [201, true, 1, objetsAvant]);
        await brut('arts').dropIndex('un_art_par_depot');
        const r2 = await rejouer();
        H.v('   MUTANT « sans l\'index » : le même rejeu pose un SECOND art pour le même dépôt', [r2.statut, await nb('arts', { depotId: d1.depotId })], [201, 2]);
        await brut('arts').deleteOne({ _id: r2.json.id }); await G.creerIndex();
    }

    // ═══ M5. LES INDEX ═══
    {
        const noms = async n => (await brut(n).indexes()).map(i => i.name);
        H.v('M5 — votes { cible } et depots { artId } sont indexés', [(await noms('votes')).includes('votes_de_la_cible'), (await noms('depots')).includes('depot_de_l_art')], [true, true]);
    }

    // ═══ m4. UN ART DEVENU PUBLIC ENTRE LA LECTURE ET L'ÉCRITURE N'EST PAS RETOUCHÉ (titre, artiste) ═══
    {
        const p = await compte({}, 'm4-texte');
        const scene = async (m) => {
            const a = await artPublic(p, { etat: 'prive', publieLe: null, nom: 'Avant' });
            const r = await avec('arts', 'findOneAndUpdate', () => brut('arts').updateOne({ _id: a }, { $set: { etat: 'public', publieLe: new Date() } }), () => m.modifier({ compteId: p.id, id: a, corps: { titre: 'Après' } }));
            return [Boolean(r.conflit), (await brut('arts').findOne({ _id: a })).nom];
        };
        const mutT = A.charger('illustrations.js', [["{ _id: id, auteurId: mien, ...(texte ? { etat: { $ne: 'public' } } : {}) }", "{ _id: id, auteurId: mien }"]]);
        H.v('m4 — l\'art devient public pendant la modification du titre : 409 etat, titre inchangé ; MUTANT sans l\'état dans le filtre : le titre jugé est réécrit', [await scene(I), await scene(mutT)], [[true, 'Avant'], [false, 'Après']]);
    }

    // ═══ m5. LA LISTE N'EST JAMAIS TRONQUÉE À 200 ═══
    {
        const p = await compte({}, 'm5-liste'), docs = Array.from({ length: 250 }, () => { const id = F.nouvelId(); return { _id: id, auteurId: p.id, pseudo: 'm5-liste', nom: 'Bulk', mots: ['bulk'], fmt: '1', largeur: 300, hauteur: 419, couleur: '#000000', poids: 1, cle: `galerie/attente/${id}`, clePublique: `galerie/pub/${id}`, etat: 'prive', recuLe: new Date(), creeLe: new Date(), publieLe: null, nbJaime: 0, nbEnregistre: 0, motif: null, certification: null, depotId: null }; });
        await brut('arts').insertMany(docs);
        H.v('m5 — 250 illustrations stockées (borne réglée à 1 000) : la liste les rend toutes', (await I.lister({ compteId: p.id })).length, 250);
    }

    // ═══ m7. UN PUT IDENTIQUE SUR UN CLASSEUR PUBLIC NE MET RIEN EN FILE ═══
    {
        const p = await compte({}, 'm7-identique');
        const cl = await creer(p, 'Public'); await publier(p, cl.id); await brut('publications').updateOne({ _id: cl.id }, { $set: { etat: 'public', publieLe: new Date() } });
        const put = async (titre) => { const d = await brut('classeurs').findOne({ _id: cl.id }); return C.ecrire({ compteId: p.id, id: cl.id, champs: { titre, etiquettes: d.etiquettes, couleur: d.couleur, couverture: d.couverture, pages: d.pages }, version: d.version }); };
        await put('Public');
        H.v('m7 — un PUT identique à la version publique : aucune mise à jour en file, le classeur se lit « public »', [await nb('publications', { remplace: cl.id }), (await C.lire({ id: cl.id, compteId: p.id })).classeur.visibilite], [0, 'public']);
        await put('Changé');
        const apres = await nb('publications', { remplace: cl.id });
        await put('Public');
        H.v('   un PUT qui change : une mise à jour (1) ; le remettre à l\'identique la retire (0)', [apres, await nb('publications', { remplace: cl.id })], [1, 0]);
    }

    // ═══ m8. V2_PUBLICATIONS_JOUR : LECTURE BORNÉE ═══
    {
        const { lireGalerie } = require('../galerie/config'), avecV = x => lireGalerie({ ...A.ENV_VALIDE, ...x });
        H.v('m8 — défaut 5 ; « 7 » lu ; illisible, 0, 1001, vide d\'espaces : le lot ne se monte pas et la raison NOMME la variable', [avecV({}).limites.publicationsCompteJour, avecV({ V2_PUBLICATIONS_JOUR: '7' }).limites.publicationsCompteJour,
            ...['beaucoup', '0', '1001', '  '].map(v => { const c = avecV({ V2_PUBLICATIONS_JOUR: v }); return [c.pret, /V2_PUBLICATIONS_JOUR/.test(c.raison || '')]; })], [5, 7, [false, true], [false, true], [false, true], [false, true]]);
    }

    await B.fermer();
    H.bilan();
})();
