'use strict';
// FREIN-CONSTATES (décision du testeur, 2026-10-17) — le plafond GLOBAL de dépense quotidienne du modèle (OpenRouter), tous porteurs confondus, par jour de PARIS.
// Un document par jour dans la collection `depense_modele` (`_id: 'jour:AAAA-MM-JJ'`, montants en MICRO-dollars ENTIERS : un `$inc` d'entiers ne dérive pas) ; l'incrément est atomique, donc plusieurs
// instances de l'API se voient, et le compte du jour se RELIT en base à chaque appel (un redémarrage ne remet rien à zéro : aucun état n'est gardé en mémoire).
//   · avant chaque appel RÉEL au modèle (`appeler`), le coût ESTIMÉ est RÉSERVÉ d'un seul geste conditionnel : si le compte du jour a déjà atteint le plafond, la réservation échoue et l'appel
//     n'a PAS lieu (aucun appel au fournisseur) ; sinon l'appel part. Deux appels simultanés ne peuvent donc pas franchir le plafond de plus d'UN appel (celui qui le franchit).
//   · après l'appel, la réservation est CORRIGÉE du coût que la réponse rend (`usage.cost`, demandé par `usage: { include: true }`) ; sans coût lisible, l'estimation PRUDENTE reste (V2_COUT_APPEL_ESTIME_USD) ;
//     un appel qui ÉCHOUE (délai, 5xx) a pu être facturé : l'estimation reste aussi.
//   · au PASSAGE du seuil (une fois par jour, posé par une écriture conditionnelle) : une ligne de journal et une alerte en base `alertes` / `alerte/depense-modele` (comme `alerte/archive-visuels`).
//   · une garde s'écrit par ce qu'elle AUTORISE : si le compte ne se lit pas ou ne s'écrit pas, l'appel n'a pas lieu (échec FERMÉ) et la cause est dite.
const db = require('../db'); const Of = require('./offre');
const ALERTE_ID = 'alerte/depense-modele';
const CODE = 'DEPENSE_MODELE_PLAFOND';          // le code de l'erreur levée à la place de l'appel (ne ressemble à aucune panne du fournisseur)
const MOTIF = 'depense-modele-plafond';         // le motif interne : jamais servi au client
const MICRO = 1e6;
const versMicro = usd => Math.max(0, Math.round(usd * MICRO));
const dollars = micro => micro / MICRO;
// le coût que la réponse d'OpenRouter rend (`usage.cost`, en dollars) ; tout ce qui n'est pas un nombre fini positif ou nul est « non lu » (null), jamais 0
const coutLu = reponse => { const c = reponse && reponse.data && reponse.data.usage ? reponse.data.usage.cost : undefined; return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null; };
const erreurPlafond = (cause = 'plafond') => Object.assign(new Error('dépense du modèle : appel refusé'), { code: CODE, cause });

