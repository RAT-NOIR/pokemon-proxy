'use strict';
// ACHETE-AVANT-JOUR (2026-10-17, nuit) — les analyses achetées avec la 1.0.5 (poche `achete`) sont débitées AVANT le quota du jour. Base : la base EN MÉMOIRE du banc. Aucun réseau, aucune écriture hors du banc.
// Ce que ce banc fixe (chaque ligne a eu son rouge : voir le rapport du lot) :
//   · le débit prend `achete` tant qu'elle n'est pas vide, PUIS `jour` ; une analyse payée sur `achete` ne touche ni le compteur du jour ni `offre.restant` ;
//   · jamais un solde négatif, jamais un double débit (course, rejeu) ; la réconciliation reste propre après chaque chemin ;
//   · tout remboursement rend dans la poche d'ORIGINE, sous les plafonds existants ;
//   · un lot qui chevauche les deux poches rend chaque unité à SA poche ;
//   · `achete` à 0 (ou absente) : le grand livre est celui d'aujourd'hui ; un compte sans achat ne voit aucun changement.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const Of = require('../argent/offre'); const Lot = require('../argent/lot'); const S = require('../argent/solde'); const Q = require('../argent/questions'); const P = require('../argent/poches');
const R = require('../argent/reconcilier'); const Rep = require('../argent/reparation');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const t = new Date('2026-10-13T10:00:00Z'), JOUR = '2026-10-13', h = n => new Date(t.getTime() + n * 3600e3);
let nCle = 0; const cle = () => `ach-${++nCle}`;
const cnt = async (p, jour = JOUR) => { const d = await db.col('quota_jour').findOne({ porteur: `${p.type}:${p.id}`, jour }); return d ? d.count : 0; };
const achete = async p => { const d = await lire(p); return p.type === 'compte' ? (d.solde ? d.solde.achete : undefined) : d.achete; };
const deb = (p, o = {}) => Lg.debiter(p, { scanId: o.scanId || cle(), cleIdempotence: o.cle || cle(), maintenant: o.t || t }, cfg);
const poches = rs => rs.map(r => (r.ok ? (r.credit ? r.credit.poche : 'admin') : r.code));
const mouv = (p, filtre = {}) => db.col('mouvements').find({ ...(p.type === 'compte' ? { compteId: p.id } : { installationId: p.id }), ...filtre }).toArray();
const netPoche = async (p, poche) => (await mouv(p, { poche, type: { $ne: 'migration' } })).reduce((s, m) => s + m.delta, 0);      // hors le mouvement d'ouverture : le NET des analyses (débits + rendus)
const recon = (p, maintenant = h(30)) => R.reconcilier(p, { cfg, maintenant });
const muet = async f => { const e0 = console.error, w0 = console.warn; console.error = () => { }; console.warn = () => { }; try { return await f(); } finally { console.error = e0; console.warn = w0; } };
// Un porteur doté de `n` achetées COMME EN PRODUCTION : le solde ET son mouvement d'ouverture (la migration des achats 1.0.5 a écrit un mouvement `migration` +n sur la poche `achete`) —
// sans lui la réconciliation (somme des deltas = solde réel) ne pourrait pas être propre pour une raison qui n'est pas celle qu'on teste.
const ouvrir = async (p, n) => { if (Number.isInteger(n) && n > 0) await db.col('mouvements').insertOne({ ...(p.type === 'compte' ? { compteId: p.id } : { installationId: p.id }), le: new Date('2026-09-01T00:00:00Z'), surface: 'extension', type: 'migration', delta: n, poche: 'achete',
    motif: 'migration', scanId: null, etat: 'debite', cleIdempotence: `ouverture|${p.type}:${p.id}`, expireLe: new Date('2028-09-01T00:00:00Z') }); return p; };
const comptePlein = async (n, o = {}) => ouvrir(await compte({ solde: { accueil: 0, achete: n }, ...o }), n);
const instPlein = async (n, o = {}) => ouvrir(await inst({ achete: n, ...o }), n);
const choix = [{ id: 'c1', idProduct: 111 }, { id: 'c2', idProduct: 222 }];
// un scan débité PUIS sa question réservée (le chemin des questions de l'identification)
const poserQuestion = async (p, o = {}) => { const scanId = o.scanId || cle(); const d = await deb(p, { scanId, t: o.t });
    const r = await Q.reserverQuestion(p, d.credit, { scanId, carte: 0, raison: 'egalite', candidats: [111, 222], choix, lot: false }, cfg, o.t || t); return { scanId, credit: d.credit, d, r }; };
