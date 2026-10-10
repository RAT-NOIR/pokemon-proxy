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
    return { produits: lignes.length, trous: trous.length, ...P.planifierPtcgio({ slug, trous }) };
}

/** Les numéros des produits Cardmarket du set (`numeros_cartes.numero`, base de production en LECTURE SEULE) : idProduct -> numéro. */
async function numerosCardmarket(prod, slug, db) {
    const ids = (await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { idProduct: 1 } }).toArray()).map(l => l.idProduct);
    const lus = await prod.db.collection('numeros_cartes').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, numero: 1 } }).toArray();
    const m = new Map(lus.filter(x => x.numero != null && String(x.numero).trim() !== '').map(x => [x.idProduct, String(x.numero).trim()]));
    if (ids.length && !lus.length) throw new Error(`${slug} : ${ids.length} produits joints, 0 ligne dans numeros_cartes — une clé fausse, pas une absence (§41)`);
    return m;
}

/** Les entrées des AUTRES sources, empreinte par empreinte (elles ne doivent pas bouger d'un octet) ; et le nombre des nôtres dans le set. */
async function compterEntrees(db, carteIds, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (e?.source !== P.SOURCE) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes };
}

/**
 * @param {string} slug  le slug Cardmarket du set (une unité = un set)
 * @param {object} M     les modèles de la base `cartes`
 * @param {object} o     `verrou` : le verrou global, LIÉ au client. Les autres options n'existent que pour le banc (test-ptcgio.js).
 */
async function collecterSlug(slug, M, { verrou, client, lireNumeros, vignetter = vignetterApresJointure, deposer =(b, c, d, t) => r2.deposerBinaire(b, c, d, t), fabriquerVerrouSet = fabriquerVerrou, stopOctets = STOP_OCTETS } = {}) {
    const db = M.Carte.db.db;
    const E = db.collection('collecte_images_etat');
    const refus = (etat, erreur) => { console.error(`❌ ${slug} : ${erreur}.`); return { code: slug, etat, erreur, sansJointure: true }; };
    const V = P.verdictDuSet(slug);
    if (V.verdict === 'substitut-interdit') return refus('refuse-substitut', V.motif);
    if (V.verdict !== 'prouve') return refus('refuse-set-non-apparie', V.motif);
    if (typeof lireNumeros !== 'function') return refus('refuse-numeros', 'aucune lecture des numéros Cardmarket fournie : sans elle, l\'adresse ne peut pas se construire');
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
    const idEtat = `${P.SOURCE}/${slug}`;
    const verrouSet = fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_SET_MS, surInsertion: { debute: new Date(), phase: 'plan' }, surPerte, nom: `verrou de set ${idEtat}` });
    const tenuPar = await verrouSet.prendre();
    if (tenuPar) { console.error(`❌ ${idEtat} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}.`); return { code: slug, etat: 'refuse-verrou' }; }
    let bloque = null;
    try {
        const Pl = await planifierSlug(db, slug, await lireNumeros(slug));
        const motifs = {}; for (const r of Pl.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`\n══ ${slug} → ${P.lignesDe(slug).map(l => l.id).join('+')} : ${Pl.trous} trous sur ${Pl.produits} produits · PROUVÉS ${Pl.plan.length} · restes ${JSON.stringify(motifs)} ══`);
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'telechargement', restes: Pl.restes.slice(0, 1000), derniereRequete: new Date() } });

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
                    await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: largeurMinDe(P.SOURCE), lot: P.LOT } }, { upsert: true });
                    continue;
                }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                obtenus.push({ p, _id, meta, webp, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length });
            } catch (err) {
                if (err.bloque) { bloque = err; break; }
                echecs++;
                if (echecTransitoire(err)) echecsTransitoires++;
                console.warn(`   ✗ ${_id} (${p.url}) : ${err.message}`);
                await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, etat: 'echec', erreur: err.message, lot: P.LOT } }, { upsert: true });
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
                await M.Image.updateOne({ _id: r.cle }, { $set: { source: P.SOURCE, set: slug, carteId: o.p.carteId, numero: o.p.numero, urlOriginal: o.p.url, wOriginal: o.meta.width, hOriginal: o.meta.height, etat: 'refuse-dimensions', erreur: r.motif, lot: P.LOT } }, { upsert: true });
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
                    source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, nomEn: p.nomEn, idProduct: p.idProduct, preuve: p.preuve, voie: p.voie, urlOriginal: p.url,
                    wOriginal: o.meta.width, hOriginal: o.meta.height, sha1Original: o.sha1Original, octetsOriginal: o.octetsOriginal,
                    cleR2, sha256: sha('sha256', o.webp.data), octets: o.webp.data.length, w: o.webp.info.width, h: o.webp.info.height, fmt: 'webp',
                    langueSource: 'en', ...(({ langue, preuve }) => ({ langue, languePreuve: preuve }))(langueDuVisuel({ source: P.SOURCE, langueSource: 'en' })),
                    attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, telechargeLe: new Date(), etat: 'ok'
                }, $unset: { erreur: 1 }
            }, { upsert: true });
            telecharges++;
        }

        // ---- 5. JOINTURE ADDITIVE, sous sa garde ---------------------------------------------------------------------------------------------------
        const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
        const avant = await compterEntrees(db, carteIds, slug);
        const images = await M.Image.find({ source: P.SOURCE, set: slug, etat: 'ok', lot: P.LOT }).lean();
        let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null;
        try {
            for (const im of images) {
                const c = await M.Carte.findById(im.carteId).select('images').lean();
                if (!c) { cartesAbsentes++; continue; }
                const autres = (c.images || []).filter(e => !(e.source === P.SOURCE && e.set === slug && e.numero === im.numero));
                if (T.dejaServi({ images: autres }, slug, im.numero)) {
                    // une AUTRE source sert ce numéro (posé entre deux passages) : on ne touche pas à son entrée, et la nôtre lui CÈDE la place
                    dejaParAutre++;
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero } } });
                    continue;
                }
                const entree = { set: slug, source: P.SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, preuve: im.preuve,
                    numero: im.numero, attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date() };
                await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero } } });
                await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                joints++;
            }
        } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
        const apres = await compterEntrees(db, carteIds, slug);
        const garde = avant.autres === apres.autres && apres.siennes === joints;
        if (!garde) console.error(`🔴 ${slug} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres}${avant.autres === apres.autres ? '' : ' (CHANGÉES)'}, entrées ${P.SOURCE} ${apres.siennes} pour ${joints} jointes`);
        // ---- 6. LES VIGNETTES (200 px) : une jointure RÉÉCRIT les entrées, et lot-additif ne vignette pas — même appel que le worker (collecteur-images.js) ----
        const W = await vignetter(db, slug, { bucket: process.env.R2_BUCKET_IMAGES, arreter: () => arretDemande });
        console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.depuisDocument} recopiée(s) · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)${W.vg.interrompu ? ' · interrompu' : ''}`}`);
        const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
        const complet = {
            vignettes: W.vg,
            source: P.SOURCE, mention: P.MENTION, lot: P.LOT, lignes: P.lignesDe(slug).map(l => l.id), produits: Pl.produits, trous: Pl.trous, prouves: Pl.plan.length, restes: motifs,
            telecharges, sautes, absents, echecs, echecsTransitoires, tropPetits, retires, refusDim, pasPng, joints, dejaParAutre, cartesAbsentes,
            garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: avant.autres === apres.autres, siennesApres: apres.siennes, ok: garde },
            requetes: client.compteRequetes(), requetesParHote: client.requetesParHote(), bloque: bloque ? bloque.message : null, erreurJointure,
            concordance: garde && !erreurJointure && !bloque && vignettesOk && echecs === 0 && cartesAbsentes === 0 && telecharges + sautes + tropPetits + retires + refusDim + absents === Pl.plan.length && joints + dejaParAutre === images.length,
            verifieLe: new Date()
        };
        await M.Set.updateOne({ _id: slug }, { $set: { visuelsPtcgio: complet } });
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: client.compteRequetes(), bilan: complet } });
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

