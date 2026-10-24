'use strict';
// Banc ETAT-TITRE (décision de l'éditeur, 2026-10-18, 21:47) — « le titre de l'annonce ne doit plus parvenir au modèle pour l'état ».
// L'état est estimé par un APPEL SÉPARÉ, sur les photos SEULES, lancé en parallèle de l'identification (qui, elle, reçoit toujours le titre). Même test que ETAT-VENDEUR : un titre différent donne EXACTEMENT le même état.
// Méthode : un FAUX MODÈLE (faux-modele-etat-titre.js) qui RECOPIE dans son état un mot de ce qu'il reçoit (« neuf », « excellent état », « abîmé », « usée ») et ENREGISTRE chaque requête (genre, photos, corps entier).
// Sur l'ancienne chaîne (un seul appel, le titre dedans) deux titres donnent deux états : c'est le ROUGE. Après le correctif, par les VRAIES routes d'un index.js réel (serveur ENFANT, base EN MÉMOIRE du banc) :
//   · six titres (dont l'absence) rendent strictement le même état retenu et la même réponse ENTIÈRE (état, prix, candidats, verdict…) ;
//   · la requête de l'appel d'état est OCTET POUR OCTET la même pour les six titres, ne contient aucun d'eux ni le texte du vendeur ; elle porte les MÊMES photos que l'identification ;
//   · l'identification reçoit toujours le titre ;
//   · une panne de l'appel d'état : état null, identification intacte ; un état de confiance basse : pas d'état retenu (la porte de confiance est inchangée).
// Routes : /api/identifier v2 (contrat 2, Bearer) et /api/identifier SANS contrat 2 (la route héritée que la 1.0.5 appelle). Le lot passe par la même chaîne héritée (v2/identifier/lot.js).
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
const ip = () => { nIp++; return { 'x-forwarded-for': `10.14.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
const cle = () => `banc-et-${Date.now().toString(36)}-${++nCle}`;

// six titres : quatre portent un mot que le faux modèle recopie dans son état, un n'en porte aucun, un est absent
const TITRES = [
    ['absent', undefined],
    ['neuf', 'Carte Pokémon Tropius neuf jamais joué'],
    ['excellent état', 'Tropius excellent état collection'],
    ['abîmé', 'Tropius très abîmé pliée'],
    ['usée', 'Tropius usée mauvais état'],
    ['sans mot d\'état', 'Tropius série française'],
];
const VENDEUR = 'Etat que personne ne connait ZZ-42';                  // le même dans tous les appels : il ne doit apparaître dans AUCUNE requête d'état
const LECTURES = [                                                      // [nom, état lu sur la photo, confiance, état retenu attendu]
    ['NM haute', 'NM', 'haute', 'NM'],
    ['GD haute', 'GD', 'haute', 'GD'],
    ['EX basse (aucun avis retenu)', 'EX', 'basse', null],
];
const ID_A = 895789, ID_B = 895790, EXP = 990001;
const SANS_ECHO = new Set(['scanId']);
function nettoyer(x) {
    if (Array.isArray(x)) return x.map(nettoyer);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) if (!SANS_ECHO.has(k)) o[k] = nettoyer(x[k]); return o; }
    return typeof x === 'string' ? x.replace(/[0-9a-f]{24}/g, '<id>') : x;
}
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
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc-et' });
    await db.col('installations').insertOne(i); return jeton;
}
const jsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split('\n').filter(Boolean).map(l => JSON.parse(l));

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true, semaine: true });
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-etat-titre.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    await semer();

    // ── charges fabriquées : la lecture enregistrée de la cellule « occidentale », recopiée sous une photo par lecture du modèle (seuls etatEstime / etatConfiance changent)
    const brut = JSON.parse(fs.readFileSync(CHARGES, 'utf8'));
    const occ = brut.charges.find(c => c.cellule === 'occidentale');
    const photo = k => `https://images1.vinted.net/t/00_rm-et/f800/lecture-${k}.webp`;
    const CANARI_DESCRIPTION = 'Description du vendeur DESC-CANARI-ZQ7', CANARI_PRIX = 4321.5;      // TOUR 2 : deux canaris, le texte et le prix du vendeur ne doivent entrer dans AUCUNE requête d'état
    const PHOTO_LENTE = 'https://images1.vinted.net/t/00_rm-et/f800/lent.webp';
    // LE SECOND ÉTAT (règle de l'éditeur, tour 2) : [nom, état, confiance, second état rendu par le modèle, état retenu attendu]
    const SECONDS = [
        ['hésitation NM / LP : le plus abîmé', 'NM', 'haute', 'LP', 'LP'],
        ['hésitation EX / GD (moyenne) : le plus abîmé', 'EX', 'moyenne', 'GD', 'GD'],
        ['aucune hésitation : l\'état unique', 'NM', 'haute', null, 'NM'],
        // TOUR 4 CORRECTION 1 (I2) : un second REFUSÉ est une hésitation exprimée que le serveur ne sait pas lire : « dans le doute, le plus abîmé » ne peut pas être appliqué, et l'état principal serait un état plus beau que le doute.
        // Ruling de l'éditeur : un second refusé => état retenu NUL (donc la fourchette), journalisé (etatSecondRefuse). Si c'est faux, une fourchette de plus, jamais un prix d'un meilleur état.
        ['second HORS LISTE (MINT) : refusé, état retenu nul', 'NM', 'haute', 'MINT', null],
        ['second « LP/PL » (deux états collés) : refusé, état retenu nul', 'GD', 'moyenne', 'LP/PL', null],
        ['second « EX+ » : refusé, état retenu nul', 'EX', 'haute', 'EX+', null],
        ['second MEILLEUR (NM) : ne relève jamais l\'état', 'EX', 'haute', 'NM', 'EX'],
        ['confiance basse malgré l\'hésitation : null', 'EX', 'basse', 'PL', null],
    ];
    const photoSecond = k => `https://images1.vinted.net/t/00_rm-et/f800/second-${k}.webp`;
    const PHOTO_BLOQUEE ='https://images1.vinted.net/t/00_rm-et/f800/etat-bloque.webp';
    const PHOTO_PANNE ='https://images1.vinted.net/t/00_rm-et/f800/panne-etat.webp';
    const PHOTO_DATA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const lect = (nom, etat, conf) => ({ ...occ, cellule: `etat-titre ${nom}`, lecture: { ...occ.lecture, etatEstime: etat, etatConfiance: conf, defautsVus: [] } });
    const fab = { ...brut, charges: [...brut.charges,
        ...LECTURES.map(([nom, etat, conf], k) => ({ ...lect(nom, etat, conf), imageUrl: photo(k) })),
        { ...lect('panne de l\'appel d\'état', 'NM', 'haute'), imageUrl: PHOTO_PANNE },
        { ...lect('photos reçues (data:)', 'GD', 'haute'), imageUrl: PHOTO_DATA },
        { ...lect('modèle lent', 'GD', 'haute'), imageUrl: PHOTO_LENTE },
        { ...lect('appel d\'état bloqué', 'GD', 'haute'), imageUrl: PHOTO_BLOQUEE },
        ...SECONDS.map(([nom, etat, conf, second], k) => ({ ...lect(`second état ${nom}`, etat, conf), lecture: { ...lect(nom, etat, conf).lecture, etatSecond: second }, imageUrl: photoSecond(k) }))] };
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-et-'));
    const fichierCharges = path.join(dossier, 'charges.json'), fichierReq = path.join(dossier, 'requetes.jsonl');
    fs.writeFileSync(fichierCharges, JSON.stringify(fab));
    fs.writeFileSync(fichierReq, '');

    const { demarrer, appeler } = require('../../verrou/serveur');
    const base = { VERROU_CHARGES: fichierCharges, BANC_ET_REQUETES: fichierReq, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', V2_VISUELS_BANC_FICHIER: VB.fichier([...VIS.values()]) };
    const srv = await demarrer(path.join(__dirname, 'faux-modele-etat-titre.js'), { ...base, RM_API_V2: '1', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1', V2_DESCRIPTION_CONSERVEE: '1' });
    if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
    const url = `http://127.0.0.1:${srv.port}`;

    const v2 = async (img, titre) => {
        const corps = { contrat: 2, imageUrls: [img], description: CANARI_DESCRIPTION, prixVinted: CANARI_PRIX, devise: 'EUR', marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', vintedEtat: VENDEUR, ...(titre === undefined ? { title: null } : { title: titre }) };
        return H.appel(url, '/api/identifier', { methode: 'POST', corps, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${await inst()}`, 'idempotency-key': cle() } });
    };
    const heritee = async (img, titre) => {
        const corps = { userId: `et-${++nCle}`, imageUrls: [img], vintedEtat: VENDEUR, description: CANARI_DESCRIPTION, prixVinted: CANARI_PRIX, ...(titre === undefined ? {} : { title: titre }) };
        return appeler(srv.port, 'POST', '/api/identifier', corps, 'jeton-verrou');
    };
    const ROUTES = [
        ['/api/identifier v2', v2, r => r.json && r.json.analyse && r.json.analyse.cartes[0] && r.json.analyse.cartes[0].etat, r => r.json && r.json.success === true && r.json.analyse && r.json.analyse.cartes[0].statut !== 'introuvable'],
        ['/api/identifier héritée (1.0.5)', heritee, r => r.json && r.json.etat, r => r.json && r.json.success === true],
    ];

    // ── 1. LE MÊME ÉTAT POUR SIX TITRES, par les deux routes
    for (const [route, appel, lire, reussi] of ROUTES) {
        for (let k = 0; k < LECTURES.length; k++) {
            const [nomL, , , retenuAttendu] = LECTURES[k];
            const rs = [];
            for (const [nomT, t] of TITRES) rs.push({ nomT, r: await appel(photo(k), t) });
            const ref = rs[0];
            H.vrai(`${route} · ${nomL} : la réponse sans titre est un succès exploitable`, reussi(ref.r));
            const etatRef = lire(ref.r);
            H.vrai(`${route} · ${nomL} : l'état de la réponse existe (dénominateur : la comparaison n'est pas vide)`, etatRef && typeof etatRef === 'object');
            H.v(`${route} · ${nomL} : l'état RETENU ne vient que de l'avis du modèle sur les photos (porte de confiance actuelle) — sans avis retenu : null`, etatRef && (etatRef.retenu === undefined ? null : etatRef.retenu), retenuAttendu);
            const refTexte = JSON.stringify(nettoyer(ref.r.json));
            for (const { nomT, r } of rs.slice(1)) {
                const e = lire(r);
                H.v(`${route} · ${nomL} · titre « ${nomT} » : état retenu identique à celui sans titre`, e && (e.retenu === undefined ? null : e.retenu), retenuAttendu);
                H.v(`${route} · ${nomL} · titre « ${nomT} » : l'état ENTIER (estimé, confiance, défauts, retenu) est identique à celui sans titre`, JSON.stringify(e), JSON.stringify(etatRef));
                H.v(`${route} · ${nomL} · titre « ${nomT} » : la réponse ENTIÈRE (état, prix, candidats, classement, verdict…) est identique, hors identifiant du scan`, JSON.stringify(nettoyer(r.json)) === refTexte, true);
            }
        }
    }

    // ── 2. LES REQUÊTES AU MODÈLE : l'état n'a jamais vu le titre ; l'identification le voit toujours
    await new Promise(r => setTimeout(r, 300));
    const L = jsonl(fichierReq);
    const etats = L.filter(x => x.genre === 'etat'), idents = L.filter(x => x.genre === 'identification');
    const TITRES_REELS = TITRES.map(x => x[1]).filter(Boolean);
    H.vrai(`2. dénominateur : des requêtes d'identification ET d'état ont été enregistrées (${idents.length} / ${etats.length})`, idents.length >= 2 * LECTURES.length * TITRES.length && etats.length > 0);
    H.v('2. UN appel d\'état par scan : autant de requêtes d\'état que d\'identification', etats.length, idents.length);
    for (let k = 0; k < LECTURES.length; k++) {
        const e = etats.filter(x => x.images.length === 1 && x.images[0] === photo(k)), i = idents.filter(x => x.images.length === 1 && x.images[0] === photo(k));
        H.v(`2. photo ${k} : ${TITRES.length * 2} requêtes d'état (6 titres × 2 routes) et autant d'identification`, [e.length, i.length], [TITRES.length * 2, TITRES.length * 2]);
        H.v(`2. photo ${k} : la requête d'ÉTAT est OCTET POUR OCTET la même pour les six titres et les deux routes`, new Set(e.map(x => x.corps)).size, 1);
    }
    H.vrai('2. aucune requête d\'état ne contient un des titres, ni le texte du vendeur', etats.length > 0 && etats.every(x => TITRES_REELS.every(t => !x.corps.includes(t)) && !x.corps.includes('ZZ-42')));
    H.vrai('2. CANARI description : le texte de la description du vendeur n\'est dans aucune requête d\'état', etats.length > 0 && etats.every(x => !x.corps.includes('DESC-CANARI-ZQ7') && !/description/i.test(x.corps)));
    H.vrai('2. CANARI prix : le prix demandé par le vendeur (4321,5) n\'est dans aucune requête d\'état', etats.length > 0 && etats.every(x => !/4321/.test(x.corps)));
    H.vrai('2. aucune requête d\'état ne contient « Titre de l\'annonce »', etats.length > 0 && etats.every(x => !/Titre de l.annonce/.test(x.corps)));
    for (const [nomT, t] of TITRES.filter(x => x[1])) {
        const n = idents.filter(x => x.corps.includes(t)).length;
        H.v(`2. l'identification reçoit toujours le titre « ${nomT} » (3 photos × 2 routes)`, n, 3 * 2);
    }
    H.vrai('2. l\'identification reçoit toujours le texte de l\'annonce comme avant (le prompt d\'identification n\'est pas modifié : il porte « Titre de l\'annonce (contexte) »)', idents.length > 0 && idents.every(x => /Titre de l.annonce \(contexte\)/.test(x.corps)));
    H.vrai('2. l\'appel d\'état est un appel d\'ÉTAT : il ne demande pas la lecture du nom ni du numéro', etats.length > 0 && etats.every(x => !/nomBrut|setCode|symboleSet/.test(x.corps)));

    // ── 3. UNE PANNE DE L'APPEL D'ÉTAT : état null, identification intacte (mêmes champs que la même lecture sans panne)
    for (const [route, appel, lire, reussi] of ROUTES) {
        const sain = await appel(photo(0), TITRES[1][1]), panne = await appel(PHOTO_PANNE, TITRES[1][1]);
        H.vrai(`3. ${route} · panne de l'état : la réponse est un succès (l'identification est intacte)`, reussi(panne));
        const e = lire(panne);
        H.v(`3. ${route} · panne de l'état : état retenu null, estimé null, confiance null`, e && [e.retenu === undefined ? null : e.retenu, e.estimeIA ?? null, e.confianceIA ?? null], [null, null, null]);
        // TOUR 4 CORRECTION 1 (M1) : un état nul pose la mention `etat-non-estimable` (et fiable false) sur TOUT prixGuide servi ; ces deux champs sont donc la différence ATTENDUE avec la même lecture sans panne, les chiffres restent identiques
        const sansMention = g => { if (g && typeof g === 'object') { delete g.fiable; delete g.reserves; } };
        const hors = r => { const t = nettoyer(r.json); if (t && t.etat) delete t.etat; if (t && t.analyse && t.analyse.cartes) for (const c of t.analyse.cartes) { delete c.etat; delete c.prixLive; delete c.prixRepli; for (const p of [c.carte, ...(c.candidats || [])]) if (p) { sansMention(p.prixGuide); for (const i of p.impressions || []) sansMention(i.prixGuide); } } return JSON.stringify(t); };
        H.vrai(`3. ${route} · panne de l'état : tout le reste de la réponse (carte, candidats, classement, verdict) est celui de la même lecture sans panne`, hors(panne) === hors(sain));
    }

    // ── 4. DES PHOTOS REÇUES (des images `data:`) : l'appel d'état reçoit les MÊMES images que l'identification, et ne télécharge rien (tout appel sortant autre que le modèle ferait lever le faux réseau)
    {
        const avant = jsonl(fichierReq).length;
        const r = await heritee(PHOTO_DATA, TITRES[1][1]);
        await new Promise(x => setTimeout(x, 200));
        const nouv = jsonl(fichierReq).slice(avant);
        const i = nouv.filter(x => x.genre === 'identification'), e = nouv.filter(x => x.genre === 'etat');
        H.vrai('4. data: · la réponse est un succès, l\'état retenu est celui des photos (GD)', r.json && r.json.success === true && r.json.etat && r.json.etat.retenu === 'GD');
        H.v('4. data: · un appel d\'identification et un appel d\'état', [i.length, e.length], [1, 1]);
        H.v('4. data: · l\'appel d\'état reçoit exactement les mêmes images (les `data:`) que l\'identification', e[0] && i[0] && JSON.stringify(e[0].images) === JSON.stringify(i[0].images) && e[0].images[0] === PHOTO_DATA, true);
        H.vrai('4. data: · aucune erreur de téléchargement ni appel sortant non prévu dans le journal du serveur', !/\[faux-reseau\] (POST|GET) non prévu/.test(srv.lire()));
    }

    // ── 4 bis. LE PARALLÉLISME : les deux appels partent ENSEMBLE (chacun met 900 ms à répondre : en file, la route mettrait le double)
    {
        const avant = jsonl(fichierReq).length, t0 = Date.now();
        const r = await heritee(PHOTO_LENTE, TITRES[1][1]);
        const duree = Date.now() - t0;
        const nouv = jsonl(fichierReq).slice(avant), i = nouv.find(x => x.genre === 'identification'), e = nouv.find(x => x.genre === 'etat');
        H.vrai('4 bis. la réponse est un succès avec l\'état des photos (GD)', r.json && r.json.success === true && r.json.etat && r.json.etat.retenu === 'GD');
        H.vrai(`4 bis. les deux appels partent ensemble (écart de départ ${i && e ? Math.abs(e.debut - i.debut) : '?'} ms, en file il serait d'au moins 900 ms)`, i && e && Math.abs(e.debut - i.debut) < 400);
        H.vrai(`4 bis. la route répond en un seul délai de modèle (${duree} ms, en file : plus de 1 800 ms)`, duree < 1600);
    }

    // ── 4 ter. C3 : l'appel d'état BLOQUÉ (3 500 ms) ne retient pas une identification terminée : la réponse sort 2 000 ms au plus après la lecture, état nul, cause « delai » au journal
    {
        for (const [route, appel, lire, reussi] of ROUTES) {
            const t0 = Date.now();
            const r = await appel(PHOTO_BLOQUEE, TITRES[1][1]);
            const duree = Date.now() - t0, e = lire(r);
            H.vrai(`4 ter. ${route} · état bloqué : la réponse est un succès (l'identification est intacte)`, reussi(r));
            H.v(`4 ter. ${route} · état bloqué : état estimé, confiance et retenu nuls`, e && [e.retenu === undefined ? null : e.retenu, e.estimeIA ?? null, e.confianceIA ?? null], [null, null, null]);
            H.vrai(`4 ter. ${route} · état bloqué : la réponse sort sans attendre les 3 500 ms de l'état (${duree} ms ; au plus 2 000 ms après la lecture)`, duree < 3200);
        }
    }

    // ── 4 quater. LE SECOND ÉTAT : quand le modèle hésite entre deux états, le serveur retient le PLUS ABÎMÉ ; sans hésitation l'état unique ; un second hors liste est refusé et ne devient jamais l'état
    for (const [route, appel, lire, reussi] of ROUTES) {
        for (let k = 0; k < SECONDS.length; k++) {
            const [nom, etat, , second, attendu] = SECONDS[k];
            const r = await appel(photoSecond(k), TITRES[5][1]), e = lire(r);
            H.vrai(`4 quater. ${route} · ${nom} : la réponse est un succès`, reussi(r));
            H.v(`4 quater. ${route} · ${nom} : état retenu`, e && (e.retenu === undefined ? null : e.retenu), attendu);
            H.v(`4 quater. ${route} · ${nom} : l'état ESTIMÉ reste celui du modèle (${etat}), le second n'est jamais servi comme estimation`, e && (e.estimeIA ?? e.estime ?? null), etat);
        }
    }

    // ── 5. LE JOURNAL : l'état journalisé est celui des photos, l'état lu par l'identification n'est qu'une information
    {
        await new Promise(r => setTimeout(r, 500));
        const l = await raw('journal_scans').find({}).toArray();
        const abimes = l.filter(x => x.nbPhotos === 1 && x.etatEstimeIA && x.etatConfianceIA);
        H.vrai(`5. des lignes de journal portent un état (dénominateur ${abimes.length} sur ${l.length})`, abimes.length > 0);
        H.vrai('5. aucune ligne de journal n\'a un état venu d\'un mot du titre (PL, LP, EX avec « abîmé », « usée », « excellent état »)', l.every(x => !(x.defautsVus || []).some(d => ['abîmé', 'usée', 'excellent état', 'neuf'].includes(d))));
        H.vrai('5. l\'état lu par l\'identification est conservé comme information (etatIdentification) sur les lignes où il diffère', l.some(x => typeof x.etatIdentification === 'string' && x.etatIdentification.length > 0));
        H.vrai('5. le temps de l\'appel d\'état est journalisé (msEtat)', l.some(x => Number.isFinite(x.msEtat)));
        H.vrai('5. la cause d\'un état nul est journalisée : « panne » (appel en panne) et « delai » (état bloqué)', ['panne', 'delai'].every(c => l.some(x => x.etatCause === c)));
        H.vrai('5. aucune cause sur un état rendu (etatCause null quand l\'appel a répondu)', l.some(x => x.etatEstimeIA && !x.etatCause));
        // TOUR 4 CORRECTION 1 (I2) : le refus d'un second état est journalisé (etatSecondRefuse), et c'est lui qui rend l'état retenu nul
        const refuses = l.filter(x => x.etatSecondRefuse === true);
        H.v('5. etatSecondRefuse : journalisé sur les scans au second refusé (MINT, LP/PL, EX+ ; deux routes), état retenu nul sur chacun', [refuses.length >= 6, refuses.every(x => x.etatRetenu === null && x.etatSecond === null)], [true, true]);
        H.vrai('5. etatSecondRefuse ne marque que les refus : un second valide ou l\'absence de second ne le posent pas', l.filter(x => x.etatSecond).every(x => x.etatSecondRefuse !== true) && l.filter(x => x.etatSecondRefuse !== true).length > 0);
    }

    srv.enfant.kill();
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* temporaire */ }

    // ── 6. le module : la consigne d'état recopie MOT POUR MOT le barème et les règles de l'identification (deux exemplaires d'une règle divergent), et elle ne dit rien du titre ni du vendeur
    {
        let ET = null; try { ET = require('../identifier/etat-photos'); } catch { /* module absent : le rouge */ }
        H.vrai('6. le module v2/identifier/etat-photos.js existe', ET && typeof ET.estimerEtat === 'function' && typeof ET.PROMPT_ETAT === 'string');
        const index = fs.readFileSync(path.join(R, 'index.js'), 'utf8');
        const a = index.indexOf("ÉVALUATION DE L'ÉTAT (etatEstime)"), b = index.indexOf("N'invente rien.", a) + "N'invente rien.".length;
        H.vrai('6. la consigne d\'identification porte toujours le bloc d\'état (borne de la comparaison)', a > 0 && b > a);
        // un gabarit de chaîne JS normalise CRLF en LF : le modèle voit des LF. Le bloc de l'identification, SEULS les écarts nommés (ECARTS) appliqués, doit être le texte de la consigne d'état, au mot près.
        let bloc = index.slice(a, b).replace(/\r\n/g, '\n'), ecartsTousPoses = Boolean(ET);
        if (ET) for (const [avant, apres] of ET.ECARTS) { if (bloc.split(avant).length !== 2) ecartsTousPoses = false; bloc = bloc.replace(avant, apres); }
        H.vrai('6. chacun des ECARTS (2) s\'applique UNE fois au bloc d\'identification', ET && ET.ECARTS.length === 2 && ecartsTousPoses);
        H.vrai('6. la consigne d\'état recopie MOT POUR MOT le bloc d\'état de la consigne d\'identification, hors les deux écarts nommés', ET && ET.PROMPT_ETAT.includes(bloc));
        // TOUR 2 : les écarts ne portent que sur la CONFIANCE. Un écart qui dit comment juger l'usure, les défauts ou l'état déplace l'ESTIMATION (le tour 1 : 10 cas sur 30 un cran vers le mieux, 0 en sens inverse).
        H.vrai('6. aucun écart ne parle de l\'usure, des défauts, de la prudence ni d\'un état du barème : chacun ne parle que de verso et de confiance', ET && ET.ECARTS.length > 0 && ET.ECARTS.every(([avant, apres]) => !/usure|usé|défaut|PESSIMISTE|surpayer|abîm|\b(MT|NM|EX|GD|LP|PL|PO)\b|defautsVus/i.test(apres) && /verso|confiance/i.test(avant + apres)));
        H.vrai('6. la consigne d\'état ne fait plus de « verso non visible » une raison de confiance « basse », et garde les définitions des trois niveaux de l\'identification', ET && !/verso non visible|dis-le via etatConfiance/.test(ET.PROMPT_ETAT) && ['sleeve/toploader/blister', 'photo correcte de face mais détails des bords/coins pas nets', 'carte nue, photo nette, bords et coins clairement visibles'].every(m => ET.PROMPT_ETAT.includes(m) && index.includes(m)));
        H.vrai('6. la consigne d\'état ne parle ni du titre, ni du vendeur, ni de prix, ni de la lecture du nom', ET && !/titre|annonce|vendeur|vinted|prix|nomBrut|setCode/i.test(ET.PROMPT_ETAT));
        H.vrai('6. index.js : l\'appel d\'état est lancé AVANT l\'attente de l\'identification, avec les MÊMES photos, sur les deux routes (et le signal d\'arrêt quand il existe)',
            (index.match(/estimerEtatSurPhotos\(photos/g) || []).length === 2 && (index.match(/\.attendre\(etatPromesse\)/g) || []).length === 2 && !/await etatPromesse/.test(index) && /estimerEtatSurPhotos\(photos, req\.signalArret\)/.test(index));
    }

    H.bilan();
    await new Promise(r => setTimeout(r, 200));
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
