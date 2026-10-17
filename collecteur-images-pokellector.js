// ============================================================
// COLLECTEUR D'IMAGES — POKELLECTOR (visuels 570×792 de ce qui MANQUE encore après pkmncards et pokedata) -> cache local -> R2 (WebP) + base `cartes` (lot POKELLECTOR, 2026-10-17)
// ============================================================
//   node collecteur-images-pokellector.js --releve --plafond=<N> [--sets=<slug,…>] [--cache=] [--couverts=<dossier,…>]   LES REQUÊTES DE PAGES (liste, pages de set, pages de carte) — après relecture
//   node collecteur-images-pokellector.js --plan [--couverts=<dossier,…>] [--cache=] [--sortie=]                        (défaut) la SIMULATION : zéro requête, écrit plan.json
//   node collecteur-images-pokellector.js --telecharger [--cache=] [--sortie=]                                           LES REQUÊTES D'IMAGES : seules les adresses relevées du plan
//   node collecteur-images-pokellector.js --planche [--echantillon=50] [--cache=] [--sortie=]                            une planche-contact d'un échantillon du cache, À REGARDER avant d'écrire
//   node lot-additif.js --quoi="… : N visuels (lot pokellector-2026-10)" --collections=cartes,images --compte=images:source=pokellector -- node collecteur-images-pokellector.js --ecrire --attendu=<N>
//
// ⛔ CINQ PHASES, DEUX SEULES SORTENT. --plan, --planche et --ecrire ne font AUCUNE requête (l'écriture lit le cache) ; --releve et --telecharger partagent UN SEUL flux :
//   · hôtes : www.pokellector.com (pages) et den-cards.pokellector.com (images) seuls (collecte-cartes/pokellector.js HOTES) ; agent honnête du dépôt, AUCUN en-tête de navigateur,
//     AUCUN cookie, redirection jamais suivie ; ≥ 5 s entre deux requêtes (6 s) ; plafond de requêtes exigé ; robots.txt de l'hôte relu avant la première requête vers lui ;
//   · UNE ADRESSE RELEVÉE, JAMAIS CONSTRUITE : une page n'est demandée que si son adresse figure dans une page déjà lue ; une image que si son adresse figure, mot pour mot, dans une page de carte
//     (ou un panneau de détail) lue ET dans le plan ; une vignette (« .thumb ») ou une image de moins de 570 px n'entre jamais ;
//   · ARRÊT DÉFINITIF au premier 401, 403, 410, 429, défi anti-robot, redirection ou HTML à la place d'une image : un fichier d'arrêt est écrit dans le dossier du cache et tout lancement suivant
//     (relevé OU téléchargement) REFUSE de partir tant qu'il existe — seul le testeur décide de le retirer. Une coupure ou un 5xx INTERROMPT sans l'écrire.
// Le retrait en un lot : retirer-visuels-pokellector.js. Ce que les appariements prouvent : collecte-cartes/pokellector.js.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pokellector');
const T = require('./collecte-cartes/tpc');
const { cleNumero } = require('./collecte-cartes/jointure');
const { WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { marqueDe } = require('./collecte-cartes/basse-definition');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const STOP_OCTETS = 400 * 1024 * 1024;
const CRAWL_DELAY_MAX_S = 60;
const DOSSIERS_COUVERTS = ['C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\PKMNCARDS'];
// pokedata (728 px) passe avant cette source (570 px) : son plan, s'il existe, couvre ses produits ; sinon la LISTE de ses sets (fixture de la sonde du lot POKEDATA) les réserve.
const DOSSIER_POKEDATA_LOT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\POKEDATA-LOT';
const LISTE_POKEDATA = path.join(__dirname, 'fixtures', 'pokellector', 'pokedata-liste-sets.json');

// ── les fichiers du cache ───────────────────────────────────────────────────────────────────────────────────────────────────────
const fichierArret = dossier => path.join(dossier, 'ARRET-DEFINITIF.json');
const dossierPagesDe = dossier => path.join(dossier, 'pages');
const dossierImagesDe = dossier => path.join(dossier, 'images');
const fichierIndex = dossier => path.join(dossierImagesDe(dossier), 'index.json');
const nomFichier = url => new URL(url).pathname.slice(1).replace(/\//g, '__');
function lireIndex(dossier) { try { const j = JSON.parse(fs.readFileSync(fichierIndex(dossier), 'utf8')); return j?.images ? j : { version: 1, images: {} }; } catch { return { version: 1, images: {} }; } }
function ecrireIndex(dossier, index) { fs.mkdirSync(dossierImagesDe(dossier), { recursive: true }); fs.writeFileSync(fichierIndex(dossier), JSON.stringify(index, null, 1)); }

// ── le transport RÉEL : l'agent du dépôt seul, aucun cookie, aucune redirection suivie, les deux hôtes seuls ──────────────────────────
const estRobots = url => { try { const u = new URL(url); return u.protocol === 'https:' && P.HOTES.includes(u.hostname) && u.pathname === '/robots.txt' && !u.search && !u.port && !u.username; } catch { return false; } };
const adresseAdmise = url => estRobots(url) || P.urlPageValide(url) || P.urlImageValide(url);
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        if (!adresseAdmise(url)) throw new Error(`pokellector : adresse hors de ce que le collecteur autorise (les deux hôtes, robots.txt, pages et images relevées) — aucune requête`);
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': P.UA }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const cfMitigated = r.headers.get('cf-mitigated');
        const imperva = /imperva|incapsula/i.test(`${r.headers.get('x-cdn') || ''} ${r.headers.get('set-cookie') || ''}`) || !!r.headers.get('x-iinfo');
        const type = r.headers.get('content-type') || '';
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), cfMitigated, imperva };
        if (r.status === 404 || r.status === 410) return { status: r.status, type, texte: (await r.text()).slice(0, 3000), cfMitigated, imperva };
        if (binaire && r.ok && /^image\//.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()), cfMitigated, imperva };
        return { status: r.status, type, texte: await r.text(), cfMitigated, imperva };
    }
};

