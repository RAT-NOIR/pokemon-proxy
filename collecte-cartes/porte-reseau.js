// ============================================================
// LA PORTE RÉSEAU UNIQUE — 2026-11-01, décision du testeur
// ============================================================
// Deux écarts du 01/11 : une page de pokebip.com lue AVANT son robots.txt (qui l'interdit) ; une requête vers www.misprint.com, hôte déjà fermé. Les deux passaient par WebFetch, qui ignore
// nos règles. Décision : « une seule porte d'accès réseau pour tous les sous-agents. Elle refuse toute requête vers un hôte fermé, et toute page tant que le robots.txt de l'hôte n'a pas été
// lu et respecté. » Le hook .claude/hooks/porte-reseau.js refuse les autres chemins (WebFetch, curl, scripts réseau non suivis) ; ici vit le seul chemin qui passe.
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : https, sans identifiants ni port, hôte ni exclu ni fermé, robots.txt LU (200, ou 404 = « aucune règle ») puis RESPECTÉ pour les trois agents.
// Toute erreur, tout état non prévu REFUSE et le dit (« je ne sais pas » n'est jamais « tout va bien »).
//
// Les décisions ne sont PAS recopiées : l'hôte fermé et le défi sont ceux de reponse-hote.js (hoteRacine, arretHote, detecterDefi, classerReponseImage) ; la lecture de robots.txt est celle
// de tpc.js (autoriseParRobots, delaiDesRobots) ; le transport réel est celui de recolte-hote.js (agent du dépôt, aucun cookie, redirect manual). Ici : la version GÉNÉRALE (pas de table fermée d'hôtes).
//
//   CLI  node collecte-cartes/porte-reseau.js verifier <url> [--image]
//        node collecte-cartes/porte-reseau.js lire <url> --sortie=<fichier> [--texte] [--image]
//        node collecte-cartes/porte-reseau.js fermer <hôte> --motif="…"          (le coordinateur)
//   Sortie : 0 = fait, 3 = refusé (ou hôte arrêté), 2 = usage, 1 = échec technique (HTTP non 200, réseau, écriture).
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
const DOSSIER_PORTE_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\porte-reseau';

