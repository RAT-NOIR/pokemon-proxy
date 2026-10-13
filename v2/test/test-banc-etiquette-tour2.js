'use strict';
// ETIQUETAGE-B, tour de correction 2 — ce que la relecture 2/3 a trouvé :
//   N1 la ligne ne revient JAMAIS à une `rev` plus ancienne, et la marque ne tombe que pour la rev écrite (instantanés PÉRIMÉS joués) ;
//   M2 les filtres des index partiels (égalité exacte avec les requêtes), le sha256 de la copie anonyme, le partage d'une photo quand un administrateur est déchu ;
//   M3 une marque orpheline est retirée ; M4 un administrateur déchu n'a plus de photo de scans non étiquetés ; M6 la durée de la photo se compte depuis le SCAN.
// Base EN MÉMOIRE, stockage MÉMOIRE, aucun réseau, aucun chemin réel.
const H = require('./_harnais');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const { creerBanc } = require('../banc/routes');
const { creerPurge } = require('../banc/purge');
const S = require('../banc/stockage');
const FILTRES = require('../banc/filtres');
const { creerCatalogue } = require('../identifier/catalogue');
const registre = require('../registre');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const oid = () => new mongoose.Types.ObjectId();
const BUCKET = 'bucket-banc-test', SEL = 'sel-tour2', ENV = { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL };
const URL_PHOTO = 'https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg';
const photoJpeg = () => sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 90, g: 10, b: 200 } } }).jpeg().toBuffer();
const lignes = () => db.col('banc_lignes').find({}).toArray();
const lire = async id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });
const attendre = ms => new Promise(r => setTimeout(r, ms));
const JOUR = 86400e3;

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) await attendre(reste + 2000); }
    await H.ouvrirBac('test-banc-etiquette-tour2.js'); await M.creerIndex();
    const reel = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const catalogue = { lire: async ids => reel.lire(ids) };
    for (const [id, nom] of [[4242, 'Pikachu'], [4343, 'Raichu']]) {
        await db.col('catalogue_produits').insertOne({ idProduct: id, name: nom, idMetacard: id });
        await db.col('numeros_cartes').insertOne({ idProduct: id, slugSet: 'Base-Set', numero: String(id % 100) });
    }
    const mem = S.creerStockageMemoire();
    const stockage = { verifierBucket: async () => { }, ecrire: (c, b) => mem.ecrire(c, b), supprimer: c => mem.supprimer(c), lire: c => mem.lire(c), lister: () => mem.lister() };
    // le banc lit ses collections par un enrobage qui peut SERVIR UN INSTANTANÉ PÉRIMÉ (findOne) : la course « une autre écriture est passée entre ma lecture et mon écriture », jouée sans concurrence réelle
    const perime = { analyses: null, lignes: null };
    const colFn = n => {
        const vrai = db.col(n);
        return new Proxy(vrai, { get(c, p) {
            const v = c[p];
            if (typeof v !== 'function') return v;
            if (p === 'findOne' && n === 'analyses' && perime.analyses) return async () => perime.analyses;
            if (p === 'findOne' && n === 'banc_lignes' && perime.lignes) return async () => perime.lignes;
            return v.bind(c);
        } });
    };
    const banc = creerBanc({ cfg, env: ENV, stockage, colFn });
    registre.fournir('banc', banc);
    const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
    const app = express(); app.use(express.json());
    const router = express.Router(); monterBanc.routes(router, cfg, { banc, purge: purgeStub, catalogue }); app.use(router);
    const srv = await H.serveur(app);

    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = 'administrateur' } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compteId: c._id, generation: 0 });
        return { c, jeton, porteur: `compte:${c._id}`, obj: { type: 'compte', id: c._id, administrateur: Boolean(role), surface: 'extension' } };
    }
    const CARTE = () => ({ idProduct: 4242, statut: 'identifiee', raison: null, etat: { retenu: 'NM' }, question: null, zone: null });
    const semer = async (a, o = {}) => { const _id = oid(); await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: 'identifiee', cartes: o.cartes || [CARTE()], produits: [], facturation: { motif: 'administrateur' }, versionChaine: 'abc123def456', versionModele: 'gemini-x', creeLe: o.creeLe || new Date(), expireLe: new Date(Date.now() + 864e5), ...(o.plus || {}) }); return String(_id); };
    let nIp = 0; const ip = () => ({ 'x-forwarded-for': `10.16.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}` });
    const post = (a, corps) => H.appel(srv.url, '/api/banc/etiquette', { methode: 'POST', corps, entetes: { authorization: `Bearer ${a.jeton}`, ...ip() } });
    const CP = require('../banc/photo-admin');
    const scanner = (a, scanId) => CP.apresIdentifierAdmin({ cfg, deps: { telechargerPhoto: async () => photoJpeg() }, req: { entree: { imageUrls: [URL_PHOTO] }, body: {} }, scanId, porteur: a.obj });
    const ligneDe = async id => { const cle = (await lire(id)).photoBanc.cle; return (await lignes()).find(l => l.cleR2 === cle); };

    // ═══ N1. la ligne ne revient jamais à une rev plus ancienne ; la marque ne tombe que pour la rev écrite ═══
    {
        const A = await acteur(); const S1 = await semer(A); await scanner(A, S1);
        await post(A, { scanId: S1, verdict: 'juste', rev: 1 });
        await post(A, { scanId: S1, verdict: 'corrige', idProduct: 4343, rev: 2 });
        const instantane2 = JSON.parse(JSON.stringify(await lire(S1)), (k, v) => (k === '_id' ? v : v));       // l'analyse telle qu'elle était à la rev 2
        instantane2._id = new mongoose.Types.ObjectId(S1);
        await post(A, { scanId: S1, verdict: 'corrige', idProduct: 4242, rev: 3 });
        let l = await ligneDe(S1);
        H.v('N1. témoin : rev 1, 2, 3 posées, la ligne est à la rev 3 (vérité 4242)', [l.rev, l.verite], [3, 4242]);
        // a) un instantané PÉRIMÉ (rev 2) servi au banc alors que ligne et étiquette sont à la rev 3 : la ligne ne redescend pas
        perime.analyses = instantane2;
        const r = await banc.etiquetteAdmin({ scanId: S1, carte: 0 });
        perime.analyses = null;
        l = await ligneDe(S1);
        H.v('N1a. instantané rev 2 contre une ligne rev 3 : la ligne reste rev 3 / vérité 4242 (jamais de retour en arrière)', [r, l.rev, l.verite], ['ecrit', 3, 4242]);
        // b) la carte (rev 3) n'est pas encore marquée : un marquage de la rev 2 ne la marque PAS, la marque d'analyse reste
        await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(S1) }, { $unset: { 'cartes.0.etiquetteAdmin.banc': '' }, $set: { bancAttente: true } });
        perime.analyses = instantane2;
        await banc.etiquetteAdmin({ scanId: S1, carte: 0 });
        perime.analyses = null;
        const an = await lire(S1);
        H.v('N1b. marquer pour la rev 2 ne marque pas la carte rev 3 (elle reste en attente, la marque d\'analyse reste)', [an.cartes[0].etiquetteAdmin.rev, an.cartes[0].etiquetteAdmin.banc, an.bancAttente], [3, undefined, true]);
        // c) la LIGNE lue est périmée (rev 2) alors qu'une autre écriture l'a portée à la rev 4 : la mise à jour est conditionnée à la rev lue, elle ne passe pas
        await db.col('banc_lignes').updateOne({ _id: l._id }, { $set: { rev: 4, verite: 4343 } });
        perime.lignes = { ...l, rev: 2, verite: 4343 };
        await banc.etiquetteAdmin({ scanId: S1, carte: 0 });
        perime.lignes = null;
        l = await ligneDe(S1);
        H.v('N1c. ligne lue périmée (rev 2) alors qu\'elle est à la rev 4 : la mise à jour conditionnée à la rev lue n\'écrase rien (rev 4 / vérité 4343)', [l.rev, l.verite], [4, 4343]);
    }

    // ═══ M2a. les filtres des index partiels sont EXACTEMENT ceux des requêtes (et les requêtes les utilisent) ═══
    {
        const idx = await db.col('analyses').indexes();
        const filtreDe = nom => (idx.find(i => i.name === nom) || {}).partialFilterExpression;
        H.v('M2a. les filtres partiels déclarés = ceux des requêtes de la reprise et du filet', [JSON.stringify(filtreDe('analyses_banc_attente')), JSON.stringify(filtreDe('analyses_photo_banc'))], [JSON.stringify(FILTRES.attente), JSON.stringify(FILTRES.photo)]);
        const plan = async (filtre, tri) => { let c = db.col('analyses').find(filtre); if (tri) c = c.sort(tri); return JSON.stringify(await c.explain('queryPlanner')); };
        const p1 = await plan(FILTRES.attente, { bancEssaiLe: 1, creeLe: 1 }), p2 = await plan(FILTRES.photo);
        H.v('M2a. la requête de la reprise parcourt l\'index partiel (aucun parcours complet) ; celle du filet aussi', [p1.includes('IXSCAN') && p1.includes('analyses_banc_attente') && !p1.includes('COLLSCAN'), p2.includes('IXSCAN') && p2.includes('analyses_photo_banc') && !p2.includes('COLLSCAN')], [true, true]);
    }

    // ═══ M2b. le sha256 de la copie anonyme ═══
    {
        const A = await acteur(); const S1 = await semer(A); await scanner(A, S1);
        await post(A, { scanId: S1, verdict: 'juste', rev: 1 });
        const l = await ligneDe(S1);
        const T = new Date(); const vieux = new Date(T.getTime() - 14 * 31 * JOUR);
        await db.col('banc_lignes').updateOne({ _id: l._id }, { $set: { le: new Date(Date.UTC(vieux.getUTCFullYear(), vieux.getUTCMonth(), vieux.getUTCDate())) } });
        await creerPurge({ cfg, env: ENV, stockage, horloge: () => T }).anonymiserLiens(T);
        const copie = (await lignes()).find(x => x.anonyme === true && x.source === 'etiquette-admin' && x.verite === 4242 && x.sha256 === l.sha256);
        H.v('M2b. la copie anonyme garde le sha256 de la photo', [Boolean(l.sha256), Boolean(copie)], [true, true]);
        // M6 : la durée de la copie est celle de la ligne (comptée depuis le SCAN), pas recalculée depuis l'étiquetage
        H.v('M6. la copie anonyme garde l\'échéance de la ligne', copie && copie.expireLe.getTime(), l.expireLe.getTime());
    }

    // ═══ M2c. un administrateur déchu : la photo partagée avec une ligne ÉCRITE reste ═══
    {
        const B = await acteur();
        const S1 = await semer(B, { cartes: [CARTE(), CARTE()] }); await scanner(B, S1);
        const cle = (await lire(S1)).photoBanc.cle;
        await post(B, { scanId: S1, carte: 0, verdict: 'juste', rev: 1 });
        // la carte 1 est étiquetée pendant une panne du banc (en attente), puis le rôle est retiré
        await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(S1) }, { $set: { 'cartes.1.etiquetteAdmin': { verdict: 'juste', idProduct: 4242, rev: 1, le: new Date(), versionModele: 'gemini-x', versionChaine: 'abc123def456' }, bancAttente: true } });
        await db.col('comptes').updateOne({ _id: B.c._id }, { $unset: { role: '' } });
        await banc.reprendreEtiquettes();
        const an = await lire(S1);
        H.v('M2c. déchu : la carte en attente sort avec `role-retire`, la photo quitte l\'analyse MAIS reste au bucket (la ligne de la carte 0 la porte)', [an.cartes[1].etiquetteAdmin.banc, an.photoBanc, mem.cles().includes(cle), (await lignes()).filter(x => x.cleR2 === cle).length], ['role-retire', undefined, true, 1]);
    }

    // ═══ M3. une marque orpheline est retirée par la reprise ═══
    {
        const A = await acteur(); const S1 = await semer(A); await scanner(A, S1);
        await post(A, { scanId: S1, verdict: 'juste', rev: 1 });
        await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(S1) }, { $set: { bancAttente: true } });       // le $unset d'une marque a été avalé
        const S2 = await semer(A, { cartes: [{ ...CARTE() }], plus: { bancAttente: true } });                                     // une marque sans aucune étiquette derrière
        const b = await banc.reprendreEtiquettes();
        H.v('M3. les marques orphelines (carte `ecrit`, ou aucune étiquette) sont retirées ; l\'export n\'a plus d\'avertissement permanent', [(await lire(S1)).bancAttente, (await lire(S2)).bancAttente, b.orphelines], [undefined, undefined, 2]);
    }

    // ═══ M4. un administrateur DÉCHU : la passe supprime la photo de ses scans non étiquetés ═══
    {
        const D = await acteur(); const S1 = await semer(D); await scanner(D, S1);
        const cle = (await lire(S1)).photoBanc.cle;
        const E = await acteur(); const S2 = await semer(E); await scanner(E, S2);
        const cle2 = (await lire(S2)).photoBanc.cle;
        await db.col('comptes').updateOne({ _id: D.c._id }, { $unset: { role: '' } });
        const b = await banc.reprendreEtiquettes();
        H.v('M4. déchu : la photo de son scan non étiqueté quitte l\'analyse et le bucket ; celle d\'un administrateur en exercice reste', [(await lire(S1)).photoBanc, mem.cles().includes(cle), (await lire(S2)).photoBanc && mem.cles().includes(cle2), b.deches >= 1], [undefined, false, true, true]);
    }

    // ═══ M6 / N1 (tour 3). la durée se compte depuis le SCAN, et l'échéance est le PREMIER JOUR du mois du scan + bancMois mois CIVILS (BANC-12 I-5), jamais « jour + 732 jours » ═══
    {
        const A = await acteur(); const creeLe = new Date(Date.UTC(2026, 8, 3, 10, 30));          // un scan du 3 septembre 2026
        const S1 = await semer(A, { creeLe }); await scanner(A, S1);
        await post(A, { scanId: S1, verdict: 'juste', rev: 1 });
        const l = await ligneDe(S1);
        const attendu = Date.UTC(2026, 8 + cfg.retention.bancMois, 1);                              // le 1er septembre 2028 pour 24 mois
        H.v('N1. `expireLe` d\'une ligne = le 1er du mois du SCAN + bancMois mois civils (2028-09-01), pas le jour du scan + 732 jours (2028-09-04)', [l.expireLe.getTime() === attendu, l.expireLe.toISOString().slice(0, 10), l.le.getTime() > Date.UTC(2026, 8, 3)], [true, '2028-09-01', true]);
        // la copie anonyme garde cette échéance : le 1er d'un mois, jamais au-delà de bancMois mois civils après le mois du scan
        const T = new Date(); const vieux = new Date(T.getTime() - 14 * 31 * JOUR);
        await db.col('banc_lignes').updateOne({ _id: l._id }, { $set: { le: new Date(Date.UTC(vieux.getUTCFullYear(), vieux.getUTCMonth(), vieux.getUTCDate())) } });
        const avant = new Set((await lignes()).filter(x => x.anonyme === true).map(x => String(x._id)));
        await creerPurge({ cfg, env: ENV, stockage, horloge: () => T }).anonymiserLiens(T);
        const copie = (await lignes()).find(x => x.anonyme === true && x.source === 'etiquette-admin' && !avant.has(String(x._id)));
        H.v('N1. la copie anonyme porte la même échéance : le 1er du mois, au plus bancMois mois civils après le mois du scan', [Boolean(copie), copie && copie.expireLe.getUTCDate(), copie && copie.expireLe.getTime() <= attendu], [true, 1, true]);
    }

    await srv.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
