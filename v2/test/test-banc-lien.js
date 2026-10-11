'use strict';
// BANC-12 — le lien entre une contribution du banc réel et un compte ne dure pas plus de bancLienMois (12), puis anonymisation DÉFINITIVE.
// Une contribution âgée de « 12 mois + 1 jour », AVEC tous les magasins et le sel du banc en main : chaque chemin pour la relier à son compte ÉCHOUE.
// À « 12 mois − 1 jour », la correction marche encore et rien n'est touché. Les horloges sont INJECTÉES (aucune date en dur) : T0 = maintenant.
// Base : la base EN MÉMOIRE du banc ; R2 : un FAUX client. Aucun réseau, aucune base réelle.
const H = require('./_harnais');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const { creerStockage } = require('../banc/stockage');
const { creerBanc, CLES_DOC } = require('../banc/routes');
const { jourUTC } = require('../banc/commun');
const monterBanc = require('../banc/monter');
const { compte } = require('./_aide-argent');
let Lg, Q, MS, R;

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const BUCKET = 'bucket-banc-test', SEL = 'sel-de-banc-lien';
const H1 = 3600e3, JOUR = 86400e3, MIN = 60e3;
const LIEN_MS = cfg.retention.bancLienMois * 30.5 * JOUR;
const T0 = new Date(jourUTC(new Date()).getTime() + 12 * H1);       // la contribution : aujourd'hui à 12:00Z (jamais une date en dur)
const apres = (ms, de = T0) => new Date(de.getTime() + ms);
const T_AVANT = apres(LIEN_MS - JOUR), T_APRES = apres(LIEN_MS + JOUR);   // « 12 mois − 1 jour » et « 12 mois + 1 jour »
let cur = T0;                                                         // l'horloge du banc d'écriture / de correction
const empreinte = j => crypto.createHash('sha256').update(j).digest('hex');
const idLigne = (scanId, carte = 0) => crypto.createHash('sha256').update(`${String(scanId).toLowerCase()}|${carte}|${SEL}`).digest('hex');
const hex = () => crypto.randomBytes(16).toString('hex');
const consent = (jeton, a) => ({ consentementBanc: { version: '2026-10-07-v1', le: a.toISOString(), jeton } });
const carteImg = () => sharp({ create: { width: 640, height: 894, channels: 3, background: { r: 30, g: 120, b: 60 } } }).jpeg().toBuffer();
const lignes = () => db.col('banc_lignes').find({}).toArray();
const capturer = () => { const o = { e: console.error, w: console.warn }; const vus = []; console.error = console.warn = (...a) => vus.push(a.join(' ')); return { vus, rendre() { console.error = o.e; console.warn = o.w; } }; };
let nJeton = 0; const jetonNeuf = () => `jeton-lien-${Date.now().toString(36)}-${++nJeton}-abcdefgh`;

function fauxClient() {
    const objets = new Map(), dates = new Map(), panne = { put: false }, c = {
        objets, dates, panne, dateObjet: T0, avantSuppression: null,
        async deposerBinaire(b, k, buf) { if (b !== BUCKET) throw new Error('bucket'); if (panne.put) throw new Error('R2 en panne'); objets.set(k, buf); dates.set(k, c.dateObjet); return { ecrit: true }; },
        async supprimer(b, cles) { if (b !== BUCKET) throw new Error('bucket'); if (c.avantSuppression) await c.avantSuppression(cles); for (const k of cles) { objets.delete(k); dates.delete(k); } return cles.length; },
        async lireBinaire(b, k) { if (b !== BUCKET || !objets.has(k)) throw new Error('absent'); return objets.get(k); },
        async listerObjets(b, p) { return [...objets.keys()].filter(k => k.startsWith(p)).map(k => ({ cle: k, modifieLe: dates.get(k) })); },
    };
    return c;
}
// une collection de lignes dont certaines méthodes passent d'abord par un crochet (le scénario d'une course ou d'une panne au milieu d'un geste)
function colAvec(crochets) {
    return n => {
        const r = db.col(n); if (n !== 'banc_lignes') return r;
        return new Proxy(r, { get(t, p) { const f = t[p]; if (typeof f !== 'function') return f;
            return (...a) => { const h = crochets[p]; return h ? Promise.resolve(h(...a)).then(() => f.apply(t, a)) : f.apply(t, a); }; } });
    };
}
function monde(client, colFn) {
    const stockage = creerStockage({ client, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } }); stockage.verifierBucket = async () => { };
    const env = { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL };
    const banc = creerBanc({ cfg, env, stockage, horloge: () => cur, ...(colFn ? { colFn } : {}) });
    const creerPurge = o => require('../banc/purge').creerPurge({ cfg, env: o.env || env, stockage, horloge: () => cur, colFn: o.colFn });
    return { banc, purge: creerPurge({ colFn }), creerPurge, stockage };
}

