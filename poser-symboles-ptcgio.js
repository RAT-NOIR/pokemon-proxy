// ============================================================
// LES SYMBOLES DE SET MANQUANTS, DEPUIS images.pokemontcg.io — `sets.symbole`, à partir d'un appariement DÉJÀ PROUVÉ en base (lot symboles-2026-10)
// ============================================================
//   node poser-symboles-ptcgio.js --plan                                              (lecture seule, 0 requête)
//   node poser-symboles-ptcgio.js --telecharger --cache=<dossier> --plafond=<n>       (règle de réponse commune, ≥ 5 s entre deux requêtes)
//   node poser-symboles-ptcgio.js --planche --cache=<dossier>                          (une image : chaque symbole sur fond clair ET sombre)
//   node lot-additif.js --quoi="symboles pokemontcg.io" --collections=sets -- node poser-symboles-ptcgio.js --ecrire --cache=<dossier> --attendu=<n>
//
// L'IDENTITÉ n'est pas devinée : `sets.visuelsPtcgio.lignes` (le bilan du collecteur de visuels, lot ptcgio-2026-10) liste les identifiants de set pokemontcg.io
// que le dépôt a PROUVÉS à l'œil pour ce set. Un seul identifiant = une identité ; zéro ou plusieurs = le set est sauté, avec sa raison. Une identité TCGdex seule
// (`remplacementTcgdex.tcgdexSet`, langue en) est NOTÉE dans le plan et jamais prise : c'est une décision du coordinateur.
// L'écriture est ADDITIVE : `symbole` d'un set qui n'en a pas, condition `symbole.cleR2` absent relue dans la requête. Les arguments s'écrivent par ce qu'ils AUTORISENT.
// 🔑 Rien ne part chez un tiers sans la règle commune de réponse d'hôte (collecte-cartes/reponse-hote.js : défi, fausse page introuvable, pause, arrêt durable) :
// ce fichier l'APPELLE (garderHote, lireImage), il n'en garde aucune copie. Chemin demandé : `/<id>/symbol.png` et `/robots.txt`, rien d'autre ; l'API n'est jamais atteinte.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE = 'pokemontcg.io';
const LOT = 'symboles-2026-10';
const LOT_IDENTITE = 'ptcgio-2026-10';
const HOTE = 'images.pokemontcg.io';
const HOTE_TCGDEX = 'assets.tcgdex.net';
const SOURCE_TCGDEX = 'tcgdex';
const CHEMIN_SYMBOLE_TCGDEX = /^\/univ\/[a-z0-9]{1,12}\/[a-z0-9.-]{2,24}\/symbol\.png$/;
const CADENCE_MS = 5000;
const REESSAI_MS = 30000;
const CRAWL_DELAY_MAX_S = 60;
const TAILLE_MIN = 24;
const CHEMIN_SYMBOLE = /^\/[a-z0-9-]{2,24}\/symbol\.png$/;
const ID_LISIBLE = /^[a-z0-9-]{2,24}$/;
const SLUG_LISIBLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ── les arguments : écrits par ce qu'ils AUTORISENT ──────────────────────────────────────────────────────────────────────────────────────────────
const AUTORISES = [/^--(plan|telecharger|planche|ecrire)$/, /^--cache=.+$/, /^--plafond=[1-9]\d{0,4}$/, /^--attendu=\d{1,5}$/];
const PAR_MODE = { plan: [], telecharger: ['cache', 'plafond'], planche: ['cache'], ecrire: ['cache', 'attendu'] };
function parserArguments(argv) {
    const args = argv.slice();
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) throw new Error(`argument inconnu : ${inconnus.join(' ')} — autorisés : --plan | --telecharger --cache= --plafond= | --planche --cache= | --ecrire --cache= --attendu=`);
    const modes = args.filter(a => /^--(plan|telecharger|planche|ecrire)$/.test(a)).map(a => a.slice(2));
    if (modes.length !== 1) throw new Error(`il faut exactement un mode parmi --plan, --telecharger, --planche, --ecrire (reçu : ${modes.join(', ') || 'aucun'})`);
    const mode = modes[0];
    const val = nom => { const a = args.find(x => x.startsWith(`--${nom}=`)); return a === undefined ? null : a.slice(nom.length + 3); };
    const donnees = { cache: val('cache'), plafond: val('plafond') === null ? null : Number(val('plafond')), attendu: val('attendu') === null ? null : Number(val('attendu')) };
    for (const [nom, v] of Object.entries(donnees)) {
        if (PAR_MODE[mode].includes(nom) && v === null) throw new Error(`--${mode} exige --${nom}=`);
        if (!PAR_MODE[mode].includes(nom) && v !== null) throw new Error(`--${nom}= n'a pas de sens avec --${mode}`);
    }
    return { mode, ...donnees };
}

