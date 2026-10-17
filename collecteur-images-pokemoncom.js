// ============================================================
// COLLECTEUR D'IMAGES — pokemon.com (relevés PASSIFS du testeur) -> cache local -> R2 (WebP) + base `cartes` (lot PKMCOM-IMPORT, 2026-10-17)
// ============================================================
//   node collecteur-images-pokemoncom.js --plan [--cibles=<fichier>] [--releves=<dossier>]     (défaut) la SIMULATION : zéro requête, écrit plan.json
//   node collecteur-images-pokemoncom.js --telecharger                                          LES SEULES REQUÊTES : robots.txt puis les images du plan, lancées par le coordinateur
//   node lot-additif.js --quoi="pokemon.com : N visuels (lot pokemoncom-2026-10)" --collections=cartes,images,sets --compte=images:source=pokemon.com -- node collecteur-images-pokemoncom.js --ecrire --attendu=<N>
//
// ⛔ TROIS PHASES, TROIS DROITS. --plan et --ecrire ne font AUCUNE requête réseau (l'écriture lit le cache seulement) ; seul --telecharger sort, et il est borné :
//   · seules les adresses PRÉSENTES MOT POUR MOT dans un relevé et RETENUES par le plan ; hôte d'images seul, https, chemin des cartes (pokemoncom.js urlImageValide) ;
//   · robots.txt de l'hôte relu à CHAQUE téléchargement (dès qu'une image reste à demander), respecté ; Crawl-delay respecté (plafonné) ;
//   · agent honnête du dépôt, AUCUN en-tête de navigateur, redirection jamais suivie ; ≥ 5 s entre deux requêtes ; plafond = adresses à demander + 1 (robots), pas de réessai ;
//   · ARRÊT DÉFINITIF au premier 403, 429, défi (HTML au lieu d'une image, cf-mitigated, Imperva, 3xx, octets qui ne sont pas un PNG) : un fichier d'arrêt est écrit dans le
//     dossier du cache et tout lancement suivant REFUSE de partir tant qu'il existe — seul le testeur décide de le retirer. Une coupure ou un 5xx INTERROMPT sans l'écrire.
// 🔑 Ce que les appariements prouvent, et ce qu'ils ne prouvent pas : collecte-cartes/pokemoncom.js. La marque « 30 » des images de 30th Celebration se REGARDE avant l'écriture (aRegarder).
// Le retrait en un lot : retirer-visuels-pokemoncom.js.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const PK = require('./collecte-cartes/pokemoncom');
const T = require('./collecte-cartes/tpc');
const { cleNumero } = require('./collecte-cartes/jointure');
const { largeurAdmiseDe, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { marqueDe, arbitrer, remplacerBasseDefinition, empreinteEntree, documentsDesEntrees, documentsDeLaListe, normaliserTampon } = require('./collecte-cartes/basse-definition');           // « basseDefinition » : sous 350 px, d'après la largeur de l'ORIGINAL (jamais un nombre recopié ici) ; le remplacement d'une entrée marquée par une image non marquée (BASSE-DEF)
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { champsTracabilite, champsDeLEntree, compterSansAdresse } = require('./collecte-cartes/tracabilite');   // doctrine de collecte : retirable, adresse d'origine, date (une seule règle)

const STOP_OCTETS = 400 * 1024 * 1024;
const CRAWL_DELAY_MAX_S = 60;
const CIBLES_PAR_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\PKMCOM-CLICS\\croisement-reel.json';
const ROBOTS = `https://${PK.HOTE_IMAGES}/robots.txt`;
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const MARQUEUR_DE_DEFI = /just a moment|captcha|challenge|attention required|cf-chl|_incapsula|incapsula incident/i;
const PNG_MAGIE =Buffer.from('89504e470d0a1a0a', 'hex');

// ── le plan (lecture seule de la base) ────────────────────────────────────────────────────────────────────────────────────
/** Les cibles : les idProduct du croisement (clé `chez[].produits[].idProduct`). */
function lireCibles(fichier = CIBLES_PAR_DEFAUT) {
    const j = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    const ids = (j.chez || []).flatMap(c => (c.produits || []).map(p => p.idProduct));
    if (!ids.length) throw new Error(`cibles : aucun idProduct lu dans ${fichier} — une clé fausse, pas une absence`);
    return ids;
}
/** Les trous des cibles et leur appariement aux cartes relevées. `db` : la base `cartes`, LECTURE SEULE. */
async function planifierDepuisBase(db, { cartes, cibles, refusSite = null }) {
    const lignes = await db.collection('cartes_produits').find({ idProduct: { $in: cibles } }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1, slugSet: 1, slug: 1 } }).toArray();
    if (!lignes.length) throw new Error(`cartes_produits : 0 ligne pour ${cibles.length} cibles — une clé fausse (§41)`);
    const retenues = lignes.filter(l => Object.values(PK.CASES).includes(l.slugSet));
    const parId = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(retenues.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    // les fiches de chaque set chez nous (l'unicité du nom se compte sur TOUT le set)
    const noms = new Map();
    for (const slug of new Set(retenues.map(l => l.slugSet))) {
        const ls = await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray();
        const cs = await db.collection('cartes').find({ _id: { $in: [...new Set(ls.map(l => l.carteId))] } }, { projection: { nomEn: 1 } }).toArray();
        const m = new Map();
        for (const c of cs) { const k = PK.nomNorm(c.nomEn); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(c._id); }
        noms.set(slug, m);
    }
    const trous = retenues.filter(l => parId.has(l.carteId)).map(l => ({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche ?? null, slugProduit: l.slug ?? null, carte: parId.get(l.carteId) }));
    // 🔑 la règle du site (refusDuVisuel, importée du site : collecte-cartes/simuler-servis.js reglesDuSite) juge les entrées au numéro ; sans elle, la règle minimale (scan japonais)
    const sets = new Map((await db.collection('sets').find({ _id: { $in: [...new Set(retenues.map(l => l.slugSet))] } }, { projection: { tirage: 1, region: 1 } }).toArray()).map(s => [s._id, s.tirage ?? s.region]));
    const refus = refusSite ? (e, slug) => (e.cleR2 ? refusSite(e, sets.get(slug) ?? 'intl') : null) : undefined;
    const r = PK.apparier({ trous, cartes, noms, ...(refus ? { refus } : {}) });
    const horsTable = lignes.filter(l => !Object.values(PK.CASES).includes(l.slugSet)).map(l => ({ idProduct: l.idProduct, motif: 'set-hors-table' }));
    const sansFiche = cibles.filter(id => !lignes.some(l => l.idProduct === id)).map(id => ({ idProduct: id, motif: 'produit-sans-ligne' }));
    return { cibles: cibles.length, ...r, restes: [...r.restes, ...horsTable, ...sansFiche] };
}

