// Le chaînage commun de l'arbitrage et de la provenance (LECTURE SEULE) : base `cartes` → confrontation (avec la table d'alias PROUVÉE) → arbitrage des désaccords.
// Un seul endroit : l'arbitrage et la provenance doivent lire la MÊME confrontation (§21 bis : deux copies d'une règle divergent).
const fs = require('fs');
const path = require('path');
const { chargerSources, chargerBase } = require('./charger-bulba');
const { confronter } = require('./confronter-bulba');
const { arbitrerTout, calibrerConventions } = require('./arbitrage-bulba');
const { verifierTable, versTableConfronter } = require('./alias-sets-bulba');

const VARIANTS_PAR_DEFAUT = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/BULBA-DONNEES/tcgdex-variants.json';
const TABLE_ALIAS = path.join(__dirname, 'alias-sets-bulba.json');

/** La table des Pokédex lue comme la production la lit (tpc.js : dexDuNom), nom normalisé par scoring.js. */
function fabriquerDexDuNom() {
    const TABLE = require('../pokedex-dexids.json');
    const { normaliserNomPourComparaison } = require('../scoring');
    return nom => { if (!nom) return null; const v = TABLE[normaliserNomPourComparaison(String(nom).split('[')[0])]; return Array.isArray(v) && v.length ? v : null; };
}

/** @param {import('mongodb').Db} db  la base `cartes` en LECTURE SEULE */
async function preparer(db, { dossierSources, fichierVariants, sansAlias = false } = {}) {
    const { sets, cartes } = await chargerBase(db);
    const sources = chargerSources(dossierSources || undefined);
    // les variantes TCGdex, preuve structurelle de la rareté : fusionnées sur les cartes de l'index (champ étranger à la rareté)
    const V = JSON.parse(fs.readFileSync(fichierVariants || VARIANTS_PAR_DEFAUT, 'utf8'));
    let avecVariantes = 0;
    for (const c of sources.tdx.cartes) { const t = V[`${c.serie}/${c.dossierSet}|${c.numero}`]; if (t) { c.variants = t; avecVariantes++; } }
    if (!avecVariantes) throw new Error('aucune variante fusionnée : clé de jointure fausse (instrument cassé)');
    const table = JSON.parse(fs.readFileSync(TABLE_ALIAS, 'utf8'));
    const erreurs = verifierTable(table); if (erreurs.length) throw new Error('table d\'alias rejetée : ' + erreurs[0]);
    const alias = sansAlias ? null : versTableConfronter(table);
    const base = confronter({ cartes, sets, sources, alias: null });
    const cible = alias ? confronter({ cartes, sets, sources, alias }) : base;
    // les conventions de nom de rareté sont CALIBRÉES sur toute la population (pas sur les seules lignes en désaccord)
    const conventions = calibrerConventions(cible.lignes);
    const A = arbitrerTout(cible.lignes, { dexDuNom: fabriquerDexDuNom(), conventions });
    const dansBase = new Set(base.lignes.filter(l => l.statut === 'desaccord').map(l => l.champ + '\u0000' + l.cle));
    for (const e of A.entrees) e.baseline = dansBase.has(e.champ + '\u0000' + e.cle);
    return { cartes, sets, sources, base, cible, conventions, arbitrage: A, desaccordsBaseline: dansBase.size, avecVariantes };
}
module.exports = { preparer, fabriquerDexDuNom, VARIANTS_PAR_DEFAUT };
