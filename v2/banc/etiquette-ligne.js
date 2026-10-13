'use strict';
// ETIQUETAGE-B — la photo des scans de l'ADMINISTRATEUR et la ligne `banc_lignes` d'une carte ÉTIQUETÉE (source `etiquette-admin`).
// Deux gestes, tous deux appelés par `creerBanc` (routes.js), qui fournit le stockage vérifié (`pret`), le sel et l'horloge :
//   · conserverPhoto : au SCAN, la photo reçue (URL d'annonce, téléchargée par photo-admin.js) devient un WebP au bucket du banc ; sa clé ET son sha256 sont notés dans `analyses.photoBanc` (rien d'autre : pas d'URL) ;
//   · etiquetteAdmin / reprendreEtiquettes : à l'ÉTIQUETAGE (ETIQUETAGE-A a écrit `cartes[i].etiquetteAdmin`), UNE ligne par carte — créée ou mise à jour — qui porte la vérité, la clé et le sha256 de la photo
//     et la réponse d'origine. Une carte non étiquetée n'a pas de vérité : pas de ligne.
// Écrit par ce qu'il AUTORISE : une ligne n'existe que si l'objet qu'elle nomme a été RELU dans le bucket à l'instant de l'écriture ; tout manque (variable absente, bucket injoignable, MongoDB en panne, objet
// disparu, scan sans photo) laisse l'étiquette écrite et la carte « en attente ».
// 🔑 LA MARQUE DE REPRISE (`analyses.bancAttente`) est posée PAR LA ROUTE, dans la MÊME écriture que l'étiquette (etiquette.js) : une panne de MongoDB pendant l'étiquetage ne peut donc pas laisser une ligne
// périmée sans marque. Elle ne tombe que lorsque plus aucune carte de l'analyse n'attend (écriture atomique conditionnée à cet état). La reprise rend à chaque cible l'un de ces états : `ecrit`, ou un état
// TERMINAL qui dit son motif — `sans-photo` (aucune photo apparue 24 h après le scan), `role-retire` (le compte n'est plus administrateur : la photo n'est plus gardée).
// La ligne n'a que les clés de CLES_DOC_ADMIN : aucun compte, aucun scanId, aucune URL, aucun titre, aucun vendeur ; son `_id` est une empreinte salée DISTINCTE de celle des lignes de consentement.
const crypto = require('crypto');
const mongoose = require('mongoose');
const S = require('./stockage');
const { JOUR_MS, jourUTC, creerBorner, codeDe, autresLignesPortent } = require('./commun');

const CLES_DOC_ADMIN = Object.freeze(['_id', 'aucune', 'cleR2', 'etat', 'expireLe', 'le', 'rev', 'reponse', 'sha256', 'source', 'verite', 'versionChaine', 'versionModele']);
const SOURCE = 'etiquette-admin';
const PHOTO_DELAI_MS = 15000, REPRISE_MAX = 200, ATTENTE_PHOTO_MS = JOUR_MS;
const ETATS_FINIS = Object.freeze(['ecrit', 'sans-photo', 'role-retire']);          // les états qui sortent une carte de l'attente
const FORME_ID = /^[0-9a-f]{24}$/i;
const idOk = n => Number.isSafeInteger(n) && n > 0;
const modeleOk = m => (typeof m === 'string' && /^[A-Za-z0-9._:+\/-]{1,80}$/.test(m) ? m : null);   // une version, jamais du texte libre
const sha256Ok = h => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null);

/** La réponse d'ORIGINE de la chaîne pour une carte (la base « Gemini seul » de la mesure) : statut, idProduct affirmé, ids des candidats d'une question, code de la question. Pure. */
function reponseDOrigine(c) {
    const o = c && typeof c === 'object' ? c : {};
    const choix = o.question && Array.isArray(o.question.choix) ? o.question.choix.map(x => x && x.idProduct).filter(idOk) : [];
    return {
        statut: typeof o.statut === 'string' ? o.statut.slice(0, 20) : null,
        idProduct: o.statut === 'identifiee' && idOk(o.idProduct) ? o.idProduct : null,
        candidats: choix,
        questionCode: o.question && typeof o.question.code === 'string' ? o.question.code.slice(0, 30) : null
    };
}

