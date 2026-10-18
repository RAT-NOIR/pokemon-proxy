'use strict';
// INDEX-EMPREINTES (tour de correction 1) — GET /api/modele-empreinte/<sha256> : répond par une REDIRECTION 302 vers une adresse R2 PRÉSIGNÉE (lecture seule, 600 s au plus) de l'objet du modèle (≈ 113 Mo, bucket R2 PRIVÉ).
// Le modèle ne transite JAMAIS par l'API : Render n'inclut que 5 Go de bande passante par mois ; un flux de 113 Mo par installation la viderait en une quarantaine de téléchargements. Il n'existe AUCUN repli en flux :
// un repli silencieux viderait le quota sans que personne le voie. Écrit par ce qu'elle AUTORISE :
//   · monté SEULEMENT si V2_EMPREINTE_EXTENSION=1 (éteint : la route n'existe pas, 404) ;
//   · UN seul chemin mène à une adresse : le sha256 de l'adresse est exactement celui de la configuration (V2_MODELE_EMPREINTE_SHA256, le sha256 du FICHIER), sinon 404 ;
//   · un HEAD de l'objet AVANT de signer : métadonnée `sha256` = celle de la configuration ET taille = V2_MODELE_EMPREINTE_OCTETS (si donnée), sinon 502 et rien n'est signé ; le corps de l'objet n'est jamais lu ;
//   · la signature est faite EN LOCAL (SigV4, aucun réseau) avec la clé de LECTURE de l'archive des visuels (V2_VISUELS_R2_CLE_ID / _SECRET) : l'adresse présignée ne peut être qu'un GET de cet objet, `host` seul signé ;
//   · la réponse porte `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, aucun corps : l'adresse contient l'identifiant de la clé de lecture et la signature temporaire, ni le secret ni autre chose.
// Range et la revalidation sont servis par R2 (pas par l'API). La VÉRIFICATION d'intégrité du fichier reçu reste celle de l'extension (sha256 contre le contrat).
const crypto = require('crypto');
const R2 = require('../chargeur/r2-prive');

const EXPIRE_S = 600;                                                                          // 10 minutes, la borne du ruling : jamais plus
const NOMS_R2 = Object.freeze(['V2_VISUELS_R2_COMPTE', 'V2_VISUELS_R2_CLE_ID', 'V2_VISUELS_R2_SECRET', 'V2_VISUELS_R2_BUCKET']);
const SHA = /^[0-9a-f]{64}$/;

const hmac = (cle, donnee) => crypto.createHmac('sha256', cle).update(donnee).digest();
const hex = d => crypto.createHash('sha256').update(d).digest('hex');
const encoder = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Une adresse présignée SigV4 (GET, signature dans la chaîne de requête, `host` seul signé, charge utile non signée). Pure : aucune horloge cachée, aucun réseau. */
function presigner(o) {
    const expireS = o.expireS === undefined ? EXPIRE_S : o.expireS;
    if (!Number.isInteger(expireS) || expireS < 1 || expireS > EXPIRE_S) throw new Error(`durée de l'adresse hors de 1..${EXPIRE_S} s`);
    return signerSigV4({ ...o, expireS });
}
/** Le calcul SigV4 SEUL, sans la borne de 600 s : exporté pour le vecteur publié par AWS (86 400 s) du banc, jamais appelé par la route. */
function signerSigV4({ hote, cheminCanonique, cleId, secret, region, service = 's3', maintenant, expireS, schema = 'https' }) {
    const amz = maintenant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');          // 20260101T120000Z
    const jour = amz.slice(0, 8), portee = `${jour}/${region}/${service}/aws4_request`;
    const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${cleId}/${portee}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expireS), 'X-Amz-SignedHeaders': 'host' };
    const chaine = Object.keys(q).sort().map(k => `${encoder(k)}=${encoder(q[k])}`).join('&');
    const canonique = ['GET', cheminCanonique, chaine, `host:${hote}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const asigner = ['AWS4-HMAC-SHA256', amz, portee, hex(canonique)].join('\n');
    const cle = hmac(hmac(hmac(hmac('AWS4' + secret, jour), region), service), 'aws4_request');
    return `${schema}://${hote}${cheminCanonique}?${chaine}&X-Amz-Signature=${hmac(cle, asigner).toString('hex')}`;
}

