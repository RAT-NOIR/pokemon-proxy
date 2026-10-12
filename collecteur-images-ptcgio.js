// ============================================================
// COLLECTEUR D'IMAGES — images.pokemontcg.io -> R2 (WebP) + base `cartes` (2026-10-10)
// ============================================================
//   node collecteur-images-ptcgio.js --plan [--sets=<slug>,…]      la SIMULATION : zéro requête (lecture de la base seulement)
//   node collecteur-images-ptcgio.js --verrou                      qui tient le verrou global, lecture seule
//   node lot-additif.js --quoi="…" --collections=cartes,images,sets,collecte_images_etat -- node collecteur-images-ptcgio.js --ecrire --sets=<slug>,…
//
// ⛔ AUCUNE ÉCRITURE PAR CE FICHIER SANS `--ecrire --sets=…` (jamais « tous ») : l'exécution est LOCALE, sous `lot-additif.js`, lancée par le
// coordinateur — pas d'unité du worker (ruling : rien ne se déploie sans le testeur). Le retrait en un lot : retirer-visuels-ptcgio.js.
//
// Par set (un slug Cardmarket, une ou deux lignes de collecte-cartes/ptcgio.js) :
//   0. GARDES, par ce qu'elles AUTORISENT : le set a une ligne prouvée (un substitut, un set non prouvé : refus sans requête), la source n'est
//      pas bloquée, le set est en base au tirage `intl`, la base sous 400 Mo, des produits joints.
//   1. LES TROUS : nos produits joints dont la carte n'a AUCUN visuel à ce numéro dans ce set (additif : rien d'existant n'est touché).
//   2. LE PLAN : l'adresse du numéro dans la ligne prouvée (plage, suffixe/préfixe) ; un doute est un trou, et son motif s'écrit.
//   3. TÉLÉCHARGEMENT (cadence 3 s, verrou lié) de la haute définition, PNG, seuil de largeur, WebP. Rien n'est écrit avant que les
//      dimensions de TOUS les fichiers du set aient été comparées : un fichier qui n'a pas celles des autres est refusé et nommé.
//   4. R2 AVANT la ligne `images` (source, mention, lot, langue, preuve), puis JOINTURE ADDITIVE sous sa garde.
require('dotenv').config();
const crypto = require('crypto');
const sharp = require('sharp');
const r2 = require('./collecte-cartes/r2');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { largeurMinDe, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { echecTransitoire } = require('./collecte-cartes/issue-unite');
const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');   // les vignettes de 200 px des images neuves, après la jointure (règle du dépôt, 2026-10-06)
const T = require('./collecte-cartes/tpc');
const P = require('./collecte-cartes/ptcgio');
const J = require('./collecte-cartes/jumeau-en');
const { cleNumero } = require('./collecte-cartes/jointure');

const VERROU_SET_MS = 10 * 60 * 1000;
const STOP_OCTETS = 400 * 1024 * 1024;
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';

let arretDemande = false;
process.on('SIGINT', () => { arretDemande = true; });
process.on('SIGTERM', () => { arretDemande = true; });
const surPerte = () => { arretDemande = true; process.exitCode = 1; };

/** Les trous du set et le plan — lecture seule de la base. */
async function planifierSlug(db, slug, numerosCm) {
    if (!(numerosCm instanceof Map) || !numerosCm.size) throw new Error(`${slug} : numéros Cardmarket absents — l'adresse se construit sur le numéro du PRODUIT, jamais sur le numéro de fiche (réimpressions)`);
    const lignes = await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1 } }).toArray();
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    const trous = lignes.filter(l => cartes.has(l.carteId) && !T.dejaServi(cartes.get(l.carteId), slug, l.numeroFiche ?? numerosCm.get(l.idProduct) ?? null))
        .map(l => ({ carte: cartes.get(l.carteId), numeroFiche: l.numeroFiche ?? null, numeroCm: numerosCm.get(l.idProduct) ?? null, idProduct: l.idProduct }));
    return { produits: lignes.length, trous: trous.length, ...P.planifierPtcgio({ slug, trous, tousNumerosCm: P.numerosDuSet(lignes, numerosCm) }) };
}

