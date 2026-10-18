'use strict';
// Aide du banc B7b.1 (pas un banc : le préfixe _ l'écarte du lanceur). Le GRAND LIVRE des réponses réelles et leur validation contre le contrat publié.
// Une réponse y entre par `consigner(route, etat, reponse)` : elle est jugée contre le schéma que `paths` documente pour CE statut de CETTE route
// (statut non documenté = écart ; corps non JSON = écart ; corps d'erreur toujours jugé aussi contre ReponseErreur). Rien ici n'écrit en base, rien ne touche le réseau.
const fs = require('fs'), path = require('path');
const { valider } = require('../openapi/valider');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'openapi.v2.json'), 'utf8'));
const ref = n => ({ $ref: `#/components/schemas/${n}` });

// ── les opérations du contrat, DÉRIVÉES de `paths` (jamais une liste en dur)
const METHODES = ['get', 'post', 'put', 'delete', 'patch'];
const OPERATIONS = [];
// STRIPE-V2 : les opérations de l'étiquette « abonnements » (derrière V2_ABONNEMENTS, avec un faux Stripe) sont jouées état par état par test-abonnements-routes.js, qui contrôle LUI-MÊME que chaque statut
// documenté est joué ou déclaré non joué, et valide chaque réponse contre ce même schéma ; ce banc-ci ne monte pas ce drapeau.
const JUGEES_AILLEURS = op => (op.tags || []).includes('abonnements');
for (const [chemin, ops] of Object.entries(SCHEMA.paths)) for (const m of METHODES) if (ops[m] && !JUGEES_AILLEURS(ops[m])) OPERATIONS.push({ route: `${m.toUpperCase()} ${chemin}`, chemin, methode: m.toUpperCase(), op: ops[m] });
// les statuts documentés de chaque opération : (route, statut)
const STATUTS_DOCUMENTES = OPERATIONS.flatMap(o => Object.keys(o.op.responses || {}).map(s => ({ route: o.route, statut: Number(s) })));

const grandLivre = [];                                   // { route, etat, statut, json, entetes, ecarts:[{chemin,message}] }
function reponseDocumentee(route, statut) {
    const [m, c] = route.split(' ');
    const op = SCHEMA.paths[c] && SCHEMA.paths[c][m.toLowerCase()];
    return op && op.responses ? op.responses[String(statut)] : undefined;
}
function juger(route, statut, json, texte, entetes) {
    const ecarts = [];
    const doc = reponseDocumentee(route, statut);
    if (!doc) ecarts.push({ chemin: '$', message: `statut ${statut} non documenté pour cette route` });
    else if (doc.content && doc.content['application/json']) {
        if (json === null) ecarts.push({ chemin: '$', message: 'corps non JSON' });
        else for (const e of valider(json, doc.content['application/json'].schema, SCHEMA).erreurs) ecarts.push(e);
        if (!/application\/json/i.test(String((entetes || {})['content-type'] || ''))) ecarts.push({ chemin: '(en-tête)', message: `Content-Type ${JSON.stringify((entetes || {})['content-type'])} n'est pas application/json` });
    } else if (String(texte || '') !== '') ecarts.push({ chemin: '$', message: 'le contrat documente ce statut sans corps, le serveur en rend un' });
    // M2 : `Retry-After` est vérifié quand le schéma le déclare. Une erreur qui porte `reessayerDans` doit porter l'en-tête, de la même valeur, et la valeur doit tenir le schéma de l'en-tête.
    if (doc && doc.headers && doc.headers['Retry-After']) {
        const h = (entetes || {})['retry-after'], dit = json && json.erreur && json.erreur.reessayerDans;
        if (h !== undefined) {
            if (!/^\d+$/.test(String(h)) || valider(Number(h), doc.headers['Retry-After'].schema, SCHEMA).erreurs.length) ecarts.push({ chemin: '(en-tête Retry-After)', message: `valeur « ${h} » hors du schéma de l'en-tête` });
            else if (dit !== undefined && String(h) !== String(dit)) ecarts.push({ chemin: '(en-tête Retry-After)', message: `« ${h} » ≠ erreur.reessayerDans (${dit})` });
        } else if (dit !== undefined) ecarts.push({ chemin: '(en-tête Retry-After)', message: `absent alors que erreur.reessayerDans = ${dit} et que le schéma déclare l'en-tête` });
    }
    // un corps d'erreur est TOUJOURS jugé contre ReponseErreur (ruling 2), même quand la route documente un oneOf
    if (json && json.success === false) for (const e of valider(json, ref('ReponseErreur'), SCHEMA).erreurs) ecarts.push({ chemin: e.chemin, message: `(ReponseErreur) ${e.message}` });
    return ecarts;
}
// `garde` : la réponse vient de la boucle de la garde d'index (routes fermées, 503), pas d'un ÉTAT RÉEL de la route : elle ne compte pas comme « route jouée » (tour 1, C1).
function consigner(route, etat, rep, { garde = false } = {}) {
    const ecarts = juger(route, rep.statut, rep.json, rep.texte, rep.entetes);
    grandLivre.push({ route, etat, statut: rep.statut, json: rep.json, entetes: rep.entetes || {}, ecarts, garde });
    return rep;
}

