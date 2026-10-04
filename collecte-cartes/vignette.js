// ============================================================
// LES VIGNETTES — une réduction de 200 px de chaque image de carte, 400 px de chaque logo (demande du site, DEMANDE-VIGNETTES.md)
// ============================================================
// Le site montre dans ses grilles le SCAN COMPLET (600–700 px, 40–130 Ko) à 100–220 px de large : 1,3 à 3,8 Mo par page Pokémon, sur
// un site sans optimiseur d'image. Il lit, dès qu'il existe :
//   cartes.images[].vignette = { cleR2, w, h }      (≤ 400 px, clé à ELLE, même proportion à 5 % près — lib/vignette.ts du site)
//   sets.logo.vignette       = { cleR2, w, h }      (≤ 400 px ; lu par le site après son extension de lib/visuelSet.ts)
// 🔑 UNE SEULE DÉFINITION, POUR LE RATTRAPAGE ET POUR LE WORKER (§21 bis) : la clé, la taille, le format vivent ici ; l'outil
// generer-vignettes.js et la boucle du worker (après chaque jointure) appellent `assurerVignettes`.
// 🔑 LA VIGNETTE VIT AUSSI SUR LE DOCUMENT `images` (même cleR2) : une jointure qui RÉÉCRIT les entrées de `cartes.images` (le
// remplacement TCGdex fait $pull puis $push) les rend sans vignette — la suivante la recopie du document, sans relire R2.
// Écriture ADDITIVE : un champ neuf, jamais une entrée ou une image modifiée ; la vignette ne remplace RIEN (la fiche, la carte en
// grand, l'og:image gardent le scan complet — le site en décide).
const sharp = require('sharp');

const LARGEUR_VIGNETTE = 200;          // la demande : « 200 px de large (≤ 400) »
const LARGEUR_VIGNETTE_LOGO = 400;     // « 400 px de large au plus »
const QUALITE = 80;

/** La clé R2 de la vignette d'une image : sous `vignettes/`, extension .webp. Une clé déjà de vignette LÈVE. */
function cleVignette(cleR2) {
    const c = String(cleR2 || '');
    if (!c) throw new Error('cleVignette : clé d\'image vide');
    if (c.startsWith('vignettes/')) throw new Error(`cleVignette : « ${c} » est déjà une vignette`);
    return `vignettes/${c.replace(/\.[^./]+$/, '')}.webp`;
}

/** La réduction d'une image : largeur au plus `largeur` (jamais agrandie), WebP, alpha gardé ; dimensions relues du fichier produit. */
async function fabriquerVignette(buffer, { largeur = LARGEUR_VIGNETTE, qualite = QUALITE } = {}) {
    const r = await sharp(buffer).resize({ width: largeur, withoutEnlargement: true }).webp({ quality: qualite, alphaQuality: 90 }).toBuffer({ resolveWithObject: true });
    if (!r.info.width || !r.info.height) throw new Error('fabriquerVignette : dimensions nulles');
    return { buffer: r.data, w: r.info.width, h: r.info.height, octets: r.data.length };
}

const lireBinaire = (bucket, cle) => require('./r2').lireBinaire(bucket, cle);

/**
 * Pose les vignettes manquantes des images de cartes (`slug` : un set seulement — le worker ; absent : tout le stock — l'outil).
 * Pour chaque entrée sans vignette : celle du document `images` (même cleR2) si elle existe, sinon lecture de l'original sur R2,
 * réduction, dépôt (idempotent), et écriture sur le document ET sur l'entrée. Ne lève pas sur une image : l'échec est COMPTÉ et dit.
 * @returns {Promise<{ entrees: number, depuisDocument: number, fabriquees: number, deja: number, echecs: {cleR2, erreur}[], sets: string[], octets: number }>}
 */
