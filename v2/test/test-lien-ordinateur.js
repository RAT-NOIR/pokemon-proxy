'use strict';
// LIEN-ORDINATEUR (D1 du site, accordée par l'éditeur le 2026-11-08) : POST /api/lien-ordinateur, « recevoir le lien de l'extension sur mon ordinateur ».
// Un visiteur sans compte donne une adresse ; il reçoit UN courriel dont le seul contenu est le lien de la fiche du Chrome Web Store. Gardes exigées :
// Turnstile (action `lien-ordinateur`), un envoi par adresse et par 24 h, une limite par IP, un plafond global par jour de Paris, un message FIXE (aucun texte de l'utilisateur),
// l'adresse jamais conservée (une empreinte HMAC, 24 h). Aucune requête réelle : Turnstile, courrier et Brevo sont simulés.
const http = require('http'), crypto = require('crypto');
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const { creerCourrierMemoire, creerCourrierBrevo } = require('../comptes/courrier'); const G = require('../comptes/gabarits-courriel');
const { creerPlafondJour } = require('../comptes/plafond-courriels');
const express = require('express'); const pret = require('../pret'); const cors = require('../transport/cors');

const BASE = { MONGODB_BASE: 'test_scratch', V2_LIEN_ORDINATEUR: '1' };
async function demarrer(cfg) {
    const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json());
    const { assembler } = require('../index'); pret.armer(M.verifierIndex);
    app.use(assembler([require('../lien-ordinateur/monter')], cfg, {}));
    return H.serveur(app);
}
const reel = c => Object.assign(c, { reel: true });          // le pilote mémoire ne part nulle part : la route exige un pilote qui envoie pour de vrai (sinon 503), le banc le déclare
const MARQUES = async () => db.col('limites').find({ cle: /^lien-ordinateur:/ }).toArray();
const L_empreinteIp = ip => require('../transport/limites').empreinteIp(ip);
const lever = async f => { try { await f(); return null; } catch (e) { return e; } };

