'use strict';
// Banc O5 — la MARQUE DE LIVRAISON d'un scan (v2/argent/marque-scan.js) : aucun crédit n'est pris sans marque, et un scan dont la réponse n'est jamais partie est rendu
// (ou confirmé) au rattrapage, UNE seule fois. Base : la base EN MÉMOIRE du banc (INT2) — jamais la production, ni R2. Aucun réseau.
// Les bancs de coupure par VRAI arrêt de processus sont dans test-coupure-processus.js ; ici : la logique (unités, courses, route, minuteurs, réconciliation).
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const registre = require('../registre');
const R = require('../argent/reconcilier');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const ORIGINE = cfg.origines.extension;
const MIN = 60e3;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.12.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-o5-${Date.now().toString(36)}-${++nCle}`;
const attendre = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(f, delaiMs = 10000) { const t0 = Date.now(); for (;;) { if (await f()) return true; if (Date.now() - t0 > delaiMs) return false; await attendre(20); } }
const marques = () => db.col('scans_en_cours');
const lireMarque = id => marques().findOne({ _id: id });
const essais = async p => (await db.col('installations').findOne({ _id: p.id })).essais;
const achete = async p => (await db.col('installations').findOne({ _id: p.id })).achete;
const mouvements = p => db.col('mouvements').find(p.type === 'compte' ? { compteId: p.id } : { installationId: p.id }).sort({ _id: 1 }).toArray();
const somme = async p => (await mouvements(p)).reduce((t, m) => t + m.delta, 0);
const rembs = async p => (await mouvements(p)).filter(m => m.type === 'remboursement' && m.delta === 1).length;

(async () => {
    await H.ouvrirBac('test-marque-scan.js'); await M.creerIndex();
    const express = require('express');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index'); const pret = require('../pret');
    const MS = (() => { try { return require('../argent/marque-scan'); } catch (e) { return { erreur: e }; } })();
    H.vrai(`le module v2/argent/marque-scan.js existe${MS.erreur ? ` (${MS.erreur.message.split('\n')[0]})` : ''}`, !MS.erreur);
    if (MS.erreur) { H.bilan(); return; }
    const { compte, inst } = require('./_aide-argent');
    // Le registre « argent » (le vrai ledger, configuré) : monté comme le fait l'assembleur.
    require('../argent/monter').routes(express.Router(), cfg, {});
    const argent = registre.obtenir('argent');

    // ── fabrique d'un scan « dont le processus est mort » : marque ouverte (âge donné), débit(s) réel(s) au ledger, aucune réponse
    let nScan = 0;
    async function scanMort({ unites = 1, age = 20 * MIN, cleClaim = null, essaisInit = 3, acheteInit = 0 } = {}) {
        const p = await inst({ essais: essaisInit, achete: acheteInit });
        const scanId = new ObjectId(), cleDebit = `scan|${p.type}:${p.id}|mort${++nScan}`;
        await MS.ouvrir({ scanId, porteur: p, cleDebit, cleClaim, maintenant: new Date(Date.now() - age) });
        await argent.debiter(p, { scanId, cleIdempotence: cleDebit });
        if (unites > 1) await argent.debiterSupplement(p, { scanId, unites: unites - 1, cleIdempotence: `${cleDebit}|supplement` });
        return { p, scanId, cleDebit };
    }
    const sec = { argent };   // la passe se joue sur le registre réel

    // ═══════════ 1. la forme de la marque : petite, sans adresse ni contenu d'annonce, ouverte en 'en-suspens'
    {
        const p = await inst(); const scanId = new ObjectId();
        await MS.ouvrir({ scanId, porteur: p, cleDebit: `scan|installation:${p.id}|forme1`, cleClaim: `installation:${p.id}|identifier|forme1` });
        const m = await lireMarque(scanId);
        H.v('1. marque ouverte : champs exacts (_id, porteur, cleDebit, cleClaim, etat, ouverteLe, batLe) — ni IP, ni titre, ni description, ni image', Object.keys(m).sort(), ['_id', 'batLe', 'cleClaim', 'cleDebit', 'etat', 'ouverteLe', 'porteur']);
        H.v('   etat en-suspens, porteur {type,id}, aucune date de clôture ni expiration (une marque non close ne doit JAMAIS expirer)', [m.etat, m.porteur, m.closLe, m.expireLe], ['en-suspens', { type: 'installation', id: p.id }, undefined, undefined]);
        const { BSON } = require('mongodb');
        const tOuverte = BSON.calculateObjectSize(m);
        await MS.clore(scanId, { cfg });
        const c = await lireMarque(scanId);
        H.v('   close : etat livre, closLe et expireLe posés (TTL 7 jours, 30 au plus), plus aucun champ ajouté hors priseLe', [c.etat, c.closLe instanceof Date, c.expireLe instanceof Date, Math.round((c.expireLe - c.closLe) / 86400e3)], ['livre', true, true, 7]);
        console.log(`   (taille d'un document de marque : ${tOuverte} octets ouverte, ${BSON.calculateObjectSize(c)} octets close ; l'index TTL expireLe + l'index (etat, ouverteLe) s'y ajoutent)`);
        H.vrai('   la taille reste sous 400 octets', BSON.calculateObjectSize(c) < 400);
        const idx = await marques().indexes();
        H.vrai('   deux index déclarés dans modeles.js : (etat, ouverteLe) et un TTL sur expireLe, et verifierIndex n\'en manque aucun', idx.some(i => i.expireAfterSeconds === 0 && i.key.expireLe === 1) && idx.some(i => i.key.etat === 1 && i.key.ouverteLe === 1) && (await M.verifierIndex()).manquants.length === 0);
    }

    // ═══════════ 2. une marque trop jeune, ou dont le processus BAT encore, n'est pas touchée
    {
        const jeune = await scanMort({ age: 4 * MIN });                         // sous le plancher d'âge de 5 min (horloge décalée entre instances) : même sans battement
        const vivant = await scanMort({ age: 40 * MIN });                       // une requête de 40 min mais VIVANTE : elle vient de battre (l'heure du serveur Mongo)
        await MS.battre(vivant.scanId);
        const b = await MS.rattraper(sec);
        H.v('2. marque de 4 min (plancher 5 min) : non examinée, solde inchangé (essais 2)', [await essais(jeune.p), (await lireMarque(jeune.scanId)).etat], [2, 'en-suspens']);
        H.v('   marque de 40 min dont le battement est FRAIS : non examinée, non rendue (essais 2) — une requête longue mais vivante n\'est jamais rendue ; 0 examen au total', [await essais(vivant.p), (await lireMarque(vivant.scanId)).etat, b.examinees], [2, 'en-suspens', 0]);
        await MS.battre(vivant.scanId);
        const perimee = await scanMort({ age: 40 * MIN }); await marques().updateOne({ _id: perimee.scanId }, { $set: { batLe: new Date(Date.now() - 2 * MIN) } });
        const b2 = await MS.rattraper(sec);
        H.v('   battement vieux de 2 min (3 battements manqués = 90 s) : prise et rendue ; la marque qui bat reste intacte', [b2.examinees, await essais(perimee.p), (await lireMarque(perimee.scanId)).etat, (await lireMarque(vivant.scanId)).etat], [1, 3, 'rendu', 'en-suspens']);
        H.v('   le battement ne se pose que sur une marque en-suspens, à l\'heure de la base (batLe plus récent après battre())', (await lireMarque(vivant.scanId)).batLe.getTime() > Date.now() - 30e3, true);
        await marques().deleteOne({ _id: jeune.scanId }); await marques().deleteOne({ _id: vivant.scanId });
    }

    // ═══════════ 3. un scan mort depuis plus de 15 min est rendu, sans plafond, motif arret-serveur
    {
        const s = await scanMort({ unites: 3, essaisInit: 1, acheteInit: 4 });          // 1 essai + 2 achetés pris
        const avant = [await essais(s.p), await achete(s.p)];
        const b = await MS.rattraper(sec);
        const m = await lireMarque(s.scanId);
        H.v('3. lot de 3 unités mort : toutes rendues poche par poche (essai 1, acheté 4), somme des delta 0, 1 rendu au bilan', [avant, [await essais(s.p), await achete(s.p)], await somme(s.p), b.rendues], [[0, 2], [1, 4], 0, 1]);
        H.v('   marque rendu, motif de la trace arret-serveur, plafonds de pannes du porteur NON consommés (sansPlafond)', [m.etat, (await mouvements(s.p)).filter(x => x.type === 'remboursement').every(x => x.motif === 'arret-serveur'), (await db.col('plafonds').find({ porteur: `installation:${s.p.id}` }).toArray()).reduce((t, x) => t + x.count, 0)], ['rendu', true, 0]);
        H.vrai('   priseLe et closLe posées, expireLe ≤ 30 jours', m.priseLe instanceof Date && m.closLe instanceof Date && (m.expireLe - m.closLe) <= 30 * 86400e3);
    }

    // 3b. la marque a précédé un débit qui n'a jamais eu lieu (arrêt entre l'ouverture et le débit) : rien à rendre, la marque se clôt sans rembourser
    {
        const p = await inst({ essais: 3 }); const scanId = new ObjectId();
        await MS.ouvrir({ scanId, porteur: p, cleDebit: `scan|installation:${p.id}|sansdebit`, maintenant: new Date(Date.now() - 20 * MIN) });
        const b = await MS.rattraper(sec);
        H.v('3b. marque sans aucun débit (arrêt entre l\'ouverture et le débit) : état sans-debit, aucun remboursement, solde intact (essais 3)', [(await lireMarque(scanId)).etat, b.sansDebit, await rembs(p), await essais(p)], ['sans-debit', 1, 0, 3]);
    }

    // ═══════════ 4. la passe jouée deux fois : UN remboursement
    {
        const s = await scanMort();
        const b1 = await MS.rattraper(sec), b2 = await MS.rattraper(sec);
        H.v('4. passe jouée deux fois sur le même scan mort : un seul remboursement (essais 3, une ligne +1), la 2e passe n\'examine rien', [await essais(s.p), await rembs(s.p), await somme(s.p), b1.rendues, b2.examinees], [3, 1, 0, 1, 0]);
    }

    // ═══════════ 5. deux passes concurrentes : UN gagnant, UN remboursement
    {
        const s = await scanMort({ unites: 2, essaisInit: 3 });
        const [a, b] = await Promise.all([MS.rattraper(sec), MS.rattraper(sec)]);
        H.v('5. deux passes simultanées : exactement un examen au total, deux unités rendues UNE fois chacune (essais 3), somme 0', [a.examinees + b.examinees, await essais(s.p), await rembs(s.p), await somme(s.p)], [1, 3, 2, 0]);
        // 6 passes à la fois sur 5 scans : chaque scan rendu une fois
        const lot = []; for (let i = 0; i < 5; i++) lot.push(await scanMort({ essaisInit: 3 }));
        const bs = await Promise.all(Array.from({ length: 6 }, () => MS.rattraper(sec)));
        H.v('   6 passes simultanées sur 5 scans morts : 5 examens au total, chaque scan rendu une fois (essais 3 partout, 1 ligne +1 chacun)',
            [bs.reduce((t, x) => t + x.examinees, 0), (await Promise.all(lot.map(x => essais(x.p)))).join(), (await Promise.all(lot.map(x => rembs(x.p)))).join()], [5, '3,3,3,3,3', '1,1,1,1,1']);
    }

    // ═══════════ 6. la passe contre la fin normale du scan, au même instant : exactement UNE issue
    {
        const issues = { livre: 0, rendu: 0 }; let violations = 0;
        const apres = (ms, f) => new Promise(r => setTimeout(r, ms)).then(f);
        for (let i = 0; i < 40; i++) {
            const s = await scanMort();
            const [da, db_] = [[0, 0], [0, 2], [2, 0], [0, 4], [4, 0], [1, 1], [0, 6], [6, 0]][i % 8];   // les deux gestes sont décalés de 0 à 6 ms : les deux issues doivent se produire
            await Promise.all([apres(da, () => MS.clore(s.scanId, { cfg })), apres(db_, () => MS.rattraper(sec))]);
            const m = await lireMarque(s.scanId), e = await essais(s.p), r = await rembs(s.p);
            if (m.etat === 'livre' && e === 2 && r === 0) issues.livre++;
            else if (m.etat === 'rendu' && e === 3 && r === 1) issues.rendu++;
            else { violations++; console.log(`   ⚠️ course ${i} : état ${m.etat}, essais ${e}, remboursements ${r}`); }
        }
        H.v(`6. 40 courses clore / rattraper au même instant : 0 violation (livre ⇒ non rendu ; rendu ⇒ rendu une fois) — répartition ${JSON.stringify(issues)}`, violations, 0);
        // déterministe : la fin normale GAGNE si elle passe d'abord ; la passe GAGNE si elle passe d'abord (la fin normale ne réécrit alors rien)
        const a = await scanMort(); const ca = await MS.clore(a.scanId, { cfg }); await MS.rattraper(sec);
        H.v('   fin normale d\'abord : livre, passe sans effet (essais 2, 0 remboursement) ; clore a rendu true', [(await lireMarque(a.scanId)).etat, await essais(a.p), await rembs(a.p), ca], ['livre', 2, 0, true]);
        const b = await scanMort(); await MS.rattraper(sec); const cb = await MS.clore(b.scanId, { cfg });
        H.v('   passe d\'abord : rendu, la fin normale tardive ne réécrit rien (clore rend false, état rendu, 1 remboursement)', [(await lireMarque(b.scanId)).etat, cb, await rembs(b.p)], ['rendu', false, 1]);
    }

    // ═══════════ 7. la passe contre un remboursement déjà fait par le scan lui-même
    {
        for (const motif of ['panne-SERVEUR', 'introuvable', 'lot-trop-grand']) {
            const s = await scanMort({ unites: 2, essaisInit: 3 });
            const r0 = await argent.rembourser(s.p, { poche: 'essai' }, motif, { scanId: s.scanId, compteur: 'panne', sansPlafond: motif === 'lot-trop-grand' });
            const avant = await rembs(s.p);
            await MS.rattraper(sec);
            const m = await lireMarque(s.scanId);
            H.v(`7. remboursement déjà fait par le scan (${motif}) puis passe : aucun 2e remboursement (essais 3, ${avant} ligne(s) +1 avant et après), état rendu, issue deja-rembourse`,
                [r0.rendu, await essais(s.p), await rembs(s.p), await somme(s.p), m.etat, m.issue], [true, 3, avant, 0, 'rendu', 'deja-rembourse']);
        }
        // le plafond-jour refusé au scan : le client a été informé (facturation), le rattrapage sans plafond le rendrait — c'est le sens favorable, mais la marque est CLOSE par la route dans ce cas (voir 12)
    }

    // ═══════════ 8. « confirmé » : seulement si la réponse finale est stockée, rejouable, et porte CE scan
    {
        const reponseDe = id => JSON.stringify({ success: true, contrat: 2, scanId: String(id), analyse: { statut: 'identifiee' } });
        const claim = (c, o) => db.col('idempotence').insertOne({ cle: c, empreinteCorps: 'x', etat: 'fini', statut: 200, reponse: null, proprietaire: 'p', creeLe: new Date(), expireLe: new Date(Date.now() + 3600e3), ...o });
        const cas = [
            ['réponse stockée de CE scan, non expirée', s => claim(s.cleClaim, { reponse: reponseDe(s.scanId) }), 'confirme', 2, 0],
            ['réponse stockée d\'un AUTRE scan', s => claim(s.cleClaim, { reponse: reponseDe(new ObjectId()) }), 'rendu', 3, 1],
            ['réponse stockée mais EXPIRÉE (TTL 24 h passé : le client ne peut plus la rejouer)', s => claim(s.cleClaim, { reponse: reponseDe(s.scanId), expireLe: new Date(Date.now() - 1000) }), 'rendu', 3, 1],
            ['claim encore « en-cours » (la route n\'a jamais fini)', s => claim(s.cleClaim, { etat: 'en-cours', reponse: undefined, statut: undefined }), 'rendu', 3, 1],
            ['claim fini mais corps illisible', s => claim(s.cleClaim, { reponse: '{pas du json' }), 'rendu', 3, 1],
            ['claim fini d\'un statut ≥ 300 (jamais stocké par idempotente, mais on ne le suppose pas)', s => claim(s.cleClaim, { statut: 500, reponse: reponseDe(0) }), 'rendu', 3, 1],
            ['aucun claim du tout', async () => { }, 'rendu', 3, 1],
            ['marque sans cleClaim (scanner sans Idempotency-Key)', async () => { }, 'rendu', 3, 1]
        ];
        let i = 0;
        for (const [nom, pose, etatAttendu, essaisAttendus, rembsAttendus] of cas) {
            i++;
            const cleClaim = nom.startsWith('marque sans') ? null : `installation:conf${i}|identifier|conf${i}`;
            const s = await scanMort({ cleClaim });
            await pose({ ...s, cleClaim });
            // le cas « autre scan » écrit la réponse d'un autre ObjectId ; le cas statut ≥ 300 ne doit jamais confirmer
            const b = await MS.rattraper(sec);
            const m = await lireMarque(s.scanId);
            H.v(`8.${i} ${nom} → ${etatAttendu} (essais ${essaisAttendus}, ${rembsAttendus} remboursement)`, [m.etat, await essais(s.p), await rembs(s.p), b.confirmees], [etatAttendu, essaisAttendus, rembsAttendus, etatAttendu === 'confirme' ? 1 : 0]);
        }
    }

    // ═══════════ 9. une question en attente du scan mort est annulée, puis le scan rendu (aucune question répondable sur un crédit rendu)
    {
        const s = await scanMort();
        await argent.reserverQuestion(s.p, { poche: 'essai' }, { scanId: s.scanId, carte: 0, raison: 'egalite', candidats: [1, 2], choix: [{ id: 'a', idProduct: 1 }, { id: 'b', idProduct: 2 }] });
        await MS.rattraper(sec);
        const q = await db.col('questions').findOne({ _id: `${s.scanId}:0` });
        H.v('9. scan mort avec question réservée : question annulée (non-remboursee, annuleePar arret-serveur), crédit rendu UNE fois (essais 3, 1 ligne +1)', [q.etat, q.annuleePar, await essais(s.p), await rembs(s.p)], ['non-remboursee', 'arret-serveur', 3, 1]);
        const rep = await argent.repondreQuestion(s.p, { scanId: s.scanId, carte: 0, choix: 'a' });
        H.v('   répondre ensuite à cette question ne rend rien de plus et n\'offre rien (409 : plus en attente) ; solde inchangé', [rep.statut, await essais(s.p), await rembs(s.p)], [409, 3, 1]);
    }

    // ═══════════ 10. une panne de base pendant la passe : la marque revient en-suspens, la passe suivante rend UNE fois ; une panne durable finit en 'echec' listé
    {
        const s = await scanMort();
        const colOrig = db.col; let casse = true;
        const e0 = console.error; const journal = []; console.error = (...a) => { journal.push(a.join(' ')); };
        db.col = nom => { const c = colOrig(nom); if (casse && nom === 'mouvements') return new Proxy(c, { get: (t, k) => (k === 'find' ? () => { throw Object.assign(new Error('SECRET-HOTE-MONGO'), { code: 'PANNE' }); } : t[k]) }); return c; };
        let b1; try { b1 = await MS.rattraper(sec); } finally { db.col = colOrig; console.error = e0; }
        const m1 = await lireMarque(s.scanId);
        H.v('10. panne de lecture des débits pendant la passe : rien de rendu (essais 2), marque revenue en-suspens (reprise possible), 1 erreur au bilan', [await essais(s.p), m1.etat, b1.erreurs], [2, 'en-suspens', 1]);
        H.vrai('   le journal ne cite jamais le message de l\'erreur (e.message) ni de clé', journal.length > 0 && !journal.some(l => /SECRET-HOTE-MONGO|mort\d+/.test(l)));
        const b2 = await MS.rattraper(sec);
        H.v('   passe suivante : rendu une fois (essais 3, 1 ligne +1), état rendu', [await essais(s.p), await rembs(s.p), (await lireMarque(s.scanId)).etat, b2.rendues], [3, 1, 'rendu', 1]);
    }
    // un échec qui ne passera pas (la poche ne peut pas être rendue) : 'echec' listé, pas de boucle
    {
        const s = await scanMort({ essaisInit: 3 });
        await db.col('installations').updateOne({ _id: s.p.id }, { $set: { essais: 99 } });   // essais au-dessus du plafond de la poche : rendrePoche refuse (« poche-introuvable »)
        const e0 = console.error; console.error = () => { };
        let b; try { b = await MS.rattraper(sec); } finally { console.error = e0; }
        const m = await lireMarque(s.scanId);
        H.v('10b. rendu impossible (poche au plafond) : marque en echec (raison écrite), ligne de débit restituée, jamais de boucle (2e passe : 0 examen)', [m.etat, typeof m.issue, (await MS.rattraper(sec)).examinees], ['echec', 'string', 0]);
        void b;
        // 10c. (mutant « enSuspens sans les echec ») : un echec est LISTÉ par la réconciliation et le verdict n'est pas propre — sans limite d'âge
        const rec = await R.reconcilier(s.p);
        H.v('10c. une marque en echec est listée par la réconciliation (elle n\'expire jamais) et rend le verdict non propre', [rec.marquesEnSuspens.map(x => x.etat), rec.propre], [['echec'], false]);
    }

    // ═══════════ 11. la réconciliation liste les marques en suspens (et le verdict n'est pas « propre » tant qu'il en reste)
    {
        const jeune = await scanMort({ age: 3 * MIN });
        const rj = await R.reconcilier(jeune.p);
        H.v('11. marque de 3 min : pas encore « en suspens » pour la réconciliation (un scan peut durer) ; verdict propre', [rj.marquesEnSuspens.length, rj.propre], [0, true]);
        const long = await scanMort({ age: 40 * MIN }); await MS.battre(long.scanId);
        const rl = await R.reconcilier(long.p);
        H.v('   marque de 40 min dont le processus BAT encore : pas listée (requête longue mais vivante) ; verdict propre', [rl.marquesEnSuspens.length, rl.propre], [0, true]);
        const vieux = await scanMort({ age: 20 * MIN });
        const rv = await R.reconcilier(vieux.p);
        H.v('   marque de 20 min : listée (scanId, état, âge), verdict NON propre alors que somme(delta) = solde', [rv.marquesEnSuspens.map(x => [String(x.scanId), x.etat]), rv.ecarts.length, rv.propre], [[[String(vieux.scanId), 'en-suspens']], 0, false]);
        const tous = await R.reconcilierTous();
        H.vrai('   reconcilierTous la compte aussi (marquesEnSuspens ≥ 1, propre false)', tous.marquesEnSuspens.length >= 1 && tous.propre === false);
        await MS.rattraper(sec);
        const rp = await R.reconcilier(vieux.p);
        H.v('   après la passe : plus aucune marque en suspens pour ce porteur, verdict propre', [rp.marquesEnSuspens.length, rp.propre], [0, true]);
        // une marque en-reprise ancienne (passe morte en route) et une marque en echec sont listées aussi
        const reprise = await scanMort({ age: 40 * MIN });
        await marques().updateOne({ _id: reprise.scanId }, { $set: { etat: 'en-reprise', priseLe: new Date(Date.now() - 30 * MIN) } });
        const rr = await R.reconcilier(reprise.p);
        H.v('   une marque en-reprise ancienne est listée (la passe qui l\'a prise est morte)', [rr.marquesEnSuspens.map(x => x.etat), rr.propre], [['en-reprise'], false]);
        const repris = await MS.rattraper(sec);
        H.v('   et la passe suivante la REPREND (priseLe périmée) et rend une fois', [repris.examinees, (await lireMarque(reprise.scanId)).etat, await essais(reprise.p), await rembs(reprise.p)], [1, 'rendu', 3, 1]);
    }
    // ═══════════ 11b. LA RÉCONCILIATION GLOBALE, sur un état PROPRE (rien d'autre ne la rend non propre) — le mutant « reconcilierTous sans les marques »
    {
        for (const c of ['mouvements', 'installations', 'comptes', 'scans_en_cours', 'idempotence', 'questions', 'analyses', 'plafonds']) await db.col(c).deleteMany({});
        const vide = await R.reconcilierTous();
        H.v('11b. base vide de tout reste : reconcilierTous est propre (contrôle : le verdict peut être vrai)', [vide.propre, vide.marquesEnSuspens.length, vide.avecEcart, vide.rendusEchoues.length], [true, 0, 0, 0]);
        const s = await scanMort({ age: 20 * MIN });
        const t = await R.reconcilierTous();
        H.v('   un seul scan mort (marque périmée, somme(delta) = solde, aucune ligne en échec) : reconcilierTous le liste et n\'est PAS propre', [t.marquesEnSuspens.map(x => String(x.scanId)), t.avecEcart, t.rendusEchoues.length, t.propre], [[String(s.scanId)], 0, 0, false]);
        await MS.rattraper(sec);
        H.v('   après la passe : propre', (await R.reconcilierTous()).propre, true);
    }

    // ═══════════ 11c. un remboursement INTERROMPU par la mort de la passe (ou du scan) : le claim `rb|scanId` est là, les unités sont encore prises — la passe les REPREND (jamais « deja-rembourse » pris pour une preuve)
    {
        const s = await scanMort({ unites: 3, essaisInit: 1, acheteInit: 4 });                // 1 essai + 2 achetés pris
        await db.col('mouvements').insertOne({ installationId: s.p.id, le: new Date(), surface: null, type: 'remboursement', delta: 0, poche: null, motif: 'orphelin', scanId: s.scanId, etat: 'rembourse', cleIdempotence: `rb|${s.scanId}`, expireLe: new Date(Date.now() + 86400e3) });
        const b = await MS.rattraper(sec);
        const m = await lireMarque(s.scanId);
        H.v('11c. claim rb|scanId orphelin (3 unités encore prises) : les 3 unités sont reprises une à une — essai 1, acheté 4, 3 lignes +1, somme(delta) 0, marque rendu issue « repris »', [[await essais(s.p), await achete(s.p)], await rembs(s.p), await somme(s.p), m.etat, m.issue, b.reprises], [[1, 4], 3, 0, 'rendu', 'repris', 3]);
        const b2 = await MS.rattraper(sec);
        H.v('   jouée de nouveau : rien de plus (chaque unité ne se rend qu\'une fois)', [b2.examinees, await rembs(s.p), await essais(s.p)], [0, 3, 1]);
        // reprise PARTIELLE : une unité déjà rendue par le scan avant sa mort, deux encore prises
        const t = await scanMort({ unites: 3, essaisInit: 1, acheteInit: 4 });
        await db.col('mouvements').insertOne({ installationId: t.p.id, le: new Date(), surface: null, type: 'remboursement', delta: 0, poche: null, motif: 'orphelin', scanId: t.scanId, etat: 'rembourse', cleIdempotence: `rb|${t.scanId}`, expireLe: new Date(Date.now() + 86400e3) });
        const premiere = (await db.col('mouvements').find({ installationId: t.p.id, type: 'debit', scanId: t.scanId }).sort({ _id: 1 }).toArray())[0];
        const une = await argent.rembourserLigne(t.p, premiere.cleIdempotence, 'arret-serveur');
        const b3 = await MS.rattraper(sec);
        H.v('   remboursement PARTIEL (1 unité rendue avant la mort, 2 restantes) : la passe reprend exactement les 2 autres — 3 lignes +1 au total, aucune en double', [une.rendu, b3.reprises, await rembs(t.p), [await essais(t.p), await achete(t.p)], await somme(t.p)], [true, 2, 3, [1, 4], 0]);
    }

    // 11c bis. m3 — une unité rendue ENTRE la lecture et la reprise (par le scan lui-même) répond `deja-rembourse` à la reprise : c'est une unité rendue, pas un échec
    {
        const s = await scanMort({ unites: 2, essaisInit: 3 });
        await db.col('mouvements').insertOne({ installationId: s.p.id, le: new Date(), surface: null, type: 'remboursement', delta: 0, poche: null, motif: 'orphelin', scanId: s.scanId, etat: 'rembourse', cleIdempotence: `rb|${s.scanId}`, expireLe: new Date(Date.now() + 86400e3) });
        const concurrent = { rembourser: argent.rembourser, rembourserLigne: async (p, cle, motif) => { await argent.rembourserLigne(p, cle, motif); return { rendu: false, raisonNonRembourse: 'deja-rembourse' }; } };
        const b = await MS.rattraper({ argent: concurrent });
        H.v('11c bis. la reprise répond « deja-rembourse » (rendue entre-temps) : comptée rendue, marque rendu/repris, pas echec', [(await lireMarque(s.scanId)).etat, (await lireMarque(s.scanId)).issue, b.echecs, await rembs(s.p)], ['rendu', 'repris', 0, 2]);
    }

    // ═══════════ 11d. la passe REND AUSSI d'une passe qui rend en parallèle d'une autre passe lente : l'état final ne se pose que si la marque est encore à NOUS (mutant « finir sans condition »)
    {
        const s = await scanMort();
        let lacher; const portillon = new Promise(r => { lacher = r; });
        const lente = { rembourser: async () => { await portillon; return { rendu: false, raisonNonRembourse: 'poche-introuvable' }; }, rembourserLigne: argent.rembourserLigne };
        const pA = MS.rattraper({ argent: lente });
        await jusqua(async () => (await lireMarque(s.scanId)).etat === 'en-reprise');
        await marques().updateOne({ _id: s.scanId }, { $set: { priseLe: new Date(Date.now() - 20 * MIN) } });    // la passe lente est jugée morte : une autre reprend
        const bB = await MS.rattraper(sec);
        lacher(); const bA = await pA;
        const m = await lireMarque(s.scanId);
        H.v('11d. une passe lente est dépassée par une autre qui rend : la marque reste « rendu » (la passe lente ne réécrit PAS en echec), un seul remboursement (essais 3)', [m.etat, m.issue, bB.rendues, bA.echecs, await essais(s.p), await rembs(s.p)], ['rendu', 'rendu', 1, 1, 3, 1]);
    }

    // ═══════════ 11e. une question DÉJÀ RÉPONDUE par un candidat : un résultat A été livré — la passe ne rend rien et clôt en « livre » (mutant « deja-livre traité comme rendu »)
    {
        const s = await scanMort();
        await argent.reserverQuestion(s.p, { poche: 'essai' }, { scanId: s.scanId, carte: 0, raison: 'egalite', candidats: [1, 2], choix: [{ id: 'a', idProduct: 1 }, { id: 'b', idProduct: 2 }] });
        const rep = await argent.repondreQuestion(s.p, { scanId: s.scanId, carte: 0, choix: 'a' });
        const b = await MS.rattraper(sec);
        const m = await lireMarque(s.scanId);
        H.v('11e. question répondue par un candidat puis passe : rien rendu (essais 2, 0 ligne +1), marque « livre » issue question-repondue, comptée confirmée', [rep.statut, await essais(s.p), await rembs(s.p), m.etat, m.issue, b.confirmees], [200, 2, 0, 'livre', 'question-repondue', 1]);
    }

    // ═══════════ 11f. une ligne `analyses` écrite N'EST PAS un résultat livré (l'historique ne donne ni le prix ni les candidats) : la marque d'un processus MORT sans réponse rejouable est RENDUE
    {
        const s = await scanMort();
        await db.col('analyses').insertOne({ _id: s.scanId, porteur: `installation:${s.p.id}`, surface: 'extension', statut: 'identifiee', cartes: [], produits: [], facturation: { debite: 1 }, creeLe: new Date(), expireLe: new Date(Date.now() + 86400e3) });
        const b = await MS.rattraper(sec);
        H.v('11f. marque périmée, analyse écrite mais AUCUNE réponse stockée : rendue (essais 3, 1 ligne +1), pas confirmée', [(await lireMarque(s.scanId)).etat, (await lireMarque(s.scanId)).issue, await essais(s.p), await rembs(s.p), b.confirmees], ['rendu', 'rendu', 3, 1, 0]);
    }

    // ═══════════ 11h. R4 — le ledger pose `rembourse` sur l'unité AVANT de lui rendre son crédit : un arrêt entre les deux laisse une unité « rendue » SANS crédit. La passe ne l'écrit JAMAIS « rendu »
    {
        const s = await scanMort();
        // le repro du relecteur : claim à delta 0, unité marquée `rembourse`, aucune ligne +1 (ce que laisse un SIGKILL entre la prise de l'unité et le rendu de son crédit)
        await db.col('mouvements').insertOne({ installationId: s.p.id, le: new Date(), surface: null, type: 'remboursement', delta: 0, poche: null, motif: 'orphelin', scanId: s.scanId, etat: 'rembourse', cleIdempotence: `rb|${s.scanId}`, expireLe: new Date(Date.now() + 86400e3) });
        await db.col('mouvements').updateOne({ installationId: s.p.id, type: 'debit', scanId: s.scanId }, { $set: { etat: 'rembourse' } });
        const e0 = console.error; const journalR4 = []; console.error = (...a) => { journalR4.push(a.join(' ')); };
        let b; try { b = await MS.rattraper(sec); } finally { console.error = e0; }
        const m = await lireMarque(s.scanId), rec = await R.reconcilier(s.p);
        H.v('11h. unité `rembourse` sans ligne de crédit : marque ECHEC (issue unite-sans-credit), jamais « rendu » ; crédit non recrédité (essais 2) ; journalisé', [m.etat, m.issue, b.echecs, await essais(s.p), journalR4.some(l => /SANS ligne de crédit/.test(l))], ['echec', 'unite-sans-credit', 1, 2, true]);
        H.v('   la réconciliation la LISTE : verdict non propre (alors que somme(delta) = solde)', [rec.marquesEnSuspens.map(x => [x.etat, x.issue]), rec.propre], [[['echec', 'unite-sans-credit']], false]);
        // contrôle (pas de fausse alerte) : une unité de supplément ANNULÉE (sans clé, trace sans scanId) puis le remboursement propre du scan par la route : la passe écrit « rendu/deja-rembourse »
        const p = await inst({ essais: 1, achete: 1 }); const scanId = new ObjectId(), cleDebit = `scan|installation:${p.id}|annul`;
        await MS.ouvrir({ scanId, porteur: p, cleDebit, maintenant: new Date(Date.now() - 20 * MIN) });
        await argent.debiter(p, { scanId, cleIdempotence: cleDebit });
        const sup = await argent.debiterSupplement(p, { scanId, unites: 3, cleIdempotence: `${cleDebit}|supplement` });       // plus d'unités que le solde : tout ou rien, la 1re est ANNULÉE
        const r0 = await argent.rembourser(p, { poche: 'essai' }, 'lot-trop-grand', { scanId, compteur: 'panne', sansPlafond: true });
        const b2 = await MS.rattraper(sec); const m2 = await lireMarque(scanId);
        H.v('   contrôle : supplément annulé + remboursement propre du scan, puis passe : « rendu/deja-rembourse », pas de fausse alerte (essais 1, acheté 1)', [sup.ok, r0.rendu, m2.etat, m2.issue, b2.echecs, await essais(p), await achete(p)], [false, true, 'rendu', 'deja-rembourse', 0, 1, 1]);
    }

    // ═══════════ 11g. la suppression d'un compte purge ses marques ; celles d'une installation (qui survit) et d'un autre compte restent
    {
        const MDP = require('../comptes/mots-de-passe'); const S = require('../comptes/service');
        const motDePasse = 'un-mot-de-passe-solide-1';
        const c = await compte({ solde: { accueil: 0, achete: 0 }, motDePasse: await MDP.hacher(motDePasse) });
        const autre = await compte({ solde: { accueil: 0, achete: 0 } });
        const i = await inst({ essais: 1 });
        for (const [porteur, ageMin] of [[c, 20], [autre, 20], [i, 20]]) await MS.ouvrir({ scanId: new ObjectId(), porteur, cleDebit: `scan|${porteur.type}:${porteur.id}|suppr`, maintenant: new Date(Date.now() - ageMin * MIN) });
        const r = await S.supprimerCompte({ compte: c.compte, motDePasse, renonciation: true, cfg });
        H.v('11g. supprimerCompte : 200, la marque du compte supprimé a disparu ; celle d\'un autre compte et celle d\'une installation restent', [r.statut, await marques().countDocuments({ 'porteur.id': c.id }), await marques().countDocuments({ 'porteur.id': autre.id }), await marques().countDocuments({ 'porteur.id': i.id })], [200, 0, 1, 1]);
    }

    // nettoyage des marques pour que la suite compte juste
    await marques().deleteMany({}); await db.col('idempotence').deleteMany({});

    // ═══════════ 12. LA ROUTE : la marque s'ouvre avant le débit, se clôt à la remise de la réponse, se retire quand rien n'est pris
    const EXP = 990501, PID = 990601;
    const raw = n => mongoose.connection.db.collection(prefixeBrut(n));
    function prefixeBrut(n) { return db.prefixeCourant() + n; }
    await raw('catalogue_produits').insertOne({ idProduct: PID, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990700 });
    await raw('numeros_cartes').insertOne({ idProduct: PID, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-O5', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: PID, avg: 5, low: 2, trend: 5, avg1: 5, avg7: 5, avg30: 5, guideDu: new Date('2026-10-04') });
    await raw('visuels').insertOne({ idProduct: PID, vignette: { cle: 'banc/o5-v.webp', w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990700, numero: '001', rarete: 'Common', total: '064', variante: 'normale', setNom: 'Banc O5', lien: null });
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    const carteCorps = (id) => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false });
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc O5', prix: 1, photoUrl: null });
    const aff = id => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(id), etat: ETAT, candidats: [cand(id)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 } });
    let vuPendant = null, chaineImpl = null, lotImpl = null;
    const chaine = async (req, res) => { if (chaineImpl) return chaineImpl(req, res); vuPendant = await lireMarque(req.scanIdImpose); return res.json({ ...aff(PID).corps, scanId: String(req.scanIdImpose) }); };
    const identifierLot = async req => lotImpl(req);
    const monter = async deps => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const sv = await monter({}), svLot = await monter({ identifierLot });
    const instJ = async (o = {}) => { const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), o); await db.col('installations').insertOne(i); return { i, jeton, p: { type: 'installation', id: i._id } }; };
    const corps = (n = 1) => ({ contrat: 2, imageUrls: Array(n).fill(IMAGE), title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
    const poster = (url, jeton, k = cle(), c = corps()) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': k } });
    {
        const x = await instJ(); const k = cle();
        const suivis = [], suivreOrig = MS.suivre;                    // espion : le gestionnaire BAT pendant qu'il traite et arrête son battement
        MS.suivre = (id, o) => { const s = suivreOrig(id, o); const rec = { id: String(id), arrete: false }; suivis.push(rec); return { arreter() { rec.arrete = true; return s.arreter(); } }; };
        let r; try { r = await poster(sv.url, x.jeton, k); } finally { MS.suivre = suivreOrig; }
        await attendre(150);
        H.v('12. le gestionnaire démarre UN suivi (battement) pour le scan et l\'arrête à la fin', [suivis.length, suivis[0] && suivis[0].id === r.json.scanId, suivis[0] && suivis[0].arrete], [1, true, true]);
        const ms = await marques().find({ 'porteur.id': x.i._id }).toArray();
        H.v('   une carte identifiée (200) : UNE marque, close livre, ouverte AVANT la chaîne (vue en-suspens pendant la lecture), débit unique', [r.statut, ms.length, ms[0] && ms[0].etat, vuPendant && vuPendant.etat, (await mouvements(x.p)).filter(m => m.type === 'debit').length], [200, 1, 'livre', 'en-suspens', 1]);
        H.v('   la marque porte le scanId de la réponse, les deux clés (débit et claim d\'idempotence), et rien d\'autre', [String(ms[0]._id) === r.json.scanId, ms[0].cleDebit === `scan|installation:${x.i._id}|${k}`, ms[0].cleClaim === `installation:${x.i._id}|identifier|${k}`], [true, true, true]);
        const rej = await poster(sv.url, x.jeton, k);
        H.v('   le MÊME appel rejoué : la réponse figée d\'idempotence, aucune nouvelle marque, aucun nouveau débit', [rej.entetes['idempotency-replayed'], await marques().countDocuments({ 'porteur.id': x.i._id }), (await mouvements(x.p)).filter(m => m.type === 'debit').length], ['true', 1, 1]);
        // le claim d'idempotence perdu (TTL) : le débit existe, la requête est un « rejeu de débit » — jamais gratuite, jamais un 2e débit, et ne laisse AUCUNE marque
        await db.col('idempotence').deleteMany({});
        const rej2 = await poster(sv.url, x.jeton, k);
        await attendre(100);
        H.v('   claim d\'idempotence expiré, même clé : DEBIT « en cours » (429), ni lecture gratuite ni 2e débit ; la marque ouverte avant ce débit est RETIRÉE (1 marque au total)', [rej2.statut, rej2.json.erreur.code, (await mouvements(x.p)).filter(m => m.type === 'debit').length, await marques().countDocuments({ 'porteur.id': x.i._id })], [429, 'DEBIT', 1, 1]);
    }
    {
        const q = await instJ({ essais: 0, achete: 0 });
        const r = await poster(sv.url, q.jeton);
        await attendre(100);
        H.v('13. débit refusé (QUOTA) : 429, aucune marque ne survit (rien n\'a été pris), aucun mouvement', [r.statut, r.json.erreur.code, await marques().countDocuments({ 'porteur.id': q.i._id }), (await mouvements(q.p)).length], [429, 'QUOTA', 0, 0]);
        // administrateur : aucun crédit pris, aucune marque
        const c = await compte({ solde: { accueil: 0, achete: 0 }, role: 'administrateur' }); const jeton = J.genererJeton();
        await db.col('installations').insertOne(Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'adm' }), { compteId: c.id }));
        const ra = await poster(sv.url, jeton);
        await attendre(100);
        H.v('   administrateur (aucun crédit pris) : 200, aucune marque', [ra.statut, await marques().countDocuments({ 'porteur.id': c.id })], [200, 0]);
    }
    {
        const x = await instJ();
        chaineImpl = async () => { throw new Error('boum'); };
        const e0 = console.error; console.error = () => { };
        let r; try { r = await poster(sv.url, x.jeton); await attendre(150); } finally { console.error = e0; chaineImpl = null; }
        const m = await marques().findOne({ 'porteur.id': x.i._id });
        H.v('14. la chaîne lève : 500 SERVEUR remboursé par la route, marque close livre (la réponse est partie), la passe ne rend pas une 2e fois', [r.statut, await essais(x.p), m.etat], [500, 3, 'livre']);
        await marques().updateOne({ _id: m._id }, { $set: { etat: 'en-suspens', ouverteLe: new Date(Date.now() - 20 * MIN), batLe: new Date(Date.now() - 20 * MIN) }, $unset: { closLe: '', expireLe: '' } });
        await MS.rattraper(sec);
        H.v('   (même scan, marque rouverte à la main : la passe voit « déjà remboursé » et ne rend rien de plus)', [await essais(x.p), await rembs(x.p), (await lireMarque(m._id)).issue], [3, 1, 'deja-rembourse']);
    }
    {
        const x = await instJ({ essais: 3, achete: 5 });
        lotImpl = async () => Array.from({ length: 25 }, () => aff(PID));
        const r = await poster(svLot.url, x.jeton);
        await attendre(150);
        const ms = await marques().find({ 'porteur.id': x.i._id }).toArray();
        H.v('15. lot de 25 (3 unités : initiale + supplément) : UNE marque pour le scan entier, close livre', [r.statut, ms.length, ms[0] && ms[0].etat, (await mouvements(x.p)).filter(m => m.type === 'debit').length], [200, 1, 'livre', 3]);
        const y = await instJ({ essais: 1, achete: 0 });
        const r2 = await poster(svLot.url, y.jeton);
        await attendre(150);
        H.v('   lot trop grand pour le solde (QUOTA lot-trop-grand, crédit initial rendu par la route) : marque close livre, la passe ne rend rien de plus', [r2.statut, (await marques().findOne({ 'porteur.id': y.i._id })).etat, await essais(y.p)], [429, 'livre', 1]);
        lotImpl = null;
    }
    {
        // l'écriture de la marque échoue : rien n'est débité, la réponse est INDISPONIBLE (une garde qui ne peut pas conclure BLOQUE)
        const x = await instJ();
        const colOrig = db.col;
        db.col = nom => { const c = colOrig(nom); return nom === 'scans_en_cours' ? new Proxy(c, { get: (t, k) => (k === 'insertOne' ? async () => { throw Object.assign(new Error('x'), { code: 'PANNE' }); } : t[k]) }) : c; };
        const e0 = console.error; console.error = () => { };
        let r; try { r = await poster(sv.url, x.jeton); } finally { db.col = colOrig; console.error = e0; }
        H.v('16. marque impossible à écrire : 503 INDISPONIBLE, AUCUN crédit pris (essais 3), aucun mouvement — jamais un débit sans marque', [r.statut, r.json.erreur.code, await essais(x.p), (await mouvements(x.p)).length], [503, 'INDISPONIBLE', 3, 0]);
    }
    // 16b. C1 — le CLIENT coupe avant la réponse (scanner sans clé, extension, peu importe) : le gestionnaire va au bout, ferme sa marque lui-même ; la passe, même vieillie, ne rend RIEN
    {
        const x = await instJ();
        chaineImpl = async (req, res) => { await attendre(500); return res.json({ ...aff(PID).corps, scanId: String(req.scanIdImpose) }); };
        const ctl = new AbortController();
        const p = fetch(sv.url + '/api/identifier', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}`, 'idempotency-key': cle() }, body: JSON.stringify(corps()) }).catch(e => e);
        await attendre(150); ctl.abort(); const coupe = await p;
        await jusqua(async () => { const m = await marques().findOne({ 'porteur.id': x.i._id }); return m && m.etat === 'livre'; });
        chaineImpl = null;
        const m = await marques().findOne({ 'porteur.id': x.i._id });
        H.v('16b. le client coupe la connexion (150 ms, la chaîne en met 500) : le gestionnaire finit, l\'analyse est écrite, la marque est « livre » SANS réponse reçue ; 1 crédit pris (essais 2)', [Boolean(coupe && coupe.name === 'AbortError'), m && m.etat, await db.col('analyses').countDocuments({ porteur: `installation:${x.i._id}` }), await essais(x.p)], [true, 'livre', 1, 2]);
        await marques().updateOne({ _id: m._id }, { $set: { ouverteLe: new Date(Date.now() - 60 * MIN), batLe: new Date(Date.now() - 60 * MIN) } });
        const b = await MS.rattraper(sec);
        H.v('   des heures plus tard la passe ne rend rien : 0 examen, 0 remboursement « arret-serveur » (une coupure du client ne se rembourse jamais), essais 2', [b.examinees, await rembs(x.p), await essais(x.p)], [0, 0, 2]);
    }
    // 16c. M1 — un débit qui LÈVE : la route répond INDISPONIBLE, la marque reste OUVERTE (jamais close « livre »), la passe tranche (aucun débit enregistré => sans-debit)
    {
        const x = await instJ(); const argentRoute = registre.obtenir('argent'), debiterOrig = argentRoute.debiter;     // le registre du montage de la route (l'assembleur l'a re-fourni)
        argentRoute.debiter = async () => { throw Object.assign(new Error('x'), { code: 'PANNE' }); };
        const e0 = console.error; console.error = () => { };
        const suivis = [], suivreOrig = MS.suivre;                    // N5 : sur ce chemin SANS fermer(), seul le `finally` du gestionnaire arrête le battement
        MS.suivre = (id, o) => { const s = suivreOrig(id, o); const rec = { arrete: false }; suivis.push(rec); return { arreter() { rec.arrete = true; return s.arreter(); } }; };
        let r; try { r = await poster(sv.url, x.jeton); await attendre(150); } finally { MS.suivre = suivreOrig; argentRoute.debiter = debiterOrig; console.error = e0; }
        const m = await marques().findOne({ 'porteur.id': x.i._id });
        H.v('16c. le débit lève : 503 INDISPONIBLE, aucun crédit pris, la marque reste en-suspens (jamais close livre), le battement est ARRÊTÉ par le finally du gestionnaire', [r.statut, await essais(x.p), m && m.etat, suivis.length, suivis[0] && suivis[0].arrete], [503, 3, 'en-suspens', 1, true]);
        await marques().updateOne({ _id: m._id }, { $set: { ouverteLe: new Date(Date.now() - 20 * MIN), batLe: new Date(Date.now() - 20 * MIN) } });
        const b = await MS.rattraper(sec);
        H.v('   la passe la clôt « sans-debit » (aucune ligne de débit pour ce scan) sans rien rendre', [(await lireMarque(m._id)).etat, b.sansDebit, await rembs(x.p), await essais(x.p)], ['sans-debit', 1, 0, 3]);
    }
    await sv.fermer(); await svLot.fermer();

    // ═══════════ 16d. le suivi (battement) : il bat à l'heure de la base, s'arrête, et ne retient pas le processus
    {
        const posees = [];
        const minuteurs = { setInterval: (f, ms) => { const o = { f, ms, unref() { this.u = true; return this; } }; posees.push(o); return o; }, setTimeout: (f, ms) => { const o = { f, ms, unref() { this.u = true; return this; } }; posees.push(o); return o; },
            clearInterval: o => { o.annule = true; }, clearTimeout: o => { o.annule = true; } };
        const s = await scanMort({ age: 40 * MIN });
        const avant = (await lireMarque(s.scanId)).batLe.getTime();
        const suivi = MS.suivre(s.scanId, { minuteurs });
        const i = posees[0];
        H.v('16d. suivre : un intervalle de 30 s et un filet de 30 min, tous deux unref', [posees.length, i.ms, posees[1].ms, i.u === true && posees[1].u === true], [2, MS.BATTEMENT_MS, MS.SUIVI_MAX_MS, true]);
        await i.f(); await attendre(200);
        H.vrai('   un battement rafraîchit batLe (de 40 min en arrière à maintenant)', (await lireMarque(s.scanId)).batLe.getTime() > avant + 30 * MIN);
        suivi.arreter();
        H.vrai('   arreter() annule l\'intervalle et le filet', i.annule === true && posees[1].annule === true);
        // N6 : la péremption se juge à l'heure de MONGO ($$NOW), pas à celle de l'instance. L'horloge de l'instance est décalée de +1 h : le battement reste à l'heure de la base,
        // et une marque dont le battement est frais n'est pas prise par une passe dont l'instance croit être une heure plus tard.
        const RD = Date;
        global.Date = class extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + 3600e3); else super(...a); } static now() { return RD.now() + 3600e3; } };
        let apresDecalage, bDecalee;
        try { await MS.battre(s.scanId); apresDecalage = (await lireMarque(s.scanId)).batLe.getTime(); bDecalee = await MS.rattraper(sec); } finally { global.Date = RD; }
        H.v('   horloge de l\'instance décalée de +1 h : batLe reste à l\'heure de la base (à 30 s de l\'heure réelle, pas +1 h), et la passe ne prend pas une marque qui bat', [Math.abs(apresDecalage - RD.now()) < 30e3, bDecalee.examinees], [true, 0]);
        await marques().deleteOne({ _id: s.scanId });
    }

    // ═══════════ 17. la passe de démarrage ET la passe périodique (modèle : la purge du banc, B6.4)
    {
        H.vrai('17. l\'intervalle de la passe est ≤ le plancher d\'âge (une marque trop jeune au démarrage est prise au plus un tour plus tard) ; il n\'y a plus de seuil de durée', MS.INTERVALLE_MS <= MS.PLANCHER_MS && MS.INTERVALLE_MS > 0 && MS.SEUIL_MS === undefined);
        H.v('   battement 30 s, périmé à trois battements manqués (90 s), plancher d\'âge 5 min ; différé de démarrage ≤ 1 min', [MS.BATTEMENT_MS, MS.PERIME_MS, MS.PLANCHER_MS, MS.DIFFERE_MS <= MIN], [30e3, 90e3, 5 * MIN, true]);
        const posees = [];
        const minuteurs = {
            setTimeout: (f, ms) => { const o = { f, ms, unref() { this.u = true; return this; } }; posees.push(['timeout', o]); return o; },
            setInterval: (f, ms) => { const o = { f, ms, unref() { this.u = true; return this; } }; posees.push(['interval', o]); return o; },
            clearTimeout: o => { o.annule = true; }, clearInterval: o => { o.annule = true; }
        };
        const jeune = await scanMort({ age: 3 * MIN }), vieux = await scanMort({ age: 25 * MIN });
        MS.demarrerRattrapage({ minuteurs, argent: () => argent });
        const t = posees.find(x => x[0] === 'timeout')[1], i = posees.find(x => x[0] === 'interval')[1];
        H.v('   démarrage : un différé et un intervalle, tous deux unref (ils ne retiennent jamais le processus), intervalle ≤ seuil', [posees.length, t.u === true, i.u === true, i.ms <= MS.PLANCHER_MS, t.ms <= MIN], [2, true, true, true, true]);
        await t.f(); await attendre(250);
        H.v('   la passe différée au démarrage rend le scan mort (25 min) et laisse la marque de 3 min', [await essais(vieux.p), (await lireMarque(vieux.scanId)).etat, (await lireMarque(jeune.scanId)).etat, await essais(jeune.p)], [3, 'rendu', 'en-suspens', 2]);
        await marques().updateOne({ _id: jeune.scanId }, { $set: { ouverteLe: new Date(Date.now() - 16 * MIN), batLe: new Date(Date.now() - 16 * MIN) } });         // le temps passe : la marque vieillit, son processus ne bat plus
        await i.f(); await attendre(250);
        H.v('   la passe PÉRIODIQUE la traite quand elle a vieilli au-delà du plancher et que son battement est périmé (essais 3, rendu une fois)', [await essais(jeune.p), (await lireMarque(jeune.scanId)).etat, await rembs(jeune.p)], [3, 'rendu', 1]);
        MS.arreterRattrapage();
        H.vrai('   arrêter annule le différé et l\'intervalle', t.annule === true && i.annule === true);
        // pas de passe sans Mongo prêt
        const sans = await MS.rattrapageUneFois({ etatMongo: () => 0, argent: () => argent });
        H.v('   Mongo non prêt : la passe ne fait rien et le dit (false)', sans, false);
    }

    // ═══════════ 18. aucun interrupteur de panne dans la production ; l'interrupteur v2 éteint ne monte rien
    {
        const lire = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        // (reconcilier.js a un CLI qui sort par process.exit : hérité, sans rapport avec une panne, donc hors de cette liste)
        const FICHIERS = ['argent/marque-scan.js', 'identifier/routes.js', 'identifier/lot.js', 'identifier/monter.js', 'argent/lot.js', 'transport/idempotence.js'];
        const prod = FICHIERS.map(f => [f, lire(f)]);
        const fautif = s => /process\.(exit|kill|abort)\(/.test(s.replace(/\/\/.*$/gm, '')) || /process\.env\.\w*(PANNE|COUPURE|ARRET_TEST|CRASH)/i.test(s.replace(/\/\/.*$/gm, ''));
        H.vrai('18. le prédicat d\'inertie MORD (contrôle) : il signale un texte qui arrête le processus, ou qui lit une variable de panne', fautif('if (process.env.PANNE_TEST) process.exit(1);') && fautif('process.kill(process.pid)') && !fautif('const x = 1; // process.exit(1)'));
        H.vrai(`   les ${FICHIERS.length} fichiers sont bien LUS (6 textes de plus de 1000 caractères : un prédicat sur des noms de fichiers ne mord sur rien)`, prod.length === 6 && prod.every(([, s]) => typeof s === 'string' && s.length > 1000));
        H.vrai('   aucun fichier de production touché par O5 ne contient process.exit, process.kill, ni de lecture d\'environnement pour une panne', prod.every(([, s]) => !fautif(s)));
        H.vrai('   marque-scan.js ne lit aucune variable d\'environnement', !/process\.env/.test(lire('argent/marque-scan.js').replace(/\/\/.*$/gm, '')));
        const { demarrer, appeler, RACINE } = require('../../verrou/serveur');
        const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js');
        const avant = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => /scans_en_cours/.test(n));
        const srv = await demarrer(FAUX, { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-o5', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: '' });
        try {
            if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
            await appeler(srv.port, 'GET', '/ping');
            const r = await appeler(srv.port, 'POST', '/api/identifier', { userId: 'o5-eteint', imageUrls: [IMAGE] }, 'jeton-o5');
            void r;
            await attendre(500);
        } finally { srv.enfant.kill(); }
        const apres = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => /scans_en_cours/.test(n));
        H.v('   interrupteur v2 ÉTEINT (RM_API_V2 absent), un serveur démarré et une identification héritée : la collection des marques n\'a pas bougé (elle n\'existait pas hors du préfixe de ce banc)', [avant.length, apres.filter(n => !n.startsWith(db.prefixeCourant())).length], [avant.length, 0]);
        H.vrai('   et index.js (racine) ne charge ./v2 que si RM_API_V2 vaut 1 — donc ni écriture ni minuterie quand il est éteint', /process\.env\.RM_API_V2 === '1' \? require\('\.\/v2'\) : null/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8')));
    }
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