// `noms` : les collections (le banc de bout en bout écrit dans test_scratch, sous des noms à lui)
// `arreter()` : relu avant chaque image — le worker passe son drapeau d'arrêt (SIGTERM) : la phase s'interrompt au lieu de retarder la
// revalidation qui la suit au-delà de la grâce de Render (revue du 2026-09-27) ; ce qui reste sera repris au passage suivant.
async function assurerVignettes(db, { bucket, slug = null, parallele = 6, limite = Infinity, journal = console, ecrire = true, noms = { cartes: 'cartes', images: 'images' }, arreter = () => false } = {}) {
    if (!bucket) throw new Error('assurerVignettes : bucket R2 obligatoire');
    const r2 = require('./r2');
    // le bucket vit en juridiction UE : l'endpoint générique répond « Access Denied » (r2.js) — on le résout AVANT la première lecture
    if (ecrire) await r2.verifierBucket(bucket);
    const C = db.collection(noms.cartes), I = db.collection(noms.images);
    const filtre = { images: { $elemMatch: { cleR2: { $type: 'string' }, vignette: { $exists: false }, ...(slug ? { set: slug } : {}) } } };
    const B = { entrees: 0, depuisDocument: 0, fabriquees: 0, deja: 0, echecs: [], sets: new Set(), octets: 0 };
    // les entrées à traiter, lues d'un bloc (projection minimale) ; une cleR2 partagée par plusieurs cartes (réimpressions) ne se
    // fabrique qu'une fois
    const aFaire = new Map();   // cleR2 -> [{ carteId, set }]
    for await (const d of C.find(filtre, { projection: { images: 1 } })) {
        const sansVignette = (d.images || []).filter(e => typeof e.cleR2 === 'string' && !e.vignette);
        // les images du périmètre ; puis TOUTES les entrées de la carte qui les portent, même hors `slug` : l'écriture par arrayFilters
        // (plus bas) les vignette toutes, donc leurs sets changent et se revalident (un set et ses Additionals — revue du 2026-09-27)
        const cles = new Set(sansVignette.filter(e => !slug || e.set === slug).map(e => e.cleR2));
        for (const e of sansVignette) {
            if (!cles.has(e.cleR2)) continue;
            (aFaire.get(e.cleR2) || aFaire.set(e.cleR2, []).get(e.cleR2)).push({ carteId: d._id, set: e.set });
            B.entrees++;
        }
        if (aFaire.size >= limite) break;
    }
    const cles = [...aFaire.keys()].slice(0, limite);
    // le bilan ne compte que les clés RETENUES (une carte lue en entier peut dépasser `limite`) — revue du 2026-09-27
    B.entrees = cles.reduce((n, k) => n + aFaire.get(k).length, 0);
    const docs = new Map();
    for (let i = 0; i < cles.length; i += 1000) for (const d of await I.find({ cleR2: { $in: cles.slice(i, i + 1000) } }, { projection: { cleR2: 1, vignette: 1 } }).toArray()) docs.set(d.cleR2, d);
    if (!ecrire) return { ...B, cles: cles.length, depuisDocument: cles.filter(k => docs.get(k)?.vignette).length, sets: [...new Set(cles.flatMap(k => aFaire.get(k).map(x => x.set)))] };
    let i = 0;
    const travailleur = async () => {
        while (i < cles.length && !arreter()) {
            const cle = cles[i++];
            try {
                let v = docs.get(cle)?.vignette;
                if (v?.cleR2) B.depuisDocument++;
                else {
                    const f = await fabriquerVignette(await lireBinaire(bucket, cle));
                    const cv = cleVignette(cle);
                    const w = await r2.deposerBinaire(bucket, cv, f.buffer, 'image/webp');
                    if (w.ecrit) { B.fabriquees++; B.octets += f.octets; } else B.deja++;
                    v = { cleR2: cv, w: f.w, h: f.h };
                    if (docs.has(cle)) await I.updateOne({ cleR2: cle, vignette: { $exists: false } }, { $set: { vignette: v } });
                }
                const faites = new Set();   // une carte à deux entrées de même image : UNE écriture les couvre toutes deux
                for (const { carteId, set } of aFaire.get(cle)) {
                    const k = String(carteId);
                    if (!faites.has(k)) { faites.add(k); await C.updateOne({ _id: carteId }, { $set: { 'images.$[e].vignette': v } }, { arrayFilters: [{ 'e.cleR2': cle, 'e.vignette': { $exists: false } }] }); }
                    B.sets.add(set);
                }
            } catch (e) { B.echecs.push({ cleR2: cle, erreur: e.message }); }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, parallele) }, travailleur));
    if (B.echecs.length) journal.error(`🔴 vignettes : ${B.echecs.length} échec(s) — ${B.echecs.slice(0, 3).map(x => `${x.cleR2} (${x.erreur})`).join(' ; ')}`);
    return { ...B, cles: cles.length, traitees: Math.min(i, cles.length), interrompu: i < cles.length, sets: [...B.sets] };
}

