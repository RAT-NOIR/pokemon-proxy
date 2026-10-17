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
    let corpsChaine = null, tomberSource = false;    // corpsChaine : le corps que la chaîne rend après son remboursement (défaut : un refus délibéré « numero-illisible ») ; tomberSource : une source tombe pendant le scan
    let appelsChaine = 0, motifChaine = null;       // motifChaine : le motif dont la chaîne HÉRITÉE rembourse (elle appelle req.credit.v2.rembourser sans nommer de compteur)
    const depense = D.creer({ cfg });
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { depenseModele: depense, jumeaux: () => ({ conclu: true, ids: [] }),
        gererIdentifier: async (req, res) => {
            appelsChaine++;
            if (tomberSource) await require('../../sources').interrogerSource('catalogue/nom', async () => { throw new Error('source tombée'); });
            if (motifChaine) await req.credit.v2.rembourser(req, motifChaine, {});
            res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'numero-illisible', ...(corpsChaine || {}), scanId: String(req.scanIdImpose) });
        }, gererRetourLive: async (q, s) => s.json({ success: true }) }));
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
    // (4) chaque motif de la chaîne héritée par la ROUTE v2, plafond des constatés épuisé (20 d'une installation... ici un compte gratuit à 50) : une panne de NOTRE côté est rendue, un constat non
    {
        await raw('depense_modele').deleteMany({});                  // la dépense du jour posée plus haut couperait la chaîne : ce bloc juge les MOTIFS, pas la coupure
        const PANNE = ['ia-echec', 'erreur-serveur', 'tcgdex-injoignable', 'panne-SERVEUR'];
        const CONSTAT = ['numero-illisible', 'carte-introuvable', 'aucun-prix', 'aucun-candidat', 'nom-contredit-egalite', 'nom-contredit-sans-repli', 'egalite-parfaite', 'motif-jamais-vu'];
        const sortie = async m => { motifChaine = m; const x = await compteLie(); await pose(`compte:${x.c._id}`, 50); const r = await poster(sv.url, x.jeton); motifChaine = null; if (process.env.DEBUG_FC) console.log('DBG', m, JSON.stringify(r.json.facturation), JSON.stringify(await raw('plafonds').find({ porteur: `compte:${x.c._id}` }).toArray()), JSON.stringify((await raw('mouvements').find({ compteId: x.c._id }).toArray()).map(d => [d.type, d.motif, d.etat, d.cleIdempotence]))); return [r.json.facturation.rembourse, r.json.facturation.raisonNonRembourse]; };
        for (const m of PANNE) H.v(`N1. route v2, motif de la chaîne « ${m} », constatés épuisés : rendu (panne de notre côté)`, await sortie(m), [true, null]);
        for (const m of CONSTAT) H.v(`N2. route v2, motif de la chaîne « ${m} », constatés épuisés : NON rendu (plafond-jour)`, await sortie(m), [false, 'plafond-jour']);
    }
    // (5) TOUR 3 (relecture 2), par la ROUTE v2 : ce que la chaîne dit (motif de remboursement ET corps de refus) et ce que la v2 rend, plafond des constatés épuisé (compte gratuit à 50)
    {
        const cas = async (motif, corps, { source = false } = {}) => {
            motifChaine = motif; corpsChaine = corps; tomberSource = source;
            const x = await compteLie(); await pose(`compte:${x.c._id}`, 50); const r = await poster(sv.url, x.jeton);
            motifChaine = null; corpsChaine = null; tomberSource = false;
            return r;
        };
        const f = r => [r.statut, r.json.facturation.rembourse, r.json.facturation.raisonNonRembourse];
        // (a) photo sans carte : motif neuf, refus délibéré, PLAFONNÉ ; la v2 rend un introuvable « photo-illisible », jamais une panne IA
        const a = await cas('ia-sans-lecture', { natureRefus: 'refus-delibere', motifRefus: 'ia-sans-lecture' });
        H.v('T3a. route v2, photo sans carte (ia-sans-lecture) : 200, introuvable / photo-illisible, NON rendu (plafond-jour) au 51e constat',
            [...f(a), a.json.analyse && a.json.analyse.cartes[0].statut, a.json.analyse && a.json.analyse.cartes[0].raison], [200, false, 'plafond-jour', 'introuvable', 'photo-illisible']);
        // (b) la vraie panne du fournisseur : toujours hors plafond (panne IA remboursée)
        const b = await cas('ia-echec', { natureRefus: 'echec-technique', motifRefus: 'ia-echec' });
        H.v('T3b. route v2, panne du fournisseur (ia-echec) : rendue hors plafond', [b.json.facturation.rembourse, b.json.erreur && b.json.erreur.code], [true, 'IA']);
        // (c) la coupure de dépense en cours de scan : 503 INDISPONIBLE, rendue hors plafond
        const c = await cas('depense-modele-plafond', { natureRefus: 'echec-technique', motifRefus: 'depense-modele-plafond' });
        H.v('T3c. route v2, coupure de dépense en cours de scan (depense-modele-plafond) : 503 INDISPONIBLE rendue hors plafond', [c.statut, c.json.erreur && c.json.erreur.code, c.json.facturation.rembourse], [503, 'INDISPONIBLE', true]);
        // (d) carte-introuvable avec une source tombée : requalifié en panne (503 INDISPONIBLE) ET rendu hors plafond (même prédicat)
        const d = await cas('carte-introuvable', { natureRefus: 'echec-technique', motifRefus: 'carte-introuvable' }, { source: true });
        H.v('T3d. route v2, carte-introuvable avec une source tombée : 503 INDISPONIBLE rendue hors plafond', [d.statut, d.json.erreur && d.json.erreur.code, d.json.facturation.rembourse], [503, 'INDISPONIBLE', true]);
        const d2 = await cas('carte-introuvable', { natureRefus: 'refus-delibere', motifRefus: 'carte-introuvable' });
        H.v('    sans source tombée, carte-introuvable reste un constat plafonné (NON rendu)', f(d2), [200, false, 'plafond-jour']);
        // (e) un panne-XXX inconnu : plafonné
        const e = await cas('panne-XXX', { natureRefus: 'echec-technique', motifRefus: 'erreur-serveur' });
        H.v('T3e. route v2, panne-XXX inconnu : plafonné (NON rendu)', [e.json.facturation.rembourse, e.json.facturation.raisonNonRembourse], [false, 'plafond-jour']);
    }
    await sv.fermer(); await mongoose.disconnect(); await H.arreterBanc(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
