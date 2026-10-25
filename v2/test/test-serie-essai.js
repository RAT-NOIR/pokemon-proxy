'use strict';
// SERIE-ESSAI (25/10) — le client de série (v2/mesures/serie-essai.js) est jugé SANS RÉSEAU : un FAUX SERVEUR (un `fetch` injecté) et un `fetch` global qui LÈVE si le client s'en sert par erreur.
// Ce que le banc juge : (1) l'hôte (un seul, exact, https, sans détour) ; (2) le jeton (absent ⇒ aucune requête ; jamais imprimé ni écrit) ; (3) le plafond DUR et le carnet (arrêt AVANT de franchir, le total du carnet compte
// d'une série à l'autre) ; (4) l'échantillon (graine, ordre, rejeu à l'identique) ; (5) la durée (n, p50, p95) ; (6) la forme des requêtes ; (7) la comparaison essai / local ; (8) les arrêts (429, redirection, erreurs de suite).
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./_harnais');
const S = require('../mesures/serie-essai');

const SECRET = 'mot-de-passe-de-banc-NE-JAMAIS-AFFICHER-0123456789';          // secret-factice : sentinelle du mot de passe du compte de mesure
const IDENTIFIANT = 'banc-mesure@rat-market.invalid';
const JETON_INST = 'jeton-installation-SECRET-aaaa1111', JETON_LIE = 'jeton-lie-SECRET-bbbb2222', COOKIE = 'cookie-session-SECRET-cccc3333', CODE = 'ABC123';
const TOUS_LES_SECRETS = [SECRET, JETON_INST, JETON_LIE, COOKIE];
const ENV_BANC = { V2_ESSAI_BANC_IDENTIFIANT: IDENTIFIANT, V2_ESSAI_BANC_MOT_DE_PASSE: SECRET };
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'serie-essai-'));
const photos = path.join(dossier, 'photos'); fs.mkdirSync(photos);
const CLES = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'];
for (const k of CLES) fs.writeFileSync(path.join(photos, k + '.jpg'), Buffer.from(`photo-${k}`));
const nav = { photos: Object.fromEntries(CLES.map((k, i) => [k, { emb: Array.from({ length: 256 }, (_, j) => (j === i ? 1 : 0)), redressee: i % 2 === 0 }])) };
// le banc local : k1..k4 « sûr » (k1 juste, k2 juste, k3 faux, k4 juste), les autres des questions ; vérités connues
const VERITE = { k1: 101, k2: 102, k3: 103, k4: 104, k5: 105, k6: 106, k7: 107, k8: 108 };
const LOCAL = { k1: 101, k2: 102, k3: 999, k4: 104 };
const resultats = {
    bancs: { 'banc LIVRÉ': {} },
    diffs: { 'banc LIVRÉ': Object.entries(LOCAL).map(([k, p]) => ({ cle: `${k}:0`, apres: `sûr ${p}` })) },
    ref: CLES.map(k => ({ cle: `${k}:0`, banc: 'lot', verite: VERITE[k], et: { type: 'question', choix: [VERITE[k], 1] } })).concat([{ cle: 'zz:0', banc: 'hors-banc', verite: 1, et: { type: 'sur' } }])
};