/** Les vignettes des LOGOS de sets (400 px). Même règle, même bucket ; `sets.<champ>.vignette` — `logo` (ce que le site lit) ou
 *  `logoFr` (logos déposés à la main, 2026-09-28 ; le site ne le lit pas encore). */
async function assurerVignettesLogos(db, { bucket, journal = console, ecrire = true, champ = 'logo' } = {}) {
    // ➕ 2026-10-04 : `logoCompose` (poser-logos-composes.js), que le site lit entre logoFr et logo
    if (!['logo', 'logoFr', 'logoCompose'].includes(champ)) throw new Error(`assurerVignettesLogos : champ « ${champ} » inconnu (logo, logoFr, logoCompose)`);
    const r2 = require('./r2');
    const S = db.collection('sets');
    const sets = (await S.find({ [`${champ}.cleR2`]: { $type: 'string' }, [`${champ}.vignette`]: { $exists: false } }, { projection: { [champ]: 1 } }).toArray()).map(s => ({ _id: s._id, logo: s[champ] }));
    const B = { sets: sets.length, fabriquees: 0, deja: 0, echecs: [], touches: [], octetsAvant: 0, octetsApres: 0 };
    if (!ecrire) return B;
    await r2.verifierBucket(bucket);   // juridiction UE (voir assurerVignettes)
    for (const s of sets) {
        try {
            const orig = await lireBinaire(bucket, s.logo.cleR2);
            const f = await fabriquerVignette(orig, { largeur: LARGEUR_VIGNETTE_LOGO, qualite: 85 });
            const cv = cleVignette(s.logo.cleR2);
            const w = await r2.deposerBinaire(bucket, cv, f.buffer, 'image/webp');
            if (w.ecrit) B.fabriquees++; else B.deja++;
            B.octetsAvant += orig.length; B.octetsApres += f.octets;
            const u = await S.updateOne({ _id: s._id, [`${champ}.cleR2`]: s.logo.cleR2, [`${champ}.vignette`]: { $exists: false } }, { $set: { [`${champ}.vignette`]: { cleR2: cv, w: f.w, h: f.h } } });
            if (u.modifiedCount) B.touches.push(s._id);
        } catch (e) { B.echecs.push({ set: s._id, erreur: e.message }); }
    }
    if (B.echecs.length) journal.error(`🔴 vignettes de logos : ${B.echecs.length} échec(s) — ${B.echecs.slice(0, 3).map(x => `${x.set} (${x.erreur})`).join(' ; ')}`);
    return B;
}

/**
 * Les vignettes des SYMBOLES de sets (demande du site, 2026-09-28 : « 64 px de haut au plus, WebP » — affichés à 16 px, les fichiers
 * vont de 0,8 à 48 Ko). Deux champs, le même geste : `symbolesIdentification[].vignette` (ce que le site affiche d'abord) et
 * `symbole.vignette` (son repli). Hauteur bornée, jamais agrandie ; même clé (`vignettes/…webp`), même bucket. Un fichier partagé par
 * plusieurs sets ne se fabrique qu'une fois. Additif : un champ neuf, rien d'autre ne bouge.
 */
