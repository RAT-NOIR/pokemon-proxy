// ============================================================
// COLLECTEUR D'IMAGES — pikaqian.com -> R2 (WebP) + base `cartes` (2026-10-11)
// ============================================================
//   node collecteur-images-pikaqian.js --plan --sets=<slug>[,…]     la SIMULATION : lit la page du set (1 requête + robots.txt) et apparie, ne télécharge AUCUNE image
//   node collecteur-images-pikaqian.js --verrou                      qui tient le verrou global, lecture seule
//   node lot-additif.js --quoi="…" --collections=cartes,images,sets,collecte_images_etat -- node collecteur-images-pikaqian.js --ecrire --sets=<slug>[,…]
//   (la collecte de masse : le worker, `collecteur-images.js --boucle`, unités `pikaqian/<slug>` que `enfiler-pikaqian.js` insère — l'alimentateur n'en insère AUCUNE)
//
// 🔑 DÉCISION DU TESTEUR (2026-10-11) : voir collecte-cartes/pikaqian.js. « Commence par un set test, puis enfile le reste » : `--ecrire --sets=` est le set
// test, local, sous lot-additif.js ; jamais « tous » ici (le reste passe par la file du worker, après redéploiement). Retrait : retirer-visuels-pikaqian.js.
//
// Par set (une unité `pikaqian/<slug>`, qui porte `slugSet`, `code`, `codePk`, `langue` — la ligne de collecte-cartes/pikaqian-sets.js, mot pour mot) :
//   0. GARDES, par ce qu'elles AUTORISENT : la ligne de table, le set en base au bon tirage, la source pas bloquée, la base sous 400 Mo, des produits joints.
//   1. LA PAGE du set (une requête), jugée : la majorité de ses tuiles porte le code du set, sinon refus sans une image.
//   2. LES TROUS : nos produits joints dont la carte n'a AUCUN visuel à ce numéro dans ce set (additif : rien d'existant n'est touché).
//   3. LE PLAN : numéro + tuile sans foil unique + nom concordant (planifierPikaqian) ; un doute est un trou, et son motif s'écrit.
//   4. TÉLÉCHARGEMENT (cadence 10 s, verrou lié au client), seuil de largeur (300 px), WebP -> R2 AVANT la ligne `images`, qui porte la source, la tuile,
//      la preuve, la langue, la MENTION, la PROVENANCE et le LOT (retirable en un seul geste).
//   5. JOINTURE ADDITIVE, sous sa garde : les entrées des autres sources ne bougent pas — comptées avant et après ; puis les VIGNETTES. « verifie » exige les deux.
require('dotenv').config();
const crypto = require('crypto');
const sharp = require('sharp');
const r2 = require('./collecte-cartes/r2');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { largeurMinDe, aRejuger, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { echecTransitoire } = require('./collecte-cartes/issue-unite');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
const T = require('./collecte-cartes/tpc');
const P = require('./collecte-cartes/pikaqian');
const { TABLE_PIKAQIAN, lignePikaqian } = require('./collecte-cartes/pikaqian-sets');

const VERROU_SET_MS = 10 * 60 * 1000;
const STOP_OCTETS = 400 * 1024 * 1024;                 // consigne de l'éditeur : au-delà de 400 Mo (plafond M0 512), STOP
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';

let arretDemande = false;
process.on('SIGINT', () => { arretDemande = true; });
process.on('SIGTERM', () => { arretDemande = true; });
const surPerte = () => { arretDemande = true; process.exitCode = 1; };

/** La garde de l'unité, pure : la ligne de table, MOT POUR MOT. `ligneDe` n'est injecté que par le banc. */
function releve(unite, ligneDe = lignePikaqian) {
    if (unite?.source !== P.SOURCE) return { ok: false, etat: 'refuse-source', motif: `source « ${unite?.source} » : pas ${P.SOURCE}` };
    const L = ligneDe(unite.slugSet);
    if (!L) return { ok: false, etat: 'refuse-table', motif: `${unite.slugSet} absent de collecte-cartes/pikaqian-sets.js` };
    if (unite.code !== L.code || unite.codePk !== L.codePk || unite.langue !== L.langue) return { ok: false, etat: 'refuse-table', motif: `l'unité porte ${unite.code}/${unite.codePk}/${unite.langue}, la table ${L.code}/${L.codePk}/${L.langue}` };
    return { ok: true, L };
}

/** Les trous du set et le plan — lecture seule de la base. */
async function planifier(db, slug, L, tuiles) {
    const lignes = await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1 } }).toArray();
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    const trous = lignes.filter(l => cartes.has(l.carteId)).map(l => ({ carte: cartes.get(l.carteId), numeroFiche: l.numeroFiche ?? null, idProduct: l.idProduct }));
    const aCombler = trous.filter(x => !T.dejaServi(x.carte, slug, x.numeroFiche)).length;
    return { produits: lignes.length, trous: aCombler, ...P.planifierPikaqian({ trous, tuiles, code: L.codePk, slug }) };
}