// ── le faux serveur ──
const { verifierEntree } = require('../identifier/routes');       // la fonction de PRODUCTION, jamais une copie
const { lireConfig } = require('../config');
const CFG_ESSAI = { ...lireConfig({}), photosMultiples: true, empreinteExtension: true };   // la configuration de l'essai : photos multiples et empreinte de l'extension allumées
let entreesAcceptees = [];
const photoIdN = n => n.toString(16).padStart(32, '0');            // la forme du serveur : 32 caractères hexadécimaux (FORME_PHOTO_ID)
function fauxServeur(comportement = {}) {
    const appels = [];
    const rep = (statut, corps, entetes = {}) => ({ status: statut, json: async () => corps, headers: { get: n => entetes[String(n).toLowerCase()] ?? null } });
    const fetch = async (url, init = {}) => {
        const u = new URL(url), corps = init.body;
        const a = { url, hote: u.hostname, chemin: u.pathname, methode: init.method || 'GET', entetes: init.headers || {}, corps, redirect: init.redirect };
        appels.push(a);
        if (comportement.avant) { const r = comportement.avant(a, appels); if (r) return r; }
        if (u.pathname === '/ping') return rep(200, { ok: true, mongo: true, version: 'x', versionMinExtension: '2.5.0', capacites: comportement.capacites || ['langue-impression', 'empreinte'] });
        if (u.pathname === '/api/installation') return rep(201, { success: true, installationId: 'i1', jetonInstallation: JETON_INST });
        if (u.pathname === '/api/compte/connexion') {
            const b = JSON.parse(corps);
            if (b.email !== IDENTIFIANT || b.motDePasse !== SECRET) return rep(401, { success: false });
            return rep(200, { success: true, compte: { email: IDENTIFIANT, verifie: true } }, { 'set-cookie': `rm_session=${COOKIE}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` });
        }
        if (u.pathname === '/api/compte/code') return (init.headers || {}).Cookie === `rm_session=${COOKIE}` ? rep(200, { success: true, code: CODE, expire: 'x' }) : rep(401, { success: false });
        if (u.pathname === '/api/compte/lier') {
            const ok = (init.headers || {}).Authorization === `Bearer ${JETON_INST}` && JSON.parse(corps).code === CODE;
            return ok ? rep(200, { success: true, compte: { verifie: true, administrateur: comportement.pasAdmin ? false : true }, jetonInstallation: JETON_LIE }) : rep(401, { success: false });
        }
        if (u.pathname === '/api/photo' || u.pathname === '/api/identifier') { if ((init.headers || {}).Authorization !== `Bearer ${JETON_LIE}`) return rep(401, { success: false }); }
        if (u.pathname === '/api/photo') return rep(200, { success: true, photoId: photoIdN(appels.filter(x => x.chemin === '/api/photo').length), expireDans: 30 });
        if (u.pathname === '/api/identifier') {
            const n = appels.filter(x => x.chemin === '/api/identifier').length;
            const cle = comportement.ordre ? comportement.ordre[n - 1] : null;
            const b = JSON.parse(corps);
            // COMME LA PRODUCTION : sans `contrat: 2` l'aiguilleur renvoie vers la route héritée, qui répond 401 (monter.js:94-100)
            if (b.contrat !== 2) return rep(401, { success: false });
            // COMME LA PRODUCTION : le corps est jugé par `verifierEntree` (la fonction de la route, pas une copie), avec la configuration de l'essai
            const v = verifierEntree(b, CFG_ESSAI);
            if (v.erreur) return rep(400, { success: false, erreur: v.erreur });
            entreesAcceptees.push(v.entree);
            const sur = comportement.essai ? comportement.essai(b, n) : null;
            const photo = comportement.photoRecue === undefined ? { photosRecues: [0], photoRecue: true } : comportement.photoRecue;     // le contrat : analyse.photosRecues / analyse.photoRecue (CONTRAT-API-V2.md)
            const analyse = { ...(sur ? { statut: 'identifiee', cartes: [{ index: 0, statut: 'identifiee', carte: { idProduct: sur } }] } : { statut: 'a-trancher', cartes: [{ index: 0, statut: 'question' }] }), ...photo };
            return rep(200, { success: true, ...(comportement.sansAnalyse ? {} : { analyse }), cle });
        }
        return rep(404, { success: false });
    };
    return { fetch, appels };
}
let horloge = 0;
const base = (extra = {}) => ({ resultats, nav, photos, n: 4, graine: 7, plafondUsd: 1, carnet: path.join(dossier, `carnet-${Math.random().toString(36).slice(2)}.jsonl`), pauseS: 0, env: { ...ENV_BANC }, coutEstimeUsd: 0.01, ...extra });
const deps = (srv, extra = {}) => { const logs = []; return { fetch: srv.fetch, horloge: () => (horloge += 100), pause: async () => { }, log: m => logs.push(String(m)), maintenant: () => 1700000000000, logs, ...extra }; };
const essaie = async (f) => { try { return { ok: await f() }; } catch (e) { return { arret: e instanceof S.Arret ? e.raison : `exception ${e && e.message}` }; } };
const nid = srv => srv.appels.filter(a => a.chemin === '/api/identifier').length;

