// ============================================================
// COLLECTEUR D'IMAGES — The Art of Pokémon -> R2 + base `cartes`, UN SET PAR LANCEMENT
// ============================================================
//   node collecteur-images.js --set=EXP [--source=artofpkm] [--rapport=<dossier>]
//   node collecteur-images.js --sets=EXP,PJU,MFO          (séquence, pour un worker)
//   node collecteur-images.js --arreter-et-effacer [--confirmer]
//
// ⛔ NE PAS LANCER avant l'accord du testeur (SPEC-COLLECTE-IMAGES.md, trois règles en tête).
// ⚠️ JAMAIS en parallèle du collecteur de texte sur le même set : le verrou du texte est vérifié.
//
// Ce qu'il fait, dans l'ordre :
//   0. les quatre arrêts durs (garde.js), la table source (sources-sets.js), le bucket IMAGES ;
//      refus si le set n'a pas encore ses cartes (la collecte de texte passe d'abord) ;
//   1. LISTE : /sets/{id}/cards -> entrées {n, titre, original, vignette} (reprise : relues de l'état) ;
//   2. MESURE avant collecte : 64 Ko des 3 premiers originaux ; largeur < 560 px -> set REFUSÉ ;
//   3. ORIGINAUX : pour chaque entrée sans sha256 -> page de carte (numéro, noms, illustrateur,
//      rareté) -> original entier -> R2 `artofpkm/{id}/{n}.webp` -> ligne `images` (APRÈS R2) ;
//   4. JOINTURE image -> carte : numéro (sets numérotés) ou nom EN + illustrateur ; restes listés ;
//   5. COMPLÉTUDE : entrées source · cartes du set · images jointes ; restes par type ; ARRÊT.
//
// Reprise : l'unité est la carte ; sha256 présent = unité finie ; reprise au premier `n` sans
// sha256 ; verrou avec battement ; SIGINT termine l'unité en cours. Débit : artofpkm.js.

require('dotenv').config();
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const src = require('./collecte-cartes/artofpkm');
const { ligne: ligneDeTable } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');
const { modeles } = require('./collecte-cartes/schemas');
const { normaliserNom, chiffresDuNumero } = require('./collecte-cartes/jointure');

const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const VERROU_MS = 10 * 60 * 1000;
const LARGEUR_MIN = 560;
const SOURCE = arg('source') || 'artofpkm';

let arretDemande = false;
process.on('SIGINT', () => { console.warn('\n⏹️  arrêt demandé : on finit l\'unité en cours.'); arretDemande = true; });
process.on('SIGTERM', () => { console.warn('\n⏹️  SIGTERM : on finit l\'unité en cours.'); arretDemande = true; });

async function effacerTout(M, confirmer) {
    const bucket = process.env.R2_BUCKET_IMAGES;
    const cles = await r2.listerPrefixe(bucket, `${SOURCE}/`);
    const nImages = await M.Image.countDocuments({ source: SOURCE });
    const nCartes = await M.Carte.countDocuments({ 'image.source': SOURCE });
    console.log(`--arreter-et-effacer : ${cles.length} objets R2 sous ${SOURCE}/, ${nImages} lignes images, ${nCartes} cartes avec image ${SOURCE}.`);
    if (!confirmer) { console.log('   Rien n\'est effacé sans --confirmer.'); return; }
    const n = await r2.supprimer(bucket, cles);
    await M.Image.deleteMany({ source: SOURCE });
    await M.Carte.updateMany({ 'image.source': SOURCE }, { $set: { image: null } });
    await M.EtatImages.deleteMany({ _id: new RegExp(`^${SOURCE}/`) });
    await M.Reste.deleteMany({ type: { $in: ['image-sans-carte', 'carte-sans-image', 'image-vers-plusieurs-cartes'] } });
    console.log(`   effacé : ${n} objets R2, ${nImages} lignes images, ${nCartes} cartes remises sans image. Le refus est appliqué.`);
}

async function collecterSet(code, M, dossierRapport) {
    const L = ligneDeTable(code);
    if (!L) { console.error(`❌ ${code} : absent de la table à la main.`); return { code, etat: 'refuse-table' }; }
    const S = sourceDe(code, SOURCE);
    if (!S) { console.error(`❌ ${code} : aucune source d'images dans sources-sets.js.`); return { code, etat: 'refuse-source' }; }
    const slug = L.slugSet;
    const nbCartes = await M.Carte.countDocuments({ sets: slug });
    if (!nbCartes) { console.error(`❌ ${code} : aucune carte en base pour ${slug} — la collecte de TEXTE passe d'abord.`); return { code, etat: 'refuse-texte-manquant' }; }
    const verrouTexte = await M.Etat.findById(slug).lean();
    if (verrouTexte?.verrou?.depuis && Date.now() - new Date(verrouTexte.verrou.depuis).getTime() < VERROU_MS) {
        console.error(`❌ ${code} : le collecteur de TEXTE tient ${slug} (pid ${verrouTexte.verrou.pid}). Jamais en parallèle.`); return { code, etat: 'refuse-texte-en-cours' };
    }
    const idEtat = `${SOURCE}/${slug}`;
    const existant = await M.EtatImages.findById(idEtat).lean();
    if (existant?.verrou?.depuis && Date.now() - new Date(existant.verrou.depuis).getTime() < VERROU_MS && existant.verrou.pid !== process.pid) {
        console.error(`❌ ${code} : un collecteur d'images tient déjà ${slug} (pid ${existant.verrou.pid} sur ${existant.verrou.hote}).`); return { code, etat: 'refuse-verrou' };
    }
    await M.EtatImages.updateOne({ _id: idEtat }, { $set: { verrou: { pid: process.pid, hote: os.hostname(), depuis: new Date() } }, $setOnInsert: { debute: new Date(), phase: 'liste', entrees: {}, mesures: {} } }, { upsert: true });
    const battement = setInterval(() => M.EtatImages.updateOne({ _id: idEtat }, { $set: { 'verrou.depuis': new Date() } }).catch(() => { }), 60000);
    const liberer = async () => { clearInterval(battement); await M.EtatImages.updateOne({ _id: idEtat }, { $unset: { verrou: 1 } }); };

    console.log(`\n══ ${code} « ${L.nom} » — ${nbCartes} cartes en base, source ${SOURCE} ${JSON.stringify(S.ids)} « ${S.noms.join(' / ')} » ══`);
    const etat = await M.EtatImages.findById(idEtat).lean();
    const entrees = { ...(etat.entrees || {}) };
    const mesures = { ...(etat.mesures || {}) };

    // ---- 1. liste + 2. mesure, par set source ------------------------------------------------
    for (const id of S.ids) {
        if (!entrees[id]?.length) {
            entrees[id] = await src.listerSet(id);
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { [`entrees.${id}`]: entrees[id], phase: 'liste', derniereRequete: new Date() } });
        }
        console.log(`1. liste ${id} : ${entrees[id].length} entrées${etat.entrees?.[id]?.length ? ' (reprises de l\'état)' : ''}`);
        if (!mesures[id]?.length) {
            const m = [];
            for (const e of entrees[id].slice(0, 3)) m.push({ url: e.original, ...(await src.enTeteImage(e.original)) });
            mesures[id] = m;
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { [`mesures.${id}`]: m, phase: 'mesure' } });
        }
        console.log(`2. mesure ${id} : ${mesures[id].map(x => `${x.w}×${x.h} ${x.fmt} ${x.octets ? Math.round(x.octets / 1024) + ' Ko' : ''}`).join(' · ')}`);
        const trop = mesures[id].filter(x => !x.w || x.w < LARGEUR_MIN);
        if (trop.length) {
            console.error(`❌ ${code} : ${trop.length} original(s) sur 3 sous ${LARGEUR_MIN} px de large — set REFUSÉ, rien n'est téléchargé.`);
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'refuse-resolution' } });
            await liberer(); return { code, etat: 'refuse-resolution', mesures };
        }
    }

    // ---- 3. originaux, reprise au premier n sans sha256 -------------------------------------
    const bucket = process.env.R2_BUCKET_IMAGES;
    let telecharges = 0, sautes = 0, echecs = 0;
    for (const id of S.ids) {
        const faites = new Set((await M.Image.find({ source: SOURCE, sourceSetId: id, sha256: { $ne: null } }).select('n').lean()).map(x => x.n));
        for (const e of entrees[id]) {
            if (arretDemande) break;
            if (faites.has(e.n)) { sautes++; continue; }
            const _id = `${SOURCE}/${id}/${e.n}`;
            try {
                const deja = await M.Image.findById(_id).lean();
                if (deja && deja.cleCdn && deja.cleCdn !== e.cleCdn) console.warn(`   ⚠️ ${_id} : clé CDN changée (${deja.cleCdn} -> ${e.cleCdn}) — mise à jour de la source, journalisée.`);
                const faits = await src.pageCarte(id, e.n);
                const img = await src.telecharger(faits.original || e.original);
                const ext = img.fmt === 'webp' ? 'webp' : img.fmt === 'png' ? 'png' : 'jpg';
                const cleR2 = `${SOURCE}/${id}/${e.n}.${ext}`;
                await r2.deposerBinaire(bucket, cleR2, img.buffer, img.type || `image/${ext}`);   // R2 AVANT la ligne
                await M.Image.updateOne({ _id }, {
                    $set: {
                        source: SOURCE, sourceSetId: id, n: e.n, titre: e.titre, urlOriginal: e.original, cleCdn: e.cleCdn, cleR2,
                        sha256: img.sha256, octets: img.octets, w: img.w, h: img.h, fmt: img.fmt,
                        numero: faits.numero, total: faits.total, nomEn: faits.nomEn, nomJa: faits.nomJa, illustrateur: faits.illustrateur, rarete: faits.rarete,
                        setNomSource: faits.setNomSource, setNomJa: faits.setNomJa, set: slug, telechargeLe: new Date(), etat: 'ok',
                        ...(deja?.cleCdn && deja.cleCdn !== e.cleCdn ? { cleCdnPrecedente: deja.cleCdn } : {})
                    }
                }, { upsert: true });
                telecharges++;
                await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'originaux', derniereRequete: new Date(), requetes: src.compteRequetes() } });
            } catch (err) {
                echecs++;
                console.warn(`   ✗ ${_id} : ${err.message}`);
                await M.Image.updateOne({ _id }, { $set: { source: SOURCE, sourceSetId: id, n: e.n, titre: e.titre, urlOriginal: e.original, cleCdn: e.cleCdn, set: slug, etat: 'echec', erreur: err.message } }, { upsert: true });
            }
        }
    }
    console.log(`3. originaux : ${telecharges} téléchargés, ${sautes} déjà faits, ${echecs} échecs`);
    if (arretDemande) { await liberer(); return { code, etat: 'interrompu', telecharges, sautes, echecs }; }

    // ---- 4. jointure image -> carte --------------------------------------------------------
    const cartes = await M.Carte.find({ sets: slug }).lean();
    const nomsCibles = [].concat(L.bulba.expansion);
    const impDe = c => (c.impressions || []).find(i => i.tirage === 'jp' && nomsCibles.includes(i.expansion) && (!L.bulba.deck || i.deck === L.bulba.deck));
    const parNumero = new Map(), parNom = new Map();
    for (const c of cartes) {
        const imp = impDe(c);
        const num = imp ? chiffresDuNumero(imp.numero) : null;
        if (num) { if (!parNumero.has(num)) parNumero.set(num, []); parNumero.get(num).push(c); }
        const k = normaliserNom(c.nomEn);
        if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(c);
    }
    const images = await M.Image.find({ source: SOURCE, set: slug, etat: 'ok' }).lean();
    const restes = [];
    const cartesAvecImage = new Set();
    let jointes = 0;
    const preuves = {};
    for (const im of images) {
        let cands = [], preuve = null;
        const num = chiffresDuNumero(im.numero);
        if (num && parNumero.size) { cands = parNumero.get(num) || []; preuve = 'numero'; }
        if (!cands.length && im.nomEn) {
            cands = parNom.get(normaliserNom(im.nomEn)) || [];
            preuve = 'nom';
            if (cands.length > 1 && im.illustrateur) {
                const ill = cands.filter(c => normaliserNom(c.illustrateur) === normaliserNom(im.illustrateur));
                if (ill.length) { cands = ill; preuve = 'nom+illustrateur'; }
            }
        }
        if (cands.length === 1) {
            const c = cands[0];
            await M.Image.updateOne({ _id: im._id }, { $set: { carteId: c._id, preuve } });
            await M.Carte.updateOne({ _id: c._id }, { $set: { image: { source: SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, preuve, jointeLe: new Date() } } });
            cartesAvecImage.add(c._id); jointes++; preuves[preuve] = (preuves[preuve] || 0) + 1;
        } else if (!cands.length) restes.push({ set: slug, type: 'image-sans-carte', detail: `${im._id} « ${im.titre} » n°${im.numero ?? '—'}`, le: new Date() });
        else restes.push({ set: slug, type: 'image-vers-plusieurs-cartes', detail: `${im._id} « ${im.titre} » -> cartes ${cands.map(c => c._id).join(', ')}`, le: new Date() });
    }
    // Une carte SANS image n'est pas un échec : c'est l'état attendu quand la source ne l'a pas
    // (PKMJP ne liste pas les énergies de base), et c'est déjà la règle d'affichage du catalogue
    // (symbole du set, mention d'indisponibilité). Elles se COMPTENT et se nomment, elles ne sont
    // pas des restes.
    const cartesSansImage = cartes.filter(c => !cartesAvecImage.has(c._id)).map(c => ({ carteId: c._id, nomEn: c.nomEn }));
    await M.Reste.deleteMany({ set: slug, type: { $in: ['image-sans-carte', 'carte-sans-image', 'image-vers-plusieurs-cartes'] } });
    if (restes.length) await M.Reste.insertMany(restes);

    // ---- 5. complétude ----------------------------------------------------------------------
    // LA DÉFINITION (corrigée le 2026-09-12, comme pour le texte) : la source a ce qu'elle a. Trois
    // égalités qui n'ont pas de raison d'être fausses : (1) originaux téléchargés = entrées de la
    // source ; (2) chaque original est joint à UNE carte ; (3) aucune image vers plusieurs cartes.
    // Les cartes sans image sont un état attendu, imprimé avec son dénominateur.
    const nEntrees = S.ids.reduce((a, id) => a + entrees[id].length, 0);
    const restesParType = restes.reduce((a, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {});
    const complet = {
        entreesSource: nEntrees, cartesDuSet: cartes.length, imagesOk: images.length, imagesJointes: jointes, preuves,
        cartesSansImage: cartesSansImage.length, restes: restesParType, mesures,
        concordance: nEntrees === images.length && jointes === images.length && !restesParType['image-vers-plusieurs-cartes'],
        verifieLe: new Date()
    };
    await M.Set.updateOne({ _id: slug }, { $set: { completImages: complet, cartesSansImage } });
    await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: src.compteRequetes() } });
    console.log(`\n════ COMPLÉTUDE IMAGES ${code} — dénominateur : ${nEntrees} entrées source, ${cartes.length} cartes du set ════`);
    console.log(`   originaux = entrées source   : ${images.length} = ${nEntrees}`);
    console.log(`   images jointes = originaux   : ${jointes} = ${images.length}  ·  preuves ${JSON.stringify(preuves)}  ${complet.concordance ? '✅ concordants' : '❌ NON concordants'}`);
    console.log(`   cartes sans image (attendu)  : ${cartesSansImage.length} / ${cartes.length}${cartesSansImage.length ? ' — ' + cartesSansImage.map(c => c.nomEn).join(', ') : ''}`);
    console.log(`   restes par type              : ${JSON.stringify(restesParType)}`);
    for (const r of restes.slice(0, 40)) console.log(`      · ${r.type} : ${r.detail}`);
    console.log(`   requêtes ${SOURCE} : ${src.compteRequetes()}`);
    fs.mkdirSync(dossierRapport, { recursive: true });
    fs.writeFileSync(path.join(dossierRapport, `images-${code}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ complet, restes, echantillon: images.slice(0, 5) }, null, 1));
    await liberer();
    return { code, etat: 'verifie', complet };
}

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ buckets: ['R2_BUCKET_IMAGES'], production: false });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
    if (process.argv.includes('--arreter-et-effacer')) { await effacerTout(M, process.argv.includes('--confirmer')); await fermer(); return; }
    const dossierRapport = arg('rapport') || path.join(__dirname, 'collecte-cartes', 'rapports');

    // ---- pilotage par FILE D'ATTENTE (worker Render) ------------------------------------------
    //   --enfiler=PJU,MFO   ajoute des sets à la file (collection `file_images`), depuis n'importe où
    //   --boucle            le worker prend le premier set en attente, le collecte, recommence ;
    //                       file vide -> il dort 10 min et regarde à nouveau. Aucun redéploiement
    //                       pour élargir : on enfile, c'est tout.
    const File = cx.model('FileImages', new (require('mongoose').Schema)({ _id: String, ordre: Number, etat: String, ajouteLe: Date, pris: Date, fini: Date, resultat: String }, { strict: false, collection: 'file_images' }));
    if (arg('enfiler')) {
        const codes = arg('enfiler').split(',').map(s => s.trim()).filter(Boolean);
        const n = (await File.countDocuments()) + 1;
        for (const [i, code] of codes.entries()) await File.updateOne({ _id: code }, { $setOnInsert: { ordre: n + i, etat: 'attente', ajouteLe: new Date() } }, { upsert: true });
        console.log(`enfilé : ${codes.join(', ')} · file : ${JSON.stringify(await File.find({}).sort({ ordre: 1 }).select('_id etat').lean())}`);
        await fermer(); return;
    }
    if (process.argv.includes('--boucle')) {
        console.log('--boucle : file d\'attente `file_images`, un set à la fois, 10 min de sommeil quand elle est vide.');
        while (!arretDemande) {
            const suivant = await File.findOneAndUpdate({ etat: 'attente' }, { $set: { etat: 'en-cours', pris: new Date() } }, { sort: { ordre: 1 }, new: true }).lean();
            if (!suivant) { await new Promise(r => setTimeout(r, 10 * 60 * 1000)); continue; }
            const b = await collecterSet(suivant._id, M, dossierRapport);
            await File.updateOne({ _id: suivant._id }, { $set: { etat: b.etat === 'verifie' ? 'fait' : 'refuse', fini: new Date(), resultat: b.etat } });
        }
        await fermer(); return;
    }

    const codes = arg('sets') ? arg('sets').split(',').map(s => s.trim()) : arg('set') ? [arg('set')] : null;
    if (!codes) { console.error('❌ ARRÊT : --set=<CODE>, --sets=A,B,C, --enfiler=… ou --boucle obligatoire.'); await fermer(); process.exit(1); }
    const bilan = [];
    for (const code of codes) {
        if (arretDemande) break;
        bilan.push(await collecterSet(code, M, dossierRapport));
    }
    console.log('\nbilan :', bilan.map(b => `${b.code} ${b.etat}`).join(' · '));
    if (process.argv.includes('--attendre-a-la-fin')) { console.log('--attendre-a-la-fin : le processus reste vivant (worker), rien ne tourne plus.'); setInterval(() => { }, 60000); return; }
    await fermer();
})().catch(async e => { console.error('❌ ERREUR', e); process.exit(1); });
