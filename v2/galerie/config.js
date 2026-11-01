'use strict';
// GALERIE — la configuration de la Communauté. Ne LÈVE JAMAIS (une variable de la Communauté mal posée ne doit pas fermer les routes v2 d'avant : v2/config.js l'appelle pour toute v2 configurée).
//   · V2_GALERIE=1 EXACTEMENT allume le lot (toute autre valeur l'éteint, sans invalider la configuration) ; éteint, AUCUNE route n'existe (404 natif) et le comportement est celui d'avant ;
//   · allumé, le lot ne se monte que si `pret` : la base dédiée est admise par la garde (grappe.js) ET le stockage R2 est configuré (r2.js) ET toutes les bornes sont lisibles. Sinon `raison` dit POURQUOI (jamais une valeur).
//   · la configuration ne porte AUCUN secret ni adresse : la base et R2 se relisent dans l'environnement au montage.
const { jugerGrappe } = require('./grappe');
const { lireConfigR2 } = require('./r2');

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
    const vide = { actif, pret: false, raison: null, bornes: null, limites: null };
    if (!actif) return gele({ ...vide, raison: 'éteint' });
    let bornes, limites;
    try {
        bornes = { octetsMax: entier('V2_ILLUSTRATION_OCTETS_MAX', env.V2_ILLUSTRATION_OCTETS_MAX, 8 * 1024 * 1024, 1024, 16 * 1024 * 1024),
                   pixelsMax: entier('V2_ILLUSTRATION_PIXELS_MAX', env.V2_ILLUSTRATION_PIXELS_MAX, 24e6, 1e4, 40e6),
                   illustrationsMax: entier('V2_ILLUSTRATIONS_MAX', env.V2_ILLUSTRATIONS_MAX, 30, 1, 1000) };
        limites = { lectureIpHeure: 600, votesCompteHeure: 600, votesIpHeure: 1200, ecrituresCompteHeure: 120, ecrituresIpHeure: 300, depotsCompteHeure: 20, depotsIpHeure: 40,
                    signalementsIpHeure: entier('V2_SIGNALEMENTS_IP_HEURE', env.V2_SIGNALEMENTS_IP_HEURE, 10, 1, 1000), signalementsCompteJour: 30, pseudoCompteJour: 5, pseudoIpJour: 20, moderationCompteHeure: 600,
                    jaimeMax: entier('V2_JAIME_MAX', env.V2_JAIME_MAX, 5000, 1, 100000), classeursMax: entier('V2_CLASSEURS_MAX', env.V2_CLASSEURS_MAX, 20, 1, 1000) };
    } catch (e) { return gele({ ...vide, raison: e instanceof ErreurBorne ? e.raison : 'une borne de la Communauté est illisible' }); }
    const g = jugerGrappe(env);
    if (!g.ok) return gele({ ...vide, bornes, limites, raison: g.raison });
    const r = lireConfigR2(env);
    if (!r.ok) return gele({ ...vide, bornes, limites, raison: r.raison });
    return gele({ actif, pret: true, raison: null, bornes, limites });
}
module.exports = { lireGalerie };
