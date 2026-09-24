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
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const src = require('./collecte-cartes/artofpkm');
const { ligne: ligneDeTable, TABLE } = require('./collecte-cartes/table-sets');
const TABLE_CODES = TABLE.map(l => l.code);
const { sourceDe } = require('./collecte-cartes/sources-sets');
const { modeles } = require('./collecte-cartes/schemas');
const { normaliserNom, cleNumero } = require('./collecte-cartes/jointure');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');

const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const VERROU_MS = 10 * 60 * 1000;
// 🔑 SEUIL ABAISSÉ DE 560 À 480 LE 2026-09-12, SUR MESURE ET PAR DÉCISION DU TESTEUR. 560 venait
// d'une supposition — « il faut au moins la taille d'affichage pleine carte » — et il a fait REFUSER
// DP5c, dont les originaux sont à 500×700. Comparaison faite : à 157 px de vignette, une source de
// 500 px et une de 593 px sont INDISCERNABLES à l'œil (bandes basses superposées). Le seuil ne
// protégeait que la vue pleine carte, qui n'existe pas encore sur le site.
// ⚠️ LA LEÇON EST LE PENDANT DU PIÈGE HABITUEL : un seuil posé d'avance est bon, un seuil posé sur
// une SUPPOSITION et jamais revu fait refuser du bon travail. Il coûte dans l'autre sens, et
// silencieusement — un set refusé ne réclame rien. La résolution réelle de chaque set est conservée
// dans `completImages.mesures` : le jour où la vue pleine carte existera, on saura lesquels sont bas.
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');   // une définition pour les deux collecteurs
const { langueDuVisuel, langueDeLEntree } = require('./collecte-cartes/langue-visuel');
const { correctionDe } = require('./collecte-cartes/corrections-images');
const { clesPartagees } = require('./collecte-cartes/images-cle-partagee');   // une clé que plusieurs images partagent
const balise = require('./collecte-cartes/balise-worker');           // « quel code tourne ici ? », au travail comme au repos
const { alimenter } = require('./collecte-cartes/alimentateur');     // la file se remplit d'elle-même sous le seuil
const { issueDeLUnite } = require('./collecte-cartes/issue-unite');  // fait, attente ou refus : une seule définition
const SOURCE = arg('source') || 'artofpkm';
const LANGUE = langueDuVisuel({ source: SOURCE });                     // artofpkm ne sert que le japonais : par construction

// ════════════════════════════════════════════════════════════════════════════
// LE VERROU GLOBAL — UN SEUL COLLECTEUR AU MONDE, PAS UN PAR SET
// ════════════════════════════════════════════════════════════════════════════
// 🔴 L'OCCURRENCE, 2026-09-12 16:34→16:41. Le verrou n'existait QUE par set. Deux collecteurs ont
// donc tourné en même temps sur DEUX sets : le local (pid 35556, DESKTOP-5LDV9CG, G1) et le worker
// Render (pid 52, srv-dainu3bm8hqs73dklpi0, G2). Chacun tenait sagement sa cadence de 5 s — et
// artofpkm.com recevait DEUX requêtes toutes les 5 s. 58 requêtes sont parties à ce régime.
// ⚠️ LA RÈGLE PORTE SUR L'HÔTE DISTANT, PAS SUR NOTRE UNITÉ DE TRAVAIL. « 1 requête / 5 s, jamais
// en parallèle » est un engagement pris par écrit dans la demande à PKMJP : il se compte chez LUI.
// Un verrou par set protège nos données d'une double écriture ; il ne protège pas sa bande passante.
// Les deux sont nécessaires, et ce sont deux verrous différents.
const VERROU_GLOBAL = `${SOURCE}/__collecteur__`;
// ⚠️ LA DURÉE DE VALIDITÉ EST CELLE DU BATTEMENT, PAS CELLE D'UN SET. Le battement est de 60 s :
// trois battements manqués valent mort. Dix minutes (la borne des verrous de set) transformerait
// chaque redéploiement Render en dix minutes d'arrêt — le verrou deviendrait lui-même la panne.
// 🔴 ET UN PROCESSUS TUÉ NE LIBÈRE RIEN. Sur Render, un pod est remplacé sans préavis : c'est le
// cas NORMAL, pas l'exception. Un verrou qui n'expire pas est un verrou qui finit par tout bloquer.
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const ATTENTE_VERROU_MS = 30 * 1000;

// ⚠️ TROIS FAÇONS D'ÊTRE LIBRE — pas de verrou, battement mort, verrou SANS PROPRIÉTAIRE (zombie né
// d'un battement arrivé après la libération) — et TROIS DÉFAUTS DE LIBÉRATION corrigés le 2026-09-13 :
// tout est dans collecte-cartes/verrou-source.js, une seule définition pour le global et pour le set.
// 🔴 Un verrou perdu (battement ou revérification à 0 document) ARRÊTE la collecte après l'unité.
let verrouGlobal = null;
const surPerte = () => { arretDemande = true; process.exitCode = 1; };

/**
 * Attend que le verrou global se libère, au lieu de mourir. Un redéploiement Render laisse
 * l'ancien pod tenir le verrou quelques secondes : sortir en erreur transforme ce chevauchement
 * NORMAL en boucle de redémarrage. On attend, on dit qui tient, et on reprend.
 */
async function attendreVerrouGlobal(M, { patienter = true } = {}) {
    verrouGlobal = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_GLOBAL, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'collecteur' }, surPerte, nom: `verrou global ${SOURCE}` });
    for (let essai = 0; ; essai++) {
        const tenu = await verrouGlobal.prendre();
        if (!tenu) return true;
        const msg = `verrou global ${SOURCE} tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s ; mort à ${VERROU_GLOBAL_MS / 1000} s)`;
        if (!patienter) { console.error(`❌ ARRÊT : ${msg}. « 1 requête / 5 s, jamais en parallèle » se compte chez la SOURCE.`); return false; }
        if (essai === 0) console.log(`⏳ ${msg} — j'attends qu'il expire ou se libère, ${ATTENTE_VERROU_MS / 1000} s entre deux essais. Je ne meurs pas : un redéploiement ne doit pas devenir une panne.`);
        if (arretDemande) return false;
        await new Promise(r => setTimeout(r, ATTENTE_VERROU_MS));
    }
}

let arretDemande = false;
process.on('SIGINT', () => { console.warn('\n⏹️  arrêt demandé : on finit l\'unité en cours.'); arretDemande = true; });
process.on('SIGTERM', () => { console.warn('\n⏹️  SIGTERM : on finit l\'unité en cours.'); arretDemande = true; });

