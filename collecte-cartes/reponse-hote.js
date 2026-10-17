// ============================================================
// LA RÉPONSE D'UN HÔTE D'IMAGES — UNE SEULE RÈGLE, POUR TOUS LES COLLECTEURS (décision du testeur, 2026-10-18)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-18), mot pour mot :
//   « Fausse page introuvable : 200 avec un Content-Type text/html au lieu d'image/*, sans aucun marqueur de défi. L'adresse est traitée comme ABSENTE et on passe à la suivante.
//     Garde l'empreinte de cette page : si elle revient identique, c'est la même page introuvable.
//     Défi : marqueurs Cloudflare ou anti-robot (« Just a moment », cf-chl, challenge, captcha), 401, 403, 410, 429 ou 503 avec un défi. Arrêt DÉFINITIF de l'hôte, comme avant.
//     Plus de 20 fausses pages introuvables d'affilée : pause de l'hôte et note dans le rapport (sans doute des adresses mal construites). Ce n'est pas un arrêt définitif. »
//
// POURQUOI UN MODULE : la règle existait en plusieurs exemplaires (§21 bis) — chaque client (pokumon, ptcgio, tpc, pikaqian) et chaque collecteur (pkmncards, pokemoncom) avait SA détection
// des défis et SA réaction à « 200 qui n'est pas une image » ; l'un arrêtait pour toujours sur une simple page HTML, l'autre la prenait pour une image. Ici : une fonction PURE qui
// CLASSE la réponse dans une liste FERMÉE, un compteur par hôte, et la table de réaction. Les clients et les collecteurs APPELLENT ce module ; aucun ne garde sa copie.
//
// 🔴 LA RÈGLE S'ÉCRIT PAR CE QU'ELLE AUTORISE : seules `image`, `absente` et `fausse-absente` laissent continuer. Tout ce qui n'est pas prévu (3xx non suivi, 200 sans Content-Type,
// JSON, `image/*` aux octets faux, 4xx inattendu…) est `inattendue` : PAUSE de l'hôte, motif au rapport. Un défaut, par définition, est ce qu'on n'a pas prévu.
//
// LE MOT « challenge » SEUL est AMBIGU (ruling du coordinateur) : des noms de sets le portent (« Gym Challenge », « Challenge from the Darkness »), et une page introuvable dont le menu
// cite ces sets déclencherait un faux arrêt définitif (c'est ce qui est arrivé à pokedata). Seuls les marqueurs TECHNIQUES prouvent un défi. Le mot seul donne une pause PERSISTANTE de l'hôte,
// levée par le coordinateur seulement (un fichier qui nomme l'empreinte et un extrait borné) ; le coordinateur peut ensuite déclarer l'empreinte « page introuvable connue »
// (collecte-cartes/pages-introuvables-connues.json, une liste par hôte) : la page vaut alors `fausse-absente`.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ISSUES = Object.freeze(['image', 'absente', 'fausse-absente', 'defi', 'ambigue', 'transitoire', 'inattendue']);
const LAISSENT_CONTINUER = Object.freeze(['image', 'absente', 'fausse-absente']);
const BORNE_CORPS = 512 * 1024;                 // ce que la règle lit d'un corps : jamais plus. Un corps lu jusqu'à cette borne est COUPÉ : sans marqueur, il ne prouve rien (inattendue)
const SEUIL_FAUSSES = 20;                       // « plus de 20 » : la 21e fausse absence consécutive met l'hôte en pause
const STATUTS_DEFI = Object.freeze([401, 403, 410, 429]);
const EXTRAIT_MAX = 500;
const FICHIER_CONNUES = path.join(__dirname, 'pages-introuvables-connues.json');

