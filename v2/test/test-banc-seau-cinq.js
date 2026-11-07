'use strict';
// JUGE RAPIDE — le mode « 5 candidats MÉLANGÉS + autre » : POST /api/banc/seau/candidats-5. Base EN MÉMOIRE, stockage MÉMOIRE, aucun réseau hors boucle locale.
// Règles jugées : 5 candidats (les 5 premiers du modèle) en ORDRE ALÉATOIRE (graine injectable ici), aucun indice (ni rang, ni score, ni prix, ni statut) ; le mode et l'ordre affiché sont enregistrés par le SERVEUR sur chaque vérité ;
// le candidat cliqué doit appartenir aux 5 proposés pour CE scan ; administrateur seulement ; le juge reste scellé (le champ neuf ne touche pas aux exclusions).
const H = require('./_harnais');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const S = require('../banc/stockage');
const { creerCatalogue } = require('../identifier/catalogue');

const cfgOn = lireConfig({ MONGODB_BASE: 'test_scratch', V2_BANC_SEAU: '1' });
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch' });
const detail = r => r.json && r.json.erreur && r.json.erreur.detail;
const oid = () => new mongoose.Types.ObjectId();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };
const PHOTO = () => sharp(crypto.randomBytes(400 * 560 * 3), { raw: { width: 400, height: 560, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
// une graine : un générateur déterministe + un Fisher-Yates, injecté au serveur
const graine = s => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const melangeurGraine = s => { const r = graine(s); return liste => { const a = liste.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }; };

(async () => {
    await H.ouvrirBac('test-banc-seau-cinq.js'); await M.creerIndex();
    const { creerSeaux } = require('../banc/seau');
    const memoire = S.creerStockageMemoire(S.CLE_SEAU);
    const reel = creerCatalogue({ cfg: cfgOn, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const semer = async (idProduct, nom, slugSet, numero, trend) => {
        await db.col('catalogue_produits').insertOne({ idProduct, name: nom, idMetacard: idProduct });
        await db.col('numeros_cartes').insertOne({ idProduct, slugSet, slug: `${nom}-${idProduct}`, numero });
        await db.col('guide_prix').insertOne({ idProduct, trend, low: trend, avg7: trend, avg30: trend, guideDu: new Date() });
    };
    // 7 produits : le modèle en propose 7 dans cet ordre ; les 5 premiers sont les « 5 meilleurs » (2006 et 2007 ne doivent JAMAIS sortir). Les prix sont dans l'ordre INVERSE du modèle (aucun ordre de prix ne ressemble à l'ordre du modèle).
    const IDS = [2001, 2002, 2003, 2004, 2005, 2006, 2007];
    for (const [i, id] of IDS.entries()) await semer(id, 'Pikachu', ['Base-Set', 'Jungle', 'Fossil', 'Team-Rocket', 'Neo-Genesis', 'Neo-Discovery', 'Gym-Heroes'][i], String(10 + i), 50 - i * 5);
    const ancres = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-ancres-'));
    const monterAvec = async (melanger, cfg = cfgOn) => {
        const seaux = creerSeaux({ cfg, stockage: memoire, horloge: () => new Date(), catalogue: reel, ancresDir: ancres, ...(melanger ? { melanger } : {}) });
        const app = express(); app.use(express.json());
        const router = express.Router();
        monterBanc.routes(router, cfg, { banc: {}, purge: { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) }, seaux });
        app.use(router);
        return H.serveur(app);
    };
    const GRAINE = 20261107;
    const sv = await monterAvec(melangeurGraine(GRAINE)), svOff = await monterAvec(null, cfgOff), svAlea = await monterAvec(null);
    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null, lie = true } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), ...(lie ? { compteId: c._id, generation: 0 } : {}) });
        return { c, jeton, porteur: `compte:${c._id}` };
    }
    const ADM = await acteur({ role: 'administrateur' }), ADM2 = await acteur({ role: 'administrateur' }), USR = await acteur({});
    const SEUL = await (async () => { const jeton = J.genererJeton(); await db.col('installations').insertOne(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'seule' })); return { jeton }; })();
    const auth = a => (a ? { authorization: `Bearer ${a.jeton}` } : {});
    const post = (s, a, chemin, corps) => H.appel(s.url, chemin, { methode: 'POST', corps, entetes: auth(a) });
    const envoyer = async (s, a, chemin, corps) => { const r = await fetch(s.url + chemin, { method: 'POST', headers: { 'content-type': 'image/jpeg', ...auth(a) }, body: corps }); const texte = await r.text(); let json = null; try { json = JSON.parse(texte); } catch { /* non JSON */ } return { statut: r.status, json, texte }; };
    const semerScan = async (a, choix = IDS) => {
        const _id = oid();
        const carte = { idProduct: choix[0], statut: 'identifiee', raison: null, etat: { retenu: 'NM' }, question: { code: 'q', choix: choix.map(idProduct => ({ idProduct })) }, zone: null };
        await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: 'identifiee', cartes: [carte], produits: [], facturation: { motif: 'administrateur' }, versionChaine: 'abc123def456', versionModele: 'modele-x', creeLe: new Date(), expireLe: new Date(Date.now() + 864e5) });
        return String(_id);
    };

    let juge;
    await essayer('mise en place', async () => {
        const r = await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'juge-200', type: 'juge', cible: 3 });
        juge = r.json.seau;
        H.v('0. le juge est déclaré', [r.statut, juge.type], [201, 'juge']);
    });
    const ranger = async (a, choix) => { const s = await semerScan(a, choix); await envoyer(sv, a, `/api/banc/seau/photo?scanId=${s}&photo=0&seau=${juge.id}&annonce=${sha(s)}`, await PHOTO()); return s; };
    const s1 = await ranger(ADM), s2 = await ranger(ADM), s3 = await ranger(ADM, [2006, 2007, 2001, 2002, 2003, 2004]);

    // ══ 1. l'accès : administrateur seulement, comme toutes les routes du seau
    await essayer('accès', async () => {
        const natif = (await H.appel(sv.url, '/api/banc/route-qui-nexiste-pas', { entetes: auth(ADM) })).statut;
        for (const [nom, a] of [['simple utilisateur', USR], ['installation seule', SEUL]]) {
            const r = await post(sv, a, '/api/banc/seau/candidats-5', { scanId: s1 });
            H.v(`1. candidats-5 ${nom} : 404 natif, aucun candidat`, [r.statut, !!(r.json && r.json.candidats)], [natif, false]);
        }
        H.v('1. candidats-5 sans jeton : 401', (await post(sv, null, '/api/banc/seau/candidats-5', { scanId: s1 })).statut, 401);
        H.v('1. candidats-5 drapeau éteint (même l\'administrateur) : 404 natif', (await post(svOff, ADM, '/api/banc/seau/candidats-5', { scanId: s1 })).statut, natif);
        H.v('1. le scan d\'un AUTRE administrateur : 404', (await post(sv, ADM2, '/api/banc/seau/candidats-5', { scanId: s1 })).statut, 404);
        H.v('1. un champ inconnu dans le corps : 400', (await post(sv, ADM, '/api/banc/seau/candidats-5', { scanId: s1, rang: 1 })).statut, 400);
        H.v('1. un scanId mal formé : 400', (await post(sv, ADM, '/api/banc/seau/candidats-5', { scanId: 'zz' })).statut, 400);
    });

    // ══ 2. la réponse : 5 candidats, les 5 meilleurs du modèle, mélangés, sans aucun indice
    let ordre1;
    await essayer('réponse', async () => {
        const r = await post(sv, ADM, '/api/banc/seau/candidats-5', { scanId: s1 });
        H.v('2. 200 et 5 candidats', [r.statut, r.json.candidats.length], [200, 5]);
        ordre1 = r.json.candidats.map(c => c.idProduct);
        H.v('2. 🔑 ce sont les 5 PREMIERS du modèle (2006 et 2007 ne sortent jamais)', ordre1.slice().sort(), [2001, 2002, 2003, 2004, 2005]);
        const attendu = melangeurGraine(GRAINE)([2001, 2002, 2003, 2004, 2005]);
        H.v('2. 🔑 l\'ordre est celui du mélange (graine injectée) — et il n\'est ni l\'ordre du modèle ni l\'ordre du prix', [ordre1, ordre1.join() !== '2001,2002,2003,2004,2005', ordre1.join() !== '2005,2004,2003,2002,2001'], [attendu, true, true]);
        H.v('2. mêmes champs pour chacun : idProduct, nom, numero, set, version, visuel', r.json.candidats.map(c => Object.keys(c).sort().join()), Array(5).fill('idProduct,nom,numero,set,version,visuel'));
        const t = r.texte.toLowerCase();
        H.v('2. 🔑 aucun indice de la préférence du modèle : ni rang, ni score, ni prix, ni statut, ni ordre', ['rang', 'score', 'prix', 'statut', 'identifiee', 'ordre', 'classement', 'confiance', 'trend'].filter(m => t.includes(m)), []);
        H.v('2. seules clés de la réponse : success, candidats, mode', Object.keys(r.json).sort(), ['candidats', 'mode', 'success']);
        H.v('2. le mode est dit', r.json.mode, 'candidats-5');
        const vue = await db.col('banc_seau_vues').find({ scanId: s1 }).toArray();
        H.v('2. la vue est ENREGISTRÉE avec le mode et l\'ordre affiché', [vue.length, vue[0].mode, vue[0].ids], [1, 'candidats-5', ordre1]);
    });
    await essayer('mélange réel', async () => {
        const ordres = new Set(), places = new Set();
        for (let i = 0; i < 40; i++) { const r = await post(svAlea, ADM, '/api/banc/seau/candidats-5', { scanId: s2 }); const o = r.json.candidats.map(c => c.idProduct); ordres.add(o.join()); places.add(o.indexOf(2001)); }
        H.v('2. 🔑 sans graine : l\'ordre change d\'un appel à l\'autre (au moins 10 ordres distincts sur 40)', ordres.size >= 10, true);
        H.v('2. 🔑 le premier du modèle apparaît à TOUTES les places au fil des appels (aucune place stable)', places.size, 5);
    });

    // ══ 3. la vérité : mode et ordre enregistrés par le serveur, candidat cliqué ∈ les 5 proposés
    await essayer('vérités', async () => {
        const verite = (corps, a = ADM) => post(sv, a, '/api/banc/seau/verite', corps);
        H.v('3. 🔑 un candidat hors des 5 (2006, 6e du modèle) : refusé 409 candidat-hors-liste, rien d\'écrit', [detail(await verite({ scanId: s1, idProduct: 2006, via: 'candidat5', mode: 'candidats-5' })), await db.col('banc_seau_verites').countDocuments({ scanId: s1 })], ['candidat-hors-liste', 0]);
        H.v('3. un candidat inconnu du catalogue : refusé', (await verite({ scanId: s1, idProduct: 999999, via: 'candidat5', mode: 'candidats-5' })).statut >= 400, true);
        H.v('3. 🔑 via candidat5 sans avoir demandé les 5 (scan s3) : 409 candidat-hors-liste', detail(await verite({ scanId: s3, idProduct: 2001, via: 'candidat5', mode: 'candidats-5' })), 'candidat-hors-liste');
        H.v('3. via candidat5 avec le mode « saisie » : 400', (await verite({ scanId: s1, idProduct: 2003, via: 'candidat5', mode: 'saisie' })).statut, 400);
        H.v('3. un mode inconnu : 400', (await verite({ scanId: s1, idProduct: 2003, via: 'idProduct', mode: 'rapide' })).statut, 400);
        H.v('3. 🔑 le client ne déclare pas l\'ordre affiché : 400', (await verite({ scanId: s1, idProduct: 2003, via: 'candidat5', mode: 'candidats-5', ordreAffiche: [2003] })).statut, 400);
        H.v('3. mode candidats-5 sans que les 5 aient été montrés pour ce scan (s3) : 409 mode-sans-vue', detail(await verite({ scanId: s3, idProduct: 2001, via: 'idProduct', mode: 'candidats-5' })), 'mode-sans-vue');
        H.v('3. un administrateur non propriétaire du scan : 404', (await verite({ scanId: s1, idProduct: 2003, via: 'candidat5', mode: 'candidats-5' }, ADM2)).statut, 404);
        H.v('3. un simple utilisateur : 404 natif', (await post(sv, USR, '/api/banc/seau/verite', { scanId: s1, idProduct: 2003, via: 'candidat5', mode: 'candidats-5' })).statut, (await H.appel(sv.url, '/api/banc/route-qui-nexiste-pas', { entetes: auth(ADM) })).statut);
        // le clic sur un des 5
        let r = await verite({ scanId: s1, idProduct: 2003, via: 'candidat5', mode: 'candidats-5', photoSuffisante: true });
        H.v('3. un clic sur un des 5 : écrit, rev 1', [r.statut, r.json.rev], [200, 1]);
        let v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('3. 🔑 la ligne porte le MODE et l\'ORDRE AFFICHÉ (celui que le serveur a servi), via, idProduct', [v.mode, v.ordreAffiche, v.via, v.idProduct, v.photoSuffisante], ['candidats-5', ordre1, 'candidat5', 2003, true]);
        // « Autre » : la saisie actuelle, dans le mode candidats-5 (l'ordre vu est gardé pour mesurer le biais) ; sans mode : saisie
        r = await verite({ scanId: s2, idProduct: 2007, via: 'idProduct', photoSuffisante: false });
        v = await db.col('banc_seau_verites').findOne({ scanId: s2, carte: 0 });
        H.v('3. une vérité sans `mode` (saisie classique) : mode « saisie », aucun ordre affiché', [r.statut, v.mode, v.ordreAffiche], [200, 'saisie', null]);
        const ordre2 = (await db.col('banc_seau_vues').find({ scanId: s2 }).sort({ le: -1 }).limit(1).toArray())[0].ids;
        r = await verite({ scanId: s2, idProduct: 2007, via: 'url', mode: 'candidats-5', photoSuffisante: false });
        v = await db.col('banc_seau_verites').findOne({ scanId: s2, carte: 0 });
        H.v('3. « Autre » après avoir vu les 5 : via url, mode candidats-5, ordre vu gardé, rev 2', [r.statut, r.json.rev, v.mode, v.via, v.ordreAffiche], [200, 2, 'candidats-5', 'url', ordre2]);
        H.v('3. l\'historique garde le mode et l\'ordre de la saisie précédente', [v.historique[0].mode, v.historique[0].ordreAffiche], ['saisie', null]);
        // « pas une carte » dans le mode des 5
        r = await verite({ scanId: s2, aucune: 'pas-une-carte', via: 'manuel', mode: 'candidats-5' });
        H.v('3. « pas une carte » dans le mode des 5 : écrit, mode candidats-5', [r.statut, (await db.col('banc_seau_verites').findOne({ scanId: s2, carte: 0 })).mode], [200, 'candidats-5']);
        // le second appel de candidats-5 remplace la liste proposée : le dernier ordre servi est celui qui est enregistré
        const r2 = await post(sv, ADM, '/api/banc/seau/candidats-5', { scanId: s1 });
        const ordre1b = r2.json.candidats.map(c => c.idProduct);
        await verite({ scanId: s1, idProduct: 2004, via: 'candidat5', mode: 'candidats-5', photoSuffisante: true });
        v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('3. un nouvel appel reproposé : l\'ordre enregistré est le DERNIER servi', [v.ordreAffiche, v.rev], [ordre1b, 2]);
        H.v('3. chaque ligne de vérité du juge porte un mode connu', (await db.col('banc_seau_verites').find({ seauId: juge.id }).toArray()).every(x => ['candidats-5', 'saisie'].includes(x.mode)), true);
    });

    // ══ 4. le juge reste scellé : le champ neuf ne change ni le scellé ni les exclusions
    await essayer('scellé', async () => {
        const fs2 = require('fs'); const src = fs2.readFileSync(path.join(__dirname, '..', 'mesures', 'exporter-seau.js'), 'utf8');
        const lignesExclusion = src.split('\n').filter(l => /fuiteJuge|exclusParCause|annoncesJuge|const cause|cause = /.test(l));
        H.v('4. 🔑 les lignes d\'exclusion de l\'export ne lisent ni le mode ni l\'ordre affiché', lignesExclusion.filter(l => /\bmode\b|ordreAffiche|candidat5/.test(l)), []);
        // le scellé couvre les vérités par (scan, carte, idProduct, aucune, rev) : mode et ordre n'y entrent pas
        for (const id of [s3]) await post(sv, ADM, '/api/banc/seau/verite', { scanId: id, idProduct: 2001, via: 'idProduct', photoSuffisante: true });
        const sc = await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id });
        H.v('4. le juge se scelle complet (3/3) avec des vérités du mode des 5', [sc.statut, sc.json.seau.etat, !!sc.json.seau.veritesEmpreinte], [200, 'scelle', true]);
        const ver = await H.appel(sv.url, `/api/banc/seau/verifier?seau=${juge.id}`, { entetes: auth(ADM) });
        H.v('4. la chaîne du juge scellé se relit sans problème', [ver.statut, ver.json.problemes.map(p => p.cause).filter(c => c !== 'non-ancre'), (ver.json.lignes || 0) >= 0], [200, [], true]);       // 'non-ancre' : l'ancre d'un juge vit hors de ce banc
        const apres = await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2002, via: 'candidat5', mode: 'candidats-5' });
        H.v('4. 🔑 une vérité dans un juge scellé : 409 juge-scelle (le mode des 5 n\'ouvre rien)', [apres.statut, detail(apres)], [409, 'juge-scelle']);
    });

    await sv.fermer(); await svOff.fermer(); await svAlea.fermer();
    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
