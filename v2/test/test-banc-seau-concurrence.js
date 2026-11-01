'use strict';
// BANC-200 (tour 2) — LE SCELLÉ CONTRE DES ÉCRITURES SIMULTANÉES. Un seau se scelle pendant que des photos (R2 lent), des mesures et de nouvelles lignes sont en vol ; 50 manches, délais aléatoires.
// Propriétés exigées : (1) AUCUNE écriture n'est acceptée après le scellé (aucun document reçu après `scelleLe`, aucune écriture acceptée absente du scellé) ; (2) `verifier` reste ok, aussitôt et 100 ms plus tard ;
// (3) deux scellés simultanés : un seul réussit, l'autre dit « deja-scelle », et l'état n'est jamais remis à « ouvert » ni passé par un état intermédiaire ; (4) idem pour une vérité réécrite pendant le scellé d'un juge.
// Base EN MÉMOIRE, stockage MÉMOIRE (avec un `ecrire` lent), aucun réseau.
const H = require('./_harnais');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const S = require('../banc/stockage');
const { creerSeaux } = require('../banc/seau');

const MANCHES = 50;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const alea = n => Math.floor(Math.random() * n);
const oid = () => new mongoose.Types.ObjectId();
const octets = () => crypto.randomBytes(64);

(async () => {
    await H.ouvrirBac('test-banc-seau-concurrence.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_BANC_SEAU: '1' });
    const memoire = S.creerStockageMemoire(S.CLE_SEAU);
    // R2 LENT : chaque écriture d'objet prend 0 à 40 ms — la fenêtre où, avant ce tour, une photo « en vol » s'insérait après le scellé
    const lent = { verifierBucket: async () => { }, ecrire: async (c, b) => { await dormir(alea(40)); return memoire.ecrire(c, b); }, lire: c => memoire.lire(c), supprimer: c => memoire.supprimer(c) };
    const ancres = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-conc-'));
    const catalogue = { lire: async ids => new Map(ids.map(i => [i, { idProduct: i }])) };
    const seaux = creerSeaux({ cfg, stockage: lent, catalogue, ancresDir: ancres });
    const PORTEUR = `compte:${oid()}`;
    const semer = async () => { const _id = oid(); await db.col('analyses').insertOne({ _id, porteur: PORTEUR, statut: 'identifiee', cartes: [{ idProduct: 2001, statut: 'identifiee' }], creeLe: new Date(), expireLe: new Date(Date.now() + 864e5) }); return String(_id); };
    // échafaudage du banc : si une manche a échoué à sceller, on referme le seau à la main pour que la suivante puisse naître (l'échec est DÉJÀ compté comme violation)
    const nettoyer = () => db.col('banc_seaux').updateMany({ etat: { $in: ['ouvert', 'scellement'] } }, { $set: { etat: 'scelle' } });
    const tenter = (retard, f) => (async () => { await dormir(retard); try { await f(); return { ok: true }; } catch (e) { return { ok: false, code: (e && (e.detail || e.code)) || 'erreur' }; } })();

    // ── 1. UN scellé contre N écritures simultanées, MANCHES fois
    let accepteesTotal = 0, refuseesTotal = 0, violations = [], melanges = 0;
    for (let m = 0; m < MANCHES; m++) {
        await nettoyer(); const seau = await seaux.declarer({ nom: `conc-${m}`, type: 'entrainement', cible: 60, par: 'test' });
        const s1 = await semer(), s2 = await semer();
        for (const s of [s1, s2]) await seaux.enregistrerPhoto({ scanId: s, porteur: PORTEUR, seauId: seau.id, index: 0, octets: octets(), type: 'image/jpeg' });
        const ecritures = [];
        for (let k = 1; k <= 5; k++) { const scanId = k % 2 ? s1 : s2, o = octets(); ecritures.push({ genre: 'photo', scanId, index: k, id: `${scanId}:${k}`, p: tenter(alea(70), () => seaux.enregistrerPhoto({ scanId, porteur: PORTEUR, seauId: seau.id, index: k, octets: o, type: 'image/jpeg' })) }); }
        ecritures.push({ genre: 'mesures', scanId: s1, id: s1, p: tenter(alea(70), () => seaux.enregistrerMesures({ scanId: s1, porteur: PORTEUR, seauId: seau.id, octets: Buffer.from(JSON.stringify({ v: m })) })) });
        for (let k = 0; k < 2; k++) { const scanId = await semer(); ecritures.push({ genre: 'ligne', scanId, id: `${scanId}:0`, p: tenter(alea(70), () => seaux.enregistrerPhoto({ scanId, porteur: PORTEUR, seauId: seau.id, index: 0, octets: octets(), type: 'image/jpeg' })) }); }
        // le scelleur : il recommence quand une écriture s'est glissée (c'est son contrat), pas plus de 40 fois
        const scelleur = tenter(alea(30), async () => { for (let t = 0; t < 40; t++) { try { return await seaux.sceller(seau.id); } catch (e) { if (!e || !['ecritures-en-cours'].includes(e.detail)) throw e; await dormir(10); } } throw new Error('scellé jamais obtenu'); });
        const resultats = await Promise.all(ecritures.map(e => e.p));
        const sc = await scelleur;
        if (!sc.ok) { violations.push(`manche ${m} : scellé refusé (${sc.code})`); continue; }
        await dormir(30);
        const fini = await db.col('banc_seaux').findOne({ _id: seau.id });
        let acc = 0, ref = 0;
        for (let i = 0; i < ecritures.length; i++) {
            const e = ecritures[i], r = resultats[i];
            const doc = e.genre === 'mesures' ? await db.col('banc_seau_mesures').findOne({ _id: e.scanId }) : e.genre === 'ligne' ? await db.col('banc_seau_photos').findOne({ _id: e.id }) : await db.col('banc_seau_photos').findOne({ _id: e.id });
            if (r.ok) { acc++; if (!doc) violations.push(`manche ${m} : écriture acceptée sans document (${e.genre})`); } else { ref++; if (doc) violations.push(`manche ${m} : écriture REFUSÉE (${r.code}) mais présente (${e.genre})`); }
            if (doc && doc.recuLe > fini.scelleLe) violations.push(`manche ${m} : ${e.genre} reçu APRÈS le scellé`);
        }
        const v1 = await seaux.verifierChaine(seau.id);
        if (!v1.ok) violations.push(`manche ${m} : verifier pas ok (${JSON.stringify(v1.problemes.map(p => p.cause))})`);
        await dormir(100);
        const v2 = await seaux.verifierChaine(seau.id);
        if (!v2.ok) violations.push(`manche ${m} : verifier pas ok 100 ms plus tard (${JSON.stringify(v2.problemes.map(p => p.cause))})`);
        if (fini.etat !== 'scelle') violations.push(`manche ${m} : état ${fini.etat}`);
        accepteesTotal += acc; refuseesTotal += ref; if (acc && ref) melanges++;
    }
    H.v(`1. ${MANCHES} manches, un scellé contre 8 écritures simultanées : AUCUNE violation (écriture après le scellé, document manquant, verifier pas ok)`, violations.slice(0, 5), []);
    H.vrai(`1. la course a vraiment eu lieu : des écritures acceptées (${accepteesTotal}) ET refusées (${refuseesTotal}), dont ${melanges} manches mêlant les deux`, accepteesTotal > 0 && refuseesTotal > 0);

    // ── 2. DEUX scellés simultanés : un seul réussit, l'état n'est jamais remis « ouvert » ni intermédiaire
    let fautes = [];
    for (let m = 0; m < MANCHES; m++) {
        await nettoyer(); const seau = await seaux.declarer({ nom: `duo-${m}`, type: 'entrainement', cible: 5, par: 'test' });
        const s = await semer(); await seaux.enregistrerPhoto({ scanId: s, porteur: PORTEUR, seauId: seau.id, index: 0, octets: octets(), type: 'image/jpeg' });
        const vus = new Set(); let fin = false;
        const sonde = (async () => { while (!fin) { const d = await db.col('banc_seaux').findOne({ _id: seau.id }, { projection: { etat: 1 } }); if (d) vus.add(d.etat); await dormir(1); } })();
        const r = await Promise.all([tenter(alea(6), () => seaux.sceller(seau.id)), tenter(alea(6), () => seaux.sceller(seau.id))]);
        fin = true; await sonde;
        const reussis = r.filter(x => x.ok).length, deja = r.filter(x => !x.ok && x.code === 'deja-scelle').length;
        const etat = (await db.col('banc_seaux').findOne({ _id: seau.id })).etat;
        if (reussis !== 1 || deja !== 1) fautes.push(`manche ${m} : réussis ${reussis}, deja-scelle ${deja} (${JSON.stringify(r.map(x => x.code))})`);
        if (etat !== 'scelle') fautes.push(`manche ${m} : état final ${etat}`);
        if ([...vus].some(x => x !== 'ouvert' && x !== 'scelle')) fautes.push(`manche ${m} : état intermédiaire vu (${[...vus]})`);
        if (!(await seaux.verifierChaine(seau.id)).ok) fautes.push(`manche ${m} : verifier pas ok`);
    }
    H.v(`2. ${MANCHES} manches, DEUX scellés simultanés : un seul réussit, l'autre dit deja-scelle, état final scelle, jamais d'état intermédiaire ni de retour à ouvert`, fautes.slice(0, 5), []);

    // ── 3. un JUGE : une vérité réécrite pendant le scellé (le scellé couvre les vérités)
    await nettoyer(); const juge = await seaux.declarer({ nom: 'juge-conc', type: 'juge', cible: 3, par: 'test' });
    const sj = [];
    for (let i = 0; i < 3; i++) { const s = await semer(); sj.push(s); await seaux.enregistrerPhoto({ scanId: s, porteur: PORTEUR, seauId: juge.id, index: 0, octets: octets(), type: 'image/jpeg', annonce: crypto.createHash('sha256').update(s).digest('hex') }); await seaux.saisirVerite({ scanId: s, idProduct: 2001, via: 'idProduct', porteur: PORTEUR }); }
    const reecrit = []; for (let k = 0; k < 6; k++) reecrit.push(tenter(alea(25), () => seaux.saisirVerite({ scanId: sj[k % 3], idProduct: 2002 + k, via: 'idProduct', porteur: PORTEUR })));
    const scj = tenter(alea(25), async () => { for (let t = 0; t < 40; t++) { try { return await seaux.sceller(juge.id); } catch (e) { if (!e || e.detail !== 'ecritures-en-cours') throw e; await dormir(10); } } throw new Error('jamais'); });
    const rr = await Promise.all(reecrit); const sjr = await scj;
    await dormir(50);
    if (sjr.ok) await require('../mesures/ancrer-seau').ecrireAncre({ seauId: juge.id, colFn: n => db.col(n), dossier: ancres });
    const vj = await seaux.verifierChaine(juge.id);
    H.v('3. juge : le scellé réussit pendant 6 réécritures de vérité, et verifier est ok (les vérités scellées sont celles de la base)', [sjr.ok, vj.ok, vj.problemes.map(p => p.cause)], [true, true, []]);
    H.vrai('3. aucune vérité n\'est acceptée après le scellé : celles qui ont été refusées disent juge-scelle', rr.every(x => x.ok || x.code === 'juge-scelle'));
    const vjPlus = await (async () => { await dormir(100); return seaux.verifierChaine(juge.id); })();
    H.v('3. et 100 ms plus tard verifier est toujours ok', vjPlus.ok, true);

    fs.rmSync(ancres, { recursive: true, force: true });
    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
