// ============================================================
// BULBAPEDIA — api.php, UNE requête toutes les 5 s, jamais en parallèle
// ============================================================
// `robots.txt` relu le 2026-09-12 : `/wiki/` permis, `/w/` interdit seulement sur `action=history` et
// `oldid=` → `api.php` est permis, `Crawl-delay: 5`. Les Archives (archives.bulbagarden.net)
// interdisent tout `/w/` : on ne touche JAMAIS à leur api.php ; les URL de fichiers se demandent ici,
// par `prop=imageinfo` (dépôt partagé).
//
// Le débit est tenu par une FILE : chaque appel attend la fin du précédent plus le délai. Deux
// appelants concurrents ne peuvent donc pas doubler la cadence — c'est ce qui distingue un
// collecteur d'un aspirateur. `maxlag=5` : si le serveur est en retard, on attend et on réessaie,
// trois fois au plus.

const axios = require('axios');

const API = 'https://bulbapedia.bulbagarden.net/w/api.php';
const UA = 'rat-market-collecte/0.1 (https://rat-market.fr ; collecte texte, contact via le site) axios';
const DELAI_MS = 5000;
const REESSAIS_MAXLAG = 3;

let _derniere = 0;          // horodatage du DÉBUT de la dernière requête
let _file = Promise.resolve();
let _compte = 0;

const dodo = ms => new Promise(r => setTimeout(r, ms));

/**
 * Télécharge un fichier (URL rendue par `imageinfo`, hôte archives.bulbagarden.net `/media/upload/`,
 * hors du `/w/` interdit) DANS LA MÊME FILE que `api` : un seul débit pour tout Bulbagarden. Deux
 * files, une par hôte, doubleraient la cadence chez le même opérateur — la faute du §17, en plus discret.
 */
// LES REDIRECTIONS (§75, le défaut du client TPC) : jamais suivies par le transport (`maxRedirects: 0`) ; ce client les suit lui-même, chaque saut recontrôlé —
// https, et l'hôte de départ OU la liste fermée Bulbagarden ci-dessous, 3 sauts au plus. Tout autre cas est un REFUS NOMMÉ (`refusRedirection`), ni un succès ni un défi.
const HOTES_BULBAGARDEN = Object.freeze(['archives.bulbagarden.net', 'bulbapedia.bulbagarden.net']);
const SAUTS_MAX = 3;
const transportAxios = url => axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': UA }, timeout: 60000, maxRedirects: 0, validateStatus: () => true });   // I1 : TOUS les statuts passent par le module (un 503 « Just a moment » est un défi)
// 🔑 LA RÈGLE COMMUNE DE RÉPONSE (2026-10-18) : le défi, la fausse page introuvable, la pause et le compteur par hôte vivent dans reponse-hote.js — ce client les APPELLE, il n'en garde aucune copie.
const RH = require('./reponse-hote');
// CORRECTION 1 : le suivi vit pour tout le PROCESSUS (un registre par hôte, celui du module) ; un défi écrit un ARRÊT DURABLE lu avant toute requête (api comprise) ; la source se juge par sa RACINE (bulbagarden.net).
const suivi = RH.suiviDuProcessus();
const SOURCE_RACINE = 'bulbagarden.net';
/** Pour les bancs SEULEMENT : le registre du processus repart de zéro (un nouveau processus simulé). */
let dossierDefaut;       // le dossier des pauses de l'API (undefined = celui du module)
function regler(o = {}) { dossierDefaut = o.dossierPauses; RH.reinitialiserSuiviProcessus(); }
const rapportReponses = () => suivi.hotes().map(h => suivi.rapport(h));
const refusRedirection = m => Object.assign(new Error(m), { refusRedirection: true });

