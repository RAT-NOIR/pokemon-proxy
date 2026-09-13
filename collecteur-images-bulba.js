// ============================================================
// COLLECTEUR D'IMAGES — Bulbapedia -> R2 (WebP 700) + base `cartes`, SETS OCCIDENTAUX
// ============================================================
//   node collecteur-images-bulba.js --plan    [--sets=PBL,JTG]   zéro requête, zéro écriture, zéro verrou
//   node collecteur-images-bulba.js --mesurer  --sets=PBL,JTG     imageinfo seulement (tailles), en cache
//   node collecteur-images-bulba.js --sets=PBL,JTG [--attendre]   collecte
//   node collecteur-images-bulba.js --verrou                      qui tient, lecture seule
//
// ⛔ LE WORKER RENDER EST LE SEUL COLLECTEUR. Ce fichier ne se lance en local qu'avec --plan.
//
// Ce qu'il fait, par set :
//   1. RÉSOLUTION PAR TIRAGE depuis le wikitext sur R2 (collecte-cartes/tirage-image.js) — zéro requête.
//      Seul `num` (un fichier de CE set et de CE numéro) est collecté ; `set-voisin`, `absent`,
//      `ambigu`, `conflit` sont comptés et nommés, jamais servis : ce serait un visuel faux.
//   2. IMAGEINFO par lots de 50 (url, taille, sha1), mis en cache dans l'état : une reprise ne redemande rien.
//   3. SEUIL : set REFUSÉ si la largeur MÉDIANE est sous LARGEUR_MIN (TR, mesuré : médiane 350) ;
//      sinon chaque fichier sous le seuil est écarté et compté.
//   4. ORIGINAL -> sha1 contrôlé contre imageinfo -> WebP 700 q80 -> R2 -> ligne `images` (APRÈS R2).
//   5. JOINTURE, gratuite : l'image vient de la page de la carte, donc `carteId` est connu d'avance.
//      `cartes.images[]` reçoit une entrée par TIRAGE collecté (set + numéro), la plus basse d'abord.
//   6. COMPLÉTUDE : dénominateurs imprimés et écrits dans `sets.completImages`.
//
// DÉBIT : collecte-cartes/bulba.js — `api` et `telecharger` partagent UNE file, 1 requête / 5 s pour
// tout Bulbagarden. VERROUS : collecte-cartes/verrou-source.js — global `bulbapedia/__collecteur__`
// (distinct de celui d'artofpkm : ce ne sont pas les mêmes serveurs) et un par set ; possession
// pid + hôte + jeton, libération conditionnelle APRÈS l'unité, battement qui lit son résultat,
// revérification avant chaque set.
// ⚠️ LE COLLECTEUR DE TEXTE frappe aussi Bulbapedia et NE PREND PAS ce verrou global (écrit avant lui).
// En attendant qu'il le prenne, celui-ci refuse de démarrer si un verrou de texte est frais.

require('dotenv').config();
const crypto = require('crypto');
const sharp = require('sharp');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const bulba = require('./collecte-cartes/bulba');
const { ligne, TABLE } = require('./collecte-cartes/table-sets');
const { modeles } = require('./collecte-cartes/schemas');
const { resoudreTirages, numeroEntier } = require('./collecte-cartes/tirage-image');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { LARGEUR_MIN, WEBP_LARGEUR, WEBP_QUALITE } = require('./collecte-cartes/seuils-images');

const SOURCE = 'bulbapedia';
const VERROU_GLOBAL = `${SOURCE}/__collecteur__`;
const VERROU_GLOBAL_MS = 3 * 60 * 1000;    // trois battements manqués
const VERROU_SET_MS = 10 * 60 * 1000;       // même borne que les verrous de set du texte et d'artofpkm
const ATTENTE_VERROU_MS = 30 * 1000;
const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const drapeau = nom => process.argv.includes(`--${nom}`);

let arretDemande = false;
process.on('SIGINT', () => { console.warn('\n⏹️  arrêt demandé : on finit l\'unité en cours.'); arretDemande = true; });
// Aucun rendu de verrou ici : le verrou se rend APRÈS l'unité, en sortie de boucle (verrou-source.js).
process.on('SIGTERM', () => { console.warn('\n⏹️  SIGTERM : on finit l\'unité en cours.'); arretDemande = true; });
const surPerte = () => { arretDemande = true; process.exitCode = 1; };

const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const cleTitre = t => String(t).replace(/^File:/i, '').replace(/_/g, ' ').trim();

