'use strict';
// SUR-PAR-IMAGE — la ROUTE /api/identifier de bout en bout (V2_SUR_PAR_IMAGE + V2_EMPREINTE_EXTENSION) : drapeau, vecteur, archive, débit, réponse, journal. Base : la base EN MÉMOIRE du banc ; la chaîne héritée est FABRIQUÉE
// (comme test-identifier-empreinte-route.js) ; la règle G est SILENCIÉE (fournisseur « muette ») pour juger SUR-PAR-IMAGE seule ; l'index est celui de _empreinte-aide.js (fabriqué), l'archive celle des bancs (_visuels-banc.js).
// Aucun réseau, aucun fichier du testeur, aucun modèle, aucune dépense. L'assertion du drapeau ÉTEINT est écrite en PREMIER.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const base = { ...A.ENV_EMPREINTE };
const cfgSans = lireConfig({ MONGODB_BASE: 'test_scratch' });                       // ni l'un ni l'autre
const cfgEmpreinte = lireConfig(base);                                              // le vecteur seul : SUR-PAR-IMAGE éteint
const cfgOn = lireConfig({ ...base, V2_SUR_PAR_IMAGE: '1' });
const ORIGINE = cfgSans.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-spi-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const poster = (url, jeton, c) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
const essaisDe = id => QA.restantDe({ type: 'installation', id }, cfgSans);
const mouvements = id => raw('mouvements').find({ installationId: id }).toArray();
const VB = require('./_visuels-banc'); const VIS = []; let VERSION_AVEC = null, VERSION_SANS = null;
const CLES = { [A.ID_A]: 'banc/jeu-5.webp', [A.ID_X]: 'banc/jeu-4.webp', [A.ID_P]: 'banc/jeu-3.webp' };
const semer = async (id, numero) => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { numero, idMetacard: 990100 + (id % 100), grande: { cle: CLES[id], w: 600, h: 840 }, basseDefinition: false }));      // `basseDefinition` présent : l'archive porte la colonne des marquages (sinon la règle se tait : défaut fermé)
};
const sansVolatil = j => { const { scanId, solde, offre, ...x } = JSON.parse(JSON.stringify(j)); void scanId; void solde; void offre; if (x.facturation) delete x.facturation.poche; return x; };

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-sur-par-image-integration.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    await semer(A.ID_A, '001'); await semer(A.ID_X, '002'); await semer(A.ID_P, '003');
    {   // l'archive avec la colonne des marquages (comme celle que le chargeur construit : calcul.js:15)
        const { creerConstructeur } = require('../chargeur/version'); const bm = creerConstructeur({ marquages: true });
        for (const d of VIS) bm.entree(d);
        const brute = bm.finir();                                                  // gelée : on en installe des copies gelées
        VERSION_SANS = Object.freeze({ ...brute });
        VERSION_AVEC = Object.freeze({ ...brute, empruntDe: () => false });        // le point de branchement du lot MARQUE-EMPRUNT (aucun emprunt dans cette archive de banc) ; sans lui la règle se tait (banc 3h)
        require('../chargeur/etat').installer(VERSION_AVEC);
    }

    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources');
    const { assembler } = require('../index');
    const lecture = (ids, o = {}) => ({ success: true, question: null, carte: { idProduct: ids[0], nomProduit: 'Tropius', nom: 'Tropius', numero: null, total: null, setCode: null, rarete: null, langue: 'FR', ambigu: true, ...o },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })), classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    let chaine = null;
    const chaineFabriquee = async (req, res) => {
        const { mode, ids, lu } = chaine;
        if (mode === 'ambigue') {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            return res.json({ ...lecture(ids, lu || {}), scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 } });
        }
        if (mode === 'affirmee') return res.json({ ...lecture(ids, { ambigu: false, ...(lu || {}) }), candidats: [{ idProduct: ids[0], nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], scanId: String(req.scanIdImpose) });
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        throw new Error(`mode inconnu ${mode}`);
    };
    const appFabrique = async (cfgApp, deps = {}) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee, voisinsEmpreinte: async () => ({ ok: false, code: 'muette' }), ...deps }));
        return H.serveur(app);
    };
    const jouer = async (sv, c, requete) => { chaine = c; const x = await inst(3); const r = await poster(sv.url, x.jeton, corps(requete)); await attendre(50); return { ...x, r, j: r.json || {} }; };
    const analyseDe = j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
    const net = async x => (await mouvements(x.i._id)).reduce((s, m) => s + m.delta, 0);
    const ouverts = async x => (await mouvements(x.i._id)).filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat);
    const vec = (i, redressee = true) => ({ empreintes: [A.entree(0, i, redressee, false)], modeleEmpreinte: A.modeleAnnonce() });
    const crochet = require('../banc/crochet'); const origCrochet = crochet.apresIdentifier; let appelsCrochet = [];
    crochet.apresIdentifier = a => { appelsCrochet.push(a.analyse.statut); };
    const cartesDe = j => j.analyse.cartes[0];
    const Q = { mode: 'ambigue', ids: [A.ID_A, A.ID_X] };
    await A.preparer();
    A.installerIndex();

    // ── (1) EN PREMIER : SUR-PAR-IMAGE éteint — la question reste, le journal ne porte rien, que le vecteur désigne A ou non
    const svEmp = await appFabrique(cfgEmpreinte, {});
    const eteint = await jouer(svEmp, Q, vec(5));
    {
        H.v('1a. V2_SUR_PAR_IMAGE éteint, vecteur de A : la question de la chaîne reste (a-trancher [A, X]), crédit RÉSERVÉ', [eteint.r.statut, cartesDe(eteint.j).statut, cartesDe(eteint.j).candidats.map(c => c.idProduct).sort(), eteint.j.facturation.reserve], [200, 'a-trancher', [A.ID_A, A.ID_X], 1]);
        const an = await analyseDe(eteint.j);
        H.vrai('1b. … et la ligne `analyses` ne porte PAS `surParImage`', !('surParImage' in an));
        const sans = await appFabrique(cfgSans, {});
        const a = await jouer(sans, Q, {}), b = await jouer(sans, Q, vec(5));
        H.v('1c. ni vecteur ni règle (drapeaux éteints) : la requête avec ou sans empreintes rend la MÊME réponse (octet pour octet, scanId et solde mis à part)', JSON.stringify(sansVolatil(b.j)), JSON.stringify(sansVolatil(a.j)));
        await sans.fermer();
    }
    // ── (2) allumé : la question devient l'affirmation de A
    const sv = await appFabrique(cfgOn, {});
    {
        appelsCrochet = [];
        const c = await jouer(sv, Q, vec(5));
        H.v('2a. vecteur de A, question [A, X] : identifiee A, facturation affirmee { debite: 1 }', [c.r.statut, cartesDe(c.j).statut, cartesDe(c.j).carte && cartesDe(c.j).carte.idProduct, c.j.facturation.motif, c.j.facturation.debite, c.j.facturation.reserve], [200, 'identifiee', A.ID_A, 'affirmee', 1, 0]);
        H.v('2b. le crédit réservé par la chaîne est RÉGLÉ comme une réponse : essai 3 -> 2, net -1, un débit « debite » (jamais « reserve »), la question « repondue »', [await essaisDe(c.i._id), await net(c), await ouverts(c), (await raw('questions_v2').findOne({ _id: `${c.j.scanId}:0` })).etat], [2, -1, ['debite'], 'repondue']);
        H.v('2c. la réponse dit que le vecteur a servi, sans rien de plus', c.j.empreinte, { utilisee: true, code: null });
        const an = await analyseDe(c.j);
        H.v('2d. `analyses` : ce que le vecteur a fait (influence vraie, pas de promotion de G), et la trace de la règle (sûr, produit, candidats)', [an.empreinteExtension.influence, an.empreinteExtension.promotion, an.surParImage.issue, an.surParImage.produit, an.surParImage.candidats], [true, false, 'sur', A.ID_A, [A.ID_A, A.ID_X]]);
        H.v('2e. 🔑 un résultat que le vecteur a CHANGÉ n\'est JAMAIS écrit dans une donnée partagée (banc réel)', appelsCrochet, []);
        const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
        const v = valider(c.j, { $ref: '#/components/schemas/ReponseAnalyse' }, SCHEMA);
        H.vrai('2f. la réponse tient le contrat OpenAPI (aucun champ, aucune valeur neuve)', v.ok);
    }
    // ── (3) ce qui reste une question
    {
        const loin = await jouer(sv, { mode: 'ambigue', ids: [A.ID_A, A.ID_P] }, vec(4));
        H.v('3a. vecteur d\'un AUTRE produit (jeu-4 : X), question [A, P] : aucun des deux n\'est le voisin n°1 — la question reste, réservée', [cartesDe(loin.j).statut, loin.j.facturation.reserve, (await analyseDe(loin.j)).surParImage.motif], ['a-trancher', 1, 'pas-voisin-n1']);
        const nonRedr = await jouer(sv, Q, vec(5, false));
        H.v('3b. vecteur de la photo ENTIÈRE (non redressée) : la question reste', [cartesDe(nonRedr.j).statut, (await analyseDe(nonRedr.j)).surParImage.motif], ['a-trancher', 'photo-non-redressee']);
        const contredit = await jouer(sv, { ...Q, lu: { numero: '002', total: '064', setCode: 'PBL' } }, vec(5));
        H.v('3c. 🔑 la chaîne a LU 002 (X porte 002, A porte 001) : l\'image désigne A, la lecture désigne X — deux sources en conflit, la question reste', [cartesDe(contredit.j).statut, cartesDe(contredit.j).candidats.map(c => c.idProduct).sort()], ['a-trancher', [A.ID_A, A.ID_X]]);
        const aff = await jouer(sv, { mode: 'affirmee', ids: [A.ID_P] }, vec(5));
        H.v('3d. la chaîne AFFIRME P : jamais touchée (identifiee P), pas de trace de la règle', [cartesDe(aff.j).statut, cartesDe(aff.j).carte.idProduct, 'surParImage' in (await analyseDe(aff.j))], ['identifiee', A.ID_P, false]);
        const intro = await jouer(sv, { mode: 'introuvable', ids: [] }, vec(5));
        H.v('3e. la chaîne est INTROUVABLE (remboursée) : jamais touchée, crédit rendu', [cartesDe(intro.j).statut, await essaisDe(intro.i._id), await net(intro)], ['introuvable', 3, 0]);
        const sansVec = await jouer(sv, Q, {});
        H.v('3f. aucune empreinte dans la requête : la question de la chaîne, sans trace', [cartesDe(sansVec.j).statut, 'surParImage' in (await analyseDe(sansVec.j))], ['a-trancher', false]);
        const modeleAutre = await jouer(sv, Q, { empreintes: [A.entree(0, 5, true, false)], modeleEmpreinte: { id: A.MODELE.id, sha256: 'd'.repeat(64) } });
        H.v('3g. une AUTRE version du modèle : empreintes ignorées, la question reste', cartesDe(modeleAutre.j).statut, 'a-trancher');
    }
    {
        const E = require('../chargeur/etat'); E.vider(); E.installer(VERSION_SANS);
        const sm = await jouer(sv, Q, vec(5));
        H.v('3h. 🔴 archive SANS la marque d\'emprunt (empruntDe absente) : la question reste, trace « emprunt-inconnu », crédit réservé', [cartesDe(sm.j).statut, (await analyseDe(sm.j)).surParImage.motif, sm.j.facturation.reserve], ['a-trancher', 'emprunt-inconnu', 1]);
        E.vider(); E.installer(VERSION_AVEC);
    }
    // ── (5) une panne de l'archive ne casse rien
    {
        const E = require('../chargeur/etat'); const sauve = E.version();
        E.vider();
        const p = await jouer(sv, Q, vec(5));
        H.v('5a. aucune archive des visuels en place : la question de la chaîne, 200', [p.r.statut, cartesDe(p.j).statut], [200, 'a-trancher']);
        E.installer(sauve);
    }
    crochet.apresIdentifier = origCrochet;
    await svEmp.fermer(); await sv.fermer();
    H.bilan();
    setTimeout(() => process.exit(process.exitCode || 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