/** Les numéros des produits Cardmarket du set (`numeros_cartes.numero`, base de production en LECTURE SEULE) : idProduct -> numéro. */
async function numerosCardmarket(prod, slug, db) {
    const ids = (await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { idProduct: 1 } }).toArray()).map(l => l.idProduct);
    const lus = await prod.db.collection('numeros_cartes').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, numero: 1 } }).toArray();
    const m = new Map(lus.filter(x => x.numero != null && String(x.numero).trim() !== '').map(x => [x.idProduct, String(x.numero).trim()]));
    if (ids.length && !lus.length) throw new Error(`${slug} : ${ids.length} produits joints, 0 ligne dans numeros_cartes — une clé fausse, pas une absence (§41)`);
    return m;
}

/**
 * Les entrées des AUTRES sources, empreinte par empreinte (elles ne doivent pas bouger d'un octet) ; et le nombre des nôtres dans le set.
 * ➕ R5 : « les nôtres » = notre source ET le lot de l'appel — un set qui porte le lot additif ET le lot de remplacement ne doit pas faire croire à l'un qu'il a
 * dérangé l'autre ; les entrées d'un autre lot de la même source sont des « autres » et ne doivent pas bouger non plus.
 */
async function compterEntrees(db, carteIds, slug, lot = P.LOT) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!(e?.source === P.SOURCE && e.lot === lot)) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}

/** ➕ R5 — les trous de REMPLACEMENT d'un set (un scan jumeau japonais, aucun autre visuel) et leur plan : lecture seule de la base. */
async function planifierJumeauSlug(db, slug, numerosCm, nomsProuves, tirage) {
    if (!(numerosCm instanceof Map) || !numerosCm.size) throw new Error(`${slug} : numéros Cardmarket absents — l'adresse se construit sur le numéro du PRODUIT, jamais sur le numéro de fiche (réimpressions)`);
    const lignes = await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1 } }).toArray();
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    return J.planifierRemplacement({ slug, tirage, lignes, cartes, numerosCm, nomsProuves });
}

/**
 * ➕ R5 — le témoin du NOM, par TCGdex : les (carte, numéro) dont le set TCGdex de la ligne désigne la même carte, par la fonction de production
 * (`planifier` du collecteur TCGdex = `apparierExpansion` = `temoinDuNom`). CACHE SEULEMENT (client nul) : zéro requête. Il LÈVE quand il ne peut pas conclure.
 * TCGdex n'a pas l'image de ces sets (`tcgdex-sans-image`) mais a le nom : c'est cela qu'on lit, jamais une image.
 */
