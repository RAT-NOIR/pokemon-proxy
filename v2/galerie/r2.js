'use strict';
// GALERIE — le stockage des images (R2). Quatre choses, chacune écrite par ce qu'elle AUTORISE :
//   1. la CONFIGURATION (V2_GALERIE_R2_*) : DEUX buckets DÉDIÉS — un PRIVÉ pour `galerie/depot/` et `galerie/attente/` (jamais lisible sans URL signée), un PUBLIC pour `galerie/pub/` seulement —, déclarés tous les deux,
//    différents l'un de l'autre et de tous les buckets connus (R2_BUCKET_IMAGES, V2_VISUELS_PROD_BUCKET, V2_VISUELS_ESSAI_BUCKET, R2_BUCKET_BANC et toute variable *BUCKET*), et une adresse publique qui n'est pas celle de la production ;
//   2. les MARQUEURS : chaque bucket porte un objet marqueur posé par l'outil d'initialisation (outils/initialiser-r2.js). Une liste d'exclusions ne prouve rien (relecture 2, C2) : la preuve POSITIVE est le marqueur, et un
//      bucket sans marqueur — un bucket de production désigné par erreur — BLOQUE (cause « marqueur-r2-absent ») ;
//   3. les CLÉS : toute clé commence par `galerie/` (préfixe imposé par le code, pas par l'appelant), sans `..`, sans segment `.` ni vide, sans caractère hors de la liste ;
//   4. le PRÉSIGNEUR (SigV4 en paramètres de requête, écrit ici : le dépôt n'a aucun @aws-sdk/s3-request-presigner). Il appelle verifierEcritureR2 AVANT de signer une écriture (garde-banc.js), et sa sortie est confrontée à
//      @smithy/signature-v4 par le banc test-galerie-r2.js (vecteur officiel d'AWS + comparaison avec la bibliothèque).
// Aucun fichier d'utilisateur n'est jamais écrit ailleurs que dans R2 ; la base ne garde que des références.
const crypto = require('crypto');
const { verifierEcritureR2, bucketsDeProduction } = require('../../collecte-cartes/garde-banc');
const { HOTES_PUBLICS_PRODUCTION } = require('../config');
const { RefusGalerie } = require('./refus');

const PREFIXE = 'galerie/';
const MARQUEUR_PRIVE = 'galerie/marqueur-prive.json', MARQUEUR_PUBLIC = 'galerie/pub/marqueur.json';
// les variables qui NOMMENT un bucket de la Communauté (elles ne peuvent pas se comparer à elles-mêmes)
const BUCKETS_GALERIE = Object.freeze(['V2_GALERIE_R2_BUCKET_PRIVE', 'V2_GALERIE_R2_BUCKET_PUBLIC']);
const FORME_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const FORME_CLE = /^galerie\/[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/;
const sha256hex = d => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const encoder = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);   // RFC 3986 strict, comme SigV4

function cleValide(cle) {
    return typeof cle === 'string' && FORME_CLE.test(cle) && !cle.includes('..') && !cle.includes('//') && !cle.endsWith('.') && !cle.endsWith('/') && !cle.split('/').includes('.');
}
function exigerCle(cle) { if (!cleValide(cle)) throw new Error('galerie r2 : clé hors du préfixe galerie/ ou de forme refusée'); return cle; }
/** Dans quel bucket vit une clé : `galerie/pub/` est PUBLIC, tout le reste (depot/, attente/, marqueur privé) est PRIVÉ. */
function bucketDe(cle) {
    if (cle.startsWith('galerie/pub/')) return 'public';
    return 'prive';
}