// ── le plan, pur ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const urlSymbole = id => `https://${HOTE}/${id}/symbol.png`;
const urlSymboleTcgdex = (serie, id) => `https://${HOTE_TCGDEX}/univ/${serie}/${id}/symbol.png`;
/** Vrai si l'adresse est EXACTEMENT `https://images.pokemontcg.io/<id>/symbol.png` ou `https://assets.tcgdex.net/univ/<série>/<id>/symbol.png` (aucun paramètre, port ni identifiant), faux sinon. */
function cheminPermis(url) {
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
    return (u.hostname === HOTE && CHEMIN_SYMBOLE.test(u.pathname)) || (u.hostname === HOTE_TCGDEX && CHEMIN_SYMBOLE_TCGDEX.test(u.pathname));
}
/** Le nom d'hôte d'une adresse permise, sinon null. */
const hoteDe = url => (cheminPermis(url) ? new URL(url).hostname : null);
/**
 * La SÉRIE TCGdex d'un set, lue dans une adresse TCGdex DÉJÀ en base sur ce set (`logoFr`, `logoOfficiel.<langue>` : `/<langue>/<série>/<id>/logo.(png|webp)`) — jamais devinée.
 * L'`<id>` du chemin doit être égal à `tcgdexSet`, sinon l'adresse n'est pas celle de ce set. (`tcgdex_sets` ne porte pas la série : forme réelle `{_id, lu, n}`, liste `{id, name, cardCount}`.)
 * @returns {{serie: string, ou: string}|{raison: string}}
 */
function serieTcgdex(s, tcgdexSet) {
    const sources = [['logoFr', s.logoFr], ...Object.entries(s.logoOfficiel || {}).map(([l, v]) => [`logoOfficiel.${l}`, v])];
    const trouvees = new Map();
    let divergente = false;
    for (const [ou, v] of sources) {
        for (const adresse of [v?.urlSource, v?.urlOriginal]) {
            if (typeof adresse !== 'string') continue;
            let u; try { u = new URL(adresse); } catch { continue; }
            if (u.hostname !== HOTE_TCGDEX) continue;
            const m = /^\/([a-z]{2})\/([a-z0-9]{1,12})\/([a-z0-9.-]{2,24})\/logo\.(png|webp)$/.exec(u.pathname);
            if (!m) continue;
            if (m[3] !== tcgdexSet) { divergente = true; continue; }
            if (!trouvees.has(m[2])) trouvees.set(m[2], ou);
        }
    }
    if (trouvees.size > 1) return { raison: 'serie-ambigue' };
    if (trouvees.size === 1) { const [serie, ou] = [...trouvees][0]; return { serie, ou }; }
    return { raison: divergente ? 'id-du-chemin-different' : 'serie-introuvable' };
}
const aUnSymbole = s => typeof s.symbole?.cleR2 === 'string' && s.symbole.cleR2 !== '';
/**
 * @param {Array<object>} sets  documents `sets` (champs : _id, nomAffichage, tirage, region, symbole, visuelsPtcgio, remplacementTcgdex)
 * @returns {{population: number, lignes: Array, sautes: Array, tcgdexSeul: Array, parTirage: object}}
 */
