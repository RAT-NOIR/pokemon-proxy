// ============================================================
// RECOMPOSER `cartes.nomEn` — `cardname` est l'ESPÈCE, pas le nom de la carte
// ============================================================
//   node recomposer-noms-cartes.js [--ecrire]
//
// LE DÉFAUT : l'infobox de « M Lucario-EX (Furious Fists 55) » porte `cardname=Lucario`. Le suffixe
// vit ailleurs, et à un endroit DIFFÉRENT selon l'ère — `class=ex`, `evostage=MegaEX`, `level=X`, ou
// nulle part (les V, VMAX et VSTAR ne l'ont que dans `jname`). **1 442 cartes sur 15 261 (9,4 %)**
// affichent donc un nom amputé, et toutes les formes y passent à 100 % : ex 442, V 250, GX 188,
// EX 216, VMAX 88, LV.X 57, VSTAR 36, BREAK 35, SP (G/GL/FB/C/4) 59, LEGEND 9, V-UNION 5.
// Seul « ☆ » échappe (0 sur 25) parce que la source le met dans `cardname` : la preuve qu'elle
// distingue les deux emplacements délibérément.
//
// 🔑 LA RÈGLE EST DANS `wikitext.js` (`nomDeLaCarte`), PAS ICI. Le collecteur l'applique désormais à
// chaque page parsée ; cet outil ne fait que rattraper les cartes DÉJÀ en base, avec la MÊME fonction.
// Deux définitions de la même règle divergent toujours (§21 bis) — celle-ci n'en a qu'une.
//
// ⚠️ REJOUÉ AVANT D'ÊTRE ÉCRIT (§20), parce qu'une clé de NOM qui bouge est exactement le motif qui a
// produit 1 827 lignes fausses. Sur 418 sets et 42 624 lignes (86 % des jointures) : **9 gagnées,
// 1 perdue, 0 DÉPLACÉE**. Les 19 pertes du premier rejeu étaient toutes des LV.X — la jointure
// ajoutait « LV.X » à un nom qui le portait déjà (« Mesprit LV.X LV.X ») ; corrigé dans jointure.js
// AVANT cette écriture, dans le même commit, parce qu'un correctif à moitié livré ne se livre pas.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { nomDeLaCarte } = require('./collecte-cartes/wikitext');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const cartes = await cx.db.collection('cartes').find({}, { projection: { nomEn: 1, 'bulba.titre': 1 } }).toArray();

    const aEcrire = [];
    let sansTitre = 0, inchangees = 0;
    for (const c of cartes) {
        if (!c.bulba?.titre) { sansTitre++; continue; }
        const n = nomDeLaCarte(c.nomEn, c.bulba.titre);
        if (!n || n === c.nomEn) { inchangees++; continue; }
        aEcrire.push({ _id: c._id, avant: c.nomEn, apres: n });
    }
    console.log(`\n════ DÉNOMINATEUR : ${cartes.length} cartes · ${sansTitre} sans titre de page (non jugeables) ════`);
    console.log(`   inchangées : ${inchangees}`);
    console.log(`   🔴 RECOMPOSÉES : ${aEcrire.length} (${(aEcrire.length / cartes.length * 100).toFixed(1)} %)`);

    // le surplus, par forme — pour qu'on voie CE QUI est rendu, pas seulement combien
    const parSurplus = {};
    for (const x of aEcrire) {
        const s = x.apres.replace(new RegExp(String(x.avant).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim() || '(position)';
        parSurplus[s] = (parSurplus[s] || 0) + 1;
    }
    console.log(`   ce que le nom regagne, par forme :`);
    for (const [k, v] of Object.entries(parSurplus).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`      ${String(v).padStart(5)} — « ${k} »`);
    console.log(`   douze exemples :`);
    for (const x of aEcrire.slice(0, 12)) console.log(`      ${String(x._id).padStart(7)} « ${String(x.avant).padEnd(26)} » → « ${x.apres} »`);

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --ecrire)`); await fermer(); return; }
    let n = 0;
    const le = new Date();
    for (let i = 0; i < aEcrire.length; i += 500) {
        const lot = aEcrire.slice(i, i + 500);
        await cx.db.collection('cartes').bulkWrite(lot.map(x => ({
            updateOne: { filter: { _id: x._id }, update: { $set: { nomEn: x.apres, nomEnRecomposeLe: le } } }
        })), { ordered: false });
        n += lot.length;
    }
    // relecture : le contrôle ne se déduit pas de la boucle qui vient de tourner
    const restant = (await cx.db.collection('cartes').find({}, { projection: { nomEn: 1, 'bulba.titre': 1 } }).toArray())
        .filter(c => c.bulba?.titre && nomDeLaCarte(c.nomEn, c.bulba.titre) !== c.nomEn).length;
    console.log(`\n   ÉCRIT : ${n} cartes · relu en base : ${restant} encore amputée(s) (attendu 0)`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
