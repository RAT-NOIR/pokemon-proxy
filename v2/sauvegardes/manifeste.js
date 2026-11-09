'use strict';
// SAUVEGARDES — ce qu'est une sauvegarde VALIDE, en un seul endroit (l'export, la rétention, le planificateur et la restauration le lisent ici : une copie de la règle diverge).
// 🔑 Écrit par ce qu'il EXIGE : un manifeste qui se déchiffre avec la clé, de la bonne base et du bon identifiant, qui liste AU MOINS une collection, dont `comptes` PRÉSENTE ET NON VIDE, dont chaque objet listé
// existe à la taille annoncée. Une sauvegarde sans collection (`[].every` rend vrai) ou sans comptes n'est jamais valide : trois exports vides de suite ne doivent pas effacer une vraie sauvegarde.
// Le NOM d'un objet ne décide jamais de rien : « la dernière sauvegarde » est celle dont le manifeste a été réellement déchiffré et vérifié. Un identifiant daté de plus d'une heure dans le FUTUR est ignoré.
const { PREFIXE, analyser, dateDeId, cleManifeste, aadDe } = require('./chemins');
const { dechiffrerVersBuffer } = require('./chiffrement');

const COLLECTIONS_EXIGEES = Object.freeze(['comptes']);
// La SEULE collection qu'on peut choisir de ne pas sauvegarder : `references_image`, un index reconstructible (retiré de la production le 18/10), 387 Mo sur 447 dans l'essai. Liste fermée EN DUR dans le code :
// ni variable, ni fichier ne l'allonge ; un autre nom est une configuration refusée (config.js) et un export refusé (export.js).
const EXCLUSIONS_PERMISES = Object.freeze(['references_image']);
const FUTUR_MAX_MS = 3600e3;
const HEX64 = /^[0-9a-f]{64}$/;

/** { ok, raison } — la structure d'un manifeste déchiffré. */
function structure(m, base, id) {
    if (!m || typeof m !== 'object' || m.version !== 1 || m.id !== id || m.base !== base) return { ok: false, raison: 'manifeste-incoherent' };
    if (!Array.isArray(m.collections) || m.collections.length === 0) return { ok: false, raison: 'manifeste-sans-collection' };
    if (m.exclues !== undefined && (!Array.isArray(m.exclues) || m.exclues.some(n => !EXCLUSIONS_PERMISES.includes(n)))) return { ok: false, raison: 'manifeste-incoherent' };
    for (const c of m.collections) {
        if (!c || typeof c.nom !== 'string' || typeof c.objet !== 'string' || !/^c\d{4}\.rmsav$/.test(c.objet) || !Number.isInteger(c.documents) || c.documents < 0 || !HEX64.test(String(c.sha256Clair)) || !Number.isInteger(c.octetsChiffres) || c.octetsChiffres <= 0)
            return { ok: false, raison: 'manifeste-incoherent' };
    }
    for (const nom of COLLECTIONS_EXIGEES) { const c = m.collections.find(x => x.nom === nom); if (!c) return { ok: false, raison: `collection-exigee-absente` }; if (c.documents === 0) return { ok: false, raison: 'collection-exigee-vide' }; }
    return { ok: true };
}

/** Les objets de la liste regroupés par identifiant (seules les clés de la forme exacte du mécanisme). @returns {Map<string, {cle:string,octets:number,objet:string}[]>} */
function grouper(base, liste) {
    const g = new Map();
    for (const o of liste) { const a = analyser(base, o.cle); if (!a) continue; if (!g.has(a.id)) g.set(a.id, []); g.get(a.id).push({ cle: o.cle, octets: o.octets, objet: a.objet }); }
    return g;
}

/** Le manifeste déchiffré et VÉRIFIÉ de la sauvegarde `id`, ou null. Ne lève jamais pour une sauvegarde invérifiable. */
async function verifier({ stockage, cle, base, id, objets }) {
    try {
        const m = JSON.parse((await dechiffrerVersBuffer(await stockage.lire(cleManifeste(base, id)), { cle, aad: aadDe(base, id, 'manifeste.rmsav'), max: 16 * 1024 * 1024 })).toString('utf8'));
        if (!structure(m, base, id).ok) return null;
        return m.collections.every(c => { const o = objets.find(x => x.objet === c.objet); return o && o.octets === c.octetsChiffres; }) ? m : null;
    } catch { return null; }
}

/** Les sauvegardes de cette base qui ont un manifeste PAR LEUR NOM, les plus récentes d'abord, sans celles datées de plus d'1 h dans le futur. */
function candidates(base, liste, maintenant) {
    const g = grouper(base, liste);
    return [...g.keys()].filter(id => g.get(id).some(o => o.objet === 'manifeste.rmsav') && +dateDeId(id) <= +maintenant + FUTUR_MAX_MS).sort().reverse().map(id => ({ id, date: dateDeId(id), objets: g.get(id) }));
}

/** La dernière sauvegarde dont le manifeste est réellement déchiffré et vérifié. `depuisMs` (facultatif) : ne regarde que celles plus récentes que cette limite (les autres ne peuvent pas la contredire). @returns {Promise<{id,date,manifeste}|null>} */
async function derniereVerifiable({ stockage, cle, base, maintenant = new Date(), depuis = null }) {
    const liste = await stockage.lister(`${PREFIXE}${base}/`);
    for (const c of candidates(base, liste, maintenant)) {
        if (depuis !== null && +c.date < +depuis) break;
        const manifeste = await verifier({ stockage, cle, base, id: c.id, objets: c.objets });
        if (manifeste) return { id: c.id, date: c.date, manifeste };
    }
    return null;
}
module.exports = { structure, grouper, verifier, candidates, derniereVerifiable, COLLECTIONS_EXIGEES, EXCLUSIONS_PERMISES, FUTUR_MAX_MS };
