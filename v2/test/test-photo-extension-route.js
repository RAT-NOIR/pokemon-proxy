'use strict';
// PHOTO-EXTENSION — la ROUTE : POST /api/identifier avec le champ `photoBase64` (l'image que l'extension affiche). Base : la base EN MÉMOIRE du banc. Images SYNTHÉTIQUES (du bruit aléatoire encodé par sharp,
// en mémoire) : jamais une vraie photo. La chaîne héritée et le fournisseur de seconde lecture sont FABRIQUÉS ; le stockage du banc est la mémoire ; aucun réseau, aucun appel payant, aucune requête vers Vinted.
// Ce que le banc tient : (1) le scan, sa facturation et sa réponse sont IDENTIQUES avec ou sans le champ, valide ou non (octet pour octet, grand livre compris) ; (2) un champ invalide, trop gros, illisible
// ne fait JAMAIS échouer le scan et sa cause est comptée ; (3) un client ordinaire : l'image ne va qu'à la seconde lecture, JAMAIS conservée (aucune collection, aucun bucket, aucune écriture de fichier),
// JAMAIS journalisée ; (4) un administrateur : conservée par photo-admin SANS téléchargement ; sans image, le téléchargement est un repli espacé ; (5) l'empreinte d'idempotence ignore la photo.
const H = require('./_harnais');
const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
const sharp = require('sharp');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const SL = require('../identifier/seconde-lecture');
const PE = require('../identifier/photo-extension');
const S = require('../banc/stockage');
const { creerBanc } = require('../banc/routes');
const VB = require('./_visuels-banc'); const VIS = [];