function planifier(sets) {
    if (!Array.isArray(sets) || !sets.length) throw new Error('planifier : aucun set lu — la base ou le champ est faux (un vide fabriqué n\'est pas un plan)');
    const SCRYDEX = require('./collecte-cartes/ptcgio').SETS_SCRYDEX;
    const population = sets.filter(s => typeof s.nomAffichage === 'string' && s.nomAffichage.trim() !== '' && !/-Additionals$/i.test(String(s._id)) && !aUnSymbole(s));
    if (!population.length) throw new Error(`planifier : population vide sur ${sets.length} sets lus (nomAffichage chaîne, hors -Additionals, sans symbole.cleR2) — champ faux ou rien à faire ? un vide ne se déclare pas sans l'avoir ouvert`);
    const lignes = [], sautes = [], tcgdexNotee = [], parTirage = {}, parSource = {};
    const poser = (l) => { lignes.push(l); parTirage[l.tirage] = (parTirage[l.tirage] || 0) + 1; parSource[l.source] = (parSource[l.source] || 0) + 1; };
    for (const s of population) {
        const slug = String(s._id), tirage = s.tirage ?? s.region ?? null, nom = s.nomAffichage;
        if (!SLUG_LISIBLE.test(slug)) { sautes.push({ slug, raison: 'slug-illisible' }); continue; }
        // 1. pokemontcg.io : exactement un identifiant dans visuelsPtcgio.lignes (inchangé)
        const l = s.visuelsPtcgio?.lignes;
        let raisonP = null, idP = null;
        if (!Array.isArray(l) || l.length === 0) raisonP = null;
        else if (l.length !== 1) raisonP = 'identite-multiple';
        else if (typeof l[0] !== 'string' || !ID_LISIBLE.test(l[0])) raisonP = 'identifiant-illisible';
        else if (SCRYDEX.includes(l[0])) raisonP = 'hote-scrydex';
        else idP = l[0];
        const tcg = typeof s.remplacementTcgdex?.tcgdexSet === 'string' && s.remplacementTcgdex.tcgdexSet.trim() !== '' ? s.remplacementTcgdex.tcgdexSet.trim() : null;
        if (idP) {
            poser({ slug, nom, tirage, id: idP, url: urlSymbole(idP), source: SOURCE });
            if (tcg) tcgdexNotee.push({ slug, tcgdexSet: tcg });          // les deux identités existent : pokemontcg.io gagne, TCGdex est seulement noté
            continue;
        }
        // 2. TCGdex : l'identité du collecteur de remplacement (quelle que soit sa langue), la série lue dans une adresse déjà en base
        if (tcg) {
            if (!/^[a-z0-9.-]{2,24}$/.test(tcg)) { sautes.push({ slug, raison: raisonP ?? 'identifiant-illisible' }); continue; }
            const r = serieTcgdex(s, tcg);
            if (r.serie) { poser({ slug, nom, tirage, id: tcg, url: urlSymboleTcgdex(r.serie, tcg), source: SOURCE_TCGDEX, tcgdexSet: tcg, serie: r.serie, serieOu: r.ou }); continue; }
            sautes.push({ slug, raison: raisonP ?? r.raison });
            continue;
        }
        sautes.push({ slug, raison: raisonP ?? 'identite-absente' });
    }
    return { population: population.length, lignes, sautes, tcgdexNotee, parTirage, parSource };
}

// ── les refus, purs ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** @param {Array<{slug: string, meta: object}>} entrees  une entrée par fichier du cache. @returns {{gardes: Array, refuses: Array<{slug, raison}>}} */
function decider(entrees) {
    const partage = new Map();
    for (const e of entrees) if (e.meta?.statut === 200 && e.meta.sha1) partage.set(e.meta.sha1, (partage.get(e.meta.sha1) || 0) + 1);
    const gardes = [], refuses = [];
    for (const e of entrees) {
        const m = e.meta || {};
        const raison = m.statut !== 200 ? `statut-${m.statut}`
            : (!m.decodable || !m.format || !Number.isInteger(m.w) || !Number.isInteger(m.h)) ? 'image-non-decodable'
                : m.format !== 'png' ? 'format-non-png'
                    : (m.w < TAILLE_MIN || m.h < TAILLE_MIN) ? 'trop-petit'
                        : partage.get(m.sha1) > 1 ? 'sha1-partage' : null;
        if (raison) refuses.push({ slug: e.slug, raison }); else gardes.push(e);
    }
    return { gardes, refuses };
}
/** La clé R2, NEUTRE : jamais le nom de la source. */
function cleSymbole(slug, sha1) {
    if (!SLUG_LISIBLE.test(String(slug))) throw new Error(`cleSymbole : slug « ${slug} » illisible`);
    if (!/^[0-9a-f]{40}$/.test(String(sha1))) throw new Error('cleSymbole : sha1 illisible');
    return `symboles/${slug}-${sha1.slice(0, 10)}.png`;
}

