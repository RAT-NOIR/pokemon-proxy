'use strict';
// MODELE-VISUEL-API — le fournisseur de voisins branché sur le VECTEUR de l'extension : il remplace le service de voisins (le fournisseur `deps.voisins` de la règle G, B1b.7) par « le vecteur calculé par l'extension
// + l'index des empreintes de l'archive, tenu par l'API ». Il rend à la route exactement ce que la règle G lit : { ligne: {top, essai}, nEssais, mesures, contexteG, seuils } (ou un code fermé qui dit pourquoi G se tait).
//   1. lireEnveloppe : la forme de `empreintes` / `modeleEmpreinte` dans la requête (au plus UNE entrée par photo, 8 au plus, rien de retenu au-delà de 2 000 caractères par vecteur) ;
//   2. le MODÈLE : le serveur ne connaît QU'UNE version attendue (sa configuration : identifiant + sha256 des poids). Une autre : les empreintes sont ignorées, code « modele-inconnu » ;
//   3. UN seul vecteur est jugé : celui de la photo de plus petit index. Il passe la vérification (empreinte-vecteur.js : forme, valeurs, norme, cosinus >= 0,30 à l'index) AVANT toute décision ;
//   4. la recherche (index-empreintes.js, top 10) ; `nEssais` vaut 1 (UN essai par photo) et `essai` vaut 1 si le vecteur est celui d'une carte redressée, 0 pour la photo entière ;
//   5. la GARDE DES ZONES : elle regarde des PIXELS (la photo redressée contre les scans de l'archive), que l'API ne détient pas — un crochet `pixels` les fournit ({ photo, scan }), jamais téléchargés ici ;
//      les mesures demandées par la règle sont calculées ICI (même boucle que l'outil de mesure, decider.js) puis rendues en cache : la décision de la route est rejouée dessus, sans nouveau calcul.
//      Sans crochet, ou crochet qui échoue : G se tait (« muette »), elle ne devine pas.
// Écrit par ce qu'il AUTORISE : tout ce qui n'est pas explicitement bon rend un code fermé (modele-inconnu, invalide, indisponible, muette) et NE LÈVE JAMAIS.
const E = require('./empreinte-vecteur');
const G = require('../../ratmarket/decision-g');

const CODES = Object.freeze(['modele-inconnu', 'invalide', 'indisponible', 'muette']);
const ENTREES_MAX = 8, VECTEUR_MAX = 2000, TOURS_MAX = 16;
const MANQUE = new Error('mesure manquante');                                         // le signal interne de la boucle des mesures
const echec = code => ({ ok: false, code });
const objetSimple = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * La forme de la requête. null : la requête ne parle pas d'empreintes (rien à dire). Sinon { rejet: null|'enveloppe', modele: {id, sha256}|null, entrees: [{photo, vecteur, redressee}] triées par photo }.
 * @param corps     le corps de la requête      @param nPhotos   le nombre d'imageUrls
 */
function lireEnveloppe(corps, nPhotos) {
    if (!objetSimple(corps)) return null;
    const m = corps.modeleEmpreinte, e = corps.empreintes;
    if ((e === undefined || e === null) && (m === undefined || m === null)) return null;
    const modele = objetSimple(m) && typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 60 && typeof m.sha256 === 'string' && m.sha256.length === 64 ? { id: m.id, sha256: m.sha256 } : null;
    const rejet = { rejet: 'enveloppe', modele, entrees: [] };
    if (e === undefined || e === null) return { rejet: null, modele, entrees: [] };
    if (!Array.isArray(e) || e.length > ENTREES_MAX) return rejet;
    const vus = new Set(), entrees = [];
    for (const x of e) {
        if (!objetSimple(x)) return rejet;
        for (const k of Object.keys(x)) if (k !== 'photo' && k !== 'vecteur' && k !== 'redressee') return rejet;
        if (!Number.isInteger(x.photo) || x.photo < 0 || x.photo >= nPhotos || vus.has(x.photo)) return rejet;
        if (typeof x.vecteur !== 'string' || x.vecteur.length > VECTEUR_MAX) return rejet;
        if (x.redressee !== undefined && typeof x.redressee !== 'boolean') return rejet;
        vus.add(x.photo);
        entrees.push({ photo: x.photo, vecteur: x.vecteur, redressee: x.redressee === true });
    }
    entrees.sort((a, b) => a.photo - b.photo);
    return { rejet: null, modele, entrees };
}

/**
 * @param {{cfg: object, etat?: object, zones?: object, pixels?: {photo: Function, scan: Function}}} o
 *   cfg.modeleEmpreinte : { id, sha256 } — LA version attendue ; etat : le pointeur de l'index (etat-empreintes.js) ; zones : ratmarket/zones.js (injectable) ;
 *   pixels : { photo({entree, indexPhoto, scanId}) → {data: Buffer RGB, width, height}|null, scan(cle) → Buffer|null }
 */
