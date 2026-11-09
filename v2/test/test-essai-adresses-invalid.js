'use strict';
// COMPTES DE PARCOURS EN `.invalid` sur l'ESSAI (décision de l'utilisateur, 2026-11-09) : le compte du site et les comptes de parcours-test sont en @rat-market.invalid, à CONDITION qu'AUCUN courriel ne parte vers eux
// (court-circuit AVANT Brevo : un rebond abîme la réputation d'envoi). Le lien passe par la route d'administration de l'essai. Ce banc le PROUVE avec le VRAI pilote Brevo (construit sur un faux `fetchImpl` compteur et
// une URL injectée, BANC_ISOLE) : zéro appel réseau, zéro réservation de plafond, et le lien est récupérable. Une mutation qui retire le court-circuit doit le faire échouer (rouge noté au rapport).
const H = require('./_harnais'); const A = require('./_b2-aide'); const M = require('../modeles'); const db = require('../db');
const express = require('express'); const pret = require('../pret');
const { lireConfig } = require('../config'); const { creerCourrierBrevo } = require('../comptes/courrier-brevo'); const { creerCourrierMemoire } = require('../comptes/courrier');
const garde = require('../garde-essai');

const chargeEssai = () => Object.keys(require.cache).some(k => /[\\/]v2[\\/]essai-parcours[\\/]index\.js$/.test(k));
const SEC = 'secret-de-parcours-' + 'x'.repeat(20), SERVICE = garde.SERVICE_ESSAI;
const ESSAI = { MONGODB_BASE: 'rm_essai', RENDER_SERVICE_ID: SERVICE, V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC, V2_SECRET_EMPREINTE: 'valeur-de-banc-seize' };
const EN = { 'x-rat-market-mesure': SEC };
const SITE_ADR = 'essai-site@rat-market.invalid';
const ONZE = Array.from({ length: 11 }, (_, i) => `essai${i + 1}@rat-market.invalid`);
const SUPPL = 'non-confirme@rat-market.invalid';          // un douzième compte déclaré pour ce banc seulement (un parcours interrompu avant la confirmation)
const REELLE = 'declaree@exemple.fr';                      // déclarée mais PAS en .invalid : le témoin sans court-circuit
const NONLISTEE = 'jamais-declaree@rat-market.invalid';
const MDP = 'un-mot-de-passe-solide', MDP2 = 'un-autre-mot-de-passe-solide';
const DEFI = [422, 'defi-anti-robot'];

