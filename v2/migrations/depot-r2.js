'use strict';
// COTES-VISUELS, tour 3 — le DÉPÔT de l'archive sur R2 : côté PRODUCTEUR seulement (construire-fichier-visuels.js). L'API ne charge jamais ce fichier : elle lit l'objet avec des clés de LECTURE
// (v2/chargeur/r2-prive.js, qui n'écrit rien). Les variables d'écriture portent `_ECR_` dans leur nom et ne sont lues qu'ici.
const R2 = require('../chargeur/r2-prive');

const NOMS_ECRITURE = Object.freeze(['V2_VISUELS_R2_COMPTE', 'V2_VISUELS_R2_ECR_CLE_ID', 'V2_VISUELS_R2_ECR_SECRET', 'V2_VISUELS_R2_BUCKET', 'V2_VISUELS_R2_OBJET', 'V2_VISUELS_HMAC']);
/** @returns {{ ok: true, c: object } | { ok: false, raison: string }} — la raison NOMME les variables absentes, jamais une valeur. */
const configEcriture = env => R2.configDe(env, NOMS_ECRITURE);

async function deposerObjet({ client, bucket, objet, corps }) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    // Content-Type binaire et AUCUN Content-Encoding : un objet déposé « gzip » serait décodé en route (le magasin ou un intermédiaire), l'archive scellée perdrait son HMAC
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: objet, Body: corps, ContentType: 'application/octet-stream' }));
}
module.exports = { configEcriture, deposerObjet, NOMS_ECRITURE };
