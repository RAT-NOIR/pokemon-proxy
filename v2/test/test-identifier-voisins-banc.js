'use strict';
// JUGE À CINQ — la CAPTURE des voisins du modèle à l'identification : pour le compte de MESURE (`comptes.banc: true`) seulement, avec un vecteur d'extension valide, la ligne `analyses` porte `voisinsModele` (les produits
// des visuels des 10 voisins de l'index, dans l'ordre des voisins, dédoublonnés, 20 au plus) — y compris quand la chaîne rend « introuvable ». INTERNE : jamais servi ; aucun autre compte n'en a ; aucune influence sur la
// décision, la réponse, le débit ni le remboursement (mêmes réponses, mêmes mouvements pour un compte ordinaire et un compte de mesure). Base EN MÉMOIRE, chaîne FABRIQUÉE, index FABRIQUÉ : aucun réseau, aucune dépense.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const VN = require('../identifier/voisins-modele');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfgOn = lireConfig({ ...A.ENV_EMPREINTE });
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch', V2_MODELE_EMPREINTE_ID: A.MODELE.id, V2_MODELE_EMPREINTE_SHA256: A.MODELE.sha256 });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-jc-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
const VB = require('./_visuels-banc'); const VIS = [];
// la clé de visuel de chaque produit : A et B partagent le visuel jeu-5 (un visuel, deux produits) ; P est jeu-3 ; X est jeu-4
const CLE_DE = { [A.ID_P]: 'banc/jeu-3.webp', [A.ID_X]: 'banc/jeu-4.webp', [A.ID_A]: 'banc/jeu-5.webp', [A.ID_B]: 'banc/jeu-5.webp' };
const semer = async (id, numero = '001') => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { numero, idMetacard: 990100 + (id % 100), grande: { cle: CLE_DE[id], w: 600, h: 840 } }));
};
const sansVolatil = j => { const { scanId, solde, offre, ...x } = JSON.parse(JSON.stringify(j)); void scanId; void solde; void offre; if (x.facturation) delete x.facturation.poche; return x; };

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-identifier-voisins-banc.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [A.ID_A, A.ID_B, A.ID_P]) await semer(id, '001');
    await semer(A.ID_X, '002');
    const version = VB.installer(VIS, [], { emprunts: true });

    // ════════════ 1. le module pur : voisins → produits des visuels, dans l'ordre, dédoublonnés, 20 au plus
    {
        A.installerIndex();
        const vec = i => ({ empreintes: { rejet: null, modele: A.modeleAnnonce(), entrees: [{ photo: 0, vecteur: A.entree(0, i).vecteur, redressee: false, carte: null }] } });
        const lire = (i, o = {}) => VN.voisinsDuModele({ cfg: cfgOn, entree: vec(i), version, ...o });
        const p3 = lire(3);
        H.v('1a. le voisin le plus proche de la ligne jeu-3 est le produit du visuel jeu-3', p3 && p3[0], A.ID_P);
        const p5 = lire(5);
        H.v('1b. un visuel partagé par deux produits : les deux, dans l\'ordre du visuel, dédoublonnés', p5 && p5.slice(0, 2).sort((a, b) => a - b), [A.ID_A, A.ID_B]);
        H.v('1c. aucun doublon, entiers seulement, 20 au plus', p5 && new Set(p5).size === p5.length && p5.every(Number.isSafeInteger) && p5.length <= 20, true);
        const sans = VN.voisinsDuModele({ cfg: cfgOn, entree: { empreintes: null }, version });
        H.v('1d. sans enveloppe valide : null', sans, null);
        H.v('1e. un autre modèle annoncé : null (le vecteur n\'est pas celui de l\'index)', VN.voisinsDuModele({ cfg: cfgOn, entree: { empreintes: { ...vec(3).empreintes, modele: { id: 'autre', sha256: 'a'.repeat(64) } } }, version }), null);
        H.v('1f. drapeau V2_EMPREINTE_EXTENSION éteint : null', VN.voisinsDuModele({ cfg: cfgOff, entree: vec(3), version }), null);
        H.v('1g. un index qui lève : null, jamais d\'exception', VN.voisinsDuModele({ cfg: cfgOn, entree: vec(3), version, etat: { courante: () => { throw new Error('x'); } } }), null);
        // 20 au plus : une version où chaque visuel porte plusieurs produits
        const gros = []; for (let i = 0; i < 200; i++) for (let k = 0; k < 5; k++) gros.push(VB.doc(700000 + i * 5 + k, { grande: { cle: `banc/jeu-${i}.webp`, w: 600, h: 840 } }));
        const vGros = VB.construire(gros);
        const l20 = VN.voisinsDuModele({ cfg: cfgOn, entree: vec(3), version: vGros });
        H.v('1h. 5 produits par visuel × 10 voisins = 50 candidats : 20 retenus, dans l\'ordre des voisins', [l20.length, l20.slice(0, 5)], [20, [700015, 700016, 700017, 700018, 700019]]);
    }

    // ════════════ 2. la route
    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    void registre;
    const { dansUnScan } = require('../../sources');
    const { assembler } = require('../index');
    const lecture = (id, o = {}) => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false, ...o },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    let chaine = null;
    const chaineFabriquee = async (req, res) => {
        const { mode, ids } = chaine;
        if (mode === 'affirmee') return res.json({ ...lecture(ids[0]), scanId: String(req.scanIdImpose) });
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        throw new Error(`mode inconnu ${mode}`);
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgOn, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee }));
    const sv = await H.serveur(app);
    const crochet = require('../banc/crochet'); const origCrochet = crochet.apresIdentifier; crochet.apresIdentifier = () => { };
    let nCpt = 0;
    // un porteur : 'banc' (compte de mesure), 'ordinaire' (compte), 'seule' (installation sans compte)
    const porteur = async genre => {
        const jeton = J.genererJeton(); let compteId;
        if (genre !== 'seule') {
            nCpt++; const c = Object.assign(M.nouveauCompte({ email: `jc${nCpt}-${Date.now()}@x.fr`, emailCle: `jc${nCpt}-${Date.now()}@x.fr`, motDePasse: {} }), { verifie: true }, genre === 'banc' ? { banc: true } : {});
            await db.col('comptes').insertOne(c); compteId = c._id;
        }
        const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compteId ? { compteId } : {});
        await db.col('installations').insertOne(i); return { i, jeton, compteId };
    };
    const jouer = async (genre, c, requete) => { chaine = c; const x = await porteur(genre); const r = await H.appel(sv.url, '/api/identifier', { methode: 'POST', corps: corps(requete), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}`, 'idempotency-key': cle() } }); await attendre(60); return { ...x, r, j: r.json || {} }; };
    const analyseDe = j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
    const mouv = async x => (await raw('mouvements').find(x.compteId ? { compteId: x.compteId } : { installationId: x.i._id }).sort({ _id: 1 }).toArray()).map(m => [m.type, m.delta, m.etat]);
    const vec = (i, redressee = false) => ({ empreintes: [A.entree(0, i, redressee)], modeleEmpreinte: A.modeleAnnonce() });
    await A.preparer();

    {   // le compte de mesure, chaîne qui affirme
        const b = await jouer('banc', { mode: 'affirmee', ids: [A.ID_A] }, vec(5));
        const an = await analyseDe(b.j);
        H.v('2a. 🔑 compte de mesure + vecteur valide : `analyses.voisinsModele` porte les produits des visuels voisins (A et B, le visuel jeu-5, en tête)', [b.r.statut, Array.isArray(an.voisinsModele), an.voisinsModele && an.voisinsModele.slice(0, 2).sort((x, y) => x - y)], [200, true, [A.ID_A, A.ID_B]]);
        H.v('2b. … la ligne garde `banc: true` et ses champs d\'avant', [an.banc, 'versionChaine' in an, Array.isArray(an.cartes)], [true, true, true]);
        H.v('2c. 🔑 INTERNE : la réponse ne porte pas le champ, nulle part', JSON.stringify(b.j).includes('voisinsModele'), false);
    }
    {   // introuvable : la chaîne rembourse, G se tait, les voisins sont pris quand même
        const b = await jouer('banc', { mode: 'introuvable', ids: [] }, vec(3));
        const an = await analyseDe(b.j);
        H.v('2d. 🔑 la chaîne rend INTROUVABLE : la réponse est celle d\'avant (introuvable, remboursée) ET les voisins sont capturés (le produit du visuel jeu-3 en tête)', [b.j.analyse.cartes[0].statut, b.j.facturation.rembourse, an.voisinsModele && an.voisinsModele[0]], ['introuvable', true, A.ID_P]);
    }
    {   // les autres comptes : aucun champ
        const o = await jouer('ordinaire', { mode: 'affirmee', ids: [A.ID_A] }, vec(5)), s = await jouer('seule', { mode: 'affirmee', ids: [A.ID_A] }, vec(5));
        H.v('2e. 🔑 un compte ORDINAIRE avec le même vecteur : aucun `voisinsModele`', 'voisinsModele' in (await analyseDe(o.j)), false);
        H.v('2f. 🔑 une installation SANS compte : aucun `voisinsModele`', 'voisinsModele' in (await analyseDe(s.j)), false);
    }
    {   // sans vecteur / vecteur inutilisable : pas de champ
        const sansV = await jouer('banc', { mode: 'affirmee', ids: [A.ID_A] }, {});
        H.v('2g. compte de mesure SANS empreintes : aucun champ', 'voisinsModele' in (await analyseDe(sansV.j)), false);
        const autreModele = await jouer('banc', { mode: 'affirmee', ids: [A.ID_A] }, { empreintes: [A.entree(0, 5)], modeleEmpreinte: { id: A.MODELE.id, sha256: 'd'.repeat(64) } });
        H.v('2h. compte de mesure, AUTRE version du modèle : aucun champ', 'voisinsModele' in (await analyseDe(autreModele.j)), false);
        const gros = await jouer('banc', { mode: 'affirmee', ids: [A.ID_A] }, { empreintes: [{ photo: 0, vecteur: require('../identifier/empreinte-vecteur').encoderVecteur(Float32Array.from(A.ligneDe(5)).map(x => x * 1.5)) }], modeleEmpreinte: A.modeleAnnonce() });
        H.v('2i. compte de mesure, vecteur de norme 1,5 (invalide) : aucun champ', 'voisinsModele' in (await analyseDe(gros.j)), false);
    }
    {   // aucune influence : mêmes réponses, mêmes mouvements pour un compte de mesure et un compte ordinaire
        for (const [nom, c, v] of [['affirmée', { mode: 'affirmee', ids: [A.ID_A] }, vec(5)], ['introuvable', { mode: 'introuvable', ids: [] }, vec(3)], ['affirmée, désaccord avec G', { mode: 'affirmee', ids: [A.ID_A] }, vec(3)]]) {
            const b = await jouer('banc', c, v), o = await jouer('ordinaire', c, v);
            H.v(`2j. 🔑 ${nom} : la réponse est la MÊME octet pour octet (hors scanId, solde, offre) pour le compte de mesure et le compte ordinaire`, JSON.stringify(sansVolatil(b.j)), JSON.stringify(sansVolatil(o.j)));
            H.v(`2k. 🔑 ${nom} : les mouvements d'argent sont les mêmes (type, delta, état)`, JSON.stringify(await mouv(b)), JSON.stringify(await mouv(o)));
        }
    }
    crochet.apresIdentifier = origCrochet;
    await sv.fermer();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    A.etat.vider();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