// ── LE FLUX UNIQUE : cadence, plafond, robots, jugement, arrêt définitif ─────────────────────────────────────────────────────────────────
function creerFlux({ dossierCache, transport = transportFetch, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, cadenceMs = P.CADENCE_MS, plafond = Infinity }) {
    let requetes = 0, dernier = null, cadence = Math.max(cadenceMs, P.CADENCE_MS);
    const robots = new Map();                                    // hôte -> texte du robots.txt ou null (aucune règle)
    const flux = { dossierCache, get requetes() { return requetes; }, plafond };
    const arret = (url, motif, status = null) => { fs.mkdirSync(dossierCache, { recursive: true }); fs.writeFileSync(fichierArret(dossierCache), JSON.stringify({ le: new Date().toISOString(), url, status, motif, requetes }, null, 1)); return { etat: 'arret-definitif', motif }; };
    const brut = async (url, o) => {
        if (requetes >= plafond) return { etat: 'interrompu', motif: 'plafond de requêtes atteint' };
        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
        dernier = now(); requetes++;
        try { return { r: await transport.get(url, o) }; } catch (e) { return { etat: 'interrompu', motif: e.message }; }
    };
    /** @returns {Promise<{etat: 'ok'|'absent'|'arret-definitif'|'interrompu'|'plafond'|'robots-interdit'|'refuse-arret', r?: object, motif?: string}>} */
    flux.demander = async (url, { image = false } = {}) => {
        if (fs.existsSync(fichierArret(dossierCache))) return { etat: 'refuse-arret', motif: `${fichierArret(dossierCache)} existe : un arrêt définitif a eu lieu, seul le testeur décide de le lever` };
        if (!(image ? P.urlImageValide(url) : P.urlPageValide(url))) throw Object.assign(new Error(`adresse hors des règles : ${url}`), { horsRegle: true });
        const hote = new URL(url).hostname;
        if (!robots.has(hote)) {
            const ru = `https://${hote}/robots.txt`;
            const b = await brut(ru, {});
            if (b.etat) return b;
            const j = P.jugerReponse(b.r);
            if (j.etat === 'arret') return arret(ru, `robots.txt : ${j.motif}`, b.r.status);
            if (b.r.status === 200) robots.set(hote, b.r.texte ?? '');
            else if (j.etat === 'absent') robots.set(hote, null);
            else return { etat: 'interrompu', motif: `robots.txt illisible (HTTP ${b.r.status}) : on ne peut pas conclure` };
            const delai = T.delaiDesRobots(robots.get(hote), P.UA);
            if (delai && delai > CRAWL_DELAY_MAX_S) { robots.delete(hote); return { etat: 'robots-interdit', motif: `Crawl-delay de ${delai} s` }; }
            if (delai) cadence = Math.max(cadence, delai * 1000);
        }
        if (!T.autoriseParRobots(robots.get(hote), new URL(url).pathname, P.UA)) return { etat: 'robots-interdit', motif: `robots.txt interdit ${new URL(url).pathname}` };
        const b = await brut(url, { binaire: image });
        if (b.etat) return b;
        const j = P.jugerReponse(b.r, { image });
        if (j.etat === 'arret') return arret(url, j.motif, b.r.status);
        return { etat: j.etat, r: b.r, motif: j.motif };
    };
    flux.arreter = arret;
    return flux;
}
const sortie = (flux, r, extra = {}) => ({ etat: r.etat, requetes: flux.requetes, plafond: flux.plafond, refusees: [], ...(r.motif ? { motif: r.motif } : {}), ...extra });

// ── RELEVER LES PAGES ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {{etapes: Function[], dossierCache: string, transport?: object, pause?: Function, now?: Function, cadenceMs?: number, plafond: number}} o
 *   etapes : des fonctions `async () => ({ cibles: [{url, fichier}], autorisees: Set<string> })`, exécutées dans l'ordre : chacune est évaluée APRÈS que la précédente a écrit ses pages
 *   (une adresse n'est demandée que si elle figure dans `autorisees`, c'est-à-dire dans une page déjà lue). Les pages vont dans <dossierCache>/pages/.
 */
async function releverPages({ etapes, dossierCache, transport = transportFetch, pause, now, cadenceMs, plafond }) {
    if (!Number.isFinite(plafond) || plafond < 1) throw new Error('releverPages : un plafond de requêtes est exigé');
    const flux = creerFlux({ dossierCache, transport, pause, now, cadenceMs, plafond });
    const refusees = [];
    if (fs.existsSync(fichierArret(dossierCache))) return sortie(flux, { etat: 'refuse-arret', motif: `${fichierArret(dossierCache)} existe : un arrêt définitif a eu lieu, seul le testeur décide de le lever` });
    const dp = dossierPagesDe(dossierCache);
    for (const etape of etapes) {
        const { cibles, autorisees } = await etape();
        for (const c of cibles) {
            if (!P.urlPageValide(c.url)) { refusees.push({ url: c.url, motif: 'adresse-hors-regle' }); continue; }
            if (!autorisees.has(c.url)) { refusees.push({ url: c.url, motif: 'hors-releve' }); continue; }
            if (fs.existsSync(path.join(dp, c.fichier))) continue;
            const d = await flux.demander(c.url);
            if (d.etat === 'absent') { refusees.push({ url: c.url, motif: 'absente (404)' }); continue; }
            if (d.etat !== 'ok') return sortie(flux, d, { refusees });
            fs.mkdirSync(dp, { recursive: true });
            fs.writeFileSync(path.join(dp, c.fichier), d.r.texte);
        }
    }
    return sortie(flux, { etat: 'termine' }, { refusees });
}

