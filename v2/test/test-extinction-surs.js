'use strict';
// DECISION-SURS — l'EXTINCTION AUTOMATIQUE de serie-essai.js (--eteindre-si-sur-faux=<VARIABLE> --commit-essai=<commit>) : un SÛR FAUX arrête la série, pose la variable à 0 sur l'essai (par l'outil existant,
// INJECTÉ ici : aucun appel à Render dans un banc), journalise l'heure et la ligne. La décision « sûr faux => éteindre » est une fonction PURE. Aucun réseau (faux fetch), aucun appel payant, aucune base.
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./_harnais');
const S = require('../mesures/serie-essai');
const SP = require('../mesures/serie-probable');

const SECRET = 'mot-de-passe-de-banc-NE-JAMAIS-AFFICHER-0123456789', IDENTIFIANT = 'banc-mesure@rat-market.invalid';
const JETON_INST = 'jeton-installation-SECRET-aaaa1111', JETON_LIE = 'jeton-lie-SECRET-bbbb2222', COOKIE = 'cookie-session-SECRET-cccc3333', CODE = 'ABC123';
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'extinction-surs-'));
const photos = path.join(dossier, 'photos'); fs.mkdirSync(photos);
const CLES = ['k1', 'k2', 'k3', 'k4'];
for (const k of CLES) fs.writeFileSync(path.join(photos, k + '.jpg'), Buffer.from(`photo-${k}`));
const nav = { photos: Object.fromEntries(CLES.map((k, i) => [k, { emb: Array.from({ length: 256 }, (_, j) => (j === i ? 1 : 0)), redressee: true }])) };
const VERITE = { k1: 101, k2: 102, k3: 103, k4: null };
const resultats = { bancs: { 'banc LIVRÉ': {} }, diffs: { 'banc LIVRÉ': [] }, ref: CLES.map(k => ({ cle: `${k}:0`, banc: 'lot', verite: VERITE[k], et: { type: 'question', choix: [] } })) };
const photoIdN = n => n.toString(16).padStart(32, '0');
// le faux serveur : le n-ième /api/identifier rend le SÛR `sures[n-1]` (undefined : une question)
function fauxServeur(sures) {
    const appels = [];
    const rep = (statut, corps, entetes = {}) => ({ status: statut, json: async () => corps, headers: { get: n => entetes[String(n).toLowerCase()] ?? null } });
    const fetch = async (url, init = {}) => {
        const u = new URL(url); appels.push({ chemin: u.pathname });
        if (u.pathname === '/ping') return rep(200, { ok: true, mongo: true, version: 'x', versionMinExtension: '2.5.0', capacites: SP.CAPACITES_ATTENDUES.length ? [...new Set(['langue-impression', 'empreinte', ...SP.CAPACITES_ATTENDUES])] : ['langue-impression', 'empreinte'] });
        if (u.pathname === '/api/installation') return rep(201, { success: true, jetonInstallation: JETON_INST });
        if (u.pathname === '/api/compte/connexion') return rep(200, { success: true }, { 'set-cookie': `rm_session=${COOKIE}; HttpOnly` });
        if (u.pathname === '/api/compte/code') return rep(200, { success: true, code: CODE });
        if (u.pathname === '/api/compte/lier') return rep(200, { success: true, compte: { verifie: true, administrateur: true }, jetonInstallation: JETON_LIE });
        if (u.pathname === '/api/photo') return rep(200, { success: true, photoId: photoIdN(appels.filter(x => x.chemin === '/api/photo').length) });
        if (u.pathname === '/api/identifier') {
            const n = appels.filter(x => x.chemin === '/api/identifier').length, sur = sures[n - 1];
            const analyse = sur ? { statut: 'identifiee', cartes: [{ index: 0, statut: 'identifiee', carte: { idProduct: sur } }], photoRecue: true, photosRecues: [0] } : { statut: 'a-trancher', cartes: [{ index: 0, statut: 'question' }], photoRecue: true, photosRecues: [0] };
            return rep(200, { success: true, analyse, scanId: `scan-${n}` });
        }
        return rep(404, { success: false });
    };
    return { fetch, appels };
}
let horloge = 0;
const base = (extra = {}) => ({ resultats, nav, photos, cles: ['k1:0', 'k2:0', 'k3:0'], plafondUsd: 1, carnet: path.join(dossier, `carnet-${Math.random().toString(36).slice(2)}.jsonl`), pauseS: 0, env: { V2_ESSAI_BANC_IDENTIFIANT: IDENTIFIANT, V2_ESSAI_BANC_MOT_DE_PASSE: SECRET }, coutEstimeUsd: 0.01, ...extra });
const deps = (srv, extra = {}) => { const logs = []; return { fetch: srv.fetch, horloge: () => (horloge += 100), pause: async () => { }, log: m => logs.push(String(m)), maintenant: () => Date.UTC(2026, 10, 1, 12, 34, 56), logs, ...extra }; };
const essaie = async f => { try { return { ok: await f() }; } catch (e) { return { arret: e instanceof S.Arret ? e.raison : `exception ${e && e.message}` }; } };
const COMMIT = 'a1b2c3d4e5f6';
const nId = srv => srv.appels.filter(a => a.chemin === '/api/identifier').length;