/** Étape 1 — la résolution par tirage, depuis R2. Zéro requête. */
async function resoudreSet(M, L) {
    const slug = L.slugSet;
    const cartes = await M.Carte.find({ sets: slug }).select('nomEn impressions bulba').lean();
    const plan = [], autres = [], classes = {};
    let impressions = 0, sansWikitext = 0;
    for (let i = 0; i < cartes.length; i += 12) {
        await Promise.all(cartes.slice(i, i + 12).map(async c => {
            if (!c.bulba?.cleR2) { sansWikitext++; return; }
            const wt = await r2.lireTexte(process.env.R2_BUCKET_BRUT, c.bulba.cleR2);
            for (const r of resoudreTirages(wt, c, L.bulba.expansion, { tirage: 'intl' })) {
                impressions++;
                classes[r.classe] = (classes[r.classe] || 0) + 1;
                const base = { carteId: c._id, nomEn: c.nomEn, page: c.bulba.titre, numero: r.impression.numero, rarete: r.impression.rarete };
                if (r.classe === 'num') plan.push({ ...base, fichier: r.fichier, preuve: r.preuve });
                else autres.push({ ...base, classe: r.classe, candidats: r.candidats });
            }
        }));
    }
    return { cartes, plan, autres, classes, impressions, sansWikitext };
}

function imprimerResolution(L, R) {
    console.log(`\n══ ${L.code} « ${L.nom} » — ${R.cartes.length} cartes, ${R.impressions} impressions « ${L.bulba.expansion} » ══`);
    console.log(`1. résolution par tirage (zéro requête) : ${JSON.stringify(R.classes)}${R.sansWikitext ? ` · ${R.sansWikitext} carte(s) SANS wikitext sur R2` : ''}`);
    console.log(`   à collecter : ${R.plan.length} fichiers · écartés : ${R.autres.length} (visuel d'un autre tirage ou d'aucun)`);
    for (const a of R.autres.slice(0, 8)) console.log(`      · ${a.classe} : « ${a.page} » n°${a.numero}${a.candidats.length ? ` — fichiers du set : ${a.candidats.join(', ')}` : ''}`);
    if (R.autres.length > 8) console.log(`      · … et ${R.autres.length - 8} autres`);
}

/**
 * Le cache imageinfo du set, relu de l'état. Stocké en LISTE et non en objet indexé par nom de fichier :
 * une clé Mongo ne porte pas de point, et tous les noms de fichier en ont un.
 */
async function relireCache(M, idEtat) {
    const e = await M.EtatImages.findById(idEtat).select('infosListe').lean();
    return Object.fromEntries((e?.infosListe || []).map(x => [x.fichier, x.absent ? null : { url: x.url, w: x.w, h: x.h, mime: x.mime, sha1: x.sha1 }]));
}

