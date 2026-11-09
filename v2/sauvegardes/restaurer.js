'use strict';
// SAUVEGARDES — la restauration. Ne vise JAMAIS autre chose qu'une base JETABLE : le nom doit avoir la forme `rm_essai_restau_<suffixe>` (liste permise : une forme, rien d'autre — ni rm_essai, ni test, ni cartes,
// ni test_scratch), et la grappe visée par la ligne de commande n'est ni MONGODB_URI ni MONGODB_CARTES_URI. Ordre, écrit par ce que chaque étape garantit :
//   1. le nom de la base (refus AVANT toute lecture) ; 2. le manifeste (étiquette GCM vérifiée, structure valide : manifeste.js) ; 3. la base jetable doit être VIDE ; 4. CHAQUE objet de collection téléchargé et
//   déchiffré vers un fichier de travail, étiquette vérifiée, nombre de documents et empreinte du clair recomptés contre le manifeste — AVANT la moindre écriture ; 5. seulement alors, les insertions puis les index
//   SAUF les index TTL et le validateur : un TTL supprimerait des documents pendant la restauration, un validateur refuserait d'anciens documents — ils sont posés APRÈS la relecture ; 6. relecture : comptes, empreintes,
//   SPÉCIFICATIONS d'index (clés ET options) et options des collections, contre le manifeste. En cas d'échec après le premier octet écrit, la base que cette exécution vient de créer est SUPPRIMÉE (son nom a la forme
//   permise et elle était vide au départ). Les fichiers de travail (données en clair compressées) sont supprimés quoi qu'il arrive.
//   ⚠️ Après avoir PROMU une base restaurée comme base d'un service, lancer `node v2/argent/reconcilier.js` : la sauvegarde est lue collection par collection, sans instantané (voir MESSAGE_RECONCILIER).
//   Ligne de commande : node v2/sauvegardes/restaurer.js --vers=rm_essai_restau_<suffixe> [--base=<base sauvegardée>] [--id=<sauvegarde>]   (sans --id : la dernière sauvegarde VÉRIFIÉE)
//   Variables : V2_SAUVEGARDE_*, V2_SAUVEGARDE_RESTAURATION_URI.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), zlib = require('zlib'), readline = require('readline');
const { EJSON } = require('bson');
const { dechiffrerVersBuffer, dechiffrerVersFichier } = require('./chiffrement');
const { cleManifeste, aadDe, FORME_BASE, FORME_ID, dossier } = require('./chemins');
const { refuser } = require('./erreurs');
const { derniereVerifiable, structure } = require('./manifeste');
const { empreinteCollection } = require('./export');
const { hotesDe, cleDeGrappe } = require('../../collecte-cartes/garde-banc');

const FORME_RESTAURATION = /^rm_essai_restau_[a-z0-9_]{1,40}$/;
const MESSAGE_RECONCILIER = 'Cette sauvegarde est lue collection par collection, SANS instantané (une transaction snapshot ne tient pas sur M0 : 60 s, l\'export en dure plus de 130). Après avoir promu une base restaurée comme base d\'un service, lancer `node v2/argent/reconcilier.js` (somme des mouvements contre soldes, poche par poche : il imprime l\'écart, il ne corrige rien).';
function verifierNomBaseRestauration(nom) {
    if (typeof nom !== 'string' || !FORME_RESTAURATION.test(nom)) refuser('base-refusee');
    return nom;
}
/** La grappe de restauration n'est jamais celle d'une URI de production connue (MONGODB_URI, MONGODB_CARTES_URI) : écrit par ce qu'elle AUTORISE — une URI lisible dont la grappe n'est celle d'aucune des deux. */
function verifierGrappeRestauration(uri, env = process.env) {
    const hotes = hotesDe(uri);
    if (!hotes.length) refuser('grappe-refusee');
    const interdites = ['MONGODB_URI', 'MONGODB_CARTES_URI'].map(n => env[n]).filter(Boolean);
    if (interdites.some(u => String(u).trim() === String(uri).trim())) refuser('grappe-refusee');
    const miennes = new Set(hotes.map(cleDeGrappe));
    for (const u of interdites) { const h = hotesDe(u); if (!h.length || h.some(x => miennes.has(cleDeGrappe(x)))) refuser('grappe-refusee'); }
    return true;
}