function configurer(o = {}) {
    return {
        mode: o.mode === undefined ? 'page' : o.mode,
        transport: o.transport || RHT.transportFetch,
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

// ── gardes 1 à 3 : l'adresse, les exclus, les hôtes fermés (synchrones, sans réseau) ─────────────────────────────────────────────────────────
function exclusion(hote, mode) {
    if (/(^|\.)vinted\.[a-z.]+$/.test(hote)) return 'Vinted est exclu par décision (refus permanent)';
    if (/(^|\.)cardmarket\.[a-z.]+$/.test(hote)) return 'Cardmarket est exclu par décision (refus permanent)';
    if (hote.includes('pokecardex')) {
        if ((hote === 'pokecardex.com' || hote === 'www.pokecardex.com') && mode === 'page') return null;      // consultation de pages HTML seulement
        return 'Pokécardex : pages HTML de pokecardex.com en consultation seulement ; ni image, ni son CDN (refus permanent)';
    }
    return null;
}
function hoteFerme(hote, dossier) {
    let noms;
    try { fs.mkdirSync(dossier, { recursive: true }); noms = fs.readdirSync(dossier); }
    catch (e) { return `dossier des arrêts illisible (${e.message}) : tout est refusé`; }
    const racine = RH.hoteRacine(hote);
    for (const n of noms) {
        const m = /^ARRET-HOTE-(.+)\.json$/i.exec(n);
        if (!m) continue;
        const h = m[1].toLowerCase();
        if (h === hote || RH.hoteRacine(h) === racine) {
            let motif = 'fichier illisible : on ne sait pas, l\'arrêt tient';
            try { const j = JSON.parse(fs.readFileSync(path.join(dossier, n), 'utf8')); if (j && typeof j === 'object') motif = j.motif ?? 'arrêt définitif'; } catch { /* illisible : fermé */ }
            return `hôte fermé (${n}, racine ${racine}) : ${motif} — aucune requête tant que le coordinateur ne l'a pas levé`;
        }
    }
    return null;
}
/** Gardes 1 à 3. @returns {{motif: string|null, u?: URL, hote?: string, racine?: string}} */
function gardeSimple(url, c) {
    if (c.mode !== 'page' && c.mode !== 'image') return { motif: `mode « ${String(c.mode)} » inconnu (page ou image)` };
    let u;
    try { u = new URL(url); } catch { return { motif: `adresse illisible (${String(url).slice(0, 120)})` }; }
    if (u.protocol !== 'https:') return { motif: 'https seulement' };
    if (u.username || u.password || u.port) return { motif: 'ni identifiants ni port dans l\'adresse' };
    const hote = u.hostname.toLowerCase();
    if (!hote || !hote.includes('.') || /^[\d.]+$/.test(hote) || hote.includes(':')) return { motif: `hôte « ${hote} » : un nom de domaine public est exigé` };
    const racine = RH.hoteRacine(hote);
    const ex = exclusion(hote, c.mode);
    if (ex) return { motif: ex, hote, racine };
    const f = hoteFerme(hote, c.dossierArrets);
    if (f) return { motif: f, hote, racine };
    return { motif: null, u, hote, racine };
}

// ── la requête : cadence par racine, journal, redirections ─────────────────────────────────────────────────────────────────────────────────────
function delaiDeCadence(c, hote) {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(c.dossierPorte, 'robots', `${hote.replace(/[^a-z0-9.-]/gi, '_')}.json`), 'utf8'));
        if (Number(j.crawlDelay) > 0) return Math.max(CADENCE_MIN_MS, Number(j.crawlDelay) * 1000);
    } catch { /* pas de robots au cache : cadence minimale */ }
    return CADENCE_MIN_MS;
}
/** UNE requête : on attend l'écart de la racine, l'heure d'envoi est écrite AVANT l'envoi, la réponse est journalisée. */
async function envoyer(url, c, { binaire }) {
    const u = new URL(url), hote = u.hostname.toLowerCase(), racine = RH.hoteRacine(hote);
    const fc = path.join(c.dossierPorte, 'cadence', `${racine}.json`);
    const delai = delaiDeCadence(c, hote);
    if (fs.existsSync(fc)) {
        let dernier = null;
        try { dernier = Number(JSON.parse(fs.readFileSync(fc, 'utf8')).dernier); } catch { /* illisible : on attend l'écart entier */ }
        const attente = Number.isFinite(dernier) ? dernier + delai - c.maintenant() : delai;
        if (attente > 0) await c.pause(attente);
    }
    const f = hoteFerme(hote, c.dossierArrets);                    // un arrêt écrit PENDANT l'attente (autre processus) bloque aussi
    if (f) throw erreurRefus(f, { hote });
    fs.mkdirSync(path.dirname(fc), { recursive: true });
    fs.writeFileSync(fc, JSON.stringify({ dernier: c.maintenant(), url: origineChemin(url) }));
    let r;
    try { r = await c.transport.get(url, { binaire }); }
    catch (e) { journaliser(c, { url: origineChemin(url), mode: c.mode, decision: 'requete', status: 'erreur', motif: String(e.message).slice(0, 200), octets: 0 }); throw e; }
    const octets = r.octets ? r.octets.length : Buffer.byteLength(r.texte || '');
    journaliser(c, { url: origineChemin(url), mode: c.mode, decision: 'requete', status: r.status, octets });
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
        const ici = new URL(courant);
        const memeRacine = suivant.protocol === 'https:' && !suivant.username && !suivant.password && !suivant.port && RH.hoteRacine(suivant.hostname.toLowerCase()) === RH.hoteRacine(ici.hostname.toLowerCase());
        if (!memeRacine) return { r, ailleurs: suivant.href, urlFinale: courant };
        if (saut >= SAUTS_MAX) return { refus: `plus de ${SAUTS_MAX} redirections : on ne peut pas conclure` };
        courant = suivant.href;
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
async function robotsDe(u, hote, racine, c) {
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
        const delais = AGENTS.map(a => T.delaiDesRobots(r.texte, a)).filter(Boolean);
        rec = { statut: 'present', status: 200, texte: String(r.texte ?? ''), crawlDelay: delais.length ? Math.max(...delais) : null };
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
    const rb = await robotsDe(u, hote, racine, c);
    if (rb.motif) return { ok: false, motif: rb.motif, hote, racine };
    const chemin = u.pathname + u.search;
    for (const agent of AGENTS) {
        if (!T.autoriseParRobots(rb.rec.texte, chemin, agent)) return { ok: false, motif: `robots.txt de ${hote} interdit ${chemin} pour l'agent « ${agent} »`, hote, racine };
    }
    if (Number(rb.rec.crawlDelay) > CRAWL_MAX_S) return { ok: false, motif: `robots.txt de ${hote} demande un Crawl-delay de ${rb.rec.crawlDelay} s (> ${CRAWL_MAX_S} s)`, hote, racine };
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
    const res = await envoyerSuivi(url, c, {
        binaire: c.mode === 'image',
        juger: async x => { const v = await verdict(x, c); return v.ok ? null : v.motif; },
    });
    if (res.refus) throw erreurRefus(res.refus);
    const r = res.r, urlFinale = res.urlFinale;
    const u = new URL(urlFinale), racine = RH.hoteRacine(u.hostname.toLowerCase());
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
        if (/^\s*image\//i.test(String(r.type || '')) && u.hostname.toLowerCase().includes('pokecardex')) throw erreurRefus('Pokécardex : aucune image (refus permanent)');
        corps = Buffer.from(o.texte ? htmlEnTexte(r.texte) : r.texte, 'utf8');
    }
    if (!corps || corps.length > BORNE_OCTETS) throw new Error(`${origineChemin(urlFinale)} : ${corps ? `réponse trop grande (${corps.length} octets, borne ${BORNE_OCTETS})` : 'aucun octet'} — rien n'est écrit`);
    fs.mkdirSync(path.dirname(path.resolve(o.sortie)), { recursive: true });
    fs.writeFileSync(o.sortie, corps);
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
        const f = RH.arretHote(cible.toLowerCase(), drapeaux.motif, { dossier: configurer().dossierArrets });
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

module.exports = { verdict, lire, htmlEnTexte, gardeSimple, exclusion, hoteFerme, AGENTS, ROBOTS_MAX_MS, CADENCE_MIN_MS, CRAWL_MAX_S, SAUTS_MAX, BORNE_OCTETS, UA };
