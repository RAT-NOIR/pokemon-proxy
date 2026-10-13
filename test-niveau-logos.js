// Banc de la classification des niveaux de logo (collecte-cartes/niveau-logos.js) : fonction pure à TABLE FERMÉE, états FABRIQUÉS. Aucune base.
//   node test-niveau-logos.js
const N = require('./collecte-cartes/niveau-logos');
const { LOGOS_GENERIQUES, LOGOS_COPIES, LOGOS_DU_COUPLE } = require('./collecte-cartes/langue-logo');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const niveau = (champ, entree, set = {}, ctx = {}) => N.classer(champ, entree, set, ctx).niveau;
const GEN = [...LOGOS_GENERIQUES.keys()][0], COPIE = [...LOGOS_COPIES.keys()][0], COUPLE = [...LOGOS_DU_COUPLE.keys()][0];

// la table fermée
verifier('logoCompose : compose', niveau('logoCompose', { source: 'compose', cleR2: 'x' }), 'compose');
verifier('logoOfficiel.fr / ja / en : officiel', ['logoOfficiel.fr', 'logoOfficiel.ja', 'logoOfficiel.en'].map(c => niveau(c, { cleR2: 'x', lot: 'l', source: 'tcgdex' })), ['officiel', 'officiel', 'officiel']);
verifier('logo TCGdex (tcgdex:en) : officiel', niveau('logo', { source: 'tcgdex:en', sha1: 'a' }), 'officiel');
verifier('logoFr TCGdex (tcgdex:assets-fr) : officiel', niveau('logoFr', { source: 'tcgdex:assets-fr', sha1: 'a' }), 'officiel');
verifier('logo Bill\'s Archive : officiel', niveau('logo', { source: 'billsarchive', sha1: 'a' }), 'officiel');
verifier('logo bulbapedia:setlogo (setlogo de la page du set) : officiel', niveau('logo', { source: 'bulbapedia:setlogo', sha1: 'a', fichier: 'S Logo.png' }), 'officiel');
verifier('logo manuel / apport-manuel : inconnu (aucune ligne des tables lues ne dit « officiel »)', [niveau('logo', { source: 'manuel', fichier: 'Logo JP/OR2.png' }), niveau('logo', { source: 'apport-manuel', fichier: 'ADK.png' })], ['inconnu', 'inconnu']);
verifier('logo manuel dont la ligne de la table dit officiel:true : officiel ; false ou absent : inconnu', [niveau('logo', { source: 'manuel', fichier: 'Logo JP/OR2.png' }, {}, { officielsManuels: new Set(['Logo JP/OR2.png']) }), niveau('logo', { source: 'manuel', fichier: 'Logo JP/OR3.png' }, {}, { officielsManuels: new Set(['Logo JP/OR2.png']) })], ['officiel', 'inconnu']);
verifier('logo ptcg-assets, bulbagarden:demande-site, source inconnue ou absente : inconnu (jamais deviné)', ['ptcg-assets', 'bulbagarden:demande-site', 'autre', undefined].map(s => niveau('logo', { source: s, sha1: 'a' })), ['inconnu', 'inconnu', 'inconnu', 'inconnu']);
verifier('un officiel par la source MAIS générique (logoGenerique: true, ou empreinte de la table) : generique', [niveau('logo', { source: 'tcgdex:en', sha1: 'a' }, { logoGenerique: true }), niveau('logo', { source: 'tcgdex:en', sha1: GEN })], ['generique', 'generique']);
verifier('un officiel par la source MAIS logo du couple (fichier de la table) : inconnu', niveau('logo', { source: 'bulbapedia:setlogo', sha1: 'a', fichier: COUPLE }), 'inconnu');
verifier('un officiel par la source MAIS copie de Pokécardex : inconnu', niveau('logo', { source: 'tcgdex:en', sha1: COPIE }), 'inconnu');
// TOUR 1 : logoOfficiel.* se classe par la SOURCE de l'entrée (table fermée), plus « par construction »
const LOT_B = 'logos-officiels-bulba-2026-10';
verifier('logoOfficiel.* : tcgdex et billsarchive → officiel', [niveau('logoOfficiel.fr', { source: 'tcgdex', cleR2: 'x', lot: 'l' }), niveau('logoOfficiel.ja', { source: 'billsarchive', cleR2: 'x', lot: 'l' })], ['officiel', 'officiel']);
verifier('logoOfficiel.ja bulbapedia : officiel SEULEMENT du lot bulba ET avec `setlogo` dans la preuve', [
    niveau('logoOfficiel.ja', { source: 'bulbapedia', lot: LOT_B, preuve: { setConfirmeParPage: 'la page nomme setlogo « X.png »' } }),
    niveau('logoOfficiel.ja', { source: 'bulbapedia', lot: LOT_B, preuve: { route: 'B' } }),
    niveau('logoOfficiel.ja', { source: 'bulbapedia', lot: 'autre-lot', preuve: { setConfirmeParPage: 'setlogo' } })], ['officiel', 'inconnu', 'inconnu']);