async function* lignesDeFichierGz(chemin) {
    const rl = readline.createInterface({ input: fs.createReadStream(chemin).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const l of rl) if (l.length) yield l;
}
// la forme CANONIQUE d'une spécification d'index (clés triées récursivement, sans les champs que MongoDB pose lui-même : v, ns, background)
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' && !(x instanceof Date) && x.constructor === Object ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x);
// ⚠️ seules les propriétés de PREMIER niveau sont triées : l'ordre des champs d'une clé d'index ({ a: 1, b: -1 }) fait partie de sa spécification
const specIndex = (i) => { const { v, ns, background, ...reste } = i; const e = EJSON.serialize(reste, { relaxed: false }); return JSON.stringify(Object.fromEntries(Object.keys(e).sort().map(k => [k, e[k]]))); };
const estTtl = (i) => i.expireAfterSeconds !== undefined;
const OPTIONS_APRES = ['validator', 'validationLevel', 'validationAction'];

async function restaurer({ stockage, cle, base, id = null, client, nomBase, dossierTmp = os.tmpdir(), lot = 500, maintenant = new Date() }) {
    verifierNomBaseRestauration(nomBase);                                                    // 1. avant toute lecture
    if (typeof base !== 'string' || !FORME_BASE.test(base)) refuser('base-source-invalide');
    if (id !== null && !FORME_ID.test(String(id))) refuser('sauvegarde-introuvable');
    let manifeste;
    if (id === null) {                                                                       // sans identifiant : la dernière sauvegarde VÉRIFIÉE (jamais le dernier nom)
        const d = await derniereVerifiable({ stockage, cle, base, maintenant }); if (!d) refuser('sauvegarde-introuvable');
        id = d.id; manifeste = d.manifeste;
    } else {
        if (!(await stockage.tete(cleManifeste(base, id)))) refuser('sauvegarde-introuvable');
        manifeste = JSON.parse((await dechiffrerVersBuffer(await stockage.lire(cleManifeste(base, id)), { cle, aad: aadDe(base, id, 'manifeste.rmsav'), max: 16 * 1024 * 1024 })).toString('utf8'));   // 2.
        const v = structure(manifeste, base, id); if (!v.ok) refuser(v.raison);
    }
    const dest = client.db(nomBase);
    if ((await dest.listCollections({}, { nameOnly: true }).toArray()).length) refuser('base-non-vide');    // 3. vide au départ : c'est ce qui autorise à la supprimer en cas d'échec
    const fichiers = []; let creee = false;
    try {
        for (const c of manifeste.collections) {                                             // 4. tout vérifier AVANT d'écrire
            const f = path.join(dossierTmp, `rmsav-${crypto.randomBytes(8).toString('hex')}.gz`);
            fichiers.push(f);
            await dechiffrerVersFichier(await stockage.lire(`${dossier(base, id)}${c.objet}`), f, { cle, aad: aadDe(base, id, c.objet) });
            const hash = crypto.createHash('sha256'); let n = 0;
            for await (const l of lignesDeFichierGz(f)) { hash.update(`${l}\n`); n++; }
            if (n !== c.documents || hash.digest('hex') !== c.sha256Clair) refuser('contenu-different-du-manifeste');
        }
        for (let i = 0; i < manifeste.collections.length; i++) {                             // 5. écrire (sans TTL ni validateur)
            const c = manifeste.collections[i];
            const options = Object.fromEntries(Object.entries(c.options || {}).filter(([k]) => !OPTIONS_APRES.includes(k)));
            creee = true;
            await dest.createCollection(c.nom, options);
            let paquet = [];
            for await (const l of lignesDeFichierGz(fichiers[i])) {
                paquet.push(EJSON.parse(l, { relaxed: false }));
                if (paquet.length >= lot) { await dest.collection(c.nom).insertMany(paquet, { ordered: true }); paquet = []; }
            }
            if (paquet.length) await dest.collection(c.nom).insertMany(paquet, { ordered: true });
            const sansTtl = (c.index || []).filter(x => !estTtl(x));
            if (sansTtl.length) await dest.collection(c.nom).createIndexes(sansTtl);
        }
        for (const c of manifeste.collections) {                                             // 6. relire AVANT de poser les TTL et les validateurs
            const e = await empreinteCollection(dest.collection(c.nom));
            if (e.documents !== c.documents || e.sha256 !== c.sha256Clair) refuser('verification-echouee', [c.nom]);
        }
        for (const c of manifeste.collections) {                                             // puis les TTL et les validateurs
            const ttl = (c.index || []).filter(estTtl);
            if (ttl.length) await dest.collection(c.nom).createIndexes(ttl);
            const apres = Object.fromEntries(Object.entries(c.options || {}).filter(([k]) => OPTIONS_APRES.includes(k)));
            if (Object.keys(apres).length) await dest.command({ collMod: c.nom, ...apres });
        }
        const rapport = [];
        for (const c of manifeste.collections) {
            const e = await empreinteCollection(dest.collection(c.nom));
            const idx = (await dest.collection(c.nom).indexes()).filter(i => i.name !== '_id_').map(specIndex).sort();
            const attendus = (c.index || []).map(specIndex).sort();
            const infoCol = (await dest.listCollections({ name: c.nom }).toArray())[0] || {};
            const optionsOk = JSON.stringify(canon(EJSON.serialize(infoCol.options || {}, { relaxed: false }))) === JSON.stringify(canon(EJSON.serialize(c.options || {}, { relaxed: false })));
            const identique = e.documents === c.documents && e.sha256 === c.sha256Clair && JSON.stringify(idx) === JSON.stringify(attendus) && optionsOk;
            rapport.push({ nom: c.nom, documents: e.documents, attendu: c.documents, sha256Clair: e.sha256, identique, index: idx.length, indexAttendus: attendus.length, indexIdentiques: JSON.stringify(idx) === JSON.stringify(attendus), optionsIdentiques: optionsOk });
        }
        if (rapport.some(r => !r.identique)) refuser('verification-echouee', rapport);
        const exclues = Array.isArray(manifeste.exclues) ? manifeste.exclues : [];
        const aFaire = [MESSAGE_RECONCILIER];
        if (exclues.length) aFaire.unshift(`Cette sauvegarde a été faite AVEC EXCLUSION : ${exclues.join(', ')} ne sont PAS restaurées (absentes de la sauvegarde) ; à reconstruire par ailleurs avant de s'en servir.`);
        return { id, base, nomBase, collections: rapport, manifeste, exclues, aFaire };
    } catch (e) {
        if (creee) { try { verifierNomBaseRestauration(nomBase); await client.db(nomBase).dropDatabase(); } catch { /* elle reste, nommée : l'appelant la voit */ } }   // la base qu'on vient de créer (vide au départ) ne reste pas à moitié remplie
        throw e;
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
    verifierGrappeRestauration(uri, process.env);
    const { MongoClient } = require('mongodb'), client = new MongoClient(uri);
    await client.connect();
    try {
        const s = await restaurer({ stockage: creerStockageR2(r.c), cle: r.c.cle, base: arg('base') || r.c.base, id: arg('id'), client, nomBase: vers });
        for (const c of s.collections) console.log(`${c.identique ? '✅' : '❌'} ${c.nom} : ${c.documents}/${c.attendu} documents, ${c.index}/${c.indexAttendus} index`);
        for (const m of s.aFaire) console.log(`⚠️ ${m}`);
    } finally { await client.close(); }
}
if (require.main === module) principal().catch(e => { console.error(`❌ restauration refusée (${(e && (e.code || e.name)) || 'erreur'})`); process.exit(1); });
module.exports = { restaurer, verifierNomBaseRestauration, verifierGrappeRestauration, FORME_RESTAURATION, MESSAGE_RECONCILIER, specIndex };