// ── le cache ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const fichierMeta = (cache, slug) => path.join(cache, `${slug}.json`);
const fichierImage = (cache, slug) => path.join(cache, `${slug}.png`);
function lireMeta(cache, slug) {
    try { return JSON.parse(fs.readFileSync(fichierMeta(cache, slug), 'utf8')); } catch { return null; }
}

// ── le transport réel : les deux hôtes d'images de ce lot, rien d'autre ──────────────────────────────────────────────────────────────────────────
const UA = 'pokemon-proxy-catalogue/1.0 (mesure, cadence lente)';
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        const robots = (() => { try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === HOTE || u.hostname === HOTE_TCGDEX) && u.pathname === '/robots.txt' && !u.search; } catch { return false; } })();
        if (!robots && !cheminPermis(url)) throw new Error(`adresse hors de ce que ce lot demande : aucune requête (${url})`);   // le dernier mètre avant fetch : jamais une API
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }   // une redirection n'est JAMAIS suivie
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const cfMitigated = r.headers.get('cf-mitigated');
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), cfMitigated };
        const type = r.headers.get('content-type') || '';
        if (r.status === 404 || r.status === 410) return { status: r.status, type, cfMitigated };
        if (binaire && r.ok && /^image\//.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()), cfMitigated };
        return { status: r.status, type, texte: await r.text(), cfMitigated };
    }
};

// ── le téléchargement, par la règle commune de réponse d'hôte ────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {{lignes: Array, cache: string, plafond: number, transport?: {get: Function}, pause?: Function, now?: Function, suivi?: object, dossierPauses?: string, journal?: Function}} o
 *   `plafond` : le nombre MAXIMAL d'adresses demandées dans ce lancement — plus à demander que le plafond, et rien ne part.
 */
