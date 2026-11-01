'use strict';
// SERIE-COMPTE-TEST (01/11) — `serie-essai.js --compte=ordinaire` : les 9 lignes du compte de test ORDINAIRE, jugées SANS RÉSEAU par un FAUX SERVEUR (un `fetch` injecté ; le fetch global LÈVE s'il est utilisé).
// Ce que le banc juge : (1) l'AUTRE couple d'identifiants (jamais celui du compte de mesure) ; (2) le chemin d'un client réel : `capacitesClient`, le second envoi /api/identifier/mesures quand le serveur propose un complément (le code
// de --g-probable), les issues admises par ligne (liste fermée), et AUCUN appel de plus au modèle payant ; (3) la facturation, le solde avant et après et la déclaration INSCRITS au carnet à chaque ligne ;
// (4) le TABLEAU : la série conforme va au bout, et au PREMIER écart (niveau, produit, facturation, déclaration, réponse, quota) elle s'arrête, par le code 14, sans rien déclarer sur une première réponse non conforme ;
// (5) le refus de dépôt de photo du compte ordinaire arrête avant /api/identifier (code 15) ; (6) les départs refusés ; (7) les combinaisons refusées ; (8) la forme des requêtes ; (9) aucun secret dans le carnet ni dans le journal.
// Les valeurs de ce banc sont ÉCRITES ICI, à part du tableau du module : si le tableau change, la série conforme du banc devient rouge.
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./_harnais');
const S = require('../mesures/serie-essai'); const CT = require('../mesures/serie-compte-test');
const { verifierEntree } = require('../identifier/routes'); const { lireConfig } = require('../config');

const IDENT_ORD = 'banc-ordinaire@rat-market.invalid', SECRET_ORD = 'mot-de-passe-ORDINAIRE-NE-JAMAIS-AFFICHER-9876543210';
const IDENT_MESURE = 'banc-mesure@rat-market.invalid', SECRET_MESURE = 'mot-de-passe-MESURE-NE-JAMAIS-AFFICHER-0123456789';
const JETON_INST = 'jeton-installation-SECRET-aaaa1111', JETON_LIE = 'jeton-lie-SECRET-bbbb2222', COOKIE = 'cookie-session-SECRET-cccc3333', CODE = 'ABC123';
const TOUS_LES_SECRETS = [SECRET_ORD, SECRET_MESURE, JETON_INST, JETON_LIE, COOKIE];
const ENV_ORD = { V2_ESSAI_ORDINAIRE_IDENTIFIANT: IDENT_ORD, V2_ESSAI_ORDINAIRE_MOT_DE_PASSE: SECRET_ORD };
const ENV_MESURE = { V2_ESSAI_BANC_IDENTIFIANT: IDENT_MESURE, V2_ESSAI_BANC_MOT_DE_PASSE: SECRET_MESURE };
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'serie-compte-test-'));
const photos = path.join(dossier, 'photos'); fs.mkdirSync(photos);
const cartes = path.join(dossier, 'cartes'); fs.mkdirSync(cartes);
const MC = require('../identifier/calcul-client');
const HOTE_REF_NOM = 'pub-7d992e666c3d4a2b870b680a920045b6.r2.dev', HOTE_REF = `https://${HOTE_REF_NOM}`;      // l'hôte R2 public des références (comme l'extension)
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('VP8 xxxx')]);
const CAPACITES_PLEINES = ['langue-impression', 'marques', 'prix-incertains', 'prix-repli', 'achete-avant-jour', 'empreinte', 'mesures-client', 'probable'];
const JETON_MESURES = 'jeton-mesures-SECRET-dddd4444';
const COMPLEMENT = () => ({ jeton: JETON_MESURES, expireDans: 120, mesures: [{ type: 'paire', a: 'ref/un.webp', b: 'ref/deux.webp' }, { type: 'paire', a: 'ref/deux.webp', b: 'ref/un.webp' }, { type: 'zones', ref: 'ref/un.webp' }, { type: 'zones', ref: 'ref/deux.webp' }], references: [{ ref: 'ref/un.webp', url: `${HOTE_REF}/ref/un.webp`, sha256: null, octets: null }, { ref: 'ref/deux.webp', url: `${HOTE_REF}/ref/deux.webp`, sha256: null, octets: null }] });
// les fonctions de pixels : factices mais DÉTERMINISTES, branchées comme la production (photoGrise -> comparerPaire / scoresZones -> delete)
function fauxPixels(journal) {
    return {
        zones: {
            photoGrise: async () => ({ delete() { journal.push(['delete']); } }),
            comparerPaire: async (photo, a, b) => { journal.push(['paire', a.cle, b.cle]); return [0.1, 0.5]; },
            scoresZones: async (photo, s) => { journal.push(['zones', s.cle]); return { haut: 0.8, illustration: 0.7, bandeau: 0.6, texte: 0.5, bas: 0.4, inliers: s.cle === 'ref/un.webp' ? 250 : 20 }; }
        },
        carteRedressee: { valider: async () => ({ ok: true, data: Buffer.from('rgb'), width: 640, height: 894 }) }
    };
}
const lireRef = ref => Buffer.from(`scan:${ref}`);

// ── les 9 lignes, écrites à part du module ──
const LIGNES = [
    { rang: 1, cle: '6adbfe9c', verite: 286408 }, { rang: 2, cle: '6ad141f2', verite: 741918 }, { rang: 3, cle: '6ad00ce9', verite: 658690 }, { rang: 4, cle: '6ad149b7', verite: 525395 }, { rang: 5, cle: '6ad08f2e', verite: 908409 },
    { rang: 6, cle: '6ad3e9db', verite: 289788 }, { rang: 7, cle: '6ad3ea23', verite: 299573 }, { rang: 8, cle: '6ad126bc', verite: 574302 }, { rang: 9, cle: '6ada72c6', verite: 295460 }
];
const CLE_COMPLETE = l => `${l.cle}${'0123456789abcdef0123456789ab'.slice(0, 24)}`;     // la clé de photo du banc est plus longue que le préfixe du tableau
for (const l of LIGNES) { fs.writeFileSync(path.join(photos, CLE_COMPLETE(l) + '.jpg'), Buffer.from(`photo-${l.cle}`)); fs.writeFileSync(path.join(cartes, CLE_COMPLETE(l) + '.jpg'), Buffer.from(`carte-${l.cle}`)); }
const nav = { photos: Object.fromEntries(LIGNES.map((l, i) => [CLE_COMPLETE(l), { emb: Array.from({ length: 256 }, (_, j) => (j === i ? 1 : 0)), redressee: true }])) };
const resultats = (extra = {}) => ({ bancs: { 'banc LIVRÉ': {} }, diffs: { 'banc LIVRÉ': [] }, ref: LIGNES.map(l => ({ cle: `${CLE_COMPLETE(l)}:0`, banc: 'lot', verite: extra[l.rang] !== undefined ? extra[l.rang] : l.verite, et: { type: 'question', choix: [l.verite] } })).concat([{ cle: 'zz:0', banc: 'hors-banc', verite: 1, et: { type: 'sur' } }]) });

