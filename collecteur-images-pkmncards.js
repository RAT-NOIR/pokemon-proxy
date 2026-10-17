// ============================================================
// COLLECTEUR D'IMAGES — scans anglais d'une source de cartes (adresses du SITEMAP EN CACHE) -> cache local -> R2 (WebP) + base `cartes` (lot PKMNCARDS, 2026-10-17)
// ============================================================
//   node collecteur-images-pkmncards.js --lot=kits|mcdo|promos|pkmcom [--plan]                          (défaut) la SIMULATION : zéro requête, écrit plan-<lot>.json
//   node collecteur-images-pkmncards.js --lot=<lot> --telecharger                                       LES SEULES REQUÊTES : robots.txt puis les images du plan, lancées par le coordinateur
//   node collecteur-images-pkmncards.js --lot=<lot> --planche                                           contrôle (dos, taille, rapport, empreintes) puis la PLANCHE que le coordinateur regarde (0 requête)
//   node lot-additif.js --quoi="scans en : N visuels <lot> (lot pkc-2026-10)" --collections=cartes,images,sets --compte=images:source=pkc -- node collecteur-images-pkmncards.js --lot=<lot> --ecrire --attendu=<N> [--rejets=<fichier>]
//
// ⛔ TROIS PHASES, TROIS DROITS. --plan, --planche et --ecrire ne font AUCUNE requête réseau (l'écriture lit le cache seulement) ; seul --telecharger sort, et il est borné :
//   · seules les adresses PRÉSENTES MOT POUR MOT dans le sitemap en cache ET retenues par le plan ; hôte de la source seul, https, répertoire plat des images (collecte-cartes/pkmncards.js urlImageValide) ;
//     JAMAIS une page, JAMAIS la recherche (?s=) : le transport lui-même refuse toute autre adresse que robots.txt et ces images ;
//   · robots.txt relu à CHAQUE téléchargement (dès qu'une image reste à demander), respecté ; Crawl-delay respecté (plafonné) ;
//   · agent honnête du dépôt, AUCUN en-tête de navigateur, aucun cookie, redirection jamais suivie ; ≥ 5 s entre deux requêtes ; plafond = adresses à demander + 1 (robots), pas de réessai ;
//   · ARRÊT DÉFINITIF au premier 403, 429, défi (HTML au lieu d'une image, cf-mitigated, Imperva, 3xx, octets qui ne sont pas l'image que l'extension annonce) : un fichier d'arrêt est écrit dans le dossier du
//     cache et tout lancement suivant REFUSE de partir tant qu'il existe — seul le testeur décide de le retirer. Une coupure ou un 5xx INTERROMPT sans l'écrire.
// 🔑 CONTRÔLE DE CHAQUE IMAGE (décision 2 du testeur), AVANT tout plan d'écriture : dos de carte (empreinte), taille, rapport, même fichier sous deux adresses ; puis la planche, que le coordinateur REGARDE (filigrane,
//    étiquette incrustée) : sa liste de rejets (--rejets=<fichier>) sort du plan, et le document de l'image rejetée dit « rejete » et pourquoi.
// 🔑 Ce que les appariements prouvent, et ce qu'ils ne prouvent pas : collecte-cartes/pkmncards.js. Le retrait en un lot : retirer-visuels-pkmncards.js.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pkmncards');
const T = require('./collecte-cartes/tpc');
const { largeurMinDe, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { marqueDe, entreesARemplacer } = require('./collecte-cartes/basse-definition');      // L'API déjà exportée : la marque d'après la largeur de l'ORIGINAL, la règle de remplacement
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const STOP_OCTETS = 400 * 1024 * 1024;
const CRAWL_DELAY_MAX_S = 60;
const CINQ_CENTS_FENETRE_MS = 6 * 3600 * 1000;
const OCTETS_MAX_PAR_IMAGE = 8 * 1024 * 1024;           // un scan de carte pèse < 2 Mo : au-delà, ce n'est pas l'image attendue (refusée, notée « trop-volumineuse »)
const CIBLES_PKMCOM = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\PKMCOM-IMPORT\\plan.json';
// Les 12 trous anglais que la mesure du dépôt PTCG-database (S7\PTCGDB, PTCGDB-MESURE-report.md : « en plus de PKMNCARDS ») a trouvés au-delà des quatre lots ; décision du testeur du 17/10 soir. Les adresses d'image
// ne viennent JAMAIS de ce dépôt : seul le sitemap en cache fait foi, et chaque produit est apparié set + numéro + nom comme les autres (les douteux sont sautés).
const CIBLES_AUTRES = Object.freeze([297254, 297255, 297257, 297258, 297282, 297283, 297288, 297289, 582672, 909509, 909510, 909511]);
const lireCiblesAutres = () => ({ ids: [...CIBLES_AUTRES], parProduit: new Map() });
const CACHE_POKEMONCOM = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pokemoncom-cache';
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const MARQUEUR_DE_DEFI = /just a moment|captcha|challenge|attention required|cf-chl|_incapsula|incapsula incident/i;
const MAGIES = { png: [Buffer.from('89504e470d0a1a0a', 'hex')], jpg: [Buffer.from('ffd8ff', 'hex')], jpeg: [Buffer.from('ffd8ff', 'hex')], webp: [Buffer.from('52494646', 'hex')] };
/** Les octets reçus sont-ils l'image que l'extension de l'adresse annonce ? (un défi servi sous une adresse d'image ne l'est pas) */
function octetsConformes(url, octets) {
    if (!Buffer.isBuffer(octets) || octets.length < 12) return false;
    const ext = new URL(url).pathname.split('.').pop().toLowerCase();
    const magies = MAGIES[ext];
    if (!magies || !magies.some(m => octets.subarray(0, m.length).equals(m))) return false;
    return ext !== 'webp' || octets.subarray(8, 12).toString('latin1') === 'WEBP';
}

// ── adresses autorisées ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Les adresses du plan présentes MOT POUR MOT dans le sitemap ET valables. @param {object[]} unites @param {{loc, img}[]} entreesSitemap */
function urlsAutorisees(unites, entreesSitemap) {
    const dansSitemap = new Set(entreesSitemap.map(e => e.img));
    const ok = [], refusees = [];
    for (const u of new Set(unites.map(p => p.url))) {
        if (!P.urlImageValide(u)) refusees.push({ url: u, motif: 'adresse-hors-regle' });
        else if (!dansSitemap.has(u)) refusees.push({ url: u, motif: 'hors-sitemap' });
        else ok.push(u);
    }
    return { ok, refusees };
}

// ── le cache local ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const fichierArret = dossier => path.join(dossier, 'ARRET-DEFINITIF.json');
const fichierIndex = dossier => path.join(dossier, 'index.json');
const nomFichier = url => new URL(url).pathname.slice(P.PREFIXE_CHEMIN.length);
function lireIndex(dossier) { try { const j = JSON.parse(fs.readFileSync(fichierIndex(dossier), 'utf8')); return j?.images ? j : { version: 1, images: {} }; } catch { return { version: 1, images: {} }; } }
function ecrireIndex(dossier, index) { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(fichierIndex(dossier), JSON.stringify(index, null, 1)); }

const fichierRejets = dossier => path.join(dossier, 'REJETS.json');
/** @returns {Map<number, string>} idProduct -> motif, les rejets du coordinateur déjà prononcés pour ce cache. */
function lireRejets(dossier) { try { return new Map((JSON.parse(fs.readFileSync(fichierRejets(dossier), 'utf8')).rejets || []).map(x => [x.idProduct, String(x.motif)])); } catch { return new Map(); } }
function ecrireRejets(dossier, map) { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(fichierRejets(dossier), JSON.stringify({ le: new Date().toISOString(), rejets: [...map].map(([idProduct, motif]) => ({ idProduct, motif })) }, null, 1)); }

// ── le transport RÉEL : l'agent du dépôt seul, aucune redirection suivie, robots.txt et les images SEULEMENT ────────────────
const transportFetch = {
    async get(url, { binaire = false, octetsMax = OCTETS_MAX_PAR_IMAGE } = {}) {
        if (!P.adressePermise(url)) throw new Error(`adresse hors de ce que le collecteur autorise (robots.txt et les images à plat de ${P.HOTE}) — aucune requête`);
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': P.UA }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const cfMitigated = r.headers.get('cf-mitigated');
        const imperva = /imperva|incapsula/i.test(`${r.headers.get('x-cdn') || ''} ${r.headers.get('set-cookie') || ''}`) || !!r.headers.get('x-iinfo');
        const type = r.headers.get('content-type') || '';
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), cfMitigated, imperva };
        // un 404/410 rend aussi son corps (borné) : un défi caché derrière un 404 doit se voir
        if (r.status === 404 || r.status === 410) return { status: r.status, type, texte: (await r.text()).slice(0, 3000), cfMitigated, imperva };
        if (binaire && r.ok && /^image\//.test(type)) {
            // le plafond d'octets agit AVANT (content-length) et PENDANT la lecture : le corps n'est jamais chargé en entier au-delà du plafond
            const annonce = Number(r.headers.get('content-length'));
            if (Number.isFinite(annonce) && annonce > octetsMax) { try { await r.body?.cancel(); } catch { /* corps déjà fermé */ } return { status: r.status, type, tropVolumineux: true, octetsAnnonces: annonce, cfMitigated, imperva }; }
            const morceaux = []; let total = 0;
            const lecteur = r.body.getReader();
            for (;;) {
                const { done, value } = await lecteur.read();
                if (done) break;
                total += value.length;
                if (total > octetsMax) { try { await lecteur.cancel(); } catch { /* flux déjà fermé */ } return { status: r.status, type, tropVolumineux: true, octetsAnnonces: total, cfMitigated, imperva }; }
                morceaux.push(value);
            }
            return { status: r.status, type, octets: Buffer.concat(morceaux), cfMitigated, imperva };
        }
        return { status: r.status, type, texte: await r.text(), cfMitigated, imperva };
    }
};

