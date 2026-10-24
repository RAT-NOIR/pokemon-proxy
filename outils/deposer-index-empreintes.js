'use strict';
// INDEX-EMPREINTES — le DÉPÔT sur R2 PRIVÉ de l'index scellé (RMEI) et du FICHIER du modèle, côté PRODUCTEUR (hors API). Clés d'ÉCRITURE limitées au bucket (V2_VISUELS_R2_ECR_CLE_ID / _ECR_SECRET), comme l'archive.
//   node outils/deposer-index-empreintes.js --index <index.rmei> --modele <modele.onnx> --modele-id <id> --objet-index <clé> --objet-modele <clé> --bucket <nom>             À BLANC (le défaut) : vérifie tout en local, n'ouvre AUCUN réseau, n'écrit rien
//   … --ecrire                                                                                                                              dépose (jamais sans ce drapeau)
// Écrit par ce qu'il AUTORISE : deux noms NEUFS, jamais celui de l'archive ni de l'index en place ; un objet qui existe déjà = arrêt (HeadObject), ET le dépôt est conditionnel (If-None-Match: *) : aucun écrasement possible,
// même en course. Aucune suppression nulle part (ce script n'importe aucune commande de suppression). Le fichier du modèle porte son sha256 en métadonnée (la route le relit avant d'envoyer un octet). Après le dépôt :
// relecture (taille + sha256 pour les deux objets). Le secret HMAC (V2_VISUELS_HMAC) ne sert qu'à vérifier que l'index s'ouvre ; il n'est jamais imprimé.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const R2 = require('../v2/chargeur/r2-prive');
const X = require('../v2/identifier/index-empreintes');

const NOMS_ECRITURE = Object.freeze(['V2_VISUELS_R2_COMPTE', 'V2_VISUELS_R2_ECR_CLE_ID', 'V2_VISUELS_R2_ECR_SECRET', 'V2_VISUELS_R2_BUCKET', 'V2_VISUELS_HMAC']);
const OBJET = /^[A-Za-z0-9._/-]{1,200}$/;
const sha256Fichier = f => new Promise((ok, ko) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
const absent = e => e && (e.name === 'NotFound' || e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404));

const texte = v => (typeof v === 'string' ? v.trim() : '');

/** 🔑 Le BUCKET VISÉ, écrit par ce qu'il AUTORISE : `--bucket` est obligatoire (aucune valeur par défaut) et doit être ÉGAL au bucket PRIVÉ que lit la route (V2_VISUELS_R2_BUCKET) ;
 *  il ne doit jamais être celui des images de production (R2_BUCKET_IMAGES, si la variable est posée). Variable du bucket privé absente ou vide, ou nom vide : l'outil ne peut pas conclure, il REFUSE.
 *  Aucune requête n'est faite ici. Les messages nomment des VARIABLES, jamais la valeur d'un autre bucket. @returns le nom du bucket accepté. */
function verifierBucket({ bucket, env }) {
    const demande = texte(bucket);
    if (!demande) throw new Error('--bucket est obligatoire (aucune valeur par défaut) : nommer le bucket PRIVÉ du modèle, celui que lit la route');
    const prive = texte(env.V2_VISUELS_R2_BUCKET);
    if (!prive) throw new Error('V2_VISUELS_R2_BUCKET absente ou vide : le bucket privé du modèle n\'est pas connu, je ne peux pas conclure : arrêt');
    if (demande !== prive) throw new Error('--bucket n\'est pas égal à V2_VISUELS_R2_BUCKET, le bucket que lit la route : arrêt');
    const images = texte(env.R2_BUCKET_IMAGES);
    if (images && demande === images) throw new Error('--bucket est le bucket des IMAGES de production (R2_BUCKET_IMAGES) : ce script n\'y dépose jamais');
    return demande;
}

/** Prépare et vérifie TOUT en local. @returns le plan { bucket, index: {fichier, octets, sha256, n}, modele: {fichier, octets, sha256}, objets } — lève une Error nommée si quelque chose cloche. */
async function preparer({ index, modele, modeleId, objetIndex, objetModele, bucket, env }) {
    const bucketVerifie = verifierBucket({ bucket, env });
    for (const [nom, v] of [['--objet-index', objetIndex], ['--objet-modele', objetModele]]) if (!OBJET.test(String(v || ''))) throw new Error(`${nom} : nom d'objet invalide ([A-Za-z0-9._/-]{1,200})`);
    if (objetIndex === objetModele) throw new Error('les deux objets doivent avoir deux noms différents');
    const protege = [env.V2_VISUELS_R2_OBJET, env.V2_EMPREINTES_R2_OBJET].filter(Boolean);
    for (const o of [objetIndex, objetModele]) if (protege.includes(o)) throw new Error(`« ${o} » est le nom d'un objet EN PLACE (archive ou index) : ce script n'écrase jamais`);
    const manque = NOMS_ECRITURE.filter(n => !(typeof env[n] === 'string' && env[n].trim()));
    if (manque.length) throw new Error(`variables absentes : ${manque.join(', ')}`);
    if (!fs.existsSync(index) || !fs.existsSync(modele)) throw new Error('fichier introuvable (--index ou --modele)');
    const shaModele = await sha256Fichier(modele);
    const corpsIndex = fs.readFileSync(index);
    const ouvert = X.ouvrir(corpsIndex, env.V2_VISUELS_HMAC, { modeleAttendu: { id: modeleId, sha256: shaModele } });       // HMAC, forme, plafonds, ET le modèle de l'index = ce fichier : l'API le lira ainsi
    return { bucket: bucketVerifie, index: { fichier: index, octets: corpsIndex.length, sha256: crypto.createHash('sha256').update(corpsIndex).digest('hex'), n: ouvert.meta.n, modele: ouvert.meta.modele },
             modele: { fichier: modele, octets: fs.statSync(modele).size, sha256: shaModele }, objets: { index: objetIndex, modele: objetModele } };
}