async function nomsProuvesParTcgdex(M, db, slug) {
    const { TABLE } = require('./collecte-cartes/table-sets');
    const { fabriquerAppariement, setDeLaLigne } = require('./collecte-cartes/tcgdex-cache');
    const { planifier } = require('./collecteur-images-tcgdex');
    const L = TABLE.find(l => l.slugSet === slug && (l.bulba?.tirage || 'intl') === 'intl' && l.bulba?.expansion);
    if (!L) throw new Error(`${slug} : aucune ligne de table au tirage « intl » — le nom ne peut pas être prouvé`);
    const liste = (await db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets;
    if (!liste?.length) throw new Error('liste TCGdex absente du cache : le nom ne peut pas être prouvé');
    const d = setDeLaLigne(L, fabriquerAppariement(liste));
    if (!d.set) throw new Error(`${slug} : ${d.motif}`);
    const Pl = await planifier(M, db, null, L, d.set);
    if (!Pl) throw new Error(`${slug} : cartes TCGdex « ${d.set.id} » absentes du cache`);
    const prouves = new Set();
    for (const x of Pl.plan) prouves.add(J.cleNom(x.carte._id, x.numero));
    for (const r of Pl.restes) if (r.motif === 'tcgdex-sans-image') prouves.add(J.cleNom(r.carteId, r.numero));
    return prouves;
}

/**
 * @param {string} slug  le slug Cardmarket du set (une unité = un set)
 * @param {object} M     les modèles de la base `cartes`
 * @param {object} o     `verrou` : le verrou global, LIÉ au client. Les autres options n'existent que pour le banc (test-ptcgio.js).
 *                       ➕ R5 : `remplacerJumeau` (le MODE REMPLACEMENT : les scans japonais du jumeau sont remplacés par l'anglais prouvé, lot J.LOT_JUMEAU) exige
 *                       `nomsProuves(slug) -> Set` (le témoin du nom, deuxième élément de la preuve) ; sans lui, refus avant toute requête.
 */
async function collecterSlug(slug, M, { verrou, client, lireNumeros, vignetter = vignetterApresJointure, deposer =(b, c, d, t) => r2.deposerBinaire(b, c, d, t), fabriquerVerrouSet = fabriquerVerrou, stopOctets = STOP_OCTETS, remplacerJumeau = false, nomsProuves = null } = {}) {
    const db = M.Carte.db.db;
    const E = db.collection('collecte_images_etat');
    const refus = (etat, erreur) => { console.error(`❌ ${slug} : ${erreur}.`); return { code: slug, etat, erreur, sansJointure: true }; };
    const LOT = remplacerJumeau ? J.LOT_JUMEAU : P.LOT;
    const V = P.verdictDuSet(slug);
    if (V.verdict === 'substitut-interdit') return refus('refuse-substitut', V.motif);
    if (V.verdict !== 'prouve') return refus('refuse-set-non-apparie', V.motif);
    if (typeof lireNumeros !== 'function') return refus('refuse-numeros', 'aucune lecture des numéros Cardmarket fournie : sans elle, l\'adresse ne peut pas se construire');
    if (remplacerJumeau && typeof nomsProuves !== 'function') return refus('refuse-nom', 'le mode remplacement exige le témoin du nom (TCGdex) : sans lui, un remplacement ne se prouve que par la position');
    const bloquee = await E.findOne({ _id: P.ID_ALERTE, active: true });
    if (bloquee) return refus('refuse-source-bloquee', `${P.SOURCE} a bloqué le ${new Date(bloquee.depuis).toISOString()} (${bloquee.motif}) — aucune requête`);
    const set = await M.Set.findById(slug).select('tirage region').lean();
    if (!set) return refus('refuse-set', `set ${slug} absent de la base`);
    if ((set.tirage ?? set.region) !== 'intl') return refus('refuse-set', `tirage ${set.tirage ?? set.region} en base : la source ne sert que des cartes anglaises (tirage « intl »)`);
    const st = await db.command({ dbStats: 1 });
    if (st.dataSize + st.indexSize > stopOctets) {
        const motif = `base « cartes » à ${Math.round((st.dataSize + st.indexSize) / 1048576)} Mo (données + index) : au-delà de 400 Mo, STOP (plafond M0 512 Mo)`;
        await E.updateOne({ _id: 'alerte/taille-base' }, { $set: { active: true, constateLe: new Date(), motif, donnees: st.dataSize, index: st.indexSize }, $setOnInsert: { depuis: new Date() } }, { upsert: true });
        return refus('refuse-taille-base', motif);
    }
    const produits = await db.collection('cartes_produits').countDocuments({ slugSet: slug });
    if (!produits) return refus('refuse-set', `aucun produit joint au set ${slug} (cartes_produits.slugSet)`);
    // ➕ R5 : le témoin du nom se lit AVANT le verrou et avant toute requête ; s'il ne peut pas conclure (cache absent, set non apparié), il LÈVE et rien n'est remplacé
    let noms = null;
    if (remplacerJumeau) {
        try { noms = await nomsProuves(slug); } catch (e) { return refus('refuse-nom', `le témoin du nom n'a pas pu conclure (${e.message})`); }
        if (!(noms instanceof Set)) return refus('refuse-nom', 'le témoin du nom n\'a pas rendu d\'ensemble');
    }
    const idEtat = `${P.SOURCE}/${slug}`;
    const verrouSet = fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_SET_MS, surInsertion: { debute: new Date(), phase: 'plan' }, surPerte, nom: `verrou de set ${idEtat}` });
    const tenuPar = await verrouSet.prendre();
    if (tenuPar) { console.error(`❌ ${idEtat} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}.`); return { code: slug, etat: 'refuse-verrou' }; }
    let bloque = null;
    try {
        const Pl = remplacerJumeau ? await planifierJumeauSlug(db, slug, await lireNumeros(slug), noms, set.tirage ?? set.region) : await planifierSlug(db, slug, await lireNumeros(slug));
        const motifs = {}; for (const r of Pl.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`\n══ ${slug} → ${P.lignesDe(slug).map(l => l.id).join('+')} : ${Pl.trous} ${remplacerJumeau ? 'produits à scan jumeau' : 'trous'} sur ${Pl.produits} produits · PROUVÉS ${Pl.plan.length} · restes ${JSON.stringify(motifs)} ══`);
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'telechargement', [remplacerJumeau ? 'restesJumeau' : 'restes']: Pl.restes.slice(0, 1000), derniereRequete: new Date() } });

        // ---- 3. TÉLÉCHARGEMENT : le WebP est gardé en mémoire, rien n'est écrit avant la comparaison des dimensions ------------------------
        const bucket = process.env.R2_BUCKET_IMAGES;
        let sautes = 0, echecs = 0, echecsTransitoires = 0, tropPetits = 0, retires = 0, absents = 0, pasPng = 0, refusDim = 0;
        const obtenus = [];
        for (const p of Pl.plan) {
            if (arretDemande || !verrou.tenu) break;
            const _id = P.idImagePtcgio(slug, p.carteId, p.numero);
            const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat wOriginal').lean();
            if (deja?.etat === 'retire') { retires++; continue; }                       // un visuel retiré ne revient jamais sans une décision
            if (deja?.sha256 && deja.urlOriginal === p.url && deja.etat === 'ok') { sautes++; continue; }
            if (['trop-petit', 'refuse-dimensions'].includes(deja?.etat) && deja.urlOriginal === p.url) { deja.etat === 'trop-petit' ? tropPetits++ : refusDim++; continue; }
            try {
                const buffer = await client.image(p.url);
                if (!buffer) { absents++; continue; }                                    // 404 : le numéro n'existe pas à la source, le trou reste
                const meta = await sharp(buffer).metadata();
                if (meta.format !== 'png') { pasPng++; echecs++; console.warn(`   ✗ ${_id} : format « ${meta.format} » au lieu de png`); continue; }
                if (!meta.width || meta.width < largeurMinDe(P.SOURCE)) {
                    tropPetits++;
                    await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: largeurMinDe(P.SOURCE), lot: LOT } }, { upsert: true });
                    continue;
                }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                obtenus.push({ p, _id, meta, webp, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length });
            } catch (err) {
                if (err.bloque) { bloque = err; break; }
                echecs++;
                if (echecTransitoire(err)) echecsTransitoires++;
                console.warn(`   ✗ ${_id} (${p.url}) : ${err.message}`);
                await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, etat: 'echec', erreur: err.message, lot: LOT } }, { upsert: true });
                if (/verrou/.test(err.message)) break;
            }
        }
        if (bloque) await conclureBloque(E, slug, bloque, client);
        if (!bloque && (arretDemande || !verrou.tenu)) return { code: slug, etat: 'interrompu', sansJointure: true };

        // ---- 3 bis. DIMENSIONS : par ligne (un kit a deux sets pokemontcg.io), la majorité fait la règle ---------------------------------------
        const admis = [];
        for (const id of [...new Set(obtenus.map(o => o.p.ligneId))]) {
            const groupe = obtenus.filter(o => o.p.ligneId === id);
            const D = P.dimensionsAdmises(groupe.map(o => ({ cle: o._id, w: o.meta.width, h: o.meta.height })));
            for (const r of D.refuses) {
                const o = groupe.find(x => x._id === r.cle);
                refusDim++;
                console.warn(`   ✗ ${r.cle} : ${r.motif}`);
                await M.Image.updateOne({ _id: r.cle }, { $set: { source: P.SOURCE, set: slug, carteId: o.p.carteId, numero: o.p.numero, urlOriginal: o.p.url, wOriginal: o.meta.width, hOriginal: o.meta.height, etat: 'refuse-dimensions', erreur: r.motif, lot: LOT } }, { upsert: true });
            }
            admis.push(...groupe.filter(o => D.admis.includes(o._id)));
        }

        // ---- 4. R2 AVANT la ligne -------------------------------------------------------------------------------------------------------------
        let telecharges = 0;
        for (const o of admis) {
            const { p } = o;
            const cleR2 = `${P.SOURCE}/${slug}/${cleNum(p.numero)}-${p.carteId}-en.webp`;
            await deposer(bucket, cleR2, o.webp.data, 'image/webp');
            await M.Image.updateOne({ _id: o._id }, {
                $set: {
                    source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, nomEn: p.nomEn, idProduct: p.idProduct, preuve: p.preuve, voie: p.voie, urlOriginal: p.url, ...(p.noteVariante ? { noteVariante: p.noteVariante } : {}),
                    // ➕ R5 : l'entrée japonaise qu'on remplace, ENTIÈRE — un retour arrière est un rejeu (la remettre dans cartes.images), pas une recherche
                    ...(remplacerJumeau && p.jumeau ? { jumeauRemplace: p.jumeau } : {}),
                    wOriginal: o.meta.width, hOriginal: o.meta.height, sha1Original: o.sha1Original, octetsOriginal: o.octetsOriginal,
                    cleR2, sha256: sha('sha256', o.webp.data), octets: o.webp.data.length, w: o.webp.info.width, h: o.webp.info.height, fmt: 'webp',
                    langueSource: 'en', ...(({ langue, preuve }) => ({ langue, languePreuve: preuve }))(langueDuVisuel({ source: P.SOURCE, langueSource: 'en' })),
                    attribution: P.MENTION, mention: P.MENTION, lot: LOT, telechargeLe: new Date(), etat: 'ok'
                }, $unset: { erreur: 1 }
            }, { upsert: true });
            telecharges++;
        }

        // ---- 5. JOINTURE ADDITIVE, sous sa garde ---------------------------------------------------------------------------------------------------
        const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
        const avant = await compterEntrees(db, carteIds, slug, LOT);
        const images = await M.Image.find({ source: P.SOURCE, set: slug, etat: 'ok', lot: LOT }).lean();
        let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null;
        const retirees = [];                                    // R5 : les entrées japonaises sorties de cartes.images, par la clé de compterEntrees
        try {
            for (const im of images) {
                const c = await M.Carte.findById(im.carteId).select('images').lean();
                if (!c) { cartesAbsentes++; continue; }
                // R5 : les jumeaux de CE numéro, par la définition de production (langue « ja » sous un set « intl ») — ils ne comptent pas comme « déjà servi »
                const jumeauxIci = remplacerJumeau ? (c.images || []).filter(e => e && e.set === slug && e.source !== P.SOURCE && e.numero != null && cleNumero(e.numero) === cleNumero(im.numero) && J.scanJumeau(e, set.tirage ?? set.region)) : [];
                const autres = (c.images || []).filter(e => !(e.source === P.SOURCE && e.set === slug && e.numero === im.numero) && !jumeauxIci.includes(e));
                if (T.dejaServi({ images: autres }, slug, im.numero)) {
                    // une AUTRE source sert ce numéro (posé entre deux passages) : on ne touche pas à son entrée, et la nôtre lui CÈDE la place
                    dejaParAutre++;
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero } } });
                    continue;
                }
                const entree = { set: slug, source: P.SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, preuve: im.preuve,
                    numero: im.numero, ...(im.noteVariante ? { noteVariante: im.noteVariante } : {}), attribution: P.MENTION, mention: P.MENTION, lot: LOT, langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date() };
                await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero } } });
                // R5 — LE REMPLACEMENT : l'anglais prouvé PREND LA PLACE du jumeau japonais, au même numéro ; le document `images` japonais reste, marqué
                for (const j of jumeauxIci) {
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: j.source, cleR2: j.cleR2 } } });
                    await M.Image.updateOne({ source: j.source, set: slug, carteId: im.carteId, cleR2: j.cleR2 }, { $set: { remplaceePar: im._id, remplaceeLe: new Date() } });
                    retirees.push(`${c._id}|${j.source}|${j.set}|${j.numero ?? ''}|${j.cleR2 ?? ''}`);
                }
                await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                joints++;
            }
        } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
        const apres = await compterEntrees(db, carteIds, slug, LOT);
        // la garde de lot compte ce qui doit rester : les entrées des autres sources, MOINS les seuls jumeaux que ce passage a remplacés (un remplacement 1 pour 1)
        const attendues = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');
        const garde = attendues === apres.autres && apres.siennes === joints;
        if (!garde) console.error(`🔴 ${slug} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres} (attendu ${avant.nAutres - retirees.length})${attendues === apres.autres ? '' : ' (CHANGÉES)'}, entrées ${P.SOURCE} ${apres.siennes} pour ${joints} jointes`);
        // ---- 6. LES VIGNETTES (200 px) : une jointure RÉÉCRIT les entrées, et lot-additif ne vignette pas — même appel que le worker (collecteur-images.js) ----
        const W = await vignetter(db, slug, { bucket: process.env.R2_BUCKET_IMAGES, arreter: () => arretDemande });
        console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.depuisDocument} recopiée(s) · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)${W.vg.interrompu ? ' · interrompu' : ''}`}`);
        const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
        const complet = {
            vignettes: W.vg,
            source: P.SOURCE, mention: P.MENTION, lot: LOT, lignes: P.lignesDe(slug).map(l => l.id), produits: Pl.produits, trous: Pl.trous, prouves: Pl.plan.length, restes: motifs,
            telecharges, sautes, absents, echecs, echecsTransitoires, tropPetits, retires, refusDim, pasPng, joints, dejaParAutre, cartesAbsentes,
            garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attendues === apres.autres, siennesApres: apres.siennes, ok: garde,
                ...(remplacerJumeau ? { nJaRetirees: retirees.length, nEnPosees: joints } : {}) },
            ...(remplacerJumeau ? { mode: 'remplacement-jumeau', jumeaux: Pl.jumeaux, ecartes: Pl.ecartes.length } : {}),
            requetes: client.compteRequetes(), requetesParHote: client.requetesParHote(), bloque: bloque ? bloque.message : null, erreurJointure,
            concordance: garde && !erreurJointure && !bloque && vignettesOk && echecs === 0 && cartesAbsentes === 0 && telecharges + sautes + tropPetits + retires + refusDim + absents === Pl.plan.length && joints + dejaParAutre === images.length,
            verifieLe: new Date()
        };
        // R5 : le bilan du remplacement a SON champ — celui du lot additif (visuelsPtcgio, lu par retirer-visuels-ptcgio.js) n'est pas écrasé
        await M.Set.updateOne({ _id: slug }, { $set: { [remplacerJumeau ? 'visuelsPtcgioJumeau' : 'visuelsPtcgio']: complet } });
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: client.compteRequetes(), [remplacerJumeau ? 'bilanJumeau' : 'bilan']: complet } });
        console.log(`   ${slug} : prouvés ${Pl.plan.length} · téléchargés ${telecharges} · repris ${sautes} · absents (404) ${absents} · sous le seuil ${tropPetits} · dimensions refusées ${refusDim} · échecs ${echecs} · joints ${joints} · garde ${garde ? '✅' : '❌'} · requêtes ${client.compteRequetes()}`);
        if (bloque) return { code: slug, etat: 'incomplet', erreur: bloque.message, ...complet };
        if (erreurJointure) return { code: slug, etat: 'incomplet', erreur: erreurJointure, ...complet };
        if (!garde) return { code: slug, etat: 'non-concordant', ...complet };
        const transitoire = !complet.concordance && echecs > 0 && echecs === echecsTransitoires;
        return { code: slug, etat: complet.concordance ? 'verifie' : transitoire ? 'incomplet-transitoire' : 'incomplet', ...complet };
    } finally {
        await verrouSet.rendre();
    }
}

