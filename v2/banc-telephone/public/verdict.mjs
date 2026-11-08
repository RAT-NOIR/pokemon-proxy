// BANC TELEPHONE — les règles de JUGEMENT de la page, en fonctions PURES (aucun DOM, aucun réseau) : le banc du dépôt les rejoue sous node (test-banc-telephone.js).
// Écrites par ce qu'elles AUTORISENT : un verdict IDENTIQUE ou ÉCART n'existe que si TOUT ce qui le fonde est établi ; tout le reste est ERREUR avec sa cause (jamais « ÉCART — »).
export const SEUIL_IDENTIQUE = 0.9999;      // cos min de la chaîne complète pour dire « IDENTIQUE »
export const GARDE_EXTENSION = 0.998;       // la garde de l'extension (moteur-ort.js COSINUS_MIN)
export const N_CARTES = 30, N_REF = 256, N_PIXELS = 224 * 224 * 3;

/** Le lot est-il COMPLET et bien formé ? Rend la cause (texte) ou null. `lot` : { cartes: [{ refV: Float32Array(256), pxV?: Uint8Array(150528) }] } (après décodage par la page). */
export function jugerLot(lot, attendu = N_CARTES) {
    if (!lot || !Array.isArray(lot.cartes) || lot.cartes.length === 0) return 'lot-vide';
    if (lot.cartes.length !== attendu) return `lot-incomplet:${lot.cartes.length}/${attendu}`;
    for (const c of lot.cartes) {
        if (!c || !c.refV || c.refV.length !== N_REF) return 'reference-mal-formee';
        if (c.pxV !== undefined && (!c.pxV || c.pxV.length !== N_PIXELS)) return 'pixels-mal-formes';
        for (let i = 0; i < c.refV.length; i++) if (!Number.isFinite(c.refV[i])) return 'reference-non-finie';
    }
    return null;
}

/**
 * Le verdict d'une mesure. `m` : { nEmpreintes, nVecteursRefuses, cos: number[], cosModeleSeul: number[], shaVerifie }.
 * @returns {{ verdict: 'IDENTIQUE'|'ECART'|'ERREUR', erreur: string|null }}
 */
export function jugerMesure(m, attendu = N_CARTES) {
    if (!m || m.shaVerifie !== true) return { verdict: 'ERREUR', erreur: 'sha256 non verifiable : le modele n\'est pas prouve (aucun verdict)' };
    if (!Array.isArray(m.cos) || m.cos.length === 0) return { verdict: 'ERREUR', erreur: 'aucune empreinte mesuree' };
    if (m.nEmpreintes < attendu || m.cos.length < attendu) return { verdict: 'ERREUR', erreur: `empreintes incompletes : ${m.cos.length}/${attendu}` };
    if (!m.cos.every(Number.isFinite)) return { verdict: 'ERREUR', erreur: 'cosinus non fini' };
    if (Array.isArray(m.cosModeleSeul) && !m.cosModeleSeul.every(Number.isFinite)) return { verdict: 'ERREUR', erreur: 'cosinus modele seul non fini' };
    const min = Math.min(...m.cos);
    return { verdict: min >= SEUIL_IDENTIQUE && !m.nVecteursRefuses ? 'IDENTIQUE' : 'ECART', erreur: null };
}

/** M8 — la garde de l'extension : un cosinus (WebGPU contre WASM ; pour WASM, contre la référence native) doit être >= 0,998. */
export function gardeExtension(cos) {
    if (typeof cos !== 'number' || !Number.isFinite(cos)) return 'NON_EVALUEE';
    return cos >= GARDE_EXTENSION ? 'PASSE' : 'ECHOUE';
}
export const texteGarde = g => (g === 'PASSE' ? 'PASSE' : g === 'ECHOUE' ? 'ÉCHOUE' : 'non évaluée');

/** m3 — l'écart entre « modèle seul » et « chaîne complète » : ce que le décodeur et le redimensionnement du navigateur coûtent. null si l'un manque. */
export function ecartChaine(cosMin, cosMinModeleSeul) {
    return Number.isFinite(cosMin) && Number.isFinite(cosMinModeleSeul) ? cosMinModeleSeul - cosMin : null;
}

/** M7 — « webgpu » n'est dit que si le périphérique GPU existe : `device` est ce que rend ort.env.webgpu.device (déjà résolu). */
export function moteurRealise(demande, device) {
    if (demande !== 'webgpu') return { moteur: demande, utilise: true, texte: null };
    if (device) return { moteur: 'webgpu', utilise: true, texte: null };
    return { moteur: 'wasm', utilise: false, texte: 'WebGPU non utilisé (repli WASM)' };
}

/** m1 — le texte d'erreur porte l'ÉTAPE en cours : « creation-session-wasm:RuntimeError » ; jamais le message d'une exception du navigateur. */
export function texteErreur(etape, e) {
    const cause = e && (typeof e.detail === 'string' ? e.detail : e.name) || 'erreur';
    return `${etape}:${cause}`.replace(/[^\x20-\x7E]/g, '?').slice(0, 200);
}

/** M9 — après un TypeError du fetch : la sonde « no-cors » (réponse opaque) a-t-elle abouti ? Oui : le réseau et la CSP laissent passer, c'est le CORS qui manque. */
/** Sous COEP (page isolée) une réponse opaque sans CORP est refusée aussi : une sonde en échec n'y sépare plus rien (« indetermine-isole » : rejouer avec ?iso=0). */
export function classerBlocage(sondeNoCorsAboutie, isole = false) {
    if (sondeNoCorsAboutie) return 'cors-manquant';
    return isole ? 'indetermine-isole' : 'reseau-ou-csp';
}
/** L'hôte final d'une réponse (après redirection) : « host » seul, borné ; null si illisible. */
export function hoteFinal(url) {
    try { return new URL(url).host.slice(0, 80); } catch { return null; }
}
