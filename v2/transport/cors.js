'use strict';
// CORS v2 — origines EXACTES, deux profils. Écrit par ce qu'il AUTORISE : tout ce qui n'est pas (origine exacte ET chemin du profil)
// ne reçoit aucun en-tête CORS (le cors() hérité décide alors, comme aujourd'hui). Jamais '*'.
// Monté AVANT toute route, limiteur ou gestionnaire d'erreur : les en-têtes figurent donc aussi sur les 4xx/5xx/429.
const EXPOSE = 'Retry-After, Idempotency-Replayed';

function profils(cfg) {
    const o = cfg.origines;
    const ext = [o.extension, o.extensionDev].filter(x => typeof x === 'string' && x);
    return [
        { nom: 'extension', origines: new Set(ext), credentials: false,
          // PHOTOS-MULTIPLES (7d) : /api/photo n'a de profil CORS que si la route existe (drapeau allumé) ; éteint, aucun en-tête propre à v2 pour ce chemin
          chemins: [/^\/ping$/, /^\/api\/(installation|solde|retour-live|identifier|identifier\/reponse|creer-recharge)$/, /^\/api\/compte\/(lier|delier)$/, /^\/api\/banc\/.+$/, ...(cfg.photosMultiples === true ? [/^\/api\/photo(\/.+)?$/] : [])],      // le sous-arbre entier, comme /api/banc/.+ : un chemin voisin inexistant porte les mêmes en-têtes que la route (le 404 natif d'un non-administrateur ne se distingue pas)
          methodes: 'GET, POST', entetes: 'Authorization, Content-Type, Idempotency-Key' },
        { nom: 'site', origines: new Set([o.site]), credentials: true,
          chemins: [/^\/ping$/, /^\/api\/compte(\/.*)?$/, /^\/api\/scanner\/.+$/, /^\/api\/solde$/, /^\/api\/creer-recharge$/, /^\/api\/collection(\/.*)?$/, /^\/api\/abonnement(\/.*)?$/],
          methodes: 'GET, POST, DELETE', entetes: 'Content-Type, X-Rat-Market, Idempotency-Key' }
    ];
}

function middlewareV2(cfg) {
    const P = profils(cfg);
    return function corsV2(req, res, next) {
        const origine = req.headers.origin;
        const chemin = req.path;
        if (P.some(x => x.chemins.some(re => re.test(chemin)))) res.vary('Origin');   // la réponse d'un chemin v2 dépend de l'origine, même quand on la refuse
        if (typeof origine !== 'string' || !origine) return next();          // curl, serveur à serveur : aucun en-tête
        const p = P.find(x => x.origines.has(origine) && x.chemins.some(re => re.test(chemin)));
        if (!p) return next();                                               // inconnue, voisine, ou hors profil : le cors() hérité décide
        req.origineV2 = true;
        res.setHeader('Access-Control-Allow-Origin', origine);               // l'origine exacte, jamais '*'
        if (p.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Expose-Headers', EXPOSE);
        if (req.method === 'OPTIONS') {
            // L'effacement par jeton est un DROIT : son préflight doit autoriser DELETE (il ne doit pas échouer en silence). Pour ce SEUL chemin de l'extension,
            // (le plan §1 lui donne GET, POST partout ailleurs) ; le sous-chemin ou tout autre chemin garde GET, POST.
            const delPermis = p.nom === 'extension' && /^\/api\/banc\/contributions$/.test(chemin);
            // « Ma collection » (site) : GET et PUT seulement, jamais POST ni DELETE — le profil du site ailleurs est inchangé.
            const collection = p.nom === 'site' && /^\/api\/collection(\/.*)?$/.test(chemin);
            res.setHeader('Access-Control-Allow-Methods', collection ? 'GET, PUT' : delPermis ? `${p.methodes}, DELETE` : p.methodes);
            res.setHeader('Access-Control-Allow-Headers', p.entetes);
            res.setHeader('Access-Control-Max-Age', '600');
            return res.status(204).end();
        }
        next();
    };
}
module.exports = { middlewareV2, profils };