function telecharger(url, { transport = transportAxios, delaiMs = DELAI_MS, attendre = dodo, dossierPauses, connues = null } = {}) {
    const tache = _file.then(async () => {
        const attendreFile = async () => { const a = _derniere + delaiMs - Date.now(); if (a > 0) await attendre(a); };
        await attendreFile();
        for (let essai = 0; ; essai++) {
            try {
                let courant = url;
                const hoteDepart = new URL(url).hostname;
                for (let saut = 0; ; saut++) {
                    if (saut > 0) await attendreFile();
                    RH.garderHote(SOURCE_RACINE, dossierPauses ?? dossierDefaut, suivi);        // l'arrêt durable, la pause du processus et la pause persistante tiennent : aucune requête
                    _derniere = Date.now();
                    _compte++;
                    const r = await transport(courant);
                    // I1 : un 5xx SANS défi reprend l'ancien chemin (réessai unique) ; avec un défi (503 « Just a moment »), il est classé par le module
                    if (r.status >= 500 && !RH.detecterDefi({ statut: r.status, typeContenu: r.headers?.['content-type'], entetes: { 'cf-mitigated': r.headers?.['cf-mitigated'] }, debutCorps: Buffer.from(r.data || '').subarray(0, 5000) })) throw Object.assign(new Error('HTTP ' + r.status), { response: { status: r.status } });
                    if (r.status >= 300 && r.status < 400) {
                        if (saut >= SAUTS_MAX) throw refusRedirection(`Bulbagarden redirection refusée sur ${url} : plus de ${SAUTS_MAX} sauts`);
                        const loc = r.headers?.location;
                        if (!loc) throw refusRedirection(`Bulbagarden redirection refusée sur ${url} : réponse ${r.status} sans destination`);
                        let cible; try { cible = new URL(loc, courant); } catch { throw refusRedirection(`Bulbagarden redirection refusée sur ${url} : destination illisible`); }
                        if (cible.protocol !== 'https:' || !(cible.hostname === hoteDepart || HOTES_BULBAGARDEN.includes(cible.hostname))) throw refusRedirection(`Bulbagarden redirection refusée sur ${url} : vers ${cible.protocol}//${cible.hostname} (hôte hors de la liste fermée)`);
                        courant = cible.href;
                        continue;
                    }
                    // LA RÈGLE COMMUNE : image · absente (404, fausse page introuvable) · défi (arrêt définitif) · ambiguë/inattendue (pause) — un 4xx n'est plus une exception de transport
                    const j = RH.lireImage({ status: r.status, type: r.headers?.['content-type'], octets: Buffer.from(r.data), cfMitigated: r.headers?.['cf-mitigated'] }, { suivi, hote: SOURCE_RACINE, url: courant, dossierPauses, connues });
                    if (j.absente) throw Object.assign(new Error(`Bulbagarden absent (${j.issue}) sur ${url}`), { absente: true });
                    return { buffer: j.octets, type: r.headers?.['content-type'] || null };
                }
            } catch (e) {
                if (e.refusRedirection || e.bloque || e.pauseHote || e.absente) throw e;
                const statut = e.response?.status;
                if (essai === 0 && (!statut || statut >= 500)) { console.warn(`   ↻ Bulbagarden ${statut ?? e.code} sur ${url} — un seul réessai dans 60 s`); await attendre(60000); continue; }
                throw new Error(`Bulbagarden ${statut ?? e.code ?? ''} sur ${url} (après ${essai + 1} essai(s))`);
            }
        }
    });
    _file = tache.catch(() => { });
    return tache;
}

