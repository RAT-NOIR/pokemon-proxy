// ============================================================
// IMPORT DES IMAGES REÇUES PAR LE RÉCEPTEUR PASSIF DE PIKAQIAN — sous la garde de lot (lot P2, 2026-10-13)
// ============================================================
//   node importer-pikaqian-passif.js [--dossier=<chemin>] [--codes=cs1bc,151c]                      SIMULATION (défaut) : lit le dossier, rejoue les preuves, n'écrit RIEN
//   node lot-additif.js --quoi="import passif pikaqian cs1bc" --collections=cartes,images,sets,collecte_images_etat -- node importer-pikaqian-passif.js --ecrire --codes=cs1bc --attendu=cs1bc:<N>
//
// 🔑 DÉCISION DU TESTEUR (2026-10-13) : « PikaQian : A. Le script passif envoie l'image telle que mon navigateur l'affiche, avec la carte et le numéro ; le worker ne touche jamais le CDN. Mêmes preuves
// exigées (numéro, nom, set) ; un doute est un trou. » Ce programme ne fait AUCUNE requête réseau : il lit le dossier que recepteur-pikaqian.js remplit (images + un fichier de page par visite) et rejoue,
// avec les fonctions de PRODUCTION du collecteur (collecteur-images-pikaqian.js : releve, gardeTirage, gardeProduits, planifier — numéro + tuile sans foil unique + nom concordant —, poserOriginal, joindreAdditif ;
// seuil de largeur largeurMinDe, aRejuger, marque basseDefinition), les MÊMES preuves que le collecteur du worker aurait exigées. Un doute est un TROU : compté, nommé, jamais écrit.
// 🔑 IL NE LIT QUE SOUS UNE RACINE AUTORISÉE (recepteur-pikaqian.js : RACINE_AUTORISEE, jonctions résolues) — tout autre dossier est refusé, sans liste de refus.
// Ce qu'il écrit — R2 (WebP) puis `images`, `cartes.images`, les vignettes, le bilan `sets.visuelsPikaqianPassif` — est posé par les mêmes fonctions que le collecteur, avec la source `pikaqian` et le lot
// `pikaqian-2026-10` : `retirer-visuels-pikaqian.js` les retire d'un geste. Chaque document porte en plus la voie de lecture (canvas, cache, navigateur) et la visite.
//
// LES PREUVES AJOUTÉES PAR LA NATURE DE LA SOURCE (le navigateur du testeur, pas un client à nous) :
//   · la page de la visite est rejugée (verdictDePage, complétude contre la mesure du set) ; l'image d'une tuile ne vaut que si la tuile est la MÊME (nom, numéro, adresse) dans toutes les visites qui l'ont envoyée ;
//   · plusieurs empreintes différentes pour une même tuile (visites ou voies qui se contredisent) : trou « versions-divergentes » ; le fichier relu doit avoir l'empreinte que le fichier de page annonce ;
//   · une tuile désignée par deux produits : trou « tuile-partagee » ; les MÊMES octets sur deux tuiles distinctes — d'une page, ou de pages différentes d'un même import — : trou « octets-partages » ;
//     les mêmes octets déjà en base (`images`, toutes sources) pour une AUTRE carte ou un autre set : trou « octets-deja-en-base » (un réimport du même lot n'en est pas un).
// ÉCRITURE : `--ecrire` exige `--codes` ET `--attendu=<code>:<N>` pour chaque code, N = le nombre d'images que la simulation donne à écrire. Si un seul code diffère, RIEN n'est écrit. Après l'écriture, la base est RELUE
// (documents `images` « ok » et entrées de `cartes.images` du lot) et doit donner N.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const P = require('./collecte-cartes/pikaqian');
const { TABLE_PIKAQIAN, uniteDeLaLigne } = require('./collecte-cartes/pikaqian-sets');
const { largeurMinDe, aRejuger, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
const R = require('./recepteur-pikaqian');
const C = require('./collecteur-images-pikaqian');

const VERROU_SET_MS = 10 * 60 * 1000;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const FICHIER_IMAGE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})--[0-9a-f]{12}\.(webp|png|jpg)$/;