// Un compte AVEC tout ce qui le relie à ses scans : octroi, débits, analyses, marque, idempotence, question, remboursement ; puis la contribution du banc.
async function fabriquer(m, client, { jeton = jetonNeuf(), image } = {}) {
    cur = T0; client.dateObjet = T0;
    const porteur = await compte({ solde: { accueil: 25, achete: 0 } }); porteur.surface = 'extension';
    const cle = String(porteur.id), pk = `compte:${cle}`;
    await db.col('mouvements').insertOne({ compteId: porteur.id, le: T0, surface: 'extension', type: 'octroi', delta: 25, poche: 'accueil', motif: 'octroi-accueil', scanId: null, etat: 'debite', cleIdempotence: `octroi-accueil|${cle}`, expireLe: apres(cfg.retention.octroiJours * JOUR) });
    const deb = (scanId, k) => Lg.debiter(porteur, { scanId, cleIdempotence: `scan|${pk}|${k}`, surface: 'extension', maintenant: T0 }, cfg);
    const analyse = scanId => db.col('analyses').insertOne({ _id: scanId, porteur: pk, surface: 'extension', statut: 'identifiee', cartes: [{ idProduct: 4242, statut: 'identifiee' }], creeLe: T0, expireLe: apres(cfg.retention.analysesMois * 30.5 * JOUR) });
    const O = () => new mongoose.Types.ObjectId();
    const s1 = O(), s2 = O(), s3 = O(), s4 = O();
    // s1 : le scan de la contribution (débit, analyse, marque close, réponse stockée, ligne du banc)
    await deb(s1, 'k1'); await analyse(s1);
    await MS.ouvrir({ scanId: s1, porteur: { type: 'compte', id: porteur.id }, cleDebit: `scan|${pk}|k1`, cleClaim: `claim-${cle}-1`, maintenant: T0 }); await MS.clore(s1, { maintenant: T0 });
    await db.col('idempotence').insertOne({ cle: `claim-${cle}-1`, etat: 'fini', statut: 200, reponse: JSON.stringify({ scanId: String(s1) }), expireLe: apres(cfg.retention.idempotenceHeures * H1) });
    // s2 : un scan remboursé (le claim `rb|scanId` du ledger porte le scanId dans SA CLÉ)
    const d2 = await deb(s2, 'k2'); await analyse(s2);
    const r2 = await Lg.rembourser(porteur, d2.credit, 'panne', { scanId: s2, maintenant: T0 }, cfg);
    // s3 : une question répondue ; s4 : une question encore en attente
    const d3 = await deb(s3, 'k3'); await Q.reserverQuestion(porteur, d3.credit, { scanId: s3, carte: 0, raison: 'egalite', candidats: [1, 2], choix: [], cleDebit: d3.cle }, cfg, T0);
    await db.col('questions').updateOne({ _id: `${s3}:0` }, { $set: { etat: 'repondue', reponse: { aucune: false }, regleeLe: T0 } });
    const d4 = await deb(s4, 'k4'); await Q.reserverQuestion(porteur, d4.credit, { scanId: s4, carte: 0, raison: 'egalite', candidats: [1, 2], choix: [], cleDebit: d4.cle }, cfg, T0);
    await m.banc.apresVerdict({ corps: consent(jeton, T0), scanId: String(s1), carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'm1' });
    const ligne = (await lignes()).find(l => l._id === idLigne(s1));
    return { porteur, pk, cle, jeton, s1, s2, s3, s4, r2, ligne, ancienneCle: ligne && ligne.cleR2 };
}
const mouvs = w => db.col('mouvements').find({ compteId: w.porteur.id }).toArray();
const sommeDeltas = async w => (await mouvs(w)).reduce((s, x) => s + x.delta, 0);
const soldeTotal = async w => { const c = await db.col('comptes').findOne({ _id: w.porteur.id }); return c.solde.accueil + c.solde.achete; };
const avecScanId = () => db.col('mouvements').countDocuments({ scanId: { $exists: true, $ne: null } });
const argentDe = () => ({ rembourser: (p, c, mo, o) => Lg.rembourser(p, c, mo, o, cfg), rembourserLigne: (p, c, mo, o) => Lg.rembourserLigne(p, c, mo, o, cfg) });

