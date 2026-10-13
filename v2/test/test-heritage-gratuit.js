'use strict';
// Lot HERITAGE-GRATUIT (D7, option b) : le gratuit hérité d'un userId est PLAFONNÉ à la dotation normale d'une installation (quotas.essai) et COMPTÉ
// dans le plafond global (limites.essaisGlobauxJour). Les deux scénarios de la relecture MOYENS-A sont JOUÉS ici avec le vrai code (service + héritage) :
//   · victime : le userId hérité d'une victime (fuite dans les journaux) porte 25 gratuits => l'attaquant les prend ;
//   · userId neuf : un userId inventé, vu une fois par la route héritée (acces.js : $setOnInsert soldeGratuit 25, puis -1 au premier scan) => 24.
// Les crédits ACHETÉS (soldeScans) ne bougent pas ici : prouvé plus bas.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const He = require('../argent/heritage'); const S = require('../installations/service');
const { inst, lire } = require('./_aide-argent');
const jour = n => new Date(Date.UTC(2026, 0, n, 12, 0, 0));          // un jour par scénario : le compteur global (fenêtre de 24 h) ne se partage jamais
const compteurGlobal = async d => (await db.col('limites').findOne({ cle: `essais-globaux|${Math.floor(d.getTime() / 86400e3) * 86400e3}` }))?.n ?? 0;
const wallet = (userId, o = {}) => db.col('credits').insertOne({ userId, soldeGratuit: 0, soldeScans: 0, email: null, ...o });
const muet = async f => { const w = console.warn, l = console.log; console.warn = () => { }; console.log = () => { }; try { return await f(); } finally { console.warn = w; console.log = l; } };
(async () => {
    await H.ouvrirBac('test-heritage-gratuit.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    H.v('contrôle de l\'instrument : dotation d\'une installation (quotas.essai) = 3, accueil = 25, plafond global = 500', [cfg.quotas.essai, cfg.quotas.accueil, cfg.limites.essaisGlobauxJour], [3, 25, 500]);

    // 1. SCÉNARIO VICTIME : 25 gratuits sur le userId d'une victime, présenté par un tiers à une installation neuve
    const d1 = jour(1);
    await wallet('victime-userid-0001', { soldeGratuit: 25 });
    const a = await S.creerInstallation({ libelle: 'attaquant', cfg, maintenant: d1 });
    H.v('(1) installation neuve : 3 essais', a.installation.essais, 3);
    const r1 = await muet(() => He.reprendreHeritage({ userId: 'victime-userid-0001', installation: a.installation, maintenant: d1 }, cfg));
    H.v('(1) VICTIME 25 gratuits : l\'attaquant ne dépasse jamais la dotation normale (3), pas 25', [r1.ok, (await db.col('installations').findOne({ _id: a.installation._id })).essais], [true, 3]);
    H.v('(1)    le gratuit de la victime est quand même DÉPLACÉ (0, migreVers posé) : l\'ancien client ne le dépense pas deux fois', [(await db.col('credits').findOne({ userId: 'victime-userid-0001' })).soldeGratuit, (await db.col('credits').findOne({ userId: 'victime-userid-0001' })).migreVers !== undefined], [0, true]);
    H.v('(1)    aucun mouvement d\'essai hérité (rien n\'a été ajouté)', await db.col('mouvements').countDocuments({ installationId: a.installation._id, motif: 'heritage-1.0' }), 0);

    // 2. SCÉNARIO userId NEUF : 25 posés par la route héritée, 1 consommé => 24
    const d2 = jour(2);
    await wallet('inventé-par-un-tiers', { soldeGratuit: 24 });
    const b = await S.creerInstallation({ libelle: 'tiers', cfg, maintenant: d2 });
    await muet(() => He.reprendreHeritage({ userId: 'inventé-par-un-tiers', installation: b.installation, maintenant: d2 }, cfg));
    H.v('(2) userId neuf à 24 : une installation héritée n\'a pas plus qu\'une installation neuve (3)', (await db.col('installations').findOne({ _id: b.installation._id })).essais, 3);

    // 3. le PLAFOND GLOBAL épuisé : l'installation naît à 0 essai ; l'héritage ne le contourne pas
    const d3 = jour(3), cfg3 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '1' });
    await S.creerInstallation({ libelle: 'premier', cfg: cfg3, maintenant: d3 });                               // consomme l'unique unité
    const c = await S.creerInstallation({ libelle: 'ferme', cfg: cfg3, maintenant: d3 });
    await wallet('victime-plafond', { soldeGratuit: 25 });
    H.v('(3) contrôle de l\'instrument : plafond épuisé => installation à 0 essai', c.installation.essais, 0);
    const r3 = await muet(() => He.reprendreHeritage({ userId: 'victime-plafond', installation: c.installation, maintenant: d3 }, cfg3));
    const cred3 = await db.col('credits').findOne({ userId: 'victime-plafond' });
    H.v('(3) plafond global épuisé : l\'héritage refuse, 0 essai, jamais 25', [r3.ok, r3.raison, (await db.col('installations').findOne({ _id: c.installation._id })).essais], [false, 'plafond-global', 0]);
    H.v('(3)    le refus ne consomme pas le portefeuille (gratuit intact, pas de migreVers) : l\'ayant droit pourra réessayer demain', [cred3.soldeGratuit, cred3.migreVers === undefined], [25, true]);
    H.v('(3)    aucune empreinte posée sur l\'installation (elle peut encore hériter)', (await db.col('installations').findOne({ _id: c.installation._id })).heriteEmpreinte ?? null, null);

    // 4. plafond global NON épuisé, installation à 0 : l'essai hérité est repris (3) ET compté (1 unité de plus)
    const d4 = jour(4);
    await wallet('legitime-4', { soldeGratuit: 25 });
    const p4 = await inst({ essais: 0 });
    const n4 = await compteurGlobal(d4);
    const r4 = await muet(() => He.reprendreHeritage({ userId: 'legitime-4', installation: p4.installation, maintenant: d4 }, cfg));
    H.v('(4) installation à 0 essai, plafond libre : 3 essais repris (la dotation normale)', [r4.ok, (await lire(p4)).essais], [true, 3]);
    H.v('(4)    ET le plafond global compte l\'unité (n +1)', (await compteurGlobal(d4)) - n4, 1);

    // 5. le cas ordinaire (installation déjà à 3) ne brûle AUCUNE unité du plafond global
    const d5 = jour(5);
    await wallet('ordinaire-5', { soldeGratuit: 25 });
    const p5 = await S.creerInstallation({ libelle: 'ordinaire', cfg, maintenant: d5 });
    const n5 = await compteurGlobal(d5);
    await muet(() => He.reprendreHeritage({ userId: 'ordinaire-5', installation: p5.installation, maintenant: d5 }, cfg));
    H.v('(5) installation déjà dotée : l\'héritage ne consomme pas de seconde unité du plafond global', (await compteurGlobal(d5)) - n5, 0);

    // 6. gratuit < dotation : comportement conservé (on reprend ce qui reste, sans dépasser)
    const d6 = jour(6);
    await wallet('petit-6', { soldeGratuit: 1 });
    const p6 = await inst({ essais: 3 });
    await muet(() => He.reprendreHeritage({ userId: 'petit-6', installation: p6.installation, maintenant: d6 }, cfg));
    H.v('(6) gratuit 1 < dotation : 1 essai (comportement d\'avant conservé)', (await lire(p6)).essais, 1);

    // 7. course : 10 installations à 0 essai, 10 portefeuilles distincts, plafond restant 4 => au plus 4 reprises
    const d7 = jour(7), cfg7 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '4' });
    const ps = []; for (let k = 0; k < 10; k++) { await wallet(`course-7-${k}`, { soldeGratuit: 25 }); ps.push(await inst({ essais: 0 })); }
    const rs = await muet(() => Promise.all(ps.map((p, k) => He.reprendreHeritage({ userId: `course-7-${k}`, installation: p.installation, maintenant: d7 }, cfg7))));
    const finals = await Promise.all(ps.map(lire));
    H.v('(7) 10 reprises simultanées, plafond global 4 : exactement 4 acceptées (dénominateur 10)', [rs.filter(r => r.ok).length, rs.filter(r => !r.ok && r.raison === 'plafond-global').length], [4, 6]);
    H.v('(7)    la somme des essais obtenus = 4 x 3 = 12, aucun à 25', [finals.reduce((s, i) => s + i.essais, 0), Math.max(...finals.map(i => i.essais))], [12, 3]);
    H.v('(7)    les 6 refusées gardent leur gratuit (25) : le refus ne détruit rien', await db.col('credits').countDocuments({ userId: /^course-7-/, soldeGratuit: 25, migreVers: { $exists: false } }), 6);

    // 8. les crédits ACHETÉS hérités ne changent pas : ni plafonnés, ni comptés, ni déplacés par la reprise du gratuit
    const d8 = jour(8);
    await wallet('acheteur-8', { soldeGratuit: 25, soldeScans: 160, email: 'acheteur8@exemple.fr' });
    const p8 = await S.creerInstallation({ libelle: 'a8', cfg, maintenant: d8 });
    const n8 = await compteurGlobal(d8);
    await muet(() => He.reprendreHeritage({ userId: 'acheteur-8', installation: p8.installation, maintenant: d8 }, cfg));
    const c8 = await db.col('credits').findOne({ userId: 'acheteur-8' }), i8 = await db.col('installations').findOne({ _id: p8.installation._id });
    H.v('(8) achetés : soldeScans intact (160), pas d\'achatsMigresVers, installation.achete intact (0)', [c8.soldeScans, c8.achatsMigresVers === undefined, i8.achete ?? 0], [160, true, 0]);
    H.v('(8)    et aucune unité du plafond global consommée par les achetés', (await compteurGlobal(d8)) - n8, 0);
    // 9. la course lecture / prise : le portefeuille était à 0 à la lecture (aucune unité du plafond demandée), puis un remboursement de la route héritée le remonte à 25 avant la prise.
    //    (Le remboursement est joué DANS la session de la transaction : un écrit extérieur ferait rejouer le corps par withTransaction, qui relirait 25 et paierait l'unité — ce qui est correct mais ne prouve pas la branche.)
    //    Sans unité du plafond payée, l'héritage n'ÉLÈVE jamais les essais (le gratuit, lui, est déplacé : il ne se dépense pas deux fois).
    const d9 = jour(9);
    await wallet('course-lecture-9', { soldeGratuit: 0 });
    const p9 = await inst({ essais: 0 }), n9 = await compteurGlobal(d9);
    const colReelle = db.col;
    db.col = nom => {
        const c = colReelle(nom);
        if (nom !== 'credits') return c;
        return new Proxy(c, { get: (cible, k) => k !== 'findOneAndUpdate' ? (typeof cible[k] === 'function' ? cible[k].bind(cible) : cible[k])
            : async (...a) => { await cible.updateOne({ userId: 'course-lecture-9' }, { $set: { soldeGratuit: 25 } }, { session: a[2] && a[2].session }); return cible.findOneAndUpdate(...a); } });
    };
    let r9; try { r9 = await muet(() => He.reprendreHeritage({ userId: 'course-lecture-9', installation: p9.installation, maintenant: d9 }, cfg)); } finally { db.col = colReelle; }
    H.v('(9) solde remonté entre la lecture et la prise, aucune unité payée : les essais ne sont PAS élevés (0), aucune unité consommée', [r9.ok, (await lire(p9)).essais, (await compteurGlobal(d9)) - n9], [true, 0, 0]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
