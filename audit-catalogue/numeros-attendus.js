'use strict';
// Règle PURE des numéros attendus d'un set (aucune base, aucun réseau) — extraite de audit-sets.js (2026-11-07).
// 🔴 Le total imprimé d'un set (« 216 » pour Brilliant Stars) COMPTE les sous-séries à numéro préfixé (TG01-30, GG01-70, SV1-94, H1-32, RC, SH, RT, Unown A-Z…).
//    L'ancienne règle cherchait 1..T en ENTIERS et rangeait les préfixés en « manquants » : ≈ 500 faux trous sur 516 (PLAN-SERIES-0711).
// Trois familles de numéros (après la normalisation du site, « 006 » → « 6 ») :
//   · PRINCIPAL : un entier ;
//   · SOUS-SÉRIE (compte dans Q) : lettres puis chiffres (TG01, GG70, SV94, H1, RC3, SH4, RT6) ou une lettre seule / « ! » / « ? » (Unown) ;
//   · ANNEXE (« 101a », « 12A » : chiffres puis lettre, hors total) : n'entre ni dans P ni dans Q, ignorée.
// Bloc principal attendu 1..N :
//   · aucune sous-série présente, ou un principal présent dépasse T (secrètes au-delà du total) → N = T ;
//   · sinon (le total contient les sous-séries) → N = max(T − Q, plus grand principal présent) (GEN : T 115, 83 principaux, 34 sous-séries dont 2 hors total → N = 83).
// ⚠️ LIMITES ÉCRITES :
//   1. dès que Q > 0, N = T − Q : si le total imprimé ne compte PAS les sous-séries, les Q derniers principaux ne sont pas surveillés (sous-déclaration, jamais de faux trou) ;
//   2. si Q est partiel (10 TG présents sur 30), N = T − Q est trop grand de 20 : on signale alors des numéros en queue qui n'existent pas.
//      Direction choisie : celle qui SIGNALE (un faux signal se voit et s'ouvre ; un trou masqué ne se voit pas). Le libellé du set le dit.

const estPrincipal = n => /^\d+$/.test(String(n));
const estSousSerie = n => /^([A-Z]+\d+|[A-Z]+|[!?])$/i.test(String(n));
const estAnnexe = n => /^\d+[A-Z]+$/i.test(String(n));

/** @param {{ totalImprime: number|null, numerosPresents: Iterable<string> }} p  numéros déjà normalisés par la règle du site */
function numerosAttendus({ totalImprime, numerosPresents }) {
    const presents = new Set([...(numerosPresents || [])].map(String));
    const principaux = [...presents].filter(estPrincipal).map(Number);
    const prefixes = [...presents].filter(estSousSerie).length;
    const annexes = [...presents].filter(estAnnexe).length;
    const T = Number.isInteger(totalImprime) && totalImprime > 0 ? totalImprime : null;
    const P = principaux.length, Q = prefixes;
    if (T === null) return { attendu: null, totalImprime: null, principaux: P, prefixes: Q, annexes, manquants: [], libelle: 'attendu : aucun total imprimé' };
    const maxP = principaux.reduce((a, n) => Math.max(a, n), 0);
    const N = Q === 0 || maxP > T ? T : Math.max(T - Q, maxP);
    const manquants = [];
    for (let i = 1; i <= N; i++) if (!presents.has(String(i))) manquants.push(String(i));
    const auDela = principaux.filter(n => n > T).length;
    let libelle = `attendu : total imprimé ${T} = ${P} principaux${auDela ? ` dont ${auDela} au-delà du total ${T}` : ''} + ${Q} préfixés (bloc principal 1..${N})`;
    if (annexes) libelle += `, ${annexes} annexes ignorées`;
    if (Q > 0 && N === T - Q) libelle += ' ; N = T − Q : si le total ne compte pas les préfixés, les Q derniers principaux ne sont pas surveillés ; si des préfixés manquent, des numéros en queue peuvent être signalés à tort';
    return { attendu: N, totalImprime: T, principaux: P, prefixes: Q, annexes, manquants, libelle };
}

module.exports = { numerosAttendus, estPrincipal, estSousSerie, estAnnexe };
