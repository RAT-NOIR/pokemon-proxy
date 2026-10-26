// ============================================================
// LE MOTEUR COMMUN DES RÉCOLTES « RECOLTE » (pokipair `ppr`, tcgcsv `tcs`) — 2026-10-24
// ============================================================
// Les deux collecteurs ont les MÊMES étapes après l'appariement (§21 bis : deux exemplaires d'une règle divergent toujours) :
//   télécharger (vraie image, ratio de carte, largeur) -> planches (à REGARDER) -> décider (rien d'existant n'est perdu) -> écrire (cache seulement, aucune requête).
// Ils ne diffèrent que par leur SOURCE (code neutre, lot, langue, clé R2, tirage attendu) : un descripteur `SRC` passé à chaque fonction. Le modèle est collecteur-images-cardtrader.js
// (ses étapes, ses gardes) ; la règle de remplacement est CELLE de collecte-cartes/basse-definition.js (via CT.decisionEcriture), la traçabilité CELLE de tracabilite.js,
// la décision d'une réponse d'hôte CELLE de reponse-hote.js (via recolte-hote.js). Aucun prédicat n'est recopié.
//
// Une UNITÉ = un produit joint à une carte, à un numéro d'un set, avec l'adresse de SON image :
//   { carteId, slugSet, numero, produits: [idProduct], url, idSource, groupe, carteNom, nomSource, numeroSource, preuve, ... }
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const RH = require('./reponse-hote');
const HOTE = require('./recolte-hote');
const CT = require('./cardtrader');                         // decisionEcriture (la règle commune de remplacement), prng
const { largeurMinDe, largeurAdmiseDe, WEBP_LARGEUR, WEBP_QUALITE } = require('./seuils-images');
const { marqueDe, remplacerBasseDefinition, documentsDesEntrees } = require('./basse-definition');
const { champsTracabilite } = require('./tracabilite');

const RATIO_MIN = 1.30, RATIO_MAX = 1.50;                   // une carte n'est jamais carrée (350 x 482 = 1,377)
const STOP_OCTETS = 400 * 1024 * 1024;
const MENTION = '© Pokémon / The Pokémon Company';
const sha = (algo, b) => crypto.createHash(algo).update(b).digest('hex');
const lireJson = (f, defaut) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return defaut; } };
const ecrireJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };

/** Aucun chemin vers un dossier d'apports manuels du testeur (règle commune du dépôt). */
function verifierChemin(p) {
    if (/Logo FR|apport-manuel|\\LOGO(\\|$)/i.test(path.resolve(p))) throw new Error(`chemin refusé (dossier d'apports manuels du testeur) : ${p}`);
    return p;
}
const cleNum = n => (n == null || String(n).trim() === '' ? 'sn' : String(n).trim().replace(/[^A-Za-z0-9._-]/g, '_'));

/**
 * Le descripteur d'une source. Écrit par ce qu'il autorise : tout champ manquant LÈVE (un code, un lot ou une langue absents ne se devinent pas), et le code neutre ne contient pas
 * le nom de la source (la liste des noms interdits est donnée par l'appelant : `nomsInterdits`).
 */
function fabriquerSource({ SOURCE, LOT, LANGUE, LANGUE_PREUVE, TIRAGE, CHAMP_BILAN, nomsInterdits = [], tampon = () => undefined, refuserOctets = () => null }) {
    if (typeof refuserOctets !== 'function') throw new Error('source : « refuserOctets » doit être une fonction (octets -> motif | null)');
    for (const [k, v] of Object.entries({ SOURCE, LOT, LANGUE, LANGUE_PREUVE, TIRAGE, CHAMP_BILAN })) if (typeof v !== 'string' || !v) throw new Error(`source : « ${k} » absent`);
    for (const n of nomsInterdits) for (const [k, v] of Object.entries({ SOURCE, LOT, LANGUE_PREUVE, CHAMP_BILAN })) if (new RegExp(n, 'i').test(v)) throw new Error(`source : « ${k} » (${v}) nomme la source (${n}) — le nom de la source n'apparaît jamais en public`);
    return Object.freeze({ SOURCE, LOT, LANGUE, LANGUE_PREUVE, TIRAGE, CHAMP_BILAN, MENTION, tampon, refuserOctets,
        cleR2: (slug, numero, carteId) => `${SOURCE}/${slug}/${cleNum(numero)}-${carteId}-${LANGUE}.webp`,
        idImage: (slug, carteId, numero) => `${SOURCE}/${slug}/${carteId}/${cleNum(numero)}/${LANGUE}`,
        idEtat: slug => `${SOURCE}/${slug}` });
}

