// ============================================================================
// L'ENVIRONNEMENT DU VERROU, JUGÉ AVANT TOUTE CONNEXION ET TOUT SERVEUR FILS — écrit par ce qu'il AUTORISE
// ============================================================================
// verrou-avant-push.js ouvre test_scratch par `MONGODB_URI` et lance un serveur qui HÉRITE de l'environnement. Tout y est sûr SI `banc.appliquer()` a remplacé
// chaque variable MONGODB_*URI par l'URI du banc — mais le fichier ne le constatait pas : un appliquer() oublié ou incomplet aurait fait écrire (tranche,
// comptes, journal, deleteMany) sur la grappe de PRODUCTION, sans une ligne d'alerte. Ce module est la constatation, sans dépendance, pure.
// 🔑 Le contrôle porte sur ce que le cas redouté n'a PAS : un hôte qui est celui du banc (BANC_HOTES, posé par appliquer()). Il ne se confirme pas lui-même :
// une URI de production, même au bon nom de variable, n'a pas l'hôte du banc.
// Le chemin qui passe est unique : BANC_ISOLE=1, BANC_HOTES non vide, MONGODB_URI lisible et sur l'hôte du banc, AUCUNE autre variable URI qui pointe ailleurs,
// clés R2 de production vidées. Tout le reste refuse, y compris le doute. Aucun message ne contient de valeur de variable.
const { verifierHoteBanc } = require('../collecte-cartes/garde-banc');

const ressemblePourUri = v => typeof v === 'string' && /^mongodb(\+srv)?:\/\//i.test(v.trim());

/** { ok, raison } — l'environnement (celui du verrou ET de ses fils) ne mène qu'au banc. */
function verifierEnvironnementBanc(env = process.env) {
    const ko = raison => ({ ok: false, raison: `🔴 VERROU REFUSÉ — ${raison} Aucune connexion n'a été ouverte.` });
    if (env.BANC_ISOLE !== '1') return ko('BANC_ISOLE n\'est pas posé : banc.appliquer() n\'a pas remplacé les URI de connexion, le verrou écrirait sur la grappe de production.');
    if (!String(env.BANC_HOTES || '').trim()) return ko('BANC_HOTES est vide : je ne sais pas où est le banc.');
    if (!ressemblePourUri(env.MONGODB_URI)) return ko('MONGODB_URI est absente ou illisible.');
    for (const [nom, v] of Object.entries(env)) {
        if (!/^MONGODB_/.test(nom) || typeof v !== 'string' || !v.trim()) continue;
        const estUri = ressemblePourUri(v);
        if (!estUri && /URI$/.test(nom)) return ko(`${nom} est illisible : doute = refus.`);
        if (!estUri) continue;   // MONGODB_BASE & co : un nom de base, pas une adresse
        const h = verifierHoteBanc(v, env);
        if (!h.ok) return ko(`${nom} ne pointe pas sur le banc (${h.raison.replace(/^BANC_ISOLE=1 ?:? ?/, '')}).`);
    }
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
        if (env[k]) return ko(`${k} (clé R2 de production) est encore présente dans l'environnement que les fils héritent.`);
    }
    return { ok: true, raison: null };
}

/** L'URI du banc, ou LÈVE : jamais une URI que la garde n'a pas jugée. */
function uriDuBanc(env = process.env) {
    const v = verifierEnvironnementBanc(env);
    if (!v.ok) throw new Error(v.raison);
    return env.MONGODB_URI;
}

/** Le jeton de l'API du banc : celui de l'environnement, sinon refus (aucun repli en dur). { ok, jeton?, raison? } */
function jetonOuRefus(env = process.env) {
    const j = typeof env.JETON_API === 'string' ? env.JETON_API.trim() : '';
    if (!j) return { ok: false, raison: '🔴 VERROU REFUSÉ — JETON_API est absente ou vide dans l\'environnement du banc ; aucun jeton de repli en dur. Rien n\'a été lancé.' };
    return { ok: true, jeton: j };
}

module.exports = { verifierEnvironnementBanc, uriDuBanc, jetonOuRefus };
