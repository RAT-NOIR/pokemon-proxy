// ============================================================
// LE CLIENT POLI DES RÉCOLTES « RECOLTE » (pokipair, tcgcsv) — 2026-10-24, ordre du testeur
// ============================================================
// « Récolte lente de pokipair et tcgcsv : OUI, selon la doctrine. Images seulement (aucun prix), robots.txt lu, 5 s ou plus par hôte, arrêt définitif au premier 401, 403, 410, 429 ou défi. »
//
// UN client pour les deux (§21 bis : deux exemplaires d'une règle divergent toujours). Il est paramétré par une table FERMÉE d'hôtes { hôte -> chemins admis } ; la décision d'une réponse
// (défi, arrêt durable, pause, fausse page introuvable) est celle de collecte-cartes/reponse-hote.js — ici on l'APPELLE, on n'en recopie rien.
//
//   · DEUX GARDES, écrites par ce qu'elles AUTORISENT : l'hôte nommé dans la table + https + un chemin qui entre dans la forme fermée de cet hôte ; et robots.txt de CET hôte LU
//     (200, ou 404 = « aucune règle ») avant toute autre requête vers lui. Un robots.txt jamais lu n'est pas « aucune règle » : il bloque.
//   · UN SEUL FLUX, tous hôtes confondus (une file) : au moins 5 s entre deux requêtes, même si l'appelant demande moins. Les hôtes d'une racine se partagent la même cadence — plus prudent
//     que « 5 s par hôte », jamais moins.
//   · AUCUNE redirection suivie (`redirect: 'manual'`), aucun cookie, aucune connexion, l'agent du dépôt seul.
//   · ARRÊT DÉFINITIF au premier 401, 403, 410, 429 ou défi (marqueurs techniques) : écrit dans le dossier des arrêts durables (racine de l'hôte), lu avant chaque requête, levé par le
//     coordinateur seulement.
//   · REPRISE : une réponse déjà au cache n'est JAMAIS redemandée ; le plafond (`plafond`) est un TOTAL pour le dossier de cache (les réponses en cache le consomment, `plafondRestant`).
//   · LE JOURNAL : le compte par hôte et par code HTTP (en mémoire), et une ligne JSON par requête sur disque si `journal` est donné (heure, hôte, chemin, code, type, octets — rien d'autre).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const RH = require('./reponse-hote');
const T = require('./tpc');
const VP = require('./verrou-pid');

// ➕ TOUR 1 (relecture du 2026-10-24) :
//   D2 — robots.txt ne vit au cache que 24 h : au-delà il est REDEMANDÉ avant toute autre requête vers l'hôte, et un processus qui dure plus de 24 h refuse de se servir d'un texte périmé ;
//   D3 — UN verrou par hôte, en fichier (`VERROU-<hôte>.json`, dans le dossier de cache de la récolte, hors dépôt) : { pid, hôte machine, battement }. Pris en exclusivité à la première requête vers l'hôte,
//     rafraîchi à chaque requête, rendu à la libération. Un second lancement REFUSE (jamais deux flux). Un verrou est repris si son PID n'existe plus (signal 0 : rien n'est tué) ou si son battement a plus
//     de 3 minutes (trois battements manqués) ; un fichier illisible refuse (« je ne sais pas » n'est pas une prise). Règle de verrou-pid.js, jamais une copie.
const ROBOTS_MAX_MS = 24 * 3600 * 1000;
const DUREE_VERROU_MS = 3 * 60 * 1000;
const VERROUS_TENUS = new Set();
let sortieEnregistree = false;
function enregistrerSortie() {
    if (sortieEnregistree) return;
    sortieEnregistree = true;
    process.on('exit', () => { for (const f of VERROUS_TENUS) VP.rendre(f); });
}

const UA = 'rat-market-catalogue/1.0 (+https://rat-market.fr ; une requete / 6 s)';
const CADENCE_MIN_MS = 5000;
const MAX_TEXTE = 12 * 1024 * 1024;           // un JSON de groupe pèse 1 à 2 Mo ; au-delà, ce n'est pas ce qu'on attend
const MAX_IMAGE = 6 * 1024 * 1024;

