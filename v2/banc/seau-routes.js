'use strict';
// BANC-200 — les routes /api/banc/seau/* (derrière V2_BANC_SEAU=1 : éteint, elles n'existent pas, 404 natif pour tous). ADMINISTRATEUR SEULEMENT : la garde de rôle de /api/banc/etiquette (rôle RELU en base, 404 natif sinon)
// passe AVANT le limiteur et AVANT la lecture de tout corps. Les routes ne contiennent que de la mise en forme : toutes les règles vivent dans seau.js.
//   POST /declarer { nom, type, cible?, note? }          → 201 { seau }      GET  /courant                       → { seau | null }
//   POST /sceller { seauId }                              → { seau }          GET  /verifier?seau=                → { ok, lignes, tete, problemes }
//   POST /photo?scanId=&photo=0..7&seau=[&annonce=]  (octets bruts JPEG/PNG/WebP)  → { etat, rang, seauId }
//   POST /mesures?scanId=&seau=  (JSON, Content-Type application/octet-stream, 512 Kio au plus)  → { etat }
//   GET  /a-etiqueter[?seau=]  → { scans:[{scanId,rang,photos,cartes,etiquetees}], prochain }    GET /photo?scanId=&photo=  → les octets d'origine
//   POST /candidats { scanId, carte? }  → { candidats }  (à la demande ; la vue est enregistrée)     POST /verite { scanId, carte?, idProduct | aucune, via }  → { rev, candidatsVus }
const { repondreErreur } = require('../erreurs');
const { resoudrePorteur, exigerInstallation } = require('../porteur');
const { exigerAdministrateur } = require('./etiquette');
const { exigerAdministrateurPhoto } = require('./photo');
const { lireCorpsBorne } = require('./lecture-corps');
const PE = require('../identifier/photo-extension');
const L = require('../transport/limites');
const { FORME_ID, FORME_SEAU, FORME_SHA, PHOTOS_MAX, MESURES_OCTETS_MAX } = require('./seau');

const journal = (ou, e) => console.error(`❌ [v2 banc-seau] ${ou} (${(e && (e.code || e.name)) || 'erreur'})`);       // jamais e.message : il peut citer une clé
const PLACES_MAX = 4, PAR_PORTEUR_MAX = 2, DELAI_LECTURE_MS = 15000;

/** Une erreur de seau.js → la réponse. Toute autre exception : 503, journalisée par son code seulement. */
function repondre(res, e, ou) {
    if (e && ['ENTREE', 'CONFLIT', 'CODE_INVALIDE', 'INDISPONIBLE'].includes(e.code)) return repondreErreur(res, e.code, undefined, { detail: e.detail }, e.statut);
    journal(ou, e); return repondreErreur(res, 'INDISPONIBLE');
}
const refuse = (res, detail, statut) => repondreErreur(res, 'ENTREE', undefined, { detail }, statut);
const porteurDe = req => (req.v2 && req.v2.porteur ? `${req.v2.porteur.type}:${req.v2.porteur.id}` : null);
const aucunAutre = (q, permis) => Object.keys(q || {}).every(k => permis.includes(k));
const cleStr = (o, permises) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => permises.includes(k));

