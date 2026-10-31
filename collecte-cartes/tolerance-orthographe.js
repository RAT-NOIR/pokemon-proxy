// ============================================================
// PREUVE PAR LE SET : LA TOLÉRANCE D'ORTHOGRAPHE (décision de l'éditeur, 2026-10-31) — module PUR
// ============================================================
// Une liste de source peut porter UNE faute de frappe (« Timbur » pour « Timburr », écrite à l'identique par deux sources) qui ferme tout un set. On n'en corrige jamais une au jugé : la correction n'est admise
// que si les QUATRE conditions suivantes tiennent TOUTES (cumulatives ; une garde s'écrit par ce qu'elle autorise, tout le reste est refusé et dit pourquoi) :
//   1. UNE SEULE LETTRE d'écart (distance d'édition 1 : insertion, suppression ou substitution ; une transposition en vaut deux) ;
//   2. MÊME POSITION dans le set : toutes les entrées fautives sont dans UN groupe, et les produits qui portent le bon nom sont dans CE groupe ;
//   3. CANDIDAT UNIQUE : un seul nom de produit du set est à une lettre du nom fautif, et un seul nom de la source est à une lettre du nom du produit ;
//   4. TOUT LE RESTE DU SET CONCORDANT : c'est le SEUL écart de la preuve par le set (une autre discordance, de n'importe quelle nature, ferme), et la liste corrigée est admise par `prouverParSet`.
// Le motif écrit (`motif`) nomme la règle, les deux orthographes et le groupe : il est reporté sur chaque fiche (ref de la seconde source) ou dans le rapport du set.
const { prouverParSet } = require('./preuve-par-set');
const { decomposerNomCardmarket, normaliserNom } = require('./jointure');

/** Distance d'édition EXACTEMENT 1 entre deux chaînes (insertion, suppression, substitution). Identique = false ; une transposition = 2 = false. */
function uneLettreDEcart(a, b) {
    a = String(a); b = String(b);
    if (a === b) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++n > 1) return false; return n === 1; }
    const [c, l] = a.length < b.length ? [a, b] : [b, a];
    let i = 0; while (i < c.length && c[i] === l[i]) i++;
    return c.slice(i) === l.slice(i + 1);
}

const sansZeros = g => String(g ?? '').replace(/^0+/, '');
const nomDuProduit = p => normaliserNom(decomposerNomCardmarket(p.name).nom);
const nomDeLaSource = e => normaliserNom(String(e.nomZh ?? ''));

/**
 * @param {{source: Array<{numero:string, nomZh:string}>, produits: Array<{idProduct:number, name:string, numero?:string|null}>, traduire:Function, cleProduit:Function, groupeDe?:Function|null}} o
 * @returns {{applicable: boolean, raison: string, correction?: {de:string, vers:string, groupe:string, entrees:number, produits:number}, motif?: string, source?: object[]}}
 */
function proposerTolerance({ source, produits, traduire, cleProduit, groupeDe = null }) {
    const non = raison => ({ applicable: false, raison });
    const r0 = prouverParSet({ source, produits, traduire, cleProduit, groupeDe });
    if (r0.admis) return non('le set est déjà admis : rien à corriger');
    if (typeof groupeDe !== 'function') return non('la position dans le set ne se vérifie pas (aucun groupeDe) : une garde qui ne peut pas conclure refuse');
    const autres = r0.discordances.filter(d => d.type !== 'effectif');
    if (autres.length) return non(`une discordance qui n'est pas une orthographe (${[...new Set(autres.map(d => d.type))].join(', ')}) : un seul écart d'orthographe est toléré, tout le reste doit concorder`);
    const sansProduit = r0.discordances.filter(d => d.source > 0 && d.produits === 0), sansSource = r0.discordances.filter(d => d.produits > 0 && d.source === 0);
    const mixtes = r0.discordances.length - sansProduit.length - sansSource.length;
    if (mixtes) return non(`${mixtes} nom(s) dont les effectifs diffèrent des deux côtés (pas une faute d'orthographe) : refus`);
    if (sansProduit.length !== 1 || sansSource.length !== 1) return non(`${sansProduit.length} nom(s) de la source sans produit et ${sansSource.length} nom(s) de produit sans source : la tolérance exige UN SEUL écart (un nom fautif, un nom de produit orphelin)`);
    const dS = sansProduit[0], dP = sansSource[0];
    if (dS.source !== dP.produits) return non(`effectifs différents (source ${dS.source}, produits ${dP.produits}) : pas la même chose écrite deux fois`);
    const entrees = source.filter(e => dS.numeros.includes(String(e.numero)));
    const prods = produits.filter(p => dP.idProduits.includes(p.idProduct));
    const nomsS = new Set(entrees.map(nomDeLaSource)), nomsP = new Set(prods.map(nomDuProduit));
    if (nomsS.size !== 1 || nomsP.size !== 1) return non('le nom fautif ou le nom du produit n\'est pas unique dans son effectif : refus');
    const [nomS] = nomsS, [nomP] = nomsP;
    if (!nomS || !nomP) return non('un nom vide : refus');
    if (!uneLettreDEcart(nomS, nomP)) return non(`distance d'édition ≠ 1 entre « ${nomS} » et « ${nomP} » : seule UNE lettre d'écart est tolérée`);
    // 3. candidat unique, dans les deux sens, parmi TOUS les noms du set (appariés ou non)
    const candP = [...new Set(produits.map(nomDuProduit))].filter(n => uneLettreDEcart(nomS, n));
    const candS = [...new Set(source.map(nomDeLaSource))].filter(n => uneLettreDEcart(nomP, n));
    if (candP.length !== 1 || candS.length !== 1) return non(`candidat non unique : « ${nomS} » est à une lettre de ${candP.length} nom(s) de produit (${candP.join(', ')}), « ${nomP} » de ${candS.length} nom(s) de la source (${candS.join(', ')})`);
    // 2. même position : un seul groupe côté source, et les produits y sont
    const groupesS = new Set(entrees.map(e => sansZeros(groupeDe(String(e.numero))))), groupesP = new Set(prods.map(p => sansZeros(p.numero)));
    if (groupesS.size !== 1 || groupesP.size !== 1 || [...groupesS][0] !== [...groupesP][0] || [...groupesS][0] === '') return non(`position différente : la source place « ${nomS} » au(x) groupe(s) ${[...groupesS].join(',')}, les produits « ${nomP} » au(x) groupe(s) ${[...groupesP].join(',')}`);
    const groupe = String([...groupesS][0]).padStart(2, '0');
    // 4. tout le reste concordant : la liste corrigée doit être admise
    const nomCorrige = decomposerNomCardmarket(prods[0].name).nom;
    const ids = new Set(entrees.map(e => String(e.numero)));
    const corrigee = source.map(e => (ids.has(String(e.numero)) ? { ...e, nomZh: nomCorrige } : e));
    const r1 = prouverParSet({ source: corrigee, produits, traduire, cleProduit, groupeDe });
    if (!r1.admis) return non(`la liste corrigée n'est toujours pas admise (${r1.raison}) : le reste du set ne concorde pas`);
    const de = entrees[0].nomZh;
    const motif = `tolérance d'orthographe : « ${de} » lu pour « ${nomCorrige} » (distance d'édition 1, groupe ${groupe}, ${entrees.length} entrées, candidat unique, tout le reste du set concorde)`;
    return { applicable: true, raison: motif, motif, correction: { de, vers: nomCorrige, groupe, entrees: entrees.length, produits: prods.length }, source: corrigee };
}

module.exports = { proposerTolerance, uneLettreDEcart };
