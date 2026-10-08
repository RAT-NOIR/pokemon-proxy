'use strict';
// LE CHEMIN DE L'ARGENT v2. Tout compteur est un findOneAndUpdate CONDITIONNEL atomique (jamais lire-puis-écrire) ;
// un remboursement ne rend jamais plus que ce qui a été pris ; un cas non classé => QUOTA / non remboursé, et la cause s'écrit.
const { col } = require('../db'); const { semaineISO } = require('../../acces'); const P = require('./poches');
const expireMouvement = (now, cfg) => new Date(now.getTime() + cfg.retention.mouvementsMois * 30.5 * 86400e3);
const base = p => (p.type === 'compte' ? { compteId: p.id } : { installationId: p.id });

async function incrementerHebdo(compteId, semaine, now) {   // upsert + course de première insertion (11000) : on retente une fois, comme limites.consommer
    const filtre = { compteId, semaine }, maj = { $inc: { count: 1 }, $setOnInsert: { expireLe: new Date(now.getTime() + 60 * 86400e3) } };
    try { return await col('hebdo').findOneAndUpdate(filtre, maj, { upsert: true, returnDocument: 'after' }); }
    catch (e) { if (e.code !== 11000) throw e; return col('hebdo').findOneAndUpdate(filtre, { $inc: { count: 1 } }, { returnDocument: 'after' }); }
}
async function essayerPoche(poche, p, cfg, now) {
    const compte = p.compte;
    if (poche === 'essai') {
        if (p.type !== 'installation') return null;
        return (await col('installations').findOneAndUpdate({ _id: p.id, essais: { $gt: 0 } }, { $inc: { essais: -1 } })) ? { poche } : null;
    }
    if (poche === 'achete' && p.type === 'installation')
        return (await col('installations').findOneAndUpdate({ _id: p.id, achete: { $gt: 0 } }, { $inc: { achete: -1 } })) ? { poche } : null;
    if (!compte || p.type !== 'compte') return null;
    if (poche === 'accueil')
        return (await col('comptes').findOneAndUpdate({ _id: compte._id, verifie: true, 'solde.accueil': { $gt: 0 } }, { $inc: { 'solde.accueil': -1 } })) ? { poche } : null;
    if (poche === 'achete')
        return (await col('comptes').findOneAndUpdate({ _id: compte._id, 'solde.achete': { $gt: 0 } }, { $inc: { 'solde.achete': -1 } })) ? { poche } : null;
    if (poche === 'hebdo') {
        if (cfg.quotas.hebdo <= 0) return null;
        // la vérification se lit en BASE (pas sur l'instantané du porteur) : une garde s'écrit par ce qu'elle autorise
        if (!(await col('comptes').countDocuments({ _id: compte._id, verifie: true }))) return null;
        const semaine = semaineISO(now), doc = await incrementerHebdo(compte._id, semaine, now);
        if (doc.count <= cfg.quotas.hebdo) return { poche, semaineIso: semaine };
        await col('hebdo').updateOne({ compteId: compte._id, semaine }, { $inc: { count: -1 } });   // on rend le jeton pris : le compteur ne dérive pas
        return null;
    }
    if (poche === 'abonnement') {
        const mois = P.moisCle(now), actif = { 'abonnement.actif': true, 'abonnement.jusquAu': { $gt: now } };
        await col('comptes').updateOne({ _id: compte._id, ...actif, 'abonnement.moisCle': { $ne: mois } },
            [{ $set: { 'abonnement.moisCle': mois, 'abonnement.restant': '$abonnement.quotaMensuel' } }]);   // le mois a changé : recharge, sans report
        return (await col('comptes').findOneAndUpdate({ _id: compte._id, ...actif, 'abonnement.moisCle': mois, 'abonnement.restant': { $gt: 0 } }, { $inc: { 'abonnement.restant': -1 } }))
            ? { poche, moisCle: mois } : null;
    }
    return null;   // poche inconnue : on n'invente rien
}
async function debiter(porteur, { scanId = null, cleIdempotence = null, surface = null, maintenant = new Date() } = {}, cfg) {
    if (cleIdempotence) {
        const dej = await col('mouvements').findOne({ cleIdempotence });
        if (dej) return { ok: true, rejoue: true, credit: dej.credit ?? null, administrateur: dej.motif === 'administrateur' };
    }
    const mv = { ...base(porteur), le: maintenant, surface: surface ?? porteur.surface, type: 'debit', delta: -1, poche: null, credit: null, motif: null,
                 scanId, etat: 'debite', cleIdempotence, expireLe: expireMouvement(maintenant, cfg) };
    if (porteur.administrateur) {
        Object.assign(mv, { delta: 0, motif: 'administrateur' });
        try { await col('mouvements').insertOne(mv); } catch (e) { if (e.code !== 11000) throw e; }
        return { ok: true, administrateur: true, credit: null };
    }
    let credit = null;
    for (const poche of P.ordreDe(porteur, cfg)) { credit = await essayerPoche(poche, porteur, cfg, maintenant); if (credit) break; }
    if (!credit) {
        if (cleIdempotence) {   // un jumeau de même clé a peut-être gagné pendant que ce refus se décidait : c'est un rejeu, pas un refus
            const dej = await col('mouvements').findOne({ cleIdempotence });
            if (dej) return { ok: true, rejoue: true, credit: dej.credit ?? null, administrateur: dej.motif === 'administrateur' };
        }
        return { ok: false, code: porteur.compte && !porteur.compte.verifie ? 'VERIFICATION' : 'QUOTA' };
    }
    mv.poche = credit.poche; mv.credit = credit;
    try { await col('mouvements').insertOne(mv); }
    catch (e) {
        if (e.code !== 11000 || !cleIdempotence) throw e;
        await rendrePoche(porteur, credit, cfg, maintenant);                   // une requête jumelle l'a emporté : on rend ce crédit-ci, le sien reste pris
        const dej = await col('mouvements').findOne({ cleIdempotence });
        return { ok: true, rejoue: true, credit: dej ? dej.credit : null };
    }
    return { ok: true, credit };
}
// rendrePoche : ne rend JAMAIS plus que ce qui a été pris (chaque filtre porte son plafond)
async function rendrePoche(porteur, credit, cfg, now) {
    const un = r => (r.modifiedCount ?? 0) > 0;
    if (!credit) return { rendu: false, raison: 'aucun-debit' };
    const compteId = porteur.type === 'compte' ? porteur.id : null;
    let rendu = false, raison = 'poche-introuvable';
    if (credit.poche === 'essai') rendu = un(await col('installations').updateOne({ _id: porteur.id, essais: { $lt: Math.max(cfg.quotas.essai, cfg.quotas.accueil) } }, { $inc: { essais: 1 } }));
    else if (credit.poche === 'achete') rendu = porteur.type === 'compte'
        ? un(await col('comptes').updateOne({ _id: compteId }, { $inc: { 'solde.achete': 1 } }))
        : un(await col('installations').updateOne({ _id: porteur.id }, { $inc: { achete: 1 } }));
    else if (credit.poche === 'accueil') { rendu = un(await col('comptes').updateOne({ _id: compteId, 'solde.accueil': { $lt: cfg.quotas.accueil } }, { $inc: { 'solde.accueil': 1 } })); if (!rendu) raison = 'accueil-au-plafond'; }
    else if (credit.poche === 'hebdo') {
        if (semaineISO(now) !== credit.semaineIso) raison = 'hebdo-semaine-changee';   // rembourser dans une autre semaine offrirait un scan de plus
        else rendu = un(await col('hebdo').updateOne({ compteId, semaine: credit.semaineIso, count: { $gt: 0 } }, { $inc: { count: -1 } }));
    } else if (credit.poche === 'abonnement') {
        if (P.moisCle(now) !== credit.moisCle) raison = 'abonnement-mois-change';
        else rendu = un(await col('comptes').updateOne({ _id: compteId, 'abonnement.moisCle': credit.moisCle, $expr: { $lt: ['$abonnement.restant', '$abonnement.quotaMensuel'] } }, { $inc: { 'abonnement.restant': 1 } }));
    }
    return { rendu, raison: rendu ? null : raison };
}
module.exports = { debiter, rendrePoche, essayerPoche };
