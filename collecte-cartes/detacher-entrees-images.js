'use strict';
// ============================================================
// DÉTACHER UNE ENTRÉE cartes.images PRÉCISE (carte, set, cleR2) — liste FERMÉE, lot VIGN-SUITE point 6 (2026-10-17)
// ============================================================
// Après le rejeu du 17/10 11:07 UTC (8 lignes LV.X de corrections-images.js), 5 cartes de BASE gardent le fichier du LV.X en seconde entrée, à côté
// du leur. Ni le document `images` (juste pour la carte LV.X) ni les autres entrées ne bougent : seule l'entrée (carte, set, cleR2) est retirée.
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE — une entrée n'est détachée que si TOUT ceci est vrai (deux éléments par ligne, plus la symétrie) :
//   · la table de corrections attribue ce fichier à la carte LV.X nommée (elle est la source de la liste, relue ici, pas recopiée) ;
//   · la carte LV.X porte bien l'entrée (set, cleR2) ;
//   · la carte de base porte exactement UNE entrée (set, cleR2) ET la sienne (cleJuste) dans le même set ;
// sinon refus avec sa raison, et rien n'est écrit pour cette ligne.
const { correctionDe } = require('./corrections-images');

const L = (carteId, set, cleFausse, cleJuste, carteLvx) => Object.freeze({ carteId, set, cleFausse, cleJuste, carteLvx });
const LISTE = Object.freeze([
    L(33955, 'Secret-of-the-Lakes', 'artofpkm/150/23.webp', 'artofpkm/150/22.webp', 26230),   // Magmortar
    L(29819, 'Dawn-Dash', 'artofpkm/166/38.webp', 'artofpkm/166/37.webp', 28217),             // Gardevoir
    L(39868, 'Dawn-Dash', 'artofpkm/166/19.webp', 'artofpkm/166/18.webp', 41644),             // Glaceon
    L(40037, 'Dawn-Dash', 'artofpkm/166/5.webp', 'artofpkm/166/4.webp', 41758),               // Leafeon
    L(34851, 'Moonlit-Pursuit', 'artofpkm/164/39.webp', 'artofpkm/164/38.webp', 36172)       // Cresselia
]);
const porte = (c, set, cleR2) => (c?.images || []).filter(i => i && i.set === set && i.cleR2 === cleR2);

/** Lecture seule. @returns {Promise<{aDetacher:{entree,avecVignette:boolean}[], refus:{entree,raison:string}[]}>} */
async function simuler(db) {
    const aDetacher = [], refus = [];
    for (const entree of LISTE) {
        const corr = correctionDe(entree.cleFausse);
        if (!corr || corr.carteId !== entree.carteLvx) { refus.push({ entree, raison: `la table de corrections n'attribue pas ${entree.cleFausse} à la carte ${entree.carteLvx}` }); continue; }
        const base = await db.collection('cartes').findOne({ _id: entree.carteId }), lvx = await db.collection('cartes').findOne({ _id: entree.carteLvx });
        if (!base) { refus.push({ entree, raison: `carte de base absente (${entree.carteId})` }); continue; }
        const fausses = porte(base, entree.set, entree.cleFausse);
        if (!fausses.length) { refus.push({ entree, raison: 'rien à détacher : la carte ne porte déjà plus ce fichier' }); continue; }
        if (fausses.length !== 1) { refus.push({ entree, raison: `${fausses.length} entrées au lieu d'exactement une (set, cleR2) sur la carte ${entree.carteId}` }); continue; }
        if (!porte(lvx, entree.set, entree.cleFausse).length) { refus.push({ entree, raison: `la carte LV.X ${entree.carteLvx} ne porte pas ce fichier dans ${entree.set} : rien ne prouve qu'il soit le sien` }); continue; }
        if (!porte(base, entree.set, entree.cleJuste).length) { refus.push({ entree, raison: `la carte ${entree.carteId} n'a pas sa propre entrée ${entree.cleJuste} : l'autre n'est pas prouvée fausse` }); continue; }
        aDetacher.push({ entree, avecVignette: !!fausses[0].vignette });
    }
    return { aDetacher, refus };
}

/** Écrit le plan ; le filtre reprend (carte, set, cleR2). @returns {Promise<number>} */
async function detacher(db, plan) {
    let n = 0;
    for (const { entree: e } of plan.aDetacher) {
        n += (await db.collection('cartes').updateOne({ _id: e.carteId, images: { $elemMatch: { set: e.set, cleR2: e.cleFausse } } }, { $pull: { images: { set: e.set, cleR2: e.cleFausse } } })).modifiedCount;
    }
    return n;
}

module.exports = { LISTE, simuler, detacher };
