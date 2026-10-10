'use strict';
// B9.2 — le scanner du site : POST /api/scanner/analyses (multipart) et POST /api/scanner/analyses/:id/reponse, sur la SESSION du compte.
// UNE SEULE RÈGLE (§21 bis) : le scanner ne réécrit ni le débit, ni la facturation, ni les questions, ni le filet de remboursement — il lit l'image, la transforme
// en data-URL, et passe la main à `traiterIdentifier` / `traiterReponse` (v2/identifier/routes.js, inchangé). Ce fichier ne décide que ce qui est PROPRE au site :
//   · l'identité (cookie de session, Origin exacte + X-Rat-Market ; jamais de jeton d'installation ni d'essai sans compte) ;
//   · l'ORDRE : session, origine, limite par compte, porte de concurrence, lecture et validation du corps, PUIS le débit — un corps refusé ne coûte rien ;
//   · la porte de concurrence : au plus PORTE_MAX corps (12 Mo) en mémoire à la fois pour le PROCESSUS, tenus jusqu'à la fin de la requête ;
//   · le remboursement `sans-prix` d'une carte identifiée dont le guide n'a pas de prix (CONTRAT-2 §6, « à confirmer par l'éditeur »).
// L'image n'est ni stockée ni journalisée : elle ne vit que dans la requête (voir journal-scans.js, qui n'écrit jamais une URL `data:`).
// ⚠️ Non prouvé ici (§5 Q20) : le comportement RÉEL du modèle sur un data-URL ; la règle G (voisins par URL) et le départage par l'image (hôte Vinted) ne s'appliquent pas à un data-URL.
const crypto = require('crypto');
const mongoose = require('mongoose');
const registre = require('../registre');
const { repondreErreur } = require('../erreurs');
const { lireMultipart } = require('./multipart');
const L = require('../transport/limites');
const { idempotente, FORME } = require('../transport/idempotence');
const { resoudrePorteur, exigerSession } = require('../porteur');
const { exigerOrigineSite } = require('../comptes/sessions');
const { traiterIdentifier, traiterReponse } = require('../identifier/routes');
const { facturationDeLecture } = require('../identifier/retour-live');
const { col } = require('../db');