module.exports = { collecterSlug, planifierSlug, numerosCardmarket, STOP_OCTETS };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion ; `--ecrire` exige `--sets=`.
const AUTORISES = [/^--plan$/, /^--verrou$/, /^--ecrire$/, /^--sets=[A-Za-z0-9][A-Za-z0-9-]*(,[A-Za-z0-9][A-Za-z0-9-]*)*$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--verrou', '--ecrire'].filter(m => args.includes(m));
if (inconnus.length || modes.length !== 1 || (args.includes('--ecrire') && !args.some(a => a.startsWith('--sets=')))) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}un seul mode parmi --plan, --verrou, --ecrire ; --ecrire exige --sets=<slug>,… (jamais « tous »). Ex. : --plan [--sets=Celebrations,Shining-Legends]`);
    process.exit(2);
}
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    // la production (`test`) n'est ouverte que pour LIRE `numeros_cartes` : le numéro du produit Cardmarket fait l'adresse (garde.js : « LECTURE SEULE »)
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: !args.includes('--verrou'), buckets: [] });
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
    if (args.includes('--plan')) {
        let trous = 0, prouves = 0, produits = 0;
        for (const slug of slugs) {
            const V = P.verdictDuSet(slug);
            if (V.verdict !== 'prouve') { console.log(`${slug.padEnd(42)} ${V.verdict}`); continue; }
            const Pl = await planifierSlug(cx.db, slug, await lireNumeros(slug));
            trous += Pl.trous; prouves += Pl.plan.length; produits += Pl.produits;
            const motifs = {}; for (const r of Pl.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
            console.log(`${slug.padEnd(42)} ${P.lignesDe(slug).map(l => l.id).join('+').padEnd(10)} produits ${String(Pl.produits).padStart(4)} · trous ${String(Pl.trous).padStart(4)} · PROUVÉS (fichiers) ${String(Pl.plan.length).padStart(4)} · restes ${JSON.stringify(motifs)}`);
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
    try {
        for (const slug of slugs) {
            if (arretDemande) break;
            const r = await collecterSlug(slug, M, { verrou, client, lireNumeros });
            console.log(`SET ${slug} → ${r.etat}`);
            if (!['verifie', 'refuse-substitut', 'refuse-set-non-apparie'].includes(r.etat)) code = 1;
            if (['refuse-source-bloquee', 'incomplet'].includes(r.etat) && client.bloque()) break;
        }
    } finally { await verrou.rendre(); await fermer(); }
    console.log(`REQUÊTES : ${JSON.stringify(client.requetesParHote())}`);
    process.exit(code);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
