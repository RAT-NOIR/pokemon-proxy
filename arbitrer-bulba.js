// ============================================================
// LOT 1 — ARBITRER LES DÉSACCORDS BULBAPEDIA ↔ AUTRES SOURCES (LECTURE SEULE : aucune écriture en base, aucun réseau)
// ============================================================
//   node arbitrer-bulba.js --sortie=<arbitrage.json> [--sans-alias] [--variants=<tcgdex-variants.json>] [--sources=<dossier>]
// Confronte les champs d'origine Bulbapedia aux trois sources (pkmncards, TCGdex, pokemon-card.com), garde les lignes en désaccord SEUL (aucune source ne concorde) et rend,
// pour chacune, un verdict par témoins (collecte-cartes/arbitrage-bulba.js) : juste / fausse (+ correction PROPOSÉE) / indécidable. Les corrections ne sont pas appliquées ici.
// Le jeu de lignes est celui de la confrontation avec la table d'alias PROUVÉE (collecte-cartes/alias-sets-bulba.json) ; `baseline: true` marque celles que la mesure d'origine voyait déjà.
require('dotenv').config();
const fs = require('fs');
const { ouvrirSimulation } = require('./collecte-cartes/ouvrir-lecture');
const { chargerSources, chargerBase } = require('./collecte-cartes/charger-bulba');
const { confronter } = require('./collecte-cartes/confronter-bulba');
const { arbitrerTout, calibrerConventions } = require('./collecte-cartes/arbitrage-bulba');
const { verifierTable, versTableConfronter } = require('./collecte-cartes/alias-sets-bulba');

const AUTORISES = [/^--sortie=.+$/, /^--sans-alias$/, /^--variants=.+$/, /^--sources=.+$/, /^--lecture-via-ecriture$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;

/** La table des Pokédex (pokedex-dexids.json) lue comme la production la lit (tpc.js : dexDuNom), nom normalisé par scoring.js. */
function fabriquerDexDuNom() {
    const TABLE = require('./pokedex-dexids.json');
    const { normaliserNomPourComparaison } = require('./scoring');
    return nom => { if (!nom) return null; const v = TABLE[normaliserNomPourComparaison(String(nom).split('[')[0])]; return Array.isArray(v) && v.length ? v : null; };
}

(async () => {
    const cx = await ouvrirSimulation({ viaEcriture: process.argv.includes('--lecture-via-ecriture'), ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions });
    const { sets, cartes } = await chargerBase(cx.cartes.db);
    const sources = chargerSources(arg('sources') || undefined);
    // les variantes TCGdex, preuve structurelle de la rareté : fusionnées sur les cartes de l'index (champ étranger à la rareté)
    const fv = arg('variants') || 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/BULBA-DONNEES/tcgdex-variants.json';
    const V = JSON.parse(fs.readFileSync(fv, 'utf8'));
    let avecV = 0; for (const c of sources.tdx.cartes) { const t = V[`${c.serie}/${c.dossierSet}|${c.numero}`]; if (t) { c.variants = t; avecV++; } }
    if (!avecV) throw new Error('aucune variante fusionnée : clé de jointure fausse (instrument cassé)');
    const table = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'collecte-cartes', 'alias-sets-bulba.json'), 'utf8'));
    const erreurs = verifierTable(table); if (erreurs.length) throw new Error('table d\'alias rejetée : ' + erreurs[0]);
    const alias = process.argv.includes('--sans-alias') ? null : versTableConfronter(table);

    const base = confronter({ cartes, sets, sources, alias: null });
    const cible = alias ? confronter({ cartes, sets, sources, alias }) : base;
    // les conventions de nom de rareté sont CALIBRÉES sur toute la population (pas sur les seules lignes en désaccord)
    const conventions = calibrerConventions(cible.lignes);
    const ctx = { dexDuNom: fabriquerDexDuNom(), conventions };
    const A = arbitrerTout(cible.lignes, ctx);
    const dansBase = new Set(base.lignes.filter(l => l.statut === 'desaccord').map(l => l.champ + '\u0000' + l.cle));
    for (const e of A.entrees) e.baseline = dansBase.has(e.champ + '\u0000' + e.cle);
    const nBase = dansBase.size;

    console.log(`DÉNOMINATEURS : ${cartes.length} cartes · ${sets.length} sets · variantes TCGdex fusionnées sur ${avecV}/${sources.tdx.cartes.length} cartes · alias ${alias ? 'oui' : 'NON (--sans-alias)'}`);
    console.log(`DÉSACCORDS SEULS : ${A.entrees.length} (mesure d'origine, sans alias : ${nBase} ; dont dans les deux : ${A.entrees.filter(e => e.baseline).length})`);
    const tot = { juste: 0, fausse: 0, indecidable: 0 };
    for (const [ch, r] of Object.entries(A.resume)) { console.log(`   ${ch.padEnd(22)} total ${String(r.total).padStart(4)} · juste ${String(r.juste).padStart(4)} · fausse ${String(r.fausse).padStart(4)} · indécidable ${String(r.indecidable).padStart(4)}`); for (const k of Object.keys(tot)) tot[k] += r[k]; }
    console.log(`   TOTAL                  ${A.entrees.length} · juste ${tot.juste} · fausse ${tot.fausse} · indécidable ${tot.indecidable}`);
    const raisons = {}; for (const e of A.entrees) { const k = `${e.champ} | ${e.verdict} | ${e.raison}`; raisons[k] = (raisons[k] || 0) + 1; }
    console.log(`CONVENTIONS DE NOM DE RARETÉ calibrées (par source) : pkmncards ${Object.keys(conventions.pkc).length}, TCGdex ${Object.keys(conventions.tdx).length}`);
    for (const s of ['pkc', 'tdx']) for (const c of Object.values(conventions[s]).sort((a, b) => b.observations - a.observations)) console.log(`   ${s}  « ${c.de} » ≅ « ${c.vers} » : ${c.observations} impressions, pureté ${c.purete} (${c.sens})`);
    console.log('RAISONS :'); for (const [k, n] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
    const sol = {}; for (const e of A.entrees.filter(e => e.solidite)) sol[`${e.champ} ${e.solidite}`] = (sol[`${e.champ} ${e.solidite}`] || 0) + 1;
    console.log(`SOLIDITÉ (corrections proposées) : ${JSON.stringify(sol)}`);
    if (arg('sortie')) {
        fs.writeFileSync(arg('sortie'), JSON.stringify({ genereLe: new Date().toISOString(), denominateurs: { cartes: cartes.length, sets: sets.length, desaccordsBaseline: nBase, desaccords: A.entrees.length }, resume: A.resume, conventions, entrees: A.entrees }, null, 1));
        console.log(`écrit : ${arg('sortie')}`);
    }
    await cx.fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