const PORTE_MAX = 3;                                   // au plus 3 corps de 12 Mo en mémoire à la fois, pour le processus
let enCours = 0;
const etatPorte = () => ({ enCours, max: PORTE_MAX });
const journalErreur = (ou, e) => console.error(`❌ [v2 scanner] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);   // jamais e.message
const MESSAGES_IMAGE = Object.freeze({ 'trop-lourde': 'Image trop lourde', format: 'Format d\'image non pris en charge', 'aucune-carte': 'Aucune image reçue' });

// Une réponse après laquelle la connexion est FERMÉE : `Connection: close`, puis la socket est détruite une fois la réponse partie (le corps non lu n'est jamais avalé).
function repondreEtFermer(req, res, envoyer) {
    res.setHeader('Connection', 'close');
    res.once('finish', () => { const t = setTimeout(() => { try { req.destroy(); } catch { /* déjà fermée */ } }, 50); t.unref(); });
    return envoyer();
}

async function decoderHeicParDefaut(buffer) {
    const sharp = require('sharp');
    return sharp(buffer, { failOn: 'error', limitInputPixels: 80e6 }).rotate().jpeg({ quality: 90 }).toBuffer();
}
const estJpeg = b => Buffer.isBuffer(b) && b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;

function routesScanner(router, cfg, deps = {}) {
    const decoder = typeof deps.decoderHeic === 'function' ? deps.decoderHeic : decoderHeicParDefaut;
    const delaiMs = Number.isFinite(deps.scannerDelaiLectureMs) && deps.scannerDelaiLectureMs > 0 ? deps.scannerDelaiLectureMs : undefined;
    // pas de règle G au scanner : ses voisins se cherchent par URL d'hôte Vinted, et l'image du scanner est un data-URL
    const depsScanner = { ...deps, voisins: undefined };

    // 120 analyses par heure et par COMPTE : le MÊME budget que l'extension (même nom, même clé) — un compte ne double pas son débit en changeant de surface
    const parCompte = L.limiteur({ nom: 'identifier', max: cfg.limites.identifierParCompteHeure, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });

    function porteCorps(req, res, next) {
        if (enCours >= PORTE_MAX) return repondreEtFermer(req, res, () => repondreErreur(res, 'INDISPONIBLE', undefined, { reessayerDans: 2 }));
        enCours++;
        let rendu = false;
        res.once('close', () => { if (!rendu) { rendu = true; enCours--; } });
        return next();
    }

    async function lireImage(req, res, next) {
        try {
            const { champs, image } = await lireMultipart(req, { ...(delaiMs ? { delaiMs } : {}) });
            let { buffer, type } = image;
            const empreinte = crypto.createHash('sha256').update(buffer).digest('hex');
            if (type === 'image/heic') {                     // décodé AVANT l'IA et AVANT le débit ; un échec est un format refusé
                let jpeg = null;
                try { jpeg = await decoder(buffer); } catch (e) { journalErreur('décodage HEIC', e); }
                if (!estJpeg(jpeg)) return repondreErreur(res, 'IMAGE', MESSAGES_IMAGE.format, { detail: 'format' }, 415);
                buffer = jpeg; type = 'image/jpeg';
            }
            req.fichier = { buffer, type, source: champs.source };
            req.body = { source: champs.source, image: empreinte };      // l'empreinte du corps pour l'idempotence : même clé + autre image = refusée
            return next();
        } catch (e) {
            if (e && e.code === 'IMAGE') {
                const envoyer = () => repondreErreur(res, 'IMAGE', MESSAGES_IMAGE[e.detail], { detail: e.detail }, e.statut);
                return e.statut === 413 ? repondreEtFermer(req, res, envoyer) : envoyer();
            }
            if (e && e.code === 'ENTREE') {
                const envoyer = () => repondreErreur(res, 'ENTREE', undefined, { detail: e.detail }, e.statut);
                return (e.fermer || e.statut === 408) ? repondreEtFermer(req, res, envoyer) : envoyer();
            }
            journalErreur('lecture du corps', e);
            return repondreErreur(res, 'SERVEUR');
        }
    }

    // l'idempotence est facultative au scanner ; le débit, lui, EXIGE une clé : sans en-tête, le serveur en fabrique une (un POST = un scan)
    function cleDeDebit(req, res, next) {
        const k = req.headers['idempotency-key'];
        if (!(typeof k === 'string' && FORME.test(k))) req.headers['idempotency-key'] = `sc-${crypto.randomBytes(18).toString('base64url')}`;
        next();
    }

    function entreeDuScanner(req, res, next) {
        const { buffer, type } = req.fichier;
        req.entree = { imageUrls: [`data:${type};base64,${buffer.toString('base64')}`], title: '', description: '', prixVinted: null, devise: null, marche: null,
            vintedUrl: null, vintedEtat: null, langueInterface: 'fr', versionExtension: 'scanner' };
        req.fichier = null;                                   // le buffer n'est plus nécessaire : seul le data-URL de l'entrée reste
        next();
    }

    // Le scanner n'a ni règle de verdict ni lecture de prix en direct (CONTRAT : « null au scanner ») : l'analyse est servie telle que traiterIdentifier l'a faite, ces deux champs à null.
    const sansLive = k => (k && typeof k === 'object' ? { ...k, prixLive: null } : k);
    const auScanner = c => (c && c.success === true && c.analyse && Array.isArray(c.analyse.cartes) ? { ...c, analyse: { ...c.analyse, regleVerdict: null, cartes: c.analyse.cartes.map(sansLive) } } : c);
    // Carte identifiée SANS prix au guide => remboursée (`sans-prix`), une fois par scan (le ledger refuse le second). Réponse réécrite, jamais la logique de traiterIdentifier.
    const aRembourser = c => Boolean(c && c.success === true && c.contrat === 2 && c.analyse && c.analyse.statut === 'identifiee' && Array.isArray(c.analyse.cartes) && c.analyse.cartes.length === 1
        && c.analyse.cartes[0].statut === 'identifiee' && c.analyse.cartes[0].carte && c.analyse.cartes[0].carte.prixGuide === null
        && c.facturation && c.facturation.motif === 'affirmee' && c.facturation.debite === 1 && c.facturation.rembourse === false && /^[0-9a-f]{24}$/i.test(String(c.scanId)));
    async function rembourserSansPrix(req, corps) {
        const argent = registre.obtenir('argent'), porteur = req.v2.porteur, scanId = new mongoose.Types.ObjectId(corps.scanId);
        const r = await argent.rembourser(porteur, { poche: null }, 'sans-prix', { scanId, compteur: 'question' });
        const facturation = facturationDeLecture(r);
        let solde; try { solde = await argent.solde(porteur); } catch (e) { journalErreur('solde', e); }
        try { await col('analyses').updateOne({ _id: scanId }, { $set: { facturation } }); } catch (e) { journalErreur('analyses', e); }
        return { ...corps, facturation, ...(solde !== undefined ? { solde } : {}) };
    }
    function sansPrix(req, res, next) {
        const origine = res.json;
        res.json = function (corps) {
            res.json = origine;
            corps = auScanner(corps);
            if (!aRembourser(corps)) return origine.call(this, corps);
            rembourserSansPrix(req, corps).catch(e => { journalErreur('remboursement sans-prix', e); return corps; }).then(c => origine.call(this, c));
            return this;
        };
        next();
    }

    router.post('/api/scanner/analyses',
        resoudrePorteur(cfg), exigerSession, exigerOrigineSite(cfg), parCompte, porteCorps, lireImage,
        idempotente('scanner', { obligatoire: false }, cfg), cleDeDebit, entreeDuScanner, sansPrix, traiterIdentifier(cfg, depsScanner));

    // La réponse à une question : le scanId vient du CHEMIN (un corps qui en porte un autre est refusé), le reste est /api/identifier/reponse.
    function scanIdDuChemin(req, res, next) {
        const id = req.params.id, b = req.body;
        if (typeof id !== 'string' || !/^[0-9a-f]{24}$/i.test(id)) return repondreErreur(res, 'ENTREE', undefined, { detail: 'scan-id' });
        if (!b || typeof b !== 'object' || Array.isArray(b)) return repondreErreur(res, 'ENTREE', undefined, { detail: 'corps' });
        if (b.scanId !== undefined && String(b.scanId).toLowerCase() !== id.toLowerCase()) return repondreErreur(res, 'ENTREE', undefined, { detail: 'scan-id' });
        req.body = { ...b, scanId: id };
        next();
    }
    function reponseAuScanner(req, res, next) {
        const origine = res.json;
        res.json = function (corps) { res.json = origine; return origine.call(this, corps && corps.success === true && corps.carte ? { ...corps, carte: sansLive(corps.carte) } : corps); };
        next();
    }
    router.post('/api/scanner/analyses/:id/reponse',
        resoudrePorteur(cfg), exigerSession, exigerOrigineSite(cfg), scanIdDuChemin, idempotente('reponse-scanner', { obligatoire: false }, cfg), reponseAuScanner, traiterReponse(cfg, depsScanner));
}

module.exports = { routesScanner, etatPorte, PORTE_MAX };
