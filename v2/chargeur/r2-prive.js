'use strict';
// COTES-VISUELS, tour 2 — l'objet R2 PRIVÉ qui porte l'archive (jamais l'hôte public : elle contient la jointure fiche ↔ produit ↔ visuel et rend énumérables les clés d'images du bucket).
//   LECTURE (l'API) : des clés de LECTURE dédiées, limitées à ce bucket, des variables NEUVES fermées par défaut — l'une absente ⇒ « sans visuel » et un journal qui nomme les variables, jamais
//   une valeur. ÉCRITURE (le producteur, hors API) : d'autres clés, d'autres variables. Le nom du bucket et de l'objet sont des variables.
//   Client : @aws-sdk/client-s3, chargé À LA DEMANDE (jamais à l'import) ; `client` est injectable (les bancs passent un faux client : aucune requête réelle, aucun bucket réel).
const { FormatInvalide } = require('./format');

const NOMS_LECTURE = Object.freeze(['V2_VISUELS_R2_COMPTE', 'V2_VISUELS_R2_CLE_ID', 'V2_VISUELS_R2_SECRET', 'V2_VISUELS_R2_BUCKET', 'V2_VISUELS_R2_OBJET', 'V2_VISUELS_HMAC']);
const NOMS_ECRITURE = Object.freeze(['V2_VISUELS_R2_COMPTE', 'V2_VISUELS_R2_ECR_CLE_ID', 'V2_VISUELS_R2_ECR_SECRET', 'V2_VISUELS_R2_BUCKET', 'V2_VISUELS_R2_OBJET', 'V2_VISUELS_HMAC']);
const DELAI_MS = 60 * 1000;
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const refuser = m => { throw new FormatInvalide(m); };

/** Les variables d'un côté ou de l'autre. @returns {{ ok: true, c: object } | { ok: false, raison: string }} — la raison NOMME les variables absentes, jamais une valeur. */
function configDe(env, noms) {
    const manque = noms.filter(n => !texte(env[n]));
    if (manque.length) return { ok: false, raison: `variables absentes : ${manque.join(', ')}` };
    const nom = n => texte(env[n]);
    return { ok: true, c: { compte: nom('V2_VISUELS_R2_COMPTE'), cleId: nom(noms[1]), secret: nom(noms[2]), bucket: nom('V2_VISUELS_R2_BUCKET'), objet: nom('V2_VISUELS_R2_OBJET'), hmac: nom('V2_VISUELS_HMAC'), endpoint: texte(env.V2_VISUELS_R2_ENDPOINT) } };
}
const configLecture = env => configDe(env, NOMS_LECTURE);
const configEcriture = env => configDe(env, NOMS_ECRITURE);

/** Le client S3 de R2 (région `auto`), chargé ici seulement. L'endpoint générique, ou V2_VISUELS_R2_ENDPOINT (juridiction UE : `<compte>.eu.r2.cloudflarestorage.com`). */
function creerClient({ compte, cleId, secret, endpoint }) {
    const { S3Client } = require('@aws-sdk/client-s3');
    return new S3Client({ region: 'auto', endpoint: endpoint || `https://${compte}.r2.cloudflarestorage.com`, credentials: { accessKeyId: cleId, secretAccessKey: secret }, forcePathStyle: true });
}

/** Lit l'objet : annoncé ET compté à la lecture, délai borné. 404 ⇒ FormatInvalide nommé. @returns {Promise<Buffer|null>} null si l'objet n'existe pas et `siAbsent` vaut 'null'. */
async function lireObjet({ client, bucket, objet, max, delaiMs = DELAI_MS, siAbsent = 'refuser' }) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    let r;
    try { r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objet }), { abortSignal: AbortSignal.timeout(delaiMs) }); }
    catch (e) {
        if (e && (e.name === 'NoSuchKey' || e.name === 'NotFound' || (e.$metadata && e.$metadata.httpStatusCode === 404))) { if (siAbsent === 'null') return null; refuser('objet absent (404)'); }
        refuser(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'délai dépassé' : 'R2 indisponible ou accès refusé');
    }
    if (Number.isFinite(r.ContentLength) && r.ContentLength > max) refuser('objet plus grand que la taille permise (annoncée)');
    const morceaux = []; let total = 0;
    try { for await (const m of r.Body) { total += m.length; if (total > max) refuser('objet plus grand que la taille permise (lue)'); morceaux.push(Buffer.from(m)); } }
    catch (e) { if (e instanceof FormatInvalide) throw e; refuser('lecture interrompue'); }
    if (total === 0) refuser('objet vide');
    return Buffer.concat(morceaux, total);
}
async function deposerObjet({ client, bucket, objet, corps }) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    // Content-Type binaire et AUCUN Content-Encoding : un objet déposé « gzip » serait décodé en route (le magasin ou un intermédiaire), l'archive scellée perdrait son HMAC
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: objet, Body: corps, ContentType: 'application/octet-stream' }));
}
module.exports = { configLecture, configEcriture, creerClient, lireObjet, deposerObjet, NOMS_LECTURE, NOMS_ECRITURE, DELAI_MS };
