'use strict';
// ETIQUETAGE-B, tour de correction 1 — ce que la relecture 1/3 a trouvé :
//   I2 une panne MongoDB ne laisse jamais une vérité PÉRIMÉE sans reprise ; I3 le téléchargeur par défaut est tenu (serveur HTTP LOCAL, boucle locale) ;
//   M1 le sel de l'_id ; M2 la reprise ne meurt pas de faim et sort de l'attente avec son motif ; M6 les index ; sha256 de la photo stockée.
// Base EN MÉMOIRE, stockage MÉMOIRE, aucun réseau hors boucle locale, aucun chemin réel.
const H = require('./_harnais');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const { creerBanc } = require('../banc/routes');
const S = require('../banc/stockage');
const { creerCatalogue } = require('../identifier/catalogue');
const registre = require('../registre');
const X = require('../mesures/exporter-banc-admin');
const fs = require('fs'), os = require('os'), path = require('path');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const oid = () => new mongoose.Types.ObjectId();
const BUCKET = 'bucket-banc-test', SEL = 'sel-tour1', ENV = { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL };
const URL_PHOTO = 'https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg';
const photoJpeg = (w = 600, h = 800) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 90, b: 200 } } }).jpeg().toBuffer();
const lignes = () => db.col('banc_lignes').find({}).toArray();
const lire = async id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });
const attendre = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) await attendre(reste + 2000); }
    await H.ouvrirBac('test-banc-etiquette-tour1.js'); await M.creerIndex();
    const reel = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const catalogue = { lire: async ids => reel.lire(ids) };
    for (const [id, nom] of [[4242, 'Pikachu'], [4343, 'Raichu']]) {
        await db.col('catalogue_produits').insertOne({ idProduct: id, name: nom, idMetacard: id });
        await db.col('numeros_cartes').insertOne({ idProduct: id, slugSet: 'Base-Set', numero: String(id % 100) });
    }
    const mem = S.creerStockageMemoire();
    const stockage = { verifierBucket: async () => { }, ecrire: (c, b) => mem.ecrire(c, b), supprimer: c => mem.supprimer(c), lire: c => mem.lire(c), lister: () => mem.lister() };
    // une base qui tombe en panne à la demande POUR LE BANC (toutes ses lectures et écritures, `analyses` comprise : il ne peut alors poser AUCUNE marque lui-même). La route d'étiquetage, elle, écrit par
    // `db.col` : c'est elle seule qui peut poser la marque de reprise, dans la même écriture que l'étiquette.
    const etat = { panne: false };
    const colPanne = n => {
        const vrai = db.col(n);
        return new Proxy(vrai, { get(c, p) { const v = c[p]; return typeof v === 'function' ? (...a) => { if (etat.panne) throw Object.assign(new Error('Mongo HS'), { code: 'MONGO_HS' }); return v.apply(c, a); } : v; } });
    };
    const banc = creerBanc({ cfg, env: ENV, stockage, colFn: colPanne });
    registre.fournir('banc', banc);
    const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
    const app = express(); app.use(express.json());
    const router = express.Router(); monterBanc.routes(router, cfg, { banc, purge: purgeStub, catalogue }); app.use(router);
    const srv = await H.serveur(app);

    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = 'administrateur' } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compteId: c._id, generation: 0 });
        return { c, jeton, porteur: `compte:${c._id}`, obj: { type: 'compte', id: c._id, administrateur: Boolean(role), surface: 'extension' } };
    }
    const CARTES = () => [{ idProduct: 4242, statut: 'identifiee', raison: null, etat: { retenu: 'NM' }, question: null, zone: null }];
    const semer = async (a, o = {}) => { const _id = oid(); await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: 'identifiee', cartes: o.cartes || CARTES(), produits: [], facturation: { motif: 'administrateur' }, versionChaine: 'abc123def456', versionModele: 'gemini-x', creeLe: o.creeLe || new Date(), expireLe: new Date(Date.now() + 864e5), ...(o.plus || {}) }); return String(_id); };
    let nIp = 0; const ip = () => ({ 'x-forwarded-for': `10.15.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}` });
    const post = (a, corps) => H.appel(srv.url, '/api/banc/etiquette', { methode: 'POST', corps, entetes: { authorization: `Bearer ${a.jeton}`, ...ip() } });
    const CP = require('../banc/photo-admin');
    const scanner = (a, scanId, deps = {}, urls = [URL_PHOTO]) => CP.apresIdentifierAdmin({ cfg, deps: { telechargerPhoto: async () => photoJpeg(), ...deps }, req: { entree: { imageUrls: urls }, body: {} }, scanId, porteur: a.obj });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tour1-banc-'));
    const colLecture = n => db.col(n);

    // ═══ I2. une panne MongoDB pendant l'étiquetage : la vérité périmée est REPRISE, et l'export le DIT ═══
    {
        const A = await acteur(); const S1 = await semer(A); await scanner(A, S1);
        let r = await post(A, { scanId: S1, verdict: 'juste', rev: 1 });
        H.v('I2. rev 1 : ligne écrite, vérité 4242', [r.json.banc, (await lignes()).map(l => [l.verite, l.rev])], ['ecrit', [[4242, 1]]]);
        etat.panne = true;
        r = await post(A, { scanId: S1, verdict: 'corrige', idProduct: 4343, rev: 2 });
        etat.panne = false;
        const an = await lire(S1);
        H.v('I2. rev 2 pendant la panne : étiquette écrite, `en-attente`, ET la marque de reprise est posée (atomiquement, avec l\'étiquette)', [r.statut, r.json.etat, r.json.banc, an.cartes[0].etiquetteAdmin.idProduct, an.bancAttente], [200, 'ecrit', 'en-attente', 4343, true]);
        const avant = await X.exporterBancAdmin({ dossier: path.join(tmp, 'avant-reprise'), colFn: colLecture, stockage: { lire: c => mem.lire(c) }, base: 'essai_lecture' });
        const man = JSON.parse(fs.readFileSync(path.join(tmp, 'avant-reprise', 'manifeste.json'), 'utf8'));
        H.v('I2. avant la reprise, l\'export DIT que des étiquettes ne sont pas encore reflétées (la ligne rev 1 n\'est pas présentée comme à jour)', [avant.lignes, man.etiquettesEnAttente], [1, 1]);
        const rep = await banc.reprendreEtiquettes();
        H.v('I2. la reprise réécrit la ligne : vérité 4343, rev 2 ; la marque tombe', [rep.ecrites, (await lignes()).map(l => [l.verite, l.rev]), (await lire(S1)).bancAttente], [1, [[4343, 2]], undefined]);
        await X.exporterBancAdmin({ dossier: path.join(tmp, 'apres-reprise'), colFn: colLecture, stockage: { lire: c => mem.lire(c) }, base: 'essai_lecture' });
        H.v('I2. après la reprise, l\'export ne signale plus rien en attente', JSON.parse(fs.readFileSync(path.join(tmp, 'apres-reprise', 'manifeste.json'), 'utf8')).etiquettesEnAttente, 0);
    }

    // ═══ sha256 de la photo stockée, sur l'analyse ET sur la ligne ═══
    {
        const A = await acteur(); const S1 = await semer(A); await scanner(A, S1);
        const cle = (await lire(S1)).photoBanc.cle;
        const attendu = crypto.createHash('sha256').update(await mem.lire(cle)).digest('hex');
        await post(A, { scanId: S1, verdict: 'juste', rev: 1 });
        const l = (await lignes()).find(x => x.cleR2 === cle);
        H.v('sha256 : l\'empreinte de l\'objet stocké est sur `analyses.photoBanc` et sur la ligne', [(await lire(S1)).photoBanc.sha256, l.sha256], [attendu, attendu]);
    }

    // ═══ M1. le sel de l'_id ═══
    {
        const A = await acteur(); const S1 = await semer(A); await scanner(A, S1);
        await post(A, { scanId: S1, verdict: 'juste', rev: 1 });
        const cle = (await lire(S1)).photoBanc.cle;
        const l = (await lignes()).find(x => x.cleR2 === cle);
        const h = t => crypto.createHash('sha256').update(t).digest('hex');
        H.v('M1. `_id` = sha256(scanId|carte|etiquette-admin|SEL), et pas la même chose SANS sel', [l._id === h(`${S1}|0|etiquette-admin|${SEL}`), l._id === h(`${S1}|0|etiquette-admin|`), l._id === h(`${S1}|0|etiquette-admin|autre-sel`)], [true, false, false]);
    }

    // ═══ I3. le téléchargeur par défaut, sur un serveur HTTP LOCAL ═══
    {
        const hits = {}, infini = { octets: 0 };
        let port = 0;
        const jpeg = await photoJpeg(300, 400);
        const serveur = http.createServer((q, s) => {
            hits[q.url] = (hits[q.url] || 0) + 1;
            if (q.url === '/ok') { s.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpeg.length }); return s.end(jpeg); }
            if (q.url === '/redir') { s.writeHead(302, { location: `http://127.0.0.1:${port}/ok` }); return s.end(); }
            if (q.url === '/gros') { s.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': 6 * 1024 * 1024 }); return s.end(Buffer.alloc(6 * 1024 * 1024)); }
            if (q.url === '/gros-sans-longueur') { s.writeHead(200, { 'content-type': 'image/jpeg' }); for (let i = 0; i < 6; i++) s.write(Buffer.alloc(1024 * 1024)); return s.end(); }
            if (q.url === '/infini') {                       // un flux SANS fin ni longueur annoncée : seul un plafond d'octets côté client l'arrête avant le délai
                s.writeHead(200, { 'content-type': 'image/jpeg' });
                const morceau = Buffer.alloc(1 << 20);
                const boucle = () => { while (!s.destroyed) { infini.octets += morceau.length; if (!s.write(morceau)) { s.once('drain', boucle); return; } } };
                return boucle();
            }
            if (q.url === '/lent') { s.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpeg.length }); return s.write(jpeg.subarray(0, 10)); }   // ne finit jamais
            if (q.url === '/texte') { s.writeHead(200, { 'content-type': 'text/plain', 'content-length': jpeg.length }); return s.end(jpeg); }
            if (q.url === '/faux-octets') { s.writeHead(200, { 'content-type': 'image/jpeg' }); return s.end('pas une image'); }
            s.writeHead(404); s.end();
        });
        await new Promise(r => serveur.listen(0, '127.0.0.1', r)); port = serveur.address().port;
        const A = await acteur();
        const DEPS = { telechargerPhoto: undefined, photoAdmin: { hotes: [/^127\.0\.0\.1$/], protocoles: ['http:'], delaiMs: 400 } };
        const essai = async (chemin, hote = '127.0.0.1') => { const id = await semer(A); const t0 = Date.now(); const r = await scanner(A, id, DEPS, [`http://${hote}:${port}${chemin}`]); return { r, ms: Date.now() - t0, photo: (await lire(id)).photoBanc }; };
        try {
            let x = await essai('/ok');
            H.v('I3. témoin : une image servie par le serveur local est téléchargée et stockée (la mécanique fonctionne)', [x.r, Boolean(x.photo), hits['/ok']], ['ecrit', true, 1]);
            const ok0 = hits['/ok'];
            x = await essai('/redir');
            H.v('I3. une REDIRECTION n\'est pas suivie : rien de stocké, la cible de la redirection n\'est jamais demandée', [x.r, x.photo, hits['/ok'] - ok0], ['echec', undefined, 0]);
            x = await essai('/gros');
            H.v('I3. un corps annoncé de 6 Mo est refusé', [x.r, x.photo], ['echec', undefined]);
            x = await essai('/gros-sans-longueur');
            H.v('I3. un corps de 6 Mo SANS longueur annoncée est coupé et refusé', [x.r, x.photo], ['echec', undefined]);
            x = await essai('/infini');
            H.v('I3. un flux sans fin ni longueur est COUPÉ au plafond (le serveur n\'a pas envoyé 25 Mo) : le plafond d\'octets est tenu par le téléchargement, pas seulement par le décodage', [x.r, x.photo, infini.octets < 25 * 1024 * 1024], ['echec', undefined, true]);
            x = await essai('/lent');
            H.v('I3. un serveur qui ne finit jamais expire (délai injecté 400 ms) : abandon en moins de 3 s, rien de stocké', [x.r, x.ms < 3000, x.photo], ['echec', true, undefined]);
            x = await essai('/texte');
            H.v('I3. un type qui n\'est pas une image (text/plain) est refusé, même si les octets sont une image', [x.r, x.photo], ['echec', undefined]);
            x = await essai('/faux-octets');
            H.v('I3. des octets qui ne sont pas une image sous un type image sont refusés', [x.r, x.photo], ['echec', undefined]);
            const avant = Object.values(hits).reduce((a, b) => a + b, 0);
            x = await essai('/ok', 'localhost');
            H.v('I3. un hôte hors de la liste (localhost, liste = 127.0.0.1) est refusé SANS requête', [x.r, x.photo, Object.values(hits).reduce((a, b) => a + b, 0) - avant], ['ignore', undefined, 0]);
            x = await essai('/ok');
            DEPS.photoAdmin.protocoles = ['https:'];
            const y = await essai('/ok');
            H.v('I3. le protocole est tenu aussi (http refusé quand seul https est admis, sans requête)', [y.r, y.photo], ['ignore', undefined]);
        } finally { serveur.closeAllConnections && serveur.closeAllConnections(); await new Promise(r => serveur.close(r)); }
    }

    // ═══ M2. la reprise : ordre, bornes, sans famine ; les sorties d'attente ont un motif ═══
    {
        const A = await acteur();
        const pending = (extra = {}) => [{ idProduct: 4242, statut: 'identifiee', raison: null, etat: null, question: null, zone: null, etiquetteAdmin: { verdict: 'juste', idProduct: 4242, rev: 1, le: new Date(), versionModele: 'gemini-x', versionChaine: 'abc123def456', ...extra } }];
        const jours = n => new Date(Date.now() - n * 86400e3);
        const cleAbsente = () => S.nouvelleCle(false);
        // trois analyses dont l'objet n'existera jamais, anciennes ; une réparable, récente
        const morts = [];
        for (let i = 0; i < 3; i++) morts.push(await semer(A, { cartes: pending(), creeLe: jours(5 - i), plus: { bancAttente: true, photoBanc: { cle: cleAbsente() } } }));
        const bon = await semer(A, { cartes: pending(), creeLe: jours(0.2), plus: { bancAttente: true } });
        await scanner(A, bon);                                         // la photo naît (sur l'analyse déjà étiquetée)
        const n0 = (await lignes()).length;
        const p1 = await banc.reprendreEtiquettes({ max: 2 });
        const p2 = await banc.reprendreEtiquettes({ max: 2 });
        H.v('M2. bornée à 2 par passe ; les cibles qui échouent toujours ne FAMINENT pas la réparable : écrite à la 2e passe', [p1.ecrites + p1.restantes, (await lignes()).length - n0, (await lire(bon)).bancAttente, (await lire(bon)).cartes[0].etiquetteAdmin.banc], [2, 1, undefined, 'ecrit']);
        void p2;
        // scan SANS photo : sort de l'attente avec son motif une fois le délai passé ; récent : reste en attente
        const sans = await semer(A, { cartes: pending(), creeLe: jours(3), plus: { bancAttente: true } });
        const recent = await semer(A, { cartes: pending(), creeLe: new Date(), plus: { bancAttente: true } });
        await banc.reprendreEtiquettes();
        H.v('M2. scan sans photo depuis plus de 24 h : `sans-photo`, plus d\'attente ; scan récent : reste en attente (la photo peut encore naître)', [(await lire(sans)).cartes[0].etiquetteAdmin.banc, (await lire(sans)).bancAttente, (await lire(recent)).bancAttente], ['sans-photo', undefined, true]);
        // administrateur dont le rôle est retiré : sort de l'attente, et AUCUNE photo n'est gardée
        const B = await acteur(); const SB = await semer(B); await scanner(B, SB);
        const cleB = (await lire(SB)).photoBanc.cle;
        await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(SB) }, { $set: { cartes: pending(), bancAttente: true } });
        await db.col('comptes').updateOne({ _id: B.c._id }, { $unset: { role: '' } });
        await banc.reprendreEtiquettes();
        const aB = await lire(SB);
        H.v('M2. rôle retiré : `role-retire`, plus d\'attente, la photo n\'est plus gardée (ni sur l\'analyse, ni au bucket)', [aB.cartes[0].etiquetteAdmin.banc, aB.bancAttente, aB.photoBanc, mem.cles().includes(cleB)], ['role-retire', undefined, undefined, false]);
    }

    // ═══ M6. les lectures quotidiennes passent par des index ═══
    {
        const idxA = (await db.col('analyses').indexes()).map(i => i.name), idxB = (await db.col('banc_lignes').indexes()).map(i => i.name);
        H.v('M6. index présents : analyses (reprise, filet des orphelins) et banc_lignes (partage d\'un objet par cleR2)', [idxA.includes('analyses_banc_attente'), idxA.includes('analyses_photo_banc'), idxB.includes('banc_lignes_cle')], [true, true, true]);
    }

    await srv.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
