// ============================================================
// COLLECTEUR D'IMAGES « ctr » (lot CARDTRADER, phase 2, 2026-10-18) — WCD, Prize Packs, Battle Academy : l'image de l'IMPRESSION EXACTE
// ============================================================
//   node collecteur-images-cardtrader.js --plan                         (lecture seule : le lot après exclusions, la décision d'écriture de chaque unité -> lot.json)
//   node collecteur-images-cardtrader.js --releve --plafond=<N>         (les pages des blueprints du lot : 1 requête chacune, réduites au cache -> releves.json)
//   node collecteur-images-cardtrader.js --telecharger --plafond=<N>    (les images : vraie image, largeur >= 350, sinon `trop-petit` avec sa largeur -> images.json)
//   node collecteur-images-cardtrader.js --planche --echantillon=50     (planches étiquetées, au moins 15 « clé seule » : À REGARDER avant d'écrire)
//   node lot-additif.js --quoi="CTR : N images" --collections=cartes,images -- node collecteur-images-cardtrader.js --ecrire --attendu=N
//
// Toute requête passe par collecte-cartes/cardtrader.js (client) -> collecte-cartes/reponse-hote.js (règle commune) : robots.txt relu, >= 6 s entre deux requêtes, un seul flux, redirections
// jamais suivies, arrêt DÉFINITIF sur 401/403/410/429/défi/connexion. Le plafond (`--plafond=`) est un TOTAL pour le dossier de cache : une réponse en cache n'est jamais redemandée, et consomme
// le plafond. `--ecrire` ne fait AUCUNE requête (cache seulement) et ne tourne que sous lot-additif.js.
// Le nom de la source n'apparaît jamais dans `source` (ctr), `lot` (ctr-2026-10), une clé R2 (ctr/…) ni une mention.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const CT = require('./collecte-cartes/cardtrader');
const { WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');

const DOSSIER_LOT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\CARDTRADER';
const DOSSIER_CACHE = path.join(DOSSIER_LOT, 'cache-lot');
const STOP_OCTETS = 400 * 1024 * 1024;
const RATIO_MIN = 1.30, RATIO_MAX = 1.50;           // une carte n'est jamais carrée (470x656 = 1,396)
const sha = (algo, b) => require('crypto').createHash(algo).update(b).digest('hex');

/** Aucun chemin vers un dossier d'apports manuels du testeur (règle commune du dépôt). */
function verifierChemin(p) {
    if (/Logo FR|apport-manuel|\\LOGO(\\|$)/i.test(path.resolve(p))) throw new Error(`chemin refusé (dossier d'apports manuels du testeur) : ${p}`);
    return p;
}
const lireJson = (f, defaut) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return defaut; } };
const ecrireJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
const dossierDe = o => ({ cache: verifierChemin(o.cache ?? DOSSIER_CACHE), lot: verifierChemin(o.lot ?? DOSSIER_LOT) });
const nbCache = d => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => /^[0-9a-f]{16}-.*\.json$/.test(f)).length : 0);

/** Un client sous plafond TOTAL : les réponses déjà au cache consomment le plafond. */
function client(dossierCache, plafondTotal) {
    const deja = nbCache(dossierCache);
    return { cli: CT.fabriquerClient({ dossierCache, plafond: Math.max(1, plafondTotal - deja) }), deja, restant: plafondTotal - deja };
}
const arretDe = e => (e.plafond ? 'plafond' : e.arretDefinitif || e.bloque ? 'arret-definitif' : e.pauseHote ? 'pause-hote' : 'interrompu');

