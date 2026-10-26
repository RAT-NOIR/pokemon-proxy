'use strict';
// Banc MODELE-VISUEL-API (6) — L'ISOLEMENT ENTRE UTILISATEURS : un vecteur FORGÉ par A ne change le résultat d'AUCUN AUTRE utilisateur. C'est la condition posée pour GARDER les promotions (sinon : la règle restrictive).
// État RÉEL (la base en mémoire du banc, le serveur réel de la route, la chaîne héritée FABRIQUÉE, l'index fabriqué de _empreinte-aide.js, le crochet du banc réel RÉEL avec un faux banc qui espionne ses écritures).
//   · Deux mondes : W0, B scanne l'annonce L sans vecteur ; W1, A envoie sur la MÊME annonce L un vecteur forgé (qui fait PROMOUVOIR un produit), puis B scanne L sans vecteur. Le résultat de B doit être identique, octet
//     pour octet (scanId, solde, offre mis à part), et sa ligne `analyses` aussi (aux champs propres au scan près).
//   · Tout ce que la requête de A a écrit dans la base est inventorié : chaque document nouveau ou changé doit désigner A (son installation ou son scan) — sinon c'est une donnée PARTAGÉE, et elle doit être la même que
//     celle d'un scan de A SANS vecteur (alors le vecteur n'y est pour rien).
//   · Une promotion par G sans lecture concordante n'écrit RIEN de partagé : le faux banc ne reçoit aucun appel.
//   RED vu : le banc a d'abord été écrit contre une route qui laissait passer le crochet du banc pour une promotion sans lecture concordante (voir CHANGEMENTS, lot MODELE-VISUEL-API) ; la contre-épreuve plus bas rejoue l'assertion
//   avec la garde de la route retirée (le crochet est appelé directement) et exige que l'inventaire la voie.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;   // l'annonce L
const cfgOn = lireConfig(A.ENV_EMPREINTE);
const ORIGINE = cfgOn.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.6.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-iso-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const TITRE = 'Tropius PBL 001 annonce L';
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: TITRE, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', consentementBanc: { version: '2026-10-07-v1', le: new Date().toISOString(), jeton: 'jeton-de-consentement-0123456789' }, ...o });
async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const poster = (url, jeton, c) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
const VB = require('./_visuels-banc'); const VIS = [];
const semer = async (id, numero = '001') => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { numero, idMetacard: 990100 + (id % 100) }));
};
const sansVolatil = j => { const { scanId, solde, offre, ...x } = JSON.parse(JSON.stringify(j)); void scanId; void solde; void offre; if (x.facturation) delete x.facturation.poche; return x; };
const empreinteDe = s => require('crypto').createHash('sha1').update(s).digest('hex').slice(0, 12);       // les assertions comparent des empreintes courtes : un échec n'imprime pas des pages de JSON
const sansPropre = a => { if (!a) return a; const { _id, creeLe, expireLe, porteur, durees, ...x } = JSON.parse(JSON.stringify(a)); void _id; void creeLe; void expireLe; void porteur; void durees; return x; };       // TEMPS-ETAPES : `durees` (les durées du scan, en ms) est propre au scan, comme l'heure

