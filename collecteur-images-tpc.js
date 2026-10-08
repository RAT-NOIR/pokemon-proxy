// ============================================================
// COLLECTEUR D'IMAGES — sources officielles The Pokémon Company -> R2 (WebP) + base `cartes` (2026-10-07, soir)
// ============================================================
//   node collecteur-images-tpc.js --plan [--sets=<slug>,…]   le plan sur les fiches DÉJÀ LUES (cache `tpc_fiches`) : zéro requête
//   node collecteur-images-tpc.js --verrou                   qui tient les verrous globaux TPC, lecture seule
//   (la collecte elle-même : le worker, `collecteur-images.js --boucle`, unités `source: 'tpc-asie' | 'pokemon-card-com'`, que
//    l'alimentateur enfile depuis collecte-cartes/tpc-sets.js)
//
// ⛔ LE WORKER RENDER EST LE SEUL COLLECTEUR : aucune option de ce fichier ne télécharge en local.
//
// 🔑 DÉCISION DE L'ÉDITEUR (2026-10-07, soir) : TPC Asie et pokemon-card.com ouverts pour combler les visuels MANQUANTS, impression
// exacte seulement ; TPC Chine fermé. Toutes les règles vivent dans collecte-cartes/tpc.js ; ce fichier les enchaîne. Par set (une
// unité `<site>/<slug>`, qui porte `slugSet`, `code`, `langue` — la ligne de collecte-cartes/tpc-sets.js, mot pour mot) :
//   0. GARDES, par ce qu'elles AUTORISENT : la ligne de table, le set en base au bon tirage, la source pas bloquée, la base sous 400 Mo
//      (plafond M0 : 512 Mo — consigne : « au-delà de 400 Mo, STOP »). Tout le reste refuse, et dit pourquoi.
//   1. LA LISTE filtrée par la source elle-même (`expansionCodes` / `pg`), page par page — reprise : gardée 30 jours.
//   2. LES FICHES, une requête chacune, gardées pour toujours (`tpc_fiches`) : un rejeu du plan ne coûte aucune requête.
//   3. LES TROUS : nos produits joints dont la carte n'a AUCUN visuel à ce numéro dans ce set (additif : rien d'existant n'est touché).
//   4. LE PLAN : numéro + nom + set (planifierTpc) ; un doute est un trou, et son motif s'écrit.
//   5. TÉLÉCHARGEMENT (cadence 10 s, verrou lié au client), seuil de largeur, WebP -> R2 AVANT la ligne `images`, qui porte la source,
//      la fiche, la preuve, la langue, la MENTION « © Pokémon / The Pokémon Company » et le LOT (retirable en un seul geste).
//   6. JOINTURE ADDITIVE, sous sa garde : les entrées des autres sources ne bougent pas — comptées avant et après.
require('dotenv').config();
const crypto = require('crypto');
const sharp = require('sharp');
const r2 = require('./collecte-cartes/r2');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { largeurMinDe, aRejuger, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { echecTransitoire } = require('./collecte-cartes/issue-unite');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const T = require('./collecte-cartes/tpc');
const { TABLE_TPC, ligneTpc } = require('./collecte-cartes/tpc-sets');

const VERROU_SET_MS = 10 * 60 * 1000;
const LISTE_VALIDE_MS = 30 * 24 * 3600 * 1000;
const PAGES_MAX = 60;                                  // 1 200 cartes TPC Asie, 2 000 pokemon-card.com : au-delà, une boucle, pas un set
const STOP_OCTETS = 400 * 1024 * 1024;                 // consigne de l'éditeur : au-delà de 400 Mo (plafond M0 512), STOP
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';
const { idAlerteBloquee } = T;

let arretDemande = false;
process.on('SIGINT', () => { arretDemande = true; });
process.on('SIGTERM', () => { arretDemande = true; });
const surPerte = () => { arretDemande = true; process.exitCode = 1; };

/** La garde de l'unité, pure : la ligne de table, MOT POUR MOT. `ligneDe` n'est injecté que par le banc. */
function releve(unite, ligneDe = ligneTpc) {
    const site = unite?.source;
    if (!T.SITES[site]) return { ok: false, etat: 'refuse-source', motif: `source « ${site} » : pas une source TPC` };
    const L = ligneDe(site, unite.slugSet);
    if (!L) return { ok: false, etat: 'refuse-table', motif: `${site} / ${unite.slugSet} absent de collecte-cartes/tpc-sets.js` };
    if (unite.code !== L.code || unite.langue !== L.langue) return { ok: false, etat: 'refuse-table', motif: `l'unité porte ${unite.code}/${unite.langue}, la table ${L.code}/${L.langue}` };
    return { ok: true, L, langueImage: T.SITES[site].langues[L.langue] };
}

const urlListe = (site, L, page) => site === 'tpc-asie'
    ? `/${L.langue}/card-search/list/?${page > 1 ? `pageNo=${page}&` : ''}expansionCodes=${encodeURIComponent(L.code)}`
    : `/card-search/resultAPI.php?keyword=&se_ta=&regulation_sidebar_form=all&pg=${encodeURIComponent(L.code)}&illust=&sm_and_keyword=true&page=${page}`;
const urlFiche = (site, L, id) => site === 'tpc-asie' ? `/${L.langue}/card-search/detail/${id}/` : `/card-search/details.php/card/${id}/regu/all`;

/** 1. La liste, page par page, ou celle qu'on a déjà (complète, de moins de 30 jours). */
async function lireListe(db, client, site, L, idEtat) {
    const E = db.collection('collecte_images_etat');
    const deja = (await E.findOne({ _id: idEtat }, { projection: { liste: 1 } }))?.liste;
    if (deja?.complete && deja.code === L.code && deja.langue === L.langue && Date.now() - new Date(deja.luLe) < LISTE_VALIDE_MS) return { ...deja, reprise: true };
    const ids = [];
    let total = null, pages = null;
    for (let p = 1; ; p++) {
        if (p > PAGES_MAX) throw new Error(`${L.code} : plus de ${PAGES_MAX} pages — une boucle, pas un set`);
        if (site === 'tpc-asie') {
            const h = await client.page(urlListe(site, L, p));
            if (h == null) break;
            const x = T.lireListeAsie(h);
            if (p === 1) { total = x.total; pages = x.pages; }
            for (const id of x.ids) if (!ids.includes(id)) ids.push(id);
            if (!x.ids.length || (pages && p >= pages)) break;
        } else {
            const j = await client.json(urlListe(site, L, p));
            if (j == null) break;
            const x = T.lireApiPcc(j);
            if (p === 1) { total = x.total; pages = x.pages; }
            for (const c of x.cartes) if (!ids.includes(c.id)) ids.push(c.id);
            if (!x.cartes.length || (pages && p >= pages)) break;
        }
    }
    const liste = { code: L.code, langue: L.langue, ids, total, pages, complete: total != null && ids.length === total, luLe: new Date() };
    await E.updateOne({ _id: idEtat }, { $set: { liste } }, { upsert: true });
    return liste;
}

/** 2. Les fiches : celles du cache, et les autres lues une fois. */
async function lireFiches(db, client, site, L, ids, { compter }) {
    const F = db.collection('tpc_fiches');
    const cle = id => `${site}/${L.langue}/${id}`;
    const connues = new Map((await F.find({ _id: { $in: ids.map(cle) } }).toArray()).map(d => [d._id, d]));
    const fiches = [];
    for (const id of ids) {
        if (arretDemande) break;
        let d = connues.get(cle(id));
        if (!d) {
            if (!client) continue;                              // --plan : le cache seulement
            const h = await client.page(urlFiche(site, L, id));
            if (h == null) { compter('fiche-404'); continue; }
            const fiche = site === 'tpc-asie' ? T.lireFicheAsie(h) : T.lireFichePcc(h);
            d = { _id: cle(id), site, langue: L.langue, idFiche: id, url: `${T.SITES[site].hote}${urlFiche(site, L, id)}`, fiche, luLe: new Date() };
            await F.updateOne({ _id: d._id }, { $set: d }, { upsert: true });
        }
        fiches.push({ ...d.fiche, idFiche: id, urlFiche: d.url });
    }
    return fiches;
}

/** 3-4. Les trous du set, et le plan — pur une fois les fiches lues. */
async function planifier(db, slug, L, fiches) {
    const lignes = await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1 } }).toArray();
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, nomJa: 1, ndex: 1, pv: 1, categorie: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    const trous = lignes.filter(l => cartes.has(l.carteId) && !T.dejaServi(cartes.get(l.carteId), slug, l.numeroFiche)).map(l => ({ carte: cartes.get(l.carteId), numeroFiche: l.numeroFiche ?? null, idProduct: l.idProduct }));
    return { produits: lignes.length, trous: trous.length, ...T.planifierTpc({ trous, fiches, code: L.code, site: L.site }) };
}

