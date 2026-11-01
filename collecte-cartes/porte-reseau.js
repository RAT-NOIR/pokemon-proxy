// ============================================================
// LA PORTE RÉSEAU UNIQUE — 2026-11-01, décision du testeur (corrigée au tour 1 de relecture)
// ============================================================
// Deux écarts du 01/11 : une page de pokebip.com lue AVANT son robots.txt (qui l'interdit) ; une requête vers www.misprint.com, hôte déjà fermé. Les deux passaient par WebFetch, qui ignore
// nos règles. Décision : « une seule porte d'accès réseau pour tous les sous-agents. Elle refuse toute requête vers un hôte fermé, et toute page tant que le robots.txt de l'hôte n'a pas été
// lu et respecté. » Le hook .claude/hooks/porte-reseau.js ferme les autres chemins (WebFetch, curl, scripts réseau non identiques à HEAD…) ; ici vit le seul chemin qui passe.
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : https, sans identifiants ni port, nom de domaine public normalisé (minuscules, points finaux retirés), hôte ni exclu ni fermé, robots.txt LU
// (200, ou 404 = « aucune règle ») puis RESPECTÉ pour les trois agents, sur le chemin NORMALISÉ. Toute erreur, tout état non prévu REFUSE et le dit.
//
// Les décisions ne sont PAS recopiées : le défi est celui de reponse-hote.js (arretHote, detecterDefi, classerReponseImage) ; la lecture de robots.txt est celle de tpc.js
// (autoriseParRobots, delaiDesRobots). La racine d'un hôte est ICI (petite liste fermée de suffixes à deux niveaux, D6) : RH.hoteRacine ferme `co.uk` tout entier.
//
//   CLI  node collecte-cartes/porte-reseau.js verifier <url> [--image]
//        node collecte-cartes/porte-reseau.js lire <url> --sortie=<fichier> [--texte] [--image]
//        node collecte-cartes/porte-reseau.js fermer <hôte> --motif="…"          (le coordinateur)
//   Sortie : 0 = fait, 3 = refusé (ou hôte arrêté), 2 = usage, 1 = échec technique (HTTP non 200, réseau, écriture).
//
// LIMITES ÉCRITES : le dossier de la porte (robots\, cadence\) est inscriptible par un agent qui écrit un fichier ; le hook refuse ces écritures mais il ne vaut que contre l'erreur d'un agent de
// bonne foi. Robots 400/451/autres 4xx : refus à chaque appel (la cadence est consommée à chaque fois, aucun cache négatif).
'use strict';
const fs = require('fs');
const path = require('path');
const RH = require('./reponse-hote');
const T = require('./tpc');
const RHT = require('./recolte-hote');