// ── 1. LE DOSSIER ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Les codes de set qui ont un dossier d'images, au motif CODE_PK. */
function codesDuDossier(dossierPassif) {
    if (!fs.existsSync(dossierPassif)) return [];
    return fs.readdirSync(dossierPassif, { withFileTypes: true }).filter(d => d.isDirectory() && P.CODE_PK.test(d.name)).map(d => d.name).sort();
}
/** Les fichiers de page d'un code, du plus ancien au plus récent ; un fichier qui ne tient pas est nommé avec sa raison, jamais lu à moitié. */
function lireVisites(dossierPassif, code) {
    const rep = path.join(dossierPassif, code), illisibles = [], visites = [];
    if (!fs.existsSync(rep)) return { visites, illisibles };
    for (const nom of fs.readdirSync(rep).filter(n => /^page--.+\.json$/.test(n)).sort()) {
        let v;
        try { v = JSON.parse(fs.readFileSync(path.join(rep, nom), 'utf8')); } catch (e) { illisibles.push({ fichier: nom, motif: `JSON illisible (${e.message.slice(0, 60)})` }); continue; }
        if (v?.schema !== 2 || v.code !== code || !Array.isArray(v.tuiles) || !v.recues || typeof v.recues !== 'object' || typeof v.le !== 'string' || Number.isNaN(Date.parse(v.le))) { illisibles.push({ fichier: nom, motif: 'fichier de page hors du format écrit par le récepteur (schéma 2)' }); continue; }
        visites.push({ ...v, nomFichier: nom });
    }
    visites.sort((a, b) => Date.parse(a.le) - Date.parse(b.le) || (a.nomFichier < b.nomFichier ? -1 : 1));
    return { visites, illisibles };
}
const memeTuile = (a, b) => !!a && !!b && a.nom === b.nom && a.numero === b.numero && a.code === b.code && a.img === b.img;

/**
 * Pour chaque tuile de la visite la plus récente : les octets reçus, ou le MOTIF du trou. Rien n'est cru sur parole : le fichier est relu, son empreinte comparée, l'image décodée.
 * @returns {Promise<Map<string, {ok: true, octets: Buffer, sha256: string, voie: string, fichier: string, visite: string, w: number, h: number}|{ok: false, motif: string}>>}
 */
async function octetsDesTuiles(visites, dossierPassif, code) {
    const derniere = visites.at(-1), sortie = new Map();
    tuiles: for (const t of derniere.tuiles) {
        const entrees = [];
        for (const v of visites) {
            const lues = v.recues?.[t.id];
            if (!Array.isArray(lues) || !lues.length) continue;
            if (!memeTuile(v.tuiles.find(x => x.id === t.id), t)) { sortie.set(t.id, { ok: false, motif: 'tuile-changee' }); continue tuiles; }     // nom, numéro ou adresse différents d'une visite à l'autre
            for (const e of lues) entrees.push({ ...e, visite: v.le });
        }
        if (!entrees.length) { sortie.set(t.id, { ok: false, motif: 'image-non-recue' }); continue; }
        if (new Set(entrees.map(e => e.sha256)).size > 1) { sortie.set(t.id, { ok: false, motif: 'versions-divergentes' }); continue; }
        const e = entrees.at(-1), m = FICHIER_IMAGE.exec(String(e.fichier));
        if (!m || m[1] !== t.id || path.basename(e.fichier) !== e.fichier) { sortie.set(t.id, { ok: false, motif: 'fichier-hors-forme' }); continue; }
        let octets; try { octets = fs.readFileSync(path.join(dossierPassif, code, e.fichier)); } catch { sortie.set(t.id, { ok: false, motif: 'fichier-absent' }); continue; }
        if (sha256(octets) !== e.sha256) { sortie.set(t.id, { ok: false, motif: 'fichier-corrompu' }); continue; }
        // l'en-tête d'abord, puis un décodage borné (un fichier du dossier peut avoir été édité depuis le récepteur)
        let meta; try { meta = await sharp(octets).metadata(); if (meta.width && meta.height && meta.width <= R.DIMENSION_MAX && meta.height <= R.DIMENSION_MAX) await sharp(octets, { limitInputPixels: R.DIMENSION_MAX * R.DIMENSION_MAX }).raw().toBuffer(); } catch { sortie.set(t.id, { ok: false, motif: 'image-illisible' }); continue; }
        if (!meta.width || !meta.height || meta.width > R.DIMENSION_MAX || meta.height > R.DIMENSION_MAX) { sortie.set(t.id, { ok: false, motif: 'image-illisible' }); continue; }
        sortie.set(t.id, { ok: true, octets, sha256: e.sha256, voie: e.voie, fichier: e.fichier, visite: e.visite, w: meta.width, h: meta.height });
    }
    // 🔴 DES OCTETS IDENTIQUES SUR DEUX TUILES (relecture C, D1) : une image de remplacement chargée paresseusement, un canvas figé, ou un « image non disponible » servi à plusieurs tuiles passeraient toutes les autres
    // preuves (numéro, nom, adresse) avec une image qui n'est PAS celle de la carte. Une empreinte portée par au moins deux tuiles DISTINCTES de la page désigne aucune d'elles : toutes sont des trous.
    const parEmpreinte = new Map();
    for (const [id, o] of sortie) if (o.ok) (parEmpreinte.get(o.sha256) || parEmpreinte.set(o.sha256, []).get(o.sha256)).push(id);
    for (const ids of parEmpreinte.values()) if (ids.length > 1) for (const id of ids) sortie.set(id, { ok: false, motif: 'octets-partages' });   // PREUVE:octets-partages
    return sortie;
}
/** La lecture d'UN code (fichiers de page + octets des tuiles) : séparée du jugement pour que l'import compare les empreintes de TOUTES les pages avant de juger l'une d'elles. */
async function lireCode(code, dossierPassif) {
    const { visites, illisibles } = lireVisites(dossierPassif, code);
    return { code, visites, illisibles, octets: visites.length ? await octetsDesTuiles(visites, dossierPassif, code) : new Map() };
}
/**
 * 🔴 DES OCTETS IDENTIQUES SUR DES PAGES DIFFÉRENTES (relecture Y, tour 1, réserve a) : une image de remplacement commune à deux sets passerait la garde d'une seule page. Rend l'ensemble des
 * empreintes portées par au moins DEUX codes différents d'un même import. Pure.
 */