/** Les entrées des AUTRES sources, empreinte par empreinte (elles ne doivent pas bouger d'un octet) ; et le nombre des nôtres dans le set. */
async function compterEntrees(db, carteIds, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (e?.source !== P.SOURCE) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes };
}

/** La provenance d'un visuel : ce que la page DÉCLARE pour cette carte (`lireOrigines`), sinon la phrase de la mesure du 2026-10-10. */
function provenanceDe(origine) {
    if (origine?.officielle) return `visuel officiel chinois : pikaqian déclare l'adresse officielle ${origine.officielle} (we_chat_image_url)${origine.native ? ` et native_image_url ${origine.native}` : ''}`;
    if (origine?.native) return `${P.PROVENANCE_PAR_DEFAUT} ; pikaqian déclare pour cette carte native_image_url ${origine.native}`;
    return P.PROVENANCE_PAR_DEFAUT;
}

/**
 * @param {object} unite  l'unité de file (`pikaqian/<slug>`, source, slugSet, code, codePk, langue)
 * @param {object} M      les modèles de la base `cartes`
 * @param {object} o      `verrou` : le verrou global, LIÉ au client. Les autres options n'existent que pour le banc : `client`, `deposer` (R2), `fabriquerVerrouSet`,
 *                        `stopOctets`, `ligneDe`, `vignetter`.
 */