/** Requête sérialisée et espacée. Rend le JSON, lève sur erreur API (sauf maxlag, réessayé). */
function api(params) {
    const tache = _file.then(async () => {
        for (let essai = 0; essai < REESSAIS_MAXLAG; essai++) {
            RH.garderHote(SOURCE_RACINE, dossierDefaut, suivi);        // l'arrêt durable de la source tient aussi pour l'API
            const attente = _derniere + DELAI_MS - Date.now();
            if (attente > 0) await dodo(attente);
            _derniere = Date.now();
            _compte++;
            let r;
            try {
                r = await axios.get(API, {
                    params: { format: 'json', formatversion: 2, maxlag: 5, ...params },
                    headers: { 'User-Agent': UA, 'Api-User-Agent': UA },
                    timeout: 60000
                });
            } catch (e) {
                // CORRECTION 2 (F4) : un DÉFI sur api.php (la forme du §73 : 403 Cloudflare `cf-mitigated: challenge`, ou un 503 « Just a moment ») écrit l'ARRÊT DURABLE de la source — même racine que les images
                const rr = e.response;
                if (rr) {
                    const motif = RH.detecterDefi({ statut: rr.status, typeContenu: rr.headers?.['content-type'], entetes: { 'cf-mitigated': rr.headers?.['cf-mitigated'] }, debutCorps: Buffer.from(String(typeof rr.data === 'string' ? rr.data : JSON.stringify(rr.data ?? '')).slice(0, 5000)) });
                    if (motif) {
                        let fichier = null, ecriture = null;
                        try { fichier = RH.arretHote(SOURCE_RACINE, `${motif} (HTTP ${rr.status}) sur api.php`, { dossier: dossierDefaut, url: API }); } catch (x) { ecriture = x.message; }
                        throw Object.assign(new Error(`${SOURCE_RACINE} BLOQUÉ (${motif}) sur api.php — arrêt définitif de la source${fichier ? '' : ` ; ÉCRITURE DE L'ARRÊT IMPOSSIBLE (${ecriture})`}`), { bloque: true, arretDefinitif: true, status: rr.status, hote: SOURCE_RACINE, motif, fichier });
                    }
                }
                // 5xx ou réseau : UN réessai après 60 s, comme artofpkm.js (§21 bis : les deux clients d'une
                // même règle). Le 2026-09-14 à 18:43 UTC, un 503 Cloudflare a tué la génération de la table à
                // sa première requête, avec une trace de 300 lignes. Au-delà d'un réessai, on s'arrête :
                // insister sur un serveur qui dit « indisponible » n'est pas un débit, c'est une charge.
                const statut = e.response?.status;
                if (essai === 0 && (!statut || statut >= 500)) {
                    console.warn(`   ↻ Bulbapedia ${statut ?? e.code ?? e.message} — un seul réessai dans 60 s`);
                    await dodo(60000);
                    continue;
                }
                throw new Error(`Bulbapedia ${statut ?? e.code ?? ''} ${e.message} (après ${essai + 1} essai(s))`);
            }
            const err = r.data?.error;
            if (err?.code === 'maxlag') {
                const retry = Number(r.headers['retry-after']) || 5;
                console.warn(`   ⏳ maxlag (${err.info}) — attente ${retry} s`);
                await dodo(retry * 1000);
                continue;
            }
            if (err) throw new Error(`api.php ${err.code}: ${err.info}`);
            return r.data;
        }
        throw new Error('maxlag persistant après ' + REESSAIS_MAXLAG + ' essais');
    });
    _file = tache.catch(() => { });
    return tache;
}

const compteRequetes = () => _compte;

/**
 * Liens sortants (espace principal) d'une page, avec continuation. Titres tels que liés (AVANT
 * redirection) — c'est voulu : le motif de titres s'applique aux titres liés par la Setlist.
 */
async function liensDe(titre) {
    const titres = [];
    let cont = {};
    do {
        const d = await api({ action: 'query', prop: 'links', titles: titre, plnamespace: 0, pllimit: 'max', redirects: 1, ...cont });
        const pg = d.query?.pages?.[0];
        if (!pg || pg.missing) throw new Error(`page « ${titre} » absente`);
        for (const l of pg.links || []) titres.push(l.title);
        cont = d.continue || {};
    } while (cont.plcontinue);
    return titres;
}

/**
 * Wikitext de pages, par lots de 50, redirections SUIVIES. Rend { pages: [{pageid, title, revid,
 * content}], redirections: Map<from, to>, manquantes: [titres] }.
 */
async function revisionsDe(titres) {
    const pages = [], manquantes = [];
    const redirections = new Map();
    for (let i = 0; i < titres.length; i += 50) {
        const lot = titres.slice(i, i + 50);
        const d = await api({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: lot.join('|'), redirects: 1 });
        for (const r of d.query?.redirects || []) redirections.set(r.from, r.to);
        for (const pg of d.query?.pages || []) {
            if (pg.missing) { manquantes.push(pg.title); continue; }
            const rev = pg.revisions?.[0];
            if (!rev) { manquantes.push(pg.title); continue; }
            pages.push({ pageid: pg.pageid, title: pg.title, revid: rev.revid, content: rev.slots?.main?.content ?? '' });
        }
    }
    return { pages, redirections, manquantes };
}

/** imageinfo (url, taille) de fichiers, par lots de 50. Pour le collecteur d'IMAGES, plus tard. */
async function imageinfoDe(fichiers) {
    const infos = new Map();
    for (let i = 0; i < fichiers.length; i += 50) {
        const lot = fichiers.slice(i, i + 50);
        const d = await api({ action: 'query', prop: 'imageinfo', titles: lot.join('|'), iiprop: 'url|size|mime|sha1' });
        for (const pg of d.query?.pages || []) infos.set(pg.title, pg.imageinfo?.[0] ?? null);
    }
    return infos;
}

module.exports = { regler, rapportReponses, api, liensDe, revisionsDe, imageinfoDe, telecharger, compteRequetes, UA, DELAI_MS, HOTES_BULBAGARDEN, SAUTS_MAX };