verifier('logoOfficiel.* : une autre source, ou aucune source lisible → inconnu (plus « officiel par construction »)', [niveau('logoOfficiel.fr', { source: 'manuel', cleR2: 'x', lot: 'l' }), niveau('logoOfficiel.fr', { cleR2: 'x', lot: 'l', sha256: GEN }), niveau('logoOfficiel.en', { source: 'pokecardex' })], ['inconnu', 'inconnu', 'inconnu']);
verifier('la raison imprimée dit la SOURCE', [N.classer('logoOfficiel.fr', { source: 'tcgdex' }, {}).raison, N.classer('logoOfficiel.ja', { source: 'bulbapedia', lot: LOT_B, preuve: 'setlogo' }, {}).raison], ['logoOfficiel, source tcgdex (table fermée)', 'logoOfficiel, source bulbapedia, lot logos-officiels-bulba-2026-10, `setlogo` dans la preuve']);
verifier('champ inconnu : inconnu', niveau('logoAutre', { source: 'tcgdex:en' }), 'inconnu');
verifier('logoSemiOfficiel : semi-officiel seulement avec sa phrase', [niveau('logoSemiOfficiel.en', { cleR2: 'x', lot: 'l', represente: 'logo de l\'opération McDonald\'s Match Battle 2022-2023' }), niveau('logoSemiOfficiel.en', { cleR2: 'x', lot: 'l' })], ['semi-officiel', 'inconnu']);

// la source : posée seulement si elle manque ET se lit sans deviner
verifier('source : logoCompose sans source reçoit « compose » ; logoOfficiel sans source mais urlSource TCGdex/Bill\'s reçoit l\'hôte ; logo sans source : rien', [N.classer('logoCompose', { cleR2: 'x' }, {}).source, N.classer('logoOfficiel.fr', { urlSource: 'https://assets.tcgdex.net/fr/a/b/logo.png' }, {}).source, N.classer('logoOfficiel.fr', { urlSource: 'https://billsarchive.com/x.webp' }, {}).source, N.classer('logo', { fichier: 'x' }, {}).source], ['compose', 'tcgdex', 'billsarchive', null]);
verifier('source déjà écrite : jamais reposée', N.classer('logoCompose', { source: 'compose' }, {}).source, null);