// ── 0. Le contrôle de largeur et le jugement d'une image ─────────────────────────────────────────────────────────────────────
/** Au seuil de la source -> `ok` ; du plancher admis jusqu'au seuil -> `basse-definition` (seulement si la source figure dans la liste fermée de seuils-images.js) ; sinon `trop-petit`. */
function controleLargeur(SRC, largeur) {
    const w = typeof largeur === 'number' && Number.isFinite(largeur) ? largeur : 0;
    if (w >= largeurMinDe(SRC.SOURCE)) return { statut: 'ok', largeur: w };
    return w >= largeurAdmiseDe(SRC.SOURCE) ? { statut: 'basse-definition', largeur: w } : { statut: 'trop-petit', largeur: w };
}
/** Les octets sont-ils une VRAIE image (format décodable, forme de carte) ? -> { statut: 'ok'|'trop-petit'|'forme-inattendue'|'illisible', w, h, format } */
async function juger(SRC, octets) {
    // RECOLTE2 : un fichier que la source SAIT être autre chose qu'une carte (le dos d'une carte servi en 200 pour une adresse inconnue) n'est jamais une image, quelle que soit sa forme
    const refus = SRC.refuserOctets ? SRC.refuserOctets(octets) : null;
    if (refus) return { statut: refus };
    let meta;
    try { meta = await sharp(octets).metadata(); } catch { return { statut: 'illisible' }; }
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || !meta.height) return { statut: 'illisible', format: meta.format };
    const ratio = meta.height / meta.width;
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) return { statut: 'forme-inattendue', w: meta.width, h: meta.height, format: meta.format };
    const c = controleLargeur(SRC, meta.width);
    // l'index garde `ok` ou `trop-petit` AVEC la largeur ; qu'une image sous le seuil soit une basse définition ADMISE se REJOUE depuis cette largeur (`jugementDe`)
    return { statut: c.statut === 'ok' ? 'ok' : 'trop-petit', w: meta.width, h: meta.height, format: meta.format };
}
/** Le jugement d'une entrée de l'index d'images, rejoué depuis sa largeur : `ok` | `basse-definition` | `trop-petit` | tout autre statut inchangé. Aucune requête. */
function jugementDe(SRC, ix) {
    if (ix?.statut === 'trop-petit') return controleLargeur(SRC, ix.w).statut;
    return ix?.statut;
}

// ── 1. LE TÉLÉCHARGEMENT des images ──────────────────────────────────────────────────────────────────────────────────────────
const arretDe = e => (e.plafond ? 'plafond' : e.arretDefinitif || e.bloque ? 'arret-definitif' : e.pauseHote ? 'pause-hote' : 'interrompu');
/**
 * @param {{SRC: object, unites: object[], cli: object, fichier: string, progression?: string, now?: Function}} o  `unites` : celles à télécharger (décision `ajouter`), chacune avec `url`.
 * La reprise : une adresse jugée est finale (sauf une « fausse absence », seconde preuve après 24 h). `progression` : un fichier JSON réécrit après chaque image.
 */