async function collecterSet(unite, M, { verrou, client: clientInjecte = null, deposer = (b, c, d, t) => r2.deposerBinaire(b, c, d, t), fabriquerVerrouSet = fabriquerVerrou, stopOctets = STOP_OCTETS, ligneDe = lignePikaqian, vignetter = vignetterApresJointure } = {}) {
    const db = M.Carte.db.db;
    const E = db.collection('collecte_images_etat');
    const refus = (etat, erreur) => { console.error(`❌ ${unite?._id} : ${erreur}.`); return { code: unite?._id, etat, erreur, sansJointure: true }; };
    const G = releve(unite, ligneDe);
    if (!G.ok) return refus(G.etat, G.motif);
    const { L } = G;
    const slug = L.slug;
    // la source a-t-elle déjà bloqué (ou été retirée) ? on ne lui redemande rien (« si une source bloque, on s'arrête »)
    const bloquee = await E.findOne({ _id: P.ID_ALERTE, active: true });
    if (bloquee) return refus('refuse-source-bloquee', `${P.SOURCE} a bloqué le ${new Date(bloquee.depuis).toISOString()} (${bloquee.motif}) — aucune requête`);
    const set = await M.Set.findById(slug).select('tirage region').lean();
    if (!set) return refus('refuse-set', `set ${slug} absent de la base`);
    if ((set.tirage ?? set.region) !== L.tirage) return refus('refuse-set', `tirage ${set.tirage ?? set.region} en base, ${L.tirage} dans la table`);
    // la TAILLE de la base, avant toute requête : au-delà de 400 Mo, STOP, et c'est écrit
    const st = await db.command({ dbStats: 1 });
    if (st.dataSize + st.indexSize > stopOctets) {
        const motif = `base « cartes » à ${Math.round((st.dataSize + st.indexSize) / 1048576)} Mo (données + index) : au-delà de 400 Mo, STOP (plafond M0 512 Mo)`;
        await E.updateOne({ _id: 'alerte/taille-base' }, { $set: { active: true, constateLe: new Date(), motif, donnees: st.dataSize, index: st.indexSize }, $setOnInsert: { depuis: new Date() } }, { upsert: true });
        return refus('refuse-taille-base', motif);
    }
    // un set sans produit joint n'a rien à combler : ni requête, ni « verifie » (§41 — une clé `slugSet` fausse rendrait un succès parfait sur du vide)
    const produits = await db.collection('cartes_produits').countDocuments({ slugSet: slug });
    if (!produits) return refus('refuse-set', `aucun produit joint au set ${slug} (cartes_produits.slugSet)`);
    const idEtat = `${P.SOURCE}/${slug}`;
    const verrouSet = fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_SET_MS, surInsertion: { debute: new Date(), phase: 'page' }, surPerte, nom: `verrou de set ${idEtat}` });
    const tenuPar = await verrouSet.prendre();
    if (tenuPar) { console.error(`❌ ${idEtat} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}.`); return { code: unite._id, etat: 'refuse-verrou' }; }
    const client = clientInjecte || P.fabriquerClientPikaqian({ verrou });
    // 🔑 « DEUX ÉCHECS DE SUITE » SE COMPTENT ENTRE LES UNITÉS : le client est neuf à chaque unité, le compteur est relu ici et réécrit à la fin
    // (un succès le remet à zéro). Un arrêt par erreur répétée pose l'alerte de blocage ; la reprise est une décision (enfiler-pikaqian.js --reprendre).
    client.fixerSuite((await E.findOne({ _id: P.ID_SUITE }))?.suite ?? 0);
    let bloque = null, arretClient = null;
    try {
        // ---- 1. LA PAGE du set ------------------------------------------------------------------------------------------
        let html;
        try { html = await client.page(P.urlSet(L.codePk)); }
        catch (e) {
            if (e.bloque || (e.arret && !e.plafond)) { bloque = e; return await conclureBloque(E, unite, bloque, client); }   // défi, ou erreur répétée entre unités : l'alerte
            // une erreur passagère (5xx, coupure) n'est pas un verdict sur le set (§58) : l'unité revient en file ; sinon elle refuse, la cause écrite
            console.error(`🔴 ${unite._id} : page illisible — ${e.message}`);
            return { code: unite._id, etat: echecTransitoire(e) ? 'incomplet-transitoire' : 'erreur', erreur: e.message, sansJointure: true };
        }
        if (html == null) return refus('refuse-liste', `la page /sets/${L.codePk} n'existe plus chez pikaqian (404) : la table du 2026-10-10 la listait`);
        const tuiles = P.lireTuiles(html);
        const V = P.verdictDePage({ tuiles, code: L.codePk });
        if (!V.ok) { await E.updateOne({ _id: idEtat }, { $set: { phase: 'refuse-liste', motif: V.motif } }, { upsert: true }); return refus('refuse-liste', V.motif); }
        const origines = P.lireOrigines(html);
        if (arretDemande || !verrou.tenu) return { code: unite._id, etat: 'interrompu', sansJointure: true };
        const Pl = await planifier(db, slug, L, tuiles);
        const motifs = {}; for (const r of Pl.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`\n══ ${unite._id} → ${P.SOURCE} ${L.codePk} : ${V.bonnes}/${V.tuiles} tuiles au code du set · ${Pl.trous} trous sur ${Pl.produits} produits · PROUVÉS ${Pl.plan.length} · restes ${JSON.stringify(motifs)} · tuiles à suffixe INCONNU ${Pl.suffixesInconnus.length}${Pl.suffixesInconnus.length ? ` (${Pl.suffixesInconnus.slice(0, 3).map(s => s.nom).join(' | ')})` : ''} ══`);
        client.plafonner(Pl.plan.length + 3);                  // robots.txt des images + une marge : le plan borne les requêtes de l'unité
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'telechargement', restes: Pl.restes.slice(0, 1000), derniereRequete: new Date(), requetes: client.compteRequetes() } }, { upsert: true });

        // ---- 4. TÉLÉCHARGEMENT ------------------------------------------------------------------------------------------
        const bucket = process.env.R2_BUCKET_IMAGES;
        let telecharges = 0, sautes = 0, echecs = 0, echecsTransitoires = 0, tropPetits = 0, retires = 0, absents = 0;
        for (const p of Pl.plan) {
            if (arretDemande || !verrou.tenu) break;
            const _id = P.idImagePikaqian(slug, p.carteId, p.numero);
            const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat wOriginal seuilApplique').lean();
            // un visuel RETIRÉ (retirer-visuels-pikaqian.js) ne revient jamais par une recollecte : il faudrait une décision
            if (deja?.etat === 'retire') { retires++; continue; }
            if (deja?.sha256 && deja.urlOriginal === p.url && deja.etat === 'ok') { sautes++; continue; }
            // déjà jugé trop petit à la même adresse : on ne le redemande pas — SAUF si le seuil a baissé depuis (`aRejuger`, §23)
            if (deja?.etat === 'trop-petit' && deja.urlOriginal === p.url && !aRejuger(deja, P.SOURCE)) { tropPetits++; continue; }
            try {
                // le fichier illisible par sharp est un ÉCHEC pour le client (il compte dans les « deux de suite »), pas un succès
                const buffer = await client.image(p.url, async b => { const m = await sharp(b).metadata(); if (!m.width) throw new Error('largeur illisible'); });
                if (!buffer) { absents++; continue; }                                   // 404 : l'image listée n'existe pas, le trou reste (et se compte)
                const meta = await sharp(buffer).metadata();
                if (!meta.width || meta.width < largeurMinDe(P.SOURCE)) {
                    tropPetits++;
                    // un visuel DÉJÀ prouvé et servi (« ok ») ne se dégrade pas : l'ancien reste, l'essai est noté à côté
                    if (deja?.etat === 'ok') await M.Image.updateOne({ _id }, { $set: { dernierEssai: { le: new Date(), url: p.url, resultat: `trop-petit (${meta.width} px)` } } });
                    else await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit', seuilApplique: largeurMinDe(P.SOURCE), lot: P.LOT } }, { upsert: true });
                    continue;
                }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = `${P.SOURCE}/${slug}/${cleNum(p.numero)}-${p.carteId}-${P.LANGUE}.webp`;
                await deposer(bucket, cleR2, webp.data, 'image/webp');                   // R2 AVANT la ligne
                const origine = origines.get(p.tuile.id) ?? null;
                await M.Image.updateOne({ _id }, {
                    $set: {
                        source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, nomEn: p.nomEn, idProduct: p.idProduct,
                        idTuile: p.tuile.id, nomSource: p.tuile.nom, numeroSource: p.tuile.numero, preuve: p.preuve, voie: p.voie, urlOriginal: p.url,
                        provenance: provenanceDe(origine), urlOfficielle: origine?.officielle ?? null, urlOrigineDeclaree: origine?.native ?? null,
                        wOriginal: meta.width, hOriginal: meta.height, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length,
                        cleR2, sha256: sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                        // la langue par LA règle (collecte-cartes/langue-visuel.js), celle qu'un rejeu relira : `langueSource` est la langue de la page
                        langueSource: P.LANGUE, ...(({ langue, preuve }) => ({ langue, languePreuve: preuve }))(langueDuVisuel({ source: P.SOURCE, langueSource: P.LANGUE })),
                        attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, telechargeLe: new Date(), etat: 'ok'
                    }, $unset: { erreur: 1 }
                }, { upsert: true });
                telecharges++;
                if (telecharges % 25 === 0) await E.updateOne({ _id: idEtat }, { $set: { derniereRequete: new Date(), requetes: client.compteRequetes() } });
            } catch (err) {
                if (err.bloque) { bloque = err; break; }
                echecs++;
                if (echecTransitoire(err)) echecsTransitoires++;
                console.warn(`   ✗ ${_id} (${p.url}) : ${err.message}`);
                if (deja?.etat === 'ok') await M.Image.updateOne({ _id }, { $set: { dernierEssai: { le: new Date(), url: p.url, resultat: `échec : ${err.message}` } } });
                else await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, etat: 'echec', erreur: err.message, lot: P.LOT } }, { upsert: true });
                if (err.arret) { arretClient = err; break; }                              // la première ERREUR RÉPÉTÉE arrête : plus aucune requête dans ce passage
                if (/verrou/.test(err.message)) break;
            }
        }
        if (bloque) await conclureBloque(E, unite, bloque, client, { seulementAlerte: true });
        else if (arretClient && !arretClient.plafond) await conclureBloque(E, unite, arretClient, client, { seulementAlerte: true });   // l'erreur répétée pose l'alerte aussi
        if (!bloque && !arretClient && (arretDemande || !verrou.tenu)) return { code: unite._id, etat: 'interrompu', telecharges };

        // ---- 5. JOINTURE ADDITIVE, sous sa garde -------------------------------------------------------------------------------
        const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
        const avant = await compterEntrees(db, carteIds, slug);
        const images = await M.Image.find({ source: P.SOURCE, set: slug, etat: 'ok', lot: P.LOT }).lean();
        let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null;
        try {
            for (const im of images) {
                const c = await M.Carte.findById(im.carteId).select('images').lean();
                if (!c) { cartesAbsentes++; continue; }                                   // une image sans sa carte : comptée, elle fait tomber la concordance
                const autres = (c.images || []).filter(e => !(e.source === P.SOURCE && e.set === slug && e.numero === im.numero));
                if (T.dejaServi({ images: autres }, slug, im.numero)) {
                    // une AUTRE source sert ce numéro (posé entre deux passages) : on ne touche pas à son entrée, et la nôtre lui CÈDE la place
                    dejaParAutre++;
                    await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero } } });
                    continue;
                }
                const entree = { set: slug, source: P.SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, preuve: im.preuve,
                    numero: im.numero, attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, langue: im.langue, languePreuve: im.languePreuve,
                    provenance: im.provenance, urlOfficielle: im.urlOfficielle ?? null, urlOrigineDeclaree: im.urlOrigineDeclaree ?? null, jointeLe: new Date() };
                await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero } } });
                await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                joints++;
            }
        } catch (e) { erreurJointure = e.message; console.error(`🔴 ${unite._id} : jointure interrompue — ${e.message}`); }
        const apres = await compterEntrees(db, carteIds, slug);
        const garde = avant.autres === apres.autres && apres.siennes === joints;
        if (!garde) console.error(`🔴 ${unite._id} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres}${avant.autres === apres.autres ? '' : ' (CHANGÉES)'}, entrées ${P.SOURCE} ${apres.siennes} pour ${joints} jointes`);
        // ---- LES VIGNETTES (200 px) : une jointure RÉÉCRIT les entrées, et lot-additif ne vignette pas — même appel que le worker (§21 bis) ----
        const W = await vignetter(db, slug, { bucket: process.env.R2_BUCKET_IMAGES, arreter: () => arretDemande });
        console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.depuisDocument ?? 0} recopiée(s) · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)${W.vg.interrompu ? ' · interrompu' : ''}`}`);
        const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
        const complet = {
            source: P.SOURCE, langue: P.LANGUE, code: L.code, codePk: L.codePk, mention: P.MENTION, lot: P.LOT, provenance: P.PROVENANCE_PAR_DEFAUT,
            page: { tuiles: V.tuiles, auCodeDuSet: V.bonnes }, vignettes: W.vg,
            produits: Pl.produits, trous: Pl.trous, prouves: Pl.plan.length, restes: motifs, suffixesInconnus: Pl.suffixesInconnus.length, exemplesSuffixesInconnus: Pl.suffixesInconnus.slice(0, 5).map(s => s.nom),
            telecharges, sautes, absents, echecs, echecsTransitoires, tropPetits, retires, joints, dejaParAutre, cartesAbsentes,
            garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: avant.autres === apres.autres, siennesApres: apres.siennes, ok: garde },
            requetes: client.compteRequetes(), requetesParHote: client.requetesParHote(), bloque: bloque ? bloque.message : null, arret: arretClient ? arretClient.message : null, erreurJointure,
            concordance: garde && !erreurJointure && !bloque && !arretClient && vignettesOk && echecs === 0 && cartesAbsentes === 0
                && telecharges + sautes + tropPetits + retires + absents === Pl.plan.length && joints + dejaParAutre === images.length,
            verifieLe: new Date()
        };
        await M.Set.updateOne({ _id: slug }, { $set: { visuelsPikaqian: complet } });
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: client.compteRequetes(), bilan: complet } }, { upsert: true });
        console.log(`   ${P.SOURCE} ${slug} : prouvés ${Pl.plan.length} · téléchargés ${telecharges} · repris ${sautes} · absents (404) ${absents} · sous le seuil ${tropPetits} · échecs ${echecs} · joints ${joints} · garde ${garde ? '✅' : '❌'} · requêtes ${client.compteRequetes()}`);
        // bloquée en cours de route : ce qui a été prouvé et téléchargé AVANT est joint ; l'unité est `incomplet`, l'alerte est écrite
        if (bloque) return { code: unite._id, etat: 'incomplet', erreur: bloque.message, ...complet };
        if (erreurJointure) return { code: unite._id, etat: 'incomplet', erreur: erreurJointure, ...complet };
        if (!garde) return { code: unite._id, etat: 'non-concordant', ...complet };
        // un arrêt par erreur répétée n'est un verdict sur rien : transitoire (5xx, coupure) → l'unité revient en file (issue-unite.js, §58)
        const transitoire = !complet.concordance && echecs > 0 && echecs === echecsTransitoires;
        return { code: unite._id, etat: complet.concordance ? 'verifie' : transitoire ? 'incomplet-transitoire' : 'incomplet', ...(arretClient ? { erreur: arretClient.message } : {}), ...complet };
    } finally {
        // le compteur d'échecs de suite survit à l'unité ; un arrêt par erreur répétée l'a converti en alerte, il repart à zéro
        const arrete = client.arret();
        await E.updateOne({ _id: P.ID_SUITE }, { $set: { suite: arrete?.repetee ? 0 : client.suiteEchecs(), le: new Date() } }, { upsert: true });
        await verrouSet.rendre();
    }
}