// ── les marqueurs TECHNIQUES d'un défi (liste fermée, ruling 2) ──────────────────────────────────────────────────────────────────────────────
// « Attention Required » (page de blocage Cloudflare) et « Incapsula incident » (page de blocage Imperva) étaient dans les listes des clients et des collecteurs ; ils y restent.
const MARQUEURS = Object.freeze([
    [/just a moment/i, 'Just a moment'],
    [/cf[-_]chl/i, 'cf-chl'],                              // cf-chl, __cf_chl, cf_chl_
    [/challenge-platform/i, 'challenge-platform'],
    [/challenges\.cloudflare\.com/i, 'challenges.cloudflare.com'],
    [/\/cdn-cgi\/challenge/i, '/cdn-cgi/challenge'],
    [/cf-challenge/i, 'cf-challenge'],
    [/captcha/i, 'captcha'],                               // recaptcha, hcaptcha, g-recaptcha…
    [/turnstile/i, 'turnstile'],
    [/_Incapsula_Resource/i, '_Incapsula_Resource'],
    [/incapsula incident/i, 'Incapsula incident'],
    [/attention required/i, 'Attention Required']
]);

// ── l'entrée : des octets, un type, des en-têtes ─────────────────────────────────────────────────────────────────────────────────────────────
const bornerCorps = c => (Buffer.isBuffer(c) ? c.subarray(0, BORNE_CORPS) : c instanceof Uint8Array ? Buffer.from(c.subarray(0, BORNE_CORPS)) : Buffer.alloc(0));
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
/** Les en-têtes, en minuscules : un objet simple ou un `Headers`. Rien d'autre que ce que la règle lit. */
function enTetes(e) {
    const lus = {};
    const CLES = ['cf-mitigated', 'x-cdn', 'x-iinfo', 'content-type', 'location'];
    if (e && typeof e.get === 'function') { for (const k of CLES) { const v = e.get(k); if (v != null) lus[k] = String(v); } return lus; }
    for (const [k, v] of Object.entries(e || {})) if (v != null && v !== false) lus[String(k).toLowerCase()] = String(v);
    return lus;
}
/** Les octets sont-ils ceux d'une image ? PNG, JPEG, GIF, WebP, AVIF — les formats que nos hôtes servent. */
function octetsDImage(b) {
    if (!Buffer.isBuffer(b) || b.length < 12) return false;
    if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return true;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
    if (b.subarray(0, 4).toString('latin1') === 'GIF8') return true;
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return true;
    if (b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis)/.test(b.subarray(8, 12).toString('latin1'))) return true;
    return false;
}
/** Le corps en texte : UTF-16 avec BOM (LE ou BE) décodé, UTF-8 sinon ; un corps qui porte des octets NUL sans BOM est INDÉCODABLE (null) — les marqueurs n'y seraient pas vus. */
function decoder(corps) {
    if (corps.length >= 2 && corps[0] === 0xff && corps[1] === 0xfe) return corps.subarray(2).toString('utf16le');
    if (corps.length >= 2 && corps[0] === 0xfe && corps[1] === 0xff) { const b = Buffer.from(corps.subarray(2)); for (let i = 0; i + 1 < b.length; i += 2) { const x = b[i]; b[i] = b[i + 1]; b[i + 1] = x; } return b.toString('utf16le'); }
    if (corps.includes(0)) return null;
    return corps.toString('utf8');
}
const estHtml = t => /^\s*(text\/html|application\/xhtml)/i.test(t);
const estJson = t => /json/i.test(t);

/**
 * Le défi, s'il y en a un : le MOTIF (une phrase) ou null. Marqueurs techniques seulement — jamais le mot « challenge » seul. `analyserCorps` : faux pour un JSON (une liste n'est pas une page de défi).
 * @returns {string|null}
 */
function motifDeDefi({ statut, h, corps, image, type, corpsAnalyse = true }) {
    if (STATUTS_DEFI.includes(statut)) return `HTTP ${statut}`;
    if (h['cf-mitigated']) return `en-tête cf-mitigated: ${h['cf-mitigated']}`;
    if (corpsAnalyse && !image && corps.length && !estJson(type)) {
        const texte = decoder(corps);
        if (texte === null) return null;
        for (const [re, nom] of MARQUEURS) if (re.test(texte)) return `marqueur « ${nom} » dans le corps${statut === 503 ? ' (503 avec un défi)' : ''}`;
        // Imperva : l'en-tête SEUL ne prouve rien (une vraie image passe par Imperva) ; avec un corps qui n'est pas une image, et hors d'un vrai 404, c'est son défi
        if ((/imperva|incapsula/i.test(h['x-cdn'] || '') || h['x-iinfo']) && statut !== 404) return 'x-cdn: Imperva avec un corps qui n\'est pas une image';
    }
    return null;
}