function monter(router, cfg, seaux) {
    const parPorteur = (nom, max) => L.limiteur({ nom, max, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
    const cadence = parPorteur('banc-seau', 1200), cadencePhoto = parPorteur('banc-seau-photo', 6000);       // 700 scans de 8 photos au plus par jour : 6 000 envois par heure suffisent
    const base = [resoudrePorteur(cfg), exigerInstallation, exigerAdministrateur, cadence];
    let enCours = 0; const porteurs = new Map();

    router.post('/api/banc/seau/declarer', ...base, async (req, res) => {
        const b = req.body;
        if (!cleStr(b, ['nom', 'type', 'cible', 'note'])) return refuse(res, 'corps');
        try { const s = await seaux.declarer({ nom: b.nom, type: b.type, cible: b.cible, note: b.note, par: porteurDe(req) }); return res.status(201).json({ success: true, seau: s }); }
        catch (e) { return repondre(res, e, 'declarer'); }
    });
    router.get('/api/banc/seau/courant', ...base, async (req, res) => {
        try { return res.status(200).json({ success: true, seau: await seaux.courant() }); } catch (e) { return repondre(res, e, 'courant'); }
    });
    router.post('/api/banc/seau/sceller', ...base, async (req, res) => {
        const b = req.body;
        if (!cleStr(b, ['seauId']) || typeof b.seauId !== 'string' || !FORME_SEAU.test(b.seauId)) return refuse(res, 'seau-id');
        try { return res.status(200).json({ success: true, seau: await seaux.sceller(b.seauId) }); } catch (e) { return repondre(res, e, 'sceller'); }
    });
    router.get('/api/banc/seau/verifier', ...base, async (req, res) => {
        const q = req.query || {};
        if (!aucunAutre(q, ['seau', 'relireR2']) || typeof q.seau !== 'string' || !FORME_SEAU.test(q.seau) || (q.relireR2 !== undefined && q.relireR2 !== '1')) return refuse(res, 'seau-id');
        try { return res.status(200).json({ success: true, ...await seaux.verifierChaine(q.seau, { relireR2: q.relireR2 === '1' }) }); } catch (e) { return repondre(res, e, 'verifier'); }
    });
    router.get('/api/banc/seau/a-etiqueter', ...base, async (req, res) => {
        const q = req.query || {};
        if (!aucunAutre(q, ['seau']) || (q.seau !== undefined && (typeof q.seau !== 'string' || !FORME_SEAU.test(q.seau)))) return refuse(res, 'seau-id');
        try { return res.status(200).json({ success: true, ...await seaux.aEtiqueter({ seauId: q.seau, porteur: porteurDe(req) }) }); } catch (e) { return repondre(res, e, 'a-etiqueter'); }
    });
    router.get('/api/banc/seau/photo', ...base, async (req, res) => {
        const q = req.query || {};
        if (!aucunAutre(q, ['scanId', 'photo']) || typeof q.scanId !== 'string' || !FORME_ID.test(q.scanId) || !/^[0-7]$/.test(String(q.photo))) return refuse(res, 'requete');
        try {
            const p = await seaux.lirePhoto({ scanId: q.scanId, index: Number(q.photo), porteur: porteurDe(req) });
            res.setHeader('Content-Type', p.type); res.setHeader('Cache-Control', 'private, max-age=3600'); res.setHeader('Content-Length', String(p.octets.length));
            return res.status(200).end(p.octets);
        } catch (e) { return repondre(res, e, 'photo'); }
    });
    router.post('/api/banc/seau/candidats', ...base, async (req, res) => {
        const b = req.body;
        if (!cleStr(b, ['scanId', 'carte']) || typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return refuse(res, 'corps');
        try { return res.status(200).json({ success: true, ...await seaux.candidats({ scanId: b.scanId, carte: b.carte === undefined ? 0 : b.carte, porteur: porteurDe(req) }) }); } catch (e) { return repondre(res, e, 'candidats'); }
    });
    router.post('/api/banc/seau/verite', ...base, async (req, res) => {
        const b = req.body;
        if (!cleStr(b, ['scanId', 'carte', 'idProduct', 'aucune', 'via']) || typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return refuse(res, 'corps');
        try { return res.status(200).json({ success: true, ...await seaux.saisirVerite({ scanId: b.scanId, carte: b.carte === undefined ? 0 : b.carte, idProduct: b.idProduct, aucune: b.aucune, via: b.via, porteur: porteurDe(req) }) }); } catch (e) { return repondre(res, e, 'verite'); }
    });

    // L'ERRATUM : la seule correction d'une vérité d'un juge SCELLÉ ; ajouté à la chaîne, jamais une réécriture (seau.js).
    router.post('/api/banc/seau/erratum', ...base, async (req, res) => {
        const b = req.body;
        if (!cleStr(b, ['scanId', 'carte', 'idProduct', 'aucune', 'via', 'motif']) || typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return refuse(res, 'corps');
        try { return res.status(200).json({ success: true, ...await seaux.ajouterErratum({ scanId: b.scanId, carte: b.carte === undefined ? 0 : b.carte, idProduct: b.idProduct, aucune: b.aucune, via: b.via, motif: b.motif, porteur: porteurDe(req) }) }); } catch (e) { return repondre(res, e, 'erratum'); }
    });

    // ── les corps BINAIRES : la même discipline que POST /api/banc/photo — tout est jugé AVANT de lire un octet du corps
    const lireBinaire = (nomLimiteur, typesPermis, octetsMax, traiter) => async (req, res) => {
        const refus = (code, detail, statut, extra = {}) => { res.setHeader('Connection', 'close'); return repondreErreur(res, code, undefined, { detail, ...extra }, statut); };
        const porteur = porteurDe(req); if (!porteur) return repondreErreur(res, 'INDISPONIBLE');
        const q = req.query || {};
        if (!aucunAutre(q, ['scanId', 'photo', 'seau', 'annonce'])) return refus('ENTREE', 'champ-inconnu');
        if (typeof q.scanId !== 'string' || !FORME_ID.test(q.scanId)) return refus('ENTREE', 'scan-id');
        if (typeof q.seau !== 'string' || !FORME_SEAU.test(q.seau)) return refus('ENTREE', 'seau-id');
        if (q.annonce !== undefined && (typeof q.annonce !== 'string' || !FORME_SHA.test(q.annonce))) return refus('ENTREE', 'annonce');
        if (q.photo !== undefined && !/^[0-7]$/.test(String(q.photo))) return refus('ENTREE', 'photo');
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!typesPermis.includes(type)) return refus('IMAGE', 'type', 415);
        const cl = req.headers['content-length'];
        if (typeof cl !== 'string' || !/^\d{1,10}$/.test(cl) || Number(cl) === 0) return refus('ENTREE', 'content-length');
        if (Number(cl) > octetsMax) return refus('IMAGE', 'trop-lourde', 413);
        const longueur = Number(cl);
        if (enCours >= PLACES_MAX || (porteurs.get(porteur) || 0) >= PAR_PORTEUR_MAX) return refus('DEBIT', undefined, undefined, { reessayerDans: 2 });
        enCours++; porteurs.set(porteur, (porteurs.get(porteur) || 0) + 1);
        let libre = false; const liberer = () => { if (libre) return; libre = true; enCours--; porteurs.set(porteur, Math.max(0, (porteurs.get(porteur) || 1) - 1)); };
        res.once('close', liberer);
        let octets;
        try { octets = await lireCorpsBorne(req, longueur, DELAI_LECTURE_MS); }
        catch (e) { liberer(); if (e && (e.code === 'LENT' || e.code === 'COUPE')) return; return repondreErreur(res, e && e.code === 'TROP' ? 'IMAGE' : 'ENTREE', undefined, { detail: e && e.code === 'TROP' ? 'trop-lourde' : 'content-length' }, e && e.code === 'TROP' ? 413 : 400); }
        liberer();
        return traiter({ req, res, q, type, octets, porteur, octetsMax });
    };

    const photoOctetsMax = cfg.images.photoExtensionOctetsMax;
    router.post('/api/banc/seau/photo', resoudrePorteur(cfg), exigerInstallation, exigerAdministrateurPhoto, cadencePhoto,
        lireBinaire('photo', PE.TYPES, photoOctetsMax, async ({ res, q, type, octets, porteur }) => {
            // le numéro de photo est jugé avant tout octet lu (400 plus haut serait trop tôt : le corps est déjà annoncé) ; ici il est validé avec le reste
            if (!/^[0-7]$/.test(String(q.photo)) || Number(q.photo) >= PHOTOS_MAX) return repondreErreur(res, 'ENTREE', undefined, { detail: 'photo' });
            // la validation d'image est CELLE de /api/banc/photo (jamais un second analyseur) ; les octets conservés sont les octets REÇUS
            const v = await PE.evaluerOctets(octets, { octetsMax: photoOctetsMax, typeAnnonce: type });
            if (!v.octets) {
                PE.noter(v.cause);
                if (v.cause === 'trop-grosse') return repondreErreur(res, 'IMAGE', undefined, { detail: 'trop-lourde' }, 413);
                if (v.cause === 'format') return repondreErreur(res, 'IMAGE', undefined, { detail: 'type' }, 415);
                if (v.cause === 'illisible' || v.cause === 'dimensions') return repondreErreur(res, 'IMAGE', undefined, { detail: v.cause }, 422);
                if (v.cause === 'occupe') return repondreErreur(res, 'DEBIT', undefined, { reessayerDans: 2 });
                return repondreErreur(res, 'INDISPONIBLE');
            }
            try { const r = await seaux.enregistrerPhoto({ scanId: q.scanId, porteur, seauId: q.seau, index: Number(q.photo), octets: v.octets, type, annonce: q.annonce }); return res.status(200).json({ success: true, photo: Number(q.photo), ...r }); }
            catch (e) { return repondre(res, e, 'photo-ecriture'); }
        }));
    router.post('/api/banc/seau/mesures', resoudrePorteur(cfg), exigerInstallation, exigerAdministrateurPhoto, cadencePhoto,
        lireBinaire('mesures', ['application/octet-stream'], MESURES_OCTETS_MAX, async ({ res, q, octets, porteur }) => {
            try { const r = await seaux.enregistrerMesures({ scanId: q.scanId, porteur, seauId: q.seau, octets }); return res.status(200).json({ success: true, ...r }); }
            catch (e) { return repondre(res, e, 'mesures'); }
        }));
}

module.exports = { monter };
