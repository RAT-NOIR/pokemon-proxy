'use strict';
// B6.2 — le stockage privé du banc réel et l'image sans métadonnées.
// Ruling 2026-10-10 : le bucket du banc réel est celui de V2_BANC_BUCKET (le nom seulement) ; R2_BUCKET_BANC et les clés R2_BANC_*
// sont réservés aux bancs de test. Le stockage refuse tout bucket qui n'est pas EXACTEMENT V2_BANC_BUCKET, et refuse aussi un
// V2_BANC_BUCKET réglé par erreur sur un bucket de production ou de test. Variable absente => refus (fail-closed).
const crypto = require('crypto');

const PREFIXE = 'banc-reel/v2/';
const OCTETS_MAX = 5 * 1024 * 1024;
const W = 640, H = 894, TOL = 0.10;
const CLE = /^banc-reel\/v2\/(attente\/)?[0-9a-f]{32}\.webp$/;

function refus(code, message) { const e = new Error(message || code); e.code = code; return e; }

/** Image redressée -> WebP 640x894 SANS métadonnées. La photo d'origine (autre taille) est refusée, jamais conservée. */
async function traiterImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > OCTETS_MAX) throw refus('image-refusee');
    let sharp;
    try {
        sharp = require('sharp');
        const meta = await sharp(buffer, { failOn: 'error', limitInputPixels: 50e6 }).metadata();
        const w = meta.width, h = meta.height;
        if (!(w >= W * (1 - TOL) && w <= W * (1 + TOL) && h >= H * (1 - TOL) && h <= H * (1 + TOL))) throw refus('image-refusee');
        // sharp n'écrit aucune métadonnée de sortie par défaut (pas de withMetadata) : ni EXIF, ni XMP, ni profil ICC.
        const sortie = await sharp(buffer, { failOn: 'error', limitInputPixels: 50e6 })
            .resize(W, H, { fit: 'fill' }).webp({ quality: 85 }).toBuffer();
        return { buffer: sortie, w: W, h: H };
    } catch (e) {
        throw e && e.code === 'image-refusee' ? e : refus('image-refusee');
    }
}

/** ETIQUETAGE-B : la photo d'annonce BRUTE d'un scan de l'administrateur -> WebP sans métadonnées, plus grand côté 1600 au plus (jamais agrandie), orientation appliquée.
 *  Même format et même encodeur que `traiterImage`, mais SANS la contrainte de taille d'une image redressée. Tout ce qui n'est pas une image lisible de 5 Mo au plus est refusé. */
const COTE_PHOTO_MAX = 1600;
async function traiterPhoto(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > OCTETS_MAX) throw refus('image-refusee');
    try {
        const sharp = require('sharp');
        const sortie = await sharp(buffer, { failOn: 'error', limitInputPixels: 50e6 }).rotate()
            .resize(COTE_PHOTO_MAX, COTE_PHOTO_MAX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
        return { buffer: sortie.data, w: sortie.info.width, h: sortie.info.height };
    } catch { throw refus('image-refusee'); }
}

/** Clé de stockage : hex aléatoire, jamais dérivée d'une donnée de l'utilisateur. */
function nouvelleCle(attente = false) {
    return PREFIXE + (attente ? 'attente/' : '') + crypto.randomBytes(16).toString('hex') + '.webp';
}