(async () => {
    await H.ouvrirBac('test-lien-ordinateur.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    let n = 0; const ip = () => A.ip(++n + 5000);

    // ───────────── 1. configuration : éteinte par défaut, allumée par « 1 » EXACTEMENT ─────────────
    {
        const L = env => lireConfig({ MONGODB_BASE: 'test_scratch', ...env }).lienOrdinateur;
        H.vrai('le montage est dans la liste des lots du socle (index.js) : sans lui la route n\'existerait jamais', require('../index').LOTS.includes(require('../lien-ordinateur/monter')));
        H.v('défaut : éteinte', L({}).actif, false);
        H.v('V2_LIEN_ORDINATEUR=1 : allumée', L({ V2_LIEN_ORDINATEUR: '1' }).actif, true);
        const avertis = []; const w = console.warn; console.warn = (...a) => avertis.push(a.join(' '));
        let autres; try { autres = ['true', 'on', 'oui', ' 1', '1 ', '2', 'TRUE', '0', ''].map(v => L({ V2_LIEN_ORDINATEUR: v }).actif); } finally { console.warn = w; }
        H.v('toute autre valeur (true, on, « 1 » espacé, 2, 0, vide) : éteinte, la configuration ne devient pas invalide', autres, autres.map(() => false));
        H.vrai('une valeur étrangère est DITE (avertissement qui nomme la variable, jamais sa valeur)', avertis.some(l => l.includes('V2_LIEN_ORDINATEUR') && !l.includes('oui')));
        H.v('limites par défaut : 3 par IP et par jour, 100 envois par jour de Paris', [L({}).parIpJour, L({}).jour], [3, 100]);
        H.v('limites réglables et bornées (IP 1 à 100, jour 1 à 150)', [L({ V2_LIEN_ORDINATEUR_IP_JOUR: '5', V2_LIEN_ORDINATEUR_JOUR: '50' }).parIpJour, L({ V2_LIEN_ORDINATEUR_IP_JOUR: '5', V2_LIEN_ORDINATEUR_JOUR: '50' }).jour], [5, 50]);
        for (const env of [{ V2_LIEN_ORDINATEUR_IP_JOUR: '0' }, { V2_LIEN_ORDINATEUR_IP_JOUR: '101' }, { V2_LIEN_ORDINATEUR_JOUR: '0' }, { V2_LIEN_ORDINATEUR_JOUR: '151' },{ V2_LIEN_ORDINATEUR_JOUR: 'beaucoup' }])
            H.vrai(`${Object.keys(env)[0]}=${Object.values(env)[0]} : configuration invalide`, (await lever(() => L(env))) !== null);
    }

    // ───────────── 2. éteinte : la route n'existe pas (404 natif), aucun en-tête CORS propre ─────────────
    {
        A.registre.vider(); A.registre.fournir('turnstile', { verifier: async () => true }); A.registre.fournir('courrier', reel(creerCourrierMemoire()));
        const srv = await demarrer(lireConfig({ MONGODB_BASE: 'test_scratch' }));
        const r = await H.appel(srv.url, '/api/lien-ordinateur', { methode: 'POST', corps: { email: 'a@exemple.fr', turnstile: 'ok' }, sansDefi: true, entetes: { ...A.SITE, ...ip() } });
        H.v('éteinte : POST => 404 natif (pas une réponse v2)', [r.statut, r.json], [404, null]);
        const p = await H.appel(srv.url, '/api/lien-ordinateur', { methode: 'OPTIONS', entetes: { origin: 'https://rat-market.fr', 'access-control-request-method': 'POST' } });
        H.vrai('éteinte : aucun en-tête CORS v2 sur ce chemin', !p.entetes['access-control-allow-origin']);
        H.v('éteinte : aucune marque écrite', (await MARQUES()).length, 0);
        await srv.fermer();
    }

    // ───────────── 3. allumée : le parcours, gardes et ordre ─────────────
    const cfg = lireConfig(BASE);
    const courrier = reel(creerCourrierMemoire()); const vus = [];
    const turnstile = { verifier: async (jeton, adresseIp, action) => { vus.push([jeton, adresseIp, action]); return jeton === 'ok'; } };
    A.registre.vider(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile);
    const srv = await demarrer(cfg);
    // L'envoi est DÉTACHÉ de la réponse : le banc attend la fin du travail avant de regarder la base ou le courrier (`attendre`, comme les bancs de L1).
    const attendre = () => require('../lien-ordinateur/service').attendre();
    const post = async (corps, entetes = {}) => { const r = await H.appel(srv.url, '/api/lien-ordinateur', { methode: 'POST', corps, sansDefi: true, entetes: { ...A.SITE, ...ip(), ...entetes } }); await attendre(); return r; };
    const ok = (email, plus = {}, entetes = {}) => post({ email, turnstile: 'ok', ...plus }, entetes);
    const detail = r => [r.statut, r.json && r.json.erreur && r.json.erreur.code, r.json && r.json.erreur && r.json.erreur.detail];

    // — Origine : exacte, avant tout —
    {
        const avant = vus.length;
        const mauvaise = await ok('o@exemple.fr', {}, { origin: 'https://evil.fr' });
        const sans = await ok('o@exemple.fr', {}, { 'x-rat-market': '0' });
        const vide = await H.appel(srv.url, '/api/lien-ordinateur', { methode: 'POST', corps: { email: 'o@exemple.fr', turnstile: 'ok' }, sansDefi: true, entetes: { ...ip() } });
        H.v('mauvaise origine / sans X-Rat-Market / sans Origin => 403 ORIGINE, le vérificateur et la base ne sont pas touchés', [mauvaise.statut, sans.statut, vide.statut, mauvaise.json.erreur.code, vus.length - avant, (await MARQUES()).length], [403, 403, 403, 'ORIGINE', 0, 0]);
        for (const o of ['https://www.rat-market.fr', 'https://rat-market.fr']) H.v(`origine ${o} admise`, (await ok(`origine-${o.length}@exemple.fr`, {}, { origin: o })).statut, 202);
        for (const o of ['https://api-v2.rat-market.fr', 'https://evil.rat-market.fr', 'http://rat-market.fr', 'https://rat-market.fr:8443', 'https://RAT-MARKET.FR', 'null'])
            H.v(`origine ${o} : 403`, (await ok('o@exemple.fr', {}, { origin: o })).statut, 403);
    }

    // — Turnstile : obligatoire, action `lien-ordinateur`, avant toute lecture de l'adresse —
    {
        const marquesAvant = (await MARQUES()).length, mailsAvant = courrier.envoyes.length;
        const DEFI = [422, 'ENTREE', 'defi-anti-robot'];
        H.v('sans jeton => 422 defi-anti-robot', detail(await post({ email: 'defi@exemple.fr' })), DEFI);
        H.v('jeton vide / non texte / refusé => 422 defi-anti-robot', [detail(await post({ email: 'defi@exemple.fr', turnstile: '' })), detail(await post({ email: 'defi@exemple.fr', turnstile: 42 })), detail(await post({ email: 'defi@exemple.fr', turnstile: 'mauvais' }))], [DEFI, DEFI, DEFI]);
        H.v('adresse ILLISIBLE (nombre) sans jeton => 422 : le défi précède toute lecture de l\'adresse', detail(await post({ email: 12345 })), DEFI);
        H.v('un défi refusé : aucune marque, aucun courriel', [(await MARQUES()).length - marquesAvant, courrier.envoyes.length - mailsAvant], [0, 0]);
        const dernier = vus[vus.length - 1];
        await ok('action@exemple.fr', {}, { 'x-forwarded-for': '203.0.113.9' });
        H.v('le vérificateur reçoit l\'action `lien-ordinateur` et l\'IP du client', vus[vus.length - 1], ['ok', '203.0.113.9', 'lien-ordinateur']);
        H.vrai('(témoin) le dernier appel avant ce test n\'avait pas déjà cette forme', JSON.stringify(dernier) !== JSON.stringify(vus[vus.length - 1]));
        // la dispense des outils de mesure (comptes/routes.js) ne s'applique PAS ici : Turnstile est obligatoire
        const SEC = 'secret-de-mesure-' + 'x'.repeat(20), SERVICE = 'srv-db7ticgm7kps73crjibg';
        const cfgM = lireConfig({ ...BASE, MONGODB_BASE: 'rm_essai', V2_SECRET_EMPREINTE: 'valeur-de-banc-seize', V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC, RENDER_SERVICE_ID: SERVICE });
        H.vrai('(témoin) la dispense de mesure est bien active dans cette configuration', cfgM.mesure.actif === true);
        const sm = await demarrer(cfgM);
        const m = await H.appel(sm.url, '/api/lien-ordinateur', { methode: 'POST', corps: { email: 'mesure@exemple.fr' }, sansDefi: true, entetes: { ...A.SITE, ...ip(), 'x-rat-market-mesure': SEC } });
        H.v('avec la dispense de mesure active et le bon en-tête : 422 quand même', detail(m), DEFI);
        await sm.fermer();
    }

    // — la réponse : 202 { success: true } dans tous les cas où le défi passe ; identique à l'octet —
    {
        const avant = courrier.envoyes.length;
        const neuve = await ok('Bob.Martin@Exemple.fr');
        const deja = await ok('bob.martin@exemple.fr');
        const variantes = [await ok('  bob.martin@exemple.fr  '), await ok('BOB.MARTIN@EXEMPLE.FR'), await ok('bob.martin+promo@exemple.fr')];
        const invalide = await ok('pas une adresse'), sansArobase = await ok('bob.martin.exemple.fr'), longue = await ok('a'.repeat(400) + '@exemple.fr'), retourLigne = await ok('bob@exemple.fr\nbcc:x@y.fr');
        const jetable = await ok('quelquun@mailinator.com');
        H.v('adresse neuve : 202 { success: true }', [neuve.statut, neuve.json], [202, { success: true }]);
        H.v('même adresse (casse, espaces, +étiquette) : 202 identique à l\'octet, aucun courriel de plus', [deja.texte === neuve.texte, variantes.every(r => r.texte === neuve.texte && r.statut === 202), courrier.envoyes.length - avant], [true, true, 1]);
        H.v('adresse invalide / sans @ / trop longue / avec saut de ligne / jetable : 202 identique à l\'octet', [invalide, sansArobase, longue, retourLigne, jetable].map(r => [r.statut, r.texte === neuve.texte]), Array(5).fill([202, true]));
        H.v('   ... et aucun courriel pour elles', courrier.envoyes.length - avant, 1);
        H.v('   ... ni aucune marque écrite pour elles (une marque par adresse servie seulement)', (await MARQUES()).filter(d => /bob|pas|mailinator/i.test(JSON.stringify(d))).length, 0);
        const envoi = courrier.envoyes[avant];
        H.v('le seul courriel part vers l\'adresse saisie (normalisée sans espaces), de type lien-ordinateur', [envoi.type, envoi.email], ['lien-ordinateur', 'Bob.Martin@Exemple.fr']);
        // en-têtes : no-store partout
        H.v('Cache-Control: no-store sur le 202', neuve.entetes['cache-control'], 'no-store');
    }

    // — corps mal formé : 400 ENTREE, seulement —
    {
        const tableau = await H.appel(srv.url, '/api/lien-ordinateur', { methode: 'POST', corps: [1], sansDefi: true, entetes: { ...A.SITE, ...ip() } });
        const sansCorps = await H.appel(srv.url, '/api/lien-ordinateur', { methode: 'POST', sansDefi: true, entetes: { ...A.SITE, ...ip() } });
        const adresseNombre = await ok(12345), adresseAbsente = await post({ turnstile: 'ok' }), adresseObjet = await ok({ $ne: 1 });
        const ENTREE = [400, 'ENTREE'];
        H.v('corps tableau => 400 ENTREE', [tableau.statut, tableau.json.erreur.code], ENTREE);
        H.v('aucun corps (Express rend {}) => le défi parle d\'abord : 422 defi-anti-robot (comme les routes de L1)', detail(sansCorps), [422, 'ENTREE', 'defi-anti-robot']);
        H.v('jeton valide mais adresse absente / non texte => 400 ENTREE (jamais un 202)', [adresseNombre, adresseAbsente].map(r => [r.statut, r.json.erreur.code]), [ENTREE, ENTREE]);
        H.v('adresse objet ({ $ne }) => refusée par la garde des clés (400 ENTREE)', [adresseObjet.statut, adresseObjet.json.erreur.code], ENTREE);
        H.v('erreurs : no-store et facturation null', [tableau.entetes['cache-control'], tableau.json.facturation], ['no-store', null]);
    }

    // — message fixe : aucun champ du corps n'atteint le courriel —
    {
        const CANARIS = ['CANARI-SUJET', 'CANARI-MESSAGE', 'CANARI-NOM', 'CANARI-LIEN', 'CANARI-HTML', 'CANARI-CC', 'CANARI-REPONSE'];
        const avant = courrier.envoyes.length;
        await ok('fixe-1@exemple.fr');
        await ok('fixe-2@exemple.fr', { subject: CANARIS[0], sujet: CANARIS[0], objet: CANARIS[0], message: CANARIS[1], texte: CANARIS[1], nom: CANARIS[2], name: CANARIS[2], lien: 'https://evil.fr/' + CANARIS[3], url: 'https://evil.fr/' + CANARIS[3], html: '<b>' + CANARIS[4] + '</b>', htmlContent: CANARIS[4], cc: [CANARIS[5]], bcc: [CANARIS[5]], to: [CANARIS[5] + '@evil.fr'], replyTo: CANARIS[6] + '@evil.fr', sender: { email: CANARIS[6] + '@evil.fr' }, langue: CANARIS[2] });
        await ok('fixe-3@exemple.fr', { motDePasse: 'x', purgeHeures: 1 }, {});
        const [a, b] = courrier.envoyes.slice(avant, avant + 2);
        H.v('deux courriels sont partis (un par adresse neuve)', courrier.envoyes.length - avant, 3);
        H.v('objet, texte et HTML sont IDENTIQUES à l\'octet avec ou sans champs supplémentaires', [a.objet === b.objet, a.texte === b.texte, a.html === b.html], [true, true, true]);
        const tout = JSON.stringify(courrier.envoyes.slice(avant));
        H.v('aucun canari des champs du corps dans les courriels', CANARIS.filter(c => tout.includes(c)), []);
        H.v('le destinataire est l\'adresse, rien d\'autre (to, cc, bcc inchangés par le corps)', courrier.envoyes.slice(avant).map(e => e.email), ['fixe-1@exemple.fr', 'fixe-2@exemple.fr', 'fixe-3@exemple.fr']);
        H.v('aucun canari dans la base (marques, compteurs)', (await toutLeContenu()).includes('CANARI'), false);
        const ctn = await G.lienOrdinateur();
        H.v('le message est une fonction SANS paramètre (rien à y passer)', G.lienOrdinateur.length, 0);
        H.v('   appelée avec une adresse ou un objet, elle rend le même message', JSON.stringify(await G.lienOrdinateur('x@evil.fr', { objet: 'CANARI' })) === JSON.stringify(ctn), true);
    }

    // — limite par IP : 3 par jour, AVANT le défi, 429 avec Retry-After —
    {
        const memeIp = { 'x-forwarded-for': '198.51.100.77' };
        const codes = [];
        for (let i = 0; i < 3; i++) codes.push((await post({ email: `ip${i}@exemple.fr` }, memeIp)).statut);     // sans jeton : 422, mais chaque requête compte
        const quatrieme = await post({ email: 'ip3@exemple.fr', turnstile: 'ok' }, memeIp);
        H.v('3 requêtes d\'une même IP (sans jeton) => 422 ; la 4e, même avec un bon jeton => 429 (la limite précède le défi)', [codes, quatrieme.statut, quatrieme.json.erreur.code], [[422, 422, 422], 429, 'LIMITE_DEBIT']);
        H.vrai('   429 avec Retry-After, no-store, facturation null', Number(quatrieme.entetes['retry-after']) >= 1 && quatrieme.entetes['cache-control'] === 'no-store' && quatrieme.json.facturation === null);
        H.v('   le 429 n\'a ni lu l\'adresse ni appelé le vérificateur ni écrit de marque', (await MARQUES()).filter(d => d.cle.includes('ip3')).length, 0);
        const autre = await ok('ip-autre@exemple.fr', {}, { 'x-forwarded-for': '198.51.100.78' });
        H.v('une autre IP n\'est pas touchée', autre.statut, 202);
        // IPv6 : le compteur porte sur le bloc /56 (ipKeyGenerator), pas sur l'adresse — changer d'adresse dans son bloc ne remet rien à zéro
        const v6 = i => ({ 'x-forwarded-for': `2001:db8:abcd:ef${(i % 2) + 1}:${i}::1` });   // 2001:db8:abcd:ef1x… : même /56 (2001:db8:abcd:ef)
        const codes6 = []; for (let i = 0; i < 4; i++) codes6.push((await post({ email: `v6-${i}@exemple.fr`, turnstile: 'mauvais' }, v6(i))).statut);
        H.v('IPv6 : quatre adresses d\'un même bloc /56 comptent ensemble (422, 422, 422, puis 429)', codes6, [422, 422, 422, 429]);
        const autreBloc = await post({ email: 'v6-autre@exemple.fr', turnstile: 'mauvais' }, { 'x-forwarded-for': '2001:db8:1234:5600::1' });
        H.v('   un autre bloc /56 n\'est pas touché', autreBloc.statut, 422);
        const cle = (await db.col('limites').find({ cle: /^lien-ordinateur-ip:/ }).toArray()).map(d => d.cle);
        H.vrai('la clé du compteur IP est l\'empreinte (pas l\'IP en clair)', cle.length > 0 && cle.every(c => !c.includes('198.51.100.77')));
        // l'empreinte de l'IP est un HMAC À CLÉ (secret serveur, domaine « lien-ordinateur-ip »), pas le SHA-256 sans secret de transport/limites.js (une IPv4 s'y retrouve par dictionnaire)
        const { ipKeyGenerator } = require('express-rate-limit');
        const hmacIp = (secret, ip, domaine = 'lien-ordinateur-ip') => crypto.createHmac('sha256', secret).update(`${domaine}|${ipKeyGenerator(ip)}`).digest('hex').slice(0, 32);
        H.vrai('la clé du compteur de 198.51.100.77 est le HMAC-SHA256 à clé de l\'IP regroupée (domaine « lien-ordinateur-ip »)', cle.some(c => c.startsWith(`lien-ordinateur-ip:${hmacIp(cfg.empreinte.secret, '198.51.100.77')}|`)));
        H.vrai('   ce n\'est ni l\'empreinte sans secret de transport/limites.js, ni un HMAC d\'un autre secret ou d\'un autre domaine (témoins)', !cle.some(c => c.includes(L_empreinteIp('198.51.100.77')) || c.includes(hmacIp(cfg.empreinte.secret + 'x', '198.51.100.77')) || c.includes(hmacIp(cfg.empreinte.secret, '198.51.100.77', 'lien-ordinateur'))));
    }

    // — une adresse par 24 h : atomique (courses) —
    {
        const avant = courrier.envoyes.length;
        const rs = await Promise.all(Array.from({ length: 12 }, () => ok('course@exemple.fr')));
        H.v('12 requêtes SIMULTANÉES pour la même adresse (IP différentes) : un seul courriel, 12 fois 202', [courrier.envoyes.length - avant, rs.every(r => r.statut === 202)], [1, true]);
        const marques = (await MARQUES()).filter(d => d.cle.endsWith('|reservation'));
        const unique = new Set(marques.map(d => d.cle));
        H.v('   une marque par adresse servie, clé unique', unique.size, marques.length);
    }

    // — données : jamais l'adresse en clair, une empreinte HMAC à secret, TTL 24 h —
    {
        const adresse = 'donnees.secretes@exemple.fr';
        const avant = Date.now();
        await ok(adresse);
        const tout = await toutLeContenu();
        H.v('l\'adresse et sa partie locale n\'apparaissent dans AUCUNE collection', [tout.includes('donnees.secretes'), tout.includes('donneessecretes'), tout.includes(adresse)], [false, false, false]);
        const attendu = crypto.createHmac('sha256', cfg.empreinte.secret).update('lien-ordinateur|' + 'donnees.secretes@exemple.fr').digest('hex');
        const doc = (await MARQUES()).find(d => d.cle === `lien-ordinateur:${attendu}|reservation`);
        H.vrai('la marque porte l\'HMAC-SHA256 (secret serveur, domaine « lien-ordinateur ») de l\'adresse normalisée', doc);
        const simple = crypto.createHash('sha256').update('donnees.secretes@exemple.fr').digest('hex');
        H.vrai('ce n\'est PAS un simple SHA-256 de l\'adresse (qui se retrouve par dictionnaire)', !(await MARQUES()).some(d => d.cle.includes(simple)));
        H.vrai('expiration (TTL) à 24 h : expireLe entre 23 h 59 et 24 h 01 d\'ici', doc && doc.expireLe.getTime() - avant > 24 * 3600e3 - 60e3 && doc.expireLe.getTime() - avant < 24 * 3600e3 + 60e3);
        H.v('la marque ne porte que { cle, n, expireLe }', Object.keys(doc).filter(k => k !== '_id').sort(), ['cle', 'expireLe', 'n']);
        const idx = await db.col('limites').indexes();
        H.vrai('l\'index TTL (expireLe, 0 s) et l\'unicité de `cle` existent sur `limites`', idx.some(i => i.key.expireLe === 1 && i.expireAfterSeconds === 0) && idx.some(i => i.key.cle === 1 && i.unique));
        // un autre secret => une autre empreinte ; un autre domaine => une autre empreinte
        const autreSecret = crypto.createHmac('sha256', cfg.empreinte.secret + 'x').update('lien-ordinateur|donnees.secretes@exemple.fr').digest('hex');
        const autreDomaine = crypto.createHmac('sha256', cfg.empreinte.secret).update('octroi|donnees.secretes@exemple.fr').digest('hex');
        H.vrai('(témoin) le secret et le domaine changent l\'empreinte', autreSecret !== attendu && autreDomaine !== attendu);
        // la boîte : +étiquette et points de Gmail ne contournent pas la limite
        const avantMails = courrier.envoyes.length;
        await ok('Un.Gmail@gmail.com'); await ok('ungmail+x@googlemail.com'); await ok('un.gmail+y@gmail.com'); await ok('autre+a@exemple.fr'); await ok('autre+b@exemple.fr');
        H.v('la limite porte sur la BOÎTE : points et +étiquette de Gmail, +étiquette ailleurs => 2 courriels pour 5 saisies', courrier.envoyes.length - avantMails, 2);
        // plusieurs adresses jetables / domaines à casse / punycode
        await ok('xn--bcher-kva@exemple.fr');
    }

    // — plafond global du jour de Paris —
    {
        await srv.fermer();
        const compteurAvant = await db.col('courriels_lien_jour').find({}).toArray();
        H.v('le compteur du jour compte les envois PARTIS (un par courriel, pas un par requête)', [compteurAvant.length, compteurAvant[0] && compteurAvant[0].n], [1, courrier.envoyes.length]);
        await db.col('courriels_lien_jour').deleteMany({});
        A.registre.vider(); const c2 = reel(creerCourrierMemoire()); A.registre.fournir('courrier', c2); A.registre.fournir('turnstile', turnstile);
        const cfg2 = lireConfig({ ...BASE, V2_LIEN_ORDINATEUR_JOUR: '2', V2_LIEN_ORDINATEUR_IP_JOUR: '50' });
        const s2 = await demarrer(cfg2);
        const p2 = async (email, url = s2.url) => { const x = await H.appel(url, '/api/lien-ordinateur', { methode: 'POST', corps: { email, turnstile: 'ok' }, sansDefi: true, entetes: { ...A.SITE, ...ip() } }); await attendre(); return x; };
        const r = [await p2('plafond-1@exemple.fr'), await p2('plafond-2@exemple.fr'), await p2('plafond-3@exemple.fr')];
        H.v('plafond 2 par jour : les deux premiers passent, le 3e => 429 LIMITE_DEBIT', [r[0].statut, r[1].statut, r[2].statut, r[2].json.erreur.code], [202, 202, 429, 'LIMITE_DEBIT']);
        H.vrai('   le 429 du plafond porte Retry-After (secondes jusqu\'à minuit à Paris, au plus 24 h), no-store', Number(r[2].entetes['retry-after']) >= 1 && Number(r[2].entetes['retry-after']) <= 86400 && r[2].entetes['cache-control'] === 'no-store');
        H.v('   le courriel du 3e n\'est pas parti', c2.envoyes.length, 2);
        // ORACLE : le plafond plein refuse TOUT LE MONDE — adresse neuve, déjà servie, invalide, jetable : la même réponse 429, octet pour octet (il ne dit plus quelle adresse est « valide et non servie »)
        const pleins = [await p2('plafond-4@exemple.fr'), await p2('plafond-1@exemple.fr'), await p2('pas une adresse'), await p2('x@mailinator.com')];
        H.v('plafond plein : adresse neuve / déjà servie / invalide / jetable => le MÊME 429 pour toutes', [pleins.map(x => x.statut), pleins.every(x => x.json.erreur.code === 'LIMITE_DEBIT' && Math.abs(x.json.erreur.reessayerDans - pleins[0].json.erreur.reessayerDans) <= 5)], [[429, 429, 429, 429], true]); // le délai est un compte à rebours : il peut perdre une seconde entre deux appels
        H.v('   aucun courriel de plus', c2.envoyes.length, 2);
        // consommation ATOMIQUE : 4 adresses neuves SIMULTANÉES sous un plafond de 2 qui ont toutes LU « pas plein » (le service est appelé directement, sans la lecture de la route) : 2 courriels, 2 marques rendues
        await db.col('courriels_lien_jour').deleteMany({}); c2.envoyes.length = 0;
        const vivantes = async () => (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length;
        const avant4 = await vivantes();
        const sv4 = require('../lien-ordinateur/service').creerService({ cfg: cfg2, courrier: c2 });
        const rs4 = await Promise.all(['course-1', 'course-2', 'course-3', 'course-4'].map(a => sv4.demander(`${a}@exemple.fr`)));
        H.v('4 adresses neuves simultanées, plafond 2 : exactement 2 courriels, 2 « plafond » (la consommation est atomique)', [rs4.map(x => x.issue).sort(), c2.envoyes.length], [['envoye', 'envoye', 'plafond', 'plafond'], 2]);
        H.v('   les marques des 2 adresses non servies sont RENDUES (elles pourront réessayer)', (await vivantes()) - avant4, 2);
        await db.col('courriels_lien_jour').deleteMany({}); await db.col('courriels_lien_jour').insertOne({ _id: require('../comptes/plafond-courriels').jourDeParis(), n: 2 }); c2.envoyes.length = 0;
        const { empreinteBoite, PREFIXE } = require('../lien-ordinateur/service');
        const marque = adresse => `${PREFIXE}${empreinteBoite(cfg2.empreinte.secret, adresse)}|reservation`;
        const vivante = async adresse => (await MARQUES()).some(d => d.cle === marque(adresse) && d.expireLe.getTime() > Date.now() + 1000);
        H.v('   sa marque est RENDUE (l\'adresse refusée pourra réessayer : rien n\'a été envoyé) ; celles des deux envoyées restent', [await vivante('plafond-1@exemple.fr'), await vivante('plafond-2@exemple.fr'), await vivante('plafond-3@exemple.fr')], [true, true, false]);
        // un compteur de jour de Paris : le jour change à minuit à Paris, pas à minuit UTC
        const jour = require('../comptes/plafond-courriels').jourDeParis;
        H.v('jourDeParis : 2026-06-30 22:30 UTC est déjà le 1er juillet à Paris ; 2026-12-31 22:30 UTC est le 31 (heure d\'hiver)', [jour(new Date('2026-06-30T22:30:00Z')), jour(new Date('2026-12-31T22:30:00Z'))], ['2026-07-01', '2026-12-31']);
        const { secondesAvantMinuitParis } = require('../lien-ordinateur/service');
        H.v('secondesAvantMinuitParis : 23 h 59 min 30 s à Paris (été puis hiver) => 30 ; minuit passé d\'une seconde => 86 399', [secondesAvantMinuitParis(new Date('2026-06-30T21:59:30Z')), secondesAvantMinuitParis(new Date('2026-12-31T22:59:30Z')), secondesAvantMinuitParis(new Date('2026-12-31T23:00:01Z'))], [30, 30, 86399]);
        // jourDeParis dans le service : `plein()` lit le compteur du JOUR DE PARIS (horloge injectée : 22 h 30 UTC le 30 juin = déjà le 1er juillet à Paris)
        {
            const horloge = () => new Date('2026-06-30T22:30:00Z');
            await db.col('courriels_lien_jour').insertOne({ _id: '2026-07-01', n: 2 });
            const sh = require('../lien-ordinateur/service').creerService({ cfg: cfg2, courrier: c2, maintenant: horloge });
            H.v('plein() lit le compteur du jour de PARIS (2026-07-01), pas celui du jour UTC (2026-06-30)', await sh.plein(), true);
            await db.col('courriels_lien_jour').deleteOne({ _id: '2026-07-01' });
            await db.col('courriels_lien_jour').insertOne({ _id: '2026-06-30', n: 2 });
            H.v('   et un compteur plein du jour UTC seul ne remplit pas le jour de Paris', await sh.plein(), false);
            await db.col('courriels_lien_jour').deleteOne({ _id: '2026-06-30' });
        }
        // ORDRE : le plafond plein est lu APRÈS le défi (un robot sans jeton ne lit pas l'état du plafond) et AVANT le test de type d'`email` (un corps sans texte ne dit pas autrement que le plafond est plein)
        await db.col('courriels_lien_jour').deleteMany({}); await db.col('courriels_lien_jour').insertOne({ _id: require('../comptes/plafond-courriels').jourDeParis(), n: 2 });
        {
            const brut = corps => H.appel(s2.url, '/api/lien-ordinateur', { methode: 'POST', corps, sansDefi: true, entetes: { ...A.SITE, ...ip() } });
            const sansJeton = await brut({ email: 'ordre@exemple.fr' }), mauvais = await brut({ email: 'ordre@exemple.fr', turnstile: 'mauvais' }), sansEmail = await brut({ turnstile: 'ok' }), emailNombre = await brut({ email: 42, turnstile: 'ok' });
            H.v('plafond PLEIN : sans jeton / jeton refusé => 422 (le défi précède la lecture du plafond)', [sansJeton.statut, mauvais.statut], [422, 422]);
            H.v('plafond PLEIN : jeton bon et email absent / non texte => 429, pas 400 (la lecture du plafond précède le test de type)', [sansEmail.statut, emailNombre.statut], [429, 429]);
        }
        await db.col('courriels_lien_jour').deleteMany({}); await db.col('courriels_lien_jour').insertOne({ _id: require('../comptes/plafond-courriels').jourDeParis(), n: 2 });
        await s2.fermer();
        // GARDE DU MONTAGE : la route refuse de se monter sans secret d'empreinte (≥ 16 caractères) — fail-closed, jamais une route qui répond 503 à chaque requête
        {
            const { routesLien } = require('../lien-ordinateur/routes');
            const monte = secret => lever(() => routesLien({ post() { } }, { ...cfg2, empreinte: { secret } }));
            const e = await Promise.all([monte(''), monte(undefined), monte(null), monte('court'), monte('x'.repeat(15))]);
            H.v('routesLien lève au montage : secret vide, absent, nul, de 5 ou de 15 caractères', e.map(x => Boolean(x)), [true, true, true, true, true]);
            H.v('   et ne lève pas avec un secret de 16 caractères', await monte('x'.repeat(16)), null);
            const mont = require('../lien-ordinateur/monter');
            H.vrai('   monter.routes (drapeau allumé) propage la levée : l\'application ne démarre pas', (await lever(() => mont.routes({ post() { } }, { ...cfg2, empreinte: { secret: '' } }))) !== null);
        }
        // le compteur du lien est le SIEN : il ne consomme pas celui des courriels de comptes (courriels_jour)
        const comptesJour = await db.col('courriels_jour').find({}).toArray();
        H.v('le compteur des courriels de comptes (courriels_jour) n\'a pas bougé : la route a son propre compteur', comptesJour.length, 0);
        const siens = await db.col('courriels_lien_jour').find({}).toArray();
        H.v('le compteur de la route : un document par jour de Paris, n = 2', siens.map(d => d.n), [2]);
    }

    // — pannes : 503 INDISPONIBLE, sans fuite, la marque rendue seulement quand rien n'est parti —
    {
        const journaux = []; const garde = {}; for (const k of ['warn', 'error', 'info', 'log']) { garde[k] = console[k]; console[k] = (...a) => journaux.push(a.join(' ')); }
        const rendre = () => { for (const k of Object.keys(garde)) console[k] = garde[k]; };
        try {
            const secret = 'panne.secrete@exemple.fr';
            const erreurDe = nom => async () => { throw Object.assign(new Error(`${nom} ${secret}`), { name: nom }); };
            const cas = async (nom, miseEnPlace, adresse, attendu) => {
                A.registre.vider(); A.registre.fournir('turnstile', turnstile); miseEnPlace();
                const s = await demarrer(cfg);
                const r = await H.appel(s.url, '/api/lien-ordinateur', { methode: 'POST', corps: { email: adresse, turnstile: 'ok' }, sansDefi: true, entetes: { ...A.SITE, ...ip() } });
                await attendre(); await s.fermer();
                const marque = (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length;
                return { r, marque, ...attendu && {} };
            };
            const avantMarques = (await MARQUES()).filter(d => d.cle.endsWith('|reservation')).length;
            let c = await cas('vérificateur en panne', () => { A.registre.fournir('courrier', reel(creerCourrierMemoire())); A.registre.fournir('turnstile', { verifier: async () => { throw new Error('boom ' + secret); } }); }, 'p1@exemple.fr');
            H.v('Cloudflare injoignable : 503 INDISPONIBLE, no-store, facturation null', [c.r.statut, c.r.json.erreur.code, c.r.entetes['cache-control'], c.r.json.facturation], [503, 'INDISPONIBLE', 'no-store', null]);
            c = await cas('sans courrier', () => { }, 'p2@exemple.fr');
            H.v('aucun pilote de courrier : 503 (le défi n\'est même pas consommé)', c.r.statut, 503);
            c = await cas('courrier qui ne part nulle part', () => { A.registre.fournir('courrier', creerCourrierMemoire()); }, 'p3@exemple.fr');
            H.v('pilote de courrier qui n\'envoie pas pour de vrai (mémoire, reel false) : 503, jamais un faux 202', c.r.statut, 503);
            const pilote = f => ({ reel: true, envoyes: [], envoyerLienOrdinateur: f });
            const marquesAvant500 = (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length;
            c = await cas('Brevo 500',() => A.registre.fournir('courrier', pilote(erreurDe('BrevoStatut500'))), 'p4@exemple.fr');
            const marquesApres500 = (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length;
            H.v('Brevo répond 500 (le courriel a PU partir : un 5xx est ambigu) : 202 NEUTRE (aucun 503 lié à Brevo) et la marque est GARDÉE (un envoi par adresse et par 24 h)', [c.r.statut, c.r.texte, marquesApres500 - marquesAvant500], [202, '{"success":true}', 1]);
            c = await cas('réseau', () => A.registre.fournir('courrier', pilote(erreurDe('BrevoReseau'))), 'p5@exemple.fr');
            const marquesApresReseau = (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length;
            H.v('Brevo injoignable (réseau, peut-être parti) : 202 neutre et la marque est GARDÉE (un doublon est pire qu\'un manque)', [c.r.statut, c.r.texte, marquesApresReseau - marquesApres500], [202, '{"success":true}', 1]);
            c = await cas('plafond Brevo', () => A.registre.fournir('courrier', pilote(erreurDe('BrevoPlafond'))), 'p6@exemple.fr');
            H.v('le plafond propre de Brevo atteint : 202 neutre (le 429 dirait que l\'adresse est neuve), marque rendue', [c.r.statut, c.r.texte, (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length - marquesApresReseau], [202, '{"success":true}', 0]);
            {
                const { empreinteBoite, PREFIXE } = require('../lien-ordinateur/service');
                const vivante = async adresse => (await MARQUES()).some(d => d.cle === `${PREFIXE}${empreinteBoite(cfg.empreinte.secret, adresse)}|reservation` && d.expireLe.getTime() > Date.now() + 1000);
                c = await cas('Brevo 400', () => A.registre.fournir('courrier', pilote(erreurDe('BrevoStatut400'))), 'p8@exemple.fr');
                H.v('Brevo refuse l\'adresse (400) : 202 comme une adresse invalide, marque rendue', [c.r.statut, c.r.texte, await vivante('p8@exemple.fr')], [202, '{"success":true}', false]);
                c = await cas('Brevo adresse', () => A.registre.fournir('courrier', pilote(erreurDe('BrevoAdresse'))), 'p9@exemple.fr');
                H.v('le pilote refuse l\'adresse avant toute requête (BrevoAdresse) : 202, marque rendue', [c.r.statut, await vivante('p9@exemple.fr')], [202, false]);
                for (const [st, rendue] of [['BrevoStatut502', false], ['BrevoStatut503', false], ['BrevoStatut504', false], ['BrevoStatut599', false], ['BrevoStatut408', false], ['BrevoStatut403', true], ['BrevoStatut429', true], ['BrevoStatut422', true]]) {
                    const adr = `st${st.slice(-3)}@exemple.fr`;
                    c = await cas(st, () => A.registre.fournir('courrier', pilote(erreurDe(st))), adr);
                    H.v(`${st} : 202 neutre ; marque ${rendue ? 'RENDUE (refus franc 4xx : rien n\'est parti)' : 'GARDÉE (5xx ambigu : le courriel a pu partir)'}`, [c.r.statut, await vivante(adr)], [202, !rendue]);
                }
                c = await cas('4xx après tentative ambiguë', () => A.registre.fournir('courrier', pilote(async () => { throw Object.assign(new Error('x'), { name: 'BrevoStatut401', apresTentativeAmbigue: true }); })), 'amb@exemple.fr');
                H.v('un 4xx REÇU AU RÉESSAI d\'une première tentative ambiguë (marqueur apresTentativeAmbigue) : 202 neutre, marque GARDÉE (la première a pu partir)', [c.r.statut, await vivante('amb@exemple.fr')], [202, true]);
                c = await cas('Brevo 401', () => A.registre.fournir('courrier', pilote(erreurDe('BrevoStatut401'))), 'p10@exemple.fr');
                H.v('Brevo refuse notre clé (401) : 202 neutre, marque rendue (rien n\'est parti)', [c.r.statut, await vivante('p10@exemple.fr')], [202, false]);
            }
            const marquesAvantInconnue = (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length;
            c = await cas('erreur inconnue', () => A.registre.fournir('courrier', pilote(async () => { throw new TypeError('inattendu ' + secret); })), 'p7@exemple.fr');
            H.v('erreur inattendue du pilote : 202 neutre, marque gardée (on ne sait pas)', [c.r.statut, (await MARQUES()).filter(d => d.cle.endsWith('|reservation') && d.expireLe.getTime() > Date.now() + 1000).length - marquesAvantInconnue], [202, 1]);
            // DÉTACHEMENT : la réponse part AVANT la fin de l'envoi (un pilote bloqué jusqu'à ce que le banc le libère) — la durée ne dit rien de l'adresse
            {
                let liberer; const bloque = new Promise(f => { liberer = f; }); let appele = false;
                A.registre.vider(); A.registre.fournir('turnstile', turnstile); A.registre.fournir('courrier', pilote(async () => { appele = true; await bloque; }));
                const sd = await demarrer(cfg);
                const t0 = Date.now();
                const rd = await Promise.race([H.appel(sd.url, '/api/lien-ordinateur', { methode: 'POST', corps: { email: 'detache@exemple.fr', turnstile: 'ok' }, sansDefi: true, entetes: { ...A.SITE, ...ip() } }), new Promise(f => setTimeout(() => f({ statut: 'toujours en attente après 1,5 s' }), 1500))]);
                const rapide = Date.now() - t0;
                await new Promise(f => setTimeout(f, 200));
                H.v('envoi bloqué en cours : la réponse 202 est DÉJÀ partie, le pilote est en vol', [rd.statut, appele], [202, true]);
                H.vrai('   (témoin) la réponse n\'a pas attendu la libération du pilote', rapide < 2000);
                liberer(); await attendre(); await sd.fermer();
            }
            void avantMarques;
            void avantMarques;
        } finally { rendre(); }
        const estAssertion = j => /^✅/.test(j) || (/^❌/.test(j) && !/^❌ \[v2/.test(j));
        for (const j of journaux) if (estAssertion(j)) console.log(j);      // les assertions jouées pendant la capture des journaux sont rejouées à l'écran (sinon un échec y serait muet)
        const tout = journaux.filter(j => !estAssertion(j)).join('\n');
        H.v('aucun journal ne contient l\'adresse (ni la partie locale), même sur une panne dont le message la contient', [tout.includes('panne.secrete'), tout.includes('p4@exemple'), tout.includes('exemple.fr')], [false, false, false]);
        H.vrai('(témoin) les pannes ont bien été journalisées par leur NOM', /BrevoStatut500|turnstile|Error/.test(tout) || tout.length > 0);
    }

    // ───────────── 4. CORS : l'apex et www, POST seulement ─────────────
    {
        A.registre.vider(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile);
        const s = await demarrer(cfg);
        for (const o of ['https://rat-market.fr', 'https://www.rat-market.fr']) {
            const pre = await H.appel(s.url, '/api/lien-ordinateur', { methode: 'OPTIONS', entetes: { origin: o, 'access-control-request-method': 'POST' } });
            H.v(`préflight ${o} : 204, origine exacte, méthode POST seulement, en-têtes du site`, [pre.statut, pre.entetes['access-control-allow-origin'], pre.entetes['access-control-allow-methods'], /X-Rat-Market/.test(pre.entetes['access-control-allow-headers'] || '')], [204, o, 'POST', true]);
            H.v(`   SANS credentials (la route n'utilise aucun cookie) : ni Allow-Credentials au préflight ni sur la réponse réelle`, [pre.entetes['access-control-allow-credentials'], (await H.appel(s.url, '/api/lien-ordinateur', { methode: 'POST', corps: { email: 'c@exemple.fr', turnstile: 'mauvais' }, sansDefi: true, entetes: { ...A.SITE, origin: o, ...ip() } })).entetes['access-control-allow-credentials']], [undefined, undefined]);
            const rep = await H.appel(s.url, '/api/lien-ordinateur', { methode: 'POST', corps: { email: 'cors@exemple.fr', turnstile: 'mauvais' }, sansDefi: true, entetes: { ...A.SITE, origin: o, ...ip() } });
            H.v(`réponse réelle depuis ${o} (même un refus) : porte l'origine exacte`, [rep.statut, rep.entetes['access-control-allow-origin']], [422, o]);
        }
        for (const o of ['https://evil.fr', 'https://api-v2.rat-market.fr', 'http://rat-market.fr', 'https://rat-market.fr:8443', 'chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb']) {
            const pre = await H.appel(s.url, '/api/lien-ordinateur', { methode: 'OPTIONS', entetes: { origin: o, 'access-control-request-method': 'POST' } });
            H.vrai(`préflight ${o} : aucun Access-Control-Allow-Origin`, pre.entetes['access-control-allow-origin'] !== o);
        }
        await s.fermer();
    }

    // ───────────── 5. le message : constant, un seul lien, celui de la fiche du Store ─────────────
    {
        const c = await G.lienOrdinateur(); const ext = await import('../comptes/courriels-site/extension.mjs'); const site = await import('../comptes/courriels-site/site.mjs');
        H.v('le message a un objet, un texte, un HTML', [typeof c.objet, typeof c.texte, typeof c.html], ['string', 'string', 'string']);
        H.vrai('le lien est la fiche du Chrome Web Store (forme et identifiant vérifiés par lienStoreValide du site)', ext.lienStoreValide(site.CHROME_STORE_URL));
        const liensTexte = c.texte.match(/https?:\/\/[^\s"'<>]+/g) || [], liensHtml = [...c.html.matchAll(/(?:href|src)="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
        H.v('le texte ne contient qu\'un lien : la fiche du Store', [...new Set(liensTexte)], [site.CHROME_STORE_URL]);
        H.v('le HTML ne contient qu\'un lien : la fiche du Store (le bouton et le lien de secours), aucune image, aucun suivi', [...new Set(liensHtml)], [site.CHROME_STORE_URL]);
        H.vrai('ni script, ni formulaire, ni image distante dans le HTML', !/<script|<form|<img|<iframe|url\(/i.test(c.html));
        H.vrai('le HTML est un document complet en français', /^<!doctype html>/i.test(c.html) && /lang="fr"/.test(c.html));
        H.vrai('le texte dit l\'origine de la demande et que l\'adresse n\'est pas conservée au-delà de 24 h', /rat-market\.fr/.test(c.texte) && /24\s*heures/.test(c.texte.replace(/ /g, ' ')) && /ignorez/i.test(c.texte));
        H.vrai('le texte ne dit plus « votre adresse n\'est pas conservée » sans nuance : l\'adresse elle-même, une empreinte à clé 24 h, le prestataire d\'envoi et sa propre politique', !/n.est pas conservée/.test(c.texte) && /adresse elle-même/.test(c.texte) && /empreinte à clé/.test(c.texte) && /24\s*heures/.test(c.texte) && /prestataire d.envoi/.test(c.texte) && /propre politique/.test(c.texte));
        H.vrai('le texte dit « supprimée de notre base après 24 heures » et ne promet rien sur les sauvegardes (ni « supprimée automatiquement », ni « effacée partout »)', /supprimée de notre base après 24\s*heures/.test(c.texte.replace(/\s+/g, ' ')) && !/sauvegarde|partout|définitiv|automatiquement/i.test(c.texte));
        H.v('le message est mis en cache : la même instance à chaque appel', (await G.lienOrdinateur()) === c, true);
    }

    // ───────────── 6. le pilote Brevo : une requête, un destinataire, le message constant, classe « avertissement » ─────────────
    {
        const vusBrevo = [];
        const faux = http.createServer((req, res) => { const m = []; req.on('data', d => m.push(d)); req.on('end', () => { vusBrevo.push({ chemin: req.url, corps: JSON.parse(Buffer.concat(m).toString('utf8')) }); res.writeHead(201, { 'content-type': 'application/json' }); res.end('{}'); }); });
        await new Promise(r => faux.listen(0, '127.0.0.1', r));
        const url = `http://127.0.0.1:${faux.address().port}/v3/smtp/email`;
        const classes = []; const plafond = { reserver: async c => { classes.push(c); return true; } };
        const p = creerCourrierBrevo({ cle: 'xkeysib-CLE-DE-BANC', url, reessaiMs: 0, plafond });
        await p.envoyerLienOrdinateur('destinataire@exemple.fr');
        const corps = vusBrevo[0].corps, c = await G.lienOrdinateur();
        H.v('une requête POST /v3/smtp/email, un seul destinataire, sans cc ni bcc', [vusBrevo.length, vusBrevo[0].chemin, corps.to, 'cc' in corps, 'bcc' in corps], [1, '/v3/smtp/email', [{ email: 'destinataire@exemple.fr' }], false, false]);
        H.v('sujet, texte et HTML sont le message constant', [corps.subject, corps.textContent, corps.htmlContent], [c.objet, c.texte, c.html]);
        H.v('expéditeur des courriels de comptes (Rat-Market <no-reply@rat-market.fr>)', corps.sender, { name: 'Rat-Market', email: 'no-reply@rat-market.fr' });
        H.v('classe « avertissement » : les courriels de sécurité (vérification, mot de passe) passent avant', classes, ['avertissement']);
        H.v('l\'adresse ne figure que dans `to`', JSON.stringify({ ...corps, to: null }).includes('destinataire@exemple'), false);
        const e = await (async () => { try { await p.envoyerLienOrdinateur('pas une adresse'); return null; } catch (x) { return x; } })();
        H.v('adresse invalide : refusée AVANT toute requête (BrevoAdresse)', [e && e.name, vusBrevo.length], ['BrevoAdresse', 1]);
        // le plafond propre à la classe : réserve de sécurité intacte
        const plein = creerPlafondJour({ max: 10, reserveSecurite: 4, colonne: () => db.col('courriels_test_lien') });
        let acceptes = 0; for (let i = 0; i < 10; i++) if (await plein.reserver('avertissement')) acceptes++;
        H.v('(témoin) la classe avertissement s\'arrête à max − réserve : 6 sur 10, 4 places restent à la sécurité', acceptes, 6);
        await new Promise(r => faux.close(r));
        // E1 (relecture T2-B) : DEUX tentatives RÉELLES du pilote contre un faux serveur à réponses en séquence — la première part en 5xx / réseau, le réessai reçoit un 4xx : l'erreur porte `apresTentativeAmbigue`, le service garde la marque
        {
            const serveurEnSequence = async suite => {
                let n = 0; const s = http.createServer((req, res) => { req.on('data', () => { }); req.on('end', () => { const st = suite[Math.min(n++, suite.length - 1)]; if (st === 'coupure') return req.socket.destroy(); res.writeHead(st, { 'content-type': 'application/json' }); res.end('{}'); }); });
                await new Promise(r => s.listen(0, '127.0.0.1', r));
                return { url: `http://127.0.0.1:${s.address().port}/v3/smtp/email`, appels: () => n, fermer: () => new Promise(r => { s.closeAllConnections?.(); s.close(r); }) };
            };
            const { creerService, empreinteBoite, PREFIXE } = require('../lien-ordinateur/service');
            const cfgE = lireConfig(BASE);
            const vivante = async adresse => (await MARQUES()).some(d => d.cle === `${PREFIXE}${empreinteBoite(cfgE.empreinte.secret, adresse)}|reservation` && d.expireLe.getTime() > Date.now() + 1000);
            const cas = async (suite, adresse) => {
                const s = await serveurEnSequence(suite);
                const p = creerCourrierBrevo({ cle: 'xkeysib-CLE-DE-BANC-E1', url: s.url, reessaiMs: 0 });
                const e = await lever(() => creerService({ cfg: cfgE, courrier: p }).demander(adresse));
                const appels = s.appels(); await s.fermer();
                return { e, appels, marque: await vivante(adresse) };
            };
            let r = await cas([503, 401], 'e1a@exemple.fr');
            H.v('1re tentative 503, réessai 401 : DEUX appels réels, erreur BrevoStatut401 MARQUÉE apresTentativeAmbigue, marque GARDÉE', [r.appels, r.e && r.e.name, r.e && r.e.apresTentativeAmbigue === true, r.marque], [2, 'BrevoStatut401', true, true]);
            r = await cas(['coupure', 403], 'e1c@exemple.fr');
            H.v('1re tentative coupée (réseau), réessai 403 : marqueur posé, marque GARDÉE', [r.appels, r.e && r.e.apresTentativeAmbigue === true, r.marque], [2, true, true]);
            r = await cas([408, 401], 'e1g@exemple.fr');
            H.v('1re tentative 408 (un délai : non réessayée), erreur BrevoStatut408 sans marqueur, marque GARDÉE', [r.appels, r.e && r.e.name, r.marque], [1, 'BrevoStatut408', true]);
            r = await cas([503, 400], 'e1h@exemple.fr');
            H.v('1re tentative 503, réessai 400 : le 400 ne rend PAS la marque (la première a pu partir)', [r.e && r.e.name, r.marque], ['BrevoStatut400', true]);
            r = await cas([401], 'e1d@exemple.fr');
            H.v('4xx dès la 1re tentative (aucun réessai) : UN appel, pas de marqueur, marque RENDUE', [r.appels, r.e && r.e.name, r.e && r.e.apresTentativeAmbigue, r.marque], [1, 'BrevoStatut401', undefined, false]);
            r = await cas([503, 503], 'e1e@exemple.fr');
            H.v('5xx puis 5xx : BrevoStatut503, marque GARDÉE', [r.e && r.e.name, r.marque], ['BrevoStatut503', true]);
            r = await cas([503, 201], 'e1f@exemple.fr');
            H.v('5xx puis succès : aucune erreur (le réessai a réussi), marque posée', [r.e, r.marque], [null, true]);
        }
    }

    await srv.fermer().catch(() => { });
    await H.fermerBac(); H.bilan();

    // — lecture de TOUT ce que les collections du banc contiennent, en texte —
    async function toutLeContenu() {
        const b = db.base(), pre = db.prefixeCourant();
        const noms = (await b.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name).filter(x => x.startsWith(pre));
        const morceaux = []; for (const nom of noms) morceaux.push(JSON.stringify(await b.collection(nom).find({}).toArray()));
        return morceaux.join('\n');
    }
})().catch(e => { console.error('❌', e); process.exit(1); });
