'use strict';
// PHOTO-EXTENSION (recadrage) — les briques sous POST /api/banc/photo : (0) la validation des octets d'image (jamais d'exception, une CAUSE) ; (1) le repli de téléchargement, espacé et plafonné, compté dans la BASE ;
// (2) photo-admin : le repli attend que l'extension ait envoyé sa photo. La route elle-même est dans test-banc-photo.js. Base EN MÉMOIRE ; images SYNTHÉTIQUES (sharp) ; aucun réseau, aucun bucket réel.
const H = require('./_harnais');
const crypto = require('crypto');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const { creerBanc } = require('../banc/routes');
const S = require('../banc/stockage');
const registre = require('../registre');

const ENVCFG = { MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_DELAI_S: '0', V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '100000' };
const cfg = lireConfig(ENVCFG);
const oid = () => new mongoose.Types.ObjectId();
const ENV = { V2_BANC_BUCKET: 'bucket-banc-test', V2_BANC_SEL: 'sel-photo-ext' };
const URL_PHOTO = 'https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg';
const img = (w, h, couleur, f = 'jpeg') => sharp({ create: { width: w, height: h, channels: 3, background: couleur || { r: 200, g: 40, b: 40 } } })[f]().toBuffer();
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.code || e.message)), 'aucune'); } };