// la simulation : comptes, exemples, champs NEUFS seulement
const sets = [
    { _id: 'A', tirage: 'intl', region: 'intl', logo: { source: 'tcgdex:en', sha1: 'a', fichier: null }, logoFr: { source: 'tcgdex:assets-fr', sha1: 'b' }, logoCompose: { source: 'compose', cleR2: 'c' } },
    { _id: 'B', tirage: 'jp', region: 'jp', logo: { source: 'manuel', fichier: 'Logo JP/X.png' }, logoOfficiel: { ja: { cleR2: 'o', lot: 'l', urlSource: 'https://billsarchive.com/a.webp' } } },
    { _id: 'C', region: 'intl', logo: { source: 'tcgdex:en', sha1: 'a', niveau: 'officiel' } },
    { _id: 'D', tirage: 'zh-hans', region: 'intl' }
];
const sim = N.simuler(sets, {});
verifier('simulation : comptes par valeur (champ → niveau → n)', sim.comptes, { logo: { officiel: 2, inconnu: 1 }, logoFr: { officiel: 1 }, logoCompose: { compose: 1 }, 'logoOfficiel.ja': { officiel: 1 } });
verifier('simulation : comptes par tirage (tirage, à défaut region)', sim.parTirage, { intl: { officiel: 3, compose: 1 }, jp: { inconnu: 1, officiel: 1 } });
verifier('simulation : un champ qui porte déjà son niveau n\'est pas réécrit', sim.aEcrire.filter(x => x._id === 'C'), []);
verifier('simulation : l\'écriture ne pose que `niveau` (et `source` si absente et lisible), jamais une valeur existante', sim.aEcrire.map(x => [x._id, x.chemin, Object.keys(x.pose).sort().join('+')]), [['A', 'logo', 'niveau'], ['A', 'logoFr', 'niveau'], ['A', 'logoCompose', 'niveau'], ['B', 'logo', 'niveau'], ['B', 'logoOfficiel.ja', 'niveau+source']]);
verifier('simulation : 10 exemples au plus par valeur', Object.values(N.simuler(Array.from({ length: 30 }, (_, i) => ({ _id: `S${i}`, region: 'intl', logo: { source: 'manuel' } })), {}).exemples.logo.inconnu).length, 10);
verifier('simulation : le dénominateur (sets lus, champs de logo vus) est rendu', [sim.sets, sim.champsVus], [4, 6]);
// TOUR 1 : --attendu=<n> obligatoire avec --ecrire ; le plan doit le confirmer AVANT toute écriture ; la relecture est comparée
{
    const P = require('./poser-niveau-logos');
    const a = P.analyserArguments;
    verifier('arguments : simulation seule, ou --lecture-via-ecriture', [a([]).erreurs, a(['--lecture-via-ecriture']).erreurs, a(['--lecture-via-ecriture']).viaEcriture], [[], [], true]);
    verifier('--ecrire sans --attendu : refus nommé', a(['--ecrire']).erreurs.length, 1);
    verifier('--ecrire --attendu=12 : accepté ; --attendu non entier, négatif ou vide : refus ; --attendu sans --ecrire : refus', [a(['--ecrire', '--attendu=12']).attendu, a(['--ecrire', '--attendu=abc']).erreurs.length, a(['--ecrire', '--attendu=-1']).erreurs.length, a(['--ecrire', '--attendu=']).erreurs.length, a(['--attendu=12']).erreurs.length], [12, 1, 1, 1, 1]);
    verifier('argument inconnu : refus', a(['--ecrire', '--attendu=1', '--tout']).erreurs.length, 1);
    verifier('plan = attendu : écriture permise ; plan ≠ attendu : refus AVANT écriture, les deux nombres dits', [P.verifierPlan(1046, 1046), /1046/.test(P.verifierPlan(1045, 1046) ?? '') && /1045/.test(P.verifierPlan(1045, 1046))], [null, true]);
    verifier('relecture : écrits = attendu et plus aucun champ sans niveau : concordant ; sinon dit', [P.verifierRelecture({ ecrits: 5, attendu: 5, restants: 0 }), typeof P.verifierRelecture({ ecrits: 4, attendu: 5, restants: 0 }), typeof P.verifierRelecture({ ecrits: 5, attendu: 5, restants: 1 })], [null, 'string', 'string']);
}
console.log(`\n${ok} passés, ${ko} en échec`);
if (ko) process.exitCode = 1;