/**
 * LA PHASE RÉSEAU. @param {{urls: string[], dossierCache: string, transport?: object, pause?: Function, now?: Function, cadenceMs?: number, plafond?: number}} o
 * @returns {{etat: 'termine'|'rien-a-faire'|'refuse-arret'|'robots-interdit'|'arret-definitif'|'interrompu', requetes: number, plafond: number, refusees: object[], motif?: string}}
 */
async function telecharger({ urls, dossierCache, transport = transportFetch, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, cadenceMs = P.CADENCE_MS, plafond: plafondMax = null, octetsMax = OCTETS_MAX_PAR_IMAGE }) {
    if (fs.existsSync(fichierArret(dossierCache))) return { etat: 'refuse-arret', requetes: 0, plafond: 0, refusees: [], motif: `${fichierArret(dossierCache)} existe : un arrêt définitif a eu lieu, seul le testeur décide de le lever` };
    const refusees = [...new Set(urls)].filter(u => !P.urlImageValide(u)).map(u => ({ url: u, motif: 'adresse-hors-regle' }));
    const index = lireIndex(dossierCache);
    const afaire = [...new Set(urls)].filter(u => P.urlImageValide(u) && !['ok', 'absent', 'refuse'].includes(index.images[u]?.statut));
    if (!afaire.length) return { etat: 'rien-a-faire', requetes: 0, plafond: 0, refusees };
    const plafond = Math.min(afaire.length + 1, plafondMax ?? Infinity);
    let requetes = 0, dernier = null, cadence = Math.max(cadenceMs, P.CADENCE_MS);
    const arret = (url, r, motif) => { fs.mkdirSync(dossierCache, { recursive: true }); fs.writeFileSync(fichierArret(dossierCache), JSON.stringify({ le: new Date().toISOString(), url, status: r?.status ?? null, motif, requetes }, null, 1)); return { etat: 'arret-definitif', requetes, plafond, refusees, motif }; };
    // un défi s'écrit par ce qui le PROUVE (liste fermée), jamais par « c'est du HTML » : un 404 sans marqueur est « absent ». Preuves : 403, 429, 3xx, cf-mitigated, Imperva/Incapsula, un marqueur de défi dans le corps.
    const defi = r => r.status === 403 || r.status === 429 || (r.status >= 300 && r.status < 400) || !!r.cfMitigated || !!r.imperva || (typeof r.texte === 'string' && MARQUEUR_DE_DEFI.test(r.texte.slice(0, 3000)));
    // un 5xx INTERROMPT (compté dans l'index) ; le DEUXIÈME de suite, sans une seule réussite entre, est un arrêt définitif
    // (correction 3) « de suite » = rapprochés (6 h) : un 5xx d'il y a une semaine n'est pas le premier d'une série ; une réponse valide (image, 404) remet le compteur à zéro
    const erreur5xx = (url, r) => {
        const t = now(), avant = index.cinqCents && typeof index.cinqCents === 'object' && t - index.cinqCents.au < CINQ_CENTS_FENETRE_MS ? index.cinqCents.n : 0;
        index.cinqCents = { n: avant + 1, au: t }; ecrireIndex(dossierCache, index);
        return index.cinqCents.n >= 2 ? arret(url, r, `HTTP ${r.status} deux fois de suite (moins de 6 h) sans réponse valide entre : arrêt définitif`) : { etat: 'interrompu', requetes, plafond, refusees, motif: `HTTP ${r.status} sur ${url}` };
    };
    const demander = async (url, o) => {
        if (requetes >= plafond) throw Object.assign(new Error('plafond de requêtes atteint'), { plafond: true });
        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
        dernier = now(); requetes++;
        return transport.get(url, o);
    };
    // 1. robots.txt, d'abord
    let robots;
    try { robots = await demander(P.ROBOTS, {}); } catch (e) { return { etat: 'interrompu', requetes, plafond, refusees, motif: e.message }; }
    if (defi(robots)) return arret(P.ROBOTS, robots, `robots.txt : HTTP ${robots.status} — défi ou refus`);
    // 🔑 DOCTRINE (17/10) : « 401, 403, 410, 429, défi, connexion obligatoire ou mur payant : arrêt définitif, sans réessai ». L'arrêt s'écrit par ce qu'il AUTORISE : pour robots.txt, seuls 200 (lu) et 404 sans
    // marqueur (« pas de règle ») laissent continuer ; un 5xx interrompt (compté) ; TOUT le reste est un arrêt définitif.
    let texteRobots = null;
    if (robots.status === 200) texteRobots = robots.texte ?? '';
    else if (robots.status >= 500) return erreur5xx(P.ROBOTS, robots);
    else if (robots.status !== 404) return arret(P.ROBOTS, robots, `robots.txt : HTTP ${robots.status} — ni lu (200) ni absent (404) : arrêt définitif`);
    const delai = T.delaiDesRobots(texteRobots, P.UA);
    if (delai && delai > CRAWL_DELAY_MAX_S) return { etat: 'robots-interdit', requetes, plafond, refusees, motif: `Crawl-delay de ${delai} s` };
    if (delai) cadence = Math.max(cadence, delai * 1000);
    const permises = afaire.filter(u => T.autoriseParRobots(texteRobots, new URL(u).pathname, P.UA));
    if (!permises.length) return { etat: 'robots-interdit', requetes, plafond, refusees, motif: 'robots.txt interdit ces chemins' };
    // 2. les images
    fs.mkdirSync(path.join(dossierCache, 'img'), { recursive: true });
    for (const url of permises) {
        let r;
        try { r = await demander(url, { binaire: true, octetsMax }); } catch (e) { return { etat: 'interrompu', requetes, plafond, refusees, motif: e.message }; }
        if (defi(r)) return arret(url, r, `HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}${r.imperva ? ', Imperva' : ''}${/html/i.test(r.type || '') ? ', HTML au lieu d\'une image' : ''}`);
        if (r.status === 404) { index.images[url] = { statut: 'absent', status: r.status, le: new Date().toISOString() }; delete index.cinqCents; ecrireIndex(dossierCache, index); continue; }       // le SEUL « absent » : un 404 sans marqueur de défi
        if (r.status >= 500) return erreur5xx(url, r);
        if (r.status !== 200) return arret(url, r, `HTTP ${r.status} : ni l'image (200) ni l'absence (404) — 401, 410 et tout autre statut sont un arrêt définitif`);
        if (r.tropVolumineux) { index.images[url] = { statut: 'refuse', motif: 'trop-volumineuse', octets: r.octetsAnnonces ?? null, le: new Date().toISOString() }; ecrireIndex(dossierCache, index); console.error(`   refusée (trop volumineuse, plafond ${octetsMax} octets) : ${url}`); continue; }
        if (!octetsConformes(url, r.octets)) return arret(url, r, 'les octets reçus ne sont pas l\'image que l\'adresse annonce (page de défi probable)');
        if (r.octets.length > octetsMax) { index.images[url] = { statut: 'refuse', motif: 'trop-volumineuse', octets: r.octets.length, le: new Date().toISOString() }; ecrireIndex(dossierCache, index); console.error(`   refusée (trop volumineuse, ${r.octets.length} octets) : ${url}`); continue; }
        delete index.cinqCents;
        const meta = await sharp(r.octets).metadata();
        const fichier = path.join('img', nomFichier(url));
        fs.writeFileSync(path.join(dossierCache, fichier), r.octets);
        index.images[url] = { statut: 'ok', fichier, sha256: sha('sha256', r.octets), octets: r.octets.length, w: meta.width, h: meta.height, le: new Date().toISOString() };
        ecrireIndex(dossierCache, index);
    }
    return { etat: 'termine', requetes, plafond, refusees };
}