async function telecharger({ SRC, unites, cli, fichier, hoteImages, progression = null, now = Date.now }) {
    if (typeof hoteImages !== 'string' || !hoteImages) throw new Error('telecharger : l\'hôte des images est obligatoire (son robots.txt se lit avant la première image)');
    const idx = lireJson(fichier, {});
    const urls = [...new Set(unites.map(u => u.url).filter(Boolean))];
    let etat = 'termine', motif = null, transitoires = 0, consecutifs = 0, faits = 0;
    const ecrireProgression = (e = 'en-cours') => { if (progression) ecrireJson(progression, { etat: e, le: new Date().toISOString(), total: urls.length, jugees: urls.filter(u => idx[u]).length, requetes: cli.requetes(), requetesParHote: cli.requetesParHote() }); };
    try {
        ecrireProgression();
        await cli.initialiserRobots(hoteImages);
        for (const url of urls) {
            // une adresse jugée est finale, SAUF une « fausse absence » (200 text/html) : seconde preuve après 24 h (règle commune, reponse-hote.js), jamais définitive au premier coup
            const connu = idx[url];
            if (connu && !(connu.statut === 'fausse-absente' && !RH.fausseAbsenceRecente(connu, now()))) continue;
            let r;
            try { r = await cli.lireImage(url); }
            catch (e) {
                if (!e.transitoire) throw e;
                transitoires++;
                if (++consecutifs >= 2) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }       // un 5xx isolé saute l'image ; deux de suite arrêtent
                continue;
            }
            consecutifs = 0;
            if (r.absente) { idx[url] = { statut: r.meta?.statut === 'fausse-absente' ? 'fausse-absente' : 'absent', le: r.meta?.le, ...(r.meta?.secondeFois ? { secondeFois: true } : {}) }; ecrireJson(fichier, idx); continue; }
            const j = await juger(SRC, r.octets);
            idx[url] = { ...j, octets: r.octets.length, sha256: r.meta?.sha256 ?? sha('sha256', r.octets) };
            ecrireJson(fichier, idx);
            if (++faits % 10 === 0) ecrireProgression();
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    ecrireJson(fichier, idx);
    ecrireProgression(etat);
    cli.liberer?.();                      // D3 : le verrou de l'hôte est rendu
    const par = {};
    for (const v of Object.values(idx)) par[v.statut] = (par[v.statut] || 0) + 1;
    return { etat, motif, transitoires, requetes: cli.requetes(), adresses: urls.length, parStatut: par, restantes: urls.filter(u => !idx[u]).length, tropPetits: Object.entries(idx).filter(([, v]) => v.statut === 'trop-petit').map(([u, v]) => ({ url: u, largeur: v.w })) };
}

// ── 2. LES PLANCHES (à REGARDER avant d'écrire) ──────────────────────────────────────────────────────────────────────────────
const echapper = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Un échantillon déterministe (graine fixe), en tourniquet sur les groupes : aucune famille ne prend toute la planche. Tout le lot si `n` le dépasse. */
function choisirEchantillon(unites, n, { graine = 20261024 } = {}) {
    const alea = CT.prng(graine), parGroupe = new Map();
    for (const u of unites || []) (parGroupe.get(u.groupe) || parGroupe.set(u.groupe, []).get(u.groupe)).push(u);
    const groupes = [...parGroupe.keys()].sort(), pris = [];
    let i = 0;
    while (pris.length < n && groupes.some(g => parGroupe.get(g).length)) {
        const g = groupes[i++ % groupes.length], l = parGroupe.get(g);
        if (l.length) pris.push(l.splice(Math.floor(alea() * l.length), 1)[0]);
    }
    return pris;
}
async function planches({ SRC, unites, indexImages, dossierCache, sortieDossier, n = 50, basseDefinition = false, prefixe = 'planche' }) {
    const statutVoulu = basseDefinition ? 'basse-definition' : 'ok';
    const dispo = unites.filter(u => u.url && (basseDefinition ? jugementDe(SRC, indexImages[u.url]) : indexImages[u.url]?.statut) === statutVoulu && HOTE.lireDuCache(dossierCache, u.url));
    if (!dispo.length) throw new Error('planche : aucune image au cache pour le lot');
    const choix = choisirEchantillon(dispo, n);
    const L = 240, H = 330, B = 82, COL = 5, PAR_PLANCHE = 15;
    const fichiers = [];
    fs.mkdirSync(sortieDossier, { recursive: true });
    for (let p = 0; p * PAR_PLANCHE < choix.length; p++) {
        const lot = choix.slice(p * PAR_PLANCHE, (p + 1) * PAR_PLANCHE), rangs = Math.ceil(lot.length / COL), tuiles = [];
        for (let i = 0; i < lot.length; i++) {
            const u = lot[i], left = (i % COL) * L, top = Math.floor(i / COL) * (H + B), c = HOTE.lireDuCache(dossierCache, u.url);
            tuiles.push({ input: await sharp(c.octets).resize(L, H, { fit: 'fill' }).png().toBuffer(), left, top });
            const l1 = `${basseDefinition ? `${indexImages[u.url].w}px · ` : ''}${u.groupe} · ${u.slugProduit ?? u.produits?.[0] ?? '?'}`, l2 = `fiche : ${u.carteNom ?? 'aucun nom'} · n°${u.numero ?? '—'}`, l3 = `source : ${u.nomSource ?? '?'} · n°${u.numeroSource ?? '—'}`, l4 = `${u.variante ?? ''} · ${indexImages[u.url].w}x${indexImages[u.url].h} · id ${u.idSource ?? '?'}`;
            const ligne = (y, t, col = '#000') => `<text x="4" y="${y}" font-family="Arial" font-size="13" fill="${col}">${echapper(t.slice(0, 38))}</text>`;
            tuiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${B}"><rect width="${L}" height="${B}" fill="#fff"/>${ligne(16, l1)}${ligne(34, l2)}${ligne(52, l3)}${ligne(70, l4, '#060')}</svg>`), left, top: top + H });
        }
        const f = path.join(sortieDossier, `${prefixe}-${p + 1}.jpg`);
        await sharp({ create: { width: L * COL, height: (H + B) * rangs, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(tuiles).jpeg({ quality: 82 }).toFile(f);
        fichiers.push(f);
    }
    ecrireJson(path.join(sortieDossier, `${prefixe}.json`), choix.map(u => ({ idProduct: u.produits?.[0], carteId: u.carteId, groupe: u.groupe, slugSet: u.slugSet, carteNom: u.carteNom, numero: u.numero, nomSource: u.nomSource, numeroSource: u.numeroSource, idSource: u.idSource, variante: u.variante ?? null, image: u.url, largeur: indexImages[u.url].w })));
    return { images: choix.length, parGroupe: choix.reduce((m, u) => (m[u.groupe] = (m[u.groupe] || 0) + 1, m), {}), planches: fichiers };
}

// ── 3. LA DÉCISION et L'ÉCRITURE, depuis le cache seulement ──────────────────────────────────────────────────────────────────
const cleEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;
const cleDocument = e => `${e?.source}|${e?.set}|${e?.cleR2}`;
const duLot = (SRC, e) => e?.source === SRC.SOURCE && e.lot === SRC.LOT;
/** Les lecteurs : la MÊME décision lit la base native en lecture seule (plan, compte) ou les modèles de l'écriture (ecrire). */
const lecteurNatif = db => ({
    cartes: async ids => db.collection('cartes').find({ _id: { $in: ids } }).project({ images: 1 }).toArray(),
    images: async ids => db.collection('images').find({ carteId: { $in: ids } }).toArray(),
    document: async id => db.collection('images').findOne({ _id: id }, { projection: { etat: 1 } })
});
const lecteurModeles = M => ({
    cartes: ids => M.Carte.find({ _id: { $in: ids } }).select('images').lean(),
    images: ids => M.Image.find({ carteId: { $in: ids } }).lean(),
    document: id => M.Image.findById(id).select('etat').lean()
});
const candidatDe = (SRC, u, entree) => ({ set: u.slugSet, numero: u.numero, langue: SRC.LANGUE, source: SRC.SOURCE, cleR2: entree.cleR2, wOriginal: entree.wOriginal, ...(entree.basseDefinition ? { basseDefinition: true } : {}), ...(SRC.tampon(u.slugSet) ? { tampon: SRC.tampon(u.slugSet) } : {}) });

/** La décision de chaque unité sur l'état de la base (lecture seule) : ajouter | deja-posee | cede (la règle commune : jamais une image correcte remplacée). */
async function decider(SRC, unites, lecteur, { largeurDe = null } = {}) {
    const ids = [...new Set(unites.map(u => u.carteId))];
    const cartes = new Map((await lecteur.cartes(ids)).map(c => [c._id, c]));
    const documents = new Map();
    for (const d of await lecteur.images(ids)) { const k = cleDocument(d); if (!documents.has(k) || d.etat === 'ok') documents.set(k, d); }
    return unites.map(u => {
        const c = cartes.get(u.carteId);
        if (!c) return { ...u, decision: { action: 'cede', raison: 'carte introuvable en base', remplace: [] } };
        const cle = SRC.cleR2(u.slugSet, u.numero, u.carteId);
        // `largeurDe` : la VRAIE largeur de l'original, quand le téléchargement l'a mesurée ; sinon la largeur nominale du seuil (la jointure arbitre sur la vraie)
        const w = largeurDe ? largeurDe(u) : null, wOriginal = w ?? largeurMinDe(SRC.SOURCE);
        return { ...u, cleR2: cle, decision: CT.decisionEcriture(c.images || [], candidatDe(SRC, u, { cleR2: cle, wOriginal, ...marqueDe({ wOriginal }) }), { documents }) };
    });
}

/** L'entrée `cartes.images` d'une unité. `meta` : { wOriginal, cleR2, sha256, w, h, fmt }. LÈVE sans adresse d'origine (traçabilité commune). */
// D4 : `collecteLe` (et `telechargeLe` du document) est la date du TÉLÉCHARGEMENT, lue au cache (`meta.le`) ; `jointeLe` est la date de l'écriture. Sans date de téléchargement : la date d'écriture (tracabilite.js).
function entreeDeCarte(SRC, u, meta, le = new Date(), collecteLe = le) {
    const tampon = SRC.tampon(u.slugSet);
    return { set: u.slugSet, source: SRC.SOURCE, lot: SRC.LOT, cleR2: meta.cleR2, sha256: meta.sha256, w: meta.w, h: meta.h, fmt: meta.fmt, numero: u.numero ?? null, wOriginal: meta.wOriginal, ...marqueDe({ wOriginal: meta.wOriginal }),
        attribution: SRC.MENTION, mention: SRC.MENTION, langue: SRC.LANGUE, languePreuve: SRC.LANGUE_PREUVE, ...(tampon ? { tampon } : {}), jointeLe: new Date(le), ...champsTracabilite({ urlOriginal: u.url, collecteLe }) };
}
/** Le document `images` d'une unité. */
function documentImage(SRC, u, meta, le = new Date(), collecteLe = le) {
    const tampon = SRC.tampon(u.slugSet);
    return { _id: SRC.idImage(u.slugSet, u.carteId, u.numero), source: SRC.SOURCE, lot: SRC.LOT, set: u.slugSet, carteId: u.carteId, numero: u.numero ?? null, idProduct: u.produits[0], produits: u.produits, idSource: u.idSource ?? null,
        cleR2: meta.cleR2, sha256: meta.sha256, w: meta.w, h: meta.h, fmt: meta.fmt, wOriginal: meta.wOriginal, hOriginal: meta.hOriginal, ...marqueDe({ wOriginal: meta.wOriginal }),
        langueSource: SRC.LANGUE, langue: SRC.LANGUE, languePreuve: SRC.LANGUE_PREUVE, attribution: SRC.MENTION, mention: SRC.MENTION, ...(tampon ? { tampon } : {}),
        ...(u.preuveNeutre ? { preuve: u.preuveNeutre } : {}), telechargeLe: new Date(collecteLe), etat: 'ok', ...champsTracabilite({ urlOriginal: u.url, collecteLe }) };
}

async function compterEntrees(db, carteIds, slug, SRC) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = []; let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!duLot(SRC, e)) autres.push(cleEntree(c._id, e)); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}

/**
 * L'écriture : AUCUNE requête (le cache seulement). `unites` : celles du lot (avec `url`) ; `indexImages` : l'index des images jugées. Refusée par `--attendu` faux. Sous lot-additif.js seulement
 * (la ligne de commande le garantit). `M` : les modèles de la base `cartes`.
 */
async function ecrire({ SRC, unites, M, dossierCache, indexImages, attendu = null, deposer, vignetter, fabriquerVerrouSet = null, stopOctets = STOP_OCTETS, compterSeulement = false, basseDefinition = false, lecteur = null }) {
    if (!compterSeulement && (typeof deposer !== 'function' || typeof vignetter !== 'function')) throw new Error('ecrire : deposer et vignetter sont exigés');
    const db = M.Carte.db.db;
    const horsMode = basseDefinition ? unites.filter(u => jugementDe(SRC, indexImages[u.url]) === 'ok').length : undefined;
    const aTraiter = basseDefinition ? unites.filter(u => jugementDe(SRC, indexImages[u.url]) !== 'ok') : unites;
    const lect = lecteur ?? lecteurModeles(M);
    const decidees = await decider(SRC, aTraiter, lect, { largeurDe: u => indexImages[u.url]?.w ?? null });
    const prets = [];
    let horsCache = 0, altere = 0, retires = 0, cedees = 0, tropPetits = 0, dejaPosees = 0, ecartees = 0;
    const orphelins = [];
    for (const u of decidees) {
        if (u.ecrivable === false) { ecartees++; continue; }        // T4 : un visuel dont la langue n'est pas ouverte à l'écriture pour cette source (le japonais du marché) se LIT, il ne s'écrit jamais
        if (u.decision.action === 'cede') { cedees++; continue; }
        if (u.decision.action === 'deja-posee') { dejaPosees++; continue; }        // reprise d'un lot partiel : déjà là, n'entre pas dans `--attendu`
        const url = u.url, ix = indexImages[url];
        if (!url || !ix) { horsCache++; continue; }                                  // jamais téléchargée : une erreur, pas un écart
        const st = basseDefinition ? jugementDe(SRC, ix) : ix.statut;
        if (st === 'trop-petit') { tropPetits++; continue; }
        if (['absent', 'fausse-absente', 'forme-inattendue', 'illisible', 'dos-de-carte'].includes(st)) { ecartees++; continue; }
        if (st !== (basseDefinition ? 'basse-definition' : 'ok')) { horsCache++; continue; }
        const c = HOTE.lireDuCache(dossierCache, url);
        if (!c) { horsCache++; continue; }
        if (sha('sha256', c.octets) !== ix.sha256) { altere++; console.error(`❌ cache altéré (sha256) : ${url}`); continue; }
        const _id = SRC.idImage(u.slugSet, u.carteId, u.numero);
        const deja = await lect.document(_id);
        if (deja?.etat === 'retire') { retires++; continue; }
        prets.push({ u, _id, octets: c.octets, ix, collecteLe: c.meta?.le ?? null });
    }
    const reel = prets.length;
    // `--attendu` = le nombre d'UNITÉS à ajouter dont l'image est `ok` : imprimé AVANT tout refus
    if (basseDefinition) console.log(`unités basse définition à ajouter : ${reel} (hors mode, image ok : ${horsMode}, cédées ${cedees}, déjà posées ${dejaPosees}, écartées ${ecartees}, sous le plancher ${tropPetits}, hors cache ${horsCache}, altérées ${altere}, retirées ${retires})`);
    else console.log(`unités à ajouter dont l'image est ok : ${reel} (cédées ${cedees}, déjà posées ${dejaPosees}, écartées ${ecartees}, trop petites ${tropPetits}, hors cache ${horsCache}, altérées ${altere}, retirées ${retires})`);
    if (compterSeulement) return { code: 0, etat: 'compte', reel, unitesAAjouter: reel, horsCache, altere, ecartees, cedees, dejaPosees, tropPetits, horsMode, retires, orphelins };
    if (attendu != null && attendu !== reel) {
        console.error(`❌ --attendu=${attendu} mais ${reel} unité(s) à ajouter — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-attendu', resultats: [], attendu, reel, unitesAAjouter: reel, horsCache, altere, ecartees, cedees, retires, orphelins };
    }
    const bucket = process.env.R2_BUCKET_IMAGES;
    const resultats = [];
    for (const slug of [...new Set(prets.map(p => p.u.slugSet))]) {
        const unitesDuSet = prets.filter(p => p.u.slugSet === slug);
        const refus = (etat, erreur) => { console.error(`❌ ${slug} : ${erreur}.`); resultats.push({ code: slug, etat, erreur }); };
        const set = await M.Set.findById(slug).select('tirage region').lean();
        if (!set) { refus('refuse-set', 'set absent de la base'); continue; }
        if ((set.tirage ?? set.region) !== SRC.TIRAGE) { refus('refuse-set', `tirage ${set.tirage ?? set.region} en base : la source ne sert que des cartes du tirage ${SRC.TIRAGE}`); continue; }
        const st = await db.command({ dbStats: 1 });
        if (st.dataSize + st.indexSize > stopOctets) { refus('refuse-taille-base', 'base au-delà de 400 Mo'); continue; }
        const idEtat = basseDefinition ? `${SRC.SOURCE}-basse/${slug}` : SRC.idEtat(slug);       // (le lot basse définition a son état et son bilan : il ne recouvre pas ceux du lot des `ok`)
        const verrouSet = fabriquerVerrouSet ? fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat }) : null;
        if (verrouSet) { const tenu = await verrouSet.prendre(); if (tenu) { resultats.push({ code: slug, etat: 'refuse-verrou' }); continue; } }
        try {
            let deposees = 0, sautees = 0, joints = 0, cedeesDuSet = 0, dejaPoseesDuSet = 0, remplacees = 0, cartesAbsentes = 0, erreurJointure = null;
            const carteIds = [...new Set(unitesDuSet.map(p => p.u.carteId))];
            const avant = await compterEntrees(db, carteIds, slug, SRC);
            const retirees = [];
            const ecrits = [], orphelinsDuSet = [];
            let enCours = null;       // la clé R2 d'un objet DÉPOSÉ dont la jointure n'est pas finie : s'il reste en cours à l'échec, c'est un ORPHELIN
            try {
                for (const p of unitesDuSet) {
                    enCours = null;
                    const { u, _id, octets, ix } = p;
                    const le = new Date(), collecteLe = p.collecteLe ? new Date(p.collecteLe) : le;          // D4 : la date du téléchargement, lue au cache
                    const webp = await sharp(octets).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                    const cle = SRC.cleR2(slug, u.numero, u.carteId);
                    const meta = { cleR2: cle, sha256: sha('sha256', webp.data), w: webp.info.width, h: webp.info.height, fmt: 'webp', wOriginal: ix.w, hOriginal: ix.h };
                    const dejaDoc = await M.Image.findById(_id).select('sha256 etat').lean();
                    if (dejaDoc?.etat === 'ok' && dejaDoc.sha256 === meta.sha256) sautees++;
                    else { await deposer(bucket, cle, webp.data, 'image/webp'); deposees++; enCours = cle; }
                    const doc = documentImage(SRC, u, meta, le, collecteLe);
                    const { _id: _omis, ...champs } = doc;
                    await M.Image.updateOne({ _id }, { $set: champs }, { upsert: true });
                    ecrits.push(_id);
                    // la jointure : la règle COMMUNE décide (remplacer une basse définition / une image empruntée, jamais une image correcte)
                    const c = await M.Carte.findById(u.carteId).select('images').lean();
                    if (!c) { cartesAbsentes++; continue; }
                    const documents = await documentsDesEntrees(M, c.images);
                    const entree = entreeDeCarte(SRC, u, meta, le, collecteLe);
                    const cand = candidatDe(SRC, u, entree);
                    const d = CT.decisionEcriture(c.images || [], cand, { documents });
                    if (d.action === 'cede') { cedeesDuSet++; if (enCours) { orphelinsDuSet.push(enCours); orphelins.push(enCours); } enCours = null; continue; }      // déposé puis cédé (course avec un autre écrivain) : l'objet est orphelin, listé
                    if (d.action === 'deja-posee') { dejaPoseesDuSet++; continue; }       // D5 : une entrée déjà là n'est pas une jointure de CE passage
                    if (d.remplace.length) {
                        // D1 : ce que le lot remplace est GARDÉ tel quel sur son document (les entrées, vignette comprise, et l'état de leurs documents) AVANT de sortir de la carte : c'est ce que le retrait remet
                        await M.Image.updateOne({ _id }, { $set: { remplaceEntrees: d.remplace, remplaceDocuments: d.remplace.map(e => { const dd = documents.get(cleDocument(e)); return { source: e.source, set: e.set, cleR2: e.cleR2, etat: dd?.etat ?? null, remplacePar: dd?.remplacePar ?? null, remplaceLe: dd?.remplaceLe ?? null }; }) } });
                        for (const e of d.remplace) retirees.push(cleEntree(u.carteId, e));
                        remplacees += await remplacerBasseDefinition(M, u.carteId, cand, { documents });
                    }
                    await M.Carte.updateOne({ _id: u.carteId }, { $pull: { images: { set: slug, source: SRC.SOURCE, numero: u.numero ?? null } } });
                    await M.Carte.updateOne({ _id: u.carteId }, { $push: { images: entree } });
                    joints++;
                    enCours = null;
                }
            } catch (e) {
                erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`);
                if (enCours) { orphelinsDuSet.push(enCours); orphelins.push(enCours); console.error(`🔴 objet R2 ORPHELIN (déposé, jamais joint) : ${enCours}`); }
            }
            const apres = await compterEntrees(db, carteIds, slug, SRC);
            const attenduesAutres = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');
            // (mode basse définition : les entrées de la source déjà posées par le lot des `ok` sur ces cartes restent ; on compare l'AJOUT de ce passage)
            // D5 : les entrées du lot déjà posées sur ces cartes (reprise d'un lot partiel, carte à deux numéros du même set) comptent « avant » dans les DEUX modes
            const garde = attenduesAutres === apres.autres && apres.siennes === avant.siennes + joints;
            const W = await vignetter(db, slug, { bucket, arreter: () => false });
            const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
            const complet = { vignettes: W.vg, lot: SRC.LOT, unites: unitesDuSet.length, deposees, sautees, joints, cedees: cedeesDuSet, dejaPosees: dejaPoseesDuSet, remplacees, cartesAbsentes, orphelins: orphelinsDuSet, garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attenduesAutres === apres.autres, siennesApres: apres.siennes, ok: garde }, erreurJointure,
                concordance: garde && !erreurJointure && vignettesOk && cartesAbsentes === 0, verifieLe: new Date() };
            await M.Set.updateOne({ _id: slug }, { $set: { [basseDefinition ? `${SRC.CHAMP_BILAN}Basse` : SRC.CHAMP_BILAN]: complet } });
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), bilan: complet } }, { upsert: true });
            console.log(`   ${slug} : unités ${unitesDuSet.length} · déposées ${deposees} · reprises ${sautees} · joints ${joints} · cédées ${cedeesDuSet} · remplacées ${remplacees} · garde ${garde ? '✅' : '❌'} · requêtes 0`);
            resultats.push({ code: slug, etat: erreurJointure ? 'incomplet' : !garde ? 'non-concordant' : complet.concordance ? 'verifie' : 'incomplet', ...complet });
        } finally { if (verrouSet) await verrouSet.rendre(); }
    }
    const code = resultats.every(r => r.etat === 'verifie') && !horsCache && !altere ? 0 : 1;
    if (orphelins.length) console.error(`🔴 ${orphelins.length} objet(s) R2 orphelin(s) : ${orphelins.join(' ; ')} — une relance les reprend (même clé), sinon --effacer-r2 du retrait`);
    return { code, resultats, attendu: attendu ?? reel, reel, unitesAAjouter: reel, horsCache, altere, ecartees, cedees, dejaPosees, tropPetits, retires, orphelins };
}

