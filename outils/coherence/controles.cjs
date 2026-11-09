'use strict';
// CONTROLES DE DENOMINATEUR de l'analyse du test de coherence : un compte ne se lit que si ses entrees sont completes et sans doublon. Module PUR.
//   indexerSansDoublon([{ fichier, lignes: [{ sha256 }] }]) : une carte sha256 -> ligne ; un sha256 vu deux fois (meme fichier, ou deux series) LEVE.
//   controlerDenominateurs({ attendues, toutesAttendues, erreursA, parVariante: { A, B, ... }, sansTemoin: { B0: Set } }) :
//     comparees = attendues - erreurs de A (le compte est ASSERTE, pas suppose) ; une photo absente de A, ou d'une variante (hors `sansTemoin` declare), ou une photo inattendue dans une variante, ou une erreur de A hors de la population : LEVE.
function indexerSansDoublon(lots) {
    const m = new Map();
    for (const { fichier, lignes } of lots) for (const l of lignes) {
        if (m.has(l.sha256)) throw new Error(`doublon de sha256 ${String(l.sha256).slice(0, 8)} (fichier ${fichier})`);
        m.set(l.sha256, l);
    }
    return m;
}

function controlerDenominateurs({ attendues, toutesAttendues, erreursA, parVariante, sansTemoin = {} }) {
    for (const s of erreursA) if (!attendues.has(s)) throw new Error(`erreur de A hors de la population : ${s.slice(0, 8)}`);
    for (const s of attendues) if (!parVariante.A.has(s)) throw new Error(`photo ${s.slice(0, 8)} absente de A`);
    const comparees = [...attendues].filter(s => !erreursA.has(s)).sort();
    if (comparees.length !== attendues.size - erreursA.size) throw new Error('denominateur incoherent');
    for (const [v, m] of Object.entries(parVariante)) {
        for (const s of m.keys()) if (!toutesAttendues.has(s)) throw new Error(`photo ${s.slice(0, 8)} inattendue dans la variante ${v}`);
        if (v === 'A') continue;
        const exempt = sansTemoin[v] || new Set();
        for (const s of comparees) if (!m.has(s) && !exempt.has(s)) throw new Error(`photo ${s.slice(0, 8)} absente de la variante ${v}`);
    }
    return { comparees };
}

module.exports = { indexerSansDoublon, controlerDenominateurs };
