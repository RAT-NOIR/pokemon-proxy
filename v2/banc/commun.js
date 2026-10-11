'use strict';
// UNE définition de ce que le banc réel partage entre l'écriture (routes.js), le balayage d'attente (routes.js) et la purge / l'effacement (purge.js) :
// le jour, le délai borné, « quelles lignes sont échues » et « supprimer l'objet puis la ligne ». Trois copies divergeaient déjà (§21 bis) : la suppression de la ligne
// ne portait pas sa cleR2 chez deux d'entre elles, donc une ligne CONFIRMÉE entre-temps (sa cleR2 a changé) pouvait être supprimée avec sa copie finale orpheline.
const db = require('../db');
const { lireConsentement } = require('./consentement');
const JOUR_MS = 86400e3;
const jourUTC = d => { const t = new Date(d); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); };
const codeDe = e => (e && (e.code || e.name)) || 'erreur';     // jamais e.message : il peut citer une clé ou une URL

/**
 * BANC-12 (tour 1, I-3 ; marge au tour 2) — DES COHORTES MENSUELLES décalées d'UN mois. UNE définition de « le lien contribution ↔ compte est échu » : le jour D, une ligne dont le jour (`le`) est
 * STRICTEMENT antérieur au premier jour du mois de D moins (lien − 2) mois n'est PLUS corrigeable (routes.js, corriger) et est anonymisée par la passe (anonymisation.js) — le même prédicat des deux
 * côtés : aucune ligne n'est à la fois corrigeable et anonymisable. Une contribution du mois M bascule donc au premier instant du mois M + (lien − 1) : entre (lien − 2) et (lien − 1) mois d'âge
 * (avec 12 : entre 10 et 11 mois), et tout un mois de contributions bascule ENSEMBLE (la date de réécriture de l'objet R2 ne dit que le mois de la cohorte). La marge d'un mois absorbe la passe
 * quotidienne, la grâce et l'étalement du plafond par passe : le lien reste STRICTEMENT sous `lien` mois. Mois CALENDAIRES (UTC), plus des mois de 30,5 jours.
 */
const debutMois = (d, decalage = 0) => { const t = new Date(d); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + decalage, 1)); };
const limiteLien = (cfg, maintenant) => debutMois(maintenant, -(cfg.retention.bancLienMois - 2));

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
async function supprimerObjetPuisLigne(stockage, ligne, col, borner, filtre = {}) {
    try { await borner(stockage.supprimer(ligne.cleR2)); }
    catch (e) { console.error(`❌ [v2 banc] objet non supprimé, ligne conservée (${codeDe(e)})`); return 'echec'; }
    try {
        const r = await borner(col().deleteOne({ ...filtre, _id: ligne._id, cleR2: ligne.cleR2 }));
        return r && r.deletedCount === 0 ? 'changee' : 'supprimee';
    } catch (e) { console.error(`❌ [v2 banc] ligne non supprimée après son objet, reprise à la prochaine passe (${codeDe(e)})`); return 'echec'; }
}

/**
 * Le consentement ouvre-t-il la conservation POUR CETTE REQUÊTE ? Valide (B6.1) ET — écrit par ce qu'on autorise — d'une empreinte DIFFÉRENTE de TOUTES les empreintes
 * d'accès du porteur : un jeton de consentement égal à un jeton d'accès (même sha256) donnerait à la ligne la même empreinte que `installations.jetonEmpreinte` et la
 * relierait à l'installation, ou au compte. Pour un compte : toutes ses installations (jetonEmpreinte ET heriteEmpreinte, révoquées comprises) et toutes ses sessions ;
 * pour une installation sans compte : son jetonEmpreinte et son heriteEmpreinte. Sans porteur lisible, ou si une lecture échoue : refus (« je ne sais pas » ne conserve pas).
 * La lecture n'a lieu que sur le chemin rare (consentement valide). Rien n'est dit au client.
 * @returns {Promise<boolean>}
 */
async function consentementAutorise(req, cfg, colFn = n => db.col(n)) {
    try {
        const c = lireConsentement(req && req.body, cfg);
        if (!c.valide) return false;
        const p = req && req.v2 && req.v2.porteur;
        if (!p) return false;
        const acces = new Set();
        const ajouter = x => { if (typeof x === 'string' && x) acces.add(x); };
        if (p.installation) { ajouter(p.installation.jetonEmpreinte); ajouter(p.installation.heriteEmpreinte); }
        if (req.v2.session) ajouter(req.v2.session.tokenEmpreinte);
        if (p.type === 'compte') {
            for (const i of await colFn('installations').find({ compteId: p.id }, { projection: { jetonEmpreinte: 1, heriteEmpreinte: 1 } }).toArray()) { ajouter(i.jetonEmpreinte); ajouter(i.heriteEmpreinte); }
            for (const s of await colFn('sessions').find({ compteId: p.id }, { projection: { tokenEmpreinte: 1 } }).toArray()) ajouter(s.tokenEmpreinte);
        }
        return !acces.has(c.jetonEmpreinte);
    } catch (e) { console.error(`❌ [v2 banc] garde du jeton de consentement non conclue, rien conservé (${codeDe(e)})`); return false; }
}

module.exports = { JOUR_MS, jourUTC, debutMois, codeDe, creerBorner, limiteLien, limiteAttente, lignesEchues, supprimerObjetPuisLigne, consentementAutorise };
