'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const { semaineISO } = require('../../acces'); const { RAISONS_NON_REMBOURSE } = require('../../sources');
const Lg = require('../argent/ledger'); const S = require('../argent/solde'); const Lot = require('../argent/lot'); const F = require('../argent/facturation');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });                 // hebdo 2
const cfg0 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
const sous = (o, ref) => Object.fromEntries(Object.keys(ref).map(k => [k, o[k]]));
(async () => {
    await H.ouvrirBac('test-argent-solde.js'); await M.creerIndex();
    // 1. installation non liée à 3 essais
    const pi = await inst();
    const s1 = await S.solde(pi, cfg, t);
    H.v('installation non liée : 3 essais', sous(s1, { total: 0, essai: 0, accueil: 0, hebdo: 0, achete: 0, hebdoMax: 0, prochainHebdo: 0, compte: 0 }),
        { total: 3, essai: 3, accueil: 0, hebdo: 0, achete: 0, hebdoMax: 0, prochainHebdo: null, compte: { lie: false, emailMasque: null, verifie: false } });
    H.v('   partage true, abonnement null', [s1.partage, s1.abonnement], [true, null]);
    // 2. compte vérifié : 17 accueil, 1 hebdo consommé sur 2, 3 achetés
    const pc = await compte({ email: 'vincent@exemple.fr', solde: { accueil: 17, achete: 3 } });
    await db.col('hebdo').insertOne({ compteId: pc.id, semaine: semaineISO(t), count: 1, expireLe: new Date('2026-12-01') });
    const s2 = await S.solde(pc, cfg, t);
    H.v('compte vérifié : 17 + 1 + 3', sous(s2, { total: 0, accueil: 0, hebdo: 0, achete: 0, hebdoMax: 0, prochainHebdo: 0, essai: 0 }), { total: 21, accueil: 17, hebdo: 1, achete: 3, hebdoMax: 2, prochainHebdo: '2026-10-12', essai: 0 });
    // 4. e-mail masqué
    H.v('emailMasque', s2.compte, { lie: true, emailMasque: 'v•••@exemple.fr', verifie: true });
    // 3. NON vérifié => accueil 0 et hebdo 0 même si la base dit autre chose
    const pn = await compte({ verifie: false, solde: { accueil: 25, achete: 4 } });
    const s3 = await S.solde(pn, cfg, t);
    H.v('compte NON vérifié : accueil 0, hebdo 0, achetés gardés', sous(s3, { total: 0, accueil: 0, hebdo: 0, achete: 0 }), { total: 4, accueil: 0, hebdo: 0, achete: 4 });
    // 5. total = somme des poches utilisables, réserves déjà retirées
    const pd = await compte({ solde: { accueil: 2, achete: 0 } }); await Lg.debiter(pd, { scanId: 'x', cleIdempotence: 'x1', maintenant: t }, cfg0);
    H.v('après un débit, le total est en moins (2 → 1)', (await S.solde(pd, cfg0, t)).total, 1);
    // 6. abonnement
    const pa = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 100, moisCle: '2026-10', restant: 40, jusquAu: new Date('2027-01-01') } });
    const s6 = await S.solde(pa, cfg0, t);
    H.v('abonnement actif', [s6.abonnement, s6.total], [{ restant: 40, quotaMensuel: 100, renouvelleLe: '2026-11-01' }, 40]);
    const s6b = await S.solde(pa, cfg0, new Date('2026-11-03T00:00:00Z'));
    H.v('   le mois a changé sans débit : restant annoncé = quotaMensuel', [s6b.abonnement.restant, s6b.abonnement.renouvelleLe], [100, '2026-12-01']);
    const pe = await compte({ solde: { accueil: 0, achete: 5 }, abonnement: { actif: true, quotaMensuel: 100, moisCle: '2026-10', restant: 40, jusquAu: new Date('2026-10-01') } });
    const s6c = await S.solde(pe, cfg0, t);
    H.v('   abonnement échu : null et hors du total', [s6c.abonnement, s6c.total], [null, 5]);
    const pz = await compte({ solde: { accueil: 0, achete: 5 }, abonnement: { actif: false, quotaMensuel: 100, moisCle: '2026-10', restant: 40, jusquAu: new Date('2027-01-01') } });
    H.v('   abonnement inactif : null', (await S.solde(pz, cfg0, t)).abonnement, null);
    const pdec = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 100, moisCle: '2026-12', restant: 40, jusquAu: new Date('2027-06-01') } });
    H.v('   décembre : le renouvellement passe à janvier de l\'année suivante', (await S.solde(pdec, cfg0, new Date('2026-12-15T00:00:00Z'))).abonnement.renouvelleLe, '2027-01-01');
    // 7. coût d'un lot
    H.v('coutDuLot 1,10,11,20,21,0', [1, 10, 11, 20, 21, 0].map(n => Lot.coutDuLot(n, cfg)), [1, 1, 2, 2, 3, 1]);
    // 8. facturation : motifs fermés
    H.v('facturation : forme', F.facturation({ debite: 1, motif: 'affirmee' }), { debite: 1, reserve: 0, rembourse: false, motif: 'affirmee', raisonNonRembourse: null });   // contrat : Facturation.rembourse est un BOOLÉEN (B1b.5)
    H.v('   rembourse est un booléen, même quand l\'appelant passe 1 ou 0', [F.facturation({ rembourse: 1, motif: 'question' }).rembourse, F.facturation({ rembourse: 0 }).rembourse], [true, false]);
    let leve = null; try { F.facturation({ debite: 1, motif: 'code-maitre' }); } catch (e) { leve = e.message; }
    H.v('   motif « code-maitre » : lève', typeof leve, 'string');
    H.v('   reserve forcé à 0 hors motif question', [F.facturation({ reserve: 1, motif: 'lot' }).reserve, F.facturation({ reserve: 1, motif: 'question' }).reserve], [0, 1]);
    let leve2 = null; try { F.facturation({ debite: 0, motif: 'panne', raisonNonRembourse: 'inventee' }); } catch (e) { leve2 = e.message; }
    H.v('   raisonNonRembourse hors liste de sources.js : lève', typeof leve2, 'string');
    H.v('   abonnement-mois-change se dit poche-introuvable (la liste de sources.js est fermée)', [F.raisonPublique('abonnement-mois-change'), F.raisonPublique('plafond-jour'), F.raisonPublique('deja-rembourse')], ['poche-introuvable', 'plafond-jour', 'deja-rembourse']);
    H.v('   toute raison publique appartient à RAISONS_NON_REMBOURSE', ['abonnement-mois-change', 'inconnue-x', 'erreur'].every(r => RAISONS_NON_REMBOURSE.includes(F.raisonPublique(r))), true);
    // 9. historique
    const ph = await compte({ solde: { accueil: 0, achete: 0 } }), autre = await compte({ solde: { accueil: 0, achete: 0 } });
    const cle = p => `${p.type}:${p.id}`;
    // B7b.1 tour 1 (ruling A) : l'historique sert la forme du CONTRAT (LigneAnalyse / LigneCredits), jugée par le schéma publié.
    const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
    const factOk = { debite: 1, reserve: 0, rembourse: false, motif: 'affirmee', raisonNonRembourse: null };
    const lignes = []; for (let i = 0; i < 45; i++) lignes.push({ _id: `an${i}`, porteur: cle(ph), surface: 'scanner', statut: 'identifiee', cartes: [{ idProduct: 900 + i, statut: 'identifiee', raison: null }],
        produits: [{ idProduct: 900 + i, nom: `Carte ${i}`, set: { slug: 's', nom: 'Set de test', code: 'ST', tirage: null, annee: null, symbole: null }, numero: '001' }], facturation: factOk, creeLe: new Date(t.getTime() - i * 60e3), expireLe: new Date('2028-01-01') });
    // une ligne ANCIENNE sans facturation, et une sans surface : omises (rien n'est fabriqué), comptées
    lignes.push({ _id: 'anAncienne', porteur: cle(ph), surface: 'scanner', statut: 'identifiee', cartes: [], facturation: null, creeLe: new Date(t.getTime() - 100 * 60e3), expireLe: new Date('2028-01-01') });
    lignes.push({ _id: 'anSansSurface', porteur: cle(ph), statut: 'introuvable', cartes: [{ idProduct: null, statut: 'introuvable', raison: 'hors-catalogue' }], facturation: factOk, creeLe: new Date(t.getTime() - 101 * 60e3), expireLe: new Date('2028-01-01') });
    // un lot (carte null, cartesVues = nombre de cartes lues) et un introuvable
    lignes.push({ _id: 'anLot', porteur: cle(ph), surface: 'extension', statut: 'lot', cartes: [{ idProduct: 1, statut: 'identifiee' }, { idProduct: 2, statut: 'identifiee' }, { idProduct: null, statut: 'introuvable' }], facturation: { ...factOk, motif: 'lot' }, creeLe: new Date(t.getTime() - 102 * 60e3), expireLe: new Date('2028-01-01') });
    lignes.push({ _id: 'anAutre', porteur: cle(autre), surface: 'scanner', statut: 'identifiee', cartes: [], facturation: factOk, creeLe: t, expireLe: new Date('2028-01-01') });
    await db.col('analyses').insertMany(lignes);
    const mv = (o) => ({ compteId: ph.id, surface: 'scanner', scanId: null, etat: 'debite', expireLe: new Date('2028-01-01'), ...o });
    await db.col('mouvements').insertMany([
        mv({ le: new Date(t.getTime() - 5 * 60e3 - 1), type: 'octroi', delta: 25, poche: 'accueil', motif: 'octroi-accueil', cleIdempotence: 'oct1' }),
        mv({ le: new Date(t.getTime() - 9 * 60e3 - 1), type: 'achat', delta: 50, poche: 'achete', motif: 'achat', cleIdempotence: 'ach1' }),
        mv({ le: new Date(t.getTime() - 3 * 60e3 - 1), type: 'debit', delta: -1, poche: 'accueil', motif: null, scanId: 'sc', cleIdempotence: 'dbt1' }),
        mv({ le: new Date(t.getTime() - 11 * 60e3 - 1), type: 'octroi', delta: 2, poche: 'hebdo', motif: 'hebdo', cleIdempotence: 'heb1' }),
        mv({ le: new Date(t.getTime() - 12 * 60e3 - 1), type: 'migration', delta: 7, poche: 'achete', motif: 'migration', cleIdempotence: 'mig1' }),
        mv({ le: new Date(t.getTime() - 13 * 60e3 - 1), type: 'migration', delta: 3, poche: 'accueil', motif: 'migration', cleIdempotence: 'mig2' }),
        mv({ le: new Date(t.getTime() - 14 * 60e3 - 1), type: 'octroi', delta: 5, poche: 'abonnement', motif: 'abonnement', cleIdempotence: 'abo1' }),   // le contrat n'a pas de motif « abonnement » : OMISE
        mv({ le: new Date(t.getTime() - 15 * 60e3 - 1), type: 'octroi', delta: 3, poche: 'essai', motif: 'essai', cleIdempotence: 'ess1' }),                 // idem : OMISE
        { compteId: autre.id, le: t, surface: 'scanner', type: 'achat', delta: 20, poche: 'achete', motif: 'achat', scanId: null, etat: 'debite', cleIdempotence: 'ach-autre', expireLe: new Date('2028-01-01') }]);
    const tout = []; let suite = null, pages = 0, omises = 0, tailles = [];
    do { const pg = await S.historique(ph, { suite }, cfg); pages++; tout.push(...pg.lignes); tailles.push(pg.lignes.length); omises += pg.omises; suite = pg.suite; } while (suite && pages < 10);
    H.v('historique : pages 20 + 20 + 11, suite nulle à la fin', [pages, tailles, suite], [3, [20, 20, 11], null]);
    H.v('   51 lignes servies : 46 analyses (45 + le lot) et 5 lignes de crédits (le débit simple n\'est pas une ligne)', [tout.length, tout.filter(l => l.genre === 'analyse').length, tout.filter(l => l.genre === 'credits').length], [51, 46, 5]);
    H.v('   OMISES et comptées : 2 analyses sans facturation / sans surface, 2 crédits sans motif au contrat (abonnement, essai) = 4', omises, 4);
    H.v('   chaque ligne valide contre LigneHistorique du schéma publié (dénominateur 51)', tout.map((l, i) => valider(l, { $ref: '#/components/schemas/LigneHistorique' }, SCHEMA)).filter(r => !r.ok).length, 0);
    H.v('   aucune clé du dedans ne fuit : ni type, ni scanId, ni reference, ni delta, ni poche, ni cartes', tout.filter(l => ['type', 'scanId', 'reference', 'delta', 'poche', 'cartes', 'nature'].some(k => k in l)).length, 0);
    H.v('   motif de crédit PROJETÉ PAR LA POCHE : accueil→accueil, hebdo→hebdo, achete→achat, migration d\'achete→achat, migration d\'accueil→accueil', tout.filter(l => l.genre === 'credits').map(l => `${l.motif}:${l.credits}`).sort(), ['accueil:25', 'accueil:3', 'achat:50', 'achat:7', 'hebdo:2']);
    const un = tout.find(l => l.genre === 'analyse' && l.carte);
    H.v('   une analyse identifiée porte carte { nom, set (texte), numero }, cartesVues 1, facturation réelle', [un.carte, un.cartesVues, un.facturation, typeof un.le, /^\d{4}-\d{2}-\d{2}T/.test(un.le)], [{ nom: un.carte.nom, set: 'Set de test', numero: '001' }, 1, factOk, 'string', true]);
    const lot = tout.find(l => l.statut === 'lot');
    H.v('   le lot : carte null, cartesVues 3, surface extension, motif lot', [lot.carte, lot.cartesVues, lot.surface, lot.facturation.motif], [null, 3, 'extension', 'lot']);
    H.v('   aucune d\'un autre porteur', tout.some(l => l.credits === 20), false);
    H.v('   ordre décroissant strict, sans doublon (clé : genre + date + rang)', [tout.every((l, i) => i === 0 || new Date(tout[i - 1].le) >= new Date(l.le)), new Set(tout.map(l => JSON.stringify(l))).size], [true, 51]);
    H.v('   suite opaque (chaîne)', typeof (await S.historique(ph, {}, cfg)).suite, 'string');
    let leve3 = null; try { await S.historique(ph, { suite: '%%pas-une-suite%%' }, cfg); } catch (e) { leve3 = e.message; }
    H.v('   une suite falsifiée est refusée', typeof leve3, 'string');
    // 10. debiterSupplement
    const p10 = await compte({ solde: { accueil: 5, achete: 0 } });
    const d1 = await Lot.debiterSupplement(p10, { scanId: 'lot1', unites: 2, cleIdempotence: 'lotc1', maintenant: t }, cfg0);
    H.v('supplément de 2 unités : ok, 2 crédits, solde 3', [d1.ok, d1.credits.length, (await lire(p10)).solde.accueil], [true, 2, 3]);
    const d1b = await Lot.debiterSupplement(p10, { scanId: 'lot1', unites: 2, cleIdempotence: 'lotc1', maintenant: t }, cfg0);
    H.v('   rejoué avec la même clé : aucun débit de plus', [d1b.ok, (await lire(p10)).solde.accueil, await db.col('mouvements').countDocuments({ compteId: p10.id, type: 'debit' })], [true, 3, 2]);
    const d2 = await Lot.debiterSupplement(p10, { scanId: 'lot2', unites: 4, cleIdempotence: 'lotc2', maintenant: t }, cfg0);
    H.v('   4 unités sur 3 crédits : tout ou rien, QUOTA', [d2.ok, d2.code, (await lire(p10)).solde.accueil], [false, 'QUOTA', 3]);
    H.v('   le journal garde les débits annulés ET leurs rendus : somme(delta) = -2', (await db.col('mouvements').aggregate([{ $match: { compteId: p10.id } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0].s, -2);
    const d2b = await Lot.debiterSupplement(p10, { scanId: 'lot2', unites: 3, cleIdempotence: 'lotc2', maintenant: t }, cfg0);
    H.v('   la même clé, rejouée après un échec, peut aboutir (un échec n\'est pas un succès)', [d2b.ok, (await lire(p10)).solde.accueil], [true, 0]);
    // 10 bis. concurrence : 30 appels de 2 unités sur 25 crédits
    const pk = await compte({ solde: { accueil: 25, achete: 0 } });
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => Lot.debiterSupplement(pk, { scanId: `cc${i}`, unites: 2, cleIdempotence: `ccc${i}`, maintenant: t }, cfg0)));
    const succes = res.filter(r => r.ok).length, finl = (await lire(pk)).solde.accueil;
    H.v(`30 appels de 2 unités sur 25 crédits : ${succes} succès, au plus 12`, succes <= 12, true);
    H.v('   et au moins un (pas de livelock : sans file, 30 prennent chacun leur 1re unité et se rendent tout)', succes >= 1, true);
    H.v(`   CONSERVATION : solde final ${finl} = 25 - 2 x ${succes}, jamais négatif`, [finl, finl >= 0], [25 - 2 * succes, true]);
    H.v('   somme(delta des mouvements) = solde final - 25', (await db.col('mouvements').aggregate([{ $match: { compteId: pk.id } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0].s, finl - 25);
    H.v('   les refus sont des QUOTA (dénominateur 30)', res.filter(r => !r.ok && r.code === 'QUOTA').length, 30 - succes);
    let leve4 = null; try { await Lot.debiterSupplement(pk, { scanId: 'z', unites: 0.5, cleIdempotence: 'z', maintenant: t }, cfg0); } catch (e) { leve4 = e.message; }
    H.v('unités non entières : lève', typeof leve4, 'string');
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