// ── LE CONTRÔLE DU CACHE (avant tout plan d'écriture) ─────────────────────────────────────────────────────────────────────
/**
 * Le contrôle VISUEL automatique (décision du testeur, 2026-10-17 : scan de face, pas de fond). Un scan de carte est cadré serré : si les quatre bords (3 % d'épaisseur, coins exclus) sont chacun UNIFORMES et
 * BLANCS ou NOIRS, la carte flotte dans un cadre plus large (fond de scanner, photo, plaque de gradation) -> « fond-ou-cadre-trop-large ». Écrit par ce qu'il refuse (la carte est entourée d'un aplat blanc ou noir)
 * et NON CALIBRÉ sur des scans réels (aucun n'est en cache avant le téléchargement) : filigrane, étiquette incrustée et photo de vendeur ne se jugent pas par l'automate, ils partent à la planche.
 * @returns {Promise<string|null>}
 */
async function controleVisuel(octets) {
    let brut;
    try { brut = await sharp(octets).flatten({ background: '#ffffff' }).resize(100, 140, { fit: 'fill' }).removeAlpha().raw().toBuffer(); } catch { return 'image-illisible'; }
    const px = (x, y) => { const i = (y * 100 + x) * 3; return [brut[i], brut[i + 1], brut[i + 2]]; };
    const bande = (x0, x1, y0, y1) => { const v = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(px(x, y)); return v; };
    const stats = v => { const m = [0, 1, 2].map(c => v.reduce((s, p) => s + p[c], 0) / v.length); const sd = Math.max(...[0, 1, 2].map(c => Math.sqrt(v.reduce((s, p) => s + (p[c] - m[c]) ** 2, 0) / v.length))); return { m, sd }; };
    const cotes = [bande(8, 92, 0, 3), bande(8, 92, 137, 140), bande(0, 3, 8, 132), bande(97, 100, 8, 132)].map(stats);
    const aplat = s => s.sd < 6 && (s.m.every(c => c > 238) || s.m.every(c => c < 16));
    return cotes.every(aplat) ? 'fond-ou-cadre-trop-large' : null;
}
/** @returns {Promise<Map<string, string>>} adresse -> motif de refus (dos-de-carte, trop-petit, rapport-hors-carte, fond-ou-cadre-trop-large, meme-image-plusieurs-adresses…) ; une image conforme n'y figure pas. */
async function controlerCache(unites, dossierCache) {
    const index = lireIndex(dossierCache);
    const infos = [];
    for (const url of new Set(unites.map(u => u.url))) {
        const e = index.images[url];
        if (e?.statut !== 'ok') continue;
        let octets; try { octets = fs.readFileSync(path.join(dossierCache, e.fichier)); } catch { continue; }
        infos.push({ url, sha256: e.sha256, w: e.w, h: e.h, octets });
    }
    const identiques = P.imagesIdentiques(infos);
    const motifs = new Map();
    for (const i of infos) { const m = P.controlerImage(i) || (identiques.has(i.url) ? 'meme-image-plusieurs-adresses' : null) || await controleVisuel(i.octets); if (m) motifs.set(i.url, m); }
    return motifs;
}

// ── LA PLANCHE que le coordinateur regarde ────────────────────────────────────────────────────────────────────────────────
const echapper = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LARGEUR_CASE = 580, HAUTEUR_CASE = 470, HAUTEUR_IMAGE = 380, COLONNES = 3;
/**
 * Une page PNG par `parPage` unités : pour CHAQUE image, la vignette de la source + set / numéro / nom de notre fiche ; pour un remplacement l'ancienne image à côté (si `dossierAnciennes` la porte, sous le nom de
 * sa clé R2) ; pour le lot pkmcom l'image pokemon.com à côté (unite.pokemoncom.fichier) ; le motif du contrôle, s'il y en a un. Une unité sans image en cache est NOMMÉE (horsCache), jamais une case vide.
 * @returns {Promise<{pages: {fichier: string, produits: number[]}[], horsCache: number[]}>}
 */