// ── adresses autorisées ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Les adresses du plan présentes MOT POUR MOT dans un relevé ET valables. */
function urlsAutorisees(plan, cartes) {
    const relevees = new Set(cartes.map(c => c.img));
    const ok = [], refusees = [];
    for (const u of new Set(plan.map(p => p.url))) {
        if (!PK.urlImageValide(u)) refusees.push({ url: u, motif: 'adresse-hors-regle' });
        else if (!relevees.has(u)) refusees.push({ url: u, motif: 'hors-releve' });
        else ok.push(u);
    }
    return { ok, refusees };
}

// ── le cache local ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const fichierArret = dossier => path.join(dossier, 'ARRET-DEFINITIF.json');
const fichierIndex = dossier => path.join(dossier, 'index.json');
const nomFichier = url => new URL(url).pathname.slice(PK.PREFIXE_CHEMIN.length).replace(/\//g, '__');
function lireIndex(dossier) { try { const j = JSON.parse(fs.readFileSync(fichierIndex(dossier), 'utf8')); return j?.images ? j : { version: 1, images: {} }; } catch { return { version: 1, images: {} }; } }
function ecrireIndex(dossier, index) { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(fichierIndex(dossier), JSON.stringify(index, null, 1)); }

// ── le transport RÉEL : l'agent du dépôt seul, aucune redirection suivie, l'hôte d'images seul ─────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        if (url !== ROBOTS && !PK.urlImageValide(url)) throw new Error(`pokemon.com : adresse hors de ce que le collecteur autorise (${PK.HOTE_IMAGES}, robots.txt et le chemin des cartes) — aucune requête`);
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': PK.UA }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const cfMitigated = r.headers.get('cf-mitigated');
        const imperva = /imperva|incapsula/i.test(`${r.headers.get('x-cdn') || ''} ${r.headers.get('set-cookie') || ''}`) || !!r.headers.get('x-iinfo');
        const type = r.headers.get('content-type') || '';
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), cfMitigated, imperva };
        // un 404/410 rend aussi son corps (borné) : un défi caché derrière un 404 doit se voir ; la page « 404 - Not Found » d'AmazonS3 n'en porte aucun
        if (r.status === 404 || r.status === 410) return { status: r.status, type, texte: (await r.text()).slice(0, 3000), cfMitigated, imperva };
        if (binaire && r.ok && /^image\//.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()), cfMitigated, imperva };
        return { status: r.status, type, texte: await r.text(), cfMitigated, imperva };
    }
};

