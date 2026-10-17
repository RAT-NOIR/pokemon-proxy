// ============================================================
// LA FRAÎCHEUR DU GUIDE DES PRIX DANS /ping (décision du testeur, 2026-10-17) — sans jamais couper le service
// ============================================================
// /ping est la route de réveil (keep-alive, Render) : elle ne doit JAMAIS échouer ni ralentir à cause de cette lecture. D'où :
// · la lecture est INJECTÉE (`lire` rend le `guideDu` de guide_prix_meta/dernier — le champ que l'import écrit en dernier) ;
// · elle est bornée dans le temps (`delaiMs`) ; toute exception, tout délai, toute valeur illisible = repli explicite « inconnue »
//   (guideDu/guideAgeHeures/guideAJour à null), jamais une date inventée ;
// · un cache court (5 min, 1 min pour un échec) : le keep-alive ne martèle pas la base.
// Au-delà de SEUIL_HEURES (36 h) : guideAJour false. Le service, lui, continue.
const SEUIL_HEURES = 36, DELAI_MS = 1500, CACHE_MS = 5 * 60 * 1000, CACHE_ECHEC_MS = 60 * 1000;
const INCONNU = { guideDu: null, guideAgeHeures: null, guideAJour: null };

function calculer(valeur, maintenant) {
    const d = valeur instanceof Date ? valeur : null;
    if (!d || Number.isNaN(d.getTime())) return { ...INCONNU };
    const age = Math.max(0, Math.round((maintenant().getTime() - d.getTime()) / 360000) / 10);   // heures, une décimale
    return { guideDu: d.toISOString(), guideAgeHeures: age, guideAJour: age <= SEUIL_HEURES };
}

/** @param lire async () => Date|null ; @param cache objet muable partagé (ou null : pas de cache). Ne lève jamais. */
async function etatGuide({ lire, maintenant = () => new Date(), delaiMs = DELAI_MS, cache = null }) {
    try {
        const now = maintenant().getTime();
        if (cache?.valeur && now < cache.jusqua) return cache.valeur;
        let minuterie;
        const limite = new Promise((_, ko) => { minuterie = setTimeout(() => ko(new Error('délai')), delaiMs); });
        let r;
        try { r = calculer(await Promise.race([lire(), limite]), maintenant); }
        catch { r = { ...INCONNU }; if (cache) { cache.valeur = r; cache.jusqua = now + CACHE_ECHEC_MS; } return r; }
        finally { clearTimeout(minuterie); }
        if (cache) { cache.valeur = r; cache.jusqua = now + (r.guideAJour === null ? CACHE_ECHEC_MS : CACHE_MS); }
        return r;
    } catch { return { ...INCONNU }; }
}

module.exports = { etatGuide, SEUIL_HEURES, INCONNU };
