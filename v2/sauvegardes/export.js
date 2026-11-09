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

const NOM_BAIL = 'sauvegardes_bail';
const LOT = 500;
const OPTIONS_LECTURE = Object.freeze({ sort: { _id: 1 }, batchSize: LOT, promoteValues: false, promoteLongs: false });   // les types BSON exacts (int32 ≠ double), pas ceux de JavaScript
const cederLaMain = () => new Promise(r => setImmediate(r));

/** Les lignes EJSON d'une collection, une à une ; `suivi` reçoit le nombre de documents et l'empreinte au fil de l'eau. Priorité basse : on rend la main à la boucle d'événements à chaque lot. */
async function* lignesDe(coll, suivi, entreLots = async () => { }) {
    const curseur = coll.find({}, OPTIONS_LECTURE);
    try {
        for await (const doc of curseur) {
            const ligne = `${EJSON.stringify(doc, { relaxed: false })}\n`;
            suivi.hash.update(ligne); suivi.documents++;
            yield Buffer.from(ligne);
            if (suivi.documents % LOT === 0) { await cederLaMain(); await entreLots(); }
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
async function exporterBase({ db, stockage, cle, base, commit = null, maintenant = new Date(), battement = async () => true }) {
    const id = nouvelId(maintenant, crypto.randomBytes(4).toString('hex'));
    const infos = (await db.listCollections({}, { nameOnly: false }).toArray())
        .filter(c => (c.type === undefined || c.type === 'collection') && !c.name.startsWith('system.') && c.name !== NOM_BAIL)
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    const ecrites = [], collections = [];
    const controler = async () => { if ((await battement()) === false) refuser('bail-perdu'); };
    try {
        for (let i = 0; i < infos.length; i++) {
            await controler();
            const nom = infos[i].name, coll = db.collection(nom), cleObjet = cleCollection(base, id, i), objet = cleObjet.slice(cleObjet.lastIndexOf('/') + 1);
            const suivi = { hash: crypto.createHash('sha256'), documents: 0 };
            const gz = pipeline(Readable.from(lignesDe(coll, suivi, controler)), zlib.createGzip({ level: 6 }), sansBruit);
            ecrites.push(cleObjet);
            let octets;
            try { ({ octets } = await stockage.envoyer(cleObjet, chiffrer(gz, { cle, aad: aadDe(base, id, objet) }))); }
            catch (e) { gz.destroy(); throw e; }      // l'envoi a échoué : le flux de lecture (et son curseur) se ferme, il ne reste pas suspendu
            collections.push({ nom, objet, documents: suivi.documents, sha256Clair: suivi.hash.digest('hex'), octetsChiffres: octets,
                               options: infos[i].options && Object.keys(infos[i].options).length ? infos[i].options : undefined, index: indexPortables(await coll.indexes()) });
        }
        await controler();
        const manifeste = { version: 1, id, base, date: maintenant.toISOString(), commit, octetsChiffres: collections.reduce((n, c) => n + c.octetsChiffres, 0), collections };
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