// ── 4. LA LECTURE D'UN SET (lecture seule) ───────────────────────────────────────────────────────────────────────────────────
const LS = require('./lecture-sure');
/**
 * Un set de notre base, ses produits joints et leurs cartes. Gardes écrites par ce qu'elles AUTORISENT : le set existe, son tirage et (si la table le dit) son code sont ceux attendus,
 * il porte des produits joints, et chaque carte jointe est lue (`lecture-sure` : un zéro sur une population non vide est une clé fausse, pas une absence).
 * @returns {{refus: string}|{set: object, lignes: object[], cartes: Map<number, object>}}
 */
async function lireSet(db, slug, { tirage, code = null, impressions = false } = {}) {
    const set = await db.collection('sets').findOne({ _id: slug }, { projection: { tirage: 1, region: 1, code: 1, nomAffichage: 1 } });
    if (!set) return { refus: `set ${slug} absent de la base` };
    if ((set.tirage ?? set.region) !== tirage) return { refus: `tirage ${set.tirage ?? set.region} en base, ${tirage} attendu` };
    if (code && set.code !== code) return { refus: `code ${set.code} en base, ${code} dans la table` };
    let lignes;
    try { lignes = await LS.lireMongo(db.collection('cartes_produits'), { slugSet: slug }, { nom: 'cartes_produits', projection: { carteId: 1, idProduct: 1, numeroFiche: 1, slug: 1, preuve: 1 } }); }
    catch (e) { return { refus: `aucun produit joint au set ${slug} (${e.message.split('\n')[0]})` }; }
    const ids = [...new Set(lignes.map(l => l.carteId))];
    const docs = await db.collection('cartes').find({ _id: { $in: ids } }).project({ nomEn: 1, niveau: 1, attaques: 1, images: 1, categorie: 1, ...(impressions ? { impressions: 1 } : {}) }).toArray();
    LS.apparier(ids, docs.map(c => c._id), { gauche: 'cartes_produits.carteId', droite: 'cartes._id', cle: '_id' });
    LS.champSur(docs, 'nomEn', { collection: `cartes du set ${slug}`, videAutorise: 'les cartes sans nom (Énergies) existent ; le plan les range en « sans-nom »' });
    return { set, lignes, cartes: new Map(docs.map(c => [c._id, c])) };
}
/** Les produits d'un set tels que le plan les lit : une ligne = un produit joint à une carte. Un produit joint à PLUSIEURS cartes n'en désigne aucune. */
function produitsDuSet({ lignes, cartes }) {
    return lignes.map(l => { const c = cartes.get(l.carteId); return { carteId: l.carteId, idProduct: l.idProduct, numeroFiche: l.numeroFiche ?? null, slug: l.slug ?? null, carteNom: c?.nomEn ?? null, carte: c ? { _id: c._id, nomEn: c.nomEn, niveau: c.niveau, attaques: c.attaques, ...(c.impressions ? { impressions: c.impressions } : {}) } : null }; });
}

module.exports = { lireSet, produitsDuSet, fabriquerSource, controleLargeur, juger, jugementDe, telecharger, planches, choisirEchantillon, decider, lecteurNatif, lecteurModeles, entreeDeCarte, documentImage, candidatDe, ecrire, compterEntrees,
    verifierChemin, lireJson, ecrireJson, cleNum, MENTION, STOP_OCTETS, RATIO_MIN, RATIO_MAX };