/**
 * Détecte un défi dans une réponse qui n'est PAS une image à classer (robots.txt, liste JSON, page HTML) — la même définition, le même module. Rend le motif ou null.
 * `{ statut, typeContenu, entetes, debutCorps }`. Le mot « challenge » seul n'est pas un défi ici : seule une image à classer peut être « ambigue ».
 */
function detecterDefi({ statut, typeContenu, entetes, debutCorps } = {}) {
    const h = enTetes(entetes);
    const corps = bornerCorps(debutCorps);
    const type = String(typeContenu ?? h['content-type'] ?? '');
    return motifDeDefi({ statut: Number(statut), h, corps, image: octetsDImage(corps), type });
}

/** Le fichier des empreintes de « page introuvable connue » : { "<hôte>": ["<sha256>", …] }. Illisible ou mal formé : LÈVE (jamais un repli sur le vide). */
function empreintesConnues(hote, fichier = FICHIER_CONNUES) {
    let j;
    try { j = JSON.parse(fs.readFileSync(fichier, 'utf8')); }
    catch (e) { throw new Error(`reponse-hote : ${fichier} illisible (${e.message}) — les empreintes connues ne se devinent pas`); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`reponse-hote : ${fichier} n'est pas un objet { hôte: [empreintes] }`);
    const l = Object.hasOwn(j, hote) ? j[hote] : [];
    if (!Array.isArray(l) || !l.every(x => /^[0-9a-f]{64}$/.test(x))) throw new Error(`reponse-hote : les empreintes de « ${hote} » dans ${fichier} ne sont pas une liste de sha256`);
    return l;
}

/**
 * LA RÈGLE. Une réponse d'hôte d'images → { issue, motif, empreinte? }, `issue` dans la liste FERMÉE ISSUES.
 * @param {{statut: number, typeContenu?: string, entetes?: object, debutCorps?: Buffer, empreintesConnues?: string[]}} r  `debutCorps` : les premiers octets lus (borné ici à 64 Ko).
 */
function classerReponseImage({ statut, typeContenu, entetes, debutCorps, empreintesConnues: connues = [] } = {}) {
    const s = Number(statut);
    if (statut == null || !Number.isInteger(s)) return { issue: 'inattendue', motif: `statut illisible (${String(statut)})` };
    const h = enTetes(entetes);
    const corps = bornerCorps(debutCorps);
    const type = String(typeContenu ?? h['content-type'] ?? '');
    const image = octetsDImage(corps);
    const defi = motifDeDefi({ statut: s, h, corps, image, type });
    if (defi) return { issue: 'defi', motif: defi };
    if (s >= 500 && s < 600) return { issue: 'transitoire', motif: `HTTP ${s} sans défi` };
    if (s >= 300 && s < 400) return { issue: 'inattendue', motif: `redirection ${s} non suivie` };
    if (s === 404) return { issue: 'absente', motif: 'HTTP 404' };
    if (s === 200) {
        if (/^\s*image\//i.test(type)) {
            if (image) return { issue: 'image', motif: 'HTTP 200, image' };
            return { issue: 'inattendue', motif: corps.length ? `${type.trim()} dont les octets ne sont pas une image` : `${type.trim()} sans aucun octet lu : rien ne prouve l'image` };
        }
        if (estHtml(type)) {
            const texte = decoder(corps);
            if (texte === null) return { issue: 'inattendue', motif: 'corps text/html indécodable (octets NUL sans BOM) : aucun marqueur ne peut y être cherché' };
            if (corps.length >= BORNE_CORPS) return { issue: 'inattendue', motif: `corps text/html plus grand que la borne de lecture (${BORNE_CORPS / 1024} Ko), aucun marqueur dans ces premiers Ko : rien ne prouve une absence` };
            const empreinte = sha256(corps);
            if (connues.includes(empreinte)) return { issue: 'fausse-absente', motif: 'page introuvable connue (empreinte déclarée par le coordinateur)', empreinte };
            if (/challenge/i.test(texte)) return { issue: 'ambigue', motif: 'le mot « challenge » seul, sans marqueur technique (nom de set ou défi ?)', empreinte };
            return { issue: 'fausse-absente', motif: 'HTTP 200 text/html au lieu d\'une image, aucun marqueur de défi', empreinte };
        }
        return { issue: 'inattendue', motif: type.trim() ? `HTTP 200 « ${type.trim().slice(0, 60)} » n'est pas une image` : 'HTTP 200 sans Content-Type' };
    }
    return { issue: 'inattendue', motif: `HTTP ${s} : réponse non prévue` };
}