async function section(nom, f) { try { await f(); } catch (e) { H.v(`${nom} : la section s'exécute jusqu'au bout (${e && e.stack})`, false, true); } }

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-banc-lien.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    Lg = require('../argent/ledger'); Q = require('../argent/questions'); MS = require('../argent/marque-scan'); R = require('../argent/reconcilier');
    const image = await carteImg();
    // chaque monde repart d'une base propre (lignes, mouvements, questions, analyses, marques, idempotence) : les comptes comptés sont ceux du monde, pas ceux du précédent
    const vider = async () => { for (const n of ['banc_lignes', 'mouvements', 'questions', 'analyses', 'scans_en_cours', 'idempotence']) await db.col(n).deleteMany({}); };

    // ═══ À 12 mois − 1 jour : le lien tient, la correction marche, la passe ne touche à rien ═══
    await section('avant 12 mois', async () => {
        await vider(); const client = fauxClient(), m = monde(client); const w = await fabriquer(m, client, { image });
        H.v('départ : une ligne du banc, un objet R2, 4 scanId dans les mouvements, la ligne porte jeton et jour', [(await lignes()).length, client.objets.size, w.ligne.jetonEmpreinte === empreinte(w.jeton), w.ligne.le.getTime() === jourUTC(T0).getTime()], [1, 1, true, true]);
        const avant = JSON.stringify(await lignes()), nScan = await avecScanId(), nQ = await db.col('questions').countDocuments({}), nA = await db.col('analyses').countDocuments({});
        H.vrai('   les mouvements portent des scanId (au moins s1, s2, s3, s4) et une clé rb| qui contient un scanId', nScan >= 4 && (await mouvs(w)).some(x => /^rb\|[0-9a-f]{24}/.test(x.cleIdempotence || '')));
        const b = await m.purge.anonymiserLiens(T_AVANT);
        H.v('à 12 mois − 1 jour : la passe ne fait rien (0 ligne, 0 mouvement, 0 question, 0 analyse)', [b.lignes, b.attente, b.mouvements, b.questions, b.analyses, b.echecs], [0, 0, 0, 0, 0, 0]);
        H.v('   ligne, mouvements, questions, analyses et objet : intacts', [JSON.stringify(await lignes()) === avant, await avecScanId(), await db.col('questions').countDocuments({}), await db.col('analyses').countDocuments({}), client.objets.size], [true, nScan, nQ, nA, 1]);
        cur = T_AVANT;
        await m.banc.corriger({ corps: consent(w.jeton, T_AVANT), scanId: String(w.s1), carte: 0, idProduct: 777 });
        const l = (await lignes())[0];
        H.v('à 12 mois − 1 jour : la CORRECTION marche encore (verite 777, source correction)', [l.verite, l.source, l._id], [777, 'correction', idLigne(w.s1)]);
        const e = await m.purge.effacerParJeton(w.jeton);
        H.v('   et l\'EFFACEMENT par jeton aussi (1 ligne, 0 objet gardé)', [e, client.objets.size, (await lignes()).length], [{ supprimees: 1, echecs: 0 }, 0, 0]);
        // contrôle de la sonde : sans la passe, la passe de rattrapage d'O5 rend bien un scan en suspens dont le scanId est encore dans le ledger
        const sc = new mongoose.Types.ObjectId(), p2 = await compte({ solde: { accueil: 25, achete: 0 } }); p2.surface = 'extension';
        await Lg.debiter(p2, { scanId: sc, cleIdempotence: `scan|ctrl|${sc}`, surface: 'extension', maintenant: T0 }, cfg);
        await MS.ouvrir({ scanId: sc, porteur: { type: 'compte', id: p2.id }, cleDebit: `scan|ctrl|${sc}`, maintenant: new Date(Date.now() - H1) });
        const soldeAvant = (await db.col('comptes').findOne({ _id: p2.id })).solde.accueil;
        const br = await MS.rattraper({ argent: argentDe(), maintenant: new Date() });
        H.v('témoin du banc : AVANT 12 mois, le rattrapage d\'O5 rend le scan en suspens (+1 crédit) par le scanId du ledger', [br.rendues, (await db.col('comptes').findOne({ _id: p2.id })).solde.accueil - soldeAvant], [1, 1]);
    });

    // ═══ À 12 mois + 1 jour, TOUS les magasins et le sel en main : chaque chemin échoue ═══
    let wB = null, clientB = null, mB = null;
    await section('après 12 mois', async () => {
        await vider(); clientB = fauxClient(); mB = monde(clientB); const w = wB = await fabriquer(mB, clientB, { image });
        const ancienne = w.ligne, ancienneCle = w.ancienneCle, anciennesCles = (await mouvs(w)).map(x => x.cleIdempotence).filter(Boolean);
        const R0 = await R.reconcilier({ type: 'compte', id: w.porteur.id }), s0 = await sommeDeltas(w), t0 = await soldeTotal(w), nMouv = (await mouvs(w)).length;
        H.v('réconciliation AVANT : aucun écart, propre ; somme des deltas = solde', [R0.ecarts, R0.propre, s0 === t0, s0], [[], true, true, s0]);
        const nScan = await avecScanId();
        clientB.dateObjet = T_APRES;                                   // les objets écrits PAR LA PASSE portent la date de la passe
        const cap = capturer(); const b = await mB.purge.anonymiserLiens(T_APRES); cap.rendre();
        H.v('la passe à 12 mois + 1 jour : 1 ligne anonymisée, aucun échec', [b.lignes, b.echecs, b.changees], [1, 0, 0]);
        H.v('   chaque mouvement portant un scanId est traité (compte avant = compte traité) ; 1 question répondue et 2 analyses supprimées', [b.mouvements, b.questions, b.analyses], [nScan, 1, 2]);
        H.vrai('   le journal de la passe ne cite ni scanId, ni sel, ni jeton, ni clé d\'objet', !/[0-9a-f]{24}|sel-de-banc|jeton-lien|banc-reel/.test(cap.vus.join('\n')));

        // — chemin 1 : l'identifiant de la ligne par le sel (SHA-256(scanId, carte, sel)) —
        H.v('chemin 1 — _id = SHA-256(scanId, carte, sel) : aucune ligne', await db.col('banc_lignes').findOne({ _id: idLigne(w.s1) }), null);
        for (const c of [1, 2, 99]) if (await db.col('banc_lignes').findOne({ _id: idLigne(w.s1, c) })) H.vrai(`chemin 1 — carte ${c} : aucune ligne`, false);
        // — chemin 2 : le jeton de consentement —
        H.v('chemin 2 — jetonEmpreinte : aucune ligne', await db.col('banc_lignes').find({ jetonEmpreinte: empreinte(w.jeton) }).toArray(), []);
        // — chemin 3 : le contenu de la ligne —
        const ls = await lignes(), l = ls[0];
        H.v('chemin 3 — une seule ligne, aux seules clés admises, sans `le`, sans jeton', [ls.length, Object.keys(l).sort(), 'le' in l, 'jetonEmpreinte' in l], [1, ['_id', 'anonyme', 'cleR2', 'etat', 'expireLe', 'source', 'verite', 'versionModele', 'versionTexte'], false, false]);
        H.vrai('   les clés d\'une ligne fraîche (CLES_DOC) n\'ont pas changé : jeton et heure y sont encore, pour avant 12 mois', CLES_DOC.includes('jetonEmpreinte') && CLES_DOC.includes('le') && !CLES_DOC.includes('anonyme'));
        const brut = JSON.stringify(ls);
        const secrets = { scanId: String(w.s1), sel: SEL, jeton: w.jeton, empreinteJeton: empreinte(w.jeton), compte: String(w.porteur.id), idAncien: idLigne(w.s1), ancienneCle: ancienneCle.split('/').pop().replace('.webp', ''), jourDeLaContribution: T0.toISOString().slice(0, 10) };
        H.v('   le document ne contient AUCUNE valeur qui permette de recalculer le lien (scanId, sel, jeton, empreinte, compte, ancien id, ancienne clé, jour)', Object.entries(secrets).filter(([, v]) => brut.includes(v)).map(([k]) => k), []);
        H.vrai('   l\'identifiant est neuf et aléatoire (32 hex), pas SHA-256(scanId…)', /^[0-9a-f]{32}$/.test(l._id) && l._id !== idLigne(w.s1));
        H.v('   le contenu utile reste : verite, source, état, versions', [l.verite, l.source, l.etat, l.versionModele, l.versionTexte, l.anonyme], [4242, 'affirme', 'confirmee', 'm1', '2026-10-07-v1', true]);
        const mois = new Date(Date.UTC(ancienne.expireLe.getUTCFullYear(), ancienne.expireLe.getUTCMonth(), 1));
        H.v('   l\'expiration est ramenée au début de son MOIS (≤ l\'ancienne, jamais plus de 24 mois) : elle ne redonne plus le jour', [l.expireLe.getTime(), l.expireLe <= ancienne.expireLe], [mois.getTime(), true]);
        // — chemin 4 : l'objet R2 —
        H.v('chemin 4 — R2 : l\'ancien objet est supprimé, un seul objet, sous une clé NEUVE', [clientB.objets.has(ancienneCle), clientB.objets.size, [...clientB.objets.keys()][0] === l.cleR2 && l.cleR2 !== ancienneCle], [false, 1, true]);
        H.v('   la date de l\'objet est celle de la PASSE, plus celle de la contribution', [clientB.dates.get(l.cleR2).getTime(), clientB.dates.get(l.cleR2).getTime() === T0.getTime()], [T_APRES.getTime(), false]);
        H.vrai('   l\'image est la même (octets identiques)', (await mB.stockage.lire(l.cleR2)).length > 0);
        // — chemin 5 : les mouvements d'argent (scanId, et la clé rb|scanId du ledger) —
        const ms = await mouvs(w);
        H.v('chemin 5 — mouvements : plus aucun scanId (champ), plus aucun scanId dans une clé ; rien n\'a disparu', [await avecScanId(), ms.length, JSON.stringify(ms).match(/[0-9a-f]{24}/g)?.filter(x => [w.s1, w.s2, w.s3, w.s4].map(String).includes(x)) || []], [0, nMouv, []]);
        H.v('   les clés renommées sont uniques et sans scanId (anon|<_id mouvement>) ; les autres clés sont inchangées', [ms.filter(x => /^anon\|/.test(x.cleIdempotence || '')).length > 0, new Set(ms.map(x => x.cleIdempotence).filter(Boolean)).size === ms.filter(x => x.cleIdempotence).length, anciennesCles.filter(k => !/^rb\|/.test(k)).every(k => ms.some(x => x.cleIdempotence === k))], [true, true, true]);
        // — chemin 6 : questions, analyses, marque, idempotence —
        H.v('chemin 6 — questions : celle du scan répondu est supprimée ; celle encore EN ATTENTE reste (une question ouverte n\'est jamais effacée ici)', [await db.col('questions').find({ scanId: w.s3 }).toArray(), (await db.col('questions').find({ scanId: w.s4 }).toArray()).map(q => q.etat)], [[], ['en-attente']]);
        H.v('   analyses : plus aucune pour ce compte', await db.col('analyses').countDocuments({ porteur: w.pk }), 0);
        const marque = await db.col('scans_en_cours').findOne({ _id: w.s1 });
        H.vrai('   la marque du scan est CLOSE et expire (TTL 7 jours) avant 12 mois ; l\'idempotence de même', marque && marque.etat === 'livre' && marque.expireLe <= T_APRES && (await db.col('idempotence').findOne({ cle: `claim-${w.cle}-1` })).expireLe <= T_APRES);
        H.vrai('   rétentions hors passe : idempotence (24 h), annonces (90 j), journal hérité (90 j) sont bien PLUS COURTES que le lien',
            cfg.retention.idempotenceHeures * H1 < LIEN_MS && cfg.retention.annonceJours * JOUR < LIEN_MS && journalHeriteJours() * JOUR < LIEN_MS);
        // — chemin 7 : les gestes de l'utilisateur après 12 mois —
        cur = T_APRES;
        await mB.banc.corriger({ corps: consent(w.jeton, T_APRES), scanId: String(w.s1), carte: 0, idProduct: 999 });
        H.v('chemin 7 — la correction après 12 mois ne trouve plus rien et ne change rien', [(await lignes()).map(x => x.verite), (await lignes()).length], [[4242], 1]);
        H.v('   l\'effacement par jeton après 12 mois : 0 supprimée (le contrat l\'écrit), l\'objet reste', [await mB.purge.effacerParJeton(w.jeton), clientB.objets.size], [{ supprimees: 0, echecs: 0 }, 1]);
        // — la réconciliation et l'idempotence des remboursements tiennent —
        const R1 = await R.reconcilier({ type: 'compte', id: w.porteur.id });
        H.v('réconciliation APRÈS : aucun écart, propre ; somme des deltas = solde = celle d\'avant', [R1.ecarts, R1.propre, await sommeDeltas(w), await soldeTotal(w)], [[], true, s0, t0]);
        const sold = await soldeTotal(w);
        const rej = await Lg.rembourser(w.porteur, { poche: 'accueil' }, 'panne', { scanId: w.s2, maintenant: T_APRES }, cfg);
        H.v('rejouer le remboursement d\'un scan de plus de 12 mois ne rend RIEN (aucun débit retrouvé : pas de double remboursement)', [rej.rendu, rej.raisonNonRembourse, await soldeTotal(w)], [false, 'aucun-debit', sold]);
        // — idempotence de la passe —
        const b2 = await mB.purge.anonymiserLiens(T_APRES);
        H.v('la passe rejouée ne fait rien et ne change aucun document', [b2.lignes, b2.mouvements, b2.questions, b2.analyses, b2.echecs, JSON.stringify(await lignes()) === JSON.stringify(ls)], [0, 0, 0, 0, 0, true]);
    });

    // ═══ La passe de rattrapage d'O5 (plafond de vie : 30 min) ne peut plus porter sur un scan de plus de 12 mois ═══
    await section('rattrapage O5', async () => {
        const w = wB; if (!w) throw new Error('monde indisponible');
        const sc = new mongoose.Types.ObjectId(); const pk = `compte:${w.cle}`;
        // un débit de 12 mois + 1 jour dont la marque est restée en suspens (cas d'école : plafond de vie 30 min dépassé de loin) ; le débit est antérieur à la passe
        await Lg.debiter(w.porteur, { scanId: sc, cleIdempotence: `scan|${pk}|vieux`, surface: 'extension', maintenant: T0 }, cfg);
        await MS.ouvrir({ scanId: sc, porteur: { type: 'compte', id: w.porteur.id }, cleDebit: `scan|${pk}|vieux`, maintenant: new Date(Date.now() - H1) });
        H.v('SC. SUIVANT : plafond de vie d\'une marque (suivi) = 30 min, bien en dessous de 12 mois', [MS.SUIVI_MAX_MS, MS.SUIVI_MAX_MS < LIEN_MS], [30 * MIN, true]);
        const b = await mB.purge.anonymiserLiens(T_APRES);
        H.v('la passe retire le scanId de ce débit aussi', [b.mouvements, await avecScanId()], [1, 0]);
        const avant = await soldeTotal(w), s0 = await sommeDeltas(w);
        const r = await MS.rattraper({ argent: argentDe(), maintenant: T_APRES });
        H.v('le rattrapage prend la marque, ne trouve AUCUNE unité (scanId retiré) : « sans débit », aucun crédit rendu', [r.examinees, r.sansDebit, r.rendues, r.erreurs, (await db.col('scans_en_cours').findOne({ _id: sc })).etat], [1, 1, 0, 0, 'sans-debit']);
        H.v('   le solde et la somme des deltas sont inchangés ; aucune ligne de remboursement créée', [await soldeTotal(w), await sommeDeltas(w), (await mouvs(w)).filter(x => x.type === 'remboursement' && x.delta === 1).length], [avant, s0, 1]);
        const R1 = await R.reconcilier({ type: 'compte', id: w.porteur.id });
        H.v('   la réconciliation reste sans écart ; elle ne liste plus cette marque (close en « sans-debit »)', [R1.ecarts, R1.marquesEnSuspens.length], [[], 0]);
    });

    // ═══ La correction est refusée après 12 mois MÊME SI la passe n'a pas encore tourné (même prédicat des deux côtés) ═══
    await section('correction sans passe', async () => {
        await vider(); const client = fauxClient(), m = monde(client); const w = await fabriquer(m, client, { image });
        cur = T_APRES;
        await m.banc.corriger({ corps: consent(w.jeton, T_APRES), scanId: String(w.s1), carte: 0, idProduct: 888 });
        const l = (await lignes())[0];
        H.v('12 mois + 1 jour, passe pas encore lancée : la correction est REFUSÉE (verite 4242, source affirme, la ligne garde son jeton)', [l.verite, l.source, l.jetonEmpreinte === empreinte(w.jeton)], [4242, 'affirme', true]);
    });

    // ═══ L'argent non résolu garde sa trace : il ne désigne aucune ligne du banc, et la réconciliation en a besoin ═══
    await section('argent non résolu', async () => {
        await vider(); const client = fauxClient(), m = monde(client); const w = await fabriquer(m, client, { image });
        await db.col('mouvements').updateOne({ compteId: w.porteur.id, type: 'debit', scanId: w.s4 }, { $set: { etat: 'rendu-echoue', raisonRendu: 'poche-introuvable' }, $unset: { expireLe: '' } });
        client.dateObjet = T_APRES; await m.purge.anonymiserLiens(T_APRES);
        const reste = await db.col('mouvements').find({ compteId: w.porteur.id, scanId: { $exists: true, $ne: null } }).toArray();
        H.v('un débit « rendu-echoue » (jamais expiré, listé par la réconciliation) GARDE son scanId ; tous les autres le perdent', [reste.map(x => [String(x.scanId), x.etat])], [[[String(w.s4), 'rendu-echoue']]]);
        const R1 = await R.reconcilier({ type: 'compte', id: w.porteur.id });
        H.v('   la réconciliation le liste toujours, avec son scanId, et ne le déclare pas propre', [R1.rendusEchoues.map(x => String(x.scanId)), R1.propre], [[String(w.s4)], false]);
        H.v('   mais aucune ligne du banc ne s\'y rattache : la seule ligne a un identifiant aléatoire, sans jeton ni jour', [(await lignes()).map(l => [l._id === idLigne(w.s4), 'jetonEmpreinte' in l, 'le' in l])], [[[false, false, false]]]);
    });

    // ═══ Une correction et l'anonymisation en même temps : l'une PUIS l'autre, jamais une ligne à moitié ═══
    await section('course correction / anonymisation', async () => {
        await vider(); const client = fauxClient();
        // (a) la correction a LU la ligne (valide), la passe l'anonymise, puis la correction écrit : sans effet, une seule ligne anonyme intacte
        let m0 = monde(client); const w = await fabriquer(m0, client, { image });
        const passe = monde(client).purge;
        let lance = false;
        const colC = colAvec({ updateOne: async () => { if (lance) return; lance = true; client.dateObjet = T_APRES; await passe.anonymiserLiens(T_APRES); } });
        const m = monde(client, colC); cur = T_AVANT;
        await m.banc.corriger({ corps: consent(w.jeton, T_AVANT), scanId: String(w.s1), carte: 0, idProduct: 555 });
        const ls = await lignes();
        H.v('(a) correction lue avant, passe entre la lecture et l\'écriture : UNE ligne, anonyme, verite d\'origine (4242), pas de 555', [ls.length, ls[0] && ls[0].anonyme, ls[0] && ls[0].verite, ls[0] && ls[0].source, client.objets.size], [1, true, 4242, 'affirme', 1]);
        // (b) la ligne est en cours d'anonymisation (prise) : une correction ne l'écrit pas
        await vider(); client.objets.clear(); client.dates.clear();
        const w2 = await fabriquer(monde(client), client, { image });
        await db.col('banc_lignes').updateOne({ _id: idLigne(w2.s1) }, { $set: { etat: 'anonymisation', priseLe: T_AVANT } });
        cur = T_AVANT; await monde(client).banc.corriger({ corps: consent(w2.jeton, T_AVANT), scanId: String(w2.s1), carte: 0, idProduct: 556 });
        const l2 = (await lignes())[0];
        H.v('(b) ligne PRISE par l\'anonymisation : la correction n\'y écrit rien (verite 4242, état inchangé)', [l2.verite, l2.etat, l2.source], [4242, 'anonymisation', 'affirme']);
    });

    // ═══ L'effacement par jeton ET l'anonymisation en même temps ═══
    await section('course effacement / anonymisation', async () => {
        await vider(); const client = fauxClient(); const w = await fabriquer(monde(client), client, { image });
        const effaceur = monde(client).purge;
        let lance = false;
        const colP = colAvec({ deleteOne: async f => { if (lance || !f || f.etat !== 'anonymisation') return; lance = true; await effaceur.effacerParJeton(w.jeton); } });
        client.dateObjet = T_APRES; cur = T_APRES;
        const b = await monde(client, colP).purge.anonymiserLiens(T_APRES);
        H.v('effacement par jeton entre l\'insertion de la copie anonyme et la suppression de l\'ancienne : tout est défait (0 ligne, 0 objet)', [(await lignes()).length, client.objets.size, b.changees, b.lignes], [0, 0, 1, 0]);
    });

    // ═══ Reprise après une panne au milieu de la passe ═══
    await section('reprise', async () => {
        // (a) R2 ne répond pas à l'écriture : la ligne est PRISE, rien d'autre ; une passe trop proche ne la reprend pas ; une passe 11 min plus tard la finit
        await vider(); let client = fauxClient(); let w = await fabriquer(monde(client), client, { image });
        client.dateObjet = T_APRES; client.panne.put = true; const cap = capturer();
        const b1 = await monde(client).purge.anonymiserLiens(T_APRES); cap.rendre(); client.panne.put = false;
        H.v('(a) écriture R2 en panne : 1 échec ; la ligne d\'origine est gardée (prise), aucune copie anonyme, l\'ancien objet reste', [b1.echecs, b1.lignes, (await lignes()).map(l => l.etat), client.objets.size], [1, 0, ['anonymisation'], 1]);
        const b2 = await monde(client).purge.anonymiserLiens(apres(5 * MIN, T_APRES));
        H.v('   une passe 5 min plus tard ne reprend pas une prise fraîche', [b2.lignes, (await lignes()).map(l => l.etat)], [0, ['anonymisation']]);
        const b3 = await monde(client).purge.anonymiserLiens(apres(11 * MIN, T_APRES));
        H.v('   une passe 11 min plus tard la reprend : 1 ligne anonyme, 1 objet', [b3.lignes, (await lignes()).map(l => !!l.anonyme), client.objets.size], [1, [true], 1]);
        // (b) la suppression de l'ancienne ligne échoue après l'insertion de la copie : la reprise réutilise la MÊME copie (pas de doublon)
        await vider(); client.objets.clear(); client.dates.clear(); w = await fabriquer(monde(client), client, { image });
        let casse = true; client.dateObjet = T_APRES;
        const colB = colAvec({ deleteOne: async f => { if (casse && f && f.etat === 'anonymisation') { casse = false; throw Object.assign(new Error('coupure'), { code: 'COUPURE' }); } } });
        const cap2 = capturer(); const c1 = await monde(client, colB).purge.anonymiserLiens(T_APRES); cap2.rendre();
        const mid = await lignes();
        H.v('(b) coupure entre la copie et la suppression de l\'ancienne : 1 échec, 2 lignes (l\'ancienne prise + la copie)', [c1.echecs, mid.length, mid.filter(l => l.anonyme).length], [1, 2, 1]);
        const copie = mid.find(l => l.anonyme);
        const c2 = await monde(client).purge.anonymiserLiens(apres(11 * MIN, T_APRES));
        const fin = await lignes();
        H.v('   la reprise réutilise la même copie : 1 ligne, même _id et même clé, 1 objet', [c2.lignes, fin.length, fin[0]._id === copie._id, fin[0].cleR2 === copie.cleR2, client.objets.size], [1, 1, true, true, 1]);
        // (c) l'ancien objet ne peut pas être supprimé : la ligne est déjà anonyme ; le filet des orphelins le supprime
        await vider(); client.objets.clear(); client.dates.clear(); w = await fabriquer(monde(client), client, { image });
        client.dateObjet = T_APRES; client.avantSuppression = async cles => { if (cles.includes(w.ancienneCle)) throw new Error('R2 refuse'); };
        const cap3 = capturer(); const d1 = await monde(client).purge.anonymiserLiens(T_APRES); cap3.rendre(); client.avantSuppression = null;
        H.v('(c) suppression de l\'ancien objet impossible : 1 échec nommé, ligne anonyme déjà écrite, 2 objets', [d1.echecs, (await lignes()).map(l => !!l.anonyme), client.objets.size], [1, [true], 2]);
        const p = await monde(client).purge.purgerBanc(apres(3 * JOUR, T_APRES));
        H.v('   la purge (filet des orphelins) supprime l\'ancien objet, plus vieux que 48 h et sans ligne', [p.orphelins, client.objets.has(w.ancienneCle), client.objets.size], [1, false, 1]);
    });

    // ═══ Les autres lignes : une attente plus vieille que 24 h, le stockage absent ═══
    await section('attente et stockage', async () => {
        await vider(); const client = fauxClient(); const m = monde(client); cur = T0; client.dateObjet = T0;
        const sa = hex().slice(0, 24); const jeton = jetonNeuf();
        await m.banc.apresVerdict({ corps: consent(jeton, T0), scanId: sa, carte: 0, issue: 'question', imageRedressee: image, detectionSure: true, versionModele: 'm1' });
        H.v('départ : une ligne EN ATTENTE (jamais confirmée), un objet', [(await lignes()).map(l => l.etat), client.objets.size], [['attente'], 1]);
        const b = await m.purge.anonymiserLiens(T_APRES);
        H.v('une attente de plus de 12 mois (la purge à 24 h l\'a ratée) est SUPPRIMÉE, objet compris : jamais anonymisée', [b.attente, b.lignes, (await lignes()).length, client.objets.size], [1, 0, 0, 0]);
        // le stockage absent : les lignes ne peuvent pas être re-clefées → comptées en échec, mais le reste (argent, questions, analyses) est fait
        await vider(); client.objets.clear(); client.dates.clear(); const w = await fabriquer(m, client, { image });
        const cap = capturer(); const sans = m.creerPurge({ env: {} }); const c = await sans.anonymiserLiens(T_APRES); cap.rendre();
        H.v('stockage indisponible : la ligne reste (1 échec), mais les mouvements, questions et analyses sont traités', [c.lignes, c.echecs >= 1, (await lignes()).length, await avecScanId(), await db.col('analyses').countDocuments({ porteur: w.pk })], [0, true, 1, 0, 0]);
    });

    // ═══ Le câblage : la passe quotidienne anonymise après avoir purgé ═══
    await section('câblage', async () => {
        const ordre = [];
        const purge = { async purgerBanc() { ordre.push('purge'); }, async anonymiserLiens() { ordre.push('anonymisation'); } };
        H.v('purgerUneFois : la purge PUIS l\'anonymisation', [await monterBanc.purgerUneFois({ etatMongo: () => 1, purge }), ordre], [true, ['purge', 'anonymisation']]);
        const ordre2 = [], cap = capturer();
        const p2 = { async purgerBanc() { throw Object.assign(new Error('x'), { code: 'PANNE' }); }, async anonymiserLiens() { ordre2.push('anonymisation'); } };
        const ok = await monterBanc.purgerUneFois({ etatMongo: () => 1, purge: p2 }); cap.rendre();
        H.v('une purge en panne n\'empêche pas l\'anonymisation (le lien ne doit pas survivre à une panne de R2) ; la passe dit son échec', [ok, ordre2], [false, ['anonymisation']]);
        const ordre3 = [], cap3 = capturer();
        const p3 = { async purgerBanc() { ordre3.push('purge'); }, async anonymiserLiens() { throw Object.assign(new Error('y'), { code: 'PANNE' }); } };
        const ok3 = await monterBanc.purgerUneFois({ etatMongo: () => 1, purge: p3 }); cap3.rendre();
        H.v('une anonymisation en panne : la passe rend false, sans lever', [ok3, ordre3], [false, ['purge']]);
        H.v('la purge réelle expose anonymiserLiens', typeof require('../banc/purge').creerPurge({ cfg, env: {} }).anonymiserLiens, 'function');
        const sansEtat = []; await monterBanc.purgerUneFois({ etatMongo: () => 0, purge: { async purgerBanc() { sansEtat.push(1); }, async anonymiserLiens() { sansEtat.push(2); } } });
        H.v('Mongo non prêt : ni purge ni anonymisation', sansEtat, []);
    });

    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });

// RETENTION_JOURS du journal hérité, LU dans sa source (le module charge des modèles Mongoose : on ne l'importe pas). Introuvable => NaN => le test échoue (jamais vide-vert).
function journalHeriteJours() {
    const m = /const RETENTION_JOURS = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'journal-scans.js'), 'utf8'));
    return m ? Number(m[1]) : NaN;
}
