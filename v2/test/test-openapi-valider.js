'use strict';
// Le validateur doit SAVOIR DIRE NON (CLAUDE.md §41/§51) : chaque assertion fabrique l'état refusé.
const H = require('./_harnais');
const { valider, verifierSchema } = require('../openapi/valider');

const C = { schemas: {
    Carte: { type: 'object', required: ['statut'], additionalProperties: false, properties: { statut: { enum: ['a', 'b'] }, n: { type: ['string', 'null'] } } },
    Liste: { type: 'object', properties: { cartes: { type: 'array', maxItems: 2, items: { $ref: '#/components/schemas/Carte' } } } },
    Un: { oneOf: [{ type: 'string', pattern: '^a' }, { type: 'string', pattern: 'z$' }] }
} };
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const chemins = r => r.erreurs.map(e => e.chemin);
const leve = f => { try { f(); return null; } catch (e) { return e.message; } };

// le bon cas passe (un validateur qui refuse tout ne prouve rien)
H.v('objet valide', valider({ statut: 'a', n: null }, ref('Carte'), C).ok, true);
H.v('["string","null"] accepte une chaîne', valider({ statut: 'a', n: 'x' }, ref('Carte'), C).ok, true);
H.v('const', valider(2, { const: 2 }, C).ok, true);
H.v('integer', valider(3, { type: 'integer', minimum: 1 }, C).ok, true);

// types
let r = valider('3', { type: 'integer' }, C);
H.v('mauvais type : refusé', r.ok, false);
H.v('mauvais type : chemin racine', chemins(r), ['$']);
H.v('3.5 n\'est pas un integer', valider(3.5, { type: 'integer' }, C).ok, false);
H.v('NaN n\'est pas un number', valider(NaN, { type: 'number' }, C).ok, false);
H.v('null n\'est pas un object', valider(null, { type: 'object' }, C).ok, false);
H.v('un tableau n\'est pas un object', valider([], { type: 'object' }, C).ok, false);
H.v('["string","null"] refuse un nombre', valider({ statut: 'a', n: 4 }, ref('Carte'), C).ok, false);
// required / enum / additionalProperties, avec le chemin
r = valider({}, ref('Carte'), C);
H.v('clé requise absente : chemin', chemins(r), ['$.statut']);
r = valider({ cartes: [{ statut: 'a' }, { statut: 'zzz' }] }, ref('Liste'), C);
H.v('hors enum : chemin profond', chemins(r), ['$.cartes[1].statut']);
r = valider({ statut: 'a', score: 0.97 }, ref('Carte'), C);
H.v('clé en trop refusée (un score)', r.ok, false);
H.v('clé en trop : chemin', chemins(r), ['$.score']);
// tableaux
r = valider({ cartes: [{ statut: 'a' }, { statut: 'a' }, { statut: 'a' }] }, ref('Liste'), C);
H.v('maxItems dépassé', [r.ok, chemins(r)], [false, ['$.cartes']]);
H.v('minItems', valider([], { type: 'array', minItems: 1 }, C).ok, false);
// pattern / minimum
H.v('pattern respecté', valider('abc12345', { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' }, C).ok, true);
H.v('pattern violé', valider('court', { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' }, C).ok, false);
H.v('pattern ne s\'applique qu\'aux chaînes (un nombre est refusé par le type)', valider(5, { type: 'string', pattern: '5' }, C).ok, false);
H.v('minimum violé', valider(0, { type: 'integer', minimum: 1 }, C).ok, false);
H.v('maxLength violé', valider('x'.repeat(61), { type: 'string', maxLength: 60 }, C).ok, false);
H.v('const violé', valider(3, { const: 2 }, C).ok, false);
// oneOf à zéro, un, deux correspondances
H.v('oneOf : une correspondance', valider('abc', ref('Un'), C).ok, true);
r = valider('mmm', ref('Un'), C);
H.v('oneOf : zéro correspondance', [r.ok, /0 correspondance/.test(r.erreurs[0].message)], [false, true]);
r = valider('az', ref('Un'), C);
H.v('oneOf : deux correspondances', [r.ok, /2 correspondances/.test(r.erreurs[0].message)], [false, true]);
// $ref
r = valider({}, ref('Inconnu'), C);
H.v('$ref inconnu : refusé avec le chemin', [r.ok, chemins(r)], [false, ['$']]);
H.v('$ref hors #/components/schemas : refusé', valider({}, { $ref: 'http://exemple.fr/x' }, C).ok, false);
// le document OpenAPI entier est accepté comme « composants »
H.v('composants = document entier', valider({ statut: 'a' }, ref('Carte'), { components: C }).ok, true);
// mots-clés inconnus : LÈVENT (un validateur qui ignore ce qu'il ne comprend pas valide tout)
H.vrai('format lève', /format/.test(leve(() => valider('a@b.fr', { type: 'string', format: 'email' }, C)) || ''));
H.vrai('allOf lève', /allOf/.test(leve(() => valider({}, { allOf: [{ type: 'object' }] }, C)) || ''));
H.vrai('un mot-clé inconnu lève même sous une propriété', /patternProperties/.test(leve(() => valider({ a: 1 }, { type: 'object', properties: { a: { patternProperties: {} } } }, C)) || ''));
// les métadonnées passent
H.v('description / example tolérés', valider(1, { type: 'integer', description: 'd', example: 1, title: 't' }, C).ok, true);
// verifierSchema parcourt TOUT, y compris ce qu'une valeur n'atteint pas
H.vrai('verifierSchema lève sur un mot-clé inconnu dans une branche non atteinte', /format/.test(leve(() => verifierSchema({ schemas: { A: { type: 'object', properties: { x: { type: 'string', format: 'uri' } } } } })) || ''));
H.vrai('verifierSchema lève sur un $ref qui ne résout pas', /Fantome/.test(leve(() => verifierSchema({ schemas: { A: { $ref: '#/components/schemas/Fantome' } } })) || ''));
H.vrai('verifierSchema lève quand required nomme une propriété absente', /requis/.test(leve(() => verifierSchema({ schemas: { A: { type: 'object', required: ['x'], properties: { y: { type: 'string' } } } } })) || ''));
H.v('verifierSchema accepte un schéma sain', leve(() => verifierSchema(C)), null);
H.bilan();
