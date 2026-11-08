'use strict';
// BANC-TELEPHONE, tour de correction 1 : le lot (G1, M4), l'analyseur de 8 Ko (M1), la base de l'essai (M2), les limites (M3), et les règles de jugement de la page (M5 à M9, m1, m3), rejouées sous node
// sur public/verdict.mjs (fonctions pures). Aucun réseau, aucune lecture hors du dépôt.
const H = require('./_harnais');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { pathToFileURL } = require('url');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const routes = require('../banc-telephone/routes');
const S = require('../banc-telephone/stockage');
const corps = require('../banc-telephone/corps');

const PUB = path.join(__dirname, '..', 'banc-telephone', 'public');
const SHA = 'a'.repeat(64);
const ENV = { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', V2_VISUELS_R2_COMPTE: 'moncompte123' };
const cfg = { ...lireConfig({ MONGODB_BASE: 'test_scratch' }), modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: SHA, octets: 118202501 } };
const DEPS = { nomBaseBancTelephone: 'test_scratch', baseAttendueBancTelephone: 'test_scratch', ipHeureBancTelephone: 1000, globalHeureBancTelephone: 100000 };
const doc = (o = {}) => ({ v: 1, runId: '0123456789abcdef', modeleSha: SHA, ua: 'Mozilla/5.0 test', isole: true, coeurs: 6, gpuDispo: false, gpu: null, shaVerifie: true,
    mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', fils: 3, nEmpreintes: 30, cosMin: 0.9999987, gardeExtension: 'PASSE', ecartChaineModele: 1e-6, webgpuUtilise: null, erreur: null }, ...o });
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) await new Promise(r => setTimeout(r, reste + 2000)); }
    await H.ouvrirBac('test-banc-telephone-tour1.js'); await M.creerIndex();
    const defaire = H.fixerHorlogeMilieu();
    const V = await import(pathToFileURL(path.join(PUB, 'verdict.mjs')).href);

    // ═══ le service de l'essai : UNE définition (v2/config.js, L1), importée par la garde ═══
    {
        const cfgMod = require('../config'), G = require('../banc-telephone/garde');
        H.v('L1. SERVICE_ESSAI de la garde du banc téléphone = celui de v2/config.js (importé, et égal à la valeur de l\'essai)', [G.SERVICE_ESSAI === cfgMod.SERVICE_ESSAI, G.SERVICE_ESSAI], [true, 'srv-db7ticgm7kps73crjibg']);
        H.v('L1. la garde accepte exactement ce service-là', [G.lire({ ...ENV, RENDER_SERVICE_ID: cfgMod.SERVICE_ESSAI }).actif, G.lire({ ...ENV, RENDER_SERVICE_ID: cfgMod.SERVICE_ESSAI + 'x' }).actif], [true, false]);
    }

    // ═══ G1 / M4 : le lot ═══
    {
        const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
        const cles = lot.cartes.map(c => c.cle), sha1 = c => crypto.createHash('sha1').update(c).digest('hex');
        H.v('G1. aucune des deux cartes qui étaient les visuels-réponse du banc eBay (artofpkm/156/60.webp) et de la calibration (artofpkm/274/25.webp)', [cles.includes('artofpkm/156/60.webp'), cles.includes('artofpkm/274/25.webp')], [false, false]);
        H.v('G1. ni leurs noms de fichier (sha1 de la clé 447bfdfd5781…, 7c1e5796abaa…)', lot.cartes.filter(c => /447bfdfd5781|7c1e5796abaa/.test(c.origine)).length, 0);
        H.v('G1. le lot dit ses exclusions : garde-juges, banc eBay, calibration chargés (comptes non vides) et 0 recoupement', [lot.exclusions.gardeJuges > 100, lot.exclusions.banc > 1000, lot.exclusions.calibration > 500, lot.exclusions.recoupement], [true, true, true, 0]);
        H.v('G1. la clé de chaque carte donne bien son nom de fichier (origine = sha1(cle).webp)', lot.cartes.every(c => c.origine === `catalogue:${sha1(c.cle)}.webp`), true);
        H.v('M4. par carte : clé source, sha256 du visuel, idProduct, nom, idExpansion', [lot.cartes.every(c => /^[a-z0-9-]+\/[^/]+\/.+\.webp$/.test(c.cle) && /^[0-9a-f]{64}$/.test(c.sha256Visuel)), lot.cartes.filter(c => Number.isInteger(c.idProduct) && typeof c.nom === 'string' && Number.isInteger(c.idExpansion)).length >= 25], [true, true]);
        H.v('M4. versions du natif : onnxruntime, Pillow, numpy, python', ['onnxruntime', 'pillow', 'numpy', 'python'].every(k => typeof lot.natif[k] === 'string' && lot.natif[k].length > 0), true);
        H.v('G1/M4. 30 cartes distinctes (clés distinctes)', new Set(cles).size, 30);
    }

    // ═══ M1 : l'analyseur de 8 Ko ═══
    {
        const vu = { global: 0 };
        const app = express();
        app.use((req, res, next) => { res.on('finish', () => { vu.octetsLus = req.socket.bytesRead; }); next(); });     // ce que le serveur a LU de la socket quand il a répondu
        app.use(corps.analyseur());
        app.use((req, res, next) => { if (!req._body) vu.global++; next(); });     // l'analyseur global lirait ici (il saute un corps déjà lu)
        app.use(express.json());
        const router = express.Router(); monterBanc.routes(router, cfg, { banc: {}, purge: { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) }, envBancTelephone: ENV, ...DEPS }); app.use(router);
        app.use((err, req, res, next) => res.status(err.status || 500).json({ success: false, statut: err.type || null }));
        const srv = await H.serveur(app); const port = Number(new URL(srv.url).port);
        const brut = (chemin, morceaux, entetes = {}) => new Promise((resolve, reject) => {
            const r = http.request({ host: '127.0.0.1', port, path: chemin, method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, agent: false }, res => { const m = []; res.on('data', c => m.push(c)); res.on('end', () => resolve({ statut: res.statusCode, corps: Buffer.concat(m).toString('utf8') })); });
            r.on('error', e => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve({ statut: 0, corps: '' }) : reject(e)));
            let i = 0; const suite = () => { if (i < morceaux.length) { r.write(morceaux[i++], suite); } else r.end(); }; suite();
        });
        const gros = n => Buffer.from('{"v":1,"x":"' + 'x'.repeat(n) + '"}');
        const decoupe = (b, t) => { const o = []; for (let i = 0; i < b.length; i += t) o.push(b.subarray(i, i + t)); return o; };
        let r = await brut('/api/banc/telephone/resultat', decoupe(gros(50 * 1024), 4096));                  // 50 Ko, en morceaux, SANS Content-Length (chunked)
        H.v('M1. 50 Ko en morceaux (chunked, sans Content-Length) ⇒ 413', r.statut, 413);
        vu.octetsLus = 0;
        await brut('/api/banc/telephone/resultat', decoupe(gros(4 * 1024 * 1024), 65536));                          // 4 Mo en morceaux de 64 Ko
        H.vrai(`M1. 4 Mo en morceaux : le serveur n'a PAS tout lu — ${vu.octetsLus} octets tirés de la socket sur ~4 194 000 envoyés (body-parser seul les aurait tous lus)`, vu.octetsLus > 0 && vu.octetsLus < 1.5 * 1024 * 1024);
        const g50 = gros(50 * 1024);
        r = await brut('/api/banc/telephone/resultat', [g50], { 'content-length': String(g50.length) });
        H.v('M1. 50 Ko annoncés par Content-Length ⇒ 413 (sans lire le corps)', r.statut, 413);
        r = await brut('/api/banc/telephone/resultat', [gros(9000)], { 'content-length': String(gros(9000).length) });
        H.v('M1. 9 Ko ⇒ 413', r.statut, 413);
        r = await brut('/api/banc/telephone/resultat', [Buffer.from(JSON.stringify(doc()))]);
        H.v('M1. un document légitime passe toujours (201)', r.statut, 201);
        H.v('M1. l\'analyseur global ne lit RIEN de ce chemin (le corps est déjà lu par l\'analyseur de 8 Ko)', vu.global, 0);
        r = await brut('/api/banc/ailleurs', [gros(50 * 1024)]);
        H.v('M1. un AUTRE chemin n\'est pas pris par l\'analyseur de 8 Ko : il arrive au global (compté ici : 1) et la route inexistante répond 404', [r.statut, vu.global], [404, 1]);
        await srv.fermer();
    }

    // ═══ tour 2, mineur : l'analyseur de 8 Ko compare le chemin SANS CASSE et SANS barre finale (Express route ainsi) ═══
    {
        const mw = corps.analyseur();
        const essai = (chemin, methode = 'POST') => { const r = { statut: null, suite: false }; const res = { headersSent: false, setHeader() { }, once() { }, status(s) { r.statut = s; return this; }, json() { this.headersSent = true; return this; } };
            mw({ method: methode, path: chemin, headers: { 'content-type': 'text/plain' }, socket: {}, on() { }, removeListener() { } }, res, () => { r.suite = true; }); return r; };
        for (const c of ['/api/banc/telephone/resultat', '/api/banc/telephone/Resultat', '/api/banc/telephone/RESULTAT', '/api/banc/telephone/resultat/', '/API/Banc/Telephone/Resultat//'])
            H.v(`tour 2. analyseur : ${c} est pris (type non JSON ⇒ 415, la route n'est pas atteinte)`, [essai(c).statut, essai(c).suite], [415, false]);
        for (const c of ['/api/banc/telephone/resultats', '/api/banc/telephone', '/api/banc/telephone/resultat/x', '/ping']) H.v(`tour 2. analyseur : ${c} n'est PAS pris (passe au suivant)`, essai(c).suite, true);
        H.v('tour 2. analyseur : un GET sur le chemin passe au suivant', essai('/api/banc/telephone/resultat', 'GET').suite, true);
    }

    // ═══ M2 : la base de l'essai, par son nom ═══
    {
        const sonde = []; const ecrire = console.error; console.error = (...a) => { sonde.push(a.join(' ')); };
        const r1 = express.Router(), r2 = express.Router(), r3 = express.Router(), r4 = express.Router();
        const m1 = routes.monter(r1, cfg, { envBancTelephone: ENV, nomBaseBancTelephone: 'test' });
        const m2 = routes.monter(r2, cfg, { envBancTelephone: ENV, nomBaseBancTelephone: '' });
        const m3 = routes.monter(r3, cfg, { envBancTelephone: { ...ENV, MONGODB_BASE: 'rm_essai' } });
        const m4 = routes.monter(r4, cfg, { envBancTelephone: { ...ENV, MONGODB_BASE: 'rm_essai ' } });
        console.error = ecrire;
        H.v('M2. base « test » (la production) : non monté, aucune route', [m1, r1.stack.length], [false, 0]);
        H.v('M2. base absente : non monté', [m2, r2.stack.length], [false, 0]);
        H.v('M2. MONGODB_BASE=rm_essai (lu dans l\'environnement injecté) : monté', [m3, r3.stack.length], [true, 12]);
        H.v('M2. « rm_essai » avec une espace de fin : tolérée par la lecture (comme index.js), montée', m4, true);
        H.vrai('M2. le refus est DIT au démarrage (nomme la base trouvée et celle attendue)', sonde.some(l => /NON MONTÉ/.test(l) && /« test »/.test(l) && /« rm_essai »/.test(l)) && sonde.some(l => /MONGODB_BASE absente/.test(l)));
        const coll = { insertOne: async () => { throw new Error('ne devait pas écrire'); }, countDocuments: async () => 0 };
        let code = null; try { await S.stocker({ n: 1 }, { collection: coll, nomBase: 'test' }); } catch (e) { code = e.code; }
        H.v('M2. stocker refuse la base « test » AVANT toute écriture', code, 'BASE_REFUSEE');
        code = null; try { await S.stocker({ n: 1 }, { collection: coll, nomBase: null }); } catch (e) { code = e.code; }
        H.v('M2. stocker refuse un nom de base illisible', code, 'BASE_REFUSEE');
        code = null; try { await S.stocker({ n: 1 }, { collection: coll }); } catch (e) { code = e.code; }
        H.v('M2. par défaut, la base lue sur la connexion (test_scratch ici) n\'est pas rm_essai : refusée', code, 'BASE_REFUSEE');
        // la route : base lue au montage = attendue, mais la CONNEXION porte un autre nom ⇒ 503 et rien d'écrit
        const app = express(); app.use(express.json()); const rt = express.Router();
        routes.monter(rt, cfg, { envBancTelephone: ENV, nomBaseBancTelephone: 'rm_essai', ipHeureBancTelephone: 1000, globalHeureBancTelephone: 100000 }); app.use(rt);
        const s = await H.serveur(app); const avant = await db.col('banc_telephone').countDocuments({});
        const sonde2 = []; console.error = (...a) => { sonde2.push(a.join(' ')); };
        const x = await fetch(s.url + '/api/banc/telephone/resultat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc()) });
        console.error = ecrire;
        H.v('M2. montée sur rm_essai mais la connexion est test_scratch : le dépôt est refusé (503) et RIEN n\'est écrit', [x.status, await db.col('banc_telephone').countDocuments({}) - avant], [503, 0]);
        await s.fermer();
    }

    // ═══ M3 : l'IP regroupée et le plafond global ═══
    {
        const monterIp = async (deps) => { const app = express(); app.set('trust proxy', true); app.use(express.json()); const rt = express.Router(); routes.monter(rt, cfg, { envBancTelephone: ENV, ...DEPS, ...deps }); app.use(rt); return H.serveur(app); };
        const poster = (s, ip) => fetch(s.url + '/api/banc/telephone/resultat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(doc()) }).then(r => r.status);
        await db.col('limites').deleteMany({});
        let s = await monterIp({ ipHeureBancTelephone: 2 });
        const codes = [await poster(s, '2001:db8:1:2::1'), await poster(s, '2001:db8:1:2::2'), await poster(s, '2001:db8:1:2:ffff::9'), await poster(s, '2001:db8:1:100::1'), await poster(s, '203.0.113.7')];
        H.v('M3. IPv6 regroupée par /56 (ipKeyGenerator) : des adresses d\'un même /56 partagent un compteur (3e refusée) ; un autre /56 compte à part ; une IPv4 aussi', codes, [201, 201, 429, 201, 201]);
        await s.fermer(); await db.col('limites').deleteMany({});
        s = await monterIp({ ipHeureBancTelephone: 100, globalHeureBancTelephone: 3 });
        const g = []; for (let i = 0; i < 5; i++) g.push(await poster(s, `198.51.100.${i + 1}`));
        H.v('M3. plafond GLOBAL : 3 dépôts par heure toutes IP confondues, des adresses toutes différentes n\'y échappent pas', g, [201, 201, 201, 429, 429]);
        H.v('M3. le plafond global par défaut est 120 par heure', routes.GLOBAL_HEURE, 120);
        await s.fermer(); await db.col('limites').deleteMany({});
        // un appelant déjà refusé par SON plafond n'use pas le global
        s = await monterIp({ ipHeureBancTelephone: 1, globalHeureBancTelephone: 3 });
        const h = [await poster(s, '198.51.100.1'), await poster(s, '198.51.100.1'), await poster(s, '198.51.100.1'), await poster(s, '198.51.100.2'), await poster(s, '198.51.100.3'), await poster(s, '198.51.100.4')];
        H.v('M3. le refus d\'une IP ne consomme pas le global : 1 + 2 autres passent (3 au global), la 4e IP est refusée par le global', h, [201, 429, 429, 201, 201, 429]);
        await s.fermer(); await db.col('limites').deleteMany({});
    }

    // ═══ m4 : le gabarit remplacé par fonction ═══
    {
        const app = express(); app.use(express.json()); const rt = express.Router();
        routes.monter(rt, { modeleEmpreinte: { sha256: '$&$`$\'x$1', octets: 7 } }, { envBancTelephone: ENV, ...DEPS }); app.use(rt);
        const s = await H.serveur(app); const t = await (await fetch(s.url + '/api/banc/telephone')).text();
        H.v('m4. une valeur de configuration qui porte « $& », « $` », « $\' » est écrite telle quelle (remplacement par fonction)', t.includes('content="$&amp;$`$&#39;x$1"'), true);
        await s.fermer();
    }

    // ═══ les règles de jugement (verdict.mjs) ═══
    {
        const bon = { nEmpreintes: 30, nVecteursRefuses: 0, cos: Array(30).fill(0.99999), cosModeleSeul: Array(12).fill(1), shaVerifie: true };
        H.v('M5/M6. référence : tout établi, cos min 0,99999 ⇒ IDENTIQUE', V.jugerMesure(bon), { verdict: 'IDENTIQUE', erreur: null });
        for (const [nom, sha] of [['non vérifiable (null)', null], ['faux', false], ['absent', undefined]]) {
            const r = V.jugerMesure({ ...bon, shaVerifie: sha });
            H.v(`M5. sha256 ${nom} ⇒ ERREUR « sha256 non verifiable », jamais IDENTIQUE`, [r.verdict, /sha256 non verifiable/.test(r.erreur)], ['ERREUR', true]);
        }
        let r = V.jugerMesure({ ...bon, cos: Array(29).fill(1), nEmpreintes: 29 });
        H.v('M6. 29 empreintes sur 30 ⇒ ERREUR « incompletes »', [r.verdict, /incompletes : 29\/30/.test(r.erreur)], ['ERREUR', true]);
        r = V.jugerMesure({ ...bon, nEmpreintes: 20 });
        H.v('M6. nEmpreintes < 30 déclaré ⇒ ERREUR', r.verdict, 'ERREUR');
        r = V.jugerMesure({ ...bon, cos: [...Array(29).fill(1), NaN] });
        H.v('M6. un cosinus non fini ⇒ ERREUR « cosinus non fini » (jamais « ÉCART — »)', [r.verdict, r.erreur], ['ERREUR', 'cosinus non fini']);
        r = V.jugerMesure({ ...bon, cos: [] , nEmpreintes: 0 });
        H.v('M6. aucune empreinte ⇒ ERREUR', [r.verdict, r.erreur], ['ERREUR', 'aucune empreinte mesuree']);
        r = V.jugerMesure({ ...bon, cosModeleSeul: [1, NaN] });
        H.v('M6. un cosinus « modèle seul » non fini ⇒ ERREUR', r.verdict, 'ERREUR');
        r = V.jugerMesure({ ...bon, cos: [...Array(29).fill(1), 0.9998] });
        H.v('M6. 30 empreintes, cos min 0,9998 (sous 0,9999) ⇒ ÉCART (un vrai écart mesuré)', [r.verdict, r.erreur], ['ECART', null]);
        r = V.jugerMesure({ ...bon, nVecteursRefuses: 1 });
        H.v('M6. un vecteur refusé par l\'encodeur ⇒ ÉCART, pas IDENTIQUE', r.verdict, 'ECART');
        H.v('M6. jugerMesure(null) ⇒ ERREUR (ne lève jamais)', V.jugerMesure(null).verdict, 'ERREUR');
        const lotBon = { cartes: Array.from({ length: 30 }, (_, i) => ({ refV: new Float32Array(256).fill(0.0625), pxV: i < 12 ? new Uint8Array(224 * 224 * 3) : undefined })) };
        H.v('M6. lot complet et bien formé ⇒ aucune cause', V.jugerLot(lotBon), null);
        H.v('M6. lot vide / absent', [V.jugerLot({ cartes: [] }), V.jugerLot(null), V.jugerLot({})], ['lot-vide', 'lot-vide', 'lot-vide']);
        H.v('M6. lot de 29 cartes', V.jugerLot({ cartes: lotBon.cartes.slice(0, 29) }), 'lot-incomplet:29/30');
        H.v('M6. référence de 255 composantes', V.jugerLot({ cartes: lotBon.cartes.map((c, i) => (i === 3 ? { ...c, refV: new Float32Array(255) } : c)) }), 'reference-mal-formee');
        H.v('M6. référence non finie', V.jugerLot({ cartes: lotBon.cartes.map((c, i) => (i === 3 ? { ...c, refV: new Float32Array(256).fill(NaN) } : c)) }), 'reference-non-finie');
        H.v('M6. pixels de la mauvaise taille', V.jugerLot({ cartes: lotBon.cartes.map((c, i) => (i === 2 ? { ...c, pxV: new Uint8Array(10) } : c)) }), 'pixels-mal-formes');
        H.v('M7. WebGPU demandé, périphérique absent ⇒ moteur réel « wasm », non utilisé, texte « repli WASM »', V.moteurRealise('webgpu', null), { moteur: 'wasm', utilise: false, texte: 'WebGPU non utilisé (repli WASM)' });
        H.v('M7. WebGPU demandé, périphérique présent ⇒ webgpu', V.moteurRealise('webgpu', { f: 1 }), { moteur: 'webgpu', utilise: true, texte: null });
        H.v('M7. WASM demandé ⇒ wasm', V.moteurRealise('wasm', null).moteur, 'wasm');
        H.v('M8. garde de l\'extension : 0,998 passe, 0,9979 échoue, rien ⇒ non évaluée', [V.gardeExtension(0.998), V.gardeExtension(0.9979), V.gardeExtension(null), V.gardeExtension(NaN), V.gardeExtension(undefined)], ['PASSE', 'ECHOUE', 'NON_EVALUEE', 'NON_EVALUEE', 'NON_EVALUEE']);
        H.v('M8. texte affiché', [V.texteGarde('PASSE'), V.texteGarde('ECHOUE'), V.texteGarde('NON_EVALUEE'), V.texteGarde(undefined)], ['PASSE', 'ÉCHOUE', 'non évaluée', 'non évaluée']);
        H.v('M9. sonde no-cors aboutie ⇒ cors-manquant ; échouée ⇒ réseau ou CSP ; échouée sur page isolée ⇒ indéterminé (COEP refuse aussi la réponse opaque)', [V.classerBlocage(true), V.classerBlocage(false), V.classerBlocage(false, true), V.classerBlocage(true, true)], ['cors-manquant', 'reseau-ou-csp', 'indetermine-isole', 'cors-manquant']);
        H.v('M9. hôte final : host seul, borné, null si illisible', [V.hoteFinal('https://abc.r2.cloudflarestorage.com/b/o?X-Amz=1'), V.hoteFinal('pas une adresse'), V.hoteFinal('https://' + 'a'.repeat(200) + '.fr/').length], ['abc.r2.cloudflarestorage.com', null, 80]);
        H.v('m1. l\'erreur porte l\'étape : « creation-session-wasm:RuntimeError »', V.texteErreur('creation-session-wasm', Object.assign(new Error('texte secret du navigateur'), { name: 'RuntimeError' })), 'creation-session-wasm:RuntimeError');
        H.v('m1. jamais le message du navigateur ; un code de la page est dit tel quel ; non ASCII remplacé ; borné à 200', [/secret/.test(V.texteErreur('x', new Error('secret'))), V.texteErreur('x', { detail: 'lot-invalide:lot-vide' }), V.texteErreur('é', null), V.texteErreur('x', { detail: 'z'.repeat(500) }).length], [false, 'x:lot-invalide:lot-vide', '?:erreur', 200]);
        H.v('m3. écart modèle seul − chaîne complète', [V.ecartChaine(0.9999, 1), V.ecartChaine(null, 1), V.ecartChaine(1, undefined)], [1 - 0.9999, null, null]);
    }

    // ═══ le dépôt accepte les champs nouveaux et refuse les anciens ═══
    {
        H.v('M7/M8/M9/m3. champs nouveaux acceptés (garde, webgpuUtilise, ecartChaineModele, reseau)', S.valider(doc({ reseau: { redirige: true, hoteFinal: 'abc.r2.cloudflarestorage.com', blocage: null } })).ok, true);
        H.v('M9. blocage hors liste fermée refusé', S.valider(doc({ reseau: { blocage: 'autre' } })).detail, 'champ:reseau.blocage');
        H.v('M9. champ inconnu dans reseau refusé', S.valider(doc({ reseau: { ip: '1.2.3.4' } })).detail, 'champ-inconnu:reseau.ip');
        H.v('M8. garde hors liste refusée', S.valider(doc({ mesure: { ...doc().mesure, gardeExtension: 'peut-etre' } })).detail, 'champ:mesure.gardeExtension');
        H.v('m3. decodeurOptions (supprimé) est refusé : liste fermée', S.valider(doc({ decodeurOptions: true })).detail, 'champ-inconnu:decodeurOptions');
    }

    // ═══ la page : ce que le code source doit contenir (la logique dépendante du navigateur est éprouvée par le pilote Chrome local) ═══
    {
        const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
        H.v('M5-M9. app.js câble les règles : jugerLot, jugerMesure, moteurRealise, gardeExtension, classerBlocage, sonde no-cors, redirected, ort.env.webgpu.device', ['jugerLot(lot)', 'jugerMesure(', 'moteurRealise(\'webgpu\'', 'gardeExtension(', 'classerBlocage(', 'mode: \'no-cors\'', 'rep.redirected', 'ort.env.webgpu.device'].map(x => app.includes(x)), Array(8).fill(true));
        H.v('m2. la seconde mesure ne redépose pas la durée du téléchargement', /infoModeleDeposee \? null/.test(app), true);
        H.v('m6. la page dit qu\'elle infère sur le fil principal', /FIL PRINCIPAL/.test(app), true);
        H.v('m3. « décodeur : options acceptées » n\'est plus affiché', /options accept/.test(app), false);
    }

    // ═══ m5 : les copies de l'extension, empreintes COMPLÈTES ═══
    {
        const attendu = {
            'empreinte.js': null, 'moteur-ort.js': null
        };
        void attendu;
        const norm = p => crypto.createHash('sha256').update(Buffer.from(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex');
        const lu = { empreinte: norm(path.join(PUB, 'empreinte.js')), moteur: norm(path.join(PUB, 'moteur-ort.js')), wasmBundle: norm(path.join(PUB, 'ort', 'ort.wasm.bundle.min.mjs')), gpuBundle: norm(path.join(PUB, 'ort', 'ort.webgpu.bundle.min.mjs')), wasm: sha256(path.join(PUB, 'ort', 'ort-wasm-simd-threaded.wasm')), asyncify: sha256(path.join(PUB, 'ort', 'ort-wasm-simd-threaded.asyncify.wasm')) };
        const EMP = JSON.parse(fs.readFileSync(path.join(PUB, '..', 'copies-extension.json'), 'utf8'));
        H.v('m5. empreintes sha256 COMPLÈTES des six copies de l\'extension v2 (copies-extension.json, comparées au dépôt de l\'extension par outils/banc-telephone/verifier-copies.js quand il est présent)', lu, EMP.sha256);
        H.vrai('m5. chaque empreinte est un sha256 complet (64 hexadécimaux)', Object.values(EMP.sha256).every(h => /^[0-9a-f]{64}$/.test(h)));
    }

    defaire(); H.bilan(); await H.fermerBac();
})().catch(e => { console.error('❌', e); process.exit(1); });
