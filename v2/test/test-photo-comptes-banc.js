'use strict';
// COMPTE-TEST commit 4 (01/11) — POST /api/photo ouvert au compte de test ORDINAIRE, et à lui seul : la garde de rôle d'origine (exigerAdministrateurPhoto) reste telle quelle pour tout le monde,
// sauf quand V2_PHOTO_COMPTES_BANC=1 ET que le compte est celui de la liste fermée (adresse réservée + banc + bancOrdinaire + confirmé + sans rôle, installations/exemption-banc.js) ET que la base réelle est celle de l'essai.
// Rien d'autre n'est ouvert : pas de débit, pas de quota, pas de rôle. Chaque dépôt d'un compte de banc est journalisé (compte, heure, taille, sha256), jamais l'image ni un secret.
// Base EN MÉMOIRE, images SYNTHÉTIQUES. La preuve d'un refus « avant la lecture » est le compteur d'octets lus (socket.bytesRead à l'envoi de la réponse).
const http = require('http'), crypto = require('crypto'), express = require('express'), sharp = require('sharp'), mongoose = require('mongoose');
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config'); const registre = require('../registre'); const { creerPhotosRecues } = require('../identifier/photos-recues');
const { dansUnScan } = require('../../sources'); const { assembler } = require('../index'); const pret = require('../pret');

const BASE = { MONGODB_BASE: 'test_scratch', V2_PHOTOS_MULTIPLES: '1', V2_ETIQUETTE_HEURE: '1000' };
const cfgFlag = lireConfig({ ...BASE, V2_PHOTO_COMPTES_BANC: '1' }), cfgSans = lireConfig({ ...BASE });
const ADR = 'banc-ordinaire@rat-market.invalid';
const oid = () => new mongoose.Types.ObjectId();
const bruit = (w = 400, h = 560) => sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
const lus = new Map(); let nEssai = 0, nIp = 0;

