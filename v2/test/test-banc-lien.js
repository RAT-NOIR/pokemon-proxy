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
const LIEN_MOIS = cfg.retention.bancLienMois, GRACE_J = cfg.retention.bancGraceJours;
const T0 = new Date(jourUTC(new Date()).getTime() + 12 * H1);       // la contribution : aujourd'hui à 12:00Z (jamais une date en dur)
const apres = (ms, de = T0) => new Date(de.getTime() + ms);
// BANC-12 tour 1 (I-3) puis tour 2 (marge) : des COHORTES MENSUELLES décalées d'UN mois. Le jour D, on anonymise toute ligne antérieure au premier jour du mois de D moins (lien − 2) mois : une
// contribution du mois M bascule au premier instant du mois M + lien − 1 (= BASC pour M = le mois de T0), entre 10 et 11 mois d'âge, avec tout son mois : même avec la passe quotidienne, la grâce
// et un étalement, le lien reste STRICTEMENT sous 12 mois.
const debutMois = (d, n = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
// n mois CALENDAIRES plus tard, le jour ramené au dernier jour du mois d'arrivée s'il n'y existe pas (31 octobre + 11 mois = 30 septembre, jamais le 1er octobre)
const ajouterMois = (d, n) => { const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), fin), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())); };
const BASC = debutMois(T0, LIEN_MOIS - 1);
const T_AVANT = new Date(BASC.getTime() - 1), T_APRES = new Date(BASC.getTime() + H1);   // « le dernier instant avant la bascule » et « une heure après »
const LIEN_MS = BASC.getTime() - T0.getTime();
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
    const objets = new Map(), dates = new Map(), panne = { put: false, lire: false, del: false }, c = {
        objets, dates, panne, dateObjet: T0, avantSuppression: null,
        async deposerBinaire(b, k, buf) { if (b !== BUCKET) throw new Error('bucket'); if (panne.put) throw new Error('R2 en panne'); objets.set(k, buf); dates.set(k, c.dateObjet); return { ecrit: true }; },
        async supprimer(b, cles) { if (b !== BUCKET) throw new Error('bucket'); if (panne.del) throw new Error('R2 suppression en panne'); if (c.avantSuppression) await c.avantSuppression(cles); for (const k of cles) { objets.delete(k); dates.delete(k); } return cles.length; },
        async lireBinaire(b, k) { if (b !== BUCKET || panne.lire || !objets.has(k)) throw new Error('absent'); return objets.get(k); },
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
function monde(client, colFn, cfgX = cfg) {
    const stockage = creerStockage({ client, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } }); stockage.verifierBucket = async () => { };
    const env = { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL };
    const banc = creerBanc({ cfg: cfgX, env, stockage, horloge: () => cur, ...(colFn ? { colFn } : {}) });
    const creerPurge = o => require('../banc/purge').creerPurge({ cfg: cfgX, env: o.env || env, stockage, horloge: () => cur, colFn: o.colFn, ...(o.parPasseMax ? { parPasseMax: o.parPasseMax } : {}) });
    return { banc, purge: creerPurge({ colFn }), creerPurge, stockage };
}

