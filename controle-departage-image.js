// ============================================================================
// CONTRÔLE DU DÉPARTAGE PAR L'IMAGE — l'instrument avant le service
// ============================================================================
// Ce fichier existe parce que le branchement du 2026-08-29 a réécrit le calcul au lieu de
// le déplacer, et que la réécriture porte un risque précis que personne ne verrait :
//
//   🔴 LE LABO APPARIAIT DES `KeyPointVector` VIVANTS, coordonnées en float32, lues
//      directement d'OpenCV. LA PRODUCTION RECONSTRUIT LES COORDONNÉES DEPUIS UN BUFFER
//      uint16 relu de Mongo. Si l'indexation de ce buffer est décalée d'un octet, ou si
//      `queryIdx`/`trainIdx` sont intervertis, RANSAC reçoit des paires de points fausses
//      et le nombre d'inliers s'effondre. Rien ne planterait : le module rendrait
//      simplement « aucun inlier », le départage s'abstiendrait toujours, et on
//      conclurait que l'image ne marche pas en production alors qu'elle marche très bien.
//      C'est une panne silencieuse qui ressemble exactement à un résultat.
//
// DEUX CONTRÔLES, ET LE PREMIER EST LE PLUS IMPORTANT.
//
//   A. NON-RÉGRESSION DU CALCUL. On rejoue de VRAIES paires (photo d'annonce redressée,
//      scan Cardmarket de la vraie carte) avec le code de PRODUCTION, et on compare au
//      nombre d'inliers que le labo avait relevé sur la même paire. Les valeurs de
//      référence viennent de `justesse-66-150.json` — une mesure réelle, pas une constante
//      choisie pour que le test passe.
//
//   B. INERTIE. Sur les lignes réelles du journal, avec `references_image` telle qu'elle
//      est, le départage doit s'abstenir À CHAQUE FOIS. Tant que ce contrôle rend 100 %
//      d'abstention, le déploiement ne peut changer aucun verdict — c'est ce qui autorise
//      à livrer le code AVANT les descripteurs.
//
// ⚠️ B N'EST PAS UN TEST QUI DOIT RESTER VERT POUR TOUJOURS. Le jour où les descripteurs
// seront écrits, il DOIT devenir rouge : c'est le signal que la bascule a eu lieu. Un
// contrôle dont on attend qu'il change doit dire lequel des deux états il constate, pas
// « passé / échoué ». Il le dit.
//
// ════════════════════════════════════════════════════════════════════════════
// 🔑 CE QU'ON ATTEND DE B UNE FOIS L'INDEX PLEIN — ÉCRIT LE 2026-08-30,
//    AVANT QUE LE PREMIER DESCRIPTEUR SOIT ÉCRIT.
// ════════════════════════════════════════════════════════════════════════════
// ÉTAT DE DÉPART, mesuré index vide, sur les 25 lignes de journal qui portent un vivier :
//     hors-condition ....... 20      abstention-garde ....... 5      départages ....... 0
//
// LE SEUL CHIFFRE QUI DÉCIDE : `abstention-garde` DOIT TOMBER À 0.
// C'est lui, et lui seul, qui dit que les vecteurs sont lus. Les 20 `hors-condition` ne
// dépendent pas des vecteurs (périmètre non asiatique, candidat unique, ou le scoring
// sépare) : ils DOIVENT rester 20. S'ils bougent, c'est la condition qui a changé, et ça
// ne devait pas arriver.
//
// 🔴 ET LE NOMBRE DE DÉPARTAGES NE DÉCIDE DE RIEN. Cinq lignes ne mesurent pas une règle
// mesurée sur 44. Ce contrôle est un TÉMOIN DE VIE, pas une mesure de justesse — celle-là
// vit au banc. Écrire ici « on attend 3 ou 4 départages » serait fabriquer un seuil sur un
// échantillon qui ne peut rien porter. On n'en attend AUCUN nombre précis.
//
// LA TABLE DE LECTURE, et elle est exhaustive :
//   abstention-garde reste à 5      🔴 les vecteurs ne sont pas lus. Trois causes, dans
//                                      l'ordre où les vérifier : mauvais `pts` (un index à
//                                      150 ne répond pas à une requête à 200) · les
//                                      idProduct de ces viviers n'ont pas d'image sur le
//                                      disque · l'écriture s'est arrêtée avant eux.
//   abstention-garde à 0,
//     echec-technique monte         ⚠️ PAS UNE PANNE DU BRANCHEMENT. Les photos de ces
//                                      lignes sont de vieilles URL Vinted qui expirent.
//                                      Le contrôle a franchi la garde — c'est ce qu'on
//                                      voulait savoir — et il bute plus loin, sur le
//                                      réseau. À distinguer en rejouant sur des charges
//                                      fraîches (verrou/charges.json).
//   abstention-garde à 0,
//     tout en abstention-signal     ⚠️ la garde passe et l'appariement ne trouve rien. À
//                                      regarder : c'est le symptôme d'une reconstruction
//                                      uint16 cassée — mais le contrôle A l'aurait déjà dit.
//   abstention-garde à 0, et les 5
//     réparties entre `departage`
//     et `confirme-le-scoring`      ✅ LE BRANCHEMENT EST VIVANT. C'est tout ce que ce
//                                      contrôle peut prouver, et c'est tout ce qu'on lui
//                                      demande.
//   hors-condition ≠ 20             🔴 la condition de déclenchement a changé. Rien dans
//                                      l'écriture des descripteurs ne devait la toucher.
//
// LECTURE SEULE : aucune écriture en base, aucun fichier déplacé.
// USAGE : node controle-departage-image.js [nbPaires]
// ============================================================================
process.env.MONGODB_BASE = process.env.MONGODB_BASE || 'test';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const I = require('./departage-image');

