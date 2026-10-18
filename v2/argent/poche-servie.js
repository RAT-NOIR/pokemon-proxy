'use strict';
// ACHETE-AVANT-JOUR : `facturation.poche` ("achete" | "jour"), un champ ADDITIF de la réponse qui DÉBITE (/api/identifier, lot compris) : d'où vient l'analyse.
//   · une carte : la poche du crédit pris ;
//   · un lot (plusieurs unités, qui peuvent chevaucher les deux poches) : "achete" SEULEMENT si TOUTES ses unités ont été payées sur `achete`, sinon "jour" (au moins une unité a consommé le quota du jour) ;
//   · rien de débité (administrateur, refus QUOTA) : le champ est ABSENT.
// Le champ est posé sur la réponse, jamais écrit dans `analyses` (la facturation stockée et l'historique servi ne changent pas).
const db = require('../db');
const POCHES = Object.freeze(['achete', 'jour']);
const base = p => (p.type === 'compte' ? { compteId: p.id } : { installationId: p.id });
// La poche d'un scan, lue sur ses LIGNES de débit au grand livre (elles restent après un remboursement) : "achete" si TOUTES ses unités l'étaient, sinon "jour" ; null si aucune ligne.
// Une lecture qui échoue lève : l'appelant décide du repli.
async function pocheDesDebits(porteur, scanId) {
    const l = await db.col('mouvements').find({ ...base(porteur), type: 'debit', scanId, delta: -1, credit: { $ne: null } }, { projection: { 'credit.poche': 1 } }).toArray();
    const ps = l.map(d => d.credit && d.credit.poche).filter(x => POCHES.includes(x));
    if (!ps.length) return null;
    return ps.every(x => x === 'achete') ? 'achete' : 'jour';
}
// `credit` : celui du débit initial ; `lot` : la requête est un lot (les unités se lisent au grand livre)
async function pocheDuScan(porteur, scanId, credit, lot) {
    if (!credit || !POCHES.includes(credit.poche)) return null;
    if (!lot) return credit.poche;
    try { return (await pocheDesDebits(porteur, scanId)) || credit.poche; }
    catch (_) { return credit.poche; }       // une lecture qui échoue ne casse pas la réponse : la poche du débit initial
}
const avecPoche = (facturation, poche) => (facturation && facturation.motif !== 'administrateur' && POCHES.includes(poche) ? { ...facturation, poche } : facturation);
module.exports = { pocheDuScan, pocheDesDebits, avecPoche, POCHES };
