'use strict';
// LE CHEMIN DE L'ARGENT v2. Tout compteur est un findOneAndUpdate CONDITIONNEL atomique (jamais lire-puis-écrire) ;
// un remboursement ne rend jamais plus que ce qui a été pris ; un cas non classé => QUOTA / non remboursé, et la cause s'écrit.
const db = require('../db'); const { semaineISO } = require('../../acces'); const P = require('./poches'); const Of = require('./offre'); const { ObjectId } = require('mongoose').Types;
const col = nom => db.col(nom);   // indirection VOLONTAIRE : les bancs y glissent une panne simulée (db.col remplacé)
const expireMouvement =(now, cfg) => new Date(now.getTime() + cfg.retention.mouvementsMois * 30.5 * 86400e3);
const base = p => (p.type === 'compte' ? { compteId: p.id } : { installationId: p.id });
// B8.1 : un journal ne porte JAMAIS une clé d'idempotence en clair (`scan|<porteur>|<Idempotency-Key du client>`) ni le message d'une erreur du pilote (une E11000 cite la clé) :
// l'empreinte (16 hex du SHA-256) permet de rapprocher deux lignes du journal, pas de rejouer la clé.
const cleJournal = c => (c ? require('crypto').createHash('sha256').update(String(c)).digest('hex').slice(0, 16) : 'aucune');
const codeErr = e => (e && (e.code || e.name)) || 'erreur';

