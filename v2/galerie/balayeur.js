'use strict';
// GALERIE — LE BALAYEUR côté API (relectures 1 et 2 : la règle de cycle de vie R2 devient un FILET, pas la garde). Une passe :
//   1. rejoue la file `purges_r2` (les suppressions R2 qui ont échoué : décision de modération, suppression de compte, objet brut) ;
//   2. retire les objets ORPHELINS du bucket privé de plus de 24 h : `galerie/depot/…` sans document de dépôt, `galerie/attente/…` sans art « en-attente » ni « prive » (un art refusé, retiré ou absent ne garde pas son objet d'attente).
// Chaque passe est BORNÉE (`limite` suppressions pour la file, autant pour les orphelins ; une page de 1 000 clés par préfixe, curseur gardé), protégée par un VERROU (une seule passe à la fois, même avec plusieurs
// instances) et JOURNALISÉE (collection `balayages`, conservée 12 mois). Écrit par ce qu'il AUTORISE : une clé n'est supprimée que si elle est vieille ET qu'aucun document vivant ne la désigne.
const G = require('./base');
const F = require('./forme');
const svc = require('./service');

const H24 = 24 * 3600e3, PAGE = 1000, PREFIXES = Object.freeze(['galerie/depot/', 'galerie/attente/']);

async function prendreVerrou(maintenant) {
    try {
        await G.col('etat_balayeur').findOneAndUpdate({ _id: 'verrou', $or: [{ expireLe: { $lte: maintenant } }, { expireLe: { $exists: false } }] },
            { $set: { expireLe: new Date(maintenant.getTime() + 10 * 60e3), prisLe: maintenant } }, { upsert: true });
        return true;
    } catch (e) { if (e && e.code === 11000) return false; throw e; }                 // le verrou existe et n'est pas expiré : une autre passe travaille
}
const rendreVerrou = () => G.col('etat_balayeur').updateOne({ _id: 'verrou' }, { $set: { expireLe: new Date(0) } });

/** Rejoue la file : une entrée disparaît quand l'objet est parti ; sinon `essais` + 1 et elle reste. */
async function rejouerPurges(stockage, bilan, limite) {
    const lot = await G.col('purges_r2').find({}).sort({ le: 1 }).limit(limite).toArray();
    for (const e of lot) {
        try { await stockage.supprimer(e._id); await G.col('purges_r2').deleteOne({ _id: e._id }); bilan.purgesRejouees++; }
        catch (err) { await G.col('purges_r2').updateOne({ _id: e._id }, { $inc: { essais: 1 }, $set: { derniereTentative: new Date() } }); bilan.purgesEchouees++; }
    }
}

const RE_ATTENTE = /^galerie\/attente\/([A-Za-z0-9_-]{16,64}?)(?:-480)?\.webp$/;
async function balayerOrphelins(stockage, bilan, limite, maintenant, ageMs) {
    const curseurs = (await G.col('etat_balayeur').findOne({ _id: 'curseurs' })) || {};
    for (const prefixe of PREFIXES) {
        const cle = prefixe === 'galerie/depot/' ? 'depot' : 'attente';
        const l = await stockage.lister(prefixe, { apres: curseurs[cle] || null, max: PAGE });
        bilan.listes += l.objets.length;
        let complet = true;
        for (const o of l.objets) {
            if (bilan.orphelins + bilan.orphelinsEnFile >= limite) { bilan.limiteAtteinte = true; complet = false; break; }
            const age = maintenant.getTime() - (o.modifie instanceof Date ? o.modifie.getTime() : 0);
            if (age < ageMs) continue;
            if (prefixe === 'galerie/depot/') {
                const doc = await G.col('depots').findOne({ cle: o.cle }, { projection: { _id: 1 } });
                if (doc) continue;
            } else {
                const m = RE_ATTENTE.exec(o.cle);
                const art = m ? await G.col('arts').findOne({ _id: m[1] }, { projection: { etat: 1 } }) : null;
                if (art && (art.etat === 'en-attente' || art.etat === 'prive')) continue;      // une illustration PRIVÉE garde ses objets d'attente : c'est son seul exemplaire
            }
            if (await svc.supprimerOuFile(stockage, o.cle, 'balayage')) bilan.orphelins++; else bilan.orphelinsEnFile++;
        }
        if (complet) curseurs[cle] = l.suivant;                                      // une page finie avance le curseur (null : on repart du début à la prochaine passe)
    }
    await G.col('etat_balayeur').updateOne({ _id: 'curseurs' }, { $set: { depot: curseurs.depot || null, attente: curseurs.attente || null } }, { upsert: true });
}

/** Une passe. Rend { ignoree:true } si une autre passe tient le verrou, sinon le bilan (écrit aussi dans `balayages`). */
async function passe({ stockage, secret = null, maintenant = new Date(), limite = 200, ageMs = H24 }) {
    if (!(await prendreVerrou(maintenant))) return { ignoree: true };
    const debut = Date.now(), bilan = { purgesRejouees: 0, purgesEchouees: 0, orphelins: 0, orphelinsEnFile: 0, listes: 0, limiteAtteinte: false };
    try {
        await rejouerPurges(stockage, bilan, limite);
        await balayerOrphelins(stockage, bilan, limite, maintenant, ageMs);
    } finally { await rendreVerrou(); }
    const dureeMs = Date.now() - debut;
    await G.col('balayages').insertOne({ _id: F.nouvelId(), le: maintenant, ...bilan, dureeMs, conserveJusqua: new Date(maintenant.getTime() + 366 * 86400e3) });
    if (bilan.purgesRejouees || bilan.purgesEchouees || bilan.orphelins || bilan.orphelinsEnFile) console.log(`🧹 [galerie] balayage : ${bilan.purgesRejouees} reprises, ${bilan.purgesEchouees} échecs, ${bilan.orphelins} orphelins retirés${bilan.limiteAtteinte ? ' (limite atteinte)' : ''} en ${dureeMs} ms`);
    return { ignoree: false, ...bilan, dureeMs };
}

/** Le minuteur du serveur : une passe toutes les `intervalleMs` (0 ou absent : aucun). Rend le minuteur (non retenant) ou null. Une erreur de passe est journalisée, jamais fatale. */
function demarrer({ stockage, secret, intervalleMs }) {
    if (!(intervalleMs > 0)) return null;
    let enCours = false;
    const m = setInterval(async () => {
        if (enCours || !G.branche()) return;
        enCours = true;
        try { await passe({ stockage, secret }); } catch (e) { console.error(`❌ [galerie] passe du balayeur en échec (${(e && e.name) || 'erreur'})`); } finally { enCours = false; }
    }, intervalleMs);
    if (typeof m.unref === 'function') m.unref();
    return m;
}
module.exports = { passe, demarrer, H24 };