// ── l'inventaire de la base : pour chaque collection, chaque document sous la forme d'une chaîne canonique
async function photographier() {
    const o = {};
    for (const c of await mongoose.connection.db.listCollections().toArray()) {
        const docs = await raw(c.name).find({}).toArray();
        o[c.name] = new Map(docs.map(d => [String(d._id), JSON.stringify(d)]));
    }
    return o;
}
/** Les documents NOUVEAUX ou CHANGÉS entre deux photographies, hors de ceux qui désignent l'acteur (son installation ou son scan). */
function partages(avant, apres, signes) {
    const sortie = [];
    for (const [nom, docs] of Object.entries(apres)) {
        const av = avant[nom] || new Map();
        for (const [id, s] of docs) {
            if (av.get(id) === s) continue;
            if (signes.some(x => s.includes(x) || id.includes(x))) continue;
            sortie.push(`${nom}:${id.length > 24 ? id.slice(0, 24) : id}`);
        }
    }
    return sortie.sort();
}

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-empreinte-isolement.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [A.ID_A, A.ID_B, A.ID_P]) await semer(id, '001');
    VB.installer(VIS, [], { emprunts: true });
    await A.preparer();
    A.installerIndex();

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources');
    const { assembler } = require('../index');
    const lecture = (id, o = {}) => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false, ...o },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    let chaine = { mode: 'ambigue', ids: [A.ID_A, A.ID_B] };
    // la chaîne est DÉTERMINISTE pour l'annonce L : elle lit toujours la même chose — c'est ce qui rend « le monde sans A » comparable
    const chaineFabriquee = async (req, res) => {
        const { mode, ids } = chaine;
        await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
        const l = lecture(ids[0], mode === 'ambigue-sans-lecture' ? { numero: null, total: null, setCode: null } : {});
        return res.json({ ...l, scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...l.carte, ambigu: true }, candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
    };
    // le crochet du banc RÉEL : détection fabriquée + faux banc qui espionne. Aucun octet n'est écrit ailleurs que dans le tableau.
    const ecrituresBanc = [];
    registre.fournir('banc', { apresVerdict: async o => { ecrituresBanc.push({ issue: o.issue, idProduct: o.idProduct }); return { ok: true }; }, apresReponse: async () => { }, apresAbandon: async () => { } });
    const zonesFausses = A.fausseZones();
    const deps = { zonesEmpreinte: zonesFausses, scanEmpreinte: A.scanBanc, jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee, detection: async () => ({ imageRedressee: Buffer.from('image-redressee-du-banc'), detectionSure: true, versionModele: 'banc' }) };
    const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));   // la limite de index.js quand V2_EMPREINTE_EXTENSION=1 (test-corps-identifier-empreinte.js) app.use((q, s, n) => dansUnScan(n));
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgOn, deps));
    const sv = await H.serveur(app);
    // le crochet exige un porteur de la surface « extension » : l'installation par jeton Bearer l'est
    const jouer = async (c, requete = {}) => { chaine = c; const x = await inst(3); const r = await poster(sv.url, x.jeton, corps(requete)); await attendre(120); return { ...x, r, j: r.json || {} }; };
    const analyseDe = j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
    const L = { mode: 'ambigue', ids: [A.ID_A, A.ID_B] };
    const forge = { empreintes: [A.entree(0, 3, false)], modeleEmpreinte: A.modeleAnnonce() };       // un vecteur qui n'est PAS celui de la photo de L : l'attaquant choisit le produit P

    // ── W0 : B scanne L sans vecteur, personne n'a rien envoyé avant
    ecrituresBanc.length = 0;
    const b0 = await jouer(L);
    const a0 = sansPropre(await analyseDe(b0.j));
    H.v('0. contrôle du banc : sans vecteur, la chaîne pose une question [A, B] (le monde sans A), le crochet du banc réel est appelé (consentement valide, surface extension) pour cette question', [b0.j.analyse.statut, b0.j.analyse.cartes[0].candidats.map(c => c.idProduct).sort(), ecrituresBanc.map(e => e.issue)], ['a-trancher', [A.ID_A, A.ID_B], ['question']]);

    // ── W1 : A forge, puis B scanne L sans vecteur
    ecrituresBanc.length = 0;
    const avant = await photographier();
    const a = await jouer(L, forge);
    const apres = await photographier();
    H.v('1a. le vecteur forgé de A PROMEUT P (hors des choix de la chaîne) — la menace est réelle, A obtient un sûr', [a.j.analyse.statut, a.j.analyse.cartes[0].carte && a.j.analyse.cartes[0].carte.idProduct, a.j.empreinte], ['identifiee', A.ID_P, { utilisee: true, code: null }]);
    H.v('1b. 🔑 TOUR 2 (I1) : la promotion de A, même à lecture concordante (numéro, total, code lus = ceux de P), n\'écrit RIEN dans le banc partagé : promotion par G ⇒ 0 écriture partagée', ecrituresBanc.map(e => e.idProduct), []);
    const signesA = [String(a.i._id), a.j.scanId];
    const partagesForge = partages(avant, apres, signesA);
    // la référence : A scanne la MÊME annonce SANS vecteur — ce que la route écrit de partagé quand le vecteur n'y est pour rien
    const avantRef = await photographier();
    const aRef = await jouer(L);
    const apresRef = await photographier();
    const partagesRef = partages(avantRef, apresRef, [String(aRef.i._id), aRef.j.scanId]);
    H.v('2. 🔑 INVENTAIRE : tout document nouveau ou changé par la requête forgée de A qui ne désigne pas A est identique à ce que change un scan de A SANS vecteur (ici : rien de partagé n\'est propre au vecteur)', partagesForge, partagesRef);
    console.log(`   (dénominateur : ${Object.keys(apres).length} collections photographiées ; documents partagés changés par la requête forgée : ${partagesForge.length} ; par la requête de référence : ${partagesRef.length} ; sur ${[...Object.values(apres)].reduce((s, m) => s + m.size, 0)} documents)`);
    const b1 = await jouer(L);
    const a1 = sansPropre(await analyseDe(b1.j));
    H.v('3a. 🔑 B scanne L SANS vecteur après le vecteur forgé de A : sa réponse est identique à celle du monde où A n\'a rien envoyé (octet pour octet, scanId, solde, offre mis à part)', empreinteDe(JSON.stringify(sansVolatil(b1.j))), empreinteDe(JSON.stringify(sansVolatil(b0.j))));
    H.v('3b. … et sa ligne `analyses` (aux champs propres au scan près)', empreinteDe(JSON.stringify(a1)), empreinteDe(JSON.stringify(a0)));
    H.vrai('3c. … aucune trace du vecteur de A chez B : ni `empreinte` dans la réponse, ni `empreinteExtension` dans analyses', !('empreinte' in b1.j) && !a1.empreinteExtension);

    // ── promotion SANS lecture concordante : rien de partagé
    ecrituresBanc.length = 0;
    const av2 = await photographier();
    const s = await jouer({ mode: 'ambigue-sans-lecture', ids: [A.ID_A, A.ID_B] }, forge);
    const ap2 = await photographier();
    const ans = await analyseDe(s.j);
    H.v('4a. promotion par G sans lecture concordante (la chaîne n\'a lu ni numéro, ni total, ni code) : A obtient son sûr (promotion, lecture non concordante)', [s.j.analyse.statut, ans.empreinteExtension.promotion, ans.empreinteExtension.lectureConcordante], ['identifiee', true, false]);
    H.v('4b. 🔑 … et le faux banc ne reçoit AUCUNE écriture : rien de partagé', ecrituresBanc, []);
    H.vrai('4c. … et l\'inventaire ne montre aucun document partagé de plus que celui d\'un scan sans vecteur', JSON.stringify(partages(av2, ap2, [String(s.i._id), s.j.scanId])) === JSON.stringify(partagesRef));
    // la contre-épreuve de la garde : si la route laissait passer le crochet, le faux banc recevrait l'écriture — le banc SAIT donc dire non
    const crochet = require('../banc/crochet'); ecrituresBanc.length = 0;
    crochet.apresIdentifier({ cfg: cfgOn, deps, req: { v2: { porteur: { surface: 'extension', type: 'installation', id: s.i._id, installation: s.i } }, body: corps(forge), entree: { imageUrls: [IMAGE] } }, scanId: s.j.scanId, analyse: s.j.analyse });
    await attendre(120);
    H.v('4d. contre-épreuve : le crochet appelé DIRECTEMENT (sans la garde de la route) écrirait au faux banc — l\'assertion 4b peut donc échouer', ecrituresBanc.map(e => e.idProduct), [A.ID_P]);

    // ── un vecteur forgé qui fait DOUTER d'un sûr : il ne touche que A
    ecrituresBanc.length = 0;
    const d = await jouer({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, { empreintes: [A.entree(0, 8, false)], modeleEmpreinte: A.modeleAnnonce() });
    H.v('5a. un vecteur forgé qui rend G « question » (jeu-8) : la question de la chaîne reste pour A, le banc réel est appelé comme sans vecteur (le vecteur n\'a rien changé)', [d.j.analyse.statut, ecrituresBanc.map(e => e.issue)], ['a-trancher', ['question']]);
    const b2 = await jouer(L);
    H.v('5b. B, après tous les vecteurs forgés d\'A : toujours la réponse du monde sans A', empreinteDe(JSON.stringify(sansVolatil(b2.j))), empreinteDe(JSON.stringify(sansVolatil(b0.j))));
    H.vrai('6. aucun état de processus du module du vecteur n\'est partagé : l\'index est en lecture seule (gelé), et la recherche ne retient rien du vecteur', Object.isFrozen(A.etat.courante()) && (() => { const i = A.etat.courante().index; const k = Object.keys(i).sort().join(); return k === 'cles,contexteG,mat16,n,octetsMatrice'; })());

    // ── LA CARTE FORGÉE : le VRAI vecteur de la photo (jumeaux jeu-12 / jeu-13) et les pixels de l'AUTRE jumeau. A choisit le jumeau pour lui seul ; B, qui scanne L sans rien, ne le voit jamais.
    {
        const C = A.cartes();
        ecrituresBanc.length = 0; zonesFausses.appels.length = 0;
        const avF = await photographier();
        const honnete = await jouer(L, { empreintes: [A.entree(0, 12, true)], modeleEmpreinte: A.modeleAnnonce() });
        H.v('6a. carte honnête, vrai vecteur de jeu-12 : A obtient P (le jumeau que montrent les pixels)', honnete.j.analyse.cartes[0].carte && honnete.j.analyse.cartes[0].carte.idProduct, A.ID_P);
        const forgee = await jouer(L, { empreintes: [A.entree(0, 12, true, C.CARTE_FORGEE)], modeleEmpreinte: A.modeleAnnonce() });
        const apF = await photographier();
        H.v('6b. carte FORGÉE (les pixels de l\'autre jumeau), même vrai vecteur : A obtient A (l\'autre jumeau) — la limite connue : la carte départage les jumeaux, pour A seul', forgee.j.analyse.cartes[0].carte && forgee.j.analyse.cartes[0].carte.idProduct, A.ID_A);
        H.vrai('6c. … les zones ont bien vu deux cartes DIFFÉRENTES (empreintes de pixels honnête et forgée)', new Set(zonesFausses.appels.filter(a => a[0] === 'photo').map(a => a[1])).size === 2 && zonesFausses.appels.some(a => a[1] === 'forgee'));
        const partF = partages(avF, apF, [String(honnete.i._id), honnete.j.scanId, String(forgee.i._id), forgee.j.scanId]);
        H.v('6d. 🔑 inventaire : aucun document partagé nouveau ou changé par les requêtes à carte (honnête ou forgée) qui ne désigne pas leur auteur', partF, partagesRef);
        const bC = await jouer(L);
        H.v('6e. 🔑 B scanne L SANS rien après la carte forgée d\'A : la réponse du monde sans A (octet pour octet)', empreinteDe(JSON.stringify(sansVolatil(bC.j))), empreinteDe(JSON.stringify(sansVolatil(b0.j))));
        H.vrai('6f. … sa ligne `analyses` aussi, et aucune trace de la carte ou du vecteur d\'A', empreinteDe(JSON.stringify(sansPropre(await analyseDe(bC.j)))) === empreinteDe(JSON.stringify(a0)) && !('empreinte' in bC.j));
        // un utilisateur C qui envoie SA propre carte honnête n'est pas touché par la carte forgée d'A : le résultat de C est celui du monde sans A
        const cH = await jouer(L, { empreintes: [A.entree(0, 12, true)], modeleEmpreinte: A.modeleAnnonce() });
        H.v('6g. C, avec sa carte honnête après la carte forgée d\'A : P, comme A honnête — aucune mémoire de la carte forgée', cH.j.analyse.cartes[0].carte && cH.j.analyse.cartes[0].carte.idProduct, A.ID_P);
    }
    await sv.fermer();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    A.etat.vider();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
