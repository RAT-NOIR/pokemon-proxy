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
        // compteId: null — une installation LIÉE n'a plus de poches propres : son porteur est le compte
        return (await col('installations').findOneAndUpdate({ _id: p.id, compteId: null, essais: { $gt: 0 } }, { $inc: { essais: -1 } })) ? { poche } : null;
    }
    if (poche === 'achete' && p.type === 'installation')
        return (await col('installations').findOneAndUpdate({ _id: p.id, compteId: null, achete: { $gt: 0 } }, { $inc: { achete: -1 } })) ? { poche } : null;
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
const ATTENTES_JUMEAU = 5, PAUSE_JUMEAU_MS = 20;
async function debiter(porteur, { scanId = null, cleIdempotence = null, surface = null, maintenant = new Date() } = {}, cfg) {
    const rejeu = dej => {
        // une clé appartient à UN porteur : la rejouer sous un autre ne rend ni son crédit ni son verdict (B1 doit la préfixer par le porteur ; ici on ferme quand même)
        if (String(dej.compteId ?? dej.installationId) !== String(porteur.id)) throw new Error('debiter : cleIdempotence appartenant à un autre porteur');
        // Tour 4 (1) — une ligne dont le rendu est commencé/échoué (« rendu-en-cours » / « rendu-echoue ») n'est NI rejouée (le crédit a pu être rendu : scan gratuit) NI redébitée (double débit) :
        // l'argent de cette ligne attend la réconciliation. Aucune analyse livrée, aucun crédit touché.
        if (dej.type === 'debit' && ETATS_RENDU_NON_CONFIRME.includes(dej.etat)) {
            console.error(`🔴 [v2 debiter] clé ${dej.cleIdempotence} : ligne « ${dej.etat} » — rejeu REFUSÉ (EN_RECONCILIATION), ni rejoué ni redébité ; à résoudre par la réconciliation`);
            return { ok: false, code: 'EN_RECONCILIATION', cle: dej.cleIdempotence };
        }
        return { ok: true, rejoue: true, credit: dej.credit ?? null, administrateur: dej.motif === 'administrateur', cle: dej.cleIdempotence };
    };
    // I2 — une clé dont le débit a été REMBOURSÉ n'est plus un rejeu mais une NOUVELLE tentative (une panne retentée avec la même clé ne doit pas être gratuite) :
    // elle débite à nouveau sous une clé DÉRIVÉE, unique par maillon de la chaîne (cleOrigine + id du maillon remboursé) ; deux retentatives simultanées se départagent sur cette clé.
    let cleEff = cleIdempotence, origine = null, reessaye = false;
    if (cleIdempotence) {
        const dej = await col('mouvements').findOne({ cleIdempotence });
        if (dej) {
            if (!(dej.type === 'debit' && dej.etat === 'rembourse')) return rejeu(dej);
            rejeu(dej);                                                           // propriété de la clé : lève si elle est à un autre porteur
            const [fin] = await col('mouvements').find({ cleOrigine: cleIdempotence, type: 'debit' }).sort({ _id: -1 }).limit(1).toArray();
            const bout = fin || dej;
            if (bout.etat !== 'rembourse') return rejeu(bout);
            cleEff = `${cleIdempotence}|retry|${bout._id}`; origine = cleIdempotence; reessaye = true;
        }
    }
    const mv = { ...base(porteur), le: maintenant, surface: surface ?? porteur.surface, type: 'debit', delta: -1, poche: null, credit: null, motif: null,
                 scanId, etat: 'debite', cleIdempotence: cleEff, ...(origine ? { cleOrigine: origine } : {}), expireLe: expireMouvement(maintenant, cfg) };
    // M3 — « administrateur » ne se croit pas sur l'objet porteur : il se relit en base (comptes.role), comme la vérification de l'hebdo
    const admin = porteur.administrateur === true && porteur.type === 'compte' && (await col('comptes').countDocuments({ _id: porteur.id, role: 'administrateur' })) > 0;
    if (admin) {
        Object.assign(mv, { delta: 0, motif: 'administrateur' });
        try { await col('mouvements').insertOne(mv); } catch (e) { if (e.code !== 11000) throw e; }
        return { ok: true, administrateur: true, credit: null };
    }
    let credit = null;
    for (const poche of P.ordreDe(porteur, cfg)) { credit = await essayerPoche(poche, porteur, cfg, maintenant); if (credit) break; }
    if (!credit) {
        if (cleEff) {   // un jumeau de même clé a peut-être gagné pendant que ce refus se décidait : c'est un rejeu, pas un refus
            // LEDGER-COURSE — le jumeau a pu prendre la DERNIÈRE poche sans avoir encore écrit son mouvement (deux écritures distinctes) : une seule lecture
            // rendait « QUOTA » à une requête légitime. On relit brièvement (bornée : 5 × 20 ms, seulement sur un refus portant une clé) ; sans jumeau, le refus reste QUOTA.
            for (let essai = 0; essai < ATTENTES_JUMEAU; essai++) {
                const dej = await col('mouvements').findOne({ cleIdempotence: cleEff });
                if (dej) return rejeu(dej);
                if (essai < ATTENTES_JUMEAU - 1) await new Promise(r => setTimeout(r, PAUSE_JUMEAU_MS));
            }
        }
        return { ok: false, code: porteur.compte && !porteur.compte.verifie ? 'VERIFICATION' : 'QUOTA' };
    }
    mv.poche = credit.poche; mv.credit = credit;
    try { await col('mouvements').insertOne(mv); }
    catch (e) {
        if (e.code !== 11000 || !cleEff) {
            // B1b.3 n°5b — la poche est DÉJÀ prise (écriture atomique distincte) : une écriture du mouvement qui échoue ne doit pas la perdre. Si le mouvement existe malgré
            // l'erreur (réponse perdue), le débit est valide ; s'il n'existe pas, la poche est rendue ; si on ne peut pas le savoir, on le DIT (réconciliation).
            let ecrit = false;
            try { const filtre = mv._id ? { _id: mv._id } : (cleEff ? { cleIdempotence: cleEff } : null); ecrit = filtre ? Boolean(await col('mouvements').findOne(filtre)) : false; } catch (_) { ecrit = null; }
            // LIMITES CONNUES (audit B8, ne pas y toucher ici) :
            //  · M1 — la vérification elle-même échoue (la base répond mal à ce moment) : `ecrit` vaut null, la poche reste prise ET rien n'est en base. C'est le cas journalisé
            //    ci-dessous ; aucune réparation automatique, la réconciliation ne voit pas de mouvement à rapprocher.
            //  · M2 — l'écriture d'origine arrive TARD, après la compensation : le mouvement existe alors ET la poche a été rendue (crédit gratuit). Fenêtre étroite (le
            //    pilote a déjà rendu une erreur), non fermée ; la clé d'idempotence unique empêche au moins un second mouvement de même clé.
            if (ecrit === null) console.error(`🔴 [v2 debiter] écriture du mouvement en erreur et état inconnu : poche ${credit.poche} prise, NON rendue — clé ${cleEff ?? 'aucune'}, porteur ${porteur.type}:${porteur.id} — à voir par la réconciliation`);
            else if (!ecrit) {
                // M3 : un `rendu:false` (hebdo-semaine-changee, accueil-au-plafond, poche-introuvable) n'est pas une exception — il se journalise aussi
                try {
                    const r = await rendrePoche(porteur, credit, cfg, maintenant);
                    if (!r.rendu) console.error(`🔴 [v2 debiter] poche ${credit.poche} NON rendue après l'échec du mouvement (${r.raison}) — clé ${cleEff ?? 'aucune'}, porteur ${porteur.type}:${porteur.id}`);
                } catch (e2) { console.error(`🔴 [v2 debiter] poche NON rendue après l'échec du mouvement : ${e2.message} — clé ${cleEff ?? 'aucune'}, porteur ${porteur.type}:${porteur.id}`); }
            }
            if (ecrit !== true) throw e;
            return reessaye ? { ok: true, credit, reessaye: true, cle: cleEff } : { ok: true, credit, cle: cleEff };
        }
        await rendrePoche(porteur, credit, cfg, maintenant);                   // une requête jumelle l'a emporté : on rend ce crédit-ci, le sien reste pris
        const dej = await col('mouvements').findOne({ cleIdempotence: cleEff });
        return dej ? rejeu(dej) : { ok: true, rejoue: true, credit: null };
    }
    return reessaye ? { ok: true, credit, reessaye: true, cle: cleEff } : { ok: true, credit, cle: cleEff };   // `cle` : la clé de la ligne EFFECTIVEMENT débitée (dérivée si ré-essai, N1)
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
// rendreLeScan : ordre = débits enregistrés → CLAIM du mouvement rb|scanId (une fois par scan) → plafond (incrément puis rollback) → unité par unité (prise atomique, rendu, trace) → si rien rendu, libérer claim ET compteur.
async function rendreLeScan(porteur, motif, { scanId, compteur = 'panne', jourDe, sansPlafond = false, maintenant = new Date() } = {}, cfg) {
    if (!scanId) { console.error('❌ [v2 rembourser] scanId absent : la clé rb|… serait commune à tous les scans — refusé'); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    let cle = `rb|${scanId}`;
    const jour = (jourDe instanceof Date && !Number.isNaN(jourDe.getTime()) ? jourDe : maintenant).toISOString().slice(0, 10);
    const type = compteur === 'question' ? 'question' : 'panne', plafond = cfg.plafonds[type], porteurCle = `${porteur.type}:${porteur.id}`;
    // « ne rend jamais plus que ce qui a été pris » : on juge sur les DÉBITS enregistrés pour ce scan et CE porteur, jamais sur un objet `credit` présenté par l'appelant
    let pendantes;
    try {
        const debits = await col('mouvements').find({ ...base(porteur), type: 'debit', scanId, delta: -1 }).toArray();
        if (!debits.some(d => d.credit)) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
        pendantes = debits.filter(ouvertes);
        if (!pendantes.length) return { rendu: false, raisonNonRembourse: 'deja-rembourse' };
        // une NOUVELLE tentative (même clé d'idempotence rejouée après un premier remboursement, I2) est un autre débit du même scan : sa claim porte l'id de sa 1re unité
        pendantes.sort((a, b) => String(a._id) < String(b._id) ? -1 : 1);
        if (pendantes[0].cleOrigine) cle = `rb|${scanId}|${pendantes[0]._id}`;
        // M2 — une panne ne rembourse pas une question DÉJÀ répondue par un candidat : un résultat A été livré
        if (compteur !== 'question' && await col('questions').findOne({ scanId, 'porteur.type': porteur.type, 'porteur.id': porteur.id, etat: 'repondue', lot: { $ne: true }, 'reponse.aucune': false }, { projection: { _id: 1 } }))
            return { rendu: false, raisonNonRembourse: 'deja-livre' };
    } catch (e) { console.error(`❌ [v2 rembourser] lecture des débits : ${e.message}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    try { await col('mouvements').insertOne({ ...base(porteur), le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 0, poche: null, motif, scanId, etat: 'rembourse', cleIdempotence: cle, expireLe: expireMouvement(maintenant, cfg) }); }
    catch (e) { if (e.code === 11000) return { rendu: false, raisonNonRembourse: 'deja-rembourse' }; console.error(`❌ [v2 rembourser] claim : ${e.message}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    let compteurPris = false;
    const liberer = async () => { await col('mouvements').deleteOne({ cleIdempotence: cle }); if (compteurPris) await col('plafonds').updateOne({ porteur: porteurCle, jour, type }, { $inc: { count: -1 } }); };
    const rendus = [];
    let premiereRaison = null;
    // P — remboursement PARTIEL : la ligne-claim est la trace de la 1re unité rendue ; on la renomme pour libérer `rb|…`, afin que les unités restituées « debite » restent remboursables.
    // Pas de double remboursement : chaque unité ne se rend que par sa prise atomique (etat ≠ rembourse), quel que soit le nombre de claims successifs.
    const libererClaim = () => col('mouvements').updateOne({ cleIdempotence: cle }, { $set: { cleIdempotence: `${cle}|fait|${rendus[0]}` } });
    try {
        // I1 — le remboursement rend CHAQUE unité débitée pour ce scan (un lot = 1 débit + des suppléments au même scanId), jugée sur les débits ENREGISTRÉS ;
        // une unité n'est rendue qu'une fois (le passage de son débit à « rembourse » est la prise atomique), et tout le scan compte pour UN seul remboursement au plafond.
        pendantes.sort((a, b) => String(a._id) < String(b._id) ? -1 : 1);
        if (!sansPlafond) {
            const c = await incPlafond(porteurCle, jour, type, maintenant); compteurPris = true;
            if (c.count > plafond) { await liberer(); return { rendu: false, raisonNonRembourse: 'plafond-jour' }; }
        }
        for (const d of pendantes) {
            const pris = await col('mouvements').findOneAndUpdate({ _id: d._id, etat: { $nin: ETATS_CLOS } }, { $set: { etat: 'rembourse', expireLe: expireMouvement(maintenant, cfg) } }, { returnDocument: 'before' });   // une ligne « rendu-echoue » reprise retrouve son expiration
            if (!pris) continue;                                                  // un autre chemin vient de la rendre
            const restituer = () => col('mouvements').updateOne({ _id: d._id }, pris.expireLe ? { $set: { etat: pris.etat, expireLe: pris.expireLe } } : { $set: { etat: pris.etat }, $unset: { expireLe: '' } });
            let r;
            try { r = await rendreUnite(porteur, d.credit, cfg, maintenant); } catch (e) { await restituer(); throw e; }
            if (!r.rendu) { await restituer(); premiereRaison = premiereRaison || r.raison; continue; }
            // la trace : la ligne-claim `rb|scanId` devient celle de la 1re unité rendue, les suivantes ont la leur (`rb|scanId#k`) — somme(delta) reste égale au solde
            const cible = r.cible, ligne = { ...base(cible), poche: r.pocheRendue };
            if (!rendus.length) await col('mouvements').updateOne({ cleIdempotence: cle }, { $set: { delta: 1, ...ligne }, ...(cible.type === 'compte' ? { $unset: { installationId: '' } } : { $unset: { compteId: '' } }) });
            else await col('mouvements').insertOne({ ...ligne, le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 1, motif, scanId, etat: 'rembourse', cleIdempotence: `${cle}#${d._id}`, expireLe: expireMouvement(maintenant, cfg) });
            rendus.push(d._id);
        }
        if (!rendus.length) { await liberer(); return { rendu: false, raisonNonRembourse: premiereRaison || 'poche-introuvable' }; }
        if (rendus.length < pendantes.length) { await libererClaim(); return { rendu: true, raisonNonRembourse: null, unites: rendus.length, partiel: true, raisonPartielle: premiereRaison }; }
        return { rendu: true, raisonNonRembourse: null, unites: rendus.length };
    } catch (e) {
        console.error(`❌ [v2 rembourser] ${e.message}`);
        if (rendus.length) { try { await libererClaim(); } catch (_) { /* la réconciliation le dira */ } return { rendu: true, raisonNonRembourse: null, unites: rendus.length, partiel: true, raisonPartielle: 'erreur' }; }   // des unités SONT rendues et tracées : on garde le compteur
        try { await liberer(); } catch (_) { /* la réconciliation (B3.6) le dira */ }
        return { rendu: false, raisonNonRembourse: 'erreur' };
    }
}
// M6 — le porteur effectif d'une unité : une installation LIÉE entre-temps n'a plus de poches propres, le crédit est rendu à celles du COMPTE (essai → accueil, plafonné ; acheté → acheté).
async function rendreUnite(porteur, credit, cfg, now) {
    let cible = porteur, c = credit;
    if (porteur.type === 'installation') {
        const i = await col('installations').findOne({ _id: porteur.id }, { projection: { compteId: 1 } });
        if (i && i.compteId) {
            cible = { type: 'compte', id: i.compteId };
            c = { poche: credit.poche === 'essai' ? 'accueil' : credit.poche };
            if (!['accueil', 'achete'].includes(c.poche)) return { rendu: false, raison: 'poche-introuvable', pocheRendue: c.poche, cible };
        }
    }
    const r = await rendrePoche(cible, c, cfg, now);
    return { rendu: r.rendu, raison: r.raison, pocheRendue: c.poche, cible };
}
// « rendu-en-cours » : un rendu commencé et non confirmé (processus tué, écriture d'état échouée) — ni ouverte ni close : jamais reprise seule (le crédit a pu être rendu), listée par la réconciliation.
const ETATS_RENDU_NON_CONFIRME = ['rendu-en-cours', 'rendu-echoue'];   // lignes de débit en attente de réconciliation : jamais rejouées, jamais expirées
const ETATS_CLOS = ['rembourse', 'rendu-en-cours'];
const ouvertes = d => d.credit && !ETATS_CLOS.includes(d.etat);
async function rembourser(porteur, credit, motif, o = {}, cfg) {
    if (!credit) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
    const r = await rendreLeScan(porteur, motif, o, cfg);
    return { rendu: r.rendu, raisonNonRembourse: r.raisonNonRembourse };
}
// rembourserLot : rend TOUTES les unités du scan (B1b l'appelle pour un lot entièrement introuvable / sans prix). `credits` ne sert qu'à refuser un lot sans aucun débit (administrateur) : les unités se lisent au journal.
async function rembourserLot(porteur, credits, motif, o = {}, cfg) {
    if (!Array.isArray(credits) || !credits.some(Boolean)) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
    return rendreLeScan(porteur, motif, o, cfg);
}
// rembourserLigne : rend UNE ligne de débit, désignée par sa clé EFFECTIVE (celle que `debiter` vient de rendre) — jamais le scan entier (N2 : un autre débit ouvert du même scan
// peut être livré ou réservé pour une autre carte). Prise atomique de la ligne ; si le rendu échoue, la ligne passe en « rendu-echoue » (lisible, toujours remboursable) et l'échec est journalisé en erreur.
async function rembourserLigne(porteur, cle, motif, { maintenant = new Date() } = {}, cfg) {
    if (!cle) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
    let d;
    try {
        d = await col('mouvements').findOne({ ...base(porteur), type: 'debit', cleIdempotence: cle });
        if (!d || !d.credit) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
        // La prise écrit « rendu-en-cours » (jamais « rembourse » avant que le crédit soit rendu) : si le processus ou une écriture ultérieure échoue, la ligne reste VISIBLE
        // (réconciliation) et ne peut être ni reprise seule ni rendue deux fois (ni rembourserLigne ni rendreLeScan ne prennent un « rendu-en-cours »).
        const pris = await col('mouvements').findOneAndUpdate({ _id: d._id, etat: { $nin: ETATS_CLOS } }, { $set: { etat: 'rendu-en-cours' }, $unset: { expireLe: '' } }, { returnDocument: 'before' });   // tour 4 (2) : une ligne non résolue n'expire pas
        if (!pris) return { rendu: false, raisonNonRembourse: 'deja-rembourse' };
    } catch (e) { console.error(`🔴 [v2 rembourser-ligne] ${cle} : ${e.message}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    const ecrireEtat = async (etat, plus = {}) => {                              // un second essai, puis l'échec est dit : la ligne garde alors « rendu-en-cours »
        for (let essai = 0; essai < 2; essai++) { try { await col('mouvements').updateOne({ _id: d._id }, etat === 'rembourse' ? { $set: { etat, ...plus, expireLe: expireMouvement(maintenant, cfg) } } : { $set: { etat, ...plus }, $unset: { expireLe: '' } }); return true; } catch (e) { if (essai) console.error(`🔴 [v2 rembourser-ligne] ${cle} : état « ${etat} » non écrit (${e.message}) — la ligne reste « rendu-en-cours » (réconciliation)`); } }
        return false;
    };
    const echec = async raison => {
        console.error(`🔴 [v2 rembourser-ligne] ${cle} : crédit NON rendu (${raison}) — ligne « rendu-echoue », à rendre à la main ou par la reprise`);
        await ecrireEtat('rendu-echoue', { raisonRendu: raison });
        return { rendu: false, raisonNonRembourse: raison };
    };
    let r;
    try { r = await rendreUnite(porteur, d.credit, cfg, maintenant); } catch (e) { return echec('erreur'); }
    if (!r.rendu) return echec(r.raison || 'poche-introuvable');
    try { await col('mouvements').insertOne({ ...base(r.cible), poche: r.pocheRendue, le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 1, motif, scanId: d.scanId, etat: 'rembourse', cleIdempotence: `rl|${cle}`, expireLe: expireMouvement(maintenant, cfg) }); }
    catch (e) { console.error(`🔴 [v2 rembourser-ligne] ${cle} : crédit rendu mais trace non écrite (${e.message}) — la réconciliation le dira`); }
    await ecrireEtat('rembourse');                                              // crédit rendu : si cette écriture échoue, la ligne reste « rendu-en-cours » (listée), jamais rendue une 2e fois
    return { rendu: true, raisonNonRembourse: null };
}
module.exports = { debiter, rendrePoche, essayerPoche, rembourser, rembourserLot, rembourserLigne, ETATS_CLOS, ETATS_RENDU_NON_CONFIRME };
