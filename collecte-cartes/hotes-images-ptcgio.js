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

// ➕ 2026-10-17 (SCRYDEX-DECKS) — LE DOS DE CARTE : pour une adresse qu'il ne connaît pas, le serveur d'images d'images.scrydex.com répond HTTP 200 avec le DOS d'une carte Pokémon
// (image, 640×892, 186 316 octets), pas un 404 — six adresses sondées, un seul fichier. Ce n'est pas une carte : un trou ne doit JAMAIS le recevoir. Liste FERMÉE d'empreintes sha256 ;
// le client le traite comme un 404 (null), la sonde le note « dos-de-carte ». Banc : fixtures/dos-de-carte-serveur-images.png (copie du fichier réel).
const EMPREINTES_DOS_DE_CARTE = Object.freeze(['fd7c3800f9b8ebadf4b31a735f569a180e66201741b00fafa17879967884ad2c']);
function estDosDeCarte(octets) {
    if (!Buffer.isBuffer(octets) || !octets.length) return false;
    return EMPREINTES_DOS_DE_CARTE.includes(require('crypto').createHash('sha256').update(octets).digest('hex'));
}

module.exports = { HOTES_IMAGES, hoteDeLUrl, EMPREINTES_DOS_DE_CARTE, estDosDeCarte };
