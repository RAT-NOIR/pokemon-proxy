'use strict';
// Banc ETAT-VENDEUR (décision de l'utilisateur, 2026-10-18) — « l'état d'une carte ne vient JAMAIS du vendeur ».
// `vintedEtat` est REÇU et JOURNALISÉ ; il n'entre ni dans l'état retenu, ni dans le prix, ni dans le verdict, ni dans aucune décision.
// Méthode : la MÊME requête (même photo, même lecture rejouée du modèle) avec `vintedEtat` absent, puis « Neuf avec étiquette », « Très bon état », « Bon état », « Satisfaisant »
// et une chaîne inconnue, par les VRAIES routes d'un index.js réel (serveur ENFANT, faux réseau : le modèle est rejoué, aucun appel sortant, base EN MÉMOIRE du banc).
// La réponse ENTIÈRE doit être strictement identique, privée seulement de l'ÉCHO du texte du vendeur (`declare` / `declareVendeur` / `declareCardmarket`) et de l'identifiant du scan.
// Trois lectures du modèle, fabriquées par ce banc sur la lecture enregistrée de la charge « occidentale » (seuls etatEstime / etatConfiance changent) :
//   · NM, confiance haute   : le vendeur déclare PIRE que le modèle (Très bon état, Bon état, Satisfaisant) — l'ancienne règle « le pire des deux » baissait l'état retenu ;
//   · GD, confiance haute   : le vendeur déclare MIEUX que le modèle — l'état retenu restait celui du modèle ;
//   · EX, confiance BASSE   : le modèle n'a pas d'avis retenu (la porte de confiance) — l'ancienne règle prenait alors l'état du vendeur seul ; l'état retenu doit valoir null.
// Routes : /api/identifier v2 (contrat 2, Bearer), /api/identifier SANS contrat 2 (la route héritée d'index.js que la 1.0.5 appelle), et le lot (crochet `identifierLot`, en processus).
const H = require('./_harnais');
const path = require('path');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const VB = require('./_visuels-banc'); const VIS = new Map();
const { lireConfig } = require('../config');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const ORIGINE = lireConfig({ MONGODB_BASE: 'test_scratch', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1' }).origines.extension;
const raw = n => mongoose.connection.db.collection(n);
let nIp = 0, nCle = 0;
const ip = () => { nIp++; return { 'x-forwarded-for': `10.12.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
const cle = () => `banc-ev-${Date.now().toString(36)}-${++nCle}`;

const VENDEURS = [
    ['absent', undefined],
    ['Neuf avec étiquette', 'Neuf avec étiquette'],
    ['Très bon état', 'Très bon état'],
    ['Bon état', 'Bon état'],
    ['Satisfaisant', 'Satisfaisant'],
    ['chaîne inconnue', 'Etat que personne ne connait ZZ-42'],
];
const LECTURES = [
    ['NM haute (vendeur pire)', 'NM', 'haute', 'NM'],
    ['GD haute (vendeur mieux)', 'GD', 'haute', 'GD'],
    ['EX basse (aucun avis retenu)', 'EX', 'basse', null],
];

// la réponse ENTIÈRE, privée de l'écho du vendeur et de l'identifiant du scan (rien d'autre n'est retiré)
const SANS_ECHO = new Set(['scanId', 'declare', 'declareVendeur', 'declareCardmarket']);
function nettoyer(x) {
    if (Array.isArray(x)) return x.map(nettoyer);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) if (!SANS_ECHO.has(k)) o[k] = nettoyer(x[k]); return o; }
    return typeof x === 'string' ? x.replace(/[0-9a-f]{24}/g, '<id>') : x;
}
const ID_A = 895789, ID_B = 895790, EXP = 990001;
async function semer() {
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante] of [[ID_A, 'normale'], [ID_B, 'reverse']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.set(id, VB.doc(id, { variante }));
    }
}
async function inst() {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc-ev' });
    await db.col('installations').insertOne(i); return jeton;
}

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true, semaine: true });
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-etat-vendeur.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    await semer();

    // charges fabriquées : la lecture enregistrée de la cellule « occidentale », recopiée sous une photo par lecture du modèle (seuls etatEstime / etatConfiance changent)
    const brut = JSON.parse(fs.readFileSync(CHARGES, 'utf8'));
    const occ = brut.charges.find(c => c.cellule === 'occidentale');
    const photo = k => `https://images1.vinted.net/t/00_rm-ev/f800/lecture-${k}.webp`;
    const fab = { ...brut, charges: [...brut.charges, ...LECTURES.map(([nom, etat, conf], k) => ({ ...occ, cellule: `etat-vendeur ${nom}`, imageUrl: photo(k), lecture: { ...occ.lecture, etatEstime: etat, etatConfiance: conf, defautsVus: [] } }))] };
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-ev-'));
    const fichierCharges = path.join(dossier, 'charges.json');
    fs.writeFileSync(fichierCharges, JSON.stringify(fab));

    const { demarrer, appeler } = require('../../verrou/serveur');
    const base = { VERROU_CHARGES: fichierCharges, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', V2_VISUELS_BANC_FICHIER: VB.fichier([...VIS.values()]) };
    const srv = await demarrer(path.join(__dirname, 'faux-reseau-v2.js'), { ...base, RM_API_V2: '1', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1', V2_DESCRIPTION_CONSERVEE: '1' });
    if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
    const url = `http://127.0.0.1:${srv.port}`;

    const v2 = async (k, vendeur) => {
        const corps = { contrat: 2, imageUrls: [photo(k)], title: null, description: null, prixVinted: 5, devise: 'EUR', marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...(vendeur === undefined ? {} : { vintedEtat: vendeur }) };
        const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${await inst()}`, 'idempotency-key': cle() } });
        return r;
    };
    const heritee = async (k, vendeur) => {
        const corps = { userId: `ev-${k}-${++nCle}`, imageUrls: [photo(k)], title: null, ...(vendeur === undefined ? {} : { vintedEtat: vendeur }) };
        return appeler(srv.port, 'POST', '/api/identifier', corps, 'jeton-verrou');
    };

    // ── 1. route v2 (contrat 2) et 2. route héritée (la 1.0.5)
    for (const [route, appel, lire] of [
        ['/api/identifier v2', v2, r => r.json && r.json.analyse && r.json.analyse.cartes[0] && r.json.analyse.cartes[0].etat],
        ['/api/identifier héritée (1.0.5)', heritee, r => r.json && r.json.etat],
    ]) {
        for (let k = 0; k < LECTURES.length; k++) {
            const [nomL, , , retenuAttendu] = LECTURES[k];
            const rs = [];
            for (const [nomV, v] of VENDEURS) rs.push({ nomV, r: await appel(k, v) });
            const ref = rs[0];
            H.vrai(`${route} · ${nomL} : la réponse sans vintedEtat est un succès exploitable (200, success)`, ref.r.json && ref.r.json.success === true && (ref.r.statut === 200 || ref.r.status === 200));
            const etatRef = lire(ref.r);
            H.vrai(`${route} · ${nomL} : l'état de la réponse existe (dénominateur : la comparaison n'est pas vide)`, etatRef && typeof etatRef === 'object');
            H.v(`${route} · ${nomL} : l'état RETENU ne vient que de l'avis du modèle sur la photo (porte de confiance actuelle) — sans avis retenu : null`, etatRef && (etatRef.retenu === undefined ? null : etatRef.retenu), retenuAttendu);
            const refTexte = JSON.stringify(nettoyer(ref.r.json));
            for (const { nomV, r } of rs.slice(1)) {
                const e = lire(r);
                H.v(`${route} · ${nomL} · vendeur « ${nomV} » : état retenu identique à celui sans vintedEtat`, e && e.retenu, etatRef && etatRef.retenu);
                H.v(`${route} · ${nomL} · vendeur « ${nomV} » : la réponse ENTIÈRE (état, prix, candidats, classement, verdict…) est identique, hors écho et identifiant`, JSON.stringify(nettoyer(r.json)) === refTexte, true);
            }
        }
    }

    // ── 2 bis. UNE CARTE IDENTIFIÉE (produit unique, garde des jumeaux conclue : aucun jumeau) : un vrai `prixLive` (états, langue), un vrai `prixGuide`, le verdict (regleVerdict…).
    // La chaîne héritée est FABRIQUÉE (deps.gererIdentifier) : seule façon d'obtenir `identifiee` avec un catalogue de banc (le faux réseau ne rend que des questions) ; elle rend, pour une lecture
    // du modèle donnée, EXACTEMENT ce que rend la chaîne héritée corrigée (`etat.retenu` ne dépend pas du vendeur) ; seul `declareVendeur` varie. Ce qui est éprouvé ici est donc la couche v2 réelle
    // (route, adaptateur, prix, verdict, lot) : si elle lisait le texte du vendeur pour choisir l'état visé ou un prix, la réponse changerait.
    {
        const express = require('express'); const pret = require('../pret');
        const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
        VB.installer([...VIS.values()]);
        const cfgIp = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_GRATUIT: '1000', V2_LOT_CARTES_MAX: '20' });
        const cartePoser = (id, vendeur, [, estime, conf, retenu]) => ({ success: true, question: null,
            carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
            etat: { estimeIA: estime, confianceIA: conf, defautsVus: [], declareVendeur: vendeur === undefined ? null : vendeur, declareCardmarket: vendeur === undefined ? null : 'NM', retenu },
            candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc-Set', prix: 1, photoUrl: null }], classement: [{ idProduct: id, score: 90, prix: 1 }], guidePrix: {},
            reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
        let lecture = LECTURES[0], vendeurCourant;
        const chaine = async (req, res) => res.json({ ...cartePoser(ID_A, vendeurCourant, lecture), scanId: String(req.scanIdImpose) });
        const lotRecu = [];
        const identifierLot = async req => { lotRecu.push(req.body.vintedEtat === undefined ? null : req.body.vintedEtat); return [0, 1].map(() => ({ statutHttp: 200, corps: cartePoser(ID_A, vendeurCourant, lecture) })); };
        const monter = async deps => {
            const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
            pret.armer(M.verifierIndex);
            app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgIp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
            return H.serveur(app);
        };
        const svUne = await monter({}), svLot = await monter({ identifierLot });
        const jouer = async (sv, vendeur, imgs) => {
            vendeurCourant = vendeur;
            const corps = { contrat: 2, imageUrls: Array(imgs).fill(photo(0)), title: null, description: null, prixVinted: 5, devise: 'EUR', marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...(vendeur === undefined ? {} : { vintedEtat: vendeur }) };
            return H.appel(sv.url, '/api/identifier', { methode: 'POST', corps, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${await inst()}`, 'idempotency-key': cle() } });
        };
        for (const [nomS, sv, imgs] of [['carte identifiée (une carte)', svUne, 1], ['lot de 2 cartes identifiées (crochet de lot)', svLot, 2]]) {
            for (const L of LECTURES) {
                lecture = L; const [nomL, , , retenuAttendu] = L;
                const rs = []; for (const [nomV, v] of VENDEURS) rs.push({ nomV, r: await jouer(sv, v, imgs) });
                const carte = r => r.json && r.json.analyse && r.json.analyse.cartes[0];
                const ref = rs[0].r, c0 = carte(ref);
                H.vrai(`${nomS} · ${nomL} : la référence est une carte identifiée avec un prixLive (dénominateur : le prix est bien produit)`, c0 && c0.statut === 'identifiee' && c0.prixLive && typeof c0.prixLive === 'object');
                H.v(`${nomS} · ${nomL} : prixLive.etatVise = l'état retenu du modèle (null sans avis retenu)`, c0 && c0.prixLive && c0.prixLive.etatVise, retenuAttendu);
                H.vrai(`${nomS} · ${nomL} : le bloc de prix et de verdict existe (carte.prixGuide et analyse.regleVerdict)`, c0 && c0.carte && c0.carte.prixGuide && ref.json.analyse.regleVerdict !== undefined);
                const refTexte = JSON.stringify(nettoyer(ref.json));
                for (const { nomV, r } of rs.slice(1)) {
                    const c = carte(r);
                    H.v(`${nomS} · ${nomL} · vendeur « ${nomV} » : prixLive.etatVise identique (jamais tiré du vendeur)`, c && c.prixLive && c.prixLive.etatVise, retenuAttendu);
                    H.v(`${nomS} · ${nomL} · vendeur « ${nomV} » : prixGuide et verdict (regleVerdict) identiques`, JSON.stringify([c && c.carte && c.carte.prixGuide, r.json.analyse.regleVerdict]), JSON.stringify([c0.carte.prixGuide, ref.json.analyse.regleVerdict]));
                    H.v(`${nomS} · ${nomL} · vendeur « ${nomV} » : l'analyse ENTIÈRE est identique, hors écho et identifiant`, JSON.stringify(nettoyer(r.json)) === refTexte, true);
                }
            }
        }
        H.vrai('lot : le crochet de lot a bien été joué par la vraie route (il a reçu le texte du vendeur pour le journal, sans effet)', lotRecu.length >= LECTURES.length * VENDEURS.length && lotRecu.some(x => x === 'Satisfaisant'));
        await svUne.fermer(); await svLot.fermer();
    }

    // ── 3. contrôle statique complémentaire du lot : le texte du vendeur n'est jamais lu par la couche v2 pour décider — il est seulement transmis à la chaîne héritée (qui l'ignore, §1-2)
    {
        const lot = fs.readFileSync(path.join(R, 'v2', 'identifier', 'lot.js'), 'utf8');
        const routes = fs.readFileSync(path.join(R, 'v2', 'identifier', 'routes.js'), 'utf8');
        const lectures = s => s.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(x => /vintedEtat/.test(x.l) && !/^\s*\/\//.test(x.l));
        // toute lecture de vintedEtat par la couche v2 est (a) la validation de forme, (b) la copie bornée dans l'entrée, (c) le passage tel quel dans le corps transmis à la chaîne héritée
        const ok = x => /refus\('ENTREE'/.test(x.l) || /typeof corps\.vintedEtat === 'string'/.test(x.l) || /vintedEtat: entree\.vintedEtat/.test(x.l);
        const hors = [...lectures(lot).map(x => ['lot.js', x]), ...lectures(routes).map(x => ['routes.js', x])].filter(([, x]) => !ok(x));
        H.v('3. lot et routes v2 : aucune lecture de vintedEtat hors validation, copie bornée et transmission à la chaîne héritée', hors.map(([f, x]) => `${f}:${x.i}`), []);
        H.v('   lot.js : le texte du vendeur n\'est jamais combiné à un état (pireEtat, etatMin, etatVintedVersCardmarket : absents de v2/)',
            ['lot.js', 'routes.js', path.join('..', 'identifier', 'adaptateur.js')].map(f => /pireEtat|etatMin|etatVintedVersCardmarket/.test(fs.readFileSync(path.join(R, 'v2', 'identifier', f), 'utf8'))), [false, false, false]);
    }

    // ── 4. le journal garde le texte du vendeur comme une INFORMATION (reçu et journalisé)
    {
        await new Promise(r => setTimeout(r, 400));
        const l = await raw('journal_scans').find({ etatVinted: 'Satisfaisant' }).toArray();
        H.vrai('4. le texte du vendeur est journalisé (etatVinted) : au moins une ligne « Satisfaisant » au journal', l.length >= 1);
        H.vrai('   et aucune ligne ne porte un état retenu plus mauvais que l\'avis du modèle (NM) quand le modèle dit NM haute',
            l.every(x => !(x.etatEstimeIA === 'NM' && x.etatConfianceIA === 'haute') || x.etatRetenu === 'NM'));
    }

    srv.enfant.kill();
    try { fs.rmSync(dossier, { recursive: false, force: true }); } catch { try { fs.unlinkSync(fichierCharges); fs.rmdirSync(dossier); } catch { /* temporaire */ } }
    H.bilan();
    await new Promise(r => setTimeout(r, 200));
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