function creerFournisseurEmpreinte({ cfg, etat = require('./etat-empreintes'), zones = null, pixels = null } = {}) {
    const attendu = () => { const m = cfg && cfg.modeleEmpreinte; return m && typeof m.id === 'string' && m.id && typeof m.sha256 === 'string' && m.sha256 ? { id: m.id, sha256: m.sha256 } : null; };
    const Z = () => zones || require('../../ratmarket/zones');

    // Les mesures que la règle demande, calculées avec les pixels fournis. { ok:true, mesures } | { ok:false, code }
    async function mesurer({ ligne, ctx, entree, photo: indexPhoto, scanId }) {
        const cache = { zones: {}, paires: {} };
        const rendu = { comparerPaire: (a, b) => cache.paires[`${a}|${b}`], scoresZones: c => cache.zones[c] };
        let photo = null;
        try {
            for (let tour = 0; tour < TOURS_MAX; tour++) {
                let manque = null;
                const mesures = {
                    comparerPaire: (a, b) => { const r = cache.paires[`${a}|${b}`]; if (r) return r; manque = ['paire', a, b]; throw MANQUE; },
                    scoresZones: c => { const r = cache.zones[c]; if (r) return r; manque = ['zones', c]; throw MANQUE; }
                };
                try { G.decider(ctx, ligne, 1, mesures, G.SEUILS_G); return { ok: true, mesures: rendu }; }
                catch (err) {
                    if (err !== MANQUE || !manque) return echec('indisponible');            // une faute de la règle ou du contexte : on ne la prend pas pour une mesure
                    if (!pixels || typeof pixels.photo !== 'function' || typeof pixels.scan !== 'function') return echec('muette');
                    if (!photo) {
                        const p = await pixels.photo({ entree, indexPhoto, scanId });
                        if (!p || !Buffer.isBuffer(p.data) || !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.data.length !== p.width * p.height * 3) return echec('muette');
                        photo = await Z().photoGrise(p.data, p.width, p.height);
                    }
                    const source = async cle => { const octets = await pixels.scan(cle); if (!Buffer.isBuffer(octets) || octets.length === 0) throw MANQUE; return { cle, octets }; };
                    if (manque[0] === 'paire') {
                        const r = await Z().comparerPaire(photo, await source(manque[1]), await source(manque[2]));
                        if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) return echec('muette');
                        cache.paires[`${manque[1]}|${manque[2]}`] = r;
                    } else {
                        const r = await Z().scoresZones(photo, await source(manque[1]));
                        if (!r || ![r.haut, r.bas, r.inliers].every(Number.isFinite)) return echec('muette');
                        cache.zones[manque[1]] = r;
                    }
                }
            }
            return echec('muette');                                                          // la règle ne s'est pas arrêtée de demander : elle n'a pas conclu
        } catch { return echec('muette'); }
        finally { if (photo && typeof photo.delete === 'function') { try { photo.delete(); } catch { /* déjà libérée */ } } }
    }

    return async function voisinsEmpreinte({ entree, scanId } = {}) {
        try {
            const env = entree && entree.empreintes;
            if (!env) return echec('invalide');
            const voulu = attendu();
            if (!voulu || !env.modele || env.modele.id !== voulu.id || env.modele.sha256 !== voulu.sha256) return echec('modele-inconnu');
            if (env.rejet || !Array.isArray(env.entrees) || env.entrees.length === 0) return echec('invalide');
            const courant = etat.courante();
            if (!courant || !courant.index || !courant.meta || !courant.meta.modele || courant.meta.modele.id !== voulu.id || courant.meta.modele.sha256 !== voulu.sha256) return echec('indisponible');
            const e0 = env.entrees.reduce((a, b) => (b.photo < a.photo ? b : a));                // UN seul vecteur est jugé : la photo de plus petit index
            let trouve = null;
            const v = E.verifier(e0.vecteur, q => { trouve = courant.index.voisins(q, 10); return trouve.meilleur; });
            if (!v.ok || !trouve) return echec('invalide');
            const ligne = { top: trouve.top, essai: e0.redressee ? 1 : 0 };
            const ctx = courant.index.contexteG;
            const m = await mesurer({ ligne, ctx, entree, photo: e0.photo, scanId });
            if (!m.ok) return echec(m.code);
            return { ok: true, ligne, nEssais: 1, mesures: m.mesures, contexteG: ctx, seuils: G.SEUILS_G, photo: e0.photo, meilleurCosinus: v.meilleurCosinus };
        } catch { return echec('indisponible'); }
    };
}

module.exports = { lireEnveloppe, creerFournisseurEmpreinte, CODES, ENTREES_MAX, VECTEUR_MAX };
