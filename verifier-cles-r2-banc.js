// Preuve que les clés R2_BANC_* ne lisent AUCUN bucket de production — avec son témoin, pour qu'un refus ne puisse pas venir du point d'accès.
//   node verifier-cles-r2-banc.js
// Une seule opération, ListObjectsV2 MaxKeys=1 (la même que verifierBucket), pour chaque couple (clés, bucket) sur deux points d'accès (générique, UE).
// LECTURE SEULE, aucune écriture ; n'imprime QUE des statuts : ni clé d'objet, ni valeur de variable, ni nom de bucket (seulement le nom de sa variable).
// Sortie 0 seulement si : le TÉMOIN lit (les clés de production lisent leurs buckets), les clés de banc lisent le bucket de banc, et les clés de banc
// sont REFUSÉES sur chaque bucket de production, aux deux points d'accès.
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

/** Verdict pur sur la matrice { 'clés|bucket|point': 'LU' | 'refus …' }. Un bucket absent de la matrice n'est pas « refusé » : il manque, et le verdict refuse. */
function juger(res, bucketsProd, points) {
    const lu = (nc, nb) => points.some(np => res[`${nc}|${nb}|${np}`] === 'LU');
    const complet = ['banc', 'production'].every(nc => ['banc', ...bucketsProd].every(nb => points.every(np => `${nc}|${nb}|${np}` in res)));
    const temoin = bucketsProd.length > 0 && bucketsProd.every(nb => lu('production', nb));
    const bancLit = lu('banc', 'banc');
    const fuites = bucketsProd.filter(nb => lu('banc', nb));
    return { complet, temoin, bancLit, fuites, ok: complet && temoin && bancLit && fuites.length === 0 };
}

async function essai(cles, bucket, endpoint) {
    const c = new S3Client({ region: 'auto', endpoint, credentials: cles, forcePathStyle: true });
    try { await c.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })); return 'LU'; }
    catch (e) { return `refus ${e.$metadata?.httpStatusCode ?? '?'} ${e.name || e.Code || ''}`.trim(); }
}

async function main(E = process.env) {
    const POINTS = { generique: `https://${E.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, ue: `https://${E.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com` };
    const CLES = {
        banc: { accessKeyId: E.R2_BANC_ACCESS_KEY_ID, secretAccessKey: E.R2_BANC_SECRET_ACCESS_KEY },
        production: { accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY },
    };
    const BUCKETS = { banc: E.R2_BUCKET_BANC, R2_BUCKET_IMAGES: E.R2_BUCKET_IMAGES, R2_BUCKET_BRUT: E.R2_BUCKET_BRUT };
    const requises = { R2_ACCOUNT_ID: E.R2_ACCOUNT_ID, R2_BUCKET_BANC: E.R2_BUCKET_BANC, R2_BUCKET_IMAGES: E.R2_BUCKET_IMAGES, R2_BUCKET_BRUT: E.R2_BUCKET_BRUT,
        R2_BANC_ACCESS_KEY_ID: E.R2_BANC_ACCESS_KEY_ID, R2_BANC_SECRET_ACCESS_KEY: E.R2_BANC_SECRET_ACCESS_KEY, R2_ACCESS_KEY_ID: E.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: E.R2_SECRET_ACCESS_KEY };
    const absentes = Object.entries(requises).filter(([, v]) => !v).map(([k]) => k);
    if (absentes.length) { console.log(`❌ variable(s) absente(s) : ${absentes.join(', ')}`); return 1; }
    if (E.R2_BANC_ACCESS_KEY_ID === E.R2_ACCESS_KEY_ID) { console.log('❌ la clé de banc EST la clé de production'); return 1; }
    if (E.R2_BUCKET_BANC === E.R2_BUCKET_IMAGES || E.R2_BUCKET_BANC === E.R2_BUCKET_BRUT) { console.log('❌ R2_BUCKET_BANC est égal à un bucket de production'); return 1; }

    const res = {};
    for (const [nc, cles] of Object.entries(CLES)) for (const [nb, b] of Object.entries(BUCKETS)) for (const [np, p] of Object.entries(POINTS)) {
        const r = await essai(cles, b, p);
        res[`${nc}|${nb}|${np}`] = r;
        console.log(`clés ${nc.padEnd(10)} · bucket ${nb.padEnd(18)} · point ${np.padEnd(9)} → ${r}`);
    }
    const prod = Object.keys(BUCKETS).filter(n => n !== 'banc');
    const v = juger(res, prod, Object.keys(POINTS));
    console.log(`\nVERDICT (${Object.keys(res).length} lectures sur ${2 * Object.keys(BUCKETS).length * Object.keys(POINTS).length} attendues)`);
    console.log(`  témoin : les clés de production lisent leurs buckets → ${prod.map(n => `${n} ${points(res, 'production', n, POINTS) ? 'oui' : 'NON'}`).join(', ')}`);
    console.log(`  les clés de banc lisent le bucket de banc → ${v.bancLit ? 'oui' : 'NON'}`);
    console.log(`  les clés de banc lisent un bucket de production → ${prod.map(n => `${n} ${v.fuites.includes(n) ? '🔴 OUI' : 'non'}`).join(', ')}`);
    console.log(v.ok ? '  ✅ PROUVÉ : refus des clés de banc sur la production, sur les deux points d\'accès, et le témoin lit — le refus vient de la clé, pas du point d\'accès.'
        : '  ❌ NON PROUVÉ (voir la matrice)');
    return v.ok ? 0 : 1;
}
const points = (res, nc, nb, POINTS) => Object.keys(POINTS).some(np => res[`${nc}|${nb}|${np}`] === 'LU');

module.exports = { juger };

if (require.main === module) {
    require('dotenv').config();
    main().then(c => process.exit(c), e => { console.error(String(e?.name || 'erreur')); process.exit(1); });
}
