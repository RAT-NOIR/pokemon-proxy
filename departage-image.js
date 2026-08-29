// ============================================================================
// LE DÉPARTAGE PAR L'IMAGE — là où le texte n'a rien à dire, et NULLE PART AILLEURS
// ============================================================================
// Branché le 2026-08-29, après la mesure sur les 66 vérités du banc.
//
// CE QUI AUTORISE CE FICHIER À EXISTER. Sur « la cellule » — carte asiatique dont ni le
// total ni le code de set n'ont pu être lus — le scoring met la bonne carte au rang 1
// dans 10 cas sur 44. L'image y arrive à 41 sur 44.
//
//   population           n    image  scoring   D+   D−   test des signes
//   la cellule          44      41      10     31    0   p < 0,0001   ✅
//   asiatique hors      14      12      13      1    2   p = 1,00     🔴 sans effet
//   OCCIDENTAL           8       4       8      0    4   🔴 L'IMAGE Y CASSE DES LIGNES
//
// 🔴 LA DERNIÈRE LIGNE EST LA RAISON DE LA GARDE DE PÉRIMÈTRE CI-DESSOUS. Sur
// l'occidental le scoring fait 8/8 et l'image 4/8 : brancher partout ne serait pas
// « gagner un peu moins », ce serait CASSER ce qui marche.
//
// ⚠️ ET LA CAUSE N'EST PAS LA QUALITÉ DES RÉFÉRENCES — c'est mesuré, pas supposé. La même
// chute apparaît avec des scans Cardmarket et avec des rendus TCGdex. Les cartes modernes
// et occidentales, brillantes et lisses, ne donnent presque pas de points d'intérêt
// stables : 9,5 inliers pour la vraie carte contre 4,5 pour le meilleur faux, là où la
// cellule fait 34,5 contre 6,5. Sur l'occidental, le signal est à ras du bruit.
//
// ----------------------------------------------------------------------------
// LE RÉGLAGE, ET POURQUOI 150 ET PAS 200
// ----------------------------------------------------------------------------
// Mesuré sur les mêmes 44 lignes de cellule, en comparaison APPARIÉE :
//   200 points -> 42/44, D+ 32, D− 0, mais 502 Mo en base et UN rang 1 fragile
//   150 points -> 41/44, D+ 31, D− 0,      378 Mo en base et ZÉRO rang 1 fragile
//   100 points -> 40/44, D+ 31, D− 1
// La seule ligne perdue entre 200 et 150 est L046 Raichu, qui gagnait 41 inliers contre
// 40 — un pile ou face, et précisément le seul rang 1 fragile du jeu. 150 points ne perd
// pas une bonne ligne : il perd la seule qui n'en était pas une.
//
// 🔴 200 POINTS EST ÉLIMINÉ PAR LA PLACE, ET C'EST MESURÉ EN BASE, PAS ESTIMÉ :
//   · la base « test » occupe déjà 58,8 Mo facturés (Atlas gratuit = 512 Mo) ;
//   · 1 000 documents réels écrits puis relus dans `test_scratch` donnent un ratio
//     stockage/BSON de ×1,022 — LA COMPRESSION AGRANDIT. Un descripteur ORB est une
//     signature binaire quasi aléatoire : gzip -9, plus fort que le snappy de
//     WiredTiger, ne fait que ×0,997 dessus. Il n'y a rien à gagner de ce côté.
//   · 200 points -> 577 Mo au total. 150 points -> 455 Mo, soit 57 Mo de marge.
//
// ----------------------------------------------------------------------------
// 🔴 LE RACCOURCI QU'IL NE FAUT PAS PRENDRE — écrit en toutes lettres
// ----------------------------------------------------------------------------
// Quelqu'un, dans six mois, croira optimiser en écrivant ceci :
//
//     « ce candidat n'a pas de vecteur, il ne peut pas gagner de toute façon,
//       donc je le retire du groupe et je départage les autres. »
//
// C'EST FAUX, ET ÇA FABRIQUE UNE VICTOIRE. Si la carte réelle est justement celle sans
// référence, l'appariement désignera un autre candidat — et AVEC ASSURANCE, puisque plus
// rien ne lui fait concurrence. Retirer le candidat aveugle ne supprime pas l'incertitude :
// il supprime LA TRACE de l'incertitude. Le score monte, la justesse baisse, et rien dans
// les chiffres ne le montre.
// D'où la garde : TOUS les candidats du groupe, ou abstention. Coût mesuré sur le trafic
// réel : 7,6 à 8,4 % des groupes. ⚠️ Ce chiffre MONTERA après l'import du catalogue (les
// produits neufs arrivent sans image) ; s'il passe le quart, la règle est à rediscuter.
//
// ----------------------------------------------------------------------------
// CE MODULE EST INERTE TANT QUE LA BASE EST VIDE, ET C'EST VOULU
// ----------------------------------------------------------------------------
// Aucun vecteur en base -> la garde ne passe jamais -> abstention systématique -> le
// classement du scoring sort intact. Le branchement peut donc être déployé AVANT
// l'écriture des descripteurs, sans changer un seul verdict. Les deux bascules sont
// séparées, et c'est la seule façon de savoir laquelle a cassé quoi.
// ============================================================================
const mongoose = require('mongoose');
const S = require('./scoring');
const { interrogerSource } = require('./sources');

