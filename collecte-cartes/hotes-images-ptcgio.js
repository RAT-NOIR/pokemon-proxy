// ============================================================
// LES DEUX HÔTES D'IMAGES PERMIS — la garde « jamais d'API » s'écrit par ce qu'elle AUTORISE (2026-10-17)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « images.scrydex.com est OUVERT […] aux mêmes conditions que pokemontcg.io : serveur d'images seulement,
// jamais d'API » et « une garde qui fait échouer tout code appelant l'API pokemontcg.io ou Scrydex (seuls les hôtes d'images sont permis) ».
// Cette liste est LA définition : le client (ptcgio.js), la règle de langue (langue-visuel.js) et le banc statique (garde-jamais-api.js) la lisent,
// aucun ne la recopie (§21 bis). Tout ce qui n'y figure pas — l'API de l'un, celle de l'autre, un sous-domaine, un hôte déguisé — est REFUSÉ.
const HOTES_IMAGES = Object.freeze(['images.pokemontcg.io', 'images.scrydex.com']);

/** Le nom d'hôte d'une adresse si et seulement si c'est l'un des deux hôtes d'images, en https, sans identifiants ni port ; sinon null. */
function hoteDeLUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return HOTES_IMAGES.includes(u.hostname) ? u.hostname : null;
}

module.exports = { HOTES_IMAGES, hoteDeLUrl };
