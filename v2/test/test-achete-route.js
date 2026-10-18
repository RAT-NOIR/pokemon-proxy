'use strict';
// ACHETE-AVANT-JOUR, côté ROUTE — `facturation.poche` ("achete" | "jour") sur la réponse de POST /api/identifier qui débite, et le débit réel de bout en bout (route -> grand livre -> solde servi).
// En PROCESSUS (aucun serveur enfant, aucun faux réseau, aucune photo : la chaîne héritée est fabriquée) — ce banc tourne dans un worktree, à la différence de test-contrat-reel.js.
// Base : la base EN MÉMOIRE du banc. Aucun réseau.
const H = require('./_harnais'); const express = require('express'); const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota'); const VB = require('./_visuels-banc');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_LOT_CARTES_MAX: '100' });
const ORIGINE = cfg.origines.extension;
const raw = n => mongoose.connection.db.collection(n);
let nIp = 0, nCle = 0;
const ip = () => { nIp++; return { 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
const ID_A = 895789, ID_B = 895790, EXP = 990001;
const IMAGE = require('../../verrou/charges.json').charges.find(c => c.cellule === 'occidentale').imageUrl;

async function inst(o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i);
    // comme en production : les achats 1.0.5 d'une installation ont leur mouvement d'ouverture (la réconciliation reste propre)
    if (o.achete > 0) await db.col('mouvements').insertOne({ installationId: i._id, le: new Date('2026-09-01T00:00:00Z'), surface: 'extension', type: 'migration', delta: o.achete, poche: 'achete', motif: 'migration', scanId: null, etat: 'debite', cleIdempotence: `ouverture|installation:${i._id}`, expireLe: new Date('2028-09-01T00:00:00Z') });
    return { i, jeton, p: { type: 'installation', id: i._id } };
}
async function semer() {
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    const docs = [];
    for (const [id, variante] of [[ID_A, 'normale'], [ID_B, 'reverse']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        docs.push(VB.doc(id, { variante }));
    }
    VB.installer(docs);
}
const affirme = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
    etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
    candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true }); await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-achete-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex(); await semer();
    const pret = require('../pret'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let mode = 'affirmee', nCartes = 1;
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        if (mode === 'affirmee') return res.json({ ...affirme(ID_A), scanId: sid });
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        if (mode === 'exception') throw new Error('boum');
        throw new Error(`mode inconnu ${mode}`);
    };
    const lot = async () => Array.from({ length: nCartes }, () => ({ statutHttp: 200, corps: affirme(ID_A) }));
    const monter = async deps => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, ...deps }));
        return H.serveur(app);
    };
    const un = await monter(), plusieurs = await monter({ identifierLot: lot });
    const poster = (sv, x, nImages = 1) => H.appel(sv.url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: Array(nImages).fill(IMAGE), title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' },
        entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}`, 'idempotency-key': `ach-route-${Date.now().toString(36)}-${++nCle}` } });
    const FACT = { $ref: '#/components/schemas/Facturation' };
    const valide = f => valider(f, FACT, SCHEMA).ok;
    const achete = async x => (await db.col('installations').findOne({ _id: x.i._id })).achete;
    const quota = async x => (await Q.restantDe(x.p, cfg));

    // ── 1. une carte payée sur achete : poche « achete », le quota du jour intact
    {
        mode = 'affirmee'; const x = await inst({ achete: 2 }); const r = await poster(un, x);
        H.v('1a. 200, identifiée, facturation.poche « achete », valide contre le schéma publié', [r.statut, r.json.analyse.statut, r.json.facturation.poche, valide(r.json.facturation)], [200, 'identifiee', 'achete', true]);
        H.v('    facturation complète { debite 1, reserve 0, rembourse false, motif affirmee, raisonNonRembourse null, poche achete }', r.json.facturation, { debite: 1, reserve: 0, rembourse: false, motif: 'affirmee', raisonNonRembourse: null, poche: 'achete' });
        H.v('    solde.achete 2 -> 1 (servi), offre.restant inchangé (3), le quota du jour non touché', [r.json.solde.achete, r.json.offre.restant, await achete(x), await quota(x)], [1, 3, 1, 3]);
        const r2 = await poster(un, x), r3 = await poster(un, x), r4 = await poster(un, x);
        H.v('1b. les analyses suivantes : achete, puis jour, jour (le quota commence APRÈS les achetées)', [r2.json.facturation.poche, r3.json.facturation.poche, r4.json.facturation.poche, r4.json.solde.achete, r4.json.offre.restant], ['achete', 'jour', 'jour', 0, 1]);
        const r5 = await poster(un, x), r6 = await poster(un, x);
        H.v('1c. la 5e (dernière du quota) passe ; la 6e : quota épuisé et achete 0 -> 429 QUOTA, facturation null (rien débité), donc aucun champ poche', [r5.statut, r6.statut, r6.json.erreur && r6.json.erreur.code, r6.json.facturation], [200, 429, 'QUOTA', null]);
    }
    // ── 2. sans achetée : poche « jour », comme avant (+ le champ additif)
    {
        const x = await inst({ achete: 0 }); const r = await poster(un, x);
        H.v('2. sans analyse achetée : facturation { …, poche « jour » }, offre.restant 3 -> 2', [r.json.facturation.poche, r.json.offre.restant, r.json.solde.achete], ['jour', 2, 0]);
    }
    // ── 3. administrateur : rien débité, achete intacte, pas de champ poche
    {
        const c = Object.assign(M.nouveauCompte({ email: `adm${++nCle}@x.fr`, emailCle: `adm${nCle}@x.fr`, motDePasse: {} }), { verifie: true, role: 'administrateur', solde: { accueil: 0, achete: 5 } });
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'banc' }), { compteId: c._id, lieeLe: new Date() });
        await db.col('installations').insertOne(i);
        const r = await poster(un, { jeton, i }); mode = 'affirmee';
        H.v('3. administrateur (5 achetées) : motif administrateur, aucun champ poche, achete 5 intacte', [r.statut, r.json.facturation.motif, 'poche' in r.json.facturation, (await db.col('comptes').findOne({ _id: c._id })).solde.achete], [200, 'administrateur', false, 5]);
    }
    // ── 4. une analyse payée sur achete puis REMBOURSÉE (introuvable) : rendue à achete, la facturation dit où elle avait été prise
    {
        mode = 'introuvable'; const x = await inst({ achete: 2 }); const r = await poster(un, x);
        H.v('4a. introuvable remboursé : { debite 0, rembourse true, motif introuvable, poche achete }, achete revenue à 2, quota intact', [r.json.facturation, await achete(x), await quota(x)], [{ debite: 0, reserve: 0, rembourse: true, motif: 'introuvable', raisonNonRembourse: null, poche: 'achete' }, 2, 3]);
        mode = 'exception'; const y = await inst({ achete: 2 }); const e0 = console.error; console.error = () => { }; let re; try { re = await poster(un, y); } finally { console.error = e0; }
        H.v('4b. exception de la chaîne : 500 SERVEUR, panne remboursée, poche achete, achete revenue à 2', [re.statut, re.json.erreur.code, re.json.facturation.rembourse, re.json.facturation.poche, await achete(y)], [500, 'SERVEUR', true, 'achete', 2]);
        mode = 'affirmee';
    }
    // ── 5. les lots : « achete » seulement si TOUTES les unités le sont ; sinon « jour »
    {
        nCartes = 11;                                                   // 11 cartes = 2 unités
        const a = await inst({ achete: 2 }); const ra = await poster(plusieurs, a, 3);
        H.v('5a. lot de 11 cartes, 2 achetées : les deux unités sur achete -> poche « achete », debite 2, achete 0, quota intact', [ra.json.analyse.statut, ra.json.facturation.poche, ra.json.facturation.debite, ra.json.solde.achete, ra.json.offre.restant], ['lot', 'achete', 2, 0, 3]);
        const b = await inst({ achete: 1 }); const rb = await poster(plusieurs, b, 3);
        H.v('5b. lot de 11 cartes, 1 achetée : unité 1 sur achete, unité 2 sur le quota -> poche « jour », debite 2, achete 0, offre.restant 3 -> 2', [rb.json.facturation.poche, rb.json.facturation.debite, rb.json.solde.achete, rb.json.offre.restant], ['jour', 2, 0, 2]);
        const mv = (await db.col('mouvements').find({ installationId: b.i._id, type: 'debit' }).sort({ _id: 1 }).toArray()).map(m => m.poche);
        H.v('    les deux lignes de débit du grand livre : [achete, jour]', mv.sort(), ['achete', 'jour']);
        const c = await inst({ achete: 0 }); const rc = await poster(plusieurs, c, 3);
        H.v('5c. lot sans achetée : poche « jour »', [rc.json.facturation.poche, rc.json.offre.restant], ['jour', 1]);
        // un lot qu'on ne peut pas payer : tout ou rien, le débit initial rendu, la facturation dit d'où il venait
        nCartes = 25;                                                   // 3 unités
        const d = await inst({ achete: 1 }); await Q.poserRestant(`installation:${d.i._id}`, 1, { limite: 3 });      // 1 analyse du quota devant lui : 1 achetée + 1 du jour = 2 unités < 3
        const rd = await poster(plusieurs, d, 3);
        H.v('5d. lot de 25 cartes (3 unités) pour 2 unités disponibles : 429 QUOTA lot-trop-grand, crédit initial rendu, poche « achete » (celle du débit initial), tout ou rien', [rd.statut, rd.json.erreur && rd.json.erreur.detail, rd.json.facturation && rd.json.facturation.rembourse, rd.json.facturation && rd.json.facturation.poche, await achete(d), await quota(d)], [429, 'lot-trop-grand', true, 'achete', 1, 1]);
        const net = await db.col('mouvements').aggregate([{ $match: { installationId: d.i._id } }, { $group: { _id: '$poche', s: { $sum: '$delta' } } }]).toArray();
        H.v('    grand livre : net achete = +1 (ouverture) -1 +1 = 1, net jour = 0 ; réconciliation sans écart', [Object.fromEntries(net.map(n => [n._id, n.s])), (await require('../argent/reconcilier').reconcilier(d.p, { cfg, maintenant: new Date() })).ecarts], [{ achete: 1, jour: 0 }, []]);
        nCartes = 1;
    }
    await un.fermer(); await plusieurs.fermer();
    await mongoose.disconnect(); await H.arreterBanc(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
