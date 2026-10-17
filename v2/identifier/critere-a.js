'use strict';
// CRITÈRE A (2026-10-17, décision D2 rouverte par le testeur) — affirmer le produit P d'un groupe de jumeaux quand le CODE ET le NUMÉRO imprimés le désignent SEUL, APRÈS la garde contradiction.
// Testeur : « les réimpressions japonaises (Tag All Stars, Dream League…) portent un autre numéro et un autre code ; c'est le code et le numéro imprimés qui tranchent, jamais le nom seul ».
// Module PUR (ni base, ni réseau, ni modèle). Aucune règle recopiée (§21 bis) : la contradiction est `garde-contradiction.contredire` et `statuts`, la concordance du numéro et du code est
// `seconde-lecture.comparer`, le nom est `nom-compatible.nomCompatible` — les fonctions de la production.
// 🔑 Écrit par ce qu'il AUTORISE : P est affirmé SEULEMENT si TOUTES ces conditions tiennent ; au moindre doute (bloc absent, ligne manquante, champ inconnu) la réponse d'AVANT reste.
//   (0) le drapeau est allumé (`actif === true`, rien d'autre) et P a au moins un jumeau (le critère parle d'un groupe ; sans jumeau, la réponse d'avant n'est pas une affaire de jumeaux) ;
//   (a) `contredire()` ne rend RIEN pour P, ET AUCUN champ lu (numéro, code, total, attaque, set TCGdex, symbole, langue) ne contredit P — la garde ne se tait pas toujours quand l'attaque seule
//       contredit sans désigner personne, mais « un élément lu qui contredit le gagnant bloque toujours le verdict » (testeur) ; le bloc `lectureGarde` doit être présent ;
//   (b) le numéro lu concorde exactement avec P, et avec AUCUN autre produit du groupe ; (c) chaque autre produit a un numéro CONNU que le numéro lu CONTREDIT (un numéro inconnu, ou ni égal ni
//       contredit — « S12 » face à « 12 » —, empêche : on n'affirme pas contre un doute) ; toutes les lignes du groupe sont au catalogue ;
//   (d) le code de set lu concorde avec P (un code non lu ne concorde pas) ;
//   (e) le nom lu (confiance haute) ne contredit pas P.
const { contredire, statuts, lectureDe } = require('./garde-contradiction');
const { comparer } = require('./seconde-lecture');
const { formesLuesDe, nomCompatible } = require('./nom-compatible');
const LD = require('./langue-decisive');
const { codeSansDesignation } = LD;

// 🔑 UNE CONSTANTE (comme VARIANTE_STRICTE) : le critère n'est allumé que si la mesure sur tout le banc étiqueté rend 0 faux. Mesuré le 2026-10-17 sur les 307 cartes par le vrai chemin (adaptateur + groupes de jumeaux de
// l'archive) : 58 affirmations nouvelles, 58 justes, 0 variante fausse, 0 faux, 0 sûr perdu ni changé => ALLUMÉ. Au premier faux, `false` l'éteint sans rien retirer. Un banc (test-critere-a) tient l'état livré.
const CRITERE_A = true;
// `parCode` : les affirmations du critère PAR CODE DE SET LU — le risque résiduel (une lecture fausse mais cohérente avec un jumeau, relecture r1 I1) se suit en production par ce compteur et par la ligne de journal.
const compte = { jugees: 0, affirmees: 0, parCode: {} };
const compteurs = () => ({ ...compte, parCode: { ...compte.parCode } });

/**
 * LES CONDITIONS du critère A pour un produit P et le groupe `autres` de ses jumeaux (peut être VIDE : un candidat sans jumeau). UNE seule définition, appelée par `critereA` ET par la résolution de LANGUE-DECISIVE
 * (`langue-decisive.affirmableSeul`) : la règle ne se recopie pas (§21 bis).
 *   · la garde contradiction ne répond pas pour P, ET AUCUN champ lu (numéro, code, total, attaque, set TCGdex, symbole, langue) ne le contredit — sauf le code sous R4 ;
 *   · le numéro lu concorde exactement avec P et avec AUCUN produit de `autres`, dont chacun a un numéro CONNU que le numéro lu CONTREDIT ; toutes les lignes du groupe sont au catalogue ;
 *   · le code lu concorde avec P, ou (R4) il ne désigne AUCUN produit du vivier NI du catalogue entier (code × numéro, `catalogueExiste`) ;
 *   · le nom lu (confiance haute) ne contredit pas P.
 * `toleres` : champs dont un « ko » ne bloque pas (MESURE seulement : la variante « attaque tolérée » du restant, éteinte en production).
 * @returns { ok: boolean, raison: string, codeParR4: boolean }
 */
