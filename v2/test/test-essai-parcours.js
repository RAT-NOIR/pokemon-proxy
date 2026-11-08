'use strict';
// PARCOURS DU SITE sur l'ESSAI (décision de l'éditeur, 2026-11-08) : l'exemption du défi Turnstile (liée à l'adresse du compte de test) et la route d'administration du lien de confirmation.
// Condition de l'éditeur : ABSENTES du code servi en production, par un test et pas seulement par un drapeau. Aucun appel réseau, aucun courriel réel : pilote de courrier mémoire, Turnstile simulé.
// Ce banc tourne dans SON processus : `require.cache` y prouve que le module n'est pas chargé tant qu'aucun environnement d'essai n'a été lu.
const fs = require('fs'), path = require('path');
const H = require('./_harnais'); const A = require('./_b2-aide'); const M = require('../modeles');
const { lireConfig } = require('../config'); const { creerCourrierMemoire } = require('../comptes/courrier');
const garde = require('../garde-essai');

const chargeEssai = () => Object.keys(require.cache).some(k => /[\\/]v2[\\/]essai-parcours[\\/]index\.js$/.test(k));
const SEC = 'secret-de-parcours-' + 'x'.repeat(20), SERVICE = garde.SERVICE_ESSAI, ADRESSE = 'ratmarket.contact+essai@gmail.com';
const ESSAI = { MONGODB_BASE: 'rm_essai', RENDER_SERVICE_ID: SERVICE, V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC, V2_SECRET_EMPREINTE: 'valeur-de-banc-seize' };
const EN = { 'x-rat-market-mesure': SEC };

