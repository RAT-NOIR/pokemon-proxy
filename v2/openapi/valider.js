'use strict';
// Validateur d'un sous-ensemble de JSON Schema, SANS DÉPENDANCE. Il sert à prouver que les réponses du serveur et les exemples
// publiés tiennent le contrat (openapi.v2.json). Deux règles qui le rendent utile :
//   1. il SAIT DIRE NON (un champ en trop, un code hors liste, un `score`) ;
//   2. un mot-clé qu'il ne comprend pas LÈVE : un validateur qui ignore ce qu'il ne comprend pas valide tout.
const METADONNEES = new Set(['description', 'title', 'example', 'examples', 'deprecated', '$comment', 'default']);
const MOTS_CLES = new Set(['type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'maxItems',
    'pattern', 'minimum', 'maximum', 'minLength', 'maxLength', '$ref', 'oneOf']);
const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const PREFIXE_REF = '#/components/schemas/';

/** `composants` : le document OpenAPI entier, son objet `components`, ou directement la table des schémas. */
function tableDesSchemas(composants) {
    if (!composants || typeof composants !== 'object') return {};
    if (composants.components && composants.components.schemas) return composants.components.schemas;
    if (composants.schemas && typeof composants.schemas === 'object') return composants.schemas;
    return composants;
}
function typeDe(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;                                   // object | string | number | boolean | undefined
}
function typeConvient(v, t) {
    switch (t) {
        case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
        case 'array': return Array.isArray(v);
        case 'string': return typeof v === 'string';
        case 'number': return typeof v === 'number' && Number.isFinite(v);
        case 'integer': return Number.isInteger(v);
        case 'boolean': return typeof v === 'boolean';
        case 'null': return v === null;
        default: throw new Error(`valider : type inconnu "${t}"`);
    }
}
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cleChemin = (chemin, k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? `${chemin}.${k}` : `${chemin}[${JSON.stringify(k)}]`);

function controlerMotsCles(schema, chemin) {
    for (const k of Object.keys(schema))
        if (!MOTS_CLES.has(k) && !METADONNEES.has(k) && !k.startsWith('x-'))
            throw new Error(`valider : mot-clé non géré "${k}" (${chemin}) — un validateur qui ignore ce qu'il ne comprend pas valide tout`);
}

function validerDans(valeur, schema, table, chemin, erreurs) {
    if (schema === true) return;
    if (schema === false) { erreurs.push({ chemin, message: 'schéma `false` : rien n\'est permis ici' }); return; }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`valider : schéma illisible (${chemin})`);
    controlerMotsCles(schema, chemin);
    if (schema.$ref !== undefined) {
        if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith(PREFIXE_REF) || !Object.prototype.hasOwnProperty.call(table, schema.$ref.slice(PREFIXE_REF.length))) {
            erreurs.push({ chemin, message: `$ref inconnu : ${schema.$ref}` });
            return;
        }
        validerDans(valeur, table[schema.$ref.slice(PREFIXE_REF.length)], table, chemin, erreurs);
        return;
    }
    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        for (const t of types) if (!TYPES.includes(t)) throw new Error(`valider : type inconnu "${t}" (${chemin})`);
        if (!types.some(t => typeConvient(valeur, t))) {
            erreurs.push({ chemin, message: `type attendu ${types.join('|')}, reçu ${typeDe(valeur)}` });
            return;                                    // inutile d'empiler des erreurs de structure sur une valeur du mauvais type
        }
    }
    if (schema.const !== undefined && !egal(valeur, schema.const)) erreurs.push({ chemin, message: `valeur attendue ${JSON.stringify(schema.const)}` });
    if (schema.enum !== undefined) {
        if (!Array.isArray(schema.enum)) throw new Error(`valider : enum doit être un tableau (${chemin})`);
        if (!schema.enum.some(x => egal(x, valeur))) erreurs.push({ chemin, message: `valeur hors liste fermée : ${JSON.stringify(valeur)}` });
    }
    if (typeof valeur === 'string') {
        if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(valeur)) erreurs.push({ chemin, message: `ne respecte pas le motif ${schema.pattern}` });
        if (schema.minLength !== undefined && valeur.length < schema.minLength) erreurs.push({ chemin, message: `trop court (${schema.minLength} au moins)` });
        if (schema.maxLength !== undefined && valeur.length > schema.maxLength) erreurs.push({ chemin, message: `trop long (${schema.maxLength} au plus)` });
    }
    if (typeof valeur === 'number') {
        if (schema.minimum !== undefined && valeur < schema.minimum) erreurs.push({ chemin, message: `inférieur au minimum ${schema.minimum}` });
        if (schema.maximum !== undefined && valeur > schema.maximum) erreurs.push({ chemin, message: `supérieur au maximum ${schema.maximum}` });
    }
    if (Array.isArray(valeur)) {
        if (schema.minItems !== undefined && valeur.length < schema.minItems) erreurs.push({ chemin, message: `${schema.minItems} élément(s) au moins, reçu ${valeur.length}` });
        if (schema.maxItems !== undefined && valeur.length > schema.maxItems) erreurs.push({ chemin, message: `${schema.maxItems} élément(s) au plus, reçu ${valeur.length}` });
        if (schema.items !== undefined) valeur.forEach((x, i) => validerDans(x, schema.items, table, `${chemin}[${i}]`, erreurs));
    }
    if (valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur)) {
        const props = schema.properties || {};
        for (const k of schema.required || []) if (!Object.prototype.hasOwnProperty.call(valeur, k)) erreurs.push({ chemin: cleChemin(chemin, k), message: 'clé requise absente' });
        for (const k of Object.keys(valeur)) {
            if (Object.prototype.hasOwnProperty.call(props, k)) validerDans(valeur[k], props[k], table, cleChemin(chemin, k), erreurs);
            else if (schema.additionalProperties === false) erreurs.push({ chemin: cleChemin(chemin, k), message: 'clé non prévue par le contrat' });
            else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validerDans(valeur[k], schema.additionalProperties, table, cleChemin(chemin, k), erreurs);
        }
    }
    if (schema.oneOf !== undefined) {
        if (!Array.isArray(schema.oneOf) || !schema.oneOf.length) throw new Error(`valider : oneOf doit être un tableau non vide (${chemin})`);
        const essais = schema.oneOf.map(s => { const e = []; validerDans(valeur, s, table, chemin, e); return e; });
        const bonnes = essais.filter(e => e.length === 0).length;
        if (bonnes !== 1) {
            const meilleure = essais.reduce((a, b) => (b.length < a.length ? b : a));
            const indice = bonnes === 0 && meilleure[0] ? ` — la branche la plus proche échoue à ${meilleure[0].chemin} : ${meilleure[0].message}` : '';
            erreurs.push({ chemin, message: `oneOf : ${bonnes} correspondance${bonnes > 1 ? 's' : ''} au lieu d'une seule${indice}` });
        }
    }
}

