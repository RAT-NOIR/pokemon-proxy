'use strict';
// Le tirage en strates de la planche de calibration : « 200 paires tirées en strates sur TOUTE l'échelle des distances » (brief S8/AUDIT). Pur, déterministe par graine.
// Les strates sont les intervalles [bornes[i], bornes[i+1]) — la dernière inclut sa borne haute (une distance de 1 existe). Quota égal par strate ; une strate qui n'a pas assez
// de paires donne tout ce qu'elle a, et le RELIQUAT est reversé, un par un, aux strates qui ont encore des paires (les plus fournies d'abord) : le total est atteint quand la population le permet.
const graineDe = g => { let t = g >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };

/** L'indice de la strate d'une distance, ou -1 si elle est hors de [bornes[0], bornes.at(-1)] ou non finie. */
function binDe(d, bornes) {
    if (!Number.isFinite(d) || d < bornes[0] || d > bornes[bornes.length - 1]) return -1;
    for (let i = 0; i < bornes.length - 1; i++) if (d < bornes[i + 1]) return i;
    return bornes.length - 2;
}

/**
 * @param {Array<{idProduct:number, distance:number}>} paires
 * @returns {{ choisies: object[], parStrate: Array<{borne:[number,number], disponibles:number, tirees:number}>, manque: number, graine: number }}
 */
function stratifier(paires, { bornes, total, graine }) {
    if (!paires || !paires.length) throw new Error('stratifier : population vide — un vide n\'est pas un tirage');
    const n = bornes.length - 1;
    const strates = Array.from({ length: n }, () => []);
    for (const p of paires) { const b = binDe(p.distance, bornes); if (b >= 0) strates[b].push(p); }
    if (!strates.some(s => s.length)) throw new Error('stratifier : aucune distance valide dans la population (toutes NaN ou hors [0, 1])');
    // mélange déterministe de chaque strate (Fisher-Yates), puis on prend en tête de liste
    strates.forEach((s, i) => { const r = graineDe(graine * 1000 + i + 1); for (let k = s.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [s[k], s[j]] = [s[j], s[k]]; } });
    const prises = strates.map(s => Math.min(s.length, Math.floor(total / n)));
    let reste = total - prises.reduce((a, b) => a + b, 0);
    while (reste > 0) {
        const ouvertes = strates.map((s, i) => ({ i, libre: s.length - prises[i] })).filter(x => x.libre > 0).sort((a, b) => b.libre - a.libre || a.i - b.i);
        if (!ouvertes.length) break;
        for (const o of ouvertes) { if (reste <= 0) break; prises[o.i]++; reste--; }
    }
    const choisies = strates.flatMap((s, i) => s.slice(0, prises[i])).sort((a, b) => a.distance - b.distance || a.idProduct - b.idProduct);
    return { choisies, parStrate: strates.map((s, i) => ({ borne: [bornes[i], bornes[i + 1]], disponibles: s.length, tirees: prises[i] })), manque: total - choisies.length, graine };
}

module.exports = { stratifier, binDe };