// ── TÉLÉCHARGER LES IMAGES ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Les adresses du plan présentes MOT POUR MOT dans le relevé (pages de carte / panneaux de détail lus) ET valables. */
function urlsAutorisees(plan, cartes) {
    const relevees = new Set(cartes.map(c => c.img).filter(Boolean));
    const ok = [], refusees = [];
    for (const u of new Set(plan.map(p => p.url))) {
        if (!P.urlImageValide(u)) refusees.push({ url: u, motif: 'adresse-hors-regle' });
        else if (!relevees.has(u)) refusees.push({ url: u, motif: 'hors-releve' });
        else ok.push(u);
    }
    return { ok, refusees };
}
/** @returns {{etat: 'termine'|'rien-a-faire'|'refuse-arret'|'robots-interdit'|'arret-definitif'|'interrompu', requetes: number, plafond: number, refusees: object[], motif?: string}} */
async function telecharger({ urls, dossierCache, transport = transportFetch, pause, now, cadenceMs, plafond: plafondMax = null }) {
    if (fs.existsSync(fichierArret(dossierCache))) return { etat: 'refuse-arret', requetes: 0, plafond: 0, refusees: [], motif: `${fichierArret(dossierCache)} existe : un arrêt définitif a eu lieu, seul le testeur décide de le lever` };
    const refusees = [...new Set(urls)].filter(u => !P.urlImageValide(u)).map(u => ({ url: u, motif: 'adresse-hors-regle' }));
    const index = lireIndex(dossierCache);
    const afaire = [...new Set(urls)].filter(u => P.urlImageValide(u) && !['ok', 'absent', 'trop-petit', 'dos-de-carte'].includes(index.images[u]?.statut));
    if (!afaire.length) return { etat: 'rien-a-faire', requetes: 0, plafond: 0, refusees };
    const flux = creerFlux({ dossierCache, transport, pause, now, cadenceMs, plafond: Math.min(afaire.length + 1, plafondMax ?? Infinity) });
    fs.mkdirSync(path.join(dossierImagesDe(dossierCache), 'img'), { recursive: true });
    for (const url of afaire) {
        const d = await flux.demander(url, { image: true });
        if (d.etat === 'absent') { index.images[url] = { statut: 'absent', status: 404, le: new Date().toISOString() }; ecrireIndex(dossierCache, index); continue; }
        if (d.etat !== 'ok') return sortie(flux, d, { refusees });
        const octets = d.r.octets;
        if (!P.estUneImage(octets)) { const a = flux.arreter(url, 'les octets reçus ne sont pas une image (page de défi probable)', d.r.status); return sortie(flux, a, { refusees }); }
        if (P.estUnDos(octets)) { index.images[url] = { statut: 'dos-de-carte', le: new Date().toISOString() }; ecrireIndex(dossierCache, index); continue; }
        const meta = await sharp(octets).metadata();
        if (!P.estPleineTaille(meta.width)) { index.images[url] = { statut: 'trop-petit', w: meta.width ?? null, h: meta.height ?? null, le: new Date().toISOString() }; ecrireIndex(dossierCache, index); continue; }
        const fichier = path.join('img', nomFichier(url));
        fs.writeFileSync(path.join(dossierImagesDe(dossierCache), fichier), octets);
        index.images[url] = { statut: 'ok', fichier, sha256: P.sha('sha256', octets), octets: octets.length, w: meta.width, h: meta.height, fmt: meta.format, le: new Date().toISOString() };
        ecrireIndex(dossierCache, index);
    }
    return sortie(flux, { etat: 'termine' }, { refusees });
}

// ── LE PLAN (lecture seule de la base, aucune requête) ─────────────────────────────────────────────────────────────────────────────────
/** Les produits déjà pris par une source plus grande : tous les `plan-*.json` des dossiers (plan et remplacements). Un dossier introuvable LÈVE (jamais « rien n'est couvert » par défaut). */
function lireCouverts(dossiers = DOSSIERS_COUVERTS) {
    const produits = new Set(); let fichiers = 0;
    for (const dossier of dossiers) {
        if (!fs.existsSync(dossier)) throw new Error(`couverts : le dossier ${dossier} n'existe pas — le plan de cette source n'est pas encore là, on ne suppose pas qu'elle ne couvre rien`);
        const plans = fs.readdirSync(dossier).filter(x => /^plan.*\.json$/.test(x)).sort();
        if (!plans.length) throw new Error(`couverts : aucun plan-*.json dans ${dossier} — le plan de cette source n'est pas encore là ; zéro fichier n'est pas « rien de couvert »`);
        for (const f of plans) {
            let j; try { j = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')); } catch { throw new Error(`couverts : ${f} illisible`); }
            fichiers++;
            for (const u of [...(j.plan || []), ...(j.remplacements || [])]) for (const id of u.produits || []) produits.add(id);
        }
    }
    return { produits, fichiers };
}
/** Le plan pokedata, s'il existe : NE LÈVE PAS sur son absence (la source est bloquée ; la liste de ses sets prend le relais). */
function lireCouvertsPokedata(dossier = DOSSIER_POKEDATA_LOT) {
    if (!fs.existsSync(dossier)) return { produits: new Set(), fichiers: 0 };
    const produits = new Set(); let fichiers = 0;
    for (const f of fs.readdirSync(dossier).filter(x => /^plan.*\.json$/.test(x)).sort()) {
        const j = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));
        fichiers++;
        for (const u of [...(j.plan || []), ...(j.remplacements || [])]) for (const id of u.produits || []) produits.add(id);
    }
    return { produits, fichiers };
}
/** Tout ce qu'une source plus grande prend : produits des plans (pkmncards, pokedata) et, sans plan pokedata, les sets de sa liste (liste fixture, 694 sets dont 183 anglais). */
function sourcesPlusGrandes(dossiers = DOSSIERS_COUVERTS, dossierPokedata = DOSSIER_POKEDATA_LOT, listePokedata = LISTE_POKEDATA) {
    const cv = lireCouverts(dossiers), pd = lireCouvertsPokedata(dossierPokedata);
    const liste = pd.fichiers ? null : JSON.parse(fs.readFileSync(listePokedata, 'utf8')).sets;
    return { produits: new Set([...cv.produits, ...pd.produits]), fichiers: cv.fichiers + pd.fichiers, pokedataSets: liste, planPokedata: pd.fichiers > 0 };
}
const par = (l, n) => { const o = []; for (let i = 0; i < l.length; i += n) o.push(l.slice(i, i + n)); return o; };
/**
 * Les trous des sets intl, et leur appariement au relevé du CACHE de pages. `db` : la base `cartes`, LECTURE SEULE.
 * @returns {Promise<{plan, restes, remplacements, aReleve, sets: object[], examines: number, cartesReleve: number, ignorees: number}>}
 */