const UA = RHT.UA;
const AGENTS = Object.freeze(['rat-market-catalogue', 'Claude-User', 'ClaudeBot']);
const ROBOTS_MAX_MS = 24 * 3600 * 1000;
const CADENCE_MIN_MS = 5000;
const CRAWL_MAX_S = 60;
const SAUTS_MAX = 3;
const BORNE_OCTETS = 12 * 1024 * 1024;
const DELAI_REQUETE_MS = 30000;
const VERROU_PERIME_MS = 2 * 60 * 1000;
const DOSSIER_PORTE_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\porte-reseau';
const RACINES_SORTIE_DEFAUT = Object.freeze(['C:\\Users\\Yung\\rat-market-travail\\catalogue']);
/** D6 : suffixes à deux niveaux (liste fermée) : la racine d'un hôte qui les porte a TROIS labels. */
const SUFFIXES2 = Object.freeze(new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.cn', 'com.tw', 'com.hk', 'co.kr', 'co.nz', 'com.mx', 'com.sg', 'co.id', 'co.th', 'in.th']));

function racineDe(hote) {
    const l = String(hote).split('.');
    if (l.length <= 2) return String(hote);
    return SUFFIXES2.has(l.slice(-2).join('.')) ? l.slice(-3).join('.') : l.slice(-2).join('.');
}

// ── le transport réel : agent du dépôt, aucun cookie, redirect manual, 30 s, 12 Mo bornés PENDANT la lecture ─────────────────────────────────────
function fabriquerTransportReel({ borne = BORNE_OCTETS, delaiMs = DELAI_REQUETE_MS } = {}) {
    return {
        async get(url, { binaire = false } = {}) {
            const ctl = new AbortController();
            const minuteur = setTimeout(() => ctl.abort(), delaiMs);
            try {
                let r;
                try { r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: ctl.signal }); }
                catch (e) { throw Object.assign(new Error(`${ctl.signal.aborted ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true, transitoire: true }); }
                const type = r.headers.get('content-type') || '', cfMitigated = r.headers.get('cf-mitigated');
                if (r.status >= 300 && r.status < 400) { try { await r.body?.cancel(); } catch { /* sans corps utile */ } return { status: r.status, location: r.headers.get('location'), type, cfMitigated }; }
                const morceaux = []; let n = 0;
                try {
                    if (r.body) {
                        const lecteur = r.body.getReader();
                        for (;;) {
                            const { done, value } = await lecteur.read();
                            if (done) break;
                            n += value.length;
                            if (n > borne) { try { await lecteur.cancel(); } catch { /* déjà fermé */ } throw Object.assign(new Error(`réponse trop grande (plus de ${borne} octets) sur ${url}`), { tropGrande: true }); }
                            morceaux.push(Buffer.from(value));
                        }
                    }
                } catch (e) {
                    if (e.tropGrande) throw e;
                    throw Object.assign(new Error(`${ctl.signal.aborted ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true, transitoire: true });
                }
                const lu = Buffer.concat(morceaux);
                if (binaire && r.ok && /^image\//i.test(type)) return { status: r.status, type, octets: lu, cfMitigated };
                return { status: r.status, type, texte: lu.toString('utf8'), cfMitigated };
            } finally { clearTimeout(minuteur); }
        },
    };
}
let transportDefaut = null;

function configurer(o = {}) {
    return {
        mode: o.mode === undefined ? 'page' : o.mode,
        transport: o.transport || (transportDefaut ||= fabriquerTransportReel()),
        maintenant: o.maintenant || Date.now,
        pause: o.pause || (ms => new Promise(r => setTimeout(r, ms))),
        dossierArrets: o.dossierArrets || RH.DOSSIER_PAUSES,
        dossierPorte: o.dossierPorte || process.env.PORTE_RESEAU_DOSSIER || DOSSIER_PORTE_DEFAUT,
    };
}
const erreurRefus = (motif, extra = {}) => Object.assign(new Error(motif), { refus: true, ...extra });

// ── le journal : une ligne JSON par décision de refus ET par requête ────────────────────────────────────────────────────────────────────────
function origineChemin(url) { try { const u = new URL(url); return u.origin + u.pathname; } catch { return String(url).slice(0, 200); } }
function journaliser(c, ligne) {
    fs.mkdirSync(c.dossierPorte, { recursive: true });
    fs.appendFileSync(path.join(c.dossierPorte, 'journal.jsonl'), `${JSON.stringify({ le: new Date(c.maintenant()).toISOString(), ...ligne })}\n`);
}

// ── D1/D2 : l'hôte normalisé UNE FOIS (minuscules, points finaux retirés, punycode par URL) et nom public exigé ──────────────────────────────
function nomNonPublic(hote) {
    const l = hote.split('.');
    if (l.length < 2) return 'un seul label';
    if (l.some(x => !x)) return 'label vide';
    if (hote.includes(':') || hote.includes('[')) return 'adresse IP (v6)';
    if (/^\d+$/.test(l[l.length - 1]) || /^[\d.]+$/.test(hote) || /^0x/i.test(l[l.length - 1])) return 'adresse IP (v4)';
    if (hote === 'localhost' || /\.(localhost|local|internal)$/.test(hote)) return 'nom local ou interne';
    if (SUFFIXES2.has(hote)) return 'suffixe public';
    return null;
}
/** @returns {{motif: string}|{u: URL, hote: string, racine: string}} — l'URL rendue porte l'hôte normalisé. */
function normaliser(url) {
    let u;
    try { u = new URL(url); } catch { return { motif: `adresse illisible (${String(url).slice(0, 120)})` }; }
    if (u.protocol !== 'https:') return { motif: 'https seulement' };
    if (u.username || u.password || u.port) return { motif: 'ni identifiants ni port dans l\'adresse' };
    const hote = u.hostname.toLowerCase().replace(/\.+$/, '');
    const np = nomNonPublic(hote);
    if (np) return { motif: `hôte « ${hote} » : un nom de domaine public est exigé (${np})` };
    u.hostname = hote;
    return { u, hote, racine: racineDe(hote) };
}

// ── gardes 1 à 3 : l'adresse, les exclus, les hôtes fermés (synchrones, sans réseau) ─────────────────────────────────────────────────────────
function exclusion(hote, mode) {
    hote = String(hote).toLowerCase().replace(/\.+$/, '');
    if (/(^|\.)vinted\.[a-z.]+$/.test(hote)) return 'Vinted est exclu par décision (refus permanent)';
    if (/(^|\.)cardmarket\.[a-z.]+$/.test(hote)) return 'Cardmarket est exclu par décision (refus permanent)';
    if (hote.includes('pokecardex')) {
        if ((hote === 'pokecardex.com' || hote === 'www.pokecardex.com') && mode === 'page') return null;      // consultation de pages HTML seulement
        return 'Pokécardex : pages HTML de pokecardex.com en consultation seulement ; ni image, ni son CDN (refus permanent)';
    }
    return null;
}
const normNom = s => String(s || '').toLowerCase().replace(/\.+$/, '');
/** D7 : un ARRET-HOTE ferme son nom de fichier et son champ `hote` (chacun avec sa racine), ET l'hôte EXACT de son champ `url`. */
function hoteFerme(hote, dossier) {
    let noms;
    try { fs.mkdirSync(dossier, { recursive: true }); noms = fs.readdirSync(dossier); }
    catch (e) { return `dossier des arrêts illisible (${e.message}) : tout est refusé`; }
    const racine = racineDe(hote);
    const ferme = h => { h = normNom(h); return h !== '' && (h === hote || racineDe(h) === racine); };
    for (const n of noms) {
        const m = /^ARRET-HOTE-(.+)\.json$/i.exec(n);
        if (!m) continue;
        let j = null;
        try { const x = JSON.parse(fs.readFileSync(path.join(dossier, n), 'utf8')); if (x && typeof x === 'object') j = x; } catch { /* illisible : fermé par son nom */ }
        let urlHote = null;
        try { urlHote = j && j.url ? normNom(new URL(j.url).hostname) : null; } catch { /* url illisible */ }
        if (!j || ferme(m[1]) || (typeof j.hote === 'string' && ferme(j.hote)) || (urlHote && urlHote === hote)) {
            return `hôte fermé (${n}, racine ${racine}) : ${j ? (j.motif ?? 'arrêt définitif') : 'fichier illisible, on ne sait pas, l\'arrêt tient'} — aucune requête tant que le coordinateur ne l'a pas levé`;
        }
    }
    return null;
}
/** Gardes 1 à 3. @returns {{motif: string|null, u?: URL, hote?: string, racine?: string}} */
function gardeSimple(url, c) {
    if (c.mode !== 'page' && c.mode !== 'image') return { motif: `mode « ${String(c.mode)} » inconnu (page ou image)` };
    const n = normaliser(url);
    if (n.motif) return { motif: n.motif };
    const ex = exclusion(n.hote, c.mode);
    if (ex) return { motif: ex, hote: n.hote, racine: n.racine };
    const f = hoteFerme(n.hote, c.dossierArrets);
    if (f) return { motif: f, hote: n.hote, racine: n.racine };
    return { motif: null, ...n };
}

// ── D3 : le chemin JUGÉ est normalisé (non réservés décodés, // repliés) ET jugé aussi décodé ; la casse reste significative ─────────────────
function decoderNonReserves(s) {
    return s.replace(/%([0-9a-f]{2})/gi, (m, h) => { const ch = String.fromCharCode(parseInt(h, 16)); return /[A-Za-z0-9\-._~]/.test(ch) ? ch : `%${h.toUpperCase()}`; });
}
function formesDuChemin(u) {
    const p = decoderNonReserves(u.pathname).replace(/\/{2,}/g, '/'), q = decoderNonReserves(u.search);
    const formes = new Set([p + q]);
    try { formes.add(decodeURIComponent(p) + decodeURIComponent(q)); } catch { formes.add(p + q); }
    try { formes.add(decodeURIComponent(p).replace(/\/{2,}/g, '/') + q); } catch { /* garde la forme précédente */ }
    return [...formes];
}
/** M1 : un groupe `User-agent:` VIDE n'est pas un groupe (tpc.js le prendrait pour le groupe de tout agent) : son nom devient un nom qu'aucun agent ne porte. */
const sansGroupeVide = texte => String(texte ?? '').replace(/^(\s*user-agent\s*:)[ \t]*(?:#.*)?$/gim, '$1 porte-reseau-groupe-vide-ignore');

// ── la requête : cadence par racine (verrou D8), journal, redirections ────────────────────────────────────────────────────────────────────
function delaiDeCadence(c, hote) {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(c.dossierPorte, 'robots', `${hote.replace(/[^a-z0-9.-]/gi, '_')}.json`), 'utf8'));
        if (Number(j.crawlDelay) > 0) return Math.max(CADENCE_MIN_MS, Number(j.crawlDelay) * 1000);
    } catch { /* pas de robots au cache : cadence minimale */ }
    return CADENCE_MIN_MS;
}
/** D8 : un verrou par racine, par CRÉATION EXCLUSIVE de fichier ; périmé à 2 min (repris). */
async function avecVerrou(c, racine, fn) {
    const dir = path.join(c.dossierPorte, 'cadence');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${racine}.lock`), debut = Date.now();
    for (;;) {
        try { const fd = fs.openSync(f, 'wx'); fs.writeSync(fd, JSON.stringify({ le: c.maintenant(), pid: process.pid })); fs.closeSync(fd); break; }
        catch (e) {
            if (e.code !== 'EEXIST') throw e;
            let perime = false;
            try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); perime = c.maintenant() - Number(j.le) > VERROU_PERIME_MS; }
            catch { try { perime = Date.now() - fs.statSync(f).mtimeMs > VERROU_PERIME_MS; } catch { /* disparu : on réessaie */ } }
            if (perime) { try { fs.unlinkSync(f); } catch { /* repris par un autre */ } continue; }
            if (Date.now() - debut > 5 * 60 * 1000) throw new Error(`verrou de cadence de ${racine} tenu trop longtemps : on ne peut pas conclure`);
            await new Promise(r => setTimeout(r, 10));
        }
    }
    try { return await fn(); } finally { try { fs.unlinkSync(f); } catch { /* déjà retiré */ } }
}
/** UNE requête : lecture-attente-écriture de l'heure d'envoi SOUS le verrou de la racine, puis envoi ; la réponse est journalisée. */
async function envoyer(url, c, { binaire }) {
    const n = normaliser(url);
    if (n.motif) throw erreurRefus(n.motif);
    const { u, hote, racine } = n;
    const fc = path.join(c.dossierPorte, 'cadence', `${racine}.json`);
    const delai = delaiDeCadence(c, hote);
    await avecVerrou(c, racine, async () => {
        if (fs.existsSync(fc)) {
            let dernier = null;
            try { dernier = Number(JSON.parse(fs.readFileSync(fc, 'utf8')).dernier); } catch { /* illisible : on attend l'écart entier */ }
            const attente = Number.isFinite(dernier) ? dernier + delai - c.maintenant() : delai;
            if (attente > 0) await c.pause(attente);
        }
        const f = hoteFerme(hote, c.dossierArrets);                    // un arrêt écrit PENDANT l'attente (autre processus) bloque aussi
        if (f) throw erreurRefus(f, { hote });
        fs.writeFileSync(fc, JSON.stringify({ dernier: c.maintenant(), url: origineChemin(u.href) }));
    });
    let r;
    try { r = await c.transport.get(u.href, { binaire }); }
    catch (e) { journaliser(c, { url: origineChemin(u.href), mode: c.mode, decision: 'requete', status: 'erreur', motif: String(e.message).slice(0, 200), octets: 0 }); throw e; }
    const octets = r.octets ? r.octets.length : Buffer.byteLength(r.texte || '');
    journaliser(c, { url: origineChemin(u.href), mode: c.mode, decision: 'requete', status: r.status, octets });
    return r;
}
/** Envoie et suit les redirections de la MÊME racine (3 sauts au plus, chaque saut jugé par `juger`) ; ailleurs : rendues sans suivre. */
async function envoyerSuivi(url, c, { binaire, juger }) {
    let courant = url;
    for (let saut = 0; ; saut++) {
        const motif = await juger(courant);
        if (motif) return { refus: motif };
        const r = await envoyer(courant, c, { binaire });
        if (!(r.status >= 300 && r.status < 400)) return { r, urlFinale: courant };
        let suivant;
        try { suivant = new URL(r.location, courant); } catch { return { refus: 'redirection sans adresse lisible : on ne peut pas conclure' }; }
        const ns = normaliser(suivant.href), ici = normaliser(courant);
        if (ns.motif || ici.motif || ns.racine !== ici.racine) return { r, ailleurs: suivant.href, urlFinale: courant };
        if (saut >= SAUTS_MAX) return { refus: `plus de ${SAUTS_MAX} redirections : on ne peut pas conclure` };
        courant = ns.u.href;
    }
}

// ── garde 4 : robots.txt d'abord ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function arreter(c, racine, motif, status, url) {
    let f = null;
    try { f = RH.arretHote(racine, `${motif} (HTTP ${status})`, { dossier: c.dossierArrets, url }); } catch (e) { throw erreurRefus(`${racine} : ${motif} ; ÉCRITURE DE L'ARRÊT IMPOSSIBLE (${e.message})`, { arret: true, racine }); }
    return Object.assign(new Error(`${racine} BLOQUÉ (${motif}) sur ${origineChemin(url)} — arrêt définitif de l'hôte (${f})`), { arret: true, refus: true, racine, status, fichier: f });
}
function cacheRobots(c, hote) {
    const f = path.join(c.dossierPorte, 'robots', `${hote.replace(/[^a-z0-9.-]/gi, '_')}.json`);
    try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        const age = c.maintenant() - Date.parse(j.le);
        const forme = (j.statut === 'present' && typeof j.texte === 'string') || (j.statut === 'absent' && j.texte == null);
        if (forme && Number.isFinite(age) && age >= 0 && age <= ROBOTS_MAX_MS) return { f, rec: j };
    } catch { /* absent ou illisible : cache manquant, on redemande */ }
    return { f, rec: null };
}
async function robotsDe(hote, racine, c) {
    const { f, rec: cache } = cacheRobots(c, hote);
    if (cache) return { rec: cache };
    const url = `https://${hote}/robots.txt`;
    const cr = { ...c, mode: 'page' };
    const res = await envoyerSuivi(url, cr, { binaire: false, juger: async x => gardeSimple(x, cr).motif });
    if (res.refus) return { motif: `robots.txt de ${hote} : ${res.refus}` };
    if (res.ailleurs) return { motif: `robots.txt de ${hote} redirigé hors de la racine (${origineChemin(res.ailleurs)}) : on ne peut pas conclure` };
    const r = res.r;
    const defi = RH.detecterDefi(RH.entreeDepuisClient(r, { borne: 5000 }));
    if (defi) { const e = arreter(c, racine, defi, r.status, url); return { motif: `robots.txt de ${hote} : ${e.message}` }; }
    let rec;
    if (r.status === 404) rec = { statut: 'absent', status: 404, texte: null, crawlDelay: null };
    else if (r.status === 200) {
        const type = String(r.type || '');
        if (!(type.trim() === '' || /^\s*text\/plain/i.test(type))) return { motif: `robots.txt de ${hote} : type « ${type.slice(0, 60)} » (pas un fichier texte) — on ne peut pas conclure` };
        const texte = sansGroupeVide(r.texte);
        const delais = AGENTS.map(a => T.delaiDesRobots(texte, a)).filter(Boolean);
        rec = { statut: 'present', status: 200, texte, crawlDelay: delais.length ? Math.max(...delais) : null };
    } else return { motif: `robots.txt de ${hote} : HTTP ${r.status} — on ne peut pas conclure` };
    rec.le = new Date(c.maintenant()).toISOString();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec));
    return { rec };
}