/** La garde de la jointure : les entrées des AUTRES sources, chacune par son empreinte (carte, source, set, numéro, clé) — elles ne
 *  doivent pas bouger d'un octet, pas seulement en nombre (relecture du 2026-10-07) ; et le nombre des siennes dans le set. */
async function compterEntrees(db, carteIds, site, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (e?.source !== site) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes };
}

/**
 * @param {object} unite  l'unité de file (`<site>/<slug>`, source, slugSet, code, langue)
 * @param {object} M      les modèles de la base `cartes`
 * @param {object} o      `verrou` : le verrou global du site, LIÉ au client. Les autres options n'existent que pour le banc
 *                        (test-collecteur-tpc.js) : `client`, `deposer` (R2), `fabriquerVerrouSet`, `stopOctets`.
 */
async function collecterSet(unite, M, { verrou, client: clientInjecte = null, deposer = (b, c, d, t) => r2.deposerBinaire(b, c, d, t), fabriquerVerrouSet = fabriquerVerrou, stopOctets = STOP_OCTETS, ligneDe = ligneTpc } = {}) {
    const db = M.Carte.db.db;
    const E = db.collection('collecte_images_etat');
    const G = releve(unite, ligneDe);
    if (!G.ok) { console.error(`❌ ${unite?._id} : ${G.motif}.`); return { code: unite?._id, etat: G.etat, erreur: G.motif, sansJointure: true }; }
    const { L, langueImage } = G;
    const site = L.site, slug = L.slug;
    // la source a-t-elle déjà bloqué ? on ne lui redemande rien (« si une source bloque, on s'arrête »)
    const bloquee = await E.findOne({ _id: idAlerteBloquee(site), active: true });
    if (bloquee) { console.error(`⛔ ${unite._id} : ${site} a bloqué le ${new Date(bloquee.depuis).toISOString()} (${bloquee.motif}) — aucune requête.`); return { code: unite._id, etat: 'refuse-source-bloquee', erreur: bloquee.motif, sansJointure: true }; }
    const set = await M.Set.findById(slug).select('tirage region').lean();
    if (!set) return { code: unite._id, etat: 'refuse-set', erreur: `set ${slug} absent de la base`, sansJointure: true };
    if ((set.tirage ?? set.region) !== L.tirage) return { code: unite._id, etat: 'refuse-set', erreur: `tirage ${set.tirage ?? set.region} en base, ${L.tirage} dans la table`, sansJointure: true };
    // la TAILLE de la base, avant toute requête : au-delà de 400 Mo, STOP, et c'est écrit
    const st = await db.command({ dbStats: 1 });
    if (st.dataSize + st.indexSize > stopOctets) {
        const motif = `base « cartes » à ${Math.round((st.dataSize + st.indexSize) / 1048576)} Mo (données + index) : au-delà de 400 Mo, STOP (plafond M0 512 Mo)`;
        await E.updateOne({ _id: 'alerte/taille-base' }, { $set: { active: true, constateLe: new Date(), motif, donnees: st.dataSize, index: st.indexSize }, $setOnInsert: { depuis: new Date() } }, { upsert: true });
        console.error(`⛔ ${unite._id} : ${motif}.`);
        return { code: unite._id, etat: 'refuse-taille-base', erreur: motif, sansJointure: true };
    }
    // un set sans produit joint n'a rien à combler : ni requête, ni « verifie » (relecture du 2026-10-07 — une clé `slugSet` fausse
    // rendait sinon un succès parfait sur une population vide, §41)
    const produits = await db.collection('cartes_produits').countDocuments({ slugSet: slug });
    if (!produits) return { code: unite._id, etat: 'refuse-set', erreur: `aucun produit joint au set ${slug} (cartes_produits.slugSet)`, sansJointure: true };
    const idEtat = `${site}/${slug}`;
    const verrouSet = fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_SET_MS, surInsertion: { debute: new Date(), phase: 'liste' }, surPerte, nom: `verrou de set ${idEtat}` });
    const tenuPar = await verrouSet.prendre();
    if (tenuPar) { console.error(`❌ ${idEtat} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}.`); return { code: unite._id, etat: 'refuse-verrou' }; }
    const client = clientInjecte || T.fabriquerClientTpc({ site, verrou });
    const compteurs = {};
    const compter = k => { compteurs[k] = (compteurs[k] || 0) + 1; };
    let bloque = null;
    try {
        let liste, fiches;
        try {
            liste = await lireListe(db, client, site, L, idEtat);
            // LE TOTAL DE LA LISTE contre la MESURE de la table (relecture du 2026-10-07) : une source qui ignorerait son filtre rendrait
            // des milliers de cartes d'autres sets, et un dénominateur numérique ne le dirait pas. Hors de [½ ; 2 × + 20] : refus, aucune fiche.
            // sans compte mesuré, la garde ne peut pas conclure : elle REFUSE (une garde ne passe pas par défaut — seconde relecture)
            if (!Number.isFinite(L.cartes) || liste.total == null || liste.total < L.cartes / 2 || liste.total > 2 * L.cartes + 20) {
                const motif = `la liste filtrée rend ${liste.total ?? '?'} cartes pour ${L.code}, la mesure du 2026-10-07 en disait ${L.cartes} : le filtre ne désigne peut-être plus ce set`;
                await E.updateOne({ _id: idEtat }, { $set: { phase: 'refuse-liste', motif } });
                console.error(`❌ ${unite._id} : ${motif}.`);
                return { code: unite._id, etat: 'refuse-liste', erreur: motif, sansJointure: true };
            }
            fiches = await lireFiches(db, client, site, L, liste.ids, { compter });
        } catch (e) { if (!e.bloque) throw e; bloque = e; }
        if (bloque) return await conclureBloque(E, unite, site, bloque, client);
        if (arretDemande || !verrou.tenu) return { code: unite._id, etat: 'interrompu', sansJointure: true };
        const P = await planifier(db, slug, L, fiches);
        const motifs = {}; for (const r of P.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        const voies = {}; for (const x of P.plan) voies[x.voie] = (voies[x.voie] || 0) + 1;
        console.log(`\n══ ${unite._id} → ${site} ${L.langue} ${L.code} : liste ${liste.ids.length}/${liste.total ?? '?'}${liste.reprise ? ' (reprise)' : ''}, ${fiches.length} fiches · ${P.trous} trous sur ${P.produits} produits · PROUVÉS ${P.plan.length} ${JSON.stringify(voies)} · restes ${JSON.stringify(motifs)} ══`);
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'originaux', restes: P.restes.slice(0, 1000), derniereRequete: new Date(), requetes: client.compteRequetes() } });

        // ---- 5. TÉLÉCHARGEMENT --------------------------------------------------------------------
        const bucket = process.env.R2_BUCKET_IMAGES;
        let telecharges = 0, sautes = 0, echecs = 0, echecsTransitoires = 0, tropPetits = 0, retires = 0;
        for (const p of P.plan) {
            if (arretDemande || !verrou.tenu) break;
            const _id = T.idImageTpc(site, slug, p.carteId, p.numero, langueImage);
            const url = p.fiche.image ? new URL(p.fiche.image, T.SITES[site].hote).href : null;
            if (!url) { echecs++; compter('fiche-sans-image'); continue; }
            const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat wOriginal seuilApplique').lean();
            // un visuel RETIRÉ (retirer-visuels-tpc.js) ne revient jamais par une recollecte : il faudrait une décision
            if (deja?.etat === 'retire') { retires++; continue; }
            if (deja?.sha256 && deja.urlOriginal === url && deja.etat === 'ok') { sautes++; continue; }
            // déjà jugé trop petit à la même adresse : on ne le redemande pas (relecture du 2026-10-07) — SAUF si le seuil a baissé
            // depuis et que la largeur gardée n'interdit plus (`aRejuger`, §23) : alors il repasse par la cadence normale du client
            if (deja?.etat === 'trop-petit' && deja.urlOriginal === url && !aRejuger(deja, site)) { tropPetits++; continue; }
            try {
                const buffer = await client.image(url);
                if (!buffer) throw new Error('absent à la source (404)');
                const meta = await sharp(buffer).metadata();
                if (!meta.width || meta.width < largeurMinDe(site)) {
                    tropPetits++;
                    // un visuel DÉJÀ prouvé et servi (« ok ») ne se dégrade pas : l'ancien reste, l'essai est noté à côté (seconde relecture)
                    if (deja?.etat === 'ok') await M.Image.updateOne({ _id }, { $set: { dernierEssai: { le: new Date(), url, resultat: `trop-petit (${meta.width} px)` } } });
                    else await M.Image.updateOne({ _id }, { $set: { source: site, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: url, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: largeurMinDe(site), lot: T.LOT } }, { upsert: true });
                    continue;
                }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = `${site}/${slug}/${cleNum(p.numero)}-${p.carteId}-${langueImage}.webp`;
                await deposer(bucket, cleR2, webp.data, 'image/webp');   // R2 AVANT la ligne
                await M.Image.updateOne({ _id }, {
                    $set: {
                        source: site, set: slug, carteId: p.carteId, numero: p.numero, nomEn: p.nomEn, idProduct: p.idProduct,
                        idFiche: p.fiche.idFiche, urlFiche: p.fiche.urlFiche, nomSource: p.fiche.nom, numeroSource: `${p.fiche.numero}${p.fiche.denominateur ? `/${p.fiche.denominateur}` : ''}`,
                        preuve: p.preuve, voie: p.voie, urlOriginal: url,
                        wOriginal: meta.width, hOriginal: meta.height, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length,
                        cleR2, sha256: sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                        // la langue par LA règle (collecte-cartes/langue-visuel.js), celle qu'un rejeu relira : `langueSource` est le site
                        langueSource: L.langue, ...(({ langue, preuve }) => ({ langue, languePreuve: preuve }))(langueDuVisuel({ source: site, langueSource: L.langue })),
                        attribution: T.MENTION, mention: T.MENTION, lot: T.LOT, telechargeLe: new Date(), etat: 'ok'
                    }, $unset: { erreur: 1 }
                }, { upsert: true });
                telecharges++;
                if (telecharges % 25 === 0) await E.updateOne({ _id: idEtat }, { $set: { derniereRequete: new Date(), requetes: client.compteRequetes() } });
            } catch (err) {
                if (err.bloque) { bloque = err; break; }
                echecs++;
                if (echecTransitoire(err)) echecsTransitoires++;
                console.warn(`   ✗ ${_id} (${url}) : ${err.message}`);
                if (deja?.etat === 'ok') await M.Image.updateOne({ _id }, { $set: { dernierEssai: { le: new Date(), url, resultat: `échec : ${err.message}` } } });
                else await M.Image.updateOne({ _id }, { $set: { source: site, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: url, etat: 'echec', erreur: err.message, lot: T.LOT } }, { upsert: true });
                if (/verrou/.test(err.message)) break;
            }
        }
        if (bloque) await conclureBloque(E, unite, site, bloque, client, { seulementAlerte: true });
        if (!bloque && (arretDemande || !verrou.tenu)) return { code: unite._id, etat: 'interrompu', telecharges };

        // ---- 6. JOINTURE ADDITIVE, sous sa garde ----------------------------------------------------
        const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
        const avant = await compterEntrees(db, carteIds, site, slug);
        const images = await M.Image.find({ source: site, set: slug, etat: 'ok', langue: langueImage, lot: T.LOT }).lean();
        let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null;
        try {
            for (const im of images) {
                const c = await M.Carte.findById(im.carteId).select('images').lean();
                if (!c) { cartesAbsentes++; continue; }            // une image sans sa carte : comptée, elle fait tomber la concordance
                const autres = (c.images || []).filter(e => !(e.source === site && e.set === slug && e.numero === im.numero));
                if (T.dejaServi({ images: autres }, slug, im.numero)) {
                    // une AUTRE source sert ce numéro (posé entre deux passages) : on ne touche pas à son entrée, et la nôtre, s'il y en avait une,
                    // lui CÈDE la place — deux visuels pour une impression, c'est un de trop
                    dejaParAutre++;
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: site, numero: im.numero } } });
                    continue;
                }
                const entree = { set: slug, source: site, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, urlFiche: im.urlFiche, preuve: im.preuve,
                    numero: im.numero, attribution: T.MENTION, mention: T.MENTION, lot: T.LOT, langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date() };
                await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: site, numero: im.numero } } });
                await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                joints++;
            }
        } catch (e) {
            // une exception PENDANT la jointure (relecture du 2026-10-07) : ce qui est joint l'est, la page doit se revalider — l'unité rend
            // « incomplet » (le worker revalide), jamais une exception qui la ferait passer pour une unité sans jointure
            erreurJointure = e.message;
            console.error(`🔴 ${unite._id} : jointure interrompue — ${e.message}`);
        }
        const apres = await compterEntrees(db, carteIds, site, slug);
        // les entrées des autres sources : les MÊMES, empreinte par empreinte ; les nôtres : celles de ce passage, et rien d'autre
        const garde = avant.autres === apres.autres && apres.siennes === joints;
        if (!garde) console.error(`🔴 ${unite._id} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres}${avant.autres === apres.autres ? '' : ' (CHANGÉES)'}, entrées ${site} ${apres.siennes} pour ${joints} jointes`);
        const fiches404 = compteurs['fiche-404'] || 0;
        const complet = {
            site, langue: L.langue, code: L.code, mention: T.MENTION, lot: T.LOT,
            liste: { lues: liste.ids.length, total: liste.total, complete: liste.complete }, fiches: fiches.length, fiches404, produits: P.produits, trous: P.trous,
            prouves: P.plan.length, voies, restes: motifs, telecharges, sautes, echecs, echecsTransitoires, tropPetits, retires, joints, dejaParAutre, cartesAbsentes,
            garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: avant.autres === apres.autres, tpcApres: apres.siennes, ok: garde }, compteurs,
            requetes: client.compteRequetes(), bloque: bloque ? bloque.message : null, erreurJointure,
            concordance: garde && !erreurJointure && telecharges + sautes + tropPetits + retires === P.plan.length && echecs === 0 && fiches404 === 0 && cartesAbsentes === 0
                && joints + dejaParAutre === images.length && liste.complete && !bloque,
            verifieLe: new Date()
        };
        await M.Set.updateOne({ _id: slug }, { $set: { [`visuelsTpc.${site}`]: complet } });
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: client.compteRequetes(), bilan: complet } });
        console.log(`   ${site} ${slug} : prouvés ${P.plan.length} · téléchargés ${telecharges} · repris ${sautes} · sous le seuil ${tropPetits} · échecs ${echecs} · joints ${joints} · garde ${garde ? '✅' : '❌'} · requêtes ${client.compteRequetes()}`);
        // bloquée en cours de route : ce qui a été prouvé et téléchargé AVANT est joint (et la page se revalide) ; l'unité refuse (`incomplet`),
        // l'alerte est écrite, l'alimentateur n'enfile plus ce site
        if (bloque) return { code: unite._id, etat: 'incomplet', erreur: bloque.message, ...complet };
        if (erreurJointure) return { code: unite._id, etat: 'incomplet', erreur: erreurJointure, ...complet };
        if (!garde) return { code: unite._id, etat: 'non-concordant', ...complet };
        const transitoire = !complet.concordance && echecs > 0 && echecs === echecsTransitoires;
        return { code: unite._id, etat: complet.concordance ? 'verifie' : transitoire ? 'incomplet-transitoire' : 'incomplet', ...complet };
    } finally {
        await verrouSet.rendre();
    }
}