// Un compte AVEC tout ce qui le relie à ses scans : octroi, débits, analyses, marque, idempotence, question, remboursement ; puis la contribution du banc.
async function fabriquer(m, client, { jeton = jetonNeuf(), image, ligneS4 = false } = {}) {
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
    // (tour 1, I-2) s4 porte une question OUVERTE : son débit garde son scanId ; sa propre contribution au banc le prouve (voir « après 12 mois »)
    if (ligneS4) await m.banc.apresVerdict({ corps: consent(jeton, T0), scanId: String(s4), carte: 0, issue: 'affirmee', idProduct: 4343, imageRedressee: image, detectionSure: true, versionModele: 'm1' });
    const ligne = (await lignes()).find(l => l._id === idLigne(s1)), ligne4 = (await lignes()).find(l => l._id === idLigne(s4));
    return { porteur, pk, cle, jeton, s1, s2, s3, s4, r2, ligne, ancienneCle: ligne && ligne.cleR2, ligne4, ancienneCle4: ligne4 && ligne4.cleR2 };
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
    const vider = async () => { for (const n of ['banc_lignes', 'mouvements', 'questions', 'analyses', 'scans_en_cours', 'idempotence', 'comptes', 'installations']) await db.col(n).deleteMany({}); };

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
        await vider(); clientB = fauxClient(); mB = monde(clientB); const w = wB = await fabriquer(mB, clientB, { image, ligneS4: true });
        const ancienne = w.ligne, ancienneCle = w.ancienneCle, anciennesCles = (await mouvs(w)).map(x => x.cleIdempotence).filter(Boolean);
        const R0 = await R.reconcilier({ type: 'compte', id: w.porteur.id }, { cfg }), s0 = await sommeDeltas(w), t0 = await soldeTotal(w), nMouv = (await mouvs(w)).length;
        H.v('réconciliation AVANT : aucun écart, propre, aucun débit gardé ; somme des deltas = solde', [R0.ecarts, R0.propre, R0.debitsGardes, s0 === t0, s0], [[], true, [], true, s0]);
        const nScan = await avecScanId(), nS4 = await db.col('mouvements').countDocuments({ scanId: w.s4 });
        H.v('départ : 2 lignes du banc (s1 et s4), 2 objets R2 ; s4 porte une question OUVERTE', [(await lignes()).length, clientB.objets.size, nS4 >= 1], [2, 2, true]);
        clientB.dateObjet = T_APRES;                                   // les objets écrits PAR LA PASSE portent la date de la passe
        const cap = capturer(); const b = await mB.purge.anonymiserLiens(T_APRES); cap.rendre();
        H.v('la passe après la bascule : 2 lignes anonymisées, aucun échec', [b.lignes, b.echecs, b.changees, b.forcees], [2, 0, 0, 0]);
        H.v('   chaque mouvement portant un scanId est traité SAUF ceux du scan à question ouverte (I-2) ; 1 question répondue et 2 analyses supprimées', [b.mouvements, b.questions, b.analyses], [nScan - nS4, 1, 2]);
        H.vrai('   le journal de la passe ne cite ni scanId, ni sel, ni jeton, ni clé d\'objet', !/[0-9a-f]{24}|sel-de-banc|jeton-lien|banc-reel/.test(cap.vus.join('\n')));

        // — chemin 1 : l'identifiant de la ligne par le sel (SHA-256(scanId, carte, sel)) —
        H.v('chemin 1 — _id = SHA-256(scanId, carte, sel) : aucune ligne', await db.col('banc_lignes').findOne({ _id: idLigne(w.s1) }), null);
        for (const c of [1, 2, 99]) if (await db.col('banc_lignes').findOne({ _id: idLigne(w.s1, c) })) H.vrai(`chemin 1 — carte ${c} : aucune ligne`, false);
        // — chemin 2 : le jeton de consentement —
        H.v('chemin 2 — jetonEmpreinte : aucune ligne', await db.col('banc_lignes').find({ jetonEmpreinte: empreinte(w.jeton) }).toArray(), []);
        // — chemin 3 : le contenu de la ligne —
        const ls = await lignes(), l = ls.find(x => x.verite === 4242), l4 = ls.find(x => x.verite === 4343);
        H.v('chemin 3 — deux lignes, aux seules clés admises, sans `le`, sans jeton', [ls.length, ls.map(x => Object.keys(x).sort().join()).filter((v, i, a) => a.indexOf(v) === i), ls.some(x => 'le' in x), ls.some(x => 'jetonEmpreinte' in x)], [2, ['_id,anonyme,cleR2,etat,expireLe,source,verite,versionModele,versionTexte'], false, false]);
        H.vrai('   les clés d\'une ligne fraîche (CLES_DOC) n\'ont pas changé : jeton et heure y sont encore, pour avant 12 mois', CLES_DOC.includes('jetonEmpreinte') && CLES_DOC.includes('le') && !CLES_DOC.includes('anonyme'));
        const brut = JSON.stringify(ls);
        const secrets = { scanId: String(w.s1), scanId4: String(w.s4), sel: SEL, jeton: w.jeton, empreinteJeton: empreinte(w.jeton), compte: String(w.porteur.id), idAncien: idLigne(w.s1), ancienneCle: ancienneCle.split('/').pop().replace('.webp', ''), jourDeLaContribution: T0.toISOString().slice(0, 10) };
        H.v('   le document ne contient AUCUNE valeur qui permette de recalculer le lien (scanId, sel, jeton, empreinte, compte, ancien id, ancienne clé, jour)', Object.entries(secrets).filter(([, v]) => brut.includes(v)).map(([k]) => k), []);
        H.vrai('   l\'identifiant est neuf et aléatoire (32 hex), pas SHA-256(scanId…)', /^[0-9a-f]{32}$/.test(l._id) && l._id !== idLigne(w.s1));
        H.v('   le contenu utile reste : verite, source, état, versions', [l.verite, l.source, l.etat, l.versionModele, l.versionTexte, l.anonyme], [4242, 'affirme', 'confirmee', 'm1', '2026-10-07-v1', true]);
        // (tour 2, I-5) en mois CIVILS : premier jour du mois de la contribution + bancMois mois — jamais dérivé du jour (l'ancienne formule glissait les derniers jours du mois dans le suivant)
        const attenduExp = new Date(Date.UTC(T0.getUTCFullYear(), T0.getUTCMonth() + cfg.retention.bancMois, 1));
        H.v('   l\'expiration est le premier jour du mois de la contribution + 24 mois civils : elle ne redonne que le mois, et jamais plus de 24 mois', [l.expireLe.getTime(), l.expireLe <= ajouterMois(T0, cfg.retention.bancMois)], [attenduExp.getTime(), true]);
        // (tour 2, M-1) l'alerte écrite par la passe : des NOMBRES et la date de la passe, rien d'autre
        const al = await db.col('banc_alertes').findOne({ _id: 'anonymisation' });
        const brutAl = JSON.stringify(al);
        H.v('   l\'alerte de la passe ne porte que des nombres et `majLe` : ni jeton, ni jour de contribution, ni scanId, ni compte, ni clé d\'objet',
            [Object.keys(al).sort(), Object.entries(al).filter(([k]) => !['_id', 'majLe'].includes(k)).every(([, v]) => typeof v === 'number'), [empreinte(w.jeton), String(w.s1), String(w.porteur.id), T0.toISOString().slice(0, 10), 'banc-reel'].filter(v => brutAl.includes(v))],
            [['_id', 'ageMaxJours', 'lignesEnEchec', 'majLe', 'objetsEnAttente', 'objetsRefuses'], true, []]);
        // — chemin 4 : l'objet R2 —
        H.v('chemin 4 — R2 : les anciens objets sont supprimés, deux objets, sous des clés NEUVES (celles des lignes)', [clientB.objets.has(ancienneCle), clientB.objets.has(w.ancienneCle4), clientB.objets.size, [...clientB.objets.keys()].sort()], [false, false, 2, [l.cleR2, l4.cleR2].sort()]);
        H.vrai('   l\'image est lisible sous sa clé neuve', (await mB.stockage.lire(l.cleR2)).length > 0);
        // (M-2 de la relecture : la date de l'objet n'est PAS assertée ici — c'est le faux client qui l'écrit ; la preuve est la clé neuve ET la suppression de l'ancien objet)
        // — chemin 5 : les mouvements d'argent (scanId, et la clé rb|scanId du ledger) —
        const ms = await mouvs(w);
        H.v('chemin 5 — mouvements : seul le scan à question OUVERTE (s4) garde son scanId (champ) ; s1, s2, s3 n\'apparaissent plus nulle part, clés comprises ; rien n\'a disparu',
            [(await db.col('mouvements').distinct('scanId')).filter(x => x).map(String), ms.length, JSON.stringify(ms).match(/[0-9a-f]{24}/g)?.filter(x => [w.s1, w.s2, w.s3].map(String).includes(x)) || []], [[String(w.s4)], nMouv, []]);
        // I-2 (tour 1) : ce lien-là garde un débit à son SCAN, pas une contribution — le scanId gardé ne retrouve ni la ligne ni l'objet
        H.v('   le scanId gardé (s4) ne retrouve NI la ligne du banc (SHA-256 avec le sel : rien), NI son objet (clés neuves, aucune ne dérive de s4)', [await db.col('banc_lignes').findOne({ _id: idLigne(w.s4) }), [...clientB.objets.keys()].some(k => k.includes(String(w.s4))), brut.includes(String(w.s4))], [null, false, false]);
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
        H.v('chemin 7 — la correction après 12 mois ne trouve plus rien et ne change rien', [(await lignes()).map(x => x.verite).sort(), (await lignes()).length], [[4242, 4343], 2]);
        H.v('   l\'effacement par jeton après 12 mois : 0 supprimée (le contrat l\'écrit), les objets restent', [await mB.purge.effacerParJeton(w.jeton), clientB.objets.size], [{ supprimees: 0, echecs: 0 }, 2]);
        // — la réconciliation et l'idempotence des remboursements tiennent —
        const R1 = await R.reconcilier({ type: 'compte', id: w.porteur.id }, { cfg, maintenant: T_APRES });
        H.v('réconciliation APRÈS : aucun écart ; somme des deltas = solde = celle d\'avant', [R1.ecarts, await sommeDeltas(w), await soldeTotal(w)], [[], s0, t0]);
        H.v('   elle LISTE le débit gardé (s4, sous question ouverte) avec son âge (≥ 11 mois), et n\'est plus « propre » à cause de lui', [R1.debitsGardes.map(x => String(x.scanId)), R1.debitsGardes.every(x => x.ageJours >= 300), R1.propre], [[String(w.s4)], true, false]);
        // (tour 2, M-1) le verdict GLOBAL liste lui aussi le débit gardé ; il n'a ici AUCUN autre motif d'être « non propre » (marque close, rien d'échoué, alerte à 0)
        const RT = await R.reconcilierTous({ cfg, maintenant: T_APRES });
        H.v('   reconcilierTous : le débit gardé est listé, et c\'est le seul motif de « non propre » (alerte du banc à 0)', [RT.debitsGardes.map(x => String(x.scanId)), RT.marquesEnSuspens.length, RT.rendusEchoues.length, RT.banc && RT.banc.lignesEnEchec, RT.banc && RT.banc.objetsEnAttente, RT.propre], [[String(w.s4)], 0, 0, 0, 0, false]);
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
        H.v('plafond de vie d\'une marque (suivi) = 30 min, bien en dessous de 12 mois', [MS.SUIVI_MAX_MS, MS.SUIVI_MAX_MS < LIEN_MS], [30 * MIN, true]);
        // (tour 1, I-2) une marque NON CLOSE garde le scanId de son débit : le rattrapage RENDS l'argent au lieu de sortir en « sans-debit » (ce que la v0 de ce banc trouvait « normal » : un débit sans livraison
        // qui sortait de la liste d'anomalies sans avoir été rendu)
        const b = await mB.purge.anonymiserLiens(T_APRES);
        H.v('la passe NE retire PAS le scanId d\'un débit sous une marque en suspens (0 mouvement traité), et le débit le garde', [b.mouvements, await db.col('mouvements').countDocuments({ scanId: sc })], [0, 1]);
        const avant = await soldeTotal(w), s0 = await sommeDeltas(w);
        const r = await MS.rattraper({ argent: argentDe(), maintenant: T_APRES });
        H.v('le rattrapage prend la marque et RENDS le crédit (1 unité), la marque sort « rendu »', [r.examinees, r.rendues, r.sansDebit, r.erreurs, (await db.col('scans_en_cours').findOne({ _id: sc })).etat], [1, 1, 0, 0, 'rendu']);
        H.v('   le solde monte de 1 ; la somme des deltas égale le solde, avant et après', [await soldeTotal(w) - avant, s0 === avant, await sommeDeltas(w) === await soldeTotal(w)], [1, true, true]);
        // une marque en ÉCHEC (jamais expirée) : son débit garde aussi son scanId, et la réconciliation le liste avec son âge
        const sc2 = new mongoose.Types.ObjectId();
        await Lg.debiter(w.porteur, { scanId: sc2, cleIdempotence: `scan|${pk}|echec`, surface: 'extension', maintenant: T0 }, cfg);
        await MS.ouvrir({ scanId: sc2, porteur: { type: 'compte', id: w.porteur.id }, cleDebit: `scan|${pk}|echec`, maintenant: new Date(Date.now() - H1) });
        await db.col('scans_en_cours').updateOne({ _id: sc2 }, { $set: { etat: 'echec', issue: 'poche-introuvable' } });
        const b2 = await mB.purge.anonymiserLiens(T_APRES);
        H.v('une marque en « echec » : son débit garde son scanId', await db.col('mouvements').countDocuments({ scanId: sc2 }), 1);
        const R1 = await R.reconcilier({ type: 'compte', id: w.porteur.id }, { cfg, maintenant: T_APRES });
        H.v('   la réconciliation liste la marque en échec ET le débit gardé (scanId, âge ≥ 11 mois)', [R1.marquesEnSuspens.map(x => String(x.scanId)), R1.debitsGardes.filter(x => String(x.scanId) === String(sc2)).map(x => [x.ageJours >= 300, x.etat])], [[String(sc2)], [[true, 'debite']]]);
        // (tour 2, M-1) une marque « en-reprise » (prise par une passe de rattrapage) protège son débit elle aussi
        const sc3 = new mongoose.Types.ObjectId();
        await Lg.debiter(w.porteur, { scanId: sc3, cleIdempotence: `scan|${pk}|reprise`, surface: 'extension', maintenant: T0 }, cfg);
        await MS.ouvrir({ scanId: sc3, porteur: { type: 'compte', id: w.porteur.id }, cleDebit: `scan|${pk}|reprise`, maintenant: new Date(Date.now() - H1) });
        await db.col('scans_en_cours').updateOne({ _id: sc3 }, { $set: { etat: 'en-reprise', priseLe: new Date() } });
        await mB.purge.anonymiserLiens(T_APRES);
        H.v('une marque « en-reprise » : son débit garde son scanId', await db.col('mouvements').countDocuments({ scanId: sc3 }), 1);
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
        await db.col('questions').deleteMany({ scanId: w.s4 });      // la question ouverte protégerait déjà ce débit (I-2) : ici seul son ÉTAT « rendu-echoue » doit le protéger
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
        H.v('stockage indisponible : la ligne reste (1 échec), mais les mouvements, questions et analyses sont traités', [c.lignes, c.echecs >= 1, (await lignes()).length, (await db.col('mouvements').distinct('scanId')).filter(x => x).length, await db.col('analyses').countDocuments({ porteur: w.pk })], [0, true, 1, 1, 0]);   // 1 scanId gardé : celui de la question ouverte (s4)
    });

    // ═══ I-3 — des COHORTES MENSUELLES : bornes exactes, âge à l'anonymisation entre 11 et 12 mois ═══
    await section('cohortes mensuelles', async () => {
        await vider(); const client = fauxClient(), m = monde(client);
        const M1 = debutMois(T0, 1);
        const instants = { L0: debutMois(T0, 0), L1: new Date(M1.getTime() - 1), L2: M1 };      // premier et dernier instants du mois de T0, premier instant du mois suivant
        const jetons = { L0: jetonNeuf(), L1: jetonNeuf(), L2: jetonNeuf() }, scans = {};
        for (const [k, t] of Object.entries(instants)) { cur = t; client.dateObjet = t; scans[k] = hex().slice(0, 24); await m.banc.apresVerdict({ corps: consent(jetons[k], t), scanId: scans[k], carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'm1' }); }
        H.v('départ : trois contributions — premier instant du mois M, dernier instant de M, premier instant de M+1 — trois lignes à jeton', [(await lignes()).length, (await lignes()).every(l => l.jetonEmpreinte)], [3, true]);
        H.v('la bascule de la cohorte M est le PREMIER instant de M + lien − 1 (BASC) : le premier instant de M y est à 11 mois (au plus), le dernier instant de M à 10 mois (au moins)',
            [ajouterMois(instants.L0, LIEN_MOIS - 1) >= BASC, ajouterMois(instants.L1, LIEN_MOIS - 2) <= BASC, ajouterMois(instants.L1, LIEN_MOIS - 1) > BASC], [true, true, true]);
        H.v('   la MARGE : même avec la passe quotidienne (+1 jour) et la grâce, le plus ancien de la cohorte reste STRICTEMENT sous 12 mois',
            ajouterMois(instants.L0, LIEN_MOIS) > new Date(BASC.getTime() + (1 + GRACE_J) * JOUR), true);
        client.dateObjet = new Date(BASC.getTime() - 1);
        const b0 = await m.purge.anonymiserLiens(new Date(BASC.getTime() - 1));
        H.v('au dernier instant AVANT la bascule : rien n\'est anonymisé (3 lignes à jeton)', [b0.lignes, (await lignes()).filter(l => l.jetonEmpreinte).length], [0, 3]);
        cur = new Date(BASC.getTime() - 1);
        await m.banc.corriger({ corps: consent(jetons.L1, cur), scanId: scans.L1, carte: 0, idProduct: 777 });
        H.v('   et la correction marche sur le dernier instant du mois M', (await lignes()).find(l => l.verite === 777) !== undefined, true);
        client.dateObjet = BASC;
        const b1 = await m.purge.anonymiserLiens(BASC);
        const ls = await lignes();
        H.v('au PREMIER instant de la bascule : tout le mois M (premier ET dernier instants) est anonymisé, le premier instant de M+1 ne l\'est pas', [b1.lignes, ls.filter(l => l.anonyme).length, ls.filter(l => l.jetonEmpreinte).map(l => l.le.getTime())], [2, 2, [jourUTC(M1).getTime()]]);
        cur = BASC;
        await m.banc.corriger({ corps: consent(jetons.L2, BASC), scanId: scans.L2, carte: 0, idProduct: 555 });
        H.v('   et la correction de M+1 marche encore à cet instant exact (le jour de la ligne = la limite : strict)', (await lignes()).find(l => l.jetonEmpreinte).verite, 555);
        await m.banc.corriger({ corps: consent(jetons.L0, BASC), scanId: scans.L0, carte: 0, idProduct: 999 });
        H.v('   la correction du mois M est refusée à cet instant (aucune ligne n\'a le verite 999)', (await lignes()).some(l => l.verite === 999), false);
        // les lignes sont traitées dans l'ordre de leur _id (une empreinte : aucun lien avec la date), jamais dans l'ordre de `le`
    });

    // ═══ Les bornes exactes des AUTRES magasins (mouvements, analyses, questions) : strictement avant la limite ═══
    await section('bornes strictes', async () => {
        await vider(); const client = fauxClient(), m = monde(client);
        const L = debutMois(BASC, -(LIEN_MOIS - 2)), avantL = new Date(L.getTime() - 1);       // la limite que la passe calcule à l'instant de la bascule
        const mv = async (le, k) => { const scanId = new mongoose.Types.ObjectId(); await db.col('mouvements').insertOne({ compteId: new mongoose.Types.ObjectId(), le, surface: 'extension', type: 'debit', delta: 0, poche: null, credit: null, motif: 'administrateur', scanId, etat: 'debite', cleIdempotence: `borne-${k}-${hex()}`, expireLe: apres(2 * LIEN_MS) }); return scanId; };
        const sM1 = await mv(L, 'L'), sM0 = await mv(avantL, 'avant');
        const an = async (creeLe) => { const _id = new mongoose.Types.ObjectId(); await db.col('analyses').insertOne({ _id, porteur: 'compte:borne', surface: 'extension', statut: 'x', cartes: [], produits: [], facturation: {}, creeLe, expireLe: apres(2 * LIEN_MS) }); return _id; };
        const aL = await an(L), aAvant = await an(avantL);
        const qs = async (poseeLe) => { const scanId = new mongoose.Types.ObjectId(); await db.col('questions').insertOne({ _id: `${scanId}:0`, scanId, carte: 0, porteur: { type: 'compte', id: 'borne' }, etat: 'repondue', poseeLe }); return scanId; };
        const qL = await qs(L), qAvant = await qs(avantL);
        client.dateObjet = BASC; const b = await m.purge.anonymiserLiens(BASC);
        H.v('mouvement EXACTEMENT à la limite : garde son scanId ; une milliseconde avant : le perd', [!!(await db.col('mouvements').findOne({ scanId: sM1 })), !!(await db.col('mouvements').findOne({ scanId: sM0 }))], [true, false]);
        H.v('analyse EXACTEMENT à la limite : gardée ; une milliseconde avant : supprimée', [!!(await db.col('analyses').findOne({ _id: aL })), !!(await db.col('analyses').findOne({ _id: aAvant }))], [true, false]);
        H.v('question terminée EXACTEMENT à la limite : gardée ; une milliseconde avant : supprimée', [!!(await db.col('questions').findOne({ scanId: qL })), !!(await db.col('questions').findOne({ scanId: qAvant }))], [true, false]);
        H.v('   (bilan : 1 mouvement, 1 question, 1 analyse)', [b.mouvements, b.questions, b.analyses], [1, 1, 1]);
    });

    // ═══ Le plafond de la passe, et l'ORDRE : par _id (une empreinte), jamais par `le` ═══
    await section('plafond et ordre', async () => {
        await vider(); const client = fauxClient(), m = monde(client); cur = T0; client.dateObjet = T0;
        for (let i = 0; i < 6; i++) await m.banc.apresVerdict({ corps: consent(jetonNeuf(), T0), scanId: hex().slice(0, 24), carte: 0, issue: 'affirmee', idProduct: 4242 + i, imageRedressee: image, detectionSure: true, versionModele: 'm1' });
        const ids = (await lignes()).map(l => l._id).sort();
        const p = m.creerPurge({ parPasseMax: 2 }); client.dateObjet = T_APRES;
        const b1 = await p.anonymiserLiens(T_APRES);
        const restantes = (await lignes()).filter(l => !l.anonyme).map(l => l._id).sort();
        H.v('plafond de 2 lignes par passe : 2 traitées, les 4 restantes sont celles dont l\'_id est le plus GRAND (ordre par _id)', [b1.lignes, restantes], [2, ids.slice(2)]);
        const b2 = await p.anonymiserLiens(T_APRES), b3 = await p.anonymiserLiens(T_APRES), b4 = await p.anonymiserLiens(T_APRES);
        H.v('   les passes suivantes finissent le travail, puis rien : 2, 2, 0 — six lignes anonymes', [b2.lignes, b3.lignes, b4.lignes, (await lignes()).filter(l => l.anonyme).length], [2, 2, 0, 6]);
    });

    // ═══ I-1 — le chemin d'ÉCHEC coupe au lieu de garder le lien : délai de grâce, puis suppression par la base seule ═══
    await section('échec : grâce puis suppression', async () => {
        const PG0 = T_APRES, PG1 = apres(GRACE_J * JOUR + JOUR, BASC);       // dans la grâce, et un jour au-delà
        const alerte = () => db.col('banc_alertes').findOne({ _id: 'anonymisation' });
        const queue = async () => (await db.col('banc_objets_a_supprimer').find({}).toArray());
        // (1) l'objet source est ABSENT
        await vider(); await db.col('banc_objets_a_supprimer').deleteMany({}); let client = fauxClient(), m = monde(client); let w = await fabriquer(m, client, { image });
        client.objets.delete(w.ancienneCle);
        const cap1 = capturer(); const e0 = await m.purge.anonymiserLiens(PG0); cap1.rendre();
        const a0 = await alerte();
        H.v('(1) objet absent, DANS la grâce : 1 échec, la ligne reste, l\'alerte dit 1 ligne en échec d\'âge 0 jour et 0 objet en attente', [e0.echecs, e0.forcees, (await lignes()).length, a0 && a0.lignesEnEchec, a0 && a0.ageMaxJours, a0 && a0.objetsEnAttente], [1, 0, 1, 1, 0, 0]);
        const cap2 = capturer(); await m.purge.anonymiserLiens(apres(3 * JOUR + H1, BASC));
        H.v('   trois jours après la bascule, toujours dans la grâce : la ligne reste et l\'alerte dit l\'âge (3 jours)', [(await lignes()).length, (await alerte()).lignesEnEchec, (await alerte()).ageMaxJours], [1, 1, 3]);
        const e1 = await m.purge.anonymiserLiens(PG1); cap2.rendre();
        const a1 = await alerte();
        H.v('   AU-DELÀ de la grâce : la ligne est SUPPRIMÉE par la base seule (0 ligne), l\'alerte retombe à 0', [e1.forcees, (await lignes()).length, a1 && a1.lignesEnEchec, a1 && a1.objetsEnAttente], [1, 0, 0, 0]);
        // (2) le stockage est EN PANNE (lecture ET suppression) : dans la grâce la ligne reste ; au-delà elle est supprimée et ses clés mises en attente
        await vider(); client = fauxClient(); m = monde(client); w = await fabriquer(m, client, { image });
        await db.col('questions').deleteMany({});         // aucune question ouverte : aucun débit gardé, le verdict ne dépend que de l'alerte du banc
        client.panne.lire = true; client.panne.del = true;
        const cap3 = capturer(); const f0 = await m.purge.anonymiserLiens(PG0); cap3.rendre();
        const prise = (await lignes())[0], a2 = await alerte();
        H.v('(2) stockage en panne DANS la grâce : la ligne reste (état prise), l\'alerte est là', [f0.echecs, (await lignes()).length, prise.etat, a2 && a2.lignesEnEchec], [1, 1, 'anonymisation', 1]);
        const cles = [w.ancienneCle, prise.anonCle].sort();
        const cap4 = capturer(); const f1 = await m.purge.anonymiserLiens(PG1); cap4.rendre();
        const q = await queue(), a3 = await alerte();
        H.v('   stockage encore en panne AU-DELÀ : la ligne est supprimée, ses deux clés (ancienne et copie) sont mises en attente — des clés SEULES', [f1.forcees, (await lignes()).length, q.map(x => x._id).sort(), q.map(x => Object.keys(x).join())], [1, 0, cles, ['_id', '_id']]);
        const brutQ = JSON.stringify(q);
        H.v('   rien ne relie plus : ni jeton, ni scanId, ni compte, ni jour dans la liste ; l\'alerte compte 2 objets en attente', [[empreinte(w.jeton), String(w.s1), String(w.porteur.id), T0.toISOString().slice(0, 10)].filter(v => brutQ.includes(v)), a3 && a3.objetsEnAttente, a3 && a3.lignesEnEchec], [[], 2, 0]);
        // (tour 2, M-1) un rejeu pendant que le stockage est TOUJOURS en panne ne perd aucune clé (l'entrée n'est retirée qu'une fois l'objet supprimé)
        const capR = capturer(); await m.purge.anonymiserLiens(apres(H1, PG1)); capR.rendre();
        H.v('   un rejeu avec le stockage toujours en panne ne PERD aucune clé : 2 entrées, 2 objets en attente', [(await queue()).length, (await alerte()).objetsEnAttente], [2, 2]);
        const Tq = await R.reconcilierTous({ cfg, maintenant: apres(H1, PG1) });
        H.v('   la réconciliation : 0 ligne en échec mais 2 objets en attente suffisent à la rendre « non propre »', [Tq.banc.lignesEnEchec, Tq.banc.objetsEnAttente, Tq.propre], [0, 2, false]);
        client.panne.lire = false; client.panne.del = false;
        const f2 = await m.purge.anonymiserLiens(apres(2 * H1, PG1));
        H.v('   le stockage revient : la passe suivante REJOUE la liste — objet supprimé, liste vide, alerte à 0', [client.objets.has(w.ancienneCle), (await queue()).length, (await alerte()).objetsEnAttente], [false, 0, 0]);
        // (tour 2, M-4) une alerte qui n'est plus mise à jour (la passe ne tourne plus) ne rassure pas : au-delà de 3 jours, périmée
        const Tf = await R.reconcilierTous({ cfg, maintenant: apres(2 * H1, PG1) }), Tp = await R.reconcilierTous({ cfg, maintenant: apres(5 * JOUR, PG1) });
        const Tj = await R.reconcilierTous({ cfg, maintenant: apres(2 * H1 + 2 * JOUR, PG1) });         // tour 3 : la BORNE BASSE — deux jours après la passe, l'état est encore frais
        H.v('   l\'état écrit par la passe est PÉRIMÉ au-delà de 3 jours sans passe (frais à +1 h et à +2 jours) : le verdict n\'est plus « propre »', [Tf.banc.perime, Tf.propre, Tj.banc.perime, Tj.propre, Tp.banc.perime, Tp.propre], [false, true, false, true, true, false]);
        // (3) le stockage est ABSENT (variable manquante) : au-delà de la grâce, les lignes partent par la base seule
        await vider(); await db.col('banc_objets_a_supprimer').deleteMany({}); client = fauxClient(); m = monde(client); w = await fabriquer(m, client, { image });
        const sans = m.creerPurge({ env: {} });
        const cap5 = capturer(); const g0 = await sans.anonymiserLiens(PG0);
        H.v('(3) stockage absent, DANS la grâce : la ligne reste (1 échec)', [g0.echecs >= 1, (await lignes()).length, (await alerte()).lignesEnEchec], [true, 1, 1]);
        const g1 = await sans.anonymiserLiens(PG1); cap5.rendre();
        H.v('   AU-DELÀ : la ligne est supprimée sans stockage, sa clé est mise en attente', [g1.forcees, (await lignes()).length, (await queue()).map(x => x._id)], [1, 0, [w.ancienneCle]]);
        // (5) la copie anonyme EXISTE mais l'ancienne ligne ne peut jamais être supprimée (Mongo refuse) : au-delà de la grâce, la copie ET l'ancienne partent, objets compris
        await vider(); await db.col('banc_objets_a_supprimer').deleteMany({}); client = fauxClient(); client.dateObjet = PG0; w = await fabriquer(monde(client), client, { image }); client.dateObjet = PG0;
        const colJamais = colAvec({ deleteOne: async f => { if (f && f.etat === 'anonymisation') throw Object.assign(new Error('coupure'), { code: 'COUPURE' }); } });
        const cap7 = capturer(); await monde(client, colJamais).purge.anonymiserLiens(PG0);
        H.v('(5) départ dans la grâce : la copie anonyme existe, l\'ancienne ligne reste (2 lignes, 2 objets)', [(await lignes()).length, client.objets.size], [2, 2]);
        const h1 = await monde(client, colJamais).purge.anonymiserLiens(PG1); cap7.rendre();
        H.v('   AU-DELÀ : l\'ancienne ET la copie sont supprimées, leurs deux objets aussi (0 ligne, 0 objet)', [h1.forcees, (await lignes()).length, client.objets.size], [1, 0, 0]);
        // (6) l'ÂGE MAXIMAL réel : une contribution du premier instant de son mois, une passe qui ne passe que le lendemain, un stockage en panne tout du long : la ligne est supprimée au plus tard
        // à la bascule + 1 jour + la grâce — et ce moment est STRICTEMENT avant ses 12 mois
        await vider(); await db.col('banc_objets_a_supprimer').deleteMany({}); client = fauxClient(); m = monde(client);
        const C = debutMois(T0, 0), tardif = new Date(BASC.getTime() + JOUR), limiteAge = new Date(BASC.getTime() + JOUR + GRACE_J * JOUR);
        cur = C; client.dateObjet = C; const scL = hex().slice(0, 24);
        await m.banc.apresVerdict({ corps: consent(jetonNeuf(), C), scanId: scL, carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'm1' });
        client.panne.lire = true; client.panne.del = true;
        const cap8 = capturer(); await m.purge.anonymiserLiens(tardif);
        const reste = (await lignes()).length;
        await m.purge.anonymiserLiens(new Date(limiteAge.getTime() + 1)); cap8.rendre();
        H.v('(6) contribution du premier instant du mois, passe le lendemain de la bascule, stockage en panne : la ligne tient pendant la grâce, puis disparaît ; ce moment est avant ses 12 mois',
            [reste, (await lignes()).length, new Date(limiteAge.getTime() + 1) < ajouterMois(C, 12)], [1, 0, true]);
        // (7) tour 3, I-6 — LE PIRE MOIS : février d'une année non bissextile (28 jours = la marge). Contribution au premier instant du mois M (M + 11 = février), stockage en panne tout du long,
        // une passe par jour : toute grâce QUE LA CONFIGURATION ACCEPTE doit faire disparaître la ligne avant ses 12 mois
        let anF = T0.getUTCFullYear() + 1; while (new Date(Date.UTC(anF, 2, 0)).getUTCDate() !== 28) anF++;
        const CF0 = new Date(Date.UTC(anF - 1, 2, 1)), BASCF = new Date(Date.UTC(anF, 1, 1)), D12 = ajouterMois(CF0, 12);
        const acceptees = [];
        for (const g of [0, 7, 14, 21, 22, 28, 30, 31, 40]) {
            let cfgG; try { cfgG = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_BANC_GRACE_JOURS: String(g) }); } catch (_) { continue; }
            acceptees.push(g);
            await vider(); await db.col('banc_objets_a_supprimer').deleteMany({}); const cl = fauxClient(), mg = monde(cl, undefined, cfgG);
            cur = CF0; cl.dateObjet = CF0;
            await mg.banc.apresVerdict({ corps: consent(jetonNeuf(), CF0), scanId: hex().slice(0, 24), carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'm1' });
            cl.panne.lire = true; cl.panne.del = true;
            const capG = capturer(); let disparue = null;
            for (let d = 1; d <= 60 && !disparue; d++) { const t = new Date(BASCF.getTime() + d * JOUR + 12 * H1); await mg.purge.anonymiserLiens(t); if (!(await lignes()).length) disparue = t; }
            capG.rendre();
            H.v(`(7) février non bissextile, grâce de ${g} j acceptée par la configuration : la ligne disparaît (passe quotidienne) avant les 12 mois de sa contribution`, [!!disparue, disparue ? disparue < D12 : null], [true, true]);
        }
        H.v('   les grâces acceptées par la configuration sont exactement celles de 0 à 21 jours', acceptees, [0, 7, 14, 21]);
        // (4) reconcilier lit l'alerte
        await vider(); await db.col('banc_objets_a_supprimer').deleteMany({}); await db.col('banc_alertes').deleteMany({}); client = fauxClient(); m = monde(client); w = await fabriquer(m, client, { image });
        await db.col('questions').deleteMany({});         // aucune question ouverte : le seul motif possible d'une réconciliation non propre est l'alerte du banc
        const T0r = await R.reconcilierTous({ cfg, maintenant: T0 });
        H.v('(4) témoin : sans aucune passe en échec, la réconciliation est propre et ne dit rien du banc', [T0r.propre, T0r.banc], [true, null]);
        client.panne.lire = true; const cap6 = capturer(); await m.purge.anonymiserLiens(PG0); cap6.rendre(); client.panne.lire = false;
        const T = await R.reconcilierTous({ cfg, maintenant: PG0 });
        H.v('   après un échec : elle dit le nombre de lignes du banc en échec, leur âge et les objets en attente, et n\'est plus propre', [T.banc && T.banc.lignesEnEchec, T.banc && T.banc.ageMaxJours, T.banc && T.banc.objetsEnAttente, T.propre], [1, 0, 0, false]);
    });

    // ═══ I-4 — l'effacement par jeton après une coupure supprime AUSSI la copie, et ne ment pas ═══
    await section('effacement après coupure', async () => {
        await vider(); const client = fauxClient(); client.dateObjet = T_APRES;
        let casse = true;
        const colB = colAvec({ deleteOne: async f => { if (casse && f && f.etat === 'anonymisation') { casse = false; throw Object.assign(new Error('coupure'), { code: 'COUPURE' }); } } });
        const w = await fabriquer(monde(client), client, { image }); client.dateObjet = T_APRES;
        const cap = capturer(); await monde(client, colB).purge.anonymiserLiens(T_APRES); cap.rendre();
        H.v('départ : coupure entre la copie et la suppression de l\'ancienne ligne — 2 lignes (l\'ancienne prise + la copie anonyme), 2 objets', [(await lignes()).length, client.objets.size], [2, 2]);
        const copie = (await lignes()).find(l => l.anonyme);
        // la copie échoue à se supprimer : la réponse ne compte PAS cette ligne comme supprimée, et l'ancienne reste pour une nouvelle tentative
        client.avantSuppression = async cles => { if (cles.includes(copie.cleR2)) throw new Error('R2 refuse la copie'); };
        const capE = capturer(); const e1 = await monde(client).purge.effacerParJeton(w.jeton); capE.rendre(); client.avantSuppression = null;
        H.v('effacement avec la copie récalcitrante : 0 supprimée, 1 échec ; l\'ancienne ligne (au jeton) est GARDÉE pour la reprise', [e1, (await lignes()).filter(l => l.jetonEmpreinte).length, (await lignes()).filter(l => l.anonyme).length], [{ supprimees: 0, echecs: 1 }, 1, 1]);
        const e2 = await monde(client).purge.effacerParJeton(w.jeton);
        H.v('effacement relancé : 1 supprimée, 0 échec ; PLUS aucune ligne, PLUS aucun objet (la copie anonyme est partie avec)', [e2, (await lignes()).length, client.objets.size], [{ supprimees: 1, echecs: 0 }, 0, 0]);
    });

    // ═══ (tour 2, M-1) les gardes de la lecture de l'argent : question « en-reglement », garde illisible ═══
    await section('gardes de l\'argent', async () => {
        await vider(); let client = fauxClient(), m = monde(client); let w = await fabriquer(m, client, { image });
        await db.col('questions').updateOne({ _id: `${w.s4}:0` }, { $set: { etat: 'en-reglement', priseLe: T0 } });
        const n4 = await db.col('mouvements').countDocuments({ scanId: w.s4 });
        client.dateObjet = T_APRES; await m.purge.anonymiserLiens(T_APRES);
        H.v('une question « en-reglement » protège elle aussi le débit de son scan', [n4 >= 1, await db.col('mouvements').countDocuments({ scanId: w.s4 })], [true, n4]);
        await vider(); client = fauxClient(); w = await fabriquer(monde(client), client, { image });
        // les marques ne se lisent pas : la passe ne sait pas quels débits sont encore utiles
        const illisible = n => { const r = db.col(n); return n !== 'scans_en_cours' ? r : new Proxy(r, { get(t, p) { if (p === 'find') return () => ({ toArray: async () => { throw Object.assign(new Error('lecture'), { code: 'ILLISIBLE' }); } }); const f = t[p]; return typeof f === 'function' ? f.bind(t) : f; } }); };
        const n = await avecScanId(); client.dateObjet = T_APRES;
        const cap = capturer(); const b = await monde(client).creerPurge({ colFn: illisible }).anonymiserLiens(T_APRES); cap.rendre();
        H.v('garde illisible : la passe ne retire RIEN (aucun mouvement touché) et dit son échec', [b.mouvements, await avecScanId(), b.echecs >= 1], [0, n, true]);
    });

    // ═══ (tour 2, I-5) l'expiration de la copie est au grain du MOIS CIVIL : le premier et le dernier jour d'un mois donnent le MÊME `expireLe` ═══
    await section('expireLe au grain du mois', async () => {
        const an = T0.getUTCFullYear();
        for (const [nom, mois] of [['janvier', 0], ['février', 1], ['juin', 5], ['décembre', 11]]) {
            await vider(); const client = fauxClient(), m = monde(client);
            const dernierJour = new Date(Date.UTC(an, mois + 1, 0)).getUTCDate();
            const jours = [...new Set([1, 15, dernierJour - 2, dernierJour - 1, dernierJour])];
            for (const j of jours) { const t = new Date(Date.UTC(an, mois, j, 12)); cur = t; client.dateObjet = t; await m.banc.apresVerdict({ corps: consent(jetonNeuf(), t), scanId: hex().slice(0, 24), carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'm1' }); }
            const P = new Date(debutMois(new Date(Date.UTC(an, mois, 1)), LIEN_MOIS - 1).getTime() + H1); client.dateObjet = P;
            await m.purge.anonymiserLiens(P);
            const ls = await lignes(), exp = [...new Set(ls.map(l => l.expireLe.getTime()))];
            H.v(`${nom} (${jours.length} jours de contribution, du 1er au ${dernierJour}) : toutes les copies anonymes ont le MÊME expireLe = 1er du mois + 24 mois civils, jamais plus de 24 mois après la contribution`,
                [ls.length, ls.every(l => l.anonyme), exp, exp[0] <= ajouterMois(new Date(Date.UTC(an, mois, 1, 12)), cfg.retention.bancMois).getTime()], [jours.length, true, [Date.UTC(an, mois + cfg.retention.bancMois, 1)], true]);
        }
    });

    // ═══ (tour 2, M-2) une clé d'objet que le stockage refuse pour toujours est comptée À PART : l'alerte des lignes peut retomber à 0 ═══
    await section('objets refusés par le stockage', async () => {
        await vider(); await db.col('banc_objets_a_supprimer').deleteMany({}); await db.col('banc_alertes').deleteMany({});
        const client = fauxClient(), m = monde(client);
        await db.col('banc_objets_a_supprimer').insertOne({ _id: 'banc-reel/v2/refusee-pour-toujours.webp' });      // une forme que le stockage refuse (cle-refusee)
        const cap = capturer(); await m.purge.anonymiserLiens(T_APRES); await m.purge.anonymiserLiens(apres(H1, T_APRES)); cap.rendre();
        const al = await db.col('banc_alertes').findOne({ _id: 'anonymisation' }), q = await db.col('banc_objets_a_supprimer').find({}).toArray();
        H.v('la clé refusée est comptée à part (1 objet refusé) ; l\'alerte « objets en attente » et celle des lignes retombent à 0', [al.objetsRefuses, al.objetsEnAttente, al.lignesEnEchec], [1, 0, 0]);
        H.v('   elle reste listée, marquée refusée (rien n\'est rejoué en boucle)', q.map(x => [x._id, x.refuse]), [['banc-reel/v2/refusee-pour-toujours.webp', true]]);
        const T = await R.reconcilierTous({ cfg, maintenant: apres(H1, T_APRES) });
        H.v('   la réconciliation la dit (objets refusés : 1) sans bloquer le verdict à cause d\'elle', [T.banc.objetsRefuses, T.banc.objetsEnAttente, T.propre], [1, 0, true]);
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