// ── 1. LE RELEVÉ des pages ────────────────────────────────────────────────────────────────────────────────────────────────
async function releve({ unites, cli, fichier }) {
    const rel = lireJson(fichier, {});
    const uniques = [...new Map(unites.map(u => [u.blueprint, u])).values()];
    let etat = 'termine', motif = null, lues = 0;
    try {
        await cli.initialiserRobots();
        for (const u of uniques) {
            if (rel[u.blueprint]?.url || rel[u.blueprint]?.refus || rel[u.blueprint]?.absente) continue;
            const r = await cli.lire(u.page, { reduire: h => CT.reduirePage(h, u.page) });
            lues++;
            rel[u.blueprint] = r.status === 404 ? { page: u.page, absente: true } : { page: u.page, ...CT.imageDePage(r.texte, u.page) };
            if (lues % 25 === 0) ecrireJson(fichier, rel);
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    ecrireJson(fichier, rel);
    const v = Object.values(rel);
    return { etat, motif, requetes: cli.requetes(), blueprints: uniques.length, relevees: v.length, avecImage: v.filter(x => x.url).length, refus: v.filter(x => x.refus).length, absentes: v.filter(x => x.absente).length, restantes: uniques.filter(u => !rel[u.blueprint]).length };
}

// ── 2. LE TÉLÉCHARGEMENT des images ───────────────────────────────────────────────────────────────────────────────────────
/** Les octets sont-ils une VRAIE image (format décodable, forme de carte) ? -> { statut: 'ok'|'trop-petit'|'forme-inattendue'|'illisible', w, h, format } */
async function juger(octets) {
    let meta;
    try { meta = await sharp(octets).metadata(); } catch { return { statut: 'illisible' }; }
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || !meta.height) return { statut: 'illisible', format: meta.format };
    const ratio = meta.height / meta.width;
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) return { statut: 'forme-inattendue', w: meta.width, h: meta.height, format: meta.format };
    const c = CT.controleLargeur(meta.width);
    return { statut: c.statut, w: meta.width, h: meta.height, format: meta.format };
}
async function telecharger({ unites, releves, cli, fichier }) {
    const idx = lireJson(fichier, {});
    const urls = [...new Set(unites.map(u => releves[u.blueprint]?.url).filter(Boolean))];
    let etat = 'termine', motif = null;
    try {
        await cli.initialiserRobots();
        for (const url of urls) {
            if (idx[url] && idx[url].statut !== 'transitoire') continue;
            const r = await cli.lireImage(url);
            if (r.absente) { idx[url] = { statut: 'absent' }; continue; }
            const j = await juger(r.octets);
            idx[url] = { ...j, octets: r.octets.length, sha256: r.meta?.sha256 ?? sha('sha256', r.octets) };
            ecrireJson(fichier, idx);
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    ecrireJson(fichier, idx);
    const par = {};
    for (const v of Object.values(idx)) par[v.statut] = (par[v.statut] || 0) + 1;
    return { etat, motif, requetes: cli.requetes(), adresses: urls.length, parStatut: par, restantes: urls.filter(u => !idx[u]).length, tropPetits: Object.entries(idx).filter(([, v]) => v.statut === 'trop-petit').map(([u, v]) => ({ url: u, largeur: v.w })) };
}

// ── 3. LES PLANCHES ───────────────────────────────────────────────────────────────────────────────────────────────────────
const echapper = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function planches({ unites, releves, indexImages, dossierCache, sortieDossier, n = 50 }) {
    const dispo = unites.filter(u => { const url = releves[u.blueprint]?.url; return url && indexImages[url]?.statut === 'ok' && CT.lireDuCache(dossierCache, url); });
    if (!dispo.length) throw new Error('planche : aucune image au cache pour le lot');
    const choix = CT.choisirEchantillon(dispo, n);
    const L = 240, H = 330, B = 66, COL = 5, PAR_PLANCHE = 15;
    const fichiers = [];
    for (let p = 0; p * PAR_PLANCHE < choix.length; p++) {
        const lot = choix.slice(p * PAR_PLANCHE, (p + 1) * PAR_PLANCHE), rangs = Math.ceil(lot.length / COL), tuiles = [];
        for (let i = 0; i < lot.length; i++) {
            const u = lot[i], left = (i % COL) * L, top = Math.floor(i / COL) * (H + B), c = CT.lireDuCache(dossierCache, releves[u.blueprint].url);
            tuiles.push({ input: await sharp(c.octets).resize(L, H, { fit: 'fill' }).png().toBuffer(), left, top });
            const seule = CT.estCleSeule(u);
            const l1 = u.slugCM ?? '?', l2 = `${u.carteNom ?? '?'} · n°${u.numero ?? '—'}`, l3 = `${u.groupe} · ${seule ? 'CLÉ SEULE' : 'témoin ok'} · bp ${u.blueprint}`;
            tuiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${B}"><rect width="${L}" height="${B}" fill="#fff"/><text x="4" y="16" font-family="Arial" font-size="13" fill="#000">${echapper(l1.slice(0, 36))}</text><text x="4" y="34" font-family="Arial" font-size="13" fill="#000">${echapper(l2.slice(0, 36))}</text><text x="4" y="53" font-family="Arial" font-size="13" fill="${seule ? '#c00' : '#060'}">${echapper(l3.slice(0, 38))}</text></svg>`), left, top: top + H });
        }
        const f = path.join(sortieDossier, `planche-${p + 1}.png`);
        fs.mkdirSync(sortieDossier, { recursive: true });
        await sharp({ create: { width: L * COL, height: (H + B) * rangs, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(tuiles).png().toFile(f);
        fichiers.push(f);
    }
    ecrireJson(path.join(sortieDossier, 'planche.json'), choix.map(u => ({ blueprint: u.blueprint, famille: u.famille, groupe: u.groupe, slugCM: u.slugCM, carteNom: u.carteNom, numero: u.numero, cleSeule: CT.estCleSeule(u), page: u.page, image: releves[u.blueprint].url })));
    return { images: choix.length, cleSeule: choix.filter(CT.estCleSeule).length, parFamille: choix.reduce((m, u) => (m[u.famille] = (m[u.famille] || 0) + 1, m), {}), planches: fichiers };
}

// ── 4. L'ÉCRITURE, depuis le cache seulement ──────────────────────────────────────────────────────────────────────────────
const cleEntree = (carteId, e) => `${carteId}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`;
const duLot = e => e?.source === CT.SOURCE && e.lot === CT.LOT;
const cleDocument = e => `${e?.source}|${e?.set}|${e?.cleR2}`;
async function compterEntrees(db, carteIds, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = []; let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!duLot(e)) autres.push(cleEntree(c._id, e)); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}
const candidatDe = (u, entree) => ({ set: u.slugSet, numero: u.numero, langue: 'en', source: CT.SOURCE, cleR2: entree.cleR2, wOriginal: entree.wOriginal, ...(entree.basseDefinition ? { basseDefinition: true } : {}), ...(entree.tampon ? { tampon: entree.tampon } : {}) });

/** La décision de chaque unité sur l'état de la base (lecture seule). `M` : modèles de la base `cartes`. */
async function decider(unites, M, { cleR2 = CT.cleR2 } = {}) {
    const ids = [...new Set(unites.map(u => u.carteId))];
    const cartes = new Map((await M.Carte.find({ _id: { $in: ids } }).select('images').lean()).map(c => [c._id, c]));
    const docs = await M.Image.find({ carteId: { $in: ids } }).lean();
    const documents = new Map(); for (const d of docs) { const k = cleDocument(d); if (!documents.has(k) || d.etat === 'ok') documents.set(k, d); }
    return unites.map(u => {
        const c = cartes.get(u.carteId);
        if (!c) return { ...u, decision: { action: 'cede', raison: 'carte introuvable en base', remplace: [] } };
        const cle = cleR2(u.slugSet, u.numero, u.carteId);
        return { ...u, cleR2: cle, decision: CT.decisionEcriture(c.images || [], candidatDe(u, { cleR2: cle, wOriginal: 500, tampon: CT.tamponDeLaFamille(u.slugSet) }), { documents }) };
    });
}

async function ecrire(unites, M, { dossierCache, releves, indexImages, attendu = null, deposer, vignetter, fabriquerVerrouSet = null, stopOctets = STOP_OCTETS } = {}) {
    if (typeof deposer !== 'function' || typeof vignetter !== 'function') throw new Error('ecrire : deposer et vignetter sont exigés');
    const db = M.Carte.db.db;
    const decidees = await decider(unites, M);
    const prets = [];
    let horsCache = 0, altere = 0, retires = 0, cedees = 0, tropPetits = 0;
    for (const u of decidees) {
        if (u.decision.action === 'cede') { cedees++; continue; }
        const url = releves[u.blueprint]?.url, ix = indexImages[url];
        if (!url || !ix) { horsCache++; continue; }
        if (ix.statut === 'trop-petit') { tropPetits++; continue; }
        if (ix.statut !== 'ok') { horsCache++; continue; }
        const c = CT.lireDuCache(dossierCache, url);
        if (!c) { horsCache++; continue; }
        if (sha('sha256', c.octets) !== ix.sha256) { altere++; console.error(`❌ cache altéré (sha256) : ${url}`); continue; }
        const _id = CT.idImage(u.slugSet, u.carteId, u.numero);
        const deja = await M.Image.findById(_id).select('etat').lean();
        if (deja?.etat === 'retire') { retires++; continue; }
        prets.push({ u: { ...u, url }, _id, octets: c.octets, ix });
    }
    const reel = prets.length;
    if (attendu != null && attendu !== reel) {
        console.error(`❌ --attendu=${attendu} mais ${reel} image(s) à écrire (hors cache ${horsCache}, altérées ${altere}, retirées ${retires}, trop petites ${tropPetits}, cédées ${cedees}) — rien n'est écrit.`);
        return { code: 2, etat: 'refuse-attendu', resultats: [], attendu, reel, horsCache, altere };
    }
    const bucket = process.env.R2_BUCKET_IMAGES;
    const resultats = [];
    for (const slug of [...new Set(prets.map(p => p.u.slugSet))]) {
        const unitesDuSet = prets.filter(p => p.u.slugSet === slug);
        const refus = (etat, erreur) => { console.error(`❌ ${slug} : ${erreur}.`); resultats.push({ code: slug, etat, erreur }); };
        const set = await M.Set.findById(slug).select('tirage region').lean();
        if (!set) { refus('refuse-set', 'set absent de la base'); continue; }
        if ((set.tirage ?? set.region) !== 'intl') { refus('refuse-set', `tirage ${set.tirage ?? set.region} en base : la source ne sert que des cartes anglaises`); continue; }
        const st = await db.command({ dbStats: 1 });
        if (st.dataSize + st.indexSize > stopOctets) { refus('refuse-taille-base', 'base au-delà de 400 Mo'); continue; }
        const idEtat = `${CT.SOURCE}/${slug}`;
        const verrouSet = fabriquerVerrouSet ? fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat }) : null;
        if (verrouSet) { const tenu = await verrouSet.prendre(); if (tenu) { resultats.push({ code: slug, etat: 'refuse-verrou' }); continue; } }
        try {
            let deposees = 0, sautees = 0, joints = 0, cedeesDuSet = 0, remplacees = 0, cartesAbsentes = 0, erreurJointure = null;
            const carteIds = [...new Set(unitesDuSet.map(p => p.u.carteId))];
            const avant = await compterEntrees(db, carteIds, slug);
            const retirees = [];
            const ecrits = [];
            try {
                for (const p of unitesDuSet) {
                    const { u, _id, octets, ix } = p;
                    const le = new Date();
                    const webp = await sharp(octets).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                    const cle = CT.cleR2(slug, u.numero, u.carteId);
                    const meta = { cleR2: cle, sha256: sha('sha256', webp.data), w: webp.info.width, h: webp.info.height, fmt: 'webp', wOriginal: ix.w, hOriginal: ix.h };
                    const dejaDoc = await M.Image.findById(_id).select('sha256 etat').lean();
                    if (dejaDoc?.etat === 'ok' && dejaDoc.sha256 === meta.sha256) sautees++;
                    else { await deposer(bucket, cle, webp.data, 'image/webp'); deposees++; }
                    const doc = CT.documentImage(u, meta, le);
                    const { _id: _omis, ...champs } = doc;
                    await M.Image.updateOne({ _id }, { $set: champs }, { upsert: true });
                    ecrits.push(_id);
                    // la jointure : la règle COMMUNE décide (remplacer une basse définition / une image empruntée, jamais une image correcte)
                    const c = await M.Carte.findById(u.carteId).select('images').lean();
                    if (!c) { cartesAbsentes++; continue; }
                    const documents = await require('./collecte-cartes/basse-definition').documentsDesEntrees(M, c.images);
                    const entree = CT.entreeDeCarte(u, meta, le);
                    const cand = candidatDe(u, entree);
                    const d = CT.decisionEcriture(c.images || [], cand, { documents });
                    if (d.action === 'cede') { cedeesDuSet++; continue; }
                    if (d.action === 'deja-posee') { joints++; continue; }
                    if (d.remplace.length) {
                        for (const e of d.remplace) retirees.push(cleEntree(u.carteId, e));
                        remplacees += await require('./collecte-cartes/basse-definition').remplacerBasseDefinition(M, u.carteId, cand, { documents });
                    }
                    await M.Carte.updateOne({ _id: u.carteId }, { $pull: { images: { set: slug, source: CT.SOURCE, numero: u.numero ?? null } } });
                    await M.Carte.updateOne({ _id: u.carteId }, { $push: { images: entree } });
                    joints++;
                }
            } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
            const apres = await compterEntrees(db, carteIds, slug);
            const attenduesAutres = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');
            const garde = attenduesAutres === apres.autres && apres.siennes === joints;
            const W = await vignetter(db, slug, { bucket, arreter: () => false });
            const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
            const complet = { vignettes: W.vg, lot: CT.LOT, unites: unitesDuSet.length, deposees, sautees, joints, cedees: cedeesDuSet, remplacees, cartesAbsentes, garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attenduesAutres === apres.autres, siennesApres: apres.siennes, ok: garde }, erreurJointure,
                concordance: garde && !erreurJointure && vignettesOk && cartesAbsentes === 0, verifieLe: new Date() };
            await M.Set.updateOne({ _id: slug }, { $set: { bilanLotCtr: complet } });
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), bilan: complet } }, { upsert: true });
            console.log(`   ${slug} : unités ${unitesDuSet.length} · déposées ${deposees} · reprises ${sautees} · joints ${joints} · cédées ${cedeesDuSet} · remplacées ${remplacees} · garde ${garde ? '✅' : '❌'} · requêtes 0`);
            resultats.push({ code: slug, etat: erreurJointure ? 'incomplet' : !garde ? 'non-concordant' : complet.concordance ? 'verifie' : 'incomplet', ...complet });
        } finally { if (verrouSet) await verrouSet.rendre(); }
    }
    const code = resultats.every(r => r.etat === 'verifie') && !horsCache && !altere ? 0 : 1;
    return { code, resultats, attendu: attendu ?? reel, reel, horsCache, altere };
}
module.exports = { releve, telecharger, planches, juger, decider, ecrire, client, verifierChemin, DOSSIER_LOT, DOSSIER_CACHE };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