/** Une source qui a bloqué : l'ALERTE s'écrit, on s'arrête. Elle ne se rouvre que par une décision (l'alerte désactivée à la main). */
async function conclureBloque(E, slug, err, client) {
    await E.updateOne({ _id: P.ID_ALERTE }, { $set: { active: true, constateLe: new Date(), motif: err.message, status: err.status ?? null, unite: slug, requetes: client.compteRequetes() }, $setOnInsert: { depuis: new Date() } }, { upsert: true });
    console.error(`⛔ ${slug} : ${err.message}`);
}

/**
 * LE LANCEMENT de l'écriture, rejoué par le banc. 🔴 `verifierBucket` d'abord : le bucket vit en juridiction UE et le point d'accès générique répond
 * AccessDenied (r2.js) ; on ne télécharge rien — pas une requête vers pokemontcg.io, pas un dépôt — si le bucket ne répond pas. Les autres outils qui
 * écrivent sur R2 font de même (collecteur-images.js, collecteur-images-bulba.js, collecter-logos-officiels.js).
 * @returns {Promise<{code: number, resultats: object[]}>}
 */
async function lancerEcriture(slugs, M, { verrou, client, lireNumeros, R2 = r2, bucket = process.env.R2_BUCKET_IMAGES, vignetter, fabriquerVerrouSet, remplacerJumeau = false, nomsProuves = null } = {}) {
    if (!bucket) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune requête, aucune écriture');
    await R2.verifierBucket(bucket);
    const resultats = [];
    let code = 0;
    for (const slug of slugs) {
        if (arretDemande) break;
        const r = await collecterSlug(slug, M, { verrou, client, lireNumeros, vignetter, fabriquerVerrouSet, remplacerJumeau, nomsProuves, deposer: (b, c, d, t) => R2.deposerBinaire(b, c, d, t) });
        resultats.push(r);
        console.log(`SET ${slug} → ${r.etat}`);
        if (!['verifie', 'refuse-substitut', 'refuse-set-non-apparie'].includes(r.etat)) code = 1;   // (un 'refuse-nom' du mode remplacement fait donc un code 1 : un doute sur le témoin ne passe pas pour un succès)
        if (['refuse-source-bloquee', 'incomplet'].includes(r.etat) && client.bloque()) break;
    }
    return { code, resultats };
}