async function incrementerHebdo(compteId, semaine, now) {   // upsert + course de première insertion (11000) : on retente une fois, comme limites.consommer
    const filtre = { compteId, semaine }, maj = { $inc: { count: 1 }, $setOnInsert: { expireLe: new Date(now.getTime() + 60 * 86400e3) } };
    try { return await col('hebdo').findOneAndUpdate(filtre, maj, { upsert: true, returnDocument: 'after' }); }
    catch (e) { if (e.code !== 11000) throw e; return col('hebdo').findOneAndUpdate(filtre, { $inc: { count: 1 } }, { returnDocument: 'after' }); }
}
// Le compteur du JOUR (OFFRE-QUOTA) : même mécanique que l'hebdo — upsert + $inc atomique, course de première insertion (11000) retentée une fois, jeton rendu si la limite est dépassée.
async function incrementerJour(porteurCle, jour, now) {
    // le compteur survit 3 jours à son PREMIER usage, mesurés sur l'horloge réelle si l'instant fourni est plus ancien (un rejeu, un banc : un document déjà échu à sa naissance serait retiré par le TTL avant son remboursement)
    const filtre = { porteur: porteurCle, jour }, maj = { $inc: { count: 1 }, $setOnInsert: { expireLe: new Date(Math.max(now.getTime(), Date.now()) + 3 * 86400e3) } };
    try { return await col('quota_jour').findOneAndUpdate(filtre, maj, { upsert: true, returnDocument: 'after' }); }
    catch (e) { if (e.code !== 11000) throw e; return col('quota_jour').findOneAndUpdate(filtre, { $inc: { count: 1 } }, { returnDocument: 'after' }); }
}
// Seule la poche `jour` se DÉBITE. Les anciennes (essai, accueil, hebdo, abonnement, achete) ne le sont plus : leurs soldes restent en base, lisibles, intacts.
async function essayerPoche(poche, p, cfg, now) {
    if (poche !== 'jour') return null;   // poche inconnue ou ancienne : on n'invente rien
    // la limite se lit EN BASE à chaque débit (offre.etatDe) : l'instantané du porteur n'est jamais la preuve de son offre
    const e = await Of.etatDe(p, cfg, now);
    if (!e || !(e.limite > 0)) return null;
    const jour = Of.jourDeParis(now), porteurCle = Of.cleDe(p), doc = await incrementerJour(porteurCle, jour, now);
    // le crédit PORTE son jour et son compteur : un remboursement rend l'unité là où elle a été prise, jamais au jour courant
    if (doc.count <= e.limite) return { poche, jour, porteurCle };
    await col('quota_jour').updateOne({ porteur: porteurCle, jour }, { $inc: { count: -1 } });   // on rend le jeton pris : le compteur ne dérive pas
    return null;
}
// Relecture bornée de la clé avant un QUOTA : atténuation (5 × 20 ms), pas une garantie — voir le commentaire dans debiter.
const ATTENTES_JUMEAU = 5, PAUSE_JUMEAU_MS = 20;
async function debiter(porteur, { scanId = null, cleIdempotence = null, surface = null, maintenant = new Date() } = {}, cfg) {
    const rejeu = dej => {
        // une clé appartient à UN porteur : la rejouer sous un autre ne rend ni son crédit ni son verdict (B1 doit la préfixer par le porteur ; ici on ferme quand même)
        if (String(dej.compteId ?? dej.installationId) !== String(porteur.id)) throw new Error('debiter : cleIdempotence appartenant à un autre porteur');
        // Tour 4 (1) — une ligne dont le rendu est commencé/échoué (« rendu-en-cours » / « rendu-echoue ») n'est NI rejouée (le crédit a pu être rendu : scan gratuit) NI redébitée (double débit) :
        // l'argent de cette ligne attend la réconciliation. Aucune analyse livrée, aucun crédit touché.
        if (dej.type === 'debit' && ETATS_RENDU_NON_CONFIRME.includes(dej.etat)) {
            console.error(`🔴 [v2 debiter] clé ${cleJournal(dej.cleIdempotence)} : ligne « ${dej.etat} » — rejeu REFUSÉ (EN_RECONCILIATION), ni rejoué ni redébité ; à résoudre par la réconciliation`);
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
    const admin = porteur.administrateur === true && porteur.type === 'compte' && Of.estAdministrateur(porteur, await col('comptes').findOne({ _id: porteur.id }, { projection: { role: 1 } }));   // ADMIN-DRAPEAU : la règle d'offre.js, la même que compte.administrateur
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
            // rendait « QUOTA » à une requête légitime. On relit brièvement (seulement sur un refus portant une clé) ; sans jumeau, le refus reste QUOTA.
            // 1. ATTÉNUATION BORNÉE (5 × 20 ms), PAS UNE GARANTIE : un écart prise de poche → insertion du mouvement plus long (reprise réseau, élection de primaire,
            //    pause du ramasse-miettes) rend encore un QUOTA faux ; l'argent, lui, reste juste.
            // 2. En production, /api/identifier est déjà sérialisé par clé par le claim d'idempotence (v2/transport/idempotence.js, `reclamer`) : cette course
            //    n'est atteinte qu'en appel direct.
            // 3. `debiterSupplement` (v2/argent/lot.js), appelé par la route des lots (v2/identifier/lot.js, B1b.8), est couvert : le claim Mongo d'`idempotente`
            //    sérialise la clé de la requête ET la clé du débit initial est unique — seul le gagnant de ce débit atteint le supplément (le perdant sort en `rejoue`).
            //    Tout NOUVEL appelant hors d'une requête claimée devrait poser un marqueur « en cours » atomique sur sa clé AVANT la prise de poche.
            for (let essai = 0; essai < ATTENTES_JUMEAU; essai++) {
                const dej = await col('mouvements').findOne({ cleIdempotence: cleEff });
                if (dej) return rejeu(dej);
                if (essai < ATTENTES_JUMEAU - 1) await new Promise(r => setTimeout(r, PAUSE_JUMEAU_MS));
            }
        }
        // un compte non vérifié se voit demander de confirmer son adresse (relu en base : l'instantané peut dire « vérifié » à tort) ; tout autre refus est QUOTA
        let nonVerifie = false;
        try { const e = await Of.etatDe(porteur, cfg, maintenant); nonVerifie = Boolean(e && e.nonVerifie); } catch (_) { /* repli sur l'instantané ci-dessous */ }
        return { ok: false, code: nonVerifie ? 'VERIFICATION' : P.codeRefus(porteur) };
    }
    mv._id = new ObjectId(); mv.poche = credit.poche; mv.credit = credit;       // l'identité du débit est posée AVANT l'écriture : la compensation et l'écriture tardive la partagent
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
            if (ecrit === null) console.error(`🔴 [v2 debiter] écriture du mouvement en erreur et état inconnu : poche ${credit.poche} prise, NON rendue — clé ${cleJournal(cleEff)}, porteur ${porteur.type}:${porteur.id} — à voir par la réconciliation`);
            else if (!ecrit) {
                // M3 : un `rendu:false` (hebdo-semaine-changee, accueil-au-plafond, poche-introuvable) n'est pas une exception — il se journalise aussi
                try {
                    // MOYENS-B2a tour 2 (I-2, N-7) : la compensation porte l'IDENTITÉ du débit (`mv._id`, posée avant l'écriture) sur la poche, dans la même écriture que le crédit. Si l'écriture d'origine arrive TARD (limite M2), le débit
                    // tardif a le même `_id` : tout chemin qui voudrait le rendre reçoit « poche-deja-compensee » (le crédit de CE débit existe), jamais un second crédit. Plus de trace séparée, plus d'horodatage à comparer.
                    const r = await rendrePoche(porteur, credit, cfg, maintenant, mv._id);
                    if (!r.rendu) console.error(`🔴 [v2 debiter] poche ${credit.poche} NON rendue après l'échec du mouvement (${r.raison}) — clé ${cleJournal(cleEff)}, porteur ${porteur.type}:${porteur.id}`);
                } catch (e2) { console.error(`🔴 [v2 debiter] poche NON rendue après l'échec du mouvement : ${codeErr(e2)} — clé ${cleJournal(cleEff)}, porteur ${porteur.type}:${porteur.id}`); }
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
// MOYENS-B2a tour 2 — UN CRÉDIT SE RECONNAÎT PAR SON DÉBIT. Quand `debitId` est donné, l'identité du débit est posée sur le document de la poche (`creditsRendus`, les CREDITS_MAX derniers) dans la MÊME écriture
// atomique que le $inc, et le filtre exige qu'elle n'y soit pas : deux chemins qui rendent le même débit (`rendreLeScan`, `rembourserLigne`, la réparation, la compensation de `debiter`) ne peuvent pas écrire deux
// crédits TANT QUE l'identité est dans le marqueur. LIMITE EXACTE (relecture 3) : le marqueur ne garde que les CREDITS_MAX (200) DERNIÈRES identités par DOCUMENT de poche (`comptes` en porte un pour accueil, acheté ET abonnement ;
// `installations` un pour essai et acheté) ; au-delà, l'identité la plus ancienne sort et l'absence de marqueur ne prouve plus l'absence de crédit. Le second chemin reçoit `poche-deja-compensee` (le crédit de CE débit existe
// déjà) ; la réparation, elle, REFUSE un débit pris dont l'identité n'est pas dans un marqueur plein (`marqueur-sature`). La preuve d'un crédit est la lecture de ce marqueur (`creditPresent`).
const CREDITS_MAX = 200;
const marqueur = debitId => (debitId ? { filtre: { creditsRendus: { $ne: debitId } }, push: { $push: { creditsRendus: { $each: [debitId], $slice: -CREDITS_MAX } } } } : { filtre: {}, push: {} });
// le document qui porte le compteur d'une poche (et donc le marqueur) : [collection, filtre]
function proprietaireDe(porteur, credit) {
    const compteId = porteur.type === 'compte' ? porteur.id : null;
    if (credit.poche === 'essai') return ['installations', { _id: porteur.id }];
    if (credit.poche === 'achete') return porteur.type === 'compte' ? ['comptes', { _id: compteId }] : ['installations', { _id: porteur.id }];
    if (credit.poche === 'accueil' || credit.poche === 'abonnement') return ['comptes', { _id: compteId }];
    if (credit.poche === 'hebdo') return ['hebdo', { compteId, semaine: credit.semaineIso }];
    if (credit.poche === 'jour') return typeof credit.porteurCle === 'string' && typeof credit.jour === 'string' ? ['quota_jour', { porteur: credit.porteurCle, jour: credit.jour }] : null;
    return null;
}
async function creditPresent(porteur, credit, debitId) {
    const p = proprietaireDe(porteur, credit); if (!p || !debitId) return false;
    return Boolean(await col(p[0]).findOne({ ...p[1], creditsRendus: debitId }, { projection: { _id: 1 } }));
}
async function rendrePoche(porteur, credit, cfg, now, debitId = null) {
    const un = r => (r.modifiedCount ?? 0) > 0;
    if (!credit) return { rendu: false, raison: 'aucun-debit' };
    const compteId = porteur.type === 'compte' ? porteur.id : null;
    const mq = marqueur(debitId);
    let rendu = false, raison = 'poche-introuvable';
    if (credit.poche === 'jour') {
        // OFFRE-QUOTA : l'unité retourne au compteur du JOUR OÙ ELLE A ÉTÉ PRISE (pas au jour courant : après minuit, une unité rendue de la veille ne crée aucun quota en plus), par le même
        // protocole que les autres poches (marqueur d'identité du débit dans la MÊME écriture que le $inc). Le compteur doit être celui de CE porteur : un crédit forgé vers un autre compteur est refusé.
        if (credit.porteurCle !== Of.cleDe(porteur) || typeof credit.jour !== 'string') raison = 'poche-introuvable';
        else rendu = un(await col('quota_jour').updateOne({ porteur: credit.porteurCle, jour: credit.jour, count: { $gt: 0 }, ...mq.filtre }, { $inc: { count: -1 }, ...mq.push }));
    } else if (credit.poche === 'essai') rendu = un(await col('installations').updateOne({ _id: porteur.id, essais: { $lt: Math.max(cfg.quotas.essai, cfg.quotas.accueil) }, ...mq.filtre }, { $inc: { essais: 1 }, ...mq.push }));
    else if (credit.poche === 'achete') rendu = porteur.type === 'compte'
        ? un(await col('comptes').updateOne({ _id: compteId, ...mq.filtre }, { $inc: { 'solde.achete': 1 }, ...mq.push }))
        : un(await col('installations').updateOne({ _id: porteur.id, ...mq.filtre }, { $inc: { achete: 1 }, ...mq.push }));
    else if (credit.poche === 'accueil') { rendu = un(await col('comptes').updateOne({ _id: compteId, 'solde.accueil': { $lt: cfg.quotas.accueil }, ...mq.filtre }, { $inc: { 'solde.accueil': 1 }, ...mq.push })); if (!rendu) raison = 'accueil-au-plafond'; }
    else if (credit.poche === 'hebdo') {
        if (semaineISO(now) !== credit.semaineIso) raison = 'hebdo-semaine-changee';   // rembourser dans une autre semaine offrirait un scan de plus
        else rendu = un(await col('hebdo').updateOne({ compteId, semaine: credit.semaineIso, count: { $gt: 0 }, ...mq.filtre }, { $inc: { count: -1 }, ...mq.push }));
    } else if (credit.poche === 'abonnement') {
        if (P.moisCle(now) !== credit.moisCle) raison = 'abonnement-mois-change';
        else rendu = un(await col('comptes').updateOne({ _id: compteId, 'abonnement.moisCle': credit.moisCle, $expr: { $lt: ['$abonnement.restant', '$abonnement.quotaMensuel'] }, ...mq.filtre }, { $inc: { 'abonnement.restant': 1 }, ...mq.push }));
    }
    // un refus peut venir du marqueur : le crédit de CE débit existe déjà (compensation, autre chemin, exécution interrompue) — il se dit, il ne se confond pas avec un plafond
    if (!rendu && debitId && await creditPresent(porteur, credit, debitId)) return { rendu: false, raison: 'poche-deja-compensee' };
    return { rendu, raison: rendu ? null : raison };
}
async function incPlafond(porteurCle, jour, type, now, pas = 1) {   // même schéma que incrementerHebdo ; expire 2 jours après la fin du jour compté
    const filtre = { porteur: porteurCle, jour, type };
    const maj = { $inc: { count: pas }, $setOnInsert: { expireLe: new Date(new Date(`${jour}T00:00:00Z`).getTime() + 3 * 86400e3) } };
    try { return await col('plafonds').findOneAndUpdate(filtre, maj, { upsert: true, returnDocument: 'after' }); }
    catch (e) { if (e.code !== 11000) throw e; return col('plafonds').findOneAndUpdate(filtre, { $inc: { count: pas } }, { returnDocument: 'after' }); }
}
// PLAFOND-DECLARE (décision du testeur, 2026-10-14). Chaque chemin de remboursement nomme sa NATURE par le compteur qu'il passe ; la table dit ce que cette nature autorise :
//   · `declare`  — l'analyse est rendue sur DÉCLARATION du client (« aucune », « ne-sait-pas », question abandonnée, prix illisible définitif déclaré) : UN SEUL compteur « declare » par porteur et par jour de Paris,
//                  plafonné par l'OFFRE du porteur au moment du remboursement (sans compte 1, gratuit 3, Pro 30 : cfg.plafonds.declares) ; `question` et `sans-prix` en sont les deux noms historiques ;
//   · `constate` — décidé par le SERVEUR seul (panne, introuvable, garde des jumeaux, remboursement à l'émission d'une question) : FREIN-CONSTATES (2026-10-17) — UN SEUL compteur « constate » par porteur et par
//                  jour de Paris, plafonné par l'OFFRE du porteur au moment du remboursement (sans compte 20, gratuit 50, Pro 100 : cfg.plafonds.constates) ; au-delà, `plafond-jour` ;
//                  Le plafond ne porte que sur les constats sur la PHOTO : `introuvable`, `jumeaux`, `constate-question` ;
//   · `infra`    — toute panne de NOTRE côté (`panne` : SERVEUR 500, IA ; `indisponible` : INDISPONIBLE 503) : rendue SANS plafond ni compteur, elle ne se facture jamais au client ;
//   · `lot`      — `lot-trop-grand` (10 par jour, cfg.plafonds.lotTropGrand), INCHANGÉ, indépendant de l'offre.
// `livre` : le contrôle « une panne ne rembourse pas une question déjà répondue par un candidat » (M2) s'applique ; il ne s'applique pas aux remboursements qui SUIVENT une question (leur raison d'être est cette réponse).
// Une garde s'écrit par ce qu'elle AUTORISE : un nom absent de cette table est REFUSÉ (jamais rabattu sur une nature plus large).
const NATURES = Object.freeze({
    panne: { classe: 'infra', livre: true },            // TOUTE panne de NOTRE côté (SERVEUR, IA, INDISPONIBLE) : hors plafond (décision du coordinateur, 2026-10-17)
    indisponible: { classe: 'infra', livre: true },
    introuvable: { classe: 'constate', livre: true },   // un constat sur la photo : plafonné
    jumeaux: { classe: 'constate', livre: true },
    'constate-question': { classe: 'constate', livre: false },
    question: { classe: 'declare', livre: false },
    'sans-prix': { classe: 'declare', livre: false },
    'lot-trop-grand': { classe: 'lot', livre: true }
});
// Le plafond des déclarations du porteur, à l'offre COURANTE (relue en base par offre.etatDe, jamais l'instantané du porteur) : une installation LIÉE a pour offre celle de son compte ; un porteur dont l'offre
// ne se lit pas (compte supprimé, introuvable) reçoit le plafond le plus étroit (sans compte) — jamais une offre plus large. Le COMPTEUR reste celui du porteur présenté (comme le compteur du jour).
// FREIN-CONSTATES : la même lecture d'offre sert les deux tables (`declares`, `constates`), qui ont la même forme { sansCompte, gratuit, pro }.
async function plafondParOffre(porteur, cfg, maintenant, table) {
    let cible = porteur;
    if (porteur.type === 'installation') {
        const i = await col('installations').findOne({ _id: porteur.id }, { projection: { compteId: 1 } });
        if (i && i.compteId != null) cible = { type: 'compte', id: i.compteId };
    }
    const e = await Of.etatDe(cible, cfg, maintenant);
    const nom = e ? e.nom : 'sans-compte';
    return nom === 'pro' ? table.pro : nom === 'gratuit' ? table.gratuit : table.sansCompte;
}
const plafondDesDeclarations = (porteur, cfg, maintenant) => plafondParOffre(porteur, cfg, maintenant, cfg.plafonds.declares);
const plafondDesConstates = (porteur, cfg, maintenant) => plafondParOffre(porteur, cfg, maintenant, cfg.plafonds.constates);
// rendreLeScan : ordre = débits enregistrés → CLAIM du mouvement rb|scanId (une fois par scan) → plafond (incrément puis rollback) → unité par unité (prise atomique « rendu-en-cours », crédit, trace +1, PUIS « rembourse») → si rien rendu, libérer claim ET compteur.
async function rendreLeScan(porteur, motif, { scanId, compteur = 'panne', jourDe, sansPlafond = false, unites = 1, maintenant = new Date() } = {}, cfg) {
    if (!scanId) { console.error('❌ [v2 rembourser] scanId absent : la clé rb|… serait commune à tous les scans — refusé'); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    // `unites` : combien d'unités du compteur ce remboursement consomme (JUMEAU-V2 : UNE par carte refusée par la garde). Un entier >= 1, sinon refus : un compteur qui ne monterait pas serait gratuit sans limite.
    if (!Number.isInteger(unites) || unites < 1) { console.error('❌ [v2 rembourser] unites invalides : refusé'); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    let cle = `rb|${scanId}`;
    const jour = Of.jourDeParis(jourDe instanceof Date && !Number.isNaN(jourDe.getTime()) ? jourDe : maintenant);   // le jour de PARIS, par la même fonction que le quota (relecture 3, I2) : jamais une copie en UTC
    // La NATURE du remboursement (voir NATURES) : `panne` est le défaut quand aucun compteur n'est nommé. `unites` : combien d'unités du compteur ce remboursement consomme (une par carte refusée par la garde
    // des jumeaux, qui n'a plus de compteur : la forme reste validée) — un seul compteur plafonné en consomme TOUJOURS une (un scan = un remboursement).
    // Une garde s'écrit par ce qu'elle AUTORISE : un compteur qui n'est pas dans la table est REFUSÉ (jamais rabattu sur `panne`, qui imputerait en silence une faute de frappe)
    if (!Object.hasOwn(NATURES, compteur)) { console.error(`❌ [v2 rembourser] compteur inconnu (${typeof compteur === 'string' ? compteur.slice(0, 30) : typeof compteur}) : refusé`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    const nature = NATURES[compteur], classe = nature.classe, type = classe === 'declare' || classe === 'constate' ? classe : compteur, porteurCle = `${porteur.type}:${porteur.id}`, pas = 1;
    let declaration = null;      // le jugement d'une DÉCLARATION, posé quand le compteur a été consulté (jamais pour un remboursement constaté, un rejeu ou une reprise)
    // « ne rend jamais plus que ce qui a été pris » : on juge sur les DÉBITS enregistrés pour ce scan et CE porteur, jamais sur un objet `credit` présenté par l'appelant
    let pendantes;
    try {
        const debits = await col('mouvements').find({ ...base(porteur), type: 'debit', scanId, delta: -1 }).toArray();
        if (!debits.some(d => d.credit)) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
        pendantes = debits.filter(ouvertes);
        // MOYENS-B2a tour 1 (I-1) : une unité « rendu-en-cours » n'est PAS rendue (le crédit a pu ne jamais l'être) : « deja-rembourse » serait faux pour le client. Elle se répare par l'outil de l'opérateur (audit §15).
        if (!pendantes.length) return { rendu: false, raisonNonRembourse: debits.some(d => d.credit && d.etat === 'rendu-en-cours') ? 'remboursement-en-cours' : 'deja-rembourse' };
        // (tour 2 : une unité dont la poche a déjà été COMPENSÉE par `debiter` puis dont le débit est arrivé TARD est reconnue par son identité sur la poche, à l'étape du crédit : `poche-deja-compensee`, jamais un second crédit)
        // une NOUVELLE tentative (même clé d'idempotence rejouée après un premier remboursement, I2) est un autre débit du même scan : sa claim porte l'id de sa 1re unité
        pendantes.sort((a, b) => String(a._id) < String(b._id) ? -1 : 1);
        if (pendantes[0].cleOrigine) cle = `rb|${scanId}|${pendantes[0]._id}`;
        // UN-CANDIDAT-2 : la REPRISE d'un remboursement déjà commencé (une claim `…|fait|…` existe pour ce scan : un partiel antérieur a rendu des unités et compté la panne) ne recompte JAMAIS le plafond —
        // sinon un partiel repris près du plafond devenait un « plafond-jour » définitif, après que le client avait été rendu en partie. Le plafond a été compté une fois, à la première tentative.
        // TOUR 1 : pour un scan à `cleOrigine`, la clé de la claim porte l'id de la 1re unité OUVERTE et change après un partiel (cette unité n'est plus ouverte) : la claim « fait » de CETTE tentative se retrouve
        // par les ids des débits du même groupe (même `cleOrigine`), jamais par le préfixe de la clé courante seule. Une claim d'un autre scan, d'un autre groupe ou sans « fait » ne dispense de rien.
        // TOUR 2 : et pour un scan à `cleOrigine` interrompu ENTRE deux unités (processus arrêté, claim `rb|scan|<id1>` portant une unité rendue, jamais renommée « fait »), la continuation s'insère sous une AUTRE clé
        // (`rb|scan|<id2>`) sans conflit : toute claim du groupe qui a RENDU une unité (delta ≠ 0, hors lignes `…#id`) dispense aussi du plafond — il a été compté à la première tentative.
        const idsGroupe = pendantes[0].cleOrigine ? debits.filter(d => d.cleOrigine === pendantes[0].cleOrigine).map(d => `rb|${scanId}|${d._id}`) : [];
        const dejaCommencee = m => typeof m.cleIdempotence === 'string' && !m.cleIdempotence.includes('#') && (idsGroupe.length
            ? idsGroupe.some(p => m.cleIdempotence === p ? m.delta !== 0 : m.cleIdempotence.startsWith(`${p}|fait|`))
            : m.cleIdempotence.startsWith(`rb|${scanId}|fait|`));
        // TOUR 3 : la claim se cherche par le SCAN (un ObjectId neuf par requête), pas par porteur — une installation liée à un compte entre deux unités a fait passer la claim au compte (`base(cible)`)
        if (!sansPlafond && (await col('mouvements').find({ type: 'remboursement', scanId }).toArray()).some(dejaCommencee)) sansPlafond = true;
        // M2 — une panne ne rembourse pas une question DÉJÀ répondue par un candidat : un résultat A été livré
        // `sans-prix` est du côté des QUESTIONS (comme avant le lot PLAFONDS) : il rembourse justement une carte tranchée par une réponse, dont le prix est illisible
        if (nature.livre && await col('questions_v2').findOne({ scanId, 'porteur.type': porteur.type, 'porteur.id': porteur.id, etat: 'repondue', lot: { $ne: true }, 'reponse.aucune': false }, { projection: { _id: 1 } }))
            return { rendu: false, raisonNonRembourse: 'deja-livre' };
    } catch (e) { console.error(`❌ [v2 rembourser] lecture des débits : ${codeErr(e)}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    let claimFiltre = { cleIdempotence: cle };                 // TOUR 2 : la claim se cible par son `_id` (lu à l'insertion), jamais par sa clé — une continuation concurrente peut avoir renommé l'ancienne et posé la sienne sous la même clé
    try { const ins = await col('mouvements').insertOne({ ...base(porteur), le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 0, poche: null, motif, scanId, etat: 'rembourse', cleIdempotence: cle, expireLe: expireMouvement(maintenant, cfg) }); if (ins && ins.insertedId) claimFiltre = { _id: ins.insertedId }; }
    catch (e) { if (e.code === 11000) return { rendu: false, raisonNonRembourse: 'deja-rembourse' }; console.error(`❌ [v2 rembourser] claim : ${codeErr(e)}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    let compteurPris = false;
    const liberer = async () => { await col('mouvements').deleteOne(claimFiltre); if (compteurPris) await col('plafonds').updateOne({ porteur: porteurCle, jour, type }, { $inc: { count: -pas } }); };
    const rendus = [];
    let premiereRaison = null;
    // P — remboursement PARTIEL : la ligne-claim est la trace de la 1re unité rendue ; on la renomme pour libérer `rb|…`, afin que les unités restituées « debite » restent remboursables.
    // Pas de double remboursement : chaque unité ne se rend que par sa prise atomique (etat ≠ rembourse), quel que soit le nombre de claims successifs.
    const libererClaim = () => col('mouvements').updateOne(claimFiltre, { $set: { cleIdempotence: `${cle}|fait|${rendus[0]}` } });
    try {
        // I1 — le remboursement rend CHAQUE unité débitée pour ce scan (un lot = 1 débit + des suppléments au même scanId), jugée sur les débits ENREGISTRÉS ;
        // une unité n'est rendue qu'une fois (le passage de son débit à « rembourse » est la prise atomique), et tout le scan compte pour UN seul remboursement au plafond.
        pendantes.sort((a, b) => String(a._id) < String(b._id) ? -1 : 1);
        if (!sansPlafond && classe !== 'infra') {
            // le plafond se lit AVANT le compteur : une lecture qui échoue n'a rien compté (l'erreur libère le claim, plus bas)
            const plafond = classe === 'declare' ? await plafondDesDeclarations(porteur, cfg, maintenant) : classe === 'constate' ? await plafondDesConstates(porteur, cfg, maintenant) : cfg.plafonds.lotTropGrand;
            const c = await incPlafond(porteurCle, jour, type, maintenant, pas); compteurPris = true;
            if (c.count > plafond) {
                await liberer();
                // les deux compteurs se journalisent à CHAQUE refus : ni message d'erreur ni identifiant de porteur (type seulement), le scan permet de remonter
                console.warn(`⚠️ [v2 plafond] ${type} : plafond du jour atteint (${plafond}) — remboursement refusé, porteur ${porteur.type}, scan ${scanId}, jour ${jour}`);
                return { rendu: false, raisonNonRembourse: 'plafond-jour', ...(classe === 'declare' ? { declaration: { rendue: false, raison: 'plafond-declarations', plafondJour: plafond } } : {}) };
            }
            if (classe === 'declare') declaration = { rendue: true, raison: null, plafondJour: plafond };
        }
        const avecDeclaration = r => (declaration ? { ...r, declaration } : r);
        for (const d of pendantes) {
            // MOYENS-B2a — L'ORDRE : la prise écrit « rendu-en-cours » (jamais « rembourse » avant que le crédit soit rendu ET tracé, comme `rembourserLigne`). Un arrêt n'importe où entre cette prise et le dernier état
            // laisse une ligne « rendu-en-cours » : LISTÉE aussitôt par la réconciliation (`lignesNonRendues`), ni reprise seule ni rendue deux fois (elle est dans ETATS_CLOS). Avant : « rembourse » d'abord, et un arrêt
            // avant le crédit laissait un débit lu comme « rendu » sans crédit, que rien ne listait avant 60 min. Une ligne « rendu-echoue » reprise retrouve son expiration au dernier état.
            const pris = await col('mouvements').findOneAndUpdate({ _id: d._id, etat: { $nin: ETATS_CLOS } }, { $set: { etat: 'rendu-en-cours', priseLe: maintenant }, $unset: { expireLe: '' } }, { returnDocument: 'before' });   // une ligne non résolue n'expire pas ; `priseLe` (tour 2, N-1) dit depuis quand la prise est tenue : la réparation attend
            if (!pris) continue;                                                  // un autre chemin vient de la rendre
            const restituer = () => col('mouvements').updateOne({ _id: d._id, etat: 'rendu-en-cours' }, { $set: { etat: pris.etat, ...(pris.expireLe ? { expireLe: pris.expireLe } : {}) }, $unset: { priseLe: '', ...(pris.expireLe ? {} : { expireLe: '' }) } });
            let r;
            try { r = await rendreUnite(porteur, d.credit, cfg, maintenant, d._id); } catch (e) { await restituer(); throw e; }
            if (!r.rendu) { await restituer(); premiereRaison = premiereRaison || r.raison; continue; }
            // le crédit EST rendu : plus aucune restitution d'état ni libération de la claim n'est permise pour cette unité (un `liberer` rendrait la claim libre alors que le client est crédité)
            rendus.push(d._id);
            // la trace : la ligne-claim `rb|scanId` devient celle de la 1re unité rendue, les suivantes ont la leur (`rb|scanId#k`) — somme(delta) reste égale au solde
            const cible = r.cible, ligne = { ...base(cible), poche: r.pocheRendue };
            let tracee = true;
            try {
                if (rendus.length === 1) {
                    const w = await col('mouvements').updateOne(claimFiltre, { $set: { delta: 1, debitId: d._id, ...ligne }, ...(cible.type === 'compte' ? { $unset: { installationId: '' } } : { $unset: { compteId: '' } }) });
                    if (w && w.modifiedCount === 0) { tracee = false; console.error(`🔴 [v2 rembourser] ${cleJournal(cle)} : le crédit est rendu mais la claim n'a pas reçu sa trace (delta 1) — ligne « rendu-en-cours », listée par la réconciliation`); }
                }
                else await col('mouvements').insertOne({ ...ligne, le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 1, motif, scanId, debitId: d._id, etat: 'rembourse', cleIdempotence: `${cle}#${d._id}`, expireLe: expireMouvement(maintenant, cfg) });
            } catch (e) { tracee = false; console.error(`🔴 [v2 rembourser] ${cleJournal(cle)} : le crédit est rendu mais sa trace n'est pas écrite (${codeErr(e)}) — ligne « rendu-en-cours », listée par la réconciliation`); }
            if (tracee) {   // dernier état : si ces deux essais échouent, la ligne reste « rendu-en-cours » (crédit rendu ET tracé), listée, jamais rendue deux fois
                let ecrit = false;
                for (let essai = 0; essai < 2 && !ecrit; essai++) { try { await col('mouvements').updateOne({ _id: d._id }, { $set: { etat: 'rembourse', expireLe: expireMouvement(maintenant, cfg) } }); ecrit = true; } catch (e) { if (essai) console.error(`🔴 [v2 rembourser] ${cleJournal(cle)} : état « rembourse » non écrit (${codeErr(e)}) — la ligne reste « rendu-en-cours » (réconciliation)`); } }
            }
        }
        if (!rendus.length) { await liberer(); return { rendu: false, raisonNonRembourse: premiereRaison || 'poche-introuvable' }; }
        if (rendus.length < pendantes.length) { await libererClaim(); return avecDeclaration({ rendu: true, raisonNonRembourse: null, unites: rendus.length, partiel: true, raisonPartielle: premiereRaison }); }
        return avecDeclaration({ rendu: true, raisonNonRembourse: null, unites: rendus.length });
    } catch (e) {
        console.error(`❌ [v2 rembourser] ${codeErr(e)}`);
        if (rendus.length) { try { await libererClaim(); } catch (_) { /* la réconciliation le dira */ } return { rendu: true, raisonNonRembourse: null, unites: rendus.length, partiel: true, raisonPartielle: 'erreur', ...(declaration ? { declaration } : {}) }; }   // des unités SONT rendues et tracées : on garde le compteur
        try { await liberer(); } catch (_) { /* la réconciliation (B3.6) le dira */ }
        return { rendu: false, raisonNonRembourse: 'erreur' };
    }
}
// M6 — le porteur effectif d'une unité : une installation LIÉE entre-temps n'a plus de poches propres, le crédit est rendu à celles du COMPTE (essai → accueil, plafonné ; acheté → acheté).
async function rendreUnite(porteur, credit, cfg, now, debitId = null) {
    let cible = porteur, c = credit;
    // `jour` : le compteur porte la clé du porteur au moment du débit (installation:X) ; une liaison survenue depuis ne le déplace pas — l'unité retourne là où elle a été prise
    if (porteur.type === 'installation' && credit.poche !== 'jour') {
        const i = await col('installations').findOne({ _id: porteur.id }, { projection: { compteId: 1 } });
        if (i && i.compteId) {
            cible = { type: 'compte', id: i.compteId };
            c = { poche: credit.poche === 'essai' ? 'accueil' : credit.poche };
            if (!['accueil', 'achete'].includes(c.poche)) return { rendu: false, raison: 'poche-introuvable', pocheRendue: c.poche, cible };
        }
    }
    const r = await rendrePoche(cible, c, cfg, now, debitId);
    return { rendu: r.rendu, raison: r.raison, pocheRendue: c.poche, cible };
}
// « rendu-en-cours » : un rendu commencé et non confirmé (processus tué, écriture d'état échouée) — ni ouverte ni close : jamais reprise seule (le crédit a pu être rendu), listée par la réconciliation.
const ETATS_RENDU_NON_CONFIRME = ['rendu-en-cours', 'rendu-echoue'];   // lignes de débit en attente de réconciliation : jamais rejouées, jamais expirées
const ETATS_CLOS = ['rembourse', 'rendu-en-cours'];
const ouvertes = d => d.credit && !ETATS_CLOS.includes(d.etat);
async function rembourser(porteur, credit, motif, o = {}, cfg) {
    if (!credit) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
    const r = await rendreLeScan(porteur, motif, o, cfg);
    return { rendu: r.rendu, raisonNonRembourse: r.raisonNonRembourse, ...(r.declaration ? { declaration: r.declaration } : {}) };   // `declaration` : présent SEULEMENT quand le plafond des déclarations a été consulté
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
    let d, pris;
    try {
        d = await col('mouvements').findOne({ ...base(porteur), type: 'debit', cleIdempotence: cle });
        if (!d || !d.credit) return { rendu: false, raisonNonRembourse: 'aucun-debit' };
        // La prise écrit « rendu-en-cours » (jamais « rembourse » avant que le crédit soit rendu) : si le processus ou une écriture ultérieure échoue, la ligne reste VISIBLE
        // (réconciliation) et ne peut être ni reprise seule ni rendue deux fois (ni rembourserLigne ni rendreLeScan ne prennent un « rendu-en-cours »). `priseLe` (tour 2, N-1) dit depuis quand elle est tenue.
        pris = await col('mouvements').findOneAndUpdate({ _id: d._id, etat: { $nin: ETATS_CLOS } }, { $set: { etat: 'rendu-en-cours', priseLe: maintenant }, $unset: { expireLe: '' } }, { returnDocument: 'before' });   // tour 4 (2) : une ligne non résolue n'expire pas
        if (!pris) { const cur = await col('mouvements').findOne({ _id: d._id }, { projection: { etat: 1 } }); return { rendu: false, raisonNonRembourse: cur && cur.etat === 'rendu-en-cours' ? 'remboursement-en-cours' : 'deja-rembourse' }; }   // I-1 : « rendu-en-cours » n'est pas « rendu »
    } catch (e) { console.error(`🔴 [v2 rembourser-ligne] ${cleJournal(cle)} : ${codeErr(e)}`); return { rendu: false, raisonNonRembourse: 'erreur' }; }
    const ecrireEtat = async (etat, plus = {}) => {                              // un second essai, puis l'échec est dit : la ligne garde alors « rendu-en-cours »
        for (let essai = 0; essai < 2; essai++) { try { await col('mouvements').updateOne({ _id: d._id }, etat === 'rembourse' ? { $set: { etat, ...plus, expireLe: expireMouvement(maintenant, cfg) } } : { $set: { etat, ...plus }, $unset: { expireLe: '' } }); return true; } catch (e) { if (essai) console.error(`🔴 [v2 rembourser-ligne] ${cleJournal(cle)} : état « ${etat} » non écrit (${codeErr(e)}) — la ligne reste « rendu-en-cours » (réconciliation)`); } }
        return false;
    };
    const echec = async raison => {
        console.error(`🔴 [v2 rembourser-ligne] ${cleJournal(cle)} : crédit NON rendu (${raison}) — ligne « rendu-echoue », à rendre à la main ou par la reprise`);
        await ecrireEtat('rendu-echoue', { raisonRendu: raison });
        return { rendu: false, raisonNonRembourse: raison };
    };
    let r;
    try { r = await rendreUnite(porteur, d.credit, cfg, maintenant, d._id); } catch (e) { return echec('erreur'); }
    if (!r.rendu && r.raison === 'poche-deja-compensee') {
        // le crédit de CE débit est déjà sur la poche (compensation de `debiter`, puis écriture tardive du débit) : rien n'est rendu, la ligne retrouve son état d'avant la prise
        // conditionnel : si un autre chemin (la réparation) a déjà fini la ligne, on n'écrase pas son état
        try { await col('mouvements').updateOne({ _id: d._id, etat: 'rendu-en-cours' }, { $set: { etat: pris.etat, ...(pris.expireLe ? { expireLe: pris.expireLe } : {}) }, $unset: { priseLe: '', ...(pris.expireLe ? {} : { expireLe: '' }) } }); } catch (e) { console.error(`🔴 [v2 rembourser-ligne] ${cleJournal(cle)} : état d'avant la prise non restitué (${codeErr(e)}) — ligne « rendu-en-cours », listée`); }
        return { rendu: false, raisonNonRembourse: 'poche-deja-compensee' };
    }
    if (!r.rendu) return echec(r.raison || 'poche-introuvable');
    // MOYENS-B2a tour 1 (I-3) : même règle que `rendreLeScan` — la ligne ne passe « rembourse » que si la trace est écrite ; sinon elle reste « rendu-en-cours » (listée, réparable par l'outil de l'opérateur)
    let tracee = true;
    try { await col('mouvements').insertOne({ ...base(r.cible), poche: r.pocheRendue, le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 1, motif, scanId: d.scanId, debitId: d._id, etat: 'rembourse', cleIdempotence: `rl|${cle}`, expireLe: expireMouvement(maintenant, cfg) }); }
    catch (e) { if (e.code !== 11000) { tracee = false; console.error(`🔴 [v2 rembourser-ligne] ${cleJournal(cle)} : crédit rendu mais trace non écrite (${codeErr(e)}) — la ligne reste « rendu-en-cours » (réconciliation)`); } }
    if (tracee) await ecrireEtat('rembourse');                                  // crédit rendu ET tracé : si cette écriture échoue, la ligne reste « rendu-en-cours » (listée), jamais rendue une 2e fois
    return { rendu: true, raisonNonRembourse: null };
}
// La réparation (geste d'opérateur) vit dans `reparation.js` : elle lit le crédit PAR SON DÉBIT (tour 2). Exportée ici pour que le grand livre reste le point d'entrée unique.
const reparerDebitRembourseSansMouvement = (...a) => require('./reparation').reparer(...a);
module.exports = { debiter, rendrePoche, essayerPoche, rembourser, rembourserLot, rembourserLigne, reparerDebitRembourseSansMouvement, ETATS_CLOS, ETATS_RENDU_NON_CONFIRME,
    // intérieur du grand livre, partagé avec `reparation.js` (une seule définition de ce qu'est un crédit et de sa trace)
    interne: { rendreUnite, creditPresent, proprietaireDe, CREDITS_MAX, expireMouvement, base, codeErr, cleJournal, col: nom => col(nom) } };
