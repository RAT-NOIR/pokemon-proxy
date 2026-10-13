'use strict';
// ETIQUETAGE-A — POST /api/banc/etiquette : l'administrateur dit « juste » ou corrige la réponse de la chaîne sur SES scans, en 2 s.
// L'étiquette s'écrit dans `analyses.cartes[i].etiquetteAdmin`, À CÔTÉ de la réponse d'origine (statut, idProduct affirmé, candidats, raison), qui n'est jamais modifiée :
// c'est la base « Gemini seul » de la mesure. Aucune image, aucun identifiant nouveau : l'étiquette vit et meurt avec l'analyse (analysesMois, effacement du compte).
// Écrit par ce qu'il AUTORISE :
//   · l'accès : un compte dont le rôle `administrateur` est RELU en base à chaque requête (jamais le seul drapeau du porteur) ; tout le reste est un 404 (la route n'existe pas pour lui) ;
//   · le corps : une liste fermée de champs, des types stricts ; `juste` ne vaut que sur une AFFIRMATION (l'étiquette reprend l'idProduct affirmé) ;
//   · `corrige` : exactement un de `idProduct` (validé au catalogue de l'API, la même lecture que la chaîne) ou `aucune` ;
//   · l'écriture : conditionnelle sur le `rev` lu (jamais lecture puis écriture non gardée) ; la réponse dit `ecrit` ou `rejoue`, jamais un 200 muet.
const mongoose = require('mongoose');
const db = require('../db');
const { repondreErreur } = require('../erreurs');