/**
 * T4 (décision du testeur, 2026-10-26) — LA TABLE FERMÉE des hôtes d'images dont le robots.txt répond en 4xx : « aucune règle » (RFC 9309, § 2.3.1.3), et SEULEMENT pour la forme de chemin listée.
 * Un seul hôte : le CDN d'images du marché (le testeur a LEVÉ l'arrêt pour ces images-là). Tout autre hôte garde la règle du dépôt : un 401/403/410/429 sur robots.txt est un ARRÊT définitif.
 * Ne s'étend pas par un paramètre : ajouter un hôte ici est une décision du testeur, et le banc compte les clés. 429 et tout défi (marqueur, cf-mitigated) restent des arrêts, même ici.
 */
const ROBOTS_4XX_ADMIS = Object.freeze({ 'tcgplayer-cdn.tcgplayer.com': /^\/product\/\d{1,9}_(in_1000x1000|200w)\.jpg$/ });
const admis4xx = hote => Object.hasOwn(ROBOTS_4XX_ADMIS, hote);

const nomCache = url => `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}-${url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9.-]+/g, '_').slice(0, 80)}.json`;
const nbCache = d => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => /^[0-9a-f]{16}-.*\.json$/.test(f)).length : 0);
/** Le plafond restant d'un dossier de cache : le plafond est un TOTAL, les réponses déjà au cache le consomment. */
const plafondRestant = (dossier, total) => Math.max(0, total - nbCache(dossier));

/** Le transport réel : l'agent du dépôt seul, aucun cookie, aucune redirection suivie. L'hôte et le chemin sont vérifiés AVANT, par le client. */
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(60000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true, transitoire: true }); }
        const type = r.headers.get('content-type') || '';
        const cfMitigated = r.headers.get('cf-mitigated');
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), type, cfMitigated };
        const lu = Buffer.from(await r.arrayBuffer());
        if (lu.length > (binaire ? MAX_IMAGE : MAX_TEXTE)) throw Object.assign(new Error(`réponse trop grande (${lu.length} octets) sur ${url}`), { tropGrande: true });
        if (binaire && r.ok && /^image\//i.test(type)) return { status: r.status, type, octets: lu, cfMitigated };
        return { status: r.status, type, texte: lu.toString('utf8'), cfMitigated };
    }
};

/**
 * @param {object} o
 *   racine : la racine des hôtes (clé de l'arrêt durable) ; hotes : { hôte: { chemin: RegExp, racine? } } — la liste FERMÉE ; dossierCache ; plafond (entier >= 0, TOTAL du dossier) ;
 *   transport, cadenceMs, pause, now, dossierPauses, suivi, journal (fichier .jsonl), robots (banc : { hôte: texte | null } ).
 */
