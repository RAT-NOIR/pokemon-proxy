'use strict';
// SAUVEGARDES — la forme des clés. Une seule définition : le stockage, la rétention et la restauration la lisent ici.
// Tout objet de ce mécanisme vit sous PREFIXE/<base>/<id>/ ; ce qui n'a pas EXACTEMENT cette forme n'est pas à lui (la rétention n'y touche jamais).
const PREFIXE = 'sauvegardes-v2/';
const FORME_BASE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const FORME_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const FORME_OBJET = /^(manifeste|c\d{4})\.rmsav$/;

const pad = n => String(n).padStart(2, '0');
function nouvelId(date, hasard) {
    const d = date;
    const t = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    return `${t}-${hasard}`;
}
/** La date portée par un identifiant (UTC), ou null. */
function dateDeId(id) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{8}$/.exec(String(id));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}
const dossier = (base, id) => `${PREFIXE}${base}/${id}/`;
const cleManifeste = (base, id) => `${dossier(base, id)}manifeste.rmsav`;
const cleCollection = (base, id, i) => `${dossier(base, id)}c${String(i + 1).padStart(4, '0')}.rmsav`;
/** Le contexte authentifié (AAD) d'un objet : un objet ne peut pas se faire passer pour un autre (autre collection, autre sauvegarde, autre base). */
const aadDe = (base, id, objet) => Buffer.from(`rmsav1|${base}|${id}|${objet}`);
/** { id, objet } si la clé a la forme exacte de ce mécanisme pour cette base, sinon null. */
function analyser(base, cle) {
    const t = `${PREFIXE}${base}/`;
    if (typeof cle !== 'string' || !cle.startsWith(t)) return null;
    const reste = cle.slice(t.length).split('/');
    if (reste.length !== 2 || !FORME_ID.test(reste[0]) || !FORME_OBJET.test(reste[1])) return null;
    return { id: reste[0], objet: reste[1] };
}
module.exports = { PREFIXE, FORME_BASE, FORME_ID, nouvelId, dateDeId, dossier, cleManifeste, cleCollection, aadDe, analyser };