async function planifierDepuisBase(db, { dossierPages = P.DOSSIER_PAGES, couverts = new Set(), refusSite = null, slugsSeulement = null, pokedataSets = null } = {}) {
    let liste;
    try { liste = fs.readFileSync(path.join(dossierPages, 'liste-sets.html'), 'utf8'); } catch { throw new Error(`la liste des sets n'est pas en cache (${path.join(dossierPages, 'liste-sets.html')}) : lance --releve d'abord — la table des sets ne se devine pas`); }
    const sets = await db.collection('sets').find({}, { projection: { tirage: 1, region: 1 } }).toArray();
    const intl = sets.filter(s => (s.tirage ?? s.region) === 'intl').map(s => s._id).filter(s => !slugsSeulement || slugsSeulement.includes(s));
    if (!intl.length) throw new Error('sets : aucun set intl lu — une clé fausse (§41)');
    const table = P.tableDesSets(P.lireListeSets(liste), intl);
    const tableSets = new Map([...table].map(([slug, v]) => [v.href, { slugSet: slug, collection: v.collection }]));
    let lignes = [];
    for (const lot of par(intl, 200)) lignes = lignes.concat(await db.collection('cartes_produits').find({ slugSet: { $in: lot } }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1, slugSet: 1, slug: 1, imageEmprunteeTirage: 1 } }).toArray());
    if (!lignes.length) throw new Error(`cartes_produits : 0 ligne pour ${intl.length} sets intl — une clé fausse (§41)`);
    const parId = new Map();
    for (const lot of par([...new Set(lignes.map(l => l.carteId))], 2000)) for (const c of await db.collection('cartes').find({ _id: { $in: lot } }, { projection: { nomEn: 1, images: 1 } }).toArray()) parId.set(c._id, c);
    const sref = new Map(sets.map(s => [s._id, s.tirage ?? s.region]));
    const refus = refusSite ? (e, slug) => (e.cleR2 ? refusSite(e, sref.get(slug) ?? 'intl') : null) : undefined;
    const trous = lignes.filter(l => parId.has(l.carteId)).map(l => ({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche ?? null, slugProduit: l.slug ?? null, empruntee: l.imageEmprunteeTirage === true, carte: parId.get(l.carteId) }));
    const rel = P.construireReleve(dossierPages);
    const reserves = pokedataSets ? P.slugsReserves(intl, pokedataSets) : new Set();
    const r = P.apparier({ trous, cartes: rel.cartes, tableSets, couverts, reserves, ...(refus ? { refus } : {}) });
    const vusA = new Set();
    const aReleve = r.aReleve.filter(a => !vusA.has(a.cardId) && vusA.add(a.cardId));
    return { ...r, aReleve, reserves: [...reserves], sets: [...table].map(([slugSet, v]) => ({ slugSet, ...v })).filter(s => lignes.some(l => l.slugSet === s.slugSet)), examines: trous.length, cartesReleve: rel.cartes.length, ignorees: rel.ignorees };
}