async function effacerTout(M, confirmer) {
    const bucket = process.env.R2_BUCKET_IMAGES;
    const cles = await r2.listerPrefixe(bucket, `${SOURCE}/`);
    const nImages = await M.Image.countDocuments({ source: SOURCE });
    const nCartes = await M.Carte.countDocuments({ 'images.source': SOURCE });
    console.log(`--arreter-et-effacer : ${cles.length} objets R2 sous ${SOURCE}/, ${nImages} lignes images, ${nCartes} cartes avec image ${SOURCE}.`);
    if (!confirmer) { console.log('   Rien n\'est effacé sans --confirmer.'); return; }
    const n = await r2.supprimer(bucket, cles);
    await M.Image.deleteMany({ source: SOURCE });
    await M.Carte.updateMany({ 'images.source': SOURCE }, { $pull: { images: { source: SOURCE } } });
    await M.Carte.updateMany({ image: { $exists: true } }, { $unset: { image: 1 } });
    await M.EtatImages.deleteMany({ _id: new RegExp(`^${SOURCE}/`) });
    await M.Reste.deleteMany({ type: { $in: ['image-sans-carte', 'carte-sans-image', 'image-vers-plusieurs-cartes'] } });
    console.log(`   effacé : ${n} objets R2, ${nImages} lignes images, ${nCartes} cartes remises sans image. Le refus est appliqué.`);
}

/**
 * UN `en-cours` DONT LE SET NE BAT PLUS RETOURNE EN `attente`. La boucle ne prend que les `attente` :
 * un pod tué au milieu d'un set laissait sa ligne `en-cours` POUR TOUJOURS, sans que rien le signale.
 * 🔴 L'OCCURRENCE : DP5c, pris à 08:20:37 UTC le 2026-09-13 par un pod tué vers 08:21:53, immobile
 * plus de cinq heures avec 8 originaux sur 70, verrou de set périmé depuis 08:31.
 * Dernier signe de vie = le plus récent de (battement du verrou de set, `pris`) : un set pris il y a
 * une seconde, dont le verrou n'est pas encore posé, n'est pas figé. Même borne que le refus du
 * verrou de set (VERROU_MS) : un seuil plus court le remettrait en attente pour le voir refusé aussitôt.
 * Appelé sous le verrou global uniquement — c'est lui qui fait autorité sur la file.
 */
async function reprendreEnCoursFiges(File, M) {
    const enCours = await File.find({ etat: 'en-cours' }).lean();
    if (!enCours.length) return 0;
    let repris = 0;
    for (const f of enCours) {
        // ⚠️ LE VERROU DE SET EST CELUI DE LA SOURCE DE L'UNITÉ (corrigé le 2026-09-23) : on lisait `artofpkm/<slug>` pour
        // une unité Bulbapedia, qui bat sur `bulbapedia/<slug>` — une unité longue et VIVANTE passait pour figée. Et une
        // unité TCGdex a pour `_id` `tcgdex/<code>` : son code est dans `f.code`.
        const L = ligneDeTable(f.code || f._id);
        const e = L ? await M.EtatImages.findById(`${f.source || SOURCE}/${L.slugSet}`).select('verrou').lean() : null;
        const vie = Math.max(e?.verrou?.depuis ? new Date(e.verrou.depuis).getTime() : 0, f.pris ? new Date(f.pris).getTime() : 0);
        const ageS = Math.round((Date.now() - vie) / 1000);
        if (ageS * 1000 < VERROU_MS) { console.log(`   ${f._id} en-cours, dernier signe de vie il y a ${ageS} s : vivant, je n'y touche pas.`); continue; }
        const motif = `en-cours figé : ${e?.verrou ? `verrou de set de pid ${e.verrou.pid} sur ${e.verrou.hote}` : 'aucun verrou de set'}, dernier signe de vie il y a ${ageS} s (borne ${VERROU_MS / 1000} s)`;
        const r = await File.updateOne({ _id: f._id, etat: 'en-cours', ...(f.pris ? { pris: f.pris } : { pris: { $exists: false } }) },
            { $set: { etat: 'attente', reprisLe: new Date(), reprisMotif: motif }, $unset: { pris: 1 } });
        if (r.modifiedCount) console.warn(`↩️ ${f._id} remis en attente — ${motif}`);
        repris += r.modifiedCount;
    }
    console.log(`en-cours figés : ${repris} remis en attente sur ${enCours.length} en-cours`);
    return repris;
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
    // LE VERROU DE SET, MÊME DÉFINITION QUE LE GLOBAL (§21 bis : deux exemplaires d'une règle se
    // corrigent ensemble). ⚠️ L'ancienne garde excluait `pid === process.pid` : sur Render TOUS les pods
    // ont le pid 52, donc un pod neuf prenait le verrou frais d'un autre pour le sien. Prise atomique,
    // possession par pid + hôte + jeton, libération conditionnelle, perte = arrêt.
    const verrouSet = fabriquerVerrou({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_MS, surInsertion: { debute: new Date(), phase: 'liste', entrees: {}, mesures: {} }, surPerte, nom: `verrou de set ${slug}` });
    const tenuPar = await verrouSet.prendre();
    if (tenuPar) {
        console.error(`❌ ${code} : un collecteur d'images tient déjà ${slug} (pid ${tenuPar.pid} sur ${tenuPar.hote}, battement il y a ${tenuPar.ageS} s).`); return { code, etat: 'refuse-verrou' };
    }
    const liberer = () => verrouSet.rendre();

    const requetesAuDebut = src.compteRequetes();
    console.log(`\n══ ${code} « ${L.nom} » — ${nbCartes} cartes en base, source ${SOURCE} ${JSON.stringify(S.ids)} « ${S.noms.join(' / ')} » ══`);
    const etat = await M.EtatImages.findById(idEtat).lean();
    const entrees = { ...(etat.entrees || {}) };
    const mesures = { ...(etat.mesures || {}) };

    // ---- 1. liste + 2. mesure, par set source ------------------------------------------------
    for (const id of S.ids) {
        if (!entrees[id]?.length) {
            entrees[id] = await src.listerSet(id);
            // `pagesListe` : page, entrées lues, nouvelles — la preuve d'une pagination, en base et pas en log.
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { [`entrees.${id}`]: entrees[id], [`pagesListe.${id}`]: entrees[id].pages || null, phase: 'liste', derniereRequete: new Date() } });
        }
        console.log(`1. liste ${id} : ${entrees[id].length} entrées${etat.entrees?.[id]?.length ? ' (reprises de l\'état)' : ''}`);
        if (!mesures[id]?.length) {
            const m = [];
            for (const e of entrees[id].slice(0, 3)) m.push({ url: e.original, ...(await src.enTeteImage(e.original)) });
            mesures[id] = m;
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { [`mesures.${id}`]: m, phase: 'mesure' } });
        }
        console.log(`2. mesure ${id} : ${mesures[id].map(x => `${x.w}×${x.h} ${x.fmt} ${x.octets ? Math.round(x.octets / 1024) + ' Ko' : ''}`).join(' · ')}`);
        // 🔴 LE SET SE REFUSE SUR SA MÉDIANE, PLUS SUR SON MINIMUM — corrigé le 2026-09-21, et c'est
        // le §23 mot pour mot : « juger un ensemble sur son pire élément, c'est le refuser sur son
        // bruit ». Une liste de 150 fichiers contient toujours une miniature, et un critère qui prend
        // le MINIMUM devient d'autant plus sévère que l'échantillon est GRAND — l'inverse de ce qu'on
        // veut. Le § dit aussi où vit chaque geste : « refuser un SET demande une statistique de
        // masse, écarter un FICHIER demande le fichier lui-même ». Les deux existaient chez Bulbapedia
        // (l. 135 et l. 143) et manquaient ici — §21 bis, deux exemplaires d'une règle qui divergent.
        // ⚠️ MESURÉ AVANT D'ÊTRE ÉCRIT, sur les 229 sets artofpkm et leurs mesures déjà en base, zéro
        // requête : **0 set perdu, 1 gagné** — PCG2 Clash of the Blue Sky, largeurs 162/593/593,
        // refusé depuis le 2026-09-13 à cause d'une seule vignette. C'est le coût nul du §20 : une
        // règle qui ne dérange rien de ce qui marche se câble sans attendre de la rencontrer.
        const largeurs = mesures[id].map(x => x?.w).filter(Boolean).sort((a, b) => a - b);
        const mediane = largeurs.length ? largeurs[Math.floor(largeurs.length / 2)] : null;
        const trop = (mediane == null || mediane < LARGEUR_MIN) ? mesures[id].filter(x => !x.w || x.w < LARGEUR_MIN) : [];
        if (trop.length) {
            console.error(`❌ ${code} : largeur MÉDIANE ${mediane ?? '?'} px < ${LARGEUR_MIN} (${mesures[id].length} mesures, ${trop.length} sous le seuil) — set REFUSÉ, rien n'est téléchargé.`);
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'refuse-resolution' } });
            await liberer(); return { code, etat: 'refuse-resolution', mesures };
        }
    }

    // ---- 3. originaux, reprise au premier n sans sha256 -------------------------------------
    const bucket = process.env.R2_BUCKET_IMAGES;
    // `tropPetits` est la MOITIÉ MANQUANTE du geste ci-dessus : admettre un set sur sa médiane sans
    // écarter ses fichiers trop petits servirait la miniature de 162 px. Et il se COMPTE — une carte
    // sans visuel qu'aucun compteur ne nomme est l'échec silencieux du §21, celui qui se découvre des
    // semaines plus tard. La ligne `images` est écrite quand même, en `etat: 'trop-petit'` avec sa
    // largeur : `joindreImages` ne lit que `etat: 'ok'`, donc elle ne joint rien, et le jour où la vue
    // pleine carte existera on saura lesquelles reprendre sans redemander un octet au tiers.
    let telecharges = 0, sautes = 0, echecs = 0, tropPetits = 0;
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
                if (!img.w || img.w < LARGEUR_MIN) {
                    tropPetits++;
                    console.warn(`   ⤵️ ${_id} « ${e.titre} » : ${img.w ?? '?'} px de large < ${LARGEUR_MIN} — ÉCARTÉE, comptée, non servie.`);
                    await M.Image.updateOne({ _id }, { $set: { source: SOURCE, sourceSetId: id, n: e.n, titre: e.titre, urlOriginal: e.original, cleCdn: e.cleCdn, set: slug, w: img.w, h: img.h, fmt: img.fmt, octets: img.octets, etat: 'trop-petit' } }, { upsert: true });
                    continue;
                }
                const ext = img.fmt === 'webp' ? 'webp' : img.fmt === 'png' ? 'png' : 'jpg';
                const cleR2 = `${SOURCE}/${id}/${e.n}.${ext}`;
                await r2.deposerBinaire(bucket, cleR2, img.buffer, img.type || `image/${ext}`);   // R2 AVANT la ligne
                await M.Image.updateOne({ _id }, {
                    $set: {
                        source: SOURCE, sourceSetId: id, n: e.n, titre: e.titre, urlOriginal: e.original, cleCdn: e.cleCdn, cleR2,
                        sha256: img.sha256, octets: img.octets, w: img.w, h: img.h, fmt: img.fmt,
                        numero: faits.numero, total: faits.total, nomEn: faits.nomEn, nomJa: faits.nomJa, illustrateur: faits.illustrateur, rarete: faits.rarete,
                        setNomSource: faits.setNomSource, setNomJa: faits.setNomJa, set: slug, telechargeLe: new Date(), etat: 'ok',
                        langue: LANGUE.langue, languePreuve: LANGUE.preuve,
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
    console.log(`3. originaux : ${telecharges} téléchargés, ${sautes} déjà faits, ${echecs} échecs, ${tropPetits} écartée(s) sous ${LARGEUR_MIN} px`);
    if (arretDemande) { await liberer(); return { code, etat: 'interrompu', telecharges, sautes, echecs }; }

    const complet = await joindreImages(M, L, slug, S, entrees, mesures, dossierRapport);
    await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date(), requetes: src.compteRequetes(), requetesDuSet: src.compteRequetes() - requetesAuDebut } });
    // ⚠️ DEUX NOMBRES, ET ILS NE DISENT PAS LA MÊME CHOSE. Le compteur du module est CUMULÉ depuis le
    // démarrage du processus : l'afficher seul dans un bloc de complétude de set a fait lire « 974
    // requêtes pour 96 cartes » là où le set en avait coûté 204. Un compteur sans sa portée est un
    // dénominateur manquant (CLAUDE.md §21).
    console.log(`   requêtes ${SOURCE} : ${src.compteRequetes() - requetesAuDebut} pour CE set (2 par carte + 4) · ${src.compteRequetes()} cumulées depuis le démarrage du processus`);
    await liberer();
    return { code, etat: 'verifie', complet };
}

/**
 * ÉTAPES 4 ET 5 — la jointure image -> carte et la complétude. EXTRAITE pour être rejouable sans
 * toucher à la source (`--rejouer-jointure`) : corriger un schéma ne doit pas coûter 400
 * téléchargements. Une seule définition, appelée par les deux chemins.
 */
// « Uncommon (Old Back) » chez la source, « Uncommon » chez Bulbapedia : la parenthèse est une
// mention de dos de carte, pas un degré de rareté. Même famille que les apostrophes typographiques.
const normaliserRarete = v => String(v ?? '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
// « Unown [E] » chez la source, « Unown E » chez Bulbapedia : les crochets de la LETTRE ne passaient pas
// la clé — 8 orphelines sur 8 noms à crochets des 28 sets (DP2 E I M T, DP5c V W Y ?), mesuré le
// 2026-09-13. Même famille que les apostrophes typographiques et le ☆.
// ⚠️ LOCAL À LA JOINTURE DES IMAGES, VOLONTAIREMENT. `normaliserNom` est partagé avec pont-cartes.js
// (la chaîne de production), et côté Cardmarket les crochets portent les ATTAQUES
// (« Alakazam [Damage Swap | Confuse Ray] », lus par decomposerNomCardmarket) : les effacer là-bas
// fondrait le nom et les attaques. Ici, sur des noms source PKMJP et des noms Bulbapedia, aucun des
// deux n'utilise les crochets pour autre chose que la lettre.
const nomImage = n => normaliserNom(String(n ?? '').replace(/[\[\]]/g, ' '));

async function joindreImages(M, L, slug, S, entrees, mesures, dossierRapport, { silencieux = false } = {}) {
    const code = L.code;
    const dire = (...a) => { if (!silencieux) console.log(...a); };
    // ---- 4. jointure image -> carte --------------------------------------------------------
    const cartes = await M.Carte.find({ sets: slug }).lean();
    const nomsCibles = [].concat(L.bulba.expansion);
    // ⚠️ TOUS LES NUMÉROS DE LA CARTE, PAS LE PREMIER. Une carte e-Card porte DEUX numéros dans son
    // set (holo et non-holo : Pidgeot est « 123/091 » dans Base Expansion Pack) ; n'indexer que le
    // premier rendait l'image du 091 orpheline, sans que rien ne dise pourquoi. C'est le même défaut
    // que la jointure du TEXTE avait déjà corrigé — corrigé à un endroit, laissé à l'autre.
    const TIRAGE = L.bulba.tirage || 'jp';
    const impsDe = c => (c.impressions || []).filter(i => i.tirage === TIRAGE && nomsCibles.includes(i.expansion) && (!L.bulba.deck || i.deck === L.bulba.deck));
    // 🔴 LA CLÉ GARDE SON PRÉFIXE ALPHABÉTIQUE, ET ELLE AVAIT ÉTÉ CORRIGÉE D'UN SEUL CÔTÉ (§21 bis).
    // `chiffresDuNumero` (« en1 » -> « 1 ») a donné à Ekans n°001 le visuel de l'Énergie Plante « en1 » :
    // artofpkm numérote les énergies d'un set à part (en1…en8), et les feuillets d'Expansion Sheet
    // « recommended rules no. 1 ». La jointure du TEXTE utilisait déjà `cleNumero` depuis le 2026-09-12 ;
    // celle des IMAGES est restée sur l'ancienne. Rejeu mesuré avant de changer : 17 904 jointures
    // IDENTIQUES, 0 déplacée, 0 ambiguë, 15 perdues — et les 15 sont exactement les 15 visuels faux.
    const parNumero = new Map(), parNom = new Map();
    for (const c of cartes) {
        for (const num of [...new Set(impsDe(c).map(i => cleNumero(i.numero)).filter(Boolean))]) {
            if (!parNumero.has(num)) parNumero.set(num, []);
            if (!parNumero.get(num).includes(c)) parNumero.get(num).push(c);
        }
        const k = nomImage(c.nomEn);
        if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(c);
    }
    // 🔴 UNE IMAGE PARTAGÉE N'A QU'UN `set`, ET LES « ADDITIONALS » JAPONAISES N'EN VOYAIENT AUCUNE — corrigé le 2026-09-23.
    // Le document `images` est clé par (source, set source, n) : xsv2a et sv2a lisent LA MÊME liste artofpkm (n° 490), donc
    // les MÊMES documents, et le premier collecté y écrit son slug. Au passage de xsv2a, xm2a, xsv8a, xsv11B et xsv11W
    // (2026-09-20, ~1 s chacun), les originaux étaient « déjà faits » sous le slug de la base : `set: slug` rendait ZÉRO
    // image, la jointure ne joignait rien, et l'unité sortait « fait/verifie ». 737 cartes rattachées, 0 visuel, aucune
    // erreur — une concordance juste sur un ensemble vide (§21 n°8). Pour un set À BASE PARTAGÉE, on lit donc les images
    // par leur set SOURCE, qui est la vraie clé ; et on ne réécrit PAS le document image (l. suivante), qui appartient à
    // la base — lui poser la mention « motif non distingué » la ferait porter à la base.
    const partagees = !!S?.setDeBase;
    const images = await M.Image.find(partagees ? { source: SOURCE, sourceSetId: { $in: S.ids }, etat: 'ok' } : { source: SOURCE, set: slug, etat: 'ok' }).lean();
    // 🔑 LA MENTION VOYAGE AVEC LA DONNÉE (2026-09-19). Les expansions « Additionals » de Cardmarket sont des VARIANTES
    // (motifs Master Ball, Poké Ball) qui partagent le numéro du set de base ; artofpkm, lui, ne publie qu'UNE image par
    // NUMÉRO — mesuré : Terastal Festival ex, 381 numéros distincts, aucun doublon. Leur visuel est donc le bon numéro du
    // bon set, mais PAS le motif du produit. Sans cette mention, quelqu'un comparera un jour deux variantes en croyant
    // voir deux visuels différents : la ligne le dit elle-même, à côté de la preuve.
    const mention = S?.motifNonDistingue ? 'variante Cardmarket : la source ne distingue pas le motif — une image par numéro' : null;
    const restes = [];
    const cartesAvecImage = new Set();
    let jointes = 0, clesRefusees = 0;
    const preuves = {};
    const resolues = [];                  // passe 1 : la carte de chaque image ; passe 2 (plus bas) : l'écriture
    for (const im of images) {
        let cands = [], preuve = null;
        const num = cleNumero(im.numero);
        // Une correction LUE À L'ŒIL passe avant le numéro (collecte-cartes/corrections-images.js : les deux témoins par
        // le nom ont été mesurés et refusés). Elle ne joint que si la carte nommée est dans CE set.
        const corr = correctionDe(im.cleR2);
        if (corr) { cands = cartes.filter(c => c._id === corr.carteId); preuve = `correction lue à l'œil le ${corr.le} (« ${corr.lu} »)`; }
        else if (num && parNumero.size) { cands = parNumero.get(num) || []; preuve = 'numero'; }
        if (!corr && !cands.length && im.nomEn) {
            cands = parNom.get(nomImage(im.nomEn)) || [];
            preuve = 'nom';
            if (cands.length > 1 && im.illustrateur) {
                const ill = cands.filter(c => normaliserNom(c.illustrateur) === normaliserNom(im.illustrateur));
                if (ill.length) { cands = ill; preuve = 'nom+illustrateur'; }
            }
            // LA RARETÉ, DERNIER DÉPARTAGE — et il NOMME SON PÉRIMÈTRE, comme l'exige le dépôt :
            // « seul EX AEQUO à porter cette rareté », jamais « le seul ». Les sets Gym japonais
            // fusionnent Gym Heroes et Gym Challenge sur une page : deux cartes y portent le même
            // nom, le même illustrateur (Ken Sugimori partout) et AUCUN numéro. La rareté est le
            // seul champ qui diffère, et la source la porte sur 14 entrées sur 14.
            // ⚠️ STRICTEMENT ADDITIF : il ne s'exécute que sur `cands.length > 1`, donc il ne peut
            // déplacer aucune jointure qui marche déjà. C'est ce qui le rend câblable sans mesure
            // d'effet préalable (CLAUDE.md §20, le coût nul) — et son compte s'imprime quand même.
            if (cands.length > 1 && im.rarete) {
                const r = normaliserRarete(im.rarete);
                const parRarete = r ? cands.filter(c => impsDe(c).some(i => normaliserRarete(i.rarete) === r)) : [];
                if (parRarete.length === 1) { cands = parRarete; preuve = 'nom+rarete'; }
            }
        }
        if (cands.length === 1) resolues.push({ im, carteId: cands[0]._id, c: cands[0], preuve });
        else if (!cands.length) restes.push({ set: slug, type: 'image-sans-carte', detail: `${im._id} « ${im.titre} » n°${im.numero ?? '—'}`, le: new Date() });
        else restes.push({ set: slug, type: 'image-vers-plusieurs-cartes', detail: `${im._id} « ${im.titre} » -> cartes ${cands.map(c => c._id).join(', ')}`, le: new Date() });
    }
    // 🔴 UNE CLÉ QUE PLUSIEURS IMAGES PARTAGENT N'EN DÉSIGNE AUCUNE (2026-09-24, collecte-cartes/images-cle-partagee.js) :
    // « Victory Ring » porte le « numéro » XY-P sur 24 images de 24 tournois ; la clé (carte, set, numéro) n'en gardait que
    // la dernière lue, affichée comme LE visuel. Refusées et nommées ; une entrée déjà affichée n'est pas retirée ici.
    const refusees = clesPartagees(resolues);
    for (const { im, c, preuve } of resolues) {
        if (refusees.has(`${c._id}|${String(im.numero).trim()}`)) {
            clesRefusees++;
            restes.push({ set: slug, type: 'image-cle-partagee', detail: `${im._id} « ${im.titre} » n°${im.numero} → carte ${c._id} : ce numéro sans chiffre est porté par plusieurs images différentes de la carte — aucune ne le désigne`, le: new Date() });
            continue;
        }
        {
            if (!partagees) await M.Image.updateOne({ _id: im._id }, { $set: { carteId: c._id, preuve, ...(mention ? { mention } : {}) } });
            // 🔴 UNE IMAGE APPARTIENT À UNE IMPRESSION, PAS À UNE CARTE (CLAUDE.md §19). `image`,
            // champ unique, donnait un seul visuel à une carte qui vit dans plusieurs sets : 60
            // cartes de la base, 29 déjà pourvues. `images` est une LISTE clé par `set`, comme la
            // jointure l'est par produit. L'ancien champ est retiré au passage.
            // 🔑 LE `numero` EST REPORTÉ ICI, ET IL N'A JAMAIS MANQUÉ : la ligne 306 le LIT pour
            // joindre, et cette entrée-ci ne le reportait pas — lu, utilisé, jeté. Une page
            // Bulbapedia est une carte TOUS TIRAGES FUSIONNÉS (§19) et un set moderne réimprime ses
            // cartes en secrète et en illustration rare : sans le numéro, deux impressions d'un même
            // document dans un même set ne se distinguent pas, et le site affiche le visuel de
            // l'une pour l'autre (149 fiches mesurées ainsi par l'agent du site).
            // ⚠️ `null` quand la source ne numérote pas — les sets Gym japonais n'ont aucun numéro,
            // et c'est une absence RÉELLE (6 % des images artofpkm), pas un champ oublié.
            const entree = { set: slug, source: SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, numero: im.numero ?? null, preuve, ...(mention ? { mention } : {}), ...langueDeLEntree({ source: SOURCE, ...im }), jointeLe: new Date() };
            // 🔴 LA CLÉ EST (carte, set, NUMÉRO), PAS (carte, set) — corrigé le 2026-09-24. Ce `$pull` retirait TOUTES les images
            // de la carte pour ce set avant d'en poser une : une carte à deux impressions dans le set (Sableye 121 et 291, deux
            // dessins, deux illustrateurs) n'en gardait que la DERNIÈRE jointe. Mesuré : 4 562 images artofpkm jointes à leur
            // carte (`images.carteId`) et absentes de `cartes.images`, sur 165 sets — Shiny Treasure ex 292, Terastal Festival
            // 184, VSTAR Universe 163. Le §32 bis et le §45 l'avaient écrit ; la jointure du TEXTE et celle de Bulbapedia le
            // faisaient, celle-ci non (§21 bis). `numero: null` (sources sans numéro, Gym) reste une entrée par carte.
            await M.Carte.updateOne({ _id: c._id }, { $pull: { images: { set: slug, numero: entree.numero } } });
            await M.Carte.updateOne({ _id: c._id }, { $push: { images: entree }, $unset: { image: 1 } });
            cartesAvecImage.add(c._id); jointes++; preuves[preuve] = (preuves[preuve] || 0) + 1;
        }
    }
    // Une carte SANS image n'est pas un échec : c'est l'état attendu quand la source ne l'a pas
    // (PKMJP ne liste pas les énergies de base), et c'est déjà la règle d'affichage du catalogue
    // (symbole du set, mention d'indisponibilité). Elles se COMPTENT et se nomment, elles ne sont
    // pas des restes.
    const cartesSansImage = cartes.filter(c => !cartesAvecImage.has(c._id)).map(c => ({ carteId: c._id, nomEn: c.nomEn }));
    await M.Reste.deleteMany({ set: slug, type: { $in: ['image-sans-carte', 'carte-sans-image', 'image-vers-plusieurs-cartes', 'image-cle-partagee'] } });
    if (restes.length) await M.Reste.insertMany(restes);

    // ---- 5. complétude ----------------------------------------------------------------------
    // LA DÉFINITION (corrigée le 2026-09-12, comme pour le texte) : la source a ce qu'elle a. Trois
    // égalités qui n'ont pas de raison d'être fausses : (1) originaux téléchargés = entrées de la
    // source ; (2) chaque original est joint à UNE carte ; (3) aucune image vers plusieurs cartes.
    // Les cartes sans image sont un état attendu, imprimé avec son dénominateur.
    const nEntrees = S.ids.reduce((a, id) => a + entrees[id].length, 0);
    const restesParType = restes.reduce((a, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {});
    // ⚠️ UN SET À EMPLACEMENTS N'EST PAS UN SET À CARTES. Un deck (Intro Pack : 41 emplacements pour
    // 22 cartes) place la MÊME carte à plusieurs rangs : `jointes` compte alors des RATTACHEMENTS,
    // pas des images conservées — 80 rattachements pour 22 cartes, une seule entrée survivant par
    // (carte, set). Exiger `jointes === images` y crie sur un cas normal, et deux compteurs justes
    // se lisent comme une contradiction (CLAUDE.md §21 : c'est la portée qui manquait, pas le chiffre).
    // Le deck se reconnaît au rapport emplacements/cartes, il ne se déclare pas à la main.
    const emplacements = cartes.length > 0 && nEntrees / cartes.length >= 1.5;
    const complet = {
        entreesSource: nEntrees, cartesDuSet: cartes.length, imagesOk: images.length,
        rattachements: jointes, clesRefusees, cartesCouvertes: cartesAvecImage.size, emplacements, preuves,
        cartesSansImage: cartesSansImage.length, restes: restesParType, mesures,
        // Sur un set à cartes : chaque original joint UNE carte. Sur un set à emplacements : toutes
        // les cartes sont couvertes. Dans les deux cas : les originaux valent les entrées de la source.
        // Une image refusée pour clé partagée n'est pas un original perdu : elle est NOMMÉE (reste `image-cle-partagee`).
        concordance: nEntrees === images.length
            && (emplacements ? cartesAvecImage.size === cartes.length : jointes + clesRefusees === images.length)
            && !restesParType['image-vers-plusieurs-cartes'],
        verifieLe: new Date()
    };
    await M.Set.updateOne({ _id: slug }, { $set: { completImages: complet, cartesSansImage } });
    dire(`\n════ COMPLÉTUDE IMAGES ${code} — dénominateur : ${nEntrees} entrées source, ${cartes.length} cartes du set ════`);
    dire(`   originaux = entrées source   : ${images.length} = ${nEntrees}${emplacements ? `   (set à EMPLACEMENTS : ${(nEntrees / cartes.length).toFixed(2)} par carte)` : ''}`);
    dire(emplacements
        ? `   cartes couvertes = cartes    : ${cartesAvecImage.size} = ${cartes.length}  ·  ${jointes} rattachements pour ${cartesAvecImage.size} cartes (une entrée par carte et par numéro)  ${complet.concordance ? '✅ concordants' : '❌ NON concordants'}`
        : `   images jointes = originaux   : ${jointes} = ${images.length}  ·  preuves ${JSON.stringify(preuves)}  ${complet.concordance ? '✅ concordants' : '❌ NON concordants'}`);
    dire(`   cartes sans image (attendu)  : ${cartesSansImage.length} / ${cartes.length}${cartesSansImage.length ? ' — ' + cartesSansImage.map(c => c.nomEn).join(', ') : ''}`);
    dire(`   restes par type              : ${JSON.stringify(restesParType)}`);
    for (const r of restes.slice(0, 40)) dire(`      · ${r.type} : ${r.detail}`);
    fs.mkdirSync(dossierRapport, { recursive: true });
    fs.writeFileSync(path.join(dossierRapport, `images-${code}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ complet, restes, echantillon: images.slice(0, 5) }, null, 1));
    return complet;
}

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ buckets: ['R2_BUCKET_IMAGES'], production: false });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
    const dossierRapport = arg('rapport') || path.join(__dirname, 'collecte-cartes', 'rapports');
    // `--rejouer-jointure=<CODE|tous>` : refait la JOINTURE image -> carte depuis la base, sans
    // toucher à la source. Aucun verrou global : il ne protège que la bande passante d'un tiers, et
    // rien ne sort d'ici. C'est ce qui permet de corriger un schéma sans retélécharger 400 images.
    if (arg('rejouer-jointure')) {
        const codes = arg('rejouer-jointure') === 'tous' ? TABLE_CODES : arg('rejouer-jointure').split(',').map(s => s.trim());
        for (const code of codes) {
            const L = ligneDeTable(code);
            if (!L) { console.error(`  ${code} : absent de la table`); continue; }
            const e = await M.EtatImages.findById(`${SOURCE}/${L.slugSet}`).lean();
            if (!e?.entrees) { console.log(`  ${code} : jamais collecté, rien à rejouer`); continue; }
            const r = await joindreImages(M, L, L.slugSet, sourceDe(code, SOURCE), e.entrees, e.mesures || {}, dossierRapport, { silencieux: true });
            console.log(`  ${code.padEnd(7)} ${r.imagesOk} images · ${r.cartesCouvertes} carte(s) couverte(s) / ${r.cartesDuSet}${r.emplacements ? ` (deck : ${r.rattachements} rattachements)` : ''} · ${r.cartesSansImage} sans image · ${JSON.stringify(r.restes)} ${r.concordance ? '✅' : '❌'}`);
        }
        await fermer(); return;
    }

    // `--verrou` : QUI tient le verrou global, et depuis quand. Lecture seule, ne prend rien —
    // c'est LA commande à lancer avant tout collecteur, et pour vérifier qu'un seul tourne.
    if (process.argv.includes('--verrou')) {
        const g = await M.EtatImages.findById(VERROU_GLOBAL).lean();
        const ageS = g?.verrou ? Math.round((Date.now() - new Date(g.verrou.depuis).getTime()) / 1000) : null;
        const frais = g?.verrou && ageS * 1000 < VERROU_GLOBAL_MS && g.verrou.pid != null;
        const zombie = g?.verrou && g.verrou.pid == null;
        console.log(frais
            ? `🔒 verrou global ${SOURCE} TENU par pid ${g.verrou.pid} sur ${g.verrou.hote}, battement ${new Date(g.verrou.depuis).toISOString()} (il y a ${ageS} s)`
            : zombie
                ? `🧟 verrou global ${SOURCE} ZOMBIE : aucun propriétaire, battement il y a ${ageS} s — il sera repris tel quel par le prochain collecteur.`
                : `🔓 verrou global ${SOURCE} LIBRE${g?.verrou ? ` (dernier détenteur pid ${g.verrou.pid} sur ${g.verrou.hote}, battement périmé il y a ${ageS} s)` : ''}`);
        const parSet = await M.EtatImages.find({ _id: { $ne: VERROU_GLOBAL }, verrou: { $exists: true } }).lean();
        for (const e of parSet) {
            const f = (Date.now() - new Date(e.verrou.depuis).getTime()) < VERROU_MS;
            console.log(`   ${f ? '🔒' : '🔓 périmé'} ${e._id} : pid ${e.verrou.pid} sur ${e.verrou.hote}, phase ${e.phase}, ${e.requetes ?? '?'} requêtes`);
        }
        if (!parSet.length) console.log('   aucun verrou de set.');
        await fermer(); return;
    }

    // `--liberer-verrou` : la sortie de secours, et elle REFUSE si le détenteur est vivant.
    // Un verrou dont le battement a moins de 3 minutes appartient à un processus qui collecte :
    // le libérer remettrait deux collecteurs sur la source. `--force` passe outre, et le dit.
    if (process.argv.includes('--liberer-verrou')) {
        const g = await M.EtatImages.findById(VERROU_GLOBAL).lean();
        if (!g?.verrou) console.log('🔓 déjà libre, rien à faire.');
        else {
            const ageS = Math.round((Date.now() - new Date(g.verrou.depuis).getTime()) / 1000);
            // Un verrou SANS PROPRIÉTAIRE est un zombie, jamais un vivant : il se libère sans --force.
            const vivant = ageS * 1000 < VERROU_GLOBAL_MS && g.verrou.pid != null;
            if (vivant && !process.argv.includes('--force')) {
                console.error(`⛔ REFUS : pid ${g.verrou.pid} sur ${g.verrou.hote} bat depuis ${ageS} s — il COLLECTE. Le libérer remettrait deux collecteurs sur ${SOURCE}. Attends ${Math.ceil((VERROU_GLOBAL_MS / 1000 - ageS))} s, ou --force si tu sais ce processus mort.`);
                await fermer(); process.exit(1);
            }
            await M.EtatImages.updateOne({ _id: VERROU_GLOBAL }, { $unset: { verrou: 1 } });
            console.log(`🔓 verrou global libéré (détenteur pid ${g.verrou.pid} sur ${g.verrou.hote}, battement il y a ${ageS} s${vivant ? ' — LIBÉRÉ EN FORCE' : ', mort'}).`);
        }
        await fermer(); return;
    }

    // L'effacement ne frappe pas la source : il n'a pas besoin du verrou global.
    if (process.argv.includes('--arreter-et-effacer')) { await effacerTout(M, process.argv.includes('--confirmer')); await fermer(); return; }
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
    // LE VERROU GLOBAL, pris AVANT toute collecte : un seul collecteur frappe la source à la fois,
    // quelle que soit la machine et quel que soit le set. Voir son bloc en tête de fichier.
    // En BOUCLE (worker) on ATTEND ; en lancement manuel on refuse tout de suite.
    if (!await attendreVerrouGlobal(M, { patienter: process.argv.includes('--boucle') })) { await fermer(); process.exit(1); }
    // 🔴 PLUS AUCUN RENDU DANS UN GESTIONNAIRE DE SIGNAL. Le SIGTERM rendait le verrou IMMÉDIATEMENT
    // pendant que l'autre gestionnaire laissait finir l'unité en cours : l'ancien pod requêtait sans
    // verrou et le nouveau entrait (08:21:12 → 08:21:53 UTC, le 2026-09-13). Le signal lève
    // `arretDemande` ; le verrou se rend APRÈS l'unité, en sortie de boucle, et seulement s'il est à nous.
    const rendreVerrouGlobal = () => verrouGlobal.rendre();

    if (process.argv.includes('--boucle')) {
        console.log('--boucle : file d\'attente `file_images`, un set à la fois, 10 min de sommeil quand elle est vide.');
        // 🔑 LA BALISE, POSÉE AVANT TOUT : elle dit QUEL CODE tourne ici, et elle doit vivre au
        // repos comme au travail. Le verrou, lui, dit qui a le droit de frapper la source — il
        // disparaît dès qu'on dort, et c'est pour ça qu'il ne pouvait pas porter cette réponse.
        await balise.battre(M.EtatImages.db, 'travail');
        // 🔴 LA BALISE MOURAIT PENDANT LE TRAVAIL — constaté le 2026-09-23, par la garde elle-même. Elle battait « à
        // chaque tour et pendant le sommeil », et un tour, c'est une unité ENTIÈRE : une unité Bulbapedia dure 2 à 10
        // min, la fraîcheur en exige une toutes les 3. La garde voyait donc une balise PÉRIMÉE pendant que le worker
        // collectait, ne pouvait pas conclure — et bloquait. Elle avait raison (§51) ; c'est la balise qui mentait sur
        // son propre contrat : « elle vit tant que le processus vit » était écrit, « elle bat entre deux unités » était
        // codé. 🔑 Une durée de vie se tient par une MINUTERIE, jamais par les points de passage d'une boucle dont on ne
        // borne pas la durée des tours. Les battements explicites restent : ils portent l'ÉTAT (travail/repos) à l'instant.
        let etatBalise = 'travail';
        const minuterieBalise = setInterval(() => {
            balise.battre(M.EtatImages.db, etatBalise).catch(e => console.warn(`⚠️ balise : battement manqué (${e.message}) — la garde bloquera, et c'est le bon sens`));
        }, 60 * 1000);
        while (!arretDemande) {
            etatBalise = 'travail';
            await balise.battre(M.EtatImages.db, 'travail');
            // Réveil après un sommeil : le verrou a été RENDU pour dormir, on le reprend (en attendant son
            // détenteur s'il le faut) avant de toucher à la file.
            if (!verrouGlobal.tenu && !verrouGlobal.perdu) { if (!await attendreVerrouGlobal(M, { patienter: true })) break; }
            // ⚠️ LA POSSESSION SE REVÉRIFIE AVANT CHAQUE SET, pas seulement au démarrage : un verrou pris à
            // minuit ne dit rien de 08:20. Non tenu = arrêt, Render relance, le neuf attend son tour.
            if (!await verrouGlobal.tient()) { console.error('⛔ verrou global non tenu avant de prendre un set : arrêt.'); process.exitCode = 1; break; }
            await reprendreEnCoursFiges(File, M);
            // 🔑 L'ALIMENTATEUR (2026-09-25) : sous 3 unités, le worker remplit SA file lui-même — plus gros manques d'abord,
            // toutes sources légales, reprise seulement sur cause neuve (collecte-cartes/alimentateur.js, banc
            // test-alimentateur.js). Il lit les règles de CE commit : ce qu'il enfile est exécuté par le code qui l'a choisi.
            // Une file encore vide après lui est une ALERTE écrite en base, jamais un sommeil muet. Son échec ne tue pas la
            // boucle (la file déjà pleine continue de tourner) — mais il crie.
            try { await alimenter(cx.db, { journal: console }); }
            catch (e) { console.error(`🔴 alimentateur en échec : ${e.message} — la file ne se remplira pas d'elle-même tant que ce n'est pas corrigé`); }
            // `pasAvant` : une unité remise en file après une surcharge de la source attend son délai (issue-unite.js).
            const suivant = await File.findOneAndUpdate({ etat: 'attente', $or: [{ pasAvant: { $exists: false } }, { pasAvant: { $lte: new Date() } }] }, { $set: { etat: 'en-cours', pris: new Date() } }, { sort: { ordre: 1 }, new: true }).lean();
            // 🔑 ON DORT SANS LE VERROU (2026-09-14). Le verrou global protège la CADENCE des requêtes chez la
            // source ; un worker qui dort n'en fait aucune. Le garder pendant dix minutes de sommeil — soit
            // en permanence sur une file vide — interdisait toute requête ponctuelle sous verrou : la
            // vérification de la pagination, accordée par le testeur, a été REFUSÉE ainsi le 2026-09-13.
            // Sommeil INTERROMPABLE : un SIGTERM pendant les 10 minutes sort tout de suite.
            if (!suivant) {
                await verrouGlobal.rendre();
                // ⚠️ LA BALISE BAT PENDANT LE SOMMEIL, ET C'EST TOUT L'INTÉRÊT : une file vide est
                // exactement le moment où l'on veut la remplir, donc exactement le moment où la
                // garde doit pouvoir lire le commit du worker. Le verrou vient d'être rendu ; la
                // balise reste.
                etatBalise = 'repos';
                for (let t = 0; t < 10 * 60 * 1000 && !arretDemande; t += 5000) {
                    await new Promise(r => setTimeout(r, 5000));
                    if (t % 60000 === 0) await balise.battre(M.EtatImages.db, 'repos').catch(() => { });
                }
                continue;
            }
            // 🔑 DEUX SOURCES DANS UNE SEULE FILE (2026-09-19). artofpkm ne couvre QUE le japonais : 193 sets
            // collectés en texte — tout l'occidental — n'avaient aucune source d'images. La file porte donc
            // `source` ; sans le champ, c'est artofpkm, et rien ne change pour les 196 entrées déjà écrites.
            // ⚠️ LES DEUX VERROUS GLOBAUX SONT DISTINCTS PARCE QUE CE NE SONT PAS LES MÊMES SERVEURS (§17) :
            // on REND celui d'artofpkm avant de frapper Bulbagarden, et on prend le sien — que le collecteur
            // de TEXTE prend aussi depuis le 2026-09-14, donc les deux ne peuvent pas doubler la cadence.
            const sourceDuSet = suivant.source || SOURCE;
            let b;
            if (sourceDuSet === 'bulbapedia') {
                const bulbaImg = require('./collecteur-images-bulba');
                await verrouGlobal.rendre();
                const vb = fabriquerVerrou({ Modele: M.EtatImages, id: bulbaImg.VERROU_GLOBAL, dureeMs: bulbaImg.VERROU_GLOBAL_MS, surInsertion: { phase: 'collecteur' }, surPerte, nom: `verrou global ${bulbaImg.SOURCE}` });
                let tenuPar = await vb.prendre();
                for (let essai = 0; tenuPar && !arretDemande; essai++) {
                    if (essai === 0) console.log(`⏳ verrou global ${bulbaImg.SOURCE} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote} (battement il y a ${tenuPar.ageS} s) — j'attends, ${ATTENTE_VERROU_MS / 1000} s entre deux essais.`);
                    await new Promise(r => setTimeout(r, ATTENTE_VERROU_MS));
                    tenuPar = await vb.prendre();
                }
                if (tenuPar) { await File.updateOne({ _id: suivant._id }, { $set: { etat: 'attente' }, $unset: { pris: 1 } }); break; }
                try { b = await bulbaImg.collecterSet(suivant._id, M, { mesurerSeulement: false }); }
                finally { await vb.rendre(); }
            } else if (sourceDuSet === 'tcgdex') {
                // 🔑 TROISIÈME SOURCE, TROISIÈME VERROU (2026-09-23) : api.tcgdex.net n'est ni Bulbagarden ni artofpkm (§17).
                // Le verrou est LIÉ au client TCGdex : sans lui tenu, le client refuse toute requête (garde fermée).
                const tcgImg = require('./collecteur-images-tcgdex');
                await verrouGlobal.rendre();
                const vt = fabriquerVerrou({ Modele: M.EtatImages, id: tcgImg.VERROU_GLOBAL, dureeMs: tcgImg.VERROU_GLOBAL_MS, surInsertion: { phase: 'collecteur' }, surPerte, nom: `verrou global ${tcgImg.SOURCE}` });
                let tenuPar = await vt.prendre();
                for (let essai = 0; tenuPar && !arretDemande; essai++) {
                    if (essai === 0) console.log(`⏳ verrou global ${tcgImg.SOURCE} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote} (battement il y a ${tenuPar.ageS} s) — j'attends, ${ATTENTE_VERROU_MS / 1000} s entre deux essais.`);
                    await new Promise(r => setTimeout(r, ATTENTE_VERROU_MS));
                    tenuPar = await vt.prendre();
                }
                if (tenuPar) { await File.updateOne({ _id: suivant._id }, { $set: { etat: 'attente' }, $unset: { pris: 1 } }); break; }
                try { b = await tcgImg.collecterSet(suivant, M, { verrou: vt }); }
                finally { await vt.rendre(); }
            } else b = await collecterSet(suivant._id, M, dossierRapport);
            // ⚠️ UN SET INTERROMPU RETOURNE EN ATTENTE, JAMAIS EN « REFUSÉ ». Un arrêt (SIGINT,
            // redéploiement, verrou d'un autre) n'est pas un verdict sur le set : le marquer
            // « refuse » le sortait de la file pour toujours, et personne ne l'aurait repris.
            // 🔑 ET UN ÉCHEC PASSAGER N'EST PAS UN VERDICT NON PLUS (LOR, CRE, 2026-09-24) : la décision vit dans
            // collecte-cartes/issue-unite.js (banc test-issue-unite.js) — en queue, pas avant 10 min, 3 passages au plus.
            const I = issueDeLUnite(b, suivant);
            const ordre = I.enQueue ? ((await File.find({}).sort({ ordre: -1 }).limit(1).lean())[0]?.ordre ?? 0) + 1 : undefined;
            await File.updateOne({ _id: suivant._id }, {
                $set: { etat: I.etat, resultat: b.etat, ...(I.etat === 'attente' ? {} : { fini: new Date() }), ...(I.tentatives ? { tentatives: I.tentatives } : {}), ...(I.pasAvant ? { pasAvant: I.pasAvant, ordre } : {}) },
                ...(I.etat === 'attente' ? { $unset: { pris: 1 } } : {})
            });
            if (I.enQueue) console.log(`↩️ ${suivant._id} remis en file, en queue, pas avant ${I.pasAvant.toISOString()} (${b.etat}, passage ${I.tentatives}).`);
            if (I.arreter) { console.log(`↩️ ${suivant._id} remis en attente (${b.etat}).`); break; }
        }
        clearInterval(minuterieBalise);
        await rendreVerrouGlobal(); await fermer(); return;
    }

    const codes = arg('sets') ? arg('sets').split(',').map(s => s.trim()) : arg('set') ? [arg('set')] : null;
    if (!codes) { console.error('❌ ARRÊT : --set=<CODE>, --sets=A,B,C, --enfiler=… ou --boucle obligatoire.'); await rendreVerrouGlobal(); await fermer(); process.exit(1); }
    const bilan = [];
    for (const code of codes) {
        if (arretDemande) break;
        if (!await verrouGlobal.tient()) { console.error('⛔ verrou global non tenu avant de prendre un set : arrêt.'); process.exitCode = 1; break; }
        bilan.push(await collecterSet(code, M, dossierRapport));
    }
    console.log('\nbilan :', bilan.map(b => `${b.code} ${b.etat}`).join(' · '));
    if (process.argv.includes('--attendre-a-la-fin')) { console.log('--attendre-a-la-fin : le processus reste vivant (worker), rien ne tourne plus.'); await rendreVerrouGlobal(); setInterval(() => { }, 60000); return; }
    await rendreVerrouGlobal(); await fermer();
})().catch(async e => { console.error('❌ ERREUR', e); process.exit(1); });