async function collecterSet(code, M, { mesurerSeulement }) {
    const L = ligne(code);
    if (!L) { console.error(`❌ ${code} : absent de la table.`); return { code, etat: 'refuse-table' }; }
    if (L.region !== 'occidental' || L.bulba?.tirage !== 'intl') { console.error(`❌ ${code} : pas un set occidental — ses images viennent d'artofpkm.`); return { code, etat: 'refuse-region' }; }
    const slug = L.slugSet;
    const idEtat = `${SOURCE}/${slug}`;
    const verrouSet = fabriquerVerrou({ Modele: M.EtatImages, id: idEtat, dureeMs: VERROU_SET_MS, surInsertion: { debute: new Date(), phase: 'resolution' }, surPerte, nom: `verrou de set ${idEtat}` });
    const tenuPar = await verrouSet.prendre();
    if (tenuPar) { console.error(`❌ ${code} : ${idEtat} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote} (battement il y a ${tenuPar.ageS} s).`); return { code, etat: 'refuse-verrou' }; }
    const requetesAuDebut = bulba.compteRequetes();
    try {
        const R = await resoudreSet(M, L);
        imprimerResolution(L, R);
        if (!R.plan.length) return { code, etat: 'rien-a-collecter', classes: R.classes };

        // ---- 2. tailles, imageinfo seulement pour ce qui n'est pas en cache -------------------------
        const cacheObj = await relireCache(M, idEtat);
        const manquants = [...new Set(R.plan.map(p => p.fichier))].filter(f => !(f in cacheObj));
        for (let i = 0; i < manquants.length && !arretDemande; i += 50) {
            const lot = manquants.slice(i, i + 50);
            const infos = await bulba.imageinfoDe(lot.map(f => `File:${f}`));
            const parCle = new Map([...infos].map(([t, v]) => [cleTitre(t), v]));
            for (const f of lot) { const v = parCle.get(cleTitre(f)); cacheObj[f] = v ? { url: v.url, w: v.width, h: v.height, mime: v.mime, sha1: v.sha1 } : null; }
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { infosListe: Object.entries(cacheObj).map(([fichier, v]) => ({ fichier, ...(v || { absent: true }) })), phase: 'imageinfo', derniereRequete: new Date(), requetes: bulba.compteRequetes() } });
        }
        if (arretDemande) return { code, etat: 'interrompu' };
        const largeurs = R.plan.map(p => cacheObj[p.fichier]?.w).filter(Boolean).sort((a, b) => a - b);
        const mediane = largeurs[Math.floor(largeurs.length / 2)] ?? null;
        const fichiersAbsents = R.plan.filter(p => !cacheObj[p.fichier]);
        const sousSeuil = R.plan.filter(p => cacheObj[p.fichier] && cacheObj[p.fichier].w < LARGEUR_MIN);
        console.log(`2. tailles : ${largeurs.length} lues sur ${R.plan.length} · largeur min ${largeurs[0]} · médiane ${mediane} · max ${largeurs.at(-1)} · sous ${LARGEUR_MIN} px : ${sousSeuil.length} · fichier absent chez Bulbapedia : ${fichiersAbsents.length}`);
        await M.EtatImages.updateOne({ _id: idEtat }, { $set: { mesure: { lues: largeurs.length, plan: R.plan.length, min: largeurs[0] ?? null, mediane, max: largeurs.at(-1) ?? null, sousSeuil: sousSeuil.length, fichiersAbsents: fichiersAbsents.length } } });
        if (mesurerSeulement) return { code, etat: 'mesure', mediane, sousSeuil: sousSeuil.length, plan: R.plan.length };
        // ---- 3. seuil ----------------------------------------------------------------------------
        // Le SET est refusé sur sa médiane — même sens que le refus d'artofpkm (un set trop bas ne se
        // sert pas à moitié). Au-dessus, les fichiers isolés sous le seuil sont écartés et COMPTÉS.
        if (mediane == null || mediane < LARGEUR_MIN) {
            console.error(`❌ ${code} : largeur médiane ${mediane} px < ${LARGEUR_MIN} — set REFUSÉ, rien n'est téléchargé.`);
            await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'refuse-resolution' } });
            return { code, etat: 'refuse-resolution', mediane };
        }

        // ---- 4. originaux -> WebP -> R2 -> images ------------------------------------------------
        const bucket = process.env.R2_BUCKET_IMAGES;
        const aFaire = R.plan.filter(p => cacheObj[p.fichier] && cacheObj[p.fichier].w >= LARGEUR_MIN);
        let telecharges = 0, sautes = 0, echecs = 0;
        for (const p of aFaire) {
            if (arretDemande) break;
            const _id = `${SOURCE}/${slug}/${p.carteId}/${numeroEntier(p.numero)}`;
            const deja = await M.Image.findById(_id).select('sha256 sha1Original').lean();
            const info = cacheObj[p.fichier];
            if (deja?.sha256 && deja.sha1Original === info.sha1) { sautes++; continue; }
            try {
                const { buffer } = await bulba.telecharger(info.url);
                const sha1 = sha('sha1', buffer);
                if (info.sha1 && sha1 !== info.sha1) throw new Error(`sha1 ${sha1} ≠ imageinfo ${info.sha1} (fichier remplacé entre-temps ?)`);
                const webp = await sharp(buffer).resize({ width: WEBP_LARGEUR, withoutEnlargement: true }).webp({ quality: WEBP_QUALITE }).toBuffer({ resolveWithObject: true });
                const cleR2 = `${SOURCE}/${slug}/${numeroEntier(p.numero)}-${p.carteId}.webp`;
                await r2.deposerBinaire(bucket, cleR2, webp.data, 'image/webp');   // R2 AVANT la ligne
                await M.Image.updateOne({ _id }, {
                    $set: {
                        source: SOURCE, set: slug, carteId: p.carteId, numero: p.numero, rarete: p.rarete, nomEn: p.nomEn,
                        fichier: p.fichier, page: p.page, preuve: p.preuve, urlOriginal: info.url,
                        wOriginal: info.w, hOriginal: info.h, sha1Original: sha1, octetsOriginal: buffer.length,
                        cleR2, sha256: sha('sha256', webp.data), octets: webp.data.length, w: webp.info.width, h: webp.info.height, fmt: 'webp',
                        attribution: 'Bulbapedia', telechargeLe: new Date(), etat: 'ok'
                    }, $unset: { erreur: 1 }
                }, { upsert: true });
                telecharges++;
                await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'originaux', derniereRequete: new Date(), requetes: bulba.compteRequetes() } });
            } catch (err) {
                echecs++;
                console.warn(`   ✗ ${_id} (${p.fichier}) : ${err.message}`);
                await M.Image.updateOne({ _id }, { $set: { source: SOURCE, set: slug, carteId: p.carteId, numero: p.numero, fichier: p.fichier, etat: 'echec', erreur: err.message } }, { upsert: true });
            }
        }
        console.log(`4. originaux : ${telecharges} téléchargés, ${sautes} déjà faits, ${echecs} échecs, sur ${aFaire.length} à faire`);
        if (arretDemande) return { code, etat: 'interrompu', telecharges };

        // ---- 5. jointure -------------------------------------------------------------------------
        const images = await M.Image.find({ source: SOURCE, set: slug, etat: 'ok' }).lean();
        const parCarte = new Map();
        for (const im of images) { if (!parCarte.has(im.carteId)) parCarte.set(im.carteId, []); parCarte.get(im.carteId).push(im); }
        let entreesMultiples = 0;
        for (const [carteId, ims] of parCarte) {
            ims.sort((a, b) => (numeroEntier(a.numero) ?? 1e9) - (numeroEntier(b.numero) ?? 1e9));
            if (ims.length > 1) entreesMultiples++;
            const entrees = ims.map(im => ({ set: slug, source: SOURCE, cleR2: im.cleR2, sha256: im.sha256, w: im.w, h: im.h, fmt: im.fmt, urlOriginal: im.urlOriginal, preuve: `page de la carte + ${im.preuve}`, numero: im.numero, attribution: 'Bulbapedia', page: im.page, jointeLe: new Date() }));
            await M.Carte.updateOne({ _id: carteId }, { $pull: { images: { set: slug, source: SOURCE } } });
            await M.Carte.updateOne({ _id: carteId }, { $push: { images: { $each: entrees } } });
        }

        // ---- 6. complétude -----------------------------------------------------------------------
        const couvertes = new Set(parCarte.keys());
        const motifDe = new Map();
        for (const a of R.autres) if (!couvertes.has(a.carteId)) motifDe.set(a.carteId, a.classe);
        for (const p of sousSeuil) if (!couvertes.has(p.carteId)) motifDe.set(p.carteId, 'sous-seuil');
        for (const p of fichiersAbsents) if (!couvertes.has(p.carteId)) motifDe.set(p.carteId, 'fichier-absent');
        const cartesSansImage = R.cartes.filter(c => !couvertes.has(c._id)).map(c => ({ carteId: c._id, nomEn: c.nomEn, motif: motifDe.get(c._id) || 'aucune-impression-du-set' }));
        const complet = {
            source: SOURCE, impressions: R.impressions, classes: R.classes, aCollecter: R.plan.length,
            sousSeuil: sousSeuil.length, fichiersAbsents: fichiersAbsents.length, imagesOk: images.length, echecs,
            cartesDuSet: R.cartes.length, cartesCouvertes: couvertes.size, cartesSansImage: cartesSansImage.length, entreesMultiples,
            mesure: { mediane, min: largeurs[0] ?? null, max: largeurs.at(-1) ?? null },
            requetesDuSet: bulba.compteRequetes() - requetesAuDebut,
            // Trois égalités : ce qui devait être collecté l'est ; rien n'a échoué ; chaque image joint sa carte.
            concordance: images.length === aFaire.length && echecs === 0 && images.every(im => im.carteId != null),
            verifieLe: new Date()
        };
        await M.Set.updateOne({ _id: slug }, { $set: { completImages: complet, cartesSansImage } });
        await M.EtatImages.updateOne({ _id: idEtat }, { $set: { phase: 'verifie', fini: new Date() } });
        console.log(`\n════ COMPLÉTUDE ${code} — dénominateur : ${R.impressions} impressions, ${R.cartes.length} cartes ════`);
        console.log(`   images ok = à collecter au-dessus du seuil : ${images.length} = ${aFaire.length}  ${complet.concordance ? '✅' : '❌'}`);
        console.log(`   cartes couvertes : ${couvertes.size} / ${R.cartes.length} · ${entreesMultiples} carte(s) à deux tirages ou plus dans ce set`);
        console.log(`   sans image : ${cartesSansImage.length} — ${JSON.stringify(cartesSansImage.reduce((a, c) => (a[c.motif] = (a[c.motif] || 0) + 1, a), {}))}`);
        console.log(`   requêtes Bulbagarden : ${complet.requetesDuSet} pour CE set · ${bulba.compteRequetes()} depuis le démarrage`);
        return { code, etat: complet.concordance ? 'verifie' : 'non-concordant', complet };
    } finally {
        await verrouSet.rendre();
    }
}

