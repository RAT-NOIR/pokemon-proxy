'use strict';
// BANC-12 — LE LIEN ENTRE UNE CONTRIBUTION ET UN COMPTE NE DURE PAS PLUS DE bancLienMois (12 mois), PUIS ANONYMISATION DÉFINITIVE (décision du testeur, 2026-10-11).
// L'IMAGE, elle, reste bancMois (24 mois, la politique §4) : c'est le LIEN qui se coupe, pas l'image.
//
// CE QUI RELIE UNE LIGNE DU BANC À UN PORTEUR (inventaire : le tableau du rapport lot-BANC12-report.md) :
//   · la ligne elle-même : `_id` = SHA-256(scanId, carte, sel) — avec le sel et le scanId (analyses, mouvements, questions, marques, journal hérité) on la retrouve —, `jetonEmpreinte`,
//     `le` (le jour) et `expireLe` (qui en dérive) ;
//   · l'objet R2 : sa date (à la seconde) coïncide avec `mouvements.le` / `analyses.creeLe` du porteur ;
//   · `mouvements.scanId` et, DANS LEUR CLÉ, `rb|<scanId>` (remboursements) ; `questions.scanId` ; `analyses` (_id = scanId, porteur) ; les marques `scans_en_cours` (_id = scanId, porteur).
// CE QUE LA PASSE FAIT, à bancLienMois :
//   1. la ligne CONFIRMÉE reçoit un identifiant ALÉATOIRE, perd `scanId` (jamais écrit), jeton, jour ; son expiration est ramenée au début de son mois ; son objet est RÉÉCRIT sous une clé neuve
//      (la date de l'objet devient celle de la passe) puis l'ancien est supprimé. Une ligne EN ATTENTE de cet âge (la purge à 24 h l'a ratée) est supprimée avec son objet : jamais anonymisée ;
//   2. les mouvements d'argent RESTENT (somme des deltas = solde) mais perdent leur `scanId`, et leur clé qui le contient devient `anon|<_id du mouvement>` (unique, sans scanId) ;
//   3. les questions terminées perdent leur document ; les analyses de cet âge sont supprimées (analysesMois = bancLienMois : la TTL le fait aussi, la passe est le filet et le rattrapage).
// CE QUI NE CHANGE PAS, ET POURQUOI C'EST SANS DANGER POUR LE LIEN : le lien contribution ↔ compte passe par la LIGNE ; elle n'a plus rien qui se recalcule. Les mouvements « rendu-echoue » /
// « rendu-en-cours » (argent non résolu, jamais expirés), les questions ouvertes et les marques non closes gardent leur scanId tant qu'ils ne sont pas résolus : ils ne désignent aucune ligne du banc.
// Sans course : une ligne est PRISE par une écriture conditionnelle (etat 'anonymisation', avec la clé et l'identifiant de sa copie, écrits UNE fois) ; la correction, conditionnée à l'état
// 'confirmee', n'y écrit plus ; une reprise (prise de plus de 10 min) réutilise la MÊME copie. Idempotente : une ligne anonymisée n'a plus de `le`, la passe ne la voit plus.
const crypto = require('crypto');
const { JOUR_MS, codeDe, limiteLien, supprimerObjetPuisLigne } = require('./commun');
const S = require('./stockage');
// Lu à l'appel (et non au chargement) : le ledger tire du code hérité qui crée ses propres index à l'import (les bancs créent les leurs AVANT) ; UNE définition des lignes d'argent non résolues.
const etatsRenduNonConfirme = () => require('../argent/ledger').ETATS_RENDU_NON_CONFIRME;

const REPRISE_MS = 10 * 60e3, PAR_PASSE_MAX = 2000;
const ETATS_QUESTION_TERMINES = Object.freeze(['repondue', 'remboursee', 'non-remboursee']);
const debutDuMois = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

