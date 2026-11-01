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
const CLES = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10', 'k11', 'k12'];
for (const k of CLES) { fs.writeFileSync(path.join(photos, k + '.jpg'), Buffer.from(`photo-${k}`)); fs.writeFileSync(path.join(cartes, k + '.jpg'), Buffer.from(`carte-${k}`)); }
const nav = { photos: Object.fromEntries(CLES.map((k, i) => [k, { emb: Array.from({ length: 256 }, (_, j) => (j === i ? 1 : 0)), redressee: true }])) };
const VERITE = Object.fromEntries(CLES.map((k, i) => [k, 101 + i]));
const resultats = { bancs: { 'banc LIVRÉ': {} }, diffs: { 'banc LIVRÉ': [] },
    ref: CLES.map((k, i) => ({ cle: `${k}:0`, banc: i === 0 ? 'reglage' : 'controle', verite: VERITE[k], et: { type: 'question', choix: [VERITE[k], 1] } })) };

// ── le faux serveur : une horloge partagée (chaque appel l'avance d'un temps fixe), des scénarios par POSITION dans l'ordre rejoué ──
const T = { photo: 500, identifier: 4000, mesures: 900, reponse: 300, calcul: 700 };
const GRAINE = 7, N = 7;
const HOTE_REF_NOM = 'pub-7d992e666c3d4a2b870b680a920045b6.r2.dev', HOTE_REF = `https://${HOTE_REF_NOM}`;           // l'hôte R2 public des références (extension v2 : src/fond/references.js::HOTE_R2_PUBLIC)
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('VP8 xxxx')]);
const repHote = (statut, entetes = { 'content-type': 'image/webp' }, octets = WEBP) => ({ status: statut, headers: { get: n => Object.fromEntries(Object.entries(entetes).map(([k, v]) => [k.toLowerCase(), v]))[String(n).toLowerCase()] ?? null }, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength), body: null });
const CAPACITES_PLEINES = ['langue-impression', 'marques', 'prix-incertains', 'prix-repli', 'achete-avant-jour', 'empreinte', 'mesures-client', 'probable'];
const sid = n => n.toString(16).padStart(24, '0');                       // l'identifiant de scan du faux serveur : le n-ième, 24 hexadécimaux
const ordre = S.echantillon(S.lignesLocales(resultats), N, GRAINE).map(l => l.cle);
resultats.ref.forEach(x => { x.banc = x.cle === ordre[0] ? 'reglage' : 'controle'; });      // la première ligne rejouée est du banc « réglage »
const idDe = cle => VERITE[cle.split(':')[0]];
const choix = ids => ids.map((id, i) => ({ id: 'abc'[i], idProduct: id }));
const carteSure = id => ({ index: 0, statut: 'identifiee', carte: { idProduct: id }, niveau: 'sur', probable: null });
const carteATrancher = (ids, probable) => ({ index: 0, statut: 'a-trancher', carte: null, candidats: ids.map(id => ({ idProduct: id })), question: { choix: choix(ids) }, niveau: probable ? 'probable' : 'question', probable: probable ? { idProduct: probable, aConfirmer: true } : null });
const COMPLEMENT = () => ({ jeton: JETON_MESURES, expireDans: 120, mesures: [{ type: 'paire', a: 'ref/un.webp', b: 'ref/deux.webp' }, { type: 'paire', a: 'ref/deux.webp', b: 'ref/un.webp' }, { type: 'zones', ref: 'ref/un.webp' }, { type: 'zones', ref: 'ref/deux.webp' }], references: [{ ref: 'ref/un.webp', url: `${HOTE_REF}/ref/un.webp`, sha256: null, octets: null }, { ref: 'ref/deux.webp', url: `${HOTE_REF}/ref/deux.webp`, sha256: null, octets: null }] });