async function telecharger({ lignes, cache, plafond, transport = null, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, suivi = null, dossierPauses = null, journal = console.log }) {
    const RH = require('./collecte-cartes/reponse-hote');
    const P = require('./collecte-cartes/ptcgio');
    const T = require('./collecte-cartes/tpc');
    const sharp = require('sharp');
    const tr = transport || transportFetch;
    const sv = suivi || RH.suiviDuProcessus();
    const dp = dossierPauses || RH.DOSSIER_PAUSES;
    if (!Number.isInteger(plafond) || plafond < 1) throw new Error('telecharger : plafond obligatoire (entier ≥ 1)');
    for (const l of lignes) if (!cheminPermis(l.url)) throw new Error(`telecharger : « ${l.url} » hors de ce que ce lot demande (https://${HOTE}/<id>/symbol.png ou https://${HOTE_TCGDEX}/univ/<série>/<id>/symbol.png) — aucune requête`);
    fs.mkdirSync(cache, { recursive: true });
    const bilan = { demandes: 0, telecharges: 0, absents: 0, repris: 0, transitoires: 0, arret: null, arrets: [] };
    const aDemander = [];
    for (const l of lignes) { const m = lireMeta(cache, l.slug); if (m && m.url === l.url && m.statut != null) bilan.repris++; else aDemander.push(l); }
    if (aDemander.length > plafond) throw new Error(`telecharger : ${aDemander.length} adresses à demander pour un plafond de ${plafond} — rien n'est demandé (relancer avec un plafond assumé)`);
    if (!aDemander.length) return bilan;

    // UN état PAR HÔTE (les deux hôtes alternent dans le plan) : dernière requête, cadence, robots.txt, arrêt, transitoires de suite
    const hotes = new Map();
    const eh = h => hotes.get(h) || hotes.set(h, { dernier: null, cadence: CADENCE_MS, robots: undefined, arrete: false, transitoiresDeSuite: 0 }).get(h);
    // ≥ 5 s (ou le Crawl-delay de robots.txt) entre deux requêtes sur LE MÊME hôte : la première part sans attente, les suivantes attendent le reste de la cadence
    const requete = async (hote, url, o) => {
        const e = eh(hote);
        if (e.dernier !== null) { const a = e.dernier + e.cadence - now(); if (a > 0) await pause(a); }
        e.dernier = now();
        return tr.get(url, o);
    };
    const noterArret = (hote, motif) => { eh(hote).arrete = true; bilan.arrets.push({ hote, motif }); bilan.arret = bilan.arret ?? { hote, motif }; journal(`   🛑 ${hote} : ${motif}`); };
    // robots.txt : relu une fois PAR HÔTE, avant sa première image ; un défi sur robots.txt arrête l'hôte (règle commune)
    const lireRobots = async hote => {
        const e = eh(hote);
        if (e.robots !== undefined) return e.robots;
        const adresse = `https://${hote}/robots.txt`;
        const rr = await requete(hote, adresse, {});
        const motif = RH.detecterDefi(RH.entreeDepuisClient(rr, { borne: 5000 }));
        if (motif !== null) { RH.arretHote(hote, `${motif} sur robots.txt`, { dossier: dp, url: adresse }); noterArret(hote, `${motif} sur robots.txt`); e.robots = null; return null; }
        let robots = null;
        if (rr.status === 404 || rr.status === 410) robots = null;
        else if (rr.status === 200) robots = rr.texte ?? '';
        else throw new Error(`robots.txt de ${hote} illisible (HTTP ${rr.status}) — on ne peut pas conclure, aucune image`);
        if (robots !== null) {
            const d = T.delaiDesRobots(robots, P.UA);
            if (d && d > CRAWL_DELAY_MAX_S) throw new Error(`robots.txt de ${hote} demande un Crawl-delay de ${d} s — on s'arrête`);
            if (d) e.cadence = Math.max(e.cadence, d * 1000);
        }
        e.robots = robots;
        return robots;
    };

    for (const l of aDemander) {
        const HOTE_L = new URL(l.url).hostname, e = eh(HOTE_L);
        if (e.arrete) { journal(`   · ${l.slug} : ${HOTE_L} arrêté, non demandé`); continue; }
        try { RH.garderHote(HOTE_L, dp, sv); }                          // une pause ou un arrêt qui tient : aucune requête vers cet hôte
        catch (x) { if (x.bloque || x.pauseHote) { noterArret(HOTE_L, x.message); continue; } throw x; }
        const robots = await lireRobots(HOTE_L);
        if (e.arrete) continue;
        const chemin = new URL(l.url).pathname;
        if (robots !== null && !T.autoriseParRobots(robots, chemin, P.UA)) throw Object.assign(new Error(`robots.txt de ${HOTE_L} interdit ${chemin} — aucune requête`), { robots: true });
        let r;
        try { r = await requete(HOTE_L, l.url, { binaire: true }); }
        catch (x) { if (!x.reseau) throw x; await pause(REESSAI_MS); e.dernier = now(); r = await tr.get(l.url, { binaire: true }); }
        if (r.status >= 500) { await pause(REESSAI_MS); e.dernier = now(); r = await tr.get(l.url, { binaire: true }); }
        bilan.demandes++;
        let lu;
        try { lu = RH.lireImage(r, { suivi: sv, hote: HOTE_L, url: l.url, dossierPauses: dp }); }
        catch (x) {
            if (x.transitoire) {
                bilan.transitoires++; e.transitoiresDeSuite++;
                journal(`   ⚠️ ${l.slug} : ${x.message} (transitoire — à refaire au prochain lancement)`);
                if (e.transitoiresDeSuite >= 2) noterArret(HOTE_L, 'deux réponses transitoires de suite');
                continue;
            }
            if (x.bloque || x.pauseHote) { noterArret(HOTE_L, x.message); continue; }
            throw x;
        }
        e.transitoiresDeSuite = 0;
        const base = { slug: l.slug, nom: l.nom, id: l.id, url: l.url, source: l.source ?? SOURCE, tirage: l.tirage ?? null, le: new Date().toISOString() };
        if (lu.absente) {
            fs.writeFileSync(fichierMeta(cache, l.slug), JSON.stringify({ ...base, statut: 404, issue: lu.issue }));
            bilan.absents++; journal(`   · ${l.slug} (${l.id}) : absent (${lu.issue})`);
            continue;
        }
        const octets = lu.octets;
        let w = null, h = null, format = null, decodable = false;
        try { const md = await sharp(octets).metadata(); w = md.width ?? null; h = md.height ?? null; format = md.format ?? null; decodable = !!(w && h && format); } catch { /* non décodable */ }
        fs.writeFileSync(fichierImage(cache, l.slug), octets);
        fs.writeFileSync(fichierMeta(cache, l.slug), JSON.stringify({ ...base, statut: 200, type: r.type ?? null, octets: octets.length, sha1: crypto.createHash('sha1').update(octets).digest('hex'), w, h, format, decodable }));
        bilan.telecharges++; journal(`   + ${l.slug} (${l.id}) : ${octets.length} octets, ${w}×${h} ${format}`);
    }
    return bilan;
}

