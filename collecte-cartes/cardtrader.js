// ============================================================
// CARDTRADER — énumération par les sitemaps et appariement (lot CARDTRADER-PLAN, 2026-10-18). AUCUNE image, AUCUNE écriture en base.
// ============================================================
// Fonctions PURES (robots.txt, sitemaps, blueprints, familles) + un client à transport injectable. Toute réponse passe par la règle commune
// (collecte-cartes/reponse-hote.js : défi -> arrêt durable de l'hôte, pause, garde avant requête) ; ici on l'APPELLE, on ne la recopie pas.
// Le contenu d'un sitemap est une DONNÉE : jamais une instruction. Un sitemap hors de l'hôte est ignoré.
// Code neutre pour le lot d'écriture futur : `ctr` (source/lot/préfixe de clé R2) — jamais le nom de la source dans une adresse publique.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const RH = require('./reponse-hote');
const T = require('./tpc');

const HOTE = 'www.cardtrader.com';
const SOURCE_RACINE = 'cardtrader.com';
const UA = 'rat-market-catalogue/1.0 (+https://rat-market.fr ; une requete / 6 s)';
const CADENCE_MIN_MS = 5000;
const CODE_NEUTRE = 'ctr';

const hoteOk = u => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === HOTE; } catch { return false; } };