// Le réglage, en un seul endroit. Changer un de ces nombres INVALIDE les mesures
// ci-dessus : les descripteurs en base sont calculés avec, et un index à 150 points ne
// s'apparie pas avec une requête décrite à 200.
const N_POINTS = 150;
const LARGEUR = 640;
const RATIO_LOWE = 0.75;
const SEUIL_RANSAC = 5.0;
// Au-delà, on ne télécharge même pas : un vivier de cette taille coûterait plus que
// l'appel IA lui-même. Mesuré : 1,32 ms par appariement.
const VIVIER_MAX = 600;

// ── LA COLLECTION ───────────────────────────────────────────────────────────
// ⚠️ COLLECTION DÉDIÉE, PAS UN CHAMP DE `catalogue_produits`. C'est délibéré et ça a été
// écrit avant d'être codé : `import-catalogue.js` réécrit `catalogue_produits` à chaque
// import Cardmarket. Un champ `desc` y vivrait jusqu'au premier réimport, puis
// disparaîtrait EN SILENCE — et la seule trace serait une chute du taux de départage que
// personne ne relierait à l'import.
//
// TROIS ÉTATS, et le troisième n'est pas un détail :
//   'indexee'      -> un vecteur existe, le candidat peut concourir
//   'absente'      -> Cardmarket ne sert PAS d'image pour ce produit. C'est une propriété
//                     du produit, pas un défaut de collecte : la recollecter est inutile.
//   'non-collectee'-> une image existe mais on ne l'a pas prise (111 cartes, arbitrage
//                     assumé sur les petits sets). Recollectable, contrairement à 'absente'.
// La distinction décide de ce qu'il faut RETOURNER CHERCHER. La confondre ferait
// retourner 111 fois vers des pages qui n'ont rien de plus à donner.
const referenceImageSchema = new mongoose.Schema({
    idProduct: { type: Number, required: true, unique: true, index: true },
    etat: { type: String, enum: ['indexee', 'absente', 'non-collectee'], required: true },
    pts: { type: Number, default: null },     // le réglage AVEC LEQUEL le vecteur a été calculé
    desc: { type: Buffer, default: null },    // n × 32 octets, ORB binaire
    xy: { type: Buffer, default: null },      // n × 4 octets, coordonnées en uint16
    maj: { type: Date, default: Date.now }
}, { collection: 'references_image' });
const ReferenceImage = mongoose.models.ReferenceImage
    || mongoose.model('ReferenceImage', referenceImageSchema);