const AUTORISES = [/^--plan$/, /^--releve$/, /^--telecharger$/, /^--planche$/, /^--ecrire$/, /^--plafond=\d{1,5}$/, /^--attendu=\d{1,5}$/, /^--echantillon=\d{1,3}$/, /^--cache=.+$/, /^--lot=.+$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--releve', '--telecharger', '--planche', '--ecrire'].filter(m => args.includes(m));
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
let erreurArgs = null;
if (inconnus.length) erreurArgs = `argument inconnu : ${inconnus.join(' ')}`;
else if (modes.length !== 1) erreurArgs = 'un seul mode parmi --plan, --releve, --telecharger, --planche, --ecrire';
else if ((modes[0] === '--releve' || modes[0] === '--telecharger') && !val('plafond')) erreurArgs = `${modes[0]} exige --plafond=<N> (total pour le dossier de cache)`;
else if (modes[0] === '--ecrire' && !val('attendu')) erreurArgs = '--ecrire exige --attendu=<N>';
else if (val('attendu') && modes[0] !== '--ecrire') erreurArgs = '--attendu ne va qu\'avec --ecrire';
else if (val('echantillon') && modes[0] !== '--planche') erreurArgs = '--echantillon ne va qu\'avec --planche';
else if (val('plafond') && !['--releve', '--telecharger'].includes(modes[0])) erreurArgs = '--plafond ne va qu\'avec --releve ou --telecharger';
if (erreurArgs) { console.error(`❌ ${erreurArgs}`); process.exitCode = 2; return; }

(async () => {
    const mode = modes[0];
    const D = dossierDe({ cache: val('cache'), lot: val('lot') });
    const fLot = path.join(D.lot, 'lot.json'), fReleves = path.join(D.lot, 'releves.json'), fImages = path.join(D.lot, 'images.json');
    if (mode === '--plan') {
        const plan = lireJson(path.join(D.lot, 'plan.json'), null);
        if (!plan?.produits?.length) throw new Error(`${path.join(D.lot, 'plan.json')} absent ou vide : lancer plan-cardtrader.js --plan d'abord`);
        const lot = CT.construireLot(plan.produits);
        const raisons = {}; for (const e of lot.exclus) { const k = `${e.groupe.split(' ')[0]}:${e.raison}`; raisons[k] = (raisons[k] || 0) + 1; }
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { modeles } = require('./collecte-cartes/schemas');
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        try {
            const decidees = await decider(lot.unites, modeles(cx));
            const actions = {}; for (const u of decidees) { const k = `${u.famille}:${u.decision.action}`; actions[k] = (actions[k] || 0) + 1; }
            const aFaire = decidees.filter(u => u.decision.action === 'ajouter');
            const blueprints = new Set(aFaire.map(u => u.blueprint));
            const parFamille = { wcd: 0, pp: 0, ba: 0 }; for (const u of aFaire) parFamille[u.famille]++;
            const cleSeule = aFaire.filter(CT.estCleSeule).length;
            const pagesAuCache = new Set(aFaire.filter(u => fs.existsSync(path.join(D.cache, CT.nomCache(u.page)))).map(u => u.blueprint));
            const doc = { le: new Date().toISOString(), regle: 'appariés sans réserve, avec carte jointe ; exclus : à réserve, ambigu, introuvable, refusé par le témoin, sans carte, conflit',
                produitsDuPlan: plan.produits.length, unitesAvantDecision: lot.unites.length, exclus: lot.exclus.length, raisonsDExclusion: raisons, decisions: actions, aCollecter: { unites: aFaire.length, parFamille, cleSeule, blueprintsDistincts: blueprints.size },
                estimation: { pagesDejaAuCache: pagesAuCache.size, pagesAFaire: blueprints.size - pagesAuCache.size, images: blueprints.size, requetes: 1 + blueprints.size - pagesAuCache.size + blueprints.size, secondes: (1 + blueprints.size - pagesAuCache.size + blueprints.size) * 6 },
                unites: decidees, exclusList: lot.exclus };
            ecrireJson(fLot, doc);
            const { unites, exclusList, ...resume } = doc;
            console.log(JSON.stringify(resume, null, 1));
        } finally { await fermer(); }
        return;
    }
    const lot = lireJson(fLot, null);
    if (!lot?.unites) throw new Error(`${fLot} absent : lancer --plan d'abord`);
    const aFaire = lot.unites.filter(u => u.decision?.action === 'ajouter');
    if (mode === '--releve') {
        const { cli } = client(D.cache, Number(val('plafond')));
        const r = await releve({ unites: aFaire, cli, fichier: fReleves });
        console.log(`RELEVÉ : ${r.etat} · ${r.requetes} requête(s) ce passage · blueprints ${r.blueprints} · relevés ${r.relevees} (image trouvée ${r.avecImage}, refus ${r.refus}, absents ${r.absentes}) · restants ${r.restantes}${r.motif ? ` · ${r.motif}` : ''}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'plafond' ? 0 : 1;
        return;
    }
    const releves = lireJson(fReleves, {});
    if (mode === '--telecharger') {
        const { cli } = client(D.cache, Number(val('plafond')));
        const r = await telecharger({ unites: aFaire, releves, cli, fichier: fImages });
        console.log(`TÉLÉCHARGEMENT : ${r.etat} · ${r.requetes} requête(s) ce passage · adresses ${r.adresses} · ${JSON.stringify(r.parStatut)} · restantes ${r.restantes}${r.motif ? ` · ${r.motif}` : ''}`);
        if (r.tropPetits.length) console.log(`   trop-petit (largeur < ${CT.controleLargeur(350).largeur}) : ${JSON.stringify(r.tropPetits.slice(0, 20))}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'plafond' ? 0 : 1;
        return;
    }
    const indexImages = lireJson(fImages, {});
    if (mode === '--planche') {
        const r = await planches({ unites: aFaire, releves, indexImages, dossierCache: D.cache, sortieDossier: path.join(D.lot, 'planches'), n: Number(val('echantillon') ?? 50) });
        console.log(`PLANCHES : ${r.images} image(s) dont ${r.cleSeule} « clé seule » · ${JSON.stringify(r.parFamille)} · ${r.planches.join(' ; ')} (à REGARDER avant --ecrire)`);
        return;
    }
    // --ecrire : seulement sous lot-additif.js
    require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const r2 = require('./collecte-cartes/r2');
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
    const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
    if (!process.env.R2_BUCKET_IMAGES) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune écriture');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    try {
        await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
        const r = await ecrire(aFaire, modeles(cx), { dossierCache: D.cache, releves, indexImages, attendu: Number(val('attendu')), deposer: (b, c, d, t) => r2.deposerBinaire(b, c, d, t), vignetter: vignetterApresJointure,
            fabriquerVerrouSet: ({ Modele, id }) => fabriquerVerrou({ Modele, id, dureeMs: 10 * 60 * 1000, surInsertion: { debute: new Date(), phase: 'plan' }, nom: `verrou de set ${id}` }) });
        console.log(`ÉCRITURE : code ${r.code} · attendu ${r.attendu} · réel ${r.reel} · hors cache ${r.horsCache} · altérées ${r.altere} · REQUÊTES 0`);
        process.exitCode = r.code;
    } finally { await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