// ── LE VERDICT ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function verdictInterne(url, c) {
    const g = gardeSimple(url, c);
    if (g.motif) return { ok: false, motif: g.motif, hote: g.hote ?? null, racine: g.racine ?? null };
    const { u, hote, racine } = g;
    const rb = await robotsDe(hote, racine, c);
    if (rb.motif) return { ok: false, motif: rb.motif, hote, racine };
    const rec = { ...rb.rec, texte: rb.rec.texte == null ? null : sansGroupeVide(rb.rec.texte) };
    for (const chemin of formesDuChemin(u)) {
        for (const agent of AGENTS) {
            if (!T.autoriseParRobots(rec.texte, chemin, agent)) return { ok: false, motif: `robots.txt de ${hote} interdit ${chemin} pour l'agent « ${agent} »`, hote, racine };
        }
    }
    if (Number(rec.crawlDelay) > CRAWL_MAX_S) return { ok: false, motif: `robots.txt de ${hote} demande un Crawl-delay de ${rec.crawlDelay} s (> ${CRAWL_MAX_S} s)`, hote, racine };
    return { ok: true, motif: 'autorisé : robots.txt lu et respecté', hote, racine };
}
/** @returns {Promise<{ok: boolean, motif: string, hote: string|null, racine: string|null}>} — ne lève jamais : toute erreur est un refus. */
async function verdict(url, o = {}) {
    const c = configurer(o);
    let v;
    try { v = await verdictInterne(url, c); }
    catch (e) { v = { ok: false, motif: `erreur : ${e && e.message} — on ne peut pas conclure`, hote: null, racine: null }; }
    if (!v.ok) { try { journaliser(c, { url: origineChemin(url), mode: c.mode, decision: 'refus', motif: v.motif }); } catch { /* le refus tient même si le journal ne s'écrit pas */ } }
    return v;
}