function creerEtiquetteLigne({ cfg, colFn, pret, sel, horloge, borner, cleOk = c => typeof c === 'string' && /^banc-reel\/v2\/[0-9a-f]{32}\.webp$/.test(c) }) {
    const col = () => colFn('banc_lignes'), analyses = () => colFn('analyses');
    const bornerLong = creerBorner(PHOTO_DELAI_MS);
    const echec = (quoi, e) => console.error(`❌ [v2 banc-etiquette-ligne] ${quoi} (${codeDe(e)})`);
    const idLigne = (scanId, carte) => crypto.createHash('sha256').update(`${String(scanId).toLowerCase()}|${carte}|etiquette-admin|${sel()}`).digest('hex');
    const oid = id => new mongoose.Types.ObjectId(String(id));

    /** Au scan : la photo (Buffer d'octets bruts) -> WebP au bucket du banc ; sa clé et son sha256 dans `analyses.photoBanc`. @returns 'ecrit' | 'deja' | 'refuse' | 'indisponible' */
    async function conserverPhoto({ scanId, buffer }) {
        try {
            if (typeof scanId !== 'string' || !FORME_ID.test(scanId)) return 'refuse';
            let t; try { t = await S.traiterPhoto(buffer); } catch { return 'refuse'; }
            if (!sel()) return 'indisponible';
            const s = await bornerLong(pret()); if (!s) return 'indisponible';
            const cle = S.nouvelleCle(false);
            await bornerLong(s.ecrire(cle, t.buffer));
            const sha256 = crypto.createHash('sha256').update(t.buffer).digest('hex');
            let r;
            try { r = await bornerLong(analyses().updateOne({ _id: oid(scanId), photoBanc: { $exists: false } }, { $set: { photoBanc: { cle, sha256 } } })); }
            catch (e) { try { await s.supprimer(cle); } catch { /* le filet des orphelins le reprendra */ } throw e; }
            if (!r || r.matchedCount !== 1) { try { await s.supprimer(cle); } catch { /* idem */ } return 'deja'; }   // analyse disparue, ou une photo déjà notée : l'objet neuf ne survit pas
            return 'ecrit';
        } catch (e) { echec('photo non conservée', e); return 'indisponible'; }
    }

    /** Pose l'état de la carte (si l'étiquette est encore à CE `rev`), puis la marque d'analyse : posée tant qu'une carte attend, retirée ATOMIQUEMENT quand plus aucune n'attend. Au mieux : jamais ne lève. */
    async function marquer(scanId, carte, rev, etat) {
        const chemin = `cartes.${carte}.etiquetteAdmin`;
        try {
            await analyses().updateOne({ _id: oid(scanId), [`${chemin}.rev`]: rev }, { $set: { [`${chemin}.banc`]: etat } });
            if (ETATS_FINIS.includes(etat)) {
                await analyses().updateOne({ _id: oid(scanId), cartes: { $not: { $elemMatch: { etiquetteAdmin: { $exists: true }, 'etiquetteAdmin.banc': { $nin: ETATS_FINIS } } } } }, { $unset: { bancAttente: '' } });
            } else await analyses().updateOne({ _id: oid(scanId) }, { $set: { bancAttente: true } });
        } catch (e) { echec('marque non posée', e); }
    }

    /** À l'étiquetage (et à la reprise) : écrit ou met à jour LA ligne de la carte. @returns 'ecrit' | 'en-attente' | null (aucune étiquette sur cette carte). Ne lève jamais. */
    async function etiquetteAdmin({ scanId, carte = 0 }) {
        let rev = null;
        try {
            if (typeof scanId !== 'string' || !FORME_ID.test(scanId) || !Number.isSafeInteger(carte) || carte < 0) return 'en-attente';
            const an = await borner(analyses().findOne({ _id: oid(scanId) }, { projection: { cartes: 1, photoBanc: 1, versionChaine: 1, versionModele: 1 } }));
            const origine = an && Array.isArray(an.cartes) ? an.cartes[carte] : null;
            const et = origine && origine.etiquetteAdmin;
            if (!et || !Number.isSafeInteger(et.rev)) return null;
            rev = et.rev;
            const fin = async etat => { await marquer(scanId, carte, et.rev, etat); return etat; };
            const cle = an.photoBanc && an.photoBanc.cle;
            if (!cleOk(cle) || !sel()) return fin('en-attente');
            const s = await pret(); if (!s) return fin('en-attente');
            try { const o = await bornerLong(s.lire(cle)); if (!Buffer.isBuffer(o) || !o.length) return fin('en-attente'); }
            catch (e) { echec('photo non relue', e); return fin('en-attente'); }
            const id = idLigne(scanId, carte);
            const sha = sha256Ok(an.photoBanc.sha256);
            const contenu = { verite: idOk(et.idProduct) ? et.idProduct : null, rev: et.rev, versionModele: modeleOk(et.versionModele ?? an.versionModele), versionChaine: modeleOk(et.versionChaine ?? an.versionChaine), ...(sha ? { sha256: sha } : {}) };
            const aucune = typeof et.aucune === 'string' ? et.aucune : null;
            for (let essai = 0; essai < 3; essai++) {
                const existante = await borner(col().findOne({ _id: id }));
                if (!existante) {
                    const now = jourUTC(horloge());
                    const doc = { _id: id, source: SOURCE, etat: 'confirmee', ...contenu, ...(aucune ? { aucune } : {}), reponse: reponseDOrigine(origine), cleR2: cle, le: now, expireLe: new Date(now.getTime() + cfg.retention.bancMois * 30.5 * JOUR_MS) };
                    try { await borner(col().insertOne(doc)); return fin('ecrit'); }
                    catch (e) { if (e && e.code === 11000) continue; throw e; }       // deux étiquettes simultanées : la seconde met à jour
                }
                if (existante.rev >= et.rev) return fin(existante.cleR2 === cle ? 'ecrit' : 'en-attente');   // une étiquette aussi récente est déjà là
                const r = await borner(col().updateOne({ _id: id, etat: 'confirmee', rev: existante.rev }, { $set: { ...contenu, ...(aucune ? { aucune } : {}) }, ...(aucune ? {} : { $unset: { aucune: '' } }) }));
                if (r && r.matchedCount === 1) return fin('ecrit');
                const apres = await borner(col().findOne({ _id: id }));
                if (!apres || apres.etat !== 'confirmee') return fin('en-attente');   // prise par l'anonymisation : on ne la touche pas
            }
            return fin('en-attente');
        } catch (e) {
            echec('ligne non écrite', e);
            // la marque est DÉJÀ posée par la route (même écriture que l'étiquette) ; au mieux, on la repose et on note l'état
            if (rev !== null) await marquer(scanId, carte, rev, 'en-attente');
            return 'en-attente';
        }
    }

    /** Un administrateur qui n'en est plus un : la carte sort de l'attente avec son motif, et la photo n'est plus gardée (ni sur l'analyse, ni au bucket si aucune ligne ne la porte). */
    async function abandonnerPhoto(an) {
        const cle = an.photoBanc && an.photoBanc.cle;
        try { await analyses().updateOne({ _id: an._id }, { $unset: { photoBanc: '' } }); } catch (e) { echec('photo non retirée de l\'analyse', e); return; }
        if (!cleOk(cle)) return;
        try {
            if (await autresLignesPortent(col, cle, undefined, borner)) return;      // une ligne la porte encore : elle suit la vie de ses lignes
            const s = await pret(); if (s) await bornerLong(s.supprimer(cle));
        } catch (e) { echec('objet d\'un ancien administrateur non supprimé (le filet des orphelins le reprendra)', e); }
    }

    /**
     * La reprise (passe quotidienne) : TOUTE analyse marquée `bancAttente`, la moins récemment essayée d'abord (`bancEssaiLe`, puis la plus ancienne) — une cible qui échoue toujours passe au bout de la file
     * après chaque essai, elle ne fait pas mourir de faim les réparables. Bornée à `max` analyses par passe. @returns { ecrites, restantes, terminees }
     */
    async function reprendreEtiquettes({ max = REPRISE_MAX } = {}) {
        const bilan = { ecrites: 0, restantes: 0, terminees: 0 };
        try {
            const now = horloge();
            const liste = await borner(analyses().find({ bancAttente: true }, { projection: { cartes: 1, porteur: 1, photoBanc: 1, creeLe: 1 } }).sort({ bancEssaiLe: 1, creeLe: 1 }).limit(Math.max(1, max)).toArray());
            const ids = liste.map(a => String(a.porteur || '')).filter(p => p.startsWith('compte:') && FORME_ID.test(p.slice(7))).map(p => oid(p.slice(7)));
            const admins = new Set(ids.length ? (await borner(colFn('comptes').find({ _id: { $in: ids }, role: 'administrateur' }, { projection: { _id: 1 } }).toArray())).map(c => `compte:${c._id}`) : []);
            for (const an of liste) {
                try { await analyses().updateOne({ _id: an._id }, { $set: { bancEssaiLe: now } }); } catch (e) { echec('essai non noté', e); }
                const estAdmin = admins.has(String(an.porteur));
                let retire = false;
                for (let i = 0; i < (an.cartes || []).length; i++) {
                    const e = an.cartes[i] && an.cartes[i].etiquetteAdmin;
                    if (!e || ETATS_FINIS.includes(e.banc) || !Number.isSafeInteger(e.rev)) continue;
                    if (!estAdmin) { await marquer(String(an._id), i, e.rev, 'role-retire'); bilan.terminees++; retire = true; continue; }
                    if (!an.photoBanc && an.creeLe instanceof Date && now.getTime() - an.creeLe.getTime() > ATTENTE_PHOTO_MS) { await marquer(String(an._id), i, e.rev, 'sans-photo'); bilan.terminees++; continue; }
                    const r = await etiquetteAdmin({ scanId: String(an._id), carte: i });
                    if (r === 'ecrit') bilan.ecrites++; else bilan.restantes++;
                }
                if (retire) await abandonnerPhoto(an);
            }
        } catch (e) { echec('reprise', e); bilan.restantes++; }
        return bilan;
    }
    return { conserverPhoto, etiquetteAdmin, reprendreEtiquettes, idLigne };
}

module.exports = { creerEtiquetteLigne, reponseDOrigine, CLES_DOC_ADMIN, SOURCE };