/**
 * LA PHASE RÉSEAU. @param {{urls: string[], dossierCache: string, transport?: object, pause?: Function, now?: Function, cadenceMs?: number}} o
 * @returns {{etat: 'termine'|'rien-a-faire'|'refuse-arret'|'robots-interdit'|'arret-definitif'|'interrompu', requetes: number, plafond: number, refusees: object[], motif?: string}}
 */
async function telecharger({ urls, dossierCache, transport = transportFetch, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, cadenceMs = PK.CADENCE_MS, plafond: plafondMax = null }) {
    if (fs.existsSync(fichierArret(dossierCache))) return { etat: 'refuse-arret', requetes: 0, plafond: 0, refusees: [], motif: `${fichierArret(dossierCache)} existe : un arrêt définitif a eu lieu, seul le testeur décide de le lever` };
    const refusees = [...new Set(urls)].filter(u => !PK.urlImageValide(u)).map(u => ({ url: u, motif: 'adresse-hors-regle' }));
    const index = lireIndex(dossierCache);
    const afaire = [...new Set(urls)].filter(u => PK.urlImageValide(u) && !['ok', 'absent'].includes(index.images[u]?.statut));
    if (!afaire.length) return { etat: 'rien-a-faire', requetes: 0, plafond: 0, refusees };
    const plafond = Math.min(afaire.length + 1, plafondMax ?? Infinity);     // (`plafondMax` : un garde-fou plus bas, pour le banc ; jamais plus haut que adresses + 1)
    let requetes = 0, dernier = null, cadence = Math.max(cadenceMs, PK.CADENCE_MS);
    const arret = (url, r, motif) => { fs.mkdirSync(dossierCache, { recursive: true }); fs.writeFileSync(fichierArret(dossierCache), JSON.stringify({ le: new Date().toISOString(), url, status: r?.status ?? null, motif, requetes }, null, 1)); return { etat: 'arret-definitif', requetes, plafond, refusees, motif }; };
    // 🔴 TOUR 2 : un défi s'écrit par ce qui le PROUVE (liste fermée), jamais par « c'est du HTML » : le robots.txt réel de l'hôte répond 404 avec la page HTML d'AmazonS3, et un 404/410
    // est « absent » (robots.txt : aucune règle). Preuves : 403, 429, 3xx, cf-mitigated, Imperva/Incapsula, un marqueur de défi dans le corps (404/410 compris). Pour une IMAGE attendue,
    // un 200 qui n'est pas un PNG est jugé plus bas (octets) : arrêt aussi.
    const defi = r => r.status === 403 || r.status === 429 || (r.status >= 300 && r.status < 400) || !!r.cfMitigated || !!r.imperva || (typeof r.texte === 'string' && MARQUEUR_DE_DEFI.test(r.texte.slice(0, 3000)));
    const demander = async (url, o) => {
        if (requetes >= plafond) throw Object.assign(new Error('plafond de requêtes atteint'), { plafond: true });
        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }
        dernier = now(); requetes++;
        return transport.get(url, o);
    };
    // 1. robots.txt, d'abord
    let robots;
    try { robots = await demander(ROBOTS, {}); } catch (e) { return { etat: 'interrompu', requetes, plafond, refusees, motif: e.message }; }
    if (defi(robots)) return arret(ROBOTS, robots, `robots.txt : HTTP ${robots.status} — défi ou refus`);
    let texteRobots = null;
    if (robots.status === 200) texteRobots = robots.texte ?? '';
    else if (robots.status !== 404 && robots.status !== 410) return { etat: 'interrompu', requetes, plafond, refusees, motif: `robots.txt illisible (HTTP ${robots.status}) : on ne peut pas conclure, aucune image` };
    const delai = T.delaiDesRobots(texteRobots, PK.UA);
    if (delai && delai > CRAWL_DELAY_MAX_S) return { etat: 'robots-interdit', requetes, plafond, refusees, motif: `Crawl-delay de ${delai} s` };
    if (delai) cadence = Math.max(cadence, delai * 1000);
    const permises = afaire.filter(u => T.autoriseParRobots(texteRobots, new URL(u).pathname, PK.UA));
    if (!permises.length) return { etat: 'robots-interdit', requetes, plafond, refusees, motif: 'robots.txt interdit ces chemins' };
    // 2. les images
    fs.mkdirSync(path.join(dossierCache, 'img'), { recursive: true });
    for (const url of permises) {
        let r;
        try { r = await demander(url, { binaire: true }); } catch (e) { return { etat: 'interrompu', requetes, plafond, refusees, motif: e.message }; }
        if (defi(r)) return arret(url, r, `HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}${r.imperva ? ', Imperva' : ''}${/html/i.test(r.type || '') ? ', HTML au lieu d\'une image' : ''}`);
        if (r.status === 404 || r.status === 410) { index.images[url] = { statut: 'absent', status: r.status, le: new Date().toISOString() }; ecrireIndex(dossierCache, index); continue; }
        if (r.status >= 500) return { etat: 'interrompu', requetes, plafond, refusees, motif: `HTTP ${r.status} sur ${url}` };
        if (r.status !== 200) return { etat: 'interrompu', requetes, plafond, refusees, motif: `HTTP ${r.status} sur ${url} : réponse inattendue, on s'arrête` };
        if (!Buffer.isBuffer(r.octets) || r.octets.length < 8 || !r.octets.subarray(0, 8).equals(PNG_MAGIE)) return arret(url, r, 'les octets reçus ne sont pas un PNG (page de défi probable)');
        const meta = await sharp(r.octets).metadata();
        const fichier = path.join('img', nomFichier(url));
        fs.writeFileSync(path.join(dossierCache, fichier), r.octets);
        index.images[url] = { statut: 'ok', fichier, sha256: sha('sha256', r.octets), octets: r.octets.length, w: meta.width, h: meta.height, le: new Date().toISOString() };
        ecrireIndex(dossierCache, index);
    }
    return { etat: 'termine', requetes, plafond, refusees };
}

