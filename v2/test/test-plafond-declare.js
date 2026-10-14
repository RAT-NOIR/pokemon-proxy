'use strict';
// Banc PLAFOND-DECLARE (2026-10-14, décision du testeur) — les analyses RENDUES sur DÉCLARATION du client (« aucune », « ne-sait-pas », prix illisible déclaré, question abandonnée) partagent UN compteur
// par porteur et par jour de PARIS, plafonné par OFFRE : sans compte 1, gratuit 3, Pro 30. Ce que le SERVEUR constate (panne, introuvable, garde des jumeaux, carte identifiée sans prix au guide) reste rendu
// SANS plafond ; `lot-trop-grand` (10 par jour) ne bouge pas. Base EN MÉMOIRE, aucun réseau.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger'); const Q = require('../argent/questions');
const { compte, inst } = require('./_aide-argent'); const QJ = require('./_aide-quota');
const cfg = QJ.cfgGrand({ V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), JOUR = '2026-10-08';
const prendre = async (p, scanId, maintenant = t) => { const r = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant }, cfg); if (!r.ok) throw new Error(`débit refusé ${scanId} : ${r.code}`); return r.credit; };
const plaf = async (p, type, jour = JOUR) => (await db.col('plafonds').findOne({ porteur: `${p.type}:${p.id}`, jour, type }));
const cnt = async (p, type, jour = JOUR) => ((await plaf(p, type, jour)) || { count: 0 }).count;
const gratuit = () => compte();
const pro = () => compte({ abonnement: { actif: true, quotaMensuel: 100, moisCle: '2026-10', restant: 100, jusquAu: new Date('2027-01-01') } });
const sansCompte = () => inst({ essais: 0, achete: 0 });
// n déclarations successives, chacune sur son scan débité, par le compteur `compteur` (ou alterné) ; rend ['rendu'|raison]
async function declarer(p, n, { compteur = 'question', prefixe = 'dc', maintenant = t, alterner = false } = {}) {
    const issues = [];
    for (let i = 0; i < n; i++) {
        const scanId = `${prefixe}${i}-${p.id}`; const credit = await prendre(p, scanId, maintenant);
        const c = alterner ? ['question', 'sans-prix'][i % 2] : compteur;
        const r = await Lg.rembourser(p, credit, 'declaration', { scanId, compteur: c, maintenant }, cfg);
        issues.push(r.rendu ? 'rendu' : r.raisonNonRembourse);
    }
    return issues;
}
const rep = (n, x) => Array(n).fill(x);
const capter = async f => { const l = []; const w = console.warn, e = console.error; console.warn = console.error = (...a) => { l.push(a.join(' ')); }; try { return { r: await f(), lignes: l }; } finally { console.warn = w; console.error = e; } };

