'use strict';
// BANC-12 — LE LIEN ENTRE UNE CONTRIBUTION ET UN COMPTE NE DURE PAS PLUS DE bancLienMois (12 mois), PUIS ANONYMISATION DÉFINITIVE (décision du testeur, 2026-10-11).
// L'IMAGE, elle, reste bancMois (24 mois, la politique §4) : c'est le LIEN qui se coupe, pas l'image.
//
// CE QUI RELIE UNE LIGNE DU BANC À UN PORTEUR (inventaire : le tableau du rapport lot-BANC12-report.md) :
//   · la ligne elle-même : `_id` = SHA-256(scanId, carte, sel) — avec le sel et le scanId (analyses, mouvements, questions, marques, journal hérité) on la retrouve —, `jetonEmpreinte`,
//     `le` (le jour) et `expireLe` (qui en dérive) ;
//   · l'objet R2 : sa date de dernière modification coïncide avec `mouvements.le` / `analyses.creeLe` du porteur ;
//   · `mouvements.scanId` et, DANS LEUR CLÉ, `rb|<scanId>` (remboursements) ; `questions.scanId` ; `analyses` (_id = scanId, porteur) ; les marques `scans_en_cours` (_id = scanId, porteur).
// CE QUE LA PASSE FAIT — DES COHORTES MENSUELLES (tour 1, I-3), DÉCALÉES D'UN MOIS (tour 2) : le jour D, toute ligne dont le jour est antérieur au premier jour du mois de D moins (lien − 2) mois
// (commun.limiteLien) — une contribution est anonymisée entre (lien − 2) et (lien − 1) mois d'âge, donc, même avec la passe quotidienne, la grâce et un étalement, STRICTEMENT sous lien mois :
//   1. la ligne CONFIRMÉE reçoit un identifiant ALÉATOIRE, perd `scanId` (jamais écrit), jeton, jour ; son expiration est le PREMIER JOUR du mois de la contribution + bancMois mois civils (tour 2, I-5 :
//      jamais dérivée du jour, toute une cohorte expire le même jour) ; son objet est RÉÉCRIT sous une clé neuve
//      (la date de l'objet devient celle de la passe : tout un mois bascule ensemble, elle ne dit que le MOIS de la cohorte) puis l'ancien est supprimé. Une ligne EN ATTENTE de cet âge (la purge
//      à 24 h l'a ratée) est supprimée avec son objet : jamais anonymisée. Les lignes sont traitées dans l'ordre de leur `_id` (une empreinte), jamais dans l'ordre de `le` ;
//   2. les mouvements d'argent RESTENT (somme des deltas = solde) mais perdent leur `scanId`, et leur clé qui le contient devient `anon|<_id du mouvement>` (unique, sans scanId) — SAUF un débit encore
//      utile (tour 1, I-2) : sous une marque de livraison non close (en-suspens, en-reprise, echec), sous une question ouverte, ou « rendu-echoue » / « rendu-en-cours » : il garde son scanId. Ce lien-là
//      garde un débit à son SCAN, pas une contribution : la ligne du banc et son objet sont réidentifiés au hasard indépendamment ; la réconciliation liste ces débits gardés avec leur âge ;
//   3. les questions terminées perdent leur document ; les analyses de cet âge sont supprimées (analysesMois = bancLienMois : la TTL le fait aussi, la passe est le filet et le rattrapage).
// CE QUI N'ÉCHOUE JAMAIS VERS LE LIEN (tour 1, I-1) : une ligne que la passe ne peut pas réécrire (objet absent, stockage en panne ou absent) reste dans le DÉLAI DE GRÂCE (bancGraceJours) avec une
// alerte écrite en base (`banc_alertes`, lue par la réconciliation) ; au-delà de la bascule + la grâce, elle est SUPPRIMÉE par la base seule, son objet est supprimé si le stockage répond, sinon sa clé
// SEULE (sans jeton, jour, scanId ni compte) va dans `banc_objets_a_supprimer`, rejouée par chaque passe. On préfère perdre une image que garder un lien.
// Sans course : une ligne est PRISE par une écriture conditionnelle (etat 'anonymisation', avec la clé et l'identifiant de sa copie, écrits UNE fois) ; la correction, conditionnée à l'état
// 'confirmee', n'y écrit plus ; une reprise (prise de plus de 10 min) réutilise la MÊME copie. Idempotente : une ligne anonymisée n'a plus de `le`, la passe ne la voit plus.
const crypto = require('crypto');
const { JOUR_MS, codeDe, debutMois, limiteLien, supprimerObjetPuisLigne, autresLignesPortent } = require('./commun');
const S = require('./stockage');
// Lu à l'appel (et non au chargement) : le ledger tire du code hérité qui crée ses propres index à l'import (les bancs créent les leurs AVANT) ; UNE définition des lignes d'argent non résolues.
const etatsRenduNonConfirme = () => require('../argent/ledger').ETATS_RENDU_NON_CONFIRME;