function empreintesEntreCodes(lectures) {
    const parSha = new Map();
    for (const L of lectures) for (const o of L.octets.values()) if (o.ok) (parSha.get(o.sha256) || parSha.set(o.sha256, new Set()).get(o.sha256)).add(L.code);
    return new Set([...parSha].filter(([, codes]) => codes.size > 1).map(([sha]) => sha));   // PREUVE:octets-partages-entre-pages
}

// ── 2. LE JUGEMENT D'UN CODE : les preuves du collecteur, rejouées ─────────────────────────────────────────────────
/**
 * @param {{code: string, dossierPassif: string, db: object, M: object, table?: object[], attendu?: Function, racine?: string, lecture?: object, partagesEntreCodes?: Set<string>}} o
 * `db` : la base `cartes` (lecture suffit) ; `M` : ses modèles ; `racine` : la racine autorisée (les bancs seuls la surchargent) ; `lecture` / `partagesEntreCodes` : `lireCode` et `empreintesEntreCodes`
 * quand l'import juge plusieurs codes.
 * @returns le jugement du code : par set (ligne de table), les entrées { p (le plan de production), statut, motif } et les comptes.
 */
async function jugerCode({ code, dossierPassif, db, M, table = TABLE_PIKAQIAN, attendu = R.attenduParTable, racine = R.RACINE_AUTORISEE, lecture = null, partagesEntreCodes = new Set() }) {
    // l'import ne LIT que sous la racine autorisée (jonctions résolues) — par ce qu'il autorise ; les trois noms d'apports manuels en second filet
    if (!R.dansRacineAutorisee(dossierPassif, racine) || R.dansApportsManuels(dossierPassif)) return { code, visites: 0, illisibles: [], sets: [], refus: { etat: 'dossier-hors-racine', motif: `le dossier « ${dossierPassif} » n'est pas sous la racine autorisée « ${racine} » : rien n'y est lu` } };   // PREUVE:racine
    const L = lecture || await lireCode(code, dossierPassif);
    const { visites, illisibles } = L;
    const base = { code, visites: visites.length, illisibles, sets: [] };
    if (!visites.length) return { ...base, refus: { etat: 'aucune-visite', motif: `aucun fichier de page lisible pour ${code} dans ${path.join(dossierPassif, code)}` } };
    const derniere = visites.at(-1), tuiles = derniere.tuiles;
    // la page de la visite est rejugée comme le récepteur et la mesure passive la jugent (fonctions de production)
    const V = P.verdictDePage({ tuiles, code, titre: derniere.titre, table });   // `titre` : celui que le récepteur a lu sur la page de la visite (fichier de page) ; absent = une ligne qui déclare un titre refuse
    if (!V.ok) return { ...base, refus: { etat: 'page-refusee', motif: V.motif } };
    if (Number.isInteger(derniere.ancres) && derniere.ancres > tuiles.length) return { ...base, refus: { etat: 'page-partielle', motif: `page partielle ou forme changée : ${derniere.ancres} ancres, ${tuiles.length} tuiles` } };
    const voulu = attendu(code);
    if (voulu && tuiles.length < voulu) return { ...base, refus: { etat: 'page-incomplete', motif: `page incomplète : ${tuiles.length} tuiles lues, ${voulu} relevées pour ce set à la mesure` } };
    const lignes = table.filter(l => l.codePk === code);
    if (!lignes.length) return { ...base, refus: { etat: 'refuse-table', motif: `code ${code} sans ligne dans collecte-cartes/pikaqian-sets.js` } };
    const octets = new Map([...L.octets].map(([id, o]) => [id, o.ok && partagesEntreCodes.has(o.sha256) ? { ok: false, motif: 'octets-partages' } : o]));
    const origines = new Map(Array.isArray(derniere.origines) ? derniere.origines : []);
    const sansImage = derniere.sansImageDansLeNavigateur;
    // 🔴 UNE SEULE REQUÊTE PAR CODE contre `images` (tour 3) : aucun index sur sha256 ni sha256Octets, donc chaque `find` est un balayage complet de la collection, sur une grappe que le site lit aussi.
    // On calcule d'abord les deux empreintes de chaque tuile reçue, on lit en UNE fois (projection stricte), puis le jugement se fait en mémoire, à l'identique.
    const webpShaDe = new Map();
    for (const [id, o] of octets) if (o.ok) webpShaDe.set(id, sha256(await sharp(o.octets).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer()));
    const parOctets = new Map(), parWebp = new Map();
    const shaOctets = [...new Set([...octets.values()].filter(o => o.ok).map(o => o.sha256))], shaWebp = [...new Set(webpShaDe.values())];
    if (shaOctets.length) {
        const docs = await db.collection('images').find({ $or: [{ sha256Octets: { $in: shaOctets } }, { sha256: { $in: shaWebp } }] }, { projection: { sha256: 1, sha256Octets: 1, carteId: 1, set: 1 } }).toArray();   // PREUVE:une-requete-images
        for (const d of docs) {
            if (d.sha256Octets) (parOctets.get(d.sha256Octets) || parOctets.set(d.sha256Octets, []).get(d.sha256Octets)).push(d);
            if (d.sha256) (parWebp.get(d.sha256) || parWebp.set(d.sha256, []).get(d.sha256)).push(d);
        }
    }
    for (const ligne of lignes) {
        const unite = uniteDeLaLigne(ligne), slug = ligne.slug;
        // LES GARDES DU COLLECTEUR, par ses fonctions : la ligne de table, le tirage du set en base, des produits joints
        const G = C.releve(unite);
        const set = await db.collection('sets').findOne({ _id: slug }, { projection: { tirage: 1, region: 1 } });
        const produitsJoints = await db.collection('cartes_produits').countDocuments({ slugSet: slug });
        const refus = !G.ok ? G : [C.gardeTirage(set, ligne, slug), C.gardeProduits(produitsJoints, slug)].find(g => !g.ok);
        if (refus) { base.sets.push({ slug, ligne, refus: { etat: refus.etat, motif: refus.motif }, produits: produitsJoints }); continue; }
        const Pl = await C.planifier(db, slug, ligne, tuiles);
        const trous = {}; for (const r of Pl.restes) trous[r.motif] = (trous[r.motif] || 0) + 1;
        const compte = (k) => { trous[k] = (trous[k] || 0) + 1; };
        const parTuile = new Map(); for (const p of Pl.plan) parTuile.set(p.tuile.id, (parTuile.get(p.tuile.id) || 0) + 1);
        const entrees = [];
        // (les octets identiques sur des tuiles différentes sont jugés dans octetsDesTuiles (une page) et empreintesEntreCodes (plusieurs pages) ; ici, contre la BASE)
        for (const p of Pl.plan) {
            const o = octets.get(p.tuile.id);
            if (parTuile.get(p.tuile.id) > 1) { entrees.push({ p, statut: 'trou', motif: 'tuile-partagee' }); compte('tuile-partagee'); continue; }
            if (!o?.ok) { const motif = o?.motif ?? 'image-non-recue'; entrees.push({ p, statut: 'trou', motif }); compte(motif); continue; }
            const _id = P.idImagePikaqian(slug, p.carteId, p.numero);
            // 🔴 LES MÊMES OCTETS DÉJÀ EN BASE (relecture Y, réserve b), toutes sources : le sha256 des octets reçus (documents de l'import) ET celui du WebP que nous servirions (documents de toutes les sources). Un document
            // qui désigne UNE AUTRE carte ou un autre set est un trou ; la même carte dans le même set (réimport du même lot, ou autre source) n'en est pas un (le _id encode déjà carte et set).
            const webpSha = webpShaDe.get(p.tuile.id);
            const memes = (parOctets.get(o.sha256) || []).concat(parWebp.get(webpSha) || []);
            if (memes.some(d => (d.carteId !== p.carteId || d.set !== slug))) { entrees.push({ p, statut: 'trou', motif: 'octets-deja-en-base' }); compte('octets-deja-en-base'); continue; }   // PREUVE:octets-deja-en-base
            const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat wOriginal seuilApplique').lean();
            // les états que le collecteur du worker juge pareil : retiré = jamais repris ; ok à la même adresse = déjà là ; jugé trop petit à la même adresse = pas rejugé
            if (deja?.etat === 'retire') { entrees.push({ p, o, _id, deja, statut: 'retire' }); continue; }
            if (deja?.sha256 && deja.urlOriginal === p.url && deja.etat === 'ok') { entrees.push({ p, o, _id, deja, statut: 'deja-la' }); continue; }
            if (deja?.etat === 'trop-petit' && deja.urlOriginal === p.url && !aRejuger(deja, P.SOURCE)) { entrees.push({ p, o, _id, deja, statut: 'trop-petit' }); continue; }
            if (o.w < largeurMinDe(P.SOURCE)) { entrees.push({ p, o, _id, deja, statut: 'trop-petit' }); continue; }
            entrees.push({ p, o, _id, deja, statut: 'a-ecrire' });
        }
        const nb = s => entrees.filter(e => e.statut === s).length;
        base.sets.push({ slug, ligne, produits: Pl.produits, trous: Pl.trous, plan: Pl.plan.length, restes: trous, suffixesInconnus: Pl.suffixesInconnus.length, entrees, origines, sansImage,
            aEcrire: nb('a-ecrire'), dejaLa: nb('deja-la'), tropPetits: nb('trop-petit'), retires: nb('retire'), nTrous: nb('trou') });
    }
    base.tuiles = tuiles.length; base.auCode = V.bonnes; base.derniere = derniere;
    return base;
}

