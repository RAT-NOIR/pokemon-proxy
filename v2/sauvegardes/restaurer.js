'use strict';
// SAUVEGARDES — la restauration. Ne vise JAMAIS autre chose qu'une base JETABLE : le nom doit commencer par `rm_essai_restau_` (liste permise : une forme, rien d'autre — ni rm_essai, ni test, ni cartes,
// ni test_scratch). Ordre, écrit par ce que chaque étape garantit :
//   1. le nom de la base (refus AVANT toute lecture) ; 2. le manifeste (étiquette GCM vérifiée) ; 3. CHAQUE objet de collection téléchargé et déchiffré vers un fichier de travail, étiquette vérifiée,
//   nombre de documents et empreinte du clair recomptés contre le manifeste — AVANT la moindre écriture ; 4. seulement alors, les insertions puis les index ; 5. relecture : comptes et empreintes de ce qui est
//   RESTAURÉ contre le manifeste. Les fichiers de travail (données en clair compressées) sont supprimés quoi qu'il arrive.
//   Ligne de commande : node v2/sauvegardes/restaurer.js --base=<base sauvegardée> --vers=rm_essai_restau_<suffixe> [--id=<sauvegarde>]   (variables : V2_SAUVEGARDE_*, V2_SAUVEGARDE_RESTAURATION_URI)
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), zlib = require('zlib'), readline = require('readline');
const { EJSON } = require('bson');
const { dechiffrerVersBuffer, dechiffrerVersFichier } = require('./chiffrement');
const { cleManifeste, aadDe, FORME_BASE, FORME_ID } = require('./chemins');
const { refuser } = require('./erreurs');
const { derniereSauvegarde } = require('./planificateur');
const { empreinteCollection } = require('./export');

const FORME_RESTAURATION = /^rm_essai_restau_[a-z0-9_]{1,40}$/;
function verifierNomBaseRestauration(nom) {
    if (typeof nom !== 'string' || !FORME_RESTAURATION.test(nom)) refuser('base-refusee');
    return nom;
}

async function* lignesDeFichierGz(chemin) {
    const rl = readline.createInterface({ input: fs.createReadStream(chemin).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const l of rl) if (l.length) yield l;
}

async function restaurer({ stockage, cle, base, id = null, client, nomBase, dossierTmp = os.tmpdir(), lot = 500 }) {
    verifierNomBaseRestauration(nomBase);                                                    // 1. avant toute lecture
    if (typeof base !== 'string' || !FORME_BASE.test(base)) refuser('base-source-invalide');
    if (id !== null && !FORME_ID.test(String(id))) refuser('sauvegarde-introuvable');
    if (id === null) { const d = await derniereSauvegarde({ stockage, base }); if (!d) refuser('sauvegarde-introuvable'); id = d.id; }
    if (!(await stockage.tete(cleManifeste(base, id)))) refuser('sauvegarde-introuvable');
    const manifeste = JSON.parse((await dechiffrerVersBuffer(await stockage.lire(cleManifeste(base, id)), { cle, aad: aadDe(base, id, 'manifeste.rmsav'), max: 16 * 1024 * 1024 })).toString('utf8'));   // 2.
    if (!manifeste || manifeste.id !== id || manifeste.base !== base || !Array.isArray(manifeste.collections)) refuser('manifeste-incoherent');
    const dest = client.db(nomBase);
    if ((await dest.listCollections({}, { nameOnly: true }).toArray()).length) refuser('base-non-vide');
    const fichiers = [];
    try {
        for (const c of manifeste.collections) {                                             // 3. tout vérifier AVANT d'écrire
            const f = path.join(dossierTmp, `rmsav-${crypto.randomBytes(8).toString('hex')}.gz`);
            fichiers.push(f);
            await dechiffrerVersFichier(await stockage.lire(`${require('./chemins').dossier(base, id)}${c.objet}`), f, { cle, aad: aadDe(base, id, c.objet) });
            const hash = crypto.createHash('sha256'); let n = 0;
            for await (const l of lignesDeFichierGz(f)) { hash.update(`${l}\n`); n++; }
            if (n !== c.documents || hash.digest('hex') !== c.sha256Clair) refuser('contenu-different-du-manifeste');
        }
        for (let i = 0; i < manifeste.collections.length; i++) {                             // 4. écrire
            const c = manifeste.collections[i];
            await dest.createCollection(c.nom, c.options || {});
            let paquet = [];
            for await (const l of lignesDeFichierGz(fichiers[i])) {
                paquet.push(EJSON.parse(l, { relaxed: false }));
                if (paquet.length >= lot) { await dest.collection(c.nom).insertMany(paquet, { ordered: true }); paquet = []; }
            }
            if (paquet.length) await dest.collection(c.nom).insertMany(paquet, { ordered: true });
            if (c.index && c.index.length) await dest.collection(c.nom).createIndexes(c.index);
        }
        const rapport = [];                                                                  // 5. relire ce qui est restauré
        for (const c of manifeste.collections) {
            const e = await empreinteCollection(dest.collection(c.nom));
            const idx = (await dest.collection(c.nom).indexes()).filter(i => i.name !== '_id_').map(i => i.name).sort();
            const idxAttendus = (c.index || []).map(i => i.name).sort();
            const identique = e.documents === c.documents && e.sha256 === c.sha256Clair && JSON.stringify(idx) === JSON.stringify(idxAttendus);
            rapport.push({ nom: c.nom, documents: e.documents, attendu: c.documents, sha256Clair: e.sha256, identique, index: idx.length, indexAttendus: idxAttendus.length });
        }
        if (rapport.some(r => !r.identique)) refuser('verification-echouee', rapport);
        return { id, base, nomBase, collections: rapport, manifeste };
    } finally {
        for (const f of fichiers) { try { fs.rmSync(f, { force: true }); } catch { /* déjà absent */ } }
    }
}

async function principal() {
    const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const { lireConfigSauvegardes } = require('./config'), { creerStockageR2 } = require('./stockage-r2');
    const r = lireConfigSauvegardes(process.env);
    if (!r.ok) { console.error(`❌ configuration : ${r.raison || 'aucune variable V2_SAUVEGARDE_*'}`); process.exit(1); }
    const uri = process.env.V2_SAUVEGARDE_RESTAURATION_URI;
    if (!uri) { console.error('❌ V2_SAUVEGARDE_RESTAURATION_URI absente'); process.exit(1); }
    const vers = arg('vers'); verifierNomBaseRestauration(vers);
    const { MongoClient } = require('mongodb'), client = new MongoClient(uri);
    await client.connect();
    try {
        const s = await restaurer({ stockage: creerStockageR2(r.c), cle: r.c.cle, base: arg('base') || r.c.base, id: arg('id'), client, nomBase: vers });
        for (const c of s.collections) console.log(`${c.identique ? '✅' : '❌'} ${c.nom} : ${c.documents}/${c.attendu} documents, ${c.index}/${c.indexAttendus} index`);
    } finally { await client.close(); }
}
if (require.main === module) principal().catch(e => { console.error(`❌ restauration refusée (${(e && (e.code || e.name)) || 'erreur'})`); process.exit(1); });
module.exports = { restaurer, verifierNomBaseRestauration, FORME_RESTAURATION };