// ── L'ÉCRITURE, depuis le cache seulement ─────────────────────────────────────────────────────────────────────────────────────
async function compterEntrees(db, carteIds, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!(e?.source === PK.SOURCE && e.lot === PK.LOT)) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}
const cleEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;

/**
 * L'ANNONCE de baisses pour `lot-additif.js --annonce=` quand des remplacements sont demandés : ce que la garde de lot verrait si les entrées refusées sortaient et que les
 * nôtres entraient (compterEtat / comparer, les fonctions de la garde). Sans remplacement : rien. @returns {Object<string, number>}
 */
function annonceRemplacement(cartes, remplacements) {
    if (!remplacements?.length) return {};
    const cles = new Set(remplacements.flatMap(u => u.refusees.map(e => `${u.slugSet}|${e.cleR2}`)));
    const apres = cartes.map(c => ({ ...c, images: [...(c.images || []).filter(e => !cles.has(`${e.set}|${e.cleR2}`)), ...remplacements.filter(u => u.carteId === c._id).map(u => ({ set: u.slugSet, source: PK.SOURCE, lot: PK.LOT, numero: u.numero, cleR2: `${PK.SOURCE}/${u.slugSet}/${PK.cleNum(u.numero)}-${u.carteId}-en.webp` }))] }));
    const { baisses } = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }));
    return Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
}

