'use strict';
// LOT IDEMPOTENCE-INSTALLATION, A3 — « un rejeu de la même Idempotency-Key ne compte jamais deux fois une analyse », joué sur POST /api/identifier avec le quota du jour (OFFRE-QUOTA).
// La règle à garantir : pour UNE clé, le client ne perd jamais plus d'UNE unité ; une unité prise pour une analyse jamais rendue est rendue (cas CONSTATÉ par le serveur).
// Trois cas de la demande de l'extension (A3) : PENDANT la première requête · APRÈS un succès · APRÈS une erreur qui a compté. Base EN MÉMOIRE, aucun réseau, chaîne héritée FABRIQUÉE.
const H = require('./_harnais');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const Q = require('./_aide-quota');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const ORIGINE = cfg.origines.extension;
const IMAGE = 'https://images1.vinted.net/t/00_rm-a3/f800/photo.webp';
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.13.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-a3-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const EXP = 990013, ID = 930001;

const carteCorps = id => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false });
const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
const REV = { attendue: false, motif: null, etat: 'aucun-motif', strategie: null };
const affirmee = (id, scanId) => ({ success: true, question: null, carte: carteCorps(id), etat: ETAT, candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc A3', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: REV, codeLangue: 2, scanId: String(scanId) });

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const corps = () => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
const poster = (url, jeton, k) => H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': k } });
const rejoue = r => r.entetes['idempotency-replayed'] === 'true';
const restant = x => Q.restantDe({ type: 'installation', id: x.i._id }, cfg);
const debits = x => raw('mouvements').countDocuments({ installationId: x.i._id, type: 'debit' });
const rendus = x => raw('mouvements').countDocuments({ installationId: x.i._id, type: 'remboursement', delta: 1 });

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true }); await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-idempotence-analyse.js', ecrit: true });
    db.brancher(mongoose.connection.db); await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await raw('catalogue_produits').insertOne({ idProduct: ID, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990400 });
    await raw('numeros_cartes').insertOne({ idProduct: ID, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-A3', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: ID, avg: 1, low: 0.5, trend: 1, avg1: 1, avg7: 1, avg30: 1, guideDu: new Date('2026-10-04') });
    await raw('visuels').insertOne({ idProduct: ID, vignette: { cle: `banc/${ID}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990400, numero: '001', rarete: 'Common', total: '064', variante: 'normale', setNom: 'Banc A3', lien: null });

    const pret = require('../pret'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index'); const { creerCatalogue } = require('../identifier/catalogue');
    let mode = 'ok', porte = null, appelsChaine = 0, catalogueEnPanne = false;
    const reel = creerCatalogue({ cfg });
    const catalogue = { lire: async (...a) => { if (catalogueEnPanne) throw new Error('mongo muet'); return reel.lire(...a); } };
    const chaine = async (req, res) => {
        appelsChaine++;
        if (porte) await porte;
        if (mode === 'exception') throw new Error('boum');
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        return res.json(affirmee(ID, req.scanIdImpose));
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, catalogue }));
    const srv = await H.serveur(app);
    const reset = () => { mode = 'ok'; porte = null; appelsChaine = 0; catalogueEnPanne = false; };

    // ── CAS 1 : PENDANT la première requête → 429 DEBIT reessayerDans 2, une seule unité prise, la première finit normalement
    {
        reset(); const x = await inst(); const k = cle(); let ouvrir; porte = new Promise(r => { ouvrir = r; });
        const premiere = poster(srv.url, x.jeton, k);
        for (let i = 0; i < 50 && !appelsChaine; i++) await attendre(100);
        const pendant = await poster(srv.url, x.jeton, k);
        H.v('A3-1. rejeu PENDANT la première requête : 429 DEBIT reessayerDans 2, Retry-After 2', [pendant.statut, pendant.json.erreur.code, pendant.json.erreur.reessayerDans, pendant.entetes['retry-after']], [429, 'DEBIT', 2, '2']);
        H.v('      la chaîne n\'a tourné qu\'une fois, une seule unité prise (restant 3 -> 2), un seul débit', [appelsChaine, await restant(x), await debits(x)], [1, 2, 1]);
        ouvrir(); const fin = await premiere;
        H.v('      la première se termine : 200, analyse identifiée', [fin.statut, fin.json.success], [200, true]);
        const apres = await poster(srv.url, x.jeton, k);
        H.v('      un rejeu APRÈS sa fin rend la même réponse (Idempotency-Replayed), sans rien prendre', [apres.statut, rejoue(apres), apres.texte === fin.texte, await restant(x), await debits(x), appelsChaine], [200, true, true, 2, 1, 1]);
    }

    // ── CAS 2 : APRÈS un succès → la même réponse, quota inchangé
    {
        reset(); const x = await inst(); const k = cle();
        const a = await poster(srv.url, x.jeton, k), avant = await restant(x);
        const b = await poster(srv.url, x.jeton, k), c = await poster(srv.url, x.jeton, k);
        H.v('A3-2. rejeu APRÈS un succès : même réponse octet pour octet, marquée rejouée (2 rejeux)', [a.statut, b.statut, c.statut, rejoue(a), rejoue(b), rejoue(c), b.texte === a.texte, c.texte === a.texte], [200, 200, 200, false, true, true, true, true]);
        H.v('      quota inchangé (restant 2 avant et après), un seul débit, la chaîne n\'a tourné qu\'une fois', [avant, await restant(x), await debits(x), appelsChaine], [2, 2, 1, 1]);
    }

    // ── CAS 3 : APRÈS une erreur qui a COMPTÉ (le débit est pris, puis la requête échoue)
    {
        // 3a. exception de la chaîne : 500 SERVEUR, l'unité est RENDUE par le serveur ; le rejeu (la chaîne va mieux) s'exécute pour de bon : au total UNE unité
        reset(); mode = 'exception'; const x = await inst(); const k = cle();
        const e = await poster(srv.url, x.jeton, k);
        H.v('A3-3a. exception de la chaîne : 500 SERVEUR, facturation { debite 0, rembourse true }, quota revenu à 3', [e.statut, e.json.erreur.code, e.json.facturation.debite, e.json.facturation.rembourse, await restant(x), await rendus(x)], [500, 'SERVEUR', 0, true, 3, 1]);
        H.v('      le claim d\'idempotence n\'a rien conservé (une panne n\'est jamais rejouée figée)', await raw('idempotence').countDocuments({ cle: { $regex: String(x.i._id) } }), 0);
        mode = 'ok';
        const r = await poster(srv.url, x.jeton, k);
        H.v('      le rejeu de la même clé s\'exécute pour de bon : 200, pas marqué rejoué, UNE unité prise en tout (restant 2)', [r.statut, rejoue(r), r.json.success, await restant(x)], [200, false, true, 2]);
        const r2 = await poster(srv.url, x.jeton, k);
        H.v('      un second rejeu rend cette réponse-là : quota inchangé (restant 2), 2 débits au grand livre dont 1 rendu', [r2.statut, rejoue(r2), r2.texte === r.texte, await restant(x), await debits(x), await rendus(x)], [200, true, true, 2, 2, 1]);
    }
    {
        // 3b. la chaîne échoue DEUX fois de suite avec la même clé : l'unité est rendue à chaque fois, le client ne perd jamais rien
        reset(); mode = 'exception'; const x = await inst(); const k = cle();
        const e1 = await poster(srv.url, x.jeton, k), e2 = await poster(srv.url, x.jeton, k);
        H.v('A3-3b. deux exceptions de suite, même clé : 500 puis 500, chaque fois rendue — quota 3, 2 débits, 2 rendus', [e1.statut, e2.statut, e1.json.facturation.rembourse, e2.json.facturation.rembourse, await restant(x), await debits(x), await rendus(x)], [500, 500, true, true, 3, 2, 2]);
    }
    {
        // 3c. panne du CATALOGUE : 503 INDISPONIBLE, rendue ; le rejeu après rétablissement réussit : UNE unité en tout
        reset(); catalogueEnPanne = true; const x = await inst(); const k = cle();
        const p = await poster(srv.url, x.jeton, k);
        H.v('A3-3c. panne du catalogue : 503 INDISPONIBLE, rendue (restant 3)', [p.statut, p.json.erreur.code, p.json.facturation.rembourse, await restant(x)], [503, 'INDISPONIBLE', true, 3]);
        catalogueEnPanne = false;
        const r = await poster(srv.url, x.jeton, k);
        H.v('      le rejeu, catalogue rétabli : 200, UNE unité en tout (restant 2)', [r.statut, rejoue(r), await restant(x)], [200, false, 2]);
    }
    {
        // 3d. un « introuvable » REMBOURSÉ par la chaîne est une réponse 200 : le rejeu la rend telle quelle, sans rien reprendre
        reset(); mode = 'introuvable'; const x = await inst(); const k = cle();
        const a = await poster(srv.url, x.jeton, k), b = await poster(srv.url, x.jeton, k);
        H.v('A3-3d. introuvable remboursé (200) : le rejeu rend la même réponse, quota 3 avant et après, la chaîne n\'a tourné qu\'une fois', [a.statut, a.json.facturation.rembourse, rejoue(b), b.texte === a.texte, await restant(x), appelsChaine], [200, true, true, true, 3, 1]);
    }
    {
        // 3e. l'erreur a compté et l'unité N'A PAS PU être rendue (plafond de remboursements du jour atteint) : le client a perdu UNE unité, jamais deux — le rejeu ne reprend rien
        reset(); mode = 'exception'; const x = await inst(); const k = cle();
        await raw('plafonds').insertOne({ porteur: `installation:${x.i._id}`, jour: Q.jourCourant(), type: 'panne', count: cfg.plafonds.panne, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const e = await poster(srv.url, x.jeton, k);
        H.v('A3-3e. exception, remboursement REFUSÉ (plafond du jour) : 500, facturation { debite 1, rembourse false, plafond-jour }, quota 2', [e.statut, e.json.facturation.debite, e.json.facturation.rembourse, e.json.facturation.raisonNonRembourse, await restant(x)], [500, 1, false, 'plafond-jour', 2]);
        mode = 'ok';
        const r = await poster(srv.url, x.jeton, k);
        H.v('      le rejeu de la même clé : 429 DEBIT reessayerDans 2 (l\'unité de cette clé est déjà prise), la chaîne n\'est PAS rappelée, rien de plus n\'est pris', [r.statut, r.json.erreur.code, r.json.erreur.reessayerDans, appelsChaine, await restant(x), await debits(x)], [429, 'DEBIT', 2, 1, 2, 1]);
        const neuve = await poster(srv.url, x.jeton, cle());
        H.v('      une CLÉ NEUVE est une analyse neuve : elle prend sa propre unité (restant 1)', [neuve.statut, await restant(x)], [200, 1]);
    }

    await srv.fermer(); await mongoose.disconnect(); await H.arreterBanc(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
