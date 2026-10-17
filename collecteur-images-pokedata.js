// ============================================================
// COLLECTEUR D'IMAGES — pleine taille 728×1000, pour ce qui NOUS MANQUE (lot POKEDATA, 2026-10-17) -> cache local -> R2 (WebP) + base `cartes`
// ============================================================
//   node collecteur-images-pokedata.js --plan [--releves=<dossier>] [--sortie=<plan.json>]   (défaut) SIMULATION : zéro requête réseau, lecture seule de la base, écrit plan.json
//   node collecteur-images-pokedata.js --releve                 LES SEULES REQUÊTES DE PAGES : les pages de set de plan.json (`setsAReleve`), robots.txt d'abord, ≥ 5 s, arrêt définitif
//   node collecteur-images-pokedata.js --telecharger            LES SEULES REQUÊTES D'IMAGES : les adresses du plan présentes dans un relevé, robots.txt d'abord, ≥ 5 s, arrêt définitif
//   node collecteur-images-pokedata.js --planche [--echantillon=50]    une planche-contact de l'échantillon du cache, à REGARDER avant l'écriture (zéro requête)
//   node lot-additif.js --quoi="N visuels (lot pokedata-2026-10)" --collections=cartes,images,sets --compte=images:source=pokedata -- node collecteur-images-pokedata.js --ecrire --attendu=<N>
//
// ⛔ Un SEUL flux réseau (jamais deux processus à la fois), deux hôtes nommés : www.pokedata.io (la liste des sets et les pages de set de la table, jamais une API) et
// pokemoncardimages.pokedata.io (/images/<set>/<n°>.webp, JAMAIS _240w). --plan, --planche et --ecrire ne font AUCUNE requête (l'écriture lit le cache seulement).
// ARRÊT DÉFINITIF au premier 401/403/410/429/défi/3xx/octets inattendus : un fichier d'arrêt COMMUN (pages et images : c'est la source qui s'arrête) est écrit dans le dossier du cache
// et tout lancement suivant REFUSE de partir tant qu'il existe — seul le testeur le lève. Une coupure ou un 5xx INTERROMPT sans l'écrire. Le retrait : retirer-visuels-pokedata.js.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pokedata');
const T = require('./collecte-cartes/tpc');
const { cleNumero } = require('./collecte-cartes/jointure');
const { largeurMinDe, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { marqueDe } = require('./collecte-cartes/basse-definition');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const STOP_OCTETS = 400 * 1024 * 1024;
const CRAWL_DELAY_MAX_S = 60;
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const MARQUEUR_DE_DEFI = /just a moment|captcha|challenge|attention required|cf-chl|_incapsula|incapsula incident|sign in to continue|log in to continue/i;
const WEBP_OK = b => Buffer.isBuffer(b) && b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
const RATIO_MIN = 1.30, RATIO_MAX = 1.45;           // 1000/728 = 1,374 ; une carte n'est jamais carrée

const GENRES = Object.freeze({
    image: { hote: P.HOTE_IMAGES, valide: P.urlImageValide, index: 'index.json', sous: 'img' },
    page: { hote: P.HOTE_PAGES, valide: P.urlPageValide, index: 'index-pages.json', sous: 'pages' }
});
const robotsDe = genre => `https://${GENRES[genre].hote}/robots.txt`;

// ── adresses autorisées ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Les adresses du plan présentes MOT POUR MOT dans un relevé ET valables. */
function urlsAutorisees(plan, cartes) {
    const relevees = new Set(cartes.map(c => c.img));
    const ok = [], refusees = [];
    for (const u of new Set(plan.map(p => p.url))) {
        if (!P.urlImageValide(u)) refusees.push({ url: u, motif: 'adresse-hors-regle' });
        else if (!relevees.has(u)) refusees.push({ url: u, motif: 'hors-releve' });
        else ok.push(u);
    }
    return { ok, refusees };
}

// ── le cache local ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const fichierArret = dossier => path.join(dossier, 'ARRET-DEFINITIF.json');
const fichierIndex = (dossier, genre = 'image') => path.join(dossier, GENRES[genre].index);
function lireIndex(dossier, genre = 'image') { try { const j = JSON.parse(fs.readFileSync(fichierIndex(dossier, genre), 'utf8')); return j?.images ? j : { version: 1, images: {} }; } catch { return { version: 1, images: {} }; } }
function ecrireIndex(dossier, index, genre = 'image') { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(fichierIndex(dossier, genre), JSON.stringify(index, null, 1)); }
const nomFichier = (url, genre) => (genre === 'image' ? new URL(url).pathname.slice(P.PREFIXE_CHEMIN.length) : new URL(url).pathname.replace(/^\//, '')).replace(/[^A-Za-z0-9._+-]/g, '_');

// ── le transport RÉEL : l'agent du dépôt seul, aucun cookie, aucune redirection suivie, les deux hôtes nommés seuls ───────────────
const transportFetch = {
    async get(url, { genre = 'image', binaire = false } = {}) {
        if (!GENRES[genre]) throw new Error(`pokedata : genre inconnu « ${genre} » — aucune requête`);
        if (url !== robotsDe(genre) && !GENRES[genre].valide(url)) throw new Error(`pokedata : adresse hors de ce que le collecteur autorise (${GENRES[genre].hote}, robots.txt, ${genre === 'image' ? 'les images pleine taille de la table' : 'la liste des sets et les pages de set de la table'}) — aucune requête`);
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

/**
 * LA PHASE RÉSEAU (images ou pages). @param {{urls: string[], dossierCache: string, genre?: 'image'|'page', transport?: object, pause?: Function, now?: Function, cadenceMs?: number, plafond?: number}} o
 * @returns {{etat: 'termine'|'rien-a-faire'|'refuse-arret'|'robots-interdit'|'arret-definitif'|'interrompu', requetes: number, plafond: number, refusees: object[], motif?: string}}
 */
async function telecharger({ urls, dossierCache, genre = 'image', transport = transportFetch, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, cadenceMs = P.CADENCE_MS, plafond: plafondMax = null }) {
    const G = GENRES[genre];
    if (!G) throw new Error(`telecharger : genre inconnu « ${genre} »`);
    if (fs.existsSync(fichierArret(dossierCache))) return { etat: 'refuse-arret', requetes: 0, plafond: 0, refusees: [], motif: `${fichierArret(dossierCache)} existe : un arrêt définitif a eu lieu, seul le testeur décide de le lever` };
    const refusees = [...new Set(urls)].filter(u => !G.valide(u) || (genre === 'page' && /robots\.txt$/.test(u))).map(u => ({ url: u, motif: 'adresse-hors-regle' }));
    const index = lireIndex(dossierCache, genre);
    const afaire = [...new Set(urls)].filter(u => G.valide(u) && !(genre === 'page' && /robots\.txt$/.test(u)) && !['ok', 'absent', 'dos-de-carte', 'forme-inattendue'].includes(index.images[u]?.statut));
    if (!afaire.length) return { etat: 'rien-a-faire', requetes: 0, plafond: 0, refusees };
    const plafond = Math.min(afaire.length + 1, plafondMax ?? Infinity);
    let requetes = 0, dernier = null, cadence = Math.max(cadenceMs, P.CADENCE_MIN_MS);
    const arret = (url, r, motif) => { fs.mkdirSync(dossierCache, { recursive: true }); fs.writeFileSync(fichierArret(dossierCache), JSON.stringify({ le: new Date().toISOString(), url, status: r?.status ?? null, motif, genre, requetes }, null, 1)); return { etat: 'arret-definitif', requetes, plafond, refusees, motif }; };
    // un défi s'écrit par ce qui le PROUVE (liste fermée) : 401, 403, 410, 429, 3xx, cf-mitigated, Imperva/Incapsula, un marqueur de défi dans le corps (404 compris)
    const defi = r => [401, 403, 410, 429].includes(r.status) || (r.status >= 300 && r.status < 400) || !!r.cfMitigated || !!r.imperva || (typeof r.texte === 'string' && MARQUEUR_DE_DEFI.test(r.texte.slice(0, 3000)));
    const demander = async (url, o) => {
        if (requetes >= plafond) throw Object.assign(new Error('plafond de requêtes atteint'), { plafond: true });
        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
        dernier = now(); requetes++;
        return transport.get(url, { genre, ...o });
    };
    let robots;
    try { robots = await demander(robotsDe(genre), {}); } catch (e) { return { etat: 'interrompu', requetes, plafond, refusees, motif: e.message }; }
    if (defi(robots)) return arret(robotsDe(genre), robots, `robots.txt : HTTP ${robots.status} — défi ou refus`);
    let texteRobots = null;
    if (robots.status === 200) texteRobots = robots.texte ?? '';
    else if (robots.status !== 404) return { etat: 'interrompu', requetes, plafond, refusees, motif: `robots.txt illisible (HTTP ${robots.status}) : on ne peut pas conclure` };
    const delai = T.delaiDesRobots(texteRobots, P.UA);
    if (delai && delai > CRAWL_DELAY_MAX_S) return { etat: 'robots-interdit', requetes, plafond, refusees, motif: `Crawl-delay de ${delai} s` };
    if (delai) cadence = Math.max(cadence, delai * 1000);
    const permises = afaire.filter(u => T.autoriseParRobots(texteRobots, new URL(u).pathname, P.UA));
    if (!permises.length) return { etat: 'robots-interdit', requetes, plafond, refusees, motif: 'robots.txt interdit ces chemins' };
    fs.mkdirSync(path.join(dossierCache, G.sous), { recursive: true });
    for (const url of permises) {
        let r;
        try { r = await demander(url, { binaire: genre === 'image' }); } catch (e) { return { etat: 'interrompu', requetes, plafond, refusees, motif: e.message }; }
        if (defi(r)) return arret(url, r, `HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}${r.imperva ? ', Imperva' : ''}`);
        if (r.status === 404) { index.images[url] = { statut: 'absent', status: 404, le: new Date().toISOString() }; ecrireIndex(dossierCache, index, genre); continue; }
        if (r.status >= 500) return { etat: 'interrompu', requetes, plafond, refusees, motif: `HTTP ${r.status} sur ${url}` };
        if (r.status !== 200) return { etat: 'interrompu', requetes, plafond, refusees, motif: `HTTP ${r.status} sur ${url} : réponse inattendue, on s'arrête` };
        const fichier = path.join(G.sous, nomFichier(url, genre));
        if (genre === 'page') {
            if (!/html/i.test(r.type || '') || typeof r.texte !== 'string' || !/<html/i.test(r.texte)) return arret(url, r, 'la réponse n\'est pas une page HTML (rien d\'autre qu\'une page n\'est attendu)');
            fs.writeFileSync(path.join(dossierCache, fichier), r.texte);
            index.images[url] = { statut: 'ok', fichier, sha256: sha('sha256', Buffer.from(r.texte)), octets: Buffer.byteLength(r.texte), le: new Date().toISOString() };
            ecrireIndex(dossierCache, index, genre); continue;
        }
        if (P.estDosDeCarte(r.octets)) { index.images[url] = { statut: 'dos-de-carte', le: new Date().toISOString() }; ecrireIndex(dossierCache, index, genre); continue; }
        if (!WEBP_OK(r.octets)) return arret(url, r, 'les octets reçus ne sont pas un WebP (page de défi probable)');
        const meta = await sharp(r.octets).metadata();
        const ratio = meta.width ? meta.height / meta.width : 0;
        if (ratio < RATIO_MIN || ratio > RATIO_MAX) { index.images[url] = { statut: 'forme-inattendue', w: meta.width, h: meta.height, le: new Date().toISOString() }; ecrireIndex(dossierCache, index, genre); continue; }
        fs.writeFileSync(path.join(dossierCache, fichier), r.octets);
        index.images[url] = { statut: 'ok', fichier, sha256: sha('sha256', r.octets), octets: r.octets.length, w: meta.width, h: meta.height, le: new Date().toISOString() };
        ecrireIndex(dossierCache, index, genre);
    }
    return { etat: 'termine', requetes, plafond, refusees };
}

/** Lit les pages de set EN CACHE et écrit un relevé (schéma 1) pour celles qui portent des cartes ; les autres sont nommées (jamais un relevé vide présenté comme complet). */
function releverDepuisPages({ dossierCache, urls }) {
    const index = lireIndex(dossierCache, 'page');
    const ecrits = [], sansCartes = [];
    for (const url of urls) {
        const e = index.images[url];
        if (e?.statut !== 'ok') { sansCartes.push({ url, motif: e?.statut ?? 'non-telechargee' }); continue; }
        const nom = P.nomDeSegment(new URL(url).pathname.replace(/^\/set\//, ''));
        const lu = P.lireCartesDeLaPage(fs.readFileSync(path.join(dossierCache, e.fichier), 'utf8'));
        if (!nom || !lu.cartes.length) { sansCartes.push({ url, motif: lu.motif ?? 'set-hors-table' }); continue; }
        const dossier = path.join(dossierCache, 'releves'); fs.mkdirSync(dossier, { recursive: true });
        const fichier = `releve--${nom.replace(/[^A-Za-z0-9]+/g, '-')}.json`;
        fs.writeFileSync(path.join(dossier, fichier), JSON.stringify({ schema: 1, set: nom, complet: false, le: new Date().toISOString(), cartes: lu.cartes.map(c => ({ numero: c.numero, nom: c.nom, img: c.img })) }, null, 1));
        ecrits.push(fichier);
    }
    return { ecrits, sansCartes };
}

// ── le plan (lecture seule de la base) ────────────────────────────────────────────────────────────────────────────────────
/** Les trous et candidats au remplacement des sets de la table, appariés aux cartes relevées. `db` : la base `cartes`, LECTURE SEULE. */
async function planifierDepuisBase(db, { cartes, refusSite = null }) {
    const slugs = [...new Set(Object.values(P.SETS_UTILES).flat())];
    const lignes = await db.collection('cartes_produits').find({ slugSet: { $in: slugs } }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1, slugSet: 1, slug: 1 } }).toArray();
    if (!lignes.length) throw new Error(`cartes_produits : 0 ligne pour ${slugs.length} sets de la table — une clé fausse (§41)`);
    const parId = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    const noms = new Map();
    for (const slug of slugs) {
        const m = new Map();
        for (const l of lignes.filter(x => x.slugSet === slug)) { const c = parId.get(l.carteId); if (!c) continue; const k = P.nomNorm(c.nomEn); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(c._id); }
        noms.set(slug, m);
    }
    const trous = lignes.filter(l => parId.has(l.carteId)).map(l => ({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche ?? null, slugProduit: l.slug ?? null, carte: parId.get(l.carteId) }));
    const sets = new Map((await db.collection('sets').find({ _id: { $in: slugs } }, { projection: { tirage: 1, region: 1 } }).toArray()).map(s => [s._id, s.tirage ?? s.region]));
    const refus = refusSite ? (e, slug) => (e.cleR2 ? refusSite(e, sets.get(slug) ?? 'intl') : null) : undefined;
    const r = P.apparier({ trous, cartes, noms, ...(refus ? { refus } : {}) });
    // les pages à relever : les sets de la table où un produit n'a aucun visuel OU porte une entrée à remplacer (basse définition, empruntée)
    const besoin = new Set(trous.filter(t => { const es = (t.carte.images || []).filter(e => e.set === t.slugSet); return !es.length || es.some(e => e.basseDefinition === true || e.imageEmprunteeTirage === true); }).map(t => t.slugSet));
    const setsAReleve = Object.keys(P.SETS_UTILES).filter(n => P.SETS_UTILES[n].some(s => besoin.has(s)));
    return { produits: trous.length, ...r, setsAReleve };
}

// ── L'ÉCRITURE, depuis le cache seulement ─────────────────────────────────────────────────────────────────────────────────
const cleEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;
async function compterEntrees(db, carteIds, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!P.duLot(e)) autres.push(cleEntree(c._id, e)); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}
/** L'ANNONCE de baisses pour `lot-additif.js --annonce=` quand des remplacements sont demandés (compterEtat / comparer, les fonctions de la garde). */
function annonceRemplacement(cartes, remplacements) {
    if (!remplacements?.length) return {};
    const cles = new Set(remplacements.flatMap(u => u.refusees.map(e => `${u.slugSet}|${e.cleR2}`)));
    const apres = cartes.map(c => ({ ...c, images: [...(c.images || []).filter(e => !cles.has(`${e.set}|${e.cleR2}`)), ...remplacements.filter(u => u.carteId === c._id).map(u => ({ set: u.slugSet, source: P.SOURCE, lot: P.LOT, numero: u.numero, cleR2: P.cleR2(u.slugSet, u.numero ?? u.numeroReleve, u.carteId) }))] }));
    const { baisses } = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }));
    return Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
}

/**
 * @param {object[]} plan  les AJOUTS (P.apparier().plan) — le numéro d'écriture est celui de la fiche, à défaut celui du relevé (sans zéros de tête perdus : on garde le texte du relevé)
 * @returns {Promise<{code: number, etat?: string, resultats: object[], attendu: number, reel: number, horsCache: number, altere: number}>}
 */
async function ecrire(plan, M, { dossierCache, attendu = null, deposer, vignetter, fabriquerVerrouSet = null, stopOctets = STOP_OCTETS, remplacements = [], remplacer = [] } = {}) {
    if (typeof deposer !== 'function' || typeof vignetter !== 'function') throw new Error('ecrire : deposer et vignetter sont exigés');
    const db = M.Carte.db.db;
    const index = lireIndex(dossierCache, 'image');
    const seuil = largeurMinDe(P.SOURCE);
    const idsRemplacables = new Set((remplacements || []).flatMap(u => u.produits));
    const inconnus = (remplacer || []).filter(id => !idsRemplacables.has(id));
    if (inconnus.length) {
        console.error(`❌ --remplacer : ${inconnus.join(', ')} ne figure(nt) pas dans les remplacements du plan — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-remplacer', resultats: [], attendu: attendu ?? 0, reel: 0, horsCache: 0, altere: 0, inconnus };
    }
    const choisies = (remplacements || []).filter(u => u.produits.some(id => (remplacer || []).includes(id))).map(u => ({ ...u, _remplace: true }));
    // numéro d'ÉCRITURE d'une unité : celui de la fiche ; sinon le numéro du relevé SANS sa lettre de la source (la correspondance est dans le plan)
    const numeroDe = u => u.numero ?? (u.correspondance ? u.correspondance.fiche : u.numeroReleve);
    const prets = [];
    let horsCache = 0, altere = 0, retires = 0;
    for (const u of [...plan, ...choisies]) {
        const e = index.images[u.url];
        if (!P.urlImageValide(u.url) || e?.statut !== 'ok') { horsCache++; continue; }
        let buffer; try { buffer = fs.readFileSync(path.join(dossierCache, e.fichier)); } catch { horsCache++; continue; }
        if (sha('sha256', buffer) !== e.sha256) { altere++; console.error(`❌ cache altéré (sha256) : ${u.url}`); continue; }
        const meta = await sharp(buffer).metadata();
        if (meta.format !== 'webp') { altere++; continue; }
        const _id = P.idImage(u.slugSet, u.carteId, numeroDe(u));
        const deja = await M.Image.findById(_id).select('etat').lean();
        if (deja?.etat === 'retire') { retires++; continue; }
        prets.push({ u, _id, buffer, meta, num: numeroDe(u), petit: !meta.width || meta.width < seuil });
    }
    const reel = prets.filter(p => !p.petit).length;
    if (attendu != null && attendu !== reel) {
        console.error(`❌ --attendu=${attendu} mais ${reel} image(s) à écrire (hors cache ${horsCache}, altérées ${altere}, retirées ${retires}, sous le seuil ${prets.filter(p => p.petit).length}) — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-attendu', resultats: [], attendu, reel, horsCache, altere };
    }
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
        const idEtat = `pdt/${slug}`;
        const verrouSet = fabriquerVerrouSet ? fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat }) : null;
        if (verrouSet) { const tenu = await verrouSet.prendre(); if (tenu) { resultats.push({ code: slug, etat: 'refuse-verrou' }); continue; } }
        try {
            let telecharges = 0, sautes = 0, tropPetits = 0;
            const ecrits = [], uniteDe = new Map();
            for (const p of unites) {
                uniteDe.set(p._id, p.u);
                const { u, _id, meta, buffer, num } = p;
                const trace = P.tracer({ url: u.url });
                const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat').lean();
                if (p.petit) {
                    tropPetits++;
                    if (deja?.etat !== 'trop-petit') await M.Image.updateOne({ _id }, { $set: { ...trace, set: slug, carteId: u.carteId, numero: num, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: seuil } }, { upsert: true });
                    continue;
                }
                if (deja?.etat === 'ok' && deja.sha256 && deja.urlOriginal === u.url) { sautes++; ecrits.push(_id); continue; }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = P.cleR2(slug, num, u.carteId);
                await deposer(bucket, cleR2, webp.data, 'image/webp');
                const lg = P.langueDe(u.url, 'en');
                await M.Image.updateOne({ _id }, { $set: {
                    ...trace, set: slug, carteId: u.carteId, numero: num, nomEn: u.nomEn, idProduct: u.produits[0], produits: u.produits, preuve: u.preuve, voie: u.voie,
                    caseReleve: u.ligne, numeroReleve: u.numeroReleve, releve: u.releve, ...(u.correspondance ? { correspondance: u.correspondance } : {}),
                    wOriginal: meta.width, hOriginal: meta.height, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length,
                    cleR2, sha256: sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                    ...marqueDe({ wOriginal: meta.width }),
                    langueSource: 'en', langue: lg.langue, languePreuve: lg.preuve, attribution: P.MENTION, mention: P.MENTION, telechargeLe: new Date(), etat: 'ok' }, $unset: { erreur: 1 } }, { upsert: true });
                telecharges++; ecrits.push(_id);
            }
            const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
            const avant = await compterEntrees(db, carteIds, slug);
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
                    const entree = { set: slug, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, numero: im.numero ?? null, ...marqueDe(im), attribution: P.MENTION, mention: P.MENTION, langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date(),
                        ...P.tracer({ url: im.urlOriginal, le: im.collecteLe }) };
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero ?? null } } });
                    if (T.dejaServi({ images: admises }, slug, im.numero ?? null)) { dejaParAutre++; continue; }
                    for (const e of autres.filter(x => refCles.has(x.cleR2))) {
                        await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, cleR2: e.cleR2 } } });
                        await M.Image.updateOne({ source: e.source, set: slug, carteId: im.carteId, cleR2: e.cleR2 }, { $set: { etat: 'remplace', remplaceMotif: `${u.motifRemplacement} : remplacée sur décision du testeur (--remplacer, lot ${P.LOT})`, remplaceePar: im._id, remplaceeLe: new Date() } });
                        retirees.push(cleEntree(im.carteId, e)); remplacees++;
                    }
                    await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                    joints++;
                }
            } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
            const apres = await compterEntrees(db, carteIds, slug);
            const attenduesAutres = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');
            const garde = attenduesAutres === apres.autres && apres.siennes === joints;
            if (!garde) console.error(`🔴 ${slug} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres}${attenduesAutres === apres.autres ? '' : ' (CHANGÉES)'} (attendu ${avant.nAutres - retirees.length}), entrées du lot ${apres.siennes} pour ${joints} jointes`);
            const W = await vignetter(db, slug, { bucket, arreter: () => false });
            console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)`}`);
            const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
            const complet = { vignettes: W.vg, lot: P.LOT, unites: unites.length, telecharges, sautes, tropPetits, joints, dejaParAutre, cartesAbsentes, garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attenduesAutres === apres.autres, remplacees, siennesApres: apres.siennes, ok: garde }, erreurJointure,
                concordance: garde && !erreurJointure && vignettesOk && cartesAbsentes === 0 && telecharges + sautes + tropPetits === unites.length, verifieLe: new Date() };
            await M.Set.updateOne({ _id: slug }, { $set: { bilanLotPdt: complet } });
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), bilan: complet } }, { upsert: true });
            console.log(`   ${slug} : unités ${unites.length} · déposées ${telecharges} · reprises ${sautes} · sous le seuil ${tropPetits} · joints ${joints} · cédées ${dejaParAutre} · garde ${garde ? '✅' : '❌'} · requêtes 0`);
            resultats.push({ code: slug, etat: erreurJointure ? 'incomplet' : !garde ? 'non-concordant' : complet.concordance ? 'verifie' : 'incomplet', ...complet });
        } finally { if (verrouSet) await verrouSet.rendre(); }
    }
    const code = resultats.every(r => r.etat === 'verifie') && !horsCache && !altere ? 0 : 1;
    return { code, resultats, attendu: attendu ?? reel, reel, horsCache, altere };
}

