// BANC TELEPHONE — la page de mesure (GET /api/banc/telephone). Même modèle servi (téléchargé par GET /api/modele-empreinte/<sha256>, 302 vers R2, vérifié par son sha256),
// même moteur (onnxruntime-web 1.30.0 : ort.wasm.bundle.min.mjs, wasmPaths, fils = nombreDeFils, proxy = false ; WebGPU : ort.webgpu.bundle.min.mjs, asyncify, 1 fil, repli de sonde et de session bornés)
// et même prétraitement que l'extension v2 : empreinte.js et moteur-ort.js sont les fichiers de l'extension, COPIÉS SANS CHANGEMENT (redimPIL, versTenseur, normaliserL2, encoderVecteur ; cosinus, sonderAdaptateur, creerSessionGpu).
// Entrée : 30 cartes de CATALOGUE (v2/banc-telephone/public/lot.json : JPEG 420 x 587, q 0,92 — la carte redressée du contrat) et, pour chacune, le vecteur de RÉFÉRENCE calculé en natif (onnxruntime CPU, Python, PIL).
// Deux mesures de fidélité : « chaîne complète » (JPEG décodé par ce navigateur → redimPIL → modèle) et « modèle seul » (les 224 x 224 octets PIL → modèle) pour les 12 premières cartes : elles séparent le décodeur du modèle.
// Aucun innerHTML : tout passe par textContent.
import { versTenseur, normaliserL2, vecteurDepuisSortie, nombreDeFils, COTE_MODELE, rgbVersRgba, redimPIL } from './empreinte.js';
import { cosinus, course, sonderAdaptateur, creerSessionGpu } from './moteur-ort.js';
import { jugerLot, jugerMesure, gardeExtension, texteGarde, ecartChaine, moteurRealise, texteErreur, classerBlocage, hoteFinal, detecterIOS, choisirMoteur, webgpuForce, optionsSession, statsPixels, assemblerDiagnostic, texteDiagnostic, TEXTE_WEBGPU_IOS, libererOctets,
    resumerEntree, comptePil, resumerTemoin, texteEntree, avisEntree, etatOrientation, texteOrientation } from './verdict.mjs';
import { decoder, reduire640, VERSION_DECODEUR } from './decodeur.mjs';
import { chargerOctets, peutPreparerSeul, retirerEntrees } from './preparation.mjs';
// LOT « PREMIER SCAN » : la page PRÉPARE seule, dès son ouverture (modèle + moteur .wasm demandés en parallèle, rangés dans Cache Storage, session créée en arrière-plan) ; un clic avant « prêt » ATTEND et le dit.
// Cause (RAPPORT-PREMIER-SCAN.md) : ÉTABLIE sur PC sous un débit imposé (création de session : 1,2 s en local, 12,6 à 16,4 s quand l'API sert à 1,2 puis 1 Mo/s) ; sur iPhone c'est une HYPOTHÈSE compatible avec les 15,5 s
// relevées (dépôt du 2026-11-08 10:17 UTC, collection `banc_telephone` de `rm_essai` : creationSessionMs 15 536, telechargementMs 4 155), NON séparée de la compilation du .wasm. Le .wasm (14 Mo) est téléchargé par ORT
// lui-même dans InferenceSession.create. Il est donc obtenu ICI (cache, sinon réseau compressé par l'API) et fourni à ORT en octets (env.wasm.wasmBinary) ; `mesure.preparation` dépose de quoi trancher (octets transférés,
// encodage, instanciation). Le modèle, la session et les empreintes sont ceux d'avant.
// LOT DÉCODEUR : l'ENTRÉE du modèle est décodée par NOTRE code (decodeur.mjs : JavaScript entier, identique au bit sur tout appareil), pas par le navigateur ; le navigateur reste TÉMOIN (mêmes cartes, comparées octet à octet)
// et REPLI (un refus du décodeur, avec son code, retombe sur le navigateur : la carte est comptée « NON IDENTIQUE AU BIT », jamais un écran vide). Le verdict (jugerMesure), ses seuils et mesurer() sont ceux d'avant.
// NOTE (tour 1) : la page infère sur le FIL PRINCIPAL (l'extension le fait dans un Worker) : les temps et le p95 s'en lisent comme tels (le fil principal gèle l'affichage pendant l'inférence).
// LOT iOS : (1) WebGPU est désactivé sur iOS/iPadOS (l'onglet y est tué par manque de mémoire : RAPPORT-BANC-IOS.md), `?webgpu=forcer` le rouvre pour un diagnostic ;
// (2) le modèle (113 Mo) n'est plus GARDÉ après la création de la session : un seul exemplaire côté JS, jeté dès que la session existe ; (3) une ligne de diagnostic des pixels dit si l'écart de la chaîne vient du décodeur du navigateur.

const $ = id => document.getElementById(id);
const meta = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || '';
const SHA = meta('modele-sha256'), OCTETS = Number(meta('modele-octets')) || 0;
const aleaHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const RECHERCHE = (() => { try { return String(location.search || ''); } catch { return ''; } })();
const E = { shaVerifie: null, modeleOctets: null, telechargementMs: null, verifShaMs: null, lot: null, vecWasm: null, runId: aleaHex(8), gpu: null, reseau: null, infoModeleDeposee: false, mesures: {}, etapes: [], orientation: undefined,
    ios: detecterIOS({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }), forcer: webgpuForce(RECHERCHE), session: optionsSession(RECHERCHE), diagnostic: undefined,
    // la préparation en arrière-plan : son état (attente | en-cours | pret | echec | manuel), la phase RÉELLE en cours, et chaque durée mesurée (ms depuis l'ouverture de la page pour pretMs)
    prep: { etat: 'attente', auto: false, raison: null, phase: '', pretMs: null, chargementMoteurMs: null, wasm: null, modele: null, wasmCompileMs: null, creationSessionMs: null, erreur: null, stockagePersistant: null, interrompueAvant: false } };

// ── affichage
const ascii = s => String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '?');
const arrondi = (x, d = 3) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const f = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');
function ligne(tableId, k, v) { const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td'); a.textContent = k; b.textContent = String(v); tr.append(a, b); $(tableId).append(tr); }
const t0 = performance.now();
const journal = m => { $('journal').textContent += `[${((performance.now() - t0) / 1000).toFixed(1)} s] ${m}\n`; };
const etat = (mot, detail, classe) => { $('verdictMot').textContent = mot; $('verdictDetail').textContent = detail || ''; $('verdict').className = `verdict ${classe}`; };
let stockage = null; try { stockage = window.localStorage; } catch { stockage = null; }
let ETAPE = 'debut';       // m1 : l'étape en cours, dite dans toute erreur
const etape = x => { ETAPE = x; try { E.etapes.push([Date.now(), x]); } catch { /* journal des étapes borné par la durée de la page */ } try { if (stockage) stockage.setItem('rm-banc-etape', x); } catch { /* sans stockage */ } };
const pause = () => new Promise(r => setTimeout(r, 0));
// une erreur de CETTE page porte un code lisible (`detail`) ; pour toute autre exception, seul le nom est dit (jamais le texte d'une exception du navigateur).
class ErreurBanc extends Error { constructor(detail) { super(); this.detail = detail; } }

// ── l'appareil
function decrireAppareil() {
    const gpuOk = typeof navigator.gpu !== 'undefined';
    const lignes = [['agent utilisateur', ascii(navigator.userAgent)], ['crossOriginIsolated', self.crossOriginIsolated === true ? 'oui' : 'non'], ['isolement demandé à la page', meta('isolement-demande') || '?'],
        ['cœurs logiques', navigator.hardwareConcurrency || 'inconnu'], ['mémoire de l\'appareil (Go, arrondie)', navigator.deviceMemory === undefined ? 'non disponible' : navigator.deviceMemory],
        ['SharedArrayBuffer', typeof SharedArrayBuffer === 'function' ? 'oui' : 'non'], ['WebAssembly', typeof WebAssembly === 'object' ? 'oui' : 'non'], ['navigator.gpu (WebGPU)', gpuOk ? 'présent' : 'absent'],
        ['performance.memory', performance.memory ? 'disponible' : 'non disponible'], ['measureUserAgentSpecificMemory', self.crossOriginIsolated === true && performance.measureUserAgentSpecificMemory ? 'disponible' : 'non disponible'],
        ['modèle attendu (sha256)', SHA ? SHA.slice(0, 12) + '…' : 'NON CONFIGURÉ'], ['modèle attendu (octets)', OCTETS || 'inconnu']];
    lignes.push(['iOS / iPadOS (détection)', `${E.ios.ios ? 'oui' : 'non'} (${E.ios.raison})`], ['WebGPU proposé', gpuOk && E.ios.ios ? (E.forcer ? 'oui, FORCÉ (?webgpu=forcer)' : 'non (désactivé sur iOS)') : gpuOk ? 'oui' : 'non'], ['options de session demandées', E.session.retenues.length ? E.session.retenues.join(',') : 'aucune (celles de l\'extension)']);
    for (const [k, v] of lignes) ligne('appareil', k, v);
    E.gpuPropose = gpuOk && (!E.ios.ios || E.forcer);
    $('btnGpu').disabled = !E.gpuPropose;
    if (!gpuOk) $('btnGpu').textContent = 'WebGPU absent sur cet appareil';
    else if (!E.gpuPropose) { $('btnGpu').textContent = 'WebGPU désactivé sur iOS'; $('avisMoteur').textContent = TEXTE_WEBGPU_IOS; }
}
function avertirReprise() {
    let x = null; try { x = stockage && stockage.getItem('rm-banc-etape'); } catch { x = null; }
    if (x && x !== 'fini') { journal(`ATTENTION : la mesure précédente s'est arrêtée à l'étape « ${x} » (onglet fermé par le navigateur ? mémoire ?).`); etat('PRÊT', `La mesure précédente s'est arrêtée à « ${x} ».`, 'attente'); }
}

// ── octets
const b64vers = s => { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
const mediane = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : null; };
const rgbaVersRgb = (rgba, n) => { const rgb = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; } return rgb; };   // pur.js de l'extension