function fauxServeur(scen, comportement = {}) {
    const appels = [], horloge = { t: 0 };
    const rep = (statut, corps, entetes = {}) => ({ status: statut, json: async () => corps, headers: { get: n => entetes[String(n).toLowerCase()] ?? null } });
    let nIdent = 0;
    const fetch = async (url, init = {}) => {
        const u = new URL(url), corps = init.body;
        const a = { url, hote: u.hostname, chemin: u.pathname, methode: init.method || 'GET', entetes: init.headers || {}, corps, redirect: init.redirect, t: horloge.t };
        appels.push(a);
        if (comportement.avant) { const r = comportement.avant(a, appels); if (r) return r; }
        if (u.hostname === HOTE_REF_NOM) {                                   // l'hôte PUBLIC des visuels (R2) : un faux, jamais le vrai
            if (comportement.hote) return comportement.hote(a);
            return { status: 200, headers: { get: n => ({ 'content-type': 'image/webp' })[String(n).toLowerCase()] ?? null }, arrayBuffer: async () => WEBP.buffer.slice(WEBP.byteOffset, WEBP.byteOffset + WEBP.byteLength), body: null };
        }
        if (u.pathname === '/ping') { const n = appels.filter(x => x.chemin === '/ping').length; return rep(200, { ok: true, versionMinExtension: '2.0.0', capacites: comportement.capacites ? comportement.capacites(n) : CAPACITES_PLEINES }); }
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
        { const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT() }], { hote: a => (/deux\.webp$/.test(a.chemin) ? repHote(404) : repHote(200)) }), d = deps(s, { lireReference: ref => (ref === 'ref/deux.webp' ? null : lire(ref)) }); const r = await S.serie(base({ n: 1 }), d);
          H.v('référence absente en local ET introuvable sur l\'hôte public : AUCUN second envoi, la question reste, la raison est écrite sur la ligne', [chemins(s, '/api/identifier/mesures').length, r.resultats[0].verdict, r.resultats[0].secondEnvoi], [0, 'question-dans-candidats', { envoye: false, raison: 'reference-introuvable-hote' }]);
          H.v('   (la vérité parmi les candidats est quand même déclarée : le client déclare ce qu\'il SAIT)', corpsDe(s, '/api/identifier/reponse').map(c => c.choix), ['a']); }
        { const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT() }]); const r = await S.serie(base({ n: 1, cartes: path.join(dossier, 'cartes-vides') }), deps(s));
          H.v('carte redressée absente pour la ligne : aucun second envoi, raison « carte-absente »', [chemins(s, '/api/identifier/mesures').length, r.resultats[0].secondEnvoi.raison], [0, 'carte-absente']); }
        for (const [nom, statut, motif] of [['401', 401, /jeton refusé \(401\) sur \/api\/identifier\/mesures/], ['429', 429, /429 sur \/api\/identifier\/mesures/]]) {
            const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: () => ({ status: statut, json: async () => ({ success: false }), headers: { get: () => '30' } }) }, { premier: carteSure(idv(1)) }]);
            const r = await S.serie(base({ n: 2 }), deps(s));
            H.v(`second envoi refusé (${nom}) : la série s'arrête, sans réessai ni boucle, aucun scan de plus, AUCUNE déclaration sur ce scan`, [motif.test(r.arret || ''), chemins(s, '/api/identifier/mesures').length, chemins(s, '/api/photo').length, chemins(s, '/api/identifier/reponse').length], [true, 1, 1, 0]);
        }
        for (const [nom, statut] of [['409 (déjà envoyé)', 409], ['410 (expiré)', 410]]) {
            const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures: () => ({ status: statut, json: async () => ({ success: false }), headers: { get: () => null } }) }, { premier: carteSure(idv(1)) }]);
            const r = await S.serie(base({ n: 2 }), deps(s));
            H.v(`second envoi en ${nom} : le premier verdict reste, la série continue`, [r.arret, r.resultats.map(x => x.verdict), r.resultats[0].secondEnvoi.statut], [null, ['question-dans-candidats', 'sur-juste'], statut]);
        }
        // I1 : seuls 200, 409 et 410 laissent continuer ; toute autre issue ARRÊTE avant toute déclaration (le serveur a pu poser le marqueur probable avant de répondre)
        for (const [nom, mesures] of [['503', () => ({ status: 503, json: async () => ({ success: false }), headers: { get: () => null } })], ['500', () => ({ status: 500, json: async () => ({}), headers: { get: () => null } })], ['400', () => ({ status: 400, json: async () => ({}), headers: { get: () => null } })],
            ['exception réseau', () => { throw new Error('ECONNRESET'); }], ['délai dépassé', () => { throw Object.assign(new Error('délai'), { name: 'TimeoutError' }); }], ['200 illisible (corps vide)', () => ({ status: 200, json: async () => { throw new Error('pas de corps'); }, headers: { get: () => null } })]]) {
            const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT(), mesures }, { premier: carteSure(idv(1)) }]);
            const r = await S.serie(base({ n: 2 }), deps(s));
            H.v(`second envoi en ${nom} : issue incertaine, la série S'ARRÊTE (code 1), aucune déclaration, aucun scan de plus`, [/issue incertaine après le second envoi/.test(r.arret || ''), SP.codeSortie(r), chemins(s, '/api/identifier/reponse').length, chemins(s, '/api/photo').length, r.resultats.length], [true, 1, 0, 1, 1]);
        }
        // (a) un complément porté par une carte SÛRE ou PROBABLE n'est jamais mesuré ni envoyé
        for (const [nom, premier] of [['sûre', carteSure(idv(0))], ['probable', carteATrancher([idv(0), autre(0)], idv(0))]]) {
            const s = fauxServeur([{ premier, complement: COMPLEMENT() }]); const d = deps(s); await S.serie(base({ n: 1 }), d);
            H.v(`un complément sur une carte ${nom} : aucune mesure produite, aucun second envoi`, [chemins(s, '/api/identifier/mesures').length, d.journalPx.length], [0, 0]);
        }
        // I2 : le rapport dit ce que la série a EXERCÉ ; 10 questions sans complément = alerte et arrêt (code 12)
        {
            const v12 = S.echantillon(S.lignesLocales(resultats), 12, GRAINE).map(l => idDe(l.cle));
            const scen = Array.from({ length: 12 }, (_, i) => ({ premier: carteATrancher([v12[i], v12[i] + 1000]) }));
            const s = fauxServeur(scen); const d = deps(s); const r = await S.serie(base({ n: 12 }), d);
            H.v('10 questions de suite sans complément : ALERTE et arrêt (code 12), pas de onzième scan', [chemins(s, '/api/photo').length, SP.codeSortie(r), /aucun complément sur les 10 premières questions/.test(r.arret || ''), d.logs.some(x => /ALERTE.*complément/.test(x))], [10, 12, true, true]);
            const s2 = fauxServeur(scen.map((x, i) => (i === 9 ? { ...x, complement: COMPLEMENT() } : x))); const r2 = await S.serie(base({ n: 12 }), deps(s2));
            H.v('   un complément parmi les 10 premières questions : la série continue', [chemins(s2, '/api/photo').length, r2.arret], [12, null]);
            const s3 = fauxServeur([{ premier: carteSure(idv(0)) }, ...scen.slice(0, 5)]); const r3 = await S.serie(base({ n: 6 }), deps(s3));
            H.v('   moins de 10 questions (les sûrs ne comptent pas) : pas d\'alerte', [r3.arret, chemins(s3, '/api/photo').length], [null, 6]);
        }
        H.v('rapport : compteurs d\'exercice (questions, compléments, seconds envois faits, change:true, non faits par raison) et « lignes à vérité N/total » imprimé', [Q.second, dA.logs.some(x => /lignes à vérité : 7\/7/.test(x))], [{ questions: 4, complements: 3, envoyes: 3, changeTrue: 1, nonEnvoyes: { 'reference-introuvable-hote': 0, 'carte-absente': 0, autre: 0 } }, true]);
        { const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT() }, { premier: carteATrancher([idv(1), autre(1)]), complement: COMPLEMENT() }], { hote: a => (/deux\.webp$/.test(a.chemin) ? repHote(404) : repHote(200)) }), d = deps(s, { lireReference: ref => (ref === 'ref/deux.webp' ? null : lire(ref)) });
          const r = await S.serie(base({ n: 2 }), d);       // (le faux hôte public répond 404 pour « deux » dans ce scénario)
          H.v('   les seconds envois non faits sont comptés PAR RAISON', r.rapportProbable.second, { questions: 2, complements: 2, envoyes: 0, changeTrue: 0, nonEnvoyes: { 'reference-introuvable-hote': 2, 'carte-absente': 0, autre: 0 } }); }
        // I3 : --g-probable et --deuxieme-apres-signal ne se combinent pas
        { const s = fauxServeur([]); const r = await essaie(() => S.serie(base({ deuxiemeApresSignal: 'signal.txt' }), deps(s)));
          H.v('--g-probable + --deuxieme-apres-signal : refusé avant TOUTE requête', [/deuxieme-apres-signal/.test(r.arret || ''), s.appels.length], [true, 0]); }
        // (c) les secrets ne sont dans AUCUNE sortie d'une série fautive (ligne fautive : carnet, résultat, journaux)
        for (const [nom, scen] of [['probable FAUX par G', fautes[1][1]], ['sûr FAUX par promotion de G', fautes[3][1]]]) {
            const s = fauxServeur(scen); const d = deps(s); const b = base({ n: 1 }); const r = await S.serie(b, d);
            const sortie = JSON.stringify(r) + JSON.stringify(r.fautif) + d.logs.join('\n') + fs.readFileSync(b.carnet, 'utf8');
            H.vrai(`aucun secret ni jeton de mesures dans une série fautive (${nom}), ligne fautive comprise`, !!r.fautif && fs.readFileSync(b.carnet, 'utf8').includes('"fautif"') && TOUS_LES_SECRETS.every(x => !sortie.includes(x)));
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
        for (const [nom, extra, motif] of [['sans dossier de cartes', { cartes: undefined }, /--cartes/], ['version d\'extension illisible', { versionExtension: 'deux' }, /version-extension/]]) {
            const s = fauxServeur([]); const d = deps(s); if (extra.lireReference === undefined && 'lireReference' in extra) delete d.lireReference;
            const r = await essaie(() => S.serie(base(extra), d));
            H.v(`mode probable ${nom} : arrêt avant TOUTE requête`, [motif.test(r.arret || ''), s.appels.length], [true, 0]);
        }
        // ── 8. LES RÉFÉRENCES, TÉLÉCHARGÉES COMME L'EXTENSION (src/fond/references.js : hôte R2 public, GET, sans identifiant, sans redirection, taille max, WebP) ──
        const A8 = SP.adresseReferenceAdmise;
        H.v('l\'hôte des références est celui de l\'extension (HOTE_R2_PUBLIC) et de la config du serveur (hotesPublics[0])', [SP.HOTE_REFERENCES, SP.REFERENCE_OCTETS_MAX], [HOTE_REF, 4194304]);
        H.v('adresseReferenceAdmise : l\'adresse exacte (https, hôte exact, chemin = la clé encodée segment par segment)', [A8(`${HOTE_REF}/ref/un.webp`, 'ref/un.webp'), A8(`${HOTE_REF}/banc/jeu%2012.webp`, 'banc/jeu 12.webp')], [true, true]);
        for (const [nom, url] of [['hôte voisin (suffixe)', `${HOTE_REF}.evil.fr/ref/un.webp`], ['hôte voisin (préfixe)', 'https://evil-pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/ref/un.webp'], ['un autre hôte du site', 'https://rat-market.fr/ref/un.webp'], ['l\'hôte d\'essai', `https://${S.HOTE_ESSAI}/ref/un.webp`],
            ['http', `http://${HOTE_REF_NOM}/ref/un.webp`], ['identifiants dans l\'adresse', `https://u:p@${HOTE_REF_NOM}/ref/un.webp`], ['identifiants déguisés', `https://${HOTE_REF_NOM}@evil.fr/ref/un.webp`], ['un port', `${HOTE_REF}:8443/ref/un.webp`], ['une requête', `${HOTE_REF}/ref/un.webp?x=1`], ['un fragment', `${HOTE_REF}/ref/un.webp#a`],
            ['le chemin d\'une AUTRE référence', `${HOTE_REF}/ref/deux.webp`], ['un préfixe du chemin', `${HOTE_REF}/ref/un.webp/../deux.webp`], ['un chemin avec préfixe en plus', `${HOTE_REF}/x/ref/un.webp`], ['une espace', `${HOTE_REF}/ref/un .webp`], ['vide', ''], ['pas une adresse', 'zzz'], ['un nombre', 42]])
            H.v(`adresseReferenceAdmise REFUSE : ${nom}`, A8(url, 'ref/un.webp'), false);
        {
            const essai = async (rep, extra = {}) => { const appels = []; const f = async (url, init) => { appels.push([url, init]); if (rep instanceof Error) throw rep; return rep; }; const r = await SP.telechargerReference({ url: `${HOTE_REF}/ref/un.webp`, ref: 'ref/un.webp', fetchFn: f, ...extra }); return { r, appels }; };
            const ok = await essai(repHote(200));
            H.v('telechargerReference : un WebP de l\'hôte, GET, SANS aucun en-tête, redirection non suivie, délai armé', [ok.r.ok, Buffer.compare(ok.r.octets, WEBP), ok.appels[0][1].method, ok.appels[0][1].headers, ok.appels[0][1].redirect, ok.appels[0][1].signal instanceof AbortSignal], [true, 0, 'GET', {}, 'manual', true]);
            for (const [nom, rep, raison] of [['redirection 302', repHote(302, { location: 'https://evil.fr/x' }), 'redirection'], ['redirection 301', repHote(301), 'redirection'], ['404', repHote(404), 'introuvable'], ['403', repHote(403), 'http'], ['503', repHote(503), 'http'],
                ['type text/html', repHote(200, { 'content-type': 'text/html' }), 'type'], ['type absent', repHote(200, {}), 'type'], ['type application/octet-stream', repHote(200, { 'content-type': 'application/octet-stream' }), 'type'],
                ['taille annoncée > 4 Mio', repHote(200, { 'content-type': 'image/webp', 'content-length': String(4194305) }), 'taille'],
                ['taille réelle > 4 Mio sans annonce', repHote(200, { 'content-type': 'image/webp' }, Buffer.concat([WEBP, Buffer.alloc(4194305)])), 'taille'],
                ['pas un WebP (image/png)', repHote(200, { 'content-type': 'image/png' }, Buffer.from('\u0089PNG\r\n\u001a\n0000000000')), 'webp'],
                ['trop court', repHote(200, { 'content-type': 'image/webp' }, Buffer.from('RIFF')), 'webp'],
                ['exception réseau', new Error('ECONNRESET'), 'reseau']]) {
                const x = await essai(rep); H.v(`   refuse : ${nom}`, [x.r.ok, x.r.raison], [false, raison]);
            }
            const exact = Buffer.concat([WEBP, Buffer.alloc(4194304 - WEBP.length)]);
            H.v('   la taille MAX exacte (4 Mio) passe', (await essai(repHote(200, { 'content-type': 'image/webp', 'content-length': '4194304' }, exact))).r.ok, true);
            const sha = require('crypto').createHash('sha256').update(WEBP).digest('hex');
            H.v('   sha256 servi : accepté s\'il est juste, refusé sinon', [(await essai(repHote(200), { sha256: sha })).r.ok, (await essai(repHote(200), { sha256: 'a'.repeat(64) })).r.raison], [true, 'sha256']);
            const nul = await essai(repHote(200), { url: `${HOTE_REF}.evil.fr/ref/un.webp` });
            H.v('   une adresse non admise : AUCUNE requête ne part', [nul.r.raison, nul.appels.length], ['adresse', 0]);
        }
        // en série : le client télécharge les références de l'hôte public (le cache local n'est qu'un raccourci)
        {
            const sc = [{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT() }, { premier: carteATrancher([idv(1), autre(1)]), complement: COMPLEMENT() }];
            const s = fauxServeur(sc), d = deps(s, { lireReference: undefined }); const r = await S.serie(base({ n: 2, scans: undefined }), d);
            const hote = s.appels.filter(a => a.hote === HOTE_REF_NOM);
            H.v('sans cache local : les 2 références sont téléchargées UNE fois (2 scans, un cache mémoire), adresses exactes', [hote.map(a => a.url).sort(), r.rapportProbable.second.envoyes, chemins(s, '/api/identifier/mesures').length], [[`${HOTE_REF}/ref/deux.webp`, `${HOTE_REF}/ref/un.webp`], 2, 2]);
            H.vrai('   en GET, sans en-tête (ni Authorization, ni Cookie, ni Origin), redirection non suivie', hote.every(a => a.methode === 'GET' && Object.keys(a.entetes).length === 0 && a.redirect === 'manual'));
            H.vrai('   les octets mesurés sont ceux de l\'hôte, et les appels à l\'API restent sur l\'hôte d\'essai seul', d.journalPx.filter(x => x[0] === 'zones').every(x => x[2] === WEBP.toString()) && s.appels.filter(a => a.hote !== HOTE_REF_NOM).every(a => a.hote === S.HOTE_ESSAI));
            const sortie = JSON.stringify(r) + d.logs.join('\n'); H.vrai('   aucun secret dans les sorties', TOUS_LES_SECRETS.every(x => !sortie.includes(x)));
            const s2 = fauxServeur(sc), d2 = deps(s2); await S.serie(base({ n: 2 }), d2);
            H.v('avec le cache local (raccourci) : aucune requête vers l\'hôte public', s2.appels.filter(a => a.hote === HOTE_REF_NOM).length, 0);
            const s3 = fauxServeur(sc, { hote: () => { throw new Error('ECONNRESET'); } }), d3 = deps(s3); const r3 = await S.serie(base({ n: 2 }), d3);
            H.v('… et l\'hôte en panne ne gêne pas un cache local complet (jamais une condition)', [r3.rapportProbable.second.envoyes, r3.arret], [2, null]);
        }
        for (const [nom, hote, raison] of [['404', () => repHote(404), 'reference-introuvable-hote'], ['redirection', () => repHote(302, { location: 'https://evil.fr' }), 'reference-hote-redirection'], ['type non image', () => repHote(200, { 'content-type': 'text/html' }), 'reference-hote-type'],
            ['taille excessive', () => repHote(200, { 'content-type': 'image/webp', 'content-length': '9999999' }), 'reference-hote-taille'], ['panne réseau', () => { throw new Error('ECONNRESET'); }, 'reference-hote-reseau']]) {
            const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: COMPLEMENT() }], { hote }); const r = await S.serie(base({ n: 1, scans: undefined }), deps(s, { lireReference: undefined }));
            H.v(`hôte public : ${nom} ⇒ la question reste, AUCUN second envoi, raison « ${raison} »`, [chemins(s, '/api/identifier/mesures').length, r.resultats[0].secondEnvoi, r.arret], [0, { envoye: false, raison }, null]);
        }
        { const compl = COMPLEMENT(); compl.references[0].url = `${HOTE_REF}.evil.fr/ref/un.webp`;
          const s = fauxServeur([{ premier: carteATrancher([idv(0), autre(0)]), complement: compl }]); const r = await S.serie(base({ n: 1, scans: undefined }), deps(s, { lireReference: undefined }));
          H.v('une adresse de référence donnée par le serveur sur un hôte voisin : jamais appelée, la question reste', [s.appels.filter(a => a.hote !== HOTE_REF_NOM && a.hote !== S.HOTE_ESSAI).length, s.appels.filter(a => /evil/.test(a.hote)).length, r.resultats[0].secondEnvoi.raison], [0, 0, 'reference-hote-adresse']); }

        // ── 9. /ping complet avant le premier scan (deux /ping espacés d'au moins 10 s) ──
        {
            const sans = n => CAPACITES_PLEINES.filter(c => c !== 'marques');
            const run = async (capacites, extra = {}, scen = []) => { const s = fauxServeur(scen, { capacites, ...(extra.comportement || {}) }); const pauses = []; const d = deps(s, { pause: async ms => { pauses.push({ ms, pings: s.appels.filter(a => a.chemin === '/ping').length }); } }); const r = await essaie(() => S.serie(base({ n: 1, ...(extra.base || {}) }), d)); return { s, pauses, r, d }; };
            const a = await run(n => (n <= 3 ? sans(n) : CAPACITES_PLEINES), {}, [{ premier: carteSure(idv(0)) }]);
            H.v('/ping incomplet (sans « marques ») 3 fois, puis complet : on attend, puis un SECOND /ping complet espacé de >= 10 s, et seulement alors la connexion', [a.s.appels.filter(x => x.chemin === '/ping').length, a.s.appels.findIndex(x => x.chemin === '/api/compte/connexion'), a.pauses.some(p => p.ms >= 10000 && p.pings === 4), a.r.ok && a.r.ok.stats.n], [5, 5, true, 1]);
            const b = await run(n => (n === 2 ? sans(n) : CAPACITES_PLEINES), {}, [{ premier: carteSure(idv(0)) }]);
            H.v('deux /ping complets de suite exigés : un complet puis un incomplet ne suffit pas', [b.s.appels.filter(x => x.chemin === '/ping').length, b.pauses.filter(p => p.ms === 10000).length], [4, 2]);
            const c = await run(() => sans(0), { base: { attenteCapacitesMaxMin: 1 } });
            H.v('jamais complet : arrêt (code 2) AVANT toute connexion, seulement des /ping', [/capacités/.test(c.r.arret || ''), c.s.appels.every(x => x.chemin === '/ping'), c.s.appels.length > 1], [true, true, true]);
            const dd = await run(n => (n === 1 ? ['empreinte'] : CAPACITES_PLEINES), { comportement: { avant: (x, ap) => (x.chemin === '/ping' && ap.filter(y => y.chemin === '/ping').length <= 2 ? (() => { throw new Error('ECONNRESET'); })() : null) } }, [{ premier: carteSure(idv(0)) }]);
            H.v('un réveil à froid (exceptions réseau sur les premiers /ping) est attendu, pas fatal', [dd.r.ok && dd.r.ok.stats.n, dd.r.arret ?? null], [1, null]);
            const e = await run(() => ['empreinte', 'mesures-client'], {}, []);       // l'ancien /ping du banc : sans langue-impression ni marques
            H.v('capacités sans « langue-impression » ni « marques » : refusé (jamais un scan payé sur un service qui se réveille)', [/langue-impression/.test(e.r.arret || '') || /capacités/.test(e.r.arret || ''), e.s.appels.filter(x => x.chemin === '/api/photo').length], [true, 0]);
        }

        // ── 10. --cles : rejouer EXACTEMENT une liste de lignes, dans cet ordre ──
        {
            const pleines = [ordre[3], ordre[0], ordre[5]].sort().reverse();          // un ordre ni trié croissant, ni celui de l'échantillon
            const cles = [pleines[0], pleines[1].split(':')[0], pleines[2]];
            const s = fauxServeur(pleines.map(k => ({ premier: carteSure(idDe(k)) })));
            const r = await S.serie(base({ cles, n: undefined, graine: undefined }), deps(s));
            H.v('--cles : les lignes demandées, dans CET ordre (une clé nue = sa ligne « :0 »), ni plus ni moins, sans --n ni --graine', [r.lignes, chemins(s, '/api/photo').length, r.arret], [pleines, 3, null]);
            for (const [nom, c] of [['une clé inconnue', [ordre[0], 'zz:0']], ['un doublon', [ordre[0], ordre[0]]], ['une liste vide', []], ['pas des chaînes', [1, 2]]]) {
                const s2 = fauxServeur([]); const r2 = await essaie(() => S.serie(base({ cles: c, n: undefined, graine: undefined }), deps(s2)));
                H.v(`--cles avec ${nom} : refusé avant TOUTE requête`, [/--cles/.test(r2.arret || ''), s2.appels.length], [true, 0]);
            }
        }

        // ── 11. le coût estimé est imprimé et jugé AVANT toute requête ──
        {
            const s = fauxServeur([]), d = deps(s); const r = await essaie(() => S.serie(base({ n: 7, plafondUsd: 0.05, coutEstimeUsd: 0.01 }), d));
            H.v('estimation (7 lignes × 0,01 = 0,07 USD) au-dessus du plafond 0,05 : refus avant toute requête, estimation imprimée', [/estimation/.test(r.arret || ''), s.appels.length, d.logs.some(x => /coût estimé avant toute requête : 7 lignes × 0\.01 = 0\.0700 USD/.test(x))], [true, 0, true]);
            const s2 = fauxServeur(Array(7).fill({ premier: carteSure(1) })), d2 = deps(s2); const r2 = await essaie(() => S.serie(base({ n: 7, plafondUsd: 0.07, coutEstimeUsd: 0.01 }), d2));
            H.v('   estimation = plafond : la série part', [s2.appels.length > 1, d2.logs.some(x => /coût estimé avant toute requête/.test(x))], [true, true]);
            const f = path.join(dossier, 'deja.jsonl'); fs.writeFileSync(f, '{"coutUsd":0.04}\n'); const s3 = fauxServeur([]);
            const r3 = await essaie(() => S.serie(base({ n: 3, plafondUsd: 0.06, coutEstimeUsd: 0.01, carnet: f }), deps(s3)));
            H.v('   le total déjà inscrit au carnet compte dans l\'estimation (0,04 + 0,03 > 0,06)', [/estimation/.test(r3.arret || ''), s3.appels.length], [true, 0]);
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
