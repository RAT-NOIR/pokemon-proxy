'use strict';
// TAUX-BCE (B4) — le déclencheur quotidien des taux de change de la BCE. Branché par identifier/monter.js SEULEMENT si V2_TAUX_BCE=1 (défaut : éteint).
//   · RIEN ne part tant que la base n'est pas réellement connectée (index.js monte la v2 AVANT mongoose.connect) : le déclencheur attend l'événement de connexion de mongoose, et la minuterie
//     le rejoue ; une attente de la base ne compte JAMAIS comme une tentative.
//   · au démarrage (la « graine » d'un service neuf ou réveillé) : une lecture si aucun taux n'est en base ou si le plus récent a plus de AGE_MAX_JOURS jours (taux.js::amorcerTaux) ;
//   · puis, après HEURE_LECTURE_PARIS, une lecture par jour de Paris. Le jour n'est CLOS que si le fichier lu porte la date du jour de Paris. Un fichier plus ancien (la BCE n'a pas encore publié, week-end,
//     jour férié) est gardé, puis UN réessai une heure plus tard, puis arrêt jusqu'au lendemain : au plus 2 lectures ce jour-là, aucune boucle.
//   · plafonds réels : par processus, 2 requêtes comptées par jour (+ la graine si elle part) ; par base, rafraichirTaux est borné à 3 essais par jour (marque). Une tentative ne se compte que si une
//     requête BCE est partie.
//   · une seule source : URL_BCE (publique). Le journal dit la date et le nombre de devises, ou le code de l'échec — jamais d'URL ni de message d'erreur.
//   · la minuterie est unref (elle ne retient pas le processus) et s'arrête par arreter().
const T = require('./taux');

const INTERVALLE_MS = 10 * 60 * 1000;            // un coup d'œil toutes les 10 min ; la plupart ne coûtent rien (état en mémoire)
const PAUSE_REESSAI_MS = 3600 * 1000;            // la même pause que la marque du jour (taux.js)
const TENTATIVES_MAX_PAR_JOUR = 2;               // la lecture, puis UN réessai

const baseConnectee = () => { try { return require('mongoose').connection.readyState === 1; } catch { return false; } };
const surConnexion = cb => { try { require('mongoose').connection.once('connected', cb); } catch { /* le coup d'œil de la minuterie rattrape */ } };

function demarrerTauxBCE({ fetch = globalThis.fetch, col = null, journal = m => { try { console.warn(`[taux] ${m}`); } catch { /* muet */ } }, maintenant = () => new Date(), intervalleMs = INTERVALLE_MS, pauseMs = PAUSE_REESSAI_MS,
    pret = baseConnectee, quandPret = surConnexion } = {}) {
    const etat = { jour: null, fini: false, tentatives: 0, apres: 0, enCours: false, grainee: false, arrete: false, refusJournal: false };
    const dire = m => { try { journal(m); } catch { /* muet */ } };
    const opts = now => ({ fetch, col, journal, maintenant: now });

    function suivreLeJour(now) {
        const p = T.parisDe(now);
        if (etat.jour !== p.jour) Object.assign(etat, { jour: p.jour, fini: false, tentatives: 0, apres: 0, refusJournal: false });
        return p;
    }
    async function lectureDuJourFaite(jour) {
        const doc = await (col || require('../db').col('taux')).findOne({ devise: { $ne: T.MARQUE }, date: jour });
        return Boolean(doc);
    }
    // Compte le résultat d'une lecture PARTIE. Avant l'heure de lecture, rien ne se compte (la graine ne mange pas le budget de 16 h) ; après, seul un fichier du jour clôt le jour.
    function noter(r, now, jour, heure) {
        if (r.lu && r.date === jour) { etat.fini = true; return; }
        if (heure < T.HEURE_LECTURE_PARIS) return;
        etat.tentatives++; etat.apres = now.getTime() + pauseMs;
        if (etat.tentatives >= TENTATIVES_MAX_PAR_JOUR) {
            dire(r.lu ? `taux de la BCE : fichier du ${r.date}, pas encore celui du jour (${jour}) — arrêt jusqu'au jour suivant`
                      : `taux de la BCE : ${etat.tentatives} requête(s) sans fichier du jour (dernière : ${r.raison}) — arrêt jusqu'au jour suivant`);
        }
    }
    // Une passe : décide, en mémoire d'abord, s'il y a lieu de lire. Ne lève jamais.
    async function passe() {
        if (etat.arrete) return { lu: false, raison: 'arrêté' };
        if (etat.enCours) return { lu: false, raison: 'passe en cours' };
        etat.enCours = true;
        try {
            if (!pret()) return { lu: false, raison: 'base pas prête' };                       // ni lecture ni tentative comptée
            const now = maintenant();
            const { jour, heure } = suivreLeJour(now);
            if (!etat.grainee) {
                const g = await T.amorcerTaux(opts(now));
                if (g.requete) { etat.grainee = true; noter(g, now, jour, heure); }
                else if (g.raison === T.RAISON_RECENT) etat.grainee = true;                   // sinon (base injoignable avant toute requête) : rejouée au prochain coup d'œil
                else return g;
            }
            if (etat.arrete || etat.fini) return { lu: false, raison: 'rien à lire' };
            if (etat.tentatives >= TENTATIVES_MAX_PAR_JOUR) return { lu: false, raison: 'arrêt jusqu\'au jour suivant' };
            if (heure < T.HEURE_LECTURE_PARIS) return { lu: false, raison: 'avant l\'heure de lecture' };
            if (now.getTime() < etat.apres) return { lu: false, raison: 'réessai pas encore dû' };
            if (await lectureDuJourFaite(jour)) { etat.fini = true; return { lu: false, raison: 'taux du jour déjà en base' }; }
            const r = await T.rafraichirTaux(opts(now));
            if (r.essaiRefuse) {                                                              // aucune requête : la marque du jour en base refuse (déjà lu, pause, plafond) — ni tentative ni alarme
                etat.apres = now.getTime() + pauseMs;
                if (!etat.refusJournal) { etat.refusJournal = true; dire('taux de la BCE : aucune requête, essai refusé par la marque du jour en base (déjà lu, pause ou plafond du jour)'); }
            } else if (r.requete) noter(r, now, jour, heure);
            else { etat.apres = now.getTime() + pauseMs; }                                    // panne de base avant toute requête : pas de tentative, réessai plus tard
            return r;
        } catch (e) { dire(`passe des taux impossible : ${(e && (e.code || e.name)) || 'erreur'}`); return { lu: false, raison: 'erreur' }; }
        finally { etat.enCours = false; }
    }

    const handle = { minuteur: null, amorce: null, passe, arreter() { etat.arrete = true; if (handle.minuteur) { clearInterval(handle.minuteur); handle.minuteur = null; } } };
    // Démarrage : sans attendre (le serveur écoute avant). Base pas prête : on attend l'événement de connexion (la minuterie rattrape aussi).
    handle.amorce = passe();
    if (!pret()) quandPret(() => { if (!etat.arrete) handle.amorce = passe(); });
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
