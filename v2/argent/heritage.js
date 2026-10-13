'use strict';
// HÉRITAGE DES PORTEFEUILLES 1.0.x (collection `credits`, LUE ici et marquée — jamais recréée) — PLAN-COMPTES §4.4, §5 Q30, §8.
//   · reprendreHeritage : la partie GRATUITE est DÉPLACÉE (soldeGratuit → 0, migreVers posé) : l'ancien client ne peut pas la dépenser deux fois. Les crédits ACHETÉS ne bougent pas ici.
//     Le gratuit repris est PLAFONNÉ à la dotation d'essai d'une installation (quotas.essai) et toute élévation des essais d'une installation est COMPTÉE dans le plafond global (D7 b).
//   · rattacherAchats   : les crédits ACHETÉS ne suivent que la PREUVE PAR L'ADRESSE : l'adresse Stripe du portefeuille égale (emailCle) celle d'un compte VÉRIFIÉ. Aucune autre preuve ne suffit.
// Le userId (identifiant anonyme de l'ancienne extension) ne se journalise qu'en empreinte SHA-256.
const crypto = require('crypto'); const db = require('../db'); const { dansUneTransaction } = require('./transaction'); const L = require('../transport/limites');
const col = nom => db.col(nom);
const empreinte = userId => crypto.createHash('sha256').update(String(userId)).digest('hex');
const mouv = (base, delta, poche, motif, cle, cfg, le) => ({ ...base, le, surface: 'extension', type: 'migration', delta, poche, motif, scanId: null, etat: 'debite', cleIdempotence: cle,
    expireLe: new Date(le.getTime() + cfg.retention.mouvementsMois * 30.5 * 86400e3) });

// emailCle est celle de B2 (v2/comptes/email-cle.js) : on ne la recopie pas (§21 bis). Injectable pour les bancs ; absente et non injectée => on LÈVE (jamais de repli qui devine).
function chargerEmailCle(injectee) {
    if (typeof injectee === 'function') return injectee;
    try { return require('../comptes/email-cle').emailCle; }
    catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; throw new Error('rattacherAchats : v2/comptes/email-cle.js (B2) est absent et aucune emailCle n\'a été fournie'); }
}

async function reprendreHeritage({ userId, installation, maintenant = new Date(), session = null }, cfg) {
    const h = empreinte(userId);
    return dansUneTransaction(async s => {
        const ins = await col('installations').findOne({ _id: installation._id }, { session: s });
        if (!ins) return { ok: false, raison: 'installation-inconnue' };
        if (ins.heriteEmpreinte) return { ok: false, raison: 'installation-deja-heritee', essais: ins.essais };
        const cred = await col('credits').findOne({ userId }, { session: s });
        if (!cred) return { ok: false, raison: 'inconnu', essais: ins.essais };
        if (cred.migreVers != null) return { ok: false, raison: 'deja-migre', essais: ins.essais };
        // HERITAGE-GRATUIT (D7 b) : le gratuit hérité ne dépasse JAMAIS la dotation d'une installation (quotas.essai : la poche `essai` est celle qui le reçoit ; `accueil` est la dotation
        // d'un COMPTE vérifié, il n'entre pas en jeu ici) et ce qui ÉLÈVE les essais d'une installation passe par le plafond global, comme sa création. Le plafond est consulté AVANT la prise
        // du portefeuille : un refus ne détruit rien (l'ayant droit réessaie), et aucune annulation de transaction n'est nécessaire.
        const dotation = cfg.quotas.essai, visee = Math.min(Math.max(0, cred.soldeGratuit ?? 0), dotation);
        let unite = false;
        if (visee > ins.essais) {
            const jour = await L.consommer('essais-globaux', { max: cfg.limites.essaisGlobauxJour, fenetreMs: 86400e3, maintenant });
            if (!jour.permis) { console.warn(`ℹ️ [v2 heritage] ${h.slice(0, 12)} : plafond global des essais atteint, reprise refusée`); return { ok: false, raison: 'plafond-global', essais: ins.essais }; }
            unite = true;
        }
        const pris = await col('credits').findOneAndUpdate({ userId, migreVers: { $exists: false } }, { $set: { migreVers: ins._id, soldeGratuit: 0, gratuitMigre: Math.max(0, cred.soldeGratuit ?? 0) } }, { session: s, returnDocument: 'before' });
        if (!pris) return { ok: false, raison: 'deja-migre', essais: ins.essais };            // une reprise simultanée a gagné
        const gratuit = Math.max(0, pris.soldeGratuit ?? 0), cible = Math.min(gratuit, dotation);
        const essais = unite ? cible : Math.min(cible, ins.essais), excedent = gratuit - essais;   // sans unité du plafond (le solde a bougé entre la lecture et la prise), jamais d'élévation
        await col('installations').updateOne({ _id: ins._id }, { $set: { essais, heriteEmpreinte: h } }, { session: s });   // l'index unique partiel refuse un même userId sur deux installations
        if (essais !== ins.essais) await col('mouvements').insertOne(mouv({ installationId: ins._id }, essais - ins.essais, 'essai', 'heritage-1.0', `heritage|${h}`, cfg, maintenant), { session: s });
        if (excedent > 0) console.warn(`ℹ️ [v2 heritage] ${h.slice(0, 12)} : gratuit ${gratuit} > dotation d'essai ${dotation} : ${excedent} crédit(s) d'excédent NON repris`);
        else console.log(`ℹ️ [v2 heritage] ${h.slice(0, 12)} : ${essais} essai(s) repris`);
        return { ok: true, essais, excedent };
    }, session).catch(e => {
        if (e && e.code === 11000) return { ok: false, raison: 'deja-migre' };
        throw e;
    });
}