/** @param o { cfg, col?, maintenant?, journal? } — `col(nom)` rend une collection (défaut : celle de la base de l'API) ; `maintenant()` rend l'instant ; `journal` : { warn, error }. */
function creer({ cfg, col = nom => db.col(nom), maintenant = () => new Date(), journal = console } = {}) {
    if (!cfg || !cfg.depenseModele) throw new Error('depense-modele : configuration absente');
    const plafond = versMicro(cfg.depenseModele.jourUsd), estime = versMicro(cfg.depenseModele.appelEstimeUsd);
    if (!(plafond > 0) || !(estime > 0)) throw new Error('depense-modele : plafond ou estimation nuls');
    const compte = { reservations: 0, coupures: 0, passages: 0, coutsLus: 0, coutsEstimes: 0, echecsAppel: 0, erreursBase: 0 };
    const idDe = d => `jour:${Of.jourDeParis(d)}`;
    let alerteVerifieeLe = null;            // le jour pour lequel une alerte d'un jour passé a été résolue (une écriture par jour et par instance)

    async function lire(d = maintenant()) {
        const doc = await col('depense_modele').findOne({ _id: idDe(d) });
        const microUsd = doc && Number.isFinite(doc.microUsd) ? doc.microUsd : 0;
        return { jour: Of.jourDeParis(d), microUsd, usd: dollars(microUsd), appels: doc && Number.isFinite(doc.appels) ? doc.appels : 0, plafondUsd: dollars(plafond), atteint: microUsd >= plafond };
    }
    // Lecture seule : « le modèle peut-il encore être appelé aujourd'hui ? ». Échec FERMÉ : un compte illisible refuse.
    async function autorise(d = maintenant()) {
        try { const e = await lire(d); if (e.atteint) { compte.coupures++; return { ok: false, cause: 'plafond', ...e }; } return { ok: true, ...e }; }
        catch (e) { compte.erreursBase++; journal.error(`🔴 [v2 depense-modele] compte du jour illisible (${(e && (e.code || e.name)) || 'erreur'}) — l'appel au modèle n'a pas lieu`); return { ok: false, cause: 'lecture' }; }
    }
    // Un seul geste atomique : $inc CONDITIONNEL au compte du jour sous le plafond. Rend le document d'après, ou null si le plafond est atteint.
    async function reserver(d) {
        const _id = idDe(d), filtre = { _id, microUsd: { $lt: plafond } };
        const maj = { $inc: { microUsd: estime, appels: 1 }, $setOnInsert: { expireLe: new Date(Math.max(d.getTime(), Date.now()) + 5 * 86400e3) } };
        try { return await col('depense_modele').findOneAndUpdate(filtre, maj, { upsert: true, returnDocument: 'after' }); }
        catch (e) {
            if (e.code !== 11000) throw e;     // doublon d'_id : le document existe — soit il est AU plafond (le filtre ne l'a pas pris), soit une première insertion concurrente l'a créé
            return col('depense_modele').findOneAndUpdate(filtre, { $inc: { microUsd: estime, appels: 1 } }, { returnDocument: 'after' });
        }
    }
    async function ajuster(d, delta) {
        if (!delta) return null;
        return col('depense_modele').findOneAndUpdate({ _id: idDe(d) }, { $inc: { microUsd: delta } }, { returnDocument: 'after' });
    }
    // Le PASSAGE du seuil : une seule fois par jour (marqueur `passageLe` posé par une écriture conditionnelle), quelle que soit l'instance et le nombre d'appels simultanés.
    async function signalerSiPasse(d, doc) {
        if (!doc || !(doc.microUsd >= plafond)) return false;
        const pose = await col('depense_modele').updateOne({ _id: idDe(d), passageLe: { $exists: false } }, { $set: { passageLe: d } });
        if (!(pose.modifiedCount > 0)) return false;
        compte.passages++;
        const jour = Of.jourDeParis(d);
        journal.warn(`⚠️ [v2 depense-modele] ${MOTIF} : plafond du jour atteint (${dollars(doc.microUsd).toFixed(4)} $ pour ${dollars(plafond).toFixed(4)} $), jour ${jour} — l'appel au modèle n'a plus lieu jusqu'à minuit de Paris, les scans rendent INDISPONIBLE (remboursés)`);
        try {
            const ancien = await col('alertes').findOne({ _id: ALERTE_ID });
            const depuis = ancien && ancien.active && ancien.jour === jour && ancien.depuis ? ancien.depuis : d;
            await col('alertes').updateOne({ _id: ALERTE_ID }, { $set: { active: true, depuis, constateLe: d, jour, motif: MOTIF, depenseUsd: dollars(doc.microUsd), plafondUsd: dollars(plafond) } }, { upsert: true });
        } catch (e) { journal.error(`🔴 [v2 depense-modele] alerte non écrite (${(e && (e.code || e.name)) || 'erreur'}) : la ligne de journal ci-dessus reste la trace`); }
        return true;
    }
    // Une alerte laissée active par un jour PASSÉ est résolue au premier appel autorisé d'un jour neuf (une écriture par jour et par instance).
    async function resoudreAlerte(d) {
        const jour = Of.jourDeParis(d);
        if (alerteVerifieeLe === jour) return;
        alerteVerifieeLe = jour;
        try { await col('alertes').updateOne({ _id: ALERTE_ID, active: true, jour: { $ne: jour } }, { $set: { active: false, resolueLe: d } }); }
        catch (e) { alerteVerifieeLe = null; journal.error(`🔴 [v2 depense-modele] alerte non résolue (${(e && (e.code || e.name)) || 'erreur'})`); }
    }

    /**
     * L'appel au modèle, SOUS le plafond. `post` est le client (axios.post ou équivalent : post(url, corps, config)). Plafond atteint (ou compte illisible) : `post` n'est PAS appelé, une erreur de code
     * DEPENSE_MODELE_PLAFOND est levée. Sinon la réponse du fournisseur est rendue telle quelle ; son coût est compté. Une erreur du fournisseur est relancée telle quelle (l'estimation reste comptée).
     */
    async function appeler(post, url, corps, config) {
        const d = maintenant();
        let apres;
        try { apres = await reserver(d); }
        catch (e) { compte.erreursBase++; journal.error(`🔴 [v2 depense-modele] compte du jour non écrit (${(e && (e.code || e.name)) || 'erreur'}) — l'appel au modèle n'a pas lieu`); throw erreurPlafond('ecriture'); }
        if (!apres) { compte.coupures++; throw erreurPlafond('plafond'); }
        compte.reservations++;
        await signalerSiPasse(d, apres).catch(() => { });
        await resoudreAlerte(d);
        const avecCout = corps && typeof corps === 'object' && !Array.isArray(corps) && corps.usage === undefined ? { ...corps, usage: { include: true } } : corps;     // OpenRouter ne rend le coût que s'il est demandé
        let reponse;
        try { reponse = await post(url, avecCout, config); }
        catch (e) { compte.echecsAppel++; throw e; }
        const c = coutLu(reponse);
        if (c === null) { compte.coutsEstimes++; return reponse; }                                   // pas de coût lisible : l'estimation prudente reste comptée
        compte.coutsLus++;
        try { const fin = await ajuster(d, versMicro(c) - estime); await signalerSiPasse(d, fin).catch(() => { }); }
        catch (e) { journal.error(`🔴 [v2 depense-modele] coût réel non compté (${(e && (e.code || e.name)) || 'erreur'}) — l'estimation reste`); }
        return reponse;
    }
    // Un client `post` enveloppé : mêmes arguments, mais SOUS le plafond (la seconde lecture, le lecteur du modèle, l'appel de la chaîne).
    const envelopper = post => (url, corps, config) => appeler(post, url, corps, config);

    return { appeler, envelopper, autorise, lire, compteurs: () => ({ ...compte }), plafondUsd: dollars(plafond), estimeUsd: dollars(estime) };
}

// L'instance de PROCESSUS, créée à la demande pour la configuration valide de l'API (index.js racine : V2.depenseModele). Une configuration absente ne coupe rien (v2 éteinte ou invalide : production inchangée).
let defaut = null;
const pourConfig = cfg => { if (!defaut || defaut.cfg !== cfg) defaut = { cfg, instance: creer({ cfg }) }; return defaut.instance; };
const reinitialiserDefaut = () => { defaut = null; };

module.exports = { creer, pourConfig, reinitialiserDefaut, coutLu, ALERTE_ID, CODE, MOTIF };
