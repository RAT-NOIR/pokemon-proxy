// ============================================================
// COLLECTEUR D'IMAGES — pokumon.com (Prize Packs S1-S4, tampon visible) -> R2 (WebP) + base `cartes` (2026-10-17)
// ============================================================
//   node collecteur-images-pokumon.js --plan [--series=1,2,3,4]      la SIMULATION : zéro requête (l'index vient du cache, la base se lit seulement)
//   node collecteur-images-pokumon.js --verrou                       qui tient le verrou global, lecture seule
//   node lot-additif.js --quoi="…" --collections=cartes,images,sets,collecte_images_etat -- node collecteur-images-pokumon.js --ecrire --series=1,2,3,4
//
// ⛔ AUCUNE ÉCRITURE PAR CE FICHIER SANS `--ecrire` : l'exécution est LOCALE, sous `lot-additif.js`, lancée par le coordinateur — pas d'unité du worker. Le retrait en un lot :
// retirer-visuels-pokumon.js.
//
//   0. GARDES, par ce qu'elles AUTORISENT : la source n'est pas bloquée, les quatre sets sont en base au tirage `intl`, la base sous 400 Mo, des produits joints.
//   1. L'INDEX : la liste des cartes des quatre séries (≈ 9 requêtes, mises en cache pour la reprise) — AVANT toute écriture, avant tout verrou de set.
//   2. LE PLAN, sur les QUATRE séries à la fois (le témoin du dénominateur se compte sur toutes) : lire collecte-cartes/pokumon.js (apparier, planifierPokumon).
//   3. TÉLÉCHARGEMENT (cadence 5 s, verrou lié) : seuil de largeur existant, WebP. Un original sous le seuil est écarté, COMPTÉ et écrit « trop-petit ».
//   4. R2 AVANT la ligne `images` (source, mention, lot, langue, preuve), puis JOINTURE ADDITIVE sous sa garde, puis les VIGNETTES.
// 🔑 `cartes_produits.visuelSubstitut` N'EST JAMAIS TOUCHÉ : le site ne l'affiche que si la fiche n'a aucun visuel propre (lib/visuelSubstitut.ts, règle 1) — l'image propre le masque d'elle-même,
// et le retrait du lot le fait revenir. La garde de chaque série compte les substituts avant et après : ils doivent être identiques.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const r2 = require('./collecte-cartes/r2');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { largeurAdmiseDe, aRejuger, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { marqueDe, arbitrer, remplacerBasseDefinition, empreinteEntree } = require('./collecte-cartes/basse-definition');   // BASSE-DEF : la marque (200 à 349 px) et le remplacement d'une entrée marquée par une image non marquée
const { champsTracabilite, champsDeLEntree, compterSansAdresse } = require('./collecte-cartes/tracabilite');   // doctrine de collecte : retirable, adresse d'origine, date (une seule règle)
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { echecTransitoire } = require('./collecte-cartes/issue-unite');
const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
const P = require('./collecte-cartes/pokumon');

const VERROU_SET_MS = 10 * 60 * 1000;
const STOP_OCTETS = 400 * 1024 * 1024;
const FORMATS = ['png', 'jpeg', 'webp'];
const DOSSIER_CACHE = path.join(__dirname, 'collecte-cartes', 'rapports', 'cache-pokumon');   // collecte-cartes/rapports/ est dans .gitignore
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';

let arretDemande = false;
process.on('SIGINT', () => { arretDemande = true; });
process.on('SIGTERM', () => { arretDemande = true; });
const surPerte = () => { arretDemande = true; process.exitCode = 1; };