// ── LA PLANCHE ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une planche-contact d'un échantillon régulier des images du cache appartenant au plan (50 par planche, 10 colonnes) ; `planche.json` dit quelle case est quelle carte. */
async function faireLaPlanche({ plan, dossierCache, sortie: dossierSortie, echantillon = 50 }) {
    const index = lireIndex(dossierCache);
    const dispo = plan.filter(u => index.images[u.url]?.statut === 'ok');
    const n = Math.min(echantillon, dispo.length);
    const choisies = n ? Array.from({ length: n }, (_, i) => dispo[Math.floor(i * dispo.length / n)]) : [];
    fs.mkdirSync(dossierSortie, { recursive: true });
    const L = 190, H = 264, COLS = 10, PAR_PLANCHE = 50;
    const fichiers = [];
    for (let p = 0; p * PAR_PLANCHE < choisies.length; p++) {
        const lot = choisies.slice(p * PAR_PLANCHE, (p + 1) * PAR_PLANCHE);
        const compo = [];
        for (let i = 0; i < lot.length; i++) {
            const buf = await sharp(fs.readFileSync(path.join(dossierImagesDe(dossierCache), index.images[lot[i].url].fichier))).resize({ width: L - 8, height: H - 8, fit: 'contain', background: '#202020' }).png().toBuffer();
            compo.push({ input: buf, left: (i % COLS) * L + 4, top: Math.floor(i / COLS) * H + 4 });
        }
        const f = path.join(dossierSortie, `planche-${String(p + 1).padStart(2, '0')}.png`);
        await sharp({ create: { width: COLS * L, height: Math.ceil(lot.length / COLS) * H, channels: 3, background: '#202020' } }).composite(compo).png().toFile(f);
        fichiers.push(f);
    }
    fs.writeFileSync(path.join(dossierSortie, 'planche.json'), JSON.stringify({ le: new Date().toISOString(), echantillon: n, sur: dispo.length, colonnes: COLS, parPlanche: PAR_PLANCHE, cases: choisies.map((u, i) => ({ planche: Math.floor(i / PAR_PLANCHE) + 1, case: (i % PAR_PLANCHE) + 1, slugSet: u.slugSet, numero: u.numero ?? u.numeroReleve, nom: u.nomEn, carteId: u.carteId, produits: u.produits, aRegarder: !!u.aRegarder })) }, null, 1));
    return { n, fichiers };
}

// ── L'ÉCRITURE, depuis le cache seulement ─────────────────────────────────────────────────────────────────────────────────────────────────
async function compterEntrees(db, carteIds) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = []; let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!(e?.source === P.SOURCE && e.lot === P.LOT)) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}
const cleEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;
/** L'annonce de baisses pour `lot-additif.js --annonce=` quand des remplacements sont demandés (la garde de lot, fonctions de la garde). Sans remplacement : rien. */
function annonceRemplacement(cartes, remplacements) {
    if (!remplacements?.length) return {};
    const cles = new Set(remplacements.flatMap(u => u.refusees.map(e => `${u.slugSet}|${e.cleR2}`)));
    const apres = cartes.map(c => ({ ...c, images: [...(c.images || []).filter(e => !cles.has(`${e.set}|${e.cleR2}`)), ...remplacements.filter(u => u.carteId === c._id).map(u => ({ set: u.slugSet, source: P.SOURCE, lot: P.LOT, numero: u.numero, cleR2: P.cleR2(u.slugSet, u.carteId, u.numero) }))] }));
    const { baisses } = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }));
    return Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
}

/**
 * @param {object[]} plan   les unités (P.apparier().plan)
 * @param {object} M        les modèles de la base `cartes`
 * @param {{dossierCache: string, attendu?: number, deposer: Function, vignetter: Function, fabriquerVerrouSet?: Function, stopOctets?: number, remplacements?: object[], remplacer?: number[]}} o
 */
