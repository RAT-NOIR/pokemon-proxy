// ============================================================
// JOURNAL DES SCANS — une ligne par identification, en base
// ============================================================
// POURQUOI. Depuis le début de ce chantier, trois décisions ont buté sur la même
// phrase : « je n'ai aucune donnée ».
//   - fiabilité du setCode lu par l'IA : aucune collection ne garde ses réponses
//   - seuil du garde-fou de ratio : quatre cas connus (x150, x150, x750, x2750),
//     c'est-à-dire un échantillon de quatre
//   - fréquence du rang 3 (numéro connu ET contradictoire) : jamais observée en vrai
// Les logs console ne peuvent pas y répondre : sur Render ils sont ÉPHÉMÈRES, ils
// auront disparu quand on voudra les analyser. D'où cette collection : elle survit au
// redéploiement, elle se requête, et elle répondra aussi aux questions qu'on ne s'est
// pas encore posées. C'est le contraire d'un seuil choisi à la main.
//
// CE QUE CE MODULE NE FAIT PAS :
//   - il n'est JAMAIS sur le chemin critique. Un échec d'écriture ne remonte pas :
//     un scan qui a livré un prix ne doit pas échouer parce qu'une statistique n'a
//     pas pu s'écrire. Appel sans await, erreurs avalées et tracées.
//   - il ne stocke aucune image, aucun titre d'annonce, aucune URL Vinted. Le userId
//     suffit à corréler ; le reste serait de la donnée personnelle sans usage.
//   - il n'appelle jamais Cardmarket ni TCGdex.
//
// PURGE. Index TTL de 90 jours (voir RETENTION_JOURS). Trois mois couvrent un
// trimestre complet — assez pour mesurer une dérive saisonnière et pour accumuler
// quelques milliers de scans — et bornent la croissance sans surveillance.

const mongoose = require('mongoose');
const { rangDuNumero } = require('./scoring');

// 90 jours. Mongo purge par un balayage qui tourne toutes les 60 s : la suppression
// n'est pas instantanée à la seconde près, ce qui est sans importance ici.
const RETENTION_JOURS = 90;

// Modèles guardés : ce module est requis par index.js, qui déclare déjà ses propres
// modèles sur les mêmes collections. Sans le garde, un second require lèverait
// OverwriteModelError.
const journalScanSchema = new mongoose.Schema({
    // `expires` pose l'index TTL. C'est le SEUL index de la collection, volontairement :
    // les requêtes d'analyse sont ponctuelles et portent sur quelques dizaines de
    // milliers de documents — un collscan y coûte moins cher que des index à maintenir
    // à chaque insertion, sur une collection qui n'est écrite que pour être lue à la main.
    le: { type: Date, default: Date.now, expires: `${RETENTION_JOURS}d` },

    route: String,        // 'identifier' (flux réel, extension) | 'analyser' (flux serveur)
    userId: String,

    // --- CE QUE L'IA A LU (l'entrée du problème) ---
    nom: String,
    numero: String,
    total: String,
    setCode: String,      // le code/stamp lu sur la carte — c'est SA fiabilité qu'on mesure
    langue: String,
    rarete: String,

    // --- CE QUI A ÉTÉ RETENU (la sortie) ---
    idProduct: Number,
    codeSetGagnant: String,   // code de set réel du produit retenu
    numeroGagnant: String,    // son numéro en base
    score: Number,
    nbCandidats: Number,
    confiance: String,        // 'haute' | 'basse'
    carteIncertaine: Boolean,
    sourceIdentification: String, // 'nom' | 'total+numero'
    voieCatalogue: String,        // 'nom' | 'numero'
    motifEtat: String,            // 'resolu' | 'aucun-motif' | 'non-resolu'

    // --- RANG DU GAGNANT ---
    // 1 = son numéro correspond à celui lu ; 2 = son numéro est inconnu ; 3 = son
    // numéro est connu et CONTREDIT celui lu. Calculé ici par la même fonction pure
    // que celle qui pilotera le classement (scoring.rangDuNumero), pour que la mesure
    // porte exactement sur ce qui sera mis en production ensuite.
    rang: Number,

    // --- LES DEUX SIGNAUX DE RANG, en sorties de première classe ---
    // aucunCandidatAuNumero : AUCUN candidat du vivier ne portait le numéro lu, par
    //   aucune voie. Le prix a été livré, mais il ne peut pas être celui de la carte
    //   scannée. C'est le cas Kahili, et le seul que le score seul ne voit pas.
    // rangGagnant : 3 = le catalogue contredit le numéro lu pour le produit retenu.
    // Ces deux champs existent pour être COMPTÉS : c'est leur fréquence réelle qui dira
    // si les garde-fous servent, et sur quels sets ils se déclenchent.
    aucunCandidatAuNumero: Boolean,
    rangGagnant: Number,

    // Écart de score entre le 1er et le 2e du classement. « Un écart de 5 points contre
    // 20 se renverse au premier bruit » : ce champ rend la liste des identifications
    // fragiles interrogeable, au lieu d'attendre qu'un testeur en remonte une.
    // null quand il n'y a qu'un candidat — il n'y a alors rien à départager.
    ecartScore: Number,

    // --- PLAUSIBILITÉ DU PRIX ---
    // ratio = prix demandé sur Vinted / prix de référence. Un ratio énorme du côté
    // « trop cher » trahit presque toujours une identification ratée, pas un vendeur
    // délirant. Les deux prix sont conservés en plus du ratio : sans eux, impossible
    // de distinguer un x1000 sur une carte à 0,02 € d'un x1000 sur une carte à 20 €.
    prixVinted: Number,
    prixReference: Number,
    ratio: Number,
    // D'OÙ vient le prix de référence : 'guide-local' | 'tcgdex' | 'cache'. Sans lui,
    // un ratio aberrant serait indiscernable d'un simple repli sur une source moins
    // précise, et on tirerait un seuil d'une comparaison qui n'en est pas une.
    sourcePrix: String,

    // --- DÉSACCORD DE CODE SET ---
    // true  : l'IA a lu un code et il correspond à celui du gagnant
    // false : elle en a lu un et il ne correspond pas
    // null  : elle n'a rien lu, ou le code du gagnant est inconnu -> hors mesure
    setCodeAccord: Boolean
}, { versionKey: false });

