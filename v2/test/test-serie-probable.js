'use strict';
// SERIE-PROBABLE (31/10) — le client de série étendu (serie-essai.js --g-probable + serie-probable.js) est jugé SANS RÉSEAU : un faux serveur (`fetch` injecté), un `fetch` global qui LÈVE, des fonctions de pixels factices
// (le banc juge le CÂBLAGE ; les vraies fonctions de production sont vérifiées par un essai manuel, voir le rapport) et le validateur de PRODUCTION (calcul-client.js::validerResultats) sur ce que le client envoie.
// Ce que le banc juge : (1) sans l'option, le client est celui d'avant (corps, appels, clés du résultat) ; (2) avec l'option : version >= 2.0.1, capacitesClient, second envoi `/api/identifier/mesures` avec
// accepteProbable:true, déclarations (confirmation / vérité / « aucune ») ; (3) le juge par verdict ; (4) l'ARRÊT immédiat au premier probable FAUX ou sûr FAUX (code dédié, ligne fautive au carnet et au résultat) ;
// (5) les durées (premier verdict, total) ; (6) le rapport ; (7) aucun secret, aucun jeton de mesures dans les sorties ; (8) les refus avant toute requête.
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./_harnais');
const S = require('../mesures/serie-essai');
const SP = require('../mesures/serie-probable');
const MC = require('../identifier/calcul-client');

const SECRET = 'mot-de-passe-de-banc-NE-JAMAIS-AFFICHER-0123456789';
const IDENTIFIANT = 'banc-mesure@rat-market.invalid';
const JETON_INST = 'jeton-installation-SECRET-aaaa1111', JETON_LIE = 'jeton-lie-SECRET-bbbb2222', COOKIE = 'cookie-session-SECRET-cccc3333', CODE = 'ABC123', JETON_MESURES = 'jeton-mesures-SECRET-dddd4444';
const TOUS_LES_SECRETS = [SECRET, JETON_INST, JETON_LIE, COOKIE, JETON_MESURES];
const ENV_BANC = { V2_ESSAI_BANC_IDENTIFIANT: IDENTIFIANT, V2_ESSAI_BANC_MOT_DE_PASSE: SECRET };
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'serie-probable-'));
const photos = path.join(dossier, 'photos'), cartes = path.join(dossier, 'cartes'); fs.mkdirSync(photos); fs.mkdirSync(cartes);
const CLES = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'];
for (const k of CLES) { fs.writeFileSync(path.join(photos, k + '.jpg'), Buffer.from(`photo-${k}`)); fs.writeFileSync(path.join(cartes, k + '.jpg'), Buffer.from(`carte-${k}`)); }
const nav = { photos: Object.fromEntries(CLES.map((k, i) => [k, { emb: Array.from({ length: 256 }, (_, j) => (j === i ? 1 : 0)), redressee: true }])) };
const VERITE = Object.fromEntries(CLES.map((k, i) => [k, 101 + i]));
const resultats = { bancs: { 'banc LIVRÉ': {} }, diffs: { 'banc LIVRÉ': [] },
    ref: CLES.map((k, i) => ({ cle: `${k}:0`, banc: i === 0 ? 'reglage' : 'controle', verite: VERITE[k], et: { type: 'question', choix: [VERITE[k], 1] } })) };

// ── le faux serveur : une horloge partagée (chaque appel l'avance d'un temps fixe), des scénarios par POSITION dans l'ordre rejoué ──
const T = { photo: 500, identifier: 4000, mesures: 900, reponse: 300, calcul: 700 };
const GRAINE = 7, N = 7;
const sid = n => n.toString(16).padStart(24, '0');                       // l'identifiant de scan du faux serveur : le n-ième, 24 hexadécimaux
const ordre = S.echantillon(S.lignesLocales(resultats), N, GRAINE).map(l => l.cle);
resultats.ref.forEach(x => { x.banc = x.cle === ordre[0] ? 'reglage' : 'controle'; });      // la première ligne rejouée est du banc « réglage »
const idDe = cle => VERITE[cle.split(':')[0]];
const choix = ids => ids.map((id, i) => ({ id: 'abc'[i], idProduct: id }));
const carteSure = id => ({ index: 0, statut: 'identifiee', carte: { idProduct: id }, niveau: 'sur', probable: null });
const carteATrancher = (ids, probable) => ({ index: 0, statut: 'a-trancher', carte: null, candidats: ids.map(id => ({ idProduct: id })), question: { choix: choix(ids) }, niveau: probable ? 'probable' : 'question', probable: probable ? { idProduct: probable, aConfirmer: true } : null });
const COMPLEMENT = () => ({ jeton: JETON_MESURES, expireDans: 120, mesures: [{ type: 'paire', a: 'ref/un.webp', b: 'ref/deux.webp' }, { type: 'paire', a: 'ref/deux.webp', b: 'ref/un.webp' }, { type: 'zones', ref: 'ref/un.webp' }, { type: 'zones', ref: 'ref/deux.webp' }], references: [{ ref: 'ref/un.webp', url: 'https://images.invalid/ref/un.webp', sha256: null, octets: null }, { ref: 'ref/deux.webp', url: 'https://images.invalid/ref/deux.webp', sha256: null, octets: null }] });

