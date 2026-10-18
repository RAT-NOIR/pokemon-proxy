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
    async get(url, { binaire = false } = {}) {
        if (!hoteOk(url)) throw new Error(`cardtrader : adresse hors de l'hôte autorisé — aucune requête (${url})`);
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': UA, ...(binaire ? {} : { 'Accept-Encoding': 'gzip' }) }, redirect: 'manual', signal: AbortSignal.timeout(60000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const type = r.headers.get('content-type') || '';
        const cfMitigated = r.headers.get('cf-mitigated');
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), type, cfMitigated };
        if (binaire && r.ok && /^image\//i.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()), cfMitigated };
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

    async function lire(url, { robotsTxt = false, reduire = null } = {}) {
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
        // un 5xx (sans défi : le défi a été jugé plus haut) est TRANSITOIRE : l'appelant saute cette adresse, deux de suite l'arrêtent
        if (r.status >= 500 && r.status < 600) throw Object.assign(new Error(`HTTP ${r.status} sur ${url} — erreur serveur transitoire`), { status: r.status, transitoire: true });
        if (r.status !== 200 && r.status !== 404) throw Object.assign(new Error(`HTTP ${r.status} sur ${url} — réponse non prévue, on s'arrête`), { status: r.status });
        const sortie = { url, status: r.status, type: r.type || '', texte: r.status === 200 ? (reduire ? reduire(r.texte) : r.texte) : '', le: new Date(now()).toISOString() };
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
    /**
     * UNE IMAGE de blueprint (/uploads/blueprints/image/<id>/<fichier>) : même file, même plafond, même garde, même cache disque (le fichier .bin à côté de la fiche .json) que les pages.
     * La réponse est jugée par la règle commune (RH.lireImage) : redirection non suivie (pause), défi (arrêt définitif), 200 text/html sans défi = introuvable, tout le reste = pause.
     * @returns {{octets?: Buffer, absente?: boolean, cache: boolean}}
     */
    async function lireImage(url) {
        if (!hoteOk(url) || !CHEMIN_IMAGE.test(new URL(url).pathname)) throw new Error(`cardtrader : adresse d'image hors de ce qui est autorisé (hôte ${HOTE}, /uploads/blueprints/image/<id>/<fichier>) — aucune requête (${url})`);
        const f = fichier(url), fb = f.replace(/\.json$/, '.bin');
        if (fs.existsSync(f)) {
            const m = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (m.statut === 'ok' && fs.existsSync(fb)) return { octets: fs.readFileSync(fb), cache: true, meta: m };
            if (m.statut === 'absent' || (m.statut === 'fausse-absente' && RH.fausseAbsenceRecente(m, now()))) return { absente: true, cache: true, meta: m };
        }
        RH.garderHote(SOURCE_RACINE, dossierPauses, suivi);
        if (!T.autoriseParRobots(texteRobots, new URL(url).pathname, UA)) throw new Error(`robots.txt interdit ${new URL(url).pathname} — aucune requête`);
        if (n >= plafond) throw Object.assign(new Error(`plafond de requêtes atteint (${plafond})`), { plafond: true });
        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
        dernier = now(); n++;
        const r = await transport.get(url, { binaire: true });
        const x = RH.lireImage(r, { suivi, hote: SOURCE_RACINE, url, dossierPauses });      // LÈVE : redirection/inattendue = pause, défi = arrêt définitif, 5xx = transitoire
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
    return { lire, lireImage, requetes: () => n, initialiserRobots, texteRobots: () => texteRobots };
}
/** La fiche et les octets d'une image DÉJÀ au cache, sans réseau : { octets, meta } | null. */
function lireDuCache(dossier, url) {
    const f = path.join(dossier, nomCache(url)), fb = f.replace(/\.json$/, '.bin');
    if (!fs.existsSync(f) || !fs.existsSync(fb)) return null;
    const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
    return meta.statut === 'ok' ? { octets: fs.readFileSync(fb), meta } : null;
}
/**
 * Une page de blueprint (~900 Ko) réduite à ce dont on a besoin : les méta og:image et les lignes qui citent un fichier de CE blueprint. 1 500 pages entières pèseraient 1,3 Go au cache.
 * `imageDePage(reduirePage(h, u), u)` = `imageDePage(h, u)`.
 */
function reduirePage(html, urlPage) {
    const id = /\/cards\/(\d+)-/.exec(String(urlPage ?? ''))?.[1];
    const t = String(html ?? '');
    const og = [...t.matchAll(/<meta[^>]+og:image[^>]*>/gi)].map(m => m[0]);
    const cites = id ? [...new Set([...t.matchAll(new RegExp(`[^"'\\s<>]*/uploads/blueprints/(?:back_)?image/${id}/[^"'\\s)\\\\<>]+`, 'g'))].map(m => m[0]))].slice(0, 12) : [];
    return `<!doctype html><html><head>${og.join('')}</head><body>${cites.map(c => `<img src="${c}">`).join('')}</body></html>`;
}
const CHEMIN_IMAGE = /^\/uploads\/blueprints\/image\/\d+\/[^/]+\.(?:jpe?g|png|webp)$/i;

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PHASE 2 — le lot d'images : adresse d'image d'une page, contrôle de largeur, lot après exclusions, décision d'écriture, entrées neutres.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const { largeurMinDe } = require('./seuils-images');
const { marqueDe, entreesARemplacer } = require('./basse-definition');
const { champsTracabilite } = require('./tracabilite');
const { cleNumero } = require('./jointure');
const IE = require('./images-empruntees');

const SOURCE = CODE_NEUTRE;                 // 'ctr' : jamais le nom de la source dans `source`, `lot`, une clé R2 ou une mention
const LOT = 'ctr-2026-10';
const MENTION = T.MENTION;

/**
 * L'adresse de l'image PLEINE TAILLE d'un blueprint, lue sur sa page HTML. Relevé sur 12 pages réelles (2026-10-18) : l'og:image est le fichier non préfixé
 * (`/uploads/blueprints/image/<id>/<nom>.jpg`), la variante « show_ » en est une version réduite (~500 px), `back_image` est le DOS. Écrit par ce qu'il autorise :
 * https, l'hôte, le chemin d'image du MÊME identifiant que la page, un fichier sans préfixe de variante. Un og:image qui est une vignette REFUSE (on ne cherche pas ailleurs).
 * Sans og:image : l'image non préfixée citée par la page ; à défaut seulement `show_` (via 'show', la largeur dira). Le dos n'est jamais lu.
 * @returns {{url: string, via: 'og'|'page'|'show'}|{refus: string}}
 */
function imageDePage(html, urlPage) {
    const id = /\/cards\/(\d+)-/.exec(String(urlPage ?? ''))?.[1];
    if (!id) return { refus: 'adresse de page illisible' };
    const t = String(html ?? '');
    const motif = new RegExp(`^https://${HOTE.replace(/\./g, '\\.')}/uploads/blueprints/image/${id}/([^/?#]+)\\.(?:jpe?g|png|webp)$`, 'i');
    const classer = u => { const m = motif.exec(u); if (!m) return null; const v = /^([a-z]+)_/i.exec(m[1]); return v ? v[1].toLowerCase() : ''; };
    const og = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(t) || /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(t);
    if (og) {
        const u = og[1].replace(/&amp;/g, '&');
        const v = classer(u);
        if (v === '') return { url: u, via: 'og' };
        return { refus: v === null ? 'og:image hors du chemin d\'image de ce blueprint (hôte, chemin ou identifiant)' : `og:image est une variante réduite (« ${v}_ »)` };
    }
    const trouvees = [...t.matchAll(new RegExp(`(?:https://${HOTE.replace(/\./g, '\\.')})?(/uploads/blueprints/image/${id}/[^"'\\s)\\\\<>]+)`, 'g'))].map(m => `https://${HOTE}${m[1]}`);
    const pleine = trouvees.find(u => classer(u) === '');
    if (pleine) return { url: pleine, via: 'page' };
    const show = trouvees.find(u => classer(u) === 'show');
    if (show) return { url: show, via: 'show' };
    return { refus: 'aucune image de blueprint dans la page' };
}

/** Le contrôle de largeur de l'ORIGINAL : au seuil de la source (350), sinon `trop-petit` avec sa largeur. Aucun plancher de 200 px (pas de décision). */
function controleLargeur(largeur) {
    const w = typeof largeur === 'number' && Number.isFinite(largeur) ? largeur : 0;
    return w >= largeurMinDe(SOURCE) ? { statut: 'ok', largeur: w } : { statut: 'trop-petit', largeur: w };
}

const cleNum = n => (n == null || String(n).trim() === '' ? 'sn' : String(n).trim().replace(/[^A-Za-z0-9._-]/g, '_'));
const cleR2 = (slugSet, numero, carteId) => `${SOURCE}/${slugSet}/${cleNum(numero)}-${carteId}-en.webp`;
const idImage = (slugSet, carteId, numero) => `${SOURCE}/${slugSet}/${carteId}/${cleNum(numero)}/en`;
const tamponDeLaFamille = slugSet => (IE.SETS_PRIZE_PACK.includes(slugSet) ? IE.TAMPON_PRIZE_PACK : undefined);
const familleDe = o => { const g = String(o.groupe ?? o.slugSet ?? ''); return /^(WCD)/i.test(g) ? 'wcd' : /^(PP|Play-Pokemon)/i.test(g) ? 'pp' : /^(BA|Battle-Academy)/i.test(g) ? 'ba' : null; };

/**
 * LE LOT après les décisions du coordinateur (18/10) : seuls entrent les appariés SANS réserve et avec une carte où poser l'entrée. EXCLUS, raison écrite : « à réserve »
 * (plusieurs variantes d'une même carte vers un blueprint), ambigu, introuvable, refusé par le témoin, sans carte, conflit (deux blueprints pour la même carte et le même set). Écrit par ce
 * qu'il autorise : un statut inconnu est exclu. Les « clé seule » (témoin absent ou non applicable) RESTENT.
 */
function construireLot(produits) {
    const exclus = [], groupes = new Map();
    for (const p of produits || []) {
        let raison = null;
        if (p.statut === 'apparie') {
            if (p.reserve) raison = 'a-reserve';
            else if (!Number.isInteger(p.blueprint)) raison = 'blueprint-illisible';
            else if (!Number.isInteger(p.carteId)) raison = 'sans-carte';
        } else raison = { ambigu: 'ambigu', introuvable: 'introuvable', 'refuse-temoin': 'refuse-temoin' }[p.statut] ?? 'statut-inconnu';
        if (raison) { exclus.push({ idProduct: p.idProduct, groupe: p.groupe, raison }); continue; }
        const numero = p.numeroFiche == null || String(p.numeroFiche).trim() === '' ? null : String(p.numeroFiche).trim();
        const k = `${p.carteId}|${p.slugSet}|${numero ?? ''}`;
        (groupes.get(k) || groupes.set(k, []).get(k)).push({ p, numero });
    }
    const unites = [];
    for (const g of groupes.values()) {
        if (new Set(g.map(x => x.p.blueprint)).size > 1) { for (const x of g) exclus.push({ idProduct: x.p.idProduct, groupe: x.p.groupe, raison: 'conflit' }); continue; }
        // I2 — UNE UNITÉ = UN PRODUIT, imposé ICI (jamais seulement par le drapeau « à réserve » du plan) : deux variantes d'une même carte ne reçoivent pas la même image
        if (g.length > 1) { for (const x of g) exclus.push({ idProduct: x.p.idProduct, groupe: x.p.groupe, raison: 'variantes' }); continue; }
        const p = g[0].p;
        // I1 — le nom de NOTRE fiche (hors clé : la clé ne lit que le slug Cardmarket) contre le nom du blueprint, par la même normalisation que l'appariement
        const nomBlueprint = nomDuBlueprint(p.blueprint, p.blueprintSlug);
        const carteNom = p.carteNom == null || String(p.carteNom).trim() === '' ? null : String(p.carteNom);
        let nomFiche = 'absent';
        if (carteNom) {
            if (nomBlueprint == null) { exclus.push({ idProduct: p.idProduct, groupe: p.groupe, raison: 'blueprint-illisible', nomFiche: carteNom }); continue; }
            if (!clesDeNom(carteNom).some(c => clesDeNom(nomBlueprint).includes(c))) { exclus.push({ idProduct: p.idProduct, groupe: p.groupe, raison: 'nom-fiche-different-du-blueprint', nomFiche: carteNom, nomBlueprint }); continue; }
            nomFiche = 'concordant';
        }
        const cleSeule = p.temoin !== 'confirme' || p.cle === 'nom-seul';
        // une « clé seule » n'a, par définition, pas de total qui la confirme : sans le nom de fiche concordant elle n'a AUCUN témoin
        if (cleSeule && nomFiche !== 'concordant') { exclus.push({ idProduct: p.idProduct, groupe: p.groupe, raison: 'cle-seule-sans-temoin' }); continue; }
        unites.push({ carteId: p.carteId, slugSet: p.slugSet, numero: g[0].numero, blueprint: p.blueprint, blueprintSlug: p.blueprintSlug, page: `https://${HOTE}/en-US/cards/${p.blueprint}-${p.blueprintSlug}`, groupe: p.groupe, famille: familleDe(p), slugCM: p.slug ?? null, carteNom, nomBlueprint, nomFiche, temoinNom: nomFiche === 'concordant', preuve: p.preuve ?? null,
            produits: [p.idProduct], cles: [p.cle], temoins: [p.temoin] });
    }
    const parFamille = { wcd: 0, pp: 0, ba: 0 }, cleSeuleParFamille = { wcd: 0, pp: 0, ba: 0 };
    for (const u of unites) if (u.famille) { parFamille[u.famille]++; if (estCleSeule(u)) cleSeuleParFamille[u.famille]++; }
    return { unites, exclus, parFamille, cleSeuleParFamille };
}

/**
 * Le JOUEUR que NOTRE fiche Cardmarket porte : une parenthèse « (Prénom Nom "Deck") » à la fin du nom du produit (la forme des Live/Online Code Cards). Rien d'autre : ni table écrite à la main, ni
 * l'année, ni le numéro. Mesuré le 18/10 sur les 1 956 produits WCD (numeros_cartes, catalogue_produits, cartes_produits, cartes) : seules 8 cartes-code la portent, AUCUNE carte jouable.
 * @returns {string|null} le joueur normalisé, ou null
 */
function joueurDeLaFiche({ nomProduit } = {}) {
    const m = /\(([^()"]+?)\s+"{1,2}[^"]+"{1,2}\)\s*$/.exec(String(nomProduit ?? ''));
    const j = m ? norm(m[1]) : '';
    return j && j.split(' ').length >= 2 ? j : null;
}
/**
 * La CALIBRATION de la levée par le joueur, sur les WCD déjà appariés sans ambiguïté (le joueur caché comme s'il y avait ambiguïté : la règle lirait le joueur de la fiche et le comparerait au candidat).
 * `produits[i].joueurFiche` et `resultats[i]` (statut 'apparie' + blueprint). Un seul FAUX éteint la règle (`active: false`), comme zéro cas évaluable.
 */
function calibrerJoueur(produits, resultats) {
    let evaluables = 0, justes = 0, faux = 0, nonEvaluables = 0;
    produits.forEach((p, i) => {
        const j = p.joueurFiche ? norm(p.joueurFiche) : null, r = resultats[i];
        if (!j || r?.statut !== 'apparie' || !r.blueprint?.joueur) { nonEvaluables++; return; }
        evaluables++;
        if (r.blueprint.joueur === j) justes++; else faux++;
    });
    return { evaluables, justes, faux, nonEvaluables, active: evaluables > 0 && faux === 0 };
}

/** Le nom d'un blueprint, lu sur son slug de page par la MÊME fonction que l'appariement (`blueprintDepuisPage`). null si le slug n'est pas lisible. */
function nomDuBlueprint(id, slug) {
    const b = blueprintDepuisPage(`https://${HOTE}/en-US/cards/${id}-${slug}`);
    return b && !b.type && b.nom ? b.nom : null;
}

/** « Clé seule » : aucun témoin hors de la clé n'a CONFIRMÉ l'appariement (témoin absent, non applicable, ou nom seul). */
const estCleSeule = u => !(u.temoins || []).includes('confirme') || (u.cles || []).includes('nom-seul');
function prng(graine) { let a = graine >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/**
 * L'échantillon de la planche (à regarder à l'œil avant toute écriture) : `n` unités, déterministe (graine fixe), au moins `cleSeuleMin` appariements « clé seule » (s'il y en a), toutes les
 * familles présentes, chaque unité une seule fois. Tirage en tourniquet sur les familles pour ne pas laisser les WCD, plus nombreux, tout prendre.
 */
function choisirEchantillon(unites, n, { cleSeuleMin = 15, graine = 20261018 } = {}) {
    const alea = prng(graine), toutes = [...(unites || [])];
    const pris = [], dejaPris = new Set();
    const tirer = (pool, k) => {
        const parFam = new Map();
        for (const u of pool) (parFam.get(u.famille) || parFam.set(u.famille, []).get(u.famille)).push(u);
        const fams = [...parFam.keys()].sort();
        let i = 0, mis = 0;
        while (mis < k && fams.some(f => parFam.get(f).length)) {
            const f = fams[i++ % fams.length], l = parFam.get(f);
            if (!l.length) continue;
            const u = l.splice(Math.floor(alea() * l.length), 1)[0];
            if (dejaPris.has(u)) continue;
            dejaPris.add(u); pris.push(u); mis++;
        }
    };
    tirer(toutes.filter(estCleSeule), Math.min(cleSeuleMin, n));
    tirer(toutes.filter(u => !dejaPris.has(u)), n - pris.length);
    return pris;
}

const memeNumero = (e, numero) => e.numero == null || String(e.numero).trim() === '' || numero == null || cleNumero(e.numero) === cleNumero(numero);
/**
 * Ce que l'écriture d'une entrée candidate fait d'une carte, par la règle COMMUNE de remplacement (basse-definition.js, jamais une copie) : 'deja-posee' (reprise), 'cede' (le set est
 * déjà servi par une entrée que la règle ne remplace pas — une image correcte au-dessus du seuil n'est jamais remplacée), ou 'ajouter' (avec les entrées remplacées : basse définition,
 * empruntée à un Prize Pack par le vrai scan tamponné). `documents` : Map `source|set|cleR2` -> document `images` de chaque entrée (la règle ne conclut pas sans lui).
 */
function decisionEcriture(images, cand, { documents } = {}) {
    const liste = (Array.isArray(images) ? images : []).filter(Boolean);
    if (liste.some(e => e.source === cand.source && e.set === cand.set && e.cleR2 === cand.cleR2)) return { action: 'deja-posee', remplace: [] };
    const sortantes = entreesARemplacer(liste, cand, { documents: documents ?? new Map() });
    const restantes = liste.filter(e => !sortantes.includes(e));
    // (le scan japonais du jumeau, `langue: ja`, ne sert pas un set occidental : mesure-catalogue.js ne le compte pas non plus)
    if (restantes.some(e => e.set === cand.set && e.langue !== 'ja' && memeNumero(e, cand.numero))) return { action: 'cede', remplace: [], raison: 'le set est déjà servi par une entrée que la règle commune ne remplace pas' };
    return { action: 'ajouter', remplace: sortantes };
}

const LANGUE_PREUVE = 'image de l\'impression exacte (tampon, bordure ou signature visibles) d\'un set déclaré anglais par la source';
/** L'entrée `cartes.images` d'une unité. `meta` : { wOriginal, hOriginal, cleR2, sha256, w, h, fmt }. LÈVE sans adresse d'origine (traçabilité commune). */
function entreeDeCarte(u, meta, le = new Date()) {
    const tampon = tamponDeLaFamille(u.slugSet);
    return { set: u.slugSet, source: SOURCE, lot: LOT, cleR2: meta.cleR2, sha256: meta.sha256, w: meta.w, h: meta.h, fmt: meta.fmt, numero: u.numero ?? null, wOriginal: meta.wOriginal, ...marqueDe({ wOriginal: meta.wOriginal }),
        attribution: MENTION, mention: MENTION, langue: 'en', languePreuve: LANGUE_PREUVE, ...(tampon ? { tampon } : {}), jointeLe: new Date(le), ...champsTracabilite({ urlOriginal: u.url, collecteLe: le }) };
}
/** Le document `images` d'une unité. */
function documentImage(u, meta, le = new Date()) {
    return { _id: idImage(u.slugSet, u.carteId, u.numero), source: SOURCE, lot: LOT, set: u.slugSet, carteId: u.carteId, numero: u.numero ?? null, idProduct: u.produits[0], produits: u.produits, blueprint: u.blueprint,
        cleR2: meta.cleR2, sha256: meta.sha256, w: meta.w, h: meta.h, fmt: meta.fmt, wOriginal: meta.wOriginal, hOriginal: meta.hOriginal, ...marqueDe({ wOriginal: meta.wOriginal }),
        langueSource: 'en', langue: 'en', languePreuve: LANGUE_PREUVE, attribution: MENTION, mention: MENTION, ...(tamponDeLaFamille(u.slugSet) ? { tampon: tamponDeLaFamille(u.slugSet) } : {}),
        telechargeLe: new Date(le), etat: 'ok', ...champsTracabilite({ urlOriginal: u.url, collecteLe: le }) };
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
        const fin = [];
        // la finition (non holo / cosmos holo / reverse holo) se lit AVANT ou APRÈS le numéro selon le blueprint
        while (mots.length && MOTS_FINITION.has(mots[mots.length - 1])) fin.unshift(mots.pop());
        const dernier = mots[mots.length - 1];
        if (!estNb(dernier ?? '')) return { id, famille: 'pp', nom: norm(mots.join(' ')), numero: null, total: null, code: null, finition: fin.length ? fin.join(' ') : null, slug: reste };
        mots.pop();
        const avant = mots[mots.length - 1];
        if (avant && estNb(avant)) { total = Number(dernier); numero = Number(avant); mots.pop(); }
        else { numero = Number(dernier); if (avant && /^[a-z]{2,5}$/.test(avant) && !NON_CODES.has(avant) && !MOTS_FINITION.has(avant)) { code = avant; mots.pop(); } }
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
        // 2022/2024 : « BA22C13 » = deck C, position 13 ; « BA24DAR » = deck à code de trois lettres, sans position ; 2020 et certains 2022 : « HIF9 » = tirage d'origine + numéro
        let deck = null, position = null, m;
        const dernier = p[p.length - 1];
        if ((m = /^BA\d{2}([A-Z])(\d{1,2})$/.exec(dernier))) { deck = m[1].toLowerCase(); position = Number(m[2]); p.pop(); }
        else if ((m = /^BA\d{2}([A-Z]{3})$/.exec(dernier))) { deck = m[1].toLowerCase(); p.pop(); }
        else if (/^BA\d{2}$/.test(dernier)) p.pop();
        else if ((m = /^([A-Za-z]+)(\d+)$/.exec(dernier))) { code = m[1].toLowerCase(); numero = Number(m[2]); p.pop(); }
        const v = p[p.length - 1];
        if (/^V\d+$/.test(v)) { variante = v; p.pop(); }
        return p.length ? { nom: norm(p.join(' ')), code, numero, variante, deck, position } : null;
    }
    const dernier = p[p.length - 1] ?? '';
    let m;
    if (estNb(dernier)) {
        numero = Number(p.pop());
        const c = p[p.length - 1] ?? '';
        const mc = famille === 'pp' ? /^PPS\d([A-Za-z0-9]*)$/.exec(c) : /^(?:WCD)?\d{2}([A-Za-z0-9]+)$/.exec(c);
        if (mc) { code = mc[1] ? mc[1].toLowerCase() : null; p.pop(); }
        else if (famille === 'wcd' && /^[A-Za-z][A-Za-z0-9]{2,}$/.test(c) && !/^V\d+$/.test(c)) { code = c.toLowerCase(); p.pop(); }
    } else if (famille === 'wcd' && (m = /^WCD\d{2}(\d{3})$/.exec(dernier))) { numero = Number(m[1]); p.pop(); }              // « WCD25196 » : l'année et le numéro collés (WCD 2025)
    else if (famille === 'wcd' && (m = /^WCD\d{2}([A-Za-z]+)$/.exec(dernier))) { code = m[1].toLowerCase(); p.pop(); }          // « WCD19SUM » : un code d'origine, aucun numéro (Énergie de base)
    else if (famille === 'wcd' && /^WCD\d{2}$/.test(dernier)) p.pop();                                                          // « WCD25 » : Énergie de base, rien d'autre
    else if (famille === 'pp' && /^PPS\d$/.test(dernier)) p.pop();                                                            // « PPS1 » : Énergie de base, ni code ni numéro
    else return null;
    if (/^V\d+$/.test(p[p.length - 1] ?? '')) { variante = p.pop(); }
    return p.length ? { nom: norm(p.join(' ')), code, numero, variante } : null;
}

/** La clé de nom : sans espaces (l'apostrophe n'est pas un séparateur : « Professors » / « professor s »), « Lv 35 » = « Lv35 », et le « Basic » des Énergies de base est facultatif. */
function clesDeNom(nom) {
    const c = norm(nom).replace(/ /g, '');
    return c ? (c.startsWith('basic') && c.length > 5 ? [c, c.slice(5)] : [c]) : [];
}
const subsuite = (petit, grand) => { let i = 0; for (const ch of grand ?? '') if (ch === petit[i]) i++; return i === petit.length; };

const entier = x => { const m = /^\D*(\d+)\D*$/.exec(String(x ?? '')); return m ? Number(m[1]) : null; };

/**
 * L'appariement : chaque produit -> { idProduct, statut: 'apparie'|'ambigu'|'introuvable'|'refuse-temoin', blueprint?, candidats?, cause?, temoin }.
 * LA CLÉ (nom + numéro d'origine [+ code d'origine] + année/position) N'EST PAS LE TÉMOIN : le TÉMOIN est le total imprimé (le dénominateur du numéro), lu sur les impressions de la carte jointe — une donnée
 * que la clé n'utilise pas. Un candidat que le témoin contredit est écarté ; s'ils le sont tous, le produit est REFUSÉ (jamais apparié par défaut).
 * Plusieurs candidats ne se départagent JAMAIS par un choix : joueurs (WCD), finitions (PP), positions (BA) -> 'ambigu', liste à l'appui.
 * @param {object[]} produits { idProduct, famille, annee?, serie?, slug, numeroCM?, impressions?: [{numero,total}], carteNom? }
 * @param {object[]} blueprints sortie de blueprintDepuisPage (les 'scelle' sont ignorés)
 */
function apparier(produits, blueprints, tous = produits) {
    const singles = blueprints.filter(b => b && b.nom && !b.type).map(b => ({ b, cles: clesDeNom(b.nom) }));
    const parFam = new Map();
    for (const x of singles) { const k = `${x.b.famille}|${x.b.annee ?? ''}`; (parFam.get(k) || parFam.set(k, []).get(k)).push(x); }
    const parPP = singles.filter(x => x.b.famille === 'pp');
    const clesProduit = (pr, s) => new Set([...clesDeNom(s.nom), ...clesDeNom(pr.carteNom)]);
    // les ORIGINES d'un nom dans une famille (le contexte : tous les produits, servis ou non) — pour « une seule carte d'origine » quand la clé est le nom seul
    const origines = new Map();
    for (const pr of tous) {
        const s = produitDepuisSlug(pr.slug, pr.famille);
        if (!s) continue;
        for (const c of clesProduit(pr, s)) {
            const k = `${pr.famille}|${pr.famille === 'pp' ? '' : pr.annee ?? ''}|${c}`;
            (origines.get(k) || origines.set(k, new Set()).get(k)).add(`${s.code ?? ''}|${s.numero ?? ''}`);
        }
    }
    return produits.map(pr => {
        const s = produitDepuisSlug(pr.slug, pr.famille);
        if (!s) return { idProduct: pr.idProduct, statut: 'introuvable', cause: 'slug-illisible', temoin: 'absent' };
        const cles = clesProduit(pr, s);
        const pool = pr.famille === 'pp' ? parPP : (parFam.get(`${pr.famille}|${pr.annee ?? ''}`) || []);
        const memeNom = pool.filter(x => x.cles.some(c => cles.has(c))).map(x => x.b);
        let codeContredit = false;
        let cands = [], cle = 'nom+numero';
        if (pr.famille === 'ba') {
            // la clé d'un Battle Academy : le nom, le deck et la position (« C60 », « P15 ») ; un deck à trois lettres (« EVE », « DAR ») n'a pas de position
            const m = /^([A-Z])(\d+)$/.exec(pr.numeroCM ?? ''), m3 = /^[A-Z]{3}$/.exec(pr.numeroCM ?? '');
            const deck = m ? m[1].toLowerCase() : m3 ? m3[0].toLowerCase() : s.deck, position = m ? Number(m[2]) : m3 ? null : s.position;
            cle = 'nom+deck+position';
            cands = memeNom.filter(b => (deck ? (deck.length === 1 ? (b.deck ?? '').startsWith(deck) : subsuite(deck, b.deck)) : false)
                && (position != null ? b.position === position : b.position == null) && (s.numero == null || b.numero == null || b.numero === s.numero));
        } else {
            cands = memeNom.filter(b => s.numero != null && b.numero === s.numero);
            if (pr.famille === 'pp') {
                const avant = cands.length;
                cands = cands.filter(b => !(s.code && b.code) || s.code === b.code);
                codeContredit = avant > 0 && cands.length === 0;
            }
            if (!cands.length && !codeContredit) {
                // le NOM SEUL : le blueprint ne porte aucun numéro (WCD 2024/2025, Énergies) — permis seulement si le nom ne désigne qu'UNE carte d'origine (sinon on ne sait pas laquelle)
                const faibles = memeNom.filter(b => b.numero == null && !(pr.famille === 'pp' && s.code && b.code && s.code !== b.code));
                if (faibles.length) {
                    const orig = origines.get(`${pr.famille}|${pr.famille === 'pp' ? '' : pr.annee ?? ''}|${[...cles][0]}`) || new Set();
                    const multiples = [...cles].some(c => (origines.get(`${pr.famille}|${pr.famille === 'pp' ? '' : pr.annee ?? ''}|${c}`) || new Set()).size > 1) || orig.size > 1;
                    if (multiples) return { idProduct: pr.idProduct, statut: 'ambigu', cause: 'origine', candidats: faibles.map(b => b.id), temoin: 'non-applicable', cle: 'nom-seul' };
                    cands = faibles; cle = 'nom-seul';
                }
            }
        }
        if (!cands.length) return { idProduct: pr.idProduct, statut: 'introuvable', cause: codeContredit ? 'code-contredit' : 'aucun-blueprint', temoin: 'absent' };
        // le témoin : le total
        const imps = Array.isArray(pr.impressions) ? pr.impressions : [];
        const avecTemoin = cands.map(b => {
            // BA : la clé est nom+deck+position, le NUMÉRO d'origine du blueprint n'y entre pas — il peut donc contredire (même sans total)
            if (pr.famille === 'ba' && b.numero != null && b.total == null) {
                if (!imps.length) return { b, t: 'absent' };
                return { b, t: imps.some(i => entier(i.numero) === b.numero) ? 'confirme' : 'contredit' };
            }
            if (b.total == null || b.numero == null) return { b, t: 'non-applicable' };
            if (!imps.length) return { b, t: 'absent' };
            return { b, t: imps.some(i => entier(i.numero) === b.numero && entier(i.total) === b.total) ? 'confirme' : 'contredit' };
        });
        const gardes = avecTemoin.filter(x => x.t !== 'contredit');
        if (!gardes.length) return { idProduct: pr.idProduct, statut: 'refuse-temoin', cause: 'total-contredit', candidats: cands.map(b => b.id), temoin: 'contredit' };
        const temoin = gardes.every(x => x.t === 'confirme') ? 'confirme' : gardes.some(x => x.t === 'confirme') ? 'confirme' : gardes[0].t;
        if (gardes.length === 1) return { idProduct: pr.idProduct, statut: 'apparie', blueprint: gardes[0].b, temoin, cle, preuve: `${pr.famille} ${s.nom} n°${s.numero ?? '—'}${s.code ? ` (${s.code})` : ''}${gardes[0].b.total != null ? ` /${gardes[0].b.total}` : ''} [${cle}]` };
        const bs = gardes.map(x => x.b);
        const cause = pr.famille === 'wcd' ? (new Set(bs.map(b => b.joueur)).size > 1 ? 'joueurs' : 'doublon')
            : pr.famille === 'pp' ? (new Set(bs.map(b => b.finition ?? '')).size > 1 ? 'finition' : 'doublon')
                : (new Set(bs.map(b => b.position ?? '')).size > 1 ? 'position' : 'doublon');
        let raisonTrou;
        if (pr.famille === 'wcd' && cause === 'joueurs') {
            // LEVÉE PAR LE JOUEUR, sous la condition du testeur : seulement si NOTRE fiche porte le joueur (`joueurFiche`, lu sur la fiche — jamais déduit de l'année ni du numéro), par ÉGALITÉ du nom
            // normalisé (tokens entiers, aucune inclusion), sur une carte DÉJÀ appariée (les candidats sont ceux du même nom et du même numéro d'origine), et s'il ne reste qu'UN candidat
            const j = pr.joueurFiche ? norm(pr.joueurFiche) : null;
            if (!j) raisonTrou = 'fiche-sans-joueur';
            else {
                const memeJoueur = bs.filter(b => b.joueur === j);
                if (memeJoueur.length === 1) { const g = gardes.find(x => x.b === memeJoueur[0]); return { idProduct: pr.idProduct, statut: 'apparie', blueprint: g.b, temoin: g.t, cle: 'nom+numero+joueur', preuve: `${pr.famille} ${s.nom} n°${s.numero ?? '—'} joueur « ${j} » (fiche = blueprint)` }; }
                if (memeJoueur.length > 1) return { idProduct: pr.idProduct, statut: 'ambigu', cause: 'doublon', candidats: memeJoueur.map(b => b.id), temoin, cle, raisonTrou: 'doublon-du-joueur' };
                raisonTrou = 'joueur-different';
            }
        }
        return { idProduct: pr.idProduct, statut: 'ambigu', cause, candidats: bs.map(b => b.id), temoin, cle, ...(raisonTrou ? { raisonTrou } : {}) };
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

module.exports = { joueurDeLaFiche, calibrerJoueur, nomDuBlueprint, reduirePage, lireDuCache, nomCache, choisirEchantillon, estCleSeule, prng, imageDePage, controleLargeur, cleR2, idImage, tamponDeLaFamille, construireLot, decisionEcriture, entreeDeCarte, documentImage, SOURCE, LOT, MENTION, LANGUE_PREUVE, CHEMIN_IMAGE, familleDe, blueprintDepuisPage, produitDepuisSlug, apparier, produitsServis, norm, HOTE, SOURCE_RACINE, UA, CADENCE_MIN_MS, CODE_NEUTRE, sitemapsDesRobots, lireSitemap, blueprintDepuisImage, familleDeExpansion, fabriquerClient, transportFetch, hoteOk };