async function planche({ unites, dossierCache, sortie, lot, parPage = 6, dossierAnciennes = null, motifs = null }) {
    const index = lireIndex(dossierCache);
    const ctl = motifs ?? await controlerCache(unites, dossierCache);
    const horsCache = [], pretes = [];
    for (const u of unites) { const e = index.images[u.url]; if (e?.statut === 'ok' && fs.existsSync(path.join(dossierCache, e.fichier))) pretes.push({ u, fichier: path.join(dossierCache, e.fichier), e }); else horsCache.push(...u.produits); }
    fs.mkdirSync(sortie, { recursive: true });
    const miniature = async f => sharp(f).resize({ height: HAUTEUR_IMAGE, width: 270, fit: 'inside' }).png().toBuffer();
    const pages = [];
    for (let k = 0; k * parPage < pretes.length; k++) {
        const lot6 = pretes.slice(k * parPage, (k + 1) * parPage);
        const colonnes = Math.min(COLONNES, lot6.length), lignes = Math.ceil(lot6.length / COLONNES);
        const couches = [];
        for (let i = 0; i < lot6.length; i++) {
            const { u, fichier, e } = lot6[i];
            const x = (i % COLONNES) * LARGEUR_CASE, y = Math.floor(i / COLONNES) * HAUTEUR_CASE;
            couches.push({ input: await miniature(fichier), left: x + 8, top: y + 8 });
            let cote = null, note = null;
            if (u.pokemoncom?.fichier && fs.existsSync(u.pokemoncom.fichier)) { cote = u.pokemoncom.fichier; note = 'à droite : l\'image pokemon.com (245 px)'; }
            else if (u.action === 'remplacement' && dossierAnciennes) {
                for (const r of u.remplace || []) { const f = path.join(dossierAnciennes, path.basename(r.cleR2)); if (fs.existsSync(f)) { cote = f; note = `à droite : l'ancienne image (${r.source}, ${r.w ?? '?'} px)`; break; } }
            }
            if (cote) couches.push({ input: await miniature(cote), left: x + 8 + 280, top: y + 8 });
            const motif = ctl.get(u.url);
            const lignesTexte = [
                `${u.produits.join(',')} · ${u.nomEn ?? '?'}`, `${u.slugSet} n°${u.numero ?? '∅'}`, `source : ${u.pkcSet} n°${u.numeroPkc} « ${u.nomPkc} » (${e.w}×${e.h})`,
                u.action === 'remplacement' ? `REMPLACEMENT de ${(u.remplace || []).map(r => `${r.source} ${r.w ?? '?'} px`).join(' + ')}${cote ? '' : ' (ancienne image non fournie)'}` : 'AJOUT',
                ...(note ? [note] : []), ...(u.aRegarder ? ['À REGARDER : la marque « 30 »'] : []), ...(motif ? [`CONTRÔLE : ${motif}`] : [])
            ];
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGEUR_CASE}" height="${HAUTEUR_CASE - HAUTEUR_IMAGE - 8}"><rect width="100%" height="100%" fill="white"/>${lignesTexte.map((t, j) => `<text x="8" y="${16 + j * 15}" font-size="13" font-family="sans-serif" fill="${/^CONTRÔLE|^À REGARDER/.test(t) ? '#b00020' : '#111'}">${echapper(t)}</text>`).join('')}</svg>`;
            couches.push({ input: Buffer.from(svg), left: x, top: y + HAUTEUR_IMAGE + 8 });
        }
        const fichierPage = path.join(sortie, `planche-${lot}-${k + 1}.png`);
        await sharp({ create: { width: colonnes * LARGEUR_CASE, height: lignes * HAUTEUR_CASE, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(couches).png().toFile(fichierPage);
        pages.push({ fichier: fichierPage, produits: lot6.flatMap(p => p.u.produits) });
    }
    return { pages, horsCache };
}

const GRAINE_ECHANTILLON = 20261017;
/** Un tirage au sort à GRAINE FIXE (mulberry32) de n unités, dans l'ordre du plan : le même plan et la même graine rendent le même échantillon. */
function tirerEchantillon(unites, n, graine = GRAINE_ECHANTILLON) {
    let s = graine >>> 0;
    const alea = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const rang = unites.map((u, i) => ({ i, r: alea() })).sort((a, b) => a.r - b.r).slice(0, Math.min(n, unites.length)).map(x => x.i).sort((a, b) => a - b);
    return rang.map(i => unites[i]);
}

// ── LE PLAN (lecture seule de la base) ────────────────────────────────────────────────────────────────────────────────────────
/** Les idProduct des cibles du lot pkmcom : ceux du plan pokemon.com (plan + remplacements) ET leur image pokemon.com (pour la planche). */
function lireCiblesPkmcom(fichier = CIBLES_PKMCOM, cacheDir = CACHE_POKEMONCOM) {
    const j = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    const unites = [...(j.plan || []), ...(j.remplacements || [])];
    if (!unites.length) throw new Error(`cibles pkmcom : aucune unité lue dans ${fichier} — une clé fausse, pas une absence`);
    const idx = (() => { try { return JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8')).images || {}; } catch { return {}; } })();
    const parProduit = new Map();
    for (const u of unites) for (const id of u.produits) parProduit.set(id, { url: u.url, fichier: idx[u.url]?.statut === 'ok' ? path.join(cacheDir, idx[u.url].fichier) : null });
    return { ids: [...parProduit.keys()], parProduit };
}
/** Les trous du lot et leur appariement. `db` : la base `cartes`, LECTURE SEULE. */
/** La fiche que la règle du site IMPORTÉE (exporter-donnees-logos-site.js fichesDesProduits) donne à chaque produit des sets nommés : idProduct -> { numero, rang }. Lecture seule. */
async function fichesDuSiteDesSets(db, slugSets, regles) {
    const exporteur = require('./exporter-donnees-logos-site');
    const parProduit = new Map();
    for (const slugSet of slugSets) {
        const set = await db.collection('sets').findOne({ _id: slugSet });
        if (!set) continue;
        const lignes = await db.collection('cartes_produits').find({ idExpansion: { $in: [].concat(set.idExpansion) } }).toArray();
        const docs = (await db.collection('cartes').find({ sets: slugSet }).toArray()).filter(d => d.nomEn);
        const { fiche } = exporteur.fichesDesProduits(regles.regle, set, docs, lignes);
        for (const [id, f] of fiche) parProduit.set(id, { numero: f.numero, rang: f.rang });
    }
    return id => parProduit.get(id) ?? null;
}
async function planifierDepuisBase(db, { lot, entrees, refusSite = null, cibles = null, regles = null }) {
    if (!P.LOTS.includes(lot)) throw new Error(`lot inconnu : ${lot}`);
    const slugSets = [...new Set(Object.values(P.TABLE).filter(l => P.duLot(l, lot)).flatMap(l => l.slugSets))];
    const filtre = { slugSet: { $in: slugSets }, ...(cibles ? { idProduct: { $in: cibles.ids } } : {}) };
    const lignes = await db.collection('cartes_produits').find(filtre, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1, slugSet: 1, slug: 1 } }).toArray();
    if (!lignes.length) throw new Error(`cartes_produits : 0 ligne pour ${slugSets.length} sets du lot « ${lot} » — une clé fausse (§41)`);
    const parId = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    const sets = new Map((await db.collection('sets').find({ _id: { $in: slugSets } }, { projection: { tirage: 1, region: 1 } }).toArray()).map(s => [s._id, s.tirage ?? s.region]));
    const occidentales = lignes.filter(l => (sets.get(l.slugSet) ?? 'intl') === 'intl' && parId.has(l.carteId));
    const horsTirage = lignes.filter(l => !((sets.get(l.slugSet) ?? 'intl') === 'intl' && parId.has(l.carteId))).map(l => ({ idProduct: l.idProduct, slugSet: l.slugSet, motif: parId.has(l.carteId) ? 'tirage-non-occidental' : 'carte-absente' }));
    const trous = occidentales.map(l => ({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche ?? null, slugProduit: l.slug ?? null, carte: parId.get(l.carteId) }));
    const ficheDuSite = regles ? await fichesDuSiteDesSets(db, slugSets, regles) : null;
    const r = P.apparier({ trous, entrees, lot, ...(ficheDuSite ? { ficheDuSite } : {}), ...(refusSite ? { refus: (e, slug) => (e.cleR2 ? refusSite(e, sets.get(slug) ?? 'intl') : null) } : {}) });
    if (cibles) for (const u of r.plan) u.pokemoncom = u.produits.map(id => cibles.parProduit.get(id)).find(Boolean) ?? null;
    return { lignes: lignes.length, slugSets, ...r, restes: [...r.restes, ...horsTirage] };
}

/** L'ANNONCE de baisses pour `lot-additif.js --annonce=` quand des remplacements sont prévus : ce que la garde de lot verrait si les entrées remplacées sortaient et que les nôtres entraient. @returns {Object<string, number>} */
function annonceRemplacement(cartes, unites) {
    const rempl = (unites || []).filter(u => u.remplace?.length);
    if (!rempl.length) return {};
    const cles = new Set(rempl.flatMap(u => u.remplace.map(e => `${u.slugSet}|${e.cleR2}`)));
    const apres = cartes.map(c => ({ ...c, images: [...(c.images || []).filter(e => !cles.has(`${e.set}|${e.cleR2}`)), ...rempl.filter(u => u.carteId === c._id).map(u => ({ set: u.slugSet, source: P.SOURCE, lot: P.LOT, numero: u.numero, cleR2: P.cleR2(u.slugSet, u.numero, u.carteId) }))] }));
    const { baisses } = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }));
    return Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
}

