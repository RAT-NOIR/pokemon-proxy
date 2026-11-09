'use strict';
// SAUVEGARDES — le stockage : un bucket R2 PRIVÉ, un préfixe imposé par le code (jamais par l'appelant). Chaque clé, en lecture comme en écriture, doit commencer par PREFIXE, sans `..`, sans segment vide :
// ce module ne sait RIEN écrire, lire ni effacer ailleurs. L'envoi se fait en flux (multipart) : jamais plus d'une partie en mémoire. Les opérations sont comptées par classe (A : écriture et liste, B : lecture),
// comme R2 les facture. Le client S3 est chargé À LA DEMANDE (jamais à l'import) ; `client` est injectable (les bancs passent un faux : aucune requête réelle).
const { PREFIXE } = require('./chemins');
const { refuser } = require('./erreurs');

const PART_OCTETS = 8 * 1024 * 1024;   // R2 : 5 Mio au moins par partie (sauf la dernière), toutes de la même taille
const CLE_MARQUEUR = `${PREFIXE}marqueur-prive.json`;

function exigerCle(cle) {
    if (typeof cle !== 'string' || !cle.startsWith(PREFIXE) || cle.length > 300 || cle.includes('..') || cle.includes('//') || cle.endsWith('/') || /[^A-Za-z0-9_./-]/.test(cle)) refuser('cle-hors-prefixe');
    return cle;
}
const absent = e => e && (e.name === 'NotFound' || e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404));

function creerClient(c) {
    const { S3Client } = require('@aws-sdk/client-s3');
    // garderClientR2 : sous BANC_ISOLE=1 (un banc), toute écriture hors R2_BUCKET_BANC est refusée ; hors banc (l'essai, la production), c'est un passe-plat.
    return require('../../collecte-cartes/garde-banc').garderClientR2(new S3Client({ region: 'auto', endpoint: c.endpoint, credentials: { accessKeyId: c.cleId, secretAccessKey: c.secret }, forcePathStyle: true }));
}

function creerStockageR2(c, { client = null, partOctets = PART_OCTETS } = {}) {
    let s3 = client;
    const S3 = () => (s3 = s3 || creerClient(c));
    const K = () => require('@aws-sdk/client-s3');
    const ops = { A: 0, B: 0 };
    const envoyerCmd = async (Classe, input, classe) => { ops[classe]++; return S3().send(new (K()[Classe])({ Bucket: c.bucket, ...input })); };
    const s = {
        bucket: c.bucket,
        operations: () => ({ ...ops }),
        /** Envoie un flux : un seul PutObject s'il tient dans une partie, sinon un multipart abandonné proprement (AbortMultipartUpload) au moindre échec. @returns {{octets:number}} */
        async envoyer(cle, source) {
            exigerCle(cle);
            let tampon = [], taille = 0, total = 0, idTeleversement = null, numero = 0; const parties = [];
            const vider = async (derniere) => {
                const corps = Buffer.concat(tampon, taille); tampon = []; taille = 0;
                if (idTeleversement === null) {
                    if (derniere) { await envoyerCmd('PutObjectCommand', { Key: cle, Body: corps, ContentType: 'application/octet-stream' }, 'A'); return; }
                    idTeleversement = (await envoyerCmd('CreateMultipartUploadCommand', { Key: cle, ContentType: 'application/octet-stream' }, 'A')).UploadId;
                }
                numero++;
                const r = await envoyerCmd('UploadPartCommand', { Key: cle, UploadId: idTeleversement, PartNumber: numero, Body: corps }, 'A');
                parties.push({ ETag: r.ETag, PartNumber: numero });
            };
            try {
                for await (const m of source) {
                    let b = Buffer.from(m);
                    while (b.length) {
                        const place = partOctets - taille, part = b.subarray(0, place);
                        tampon.push(part); taille += part.length; total += part.length; b = b.subarray(part.length);
                        if (taille >= partOctets) await vider(false);
                    }
                }
                if (idTeleversement === null) await vider(true);
                else { if (taille > 0 || !parties.length) await vider(true); await envoyerCmd('CompleteMultipartUploadCommand', { Key: cle, UploadId: idTeleversement, MultipartUpload: { Parts: parties } }, 'A'); }
            } catch (e) {
                if (idTeleversement !== null) { try { await envoyerCmd('AbortMultipartUploadCommand', { Key: cle, UploadId: idTeleversement }, 'A'); } catch { /* l'abandon échoue : la règle de cycle de vie du bucket le rattrape */ } }
                throw e;
            }
            return { octets: total };
        },
        async tete(cle) {
            exigerCle(cle);
            try { const r = await envoyerCmd('HeadObjectCommand', { Key: cle }, 'B'); return { octets: Number(r.ContentLength), modifie: r.LastModified || null }; }
            catch (e) { if (absent(e)) return null; throw e; }
        },
        /** @returns {Promise<AsyncIterable<Buffer>>} le corps de l'objet ; objet absent ⇒ refus nommé. */
        async lire(cle) {
            exigerCle(cle);
            try { return (await envoyerCmd('GetObjectCommand', { Key: cle }, 'B')).Body; }
            catch (e) { if (absent(e)) refuser('objet-absent'); throw e; }
        },
        async supprimer(cle) { exigerCle(cle); await envoyerCmd('DeleteObjectCommand', { Key: cle }, 'A'); },
        /** Tous les objets sous un préfixe (pagination comprise). @returns {Promise<{cle:string,octets:number,modifie:Date}[]>} */
        async lister(prefixe) {
            exigerCle(`${prefixe}x`);
            const sortie = []; let jeton;
            for (let page = 0; page < 1000; page++) {
                const r = await envoyerCmd('ListObjectsV2Command', { Prefix: prefixe, ...(jeton ? { ContinuationToken: jeton } : {}) }, 'A');
                for (const o of r.Contents || []) sortie.push({ cle: o.Key, octets: Number(o.Size), modifie: o.LastModified });
                if (!r.IsTruncated || !r.NextContinuationToken) break;
                jeton = r.NextContinuationToken;
            }
            return sortie;
        },
        /** La preuve POSITIVE d'un bucket préparé pour les sauvegardes : le marqueur posé par l'outil d'initialisation. Absent ou autre chose ⇒ refus. */
        async verifierMarqueur() {
            let corps;
            try { corps = JSON.parse((await lireTout(await s.lire(CLE_MARQUEUR), 4096)).toString('utf8')); } catch (e) { if (e && e.code === 'objet-absent') refuser('marqueur-absent'); refuser('marqueur-incorrect'); }
            if (!corps || corps.sauvegardes !== true || corps.role !== 'prive') refuser('marqueur-incorrect');
        },
        async poserMarqueur() { await s.envoyer(CLE_MARQUEUR, require('stream').Readable.from([Buffer.from(JSON.stringify({ sauvegardes: true, role: 'prive' }))])); }
    };
    return s;
}
async function lireTout(source, max) {
    const m = []; let n = 0;
    for await (const b of source) { n += b.length; if (n > max) refuser('trop-grand'); m.push(Buffer.from(b)); }
    return Buffer.concat(m);
}
module.exports = { creerStockageR2, creerClient, exigerCle, PREFIXE, CLE_MARQUEUR, PART_OCTETS, lireTout };