/**
 * @param {object[]} plan   les unités (PK.apparier().plan)
 * @param {object} M        les modèles de la base `cartes`
 * @param {{dossierCache: string, attendu?: number, deposer: Function, vignetter: Function, fabriquerVerrouSet?: Function, stopOctets?: number}} o
 * @returns {Promise<{code: number, etat?: string, resultats: object[], attendu: number, reel: number, horsCache: number, altere: number}>}
 */
async function ecrire(plan, M, { dossierCache, attendu = null, deposer, vignetter, fabriquerVerrouSet = null, stopOctets = STOP_OCTETS, remplacements = [], remplacer = [] } = {}) {
    if (typeof deposer !== 'function' || typeof vignetter !== 'function') throw new Error('ecrire : deposer et vignetter sont exigés');
    const db = M.Carte.db.db;
    const index = lireIndex(dossierCache);
    const seuil = largeurAdmiseDe(PK.SOURCE);        // 200 px (plancher de basse définition, BASSE-DEF) : de 200 à 349 px l'image est admise et MARQUÉE (marqueDe)
    // ---- REMPLACER : liste FERMÉE — chaque idProduct doit figurer dans le motif « entree-refusee-au-numero » du plan, sinon rien n'est écrit ; sans --remplacer, rien ne bouge ----
    const idsRemplaçables = new Set((remplacements || []).flatMap(u => u.produits));
    const inconnus = (remplacer || []).filter(id => !idsRemplaçables.has(id));
    if (inconnus.length) {
        console.error(`❌ --remplacer : ${inconnus.join(', ')} ne figure(nt) pas dans le motif « entree-refusee-au-numero » du plan — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-remplacer', resultats: [], attendu: attendu ?? 0, reel: 0, horsCache: 0, altere: 0, inconnus };
    }
    const choisies = (remplacements || []).filter(u => u.produits.some(id => (remplacer || []).includes(id))).map(u => ({ ...u, _remplace: true }));
    // ---- 0. le PRÉ-PASSAGE : ce que le cache permet d'écrire, avant la moindre écriture ------------------------------------------------------------------
    const prets = [];
    let horsCache = 0, altere = 0, retires = 0;
    for (const u of [...plan, ...choisies]) {
        const e = index.images[u.url];
        if (!PK.urlImageValide(u.url) || e?.statut !== 'ok') { horsCache++; continue; }
        let buffer; try { buffer = fs.readFileSync(path.join(dossierCache, e.fichier)); } catch { horsCache++; continue; }
        if (sha('sha256', buffer) !== e.sha256) { altere++; console.error(`❌ cache altéré (sha256) : ${u.url}`); continue; }
        const meta = await sharp(buffer).metadata();
        if (meta.format !== 'png') { altere++; continue; }
        const _id = PK.idImagePokemoncom(u.slugSet, u.carteId, u.numero);
        const deja = await M.Image.findById(_id).select('etat').lean();
        if (deja?.etat === 'retire') { retires++; continue; }
        prets.push({ u, _id, buffer, meta, petit: !meta.width || meta.width < seuil });
    }
    const reel = prets.filter(p => !p.petit).length;
    if (attendu != null && attendu !== reel) {
        console.error(`❌ --attendu=${attendu} mais ${reel} image(s) à écrire (hors cache ${horsCache}, altérées ${altere}, retirées ${retires}, sous le seuil ${prets.filter(p => p.petit).length}) — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-attendu', resultats: [], attendu, reel, horsCache, altere };
    }
    // ---- 1. un set après l'autre -----------------------------------------------------------------------------------------------------------------------
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
        const idEtat = `${PK.SOURCE}/${slug}`;
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
                    if (deja?.etat !== 'trop-petit') await M.Image.updateOne({ _id }, { $set: { source: PK.SOURCE, set: slug, carteId: u.carteId, numero: u.numero, urlOriginal: u.url, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: seuil, lot: PK.LOT } }, { upsert: true });
                    continue;
                }
                if (deja?.etat === 'ok' && deja.sha256 && deja.urlOriginal === u.url) { sautes++; ecrits.push(_id); continue; }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = `${PK.SOURCE}/${slug}/${PK.cleNum(u.numero)}-${u.carteId}-en.webp`;
                await deposer(bucket, cleR2, webp.data, 'image/webp');
                const lg = langueDuVisuel({ source: PK.SOURCE, langueSource: 'en', urlOriginal: u.url });
                await M.Image.updateOne({ _id }, { $set: {
                    source: PK.SOURCE, set: slug, carteId: u.carteId, numero: u.numero, nomEn: u.nomEn, idProduct: u.produits[0], produits: u.produits, preuve: u.preuve, voie: u.voie, urlOriginal: u.url,
                    caseReleve: u.ligne, numeroReleve: u.numeroReleve, releve: u.releve, ...(u.aRegarder ? { aRegarder: true } : {}),
                    wOriginal: meta.width, hOriginal: meta.height, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length,
                    cleR2, sha256: sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                    ...marqueDe({ wOriginal: meta.width }),
                    langueSource: 'en', langue: lg.langue, languePreuve: lg.preuve, attribution: PK.MENTION, mention: PK.MENTION, lot: PK.LOT, telechargeLe: new Date(), etat: 'ok',
                    ...champsTracabilite({ urlOriginal: u.url, collecteLe: index.images[u.url]?.le ?? new Date() }) }, $unset: { erreur: 1 } }, { upsert: true });
                telecharges++; ecrits.push(_id);
            }
            // ---- JOINTURE ADDITIVE, sous sa garde -----------------------------------------------------------------------------------------------------
            const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
            const avant = await compterEntrees(db, carteIds, slug);
            const images = (await M.Image.find({ source: PK.SOURCE, set: slug, etat: 'ok', lot: PK.LOT }).lean()).filter(im => ecrits.includes(im._id));
            let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null, remplacees = 0, basseDefRemplacees = 0;
            const retirees = [];                              // les entrées refusées sorties par --remplacer (clé de compterEntrees) : la garde les attend absentes
            try {
                for (const im of images) {
                    const c = await M.Carte.findById(im.carteId).select('images').lean();
                    if (!c) { cartesAbsentes++; continue; }
                    const u = uniteDe.get(im._id);
                    const refCles = new Set(u?._remplace ? (u.refusees || []).map(e => e.cleR2) : []);
                    const nous = e => e?.source === PK.SOURCE && e.set === slug && (e.numero ?? null) === (im.numero ?? null);
                    const autres = (c.images || []).filter(e => e && !nous(e));
                    const admises = autres.filter(e => !refCles.has(e.cleR2));        // (sans --remplacer, refCles est vide : toute entrée au numéro sert la fiche)
                    const entree = { set: slug, source: PK.SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, numero: im.numero ?? null, ...marqueDe(im), attribution: PK.MENTION, mention: PK.MENTION, lot: PK.LOT, langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date(), ...champsDeLEntree(im), ...(im.wOriginal ? { wOriginal: im.wOriginal } : {}) };
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: PK.SOURCE, numero: im.numero ?? null } } });
                    // ➕ BASSE-DEF : une entrée MARQUÉE (basse définition) d'une autre source, même (set, numéro, langue connue), n'est pas « servie » face à une image NON marquée : elle sort
                    // (la même fonction que artofpkm / Bulbapedia / TCGdex). Une image marquée (245 px…) ne remplace jamais rien et cède.
                    // correction 5 : l'identité de l'entrée se lit aussi sur son DOCUMENT (le tampon d'un scan Pokumon y vit) ; document introuvable → pas de remplacement
                    const arb = arbitrer(admises, entree, restantes => T.dejaServi({ images: restantes }, slug, im.numero ?? null), { documents: await documentsDesEntrees(M, admises) });
                    if (arb.servie) { dejaParAutre++; continue; }     // une AUTRE source (admise) sert ce numéro : intacte, la nôtre cède
                    if (arb.sortantes.length) { await remplacerBasseDefinition(M, im.carteId, entree); for (const e of arb.sortantes) { retirees.push(empreinteEntree(im.carteId, e)); basseDefRemplacees++; } }
                    for (const e of autres.filter(x => refCles.has(x.cleR2))) {
                        await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, cleR2: e.cleR2 } } });
                        await M.Image.updateOne({ source: e.source, set: slug, carteId: im.carteId, cleR2: e.cleR2 }, { $set: { etat: 'remplace', remplaceMotif: `entrée refusée par la règle du site au numéro ${im.numero ?? '∅'}, remplacée sur décision du testeur (--remplacer, lot ${PK.LOT})`, remplaceePar: im._id, remplaceeLe: new Date() } });
                        retirees.push(cleEntree(im.carteId, e)); remplacees++;
                    }
                    await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                    joints++;
                }
            } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
            const apres = await compterEntrees(db, carteIds, slug);
            const attenduesAutres = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');
            const garde = attenduesAutres === apres.autres && apres.siennes === joints;
            if (!garde) console.error(`🔴 ${slug} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres}${attenduesAutres === apres.autres ? '' : ' (CHANGÉES)'} (attendu ${avant.nAutres - retirees.length}), entrées ${PK.SOURCE} ${apres.siennes} pour ${joints} jointes`);
            const W = await vignetter(db, slug, { bucket, arreter: () => false });
            console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)`}`);
            const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
            const complet = { vignettes: W.vg, source: PK.SOURCE, mention: PK.MENTION, lot: PK.LOT, unites: unites.length, sansUrlOriginal: compterSansAdresse(images), telecharges, sautes, tropPetits, joints, dejaParAutre, cartesAbsentes, garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attenduesAutres === apres.autres, remplacees, basseDefRemplacees, siennesApres: apres.siennes, ok: garde }, erreurJointure,
                concordance: garde && !erreurJointure && vignettesOk && cartesAbsentes === 0 && telecharges + sautes + tropPetits === unites.length, verifieLe: new Date() };
            await M.Set.updateOne({ _id: slug }, { $set: { visuelsPokemoncom: complet } });
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), bilan: complet } }, { upsert: true });
            console.log(`   ${slug} : unités ${unites.length} · déposées ${telecharges} · reprises ${sautes} · sous le seuil ${tropPetits} · joints ${joints} · cédées ${dejaParAutre} · garde ${garde ? '✅' : '❌'} · requêtes 0`);
            resultats.push({ code: slug, etat: erreurJointure ? 'incomplet' : !garde ? 'non-concordant' : complet.concordance ? 'verifie' : 'incomplet', ...complet });
        } finally { if (verrouSet) await verrouSet.rendre(); }
    }
    const code = resultats.every(r => r.etat === 'verifie') && !horsCache && !altere ? 0 : 1;
    return { code, resultats, attendu: attendu ?? reel, reel, horsCache, altere };
}

