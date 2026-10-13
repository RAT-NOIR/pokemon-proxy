'use strict';
// ETIQUETAGE-B — la photo des scans de l'ADMINISTRATEUR et la ligne `banc_lignes` d'une carte ÉTIQUETÉE (source `etiquette-admin`).
// Deux gestes, tous deux appelés par `creerBanc` (routes.js), qui fournit le stockage vérifié (`pret`), le sel et l'horloge :
//   · conserverPhoto : au SCAN, la photo reçue (URL d'annonce, téléchargée par photo-admin.js) devient un WebP au bucket du banc, et sa clé est notée dans `analyses.photoBanc` (rien d'autre : pas d'URL) ;
//   · etiquetteAdmin / reprendreEtiquettes : à l'ÉTIQUETAGE (ETIQUETAGE-A a écrit `cartes[i].etiquetteAdmin`), UNE ligne par carte — créée ou mise à jour — qui porte la vérité, la clé de la photo
//     et la réponse d'origine. Une carte non étiquetée n'a pas de vérité : pas de ligne.
// Écrit par ce qu'il AUTORISE : une ligne n'existe que si l'objet qu'elle nomme a été RELU dans le bucket à l'instant de l'écriture ; tout manque (variable absente, bucket injoignable, objet disparu,
// scan sans photo) laisse l'étiquette écrite et marque la carte « en-attente » (`etiquetteAdmin.banc`, `analyses.bancAttente`) — reprise plus tard, jamais une ligne sans photo présentée comme complète.
// La ligne n'a que les clés de CLES_DOC_ADMIN : aucun compte, aucun scanId, aucune URL, aucun titre, aucun vendeur ; son `_id` est une empreinte salée DISTINCTE de celle des lignes de consentement.
const crypto = require('crypto');
const mongoose = require('mongoose');
const S = require('./stockage');
const { JOUR_MS, jourUTC, creerBorner, codeDe } = require('./commun');

