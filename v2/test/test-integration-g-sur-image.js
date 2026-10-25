'use strict';
// INTEGRATION-IMAGE — la ROUTE /api/identifier de bout en bout avec la règle G (le vecteur de l'extension, V2_EMPREINTE_EXTENSION) ET SUR-PAR-IMAGE (V2_SUR_PAR_IMAGE) ALLUMÉES TOUTES LES DEUX, contre la marque des emprunts de l'archive
// (version.empruntDe, format 3). Les deux règles lisent la MÊME marque : sans version, ou avec un visuel emprunté non vérifié, ou en basse définition, ou avec une mention, elles se taisent ; le même candidat VÉRIFIÉ (« juste », colonne vide)
// et propre laisse la règle d'image parler. Base : la base EN MÉMOIRE du banc ; la chaîne héritée est FABRIQUÉE ; les zones sont les fausses zones du banc ; l'index est fabriqué (_empreinte-aide.js). Aucun réseau, aucun modèle, aucune dépense.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const { creerConstructeur } = require('../chargeur/version');
const E = require('../chargeur/etat');
const VB = require('./_visuels-banc');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfgOn = lireConfig({ ...A.ENV_EMPREINTE, V2_SUR_PAR_IMAGE: '1' });                       // G (vecteur) + SUR-PAR-IMAGE
const cfgGSeule = lireConfig({ ...A.ENV_EMPREINTE });                                          // G seule : SUR-PAR-IMAGE éteinte
const ORIGINE = lireConfig({ MONGODB_BASE: 'test_scratch' }).origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.7.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-int-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function inst() {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const poster = (url, jeton, c) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
const CLES = { [A.ID_A]: 'banc/jeu-5.webp', [A.ID_X]: 'banc/jeu-4.webp', [A.ID_P]: 'banc/jeu-3.webp' };
const semer = async (id, numero) => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
};
/** Une archive comme le chargeur la construit : colonne des marquages ET colonne des emprunts (format 3). `empruntes` : les produits à visuel emprunté NON vérifié ; `basse` : idProduct -> basseDefinition ; `mention` : idProduct -> mention. */
function archive({ empruntes = [], basse = {}, mention = {} } = {}) {
    const b = creerConstructeur({ marquages: true, emprunts: true });
    for (const [id, numero] of [[A.ID_A, '001'], [A.ID_X, '002'], [A.ID_P, '003']])
        b.entree(VB.doc(id, { numero, idMetacard: 990100 + (id % 100), grande: { cle: CLES[id], w: 600, h: 840 }, basseDefinition: id in basse ? basse[id] : false, mention: id in mention ? mention[id] : null }));
    for (const id of empruntes) b.emprunt(id);
    return Object.freeze(b.finir());
}
/** Une archive D'AVANT le format 3 : les marquages mais PAS la colonne des emprunts (empruntDe rend null partout : inconnu, jamais « propre »). */
function archiveAvant() {
    const b = creerConstructeur({ marquages: true });
    for (const [id, numero] of [[A.ID_A, '001'], [A.ID_X, '002'], [A.ID_P, '003']]) b.entree(VB.doc(id, { numero, idMetacard: 990100 + (id % 100), grande: { cle: CLES[id], w: 600, h: 840 }, basseDefinition: false }));
    return Object.freeze(b.finir());
}
const sansVolatil = j => { const { scanId, solde, offre, ...x } = JSON.parse(JSON.stringify(j)); void scanId; void solde; void offre; if (x.facturation) delete x.facturation.poche; return x; };

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-integration-g-sur-image.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    await semer(A.ID_A, '001'); await semer(A.ID_X, '002'); await semer(A.ID_P, '003');

    const express = require('express'); const pret = require('../pret');
    const { assembler } = require('../index');
    const lecture = (ids, o = {}) => ({ success: true, question: null, carte: { idProduct: ids[0], nomProduit: 'Tropius', nom: 'Tropius', numero: null, total: null, setCode: null, rarete: null, langue: 'FR', ambigu: true, ...o },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })), classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    let chaine = null;
    const chaineFabriquee = async (req, res) => {
        const { mode, ids } = chaine;
        if (mode === 'ambigue') {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            return res.json({ ...lecture(ids), scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 } });
        }
        if (mode === 'affirmee') return res.json({ ...lecture(ids, { ambigu: false }), candidats: [{ idProduct: ids[0], nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], scanId: String(req.scanIdImpose) });
        throw new Error(`mode inconnu ${mode}`);
    };
    // LES DEUX règles sont réelles : le fournisseur du vecteur est celui de la production (index en place, fausses zones, scans du banc) ; la route consulte ensuite SUR-PAR-IMAGE.
    const appFabrique = async (cfgApp, plus = {}) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee, zonesEmpreinte: A.fausseZones(), scanEmpreinte: A.scanBanc, ...plus }));
        return H.serveur(app);
    };
    const jouer = async (sv, c, i) => { chaine = c; const x = await inst(); const r = await poster(sv.url, x.jeton, corps({ empreintes: [A.entree(0, i, true)], modeleEmpreinte: A.modeleAnnonce() })); await attendre(60); return { ...x, r, j: r.json || {} }; };
    const analyseDe = j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
    const statut = j => j.analyse.cartes[0].statut;
    const carteDe = j => j.analyse.cartes[0].carte && j.analyse.cartes[0].carte.idProduct;
    const candsDe = j => (j.analyse.cartes[0].candidats || []).map(c => c.idProduct).sort();
    const Q = { mode: 'ambigue', ids: [A.ID_A, A.ID_X] };
    await A.preparer();
    A.installerIndex();
    // sv : G ET SUR-PAR-IMAGE réelles · svG : G seule · svS : SUR-PAR-IMAGE seule (G muette : le fournisseur de voisins du banc ne conclut jamais)
    const sv = await appFabrique(cfgOn), svG = await appFabrique(cfgGSeule), svS = await appFabrique(cfgOn, { voisinsEmpreinte: async () => ({ ok: false, code: 'muette' }) });
    const trois = async (c, i) => { const a = await jouer(sv, c, i), g = await jouer(svG, c, i), s = await jouer(svS, c, i); return { a, g, s, st: [statut(a.j), statut(g.j), statut(s.j)] }; };
    const QUESTION3 = ['a-trancher', 'a-trancher', 'a-trancher'];

    // ── (1) SANS ARCHIVE EN PLACE (aucune version), l'index d'empreintes PRÉSENT : le défaut est FERMÉ — tout est emprunté, les règles se taisent
    E.vider();
    {
        const t = await trois(Q, 5);
        H.v('1a. sans version, index présent, vecteur de A, question [A, X] : elle RESTE une question avec G+SUR-PAR-IMAGE, G seule et SUR-PAR-IMAGE seule', t.st, QUESTION3);
        H.v('1b. … crédit réservé, aucun débit, mêmes candidats', [t.a.r.statut, candsDe(t.a.j), t.a.j.facturation.reserve, t.a.j.facturation.debite], [200, [A.ID_A, A.ID_X], 1, 0]);
        const an = await analyseDe(t.a.j);
        H.v('1c. aucune influence de G, aucune affirmation de la règle d\'image', [an.empreinteExtension ? an.empreinteExtension.influence : 'sans-trace', !!(an.surParImage && an.surParImage.issue === 'sur')], [false, false]);
        const a = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, 3);
        H.v('1d. sans version, la chaîne affirme A et le vecteur désigne P : G ne contredit pas (tout est emprunté) — identifiee A, aucun désaccord', [statut(a.j), carteDe(a.j), !!(await analyseDe(a.j)).desaccordRegleG], ['identifiee', A.ID_A, false]);
        const b = await jouer(sv, Q, 4);
        H.v('1e. deux vecteurs différents donnent la MÊME réponse (octet pour octet, scanId et solde mis à part)', JSON.stringify(sansVolatil(b.j)), JSON.stringify(sansVolatil(t.a.j)));
    }
    // ── (2) une archive dont les trois visuels sont EMPRUNTÉS non vérifiés (aucun verdict)
    E.installer(archive({ empruntes: [A.ID_A, A.ID_X, A.ID_P] }));
    {
        const t = await trois(Q, 5);
        H.v('2a. visuels empruntés non vérifiés : la question RESTE (G+SUR-PAR-IMAGE, G seule, SUR-PAR-IMAGE seule)', t.st, QUESTION3);
        const an = await analyseDe(t.s.j);
        H.v('2b. SUR-PAR-IMAGE se tait avec un motif nommé (jamais un silence)', [an.surParImage && an.surParImage.issue, !!(an.surParImage && an.surParImage.motif)], ['se-tait', true]);
        const a = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, 3);
        H.v('2c. chaîne affirme A, vecteur de P, A emprunté non vérifié : G se tait aussi (identifiee A, aucun désaccord)', [statut(a.j), carteDe(a.j), !!(await analyseDe(a.j)).desaccordRegleG], ['identifiee', A.ID_A, false]);
    }
    // ── (2bis) une archive d'AVANT (sans la colonne des emprunts) : inconnu = emprunté, les règles se taisent
    E.installer(archiveAvant());
    {
        const t = await trois(Q, 5);
        H.v('2d. archive sans colonne des emprunts (empruntDe -> null) : la question RESTE (G+SUR-PAR-IMAGE, G seule, SUR-PAR-IMAGE seule)', t.st, QUESTION3);
    }
    // ── (3) SEUL le candidat que le vecteur désigne (A) est emprunté non vérifié : les deux règles se taisent
    E.installer(archive({ empruntes: [A.ID_A] }));
    {
        const t = await trois(Q, 5);
        H.v('3. A (le candidat désigné) emprunté non vérifié, X propre : la question RESTE (G+SUR-PAR-IMAGE, G seule, SUR-PAR-IMAGE seule)', t.st, QUESTION3);
    }
    // ── (4) les mêmes visuels VÉRIFIÉS « juste » (colonne vide) et basseDefinition false : les règles PEUVENT parler
    E.installer(archive());
    {
        const t = await trois(Q, 5);
        H.v('4a. visuels vérifiés « juste », basseDefinition false, vecteur de A : les règles affirment A (G+SUR-PAR-IMAGE, G seule, SUR-PAR-IMAGE seule)', [t.a, t.g, t.s].map(x => carteDe(x.j)), [A.ID_A, A.ID_A, A.ID_A]);
        H.v('4b. … statut identifiee, facturation affirmee { debite: 1 } ; SUR-PAR-IMAGE seule dit « sur » dans le journal', [t.st, t.a.j.facturation.motif, t.a.j.facturation.debite, (await analyseDe(t.s.j)).surParImage.issue], [['identifiee', 'identifiee', 'identifiee'], 'affirmee', 1, 'sur']);
        const a = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, 3);
        H.v('4c. archive vérifiée : G n\'est pas muette — la chaîne affirme A, le vecteur désigne P : a-trancher avec désaccord', [statut(a.j), !!(await analyseDe(a.j)).desaccordRegleG], ['a-trancher', true]);
    }
    // ── (4bis) 🔴 CONSTAT D'INTÉGRATION : un emprunt VÉRIFIÉ (verdict « juste » : colonne des emprunts VIDE) garde la `mention` que la décision d'archive lui a donnée (« visuel d'un autre tirage »). G (qui lit seulement empruntDe)
    // peut s'en servir ; SUR-PAR-IMAGE, dont la ceinture lit AUSSI la mention, se tait. Le gain des verdicts ne passe donc pas par la règle d'image tant que cette ceinture existe. Ce banc ÉCRIT l'état actuel ; si la décision change, il change.
    {
        const MENTION = 'Visuel de la même carte dans un autre tirage';
        E.installer(archive({ mention: { [A.ID_A]: MENTION, [A.ID_X]: MENTION, [A.ID_P]: MENTION } }));
        const t = await trois(Q, 5);
        H.v('4d. emprunts vérifiés (colonne vide) qui gardent leur mention : G affirme A (promotion), SUR-PAR-IMAGE seule se TAIT (ceinture de la mention)', [carteDe(t.g.j), statut(t.s.j), (await analyseDe(t.s.j)).surParImage.motif], [A.ID_A, 'a-trancher', 'visuel-suspect']);
    }
    // ── (5) vérifié MAIS en basse définition / sans mesure / avec une mention : la règle d'image seule se tait
    for (const [nom, opts] of [['basseDefinition true sur X', { basse: { [A.ID_X]: true } }], ['basseDefinition true sur A', { basse: { [A.ID_A]: true } }], ['basseDefinition non mesurée (null) sur X', { basse: { [A.ID_X]: null } }], ['mention non vide sur A (deux sources en conflit)', { mention: { [A.ID_A]: 'visuel du tirage japonais' } }]]) {
        E.installer(archive(opts));
        const s = await jouer(svS, Q, 5);
        H.v(`5. vérifiés mais ${nom} : SUR-PAR-IMAGE seule se tait, la question RESTE`, [statut(s.j), candsDe(s.j)], ['a-trancher', [A.ID_A, A.ID_X]]);
    }
    // ── (6) le CONTEXTE que le fournisseur de G rend à la route (celui que lit la garde des zones ET la décision) : amendé par la marque — sans version ou emprunté, les produits quittent `produits` pour les restes ; vérifié, intact
    {
        const reel = require('../identifier/voisins-empreinte').creerFournisseurEmpreinte({ cfg: cfgOn, scan: A.scanBanc, zones: A.fausseZones() });
        let vu = null;
        const svW = await appFabrique(cfgOn, { voisinsEmpreinte: async a => { const r = await reel(a); if (r && r.ok) vu = r.contexteG; return r; } });
        const nProduits = (ctx, hors = []) => [...ctx.produits.values()].reduce((s, l) => s + l.filter(p => [A.ID_A, A.ID_X, A.ID_P].includes(p[0]) && !hors.includes(p[0])).length, 0);       // seuls les produits de l'archive du banc (A, X, P) ont une entrée : les autres de l'index sont « inconnus », donc empruntés
        const total = nProduits(require('../identifier/etat-empreintes').courante().index.contexteG);       // 7 lignes d'archive dans l'index fabriqué
        E.vider(); vu = null; await jouer(svW, Q, 5);
        H.v('6a. sans version : le contexte rendu par le fournisseur de G ne porte AUCUN produit « avec visuel » (tout est emprunté), le total d\'avant n\'est pas nul', [vu !== null && nProduits(vu), total > 0], [0, true]);
        E.installer(archive({ empruntes: [A.ID_A] })); vu = null; await jouer(svW, Q, 5);
        H.v('6b. A emprunté non vérifié : toutes les lignes de A quittent le contexte', vu !== null && nProduits(vu), nProduits(require('../identifier/etat-empreintes').courante().index.contexteG, [A.ID_A]));
        E.installer(archive()); vu = null; await jouer(svW, Q, 5);
        H.v('6c. tout vérifié : le contexte est celui de l\'index, intact', vu !== null && nProduits(vu), total);
        await svW.fermer();
    }    await svS.fermer();
    await sv.fermer(); await svG.fermer();
    H.bilan();
    setTimeout(() => process.exit(process.exitCode || 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
