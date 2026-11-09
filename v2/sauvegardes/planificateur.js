'use strict';
// SAUVEGARDES — le déclenchement, DANS le service (aucun service Render de plus : l'instance de l'essai s'endort sans trafic, elle sauvegarde quand elle est réveillée).
// Au démarrage (différé) puis toutes les heures : on regarde l'âge de la dernière sauvegarde RÉUSSIE (un manifeste écrit) ; à partir de 23 h, on en lance une, sous le bail (une seule instance exporte).
// Un échec n'est JAMAIS silencieux (une ligne au niveau erreur : un CODE, jamais une donnée ni un identifiant) et ne lève JAMAIS (le service ne meurt pas pour une sauvegarde).
const { PREFIXE, analyser, dateDeId } = require('./chemins');
const { exporterBase, NOM_BAIL } = require('./export');
const { creerBail } = require('./bail');
const { appliquerRetention } = require('./retention');

const SEUIL_MS = 23 * 3600e3, INTERVALLE_MS = 3600e3, DIFFERE_MS = 2 * 60e3, BATTEMENT_MS = 30000, TTL_MS = 90000;
const code = e => String((e && (e.code || e.name)) || 'erreur').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'erreur';

/** La dernière sauvegarde RÉUSSIE de cette base : le manifeste le plus récent. @returns {Promise<{id:string,date:Date}|null>} */
async function derniereSauvegarde({ stockage, base }) {
    const ids = (await stockage.lister(`${PREFIXE}${base}/`)).map(o => analyser(base, o.cle)).filter(a => a && a.objet === 'manifeste.rmsav').map(a => a.id).sort();
    const id = ids[ids.length - 1];
    return id ? { id, date: dateDeId(id) } : null;
}

async function tourSauvegarde({ cfg, db, stockage, commit = null, maintenant = () => new Date(), etatMongo, colBail = null, exporter = exporterBase, retention = appliquerRetention, journal = console.error, minuteurs = { setInterval, clearInterval } }) {
    let bail = null, minuteur = null;
    try {
        if (!etatMongo || etatMongo() !== 1) return 'mongo-pas-pret';
        if (!db || db.databaseName !== cfg.base) { journal('❌ [v2 sauvegardes] la base connectée n\'est pas celle de la configuration (base-differente) : rien n\'est exporté'); return 'base-differente'; }
        const recente = async () => { const d = await derniereSauvegarde({ stockage, base: cfg.base }); return d && +maintenant() - +d.date < SEUIL_MS; };
        if (await recente()) return 'recente';
        bail = creerBail({ col: colBail || db.collection(NOM_BAIL), ttlMs: TTL_MS, maintenant });
        if (!(await bail.prendre())) { bail = null; return 'occupe'; }
        // l'autre instance a pu finir entre notre lecture et notre prise : on relit sous le bail
        if (await recente()) return 'recente';
        let perdu = false;
        minuteur = minuteurs.setInterval(() => { bail.battre().then(ok => { if (!ok) perdu = true; }, () => { perdu = true; }); }, BATTEMENT_MS);
        if (minuteur && minuteur.unref) minuteur.unref();
        await stockage.verifierMarqueur();
        await exporter({ db, stockage, cle: cfg.cle, base: cfg.base, commit, maintenant: maintenant(), battement: async () => !perdu });
        try { await retention({ stockage, cle: cfg.cle, base: cfg.base, maintenant: maintenant() }); }
        catch (e) { journal(`❌ [v2 sauvegardes] rétention échouée (${code(e)}) : la sauvegarde est faite`); }
        return 'faite';
    } catch (e) {
        try { journal(`❌ [v2 sauvegardes] sauvegarde échouée (${code(e)})`); } catch { /* le journal lui-même ne doit jamais tuer le service */ }
        return 'echec';
    } finally {
        if (minuteur) minuteurs.clearInterval(minuteur);
        if (bail) { try { await bail.liberer(); } catch { /* le bail expire seul (trois battements) */ } }
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
module.exports = { tourSauvegarde, derniereSauvegarde, demarrer, arreter, SEUIL_MS, INTERVALLE_MS, DIFFERE_MS };
