'use strict';
// RESOUDRE-CARDMARKET — POST /api/banc/resoudre-cardmarket { url } : l'administrateur colle une adresse Cardmarket, l'API rend l'idProduct. Derrière un drapeau (V2_RESOLUTION_CARDMARKET=1).
// Base : la base EN MÉMOIRE du banc. Aucun réseau, aucune base réelle, aucune requête vers Cardmarket. Les acteurs sont de vraies lignes (comptes, installations liées ou non).
const H = require('./_harnais');
const express = require('express');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const { CODES } = require('../erreurs');
const monterBanc = require('../banc/monter');
const { creerCatalogue } = require('../identifier/catalogue');

const cfgOn = lireConfig({ MONGODB_BASE: 'test_scratch', V2_RESOLUTION_CARDMARKET: '1' });
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch' });
const code = r => r.json && r.json.erreur && r.json.erreur.code;
const detail = r => r.json && r.json.erreur && r.json.erreur.detail;
const oid = () => new mongoose.Types.ObjectId();
const BASE = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles';
const REEL = `${BASE}/30th-Celebration-JP/Dark-Tyranitar-m6aTRR-144`;

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { console.log(`   frontière de fenêtre (1 h) dans ${Math.round(reste / 1000)} s : attente`); await new Promise(r => setTimeout(r, reste + 2000)); } }

    // ── la configuration : le drapeau n'est allumé que par « 1 » exactement
    H.v('config : drapeau absent ⇒ éteint', cfgOff.resolutionCardmarket, false);
    H.v('config : V2_RESOLUTION_CARDMARKET=1 ⇒ allumé', cfgOn.resolutionCardmarket, true);
    for (const autre of ['0', 'true', 'oui', ' 1', '2', '']) H.v(`config : V2_RESOLUTION_CARDMARKET="${autre}" ⇒ éteint (et la configuration reste valide)`, lireConfig({ MONGODB_BASE: 'test_scratch', V2_RESOLUTION_CARDMARKET: autre }).resolutionCardmarket, false);
    H.v('config : le défaut est 600 par heure (celui des routes du banc)', cfgOn.limites.etiquetteParPorteurHeure, 600);

    await H.ouvrirBac('test-banc-resoudre-cardmarket.js'); await M.creerIndex();
    const reel = creerCatalogue({ cfg: cfgOn, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const etat = { catalogueEnPanne: false, rechercheEnPanne: false };
    const catalogue = { lire: async ids => { if (etat.catalogueEnPanne) throw Object.assign(new Error('catalogue HS'), { code: 'CAT_HS' }); return reel.lire(ids); } };
    // données fabriquées : le cas réel, un couple ambigu (deux produits), un produit sans nom (innommable), une casse voisine
    const semer = async (idProduct, nom, slugSet, slug, numero) => {
        await db.col('catalogue_produits').insertOne({ idProduct, name: nom, idMetacard: idProduct });
        await db.col('numeros_cartes').insertOne({ idProduct, slugSet, slug, numero });
    };
    await semer(907909, 'Dark Tyranitar', '30th-Celebration-JP', 'Dark-Tyranitar-m6aTRR-144', '144');
    await semer(1001, 'Pikachu', 'Base-Set', 'Pikachu-V1-BS58', '58');
    await semer(1002, 'Pikachu bis', 'Jumeau-Set', 'Jumeau-Carte', '1');
    await semer(1003, 'Pikachu ter', 'Jumeau-Set', 'Jumeau-Carte', '2');
    await db.col('numeros_cartes').insertOne({ idProduct: 1004, slugSet: 'Sans-Nom', slug: 'Sans-Nom-Carte', numero: '9' });   // aucune ligne de catalogue : innommable
    // le MÊME produit sur deux lignes (une ligne apprise deux fois) n'est pas une ambiguïté
    await db.col('numeros_cartes').insertOne({ idProduct: 1001, slugSet: 'Base-Set', slug: 'Pikachu-V1-BS58', numero: '58' });

    const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
    const monter = async cfg => {
        const app = express(); app.use(express.json());
        const router = express.Router();
        monterBanc.routes(router, cfg, { banc: {}, purge: purgeStub, catalogue, trouverIds: async (slugSet, slug) => { if (etat.rechercheEnPanne) throw Object.assign(new Error('numeros HS'), { code: 'NUM_HS' }); return require('../banc/resoudre-cardmarket').trouverIdsParDefaut(slugSet, slug); } });
        app.use(router);
        return H.serveur(app);
    };
    const srv = await monter(cfgOn), srvOff = await monter(cfgOff);

    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null, lie = true } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), ...(lie ? { compteId: c._id, generation: 0 } : {}) });
        return { c, jeton };
    }
    const ADM = await acteur({ role: 'administrateur' }), USR = await acteur({}), NON_LIE = await acteur({ role: 'administrateur', lie: false });
    const SEUL = await (async () => { const jeton = J.genererJeton(); await db.col('installations').insertOne(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'seule' })); return { jeton }; })();

    const post = (s, a, corps) => H.appel(s.url, '/api/banc/resoudre-cardmarket', { methode: 'POST', corps, entetes: a ? { authorization: `Bearer ${a.jeton}` } : {} });
    const brut = async (s, a, chemin) => { const x = await fetch(s.url + chemin, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jeton}` }, body: JSON.stringify({ url: REEL }) }); const texte = await x.text(); const h = Object.fromEntries(x.headers); delete h.date; delete h['content-length']; delete h.etag; return { statut: x.status, texte: texte.split(chemin).join('<CHEMIN>'), h }; };
    const snap = async () => JSON.stringify([await db.col('numeros_cartes').find({}).sort({ _id: 1 }).toArray(), await db.col('catalogue_produits').find({}).sort({ _id: 1 }).toArray(), await db.col('mouvements').countDocuments({}), await db.col('analyses').countDocuments({})]);
    const avant = await snap();

    // ═══ 1. le drapeau éteint : la route n'existe pas, pour TOUS, administrateur compris ═══
    {
        const vraie = await brut(srvOff, USR, '/api/banc/route-inexistante');
        const m = await brut(srvOff, ADM, '/api/banc/resoudre-cardmarket');
        H.v('1. drapeau éteint : même un administrateur reçoit le 404 natif d\'une route inexistante', m, vraie);
        H.vrai('1.    instrument : la route inexistante rend un 404 non JSON qui cite le chemin', vraie.statut === 404 && vraie.texte.includes('<CHEMIN>'));
        const r = await post(srvOff, null, { url: REEL });
        H.v('1. drapeau éteint, sans jeton : 404 aussi (la route n\'existe pas), pas 401', r.statut, 404);
        H.v('1. le drapeau éteint ne retire pas les autres routes du banc (l\'étiquette reste montée : sans jeton ⇒ 401)', (await H.appel(srvOff.url, '/api/banc/etiquette', { methode: 'POST', corps: {} })).statut, 401);
    }

    // ═══ 2. qui entre ═══
    {
        let r = await post(srv, null, { url: REEL });
        H.v('2. sans Bearer ⇒ 401', r.statut, 401);
        const vraie = await brut(srv, USR, '/api/banc/route-inexistante');
        for (const [nom, a] of [['compte non administrateur', USR], ['installation sans compte', SEUL], ['installation non liée', NON_LIE]]) {
            const m = await brut(srv, a, '/api/banc/resoudre-cardmarket');
            H.v(`2. ${nom} : même statut, même corps, mêmes en-têtes qu'une route inexistante`, m, vraie);
        }
        r = await post(srv, USR, { n_importe: 'quoi' });
        H.v('2. un non-administrateur au corps invalide reçoit aussi 404 (jamais 400)', [r.statut, code(r)], [404, undefined]);
        const A2 = await acteur({ role: 'administrateur' });
        r = await post(srv, A2, { url: REEL });
        H.v('2. administrateur : 200', r.statut, 200);
        await db.col('comptes').updateOne({ _id: A2.c._id }, { $unset: { role: '' } });
        r = await post(srv, A2, { url: REEL });
        H.v('2. rôle retiré entre deux requêtes ⇒ 404 natif', [r.statut, code(r)], [404, undefined]);
    }

    // ═══ 3. le cas réel et la forme de la réponse ═══
    {
        const r = await post(srv, ADM, { url: REEL });
        H.v('3. le cas réel (30th-Celebration-JP / Dark-Tyranitar-m6aTRR-144) ⇒ 200, idProduct 907909', [r.statut, r.json && r.json.idProduct], [200, 907909]);
        H.v('3. la réponse : success, nom, set { slug, nom }, numero, lien canonique — et rien d\'autre', r.json, { success: true, idProduct: 907909, nom: 'Dark Tyranitar', set: { slug: '30th-Celebration-JP', nom: '30th Celebration JP' }, numero: '144', lien: REEL });
        const { lienExact } = require('../identifier/lien-cardmarket');
        H.v('3. `lien` passe la garde du lien servi (lienExact)', lienExact(r.json.lien), r.json.lien);
        for (const lg of ['en', 'de', 'es', 'it']) {
            const x = await post(srv, ADM, { url: REEL.replace('/fr/', `/${lg}/`) });
            H.v(`3. la langue /${lg}/ résout le même produit, le lien rendu reste canonique`, [x.statut, x.json.idProduct, x.json.lien], [200, 907909, REEL]);
        }
        H.v('3. sans « www. » : même produit', (await post(srv, ADM, { url: REEL.replace('www.', '') })).json.idProduct, 907909);
        H.v('3. un autre produit du catalogue (Base-Set / Pikachu-V1-BS58), deux lignes pour le même produit ⇒ pas d\'ambiguïté', await post(srv, ADM, { url: `${BASE}/Base-Set/Pikachu-V1-BS58` }).then(x => [x.statut, x.json.idProduct]), [200, 1001]);
    }

    // ═══ 4. la requête et l'ancre sont ignorées ═══
    {
        for (const [nom, suite] of [['?language=1', '?language=1'], ['?sellerCountry=12&language=2', '?sellerCountry=12&language=2'], ['#offres', '#offres'], ['?language=1#offres', '?language=1#offres'], ['? vide', '?']]) {
            const r = await post(srv, ADM, { url: REEL + suite });
            H.v(`4. ${nom} ignoré ⇒ 200, 907909, lien canonique SANS requête`, [r.statut, r.json.idProduct, r.json.lien], [200, 907909, REEL]);
        }
    }

    // ═══ 5. les formes refusées : 422 ENTREE adresse-non-produit ═══
    {
        const mauvaises = [['recherche', `${BASE}/Search?searchString=pikachu`], ['liste d\'une expansion', 'https://www.cardmarket.com/fr/Pokemon/Expansions/Base-Set'], ['liste de produits', `${BASE}/Base-Set`],
            ['expansion « Search »', `${BASE}/Search/Pikachu`], ['un autre jeu', 'https://www.cardmarket.com/fr/Magic/Products/Singles/Base-Set/Pikachu'], ['un autre domaine', 'https://www.cardmarket.example.com/fr/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'],
            ['domaine voisin', 'https://evil-cardmarket.com/fr/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'], ['sous-domaine d\'un autre', 'https://www.cardmarket.com.evil.fr/fr/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'],
            ['http', 'http://www.cardmarket.com/fr/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'], ['langue inconnue', 'https://www.cardmarket.com/xx/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'], ['sans langue', 'https://www.cardmarket.com/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'],
            ['points-points', `${BASE}/Base-Set/..`], ['points-points au milieu', `${BASE}/Base..Set/Pikachu-V1-BS58`], ['segment avec %', `${BASE}/Base-Set/Pikachu%2DV1-BS58`], ['pourcent isolé', `${BASE}/Base-Set/Pikachu%`],
            ['segment commençant par un tiret', `${BASE}/-Base-Set/Pikachu-V1-BS58`], ['segment vide', `${BASE}//Pikachu-V1-BS58`], ['un segment de trop', `${BASE}/Base-Set/Pikachu-V1-BS58/Offers`], ['barre finale', `${BASE}/Base-Set/Pikachu-V1-BS58/`],
            ['espace', `${BASE}/Base-Set/Pikachu V1`], ['retour ligne', `${BASE}/Base-Set/Pikachu-V1-BS58\n`], ['identifiants dans l\'adresse', 'https://user:mdp@www.cardmarket.com/fr/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'], ['port', 'https://www.cardmarket.com:8443/fr/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'],
            ['hôte en majuscules', 'https://WWW.CARDMARKET.COM/fr/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58'], ['chaîne vide', ''], ['pas une adresse', 'pikachu'], ['javascript:', 'javascript:alert(1)'], ['juste un idProduct', '907909'], ['unicode', `${BASE}/Base-Set/Pikaçhu`]];
        for (const [nom, url] of mauvaises) {
            const r = await post(srv, ADM, { url });
            H.v(`5. ${nom} ⇒ 422 ENTREE adresse-non-produit`, [r.statut, code(r), detail(r)], [422, 'ENTREE', 'adresse-non-produit']);
        }
    }

    // ═══ 6. un produit inconnu, un couple ambigu, un produit innommable ═══
    {
        let r = await post(srv, ADM, { url: `${BASE}/Base-Set/Inconnu-V1-XX1` });
        const inconnu = Object.hasOwn(CODES, 'INTROUVABLE') ? 'INTROUVABLE' : 'CODE_INVALIDE';
        H.v(`6. aucun produit ne porte ce couple ⇒ 404 ${inconnu} produit-inconnu`, [r.statut, code(r), detail(r)], [404, inconnu, 'produit-inconnu']);
        r = await post(srv, ADM, { url: `${BASE}/Base-Set/Pikachu-v1-bs58` });
        H.v('6. la casse compte (couple exact) ⇒ 404 produit-inconnu', [r.statut, detail(r)], [404, 'produit-inconnu']);
        r = await post(srv, ADM, { url: `${BASE}/Autre-Set/Pikachu-V1-BS58` });
        H.v('6. le bon slug sous un autre set ⇒ 404 produit-inconnu (le couple compte)', [r.statut, detail(r)], [404, 'produit-inconnu']);
        r = await post(srv, ADM, { url: `${BASE}/Jumeau-Set/Jumeau-Carte` });
        H.v('6. deux produits portent le couple ⇒ 409 CONFLIT ambigu, le nombre est dit (2), aucun idProduct rendu', [r.statut, code(r), detail(r), r.json.idProduct, r.json.erreur.message.includes('2'), JSON.stringify(r.json).includes('1002')], [409, 'CONFLIT', 'ambigu', undefined, true, false]);
        r = await post(srv, ADM, { url: `${BASE}/Sans-Nom/Sans-Nom-Carte` });
        H.v('6. un produit sans nom au catalogue (innommable) ⇒ 404 produit-inconnu : on ne rend pas un produit qu\'on ne sait pas décrire', [r.statut, detail(r)], [404, 'produit-inconnu']);
    }

    // ═══ 7. le catalogue en panne ═══
    {
        etat.catalogueEnPanne = true;
        let r = await post(srv, ADM, { url: REEL });
        H.v('7. lecture du catalogue en panne ⇒ 503 INDISPONIBLE', [r.statut, code(r)], [503, 'INDISPONIBLE']);
        H.vrai('7.    le corps ne cite ni le code interne ni le message de l\'exception', !JSON.stringify(r.json).includes('CAT_HS') && !JSON.stringify(r.json).includes('catalogue HS'));
        etat.catalogueEnPanne = false; etat.rechercheEnPanne = true;
        r = await post(srv, ADM, { url: REEL });
        H.v('7. recherche du couple en panne ⇒ 503 INDISPONIBLE', [r.statut, code(r)], [503, 'INDISPONIBLE']);
        etat.rechercheEnPanne = false;
        H.v('7. la panne passée, la route répond de nouveau', (await post(srv, ADM, { url: REEL })).statut, 200);
    }

    // ═══ 8. le corps : url seule, chaîne de 2 048 caractères au plus ═══
    {
        const long = `${BASE}/Base-Set/${'a'.repeat(2048 - BASE.length - 10)}`;
        H.v('8. instrument : l\'adresse de 2 048 caractères pile est bien formée côté longueur', long.length <= 2048, true);
        const mauvais = [['corps vide', {}], ['url absente', { autre: 1 }], ['un champ de plus', { url: REEL, extra: 1 }], ['un champ de plus, url absente', { extra: 1 }], ['url nombre', { url: 907909 }], ['url null', { url: null }], ['url tableau', { url: [REEL] }], ['url objet', { url: { href: REEL } }], ['url booléen', { url: true }],
            ['url de 2 049 caractères', { url: 'h'.repeat(2049) }], ['url de 100 000 caractères', { url: 'h'.repeat(100000) }], ['corps tableau', [REEL]]];   // (un corps JSON qui n'est pas un objet ni un tableau est refusé par l'analyseur de corps de l'application, avant la route)
        for (const [nom, corps] of mauvais) {
            const r = await post(srv, ADM, corps);
            H.v(`8. ${nom} ⇒ 400 ENTREE`, [r.statut, code(r)], [400, 'ENTREE']);
        }
        const r2048 = await post(srv, ADM, { url: long });
        H.v('8. une adresse de 2 048 caractères ou moins est lue (ici : bien formée, couple inconnu ⇒ 404), pas refusée pour sa taille', [r2048.statut, detail(r2048)], [404, 'produit-inconnu']);
        const r2049 = await post(srv, ADM, { url: long + 'a' });
        H.v('8. 2 049 caractères ⇒ 400 (la taille se juge avant la forme)', [r2049.statut, code(r2049)], [400, 'ENTREE']);
    }

    // ═══ 9. aucune écriture, aucun argent ═══
    H.v('9. numeros_cartes, catalogue_produits, mouvements, analyses : inchangés après toutes ces requêtes', await snap(), avant);

    // ═══ 10. le limiteur : 600 par heure par porteur, la 601e rend 429 ; un non-administrateur ne voit jamais de 429 ═══
    {
        const L1 = await acteur({ role: 'administrateur' }), L2 = await acteur({ role: 'administrateur' });
        const corps = { url: REEL };
        let non200 = 0;
        for (let i = 0; i < 600; i++) { const r = await post(srv, L1, corps); if (r.statut !== 200) non200++; }
        const r601 = await post(srv, L1, corps);
        H.v('10. 600 requêtes passent, la 601e du même porteur ⇒ 429 DEBIT', [non200, r601.statut, code(r601)], [0, 429, 'DEBIT']);
        H.vrai('10.    Retry-After présent et égal à reessayerDans', Number(r601.entetes['retry-after']) >= 1 && r601.json.erreur.reessayerDans === Number(r601.entetes['retry-after']));
        H.v('10.    un AUTRE administrateur n\'est pas touché', (await post(srv, L2, corps)).statut, 200);
        const statuts = new Map();
        for (let i = 0; i < 601; i++) { const r = await post(srv, USR, corps); statuts.set(r.statut, (statuts.get(r.statut) || 0) + 1); }
        H.v('10.    compte non administrateur : 601 requêtes ⇒ 601 × 404, aucune 429', [...statuts], [[404, 601]]);
    }

    await srv.fermer(); await srvOff.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
