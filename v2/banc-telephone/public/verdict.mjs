// BANC TELEPHONE — les règles de JUGEMENT de la page, en fonctions PURES (aucun DOM, aucun réseau) : le banc du dépôt les rejoue sous node (test-banc-telephone.js).
// Écrites par ce qu'elles AUTORISENT : un verdict IDENTIQUE ou ÉCART n'existe que si TOUT ce qui le fonde est établi ; tout le reste est ERREUR avec sa cause (jamais « ÉCART — »).
export const SEUIL_IDENTIQUE = 0.9999;      // cos min de la chaîne complète pour dire « IDENTIQUE »
export const GARDE_EXTENSION = 0.998;       // la garde de l'extension (moteur-ort.js COSINUS_MIN)
export const N_CARTES = 30, N_REF = 256, N_PIXELS = 224 * 224 * 3, N_DEC = 420 * 587 * 3;      // N_DEC : la carte redressée du lot, décodée par PIL (champ `dec`)

/** Le lot est-il COMPLET et bien formé ? Rend la cause (texte) ou null. `lot` : { cartes: [{ refV: Float32Array(256), pxV?: Uint8Array(150528) }] } (après décodage par la page). */
export function jugerLot(lot, attendu = N_CARTES) {
    if (!lot || !Array.isArray(lot.cartes) || lot.cartes.length === 0) return 'lot-vide';
    if (lot.cartes.length !== attendu) return `lot-incomplet:${lot.cartes.length}/${attendu}`;
    for (const c of lot.cartes) {
        if (!c || !c.refV || c.refV.length !== N_REF) return 'reference-mal-formee';
        if (c.pxV !== undefined && (!c.pxV || c.pxV.length !== N_PIXELS)) return 'pixels-mal-formes';
        if (c.decV !== undefined && (!c.decV || c.decV.length !== N_DEC)) return 'decodage-mal-forme';
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

// ── iOS / iPadOS : WebGPU y fait tuer l'onglet (mesuré : RAPPORT-BANC-IOS.md). Les règles sont écrites par ce qu'elles AUTORISENT.
export const TEXTE_WEBGPU_IOS = 'WebGPU désactivé sur iOS (plantage mémoire) : WASM utilisé';
export const TEXTE_WEBGPU_FORCE = 'WebGPU forcé sur iOS (diagnostic) : plantage mémoire possible';

/**
 * L'appareil est-il un iPhone, un iPad ou un iPod ? { ios, raison }.
 *  · l'agent utilisateur nomme iPhone, iPad ou iPod ⇒ iOS ;
 *  · l'iPad en MODE BUREAU se présente comme un Mac (agent « Macintosh ») : `platform === 'MacIntel'` avec plus d'un point tactile ⇒ iOS (un Mac n'a pas d'écran tactile) ;
 *  · tout ce qui est ILLISIBLE (agent absent ou non textuel) : la garde ne peut pas conclure, elle BLOQUE WebGPU et le dit (« indetermine ») ;
 *  · le reste n'est pas iOS.
 */
export function detecterIOS({ ua, platform, maxTouchPoints } = {}) {
    if (typeof ua !== 'string' || ua.trim() === '') return { ios: true, raison: 'indetermine' };
    if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return { ios: true, raison: 'iphone-ipad-ipod' };
    if (platform === 'MacIntel' && Number.isInteger(maxTouchPoints) && maxTouchPoints > 1) return { ios: true, raison: 'ipad-bureau' };
    return { ios: false, raison: 'non' };
}

/** `?webgpu=forcer` : la SEULE valeur qui rouvre WebGPU sur iOS (diagnostic du coordinateur). */
export function webgpuForce(search) {
    if (typeof search !== 'string') return false;
    try { return new URLSearchParams(search).get('webgpu') === 'forcer'; } catch { return false; }
}

/** Le moteur qu'on lancera : { moteur, desactive, forcee, texte }. Seul 'webgpu' est discuté ; tout autre mot donne WASM. */
export function choisirMoteur({ demande, ios, forcer }) {
    if (demande !== 'webgpu') return { moteur: 'wasm', desactive: false, forcee: false, texte: null };
    if (!ios) return { moteur: 'webgpu', desactive: false, forcee: false, texte: null };
    if (forcer) return { moteur: 'webgpu', desactive: false, forcee: true, texte: TEXTE_WEBGPU_FORCE };
    return { moteur: 'wasm', desactive: true, forcee: false, texte: TEXTE_WEBGPU_IOS };
}

/** `?session=arena0,pattern0` : des options de SESSION WASM pour mesurer le pic mémoire (liste fermée ; rien n'est lu hors d'elle). Sans paramètre : aucune, la session est celle de l'extension. */
const OPTIONS_SESSION = Object.freeze({ arena0: { enableCpuMemArena: false }, pattern0: { enableMemPattern: false } });
export function optionsSession(search) {
    const r = { options: {}, retenues: [], ignorees: [] };
    let brut = null; try { brut = typeof search === 'string' ? new URLSearchParams(search).get('session') : null; } catch { brut = null; }
    for (const mot of String(brut || '').split(',').map(x => x.trim()).filter(Boolean)) {
        if (Object.prototype.hasOwnProperty.call(OPTIONS_SESSION, mot)) { if (!r.retenues.includes(mot)) { r.retenues.push(mot); Object.assign(r.options, OPTIONS_SESSION[mot]); } } else r.ignorees.push(mot.slice(0, 40));
    }
    return r;
}

/** Rend les octets du modèle au système sans attendre le ramasse-miettes : ArrayBuffer.prototype.transfer(0) détache le tampon. Sans la méthode, sans tampon ou si elle lève : rien (le ramasse-miettes s'en charge) ; ne lève jamais. */
export function libererOctets(u8) {
    try { if (u8 && u8.buffer && typeof u8.buffer.transfer === 'function') u8.buffer.transfer(0); } catch { /* déjà détaché ou non détachable */ }
}

// ── le diagnostic des pixels : d'où vient l'écart entre « modèle seul » et « chaîne complète » ? Un navigateur diffère d'un autre par le DÉCODAGE du JPEG (et sa couleur), jamais par le redimensionnement (JS déterministe).
/** Écart octet à octet de deux tableaux de même longueur : { n, max, somme, nDiff, moy, pctDiff } ; null si l'un manque, est vide, ou de longueur différente (jamais « 0 écart » faute de mesure). */
export function statsPixels(a, b) {
    if (!a || !b || !ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.length === 0 || a.length !== b.length) return null;
    let max = 0, somme = 0, nDiff = 0;
    for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { nDiff++; somme += d; if (d > max) max = d; } }
    const n = a.length, r6 = x => Math.round(x * 1e6) / 1e6;
    return { n, max, somme, nDiff, moy: r6(somme / n), pctDiff: r6(100 * nDiff / n) };
}
/** Fusion exacte (sommes entières) de plusieurs séries ; null dès qu'une manque. */
export function fusionnerStats(liste) {
    if (!Array.isArray(liste) || liste.length === 0 || liste.some(s => !s)) return null;
    const n = liste.reduce((t, s) => t + s.n, 0), somme = liste.reduce((t, s) => t + s.somme, 0), nDiff = liste.reduce((t, s) => t + s.nDiff, 0), r6 = x => Math.round(x * 1e6) / 1e6;
    return { n, max: Math.max(...liste.map(s => s.max)), somme, nDiff, moy: r6(somme / n), pctDiff: r6(100 * nDiff / n) };
}
/**
 * La cause de l'écart, par ce que les trois mesures établissent :
 *  decodage : pixels décodés par le navigateur contre ceux de PIL (pleine taille) · redimensionnement : redimPIL(décodage de PIL) contre les 224 de PIL (le plancher du redimensionnement, indépendant du navigateur)
 *  · chaine : redimPIL(décodage du navigateur) contre les 224 de PIL.
 * « decodeur » : le décodage diffère déjà · « autre-etape » : le décodage est identique mais la chaîne est pire que le plancher (couleur, canal alpha, bitmap) · « aucune » · « indetermine » dès qu'une mesure manque.
 */
export function causeEcart(d) {
    if (!d || !d.decodage || !d.redimensionnement || !d.chaine) return 'indetermine';
    if (d.decodage.max > 0) return 'decodeur';
    if (d.chaine.max <= d.redimensionnement.max) return 'aucune';
    // la chaîne dépasse le plancher alors que le décodage est identique : « autre-etape » n'est établi que si le décodage a été jugé sur TOUTES les cartes de la chaîne ; sinon le décodeur peut différer sur les autres
    return Number.isInteger(d.cartesDecodage) && Number.isInteger(d.cartesChaine) && d.cartesDecodage < d.cartesChaine ? 'non-etablie' : 'autre-etape';
}
/** Assemble le document déposé à partir des listes de statistiques par carte. */
export function assemblerDiagnostic({ decodage, redimensionnement, chaine, bitmapSansConversion, bitmapAvecConversion, couleurCanvas }) {
    const f = l => (Array.isArray(l) && l.length ? fusionnerStats(l) : null);
    const d = { decodage: f(decodage), redimensionnement: f(redimensionnement), chaine: f(chaine) };
    const cartesDecodage = Array.isArray(decodage) ? decodage.length : 0, cartesChaine = Array.isArray(chaine) ? chaine.length : 0;
    return { cause: causeEcart({ ...d, cartesDecodage, cartesChaine }), cartesDecodage, cartesChaine, ...d,
        bitmapSansConversion: f(bitmapSansConversion), bitmapAvecConversion: f(bitmapAvecConversion), couleurCanvas: typeof couleurCanvas === 'string' ? couleurCanvas : null };
}
const NOMS_CAUSE = { decodeur: 'décodeur du navigateur', 'autre-etape': 'autre étape (couleur, canal alpha, bitmap)', aucune: 'aucune (pixels identiques au plancher)', 'non-etablie': 'non établie (décodage jugé sur moins de cartes que la chaîne)', indetermine: 'indéterminée' };
const fmt = s => (s ? `max ${s.max} · moy ${String(s.moy).replace('.', ',')}` : 'non mesuré');
/** L'UNE ligne de diagnostic affichée à l'écran. */
export function texteDiagnostic(d) {
    if (!d) return 'diagnostic des pixels : non mesuré';
    return `diagnostic des pixels : cause ${NOMS_CAUSE[d.cause] || d.cause} · décodage navigateur contre PIL (${d.cartesDecodage} cartes) ${fmt(d.decodage)} · redimensionnement de référence ${fmt(d.redimensionnement)} · chaîne complète (${d.cartesChaine} cartes) ${fmt(d.chaine)}`;
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
