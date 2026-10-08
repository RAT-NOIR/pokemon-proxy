// ============================================================================
// LA GARDE DES BANCS QUE LA PRODUCTION CHARGE — petit, SANS DÉPENDANCE, et il ne peut pas lever à l'import
// ============================================================================
// Le worker de production (collecteur-images*.js via r2.js et garde.js, mongo-connexion.js) charge ce module au démarrage. Il ne requiert RIEN (ni
// mongodb, ni mongoose, ni fs) : un module de banc plus gros (base-banc.js : façade de lecture, mongodb-memory-server) qui lèverait à l'import
// — le pilote change ses exports — ne doit JAMAIS pouvoir empêcher le worker de démarrer. base-banc.js requiert ce module et le ré-exporte ;
// la production, elle, ne requiert plus base-banc.js. Inerte hors banc : tout ici ne dit « non » que sous BANC_ISOLE=1.

/** Hôtes d'une URI mongodb:// ou mongodb+srv:// (minuscules, sans port, sans point final) ; [] si elle n'est pas lisible. */
function hotesDe(uri) {
    if (typeof uri !== 'string') return [];
    const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(uri.trim());
    if (!m) return [];
    const hotes = m[1].split(',').map(h => h.trim().toLowerCase().replace(/(?<=\]|[^:\]]):\d+$/, '').replace(/\.$/, '')).filter(Boolean);
    return hotes.some(h => !/^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)$/.test(h)) ? [] : hotes;
}

/** Identité de GRAPPE d'un hôte : un hôte Atlas (srv `cluster0.abcde.mongodb.net` ou shard `cluster0-shard-00-00.abcde.mongodb.net`) se compare
 *  par ses trois derniers labels (`abcde.mongodb.net`) ; tout autre hôte, tel quel. */
function cleDeGrappe(hote) {
    const l = hote.split('.');
    return hote.endsWith('.mongodb.net') && l.length >= 4 ? l.slice(-3).join('.') : hote;
}

/**
 * Sous BANC_ISOLE=1, une connexion n'est permise que vers l'hôte du banc (BANC_HOTES). Hors banc : ne dit rien (ok). Un doute refuse.
 * @param {string} uri  l'URI (ou `mongodb://<hôte>/` pour un hôte déjà connecté)
 */
function verifierHoteBanc(uri, env = process.env) {
    if (env.BANC_ISOLE !== '1') return { ok: true, isole: false, raison: null };
    const banc = (env.BANC_HOTES || '').split(',').map(h => h.trim()).filter(Boolean).map(cleDeGrappe);
    const hotes = hotesDe(uri);
    if (!banc.length) return { ok: false, isole: true, raison: 'BANC_ISOLE=1 sans BANC_HOTES : je ne sais pas où est le banc, refusé.' };
    if (!hotes.length) return { ok: false, isole: true, raison: 'BANC_ISOLE=1 et URI illisible : refusé.' };
    if (!hotes.every(h => banc.includes(cleDeGrappe(h)))) return { ok: false, isole: true, raison: 'BANC_ISOLE=1 : l\'hôte de cette connexion n\'est pas celui du banc, refusé (hôte = production ou inconnu).' };
    return { ok: true, isole: true, raison: null };
}

/** LA liste des buckets R2 de PRODUCTION de cet environnement : toute R2_BUCKET_* non vide, sauf R2_BUCKET_BANC. Une seule définition (appliquer() et
 *  le repli de verifierEcritureR2 l'appellent tous deux). */
function bucketsDeProduction(env = process.env) {
    return Object.entries(env).filter(([k, v]) => /^R2_BUCKET_/.test(k) && k !== 'R2_BUCKET_BANC' && v).map(([, v]) => v);
}

// ── R2 : sous BANC_ISOLE=1, la LECTURE est permise (liste fermée) ; toute autre commande n'est permise que vers R2_BUCKET_BANC, jamais un bucket de production.
const LECTURES_R2 = new Set(['GetObjectCommand', 'HeadObjectCommand', 'ListObjectsV2Command', 'ListObjectsCommand', 'HeadBucketCommand']);

/** { ok, raison } : cette commande S3 peut-elle partir ? Pure. */
function verifierEcritureR2(nomCommande, bucket, env = process.env) {
    if (env.BANC_ISOLE !== '1' || LECTURES_R2.has(nomCommande)) return { ok: true, raison: null };
    const banc = env.R2_BUCKET_BANC;
    if (!banc) return { ok: false, raison: `ÉCRITURE R2 REFUSÉE (${nomCommande}) : R2_BUCKET_BANC absent — un banc n'écrit jamais dans un bucket de production (même des clés idempotentes).` };
    const interdits = env.BANC_R2_INTERDITS !== undefined ? env.BANC_R2_INTERDITS.split(',').filter(Boolean) : bucketsDeProduction(env);
    if (interdits.includes(banc)) return { ok: false, raison: `ÉCRITURE R2 REFUSÉE (${nomCommande}) : R2_BUCKET_BANC est égal à un bucket de production.` };
    if (bucket !== banc) return { ok: false, raison: `ÉCRITURE R2 REFUSÉE (${nomCommande}) : le bucket visé n'est pas R2_BUCKET_BANC.` };
    return { ok: true, raison: null };
}

/** Enrobe `client.send` : la décision tombe AVANT toute requête, et c'est la PROMESSE qui est rejetée. Idempotente. Hors banc : un passe-plat.
 *  ⚠️ LIMITE : une URL PRÉSIGNÉE (getSignedUrl pour un PUT) ne passe pas par `send` — elle est signée localement puis appelée en HTTP par un autre
 *  chemin — donc pas par cette garde. Le dépôt n'a AUCUN présigneur aujourd'hui (grep de `@aws-sdk/s3-request-presigner` : aucune occurrence) ; si
 *  un présigneur y arrive, il doit lui aussi appeler `verifierEcritureR2` (commande PutObjectCommand, bucket visé) avant de signer, ou être refusé. */
function garderClientR2(client, env = process.env) {
    if (!client || client.send?.__gardeBanc) return client;
    const original = client.send.bind(client);
    const send = async (commande, ...r) => {
        const v = verifierEcritureR2(commande?.constructor?.name, commande?.input?.Bucket, env);
        if (!v.ok) throw new Error(`🔴 ${v.raison}`);
        return original(commande, ...r);
    };
    send.__gardeBanc = true;
    client.send = send;
    return client;
}

module.exports = { hotesDe, cleDeGrappe, verifierHoteBanc, bucketsDeProduction, verifierEcritureR2, garderClientR2 };