(async () => {
    await H.ouvrirBac('test-photo-extension.js'); await M.creerIndex();

    // ═══ 0. la validation des octets ═══
    await essayer('0', async () => {
        const PE = require('../identifier/photo-extension');
        const LIM = cfg.images.photoExtensionOctetsMax;
        H.v('0. borne de taille : 2 Mio (config.images.photoExtensionOctetsMax)', LIM, 2 * 1024 * 1024);
        const jpg = await img(400, 560), png = await img(300, 420, null, 'png'), webp = await img(300, 420, null, 'webp');
        for (const [nom, b, t] of [['jpeg', jpg, 'image/jpeg'], ['png', png, 'image/png'], ['webp', webp, 'image/webp']]) {
            const r = await PE.evaluerOctets(b, { octetsMax: LIM, typeAnnonce: t });
            H.v(`0. ${nom} valide : les mêmes octets, aucune cause`, [Buffer.isBuffer(r.octets) && r.octets.equals(b), r.cause], [true, undefined]);
        }
        const cause = async (b, o = {}) => (await PE.evaluerOctets(b, { octetsMax: LIM, ...o })).cause;
        H.v('0. vide, pas un Buffer (chaîne, undefined) : « format », sans lever', [await cause(Buffer.alloc(0)), await cause('texte'), await cause(undefined)], ['format', 'format', 'format']);
        H.v('0. la borne est inclusive : N octets passent avec octetsMax = N, refusés avec N − 1', [await cause(jpg, { octetsMax: jpg.length }), await cause(jpg, { octetsMax: jpg.length - 1 })], [undefined, 'trop-grosse']);
        const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]), heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(40)]);
        H.v('0. GIF, HEIC, SVG, octets nuls : « format » (jugé sur les OCTETS)', [await cause(gif), await cause(heic), await cause(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), await cause(Buffer.alloc(64))], Array(4).fill('format'));
        H.v('0. un PNG annoncé `image/jpeg` (ou l\'inverse) : « format » ; le type annoncé qui concorde passe', [await cause(png, { typeAnnonce: 'image/jpeg' }), await cause(jpg, { typeAnnonce: 'image/png' }), await cause(png, { typeAnnonce: 'image/png' })], ['format', 'format', undefined]);
        H.v('0. JPEG tronqué, JPEG aux seuls octets magiques : « illisible »', [await cause(jpg.subarray(0, jpg.length >> 1)), await cause(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100, 7)]))], ['illisible', 'illisible']);
        const large = await img(4097, 1, null, 'png'), pixels = await img(4000, 3300, null, 'png'), correcte = await img(4000, 3000, null, 'png'), carree = await img(4096, 2900, null, 'png');
        H.v('0. côté de plus de 4 096 px, plus de 12 millions de pixels : « dimensions » ; 4000 × 3000 (une photo de téléphone) et 4096 × 2900 passent', [await cause(large), await cause(pixels), await cause(correcte), await cause(carree)], ['dimensions', 'dimensions', undefined, undefined]);
        // un PNG entrelacé et un JPEG progressif de 49 Mpx : refusés sur l'EN-TÊTE, avant le décodage complet (le décodage coûtait +180 Mo de mémoire : relecture 1, I2)
        const entrelace = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 3, g: 4, b: 5 } } }).png({ progressive: true }).toBuffer();
        const progressif = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 3, g: 4, b: 5 } } }).jpeg({ progressive: true }).toBuffer();
        for (const [nom, b] of [['PNG entrelacé', entrelace], ['JPEG progressif', progressif]]) {
            const r0 = process.memoryUsage().rss; const c = await cause(b); const dr = (process.memoryUsage().rss - r0) / 1048576;
            H.v(`0. ${nom} de 49 Mpx : « dimensions », sans décodage complet (mémoire < 60 Mo de plus)`, [c, dr < 60], ['dimensions', true]);
        }
        const animeW = await sharp(crypto.randomBytes(64 * 64 * 3 * 3), { raw: { width: 64, height: 192, channels: 3, pageHeight: 64 } }).webp({ loop: 0, delay: [100, 100, 100] }).toBuffer();
        H.v('0. un WebP animé (3 pages) : « illisible » ; un WebP fixe passe', [await cause(animeW), await cause(await img(64, 64, null, 'webp'))], ['illisible', undefined]);
        const trio = await Promise.all([1, 2, 3].map(() => PE.evaluerOctets(jpg, { octetsMax: LIM })));
        H.v('0. trois décodages simultanés => un seul refusé « occupe » (jamais une attente), les deux autres passent', [trio.filter(x => x.cause === 'occupe').length, trio.filter(x => Buffer.isBuffer(x.octets)).length], [1, 2]);
        H.v('0. la place est rendue (même après une image illisible) : les décodages suivants passent', [Buffer.isBuffer((await PE.evaluerOctets(jpg, { octetsMax: LIM })).octets), await cause(jpg.subarray(0, 50)), Buffer.isBuffer((await PE.evaluerOctets(jpg, { octetsMax: LIM })).octets)], [true, 'illisible', true]);
        PE.reinitialiser(); PE.noter('format'); PE.noter('format'); PE.noter('ok');
        H.v('0. les causes sont COMPTÉES (code seul)', PE.compteurs(), { format: 2, ok: 1 });
        const MP = require('../scanner/multipart'), SR = require('../scanner/routes'), src = require('fs').readFileSync(require.resolve('../identifier/photo-extension'), 'utf8');
        H.v('0. l\'analyse d\'image est celle du scanner (exportée, réutilisée), jamais une seconde implémentation', [typeof MP.typeDesOctets, typeof SR.analyserImage, /require\('\.\.\/scanner\/routes'\)/.test(src), /require\('sharp'\)/.test(src)], ['function', 'function', true, false]);
    });

    // ═══ 1. le repli de téléchargement : espacé, plafonné, compté dans la BASE ═══
    await essayer('1', async () => {
        const R = require('../banc/photo-repli');
        const c = (o = {}) => lireConfig({ ...ENVCFG, ...o });
        H.v('1. défauts : 15 s d\'attente, 10 s entre deux téléchargements, 400 par jour UTC', [lireConfig({ MONGODB_BASE: 'test_scratch' }).photoAdmin], [{ delaiS: 15, intervalleS: 10, maxJour: 400 }]);
        let bad = 0; for (const v of ['-1', 'abc', '1.5', '100001']) { try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_MAX_JOUR: v }); } catch { bad++; } }
        for (const v of ['-1', 'x', '3601']) { try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_INTERVALLE_S: v }); } catch { bad++; } }
        for (const v of ['-1', 'x', '301']) { try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_DELAI_S: v }); } catch { bad++; } }
        H.v('1. valeurs illisibles ou hors bornes : configuration invalide (10 sur 10)', bad, 10);
        const col = () => db.col('photo_admin_repli');
        const T0 = new Date('2026-03-10T10:00:00Z'), t = s => new Date(T0.getTime() + s * 1000);
        const k = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '10', V2_PHOTO_ADMIN_MAX_JOUR: '5' });
        const r1 = await R.reserver({ cfg: k, maintenant: t(0) }), r2 = await R.reserver({ cfg: k, maintenant: t(5) }), r3 = await R.reserver({ cfg: k, maintenant: t(10) });
        H.v('1. intervalle : le 1er passe, un 2e 5 s après est refusé « intervalle », un 3e à 10 s passe', [r1.ok, r2.ok, r2.cause, r3.ok], [true, false, 'intervalle', true]);
        H.v('1. le compte est dans la BASE (un seul document), pas dans la mémoire du processus', [await col().countDocuments({}), (await col().findOne({})).n], [1, 2]);
        delete require.cache[require.resolve('../banc/photo-repli')];
        const R2 = require('../banc/photo-repli');
        H.v('1. après un redémarrage (module rechargé) le compteur ne repart pas de zéro', (await R2.reserver({ cfg: k, maintenant: t(12) })).cause, 'intervalle');
        await col().deleteMany({});
        const k2 = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '3' });
        const rs = []; for (let i = 0; i < 5; i++) rs.push(await R2.reserver({ cfg: k2, maintenant: t(i) }));
        H.v('1. plafond du jour : 3 passent, le 4e et le 5e sont refusés « plafond-jour »', rs.map(x => x.ok ? 'ok' : x.cause), ['ok', 'ok', 'ok', 'plafond-jour', 'plafond-jour']);
        const rd = await R2.reserver({ cfg: k2, maintenant: new Date(T0.getTime() + 86400e3) });
        H.v('1. le jour UTC suivant, le compteur repart (n = 1)', [rd.ok, (await col().findOne({})).n, (await col().findOne({})).jour], [true, 1, '2026-03-11']);
        await col().deleteMany({});
        const k3 = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '1' });
        const a = await R2.reserver({ cfg: k3, maintenant: new Date('2026-03-10T23:59:59Z') }), b = await R2.reserver({ cfg: k3, maintenant: new Date('2026-03-10T23:59:59Z') }), d = await R2.reserver({ cfg: k3, maintenant: new Date('2026-03-11T00:00:01Z') });
        H.v('1. frontière de minuit UTC : le plafond de la veille ne bloque pas le lendemain', [a.ok, b.cause, d.ok], [true, 'plafond-jour', true]);
        await col().deleteMany({});
        H.v('1. plafond 0 : le repli est coupé', (await R2.reserver({ cfg: c({ V2_PHOTO_ADMIN_MAX_JOUR: '0' }), maintenant: t(0) })).cause, 'plafond-jour');
        await col().deleteMany({});
        const tous = await Promise.all(Array.from({ length: 20 }, () => R2.reserver({ cfg: c({ V2_PHOTO_ADMIN_INTERVALLE_S: '10', V2_PHOTO_ADMIN_MAX_JOUR: '400' }), maintenant: t(0) })));
        H.v('1. 20 demandes simultanées sous un intervalle de 10 s : EXACTEMENT une passe (réservation atomique)', [tous.filter(x => x.ok).length, (await col().findOne({})).n], [1, 1]);
        await col().deleteMany({});
        const kp = c({ V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '7' });
        const tp = await Promise.all(Array.from({ length: 20 }, () => R2.reserver({ cfg: kp, maintenant: t(0) })));
        H.v('1. 20 demandes simultanées sous un plafond de 7 : EXACTEMENT 7 passent', [tp.filter(x => x.ok).length, (await col().findOne({})).n], [7, 7]);
        const casse = { updateOne: async () => { throw new Error('mongo muet'); }, findOne: async () => { throw new Error('mongo muet'); } };
        H.v('1. base muette : refus « erreur », aucune exception', (await R2.reserver({ cfg: kp, maintenant: t(0), colFn: () => casse })).cause, 'erreur');
        await col().deleteMany({});
    });

    // ═══ 2. photo-admin : le repli attend la photo de l'extension ═══
    const mem = S.creerStockageMemoire();
    const stockage = { async verifierBucket() { }, ecrire: (c, b) => mem.ecrire(c, b), supprimer: c => mem.supprimer(c), lire: c => mem.lire(c), lister: () => mem.lister(), cles: () => mem.cles() };
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
    const lire = id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });
    const CP = require('../banc/photo-admin');
    const appels = { n: 0 };
    const tel = async () => { appels.n++; return img(600, 800); };
    const scanner = (a, scanId, o = {}) => CP.apresIdentifierAdmin({ cfg: o.cfg || cfg, deps: { telechargerPhoto: tel, ...(o.deps || {}) }, req: { entree: { imageUrls: o.urls || [URL_PHOTO] }, body: {} }, scanId, porteur: o.porteur || a.obj });
    const repli = () => db.col('photo_admin_repli');
    const ADM = await acteur({ role: 'administrateur' }), USR = await acteur({});

    await essayer('2', async () => {
        await repli().deleteMany({});
        const k = lireConfig({ ...ENVCFG, V2_PHOTO_ADMIN_DELAI_S: '15' });
        // la photo de l'extension arrive PENDANT l'attente : rien n'est téléchargé
        const S1 = await semer(ADM); appels.n = 0; const attentes = [];
        const arrivee = async ms => { attentes.push(ms); await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(S1) }, { $set: { photoBanc: { cle: 'banc-reel/v2/' + 'c'.repeat(32) + '.webp', sha256: 'd'.repeat(64) } } }); };
        const r1 = await scanner(ADM, S1, { cfg: k, deps: { photoAdmin: { attendre: arrivee } } });
        H.v('2. la photo de l\'extension arrive pendant l\'attente de 15 s : « recu », AUCUN téléchargement, aucune réservation du repli', [r1, attentes, appels.n, await repli().countDocuments({})], ['recu', [15000], 0, 0]);
        // elle n'arrive pas : le repli télécharge, après l'attente
        const S2 = await semer(ADM); const attentes2 = [];
        const r2 = await scanner(ADM, S2, { cfg: k, deps: { photoAdmin: { attendre: async ms => { attentes2.push(ms); } } } });
        H.v('2. elle n\'arrive pas : après l\'attente, UN téléchargement et la photo est conservée', [r2, attentes2, appels.n, !!(await lire(S2)).photoBanc], ['ecrit', [15000], 1, true]);
        // un non-administrateur : on n'attend même pas
        const S3 = await semer(USR); let att = 0;
        const r3 = await scanner(USR, S3, { cfg: k, deps: { photoAdmin: { attendre: async () => { att++; } } } });
        H.v('2. un non-administrateur : « ignore », pas d\'attente, pas de téléchargement', [r3, att, appels.n], ['ignore', 0, 1]);
        // l'URL hors liste blanche : rien
        const S4 = await semer(ADM); appels.n = 0;
        H.v('2. première URL hors liste blanche : « ignore », rien téléchargé', [await scanner(ADM, S4, { cfg: k, urls: ['https://exemple.org/p.jpg'], deps: { photoAdmin: { attendre: async () => { } } } }), appels.n], ['ignore', 0]);
        // le rôle est relu APRÈS l'attente
        const ADM2 = await acteur({ role: 'administrateur' }); const S5 = await semer(ADM2); appels.n = 0;
        const rr = await scanner(ADM2, S5, { cfg: k, deps: { photoAdmin: { attendre: async () => { await db.col('comptes').updateOne({ _id: ADM2.c._id }, { $unset: { role: '' } }); } } } });
        H.v('2. un rôle retiré PENDANT l\'attente : « ignore », rien téléchargé (le rôle est relu après le délai)', [rr, appels.n], ['ignore', 0]);
    });

    // ═══ 3. sans délai : le repli est espacé et plafonné ═══
    await essayer('3', async () => {
        await repli().deleteMany({});
        const k = lireConfig({ ...ENVCFG, V2_PHOTO_ADMIN_INTERVALLE_S: '3600', V2_PHOTO_ADMIN_MAX_JOUR: '400' });
        const A = await acteur({ role: 'administrateur' });
        const S1 = await semer(A), S2 = await semer(A); appels.n = 0;
        const r1 = await scanner(A, S1, { cfg: k }), r2 = await scanner(A, S2, { cfg: k });
        H.v('3. le 1er scan télécharge et conserve ; le 2e, dans l\'intervalle, ne télécharge RIEN (plafonne), pas de photoBanc', [r1, r2, appels.n, !!(await lire(S1)).photoBanc, (await lire(S2)).photoBanc], ['ecrit', 'plafonne', 1, true, undefined]);
        const n0 = (await repli().findOne({})).n;
        await scanner(USR, await semer(USR), { cfg: k });
        H.v('3. un non-administrateur ne consomme jamais le repli', (await repli().findOne({})).n, n0);
        await repli().deleteMany({});
        const k2 = lireConfig({ ...ENVCFG, V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '2' });
        appels.n = 0; const rs = [];
        for (let i = 0; i < 4; i++) rs.push(await scanner(A, await semer(A), { cfg: k2 }));
        H.v('3. plafond du jour = 2 : deux téléchargements, puis « plafonne »', [rs, appels.n], [['ecrit', 'ecrit', 'plafonne', 'plafonne'], 2]);
        await repli().deleteMany({});
        const r9 = await scanner(A, await semer(A), { cfg: k2, deps: { telechargerPhoto: async () => { throw new Error('404'); } } });
        H.v('3. un téléchargement en échec consomme quand même la réservation', [r9, (await repli().findOne({})).n], ['echec', 1]);
        appels.n = 0;
        const r10 = await scanner(A, await semer(A), { cfg: k2, deps: { photoAdmin: { colRepli: () => ({ updateOne: async () => { throw new Error('muet'); }, findOne: async () => { throw new Error('muet'); } }) } } });
        H.v('3. compteur du repli illisible : aucun téléchargement (échoue fermé)', [r10, appels.n], ['plafonne', 0]);
    });

    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
