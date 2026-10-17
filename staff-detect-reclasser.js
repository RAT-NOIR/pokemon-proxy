// Reclasse l'inventaire déjà calculé avec la règle courante de classerTexte (sans refaire l'OCR). Usage : node staff-detect-reclasser.js <inventaire-etiquettes.json>
'use strict';
const fs = require('fs');
const D = require('./collecte-cartes/staff-detect');
const f = require('./collecte-cartes/garde-ecriture').autoriser(process.argv[2]); // LÈVE avant toute écriture si hors des racines autorisées
const inv = JSON.parse(fs.readFileSync(f, 'utf8'));
const compte = {}, autres = {}, parClasse = {};
for (const c of inv.produits) {
    c.classe = D.classerTexte(c.ocr);
    const cl = c.classe === null ? 'rien-lu' : c.classe.startsWith('autre:') ? 'autre' : c.classe;
    compte[cl] = (compte[cl] || 0) + 1;
    (parClasse[cl] = parClasse[cl] || []).push(c.idProduct);
    if (cl === 'autre') { const k = c.classe.slice(6).toLowerCase().replace(/[^a-z ]/g, '').trim().slice(0, 30); autres[k] = (autres[k] || 0) + 1; }
}
inv.comptes = compte; inv.idsParClasse = parClasse;
inv.autresTextes = Object.fromEntries(Object.entries(autres).sort((a, b) => b[1] - a[1]).slice(0, 40));
fs.writeFileSync(f, JSON.stringify(inv, null, 1));
console.log(JSON.stringify(compte)); console.log(JSON.stringify(inv.autresTextes));