// ── le modèle : par l'API (302 vers R2), vérifié par son sha256 — comme l'extension
// L'appelant reçoit LE SEUL exemplaire côté JS (un tableau d'octets préalloué à la taille annoncée, rempli par morceaux : ni arrayBuffer(), ni copie) et le JETTE dès que la session est créée :
// la page ne le garde pas (avant ce lot : 113 Mo retenus pour toute la durée de la page). Une seconde mesure dans la même page retélécharge (et revérifie) le modèle.
async function chargerModele() {
    if (!/^[0-9a-f]{64}$/.test(SHA)) throw new ErreurBanc('modele-non-configure : l\'API ne publie aucun sha256 de modèle');
    etape('telechargement-modele');
    const url = `/api/modele-empreinte/${SHA}`;
    E.reseau = { redirige: null, hoteFinal: null, blocage: null };
    const reseau = async () => {
        let rep;
        try { rep = await fetch(url, { credentials: 'omit', cache: 'no-store' }); }
        catch (e) {
            // M9 : un TypeError ne dit pas pourquoi. Sonde « no-cors » (réponse opaque, aucun octet lu, abandonnée aussitôt) : si elle aboutit, le réseau et la CSP laissent passer et c'est le CORS qui manque.
            // Sous COEP (page isolée) une réponse opaque sans CORP est refusée elle aussi : la sonde ne peut alors rien séparer (dit « indetermine-isole » : rejouer avec ?iso=0).
            let sondeOk = false; const ctl = new AbortController();
            try { await fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: ctl.signal }); sondeOk = true; } catch { sondeOk = false; }
            try { ctl.abort(); } catch { /* deja termine */ }
            E.reseau.blocage = classerBlocage(sondeOk, self.crossOriginIsolated === true);
            throw new ErreurBanc(`telechargement-modele-bloque:${E.reseau.blocage}`);
        }
        E.reseau.redirige = rep.redirected === true; E.reseau.hoteFinal = hoteFinal(rep.url);
        if (!rep.ok) throw new ErreurBanc(`telechargement-modele:HTTP-${rep.status}`);
        return rep;
    };
    // le sha256 se rejoue à CHAQUE lecture, du cache comme du réseau : une entrée du cache n'est jamais crue sur parole
    const verifier = async tampon => {
        if (!(self.crypto && crypto.subtle)) { E.shaVerifie = null; journal('sha256 NON vérifié (crypto.subtle absent : contexte non sécurisé) : aucun verdict ne sera rendu'); return true; }
        etape('verification-sha256'); etat('VÉRIFICATION', 'sha256 du modèle…', 'attente');
        const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', tampon)), b => b.toString(16).padStart(2, '0')).join('');
        E.shaVerifie = h === SHA;
        return E.shaVerifie;
    };
    PREP.cleModele = url;
    // l'écriture du cache ne retarde PAS la création de la session (attendreEcriture: false) : sa fin est attendue après, par finEcriture
    const r = await chargerOctets({ cle: url, reseau, caches: cachesOuNul(), octetsAttendus: OCTETS, verifier, attendreEcriture: false, surProgres: progres('modèle'), surPhase: phaseModele });
    if (r.verifie === false) throw new ErreurBanc('modele-sha256-different : le fichier recu n\'est pas le modele attendu');
    E.modeleOctets = r.octets.length;
    if (r.source === 'reseau' && E.telechargementMs == null) E.telechargementMs = r.ms.reseau;
    if (r.ms.verif != null && E.verifShaMs == null) E.verifShaMs = r.ms.verif;
    E.modeleCache = { source: r.source, cache: r.cache, ecriture: r.ecriture, lectureCacheMs: r.ms.cacheLecture, telechargementMs: r.ms.reseau, verifShaMs: r.ms.verif, octets: r.octets.length,
        debitMoS: r.source === 'reseau' && r.ms.reseau > 0 ? (r.octets.length / 1048576) / (r.ms.reseau / 1000) : null, finEcriture: r.finEcriture, erreurEcriture: () => r.erreurEcriture };
    journal(r.source === 'cache' ? `modèle lu dans le cache : ${r.octets.length} octets en ${f((r.ms.cacheLecture || 0) / 1000, 1)} s` : `modèle reçu : ${r.octets.length} octets en ${f((r.ms.reseau || 0) / 1000, 1)} s (cache : ${r.cache}, écriture : ${r.ecriture}${r.erreurEcriture ? ' [' + r.erreurEcriture + ']' : ''})`);
    if (r.ms.verif != null) journal(E.shaVerifie === null ? 'sha256 non vérifiable' : `sha256 vérifié (${f(r.ms.verif / 1000, 1)} s)`);
    return r.octets;
}
const cachesOuNul = () => { try { return typeof self.caches === 'object' ? self.caches : null; } catch { return null; } };
// la progression est REELLE : des octets reçus sur un total, et la phase en cours — jamais un pourcentage inventé ; elle dit aussi d'où viennent les octets (cache ou réseau)
const PROG = {};      // une ligne par flux en cours (le modèle et le moteur arrivent EN MÊME TEMPS : l'écran dit les deux)
const majPrep = () => { const t = Object.values(PROG).filter(Boolean).join(' · '); E.prep.phase = t; if (E.prep.etat === 'en-cours') etat('PRÉPARATION', t, 'attente'); };
const progres = qui => (recu, total) => { if (((recu / 1048576) | 0) % 2 === 0 || recu === total) { echantillonnerTas(); PROG[qui] = `${qui} ${f(recu / 1048576, 0)} / ${f(total / 1048576, 0)} Mo`; majPrep(); } };
const NOMS_PHASE = { 'cache-lecture': 'lecture du cache', telechargement: 'téléchargement', verification: 'vérification sha256', 'ecriture-cache': 'écriture du cache' };
const phaseDe = qui => (nom, e) => { if (e === 'debut') { PROG[qui] = `${qui} : ${NOMS_PHASE[nom] || nom}`; majPrep(); } };
const phaseModele = phaseDe('modèle');