function erreur(res, statut, message, extra = {}) {
    if (extra.retryApres !== undefined) res.setHeader('Retry-After', String(extra.retryApres));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(statut).json({ success: false, error: message });
}

/** La source : l'objet R2 privé (HEAD par le client S3, injectable) et la signature locale. `raison` si la configuration ne permet rien. */
function creerSource(cfg, { client = null, env = process.env, maintenant = () => new Date() } = {}) {
    const m = cfg.modeleEmpreinte || {};
    const manque = [...NOMS_R2.filter(n => !(typeof env[n] === 'string' && env[n].trim())), ...(m.objetModele ? [] : ['V2_MODELE_EMPREINTE_OBJET'])];
    if (manque.length) return { raison: `variables absentes : ${manque.join(', ')}` };
    const compte = env.V2_VISUELS_R2_COMPTE.trim(), cleId = env.V2_VISUELS_R2_CLE_ID.trim(), secret = env.V2_VISUELS_R2_SECRET.trim(), bucket = env.V2_VISUELS_R2_BUCKET.trim();
    const endpoint = (typeof env.V2_VISUELS_R2_ENDPOINT === 'string' && env.V2_VISUELS_R2_ENDPOINT.trim()) || `https://${compte}.r2.cloudflarestorage.com`;
    let hote; try { const u = new URL(endpoint); if (u.protocol !== 'https:') throw new Error('schema'); hote = u.host; } catch { return { raison: 'V2_VISUELS_R2_ENDPOINT n\'est pas une adresse https' }; }
    let cl = client;
    return {
        async decrire() {
            const { HeadObjectCommand } = require('@aws-sdk/client-s3');
            if (!cl) cl = R2.creerClient({ compte, cleId, secret, endpoint });
            const r = await cl.send(new HeadObjectCommand({ Bucket: bucket, Key: m.objetModele }), { abortSignal: AbortSignal.timeout(R2.DELAI_MS) });
            return { taille: Number(r.ContentLength), sha256: r.Metadata && r.Metadata.sha256 };
        },
        signer() {
            const chemin = '/' + [bucket, ...m.objetModele.split('/')].map(encoder).join('/');
            return presigner({ hote, cheminCanonique: chemin, cleId, secret, region: 'auto', maintenant: maintenant() });
        }
    };
}

/** Le gestionnaire Express. `deps` ne règle que les injections des bancs (client S3, environnement, horloge). */
function creerRoute(cfg, deps = {}) {
    const source = creerSource(cfg, deps);
    return async function modeleEmpreinte(req, res) {
        const m = cfg.modeleEmpreinte || {};
        const sha = req.params && req.params.sha256;
        if (!m.sha256 || typeof sha !== 'string' || !SHA.test(sha) || sha !== m.sha256) return erreur(res, 404, 'Introuvable');
        if (source.raison) { console.error(`❌ [v2 modèle-empreinte] non servi (${source.raison})`); return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 300 }); }
        try {
            let d;
            try { d = await source.decrire(); }
            catch (e) { console.error(`❌ [v2 modèle-empreinte] lecture impossible (${(e && (e.name || e.code)) || 'erreur'})`); return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 60 }); }
            if (!Number.isSafeInteger(d.taille) || d.taille <= 0 || d.sha256 !== m.sha256 || (m.octets && d.taille !== m.octets)) {
                console.error('❌ [v2 modèle-empreinte] l\'objet ne correspond pas à la configuration (taille ou sha256) : rien n\'est signé');
                return erreur(res, 502, 'Fichier indisponible');
            }
            const adresse = source.signer();
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Referrer-Policy', 'no-referrer');
            res.setHeader('Location', adresse);
            return res.status(302).end();
        } catch (e) {
            console.error(`❌ [v2 modèle-empreinte] ${(e && (e.code || e.name)) || 'erreur'}`);
            return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 60 });
        }
    };
}

module.exports = { creerRoute, creerSource, presigner, signerSigV4, EXPIRE_S, NOMS_R2 };
