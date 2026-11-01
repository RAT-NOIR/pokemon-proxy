// ============================================================
// LA RÈGLE E-CODE — les Énergies de base d'un set japonais dont Cardmarket numérote par CODE (« GRA », « FIR »…) : 30th Celebration (m6a, idExpansion 6602)
// ============================================================
// Pure : aucune base, aucun réseau, aucune lecture de fichier (le nom japonais est INJECTÉ par `nomJa`, le clone par `nommes`). Réutilise typeProduit / typeJa / candidates de
// regle-e-svp.js (une seule définition du type et de l'unicité — §21 bis) ; ce qui diffère de E-SVP est la CLÉ de la seconde source : ici TCGdex M6a/<code>, PAS l'idProduct.
// 🔴 POURQUOI PAS L'idProduct : le `thirdParty.cardmarket` des cartes TCGdex M6a (908344…908351) désigne les produits du set CHINOIS 30thC (exp 6603), pas ceux de m6a (907931…907938).
// Un rattachement par idProduct aurait posé les fiches japonaises sur les produits chinois. La règle REFUSE donc un produit que le clone nomme AILLEURS qu'à (M6a, même code).
// Un produit « Basic <Type> Energy » est rattaché à la carte de même nom qui porte l'impression du set, SI :
//   (1) le numéro appris de Cardmarket est un code de la TABLE FERMÉE (GRA FIR WAT LIG PSY FIG DAR MET) et son type est celui du produit ;
//   (2) TCGdex a une carte M6a/<ce code> (seconde source) ;
//   (3) son nom japonais est 基本<type>エネルギー et le type est celui du produit (TCGdex et Cardmarket concordent sur le type ET le code) ;
//   (4) le clone ne nomme pas le produit ailleurs qu'à (M6a, ce code) ;
//   (5) UNE SEULE carte candidate (même nomEn ET impression de l'expansion du set).
// Une garde s'écrit par ce qu'elle autorise : tout ce qui n'est pas exactement ce cas rend `{ ok: false, condition, raison }`.
const { typeProduit, typeJa, candidates } = require('./regle-e-svp');

const CONFIG_M6A = Object.freeze({
    setTcgdex: 'M6a',
    expansion: '30th Celebration',
    codes: Object.freeze({ GRA: 'Grass', FIR: 'Fire', WAT: 'Water', LIG: 'Lightning', PSY: 'Psychic', FIG: 'Fighting', DAR: 'Darkness', MET: 'Metal' })
});

function juger({ produit, numeroAppris, nommes, nomJa, cartes, config = CONFIG_M6A }) {
    const non = (condition, raison, extra = {}) => ({ ok: false, condition, raison, ...extra });
    const type = typeProduit(produit?.name);
    if (!type) return non(0, 'pas une énergie de base');
    const code = String(numeroAppris ?? '').trim().toUpperCase();
    if (!code) return non(1, 'pas de numéro appris');
    if (!Object.prototype.hasOwnProperty.call(config.codes, code)) return non(1, `le numéro « ${code} » n'est pas un code de la table fermée`);
    if (config.codes[code] !== type) return non(1, `le code ${code} est ${config.codes[code]} dans la table, le produit est ${type}`);
    const ja = nomJa(code);
    if (!ja) return non(2, `TCGdex n'a aucune carte ${config.setTcgdex}/${code}`);
    const tJa = typeJa(ja);
    if (!tJa || tJa !== type) return non(3, `type japonais ${ja} ≠ ${type}`);
    const ailleurs = (nommes || []).filter(x => x && !(x.setId === config.setTcgdex && String(x.localId).toUpperCase() === code));
    if (ailleurs.length) return non(4, `TCGdex nomme ce produit ailleurs (${[...new Set(ailleurs.map(x => `${x.setId}/${x.localId}`))].join(', ')}) : contradiction`);
    const cs = candidates(produit.name, cartes, config.expansion);
    if (cs.length !== 1) return non(5, `${cs.length} cartes candidates`, { candidates: cs });
    return { ok: true, carteId: cs[0], numero: code, type, tcgdex: `${config.setTcgdex}/${code}`, nomJa: ja };
}

module.exports = { juger, CONFIG_M6A };