/** { ok:true, c:{compte,cleId,secret,bucketPrive,bucketPublic,endpoint,hote,urlPublique} } | { ok:false, raison }. `env` explicite. */
function lireConfigR2(env = process.env) {
    const refus = raison => ({ ok: false, raison });
    const t = v => (typeof v === 'string' ? v.trim() : '');
    const compte = t(env.V2_GALERIE_R2_COMPTE), cleId = t(env.V2_GALERIE_R2_CLE_ID), secret = t(env.V2_GALERIE_R2_SECRET), privee = t(env.V2_GALERIE_R2_BUCKET_PRIVE), publique = t(env.V2_GALERIE_R2_BUCKET_PUBLIC), urlPub = t(env.V2_GALERIE_R2_URL_PUBLIQUE);
    for (const [nom, v] of [['V2_GALERIE_R2_COMPTE', compte], ['V2_GALERIE_R2_CLE_ID', cleId], ['V2_GALERIE_R2_SECRET', secret], ['V2_GALERIE_R2_BUCKET_PRIVE', privee], ['V2_GALERIE_R2_BUCKET_PUBLIC', publique], ['V2_GALERIE_R2_URL_PUBLIQUE', urlPub]])
        if (!v) return refus(`${nom} absente : le stockage des images de la Communauté n'est pas configuré (deux buckets déclarés, un privé et un public).`);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(compte)) return refus('V2_GALERIE_R2_COMPTE n\'a pas la forme d\'un identifiant de compte.');
    if (!FORME_BUCKET.test(privee)) return refus('V2_GALERIE_R2_BUCKET_PRIVE n\'a pas la forme d\'un nom de bucket.');
    if (!FORME_BUCKET.test(publique)) return refus('V2_GALERIE_R2_BUCKET_PUBLIC n\'a pas la forme d\'un nom de bucket.');
    if (privee === publique) return refus('V2_GALERIE_R2_BUCKET_PRIVE et V2_GALERIE_R2_BUCKET_PUBLIC désignent le même bucket : refusé (le privé ne doit jamais être lisible publiquement).');
    // chaque bucket doit être DÉDIÉ : aucune autre variable (de nom *BUCKET*, dont R2_BUCKET_IMAGES, V2_VISUELS_PROD_BUCKET, V2_VISUELS_ESSAI_BUCKET, R2_BUCKET_BANC) ne porte le même nom
    for (const [nom, bucket] of [['V2_GALERIE_R2_BUCKET_PRIVE', privee], ['V2_GALERIE_R2_BUCKET_PUBLIC', publique]]) {
        const memeNom = Object.entries(env).filter(([k, v]) => !BUCKETS_GALERIE.includes(k) && /BUCKET/i.test(k) && typeof v === 'string' && v.trim() === bucket).map(([k]) => k);
        if (memeNom.length) return refus(`${nom} porte le même nom que ${memeNom.join(', ')} : refusé (les buckets de la Communauté sont dédiés, jamais un bucket de production ou de banc).`);
        if (bucketsDeProduction(env).includes(bucket)) return refus(`${nom} est un bucket de production : refusé.`);
    }
    let endpoint = t(env.V2_GALERIE_R2_ENDPOINT) || `https://${compte}.r2.cloudflarestorage.com`;
    let hote;
    try { const u = new URL(endpoint); if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.username) throw new Error('forme'); hote = u.host; endpoint = u.origin; } catch { return refus('V2_GALERIE_R2_ENDPOINT n\'est pas une origine https.'); }
    if (!/\.r2\.cloudflarestorage\.com$/.test(hote)) return refus('V2_GALERIE_R2_ENDPOINT doit être un hôte *.r2.cloudflarestorage.com (écriture R2 seulement).');
    let urlPublique, hotePublic;
    try { const u = new URL(urlPub); if (u.protocol !== 'https:' || u.search || u.hash || u.username) throw new Error('forme'); urlPublique = `${u.origin}${u.pathname.replace(/\/+$/, '')}`; hotePublic = u.hostname; } catch { return refus('V2_GALERIE_R2_URL_PUBLIQUE n\'est pas une adresse https.'); }
    if (HOTES_PUBLICS_PRODUCTION.includes(hotePublic)) return refus('V2_GALERIE_R2_URL_PUBLIQUE est l\'hôte public de la production : refusé.');
    return { ok: true, c: { compte, cleId, secret, bucketPrive: privee, bucketPublic: publique, endpoint, hote, urlPublique } };
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
 *   presignerDepot({cle,type,octets,expire}) · presignerLecture({cle,expire}) (bucket privé seulement) · tete(cle) → {octets}|null · lire(cle, max) → Buffer · ecrire(cle, buffer, type) · copier(de, vers)
 *   · supprimer(cle) · lister(prefixe, {apres,max}) → {objets:[{cle,modifie,octets}], suivant} (bucket privé) · verifierMarqueurs() (lève RefusGalerie).
 * Chaque clé va dans SON bucket (bucketDe). `client` (un S3Client) et `maintenant` sont injectables ; le client est enveloppé par garderClientR2 (aucune écriture hors R2_BUCKET_BANC sous BANC_ISOLE=1).
 */