(async () => {
    await H.ouvrirBac('test-essai-adresses-invalid.js'); await M.creerIndex(); H.fixerHorlogeMilieu();

    // ---- le VRAI pilote Brevo sur un faux transport compteur ; un espion compte les appels qui l'ATTEIGNENT ----
    let reseau = 0, reservations = 0;
    const fetchImpl = async () => { reseau++; return { status: 202, arrayBuffer: async () => new ArrayBuffer(0) }; };
    const plafond = { max: 300, async reserver() { reservations++; return true; } };
    const pilote = creerCourrierBrevo({ cle: 'cle-de-banc-0000000000', url: 'http://127.0.0.1:9/banc-isole', fetchImpl, plafond, de: 'no-reply@rat-market.fr', repondreA: 'contact@rat-market.fr', reessaiMs: 0 });
    const espion = Object.create(pilote); espion.appels = 0;
    for (const m of ['envoyerVerification', 'envoyerReinitialisation']) espion[m] = (...a) => { espion.appels++; return pilote[m](...a); };
    const etat = () => [espion.appels, reseau, reservations];
    const delta = (avant) => etat().map((x, i) => x - avant[i]);

    const turnstile = { verifier: async jeton => jeton === 'ok' };
    let n = 0;
    const cas = async (env, f) => {
        A.registre.vider(); A.registre.fournir('courrier', espion); A.registre.fournir('turnstile', turnstile);
        const cfg = lireConfig({ ...env, V2_LIEN_ORDINATEUR: '1' });
        const app = express(); app.set('trust proxy', true); app.use(express.json());
        const { assembler } = require('../index'); pret.armer(M.verifierIndex);
        app.use(assembler([require('../installations/monter'), require('../comptes/monter'), require('../lien-ordinateur/monter')], cfg, {}));
        const s = await H.serveur(app);
        const appel = (chemin, corps, entetes = {}) => H.appel(s.url, chemin, { methode: 'POST', corps, sansDefi: true, entetes: { ...A.SITE, ...A.ip(++n + 7000), ...entetes } });
        try { return await f(appel); } finally { await s.fermer(); }
    };
    const st = r => [r.statut, r.json && r.json.erreur && r.json.erreur.detail];
    const lienDe = async (appel, a) => appel('/api/essai/lien-confirmation', { email: a }, EN);
    const jetonDe = r => (r.json && r.json.lien ? new URL(r.json.lien).searchParams.get('jeton') : null);
    const cert = r => r.texte.startsWith('<');   // 404 natif d'Express (page HTML)

    // ---- 0. HORS DE L'ESSAI : pas de module, pas de court-circuit ----
    {
        const PROD = { ...ESSAI, MONGODB_BASE: 'test', V2_ESSAI_ADRESSES_MESURE: ONZE.join(',') };
        const avant = etat();
        const r = await cas(PROD, async appel => ({
            route: await lienDe(appel, SITE_ADR),
            avecSecret: st(await appel('/api/compte/inscription', { email: SITE_ADR }, EN)),            // défi NON dispensé : 422
            public: (await appel('/api/compte/inscription', { email: 'hors-essai@rat-market.invalid', turnstile: 'ok' })).statut,   // le chemin ordinaire : 202, le pilote est atteint (et refuse `.invalid`)
            attente: await A.attendre()
        }));
        H.v('production : route d\'administration en 404 natif, inscription avec secret => 422 (aucune dispense)', [cert(r.route), r.route.statut, r.avecSecret], [true, 404, DEFI]);
        H.v('production : le chemin ordinaire atteint le pilote (aucun court-circuit hors de l\'essai) et le pilote refuse `.invalid` sans réseau', [r.public, delta(avant)], [202, [1, 0, 0]]);
        H.vrai('production : le module essai-parcours n\'est pas chargé (require.cache)', !chargeEssai());
    }

    // ---- 1. SUR L'ESSAI : le parcours complet, 12 comptes en `.invalid`, avec le VRAI pilote ----
    const ENV = { ...ESSAI, V2_ESSAI_ADRESSES_MESURE: [...ONZE, SUPPL, REELLE].join(',') };
    const TOUS = [SITE_ADR, ...ONZE];
    {
        const avant = etat();
        const r = await cas(ENV, async appel => {
            const o = { parcours: [], seconde: {}, oubli: {}, interrompu: {} };
            for (const a of TOUS) {
                const insc = (await appel('/api/compte/inscription', { email: a }, EN)).statut; await A.attendre();
                const lien = await lienDe(appel, a);
                const verif = (await appel('/api/compte/verification', { jeton: jetonDe(lien), motDePasse: MDP })).statut;
                const conn = (await appel('/api/compte/connexion', { email: a, motDePasse: MDP }, EN)).statut;
                o.parcours.push([insc, lien.statut, typeof jetonDe(lien) === 'string' && jetonDe(lien).length > 20, verif, conn]);
            }
            // second passage du parcours : compte confirmé = silence, aucun lien, la connexion suffit
            const a = ONZE[2];
            o.seconde.insc = (await appel('/api/compte/inscription', { email: a }, EN)).statut; await A.attendre();
            o.seconde.lien = (await lienDe(appel, a)); o.seconde.conn = (await appel('/api/compte/connexion', { email: a, motDePasse: MDP }, EN)).statut;
            // mot de passe oublié : le lien est retenu sans courriel, et le nouveau mot de passe ouvre
            const b = ONZE[0];
            o.oubli.demande = (await appel('/api/compte/mot-de-passe-oublie', { email: b }, EN)).statut; await A.attendre();
            const lo = await lienDe(appel, b); o.oubli.lien = [lo.statut, lo.json && lo.json.type];
            o.oubli.reinit = (await appel('/api/compte/reinitialiser', { jeton: jetonDe(lo), motDePasse: MDP2 })).statut;
            o.oubli.conn = [(await appel('/api/compte/connexion', { email: b, motDePasse: MDP2 }, EN)).statut, (await appel('/api/compte/connexion', { email: b, motDePasse: MDP }, EN)).statut];
            o.oubli.encore = (await lienDe(appel, b)).statut;   // usage unique
            // parcours interrompu avant la confirmation : le lien est pris, le renvoi tombe sous la limite d'une confirmation par boîte et par 24 h (constat), le mot de passe oublié sert de voie de secours
            await appel('/api/compte/inscription', { email: SUPPL }, EN); await A.attendre();
            const l1 = await lienDe(appel, SUPPL);   // lu, jamais confirmé
            o.interrompu.premier = l1.statut;
            await appel('/api/compte/renvoyer-verification', { email: SUPPL }, EN); await A.attendre();
            o.interrompu.renvoi = (await lienDe(appel, SUPPL)).statut;
            await appel('/api/compte/mot-de-passe-oublie', { email: SUPPL }, EN); await A.attendre();
            const l2 = await lienDe(appel, SUPPL); o.interrompu.secours = [l2.statut, l2.json && l2.json.type];
            o.interrompu.reinit = (await appel('/api/compte/reinitialiser', { jeton: jetonDe(l2), motDePasse: MDP })).statut;
            o.interrompu.conn = (await appel('/api/compte/connexion', { email: SUPPL, motDePasse: MDP }, EN)).statut;
            return o;
        });
        H.v('12 comptes `.invalid` (site + essai1..11) : inscription 202, lien rendu (avec un jeton), vérification 200, connexion 200 — SANS un seul appel au pilote', r.parcours, Array(12).fill([202, 200, true, 200, 200]));
        H.v('second passage (compte confirmé) : inscription 202 en silence, aucun lien (404 INTROUVABLE), la connexion suffit (200)', [r.seconde.insc, r.seconde.lien.statut, r.seconde.lien.json && r.seconde.lien.json.erreur.code, r.seconde.conn], [202, 404, 'INTROUVABLE', 200]);
        H.v('mot de passe oublié : lien retenu (type reinitialisation), réinitialisation 200, le nouveau mot de passe ouvre et l\'ancien non, usage unique', [r.oubli.demande, r.oubli.lien, r.oubli.reinit, r.oubli.conn, r.oubli.encore], [202, [200, 'reinitialisation'], 200, [200, 401], 404]);
        H.v('parcours interrompu : premier lien rendu ; le renvoi tombe sous la limite des 24 h (aucun lien : constat) ; le mot de passe oublié reste la voie de secours (lien, réinitialisation, connexion)', [r.interrompu.premier, r.interrompu.renvoi, r.interrompu.secours, r.interrompu.reinit, r.interrompu.conn], [200, 404, [200, 'reinitialisation'], 200, 200]);
        H.v('TOUT le parcours : 0 appel qui atteint le pilote, 0 appel réseau, 0 réservation de plafond', delta(avant), [0, 0, 0]);
        // aucun courriel ne part non plus par le courrier mémoire du chemin ordinaire : aucune adresse de l'essai n'a de ligne de limite « lien-ordinateur »
        H.v('la route du lien ordinateur n\'a rien écrit', await db.col('limites').countDocuments({ cle: /^lien-ordinateur:/ }), 0);
    }

    // ---- 1 bis. la route du lien ORDINATEUR sur une adresse `.invalid` : 202, 0 réseau, plafond du jour intact ----
    {
        const avant = etat();
        const r = await cas(ENV, async appel => {
            const rep = await appel('/api/lien-ordinateur', { email: ONZE[4], turnstile: 'ok' });
            await require('../lien-ordinateur/service').attendre();
            return rep;
        });
        H.v('lien ordinateur sur une adresse `.invalid` : 202, 0 appel réseau, 0 réservation de plafond, ni marque ni compteur du jour', [r.statut, delta(avant), await db.col('limites').countDocuments({ cle: /^lien-ordinateur:/ }), await db.col('courriels_lien_jour').countDocuments({})], [202, [0, 0, 0], 0, 0]);
    }

    // ---- 2. ce que le court-circuit n'accorde PAS ----
    {
        const avant = etat();
        const r = await cas(ENV, async appel => {
            const o = {};
            o.reelle = (await appel('/api/compte/inscription', { email: REELLE }, EN)).statut; await A.attendre();
            o.reelleLien = await lienDe(appel, REELLE);
            o.nonListeeSecret = st(await appel('/api/compte/inscription', { email: NONLISTEE }, EN));
            o.nonListeePublic = (await appel('/api/compte/inscription', { email: NONLISTEE, turnstile: 'ok' })).statut; await A.attendre();
            o.nonListeeLien = await lienDe(appel, NONLISTEE);
            o.ancienne = [st(await appel('/api/compte/inscription', { email: 'ratmarket.contact+essai@gmail.com' }, EN)), st(await appel('/api/compte/connexion', { email: 'ratmarket.contact+essai@gmail.com', motDePasse: MDP }, EN))];
            o.banc = []; for (const a of ['banc-mesure@rat-market.invalid', 'banc-ordinaire@rat-market.invalid']) { await appel('/api/compte/inscription', { email: a }, EN); await A.attendre(); o.banc.push(cert(await lienDe(appel, a))); }
            o.sansSecret = [cert(await appel('/api/essai/lien-confirmation', { email: ONZE[0] })), cert(await appel('/api/essai/lien-confirmation', { email: ONZE[0] }, { 'x-rat-market-mesure': SEC + 'z' }))];
            return o;
        });
        H.v('une adresse déclarée hors `.invalid` N\'A PAS le court-circuit : le pilote est atteint et envoie (1 appel réseau, 1 réservation), et la route ne retient rien pour elle (404 natif)', [r.reelle, r.reelleLien.statut, cert(r.reelleLien), delta(avant).slice(1, 3)], [202, 404, true, [1, 1]]);
        H.v('une adresse `.invalid` NON déclarée : avec le secret 422 ; par le chemin ordinaire le pilote est atteint (donc la seconde barrière refuse `.invalid` sans réseau), aucun lien retenu', [r.nonListeeSecret, r.nonListeePublic, cert(r.nonListeeLien)], [DEFI, 202, true]);
        H.v('l\'ancienne adresse Gmail est sortie de la liste fermée : 422 sur l\'inscription et sur la connexion avec le bon secret', r.ancienne, [DEFI, DEFI]);
        H.v('banc-mesure@ et banc-ordinaire@ : aucun lien servi par la route (404 natif)', r.banc, [true, true]);
        H.v('sans secret ou avec un mauvais secret : 404 natif même pour une adresse de la liste', r.sansSecret, [true, true]);
        H.v('tout ce passage : 0 appel réseau en plus de la seule adresse déclarée hors `.invalid`', delta(avant)[1], 1);
    }

    // ---- 3. un emplacement PAR ADRESSE, usage unique, 15 minutes, horloge fausse ----
    {
        const { depuis, DUREE_LIEN_MS } = require('../essai-parcours');
        let t = 1_000_000;
        const mesure = depuis({ ...ENV }, { maintenant: () => t });
        const routes = []; const memoire = creerCourrierMemoire();
        const registre = { c: memoire, obtenir() { return this.c; }, fournir(_, o) { this.c = o; } };
        mesure.monter({ router: { post: (chemin, h) => routes.push(h) }, registre });
        const lire = async a => { let r = null; let suivi = false; await routes[0]({ get: k => (k.toLowerCase() === 'x-rat-market-mesure' ? SEC : undefined), body: { email: a } }, { setHeader() { }, status(s) { this.s = s; return this; }, json(j) { r = [this.s, j.lien || (j.erreur && j.erreur.code)]; return this; } }, () => { suivi = true; }); return suivi ? 'natif' : r; };
        const [A1, A2] = [ONZE[0], ONZE[1]];
        await registre.c.envoyerVerification(A1, 'https://exemple/v?jeton=A1'); await registre.c.envoyerVerification(A2, 'https://exemple/v?jeton=A2');
        const a2 = await lire(A2), a1 = await lire(A1), a1bis = await lire(A1);
        H.v('un emplacement par adresse : A2 puis A1 se lisent indépendamment ; usage unique', [a2, a1, a1bis], [[200, 'https://exemple/v?jeton=A2'], [200, 'https://exemple/v?jeton=A1'], [404, 'INTROUVABLE']]);
        await registre.c.envoyerVerification(A1, 'https://exemple/v?jeton=B'); t += 15 * 60e3 + 1;
        H.v('expiré (15 min et 1 ms) : 404 INTROUVABLE', await lire(A1), [404, 'INTROUVABLE']);
        await registre.c.envoyerVerification(A1, 'https://exemple/v?jeton=C'); await registre.c.envoyerVerification(A1, 'https://exemple/v?jeton=D');
        H.v('le dernier lien remplace le précédent', await lire(A1), [200, 'https://exemple/v?jeton=D']);
        H.v('une adresse hors liste ou non `.invalid` : route muette (suivi => 404 natif)', [await lire('ratmarket.contact+essai@gmail.com'), await lire(REELLE), await lire('banc-mesure@rat-market.invalid'), await lire(NONLISTEE)], Array(4).fill('natif'));
        H.vrai('la durée de vie est de 15 minutes au plus', DUREE_LIEN_MS <= 15 * 60e3);
        H.vrai('le courrier mémoire n\'a reçu AUCUN envoi pour les adresses `.invalid` (court-circuit avant le pilote)', memoire.envoyes.length === 0);
        // la carte est bornée par la liste : mille adresses `.invalid` hors liste ne retiennent rien
        for (let i = 0; i < 1000; i++) await registre.c.envoyerVerification(`x${i}@rat-market.invalid`, `https://exemple/v?jeton=X${i}`);
        H.v('mille adresses `.invalid` hors liste : le pilote est atteint (aucun court-circuit), et la route reste muette pour elles', [memoire.envoyes.length, await lire('x7@rat-market.invalid')], [1000, 'natif']);
    }

    await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
