'use strict';
// Banc MODELE-VISUEL-API (5) — la route /api/identifier AVEC le vecteur de l'extension (V2_EMPREINTE_EXTENSION), de bout en bout : drapeau, requête, version du modèle, index, décision de la règle G, promotion mesurée,
// garde (2), facturation, désaccords, banc, réponse. Base : la base EN MÉMOIRE du banc ; la chaîne héritée est FABRIQUÉE (comme test-identifier-regle-g-route.js) ; l'index est celui de _empreinte-aide.js (fabriqué).
// Aucun réseau, aucun fichier du testeur, aucun modèle, aucune dépense. L'assertion du drapeau ÉTEINT est écrite en PREMIER.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const IMAGE2 = IMAGE.replace(/(\.[a-z]+)$/, '-2$1');
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch' });
const cfgOffAvecModele = lireConfig({ MONGODB_BASE: 'test_scratch', V2_MODELE_EMPREINTE_ID: A.MODELE.id, V2_MODELE_EMPREINTE_SHA256: A.MODELE.sha256 });
const cfgOn = lireConfig({ ...A.ENV_EMPREINTE, V2_MODELE_EMPREINTE_URL: 'https://exemple.invalid/modele-banc.onnx', V2_MODELE_EMPREINTE_OCTETS: '118202501' });
const cfgOnSansUrl = lireConfig(A.ENV_EMPREINTE);
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.7.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-mva-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const poster = (url, jeton, c) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
const essaisDe = id => QA.restantDe({ type: 'installation', id }, cfgOff);
const mouvements = id => raw('mouvements').find({ installationId: id }).toArray();
const VB = require('./_visuels-banc'); const VIS = [];
const semer = async (id, numero = '001') => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { numero, idMetacard: 990100 + (id % 100) }));
};
const empreinteDe = s => require('crypto').createHash('sha1').update(s).digest('hex').slice(0, 12);
const sansVolatil = j => { const { scanId, solde, offre, ...x } = JSON.parse(JSON.stringify(j)); void scanId; void solde; void offre; if (x.facturation) delete x.facturation.poche; return x; };

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-identifier-empreinte-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [A.ID_A, A.ID_B, A.ID_P]) await semer(id, '001');
    await semer(A.ID_X, '002');                                       // le produit que la chaîne lit mal : numéro 002, la lecture dit 001
    VB.installer(VIS);

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources');
    const { assembler } = require('../index');
    let strategieChaine = null;                                       // M3 : la stratégie reverse que la chaîne annonce (null = normale)
    const lecture = (id, o = {}) => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false, ...o },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: strategieChaine }, codeLangue: 2 });
    let chaine = null, appelsChaine = 0;
    const chaineFabriquee = async (req, res) => {
        appelsChaine++;
        const { mode, ids } = chaine;
        if (mode === 'affirmee') return res.json({ ...lecture(ids[0]), scanId: String(req.scanIdImpose) });
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        if (mode === 'ambigue' || mode === 'ambigue-sans-lecture') {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            const l = lecture(ids[0], mode === 'ambigue' ? {} : { numero: null, total: null, setCode: null });
            return res.json({ ...l, scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...l.carte, ambigu: true }, candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    const appFabrique = async (cfgApp, deps = {}) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));   // la limite de index.js quand V2_EMPREINTE_EXTENSION=1 (test-corps-identifier-empreinte.js) app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee, ...deps }));
        return H.serveur(app);
    };
    const jouer = async (sv, c, requete) => { chaine = c; const x = await inst(3); const r = await poster(sv.url, x.jeton, corps(requete)); await attendre(50); return { ...x, r, j: r.json || {} }; };
    const analyseDe = j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
    const net = async x => (await mouvements(x.i._id)).reduce((s, m) => s + m.delta, 0);
    const ouverts = async x => (await mouvements(x.i._id)).filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat);
    const vec = (i, redressee = false) => ({ empreintes: [A.entree(0, i, redressee)], modeleEmpreinte: A.modeleAnnonce() });
    const crochet = require('../banc/crochet'); const origCrochet = crochet.apresIdentifier; let appelsCrochet = [];
    crochet.apresIdentifier = a => { appelsCrochet.push(a.analyse.statut); };
    const cartesDe = j => j.analyse.cartes[0];
    await A.preparer();
    A.installerIndex();

    // ── (1) EN PREMIER : drapeau ÉTEINT — la requête, la réponse et le débit sont ceux d'avant, que la requête porte des empreintes ou non
    const svOff = await appFabrique(cfgOffAvecModele, {});
    {
        const sans = await jouer(svOff, { mode: 'affirmee', ids: [A.ID_A] }, {});
        const avec = await jouer(svOff, { mode: 'affirmee', ids: [A.ID_A] }, vec(3));
        H.v('1a. drapeau éteint : une requête AVEC empreintes rend exactement la réponse d\'une requête sans (scanId, solde, offre mis à part)', empreinteDe(JSON.stringify(sansVolatil(avec.j))), empreinteDe(JSON.stringify(sansVolatil(sans.j))));
        H.vrai('1b. … et la réponse ne porte NI `empreinte` NI `regleVerdict.modeleEmpreinte` (même avec une version de modèle configurée)', !('empreinte' in avec.j) && !('modeleEmpreinte' in (avec.j.analyse.regleVerdict || {})));
        const an = await analyseDe(avec.j);
        H.vrai('1c. … la ligne `analyses` ne porte pas `empreinteExtension` et le débit est celui d\'une affirmation (essai 3 -> 2)', !an.empreinteExtension && (await essaisDe(avec.i._id)) === 2);
        H.v('1d. le drapeau éteint ne LIT pas `empreintes` : même une enveloppe monstrueuse (9 entrées) ne change rien — 200', (await jouer(svOff, { mode: 'affirmee', ids: [A.ID_A] }, { empreintes: Array.from({ length: 9 }, () => A.entree(0, 3)) })).r.statut, 200);
    }
    await svOff.fermer();

    const sv = await appFabrique(cfgOn, {});
    // ── (2) drapeau allumé, requête SANS empreintes : la réponse d'avant, plus la version du modèle dans regleVerdict
    {
        const o = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, {});
        H.v('2a. sans empreintes : identifiee, aucun champ `empreinte`', [o.r.statut, cartesDe(o.j).statut, 'empreinte' in o.j], [200, 'identifiee', false]);
        H.v('2b. regleVerdict dit la version attendue du modèle, l\'adresse de téléchargement (configuration) et sa taille', o.j.analyse.regleVerdict.modeleEmpreinte, { id: A.MODELE.id, sha256: A.MODELE.sha256, url: 'https://exemple.invalid/modele-banc.onnx', octets: 118202501 });
        const sansUrl = await appFabrique(cfgOnSansUrl, {});
        const p = await jouer(sansUrl, { mode: 'affirmee', ids: [A.ID_A] }, {});
        H.v('2c. adresse non configurée (la publication sur R2 n\'est pas faite) : `url` null, `octets` null', p.j.analyse.regleVerdict.modeleEmpreinte, { id: A.MODELE.id, sha256: A.MODELE.sha256, url: null, octets: null });
        await sansUrl.fermer();
        const sansVersion = await appFabrique(lireConfig({ MONGODB_BASE: 'test_scratch', V2_EMPREINTE_EXTENSION: '1' }), {});
        const q = await jouer(sansVersion, { mode: 'affirmee', ids: [A.ID_A] }, vec(3));
        H.v('2d. le serveur n\'a configuré AUCUNE version : pas de `modeleEmpreinte` dans regleVerdict, et les empreintes sont ignorées (« modele-inconnu »)', ['modeleEmpreinte' in q.j.analyse.regleVerdict, q.j.empreinte], [false, { utilisee: false, code: 'modele-inconnu' }]);
        await sansVersion.fermer();
    }

    // ── (3) la PROMOTION : la chaîne pose une question, G affirme, la garde (2) laisse passer
    {
        appelsCrochet = [];
        const c = await jouer(sv, { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, vec(3));
        H.v('3a. chaîne question [A, B], vecteur de jeu-3 (G affirme P, hors des choix) : identifiee P, facturation affirmee { debite: 1 }', [c.r.statut, cartesDe(c.j).statut, cartesDe(c.j).carte && cartesDe(c.j).carte.idProduct, c.j.facturation.motif, c.j.facturation.debite, c.j.facturation.reserve], [200, 'identifiee', A.ID_P, 'affirmee', 1, 0]);
        H.v('3b. la réponse dit ce que le vecteur a fait', c.j.empreinte, { utilisee: true, code: null });
        H.v('3c. le crédit réservé par la chaîne est RÉGLÉ comme une réponse : essai 3 -> 2, net -1, un seul débit, « debite » (jamais « reserve »)', [await essaisDe(c.i._id), await net(c), await ouverts(c)], [2, -1, ['debite']]);
        const q = await raw('questions_v2').findOne({ _id: `${c.j.scanId}:0` });
        H.v('3d. la question réservée est « repondue » par ce produit', [q && q.etat], ['repondue']);
        const an = await analyseDe(c.j);
        H.v('3e. `analyses` : désaccord journalisé (chaîne question, G affirme, retenue « promotion »), et ce que le vecteur a fait (promotion, lecture concordante)',
            [an.desaccordRegleG, an.empreinteExtension], [{ chaine: 'question', regleG: 'affirmee', retenue: 'promotion', produitsChaine: [A.ID_A, A.ID_B], produitsRegleG: [A.ID_P] }, { utilisee: true, code: null, influence: true, promotion: true, lectureConcordante: true, modele: A.MODELE.id }]);
        H.v('3f. 🔑 TOUR 2 (I1) : une PROMOTION par le vecteur, même à lecture concordante, n\'écrit JAMAIS dans le banc partagé : le client choisit entre les produits qui partagent les champs lus', appelsCrochet, []);
        {   // M3 : le prixLive d'une promotion décrit la PHOTO (langue lue, reverse), pas la chaîne seule : juste pour Q
            const p0 = cartesDe(c.j).prixLive;
            H.v('3h. 🔑 M3 promotion, photo normale : prixLive du produit PROMU (langue 2, pas de reverse)', p0, { idProduct: A.ID_P, langues: [2], reverseHolo: false, etatVise: null });
            strategieChaine = 'filtre-url';
            const rv = await jouer(sv, { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, vec(3));
            strategieChaine = null;
            H.v('3i. 🔑 M3 promotion, photo reverse (stratégie filtre-url) : prixLive du produit promu, reverseHolo vrai', cartesDe(rv.j).prixLive, { idProduct: A.ID_P, langues: [2], reverseHolo: true, etatVise: null });
        }
        // le produit de G est DANS les choix de la chaîne : promu aussi
        const d = await jouer(sv, { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, vec(5));
        H.v('3g. G affirme A, qui est DÉJÀ un choix de la chaîne [A, B] : promu quand même (19 des 44 promotions de la mesure) — identifiee A', [cartesDe(d.j).statut, cartesDe(d.j).carte && cartesDe(d.j).carte.idProduct, d.j.facturation.motif], ['identifiee', A.ID_A, 'affirmee']);
    }
    // ── (4) la garde (2) : le produit de G contredit la lecture — la question de la chaîne reste
    {
        const c = await jouer(sv, { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, vec(4));
        H.v('4a. G affirme X (numéro 002) alors que la chaîne a LU 001 : la garde (2) le retire — a-trancher [A, B], facturation reserve', [cartesDe(c.j).statut, cartesDe(c.j).candidats.map(x => x.idProduct).sort(), c.j.facturation.reserve, c.j.facturation.debite], ['a-trancher', [A.ID_A, A.ID_B], 1, 0]);
        const an = await analyseDe(c.j);
        H.v('4b. désaccord « garde-contradiction », vecteur utilisé mais sans effet (influence faux)', [an.desaccordRegleG.retenue, an.empreinteExtension.utilisee, an.empreinteExtension.influence, an.empreinteExtension.promotion], ['garde-contradiction', true, false, false]);
        H.v('4c. essai 3 -> 2, un débit RÉSERVÉ, la question en-attente', [await essaisDe(c.i._id), await ouverts(c), (await raw('questions_v2').findOne({ _id: `${c.j.scanId}:0` })).etat], [2, ['reserve'], 'en-attente']);
        // une promotion SANS lecture exploitable : la garde juge, rien ne contredit, mais rien ne concorde — promu, et rien de partagé n'est écrit
        appelsCrochet = [];
        const s = await jouer(sv, { mode: 'ambigue-sans-lecture', ids: [A.ID_A, A.ID_B] }, vec(3));
        const ans = await analyseDe(s.j);
        H.v('4d. lecture de la chaîne sans aucun champ (numéro, total, code absents) : promu (la garde a jugé, rien ne contredit), lecture NON concordante', [cartesDe(s.j).statut, ans.empreinteExtension.promotion, ans.empreinteExtension.lectureConcordante], ['identifiee', true, false]);
        H.v('4e. 🔑 … le banc réel n\'est PAS appelé : un résultat que le vecteur a changé, sans lecture concordante, n\'entre dans aucune donnée partagée', appelsCrochet, []);
    }
    // ── (5) la chaîne AFFIRME : l'arbitrage prudent d'avant, inchangé
    {
        appelsCrochet = [];
        const acc = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, vec(5));
        H.v('5a. chaîne affirme A, G affirme A (accord) : identifiee A, le vecteur utilisé sans effet — le banc réel est appelé comme avant', [cartesDe(acc.j).statut, acc.j.empreinte, appelsCrochet], ['identifiee', { utilisee: true, code: null }, ['identifiee']]);
        appelsCrochet = [];
        const des = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, vec(3));
        H.v('5b. chaîne affirme A, G affirme P (autre produit) : question entre les deux (jamais tranché en silence), crédit réservé', [cartesDe(des.j).statut, cartesDe(des.j).candidats.map(x => x.idProduct).sort(), des.j.facturation.reserve, await essaisDe(des.i._id)], ['a-trancher', [A.ID_A, A.ID_P], 1, 2]);
        H.v('5c. 🔑 une question NEUVE née du vecteur : le banc réel n\'est pas appelé (le vecteur a changé le résultat, sans lecture concordante)', appelsCrochet, []);
        const dou = await jouer(sv, { mode: 'affirmee', ids: [A.ID_P] }, vec(8));
        H.v('5d. chaîne affirme P, G pose une question [A, B] : le doute de G gagne — a-trancher', [cartesDe(dou.j).statut, cartesDe(dou.j).candidats.map(x => x.idProduct).sort()], ['a-trancher', [A.ID_A, A.ID_B]]);
    }
    // ── (6) l'INTROUVABLE de la chaîne n'est JAMAIS promu (la chaîne a déjà rendu le crédit)
    {
        const i = await jouer(sv, { mode: 'introuvable', ids: [] }, vec(3));
        H.v('6a. chaîne introuvable (remboursée), G affirme P : introuvable gardé, crédit rendu (essai 3), net 0', [cartesDe(i.j).statut, i.j.facturation.rembourse, await essaisDe(i.i._id), await net(i)], ['introuvable', true, 3, 0]);
        H.v('6b. désaccord « introuvable » (celui d\'arbitrage-g.js)', (await analyseDe(i.j)).desaccordRegleG.retenue, 'introuvable');
    }
    // ── (7) le vecteur ne sert à rien : la chaîne décide, et la réponse le DIT par un code fermé
    {
        const ch = { mode: 'ambigue', ids: [A.ID_A, A.ID_B] };
        const garde = async (nom, requete, code) => { const o = await jouer(sv, ch, requete); H.v(nom, [o.r.statut, cartesDe(o.j).statut, o.j.empreinte, await essaisDe(o.i._id)], [200, 'a-trancher', { utilisee: false, code }, 2]); return o; };
        await garde('7a. une AUTRE version du modèle : empreintes ignorées, « modele-inconnu », la question de la chaîne', { empreintes: [A.entree(0, 3)], modeleEmpreinte: { id: A.MODELE.id, sha256: 'd'.repeat(64) } }, 'modele-inconnu');
        await garde('7b. aucun `modeleEmpreinte` dans la requête : « modele-inconnu »', { empreintes: [A.entree(0, 3)] }, 'modele-inconnu');
        const gros = Float32Array.from(A.ligneDe(3)).map(x => x * 1.5);
        await garde('7c. vecteur de norme 1,5 : « invalide »', { empreintes: [{ photo: 0, vecteur: require('../identifier/empreinte-vecteur').encoderVecteur(gros) }], modeleEmpreinte: A.modeleAnnonce() }, 'invalide');
        await garde('7d. vecteur au hasard (cosinus < 0,30) : « invalide »', { empreintes: [{ photo: 0, vecteur: require('../identifier/empreinte-vecteur').encoderVecteur(A.unitaire(A.graine(77))) }], modeleEmpreinte: A.modeleAnnonce() }, 'invalide');
        await garde('7e. neuf entrées (8 au plus) : « invalide » — la requête n\'est PAS refusée (200, la chaîne décide)', { empreintes: Array.from({ length: 9 }, (_, k) => A.entree(0, 3, k === 0)), modeleEmpreinte: A.modeleAnnonce() }, 'invalide');
        await garde('7f. deux entrées pour la même photo : « invalide »', { empreintes: [A.entree(0, 3), A.entree(0, 5)], modeleEmpreinte: A.modeleAnnonce() }, 'invalide');
        await garde('7g. un index de photo hors des imageUrls : « invalide »', { empreintes: [A.entree(4, 3)], modeleEmpreinte: A.modeleAnnonce() }, 'invalide');
        await garde('7h. `empreintes` qui n\'est pas un tableau : « invalide »', { empreintes: 'oui', modeleEmpreinte: A.modeleAnnonce() }, 'invalide');
        const deux = await jouer(sv, ch, { imageUrls: [IMAGE, IMAGE2], empreintes: [A.entree(1, 3), A.entree(0, 5)], modeleEmpreinte: A.modeleAnnonce() });
        H.v('7i. deux photos, deux vecteurs : UN seul est jugé (la photo 0, jeu-5 -> A) — promu A', [cartesDe(deux.j).statut, cartesDe(deux.j).carte && cartesDe(deux.j).carte.idProduct], ['identifiee', A.ID_A]);
        A.etat.vider();
        await garde('7j. pas d\'index chargé : « indisponible »', vec(3), 'indisponible');
        A.installerIndex();
    }
    // ── (8) le fournisseur est injectable, borné dans le temps, et ses pannes ne cassent rien
    {
        const ch = { mode: 'ambigue', ids: [A.ID_A, A.ID_B] };
        const leve = await appFabrique(cfgOn, { voisinsEmpreinte: async () => { throw new Error('index cassé'); } });
        const e2 = console.error; console.error = () => { };
        let o; try { o = await jouer(leve, ch, vec(3)); } finally { console.error = e2; }
        H.v('8a. le fournisseur LÈVE : la chaîne décide (a-trancher), « indisponible », rien de perdu', [o.r.statut, cartesDe(o.j).statut, o.j.empreinte, await essaisDe(o.i._id)], [200, 'a-trancher', { utilisee: false, code: 'indisponible' }, 2]);
        await leve.fermer();
        const jamais = await appFabrique(cfgOn, { voisinsEmpreinte: () => new Promise(() => { }), delaiVoisinsMs: 80 });
        const e3 = console.error; const lignes = []; console.error = (...x) => { lignes.push(x.join(' ')); };
        const t0 = Date.now(); let p; try { p = await jouer(jamais, ch, vec(3)); } finally { console.error = e3; }
        H.vrai(`8b. un fournisseur qui ne répond jamais : la réponse arrive (borne injectée de 80 ms, ${Date.now() - t0} ms), « indisponible »`, p.r.statut === 200 && cartesDe(p.j).statut === 'a-trancher' && p.j.empreinte.code === 'indisponible' && Date.now() - t0 < 5000);
        H.vrai('8c. le journal ne porte que le code (VOISINS_DELAI), aucune image ni aucun vecteur', lignes.some(l => /VOISINS_DELAI/.test(l)) && !lignes.some(l => l.includes(IMAGE) || l.includes(A.entree(0, 3).vecteur)));
        await jamais.fermer();
        const muet = await appFabrique(cfgOn, { voisinsEmpreinte: async () => ({ ok: false, code: 'muette' }) });
        const m = await jouer(muet, ch, vec(3));
        H.v('8d. un code « muette » : rendu tel quel', m.j.empreinte, { utilisee: false, code: 'muette' });
        await muet.fermer();
        const inconnu = await appFabrique(cfgOn, { voisinsEmpreinte: async () => ({ ok: false, code: 'n-importe-quoi' }) });
        const k = await jouer(inconnu, ch, vec(3));
        H.v('8e. un code hors de la liste fermée : jamais servi tel quel — « indisponible »', k.j.empreinte, { utilisee: false, code: 'indisponible' });
        await inconnu.fermer();
        const faux = await appFabrique(cfgOn, { voisinsEmpreinte: async () => ({ ok: true, ligne: { top: [['banc/jeu-3.webp', 0.9], ['banc/jeu-9.webp', 0.1]], essai: 0 }, nEssais: 1, mesures: {}, contexteG: null, seuils: {} }) });
        const e4 = console.error; console.error = () => { }; let f; try { f = await jouer(faux, ch, vec(3)); } finally { console.error = e4; }
        H.v('8f. un fournisseur qui rend des voisins SANS contexte G : la règle lève, la chaîne décide, « indisponible »', [cartesDe(f.j).statut, f.j.empreinte], ['a-trancher', { utilisee: false, code: 'indisponible' }]);
        await faux.fermer();
    }
    // ── (8 bis) LA CARTE REDRESSÉE : les pixels de la garde des zones. Sans carte autorisée, G se tait ; une carte FORGÉE ne produit jamais un sûr que la lecture de la photo contredit.
    {
        const ch = { mode: 'ambigue', ids: [A.ID_A, A.ID_B] };
        const C = A.cartes();
        const zones = A.fausseZones();
        const svZ = await appFabrique(cfgOn, { zonesEmpreinte: zones, scanEmpreinte: A.scanBanc });
        const requete = (i, carte) => ({ empreintes: [A.entree(0, i, true, carte)], modeleEmpreinte: A.modeleAnnonce() });
        const sansEffet = async (nom, req) => { const o = await jouer(svZ, ch, req); H.v(nom, [o.r.statut, cartesDe(o.j).statut, o.j.empreinte, await essaisDe(o.i._id)], [200, 'a-trancher', { utilisee: false, code: 'muette' }, 2]); return o; };
        const honn = await jouer(svZ, ch, requete(10));
        H.v('8bis-a. carte honnête, jumeaux jeu-10 / jeu-11 : la garde des zones tranche sur la carte — identifiee B (jeu-10), facturation affirmee', [cartesDe(honn.j).statut, cartesDe(honn.j).carte && cartesDe(honn.j).carte.idProduct, honn.j.empreinte, honn.j.facturation.motif], ['identifiee', A.ID_B, { utilisee: true, code: null }, 'affirmee']);
        H.vrai('8bis-b. … et la photo redressée donnée aux zones est EXACTEMENT la carte jointe (empreinte de ses pixels), jamais autre chose', zones.appels.filter(a => a[0] === 'photo').every(a => a[1] === C.SHA_CARTE));
        // sans carte, ou une carte que le serveur n'autorise pas : G se tait, même pour un vecteur parfait
        await sansEffet('8bis-c. entrée SANS carte : G se tait (« muette »), la question de la chaîne reste, rien n\'est perdu', requete(10, false));
        await sansEffet('8bis-d. carte qui n\'est pas un JPEG : « muette »', requete(10, Buffer.from('pas une image').toString('base64')));
        await sansEffet('8bis-e. carte d\'une autre taille (419 × 587) : « muette »', requete(10, (await A.jpeg(419, 587, 5)).toString('base64')));
        await sansEffet('8bis-f. carte de plus de 200 Ko : « muette »', requete(10, (await A.jpeg(420, 587, 5, 100)).toString('base64')));
        await sansEffet('8bis-g. carte démesurée (> 273 068 caractères) : « muette », la requête n\'est pas refusée', requete(10, 'A'.repeat(300000)));
        const autreIndex = await jouer(svZ, ch, { empreintes: [A.entree(0, 10, true, false), A.entree(1, 10, true)], imageUrls: [IMAGE, IMAGE2], modeleEmpreinte: A.modeleAnnonce() });
        H.v('8bis-h. la carte de la photo 1 ne sert pas au vecteur de la photo 0 : « muette »', [cartesDe(autreIndex.j).statut, autreIndex.j.empreinte], ['a-trancher', { utilisee: false, code: 'muette' }]);
        // 🔑 la carte FORGÉE : les pixels du jumeau qui contredit la lecture (jeu-11 → X, numéro 002), avec le VRAI vecteur de la photo (jeu-10)
        const forg = await jouer(svZ, ch, requete(10, C.CARTE_FORGEE));
        H.v('8bis-i. 🔑 carte forgée (les zones donnent la victoire à jeu-11, produit X, numéro 002) : G affirme X, la garde (2) le retire — la question de la chaîne reste, JAMAIS un sûr que la lecture contredit', [cartesDe(forg.j).statut, cartesDe(forg.j).candidats.map(x => x.idProduct).sort(), (await analyseDe(forg.j)).desaccordRegleG.retenue], ['a-trancher', [A.ID_A, A.ID_B], 'garde-contradiction']);
        H.vrai('8bis-j. … la preuve que la carte forgée a bien été JUGÉE comme autre chose (les zones ont vu l\'empreinte de pixels de la forgée)', zones.appels.some(a => a[1] === 'forgee'));
        // contre-épreuve (la variante du banc qui affirme l'inverse) : SANS lecture de la chaîne, la garde (2) ne peut pas retirer X — la même carte forgée obtient alors X. Le banc 8bis-i peut donc ÉCHOUER ; il réussit grâce à la lecture.
        appelsCrochet = [];
        const sansLecture = await jouer(svZ, { mode: 'ambigue-sans-lecture', ids: [A.ID_A, A.ID_B] }, requete(10, C.CARTE_FORGEE));
        const sl = await analyseDe(sansLecture.j);
        H.v('8bis-k. contre-épreuve : la même carte forgée contre une chaîne SANS lecture obtient X (identifiee) — pour elle seule, lecture non concordante', [cartesDe(sansLecture.j).carte && cartesDe(sansLecture.j).carte.idProduct, sl.empreinteExtension.lectureConcordante], [A.ID_X, false]);
        H.v('8bis-l. … et rien de partagé : sans lecture concordante le banc réel n\'est pas appelé', appelsCrochet, []);        // entre deux jumeaux qui CONCORDENT avec la lecture, la carte choisit — pour l'utilisateur seul
        appelsCrochet = [];
        const c12 = await jouer(svZ, ch, requete(12, C.CARTE)), c12f = await jouer(svZ, ch, requete(12, C.CARTE_FORGEE));
        H.v('8bis-m. jumeaux jeu-12 (P) / jeu-13 (A), tous deux concordants : la carte honnête donne P, la carte forgée donne A — la limite connue, pour le seul utilisateur qui la forge', [cartesDe(c12.j).carte.idProduct, cartesDe(c12f.j).carte.idProduct], [A.ID_P, A.ID_A]);
        await svZ.fermer();
    }    // ── (9) la panne de la chaîne : G n'est pas consultée, aucun champ `empreinte`
    {
        chaine = { mode: 'exception-absente', ids: [] };
        const x = await inst(3); const r = await poster(sv.url, x.jeton, corps(vec(3)));
        H.v('9. panne de la chaîne : 500 SERVEUR remboursée, aucun champ `empreinte`', [r.statut, r.json.erreur.code, 'empreinte' in r.json, await essaisDe(x.i._id)], [500, 'SERVEUR', false, 3]);
    }
    crochet.apresIdentifier = origCrochet;
    await sv.fermer();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    A.etat.vider();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