/** Les produits SERVIS avant et après le plan, la règle du site IMPORTÉE (simuler-servis.js) — en mémoire, rien d'écrit. */
async function servisAvantApres(db, unites, regles) {
    const { produitsServis } = require('./collecte-cartes/simuler-servis');
    const slugs = [...new Set(unites.map(u => u.slugSet))];
    if (!slugs.length) return { avant: 0, apres: 0, nouveaux: [], perdus: [] };
    const setsDocs = await db.collection('sets').find({ _id: { $in: slugs } }).toArray();
    const exps = [...new Set(setsDocs.flatMap(s => [].concat(s.idExpansion ?? [])))];
    const lignes = await db.collection('cartes_produits').find({ idExpansion: { $in: exps } }).toArray();
    const cartes = await db.collection('cartes').find({ $or: [{ sets: { $in: slugs } }, { _id: { $in: unites.map(u => u.carteId) } }] }).toArray();
    const avant = await produitsServis({ setsDocs, cartes, lignes, regles });
    const cles = new Set(unites.flatMap(u => (u.remplace || []).map(e => `${u.slugSet}|${e.cleR2}`)));
    const apresCartes = cartes.map(c => ({ ...c, images: [...(c.images || []).filter(e => !cles.has(`${e.set}|${e.cleR2}`)), ...unites.filter(u => u.carteId === c._id).map(u => ({ set: u.slugSet, source: P.SOURCE, lot: P.LOT, numero: u.numero, cleR2: P.cleR2(u.slugSet, u.numero, u.carteId), sha256: 'simule', w: 700, h: 978, fmt: 'webp', langue: 'en' }))] }));
    const apres = await produitsServis({ setsDocs, cartes: apresCartes, lignes, regles });
    return { avant: avant.size, apres: apres.size, nouveaux: [...apres].filter(id => !avant.has(id)), perdus: [...avant].filter(id => !apres.has(id)) };
}

// ── L'ÉCRITURE, depuis le cache seulement ─────────────────────────────────────────────────────────────────────────────────────
async function compterEntrees(db, carteIds, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!(e?.source === P.SOURCE && e.lot === P.LOT)) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}
const cleEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;

/**
 * @param {object[]} plan   les unités (P.apparier().plan)
 * @param {object} M        les modèles de la base `cartes`
 * @param {{dossierCache: string, attendu?: number, deposer: Function, vignetter: Function, fabriquerVerrouSet?: Function, stopOctets?: number, rejets?: Map<number, string>}} o
 *   rejets : idProduct -> motif, la liste du coordinateur après la planche (une image dont un produit est rejeté n'est pas écrite).
 */
