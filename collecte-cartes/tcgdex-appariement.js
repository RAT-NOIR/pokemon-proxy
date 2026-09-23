// ============================================================
// QUELLE CARTE TCGdex EST CETTE IMPRESSION INTERNATIONALE ? — une définition, pour les scans ET les illustrateurs
// ============================================================
// La clé est le NUMÉRO (`cleNumero`, préfixe gardé : TG01 n'est pas 1) dans le set TCGdex de l'expansion ; le NOM est
// le témoin, par `temoinDuNom` — la fonction de `joindre()`, jamais une copie (§21 bis). « 0 ambigu ne veut pas dire
// 0 faux » : un numéro croisé chez l'une des sources (les Kyurem d'EX Battle Boost) désigne une carte UNIQUE et fausse,
// et seul le nom, qui n'est pas dans la clé, peut le dire. Un écart de FORME (le nom ne désigne aucune autre carte du
// set) laisse le témoin muet : la réponse passe, comme dans la jointure du texte.
// Chaque impression reçoit UNE réponse, ou un MOTIF — jamais un silence : une impression sans scan ni illustrateur est
// un trou, et un trou se compte.
const { cleNumero, temoinDuNom } = require('./jointure');

/**
 * @param {string} expansion   nom Bulbapedia de l'expansion (celui des impressions)
 * @param {object[]} cartes    nos cartes ; seules leurs impressions `intl` de cette expansion sont traitées
 * @param {object[]} tcg       cartes du set TCGdex { id, localId, name, illustrator, image }
 * @returns {{carte, index, numero, tcg?, motif?, detail?}[]}  `index` = position de l'impression dans `carte.impressions`
 */
function apparierExpansion(expansion, cartes, tcg) {
    const concernees = cartes.filter(c => (c.impressions || []).some(i => i.tirage === 'intl' && i.expansion === expansion));
    const temoin = temoinDuNom(concernees);
    const parNumTcg = new Map();
    for (const t of tcg) { const k = cleNumero(t.localId); if (k) (parNumTcg.get(k) || parNumTcg.set(k, []).get(k)).push(t); }
    const parNumNous = new Map();
    for (const c of concernees) for (const i of c.impressions) if (i.tirage === 'intl' && i.expansion === expansion) {
        const k = cleNumero(i.numero); if (k) (parNumNous.get(k) || parNumNous.set(k, new Set()).get(k)).add(c._id);
    }
    const R = [];
    for (const c of concernees) c.impressions.forEach((i, index) => {
        if (i.tirage !== 'intl' || i.expansion !== expansion) return;
        const base = { carte: c, index, numero: i.numero };
        const k = cleNumero(i.numero);
        if (!k) return R.push({ ...base, motif: 'impression-sans-numero' });
        if ((parNumNous.get(k)?.size || 0) > 1) return R.push({ ...base, motif: 'numero-ambigu-chez-nous', detail: `n°${i.numero} porté par ${[...parNumNous.get(k)].join(', ')}` });
        const ts = parNumTcg.get(k) || [];
        if (!ts.length) return R.push({ ...base, motif: 'absente-de-tcgdex' });
        if (ts.length > 1) return R.push({ ...base, motif: 'numero-ambigu-chez-tcgdex', detail: ts.map(t => t.id).join(', ') });
        const t = ts[0];
        const autres = temoin(c, { nom: t.name, attaques: [] });
        if (autres) return R.push({ ...base, motif: 'contredite-par-le-nom', detail: `${t.id} « ${t.name} » désigne ${autres.map(a => `${a._id} « ${a.nomEn} »`).join(', ')}` });
        R.push({ ...base, tcg: t });
    });
    return R;
}

module.exports = { apparierExpansion };