const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const cfgOn = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_SECONDE_LECTURE: '1' });
const ORIGINE = cfgOff.origines.extension;
const URL_PHOTO = 'https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg';
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.15.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-photoext-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const ID_P = 896821, ID_J = 896822, EXP = 991021, META = 991121;
const norm = s => String(s).replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
const bruit = (w = 200, h = 280) => sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
const jusque = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-photo-extension-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PRE', apprisLe: new Date() });
    for (const [id, code, numero] of [[ID_P, 'PRE', '162'], [ID_J, 'PAR', '251']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Roaring Moon ex', idExpansion: EXP, idMetacard: META });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero, numeroUrl: `${code}${numero}`, codeSet: code, nomFr: 'Roaring Moon ex', slug: `Roaring-Moon-ex-${code}${numero}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante: 'normale', idMetacard: META }));
    }
    VB.installer(VIS);

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = id => ({ idProduct: id, nom: 'Roaring Moon ex', numero: '162', set: 'Banc Set', prix: 1, photoUrl: null });
    let chaineAppels = 0;
    const chaine = async (req, res) => {
        chaineAppels++;
        return res.json({ success: true, scanId: String(req.scanIdImpose), question: null, etat: ETAT, candidats: [cand(ID_P)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2,
            carte: { idProduct: ID_P, nomProduit: 'Roaring Moon ex', nom: 'Roaring Moon ex', numero: '162', setCode: 'PRE', total: '131', rarete: null, langue: 'FR', ambigu: false } });
    };
    const modele = { appels: [] };
    const fournisseur = async ({ image, compteur }) => { modele.appels.push({ image: Buffer.isBuffer(image) ? image : null }); if (compteur) compteur.appels = (compteur.appels || 0) + 2; return { setCode: 'PRE', numero: '162', essais: [], echec: false, raison: 'factice' }; };
    // le banc réel (stockage MÉMOIRE) et un téléchargeur espion
    const mem = S.creerStockageMemoire(); const ENVBANC = { V2_BANC_BUCKET: 'bucket-banc-test', V2_BANC_SEL: 'sel-photo-route' };
    registre.fournir('banc', creerBanc({ cfg: cfgOn, env: ENVBANC, stockage: mem }));
    const tel = { n: 0 };
    const telechargerPhoto = async () => { tel.n++; return bruit(300, 420); };
    const monter = async (deps = {}, cfgApp = cfgOn) => {
        const app = express(); app.set('trust proxy', true); app.use(require('../transport/corps-json').json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: id => ({ conclu: true, ids: id === ID_P ? [ID_J] : [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), telechargerPhoto, ...deps }));
        app.use((e, q, s, n) => s.status(e.status || 500).json({ erreur: e.type || 'erreur' }));     // 413 de l'analyseur : sans trace dans la sortie du banc
        return H.serveur(app);
    };
    const svSans = await monter({}, cfgOff), svOn = await monter({ secondeLecture: fournisseur }, cfgOn), svOff = await monter({ secondeLecture: fournisseur }, cfgOff);
    async function inst(essais = 3) { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }); await db.col('installations').insertOne(i); return { i, jeton }; }
    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function compte({ role = null } = {}) {
        const email = `a${new mongoose.Types.ObjectId()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compteId: c._id, generation: 0 });
        if (!role) await db.col('comptes').updateOne({ _id: c._id }, { $set: { 'solde.achete': 5 } });
        return { c, jeton };
    }
    const corps = (o = {}) => ({ contrat: 2, imageUrls: [URL_PHOTO], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
    const poster = (sv, jeton, o = {}, cleIdem = cle()) => H.appel(sv.url, '/api/identifier', { methode: 'POST', corps: corps(o), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cleIdem } });
    async function livre(x) {
        const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
        const ins = await raw('installations').findOne({ _id: x.i._id });
        return { essais: ins.essais, net: mv.reduce((s, m) => s + m.delta, 0), mouvements: mv.length, types: mv.map(m => `${m.type}:${m.etat || ''}`).sort() };
    }
    const analyseDe = scanId => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanId) });
    const forme = async scanId => { const a = await analyseDe(scanId); return JSON.stringify({ cles: Object.keys(a).sort(), cartes: a.cartes, produits: a.produits, facturation: a.facturation, statut: a.statut, secondeLecture: a.secondeLecture }); };
    // un scan d'une installation neuve : { x, r, j, scanId }
    const scan = async (sv, o = {}, cleIdem) => { const x = await inst(3); const r = await poster(sv, x.jeton, o, cleIdem); return { x, r, j: r.json || {}, scanId: r.json && r.json.scanId }; };

    const photo = await bruit(), PB = photo.toString('base64'), MARQUEUR = PB.slice(300, 500), SHA = crypto.createHash('sha256').update(photo).digest('hex');

    // ── 1. éteinte ou non, avec ou sans le champ : la MÊME réponse, le MÊME grand livre ──
    {
        SL.reinitialiser(); PE.reinitialiser();
        const ref = await scan(svSans), avec = await scan(svSans, { photoBase64: PB });
        H.v('1a. référence (sans champ) : un scan servi', [ref.r.statut, ref.j.success, ref.j.analyse && ref.j.analyse.cartes[0].statut], [200, true, 'a-trancher']);
        H.v('1b. client ordinaire, seconde lecture non branchée : avec une image valide, la réponse est IDENTIQUE octet pour octet (scanId normalisé), le grand livre aussi, l\'analyse a les mêmes champs',
            [norm(JSON.stringify(avec.j)) === norm(JSON.stringify(ref.j)), JSON.stringify(await livre(avec.x)) === JSON.stringify(await livre(ref.x)), await forme(avec.scanId) === await forme(ref.scanId).then(f => f.replace(ref.scanId, avec.scanId))], [true, true, true]);
        H.v('1c. la cause est comptée : « inutilisee » (l\'image n\'a servi à rien, elle n\'est même pas décodée)', PE.compteurs(), { absente: 1, inutilisee: 1 });
        // identique avec ou sans le champ, pour CHAQUE forme de champ invalide : le scan est servi
        PE.reinitialiser();
        const jpeg = photo, gros = Buffer.alloc(cfgOn.images.photoExtensionOctetsMax + 1, 1); gros[0] = 0xff; gros[1] = 0xd8; gros[2] = 0xff;
        const pixels = await sharp({ create: { width: 8001, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
        const CAS = [
            ['absent', undefined, 'absente'], ['null', null, 'absente'], ['nombre', 12, 'type-invalide'], ['objet', { a: 1 }, 'type-invalide'], ['tableau', [PB], 'type-invalide'],
            ['base64 cassé', '@@@@', 'base64-invalide'], ['préfixe data:', `data:image/jpeg;base64,${PB}`, 'base64-invalide'], ['vide', '', 'base64-invalide'],
            ['trop gros', gros.toString('base64'), 'trop-grosse'], ['GIF', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]).toString('base64'), 'format'],
            ['JPEG tronqué', jpeg.subarray(0, jpeg.length >> 2).toString('base64'), 'illisible'], ['trop large', pixels.toString('base64'), 'dimensions']
        ];
        const noms = [], refs = [];
        for (const [nom, v, cause] of CAS) {
            const s = await scan(svOn, v === undefined ? {} : { photoBase64: v });
            const n0 = noms.length; noms.push(nom);
            refs.push([nom, s.r.statut, s.j.success, norm(JSON.stringify(s.j)).length > 0, (await livre(s.x)).essais, modele.appels.length ? modele.appels[modele.appels.length - 1].image : 'sans-appel', cause]);
            void n0;
        }
        H.v('1d. douze formes de champ (absent, null, nombre, objet, tableau, base64 cassé, préfixe data:, vide, trop gros, GIF, JPEG tronqué, trop large) : TOUTES servies (200, success), un crédit pris, JAMAIS d\'image donnée au modèle',
            refs.map(x => [x[1], x[2], x[4], x[5] === null || x[5] === 'sans-appel' || x[5] === false]), refs.map(() => [200, true, 2, true]));
        const attendu = {}; for (const [, , c] of CAS) attendu[c] = (attendu[c] || 0) + 1;
        H.v('1e. les causes sont comptées, une par scan', PE.compteurs(), attendu);
        // même réponse que la référence pour un champ invalide
        const inv = await scan(svSans, { photoBase64: 'pas du base64 !!' });
        H.v('1f. un champ invalide : réponse et grand livre IDENTIQUES à la référence', [norm(JSON.stringify(inv.j)) === norm(JSON.stringify(ref.j)), JSON.stringify(await livre(inv.x)) === JSON.stringify(await livre(ref.x))], [true, true]);
    }

    // ── 2. client ordinaire, seconde lecture branchée : l'image va au modèle, sous `image`, et nulle part ailleurs ──
    {
        SL.reinitialiser(); PE.reinitialiser(); modele.appels.length = 0;
        const ecritures = []; const sauve = {};
        for (const n of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'copyFile', 'copyFileSync', 'rename', 'renameSync']) { sauve[n] = fs[n]; fs[n] = function (...a) { ecritures.push(`${n}:${String(a[0]).slice(0, 80)}`); return sauve[n].apply(this, a); }; }
        const sauveP = { writeFile: fs.promises.writeFile, appendFile: fs.promises.appendFile }; for (const n of Object.keys(sauveP)) fs.promises[n] = function (...a) { ecritures.push(`promises.${n}:${String(a[0]).slice(0, 80)}`); return sauveP[n].apply(this, a); };
        const journaux = []; const sauveC = {}; for (const n of ['log', 'error', 'warn', 'info', 'debug']) { sauveC[n] = console[n]; console[n] = (...a) => { journaux.push(a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); }; }
        let avec, sans, avantObjets;
        try { avantObjets = mem.cles().length; sans = await scan(svOn); avec = await scan(svOn, { photoBase64: PB }); }
        finally { for (const n of Object.keys(sauve)) fs[n] = sauve[n]; for (const n of Object.keys(sauveP)) fs.promises[n] = sauveP[n]; for (const n of Object.keys(sauveC)) console[n] = sauveC[n]; }
        H.v('2a. seconde lecture branchée : SANS image le modèle reçoit image: null ; AVEC image il reçoit EXACTEMENT les octets envoyés (un Buffer)', [modele.appels[0].image, Buffer.isBuffer(modele.appels[1].image) && modele.appels[1].image.equals(photo)], [null, true]);
        H.v('2b. la réponse et le grand livre sont identiques avec ou sans image (la seconde lecture confirme dans les deux cas : même affirmation)', [norm(JSON.stringify(avec.j)) === norm(JSON.stringify(sans.j)), JSON.stringify(await livre(avec.x)) === JSON.stringify(await livre(sans.x)), avec.j.analyse.cartes[0].statut], [true, true, 'identifiee']);
        const toutes = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
        const trouvees = [];
        for (const { name } of toutes) { const docs = await mongoose.connection.db.collection(name).find({}).toArray(); const t = JSON.stringify(docs); if (t.includes(MARQUEUR) || t.includes(SHA) || t.includes('photoBase64')) trouvees.push(name); }
        H.v(`2c. client ordinaire : l'image n'est dans AUCUNE des ${toutes.length} collections de la base (ni les octets en base64, ni leur sha256, ni le nom du champ), ni dans le bucket du banc`, [trouvees, mem.cles().length - avantObjets], [[], 0]);
        H.v('2d. aucune écriture de fichier pendant les deux scans', ecritures, []);
        const brut = journaux.join('\n');
        H.v('2e. rien dans le journal : ni l\'image, ni son sha256, ni le nom du champ, ni « data: » ; la seule ligne est le code « ok »', [brut.includes(MARQUEUR), brut.includes(SHA), brut.includes('photoBase64'), brut.includes('data:image'), journaux.filter(l => l.includes('photo-extension'))], [false, false, false, false, ['📷 [v2 photo-extension] ok']]);
        H.v('2f. le compteur : un « ok »', PE.compteurs(), { absente: 1, ok: 1 });
        // la seconde lecture éteinte (cfgOff) avec un fournisseur : l'image n'est pas décodée, le modèle n'est pas appelé
        modele.appels.length = 0; PE.reinitialiser();
        await scan(svOff, { photoBase64: PB });
        H.v('2g. seconde lecture ÉTEINTE (V2_SECONDE_LECTURE=0) : l\'image n\'est pas décodée (« inutilisee »), le modèle n\'est pas appelé', [PE.compteurs(), modele.appels.length], [{ inutilisee: 1 }, 0]);
        // le compte ordinaire (pas une installation seule) : pareil
        const U = await compte({}); modele.appels.length = 0;
        const ru = await H.appel(svOn.url, '/api/identifier', { methode: 'POST', corps: corps({ photoBase64: PB }), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${U.jeton}`, 'idempotency-key': cle() } });
        await new Promise(r => setTimeout(r, 300));
        H.v('2h. compte ordinaire avec image : servi, rien téléchargé, rien conservé au banc, l\'image au modèle seulement', [ru.statut, tel.n, mem.cles().length - avantObjets, modele.appels.map(a => Buffer.isBuffer(a.image))], [200, 0, 0, [true]]);
        if (ru.statut !== 200) console.log(`   (détail 2h : ${JSON.stringify(ru.json).slice(0, 300)})`);
    }

    // ── 3. l'idempotence : la même clé rejouée avec ou sans l'image est un rejeu, pas un conflit ──
    {
        const x = await inst(3), k = cle();
        const a = await poster(svSans, x.jeton, { photoBase64: PB }, k), b = await poster(svSans, x.jeton, {}, k), c = await poster(svSans, x.jeton, { photoBase64: 'autre' }, k);
        H.v('3. même Idempotency-Key : avec image, sans image, avec une autre image => la MÊME réponse, un seul débit (aucun 422 « clé réutilisée »)', [a.statut, b.statut, c.statut, norm(JSON.stringify(b.json)) === norm(JSON.stringify(a.json)), norm(JSON.stringify(c.json)) === norm(JSON.stringify(a.json)), (await livre(x)).mouvements], [200, 200, 200, true, true, 1]);
        const d = await poster(svSans, x.jeton, { marche: 'vinted.de' }, k);
        H.v('3. une autre requête sous la même clé reste un 422', d.statut, 422);
    }

    // ── 4. un corps de plus de 4 Mio est refusé par l'analyseur (413), AVANT le scan : rien n'est débité ──
    {
        const x = await inst(3);
        const r = await poster(svSans, x.jeton, { photoBase64: 'A'.repeat(5 * 1024 * 1024) });
        H.v('4. corps > 4 Mio : 413, aucun crédit pris (la borne de l\'image est 2 Mio : l\'extension ne doit pas envoyer plus)', [r.statut, (await livre(x)).mouvements], [413, 0]);
        const y = await inst(3);
        const n0 = PE.compteurs()['trop-grosse'] || 0;
        const r2 = await poster(svOn, y.jeton, { photoBase64: 'A'.repeat(3 * 1024 * 1024) });
        H.v('4. image de 2,25 Mio décodés (corps de 3 Mio, sous les 4) : le scan est SERVI, l\'image est « trop-grosse » (traitée comme absente)', [r2.statut, r2.json && r2.json.success, (await livre(y)).essais, (PE.compteurs()['trop-grosse'] || 0) - n0], [200, true, 2, 1]);
    }

    // ── 5. l'administrateur : l'image fournie est conservée sans téléchargement ; sans image, le repli est espacé ──
    {
        const A = await compte({ role: 'administrateur' });
        const post = (o) => H.appel(svOn.url, '/api/identifier', { methode: 'POST', corps: corps(o), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${A.jeton}`, 'idempotency-key': cle() } });
        await raw('photo_admin_repli').deleteMany({}); tel.n = 0; const avant = mem.cles().length;
        const sans = await post({});
        await jusque(async () => (await analyseDe(sans.json.scanId)).photoBanc);
        H.v('5a. administrateur SANS image : repli — un téléchargement, une photo conservée', [sans.statut, tel.n, mem.cles().length - avant, !!(await analyseDe(sans.json.scanId)).photoBanc], [200, 1, 1, true]);
        const sans2 = await post({});
        await new Promise(r => setTimeout(r, 400));
        H.v('5b. un second scan SANS image, dans les 10 s : aucun téléchargement, aucune photo (la carte reste « en-attente » du banc), le scan est servi', [sans2.statut, sans2.json.success, tel.n, (await analyseDe(sans2.json.scanId)).photoBanc], [200, true, 1, undefined]);
        const journaux = []; const sauveC = {}; for (const n of ['log', 'error', 'warn', 'info', 'debug']) { sauveC[n] = console[n]; console[n] = (...a) => { journaux.push(a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); }; }
        let avec;
        try { avec = await post({ photoBase64: PB }); await jusque(async () => (await analyseDe(avec.json.scanId)).photoBanc); await new Promise(r => setTimeout(r, 200)); }
        finally { for (const n of Object.keys(sauveC)) console[n] = sauveC[n]; }
        const brutAdmin = journaux.join('\n');
        H.v('5c bis. administrateur avec image : rien dans le journal (ni l\'image, ni son sha256, ni le nom du champ)', [brutAdmin.includes(MARQUEUR), brutAdmin.includes(SHA), brutAdmin.includes('photoBase64'), journaux.some(l => l.includes('photo-extension') && l !== '📷 [v2 photo-extension] ok')], [false, false, false, false]);
        const an = await analyseDe(avec.json.scanId);
        H.v('5c. administrateur AVEC image, dans l\'intervalle du repli : conservée (un objet WebP), AUCUN téléchargement, le repli n\'est pas consommé', [avec.statut, tel.n, mem.cles().length - avant, !!an.photoBanc, (await raw('photo_admin_repli').findOne({})).n], [200, 1, 2, true, 1]);
        const m = await sharp(await mem.lire(an.photoBanc.cle)).metadata();
        H.v('5d. l\'objet est un WebP sans EXIF, et la réponse du scan ne porte ni photoBanc ni l\'image', [m.format, m.exif === undefined, JSON.stringify(avec.json).includes('photoBanc'), JSON.stringify(avec.json).includes(MARQUEUR)], ['webp', true, false, false]);
        H.v('5e. la réponse d\'un administrateur est la même avec ou sans image (scanId normalisé)', norm(JSON.stringify(avec.json)) === norm(JSON.stringify(sans.json)), true);
        // image invalide d'un administrateur : traitée comme absente, le repli la remplace (ici refusé : intervalle)
        const inv = await post({ photoBase64: 'pas du base64' });
        await new Promise(r => setTimeout(r, 400));
        H.v('5f. administrateur avec une image INVALIDE : le scan est servi ; traitée comme absente (repli refusé par l\'intervalle : pas de téléchargement)', [inv.statut, inv.json.success, tel.n], [200, true, 1]);
        const mv = await raw('mouvements').find({ compteId: A.c._id }).toArray();
        H.v('5g. un administrateur ne débite rien (somme des deltas nulle, aucun débit réel)', [mv.reduce((s, m) => s + (m.delta || 0), 0), mv.filter(m => m.type === 'debit' && m.delta).length], [0, 0]);
    }

    // ── 6. TOUR 1 (I1 de la relecture 1) : un corps SANS contrat: 2 de plus de 100 ko ne passe pas — la route héritée ne voit jamais un `title` plus gros qu'avant ──
    {
        const x = await inst(3); const avant = chaineAppels;
        const r = await poster(svOn, x.jeton, { contrat: undefined, title: 'a'.repeat(3 * 1024 * 1024) });
        H.v('6. `title` de 3 Mio SANS contrat: 2 (la route héritée) : 413, la chaîne n\'est pas appelée, aucun crédit pris', [r.statut, chaineAppels - avant, (await livre(x)).mouvements], [413, 0, 0]);
        const r2 = await poster(svOn, x.jeton, { title: 'a'.repeat(3 * 1024 * 1024) });
        H.v('6. et le même `title` AVEC contrat: 2 est borné à 300 caractères par la validation (le scan est servi) — le grand corps ne sert que le contrat 2', [r2.statut, r2.json && r2.json.success], [200, true]);
    }

    // ── 6 bis. TOUR 1 (B1, point c) : le défaut de production juge le jeton EN BASE avant de lire le grand corps ; une installation révoquée ne lit pas 4 Mio ──
    {
        const grosse = (await bruit(400, 560)).toString('base64');
        const vive = await inst(3), revoquee = await inst(3);
        await raw('installations').updateOne({ _id: revoquee.i._id }, { $set: { revoqueeLe: new Date() } });
        const rv = await poster(svSans, vive.jeton, { photoBase64: grosse }), rr = await poster(svSans, revoquee.jeton, { photoBase64: grosse });
        H.v('6 bis. corps de plus de 100 ko : une installation VIVANTE est servie (200) ; une installation RÉVOQUÉE est refusée avant lecture (413, pas le 401 de la route)', [grosse.length > 100 * 1024, rv.statut, rr.statut], [true, 200, 413]);
    }

    // ── 7. TOUR 1 (I1 de la relecture 2) : la phrase vraie est « identique tant que la seconde lecture est éteinte (ou neutre) ; allumée, l'image peut permettre une CONFIRMATION » ──
    {
        const sensible = async ({ image, compteur }) => { modele.appels.push({ image: Buffer.isBuffer(image) ? image : null }); if (!Buffer.isBuffer(image)) return { sansImage: true }; if (compteur) compteur.appels = (compteur.appels || 0) + 2; return { setCode: 'PRE', numero: '162', essais: [], echec: false, raison: 'factice' }; };
        const neutre = async () => ({ setCode: null, numero: null, essais: [], echec: false, raison: 'factice' });
        const svSens = await monter({ secondeLecture: sensible }, cfgOn), svNeutre = await monter({ secondeLecture: neutre }, cfgOn);
        const sans = await scan(svSens), avec = await scan(svSens, { photoBase64: PB });
        const reste = (j) => { const c = JSON.parse(JSON.stringify(j)); delete c.facturation; delete c.analyse.cartes; delete c.analyse.statut; delete c.scanId; return JSON.stringify(c); };
        H.v('7. fournisseur SENSIBLE à l\'image (ne confirme qu\'avec elle) : sans image la question reste (a-trancher, crédit RÉSERVÉ) ; avec image une affirmation (identifiee, crédit DÉBITÉ)',
            [sans.j.analyse.cartes[0].statut, avec.j.analyse.cartes[0].statut, sans.j.facturation.reserve, avec.j.facturation.debite, avec.j.facturation.motif], ['a-trancher', 'identifiee', 1, 1, 'affirmee']);
        H.v('7. et c\'est la SEULE différence : tout le reste de la réponse (hors analyse.cartes, analyse.statut, facturation, scanId) est identique, le solde aussi', [reste(avec.j) === reste(sans.j), JSON.stringify(avec.j.solde) === JSON.stringify(sans.j.solde)], [true, true]);
        const ns = await scan(svNeutre), na = await scan(svNeutre, { photoBase64: PB });
        H.v('7. fournisseur NEUTRE (ne confirme jamais) : avec et sans image, réponse et grand livre IDENTIQUES', [norm(JSON.stringify(na.j)) === norm(JSON.stringify(ns.j)), JSON.stringify(await livre(na.x)) === JSON.stringify(await livre(ns.x))], [true, true]);
        await svSens.fermer(); await svNeutre.fermer();
    }

    await svSans.fermer(); await svOn.fermer(); await svOff.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
