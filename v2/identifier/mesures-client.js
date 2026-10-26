'use strict';
// CALCUL-CLIENT (2026-10-26, décision de l'éditeur) — les mesures d'image de la règle G calculées PAR LE CLIENT (extension, scanner du site), et ce que le serveur en fait.
// Contrat : DEMANDE-SERVEUR-EXTENSION.md, entrée « API — 26/10 (nuit) : CONTRAT « CALCUL CLIENT » ». Le serveur ne calcule plus aucun pixel : il dit QUELLES mesures il lui faut, il vérifie ce qu'il reçoit, il décide.
//   · ensembleFerme : la règle G demande ses mesures UNE PAR UNE, selon les résultats des précédentes (le gagnant d'une paire devient le candidat suivant). Le client ne peut pas rejouer ce chemin
//     (il n'a ni le contexte ni la règle) : on lui demande TOUT ce que G pourrait lire pour cette ligne — chaque paire ORDONNÉE entre le premier voisin et ses concurrents retenus (G n'en regarde que 4),
//     et la zone clé de chaque visuel que G pourrait retenir, si (et seulement si) G la jugerait pour lui. Au-delà de MESURES_MAX : pas de complément (null), la règle se tait comme aujourd'hui au-delà de son budget ;
//   · le jeton : HMAC sur (scan, échéance, liste EXACTE des mesures, sha256 des références), avec le secret d'empreinte du serveur sous un libellé propre (séparation des usages) ;
//   · validerResultats : écrite par ce qu'elle AUTORISE — la forme exacte de la demande, des nombres finis dans leurs bornes, et la cohérence que le serveur sait vérifier sans pixel ;
//   · deciderAvecResultats : G sur ces mesures, rien d'autre ; une mesure absente rend « muette », jamais une exception.
// Ne lève jamais : un doute rend null ou un code fermé.
const crypto = require('crypto');
const G = require('../../ratmarket/decision-g');

const MESURES_MAX = 12, CONCURRENTS_MAX = 4, TOL_COUVERTURE = 1e-4, INLIERS_MAX = 300;
const ZONES = Object.freeze(['haut', 'illustration', 'bandeau', 'texte', 'bas']);
const CLES_ZONES = Object.freeze(['type', 'ref', ...ZONES, 'inliers']);
const CLES_PAIRE = Object.freeze(['type', 'a', 'b', 'ecart', 'couverture']);
const LIBELLE = 'rat-market/mesures-client/v1';

const croise = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const unique = arr => [...new Set(arr)];

/**
 * @param ctx    G.contexte(...)        @param ligne { top: [[cle, similarite] × ≤ 10], essai }
 * @returns {{mesures: Array<{type:'paire',a,b}|{type:'zones',ref}>, refs: string[]} | null}  null : ligne illisible, ou plus de `max` mesures
 */
function ensembleFerme(ctx, ligne, { seuils: S = G.SEUILS_G, max = MESURES_MAX } = {}) {
    try {
        if (!ctx || !ctx.groupe || !ligne || !Array.isArray(ligne.top) || ligne.top.length === 0) return null;
        const top = ligne.top;
        if (!top.every(x => Array.isArray(x) && typeof x[0] === 'string' && Number.isFinite(x[1]))) return null;
        const [k1, s1] = top[0];
        const cartes = k => ctx.carte.get(k) || new Set();
        const g1 = ctx.groupe.has(k1) ? ctx.groupe.get(k1) : undefined;
        // les concurrents, EXACTEMENT comme decision-g.js les choisit
        const conc = top.slice(1).filter(([k, s]) => (g1 !== undefined && ctx.groupe.get(k) === g1) || s1 - s < S.delta).map(([k]) => k);
        if (!conc.length) {
            const autre = top.slice(1).find(([k]) => !croise(cartes(k), cartes(k1)));
            if ((autre ? s1 - autre[1] : 1.0) < S.marge_carte) return { mesures: [], refs: [] };     // G refuse avant toute mesure
        }
        const retenus = unique([k1, ...conc.slice(0, CONCURRENTS_MAX)]);
        const mesures = [];
        if (conc.length) for (const a of retenus) for (const b of retenus) if (a !== b) mesures.push({ type: 'paire', a, b });
        // la zone clé de chaque visuel que G peut retenir, si G la jugerait pour lui (mêmes conditions que decision-g.js)
        if (S.tau_bas !== null && S.tau_bas !== undefined) {
            const modeJumeaux = (S.zone_cle_si || 'toujours') === 'jumeaux';
            const vraisDuPremier = conc.filter(k => g1 !== undefined && ctx.groupe.get(k) === g1);
            for (const v of retenus) {
                let juge = true;
                if (modeJumeaux) {
                    const gv = ctx.groupe.has(v) ? ctx.groupe.get(v) : undefined;
                    const freres = gv !== undefined ? (ctx.membres.get(gv) || []).filter(k => k !== v) : [];
                    const inv = [...cartes(v), ...freres.flatMap(k => [...cartes(k)])].flatMap(c => ctx.invisibles.get(c) || []);
                    juge = vraisDuPremier.length > 0 || freres.length > 0 || inv.length > 0;
                }
                if (juge) mesures.push({ type: 'zones', ref: v });
            }
        }
        if (mesures.length > max) return null;
        const refs = retenus.filter(k => mesures.some(m => m.ref === k || m.a === k || m.b === k));
        return { mesures, refs };
    } catch { return null; }
}