/** Le nombre d'images que la simulation donne à écrire pour un code (tous ses sets). */
const aEcrireDe = j => j.sets.reduce((s, x) => s + (x.aEcrire || 0), 0);
/** « À l'attendu juste » : les codes dont le jugement diffère de l'attendu (ou qui sont refusés). Un seul écart, et rien n'est écrit. Pure. */
function ecartsAttendus(jugements, attendus) {
    return jugements.filter(j => j.refus || !Number.isInteger(attendus?.[j.code]) || aEcrireDe(j) !== attendus[j.code])
        .map(j => ({ code: j.code, motif: j.refus ? `refusé : ${j.refus.motif}` : !Number.isInteger(attendus?.[j.code]) ? 'aucun attendu donné' : `à écrire ${aEcrireDe(j)}, attendu ${attendus[j.code]}` }));
}

// ── 3. L'ÉCRITURE ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Écrit UN code, déjà jugé. Rend le bilan par set. Toutes les dépendances d'écriture sont injectables (le banc) : `deposer` (R2), `vignetter`, `fabriquerVerrouSet`, `stopOctets`.
 * Les gardes qui précèdent toute écriture : la source n'est pas RETIRÉE par décision, la base est sous 400 Mo, le verrou du set est pris.
 */
async function ecrireCode({ jugement, M, db, deposer, bucket, vignetter = vignetterApresJointure, fabriquerVerrouSet = fabriquerVerrou, stopOctets = C.STOP_OCTETS, arreter = () => false, journal = console }) {
    const E = db.collection('collecte_images_etat');
    const retrait = await E.findOne({ _id: P.ID_ALERTE, active: true, retrait: true });
    if (retrait) throw new Error(`${P.SOURCE} est RETIRÉE par décision (alerte ${P.ID_ALERTE}, retrait) : aucune écriture`);
    const st = await db.command({ dbStats: 1 });
    if (st.dataSize + st.indexSize > stopOctets) throw new Error(`base « cartes » à ${Math.round((st.dataSize + st.indexSize) / 1048576)} Mo (données + index) : au-delà de ${Math.round(stopOctets / 1048576)} Mo, STOP`);
    const bilans = [];
    for (const S of jugement.sets) {
        if (S.refus) { bilans.push({ slug: S.slug, refus: S.refus }); continue; }
        const idEtat = `${P.SOURCE}-passif/${S.slug}`;
        const verrouSet = fabriquerVerrouSet({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_SET_MS, surInsertion: { debute: new Date(), phase: 'import-passif' }, surPerte: () => { }, nom: `verrou de set ${idEtat}` });
        const tenuPar = await verrouSet.prendre();
        if (tenuPar) throw new Error(`${idEtat} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}`);
        try {
            const avantTout = await C.compterEntrees(db, [...new Set((await db.collection('cartes_produits').find({ slugSet: S.slug }, { projection: { carteId: 1 } }).toArray()).map(l => l.carteId))], S.slug);
            let ecrites = 0, tropPetitsEcrits = 0;
            for (const e of S.entrees) {
                if (arreter()) throw new Error('arrêt demandé : rien de plus n\'est écrit');
                // seuls les « a-ecrire » s'écrivent : un trou, un « trop-petit », un « retiré » et un « déjà là » ne touchent à rien (le collecteur du worker écrivait un document « trop-petit » pour ne pas
                // redemander l'image à la source ; ici rien n'est redemandé, donc rien à mémoriser)
                if (e.statut !== 'a-ecrire') continue;
                const extra = { voieCollecte: 'navigateur-du-testeur', voieLecture: e.o.voie, visiteLe: jugement.derniere.le, fichierPassif: e.o.fichier, sha256Octets: e.o.sha256, wRecu: e.o.w, hRecu: e.o.h };
                const pose = await C.poserOriginal({ M, deposer, bucket, slug: S.slug, p: e.p, buffer: e.o.octets, deja: e.deja, origine: S.origines.get(e.p.tuile.id) ?? null, _id: e._id, extra });
                if (pose.etat === 'ok') ecrites++; else tropPetitsEcrits++;
            }
            const J = await C.joindreAdditif(db, M, S.slug, idEtat);
            const W = await vignetter(db, S.slug, { bucket, arreter });
            const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;
            // rien à écrire (tout est déjà là) : la jointure ci-dessus a pu réparer une jointure interrompue, mais le bilan du premier import n'est PAS réécrit à « 0 écrite » (relecture C, D3)
            // MAIS un set dont le premier import n'a rien à écrire écrit son bilan (0) UNE fois : sans bilan existant, la branche ne s'applique pas (relecture Y, mineur)
            const bilanExistant = (await db.collection('sets').findOne({ _id: S.slug }, { projection: { visuelsPikaqianPassif: 1 } }))?.visuelsPikaqianPassif;
            if (ecrites === 0 && S.aEcrire === 0 && bilanExistant) {
                journal.log(`   ${S.slug} : rien à écrire (tout est déjà là) · jointure : ${J.joints} entrée(s) · bilan existant conservé`);
                bilans.push({ slug: S.slug, rien: true, joints: J.joints });
                continue;
            }
            // la RELECTURE : le lot, tel que la base le porte maintenant
            const docs = await M.Image.find({ source: P.SOURCE, set: S.slug, etat: 'ok', lot: P.LOT, voieCollecte: 'navigateur-du-testeur' }).lean();
            const cartesDuLot = await db.collection('cartes').find({ 'images.source': P.SOURCE }, { projection: { images: 1 } }).toArray();
            const clesVoulues = new Set(S.entrees.filter(e => e.statut === 'a-ecrire').map(e => `${e.p.carteId}|${e.p.numero}`));
            const entreesRelues = cartesDuLot.flatMap(c => (c.images || []).filter(x => x.source === P.SOURCE && x.lot === P.LOT && x.set === S.slug).map(x => `${c._id}|${x.numero}`)).filter(k => clesVoulues.has(k));
            const docsRelus = docs.filter(d => clesVoulues.has(`${d.carteId}|${d.numero}`));
            const bilan = {
                source: P.SOURCE, lot: P.LOT, mention: P.MENTION, voieCollecte: 'navigateur-du-testeur', code: jugement.code, visite: jugement.derniere.le, fichierPage: jugement.derniere.nomFichier,
                tuiles: jugement.tuiles, auCode: jugement.auCode, produits: S.produits, trous: S.trous, plan: S.plan, restes: S.restes, aEcrire: S.aEcrire, ecrites, dejaLa: S.dejaLa, tropPetits: S.tropPetits + tropPetitsEcrits, retires: S.retires,
                voies: S.entrees.filter(e => e.statut === 'a-ecrire').reduce((m, e) => { m[e.o.voie] = (m[e.o.voie] || 0) + 1; return m; }, {}), sansImageDansLeNavigateur: S.sansImage ?? null,
                joints: J.joints, dejaParAutre: J.dejaParAutre, cartesAbsentes: J.cartesAbsentes, erreurJointure: J.erreurJointure, vignettes: W.vg,
                garde: { autresAvant: J.avant.nAutres, autresApres: J.apres.nAutres, autresIdentiques: J.avant.autres === J.apres.autres, siennesApres: J.apres.siennes, ok: J.garde },
                relu: { documents: docsRelus.length, entrees: entreesRelues.length },
                concordance: J.garde && !J.erreurJointure && vignettesOk && J.cartesAbsentes === 0 && ecrites === S.aEcrire && docsRelus.length === S.aEcrire && entreesRelues.length <= S.aEcrire && entreesRelues.length >= S.aEcrire - J.dejaParAutre,
                verifieLe: new Date()
            };
            await M.Set.updateOne({ _id: S.slug }, { $set: { visuelsPikaqianPassif: bilan } });
            bilans.push({ slug: S.slug, bilan });
            journal.log(`   ${S.slug} : à écrire ${S.aEcrire} · écrites ${ecrites} · joints ${J.joints} · relu : ${docsRelus.length} document(s), ${entreesRelues.length} entrée(s) · garde ${J.garde ? '✅' : '❌'} · concordance ${bilan.concordance ? '✅' : '❌'}`);
        } finally { await verrouSet.rendre(); }
    }
    return bilans;
}