/** client = { deposerBinaire(bucket, cle, buffer, contentType), supprimer(bucket, cles) } (la forme de collecte-cartes/r2.js). */
function creerStockage({ client, bucket, env = process.env } = {}) {
    const voulu = env.V2_BANC_BUCKET;
    if (typeof voulu !== 'string' || !voulu) throw refus('bucket-refuse', 'V2_BANC_BUCKET absente : le banc réel n\'a pas de stockage');
    if (typeof bucket !== 'string' || bucket !== voulu) throw refus('bucket-refuse', 'le bucket n\'est pas celui de V2_BANC_BUCKET');
    for (const n of ['R2_BUCKET_IMAGES', 'R2_BUCKET_BRUT', 'R2_BUCKET_BANC']) {
        if (env[n] && env[n] === bucket) throw refus('bucket-refuse', 'V2_BANC_BUCKET ne peut pas désigner le bucket de ' + n);
    }
    if (!client || typeof client.deposerBinaire !== 'function' || typeof client.supprimer !== 'function') throw refus('client-invalide');
    const cleOk = (c) => typeof c === 'string' && CLE.test(c);
    return {
        async ecrire(cle, buffer) {
            if (!cleOk(cle) || !Buffer.isBuffer(buffer)) throw refus('cle-refusee');
            await client.deposerBinaire(bucket, cle, buffer, 'image/webp');
            return cle;
        },
        async supprimer(cle) {
            if (!cleOk(cle)) throw refus('cle-refusee');
            await client.supprimer(bucket, [cle]);
        },
        // B6.3 : relire un objet du banc (l'image qui passe de attente/ à son emplacement final). Même garde de clé ; le client doit savoir lire.
        async lire(cle) {
            if (!cleOk(cle)) throw refus('cle-refusee');
            if (typeof client.lireBinaire !== 'function') throw refus('client-invalide');
            const b = await client.lireBinaire(bucket, cle);
            if (!Buffer.isBuffer(b)) throw refus('lecture-refusee');
            return b;
        },
        // B6.4 (filet des orphelins) : les objets du préfixe du banc avec leur date. Même garde de clé que ecrire/supprimer : tout ce qui n'a pas la forme
        // banc-reel/v2/[attente/]<hex>.webp (hors préfixe, fichier étranger) n'est JAMAIS rendu, donc jamais supprimé. Un objet sans date lisible non plus.
        async lister() {
            if (typeof client.listerObjets !== 'function') throw refus('client-invalide');
            const l = await client.listerObjets(bucket, PREFIXE);
            if (!Array.isArray(l)) throw refus('lecture-refusee');
            return l.filter(o => o && cleOk(o.cle) && o.modifieLe instanceof Date && Number.isFinite(+o.modifieLe)).map(o => ({ cle: o.cle, modifieLe: o.modifieLe }));
        },
    };
}

/** Stockage réel : le client de collecte-cartes/r2.js, chargé seulement APRÈS le contrôle du bucket. L'appelant fait `await verifierBucket()` (endpoint UE). */
function creerStockageReel(env = process.env) {
    const bucket = env.V2_BANC_BUCKET;
    if (typeof bucket !== 'string' || !bucket) throw refus('bucket-refuse', 'V2_BANC_BUCKET absente : le banc réel n\'a pas de stockage');
    const r2 = require('../../collecte-cartes/r2');
    const st = creerStockage({ client: r2, bucket, env });
    st.verifierBucket = () => r2.verifierBucket(bucket);
    return st;
}

/** Pour les tests : mêmes gardes de clé, rien d'externe. */
function creerStockageMemoire() {
    const o = new Map(), dates = new Map();
    return {
        async verifierBucket() { /* explicite : la mémoire n'a ni bucket ni endpoint à vérifier */ },
        async ecrire(cle, buffer) { if (!CLE.test(String(cle)) || !Buffer.isBuffer(buffer)) throw refus('cle-refusee'); o.set(cle, buffer); dates.set(cle, new Date()); return cle; },
        async supprimer(cle) { o.delete(cle); dates.delete(cle); },
        async lire(cle) { if (!CLE.test(String(cle)) || !o.has(cle)) throw refus('cle-refusee'); return o.get(cle); },
        async lister() { return [...o.keys()].map(cle => ({ cle, modifieLe: dates.get(cle) })); },
        cles() { return [...o.keys()]; },
    };
}

module.exports = { traiterImage, traiterPhoto, creerStockage, creerStockageReel, creerStockageMemoire, nouvelleCle, PREFIXE };