function fabriquerClient({ racine, hotes, dossierCache, plafond, transport = transportFetch, cadenceMs = 6000, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, dossierPauses = RH.DOSSIER_PAUSES, suivi = RH.suiviDuProcessus(), journal = null, robots = null, dossierVerrous = dossierCache } = {}) {
    if (!racine || !hotes || typeof hotes !== 'object' || !Object.keys(hotes).length) throw new Error('recolte-hote : une racine et une table fermée d\'hôtes sont obligatoires');
    if (!Number.isInteger(plafond) || plafond < 0) throw new Error('recolte-hote : un plafond de requêtes (entier >= 0) est obligatoire');
    const cadence = Math.max(cadenceMs, CADENCE_MIN_MS);
    const racineDe = hote => hotes[hote]?.racine ?? racine;
    let n = 0, dernier = null, file = Promise.resolve();
    const parHote = {}, codes = {};
    const robotsLus = new Map();
    for (const [h, v] of Object.entries(robots || {})) robotsLus.set(h, v == null ? { statut: 'absent', texte: null, luLe: now() } : { statut: 'present', texte: String(v), luLe: now() });
    const verrous = new Map();         // hôte -> fichier de verrou tenu par CE client
    fs.mkdirSync(dossierCache, { recursive: true });
    fs.mkdirSync(dossierVerrous, { recursive: true });
    if (journal) fs.mkdirSync(path.dirname(journal), { recursive: true });
    const fichier = url => path.join(dossierCache, nomCache(url));

    /** L'adresse est-elle dans la liste fermée ? LÈVE sinon, avant toute requête. */
    function verifier(url, { image = false } = {}) {
        let u;
        try { u = new URL(url); } catch { throw new Error(`recolte-hote : adresse illisible — aucune requête (${url})`); }
        if (u.protocol !== 'https:') throw new Error(`recolte-hote : https seulement — aucune requête (${url})`);
        const h = hotes[u.hostname];
        if (!h || u.username || u.password || u.port) throw new Error(`recolte-hote : hôte hors de la liste fermée — aucune requête (${url})`);
        if (!h.chemin.test(u.pathname)) throw new Error(`recolte-hote : chemin hors de la forme fermée de ${u.hostname} — aucune requête (${u.pathname})`);
        void image;
        return u;
    }
    function garde(u, { robotsTxt }) {
        RH.garderHote(racineDe(u.hostname), dossierPauses, suivi);
        if (robotsTxt) return;
        const r = robotsLus.get(u.hostname);
        if (!r) throw new Error(`robots.txt de ${u.hostname} pas encore lu — aucune requête (la garde s'écrit par ce qu'elle autorise)`);
        if (!(now() - r.luLe <= ROBOTS_MAX_MS)) throw new Error(`robots.txt de ${u.hostname} périmé (lu il y a plus de 24 h) — aucune requête : le relire d'abord (initialiserRobots)`);
        // T4 : un robots.txt en 4xx n'est « aucune règle » que pour la forme de chemin de la table fermée ; tout autre chemin du même hôte est refusé
        if (r.regle4xx && !(admis4xx(u.hostname) && ROBOTS_4XX_ADMIS[u.hostname].test(u.pathname))) throw new Error(`robots.txt de ${u.hostname} en ${r.regle4xx} : « aucune règle » ne vaut que pour ${ROBOTS_4XX_ADMIS[u.hostname] ?? 'aucun chemin'} — aucune requête (${u.pathname})`);
        if (!T.autoriseParRobots(r.texte, u.pathname + u.search, UA)) throw new Error(`robots.txt interdit ${u.pathname} sur ${u.hostname} — aucune requête`);
    }
    /** D3 : le verrou de l'hôte — pris à la première requête, battement à chaque suivante. LÈVE (aucune requête) si un autre flux le tient. */
    function tenirVerrou(hote) {
        const f = path.join(dossierVerrous, `VERROU-${hote}.json`), maintenant = new Date(now());
        if (!verrous.has(hote)) {
            const r = VP.prendre(f, { maintenant, dureeMaxMs: DUREE_VERROU_MS });
            if (!r.ok) throw Object.assign(new Error(`verrou de l'hôte ${hote} : ${r.raison} — un seul flux par hôte, aucune requête`), { verrouTenu: true });
            verrous.set(hote, f); VERROUS_TENUS.add(f); enregistrerSortie();
            return;
        }
        let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw Object.assign(new Error(`verrou de l'hôte ${hote} illisible ou perdu (${e.message}) — aucune requête`), { verrouTenu: true }); }
        if (d.pid !== process.pid) throw Object.assign(new Error(`verrou de l'hôte ${hote} repris par le pid ${d.pid} — aucune requête`), { verrouTenu: true });
        fs.writeFileSync(f, JSON.stringify({ pid: process.pid, hote: os.hostname(), depuis: maintenant.toISOString() }));
    }
    function liberer() { for (const f of verrous.values()) { VP.rendre(f); VERROUS_TENUS.delete(f); } verrous.clear(); }

    /** Une requête sous la file : verrou, plafond, cadence (>= 5 s, tous hôtes), journal, défi. Rend la réponse brute. */
    function requete(u, url, opts) {
        const tour = file.then(async () => {
            if (n >= plafond) throw Object.assign(new Error(`plafond de requêtes atteint (${plafond})`), { plafond: true });
            RH.garderHote(racineDe(u.hostname), dossierPauses, suivi);       // un arrêt écrit PENDANT l'attente (autre client) bloque aussi
            tenirVerrou(u.hostname);
            if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
            tenirVerrou(u.hostname);          // le battement après l'attente : la requête part dans la seconde
            dernier = now(); n++;
            parHote[u.hostname] = (parHote[u.hostname] || 0) + 1;
            let r;
            try { r = await transport.get(url, opts); }
            catch (e) { codes.erreur = (codes.erreur || 0) + 1; throw e; }
            codes[r.status] = (codes[r.status] || 0) + 1;
            if (journal) fs.appendFileSync(journal, `${JSON.stringify({ le: new Date(now()).toISOString(), hote: u.hostname, chemin: u.pathname + u.search, status: r.status, type: r.type || '', octets: r.octets ? r.octets.length : Buffer.byteLength(r.texte || '') })}\n`);
            return r;
        });
        file = tour.catch(() => {});
        return tour;
    }
    function arreter(u, url, motif, status) {
        let f = null;
        try { f = RH.arretHote(racineDe(u.hostname), `${motif} (HTTP ${status})`, { dossier: dossierPauses, url }); } catch (e) { suivi.bloquer(racineDe(u.hostname), `écriture de l'arrêt impossible (${e.message})`); }
        return Object.assign(new Error(`${racineDe(u.hostname)} BLOQUÉ (${motif}) sur ${url} — ARRÊT définitif de l'hôte${f ? ` (${f})` : ''}`), { bloque: true, arretDefinitif: true, status, hote: u.hostname, fichier: f });
    }

    async function lire(url, { robotsTxt = false, reduire = null, sansCache = false } = {}) {
        const u = verifier(url);
        const f = fichier(url);
        // T4 : `sansCache` redemande une réponse qui change (last-updated.txt, liste des groupes d'un jour nouveau) ; la réponse neuve réécrit le cache. Le plafond, la cadence et le verrou s'appliquent.
        if (!sansCache && fs.existsSync(f)) {
            const c = JSON.parse(fs.readFileSync(f, 'utf8'));
            // D2 : un robots.txt de plus de 24 h ne sert plus de reprise : il est redemandé (et réécrit)
            if (!(robotsTxt && !(now() - Date.parse(c.le) <= ROBOTS_MAX_MS))) return { ...c, cache: true };
        }
        garde(u, { robotsTxt });
        const r = await requete(u, url, {});
        // T4 : robots.txt de l'hôte d'images admis, en 4xx (hors 429) : « aucune règle » — le statut n'est plus un défi par lui-même, mais un marqueur de défi dans le corps ou cf-mitigated l'est toujours
        const aucuneRegle = robotsTxt && admis4xx(u.hostname) && r.status >= 400 && r.status < 500 && r.status !== 429;
        const entree = RH.entreeDepuisClient(r, { borne: 5000 });
        const defi = RH.detecterDefi(aucuneRegle ? { ...entree, statut: 400 } : entree);
        if (defi) throw arreter(u, url, defi, r.status);
        if (aucuneRegle) {
            const sortie = { url, status: r.status, type: r.type || '', texte: '', aucuneRegle4xx: true, le: new Date(now()).toISOString() };
            fs.writeFileSync(f, JSON.stringify(sortie));
            return { ...sortie, cache: false };
        }
        if (r.status >= 500 && r.status < 600) throw Object.assign(new Error(`HTTP ${r.status} sur ${url} — erreur serveur transitoire`), { status: r.status, transitoire: true });
        if (r.status !== 200 && r.status !== 404) throw Object.assign(new Error(`HTTP ${r.status} sur ${url} — ${r.status >= 300 && r.status < 400 ? 'redirection non suivie, ' : ''}réponse non prévue, on s'arrête`), { status: r.status });
        const sortie = { url, status: r.status, type: r.type || '', texte: r.status === 200 ? (reduire ? reduire(r.texte) : r.texte) : '', le: new Date(now()).toISOString() };
        fs.writeFileSync(f, JSON.stringify(sortie));
        return { ...sortie, cache: false };
    }

    /** robots.txt d'un hôte de la table : 200 -> règles ; 404 -> « aucune règle » (noté `absent`) ; tout autre statut ne conclut pas (un défi arrête). */
    async function initialiserRobots(hote) {
        if (!hotes[hote]) throw new Error(`recolte-hote : hôte hors de la liste fermée — aucune requête (${hote})`);
        const r = await lire(`https://${hote}/robots.txt`, { robotsTxt: true });
        const luLe = Date.parse(r.le);
        if (r.status === 404) { robotsLus.set(hote, { statut: 'absent', texte: null, luLe }); return { statut: 'absent', status: 404, cache: r.cache }; }
        if (r.aucuneRegle4xx === true && admis4xx(hote) && r.status >= 400 && r.status < 500 && r.status !== 429) { robotsLus.set(hote, { statut: 'absent', texte: null, luLe, regle4xx: r.status }); return { statut: 'absent', status: r.status, cache: r.cache, regle4xx: true }; }
        if (r.status !== 200) throw new Error(`robots.txt de ${hote} illisible (HTTP ${r.status}) : on ne peut pas conclure`);
        if (/html/i.test(r.type) || !/text\/|^$/i.test(r.type)) throw new Error(`robots.txt de ${hote} : type « ${r.type} » (pas un fichier texte) — on ne peut pas conclure`);
        const d = T.delaiDesRobots(r.texte, UA);
        if (d && d * 1000 > cadence) throw new Error(`robots.txt de ${hote} demande un Crawl-delay de ${d} s : au-delà de la cadence prévue, on s'arrête`);
        robotsLus.set(hote, { statut: 'present', texte: r.texte, luLe });
        return { statut: 'present', status: 200, cache: r.cache, texte: r.texte };
    }

    /**
     * UNE IMAGE (hôte et chemin de la table fermée) : mêmes gardes, même file, même plafond ; le fichier .bin à côté de la fiche .json. La réponse est jugée par la règle commune
     * (RH.lireImage) : redirection non suivie (pause), défi (arrêt définitif), 200 text/html sans défi = introuvable, tout le reste = pause.
     * @returns {{octets?: Buffer, absente?: boolean, cache: boolean, meta: object}}
     */
    async function lireImage(url) {
        const u = verifier(url, { image: true });
        const f = fichier(url), fb = f.replace(/\.json$/, '.bin');
        if (fs.existsSync(f)) {
            const m = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (m.statut === 'ok' && fs.existsSync(fb)) return { octets: fs.readFileSync(fb), cache: true, meta: m };
            if (m.statut === 'absent' || (m.statut === 'fausse-absente' && RH.fausseAbsenceRecente(m, now()))) return { absente: true, cache: true, meta: m };
        }
        garde(u, { robotsTxt: false });
        const r = await requete(u, url, { binaire: true });
        const x = RH.lireImage(r, { suivi, hote: racineDe(u.hostname), url, dossierPauses });      // LÈVE : redirection/inattendue = pause, défi = arrêt définitif, 5xx = transitoire
        if (x.absente) {
            const precedente = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
            const m = { url, ...RH.entreeAbsence(precedente, { issue: x.issue, empreinte: x.empreinte }, r.status, now()) };
            fs.writeFileSync(f, JSON.stringify(m));
            return { absente: true, cache: false, meta: m };
        }
        const m = { url, statut: 'ok', status: r.status, type: r.type || '', octets: x.octets.length, sha256: crypto.createHash('sha256').update(x.octets).digest('hex'), le: new Date(now()).toISOString() };
        fs.writeFileSync(fb, x.octets); fs.writeFileSync(f, JSON.stringify(m));
        return { octets: x.octets, cache: false, meta: m };
    }
    return { lire, lireImage, initialiserRobots, liberer, requetes: () => n, requetesParHote: () => ({ ...parHote }), codes: () => ({ ...codes }), robotsDe: h => robotsLus.get(h) ?? null, dossierCache: () => dossierCache };
}

/** La fiche et les octets d'une image DÉJÀ au cache, sans réseau : { octets, meta } | null. */
function lireDuCache(dossier, url) {
    const f = path.join(dossier, nomCache(url)), fb = f.replace(/\.json$/, '.bin');
    if (!fs.existsSync(f) || !fs.existsSync(fb)) return null;
    const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
    return meta.statut === 'ok' ? { octets: fs.readFileSync(fb), meta } : null;
}

/** D2 : le robots.txt de `hote` est-il au cache ET lu il y a moins de 24 h ? (le maximum d'un lancement ne le compte « 0 requête » qu'à cette condition) */
function robotsFrais(dossier, hote, maintenant = Date.now()) {
    const f = path.join(dossier, nomCache(`https://${hote}/robots.txt`));
    if (!fs.existsSync(f)) return false;
    try { return maintenant - Date.parse(JSON.parse(fs.readFileSync(f, 'utf8')).le) <= ROBOTS_MAX_MS; } catch { return false; }
}

module.exports = { ROBOTS_4XX_ADMIS, fabriquerClient, lireDuCache, nomCache, nbCache, plafondRestant, robotsFrais, transportFetch, UA, CADENCE_MIN_MS, ROBOTS_MAX_MS, DUREE_VERROU_MS };
