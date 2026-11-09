'use strict';
// SAUVEGARDES — l'export. TOUTES les collections de la base (énumérées par la base à chaque passe : une collection neuve est prise sans toucher au code ; seules sont écartées les collections système, les vues,
// et le bail de ce mécanisme, état volatil qui n'a rien à restaurer). Pour chacune : lecture par curseur en flux (lots de 500, triés par _id : l'empreinte est déterministe), EJSON canonique ligne à ligne,
// gzip, AES-256-GCM, envoi en flux vers le bucket. Jamais une collection entière en mémoire. L'empreinte du CLAIR (sha256 des lignes) et le nombre de documents partent dans un manifeste chiffré,
// écrit EN DERNIER : une sauvegarde sans manifeste n'existe pas. Les index et les options de chaque collection sont dans le manifeste.
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable, pipeline } = require('stream');
const { EJSON } = require('bson');
const { chiffrer } = require('./chiffrement');
const { aadDe, cleManifeste, cleCollection, nouvelId } = require('./chemins');
const { refuser } = require('./erreurs');
const { structure, COLLECTIONS_EXIGEES, EXCLUSIONS_PERMISES } = require('./manifeste');

const NOM_BAIL = 'sauvegardes_bail';
const LOT = 100, NIVEAU_GZIP = 3;   // mesurés (RAPPORT-SAUVEGARDE-R2.md, tableau des leviers) : des lots de 100 documents, gzip niveau 3 (même taille sur les données incompressibles, moins de mémoire et de CPU)
const optionsLecture = (lot) => Object.freeze({ sort: { _id: 1 }, batchSize: lot, promoteValues: false, promoteLongs: false });   // les types BSON exacts (int32 ≠ double), pas ceux de JavaScript
const OPTIONS_LECTURE = optionsLecture(LOT);
const cederLaMain = () => new Promise(r => setImmediate(r));

/** Les lignes EJSON d'une collection, une à une ; `suivi` reçoit le nombre de documents et l'empreinte au fil de l'eau. Priorité basse : on rend la main à la boucle d'événements à chaque lot. */
async function* lignesDe(coll, suivi, entreLots = async () => { }, lot = LOT) {
    const curseur = coll.find({}, lot === LOT ? OPTIONS_LECTURE : optionsLecture(lot));
    try {
        for await (const doc of curseur) {
            const ligne = `${EJSON.stringify(doc, { relaxed: false })}\n`;
            suivi.hash.update(ligne); suivi.documents++;
            yield Buffer.from(ligne);
            if (suivi.documents % lot === 0) { await cederLaMain(); await entreLots(); }
        }
    } finally { try { await curseur.close(); } catch { /* déjà fermé */ } }
}

/** { documents, sha256 } du contenu clair d'une collection, par le MÊME chemin que l'export (une copie de la règle diverge). */
async function empreinteCollection(coll) {
    const suivi = { hash: crypto.createHash('sha256'), documents: 0 };
    for await (const _ of lignesDe(coll, suivi)) { /* la lecture suffit */ }
    return { documents: suivi.documents, sha256: suivi.hash.digest('hex') };
}

const sansBruit = () => { };
const indexPortables = (liste) => liste.filter(i => i.name !== '_id_').map(i => { const { v, ns, ...reste } = i; return reste; });