const CLES = Object.freeze(['scanId', 'carte', 'verdict', 'idProduct', 'aucune', 'rev']);
const VERDICTS = Object.freeze(['juste', 'corrige']);
const AUCUNE = Object.freeze(['pas-une-carte', 'hors-catalogue']);
const FORME_ID = /^[0-9a-f]{24}$/i;
const ESSAIS_MAX = 3;
const REV_MAX = 1000000;
const journal = (quoi, e) => console.error(`❌ [v2 banc-etiquette] ${quoi} (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message : il peut citer une clé ou un identifiant

/** Tout ce qui n'est pas un compte administrateur CONFIRMÉ par la base à l'instant de la requête (rôle retiré depuis, installation non liée, simple installation) reçoit EXACTEMENT
 *  la réponse d'une route qui n'existe pas : `next('route')` sort de cette route et laisse le serveur répondre son 404 natif (mêmes corps et en-têtes ; prouvé par le banc).
 *  (M-2 : `resoudrePorteur` a déjà relu le rôle ; cette seconde lecture est volontaire, défense en profondeur — fenêtre de course réduite, comme `ledger.js`.) */
async function exigerAdministrateur(req, res, next) {
    const p = req.v2 && req.v2.porteur;
    if (!p || p.type !== 'compte' || p.administrateur !== true) return next('route');
    let n;
    try { n = await db.col('comptes').countDocuments({ _id: p.id, role: 'administrateur' }); }
    catch (e) { journal('rôle', e); return repondreErreur(res, 'INDISPONIBLE'); }
    return n > 0 ? next() : next('route');
}

/** { detail } si le corps est refusé, sinon { entree }. Pure. */
function lireCorps(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { detail: 'corps' };
    if (Object.keys(b).some(k => !CLES.includes(k))) return { detail: 'champ-inconnu' };
    if (typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return { detail: 'scan-id' };
    const carte = b.carte === undefined ? 0 : b.carte;
    if (!Number.isSafeInteger(carte) || carte < 0) return { detail: 'carte' };
    if (typeof b.verdict !== 'string' || !VERDICTS.includes(b.verdict)) return { detail: 'verdict' };
    if (!Number.isSafeInteger(b.rev) || b.rev < 1 || b.rev > REV_MAX) return { detail: 'rev' };   // borné : un rev démesuré figerait l'étiquette de la carte (tout rev inférieur serait périmé)
    const aId = 'idProduct' in b, aAucune = 'aucune' in b;
    if (b.verdict === 'juste') {
        if (aId || aAucune) return { detail: 'juste-sans-contenu' };            // « juste » reprend la réponse de la chaîne : rien d'autre ne l'accompagne
        return { entree: { scanId: b.scanId, carte, verdict: 'juste', rev: b.rev } };
    }
    if (aId === aAucune) return { detail: 'id-product-ou-aucune' };               // EXACTEMENT un des deux
    if (aId) {
        if (!Number.isSafeInteger(b.idProduct) || b.idProduct <= 0) return { detail: 'id-product' };
        return { entree: { scanId: b.scanId, carte, verdict: 'corrige', rev: b.rev, idProduct: b.idProduct } };
    }
    if (typeof b.aucune !== 'string' || !AUCUNE.includes(b.aucune)) return { detail: 'aucune' };
    return { entree: { scanId: b.scanId, carte, verdict: 'corrige', rev: b.rev, aucune: b.aucune } };
}

const memeContenu = (e, c) => Boolean(e) && e.verdict === c.verdict && (e.idProduct ?? null) === (c.idProduct ?? null) && (e.aucune ?? null) === (c.aucune ?? null);

/** ETIQUETAGE-B : la ligne du banc réel pour cette carte. L'étiquette est DÉJÀ écrite : quoi qu'il arrive ici (banc absent, panne, exception), elle reste, et la réponse dit `en-attente` (reprise plus tard). */
async function etatDuBanc(deps, scanId, carte) {
    try {
        const b = deps && deps.banc;
        if (!b || typeof b.etiquetteAdmin !== 'function') return 'en-attente';
        return (await b.etiquetteAdmin({ scanId, carte })) === 'ecrit' ? 'ecrit' : 'en-attente';
    } catch (x) { journal('banc', x); return 'en-attente'; }
}

function traiterEtiquette(cfg, deps = {}) {
    let catalogueParDefaut = null;
    const catalogueDe = () => deps.catalogue || (catalogueParDefaut = catalogueParDefaut || require('../identifier/catalogue').creerCatalogue({ cfg }));
    return async function traiterEtiquetteV2(req, res) {
        const porteur = req.v2 && req.v2.porteur;
        if (!porteur) return repondreErreur(res, 'INDISPONIBLE');
        const lu = lireCorps(req.body);
        if (lu.detail) return repondreErreur(res, 'ENTREE', undefined, { detail: lu.detail });
        const e = lu.entree;
        const scanId = new mongoose.Types.ObjectId(e.scanId);                       // une chaîne ne filtre rien : analyses porte un ObjectId
        const chemin = `cartes.${e.carte}.etiquetteAdmin`;
        let catalogueVerifie = false;
        for (let essai = 0; essai < ESSAIS_MAX; essai++) {
            let an;
            try { an = await db.col('analyses').findOne({ _id: scanId, porteur: `${porteur.type}:${porteur.id}` }, { projection: { cartes: 1, versionChaine: 1, versionModele: 1 } }); }
            catch (x) { journal('analyses', x); return repondreErreur(res, 'INDISPONIBLE'); }
            const origine = an && Array.isArray(an.cartes) ? an.cartes[e.carte] : null;
            if (!origine || typeof origine !== 'object') return repondreErreur(res, 'CODE_INVALIDE', 'Scan introuvable');   // scan inconnu, d'un autre porteur ou carte absente : indiscernables
            // le contenu de l'étiquette
            let contenu;
            if (e.verdict === 'juste') {
                if (origine.statut !== 'identifiee' || !Number.isSafeInteger(origine.idProduct)) return repondreErreur(res, 'CONFLIT', 'La réponse de la chaîne n\'est pas une affirmation : corriger est exigé', { detail: 'juste-sans-affirmation' });
                contenu = { verdict: 'juste', idProduct: origine.idProduct };
            } else contenu = e.idProduct !== undefined ? { verdict: 'corrige', idProduct: e.idProduct } : { verdict: 'corrige', aucune: e.aucune };
            // les versions
            const dernier = origine.etiquetteAdmin && Number.isSafeInteger(origine.etiquetteAdmin.rev) ? origine.etiquetteAdmin : null;
            if (dernier) {
                if (e.rev < dernier.rev) return repondreErreur(res, 'CONFLIT', 'Une étiquette plus récente existe', { detail: 'rev-perimee' });
                if (e.rev === dernier.rev) {
                    return memeContenu(dernier, contenu) ? res.status(200).json({ success: true, etat: 'rejoue', rev: e.rev, banc: dernier.banc === 'ecrit' ? 'ecrit' : await etatDuBanc(deps, e.scanId, e.carte) }) : repondreErreur(res, 'CONFLIT', 'Ce rev porte déjà un autre contenu', { detail: 'rev-contredit' });
                }
            }
            // idProduct validé au catalogue AVANT d'écrire (un rejeu n'en a pas besoin)
            if (contenu.idProduct !== undefined && e.verdict === 'corrige' && !catalogueVerifie) {
                let table;
                try { table = await catalogueDe().lire([contenu.idProduct]); }
                catch (x) { journal('catalogue', x); return repondreErreur(res, 'INDISPONIBLE'); }
                if (!(table instanceof Map) || !table.has(contenu.idProduct)) return repondreErreur(res, 'ENTREE', 'idProduct inconnu du catalogue', { detail: 'id-product-inconnu' }, 422);
                catalogueVerifie = true;
            }
            const doc = { ...contenu, rev: e.rev, le: new Date(), versionModele: an.versionModele ?? null, versionChaine: an.versionChaine ?? null };
            // écriture CONDITIONNELLE sur le rev lu : si une autre requête est passée entre-temps, rien n'est écrit et on relit
            const filtre = { _id: scanId, porteur: `${porteur.type}:${porteur.id}`, ...(dernier ? { [`${chemin}.rev`]: dernier.rev } : { [chemin]: { $exists: false } }) };
            let r;
            // ETIQUETAGE-B (I2) : la marque de reprise `bancAttente` est posée DANS LA MÊME écriture que l'étiquette — si MongoDB tombe ensuite pendant l'écriture de la ligne du banc, la reprise connaît
            // quand même cette étiquette ; la marque ne tombe que lorsque la ligne est à jour (v2/banc/etiquette-ligne.js).
            try { r = await db.col('analyses').updateOne(filtre, { $set: { [chemin]: doc, bancAttente: true } }); }
            catch (x) { journal('écriture', x); return repondreErreur(res, 'INDISPONIBLE'); }
            if (r && r.matchedCount === 1) return res.status(200).json({ success: true, etat: 'ecrit', rev: e.rev, banc: await etatDuBanc(deps, e.scanId, e.carte) });
        }
        console.error(`🔴 [v2 banc-etiquette] ${ESSAIS_MAX} écritures conditionnelles perdues d'affilée pour un même scan : rien d'écrit`);
        return repondreErreur(res, 'CONFLIT', 'Écriture concurrente, réessayer', { detail: 'concurrence' });
    };
}

module.exports = { traiterEtiquette, exigerAdministrateur, lireCorps, CLES, VERDICTS, AUCUNE };
