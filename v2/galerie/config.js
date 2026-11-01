'use strict';
// GALERIE — la configuration de la Communauté. Ne LÈVE JAMAIS (une variable de la Communauté mal posée ne doit pas fermer les routes v2 d'avant : v2/config.js l'appelle pour toute v2 configurée).
//   · V2_GALERIE=1 EXACTEMENT allume le lot (toute autre valeur l'éteint, sans invalider la configuration) ; éteint, AUCUNE route n'existe (404 natif) et le comportement est celui d'avant ;
//   · allumé, le lot ne se monte que si `pret` : la grappe dédiée est déclarée, exacte et inconnue des autres (grappe.js), les DEUX buckets R2 sont déclarés et dédiés (r2.js), toutes les bornes sont lisibles et,
//     quand la cible est la PRODUCTION (NODE_ENV=production ou V2_CIBLE=prod), la clé secrète Turnstile n'est pas une clé FACTICE de Cloudflare. `V2_CIBLE=essai` lève cette dernière interdiction (l'essai tourne souvent
//     sous NODE_ENV=production avec les clés de test). Sinon `raison` dit POURQUOI (jamais une valeur). Le marqueur de la base et ceux des buckets se jugent APRÈS, à l'ouverture (monter.js).
//   · la configuration ne porte AUCUN secret ni adresse : la base et R2 se relisent dans l'environnement au montage.
const { jugerGrappe } = require('./grappe');
const { lireConfigR2 } = require('./r2');
const { FACTICES } = require('./turnstile');

class ErreurBorne { constructor(raison) { this.raison = raison; } }      // jamais `.message` : la raison nomme la VARIABLE, jamais sa valeur
const entier = (nom, v, defaut, min, max) => {
    if (v === undefined || v === '') return defaut;
    const n = String(v).trim() === '' ? NaN : Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new ErreurBorne(`${nom} invalide (entier de ${min} à ${max} attendu)`);
    return n;
};
const gele = o => { Object.values(o).forEach(x => { if (x && typeof x === 'object') gele(x); }); return Object.freeze(o); };

function lireGalerie(env = process.env) {
    const actif = env.V2_GALERIE === '1';
    const vide = { actif, pret: false, raison: null, bornes: null, limites: null, balayageMs: 0 };
    if (!actif) return gele({ ...vide, raison: 'éteint' });
    let bornes, limites, balayageMs;
    try {
        // 12 Mpx par défaut (S-I2) : un PNG de 12 Mpx décodé pèse ~48 Mo (96 Mo en 16 bits) sur un service de 512 Mo ; plafonné à 24 Mpx tant que le pic réel n'est pas mesuré plus haut
        bornes = { octetsMax: entier('V2_ILLUSTRATION_OCTETS_MAX', env.V2_ILLUSTRATION_OCTETS_MAX, 8 * 1024 * 1024, 1024, 16 * 1024 * 1024),
                   pixelsMax: entier('V2_ILLUSTRATION_PIXELS_MAX', env.V2_ILLUSTRATION_PIXELS_MAX, 12e6, 1e4, 24e6),
                   illustrationsMax: entier('V2_ILLUSTRATIONS_MAX', env.V2_ILLUSTRATIONS_MAX, 30, 1, 1000) };
        limites = { lectureIpHeure: 600, votesCompteHeure: 600, votesIpHeure: 1200, ecrituresCompteHeure: 120, ecrituresIpHeure: 300, depotsCompteHeure: 20, depotsIpHeure: 40,
                    signalementsIpHeure: entier('V2_SIGNALEMENTS_IP_HEURE', env.V2_SIGNALEMENTS_IP_HEURE, 10, 1, 1000), signalementsCompteJour: 30, pseudoCompteJour: 5, pseudoIpJour: 20, moderationCompteHeure: 600,
                    jaimeMax: entier('V2_JAIME_MAX', env.V2_JAIME_MAX, 5000, 1, 100000), classeursMax: entier('V2_CLASSEURS_MAX', env.V2_CLASSEURS_MAX, 20, 1, 1000) };
        balayageMs = entier('V2_GALERIE_BALAYAGE_MIN', env.V2_GALERIE_BALAYAGE_MIN, 30, 0, 1440) * 60e3;      // 0 coupe le balayeur
    } catch (e) { return gele({ ...vide, raison: e instanceof ErreurBorne ? e.raison : 'une borne de la Communauté est illisible' }); }
    const g = jugerGrappe(env);
    if (!g.ok) return gele({ ...vide, bornes, limites, raison: g.raison });
    const r = lireConfigR2(env);
    if (!r.ok) return gele({ ...vide, bornes, limites, raison: r.raison });
    // Turnstile : les clés factices de Cloudflare valident TOUT ; en production elles ouvriraient le signalement anonyme. NODE_ENV et V2_CIBLE se lisent sur l'environnement jugé.
    const secretTurnstile = typeof env.V2_GALERIE_TURNSTILE_SECRET === 'string' ? env.V2_GALERIE_TURNSTILE_SECRET.trim() : '';
    const production = (env.NODE_ENV === 'production' || env.V2_CIBLE === 'prod') && env.V2_CIBLE !== 'essai';
    if (production && secretTurnstile) {
        if (FACTICES.includes(secretTurnstile)) return gele({ ...vide, bornes, limites, raison: 'V2_GALERIE_TURNSTILE_SECRET est une clé FACTICE de Cloudflare (elle valide tout) alors que la cible est la production : refusé.' });
    }
    return gele({ actif, pret: true, raison: null, bornes, limites, balayageMs });
}
module.exports = { lireGalerie };
