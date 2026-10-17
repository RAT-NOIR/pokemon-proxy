// ============================================================
// RÉSILIENCE DU WORKER À UNE COUPURE DE LA BASE (demande du testeur, 2026-10-17)
// ============================================================
// « Une file vide n'est pas une panne… le worker ne passe jamais « Failed » sur Render pour ça. »
// 🔴 La cause MESURÉE n'était pas la file vide : c'était la base injoignable (14/10 17:11 UTC `MongoServerSelectionError … closed`,
// 16/10 11:08 UTC `… timed out`). L'erreur remontait au catch global de collecteur-images.js (`exit 1`), Render relançait, le démarrage
// échouait encore deux fois, et Render comptait 3 `server_failed` pour un processus qui n'avait rien de cassé.
//
// 🔑 LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : une liste FERMÉE de noms d'erreur du pilote. Tout le reste — un TypeError, une
// erreur de schéma, une erreur serveur — garde son comportement d'avant (journal + exit 1) : un vrai défaut doit rester visible sur Render.
// Noms vérifiés dans node_modules/mongodb/lib/error.js (MongoServerSelectionError, MongoNetworkError, MongoNetworkTimeoutError,
// MongoNotConnectedError) et node_modules/mongoose/lib/error/serverSelection.js (MongooseServerSelectionError).
// Le mode `--boucle` SEUL est enveloppé (collecteur-images.js) : un lancement manuel échoue comme avant.

const PASSAGERES = Object.freeze(new Set([
    'MongoServerSelectionError',
    'MongooseServerSelectionError',
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoNotConnectedError'
]));

/** Vrai SEULEMENT pour un objet dont le `name` est dans la liste fermée. */
function estPassagere(e) {
    return !!e && typeof e === 'object' && typeof e.name === 'string' && PASSAGERES.has(e.name);
}

const court = e => String(e?.message || e?.name || 'erreur inconnue').replace(/\s+/g, ' ').slice(0, 140);

/** Sommeil INTERROMPABLE : tranches d'une seconde au plus, l'arrêt demandé (SIGTERM/SIGINT) sort aussitôt. */
async function dormirInterrompu(ms, arret) {
    const fin = Date.now() + ms;
    while (!arret() && Date.now() < fin) await new Promise(r => setTimeout(r, Math.min(1000, Math.max(1, fin - Date.now()))));
}

/**
 * Exécute `executer` ; une erreur PASSAGÈRE (liste fermée) = alerte lisible, nettoyage, attente (30 s, ×2, plafond 5 min, sans limite de
 * durée), nouvel essai. Toute autre erreur est relancée telle quelle. Aucune sortie de processus ici : l'appelant garde son catch global.
 * `executer({ reussi })` appelle `reussi()` quand connexion et verrou sont acquis : le délai repart alors de son minimum.
 */
async function superviser({ executer, nettoyer = async () => { }, journal = console, attendre = dormirInterrompu, arret = () => false, delaiInitialMs = 30000, plafondMs = 300000 }) {
    let delai = delaiInitialMs;
    while (!arret()) {
        try { await executer({ reussi: () => { delai = delaiInitialMs; } }); return; }
        catch (e) {
            if (!estPassagere(e)) throw e;
            try { await nettoyer(); } catch (n) { journal.warn?.(`⚠️ nettoyage après coupure incomplet : ${court(n)}`); }
            if (arret()) return;
            journal.error(`🔴 base injoignable : ${court(e)} — nouvel essai dans ${Math.round(delai / 1000)} s`);
            await attendre(delai, arret);
            delai = Math.min(delai * 2, plafondMs);
        }
    }
}

/**
 * En tête de tour : le verrou global est-il à nous ? Rend 'ok' | 'perdu' | 'arret' ; LÈVE l'erreur passagère si la revérification a échoué
 * PARCE QUE la base est injoignable (ce n'est pas un autre détenteur : superviser reprendra le verrou comme au réveil d'un sommeil).
 * 'perdu' = vraie perte (0 document touché, ou verrou jamais repris) : comportement d'avant.
 */
async function garantirVerrou({ verrou: v, reprendre }) {
    const verrou = () => (typeof v === 'function' ? v() : v);   // objet, ou getter (l'appelant recrée son verrou en le reprenant)
    if (!verrou().tenu && !verrou().perdu) { if (!await reprendre()) return 'arret'; }
    if (await verrou().tient()) return 'ok';
    const e = verrou().derniereErreur;
    if (!verrou().perdu && estPassagere(e)) throw e;
    return 'perdu';
}

module.exports = { estPassagere, superviser, garantirVerrou, dormirInterrompu, PASSAGERES };