// ── la planche-contact : à REGARDER avant l'écriture ─────────────────────────────────────────────────────────────────────
/** Une planche (PNG) de l'échantillon du cache : `n` images tirées de façon déterministe (pas régulier), 8 par rang. */
async function fabriquerPlanche({ dossierCache, sortie, n = 50 }) {
    const index = lireIndex(dossierCache, 'image');
    const toutes = Object.entries(index.images).filter(([, e]) => e.statut === 'ok').sort(([a], [b]) => (a < b ? -1 : 1));
    if (!toutes.length) throw new Error('planche : aucune image en cache');
    const pas = Math.max(1, Math.floor(toutes.length / n));
    const choix = toutes.filter((_, i) => i % pas === 0).slice(0, n);
    const L = 182, H = 250, COL = 8, rangs = Math.ceil(choix.length / COL);
    const tuiles = [];
    for (let i = 0; i < choix.length; i++) tuiles.push({ input: await sharp(path.join(dossierCache, choix[i][1].fichier)).resize(L, H, { fit: 'fill' }).png().toBuffer(), left: (i % COL) * L, top: Math.floor(i / COL) * H });
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    await sharp({ create: { width: L * COL, height: H * rangs, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(tuiles).png().toFile(sortie);
    return { images: choix.length, total: toutes.length, sortie, adresses: choix.map(([u]) => u) };
}

module.exports = { urlsAutorisees, telecharger, releverDepuisPages, planifierDepuisBase, ecrire, annonceRemplacement, fabriquerPlanche, transportFetch, fichierArret, fichierIndex, lireIndex, STOP_OCTETS, GENRES };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE : un argument inconnu refuse avant toute connexion.
const AUTORISES = [/^--plan$/, /^--releve$/, /^--telecharger$/, /^--planche$/, /^--ecrire$/, /^--attendu=\d{1,4}$/, /^--echantillon=\d{1,3}$/, /^--releves=.+$/, /^--cache=.+$/, /^--sortie=.+$/, /^--remplacer=\d+(,\d+)*$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--releve', '--telecharger', '--planche', '--ecrire'].filter(m => args.includes(m));
if (inconnus.length || modes.length > 1 || (args.some(a => a.startsWith('--attendu=')) && !args.includes('--ecrire')) || (args.includes('--ecrire') && !args.some(a => a.startsWith('--attendu='))) || (args.some(a => a.startsWith('--echantillon=')) && !args.includes('--planche'))) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}un seul mode parmi --plan (défaut), --releve, --telecharger, --planche, --ecrire ; --ecrire exige --attendu=<N> (et lui seul l'accepte) ; --echantillon=<N> va avec --planche. Options : --releves=, --cache=, --sortie=, --remplacer=<idProduct,…>.`);
    process.exitCode = 2;
}
const argsValides = process.exitCode !== 2;
const val = (nom, defaut) => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut;
const dossierCache = val('cache', P.DOSSIER_CACHE), dossierReleves = val('releves', path.join(dossierCache, 'releves')), fichierPlan = val('sortie', path.join(P.DOSSIER_LOT, 'plan.json'));

if (argsValides) (async () => {
    const mode = modes[0] || '--plan';
    const lirePlan = () => JSON.parse(fs.readFileSync(fichierPlan, 'utf8'));
    if (mode === '--releve') {
        const j = lirePlan();
        const urls = (j.setsAReleve || []).map(P.urlPageDuSet).filter(Boolean);
        console.log(`${urls.length} page(s) de set à relever (plan.json : setsAReleve) : ${(j.setsAReleve || []).join(' | ')}`);
        const r = await telecharger({ urls, dossierCache, genre: 'page' });
        console.log(`RELEVÉ DES PAGES : ${r.etat} · ${r.requetes} requête(s) (plafond ${r.plafond}) ${r.motif ? `· ${r.motif}` : ''}`);
        const v = releverDepuisPages({ dossierCache, urls });
        console.log(`relevés écrits ${v.ecrits.length} · pages sans cartes ${v.sansCartes.length} ${JSON.stringify(v.sansCartes.map(x => x.motif).reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {}))}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'rien-a-faire' ? 0 : 1;
        return;
    }
    if (mode === '--telecharger') {
        const j = lirePlan();
        const lu = P.lireReleves(dossierReleves);
        const a = urlsAutorisees([...j.plan, ...(j.remplacements || [])], lu.cartes);
        console.log(`${a.ok.length} adresse(s) autorisée(s) (plan ∩ relevés), ${a.refusees.length} refusée(s) : ${JSON.stringify(a.refusees)}`);
        const r = await telecharger({ urls: a.ok, dossierCache, genre: 'image' });
        console.log(`TÉLÉCHARGEMENT : ${r.etat} · ${r.requetes} requête(s) (plafond ${r.plafond}) ${r.motif ? `· ${r.motif}` : ''}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'rien-a-faire' ? 0 : 1;
        return;
    }
    if (mode === '--planche') {
        const r = await fabriquerPlanche({ dossierCache, sortie: path.join(P.DOSSIER_LOT, 'planche.png'), n: Number(val('echantillon', 50)) });
        console.log(`PLANCHE : ${r.images} image(s) sur ${r.total} en cache → ${r.sortie} (à regarder avant --ecrire)`);
        return;
    }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: mode === '--ecrire' ? ['R2_BUCKET_IMAGES'] : [] });
    try {
        const lu = P.lireReleves(dossierReleves);
        const { reglesDuSite } = require('./collecte-cartes/simuler-servis');
        const R = await reglesDuSite();
        const p = await planifierDepuisBase(cx.db, { cartes: lu.cartes, refusSite: R.refusDuVisuel });
        const motifs = {}; for (const r of p.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`relevés : ${lu.fichiers} lu(s), ${lu.ignores.length} ignoré(s), ${lu.cartes.length} cartes · ${p.produits} produits des sets de la table`);
        console.log(`PLAN : ${p.plan.length} ajout(s) pour ${p.plan.reduce((n, u) => n + u.produits.length, 0)} produit(s) · remplacements préparés (INACTIFS sans --remplacer) ${p.remplacements.length} · restes ${JSON.stringify(motifs)} · pages à relever ${p.setsAReleve.length}`);
        const voulus = (val('remplacer', '') || '').split(',').filter(Boolean).map(Number);
        if (mode === '--plan') {
            const urls = [...new Set([...p.plan, ...p.remplacements].map(u => u.url))];
            fs.mkdirSync(path.dirname(fichierPlan), { recursive: true });
            fs.writeFileSync(fichierPlan, JSON.stringify({ le: new Date().toISOString(), releves: { fichiers: lu.fichiers, ignores: lu.ignores }, plan: p.plan, remplacements: p.remplacements, restes: p.restes, setsAReleve: p.setsAReleve, urls }, null, 1));
            console.log(`plan écrit : ${fichierPlan} · requêtes à faire : ${p.setsAReleve.length} page(s) de set + ${urls.length} image(s) + 2 robots.txt, ≥ ${P.CADENCE_MIN_MS / 1000} s entre deux (≈ ${Math.ceil((p.setsAReleve.length + urls.length + 2) * P.CADENCE_MS / 60000)} min)`);
            if (voulus.length) {
                const choisies = p.remplacements.filter(u => u.produits.some(id => voulus.includes(id)));
                const annonce = annonceRemplacement(await cx.db.collection('cartes').find({ _id: { $in: choisies.map(u => u.carteId) } }, { projection: { sets: 1, nomEn: 1, images: 1 } }).toArray(), choisies);
                const fa = path.join(P.DOSSIER_LOT, 'annonce-remplacement.json');
                fs.writeFileSync(fa, JSON.stringify(annonce, null, 1));
                console.log(`annonce des baisses du remplacement (${Object.keys(annonce).length} groupe(s)) → ${fa} · pour lot-additif.js --annonce=`);
            }
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
