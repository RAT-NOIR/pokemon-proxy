'use strict';
// COTES-VISUELS — la forme COMPACTE gardée en mémoire. Une VERSION est complète ou n'existe pas (le chargeur la construit à part, puis la bascule d'un geste) :
//   visuels       Map idProduct → entrée VALIDÉE par lireEntree (vignette, grande, mention, idMetacard, numero, rarete, total, variante, setNom, lien) — les chaînes répétées sont partagées (intern)
//   parMetacarte  Map idMetacard → [idProduct…] (les impressions d'une métacarte, sans balayage)
//   liens         Map slug du set → Map clé de fiche `idInterne|numero` → [idProduct…] (les cotes : fiche → produits)
//   comptes       les dénominateurs (jamais un nombre sans sa population)
const { lireEntree } = require('../identifier/visuels');

/** @returns la version GELÉE (au premier niveau : ses Map ne sont écrites que ici). */
function construireVersion({ entrees, liens, chargeLe = new Date() }) {
    const pool = new Map();
    const intern = s => { if (typeof s !== 'string') return s; const v = pool.get(s); if (v !== undefined) return v; pool.set(s, s); return s; };
    const visuels = new Map(), parMetacarte = new Map(), motifs = {};
    let refusees = 0;
    for (const e of entrees) {
        const r = lireEntree(e);                                                    // la validation d'entrée s'applique à CHAQUE entrée chargée
        if (!r.ok) { refusees++; motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; }
        const d = r.doc;
        for (const k of ['mention', 'numero', 'rarete', 'total', 'variante', 'setNom']) d[k] = intern(d[k]);
        visuels.set(d.idProduct, Object.freeze(d));
        if (d.idMetacard !== null) { const l = parMetacarte.get(d.idMetacard); if (l) l.push(d.idProduct); else parMetacarte.set(d.idMetacard, [d.idProduct]); }
    }
    let fichesLiees = 0, produitsLies = 0;
    for (const m of liens.values()) { fichesLiees += m.size; for (const v of m.values()) produitsLies += v.length; }
    return Object.freeze({ chargeLe, visuels, parMetacarte, liens, comptes: Object.freeze({ lues: entrees.length, visuels: visuels.size, refusees, motifs, setsAvecLiens: liens.size, fichesLiees, produitsLies }) });
}
module.exports = { construireVersion };