/**
 * L'adaptateur des transports des clients et des collecteurs ({ status, type, texte | octets, cfMitigated, imperva }) vers l'entrée de la règle.
 * `borne` : ce qu'on lit d'un TEXTE (64 Ko pour une image à classer ; 5 000 caractères pour une page ou une liste, comme les clients le faisaient).
 */
function entreeDepuisClient(r, { borne = BORNE_CORPS, empreintesConnues: connues } = {}) {
    const x = r || {};
    const debutCorps = Buffer.isBuffer(x.octets) ? x.octets.subarray(0, Math.min(borne, BORNE_CORPS))
        : typeof x.texte === 'string' ? Buffer.from(x.texte.slice(0, borne)).subarray(0, Math.min(borne, BORNE_CORPS)) : undefined;
    return { statut: x.status, typeContenu: x.type, entetes: { 'cf-mitigated': x.cfMitigated || undefined, 'x-cdn': x.imperva ? 'Imperva' : x.xCdn || undefined, location: x.location || undefined }, debutCorps, ...(connues ? { empreintesConnues: connues } : {}) };
}

// ── le compteur par hôte ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Un compteur par hôte (une passe = un suivi neuf). Une `image` remet les fausses absences d'affilée à zéro ; une `absente` (vrai 404) ne compte pas ET ne remet pas à zéro ;
 * une `fausse-absente` compte, et son empreinte est gardée avec son nombre. À la (seuil + 1)-ième d'affilée l'hôte passe en pause — collante pour le reste de la passe.
 */
function suiviHote({ seuil = SEUIL_FAUSSES } = {}) {
    if (!Number.isInteger(seuil) || seuil < 1) throw new Error(`reponse-hote : seuil ${seuil} refusé (entier ≥ 1)`);
    const hotes = new Map();
    const etat = h => hotes.get(h) || hotes.set(h, { consecutives: 0, fausses: 0, empreintes: new Map(), pause: false, motifPause: null }).get(h);
    return {
        seuil,
        /** Note la classification d'une réponse de `hote`. @returns {{pause: boolean, consecutives: number}} */
        noter(hote, classement) {
            const e = etat(hote);
            if (classement?.issue === 'inattendue') { e.pause = true; e.motifPause = e.motifPause ?? `réponse inattendue : ${classement.motif}`; }
            if (classement?.issue === 'image') e.consecutives = 0;
            else if (classement?.issue === 'fausse-absente') {
                e.consecutives++; e.fausses++;
                if (classement.empreinte) e.empreintes.set(classement.empreinte, (e.empreintes.get(classement.empreinte) || 0) + 1);
                if (e.consecutives > seuil) { e.pause = true; e.motifPause = e.motifPause ?? `plus de ${seuil} fausses pages introuvables d'affilée (${e.consecutives})`; }
            }
            return { pause: e.pause, consecutives: e.consecutives };
        },
        /** Met un hôte en pause pour la durée du suivi (une écriture de pause impossible, une réponse qu'on ne sait pas lire…). */
        bloquer(hote, motif) { const e = etat(hote); e.pause = true; e.motifPause = e.motifPause ?? motif; },
        /** Le motif de la pause de `hote`, ou null. */
        motifPause(hote) { const e = hotes.get(hote); return e?.pause ? (e.motifPause ?? 'pause de l\'hôte') : null; },
        /** Oublie tout (un banc, ou un nouveau processus simulé). */
        vider() { hotes.clear(); },
        /** Ce que le rapport du collecteur écrit : le nombre de fausses absences, les empreintes distinctes (avec leur nombre), l'hôte en pause ou non. */
        rapport(hote) {
            const e = hotes.get(hote);
            return e ? { hote, fausses: e.fausses, consecutives: e.consecutives, empreintes: [...e.empreintes].map(([empreinte, n]) => ({ empreinte, n })), pause: e.pause }
                : { hote, fausses: 0, consecutives: 0, empreintes: [], pause: false };
        },
        hotesEnPause() { return [...hotes].filter(([, e]) => e.pause).map(([h]) => h); },
        hotes() { return [...hotes.keys()]; }
    };
}

