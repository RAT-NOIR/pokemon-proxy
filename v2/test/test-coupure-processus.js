'use strict';
// Banc O5 — LA COUPURE : un VRAI arrêt de processus (SIGKILL) pendant un scan, à trois instants, puis un second processus sur la MÊME base en mémoire.
//   (a) après le débit initial, pendant la LECTURE des photos ;
//   (b) après le supplément d'un lot, avant la réponse ;
//   (c) juste avant la remise de la réponse, une fois la réponse finale stockée par l'idempotence (l'état « confirmé » existe).
// Le processus tué est un enfant (enfant-coupure.js) qui monte l'application v2 ; l'arrêt est fabriqué DANS l'enfant, jamais par le code de production.
// Pour chaque instant : solde débité, marque en-suspens, réconciliation (jeune : propre ; vieillie : NON propre), rejeu avant la passe (ni gratuit ni double débit), second processus dont la
// passe de DÉMARRAGE rend (ou confirme), somme(delta) = solde poche par poche, réconciliation propre, rejeu après la passe.
// Le temps qui passe est simulé en VIEILLISSANT la marque dans la base (ouverteLe -20 min) : le seuil réel de 15 min n'est pas attendu, et le dit.
const path = require('path'), { spawn } = require('child_process');
const H = require('./_harnais');
const mongoose = require('mongoose');
const MIN = 60e3;
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ENFANT = path.join(__dirname, 'enfant-coupure.js');
const attendre = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(f, delaiMs = 40000) { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > delaiMs) return null; await attendre(150); } }

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-coupure-processus.js', ecrit: true });
    const db = require('../db'); db.brancher(mongoose.connection.db);
    const M = require('../modeles'); const J = require('../comptes/jetons'); const { lireConfig } = require('../config'); const R = require('../argent/reconcilier');
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
    await M.creerIndex();
    const raw = n => mongoose.connection.db.collection(n);
    const EXP = 990801, PID = 990901;
    await raw('catalogue_produits').insertOne({ idProduct: PID, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990950 });
    await raw('numeros_cartes').insertOne({ idProduct: PID, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-O5c', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: PID, avg: 5, low: 2, trend: 5, avg1: 5, avg7: 5, avg30: 5, guideDu: new Date('2026-10-04') });
    await raw('visuels').insertOne({ idProduct: PID, vignette: { cle: 'banc/o5c-v.webp', w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990950, numero: '001', rarete: 'Common', total: '064', variante: 'normale', setNom: 'Banc O5c', lien: null });
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });

    // ── les processus enfants
    const vivants = new Set();
    function lancer(mode, extra = {}) {
        return new Promise((resolve, reject) => {
            const e = spawn(process.execPath, [ENFANT], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COUPURE_MODE: mode, COUPURE_PID: String(PID), ...extra } });
            vivants.add(e);
            let sortie = '', port = null, fini = false;
            const sortieErr = []; e.stderr.on('data', d => sortieErr.push(String(d)));
            const fin = new Promise(r => e.on('close', (code, signal) => { fini = true; r({ code, signal }); }));
            e.stdout.on('data', d => { sortie += d; const m = /PORT=(\d+)/.exec(sortie); if (m && !port) { port = Number(m[1]); resolve({ e, url: `http://127.0.0.1:${port}`, fin, stderr: () => sortieErr.join(''), stdout: () => sortie, arreter: async () => { if (!fini) e.kill(); await fin; } }); } });
            setTimeout(() => { if (!port) { e.kill(); reject(new Error(`l'enfant (${mode}) n'a pas annoncé son port : ${sortieErr.join('').slice(0, 300)}`)); } }, 60000);
        });
    }
    const porteurs = [];
    async function instal(essais, achete) {
        const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'coupure' }), { achete, essaisInitiaux: essais });
        await db.col('installations').insertOne(i); const p = { type: 'installation', id: i._id }; porteurs.push(p);
        // les crédits achetés ont leur ligne d'achat (sinon la réconciliation y verrait un écart : le solde acheté se prouve par les mouvements)
        if (achete) await db.col('mouvements').insertOne({ installationId: i._id, le: new Date(), surface: 'extension', type: 'achat', delta: achete, poche: 'achete', motif: 'achat', scanId: null, etat: 'debite', cleIdempotence: `achat|${i._id}`, expireLe: new Date(Date.now() + 365 * 86400e3) });
        return { i, jeton, p, essais0: essais };
    }
    let nIp = 0; const ipH = () => ({ 'x-forwarded-for': `10.13.0.${++nIp}` });
    const corps = () => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
    const poster = (url, jeton, k) => H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: { origin: cfg.origines.extension, ...ipH(), authorization: `Bearer ${jeton}`, 'idempotency-key': k } });
    const poche = async x => { const d = await db.col('installations').findOne({ _id: x.i._id }); return [d.essais, d.achete]; };
    const mouv = x => db.col('mouvements').find({ installationId: x.i._id }).sort({ _id: 1 }).toArray();
    const debits = async x => (await mouv(x)).filter(m => m.type === 'debit');
    const rembs = async x => (await mouv(x)).filter(m => m.type === 'remboursement' && m.delta === 1);
    const delta = async x => (await mouv(x)).filter(m => m.type !== 'achat').reduce((t, m) => t + m.delta, 0);       // l'achat initial n'est pas un mouvement du scan
    const marqueDe = async x => db.col('scans_en_cours').findOne({ 'porteur.id': x.i._id });
    const vieillir = async x => { await db.col('scans_en_cours').updateOne({ _id: (await marqueDe(x))._id }, { $set: { ouverteLe: new Date(Date.now() - 20 * MIN) } }); };
    // somme(delta) = solde poche par poche : le solde réel vaut la dotation initiale + la somme des delta de chaque poche (réconciliation, lue ici ET par reconcilier)
    async function conserve(x) {
        const par = (await mouv(x)).reduce((t, m) => { t[m.poche] = (t[m.poche] || 0) + m.delta; return t; }, {});
        const [e, a] = await poche(x);
        return [x.essais0 + (par.essai || 0) === e, (par.achete || 0) === a];       // essai : dotation initiale + deltas ; acheté : les deltas (achat compris)
    }
    let n = 0; const cle = () => `coupure-${Date.now().toString(36)}-${++n}`;

    // ═══════════ 0. l'enfant NORMAL fonctionne (contrôle : sans coupure, le même scénario aboutit, marque livre) — sinon les rouges plus bas ne prouveraient rien
    {
        const x = await instal(1, 5); const c = await lancer('normal');
        try {
            const r = await poster(c.url, x.jeton, cle());
            const ok = await jusqua(async () => { const m = await marqueDe(x); return m && m.etat === 'livre'; });
            H.v('0. contrôle sans coupure (lot de 25) : 200, 3 crédits pris (essai 0, acheté 3), marque livre, réconciliation propre', [r.statut, await poche(x), Boolean(ok), (await R.reconcilier(x.p, cfg)).propre], [200, [0, 3], true, true]);
        } finally { await c.arreter(); }
    }

    // ═══════════ SCÉNARIO (a) : coupure PENDANT LA LECTURE (après le débit initial)
    {
        const x = await instal(1, 5), k = cle();
        const c1 = await lancer('a');
        let erreur = null; try { await poster(c1.url, x.jeton, k); } catch (e) { erreur = e; }
        const sortie1 = await c1.fin;
        H.v('(a) l\'enfant est MORT en pleine lecture (signal, pas de réponse au client) ; 1 crédit pris (essai 0), 1 ligne de débit, aucun remboursement', [Boolean(erreur), sortie1.signal || sortie1.code, await poche(x), (await debits(x)).length, (await rembs(x)).length], [true, sortie1.signal || sortie1.code, [0, 5], 1, 0]);
        H.vrai(`   (arrêt net VOULU : l'enfant a écrit son marqueur COUPURE=a puis s'est tué par SIGKILL — code de sortie ${sortie1.code}${sortie1.signal ? `, signal ${sortie1.signal}` : ''} sous Windows, jamais une sortie propre ; aucune exception dans son stderr)`, c1.stdout().includes('COUPURE=a') && !/enfant-coupure|Error/.test(c1.stderr()) && sortie1.code !== 0);
        const m0 = await marqueDe(x);
        const r0 = await R.reconcilier(x.p, cfg);
        H.v('   la marque est EN SUSPENS (écrite avant le débit), la réconciliation d\'un scan de quelques secondes reste propre (il peut encore répondre)', [m0.etat, r0.marquesEnSuspens.length, r0.propre], ['en-suspens', 0, true]);
        // rejeu AVANT la passe, par un second processus qui n'a PAS encore de passe (différée de 10 min)
        const c2 = await lancer('normal');
        try {
            const j1 = await poster(c2.url, x.jeton, k);
            H.v('   rejeu immédiat (même Idempotency-Key) : DEBIT « en cours » (le claim du mort vit encore ≤ 2 min) — ni lecture gratuite, ni 2e débit', [j1.statut, j1.json.erreur.code, (await debits(x)).length, await poche(x)], [429, 'DEBIT', 1, [0, 5]]);
            await db.col('idempotence').updateMany({}, { $set: { expireLe: new Date(Date.now() - 1000) } });          // le claim du mort a expiré (≥ 2 min sans battement)
            const j2 = await poster(c2.url, x.jeton, k);
            H.v('   rejeu après l\'expiration du claim : le débit existe, la requête est un rejeu de débit => DEBIT 429 — toujours ni lecture gratuite ni 2e débit (jusqu\'à la passe)', [j2.statut, j2.json.erreur.code, (await debits(x)).length, await poche(x), (await db.col('scans_en_cours').countDocuments({ 'porteur.id': x.i._id }))], [429, 'DEBIT', 1, [0, 5], 1]);
            await vieillir(x);
            const r1 = await R.reconcilier(x.p, cfg);
            H.v('   la marque a dépassé le seuil : la réconciliation la LISTE et n\'est PAS propre, alors que somme(delta) = solde (aucun écart)', [r1.marquesEnSuspens.length, r1.ecarts.length, r1.propre], [1, 0, false]);
        } finally { await c2.arreter(); }
        // le second processus de la passe : DEUX démarrent ensemble (deux processus, un seul gagnant)
        const [p1, p2] = await Promise.all([lancer('normal', { COUPURE_DIFFERE_MS: '0' }), lancer('normal', { COUPURE_DIFFERE_MS: '0' })]);
        try {
            const fait = await jusqua(async () => { const m = await marqueDe(x); return m && !['en-suspens', 'en-reprise'].includes(m.etat) ? m : null; });
            await attendre(800);                                                               // le second processus a le temps de perdre la prise, puis de ne rien rendre de plus
            H.v('   deux processus démarrent ensemble : UN seul remboursement — essai rendu (1, 5), une ligne +1, somme(delta) 0, marque rendu (motif arret-serveur)',
                [await poche(x), (await rembs(x)).length, await delta(x), fait && fait.etat, (await rembs(x)).map(m => m.motif)], [[1, 5], 1, 0, 'rendu', ['arret-serveur']]);
            H.v('   somme(delta) = solde poche par poche (essai, acheté), et la réconciliation est PROPRE', [await conserve(x), (await R.reconcilier(x.p, cfg)).propre], [[true, true], true]);
            const plaf = await db.col('plafonds').find({ porteur: `installation:${x.i._id}` }).toArray();
            H.v('   aucun plafond de remboursement du client consommé (faute du serveur)', plaf.reduce((t, y) => t + y.count, 0), 0);
            const j3 = await poster(p1.url, x.jeton, k);
            H.v('   rejeu APRÈS la passe (même clé) : une NOUVELLE tentative payée — 200, lot de 25, 3 crédits pris (un débit initial remboursé puis redébité sous clé dérivée), jamais gratuit',
                [j3.statut, j3.json.analyse && j3.json.analyse.statut, (await poche(x)).join(), (await debits(x)).length], [200, 'lot', '0,3', 4]);
            // contrôle : le même crédit n'est pas rendu une 2e fois par la passe suivante (marque déjà close)
            const apres = await rembs(x);
            await attendre(300);
            H.v('   la nouvelle tentative a SA marque (livre) ; aucun remboursement de plus', [(await db.col('scans_en_cours').find({ 'porteur.id': x.i._id }).toArray()).map(m => m.etat).sort(), (await rembs(x)).length], [['livre', 'rendu'], apres.length]);
        } finally { await p1.arreter(); await p2.arreter(); }
    }

    // ═══════════ SCÉNARIO (b) : coupure APRÈS LE SUPPLÉMENT, avant la réponse
    {
        const x = await instal(1, 5), k = cle();
        const c1 = await lancer('b');
        let erreur = null; try { await poster(c1.url, x.jeton, k); } catch (e) { erreur = e; }
        const s1 = await c1.fin;
        H.v('(b) l\'enfant est mort APRÈS le supplément : 3 crédits pris (essai 0, acheté 3), 3 lignes de débit, aucune ligne `analyses`, aucun remboursement, pas de réponse', [Boolean(erreur), await poche(x), (await debits(x)).length, (await rembs(x)).length, await db.col('analyses').countDocuments({ porteur: `installation:${x.i._id}` })], [true, [0, 3], 3, 0, 0]);
        H.vrai(`   (arrêt net VOULU : marqueur COUPURE=b, SIGKILL, code ${s1.code}, aucune exception dans le stderr de l'enfant)`, c1.stdout().includes('COUPURE=b') && !/enfant-coupure|Error/.test(c1.stderr()) && s1.code !== 0);
        const r0 = await R.reconcilier(x.p, cfg);
        H.v('   AVANT la correction O5 ce cas était invisible (débit à vie, solde et journal d\'accord) : somme(delta) = solde, ecarts 0 — mais la marque en suspens existe', [r0.ecarts.length, (await marqueDe(x)).etat, await conserve(x)], [0, 'en-suspens', [true, true]]);
        await vieillir(x);
        const r1 = await R.reconcilier(x.p, cfg);
        H.v('   marque vieillie : réconciliation NON propre (1 marque listée)', [r1.marquesEnSuspens.length, r1.propre], [1, false]);
        const c2 = await lancer('normal', { COUPURE_DIFFERE_MS: '0' });
        try {
            const fait = await jusqua(async () => { const m = await marqueDe(x); return m && !['en-suspens', 'en-reprise'].includes(m.etat) ? m : null; });
            H.v('   le second processus rend les TROIS unités une fois (essai 1, acheté 5), 3 lignes +1, somme(delta) 0, marque rendu', [await poche(x), (await rembs(x)).length, await delta(x), fait && fait.etat], [[1, 5], 3, 0, 'rendu']);
            H.v('   somme(delta) = solde poche par poche, et la réconciliation est PROPRE', [await conserve(x), (await R.reconcilier(x.p, cfg)).propre], [[true, true], true]);
            await attendre(1200);
            H.v('   rien de plus rendu ensuite (3 lignes +1 toujours)', (await rembs(x)).length, 3);
        } finally { await c2.arreter(); }
    }

    // ═══════════ SCÉNARIO (c) : coupure juste AVANT l'envoi, la réponse finale étant déjà stockée => CONFIRMÉ, jamais rendu
    {
        const x = await instal(1, 5), k = cle();
        const c1 = await lancer('c');
        let erreur = null; try { await poster(c1.url, x.jeton, k); } catch (e) { erreur = e; }
        const s1 = await c1.fin;
        const claim = await db.col('idempotence').findOne({ cle: `installation:${x.i._id}|identifier|${k}` });
        H.v('(c) l\'enfant est mort AU MOMENT d\'envoyer : le client n\'a rien reçu, mais la réponse finale est STOCKÉE (claim fini, statut 200) et le scan est débité (essai 0, acheté 3)', [Boolean(erreur), claim && claim.etat, claim && claim.statut, await poche(x)], [true, 'fini', 200, [0, 3]]);
        H.vrai(`   (arrêt net VOULU : marqueur COUPURE=c, SIGKILL, code ${s1.code}, aucune exception dans le stderr de l'enfant)`, c1.stdout().includes('COUPURE=c') && !/enfant-coupure|Error/.test(c1.stderr()) && s1.code !== 0);
        const m0 = await marqueDe(x);
        H.v('   la marque est en suspens (la clôture n\'a pas eu lieu)', m0.etat, 'en-suspens');
        await vieillir(x);
        const c2 = await lancer('normal', { COUPURE_DIFFERE_MS: '0' });
        try {
            const fait = await jusqua(async () => { const m = await marqueDe(x); return m && !['en-suspens', 'en-reprise'].includes(m.etat) ? m : null; });
            H.v('   le second processus CONFIRME : marque confirme (reponse-stockee), AUCUN remboursement, crédits toujours pris (le client peut rejouer sa réponse)', [fait && fait.etat, fait && fait.issue, (await rembs(x)).length, await poche(x)], ['confirme', 'reponse-stockee', 0, [0, 3]]);
            const j = await poster(c2.url, x.jeton, k);
            H.v('   le client rejoue sa clé : il reçoit la réponse figée (200, Idempotency-Replayed), du MÊME scan, sans 2e débit', [j.statut, j.entetes['idempotency-replayed'], j.json.scanId === String(m0._id), (await debits(x)).length, await poche(x)], [200, 'true', true, 3, [0, 3]]);
            H.v('   somme(delta) = solde poche par poche, et la réconciliation est PROPRE (la marque confirmée n\'est pas un reste)', [await conserve(x), (await R.reconcilier(x.p, cfg)).propre], [[true, true], true]);
        } finally { await c2.arreter(); }
    }
    for (const e of vivants) { try { e.kill(); } catch { /* déjà mort */ } }
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
