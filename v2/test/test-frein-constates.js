'use strict';
// Banc FREIN-CONSTATES (2026-10-17, décision du testeur) — ce que le SERVEUR constate (panne, introuvable, garde des jumeaux, remboursement à l'émission d'une question) n'est plus rendu sans plafond :
// 20 par jour de Paris et par porteur sans compte, 50 gratuit, 100 Pro (offre lue au moment du remboursement). Au-delà : pas de remboursement, motif `plafond-jour`. Exceptions : l'administrateur
// (aucun crédit pris), et une panne de NOTRE infrastructure (INDISPONIBLE, nature `indisponible`) qui ne se facture jamais. Base EN MÉMOIRE, aucun réseau.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger');
const { compte, inst } = require('./_aide-argent'); const QJ = require('./_aide-quota');
const cfg = QJ.cfgGrand({ V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), JOUR = '2026-10-08';
const prendre = async (p, scanId, maintenant = t) => { const r = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant }, cfg); if (!r.ok) throw new Error(`débit refusé ${scanId} : ${r.code}`); return r.credit; };
const cnt = async (p, type, jour = JOUR) => { const d = await db.col('plafonds').findOne({ porteur: `${p.type}:${p.id}`, jour, type }); return d ? d.count : 0; };
const gratuit = () => compte();
const pro = () => compte({ abonnement: { actif: true, quotaMensuel: 100, moisCle: '2026-10', restant: 100, jusquAu: new Date('2027-01-01') } });
const sansCompte = () => inst({ essais: 0, achete: 0 });
const rep = (n, x) => Array(n).fill(x);
// n remboursements constatés successifs, chacun sur son scan débité ; rend ['rendu'|raison]
async function constater(p, n, { compteur = 'introuvable', prefixe = 'k', maintenant = t, unites } = {}) {
    const issues = [];
    for (let i = 0; i < n; i++) {
        const scanId = `${prefixe}${i}-${p.id}`; const credit = await prendre(p, scanId, maintenant);
        const c = Array.isArray(compteur) ? compteur[i % compteur.length] : compteur;
        const r = await Lg.rembourser(p, credit, 'constate', { scanId, compteur: c, maintenant, ...(unites && c === 'jumeaux' ? { unites } : {}) }, cfg);
        issues.push(r.rendu ? 'rendu' : r.raisonNonRembourse);
    }
    return issues;
}

