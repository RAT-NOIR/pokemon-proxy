// Chargement des données de la confrontation Bulbapedia (LECTURE SEULE : base `cartes` par la connexion de lecture, index JSON des sources externes déjà extraits).
// Les index des sources externes sont produits HORS du clone par couverture/S7/BULBA-REMPLACEMENT/{ptcg-index.js, tcgdex-ts.js} (fs + JSON.parse / regex sur du texte :
// rien du clone n'est exécuté ni importé). Ici on ne lit que ces JSON.
const fs = require('fs');
const path = require('path');

const DOSSIER_SOURCES = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/BULBA-REMPLACEMENT/';

function chargerSources(dossier = DOSSIER_SOURCES) {
    const lire = f => {
        const p = path.join(dossier, f);
        if (!fs.existsSync(p)) throw new Error(`index absent : ${p} (le produire par couverture/S7/BULBA-REMPLACEMENT/ptcg-index.js et tcgdex-ts.js)`);
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    };
    const sources = { pkc: lire('ptcg-index-en.json'), jp: lire('ptcg-index-jp.json'), tdx: lire('tcgdex-index.json') };
    // dénominateur imprimé : une source vide serait un repli silencieux sur le vide
    for (const [k, v] of Object.entries({ pkc: sources.pkc, jp: sources.jp, 'tdx.cartes': sources.tdx.cartes, 'tdx.sets': sources.tdx.sets })) if (!Array.isArray(v) || !v.length) throw new Error(`source ${k} vide`);
    return sources;
}

const PROJ_CARTES = { nomEn: 1, nomJa: 1, attaques: 1, pv: 1, retraite: 1, faiblesse: 1, resistance: 1, illustrateur: 1, ndex: 1, categorie: 1, impressions: 1, provenance: 1 };
// ⚠️ chaque champ que le planificateur de provenance LIT doit figurer ici (test-provenance-bulba.js le vérifie) : un champ non projeté se lit « absent » et fabrique un défaut silencieux
const PROJ_SETS = { code: 1, region: 1, tirage: 1, nomEn: 1, 'bulba.expansion': 1, dateSortieEn: 1, dateSortieEnSource: 1, dateSortieJa: 1, dateSortieJaSource: 1, totalImprime: 1, type: 1, typeSource: 1, idExpansion: 1, provenance: 1 };

/** @param {import('mongodb').Db} db  la base `cartes`, en lecture seule */
async function chargerBase(db) {
    const sets = await db.collection('sets').find({}).project(PROJ_SETS).toArray();
    const cartes = await db.collection('cartes').find({ bulba: { $exists: true } }).project(PROJ_CARTES).toArray();
    if (!sets.length || !cartes.length) throw new Error(`base vide : ${sets.length} sets, ${cartes.length} cartes Bulbapedia`);
    return { sets, cartes };
}
module.exports = { chargerSources, chargerBase, DOSSIER_SOURCES, PROJ_CARTES, PROJ_SETS };