const charge = ({ scanId, exp, mesures, refs }) => `${LIBELLE}|${scanId}|${exp}|${JSON.stringify(mesures.map(m => (m.type === 'paire' ? ['p', m.a, m.b] : ['z', m.ref])))}|${JSON.stringify(refs.map(r => [r.ref, r.sha256]))}`;
const signature = (secret, texte) => crypto.createHmac('sha256', `${LIBELLE}|${secret}`).update(texte).digest('base64url');

/** Le jeton : `<échéance en ms>.<HMAC base64url>` — ni le scan ni la liste en clair (le serveur les garde de son côté). */
function signerJeton({ scanId, mesures, refs, exp }, secret) {
    if (typeof secret !== 'string' || secret.length < 16) throw new Error('mesures-client : secret absent ou trop court');
    return `${exp}.${signature(secret, charge({ scanId: String(scanId), exp, mesures, refs }))}`;
}
function verifierJeton(jeton, { scanId, mesures, refs, maintenant = Date.now() }, secret) {
    try {
        if (typeof jeton !== 'string' || jeton.length > 200 || typeof secret !== 'string' || secret.length < 16) return false;
        const i = jeton.indexOf('.');
        if (i <= 0) return false;
        const expTexte = jeton.slice(0, i);
        if (!/^[0-9]{1,16}$/.test(expTexte)) return false;
        const exp = Number(expTexte);
        if (!(maintenant <= exp)) return false;
        const attendu = Buffer.from(signature(secret, charge({ scanId: String(scanId), exp, mesures, refs })));
        const recu = Buffer.from(jeton.slice(i + 1));
        return recu.length === attendu.length && crypto.timingSafeEqual(recu, attendu);
    } catch { return false; }
}

const nombre = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const memesCles = (o, cles) => { const k = Object.keys(o); return k.length === cles.length && cles.every(c => Object.prototype.hasOwnProperty.call(o, c)); };

/**
 * @param demande   les mesures demandées (ensembleFerme().mesures), dans l'ordre
 * @param resultats ce que le client envoie
 * @param couvertures { 'a|b': couverture } que le serveur CONNAÎT (elle ne dépend que des deux références) ; absente : non vérifiée ici (contrôle par échantillon)
 * @returns {{ok:true} | {ok:false, code:'forme'|'valeur'|'coherence'}}
 */
function validerResultats(demande, resultats, { couvertures = null } = {}) {
    if (!Array.isArray(demande) || !Array.isArray(resultats) || resultats.length !== demande.length) return { ok: false, code: 'forme' };
    for (let i = 0; i < demande.length; i++) {
        const d = demande[i], r = resultats[i];
        if (r === null || typeof r !== 'object' || Array.isArray(r) || r.type !== d.type) return { ok: false, code: 'forme' };
        if (d.type === 'zones') {
            if (!memesCles(r, CLES_ZONES) || r.ref !== d.ref) return { ok: false, code: 'forme' };
            if (!ZONES.every(z => nombre(r[z], -1, 1)) || !Number.isInteger(r.inliers) || r.inliers < 0 || r.inliers > INLIERS_MAX) return { ok: false, code: 'valeur' };
        } else if (d.type === 'paire') {
            if (!memesCles(r, CLES_PAIRE) || r.a !== d.a || r.b !== d.b) return { ok: false, code: 'forme' };
            if (!nombre(r.ecart, -2, 2) || !nombre(r.couverture, 0, 1)) return { ok: false, code: 'valeur' };
            if (r.couverture === 0 && r.ecart !== 0) return { ok: false, code: 'coherence' };
            const connue = couvertures && Object.prototype.hasOwnProperty.call(couvertures, `${d.a}|${d.b}`) ? couvertures[`${d.a}|${d.b}`] : undefined;
            if (connue !== undefined && !(Math.abs(connue - r.couverture) <= TOL_COUVERTURE)) return { ok: false, code: 'coherence' };
        } else return { ok: false, code: 'forme' };
    }
    return { ok: true };
}

const ABSENTE = new Error('mesure absente');
/** G sur les résultats du client (déjà validés) : { ok:true, decision } | { ok:false, code:'muette' }. */
function deciderAvecResultats(ctx, ligne, demande, resultats, S = G.SEUILS_G) {
    try {
        const paires = new Map(), zones = new Map();
        demande.forEach((d, i) => { const r = resultats[i]; if (d.type === 'paire') paires.set(`${d.a}|${d.b}`, [r.ecart, r.couverture]); else zones.set(d.ref, r); });
        const mesures = {
            comparerPaire: (a, b) => { const r = paires.get(`${a}|${b}`); if (!r) throw ABSENTE; return r; },
            scoresZones: c => { const r = zones.get(c); if (!r) throw ABSENTE; return r; }
        };
        return { ok: true, decision: G.decider(ctx, ligne, 1, mesures, S) };
    } catch { return { ok: false, code: 'muette' }; }
}

module.exports = { ensembleFerme, signerJeton, verifierJeton, validerResultats, deciderAvecResultats, MESURES_MAX, CONCURRENTS_MAX, TOL_COUVERTURE, ZONES };
