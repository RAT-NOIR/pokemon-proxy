'use strict';
// ============================================================
// LECTURE R2 — NOTRE bucket d'images (R2_BUCKET_IMAGES), en LECTURE SEULE : GetObject et ListObjectsV2 (sonde du point d'accès), jamais autre chose
// ============================================================
// C'est notre stockage, pas un tiers (brief S8/AUDIT, mesure 4). Le client n'expose QU'UNE méthode, `lire(cle)` : ni dépôt, ni suppression, ni copie.
// Les clés d'accès sont celles de .env (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) ; elles ne sont jamais imprimées. Concurrence modérée (l'appelant).
require('./lecture-audit');                                   // charge .env du dépôt principal
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

class R2Absent extends Error { constructor(cle) { super(`objet absent : ${cle}`); this.cle = cle; this.absent = true; } }

async function ouvrirR2Lecture() {
    for (const v of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_IMAGES']) if (!process.env[v]) throw new Error(`${v} absente : lecture R2 impossible`);
    const bucket = process.env.R2_BUCKET_IMAGES;
    // un bucket créé avec la restriction « EU » n'est joignable que par l'hôte .eu. (CLAUDE.md §26, r2.js) : on sonde les deux par une LISTE d'une clé, et on garde celui qui répond
    const candidats = process.env.R2_ENDPOINT ? [process.env.R2_ENDPOINT] : [`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, `https://${process.env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`];
    let derniere = null;
    for (const endpoint of candidats) {
        const client = new S3Client({ region: 'auto', endpoint, forcePathStyle: true, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
        try {
            await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
            return {
                juridiction: /\.eu\./.test(endpoint) ? 'UE' : 'générique',
                async lire(cle) {
                    try { const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: cle })); return Buffer.from(await r.Body.transformToByteArray()); }
                    catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey') throw new R2Absent(cle); throw e; }
                }
            };
        } catch (e) { derniere = e; }
    }
    throw new Error(`R2 : bucket injoignable (${derniere?.name || 'erreur'})`);
}

module.exports = { ouvrirR2Lecture, R2Absent };