module.exports = { collecterSlug, planifierSlug, planifierJumeauSlug, nomsProuvesParTcgdex, numerosCardmarket, lancerEcriture, STOP_OCTETS };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion ; `--ecrire` exige `--sets=`.
// ➕ R5 : `--remplacer-jumeau` (avec --plan ou --ecrire) = le MODE REMPLACEMENT (scans japonais du jumeau -> anglais prouvé) ; `--fichiers` (avec --plan) liste les adresses.
const AUTORISES = [/^--plan$/, /^--verrou$/, /^--ecrire$/, /^--remplacer-jumeau$/, /^--fichiers$/, /^--sets=[A-Za-z0-9][A-Za-z0-9-]*(,[A-Za-z0-9][A-Za-z0-9-]*)*$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--verrou', '--ecrire'].filter(m => args.includes(m));
if (inconnus.length || modes.length !== 1 || (args.includes('--ecrire') && !args.some(a => a.startsWith('--sets='))) || (args.includes('--remplacer-jumeau') && args.includes('--verrou')) || (args.includes('--fichiers') && !args.includes('--plan'))) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}un seul mode parmi --plan, --verrou, --ecrire ; --ecrire exige --sets=<slug>,… (jamais « tous ») ; --remplacer-jumeau va avec --plan ou --ecrire ; --fichiers avec --plan. Ex. : --plan [--sets=Celebrations,Shining-Legends]`);
    process.exit(2);
}
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    // la production (`test`) n'est ouverte que pour LIRE `numeros_cartes` : le numéro du produit Cardmarket fait l'adresse (garde.js : « LECTURE SEULE »)
    // `--ecrire` exige R2_BUCKET_IMAGES dans l'environnement (et lancerEcriture vérifie le bucket avant tout) ; --plan et --verrou n'écrivent pas sur R2
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: !args.includes('--verrou'), buckets: args.includes('--ecrire') ? ['R2_BUCKET_IMAGES'] : [] });
    const M = modeles(cx);
    const lireNumeros = slug => numerosCardmarket(prod, slug, cx.db);
    const voulus = args.find(a => a.startsWith('--sets='))?.slice(7).split(',');
    const slugs = voulus || [...new Set(P.TABLE_PTCGIO.map(l => l.slug))];
    if (args.includes('--verrou')) {
        const v = (await M.EtatImages.findById(P.VERROU_GLOBAL).lean())?.verrou;
        const b = await cx.db.collection('collecte_images_etat').findOne({ _id: P.ID_ALERTE, active: true });
        console.log(`${P.VERROU_GLOBAL} : ${v ? `🔒 pid ${v.pid} sur ${v.hote}, commit ${v.commit}, battement il y a ${Math.round((Date.now() - new Date(v.depuis)) / 1000)} s` : 'libre'}${b ? ` · ⛔ BLOQUÉ depuis ${new Date(b.depuis).toISOString()} : ${b.motif}` : ''}`);
        await fermer(); return;
    }
    const remplacer = args.includes('--remplacer-jumeau');
    const noms = slug => nomsProuvesParTcgdex(M, cx.db, slug);
    if (args.includes('--plan') && remplacer) {
        // le plan de REMPLACEMENT : zéro requête (cache TCGdex, base en lecture) ; le défaut est de n'écrire rien
        let jumeaux = 0, prouves = 0, produitsRemplaces = 0, produits = 0;
        for (const slug of slugs) {
            const V = P.verdictDuSet(slug);
            if (V.verdict !== 'prouve') { console.log(`${slug.padEnd(42)} ${V.verdict}`); continue; }
            const set = await cx.db.collection('sets').findOne({ _id: slug }, { projection: { tirage: 1, region: 1 } });
            let n; try { n = await noms(slug); } catch (e) { console.log(`${slug.padEnd(42)} nom NON prouvé (${e.message}) — aucun remplacement`); continue; }
            const Pl = await planifierJumeauSlug(cx.db, slug, await lireNumeros(slug), n, set?.tirage ?? set?.region);
            jumeaux += Pl.jumeaux; prouves += Pl.plan.length; produitsRemplaces += Pl.produitsRemplaces.length; produits += Pl.produits;
            const motifs = {}; for (const r of Pl.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
            console.log(`${slug.padEnd(42)} ${P.lignesDe(slug).map(l => l.id).join('+').padEnd(10)} produits ${String(Pl.produits).padStart(4)} · à scan jumeau ${String(Pl.trous).padStart(3)} (${String(Pl.jumeaux).padStart(3)} carte×numéro) · PROUVÉS (fichiers) ${String(Pl.plan.length).padStart(3)} → produits remplacés ${String(Pl.produitsRemplaces.length).padStart(3)} · écartés ${Pl.ecartes.length} · restes ${JSON.stringify(motifs)}`);
            if (args.includes('--fichiers')) for (const p of Pl.plan) console.log(`      ${p.url}  ← ${p.nomEn} ${p.numero} (jumeau ${p.jumeau?.cleR2})`);
            for (const r of Pl.restes) console.log(`      reste : ${r.nomEn ?? r.carteId} ${r.numero} — ${r.motif}`);
        }
        const requetes = prouves + 1;
        console.log(`\nSIMULATION (zéro requête) : ${prouves} fichiers pour ${jumeaux} carte×numéro à scan jumeau (${produits} produits au set) · ${produitsRemplaces} produits dont le visuel serait remplacé · ${requetes} requêtes vers ${P.HOTE_NOM} (1 robots.txt + ${prouves} images, 0 réessai) · cadence ${P.CADENCE_MS / 1000} s ≈ ${Math.ceil(requetes * P.CADENCE_MS / 60000)} min · autres hôtes : 0`);
        await fermer(); return;
    }
    if (args.includes('--plan')) {
        let trous = 0, prouves = 0, produits = 0;
        for (const slug of slugs) {
            const V = P.verdictDuSet(slug);
            if (V.verdict !== 'prouve') { console.log(`${slug.padEnd(42)} ${V.verdict}`); continue; }
            const Pl = await planifierSlug(cx.db, slug, await lireNumeros(slug));
            trous += Pl.trous; prouves += Pl.plan.length; produits += Pl.produits;
            const motifs = {}; for (const r of Pl.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
            console.log(`${slug.padEnd(42)} ${P.lignesDe(slug).map(l => l.id).join('+').padEnd(10)} produits ${String(Pl.produits).padStart(4)} · trous ${String(Pl.trous).padStart(4)} · PROUVÉS (fichiers) ${String(Pl.plan.length).padStart(4)} · dont avec note de variante ${String(Pl.plan.filter(p => p.noteVariante).length).padStart(3)} · restes ${JSON.stringify(motifs)}`);
        }
        const requetes = prouves + 1;
        console.log(`\nSIMULATION (zéro requête) : ${prouves} fichiers sur ${trous} trous (${produits} produits) · ${requetes} requêtes vers ${P.HOTE_NOM} (1 robots.txt + ${prouves} images, 0 réessai) · cadence ${P.CADENCE_MS / 1000} s ≈ ${Math.ceil(requetes * P.CADENCE_MS / 60000)} min · autres hôtes : 0`);
        await fermer(); return;
    }
    // --ecrire : sous lot-additif.js, par le coordinateur. Verrou global pris et LIÉ au client ; arrêt au premier défi.
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: P.VERROU_GLOBAL, dureeMs: P.VERROU_GLOBAL_MS, surPerte, nom: `verrou global ${P.SOURCE}` });
    const tenuPar = await verrou.prendre();
    if (tenuPar) { console.error(`❌ ${P.VERROU_GLOBAL} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}`); await fermer(); process.exit(1); }
    const client = P.fabriquerClientPtcgio({ verrou });
    let code = 0;
    try { code = (await lancerEcriture(slugs, M, { verrou, client, lireNumeros, remplacerJumeau: remplacer, nomsProuves: remplacer ? noms : null })).code; }
    catch (e) { console.error('❌', e.message); code = 1; }
    finally { await verrou.rendre(); await fermer(); }
    console.log(`REQUÊTES : ${JSON.stringify(client.requetesParHote())}`);
    process.exit(code);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