// ── 4. LA MISE EN FORME ───────────────────────────────────────────────────────────────────────────────────────────────
function formater(js, { dossierPassif }) {
    const l = [];
    for (const j of js) {
        l.push(`\n══ ${j.code} : ${j.visites} visite(s) lue(s)${j.illisibles.length ? `, ${j.illisibles.length} fichier(s) de page illisible(s)` : ''} ══`);
        for (const x of j.illisibles) l.push(`   non lu : ${x.fichier} — ${x.motif}`);
        if (j.refus) { l.push(`   REFUSÉ (${j.refus.etat}) : ${j.refus.motif}`); continue; }
        l.push(`   dernière visite ${j.derniere.le} (${j.derniere.nomFichier}) : tuiles ${j.tuiles} (au code ${j.auCode}), tuiles sans image dans le navigateur : ${j.derniere.sansImageDansLeNavigateur ?? 'non dit'}`);
        for (const S of j.sets) {
            if (S.refus) { l.push(`   ${S.slug.padEnd(34)} REFUSÉ PAR LE COLLECTEUR (${S.refus.etat}) : ${S.refus.motif}`); continue; }
            l.push(`   ${S.slug.padEnd(34)} produits ${S.produits} · trous ${S.trous} · appariés (numéro + tuile sans foil + nom) ${S.plan} · à ÉCRIRE ${S.aEcrire} · déjà là ${S.dejaLa} · sous le seuil de ${largeurMinDe(P.SOURCE)} px ${S.tropPetits} · retirés ${S.retires}`);
            l.push(`      trous par motif : ${JSON.stringify(S.restes)}${S.suffixesInconnus ? ` · tuiles à suffixe INCONNU ${S.suffixesInconnus}` : ''}`);
            const voies = S.entrees.filter(e => e.statut === 'a-ecrire').reduce((m, e) => { m[e.o.voie] = (m[e.o.voie] || 0) + 1; return m; }, {});
            l.push(`      voies de lecture des images à écrire : ${JSON.stringify(voies)}`);
        }
    }
    const lisibles = js.filter(j => !j.refus);
    const total = lisibles.reduce((s, j) => s + aEcrireDe(j), 0);
    l.push(`\nTOTAL : ${total} image(s) à écrire sur ${lisibles.length} code(s) jugé(s) · ${js.length - lisibles.length} refusé(s) en bloc. Dossier : ${dossierPassif}. Aucune requête réseau, aucune écriture.`);
    const attendu = lisibles.filter(j => aEcrireDe(j) > 0).map(j => `${j.code}:${aEcrireDe(j)}`);
    if (attendu.length) l.push(`\nPOUR ÉCRIRE (sous la garde de lot ; le coordinateur lance, avec l'accord de l'éditeur) :\n   node lot-additif.js --quoi="import passif pikaqian ${attendu.map(a => a.split(':')[0]).join(',')}" --collections=cartes,images,sets,collecte_images_etat -- node importer-pikaqian-passif.js --ecrire --codes=${attendu.map(a => a.split(':')[0]).join(',')} --attendu=${attendu.join(',')}`);
    return l.join('\n');
}