// ── la propriété inverse SYSTÉMATIQUE (tour 1, I3) : les sites de mutation d'une réponse VALIDE, guidés par le schéma.
//    · « retrait » : chaque clé REQUISE présente (à toute profondeur) ;  · « type » : chaque nœud dont le schéma contraint le type / une liste fermée (feuilles ET conteneurs).
//    Un oneOf est résolu sur la branche qui valide la valeur. Un nœud que le schéma ne contraint pas (`{}`) n'est pas un site (compté à part).
const PREFIXE = '#/components/schemas/';
const resoudre = s => { while (s && s.$ref) s = SCHEMA.components.schemas[s.$ref.slice(PREFIXE.length)]; return s; };
function branche(valeur, s) {
    s = resoudre(s);
    if (s && s.oneOf) { const b = s.oneOf.find(x => valider(valeur, x, SCHEMA).ok); return b ? branche(valeur, b) : null; }
    return s;
}
function sitesDeMutation(valeur, schema, chemin = [], sortie = { sites: [], libres: 0 }) {
    const s = branche(valeur, schema); if (!s) return sortie;
    const types = s.type === undefined ? null : [].concat(s.type);
    if (chemin.length) { if (types || s.enum !== undefined || s.const !== undefined) sortie.sites.push({ genre: 'type', chemin, types }); else sortie.libres++; }
    if (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) {
        for (const k of s.required || []) if (Object.prototype.hasOwnProperty.call(valeur, k)) sortie.sites.push({ genre: 'retrait', chemin: [...chemin, k] });
        for (const [k, v] of Object.entries(valeur)) if (s.properties && s.properties[k]) sitesDeMutation(v, s.properties[k], [...chemin, k], sortie);
    } else if (Array.isArray(valeur) && s.items) valeur.slice(0, 3).forEach((v, i) => sitesDeMutation(v, s.items, [...chemin, i], sortie));
    return sortie;
}
const typeDe = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
function intrus(types) {                                   // une valeur dont le type n'est dans AUCUN des types déclarés
    const t = new Set(types || []); if (t.has('integer')) t.add('number');
    if (!types) return { __intrus: 1 };
    for (const c of ['intrus', { __intrus: 1 }, true, 7.5, []]) { const k = typeDe(c); if (!t.has(k) && !(k === 'number' && t.has('integer') && false)) return c; }
    return '\u0000';
}
function muter(json, site) {
    const c = JSON.parse(JSON.stringify(json));
    let o = c; for (const k of site.chemin.slice(0, -1)) o = o[k];
    const dernier = site.chemin[site.chemin.length - 1];
    if (site.genre === 'retrait') delete o[dernier]; else o[dernier] = intrus(site.types);
    return c;
}
// Une réponse hors contrat (route servie mais absente de `paths`) : jugée seulement comme erreur si elle en est une.
function consignerHorsContrat(route, etat, rep) {
    const ecarts = [];
    if (rep.json && rep.json.success === false) for (const e of valider(rep.json, ref('ReponseErreur'), SCHEMA).erreurs) ecarts.push({ chemin: e.chemin, message: `(ReponseErreur) ${e.message}` });
    grandLivre.push({ route, etat, statut: rep.statut, json: rep.json, entetes: rep.entetes || {}, ecarts, horsContrat: true });
    return rep;
}
const codeDe = e => (e.json && e.json.erreur && e.json.erreur.code) || null;
module.exports = { SCHEMA, ref, OPERATIONS, STATUTS_DOCUMENTES, grandLivre, consigner, consignerHorsContrat, juger, reponseDocumentee, codeDe, sitesDeMutation, muter };
