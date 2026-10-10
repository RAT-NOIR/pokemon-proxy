'use strict';
// Emplacement du lot B1b. B1b.3 monte POST /api/identifier (contrat 2). B1b.5 monte /api/identifier/reponse, /api/retour-live, /api/solde et arme le balayage des
// questions. B1b.7 (règle G, registre annonce/visuels/taux, purge des annonces) complète ce fichier.
const mongoose = require('mongoose');
const { aiguilleur } = require('../heritage');
const registre = require('../registre');
const { repondreErreur } = require('../erreurs');
const { resoudrePorteur, exigerInstallation } = require('../porteur');
const L = require('../transport/limites');
const { idempotente } = require('../transport/idempotence');
const { validerEntree, traiterIdentifier, traiterReponse } = require('./routes');
const { traiterRetourLive } = require('./retour-live');

// Sans `Authorization: Bearer`, la requête sort du routeur v2 SANS qu'un octet soit lu ni écrit : la route héritée répond comme aujourd'hui.
const siBearer = aiguilleur(req => /^Bearer /.test(String((req.headers && req.headers.authorization) || '')));

// ── Le balayage des questions : toutes les minutes, les questions restées sans réponse 24 h sont réglées (crédit rendu). Rien sans Mongo prêt.
// Chaque question est PRISE par une écriture conditionnelle (argent/questions.js) : deux processus ne rendent jamais deux fois.
const INTERVALLE_BALAYAGE_MS = 60 * 1000;
let minuteur = null;
async function balayerQuestionsUneFois({ etatMongo = () => mongoose.connection.readyState, argent = () => registre.obtenir('argent') } = {}) {
    try {
        if (etatMongo() !== 1) return false;                         // pas de connexion : on n'ouvre rien, on ne fait rien
        await argent().balayerQuestions({ maintenant: new Date() });
        return true;
    } catch (e) { console.error(`❌ [v2 question-balayage] ${(e && (e.code || e.name)) || 'erreur'}`); return false; }   // une passe qui échoue ne tue ni le minuteur ni le processus
}
function arreterBalayage() { if (minuteur) { clearInterval(minuteur); minuteur = null; } }
function demarrerBalayage(intervalleMs = INTERVALLE_BALAYAGE_MS) {
    arreterBalayage();                                               // un seul minuteur par processus, même si le montage est refait
    minuteur = setInterval(() => { balayerQuestionsUneFois(); }, intervalleMs);
    minuteur.unref();                                                // il ne retient jamais le processus
    return minuteur;
}

// ── La purge des annonces (conservation 90 jours) : toutes les 24 h, rien sans Mongo prêt, UN minuteur par processus, unref.
// (annonce/conservation.js::demarrerPurge ne se garde pas sur la connexion et ne peut pas être arrêté : on arme ici la même passe, gardée.)
const INTERVALLE_PURGE_MS = 24 * 3600 * 1000;
let minuteurPurge = null;
async function purgerAnnoncesUneFois({ etatMongo = () => mongoose.connection.readyState, purge = () => require('../annonce/conservation').purgerAnnonces() } = {}) {
    try {
        if (etatMongo() !== 1) return false;
        await purge();
        return true;
    } catch (e) { console.error(`❌ [v2 annonce-purge] ${(e && (e.code || e.name)) || 'erreur'}`); return false; }
}
function arreterPurge() { if (minuteurPurge) { clearInterval(minuteurPurge); minuteurPurge = null; } }
function demarrerPurge(intervalleMs = INTERVALLE_PURGE_MS) {
    arreterPurge();
    purgerAnnoncesUneFois();                                         // une passe au démarrage (sans effet tant que Mongo n'est pas prêt)
    minuteurPurge = setInterval(() => { purgerAnnoncesUneFois(); }, intervalleMs);
    minuteurPurge.unref();
    return minuteurPurge;
}

// ── Le registre : annonce, visuels, taux (contrat de registre.js). Un fournisseur DÉJÀ posé (un banc, un autre lot) n'est jamais écrasé.
function fournirSiAbsent(nom, fabrique) { try { registre.obtenir(nom); } catch { registre.fournir(nom, fabrique()); } }

module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        fournirSiAbsent('annonce', () => { const A = require('../annonce/verifier'), C = require('../annonce/conservation'); return { preparerAnnonce: o => A.preparerAnnonce(o, cfg), conserverAnnonce: (scanId, a) => C.conserverAnnonce(scanId, a, cfg) }; });
        fournirSiAbsent('visuels', () => { const { resoudre } = require('./visuels').creerVisuels({ cfg }); return { resoudre }; });
        fournirSiAbsent('taux', () => ({ versEUR: devise => require('./taux').versEUR(devise) }));
        // La règle G est DEMANDÉE (V2_REGLE_G=1) mais sans fournisseur de voisins elle ne peut rien : la chaîne héritée décide. On le DIT, une fois, au montage.
        if (cfg.regleG === true && !(deps && typeof deps.voisins === 'function')) console.warn('⚠️ [v2] règle G demandée, aucun fournisseur de voisins (V2_REGLE_G=1) — la chaîne héritée décide');
        // Sans `contrat: 2` la requête sort du routeur v2 SANS qu'un octet soit lu ni écrit : la route héritée répond comme aujourd'hui.
        // L'aiguilleur EN TÊTE (registre d'A0), prédicat strictement booléen. Puis : porteur, installation exigée, limiteur par COMPTE/installation (120/h),
        // idempotence (clé obligatoire : le débit en exige une), entrée validée AVANT tout débit, traitement.
        const parPorteur = L.limiteur({ nom: 'identifier', max: cfg.limites.identifierParCompteHeure, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
        router.post('/api/identifier',
            aiguilleur(req => Boolean(req.body && typeof req.body === 'object' && req.body.contrat === 2)),
            resoudrePorteur(cfg), exigerInstallation, parPorteur, idempotente('identifier', {}, cfg), validerEntree(cfg), traiterIdentifier(cfg, deps));
        // La réponse à une question : route PROPRE à la v2 (aucune forme héritée). La clé d'idempotence est honorée quand elle est donnée, mais pas exigée : la
        // réponse ne débite rien par elle-même, et la machine à états de la question rend un rejeu sans clé identique (un seul débit).
        router.post('/api/identifier/reponse', resoudrePorteur(cfg), exigerInstallation, idempotente('reponse', { obligatoire: false }, cfg), traiterReponse(cfg, deps));
        // Le prix lu en direct : avec Bearer seulement. Même remarque sur la clé (la garde « un second retour est refusé » est déjà un rejeu sûr).
        router.post('/api/retour-live', siBearer, resoudrePorteur(cfg), exigerInstallation, idempotente('retour-live', { obligatoire: false }, cfg), traiterRetourLive(cfg, deps));
        // Le solde : avec Bearer seulement (lecture pure, aucun débit).
        router.post('/api/solde', siBearer, resoudrePorteur(cfg), exigerInstallation, async (req, res) => {
            let solde;
            try { solde = await registre.obtenir('argent').solde(req.v2.porteur); }
            catch (e) { console.error(`❌ [v2 solde] ${(e && (e.code || e.name)) || 'erreur'}`); return repondreErreur(res, 'INDISPONIBLE'); }
            return res.status(200).json({ success: true, solde });
        });
        demarrerBalayage();
        demarrerPurge();
    },
    balayerQuestionsUneFois, demarrerBalayage, arreterBalayage, purgerAnnoncesUneFois, demarrerPurge, arreterPurge
};