// ── D5 : --sortie seulement sous une racine PERMISE, jamais un fichier existant ──────────────────────────────────────────────────────────────
const SEGMENTS_INTERDITS = ['logo fr', 'apport-manuel', '.claude', '.git', 'node_modules', 'worktrees', 'rat-market-site'];
const SCRATCHPAD = /^[a-z]:\\users\\[^\\]+\\appdata\\local\\temp\\claude\\.+\\scratchpad(\\|$)/i;
const bas = p => path.resolve(p).toLowerCase();
const sous = (a, dossier) => { const d = bas(dossier); return a === d || a.startsWith(d.endsWith(path.sep) ? d : d + path.sep); };
function reel(abs) {
    let reste = '', cur = abs;
    for (;;) {
        try { return path.join(fs.realpathSync(cur), reste); } catch { /* inexistant : on remonte */ }
        const parent = path.dirname(cur);
        if (parent === cur) return abs;
        reste = path.join(path.basename(cur), reste); cur = parent;
    }
}
/** @returns {string|null} le motif du refus, ou null. Écrite par ce qu'elle AUTORISE : le dossier sorties\ de la porte, le dossier du catalogue (hors arrêts et dossier de la porte hors sorties\), un scratchpad. */
function sortiePermise(sortie, c, racines = RACINES_SORTIE_DEFAUT) {
    if (typeof sortie !== 'string' || !sortie) return 'sortie absente';
    let abs;
    try { abs = path.resolve(sortie); } catch { return 'sortie illisible'; }
    const candidats = [bas(abs), bas(reel(abs))];
    for (const a of candidats) {
        for (const s of a.split(path.sep)) if (SEGMENTS_INTERDITS.includes(s) || s.startsWith('pokemon-proxy')) return `sortie sous « ${s} » : jamais écrite par la porte`;
        if (/\\desktop\\logo(\\|$)/i.test(a)) return 'sortie sous Desktop\\LOGO : dossier d\'apports manuels';
        if (sous(a, c.dossierArrets)) return 'sortie sous le dossier des arrêts';
    }
    const porte = c.dossierPorte;
    const dansSorties = candidats.every(a => sous(a, path.join(porte, 'sorties')));
    const dansRacine = candidats.every(a => racines.some(r => sous(a, r)) && !sous(a, path.join(porte, 'robots')) && !sous(a, path.join(porte, 'cadence')) && a !== bas(path.join(porte, 'journal.jsonl')));
    const dansScratch = candidats.every(a => SCRATCHPAD.test(a));
    if (!(dansSorties || dansRacine || dansScratch)) return 'sortie hors des dossiers de travail permis (sorties\\ de la porte, catalogue\\, scratchpad)';
    if (fs.existsSync(abs)) return 'sortie : le fichier existe déjà (jamais écrasé)';
    return null;
}