(async () => {
    // ════════ configuration ════════
    {
        const c = lireConfig({ MONGODB_BASE: 'test_scratch' });
        H.v('C1. défauts : déclarations par jour sans compte 1, gratuit 3, pro 30', [c.plafonds.declares?.sansCompte, c.plafonds.declares?.gratuit, c.plafonds.declares?.pro], [1, 3, 30]);
        const c2 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_DECLARES_SANS_COMPTE: '2', V2_DECLARES_GRATUIT: '5', V2_DECLARES_PRO: '40' });
        H.v('C2. les trois variables changent les valeurs', [c2.plafonds.declares?.sansCompte, c2.plafonds.declares?.gratuit, c2.plafonds.declares?.pro], [2, 5, 40]);
        const z = lireConfig({ MONGODB_BASE: 'test_scratch', V2_DECLARES_SANS_COMPTE: '0' });
        H.v('C3. 0 est valide (aucune déclaration remboursée)', z.plafonds.declares?.sansCompte, 0);
        const rejets = [];
        for (const nom of ['V2_DECLARES_SANS_COMPTE', 'V2_DECLARES_GRATUIT', 'V2_DECLARES_PRO']) for (const v of ['abc', '-1', '2.5', ' ']) {
            let e = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', [nom]: v }); } catch (x) { e = x.message; }
            rejets.push(/configuration invalide/.test(e || ''));
        }
        H.v('C4. valeurs invalides (texte, négatif, décimal, espaces) : configuration invalide (12 sur 12)', rejets.filter(Boolean).length, 12);
        // les variables devenues sans objet : la configuration reste VALIDE, UN avertissement (noms seulement, jamais les valeurs), jamais un 503
        const OBSOLETES = { V2_PLAFOND_PANNES: '7', V2_PLAFOND_QUESTIONS: 'secret-12345', V2_SANS_PRIX_JOUR: '-3', V2_JUMEAUX_REMBOURSES_JOUR: '9' };
        const a = await capter(async () => { try { return lireConfig({ MONGODB_BASE: 'test_scratch', ...OBSOLETES }); } catch (_) { return null; } });
        const avert = a.lignes.filter(l => /V2_PLAFOND_PANNES/.test(l));
        H.v('C5. variables obsolètes posées (même invalides) : pas d\'exception, UN avertissement qui nomme les 4 variables', [Boolean(a.r), avert.length, ['V2_PLAFOND_PANNES', 'V2_PLAFOND_QUESTIONS', 'V2_SANS_PRIX_JOUR', 'V2_JUMEAUX_REMBOURSES_JOUR'].every(n => avert[0] && avert[0].includes(n))], [true, 1, true]);
        H.v('    l\'avertissement n\'affiche AUCUNE valeur', avert.some(l => l.includes('secret-12345') || l.includes('-3') && /=\s*-3|"-3"/.test(l)), false);
        const b = await capter(async () => { try { return lireConfig({ MONGODB_BASE: 'test_scratch', ...OBSOLETES }); } catch (_) { return null; } });
        H.v('    un seul avertissement par processus (la seconde lecture se tait)', b.lignes.filter(l => /V2_PLAFOND_PANNES/.test(l)).length, 0);
        H.v('    la valeur obsolète ne change rien : plus de plafonds.panne / question / sansPrix / jumeaux dans la configuration', [a.r && a.r.plafonds.panne, a.r && a.r.plafonds.question, a.r && a.r.plafonds.sansPrix, a.r && a.r.plafonds.jumeaux], [undefined, undefined, undefined, undefined]);
        H.v('    lot-trop-grand reste configurable (10 par défaut)', [lireConfig({ MONGODB_BASE: 'test_scratch' }).plafonds.lotTropGrand, lireConfig({ MONGODB_BASE: 'test_scratch', V2_LOT_TROP_GRAND_JOUR: '4' }).plafonds.lotTropGrand], [10, 4]);
    }

    await H.ouvrirBac('test-plafond-declare.js'); await M.creerIndex();

    // ════════ le plafond dépend de l'offre : la n° plafond est rendue, la n° plafond+1 non ════════
    {
        const s = await sansCompte(); const g = await gratuit(); const p = await pro();
        const is = await declarer(s, 2), ig = await declarer(g, 4), ip = await declarer(p, 31);
        H.v('O1. SANS COMPTE (plafond 1) : la 1re rendue, la 2e plafond-jour', is, ['rendu', 'plafond-jour']);
        H.v('O2. GRATUIT (plafond 3) : trois rendues, la 4e plafond-jour', ig, [...rep(3, 'rendu'), 'plafond-jour']);
        H.v('O3. PRO (plafond 30) : trente rendues, la 31e plafond-jour', ip, [...rep(30, 'rendu'), 'plafond-jour']);
        H.v('    le refus ne remonte pas le quota (le crédit reste pris) : gratuit 4 pris - 3 rendus = 1 de consommé', 1000 - await QJ.restantDe(g, cfg, t), 1);
        H.v('    les compteurs de refus sont rendus : sans compte 1, gratuit 3, pro 30 (pas de dérive au refus)', [await cnt(s, 'declare'), await cnt(g, 'declare'), await cnt(p, 'declare')], [1, 3, 30]);
        H.v('    le claim du refus est libéré (aucun rb|dc1 au nom de l\'installation, aucun rb|dc3 au nom du compte gratuit)', [await db.col('mouvements').countDocuments({ cleIdempotence: `rb|dc1-${s.id}` }), await db.col('mouvements').countDocuments({ cleIdempotence: `rb|dc3-${g.id}` })], [0, 0]);
        const r = await Lg.rembourser(g, await prendre(g, 'plus-un'), 'declaration', { scanId: 'plus-un', compteur: 'question', maintenant: t }, cfg);
        H.v('    le refus dit pourquoi : { rendu:false, raisonNonRembourse: plafond-jour }', [r.rendu, r.raisonNonRembourse], [false, 'plafond-jour']);
    }

    // ════════ UN SEUL compteur pour les trois déclarations ════════
    {
        const g = await gratuit();
        const iss = await declarer(g, 4, { alterner: true, prefixe: 'sh' });
        H.v('S1. question, sans-prix, question : trois rendues PARTAGENT le compteur, la 4e (sans-prix) est refusée', iss, [...rep(3, 'rendu'), 'plafond-jour']);
        H.v('    un seul compteur « declare » à 3 ; aucun compteur « question » ni « sans-prix » ni « panne »', [await cnt(g, 'declare'), await cnt(g, 'question'), await cnt(g, 'sans-prix'), await cnt(g, 'panne')], [3, 0, 0, 0]);
        // la même chose par les chemins réels : « aucune », « ne-sait-pas », puis un abandon au balayage
        const g2 = await gratuit(); const out = [];
        for (const [i, choix] of ['aucune', 'ne-sait-pas', 'aucune', 'ne-sait-pas'].entries()) {
            const sc = `qr${i}`; const cr = await prendre(g2, sc);
            await Q.reserverQuestion(g2, cr, { scanId: sc, carte: 0, raison: 'x', candidats: [1, 2], choix: [{ id: 'a', idProduct: 1 }, { id: 'b', idProduct: 2 }] }, cfg, t);
            const r = await Q.repondreQuestion(g2, { scanId: sc, carte: 0, choix }, cfg, t);
            out.push([r.statut, r.question.etat, r.facturation.rembourse, r.facturation.motif]);
        }
        H.v('S2. « aucune » / « ne-sait-pas » par repondreQuestion : trois remboursées, la 4e reste débitée (motif plafond-jour)', out,
            [[200, 'remboursee', true, 'question'], [200, 'remboursee', true, 'question'], [200, 'remboursee', true, 'question'], [200, 'non-remboursee', false, 'plafond-jour']]);
        H.v('    leur compteur est le même « declare » (3)', await cnt(g2, 'declare'), 3);
        // un abandon (sans réponse sous 24 h) est une déclaration par l'absence : même compteur
        const g3 = await gratuit(); const posee = new Date('2026-10-08T08:00:00Z'), apres = new Date('2026-10-09T09:00:00Z');
        for (let i = 0; i < 4; i++) { const sc = `ab${i}`; const cr = await prendre(g3, sc, posee); await Q.reserverQuestion(g3, cr, { scanId: sc, carte: 0, raison: 'x', candidats: [1, 2], choix: [{ id: 'a', idProduct: 1 }, { id: 'b', idProduct: 2 }] }, cfg, posee); }
        const bal = await Q.balayerQuestions({ maintenant: apres }, cfg);
        H.v('S3. 4 questions abandonnées au balayage d\'un gratuit : 3 rendues, 1 non (même compteur, au jour de POSE)', [bal.remboursees, bal.nonRemboursees, await cnt(g3, 'declare', JOUR)], [3, 1, 3]);
    }

    // ════════ le jour de PARIS remet à zéro (23:59 / 00:00 Paris, pas UTC) ════════
    {
        const g = await gratuit();                                         // 2026-10-08 : l'heure d'été (UTC+2) : 23:59 Paris = 21:59Z, 00:00 Paris = 22:00Z
        const a = await declarer(g, 4, { prefixe: 'pa', maintenant: new Date('2026-10-08T21:59:00Z') });
        H.v('P1. 23:59 Paris : trois rendues, la 4e refusée', a, [...rep(3, 'rendu'), 'plafond-jour']);
        const b = await declarer(g, 3, { prefixe: 'pb', maintenant: new Date('2026-10-08T22:00:00Z') });
        H.v('P2. 00:00 Paris (22:00 UTC, le même jour UTC) : le compteur repart à zéro, trois rendues', b, rep(3, 'rendu'));
        H.v('    deux compteurs : le 8 (3) et le 9 (3)', [await cnt(g, 'declare', '2026-10-08'), await cnt(g, 'declare', '2026-10-09')], [3, 3]);
        const g2 = await gratuit();
        await declarer(g2, 3, { prefixe: 'pc', maintenant: new Date('2026-10-08T21:30:00Z') });
        const c = await declarer(g2, 1, { prefixe: 'pd', maintenant: new Date('2026-10-08T23:30:00Z') });       // 01:30 Paris le 9, encore le 8 en UTC
        H.v('P3. 01:30 Paris le 9 (23:30Z le 8) : le jour de Paris a changé, rendue', c, ['rendu']);
    }

    // ════════ CONSTATÉ : rendu sans plafond (l'ancien plafond de 5 pannes est levé) ════════
    {
        const g = await gratuit(); const s = await sansCompte();
        const pannes = await declarer(g, 8, { compteur: 'panne', prefixe: 'pn' });
        H.v('K1. 8 pannes d\'un gratuit (ancien plafond 5) : 8 rendues', pannes, rep(8, 'rendu'));
        const intro = await declarer(s, 6, { compteur: 'panne', prefixe: 'in' });
        H.v('K2. 6 introuvables d\'un sans-compte (plafond de déclarations 1) : 6 rendus', intro, rep(6, 'rendu'));
        const cq = await declarer(g, 35, { compteur: 'constate-question', prefixe: 'cq' });
        H.v('K3. 35 remboursements constatés « après question » (ancien plafond 30) : 35 rendus', cq.filter(x => x === 'rendu').length, 35);
        const jm = [];
        for (let i = 0; i < 12; i++) { const sc = `jm${i}`; const cr = await prendre(g, sc); jm.push((await Lg.rembourser(g, cr, 'introuvable', { scanId: sc, compteur: 'jumeaux', unites: 1, maintenant: t }, cfg)).rendu); }
        H.v('K4. 12 refus de la garde des jumeaux (ancien plafond dédié 20, puis pannes 5) : 12 rendus', jm.filter(Boolean).length, 12);
        H.v('    aucun compteur écrit pour le constaté (ni panne, ni jumeaux, ni declare)', [await cnt(g, 'panne'), await cnt(g, 'jumeaux'), await cnt(g, 'declare'), await cnt(s, 'panne'), await cnt(s, 'declare')], [0, 0, 0, 0, 0]);
        // le constaté ne consomme pas le plafond des déclarations, et l'inverse
        const d = await declarer(s, 2, { prefixe: 'ds' });
        const e = await declarer(s, 1, { compteur: 'panne', prefixe: 'es' });
        H.v('K5. un sans-compte a épuisé sa déclaration : sa panne suivante est quand même rendue', [d, e], [['rendu', 'plafond-jour'], ['rendu']]);
        const lot = await Lg.rembourser(g, await prendre(g, 'lj'), 'introuvable', { scanId: 'lj', compteur: 'jumeaux', unites: 3, maintenant: t }, cfg);
        H.v('K6. unites mal formées toujours refusées sur jumeaux (garde de forme inchangée)', (await Lg.rembourser(g, await prendre(g, 'lk'), 'x', { scanId: 'lk', compteur: 'jumeaux', unites: 0, maintenant: t }, cfg)).raisonNonRembourse, 'erreur');
        H.v('    et un compteur inconnu est refusé (jamais rabattu), y compris les anciens noms disparus', [(await Lg.rembourser(g, await prendre(g, 'll'), 'x', { scanId: 'll', compteur: 'sans_prix', maintenant: t }, cfg)).raisonNonRembourse, lot.rendu], ['erreur', true]);
    }

    // ════════ lot-trop-grand : INCHANGÉ (10 par jour, compteur propre) ════════
    {
        const s = await sansCompte(); const iss = [];
        for (let i = 0; i < 11; i++) { const sc = `lt${i}`; const cr = await prendre(s, sc); const r = await Lg.rembourser(s, cr, 'lot-trop-grand', { scanId: sc, compteur: 'lot-trop-grand', maintenant: t }, cfg); iss.push(r.rendu ? 'rendu' : r.raisonNonRembourse); }
        H.v('L1. lot-trop-grand d\'un SANS COMPTE : 10 rendus (pas 1), le 11e plafond-jour — le plafond ne dépend pas de l\'offre', iss, [...rep(10, 'rendu'), 'plafond-jour']);
        H.v('    compteur propre « lot-trop-grand » à 10, aucun compteur « declare », et aucun champ declaration', [await cnt(s, 'lot-trop-grand'), await cnt(s, 'declare')], [10, 0]);
        const r = await Lg.rembourser(s, await prendre(s, 'lt-x'), 'lot-trop-grand', { scanId: 'lt-x', compteur: 'lot-trop-grand', maintenant: t }, cfg);
        H.v('    le refus du 12e ne porte pas de champ declaration', 'declaration' in r, false);
        const c = lireConfig({ MONGODB_BASE: 'test_scratch', V2_LOT_TROP_GRAND_JOUR: '2' });
        const g = await gratuit(); const o = [];
        for (let i = 0; i < 3; i++) { const sc = `lu${i}`; const cr = await prendre(g, sc); o.push((await Lg.rembourser(g, cr, 'lot-trop-grand', { scanId: sc, compteur: 'lot-trop-grand', maintenant: t }, { ...cfg, plafonds: c.plafonds })).rendu); }
        H.v('    V2_LOT_TROP_GRAND_JOUR toujours lue (2 : deux rendus, le 3e non)', o, [true, true, false]);
    }

    // ════════ le résultat dit le jugement : champ `declaration` ════════
    {
        const g = await gratuit(); const cr1 = await prendre(g, 'dr1'); const r1 = await Lg.rembourser(g, cr1, 'x', { scanId: 'dr1', compteur: 'question', maintenant: t }, cfg);
        H.v('D1. déclaration rendue : { rendue:true, raison:null, plafondJour:3 }', r1.declaration, { rendue: true, raison: null, plafondJour: 3 });
        await declarer(g, 2, { prefixe: 'dx' });
        const r4 = await Lg.rembourser(g, await prendre(g, 'dr4'), 'x', { scanId: 'dr4', compteur: 'sans-prix', maintenant: t }, cfg);
        H.v('D2. déclaration refusée : { rendue:false, raison:plafond-declarations, plafondJour:3 }, et plafond-jour dans raisonNonRembourse (contrat de facturation inchangé)', [r4.declaration, r4.raisonNonRembourse], [{ rendue: false, raison: 'plafond-declarations', plafondJour: 3 }, 'plafond-jour']);
        const rp = await Lg.rembourser(g, await prendre(g, 'dr5'), 'x', { scanId: 'dr5', compteur: 'panne', maintenant: t }, cfg);
        H.v('D3. un remboursement constaté ne porte PAS de champ declaration', ['declaration' in rp, rp.rendu], [false, true]);
        const s = await sansCompte(); const rs = await Lg.rembourser(s, await prendre(s, 'dr6'), 'x', { scanId: 'dr6', compteur: 'question', maintenant: t }, cfg);
        const rs2 = await Lg.rembourser(s, await prendre(s, 'dr7'), 'x', { scanId: 'dr7', compteur: 'question', maintenant: t }, cfg);
        H.v('D4. sans compte : plafondJour 1 dans les deux réponses', [rs.declaration, rs2.declaration], [{ rendue: true, raison: null, plafondJour: 1 }, { rendue: false, raison: 'plafond-declarations', plafondJour: 1 }]);
        const bis = await Lg.rembourser(g, cr1, 'x', { scanId: 'dr1', compteur: 'question', maintenant: t }, cfg);
        H.v('D5. rejeu d\'un scan déjà rendu : deja-rembourse, aucun champ declaration (rien n\'a été jugé), le compteur ne bouge pas (3)', ['declaration' in bis, bis.raisonNonRembourse, await cnt(g, 'declare')], [false, 'deja-rembourse', 3]);
        // la question répondue porte aussi le jugement
        const g2 = await gratuit(); await declarer(g2, 3, { prefixe: 'rq' });
        const sc = 'rqq'; const cr = await prendre(g2, sc);
        await Q.reserverQuestion(g2, cr, { scanId: sc, carte: 0, raison: 'x', candidats: [1, 2], choix: [{ id: 'a', idProduct: 1 }, { id: 'b', idProduct: 2 }] }, cfg, t);
        const rq = await Q.repondreQuestion(g2, { scanId: sc, carte: 0, choix: 'aucune' }, cfg, t);
        H.v('D6. repondreQuestion (« aucune », plafond atteint) rend la facturation plafond-jour ET le champ declaration', [rq.facturation.motif, rq.facturation.raisonNonRembourse, rq.declaration], ['plafond-jour', 'plafond-jour', { rendue: false, raison: 'plafond-declarations', plafondJour: 3 }]);
        const sc2 = 'rqr'; const cr2 = await prendre(g2, sc2);
        await Q.reserverQuestion(g2, cr2, { scanId: sc2, carte: 0, raison: 'x', candidats: [1, 2], choix: [{ id: 'a', idProduct: 1 }, { id: 'b', idProduct: 2 }] }, cfg, t);
        const rc = await Q.repondreQuestion(g2, { scanId: sc2, carte: 0, choix: 'a' }, cfg, t);
        H.v('    une réponse par un candidat ne juge aucun remboursement : pas de champ declaration', 'declaration' in rc, false);
    }

    // ════════ changement d'offre en cours de journée : ce que fait le code ════════
    {
        // RÈGLE : le plafond se lit à l'offre COURANTE du porteur EFFECTIF (une installation liée a pour offre celle de son compte) ; le compteur reste celui du porteur PRÉSENTÉ (clé installation:X ou compte:Y), comme les autres compteurs du jour.
        const s = await sansCompte(); const crs = [];
        for (let i = 0; i < 5; i++) crs.push(await prendre(s, `ml${i}`));                  // 5 débits pris AVANT la liaison (une installation liée ne peut plus être débitée)
        const rj = async i => { const r = await Lg.rembourser(s, crs[i], 'declaration', { scanId: `ml${i}`, compteur: 'question', maintenant: t }, cfg); return r.rendu ? 'rendu' : r.raisonNonRembourse; };
        const avant = [await rj(0), await rj(1)];
        H.v('M1. sans compte : 1 rendue puis refusée', avant, ['rendu', 'plafond-jour']);
        const cpt = await gratuit();
        await db.col('installations').updateOne({ _id: s.id }, { $set: { compteId: cpt.id } });                  // l'installation se lie à un compte GRATUIT en cours de journée
        const apres = [await rj(2), await rj(3), await rj(4)];
        H.v('M2. installation liée, présentée telle quelle (balayage, remboursement tardif) : plafond du compte (3) sur SON compteur (déjà à 1) : deux de plus, la 3e refusée', apres, ['rendu', 'rendu', 'plafond-jour']);
        H.v('    compteur installation:X à 3, aucun compteur écrit au nom du compte', [await cnt(s, 'declare'), await cnt(cpt, 'declare')], [3, 0]);
        const c2 = await declarer(cpt, 4, { prefixe: 'cu' });
        H.v('M3. le même jour, depuis le COMPTE (le porteur des requêtes une fois liée) : compteur neuf, plafond 3 — au plus 1 + 3 = 4 déclarations rendues dans la journée (limite connue, écrite au contrat)', c2, [...rep(3, 'rendu'), 'plafond-jour']);
        // descente d'offre : un Pro dont l'abonnement expire en cours de journée n'a plus que le plafond gratuit
        const p = await pro(); const x = await declarer(p, 5, { prefixe: 'pr' });
        await db.col('comptes').updateOne({ _id: p.id }, { $set: { 'abonnement.jusquAu': new Date('2026-10-08T09:00:00Z') } });
        const y = await declarer(p, 1, { prefixe: 'ps' });
        H.v('M4. un Pro à 5 déclarations dont l\'abonnement expire : la suivante est jugée au plafond GRATUIT (3 < 5) : refusée', [x, y], [rep(5, 'rendu'), ['plafond-jour']]);
        // porteur introuvable (compte supprimé) : la garde la plus étroite, jamais une offre plus large
        const f = await gratuit(); const cr = await prendre(f, 'fant');
        await db.col('comptes').deleteOne({ _id: f.id });
        const r = await Lg.rembourser(f, cr, 'x', { scanId: 'fant', compteur: 'question', maintenant: t }, cfg);
        H.v('M5. porteur introuvable : plafond SANS COMPTE (1) — une première déclaration passe, plafondJour 1', [r.declaration && r.declaration.plafondJour], [1]);
    }

    // ════════ Pro : l'unité revient à la garde anti-abus de 200 comme aujourd'hui ════════
    {
        const p = await pro(); const avant = await QJ.restantDe(p, cfg, t);
        const cr = await prendre(p, 'pro1');
        const apresDebit = await db.col('quota_jour').findOne({ porteur: `compte:${p.id}`, jour: JOUR });
        const r = await Lg.rembourser(p, cr, 'x', { scanId: 'pro1', compteur: 'question', maintenant: t }, cfg);
        const apresRendu = await db.col('quota_jour').findOne({ porteur: `compte:${p.id}`, jour: JOUR });
        H.v('Q1. Pro : la déclaration rendue décrémente le compteur du jour (garde de 200) comme avant', [r.rendu, apresDebit.count, apresRendu.count], [true, 1, 0]);
        void avant;
    }
    // ════════ tour 1 (M1) : le lot aux confirmations refusées est une DÉCLARATION (compteur commun, plafond par offre, champ declaration) ════════
    {
        const g = await gratuit(); const out = [], decl = [];
        for (let i = 0; i < 4; i++) {
            const sc = `lotc${i}-${g.id}`; const cr = await prendre(g, sc);
            await db.col('analyses').insertOne({ _id: sc, cartes: [{ statut: 'a-trancher' }] });
            await Q.reserverQuestion(g, cr, { scanId: sc, carte: 0, raison: 'x', candidats: [1], choix: [{ id: 'a', idProduct: 1 }], lot: true }, cfg, t);
            const r = await Q.repondreQuestion(g, { scanId: sc, carte: 0, choix: 'aucune' }, cfg, t);
            out.push(r.facturation && r.facturation.rembourse ? 'rendu' : r.facturation && r.facturation.raisonNonRembourse); decl.push(r.declaration);
        }
        H.v('LC1. 4 lots dont la confirmation est refusée (gratuit) : 3 rendus, le 4e plafond-jour', out, [...rep(3, 'rendu'), 'plafond-jour']);
        H.v('    declaration : rendue x3 puis refusée (plafond 3) ; compteur commun « declare » = 3, aucun compteur panne', [decl, await cnt(g, 'declare'), await cnt(g, 'panne')],
            [[...rep(3, { rendue: true, raison: null, plafondJour: 3 }), { rendue: false, raison: 'plafond-declarations', plafondJour: 3 }], 3, 0]);
    }
    // ════════ tour 1 (M2) : concurrence au plafond ════════
    {
        const verifs = [];
        for (let essai = 0; essai < 5; essai++) {
            const g = await gratuit();
            for (let i = 0; i < 2; i++) { const sc = `ca${essai}-${i}-${g.id}`; await Lg.rembourser(g, await prendre(g, sc), 'x', { scanId: sc, compteur: 'question', maintenant: t }, cfg); }
            const cr = []; for (let i = 0; i < 6; i++) cr.push(await prendre(g, `cc${essai}-${i}-${g.id}`));
            const rs = await Promise.all(cr.map((c, i) => Lg.rembourser(g, c, 'x', { scanId: `cc${essai}-${i}-${g.id}`, compteur: i % 2 ? 'sans-prix' : 'question', maintenant: t }, cfg)));
            verifs.push([rs.filter(r => r.rendu).length, rs.filter(r => !r.rendu && r.raisonNonRembourse === 'plafond-jour').length, await cnt(g, 'declare')]);
        }
        H.v('CC1. gratuit à 2/3, 6 déclarations SIMULTANÉES (deux noms de compteur) : exactement 1 rendue, 5 plafond-jour, compteur final 3 (5 essais)', verifs, Array(5).fill([1, 5, 3]));
        const s = await sansCompte(); const cs = []; for (let i = 0; i < 8; i++) cs.push(await prendre(s, `cs${i}-${s.id}`));
        const rs = await Promise.all(cs.map((c, i) => Lg.rembourser(s, c, 'x', { scanId: `cs${i}-${s.id}`, compteur: 'sans-prix', maintenant: t }, cfg)));
        H.v('CC2. sans compte (plafond 1), 8 déclarations simultanées : exactement 1 rendue, compteur 1', [rs.filter(r => r.rendu).length, await cnt(s, 'declare')], [1, 1]);
        const p = await pro(); await db.col('plafonds').insertOne({ porteur: `compte:${p.id}`, jour: JOUR, type: 'declare', count: 27, expireLe: new Date('2026-10-20') });
        const cp = []; for (let i = 0; i < 10; i++) cp.push(await prendre(p, `cp${i}-${p.id}`));
        const rp = await Promise.all(cp.map((c, i) => Lg.rembourser(p, c, 'x', { scanId: `cp${i}-${p.id}`, compteur: 'question', maintenant: t }, cfg)));
        H.v('CC3. Pro à 27/30, 10 simultanées : exactement 3 rendues, compteur 30', [rp.filter(r => r.rendu).length, await cnt(p, 'declare')], [3, 30]);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
