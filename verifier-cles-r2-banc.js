// Preuve que les clés R2_BANC_* ne lisent AUCUN bucket de production — avec son témoin, pour qu'un refus ne puisse pas venir du point d'accès.
//   node verifier-cles-r2-banc.js
// Une seule opération, ListObjectsV2 MaxKeys=1 (la même que verifierBucket), pour chaque couple (clés, bucket) sur deux points d'accès (générique, UE).
// LECTURE SEULE, aucune écriture ; n'imprime QUE des statuts : ni clé d'objet, ni valeur de variable, ni nom de bucket (seulement le nom de sa variable).
// Sortie 0 seulement si : le TÉMOIN lit (les clés de production lisent leurs buckets), les clés de banc lisent le bucket de banc, et les clés de banc
// sont REFUSÉES sur chaque bucket de production, aux deux points d'accès.
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// PORTÉE DU VERDICT — ce que cette preuve établit et ce qu'elle n'établit pas :
//   · elle teste la LECTURE (ListObjectsV2), pas l'écriture ;
//   · elle ne porte que sur les buckets NOMMÉS dans le .env (R2_BUCKET_IMAGES, R2_BUCKET_BRUT), pas sur les autres buckets du compte ;
//   · seul un refus d'autorisation (HTTP 403) compte comme refus ; timeout, coupure, 404, 5xx rendent la case INCONCLUSIVE et le verdict « NON PROUVÉ » ;
//   · le périmètre réel du jeton (buckets, droits d'écriture) se vérifie côté Cloudflare : c'est une action du testeur.
const PORTEE = 'lecture seule (ListObjectsV2) ; buckets nommés dans le .env seulement (IMAGES, BRUT) ; ni l\'écriture ni les autres buckets du compte — le périmètre du jeton se vérifie côté Cloudflare (testeur).';

/** Verdict pur sur la matrice { 'clés|bucket|point': 'LU' | 'refus 403 …' | 'inconclusif …' }. Un bucket absent de la matrice n'est pas « refusé » : il manque ;
 *  une case ni LU ni « refus 403 » est INCONCLUSIVE (nommée) : dans les deux cas le verdict refuse. */
function juger(res, bucketsProd, points) {
    const inconclusives = Object.entries(res).filter(([, v]) => v !== 'LU' && !/^refus 403\b/.test(String(v))).map(([k]) => k);
    const lu = (nc, nb) => points.some(np => res[`${nc}|${nb}|${np}`] === 'LU');
    const complet = ['banc', 'production'].every(nc => ['banc', ...bucketsProd].every(nb => points.every(np => `${nc}|${nb}|${np}` in res)));
    const temoin = bucketsProd.length > 0 && bucketsProd.every(nb => lu('production', nb));
    const bancLit = lu('banc', 'banc');
    const fuites = bucketsProd.filter(nb => lu('banc', nb));
    return { complet, temoin, bancLit, fuites, inconclusives, ok: complet && temoin && bancLit && fuites.length === 0 && inconclusives.length === 0 };
}

/** Classe une erreur : « refus 403 … » seulement pour un refus d'autorisation HTTP 403 ; toute autre issue est « inconclusif … ». Pure. */
function classer(e) {
    const statut = e?.$metadata?.httpStatusCode;
    const nom = e?.name || e?.Code || e?.code || '';
    return `${statut === 403 ? 'refus' : 'inconclusif'} ${statut ?? '?'} ${nom}`.trim();
}

async function essai(cles, bucket, endpoint) {
    const c = new S3Client({ region: 'auto', endpoint, credentials: cles, forcePathStyle: true });
    try { await c.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })); return 'LU'; }
    catch (e) { return classer(e); }
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
    if (v.inconclusives.length) console.log(`  cases INCONCLUSIVES (ni lecture ni refus 403) : ${v.inconclusives.join(', ')}`);
    console.log(v.ok ? '  ✅ PROUVÉ : refus des clés de banc sur la production, sur les deux points d\'accès, et le témoin lit — le refus vient de la clé, pas du point d\'accès.'
        : '  ❌ NON PROUVÉ (voir la matrice)');
    console.log(`  PORTÉE : ${PORTEE}`);
    return v.ok ? 0 : 1;
}
const points = (res, nc, nb, POINTS) => Object.keys(POINTS).some(np => res[`${nc}|${nb}|${np}`] === 'LU');

module.exports = { juger, classer, PORTEE };

if (require.main === module) {
    require('dotenv').config();
    main().then(c => process.exit(c), e => { console.error(String(e?.name || 'erreur')); process.exit(1); });
}
