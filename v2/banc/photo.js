'use strict';
// PHOTO-EXTENSION (recadrage du 2026-10-13 soir, décision du testeur) — POST /api/banc/photo?scanId=<24 hex>&photo=0 : l'extension de l'ADMINISTRATEUR envoie l'image qu'elle affiche déjà, en OCTETS BRUTS
// (JPEG, PNG ou WebP tels que Vinted les sert ; ni base64, ni JSON), pour qu'aucune requête serveur vers Vinted ne soit nécessaire. POST /api/identifier n'a PAS de champ d'image : son corps garde ses 100 ko.
// 🔑 Écrit par ce qu'il AUTORISE. L'ordre, jugé AVANT de lire un seul octet du corps (prouvé par un compteur d'octets lus) :
//   1. porteur v2 authentifié (resoudrePorteur + exigerInstallation : 401 JETON sinon) ; 2. compte au rôle `administrateur` RELU en base (exigerAdministrateur : tout autre porteur reçoit le 404 NATIF d'une route
//   qui n'existe pas) ; 3. un plafond horaire par porteur (429 DEBIT) ; 4. la requête : scanId de la forme d'un identifiant, `photo` absent ou `0`, aucun autre paramètre (400) ; 5. `Content-Type` ∈ JPEG, PNG, WebP (415) ;
//   6. `Content-Length` entier, > 0 et ≤ 2 Mio (400 / 413) ; 7. le scan existe ET est de CE porteur (404 CODE_INVALIDE, jamais distingués) ; la photo existe déjà : 200 `deja`, rien lu, rien réécrit ;
//   8. une place de lecture : 4 au total, 1 par porteur (429 DEBIT + Retry-After) ; 9. un délai de lecture (15 s : une connexion lente est coupée).
// Puis le corps : octets lus (jamais plus que le Content-Length), validés par identifier/photo-extension.js (UNE analyse d'image, celle du scanner : 12 Mpx, 4 096 px, une page, 2 décodages simultanés au plus),
// puis conservés par `banc.conserverPhoto` (les mêmes traitements que la photo téléchargée : WebP sans métadonnées, ≤ 1600 px, sha256 sur l'analyse). Les cartes du scan qui attendaient leur photo
// (`etiquetteAdmin.banc: 'en-attente'`) sortent de l'attente : leur ligne du banc naît (ETIQUETAGE-B). Idempotente : la même photo pour le même scan => `deja`, rien de plus.
// Le corps n'est jamais journalisé ni gardé ailleurs qu'au bucket du banc, après traitement.
const mongoose = require('mongoose');
const db = require('../db');
const { repondreErreur } = require('../erreurs');
const PE = require('../identifier/photo-extension');
const { exigerAdministrateur } = require('./etiquette');