(async () => {
    // ════════ configuration ════════
    {
        const c = lireConfig({ MONGODB_BASE: 'test_scratch' });
        H.v('C1. défauts : constatés par jour sans compte 20, gratuit 50, pro 100', [c.plafonds.constates?.sansCompte, c.plafonds.constates?.gratuit, c.plafonds.constates?.pro], [20, 50, 100]);
        const c2 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_CONSTATES_SANS_COMPTE: '2', V2_CONSTATES_GRATUIT: '5', V2_CONSTATES_PRO: '40' });
        H.v('C2. les trois variables changent les valeurs', [c2.plafonds.constates?.sansCompte, c2.plafonds.constates?.gratuit, c2.plafonds.constates?.pro], [2, 5, 40]);
        const rejets = [];
        for (const nom of ['V2_CONSTATES_SANS_COMPTE', 'V2_CONSTATES_GRATUIT', 'V2_CONSTATES_PRO']) for (const v of ['abc', '-1', '2.5', ' ']) {
            let e = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', [nom]: v }); } catch (x) { e = x.message; }
            rejets.push(/configuration invalide/.test(e || ''));
        }
        H.v('C3. valeurs invalides (texte, négatif, décimal, espaces) : configuration invalide (12 sur 12)', rejets.filter(Boolean).length, 12);
        H.v('    les plafonds des déclarations et du lot trop grand ne bougent pas', [c.plafonds.declares.sansCompte, c.plafonds.declares.gratuit, c.plafonds.declares.pro, c.plafonds.lotTropGrand], [1, 3, 30, 10]);
        H.v('C4. dépense globale : défaut 5 $ par jour, appel estimé 0,004 $', [c.depenseModele?.jourUsd, c.depenseModele?.appelEstimeUsd], [5, 0.004]);
        const c3 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_DEPENSE_MODELE_JOUR_USD: '2.5', V2_COUT_APPEL_ESTIME_USD: '0.01' });
        H.v('    les deux variables changent les valeurs', [c3.depenseModele?.jourUsd, c3.depenseModele?.appelEstimeUsd], [2.5, 0.01]);
        const vide = lireConfig({ MONGODB_BASE: 'test_scratch', V2_DEPENSE_MODELE_JOUR_USD: '' });
        H.v('    une valeur absente (vide) prend le défaut', vide.depenseModele?.jourUsd, 5);
        const bad = [];
        for (const nom of ['V2_DEPENSE_MODELE_JOUR_USD', 'V2_COUT_APPEL_ESTIME_USD']) for (const v of ['0', '-1', 'abc', ' ', '1e999', '0x5', 'NaN', '5 $']) {
            let e = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', [nom]: v }); } catch (x) { e = x.message; }
            bad.push(/configuration invalide/.test(e || ''));
        }
        H.v('C5. dépense : 0, négatif, texte, espaces, infini, hexadécimal, NaN, unité : configuration invalide (16 sur 16)', bad.filter(Boolean).length, 16);
    }

    await H.ouvrirBac('test-frein-constates.js'); await M.creerIndex();

    // ════════ le plafond dépend de l'offre : la n° plafond est rendue, la n° plafond+1 non ════════
    {
        const s = await sansCompte(); const g = await gratuit(); const p = await pro();
        const is = await constater(s, 21), ig = await constater(g, 51), ip = await constater(p, 101);
        H.v('F1. SANS COMPTE (20) : vingt rendues, la 21e plafond-jour', is, [...rep(20, 'rendu'), 'plafond-jour']);
        H.v('F2. GRATUIT (50) : cinquante rendues, la 51e plafond-jour', ig, [...rep(50, 'rendu'), 'plafond-jour']);
        H.v('F3. PRO (100) : cent rendues, la 101e plafond-jour', ip, [...rep(100, 'rendu'), 'plafond-jour']);
        H.v('    les compteurs « constate » ne dérivent pas au refus : 20, 50, 100', [await cnt(s, 'constate'), await cnt(g, 'constate'), await cnt(p, 'constate')], [20, 50, 100]);
        H.v('    le claim du refus est libéré (aucun rb| du 21e scan)', await db.col('mouvements').countDocuments({ cleIdempotence: `rb|k20-${s.id}` }), 0);
        const r = await Lg.rembourser(s, await prendre(s, 'plus-un'), 'constate', { scanId: 'plus-un', compteur: 'introuvable', maintenant: t }, cfg);
        H.v('    le refus dit pourquoi, sans champ `declaration` (ce n\'est pas une déclaration)', [r.rendu, r.raisonNonRembourse, 'declaration' in r], [false, 'plafond-jour', false]);
    }

    // ════════ UN SEUL compteur pour panne, introuvable, jumeaux et question constatée ════════
    {
        const s = await sansCompte();
        const iss = await constater(s, 21, { compteur: ['introuvable', 'jumeaux', 'constate-question'], prefixe: 'mx' });
        H.v('M1. introuvable, jumeaux, constate-question alternés : le 21e (toutes natures confondues) est refusé', iss, [...rep(20, 'rendu'), 'plafond-jour']);
        H.v('    un seul compteur « constate » ; aucun « panne », « jumeaux » ni « constate-question »', [await cnt(s, 'constate'), await cnt(s, 'panne'), await cnt(s, 'jumeaux'), await cnt(s, 'constate-question')], [20, 0, 0, 0]);
    }

    // ════════ constatés et déclarations : deux compteurs, indépendants ════════
    {
        const s = await sansCompte();
        const a = await constater(s, 20, { prefixe: 'ia' });
        const d = await constater(s, 2, { compteur: 'question', prefixe: 'id' });
        H.v('I1. 20 constatés épuisés : la déclaration (plafond 1) est quand même rendue, la 2e non', [a.filter(x => x === 'rendu').length, d], [20, ['rendu', 'plafond-jour']]);
        const g = await gratuit();
        await constater(g, 3, { compteur: 'question', prefixe: 'ig' });
        const e = await constater(g, 1, { prefixe: 'ie' });
        H.v('I2. 3 déclarations épuisées : la panne suivante est rendue (compteur distinct)', e, ['rendu']);
    }

    // ════════ PANNE DE NOTRE INFRASTRUCTURE : jamais plafonnée ════════
    {
        const s = await sansCompte();
        const iss = await constater(s, 25, { compteur: 'indisponible', prefixe: 'ni' });
        H.v('N1. 25 pannes INDISPONIBLE d\'un sans-compte (plafond 20) : 25 rendues', iss, rep(25, 'rendu'));
        H.v('    aucun compteur écrit (ni constate, ni indisponible)', [await cnt(s, 'constate'), await cnt(s, 'indisponible')], [0, 0]);
        const tout = await constater(s, 21, { prefixe: 'nj' });
        H.v('N2. elle ne consomme pas le plafond des constatés : 20 constatés puis le 21e refusé', tout, [...rep(20, 'rendu'), 'plafond-jour']);
        const apres = await constater(s, 1, { compteur: 'indisponible', prefixe: 'nk' });
        H.v('N3. constatés épuisés : une panne INDISPONIBLE est encore rendue', apres, ['rendu']);
    }

    // ════════ TOUTE panne de NOTRE côté (SERVEUR 500, IA, INDISPONIBLE) est hors plafond : le plafond ne porte que sur les constats sur la photo ════════
    {
        const s = await sansCompte();
        const iss = await constater(s, 25, { compteur: 'panne', prefixe: 'pS' });
        H.v('T1. 25 pannes (SERVEUR / IA : nature `panne`) d\'un sans-compte, plafond des constatés 20 : les 25 rendues', iss, rep(25, 'rendu'));
        H.v('    aucun compteur « constate » écrit par une panne', await cnt(s, 'constate'), 0);
        const intro = await constater(s, 21, { compteur: 'introuvable', prefixe: 'pI' });
        H.v('T2. les introuvables, eux, restent plafonnés (20 rendus, le 21e refusé) même après 25 pannes', intro, [...rep(20, 'rendu'), 'plafond-jour']);
        const apres = await constater(s, 1, { compteur: 'panne', prefixe: 'pJ' });
        H.v('T3. constatés épuisés : une panne SERVEUR / IA est encore rendue', apres, ['rendu']);
    }

    // ════════ administrateur : aucun crédit pris, jamais plafonné ════════
    {
        const a = await compte({ role: 'administrateur' }); const ok = [];
        for (let i = 0; i < 25; i++) { const r = await Lg.debiter(a, { scanId: `ad${i}`, cleIdempotence: `d|ad${i}`, maintenant: t }, cfg); ok.push(r.ok && r.administrateur === true); }
        H.v('A1. administrateur : 25 débits, tous « administrateur » (aucun crédit, donc rien à plafonner)', ok.filter(Boolean).length, 25);
        const r = await Lg.rembourser(a, null, 'constate', { scanId: 'ad0', compteur: 'introuvable', maintenant: t }, cfg);
        H.v('    et il n\'écrit aucun compteur', [r.raisonNonRembourse, await cnt(a, 'constate')], ['aucun-debit', 0]);
    }

    // ════════ une garde s'écrit par ce qu'elle AUTORISE : offre inconnue ⇒ le plafond le plus bas ════════
    {
        const orphelin = await inst({ essais: 0, achete: 0 }); const credits = [];
        for (let i = 0; i < 21; i++) credits.push(await prendre(orphelin, `or${i}`));
        await db.col('installations').updateOne({ _id: orphelin.id }, { $set: { compteId: new (require('mongoose').Types.ObjectId)() } });   // liée APRÈS les débits à un compte qui n'existe pas
        const iss = [];
        for (let i = 0; i < 21; i++) { const r = await Lg.rembourser(orphelin, credits[i], 'constate', { scanId: `or${i}`, compteur: 'introuvable', maintenant: t }, cfg); iss.push(r.rendu ? 'rendu' : r.raisonNonRembourse); }
        H.v('G1. installation liée à un compte introuvable : plafond SANS COMPTE (20), jamais plus large', iss, [...rep(20, 'rendu'), 'plafond-jour']);
        const lie = await compte(); const il = await inst({ essais: 0, achete: 0 }); const cr2 = [];
        for (let i = 0; i < 21; i++) cr2.push(await prendre(il, `li${i}`));
        await db.col('installations').updateOne({ _id: il.id }, { $set: { compteId: lie.id } });             // liée APRÈS les débits à un compte gratuit
        let rendues = 0;
        for (let i = 0; i < 21; i++) { const r = await Lg.rembourser(il, cr2[i], 'constate', { scanId: `li${i}`, compteur: 'introuvable', maintenant: t }, cfg); if (r.rendu) rendues++; }
        H.v('G2. installation liée à un compte gratuit : l\'offre du compte (50) s\'applique ; 21 rendues', rendues, 21);
    }

    // ════════ un lot : une seule prise du compteur par scan, une unité par carte refusée ════════
    {
        const s = await sansCompte();
        const iss = await constater(s, 21, { compteur: 'jumeaux', unites: 3, prefixe: 'lo' });
        H.v('L1. lot refusé par la garde des jumeaux (3 cartes) : 20 rendus puis plafond-jour', iss, [...rep(20, 'rendu'), 'plafond-jour']);
        H.v('    compteur « constate » à 20 (un scan = une prise)', await cnt(s, 'constate'), 20);
    }

    // ════════ le jour de PARIS remet à zéro ════════
    {
        const s = await sansCompte();
        const a = await constater(s, 21, { prefixe: 'pa', maintenant: new Date('2026-10-08T21:59:00Z') });
        const b = await constater(s, 20, { prefixe: 'pb', maintenant: new Date('2026-10-08T22:00:00Z') });
        H.v('P1. 23:59 Paris : le 21e refusé ; 00:00 Paris : le compteur repart à zéro, vingt rendues', [a[20], b.filter(x => x === 'rendu').length], ['plafond-jour', 20]);
    }

    // ════════ le plafond ne s'applique pas à une REPRISE d'un remboursement commencé (inchangé) et un rejeu ne compte qu'une fois ════════
    {
        const s = await sansCompte(); const credit = await prendre(s, 'rj');
        const r1 = await Lg.rembourser(s, credit, 'constate', { scanId: 'rj', compteur: 'introuvable', maintenant: t }, cfg);
        const r2 = await Lg.rembourser(s, credit, 'constate', { scanId: 'rj', compteur: 'introuvable', maintenant: t }, cfg);
        H.v('R1. un rejeu du même scan : une prise, « deja-rembourse »', [r1.rendu, r2.raisonNonRembourse, await cnt(s, 'constate')], [true, 'deja-rembourse', 1]);
    }

    await H.fermerBac(); H.bilan();      // M5 (relecture 1) : fermerBac vide le préfixe, déconnecte, puis arrête la base de banc — arreterBanc seul laissait le nettoyage de sortie attendre une base arrêtée
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
