'use strict';
// GALERIE — un MÉMO serveur de 30 à 60 s pour les lectures publiques coûteuses (`tri=tendances`, `/filtres`, `/formats`) : le `Cache-Control: public` ne protège que si un CDN est devant (relecture 1, S-I4).
// La clé est les paramètres NORMALISÉS (jamais la requête brute) ; les calculs simultanés d'une même clé n'en font qu'un ; la table est bornée. Ttl 0 : aucun cache (les bancs qui lisent aussitôt après écrire).
// Ce qu'il garde est PUBLIC (aucune donnée du lecteur) : le même résultat pour tous.
function creerMemo({ ttlMs, maintenant = () => new Date(), max = 200 }) {
    const tenues = new Map(), enVol = new Map();
    return {
        async obtenir(cle, fn) {
            if (ttlMs <= 0) return fn();
            const t = maintenant().getTime();
            const e = tenues.get(cle);
            if (e && e.expire > t) return e.valeur;
            if (enVol.has(cle)) return enVol.get(cle);
            const p = (async () => {
                try {
                    const valeur = await fn();
                    if (tenues.size >= max) tenues.delete(tenues.keys().next().value);
                    tenues.set(cle, { valeur, expire: t + ttlMs });
                    return valeur;
                } finally { enVol.delete(cle); }
            })();
            enVol.set(cle, p);
            return p;
        },
        vider() { tenues.clear(); }
    };
}
module.exports = { creerMemo };