const FORME_ID = /^[0-9a-f]{24}$/i;
const PLACES_MAX = 4, DELAI_LECTURE_MS = 15000;
const journal = (ou, e) => console.error(`❌ [v2 banc-photo] ${ou} (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message

// Une réponse décidée AVANT la lecture : le corps n'est pas lu par la route. Node le vide lui-même à la fin de la réponse (comme pour une route inexistante) : coût en bande passante identique à n'importe quelle route,
// ni place ni mémoire. TOUR 2 (I1) : l'ancien plafond « 8 Mio ou 2 s » était du code mort (Node n'émet plus de `data` après `_dump()`) : retiré. On ne coupe PAS la connexion pour arrêter le flux : le 404 d'un
// non-administrateur se distinguerait de celui d'une route inexistante. Un refus ordinaire envoie `Connection: close` ; le `discret` (le 404 natif d'un non-administrateur) n'ajoute AUCUN en-tête.
function fermerApres(req, res, { discret = false } = {}) {
    if (!discret) res.setHeader('Connection', 'close');
}

/** La garde de rôle de /api/banc/etiquette (exigerAdministrateur), avec UNE différence : le 404 natif d'un non-administrateur est écrit SANS lire le corps. `next('route')` laisse `finalhandler` répondre, mais
 *  finalhandler VIDE d'abord toute la requête avant d'écrire (un client lent tiendrait la connexion jusqu'au délai de Node) ; on lui donne donc une requête factice DÉJÀ terminée. Même module, même corps, mêmes
 *  en-têtes que la route inexistante (prouvé par comparaison). Le vrai corps est jeté ensuite (fermerApres). */
function exigerAdministrateurPhoto(req, res, next) {
    return exigerAdministrateur(req, res, (x) => {
        if (x !== 'route') return next(x);
        fermerApres(req, res, { discret: true });
        const faux = { method: req.method, url: req.url, originalUrl: req.originalUrl, headers: req.headers, complete: true, readable: false, socket: null, resume() { }, unpipe() { } };
        return require('finalhandler')(faux, res)();
    });
}

function traiterPhoto(cfg, deps = {}) {
    const octetsMax = cfg.images.photoExtensionOctetsMax;
    const reglage = (deps && deps.photoRoute) || {};
    const placesMax = Number.isInteger(reglage.placesMax) && reglage.placesMax > 0 ? reglage.placesMax : PLACES_MAX;
    const delaiMs = Number.isFinite(reglage.delaiLectureMs) && reglage.delaiLectureMs > 0 ? reglage.delaiLectureMs : DELAI_LECTURE_MS;
    let enCours = 0; const porteurs = new Set();
    const analyses = () => db.col('analyses');

    return async function traiterPhotoV2(req, res) {
        const porteur = req.v2 && req.v2.porteur;
        const banc = deps.banc;
        if (!porteur || !banc || typeof banc.conserverPhoto !== 'function') return repondreErreur(res, 'INDISPONIBLE');
        const refus = (code, message, detail, statut, extra = {}) => { fermerApres(req, res); return repondreErreur(res, code, message, { detail, ...extra }, statut); };

        // 4. la requête
        const q = req.query || {};
        if (Object.keys(q).some(k => k !== 'scanId' && k !== 'photo')) return refus('ENTREE', undefined, 'champ-inconnu');
        if (typeof q.scanId !== 'string' || !FORME_ID.test(q.scanId)) return refus('ENTREE', undefined, 'scan-id');
        if (q.photo !== undefined && q.photo !== '0') return refus('ENTREE', undefined, 'photo');       // le banc ne garde que la PREMIÈRE photo de l'annonce
        // 5. le type annoncé
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!PE.TYPES.includes(type)) return refus('IMAGE', 'Format d\'image non pris en charge', 'type', 415);
        // 6. la longueur
        const cl = req.headers['content-length'];
        if (typeof cl !== 'string' || !/^\d{1,10}$/.test(cl) || Number(cl) === 0) return refus('ENTREE', undefined, 'content-length');
        if (Number(cl) > octetsMax) return refus('IMAGE', 'Image trop lourde', 'trop-lourde', 413);
        const longueur = Number(cl);
        // 7. le scan est de CE porteur
        let an;
        try { an = await analyses().findOne({ _id: new mongoose.Types.ObjectId(q.scanId), porteur: `${porteur.type}:${porteur.id}` }, { projection: { cartes: 1, photoBanc: 1 } }); }
        catch (e) { journal('scan', e); return refus('INDISPONIBLE'); }
        if (!an) return refus('CODE_INVALIDE', 'Scan introuvable');
        if (an.photoBanc) { fermerApres(req, res); return res.status(200).json({ success: true, etat: 'deja', photo: 0 }); }
        // 8. une place de lecture
        const cle = `${porteur.type}:${porteur.id}`;
        if (enCours >= placesMax || porteurs.has(cle)) return refus('DEBIT', 'Une photo est déjà en cours d\'envoi', undefined, undefined, { reessayerDans: 2 });
        enCours++; porteurs.add(cle);
        let libre = false;
        const liberer = () => { if (libre) return; libre = true; enCours--; porteurs.delete(cle); };
        res.once('close', liberer);
        // 9. le corps, borné par la longueur annoncée et par un délai
        let octets;
        try {
            octets = await new Promise((resolve, reject) => {
                const morceaux = []; let total = 0, fini = false;
                const clore = (f, v) => { if (fini) return; fini = true; clearTimeout(minute); req.removeListener('data', surDonnee); req.removeListener('end', surFin); req.removeListener('error', surErreur); req.removeListener('aborted', surErreur); f(v); };
                const surDonnee = c => { total += c.length; if (total > longueur) { req.pause(); clore(reject, Object.assign(new Error('trop'), { code: 'TROP' })); return; } morceaux.push(c); };
                const surFin = () => (total === longueur ? clore(resolve, Buffer.concat(morceaux, total)) : clore(reject, Object.assign(new Error('court'), { code: 'COURT' })));
                const surErreur = () => clore(reject, Object.assign(new Error('coupe'), { code: 'COUPE' }));
                const minute = setTimeout(() => { if (fini) return; try { req.socket.destroy(); } catch { /* déjà fermée */ } clore(reject, Object.assign(new Error('lent'), { code: 'LENT' })); }, delaiMs);
                minute.unref();
                req.on('data', surDonnee); req.on('end', surFin); req.on('error', surErreur); req.on('aborted', surErreur);
            });
        } catch (e) {
            liberer();
            if (e && (e.code === 'LENT' || e.code === 'COUPE')) { console.warn(`⚠️ [v2 banc-photo] lecture interrompue (${e.code})`); return; }       // plus personne à qui répondre
            return repondreErreur(res, e && e.code === 'TROP' ? 'IMAGE' : 'ENTREE', undefined, { detail: e && e.code === 'TROP' ? 'trop-lourde' : 'content-length' }, e && e.code === 'TROP' ? 413 : 400);
        }
        liberer();
        // la validation (UNE analyse d'image) puis la conservation
        const v = await PE.evaluerOctets(octets, { octetsMax, typeAnnonce: type });
        if (!v.octets) {
            PE.noter(v.cause);
            console.log(`📷 [v2 banc-photo] refusée (${v.cause})`);                                // un code, jamais l'image
            if (v.cause === 'trop-grosse') return repondreErreur(res, 'IMAGE', 'Image trop lourde', { detail: 'trop-lourde' }, 413);
            if (v.cause === 'format') return repondreErreur(res, 'IMAGE', 'Format d\'image non pris en charge', { detail: 'type' }, 415);
            if (v.cause === 'illisible' || v.cause === 'dimensions') return repondreErreur(res, 'IMAGE', 'Image illisible', { detail: v.cause }, 422);
            if (v.cause === 'occupe') return repondreErreur(res, 'DEBIT', 'Trop de photos en cours de traitement', { reessayerDans: 2 });
            return repondreErreur(res, 'INDISPONIBLE');
        }
        let r;
        try { r = await banc.conserverPhoto({ scanId: q.scanId, buffer: v.octets }); }
        catch (e) { journal('conservation', e); return repondreErreur(res, 'INDISPONIBLE'); }
        PE.noter(r === 'ecrit' ? 'ok' : String(r));
        if (r === 'deja') return res.status(200).json({ success: true, etat: 'deja', photo: 0 });
        if (r === 'refuse') return repondreErreur(res, 'IMAGE', 'Image illisible', { detail: 'refusee' }, 422);
        if (r !== 'ecrit') return repondreErreur(res, 'INDISPONIBLE');
        // les cartes qui attendaient leur photo : leur ligne du banc naît maintenant
        let etats = [];
        try {
            const courant = await analyses().findOne({ _id: new mongoose.Types.ObjectId(q.scanId) }, { projection: { cartes: 1 } });
            const cartes = courant && Array.isArray(courant.cartes) ? courant.cartes : [];
            for (let i = 0; i < cartes.length; i++) {
                const e = cartes[i] && cartes[i].etiquetteAdmin;
                if (e && e.banc === 'en-attente' && typeof banc.etiquetteAdmin === 'function') etats.push(await banc.etiquetteAdmin({ scanId: q.scanId, carte: i }));
            }
        } catch (e) { journal('cartes en attente', e); etats = etats.concat('en-attente'); }
        return res.status(200).json({ success: true, etat: 'ecrit', photo: 0, ...(etats.length ? { banc: etats.every(x => x === 'ecrit') ? 'ecrit' : 'en-attente' } : {}) });
    };
}

module.exports = { traiterPhoto, exigerAdministrateurPhoto, PLACES_MAX, DELAI_LECTURE_MS };