// ── LES MODULES LOURDS, CHARGÉS TARD ────────────────────────────────────────
// ⚠️ +72,9 Mo de RSS et +294 ms de démarrage, MESURÉS (3 processus neufs, médiane). Sur un
// plan Render gratuit c'est une part réelle du budget mémoire, et un serveur qui ne verra
// jamais une carte de cellule n'a aucune raison de la payer au réveil.
// ⚠️ ET L'INITIALISATION WASM EST DANS LE `require`, PAS DANS LE `await` : 169 ms pour le
// require seul, 231 ms pour le module réellement prêt. C'est l'erreur d'instrument déjà
// consignée (un « 0 ms » mesuré du mauvais côté de la frontière) ; ne pas la refaire.
let _cv = null, _sharp = null, _chargement = null, _indisponible = null;
async function outils() {
    if (_cv && _sharp) return { cv: _cv, sharp: _sharp };
    if (_indisponible) throw new Error(_indisponible);
    if (!_chargement) {
        _chargement = (async () => {
            _sharp = require('sharp');
            const cv = await require('@techstark/opencv-js');
            if (typeof cv.Mat !== 'function') throw new Error('opencv-js chargé mais non initialisé');
            _cv = cv;
        })().catch(e => {
            // Un serveur sans ces modules doit SERVIR, pas planter. L'absence est retenue
            // pour ne pas retenter à chaque scan, et elle est bruyante une fois.
            _indisponible = `opencv/sharp indisponibles : ${e.message}`;
            console.error(`🔴 [image] ${_indisponible} — le départage par l'image est désactivé.`);
            throw e;
        });
    }
    await _chargement;
    return { cv: _cv, sharp: _sharp };
}

// ============================================================================
// LA CONDITION DE DÉCLENCHEMENT — la seule, et elle ne se dérive nulle part ailleurs
// ============================================================================
// Telle que posée par le testeur, mot pour mot :
//     · pas de total lu OU égalité au sommet du scoring
//     · ET tous les candidats du groupe ont un vecteur
//
// ⚠️⚠️ ET UNE TROISIÈME LIGNE QUE JE N'AI PAS REÇUE ET QUE J'AJOUTE — DÉCLARÉE ICI PLUTÔT
// QUE GLISSÉE. La consigne disait aussi, en rouge : « ON NE TOUCHE PAS au chemin
// occidental/moderne ». Or la condition ci-dessus, appliquée à la lettre, S'Y DÉCLENCHE :
// une carte occidentale sans total lu la remplit, et les 3 échecs occidentaux en
// `egalite-parfaite` la remplissent aussi — ce sont des égalités au sommet.
// Sans garde de périmètre, le premier scan occidental à total illisible passerait par
// l'image, où elle fait 4/8 contre 8/8 au scoring. Les deux consignes se contredisent ;
// j'applique l'INTENTION explicite (ne rien casser à l'ouest) et je le signale au lieu de
// choisir en silence.
// La garde est un seul test, isolé et nommé pour être retirée d'une ligne le jour où les
// 15 vérités occidentales manquantes auront été saisies — ce qui est justement la mesure
// que le testeur a parquée.
const GARDE_PERIMETRE_ASIATIQUE = true;

/**
 * Le groupe départagé, et pourquoi il est parfois le vivier ENTIER.
 * Sur « pas de total lu », rien dans le texte ne restreint : le groupe est tout le
 * classement — c'est exactement ce que la mesure des 66 a fait, elle a reclassé les 62
 * candidats moyens. Sur « égalité au sommet », le groupe est l'ensemble des ex aequo au
 * sens de `S.sontExAequo` — LA définition du scoring, jamais un `===` réécrit ici.
 */
function conditionDeclenchement({ langue, total, classement }) {
    const vide = { declenche: false, groupe: [], motif: null };
    if (!Array.isArray(classement) || classement.length < 2) {
        return { ...vide, motif: 'un seul candidat — rien à départager' };
    }
    if (GARDE_PERIMETRE_ASIATIQUE && !S.LANGUES_ASIATIQUES.includes(String(langue || '').toUpperCase())) {
        return { ...vide, motif: 'hors périmètre asiatique' };
    }
    const totalLu = String(total ?? '').trim() !== '';
    if (!totalLu) {
        return { declenche: true, groupe: classement.slice(0, VIVIER_MAX), motif: 'pas-de-total-lu' };
    }
    const exAequo = classement.filter(c => Number.isFinite(c?.score) && Number.isFinite(classement[0]?.score)
        && S.sontExAequo(c.score, classement[0].score));
    if (exAequo.length > 1) {
        return { declenche: true, groupe: exAequo, motif: 'egalite-au-sommet' };
    }
    return { ...vide, motif: 'le scoring sépare' };
}