/** Une source qui bloque : l'ALERTE s'écrit (lue par file-a-l-arret.js), on s'arrête. Elle ne se rouvre que par une décision (l'alerte désactivée à la main). */
async function conclureBloque(E, unite, err, client, { seulementAlerte = false } = {}) {
    await E.updateOne({ _id: P.ID_ALERTE }, { $set: { active: true, constateLe: new Date(), motif: err.message, status: err.status ?? null, unite: unite._id, requetes: client.compteRequetes() }, $setOnInsert: { depuis: new Date() } }, { upsert: true });
    console.error(`⛔ ${unite._id} : ${err.message}`);
    if (seulementAlerte) return null;
    return { code: unite._id, etat: 'refuse-source-bloquee', erreur: err.message, status: err.status ?? null, sansJointure: true };
}

/**
 * LE LANCEMENT de l'écriture locale (le set test), rejoué par le banc. 🔴 `verifierBucket` d'abord : le bucket vit en juridiction UE et le point d'accès
 * générique répond AccessDenied (r2.js) ; on ne télécharge rien — pas une requête vers pikaqian, pas un dépôt — si le bucket ne répond pas.
 */
async function lancerEcriture(slugs, M, { verrou, client, R2 = r2, bucket = process.env.R2_BUCKET_IMAGES, vignetter, fabriquerVerrouSet } = {}) {
    if (!bucket) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune requête, aucune écriture');
    await R2.verifierBucket(bucket);
    const resultats = [];
    let code = 0;
    for (const slug of slugs) {
        if (arretDemande) break;
        const L = lignePikaqian(slug);
        if (!L) { console.error(`❌ ${slug} : absent de collecte-cartes/pikaqian-sets.js`); code = 1; continue; }
        const r = await collecterSet(require('./collecte-cartes/pikaqian-sets').uniteDeLaLigne(L), M, { verrou, client, vignetter, fabriquerVerrouSet, deposer: (b, c, d, t) => R2.deposerBinaire(b, c, d, t) });
        resultats.push(r);
        console.log(`SET ${slug} → ${r.etat}`);
        if (r.etat !== 'verifie') code = 1;
        if (client.arret()) break;
    }
    return { code, resultats };
}