(async () => {
    const fetchGlobal = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('RÉSEAU : le client a utilisé le fetch global'); };
    try {
        // ── 1. l'hôte ──
        H.v('hôte d\'essai en https : accepté', S.baseAutorisee('https://rat-market-api-essai.onrender.com'), 'https://rat-market-api-essai.onrender.com');
        H.v('   une barre finale est admise', S.baseAutorisee('https://rat-market-api-essai.onrender.com/'), 'https://rat-market-api-essai.onrender.com');
        for (const mauvais of ['https://rat-market-api.onrender.com', 'https://rat-market-api-essai.onrender.com.evil.fr', 'https://evil.fr/rat-market-api-essai.onrender.com', 'https://rat-market-api-essai.onrender.com@evil.fr',
            'https://evil.fr@rat-market-api-essai.onrender.com', 'http://rat-market-api-essai.onrender.com', 'https://rat-market-api-essai.onrender.com:8443', 'https://rat-market-api-essai.onrender.com/api', 'https://rat-market-api-essai.onrender.com/?x=1',
            'https://localhost:3000', 'ftp://rat-market-api-essai.onrender.com', '', 'pas une adresse', 'https://RAT-MARKET-API-ESSAI.onrender.com.'])
            H.vrai(`hôte refusé : ${JSON.stringify(mauvais)}`, (() => { try { S.baseAutorisee(mauvais); return false; } catch (e) { return e instanceof S.Arret; } })());
        H.vrai('   la casse de l\'hôte est normalisée par l\'URL (une majuscule n\'ouvre pas un autre hôte)', S.baseAutorisee('https://RAT-MARKET-API-ESSAI.ONRENDER.COM') === 'https://rat-market-api-essai.onrender.com');
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ base: 'https://rat-market-api.onrender.com' }), deps(s)));
          H.v('série vers l\'hôte de PRODUCTION : refus, ZÉRO requête', [/hôte refusé/.test(r.arret || ''), s.appels.length], [true, 0]); }

        // ── 2. les identifiants du compte de mesure, et la CONNEXION normale ──
        for (const [nom, env] of [['aucune des deux', {}], ['l\'identifiant seul', { V2_ESSAI_BANC_IDENTIFIANT: IDENTIFIANT }], ['le mot de passe seul', { V2_ESSAI_BANC_MOT_DE_PASSE: SECRET }], ['une valeur blanche', { ...ENV_BANC, V2_ESSAI_BANC_MOT_DE_PASSE: '   ' }], ['un AUTRE nom (ancien jeton)', { V2_ESSAI_JETON_ADMIN: SECRET, V2_AUTRE: SECRET }]]) {
            const s = fauxServeur(); const r = await essaie(() => S.serie(base({ env }), deps(s)));
            H.v(`identifiants : ${nom} : arrêt avant TOUTE requête`, [/absent/.test(r.arret || ''), s.appels.length], [true, 0]);
        }
        H.v('lireVariable : lue du fichier d\'environnement nommé (guillemets retirés), seule cette clé', S.lireVariable('V2_ESSAI_BANC_MOT_DE_PASSE', {}, 'x.env', () => `AUTRE=1\nV2_ESSAI_BANC_MOT_DE_PASSE="${SECRET}"\nSUITE=2\n`), SECRET);
        H.v('   fichier sans le nom : null', S.lireVariable('V2_ESSAI_BANC_MOT_DE_PASSE', {}, 'x.env', () => 'AUTRE=1\n'), null);
        H.v('   fichier illisible : null (aucune exception)', S.lireVariable('V2_ESSAI_BANC_MOT_DE_PASSE', {}, 'x.env', () => { throw new Error('boum'); }), null);
        H.v('   process.env l\'emporte sur le fichier', S.lireVariable('V2_ESSAI_BANC_MOT_DE_PASSE', { V2_ESSAI_BANC_MOT_DE_PASSE: 'direct' }, 'x.env', () => 'V2_ESSAI_BANC_MOT_DE_PASSE=fichier\n'), 'direct');
        H.v('lireIdentifiants : les deux, ou rien', [S.lireIdentifiants(ENV_BANC, null), S.lireIdentifiants({ V2_ESSAI_BANC_IDENTIFIANT: 'a' }, null)], [{ identifiant: IDENTIFIANT, motDePasse: SECRET }, null]);
        { const s = fauxServeur(), d = deps(s), b = base({ n: 2 });
          const r = await essaie(() => S.serie(b, d));
          H.v('la connexion normale, dans l\'ordre : ping, installation, connexion, code, liaison, puis photo et identifier', s.appels.map(a => `${a.methode} ${a.chemin}`),
              ['GET /ping', 'POST /api/installation', 'POST /api/compte/connexion', 'POST /api/compte/code', 'POST /api/compte/lier', 'POST /api/photo', 'POST /api/identifier', 'POST /api/photo', 'POST /api/identifier']);
          const par = c => s.appels.find(a => a.chemin === c);
          H.v('   connexion et code : les en-têtes du site (Origin exacte, X-Rat-Market) ; le code avec le cookie, sans Bearer', [par('/api/compte/connexion').entetes.Origin, par('/api/compte/connexion').entetes['X-Rat-Market'], par('/api/compte/code').entetes.Cookie === `rm_session=${COOKIE}`, par('/api/compte/code').entetes.Authorization], [S.ORIGINE_SITE, '1', true, undefined]);
          H.v('   la liaison : le jeton d\'INSTALLATION en Bearer ; photo et identifier : le jeton LIÉ (celui que la liaison a rendu)', [par('/api/compte/lier').entetes.Authorization === `Bearer ${JETON_INST}`, s.appels.filter(a => a.chemin === '/api/photo' || a.chemin === '/api/identifier').every(a => a.entetes.Authorization === `Bearer ${JETON_LIE}`)], [true, true]);
          H.vrai('   ping, installation, connexion et code ne portent aucun Bearer', ['/ping', '/api/installation', '/api/compte/connexion', '/api/compte/code'].every(c => par(c).entetes.Authorization === undefined));
          const sortie = JSON.stringify(r.ok) + d.logs.join('\n') + fs.readFileSync(b.carnet, 'utf8');
          H.vrai('aucun secret (mot de passe, jetons, cookie) dans les journaux, le carnet ou le résultat', TOUS_LES_SECRETS.every(x => !sortie.includes(x)) && sortie.length > 100);
          H.vrai('   et le mot de passe ne part QUE dans le corps de la connexion (ni adresse, ni en-tête, ni autre corps)', s.appels.every(a => a.chemin === '/api/compte/connexion' || (!a.url.includes(SECRET) && !String(a.corps || '').includes(SECRET) && Object.values(a.entetes).every(v => !String(v).includes(SECRET)))));
          H.vrai('   le cookie ne part QUE vers /api/compte/code', s.appels.every(a => a.chemin === '/api/compte/code' || !JSON.stringify(a.entetes).includes(COOKIE)));
          H.vrai('   le jeton d\'installation ne part QUE vers la liaison', s.appels.every(a => a.chemin === '/api/compte/lier' || !JSON.stringify(a.entetes).includes(JETON_INST))); }
        for (const [nom, avant, motif] of [['installation refusée', a => (a.chemin === '/api/installation' ? { status: 429, json: async () => ({}), headers: { get: n => (n === 'retry-after' ? '300' : null) } } : null), /installation.*429/],
            ['mauvais identifiants (401)', a => (a.chemin === '/api/compte/connexion' ? { status: 401, json: async () => ({}), headers: { get: () => null } } : null), /connexion refusée \(401\)/],
            ['connexion sans cookie', a => (a.chemin === '/api/compte/connexion' ? { status: 200, json: async () => ({ success: true }), headers: { get: () => null } } : null), /connexion refusée/],
            ['code refusé', a => (a.chemin === '/api/compte/code' ? { status: 403, json: async () => ({}), headers: { get: () => null } } : null), /code de liaison refusée/],
            ['liaison refusée', a => (a.chemin === '/api/compte/lier' ? { status: 409, json: async () => ({}), headers: { get: () => null } } : null), /liaison refusée \(409\)/]]) {
            const s = fauxServeur({ avant }); const r = await essaie(() => S.serie(base({ n: 3 }), deps(s)));
            H.v(`connexion : ${nom} : arrêt avant tout scan, aucune photo`, [motif.test(r.arret || ''), s.appels.filter(a => a.chemin === '/api/photo' || a.chemin === '/api/identifier').length], [true, 0]);
        }
        { const s = fauxServeur({ pasAdmin: true }); const r = await essaie(() => S.serie(base({ n: 3 }), deps(s)));
          H.v('connexion : un compte lié qui n\'est pas administrateur : arrêt, aucune photo', [/pas administrateur/.test(r.arret || ''), s.appels.filter(a => a.chemin === '/api/photo').length], [true, 0]); }

        // ── 3. le plafond et le carnet ──
        { const s = fauxServeur(); const b = base({ n: 6, plafondUsd: 0.035, coutEstimeUsd: 0.01 }); const d = deps(s);
          const r = await essaie(() => S.serie(b, d));
          const lignesCarnet = fs.readFileSync(b.carnet, 'utf8').trim().split('\n').map(JSON.parse).filter(l => l.coutUsd !== undefined);      // les lignes d'ESTIMATION ; les lignes « résultat » (section 9) ne portent pas de coût
          H.v('plafond 0,035 USD à 0,01 le scan : 3 scans, jamais le quatrième', [nid(s), lignesCarnet.length, /plafond atteint/.test(r.ok.arret || '')], [3, 3, true]);
          H.vrai('   la dépense inscrite ne franchit JAMAIS le plafond', r.ok.depenseUsd <= 0.035 && Math.abs(r.ok.depenseUsd - 0.03) < 1e-9);
          H.vrai('   chaque ligne du carnet porte la série, le rang, la clé, le coût et le total après', lignesCarnet.every((l, i) => l.rang === i + 1 && typeof l.cle === 'string' && l.coutUsd === 0.01 && typeof l.totalApresUsd === 'number' && l.plafondUsd === 0.035));
          // un second lancement sur le MÊME carnet : le total inscrit compte
          const s2 = fauxServeur(); const r2 = await essaie(() => S.serie({ ...b }, deps(s2)));
          H.v('   même carnet, nouvelle série : le total déjà inscrit compte (0,03 + 0,01 > 0,035 ⇒ aucun scan)', [nid(s2), /plafond atteint/.test(r2.ok.arret || '')], [0, true]);
          H.v('   (le ping seul a été envoyé, aucune photo)', [s2.appels.filter(a => a.chemin === '/api/photo').length], [0]); }
        { const s = fauxServeur(); const b = base({ n: 3, plafondUsd: 0.01, coutEstimeUsd: 0.01 });
          const r = await essaie(() => S.serie(b, deps(s)));
          H.v('plafond égal à un scan : un scan, pas deux (on s\'arrête AVANT de franchir)', [nid(s), r.ok && r.ok.depenseUsd], [1, 0.01]); }
        { const s = fauxServeur(); const b = base({ n: 3, plafondUsd: 0.005, coutEstimeUsd: 0.01 });
          const r = await essaie(() => S.serie(b, deps(s)));
          H.v('plafond plus petit qu\'un scan : AUCUN scan, aucune photo envoyée', [nid(s), s.appels.filter(a => a.chemin === '/api/photo').length, /plafond atteint/.test(r.ok.arret || '')], [0, 0, true]); }
        for (const [nom, p] of [['absent', undefined], ['zéro', 0], ['négatif', -1], ['NaN', NaN], ['une chaîne', '1']]) {
            const s = fauxServeur(); const r = await essaie(() => S.serie(base({ plafondUsd: p }), deps(s)));
            H.v(`plafond ${nom} : refusé avant toute requête`, [/plafond-usd/.test(r.arret || ''), s.appels.length], [true, 0]);
        }
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ carnet: undefined }), deps(s))); H.v('carnet absent : refusé avant toute requête', [/carnet/.test(r.arret || ''), s.appels.length], [true, 0]); }
        { const f = path.join(dossier, 'abime.jsonl'); fs.writeFileSync(f, '{"coutUsd":0.01}\npas du json\n'); const s = fauxServeur(); const r = await essaie(() => S.serie(base({ carnet: f }), deps(s)));
          H.v('carnet illisible : refusé avant toute requête (on ne devine pas la dépense)', [/carnet illisible/.test(r.arret || ''), s.appels.length], [true, 0]); }

        // ── 4. l'échantillon ──
        const L = CLES.map(c => ({ cle: `${c}:0` }));
        const ech = (l, n, g) => S.echantillon(l, n, g).map(x => x.cle);
        H.v('même graine, mêmes lignes : même échantillon, même ordre', ech(L, 5, 7), ech(L, 5, 7));
        H.v('   quel que soit l\'ordre d\'entrée des lignes', ech([...L].reverse(), 5, 7), ech(L, 5, 7));
        H.vrai('   une autre graine : un autre ordre', JSON.stringify(ech(L, 8, 7)) !== JSON.stringify(ech(L, 8, 8)));
        H.vrai('   sans doublon, toutes tirées des lignes', new Set(ech(L, 8, 3)).size === 8 && ech(L, 8, 3).every(c => L.some(x => x.cle === c)));
        H.v('   n plus grand que les lignes : toutes les lignes', ech(L, 20, 1).length, 8);
        for (const [nom, n, g] of [['n nul', 0, 1], ['n non entier', 1.5, 1], ['graine absente', 3, undefined], ['graine non entière', 3, 1.2]])
            H.vrai(`   ${nom} : refusé`, (() => { try { S.echantillon(L, n, g); return false; } catch (e) { return e instanceof S.Arret; } })());
        { const sa = fauxServeur(), sb = fauxServeur(); const ra = await S.serie(base({ n: 5, graine: 11 }), deps(sa)), rb = await S.serie(base({ n: 5, graine: 11 }), deps(sb));
          H.v('une série rejouée : mêmes lignes, même ordre d\'envoi', [ra.lignes, ra.serie], [rb.lignes, rb.serie]);
          H.v('   l\'ordre des requêtes /api/identifier est celui des lignes (un vecteur par ligne)', sa.appels.filter(a => a.chemin === '/api/identifier').map(a => JSON.parse(a.corps).empreintes[0].vecteur), sb.appels.filter(a => a.chemin === '/api/identifier').map(a => JSON.parse(a.corps).empreintes[0].vecteur)); }

        // ── 5. durées ──
        H.v('quantile : p50 et p95 de 1..20 (rang supérieur)', [S.quantile([...Array(20).keys()].map(x => x + 1), 0.5), S.quantile([...Array(20).keys()].map(x => x + 1), 0.95)], [10, 19]);
        H.v('   liste désordonnée', S.statistiques([50, 10, 40, 20, 30]), { n: 5, p50: 30, p95: 50 });
        H.v('   une seule valeur', S.statistiques([7]), { n: 1, p50: 7, p95: 7 });
        H.v('   liste vide : n 0, p50 et p95 nuls (jamais un faux chiffre)', S.statistiques([]), { n: 0, p50: null, p95: null });
        { const s = fauxServeur(); const r = await S.serie(base({ n: 4 }), deps(s));
          H.v('la série mesure UNE durée par scan réussi (horloge injectée : 100 ms chacun)', [r.durees, r.stats], [[100, 100, 100, 100], { n: 4, p50: 100, p95: 100 }]); }

        // ── 6. la forme des requêtes ──
        { const s = fauxServeur({ capacites: ['empreinte'] }); const r = await S.serie(base({ n: 2, graine: 3 }), deps(s));
          const ph = s.appels.find(a => a.chemin === '/api/photo'), id = s.appels.find(a => a.chemin === '/api/identifier'), ids = s.appels.filter(a => a.chemin === '/api/identifier');
          H.v('l\'ordre des scans : photo puis identifier, deux fois', s.appels.slice(5).map(a => `${a.methode} ${a.chemin}`), ['POST /api/photo', 'POST /api/identifier', 'POST /api/photo', 'POST /api/identifier']);
          H.vrai('   tout part vers l\'hôte d\'essai, sans suivre une redirection', s.appels.every(a => a.hote === S.HOTE_ESSAI && a.redirect === 'manual'));
          H.vrai('   /api/photo : les octets bruts de la photo locale, type image/jpeg', Buffer.isBuffer(ph.corps) && /^photo-k\d$/.test(ph.corps.toString()) && ph.entetes['Content-Type'] === 'image/jpeg');
          const c = JSON.parse(id.corps);
          H.v('   /api/identifier : photoIds, une empreinte, le modèle, un marché, la version minimale du ping', [c.photoIds, c.empreintes.length, c.empreintes[0].photo, typeof c.empreintes[0].vecteur, c.empreintes[0].vecteur.length, c.modeleEmpreinte, c.marche, c.versionExtension, c.imageUrls.length],
              [[{ index: 0, photoId: photoIdN(1) }], 1, 0, 'string', 684, S.MODELE_DEFAUT, 'vinted.fr', '2.5.0', 1]);
          H.vrai('   l\'adresse d\'image exigée par la forme est une adresse Vinted (jamais téléchargée : un photoId est reçu)', /^https:\/\/[a-z0-9.]*vinted\.net\//.test(c.imageUrls[0]));
          H.vrai('   une clé d\'idempotence de la forme du serveur, différente par scan', /^[A-Za-z0-9_-]{8,64}$/.test(id.entetes['Idempotency-Key']) && id.entetes['Idempotency-Key'] !== ids[1].entetes['Idempotency-Key']);
          H.v('   le jeton `empreinte` du ping est rapporté', r.jetonEmpreinteAnnonce, true); }
        { const s = fauxServeur({ capacites: ['marques'] }); const d = deps(s); const r = await S.serie(base({ n: 1 }), d);
          H.v('   ping sans le jeton `empreinte` : rapporté ABSENT (le serveur ne se sert pas des vecteurs), la série continue', [r.jetonEmpreinteAnnonce, d.logs.some(l => /ABSENT/.test(l))], [false, true]); }
        { const s = fauxServeur(); await S.serie(base({ n: 1, cartes: undefined, modele: { id: 'autre-1', sha256: 'ab'.repeat(32) } }), deps(s));
          H.v('   un autre modèle donné en argument est repris tel quel', JSON.parse(s.appels.find(a => a.chemin === '/api/identifier').corps).modeleEmpreinte, { id: 'autre-1', sha256: 'ab'.repeat(32) }); }
        { const cartes = path.join(dossier, 'cartes'); fs.mkdirSync(cartes); for (const k of CLES) fs.writeFileSync(path.join(cartes, k + '.jpg'), Buffer.from('carte-' + k));
          const s = fauxServeur(); await S.serie(base({ n: 1, cartes }), deps(s)); const e = JSON.parse(s.appels.find(a => a.chemin === '/api/identifier').corps).empreintes[0];
          H.vrai('   avec --cartes : la carte redressée part en base64 dans l\'empreinte', typeof e.carte === 'string' && /^carte-k\d$/.test(Buffer.from(e.carte, 'base64').toString())); }
        { const sansPhoto = { ...nav, photos: { ...nav.photos, k9: { emb: Array(256).fill(0), redressee: true } } };
          const r0 = { ...resultats, ref: [...resultats.ref, { cle: 'k9:0', banc: 'lot', verite: 1, et: { type: 'question' } }] };
          const s = fauxServeur(); const r = await S.serie(base({ nav: sansPhoto, resultats: r0, n: 99 }), deps(s));
          H.vrai('une ligne sans photo locale n\'est jamais tirée (elle ne coûte rien)', !r.lignes.includes('k9:0') && r.lignes.length === 8); }
        { const nav0 = { photos: {} }; const s = fauxServeur(); const r = await essaie(() => S.serie(base({ nav: nav0 }), deps(s)));
          H.v('aucune ligne exploitable : arrêt avant toute requête', [/aucune ligne/.test(r.arret || ''), s.appels.length], [true, 0]); }

        // ── 7. la comparaison essai / local ──
        // essai : sûr sur k1 (101, comme le local), k2 (200 : AUTRE produit que le local, faux), k5 (105 : sûr que le local n'a pas), rien sur k3, k4 (le local l'a) ; k6..k8 rien des deux
        { const essai = { k1: 101, k2: 200, k5: 105 };
          // on identifie la ligne par le vecteur : la ligne i a un 1 en position i
          const decode = v => { const b = Buffer.from(v, 'base64'); for (let i = 0; i < 8; i++) if (b.readUInt16LE(i * 2) !== 0) return CLES[i]; return null; };
          const s2 = fauxServeur({ essai: corps => essai[decode(corps.empreintes[0].vecteur)] || null });
          const r = await S.serie(base({ n: 8, plafondUsd: 1 }), deps(s2));
          H.v('comparaison : sûrs de l\'essai 3, du local 4, les deux 2, même produit 1, essai seul 1, local seul 2', [r.comparaison.essaiSur, r.comparaison.localSur, r.comparaison.lesDeux, r.comparaison.memeProduit, r.comparaison.essaiSeul, r.comparaison.localSeul], [3, 4, 2, 1, 1, 2]);
          H.v('   faux par rapport à la vérité : essai 1 (k2), local 1 (k3)', [r.comparaison.fauxEssai, r.comparaison.fauxLocal], [1, 1]);
          H.vrai('   un « sûr » n\'est QUE le statut fermé `identifiee` : une question ne compte pas', r.resultats.filter(x => x.essaiSur).length === 3); }
        H.v('sureDe : identifiee avec un idProduct entier ⇒ sûr', S.sureDe({ analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: 5 } }] } }), { sur: true, produit: 5 });
        for (const [nom, rep] of [['a-trancher', { analyse: { cartes: [{ statut: 'a-trancher', carte: { idProduct: 5 } }] } }], ['sans carte', { analyse: { cartes: [{ statut: 'identifiee' }] } }], ['idProduct chaîne', { analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: '5' } }] } }], ['vide', {}], ['null', null], ['cartes vides', { analyse: { cartes: [] } }]])
            H.v(`   sureDe(${nom}) : pas sûr`, S.sureDe(rep).sur, false);
        H.v('lignesLocales : la variante LIVRÉ rejoue les « sûr », les lignes hors-banc sont écartées', S.lignesLocales(resultats).filter(l => l.localSur).map(l => [l.cle, l.localProduit]), [['k1:0', 101], ['k2:0', 102], ['k3:0', 999], ['k4:0', 104]]);
        H.v('   dénominateur imprimé : 8 lignes de banc (le hors-banc n\'y est pas)', S.lignesLocales(resultats).length, 8);

        // ── 8. les arrêts ──
        { const s = fauxServeur({ avant: (a, appels) => (a.chemin === '/api/identifier' && appels.filter(x => x.chemin === '/api/identifier').length === 2 ? { status: 429, json: async () => ({ success: false }), headers: { get: n => (n === 'retry-after' ? '60' : null) } } : null) });
          const r = await essaie(() => S.serie(base({ n: 6 }), deps(s)));
          H.v('un 429 sur /api/identifier : la série s\'arrête, SANS réessai ni boucle', [nid(s), /429/.test(r.ok.arret || '')], [2, true]); }
        { const s = fauxServeur({ avant: a => (a.chemin === '/api/photo' ? { status: 429, json: async () => ({ success: false }), headers: { get: () => '5' } } : null) });
          const r = await essaie(() => S.serie(base({ n: 3 }), deps(s)));
          H.v('un 429 sur /api/photo : arrêt, aucun scan payé', [nid(s), /429 sur \/api\/photo/.test(r.ok.arret || ''), s.appels.filter(a => a.chemin === '/api/photo').length], [0, true, 1]); }
        { const s = fauxServeur({ avant: a => (a.chemin === '/api/photo' ? { status: 302, json: async () => ({}), headers: { get: () => 'https://evil.fr' } } : null) });
          const r = await essaie(() => S.serie(base({ n: 3 }), deps(s)));
          H.v('une redirection : refusée, jamais suivie', [/redirection/.test(r.ok.arret || ''), s.appels.every(a => a.hote === S.HOTE_ESSAI)], [true, true]); }
        { const s = fauxServeur({ avant: a => (a.chemin === '/api/identifier' ? { status: 500, json: async () => ({}), headers: { get: () => null } } : null) });
          const r = await essaie(() => S.serie(base({ n: 6 }), deps(s)));
          H.v('trois erreurs de suite : arrêt (pas six scans payés pour rien)', [nid(s), r.ok.erreurs.length, /3 erreurs de suite/.test(r.ok.arret || '')], [3, 3, true]); }
        { const s = fauxServeur({ avant: a => (a.chemin === '/ping' ? { status: 200, json: async () => ({ ok: true }), headers: { get: () => null } } : null) });
          const r = await essaie(() => S.serie(base({ n: 2 }), deps(s)));
          H.v('un /ping sans versionMinExtension (v2 non annoncée) : arrêt avant toute photo', [/\/ping inattendu/.test(r.arret || ''), s.appels.length], [true, 1]); }
        { const s = fauxServeur({ avant: a => (a.chemin === '/api/identifier' && s.appels.filter(x => x.chemin === '/api/identifier').length === 1 ? { status: 500, json: async () => ({}), headers: { get: () => null } } : null) });
          const r = await essaie(() => S.serie(base({ n: 5 }), deps(s)));
          H.v('une erreur isolée ne coupe pas la série (le compteur de suite repart à zéro)', [r.ok.erreurs.length, r.ok.stats.n, r.ok.arret], [1, 4, null]); }
        // ── 9. le CONTRAT de la production (la première série réelle s'est arrêtée en `identifier-401` : le faux serveur acceptait n'importe quel corps) ──
        { entreesAcceptees = []; const s = fauxServeur(); const r = await S.serie(base({ n: 3 }), deps(s));
          const corpsEnvoyes = s.appels.filter(a => a.chemin === '/api/identifier').map(a => JSON.parse(a.corps));
          H.v('le corps envoyé porte `contrat: 2` (sinon l\'aiguilleur renvoie vers la route héritée : 401)', corpsEnvoyes.map(c => c.contrat), [2, 2, 2]);
          H.v('   les trois scans passent ; le faux serveur a jugé chaque corps par `verifierEntree` de la production : acceptés, sans erreur', [r.stats.n, r.erreurs.length, entreesAcceptees.length], [3, 0, 3]);
          H.vrai('   et l\'entrée acceptée porte les photos reçues et l\'empreinte (les deux drapeaux de l\'essai sont allumés)', entreesAcceptees.every(e => e.photoIds.length === 1 && e.empreintes && e.empreintes.rejet === null && e.empreintes.modele && e.empreintes.entrees.length === 1 && !e.empreintes.entrees[0].invalide));
          H.vrai('   les champs que la v2 attend : title, description, prixVinted, devise, langueInterface', corpsEnvoyes.every(c => c.title === '' && c.description === '' && c.prixVinted === null && c.devise === null && c.langueInterface === 'fr')); }
        { const s = fauxServeur(); const r = await essaie(() => S.serie(base({ n: 2 }), deps(s, {})));
          H.vrai('le faux serveur imite la production : un corps sans `contrat: 2` répond 401', true);
          const sansContrat = await s.fetch('https://' + S.HOTE_ESSAI + '/api/identifier', { method: 'POST', headers: { Authorization: `Bearer ${JETON_LIE}` }, body: JSON.stringify({ imageUrls: ['https://images1.vinted.net/a.jpg'], marche: 'vinted.fr', versionExtension: '2.5.0' }) });
          H.v('   (vérifié sur le faux serveur lui-même)', sansContrat.status, 401); }
        // la GARDE anti-Vinted : un scan ne compte que si `analyse.photoRecue === true` ; tout autre cas arrête la série à l'instant
        for (const [nom, comportement] of [['photoRecue faux', { photoRecue: { photosRecues: [], photoRecue: false } }], ['photoRecue absent', { photoRecue: {} }], ['photoRecue en chaîne "true"', { photoRecue: { photoRecue: 'true' } }], ['réponse sans analyse', { sansAnalyse: true }]]) {
            const s = fauxServeur(comportement), d = deps(s), b = base({ n: 5 });
            const r = await essaie(() => S.serie(b, d));
            H.v(`garde anti-Vinted (${nom}) : la série s'arrête au PREMIER scan, aucun suivant, rien de compté`, [nid(s), r.ok.resultats.length, r.ok.durees.length, /photo non rattachée.*série arrêtée/.test(r.ok.arret || '')], [1, 0, 0, true]);
            H.vrai(`   (${nom}) le message le dit : le serveur a pu retomber sur l'adresse de l'annonce`, /le serveur a pu retomber sur l'adresse de l'annonce/.test(r.ok.arret || '') && d.logs.some(l => /ARRÊT : photo non rattachée/.test(l)));
        }
        { const s = fauxServeur(), r = await S.serie(base({ n: 4 }), deps(s));
          H.v('garde anti-Vinted : photoRecue vrai partout ⇒ la série va au bout', [r.arret, r.stats.n], [null, 4]); }
        // le carnet : l'estimation reste inscrite AVANT l'appel ; une ligne « résultat » dit ce que la réponse permet de lire (jamais un coût inventé)
        { const s = fauxServeur(), b = base({ n: 2 }); await S.serie(b, deps(s));
          const lignes = fs.readFileSync(b.carnet, 'utf8').trim().split('\n').map(JSON.parse), estim = lignes.filter(l => l.coutUsd !== undefined), res = lignes.filter(l => l.resultat);
          H.v('carnet : une estimation et une ligne « résultat » par scan', [estim.length, res.length], [2, 2]);
          H.v('   « résultat » : statut HTTP, analyse présente, photo rattachée — et AUCUN coût', [res[0].resultat, res[0].coutUsd, res[0].rang, res[0].cle], [{ statutHttp: 200, analyse: true, photoRecue: true }, undefined, 1, estim[0].cle]);
          H.vrai('   la dépense reste la somme des estimations (la ligne « résultat » n\'ajoute rien)', Math.abs(fs.readFileSync(b.carnet, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse).reduce((t, l) => t + (l.coutUsd || 0), 0) - 0.02) < 1e-9);
          const s2 = fauxServeur({ sansAnalyse: true }), b2 = base({ n: 2 }); await essaie(() => S.serie(b2, deps(s2)));
          H.v('   réponse sans analyse : la ligne « résultat » le dit (analyse: false)', JSON.parse(fs.readFileSync(b2.carnet, 'utf8').trim().split('\n')[1]).resultat, { statutHttp: 200, analyse: false, photoRecue: false }); }
        H.vrai('le fetch global n\'a jamais servi (le banc n\'a fait AUCUN appel réseau)', true);
    } finally { globalThis.fetch = fetchGlobal; try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* le dossier temporaire se nettoie seul */ } }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });