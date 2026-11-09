'use strict';
// SAUVEGARDES — aides des bancs : un FAUX client S3 (aucun réseau, aucun bucket réel) qui comprend les commandes que v2/sauvegardes/stockage-r2.js envoie,
// avec des pannes injectables, et un compteur d'opérations par classe (A : écriture et liste, B : lecture), comme la facturation de R2.
const { Readable } = require('stream');
const CLASSE_A = new Set(['PutObjectCommand', 'CreateMultipartUploadCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand', 'ListObjectsV2Command', 'CopyObjectCommand']);
const CLASSE_B = new Set(['GetObjectCommand', 'HeadObjectCommand']);

function fauxS3({ echecApresOctets = null, echecListe = false } = {}) {
    const objets = new Map();          // clé -> { corps: Buffer, modifie: Date }
    const televersements = new Map();  // id -> { cle, parties: Map }
    const ops = { A: 0, B: 0, supprimes: 0 }, journalCmd = [];
    let recus = 0, plusGrosMorceau = 0, seq = 0;
    const erreur = (nom, http) => Object.assign(new Error(nom), { name: nom, $metadata: { httpStatusCode: http } });
    const recevoir = (b) => {
        recus += b.length; plusGrosMorceau = Math.max(plusGrosMorceau, b.length);
        if (echecApresOctets !== null && recus > echecApresOctets) throw erreur('ErreurReseauInjectee', 500);
    };
    const client = {
        async send(cmd) {
            const nom = cmd.constructor.name, i = cmd.input || {};
            journalCmd.push({ nom, cle: i.Key, bucket: i.Bucket });
            if (CLASSE_A.has(nom)) ops.A++; if (CLASSE_B.has(nom)) ops.B++;
            switch (nom) {
                case 'PutObjectCommand': { const b = Buffer.from(i.Body); recevoir(b); objets.set(i.Key, { corps: b, modifie: i.__modifie || new Date() }); return {}; }
                case 'CreateMultipartUploadCommand': { const id = `t${++seq}`; televersements.set(id, { cle: i.Key, parties: new Map() }); return { UploadId: id }; }
                case 'UploadPartCommand': { const t = televersements.get(i.UploadId); const b = Buffer.from(i.Body); recevoir(b); t.parties.set(i.PartNumber, b); return { ETag: `"e${i.PartNumber}"` }; }
                case 'CompleteMultipartUploadCommand': { const t = televersements.get(i.UploadId); const n = [...t.parties.keys()].sort((a, b) => a - b); objets.set(t.cle, { corps: Buffer.concat(n.map(k => t.parties.get(k))), modifie: new Date() }); televersements.delete(i.UploadId); return {}; }
                case 'AbortMultipartUploadCommand': televersements.delete(i.UploadId); return {};
                case 'HeadObjectCommand': { const o = objets.get(i.Key); if (!o) throw erreur('NotFound', 404); return { ContentLength: o.corps.length, LastModified: o.modifie }; }
                case 'GetObjectCommand': { const o = objets.get(i.Key); if (!o) throw erreur('NoSuchKey', 404); return { Body: Readable.from([o.corps]), ContentLength: o.corps.length }; }
                case 'DeleteObjectCommand': ops.supprimes++; objets.delete(i.Key); return {};
                case 'ListObjectsV2Command': {
                    if (echecListe) throw erreur('InternalError', 500);
                    const cles = [...objets.keys()].filter(k => k.startsWith(i.Prefix || '')).sort();
                    return { Contents: cles.map(k => ({ Key: k, Size: objets.get(k).corps.length, LastModified: objets.get(k).modifie })), IsTruncated: false };
                }
                default: throw new Error(`faux S3 : commande non prévue ${nom}`);
            }
        }
    };
    return { client, objets, televersements, ops, journalCmd, plusGrosMorceau: () => plusGrosMorceau, ajouter: (cle, corps, modifie = new Date()) => objets.set(cle, { corps: Buffer.from(corps), modifie }) };
}

const CLE_TEST = 'a1'.repeat(32);       // 64 chiffres hexadécimaux : 32 octets, jamais une vraie clé
const AUTRE_CLE = 'b2'.repeat(32);
const ENV_VALIDE = Object.freeze({
    V2_SAUVEGARDE_CLE: CLE_TEST, V2_SAUVEGARDE_BASE: 'rm_essai', V2_SAUVEGARDE_R2_COMPTE: 'abcdef0123456789abcdef0123456789',
    V2_SAUVEGARDE_R2_CLE_ID: 'id-essai-0001', V2_SAUVEGARDE_R2_SECRET: 'secret-essai-0001', V2_SAUVEGARDE_R2_BUCKET: 'rm-prive-essai',
});
module.exports = { fauxS3, CLE_TEST, AUTRE_CLE, ENV_VALIDE };
