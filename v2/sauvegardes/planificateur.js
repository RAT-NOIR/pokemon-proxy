'use strict';
// SAUVEGARDES — le déclenchement, DANS le service (aucun service Render de plus : l'instance de l'essai s'endort sans trafic, elle sauvegarde quand elle est réveillée).
// Au démarrage (différé) puis toutes les heures : on regarde l'âge de la dernière sauvegarde VÉRIFIÉE (manifeste réellement déchiffré, non vide : manifeste.js — jamais le nom d'un objet) ; à partir de 23 h, on en lance
// une, sous le bail (une seule instance exporte). Un échec n'est JAMAIS silencieux (une ligne au niveau erreur : un CODE, jamais une donnée ni un identifiant) et ne lève JAMAIS (le service ne meurt pas).
// ÉCHECS RÉPÉTÉS : un frein exponentiel (1 h, 2 h, 4 h… plafonné à 12 h) dont l'état — nombre d'échecs, heure du dernier échec, dernier succès — est PERSISTÉ en base (le service s'endort : la mémoire ne suffit pas),
// dans la collection du bail (exclue de l'export). Le bail : `perdu` seulement après un refus explicite ou un silence de plus que son TTL, jamais sur une coupure d'une seconde. SIGTERM : l'export est marqué perdu,
// l'abandon du téléversement en cours se fait, puis le processus sort (code 143) — l'écouteur n'existe que pendant un export.
const { PREFIXE } = require('./chemins');
const { exporterBase, NOM_BAIL } = require('./export');
const { creerBail } = require('./bail');
const { appliquerRetention } = require('./retention');
const { derniereVerifiable } = require('./manifeste');

const SEUIL_MS = 23 * 3600e3, INTERVALLE_MS = 3600e3, DIFFERE_MS = 2 * 60e3, BATTEMENT_MS = 30000, TTL_MS = 90000, FREIN_MAX_MS = 12 * 3600e3, ATTENTE_SIGTERM_MS = 20000;
const ID_ETAT = 'etat';
const code = e => String((e && (e.code || e.name)) || 'erreur').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'erreur';
/** Le délai avant le prochain essai après `n` échecs de suite : 1 h, 2 h, 4 h… plafonné à 12 h. */
const delaiFrein = n => Math.min(3600e3 * 2 ** Math.max(0, n - 1), FREIN_MAX_MS);

/** La dernière sauvegarde VÉRIFIÉE de cette base ({id, date, manifeste}) ou null. */
async function derniereSauvegarde({ stockage, cle, base, maintenant = new Date(), depuis = null }) {
    return derniereVerifiable({ stockage, cle, base, maintenant, depuis });
}

const lireEtat = async (col) => { try { return await col.findOne({ _id: ID_ETAT }); } catch { return null; } };
/** @returns {Promise<boolean>} vrai si l'état est écrit — l'appelant qui ne peut pas écrire une TENTATIVE n'exporte pas. */
async function enregistrer(col, champs, journal) {
    try { await col.updateOne({ _id: ID_ETAT }, { $set: champs }, { upsert: true }); return true; }
    catch (e) { try { journal(`❌ [v2 sauvegardes] état non enregistré (${code(e)})`); } catch { /* sans effet */ } return false; }
}

