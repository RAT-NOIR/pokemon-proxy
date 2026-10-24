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
const path = require('path');
const crypto = require('crypto');
const RH = require('./reponse-hote');
const T = require('./tpc');

const UA = 'rat-market-catalogue/1.0 (+https://rat-market.fr ; une requete / 6 s)';
const CADENCE_MIN_MS = 5000;
const MAX_TEXTE = 12 * 1024 * 1024;           // un JSON de groupe pèse 1 à 2 Mo ; au-delà, ce n'est pas ce qu'on attend
const MAX_IMAGE = 6 * 1024 * 1024;

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
function fabriquerClient({ racine, hotes, dossierCache, plafond, transport = transportFetch, cadenceMs = 6000, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, dossierPauses = RH.DOSSIER_PAUSES, suivi = RH.suiviDuProcessus(), journal = null, robots = null } = {}) {
    if (!racine || !hotes || typeof hotes !== 'object' || !Object.keys(hotes).length) throw new Error('recolte-hote : une racine et une table fermée d\'hôtes sont obligatoires');
    if (!Number.isInteger(plafond) || plafond < 0) throw new Error('recolte-hote : un plafond de requêtes (entier >= 0) est obligatoire');
    const cadence = Math.max(cadenceMs, CADENCE_MIN_MS);
    const racineDe = hote => hotes[hote]?.racine ?? racine;
    let n = 0, dernier = null, file = Promise.resolve();
    const parHote = {}, codes = {};
    const robotsLus = new Map();
    for (const [h, v] of Object.entries(robots || {})) robotsLus.set(h, v == null ? { statut: 'absent', texte: null } : { statut: 'present', texte: String(v) });
    fs.mkdirSync(dossierCache, { recursive: true });
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
        if (!T.autoriseParRobots(r.texte, u.pathname + u.search, UA)) throw new Error(`robots.txt interdit ${u.pathname} sur ${u.hostname} — aucune requête`);
    }
    /** Une requête sous la file : plafond, cadence (>= 5 s, tous hôtes), journal, défi. Rend la réponse brute. */
    function requete(u, url, opts) {
        const tour = file.then(async () => {
            if (n >= plafond) throw Object.assign(new Error(`plafond de requêtes atteint (${plafond})`), { plafond: true });
            RH.garderHote(racineDe(u.hostname), dossierPauses, suivi);       // un arrêt écrit PENDANT l'attente (autre client) bloque aussi
            if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
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

    async function lire(url, { robotsTxt = false, reduire = null } = {}) {
        const u = verifier(url);
        const f = fichier(url);
        if (fs.existsSync(f)) return { ...JSON.parse(fs.readFileSync(f, 'utf8')), cache: true };
        garde(u, { robotsTxt });
        const r = await requete(u, url, {});
        const defi = RH.detecterDefi(RH.entreeDepuisClient(r, { borne: 5000 }));
        if (defi) throw arreter(u, url, defi, r.status);
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
        if (r.status === 404) { robotsLus.set(hote, { statut: 'absent', texte: null }); return { statut: 'absent', status: 404, cache: r.cache }; }
        if (r.status !== 200) throw new Error(`robots.txt de ${hote} illisible (HTTP ${r.status}) : on ne peut pas conclure`);
        if (/html/i.test(r.type) || !/text\/|^$/i.test(r.type)) throw new Error(`robots.txt de ${hote} : type « ${r.type} » (pas un fichier texte) — on ne peut pas conclure`);
        const d = T.delaiDesRobots(r.texte, UA);
        if (d && d * 1000 > cadence) throw new Error(`robots.txt de ${hote} demande un Crawl-delay de ${d} s : au-delà de la cadence prévue, on s'arrête`);
        robotsLus.set(hote, { statut: 'present', texte: r.texte });
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
    return { lire, lireImage, initialiserRobots, requetes: () => n, requetesParHote: () => ({ ...parHote }), codes: () => ({ ...codes }), robotsDe: h => robotsLus.get(h) ?? null, dossierCache: () => dossierCache };
}

/** La fiche et les octets d'une image DÉJÀ au cache, sans réseau : { octets, meta } | null. */
function lireDuCache(dossier, url) {
    const f = path.join(dossier, nomCache(url)), fb = f.replace(/\.json$/, '.bin');
    if (!fs.existsSync(f) || !fs.existsSync(fb)) return null;
    const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
    return meta.statut === 'ok' ? { octets: fs.readFileSync(fb), meta } : null;
}

module.exports = { fabriquerClient, lireDuCache, nomCache, nbCache, plafondRestant, transportFetch, UA, CADENCE_MIN_MS };