// ── le moteur (.wasm d'ORT, 14 Mo) : par le cache durable ; sinon par l'API, qui le sert COMPRIMÉ (brotli) ; revalidé par l'étiquette du serveur (un fichier changé est redemandé)
// B1 (relecture) : (a) la CLÉ porte la version d'ORT du bundle CHARGÉ (ort.env.versions.common : le bundle est revalidé à chaque visite, le moteur rangé ne peut donc pas être d'une autre version que lui) ;
// (b) le sha256 du fichier brut, publié par l'API (X-Rm-Sha256), est rangé avec l'entrée et REJOUÉ à chaque lecture, du cache comme du réseau ; (c) la revalidation compare ce sha à celui du serveur ;
// (d) un échec de session alors que les octets venaient du cache retire le moteur ET le modèle du cache (preparerWasm).
async function chargerWasm(versionOrt) {
    const url = new URL('ort/ort-wasm-simd-threaded.wasm', import.meta.url).pathname;
    PREP.cleWasm = `${url}?ort=${String(versionOrt || 'inconnue').replace(/[^\w.-]/g, '').slice(0, 20)}`;
    const MAGIE = [0x00, 0x61, 0x73, 0x6d];
    let encodage = null;
    const reseau = async () => { const rep = await fetch(url, { credentials: 'omit', cache: 'no-store' }); if (!rep.ok) throw new ErreurBanc(`telechargement-moteur:HTTP-${rep.status}`); encodage = rep.headers.get('content-encoding'); return rep; };
    const verifier = async (o, { sha } = {}) => {
        if (!(o.length > 8 && MAGIE.every((x, i) => o[i] === x))) return false;
        if (!(self.crypto && crypto.subtle)) return true;                    // contexte non sécurisé : ni le cache ni le sha256 n'existent (comme pour le modèle)
        if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) return false;      // le serveur DOIT publier le sha256 du fichier : sans lui, rien n'est vérifiable, et rien n'est cru
        const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', o)), b => b.toString(16).padStart(2, '0')).join('');
        return h === sha;
    };
    const revalider = async ({ sha }) => { if (!sha) return 'inconnu'; const r = await fetch(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store' }); if (!r.ok) return 'inconnu'; const e = r.headers.get('x-rm-sha256'); return e ? (e === sha ? 'valide' : 'change') : 'inconnu'; };
    const t = performance.now();
    const r = await chargerOctets({ cle: PREP.cleWasm, reseau, caches: cachesOuNul(), verifier, revalider, attendreEcriture: false, surProgres: progres('moteur'), surPhase: phaseDe('moteur') });
    if (r.verifie === false) throw new ErreurBanc('moteur-sha256-different : le moteur recu n\'est pas celui que le serveur annonce');
    r.msTotal = performance.now() - t;
    // ce que le réseau a RÉELLEMENT transporté (PerformanceResourceTiming, même origine) : de quoi dériver le débit réel et savoir si l'hébergeur a servi du brotli ; rien si les octets viennent du cache
    r.transfert = null; r.corps = null; r.encodage = null;
    if (r.source === 'reseau') {
        r.encodage = encodage === 'br' || encodage === 'gzip' ? encodage : encodage ? 'inconnu' : 'identity';
        try { const e = performance.getEntriesByName(new URL(url, location.href).href).filter(x => x.initiatorType === 'fetch').pop(); if (e && e.transferSize > 0) { r.transfert = Math.round(e.transferSize); r.corps = Math.round(e.encodedBodySize); } } catch { /* le navigateur ne dit rien : null */ }
    }
    return r;
}
async function chargerLot() {
    if (E.lot) return E.lot;
    etape('lot'); const r = await fetch('/api/banc/telephone/lot.json', { cache: 'no-store' });
    if (!r.ok) throw new ErreurBanc(`lot : HTTP ${r.status}`);
    const lot = await r.json();
    if (lot.modeleSha256 !== SHA) throw new ErreurBanc('lot-pour-un-autre-modele : les references ne sont pas celles du modele servi');
    if (Array.isArray(lot.cartes)) for (const c of lot.cartes) { c.refV = new Float32Array(b64vers(c.ref).buffer); if (c.px) c.pxV = b64vers(c.px); if (c.dec) c.decV = b64vers(c.dec); delete c.ref; delete c.px; delete c.dec; }       // les chaînes base64 décodées ne sont pas gardées (seul le JPEG sert encore, à chaque mesure)
    const cause = jugerLot(lot);        // M6 : un lot incomplet ou mal formé ne juge rien
    if (cause) throw new ErreurBanc(`lot-invalide:${cause}`);
    E.lot = lot; return lot;
}

// ── la carte : JPEG → pixels bruts (comme les références de l'extension : colorSpaceConversion « none ») → redimPIL → tenseur
// `variante` : « pipeline » (celle de la chaîne : sans conversion de couleur, repli sur le défaut), « sans-conversion » (sans repli : lève si le navigateur la refuse), « defaut » (conversion par défaut du navigateur).
async function decoderCarte(c, variante = 'pipeline') {
    const blob = new Blob([b64vers(c.jpg)], { type: 'image/jpeg' });
    let bmp;
    if (variante === 'defaut') bmp = await createImageBitmap(blob);
    else if (variante === 'sans-conversion') bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    else { try { bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch { bmp = await createImageBitmap(blob); } }
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    const w = bmp.width, h = bmp.height, d = x.getImageData(0, 0, w, h);
    if (bmp.close) bmp.close();
    return { rgb: rgbaVersRgb(d.data, w * h), w, h };
}
// ── l'entrée du modèle : Rat-Market d'abord, le navigateur comme témoin et comme repli
const hexSha = async o => { if (!(self.crypto && crypto.subtle)) return null; try { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', o)), b => b.toString(16).padStart(2, '0')).join(''); } catch { return null; } };
async function preparerCarte(c) {
    const octets = b64vers(c.jpg);
    let rm = null, code = null;
    const ta = performance.now();
    try { const r = decoder(octets, { orientation: 'aucune' }); rm = { rgb: r.rgb, w: r.largeur, h: r.hauteur }; }
    catch (e) { code = e && typeof e.code === 'string' ? e.code : 'autre'; }        // jamais le texte d'une exception : seulement le code fermé du décodeur
    const msRm = performance.now() - ta, tb = performance.now();
    let nav = null; try { nav = await decoderCarte(c); } catch { nav = null; }
    return { rm, nav, code, msRm, msNav: performance.now() - tb };
}
/** Le témoin d'une carte : octets du navigateur contre octets de Rat-Market. */
function comparerOctets(rm, nav) {
    if (rm.w !== nav.w || rm.h !== nav.h) return { octetsDiff: rm.rgb.length, ecartMax: 255 };
    let n = 0, max = 0;
    for (let i = 0; i < rm.rgb.length; i++) { const d = Math.abs(rm.rgb[i] - nav.rgb[i]); if (d) { n++; if (d > max) max = d; } }
    return { octetsDiff: n, ecartMax: max };
}
const egalFlottants = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
// L'orientation EXIF vue par CE navigateur : deux petites images embarquées (un WebP 17 x 9 et un JPEG 37 x 29, EXIF « tourné d'un quart de tour ») ; createImageBitmap les tourne-t-il ?
const IMG_EXIF_WEBP = 'UklGRvoAAABXRUJQVlA4WAoAAAAIAAAAEAAACAAAVlA4ILoAAABQBACdASoRAAkAPm0skkWkIqGYBABABsS2AE6ZQjwM51qAuboNDYaReNkAAP76oQkOlERtNUfgbIOUmWYNTtzBW4uvD9A6DlnklalSNC4dT6nkos1MRPUQAwaYuNM79Cei99e/DF69U5tKJvU/Jf2f95vQnGTCN559ubgF9GNqb1/e9f2E8Odz2f+nsJXY2e78NUoLHY4yF7nueaOlTX6tF561/NQe+kbDb54CB6+nGZhR3nSla4lSeABFWElGGgAAAE1NACoAAAAIAAEBEgADAAAAAQAGAAAAAAAA';
const IMG_EXIF_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAdACUDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4X0jwWkCKjrFI00at5lxK26XOASCeAvXJwSew449R8MeBWW3gv5Y44llRkS23AoMMysdrDKsDvXkjGW5Pf03w18LtPe5aS8t0uLGaMSLK8LZdhgcYG0ZOT3AI9MgX9V8E6hpshht43bT4FXYssp/dE4LA78HO5uevOcnsMcBV+sTULNO+t3+C+f6+Rtw5i8PXzilhc1xccPQnzXlKXLytQlJOXM1FJuNvi15lYZ4Q8I3l8sd3HD5ltDOZpNo25znG0BctyATuyfmOTwTXrPhPwedRtS+TEd7JzhV80b2bcAxO8/3hwOOmTt6T4D+Am1PwaJL+13vb3EirCwcDa2D+8IcDbxngfnmvW4PBtto1vZvpNhDapMJIpIg0kizc4AMjDIIDtggj/WdDzXrQrL2zpQWqdvJbvv8Ap5Nn11XOqOV1KlSjWVWhGco3Tu5xUpRjKNrpxlpK8dGtVe2vIQ+FrM2kPkW0kf3t6RtL8jZOQQqcH/eAPOBwBRXrOl6C/wBjb5rSXEzKpuwi/KAuMBgfp26DI6UV7cVSguWTV/8AFL/I8T/XurVvOFayfr+mh5Fo/wAJrS+Q7raSzjKlBslDEAbdoUH5SCh55A6EcHJ7Dw58BdM1WOG7kW8iRAsXmQzYJRWA2IUXDL8u0E84wec8+N/FH9pXXbLxxqvhjw5p1lpL29xc28moXm68kLAlBIikoFIwTtfeuSOOOfE9X+JHi3xsRYeJPEV9q0CvHc+Tv8mAMY5MFYUwiMAuNygZ3Me5z8jw/wAJZpj6KqSrKkrJ/wA0kvKzs/8AwL5bl4LwxxWMgsRnkYU6El7rfvyba5krRdtYpyu5K22+h9JeN/2k/AH7OBj0ax1mLxJBdW0d/Jb2Ra7mdmZogBLHIkO0BWYqWBwpOORXjuv/APBQvxHe2N1p/hbw3Z6RamOZBe6hunuZHdcwSoquqpJgHIIlA2op758Y8Z+FbDUfFjwSwRnygtu7ZfMg80jJG7A4YdOcg8/MRXD6naxeFbkyBBLkv5YhVYRGFQZ6A8lXxkYwRn2H7HnGHyDgnLKU5UfrGMrc3Jz/AA3ilzSaVlZJp8ru27JPe3ydbIsLkuY1aPNKWEpt2UmuWMWla0Fum7KzUrX7bddr/wAdPip451m51P8A4SzW3lbajjTdSaygBCgcRJhAc5yQAxIyRyCSsW+S0sLK3uDa+abmWfjzCpULIRjI+93PPPOKK/nGrglms3jK1OEpT3bhG+mnlZaWSSSSskrJH1C4kw9D91hoxjBbJQ2+635H/9k=';
async function testerOrientation() {
    const un = async (b64, mime, l0, h0) => { try { const bmp = await createImageBitmap(new Blob([b64vers(b64)], { type: mime })); const e = etatOrientation(bmp.width, bmp.height, l0, h0); if (bmp.close) bmp.close(); return e; } catch { return 'indetermine'; } };
    return { webp: await un(IMG_EXIF_WEBP, 'image/webp', 17, 9), jpeg: await un(IMG_EXIF_JPEG, 'image/jpeg', 37, 29) };
}
// LE DIAGNOSTIC DES PIXELS (une fois par page) : sépare le décodeur du navigateur du reste de la chaîne. Trois mesures, contre les pixels de PIL du lot :
//   décodage (2 cartes, pleine taille 420 x 587) : pixels décodés par le navigateur contre `dec` (PIL) · redimensionnement : redimPIL appliqué au décodage de PIL contre les 224 de PIL (`px`), le plancher du redimensionnement JS ·
//   chaîne (12 cartes) : redimPIL appliqué au décodage du navigateur contre `px`. Les variantes « sans conversion » et « par défaut » du bitmap disent si c'est la couleur. Ne lève jamais : un trou reste null (cause « indetermine »).
const rgbDe224 = (rgb, w, h) => rgbaVersRgb(redimPIL(rgbVersRgba(rgb, w, h), w, h, COTE_MODELE, COTE_MODELE), COTE_MODELE * COTE_MODELE);
async function diagnostiquerPixels(lot) {
    const L = { decodage: [], redimensionnement: [], chaine: [], bitmapSansConversion: [], bitmapAvecConversion: [] };
    let couleurCanvas = null;
    try {
        const cv = document.createElement('canvas'), x = cv.getContext('2d', { willReadFrequently: true });
        couleurCanvas = ascii((x && x.getContextAttributes && x.getContextAttributes().colorSpace) || (cv.colorSpace) || 'inconnu').slice(0, 20);
    } catch { couleurCanvas = 'inconnu'; }
    let sansConversionOk = true;
    for (let i = 0; i < lot.cartes.length; i++) {
        const c = lot.cartes[i]; if (!c.pxV) continue;
        try {
            const nav = await decoderCarte(c);
            L.chaine.push(statsPixels(rgbDe224(nav.rgb, nav.w, nav.h), c.pxV));
            if (c.decV) {
                L.decodage.push(statsPixels(nav.rgb, c.decV));
                L.redimensionnement.push(statsPixels(rgbDe224(c.decV, nav.w, nav.h), c.pxV));
                if (sansConversionOk) { try { const s = await decoderCarte(c, 'sans-conversion'); L.bitmapSansConversion.push(statsPixels(s.rgb, c.decV)); } catch { sansConversionOk = false; L.bitmapSansConversion.length = 0; } }
                try { const d = await decoderCarte(c, 'defaut'); L.bitmapAvecConversion.push(statsPixels(d.rgb, c.decV)); } catch { L.bitmapAvecConversion.length = 0; }
            }
        } catch { /* un trou : la mesure correspondante reste manquante */ }
        await pause();
    }
    const sansTrou = l => (l.length && l.every(Boolean) ? l : []);
    return assemblerDiagnostic({ decodage: sansTrou(L.decodage), redimensionnement: sansTrou(L.redimensionnement), chaine: sansTrou(L.chaine), bitmapSansConversion: sansConversionOk ? sansTrou(L.bitmapSansConversion) : [], bitmapAvecConversion: sansTrou(L.bitmapAvecConversion), couleurCanvas });
}
const tenseurDepuisPx = px => { const n = COTE_MODELE * COTE_MODELE, t = new Float32Array(3 * n); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) t[k * n + i] = (px[i * 3 + k] / 255 - 0.5) / 0.5; return t; };

async function memoire() {
    const r = { jsHeapMo: null, uaMo: null };
    try { if (performance.memory) r.jsHeapMo = arrondi(performance.memory.usedJSHeapSize / 1048576, 1); } catch { /* non disponible */ }
    try {
        if (self.crossOriginIsolated === true && performance.measureUserAgentSpecificMemory) {
            const m = await course(performance.measureUserAgentSpecificMemory(), 8000);
            if (m.ok) r.uaMo = Math.round(m.valeur.bytes / 1048576);
        }
    } catch { /* non disponible */ }
    return r;
}

// ── la mesure d'un moteur : `ort` (le module), `session`
async function mesurer(moteur, ort, session, filsDemandes, creationMs) {
    const lot = await chargerLot();
    const mem1 = await memoire();
    const fils = ort.env && ort.env.wasm ? Number(ort.env.wasm.numThreads) : null;
    const infer = async tenseur => {
        const a = performance.now();
        const sortie = await session.run({ pixel_values: new ort.Tensor('float32', tenseur, [1, 3, COTE_MODELE, COTE_MODELE]) });
        const ms = performance.now() - a;
        if (!sortie.emb || sortie.emb.dims.join(',') !== '1,256') throw new ErreurBanc('forme-de-emb');
        const emb = Array.from(sortie.emb.data); try { sortie.emb.dispose(); } catch { /* deja liberee */ }
        return { emb, ms };
    };
    const runs = [], pre = [], cos = [], vecs = []; let refuses = 0;
    const chemins = [], temoins = [], msRm = [], msNav = [], digests640 = []; let ms640 = 0; const paires = [];
    for (let i = 0; i < lot.cartes.length; i++) {
        etat('MESURE', `${moteur.toUpperCase()} · carte ${i + 1}/${lot.cartes.length}`, 'attente'); etape(`${moteur}-carte-${i}`);
        const carte = lot.cartes[i];
        const p = await preparerCarte(carte);                        // Rat-Market d'abord ; le navigateur est décodé aussi (témoin, et repli si Rat-Market refuse)
        const choisi = p.rm || p.nav;
        if (!choisi) throw new ErreurBanc('decodage-impossible');
        const tt = performance.now();
        const tenseur = versTenseur(choisi.rgb, choisi.w, choisi.h);
        pre.push((p.rm ? p.msRm : p.msNav) + (performance.now() - tt));
        const { emb, ms } = await infer(tenseur);
        runs.push(ms);
        const n = normaliserL2(emb);
        let cosCarte = 0;
        if (!n || !vecteurDepuisSortie(emb)) { refuses++; cos.push(0); vecs.push(null); } else { cosCarte = cosinus(n, carte.refV); cos.push(cosCarte); vecs.push(Float32Array.from(n)); }
        chemins.push(p.rm ? { via: 'rm' } : { via: 'repli', code: p.code });
        if (p.nav) msNav.push(p.msNav);
        if (p.rm) {
            msRm.push(p.msRm);
            paires.push({ attendu: carte.rgbSha256 || null, calcule: await hexSha(p.rm.rgb) });   // l'identité à PIL se MESURE ; absente ou incomplète, elle reste « non mesurée »
            if (i < 3) { const t6 = performance.now(); const red = reduire640(p.rm.rgb, p.rm.w, p.rm.h); ms640 += performance.now() - t6; const h6 = await hexSha(red.rgb); if (h6) digests640.push(h6); }
        }
        if (p.rm && p.nav) {                                         // le témoin : mêmes octets ? même tenseur ? sinon, ce que le navigateur aurait donné au modèle
            const c = comparerOctets(p.rm, p.nav);
            let tenseurIdentique = c.octetsDiff === 0, cosNavigateur = cosCarte;
            if (!tenseurIdentique) {
                const tn = versTenseur(p.nav.rgb, p.nav.w, p.nav.h);
                tenseurIdentique = egalFlottants(tn, tenseur);
                if (!tenseurIdentique) { const r = await infer(tn); const nn = normaliserL2(r.emb); cosNavigateur = nn ? cosinus(nn, carte.refV) : 0; }
            }
            temoins.push({ octetsDiff: c.octetsDiff, ecartMax: c.ecartMax, tenseurIdentique, cosNavigateur });
        }
        await pause();
    }
    const cosPx = [];
    for (let i = 0; i < lot.cartes.length; i++) {
        if (!lot.cartes[i].pxV) continue;
        etape(`${moteur}-modele-seul-${i}`);
        const { emb } = await infer(tenseurDepuisPx(lot.cartes[i].pxV)); const n = normaliserL2(emb);
        cosPx.push(n ? cosinus(n, lot.cartes[i].refV) : 0); await pause();
    }
    const mem2 = await memoire();
    const m = { moteur, fils, filsDemandes, creationSessionMs: arrondi(creationMs, 1), premiereMs: arrondi(runs[0], 1), medianeMs: arrondi(mediane(runs.slice(1)), 1), p95Ms: arrondi(p95(runs.slice(1)), 1),
        pretraitementMedianeMs: arrondi(mediane(pre), 1), nEmpreintes: cos.length, nVecteursRefuses: refuses, cosMin: arrondi(Math.min(...cos), 7), cosMoy: arrondi(cos.reduce((s, x) => s + x, 0) / cos.length, 7),
        cosMinModeleSeul: cosPx.length ? arrondi(Math.min(...cosPx), 7) : null, nModeleSeul: cosPx.length,
        jsHeapApresCreationMo: mem1.jsHeapMo, jsHeapFinMo: mem2.jsHeapMo, uaApresCreationMo: mem1.uaMo, uaFinMo: mem2.uaMo };
    m.ecartChaineModele = arrondi(ecartChaine(m.cosMin, m.cosMinModeleSeul), 7);
    // M5 / M6 : le verdict n'existe que si le modèle est PROUVÉ (sha256 vérifié) et le lot COMPLET ; sinon ERREUR avec sa cause (les chiffres restent affichés)
    const j = jugerMesure({ nEmpreintes: m.nEmpreintes, nVecteursRefuses: refuses, cos, cosModeleSeul: cosPx, shaVerifie: E.shaVerifie });
    m.verdict = j.verdict; if (j.erreur) m.erreur = texteErreur(ETAPE, new ErreurBanc(j.erreur));
    // l'entrée : quel chemin a servi, ses refus, le témoin du navigateur, l'identité à PIL ; n'entre dans AUCUN seuil du verdict
    const p = comptePil(paires), resume = resumerEntree(chemins, p.pil), temoin = resumerTemoin(temoins);
    m.entree = { ...resume, source: VERSION_DECODEUR, rgbIdentiquesPil: p.mesurees ? p.identiques : null, rgbMesureesPil: p.mesurees || null, cartesComparees: temoin ? temoin.cartes : null, rgbIdentiquesNavigateur: temoin ? temoin.rgbIdentiquesNavigateur : null,
        tenseursIdentiquesNavigateur: temoin ? temoin.tenseursIdentiquesNavigateur : null, ecartMaxNavigateur: temoin ? temoin.ecartMaxNavigateur : null, cosMinNavigateur: temoin && temoin.cosMinNavigateur != null ? arrondi(temoin.cosMinNavigateur, 7) : null,
        msRmMediane: msRm.length ? arrondi(mediane(msRm), 1) : null, msNavigateurMediane: msNav.length ? arrondi(mediane(msNav), 1) : null, cartes640: digests640.length, ms640: digests640.length ? arrondi(ms640, 1) : null };
    if (digests640.length && self.crypto && crypto.subtle) { const h = await hexSha(new TextEncoder().encode(digests640.join(''))); m.entree.empreinte640 = h ? h.slice(0, 12) : null; }
    // un « scan » = une carte, de ses octets à son empreinte : décodage + redimensionnement + inférence (le témoin du navigateur et les passes « modèle seul » n'y entrent pas)
    return { m, vecs, scans: runs.map((r, i) => r + pre[i]) };
}

// ── WASM : la session est PRÉPARÉE (à l'ouverture de la page, ou au premier clic si la garde l'interdit) puis RÉUTILISÉE ; mêmes options, même modèle, même extension de bout en bout
const PREP = { promesse: null, ort: null, session: null, demande: null, creationMs: null, creeAuClic: false, mesureeUneFois: false, cleWasm: null, cleModele: null };
// le tas JS le plus haut vu pendant la préparation (Chrome seulement : performance.memory ; Safari ne le donne pas ⇒ null) ; échantillonné à chaque morceau de progression et aux étapes
const echantillonnerTas = () => { try { if (performance.memory) { const mo = performance.memory.usedJSHeapSize / 1048576; if (!(E.prep.jsPicMo >= mo)) E.prep.jsPicMo = mo; } } catch { /* non disponible */ } };
const marqueur = v => { try { if (stockage) stockage.setItem('rm-banc-prep', v); } catch { /* sans stockage */ } };
const lireMarqueur = () => { try { return stockage ? stockage.getItem('rm-banc-prep') : null; } catch { return null; } };
// le temps que prend VRAIMENT l'instanciation du .wasm (compilation comprise) : un témoin posé autour de WebAssembly.instantiate le temps de la création, rendu aussitôt
function sonderCompilation() {
    const o = WebAssembly.instantiate; let ms = null;
    try { WebAssembly.instantiate = function (...a) { const t = performance.now(); return Promise.resolve(o.apply(this, a)).then(r => { if (ms === null) ms = performance.now() - t; return r; }); }; } catch { return { fin: () => null }; }
    return { fin: () => { try { WebAssembly.instantiate = o; } catch { /* sans effet */ } return ms; } };
}
function preparerWasm() {
    if (PREP.promesse) return PREP.promesse;
    const P = E.prep; P.etat = 'en-cours'; P.erreur = null; marqueur('en-cours');
    PREP.promesse = (async () => {
        etape('ort-wasm');
        const tMoteur = performance.now();
        const demande = nombreDeFils(navigator.hardwareConcurrency);
        const pModele = chargerModele(); pModele.catch(() => {});      // le modèle part TOUT DE SUITE (le plus long) ; le bundle JS d'ORT (73 Ko) donne la version qui sert de clé au moteur rangé
        const ort = await import('./ort/ort.wasm.bundle.min.mjs'); P.chargementMoteurMs = performance.now() - tMoteur;
        const versionOrt = (ort.env && ort.env.versions && ort.env.versions.common) || null;
        const [wasm, tampon] = await Promise.all([chargerWasm(versionOrt), pModele]);
        echantillonnerTas();
        P.wasm = { source: wasm.source, cache: wasm.cache, ecriture: wasm.ecriture, octets: wasm.octets.length, ms: wasm.msTotal, transfert: wasm.transfert, corps: wasm.corps, encodage: wasm.encodage, finEcriture: wasm.finEcriture };
        P.modele = E.modeleCache;
        ort.env.wasm.wasmBinary = wasm.octets;       // le moteur est fourni en octets : ORT ne le télécharge plus lui-même (c'était l'essentiel des ~15 s de « création »)
        ort.env.wasm.numThreads = demande; ort.env.wasm.proxy = false;
        let modele = tampon;
        etape('creation-session-wasm'); PROG['modèle'] = ''; PROG['moteur'] = ''; PROG['session'] = 'création de la session WASM (compilation du moteur, graphe)'; majPrep();
        const ta = performance.now(), sonde = sonderCompilation();
        let session, cree = false;
        try { session = await ort.InferenceSession.create(modele, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', ...E.session.options }); cree = true; }
        catch (e) {
            // un échec de session alors que les octets venaient du CACHE : le moteur et le modèle rangés sont suspects, ils sont retirés (le prochain essai repart du réseau) avant d'abandonner
            if (wasm.source === 'cache' || (E.modeleCache && E.modeleCache.source === 'cache')) await retirerEntrees({ caches: cachesOuNul(), cles: [PREP.cleWasm, PREP.cleModele].filter(Boolean) });
            throw e;
        }
        finally { P.wasmCompileMs = sonde.fin(); if (cree) libererOctets(modele); modele = null; try { ort.env.wasm.wasmBinary = undefined; } catch { /* sans effet */ } wasm.octets = null; }    // ORT a copié les octets dans son tas : la page ne garde plus rien du modèle ni du moteur (rendus AU SYSTÈME tout de suite)
        const creation = performance.now() - ta; journal(`session WASM créée en ${f(creation, 0)} ms`);
        P.creationSessionMs = creation; PROG['session'] = '';
        PREP.ort = ort; PREP.session = session; PREP.demande = demande; PREP.creationMs = creation;
        echantillonnerTas();
        P.pretMs = performance.now(); P.etat = 'pret'; P.phase = ''; marqueur('pret');
        // la fin de l'écriture du cache (lancée sans l'attendre) : dite au journal et rangée pour le dépôt, SANS rien retarder
        Promise.all([E.modeleCache && E.modeleCache.finEcriture, wasm.finEcriture]).then(([a, b]) => { if (E.modeleCache) E.modeleCache.ecriture = a || E.modeleCache.ecriture; if (P.wasm) P.wasm.ecriture = b || P.wasm.ecriture; journal(`écriture du cache : modèle ${a}, moteur ${b}${E.modeleCache && E.modeleCache.erreurEcriture && E.modeleCache.erreurEcriture() ? ' [' + E.modeleCache.erreurEcriture() + ']' : ''}`); }).catch(() => {});
        journal(`prêt : ${f(P.pretMs / 1000, 1)} s après l'ouverture de la page`);
        etat('PRÊT', `Session WASM prête ${f(P.pretMs / 1000, 1)} s après l'ouverture de la page (${E.modeleCache && E.modeleCache.source === 'cache' ? 'modèle du cache' : 'modèle téléchargé'}). Touchez « Mesurer en WASM ».`, 'attente');
        try { if (navigator.storage && navigator.storage.persisted) P.stockagePersistant = await navigator.storage.persisted(); } catch { P.stockagePersistant = null; }
        return PREP;
    })().catch(e => { P.etat = 'echec'; P.erreur = texteErreur(ETAPE, e); marqueur('echec'); PREP.promesse = null; PROG['session'] = ''; throw e; });
    return PREP.promesse;
}
/** Libère la session préparée (avant une mesure WebGPU : deux sessions ne coexistent pas) ; la suivante se prépare de nouveau, honnêtement, au clic suivant. */
async function libererSessionPreparee() {
    const s = PREP.session; PREP.session = null; PREP.ort = null; PREP.promesse = null; PREP.mesureeUneFois = false;
    if (E.prep.etat === 'pret') E.prep.etat = 'attente';
    if (s) { try { await s.release(); } catch { /* deja liberee */ } }
}
async function mesurerWasm() {
    const tClic = performance.now(), etaitPret = Boolean(PREP.session);
    if (!etaitPret) {
        const en = E.prep.etat === 'en-cours' ? 'préparation en cours' : 'préparation lancée par ce clic';
        journal(`clic AVANT « prêt » : on attend (${en}${E.prep.phase ? ' : ' + E.prep.phase : ''})`);
        etat('ATTENTE', `${en} — ${E.prep.phase || 'démarrage'}`, 'attente');
    }
    const P = await preparerWasm();
    const attente = etaitPret ? 0 : performance.now() - tClic;
    if (!etaitPret) PREP.creeAuClic = true;
    const creation = PREP.mesureeUneFois ? null : P.creationMs;      // la session n'est créée qu'une fois : les scans suivants n'ont pas de création
    const { m, vecs, scans } = await mesurer('wasm', P.ort, P.session, P.demande, creation);
    m.gardeExtension = gardeExtension(m.cosMin);       // M8 : pour WASM, le cosinus contre la référence native
    if (!PREP.mesureeUneFois) E.vecWasm = vecs;
    const clicAResultat = performance.now() - tClic;
    PREP.mesureeUneFois = true;
    m.preparation = bilanPreparation({ attente, clicAResultat, scans, uaMo: m.uaApresCreationMo });      // la mémoire de l'agent utilisateur est celle que mesurer() a lue juste après la création de la session (rien de plus à payer)
    return m;
}
const nul = x => (typeof x === 'number' && Number.isFinite(x) ? arrondi(x, 1) : null);
function bilanPreparation({ attente, clicAResultat, scans, uaMo = null }) {
    const P = E.prep, mo = E.modeleCache || {}, w = P.wasm || {};
    const suite = scans.slice(1);
    return { etat: P.etat === 'echec' ? 'echec' : P.auto === true ? 'pret' : 'manuel', auto: P.auto === true, froid: mo.source === 'reseau',
        cacheModele: mo.cache || 'indisponible', cacheWasm: w.cache || 'indisponible', cacheEcriture: mo.ecriture || 'sans', sourceModele: mo.source || 'reseau', sourceWasm: w.source || 'reseau',
        telechargementModeleMs: nul(mo.telechargementMs), lectureCacheModeleMs: nul(mo.lectureCacheMs), verifShaMs: nul(mo.verifShaMs), chargementMoteurMs: nul(P.chargementMoteurMs), wasmMs: nul(w.ms), wasmOctets: w.octets || null,
        wasmCompileMs: nul(P.wasmCompileMs), creationSessionMs: nul(P.creationSessionMs), ouvertureAPretMs: nul(P.pretMs), attenteAvantScanMs: nul(attente), clicAPremierResultatMs: nul(clicAResultat),
        premierScanMs: nul(scans[0]), scanSuivantMedianeMs: nul(mediane(suite)), scanSuivantP95Ms: nul(p95(suite)), nScans: scans.length, filsSession: PREP.demande == null ? null : Number(PREP.demande),
        stockagePersistant: typeof P.stockagePersistant === 'boolean' ? P.stockagePersistant : null, interrompueAvant: P.interrompueAvant === true,
        wasmTransfertOctets: w.transfert == null ? null : w.transfert, wasmCorpsOctets: w.corps == null ? null : w.corps, wasmEncodage: w.encodage || null,
        modeleOctets: mo.octets || null, modeleDebitMoS: typeof mo.debitMoS === 'number' ? arrondi(mo.debitMoS, 2) : null,
        memoireJsPicMo: typeof P.jsPicMo === 'number' ? arrondi(P.jsPicMo, 1) : null, memoireUaMo: nul(uaMo) };
}

// ── WebGPU : la sonde (2 s), la session (20 s) et le repli de l'extension (moteur-ort.js, sans changement)
async function mesurerGpu() {
    await libererSessionPreparee();         // la session WASM préparée est rendue avant la création d'une session WebGPU (jamais deux à la fois, comme avant ce lot)
    etape('sonde-gpu');
    const sonde = await sonderAdaptateur(navigator.gpu);
    if (!sonde.ok) return { moteur: 'webgpu', verdict: 'ERREUR', erreur: texteErreur(ETAPE, new ErreurBanc(`webgpu-indisponible:${sonde.raison}`)), webgpuUtilise: false };
    E.gpu = { vendor: ascii(sonde.adaptateur.vendor).slice(0, 40), architecture: ascii(sonde.adaptateur.architecture).slice(0, 40) };
    journal(`adaptateur WebGPU : ${E.gpu.vendor} / ${E.gpu.architecture}`);
    etape('ort-webgpu');
    const ort = await import('./ort/ort.webgpu.bundle.min.mjs');
    ort.env.wasm.wasmPaths = { wasm: new URL('ort/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href };
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;      // le calcul est sur le GPU : pas de fils WASM de plus (extension : FILS_GPU)
    let modele = await chargerModele();
    etape('creation-session-gpu'); etat('SESSION', 'création de la session WebGPU…', 'attente');
    const ta = performance.now();
    let g;
    try { g = await creerSessionGpu({ ort, tampon: async () => modele.buffer }); }       // moteur-ort.js (copie de l'extension) : new Uint8Array(buffer) est une VUE, pas une copie
    finally { if (g && g.ok) libererOctets(modele); modele = null; }                      // un seul exemplaire côté JS, rendu au système dès que la session existe (sur un échec ou un délai dépassé la création peut encore lire : on laisse faire le ramasse-miettes)
    const creation = performance.now() - ta;
    if (!g.ok) return { moteur: 'webgpu', verdict: 'ERREUR', erreur: texteErreur(ETAPE, new ErreurBanc(`${g.raison}-apres-${Math.round(creation)}ms`)), webgpuUtilise: false, creationSessionMs: arrondi(creation, 1) };
    // M7 : « webgpu » n'est dit que si le périphérique existe. ort.env.webgpu.device (promesse ou valeur) ; sinon la session est un repli WASM silencieux : rien n'est mesuré sous l'étiquette webgpu.
    let device = null; try { const d = await course(Promise.resolve(ort.env.webgpu.device), 2000); device = d.ok ? d.valeur : null; } catch { device = null; }
    const reel = moteurRealise('webgpu', device);
    if (!reel.utilise) { try { await g.session.release(); } catch { /* deja liberee */ } journal(reel.texte); return { moteur: 'webgpu', verdict: 'ERREUR', erreur: texteErreur(ETAPE, new ErreurBanc(reel.texte)), webgpuUtilise: false, creationSessionMs: arrondi(creation, 1) }; }
    journal(`session WebGPU créée en ${f(creation, 0)} ms (périphérique GPU présent)`);
    try {
        const { m, vecs } = await mesurer('webgpu', ort, g.session, 1, creation);
        m.webgpuUtilise = true;
        if (E.vecWasm) {
            let mn = 1; for (let i = 0; i < vecs.length; i++) mn = Math.min(mn, vecs[i] && E.vecWasm[i] ? cosinus(vecs[i], E.vecWasm[i]) : 0);
            m.cosMinContreWasm = arrondi(mn, 7);
        } else m.cosMinContreWasm = null;
        m.gardeExtension = gardeExtension(m.cosMinContreWasm);      // M8 : WebGPU contre WASM (« non évaluée » sans mesure WASM de cette exécution)
        return m;
    } finally { try { await g.session.release(); } catch { /* deja liberee */ } }
}

// ── l'envoi et l'écran
function document_(mesure) {
    return { v: 1, runId: E.runId, modeleSha: SHA || '0'.repeat(64), ua: ascii(navigator.userAgent).slice(0, 300), isole: self.crossOriginIsolated === true, coeurs: Number.isInteger(navigator.hardwareConcurrency) && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null,
        memoireAppareilGo: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null, gpuDispo: typeof navigator.gpu !== 'undefined', gpu: E.gpu, reseau: E.reseau,
        // m2 : le téléchargement n'a eu lieu qu'UNE fois : la seconde mesure (le modèle est déjà en mémoire) ne redépose pas ses durées
        modeleOctets: E.modeleOctets, telechargementMs: E.infoModeleDeposee ? null : arrondi(E.telechargementMs, 0), verifShaMs: E.infoModeleDeposee ? null : arrondi(E.verifShaMs, 0), shaVerifie: E.shaVerifie, mesure };
}
async function envoyer(mesure) {
    const doc = document_(mesure);
    if (E.modeleOctets != null) E.infoModeleDeposee = true;
    $('brut').textContent = JSON.stringify(doc, null, 1);
    $('envoi').textContent = 'Envoi du résultat…';
    try {
        const r = await fetch('/api/banc/telephone/resultat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
        $('envoi').textContent = r.status === 201 ? `Résultat envoyé (${mesure.moteur}). Rien d'autre à faire.` : `Résultat NON envoyé (HTTP ${r.status}) : recopiez le texte « Résultat à copier » ci-dessous.`;
    } catch { $('envoi').textContent = 'Résultat NON envoyé (réseau) : recopiez le texte « Résultat à copier » ci-dessous.'; }
}
function afficher(m) {
    const mem = m.uaFinMo != null ? `${m.uaFinMo} Mo (navigateur)` : m.jsHeapFinMo != null ? `${m.jsHeapFinMo} Mo (tas JS)` : 'non disponible';
    const moteur = String(m.moteur || '?').toUpperCase();
    $('ligne4').textContent = `4 · ${texteDiagnostic(m.diagnosticPixels)}`;
    const ent = m.entree || null, tem = ent && ent.cartesComparees ? { cartes: ent.cartesComparees, rgbIdentiquesNavigateur: ent.rgbIdentiquesNavigateur, tenseursIdentiquesNavigateur: ent.tenseursIdentiquesNavigateur, ecartMaxNavigateur: ent.ecartMaxNavigateur } : null;
    $('ligne5').textContent = `5 · ${texteEntree(ent, tem)} · ${texteOrientation(m.orientationNavigateur)}`;
    const prl = m.preparation || null, sec = x => (x == null ? '—' : f(x / 1000, 1) + ' s');
    $('ligne6').textContent = prl ? `6 · préparation : ${prl.froid ? 'à froid' : 'au retour'} · prête ${sec(prl.ouvertureAPretMs)} après l'ouverture · attente au clic ${sec(prl.attenteAvantScanMs)} · un scan ${f(prl.premierScanMs, 0)} ms puis ${f(prl.scanSuivantMedianeMs, 0)} ms` : '6 · préparation : —';
    const avis = avisEntree(m.verdict, ent), suite = avis ? ` · ${avis}` : '';
    if (m.webgpuDesactive) $('avisMoteur').textContent = TEXTE_WEBGPU_IOS;
    if (m.verdict === 'ERREUR') { etat('ERREUR', m.erreur || '', 'ko'); $('ligne1').textContent = `1 · verdict : ERREUR (${moteur}) — ${m.erreur || ''}`; $('ligne2').textContent = `2 · moteur : ${moteur}${m.webgpuUtilise === false ? ' · WebGPU non utilisé (repli WASM)' : ''}`; $('ligne3').textContent = `3 · garde extension 0,998 : ${texteGarde(m.gardeExtension)}`; }
    else {
        const ok = m.verdict === 'IDENTIQUE';
        etat(ok ? 'IDENTIQUE' : `ÉCART ${f(m.cosMin, 5)}`, `${moteur} · cos min ${f(m.cosMin, 6)} sur ${m.nEmpreintes} cartes${m.cosMinModeleSeul != null ? ` · modèle seul ${f(m.cosMinModeleSeul, 6)}` : ''}${suite}`, ok ? 'ok' : 'ecart');
        $('ligne1').textContent = `1 · verdict : ${ok ? 'IDENTIQUE' : 'ÉCART'} (${moteur}) — cos min ${f(m.cosMin, 6)}`;
        $('ligne2').textContent = `2 · moteur : ${moteur} · ${m.fils == null ? '?' : m.fils} fil(s) · isolé ${self.crossOriginIsolated === true ? 'oui' : 'non'} · ${navigator.hardwareConcurrency || '?'} cœurs`;
        $('ligne3').textContent = `3 · médiane ${f(m.medianeMs, 0)} ms (1re ${f(m.premiereMs, 0)}, p95 ${f(m.p95Ms, 0)}) · mémoire ${mem} · garde extension 0,998 : ${texteGarde(m.gardeExtension)}`;
    }
    const t = $('chiffres'); t.textContent = '';
    const dico = [['moteur', m.moteur], ['verdict', m.verdict], ['erreur', m.erreur || '—'], ['fils utilisés (demandés)', `${m.fils == null ? '—' : m.fils} (${m.filsDemandes == null ? '—' : m.filsDemandes})`],
        ['téléchargement du modèle (ms)', E.telechargementMs == null ? '—' : f(E.telechargementMs, 0)], ['vérification sha256 (ms)', E.verifShaMs == null ? '—' : f(E.verifShaMs, 0)], ['sha256 vérifié', E.shaVerifie === null ? 'non vérifiable' : E.shaVerifie ? 'oui' : 'NON'],
        ['création de la session (ms)', f(m.creationSessionMs, 0)], ['première empreinte (ms)', f(m.premiereMs, 0)], ['médiane (ms)', f(m.medianeMs, 0)], ['p95 (ms)', f(m.p95Ms, 0)], ['prétraitement médian : décodage + redimPIL (ms)', f(m.pretraitementMedianeMs, 0)],
        ['cos min / moyen, chaîne complète', `${f(m.cosMin, 7)} / ${f(m.cosMoy, 7)} (${m.nEmpreintes == null ? '—' : m.nEmpreintes} cartes)`], ['cos min, modèle seul', m.cosMinModeleSeul == null ? '—' : `${f(m.cosMinModeleSeul, 7)} (${m.nModeleSeul} cartes)`],
        ['vecteurs refusés par l\'encodeur', m.nVecteursRefuses == null ? '—' : m.nVecteursRefuses], ['cos min contre WASM (garde de l\'extension : 0,998)', m.cosMinContreWasm == null ? '—' : f(m.cosMinContreWasm, 7)],
        ['tas JS après création / fin (Mo)', `${m.jsHeapApresCreationMo == null ? 'non disponible' : f(m.jsHeapApresCreationMo, 1)} / ${m.jsHeapFinMo == null ? 'non disponible' : f(m.jsHeapFinMo, 1)}`],
        ['mémoire navigateur après création / fin (Mo)', `${m.uaApresCreationMo == null ? 'non disponible' : m.uaApresCreationMo} / ${m.uaFinMo == null ? 'non disponible' : m.uaFinMo}`],
        ['écart modèle seul − chaîne complète (décodeur + redimensionnement du navigateur)', m.ecartChaineModele == null ? '—' : f(m.ecartChaineModele, 7)], ['WebGPU réellement utilisé (périphérique présent)', m.webgpuUtilise == null ? '—' : m.webgpuUtilise ? 'oui' : 'NON (repli WASM)'],
        ['garde de l\'extension (cosinus ≥ 0,998)', texteGarde(m.gardeExtension)], ['modèle reçu : redirigé / hôte final', E.reseau ? `${E.reseau.redirige === null ? '—' : E.reseau.redirige ? 'oui' : 'non'} / ${E.reseau.hoteFinal || '—'}` : '—'], ['blocage réseau', E.reseau && E.reseau.blocage ? E.reseau.blocage : '—']];
    if (ent) dico.push(['entrée : chemin qui a servi', `${ent.chemin} (${ent.cartesRm} Rat-Market / ${ent.cartesRepli} navigateur)${Object.keys(ent.refus || {}).length ? ' · refus ' + JSON.stringify(ent.refus) : ''}`],
        ['entrée : décodage Rat-Market, médiane (ms) / navigateur (ms)', `${f(ent.msRmMediane, 1)} / ${f(ent.msNavigateurMediane, 1)}`],
        ['entrée : cos min si le navigateur avait décodé', ent.cosMinNavigateur == null ? '—' : f(ent.cosMinNavigateur, 7)],
        ['réduction 640 déterministe : cartes / ms / empreinte', ent.cartes640 ? `${ent.cartes640} / ${f(ent.ms640, 1)} / ${ent.empreinte640 || '—'}` : '—']);
    const pr = m.preparation || null;
    if (pr) {
        const ms = x => (x == null ? '—' : f(x, 0));
        dico.push(['préparation : à froid (modèle du réseau) ou au retour (modèle du cache)', `${pr.froid ? 'à froid' : 'au retour'} · cache modèle ${pr.cacheModele} · cache moteur ${pr.cacheWasm} · écriture ${pr.cacheEcriture} · préparée ${pr.auto ? 'seule, à l\'ouverture' : 'au clic'}`],
            ['préparation : ouverture de la page → session prête (ms)', ms(pr.ouvertureAPretMs)], ['préparation : téléchargement du modèle / lecture du cache / sha256 (ms)', `${ms(pr.telechargementModeleMs)} / ${ms(pr.lectureCacheModeleMs)} / ${ms(pr.verifShaMs)}`],
            ['préparation : chargement du moteur (JS) / moteur .wasm obtenu (ms, octets) / instanciation .wasm (ms)', `${ms(pr.chargementMoteurMs)} / ${ms(pr.wasmMs)} (${pr.wasmOctets == null ? '—' : pr.wasmOctets}) / ${ms(pr.wasmCompileMs)}`],
            ['préparation : création de la session, tout compris (ms)', ms(pr.creationSessionMs)], ['clic : attente de la préparation (ms)', ms(pr.attenteAvantScanMs)], ['clic → premier résultat, attente comprise (ms)', ms(pr.clicAPremierResultatMs)],
            ['un scan (décodage + redimensionnement + inférence) : le premier / médiane des suivants / p95 (ms)', `${ms(pr.premierScanMs)} / ${ms(pr.scanSuivantMedianeMs)} / ${ms(pr.scanSuivantP95Ms)}`],
            ['stockage persistant (le navigateur ne le videra pas de lui-même)', pr.stockagePersistant === null ? 'non dit' : pr.stockagePersistant ? 'oui' : 'non']);
    }
    for (const [k, v] of dico) ligne('chiffres', k, v);
}
async function lancer(demande) {
    $('btnWasm').disabled = true; $('btnGpu').disabled = true;
    // WebGPU sur iOS devient WASM (sauf ?webgpu=forcer) : le moteur mesuré, affiché et déposé est celui qui SERT ; le moteur demandé et la désactivation sont déposés à côté.
    const choix = choisirMoteur({ demande, ios: E.ios.ios, forcer: E.forcer }), moteur = choix.moteur;
    if (choix.texte) { journal(choix.texte); $('avisMoteur').textContent = choix.texte; }
    let m;
    try { m = moteur === 'wasm' ? await mesurerWasm() : await mesurerGpu(); }
    catch (e) { const t = texteErreur(ETAPE, e); journal(`ERREUR ${t}`); m = { moteur, verdict: 'ERREUR', erreur: t }; }
    // le diagnostic des pixels vient APRÈS la mesure (une fois par page) : ses décodages ne coexistent jamais avec le modèle ni avec une session (il ne doit pas gonfler le pic qu'on mesure)
    if (E.diagnostic === undefined) {
        etape('diagnostic-pixels'); etat('DIAGNOSTIC', 'pixels décodés par ce navigateur…', 'attente');
        try { E.diagnostic = await diagnostiquerPixels(await chargerLot()); } catch { E.diagnostic = null; }
        journal(texteDiagnostic(E.diagnostic));
    }
    if (E.orientation === undefined) { try { E.orientation = await testerOrientation(); } catch { E.orientation = null; } journal(texteOrientation(E.orientation)); }
    m.orientationNavigateur = E.orientation || null;
    m.moteurDemande = demande === 'webgpu' ? 'webgpu' : 'wasm'; m.webgpuDesactive = choix.desactive; m.webgpuForce = choix.forcee;
    if (E.session.retenues.length) m.optionsSession = E.session.retenues.join(',');
    m.diagnosticPixels = E.diagnostic || null;
    E.mesures[moteur] = m;
    afficher(m); etape('fini');
    await envoyer(m);
    $('btnWasm').disabled = false; $('btnGpu').disabled = !E.gpuPropose;
}

decrireAppareil(); avertirReprise();
// LA PRÉPARATION SEULE, dès l'ouverture : sauf `?prep=0`, sauf si la précédente est morte avec l'onglet (marqueur « en-cours » ou « pret » jamais refermé : mémoire ?), sauf moins de 2 Go déclarés. Dans ces cas la
// préparation démarre au clic, comme avant ce lot. Le marqueur dit « ferme » quand la page est cachée ou quittée avec une session prête : un onglet tué en cours de route ne se prépare pas deux fois de suite seul.
{
    const avant = lireMarqueur(), garde = peutPreparerSeul({ marqueur: avant, deviceMemory: navigator.deviceMemory, recherche: RECHERCHE, saveData: (() => { try { return navigator.connection ? navigator.connection.saveData : undefined; } catch { return undefined; } })() });
    E.prep.auto = garde.auto; E.prep.raison = garde.raison; E.prep.interrompueAvant = avant === 'en-cours' || avant === 'pret';
    let quittee = false;      // pagehide a eu lieu : un événement de visibilité tardif (certains navigateurs en émettent un « visible » pendant le départ) ne doit pas ré-écrire « pret »
    document.addEventListener('visibilitychange', () => { if (quittee) return; if (PREP.session) marqueur(document.visibilityState === 'hidden' ? 'ferme' : 'pret'); });
    window.addEventListener('pagehide', () => { quittee = true; if (PREP.session) marqueur('ferme'); });
    window.addEventListener('pageshow', () => { quittee = false; if (PREP.session) marqueur('pret'); });      // retour depuis le cache de navigation : la session est toujours là
    if (garde.auto) setTimeout(() => { preparerWasm().catch(e => journal(`PRÉPARATION en échec : ${texteErreur(ETAPE, e)}`)); }, 0);
    else {
        E.prep.etat = 'manuel';
        const dit = { demande: '?prep=0', interrompue: 'la préparation précédente s\'est arrêtée avec la page', 'memoire-faible': 'moins de 2 Go de mémoire déclarés', echec: 'la préparation précédente a échoué (elle ne se relance pas seule)', inconnu: 'état de préparation précédent inconnu', 'data-economie': 'économie de données demandée' }[garde.raison] || garde.raison;
        journal(`préparation en arrière-plan NON lancée (${dit}) : elle démarre au clic`);
        if (!stockage || !stockage.getItem('rm-banc-etape') || stockage.getItem('rm-banc-etape') === 'fini') etat('PRÊT', `Touchez « Mesurer en WASM » (préparation non lancée seule : ${dit}).`, 'attente');
    }
}
$('btnWasm').addEventListener('click', () => { lancer('wasm'); });
$('btnGpu').addEventListener('click', () => { lancer('webgpu'); });
window.addEventListener('error', e => journal(`ERREUR-JS non rattrapee, ligne ${Number(e.lineno) || 0}`));
window.addEventListener('unhandledrejection', e => journal(`REJET ${texteErreur(ETAPE, e.reason)}`));
// un point d'entrée pour le pilote local (headless) : lancer sans toucher les boutons
window.__banc = { lancer, E };