async function ecrire(plan, M, { dossierCache, attendu = null, deposer, vignetter, fabriquerVerrouSet = null, stopOctets = STOP_OCTETS, remplacements = [], remplacer = [] } = {}) {
    if (typeof deposer !== 'function' || typeof vignetter !== 'function') throw new Error('ecrire : deposer et vignetter sont exigés');
    const db = M.Carte.db.db;
    const index = lireIndex(dossierCache);
    const idsRemplacables = new Set((remplacements || []).flatMap(u => u.produits));
    const inconnus = (remplacer || []).filter(id => !idsRemplacables.has(id));
    if (inconnus.length) {
        console.error(`❌ --remplacer : ${inconnus.join(', ')} ne figure(nt) pas dans le motif « entree-refusee-au-numero » du plan — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-remplacer', resultats: [], attendu: attendu ?? 0, reel: 0, horsCache: 0, altere: 0, inconnus };
    }
    const choisies = (remplacements || []).filter(u => u.produits.some(id => (remplacer || []).includes(id))).map(u => ({ ...u, _remplace: true }));
    // ---- 0. le PRÉ-PASSAGE : ce que le cache permet d'écrire, avant la moindre écriture ----------------------------------------------------------
    const prets = [];
    let horsCache = 0, altere = 0, retires = 0;
    for (const u of [...plan, ...choisies]) {
        const e = index.images[u.url];
        if (!P.urlImageValide(u.url)) { horsCache++; continue; }
        const _id = P.idImage(u.slugSet, u.carteId, u.numero);
        const deja0 = await M.Image.findById(_id).select('etat').lean();
        if (e?.statut === 'trop-petit') { if (deja0?.etat === 'retire') { retires++; continue; } prets.push({ u, _id, buffer: null, meta: { width: e.w, height: e.h }, petit: true }); continue; }
        if (e?.statut !== 'ok') { horsCache++; continue; }
        let buffer; try { buffer = fs.readFileSync(path.join(dossierImagesDe(dossierCache), e.fichier)); } catch { horsCache++; continue; }
        if (P.sha('sha256', buffer) !== e.sha256) { altere++; console.error(`❌ cache altéré (sha256) : ${u.url}`); continue; }
        const meta = await sharp(buffer).metadata();
        if (meta.format !== 'png' && meta.format !== 'jpeg') { altere++; continue; }
        if (deja0?.etat === 'retire') { retires++; continue; }
        prets.push({ u, _id, buffer, meta, petit: !P.estPleineTaille(meta.width) });
    }
    const reel = prets.filter(p => !p.petit).length;
    if (attendu != null && attendu !== reel) {
        console.error(`❌ --attendu=${attendu} mais ${reel} image(s) à écrire (hors cache ${horsCache}, altérées ${altere}, retirées ${retires}, sous ${P.LARGEUR_PLEINE_TAILLE} px ${prets.filter(p => p.petit).length}) — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-attendu', resultats: [], attendu, reel, horsCache, altere };
    }
    // ---- 1. un set après l'autre -----------------------------------------------------------------------------------------------------------------
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
                const tr = P.tracer({ url: u.url });
                const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat').lean();
                if (p.petit) {
                    tropPetits++;
                    if (deja?.etat !== 'trop-petit') await M.Image.updateOne({ _id }, { $set: { ...tr, set: slug, carteId: u.carteId, numero: u.numero, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: P.LARGEUR_PLEINE_TAILLE } }, { upsert: true });
                    continue;
                }
                if (deja?.etat === 'ok' && deja.sha256 && deja.urlOriginal === u.url) { sautes++; ecrits.push(_id); continue; }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = P.cleR2(slug, u.carteId, u.numero);
                await deposer(bucket, cleR2, webp.data, 'image/webp');
                const lg = P.langueDe({ anglais: u.anglais, img: u.url });
                await M.Image.updateOne({ _id }, { $set: {
                    ...tr, set: slug, carteId: u.carteId, numero: u.numero, nomEn: u.nomEn, idProduct: u.produits[0], produits: u.produits, preuve: u.preuve, voie: u.voie, ligneReleve: u.ligne, numeroReleve: u.numeroReleve, cardIdSource: u.cardId, formeSource: u.forme,
                    ...(u.aRegarder ? { aRegarder: true } : {}), ...(u.empruntee ? { empruntee: true } : {}),
                    wOriginal: meta.width, hOriginal: meta.height, sha1Original: P.sha('sha1', buffer), octetsOriginal: buffer.length,
                    cleR2, sha256: P.sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                    ...marqueDe({ wOriginal: meta.width }),
                    langueSource: 'en', langue: lg.langue, languePreuve: lg.preuve, attribution: P.MENTION, mention: P.MENTION, telechargeLe: new Date(), etat: 'ok' }, $unset: { erreur: 1 } }, { upsert: true });
                telecharges++; ecrits.push(_id);
            }
            // ---- JOINTURE ADDITIVE, sous sa garde -------------------------------------------------------------------------------------------------
            const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
            const avant = await compterEntrees(db, carteIds);
            const images = (await M.Image.find({ source: P.SOURCE, set: slug, etat: 'ok', lot: P.LOT }).lean()).filter(im => ecrits.includes(im._id));
            let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null, remplacees = 0;
            const retirees = [];
            try {
                for (const im of images) {
                    const c = await M.Carte.findById(im.carteId).select('images').lean();
                    if (!c) { cartesAbsentes++; continue; }
                    const u = uniteDe.get(im._id);
                    const refCles = new Set(u?._remplace ? (u.refusees || []).map(e => e.cleR2) : []);
                    const nous = e => e?.source === P.SOURCE && e.set === slug && (e.numero ?? null) === (im.numero ?? null);
                    const autres = (c.images || []).filter(e => e && !nous(e));
                    const admises = autres.filter(e => !refCles.has(e.cleR2));
                    const tr = P.tracer({ url: im.urlOriginal, collecteLe: im.collecteLe });
                    const entree = { set: slug, source: P.SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, numero: im.numero ?? null, ...marqueDe(im), attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, retirable: tr.retirable, collecteLe: tr.collecteLe, langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date() };
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero ?? null } } });
                    if (T.dejaServi({ images: admises }, slug, im.numero ?? null)) { dejaParAutre++; continue; }
                    for (const e of autres.filter(x => refCles.has(x.cleR2))) {
                        await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, cleR2: e.cleR2 } } });
                        await M.Image.updateOne({ source: e.source, set: slug, carteId: im.carteId, cleR2: e.cleR2 }, { $set: { etat: 'remplace', remplaceMotif: `entrée refusée par la règle du site au numéro ${im.numero ?? '∅'}, remplacée sur décision du testeur (--remplacer, lot ${P.LOT})`, remplaceePar: im._id, remplaceeLe: new Date() } });
                        retirees.push(cleEntree(im.carteId, e)); remplacees++;
                    }
                    await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                    joints++;
                }
            } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
            const apres = await compterEntrees(db, carteIds);
            const attenduesAutres = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');
            const garde = attenduesAutres === apres.autres && apres.siennes === joints;
            if (!garde) console.error(`🔴 ${slug} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres}${attenduesAutres === apres.autres ? '' : ' (CHANGÉES)'} (attendu ${avant.nAutres - retirees.length}), entrées du lot ${apres.siennes} pour ${joints} jointes`);
            const W = await vignetter(db, slug, { bucket, arreter: () => false });
            console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)`}`);
            const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
            const complet = { vignettes: W.vg, lot: P.LOT, unites: unites.length, telecharges, sautes, tropPetits, joints, dejaParAutre, cartesAbsentes, garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attenduesAutres === apres.autres, remplacees, siennesApres: apres.siennes, ok: garde }, erreurJointure,
                concordance: garde && !erreurJointure && vignettesOk && cartesAbsentes === 0 && telecharges + sautes + tropPetits === unites.length, verifieLe: new Date() };
            // le bilan vit dans la collection d'état INTERNE, jamais sur `sets` (aucun champ lu par le site ou l'API ne porte le nom de la source)
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), bilan: complet } }, { upsert: true });
            console.log(`   ${slug} : unités ${unites.length} · déposées ${telecharges} · reprises ${sautes} · sous ${P.LARGEUR_PLEINE_TAILLE} px ${tropPetits} · joints ${joints} · cédées ${dejaParAutre} · garde ${garde ? '✅' : '❌'} · requêtes 0`);
            resultats.push({ code: slug, etat: erreurJointure ? 'incomplet' : !garde ? 'non-concordant' : complet.concordance ? 'verifie' : 'incomplet', ...complet });
        } finally { if (verrouSet) await verrouSet.rendre(); }
    }
    const code = resultats.every(r => r.etat === 'verifie') && !horsCache && !altere ? 0 : 1;
    return { code, resultats, attendu: attendu ?? reel, reel, horsCache, altere };
}