(async () => {
    // ═════ la décision PURE
    const V = 'V2_PROMOTION_SURS';
    const dec = (o = {}) => S.decisionExtinction({ variable: V, verite: 102, observations: [{ sur: true, produit: 999 }], ...o });
    H.v('un sûr dont le produit n\'est pas la vérité => éteindre', [dec().eteindre, /FAUX/.test(dec().raison)], [true, true]);
    H.v('un sûr JUSTE => ne pas éteindre', dec({ observations: [{ sur: true, produit: 102 }] }).eteindre, false);
    H.v('pas un sûr (question, probable faux, introuvable) => ne pas éteindre', [dec({ observations: [{ sur: false, produit: null }] }).eteindre, dec({ observations: [] }).eteindre, dec({ observations: undefined }).eteindre], [false, false, false]);
    H.v('vérité inconnue (null, absente) => ne pas éteindre (rien ne se juge)', [dec({ verite: null }).eteindre, dec({ verite: undefined }).eteindre], [false, false]);
    H.v('une variable qui n\'est pas éteignable (la production, autre chose) => ne pas éteindre', [dec({ variable: 'MONGODB_URI' }).eteindre, dec({ variable: undefined }).eteindre, dec({ variable: 'V2_LEVIERS_ABDE' }).eteindre], [false, false, false]);
    H.v('un sûr faux parmi plusieurs observations (première réponse juste, verdict final faux) => éteindre', dec({ observations: [{ sur: true, produit: 102 }, { sur: true, produit: 5 }] }).eteindre, true);
    H.v('la variable éteignable est UNE seule : V2_PROMOTION_SURS', [...S.VARIABLES_EXTINCTION], ['V2_PROMOTION_SURS']);

    // ═════ l'exécuteur réel (spawn injecté : jamais Render)
    const appels = []; let spec = null;
    const faux = (code) => (exe, args) => { appels.push(args); spec = JSON.parse(fs.readFileSync(args[1], 'utf8')); return { status: code }; };
    const r1 = S.eteindreSurRender({ variable: V, commit: COMMIT }, { spawn: faux(0), outil: 'outil-fictif.js' });
    H.v('l\'exécuteur appelle l\'outil existant : spécification { V2_PROMOTION_SURS: { valeur: "0" } }, --appliquer, --attendu=<commit>', [r1, appels[0][0], appels[0].slice(2), spec], [{ ok: true, statut: 0 }, 'outil-fictif.js', ['--appliquer', `--attendu=${COMMIT}`], { V2_PROMOTION_SURS: { valeur: '0' } }]);
    H.v('   la spécification temporaire est retirée', fs.existsSync(appels[0][1]), false);
    H.v('   l\'outil qui échoue (code 1) : ok faux, dit', S.eteindreSurRender({ variable: V, commit: COMMIT }, { spawn: faux(1), outil: 'x.js' }).ok, false);
    const avant = appels.length;
    H.v('   une variable ou un commit refusé : rien n\'est lancé', [S.eteindreSurRender({ variable: 'MONGODB_URI', commit: COMMIT }, { spawn: faux(0) }).ok, S.eteindreSurRender({ variable: V, commit: 'main' }, { spawn: faux(0) }).ok, appels.length - avant], [false, false, 0]);

    // ═════ la série : un sûr faux arrête, éteint, journalise
    {
        const srv = fauxServeur([101, 999, 103]);          // k1 : juste (101) ; k2 : FAUX (999 pour la vérité 102) ; k3 ne doit pas être joué
        const eteintes = [];
        const d = deps(srv, { eteindre: async a => { eteintes.push(a); return { ok: true, statut: 0 }; } });
        const o = base({ eteindreSiSurFaux: V, commitEssai: COMMIT });
        const r = await S.serie(o, d);
        H.v('un sûr FAUX à la ligne 2 : la série s\'ARRÊTE avant le scan suivant (2 identifications sur 3)', [nId(srv), r.resultats.length, /EXTINCTION AUTOMATIQUE/.test(r.arret || '')], [2, 2, true]);
        H.v('   la variable est posée à 0 sur l\'essai UNE fois, avec le commit attendu', eteintes, [{ variable: V, commit: COMMIT }]);
        H.v('   l\'heure et la ligne sont journalisées (rapport, journal, carnet)', [r.extinction.quand, r.extinction.cle, r.extinction.rang, r.extinction.ok, d.logs.some(l => l.includes('EXTINCTION 2026-11-01T12:34:56.000Z') && l.includes('k2:0')),
            fs.readFileSync(o.carnet, 'utf8').split('\n').filter(Boolean).map(JSON.parse).some(x => x.extinction && x.extinction.cle === 'k2:0' && x.extinction.quand === '2026-11-01T12:34:56.000Z')], ['2026-11-01T12:34:56.000Z', 'k2:0', 2, true, true, true]);
        H.v('   le code de sortie dédié existe (12)', S.CODE_EXTINCTION, 12);
        const ko = await S.serie(base({ eteindreSiSurFaux: V, commitEssai: COMMIT }), deps(fauxServeur([101, 999, 103]), { eteindre: async () => ({ ok: false, statut: 1 }) }));
        H.v('   l\'outil qui ÉCHOUE : la série s\'arrête quand même, et le dit (à éteindre à la main)', [ko.resultats.length, ko.extinction.ok, /NON POSÉE/.test(ko.arret)], [2, false, true]);
        const lv = await S.serie(base({ eteindreSiSurFaux: V, commitEssai: COMMIT }), deps(fauxServeur([101, 999, 103]), { eteindre: async () => { throw new Error('Render injoignable'); } }));
        H.v('   l\'outil qui LÈVE : jamais propagé, la série s\'arrête, extinction non posée', [lv.resultats.length, lv.extinction.ok], [2, false]);
    }
    {
        const srv = fauxServeur([101, 102, 103]);
        let n = 0;
        const r = await S.serie(base({ eteindreSiSurFaux: V, commitEssai: COMMIT }), deps(srv, { eteindre: async () => { n++; return { ok: true }; } }));
        H.v('que des sûrs JUSTES : la série va jusqu\'au bout, rien n\'est éteint', [nId(srv), n, r.extinction, r.arret], [3, 0, undefined, null]);
        const srv2 = fauxServeur([101, 999, 103]); let n2 = 0;
        const r2 = await S.serie(base(), deps(srv2, { eteindre: async () => { n2++; return { ok: true }; } }));
        H.v('SANS l\'option : le sûr faux ne change rien (le client est celui d\'avant : 3 scans, aucune extinction)', [nId(srv2), n2, r2.extinction], [3, 0, undefined]);
        // I2 : un sûr sur une ligne SANS vérité ne peut pas être jugé faux : il n'éteint rien, mais il est COMPTÉ, listé (carnet, rapport, journal)
        const srv3 = fauxServeur([101, 999, 103]); let n3 = 0;
        const d3 = deps(srv3, { eteindre: async () => { n3++; return { ok: true }; } });
        const o3 = base({ cles: ['k1:0', 'k4:0', 'k3:0'], eteindreSiSurFaux: V, commitEssai: COMMIT });
        const r3 = await S.serie(o3, d3);
        H.v('I2 : une ligne SANS vérité (k4) qui rend un sûr : rien ne s\'éteint, mais le sûr NON JUGÉ est listé (rapport, carnet, journal rouge)', [n3, r3.extinction, r3.sursNonJuges.map(x => [x.cle, x.produit]), d3.logs.some(m => m.includes('SÛR NON JUGÉ') && m.includes('k4:0')), d3.logs.some(m => m.includes('SÛRS NON JUGÉS : 1')),
            fs.readFileSync(o3.carnet, 'utf8').split('\n').filter(Boolean).map(JSON.parse).some(x => x.surNonJuge && x.surNonJuge.cle === 'k4:0')], [0, undefined, [['k4:0', 999]], true, true, true]);
        const srv3b = fauxServeur([101, 102, 103]);
        const r3b = await S.serie(base({ eteindreSiSurFaux: V, commitEssai: COMMIT }), deps(srv3b));
        H.v('   aucun sûr non jugé quand toutes les lignes ont une vérité', r3b.sursNonJuges, []);
        // --cles-avec-verite-seulement : la série ne tire que des lignes qui ont une vérité
        const srv3c = fauxServeur([101, 102, 103, 104]);
        const r3c = await S.serie(base({ cles: undefined, n: 4, graine: 5, clesAvecVeriteSeulement: true }), deps(srv3c));
        H.v('--cles-avec-verite-seulement : les lignes tirées ont TOUTES une vérité (k4 jamais tirée), et sans l\'option elle peut l\'être', [r3c.lignes.includes('k4:0'), r3c.lignes.length, (await S.serie(base({ cles: undefined, n: 4, graine: 5 }), deps(fauxServeur([]))).catch(() => ({ lignes: [] }))).lignes.includes('k4:0')], [false, 3, true]);
        // I1 : le jugement se fait AVANT la suite (en mode --g-probable : ni second envoi, ni déclaration après un sûr faux)
        const srv4 = fauxServeur([101, 999, 103]); let n4 = 0;
        const d4 = deps(srv4, { eteindre: async () => { n4++; return { ok: true }; } });
        const o4 = base({ gProbable: true, cartes: photos, eteindreSiSurFaux: V, commitEssai: COMMIT, scans: [] });
        const r4 = await S.serie(o4, d4).catch(e => ({ arretExc: e instanceof S.Arret ? e.raison : String(e && e.message) }));
        H.v('I1 : en mode --g-probable, un sûr faux est jugé AVANT la suite : variable posée, aucune déclaration (/reponse) ni second envoi (/mesures) après lui', [r4.arretExc || null, n4, srv4.appels.some(a => a.chemin === '/api/identifier/reponse' || a.chemin === '/api/identifier/mesures') || fs.readFileSync(o4.carnet, 'utf8').split('\n').filter(Boolean).map(JSON.parse).some(x => x.premierVerdict && x.rang === 2) || d4.logs.slice(d4.logs.findIndex(m => m.startsWith('EXTINCTION'))).some(m => /^\s+premier verdict \d+ ms/.test(m)), r4.extinction && r4.extinction.cle], [null, 1, false, 'k2:0']);
        // I1 : une exception ou un Arret de la suite ne saute pas le jugement (la suite est coupée par deps : suiteProbable lève après un sûr faux)
        const srv5 = fauxServeur([101, 999, 103]); let n5 = 0;
        const d5 = deps(srv5, { eteindre: async () => { n5++; return { ok: true }; }, lireReference: () => { throw new Error('bug de la suite'); } });
        const r5 = await S.serie(base({ gProbable: true, cartes: photos, eteindreSiSurFaux: V, commitEssai: COMMIT, scans: [] }), d5).catch(e => ({ arretExc: String(e && e.message) }));
        H.v('I1 : même quand la suite lèverait, le sûr faux de la première réponse a éteint la variable (une fois)', [n5, r5.extinction && r5.extinction.cle], [1, 'k2:0']);    }
    // ═════ les refus AVANT toute requête
    {
        const srv = fauxServeur([]);
        const a = await essaie(() => S.serie(base({ eteindreSiSurFaux: 'MONGODB_URI', commitEssai: COMMIT }), deps(srv)));
        const b = await essaie(() => S.serie(base({ eteindreSiSurFaux: V }), deps(srv)));
        const c = await essaie(() => S.serie(base({ eteindreSiSurFaux: V, commitEssai: 'main' }), deps(srv)));
        H.v('une variable non éteignable, ou un commit absent ou illisible : refus AVANT toute requête', [!!a.arret, !!b.arret, !!c.arret, srv.appels.length], [true, true, true, 0]);
    }
    H.bilan();
})().catch(e => { console.log('ERREUR', e && e.stack || e); process.exit(1); });