// les portefeuilles dont l'adresse Stripe pourrait égaler celle du compte : le domaine est comparé sans casse (googlemail = gmail), la clé exacte juge ensuite
function motifDomaine(emailCleDuCompte) {
    const d = emailCleDuCompte.slice(emailCleDuCompte.indexOf('@') + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`@${d === 'gmail\\.com' ? '(gmail|googlemail)\\.com' : d}\\s*$`, 'i');
}
async function rattacherAchats({ compteId, maintenant = new Date(), session = null }, cfg, { emailCle } = {}) {
    const cle = chargerEmailCle(emailCle);
    const compte = await col('comptes').findOne({ _id: compteId });
    if (!compte || compte.verifie !== true || !compte.emailCle) return { ok: false, raison: 'compte-non-verifie', total: 0 };
    const candidats = await col('credits').find({ email: { $regex: motifDomaine(compte.emailCle) }, achatsMigresVers: { $exists: false }, soldeScans: { $gt: 0 } }).toArray();
    let total = 0; const rattaches = [];
    for (const c of candidats) {
        if (cle(c.email) !== compte.emailCle) continue;                                       // la preuve : l'adresse, et rien d'autre
        let n = 0;
        try { n = await dansUneTransaction(async s => {
            const ok = await col('comptes').countDocuments({ _id: compteId, verifie: true }, { session: s });
            if (!ok) return 0;
            const avant = await col('credits').findOneAndUpdate({ _id: c._id, achatsMigresVers: { $exists: false }, soldeScans: { $gt: 0 } },
                { $set: { soldeScans: 0, achatsMigresVers: compteId, achatsMigresLe: maintenant } }, { session: s, returnDocument: 'before' });
            if (!avant) return 0;                                                              // un rattachement simultané a gagné
            const n = avant.soldeScans;
            await col('comptes').updateOne({ _id: compteId }, { $inc: { 'solde.achete': n } }, { session: s });
            await col('mouvements').insertOne(mouv({ compteId }, n, 'achete', 'migration-stripe', `migration-stripe|${empreinte(c.userId)}`, cfg, maintenant), { session: s });
            return n;
        }, session); } catch (e) { if (e.code !== 11000) throw e; n = 0; }               // la clé migration-stripe|… existe déjà : ce portefeuille a déjà été rattaché
        if (n > 0) { total += n; rattaches.push(empreinte(c.userId).slice(0, 12)); console.log(`ℹ️ [v2 rattachement] ${n} crédit(s) acheté(s) du portefeuille ${rattaches[rattaches.length - 1]} rattachés au compte ${compteId}`); }
    }
    return { ok: true, total, rattaches: rattaches.length };
}
function emailCleB2OuNull() { try { return chargerEmailCle(null); } catch (_) { return null; } }
module.exports = { reprendreHeritage, rattacherAchats, empreinte, chargerEmailCle, emailCleB2OuNull };
