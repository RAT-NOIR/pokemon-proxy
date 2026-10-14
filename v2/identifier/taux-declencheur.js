'use strict';
// TAUX-BCE (B4) — le déclencheur quotidien des taux de change de la BCE. Branché par identifier/monter.js SEULEMENT si V2_TAUX_BCE=1 (défaut : éteint).
//   · au démarrage : une lecture tout de suite si aucun taux n'est en base ou si le plus récent a plus de AGE_MAX_JOURS jours (taux.js::amorcerTaux) — c'est la « graine » d'un service de test neuf ou
//     réveillé après sommeil : aucune copie de données ;
//   · puis une lecture par jour (Paris) après HEURE_LECTURE_PARIS, jamais plus d'une réussie par jour (la marque du jour de taux.js::rafraichirTaux), avec au plus UN réessai espacé d'une heure :
//     deux tentatives ratées le même jour = arrêt jusqu'au jour suivant, au journal (une panne longue reste une panne visible) ;
//   · une seule source : URL_BCE (publique). Le journal dit la date et le nombre de devises, ou le code de l'échec — jamais d'URL ni de message d'erreur.
//   · la minuterie est unref (elle ne retient pas le processus) et s'arrête par arreter().
const T = require('./taux');

const INTERVALLE_MS = 10 * 60 * 1000;            // un coup d'œil toutes les 10 min ; la plupart ne coûtent rien (état en mémoire)
const PAUSE_REESSAI_MS = 3600 * 1000;            // la même pause que la marque du jour (taux.js)
const TENTATIVES_MAX_PAR_JOUR = 2;               // la lecture, puis UN réessai

function demarrerTauxBCE({ fetch = globalThis.fetch, col = null, journal = m => { try { console.warn(`[taux] ${m}`); } catch { /* muet */ } }, maintenant = () => new Date(), intervalleMs = INTERVALLE_MS, pauseMs = PAUSE_REESSAI_MS } = {}) {
    const etat = { jour: null, fini: false, tentatives: 0, apres: 0, enCours: false };
    const opts = () => ({ fetch, col, journal, maintenant: maintenant() });

    function suivreLeJour(now) {
        const p = T.parisDe(now);
        if (etat.jour !== p.jour) Object.assign(etat, { jour: p.jour, fini: false, tentatives: 0, apres: 0 });
        return p;
    }
    async function lectureDuJourFaite(c, jour) {
        const doc = await (c || require('../db').col('taux')).findOne({ devise: { $ne: T.MARQUE }, date: jour });
        return Boolean(doc);
    }
    // Une passe : décide, en mémoire d'abord, s'il y a lieu de lire. Ne lève jamais.
    async function passe() {
        if (etat.enCours) return { lu: false, raison: 'passe en cours' };
        etat.enCours = true;
        try {
            const now = maintenant();
            const { jour, heure } = suivreLeJour(now);
            if (etat.fini) return { lu: false, raison: 'déjà lu aujourd\'hui' };
            if (etat.tentatives >= TENTATIVES_MAX_PAR_JOUR) return { lu: false, raison: 'arrêt jusqu\'au jour suivant' };
            if (heure < T.HEURE_LECTURE_PARIS) return { lu: false, raison: 'avant l\'heure de lecture' };
            if (now.getTime() < etat.apres) return { lu: false, raison: 'réessai pas encore dû' };
            if (await lectureDuJourFaite(col, jour)) { etat.fini = true; return { lu: false, raison: 'taux du jour déjà en base' };  }
            etat.tentatives++;
            const r = await T.rafraichirTaux(opts());
            if (r.lu) etat.fini = true;
            else {
                etat.apres = now.getTime() + pauseMs;
                if (etat.tentatives >= TENTATIVES_MAX_PAR_JOUR) { try { journal(`taux de la BCE : ${etat.tentatives} tentatives ratées aujourd'hui (${r.raison}), arrêt jusqu'au jour suivant`); } catch { /* muet */ } }
            }
            return r;
        } catch (e) { try { journal(`passe des taux impossible : ${(e && (e.code || e.name)) || 'erreur'}`); } catch { /* muet */ } return { lu: false, raison: 'erreur' }; }
        finally { etat.enCours = false; }
    }

    const handle = { minuteur: null, amorce: null, passe, arreter() { if (handle.minuteur) { clearInterval(handle.minuteur); handle.minuteur = null; } } };
    // Démarrage : la graine d'abord, puis la passe (si l'heure est passée et que le jour n'est pas lu). Sans attendre : le serveur écoute avant.
    // Une graine ratée APRÈS l'heure de lecture compte comme la première tentative du jour (sinon la passe suivante la rejouerait sans pause) ; avant l'heure, elle ne mange pas le budget de 16 h.
    handle.amorce = (async () => {
        try {
            const now = maintenant();
            const r = await T.amorcerTaux({ ...opts(), maintenant: now });
            const { heure } = suivreLeJour(now);
            if (r && r.lu === false && r.raison !== T.RAISON_RECENT && heure >= T.HEURE_LECTURE_PARIS) { etat.tentatives++; etat.apres = now.getTime() + pauseMs; }
        } catch { /* amorcerTaux ne lève pas */ }
        return passe();
    })();
    handle.minuteur = setInterval(() => { passe(); }, intervalleMs);
    handle.minuteur.unref();
    return handle;
}

let actif = null;
function arreterTaux() { if (actif) { actif.arreter(); actif = null; } }
// Appelé par identifier/monter.js : rien sans V2_TAUX_BCE=1 ; en banc (BANC_ISOLE=1) aucune lecture réelle sans fetch injecté (deps.tauxBce).
function demarrerPourConfig(cfg, options = {}, env = process.env) {
    arreterTaux();                                                   // un seul déclencheur par processus, même si le montage est refait
    if (!cfg || cfg.tauxBce !== true) return null;
    if (env.BANC_ISOLE === '1' && typeof options.fetch !== 'function') return null;
    actif = demarrerTauxBCE(options);
    return actif;
}

module.exports = { demarrerTauxBCE, demarrerPourConfig, arreterTaux, INTERVALLE_MS, PAUSE_REESSAI_MS, TENTATIVES_MAX_PAR_JOUR };