// ── LE CALCUL ───────────────────────────────────────────────────────────────
async function decrire(buffer) {
    const { cv, sharp } = await outils();
    const { data, info } = await sharp(buffer).resize({ width: LARGEUR, fit: 'inside' })
        .greyscale().raw().toBuffer({ resolveWithObject: true });
    const m = new cv.Mat(info.height, info.width, cv.CV_8UC1);
    m.data.set(data);
    const orb = new cv.ORB(N_POINTS);
    const kp = new cv.KeyPointVector(), des = new cv.Mat();
    orb.detectAndCompute(m, new cv.Mat(), kp, des);
    const n = des.rows;
    const desc = Buffer.from(des.data.slice(0, n * (des.cols || 32)));
    const xy = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
        const p = kp.get(i).pt;
        xy.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(p.x))), i * 4);
        xy.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(p.y))), i * 4 + 2);
    }
    kp.delete(); des.delete(); m.delete(); orb.delete && orb.delete();
    return { n, desc, xy };
}

// Un appariement + vérification géométrique. Rend le nombre d'inliers — le score.
// ⚠️ Les Mat d'OpenCV WASM ne sont pas ramassées par le GC de V8 : chaque `new` a son
// `.delete()`, y compris sur le chemin d'erreur. Une fuite ici mangerait le peu de
// mémoire d'un plan gratuit, et lentement — donc invisible jusqu'au redémarrage.
function inliers(cv, req, ref) {
    if (!req?.n || !ref?.n || req.n < 2 || ref.n < 2) return 0;
    const A = new cv.Mat(req.n, 32, cv.CV_8UC1), B = new cv.Mat(ref.n, 32, cv.CV_8UC1);
    A.data.set(req.desc); B.data.set(ref.desc);
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const mm = new cv.DMatchVectorVector();
    let compte = 0;
    try {
        bf.knnMatch(A, B, mm, 2);
        const src = [], dst = [];
        for (let i = 0; i < mm.size(); i++) {
            const m = mm.get(i);
            if (m.size() < 2) continue;
            const m0 = m.get(0), m1 = m.get(1);
            if (m0.distance < RATIO_LOWE * m1.distance) {
                src.push(req.xy.readUInt16LE(m0.queryIdx * 4), req.xy.readUInt16LE(m0.queryIdx * 4 + 2));
                dst.push(ref.xy.readUInt16LE(m0.trainIdx * 4), ref.xy.readUInt16LE(m0.trainIdx * 4 + 2));
            }
        }
        const n = src.length / 2;
        if (n >= 4) {
            const ms = cv.matFromArray(n, 1, cv.CV_32FC2, src);
            const md = cv.matFromArray(n, 1, cv.CV_32FC2, dst);
            const masque = new cv.Mat();
            try {
                const H = cv.findHomography(ms, md, cv.RANSAC, SEUIL_RANSAC, masque);
                if (!H.empty()) for (let i = 0; i < masque.rows; i++) compte += masque.data[i] ? 1 : 0;
                H.delete();
            } catch (_) { /* homographie dégénérée : 0 inlier, ce n'est pas une panne */ }
            ms.delete(); md.delete(); masque.delete();
        }
    } finally {
        mm.delete(); bf.delete && bf.delete(); A.delete(); B.delete();
    }
    return compte;
}

async function chargerVecteurs(ids) {
    if (mongoose.connection.readyState !== 1 || !ids.length) return new Map();
    const docs = await ReferenceImage.find(
        { idProduct: { $in: ids }, etat: 'indexee', pts: N_POINTS },
        { idProduct: 1, desc: 1, xy: 1 }
    ).lean();
    const m = new Map();
    for (const d of docs) {
        if (!d.desc?.length || !d.xy?.length) continue;
        m.set(d.idProduct, { n: Math.floor(d.desc.length / 32), desc: d.desc, xy: d.xy });
    }
    return m;
}

