// ============================================================================
// L'ÉCRITURE DES DESCRIPTEURS — reprenable, interruptible, et prudente sur `absente`
// ============================================================================
// Calcule les vecteurs ORB des images du disque et les écrit dans `references_image`.
// C'est la SECONDE bascule du chantier image ; le branchement (departage-image.js) est
// déjà en place et reste inerte tant que cette collection est vide.
//
// ── REPRENABLE, ET VOICI COMMENT ────────────────────────────────────────────
// 🔑 IL N'Y A PAS DE FICHIER D'AVANCEMENT, ET C'EST VOLONTAIRE. L'avancement EST la
// collection : au démarrage, le script lit les `idProduct` déjà écrits AU RÉGLAGE COURANT
// et les retire de sa liste. Interrompu à 40 000, relancé, il reprend à 40 001.
// Un fichier d'avancement séparé pourrait mentir — il se désynchronise dès qu'une écriture
// échoue après avoir été comptée. La base ne peut pas mentir sur ce qu'elle contient.
//
// ⚠️ CHAQUE DOCUMENT EST ÉCRIT D'UN SEUL TENANT : `etat`, `pts`, `desc` et `xy` dans le
// même `updateOne`. Il n'existe donc jamais de document `indexee` sans ses buffers. Une
// interruption laisse des documents ENTIERS ou RIEN — jamais un demi-vecteur.
// C'est ce qui rend la garde de departage-image.js sûre pendant l'écriture : elle exige un
// vecteur pour TOUS les candidats d'un groupe, et un groupe à cheval sur la coupure
// s'abstient proprement. Aucune victoire ne peut être fabriquée par une écriture partielle.
//
// ⚠️ `--pts` FAIT PARTIE DE LA CLÉ DE REPRISE. Relancer à un autre réglage NE reprend PAS :
// un index à 150 points ne s'apparie pas avec une requête décrite à 200. Le script le dit
// et refuse de mélanger.
//
// ── CE QU'IL N'ÉCRIT JAMAIS ─────────────────────────────────────────────────
// 🔴 IL N'ÉCRIT PAS `absente`. Jamais, sous aucune condition. `absente` demande un constat
// positif au niveau de la PAGE de galerie (voir la règle en tête de departage-image.js), et
// ce script ne voit que des fichiers — il ne sait rien des pages. Un produit sans fichier
// reste simplement absent de la collection, donc traité comme « pas de vecteur », donc la
// garde s'abstient. C'est le comportement sûr.
// Il écrit `hors-perimetre` pour les Code Card, parce que celui-là se constate sur le NOM
// et que la chaîne les écarte déjà (`ecarterNonCartes`, index.js:1583).
//
// USAGE :
//   node ecrire-descripteurs.js --base=test --simuler        (ne touche à rien)
//   node ecrire-descripteurs.js --base=test                  (écrit, reprenable)
//   node ecrire-descripteurs.js --base=test --limite=2000    (un premier lot d'essai)
//
// ⚠️ SAUVEGARDE D'ABORD — et la collection visée est NEUVE, donc rien ne peut être écrasé.
// La sauvegarde protège ce qui l'entoure, pas elle :
//   node backup-collections.js --base=test --collections=catalogue_produits,numeros_cartes
//
// MESURÉ le 2026-08-30 : 42,2 ms par image en calcul local, 7,03 Mo/s en écriture vers
// Atlas. Pour 69 146 produits -> ~49 min de calcul et ~1 min de transfert. Le transfert
// n'est pas le sujet ; le processeur l'est.
// ============================================================================
const option = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || '';
const BASE = option('base');
const SIMULER = process.argv.includes('--simuler');
const LIMITE = Number(option('limite')) || Infinity;
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const sharp = require('sharp');
const chargerCv = require('@techstark/opencv-js');
const { ReferenceImage, N_POINTS, LARGEUR } = require('./departage-image');

const PTS = Number(option('pts')) || N_POINTS;
const RACINE = 'C:\\Users\\Yung\\Desktop\\CARDMARKET IMAGE';
const EST_CARTE = /^(\d+)\.(jpe?g|png|webp)$/i;
const EST_CODE_CARD = /code\s*card/i;
const LOT = 500;

