'use strict';
// PARCOURS DU SITE sur l'ESSAI (décision de l'éditeur, 2026-11-08) : l'exemption du défi Turnstile (liée à l'adresse du compte de test) et la route d'administration du lien de confirmation.
// Condition de l'éditeur : ABSENTES du code servi en production, par un test et pas seulement par un drapeau. Aucun appel réseau, aucun courriel réel : pilote de courrier mémoire, Turnstile simulé.
// Ce banc tourne dans SON processus : `require.cache` y prouve que le module n'est pas chargé tant qu'aucun environnement d'essai n'a été lu.
const fs = require('fs'), path = require('path');
const H = require('./_harnais'); const A = require('./_b2-aide'); const M = require('../modeles');
const { lireConfig } = require('../config'); const { creerCourrierMemoire } = require('../comptes/courrier');
const garde = require('../garde-essai');

const chargeEssai = () => Object.keys(require.cache).some(k => /[\\/]v2[\\/]essai-parcours[\\/]index\.js$/.test(k));
const SEC = 'secret-de-parcours-' + 'x'.repeat(20), SERVICE = garde.SERVICE_ESSAI, ADRESSE = 'essai-site@rat-market.invalid';
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
        'cible « Essai » (casse)': { ...ESSAI, V2_CIBLE: 'Essai' },
        'cible « ESSAI » (casse)': { ...ESSAI, V2_CIBLE: 'ESSAI' },
        'cible « essai » avec espace': { ...ESSAI, V2_CIBLE: 'essai ' },
        'cible « essai » précédée d\'un espace': { ...ESSAI, V2_CIBLE: ' essai' },
        'variable seule (secret posé, rien d\'autre)': { V2_SECRET_MESURE: SEC },
        'tout absent': {}
    };
    for (const [nom, env] of Object.entries(NON_ESSAI)) {
        const m = lireConfig(env).mesure;
        H.v(`hors essai « ${nom} » : exemption inactive, aucune fonction`, [m.actif, typeof m.autorise, typeof m.monter, typeof m.raison === 'string' && m.raison.length > 5 && !m.raison.includes(SEC)], [false, 'undefined', 'undefined', true]);
    }
    H.vrai(`hors essai : le module essai-parcours n'est TOUJOURS pas chargé après ${Object.keys(NON_ESSAI).length} lectures de configuration (require.cache)`, !chargeEssai());
    H.v('la garde de service : une liste permise de trois conditions', [garde.essaiProuve(ESSAI), garde.essaiProuve({}), garde.essaiProuve(null), garde.essaiProuve(undefined)], [true, false, false, false]);
    // seconde assertion (M17/M18) : la CAUSE du refus est toujours une chaîne non vide pour tout ce qui n'est pas l'essai (environnement illisible compris), jamais null ; et l'essai seul rend null
    H.v('la garde : raisonRefus rend null pour l\'essai SEUL et une cause (texte) pour tout le reste, entrées illisibles comprises',
        [garde.raisonRefus(ESSAI), ...[null, undefined, 'texte', 42, {}, { MONGODB_BASE: 'rm_essai' }, { ...ESSAI, V2_CIBLE: 'Essai' }].map(e => typeof garde.raisonRefus(e) === 'string' && garde.raisonRefus(e).length > 5), garde.essaiProuve('texte')], [null, true, true, true, true, true, true, true, false]);
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
    const LISTE = ['essai-site@rat-market.invalid', 'banc-mesure@rat-market.invalid', 'banc-ordinaire@rat-market.invalid'];
    // + les adresses déclarées dans V2_ESSAI_ADRESSES_MESURE (lues seulement APRÈS la garde : sous une garde qui échoue, elles ne dispensent rien)
    const MDP_PARCOURS = 'mdp-parcours-' + 'q'.repeat(12), ADR_P1 = 'parcours-route@rat-market.invalid', ADR_P2 = 'parcours-essai@rat-market.invalid';
    const PARCOURS = `${ADR_P1}, ${ADR_P2.toUpperCase()}`;   // la variable du serveur : des adresses, séparées par des virgules, rien d'autre
    const COMPTES_OUTIL = JSON.stringify([{ role: 'route', id: 'a'.repeat(24), email: ADR_P1, motDePasse: MDP_PARCOURS }]);   // la variable de L'OUTIL (avec mots de passe) : le serveur ne la lit pas
    for (const [nom, env] of [['base de production (test)', { ...ESSAI, MONGODB_BASE: 'test' }], ['autre service Render', { ...ESSAI, RENDER_SERVICE_ID: 'srv-autre' }], ['V2_CIBLE absente', (({ V2_CIBLE, ...r }) => r)(ESSAI)]]) {
        const r = await cas({ ...env, V2_ESSAI_ADRESSES_MESURE: PARCOURS }, async appel => { const o = []; for (const a of [...LISTE, ADR_P1, ADR_P2]) for (const [ch, c] of [['/api/compte/connexion', { email: a, motDePasse: MDP }], ['/api/compte/mot-de-passe-oublie', { email: a }], ['/api/compte/renvoyer-verification', { email: a }]]) o.push(st(await appel(ch, c, EN))); return o; });
        H.v(`liste fermée, ${nom} : les 3 adresses + 2 déclarées x 3 routes avec le bon secret => 422 defi-anti-robot (aucune exemption)`, r, Array(15).fill(DEFI));
    }
    H.vrai('production : après un montage réel et des requêtes portant le secret, le module n\'est TOUJOURS pas chargé (require.cache)', !chargeEssai());

    // ---- 2. SUR L'ESSAI ----
    const journal = []; const espion = {}; for (const k of ['log', 'warn', 'error', 'info']) { espion[k] = console[k]; console[k] = (...a) => { journal.push(a.map(String).join(' ')); }; }
    let flux = null;
    try {
        flux = await cas(ESSAI, async appel => {
            const o = {};
            const AUTRES = ['bob@exemple.fr', 'ratmarket.contact@gmail.com', 'ratmarketcontact+essai@gmail.com', 'ratmarket.contact+essai@googlemail.com', 'ratmarket.contact+essai2@gmail.com', 'ratmarket.contact+essai@gmail.com.evil.fr', 'x@ratmarket.contact+essai@gmail.com', 'ratmarket.contact+essai@gmail.com'];
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
            o.inscription = await appel('/api/compte/inscription', { email: '  Essai-Site@Rat-Market.Invalid ' }, EN);
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
        H.v(`essai ${nom} : sans secret, mauvais secret, secret vide, adresse non texte/absente, 8 autres adresses dont l'ancienne adresse Gmail (bon secret) => 422 partout (defi-anti-robot)`, flux.refus[nom],
            Array.from({ length: 13 }, (_, i) => (nom === 'inscription' && [3, 4, 11].includes(i) ? [422, 'adresse-invalide'] : DEFI)));
    H.v('essai : oubli et renvoi du compte de test avec le bon secret => 202', [flux.oubli, flux.renvoi], [202, 202]);
    H.v('essai : l\'origine reste vérifiée (403)', flux.origine, 403);
    H.v('essai : route d\'administration avant toute inscription => 404 INTROUVABLE (JSON, secret valide)', [flux.adminAvant.statut, flux.adminAvant.json && flux.adminAvant.json.erreur && flux.adminAvant.json.erreur.code], [404, 'INTROUVABLE']);
    H.v('essai : inscription du compte de test sans jeton Turnstile, avec le secret, casse et espaces => 202, AUCUN courriel (court-circuit avant le pilote ; le lien est retenu)', [flux.inscription.statut, flux.envoyes], [202, 0]);
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

    // ---- 2 ter. B1 : les comptes déclarés dans V2_ESSAI_ADRESSES_MESURE (parcours-test), liste fermée, adresses EXACTES ----
    {
        const sansVar = n => cas(ESSAI, async appel => [st(await appel('/api/compte/connexion', { email: n, motDePasse: MDP }, EN))[0]]);
        const avec = (v, adresses) => cas({ ...ESSAI, V2_ESSAI_ADRESSES_MESURE: v }, async appel => { const o = []; for (const a of adresses) o.push((await appel('/api/compte/connexion', { email: a, motDePasse: MDP }, EN)).statut); return o; });
        const BRUIT = [ADR_P1, '', ' ', ',', 'sans-arobase', '*', '@rat-market.invalid', 'a b@rat-market.invalid', '{"email":"x@rat-market.invalid"}', ADR_P2].join(',');
        H.v('B1 : un compte déclaré passe le défi (connexion 401 faute de compte), casse tolérée ; adresses voisines, domaine seul, motifs, entrées vides ou non adresses => 422', await avec(PARCOURS, [ADR_P1, ADR_P2, 'PARCOURS-ROUTE@RAT-MARKET.INVALID', 'parcours-route@rat-market.invalid.evil.fr', 'xparcours-route@rat-market.invalid', 'parcours-route@rat-market.fr', 'autre@rat-market.invalid', 'sans-arobase', '*@rat-market.invalid', '']), [401, 401, 401, 422, 422, 422, 422, 422, 422, 422]);
        H.v('B1 : variable absente = les trois adresses seules (une adresse déclarée ailleurs reçoit 422 ; le compte de mesure passe)', [await sansVar(ADR_P1), await sansVar('banc-mesure@rat-market.invalid')], [[422], [401]]);
        H.v('B1 : variable illisible (pas du JSON, ou pas une liste) = les trois adresses seules', [await avec('pas du json', [ADR_P1, 'banc-mesure@rat-market.invalid']), await avec('{"email":"parcours-route@rat-market.invalid"}', [ADR_P1, 'banc-mesure@rat-market.invalid'])], [[422, 401], [422, 401]]);
        H.v('B1 : entrées mêlées (vides, nombres, tableaux, motifs, non-adresses) : seules les deux vraies adresses passent', await avec(BRUIT, [ADR_P1, ADR_P2, 'sans-arobase', '@rat-market.invalid', 'a b@rat-market.invalid', '*@rat-market.invalid']), [401, 401, 422, 422, 422, 422]);
        // les mots de passe de la variable ne sortent nulle part : ni configuration, ni réponse
        const cfgP = lireConfig({ ...ESSAI, V2_ESSAI_ADRESSES_MESURE: PARCOURS, V2_PARCOURS_COMPTES: COMPTES_OUTIL });
        const sortie = JSON.stringify(cfgP) + require('util').inspect(cfgP, { depth: 8 }) + JSON.stringify(cfgP.mesure);
        H.vrai('B1 : ni les mots de passe ni les adresses déclarées ne sont dans la configuration sérialisée ou inspectée', !sortie.includes(MDP_PARCOURS) && !sortie.includes(ADR_P1) && !sortie.includes(ADR_P2));
        // la route du lien vaut pour une adresse déclarée EN `.invalid` (404 JSON INTROUVABLE tant qu'aucun lien n'est retenu), jamais pour une adresse déclarée hors `.invalid` (404 natif)
        const lienP = await cas({ ...ESSAI, V2_ESSAI_ADRESSES_MESURE: `${PARCOURS},declaree@exemple.fr` }, async appel => { const a = await appel('/api/essai/lien-confirmation', { email: ADR_P1 }, EN), b = await appel('/api/essai/lien-confirmation', { email: 'declaree@exemple.fr' }, EN); return [a.statut, a.json && a.json.erreur && a.json.erreur.code, b.texte.startsWith('<')]; });
        H.v('B1 : la route du lien sert une adresse déclarée en `.invalid` (404 INTROUVABLE faute de lien) et reste muette (404 natif) pour une adresse déclarée hors `.invalid`', lienP, [404, 'INTROUVABLE', true]);
        // tour 2 : la variable de L'OUTIL (V2_PARCOURS_COMPTES, avec mots de passe) posée sur l'essai ne dispense RIEN : le serveur ne la lit pas
        const seule = await cas({ ...ESSAI, V2_PARCOURS_COMPTES: COMPTES_OUTIL }, async appel => st(await appel('/api/compte/connexion', { email: ADR_P1, motDePasse: MDP }, EN)));
        H.v('tour 2 : V2_PARCOURS_COMPTES posée seule (la variable de l\'outil) ne dispense aucune adresse : 422', seule, DEFI);
    }

    // ---- 2 quater. F1/F5 : un compte de MÊME CLÉ (emailCle) inscrit AVANT le compte de test : aucun courriel ne part vers lui, aucun lien n'est retenu ----
    {
        // le compte de test est désormais en `.invalid` (sans alias de boîte) : la protection s'éprouve sur une adresse DÉCLARÉE hors `.invalid` dont la clé est celle d'une autre boîte réelle (Gmail ignore points et « +… »)
        const db = require('../db'), AUTRE_BOITE = 'bancboite@gmail.com', ADR_G = 'banc.boite+essai@gmail.com';
        await db.col('comptes').deleteMany({ emailCle: 'bancboite@gmail.com' }); await db.col('limites').deleteMany({});
        const r = await cas({ ...ESSAI, V2_ESSAI_ADRESSES_MESURE: ADR_G }, async appel => {
            const o = {}, mails = () => courrier.envoyes.length, vers = a => courrier.envoyes.filter(e => e.email === a).length;
            await appel('/api/compte/inscription', { email: AUTRE_BOITE, turnstile: 'ok' }); await A.attendre();        // la VRAIE boîte s'inscrit d'abord (défi valide) : son courriel part
            o.avant = vers(AUTRE_BOITE);
            await db.col('limites').deleteMany({}); const m0 = mails();
            o.inscr = (await appel('/api/compte/inscription', { email: ADR_G }, EN)).statut; await A.attendre();      // dispensée : trouve le compte de même clé
            await db.col('limites').deleteMany({});
            o.renvoi = (await appel('/api/compte/renvoyer-verification', { email: ADR_G }, EN)).statut; await A.attendre();
            await db.col('limites').deleteMany({});
            o.oubli = (await appel('/api/compte/mot-de-passe-oublie', { email: ADR_G }, EN)).statut; await A.attendre();
            o.partis = mails() - m0;
            o.lien = await appel('/api/essai/lien-confirmation', { email: ADR_G }, EN);
            await db.col('limites').deleteMany({}); const m1 = mails();
            await appel('/api/compte/renvoyer-verification', { email: AUTRE_BOITE, turnstile: 'ok' }); await A.attendre();   // témoin : sans l'exemption, le MÊME renvoi fait partir le courriel
            o.temoin = mails() - m1;
            return o;
        });
        H.v('F1/F5 : la vraie boîte inscrite avant reçoit son courriel ; la demande dispensée (inscription, renvoi, oubli) pour l\'adresse de test, de même clé, répond 202 mais NE FAIT PARTIR AUCUN courriel', [r.avant, r.inscr, r.renvoi, r.oubli, r.partis], [1, 202, 202, 202, 0]);
        H.v('F1/F5 : aucun lien n\'est retenu pour ce compte de même clé (404 natif : adresse hors `.invalid`), et le témoin (renvoi ordinaire avec défi) fait bien partir un courriel', [r.lien.statut, r.lien.texte.startsWith('<'), r.temoin], [404, true, 1]);
        await db.col('comptes').deleteMany({ emailCle: 'bancboite@gmail.com' }); await db.col('limites').deleteMany({});
    }

    // ---- 2 quinquies. Démarrage RÉEL par process.env (v2/index.js:20,23,29) dans un processus enfant, dossier absent comprise ----
    {
        const { execFileSync } = require('child_process'), base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };
        const enfant = env => { try { const sortie = execFileSync(process.execPath, [path.join(__dirname, '_enfant-parcours.js')], { env: { ...base, ...env }, encoding: 'utf8', timeout: 120000 }); return JSON.parse(sortie.split(/\r?\n/).filter(l => l.startsWith('{"charge"')).pop()); } catch (e) { return { erreur: String(e.status || e.name) }; } };
        const PROD_E = { MONGODB_BASE: 'test', RENDER_SERVICE_ID: SERVICE, V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC, V2_SECRET_EMPREINTE: 'valeur-de-banc-seize' }, ESSAI_E = { ...ESSAI };
        H.v('démarrage réel (process.env) en PRODUCTION : configuration valide, module non chargé', (({ charge, valide }) => [charge, valide])(enfant(PROD_E)), [false, true]);
        H.v('démarrage réel (process.env) sur l\'ESSAI : configuration valide, module chargé', (({ charge, valide }) => [charge, valide])(enfant(ESSAI_E)), [true, true]);
        H.v('démarrage réel en PRODUCTION, dossier essai-parcours ABSENT (simulé au chargement) : la configuration se charge, module non chargé', (({ charge, valide }) => [charge, valide])(enfant({ ...PROD_E, ENFANT_SANS_MODULE: '1' })), [false, true]);
        H.v('démarrage réel sur l\'ESSAI, dossier ABSENT : échec fermé (configuration invalide, routes en 503), jamais une exemption sans module', (({ valide }) => [valide])(enfant({ ...ESSAI_E, ENFANT_SANS_MODULE: '1' })), [false]);
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
        H.v('lien : le pilote enveloppé garde ses envois (courrier mémoire) et ne s\'enveloppe qu\'une fois', [registre.c.envoyes.length, (() => { const avant = registre.c; mesure.monter({ router: { post() { } }, registre }); return registre.c === avant; })()], [1, true]);   // un seul envoi atteint le pilote : l'adresse `.invalid` est court-circuitée (4 liens retenus sans courriel), « autre@exemple.fr » part
    }

    // F4 (revu) : pour une adresse `.invalid` de la liste, le pilote n'est JAMAIS appelé (même un pilote qui lèverait) et le lien est retenu ; pour toute autre adresse, un envoi en échec relève son erreur et ne retient RIEN
    {
        let appels = 0;
        const echec = { envoyerVerification: async () => { appels++; throw Object.assign(new Error('x'), { name: 'BrevoPlafond' }); }, envoyerReinitialisation: async () => { appels++; throw Object.assign(new Error('x'), { name: 'BrevoPlafond' }); } };
        const reg = { c: echec, obtenir() { return this.c; }, fournir(_, o) { this.c = o; } }, routes = [];
        require('../essai-parcours').depuis({ ...ESSAI, V2_ESSAI_ADRESSES_MESURE: 'declaree@exemple.fr' }).monter({ router: { post: (ch, h) => routes.push(h) }, registre: reg });
        const lire = async a => { let r = null, suivi = false; await routes[0]({ get: () => SEC, body: { email: a } }, { setHeader() { }, status(s) { this.s = s; return this; }, json(j) { r = [this.s, j.erreur ? j.erreur.code : j.type]; return this; } }, () => { suivi = true; }); return suivi ? 'natif' : r; };
        await reg.c.envoyerVerification(ADRESSE, 'https://exemple/verif?jeton=Z'); const l1 = await lire(ADRESSE);
        await reg.c.envoyerReinitialisation(ADRESSE, 'https://exemple/reinit?jeton=Y'); const l2 = await lire(ADRESSE);
        const avant = appels; let leve = null; try { await reg.c.envoyerVerification('declaree@exemple.fr', 'https://exemple/verif?jeton=W'); } catch (e) { leve = e.name; }
        H.v('F4 : adresse `.invalid` de la liste : le pilote n\'est pas appelé (même en panne) et le lien est retenu (verification, reinitialisation) ; adresse déclarée hors `.invalid` : le pilote est appelé, son erreur remonte, rien n\'est retenu',
            [avant, l1, l2, leve, appels - avant, await lire('declaree@exemple.fr')], [0, [200, 'verification'], [200, 'reinitialisation'], 'BrevoPlafond', 1, 'natif']);
    }

    // ---- 4. PÉRIMÈTRE DU CODE : un seul point de chargement, aucun journal dans le module ----
    {
        const racine = path.join(__dirname, '..'), fautifs = [];
        (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') parcourir(p); } else if (e.name.endsWith('.js') && !p.includes(`${path.sep}essai-parcours${path.sep}`) && /essai-parcours/.test(fs.readFileSync(p, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n'))) fautifs.push(path.relative(racine, p).replace(/\\/g, '/')); } })(racine);
        H.v('hors du dossier et des bancs, SEUL v2/config.js nomme le module essai-parcours (hors commentaires)', fautifs, ['config.js']);
        // tour 2 : le code SERVEUR ne relit jamais la variable de l'outil (elle porte des mots de passe) ; seuls les outils en ligne de commande (admin/, mesures/, migrations/, test/) peuvent la nommer
        const lecteurs = [];
        (function chercher(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isSymbolicLink()) continue; if (e.isDirectory()) { if (!['test', 'admin', 'mesures', 'migrations', 'node_modules'].includes(rel ? '' : e.name) && e.name !== 'node_modules') chercher(path.join(d, e.name), r); } else if (/\.(?:js|cjs|mjs)$/.test(e.name) && fs.readFileSync(path.join(d, e.name), 'utf8').includes('V2_PARCOURS_COMPTES')) lecteurs.push(r); } })(racine, '');
        H.v('tour 2 : aucun fichier du code serveur (hors outils en ligne de commande et bancs) ne nomme V2_PARCOURS_COMPTES', lecteurs, []);
        H.v('le module ne journalise rien (aucun console.)', /console\./.test(fs.readFileSync(path.join(racine, 'essai-parcours', 'index.js'), 'utf8')), false);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
