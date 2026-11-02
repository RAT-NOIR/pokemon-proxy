'use strict';
// ============================================================
// PLANIFIER LE nomJa DES FICHES — fonctions PURES (aucune base, aucun réseau) ; l'outil poser-nomja-fiches.js les alimente.
// ============================================================
// Une liste FERMÉE de propositions (nomJaPage = nom japonais lu sur la page du tirage = scan lu sur planche). Le plan n'écrit que `nomJa`,
// sur une carte dont `nomJa` est ABSENT ou null. Tout ce qui ne conclut pas est un REFUS NOMMÉ (on énumère ce qui autorise, jamais ce qui refuse).
const CJK = /[぀-ヿ㐀-鿿]/;                                   // kana ou idéogrammes : une écriture japonaise
const norm = s => String(s ?? '').normalize('NFKC').trim().toLowerCase();
const texte = x => typeof x === 'string' ? x.trim() : '';

function planifier({ entrees, cartes }) {
    const parId = new Map(cartes.map(c => [c._id, c]));
    const nbParCarte = new Map();
    for (const x of entrees) nbParCarte.set(x.carteId, (nbParCarte.get(x.carteId) || 0) + 1);
    const ecrire = [], refus = [];
    const concorde = { avecAutreCarte: 0, sansAutreCarte: 0 };
    for (const x of entrees) {
        const non = motif => refus.push({ carteId: x.carteId, idProduct: x.idProduct, nomEn: x.nomEn, nomJaPage: x.nomJaPage, motif });
        const nom = texte(x.nomJaPage);
        if (!nom) { non('nomJaPage-vide'); continue; }
        if (!CJK.test(nom)) { non('nomJaPage-non-japonais'); continue; }
        if (nbParCarte.get(x.carteId) > 1) { non('doublon-carte'); continue; }
        const c = parId.get(x.carteId);
        if (!c) { non('carte-absente'); continue; }
        if (norm(c.nomEn) !== norm(x.nomEn)) { non('nomEn-different'); continue; }
        if (c.nomJa !== undefined && c.nomJa !== null) { non('nomJa-deja-pose'); continue; }   // jamais d'écrasement, même identique
        ecrire.push({ carteId: x.carteId, idProduct: x.idProduct, nomEn: x.nomEn, nomJa: nom, pcg: x.pcg, lot: x.lot,
            ancien: null, ancienEtat: c.nomJa === null ? 'null' : 'absent', concordeAvecAutreCarte: !!x.concordeAvecAutreCarte });
        if (x.concordeAvecAutreCarte) concorde.avecAutreCarte++; else concorde.sansAutreCarte++;
    }
    return { ecrire, refus, concorde };
}

/** Les opérations d'écriture : un updateOne par carte, filtre EXACT (absent ou null), le seul champ nomJa. */
function construireOps({ ecrire }) {
    return ecrire.map(x => ({ updateOne: {
        filter: { _id: x.carteId, $or: [{ nomJa: { $exists: false } }, { nomJa: null }] },
        update: { $set: { nomJa: x.nomJa } }
    } }));
}

module.exports = { planifier, construireOps, CJK };