module.exports = { creerFlux, releverPages, telecharger, urlsAutorisees, lireCouverts, lireCouvertsPokedata, sourcesPlusGrandes, planifierDepuisBase, faireLaPlanche, ecrire, annonceRemplacement, transportFetch, fichierArret, fichierIndex, lireIndex, dossierPagesDe, dossierImagesDe, DOSSIERS_COUVERTS, STOP_OCTETS };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE : un argument inconnu refuse avant toute connexion.
const AUTORISES = [/^--releve$/, /^--plan$/, /^--telecharger$/, /^--planche$/, /^--ecrire$/, /^--attendu=\d{1,5}$/, /^--plafond=\d{1,4}$/, /^--echantillon=\d{1,4}$/, /^--cache=.+$/, /^--sortie=.+$/, /^--couverts=.+$/, /^--sets=.+$/, /^--remplacer=\d+(,\d+)*$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const MODES = ['--releve', '--plan', '--telecharger', '--planche', '--ecrire'];
const modes = MODES.filter(m => args.includes(m));
const a = nom => args.some(x => x.startsWith(`--${nom}=`));
const erreurArgs = inconnus.length ? `argument inconnu : ${inconnus.join(' ')}` : modes.length > 1 ? 'un seul mode à la fois' : (a('attendu') && !args.includes('--ecrire')) ? '--attendu ne va qu\'avec --ecrire' : (args.includes('--ecrire') && !a('attendu')) ? '--ecrire exige --attendu=<N>'
    : (args.includes('--releve') && !a('plafond')) ? '--releve exige --plafond=<N> (le plafond de requêtes est exigé)' : (a('plafond') && !args.includes('--releve')) ? '--plafond ne va qu\'avec --releve' : null;
if (erreurArgs) {
    console.error(`❌ ${erreurArgs}. Modes : --releve --plafond=N · --plan (défaut) · --telecharger · --planche [--echantillon=50] · --ecrire --attendu=N. Options : --cache= --sortie= --couverts=<dossier,…> --sets=<slug,…> --remplacer=<idProduct,…>.`);
    process.exitCode = 2;          // (jamais de sortie forcée : les poignées de fetch/libuv se ferment d'elles-mêmes)
}
const val = (nom, defaut) => args.find(x => x.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut;
const dossierCache = val('cache', P.DOSSIER_CACHE), dossierLot = P.DOSSIER_LOT, fichierPlan = val('sortie', path.join(dossierLot, 'plan.json'));
const dossiersCouverts = val('couverts', null)?.split(',') ?? DOSSIERS_COUVERTS;
const slugsSeuls = val('sets', null)?.split(',') ?? null;

async function planComplet(db) {
    const cv = sourcesPlusGrandes(dossiersCouverts);
    const { reglesDuSite } = require('./collecte-cartes/simuler-servis');
    const R = await reglesDuSite();
    const p = await planifierDepuisBase(db, { dossierPages: dossierPagesDe(dossierCache), couverts: cv.produits, refusSite: R.refusDuVisuel, slugsSeulement: slugsSeuls, pokedataSets: cv.pokedataSets });
    return { ...p, couvertsFichiers: cv.fichiers, couvertsProduits: cv.produits.size };
}
if (!erreurArgs) (async () => {
    const mode = modes[0] || '--plan';
    if (mode === '--telecharger') {
        if (fs.existsSync(fichierArret(dossierCache))) { console.error(`❌ ${fichierArret(dossierCache)} existe : un arrêt définitif a eu lieu, seul le testeur décide de le lever.`); process.exitCode = 1; return; }
        const j = JSON.parse(fs.readFileSync(fichierPlan, 'utf8'));
        const rel = P.construireReleve(dossierPagesDe(dossierCache));
        const au = urlsAutorisees([...j.plan, ...(j.remplacements || [])], rel.cartes);
        console.log(`${au.ok.length} adresse(s) autorisée(s) (plan ∩ relevé), ${au.refusees.length} refusée(s) : ${JSON.stringify(au.refusees)}`);
        const r = await telecharger({ urls: au.ok, dossierCache });
        console.log(`TÉLÉCHARGEMENT : ${r.etat} · ${r.requetes} requête(s) (plafond ${r.plafond}) ${r.motif ? `· ${r.motif}` : ''}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'rien-a-faire' ? 0 : 1;
        return;
    }
    if (mode === '--planche') {
        const j = JSON.parse(fs.readFileSync(fichierPlan, 'utf8'));
        const r = await faireLaPlanche({ plan: [...j.plan, ...(j.remplacements || [])], dossierCache, sortie: path.join(dossierLot, 'planche'), echantillon: Number(val('echantillon', 50)) });
        console.log(`PLANCHE : ${r.n} image(s) en ${r.fichiers.length} planche(s) → ${path.join(dossierLot, 'planche')} · à REGARDER avant d'écrire (recto, face, sans filigrane ni étiquette ni gradation)`);
        return;
    }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: mode === '--ecrire' ? ['R2_BUCKET_IMAGES'] : [] });
    try {
        if (mode === '--releve') {
            // ÉTAPE 1 : la liste ; ÉTAPE 2 : les pages de set utiles (la table des sets, lue sur la liste) ; ÉTAPE 3 : les pages de carte (ou panneaux de détail) des cartes appariées
            const dp = dossierPagesDe(dossierCache);
            const lireP = f => { try { return fs.readFileSync(path.join(dp, f), 'utf8'); } catch { return ''; } };
            const SETS = `https://${P.HOTE_PAGES}/sets`, abs = h => `https://${P.HOTE_PAGES}${h}`;
            const sets = (await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1 } }).toArray()).filter(s => (s.tirage ?? s.region) === 'intl').map(s => s._id).filter(s => !slugsSeuls || slugsSeuls.includes(s));
            const cv = sourcesPlusGrandes(dossiersCouverts);
            const etapes = [
                async () => ({ cibles: [{ url: SETS, fichier: 'liste-sets.html' }], autorisees: new Set([SETS]) }),
                async () => {
                    const table = P.tableDesSets(P.lireListeSets(lireP('liste-sets.html')), sets);
                    const utiles = (await planifierDepuisBase(cx.db, { dossierPages: dp, couverts: cv.produits, refusSite: null, slugsSeulement: slugsSeuls, pokedataSets: cv.pokedataSets })).restes;   // (sert à nommer les sets qui ont de vrais trous)
                    const slugsTrous = new Set(utiles.filter(x => !['deja-servi', 'couvert-par-une-source-plus-grande', 'reserve-a-une-source-plus-grande-en-attente'].includes(x.motif)).map(x => x.slugSet));
                    const cibles = [...table].filter(([slug]) => slugsTrous.has(slug)).map(([, v]) => ({ url: abs(v.href), fichier: P.fichierSet(v.href) }));
                    return { cibles, autorisees: P.adressesDeLaPage(lireP('liste-sets.html')) };
                },
                async () => {
                    const p = await planifierDepuisBase(cx.db, { dossierPages: dp, couverts: cv.produits, refusSite: null, slugsSeulement: slugsSeuls });
                    const tout = new Set(fs.readdirSync(dp).filter(f => /^(liste-sets|set--.*)\.html$/.test(f)).flatMap(f => [...P.adressesDeLaPage(lireP(f))]));
                    const cibles = p.aReleve.map(x => ({ url: abs(x.url), fichier: /card-overlay/.test(x.url) ? P.fichierOverlay(x.cardId) : P.fichierCarte(x.cardId) }));
                    console.log(`relevé : ${cibles.length} page(s) de carte / panneau(x) de détail à demander (hors cache)`);
                    return { cibles, autorisees: tout };
                }
            ];
            const r = await releverPages({ etapes, dossierCache, plafond: Number(val('plafond')) });
            console.log(`RELEVÉ : ${r.etat} · ${r.requetes} requête(s) (plafond ${r.plafond}) ${r.motif ? `· ${r.motif}` : ''} · refusées ${JSON.stringify(r.refusees.slice(0, 20))}`);
            process.exitCode = r.etat === 'termine' ? 0 : 1;
            return;
        }
        const p = await planComplet(cx.db);
        const parSet = {}; for (const u of p.plan) parSet[u.slugSet] = (parSet[u.slugSet] || 0) + u.produits.length;
        const motifs = {}; for (const x of p.restes) motifs[x.motif] = (motifs[x.motif] || 0) + 1;
        console.log(`couverts : ${p.couvertsProduits} produit(s) dans ${p.couvertsFichiers} plan(s) · sets de la table avec lignes : ${p.sets.length} · produits examinés : ${p.examines} · cartes relevées : ${p.cartesReleve} (${p.ignorees} ignorée(s))`);
        console.log(`PLAN : ${p.plan.length} image(s) pour ${p.plan.reduce((n, u) => n + u.produits.length, 0)} produit(s) · par set ${JSON.stringify(parSet)} · restes ${JSON.stringify(motifs)} · remplacements préparés (INACTIFS sans --remplacer) ${p.remplacements.length}`);
        const voulus = (val('remplacer', '') || '').split(',').filter(Boolean).map(Number);
        if (mode === '--plan') {
            const urls = [...new Set([...p.plan, ...p.remplacements].map(u => u.url))];
            fs.mkdirSync(path.dirname(fichierPlan), { recursive: true });
            fs.writeFileSync(fichierPlan, JSON.stringify({ le: new Date().toISOString(), couverts: { produits: p.couvertsProduits, fichiers: p.couvertsFichiers }, examines: p.examines, plan: p.plan, remplacements: p.remplacements, restes: p.restes, aReleve: p.aReleve, urls }, null, 1));
            console.log(`plan écrit : ${fichierPlan} · à relever : ${p.aReleve.length} page(s) de carte · à télécharger : ${urls.length} image(s) + robots.txt, ≥ ${P.CADENCE_MS / 1000} s entre deux (≈ ${Math.ceil((urls.length + 1) * P.CADENCE_MS / 60000)} min)`);
            return;
        }
        const r2 = require('./collecte-cartes/r2');
        const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
        const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
        if (!process.env.R2_BUCKET_IMAGES) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune écriture');
        await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
        const r = await ecrire(p.plan, modeles(cx), { dossierCache, attendu: Number(val('attendu')), remplacements: p.remplacements, remplacer: voulus, deposer: (b, c, d, t) => r2.deposerBinaire(b, c, d, t), vignetter: vignetterApresJointure,
            fabriquerVerrouSet: ({ Modele, id }) => fabriquerVerrou({ Modele, id, dureeMs: 10 * 60 * 1000, surInsertion: { debute: new Date(), phase: 'plan' }, nom: `verrou de set ${id}` }) });
        console.log(`ÉCRITURE : code ${r.code} · attendu ${r.attendu} · réel ${r.reel} · hors cache ${r.horsCache} · altérées ${r.altere} · REQUÊTES 0`);
        process.exitCode = r.code;
    } finally { await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
