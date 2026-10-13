'use strict';
// ETIQUETAGE-A tour 3 (F-2) — la table des routes de CONTRAT-API-V2.md (§1) et les chemins de openapi.v2.json se disent la même chose, dans les DEUX sens.
// Avant ce banc, retirer une ligne de la table ne faisait échouer aucune suite. Aucune base, aucun réseau.
const H = require('./_harnais');
const fs = require('fs'), path = require('path');
const SCHEMA = require('../openapi/openapi.v2.json');

const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'CONTRAT-API-V2.md'), 'utf8');
const debut = doc.indexOf('## 1. Les routes'), fin = doc.indexOf('### 1.1 ', debut);
const table = debut >= 0 && fin > debut ? doc.slice(debut, fin) : '';
const lignes = [...table.matchAll(/^\| `(GET|POST|PUT|DELETE|PATCH) (\/[^`\s]*)`/gm)].map(m => `${m[1]} ${m[2]}`);
const ouvertes = Object.entries(SCHEMA.paths).flatMap(([chemin, ops]) => Object.keys(ops).filter(m => ['get', 'post', 'put', 'delete', 'patch'].includes(m)).map(m => `${m.toUpperCase()} ${chemin}`));

H.vrai(`instrument : la table du contrat est délimitée et lue (${lignes.length} routes) — un tableau vide ne prouverait rien`, lignes.length >= 20);
H.v('chaque route de la table du contrat est un chemin de l\'OpenAPI', lignes.filter(r => !ouvertes.includes(r)).sort(), []);
H.v('chaque chemin de l\'OpenAPI est une ligne de la table du contrat', ouvertes.filter(r => !lignes.includes(r)).sort(), []);
H.v('aucune route en double dans la table', lignes.filter((r, i) => lignes.indexOf(r) !== i), []);
H.vrai('la route d\'étiquetage y est (ETIQUETAGE-A)', lignes.includes('POST /api/banc/etiquette') && ouvertes.includes('POST /api/banc/etiquette'));
H.bilan();
