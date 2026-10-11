'use strict';
// Fil de travail de BANC pour test-chargeur.js : il remplace fil.js (qui lit cartes) par un comportement choisi par workerData.env.MODE_BANC.
//   reussite : construit une petite version et la renvoie en tampons TRANSFÉRÉS (comme le vrai fil) ; gourmand : alloue sans fin (le plafond du fil doit le tuer, pas le serveur) ; muet : ne répond jamais.
const { parentPort, workerData } = require('worker_threads');
const { creerConstructeur } = require('../chargeur/version');
const mode = workerData.env.MODE_BANC;
const brut = id => ({ idProduct: id, vignette: { cle: `v/${id}.webp`, w: 2, h: 3 }, grande: null, visuel: 'du-set', mention: null, idMetacard: 70, numero: '001', rarete: 'Rare', total: '10', variante: null, setNom: 'Set Fil', lien: null });
if (mode === 'reussite') {
    const b = creerConstructeur();
    for (let i = 1; i <= 5; i++) b.entree(brut(100 + i));
    b.lien('Set-F', '1|001', [101, 102]);
    const v = b.finir(), p = v.paquet();
    parentPort.postMessage({ type: 'resultat', donnees: p.donnees, comptes: { sets: 1, cartes: 1, produits: 5, catalogue: workerData.ids.length, visuels: 5, refusees: 0, motifs: {}, fichesLiees: 1, setsAvecLiens: 1, produitsLies: 2 } }, p.tampons);
} else if (mode === 'gourmand') {
    const garde = []; for (;;) garde.push(new Array(1e5).fill(Math.random()));
} else if (mode === 'refus') {
    parentPort.postMessage({ type: 'refus', raison: 'MONGODB_CARTES_LECTURE_URI absente ou vide' });
}
// 'muet' : rien