// ── L'INDEX ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Toutes les entrées des séries demandées (≈ 9 requêtes pour S1-S4, moins avec le cache) : lues, dédoublonnées. Le client est LIÉ au verrou global. */
async function chargerIndex(client, series = [1, 2, 3, 4]) {
    const brutes = [];
    let requetes = 0;
    for (const serie of series) {
        let pages = 1, total = null;
        const ids = new Set();
        for (let page = 1; page <= pages && page <= 9; page++) {
            const r = await client.index(serie, page);
            if (!r.depuisCache) requetes++;
            pages = r.pages || 1;
            total = r.total ?? total;
            for (const c of r.entrees) ids.add(c?.id);
            brutes.push(...r.entrees);
        }
        if (pages > 9) throw new Error(`série ${serie} : ${pages} pages annoncées, au-delà de ce que le client lit (9) — on s'arrête`);
        // 🔴 le total annoncé par la source est comparé au nombre d'entrées lues : une liste qui saute des entrées (ordre instable) ne passe pas pour complète
        if (total != null && ids.size !== total) throw new Error(`série ${serie} : ${ids.size} entrées lues pour ${total} annoncées par la source — la liste est incomplète, on s'arrête`);
    }
    const entrees = P.construireIndex(brutes);
    // la garde : une liste d'une série doit contenir des entrées de cette série (un index qui ne parle pas des Prize Packs est une clé fausse, §41)
    for (const s of series) if (!entrees.some(e => e.series.includes(s))) throw new Error(`l'index lu ne contient AUCUNE entrée de la série ${s} (${entrees.length} entrées) — une clé fausse, pas une absence`);
    return { entrees, requetes };
}
/** Le cache de l'index sur disque : une page rejouée n'est pas redemandée tant qu'elle a moins de `ageMaxH` heures. */
function cacheSurDisque(dossier = DOSSIER_CACHE, ageMaxH = 12) {
    fs.mkdirSync(dossier, { recursive: true });
    const f = cle => path.join(dossier, `${cle}.json`);
    return {
        lire(cle) { try { const s = fs.statSync(f(cle)); return Date.now() - s.mtimeMs < ageMaxH * 3600 * 1000 ? fs.readFileSync(f(cle), 'utf8') : null; } catch { return null; } },
        ecrire(cle, texte) { fs.writeFileSync(f(cle), texte); }
    };
}
const fichierIndex = (dossier = DOSSIER_CACHE, nom = 'index.json') => path.join(dossier, nom);
function ecrireIndex(entrees, dossier = DOSSIER_CACHE, nom = 'index.json') { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(fichierIndex(dossier, nom), JSON.stringify({ le: new Date().toISOString(), entrees })); }
function lireIndexEnCache(dossier = DOSSIER_CACHE, nom = 'index.json') {
    let v; try { v = JSON.parse(fs.readFileSync(fichierIndex(dossier, nom), 'utf8')); } catch { throw new Error(`index absent (${fichierIndex(dossier, nom)}) : le plan se fait sur l'index lu, jamais sur un index deviné — il se télécharge avec --ecrire (≈ 9 requêtes pour S1-S4, ≈ 45 pour les autres familles) ou par le client`); }
    if (!Array.isArray(v.entrees) || !v.entrees.length) throw new Error(`index illisible ou vide (${fichierIndex(dossier, nom)})`);
    return v;
}
/** L'index des AUTRES familles : les listes anglaises des jeux de promos que les lignes citent (≈ 45 requêtes), ordre total par id, total annoncé comparé à ce qui est lu. */
async function chargerIndexFamilles(client, lignes = P.LIGNES_AUTRES) {
    const brutes = [];
    let requetes = 0;
    for (const jeu of [...new Set(lignes.map(l => l.jeu))]) {
        let pages = 1, total = null;
        const ids = new Set();
        for (let page = 1; page <= pages && page <= 30; page++) {
            const r = await client.indexPromoSet(jeu, page);
            if (!r.depuisCache) requetes++;
            pages = r.pages || 1; total = r.total ?? total;
            for (const c of r.entrees) ids.add(c?.id);
            brutes.push(...r.entrees);
        }
        if (pages > 30) throw new Error(`jeu ${jeu} : ${pages} pages annoncées, au-delà de ce que le client lit (30) — on s'arrête`);
        if (total != null && ids.size !== total) throw new Error(`jeu ${jeu} : ${ids.size} entrées lues pour ${total} annoncées par la source — la liste est incomplète, on s'arrête`);
        if (!ids.size) throw new Error(`jeu ${jeu} : aucune entrée lue — une clé fausse, pas une absence`);
    }
    return { entrees: P.construireIndex(brutes), requetes };
}

// ── LE PLAN : lecture seule ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Les produits Cardmarket des quatre séries (numeros_cartes + catalogue_produits, base de production en LECTURE SEULE) : { idProduct, slugSet, slugProduit, nomCm }.
 * Il LÈVE quand la lecture ne rend rien : une clé fausse, pas une absence (§41).
 */
async function lireProduitsCm(prod, slugs) {
    const nc = await prod.collection('numeros_cartes').find({ slugSet: { $in: slugs } }, { projection: { idProduct: 1, slug: 1, slugSet: 1, numero: 1 } }).toArray();
    if (!nc.length) throw new Error(`numeros_cartes : 0 ligne pour ${slugs.length} sets — une clé fausse (§41)`);
    const cat = await prod.collection('catalogue_produits').find({ idProduct: { $in: nc.map(x => x.idProduct) } }, { projection: { idProduct: 1, name: 1 } }).toArray();
    if (!cat.length) throw new Error('catalogue_produits : 0 ligne pour les produits des Prize Packs — une clé fausse (§41)');
    const noms = new Map(cat.map(c => [c.idProduct, c.name]));
    return nc.map(x => ({ idProduct: x.idProduct, slugSet: x.slugSet, slugProduit: x.slug, numero: x.numero ?? null, nomCm: noms.get(x.idProduct) ?? null }));
}
/** Le plan des AUTRES familles (lecture seule de `cartes`) : TOUS les produits des sets des lignes, avec les impressions de leur carte (le témoin indépendant de la clé). */
async function planifierToutFamilles(db, produitsCm, index, lignes = P.LIGNES_AUTRES) {
    const slugs = [...new Set(lignes.flatMap(l => l.slugs))];
    const lp = await db.collection('cartes_produits').find({ slugSet: { $in: slugs } }, { projection: { carteId: 1, idProduct: 1, slugSet: 1 } }).toArray();
    if (!lp.length) throw new Error('cartes_produits : 0 ligne pour les sets des lignes — une clé fausse (§41)');
    const cm = new Map(produitsCm.map(p => [p.idProduct, p]));
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lp.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1, impressions: 1 } }).toArray()).map(c => [c._id, c]));
    const sansNom = [], produits = [], vus = new Set();
    for (const l of lp) {
        if (vus.has(l.idProduct)) continue; vus.add(l.idProduct);
        const p = cm.get(l.idProduct);
        if (!p || !p.nomCm || !p.slugProduit) { sansNom.push({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, motif: 'sans-nom-catalogue' }); continue; }
        produits.push({ idProduct: l.idProduct, carteId: l.carteId, unite: l.slugSet, nomCm: p.nomCm, slugProduit: p.slugProduit, numero: p.numero, impressions: cartes.get(l.carteId)?.impressions || [] });
    }
    const r = P.planifierFamilles({ lignes, produits, cartes, index });
    return { ...r, restes: [...r.restes, ...sansNom], produits: lp.length, comptes: { ...r.comptes, sansNomCatalogue: sansNom.length } };
}
/** Le plan des séries (toutes, pour le témoin) : lecture seule de la base `cartes`. */
async function planifierTout(db, produitsCm, index) {
    const slugs = P.TABLE_POKUMON.map(l => l.slug);
    const serieDe = new Map(P.TABLE_POKUMON.map(l => [l.slug, l.serie]));
    const lignes = await db.collection('cartes_produits').find({ slugSet: { $in: slugs } }, { projection: { carteId: 1, idProduct: 1, slugSet: 1 } }).toArray();
    if (!lignes.length) throw new Error('cartes_produits : 0 ligne pour les quatre sets — une clé fausse (§41)');
    const cm = new Map(produitsCm.map(p => [p.idProduct, p]));
    const sansNom = [], produits = [];
    for (const l of lignes) {
        const p = cm.get(l.idProduct);
        if (!p || !p.nomCm || !p.slugProduit) { sansNom.push({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, motif: 'sans-nom-catalogue' }); continue; }
        produits.push({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, serie: serieDe.get(l.slugSet), nomCm: p.nomCm, slugProduit: p.slugProduit });
    }
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    const r = P.planifierPokumon({ produits, cartes, index });
    return { ...r, restes: [...r.restes, ...sansNom], produits: lignes.length, comptes: { ...r.comptes, sansNomCatalogue: sansNom.length } };
}

/**
 * Les entrées des AUTRES sources, empreinte par empreinte (elles ne doivent pas bouger d'un octet) ; et le nombre des nôtres dans le set.
 */
async function compterEntrees(db, carteIds, slug) {
    const cs = await db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray();
    const autres = [];
    let siennes = 0;
    for (const c of cs) for (const e of c.images || []) { if (!(e?.source === P.SOURCE && e.lot === P.LOT)) autres.push(`${c._id}|${e?.source}|${e?.set}|${e?.numero ?? ''}|${e?.cleR2 ?? ''}`); else if (e.set === slug) siennes++; }
    return { autres: autres.sort().join('\n'), nAutres: autres.length, siennes, liste: autres };
}
const compterSubstituts = (db, slug) => db.collection('cartes_produits').countDocuments({ slugSet: slug, 'visuelSubstitut.cleR2': { $exists: true } });

/**
 * La collecte d'UNE série, sur le plan déjà calculé. `plan` : les entrées de CETTE série. Les options autres que `verrou`/`client` n'existent que pour le banc.
 */
function collecterSerie(serie, planSerie, restesSerie, M, o = {}) {
    const slug = P.ligneDe(serie).slug;
    return collecterUnite({ slug, serie, label: `S${serie}`, marque: p => `Prize Pack Series ${p.serie} : tampon « Play! Pokémon »` }, planSerie, restesSerie, M, o);
}
/** Une UNITÉ = un set Cardmarket à écrire (une série de Prize Pack, une année McDonald's, Trick or Trade 2022, Black Star MEP…). `unite.marque(p)` : le texte de marque de l'image `p` du plan. */
async function collecterUnite(unite, planSerie, restesSerie, M, { verrou, client, vignetter = vignetterApresJointure, deposer = (b, c, d, t) => r2.deposerBinaire(b, c, d, t), fabriquerVerrouSet = fabriquerVerrou, stopOctets = STOP_OCTETS, comptesPlan = null, memo = new Map() } = {}) {
    const slug = unite.slug, serie = unite.serie ?? null;
    const db = M.Carte.db.db;
    const E = db.collection('collecte_images_etat');
    const refus = (etat, erreur) => { console.error(`❌ ${slug} : ${erreur}.`); return { code: slug, etat, erreur, sansJointure: true }; };
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
        const motifs = {}; for (const r of restesSerie) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
        console.log(`\n══ ${slug} (S${serie}) : ${produits} produits · PROUVÉS ${planSerie.length} · restes ${JSON.stringify(motifs)} ══`.replace(`(S${serie})`, `(${unite.label})`));
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'telechargement', restes: restesSerie.slice(0, 1000), derniereRequete: new Date() } });
        const substitutsAvant = await compterSubstituts(db, slug);

        // ---- 3. TÉLÉCHARGEMENT : le WebP est gardé en mémoire, rien n'est écrit avant la fin ---------------------------------------------
        const bucket = process.env.R2_BUCKET_IMAGES;
        let sautes = 0, echecs = 0, echecsTransitoires = 0, tropPetits = 0, retires = 0, absents = 0, mauvaisFormat = 0;
        const obtenus = [];
        for (const p of planSerie) {
            if (arretDemande || !verrou.tenu) break;
            const _id = P.idImagePokumon(slug, p.carteId, p.numero);
            const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat wOriginal partageeHoloNonHolo').lean();
            if (deja?.etat === 'retire') { retires++; continue; }                       // un visuel retiré ne revient jamais sans une décision
            if (deja?.sha256 && deja.urlOriginal === p.url && deja.etat === 'ok') {
                // PP-HOLO : un document déjà posé reçoit quand même le champ explicite (la jointure le lit sur le document)
                if (p.partageeHoloNonHolo && !(deja.partageeHoloNonHolo === true)) await M.Image.updateOne({ _id }, { $set: { partageeHoloNonHolo: true, produitsPartages: p.produitsPartages } });
                sautes++; continue;
            }
            // ➕ BASSE-DEF : le seuil est celui de la LIGNE du plan (plancher de 200 px pour les quatre lignes McDonald's nommées, 350 px ailleurs) ; un « trop-petit » jugé sous un seuil plus haut se REJUGE (§23)
            if (deja?.etat === 'trop-petit' && deja.urlOriginal === p.url && !aRejuger(deja, P.SOURCE, p.ligne)) { tropPetits++; continue; }
            try {
                // une entrée Pokumon commune à deux séries est UN fichier : il se télécharge UNE fois (courtoisie envers la source) et sert les deux fiches
                let o = memo.get(p.url);
                if (!o) {
                    const buffer = await client.image(p.url);
                    if (!buffer) o = { genre: 'absent' };                                // 404 : l'image n'existe plus à la source, le trou reste
                    else {
                        const meta = await sharp(buffer).metadata();
                        if (!FORMATS.includes(meta.format)) o = { genre: 'format', meta };
                        else if (!meta.width || meta.width < largeurAdmiseDe(P.SOURCE, p.ligne)) o = { genre: 'trop-petit', meta };
                        else o = { genre: 'ok', meta, webp: await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true }), sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length };
                    }
                    memo.set(p.url, o);
                }
                if (o.genre === 'absent') { absents++; continue; }
                if (o.genre === 'format') { mauvaisFormat++; echecs++; console.warn(`   ✗ ${_id} : format « ${o.meta.format} »`); continue; }
                if (o.genre === 'trop-petit') {
                    tropPetits++;
                    await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, wOriginal: o.meta.width, hOriginal: o.meta.height, etat: 'trop-petit', seuilApplique: largeurAdmiseDe(P.SOURCE, p.ligne), lot: P.LOT } }, { upsert: true });
                    continue;
                }
                obtenus.push({ p, _id, meta: o.meta, webp: o.webp, sha1Original: o.sha1Original, octetsOriginal: o.octetsOriginal });
            } catch (err) {
                if (err.bloque) { bloque = err; break; }
                echecs++;
                if (echecTransitoire(err)) echecsTransitoires++;
                console.warn(`   ✗ ${_id} (${p.url}) : ${err.message}`);
                await M.Image.updateOne({ _id }, { $set: { source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, urlOriginal: p.url, etat: 'echec', erreur: err.message, lot: P.LOT } }, { upsert: true });
                if (/verrou|plafond/.test(err.message)) break;
            }
        }
        if (bloque) await conclureBloque(E, slug, bloque, client);
        if (!bloque && (arretDemande || !verrou.tenu)) return { code: slug, etat: 'interrompu', sansJointure: true };

        // ---- 4. R2 AVANT la ligne -------------------------------------------------------------------------------------------------------
        let telecharges = 0;
        for (const o of obtenus) {
            const { p } = o;
            const cleR2 = `${P.SOURCE}/${slug}/${cleNum(p.numero)}-${p.carteId}-en.webp`;
            await deposer(bucket, cleR2, o.webp.data, 'image/webp');
            await M.Image.updateOne({ _id: o._id }, {
                $set: {
                    source: P.SOURCE, set: slug, carteId: p.carteId, numero: p.numero, nomEn: p.nomEn, idProduct: p.idProduct, preuve: p.preuve, voie: p.voie, urlOriginal: p.url, pokumonId: p.entreeId, pokumonLien: p.lien,
                    marque: unite.marque(p),
                    ...(p.partageeHoloNonHolo ? { partageeHoloNonHolo: true, produitsPartages: p.produitsPartages } : {}),
                    wOriginal: o.meta.width, hOriginal: o.meta.height, sha1Original: o.sha1Original, octetsOriginal: o.octetsOriginal,
                    cleR2, sha256: sha('sha256', o.webp.data), octets: o.webp.data.length, w: o.webp.info.width, h: o.webp.info.height, fmt: 'webp',
                    // ➕ BASSE-DEF : la marque d'après la largeur de l'ORIGINAL (200 à 349 px : basseDefinition: true) ; une marque qui ne décrit plus l'image (refournie plus large) s'efface du document
                    ...marqueDe({ wOriginal: o.meta.width }),
                    langueSource: 'en', ...(({ langue, preuve }) => ({ langue, languePreuve: preuve }))(langueDuVisuel({ source: P.SOURCE, langueSource: 'en' })),
                    attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, telechargeLe: new Date(), etat: 'ok', ...champsTracabilite({ urlOriginal: p.url, collecteLe: new Date() })
                }, $unset: { erreur: 1, ...(marqueDe({ wOriginal: o.meta.width }).basseDefinition ? {} : { basseDefinition: 1 }) }
            }, { upsert: true });
            telecharges++;
        }

        // ---- 5. JOINTURE ADDITIVE, sous sa garde --------------------------------------------------------------------------------------
        const carteIds = [...new Set((await db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))];
        const avant = await compterEntrees(db, carteIds, slug);
        const images = await M.Image.find({ source: P.SOURCE, set: slug, etat: 'ok', lot: P.LOT }).lean();
        let joints = 0, dejaParAutre = 0, cartesAbsentes = 0, erreurJointure = null, basseDefRemplacees = 0;
        const retirees = [];                              // BASSE-DEF : les entrées marquées sorties par le remplacement (empreintes de compterEntrees) : la garde les attend absentes
        try {
            for (const im of images) {
                const c = await M.Carte.findById(im.carteId).select('images').lean();
                if (!c) { cartesAbsentes++; continue; }
                const entree = { set: slug, source: P.SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, preuve: im.preuve,
                    numero: im.numero, attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date(), ...marqueDe(im), ...champsDeLEntree(im), ...(im.wOriginal ? { wOriginal: im.wOriginal } : {}),
                    // PP-HOLO : le champ explicite suit l'image (une image Prize Packs ordinaire n'a NI l'un NI l'autre)
                    ...(im.partageeHoloNonHolo === true ? { partageeHoloNonHolo: true, produitsPartages: im.produitsPartages } : {}) };
                // une AUTRE source sert déjà cette fiche (posée entre deux passages) : on ne touche pas à son entrée, et la nôtre lui CÈDE la place
                // (« cette fiche » = ce numéro : l'image d'un AUTRE numéro de la même carte — MEP012 pour MEP033 — ne sert pas la fiche, la règle du site la compare au numéro de la fiche)
                const autres = (c.images || []).filter(e => e && e.set === slug && !(e.source === P.SOURCE && e.lot === P.LOT) && e.cleR2 && (P.nImage(e.numero) === null || P.nImage(e.numero) === P.nImage(im.numero)));
                await M.Carte.updateOne({ _id: im.carteId }, { $pull: { images: { set: slug, source: P.SOURCE, numero: im.numero } } });
                // ➕ BASSE-DEF : une entrée MARQUÉE (basse définition) d'une autre source ne « sert » pas la fiche face à une image NON marquée : elle sort (la même fonction que artofpkm / Bulbapedia / TCGdex)
                // et la nôtre entre ; une image marquée (200 à 349 px) ne remplace jamais rien et cède
                const arb = arbitrer(autres, entree, restantes => restantes.length > 0);
                if (arb.servie) { dejaParAutre++; continue; }
                if (arb.sortantes.length) { await remplacerBasseDefinition(M, im.carteId, entree); for (const e of arb.sortantes) { retirees.push(empreinteEntree(im.carteId, e)); basseDefRemplacees++; } }
                await M.Carte.updateOne({ _id: im.carteId }, { $push: { images: entree } });
                joints++;
            }
        } catch (e) { erreurJointure = e.message; console.error(`🔴 ${slug} : jointure interrompue — ${e.message}`); }
        const apres = await compterEntrees(db, carteIds, slug);
        const substitutsApres = await compterSubstituts(db, slug);
        const attenduesAutres = avant.liste.filter(k => !retirees.includes(k)).sort().join('\n');     // les autres sources, MOINS les seules entrées marquées que ce passage a remplacées (échange 1 pour 1)
        const garde = attenduesAutres === apres.autres && apres.siennes === joints && substitutsAvant === substitutsApres;
        if (!garde) console.error(`🔴 ${slug} : GARDE — entrées des autres sources ${avant.nAutres} → ${apres.nAutres} (attendu ${avant.nAutres - retirees.length})${attenduesAutres === apres.autres ? '' : ' (CHANGÉES)'}, entrées ${P.SOURCE} ${apres.siennes} pour ${joints} jointes, substituts ${substitutsAvant} → ${substitutsApres}`);
        // ---- 6. LES VIGNETTES (200 px) : une jointure RÉÉCRIT les entrées, et lot-additif ne vignette pas — même appel que les autres collecteurs ----
        const W = await vignetter(db, slug, { bucket: process.env.R2_BUCKET_IMAGES, arreter: () => arretDemande });
        console.log(`   vignettes : ${W.vg.erreur ? `🔴 ${W.vg.erreur}` : `${W.vg.entrees} entrée(s) sans vignette · ${W.vg.depuisDocument} recopiée(s) · ${W.vg.fabriquees} fabriquée(s) · ${W.vg.echecs} échec(s)${W.vg.interrompu ? ' · interrompu' : ''}`}`);
        const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
        const complet = {
            vignettes: W.vg, source: P.SOURCE, mention: P.MENTION, lot: P.LOT, serie, produits, prouves: planSerie.length, restes: motifs, comptesPlan,
            telecharges, sautes, absents, echecs, echecsTransitoires, tropPetits, retires, mauvaisFormat, joints, dejaParAutre, cartesAbsentes,
            basseDefRemplacees, sansUrlOriginal: compterSansAdresse(images),
            garde: { autresAvant: avant.nAutres, autresApres: apres.nAutres, autresIdentiques: attenduesAutres === apres.autres, siennesApres: apres.siennes, substitutsAvant, substitutsApres, ok: garde },
            requetes: client.compteRequetes(), bloque: bloque ? bloque.message : null, erreurJointure,
            concordance: garde && !erreurJointure && !bloque && vignettesOk && echecs === 0 && cartesAbsentes === 0 && telecharges + sautes + tropPetits + retires + absents === planSerie.length && joints + dejaParAutre === images.length,
            verifieLe: new Date()
        };
        await M.Set.updateOne({ _id: slug }, { $set: { visuelsPokumon: complet } });
        await E.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: client.compteRequetes(), bilan: complet } });
        console.log(`   ${slug} : prouvés ${planSerie.length} · téléchargés ${telecharges} · repris ${sautes} · absents (404) ${absents} · sous le seuil ${tropPetits} · échecs ${echecs} · joints ${joints} · substituts ${substitutsAvant} → ${substitutsApres} · garde ${garde ? '✅' : '❌'} · requêtes ${client.compteRequetes()}`);
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
 * LE LANCEMENT de l'écriture, rejoué par le banc. 🔴 `verifierBucket` d'abord (le bucket vit en juridiction UE) : on ne télécharge rien si le bucket ne répond pas. Puis l'INDEX (le client, lié au
 * verrou global), puis le plan sur les quatre séries, puis une série après l'autre.
 * @param {number[]} series  les séries à écrire (1-4) ; le plan se calcule toujours sur les quatre
 * @returns {Promise<{code: number, resultats: object[], plan: object}>}
 */
async function lancerEcriture(series, M, { verrou, client, lireProduits, index = null, R2 = r2, bucket = process.env.R2_BUCKET_IMAGES, vignetter, fabriquerVerrouSet, stopOctets, ecrireIndexEnCache = null } = {}) {
    if (!bucket) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune requête, aucune écriture');
    if (typeof lireProduits !== 'function') throw new Error('aucune lecture des produits Cardmarket fournie : sans elle, la clé ne se construit pas');
    await R2.verifierBucket(bucket);
    const db = M.Carte.db.db;
    const E = db.collection('collecte_images_etat');
    const bloquee = await E.findOne({ _id: P.ID_ALERTE, active: true });
    if (bloquee) throw new Error(`${P.SOURCE} a bloqué le ${new Date(bloquee.depuis).toISOString()} (${bloquee.motif}) — aucune requête`);
    let entrees = index;
    if (!entrees) {
        const r = await chargerIndex(client);
        entrees = r.entrees;
        if (ecrireIndexEnCache) ecrireIndexEnCache(entrees);
        console.log(`index : ${entrees.length} entrées, ${r.requetes} requête(s) (le reste vient du cache)`);
    }
    const produitsCm = await lireProduits();
    const plan = await planifierTout(db, produitsCm, entrees);
    console.log(`PLAN : ${plan.plan.length} prouvés sur ${plan.produits} produits · restes ${JSON.stringify(plan.comptes.parMotif)} · placeholders rejetés ${plan.comptes.placeholders} (index : ${plan.comptes.placeholdersIndex})`);
    // le plafond suit le PLAN : un fichier distinct = une requête, plus le robots.txt de l'hôte d'images et une marge de 10 % pour les réessais
    const distinctes = new Set(plan.plan.filter(p => series.includes(p.serie)).map(p => p.url)).size;
    client.fixerPlafond(Math.min(P.PLAFOND_MAX, client.compteRequetes() + 1 + distinctes + Math.ceil(distinctes * 0.1) + 3));
    console.log(`REQUÊTES PRÉVUES : ${distinctes} fichiers distincts (une entrée commune à deux séries n'est téléchargée qu'une fois) + 1 robots.txt · plafond ${client.plafond()} · cadence ${P.CADENCE_MS / 1000} s ≈ ${Math.ceil((distinctes + 1) * P.CADENCE_MS / 60000)} min`);
    const resultats = [];
    const memo = new Map();                                    // url → fichier traité : une entrée commune à deux séries ne se télécharge qu'une fois
    let code = 0;
    for (const serie of series) {
        if (arretDemande) break;
        const slug = P.ligneDe(serie).slug;
        const r = await collecterSerie(serie, plan.plan.filter(p => p.serie === serie), plan.restes.filter(x => x.slugSet === slug), M, { verrou, client, vignetter, fabriquerVerrouSet, stopOctets, memo, comptesPlan: plan.comptes, deposer: (b, c, d, t) => R2.deposerBinaire(b, c, d, t) });
        resultats.push(r);
        console.log(`SERIE ${serie} (${slug}) → ${r.etat}`);
        if (r.etat !== 'verifie') code = 1;
        if (['refuse-source-bloquee', 'incomplet'].includes(r.etat) && client.bloque()) break;
    }
    return { code, resultats, plan };
}

/**
 * LE LANCEMENT des AUTRES familles (McDonald's, Trick or Trade, Professor Program, Black Star) : même garde que les Prize Packs (bucket d'abord, alerte de blocage, plafond qui suit le plan), un set après
 * l'autre. `ids` : les lignes à écrire (défaut : toute la table) ; le plan se calcule toujours sur toutes les lignes (le groupe se compte sur tous les produits).
 */
async function lancerEcritureFamilles(ids, M, { verrou, client, lireProduits, index = null, R2 = r2, bucket = process.env.R2_BUCKET_IMAGES, vignetter, fabriquerVerrouSet, stopOctets, ecrireIndexEnCache = null } = {}) {
    if (!bucket) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune requête, aucune écriture');
    if (typeof lireProduits !== 'function') throw new Error('aucune lecture des produits Cardmarket fournie : sans elle, la clé ne se construit pas');
    const inconnues = (ids || []).filter(i => !P.LIGNES_AUTRES.some(l => l.id === i));
    if (inconnues.length) throw new Error(`ligne(s) inconnue(s) : ${inconnues.join(', ')} — la table dit : ${P.LIGNES_AUTRES.map(l => l.id).join(', ')}`);
    await R2.verifierBucket(bucket);
    const db = M.Carte.db.db;
    const E = db.collection('collecte_images_etat');
    const bloquee = await E.findOne({ _id: P.ID_ALERTE, active: true });
    if (bloquee) throw new Error(`${P.SOURCE} a bloqué le ${new Date(bloquee.depuis).toISOString()} (${bloquee.motif}) — aucune requête`);
    let entrees = index;
    if (!entrees) {
        const r = await chargerIndexFamilles(client);
        entrees = r.entrees;
        if (ecrireIndexEnCache) ecrireIndexEnCache(entrees);
        console.log(`index : ${entrees.length} entrées, ${r.requetes} requête(s) (le reste vient du cache)`);
    }
    const plan = await planifierToutFamilles(db, await lireProduits(), entrees);
    console.log(`PLAN : ${plan.plan.length} prouvés sur ${plan.produits} produits · restes ${JSON.stringify(plan.comptes.parMotif)} · sous le seuil ${plan.comptes.sousSeuil} · placeholders rejetés ${plan.comptes.placeholders}`);
    const voulues = P.LIGNES_AUTRES.filter(l => !ids || !ids.length || ids.includes(l.id));
    const unites = [...new Set(voulues.flatMap(l => l.slugs))];
    const distinctes = new Set(plan.plan.filter(p => unites.includes(p.slugSet)).map(p => p.url)).size;
    client.fixerPlafond(Math.min(P.PLAFOND_MAX, client.compteRequetes() + 1 + distinctes + Math.ceil(distinctes * 0.1) + 3));
    console.log(`REQUÊTES PRÉVUES : ${distinctes} fichiers distincts + 1 robots.txt · plafond ${client.plafond()} · cadence ${P.CADENCE_MS / 1000} s ≈ ${Math.ceil((distinctes + 1) * P.CADENCE_MS / 60000)} min`);
    const resultats = [], memo = new Map();
    let code = 0;
    for (const slug of unites) {
        if (arretDemande) break;
        const labels = voulues.filter(l => l.slugs.includes(slug)).map(l => l.id).join('+');
        const r = await collecterUnite({ slug, label: labels, marque: p => p.marque }, plan.plan.filter(p => p.slugSet === slug), plan.restes.filter(x => x.slugSet === slug), M, { verrou, client, vignetter, fabriquerVerrouSet, stopOctets, memo, comptesPlan: plan.comptes, deposer: (b, c, d, t) => R2.deposerBinaire(b, c, d, t) });
        resultats.push(r);
        console.log(`UNITÉ ${labels} (${slug}) → ${r.etat}`);
        if (r.etat !== 'verifie') code = 1;
        if (['refuse-source-bloquee', 'incomplet'].includes(r.etat) && client.bloque()) break;
    }
    return { code, resultats, plan };
}

module.exports = { chargerIndex, chargerIndexFamilles, cacheSurDisque, ecrireIndex, lireIndexEnCache, lireProduitsCm, planifierTout, planifierToutFamilles, collecterSerie, collecterUnite, lancerEcriture, lancerEcritureFamilles, STOP_OCTETS, DOSSIER_CACHE };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion.
const AUTORISES = [/^--plan$/, /^--verrou$/, /^--ecrire$/, /^--series=[1-4](,[1-4])*$/, /^--familles$/, /^--lignes=[a-z0-9-]+(,[a-z0-9-]+)*$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--verrou', '--ecrire'].filter(m => args.includes(m));
const lignesSansFamilles = args.some(a => a.startsWith('--lignes=')) && !args.includes('--familles');
if (inconnus.length || modes.length !== 1 || lignesSansFamilles || (args.includes('--familles') && args.some(a => a.startsWith('--series=')))) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}un seul mode parmi --plan, --verrou, --ecrire ; --series=1,2,3,4 (défaut : les quatre). Ex. : --plan`);
    process.exit(2);
}
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    // la production (`test`) n'est ouverte que pour LIRE numeros_cartes et catalogue_produits (garde.js : « LECTURE SEULE »)
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: !args.includes('--verrou'), buckets: args.includes('--ecrire') ? ['R2_BUCKET_IMAGES'] : [] });
    const M = modeles(cx);
    const series = (args.find(a => a.startsWith('--series='))?.slice(9).split(',').map(Number)) || [1, 2, 3, 4];
    const familles = args.includes('--familles');
    const lignesVoulues = args.find(a => a.startsWith('--lignes='))?.slice(9).split(',') ?? null;
    if (lignesVoulues && !familles) { console.error('❌ --lignes n\'a de sens qu\'avec --familles'); process.exit(2); }
    const lireProduits = () => lireProduitsCm(prod.db, familles ? [...new Set(P.LIGNES_AUTRES.flatMap(l => l.slugs))] : P.TABLE_POKUMON.map(l => l.slug));
    if (args.includes('--plan') && familles) {
        const v = lireIndexEnCache(DOSSIER_CACHE, 'index-familles.json');
        const plan = await planifierToutFamilles(cx.db, await lireProduits(), v.entrees);
        const parLigne = {};
        for (const p of plan.plan) parLigne[p.ligne] = (parLigne[p.ligne] || 0) + 1;
        console.log(`SIMULATION (zéro requête ; index du ${v.le}, ${v.entrees.length} entrées) : ${plan.plan.length} fichiers prouvés sur ${plan.produits} produits · par ligne ${JSON.stringify(parLigne)} · restes ${JSON.stringify(plan.comptes.parMotif)} · sous le seuil ${plan.comptes.sousSeuil} · placeholders rejetés ${plan.comptes.placeholders}`);
        await fermer(); return;
    }
    if (args.includes('--verrou')) {
        const v = (await M.EtatImages.findById(P.VERROU_GLOBAL).lean())?.verrou;
        const b = await cx.db.collection('collecte_images_etat').findOne({ _id: P.ID_ALERTE, active: true });
        console.log(`${P.VERROU_GLOBAL} : ${v ? `🔒 pid ${v.pid} sur ${v.hote}, commit ${v.commit}, battement il y a ${Math.round((Date.now() - new Date(v.depuis)) / 1000)} s` : 'libre'}${b ? ` · ⛔ BLOQUÉ depuis ${new Date(b.depuis).toISOString()} : ${b.motif}` : ''}`);
        await fermer(); return;
    }
    if (args.includes('--plan')) {
        const v = lireIndexEnCache();
        const plan = await planifierTout(cx.db, await lireProduits(), v.entrees);
        const parSerie = {};
        for (const p of plan.plan) parSerie[p.serie] = (parSerie[p.serie] || 0) + 1;
        console.log(`SIMULATION (zéro requête ; index du ${v.le}, ${v.entrees.length} entrées) : ${plan.plan.length} fichiers prouvés sur ${plan.produits} produits · par série ${JSON.stringify(parSerie)} · restes ${JSON.stringify(plan.comptes.parMotif)} · placeholders rejetés ${plan.comptes.placeholders}`);
        console.log(`requêtes à l'écriture : 2 robots.txt + ${plan.plan.filter(p => series.includes(p.serie)).length} images, plafond ${P.PLAFOND_REQUETES}, cadence ${P.CADENCE_MS / 1000} s`);
        await fermer(); return;
    }
    // --ecrire : sous lot-additif.js, par le coordinateur. Verrou global pris et LIÉ au client ; arrêt au premier défi.
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: P.VERROU_GLOBAL, dureeMs: P.VERROU_GLOBAL_MS, surPerte, nom: `verrou global ${P.SOURCE}` });
    const tenuPar = await verrou.prendre();
    if (tenuPar) { console.error(`❌ ${P.VERROU_GLOBAL} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}`); await fermer(); process.exit(1); }
    const client = P.fabriquerClientPokumon({ verrou, cache: cacheSurDisque() });
    let code = 0;
    try {
        code = (familles
            ? await lancerEcritureFamilles(lignesVoulues, M, { verrou, client, lireProduits, ecrireIndexEnCache: e => ecrireIndex(e, DOSSIER_CACHE, 'index-familles.json') })
            : await lancerEcriture(series, M, { verrou, client, lireProduits, ecrireIndexEnCache: e => ecrireIndex(e) })).code;
    }
    catch (e) { console.error('❌', e.message); code = 1; }
    finally { await verrou.rendre(); await fermer(); }
    console.log(`REQUÊTES : ${client.compteRequetes()} (plafond ${P.PLAFOND_REQUETES}) vers ${P.HOTES.join(' + ')}`);
    process.exit(code);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
