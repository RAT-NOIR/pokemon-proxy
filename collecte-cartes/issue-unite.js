// ============================================================
// CE QUE LE WORKER FAIT D'UNE UNITÉ FINIE — fait, attente, ou refus (2026-09-24)
// ============================================================
// 🔴 LOR et CRE sont sortis `refuse` pour 2 et 3 réponses 503 du CDN TCGdex (initial + réessai 5 s plus tard, chaque
// fois). Le client avait sa cadence et son réessai borné (§38) ; la REPRISE existait aussi — une image portant sha256
// et la même URL ne se retélécharge pas —, mais aucun chemin ne relançait l'unité : `incomplet` tombait en `refuse`,
// un état terminal, comme un verdict sur le set. C'est le §17 (« un set interrompu retourne en attente, jamais en
// refuse ») pour une autre cause passagère.
// 🔑 LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : ne revient en file qu'une unité dont TOUS les échecs sont transitoires
// (5xx, coupure réseau), EN QUEUE et pas avant 10 min — une surcharge a le temps de passer —, bornée à
// TENTATIVES_MAX passages. Au-delà, elle refuse, et le nombre de passages est écrit : une panne longue reste VISIBLE (§29).
const TENTATIVES_MAX = 3;
const DELAI_REPRISE_MS = 10 * 60 * 1000;
const ARRETS = /^(interrompu|refuse-verrou|refuse-texte-en-cours)$/;   // pas un verdict : on rend l'unité et on s'arrête

/** Un échec de téléchargement est transitoire s'il vient du serveur (5xx) ou du réseau — et de rien d'autre.
 *  Le message a la forme du client TCGdex, « <status ou code> <url> » : c'est aussi ce que la ligne `images` garde
 *  (`erreur`), sans le status — la même règle lit donc l'échec vivant et l'échec écrit. */
// ➕ 2026-09-26 (nuit, relecture) : 429 (« trop de requêtes » : une limite de débit porte sur le client, pas sur l'impression), ENOTFOUND
// (résolution DNS ratée) et ERR_NETWORK (coupure vue par axios) — des causes passagères qu'on rangeait en verdict définitif.
function echecTransitoire(err) {
    if ((err?.status >= 500 && err.status <= 599) || err?.status === 429) return true;
    return /^(5\d\d|429|ECONNRESET|ETIMEDOUT|ECONNABORTED|EAI_AGAIN|ECONNREFUSED|EPIPE|ENOTFOUND|ERR_NETWORK)\b/.test(String(err?.message ?? ''));
}

/** @returns {{etat: 'fait'|'attente'|'refuse', arreter: boolean, enQueue?: true, tentatives?: number, pasAvant?: Date}} */
function issueDeLUnite(bilan, unite, maintenant = new Date()) {
    if (bilan?.etat === 'verifie') return { etat: 'fait', arreter: false };
    if (ARRETS.test(bilan?.etat)) return { etat: 'attente', arreter: true };
    if (bilan?.etat === 'incomplet-transitoire') {
        const tentatives = (unite?.tentatives || 0) + 1;
        if (tentatives < TENTATIVES_MAX) return { etat: 'attente', arreter: false, enQueue: true, tentatives, pasAvant: new Date(maintenant.getTime() + DELAI_REPRISE_MS) };
        return { etat: 'refuse', arreter: false, tentatives };
    }
    return { etat: 'refuse', arreter: false };
}

module.exports = { issueDeLUnite, echecTransitoire, TENTATIVES_MAX, DELAI_REPRISE_MS };
