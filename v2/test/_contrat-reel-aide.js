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
for (const [chemin, ops] of Object.entries(SCHEMA.paths)) for (const m of METHODES) if (ops[m]) OPERATIONS.push({ route: `${m.toUpperCase()} ${chemin}`, chemin, methode: m.toUpperCase(), op: ops[m] });
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
    // un corps d'erreur est TOUJOURS jugé contre ReponseErreur (ruling 2), même quand la route documente un oneOf
    if (json && json.success === false) for (const e of valider(json, ref('ReponseErreur'), SCHEMA).erreurs) ecarts.push({ chemin: e.chemin, message: `(ReponseErreur) ${e.message}` });
    return ecarts;
}
function consigner(route, etat, rep) {
    const ecarts = juger(route, rep.statut, rep.json, rep.texte, rep.entetes);
    grandLivre.push({ route, etat, statut: rep.statut, json: rep.json, entetes: rep.entetes || {}, ecarts });
    return rep;
}
// Une réponse hors contrat (route servie mais absente de `paths`) : jugée seulement comme erreur si elle en est une.
function consignerHorsContrat(route, etat, rep) {
    const ecarts = [];
    if (rep.json && rep.json.success === false) for (const e of valider(rep.json, ref('ReponseErreur'), SCHEMA).erreurs) ecarts.push({ chemin: e.chemin, message: `(ReponseErreur) ${e.message}` });
    grandLivre.push({ route, etat, statut: rep.statut, json: rep.json, entetes: rep.entetes || {}, ecarts, horsContrat: true });
    return rep;
}
const codeDe = e => (e.json && e.json.erreur && e.json.erreur.code) || null;
module.exports = { SCHEMA, ref, OPERATIONS, STATUTS_DOCUMENTES, grandLivre, consigner, consignerHorsContrat, juger, reponseDocumentee, codeDe };
