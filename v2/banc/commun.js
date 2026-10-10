'use strict';
// UNE définition de ce que le banc réel partage entre l'écriture (routes.js), le balayage d'attente (routes.js) et la purge / l'effacement (purge.js) :
// le jour, le délai borné, « quelles lignes sont échues » et « supprimer l'objet puis la ligne ». Trois copies divergeaient déjà (§21 bis) : la suppression de la ligne
// ne portait pas sa cleR2 chez deux d'entre elles, donc une ligne CONFIRMÉE entre-temps (sa cleR2 a changé) pouvait être supprimée avec sa copie finale orpheline.
const JOUR_MS = 86400e3;
const jourUTC = d => { const t = new Date(d); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); };
const codeDe = e => (e && (e.code || e.name)) || 'erreur';     // jamais e.message : il peut citer une clé ou une URL

/** Une attente bornée : rejette avec le code DELAI après `delaiMs` (le travail sous-jacent n'est pas annulé, son résultat est ignoré). */
function creerBorner(delaiMs) {
    return p => new Promise((res, rej) => {
        const t = setTimeout(() => rej(Object.assign(new Error('délai'), { code: 'DELAI' })), delaiMs); if (t.unref) t.unref();
        Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
    });
}

/** « Plus de 24 h » se lit AU JOUR : `le` est tronqué au jour, donc jamais avant 24 h réelles (de 24 h à 48 h après l'écriture). */
const limiteAttente = maintenant => jourUTC(new Date(maintenant).getTime() - JOUR_MS);

/** Les lignes à supprimer : expirées (`expireLe <= maintenant`) OU en attente de plus de 24 h. `attenteSeulement` : le balayage d'attente (24-48 h). */
function lignesEchues(col, maintenant, borner, { attenteSeulement = false } = {}) {
    const now = new Date(maintenant);
    const attente = { etat: 'attente', le: { $lt: limiteAttente(now) } };
    return borner(col().find(attenteSeulement ? attente : { $or: [{ expireLe: { $lte: now } }, attente] }).toArray());
}

/**
 * L'objet d'abord, la ligne ensuite. La ligne n'est supprimée que si elle porte encore la cleR2 LUE : une ligne confirmée entre la lecture et la suppression
 * (sa cleR2 a changé) n'est JAMAIS supprimée.
 * @returns {Promise<'supprimee'|'changee'|'echec'>} 'echec' : l'objet ou la ligne n'a pas pu être supprimé (la ligne reste, reprise à la prochaine passe) ;
 * 'changee' : la ligne n'est plus celle qu'on a lue, rien n'a été fait d'irréparable.
 */
async function supprimerObjetPuisLigne(stockage, ligne, col, borner) {
    try { await borner(stockage.supprimer(ligne.cleR2)); }
    catch (e) { console.error(`❌ [v2 banc] objet non supprimé, ligne conservée (${codeDe(e)})`); return 'echec'; }
    try {
        const r = await borner(col().deleteOne({ _id: ligne._id, cleR2: ligne.cleR2 }));
        return r && r.deletedCount === 0 ? 'changee' : 'supprimee';
    } catch (e) { console.error(`❌ [v2 banc] ligne non supprimée après son objet, reprise à la prochaine passe (${codeDe(e)})`); return 'echec'; }
}

module.exports = { JOUR_MS, jourUTC, codeDe, creerBorner, limiteAttente, lignesEchues, supprimerObjetPuisLigne };