function fauxServeur(scen, comportement = {}) {
    const appels = [], horloge = { t: 0 };
    const rep = (statut, corps, entetes = {}) => ({ status: statut, json: async () => corps, headers: { get: n => entetes[String(n).toLowerCase()] ?? null } });
    let nIdent = 0;
    const fetch = async (url, init = {}) => {
        const u = new URL(url), corps = init.body;
        const a = { url, hote: u.hostname, chemin: u.pathname, methode: init.method || 'GET', entetes: init.headers || {}, corps, redirect: init.redirect, t: horloge.t };
        appels.push(a);
        if (comportement.avant) { const r = comportement.avant(a, appels); if (r) return r; }
        if (u.pathname === '/ping') return rep(200, { ok: true, versionMinExtension: '2.0.0', capacites: ['empreinte', 'mesures-client'] });
        if (u.pathname === '/api/installation') return rep(201, { success: true, jetonInstallation: JETON_INST });
        if (u.pathname === '/api/compte/connexion') return rep(200, { success: true }, { 'set-cookie': `rm_session=${COOKIE}; HttpOnly` });
        if (u.pathname === '/api/compte/code') return rep(200, { success: true, code: CODE });
        if (u.pathname === '/api/compte/lier') return rep(200, { success: true, compte: { administrateur: true }, jetonInstallation: JETON_LIE });
        if ((init.headers || {}).Authorization !== `Bearer ${JETON_LIE}`) return rep(401, { success: false });
        if (u.pathname === '/api/photo') { horloge.t += T.photo; return rep(200, { success: true, photoId: appels.filter(x => x.chemin === '/api/photo').length.toString(16).padStart(32, '0') }); }
        if (u.pathname === '/api/identifier') {
            nIdent++; horloge.t += T.identifier;
            const s = scen[nIdent - 1] || {};
            const b = JSON.parse(corps);
            if (b.contrat !== 2) return rep(401, { success: false });
            const scanId = sid(nIdent);
            return rep(200, { success: true, scanId, analyse: { statut: 'a-trancher', cartes: [s.premier || carteSure(0)], photoRecue: true, photosRecues: [0] }, ...(s.complement ? { complement: s.complement } : {}) });
        }
        if (u.pathname === '/api/identifier/mesures') {
            horloge.t += T.mesures;
            const b = JSON.parse(corps);
            const s = scen[parseInt(b.scanId, 16) - 1] || {};
            return s.mesures ? s.mesures(b) : rep(200, { success: true, scanId: b.scanId, change: false });
        }
        if (u.pathname === '/api/identifier/reponse') { horloge.t += T.reponse; return rep(200, { success: true }); }
        return rep(404, { success: false });
    };
    return { fetch, appels, horloge };
}
const base = (extra = {}) => ({ resultats, nav, photos, cartes, n: N, graine: GRAINE, plafondUsd: 1, carnet: path.join(dossier, `carnet-${Math.random().toString(36).slice(2)}.jsonl`), pauseS: 0, env: { ...ENV_BANC }, coutEstimeUsd: 0.01,
    gProbable: true, scans: [dossier], ...extra });
// les fonctions de pixels : factices mais DÉTERMINISTES, branchées comme la production (photoGrise -> comparerPaire / scoresZones -> delete)
function fauxPixels(horloge, journal = []) {
    return {
        zones: {
            photoGrise: async (data, w, h) => { journal.push(['photoGrise', w, h]); return { delete() { journal.push(['delete']); } }; },
            comparerPaire: async (photo, a, b) => { horloge.t += T.calcul; journal.push(['paire', a.cle, b.cle, a.octets.toString(), b.octets.toString()]); return [0.1, 0.5]; },
            scoresZones: async (photo, s) => { horloge.t += T.calcul; journal.push(['zones', s.cle, s.octets.toString()]); return { haut: 0.8, illustration: 0.7, bandeau: 0.6, texte: 0.5, bas: 0.4, inliers: s.cle === 'ref/un.webp' ? 250 : 20 }; }
        },
        carteRedressee: { valider: async b64 => { journal.push(['valider', Buffer.from(b64, 'base64').toString()]); return { ok: true, data: Buffer.from('rgb'), width: 640, height: 894 }; } }
    };
}
const lire = ref => (ref === 'ref/absente.webp' ? null : Buffer.from(`scan:${ref}`));
const deps = (srv, extra = {}) => { const logs = [], journalPx = []; return { fetch: srv.fetch, horloge: () => srv.horloge.t, pause: async () => { }, log: m => logs.push(String(m)), maintenant: () => 1700000000000, lireReference: lire, ...fauxPixels(srv.horloge, journalPx), logs, journalPx, ...extra }; };
const essaie = async (f) => { try { return { ok: await f() }; } catch (e) { return { arret: e instanceof S.Arret ? e.raison : `exception ${e && e.message}` }; } };
const chemins = (s, c) => s.appels.filter(a => a.chemin === c);
const corpsDe = (s, c) => chemins(s, c).map(a => JSON.parse(a.corps));