const LABO = 'C:\\Users\\Yung\\Desktop\\labo-embedding';
const PHOTOS = path.join(LABO, 'photos-66-redressees');
const RESULTATS = path.join(LABO, 'justesse-66-150.json');
const RACINE = 'C:\\Users\\Yung\\Desktop\\CARDMARKET IMAGE';
const EST_CARTE = /^(\d+)\.(jpe?g|png|webp)$/i;
// L'écart toléré entre le labo et la production sur une même paire. Il n'est pas nul, et
// ce n'est pas une facilité : ORB et RANSAC sont déterministes, mais les coordonnées
// passent de float32 à uint16 — un arrondi au pixel près sur une image de 640 px, là où
// RANSAC travaille à 5 px. Un écart de quelques inliers est attendu ; un effondrement
// vers zéro est le défaut qu'on cherche.
const ECART_TOLERE = 0.20;

let echecs = 0;
const dire = (ok, texte) => { if (!ok) echecs++; console.log(`   ${ok ? '✅' : '🔴'} ${texte}`); };

(async () => {
    // ── A. NON-RÉGRESSION DU CALCUL ─────────────────────────────────────────
    console.log('═'.repeat(94));
    console.log('A. LE CALCUL — la reconstruction uint16 rend-elle ce que le labo mesurait ?');
    console.log('═'.repeat(94));

    if (!fs.existsSync(RESULTATS) || !fs.existsSync(PHOTOS)) {
        console.log(`   ⚠️ CONTRÔLE NON EXÉCUTÉ : le labo est absent de cette machine.`);
        console.log(`      (${RESULTATS})`);
        console.log(`      Ce n'est pas un succès. Sans lui, la reconstruction uint16 n'est`);
        console.log(`      vérifiée par rien, et le module peut rendre zéro inlier en silence.`);
        echecs++;
    } else {
        const surDisque = new Map();
        (function marche(d) {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) marche(p);
                else { const m = EST_CARTE.exec(e.name); if (m && !surDisque.has(Number(m[1]))) surDisque.set(Number(m[1]), p); }
            }
        })(RACINE);

        const attendus = JSON.parse(fs.readFileSync(RESULTATS, 'utf8'))
            .filter(l => l.ere === 'cellule' && Number.isFinite(l.vrai) && l.vrai > 0);
        const n = Math.min(Number(process.argv[2]) || 8, attendus.length);
        const fichiersPhoto = fs.readdirSync(PHOTOS);
        console.log(`   ${n} paires réelles, réglage ${I.N_POINTS} points (le même des deux côtés)\n`);
        console.log('   clé    carte                 labo   production   écart');

        const { cv } = await I.outils();
        let compares = 0, effondres = 0;
        for (const l of attendus.slice(0, n)) {
            const fPhoto = fichiersPhoto.find(f => f.includes(`_${l.cle}.`));
            const fRef = surDisque.get(l.idVrai);
            if (!fPhoto || !fRef) { console.log(`   ${l.cle}   ${String(l.nom).padEnd(20)} —      (photo ou référence absente)`); continue; }
            const req = await I.decrire(fs.readFileSync(path.join(PHOTOS, fPhoto)));
            const ref = await I.decrire(fs.readFileSync(fRef));
            const obtenu = I.inliers(cv, req, ref);
            const ecart = l.vrai ? Math.abs(obtenu - l.vrai) / l.vrai : 1;
            compares++;
            if (obtenu === 0 || ecart > ECART_TOLERE) effondres++;
            console.log(`   ${l.cle}   ${String(l.nom).padEnd(20)} ${String(l.vrai).padStart(4)}   ${String(obtenu).padStart(10)}   ` +
                `${(100 * ecart).toFixed(0).padStart(4)} %  ${obtenu === 0 ? '🔴 ZÉRO' : ecart > ECART_TOLERE ? '🔴' : '✅'}`);
        }
        console.log('');
        dire(compares > 0, `${compares} paire(s) réellement comparée(s)`);
        dire(effondres === 0, `aucun effondrement (${effondres} sur ${compares}) — la reconstruction uint16 est saine`);
    }

    // ── B. INERTIE ──────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(94));
    console.log('B. L\'INERTIE — sur le trafic réel, avec la base telle qu\'elle est');
    console.log('═'.repeat(94));
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_BASE });
    console.log(`   base : ${mongoose.connection.db.databaseName} (lecture seule)`);
    const vecteurs = await I.ReferenceImage.countDocuments({ etat: 'indexee', pts: I.N_POINTS });
    console.log(`   vecteurs en base (references_image, ${I.N_POINTS} pts) : ${vecteurs}\n`);

    const lignes = await mongoose.connection.collection('journal_scans')
        .find({ vivierIds: { $exists: true } }).sort({ le: -1 }).limit(60).toArray();
    const statuts = new Map();
    let departages = 0;
    for (const d of lignes) {
        const classement = (d.vivierIds || []).map(id => ({ idProduct: id, score: 0 }));
        const avis = await I.departager({
            imageUrl: d.imageUrl, langue: d.langue, total: d.total, classement
        });
        const s = avis.champs.imageStatut;
        statuts.set(s, (statuts.get(s) ?? 0) + 1);
        if (avis.departage) departages++;
    }
    console.log(`   ${lignes.length} lignes de journal rejouées :`);
    for (const [s, n] of [...statuts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`      ${String(s).padEnd(32)} ${String(n).padStart(3)}`);
    }
    console.log('');
    if (vecteurs === 0) {
        dire(departages === 0,
            `AUCUN départage (${departages}) — le branchement est INERTE, il peut partir seul`);
        console.log(`   ℹ️ État constaté : les descripteurs ne sont PAS écrits. C'est l'état`);
        console.log(`      attendu avant la deuxième bascule, pas une panne.`);
    } else {
        // La lecture se fait contre l'attendu ÉCRIT EN TÊTE DE CE FICHIER LE 2026-08-30,
        // avant que le premier descripteur existe. Aucun seuil n'est choisi ici.
        const garde = statuts.get('abstention-garde') ?? 0;
        const hors = statuts.get('hors-condition') ?? 0;
        const echec = statuts.get('echec-technique') ?? 0;
        const signal = statuts.get('abstention-signal') ?? 0;
        const vivants = departages + (statuts.get('confirme-le-scoring') ?? 0);
        console.log(`   ℹ️ ${vecteurs} vecteurs en base : la bascule a eu lieu. L'inertie n'est plus l'attendu.`);
        console.log(`\n   ── LECTURE CONTRE L'ATTENDU ÉCRIT D'AVANCE ──`);
        dire(garde === 0, `abstention-garde à ${garde} (attendu 0) — LE SEUL CHIFFRE QUI DÉCIDE`);
        dire(hors === 20, `hors-condition à ${hors} (attendu 20, ne dépend pas des vecteurs)`);
        if (garde === 0 && vivants > 0) {
            console.log(`   ✅ ${vivants} ligne(s) ont franchi la garde et abouti — LE BRANCHEMENT EST VIVANT.`);
        }
        if (garde === 0 && vivants === 0 && echec > 0) {
            console.log(`   ⚠️ ${echec} echec-technique : la garde est franchie, ça bute plus loin.`);
            console.log(`      Ce sont de vieilles URL Vinted, qui expirent. PAS une panne du`);
            console.log(`      branchement — rejoue sur verrou/charges.json pour le distinguer.`);
        }
        if (garde === 0 && vivants === 0 && signal > 0 && echec === 0) {
            console.log(`   🔴 ${signal} abstention-signal et zéro aboutissement : la garde passe,`);
            console.log(`      l'appariement ne trouve rien. Le contrôle A aurait dû le dire avant.`);
        }
        console.log(`\n   ⚠️ LE NOMBRE DE DÉPARTAGES NE DÉCIDE DE RIEN — ${departages} sur ${lignes.length} lignes.`);
        console.log(`      Ce contrôle est un TÉMOIN DE VIE, pas une mesure de justesse.`);
        console.log(`      La justesse se mesure au banc, sur 44 lignes de cellule.`);
    }

    await mongoose.disconnect();
    console.log('\n' + (echecs === 0 ? '🎉 les contrôles exécutés passent.' : `🔴 ${echecs} contrôle(s) en échec.`));
    process.exit(echecs === 0 ? 0 : 1);
})().catch(e => { console.error(e.stack); process.exit(1); });