/**
 * LA TABLE DE RÉACTION — la seule : l'issue (et le compteur) disent quoi faire.
 *   continuer · absente (on passe à l'adresse suivante) · transitoire (la réaction actuelle du collecteur : un 5xx interrompt, deux de suite arrêtent)
 *   pause (la passe s'arrête pour cet hôte, sans arrêt définitif) · pause-persistante (fichier de pause, levée par le coordinateur) · arret-definitif (le mécanisme d'arrêt du collecteur)
 * @returns {{action: string, issue: string, motif: string, empreinte?: string}}
 */
function reagir(suivi, hote, classement) {
    // FERMÉE PAR DÉFAUT (§51) : seules `image`, `absente` et `fausse-absente` — avec un suivi — laissent continuer ; une issue inconnue, un suivi absent, une classification absente : PAUSE
    const c = classement || { issue: 'inattendue', motif: 'aucune classification' };
    const base = { issue: c.issue, motif: c.motif, ...(c.empreinte ? { empreinte: c.empreinte } : {}) };
    if (c.issue === 'defi') return { action: 'arret-definitif', ...base };
    if (c.issue === 'ambigue') return { action: 'pause-persistante', ...base };
    if (!suivi) return { action: 'pause', ...base, motif: `aucun suivi de l'hôte ${hote} : sans compteur, rien ne passe (${c.motif})` };
    const n = suivi.noter(hote, c);
    if (c.issue === 'inattendue') return { action: 'pause', ...base };
    if (c.issue === 'transitoire') return { action: 'transitoire', ...base };
    if (n.pause) return { action: 'pause', ...base, motif: suivi.motifPause(hote) ? `${suivi.motifPause(hote)} sur ${hote} — adresses sans doute mal construites ; pause de l'hôte, pas un arrêt définitif` : `pause de l'hôte ${hote}` };
    if (c.issue === 'image') return { action: 'continuer', ...base };
    if (c.issue === 'absente' || c.issue === 'fausse-absente') return { action: 'absente', ...base };
    return { action: 'pause', ...base, motif: `issue inconnue « ${String(c.issue)} » : ce qui n'est pas prévu bloque` };
}

// ── la pause PERSISTANTE (issue `ambigue`) ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Le fichier de pause d'un hôte, dans `dossier` : le nom d'hôte est aplati, jamais un chemin. */
const fichierPause = (dossier, hote) => path.join(path.resolve(dossier), `PAUSE-HOTE-${String(hote).replace(/[^A-Za-z0-9.-]/g, '_').replace(/^\.+/, '_')}.json`);
/** Un extrait borné de la page (texte seul, 500 caractères) : pour que le coordinateur LISE ce qui a déclenché la pause — ni en-tête, ni cookie. */
function extraitBorne(debutCorps) {
    return (decoder(bornerCorps(debutCorps)) ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EXTRAIT_MAX);
}
/** Écrit la pause persistante. Aucune requête vers l'hôte tant qu'elle tient. @returns {string} le chemin du fichier */
function ecrirePausePersistante(dossier, hote, { classement, debutCorps, url = null }) {
    fs.mkdirSync(dossier, { recursive: true });
    let adresse = null;
    try { const u = new URL(url); adresse = `${u.origin}${u.pathname}`; } catch { /* pas d'adresse */ }
    const f = fichierPause(dossier, hote);
    fs.writeFileSync(f, JSON.stringify({ hote, le: new Date().toISOString(), issue: 'ambigue', motif: classement?.motif ?? null, empreinte: classement?.empreinte ?? null, url: adresse, extrait: extraitBorne(debutCorps),
        levee: 'par le coordinateur seulement : supprimer ce fichier, ou déclarer l\'empreinte dans collecte-cartes/pages-introuvables-connues.json' }, null, 1));
    return f;
}
/** La pause d'un hôte, ou null. Un fichier illisible vaut PAUSE (« je ne sais pas » n'est jamais « tout va bien »). */
function lirePausePersistante(dossier, hote) {
    const f = fichierPause(dossier, hote);
    if (!fs.existsSync(f)) return null;
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && typeof j === 'object') return j; } catch { /* illisible */ }
    return { hote, illisible: true, motif: `${f} illisible : on ne sait pas, la pause tient` };
}