function conditions({ corps, gagnant, autres, produits, r4 = LD.REGLES.R4, catalogueExiste, toleres = [] } = {}) {
    const non = raison => ({ ok: false, raison, codeParR4: false });
    if (!Number.isInteger(gagnant) || !(produits instanceof Map) || !produits.has(gagnant)) return non('produit absent du catalogue');
    if (!Array.isArray(autres) || !autres.every(Number.isInteger)) return non('groupe illisible');
    if (autres.some(i => !produits.has(i))) return non('une ligne de jumeau manque');
    if (!corps || typeof corps !== 'object' || !(corps.lectureGarde && typeof corps.lectureGarde === 'object')) return non('bloc lectureGarde absent');
    const lu = lectureDe(corps);
    if (!lu) return non('lecture inexploitable');
    const P = produits.get(gagnant);
    if (contredire({ corps, gagnant, produits })) return non('la garde contradiction répond');
    const sp = statuts(lu, P);
    // LANGUE-DECISIVE R4 : un code lu qui ne désigne AUCUN produit (vivier ET catalogue entier, code × numéro) — « s8a-P » lu pour un logo — ne bloque pas ; un code qui désigne un AUTRE produit bloque toujours.
    const sansDesignation = r4 === true && codeSansDesignation({ corps, produits, catalogueExiste });
    const ko = Object.keys(sp).filter(k => sp[k] === 'ko' && !(sansDesignation && k === 'code') && !toleres.includes(k));
    if (ko.length) return non(`un champ lu contredit P (${ko.join(', ')})`);
    const luNC = { numero: lu.numero, setCode: lu.setCode };
    const cp = comparer(luNC, P);
    if (!cp.concorde.includes('numero')) return non('le numéro lu ne concorde pas exactement avec P');
    if (!cp.concorde.includes('code') && !sansDesignation) return non('le code lu ne concorde pas avec P (ou n\'est pas lu)');
    for (const id of autres) {
        const cj = comparer(luNC, produits.get(id));
        if (cj.concorde.includes('numero')) return non(`le numéro lu est aussi celui du produit ${id}`);
        if (!cj.contredit.includes('numero')) return non(`le numéro du produit ${id} est inconnu ou ambigu face au numéro lu`);
    }
    const formes = formesLuesDe(corps);
    if (formes.length && !nomCompatible(formes, P)) return non('le nom lu contredit P');
    return { ok: true, raison: '', codeParR4: !cp.concorde.includes('code') };
}

/**
 * @param corps     la réponse de la chaîne héritée (success true) avec son bloc `lectureGarde`
 * @param gagnant   idProduct de P (la carte affirmée par la chaîne, ou le candidat unique)
 * @param jumeaux   les idProduct des AUTRES produits du groupe (jumeaux de P, hors P)
 * @param produits  Map<idProduct, ligne de catalogue> : doit porter P et TOUS ses jumeaux
 * @param actif     le drapeau (défaut : la constante CRITERE_A) ; seul `true` allume
 * @param catalogueExiste  (setCode, numero) => boolean : un produit du catalogue ENTIER porte-t-il ce code et ce numéro ? (R4 ; absent : R4 fermée)
 * @returns { affirme: boolean, raison: string }
 */
function critereA({ corps, gagnant, jumeaux, produits, actif = CRITERE_A, r4 = LD.REGLES.R4, catalogueExiste } = {}) {
    const non = raison => ({ affirme: false, raison });
    try {
        if (actif !== true) return non('critère éteint');
        if (!Number.isInteger(gagnant) || !(produits instanceof Map) || !produits.has(gagnant)) return non('produit absent du catalogue');
        const autres = [...new Set(Array.isArray(jumeaux) ? jumeaux : [])].filter(i => i !== gagnant);
        if (!autres.length || !autres.every(Number.isInteger)) return non('aucun jumeau');
        if (!corps || typeof corps !== 'object' || !(corps.lectureGarde && typeof corps.lectureGarde === 'object') || !lectureDe(corps)) return non('bloc lectureGarde absent');
        compte.jugees++;
        const c = conditions({ corps, gagnant, autres, produits, r4, catalogueExiste });
        if (!c.ok) return non(c.raison);
        const lu = lectureDe(corps);
        compte.affirmees++;
        const codeLu = String(lu.setCode).trim().toUpperCase();
        compte.parCode[codeLu] = (compte.parCode[codeLu] || 0) + 1;
        console.warn(`ℹ️ [critere-a-v2] affirmation produit=${gagnant} code=${codeLu} groupe=${autres.length + 1}`);
        if (c.codeParR4) return { affirme: true, raison: `critère A (R4) : le numéro (${lu.numero}) lu concorde avec ${gagnant} seul parmi ${autres.length + 1} produits, le code lu (${lu.setCode}) ne désigne aucun produit du catalogue` };
        return { affirme: true, raison: `critère A : le numéro (${lu.numero}) et le code (${lu.setCode}) lus concordent avec ${gagnant} seul parmi ${autres.length + 1} produits` };
    } catch (e) {
        return non(`décision impossible (${(e && e.name) || 'erreur'})`);                 // une exception n'est jamais une affirmation
    }
}

module.exports = { critereA, conditions, compteurs, CRITERE_A };
