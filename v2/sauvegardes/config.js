'use strict';
// SAUVEGARDES — la configuration, FERMÉE par défaut (échoue fermé) : aucune variable ⇒ éteinte sans bruit ; une variable posée et une autre absente ⇒ fermée, la raison NOMME les variables
// absentes et ne porte jamais une valeur. Même mécanisme sur l'essai et en production : aucune branche « essai ».
//   V2_SAUVEGARDE_CLE            64 chiffres hexadécimaux (32 octets, AES-256-GCM)
//   V2_SAUVEGARDE_BASE           le nom de la base à sauvegarder (doit être celle de la connexion : sinon refus)
//   V2_SAUVEGARDE_R2_COMPTE      identifiant de compte Cloudflare
//   V2_SAUVEGARDE_R2_CLE_ID / V2_SAUVEGARDE_R2_SECRET   le jeton d'écriture (il sait aussi effacer : voir le rapport)
//   V2_SAUVEGARDE_R2_BUCKET      le bucket PRIVÉ
//   V2_SAUVEGARDE_R2_ENDPOINT    facultative : l'hôte de la juridiction (UE : <compte>.eu.r2.cloudflarestorage.com)
// 🔑 LA GARDE DU BUCKET S'ÉCRIT PAR CE QU'ELLE AUTORISE : un nom de forme valide, un hôte *.r2.cloudflarestorage.com en https sans identifiants, et un nom qui n'est celui d'AUCUNE autre variable de bucket de
// l'environnement — sauf les trois buckets nommés PRIVÉS ci-dessous (la liste des buckets privés connus est le petit ensemble stable ; tout bucket qu'on ne sait pas privé, dont le bucket public des images, la
// galerie publique et tout ce qu'on n'a pas prévu, est refusé). Aucune adresse publique n'est admise.
// ⚠️ CE QUE CETTE GARDE PROUVE, ET CE QU'ELLE NE PROUVE PAS : elle prouve que le nom n'est pas celui d'un bucket que le dépôt sait PUBLIC ; elle ne prouve pas que le bucket est privé. Aucune sonde du service ne le peut : un point
// d'accès S3 refuse l'anonyme même pour un bucket public, donc « essayer de lire sans signature » ne peut pas échouer dans le cas redouté (on ne la simule donc pas). Le caractère PRIVÉ (accès r2.dev éteint, aucun domaine
// personnalisé) est établi UNE fois, à l'installation, par l'API Cloudflare, et sa date est écrite dans le rapport d'installation. Le marqueur exigé avant la première écriture prouve seulement « initialisé par l'outil ».
const { FORME_BASE } = require('./chemins');
const { cleDepuisHex } = require('./chiffrement');

const NOMS = Object.freeze(['V2_SAUVEGARDE_CLE', 'V2_SAUVEGARDE_BASE', 'V2_SAUVEGARDE_R2_COMPTE', 'V2_SAUVEGARDE_R2_CLE_ID', 'V2_SAUVEGARDE_R2_SECRET', 'V2_SAUVEGARDE_R2_BUCKET']);
const AUTRES = Object.freeze(['V2_SAUVEGARDE_R2_ENDPOINT', 'V2_SAUVEGARDE_R2_URL_PUBLIQUE']);
// Les variables dont la valeur est un bucket PRIVÉ connu : un bucket égal à l'une d'elles est admis (c'est le même bucket privé, sous un autre préfixe).
const BUCKETS_PRIVES = Object.freeze(['V2_VISUELS_R2_BUCKET', 'R2_BUCKET_BRUT', 'V2_GALERIE_R2_BUCKET_PRIVE']);
const FORME_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const FORME_COMPTE = /^[A-Za-z0-9-]{8,64}$/;
const texte = v => (typeof v === 'string' ? v.trim() : '');

/** Un endpoint admis : https, *.r2.cloudflarestorage.com (éventuellement une juridiction), sans identifiants, chemin ni requête. */
function endpointAdmis(brut) {
    let u; try { u = new URL(brut); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || u.port) return null;
    if (!/^[a-z0-9-]{8,64}(\.(eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(u.hostname)) return null;
    return u.origin;
}

/** @returns {{ok:true,c:object}|{ok:false,vide?:true,raison?:string}} */
function lireConfigSauvegardes(env = process.env) {
    const posees = [...NOMS, ...AUTRES].filter(n => texte(env[n]));
    if (!posees.length) return { ok: false, vide: true };
    const manque = NOMS.filter(n => !texte(env[n]));
    if (manque.length) return { ok: false, raison: `variables absentes : ${manque.join(', ')}` };
    if (texte(env.V2_SAUVEGARDE_R2_URL_PUBLIQUE)) return { ok: false, raison: 'V2_SAUVEGARDE_R2_URL_PUBLIQUE posée : une sauvegarde n\'a aucune adresse publique (refusé)' };
    let cle; try { cle = cleDepuisHex(env.V2_SAUVEGARDE_CLE); } catch { return { ok: false, raison: 'V2_SAUVEGARDE_CLE n\'est pas une clé de 64 chiffres hexadécimaux' }; }
    const base = texte(env.V2_SAUVEGARDE_BASE), compte = texte(env.V2_SAUVEGARDE_R2_COMPTE), bucket = texte(env.V2_SAUVEGARDE_R2_BUCKET);
    if (!FORME_BASE.test(base)) return { ok: false, raison: 'V2_SAUVEGARDE_BASE n\'a pas la forme d\'un nom de base' };
    if (!FORME_COMPTE.test(compte)) return { ok: false, raison: 'V2_SAUVEGARDE_R2_COMPTE n\'a pas la forme d\'un identifiant de compte' };
    if (!FORME_BUCKET.test(bucket)) return { ok: false, raison: 'V2_SAUVEGARDE_R2_BUCKET n\'a pas la forme d\'un nom de bucket' };
    const memeNom = Object.entries(env).filter(([k, v]) => k !== 'V2_SAUVEGARDE_R2_BUCKET' && /BUCKET/i.test(k) && texte(v) === bucket).map(([k]) => k);
    const inconnus = memeNom.filter(k => !BUCKETS_PRIVES.includes(k));
    if (inconnus.length) return { ok: false, raison: `V2_SAUVEGARDE_R2_BUCKET porte le même nom que ${inconnus.join(', ')} : refusé (seuls les buckets privés connus sont admis)` };
    const brutEndpoint = texte(env.V2_SAUVEGARDE_R2_ENDPOINT) || `https://${compte}.r2.cloudflarestorage.com`;
    const endpoint = endpointAdmis(brutEndpoint);
    if (!endpoint) return { ok: false, raison: 'V2_SAUVEGARDE_R2_ENDPOINT n\'est pas un hôte https *.r2.cloudflarestorage.com sans identifiants' };
    // la config rendue ne porte la clé et le secret que dans des propriétés NON énumérables : ni JSON.stringify ni console.log ne les impriment
    const c = { base, compte, bucket, endpoint };
    Object.defineProperty(c, 'cle', { value: cle, enumerable: false });
    Object.defineProperty(c, 'cleId', { value: texte(env.V2_SAUVEGARDE_R2_CLE_ID), enumerable: false });
    Object.defineProperty(c, 'secret', { value: texte(env.V2_SAUVEGARDE_R2_SECRET), enumerable: false });
    return { ok: true, c };
}
module.exports = { lireConfigSauvegardes, endpointAdmis, NOMS, AUTRES, BUCKETS_PRIVES };