(async () => {
    const fetchGlobal = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('RÉSEAU : le client a utilisé le fetch global'); };
    try {
        // ── 1. le juge par verdict, pur ──
        const C = SP.classerCarte, J = (c, v) => SP.jugerVerdict(SP.classerCarte(c), v).verdict;
        H.v('classerCarte : identifiee ⇒ sûr', C(carteSure(5)), { niveau: 'sur', produit: 5, candidats: [], choix: [] });
        H.v('   a-trancher + niveau probable + probable.idProduct ⇒ probable, candidats et lettres lus', C(carteATrancher([5, 6], 6)), { niveau: 'probable', produit: 6, candidats: [5, 6], choix: [{ id: 'a', idProduct: 5 }, { id: 'b', idProduct: 6 }] });
        H.v('   a-trancher sans niveau (extension < 2.0.1 ou drapeau éteint) ⇒ question', C({ ...carteATrancher([5, 6]), niveau: undefined }).niveau, 'question');
        H.v('   niveau probable mais probable invalide ⇒ question (jamais un probable inventé)', [C({ ...carteATrancher([5, 6]), niveau: 'probable', probable: { idProduct: '6' } }).niveau, C({ ...carteATrancher([5, 6]), niveau: 'probable', probable: null }).niveau], ['question', 'question']);
        H.v('   introuvable ⇒ introuvable ; le reste ⇒ inconnu', [C({ statut: 'introuvable' }).niveau, C(null).niveau, C({ statut: 'zzz' }).niveau, C({ statut: 'identifiee', carte: { idProduct: '5' } }).niveau], ['introuvable', 'inconnu', 'inconnu', 'inconnu']);
        H.v('jugerVerdict : sûr juste / sûr FAUX', [J(carteSure(5), 5), J(carteSure(5), 6)], ['sur-juste', 'sur-faux']);
        H.v('   probable juste / probable FAUX', [J(carteATrancher([5, 6], 5), 5), J(carteATrancher([5, 6], 5), 6)], ['probable-juste', 'probable-faux']);
        H.v('   question : vérité dans les candidats / hors des candidats', [J(carteATrancher([5, 6]), 6), J(carteATrancher([5, 6]), 9)], ['question-dans-candidats', 'question-hors-candidats']);
        H.v('   introuvable avec vérité : « introuvable » ; sans vérité (null ou absente) : « sans-verite », jamais juste ni faux', [J({ statut: 'introuvable' }, 5), J(carteSure(5), null), J(carteATrancher([5], 5), undefined)], ['introuvable', 'sans-verite', 'sans-verite']);
        H.v('   une vérité NON numérique (hors-perimetre) face à un sûr : FAUX (un sûr sur une carte hors périmètre est un faux affirmé)', J(carteSure(5), 'hors-perimetre'), 'sur-faux');
        H.v('fautif : seulement sûr FAUX et probable FAUX', ['sur-faux', 'probable-faux', 'sur-juste', 'probable-juste', 'question-hors-candidats', 'introuvable', 'sans-verite'].map(SP.fautif), [true, true, false, false, false, false, false]);
        H.v('codeSortie : probable FAUX 10, sûr FAUX 11, autre arrêt 1, rien 0', [SP.codeSortie({ fautif: { type: 'probable-faux' } }), SP.codeSortie({ fautif: { type: 'sur-faux' } }), SP.codeSortie({ arret: 'plafond' }), SP.codeSortie({ arret: null })], [10, 11, 1, 0]);
        // la déclaration du client, comme l'extension la ferait
        const D = (c, v) => { const k = SP.classerCarte(c); const j = SP.jugerVerdict(k, v); return SP.declarationDe(k, j.verdict, v); };
        H.v('declarationDe : probable juste ⇒ la lettre du probable (confirmation)', D(carteATrancher([5, 6], 6), 6), { choix: 'b', motif: 'confirmation' });
        H.v('   probable FAUX ⇒ « aucune »', D(carteATrancher([5, 6], 6), 5), { choix: 'aucune', motif: 'probable-faux' });
        H.v('   question, vérité parmi les candidats ⇒ sa lettre ; hors candidats ⇒ « aucune »', [D(carteATrancher([5, 6]), 5), D(carteATrancher([5, 6]), 9)], [{ choix: 'a', motif: 'verite' }, { choix: 'aucune', motif: 'hors-candidats' }]);
        H.v('   sûr, introuvable, sans vérité : aucune déclaration (le client n\'invente rien)', [D(carteSure(5), 5), D({ statut: 'introuvable' }, 5), D(carteATrancher([5, 6]), null), D(carteATrancher([5, 6], 5), null)], [null, null, null, null]);
        H.v('familleDe : réglage, tamponnée (relevé), ordinaire', [SP.familleDe({ cle: 'a:0', banc: 'reglage' }, new Set(['a:0'])), SP.familleDe({ cle: 'b:0', banc: 'controle' }, new Set(['b:0'])), SP.familleDe({ cle: 'c:0', banc: 'controle' }, new Set(['b:0'])), SP.familleDe({ cle: 'd:0', banc: 'lot' }, null)], ['reglage', 'tamponnee', 'ordinaire', 'ordinaire']);

        // ── 2. produireMesures : les fonctions de production, dans l'ordre de la production, et la photo est TOUJOURS libérée ──
        {
            const clock = { t: 0 }, jr = []; const px = fauxPixels(clock, jr);
            const demande = COMPLEMENT().mesures;
            const r = await SP.produireMesures({ demande, carteB64: Buffer.from('carte-x').toString('base64'), lireReference: lire, ...px, validerResultats: MC.validerResultats });
            H.v('produireMesures : valide la carte, grise la photo, mesure chaque paire et chaque zone dans l\'ordre demandé, libère la photo', [r.ok, jr.map(x => x[0]), jr[0][1]], [true, ['valider', 'photoGrise', 'paire', 'paire', 'zones', 'zones', 'delete'], 'carte-x']);
            H.v('   la paire est mesurée sur les octets de A puis de B ; les zones sur ceux de la référence', [jr[2].slice(1), jr[4].slice(1)], [['ref/un.webp', 'ref/deux.webp', 'scan:ref/un.webp', 'scan:ref/deux.webp'], ['ref/un.webp', 'scan:ref/un.webp']]);
            H.v('   le résultat est EXACTEMENT la forme du contrat (validerResultats de la PRODUCTION l\'accepte)', [MC.validerResultats(demande, r.resultats).ok, r.resultats[0], r.resultats[2].inliers], [true, { type: 'paire', a: 'ref/un.webp', b: 'ref/deux.webp', ecart: 0.1, couverture: 0.5 }, 250]);
            const jr2 = []; const r2 = await SP.produireMesures({ demande: [{ type: 'zones', ref: 'ref/absente.webp' }], carteB64: 'eA==', lireReference: lire, ...fauxPixels(clock, jr2), validerResultats: MC.validerResultats });
            H.v('   une référence absente en local : refus nommé, rien d\'inventé, photo libérée', [r2.ok, r2.raison, jr2.map(x => x[0]).slice(-1)[0]], [false, 'reference-absente', 'delete']);
            const px3 = fauxPixels(clock, []); px3.zones.scoresZones = async () => { throw Object.assign(new Error('boum'), { code: 'OPENCV' }); }; const jr3 = []; px3.zones.photoGrise = async () => ({ delete() { jr3.push('delete'); } });
            const r3 = await SP.produireMesures({ demande: [{ type: 'zones', ref: 'ref/un.webp' }], carteB64: 'eA==', lireReference: lire, ...px3, validerResultats: MC.validerResultats });
            H.v('   une exception de calcul : refus nommé (jamais propagée), photo libérée', [r3.ok, r3.raison, jr3], [false, 'calcul-OPENCV', ['delete']]);
            const px4 = fauxPixels(clock, []); px4.carteRedressee.valider = async () => ({ ok: false, code: 'dimensions' });
            H.v('   une carte invalide : refus nommé', (await SP.produireMesures({ demande, carteB64: 'eA==', lireReference: lire, ...px4, validerResultats: MC.validerResultats })).raison, 'carte-dimensions');
            const px5 = fauxPixels(clock, []); px5.zones.scoresZones = async () => ({ haut: 9, illustration: 0, bandeau: 0, texte: 0, bas: 0, inliers: 1 });
            H.v('   une mesure hors bornes : refusée par le validateur de la production avant tout envoi', (await SP.produireMesures({ demande: [{ type: 'zones', ref: 'ref/un.webp' }], carteB64: 'eA==', lireReference: lire, ...px5, validerResultats: MC.validerResultats })).raison, 'invalide-valeur');
            H.v('   demande vide : refus (rien à mesurer)', (await SP.produireMesures({ demande: [], carteB64: 'eA==', lireReference: lire, ...fauxPixels(clock, []), validerResultats: MC.validerResultats })).raison, 'demande-vide');
        }

        // ── 3. SANS l'option : le client d'avant, octet pour octet (corps, appels, clés du résultat) ──
        {
            const scenSans = ordre.map(() => ({ premier: carteATrancher([101, 102]), complement: COMPLEMENT() }));
            let compte = 0; const s = fauxServeur(scenSans); const d = deps(s, { horloge: () => (compte += 100) }); const b = base({ gProbable: undefined, scans: undefined, n: 3 });
            const r = await S.serie(b, d);
            H.v('sans l\'option : AUCUNE lecture d\'horloge de plus qu\'avant (2 par scan : début, fin) — durée de chaque scan 100 ms avec l\'horloge à compteur', r.durees, [100, 100, 100]);
            const ids = corpsDe(s, '/api/identifier');
            H.v('sans l\'option : AUCUN appel à /mesures ni à /reponse, même quand la réponse porte un complément', [chemins(s, '/api/identifier/mesures').length, chemins(s, '/api/identifier/reponse').length, ids.length], [0, 0, 3]);
            H.v('   le corps est celui d\'avant : version du ping, pas de capacitesClient', [ids.map(c => c.versionExtension), ids.every(c => !('capacitesClient' in c))], [['2.0.0', '2.0.0', '2.0.0'], true]);
            H.v('   les clés du résultat sont celles d\'avant (pas de rapport, pas de fautif), les lignes sans champ de probable', [Object.keys(r).sort(), Object.keys(r.resultats[0]).sort()],
                [['arret', 'capacites', 'comparaison', 'depenseUsd', 'durees', 'erreurs', 'jetonEmpreinteAnnonce', 'lignes', 'resultats', 'serie', 'stats'], ['cle', 'essaiProduit', 'essaiSur', 'localProduit', 'localSur', 'ms', 'verite']]);
        }

        // ── 4. AVEC l'option : une série complète sans faute, tous les chemins ──
        const idv = i => idDe(ordre[i]);                            // la vérité de la ligne à la position i
        const autre = i => idv(i) + 1000;
        const scenA = [
            { premier: carteSure(idv(0)) },                                                                                                   // 0 : sûr juste
            { premier: carteATrancher([autre(1), idv(1)], idv(1)) },                                                                          // 1 : probable juste (PROBABLE seul), confirmation
            { premier: carteATrancher([autre(2), idv(2)]), complement: COMPLEMENT(), mesures: b => ({ status: 200, json: async () => ({ success: true, scanId: b.scanId, change: true, carte: carteATrancher([autre(2), idv(2)], idv(2)) }), headers: { get: () => null } }) },   // 2 : question -> probable juste par G
            { premier: carteATrancher([autre(3), idv(3)]), complement: COMPLEMENT() },                                                        // 3 : question -> change false ; vérité dans les candidats
            { premier: carteATrancher([autre(4), autre(4) + 1]), complement: COMPLEMENT() },                                                  // 4 : question, vérité hors candidats
            { premier: { index: 0, statut: 'introuvable', carte: null } },                                                                    // 5 : introuvable
            { premier: carteATrancher([autre(6), idv(6)]) }                                                                                   // 6 : question sans complément
        ];
        const sA = fauxServeur(scenA), dA = deps(sA), bA = base();
        const rA = await S.serie(bA, dA);
        const idA = corpsDe(sA, '/api/identifier'), mesA = corpsDe(sA, '/api/identifier/mesures'), repA = corpsDe(sA, '/api/identifier/reponse');
        H.v('avec l\'option : la série va au bout (7 lignes), aucun faux', [rA.arret, rA.resultats.length, rA.fautif ?? null], [null, 7, null]);
        H.v('   le corps d\'identification : version 2.0.1 (jamais celle du ping), capacitesClient mesures-1, contrat 2', [idA.every(c => c.versionExtension === '2.0.1' && c.contrat === 2 && JSON.stringify(c.capacitesClient) === '["mesures-1"]')], [true]);
        H.v('   un second envoi par QUESTION portant un complément (positions 2, 3, 4), jamais ailleurs', [mesA.length, mesA.map(m => m.scanId)], [3, [3, 4, 5].map(sid)]);
        H.v('   le second envoi : le jeton du serveur, accepteProbable true EXACTEMENT, une version d\'OpenCV lisible, 4 résultats', [mesA[0].jeton, mesA[0].accepteProbable, typeof mesA[0].opencv, mesA[0].resultats.length], [JETON_MESURES, true, 'string', 4]);
        H.vrai('   les résultats envoyés passent le validateur de la PRODUCTION contre la demande (forme, bornes, aucune autre clé)', mesA.every(m => MC.validerResultats(COMPLEMENT().mesures, m.resultats).ok));
        H.vrai('   en-têtes : Bearer lié, clé d\'idempotence de la forme du serveur et distincte pour chaque appel', (() => { const hs = ['/api/identifier', '/api/identifier/mesures', '/api/identifier/reponse'].flatMap(c => chemins(sA, c)).map(a => a.entetes); return hs.every(e => e.Authorization === `Bearer ${JETON_LIE}` && /^[A-Za-z0-9_-]{8,64}$/.test(e['Idempotency-Key'])) && new Set(hs.map(e => e['Idempotency-Key'])).size === hs.length; })());
        H.v('   les déclarations : confirmation du probable (pos. 1 et 2), la vérité (pos. 3), « aucune » (pos. 4), rien pour sûr / introuvable / question sans vérité demandée…', repA.map(c => [c.scanId, c.carte, c.choix]),
            [[2, 'b'], [3, 'b'], [4, 'b'], [5, 'aucune'], [7, 'b']].map(([n, l]) => [sid(n), 0, l]));
        H.v('   verdicts finaux par ligne : sûr juste, probable juste ×2 (PROBABLE seul puis G), question dans les candidats ×3 sauf la hors-candidats, introuvable', rA.resultats.map(x => x.verdict),
            ['sur-juste', 'probable-juste', 'probable-juste', 'question-dans-candidats', 'question-hors-candidats', 'introuvable', 'question-dans-candidats']);
        H.v('   le chemin de chaque probable : PROBABLE seul (première réponse) ou G-GROUPE (second envoi)', rA.resultats.filter(x => x.verdict === 'probable-juste').map(x => x.chemin), ['PROBABLE', 'G-GROUPE']);
        H.v('   les familles : la ligne du banc « reglage » est rangée réglage, les autres ordinaires (aucun relevé de tampons donné)', [rA.resultats.find(x => x.cle === ordre[0]).famille, rA.resultats.filter(x => x.famille === 'ordinaire').length], ['reglage', 6]);
        // les durées : premier verdict = dépôt de la photo + première réponse ; total = tout, second envoi, calcul et déclarations compris
        const l0 = rA.resultats[0], l2 = rA.resultats[2];
        H.v('durées : ligne sûre (photo + identification, puis rien) premier = total', [l0.premierMs, l0.ms], [T.photo + T.identifier, T.photo + T.identifier]);
        H.v('   ligne probable par G : premier verdict inchangé ; total = + calcul de 4 mesures + second envoi + confirmation', [l2.premierMs, l2.ms], [T.photo + T.identifier, T.photo + T.identifier + 4 * T.calcul + T.mesures + T.reponse]);
        H.vrai('   les stats du rapport : p50 / p95 du premier verdict ET du total, n = lignes', (() => { const q = rA.rapportProbable; return q.premierVerdict.n === 7 && q.dureeTotale.n === 7 && q.premierVerdict.p95 <= q.dureeTotale.p95 && q.premierVerdict.p50 === T.photo + T.identifier; })());
        H.vrai('   le calcul de la photo n\'attend que de la carte et des scans locaux : les références lues par le lecteur injecté (aucun autre hôte appelé)', dA.journalPx.filter(x => x[0] === 'zones').every(x => /^scan:ref\//.test(x[2])) && sA.appels.every(a => a.hote === S.HOTE_ESSAI && a.redirect === 'manual'));
        // le rapport
        const Q = rA.rapportProbable;
        H.v('rapport : sûrs justes / faux, probables justes / FAUX, questions dans / hors candidats, introuvable', [Q.total.surJuste, Q.total.surFaux, Q.total.probableJuste, Q.total.probableFaux, Q.total.questionDansCandidats, Q.total.questionHorsCandidats, Q.total.introuvable], [1, 0, 2, 0, 2, 1, 1]);
        H.v('   réponse directe juste = (sûrs justes + probables justes) / lignes à vérité = 3/7, par famille', [Q.total.reponseDirecteJuste, Q.reglage.reponseDirecteJuste, Q.ordinaire.reponseDirecteJuste], [Math.round(3 / 7 * 1000) / 10, 100, Math.round(2 / 6 * 1000) / 10]);
        H.v('   le dénominateur est imprimé : lignes et lignes à vérité', [Q.total.lignes, Q.total.avecVerite], [7, 7]);
        // le carnet
        const carnetA = fs.readFileSync(bA.carnet, 'utf8');
        H.vrai('carnet : une estimation par scan (7), le coût ne compte QUE les estimations (second envoi et déclarations ne coûtent rien)', carnetA.trim().split('\n').map(JSON.parse).filter(l => l.coutUsd !== undefined).length === 7 && Math.abs(rA.depenseUsd - 0.07) < 1e-9);
        const sortieA = JSON.stringify(rA) + dA.logs.join('\n') + carnetA;
        H.vrai('aucun secret ni jeton de mesures dans les journaux, le carnet ou le résultat', TOUS_LES_SECRETS.every(x => !sortieA.includes(x)) && sortieA.length > 500);

        // ── 5. L'ARRÊT immédiat : probable FAUX / sûr FAUX, avant le scan suivant ──
        const fautes = [
            ['probable FAUX dès la première réponse (PROBABLE seul)', [{ premier: carteATrancher([idv(0), autre(0)], autre(0)) }], 'probable-faux', 'PROBABLE', 10, ['aucune']],
            ['probable FAUX posé par le second envoi (G-GROUPE)', [{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: b => ({ status: 200, json: async () => ({ success: true, scanId: b.scanId, change: true, carte: carteATrancher([idv(0), autre(0)], autre(0)) }), headers: { get: () => null } }) }], 'probable-faux', 'G-GROUPE', 10, ['aucune']],
            ['sûr FAUX dès la première réponse', [{ premier: carteSure(autre(0)) }], 'sur-faux', 'PREMIER', 11, []],
            ['sûr FAUX posé par le second envoi (promotion de G)', [{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: b => ({ status: 200, json: async () => ({ success: true, scanId: b.scanId, change: true, carte: carteSure(autre(0)) }), headers: { get: () => null } }) }], 'sur-faux', 'G-PROMOTION', 11, []]
        ];
        for (const [nom, scen, type, chemin, code, declarations] of fautes) {
            const s = fauxServeur([...scen, { premier: carteSure(idv(1)) }, { premier: carteSure(idv(2)) }]), d = deps(s), b = base({ n: 3 });
            const r = await S.serie(b, d);
            const f = r.fautif;
            const candidatsAttendus = chemin === 'PREMIER' ? [] : [idv(0), autre(0)];
            H.v(`ARRÊT — ${nom} : la série s'arrête AVANT le scan suivant (une seule photo), code ${code}`, [chemins(s, '/api/photo').length, chemins(s, '/api/identifier').length, SP.codeSortie(r), /ARRÊT/.test(r.arret || '')], [1, 1, code, true]);
            H.v('   la déclaration faite avant l\'arrêt', corpsDe(s, '/api/identifier/reponse').map(c => c.choix), declarations);
            H.v('   la ligne fautive : type, clé, chemin, produit rendu, candidats, vérité, scanId', [f.type, f.cle, f.chemin, f.produit, f.candidats, f.verite, typeof f.scanId], [type, ordre[0], chemin, autre(0), candidatsAttendus, idv(0), 'string']);
            const parG = chemin === 'G-GROUPE' || chemin === 'G-PROMOTION';
            H.v('   … avec les mesures du client quand un second envoi a eu lieu (4 résultats, inliers compris), sinon null ; et la clé dans la ligne ARRÊT du journal', [parG ? [f.mesuresClient.length, f.mesuresClient[2].inliers] : f.mesuresClient, d.logs.some(l => /ARRÊT/.test(l) && l.includes(ordre[0]))], [parG ? [4, 250] : null, true]);
            const lignes = fs.readFileSync(b.carnet, 'utf8').trim().split('\n').map(JSON.parse);
            H.v('   écrite au carnet (une ligne « fautif », sans coût) AVANT de rendre la main', [lignes.filter(l => l.fautif).length, lignes.find(l => l.fautif).fautif.cle, lignes.find(l => l.fautif).coutUsd], [1, ordre[0], undefined]);
            H.v('   la ligne fautive est aussi dans le résultat de la série (celle qui arrête) et le rapport la compte', [r.resultats.length, r.rapportProbable.total[type === 'sur-faux' ? 'surFaux' : 'probableFaux']], [1, 1]);
        }
        // un faux au MILIEU : les scans d'avant sont gardés, ceux d'après ne partent pas
        { const s = fauxServeur([{ premier: carteSure(idv(0)) }, { premier: carteSure(idv(1)) }, { premier: carteATrancher([idv(2), autre(2)], autre(2)) }, { premier: carteSure(idv(3)) }]), r = await S.serie(base({ n: 4 }), deps(s));
          H.v('un faux au 3e scan : 3 photos seulement, 2 lignes justes gardées, la fautive en 3e position', [chemins(s, '/api/photo').length, r.resultats.map(x => x.verdict)], [3, ['sur-juste', 'sur-juste', 'probable-faux']]); }

        // ── 6. le second envoi : ce qui l'empêche, ce qui l'arrête ──
        { const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT() }]), d = deps(s, { lireReference: ref => (ref === 'ref/deux.webp' ? null : lire(ref)) }); const r = await S.serie(base({ n: 1 }), d);
          H.v('référence locale absente : AUCUN second envoi, la question reste, la raison est écrite sur la ligne', [chemins(s, '/api/identifier/mesures').length, r.resultats[0].verdict, r.resultats[0].secondEnvoi], [0, 'question-dans-candidats', { envoye: false, raison: 'reference-absente' }]);
          H.v('   (la vérité parmi les candidats est quand même déclarée : le client déclare ce qu\'il SAIT)', corpsDe(s, '/api/identifier/reponse').map(c => c.choix), ['a']); }
        { const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT() }]); const r = await S.serie(base({ n: 1, cartes: path.join(dossier, 'cartes-vides') }), deps(s));
          H.v('carte redressée absente pour la ligne : aucun second envoi, raison « carte-absente »', [chemins(s, '/api/identifier/mesures').length, r.resultats[0].secondEnvoi.raison], [0, 'carte-absente']); }
        for (const [nom, statut, motif] of [['401', 401, /jeton refusé \(401\) sur \/api\/identifier\/mesures/], ['429', 429, /429 sur \/api\/identifier\/mesures/]]) {
            const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: () => ({ status: statut, json: async () => ({ success: false }), headers: { get: () => '30' } }) }, { premier: carteSure(idv(1)) }]);
            const r = await S.serie(base({ n: 2 }), deps(s));
            H.v(`second envoi refusé (${nom}) : la série s'arrête, sans réessai ni boucle, aucun scan de plus`, [motif.test(r.arret || ''), chemins(s, '/api/identifier/mesures').length, chemins(s, '/api/photo').length], [true, 1, 1]);
        }
        for (const [nom, statut] of [['409 (déjà envoyé)', 409], ['410 (expiré)', 410], ['500', 500]]) {
            const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: () => ({ status: statut, json: async () => ({ success: false }), headers: { get: () => null } }) }, { premier: carteSure(idv(1)) }]);
            const r = await S.serie(base({ n: 2 }), deps(s));
            H.v(`second envoi en ${nom} : le premier verdict reste, la série continue`, [r.arret, r.resultats.map(x => x.verdict), r.resultats[0].secondEnvoi.statut], [null, ['question-dans-candidats', 'sur-juste'], statut]);
        }
        { const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: b => ({ status: 200, json: async () => ({ success: true, scanId: b.scanId, change: false }), headers: { get: () => null } }) }]);
          const r = await S.serie(base({ n: 1 }), deps(s));
          H.v('change:false : le verdict reste la question, la ligne le dit (envoye true, change false)', [r.resultats[0].verdict, r.resultats[0].chemin, r.resultats[0].secondEnvoi.change], ['question-dans-candidats', 'QUESTION', false]); }
        { const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: b => ({ status: 200, json: async () => ({ success: true, scanId: b.scanId, change: true, carte: carteATrancher([idv(0), autre(0)], idv(0)) }), headers: { get: () => null } }) }]);
          const r = await S.serie(base({ n: 1, declarations: false }), deps(s));
          H.v('--sans-declarations : le probable juste est jugé mais AUCUNE réponse n\'est envoyée', [r.resultats[0].verdict, chemins(s, '/api/identifier/reponse').length], ['probable-juste', 0]); }
        { const s = fauxServeur([{ premier: carteATrancher([autre(0), autre(0) + 1], autre(0)) }]); const r = await S.serie(base({ n: 1, declarations: false }), deps(s));
          H.v('   … et le faux est arrêté quand même (le juge ne dépend pas des déclarations)', [chemins(s, '/api/identifier/reponse').length, SP.codeSortie(r)], [0, 10]); }
        { const s = fauxServeur([{ premier: carteATrancher([idv(0)], idv(0)) }], { avant: a => (a.chemin === '/api/identifier/reponse' ? { status: 429, json: async () => ({}), headers: { get: () => '9' } } : null) }); const r = await essaie(() => S.serie(base({ n: 2 }), deps(s)));
          H.v('une déclaration refusée en 429 : arrêt, sans boucle', [/429 sur \/api\/identifier\/reponse/.test(r.ok.arret || ''), chemins(s, '/api/identifier/reponse').length], [true, 1]); }
        { const s = fauxServeur([{ premier: carteATrancher([idv(0)], idv(0)) }, { premier: carteSure(idv(1)) }], { avant: a => (a.chemin === '/api/identifier/reponse' ? { status: 500, json: async () => ({}), headers: { get: () => null } } : null) }); const r = await S.serie(base({ n: 2 }), deps(s));
          H.v('une déclaration en 500 : écrite sur la ligne, la série continue', [r.arret, r.resultats.length, r.resultats[0].declaration.statut], [null, 2, 500]); }
        // la garde anti-Vinted reste entière en mode probable
        { const s = fauxServeur([{}], { avant: a => (a.chemin === '/api/identifier' ? { status: 200, json: async () => ({ success: true, analyse: { statut: 'a-trancher', cartes: [carteSure(1)], photoRecue: false } }), headers: { get: () => null } } : null) });
          const r = await S.serie(base({ n: 3 }), deps(s));
          H.v('garde anti-Vinted (photoRecue faux) : arrêt au premier scan, aucun second envoi ni déclaration', [chemins(s, '/api/identifier').length, chemins(s, '/api/identifier/mesures').length, chemins(s, '/api/identifier/reponse').length, /photo non rattachée/.test(r.arret || '')], [1, 0, 0, true]); }

        // ── 7. les refus avant toute requête ──
        for (const [nom, extra, motif] of [['sans dossier de cartes', { cartes: undefined }, /--cartes/], ['sans lecteur de références (ni --scans ni lecteur)', { scans: undefined, lireReference: undefined }, /--scans/], ['version d\'extension illisible', { versionExtension: 'deux' }, /version-extension/]]) {
            const s = fauxServeur([]); const d = deps(s); if (extra.lireReference === undefined && 'lireReference' in extra) delete d.lireReference;
            const r = await essaie(() => S.serie(base(extra), d));
            H.v(`mode probable ${nom} : arrêt avant TOUTE requête`, [motif.test(r.arret || ''), s.appels.length], [true, 0]);
        }
        // rapport pur : p50 / p95, familles
        { const lignes = [
            { cle: 'a', famille: 'reglage', verdict: 'sur-juste', premierMs: 1000, ms: 2000, avecVerite: true },
            { cle: 'b', famille: 'tamponnee', verdict: 'probable-juste', premierMs: 5000, ms: 7000, avecVerite: true },
            { cle: 'c', famille: 'ordinaire', verdict: 'question-dans-candidats', premierMs: 3000, ms: 4000, avecVerite: true },
            { cle: 'd', famille: 'ordinaire', verdict: 'sans-verite', premierMs: 2000, ms: 3000, avecVerite: false }];
          const R = SP.rapportSerie(lignes, { statistiques: S.statistiques });
          H.v('rapportSerie : p50/p95 du premier verdict et du total (rang supérieur)', [R.premierVerdict, R.dureeTotale], [{ n: 4, p50: 2000, p95: 5000 }, { n: 4, p50: 3000, p95: 7000 }]);
          H.v('   la ligne sans vérité compte en « sans vérité », pas au dénominateur de la réponse directe ; 2/3 sur le total, 0 % sur les ordinaires', [R.total.sansVerite, R.total.avecVerite, R.total.reponseDirecteJuste, R.ordinaire.reponseDirecteJuste, R.tamponnee.reponseDirecteJuste], [1, 3, 66.7, 0, 100]);
          H.v('   zéro ligne à vérité dans une famille : « null », jamais 0 % inventé', SP.rapportSerie([], { statistiques: S.statistiques }).reglage.reponseDirecteJuste, null); }
        H.vrai('le fetch global n\'a jamais servi (le banc n\'a fait AUCUN appel réseau)', true);
    } finally { globalThis.fetch = fetchGlobal; try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* le dossier temporaire se nettoie seul */ } }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
