'use strict';
// LA GARDE DE L'ESSAI SANS CARTE (lot STRIPE-DECISIONS). Un essai de 14 jours sans carte ne se donne qu'à un client qui n'en a jamais eu : sans cette garde, la même personne rouvrirait un compte à chaque fin d'essai.
// Écrite par ce qu'elle AUTORISE : l'essai n'est permis que si TOUTES ces conditions tiennent, et chaque refus a son `detail` (jamais une autre explication) :
//   · le compte n'a jamais eu d'essai ni d'abonnement (en base ; chez Stripe, c'est essaiPermis de routes.js)  → sinon « essai-deja-utilise »
//   · son domaine n'est pas jetable (la liste connue, REVÉRIFIÉE ici : un compte créé avant une mise à jour de la liste ne passe pas)  → sinon « domaine-jetable »
//   · UNE BOÎTE, UN ESSAI : la clé de boîte (`cleBoite(emailCle)` : `a+x@…` et les points de Gmail donnent la même boîte) n'a pas déjà servi un essai pour un autre compte  → sinon « boite-deja-utilisee »
//   · AU PLUS UN ESSAI PAR INSTALLATION de l'extension : chaque installation liée au compte, ou qui l'a été, n'a pas déjà servi un essai pour un autre compte  → sinon « installation-deja-utilisee »
//   · aucune autre donnée : ni IP, ni empreinte du navigateur, ni carte.
// Le registre `abo_essais` ne porte QUE des HMAC (secret d'empreinte du serveur) : jamais une adresse en clair, jamais un identifiant d'installation en clair. Il survit à la suppression du compte
// (comme `adresses_octroyees`) pour la durée cfg.empreinte.jours, puis le TTL le retire.
// Deux temps, comme les places Fondateurs : le Checkout RÉSERVE (atomique : insertion d'un _id unique, jamais « lire puis écrire »), le webhook CONFIRME quand l'essai existe vraiment (`confirmer`).
// Une réservation abandonnée expire seule (durée d'une session + marge) : un Checkout lâché ne verrouille personne.
const crypto = require('crypto');
const { col } = require('../db');
const { cleBoite, estJetable } = require('../comptes/email-cle');
const { SESSION_MINUTES, MARGE_RESERVATION_MINUTES } = require('./offres');

const COL = 'abo_essais';
const DETAILS = Object.freeze(['essai-deja-utilise', 'domaine-jetable', 'boite-deja-utilisee', 'installation-deja-utilisee']);
const dupliquee = e => Boolean(e) && e.code === 11000;
const hmac = (cfg, genre, valeur) => {
    if (!cfg || !cfg.empreinte || !cfg.empreinte.secret) throw new Error('secret-empreinte-absent');       // fail-closed : jamais d'empreinte sans secret
    return crypto.createHmac('sha256', cfg.empreinte.secret).update(`essai|${genre}|${valeur}`).digest('hex');
};
const expiration = maintenant => new Date(maintenant.getTime() + (SESSION_MINUTES + MARGE_RESERVATION_MINUTES) * 60000);

/** Les identifiants des installations liées au compte, ou qui l'ont été (`comptesLies` est posé à chaque liaison). */
async function installationsDuCompte(compteId) {
    const l = await col('installations').find({ $or: [{ compteId }, { comptesLies: compteId }] }, { projection: { _id: 1 } }).toArray();
    return l.map(i => String(i._id));
}
/** Les clés du registre qui concernent ce compte : { id, genre }. La boîte d'abord, puis chaque installation. */
async function clesDe(compte, cfg) {
    const cles = [{ id: `boite:${hmac(cfg, 'boite', cleBoite(compte.emailCle))}`, genre: 'boite' }];
    for (const inst of await installationsDuCompte(compte._id)) cles.push({ id: `installation:${hmac(cfg, 'installation', inst)}`, genre: 'installation' });
    return cles;
}
const detailDe = genre => (genre === 'boite' ? 'boite-deja-utilisee' : 'installation-deja-utilisee');
/** La ligne `d` bloque-t-elle ce compte ? (une autre ligne vivante : prise, ou réservée et non expirée) */
const bloque = (d, compteId, maintenant) => Boolean(d) && String(d.compteId) !== String(compteId) && !(d.expireLe instanceof Date && d.expireLe.getTime() <= maintenant.getTime());