const F = (debite, reserve, rembourse, motif, raisonNonRembourse = null) => ({ debite, reserve, rembourse, motif, raisonNonRembourse, ...(debite ? { poche: 'jour' } : {}) });
const choix3 = (...ids) => ids.map((idProduct, i) => ({ id: 'abc'[i], idProduct }));
// ce que l'essai répond à chaque ligne : première réponse, déclaration attendue, réponse à la déclaration, variation du quota (au débit, puis à la réponse)
const SCENARIO = {
    1: { niveau: 'sur', produit: 286408, f1: F(1, 0, false, 'affirmee'), debit: -1 },
    2: { niveau: 'sur', produit: 741918, f1: F(1, 0, false, 'affirmee'), debit: -1 },
    3: { niveau: 'question', choix: choix3(658690, 11, 12), f1: F(0, 1, false, 'question'), debit: -1, repond: { facturation: F(1, 0, false, 'question') } },
    4: { niveau: 'probable', produit: 525395, choix: choix3(11, 525395), f1: F(1, 0, false, 'question'), debit: -1, repond: { facturation: F(1, 0, false, 'question') } },
    5: { niveau: 'probable', produit: 908409, choix: choix3(908409, 12), f1: F(1, 0, false, 'question'), debit: -1, repond: { facturation: F(0, 0, true, 'question'), declaration: { rendue: true, raison: null, plafondJour: 3 }, quota: +1 } },
    6: { niveau: 'probable', produit: 289788, choix: choix3(289788, 12), f1: F(1, 0, false, 'question'), debit: -1, repond: { facturation: F(0, 0, true, 'question'), declaration: { rendue: true, raison: null, plafondJour: 3 }, quota: +1 } },
    7: { niveau: 'probable', produit: 299573, choix: choix3(299573, 12), f1: F(1, 0, false, 'question'), debit: -1, repond: { facturation: F(0, 0, true, 'question'), declaration: { rendue: true, raison: null, plafondJour: 3 }, quota: +1 } },
    8: { niveau: 'probable', produit: 574302, choix: choix3(574302, 12), f1: F(1, 0, false, 'question'), debit: -1, repond: { facturation: F(1, 0, false, 'plafond-jour', 'plafond-jour'), declaration: { rendue: false, raison: 'plafond-probable', plafondJour: 3 }, quota: 0 } },
    9: { niveau: 'introuvable', f1: F(0, 0, true, 'introuvable'), debit: 0 }
};
const CHOIX_ATTENDUS = { 1: null, 2: null, 3: 'a', 4: 'b', 5: 'aucune', 6: 'aucune', 7: 'aucune', 8: 'aucune', 9: null };
const RESTANT_APRES = { 1: 9, 2: 8, 3: 7, 4: 6, 5: 6, 6: 6, 7: 6, 8: 5, 9: 5 };

const CFG_ESSAI = { ...lireConfig({}), photosMultiples: true, empreinteExtension: true };
const photoIdN = n => n.toString(16).padStart(32, '0');
function fauxServeur(comp = {}) {
    const appels = [], mesuresVues = []; let restant = comp.restantDepart ?? 10, nId = 0;
    const rep = (statut, corps, entetes = {}) => ({ status: statut, json: async () => corps, headers: { get: n => entetes[String(n).toLowerCase()] ?? null } });
    const fetch = async (url, init = {}) => {
        const u = new URL(url), corps = init.body;
        appels.push({ url, chemin: u.pathname, methode: init.method || 'GET', entetes: init.headers || {}, corps });
        if (u.hostname === HOTE_REF_NOM) {                                      // l'hôte PUBLIC des références (R2) : un faux, jamais le vrai
            return { status: 200, headers: { get: n => ({ 'content-type': 'image/webp' })[String(n).toLowerCase()] ?? null }, arrayBuffer: async () => WEBP.buffer.slice(WEBP.byteOffset, WEBP.byteOffset + WEBP.byteLength), body: null };
        }
        if (u.pathname === '/ping') return rep(200, { ok: true, versionMinExtension: '2.5.0', capacites: CAPACITES_PLEINES });
        if (u.pathname === '/api/compte/connexion') {
            const b = JSON.parse(corps);
            if (b.email !== IDENT_ORD || b.motDePasse !== SECRET_ORD) return rep(401, { success: false });
            return rep(200, { success: true, compte: { email: IDENT_ORD, verifie: true } }, { 'set-cookie': `rm_session=${COOKIE}; HttpOnly; Secure; SameSite=Lax; Path=/` });
        }
        if (u.pathname === '/api/installation') return (init.headers || {}).Cookie === `rm_session=${COOKIE}` ? rep(201, { success: true, jetonInstallation: JETON_INST }) : rep(429, { success: false });
        if (u.pathname === '/api/compte/code') return rep(200, { success: true, code: CODE, expire: 'x' });
        if (u.pathname === '/api/compte/lier') return rep(200, { success: true, compte: { verifie: comp.nonVerifie ? false : true, administrateur: comp.administrateur === true }, jetonInstallation: JETON_LIE });
        if ((init.headers || {}).Authorization !== `Bearer ${JETON_LIE}`) return rep(401, { success: false });
        if (u.pathname === '/api/solde') return rep(200, { success: true, solde: { total: 0, achete: 0, compte: { lie: true, administrateur: comp.administrateur === true } }, offre: { nom: comp.offre || 'gratuit', restant, remiseAZero: 'x' } });
        if (u.pathname === '/api/photo' && comp.photoErreurAu && appels.filter(x => x.chemin === '/api/photo').length === comp.photoErreurAu) throw Object.assign(new Error('délai dépassé'), { name: 'TimeoutError' });
        if (u.pathname === '/api/photo') return comp.photoStatut ? rep(comp.photoStatut, { success: false }) : rep(200, { success: true, photoId: photoIdN(appels.filter(x => x.chemin === '/api/photo').length) });
        if (u.pathname === '/api/identifier/mesures') {
            const b = JSON.parse(corps), n = Number(String(b.scanId).split('-')[1]), sc = { ...SCENARIO[n], ...(comp.ecraser && comp.ecraser[n] ? comp.ecraser[n] : {}) };
            mesuresVues.push(b);
            if (comp.mesuresStatut) return rep(comp.mesuresStatut, { success: false }, { 'retry-after': '30' });
            // COMME LA PRODUCTION : le jeton, accepteProbable et des résultats que le validateur de la production accepte
            if (b.jeton !== JETON_MESURES || b.accepteProbable !== true || !MC.validerResultats(COMPLEMENT().mesures, b.resultats).ok) return rep(400, { success: false });
            return sc.mesures ? rep(200, { success: true, scanId: b.scanId, change: true, carte: sc.mesures.carte, facturation: sc.mesures.facturation }) : rep(200, { success: true, scanId: b.scanId, change: false });
        }
        if (u.pathname === '/api/identifier') {
            nId++;
            const b = JSON.parse(corps);
            if (b.contrat !== 2) return rep(401, { success: false });
            const v = verifierEntree(b, CFG_ESSAI); if (v.erreur) return rep(400, { success: false, erreur: v.erreur });
            const sc = { ...SCENARIO[nId], ...(comp.ecraser && comp.ecraser[nId] ? comp.ecraser[nId] : {}) };
            restant += sc.debit; if (nId === 9 && sc.niveau === 'introuvable') restant += 0;
            const cartes = sc.niveau === 'sur' ? [{ index: 0, statut: 'identifiee', carte: { idProduct: sc.produit } }]
                : sc.niveau === 'introuvable' ? [{ index: 0, statut: 'introuvable' }]
                : [{ index: 0, statut: 'a-trancher', ...(sc.niveau === 'probable' ? { niveau: 'probable', probable: { idProduct: sc.produit } } : {}), candidats: sc.choix.map(c => ({ idProduct: c.idProduct })), question: { choix: sc.choix } }];
            return rep(200, { success: true, scanId: `scan-${nId}`, analyse: { statut: 'x', cartes, photosRecues: [0], photoRecue: comp.photoNonRecue ? false : true }, facturation: sc.f1,
                ...(sc.complement ? { complement: COMPLEMENT() } : {}) });
        }
        if (u.pathname === '/api/identifier/reponse') {
            const b = JSON.parse(corps), sc = { ...SCENARIO[nId], ...(comp.ecraser && comp.ecraser[nId] ? comp.ecraser[nId] : {}) };
            if (comp.reponseStatut) return rep(comp.reponseStatut, { success: false });
            restant += (sc.repond && sc.repond.quota) || 0;
            return rep(200, { success: true, carte: { idProduct: 1 }, facturation: sc.repond.facturation, ...(sc.repond.declaration ? { declaration: sc.repond.declaration } : {}), solde: { total: 0 } });
        }
        return rep(404, { success: false });
    };
    return { fetch, appels, mesuresVues, restant: () => restant };
}
// la carte que le second envoi rend quand il CHANGE le résultat : un probable (la tête du groupe) ou un sûr (promotion de la règle G)
const carteProbableDe = (produit, choix) => ({ index: 0, statut: 'a-trancher', niveau: 'probable', probable: { idProduct: produit, aConfirmer: true }, candidats: choix.map(c => ({ idProduct: c.idProduct })), question: { choix } });
const carteSureDe = produit => ({ index: 0, statut: 'identifiee', carte: { idProduct: produit }, niveau: 'sur' });
// les variantes d'une ligne de probable : la première réponse est une QUESTION qui porte un complément, le second envoi la fait devenir le probable (débité à l'affichage)
const enGroupe = rang => { const s = SCENARIO[rang]; return { niveau: 'question', f1: F(0, 1, false, 'question'), complement: true, mesures: { carte: carteProbableDe(s.produit, s.choix), facturation: F(1, 0, false, 'question') } }; };
const base = (extra = {}) => ({ compte: 'ordinaire', resultats: resultats(extra.verites || {}), nav, photos, cartes, plafondUsd: 0.05, carnet: path.join(dossier, `carnet-${Math.random().toString(36).slice(2)}.jsonl`), pauseS: 0, env: { ...ENV_ORD }, coutEstimeUsd: 0.0037, ...extra });
let horloge = 0;
const deps = (srv, extra = {}) => { const logs = [], journalPx = []; return { fetch: srv.fetch, horloge: () => (horloge += 100), pause: async () => { }, log: m => logs.push(String(m)), maintenant: () => 1700000000000, lireReference: lireRef, ...fauxPixels(journalPx), logs, journalPx, ...extra }; };
const essaie = async f => { try { return { ok: await f() }; } catch (e) { return { arret: e instanceof S.Arret ? e.raison : `exception ${e && e.message}` }; } };
const chemins = srv => srv.appels.map(a => a.chemin);
const nChemin = (srv, c) => srv.appels.filter(a => a.chemin === c).length;
const carnetLignes = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : []);