// ============================================================================
// LE POINT D'ENTRÉE — une seule fonction, et elle ne LÈVE JAMAIS
// ============================================================================
// ⚠️ ELLE NE RÉORDONNE RIEN ELLE-MÊME ET NE RETIRE JAMAIS UN CANDIDAT. Elle rend un AVIS ;
// c'est l'appelant qui décide. Une fonction qui déciderait et journaliserait à la fois
// rendrait impossible de mesurer ce qu'elle AURAIT fait quand elle s'abstient — or c'est
// exactement ce qu'on veut mesurer (voir `champs`, journalisé à CHAQUE scan).
//
// ⚠️ ET UNE PHOTO INJOIGNABLE N'EST PAS UNE ABSENCE DE CANDIDAT. Le téléchargement passe
// par `interrogerSource`, donc la panne est inscrite au contexte du scan et le motif de
// refus éventuel sera requalifié en `echec-technique` (voir NATURE_REFUS dans index.js).
// Le classement du scoring, lui, sort intact : s'abstenir ne coûte jamais un candidat.
async function departager({ imageUrl, langue, total, classement }) {
    const t0 = Date.now();
    const champs = {
        imageStatut: 'non-calcule',
        imageMotif: null,
        imageGagnant: null,
        imageInliers: null,
        imageInliersSecond: null,
        imageRangDuGagnantScoring: null,
        imageCandidatsAvecVecteur: null,
        imageCandidatsGroupe: null,
        imagePoints: N_POINTS,
        imageMs: null
    };
    const rien = (statut, motif) => {
        champs.imageStatut = statut; champs.imageMotif = motif;
        champs.imageMs = Date.now() - t0;
        return { departage: false, gagnant: null, champs };
    };

    const cond = conditionDeclenchement({ langue, total, classement });
    champs.imageMotif = cond.motif;
    if (!cond.declenche) return rien('hors-condition', cond.motif);

    const ids = cond.groupe.map(c => c?.idProduct).filter(id => id != null);
    champs.imageCandidatsGroupe = ids.length;

    let vecteurs;
    try { vecteurs = await chargerVecteurs(ids); }
    catch (e) { console.error(`❌ [image] lecture des vecteurs : ${e.message}`); return rien('echec-technique', 'lecture-vecteurs'); }
    champs.imageCandidatsAvecVecteur = vecteurs.size;

    // 🔴 LA GARDE. Voir le raccourci à ne pas prendre, en tête de fichier.
    if (vecteurs.size !== ids.length) {
        return rien('abstention-garde', `${ids.length - vecteurs.size} candidat(s) sans vecteur sur ${ids.length}`);
    }
    if (!imageUrl) return rien('abstention-garde', 'aucune URL de photo');

    // Le téléchargement — le seul appel réseau que ce module fait.
    const { valeur: buffer, panne } = await interrogerSource('photo/annonce', async () => {
        const r = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
    });
    if (panne || !buffer) return rien('echec-technique', 'photo-injoignable');

    let requete, cv;
    try {
        ({ cv } = await outils());
        requete = await decrire(buffer);
    } catch (e) {
        console.error(`❌ [image] description de la requête : ${e.message}`);
        return rien('echec-technique', 'description-requete');
    }
    if (!requete.n) return rien('abstention-signal', 'la photo ne donne aucun point d\'intérêt');

    const scores = [];
    for (const id of ids) {
        try { scores.push({ idProduct: id, inliers: inliers(cv, requete, vecteurs.get(id)) }); }
        catch (e) { console.error(`❌ [image] appariement ${id} : ${e.message}`); return rien('echec-technique', 'appariement'); }
    }
    scores.sort((a, b) => b.inliers - a.inliers);

    champs.imageGagnant = scores[0].idProduct;
    champs.imageInliers = scores[0].inliers;
    champs.imageInliersSecond = scores.length > 1 ? scores[1].inliers : null;
    // Où l'image place le gagnant DU SCORING. C'est ce champ, croisé avec une vérité
    // saisie plus tard, qui permettra de recompter D+ et D− sur du trafic réel sans
    // rejouer quoi que ce soit.
    const idScoring = classement[0]?.idProduct;
    const r = scores.findIndex(s => s.idProduct === idScoring);
    champs.imageRangDuGagnantScoring = r >= 0 ? r + 1 : null;

    // Aucun inlier nulle part : l'image n'a rien vu. Ce n'est pas un départage à zéro,
    // c'est une abstention — départager sur 0 contre 0 serait tirer au sort.
    if (!scores[0].inliers) return rien('abstention-signal', 'aucun inlier sur tout le groupe');

    champs.imageStatut = 'departage';
    champs.imageMs = Date.now() - t0;
    return { departage: true, gagnant: scores[0].idProduct, champs };
}

module.exports = {
    departager, conditionDeclenchement, chargerVecteurs, decrire, inliers, outils,
    ReferenceImage, N_POINTS, LARGEUR, RATIO_LOWE, SEUIL_RANSAC, GARDE_PERIMETRE_ASIATIQUE
};
