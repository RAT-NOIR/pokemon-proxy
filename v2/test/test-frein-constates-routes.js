'use strict';
// FREIN-CONSTATES — les chemins RÉELS de POST /api/identifier : (1) un « introuvable » constaté par le serveur n'est plus rendu au-delà du plafond de l'offre (gratuit 50) ; (2) le plafond GLOBAL de
// dépense du modèle atteint : la chaîne (le faux fournisseur) ne reçoit AUCUN appel, le scan rend INDISPONIBLE (503) remboursé, hors plafond. Base EN MÉMOIRE, aucun réseau.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const Q = require('./_aide-quota');
const BASE = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_GRATUIT: String(Q.GRAND), V2_QUOTA_SANS_COMPTE: String(Q.GRAND), V2_QUOTA_PRO_PLAFOND: String(Q.GRAND), V2_DEPENSE_MODELE_JOUR_USD: '0.01', V2_COUT_APPEL_ESTIME_USD: '0.004' };
const cfg = lireConfig(BASE); const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.14.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-fc-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
async function compteLie() {
    const c = Object.assign(M.nouveauCompte({ email: `fc${++nCle}@x.fr`, emailCle: `fc${nCle}@x.fr`, motDePasse: {} }), { verifie: true, solde: { accueil: 0, achete: 30 } });
    await db.col('comptes').insertOne(c);
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'banc' }), { compteId: c._id });
    await db.col('installations').insertOne(i); return { c, i, jeton };
}
const entetes = jeton => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}` });
const poster = (url, jeton) => H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { ...entetes(jeton), 'idempotency-key': cle() } });

(async () => {
    await H.ouvrirBancV2(); await H.eviterFrontieres({ jour: true }); await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-frein-constates-routes.js', ecrit: true });
    db.brancher(mongoose.connection.db); await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels', 'depense_modele', 'alertes']) await raw(c).deleteMany({});
    const express = require('express'); const pret = require('../pret'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index'); const D = require('../argent/depense-modele');
    let appelsChaine = 0;
    const depense = D.creer({ cfg });
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { depenseModele: depense, jumeaux: () => ({ conclu: true, ids: [] }),
        gererIdentifier: async (req, res) => { appelsChaine++; res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'numero-illisible', scanId: String(req.scanIdImpose) }); }, gererRetourLive: async (q, s) => s.json({ success: true }) }));
    const sv = await H.serveur(app);
    const jour = Q.jourCourant();
    const pose = (porteur, n) => raw('plafonds').updateOne({ porteur, jour, type: 'constate' }, { $set: { count: n }, $setOnInsert: { expireLe: new Date(Date.now() + 3 * 86400e3) } }, { upsert: true });
    const fact = r => [r.statut, r.json.facturation.rembourse, r.json.facturation.motif, r.json.facturation.raisonNonRembourse];

    // (1) un introuvable constaté : le 50e d'un gratuit est rendu, le 51e non
    {
        const x = await compteLie(); const pk = `compte:${x.c._id}`;
        await pose(pk, 49);
        const a = await poster(sv.url, x.jeton);
        H.v('Q1. gratuit, 49 constatés déjà comptés : le 50e introuvable est rendu', [a.statut, a.json.facturation.rembourse, a.json.facturation.motif], [200, true, 'introuvable']);
        const b = await poster(sv.url, x.jeton);
        H.v('Q2. le 51e : PAS rendu, motif plafond-jour, la lecture est facturée (debite 1)', [b.statut, b.json.facturation.rembourse, b.json.facturation.motif, b.json.facturation.raisonNonRembourse, b.json.facturation.debite], [200, false, 'plafond-jour', 'plafond-jour', 1]);
    }
    // (2) la dépense du modèle atteinte : la chaîne ne reçoit rien, 503 INDISPONIBLE remboursé HORS plafond
    {
        const x = await compteLie(); const pk = `compte:${x.c._id}`;
        await pose(pk, 50);                                           // les constatés de CE porteur sont épuisés : l'indisponibilité est rendue quand même
        await raw('depense_modele').updateOne({ _id: `jour:${jour}` }, { $set: { microUsd: 10000, appels: 3 } }, { upsert: true });
        const avant = appelsChaine;
        const r = await poster(sv.url, x.jeton);
        H.v('Q3. dépense du jour atteinte : 503 INDISPONIBLE, la crédit est rendu (rembourse true), AUCUN appel à la chaîne', [r.statut, r.json.erreur && r.json.erreur.code, r.json.facturation.rembourse, appelsChaine - avant], [503, 'INDISPONIBLE', true, 0]);
        H.v('    le compteur « constate » du porteur n\'a pas bougé (50)', (await raw('plafonds').findOne({ porteur: pk, jour, type: 'constate' })).count, 50);
        const rest = await Q.restantDe({ type: 'compte', id: x.c._id }, cfg);
        H.v('    le quota du jour est intact (crédit rendu)', rest, Q.GRAND);
        // dès que la dépense baisse sous le plafond (nouveau jour : ici on rouvre), la chaîne reprend
        await raw('depense_modele').deleteMany({});
        const ok = await poster(sv.url, x.jeton);
        H.v('Q4. dépense remise sous le plafond (autre jour) : la chaîne est appelée de nouveau', [appelsChaine - avant, ok.statut], [1, 200]);
    }
    // (3) un administrateur est sous le plafond global aussi (il ne paie rien, mais le modèle coûte) : INDISPONIBLE, aucun appel
    {
        const x = await compteLie(); await raw('comptes').updateOne({ _id: x.c._id }, { $set: { role: 'administrateur' } });
        await raw('depense_modele').updateOne({ _id: `jour:${jour}` }, { $set: { microUsd: 10000, appels: 3 } }, { upsert: true });
        const avant = appelsChaine; const r = await poster(sv.url, x.jeton);
        H.v('Q5. administrateur, dépense atteinte : 503 INDISPONIBLE, motif administrateur (aucun crédit), aucun appel à la chaîne', [r.statut, r.json.facturation && r.json.facturation.motif, appelsChaine - avant], [503, 'administrateur', 0]);
    }
    await sv.fermer(); await mongoose.disconnect(); await H.arreterBanc(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
