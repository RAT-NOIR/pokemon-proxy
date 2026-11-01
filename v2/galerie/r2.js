'use strict';
// GALERIE — le stockage des images (R2). Trois choses, chacune écrite par ce qu'elle AUTORISE :
//   1. la CONFIGURATION (V2_GALERIE_R2_*) : un bucket DÉDIÉ à l'essai, jamais un bucket de production (aucune autre variable du processus ne porte la même valeur de bucket) ;
//   2. les CLÉS : toute clé commence par `galerie/` (préfixe imposé par le code, pas par l'appelant), sans `..`, sans caractère hors de la liste ;
//   3. le PRÉSIGNEUR (SigV4 en paramètres de requête, écrit ici : le dépôt n'a aucun @aws-sdk/s3-request-presigner). Il appelle verifierEcritureR2 AVANT de signer une écriture (garde-banc.js, « un présigneur doit
//      lui aussi appeler verifierEcritureR2 »), et sa sortie est confrontée à @smithy/signature-v4 par le banc test-galerie-r2.js (vecteur officiel d'AWS + comparaison avec la bibliothèque).
// Aucun fichier d'utilisateur n'est jamais écrit ailleurs que dans R2 ; la base ne garde que des références.
const crypto = require('crypto');
const { verifierEcritureR2, bucketsDeProduction } = require('../../collecte-cartes/garde-banc');

const PREFIXE = 'galerie/';
const FORME_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const FORME_CLE = /^galerie\/[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/;
const sha256hex = d => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const encoder = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);   // RFC 3986 strict, comme SigV4

function cleValide(cle) { return typeof cle === 'string' && FORME_CLE.test(cle) && !cle.includes('..') && !cle.includes('//'); }
function exigerCle(cle) { if (!cleValide(cle)) throw new Error('galerie r2 : clé hors du préfixe galerie/ ou de forme refusée'); return cle; }

/** { ok:true, c:{compte,cleId,secret,bucket,endpoint,hote,urlPublique} } | { ok:false, raison }. `env` explicite. */
function lireConfigR2(env = process.env) {
    const refus = raison => ({ ok: false, raison });
    const t = v => (typeof v === 'string' ? v.trim() : '');
    const compte = t(env.V2_GALERIE_R2_COMPTE), cleId = t(env.V2_GALERIE_R2_CLE_ID), secret = t(env.V2_GALERIE_R2_SECRET), bucket = t(env.V2_GALERIE_R2_BUCKET), publique = t(env.V2_GALERIE_R2_URL_PUBLIQUE);
    for (const [nom, v] of [['V2_GALERIE_R2_COMPTE', compte], ['V2_GALERIE_R2_CLE_ID', cleId], ['V2_GALERIE_R2_SECRET', secret], ['V2_GALERIE_R2_BUCKET', bucket], ['V2_GALERIE_R2_URL_PUBLIQUE', publique]])
        if (!v) return refus(`${nom} absente : le stockage des images de la Communauté n'est pas configuré.`);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(compte)) return refus('V2_GALERIE_R2_COMPTE n\'a pas la forme d\'un identifiant de compte.');
    if (!FORME_BUCKET.test(bucket)) return refus('V2_GALERIE_R2_BUCKET n\'a pas la forme d\'un nom de bucket.');
    // le bucket doit être DÉDIÉ : aucune autre variable (de nom *BUCKET*, ou R2_BUCKET_*) ne porte le même nom, et ce n'est pas un bucket de production connu
    const memeNom = Object.entries(env).filter(([k, v]) => k !== 'V2_GALERIE_R2_BUCKET' && /BUCKET/i.test(k) && typeof v === 'string' && v.trim() === bucket).map(([k]) => k);
    if (memeNom.length) return refus(`V2_GALERIE_R2_BUCKET porte le même nom que ${memeNom.join(', ')} : refusé (le bucket de la Communauté est dédié, jamais un bucket de production).`);
    if (bucketsDeProduction(env).includes(bucket)) return refus('V2_GALERIE_R2_BUCKET est un bucket de production : refusé.');
    let endpoint = t(env.V2_GALERIE_R2_ENDPOINT) || `https://${compte}.r2.cloudflarestorage.com`;
    let hote;
    try { const u = new URL(endpoint); if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.username) throw new Error('forme'); hote = u.host; endpoint = u.origin; } catch { return refus('V2_GALERIE_R2_ENDPOINT n\'est pas une origine https.'); }
    if (!/\.r2\.cloudflarestorage\.com$/.test(hote)) return refus('V2_GALERIE_R2_ENDPOINT doit être un hôte *.r2.cloudflarestorage.com (écriture R2 seulement).');
    let urlPublique;
    try { const u = new URL(publique); if (u.protocol !== 'https:' || u.search || u.hash || u.username) throw new Error('forme'); urlPublique = `${u.origin}${u.pathname.replace(/\/+$/, '')}`; } catch { return refus('V2_GALERIE_R2_URL_PUBLIQUE n\'est pas une adresse https.'); }
    return { ok: true, c: { compte, cleId, secret, bucket, endpoint, hote, urlPublique } };
}

const dateAmz = d => d.toISOString().replace(/[:-]|\.\d{3}/g, '');      // 20130524T000000Z
/**
 * Une URL présignée SigV4 (en-têtes signés listés dans `entetes`, valeurs EXACTES que le client devra envoyer). Style chemin : https://<hote>/<bucket>/<clé>.
 * @returns {string}
 */