const JournalScan = mongoose.models.JournalScan
    || mongoose.model('JournalScan', journalScanSchema, 'journal_scans');

// Lectures d'appoint pour compléter la ligne : le numéro et le code de set du gagnant.
// Elles sont faites ICI plutôt que dans les routes pour que l'appelant n'ait qu'un
// objet plat à fournir — moins de points de rupture dans le chemin critique. Coût :
// au plus deux lectures indexées, hors chemin critique, à comparer aux ~4 s d'appel IA
// que tout scan paie de toute façon.
const NumeroCarteJ = mongoose.models.NumeroCarte
    || mongoose.model('NumeroCarteJ', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
const CodeSetJ = mongoose.models.CodeSet
    || mongoose.model('CodeSetJ', new mongoose.Schema({}, { strict: false }), 'codes_set');

// Compare deux codes de set comme le fait le scoring : majuscules, sans séparateurs.
// Volontairement STRICT (égalité seule) : la parenté partielle est une tolérance du
// scoring, pas une vérité — et c'est justement la fiabilité brute du setCode qu'on veut
// mesurer, pas celle du mécanisme d'appariement.
function memeCode(a, b) {
    const n = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const x = n(a), y = n(b);
    return (x && y) ? x === y : null;
}

/**
 * Écrit une ligne de journal. FIRE-AND-FORGET : à appeler SANS await.
 *
 * @param {object} d  tout est optionnel ; les champs absents restent absents
 * @returns {void}    ne renvoie rien exprès, pour qu'aucun appelant ne soit tenté d'attendre
 */
function enregistrerScan(d = {}) {
    // Pas de connexion : on sort en silence. Le scan, lui, a pu aboutir (guide en
    // cache, repli TCGdex) — ce n'est pas à la statistique de le faire échouer.
    if (mongoose.connection.readyState !== 1) return;

    (async () => {
        let numeroGagnant = d.numeroGagnant ?? null;
        let codeSetGagnant = d.codeSetGagnant ?? null;

        if (d.idProduct != null && (numeroGagnant == null || codeSetGagnant == null)) {
            const doc = await NumeroCarteJ.findOne(
                { idProduct: Number(d.idProduct) },
                { numero: 1, numeroUrl: 1, codeSet: 1, idExpansion: 1 }
            ).lean();
            if (doc) {
                if (numeroGagnant == null) numeroGagnant = doc.numero || doc.numeroUrl || null;
                if (codeSetGagnant == null) codeSetGagnant = doc.codeSet || null;
                if (codeSetGagnant == null && doc.idExpansion != null) {
                    const cs = await CodeSetJ.findOne({ idExpansion: doc.idExpansion }, { codeSet: 1 }).lean();
                    codeSetGagnant = cs?.codeSet || null;
                }
            }
        }

        const prixVinted = Number.isFinite(d.prixVinted) ? d.prixVinted : null;
        const prixReference = Number.isFinite(d.prixReference) ? d.prixReference : null;
        // Ratio calculé seulement s'il a un sens : une référence à 0 en donnerait
        // l'infini, ce qui polluerait toute moyenne ultérieure.
        const ratio = (prixVinted != null && prixReference != null && prixReference > 0)
            ? prixVinted / prixReference
            : null;

        await JournalScan.create({
            le: new Date(),
            route: d.route || null,
            userId: d.userId || null,
            nom: d.nom || null,
            numero: d.numero != null ? String(d.numero) : null,
            total: d.total != null ? String(d.total) : null,
            setCode: d.setCode || null,
            langue: d.langue || null,
            rarete: d.rarete || null,
            idProduct: d.idProduct != null ? Number(d.idProduct) : null,
            codeSetGagnant,
            numeroGagnant: numeroGagnant != null ? String(numeroGagnant) : null,
            score: Number.isFinite(d.score) ? d.score : null,
            nbCandidats: Number.isFinite(d.nbCandidats) ? d.nbCandidats : null,
            confiance: d.confiance || null,
            carteIncertaine: d.carteIncertaine != null ? Boolean(d.carteIncertaine) : null,
            sourceIdentification: d.sourceIdentification || null,
            voieCatalogue: d.voieCatalogue || null,
            motifEtat: d.motifEtat || null,
            rang: rangDuNumero(d.numero, numeroGagnant),
            aucunCandidatAuNumero: d.aucunCandidatAuNumero != null ? Boolean(d.aucunCandidatAuNumero) : null,
            rangGagnant: Number.isFinite(d.rangGagnant) ? d.rangGagnant : null,
            ecartScore: Number.isFinite(d.ecartScore) ? d.ecartScore : null,
            prixVinted, prixReference, ratio,
            sourcePrix: d.sourcePrix || null,
            setCodeAccord: memeCode(d.setCode, codeSetGagnant)
        });
    })().catch(e => {
        // Trace, jamais de propagation. Un journal muet vaut mieux qu'un scan cassé.
        console.warn(`⚠️ [journal-scans] écriture impossible : ${e.message}`);
    });
}

module.exports = { enregistrerScan, JournalScan, RETENTION_JOURS };