/** Lecture seule : l'essai est-il permis à ce compte ? { permis: true } | { permis: false, detail }. Ne réserve rien (le statut public s'en sert). */
async function verifier(compte, cfg, maintenant = new Date()) {
    const s = compte.abonnement && compte.abonnement.stripe;
    if (s && (s.essaiUtilise || s.sid)) return { permis: false, detail: 'essai-deja-utilise' };
    if (typeof compte.emailCle !== 'string' || estJetable(compte.emailCle.split('@')[1] || '')) return { permis: false, detail: 'domaine-jetable' };
    for (const c of await clesDe(compte, cfg)) if (bloque(await col(COL).findOne({ _id: c.id }), compte._id, maintenant)) return { permis: false, detail: detailDe(c.genre) };
    return { permis: true };
}
async function prendre(c, compteId, jours, maintenant, deuxieme = false) {
    const expireLe = expiration(maintenant);
    try { await col(COL).insertOne({ _id: c.id, genre: c.genre, compteId, etat: 'reserve', expireLe, dureeJours: jours, creeLe: maintenant }); return { ok: true, cree: true }; }
    catch (e) { if (!dupliquee(e)) throw e; }
    const d = await col(COL).findOne({ _id: c.id });
    if (!d) return deuxieme ? { ok: false } : prendre(c, compteId, jours, maintenant, true);                      // supprimée entre-temps (TTL) : un seul nouvel essai
    if (String(d.compteId) === String(compteId)) { if (d.etat === 'reserve') await col(COL).updateOne({ _id: c.id, compteId, etat: 'reserve' }, { $set: { expireLe } }); return { ok: true, cree: false }; }
    if (bloque(d, compteId, maintenant)) return { ok: false };
    // la ligne d'un autre est EXPIRÉE (réservation abandonnée, ou essai plus vieux que la rétention) : reprise atomique, conditionnée à son expiration
    const r = await col(COL).updateOne({ _id: c.id, compteId: d.compteId, expireLe: { $lte: maintenant } }, { $set: { compteId, etat: 'reserve', expireLe, dureeJours: jours, creeLe: maintenant }, $unset: { prisLe: '' } });
    return r.modifiedCount === 1 ? { ok: true, cree: true } : { ok: false };
}
/** Le Checkout part AVEC essai : on réserve la boîte et chaque installation du compte, atomiquement. { permis, detail?, cree: [ids] } ; en cas de refus, ce que CET appel a créé est retiré. */
async function reserver(compte, cfg, maintenant = new Date()) {
    const lecture = await verifier(compte, cfg, maintenant);
    if (!lecture.permis) return { ...lecture, cree: [] };
    const jours = cfg.empreinte.jours, cree = [];
    for (const c of await clesDe(compte, cfg)) {
        const r = await prendre(c, compte._id, jours, maintenant);
        if (!r.ok) { await rendre(compte._id, cree); return { permis: false, detail: detailDe(c.genre), cree: [] }; }
        if (r.cree) cree.push(c.id);
    }
    return { permis: true, cree };
}
/** Rend les réservations créées par un Checkout qui n'a pas abouti (jamais une ligne confirmée). */
async function rendre(compteId, ids) { if (ids && ids.length) await col(COL).deleteMany({ _id: { $in: ids }, compteId, etat: 'reserve' }); }
/** L'essai existe vraiment (webhook) : les réservations du compte deviennent définitives pour la durée de rétention. Idempotent. */
async function confirmer(compteId, evtDate) {
    await col(COL).updateMany({ compteId, etat: 'reserve' }, [{ $set: { etat: 'pris', prisLe: evtDate, expireLe: { $add: [evtDate, { $multiply: [{ $ifNull: ['$dureeJours', 365] }, 86400000] }] } } }]);
}
module.exports = { verifier, reserver, rendre, confirmer, installationsDuCompte, COL, DETAILS };