function presigner({ methode, hote, chemin, entetes = {}, expire, cleId, secret, region = 'auto', service = 's3', maintenant = new Date() }) {
    if (!Number.isInteger(expire) || expire < 1 || expire > 604800) throw new Error('presigner : expire entre 1 et 604800 secondes');
    const date = dateAmz(maintenant), jour = date.slice(0, 8), portee = `${jour}/${region}/${service}/aws4_request`;
    const tous = { host: hote, ...Object.fromEntries(Object.entries(entetes).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')])) };
    const noms = Object.keys(tous).sort();
    const requete = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${cleId}/${portee}`, 'X-Amz-Date': date, 'X-Amz-Expires': String(expire), 'X-Amz-SignedHeaders': noms.join(';') };
    const cq = Object.keys(requete).sort().map(k => `${encoder(k)}=${encoder(requete[k])}`).join('&');
    const cu = chemin.split('/').map(s => encoder(s)).join('/');                                   // S3 : chaque segment encodé UNE fois
    const canonique = [methode, cu, cq, noms.map(n => `${n}:${tous[n]}\n`).join(''), noms.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
    const asigner = ['AWS4-HMAC-SHA256', date, portee, sha256hex(canonique)].join('\n');
    const cleSignature = hmac(hmac(hmac(hmac(`AWS4${secret}`, jour), region), service), 'aws4_request');
    const signature = hmac(cleSignature, asigner).toString('hex');
    return `https://${hote}${cu}?${cq}&X-Amz-Signature=${signature}`;
}

/**
 * Le stockage réel d'une configuration valide. L'interface est celle que les routes appellent et que les bancs remplacent par un faux en mémoire :
 *   presignerDepot({cle,type,octets,expire}) · presignerLecture({cle,expire}) · tete(cle) → {octets}|null · lire(cle, max) → Buffer · ecrire(cle, buffer, type) · copier(de, vers) · supprimer(cle)
 * `client` (un S3Client) et `maintenant` sont injectables ; le client est enveloppé par garderClientR2 (aucune écriture hors R2_BUCKET_BANC sous BANC_ISOLE=1).
 */
function creerStockage(c, { env = process.env, client = null, maintenant = () => new Date() } = {}) {
    let s3 = client;
    const S3 = () => {
        if (s3) return s3;
        const { S3Client } = require('@aws-sdk/client-s3');
        s3 = require('../../collecte-cartes/garde-banc').garderClientR2(new S3Client({ region: 'auto', endpoint: c.endpoint, credentials: { accessKeyId: c.cleId, secretAccessKey: c.secret }, forcePathStyle: true }), env);
        return s3;
    };
    const cmd = (nom, input) => { const k = require('@aws-sdk/client-s3'); return new k[nom]({ Bucket: c.bucket, ...input }); };
    const exigerEcritureAutorisee = () => { const v = verifierEcritureR2('PutObjectCommand', c.bucket, env); if (!v.ok) throw new Error(v.raison); };
    return {
        bucket: c.bucket, urlPublique: c.urlPublique, origineEcriture: c.endpoint,
        presignerDepot({ cle, type, octets, expire }) {
            exigerCle(cle); exigerEcritureAutorisee();
            return presigner({ methode: 'PUT', hote: c.hote, chemin: `/${c.bucket}/${cle}`, entetes: { 'content-type': type, 'content-length': octets }, expire, cleId: c.cleId, secret: c.secret, maintenant: maintenant() });
        },
        presignerLecture({ cle, expire }) { exigerCle(cle); return presigner({ methode: 'GET', hote: c.hote, chemin: `/${c.bucket}/${cle}`, expire, cleId: c.cleId, secret: c.secret, maintenant: maintenant() }); },
        async tete(cle) {
            exigerCle(cle);
            try { const r = await S3().send(cmd('HeadObjectCommand', { Key: cle })); return { octets: Number(r.ContentLength) }; }
            catch (e) { if (e && (e.name === 'NotFound' || e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404))) return null; throw e; }
        },
        async lire(cle, max) {
            exigerCle(cle);
            const r = await S3().send(cmd('GetObjectCommand', { Key: cle }));
            const morceaux = []; let n = 0;
            for await (const m of r.Body) { n += m.length; if (n > max) { if (typeof r.Body.destroy === 'function') r.Body.destroy(); throw Object.assign(new Error('trop-lourd'), { code: 'TROP_LOURD' }); } morceaux.push(m); }
            return Buffer.concat(morceaux);
        },
        async ecrire(cle, buffer, type) { exigerCle(cle); await S3().send(cmd('PutObjectCommand', { Key: cle, Body: buffer, ContentType: type, CacheControl: 'public, max-age=31536000, immutable' })); },
        async copier(de, vers) { exigerCle(de); exigerCle(vers); await S3().send(cmd('CopyObjectCommand', { Key: vers, CopySource: `${c.bucket}/${de}` })); },
        async supprimer(cle) { exigerCle(cle); await S3().send(cmd('DeleteObjectCommand', { Key: cle })); }
    };
}

module.exports = { PREFIXE, cleValide, exigerCle, lireConfigR2, presigner, creerStockage, encoder };
