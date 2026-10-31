// ============================================================
// LE SCAN « MOYEN » — une réduction de 400 px de chaque visuel servi d'au moins 471 px (demande du site, DEMANDE-CATALOGUE.md, 2026-10-31)
// ============================================================
// La fiche d'une carte charge le scan complet (126 Ko) à 280 px de large au téléphone : son LCP plafonne le Lighthouse mobile à 88. La
// vignette de 200 px est trop petite pour la fiche, le site n'a pas d'optimiseur : il lit, dès qu'il existe,
//   cartes.images[].moyen = { cleR2: "moyens/<clé de l'image sans extension>.webp", w, h }
// et ne le prend (lib/vignette.ts `moyenAdmis`) que s'il a une clé à lui, 300 à 500 px de large, au plus 85 % de la largeur de l'image, et
// la même proportion que l'image à 2 % près ; sinon il garde le scan complet. Un `moyen` sur une image sous 471 px n'aurait donc aucun effet.
// 🔑 UNE SEULE DÉFINITION, POUR LE RATTRAPAGE ET POUR LA CHAÎNE DES VIGNETTES (§21 bis) : la clé, la taille, le format, le seuil 471 et
// l'exclusion `basseDefinition` vivent ICI ; generer-moyens.js (le stock) et vignettes-apres-jointure.js (les prochains lots, dans la
// MÊME étape que la vignette) appellent `assurerMoyens`. Aucun autre fichier ne recopie « moyens/ », 400 ou 471.
// 🔑 LE MOYEN VIT AUSSI SUR LE DOCUMENT `images` (même cleR2), comme la vignette : une jointure qui RÉÉCRIT les entrées de cartes.images
// les rend sans moyen, la suivante le recopie du document sans relire R2. Le document porte en plus `de` = l'empreinte (sha256) de
// l'original dont le moyen a été tiré — JAMAIS recopiée sur l'entrée (le site n'a pas à la voir).
// 🔑 REMPLACEMENT SOUS LA MÊME CLÉ R2 : le dépôt R2 ordinaire (`deposerBinaire`) n'écrase rien, et la vignette n'a aucun moyen de savoir que son
// original a changé. Le moyen, lui, compare l'empreinte de l'original (document `images`.sha256) à celle dont il a été tiré (`moyen.de`) : si elles
// diffèrent, il est REFAIT et déposé en ÉCRASANT ; si l'entrée est devenue basseDefinition ou passe sous le seuil, son moyen est RETIRÉ de l'entrée.
// Écriture ADDITIVE hors ces deux cas : un champ neuf sur l'entrée, jamais une image modifiée.
const sharp = require('sharp');

const LARGEUR_MOYEN = 400;            // « 400 px de large, la hauteur suit »
const QUALITE_MOYEN = 80;             // « qualité ≈ 80 »
const LARGEUR_MIN_MOYEN = 471;        // « seulement pour une image d'au moins 471 px » : 400 ≤ 85 % de 471 (400,35)
const RATIO_MAX_MOYEN = 0.85;         // le site ignore un moyen de plus de 85 % de la largeur de l'image
const TOLERANCE_PROPORTION = 0.02;    // « même proportion à 2 % près »
const LARGEUR_SITE_MIN = 300, LARGEUR_SITE_MAX = 500;   // la plage que le site accepte pour un moyen

/** La clé R2 du moyen d'une image : sous `moyens/`, extension .webp. Une clé vide, de vignette ou déjà de moyen LÈVE. */
function cleMoyen(cleR2) {
    const c = String(cleR2 || '');
    if (!c) throw new Error('cleMoyen : clé d\'image vide');
    if (c.startsWith('vignettes/')) throw new Error(`cleMoyen : « ${c} » est une vignette`);
    if (c.startsWith('moyens/')) throw new Error(`cleMoyen : « ${c} » est déjà un moyen`);
    return `moyens/${c.replace(/\.[^./]+$/, '')}.webp`;
}

/**
 * Cette entrée de cartes.images doit-elle recevoir un moyen ? Écrite par ce qu'elle AUTORISE : tout ce qui n'est pas 'ok' est une raison nommée.
 * La largeur jugée est celle de l'entrée (`w`, le fichier SERVI — c'est elle que le site compare) ; inconnue, on ne devine pas.
 */