(async () => {
    const codesDemandes = arg('sets') ? arg('sets').split(',').map(s => s.trim()).filter(Boolean) : TABLE.filter(l => l.region === 'occidental').map(l => l.code);
    const buckets = drapeau('plan') ? ['R2_BUCKET_BRUT'] : ['R2_BUCKET_BRUT', 'R2_BUCKET_IMAGES'];
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);

    if (drapeau('verrou')) {
        for (const v of await M.EtatImages.find({ _id: new RegExp(`^${SOURCE}/`), verrou: { $exists: true } }).lean()) {
            const ageS = Math.round((Date.now() - new Date(v.verrou.depuis).getTime()) / 1000);
            console.log(`🔒 ${v._id} : pid ${v.verrou.pid} sur ${v.verrou.hote}, battement il y a ${ageS} s`);
        }
        console.log('(fin de la liste des verrous bulbapedia)');
        await fermer(); return;
    }

    // --plan : ce que la collecte FERAIT. Zéro requête, zéro écriture, zéro verrou.
    if (drapeau('plan')) {
        let total = 0, fichiers = 0;
        for (const code of codesDemandes) {
            const L = ligne(code);
            if (!L || L.region !== 'occidental') { console.log(`${code} : pas un set occidental de la table`); continue; }
            const R = await resoudreSet(M, L);
            imprimerResolution(L, R);
            total += R.impressions; fichiers += R.plan.length;
        }
        console.log(`\nPLAN : ${fichiers} fichiers sur ${total} impressions · coût ≈ ${Math.ceil(fichiers / 50)} imageinfo + ${fichiers} téléchargements = ${Math.ceil(fichiers / 50) + fichiers} requêtes à 5 s ≈ ${Math.round((Math.ceil(fichiers / 50) + fichiers) * 5 / 60)} min · requêtes faites : ${bulba.compteRequetes()}`);
        await fermer(); return;
    }

    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
    // Le collecteur de TEXTE frappe le même serveur sans prendre ce verrou : on ne démarre pas à côté.
    const texteVivant = await M.Etat.findOne({ 'verrou.depuis': { $gt: new Date(Date.now() - VERROU_SET_MS) } }).select('verrou').lean();
    if (texteVivant) { console.error(`❌ ARRÊT : le collecteur de TEXTE tient ${texteVivant._id} (pid ${texteVivant.verrou.pid} sur ${texteVivant.verrou.hote}) — même serveur, jamais en parallèle.`); await fermer(); process.exit(1); }

    const verrouGlobal = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_GLOBAL, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'collecteur' }, surPerte, nom: `verrou global ${SOURCE}` });
    for (let essai = 0; ; essai++) {
        const tenu = await verrouGlobal.prendre();
        if (!tenu) break;
        const msg = `verrou global ${SOURCE} tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s)`;
        if (!drapeau('attendre')) { console.error(`❌ ARRÊT : ${msg}. « 1 requête / 5 s, jamais en parallèle » se compte chez la SOURCE.`); await fermer(); process.exit(1); }
        if (essai === 0) console.log(`⏳ ${msg} — j'attends, ${ATTENTE_VERROU_MS / 1000} s entre deux essais.`);
        if (arretDemande) { await fermer(); process.exit(1); }
        await new Promise(r => setTimeout(r, ATTENTE_VERROU_MS));
    }

    const bilan = [];
    try {
        for (const code of codesDemandes) {
            if (arretDemande) break;
            if (!await verrouGlobal.tient()) { console.error('⛔ verrou global non tenu avant de prendre un set : arrêt.'); process.exitCode = 1; break; }
            bilan.push(await collecterSet(code, M, { mesurerSeulement: drapeau('mesurer') }));
        }
    } finally {
        await verrouGlobal.rendre();
    }
    console.log(`\nbilan : ${bilan.map(b => `${b.code} ${b.etat}`).join(' · ')} · requêtes Bulbagarden ${bulba.compteRequetes()}`);
    await fermer();
})().catch(e => { console.error('❌ ERREUR', e); process.exit(1); });