// ── l'ARRÊT DURABLE d'un hôte (issue `defi`, pour les clients qui n'ont aucune alerte : artofpkm, Bulbapedia, TCGdex) ──────────────────────────────
// Le même dossier et le même format que la pause persistante, une NATURE distincte (`arret-definitif`) et un fichier distinct. Lu avant toute requête. Seul le coordinateur le lève.
const DOSSIER_PAUSES = process.env.RM_PAUSES_HOTE || path.join(__dirname, 'pauses-hote');
/** La racine d'un hôte (cdn.artofpkm.com → artofpkm.com) : un arrêt vaut pour la SOURCE, pas pour un seul de ses noms d'hôte. */
function hoteRacine(hote) { const l = String(hote).split('.'); return l.length <= 2 ? String(hote) : l.slice(-2).join('.'); }
const fichierArret = (dossier, hote) => path.join(path.resolve(dossier), `ARRET-HOTE-${String(hote).replace(/[^A-Za-z0-9.-]/g, '_').replace(/^\.+/, '_')}.json`);
/** Écrit l'arrêt durable de `hote`. LÈVE si l'écriture échoue (jamais un silence). @returns {string} le chemin du fichier */
function arretHote(hote, motif, { dossier = DOSSIER_PAUSES, url = null } = {}) {
    fs.mkdirSync(dossier, { recursive: true });
    let adresse = null;
    try { const u = new URL(url); adresse = `${u.origin}${u.pathname}`; } catch { /* pas d'adresse */ }
    const f = fichierArret(dossier, hote);
    fs.writeFileSync(f, JSON.stringify({ hote, nature: 'arret-definitif', le: new Date().toISOString(), motif, url: adresse, levee: 'par le coordinateur seulement : supprimer ce fichier' }, null, 1));
    return f;
}
/** L'arrêt durable d'un hôte, ou null. Un fichier illisible vaut ARRÊT (« je ne sais pas » n'est jamais « tout va bien »). */
function hoteArrete(hote, dossier = DOSSIER_PAUSES) {
    const f = fichierArret(dossier, hote);
    if (!fs.existsSync(f)) return null;
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && typeof j === 'object') return j; } catch { /* illisible */ }
    return { hote, nature: 'arret-definitif', illisible: true, motif: `${f} illisible : on ne sait pas, l'arrêt tient` };
}
// ── le registre du PROCESSUS : un suivi par HÔTE pour toute la durée du processus (une pause « plus de 20 » ou « inattendue » ne se perd pas d'une unité à l'autre) ──
const REGISTRE = suiviHote();
const suiviDuProcessus = () => REGISTRE;
const reinitialiserSuiviProcessus = () => REGISTRE.vider();

