// ============================================================
// LOT H-FIX : IMPRESSIONS NUMÉROTÉES QUI MANQUENT AUX FICHES TPC id/th SV-P (2026-10-17)
// ============================================================
// LE DÉFAUT : la carte porte une impression SV-P id/th SANS numéro ; ses produits (V1 au n° 53, V2 au n° 172…) ont chacun leur `numeroFiche`,
// mais le site ne place un produit par numeroFiche que si le document a des fiches numérotées (placementParNumeroFiche : « absent » sinon) ;
// la fiche unique sert alors l'image du premier numéro (Sprigatito ID SV-PID172 montrait la 053/SV-P).
// LA CORRECTION, additive : une impression numérotée (source « numero-cardmarket », conservée par impressions-posees.js) par numéro de la
// LISTE FERMÉE. Rien n'est écrasé : l'impression sans numéro reste, aucun numeroFiche n'est touché (ils sont déjà posés).
// DEUX ÉLÉMENTS INDÉPENDANTS par impression, rejoués à chaque exécution : (1) Cardmarket — le slug du produit se termine par ce numéro et le
// numeroFiche de la ligne le porte ; (2) la Setlist de Bulbapedia — `detail` de la ligne (« n°54, 131 dans l'expansion … », écrit par joindre()).
// Les images TPC portant un numéro ont de plus été REGARDÉES (`vu`) : le numéro imprimé sur la carte égale le numéro posé.
const SOURCE = 'numero-cardmarket';
const k = n => String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
const SPX = 'SV-P Promotional cards';
const f = (carteId, set, tirage, numero, produit, vu) => Object.freeze({ carteId, set, tirage, expansion: SPX, numero, produit, vu });
// vu : l'image TPC regardée (numéro imprimé), ou null quand le set n'a aucune image à ce numéro (le visuel absent est honnête)
const LISTE = Object.freeze([
    f(278880, 'Scarlet-Violet-Indonesian-Promos', 'id', '53', 825045, 'tpc-asie/Scarlet-Violet-Indonesian-Promos/53-278880-id.webp : 053/SV-P'),
    f(278880, 'Scarlet-Violet-Indonesian-Promos', 'id', '172', 825191, 'tpc-asie/Scarlet-Violet-Indonesian-Promos/172-278880-id.webp : 172/SV-P'),
    f(278880, 'Scarlet-Violet-Thai-Promos', 'th', '54', 824612, 'aucune image au n° 54 (la seule image du set est la 131/SV-P)'),
    f(278880, 'Scarlet-Violet-Thai-Promos', 'th', '131', 824887, 'tpc-asie/Scarlet-Violet-Thai-Promos/131-278880-th.webp : 131/SV-P'),
    f(281253, 'Scarlet-Violet-Thai-Promos', 'th', '68', 824651, 'tpc-asie/Scarlet-Violet-Thai-Promos/68-281253-th.webp : 068/SV-P'),
    f(281253, 'Scarlet-Violet-Thai-Promos', 'th', '132', 824888, 'tpc-asie/Scarlet-Violet-Thai-Promos/132-281253-th.webp : 132/SV-P'),
]);

const aLaFin = (slug, numero) => { const s = String(slug ?? '').replace(/-V\d+$/i, ''); const m = /(\d+)$/.exec(s); return !!m && k(m[1]) === k(numero); };
const numerosSetlist = detail => ((/^n°(.+?) dans l'expansion/.exec(detail || '') || [])[1] || '').split(',').map(x => k(x)).filter(Boolean);

/** @returns {{operations, refus, deja}} Le plan, sans connexion. */
function planifier({ liste = LISTE, cartes, lignes }) {
    const operations = [], refus = [], deja = [];
    for (const o of liste) {
        const rej = raison => refus.push({ ...o, raison });
        const c = cartes.get(o.carteId);
        if (!c) { rej('carte introuvable'); continue; }
        const l = lignes.find(x => x.idProduct === o.produit && x.carteId === o.carteId && x.slugSet === o.set);
        if (!l) { rej('ligne de jointure introuvable'); continue; }
        if (k(l.numeroFiche) !== k(o.numero)) { rej(`la ligne porte numeroFiche « ${l.numeroFiche} » (≠ ${o.numero}) : elle a changé`); continue; }
        if (!aLaFin(l.slug, o.numero)) { rej(`élément 1 (Cardmarket) : le slug « ${l.slug} » ne se termine pas par ${o.numero}`); continue; }
        if (!numerosSetlist(l.detail).includes(k(o.numero))) { rej(`élément 2 (Setlist) : « ${l.detail} » ne donne pas le n° ${o.numero}`); continue; }
        if ((c.impressions || []).some(i => i && i.tirage === o.tirage && i.expansion === o.expansion && k(i.numero) === k(o.numero))) { deja.push(o); continue; }
        operations.push({ ...o, impression: { tirage: o.tirage, expansion: o.expansion, numero: o.numero, total: null, deck: null, rarete: null, source: SOURCE,
            preuveNumero: `H-FIX 2026-10-17 : Cardmarket slug « ${l.slug} » (numeroFiche ${l.numeroFiche}) ; Setlist Bulbapedia « ${l.detail} » ; ${o.vu}` } });
    }
    return { operations, refus, deja };
}

/** Une écriture additive : un $push gardé par un filtre (jamais deux fois), jamais un $set. */
function operationsVersMongo(op) {
    const { tirage, expansion, numero } = op.impression;
    return { filtre: { _id: op.carteId, impressions: { $not: { $elemMatch: { tirage, expansion, numero } } } }, maj: { $push: { impressions: op.impression } } };
}

module.exports = { SOURCE, LISTE, planifier, operationsVersMongo, k };
