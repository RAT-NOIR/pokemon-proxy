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
const { ESSAI_RESERVATION_MINUTES } = require('./offres');

const COL = 'abo_essais';
const DETAILS = Object.freeze(['essai-deja-utilise', 'domaine-jetable', 'boite-deja-utilisee', 'installation-deja-utilisee']);
const dupliquee = e => Boolean(e) && e.code === 11000;
const hmac = (cfg, genre, valeur) => {
    if (!cfg || !cfg.empreinte || !cfg.empreinte.secret) throw new Error('secret-empreinte-absent');       // fail-closed : jamais d'empreinte sans secret
    return crypto.createHmac('sha256', cfg.empreinte.secret).update(`essai|${genre}|${valeur}`).digest('hex');
};
const expiration = maintenant => new Date(maintenant.getTime() + ESSAI_RESERVATION_MINUTES * 60000);

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
// La configuration de l'application (secret d'empreinte), armée au montage : le webhook ne reçoit que la configuration des abonnements.
let cfgApp = null;
const armer = c => { cfgApp = c || null; };
/** Confirme UNE ligne pour ce compte, par `_id` : libre → prise ; déjà au compte → confirmée ; à un AUTRE → refusée seulement s'il l'a déjà CONFIRMÉE (essai « pris » encore vivant) ; sa réservation (vivante ou non) ou une ligne périmée se reprend. */
async function confirmerLigne(c, compteId, jours, evtDate, deuxieme = false) {
    const expireLe = new Date(evtDate.getTime() + jours * 86400e3), pose = { compteId, genre: c.genre, etat: 'pris', prisLe: evtDate, expireLe, dureeJours: jours };
    try { await col(COL).insertOne({ _id: c.id, ...pose, creeLe: evtDate }); return true; } catch (e) { if (!dupliquee(e)) throw e; }
    const d = await col(COL).findOne({ _id: c.id });
    if (!d) return deuxieme ? false : confirmerLigne(c, compteId, jours, evtDate, true);
    if (String(d.compteId) === String(compteId)) { await col(COL).updateOne({ _id: c.id, compteId }, { $set: pose }); return true; }
    if (d.etat === 'pris' && d.expireLe instanceof Date && d.expireLe.getTime() > evtDate.getTime()) return false;
    return (await col(COL).updateOne({ _id: c.id, compteId: d.compteId, etat: d.etat, expireLe: d.expireLe }, { $set: pose })).modifiedCount === 1;
}
/**
 * L'essai existe vraiment (webhook). LA RÈGLE, écrite par ce qu'elle autorise : l'essai n'est GARDÉ que si la boîte ET chaque installation du compte (liée ou l'ayant été, y compris celles liées
 * APRÈS le Checkout) sont libres ou à ce compte — alors elles deviennent définitives (rétention). Si l'une a déjà été CONFIRMÉE par un autre compte, l'essai doit être CLOS : { clore: true, detail }.
 * (Le webhook peut arriver longtemps après la réservation, qui a pu expirer et être reprise ; une installation peut avoir été liée entre le Checkout et le webhook.)
 * Sans configuration armée (bancs anciens), l'ancienne confirmation par compteId seule.
 */
async function confirmer(compte, evtDate) {
    if (!cfgApp || !cfgApp.empreinte || !cfgApp.empreinte.secret) {
        await col(COL).updateMany({ compteId: compte._id, etat: 'reserve' }, [{ $set: { etat: 'pris', prisLe: evtDate, expireLe: { $add: [evtDate, { $multiply: [{ $ifNull: ['$dureeJours', 365] }, 86400000] }] } } }]);
        return { clore: false };
    }
    const jours = cfgApp.empreinte.jours;
    for (const c of await clesDe(compte, cfgApp)) {
        if (!(await confirmerLigne(c, compte._id, jours, evtDate))) {
            await col(COL).deleteMany({ compteId: compte._id, etat: 'reserve' });          // ses réservations restantes ne verrouillent plus personne
            return { clore: true, detail: detailDe(c.genre) };
        }
    }
    return { clore: false };
}
/** Une installation vient d'être liée à ce compte : si le compte a un essai (réservé ou pris, encore vivant), l'installation entre au registre dans le même état — liée APRÈS l'essai, elle compte quand même. */
async function noterLiaison(compte, installationId, cfg, maintenant = new Date()) {
    const boite = await col(COL).findOne({ compteId: compte._id, genre: 'boite' });
    if (!boite || !(boite.expireLe instanceof Date) || boite.expireLe.getTime() <= maintenant.getTime()) return;
    const id = `installation:${hmac(cfg, 'installation', String(installationId))}`;
    const doc = { genre: 'installation', compteId: compte._id, etat: boite.etat, expireLe: boite.expireLe, dureeJours: boite.dureeJours, ...(boite.prisLe ? { prisLe: boite.prisLe } : {}), creeLe: maintenant };
    try { await col(COL).insertOne({ _id: id, ...doc }); return; } catch (e) { if (!dupliquee(e)) throw e; }
    const d = await col(COL).findOne({ _id: id });
    if (d && String(d.compteId) !== String(compte._id) && d.expireLe instanceof Date && d.expireLe.getTime() <= maintenant.getTime())          // la ligne d'un autre est périmée : reprise sous condition
        await col(COL).updateOne({ _id: id, compteId: d.compteId, expireLe: d.expireLe }, { $set: doc });
}
module.exports = { verifier, reserver, rendre, confirmer, noterLiaison, armer, installationsDuCompte, COL, DETAILS };