const CLES_DOC_ADMIN = Object.freeze(['_id', 'aucune', 'cleR2', 'etat', 'expireLe', 'le', 'rev', 'reponse', 'source', 'verite', 'versionChaine', 'versionModele']);
const SOURCE = 'etiquette-admin';
const PHOTO_DELAI_MS = 15000, REPRISE_MAX = 200;
const FORME_ID = /^[0-9a-f]{24}$/i;
const idOk = n => Number.isSafeInteger(n) && n > 0;
const modeleOk = m => (typeof m === 'string' && /^[A-Za-z0-9._:+\/-]{1,80}$/.test(m) ? m : null);   // une version, jamais du texte libre

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

    /** Au scan : la photo (Buffer d'octets bruts) -> WebP au bucket du banc ; sa clé dans `analyses.photoBanc`. @returns 'ecrit' | 'deja' | 'refuse' | 'indisponible' */
    async function conserverPhoto({ scanId, buffer }) {
        try {
            if (typeof scanId !== 'string' || !FORME_ID.test(scanId)) return 'refuse';
            let t; try { t = await S.traiterPhoto(buffer); } catch { return 'refuse'; }
            if (!sel()) return 'indisponible';
            const s = await bornerLong(pret()); if (!s) return 'indisponible';
            const cle = S.nouvelleCle(false);
            await bornerLong(s.ecrire(cle, t.buffer));
            let r;
            try { r = await bornerLong(analyses().updateOne({ _id: oid(scanId), photoBanc: { $exists: false } }, { $set: { photoBanc: { cle } } })); }
            catch (e) { try { await s.supprimer(cle); } catch { /* le filet des orphelins le reprendra */ } throw e; }
            if (!r || r.matchedCount !== 1) { try { await s.supprimer(cle); } catch { /* idem */ } return 'deja'; }   // analyse disparue, ou une photo déjà notée : l'objet neuf ne survit pas
            return 'ecrit';
        } catch (e) { echec('photo non conservée', e); return 'indisponible'; }
    }

    async function marquer(scanId, carte, rev, etat) {
        const chemin = `cartes.${carte}.etiquetteAdmin`;
        try {
            await analyses().updateOne({ _id: oid(scanId), [`${chemin}.rev`]: rev }, { $set: { [`${chemin}.banc`]: etat } });
            const an = await analyses().findOne({ _id: oid(scanId) }, { projection: { cartes: 1 } });
            const attente = Boolean(an && Array.isArray(an.cartes) && an.cartes.some(c => c && c.etiquetteAdmin && c.etiquetteAdmin.banc !== 'ecrit'));
            await analyses().updateOne({ _id: oid(scanId) }, attente ? { $set: { bancAttente: true } } : { $unset: { bancAttente: '' } });
        } catch (e) { echec('marque non posée', e); }
    }

    /** À l'étiquetage (et à la reprise) : écrit ou met à jour LA ligne de la carte. @returns 'ecrit' | 'en-attente' | null (aucune étiquette sur cette carte). Ne lève jamais. */
    async function etiquetteAdmin({ scanId, carte = 0 }) {
        try {
            if (typeof scanId !== 'string' || !FORME_ID.test(scanId) || !Number.isSafeInteger(carte) || carte < 0) return 'en-attente';
            const an = await borner(analyses().findOne({ _id: oid(scanId) }, { projection: { cartes: 1, photoBanc: 1, versionChaine: 1, versionModele: 1 } }));
            const origine = an && Array.isArray(an.cartes) ? an.cartes[carte] : null;
            const et = origine && origine.etiquetteAdmin;
            if (!et || !Number.isSafeInteger(et.rev)) return null;
            const fin = async etat => { await marquer(scanId, carte, et.rev, etat); return etat; };
            const cle = an.photoBanc && an.photoBanc.cle;
            if (!cleOk(cle) || !sel()) return fin('en-attente');
            const s = await pret(); if (!s) return fin('en-attente');
            try { const o = await bornerLong(s.lire(cle)); if (!Buffer.isBuffer(o) || !o.length) return fin('en-attente'); }
            catch (e) { echec('photo non relue', e); return fin('en-attente'); }
            const id = idLigne(scanId, carte);
            const contenu = { verite: idOk(et.idProduct) ? et.idProduct : null, rev: et.rev, versionModele: modeleOk(et.versionModele ?? an.versionModele), versionChaine: modeleOk(et.versionChaine ?? an.versionChaine) };
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
        } catch (e) { echec('ligne non écrite', e); return 'en-attente'; }
    }

    /** La reprise (passe quotidienne) : les analyses des administrateurs marquées `bancAttente`. @returns { ecrites, restantes } */
    async function reprendreEtiquettes() {
        const bilan = { ecrites: 0, restantes: 0 };
        try {
            const admins = (await borner(colFn('comptes').find({ role: 'administrateur' }, { projection: { _id: 1 } }).toArray())).map(c => `compte:${c._id}`);
            if (!admins.length) return bilan;
            const liste = await borner(analyses().find({ porteur: { $in: admins }, bancAttente: true }, { projection: { cartes: 1 } }).limit(REPRISE_MAX).toArray());
            for (const an of liste) {
                for (let i = 0; i < (an.cartes || []).length; i++) {
                    const e = an.cartes[i] && an.cartes[i].etiquetteAdmin;
                    if (!e || e.banc === 'ecrit') continue;
                    const r = await etiquetteAdmin({ scanId: String(an._id), carte: i });
                    if (r === 'ecrit') bilan.ecrites++; else bilan.restantes++;
                }
            }
        } catch (e) { echec('reprise', e); bilan.restantes++; }
        return bilan;
    }
    return { conserverPhoto, etiquetteAdmin, reprendreEtiquettes, idLigne };
}

module.exports = { creerEtiquetteLigne, reponseDOrigine, CLES_DOC_ADMIN, SOURCE };