// ── le geste commun des clients et des collecteurs ───────────────────────────────────────────────────────────────────────────────────────────
/** L'erreur d'une PAUSE : la passe s'arrête pour cet hôte, sans arrêt définitif. `persistante` : un fichier la tient jusqu'à la décision du coordinateur. */
function erreurPause(reaction, hote, url, extra = {}) {
    return Object.assign(new Error(`${hote} EN PAUSE (${reaction.issue} : ${reaction.motif}) sur ${url} — plus aucune requête vers cet hôte${extra.fichier ? `, pause levée par le coordinateur seulement (${extra.fichier})` : ' pour cette passe'}`),
        { pauseHote: true, pausePersistante: reaction.action === 'pause-persistante', hote, issue: reaction.issue, motif: reaction.motif, empreinte: reaction.empreinte ?? null, url, ...extra });
}
/** Refuse de partir si l'hôte porte une pause persistante (aucune requête tant qu'elle tient). */
function garderHote(hote, dossier = DOSSIER_PAUSES, suivi = null) {
    // 1. l'ARRÊT durable (défi) : définitif, jusqu'à la décision du coordinateur
    const a = hoteArrete(hote, dossier);
    if (a) throw Object.assign(new Error(`${hote} ARRÊTÉ DÉFINITIVEMENT (${a.motif ?? 'défi'}) — aucune requête tant que le coordinateur ne l'a pas levé (${fichierArret(dossier, hote)})`), { bloque: true, arretDefinitif: true, hote, motif: a.motif ?? null, fichier: fichierArret(dossier, hote) });
    // 2. la pause du PROCESSUS (suivi) : plus de 20 fausses absences, réponse inattendue
    const m = suivi?.motifPause?.(hote);
    if (m) throw Object.assign(new Error(`${hote} EN PAUSE pour ce processus (${m}) — aucune requête vers cet hôte jusqu'au prochain processus`), { pauseHote: true, pausePersistante: false, hote, motif: m });
    // 3. la pause PERSISTANTE (page ambiguë)
    const p = lirePausePersistante(dossier, hote);
    if (p) throw Object.assign(new Error(`${hote} EN PAUSE PERSISTANTE (${p.motif ?? 'page ambiguë'}, empreinte ${p.empreinte ?? 'inconnue'}) — aucune requête tant que le coordinateur ne l'a pas levée (${fichierPause(dossier, hote)})`), { pauseHote: true, pausePersistante: true, hote, empreinte: p.empreinte ?? null, fichier: fichierPause(dossier, hote) });
}
/**
 * Classe la réponse `r` (forme des transports) d'une IMAGE demandée à `hote`, note le compteur, applique la pause persistante, et rend la réaction.
 * Les empreintes « page introuvable connue » de l'hôte sont lues dans le fichier de données. @returns {{action: string, issue: string, motif: string, empreinte?: string, fichier?: string}}
 */
function traiterImage(r, { suivi, hote, url = null, dossierPauses = DOSSIER_PAUSES, connues = null }) {
    const entree = entreeDepuisClient(r, { empreintesConnues: connues ?? empreintesConnues(hote) });
    const reaction = reagir(suivi, hote, classerReponseImage(entree));
    if (reaction.action === 'pause-persistante') {
        // l'écriture de la pause qui échoue LÈVE une pauseHote (fermé par défaut) : le client s'arrête, il ne continue pas sans fichier
        try { reaction.fichier = ecrirePausePersistante(dossierPauses, hote, { classement: reaction, debutCorps: entree.debutCorps, url }); }
        catch (e) { suivi?.bloquer?.(hote, `écriture de la pause persistante impossible (${e.message})`); throw erreurPause({ ...reaction, motif: `${reaction.motif} ; écriture de la pause persistante impossible (${e.message})` }, hote, url, { ecritureEchouee: true }); }
    }
    return reaction;
}

/**
 * Pour les clients qui LÈVENT sur un résultat (artofpkm, Bulbapedia, TCGdex : leurs collecteurs attrapent l'erreur d'un fichier et passent au suivant) : la même décision, rendue en
 * { octets } (une image), { absente: true, issue } (404 ou fausse page introuvable : le fichier est absent), ou une exception TYPÉE —
 *   `bloque` + `arretDefinitif` (défi), `pauseHote` (+ `pausePersistante`), ou `status` (transitoire, à la réaction actuelle du client).
 * `r` : { status, type, octets | texte, cfMitigated, imperva } ; un 206 (lecture d'un début de fichier) se juge comme un 200.
 */
