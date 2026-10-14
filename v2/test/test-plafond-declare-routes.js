'use strict';
// PLAFOND-DECLARE tour 1 (M1) : le chemin RÉEL de /api/retour-live (prix illisible déclaré) doit compter au compteur commun des déclarations, plafonné par offre, et dire `declaration`.
// Une mutation qui passerait ce chemin en « constaté » doit être tuée par CE banc (et non par un banc voisin). Base EN MÉMOIRE, aucun réseau.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const Q = require('./_aide-quota');
const BASE = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_GRATUIT: String(Q.GRAND), V2_QUOTA_SANS_COMPTE: String(Q.GRAND), V2_QUOTA_PRO_PLAFOND: String(Q.GRAND) };
const cfg = lireConfig(BASE); const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.13.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-pdr-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const EXP = 990004, P = 921001;
const carteCorps = id => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false });
const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
const REV = { attendue: false, motif: null, etat: 'aucun-motif', strategie: null };
const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Plaf', prix: 1, photoUrl: null });
const aff = id => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(id), etat: ETAT, candidats: [cand(id)], classement: [], guidePrix: {}, reverse: REV, codeLangue: 2 } });
async function compteLie(role, abonnement) {
    const c = Object.assign(M.nouveauCompte({ email: `pdr${++nCle}@x.fr`, emailCle: `pdr${nCle}@x.fr`, motDePasse: {} }), { verifie: true, solde: { accueil: 0, achete: 30 } }, role ? { role } : {}, abonnement ? { abonnement } : {});
    await db.col('comptes').insertOne(c);
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'banc' }), { compteId: c._id });
    await db.col('installations').insertOne(i); return { c, i, jeton };
}
const entetes = jeton => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}` });
const poster = (url, jeton) => H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { ...entetes(jeton), 'idempotency-key': cle() } });
const retour = (url, jeton, b) => H.appel(url, '/api/retour-live', { methode: 'POST', corps: b, entetes: entetes(jeton) });
const LR = scanId => ({ scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } });
const compteur = async (cle_, type) => { const d = await raw('plafonds').findOne({ porteur: cle_, jour: Q.jourCourant(), type }); return d ? d.count : 0; };

(async () => {
    await H.ouvrirBancV2(); await H.eviterFrontieres({ jour: true }); await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-plafond-declare-routes.js', ecrit: true });
    db.brancher(mongoose.connection.db); await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await raw('catalogue_produits').insertOne({ idProduct: P, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990400 });
    await raw('numeros_cartes').insertOne({ idProduct: P, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Plaf', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: P, avg: 20, low: 10, trend: 20, avg1: 20, avg7: 20, avg30: 20, guideDu: new Date('2026-10-04') });
    await raw('visuels').insertOne({ idProduct: P, vignette: { cle: `banc/${P}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990400, numero: '001', rarete: 'Common', total: '064', variante: 'normale', setNom: 'Banc Plaf', lien: null });
    const express = require('express'); const pret = require('../pret'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: async (req, res) => res.json({ ...aff(P).corps, scanId: String(req.scanIdImpose) }), gererRetourLive: async (q, s) => s.json({ success: true }) }));
    const sv = await H.serveur(app);
    const scanIdentifie = async (x) => {
        const r = await poster(sv.url, x.jeton); if (r.statut !== 200) throw new Error(`scan refusé ${r.statut}`);
        await raw('journal_scans').insertOne({ _id: new mongoose.Types.ObjectId(r.json.scanId), userId: `v2:compte:${x.c._id}` }); return r.json.scanId;
    };
    // gratuit : 3 rendus puis le 4e refusé, par le chemin RÉEL de retour-live
    {
        const x = await compteLie(); const pk = `compte:${x.c._id}`; const ids = []; for (let k = 0; k < 4; k++) ids.push(await scanIdentifie(x));
        const out = []; for (const id of ids) out.push(await retour(sv.url, x.jeton, LR(id)));
        H.v('R1. retour-live, compte gratuit : 3 rendus puis plafond-jour', out.map(r => (r.json.facturation.rembourse ? 'rendu' : r.json.facturation.raisonNonRembourse)), ['rendu', 'rendu', 'rendu', 'plafond-jour']);
        H.v('    compteur commun « declare » = 3 ; aucun compteur constaté ni ancien compteur ; declaration dit le plafond (3) et le refus du 4e',
            [await compteur(pk, 'declare'), await compteur(pk, 'sans-prix') + await compteur(pk, 'panne') + await compteur(pk, 'question'), out[0].json.declaration, out[3].json.declaration],
            [3, 0, { rendue: true, raison: null, plafondJour: 3 }, { rendue: false, raison: 'plafond-declarations', plafondJour: 3 }]);
        // et les déclarations d'un autre chemin (question abandonnée) partagent CE compteur : il est plein
        const q = await require('../argent/questions').repondreQuestion({ type: 'compte', id: x.c._id }, { scanId: 'inconnu', carte: 0, choix: 'aucune' }, cfg, new Date());
        H.v('    (le chemin question voit le même compteur : une question inconnue ne le consomme pas)', [q.statut, await compteur(pk, 'declare')], [404, 3]);
    }
    // Pro : 30
    {
        const x = await compteLie(null, { actif: true, quotaMensuel: 100, moisCle: '2026-10', restant: 100, jusquAu: new Date(Date.now() + 90 * 86400e3) }); const pk = `compte:${x.c._id}`;
        await raw('plafonds').insertOne({ porteur: pk, jour: Q.jourCourant(), type: 'declare', count: 30, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const id = await scanIdentifie(x); const r = await retour(sv.url, x.jeton, LR(id));
        H.v('R2. retour-live, Pro au plafond de 30 : refusé, declaration plafondJour 30', [r.json.facturation.rembourse, r.json.declaration], [false, { rendue: false, raison: 'plafond-declarations', plafondJour: 30 }]);
    }
    // validité OpenAPI de la réponse refusée
    {
        const x = await compteLie(); await raw('plafonds').insertOne({ porteur: `compte:${x.c._id}`, jour: Q.jourCourant(), type: 'declare', count: 3, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const id = await scanIdentifie(x); const r = await retour(sv.url, x.jeton, LR(id));
        const v = require('../openapi/valider').valider(r.json, { $ref: '#/components/schemas/ReponseRetourLive' }, require('../openapi/openapi.v2.json'));
        H.vrai(`R3. la réponse refusée valide contre ReponseRetourLive (${v.ok ? 'ok' : v.erreurs.slice(0, 3).map(e => e.chemin + ' ' + e.message).join(' ; ')})`, v.ok);
    }
    await sv.fermer(); await mongoose.disconnect(); await H.arreterBanc(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