function decisionMoyen(e) {
    if (!e || typeof e.cleR2 !== 'string' || !e.cleR2) return { faire: false, raison: 'sans-cle' };
    if (e.basseDefinition === true) return { faire: false, raison: 'basse-definition' };
    if (typeof e.w !== 'number' || !(e.w > 0)) return { faire: false, raison: 'largeur-inconnue' };
    if (e.w < LARGEUR_MIN_MOYEN) return { faire: false, raison: 'trop-petite' };
    return { faire: true, raison: 'ok' };
}

/** La proportion du moyen est-elle celle de l'image à 2 % près ? (pure : le site ignore sinon le moyen). */
function proportionAdmise(image, moyen) {
    if (!(image?.w > 0 && image?.h > 0 && moyen?.w > 0 && moyen?.h > 0)) return false;
    const a = image.w / image.h, b = moyen.w / moyen.h;
    return Math.abs(b - a) / a <= TOLERANCE_PROPORTION;
}

/** Ce que le site fait de `moyen` (lib/vignette.ts `moyenAdmis`), recopié en lecture seule pour le banc et la mesure : clé à lui, 300–500 px, ≤ 85 %, proportion à 2 %. */
function moyenAdmis(image, moyen) {
    if (!moyen || typeof moyen.cleR2 !== 'string' || !moyen.cleR2 || moyen.cleR2 === image?.cleR2) return false;
    if (!(moyen.w >= LARGEUR_SITE_MIN && moyen.w <= LARGEUR_SITE_MAX)) return false;
    if (!(image?.w > 0) || moyen.w > RATIO_MAX_MOYEN * image.w) return false;
    return proportionAdmise(image, moyen);
}

/**
 * La réduction : 400 px de large, jamais agrandie, WebP qualité 80 ; dimensions RELUES du fichier produit. LÈVE si l'original (sa largeur RÉELLE, lue
 * dans le fichier) est sous 471 px, si le résultat dépasse 85 % de la largeur de l'original ou s'écarte de plus de 2 % de sa proportion.
 */
async function fabriquerMoyen(buffer) {
    const m = await sharp(buffer).metadata();
    if (!m.width || !m.height) throw new Error('fabriquerMoyen : dimensions nulles');
    if (m.width < LARGEUR_MIN_MOYEN) throw new Error(`fabriquerMoyen : original de ${m.width} px, sous le seuil de ${LARGEUR_MIN_MOYEN} px`);
    const r = await sharp(buffer).resize({ width: LARGEUR_MOYEN, withoutEnlargement: true }).webp({ quality: QUALITE_MOYEN, alphaQuality: 90 }).toBuffer({ resolveWithObject: true });
    const out = { buffer: r.data, w: r.info.width, h: r.info.height, octets: r.data.length, source: { w: m.width, h: m.height } };
    if (!out.w || !out.h) throw new Error('fabriquerMoyen : dimensions nulles');
    if (out.w > RATIO_MAX_MOYEN * m.width) throw new Error(`fabriquerMoyen : ${out.w} px dépasse ${RATIO_MAX_MOYEN * 100} % de ${m.width} px`);
    if (!proportionAdmise({ w: m.width, h: m.height }, out)) throw new Error(`fabriquerMoyen : proportion ${out.w}×${out.h} écartée de plus de 2 % de ${m.width}×${m.height}`);
    return out;
}

/** Le moyen tel que l'entrée le porte (sans l'empreinte `de`, réservée au document). */
const pourEntree = m => ({ cleR2: m.cleR2, w: m.w, h: m.h });
/** Le moyen du document est-il celui de l'original d'AUJOURD'HUI ? true/false ; null = on ne peut pas dire (une des deux empreintes manque). */
const moyenAJour = doc => (doc?.moyen?.cleR2 && doc.sha256 && doc.moyen.de) ? doc.moyen.de === doc.sha256 : null;

/**
 * Pose les moyens manquants des images de cartes (`slug` : un set seulement — la chaîne des lots ; absent : tout le stock — l'outil), recopie ceux du
 * document, REFAIT ceux dont l'original a été remplacé sous la même clé (`reverifier`), RETIRE ceux d'une entrée qui n'y a plus droit.
 * `ecrire: false` : rien n'est lu sur R2 ni écrit, le plan est compté. Ne lève pas sur une image : l'échec est COMPTÉ et dit.
 * `noms` : les collections (le banc de bout en bout écrit dans test_scratch) ; `r2` : injectable (le banc) ; `sets` : plusieurs sets d'une vague.
 * @returns {Promise<{ entrees, cles, depuisDocument, fabriquees, refaites, retirees, deja, echecs: {cleR2, erreur}[], sets: string[], octets, exclues: object }>}
 */
async function assurerMoyens(db, { bucket, slug = null, sets = null, parallele = 6, limite = Infinity, journal = console, ecrire = true, reverifier = false, noms = { cartes: 'cartes', images: 'images' }, arreter = () => false, r2 = null } = {}) {
    if (!bucket) throw new Error('assurerMoyens : bucket R2 obligatoire');
    const R2 = r2 || require('./r2');
    const perimetre = slug ? new Set([slug]) : (Array.isArray(sets) && sets.length ? new Set(sets) : null);
    const C = db.collection(noms.cartes), I = db.collection(noms.images);
    const B = { entrees: 0, depuisDocument: 0, fabriquees: 0, refaites: 0, retirees: 0, deja: 0, echecs: [], sets: new Set(), octets: 0, exclues: { 'basse-definition': 0, 'trop-petite': 0, 'largeur-inconnue': 0, 'sans-cle': 0 } };
    // le filtre ne fait que RESTREINDRE la lecture ; la décision est refaite en JS (decisionMoyen), la seule définition
    const dansPerimetre = e => !perimetre || perimetre.has(e.set);
    const sousSeuil = { $or: [{ basseDefinition: true }, { w: { $lt: LARGEUR_MIN_MOYEN } }] };
    const filtre = { images: { $elemMatch: { cleR2: { $type: 'string' }, ...(perimetre ? { set: perimetre.size === 1 ? [...perimetre][0] : { $in: [...perimetre] } } : {}),
        $or: [{ moyen: { $exists: false }, w: { $gte: LARGEUR_MIN_MOYEN }, basseDefinition: { $ne: true } }, { moyen: { $exists: true }, ...sousSeuil }, ...(reverifier ? [{ moyen: { $exists: true } }] : [])] } } };
    const aFaire = new Map();   // cleR2 -> { action: 'faire'|'verifier', cibles: [{ carteId, set }] }
    const aRetirer = [];        // { carteId, set, cleR2, raison }
    for await (const d of C.find(filtre, { projection: { images: 1 } })) {
        for (const e of d.images || []) {
            if (!dansPerimetre(e) || typeof e.cleR2 !== 'string') continue;
            const dec = decisionMoyen(e);
            if (!dec.faire) { if (e.moyen) aRetirer.push({ carteId: d._id, set: e.set, cleR2: e.cleR2, raison: dec.raison }); continue; }
            if (e.moyen && !reverifier) continue;
            const a = aFaire.get(e.cleR2) || aFaire.set(e.cleR2, { action: e.moyen ? 'verifier' : 'faire', cibles: [] }).get(e.cleR2);
            if (!e.moyen) a.action = 'faire';
            a.cibles.push({ carteId: d._id, set: e.set, avait: !!e.moyen });
            B.entrees++;
        }
        if (aFaire.size >= limite) break;
    }
    const cles = [...aFaire.keys()].slice(0, limite);
    B.entrees = cles.reduce((n, k) => n + aFaire.get(k).cibles.length, 0);
    const docs = new Map();
    for (let i = 0; i < cles.length; i += 1000) for (const d of await I.find({ cleR2: { $in: cles.slice(i, i + 1000) } }, { projection: { cleR2: 1, sha256: 1, moyen: 1 } }).toArray()) { if (!docs.has(d.cleR2) || d.etat === 'ok') docs.set(d.cleR2, d); }
    if (!ecrire) {
        const aVerifier = cles.filter(k => aFaire.get(k).action === 'verifier');
        const perimees = cles.filter(k => moyenAJour(docs.get(k)) === false);
        return { ...B, cles: cles.length, aVerifier: aVerifier.length, perimees: perimees.length, retirees: aRetirer.length, depuisDocument: cles.filter(k => aFaire.get(k).action === 'faire' && moyenAJour(docs.get(k)) !== false && docs.get(k)?.moyen?.cleR2).length,
            sets: [...new Set([...cles.flatMap(k => aFaire.get(k).cibles.map(x => x.set)), ...aRetirer.map(x => x.set)])] };
    }
    if (!cles.length && !aRetirer.length) return { ...B, cles: 0, traitees: 0, interrompu: false, sets: [] };   // rien à faire : pas d'appel R2
    await R2.verifierBucket(bucket);   // le bucket vit en juridiction UE : l'endpoint générique répond « Access Denied » (r2.js)
    // 1) les retraits (rien à lire sur R2)
    for (const r of aRetirer) {
        if (arreter()) break;
        try {
            const cond = r.raison === 'basse-definition' ? { 'e.basseDefinition': true } : { 'e.w': { $lt: LARGEUR_MIN_MOYEN } };
            await C.updateOne({ _id: r.carteId }, { $unset: { 'images.$[e].moyen': '' } }, { arrayFilters: [{ 'e.cleR2': r.cleR2, 'e.set': r.set, 'e.moyen': { $exists: true }, ...cond }] });
            B.retirees++; B.sets.add(r.set);
        } catch (e) { B.echecs.push({ cleR2: r.cleR2, erreur: e.message }); }
    }
    // 2) les poses, recopies et refontes
    let i = 0;
    const travailleur = async () => {
        while (i < cles.length && !arreter()) {
            const cle = cles[i++];
            try {
                const doc = docs.get(cle), a = aFaire.get(cle), aJour = moyenAJour(doc);
                if (a.action === 'verifier' && aJour !== false) continue;   // à jour, ou impossible à dire : on ne touche pas à une entrée qui a déjà un moyen
                let mo = null, refaire = aJour === false;
                if (!refaire && doc?.moyen?.cleR2) { mo = pourEntree(doc.moyen); B.depuisDocument++; }
                else {
                    const orig = await R2.lireBinaire(bucket, cle);
                    const f = await fabriquerMoyen(orig);
                    const cm = cleMoyen(cle);
                    const w = await R2.deposerBinaire(bucket, cm, f.buffer, 'image/webp', { ecraser: refaire });
                    let dims = { w: f.w, h: f.h };
                    if (w.ecrit) { if (refaire) B.refaites++; else B.fabriquees++; B.octets += f.octets; }
                    else {   // la clé existait déjà (reprise d'un passage interrompu) : on enregistre les dimensions du fichier RÉELLEMENT présent
                        const m = await sharp(await R2.lireBinaire(bucket, cm)).metadata();
                        if (!(m.width >= LARGEUR_SITE_MIN && m.width <= LARGEUR_SITE_MAX) || !proportionAdmise(f.source, { w: m.width, h: m.height })) throw new Error(`la clé ${cm} existe déjà et porte un fichier de ${m.width}×${m.height} qui n'est pas ce moyen`);
                        dims = { w: m.width, h: m.height }; B.deja++;
                    }
                    mo = { cleR2: cm, ...dims };
                    if (doc) await I.updateOne(doc._id !== undefined ? { _id: doc._id } : { cleR2: cle }, { $set: { moyen: { ...mo, de: doc.sha256 ?? null } } });
                }
                const faites = new Set();   // une carte à deux entrées de même image : UNE écriture les couvre toutes deux
                for (const { carteId, set } of a.cibles) {
                    const k = String(carteId);
                    if (!faites.has(k)) {
                        faites.add(k);
                        await C.updateOne({ _id: carteId }, { $set: { 'images.$[e].moyen': mo } }, { arrayFilters: [{ 'e.cleR2': cle, ...(refaire ? {} : { 'e.moyen': { $exists: false } }), 'e.basseDefinition': { $ne: true } }] });
                    }
                    B.sets.add(set);
                }
            } catch (e) { B.echecs.push({ cleR2: cle, erreur: e.message }); }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, parallele) }, travailleur));
    if (B.echecs.length) journal.error(`🔴 moyens : ${B.echecs.length} échec(s) — ${B.echecs.slice(0, 3).map(x => `${x.cleR2} (${x.erreur})`).join(' ; ')}`);
    return { ...B, cles: cles.length, traitees: Math.min(i, cles.length), interrompu: i < cles.length, sets: [...B.sets] };
}

module.exports = { cleMoyen, decisionMoyen, proportionAdmise, moyenAdmis, fabriquerMoyen, assurerMoyens, moyenAJour, LARGEUR_MOYEN, QUALITE_MOYEN, LARGEUR_MIN_MOYEN, RATIO_MAX_MOYEN, TOLERANCE_PROPORTION };