/** → { ok, erreurs:[{ chemin, message }] }. Le chemin est de la forme `$.analyse.cartes[0].statut`. Lève sur un mot-clé non géré. */
function valider(valeur, schema, composants) {
    const erreurs = [];
    validerDans(valeur, schema, tableDesSchemas(composants), '$', erreurs);
    return { ok: erreurs.length === 0, erreurs };
}

/** Parcourt UN schéma en entier (y compris ce qu'aucune valeur n'atteint) : mot-clé inconnu, $ref qui ne résout pas, `required` qui nomme une propriété absente. Lève. */
function verifierUnSchema(schema, composants, chemin = '$') {
    const table = tableDesSchemas(composants);
    if (schema === true || schema === false) return;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`verifierSchema : schéma illisible (${chemin})`);
    controlerMotsCles(schema, chemin);
    if (schema.$ref !== undefined) {
        if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith(PREFIXE_REF) || !Object.prototype.hasOwnProperty.call(table, schema.$ref.slice(PREFIXE_REF.length)))
            throw new Error(`verifierSchema : $ref qui ne résout pas : ${schema.$ref} (${chemin})`);
    }
    if (schema.type !== undefined) for (const t of Array.isArray(schema.type) ? schema.type : [schema.type]) if (!TYPES.includes(t)) throw new Error(`verifierSchema : type inconnu "${t}" (${chemin})`);
    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) throw new Error(`verifierSchema : enum vide ou illisible (${chemin})`);
    if (schema.pattern !== undefined) new RegExp(schema.pattern);
    if (schema.required !== undefined) {
        if (!schema.properties) throw new Error(`verifierSchema : required sans properties (${chemin})`);
        for (const k of schema.required) if (!Object.prototype.hasOwnProperty.call(schema.properties, k)) throw new Error(`verifierSchema : "${k}" est requis mais n'est pas une propriété (${chemin})`);
    }
    for (const [k, s] of Object.entries(schema.properties || {})) verifierUnSchema(s, composants, `${chemin}.${k}`);
    if (schema.items !== undefined) verifierUnSchema(schema.items, composants, `${chemin}[]`);
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object') verifierUnSchema(schema.additionalProperties, composants, `${chemin}.*`);
    if (schema.oneOf !== undefined) {
        if (!Array.isArray(schema.oneOf) || !schema.oneOf.length) throw new Error(`verifierSchema : oneOf vide (${chemin})`);
        schema.oneOf.forEach((s, i) => verifierUnSchema(s, composants, `${chemin}.oneOf[${i}]`));
    }
}
/** Parcourt tous les schémas d'un document (ou d'une table de schémas). */
function verifierSchema(composants) {
    for (const [nom, s] of Object.entries(tableDesSchemas(composants))) verifierUnSchema(s, composants, nom);
}

module.exports = { valider, verifierSchema, verifierUnSchema, tableDesSchemas };
