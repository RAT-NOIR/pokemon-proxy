// ============================================================
// R2 — le wikitext BRUT (épuré) et, plus tard, les images
// ============================================================
// API S3 de Cloudflare R2, région `auto`. Deux buckets, jamais confondus : `R2_BUCKET_BRUT`
// (wikitext) et `R2_BUCKET_IMAGES` (originaux). Accès public désactivé côté Cloudflare : rien ici
// n'est servi, c'est l'archive privée qui permet de reparser sans refetcher.
//
// Idempotence : la clé porte `pageid/revid`, donc un objet existant est le même contenu — on ne le
// réécrit pas. `deposerTexte` rend `{ ecrit: true|false }` pour que l'appelant compte.

const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

// ⚠️ JURIDICTION. Un bucket créé avec la restriction « EU » n'est joignable QUE par l'endpoint
// `<compte>.eu.r2.cloudflarestorage.com` ; l'endpoint générique répond AccessDenied (403), ce qui
// ressemble à un mauvais jeton alors que c'est un mauvais hôte. Mesuré le 2026-09-12 sur nos deux
// buckets. `R2_ENDPOINT` force un hôte ; sinon `verifierBucket` essaie le générique puis l'UE, et
// retient celui qui répond — c'est écrit dans le log, pas deviné en silence.
let _client = null;
let _endpoint = null;
function fabriquer(endpoint) {
    return new S3Client({
        region: 'auto', endpoint,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
        forcePathStyle: true
    });
}
function client() {
    if (_client) return _client;
    _endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    _client = fabriquer(_endpoint);
    return _client;
}

/** Vérifie que le bucket répond avec ces identifiants — AVANT la première requête Bulbapedia. */
async function verifierBucket(bucket) {
    const candidats = process.env.R2_ENDPOINT
        ? [process.env.R2_ENDPOINT]
        : [`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, `https://${process.env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`];
    let derniere = null;
    for (const endpoint of candidats) {
        try {
            const c = fabriquer(endpoint);
            await c.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
            _client = c; _endpoint = endpoint;
            console.log(`📦 R2 : ${bucket} joignable par ${endpoint}${/\.eu\./.test(endpoint) ? ' (juridiction UE)' : ''}.`);
            return endpoint;
        } catch (e) { derniere = e; }
    }
    throw derniere;
}

async function existe(bucket, cle) {
    try { await client().send(new HeadObjectCommand({ Bucket: bucket, Key: cle })); return true; }
    catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false; throw e; }
}

/** Dépose un texte UTF-8 sous `cle` s'il n'y est pas déjà. */
async function deposerTexte(bucket, cle, texte, contentType = 'text/plain; charset=utf-8') {
    if (await existe(bucket, cle)) return { ecrit: false, cle };
    await client().send(new PutObjectCommand({ Bucket: bucket, Key: cle, Body: Buffer.from(texte, 'utf8'), ContentType: contentType }));
    return { ecrit: true, cle };
}

/** Dépose un binaire (image) s'il n'y est pas déjà. */
async function deposerBinaire(bucket, cle, buffer, contentType) {
    if (await existe(bucket, cle)) return { ecrit: false, cle };
    await client().send(new PutObjectCommand({ Bucket: bucket, Key: cle, Body: buffer, ContentType: contentType }));
    return { ecrit: true, cle };
}

/** Relit un texte UTF-8 depuis R2 — c'est l'assurance : reparser sans refetcher. */
async function lireTexte(bucket, cle) {
    const r = await client().send(new GetObjectCommand({ Bucket: bucket, Key: cle }));
    return await r.Body.transformToString('utf8');
}

/** Toutes les clés sous un préfixe (pour l'effacement demandé, jamais pour autre chose). */
async function listerPrefixe(bucket, prefixe) {
    const cles = [];
    let token;
    do {
        const r = await client().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefixe, ContinuationToken: token }));
        for (const o of r.Contents || []) cles.push(o.Key);
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return cles;
}

/** Supprime des clés, par lots de 1 000. Réservé à `--arreter-et-effacer --confirmer`. */
async function supprimer(bucket, cles) {
    let n = 0;
    for (let i = 0; i < cles.length; i += 1000) {
        const lot = cles.slice(i, i + 1000);
        await client().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: lot.map(Key => ({ Key })), Quiet: true } }));
        n += lot.length;
    }
    return n;
}

const cleWikitext = (pageid, revid) => `bulba/${pageid}/${revid}.wikitext`;

module.exports = { verifierBucket, existe, deposerTexte, deposerBinaire, lireTexte, listerPrefixe, supprimer, cleWikitext };