module.exports = { lireCibles, planifierDepuisBase, urlsAutorisees, telecharger, ecrire, annonceRemplacement, transportFetch, fichierArret, fichierIndex, lireIndex, STOP_OCTETS, CIBLES_PAR_DEFAUT };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion.
const AUTORISES = [/^--plan$/, /^--telecharger$/, /^--ecrire$/, /^--attendu=\d{1,4}$/, /^--cibles=.+$/, /^--releves=.+$/, /^--cache=.+$/, /^--sortie=.+$/, /^--remplacer=\d+(,\d+)*$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--telecharger', '--ecrire'].filter(m => args.includes(m));
if (inconnus.length || modes.length > 1 || (args.some(a => a.startsWith('--attendu=')) && !args.includes('--ecrire')) || (args.includes('--ecrire') && !args.some(a => a.startsWith('--attendu=')))) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}un seul mode parmi --plan (défaut), --telecharger, --ecrire ; --ecrire exige --attendu=<N> (et lui seul l'accepte). Options : --cibles=, --releves=, --cache=, --sortie=, --remplacer=<idProduct,…> (liste fermée : seulement le motif « entree-refusee-au-numero » du plan ; avec --plan : écrit l'annonce ; avec --ecrire : remplace).`);
    process.exitCode = 2;                  // (jamais de sortie forcée du processus : les poignées de fetch/libuv se ferment d'elles-mêmes, sinon « Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) »)
}
const argsValides = process.exitCode !== 2;
const val = (nom, defaut) => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut;
const dossierReleves = val('releves', PK.DOSSIER_RELEVES), dossierCache = val('cache', PK.DOSSIER_CACHE), fichierPlan = val('sortie', path.join(PK.DOSSIER_LOT, 'plan.json'));

async function planComplet(db) {
    const lu = PK.lireReleves(dossierReleves);
    // la règle du site (refusDuVisuel) est IMPORTÉE du site, comme la simulation des produits servis : si elle ne se charge pas, le plan LÈVE (jamais un repli silencieux)
    const { reglesDuSite } = require('./collecte-cartes/simuler-servis');
    const R = await reglesDuSite();
    const p = await planifierDepuisBase(db, { cartes: lu.cartes, cibles: lireCibles(val('cibles', CIBLES_PAR_DEFAUT)), refusSite: R.refusDuVisuel });
    return { lu, ...p };
}
if (argsValides) (async () => {
    const mode = modes[0] || '--plan';
    if (mode === '--telecharger') {
        // le plan s'est écrit en --plan ; le téléchargement le RELIT avec les relevés (jamais d'adresse hors des deux)
        const j = JSON.parse(fs.readFileSync(fichierPlan, 'utf8'));
        const lu = PK.lireReleves(dossierReleves);
        const a = urlsAutorisees([...j.plan, ...(j.remplacements || [])], lu.cartes);       // (les adresses des remplacements préparés se téléchargent aussi : le remplacement, lui, reste inactif sans --remplacer)
        console.log(`${a.ok.length} adresse(s) autorisée(s) (plan ∩ relevés), ${a.refusees.length} refusée(s) : ${JSON.stringify(a.refusees)}`);
        const r = await telecharger({ urls: a.ok, dossierCache });
        console.log(`TÉLÉCHARGEMENT : ${r.etat} · ${r.requetes} requête(s) (plafond ${r.plafond}) ${r.motif ? `· ${r.motif}` : ''}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'rien-a-faire' ? 0 : 1;
        return;
    }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: mode === '--ecrire' ? ['R2_BUCKET_IMAGES'] : [] });
    try {
        const p = await planComplet(cx.db);
        const parSet = {}; for (const u of p.plan) parSet[u.slugSet] = (parSet[u.slugSet] || 0) + u.produits.length;
        const motifs = {}; for (const r of p.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`relevés : ${p.lu.fichiers} lus, ${p.lu.ignores.length} ignoré(s) ${JSON.stringify(p.lu.ignores.map(x => `${x.fichier} (${x.motif})`))}, ${p.lu.cartes.length} cartes dédoublonnées`);
        console.log(`PLAN : ${p.plan.length} image(s) pour ${p.plan.reduce((n, u) => n + u.produits.length, 0)} produit(s) sur ${p.cibles} cibles · par set ${JSON.stringify(parSet)} · restes ${JSON.stringify(motifs)} · remplacements préparés (INACTIFS sans --remplacer) ${p.remplacements.length} image(s) pour ${p.remplacements.reduce((n, u) => n + u.produits.length, 0)} produit(s)`);
        const voulus = (val('remplacer', '') || '').split(',').filter(Boolean).map(Number);
        if (mode === '--plan') {
            const urls = [...new Set([...p.plan, ...p.remplacements].map(u => u.url))];
            fs.mkdirSync(path.dirname(fichierPlan), { recursive: true });
            fs.writeFileSync(fichierPlan, JSON.stringify({ le: new Date().toISOString(), releves: { fichiers: p.lu.fichiers, ignores: p.lu.ignores }, cibles: p.cibles, plan: p.plan, remplacements: p.remplacements, restes: p.restes, urls }, null, 1));
            console.log(`plan écrit : ${fichierPlan} · requêtes à faire : ${urls.length} images + 1 robots.txt, ≥ ${PK.CADENCE_MS / 1000} s entre deux (≈ ${Math.ceil((urls.length + 1) * PK.CADENCE_MS / 60000)} min)`);
            if (voulus.length) {
                const choisies = p.remplacements.filter(u => u.produits.some(id => voulus.includes(id)));
                const annonce = annonceRemplacement(await cx.db.collection('cartes').find({ _id: { $in: choisies.map(u => u.carteId) } }, { projection: { sets: 1, nomEn: 1, images: 1 } }).toArray(), choisies);
                const fa = path.join(PK.DOSSIER_LOT, 'annonce-remplacement.json');
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
