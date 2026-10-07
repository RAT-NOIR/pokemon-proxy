// ============================================================
// LA REQUÊTE CONDITIONNELLE DES IMPORTS QUOTIDIENS — le même fichier ne se retélécharge pas
// ============================================================
// 🔑 LA DEMANDE (testeur, 2026-10-08) : « si l'export du jour a la même date que la veille, aucun téléchargement ne doit avoir lieu ».
// La date (`createdAt`) est DANS le fichier : la lire coûtait le téléchargement entier. Les fichiers de Cardmarket sont servis par S3,
// qui rend un ETag et un Last-Modified, et répond 304 SANS CORPS à une requête qui les cite quand l'objet n'a pas changé.
// · les validateurs se GARDENT seulement quand le fichier a été entièrement traité — importé, ou jugé « rien de neuf » : un fichier
//   refusé ou un import arrêté en route ne laisse pas les siens, sinon le lendemain rendrait 304 sur un fichier jamais importé ;
// · un serveur qui ignore la condition rend 200 : le script retombe sur le jugement de `createdAt`, comme avant (rien n'est perdu).
// Une seule définition, pour les deux imports (§21 bis).

/** Les en-têtes de la requête, depuis les validateurs gardés (`meta.http`) — {} sans validateur : requête ordinaire. */
function entetesConditionnels(http) {
    const h = {};
    if (typeof http?.etag === 'string' && http.etag) h['If-None-Match'] = http.etag;
    if (typeof http?.lastModified === 'string' && http.lastModified) h['If-Modified-Since'] = http.lastModified;
    return h;
}

/** Les validateurs d'une réponse (en-têtes axios, noms en minuscules) — null si le serveur n'en donne aucun. */
function validateursDe(entetes) {
    const etag = typeof entetes?.etag === 'string' && entetes.etag ? entetes.etag : null;
    const lastModified = typeof entetes?.['last-modified'] === 'string' && entetes['last-modified'] ? entetes['last-modified'] : null;
    return etag || lastModified ? { etag, lastModified } : null;
}

/** Statuts acceptés par axios : 2xx et 304 (« pas modifié ») ; tout le reste lève, comme avant. */
const statutAccepte = s => (s >= 200 && s < 300) || s === 304;

module.exports = { entetesConditionnels, validateursDe, statutAccepte };