/** Une source qui bloque : l'ALERTE s'écrit (lue par file-a-l-arret.js et par l'alimentateur, qui n'enfile plus ce site), on s'arrête. */
async function conclureBloque(E, unite, site, err, client, { seulementAlerte = false } = {}) {
    await E.updateOne({ _id: idAlerteBloquee(site) }, { $set: { active: true, constateLe: new Date(), motif: err.message, status: err.status ?? null, unite: unite._id, requetes: client.compteRequetes() }, $setOnInsert: { depuis: new Date() } }, { upsert: true });
    console.error(`⛔ ${unite._id} : ${err.message}`);
    if (seulementAlerte) return null;
    return { code: unite._id, etat: 'refuse-source-bloquee', erreur: err.message, sansJointure: true };
}

module.exports = { collecterSet, releve, planifier, idAlerteBloquee, STOP_OCTETS, TABLE_TPC };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE : le worker importe `collecterSet`.
if (require.main !== module) return;

const AUTORISES = [/^--plan$/, /^--verrou$/, /^--sets=[^,\s][^\s]*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length || !process.argv.slice(2).some(a => a === '--plan' || a === '--verrou')) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}autorisés : --plan [--sets=slug,…], --verrou. La collecte est celle du worker.`);
    process.exit(2);
}
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const E = cx.db.collection('collecte_images_etat');
    if (process.argv.includes('--verrou')) {
        for (const site of T.SOURCES_TPC) {
            const v = (await E.findOne({ _id: T.SITES[site].verrou }))?.verrou;
            const b = await E.findOne({ _id: idAlerteBloquee(site), active: true });
            console.log(`${site} : ${v ? `🔒 pid ${v.pid} sur ${v.hote}, commit ${v.commit}, battement il y a ${Math.round((Date.now() - new Date(v.depuis)) / 1000)} s` : 'libre'}${b ? ` · ⛔ BLOQUÉ depuis ${new Date(b.depuis).toISOString()} : ${b.motif}` : ''}`);
        }
        await fermer(); return;
    }
    const voulus = process.argv.find(a => a.startsWith('--sets='))?.slice(7).split(',');
    let trous = 0, prouves = 0, lues = 0;
    for (const L of TABLE_TPC.filter(l => !voulus || voulus.includes(l.slug))) {
        const liste = (await E.findOne({ _id: `${L.site}/${L.slug}` }))?.liste;
        if (!liste) { console.log(`${L.site.padEnd(17)} ${L.slug.padEnd(42)} liste jamais lue`); continue; }
        const fiches = await lireFiches(cx.db, null, L.site, L, liste.ids, { compter: () => { } });
        const P = await planifier(cx.db, L.slug, L, fiches);
        trous += P.trous; prouves += P.plan.length; lues += fiches.length;
        const motifs = {}; for (const r of P.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`${L.site.padEnd(17)} ${L.slug.padEnd(42)} fiches ${fiches.length}/${liste.ids.length} · trous ${P.trous} · prouvés ${P.plan.length} · ${JSON.stringify(motifs)}`);
    }
    console.log(`\nPLAN (cache seulement, 0 requête) : ${prouves} prouvés sur ${trous} trous · ${lues} fiches en cache`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