// ── LIRE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function htmlEnTexte(h) {
    return String(h)
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<\/?(p|div|br|li|ul|ol|tr|table|h[1-6]|section|article|header|footer|nav|main)\b[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, '\'').replace(/&amp;/gi, '&')
        .replace(/[ \t\f\v\r]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/**
 * @param {string} url
 * @param {{mode?: 'page'|'image', sortie: string, texte?: boolean, transport?, maintenant?, pause?, dossierArrets?, dossierPorte?}} o
 * @returns {Promise<{ok: true, status?: number, octets?: number, sortie?: string, redirige?: string}>} — LÈVE : `refus` (garde), `arret` (hôte fermé par la réponse), sinon une erreur technique.
 */
async function lire(url, o = {}) {
    const c = configurer(o);
    if (typeof o.sortie !== 'string' || !o.sortie) throw new Error('porte-reseau : une sortie (fichier) est obligatoire');
    const ms = sortiePermise(o.sortie, c);
    if (ms) { try { journaliser(c, { url: origineChemin(url), mode: c.mode, decision: 'refus', motif: ms }); } catch { /* le refus tient */ } throw erreurRefus(ms); }
    const res = await envoyerSuivi(url, c, {
        binaire: c.mode === 'image',
        juger: async x => { const v = await verdict(x, c); return v.ok ? null : v.motif; },
    });
    if (res.refus) throw erreurRefus(res.refus);
    const r = res.r, urlFinale = res.urlFinale;
    const n = normaliser(urlFinale), racine = n.racine, hote = n.hote;
    if (res.ailleurs) return { ok: true, status: r.status, redirige: res.ailleurs };
    let corps;
    if (c.mode === 'image') {
        const cl = RH.classerReponseImage(RH.entreeDepuisClient(r));
        if (cl.issue === 'defi') throw arreter(c, racine, cl.motif, r.status, urlFinale);
        if (cl.issue !== 'image') throw Object.assign(new Error(`${origineChemin(urlFinale)} : ${cl.issue} (${cl.motif}) — rien n'est écrit`), { issue: cl.issue, status: r.status });
        corps = r.octets;
    } else {
        const defi = RH.detecterDefi(RH.entreeDepuisClient(r, { borne: 5000 }));
        if (defi) throw arreter(c, racine, defi, r.status, urlFinale);
        if (r.status !== 200) throw Object.assign(new Error(`HTTP ${r.status} sur ${origineChemin(urlFinale)} — rien n'est écrit`), { status: r.status });
        if (typeof r.texte !== 'string') throw new Error(`${origineChemin(urlFinale)} : réponse sans texte — rien n'est écrit`);
        if (/^\s*image\//i.test(String(r.type || '')) && hote.includes('pokecardex')) throw erreurRefus('Pokécardex : aucune image (refus permanent)');
        corps = Buffer.from(o.texte ? htmlEnTexte(r.texte) : r.texte, 'utf8');
    }
    if (!corps || corps.length > BORNE_OCTETS) throw new Error(`${origineChemin(urlFinale)} : ${corps ? `réponse trop grande (${corps.length} octets, borne ${BORNE_OCTETS})` : 'aucun octet'} — rien n'est écrit`);
    const ms2 = sortiePermise(o.sortie, c);          // l'état a pu changer pendant l'attente
    if (ms2) throw erreurRefus(ms2);
    fs.mkdirSync(path.dirname(path.resolve(o.sortie)), { recursive: true });
    fs.writeFileSync(o.sortie, corps, { flag: 'wx' });
    return { ok: true, status: r.status, octets: corps.length, sortie: o.sortie };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function cli(argv) {
    const usage = () => { console.error('usage : porte-reseau.js verifier <url> [--image] | lire <url> --sortie=<fichier> [--texte] [--image] | fermer <hôte> --motif="…"'); return 2; };
    const [cmd, cible, ...opts] = argv;
    const drapeaux = {};
    for (const a of opts) {
        const m = /^--(image|texte|sortie|motif)(?:=(.*))?$/.exec(a);
        if (!m) { console.error(`option inconnue : ${a}`); return usage(); }
        drapeaux[m[1]] = m[2] === undefined ? true : m[2];
    }
    if (!cible || !['verifier', 'lire', 'fermer'].includes(cmd)) return usage();
    const permis = { verifier: ['image'], lire: ['image', 'texte', 'sortie'], fermer: ['motif'] }[cmd];
    for (const k of Object.keys(drapeaux)) if (!permis.includes(k)) { console.error(`option --${k} non admise pour « ${cmd} »`); return usage(); }
    const mode = drapeaux.image ? 'image' : 'page';
    if (cmd === 'fermer') {
        if (typeof drapeaux.motif !== 'string' || !drapeaux.motif.trim()) { console.error('--motif="…" est obligatoire'); return usage(); }
        const f = RH.arretHote(normNom(cible), drapeaux.motif, { dossier: configurer().dossierArrets });
        console.log(`fermé : ${cible} (${f})`);
        return 0;
    }
    if (cmd === 'verifier') {
        const v = await verdict(cible, { mode });
        console.log(`${v.ok ? 'AUTORISÉ' : 'REFUSÉ'} : ${v.motif}`);
        return v.ok ? 0 : 3;
    }
    if (typeof drapeaux.sortie !== 'string' || !drapeaux.sortie) { console.error('--sortie=<fichier> est obligatoire'); return usage(); }
    try {
        const r = await lire(cible, { mode, sortie: drapeaux.sortie, texte: !!drapeaux.texte });
        console.log(r.redirige ? `redirigé (non suivi) : ${r.redirige}` : `fait : ${r.octets} octets -> ${r.sortie} (HTTP ${r.status})`);
        return 0;
    } catch (e) {
        console.error(`${e.refus || e.arret ? 'REFUSÉ' : 'ÉCHEC'} : ${e.message}`);
        return e.refus || e.arret ? 3 : 1;
    }
}

if (require.main === module) {
    cli(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(`porte-reseau en panne, refusé par prudence : ${e && e.message}`); process.exit(3); });
}

module.exports = { verdict, lire, htmlEnTexte, gardeSimple, exclusion, hoteFerme, racineDe, normaliser, formesDuChemin, sortiePermise, fabriquerTransportReel, AGENTS, SUFFIXES2, ROBOTS_MAX_MS, CADENCE_MIN_MS, CRAWL_MAX_S, SAUTS_MAX, BORNE_OCTETS, UA };