function creerAnonymisation({ cfg, colFn, borner }) {
    const col = () => colFn('banc_lignes');
    // Le journal ne porte JAMAIS de contenu : le code de l'erreur, pas son message (il peut citer une clé ou une URL).
    const echec = (quoi, e) => console.error(`❌ [v2 banc-anonymisation] ${quoi} (${codeDe(e)})`);

    // Une ligne confirmée : prise, copie anonyme (objet puis ligne), suppression de l'ancienne. @returns 'ok' | 'changee' | 'echec' | 'objet-garde'
    async function anonymiserUne(s, l, maintenant) {      // `l` vient de la liste des lignes échues (le <= limite) : le jour d'une ligne ne change jamais, la prise ne le relit pas
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
            await borner(col().insertOne({ _id: c.anonId, verite: c.verite, source: c.source, etat: 'confirmee', versionModele: c.versionModele ?? null, versionTexte: c.versionTexte,
                cleR2: c.anonCle, expireLe: debutDuMois(c.expireLe), anonyme: true }));
        } catch (e) { if (!e || e.code !== 11000) { echec('copie anonyme non écrite', e); return 'echec'; } }     // 11000 : la copie d'une reprise existe déjà
        let r;
        try { r = await borner(col().deleteOne({ _id: c._id, etat: 'anonymisation' })); }
        catch (e) { echec('ancienne ligne non supprimée, reprise à la prochaine passe', e); return 'echec'; }
        if (r.deletedCount === 0) {
            // l'ancienne ligne a disparu entre la prise et ici (effacement par jeton) : la copie ne doit pas lui survivre
            try { await borner(col().deleteOne({ _id: c.anonId })); await borner(s.supprimer(c.anonCle)); } catch (e) { echec('copie d\'une ligne effacée non défaite', e); return 'echec'; }
            return 'changee';
        }
        try { await borner(s.supprimer(c.cleR2)); } catch (e) { echec('ancien objet non supprimé (le filet des orphelins le reprendra)', e); return 'objet-garde'; }
        return 'ok';
    }

    /** @param s le stockage prêt, ou null (R2 indisponible : les lignes restent, le reste est fait) */
    async function anonymiser(s, maintenant) {
        const now = new Date(maintenant), limite = limiteLien(cfg, now);
        const bilan = { lignes: 0, attente: 0, mouvements: 0, questions: 0, analyses: 0, echecs: 0, changees: 0 };

        // 1. les lignes du banc
        // (une prise fraîche est listée aussi : c'est la PRISE, écriture conditionnelle de anonymiserUne, qui décide — jamais cette liste)
        const filtre = { le: { $lte: limite } };
        try {
            if (!s) { const n = await borner(col().countDocuments(filtre)); bilan.echecs += n; if (n) console.error(`⚠️ [v2 banc-anonymisation] ${n} ligne(s) échue(s) non anonymisée(s) : stockage indisponible`); }
            else {
                const echues = await borner(col().find(filtre).limit(PAR_PASSE_MAX).toArray());
                for (const l of echues) {
                    if (l.etat === 'attente') {
                        const r = await supprimerObjetPuisLigne(s, l, col, borner, { etat: 'attente' });
                        if (r === 'supprimee') bilan.attente++; else if (r === 'echec') bilan.echecs++;
                        continue;
                    }
                    const r = await anonymiserUne(s, l, now);
                    if (r === 'ok') bilan.lignes++;
                    else if (r === 'objet-garde') { bilan.lignes++; bilan.echecs++; }
                    else if (r === 'changee') bilan.changees++;
                    else bilan.echecs++;
                }
            }
        } catch (e) { echec('lecture des lignes échues', e); bilan.echecs++; }

        // 2. les mouvements : le scanId part (champ ET clé), l'argent reste ; l'argent non résolu garde sa trace
        try {
            const r = await borner(colFn('mouvements').updateMany(
                { scanId: { $exists: true, $ne: null }, le: { $lte: limite }, etat: { $nin: etatsRenduNonConfirme() } },
                [{ $set: { cleIdempotence: { $cond: [{ $and: [{ $eq: [{ $type: '$cleIdempotence' }, 'string'] }, { $gt: [{ $indexOfCP: ['$cleIdempotence', { $toString: '$scanId' }] }, -1] }] },
                    { $concat: ['anon|', { $toString: '$_id' }] }, '$cleIdempotence'] } } }, { $unset: 'scanId' }]));
            bilan.mouvements = r.modifiedCount;
        } catch (e) { echec('mouvements', e); bilan.echecs++; }

        // 3. les questions terminées (les ouvertes ne sont jamais effacées ici) et les analyses
        try { bilan.questions = (await borner(colFn('questions').deleteMany({ poseeLe: { $lte: limite }, etat: { $in: ETATS_QUESTION_TERMINES } }))).deletedCount; }
        catch (e) { echec('questions', e); bilan.echecs++; }
        try { bilan.analyses = (await borner(colFn('analyses').deleteMany({ creeLe: { $lte: limite } }))).deletedCount; }
        catch (e) { echec('analyses', e); bilan.echecs++; }
        return bilan;
    }
    return { anonymiser, anonymiserUne };
}

module.exports = { creerAnonymisation, REPRISE_MS, PAR_PASSE_MAX, ETATS_QUESTION_TERMINES, JOUR_MS };