/** Les sitemaps déclarés par robots.txt, sur l'hôte seulement. */
function sitemapsDesRobots(texte) {
    const r = [];
    for (const brut of String(texte ?? '').split(/\r?\n/)) {
        const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(brut.replace(/#.*$/, ''));
        if (m && hoteOk(m[1]) && !r.includes(m[1])) r.push(m[1]);
    }
    return r;
}

const entites = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&');
const loc = s => { const m = /<(?:[\w-]+:)?loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:[\w-]+:)?loc>/.exec(s); return m ? entites(m[1].trim()) : null; };

/** Un sitemap : { type: 'index'|'urlset', entrees: [{ loc, images: [] }] }. LÈVE sur tout ce qui n'est ni l'un ni l'autre (un défi n'est pas un sitemap vide). */
function lireSitemap(xml) {
    const t = String(xml ?? '');
    const index = /<(?:[\w-]+:)?sitemapindex[\s>]/.test(t), urlset = /<(?:[\w-]+:)?urlset[\s>]/.test(t);
    if (!index && !urlset) throw new Error('sitemap illisible : ni sitemapindex ni urlset');
    const balise = index ? 'sitemap' : 'url';
    const entrees = [];
    for (const m of t.matchAll(new RegExp(`<${balise}>([\\s\\S]*?)</${balise}>`, 'g'))) {
        const corps = m[1];
        const images = [...corps.matchAll(/<image:image>([\s\S]*?)<\/image:image>/g)].map(x => loc(x[1])).filter(Boolean);
        const sansImages = corps.replace(/<image:image>[\s\S]*?<\/image:image>/g, '');
        const l = loc(sansImages);
        if (l) entrees.push({ loc: l, images });
    }
    return { type: index ? 'index' : 'urlset', entrees };
}

/** Une adresse d'image de blueprint -> { id, slug }, ou null. */
function blueprintDepuisImage(url) {
    const m = /\/uploads\/blueprints\/image\/(\d+)\/(?:[a-z]+_)?([^/?#]+?)\.(?:jpe?g|png|webp)(?:\?.*)?$/i.exec(String(url ?? ''));
    return m ? { id: Number(m[1]), slug: m[2] } : null;
}

/** Une expansion CardTrader (son slug) -> famille utile, ou null. */
function familleDeExpansion(slug) {
    const s = String(slug ?? '').toLowerCase();
    let m;
    if ((m = /^world-championship-decks?-(\d{4})$/.exec(s))) return { famille: 'wcd', cle: m[1] };
    if (/^play-pokemon-prize-pack(?:-series)?(?:-(.+))?$/.test(s)) return { famille: 'pp', cle: /^play-pokemon-prize-pack(?:-series)?-?(.*)$/.exec(s)[1] || null };
    if (/^battle-academy(?:-(\d{4}))?$/.test(s)) return { famille: 'ba', cle: /(\d{4})/.exec(s)?.[1] ?? null };
    return null;
}

// ── le transport réel : l'agent du dépôt seul, aucun cookie, aucune redirection suivie, l'hôte nommé seul ─────────────────────────────────────
const transportFetch = {
    async get(url) {
        if (!hoteOk(url)) throw new Error(`cardtrader : adresse hors de l'hôte autorisé — aucune requête (${url})`);
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' }, redirect: 'manual', signal: AbortSignal.timeout(60000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const type = r.headers.get('content-type') || '';
        const cfMitigated = r.headers.get('cf-mitigated');
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), type, cfMitigated };
        let octets = Buffer.from(await r.arrayBuffer());
        if (octets[0] === 0x1f && octets[1] === 0x8b) octets = zlib.gunzipSync(octets);
        return { status: r.status, type, texte: octets.toString('utf8'), cfMitigated };
    }
};

const nomCache = url => `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}-${url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9.-]+/g, '_').slice(0, 80)}.json`;

/**
 * Le client : une file à cadence (>= 5 s entre deux requêtes), un plafond, un cache disque. `robots` : le texte de robots.txt (null = aucune règle ; l'initialisation réelle le lit).
 * @returns {{lire: Function, requetes: Function, initialiserRobots: Function}}
 */
function fabriquerClient({ dossierCache, plafond, transport = transportFetch, cadenceMs = 6000, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, dossierPauses = RH.DOSSIER_PAUSES, robots = null, suivi = RH.suiviDuProcessus() }) {
    if (!Number.isInteger(plafond) || plafond < 1) throw new Error('cardtrader : un plafond de requêtes (entier >= 1) est obligatoire');
    const cadence = Math.max(cadenceMs, CADENCE_MIN_MS);
    let n = 0, dernier = null, texteRobots = robots;
    fs.mkdirSync(dossierCache, { recursive: true });
    const fichier = url => path.join(dossierCache, nomCache(url));

    async function lire(url, { robotsTxt = false } = {}) {
        if (!hoteOk(url)) throw new Error(`cardtrader : adresse hors de l'hôte autorisé — aucune requête (${url})`);
        const f = fichier(url);
        if (fs.existsSync(f)) return { ...JSON.parse(fs.readFileSync(f, 'utf8')), cache: true };
        RH.garderHote(SOURCE_RACINE, dossierPauses, suivi);
        const p = new URL(url).pathname;
        if (!robotsTxt && !T.autoriseParRobots(texteRobots, p, UA)) throw new Error(`robots.txt interdit ${p} — aucune requête`);
        if (n >= plafond) throw Object.assign(new Error(`plafond de requêtes atteint (${plafond})`), { plafond: true });
        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
        dernier = now(); n++;
        const r = await transport.get(url);
        const defi = RH.detecterDefi(RH.entreeDepuisClient(r, { borne: 5000 }));
        if (defi) {
            let f2 = null; try { f2 = RH.arretHote(SOURCE_RACINE, `${defi} (HTTP ${r.status})`, { dossier: dossierPauses, url }); } catch (e) { suivi.bloquer(SOURCE_RACINE, `écriture de l'arrêt impossible (${e.message})`); }
            throw Object.assign(new Error(`${SOURCE_RACINE} BLOQUÉ (${defi}) sur ${url} — ARRÊT définitif de l'hôte${f2 ? ` (${f2})` : ''}`), { bloque: true, arretDefinitif: true, status: r.status });
        }
        if (r.status !== 200 && r.status !== 404) throw Object.assign(new Error(`HTTP ${r.status} sur ${url} — réponse non prévue, on s'arrête`), { status: r.status });
        const sortie = { url, status: r.status, type: r.type || '', texte: r.status === 200 ? r.texte : '', le: new Date(now()).toISOString() };
        fs.writeFileSync(f, JSON.stringify(sortie));
        return { ...sortie, cache: false };
    }
    async function initialiserRobots() {
        const r = await lire(`https://${HOTE}/robots.txt`, { robotsTxt: true });
        if (r.status !== 200) throw new Error(`robots.txt illisible (HTTP ${r.status}) : on ne peut pas conclure`);
        texteRobots = r.texte;
        const d = T.delaiDesRobots(texteRobots, UA);
        if (d && d * 1000 > cadence) throw new Error(`robots.txt demande un Crawl-delay de ${d} s : au-delà de la cadence prévue, on s'arrête`);
        return r;
    }
    return { lire, requetes: () => n, initialiserRobots, texteRobots: () => texteRobots };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LES BLUEPRINTS : ce que porte l'adresse de page d'un sitemap — /en-US/cards/<id>-<nom>-<…>-<expansion>. Formes relevées le 2026-10-18 (cache du lot).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const norm = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MOTS_FINITION = new Set(['non', 'holo', 'cosmos', 'reverse']);
const MOTS_RARETE = new Set(['holo', 'rare', 'shiny', 'ultra', 'secret', 'double', 'reverse', 'promo', 'non', 'illustration', 'special', 'art', 'amazing', 'radiant', 'hyper', 'rainbow', 'cosmos', 'full']);
const NON_CODES = new Set(['ex', 'gx', 'v', 'vmax', 'vstar', 'tag', 'team', 'star', 'break', 'energy', 'lv', 'prism', 'delta', 'stamp', 'deck']);
const estNb = t => /^\d+$/.test(t);

/** Une adresse de page de sitemap -> blueprint { id, famille: 'wcd'|'pp'|'ba', annee, nom, numero, total, code, … } | { type: 'scelle' } | null (autre jeu, autre expansion). */
function blueprintDepuisPage(url) {
    const m = /\/en-US\/cards\/(\d+)-([a-z0-9-]+)$/.exec(String(url ?? ''));
    if (!m) return null;
    const id = Number(m[1]), reste = m[2];
    let f;
    if ((f = /^(.*)-world-championship-decks-(\d{4})$/.exec(reste))) {
        const corps = f[1];
        const g = /^(.+?)-wcd-(\d{4})-(.+)$/.exec(corps);
        if (!g) return { id, famille: 'wcd', annee: f[2], type: 'scelle', slug: reste };
        const queue = g[3];
        let num = null, tot = null, code = null, avant = queue;
        let q;
        if ((q = /^(.*?)-?unnumbered$/.exec(queue))) avant = q[1];
        else if ((q = /^(.*?)-(\d+)-(\d+)$/.exec(queue))) { avant = q[1]; num = Number(q[2]); tot = Number(q[3]); }
        else if ((q = /^(.*?)-([a-z]+)(\d+)$/.exec(queue))) { avant = q[1]; code = q[2]; num = Number(q[3]); }
        else if ((q = /^(.*?)-(\d+)$/.exec(queue))) { avant = q[1]; num = Number(q[2]); }
        const mots = norm(avant).split(' ').filter(Boolean);
        while (mots.length && MOTS_RARETE.has(mots[mots.length - 1])) mots.pop();
        return { id, famille: 'wcd', annee: f[2], nom: norm(g[1]), joueur: mots.join(' '), numero: num, total: tot, code, finition: null, slug: reste };
    }
    if ((f = /^(.*)-play-pokemon-prize-pack-series$/.exec(reste))) {
        const mots = f[1].split('-');
        if (!mots.some(estNb)) return { id, famille: 'pp', type: 'scelle', slug: reste };
        let numero = null, total = null, code = null;
        const dernier = mots[mots.length - 1];
        if (!estNb(dernier)) return { id, famille: 'pp', nom: norm(f[1]), numero: null, total: null, code: null, finition: null, slug: reste };
        mots.pop();
        const avant = mots[mots.length - 1];
        if (avant && estNb(avant)) { total = Number(dernier); numero = Number(avant); mots.pop(); }
        else { numero = Number(dernier); if (avant && /^[a-z]{2,5}$/.test(avant) && !NON_CODES.has(avant) && !MOTS_FINITION.has(avant)) { code = avant; mots.pop(); } }
        const fin = [];
        while (mots.length && MOTS_FINITION.has(mots[mots.length - 1])) fin.unshift(mots.pop());
        return { id, famille: 'pp', nom: norm(mots.join(' ')), numero, total, code, finition: fin.length ? fin.join(' ') : null, slug: reste };
    }
    if ((f = /^(.*)-battle-academy-(2020|2022|2024)$/.exec(reste))) {
        if (/^battle-academy-\d{4}$/.test(`battle-academy-${f[2]}`) && f[1] === `battle-academy-${f[2]}`) return { id, famille: 'ba', annee: f[2], type: 'scelle', slug: reste };
        const t = f[1].split('-');
        let deck = null, position = null;
        const marq = t[t.length - 1];
        const iStamp = t.lastIndexOf('stamp');
        if (['stamped', 'stamp', 'deck'].includes(marq)) { t.pop(); deck = t.pop() ?? null; }
        else if (iStamp > 0) { deck = t[iStamp - 1]; if (estNb(t[iStamp + 1] ?? '')) position = Number(t[iStamp + 1]); t.splice(iStamp - 1); }
        else if (t.length > 2 && estNb(t[t.length - 1]) && /^[a-z]+$/.test(t[t.length - 2])) { position = Number(t.pop()); deck = t.pop(); }
        const nombres = [];
        while (t.length && estNb(t[t.length - 1])) nombres.unshift(Number(t.pop()));
        let numero = null, total = null;
        if (nombres.length >= 3) { [numero, total] = nombres; if (position == null) position = nombres[2]; }
        else if (nombres.length === 2) { [numero, total] = nombres; }
        else if (nombres.length === 1) numero = nombres[0];
        return { id, famille: 'ba', annee: f[2], nom: norm(t.join(' ')), numero, total, position, deck, code: null, finition: null, slug: reste };
    }
    return null;
}

/** Le slug Cardmarket d'un produit (WCD / PP / BA) -> { nom, code, numero, variante } | null (jamais deviné). */
function produitDepuisSlug(slug, famille) {
    if (typeof slug !== 'string' || !slug) return null;
    const p = slug.split('-');
    let variante = null, code = null, numero = null;
    if (famille === 'ba') {
        const dernier = p[p.length - 1];
        if (/^BA\d{2}[A-Z]*$/.test(dernier)) p.pop();
        else { const m = /^([A-Za-z]+)(\d+)$/.exec(dernier); if (m) { code = m[1].toLowerCase(); numero = Number(m[2]); p.pop(); } }
        const v = p[p.length - 1];
        if (/^V\d+$/.test(v)) { variante = v; p.pop(); }
        return p.length ? { nom: norm(p.join(' ')), code, numero, variante } : null;
    }
    if (!estNb(p[p.length - 1] ?? '')) return null;
    numero = Number(p.pop());
    const c = p[p.length - 1] ?? '';
    const m = famille === 'pp' ? /^PPS\d([A-Za-z0-9]*)$/.exec(c) : /^(?:WCD)?\d{2}([A-Za-z0-9]+)$/.exec(c);
    if (m) { code = m[1] ? m[1].toLowerCase() : null; p.pop(); }
    else if (famille === 'wcd' && /^[A-Za-z][A-Za-z0-9]{2,}$/.test(c) && !/^V\d+$/.test(c)) { code = c.toLowerCase(); p.pop(); }
    if (/^V\d+$/.test(p[p.length - 1] ?? '')) { variante = p.pop(); }
    return p.length ? { nom: norm(p.join(' ')), code, numero, variante } : null;
}

const entier = x => { const m = /^\D*(\d+)\D*$/.exec(String(x ?? '')); return m ? Number(m[1]) : null; };

/**
 * L'appariement : chaque produit -> { idProduct, statut: 'apparie'|'ambigu'|'introuvable'|'refuse-temoin', blueprint?, candidats?, cause?, temoin }.
 * LA CLÉ (nom + numéro d'origine [+ code d'origine] + année/position) N'EST PAS LE TÉMOIN : le TÉMOIN est le total imprimé (le dénominateur du numéro), lu sur les impressions de la carte jointe — une donnée
 * que la clé n'utilise pas. Un candidat que le témoin contredit est écarté ; s'ils le sont tous, le produit est REFUSÉ (jamais apparié par défaut).
 * Plusieurs candidats ne se départagent JAMAIS par un choix : joueurs (WCD), finitions (PP), positions (BA) -> 'ambigu', liste à l'appui.
 * @param {object[]} produits { idProduct, famille, annee?, serie?, slug, numeroCM?, impressions?: [{numero,total}], carteNom? }
 * @param {object[]} blueprints sortie de blueprintDepuisPage (les 'scelle' sont ignorés)
 */
function apparier(produits, blueprints) {
    const singles = blueprints.filter(b => b && b.nom && !b.type);
    const parFam = new Map();
    for (const b of singles) { const k = `${b.famille}|${b.annee ?? ''}`; (parFam.get(k) || parFam.set(k, []).get(k)).push(b); }
    const parPP = singles.filter(b => b.famille === 'pp');
    return produits.map(pr => {
        const s = produitDepuisSlug(pr.slug, pr.famille);
        if (!s) return { idProduct: pr.idProduct, statut: 'introuvable', cause: 'slug-illisible', temoin: 'absent' };
        const noms = new Set([s.nom, norm(pr.carteNom)].filter(Boolean));
        const pool = pr.famille === 'pp' ? parPP : (parFam.get(`${pr.famille}|${pr.annee ?? ''}`) || []);
        let codeContredit = false;
        let cands = pool.filter(b => noms.has(b.nom) && (s.numero == null ? b.numero == null : b.numero === s.numero));
        if (pr.famille === 'pp') {
            const avant = cands.length;
            cands = cands.filter(b => !(s.code && b.code) || s.code === b.code);
            codeContredit = avant > 0 && cands.length === 0;
        }
        if (pr.famille === 'ba') {
            const m = /^([A-Z])(\d+)$/.exec(pr.numeroCM ?? '');
            if (m) cands = cands.filter(b => b.position === Number(m[2]) && (b.deck ?? '').startsWith(m[1].toLowerCase()));
        }
        if (!cands.length) return { idProduct: pr.idProduct, statut: 'introuvable', cause: codeContredit ? 'code-contredit' : 'aucun-blueprint', temoin: 'absent' };
        // le témoin : le total
        const imps = Array.isArray(pr.impressions) ? pr.impressions : [];
        const avecTemoin = cands.map(b => {
            if (b.total == null || b.numero == null) return { b, t: 'non-applicable' };
            if (!imps.length) return { b, t: 'absent' };
            return { b, t: imps.some(i => entier(i.numero) === b.numero && entier(i.total) === b.total) ? 'confirme' : 'contredit' };
        });
        const gardes = avecTemoin.filter(x => x.t !== 'contredit');
        if (!gardes.length) return { idProduct: pr.idProduct, statut: 'refuse-temoin', cause: 'total-contredit', candidats: cands.map(b => b.id), temoin: 'contredit' };
        const temoin = gardes.every(x => x.t === 'confirme') ? 'confirme' : gardes.some(x => x.t === 'confirme') ? 'confirme' : gardes[0].t;
        if (gardes.length === 1) return { idProduct: pr.idProduct, statut: 'apparie', blueprint: gardes[0].b, temoin, preuve: `${pr.famille} ${s.nom} n°${s.numero ?? '—'}${s.code ? ` (${s.code})` : ''}${gardes[0].b.total != null ? ` /${gardes[0].b.total}` : ''}` };
        const bs = gardes.map(x => x.b);
        const cause = pr.famille === 'wcd' ? (new Set(bs.map(b => b.joueur)).size > 1 ? 'joueurs' : 'doublon')
            : pr.famille === 'pp' ? (new Set(bs.map(b => b.finition ?? '')).size > 1 ? 'finition' : 'doublon') : 'position';
        return { idProduct: pr.idProduct, statut: 'ambigu', cause, candidats: bs.map(b => b.id), temoin };
    });
}

/**
 * Les produits SERVIS — le prédicat de mesure-catalogue.js (VISUELS), recopié mot pour mot : une carte jointe qui porte une image DE CE SET, et que ce n'est pas le scan japonais du jumeau
 * (entrée `langue: ja` sous un set non jp). `imagesParCarte` : Map carteId -> entrées de cartes.images ; `regionDe` : Map slug du set -> region (jp, intl…).
 */
function produitsServis({ liens, imagesParCarte, regionDe, slugParProduit = null }) {
    const servis = new Set();
    const scanDuJumeau = i => i.langue === 'ja' && regionDe.get(i.set) !== 'jp';
    for (const l of liens) {
        if (slugParProduit && !slugParProduit.has(l.idProduct)) continue;
        if (servis.has(l.idProduct)) continue;
        const s = (slugParProduit && slugParProduit.get(l.idProduct)) || l.slugSet;
        const entrees = imagesParCarte.get(l.carteId);
        if (!entrees || !entrees.length) continue;
        const bons = new Set(entrees.filter(i => !scanDuJumeau(i)).map(i => i.set));
        if (bons.has(l.slugSet) || bons.has(s)) servis.add(l.idProduct);
    }
    return servis;
}

module.exports = { blueprintDepuisPage, produitDepuisSlug, apparier, produitsServis, norm, HOTE, SOURCE_RACINE, UA, CADENCE_MIN_MS, CODE_NEUTRE, sitemapsDesRobots, lireSitemap, blueprintDepuisImage, familleDeExpansion, fabriquerClient, transportFetch, hoteOk };