const journaux = [];
for (const k of ['log', 'warn', 'error', 'info']) { const o = console[k]; console[k] = (...a) => { journaux.push(a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ')); return o.apply(console, a); }; }

function envoyer(base, { jeton, corps }) {
    const essai = `e${++nEssai}`, url = new URL(base + '/api/photo');
    const h = { 'x-essai': essai, 'x-forwarded-for': `10.40.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}`, 'content-type': 'image/jpeg', 'content-length': String(corps.length) };
    if (jeton) h.authorization = `Bearer ${jeton}`;
    return new Promise(resolve => {
        const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: h, agent: false }, res => {
            const m = []; res.on('data', c => m.push(c));
            res.on('end', () => { const t = Buffer.concat(m).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch { /* non JSON */ } resolve({ statut: res.statusCode, json: j, texte: t, essai }); });
        });
        req.on('error', () => resolve({ statut: null, essai }));
        req.end(corps);
    });
}

setTimeout(() => { console.error('❌ le banc a dépassé 120 s'); process.exit(1); }, 120000).unref();
(async () => {
    await H.ouvrirBac('test-photo-comptes-banc.js'); await M.creerIndex();
    registre.fournir('banc', { apresVerdict() { }, conserverPhoto: async () => ({}) });
    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ email = `a${oid()}@exemple.fr`, role = null, extra = {} } = {}) {
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {}, extra);
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compteId: c._id, generation: 0 });
        return { c, jeton };
    }
    const retirerBanc = () => db.col('comptes').deleteMany({ emailCle: ADR });
    const neuf = async (extra = {}) => { await retirerBanc(); return acteur({ email: ADR, extra: { banc: true, bancOrdinaire: true, ...extra } }); };
    const monter = async (cfg, extra = {}) => {
        const app = express(); app.set('trust proxy', true);
        for (const l of require('../index').LOTS) l.enTete(app, cfg);
        app.use((q, s, n) => { const wh = s.writeHead; s.writeHead = function (...a) { lus.set(q.headers['x-essai'], q.socket.bytesRead); return wh.apply(this, a); }; n(); });
        app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../identifier/monter'), require('../banc/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), photosRecues: creerPhotosRecues({ horloge: () => Date.now() }), ...extra }));
        return H.serveur(app);
    };
    const jpg = await bruit(), sha = crypto.createHash('sha256').update(jpg).digest('hex');
    const svEssai = await monter(cfgFlag, { nomBase: () => 'rm_essai' }), svReel = await monter(cfgFlag), svProd = await monter(cfgFlag, { nomBase: () => 'test' }), svSans = await monter(cfgSans, { nomBase: () => 'rm_essai' });
    const svLeve = await monter(cfgFlag, { nomBase: () => { throw new Error('boum'); } });
    const ADM = await acteur({ role: 'administrateur' }), ORD = await acteur({});

    H.v('0. config : V2_PHOTO_COMPTES_BANC éteint par défaut, allumé par « 1 » exactement', [cfgSans.photoComptesBanc, cfgFlag.photoComptesBanc, lireConfig({ ...BASE, V2_PHOTO_COMPTES_BANC: 'true' }).photoComptesBanc, lireConfig({ ...BASE, V2_PHOTO_COMPTES_BANC: ' 1' }).photoComptesBanc], [false, true, false, false]);

    // ── le compte de banc passe, dans la seule configuration voulue ──
    const banc = await neuf();
    const mvAvant = await db.col('mouvements').countDocuments({});
    const a = await envoyer(svEssai.url, { jeton: banc.jeton, corps: jpg });
    H.v('1a. drapeau allumé, base de l\'essai (rm_essai), compte de la liste fermée : 200 avec un photoId', [a.statut, typeof (a.json && a.json.photoId)], [200, 'string']);
    const b = await envoyer(svReel.url, { jeton: banc.jeton, corps: jpg });
    H.v('1b. drapeau allumé, base RÉELLE du banc (test_scratch sous BANC_ISOLE=1) : 200', b.statut, 200);
    H.v('1c. l\'accès à la route est TOUT ce qui s\'ouvre : aucun mouvement d\'argent, aucun compteur de quota, le compte reste sans rôle', [await db.col('mouvements').countDocuments({}) - mvAvant, await db.col('quota_jour').countDocuments({}), (await db.col('comptes').findOne({ _id: banc.c._id })).role], [0, 0, undefined]);

    // ── le même code, en configuration de production : refus ──
    const natif = await envoyer(svSans.url, { jeton: ORD.jeton, corps: jpg });       // le 404 natif d'un non-administrateur, la référence
    for (const [nom, sv] of [['drapeau ÉTEINT (base de l\'essai)', svSans], ['base de PRODUCTION (nom « test »)', svProd], ['lecture du nom de la base qui lève', svLeve]]) {
        const r = await envoyer(sv.url, { jeton: banc.jeton, corps: jpg });
        H.v(`2. ${nom} : le compte de banc reçoit le 404 natif, identique à celui d'un non-administrateur`, [r.statut, r.texte === natif.texte], [404, true]);
        H.v('   ... sans lire le corps de la photo', lus.get(r.essai) < jpg.length, true);
    }
    for (const autre of ['cartes', 'rm_essai2', 'RM_ESSAI', '', undefined, 42]) {
        const s = await monter(cfgFlag, { nomBase: () => autre });
        H.v(`   base « ${String(autre)} » : 404`, (await envoyer(s.url, { jeton: banc.jeton, corps: jpg })).statut, 404);
        await s.fermer();
    }

    // ── tout compte hors de la liste fermée garde le refus d'origine ──
    H.v('3a. compte ordinaire quelconque : 404 natif, drapeau allumé', (await envoyer(svEssai.url, { jeton: ORD.jeton, corps: jpg })).statut, 404);
    const sansMarque = await neuf({ banc: undefined, bancOrdinaire: undefined });
    H.v('3b. la bonne adresse SANS les marques : 404', (await envoyer(svEssai.url, { jeton: sansMarque.jeton, corps: jpg })).statut, 404);
    const marqueSeule = await acteur({ extra: { banc: true, bancOrdinaire: true } });
    H.v('3c. les deux marques sur une AUTRE adresse : 404', (await envoyer(svEssai.url, { jeton: marqueSeule.jeton, corps: jpg })).statut, 404);
    const avecRole = await neuf({ role: 'moderateur' });
    H.v('3d. le compte exact avec un rôle quelconque : 404', (await envoyer(svEssai.url, { jeton: avecRole.jeton, corps: jpg })).statut, 404);
    const nonVerifie = await neuf({ verifie: false });
    H.v('3e. le compte exact non confirmé : 404', (await envoyer(svEssai.url, { jeton: nonVerifie.jeton, corps: jpg })).statut, 404);
    const texte = await neuf({ bancOrdinaire: 'true' });
    H.v('3f. bancOrdinaire non strictement true : 404', (await envoyer(svEssai.url, { jeton: texte.jeton, corps: jpg })).statut, 404);
    H.v('3g. sans jeton : refus (401), jamais 200', [401, 404].includes((await envoyer(svEssai.url, { corps: jpg })).statut), true);
    H.v('3h. un jeton inconnu : refus, jamais 200', [401, 404].includes((await envoyer(svEssai.url, { jeton: J.genererJeton(), corps: jpg })).statut), true);

    // ── l'administrateur garde son accès, avec ou sans le drapeau ──
    for (const [nom, sv] of [['drapeau allumé', svEssai], ['drapeau éteint', svSans], ['base de production', svProd]]) H.v(`4. administrateur, ${nom} : 200`, (await envoyer(sv.url, { jeton: ADM.jeton, corps: jpg })).statut, 200);

    // ── le journal ──
    const banc2 = await neuf();
    journaux.length = 0;
    const j = await envoyer(svEssai.url, { jeton: banc2.jeton, corps: jpg });
    const lignes = journaux.filter(l => l.includes('[v2 photo-banc]'));
    H.v('5a. le dépôt du compte de banc est journalisé : une ligne', [j.statut, lignes.length], [200, 1]);
    H.vrai('   ... avec qui (id du compte), quand (ISO), la taille et le sha256 de la photo', lignes.length === 1 && lignes[0].includes(`compte=${banc2.c._id}`) && lignes[0].includes(`octets=${jpg.length}`) && lignes[0].includes(`sha256=${sha}`) && /le=\d{4}-\d\d-\d\dT[\d:.]+Z/.test(lignes[0]));
    const tout = journaux.join('\n');
    H.vrai('   ... jamais l\'image, ni un jeton, ni le mot de passe', !tout.includes(jpg.toString('base64').slice(0, 64)) && !tout.includes(banc2.jeton) && !tout.includes('mot-de-passe-du-banc'));
    journaux.length = 0;
    await envoyer(svEssai.url, { jeton: ADM.jeton, corps: jpg });
    H.v('5b. le dépôt d\'un administrateur n\'écrit pas cette ligne', journaux.filter(l => l.includes('[v2 photo-banc]')).length, 0);
    journaux.length = 0;
    await envoyer(svProd.url, { jeton: banc2.jeton, corps: jpg });
    H.v('5c. un refus (base de production) n\'écrit pas cette ligne non plus', journaux.filter(l => l.includes('[v2 photo-banc]')).length, 0);

    for (const s of [svEssai, svReel, svProd, svSans, svLeve]) await s.fermer();
    H.bilan(); await H.fermerBac();
})().catch(async e => { console.error(e); process.exitCode = 1; try { await H.fermerBac(); } catch { /* sortie */ } });