module.exports = { collecterSet, releve, planifier, lancerEcriture, provenanceDe, STOP_OCTETS, TABLE_PIKAQIAN, SOURCE: P.SOURCE, VERROU_GLOBAL: P.VERROU_GLOBAL };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE : le worker importe `collecterSet`.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion ; --plan et --ecrire exigent --sets=.
const AUTORISES = [/^--plan$/, /^--verrou$/, /^--ecrire$/, /^--sets=[A-Za-z0-9][A-Za-z0-9-]*(,[A-Za-z0-9][A-Za-z0-9-]*)*$/, /^--html=.+\.html$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--verrou', '--ecrire'].filter(m => args.includes(m));
const voulus = args.find(a => a.startsWith('--sets='))?.slice(7).split(',');
if (inconnus.length || modes.length !== 1 || (modes[0] !== '--verrou' && !voulus) || (modes[0] === '--plan' && voulus.length > 3) || (args.some(a => a.startsWith('--html=')) && modes[0] !== '--plan')) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}un seul mode parmi --plan, --verrou, --ecrire ; --plan et --ecrire exigent --sets=<slug>,… (jamais « tous » ; --plan : 3 sets au plus) ; --html=<fichier>.html (avec --plan) garde la page lue. Ex. : --plan --sets=Dynamax-Clash-Flame`);
    process.exit(2);
}
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: args.includes('--ecrire') ? ['R2_BUCKET_IMAGES'] : [] });
    const M = modeles(cx);
    const E = cx.db.collection('collecte_images_etat');
    const verrouDoc = async () => (await M.EtatImages.findById(P.VERROU_GLOBAL).lean())?.verrou;
    const alerte = async () => E.findOne({ _id: P.ID_ALERTE, active: true });
    if (args.includes('--verrou')) {
        const v = await verrouDoc(), b = await alerte();
        console.log(`${P.VERROU_GLOBAL} : ${v ? `🔒 pid ${v.pid} sur ${v.hote}, commit ${v.commit}, battement il y a ${Math.round((Date.now() - new Date(v.depuis)) / 1000)} s` : 'libre'}${b ? ` · ⛔ BLOQUÉ depuis ${new Date(b.depuis).toISOString()} : ${b.motif}` : ''}`);
        await fermer(); return;
    }
    if (args.includes('--plan')) {
        // LA SIMULATION : une page par set (et robots.txt), AUCUNE image, AUCUNE écriture. Le verrou global n'est pas pris (ce serait une écriture) : il est LU —
        // un détenteur frais, ou une alerte active, et la simulation ne part pas ; le client reçoit un verrou en mémoire, tenu le temps de la simulation.
        const v = await verrouDoc(), b = await alerte();
        if (b) { console.error(`⛔ source bloquée depuis ${new Date(b.depuis).toISOString()} : ${b.motif} — aucune requête.`); await fermer(); process.exit(1); }
        if (v && Date.now() - new Date(v.depuis) < P.VERROU_GLOBAL_MS) { console.error(`⛔ ${P.VERROU_GLOBAL} tenu par pid ${v.pid} sur ${v.hote} (battement il y a ${Math.round((Date.now() - new Date(v.depuis)) / 1000)} s) — la cadence se compte chez la source, pas de second client.`); await fermer(); process.exit(1); }
        const client = P.fabriquerClientPikaqian({ verrou: { tenu: true, perdu: false } });
        let trous = 0, prouves = 0, produits = 0;
        try {
            for (const slug of voulus) {
                const L = lignePikaqian(slug);
                if (!L) { console.log(`${slug.padEnd(42)} absent de collecte-cartes/pikaqian-sets.js`); continue; }
                const html = await client.page(P.urlSet(L.codePk));
                if (html == null) { console.log(`${slug.padEnd(42)} page /sets/${L.codePk} : 404`); continue; }
                const htmlOpt = args.find(a => a.startsWith('--html='))?.slice(7);
                if (htmlOpt) require('fs').writeFileSync(htmlOpt, html);
                const tuiles = P.lireTuiles(html);
                const V = P.verdictDePage({ tuiles, code: L.codePk });
                if (!V.ok) { console.log(`${slug.padEnd(42)} page refusée : ${V.motif}`); continue; }
                const Pl = await planifier(cx.db, slug, L, tuiles);
                trous += Pl.trous; prouves += Pl.plan.length; produits += Pl.produits;
                const motifs = {}; for (const r of Pl.restes) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
                const foils = tuiles.filter(t => P.estFoil(t.nom)).length;
                console.log(`${slug.padEnd(42)} ${L.codePk.padEnd(8)} tuiles ${V.tuiles} (au code ${V.bonnes}, foil ${foils}) · produits ${String(Pl.produits).padStart(4)} · trous ${String(Pl.trous).padStart(4)} · APPARIÉS ${String(Pl.plan.length).padStart(4)} · restes ${JSON.stringify(motifs)} · tuiles à suffixe INCONNU ${Pl.suffixesInconnus.length}${Pl.suffixesInconnus.length ? ` (${Pl.suffixesInconnus.slice(0, 3).map(s => s.nom).join(' | ')})` : ''}`);
                for (const r of Pl.restes.slice(0, 8)) console.log(`      trou ${r.motif} : carte ${r.carteId} « ${r.nomEn} » n° ${r.numero}${r.detail ? ` — ${r.detail}` : ''}`);
            }
        } catch (e) { console.error(`❌ ${e.message}`); process.exitCode = 1; }
        console.log(`\nSIMULATION (aucune image, aucune écriture) : ${prouves} appariés sur ${trous} trous (${produits} produits) · requêtes ${client.compteRequetes()} ${JSON.stringify(client.requetesParHote())} · cadence ${client.cadence() / 1000} s · bloque ${client.bloque() ? client.bloque().message : 'non'}`);
        await fermer(); return;
    }
    // --ecrire : sous lot-additif.js, par le coordinateur. Verrou global pris et LIÉ au client ; arrêt au premier défi ou à la première erreur répétée.
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: P.VERROU_GLOBAL, dureeMs: P.VERROU_GLOBAL_MS, surPerte, nom: `verrou global ${P.SOURCE}` });
    const tenuPar = await verrou.prendre();
    if (tenuPar) { console.error(`❌ ${P.VERROU_GLOBAL} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}`); await fermer(); process.exit(1); }
    const client = P.fabriquerClientPikaqian({ verrou });
    let code = 0;
    try { code = (await lancerEcriture(voulus, M, { verrou, client })).code; }
    catch (e) { console.error('❌', e.message); code = 1; }
    finally { await verrou.rendre(); await fermer(); }
    console.log(`REQUÊTES : ${JSON.stringify(client.requetesParHote())}`);
    process.exit(code);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
