// ============================================================================
// LA BASE DES BANCS — UNE SEULE PORTE, ÉCRITE PAR CE QU'ELLE AUTORISE
// ============================================================================
// Décision du testeur (2026-10-08) : « AUCUN banc ne doit plus jamais écrire dans la grappe de production. »
// `test_scratch` vit sur la grappe de PRODUCTION (MONGODB_URI) : elle a dépassé DEUX fois l'arrêt dur de 480 Mo le même jour, la place étant
// prise par des collections VIDES laissées par les outils du dépôt (lot FUITE-MAIN : `deleteMany` garde fichier et index). Le vidage en `drop`
// (verrou/bac.js) limite les dégâts ; ce module les SUPPRIME : un banc n'ouvre plus la production, il ouvre une base de banc ou il refuse.
//
// Une base de banc est, dans cet ordre, la SEULE de ces trois choses :
//   (a) une base mongodb-memory-server — si le paquet est installé (rien n'est installé par ce dépôt sans feu vert) ;
//   (b) MONGODB_TEST_URI (grappe de test dédiée) — SEULEMENT si son hôte n'est celui ni de MONGODB_URI ni de MONGODB_CARTES_URI ;
//   (c) sinon : REFUS de démarrer, « aucune base de test hors production ». JAMAIS de repli silencieux sur test_scratch de la production.
// 🔑 Une garde s'écrit par ce qu'elle autorise : un URI n'est accepté que si l'on a pu le LIRE, le COMPARER aux deux grappes de production, et
// qu'il n'en est aucune. Un doute (URI illisible, variable de production absente) est un refus. Aucun message ne contient de valeur de variable.

/** Hôtes d'une URI mongodb:// ou mongodb+srv:// (minuscules, sans port) ; [] si elle n'est pas lisible. */
function hotesDe(uri) {
    if (typeof uri !== 'string') return [];
    const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(uri.trim());
    if (!m) return [];
    const hotes = m[1].split(',').map(h => h.trim().toLowerCase().replace(/:\d+$/, '')).filter(Boolean);
    return hotes.some(h => !/^[a-z0-9.[\]:_-]+$/.test(h)) ? [] : hotes;
}

/** Identité de GRAPPE d'un hôte : un hôte Atlas (srv `cluster0.abcde.mongodb.net` ou shard `cluster0-shard-00-00.abcde.mongodb.net`) se compare
 *  par ses trois derniers labels (`abcde.mongodb.net`) ; tout autre hôte, tel quel. */
function cleDeGrappe(hote) {
    const l = hote.split('.');
    return hote.endsWith('.mongodb.net') && l.length >= 4 ? l.slice(-3).join('.') : hote;
}

/**
 * Cette URI peut-elle servir de base de banc ? { ok, raison }. `env` porte MONGODB_URI et MONGODB_CARTES_URI (les deux grappes de production).
 */
function jugerUri(uri, env = process.env) {
    const hotes = hotesDe(uri);
    if (!hotes.length) return { ok: false, raison: 'URI de banc illisible : je ne peux pas dire où elle pointe, refusé.' };
    const prod = [];
    for (const nom of ['MONGODB_URI', 'MONGODB_CARTES_URI']) {
        const h = hotesDe(env[nom]);
        if (!h.length) return { ok: false, raison: `${nom} absente ou illisible : je ne peux pas comparer à la production, refusé.` };
        prod.push(...h.map(cleDeGrappe));
    }
    if (hotes.some(h => prod.includes(cleDeGrappe(h)))) return { ok: false, raison: 'hôte = production : refusé (un banc n\'écrit jamais dans une grappe de production).' };
    return { ok: true, raison: null };
}

function memoireInstallee() {
    try { require.resolve('mongodb-memory-server'); return true; } catch (_) { return false; }
}

/**
 * Quelle base de banc, ou le refus. { ok, origine, uri?, raison? }. Pure : ne se connecte à rien.
 */
function resoudre(env = process.env, { memoireDisponible = memoireInstallee() } = {}) {
    const test = env.MONGODB_TEST_URI;
    if (test !== undefined && test !== '') {
        // une MONGODB_TEST_URI posée doit être saine, même si le paquet mémoire est là : une variable mal posée ne se contourne pas en silence
        const j = jugerUri(test, env);
        if (!j.ok) return { ok: false, origine: null, raison: `MONGODB_TEST_URI refusée — ${j.raison}` };
    }
    if (memoireDisponible) return { ok: true, origine: 'memoire' };
    if (test) return { ok: true, origine: 'MONGODB_TEST_URI', uri: test };
    return {
        ok: false, origine: null,
        raison: 'aucune base de test hors production : installer mongodb-memory-server, ou définir MONGODB_TEST_URI (une grappe de test DÉDIÉE, ' +
            'jamais MONGODB_URI ni MONGODB_CARTES_URI). Un banc ne se rabat pas sur test_scratch de la production.'
    };
}

/**
 * Ouvre la base du banc ou LÈVE (le banc ne démarre pas). Rend { origine, uri, arreter(), appliquer() }.
 * `appliquer()` : le processus (et ses enfants, qui héritent de l'environnement) ne voit plus que la base de banc —
 * MONGODB_URI devient la base de banc, MONGODB_CARTES_URI est retirée.
 */
async function ouvrirBanc({ env = process.env, memoireDisponible } = {}) {
    const r = resoudre(env, memoireDisponible === undefined ? undefined : { memoireDisponible });
    if (!r.ok) throw new Error(`🔴 BANC REFUSÉ — ${r.raison}`);
    let uri = r.uri, arreter = async () => { };
    if (r.origine === 'memoire') {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const ms = await MongoMemoryServer.create();
        uri = ms.getUri();
        arreter = () => ms.stop();
    }
    return {
        origine: r.origine, uri, arreter,
        appliquer() { env.MONGODB_URI = uri; delete env.MONGODB_CARTES_URI; env.BANC_ISOLE = '1'; }
    };
}

module.exports = { hotesDe, cleDeGrappe, jugerUri, resoudre, ouvrirBanc, memoireInstallee };