function creerStockage(c, { env = process.env, client = null, maintenant = () => new Date() } = {}) {
    let s3 = client;
    const S3 = () => {
        if (s3) return s3;
        const { S3Client } = require('@aws-sdk/client-s3');
        s3 = require('../../collecte-cartes/garde-banc').garderClientR2(new S3Client({ region: 'auto', endpoint: c.endpoint, credentials: { accessKeyId: c.cleId, secretAccessKey: c.secret }, forcePathStyle: true }), env);
        return s3;
    };
    const bucketDeCle = cle => (bucketDe(cle) === 'public' ? c.bucketPublic : c.bucketPrive);
    const cmd = (nom, bucket, input) => { const k = require('@aws-sdk/client-s3'); return new k[nom]({ Bucket: bucket, ...input }); };
    const exigerEcritureAutorisee = (bucket) => { const v = verifierEcritureR2('PutObjectCommand', bucket, env); if (!v.ok) throw new Error(v.raison); };
    const s = {
        bucketPrive: c.bucketPrive, bucketPublic: c.bucketPublic, urlPublique: c.urlPublique, origineEcriture: c.endpoint,
        presignerDepot({ cle, type, octets, expire }) {
            exigerCle(cle);
            if (bucketDe(cle) !== 'prive') throw new Error('galerie r2 : un dépôt ne vise jamais le bucket public');
            exigerEcritureAutorisee(c.bucketPrive);
            return presigner({ methode: 'PUT', hote: c.hote, chemin: `/${c.bucketPrive}/${cle}`, entetes: { 'content-type': type, 'content-length': octets }, expire, cleId: c.cleId, secret: c.secret, maintenant: maintenant() });
        },
        presignerLecture({ cle, expire }) {
            exigerCle(cle);
            if (bucketDe(cle) !== 'prive') throw new Error('galerie r2 : la lecture signée ne vaut que pour le bucket privé (le public se lit sans signature)');
            return presigner({ methode: 'GET', hote: c.hote, chemin: `/${c.bucketPrive}/${cle}`, expire, cleId: c.cleId, secret: c.secret, maintenant: maintenant() });
        },
        async tete(cle) {
            exigerCle(cle);
            try { const r = await S3().send(cmd('HeadObjectCommand', bucketDeCle(cle), { Key: cle })); return { octets: Number(r.ContentLength) }; }
            catch (e) { if (e && (e.name === 'NotFound' || e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404))) return null; throw e; }
        },
        async lire(cle, max) {
            exigerCle(cle);
            const r = await S3().send(cmd('GetObjectCommand', bucketDeCle(cle), { Key: cle }));
            const morceaux = []; let n = 0;
            for await (const m of r.Body) { n += m.length; if (n > max) { if (typeof r.Body.destroy === 'function') r.Body.destroy(); throw Object.assign(new Error('trop-lourd'), { code: 'TROP_LOURD' }); } morceaux.push(m); }
            return Buffer.concat(morceaux);
        },
        async ecrire(cle, buffer, type) {
            exigerCle(cle);
            await S3().send(cmd('PutObjectCommand', bucketDeCle(cle), { Key: cle, Body: buffer, ContentType: type, CacheControl: bucketDe(cle) === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store' }));
        },
        /** Copie une clé vers une autre : dans le même bucket par CopyObject, d'un bucket à l'autre (attente → pub) par lecture puis écriture — jamais un CopyObject qui traverserait deux buckets. */
        async copier(de, vers) {
            exigerCle(de); exigerCle(vers);
            if (bucketDeCle(de) === bucketDeCle(vers)) { await S3().send(cmd('CopyObjectCommand', bucketDeCle(vers), { Key: vers, CopySource: `${bucketDeCle(de)}/${de}` })); return; }
            await s.ecrire(vers, await s.lire(de, 16 * 1024 * 1024), 'image/webp');
        },
        async supprimer(cle) { exigerCle(cle); await S3().send(cmd('DeleteObjectCommand', bucketDeCle(cle), { Key: cle })); },
        async lister(prefixe, { apres = null, max = 1000 } = {}) {
            exigerCle(`${prefixe}x`);
            if (bucketDe(prefixe) !== 'prive') throw new Error('galerie r2 : le balayage ne liste que le bucket privé');
            const r = await S3().send(cmd('ListObjectsV2Command', c.bucketPrive, { Prefix: prefixe, MaxKeys: max, ...(apres ? { StartAfter: apres } : {}) }));
            const objets = (r.Contents || []).map(o => ({ cle: o.Key, modifie: o.LastModified, octets: Number(o.Size) }));
            return { objets, suivant: r.IsTruncated && objets.length ? objets[objets.length - 1].cle : null };
        },
        /** Les DEUX marqueurs sont là et disent le bon rôle ; sinon RefusGalerie (le bucket n'est pas celui que l'outil d'initialisation a préparé). */
        async verifierMarqueurs() {
            for (const [role, cle] of [['prive', MARQUEUR_PRIVE], ['public', MARQUEUR_PUBLIC]]) {
                let objet = null;
                try { objet = JSON.parse((await s.lire(cle, 4096)).toString('utf8')); } catch (e) { if (!(e && (e.name === 'NotFound' || e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404)) || e instanceof SyntaxError)) throw e; objet = null; }
                if (!objet) throw new RefusGalerie('marqueur-r2-absent', role);
                if (objet.galerie !== true || objet.role !== role) throw new RefusGalerie('marqueur-r2-incorrect', role);
            }
        }
    };
    return s;
}

module.exports = { PREFIXE, MARQUEUR_PRIVE, MARQUEUR_PUBLIC, cleValide, exigerCle, bucketDe, lireConfigR2, presigner, creerStockage, encoder };