/** @returns {Promise<{id:string, manifeste:object}>} */
async function exporterBase({ db, stockage, cle, base, commit = null, maintenant = new Date(), battement = async () => true, lot = LOT, niveauGzip = NIVEAU_GZIP, ramasser = null, exclure = [] }) {
    // 🔑 une exclusion s'écrit par ce qu'elle AUTORISE : une liste fermée en dur (manifeste.js : seulement `references_image`, un index reconstructible) ; tout autre nom est refusé AVANT toute lecture
    if (!Array.isArray(exclure) || exclure.some(n => !EXCLUSIONS_PERMISES.includes(n))) refuser('exclusion-refusee');
    const id = nouvelId(maintenant, crypto.randomBytes(4).toString('hex'));
    const toutes = await db.listCollections({}, { nameOnly: false }).toArray();
    const infosToutes = toutes.filter(c => (c.type === undefined || c.type === 'collection') && !c.name.startsWith('system.') && c.name !== NOM_BAIL).sort((a, b) => (a.name < b.name ? -1 : 1));
    const infos = infosToutes.filter(c => !exclure.includes(c.name));
    const exclues = infosToutes.filter(c => exclure.includes(c.name)).map(c => c.name);       // listées dans le manifeste, séparément des vues et séries temporelles
    // les vues et les séries temporelles ne sont pas exportées (une vue se recrée depuis sa définition, une série temporelle demande un autre format) : elles sont LISTÉES dans le manifeste, jamais ignorées en silence
    const ecartees = toutes.filter(c => c.type === 'view' || c.type === 'timeseries').map(c => ({ nom: c.name, type: c.type })).sort((a, b) => (a.nom < b.nom ? -1 : 1));
    // 🔑 une sauvegarde VIDE n'existe pas : zéro collection, ou une collection exigée absente ou vide, refuse AVANT d'écrire un seul octet
    if (!infos.length) refuser('base-vide');
    for (const nom of COLLECTIONS_EXIGEES) {
        if (!infos.some(c => c.name === nom)) refuser('collection-exigee-absente');
        if (!(await db.collection(nom).findOne({}, { projection: { _id: 1 } }))) refuser('collection-exigee-vide');
    }
    const ecrites = [], collections = [];
    let battements = 0;
    // `ramasser` (facultatif) : un ramasse-miettes forcé tous les 20 lots — les tampons natifs (zlib, chiffrement, réseau) ne sont rendus qu'au prochain passage de V8, donc le pic de mémoire suit le débit, pas le besoin
    const controler = async () => { if ((await battement()) === false) refuser('bail-perdu'); if (ramasser && ++battements % 20 === 0) ramasser(); };
    try {
        for (let i = 0; i < infos.length; i++) {
            await controler();
            const nom = infos[i].name, coll = db.collection(nom), cleObjet = cleCollection(base, id, i), objet = cleObjet.slice(cleObjet.lastIndexOf('/') + 1);
            const suivi = { hash: crypto.createHash('sha256'), documents: 0 };
            const gz = pipeline(Readable.from(lignesDe(coll, suivi, controler, lot)), zlib.createGzip({ level: niveauGzip }), sansBruit);
            ecrites.push(cleObjet);
            let octets;
            try { ({ octets } = await stockage.envoyer(cleObjet, chiffrer(gz, { cle, aad: aadDe(base, id, objet) }))); }
            catch (e) { gz.destroy(); throw e; }      // l'envoi a échoué : le flux de lecture (et son curseur) se ferme, il ne reste pas suspendu
            collections.push({ nom, objet, documents: suivi.documents, sha256Clair: suivi.hash.digest('hex'), octetsChiffres: octets,
                               options: infos[i].options && Object.keys(infos[i].options).length ? infos[i].options : undefined, index: indexPortables(await coll.indexes()) });
        }
        await controler();
        const manifeste = { version: 1, id, base, date: maintenant.toISOString(), commit, octetsChiffres: collections.reduce((n, c) => n + c.octetsChiffres, 0), collections, ecartees, exclues };
        const v = structure(manifeste, base, id);       // le MÊME contrôle que la rétention et la restauration : un manifeste qui ne serait pas valide n'est pas écrit
        if (!v.ok) refuser(v.raison);
        const cm = cleManifeste(base, id);
        ecrites.push(cm);
        await stockage.envoyer(cm, chiffrer(Readable.from([Buffer.from(JSON.stringify(manifeste))]), { cle, aad: aadDe(base, id, 'manifeste.rmsav') }));
        return { id, manifeste };
    } catch (e) {
        // une sauvegarde interrompue n'existe pas : on retire ce qu'elle a posé (au mieux ; la rétention rattrape les orphelines)
        for (const k of ecrites.reverse()) { try { await stockage.supprimer(k); } catch { /* la rétention s'en chargera */ } }
        throw e;
    }
}
module.exports = { exporterBase, empreinteCollection, lignesDe, NOM_BAIL, LOT, OPTIONS_LECTURE };