/** Le dépôt. `client` est injectable (bancs). Le bucket DOIT être celui du plan vérifié (verifierBucket) : sinon arrêt avant toute commande. Il est imprimé avant tout dépôt.
 *  Chaque objet : Head (doit être ABSENT) → Put conditionnel → relecture. */
async function deposer({ client, bucket, plan, journal = console.log }) {
    if (!plan || !plan.bucket || texte(bucket) !== plan.bucket) throw new Error('le bucket du dépôt n\'est pas celui du plan vérifié : arrêt avant toute requête');
    journal(`bucket : ${plan.bucket}`);
    const { HeadObjectCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
    for (const k of ['index', 'modele']) {
        let existe = true;
        try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: plan.objets[k] })); } catch (e) { if (absent(e)) existe = false; else throw new Error(`lecture de ${plan.objets[k]} impossible (${(e && e.name) || 'erreur'}) : arrêt`); }
        if (existe) throw new Error(`l'objet « ${plan.objets[k]} » existe déjà : ce script n'écrase jamais`);
    }
    for (const k of ['index', 'modele']) {
        const p = plan[k];
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: plan.objets[k], Body: fs.createReadStream(p.fichier), ContentLength: p.octets, ContentType: 'application/octet-stream', ...(k === 'modele' ? { CacheControl: 'public, max-age=31536000, immutable' } : {}), IfNoneMatch: '*', Metadata: { sha256: p.sha256 } }));
        journal(`déposé ${plan.objets[k]} (${(p.octets / 1048576).toFixed(1)} Mo)`);
    }
    const bilan = {};
    for (const k of ['index', 'modele']) {
        const p = plan[k];
        const h = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: plan.objets[k] }));
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: plan.objets[k] }));
        const hash = crypto.createHash('sha256'); let n = 0; for await (const m of r.Body) { hash.update(m); n += m.length; }
        bilan[k] = Number(h.ContentLength) === p.octets && n === p.octets && hash.digest('hex') === p.sha256 && h.Metadata && h.Metadata.sha256 === p.sha256;
        journal(`relu ${plan.objets[k]} : ${n} octets, ${bilan[k] ? 'IDENTIQUE' : 'DIFFÉRENT'}`);
    }
    return bilan;
}

function lireArguments(argv) {
    const o = { ecrire: false };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--ecrire') { o.ecrire = true; continue; }
        if (!/^--(index|modele|modele-id|objet-index|objet-modele|bucket)$/.test(k) || argv[i + 1] === undefined) throw new Error(`argument inconnu ou sans valeur : ${k}`);
        o[k.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    }
    for (const k of ['index', 'modele', 'modeleId', 'objetIndex', 'objetModele', 'bucket']) if (!o[k]) throw new Error(`argument manquant : --${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`);
    return o;
}

if (require.main === module) {
    (async () => {
        const a = lireArguments(process.argv.slice(2));
        const plan = await preparer({ ...a, env: process.env });
        console.log(`bucket : ${plan.bucket}`);
        console.log(`plan : index ${plan.index.n} visuels, ${plan.index.octets} octets, sha256 ${plan.index.sha256} → ${plan.objets.index}`);
        console.log(`       modèle ${plan.modele.octets} octets, sha256 ${plan.modele.sha256} → ${plan.objets.modele}`);
        if (!a.ecrire) { console.log('À BLANC : rien n\'a été déposé, aucun réseau ouvert (relancer avec --ecrire sur feu vert du coordinateur)'); return; }
        const client = R2.creerClient({ compte: process.env.V2_VISUELS_R2_COMPTE.trim(), cleId: process.env.V2_VISUELS_R2_ECR_CLE_ID.trim(), secret: process.env.V2_VISUELS_R2_ECR_SECRET.trim(), endpoint: process.env.V2_VISUELS_R2_ENDPOINT });
        const b = await deposer({ client, bucket: plan.bucket, plan });
        console.log(b.index && b.modele ? '✅ déposés et relus conformes' : '❌ NON conforme'); process.exitCode = b.index && b.modele ? 0 : 1;
    })().catch(e => { console.error(`❌ ${String((e && e.motif) || (e && e.message) || 'erreur').slice(0, 300)}`); process.exit(1); });
}
module.exports = { preparer, deposer, lireArguments, verifierBucket, NOMS_ECRITURE };