(async () => {
    const fetchGlobal = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('RÉSEAU : le client a utilisé le fetch global'); };
    try {
        // ── 0. le tableau du module = les 9 lignes du cahier des charges ──
        H.v('0a. le tableau a 9 lignes, dans l\'ordre, avec les clés et vérités du §7', CT.TABLEAU.map(t => [t.rang, t.cle, t.verite]), LIGNES.map(l => [l.rang, l.cle, l.verite]));
        const PROB = ['probable->probable', 'question->probable'];
        H.v('0b. issues ADMISES par ligne (liste fermée : niveau de la première réponse -> niveau final) : sûr, sûr, question (3 issues), probable (2 issues) ×5, introuvable',
            CT.TABLEAU.map(t => t.issues.map(i => `${i.premier}->${i.final}`)), [['sur->sur'], ['sur->sur'], ['question->question', 'question->sur', 'question->probable'], PROB, PROB, PROB, PROB, PROB, ['introuvable->introuvable']]);
        H.v('0c. déclarations par issue : rien, rien, (a | rien | confirmation), confirmation ×2, « aucune » ×8, rien', CT.TABLEAU.map(t => t.issues.map(i => i.declaration)), [[null], [null], ['verite', null, 'probable'], ['probable', 'probable'], ['aucune', 'aucune'], ['aucune', 'aucune'], ['aucune', 'aucune'], ['aucune', 'aucune'], [null]]);
        H.v('0f. chaque issue porte sa source : valeur DÉDUITE du code, pas observée ; chaque issue qui a changé le résultat porte la facturation du second envoi', [CT.TABLEAU.every(t => t.issues.every(i => /déduite du code/.test(i.source))), CT.TABLEAU.every(t => t.issues.every(i => (i.premier !== i.final) === (i.second !== null)))], [true, true]);
        H.v('0g. le débit attendu : le sûr est débité (1), la question réservée (0 + réserve 1) puis débitée à la réponse ou au second envoi (1), le probable débité à l\'affichage (1), « aucune » rend (0, remboursé), le plafond ne rend pas (1)',
            CT.TABLEAU.flatMap(t => t.issues.map(i => [t.rang, i.premiere.debite + i.premiere.reserve, i.second ? i.second.debite : null, i.reponse ? [i.reponse.debite, i.reponse.rembourse] : null])),
            [[1, 1, null, null], [2, 1, null, null], [3, 1, null, [1, false]], [3, 1, 1, null], [3, 1, 1, [1, false]], [4, 1, null, [1, false]], [4, 1, 1, [1, false]], [5, 1, null, [0, true]], [5, 1, 1, [0, true]], [6, 1, null, [0, true]], [6, 1, 1, [0, true]], [7, 1, null, [0, true]], [7, 1, 1, [0, true]], [8, 1, null, [1, false]], [8, 1, 1, [1, false]], [9, 0, null, null]]);
        H.v('0d. quota restant après chaque ligne (10 au départ)', CT.TABLEAU.map(t => t.restantApres), Object.values(RESTANT_APRES));
        H.v('0e. codes de sortie : 14 écart, 15 photo refusée ; ni 10, 11 ni 12 (pris par serie-probable.js)', [CT.CODE_ECART, CT.CODE_PHOTO_REFUSEE, CT.QUOTA_GRATUIT, CT.PLAFOND_PROBABLE_AUCUNE, CT.VERSION_CLIENT], [14, 15, 10, 3, '2.0.1']);
        H.vrai('0h. le second envoi n\'appelle AUCUN modèle payant : calcul-client-route.js (POST /api/identifier/mesures) ne contient ni appel réseau, ni chaîne d\'identification, ni OpenRouter',
            !/openrouter|axios|fetch\(|https?\.request|gererIdentifier|chaineHeritee|analyserAvecIA/i.test(fs.readFileSync(path.join(__dirname, '..', 'identifier', 'calcul-client-route.js'), 'utf8')));

        // ── 1. la série conforme va jusqu'au bout ──
        {
            const s = fauxServeur(), d = deps(s), b = base();
            const r = await essaie(() => S.serie(b, d));
            const res = r.ok;
            if (!res) H.v('1. la série conforme a abouti (aucun arrêt)', r.arret, 'aucun arrêt');      // un mutant qui l'arrête est tué par CETTE assertion, pas par un plantage plus bas
            else {
            H.v('1a. série conforme : 9 lignes, aucun arrêt, aucun écart, code de sortie 0', [res && res.resultats.length, res && res.arret, res && res.ecart, res && res.compteTest, res && CT.codeSortie(res)], [9, null, null, true, 0]);
            H.v('   le quota restant lu après chaque ligne est celui du tableau', res && res.resultats.map(x => x.compteTest?.soldeApres?.offre?.restant), Object.values(RESTANT_APRES));
            H.v('   les déclarations ENVOYÉES : rien, rien, a, b, aucune ×4, rien', res && res.resultats.map(x => x.compteTest.declarationEnvoyee), Object.values(CHOIX_ATTENDUS));
            H.v('1b. le serveur ne propose aucun complément : aucun second envoi (il n\'a lieu que sur un complément, comme chez l\'extension)', nChemin(s, '/api/identifier/mesures'), 0);
            H.v('   9 scans, 6 déclarations (3, 4, 5, 6, 7, 8), 10 lectures de solde (avant la série puis après chaque ligne)', [nChemin(s, '/api/identifier'), nChemin(s, '/api/identifier/reponse'), nChemin(s, '/api/solde')], [9, 6, 10]);
            const ordre = chemins(s).filter(c => c.startsWith('/api/photo') || c.startsWith('/api/identifier') || c === '/api/solde');
            H.v('   l\'ordre : solde, puis par ligne photo, identifier, [réponse], solde', ordre.slice(0, 12), ['/api/solde', '/api/photo', '/api/identifier', '/api/solde', '/api/photo', '/api/identifier', '/api/solde', '/api/photo', '/api/identifier', '/api/identifier/reponse', '/api/solde', '/api/photo']);
            H.v('1c. les identifiants lus sont l\'AUTRE couple : la connexion porte l\'adresse ordinaire', JSON.parse(s.appels.find(a => a.chemin === '/api/compte/connexion').corps).email, IDENT_ORD);
            const idc = JSON.parse(s.appels.find(a => a.chemin === '/api/identifier').corps);
            H.v('1d. le corps d\'/api/identifier : contrat 2, version 2.0.1 (le niveau probable), capacitesClient [mesures-1] comme l\'extension', [idc.contrat, idc.versionExtension, idc.capacitesClient], [2, '2.0.1', ['mesures-1']]);
            const reps = s.appels.filter(a => a.chemin === '/api/identifier/reponse').map(a => JSON.parse(a.corps));
            H.v('1e. les réponses envoyées : scanId du scan, carte 0, le choix du tableau', reps.map(x => [x.scanId, x.carte, x.choix]), [['scan-3', 0, 'a'], ['scan-4', 0, 'b'], ['scan-5', 0, 'aucune'], ['scan-6', 0, 'aucune'], ['scan-7', 0, 'aucune'], ['scan-8', 0, 'aucune']]);
            H.vrai('   chaque réponse porte une Idempotency-Key distincte', new Set(s.appels.filter(a => a.chemin === '/api/identifier/reponse').map(a => a.entetes['Idempotency-Key'])).size === 6);
            const L = carnetLignes(b.carnet).filter(x => x.compteTest && x.compteTest.rang);
            H.v('1f. le carnet inscrit, par ligne : la facturation servie, le solde avant et après, la déclaration envoyée', [L.length, L.every(x => x.compteTest.facturation && x.compteTest.soldeAvant && x.compteTest.soldeApres && 'declarationEnvoyee' in x.compteTest)], [9, true]);
            H.v('   ligne 8 (plafond) : la réponse du serveur est au carnet avec son message plafond-probable', L[7]?.compteTest?.reponse?.declaration, { rendue: false, raison: 'plafond-probable', plafondJour: 3 });
            H.v('   ligne 5 : facturation de la réponse (remboursée) et solde 5 -> 6', [L[4]?.compteTest?.reponse?.facturation?.rembourse, L[4]?.compteTest?.soldeAvant?.offre?.restant, L[4]?.compteTest?.soldeApres?.offre?.restant], [true, 6, 6]);
            H.v('   le départ est au carnet (offre gratuite, restant 10)', carnetLignes(b.carnet).find(x => x.compteTest === 'depart').offre.restant, 10);
            const tout = fs.readFileSync(b.carnet, 'utf8') + d.logs.join('\n') + JSON.stringify(res);
            H.vrai('1g. aucun secret (mots de passe, jetons, cookie) dans le carnet, le journal ni le résultat', TOUS_LES_SECRETS.every(x => !tout.includes(x)));
            H.v('1h. la dépense inscrite : 9 scans x 0,0037', Math.round(res.depenseUsd * 1e4) / 1e4, 0.0333);
            }
        }

        // ── 2. les couples d'identifiants ──
        for (const [nom, env] of [['aucun', {}], ['le couple du compte de MESURE seul (jamais mélangé)', ENV_MESURE], ['l\'identifiant ordinaire seul', { V2_ESSAI_ORDINAIRE_IDENTIFIANT: IDENT_ORD }], ['le mot de passe ordinaire seul', { V2_ESSAI_ORDINAIRE_MOT_DE_PASSE: SECRET_ORD }]]) {
            const s = fauxServeur(); const r = await essaie(() => S.serie(base({ env }), deps(s)));
            H.v(`2a. identifiants : ${nom} : arrêt avant TOUTE requête`, [/V2_ESSAI_ORDINAIRE_IDENTIFIANT/.test(r.arret || ''), s.appels.length], [true, 0]);
        }
        { const s = fauxServeur(); const r = await essaie(() => S.serie({ ...base(), compte: undefined, n: 2, graine: 1, env: { ...ENV_MESURE } }, deps(s)));
          H.v('2b. sans --compte, le client est celui d\'avant : il lit le couple du compte de MESURE (le faux serveur ne connaît que l\'ordinaire : connexion refusée)', [JSON.parse(s.appels.find(a => a.chemin === '/api/compte/connexion').corps).email, /connexion du compte de mesure : connexion refusée/.test(r.arret || '')], [IDENT_MESURE, true]); }

        // ── 3. les départs refusés (aucun scan lancé) ──
        for (const [nom, comp, motif] of [['quota déjà entamé (restant 7)', { restantDepart: 7 }, /quota du jour déjà entamé/], ['offre Pro', { offre: 'pro' }, /pas « gratuit »/], ['compte lié administrateur', { administrateur: true }, /administrateur ou non confirmé/], ['compte lié non confirmé', { nonVerifie: true }, /non confirmé/]]) {
            const s = fauxServeur(comp); const r = await essaie(() => S.serie(base(), deps(s)));
            H.v(`3. départ refusé : ${nom} : arrêt, aucune photo, aucun scan`, [motif.test(r.arret || ''), nChemin(s, '/api/photo'), nChemin(s, '/api/identifier')], [true, 0, 0]);
        }

        // ── 4. les lignes du tableau doivent exister, avec leur vérité ──
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ verites: { 4: 999 } }), deps(s)));
          H.v('4a. la vérité du banc n\'est pas celle du tableau (ligne 4) : arrêt AVANT toute requête', [/ligne 4/.test(r.arret || '') && /vérité/.test(r.arret || ''), s.appels.length], [true, 0]); }
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ verites: { 7: null, 8: null } }), deps(s)));
          H.v('4b. une vérité absente : arrêt avant toute requête', [/vérité/.test(r.arret || ''), s.appels.length], [true, 0]); }
        { const s = fauxServeur(); const sans = resultats(); sans.ref = sans.ref.filter(x => !x.cle.startsWith('6ad3e9db'));
          const r = await essaie(() => S.serie(base({ resultats: sans }), deps(s)));
          H.v('4c. une ligne du tableau sans ligne au banc : arrêt avant toute requête', [/ligne 6/.test(r.arret || ''), s.appels.length], [true, 0]); }
        { const s = fauxServeur(); const dbl = resultats(); dbl.ref.push({ ...dbl.ref[0], cle: `6adbfe9c-autre:0` });
          const nav2 = { photos: { ...nav.photos, '6adbfe9c-autre': nav.photos[CLE_COMPLETE(LIGNES[0])] } };
          fs.writeFileSync(path.join(photos, '6adbfe9c-autre.jpg'), Buffer.from('x'));
          const r = await essaie(() => S.serie(base({ resultats: dbl, nav: nav2 }), deps(s)));
          H.v('4d. un préfixe qui désigne DEUX lignes du banc : arrêt avant toute requête (une seule est exigée)', [/ligne 1/.test(r.arret || ''), s.appels.length], [true, 0]);
          fs.rmSync(path.join(photos, '6adbfe9c-autre.jpg')); }

        // ── 5. les combinaisons refusées, avant toute requête ──
        for (const [nom, extra, motif] of [['--g-probable', { gProbable: true }, /ne se combine pas avec --g-probable/], ['--cles', { cles: ['6adbfe9c'] }, /ne se combine pas avec --cles/], ['--sans-declarations', { declarations: false }, /ne se combine pas avec --sans-declarations/], ['--deuxieme-apres-signal', { deuxiemeApresSignal: 'x' }, /ne se combine pas avec --deuxieme-apres-signal/],
            ['une autre valeur de --compte', { compte: 'administrateur' }, /n'admet que la valeur « ordinaire »/], ['--compte=Ordinaire (casse)', { compte: 'Ordinaire' }, /n'admet que la valeur « ordinaire »/]]) {
            const s = fauxServeur(); const r = await essaie(() => S.serie(base(extra), deps(s)));
            H.v(`5. ${nom} : refus avant toute requête, pour la bonne raison`, [motif.test(r.arret || ''), s.appels.length], [true, 0]);
        }
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ plafondUsd: 0.02 }), deps(s)));
          H.v('5b. plafond 0,02 USD (l\'estimation 0,0333 le dépasse) : refus avant toute requête', [/estimation/.test(r.arret || ''), s.appels.length], [true, 0]); }
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ plafondUsd: 0.05, coutEstimeUsd: 0.0037 }), deps(s)));
          H.v('5c. plafond de série 0,05 USD : l\'estimation 0,0333 passe', r.arret === undefined, true); }

        // ── 6. au PREMIER écart : arrêt, code 14, aucune déclaration sur une première réponse non conforme ──
        const ecart = async (nom, ecraser, comp = {}, attendu) => {
            const s = fauxServeur({ ecraser, ...comp }), d = deps(s), b = base();
            const r = await essaie(() => S.serie(b, d)), res = r.ok;
            if (!res) H.v(`6. ${nom} : la série a rendu un résultat (pas un arrêt de configuration)`, r.arret, 'un résultat');
            H.v(`6. ${nom} : arrêt sur la ligne ${attendu.rang}, champ « ${attendu.champ} », code 14`, [res && res.ecart && res.ecart.rang, res && res.ecart && res.ecart.champ, res && CT.codeSortie(res), /ÉCART AU TABLEAU/.test((res && res.arret) || '')], [attendu.rang, attendu.champ, 14, true]);
            H.v(`   aucun scan après la ligne fautive (${attendu.rang} scans au plus)`, nChemin(s, '/api/identifier'), attendu.rang);
            return { s, res, b, d };
        };
        { const { s } = await ecart('ligne 5 : le modèle rend une QUESTION au lieu d\'un probable', { 5: { niveau: 'question', choix: choix3(908409, 12), f1: F(0, 1, false, 'question') } }, {}, { rang: 5, champ: 'issue' });
          H.v('   (et RIEN n\'a été déclaré sur cette première réponse non conforme : seules les lignes 3 et 4 ont une réponse)', nChemin(s, '/api/identifier/reponse'), 2); }
        { const { s } = await ecart('ligne 4 : un probable FAUX (autre produit)', { 4: { produit: 11 } }, {}, { rang: 4, champ: 'produit' });
          H.v('   (rien déclaré sur un probable faux : les 3 réponses sont celles des lignes 3 seulement)', nChemin(s, '/api/identifier/reponse'), 1); }
        await ecart('ligne 2 : un sûr FAUX', { 2: { produit: 5 } }, {}, { rang: 2, champ: 'produit' });
        await ecart('ligne 1 : la facturation du sûr n\'est pas débitée (debite 0)', { 1: { f1: F(0, 0, false, 'affirmee') } }, {}, { rang: 1, champ: 'facturation.debite' });
        await ecart('ligne 1 : la facturation porte le motif « administrateur » (le compte serait exempté de débit)', { 1: { f1: { debite: 0, reserve: 0, rembourse: false, motif: 'administrateur', raisonNonRembourse: null } } }, {}, { rang: 1, champ: 'facturation.debite' });
        await ecart('ligne 3 : la question n\'est pas réservée (reserve 0)', { 3: { f1: F(1, 0, false, 'question') } }, {}, { rang: 3, champ: 'facturation.debite' });
        await ecart('ligne 3 : la réponse ne débite pas (debite 0)', { 3: { repond: { facturation: F(0, 0, false, 'question') } } }, {}, { rang: 3, champ: 'reponse.facturation.debite' });
        await ecart('ligne 4 : la confirmation d\'un probable REMBOURSE', { 4: { repond: { facturation: F(0, 0, true, 'question') } } }, {}, { rang: 4, champ: 'reponse.facturation.debite' });
        await ecart('ligne 5 : « aucune » ne rembourse pas (double débit)', { 5: { repond: { facturation: F(1, 0, false, 'question'), declaration: { rendue: true, raison: null, plafondJour: 3 }, quota: 0 } } }, {}, { rang: 5, champ: 'reponse.facturation.debite' });
        await ecart('ligne 5 : remboursée mais la déclaration manque', { 5: { repond: { facturation: F(0, 0, true, 'question'), quota: +1 } } }, {}, { rang: 5, champ: 'reponse.declaration' });
        await ecart('ligne 6 : le quota n\'est pas rendu au remboursement (restant 5 au lieu de 6)', { 6: { repond: { facturation: F(0, 0, true, 'question'), declaration: { rendue: true, raison: null, plafondJour: 3 }, quota: 0 } } }, {}, { rang: 6, champ: 'quota restant apres' });
        await ecart('ligne 8 : le remboursement n°4 est ACCEPTÉ (le plafond ne mord pas)', { 8: { repond: { facturation: F(0, 0, true, 'question'), declaration: { rendue: true, raison: null, plafondJour: 3 }, quota: +1 } } }, {}, { rang: 8, champ: 'reponse.facturation.debite' });
        await ecart('ligne 8 : refusé mais sans le message plafond-probable', { 8: { repond: { facturation: F(1, 0, false, 'plafond-jour', 'plafond-jour'), declaration: { rendue: false, raison: 'plafond-declarations', plafondJour: 3 }, quota: 0 } } }, {}, { rang: 8, champ: 'reponse.declaration.raison' });
        await ecart('ligne 8 : le plafond annoncé n\'est pas 3', { 8: { repond: { facturation: F(1, 0, false, 'plafond-jour', 'plafond-jour'), declaration: { rendue: false, raison: 'plafond-probable', plafondJour: 5 }, quota: 0 } } }, {}, { rang: 8, champ: 'reponse.declaration.plafondJour' });
        await ecart('ligne 9 : l\'introuvable n\'est pas remboursé', { 9: { f1: F(1, 0, false, 'introuvable', 'erreur') } }, {}, { rang: 9, champ: 'facturation.debite' });
        await ecart('ligne 9 : l\'introuvable est un autre niveau (sûr)', { 9: { niveau: 'sur', produit: 295460, f1: F(1, 0, false, 'affirmee') } }, {}, { rang: 9, champ: 'issue' });
        { const { res } = await ecart('ligne 3 : la réponse du serveur est un 500', {}, { reponseStatut: 500 }, { rang: 3, champ: 'reponse.statut' }); void res; }
        { const { s } = await ecart('ligne 3 : la lettre de la vérité n\'est pas « a »', { 3: { choix: choix3(11, 658690, 12) } }, {}, { rang: 3, champ: 'declaration envoyee' });
          H.v('   (la déclaration que le tableau ne prévoit pas ne PART pas)', nChemin(s, '/api/identifier/reponse'), 0); }
        { const { s } = await ecart('ligne 3 : la vérité n\'est parmi aucun choix (aucune lettre à déclarer)', { 3: { choix: choix3(11, 12, 13) } }, {}, { rang: 3, champ: 'declaration envoyee' });
          H.v('   (rien n\'est envoyé quand aucune lettre ne désigne la vérité)', nChemin(s, '/api/identifier/reponse'), 0); }
        { const { b, res } = await ecart('ligne 6 : écart au carnet', { 6: { repond: { facturation: F(0, 0, true, 'question'), declaration: { rendue: true, raison: null, plafondJour: 3 }, quota: 0 } } }, {}, { rang: 6, champ: 'quota restant apres' });
          const L = carnetLignes(b.carnet).filter(x => x.compteTest && x.compteTest.rang === 6);
          const ec = (L[0] && L[0].compteTest && L[0].compteTest.ecart) || {};
          H.v('   la ligne fautive est inscrite au carnet AVEC son écart (champ, attendu, observé)', [L.length, ec.champ, ec.attendu, ec.observe], [1, 'quota restant apres', 6, '5']);
          H.v('   le rapport rend l\'écart et le code de sortie 14', [res && res.ecart && res.ecart.rang, res && CT.codeSortie(res)], [6, 14]); }

        // ── 6 ter. une ligne NON JUGÉE (erreur hors Arret : délai dépassé…) arrête la série ; le bilan compte 9 lignes jugées sur 9 ──
        for (const [nom, au, jugees] of [['la ligne 9 (la dernière)', 9, 8], ['la ligne 5 (au milieu)', 5, 4], ['la ligne 1', 1, 0]]) {
            const s = fauxServeur({ photoErreurAu: au }), d = deps(s), b = base();
            const r = await essaie(() => S.serie(b, d)), res = r.ok;
            H.v(`6t. le dépôt de photo expire sur ${nom} : arrêt « LIGNE NON JUGÉE », code 16, ${jugees} lignes jugées, jamais 0`, [res && /LIGNE NON JUGÉE/.test(res.arret || ''), res && CT.codeSortie(res), res && res.resultats.length, res && res.ligneNonJugee && res.ligneNonJugee.rang], [true, 16, jugees, au]);
            H.v('   aucun scan après la ligne non jugée, et rien n\'est « continué »', nChemin(s, '/api/identifier'), au - 1);
            H.v('   la ligne non jugée est au carnet (rang, code d\'erreur)', carnetLignes(b.carnet).filter(x => x.ligneNonJugee).map(x => [x.ligneNonJugee.rang, x.ligneNonJugee.code]), [[au, 'TimeoutError']]);
        }
        H.v('6u. codeSortie : moins de 9 lignes jugées sans arrêt ni écart = 16 (le bilan 9 sur 9 est exigé) ; 9 sur 9 = 0 ; une erreur au tableau = 16',
            [CT.codeSortie({ compteTest: true, resultats: new Array(8).fill({}), arret: null, ecart: null }), CT.codeSortie({ compteTest: true, resultats: new Array(9).fill({}), arret: null, ecart: null }), CT.codeSortie({ compteTest: true, resultats: new Array(9).fill({}), arret: null, ecart: null, erreurs: [{ cle: 'x', code: 'E' }] }), CT.CODE_LIGNE_NON_JUGEE],
            [16, 0, 16, 16]);
        for (const [nom, extra, motif] of [['--n', { n: 3 }, /ne se combine pas avec --n/], ['--graine', { graine: 5 }, /ne se combine pas avec --graine/]]) {
            const s = fauxServeur(); const r = await essaie(() => S.serie(base(extra), deps(s)));
            H.v(`6v. ${nom} avec --compte=ordinaire : REFUSÉ avant toute requête (pas ignoré en silence)`, [motif.test(r.arret || ''), s.appels.length], [true, 0]);
        }
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ n: NaN, graine: NaN }), deps(s)));
          H.v('6w. n et graine absents (NaN : ce que la ligne de commande rend sans l\'option) : la série part', r.arret === undefined, true); }

        // ── 6 quater. LE SECOND ENVOI, comme l'extension : sur un complément, les mesures de production partent à /api/identifier/mesures ; le résultat changé est jugé face aux issues admises de la ligne ──
        const secondEnvoi = async (nom, ecraser, comp = {}, attendu) => {
            const s = fauxServeur({ ecraser, ...comp }), d = deps(s), b = base();
            const r = await essaie(() => S.serie(b, d)), res = r.ok;
            if (!res) H.v(`6q. ${nom} : la série a rendu un résultat`, r.arret, 'un résultat');
            H.v(`6q. ${nom} : ${attendu.ecart ? `écart « ${attendu.ecart} » ligne ${attendu.rang}, code 14` : 'série conforme (9 lignes), code 0'}`,
                attendu.ecart ? [res && res.ecart && res.ecart.rang, res && res.ecart && res.ecart.champ, res && CT.codeSortie(res)] : [res && res.resultats.length, res && res.arret, res && CT.codeSortie(res)],
                attendu.ecart ? [attendu.rang, attendu.ecart, 14] : [9, null, 0]);
            return { s, res, b, d };
        };
        {   // tous les probables (lignes 4 à 8) deviennent probables par le second envoi : la série est conforme, et rien de plus n'est payé
            const { s, res, d } = await secondEnvoi('lignes 4 à 8 : la première réponse est une question + complément, le second envoi la rend probable', { 4: enGroupe(4), 5: enGroupe(5), 6: enGroupe(6), 7: enGroupe(7), 8: enGroupe(8) }, {}, {});
            H.v('   5 seconds envois (lignes 4 à 8), UN par scan, aucun autre ; 9 scans ; la dépense est celle de 9 scans (aucun appel de modèle de plus)', [s.mesuresVues.length, s.mesuresVues.map(m => m.scanId), nChemin(s, '/api/identifier'), res && Math.round(res.depenseUsd * 1e4) / 1e4], [5, ['scan-4', 'scan-5', 'scan-6', 'scan-7', 'scan-8'], 9, 0.0333]);
            const m0 = s.mesuresVues[0] || {};
            H.v('   le corps du second envoi : scanId, le jeton du complément, accepteProbable:true, des résultats validés par le validateur de la production, une Idempotency-Key', [m0.scanId, m0.jeton, m0.accepteProbable, typeof m0.opencv, MC.validerResultats(COMPLEMENT().mesures, m0.resultats || []).ok, typeof (s.appels.find(a => a.chemin === '/api/identifier/mesures') || { entetes: {} }).entetes['Idempotency-Key']], ['scan-4', JETON_MESURES, true, 'string', true, 'string']);
            H.v('   les mesures sont celles de la PRODUCTION : 4 mesures (2 paires, 2 zones) par second envoi, photo grise libérée à chaque fois', [d.journalPx.filter(x => x[0] === 'paire').length, d.journalPx.filter(x => x[0] === 'zones').length, d.journalPx.filter(x => x[0] === 'delete').length], [10, 10, 5]);
            H.v('   le tableau est jugé sur le résultat CHANGÉ : déclarations (b, aucune ×4) envoyées après le second envoi', s.appels.filter(a => a.chemin === '/api/identifier/reponse').map(a => JSON.parse(a.corps).choix), ['a', 'b', 'aucune', 'aucune', 'aucune', 'aucune']);
            H.v('   ordre sur la ligne 4 : identifier, mesures, réponse, solde', chemins(s).slice(chemins(s).lastIndexOf('/api/identifier', chemins(s).indexOf('/api/identifier/mesures')), chemins(s).indexOf('/api/identifier/mesures') + 3), ['/api/identifier', '/api/identifier/mesures', '/api/identifier/reponse', '/api/solde']);
        }
        {   // les trois issues de la ligne 3
            const q = (extra) => ({ complement: true, ...extra });
            await secondEnvoi('ligne 3 : complément, le second envoi ne change rien (change:false) : reste une question, tranchée par « a »', { 3: q({}) }, {}, {});
            const { s } = await secondEnvoi('ligne 3 : le second envoi la promeut SÛRE (un seul débit), aucune déclaration', { 3: q({ mesures: { carte: carteSureDe(658690), facturation: F(1, 0, false, 'question') } }) }, {}, {});
            H.v('   (promotion : rien n\'est déclaré sur la ligne 3)', s.appels.filter(a => a.chemin === '/api/identifier/reponse').map(a => JSON.parse(a.corps).scanId).includes('scan-3'), false);
            const { s: s2 } = await secondEnvoi('ligne 3 : le second envoi la rend probable, confirmée', { 3: q({ mesures: { carte: carteProbableDe(658690, choix3(11, 658690, 12)), facturation: F(1, 0, false, 'question') } }) }, {}, {});
            H.v('   (la confirmation part avec la lettre du probable : b)', s2.appels.filter(a => a.chemin === '/api/identifier/reponse').map(a => JSON.parse(a.corps)).find(x => x.scanId === 'scan-3')?.choix, 'b');
        }
        // les écarts du chemin des mesures
        await secondEnvoi('ligne 4 : la première réponse est une question + complément mais le second envoi ne la rend PAS probable (change:false)', { 4: { niveau: 'question', f1: F(0, 1, false, 'question'), complement: true } }, {}, { rang: 4, ecart: 'issue' });
        await secondEnvoi('ligne 4 : le second envoi rend un probable FAUX', { 4: { ...enGroupe(4), mesures: { carte: carteProbableDe(11, choix3(11, 525395)), facturation: F(1, 0, false, 'question') } } }, {}, { rang: 4, ecart: 'produit' });
        await secondEnvoi('ligne 4 : le second envoi ne DÉBITE pas (second.facturation.debite 0)', { 4: { ...enGroupe(4), mesures: { carte: carteProbableDe(525395, choix3(11, 525395)), facturation: F(0, 1, false, 'question') } } }, {}, { rang: 4, ecart: 'second.facturation.debite' });
        await secondEnvoi('ligne 3 : promue sûre mais le produit n\'est pas la vérité', { 3: { complement: true, mesures: { carte: carteSureDe(11), facturation: F(1, 0, false, 'question') } } }, {}, { rang: 3, ecart: 'produit' });
        await secondEnvoi('ligne 5 : la première réponse est un probable (aucun complément) mais celle de la ligne 6 est une SÛRE (hors liste)', { 6: { niveau: 'sur', produit: 289788, f1: F(1, 0, false, 'affirmee') } }, {}, { rang: 6, ecart: 'issue' });
        {   // un refus du serveur au second envoi : arrêt, rien n'est déclaré, code 1 (ni un écart ni un « conforme »)
            for (const st of [429, 401, 500]) {
                const s = fauxServeur({ ecraser: { 4: enGroupe(4) }, mesuresStatut: st }), d = deps(s), r = await essaie(() => S.serie(base(), d)), res = r.ok;
                H.v(`6q. le second envoi répond ${st} : la série s'ARRÊTE sur la ligne 4, RIEN n'est déclaré sur ce scan, code de sortie non nul, jamais 0`, [res && typeof res.arret === 'string' && res.arret.length > 0, s.appels.filter(a => a.chemin === '/api/identifier/reponse').map(a => JSON.parse(a.corps).scanId).includes('scan-4'), res && CT.codeSortie(res) !== 0, nChemin(s, '/api/identifier')], [true, false, true, 4]);
            }
        }
        {   // les références se lisent SUR LE R2 PUBLIC comme l'extension quand aucun cache local n'est donné
            const s = fauxServeur({ ecraser: { 4: enGroupe(4) } }), d = deps(s, { lireReference: undefined }); const r = await essaie(() => S.serie(base({ scans: undefined }), d));
            H.v('6r. sans cache local, les références sont téléchargées de l\'hôte public (jamais d\'un autre), la série reste conforme', [s.appels.filter(a => a.hote === HOTE_REF_NOM || new URL(a.url).hostname === HOTE_REF_NOM).length > 0, s.appels.every(a => { const h = new URL(a.url).hostname; return h === HOTE_REF_NOM || h === 'rat-market-api-essai.onrender.com'; }), r.ok && r.ok.resultats.length, r.ok && r.ok.arret], [true, true, 9, null]);
        }
        { const s = fauxServeur(); const r = await essaie(() => S.serie({ ...base(), cartes: undefined }, deps(s)));
          H.v('6s. sans --cartes, le second envoi est impossible : refus AVANT toute requête (comme --g-probable)', [/--compte=ordinaire exige --cartes/.test(r.arret || ''), s.appels.length], [true, 0]); }

        // ── 6 bis. CHAQUE champ de la facturation compte, seul, pour chaque issue (le juge pur, sans serveur) ──
        {
            const liste = [];
            for (const t of CT.TABLEAU) for (const i of t.issues) for (const [quoi, f] of [['facturation', i.premiere], ...(i.second ? [['second.facturation', i.second]] : []), ...(i.reponse ? [['reponse.facturation', i.reponse]] : [])]) for (const k of CT.CHAMPS_FACTURATION) {
                const faux = { ...f, [k]: typeof f[k] === 'boolean' ? !f[k] : typeof f[k] === 'number' ? f[k] + 1 : f[k] === null ? 'autre' : `${f[k]}-x` };
                const obsBase = { niveauPremier: i.premier, niveau: i.final, produit: i.final === 'sur' || i.final === 'probable' ? t.verite : null, facturation: i.premiere, facturation2: i.second, choixEnvoye: i.declaration === null ? null : i.declaration === 'aucune' ? 'aucune' : i.lettre || 'b',
                    statutReponse: i.reponse ? 200 : null, reponse: i.reponse ? { facturation: i.reponse, declaration: i.declarationReponse || undefined } : null, restantAvant: 10, restantApres: t.restantApres };
                if (CT.comparerLigne(t, obsBase) !== null) { liste.push([t.rang, i.nom, 'témoin non conforme']); continue; }
                const obs = quoi === 'facturation' ? { ...obsBase, facturation: faux } : quoi === 'second.facturation' ? { ...obsBase, facturation2: faux } : { ...obsBase, reponse: { ...obsBase.reponse, facturation: faux } };
                const e = CT.comparerLigne(t, obs);
                liste.push([t.rang, i.nom, quoi, k, e && e.champ === `${quoi}.${k}`]);
            }
            H.v('6b. pour chaque ligne, chaque issue admise et chaque champ de la facturation (première réponse, second envoi, réponse à la déclaration), en changer UN SEUL est un écart nommé', liste.filter(x => x[x.length - 1] !== true), []);
            const attendu = CT.TABLEAU.flatMap(t => t.issues).reduce((n, i) => n + 5 * (1 + (i.second ? 1 : 0) + (i.reponse ? 1 : 0)), 0);
            H.v('   (dénominateur : issues x facturations x champs comparés ; 16 issues)', [liste.length, attendu, CT.TABLEAU.flatMap(t => t.issues).length], [attendu, attendu, 16]);
            H.v('   et les issues hors liste sont refusées : pour chaque ligne, tous les couples (premier, final) hors liste donnent l\'écart « issue »', CT.TABLEAU.flatMap(t => ['sur', 'question', 'probable', 'introuvable'].flatMap(p => ['sur', 'question', 'probable', 'introuvable'].filter(f => !t.issues.some(i => i.premier === p && i.final === f)).map(f => [t.rang, p, f, (CT.comparerLigne(t, { niveauPremier: p, niveau: f, produit: t.verite }) || {}).champ]))).filter(x => x[3] !== 'issue'), []);
        }

        // ── 7. le dépôt de photo refusé au compte ordinaire : arrêt avant /api/identifier ──
        for (const st of [404, 403, 401]) {
            const s = fauxServeur({ photoStatut: st }), d = deps(s); const r = await essaie(() => S.serie(base(), d)); const res = r.ok;
            H.v(`7. /api/photo répond ${st} au compte ordinaire : ${st === 401 ? 'jeton refusé' : 'PHOTO REFUSÉE'}, ZÉRO appel à /api/identifier`, [nChemin(s, '/api/identifier'), res && typeof res.arret === 'string' && res.arret.length > 0], [0, true]);
            if (st !== 401) H.v('   code de sortie 15, aucun coût inscrit au carnet', [CT.codeSortie(res), res && res.depenseUsd], [15, 0]);
        }
        { const s = fauxServeur({ photoNonRecue: true }); const r = await essaie(() => S.serie(base(), deps(s)));
          H.v('7b. la garde anti-Vinted reste : photoRecue faux -> arrêt à l\'instant, aucune déclaration, aucun solde après', [r.ok && /photo non rattachée/.test(r.ok.arret || ''), nChemin(s, '/api/identifier/reponse')], [true, 0]); }

        // ── 8. l'hôte reste l'essai, et le client d'avant est inchangé sans l'option ──
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ base: 'https://rat-market-api.onrender.com' }), deps(s)));
          H.v('8a. l\'hôte de production reste refusé, zéro requête', [/hôte refusé/.test(r.arret || ''), s.appels.length], [true, 0]); }
        H.v('8b. lireIdentifiants : par défaut le couple de mesure ; avec des noms donnés, l\'autre couple', [S.lireIdentifiants({ ...ENV_MESURE, ...ENV_ORD }, null), S.lireIdentifiants({ ...ENV_MESURE, ...ENV_ORD }, null, undefined, { identifiant: S.NOM_ORDINAIRE_IDENTIFIANT, motDePasse: S.NOM_ORDINAIRE_MOT_DE_PASSE })],
            [{ identifiant: IDENT_MESURE, motDePasse: SECRET_MESURE }, { identifiant: IDENT_ORD, motDePasse: SECRET_ORD }]);
    } finally { globalThis.fetch = fetchGlobal; try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* temporaire */ } }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