async function ecrire(plan, M, { dossierCache, attendu = null, deposer, vignetter, fabriquerVerrouSet = null, stopOctets = STOP_OCTETS, rejets = new Map() } = {}) {
    if (typeof deposer !== 'function' || typeof vignetter !== 'function') throw new Error('ecrire : deposer et vignetter sont exigés');
    const db = M.Carte.db.db;
    const index = lireIndex(dossierCache);
    const seuil = largeurMinDe(P.SOURCE);
    // ---- 0. le PRÉ-PASSAGE : ce que le cache permet d'écrire, avant la moindre écriture ----------------------------------------------------------------
    // les rejets du coordinateur sont PERSISTÉS dans le dossier du cache (REJETS.json) et relus à chaque écriture
    const tousRejets = new Map([...lireRejets(dossierCache), ...rejets]);
    if (rejets.size) ecrireRejets(dossierCache, tousRejets);
    const lus = [];
    let horsCache = 0, altere = 0, retires = 0;
    for (const u of plan) {
        const e = index.images[u.url];
        if (!P.urlImageValide(u.url) || e?.statut !== 'ok') { horsCache++; continue; }
        let buffer; try { buffer = fs.readFileSync(path.join(dossierCache, e.fichier)); } catch { horsCache++; continue; }
        if (sha('sha256', buffer) !== e.sha256) { altere++; console.error(`❌ cache altéré (sha256) : ${u.url}`); continue; }
        const meta = await sharp(buffer).metadata();
        const _id = P.idImage(u.slugSet, u.carteId, u.numero);
        const deja = await M.Image.findById(_id).select('etat rejetPar rejetMotif').lean();
        if (deja?.etat === 'retire') { retires++; continue; }
        // une image REJETÉE par le coordinateur (planche) ne s'écrit jamais : ni avec, ni sans --rejets=, ni sur une base où son document le dit
        lus.push({ u, _id, buffer, meta, e, dejaEtat: deja?.etat ?? null, rejetBase: deja?.etat === 'rejete' && deja.rejetPar === 'coordinateur' ? (deja.rejetMotif || 'rejet du coordinateur') : null });
    }
    const identiques = P.imagesIdentiques(lus.map(p => ({ url: p.u.url, sha256: p.e.sha256 })));
    const prets = [], rejetes = [];
    for (const p of lus) {
        const parCoordinateur = p.u.produits.map(id => tousRejets.get(id)).find(Boolean) ?? p.rejetBase;
        const ctl = P.controlerImage({ octets: p.buffer, w: p.meta.width, h: p.meta.height });
        if (parCoordinateur) rejetes.push({ ...p, motif: parCoordinateur, auto: false });
        else if (ctl && ctl !== 'trop-petit') rejetes.push({ ...p, motif: ctl, auto: true });
        else if (identiques.has(p.u.url)) rejetes.push({ ...p, motif: 'meme-image-plusieurs-adresses', auto: true });
        else if (!ctl && await controleVisuel(p.buffer)) rejetes.push({ ...p, motif: await controleVisuel(p.buffer), auto: true });
        else prets.push({ ...p, petit: !p.meta.width || p.meta.width < seuil });
    }
    const reel = prets.filter(p => !p.petit).length;
    if (attendu != null && attendu !== reel) {
        console.error(`❌ --attendu=${attendu} mais ${reel} image(s) à écrire (hors cache ${horsCache}, altérées ${altere}, retirées ${retires}, rejetées ${rejetes.length}, sous le seuil ${prets.filter(p => p.petit).length}) — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-attendu', resultats: [], attendu, reel, horsCache, altere, rejetes: rejetes.length };
    }
    // ---- les rejets s'ÉCRIVENT (notés) : une image rejetée n'est jamais reprise par un rejeu -----------------------------------------------------------
    for (const r of rejetes) {
        if (['ok', 'remplace'].includes(r.dejaEtat)) continue;
        await M.Image.updateOne({ _id: r._id }, { $set: { source: P.SOURCE, set: r.u.slugSet, carteId: r.u.carteId, numero: r.u.numero, urlOriginal: r.u.url, wOriginal: r.meta.width, hOriginal: r.meta.height, sha1Original: sha('sha1', r.buffer),
            etat: 'rejete', rejetMotif: r.motif, rejetPar: r.auto ? 'controle' : 'coordinateur', rejeteLe: new Date(), lot: P.LOT } }, { upsert: true });
    }
    // ---- 1. un set après l'autre ------------------------------------------------------------------------------------------------------------------------
    const bucket = process.env.R2_BUCKET_IMAGES;
    const resultats = [];
    for (const slug of [...new Set(prets.map(p => p.u.slugSet))]) {
        const unites = prets.filter(p => p.u.slugSet === slug);
        const refus = (etat, erreur) => { console.error(`❌ ${slug} : ${erreur}.`); resultats.push({ code: slug, etat, erreur }); };
        const set = await M.Set.findById(slug).select('tirage region').lean();
        if (!set) { refus('refuse-set', 'set absent de la base'); continue; }
        if ((set.tirage ?? set.region) !== 'intl') { refus('refuse-set', `tirage ${set.tirage ?? set.region} en base : la source ne sert que des cartes anglaises`); continue; }
        const st = await db.command({ dbStats: 1 });
        if (st.dataSize + st.indexSize > stopOctets) { refus('refuse-taille-base', 'base au-delà de 400 Mo'); continue; }
        const idEtat = `${P.SOURCE}/${slug}`;
        const verrouSet = fabriquerVerrouSet ? fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat }) : null;
        if (verrouSet) { const tenu = await verrouSet.prendre(); if (tenu) { resultats.push({ code: slug, etat: 'refuse-verrou' }); continue; } }
        try {
            let telecharges = 0, sautes = 0, tropPetits = 0;
            const ecrits = [], uniteDe = new Map();
            for (const p of unites) {
                uniteDe.set(p._id, p.u);
                const { u, _id, meta, buffer } = p;
                const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat').lean();
                if (p.petit) {
                    tropPetits++;
                    if (deja?.etat !== 'trop-petit') await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: u.carteId, numero: u.numero, urlOriginal: u.url, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: seuil, lot: P.LOT } }, { upsert: true });
                    continue;
                }
                if (deja?.etat === 'ok' && deja.sha256 && deja.urlOriginal === u.url) { sautes++; ecrits.push(_id); continue; }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = P.cleR2(slug, u.numero, u.carteId);
                await deposer(bucket, cleR2, webp.data, 'image/webp');
                const lg = langueDuVisuel({ source: P.SOURCE, langueSource: 'en', urlOriginal: u.url });
                await M.Image.updateOne({ _id }, { $set: {
                    source: P.SOURCE, set: slug, carteId: u.carteId, numero: u.numero, nomEn: u.nomEn, idProduct: u.produits[0], produits: u.produits, preuve: u.preuve, voie: u.voie, action: u.action, urlOriginal: u.url,
                    caseSource: u.pkcSet, numeroSource: u.numeroPkc, ...(u.aRegarder ? { aRegarder: true } : {}),
                    wOriginal: meta.width, hOriginal: meta.height, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length,
                    cleR2, sha256: sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                    ...marqueDe({ wOriginal: meta.width }),
                    langueSource: 'en', langue: lg.langue, languePreuve: lg.preuve, attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, telechargeLe: new Date(), retirable: true, collecteLe: new Date(p.e.le), etat: 'ok' }, $unset: { erreur: 1 } }, { upsert: true });
                telecharges++; ecrits.push(_id);
            }
            // ---- JOINTURE, sous sa garde : ajout, ou remplacement d'une basse définition de même impression ---------------------------------------------------
            const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
            const avant = await compterEntrees(db, carteIds, slug);
            const images = (await M.Image.find({ source: P.SOURCE, set: slug, etat: 'ok', lot: P.LOT }).lean()).filter(im => ecrits.includes(im._id));
            let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null, remplacees = 0;
            const retirees = [];                              // les entrées basses sorties par le remplacement (clé de compterEntrees) : la garde les attend absentes
            try {
                for (const im of images) {
                    const c = await M.Carte.findById(im.carteId).select('images').lean();
                    if (!c) { cartesAbsentes++; continue; }
                    const nous = e => e?.source === P.SOURCE && e.set === slug && (e.numero ?? null) === (im.numero ?? null);
                    const autres = (c.images || []).filter(e => e && !nous(e));
                    // ce qui sort est ce que le PLAN nomme (basse définition de même impression, ou image fausse : un scan d'une autre langue refusé par la règle du site au numéro exact), et seulement si l'entrée est encore là
                    // au même set : le plan est recalculé à l'écriture contre l'état de la base (planifierDepuisBase)
                    const nommees = new Set((uniteDe.get(im._id)?.remplace || []).map(r => `${r.source}|${r.cleR2}`));
                    const sortantes = new Set(autres.filter(e => nommees.has(`${e.source}|${e.cleR2}`)).map(e => `${e.source}|${e.cleR2}`));
                    const admises = autres.filter(e => !sortantes.has(`${e.source}|${e.cleR2}`));
                    const entree = { set: slug, source: P.SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, numero: im.numero ?? null, ...marqueDe(im), attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, langue: im.langue, languePreuve: im.languePreuve, retirable: true, collecteLe: im.collecteLe, urlOriginal: im.urlOriginal, jointeLe: new Date() };
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero ?? null } } });
                    if (T.dejaServi({ images: admises }, slug, im.numero ?? null)) { dejaParAutre++; continue; }     // une AUTRE source sert ce numéro : intacte, la nôtre cède
                    const sorties = [];
                    for (const e of autres.filter(x => sortantes.has(`${x.source}|${x.cleR2}`))) {
                        await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: e.source, cleR2: e.cleR2 } } });
                        await M.Image.updateOne({ source: e.source, set: slug, carteId: im.carteId, cleR2: e.cleR2 }, { $set: { etat: 'remplace', remplacePar: { source: P.SOURCE, cleR2: im.cleR2 }, remplaceLe: new Date() } });
                        retirees.push(cleEntree(im.carteId, e)); remplacees++; sorties.push(e);
                    }
                    if (sorties.length) await M.Image.updateOne({ _id: im._id }, { $set: { remplaceDes: sorties } });     // l'historique COMPLET (adresse, vignette…) : le retrait rétablit ces entrées
                    await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                    joints++;
                }
            } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
            const apres = await compterEntrees(db, carteIds, slug);
            const attenduesAutres = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');
            const garde = attenduesAutres === apres.autres && apres.siennes === joints;
            if (!garde) console.error(`🔴 ${slug} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres}${attenduesAutres === apres.autres ? '' : ' (CHANGÉES)'} (attendu ${avant.nAutres - retirees.length}), entrées ${P.SOURCE} ${apres.siennes} pour ${joints} jointes`);
            const W = await vignetter(db, slug, { bucket, arreter: () => false });
            console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)`}`);
            const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
            const complet = { vignettes: W.vg, source: P.SOURCE, mention: P.MENTION, lot: P.LOT, unites: unites.length, telecharges, sautes, tropPetits, joints, dejaParAutre, cartesAbsentes, garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attenduesAutres === apres.autres, remplacees, siennesApres: apres.siennes, ok: garde }, erreurJointure,
                concordance: garde && !erreurJointure && vignettesOk && cartesAbsentes === 0 && telecharges + sautes + tropPetits === unites.length, verifieLe: new Date() };
            await M.Set.updateOne({ _id: slug }, { $set: { visuelsPkc: complet } });
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), bilan: complet } }, { upsert: true });
            console.log(`   ${slug} : unités ${unites.length} · déposées ${telecharges} · reprises ${sautes} · sous le seuil ${tropPetits} · joints ${joints} · remplacées ${remplacees} · cédées ${dejaParAutre} · garde ${garde ? '✅' : '❌'} · requêtes 0`);
            resultats.push({ code: slug, etat: erreurJointure ? 'incomplet' : !garde ? 'non-concordant' : complet.concordance ? 'verifie' : 'incomplet', ...complet });
        } finally { if (verrouSet) await verrouSet.rendre(); }
    }
    const code = resultats.every(r => r.etat === 'verifie') && !horsCache && !altere && !rejetes.some(r => r.auto) ? 0 : 1;
    return { code, resultats, attendu: attendu ?? reel, reel, horsCache, altere, rejetes: rejetes.length };
}

module.exports = { CIBLES_AUTRES, OCTETS_MAX_PAR_IMAGE, lireRejets, fichierRejets, urlsAutorisees, telecharger, controlerCache, controleVisuel, tirerEchantillon, GRAINE_ECHANTILLON, fichesDuSiteDesSets, planche, lireCiblesPkmcom, planifierDepuisBase, annonceRemplacement, servisAvantApres, ecrire, transportFetch, fichierArret, fichierIndex, lireIndex, octetsConformes, STOP_OCTETS };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion.
const AUTORISES = [/^--plan$/, /^--telecharger$/, /^--planche$/, /^--ecrire$/, /^--lot=(kits|mcdo|promos|pkmcom|autres)$/, /^--attendu=\d{1,4}$/, /^--cache=.+$/, /^--sitemaps=.+$/, /^--dossier=.+$/, /^--rejets=.+$/, /^--anciennes=.+$/, /^--cibles=.+$/, /^--par-page=\d{1,2}$/, /^--echantillon=\d{1,3}$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--telecharger', '--planche', '--ecrire'].filter(m => args.includes(m));
const val = (nom, defaut) => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut;
const LOT = val('lot', null);
if (inconnus.length || modes.length > 1 || !LOT || (args.some(a => a.startsWith('--attendu=')) && !args.includes('--ecrire')) || (args.includes('--ecrire') && !args.some(a => a.startsWith('--attendu=')))) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}${LOT ? '' : '--lot=kits|mcdo|promos|pkmcom|autres est exigé — '}un seul mode parmi --plan (défaut), --telecharger, --planche, --ecrire ; --ecrire exige --attendu=<N> (et lui seul l'accepte). Options : --cache=, --sitemaps=, --dossier=, --rejets=<fichier>, --anciennes=<dossier>, --cibles=<fichier> (pkmcom), --par-page=<N>.`);
    process.exitCode = 2;
}
const argsValides = process.exitCode !== 2;
const dossierSitemaps = val('sitemaps', P.DOSSIER_SITEMAPS), dossierCache = val('cache', P.DOSSIER_CACHE), dossierLot = val('dossier', P.DOSSIER_LOT);
const fichierPlan = path.join(dossierLot, `plan-${LOT}.json`);