async function tourSauvegarde({ cfg, db, stockage, commit = null, maintenant = () => new Date(), etatMongo, colBail = null, exporter = exporterBase, retention = appliquerRetention, journal = console.error,
                                minuteurs = { setInterval, clearInterval, setTimeout, clearTimeout }, creerBailFn = creerBail, processus = process, quitter = c => process.exit(c), horloge = Date.now }) {
    let bail = null, minuteur = null, ecouteur = null, arretDemande = false, minuterieArret = null, issue = 'echec';
    let echecsBase = 0, dernierEchecBase;       // les échecs d'AVANT ce tour, une tentative commencée et jamais conclue (l'instance a été tuée : mémoire, OOM) comptée pour un échec
    const col = () => colBail || db.collection(NOM_BAIL);
    const echec = async (e) => {
        try { journal(`❌ [v2 sauvegardes] sauvegarde échouée (${code(e)})`); } catch { /* le journal lui-même ne doit jamais tuer le service */ }
        await enregistrer(col(), { echecs: echecsBase + 1, enCours: false, dernierEchecLe: maintenant() }, journal);
        // les orphelines (envois coupés, sans manifeste) sont retirées aussi après un échec (au bout d'une heure : un envoi plus récent peut être en cours)
        try { await retention({ stockage, cle: cfg.cle, base: cfg.base, maintenant: maintenant(), orphelinesHeures: 1 }); } catch (e2) { try { journal(`❌ [v2 sauvegardes] orphelines non retirées (${code(e2)})`); } catch { /* sans effet */ } }
    };
    try {
        if (!etatMongo || etatMongo() !== 1) return (issue = 'mongo-pas-pret');
        if (!db || db.databaseName !== cfg.base) { journal('❌ [v2 sauvegardes] la base connectée n\'est pas celle de la configuration (base-differente) : rien n\'est exporté'); return (issue = 'base-differente'); }
        const etat = await lireEtat(col());
        // 🔑 UNE TENTATIVE COMMENCÉE ET JAMAIS CONCLUE EST UN ÉCHEC : l'état « en cours » est écrit AVANT l'export ; si l'instance est tuée pendant (mémoire), rien d'autre n'est écrit, et sans cette règle le redémarrage
        // retrouverait l'âge > 23 h et relancerait aussitôt le même export, en boucle. Elle compte donc dans le frein, à l'heure où elle a commencé.
        echecsBase = ((etat && etat.echecs) || 0) + (etat && etat.enCours ? 1 : 0);
        dernierEchecBase = etat ? (etat.enCours ? etat.debutLe : etat.dernierEchecLe) : undefined;
        if (echecsBase > 0 && dernierEchecBase && +maintenant() < +new Date(dernierEchecBase) + delaiFrein(echecsBase)) return (issue = 'frein');
        const recente = async () => !!(await derniereVerifiable({ stockage, cle: cfg.cle, base: cfg.base, maintenant: maintenant(), depuis: new Date(+maintenant() - SEUIL_MS + 1) }));
        try { if (await recente()) return (issue = 'recente'); } catch (e) { await echec(e); return (issue = 'echec'); }
        bail = creerBailFn({ col: col(), ttlMs: TTL_MS, maintenant });
        if (!(await bail.prendre())) { bail = null; return (issue = 'occupe'); }
        if (await recente()) return (issue = 'recente');         // l'autre instance a pu finir entre notre lecture et notre prise : on relit sous le bail
        // la tentative est ÉCRITE avant le premier octet lu ; impossible de l'écrire ⇒ on n'exporte pas
        if (!(await enregistrer(col(), { echecs: echecsBase, enCours: true, debutLe: maintenant(), ...(dernierEchecBase ? { dernierEchecLe: dernierEchecBase } : {}) }, journal))) return (issue = 'echec');
        let perdu = false, dernierOk = horloge();
        const battre = async () => {
            try { const ok = await bail.battre(); if (ok === false) perdu = true; else dernierOk = horloge(); }
            catch { if (horloge() - dernierOk > TTL_MS) perdu = true; }       // une coupure d'une seconde n'est pas une perte ; un silence de plus que le TTL, si (un autre a pu prendre le bail)
        };
        minuteur = minuteurs.setInterval(battre, BATTEMENT_MS); if (minuteur && minuteur.unref) minuteur.unref();
        ecouteur = () => {
            arretDemande = true; perdu = true;
            minuterieArret = minuteurs.setTimeout(() => quitter(143), ATTENTE_SIGTERM_MS); if (minuterieArret && minuterieArret.unref) minuterieArret.unref();
        };
        processus.once('SIGTERM', ecouteur);
        const battement = async () => { if (!perdu && horloge() - dernierOk > TTL_MS) perdu = true; return !perdu; };
        try {
            await stockage.verifierMarqueur();
            await exporter({ db, stockage, cle: cfg.cle, base: cfg.base, commit, maintenant: maintenant(), battement, exclure: cfg.exclure || [] });
        } catch (e) {
            if (arretDemande) { await enregistrer(col(), { echecs: echecsBase, enCours: false }, journal); return (issue = 'arret'); }   // l'abandon du téléversement s'est fait dans le stockage ; un déploiement normal n'est pas un échec
            await echec(e); return (issue = 'echec');
        }
        await enregistrer(col(), { echecs: 0, enCours: false, dernierSuccesLe: maintenant() }, journal);
        try { await retention({ stockage, cle: cfg.cle, base: cfg.base, maintenant: maintenant() }); }
        catch (e) { try { journal(`❌ [v2 sauvegardes] rétention échouée (${code(e)}) : la sauvegarde est faite`); } catch { /* sans effet */ } }
        return (issue = 'faite');
    } catch (e) {
        try { journal(`❌ [v2 sauvegardes] sauvegarde échouée (${code(e)})`); } catch { /* sans effet */ }
        return (issue = 'echec');
    } finally {
        if (minuteur) minuteurs.clearInterval(minuteur);
        if (ecouteur) processus.removeListener('SIGTERM', ecouteur);
        if (bail) { try { await bail.liberer(); } catch { /* le bail expire seul (trois battements) */ } }
        if (minuterieArret) minuteurs.clearTimeout(minuterieArret);
        if (arretDemande) quitter(143);
    }
}

let differe = null, intervalle = null, enCours = false, minuteursEnCours = null;
function arreter() {
    const m = minuteursEnCours || global;
    if (differe) { m.clearTimeout(differe); differe = null; }
    if (intervalle) { m.clearInterval(intervalle); intervalle = null; }
    minuteursEnCours = null;
}
/** UN différé et UN intervalle par processus, aucun ne retient le processus (unref) ; deux tours ne se chevauchent jamais dans une même instance. */
function demarrer({ tour, minuteurs = global, differeMs = DIFFERE_MS, intervalleMs = INTERVALLE_MS }) {
    arreter(); minuteursEnCours = minuteurs;
    const passe = async () => { if (enCours) return; enCours = true; try { await tour(); } catch { /* tour ne lève pas ; double sécurité */ } finally { enCours = false; } };
    differe = minuteurs.setTimeout(passe, differeMs); if (differe && differe.unref) differe.unref();
    intervalle = minuteurs.setInterval(passe, intervalleMs); if (intervalle && intervalle.unref) intervalle.unref();
    return intervalle;
}
module.exports = { tourSauvegarde, derniereSauvegarde, demarrer, arreter, delaiFrein, SEUIL_MS, INTERVALLE_MS, DIFFERE_MS, TTL_MS, ID_ETAT, PREFIXE };