const HAUTEUR_VIGNETTE_SYMBOLE = 64;
async function assurerVignettesSymboles(db, { bucket, journal = console, ecrire = true } = {}) {
    const r2 = require('./r2');
    const S = db.collection('sets');
    const sets = await S.find({ $or: [{ symbolesIdentification: { $elemMatch: { cleR2: { $type: 'string' }, vignette: { $exists: false } } } }, { 'symbole.cleR2': { $type: 'string' }, 'symbole.vignette': { $exists: false } }] }, { projection: { symbolesIdentification: 1, symbole: 1 } }).toArray();
    const cles = new Set();
    for (const s of sets) { for (const e of s.symbolesIdentification || []) if (typeof e.cleR2 === 'string' && !e.vignette) cles.add(e.cleR2); if (typeof s.symbole?.cleR2 === 'string' && !s.symbole.vignette) cles.add(s.symbole.cleR2); }
    const B = { sets: sets.length, fichiers: cles.size, fabriquees: 0, deja: 0, echecs: [], touches: new Set(), octetsAvant: 0, octetsApres: 0 };
    if (!ecrire) return { ...B, touches: [] };
    await r2.verifierBucket(bucket);   // juridiction UE (voir assurerVignettes)
    const faites = new Map();   // cleR2 -> vignette
    for (const cle of cles) {
        try {
            const orig = await lireBinaire(bucket, cle);
            const r = await sharp(orig).resize({ height: HAUTEUR_VIGNETTE_SYMBOLE, withoutEnlargement: true }).webp({ quality: 85, alphaQuality: 90 }).toBuffer({ resolveWithObject: true });
            if (!r.info.width || !r.info.height) throw new Error('dimensions nulles');
            const cv = cleVignette(cle);
            const w = await r2.deposerBinaire(bucket, cv, r.data, 'image/webp');
            let dims = { w: r.info.width, h: r.info.height };
            if (w.ecrit) B.fabriquees++;
            else {
                // LA CLÉ EXISTAIT DÉJÀ (relecture du 2026-10-03) : le dépôt est idempotent, il n'écrase rien. On enregistre les dimensions du
                // fichier RÉELLEMENT présent, et un fichier qui n'est pas une vignette de symbole (plus haut que 64 px : celle d'un logo ou
                // d'une carte sous une clé voisine) est refusé plutôt que servi. Mesuré ce jour : 0 collision sur 47 491 clés.
                const m = await sharp(await lireBinaire(bucket, cv)).metadata();
                if (!m.height || m.height > HAUTEUR_VIGNETTE_SYMBOLE) throw new Error(`la clé ${cv} existe déjà et porte un fichier de ${m.width}×${m.height} : pas une vignette de symbole`);
                dims = { w: m.width, h: m.height };
                B.deja++;
            }
            B.octetsAvant += orig.length; B.octetsApres += r.data.length;
            faites.set(cle, { cleR2: cv, ...dims });
        } catch (e) { B.echecs.push({ cleR2: cle, erreur: e.message }); }
    }
    for (const s of sets) {
        for (const e of s.symbolesIdentification || []) {
            const v = faites.get(e.cleR2); if (!v || e.vignette) continue;
            const u = await S.updateOne({ _id: s._id }, { $set: { 'symbolesIdentification.$[x].vignette': v } }, { arrayFilters: [{ 'x.cleR2': e.cleR2, 'x.vignette': { $exists: false } }] });
            if (u.modifiedCount) B.touches.add(s._id);
        }
        const v = faites.get(s.symbole?.cleR2);
        if (v && !s.symbole.vignette) {
            const u = await S.updateOne({ _id: s._id, 'symbole.cleR2': s.symbole.cleR2, 'symbole.vignette': { $exists: false } }, { $set: { 'symbole.vignette': v } });
            if (u.modifiedCount) B.touches.add(s._id);
        }
    }
    if (B.echecs.length) journal.error(`🔴 vignettes de symboles : ${B.echecs.length} échec(s) — ${B.echecs.slice(0, 3).map(x => `${x.cleR2} (${x.erreur})`).join(' ; ')}`);
    return { ...B, touches: [...B.touches] };
}

module.exports = { cleVignette, fabriquerVignette, lireBinaire, assurerVignettes, assurerVignettesLogos, assurerVignettesSymboles, LARGEUR_VIGNETTE, LARGEUR_VIGNETTE_LOGO, HAUTEUR_VIGNETTE_SYMBOLE };