/** Les entrées du cache pour les lignes du plan : { ...ligne, meta, fichier } ; une ligne sans méta est absente de la liste (jamais demandée). */
function lireCache(cache, lignes) {
    const entrees = [];
    for (const l of lignes) { const meta = lireMeta(cache, l.slug); if (meta && meta.url === l.url) entrees.push({ ...l, meta, fichier: fichierImage(cache, l.slug) }); }
    return entrees;
}

// ── la planche : chaque symbole sur fond clair ET sur fond sombre, avec son slug et son nom dessous ─────────────────────────────────────────────
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function fabriquerPlanche(items, { colonnes = 4 } = {}) {
    const sharp = require('sharp');
    const demiW = 130, zoneH = 120, legendeH = 52, celluleW = demiW * 2, celluleH = zoneH + legendeH;
    const n = items.length, cols = Math.max(1, Math.min(colonnes, n || 1)), lignes = Math.max(1, Math.ceil(n / cols));
    const W = cols * celluleW, H = lignes * celluleH;
    const compo = [];
    for (let i = 0; i < n; i++) {
        const x = (i % cols) * celluleW, y = Math.floor(i / cols) * celluleH, it = items[i];
        const sym = await sharp(it.buffer).resize({ width: demiW - 20, height: zoneH - 20, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
        const dx = Math.floor((demiW - sym.info.width) / 2), dy = Math.floor((zoneH - sym.info.height) / 2);
        compo.push({ input: { create: { width: demiW, height: zoneH, channels: 3, background: { r: 240, g: 240, b: 240 } } }, left: x, top: y });
        compo.push({ input: { create: { width: demiW, height: zoneH, channels: 3, background: { r: 34, g: 34, b: 34 } } }, left: x + demiW, top: y });
        compo.push({ input: sym.data, left: x + dx, top: y + dy });
        compo.push({ input: sym.data, left: x + demiW + dx, top: y + dy });
        const coupe = (t, k) => (String(t).length > k ? `${String(t).slice(0, k - 1)}…` : String(t));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${celluleW}" height="${legendeH}"><rect width="100%" height="100%" fill="#ffffff" stroke="#999999" stroke-width="1"/>` +
            `<text x="6" y="20" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#000000">${esc(coupe(it.slug, 34))}</text>` +
            `<text x="6" y="40" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#333333">${esc(coupe(it.nom ?? '', 38))}</text></svg>`;
        compo.push({ input: Buffer.from(svg), left: x, top: y + zoneH });
    }
    const buffer = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(compo).png().toBuffer();
    return { buffer, w: W, h: H, celluleW, celluleH, demiW };
}

// ── l'écriture : additive, jamais d'écrasement ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {{lignes: Array, cache: string, attendu: number, db: object, r2: {verifierBucket: Function, deposerBinaire: Function}, bucket: string, maintenant?: Function}} o
 * @returns {{ecrits: string[], refuses: Array, nonEcrits: Array<{slug, raison}>}}
 */
async function ecrire({ lignes, cache, attendu, db, r2, bucket, maintenant = () => new Date() }) {
    const { cleVignette, fabriquerVignetteSymbole } = require('./collecte-cartes/vignette');
    if (!Number.isInteger(attendu) || attendu < 0) throw new Error('ecrire : --attendu obligatoire (entier)');
    const entrees = lireCache(cache, lignes);
    const { gardes, refuses } = decider(entrees);
    if (gardes.length !== attendu) throw new Error(`ecrire : ${gardes.length} symbole(s) à écrire pour --attendu=${attendu} (${refuses.length} refusé(s) : ${refuses.map(r => `${r.slug} ${r.raison}`).join(', ') || 'aucun'}) — rien n'est écrit`);
    // le cache est relu AVANT toute écriture : un fichier qui n'a plus le sha1 de sa méta n'est pas celui qu'on a décidé
    const aEcrire = [];
    for (const g of gardes) {
        let buf; try { buf = fs.readFileSync(g.fichier); } catch (e) { throw new Error(`ecrire : ${g.slug} : fichier du cache illisible (${e.message}) — rien n'est écrit`); }
        if (crypto.createHash('sha1').update(buf).digest('hex') !== g.meta.sha1 || buf.length !== g.meta.octets) throw new Error(`ecrire : ${g.slug} : le fichier du cache n'est pas celui de sa méta (sha1 ou taille) — rien n'est écrit`);
        aEcrire.push({ g, buf });
    }
    await r2.verifierBucket(bucket);
    const S = db.collection('sets');
    const ecrits = [], nonEcrits = [];
    for (const { g, buf } of aEcrire) {
        const doc = await S.findOne({ _id: g.slug }, { projection: { 'symbole.cleR2': 1 } });
        if (!doc) { nonEcrits.push({ slug: g.slug, raison: 'set-absent' }); continue; }
        if (doc.symbole?.cleR2) { nonEcrits.push({ slug: g.slug, raison: 'symbole-apparu' }); continue; }
        const cleR2 = cleSymbole(g.slug, g.meta.sha1);
        await r2.deposerBinaire(bucket, cleR2, buf, 'image/png');
        const vg = await fabriquerVignetteSymbole(buf);
        const cv = cleVignette(cleR2);
        await r2.deposerBinaire(bucket, cv, vg.buffer, 'image/webp');
        const tcgdex = g.source === SOURCE_TCGDEX;
        const preuve = tcgdex ? `identité remplacementTcgdex.tcgdexSet « ${g.tcgdexSet} » ; série lue dans ${g.serieOu} (« ${g.serie} ») ; le set n'avait pas de symbole`
            : `identité visuelsPtcgio.lignes (lot ${LOT_IDENTITE}) ; le set n'avait pas de symbole`;
        const valeur = { cleR2, w: g.meta.w, h: g.meta.h, octets: g.meta.octets, sha1: g.meta.sha1, fichier: 'symbol.png', source: tcgdex ? SOURCE_TCGDEX : SOURCE, urlOriginal: g.url, mention: '© Pokémon / The Pokémon Company', lot: LOT, retirable: true,
            preuve, le: maintenant(), vignette: { cleR2: cv, w: vg.w, h: vg.h } };
        // la condition du plan, relue dans la requête : un symbole apparu depuis n'est jamais écrasé
        const u = await S.updateOne({ _id: g.slug, 'symbole.cleR2': { $exists: false } }, { $set: { symbole: valeur } });
        if (u.matchedCount === 1 && u.modifiedCount === 1) ecrits.push(g.slug); else nonEcrits.push({ slug: g.slug, raison: 'symbole-apparu' });
    }
    return { ecrits, refuses, nonEcrits };
}

module.exports = { SOURCE, LOT, LOT_IDENTITE, HOTE, parserArguments, planifier, urlSymbole, cheminPermis, decider, cleSymbole, telecharger, lireCache, fabriquerPlanche, ecrire };

// ── la ligne de commande : exécutée SEULEMENT en ligne de commande ───────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    require('dotenv').config();
    let a;
    try { a = parserArguments(process.argv.slice(2)); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const PROJECTION = { nomAffichage: 1, tirage: 1, region: 1, symbole: 1, visuelsPtcgio: 1, remplacementTcgdex: 1, logoFr: 1, logoOfficiel: 1 };
    (async () => {
        if (a.mode === 'planche') {
            const metas = fs.readdirSync(a.cache).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(a.cache, f), 'utf8'))).filter(m => m.statut === 200 && m.decodable)
                .sort((x, y) => x.slug.localeCompare(y.slug));
            if (!metas.length) { console.error('❌ aucun symbole décodable dans le cache'); process.exit(1); }
            const items = metas.map(m => ({ slug: m.slug, nom: m.nom, buffer: fs.readFileSync(fichierImage(a.cache, m.slug)) }));
            const p = await fabriquerPlanche(items, { colonnes: 4 });
            const sortie = path.join(a.cache, 'planche-symboles.png');
            fs.writeFileSync(sortie, p.buffer);
            console.log(`planche : ${items.length} symboles, ${p.w}×${p.h} → ${sortie}`);
            return;
        }
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: a.mode === 'ecrire' ? ['R2_BUCKET_IMAGES'] : [], lectureSeule: a.mode !== 'ecrire' });
        try {
            const sets = await cx.db.collection('sets').find({}, { projection: PROJECTION }).toArray();
            const avecIdentite = sets.filter(s => Array.isArray(s.visuelsPtcgio?.lignes)).length;
            if (!avecIdentite) throw new Error(`aucun des ${sets.length} sets ne porte visuelsPtcgio.lignes — champ faux ou bilan retiré : un plan vide serait fabriqué`);
            const P = planifier(sets);
            console.log(`DÉNOMINATEUR : ${sets.length} sets lus · ${avecIdentite} portent visuelsPtcgio.lignes · population (nomAffichage, hors -Additionals, sans symbole.cleR2) : ${P.population}`);
            console.log(`PLAN : ${P.lignes.length} à planifier (par source : ${Object.entries(P.parSource).map(([t, n]) => `${t} ${n}`).join(', ')} ; par tirage : ${Object.entries(P.parTirage).map(([t, n]) => `${t} ${n}`).join(', ')}) · ${P.sautes.length} sautés`);
            const parRaison = {}; for (const s of P.sautes) parRaison[s.raison] = (parRaison[s.raison] || 0) + 1;
            for (const [r, n] of Object.entries(parRaison)) console.log(`   sauté « ${r} » : ${n}${r === 'identite-absente' ? '' : ` — ${P.sautes.filter(s => s.raison === r).map(s => s.slug).join(', ')}`}`);
            console.log(`   identité TCGdex aussi portée par un set pris chez pokemontcg.io (seulement notée) : ${P.tcgdexNotee.length}${P.tcgdexNotee.length ? ` — ${P.tcgdexNotee.map(t => `${t.slug}=${t.tcgdexSet}`).join(', ')}` : ''}`);
            for (const l of P.lignes) console.log(`   + ${l.source.padEnd(13)} ${String(l.tirage).padEnd(8)} ${l.slug.padEnd(48)} ${l.url}${l.serieOu ? `   (série lue dans ${l.serieOu})` : ''}`);
            if (a.mode === 'plan') { console.log('   (plan seul — 0 requête, rien d\'écrit)'); return; }
            if (a.mode === 'telecharger') {
                const b = await telecharger({ lignes: P.lignes, cache: a.cache, plafond: a.plafond });
                console.log(`\nTÉLÉCHARGEMENT : demandées ${b.demandes} · gardées ${b.telecharges} · absentes ${b.absents} · reprises du cache ${b.repris} · transitoires ${b.transitoires}${b.arret ? ` · 🛑 ARRÊT : ${b.arret.motif}` : ''}`);
                if (b.arret) process.exitCode = 1;
                return;
            }
            const r2 = require('./collecte-cartes/r2');
            const R = await ecrire({ lignes: P.lignes, cache: a.cache, attendu: a.attendu, db: cx.db, r2, bucket: process.env.R2_BUCKET_IMAGES });
            const entrees = lireCache(a.cache, P.lignes);
            const D = decider(entrees);
            const parRefus = {}; for (const r of D.refuses) parRefus[r.raison] = (parRefus[r.raison] || 0) + 1;
            console.log(`\n${R.ecrits.length === a.attendu && !R.nonEcrits.length ? '✅' : '🔴'} écrits ${R.ecrits.length} / attendu ${a.attendu} · refusés ${D.refuses.length} ${JSON.stringify(parRefus)} · non écrits ${R.nonEcrits.length}`);
            for (const n of R.nonEcrits) console.log(`   ⚠️ ${n.slug} : non écrit (${n.raison})`);
            for (const r of D.refuses) console.log(`   ✖ ${r.slug} : refusé (${r.raison})`);
            console.log(`SETS : ${R.ecrits.join(',')}`);
            if (R.nonEcrits.length) process.exitCode = 1;
        } finally { await fermer(); }
    })().catch(e => { console.error(e); process.exit(1); });
}