let arret = false;
process.on('SIGINT', () => {
    if (arret) process.exit(1);
    arret = true;
    console.log(`\n⏸️  Interruption demandée — le lot en cours se termine, puis on s'arrête proprement.`);
    console.log(`   Relance la MÊME commande pour reprendre où tu en es.`);
});

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE });
    const db = mongoose.connection.db;
    if (db.databaseName !== BASE) { console.error(`❌ base "${db.databaseName}" ≠ "${BASE}".`); process.exit(1); }
    console.log(`base : ${db.databaseName}${SIMULER ? '  (SIMULATION)' : ''} · réglage ${PTS} points\n`);

    // 1. Le disque, par idProduct du NOM DE FICHIER. Règle dure.
    const chemin = new Map();
    (function marche(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) marche(p);
            else { const m = EST_CARTE.exec(e.name); if (m && !chemin.has(Number(m[1]))) chemin.set(Number(m[1]), p); }
        }
    })(RACINE);

    // 2. Les Code Card, écartées d'avance : la chaîne ne les tarife jamais.
    const cc = new Set((await db.collection('catalogue_produits')
        .find({ name: EST_CODE_CARD }, { projection: { idProduct: 1 } }).toArray()).map(x => x.idProduct));

    // 3. 🔑 L'AVANCEMENT EST LA COLLECTION ELLE-MÊME.
    const deja = new Set((await ReferenceImage.find({ pts: PTS }, { idProduct: 1 }).lean()).map(d => d.idProduct));
    const autreReglage = await ReferenceImage.countDocuments({ pts: { $ne: PTS } });

    const aFaire = [...chemin.keys()].filter(id => !deja.has(id) && !cc.has(id)).sort((a, b) => a - b);
    const ccAFaire = [...cc].filter(id => !deja.has(id));

    console.log('═'.repeat(84));
    console.log(`   images sur le disque .............. ${chemin.size}`);
    console.log(`   déjà écrites à ${PTS} points ......... ${deja.size}${deja.size ? '   ← reprise' : ''}`);
    console.log(`   écartées (Code Card) .............. ${ccAFaire.length}   -> 'hors-perimetre'`);
    console.log(`   🔑 RESTE À CALCULER ............... ${Math.min(aFaire.length, LIMITE)}`);
    if (autreReglage) {
        console.log(`\n   🔴 ${autreReglage} document(s) à un AUTRE réglage que ${PTS} points.`);
        console.log(`      Un index à un réglage ne s'apparie pas avec une requête à un autre.`);
        console.log(`      Choisis : relance avec --pts=<l'autre>, ou vide la collection d'abord.`);
        process.exit(1);
    }
    const minutes = (aFaire.length * 42.2 / 60000);
    console.log(`   temps estimé ...................... ${minutes.toFixed(0)} min (42,2 ms/image, mesuré)`);
    console.log('═'.repeat(84) + '\n');
    if (SIMULER) { console.log('SIMULATION — rien n\'a été écrit.'); await mongoose.disconnect(); process.exit(0); }

    const cv = await chargerCv;
    if (typeof cv.Mat !== 'function') { console.error('🔴 OpenCV non initialisé'); process.exit(1); }
    const Binary = mongoose.mongo.Binary;
    const orb = new cv.ORB(PTS);

    // Les Code Card d'abord : c'est instantané, et ça les sort de la liste de travail.
    if (ccAFaire.length) {
        const ops = ccAFaire.map(id => ({
            updateOne: {
                filter: { idProduct: id },
                update: { $set: { idProduct: id, etat: 'hors-perimetre', pts: PTS, desc: null, xy: null, maj: new Date() } },
                upsert: true
            }
        }));
        for (let i = 0; i < ops.length; i += LOT) await ReferenceImage.bulkWrite(ops.slice(i, i + LOT), { ordered: false });
        console.log(`✅ ${ccAFaire.length} Code Card marquées 'hors-perimetre'.\n`);
    }

    let faits = 0, illisibles = 0, sansPoint = 0;
    const t0 = Date.now();
    let tampon = [];
    const vider = async () => {
        if (!tampon.length) return;
        await ReferenceImage.bulkWrite(tampon, { ordered: false });
        tampon = [];
    };

    for (const id of aFaire.slice(0, LIMITE === Infinity ? undefined : LIMITE)) {
        if (arret) break;
        let data, info;
        try {
            ({ data, info } = await sharp(chemin.get(id)).resize({ width: LARGEUR, fit: 'inside' })
                .greyscale().raw().toBuffer({ resolveWithObject: true }));
        } catch (_) {
            // ⚠️ FICHIER ILLISIBLE — et il n'est PAS marqué `absente`. On ne sait pas si
            // Cardmarket a l'image ; on sait que CE fichier-ci est cassé. Deux choses
            // différentes. Il reste hors de la collection, donc « pas de vecteur », donc
            // la garde s'abstient. Comportement sûr, et le produit reste recollectable.
            illisibles++; continue;
        }
        const m = new cv.Mat(info.height, info.width, cv.CV_8UC1);
        m.data.set(data);
        const kp = new cv.KeyPointVector(), des = new cv.Mat();
        orb.detectAndCompute(m, new cv.Mat(), kp, des);
        const n = des.rows;
        if (n === 0) { sansPoint++; kp.delete(); des.delete(); m.delete(); continue; }
        const d = Buffer.from(des.data.slice(0, n * (des.cols || 32)));
        const xy = Buffer.alloc(n * 4);
        for (let i = 0; i < n; i++) {
            const p = kp.get(i).pt;
            xy.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(p.x))), i * 4);
            xy.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(p.y))), i * 4 + 2);
        }
        kp.delete(); des.delete(); m.delete();

        // UN SEUL `$set` : jamais de document `indexee` sans ses buffers.
        tampon.push({
            updateOne: {
                filter: { idProduct: id },
                update: { $set: { idProduct: id, etat: 'indexee', pts: PTS, desc: new Binary(d), xy: new Binary(xy), maj: new Date() } },
                upsert: true
            }
        });
        faits++;
        // ⚠️ LA PROGRESSION EST DÉCOUPLÉE DE L'ÉCRITURE, ET C'EST VOLONTAIRE. Écrire par
        // lots de 500 est efficace, mais n'afficher qu'à chaque lot laisserait 21 secondes
        // d'écran muet — et 21 secondes de silence pendant 49 minutes, on ne sait pas
        // distinguer « ça travaille » de « c'est bloqué ». On affiche donc tous les 200
        // (≈ 8 s) et on écrit tous les 500.
        if (faits % 200 === 0) {
            const parSec = faits / ((Date.now() - t0) / 1000);
            const cible = Math.min(aFaire.length, LIMITE);
            const reste = (cible - faits) / parSec / 60;
            const pc = 100 * faits / cible;
            const barre = '█'.repeat(Math.round(pc / 4)).padEnd(25, '·');
            process.stdout.write(`\r   ${barre} ${String(faits).padStart(6)}/${cible} ` +
                `${pc.toFixed(1).padStart(5)} % · ${parSec.toFixed(1)}/s · reste ~${reste.toFixed(0)} min   `);
        }
        if (tampon.length >= LOT) await vider();
    }
    process.stdout.write('\n');
    await vider();

    const total = await ReferenceImage.countDocuments({ pts: PTS, etat: 'indexee' });
    console.log(`\n${'═'.repeat(84)}`);
    console.log(`   écrits dans cette session ......... ${faits}`);
    console.log(`   fichiers illisibles (NON marqués) . ${illisibles}`);
    console.log(`   images sans aucun point d'intérêt . ${sansPoint}`);
    console.log(`   🔑 TOTAL 'indexee' EN BASE ........ ${total}`);
    console.log(`   durée ............................. ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    if (arret) console.log(`\n   ⏸️  Arrêt demandé. Relance la même commande pour reprendre.`);

    // ════════════════════════════════════════════════════════════════════════
    // 🔑 LE DISQUE EST RELU MAINTENANT, ET COMPARÉ. Sans cette ligne, l'outil ment.
    // ════════════════════════════════════════════════════════════════════════
    // LA LISTE DES IMAGES A ÉTÉ FIGÉE AU DÉMARRAGE. Le testeur collecte pendant que ça
    // tourne — 69 146 images le matin, 70 728 le soir, dans la même journée. Les images
    // arrivées APRÈS le démarrage ne sont pas dans la liste : elles ne seront pas décrites,
    // et le script se terminerait « normalement » sur un index incomplet.
    // Annoncer « 69 771 écrits » sans dire « sur 70 300 présents MAINTENANT » laisserait
    // croire à un index complet. C'est la forme exacte du défaut qu'on traque partout
    // ailleurs : un compte juste qui fait conclure faux.
    const apres = new Set();
    (function marche(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) marche(p);
            else { const m = EST_CARTE.exec(e.name); if (m) apres.add(Number(m[1])); }
        }
    })(RACINE);
    const couverts = new Set((await ReferenceImage.find({ pts: PTS }, { idProduct: 1 }).lean()).map(d => d.idProduct));
    const orphelines = [...apres].filter(id => !couverts.has(id));
    const nouvelles = apres.size - chemin.size;

    console.log(`\n   ── L'INDEX EST-IL COMPLET, MAINTENANT ? ──`);
    console.log(`   images au DÉMARRAGE ............... ${chemin.size}`);
    console.log(`   images MAINTENANT ................. ${apres.size}` +
        `${nouvelles > 0 ? `   (+${nouvelles} arrivées pendant l'exécution)` : ''}`);
    console.log(`   🔑 IMAGES SANS VECTEUR ............ ${orphelines.length}`);
    if (orphelines.length === 0) {
        console.log(`   ✅ INDEX COMPLET — toute image du disque a son vecteur à ${PTS} points.`);
    } else {
        console.log(`   🔴 INDEX INCOMPLET. Ne le crois pas complet.`);
        console.log(`      Cause probable : ${nouvelles > 0 ? `${nouvelles} image(s) collectée(s) pendant l'exécution` : 'interruption, fichiers illisibles, ou images sans point'}.`);
        console.log(`      ➜ RELANCE LA MÊME COMMANDE : elle ne recalculera AUCUN des ${couverts.size}`);
        console.log(`        déjà faits (l'avancement est la collection elle-même) et ne`);
        console.log(`        traitera que les ${orphelines.length} restantes.`);
    }
    console.log(`\n   ⚠️ Le branchement n'est plus inerte. Vérifie avec :`);
    console.log(`      node controle-departage-image.js`);
    await mongoose.disconnect();
    process.exit(0);
})().catch(e => { console.error(e.stack); process.exit(1); });
