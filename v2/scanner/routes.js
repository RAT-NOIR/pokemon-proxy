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
const MP = require('./multipart');                    // appelée À TRAVERS l'objet du module : un banc peut l'espionner
const L = require('../transport/limites');
const { idempotente, FORME } = require('../transport/idempotence');
const { resoudrePorteur, exigerSession } = require('../porteur');
const { exigerOrigineSite } = require('../comptes/sessions');
const { traiterIdentifier, traiterReponse, URL_RECHARGE } = require('../identifier/routes');
const { facturation: fabriquerFacturation } = require('../argent/facturation');
const { facturationDeLecture } = require('../identifier/retour-live');
const { col } = require('../db');

const PORTE_MAX = 3;                                   // au plus 3 corps de 12 Mo en mémoire à la fois, pour le processus
const PLAFOND_PRISE_MS = 5 * 60 * 1000;                // filet : une prise n'est jamais gardée plus de 5 min, quoi qu'il arrive (aucune fuite ne dure)
const COTE_MAX_PX = 2048, PIXELS_MAX = 80e6;
let enCours = 0;
const lecturesParCompte = new Set();                   // UN seul corps en lecture par compte à la fois (ce processus)
const etatPorte = () => ({ enCours, max: PORTE_MAX, comptes: lecturesParCompte.size });
const journalErreur = (ou, e) => console.error(`❌ [v2 scanner] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);   // jamais e.message
const MESSAGES_IMAGE = Object.freeze({ 'trop-lourde': 'Image trop lourde', format: 'Format d\'image non pris en charge', 'aucune-carte': 'Aucune image reçue' });

// Une réponse après laquelle la connexion est FERMÉE : `Connection: close`, puis la socket est détruite une fois la réponse partie (le corps non lu n'est jamais avalé).
function repondreEtFermer(req, res, envoyer) {
    res.setHeader('Connection', 'close');
    res.once('finish', () => { const t = setTimeout(() => { try { req.destroy(); } catch { /* déjà fermée */ } }, 50); t.unref(); });
    return envoyer();
}

// Décodage BORNÉ : pixels d'entrée limités, côté long ramené à 2 048 px (jamais agrandi), sortie JPEG ; l'orientation EXIF est appliquée (la sortie n'en porte plus).
async function decoderHeicParDefaut(buffer) {
    const sharp = require('sharp');
    return sharp(buffer, { failOn: 'error', limitInputPixels: PIXELS_MAX }).rotate()
        .resize({ width: COTE_MAX_PX, height: COTE_MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}
// M6 : une image aux octets magiques valides doit AUSSI se lire (en-tête décodable, format reconnu, dimensions raisonnables) avant le moindre débit.
// N3 : l'en-tête ne suffit pas — un DÉCODAGE réduit (64 px, à bas coût) lit l'image entière ; une image tronquée ou corrompue (avertissement du décodeur compris) est refusée.
async function imageLisible(buffer, formats = ['jpeg', 'png', 'webp']) {
    try {
        const sharp = require('sharp');
        const m = await sharp(buffer, { failOn: 'error' }).metadata();
        if (!(formats.includes(m.format) && m.width > 0 && m.height > 0 && m.width * m.height <= PIXELS_MAX)) return false;
        await sharp(buffer, { limitInputPixels: PIXELS_MAX }).resize({ width: 64, height: 64, fit: 'inside' }).toBuffer();
        return true;
    } catch { return false; }
}
const estJpeg = b => Buffer.isBuffer(b) && b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;

function routesScanner(router, cfg, deps = {}) {
    const decoder = typeof deps.decoderHeic === 'function' ? deps.decoderHeic : decoderHeicParDefaut;
    const delaiMs = Number.isFinite(deps.scannerDelaiLectureMs) && deps.scannerDelaiLectureMs > 0 ? deps.scannerDelaiLectureMs : undefined;
    // Les dépendances passent TELLES QUELLES (règle G comprise) : le futur fournisseur de voisins recevra un data-URL et ne doit ni le journaliser ni le stocker.
    const depsScanner = deps;
    const octetsMax = cfg.images.scannerOctetsMax;

    // 120 analyses par heure et par COMPTE : le MÊME budget que l'extension (même nom, même clé) — un compte ne double pas son débit en changeant de surface
    const parCompte = L.limiteur({ nom: 'identifier', max: cfg.limites.identifierParCompteHeure, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });

    // N2 : un refus décidé AVANT la lecture du corps. Quand le corps est annoncé (Content-Length) et dans la borne de la lecture, on le JETTE (aucune accumulation, même échéance
    // que la lecture) puis la réponse part normalement — le navigateur la reçoit en entier. Hors borne, sans Content-Length, ou à l'échéance : on ferme (repondreEtFermer).
    // Le comportement d'un navigateur réel n'est pas prouvé hors ligne (client HTTP Node seulement).
    function refuserAvantLecture(req, res, envoyer) {
        const cl = req.headers['content-length'], annonce = /^\d+$/.test(String(cl)) ? Number(cl) : null;
        if (req.readableEnded) return envoyer();                                   // déjà consommé en entier (express.json() global, par exemple)
        if (annonce === null || annonce > octetsMax + MP.MARGE_ENTETES_OCTETS) return repondreEtFermer(req, res, envoyer);
        let fini = false;
        const nettoyer = () => { clearTimeout(minute); req.removeListener('end', surFin); req.removeListener('close', surClose); };
        const surFin = () => { if (fini) return; fini = true; nettoyer(); envoyer(); };
        const surClose = () => { if (fini) return; fini = true; nettoyer(); };         // le client est parti : personne à qui répondre
        const minute = setTimeout(() => { if (fini) return; fini = true; nettoyer(); repondreEtFermer(req, res, envoyer); }, delaiMs || MP.DELAI_LECTURE_MS);
        minute.unref();
        req.on('end', surFin); req.on('close', surClose);
        req.on('data', () => { });                                                   // jeté, jamais gardé
        req.resume();
    }

    // I1 : un corps qui n'est pas du multipart est refusé TOUT DE SUITE (express.json() global a pu le consommer : la lecture attendrait 30 s une fin qui a déjà eu lieu)
    function exigerMultipart(req, res, next) {
        if (/^multipart\/form-data\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) return next();
        return refuserAvantLecture(req, res, () => repondreErreur(res, 'ENTREE', undefined, { detail: 'boundary' }));
    }

    // I2a : « ce porteur peut-il payer ? » se juge AVANT de lire 12 Mo, par la règle de v2/argent/ (solde.peutPayer, même table de refus que le débit). Rien n'est débité ici.
    async function peutPayer(req, res, next) {
        const porteur = req.v2.porteur;
        let p;
        try { p = await registre.obtenir('argent').peutPayer(porteur); }
        catch (e) { journalErreur('peutPayer', e); return refuserAvantLecture(req, res, () => repondreErreur(res, 'INDISPONIBLE')); }
        if (p.ok) return next();
        let solde; try { solde = await registre.obtenir('argent').solde(porteur); } catch (e) { journalErreur('solde', e); }
        return refuserAvantLecture(req, res, () => repondreErreur(res, p.code, undefined, { facturation: null, ...(solde !== undefined ? { solde } : {}), ...(p.code === 'QUOTA' && porteur.type === 'compte' ? { achat: { url: URL_RECHARGE } } : {}) }));
    }

    // C1 + I2b + N1 + porte : un jeton de la porte (3 corps pour le processus) ET le droit de lire UN corps pour ce compte. Exactement UNE libération (idempotente) :
    //   · avant que le traitement commence (coupure ou réponse pendant les lectures, la lecture du corps, l'idempotence) : sur `close`/`finish` — et si le client est déjà parti
    //     quand le traitement devrait commencer, il ne commence pas (voir `lancer`) ;
    //   · une fois commencé : à sa FIN RÉELLE (`finally` de `lancer`) — un client qui coupe pendant l'IA ne libère PAS la mémoire (data-URL et copies) : la borne de 3 la borne vraiment ;
    //   · un plafond de 5 min la force en dernier recours (chaîne bloquée).
    // On ne prend rien si le client est déjà parti (son `close` ne reviendrait jamais).
    function tenir(req, res, next) {
        if (req.destroyed || res.destroyed || res.writableEnded) return undefined;     // client parti pendant les lectures de session/compte : rien à prendre, personne à qui répondre
        const cle = `${req.v2.porteur.type}:${req.v2.porteur.id}`;
        if (lecturesParCompte.has(cle)) return refuserAvantLecture(req, res, () => repondreErreur(res, 'DEBIT', undefined, { reessayerDans: 2 }));
        if (enCours >= PORTE_MAX) return refuserAvantLecture(req, res, () => repondreErreur(res, 'INDISPONIBLE', undefined, { reessayerDans: 2 }));
        enCours++; lecturesParCompte.add(cle);
        let rendu = false, garde = null, commence = false;
        const liberer = () => { if (rendu) return; rendu = true; enCours--; lecturesParCompte.delete(cle); clearTimeout(garde); };
        garde = setTimeout(liberer, PLAFOND_PRISE_MS); garde.unref();
        req.jeton = { liberer, get rendu() { return rendu; }, commencer() { commence = true; } };
        res.once('close', () => { if (!commence) liberer(); });                       // coupure AVANT le traitement seulement
        res.once('finish', liberer);                                                  // réponse partie : le traitement est fini
        return next();
    }
    // Le traitement (chaîne + argent) : n'a lieu que si le client est encore là ; sa fin réelle libère la porte, quoi qu'il arrive.
    const lancer = handler => async (req, res, next) => {
        const j = req.jeton;
        if (!j || j.rendu) {                                 // le client est parti avant le traitement : rien n'est exécuté, donc sa clé d'idempotence redevient rejouable
            if (req.idempotence) await req.idempotence.liberer();
            return undefined;
        }
        j.commencer();
        try { return await handler(req, res, next); } finally { j.liberer(); }
    };

    async function lireImage(req, res, next) {
        try {
            const { champs, image } = await MP.lireMultipart(req, { ...(delaiMs ? { delaiMs } : {}) });
            let { buffer, type } = image;
            const empreinte = crypto.createHash('sha256').update(buffer).digest('hex');
            if (type === 'image/heic') {                     // décodé AVANT l'IA et AVANT le débit ; un échec est un format refusé
                let jpeg = null;
                try { jpeg = await decoder(buffer); } catch (e) { journalErreur('décodage HEIC', e); }
                if (!estJpeg(jpeg)) return repondreErreur(res, 'IMAGE', MESSAGES_IMAGE.format, { detail: 'format' }, 415);
                if (jpeg.length > octetsMax) return repondreErreur(res, 'IMAGE', MESSAGES_IMAGE['trop-lourde'], { detail: 'trop-lourde' }, 413);   // la sortie du décodeur est bornée comme l'entrée
                if (!(await imageLisible(jpeg, ['jpeg']))) return repondreErreur(res, 'IMAGE', MESSAGES_IMAGE.format, { detail: 'format' }, 415);   // ... et vérifiée comme une entrée
                buffer = jpeg; type = 'image/jpeg';
            } else if (!(await imageLisible(buffer))) return repondreErreur(res, 'IMAGE', MESSAGES_IMAGE.format, { detail: 'format' }, 415);
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
    // Carte identifiée SANS prix au guide => remboursée (`sans-prix`), une fois par scan (le ledger refuse le second) — CONTRAT-2 §6, « à confirmer par l'éditeur ».
    // UNE fonction pour les deux chemins : la carte identifiée d'emblée (facturation `affirmee`) et la question répondue par un candidat (facturation `question`, débit confirmé).
    const sansPrixIdentifiee = (k, f, motif) => Boolean(k && k.statut === 'identifiee' && k.carte && k.carte.prixGuide === null && f && f.motif === motif && f.debite === 1 && f.rembourse === false);
    const aRembourserAnalyse = c => Boolean(c && c.success === true && c.contrat === 2 && c.analyse && c.analyse.statut === 'identifiee' && Array.isArray(c.analyse.cartes) && c.analyse.cartes.length === 1
        && sansPrixIdentifiee(c.analyse.cartes[0], c.facturation, 'affirmee') && /^[0-9a-f]{24}$/i.test(String(c.scanId)));
    const aRembourserReponse = c => Boolean(c && c.success === true && sansPrixIdentifiee(c.carte, c.facturation, 'question'));
    async function rembourserSansPrix(req, corps, idScan) {
        const argent = registre.obtenir('argent'), porteur = req.v2.porteur, scanId = new mongoose.Types.ObjectId(idScan);
        const r = await argent.rembourser(porteur, { poche: null }, 'sans-prix', { scanId, compteur: 'question' });
        // un rejeu de la même réponse retrouve le scan DÉJÀ remboursé : la réponse dit ce qu'elle a dit la première fois
        const facturation = !r.rendu && r.raisonNonRembourse === 'deja-rembourse' ? fabriquerFacturation({ debite: 0, rembourse: true, motif: 'sans-prix' }) : facturationDeLecture(r);
        let solde; try { solde = await argent.solde(porteur); } catch (e) { journalErreur('solde', e); }
        try { await col('analyses').updateOne({ _id: scanId }, { $set: { facturation } }); } catch (e) { journalErreur('analyses', e); }
        return { ...corps, facturation, ...(solde !== undefined ? { solde } : {}) };
    }
    // Habille res.json : `transformer` (null au scanner), puis le remboursement sans-prix si `aRembourser(corps)`. Un remboursement qui échoue sert la réponse d'origine (jamais une panne).
    function habiller(transformer, aRembourser, idScan) {
        return (req, res, next) => {
            const origine = res.json;
            res.json = function (corps) {
                res.json = origine;
                corps = transformer(corps);
                if (!aRembourser(corps)) return origine.call(this, corps);
                rembourserSansPrix(req, corps, idScan(req, corps)).catch(e => { journalErreur('remboursement sans-prix', e); return corps; }).then(c => origine.call(this, c));
                return this;
            };
            next();
        };
    }
    const sansPrix = habiller(auScanner, aRembourserAnalyse, (req, corps) => corps.scanId);

    router.post('/api/scanner/analyses',
        resoudrePorteur(cfg), exigerSession, exigerOrigineSite(cfg), exigerMultipart, parCompte, peutPayer, tenir, lireImage,
        idempotente('scanner', { obligatoire: false }, cfg), cleDeDebit, entreeDuScanner, sansPrix, lancer(traiterIdentifier(cfg, depsScanner)));

    // La réponse à une question : le scanId vient du CHEMIN (un corps qui en porte un autre est refusé), le reste est /api/identifier/reponse.
    function scanIdDuChemin(req, res, next) {
        const id = req.params.id, b = req.body;
        if (typeof id !== 'string' || !/^[0-9a-f]{24}$/i.test(id)) return repondreErreur(res, 'ENTREE', undefined, { detail: 'scan-id' });
        if (!b || typeof b !== 'object' || Array.isArray(b)) return repondreErreur(res, 'ENTREE', undefined, { detail: 'corps' });
        if (b.scanId !== undefined && String(b.scanId).toLowerCase() !== id.toLowerCase()) return repondreErreur(res, 'ENTREE', undefined, { detail: 'scan-id' });
        req.body = { ...b, scanId: id };
        next();
    }
    const reponseAuScanner = habiller(c => (c && c.success === true && c.carte ? { ...c, carte: sansLive(c.carte) } : c), aRembourserReponse, req => req.body.scanId);
    router.post('/api/scanner/analyses/:id/reponse',
        resoudrePorteur(cfg), exigerSession, exigerOrigineSite(cfg), scanIdDuChemin, idempotente('reponse-scanner', { obligatoire: false }, cfg), reponseAuScanner, traiterReponse(cfg, depsScanner));
}

module.exports = { routesScanner, etatPorte, PORTE_MAX, decoderHeicParDefaut };