const REPRISE_MS = 10 * 60e3, PAR_PASSE_MAX = 2000, OBJETS_PAR_PASSE_MAX = 500;
const ETATS_QUESTION_TERMINES = Object.freeze(['repondue', 'remboursee', 'non-remboursee']);
const ETATS_QUESTION_OUVERTS = Object.freeze(['en-attente', 'en-reglement']);
const ETATS_MARQUE_NON_CLOSE = Object.freeze(['en-suspens', 'en-reprise', 'echec']);
const ID_ALERTE = 'anonymisation';

/** L'état écrit par la dernière passe, pour la réconciliation : { lignesEnEchec, ageMaxJours, objetsEnAttente, objetsRefuses, majLe } (des NOMBRES et la date de la passe) ou null si aucune passe n'a tourné. */
async function lireEtat(colFn) { return colFn('banc_alertes').findOne({ _id: ID_ALERTE }); }

function creerAnonymisation({ cfg, colFn, borner, parPasseMax = PAR_PASSE_MAX }) {
    const col = () => colFn('banc_lignes');
    // Le journal ne porte JAMAIS de contenu : le code de l'erreur, pas son message (il peut citer une clé ou une URL).
    const echec = (quoi, e) => console.error(`❌ [v2 banc-anonymisation] ${quoi} (${codeDe(e)})`);
    const graceMs = cfg.retention.bancGraceJours * JOUR_MS;
    // la liste des objets à supprimer : des CLÉS SEULES (`_id`), rien d'autre
    const mettreEnAttente = cle => borner(colFn('banc_objets_a_supprimer').replaceOne({ _id: cle }, { _id: cle }, { upsert: true }));

    // Une ligne confirmée : prise, copie anonyme (objet puis ligne), suppression de l'ancienne. @returns 'ok' | 'changee' | 'echec' | 'objet-garde'
    async function anonymiserUne(s, l, maintenant) {      // `l` vient de la liste des lignes échues : le jour d'une ligne ne change jamais, la prise ne le relit pas
        const reprise = new Date(maintenant.getTime() - REPRISE_MS);
        let c;
        try {
            c = await borner(col().findOneAndUpdate(
                { _id: l._id, $or: [{ etat: 'confirmee' }, { etat: 'anonymisation', priseLe: { $lte: reprise } }] },
                [{ $set: { etat: 'anonymisation', priseLe: maintenant, anonCle: { $ifNull: ['$anonCle', S.nouvelleCle(false)] }, anonId: { $ifNull: ['$anonId', crypto.randomBytes(16).toString('hex')] } } }],
                { returnDocument: 'after' }));
        } catch (e) { echec('prise de la ligne', e); return 'echec'; }
        if (!c) return 'changee';                                                     // corrigée, effacée ou déjà prise entre-temps
        let image;
        try { image = await borner(s.lire(c.cleR2)); await borner(s.ecrire(c.anonCle, image)); }
        catch (e) { echec('objet non réécrit, ligne gardée pour la prochaine passe', e); return 'echec'; }
        try {
            await borner(col().insertOne({ _id: c.anonId, verite: c.verite, source: c.source, etat: 'confirmee', versionModele: c.versionModele ?? null, ...(c.versionTexte !== undefined ? { versionTexte: c.versionTexte } : {}),
                // ETIQUETAGE-B : une ligne d'étiquette garde, sans lien, de quoi MESURER — la réponse d'origine de la chaîne, la version de la chaîne, la révision, « aucune » (jamais un jour, un jeton, un scanId)
                ...(c.source === 'etiquette-admin' ? { ...(c.reponse !== undefined ? { reponse: c.reponse } : {}), ...(c.versionChaine !== undefined ? { versionChaine: c.versionChaine } : {}), ...(c.rev !== undefined ? { rev: c.rev } : {}), ...(c.aucune !== undefined ? { aucune: c.aucune } : {}) } : {}),
                cleR2: c.anonCle, expireLe: debutMois(c.le, cfg.retention.bancMois), anonyme: true }));
        } catch (e) { if (!e || e.code !== 11000) { echec('copie anonyme non écrite', e); return 'echec'; } }     // 11000 : la copie d'une reprise existe déjà
        let r;
        try { r = await borner(col().deleteOne({ _id: c._id, etat: 'anonymisation' })); }
        catch (e) { echec('ancienne ligne non supprimée, reprise à la prochaine passe', e); return 'echec'; }
        if (r.deletedCount === 0) {
            // l'ancienne ligne a disparu entre la prise et ici (effacement par jeton) : la copie ne doit pas lui survivre
            try { await borner(col().deleteOne({ _id: c.anonId })); await borner(s.supprimer(c.anonCle)); } catch (e) { echec('copie d\'une ligne effacée non défaite', e); return 'echec'; }
            return 'changee';
        }
        try {
            // ETIQUETAGE-B : l'ancien objet est PARTAGÉ par les autres cartes du scan tant qu'une ligne le porte (leur propre passe le supprimera, la dernière) ; lecture en échec : gardé (le filet le reprendra)
            let partage = true;
            try { partage = await autresLignesPortent(col, c.cleR2, undefined, borner); } catch (e0) { echec('partage de l\'ancien objet non lisible, objet gardé', e0); }
            if (!partage) await borner(s.supprimer(c.cleR2));
        } catch (e) {
            echec('ancien objet non supprimé, mis en attente de suppression', e);
            try { await mettreEnAttente(c.cleR2); } catch (e2) { echec('ancien objet non mis en attente (le filet des orphelins le reprendra)', e2); }
            return 'objet-garde';
        }
        return 'ok';
    }

    // I-1 : la ligne est SUPPRIMÉE par la base seule (la copie anonyme éventuelle aussi), PUIS ses objets : supprimés si le stockage répond, sinon leurs clés seules attendent.
    async function forcer(s, l) {
        let cur;
        try {
            cur = (await borner(col().findOne({ _id: l._id }))) || l;
            if (cur.anonId) await borner(col().deleteOne({ _id: cur.anonId, anonyme: true }));
            await borner(col().deleteOne({ _id: l._id }));
        } catch (e) { echec('ligne non supprimée au-delà de la grâce', e); return false; }
        for (const cle of [cur.cleR2, cur.anonCle].filter(Boolean)) {
            if (cle === cur.cleR2) { try { if (await autresLignesPortent(col, cle, undefined, borner)) continue; } catch { continue; } }   // ETIQUETAGE-B : un objet encore porté par une autre ligne reste
            let fait = false;
            if (s) { try { await borner(s.supprimer(cle)); fait = true; } catch (e) { echec('objet non supprimé, clé mise en attente', e); } }
            if (!fait) { try { await mettreEnAttente(cle); } catch (e) { echec('clé non mise en attente', e); } }
        }
        return true;
    }

    async function rejouerObjets(s) {
        try {
            for (const o of await borner(colFn('banc_objets_a_supprimer').find({ refuse: { $ne: true } }).limit(OBJETS_PAR_PASSE_MAX).toArray())) {
                try { await borner(s.supprimer(o._id)); await borner(colFn('banc_objets_a_supprimer').deleteOne({ _id: o._id })); }       // l'entrée n'est retirée qu'une fois l'objet supprimé
                catch (e) {
                    echec('objet en attente toujours non supprimé', e);
                    // (tour 2, M-2) une clé que le stockage refuse POUR TOUJOURS (forme) ne se rejoue pas en boucle : marquée « refusée », comptée à part dans l'alerte
                    if (e && e.code === 'cle-refusee') { try { await borner(colFn('banc_objets_a_supprimer').updateOne({ _id: o._id }, { $set: { refuse: true } })); } catch (e2) { echec('clé refusée non marquée', e2); } }
                }
            }
        } catch (e) { echec('liste des objets à supprimer', e); }
    }

    /** @param s le stockage prêt, ou null (R2 indisponible : les lignes restent dans la grâce, puis sont supprimées par la base seule ; le reste est fait) */
    async function anonymiser(s, maintenant) {
        const now = new Date(maintenant), limite = limiteLien(cfg, now), limiteForce = limiteLien(cfg, new Date(now.getTime() - graceMs));
        const bilan = { lignes: 0, attente: 0, mouvements: 0, questions: 0, analyses: 0, echecs: 0, changees: 0, forcees: 0 };

        if (s) await rejouerObjets(s);

        // 1. les lignes du banc, dans l'ordre de leur _id (une empreinte : aucun lien avec la date)
        const filtre = { le: { $lt: limite } };
        try {
            const echues = await borner(col().find(filtre).sort({ _id: 1 }).limit(parPasseMax).toArray());
            for (const l of echues) {
                const horsGrace = l.le < limiteForce;
                let r;
                if (!s) r = 'echec';
                else if (l.etat === 'attente') {
                    const x = await supprimerObjetPuisLigne(s, l, col, borner, { etat: 'attente' });
                    if (x === 'supprimee') { bilan.attente++; continue; }
                    if (x !== 'echec') continue;
                    r = 'echec';
                } else r = await anonymiserUne(s, l, now);
                if (r === 'ok') bilan.lignes++;
                else if (r === 'objet-garde') { bilan.lignes++; bilan.echecs++; }
                else if (r === 'changee') bilan.changees++;
                else if (horsGrace) { if (await forcer(s, l)) bilan.forcees++; else bilan.echecs++; }
                else bilan.echecs++;
            }
        } catch (e) { echec('lecture des lignes échues', e); bilan.echecs++; }

        // 2. les mouvements : le scanId part (champ ET clé), l'argent reste ; un débit encore utile (marque non close, question ouverte, rendu non confirmé) garde sa trace.
        // Si l'on ne sait pas lire ce qui est encore utile, on ne retire RIEN (une garde qui ne peut pas conclure bloque).
        try {
            const gardes = [];
            for (const m of await borner(colFn('scans_en_cours').find({ etat: { $in: ETATS_MARQUE_NON_CLOSE } }, { projection: { _id: 1 } }).toArray())) gardes.push(m._id);
            for (const q of await borner(colFn('questions_v2').find({ etat: { $in: ETATS_QUESTION_OUVERTS } }, { projection: { scanId: 1 } }).toArray())) if (q.scanId) gardes.push(q.scanId);
            const r = await borner(colFn('mouvements').updateMany(
                { scanId: { $exists: true, $ne: null, $nin: gardes }, le: { $lt: limite }, etat: { $nin: etatsRenduNonConfirme() } },
                [{ $set: { cleIdempotence: { $cond: [{ $and: [{ $eq: [{ $type: '$cleIdempotence' }, 'string'] }, { $gt: [{ $indexOfCP: ['$cleIdempotence', { $toString: '$scanId' }] }, -1] }] },
                    { $concat: ['anon|', { $toString: '$_id' }] }, '$cleIdempotence'] } } }, { $unset: 'scanId' }]));
            bilan.mouvements = r.modifiedCount;
        } catch (e) { echec('mouvements', e); bilan.echecs++; }

        // 3. les questions terminées (les ouvertes ne sont jamais effacées ici) et les analyses
        try { bilan.questions = (await borner(colFn('questions_v2').deleteMany({ poseeLe: { $lt: limite }, etat: { $in: ETATS_QUESTION_TERMINES } }))).deletedCount; }
        catch (e) { echec('questions_v2', e); bilan.echecs++; }
        try { bilan.analyses = (await borner(colFn('analyses').deleteMany({ creeLe: { $lt: limite } }))).deletedCount; }
        catch (e) { echec('analyses', e); bilan.echecs++; }

        // 4. LA TRACE (I-1) : ce qui reste échu après la passe, son âge (depuis la bascule) et les objets en attente — des nombres seuls, écrits à chaque passe (une alerte qui retombe à 0 se voit aussi)
        try {
            const restantes = await borner(col().countDocuments(filtre));
            let ageMaxJours = 0;
            if (restantes) {
                const [plus] = await borner(col().find(filtre).sort({ le: 1 }).limit(1).toArray());
                if (plus) ageMaxJours = Math.max(0, Math.floor((now.getTime() - debutMois(plus.le, cfg.retention.bancLienMois - 1).getTime()) / JOUR_MS));
            }
            const objetsEnAttente = await borner(colFn('banc_objets_a_supprimer').countDocuments({ refuse: { $ne: true } }));
            const objetsRefuses = await borner(colFn('banc_objets_a_supprimer').countDocuments({ refuse: true }));        // M-2 : comptés à part, ils ne tiennent pas l'alerte des lignes
            await borner(colFn('banc_alertes').replaceOne({ _id: ID_ALERTE }, { _id: ID_ALERTE, lignesEnEchec: restantes, ageMaxJours, objetsEnAttente, objetsRefuses, majLe: now }, { upsert: true }));
            if (restantes || objetsEnAttente || objetsRefuses) console.error(`🔴 [v2 banc-anonymisation] ${restantes} ligne(s) échue(s) non traitée(s) (âge max ${ageMaxJours} j depuis la bascule), ${objetsEnAttente} objet(s) en attente de suppression, ${objetsRefuses} objet(s) refusé(s) par le stockage`);
        } catch (e) { echec('alerte non écrite', e); bilan.echecs++; }
        return bilan;
    }
    return { anonymiser, anonymiserUne };
}

module.exports = { creerAnonymisation, lireEtat, REPRISE_MS, PAR_PASSE_MAX, ETATS_QUESTION_TERMINES, JOUR_MS };