function lireImage(r, { suivi, hote, url = null, dossierPauses = DOSSIER_PAUSES, connues = null }) {
    const lu = r && r.status === 206 ? { ...r, status: 200 } : r;
    const x = traiterImage(lu, { suivi, hote, url, dossierPauses, connues });
    if (x.action === 'arret-definitif') {
        // l'arrêt est DURABLE : écrit dans le dossier des pauses, lu avant toute requête par garderHote ; si l'écriture échoue, le client s'arrête quand même (il LÈVE bloque)
        let fichier = null, ecriture = null;
        try { fichier = arretHote(hote, `${x.motif} (HTTP ${r?.status ?? '?'})`, { dossier: dossierPauses, url }); } catch (e) { ecriture = e.message; }
        throw Object.assign(new Error(`${hote} BLOQUÉ (${x.motif}) sur ${url} — arrêt définitif de l'hôte${fichier ? ` (${fichier})` : ` ; ÉCRITURE DE L'ARRÊT IMPOSSIBLE (${ecriture})`}`), { bloque: true, arretDefinitif: true, status: r?.status ?? null, hote, issue: x.issue, motif: x.motif, fichier, ...(ecriture ? { ecritureEchouee: true } : {}) });
    }
    if (x.action === 'pause' || x.action === 'pause-persistante') throw erreurPause(x, hote, url, x.fichier ? { fichier: x.fichier } : {});
    if (x.action === 'transitoire') throw Object.assign(new Error(`${r.status} ${url}`), { status: r.status, transitoire: true });
    if (x.action === 'absente') return { absente: true, issue: x.issue, empreinte: x.empreinte ?? null };
    if (x.action !== 'continuer') throw erreurPause({ ...x, action: 'pause', motif: `action inconnue « ${x.action} » : ce qui n'est pas prévu bloque` }, hote, url);
    return { octets: lu.octets };
}

// ── M4 : une fausse absence n'est PAS un absent définitif ───────────────────────────────────────────────────────────────────────────────────
// Dans le cache d'un collecteur : un 404 s'écrit « absent » ; une fausse page introuvable s'écrit « fausse-absente » (empreinte, date, n = 1), est redemandée UNE fois, pas avant 24 h ; une SECONDE
// fausse absence la rend définitive (« absent », fausseAbsente, secondeFois). Une page de maintenance ou un incident passager du CDN ne devient donc jamais un absent sans seconde preuve.
const DELAI_FAUSSE_ABSENCE_MS = 24 * 3600 * 1000;
/** L'entrée de cache d'une adresse absente : precedente (l'entrée déjà au cache ou undefined), x (la réaction), status, maintenant (ms). */
function entreeAbsence(precedente, x, status, maintenant = Date.now()) {
    const le = new Date(maintenant).toISOString();
    if (x?.issue !== 'fausse-absente') return { statut: 'absent', status, le };
    if (precedente?.statut === 'fausse-absente') return { statut: 'absent', status, fausseAbsente: true, secondeFois: true, empreinte: x.empreinte ?? null, premiere: precedente.le ?? null, le };
    return { statut: 'fausse-absente', status, empreinte: x.empreinte ?? null, n: 1, le };
}
/** Une fausse absence vue il y a moins de 24 h : on ne la redemande pas encore. Une date illisible ne bloque pas la nouvelle demande (la seule du reste du cycle). */
function fausseAbsenceRecente(entree, maintenant = Date.now()) {
    if (entree?.statut !== 'fausse-absente') return false;
    const t = Date.parse(entree.le);
    return Number.isFinite(t) && maintenant - t < DELAI_FAUSSE_ABSENCE_MS;
}

module.exports = {
    entreeAbsence, fausseAbsenceRecente, DELAI_FAUSSE_ABSENCE_MS, hoteRacine, fichierArret, arretHote, hoteArrete, suiviDuProcessus, reinitialiserSuiviProcessus, lireImage, ISSUES, LAISSENT_CONTINUER, BORNE_CORPS, SEUIL_FAUSSES, STATUTS_DEFI, MARQUEURS, FICHIER_CONNUES, DOSSIER_PAUSES,
    classerReponseImage, detecterDefi, entreeDepuisClient, octetsDImage, empreintesConnues, suiviHote, reagir,
    fichierPause, extraitBorne, ecrirePausePersistante, lirePausePersistante, erreurPause, garderHote, traiterImage
};