async function planComplet(db) {
    const lu = P.lireSitemaps(dossierSitemaps);
    const idx = P.indexer(lu.entrees);
    // la règle du site (refusDuVisuel) est IMPORTÉE du site : si elle ne se charge pas, le plan LÈVE (jamais un repli silencieux)
    const { reglesDuSite } = require('./collecte-cartes/simuler-servis');
    const R = await reglesDuSite();
    const cibles = LOT === 'pkmcom' ? lireCiblesPkmcom(val('cibles', CIBLES_PKMCOM)) : LOT === 'autres' ? lireCiblesAutres() : null;
    const p = await planifierDepuisBase(db, { lot: LOT, entrees: idx.lues, refusSite: R.refusDuVisuel, cibles, regles: R });
    return { lu, idx, R, cibles, ...p };
}
if (argsValides) (async () => {
    const mode = modes[0] || '--plan';
    if (mode === '--telecharger' || mode === '--planche') {
        const j = JSON.parse(fs.readFileSync(fichierPlan, 'utf8'));
        if (mode === '--telecharger') {
            const lu = P.lireSitemaps(dossierSitemaps);
            const a = urlsAutorisees(j.plan, lu.entrees);
            console.log(`${a.ok.length} adresse(s) autorisée(s) (plan ∩ sitemap), ${a.refusees.length} refusée(s) : ${JSON.stringify(a.refusees)}`);
            const r = await telecharger({ urls: a.ok, dossierCache });
            console.log(`TÉLÉCHARGEMENT : ${r.etat} · ${r.requetes} requête(s) (plafond ${r.plafond}) ${r.motif ? `· ${r.motif}` : ''}`);
            process.exitCode = r.etat === 'termine' || r.etat === 'rien-a-faire' ? 0 : 1;
            return;
        }
        const motifs = await controlerCache(j.plan, dossierCache);
        fs.writeFileSync(fichierPlan, JSON.stringify({ ...j, controle: Object.fromEntries(motifs), controleLe: new Date().toISOString() }, null, 1));      // un refus est écrit dans le plan avec son motif
        const parMotif = {}; for (const m of motifs.values()) parMotif[m] = (parMotif[m] || 0) + 1;
        console.log(`CONTRÔLE : ${j.plan.length} unité(s), ${motifs.size} image(s) refusée(s) par le contrôle ${JSON.stringify(parMotif)}`);
        for (const u of j.plan) if (motifs.has(u.url)) console.log(`   ${u.produits.join(',')} ${u.nomEn} (${u.slugSet} n°${u.numero ?? '∅'}) : ${motifs.get(u.url)}`);
        const r = await planche({ unites: j.plan, dossierCache, sortie: dossierLot, lot: LOT, parPage: Number(val('par-page', 6)), dossierAnciennes: val('anciennes', null), motifs });
        fs.writeFileSync(path.join(dossierLot, `planche-${LOT}.json`), JSON.stringify({ le: new Date().toISOString(), lot: LOT, pages: r.pages, horsCache: r.horsCache, controle: Object.fromEntries(motifs) }, null, 1));
        console.log(`PLANCHE : ${r.pages.length} page(s) dans ${dossierLot} (planche-${LOT}-N.png) · hors cache : ${r.horsCache.length} produit(s) ${JSON.stringify(r.horsCache)}`);
        const nEch = Number(val('echantillon', 0));
        if (nEch && j.plan.length > 200) {
            const ech = tirerEchantillon(j.plan, nEch);
            const re = await planche({ unites: ech, dossierCache, sortie: dossierLot, lot: `${LOT}-echantillon`, parPage: Number(val('par-page', 6)), dossierAnciennes: val('anciennes', null), motifs });
            console.log(`ÉCHANTILLON : ${ech.length} unité(s) tirées au sort, graine ${GRAINE_ECHANTILLON} → ${re.pages.length} page(s) planche-${LOT}-echantillon-N.png (EN PLUS de la planche complète)`);
        } else if (nEch) console.log(`ÉCHANTILLON non fait : le lot compte ${j.plan.length} image(s), l'option vaut au-delà de 200 (la planche complète suffit).`);
        return;
    }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: mode === '--ecrire' ? ['R2_BUCKET_IMAGES'] : [] });
    try {
        const p = await planComplet(cx.db);
        const parSet = {}; for (const u of p.plan) { const s = parSet[u.slugSet] ||= { appariees: 0, produits: 0, ajouts: 0, remplacements: 0, sautes: {} }; s.appariees++; s.produits += u.produits.length; s[u.action === 'remplacement' ? 'remplacements' : 'ajouts']++; }
        for (const r of p.restes) { if (!r.slugSet) continue; const s = parSet[r.slugSet] ||= { appariees: 0, produits: 0, ajouts: 0, remplacements: 0, sautes: {} }; s.sautes[r.motif] = (s.sautes[r.motif] || 0) + 1; }
        const motifs = {}; for (const r of p.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`sitemaps : ${p.lu.fichiers} fichiers, ${p.lu.entrees.length} entrées, ${p.lu.ecartees.length} écartée(s) · adresses de la table lues ${p.idx.lues.length}, illisibles ${p.idx.illisibles.length}, hors table ${p.idx.horsTable}`);
        console.log(`PLAN « ${LOT} » : ${p.plan.length} image(s) pour ${p.plan.reduce((n, u) => n + u.produits.length, 0)} produit(s) (${p.plan.filter(u => u.action === 'ajout').length} ajout(s), ${p.plan.filter(u => u.action === 'remplacement').length} remplacement(s)) sur ${p.lignes} lignes · restes ${JSON.stringify(motifs)}`);
        for (const [s, v] of Object.entries(parSet).sort()) console.log(`   ${s.padEnd(46)} apparié ${String(v.produits).padStart(3)} produit(s) (${v.ajouts} ajout, ${v.remplacements} remplacement) · sauté ${JSON.stringify(v.sautes)}`);
        if (mode === '--plan') {
            const servis = await servisAvantApres(cx.db, p.plan, p.R);
            console.log(`SERVIS (règle du site importée) : ${servis.avant} → ${servis.apres} (+${servis.apres - servis.avant}), ${servis.perdus.length} perdu(s)`);
            const urls = [...new Set(p.plan.map(u => u.url))];
            const annonce = annonceRemplacement(await cx.db.collection('cartes').find({ _id: { $in: p.plan.map(u => u.carteId) } }, { projection: { sets: 1, nomEn: 1, images: 1 } }).toArray(), p.plan);
            fs.mkdirSync(dossierLot, { recursive: true });
            fs.writeFileSync(fichierPlan, JSON.stringify({ le: new Date().toISOString(), lot: LOT, sitemaps: { fichiers: p.lu.fichiers, entrees: p.lu.entrees.length, ecartees: p.lu.ecartees.length, lues: p.idx.lues.length, illisibles: p.idx.illisibles.length, horsTable: p.idx.horsTable }, lignes: p.lignes, plan: p.plan, restes: p.restes, parSet, servis, urls }, null, 1));
            if (Object.keys(annonce).length) fs.writeFileSync(path.join(dossierLot, `annonce-${LOT}.json`), JSON.stringify(annonce, null, 1));
            console.log(`plan écrit : ${fichierPlan} · requêtes à faire : ${urls.length} images + 1 robots.txt, ≥ ${P.CADENCE_MS / 1000} s entre deux (≈ ${Math.ceil((urls.length + 1) * P.CADENCE_MS / 60000)} min)${Object.keys(annonce).length ? ` · annonce des baisses du remplacement (${Object.keys(annonce).length} groupe(s)) → annonce-${LOT}.json` : ''}`);
            return;
        }
        const r2 = require('./collecte-cartes/r2');
        const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
        const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
        if (!process.env.R2_BUCKET_IMAGES) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune écriture');
        await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
        const fichierRejets = val('rejets', null);
        const rejets = new Map(fichierRejets ? (JSON.parse(fs.readFileSync(fichierRejets, 'utf8')).rejets || []).map(x => [x.idProduct, String(x.motif || 'rejet du coordinateur')]) : []);
        const r = await ecrire(p.plan, modeles(cx), { dossierCache, attendu: Number(val('attendu')), rejets, deposer: (b, c, d, t) => r2.deposerBinaire(b, c, d, t), vignetter: vignetterApresJointure,
            fabriquerVerrouSet: ({ Modele, id }) => fabriquerVerrou({ Modele, id, dureeMs: 10 * 60 * 1000, surInsertion: { debute: new Date(), phase: 'plan' }, nom: `verrou de set ${id}` }) });
        console.log(`ÉCRITURE : code ${r.code} · attendu ${r.attendu} · réel ${r.reel} · hors cache ${r.horsCache} · altérées ${r.altere} · rejetées ${r.rejetes} · REQUÊTES 0`);
        console.log(`SETS : ${r.resultats.map(x => x.code).join(',')}`);
        process.exitCode = r.code;
    } finally { await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