(async () => {
    H.vrai('(départ) le module essai-parcours n\'est pas chargé', !chargeEssai());
    await H.ouvrirBac('test-essai-parcours.js'); await M.creerIndex(); H.fixerHorlogeMilieu();
    const MDP = 'un-mot-de-passe-solide';
    const courrier = creerCourrierMemoire();
    const vus = [];
    const turnstile = { verifier: async (jeton, ip) => { vus.push([jeton, ip]); return jeton === 'ok'; } };
    let n = 0;
    const cas = async (env, f) => {   // démarre un serveur RÉEL sous cet environnement (passé à lireConfig seulement), exécute f(appel), ferme
        A.registre.vider(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile);
        const s = await A.demarrer(lireConfig(env));
        const appel = (chemin, corps, entetes = {}, methode = 'POST') => H.appel(s.url, chemin, { methode, corps, sansDefi: true, entetes: { ...A.SITE, ...A.ip(++n + 5000), ...entetes } });
        try { return await f(appel); } finally { await s.fermer(); }
    };
    const st = r => [r.statut, r.json && r.json.erreur && r.json.erreur.detail];
    const DEFI = [422, 'defi-anti-robot'];

    // ---- 1. HORS DE L'ESSAI : ni exemption, ni fonction, ni module chargé ----
    const NON_ESSAI = {
        'production (base test, autre service)': { ...ESSAI, MONGODB_BASE: 'test', RENDER_SERVICE_ID: 'srv-production-v1' },
        'base test sur le service de l\'essai': { ...ESSAI, MONGODB_BASE: 'test' },
        'base absente': (({ MONGODB_BASE, ...r }) => r)(ESSAI),
        'base test_scratch': { ...ESSAI, MONGODB_BASE: 'test_scratch' },
        'base « RM_ESSAI » (casse)': { ...ESSAI, MONGODB_BASE: 'RM_ESSAI' },
        'base « rm_essai » avec espace': { ...ESSAI, MONGODB_BASE: 'rm_essai ' },
        'service autre': { ...ESSAI, RENDER_SERVICE_ID: 'srv-autre-service' },
        'service absent (hors Render)': (({ RENDER_SERVICE_ID, ...r }) => r)(ESSAI),
        'service en majuscules': { ...ESSAI, RENDER_SERVICE_ID: SERVICE.toUpperCase() },
        'cible absente': (({ V2_CIBLE, ...r }) => r)(ESSAI),
        'cible prod': { ...ESSAI, V2_CIBLE: 'prod' },
        'variable seule (secret posé, rien d\'autre)': { V2_SECRET_MESURE: SEC },
        'tout absent': {}
    };
    for (const [nom, env] of Object.entries(NON_ESSAI)) {
        const m = lireConfig(env).mesure;
        H.v(`hors essai « ${nom} » : exemption inactive, aucune fonction`, [m.actif, typeof m.autorise, typeof m.monter, typeof m.raison === 'string' && m.raison.length > 5 && !m.raison.includes(SEC)], [false, 'undefined', 'undefined', true]);
    }
    H.vrai('hors essai : le module essai-parcours n\'est TOUJOURS pas chargé après 13 lectures de configuration (require.cache)', !chargeEssai());
    H.v('la garde de service : une liste permise de trois conditions', [garde.essaiProuve(ESSAI), garde.essaiProuve({}), garde.essaiProuve(null), garde.essaiProuve(undefined)], [true, false, false, false]);
    // montage RÉEL sous un environnement de production : la route d'administration n'existe pas, l'exemption ne dispense rien
    const PROD = NON_ESSAI['production (base test, autre service)'];
    const natif = await cas(PROD, async appel => {
        const inconnue = await appel('/api/essai/inconnue', { email: ADRESSE }, EN);
        const lien = await appel('/api/essai/lien-confirmation', { email: ADRESSE }, EN);
        const connexion = await appel('/api/compte/connexion', { email: ADRESSE, motDePasse: MDP }, EN);
        const inscription = await appel('/api/compte/inscription', { email: ADRESSE }, EN);
        const oubli = await appel('/api/compte/mot-de-passe-oublie', { email: ADRESSE }, EN), renvoi = await appel('/api/compte/renvoyer-verification', { email: ADRESSE }, EN);
        return { inconnue, lien, connexion, inscription, oubli, renvoi };
    });
    H.v('production : la route d\'administration rend le 404 NATIF, identique à une route inconnue (avec le bon secret et la bonne adresse)', [natif.lien.statut, natif.lien.texte.replace('lien-confirmation', 'inconnue') === natif.inconnue.texte], [404, true]);
    H.v('production : connexion, inscription, oubli, renvoi avec le bon en-tête et l\'adresse de test => 422 defi-anti-robot', [natif.connexion, natif.inscription, natif.oubli, natif.renvoi].map(st), Array(4).fill(DEFI));
    // LISTE FERMÉE : chacune des trois adresses (test + deux comptes de mesure), avec le bon secret, sous un environnement où UNE des trois conditions de la garde manque => 422 sur connexion, oubli et renvoi
    const LISTE = ['ratmarket.contact+essai@gmail.com', 'banc-mesure@rat-market.invalid', 'banc-ordinaire@rat-market.invalid'];
    for (const [nom, env] of [['base de production (test)', { ...ESSAI, MONGODB_BASE: 'test' }], ['autre service Render', { ...ESSAI, RENDER_SERVICE_ID: 'srv-autre' }], ['V2_CIBLE absente', (({ V2_CIBLE, ...r }) => r)(ESSAI)]]) {
        const r = await cas(env, async appel => { const o = []; for (const a of LISTE) for (const [ch, c] of [['/api/compte/connexion', { email: a, motDePasse: MDP }], ['/api/compte/mot-de-passe-oublie', { email: a }], ['/api/compte/renvoyer-verification', { email: a }]]) o.push(st(await appel(ch, c, EN))); return o; });
        H.v(`liste fermée, ${nom} : les 3 adresses x 3 routes avec le bon secret => 422 defi-anti-robot (aucune exemption)`, r, Array(9).fill(DEFI));
    }
    H.vrai('production : après un montage réel et des requêtes portant le secret, le module n\'est TOUJOURS pas chargé (require.cache)', !chargeEssai());

    // ---- 2. SUR L'ESSAI ----
    const journal = []; const espion = {}; for (const k of ['log', 'warn', 'error', 'info']) { espion[k] = console[k]; console[k] = (...a) => { journal.push(a.map(String).join(' ')); }; }
    let flux = null;
    try {
        flux = await cas(ESSAI, async appel => {
            const o = {};
            const AUTRES = ['bob@exemple.fr', 'ratmarket.contact@gmail.com', 'ratmarketcontact+essai@gmail.com', 'ratmarket.contact+essai@googlemail.com', 'ratmarket.contact+essai2@gmail.com', 'ratmarket.contact+essai@gmail.com.evil.fr', 'x@ratmarket.contact+essai@gmail.com'];
            const ROUTES = { connexion: ['/api/compte/connexion', e => ({ email: e, motDePasse: MDP })], inscription: ['/api/compte/inscription', e => ({ email: e })], oubli: ['/api/compte/mot-de-passe-oublie', e => ({ email: e })], renvoi: ['/api/compte/renvoyer-verification', e => ({ email: e })] };
            o.refus = {};
            for (const [nom, [chemin, corps]] of Object.entries(ROUTES)) {
                o.refus[nom] = [st(await appel(chemin, corps(ADRESSE))),                                 // sans secret
                                st(await appel(chemin, corps(ADRESSE), { 'x-rat-market-mesure': SEC + 'z' })),   // mauvais secret
                                st(await appel(chemin, corps(ADRESSE), { 'x-rat-market-mesure': '' })),
                                st(await appel(chemin, { ...corps(ADRESSE), email: [ADRESSE] }, EN)),             // adresse non texte
                                st(await appel(chemin, { ...corps(ADRESSE), email: undefined }, EN))];            // adresse absente
                for (const a of AUTRES) o.refus[nom].push(st(await appel(chemin, corps(a), EN)));              // bon secret, autre adresse
            }
            // dispense : le bon secret ET l'adresse exacte (casse et espaces tolérés comme partout)
            o.oubli = (await appel(ROUTES.oubli[0], ROUTES.oubli[1](ADRESSE), EN)).statut;
            o.renvoi = (await appel(ROUTES.renvoi[0], ROUTES.renvoi[1](ADRESSE), EN)).statut;
            o.origine = (await appel(ROUTES.connexion[0], ROUTES.connexion[1](ADRESSE), { ...EN, origin: 'https://evil.fr' })).statut;
            o.adminAvant = await appel('/api/essai/lien-confirmation', { email: ADRESSE }, EN);   // aucun lien retenu encore
            // le parcours : inscription -> lien -> confirmation -> connexion
            const avant = courrier.envoyes.length;
            o.inscription = await appel('/api/compte/inscription', { email: '  RatMarket.Contact+Essai@Gmail.com ' }, EN);
            await A.attendre();
            o.envoyes = courrier.envoyes.slice(avant).filter(e => e.type === 'verification').length;
            o.sans = await appel('/api/essai/lien-confirmation', { email: ADRESSE });                        // sans secret
            o.mauvais = await appel('/api/essai/lien-confirmation', { email: ADRESSE }, { 'x-rat-market-mesure': SEC + 'z' });
            o.autreAdr = await appel('/api/essai/lien-confirmation', { email: 'bob@exemple.fr' }, EN);
            o.sansCorps = await appel('/api/essai/lien-confirmation', undefined, EN);
            o.get = await appel('/api/essai/lien-confirmation', undefined, EN, 'GET');
            o.inconnue = await appel('/api/essai/inconnue', { email: ADRESSE }, EN);
            o.inconnueGet = await appel('/api/essai/inconnue', undefined, EN, 'GET');
            o.lien1 = await appel('/api/essai/lien-confirmation', { email: ADRESSE }, EN);
            o.lien2 = await appel('/api/essai/lien-confirmation', { email: ADRESSE }, EN);                  // usage unique
            const jeton = o.lien1.json && o.lien1.json.lien ? new URL(o.lien1.json.lien).searchParams.get('jeton') : null;
            o.jeton = jeton;
            o.verif = await appel('/api/compte/verification', { jeton, motDePasse: MDP });
            o.connexion = await appel('/api/compte/connexion', { email: ADRESSE, motDePasse: MDP }, EN);
            o.mauvaisMdp = (await appel('/api/compte/connexion', { email: ADRESSE, motDePasse: MDP + 'x' }, EN)).statut;
            // une AUTRE adresse (défi valide) ne laisse aucun lien à la route d'administration
            await appel('/api/compte/inscription', { email: 'autre@exemple.fr', turnstile: 'ok' });
            await A.attendre();
            o.autre = await appel('/api/essai/lien-confirmation', { email: ADRESSE }, EN);
            o.autreCourrier = courrier.envoyes.filter(e => e.type === 'verification' && e.email === 'autre@exemple.fr').length;
            o.textes = [o.inscription, o.lien1, o.lien2, o.mauvais, o.connexion].map(r => r.texte).join('\n') + JSON.stringify(o.refus);
            return o;
        });
    } finally { for (const k of Object.keys(espion)) console[k] = espion[k]; }
    H.vrai('sur l\'essai : le module est chargé (garde passée)', chargeEssai());
    for (const nom of ['connexion', 'inscription', 'oubli', 'renvoi'])
        // l'inscription lit l'adresse AVANT le défi (comme avant) : une adresse illisible ou invalide y est refusée en 422 « adresse-invalide » ; jamais une dispense, jamais un 202
        H.v(`essai ${nom} : sans secret, mauvais secret, secret vide, adresse non texte/absente, 7 autres adresses (bon secret) => 422 partout (defi-anti-robot)`, flux.refus[nom],
            Array.from({ length: 12 }, (_, i) => (nom === 'inscription' && [3, 4, 11].includes(i) ? [422, 'adresse-invalide'] : DEFI)));
    H.v('essai : oubli et renvoi du compte de test avec le bon secret => 202', [flux.oubli, flux.renvoi], [202, 202]);
    H.v('essai : l\'origine reste vérifiée (403)', flux.origine, 403);
    H.v('essai : route d\'administration avant toute inscription => 404 INTROUVABLE (JSON, secret valide)', [flux.adminAvant.statut, flux.adminAvant.json && flux.adminAvant.json.erreur && flux.adminAvant.json.erreur.code], [404, 'INTROUVABLE']);
    H.v('essai : inscription du compte de test sans jeton Turnstile, avec le secret, casse et espaces => 202, un courriel de confirmation', [flux.inscription.statut, flux.envoyes], [202, 1]);
    H.v('essai : route d\'administration sans secret / mauvais secret / autre adresse / sans corps / GET => 404 NATIF, identique à une route inconnue',
        [flux.sans, flux.mauvais, flux.autreAdr, flux.sansCorps].map(r => [r.statut, r.texte.replace('lien-confirmation', 'inconnue') === flux.inconnue.texte]).concat([[flux.get.statut, flux.get.texte.replace('lien-confirmation', 'inconnue') === flux.inconnueGet.texte]]), Array(5).fill([404, true]));
    H.v('essai : le bon secret et l\'adresse exacte rendent le lien (200, no-store), qui porte un jeton', [flux.lien1.statut, flux.lien1.entetes['cache-control'], typeof flux.jeton === 'string' && flux.jeton.length > 20, /^https:\/\//.test(flux.lien1.json.lien), !!flux.lien1.json.expire], [200, 'no-store', true, true, true]);
    H.v('essai : usage UNIQUE : la seconde lecture => 404 INTROUVABLE', [flux.lien2.statut, flux.lien2.json.erreur.code], [404, 'INTROUVABLE']);
    H.v('essai : le lien rendu confirme le compte (200), puis la connexion avec le secret => 200 + cookie ; mauvais mot de passe => 401', [flux.verif.statut, flux.connexion.statut, /^rm_session=/.test(flux.connexion.entetes['set-cookie'] || ''), flux.mauvaisMdp], [200, 200, true, 401]);
    H.v('essai : une autre adresse inscrite (défi valide) reçoit son courriel mais ne laisse AUCUN lien à la route d\'administration', [flux.autreCourrier, flux.autre.statut, flux.autre.json.erreur.code], [1, 404, 'INTROUVABLE']);
    const ligneSecret = journal.filter(l => l.includes(SEC) || l.includes(require('crypto').createHash('sha256').update(SEC).digest('hex')) || (flux.jeton && l.includes(flux.jeton)));
    H.v(`le secret, son condensé et le jeton du lien n'apparaissent dans AUCUNE des ${journal.length} lignes de journal`, ligneSecret.length, 0);
    H.vrai('le secret n\'apparaît dans aucune réponse HTTP (inscription, lien, connexion, refus)', !flux.textes.includes(SEC));
    const cfgE = lireConfig(ESSAI);
    H.vrai('le secret et son condensé ne sont ni dans JSON.stringify(cfg) ni dans util.inspect(cfg)', ![JSON.stringify(cfgE), require('util').inspect(cfgE, { depth: 6 })].some(s => s.includes(SEC) || s.includes(require('crypto').createHash('sha256').update(SEC).digest('hex'))));
    H.v('essai : secret absent ou trop court => exemption inactive avec sa raison', [lireConfig({ ...ESSAI, V2_SECRET_MESURE: undefined }).mesure, lireConfig({ ...ESSAI, V2_SECRET_MESURE: 'y'.repeat(31) }).mesure.actif].map(x => typeof x === 'object' ? [x.actif, /absent/.test(x.raison)] : x), [[false, true], false]);

    // ---- 2 bis. La liste fermée sur l'essai : les comptes de mesure gardent l'exemption, rien d'autre ----
    {
        const EP = require('../essai-parcours');
        H.v('la liste fermée contient exactement trois adresses : le compte de test et les deux comptes de mesure', [...EP.ADRESSES_EXEMPTEES].sort(), [...LISTE].sort());
        H.vrai('les adresses de mesure de la liste sont celles de leurs définitions (exemption-banc.js, compte-essai.js)', EP.ADRESSES_EXEMPTEES.includes(require('../installations/exemption-banc').ADRESSE_ORDINAIRE) && /ADRESSE_BANC = 'banc-mesure@rat-market\.invalid'/.test(fs.readFileSync(path.join(__dirname, '..', 'admin', 'compte-essai.js'), 'utf8')));
        const proches = ['banc-mesure@rat-market.invalid.evil.fr', 'banc-mesure2@rat-market.invalid', 'banc-mesure@rat-market.fr', 'xbanc-ordinaire@rat-market.invalid', 'admin@rat-market.invalid'];
        const r = await cas(ESSAI, async appel => {
            const o = {};
            o.listeConnexion = []; o.listeOubli = []; o.listeSans = [];
            for (const a of LISTE.slice(1)) {
                o.listeConnexion.push((await appel('/api/compte/connexion', { email: a, motDePasse: MDP }, EN)).statut);          // défi passé : compte inexistant => 401
                o.listeOubli.push((await appel('/api/compte/mot-de-passe-oublie', { email: a }, EN)).statut);
                o.listeSans.push(st(await appel('/api/compte/connexion', { email: a, motDePasse: MDP })));                      // sans secret : 422
            }
            o.proches = []; for (const a of proches) o.proches.push(st(await appel('/api/compte/connexion', { email: a, motDePasse: MDP }, EN)));
            o.lien = (await appel('/api/essai/lien-confirmation', { email: LISTE[1] }, EN)).texte.startsWith('<');                  // la route du lien : 404 natif (page HTML) pour un compte de mesure
            return o;
        });
        H.v('essai : les deux comptes de mesure avec le bon secret passent le défi (connexion 401 faute de compte, oubli 202)', [r.listeConnexion, r.listeOubli], [[401, 401], [202, 202]]);
        H.v('essai : sans secret, ces deux comptes restent soumis au défi (422)', r.listeSans, [DEFI, DEFI]);
        H.v('essai : cinq adresses voisines de la liste, bon secret => 422', r.proches, Array(5).fill(DEFI));
        H.vrai('essai : la route du lien de confirmation ne répond pas pour un compte de mesure (404 natif)', r.lien);
    }

    // ---- 3. L'expiration et l'usage unique du lien, sur une horloge fausse ----
    {
        let t = 1_000_000;
        const mesure = require('../essai-parcours').depuis(ESSAI, { maintenant: () => t });
        const routes = []; const registre = { c: creerCourrierMemoire(), obtenir() { return this.c; }, fournir(_, o) { this.c = o; } };
        mesure.monter({ router: { post: (chemin, h) => routes.push([chemin, h]) }, registre });
        const lire = async () => { let r = null; const res = { setHeader() { }, status(s) { this.s = s; return this; }, json(j) { r = [this.s, j]; return this; } }; let suivi = false; await routes[0][1]({ get: k => (k.toLowerCase() === 'x-rat-market-mesure' ? SEC : undefined), body: { email: ADRESSE } }, res, () => { suivi = true; }); return suivi ? 'natif' : r; };
        await registre.c.envoyerVerification(ADRESSE, 'https://exemple/verif?jeton=A');
        t += 14 * 60e3 + 59e3; const dans = await lire();
        await registre.c.envoyerVerification(ADRESSE, 'https://exemple/verif?jeton=B'); t += 15 * 60e3 + 1; const apres = await lire();
        await registre.c.envoyerVerification(ADRESSE, 'https://exemple/verif?jeton=C'); await registre.c.envoyerVerification(ADRESSE, 'https://exemple/verif?jeton=D'); const dernier = await lire();
        await registre.c.envoyerVerification('autre@exemple.fr', 'https://exemple/verif?jeton=E'); const autre = await lire();
        H.v('lien : lu à 14 min 59 s => rendu ; (nouveau lien) lu à 15 min 0,001 s => 404 INTROUVABLE ; le dernier lien remplace le précédent ; une autre adresse ne laisse rien',
            [dans[0], dans[1].lien, apres[0], dernier[1].lien, autre[0]], [200, 'https://exemple/verif?jeton=A', 404, 'https://exemple/verif?jeton=D', 404]);
        H.v('lien : la durée de vie est de 15 minutes au plus', require('../essai-parcours').DUREE_LIEN_MS <= 15 * 60e3, true);
        H.v('lien : le pilote enveloppé garde ses envois (courrier mémoire) et ne s\'enveloppe qu\'une fois', [registre.c.envoyes.length, (() => { const avant = registre.c; mesure.monter({ router: { post() { } }, registre }); return registre.c === avant; })()], [5, true]);
    }

    // ---- 4. PÉRIMÈTRE DU CODE : un seul point de chargement, aucun journal dans le module ----
    {
        const racine = path.join(__dirname, '..'), fautifs = [];
        (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') parcourir(p); } else if (e.name.endsWith('.js') && !p.includes(`${path.sep}essai-parcours${path.sep}`) && /essai-parcours/.test(fs.readFileSync(p, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n'))) fautifs.push(path.relative(racine, p).replace(/\\/g, '/')); } })(racine);
        H.v('hors du dossier et des bancs, SEUL v2/config.js nomme le module essai-parcours (hors commentaires)', fautifs, ['config.js']);
        H.v('le module ne journalise rien (aucun console.)', /console\./.test(fs.readFileSync(path.join(racine, 'essai-parcours', 'index.js'), 'utf8')), false);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
