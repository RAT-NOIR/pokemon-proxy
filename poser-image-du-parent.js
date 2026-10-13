// ============================================================
// IMAGE DU PARENT — Eevee x30C116 reçoit le scan du parent (30th Celebration n°116), marqué « image du parent » — lot EEVEE, liste FERMÉE
// ============================================================
//   node poser-image-du-parent.js                                    (simulation : lecture seule, n'écrit rien)
//   node poser-image-du-parent.js --ecrire --attendu=1               (par lot-additif.js --collections=cartes_produits)
//   node poser-image-du-parent.js --retirer                          (simulation du retrait)
//   node poser-image-du-parent.js --retirer --ecrire --attendu=1     (ne retire QUE ce que ce lot a posé : même lot, imageDuParent:true)
// Code de sortie : 0 ok · 1 le compte diffère de --attendu (ou un refus à l'écriture) · 2 --attendu manquant avec --ecrire, ou argument inconnu.
// Toute la décision vit dans collecte-cartes/image-du-parent.js (testée par test-image-du-parent.js) ; ce fichier ne fait que brancher la base
// et la règle du site, importée telle quelle comme dans poser-visuels-substituts.mjs (`visuelAdmisPourLaRegion`).
const path = require('path');
const { pathToFileURL } = require('url');
const R = 'C:/Users/Yung/Desktop/pokemon-proxy', SITE = 'C:/Users/Yung/Desktop/rat-market-site';
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
if (!process.env.MONGODB_CARTES_URI) dotenv.config({ path: `${R}/.env` });
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const IP = require('./collecte-cartes/image-du-parent');

const AUTORISES = [/^--ecrire$/, /^--retirer$/, /^--attendu=\d+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --retirer, --attendu=N`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire'), retirer = process.argv.includes('--retirer');
const att = process.argv.find(a => a.startsWith('--attendu='));
const ATTENDU = att ? Number(att.slice(10)) : null;
if (ecrire && ATTENDU === null) { console.error('❌ --ecrire exige --attendu=N (le compte regardé en simulation)'); process.exit(2); }

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    let code = 0;
    try {
        const { visuelAdmisPourLaRegion } = await import(pathToFileURL(`${SITE}/lib/langueDuVisuel.ts`).href);
        if (typeof visuelAdmisPourLaRegion !== 'function') throw new Error('la règle du site (visuelAdmisPourLaRegion) est introuvable : arrêt');
        console.log(`LISTE FERMÉE : ${IP.ENTREES.length} entrée(s) · lot ${IP.LOT}`);
        if (!retirer) {
            const plan = await IP.simuler(cx.db, visuelAdmisPourLaRegion);
            for (const x of plan.aPoser) {
                const v = x.visuelSubstitut;
                console.log(`   À POSER sur la ligne ${x.ligneId} (produit ${x.entree.idProduct}, ${x.entree.slugSet})`);
                console.log(`      image ${v.cleR2} · ${v.w}×${v.h} · source ${v.source} · langue ${v.langue} · ${v.set} n°${v.numero}`);
                console.log(`      mention : ${v.mention}`);
                console.log(`      imageDuParent: ${v.imageDuParent} · lot ${v.lot}`);
            }
            for (const x of plan.refus) console.log(`   REFUS ${x.entree._id} : ${x.raison}`);
            console.log(`   ${plan.aPoser.length} à poser · ${plan.refus.length} refus`);
            if (!ecrire) { console.log(`   (simulation : rien écrit — relancer avec --ecrire --attendu=${plan.aPoser.length}, par lot-additif.js --collections=cartes_produits)`); }
            else if (ATTENDU !== plan.aPoser.length) { console.error(`❌ ARRÊT : ${plan.aPoser.length} à poser contre ${ATTENDU} attendus — la base ou la règle a bougé depuis la simulation`); code = 1; }
            else {
                const n = await IP.poser(cx.db, plan);
                const relus = await cx.db.collection('cartes_produits').countDocuments({ 'visuelSubstitut.lot': IP.LOT, 'visuelSubstitut.imageDuParent': true });
                console.log(`   ✅ ${n} posée(s) (attendu ${ATTENDU}) · relu : ${relus} ligne(s) portent imageDuParent de ce lot`);
                if (n !== ATTENDU || relus !== ATTENDU) code = 1;
            }
        } else {
            const plan = await IP.simulerRetrait(cx.db);
            for (const x of plan.aRetirer) console.log(`   À RETIRER sur ${x.entree._id}`);
            for (const x of plan.refus) console.log(`   REFUS ${x.entree._id} : ${x.raison}`);
            console.log(`   ${plan.aRetirer.length} à retirer · ${plan.refus.length} refus`);
            if (!ecrire) { console.log(`   (simulation : rien écrit — relancer avec --retirer --ecrire --attendu=${plan.aRetirer.length})`); }
            else if (ATTENDU !== plan.aRetirer.length) { console.error(`❌ ARRÊT : ${plan.aRetirer.length} à retirer contre ${ATTENDU} attendus`); code = 1; }
            else {
                const n = await IP.retirer(cx.db, plan);
                const reste = await cx.db.collection('cartes_produits').countDocuments({ 'visuelSubstitut.lot': IP.LOT });
                console.log(`   ✅ ${n} retirée(s) (attendu ${ATTENDU}) · relu : ${reste} ligne(s) portent encore ce lot`);
                if (n !== ATTENDU || reste !== 0) code = 1;
            }
        }
    } catch (e) { console.error(`❌ ${e.message}`); code = 1; }
    await fermer();
    process.exit(code);
})();