module.exports = { codesDuDossier, lireVisites, octetsDesTuiles, lireCode, empreintesEntreCodes, jugerCode, aEcrireDe, ecartsAttendus, ecrireCode, formater, FICHIER_IMAGE };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main === module) {
    // La ligne de commande s'écrit par ce qu'elle AUTORISE : un argument inconnu refuse avant toute connexion.
    const args = process.argv.slice(2);
    const AUTORISES = [/^--ecrire$/, /^--dossier=.+$/, /^--codes=[a-z0-9][a-z0-9.,-]*$/, /^--attendu=[a-z0-9][a-z0-9.-]*:\d+(,[a-z0-9][a-z0-9.-]*:\d+)*$/];
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const ecrire = args.includes('--ecrire');
    const dossierPassif = args.find(a => a.startsWith('--dossier='))?.slice(10) ?? R.DOSSIER_PASSIF_DEFAUT;
    const codesDemandes = args.find(a => a.startsWith('--codes='))?.slice(8).split(',') ?? null;
    const attendus = Object.fromEntries((args.find(a => a.startsWith('--attendu='))?.slice(10).split(',') ?? []).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
    const mauvais = (codesDemandes ?? []).filter(c => !P.CODE_PK.test(c));
    if (inconnus.length || mauvais.length || (ecrire && (!codesDemandes || codesDemandes.some(c => !(c in attendus)) || Object.keys(attendus).some(c => !codesDemandes.includes(c)))) || (!ecrire && args.some(a => a.startsWith('--attendu=')))) {
        console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}${mauvais.length ? `code hors du motif : ${mauvais.join(',')} — ` : ''}permis : (rien) = simulation ; --dossier=<chemin> ; --codes=<c1,c2> ; --ecrire exige --codes=<c1,c2> ET --attendu=<c1>:<N>,<c2>:<M> (un attendu par code, ni plus ni moins ; N = « à ÉCRIRE » de la simulation).`);
        process.exit(2);
    }
    if (R.dansLeDepot(dossierPassif)) { console.error(`❌ le dossier « ${dossierPassif} » est dans le dépôt : les images reçues n'y entrent jamais.`); process.exit(2); }
    if (!R.dansRacineAutorisee(dossierPassif)) { console.error(`❌ le dossier « ${dossierPassif} » n'est pas sous la racine autorisée « ${R.RACINE_AUTORISEE} » : l'import n'y lit rien.`); process.exit(2); }
    if (R.dansApportsManuels(dossierPassif)) { console.error(`❌ le dossier « ${dossierPassif} » est un dossier d'apports manuels (ou est dedans) : jamais lu ni écrit par un outil.`); process.exit(2); }
    process.on('SIGINT', () => process.exit(130));
    (async () => {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { modeles } = require('./collecte-cartes/schemas');
        const r2 = require('./collecte-cartes/r2');
        const codes = codesDemandes ?? codesDuDossier(dossierPassif);
        if (!codes.length) { console.error(`❌ aucun dossier de code dans ${dossierPassif} : lance le récepteur, ouvre une page de set, clique « Apprendre cette page ».`); process.exit(1); }
        let cx, fermer;
        if (ecrire) ({ cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] }));
        else {
            // simulation : la base `cartes` en LECTURE SEULE (utilisateur de lecture, privilèges constatés, façade find/count seulement)
            const mongoose = require('mongoose');
            const { jugerLecture, verifierPrivilegesLecture, facadeLecture } = require('./collecte-cartes/base-banc');
            const j = jugerLecture(process.env, 'cartes', 'la base « cartes » (simulation de l\'import PikaQian passif)');
            if (!j.ok) { console.error(j.raison); process.exit(1); }
            const co = await mongoose.createConnection(j.uri, { dbName: 'cartes', autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 }).asPromise();
            const v = await verifierPrivilegesLecture(co.db, 'cartes');
            if (!v.ok) { console.error(v.raison); await co.close(); process.exit(1); }
            cx = { db: facadeLecture(co.db), _co: co }; fermer = () => co.close();
        }
        const M = ecrire ? modeles(cx) : { Image: { findById: id => ({ select: () => ({ lean: async () => cx.db.collection('images').findOne({ _id: id }) }) }) } };
        try {
            const jugements = [];
            // toutes les pages sont LUES d'abord : les mêmes octets sur deux pages différentes sont des trous partout
            const lectures = []; for (const code of codes) lectures.push(await lireCode(code, dossierPassif));
            const partagesEntreCodes = empreintesEntreCodes(lectures);
            for (const L of lectures) jugements.push(await jugerCode({ code: L.code, dossierPassif, db: cx.db, M, lecture: L, partagesEntreCodes }));
            console.log(formater(jugements, { dossierPassif }));
            if (!ecrire) return;
            // « à l'attendu juste » : un seul code qui diffère de l'attendu, et RIEN n'est écrit
            const ecarts = ecartsAttendus(jugements, attendus);
            if (ecarts.length) { console.error(`\n❌ ÉCRITURE REFUSÉE : ${ecarts.map(x => `${x.code} (${x.motif})`).join(' ; ')} — rien n'est écrit.`); process.exitCode = 1; return; }
            const bucket = process.env.R2_BUCKET_IMAGES;
            if (!bucket) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune écriture');
            await r2.verifierBucket(bucket);                       // 🔴 le bucket d'abord (juridiction UE) : rien n'est écrit s'il ne répond pas
            let code = 0, total = 0;
            for (const j of jugements) {
                const b = await ecrireCode({ jugement: j, M, db: cx.db, deposer: (b, cle, donnees, type) => r2.deposerBinaire(b, cle, donnees, type), bucket });
                for (const x of b) { if (x.rien || x.refus) continue; total += x.bilan.ecrites; if (!x.bilan.concordance) code = 1; }
            }
            console.log(`\n${code ? '🔴' : '✅'} ${total} image(s) écrite(s) · relu à l'attendu : ${code ? 'NON CONCORDANT, voir ci-dessus' : 'oui'}`);
            console.log(`SETS : ${jugements.flatMap(j => j.sets.map(s => s.slug)).join(',')}`);
            process.exitCode = code;
        } finally { await fermer(); }
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
