'use strict';
// LE CHEMIN DE L'ARGENT v2. Tout compteur est un findOneAndUpdate CONDITIONNEL atomique (jamais lire-puis-écrire) ;
// un remboursement ne rend jamais plus que ce qui a été pris ; un cas non classé => QUOTA / non remboursé, et la cause s'écrit.
const db = require('../db'); const { semaineISO } = require('../../acces'); const P = require('./poches');
const col = nom => db.col(nom);   // indirection VOLONTAIRE : les bancs y glissent une panne simulée (db.col remplacé)
const expireMouvement =(now, cfg) => new Date(now.getTime() + cfg.retention.mouvementsMois * 30.5 * 86400e3);
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
async function incPlafond(porteurCle, jour, type, now) {   // même schéma que incrementerHebdo ; expire 2 jours après la fin du jour compté
    const filtre = { porteur: porteurCle, jour, type };
    const maj = { $inc: { count: 1 }, $setOnInsert: { expireLe: new Date(new Date(`${jour}T00:00:00Z`).getTime() + 3 * 86400e3) } };
    try { return await col('plafonds').findOneAndUpdate(filtre, maj, { upsert: true, returnDocument: 'after' }); }
    catch (e) { if (e.code !== 11000) throw e; return col('plafonds').findOneAndUpdate(filtre, { $inc: { count: 1 } }, { returnDocument: 'after' }); }
}
// rembourser : ordre = CLAIM du mouvement rb|scanId (une fois par scan) → plafond (incrément puis rollback) → rendrePoche → si rien rendu, libérer claim ET compteur.
async function rembourser(porteur, credit, motif, { scanId, compteur = 'panne', jourDe, sansPlafond = false, maintenant = new Date() } = {}, cfg) {
    if (!credit) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
    if (!scanId) { console.error('❌ [v2 rembourser] scanId absent : la clé rb|… serait commune à tous les scans — refusé'); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    const cle = `rb|${scanId}`, jour = (jourDe instanceof Date && !Number.isNaN(jourDe.getTime()) ? jourDe : maintenant).toISOString().slice(0, 10);
    const type = compteur === 'question' ? 'question' : 'panne', plafond = cfg.plafonds[type], porteurCle = `${porteur.type}:${porteur.id}`;
    try { await col('mouvements').insertOne({ ...base(porteur), le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 1, poche: credit.poche, motif, scanId, etat: 'rembourse', cleIdempotence: cle, expireLe: expireMouvement(maintenant, cfg) }); }
    catch (e) { if (e.code === 11000) return { rendu: false, raisonNonRembourse: 'deja-rembourse' }; console.error(`❌ [v2 rembourser] claim : ${e.message}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    let compteurPris = false;
    const liberer = async () => { await col('mouvements').deleteOne({ cleIdempotence: cle }); if (compteurPris) await col('plafonds').updateOne({ porteur: porteurCle, jour, type }, { $inc: { count: -1 } }); };
    try {
        if (!sansPlafond) {
            const c = await incPlafond(porteurCle, jour, type, maintenant); compteurPris = true;
            if (c.count > plafond) { await liberer(); return { rendu: false, raisonNonRembourse: 'plafond-jour' }; }
        }
        const { rendu, raison } = await rendrePoche(porteur, credit, cfg, maintenant);
        if (!rendu) { await liberer(); return { rendu: false, raisonNonRembourse: raison }; }
        await col('mouvements').updateOne({ ...base(porteur), type: 'debit', scanId, etat: { $ne: 'rembourse' } }, { $set: { etat: 'rembourse' } });
        return { rendu: true, raisonNonRembourse: null };
    } catch (e) { try { await liberer(); } catch (_) { /* la réconciliation (B3.6) le dira */ } console.error(`❌ [v2 rembourser] ${e.message}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
}
module.exports = { debiter, rendrePoche, essayerPoche, rembourser };
