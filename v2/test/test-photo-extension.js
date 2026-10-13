'use strict';
// PHOTO-EXTENSION — l'extension envoie l'image qu'elle affiche (champ `photoBase64` de POST /api/identifier).
// Base : la base EN MÉMOIRE du banc. Aucune vraie photo : toutes les images sont SYNTHÉTIQUES (sharp, en mémoire). Aucun réseau, aucun bucket réel (stockage mémoire).
// Ce que ce banc tient : (0) le validateur (taille, base64, types par les octets, décodage, dimensions) ne lève jamais et nomme une CAUSE ; (1) le repli de téléchargement est espacé et plafonné,
// compté dans la BASE ; (2) photo-admin conserve l'image fournie SANS rien télécharger, et ne conserve rien pour un non-administrateur ; (3) l'analyseur d'image est UN SEUL (celui du scanner) ;
// (4) le corps JSON est plus grand SEULEMENT pour un scan v2 (Bearer) ; (5) l'empreinte d'idempotence ignore la photo.
const H = require('./_harnais');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const { creerBanc } = require('../banc/routes');
const S = require('../banc/stockage');
const registre = require('../registre');

const ENVCFG = { MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '100000' };
const cfg = lireConfig(ENVCFG);
const oid = () => new mongoose.Types.ObjectId();
const BUCKET = 'bucket-banc-test', SEL = 'sel-photo-ext';
const ENV = { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL };
const URL_PHOTO = 'https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg';
const img = (w, h, couleur, f = 'jpeg') => sharp({ create: { width: w, height: h, channels: 3, background: couleur || { r: 200, g: 40, b: 40 } } })[f]().toBuffer();
const b64 = b => b.toString('base64');
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.code || e.message)), 'aucune'); } };
const attendre = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await H.ouvrirBac('test-photo-extension.js'); await M.creerIndex();

    // ═══ 0. le validateur ═══
    await essayer('0', async () => {
        const PE = require('../identifier/photo-extension');
        const LIM = cfg.images.photoExtensionOctetsMax;
        H.v('0. borne de taille : 2 Mio décodés (config.images.photoExtensionOctetsMax)', LIM, 2 * 1024 * 1024);
        const jpg = await img(400, 560), png = await img(300, 420, null, 'png'), webp = await img(300, 420, null, 'webp');
        for (const [nom, b] of [['jpeg', jpg], ['png', png], ['webp', webp]]) {
            const r = await PE.evaluer(b64(b), { octetsMax: LIM });
            H.v(`0. ${nom} valide : les octets décodés, aucune cause`, [Buffer.isBuffer(r.octets) && r.octets.equals(b), r.cause], [true, undefined]);
        }
        const cause = async (v, o = {}) => (await PE.evaluer(v, { octetsMax: LIM, ...o })).cause;
        H.v('0. absent (undefined, null) : « absente »', [await cause(undefined), await cause(null)], ['absente', 'absente']);
        H.v('0. pas une chaîne (nombre, objet, tableau, booléen) : « type-invalide »', [await cause(12), await cause({}), await cause([b64(jpg)]), await cause(true)], ['type-invalide', 'type-invalide', 'type-invalide', 'type-invalide']);
        H.v('0. chaîne vide, préfixe data:, longueur non multiple de 4, caractères hors alphabet, espace : « base64-invalide »',
            [await cause(''), await cause(`data:image/jpeg;base64,${b64(jpg)}`), await cause(b64(jpg).slice(0, -1)), await cause('!!!!'), await cause(` ${b64(jpg)}`)], Array(5).fill('base64-invalide'));
        H.v('0. trop grosse : jugée sur la longueur de la CHAÎNE, avant tout décodage (3 millions de « A »)', await cause('A'.repeat(3000000)), 'trop-grosse');
        H.v('0. la borne est inclusive : une image de N octets passe avec octetsMax = N, refusée avec N − 1', [await cause(b64(jpg), { octetsMax: jpg.length }), await cause(b64(jpg), { octetsMax: jpg.length - 1 })], [undefined, 'trop-grosse']);
        const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]), heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(40)]);
        H.v('0. GIF, HEIC, texte, octets nuls : « format » (jugé sur les OCTETS, pas sur une déclaration)', [await cause(b64(gif)), await cause(b64(heic)), await cause(b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))), await cause(b64(Buffer.alloc(64)))], Array(4).fill('format'));
        H.v('0. JPEG tronqué de moitié, JPEG aux seuls octets magiques : « illisible »', [await cause(b64(jpg.subarray(0, jpg.length >> 1))), await cause(b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100, 7)])))], ['illisible', 'illisible']);
        const large = await img(4097, 1, null, 'png'), pixels = await img(4000, 3300, null, 'png'), correcte = await img(4000, 3000, null, 'png'), carree = await img(4096, 2900, null, 'png');
        H.v('0. TOUR 1 : côté de plus de 4 096 px, plus de 12 millions de pixels : « dimensions » ; 4000 × 3000 (12 Mpx, une photo de téléphone) et 4096 × 2900 passent', [await cause(b64(large)), await cause(b64(pixels)), await cause(b64(correcte)), await cause(b64(carree))], ['dimensions', 'dimensions', undefined, undefined]);
        // un PNG entrelacé et un JPEG progressif de 49 Mpx : refusés sur l'EN-TÊTE, avant le décodage complet (le décodage coûtait +180 Mo de mémoire : relecture 1, I2)
        const entrelace = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 3, g: 4, b: 5 } } }).png({ progressive: true }).toBuffer();
        const progressif = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 3, g: 4, b: 5 } } }).jpeg({ progressive: true }).toBuffer();
        for (const [nom, b] of [['PNG entrelacé', entrelace], ['JPEG progressif', progressif]]) {
            const s = b64(b); const r0 = process.memoryUsage().rss; const c = await cause(s); const dr = (process.memoryUsage().rss - r0) / 1048576;
            H.v(`0. TOUR 1 : ${nom} de 49 Mpx : « dimensions », sans décodage complet (mémoire < 60 Mo de plus)`, [c, dr < 60], ['dimensions', true]);
        }
        // une image ANIMÉE (plus d'une page) est refusée : traitée comme absente
        const trois = crypto.randomBytes(64 * 64 * 3 * 3);
        const animeW = await sharp(trois, { raw: { width: 64, height: 192, channels: 3, pageHeight: 64 } }).webp({ loop: 0, delay: [100, 100, 100] }).toBuffer();
        const fixeW = await img(64, 64, null, 'webp');
        H.v('0. TOUR 1 : un WebP animé (3 pages) : « illisible » ; un WebP fixe passe', [await cause(b64(animeW)), await cause(b64(fixeW))], ['illisible', undefined]);
        // au plus 2 décodages simultanés : le troisième est refusé tout de suite (jamais une attente)
        const trio = await Promise.all([1, 2, 3].map(() => PE.evaluer(b64(jpg), { octetsMax: LIM })));
        H.v('0. TOUR 1 : trois décodages simultanés => un seul refusé « occupe », les deux autres passent', [trio.filter(x => x.cause === 'occupe').length, trio.filter(x => Buffer.isBuffer(x.octets)).length], [1, 2]);
        H.v('0. TOUR 1 : la place est rendue (même après une image illisible) : les décodages suivants passent', [Buffer.isBuffer((await PE.evaluer(b64(jpg), { octetsMax: LIM })).octets), (await PE.evaluer(b64(jpg.subarray(0, 50)), { octetsMax: LIM })).cause, Buffer.isBuffer((await PE.evaluer(b64(jpg), { octetsMax: LIM })).octets)], [true, 'illisible', true]);
        // TOUR 1 (M1 de la relecture 1) : longueurs d'URL bornées
        const { verifierEntree } = require('../identifier/routes');
        const corpsOk = { contrat: 2, versionExtension: '2.0.0', marche: 'vinted.fr', imageUrls: [URL_PHOTO] };
        const longue = (n) => `https://images1.vinted.net/${'a'.repeat(n - 27)}`;
        const vu = (o) => { const r = verifierEntree({ ...corpsOk, ...o }, cfg); return r.erreur ? r.erreur.detail : 'ok'; };
        H.v('0. TOUR 1 : une URL d\'image de 2 048 caractères passe, de 2 049 est refusée (image-url) ; vintedUrl : 2 048 passe, 2 049 refusée (vinted-url)',
            [vu({ imageUrls: [longue(2048)] }), vu({ imageUrls: [longue(2049)] }), vu({ imageUrls: [URL_PHOTO, longue(2049)] }), vu({ vintedUrl: `https://www.vinted.fr/items/${'1'.repeat(2048 - 28)}` }), vu({ vintedUrl: `https://www.vinted.fr/items/${'1'.repeat(2049 - 28)}` })],
            ['ok', 'image-url', 'image-url', 'ok', 'vinted-url']);
        H.v('0. le validateur ne lève jamais (une valeur absurde rend une cause)', await cause(Symbol('x')).catch(e => `levée:${e.message}`), 'type-invalide');
        // le compteur : une cause par appel noté, jamais l'image
        PE.reinitialiser(); PE.noter('format'); PE.noter('format'); PE.noter('ok');
        H.v('0. les causes sont COMPTÉES (code seul)', PE.compteurs(), { format: 2, ok: 1 });
        // UN SEUL analyseur : celui du scanner
        const MP = require('../scanner/multipart'), SR = require('../scanner/routes');
        H.v('0. l\'analyseur d\'image est celui du scanner (exporté, réutilisé) : jamais une seconde implémentation', [typeof MP.typeDesOctets, typeof SR.analyserImage, /require\('\.\.\/scanner\/routes'\)/.test(require('fs').readFileSync(require.resolve('../identifier/photo-extension'), 'utf8')), /require\('sharp'\)/.test(require('fs').readFileSync(require.resolve('../identifier/photo-extension'), 'utf8'))], ['function', 'function', true, false]);
    });

    // ═══ 1. le repli de téléchargement : espacé, plafonné, compté dans la BASE ═══
    await essayer('1', async () => {
        const R = require('../banc/photo-repli');
        const c = (o = {}) => lireConfig({ ...ENVCFG, ...o });
        H.v('1. défauts : 10 s entre deux téléchargements, 400 par jour UTC', [lireConfig({ MONGODB_BASE: 'test_scratch' }).photoAdmin], [{ intervalleS: 10, maxJour: 400 }]);
        let bad = 0; for (const v of ['-1', 'abc', '1.5', '100001']) { try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_MAX_JOUR: v }); } catch { bad++; } }
        for (const v of ['-1', 'x', '3601']) { try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_INTERVALLE_S: v }); } catch { bad++; } }
        H.v('1. valeurs illisibles ou hors bornes : configuration invalide (7 sur 7)', bad, 7);
        const col = () => db.col('photo_admin_repli');
        const T0 = new Date('2026-03-10T10:00:00Z'), t = s => new Date(T0.getTime() + s * 1000);
        const k = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '10', V2_PHOTO_ADMIN_MAX_JOUR: '5' });
        const r1 = await R.reserver({ cfg: k, maintenant: t(0) }), r2 = await R.reserver({ cfg: k, maintenant: t(5) }), r3 = await R.reserver({ cfg: k, maintenant: t(10) });
        H.v('1. intervalle : le 1er passe, un 2e 5 s après est refusé « intervalle », un 3e à 10 s passe', [r1.ok, r2.ok, r2.cause, r3.ok], [true, false, 'intervalle', true]);
        H.v('1. le compte est dans la BASE (un seul document), pas dans la mémoire du processus', [await col().countDocuments({}), (await col().findOne({})).n], [1, 2]);
        // un « redémarrage » : le module rechargé n'a aucun état, la base refuse encore
        delete require.cache[require.resolve('../banc/photo-repli')];
        const R2 = require('../banc/photo-repli');
        H.v('1. après un redémarrage (module rechargé) le compteur ne repart pas de zéro', (await R2.reserver({ cfg: k, maintenant: t(12) })).cause, 'intervalle');
        // plafond du jour
        await col().deleteMany({});
        const k2 = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '3' });
        const rs = []; for (let i = 0; i < 5; i++) rs.push(await R2.reserver({ cfg: k2, maintenant: t(i) }));
        H.v('1. plafond du jour : 3 passent, le 4e et le 5e sont refusés « plafond-jour »', rs.map(x => x.ok ? 'ok' : x.cause), ['ok', 'ok', 'ok', 'plafond-jour', 'plafond-jour']);
        const demain = new Date(T0.getTime() + 86400e3);
        const rd = await R2.reserver({ cfg: k2, maintenant: demain });
        H.v('1. le jour UTC suivant, le compteur repart (n = 1)', [rd.ok, (await col().findOne({})).n, (await col().findOne({})).jour], [true, 1, '2026-03-11']);
        // minuit : 23:59:59 et 00:00:01 sont deux jours
        await col().deleteMany({});
        const k3 = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '1' });
        const a = await R2.reserver({ cfg: k3, maintenant: new Date('2026-03-10T23:59:59Z') }), b = await R2.reserver({ cfg: k3, maintenant: new Date('2026-03-10T23:59:59Z') }), d = await R2.reserver({ cfg: k3, maintenant: new Date('2026-03-11T00:00:01Z') });
        H.v('1. frontière de minuit UTC : le plafond de la veille ne bloque pas le lendemain', [a.ok, b.cause, d.ok], [true, 'plafond-jour', true]);
        await col().deleteMany({});
        const k0 = c({ V2_PHOTO_ADMIN_MAX_JOUR: '0' });
        H.v('1. plafond 0 : le repli est coupé', (await R2.reserver({ cfg: k0, maintenant: t(0) })).cause, 'plafond-jour');
        // concurrence : 20 demandes en même temps, un seul passage
        await col().deleteMany({});
        const kc = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '10', V2_PHOTO_ADMIN_MAX_JOUR: '400' });
        const tous = await Promise.all(Array.from({ length: 20 }, () => R2.reserver({ cfg: kc, maintenant: t(0) })));
        H.v('1. 20 demandes simultanées sous un intervalle de 10 s : EXACTEMENT une passe (réservation atomique)', [tous.filter(x => x.ok).length, (await col().findOne({})).n], [1, 1]);
        await col().deleteMany({});
        const kp = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '7' });
        const tp = await Promise.all(Array.from({ length: 20 }, () => R2.reserver({ cfg: kp, maintenant: t(0) })));
        H.v('1. 20 demandes simultanées sous un plafond de 7 : EXACTEMENT 7 passent', [tp.filter(x => x.ok).length, (await col().findOne({})).n], [7, 7]);
        // panne de la base : refus, jamais une exception ni un passage
        const casse = { col: () => ({ updateOne: async () => { throw new Error('mongo muet'); }, findOne: async () => { throw new Error('mongo muet'); } }) };
        H.v('1. base muette : refus « erreur », aucune exception', (await R2.reserver({ cfg: kp, maintenant: t(0), colFn: casse.col })).cause, 'erreur');
        await col().deleteMany({});
    });

    // ═══ 2. photo-admin : l'image fournie est conservée SANS téléchargement ═══
    const mem = S.creerStockageMemoire();
    const panne = { ecrire: false };
    const stockage = {
        async verifierBucket() { }, async ecrire(c, b) { if (panne.ecrire) throw new Error('R2 en panne'); return mem.ecrire(c, b); },
        async supprimer(c) { return mem.supprimer(c); }, async lire(c) { return mem.lire(c); }, async lister() { return mem.lister(); }, cles: () => mem.cles()
    };
    const banc = creerBanc({ cfg, env: ENV, stockage });
    registre.fournir('banc', banc);
    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        return { c, obj: { type: 'compte', id: c._id, administrateur: role === 'administrateur', surface: 'extension' } };
    }
    const semer = async (a) => { const _id = oid(); await db.col('analyses').insertOne({ _id, porteur: `compte:${a.c._id}`, surface: 'extension', statut: 'identifiee', cartes: [{ idProduct: null, statut: 'introuvable', raison: 'hors-catalogue', etat: null, question: null, zone: null }], produits: [], facturation: { motif: 'administrateur' }, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5) }); return String(_id); };
    const lire = async id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });
    const CP = require('../banc/photo-admin');
    const appels = { n: 0 };
    const tel = async () => { appels.n++; return img(600, 800); };
    const scanner = (a, scanId, o = {}) => CP.apresIdentifierAdmin({ cfg: o.cfg || cfg, deps: { telechargerPhoto: tel, ...(o.deps || {}) }, req: { entree: { imageUrls: [URL_PHOTO], ...(o.octets ? { imageOctets: o.octets } : {}) }, body: {} }, scanId, porteur: o.porteur || a.obj });
    const ADM = await acteur({ role: 'administrateur' }), USR = await acteur({});
    const repli = () => db.col('photo_admin_repli');

    await essayer('2', async () => {
        const fournie = await img(3000, 4000, { r: 9, g: 99, b: 199 });
        const S1 = await semer(ADM); appels.n = 0; const avant = mem.cles().length;
        const r = await scanner(ADM, S1, { octets: fournie });
        const an = await lire(S1);
        const m = an.photoBanc && await sharp(await mem.lire(an.photoBanc.cle)).metadata();
        H.v('2. administrateur + image fournie : conservée (WebP, ≤ 1600 px, sans EXIF), AUCUN téléchargement, AUCUNE réservation de repli',
            [r, appels.n, mem.cles().length - avant, m && m.format, m && Math.max(m.width, m.height) <= 1600, m && m.exif === undefined, await repli().countDocuments({})], ['ecrit', 0, 1, 'webp', true, true, 0]);
        H.v('2. la ligne `analyses.photoBanc` porte un sha256 de 64 hexadécimaux', /^[0-9a-f]{64}$/.test(an.photoBanc.sha256), true);
        // une URL hors liste blanche n'empêche pas l'image fournie (l'URL n'est pas utilisée)
        const S2 = await semer(ADM);
        const r2 = await CP.apresIdentifierAdmin({ cfg, deps: { telechargerPhoto: tel }, req: { entree: { imageUrls: ['https://exemple.org/p.jpg'], imageOctets: fournie }, body: {} }, scanId: S2, porteur: ADM.obj });
        H.v('2. l\'image fournie est conservée même si la première URL n\'est pas dans la liste blanche (aucun téléchargement n\'est tenté)', [r2, appels.n], ['ecrit', 0]);
        // non-administrateur : rien, jamais
        const S3 = await semer(USR); const av3 = mem.cles().length;
        const inst = { type: 'installation', id: oid(), administrateur: false, surface: 'extension' };
        const ra = await scanner(USR, S3, { octets: fournie }), rb = await scanner(USR, S3, { octets: fournie, porteur: inst });
        const ADM2 = await acteur({ role: 'administrateur' }); const S4 = await semer(ADM2);
        await db.col('comptes').updateOne({ _id: ADM2.c._id }, { $unset: { role: '' } });     // drapeau périmé : le porteur dit administrateur, la base dit le contraire
        const rc = await scanner(ADM2, S4, { octets: fournie });
        H.v('2. compte ordinaire, installation, drapeau périmé, avec image : rien n\'est conservé ni téléchargé (ignore), aucun objet, aucune photoBanc',
            [ra, rb, rc, appels.n, mem.cles().length - av3, (await lire(S3)).photoBanc, (await lire(S4)).photoBanc], ['ignore', 'ignore', 'ignore', 0, 0, undefined, undefined]);
        // stockage en panne : pas d'exception, pas de repli de téléchargement
        const S5 = await semer(ADM); panne.ecrire = true;
        const r5 = await scanner(ADM, S5, { octets: fournie }); panne.ecrire = false;
        H.v('2. stockage en panne avec image fournie : « echec », pas d\'exception, aucun téléchargement de secours', [r5, appels.n, (await lire(S5)).photoBanc], ['echec', 0, undefined]);
    });

    // ═══ 3. photo-admin : sans image, le téléchargement est le REPLI — espacé et plafonné ═══
    await essayer('3', async () => {
        await repli().deleteMany({});
        const k = lireConfig({ ...ENVCFG, V2_PHOTO_ADMIN_INTERVALLE_S: '3600', V2_PHOTO_ADMIN_MAX_JOUR: '400' });
        const A = await acteur({ role: 'administrateur' });
        const S1 = await semer(A), S2 = await semer(A); appels.n = 0;
        const r1 = await scanner(A, S1, { cfg: k }), r2 = await scanner(A, S2, { cfg: k });
        H.v('3. sans image : le 1er scan télécharge et conserve ; le 2e, dans l\'intervalle, ne télécharge RIEN (plafonne), pas de photoBanc', [r1, r2, appels.n, !!(await lire(S1)).photoBanc, (await lire(S2)).photoBanc], ['ecrit', 'plafonne', 1, true, undefined]);
        // un utilisateur ordinaire ne consomme pas le repli
        const n0 = (await repli().findOne({})).n;
        await scanner(USR, await semer(USR), { cfg: k });
        H.v('3. un non-administrateur ne consomme jamais le repli (compteur inchangé)', (await repli().findOne({})).n, n0);
        // plafond du jour
        await repli().deleteMany({});
        const k2 = lireConfig({ ...ENVCFG, V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '2' });
        appels.n = 0; const rs = [];
        for (let i = 0; i < 4; i++) rs.push(await scanner(A, await semer(A), { cfg: k2 }));
        H.v('3. plafond du jour = 2 : deux téléchargements, puis « plafonne » (pas de photo, la carte reste en attente du banc)', [rs, appels.n], [['ecrit', 'ecrit', 'plafonne', 'plafonne'], 2]);
        // une réservation prise puis un téléchargement qui échoue : la réservation reste prise (le plafond compte les TENTATIVES)
        await repli().deleteMany({});
        const S9 = await semer(A);
        const r9 = await scanner(A, S9, { cfg: k2, deps: { telechargerPhoto: async () => { throw new Error('404'); } } });
        H.v('3. un téléchargement en échec consomme quand même la réservation (le plafond borne les requêtes vers Vinted)', [r9, (await repli().findOne({})).n], ['echec', 1]);
        // base du repli muette : pas de téléchargement
        appels.n = 0;
        const r10 = await CP.apresIdentifierAdmin({ cfg: k2, deps: { telechargerPhoto: tel, photoAdmin: { colRepli: () => ({ updateOne: async () => { throw new Error('muet'); }, findOne: async () => { throw new Error('muet'); } }) } }, req: { entree: { imageUrls: [URL_PHOTO] }, body: {} }, scanId: await semer(A), porteur: A.obj });
        H.v('3. compteur du repli illisible : aucun téléchargement (échoue fermé)', [r10, appels.n], ['plafonne', 0]);
    });

    // ═══ 4. le corps JSON : plus grand SEULEMENT pour un scan v2 ═══
    await essayer('4', async () => {
        // (le comportement de l'analyseur de corps est tenu par test-photo-extension-corps.js)
        // index.js : l'analyseur global est celui-là quand la v2 est allumée, l'ancien sinon
        const src = require('fs').readFileSync(require.resolve('../../index.js'), 'utf8');
        H.v('4. index.js : `express.json()` global remplacé par l\'analyseur v2 quand V2 est allumée, intact sinon', [/app\.use\(V2 \? V2\.corpsJson\(\) : express\.json\(\)\)/.test(src), (src.match(/app\.use\(express\.json\(\)\)/g) || []).length], [true, 0]);
    });

    // ═══ 5. l'empreinte d'idempotence ignore la photo ═══
    await essayer('5', async () => {
        const { empreinteDuCorps } = require('../transport/idempotence');
        const base = { contrat: 2, imageUrls: [URL_PHOTO], marche: 'vinted.fr' };
        H.v('5. avec ou sans `photoBase64` (ou avec une autre photo), la même clé d\'idempotence a la MÊME empreinte', [empreinteDuCorps({ ...base, photoBase64: 'AAAA' }) === empreinteDuCorps(base), empreinteDuCorps({ ...base, photoBase64: 'BBBB' }) === empreinteDuCorps({ ...base, photoBase64: 'AAAA' })], [true, true]);
        H.v('5. un autre champ change toujours l\'empreinte', empreinteDuCorps({ ...base, marche: 'vinted.de' }) === empreinteDuCorps(base), false);
    });

    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
