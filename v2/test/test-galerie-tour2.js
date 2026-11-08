'use strict';
// GALERIE — TOUR 2 de correction (relectures ciblées de L9 et L10). Chaque point est joué sur le code réel ET sur une COPIE MUTÉE du module (le fragment retiré du TEXTE) : le banc doit changer de résultat.
//   M1 contrôle APRÈS les marquages d'illustrations · M2 libération par la marque `viaClasseurs` sans publication · M3 mise à jour obsolète non recréée · m1 premières réservations simultanées · m2 état « echec » ·
//   m3 pas de place pour un remplacement · m4 gardes de libererIllustrations, RENDER_SERVICE_ID, `compte`, auteurId · borne ATTEINTE sous concurrence.
const A = require('./_aide-galerie');
const H = A.H;

(async () => {
    const B = await A.outillerBanc('test-galerie-tour2.js');
    const { G, F, compte, brut, artPublic, stockage } = B;
    const C = require('../galerie/classeurs'), I = require('../galerie/illustrations'), Q = require('../galerie/quota-publications'), D = require('../galerie/depot');
    const carte = (c, r, cle = '1234|001') => ({ c, r, l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle, setSlug: 'Base-Set' } });
    const bart = (c, r, artId) => ({ c, r, l: 1, h: 1, genre: 'art', contenu: { type: 'art', artId } });
    const pg = (blocs = [], nb = 9) => ({ nb, blocs });
    const CORPS = { certifieAuteur: true, cgu: '2026-10' };
    const creer = async (c, titre = 'T', pages = [pg([carte(0, 0)])], extra = {}) => (await C.creer({ compteId: c.id, champs: { titre, etiquettes: [], couleur: null, couverture: null, pages, ...extra }, max: 50 })).classeur;
    const publier = (c, id, m = C, plus = {}) => m.publier({ compteId: c.id, pseudo: c.pseudo, id, corps: CORPS, ...plus });
    const etat = async id => (await brut('arts').findOne({ _id: id })).etat;
    const privee = p => artPublic(p, { etat: 'prive', publieLe: null });
    const nb = (coll, f) => brut(coll).countDocuments(f);
    async function avec(nom, op, evt, fn, toujours = null) {
        const col0 = G.col; let declenche = false;
        G.col = n => { const c = col0(n); if (n !== nom) return c; return new Proxy(c, { get(t, k) { if (k === op) return async (...a) => { if (toujours) return toujours(...a); if (!declenche) { declenche = true; await evt(); } return t[op](...a); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }); };
        try { return await fn(); } finally { G.col = col0; }
    }

    // ═══ M1. LE CLASSEUR EST CONTRÔLÉ AUSSI APRÈS LES MARQUAGES D'ILLUSTRATIONS ═══
    {
        const p = await compte({}, 't2-m1');
        const scene = async m => {
            const a = await privee(p), cl = await creer(p, 'M1', [pg([bart(0, 0, a), carte(1, 0)])]);
            const r = await avec('arts', 'updateMany', () => brut('classeurs').deleteOne({ _id: cl.id }), () => publier(p, cl.id, m));
            return [r.introuvable === true, await etat(a), (await brut('arts').findOne({ _id: a })).viaClasseurs || [], await nb('publications', { _id: cl.id })];
        };
        const mut = A.charger('classeurs.js', [["if (!(await G.col('classeurs').findOne({ _id: id, auteurId: mien }, { projection: { _id: 1 } }))) { await retirerPublication", "if (false) { await retirerPublication"]]);
        H.v('M1 — le classeur est supprimé ENTRE le contrôle et les marquages : introuvable, l\'illustration redevient privée, aucune marque ni publication orpheline', await scene(C), [true, 'prive', [], 0]);
        H.v('   MUTANT « pas de contrôle après les marquages » : l\'illustration reste « en-attente » marquée d\'un classeur supprimé', (await scene(mut)).slice(1, 3), ['en-attente', [(await brut('arts').find({ viaClasseurs: { $exists: true, $ne: [] } }).sort({ _id: -1 }).limit(1).toArray())[0].viaClasseurs[0]]]);
    }

    // ═══ M2. LA LIBÉRATION RETROUVE LES ARTS PAR LEUR MARQUE, MÊME SANS PUBLICATION ═══
    {
        const p = await compte({}, 't2-m2');
        const scene = async m => {
            const a = await privee(p), cl = await creer(p, 'M2', [pg([bart(0, 0, a), carte(1, 0)])]);
            await publier(p, cl.id); await brut('publications').deleteOne({ _id: cl.id });               // la publication a déjà disparu
            await m.supprimer({ compteId: p.id, id: cl.id });
            return etat(a);
        };
        const mut = A.charger('classeurs.js', [[", ...marques.map(a => a._id)]);", "]);"]]);
        H.v('M2 — publication déjà disparue : supprimer le classeur ramène quand même l\'illustration marquée à « prive » ; MUTANT « on ne cherche que par les publications » : elle reste « en-attente »', [await scene(C), await scene(mut)], ['prive', 'en-attente']);
    }

    // ═══ M3. UN PUT PLUS ANCIEN NE RECRÉE PAS UNE MISE À JOUR OBSOLÈTE ═══
    {
        const p = await compte({}, 't2-m3');
        const scene = async m => {
            const cl = await creer(p, 'Orig'); await publier(p, cl.id); await brut('publications').updateOne({ _id: cl.id }, { $set: { etat: 'public', publieLe: new Date() } });
            const d1 = await brut('classeurs').findOne({ _id: cl.id });
            await C.ecrire({ compteId: p.id, id: cl.id, champs: { titre: 'B', etiquettes: [], couleur: null, couverture: null, pages: d1.pages }, version: d1.version });      // v2 : une mise à jour attend
            const d2 = await brut('classeurs').findOne({ _id: cl.id });
            await C.ecrire({ compteId: p.id, id: cl.id, champs: { titre: 'Orig', etiquettes: [], couleur: null, couverture: null, pages: d1.pages }, version: d2.version });  // v3 : identique à la version publique, la mise à jour est retirée
            const avant = await nb('publications', { remplace: cl.id });
            await m.synchroniser({ ...d2, titre: 'B' }, new Date());                                         // le PUT v2, arrivé en retard
            return [avant, await nb('publications', { remplace: cl.id })];
        };
        const mut = A.charger('classeurs.js', [["if (!courant || courant.version > snap.versionClasseur) return;", "if (false) return;"]]);
        H.v('M3 — le PUT v2 arrive après le PUT v3 identique : aucune mise à jour obsolète ; MUTANT sans relecture de la version courante : elle est recréée', [await scene(C), await scene(mut)], [[0, 0], [0, 1]]);
    }

    // ═══ m1. DEUX PREMIÈRES RÉSERVATIONS SIMULTANÉES NE REFUSENT PAS À TORT ═══
    {
        const mut = A.charger('quota-publications.js', [["return pris ? { permis: true } :", "return false ? { permis: true } :"]]);
        const faux = async m => { let refus = 0; for (let i = 0; i < 25; i++) { const c = await compte({}, 't2-q' + i + Math.random().toString(36).slice(2, 5)), q = m.creer({ max: 2, maintenant: () => new Date() }); const rs = await Promise.all([q.reserver(c.id), q.reserver(c.id)]); refus += rs.filter(r => !r.permis).length; } return refus; };
        const reel = await faux(Q), muté = await faux(mut);
        H.v('m1 — 25 couples de premières réservations simultanées pour 2 places : aucun refus à tort ; MUTANT sans le réessai : au moins un refus à tort', [reel, muté > 0], [0, true]);
    }

    // ═══ m2. QUATRE ESSAIS SANS ÉCRIRE : « echec » EXPLICITE ET PLACE RENDUE ═══
    {
        const p = await compte({}, 't2-m2echec');
        const scene = async m => {
            const cl = await creer(p, 'Echec'); await publier(p, cl.id); await brut('publications').updateOne({ _id: cl.id }, { $set: { etat: 'refuse', motif: { code: 'autre', texte: '' } } });
            let pris = 0, rendu = 0;
            const r = await avec('publications', 'updateOne', null, () => publier(p, cl.id, m, { reserver: async () => { pris++; return { permis: true }; }, rendre: async () => { rendu++; } }), async () => ({ matchedCount: 0 }));
            return [Boolean(r.indispo), Boolean(r.ok), pris, rendu];
        };
        const mut = A.charger('classeurs.js', [["return 'echec';", "return 'ecrite';"]]);
        H.v('m2 — l\'état change sans cesse (aucune écriture en 4 essais) : indispo explicite, la place prise est RENDUE ; MUTANT « écrite » : la publication est annoncée faite sans l\'être', [await scene(C), await scene(mut)], [[true, false, 1, 1], [false, true, 1, 0]]);
    }

    // ═══ m3. REMPLACER UNE MISE À JOUR EN ATTENTE NE PREND PAS DE PLACE ═══
    {
        const p = await compte({}, 't2-m3q');
        const scene = async (m, avecAttente) => {
            const cl = await creer(p, 'Q'); await publier(p, cl.id); await brut('publications').updateOne({ _id: cl.id }, { $set: { etat: 'public', publieLe: new Date() } });
            if (avecAttente) await brut('publications').insertOne({ _id: F.nouvelId(), remplace: cl.id, auteurId: p.id, pseudo: p.pseudo, etat: 'en-attente', titre: 'x', versionClasseur: 1, pagesBlocs: [], recuLe: new Date() });
            let pris = 0; await publier(p, cl.id, m, { reserver: async () => { pris++; return { permis: true }; }, rendre: async () => { } });
            return pris;
        };
        const mut = A.charger('classeurs.js', [["const compte = !main || (main.etat !== 'en-attente' && !attente);", "const compte = true;"]]);
        H.v('m3 — republier un classeur public qui a déjà une mise à jour en attente : aucune place ; sans mise à jour en attente : une place ; MUTANT « toujours compté » : une place dans les deux cas', [await scene(C, true), await scene(C, false), await scene(mut, true)], [0, 1, 1]);
        // une copie encore EN ATTENTE qu'on remplace ne compte pas non plus
        const cl2 = await creer(p, 'Q2'); await publier(p, cl2.id); let pris2 = 0; await publier(p, cl2.id, C, { reserver: async () => { pris2++; return { permis: true }; }, rendre: async () => { } });
        const mut2 = A.charger('classeurs.js', [["const compte = !main || (main.etat !== 'en-attente' && !attente);", "const compte = true;"]]); let pris3 = 0; await publier(p, cl2.id, mut2, { reserver: async () => { pris3++; return { permis: true }; }, rendre: async () => { } });
        H.v('   une copie déjà EN ATTENTE qu\'on remplace : aucune place ; MUTANT : une place', [pris2, pris3], [0, 1]);
    }

    // ═══ m4. LES GARDES DE libererIllustrations ═══
    {
        const p = await compte({}, 't2-lib');
        const sansTaille = A.charger('classeurs.js', [["viaClasseurs: { $size: 0 }, publieeParAuteur: { $ne: true } }", "publieeParAuteur: { $ne: true } }"]]);
        const sansAuteur = A.charger('classeurs.js', [["viaClasseurs: { $size: 0 }, publieeParAuteur: { $ne: true } }", "viaClasseurs: { $size: 0 } }"]]);
        const deux = async m => {
            const a = await privee(p), c1 = await creer(p, 'L1', [pg([bart(0, 0, a)])]), c2 = await creer(p, 'L2', [pg([bart(0, 0, a), carte(1, 0)])]);
            await publier(p, c1.id); await publier(p, c2.id); await m.depublier({ compteId: p.id, id: c1.id });
            return etat(a);
        };
        const soi = async m => {
            const a = await privee(p), c1 = await creer(p, 'L3', [pg([bart(0, 0, a)])]);
            await publier(p, c1.id); await I.publier({ compteId: p.id, pseudo: p.pseudo, id: a, corps: CORPS }); await m.depublier({ compteId: p.id, id: c1.id });
            return etat(a);
        };
        H.v('m4 — deux classeurs citent l\'art : retirer l\'un la laisse « en-attente » ; MUTANT sans `$size: 0` : elle redevient privée sous l\'autre classeur', [await deux(C), await deux(sansTaille)], ['en-attente', 'prive']);
        H.v('   publiée aussi par l\'auteur : le classeur retiré ne la ramène pas ; MUTANT sans `publieeParAuteur` : elle redevient privée', [await soi(C), await soi(sansAuteur)], ['en-attente', 'prive']);

        // auteurId des filtres d'écriture : on fabrique une publication dont l'auteur n'est pas l'appelant (donnée incohérente) ; le réel n'y touche pas
        const dep = async m => { const cl = await creer(p, 'Aut'); await brut('publications').insertOne({ _id: cl.id, auteurId: 'autre', pseudo: 'autre', etat: 'en-attente', titre: 'X', pagesBlocs: [], recuLe: new Date() }); await m.depublier({ compteId: p.id, id: cl.id }); return nb('publications', { _id: cl.id }); };
        const mutDep = A.charger('classeurs.js', [["{ _id: { $in: aSupprimer }, auteurId }", "{ _id: { $in: aSupprimer } }"]]);
        H.v('   auteurId du filtre de suppression : une publication d\'un AUTRE auteur n\'est pas effacée ; MUTANT : effacée', [await dep(C), await dep(mutDep)], [1, 0]);
        const ecr = async m => { const cl = await creer(p, 'Aut2'); await brut('publications').insertOne({ _id: cl.id, auteurId: 'autre', pseudo: 'autre', etat: 'refuse', titre: 'X', pagesBlocs: [], recuLe: new Date() }); const r = await publier(p, cl.id, m); return [Boolean(r.indispo), (await brut('publications').findOne({ _id: cl.id })).titre]; };
        const mutEcr = A.charger('classeurs.js', [["{ _id: id, auteurId: mien, etat: main.etat, versionClasseur", "{ _id: id, etat: main.etat, versionClasseur"]]);
        H.v('   auteurId du filtre d\'écriture : la publication d\'un AUTRE auteur n\'est pas réécrite (indispo, titre inchangé) ; MUTANT : réécrite', [await ecr(C), (await ecr(mutEcr))[1]], [[true, 'X'], 'Aut2']);
        const supr = async m => { const a = await privee(p); await avec('arts', 'deleteOne', () => brut('arts').updateOne({ _id: a }, { $set: { auteurId: 'autre' } }), () => m.supprimer({ compteId: p.id, id: a, stockage })); return nb('arts', { _id: a }); };
        const mutSup = A.charger('illustrations.js', [["deleteOne({ _id: id, auteurId: mien })", "deleteOne({ _id: id })"]]);
        H.v('   auteurId de la suppression d\'une illustration : si l\'art change de main entre-temps il n\'est pas supprimé ; MUTANT : supprimé', [await supr(I), await supr(mutSup)], [1, 0]);

        // RENDER_SERVICE_ID muté SEUL
        const { SERVICE_ESSAI } = require('../config'), { lireGalerie } = require('../galerie/config'), k = '1x0000000000000000000000000000000AA';
        const env = { ...A.ENV_VALIDE, V2_GALERIE_TURNSTILE_SECRET: k, V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-autre' };
        const mutS = A.charger('config.js', [["env.RENDER_SERVICE_ID === require('../config').SERVICE_ESSAI", "true"]]);
        H.v('   M9 — essai sur un AUTRE service : refusé ; MUTANT « RENDER_SERVICE_ID n\'est plus comparé » : admis (le service de l\'essai : admis dans les deux cas)', [lireGalerie(env).pret, mutS.lireGalerie(env).pret, lireGalerie({ ...env, RENDER_SERVICE_ID: SERVICE_ESSAI }).pret], [false, true, true]);
    }

    // ═══ LA BORNE EST ATTEINTE sous concurrence (et pas seulement jamais dépassée) ═══
    {
        const tard = (i, f) => new Promise(r => setTimeout(r, i * 25)).then(f);
        const classeurs = async (m, n, max) => { const p = await compte({}, 't2-b' + Math.random().toString(36).slice(2, 6)); await Promise.all(Array.from({ length: n }, (_, i) => tard(i, () => m.creer({ compteId: p.id, champs: { titre: 'X', etiquettes: [], couleur: null, couverture: null, pages: [pg([carte(0, 0)])] }, max })))); return nb('classeurs', { auteurId: p.id }); };
        const mutB = A.charger('classeurs.js', [["> max) { await G.col('classeurs').deleteOne", "> 1e9) { await G.col('classeurs').deleteOne"]]);
        H.v('borne — 8 créations décalées de 25 ms sous une borne de 3 : EXACTEMENT 3 classeurs (la borne est atteinte, pas dépassée) ; MUTANT « sans contrôle a posteriori » : 8', [await classeurs(C, 8, 3), await classeurs(mutB, 8, 3)], [3, 8]);
        const depots = async (m, n, max) => { const p = await compte({}, 't2-d' + Math.random().toString(36).slice(2, 6)); await Promise.all(Array.from({ length: n }, (_, i) => tard(i, () => m.ouvrirDepot({ compteId: p.id, ref: 'refcompte0002', type: 'image/png', octets: 1000, bornes: { octetsMax: 8e6, pixelsMax: 12e6, illustrationsMax: max }, stockage })))); return nb('depots', { compteId: p.id }); };
        const mutD = A.charger('depot.js', [["> bornes.illustrationsMax) { await G.col('depots').deleteOne", "> 1e9) { await G.col('depots').deleteOne"]]);
        H.v('   6 dépôts décalés sous une borne de 2 : EXACTEMENT 2 dépôts ouverts', await depots(D, 6, 2), 2);
        void mutD;
    }

    await B.fermer();
    H.bilan();
})();
