'use strict';
// ============================================================
// LIEN CARTE <-> CARTE TCGDEX PAR CLES — fonctions PURES (aucune base, aucun reseau).
// ============================================================
// Pour les cartes dont l'identifiant produit Cardmarket est ABSENT du clone TCGdex (prouverLien, plan-noms-fr-fiches.js, ne peut rien dire).
// Trois cles, qui n'utilisent NI l'identifiant produit NI le nom :
//   A : nom d'expansion + numero d'une impression intl de la carte  -> (set du clone au meme nom, numero)
//   B : idExpansion Cardmarket de la ligne produit + numeroFiche    -> (set du clone portant cet idExpansion, numero)
//   C : slugSet de la ligne produit (tirets = espaces) + numeroFiche -> (set du clone au meme nom, numero)
// Le NOM est le temoin, jamais la cle : il peut donc contredire. Regles (on enumere ce qui AUTORISE, tout le reste bloque) :
//   · une cle qui designe plusieurs fichiers du clone ne designe rien (multiplicites COMPTEES, pas des Set) -> 'cle-multiple' ;
//   · toutes les cartes designees par une cle quelconque doivent passer le temoin (nom anglais egal, Pokedex non contredit), sinon refus
//     'cle-contredite-par-le-nom' / 'dex-contredit' : jamais de repli sur une autre carte du meme nom ;
//   · deux cles qui designent deux cartes differentes -> 'cles-en-conflit'.
const { cle } = require('./nom-fr-cardmarket');

const sansZeros = s => String(s ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
const nonVide = x => x !== null && x !== undefined && String(x).trim() !== '';
const ref = t => `${t.famille}|${t.setId}|${t.localId}`;
const pousser = (m, k, v) => { (m.get(k) || m.set(k, []).get(k)).push(v); };

function indexCles(clone) {
    const setsParNom = new Map(), setsParCm = new Map(), cartesParSet = new Map();
    for (const s of clone.sets) {
        const k = cle(s.noms && s.noms.en || '');
        if (k) pousser(setsParNom, k, s);
        if (s.cardmarket) pousser(setsParCm, Number(s.cardmarket), s);
    }
    for (const c of clone.cartes) pousser(cartesParSet, `${c.famille}|${c.setId}`, c);
    return { setsParNom, setsParCm, cartesParSet };
}

/** Les fichiers du clone designes par (liste de sets, numero) : un TABLEAU (multiplicites conservees). */
function cartesDe(sets, numero, ix) {
    const out = [];
    if (!nonVide(numero)) return out;
    for (const s of sets) for (const t of (ix.cartesParSet.get(`${s.famille}|${s.id}`) || [])) if (sansZeros(t.localId) === sansZeros(numero)) out.push(t);
    return out;
}

/**
 * @returns {{ok:true, cles:string[], preuves:{carteTcgdex,tcgdex,temoin}[]} | {ok:false, raison:string, detail?:string}}
 */
function lierParCles(carte, lignes, ix) {
    const parCle = {};                                           // 'A' | 'B' | 'C' -> tableau de fichiers du clone
    const ajouter = (k, arr) => { if (arr.length) (parCle[k] = parCle[k] || []).push(...arr); };
    for (const i of (carte.impressions || [])) {
        if (i.tirage !== 'intl' || !nonVide(i.expansion)) continue;
        ajouter('A', cartesDe(ix.setsParNom.get(cle(i.expansion)) || [], i.numero, ix));
    }
    for (const l of (lignes || [])) {
        if (nonVide(l.idExpansion)) ajouter('B', cartesDe(ix.setsParCm.get(Number(l.idExpansion)) || [], l.numeroFiche, ix));
        if (nonVide(l.slugSet)) ajouter('C', cartesDe(ix.setsParNom.get(cle(String(l.slugSet).replace(/-/g, ' '))) || [], l.numeroFiche, ix));
    }
    const cles = Object.keys(parCle).sort();
    if (!cles.length) return { ok: false, raison: 'aucune-cle' };
    // multiplicite : une cle dont les designations (impressions/lignes differentes) retombent sur le MEME fichier est une cle sure ;
    // une cle qui designe deux fichiers distincts, ou DEUX FOIS le meme (doublon dans le clone), ne designe rien.
    const fichiers = new Map();                                  // ref -> { t, n } n = nombre de copies dans le clone
    for (const k of cles) {
        const distincts = new Set(parCle[k].map(ref));
        if (distincts.size > 1) return { ok: false, raison: 'cle-multiple', detail: `${k} : ${[...distincts].join(' / ')}` };
        const r = [...distincts][0];
        const copies = (ix.cartesParSet.get(r.split('|').slice(0, 2).join('|')) || []).filter(t => ref(t) === r).length;
        if (copies > 1) return { ok: false, raison: 'cle-multiple', detail: `${k} : ${r} x${copies}` };
        fichiers.set(r, parCle[k][0]);
    }
    if (fichiers.size > 1) return { ok: false, raison: 'cles-en-conflit', detail: [...fichiers.keys()].join(' / ') };
    // temoin : le nom anglais (la cle ne l'a pas utilise) ; le Pokedex ne doit pas contredire
    const [[r, t]] = [...fichiers];
    if (!nonVide(carte.nomEn)) return { ok: false, raison: 'nom-en-absent' };
    const dx = [].concat(carte.ndex ?? []).map(Number).filter(Boolean);
    if (dx.length && t.dex && t.dex.length && !dx.some(x => t.dex.includes(x))) return { ok: false, raison: 'dex-contredit', detail: r };
    if (!(nonVide(t.noms && t.noms.en) && cle(t.noms.en) === cle(carte.nomEn))) return { ok: false, raison: 'cle-contredite-par-le-nom', detail: `${r} « ${t.noms && t.noms.en} » / « ${carte.nomEn} »` };
    return { ok: true, cles, preuves: [{ carteTcgdex: r, tcgdex: t, temoin: 'nom-en' }] };
}

module.exports = { indexCles, lierParCles };
