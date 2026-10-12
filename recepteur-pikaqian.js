// ============================================================
// RÉCEPTEUR PASSIF DE PIKAQIAN — reçoit la page de set que LE TESTEUR a ouverte lui-même (2026-10-12)
// ============================================================
//   node recepteur-pikaqian.js [--port=8765] [--dossier=<chemin>]
//
// 🔑 DÉCISION DU TESTEUR (2026-10-12) : « PikaQian suspendue au 3e blocage : pas d'arrêt définitif. Prépare un script PASSIF sur le modèle de celui de
// Cardmarket (bouton « Apprendre cette page » sur les pages de set que J'OUVRE MOI-MÊME, aucune navigation automatique) qui envoie carte, numéro et
// adresse d'image. Prépare-le seulement, sans le lancer. »
//
// Ce programme ne fait AUCUNE requête réseau : il écoute 127.0.0.1 (jamais une autre adresse, et l'hôte n'est pas réglable), reçoit ce que le userscript
// (userscript-pikaqian.js) envoie au clic, le lit avec les fonctions de PRODUCTION (collecte-cartes/pikaqian.js : lireTuiles, lireOrigines, verdictDePage,
// compterAncresCartes — jamais une copie) et écrit UN fichier par page apprise. Aucune base, aucun secret. Le HTML n'est pas gardé : son sha256 seulement.
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (rien d'autre ne passe) — et elle ne DÉPEND PAS d'un en-tête que Tampermonkey pourrait ne pas transmettre :
//   · méthode POST, chemin exactement /apprendre (ni requête, ni barre finale) ;
//   · Host exactement 127.0.0.1:<port> ou localhost:<port> (contre le rebinding DNS) ;
//   · Content-Type application/json OBLIGATOIRE : une page web ne peut pas l'envoyer à un autre site sans PRÉVOL (OPTIONS), et OPTIONS reste 405, sans
//     en-tête CORS ni autorisation d'accès au réseau privé ;
//   · l'en-tête fixe `X-Rat-Market: rat-market-passif` que pose le userscript (même effet : un en-tête personnalisé impose le prévol) ;
//   · Origin : seulement https://pikaqian.com, ABSENTE (un navigateur l'ajoute toujours à un POST de page : l'absence prouve un client hors page), ou celle
//     d'une extension (chrome-extension://, moz-extension://) — toute autre origine web, et « null », sont refusées ;
//   · corps ≤ PAGE_MAX_OCTETS (pikaqian.js), compté sur la déclaration ET sur le flux reçu ;
//   · un objet JSON de DEUX clés exactement, url et html (chaînes) ;
//   · url == urlSet(code) de pikaqian.js pour un code du motif CODE_PK ;
//   · verdictDePage ok : la majorité stricte des tuiles porte le code du set ;
//   · la page est COMPLÈTE : autant de tuiles lues que d'ancres de cartes (sinon 422 « page partielle »), et au moins le nombre de tuiles que la mesure
//     du set a relevé quand la table le connaît (sinon 422 « page incomplète ») — une page refusée n'est jamais écrite, donc jamais mesurée.
// Chaque garde porte la marque « GARDE:<nom> » : rouge-recepteur-pikaqian.js retire les gardes une à une et exige que le banc échoue.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const sharp = require('sharp');
const P = require('./collecte-cartes/pikaqian');
const { TABLE_PIKAQIAN } = require('./collecte-cartes/pikaqian-sets');

// ── LES IMAGES (lot P2, 2026-10-13) ───────────────────────────────────────────────────────────────────────────────────────────
// 🔑 DÉCISION DU TESTEUR (2026-10-13) : « PikaQian : A. Le script passif envoie l'image telle que mon navigateur l'affiche, avec la carte et le numéro ; le worker
// ne touche jamais le CDN. Mêmes preuves exigées (numéro, nom, set) ; un doute est un trou. » Un SECOND chemin, POST /images, reçoit par lots bornés les octets que le
// navigateur du testeur a lus pour les tuiles de la page qu'il vient d'apprendre. Même garde que /apprendre (méthode, Host, Origin, en-tête fixe, Content-Type, taille) ;
// puis, PAR IMAGE : la tuile existe dans la fiche de la page, son adresse est celle que la page déclare ET celle que pikaqian.js calcule (`urlImage`), le nom et le numéro que
// le DOM de la page affiche sont ceux que `lireTuiles` a lus dans le HTML (deux témoins), l'image se DÉCODE (sharp), son format est webp/png/jpeg, ses dimensions sont sensées,
// son empreinte sha256 est calculée. Chaque image part dans `<dossierImages>/<codePk>/<id>--<sha12>.<ext>` — JAMAIS écrasée — et le fichier de PAGE
// (`page--<fiche>.json`) dit ce qui est reçu, ce qui est refusé et pourquoi. Rien en base, rien sur R2, aucune requête sortante.
const DOSSIER_PASSIF_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pikaqian-passif';
const IMAGES_PAR_LOT_MAX = 25;
const LOT_OCTETS_MAX = 4 * 1024 * 1024;                       // octets DÉCODÉS d'un lot ; le corps (base64) reste sous PAGE_MAX_OCTETS
const IMAGE_OCTETS_MAX = P.IMAGE_MAX_OCTETS;                  // 2 Mo par image (une image réelle : ~35 Ko)
const DIMENSION_MAX = 4096;
const EXTENSIONS = Object.freeze({ webp: 'webp', png: 'png', jpeg: 'jpg' });
const VOIES = new Set(['canvas', 'cache', 'navigateur']);   // d'où le navigateur du testeur a lu les octets (userscript-pikaqian.js)
const NOM_FICHE = /^([a-z0-9][a-z0-9.-]{0,30})--(\d{8}T\d{6}Z)(-\d+)?\.json$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

const HOTE = '127.0.0.1';
const PORT_DEFAUT = 8765;          // = PORT du userscript (userscript-pikaqian.js, en tête) : les deux changent ensemble
const ORIGINE_ATTENDUE = `https://${P.HOTE_PAGES}`;
const ORIGINE_EXTENSION = /^(chrome|moz)-extension:\/\/[A-Za-z0-9-]+$/;
const ENTETE_MARQUE = 'x-rat-market', VALEUR_MARQUE = 'rat-market-passif';
const DOSSIER_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pikaqian\\apprises';
const PREFIXE_URL = `https://${P.HOTE_PAGES}/sets/`;
// ce que la page de Remix hydratée porte de son flux de données : s'il manque, `lireOrigines` ne peut rien lire (PIKAQIAN-PASSIF.md)
const MARQUEURS_FLUX = /__reactRouterContext|__remixContext|streamController\s*\.\s*enqueue|"loaderData"/;

const dansLeDepot = dossier => {
    const rel = path.relative(__dirname.toLowerCase(), path.resolve(dossier).toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const horodatage = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** Le nombre de tuiles que la mesure du set a relevé (pikaqian-sets.json, `tuiles`), ou null quand la table ne le connaît pas. */
const attenduParTable = code => TABLE_PIKAQIAN.filter(l => l.codePk === code && Number.isInteger(l.tuiles)).reduce((m, l) => Math.max(m, l.tuiles), 0) || null;

/** Écrit la fiche sans jamais écraser un fichier existant (un apprentissage de plus = un fichier de plus). */
function ecrireFiche(dossier, fiche) {
    const base = `${fiche.code}--${horodatage(new Date(fiche.le))}`;
    for (let i = 0; i < 100; i++) {
        const nom = `${base}${i ? `-${i + 1}` : ''}.json`;
        const cible = path.join(dossier, nom), tmp = `${cible}.tmp`;
        if (fs.existsSync(cible)) continue;
        fs.writeFileSync(tmp, JSON.stringify(fiche), { flag: 'wx' });
        fs.renameSync(tmp, cible);
        return nom;
    }
    throw new Error('plus de 100 fichiers pour la même seconde');
}

/**
 * Le JUGEMENT d'un corps lu : pur, rend { statut, corps, fiche? }. `html` n'est jamais gardé. `attendu(code)` : le nombre de tuiles attendu, ou null.
 */
function jugerPage(brut, { attendu = attenduParTable } = {}) {
    let o;
    try { o = JSON.parse(brut); } catch { return { statut: 400, corps: { ok: false, motif: 'corps illisible : ce n\'est pas du JSON' } }; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { statut: 400, corps: { ok: false, motif: 'le corps doit être un objet JSON' } };   // GARDE:objet
    const cles = Object.keys(o).sort().join(',');
    if (cles !== 'html,url') return { statut: 400, corps: { ok: false, motif: `clés reçues « ${cles} » : seules url et html sont acceptées` } };   // GARDE:cles
    if (typeof o.url !== 'string' || typeof o.html !== 'string') return { statut: 400, corps: { ok: false, motif: 'url et html doivent être des chaînes' } };   // GARDE:types
    const code = o.url.startsWith(PREFIXE_URL) ? o.url.slice(PREFIXE_URL.length) : null;
    let attendue = null;
    try { if (code && P.CODE_PK.test(code)) attendue = P.urlSet(code); } catch { /* hors motif */ }
    if (attendue !== o.url) return { statut: 422, corps: { ok: false, motif: `adresse « ${o.url.slice(0, 120)} » : ce n'est pas la page d'un set (${PREFIXE_URL}<code>)` } };   // GARDE:url
    const tuiles = P.lireTuiles(o.html);
    const ancres = P.compterAncresCartes(o.html);
    const verdict = P.verdictDePage({ tuiles, code });
    if (!verdict.ok) return { statut: 422, corps: { ok: false, code, motif: verdict.motif, tuilesLues: verdict.tuiles, tuilesAuCode: verdict.bonnes, ancres } };   // GARDE:verdict
    if (ancres > tuiles.length) return { statut: 422, corps: { ok: false, code, motif: `page partielle ou forme changée : ${ancres} ancres, ${tuiles.length} tuiles`, tuilesLues: tuiles.length, ancres } };   // GARDE:ancres
    const voulu = attendu(code);
    if (voulu && tuiles.length < voulu) return { statut: 422, corps: { ok: false, code, motif: `page incomplète : ${tuiles.length} tuiles lues, ${voulu} relevées pour ce set à la mesure`, tuilesLues: tuiles.length, ancres, attendu: voulu } };   // GARDE:incomplete
    const origines = [...P.lireOrigines(o.html)];
    const officielles = origines.filter(([, v]) => v.officielle).length;
    // « flux absent » (aucun bloc de données de Remix dans la page : ANOMALIE) ≠ « flux présent, 0 adresse officielle » (le résultat normal : 1 sur 315)
    const flux = origines.length || MARQUEURS_FLUX.test(o.html) ? 'present' : 'absent';
    const anomalie = flux === 'absent' ? 'FLUX DE DONNÉES ABSENT : aucun bloc de données Remix trouvé dans la page — les adresses officielles ne peuvent pas être lues (page non hydratée ? forme changée ?). À signaler.' : null;
    const fiche = {
        schema: 1, code, url: o.url, le: new Date().toISOString(),
        sha256: crypto.createHash('sha256').update(o.html).digest('hex'), octetsHtml: Buffer.byteLength(o.html),
        verdict, ancres, tuilesLues: tuiles.length, tuilesAuCode: verdict.bonnes, flux, tuiles, origines, officielles
    };
    return { statut: 200, fiche, corps: { ok: true, code, ancres, tuilesLues: tuiles.length, tuilesAuCode: verdict.bonnes, flux, officielles, natives: origines.filter(([, v]) => v.native).length, ...(anomalie ? { anomalie } : {}) } };
}

// ── LES IMAGES : le fichier de page, puis le jugement d'un lot ─────────────────────────────────────────────────────────────────
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const cheminPage = (dossierImages, code, nomFiche) => path.join(dossierImages, code, `page--${nomFiche.replace(/\.json$/, '')}.json`);
/** Écrit un fichier de façon atomique (tmp puis renommage) ; `ecraser: false` = jamais d'écrasement (EEXIST remonte). */
function ecrireFichier(cible, contenu, { ecraser = false } = {}) {
    const tmp = `${cible}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, contenu, { flag: 'w' });
    try { if (ecraser) fs.renameSync(tmp, cible); else fs.linkSync(tmp, cible); }
    finally { if (!ecraser) fs.rmSync(tmp, { force: true }); }
}
/** Le fichier de PAGE d'une visite : ce que la page portait (code, date, tuiles), puis ce que les lots d'images y ajoutent. Créé avec la fiche, jamais deux fois. */
function creerPage(dossierImages, nomFiche, fiche) {
    fs.mkdirSync(path.join(dossierImages, fiche.code), { recursive: true });
    const page = { schema: 2, code: fiche.code, url: fiche.url, le: fiche.le, fiche: nomFiche, sha256Html: fiche.sha256,
        tuiles: fiche.tuiles.map(t => ({ id: t.id, nom: t.nom, numero: t.numero, code: t.code, img: t.img })),
        // ce que la page déclare de l'ORIGINE des visuels (lireOrigines) et le dénominateur de la lecture : l'import n'a pas besoin d'une autre pièce pour la provenance
        origines: fiche.origines, ancres: fiche.ancres, flux: fiche.flux,
        sansImageDansLeNavigateur: null, lots: 0, recues: {}, refusees: {} };
    ecrireFichier(cheminPage(dossierImages, fiche.code, nomFiche), JSON.stringify(page));
    return page;
}

/**
 * Le JUGEMENT d'un lot d'images : asynchrone (décodage), écrit les images valides et met à jour le fichier de page. Rend { statut, corps }.
 * Un lot mal formé est refusé en bloc ; une IMAGE refusée ne refuse pas les autres (elle est rendue avec son motif et écrite dans le fichier de page).
 */
async function jugerImages(brut, { dossier, dossierImages, maintenant = () => new Date() }) {
    let o;
    try { o = JSON.parse(brut); } catch { return { statut: 400, corps: { ok: false, motif: 'corps illisible : ce n\'est pas du JSON' } }; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { statut: 400, corps: { ok: false, motif: 'le corps doit être un objet JSON' } };
    const cles = Object.keys(o).sort().join(',');
    if (cles !== 'fichier,images,sansImage') return { statut: 400, corps: { ok: false, motif: `clés reçues « ${cles} » : seules fichier, images et sansImage sont acceptées` } };   // GARDE:images-cles
    const nom = typeof o.fichier === 'string' ? NOM_FICHE.exec(o.fichier) : null;
    if (!nom) return { statut: 422, corps: { ok: false, motif: 'fichier : le nom d\'une fiche apprise (<code>--<date>.json) est exigé' } };   // GARDE:images-fichier
    if (!Number.isInteger(o.sansImage) || o.sansImage < 0) return { statut: 400, corps: { ok: false, motif: 'sansImage doit être un entier positif ou nul' } };
    if (!Array.isArray(o.images) || o.images.length < 1 || o.images.length > IMAGES_PAR_LOT_MAX) return { statut: 413, corps: { ok: false, motif: `un lot porte de 1 à ${IMAGES_PAR_LOT_MAX} images` } };   // GARDE:images-lot
    let fiche;
    try { fiche = JSON.parse(fs.readFileSync(path.join(dossier, o.fichier), 'utf8')); } catch { return { statut: 404, corps: { ok: false, motif: `la fiche ${o.fichier} n'existe pas : apprendre la page d'abord` } }; }
    const code = fiche.code;
    if (code !== nom[1] || !P.CODE_PK.test(code) || !Array.isArray(fiche.tuiles)) return { statut: 422, corps: { ok: false, motif: 'la fiche ne désigne pas le set de son nom' } };
    const parId = new Map(fiche.tuiles.map(t => [t.id, t]));
    const refusees = [], recues = [];
    let decodes = 0, nouvelles = 0, deja = 0;
    const refus = (id, motif) => refusees.push({ id: typeof id === 'string' ? id.slice(0, 40) : null, motif });
    const decoder = [];
    for (const im of o.images) {
        if (!im || typeof im !== 'object' || Object.keys(im).sort().join(',') !== 'b64,id,nom,numero,src,voie' || Object.values(im).some(v => typeof v !== 'string')) { refus(im?.id, 'image mal formée : id, src, nom, numero, voie et b64 (chaînes) exigés, rien d\'autre'); continue; }   // GARDE:image-forme
        const t = parId.get(im.id);
        if (!t) { refus(im.id, 'tuile inconnue de la page apprise'); continue; }   // GARDE:image-tuile
        if (!(im.src === t.img && t.img === P.urlImage(code, t.id) && t.code === code)) { refus(im.id, `adresse « ${im.src.slice(0, 100)} » : ce n'est pas celle que la page déclare pour cette tuile (${t.img}) dans le dossier du set`); continue; }   // GARDE:image-adresse
        if (!(im.nom === t.nom && im.numero === t.numero)) { refus(im.id, `le DOM affiche « ${im.nom.slice(0, 60)} » n° ${im.numero.slice(0, 20)}, le HTML de la page « ${t.nom} » n° ${t.numero} : deux lectures qui se contredisent`); continue; }   // GARDE:image-nom-numero
        if (!VOIES.has(im.voie)) { refus(im.id, `voie « ${im.voie.slice(0, 20)} » inconnue`); continue; }   // GARDE:image-voie
        if (im.b64.length > Math.ceil(IMAGE_OCTETS_MAX * 4 / 3) + 4 || !B64.test(im.b64)) { refus(im.id, `octets illisibles ou au-delà de ${IMAGE_OCTETS_MAX} octets`); continue; }   // GARDE:image-octets
        const octets = Buffer.from(im.b64, 'base64');
        if (octets.length > IMAGE_OCTETS_MAX) { refus(im.id, `image de ${octets.length} octets, au-delà de ${IMAGE_OCTETS_MAX}`); continue; }
        decodes += octets.length;
        decoder.push({ im, t, octets });
    }
    if (decodes > LOT_OCTETS_MAX) return { statut: 413, corps: { ok: false, motif: `lot de ${decodes} octets décodés : au-delà de ${LOT_OCTETS_MAX}` } };   // GARDE:images-lot-octets
    fs.mkdirSync(path.join(dossierImages, code), { recursive: true });
    const cheminP = cheminPage(dossierImages, code, o.fichier);
    let page; try { page = JSON.parse(fs.readFileSync(cheminP, 'utf8')); } catch { page = creerPage(dossierImages, o.fichier, fiche); }
    const le = maintenant().toISOString();
    for (const { im, t, octets } of decoder) {
        let meta = null;
        // le DÉCODAGE complet (pas seulement l'en-tête) : un fichier tronqué ou truqué n'est pas une image
        try { meta = await sharp(octets).metadata(); await sharp(octets).raw().toBuffer(); } catch { meta = null; }
        if (!meta) { refus(im.id, 'octets qui ne se décodent pas en image'); continue; }   // GARDE:image-decodage
        if (!EXTENSIONS[meta.format]) { refus(im.id, `format « ${meta.format} » : webp, png ou jpeg seulement`); continue; }   // GARDE:image-format
        if (!(meta.width >= 1 && meta.height >= 1 && meta.width <= DIMENSION_MAX && meta.height <= DIMENSION_MAX)) { refus(im.id, `dimensions ${meta.width}×${meta.height} hors de 1…${DIMENSION_MAX}`); continue; }   // GARDE:image-dimensions
        const empreinte = sha256(octets);
        const fichier = `${t.id}--${empreinte.slice(0, 12)}.${EXTENSIONS[meta.format]}`;
        const cible = path.join(dossierImages, code, fichier);
        if (fs.existsSync(cible)) deja++;
        else { ecrireFichier(cible, octets); nouvelles++; }
        const lues = page.recues[t.id] ?? (page.recues[t.id] = []);
        if (!lues.some(x => x.sha256 === empreinte)) lues.push({ fichier, sha256: empreinte, octets: octets.length, w: meta.width, h: meta.height, fmt: meta.format, voie: im.voie, le });
        delete page.refusees[t.id];
        recues.push(t.id);
    }
    for (const r of refusees) if (r.id) page.refusees[r.id] = { motif: r.motif, le };
    page.sansImageDansLeNavigateur = o.sansImage; page.lots++;
    ecrireFichier(cheminP, JSON.stringify(page), { ecraser: true });
    return { statut: 200, corps: { ok: true, code, recues: recues.length, nouvelles, deja, refusees, page: path.basename(cheminP) } };
}

/**
 * Démarre le récepteur. `port: 0` = éphémère (les bancs). `hote` n'existe pas : 127.0.0.1 seulement. `attendu` n'existe que pour les bancs.
 * @returns {Promise<{port:number, adresse:string, fermer:()=>Promise<void>}>}
 */
async function demarrer({ port = PORT_DEFAUT, dossier = DOSSIER_DEFAUT, dossierImages = null, maxOctets = P.PAGE_MAX_OCTETS, attendu = attenduParTable, journal = m => console.log(m) } = {}) {
    if (!Number.isFinite(maxOctets) || maxOctets <= 0) throw new Error(`plafond de corps illisible (${maxOctets}) : PAGE_MAX_OCTETS de pikaqian.js doit être un nombre`);
    if (dansLeDepot(dossier)) throw new Error(`le dossier « ${dossier} » est dans le dépôt : les pages apprises n'y entrent jamais`);
    // les images et les fichiers de page : le dossier de production par défaut, SEULEMENT quand les fiches vont au leur ; sinon un voisin du dossier donné (les bancs)
    if (!dossierImages) dossierImages = path.resolve(dossier) === path.resolve(DOSSIER_DEFAUT) ? DOSSIER_PASSIF_DEFAUT : `${path.resolve(dossier)}-passif`;
    if (dansLeDepot(dossierImages)) throw new Error(`le dossier « ${dossierImages} » est dans le dépôt : les images reçues n'y entrent jamais`);
    fs.mkdirSync(dossier, { recursive: true });
    let serie = Promise.resolve();                                // les lots d'images sont jugés UN À LA FOIS (le fichier de page se réécrit)
    const serveur = http.createServer((req, res) => {
        const repondre = (statut, corps) => {
            const t = JSON.stringify(corps);
            res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(t), Connection: 'close', 'Cache-Control': 'no-store' });
            res.end(t);
        };
        const refuser = (statut, motif) => { journal(`⛔ ${statut} ${req.method} ${String(req.url).slice(0, 80)} : ${motif}`); repondre(statut, { ok: false, motif }); };
        const { port: portReel } = serveur.address() || {};
        const origine = req.headers.origin;
        if (req.method !== 'POST') return refuser(405, 'seule la méthode POST est acceptée');   // GARDE:methode
        if (req.url !== '/apprendre' && req.url !== '/images') return refuser(404, 'seuls les chemins /apprendre et /images existent');   // GARDE:chemin
        const route = req.url;
        if (req.headers.host !== `${HOTE}:${portReel}` && req.headers.host !== `localhost:${portReel}`) return refuser(403, 'Host refusé');   // GARDE:host
        if (!(origine === undefined || origine === ORIGINE_ATTENDUE || ORIGINE_EXTENSION.test(origine))) return refuser(403, `Origin « ${String(origine).slice(0, 60)} » refusée (seules ${ORIGINE_ATTENDUE}, l'absence d'Origin et une origine d'extension passent)`);   // GARDE:origine
        if (req.headers[ENTETE_MARQUE] !== VALEUR_MARQUE) return refuser(403, `en-tête ${ENTETE_MARQUE} absent ou différent de ${VALEUR_MARQUE}`);   // GARDE:entete
        if (!/^application\/json(\s*;.*)?$/i.test(req.headers['content-type'] || '')) return refuser(415, 'Content-Type application/json exigé');   // GARDE:contenttype
        const declare = Number(req.headers['content-length']);
        if (declare > maxOctets) return refuser(413, `corps de ${declare} octets : au-delà de ${maxOctets}`);   // GARDE:taille-declaree
        const morceaux = []; let total = 0, trop = false;
        req.on('data', c => {
            if (trop) return;
            total += c.length;
            if (total > maxOctets) { trop = true; morceaux.length = 0; refuser(413, `corps de plus de ${maxOctets} octets`); setTimeout(() => req.destroy(), 50); return; }   // GARDE:taille-flux
            morceaux.push(c);
        });
        req.on('error', () => { /* coupure : rien à écrire */ });
        req.on('end', () => {
            if (trop) return;
            if (route === '/images') {
                const brut = Buffer.concat(morceaux).toString('utf8');
                serie = serie.then(async () => {
                    try {
                        const j = await jugerImages(brut, { dossier, dossierImages });
                        if (j.statut !== 200) { journal(`⛔ ${j.statut} lot d'images refusé : ${j.corps.motif}`); return repondre(j.statut, j.corps); }
                        journal(`🖼️ ${j.corps.code} : ${j.corps.recues} image(s) reçue(s) (${j.corps.nouvelles} nouvelle(s), ${j.corps.deja} déjà là), ${j.corps.refusees.length} refusée(s)${j.corps.refusees.length ? ` — ${j.corps.refusees.slice(0, 3).map(r => r.motif).join(' | ')}` : ''}`);
                        repondre(200, j.corps);
                    } catch (e) { journal(`🔴 erreur interne (images) : ${e.message}`); repondre(500, { ok: false, motif: 'erreur interne du récepteur' }); }
                });
                return;
            }
            try {
                const j = jugerPage(Buffer.concat(morceaux).toString('utf8'), { attendu });
                if (j.statut !== 200) { journal(`⛔ ${j.statut} page refusée : ${j.corps.motif}${j.corps.ancres != null ? ` (ancres ${j.corps.ancres}, tuiles ${j.corps.tuilesLues ?? '?'})` : ''}`); return repondre(j.statut, j.corps); }
                const nom = ecrireFiche(dossier, j.fiche);
                creerPage(dossierImages, nom, j.fiche);
                journal(`✅ ${j.fiche.code} : ${j.fiche.ancres} ancres, ${j.fiche.tuilesLues} tuiles lues, ${j.fiche.tuilesAuCode} au code du set, flux ${j.fiche.flux}, ${j.fiche.officielles} adresse(s) officielle(s) déclarée(s) → ${nom}${j.corps.anomalie ? `\n   ⚠️ ${j.corps.anomalie}` : ''}`);
                repondre(200, { ...j.corps, fichier: nom });
            } catch (e) { journal(`🔴 erreur interne : ${e.message}`); repondre(500, { ok: false, motif: 'erreur interne du récepteur' }); }
        });
    });
    serveur.requestTimeout = 30000;
    await new Promise((ok, ko) => { serveur.once('error', ko); serveur.listen(port, HOTE, ok); });
    const a = serveur.address();
    return { port: a.port, adresse: a.address, fermer: () => new Promise(ok => { serveur.close(() => ok()); serveur.closeAllConnections?.(); }) };
}

module.exports = { demarrer, jugerPage, jugerImages, ecrireFiche, creerPage, cheminPage, dansLeDepot, attenduParTable, HOTE, PORT_DEFAUT, ORIGINE_ATTENDUE, ENTETE_MARQUE, VALEUR_MARQUE, DOSSIER_DEFAUT, DOSSIER_PASSIF_DEFAUT, IMAGES_PAR_LOT_MAX, LOT_OCTETS_MAX, IMAGE_OCTETS_MAX, EXTENSIONS };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main === module) {
    // La ligne de commande s'écrit par ce qu'elle AUTORISE : un argument inconnu refuse avant d'écouter.
    const args = process.argv.slice(2);
    const AUTORISES = [/^--port=(\d{4,5})$/, /^--dossier=.+$/, /^--dossier-images=.+$/];
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const port = Number(args.find(a => a.startsWith('--port='))?.slice(7) ?? PORT_DEFAUT);
    if (inconnus.length || !(port >= 1024 && port <= 65535)) {
        console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}permis : --port=<1024-65535> (défaut ${PORT_DEFAUT}, = PORT du userscript : si tu le changes ici, change-le aussi en tête de userscript-pikaqian.js), --dossier=<chemin> (hors du dépôt). Le récepteur n'écoute que ${HOTE}.`);
        process.exit(2);
    }
    const dossier = args.find(a => a.startsWith('--dossier='))?.slice(10) ?? DOSSIER_DEFAUT;
    const dossierImages = args.find(a => a.startsWith('--dossier-images='))?.slice(17) ?? null;
    demarrer({ port, dossier, dossierImages }).then(s => {
        console.log(`Récepteur PikaQian : http://${s.adresse}:${s.port}/apprendre et /images — fiches ${dossier} — images ${dossierImages ?? (path.resolve(dossier) === path.resolve(DOSSIER_DEFAUT) ? DOSSIER_PASSIF_DEFAUT : `${path.resolve(dossier)}-passif`)} — Ctrl+C pour arrêter. Aucune requête sortante.`);
    }).catch(e => { console.error('❌', e.message); process.exit(1); });
}