// jouer les mêmes gestes et rendre ce que le grand livre en garde, sans identifiants ni dates ni le porteur (pour comparer deux porteurs)
const empreinte = async p => {
    const ms = (await mouv(p)).map(m => ({ type: m.type, delta: m.delta, poche: m.poche, motif: m.motif, etat: m.etat, credit: m.credit ? Object.fromEntries(Object.entries(m.credit).filter(([k]) => k !== 'porteurCle')) : m.credit, cle: String(m.cleIdempotence).replace(/^.*?\|/, '|') }));
    ms.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
    return JSON.stringify({ ms, jour: await cnt(p) });
};

(async () => {
    await H.ouvrirBac('test-achete-avant-jour.js'); await M.creerIndex();

    // ── 1. l'ordre est FIXÉ DANS LE CODE : achete puis jour ; la configuration ne bouge pas
    H.v('1a. ordre des poches d\'un compte et d\'une installation : achete puis jour', [P.ordreDe({ type: 'compte' }, cfg), P.ordreDe({ type: 'installation' }, cfg)], [['achete', 'jour'], ['achete', 'jour']]);
    H.v('1b. V2_ORDRE_POCHES garde son refus de nommer `achete` (et ne change pas l\'ordre fixé dans le code)', [(() => { try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_ORDRE_POCHES: 'achete,jour' }); return 'accepté'; } catch (e) { return /n'est plus débitée/.test(e.message) ? 'refusé' : e.message; } })(), P.ordreDe({ type: 'compte' }, lireConfig({ MONGODB_BASE: 'test_scratch', V2_ORDRE_POCHES: 'jour' }))], ['refusé', ['achete', 'jour']]);
    H.v('1c. type de porteur inconnu : aucune poche', P.ordreDe({ type: 'x' }, cfg), []);

    // ── 2. le débit : achete d'abord, puis le quota du jour ; le quota et offre.restant ne bougent pas pour une analyse payée sur achete
    {
        const p = await comptePlein(3); const seq = [], restants = [];
        for (let i = 0; i < 5; i++) { seq.push(await deb(p)); restants.push((await Of.offre(p, cfg, t)).restant); }
        H.v('2a. compte gratuit à 3 achetées : achete, achete, achete, puis jour, jour', poches(seq), ['achete', 'achete', 'achete', 'jour', 'jour']);
        H.v('    le crédit d\'une analyse achetée est exactement { poche: "achete" } (rien du jour)', seq[0].credit, { poche: 'achete' });
        H.v('    offre.restant ne baisse pas pour les trois achetées (10, 10, 10) puis 9, 8', restants, [10, 10, 10, 9, 8]);
        H.v('    solde achete 0 ; compteur du jour 2 (et non 5) ; 3 mouvements de débit sur la poche achete, delta -1', [await achete(p), await cnt(p), (await mouv(p, { type: 'debit', poche: 'achete' })).map(m => m.delta)], [0, 2, [-1, -1, -1]]);
        const so = await S.solde(p, cfg, t);
        H.v('    le Solde servi dit achete 0 (déjà servi, relu en base)', so.achete, 0);
        H.v('    réconciliation : aucun écart (net achete = -3, net jour sans mouvement de poche)', [(await recon(p)).ecarts, await netPoche(p, 'achete')], [[], -3]);
    }
    {
        const p = await instPlein(2, { essais: 0 }); const rs = []; for (let i = 0; i < 6; i++) rs.push(await deb(p));
        H.v('2b. installation non liée à 2 achetées : achete, achete, puis 3 du jour, puis QUOTA', poches(rs), ['achete', 'achete', 'jour', 'jour', 'jour', 'QUOTA']);
        H.v('    achete 0, compteur du jour 3', [await achete(p), await cnt(p)], [0, 3]);
    }
    {   // le QUOTA ne se rend qu'une fois achete ET jour épuisés
        const p = await comptePlein(1); await db.col('quota_jour').insertOne({ porteur: `compte:${p.id}`, jour: JOUR, count: 10, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const a = await deb(p), b = await deb(p);
        H.v('2c. quota du jour épuisé mais 1 achetée : l\'analyse passe (achete), la suivante est un QUOTA ; le compteur du jour reste à 10', [poches([a, b]), await cnt(p), await achete(p)], [['achete', 'QUOTA'], 10, 0]);
    }

    // ── 3. la course : jamais négatif, jamais de double débit
    {
        const p = await comptePlein(5); const rs = await Promise.all(Array.from({ length: 30 }, () => deb(p)));
        const ps = poches(rs);
        H.v('3a. 30 débits simultanés sur 5 achetées + 10 du jour : exactement 5 achete, 10 jour, 15 QUOTA', [ps.filter(x => x === 'achete').length, ps.filter(x => x === 'jour').length, ps.filter(x => x === 'QUOTA').length], [5, 10, 15]);
        H.v('    achete exactement 0 (jamais négatif), compteur du jour 10 (jamais 11), 15 mouvements de débit', [await achete(p), await cnt(p), (await mouv(p, { type: 'debit' })).length], [0, 10, 15]);
        H.v('    réconciliation sans écart', (await recon(p)).ecarts, []);
        const q = await comptePlein(1); const deux = await Promise.all(Array.from({ length: 12 }, () => deb(q)));
        H.v('3b. 12 simultanés sur UNE achetée : une seule prend achete', [poches(deux).filter(x => x === 'achete').length, await achete(q)], [1, 0]);
    }
    {   // valeurs corrompues : une poche non entière ou négative n'est jamais débitée
        const f = await comptePlein(0.5), n = await comptePlein(-2), i = await inst({ achete: -1 });
        const r = [await deb(f), await deb(n), await deb(i)];
        H.v('3c. achete 0.5, -2 et -1 : jamais débitée (le quota du jour passe), valeurs intactes', [poches(r), await achete(f), await achete(n), await achete(i)], [['jour', 'jour', 'jour'], 0.5, -2, -1]);
    }

    // ── 4. l'idempotence : la même clé ne débite qu'une fois, le rejeu rend le même corps
    {
        const p = await comptePlein(3); const k = cle(), sid = cle();
        const un = await deb(p, { cle: k, scanId: sid }); const rejeu = await deb(p, { cle: k, scanId: sid });
        H.v('4a. rejeu séquentiel de la même clé : rejoue, même crédit, une seule unité prise (achete 2)', [un.ok, rejeu.rejoue, rejeu.credit, un.credit, await achete(p)], [true, true, { poche: 'achete' }, { poche: 'achete' }, 2]);
        const k2 = cle(); const dix = await Promise.all(Array.from({ length: 10 }, () => deb(p, { cle: k2 })));
        H.v('4b. dix requêtes SIMULTANÉES de même clé : une seule unité (achete 1), 1 mouvement, toutes ok avec le même crédit', [dix.every(r => r.ok), new Set(dix.map(r => JSON.stringify(r.credit))).size, await achete(p), (await mouv(p, { cleIdempotence: k2 })).length], [true, 1, 1, 1]);
        H.v('    réconciliation propre', (await recon(p)).ecarts, []);
    }

    // ── 5. le remboursement rend dans la poche d'ORIGINE, sous les plafonds, par chaque chemin
    {   // 5a constaté (introuvable), panne (infra)
        const p = await comptePlein(5); const d = await deb(p, { scanId: 'c1' }); const j = await deb(p, { scanId: 'c1b' });
        const r = await Lg.rembourser(p, d.credit, 'introuvable', { scanId: 'c1', maintenant: t }, cfg);
        H.v('5a. introuvable (constaté) payé sur achete : rendu à achete (5 - 2 débits + 1 = 4), quota du jour inchangé, plafond constaté compté 1', [r.rendu, await achete(p), await cnt(p), (await db.col('plafonds').findOne({ porteur: `compte:${p.id}`, type: 'constate' })).count], [true, 4, 0, 1]);
        const rp = await Lg.rembourser(p, j.credit, 'panne-SERVEUR', { scanId: 'c1b', maintenant: t }, cfg);
        H.v('    panne SERVEUR (infra, hors plafond) : rendue à achete, aucun compteur de plafond de plus', [rp.rendu, await achete(p), (await db.col('plafonds').find({ porteur: `compte:${p.id}` }).toArray()).map(x => x.count)], [true, 5, [1]]);
        const tr = await mouv(p, { type: 'remboursement' });
        H.v('    les traces de remboursement portent la poche achete, delta +1 ; net achete 0, réconciliation propre', [tr.map(m => [m.poche, m.delta]), await netPoche(p, 'achete'), (await recon(p)).propre], [[['achete', 1], ['achete', 1]], 0, true]);
        const r2 = await Lg.rembourser(p, d.credit, 'introuvable', { scanId: 'c1', maintenant: t }, cfg);
        H.v('    un second remboursement du même scan : refusé (deja-rembourse), achete reste 5', [r2.rendu, r2.raisonNonRembourse, await achete(p)], [false, 'deja-rembourse', 5]);
    }
    {   // 5b déclaré : « aucune » / « ne-sait-pas »
        const p = await comptePlein(5); const a = await poserQuestion(p); const b = await poserQuestion(p);
        H.v('5b. deux questions payées sur achete : achete 3', [a.r.etat, b.r.etat, await achete(p)], ['en-attente', 'en-attente', 3]);
        const ra = await Q.repondreQuestion(p, { scanId: a.scanId, carte: 0, choix: 'aucune' }, cfg, h(1));
        H.v('    « aucune » : remboursee, rendue à achete (4), quota du jour 0, compteur « declare » 1', [ra.etat, await achete(p), await cnt(p), (await db.col('plafonds').findOne({ porteur: `compte:${p.id}`, type: 'declare' })).count], ['remboursee', 4, 0, 1]);
        const rb = await Q.repondreQuestion(p, { scanId: b.scanId, carte: 0, choix: 'c1' }, cfg, h(1));
        H.v('    répondre par un candidat : débité, rien ne revient (achete 4), aucun mouvement de plus', [rb.etat, await achete(p), (await mouv(p, { type: 'remboursement' })).length], ['repondue', 4, 1]);
        H.v('    réconciliation propre', (await recon(p)).propre, true);
    }
    {   // 5c plafond atteint : le remboursement est refusé, l'analyse achetée reste consommée (jamais un crédit hors plafond)
        const p = await comptePlein(10); const qs = []; for (let i = 0; i < 4; i++) qs.push(await poserQuestion(p));
        const out = []; for (const q of qs) out.push(await Q.repondreQuestion(p, { scanId: q.scanId, carte: 0, choix: 'aucune' }, cfg, h(1)));
        H.v('5c. plafond des déclarations d\'un compte gratuit (3) : 3 rendues à achete, la 4e refusée (plafond-jour) et reste consommée', [out.map(r => r.etat), out[3].question.raisonNonRembourse, await achete(p)], [['remboursee', 'remboursee', 'remboursee', 'non-remboursee'], 'plafond-jour', 9]);
        const c = await comptePlein(5); const dd = await deb(c, { scanId: 'pc' });
        await db.col('plafonds').insertOne({ porteur: `compte:${c.id}`, jour: JOUR, type: 'constate', count: 50, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const rr = await Lg.rembourser(c, dd.credit, 'introuvable', { scanId: 'pc', maintenant: t }, cfg);
        H.v('    plafond des constatés (gratuit : 50) atteint : refusé (plafond-jour), achete reste 4, aucun mouvement de remboursement', [rr.rendu, rr.raisonNonRembourse, await achete(c), (await mouv(c, { type: 'remboursement', delta: 1 })).length], [false, 'plafond-jour', 4, 0]);
        H.v('    et le plafond n\'a pas été « offert » par la poche : le compteur reste à 50 (le refus rend son jeton)', (await db.col('plafonds').findOne({ porteur: `compte:${c.id}`, type: 'constate' })).count, 50);
    }
    {   // 5d abandon à 24 h par le balayage, à +25 h
        const p = await comptePlein(4); const a = await poserQuestion(p), b = await poserQuestion(p);
        const bi = await Q.balayerQuestions({ maintenant: h(25), max: 50 }, cfg);
        H.v('5d. balayage à +25 h : 2 questions abandonnées, remboursées à achete (4), quota du jour 0', [bi.reglees, bi.remboursees, await achete(p), await cnt(p)], [2, 2, 4, 0]);
        H.v('    net achete exact (0), réconciliation propre à +25 h', [await netPoche(p, 'achete'), (await recon(p, h(26))).propre], [0, true]);
        const bis = await Q.balayerQuestions({ maintenant: h(26), max: 50 }, cfg);
        H.v('    un second balayage ne rend plus rien (achete reste 4)', [bis.remboursees, await achete(p)], [0, 4]);
        const c = await comptePlein(2); const q = await poserQuestion(c);
        const r = await Q.repondreQuestion(c, { scanId: q.scanId, carte: 0, choix: 'c1' }, cfg, h(25));
        H.v('    réponse tardive (410) : réglée comme abandonnée, rendue à achete (2)', [r.statut, await achete(c)], [410, 2]);
    }
    {   // 5e rembourserLigne, sans-prix déclaré
        const p = await comptePlein(3); const d = await deb(p, { scanId: 'l1' });
        const r = await Lg.rembourserLigne(p, d.cle, 'panne-SERVEUR', { maintenant: t }, cfg);
        H.v('5e. rembourserLigne : rendu à achete (3), quota 0', [r.rendu, await achete(p), await cnt(p)], [true, 3, 0]);
        const s = await deb(p, { scanId: 'sp' });
        const rs = await Lg.rembourser(p, { poche: null }, 'sans-prix', { scanId: 'sp', compteur: 'sans-prix', maintenant: t }, cfg);
        H.v('    prix illisible définitif (sans-prix, déclaré) : rendu à achete, compteur declare 1', [s.credit.poche, rs.rendu, await achete(p), (await db.col('plafonds').findOne({ porteur: `compte:${p.id}`, type: 'declare' })).count], ['achete', true, 3, 1]);
    }
    {   // 5f réparation d'un débit pris sans trace (arrêt entre la prise et le crédit)
        const p = await comptePlein(3); await deb(p, { scanId: 'rp1' });
        const orig = db.col; let mort = false;
        db.col = nom => new Proxy(orig(nom), { get(c, m) { const v = c[m]; if (typeof v !== 'function') return v;
            return (...a) => { if (!mort && nom === 'comptes' && m === 'updateOne') mort = true; if (mort) return Promise.reject(new Error('arrêt simulé')); return v.apply(c, a); }; } });
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne-SERVEUR', { scanId: 'rp1', maintenant: t }, cfg)); } finally { db.col = orig; }
        const avant = await achete(p);
        const r = await muet(() => Lg.reparerDebitRembourseSansMouvement(p, { scanId: 'rp1', maintenant: h(4) }, cfg));
        H.v('5f. débit achete pris puis coupure avant le crédit : la réparation rend à achete UNE fois (2 -> 3), mouvement +1 sur la poche achete', [avant, r.repare, r.creditRendu, r.poche, await achete(p), (await mouv(p, { type: 'remboursement', delta: 1 })).map(m => m.poche)], [2, true, true, 'achete', 3, ['achete']]);
        const r2 = await muet(() => Lg.reparerDebitRembourseSansMouvement(p, { scanId: 'rp1', maintenant: h(5) }, cfg));
        H.v('    un second appel ne crédite pas (rien-a-reparer), net achete 0, réconciliation propre', [r2.raison, await achete(p), await netPoche(p, 'achete'), (await recon(p, h(6))).propre], ['rien-a-reparer', 3, 0, true]);
    }
    {   // 5g le marqueur d'identité : un débit ne se rend jamais deux fois, quel que soit le chemin
        const p = await comptePlein(3); const d = await deb(p, { scanId: 'mq' }); const mv = await db.col('mouvements').findOne({ cleIdempotence: d.cle });
        const x1 = await Lg.rendrePoche(p, d.credit, cfg, t, mv._id), x2 = await Lg.rendrePoche(p, d.credit, cfg, t, mv._id);
        H.v('5g. même débit rendu deux fois (deux chemins) : un seul crédit, poche-deja-compensee, achete 3', [x1.rendu, x2.rendu, x2.raison, await achete(p)], [true, false, 'poche-deja-compensee', 3]);
    }

    // ── 6. un lot qui chevauche les deux poches : chaque unité est rendue à SA poche
    {
        const p = await comptePlein(2);
        const d = await deb(p, { scanId: 'lot1', cle: 'lot1' });
        const s = await Lot.debiterSupplement(p, { scanId: 'lot1', unites: 2, cleIdempotence: 'lot1|supplement', maintenant: t }, cfg);
        H.v('6a. lot de 23 cartes (coût 3) avec 2 achetées : unités achete, achete, jour', [d.ok, s.ok, [d.credit, ...s.credits].map(c => c.poche)], [true, true, ['achete', 'achete', 'jour']]);
        H.v('    achete 0, compteur du jour 1 (une seule unité du quota), offre.restant 9', [await achete(p), await cnt(p), (await Of.offre(p, cfg, t)).restant], [0, 1, 9]);
        const r = await Lg.rembourserLot(p, [d.credit, ...s.credits], 'introuvable', { scanId: 'lot1', maintenant: t }, cfg);
        const tr = (await mouv(p, { type: 'remboursement', delta: 1 })).map(m => m.poche).sort();
        H.v('    lot entièrement introuvable rendu : achete 2, compteur 0, traces [achete, achete, jour]', [r.rendu, await achete(p), await cnt(p), tr], [true, 2, 0, ['achete', 'achete', 'jour']]);
        H.v('    net de chaque poche exact (achete 0 ; jour 0 sans mouvement de poche), réconciliation propre', [await netPoche(p, 'achete'), (await recon(p)).propre], [0, true]);
    }
    {   // le lot qui ne peut pas être payé : tout ou rien, les suppléments annulés rendent leur poche, le débit initial rendu par lot-trop-grand
        const p = await comptePlein(1); await db.col('quota_jour').insertOne({ porteur: `compte:${p.id}`, jour: JOUR, count: 9, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const d = await deb(p, { scanId: 'lot2', cle: 'lot2' });
        const s = await Lot.debiterSupplement(p, { scanId: 'lot2', unites: 2, cleIdempotence: 'lot2|supplement', maintenant: t }, cfg);
        H.v('6b. lot de 23 avec 1 achetée et 1 seule du jour restante : le supplément manque (QUOTA), tout ou rien : la unité du jour prise puis annulée, compteur 9, achete 0 (le débit initial attend son remboursement)', [d.credit.poche, s.ok, s.code, await cnt(p), await achete(p)], ['achete', false, 'QUOTA', 9, 0]);
        const r = await Lg.rembourser(p, d.credit, 'lot-trop-grand', { scanId: 'lot2', maintenant: t, compteur: 'lot-trop-grand' }, cfg);
        H.v('    le débit initial rendu (lot-trop-grand) : retourne à achete (1), compteur du jour intact (9)', [r.rendu, await achete(p), await cnt(p)], [true, 1, 9]);
        H.v('    net exact par poche (achete 0, jour : 1 débit + 1 annulation), réconciliation propre', [await netPoche(p, 'achete'), await netPoche(p, 'jour'), (await recon(p)).propre], [0, 0, true]);
        const c = await comptePlein(2); const dc = await deb(c, { scanId: 'lot3', cle: 'lot3' });
        await db.col('plafonds').insertOne({ porteur: `compte:${c.id}`, jour: JOUR, type: 'lot-trop-grand', count: 10, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const rc = await Lg.rembourser(c, dc.credit, 'lot-trop-grand', { scanId: 'lot3', maintenant: t, compteur: 'lot-trop-grand' }, cfg);
        H.v('6c. refus de lot au-delà de 10 par jour : le remboursement est refusé (plafond-jour), achete reste 1 (jamais rendu hors plafond)', [rc.rendu, rc.raisonNonRembourse, await achete(c)], [false, 'plafond-jour', 1]);
    }
    {   // un lot qui chevauche, rendu en partie : l'unité du jour revient au compteur, l'unité achetée reste prise tant qu'elle n'est pas rendue (prise atomique par unité)
        const p = await comptePlein(1); const d = await deb(p, { scanId: 'lot4', cle: 'lot4' });
        const s = await Lot.debiterSupplement(p, { scanId: 'lot4', unites: 2, cleIdempotence: 'lot4|supplement', maintenant: t }, cfg);
        const rien = await Lg.rembourserLot(p, [d.credit, ...s.credits], 'introuvable', { scanId: 'lot4', maintenant: t }, cfg);
        const rien2 = await Lg.rembourserLot(p, [d.credit, ...s.credits], 'introuvable', { scanId: 'lot4', maintenant: t }, cfg);
        H.v('6d. lot achete+jour+jour : le remboursement rend les trois unités en un geste (achete 1, compteur 0) ; rejoué, rien de plus', [d.credit.poche, s.credits.map(c => c.poche), rien.rendu, rien.unites, rien2.rendu, rien2.raisonNonRembourse, await achete(p), await cnt(p)], ['achete', ['jour', 'jour'], true, 3, false, 'deja-rembourse', 1, 0]);
    }

    // ── 7. achete à 0 (ou absente) : le grand livre d'aujourd'hui
    {
        const zero = await compte({ solde: { accueil: 0, achete: 0 } }), absent = await compte({ solde: { accueil: 0 } }), inst0 = await inst({ achete: 0 }), instA = await inst();
        await db.col('installations').updateOne({ _id: instA.id }, { $unset: { achete: '' } });      // le champ n'existe pas du tout
        // la clé d'idempotence est unique dans toute la base : chaque porteur a sa marque, retirée avant de comparer les deux grands livres
        const rejouer = async (p, m) => { for (let i = 0; i < 12; i++) await deb(p, { scanId: `${m}-u${i}`, cle: `${m}-u${i}` });
            await Lg.rembourser(p, { x: 1 }, 'introuvable', { scanId: `${m}-u0`, maintenant: t }, cfg); await Lg.rembourserLigne(p, `${m}-u1`, 'panne-SERVEUR', { maintenant: t }, cfg);
            const q = await Lot.debiterSupplement(p, { scanId: `${m}-uL`, unites: 2, cleIdempotence: `${m}-uL|supplement`, maintenant: t }, cfg); return q; };
        await rejouer(zero, 'Z'); await rejouer(absent, 'A'); await rejouer(inst0, 'I'); await rejouer(instA, 'J');
        const e0 = (await empreinte(zero)).split('Z-').join(''), eA = (await empreinte(absent)).split('A-').join(''), i0 = (await empreinte(inst0)).split('I-').join(''), iA = (await empreinte(instA)).split('J-').join('');
        H.vrai('7a. achete 0 et achete absente : exactement le même grand livre (mouvements, crédits, compteur) pour le compte', e0 === eA);
        H.vrai('    idem pour l\'installation (achete 0 contre champ à la valeur par défaut)', i0 === iA);
        const docs = JSON.stringify([(await lire(zero)).solde, (await lire(absent)).solde, (await lire(inst0)).achete]);
        H.v('    aucun document de poche écrit : soldes achete inchangés (0, absent, 0)', docs, JSON.stringify([{ accueil: 0, achete: 0 }, { accueil: 0 }, 0]));
        const so = JSON.parse(e0);
        H.v('    tous les crédits sont de la poche « jour » (forme { poche, jour }) : aucun mouvement ne porte « achete »', [so.ms.filter(m => m.type === 'debit').every(m => m.poche === 'jour' && m.credit.poche === 'jour'), so.ms.some(m => m.poche === 'achete')], [true, false]);
        // la forme du résultat d'un débit : exactement celle d'aujourd'hui
        const r = await deb(await compte({ solde: { accueil: 0, achete: 0 } }), { cle: 'forme' });
        H.v('    le résultat d\'un débit « jour » : { ok, credit: { poche, jour, porteurCle }, cle } — pas un champ de plus', [Object.keys(r), Object.keys(r.credit)], [['ok', 'credit', 'cle'], ['poche', 'jour', 'porteurCle']]);
    }

    // ── 8. les garde-fous : administrateur, compte non vérifié, installation liée
    {
        const ad = await comptePlein(5, { role: 'administrateur' }); const rs = []; for (let i = 0; i < 4; i++) rs.push(await deb(ad));
        H.v('8a. administrateur avec 5 achetées : débit 0, motif administrateur, achete intact', [rs.every(r => r.ok && r.administrateur), await achete(ad), (await mouv(ad, { type: 'debit' })).every(m => m.delta === 0 && m.motif === 'administrateur')], [true, 5, true]);
        const faux = await comptePlein(3); faux.administrateur = true; const rf = await deb(faux);
        H.v('    administrateur FORGÉ (rôle absent en base) : traité en compte ordinaire, il paie sur achete', [poches([rf]), await achete(faux)], [['achete'], 2]);
        const nv = await comptePlein(2, { verifie: false }); const r = []; for (let i = 0; i < 3; i++) r.push(await deb(nv));
        H.v('8b. compte NON vérifié avec 2 achetées (payées, donc déjà à lui) : achete, achete, puis VERIFICATION', poches(r), ['achete', 'achete', 'VERIFICATION']);
        const nv0 = await comptePlein(0, { verifie: false });
        H.v('    non vérifié sans achetée : VERIFICATION comme aujourd\'hui, aucun compteur', [poches([await deb(nv0)]), await cnt(nv0)], [['VERIFICATION'], 0]);
        const lie = await inst({ achete: 4, compteId: (await compte()).id });
        H.v('8c. installation LIÉE à un compte (instantané périmé) portant des achetées : jamais débitée (QUOTA), poche intacte', [poches([await deb(lie)]), await achete(lie)], [['QUOTA'], 4]);
        const fantome = { type: 'compte', id: new (require('mongoose').Types.ObjectId)(), compte: null, installation: null, surface: 'scanner', administrateur: false };
        H.v('    compte introuvable : QUOTA, aucun mouvement', [poches([await deb(fantome)]), (await mouv(fantome)).length], [['QUOTA'], 0]);
    }

    // ── 9. ce qui est servi : le Solde et le contrôle sans débit (scanner)
    {
        const p = await comptePlein(1); await db.col('quota_jour').insertOne({ porteur: `compte:${p.id}`, jour: JOUR, count: 10, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const avant = await S.peutPayer(p, cfg, t); await deb(p); const apres = await S.peutPayer(p, cfg, t);
        H.v('9a. peutPayer : quota épuisé mais 1 achetée -> ok ; achetée consommée -> QUOTA', [avant.ok, apres.ok, apres.code], [true, false, 'QUOTA']);
        const nv = await comptePlein(1, { verifie: false }), nv0 = await comptePlein(0, { verifie: false });
        H.v('    non vérifié : ok avec une achetée, VERIFICATION sans', [(await S.peutPayer(nv, cfg, t)).ok, (await S.peutPayer(nv0, cfg, t)).code], [true, 'VERIFICATION']);
        const i = await inst({ essais: 0, achete: 1 }); await db.col('quota_jour').insertOne({ porteur: `installation:${i.id}`, jour: JOUR, count: 3, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const lie = await inst({ achete: 2, compteId: (await compte()).id });
        H.v('    installation non liée : ok avec une achetée ; installation LIÉE : refusée comme aujourd\'hui', [(await S.peutPayer(i, cfg, t)).ok, (await S.peutPayer(lie, cfg, t)).ok], [true, false]);
        const so = await S.solde(await comptePlein(7), cfg, t), si = await S.solde(await inst({ achete: 5 }), cfg, t);
        H.v('9b. solde.achete servi pour un compte et pour une installation', [so.achete, si.achete], [7, 5]);
    }

    // ── 10. la suppression du compte : 409 CREDITS_ACHETES tant que achete > 0
    {
        const P2 = require('../comptes/mots-de-passe'); const svc = require('../comptes/service');
        const hash = await P2.hacher('un-mot-de-passe-solide');
        const c = await compte({ solde: { accueil: 0, achete: 2 }, motDePasse: hash });
        await deb(c);
        const frais = async () => db.col('comptes').findOne({ _id: c.id });
        const r1 = await svc.supprimerCompte({ compte: await frais(), motDePasse: 'un-mot-de-passe-solide', renonciation: false, cfg });
        H.v('10a. 1 achetée restante après une analyse payée dessus : 409 CREDITS_ACHETES, rien supprimé', [r1.statut, r1.code, await db.col('comptes').countDocuments({ _id: c.id })], [409, 'CREDITS_ACHETES', 1]);
        await deb(c);
        const r2 = await svc.supprimerCompte({ compte: await frais(), motDePasse: 'un-mot-de-passe-solide', renonciation: false, cfg });
        H.v('10b. toutes consommées (achete 0) : la suppression passe sans renonciation', [r2.statut, await db.col('comptes').countDocuments({ _id: c.id })], [200, 0]);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
