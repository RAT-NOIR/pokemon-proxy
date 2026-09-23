// ============================================================
// COLLECTEUR D'IMAGES — TCGdex (anglais) -> R2 (WebP) + base `cartes` : REMPLACER la strate à risque (2026-09-23)
// ============================================================
//   node collecteur-images-tcgdex.js --plan [--sets=EVS,FST]   ce que la collecte ferait, sur le CACHE : zéro requête
//   node collecteur-images-tcgdex.js --verrou                  qui tient le verrou global TCGdex, lecture seule
//   (la collecte elle-même : le worker, `collecteur-images.js --boucle`, unités `source: 'tcgdex'` — enfiler-tcgdex.js)
//
// ⛔ LE WORKER RENDER EST LE SEUL COLLECTEUR : aucune option de ce fichier ne télécharge en local.
//
// 🔴 POURQUOI : Bulbapedia publie le scan JAPONAIS sous le nom de fichier ANGLAIS (§53, §54). 3 454 visuels le sont par
// preuve (format du scanner japonais) et, tiré au hasard dans les 34 sets « à risque », 9 sur 36 des autres aussi —
// sans qu'aucun format puisse le dire. On ne tranche pas la langue fichier par fichier : on REMPLACE la strate entière
// par le scan de l'impression ANGLAISE que TCGdex sert (3 326 des 3 454 mesurés). Là seulement `langue: 'en'` a une
// preuve : la source la déclare, par son chemin même (assets.tcgdex.net/en/…).
//
// Par set (une unité de file `tcgdex/<code>`, qui porte `tcgdexSet`) :
//   1. GARDE, par ce qu'elle AUTORISE : une ligne de table, un tirage intl, un set TCGdex nommé par l'unité, présent
//      dans la liste et portant le NOM de l'expansion de la ligne. Tout le reste refuse, et dit pourquoi.
//   2. LES CARTES DU SET TCGdex, depuis le cache `tcgdex_sets` (lu une fois, jamais redemandé).
//   3. L'APPARIEMENT : numéro + nom en témoin (collecte-cartes/tcgdex-appariement.js, la même définition que les
//      illustrateurs). Chaque impression reçoit un scan ou un MOTIF — les motifs s'écrivent dans `sets.remplacementTcgdex`.
//   4. TÉLÉCHARGEMENT `<image>/high.png` (cadence 2 s, verrou global lié au client), seuil de largeur, WebP -> R2 AVANT
//      la ligne `images` (`langue: 'en'`). Reprise : une ligne portant sha256 et la même URL ne se retélécharge pas.
//   5. JOINTURE, et c'est le REMPLACEMENT : pour chaque (carte, set, numéro) servi par TCGdex, l'entrée Bulbapedia est
//      retirée de `cartes.images` (le document `images` et l'objet R2 restent : un retour arrière est un rejeu). La
//      préséance est aussi dans collecteur-images-bulba.js : sa jointure saute un numéro que TCGdex sert (§21 bis).
require('dotenv').config();
const crypto = require('crypto');
const sharp = require('sharp');
const r2 = require('./collecte-cartes/r2');
const { ligne, TABLE } = require('./collecte-cartes/table-sets');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { LARGEUR_MIN, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { normaliserNom } = require('./collecte-cartes/jointure');
const { fabriquerClient, VERROU_GLOBAL, VERROU_GLOBAL_MS } = require('./collecte-cartes/tcgdex');
const { cartesEn, fabriquerAppariement, setDeLaLigne, compagnonsDuSet } = require('./collecte-cartes/tcgdex-cache');
const { apparierExpansion } = require('./collecte-cartes/tcgdex-appariement');

const SOURCE = 'tcgdex';
const VERROU_SET_MS = 10 * 60 * 1000;
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';   // TG01 ≠ 1 : le numéro ENTIER
const LANGUE = langueDuVisuel({ source: SOURCE });

let arretDemande = false;
process.on('SIGINT', () => { arretDemande = true; });
process.on('SIGTERM', () => { arretDemande = true; });
const surPerte = () => { arretDemande = true; process.exitCode = 1; };

/** La garde : UN chemin autorise, tout le reste refuse avec sa raison. */
function releve(unite, sets) {
    const L = ligne(unite?.code);
    if (!L) return { ok: false, etat: 'refuse-table', motif: `« ${unite?.code} » absent de la table` };
    if ((L.bulba?.tirage || 'intl') !== 'intl') return { ok: false, etat: 'refuse-region', motif: `tirage ${L.bulba?.tirage} : TCGdex en ne sert que l'anglais` };
    if (!unite.tcgdexSet) return { ok: false, etat: 'refuse-tcgdex-set', motif: 'l\'unité ne nomme pas de set TCGdex' };
    const s = sets.find(x => x.id === unite.tcgdexSet);
    if (!s) return { ok: false, etat: 'refuse-tcgdex-set', motif: `${unite.tcgdexSet} absent de la liste TCGdex en cache` };
    const d = setDeLaLigne(L, fabriquerAppariement(sets));
    if (d.set?.id !== s.id) return { ok: false, etat: 'refuse-tcgdex-set', motif: `${s.id} « ${s.name} » n'est pas le set que nomme la ligne (${d.set?.id ?? d.motif})` };
    return { ok: true, L, set: s };
}

/** Étapes 2-3 : ce que la collecte ferait. Zéro requête si le cache a le set ; sinon le client (verrou tenu) le lit.
 *  Le set TCGdex et ses GALERIES (compagnonsDuSet : Trainer Gallery, Galarian Gallery), que Bulbapedia range dans la même
 *  expansion. Sans client, une galerie absente du cache n'est pas lue — et ses restes le DISENT (`compagnonsNonLus`). */
async function planifier(M, db, client, L, set) {
    const lire = async id => client ? (await cartesEn(db, client, id)).cartes : (await db.collection('tcgdex_sets').findOne({ _id: `en/${id}` }))?.cartes;
    const principal = await lire(set.id);
    if (!principal) return null;
    const liste = (await db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets;
    if (!liste?.length) throw new Error('liste TCGdex absente du cache : les galeries d\'un set ne peuvent pas être cherchées');
    const compagnons = compagnonsDuSet(set, liste), compagnonsNonLus = [];
    const tcg = [...principal];
    for (const c of compagnons) { const cs = await lire(c.id); if (cs) tcg.push(...cs); else compagnonsNonLus.push(c.id); }
    const cartes = await M.Carte.find({ sets: L.slugSet }).select('nomEn niveau attaques impressions').lean();
    const R = [].concat(L.bulba.expansion).flatMap(nom => apparierExpansion(nom, cartes, tcg));
    const plan = R.filter(r => r.tcg?.image);
    const nonLu = compagnonsNonLus.length ? ` (galerie ${compagnonsNonLus.join(', ')} non lue : reste NON MESURÉ)` : '';
    const restes = R.filter(r => !r.tcg?.image).map(r => ({ carteId: r.carte._id, nomEn: r.carte.nomEn, numero: r.numero, motif: (r.motif === 'absente-de-tcgdex' ? r.motif + nonLu : r.motif) || 'tcgdex-sans-image', ...(r.detail ? { detail: r.detail } : {}) }));
    const motifs = {}; for (const x of restes) motifs[x.motif] = (motifs[x.motif] || 0) + 1;
    return { cartes, tcg, plan, restes, motifs, impressions: R.length, compagnons: compagnons.map(c => c.id), compagnonsNonLus };
}

async function collecterSet(unite, M, { verrou }) {
    const db = M.Carte.db.db;
    const liste = (await db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets || [];
    const G = releve(unite, liste);
    if (!G.ok) { console.error(`❌ ${unite?.code} : ${G.motif}.`); return { code: unite?.code, etat: G.etat }; }
    const { L, set } = G;
    const slug = L.slugSet;
    const client = fabriquerClient({ verrou });                       // la garde FERMÉE vit dans le client
    const idEtat = `${SOURCE}/${slug}`;
    const verrouSet = fabriquerVerrou({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_SET_MS, surInsertion: { debute: new Date(), phase: 'plan' }, surPerte, nom: `verrou de set ${idEtat}` });
    const tenuPar = await verrouSet.prendre();
    if (tenuPar) { console.error(`❌ ${L.code} : ${idEtat} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote}.`); return { code: L.code, etat: 'refuse-verrou' }; }
    try {
        const P = await planifier(M, db, client, L, set);
        console.log(`\n══ ${L.code} « ${L.nom} » → TCGdex ${set.id} « ${set.name} » — ${P.impressions} impressions, ${P.plan.length} scans anglais · restes ${JSON.stringify(P.motifs)} ══`);
        const bucket = process.env.R2_BUCKET_IMAGES;
        let telecharges = 0, sautes = 0, echecs = 0, tropPetits = 0;
        for (const p of P.plan) {
            if (arretDemande || !verrou.tenu) break;
            const _id = `${SOURCE}/${slug}/${p.carte._id}/${cleNum(p.numero)}`;
            const url = `${p.tcg.image}/high.png`;
            const deja = await M.Image.findById(_id).select('sha256 urlOriginal etat').lean();
            if (deja?.sha256 && deja.urlOriginal === url) { sautes++; continue; }
            try {
                const buffer = await client.telecharger(url);
                if (!buffer) throw new Error('absent chez TCGdex (404)');
                const meta = await sharp(buffer).metadata();
                if (!meta.width || meta.width < LARGEUR_MIN) {
                    tropPetits++;
                    await M.Image.updateOne({ _id }, { $set: { source: SOURCE, set: slug, carteId: p.carte._id, numero: p.numero, tcgdexId: p.tcg.id, urlOriginal: url, wOriginal: meta.width, hOriginal: meta.height, etat: 'trop-petit' } }, { upsert: true });
                    continue;
                }
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = `${SOURCE}/${slug}/${cleNum(p.numero)}-${p.carte._id}.webp`;
                await r2.deposerBinaire(bucket, cleR2, webp.data, 'image/webp');   // R2 AVANT la ligne
                await M.Image.updateOne({ _id }, {
                    $set: {
                        source: SOURCE, set: slug, carteId: p.carte._id, numero: p.numero, nomEn: p.carte.nomEn, tcgdexId: p.tcg.id, nomSource: p.tcg.name,
                        preuve: `TCGdex ${p.tcg.id} : numéro ${p.numero}, nom « ${p.tcg.name} » en témoin`, urlOriginal: url,
                        wOriginal: meta.width, hOriginal: meta.height, sha1Original: sha('sha1', buffer), octetsOriginal: buffer.length,
                        cleR2, sha256: sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                        langue: LANGUE.langue, languePreuve: LANGUE.preuve, attribution: 'TCGdex', telechargeLe: new Date(), etat: 'ok'
                    }, $unset: { erreur: 1 }
                }, { upsert: true });
                telecharges++;
                if (telecharges % 25 === 0) await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'originaux', derniereRequete: new Date(), requetes: client.compteRequetes() } });
            } catch (err) {
                echecs++;
                console.warn(`   ✗ ${_id} (${url}) : ${err.message}`);
                await M.Image.updateOne({ _id }, { $set: { source: SOURCE, set: slug, carteId: p.carte._id, numero: p.numero, tcgdexId: p.tcg.id, urlOriginal: url, etat: 'echec', erreur: err.message } }, { upsert: true });
                if (/verrou/.test(err.message)) break;                     // garde fermée : on ne continue pas sans verrou
            }
        }
        if (arretDemande || !verrou.tenu) return { code: L.code, etat: 'interrompu', telecharges };

        // ---- 5. JOINTURE = REMPLACEMENT -------------------------------------------------------------
        const images = await M.Image.find({ source: SOURCE, set: slug, etat: 'ok' }).lean();
        const parCarte = new Map();
        for (const im of images) (parCarte.get(im.carteId) || parCarte.set(im.carteId, []).get(im.carteId)).push(im);
        let bulbaRetirees = 0;
        for (const [carteId, ims] of parCarte) {
            const numeros = ims.map(im => im.numero);
            const entrees = ims.map(im => ({ set: slug, source: SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, preuve: im.preuve, numero: im.numero, attribution: 'TCGdex', langue: im.langue, languePreuve: im.languePreuve, jointeLe: new Date() }));
            const avant = await M.Carte.findById(carteId).select('images').lean();
            bulbaRetirees += (avant?.images || []).filter(e => e.set === slug && e.source === 'bulbapedia' && numeros.includes(e.numero)).length;
            await M.Carte.updateOne({ _id: carteId }, { $pull: { images: { set: slug, source: SOURCE } } });
            await M.Carte.updateOne({ _id: carteId }, { $pull: { images: { set: slug, source: 'bulbapedia', numero: { $in: numeros } } } });
            await M.Carte.updateOne({ _id: carteId }, { $push: { images: { $each: entrees } } });
        }
        const complet = {
            tcgdexSet: set.id, tcgdexNom: set.name, compagnons: P.compagnons, compagnonsNonLus: P.compagnonsNonLus,
            impressions: P.impressions, aCollecter: P.plan.length, imagesOk: images.length,
            telecharges, sautes, echecs, tropPetits, bulbaRemplacees: bulbaRetirees, restes: P.motifs, sansScanAnglais: P.restes,
            requetes: client.compteRequetes(),
            concordance: images.length + tropPetits === P.plan.length && echecs === 0,
            verifieLe: new Date()
        };
        await M.Set.updateOne({ _id: slug }, { $set: { remplacementTcgdex: complet } });
        await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: client.compteRequetes() } });
        console.log(`   images ok ${images.length} + sous le seuil ${tropPetits} = à collecter ${P.plan.length} ${complet.concordance ? '✅' : '❌'} · ${bulbaRetirees} visuels Bulbapedia remplacés · ${P.restes.length} impressions sans scan anglais · requêtes ${client.compteRequetes()}`);
        return { code: L.code, etat: complet.concordance ? 'verifie' : 'incomplet', ...complet };
    } finally {
        await verrouSet.rendre();
    }
}

module.exports = { SOURCE, VERROU_GLOBAL, VERROU_GLOBAL_MS, collecterSet, planifier, releve };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE : le worker importe `collecterSet`.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : --plan, --verrou, --sets=… ; rien ne télécharge.
const AUTORISES = [/^--plan$/, /^--verrou$/, /^--sets=[^,\s][^\s]*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length || !process.argv.slice(2).some(a => a === '--plan' || a === '--verrou')) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}autorisés : --plan [--sets=A,B], --verrou. La collecte est celle du worker.`);
    process.exit(2);
}
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    if (process.argv.includes('--verrou')) {
        const v = (await M.EtatImages.findById(VERROU_GLOBAL).lean())?.verrou;
        console.log(v ? `🔒 ${VERROU_GLOBAL} : pid ${v.pid} sur ${v.hote}, commit ${v.commit}, battement il y a ${Math.round((Date.now() - new Date(v.depuis)) / 1000)} s` : `${VERROU_GLOBAL} : libre`);
        await fermer(); return;
    }
    const liste = (await cx.db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets || [];
    if (!liste.length) throw new Error('liste TCGdex absente du cache — construire-illustrateurs.js --lire-tcgdex la lit');
    const apparier = fabriquerAppariement(liste);
    const sets = process.argv.find(a => a.startsWith('--sets='));
    const lignes = sets ? sets.slice(7).split(',').map(c => ligne(c)).filter(Boolean) : TABLE.filter(l => (l.bulba?.tirage || 'intl') === 'intl' && l.bulba?.expansion);
    let total = 0, scans = 0;
    for (const L of lignes) {
        const d = setDeLaLigne(L, apparier);
        if (!d.set) { console.log(`${L.code} : ${d.motif}`); continue; }
        const P = await planifier(M, cx.db, null, L, d.set);
        if (!P) { console.log(`${L.code} → ${d.set.id} : cartes TCGdex absentes du cache`); continue; }
        total += P.impressions; scans += P.plan.length;
        console.log(`${L.code.padEnd(8)} → ${d.set.id.padEnd(9)} ${String(P.plan.length).padStart(4)} scans / ${String(P.impressions).padStart(4)} impressions · ${JSON.stringify(P.motifs)}`);
    }
    console.log(`\nPLAN : ${scans} scans anglais sur ${total} impressions · ≈ ${scans} requêtes à 2 s ≈ ${Math.round(scans * 2 / 60)} min · requêtes faites : 0`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
