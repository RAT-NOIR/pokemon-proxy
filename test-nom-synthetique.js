// node test-nom-synthetique.js — le nom d'expansion synthétique (collecte-cartes/nom-synthetique.js) et la CONSERVATION des impressions `origine-slug`.
// Aucune base, aucun réseau. TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de collecte-cartes/impressions-posees.js (le rouge se voit en cassant le code).
const path = require('path');
const fs = require('fs');
const DIR = process.env.TOOL_DIR || __dirname;
const IP = require(path.join(DIR, 'collecte-cartes', 'impressions-posees.js'));
const NS = require('./collecte-cartes/nom-synthetique');
const FM = require('./collecte-cartes/fiches-multi');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── la fonction unique ──
verifier('estNomSynthetique : le nom du set, un tableau qui en contient un ; pas un nom Bulbapedia, pas null', [NS.estNomSynthetique(NS.expansionSynthetiqueDe('Promos')), NS.estNomSynthetique(['Brilliant Stars', 'reimpressions/X']), NS.estNomSynthetique('Brilliant Stars'), NS.estNomSynthetique(null), NS.estNomSynthetique(undefined), NS.estNomSynthetique(['Brilliant Stars'])], [true, true, false, false, false, false]);
verifier('nomsBulbapedia : retire les synthétiques, les vides et les non-chaînes', [NS.nomsBulbapedia({ bulba: { expansion: 'reimpressions/Promos' } }), NS.nomsBulbapedia({ bulba: { expansion: ['A', 'reimpressions/X', '', null] } }), NS.nomsBulbapedia({ bulba: { expansion: null } }), NS.nomsBulbapedia({})], [[], ['A'], [], []]);
verifier('l\'outil et la fonction partagent le MÊME nom (expansionDe de fiches-multi.js = expansionSynthetiqueDe)', FM.expansionDe('WCD-2011'), NS.expansionSynthetiqueDe('WCD-2011'));

// ── la CONSERVATION (§59) : les impressions écrites par l'outil survivent à une réécriture du tableau par le parseur ──
const set = { _id: 'Promos', code: 'PR', tirage: 'intl' };
const L = (id, slug) => ({ _id: `1|${id}`, carteId: 1, idProduct: id, slug, slugSet: 'Promos' });
const plan = FM.planFiche({ set, carte: { liens: { idProduct: [1, 2] } }, lignes: [L(1, 'Ultra-Ball-PRBRS-150'), L(2, 'Ultra-Ball-PRMEG-131')], nom: NS.expansionSynthetiqueDe('Promos') });
const page = { tirage: 'intl', expansion: 'Brilliant Stars', deck: null, numero: '150', total: '172', rarete: 'Uncommon' };
const enBase = [page, ...plan.impressions];        // ce que la base porte après le lot
const parseur = [{ ...page }];                      // ce que le parseur rend à la recollecte : la page de carte seule
const R = IP.reporterChampsPoses(enBase, parseur);
verifier('RECOLLECTE SIMULÉE (reporterChampsPoses, la fonction de production) : les 2 impressions d\'origine sont GARDÉES, la page de carte reste une', [R.impressions.length, R.gardees, R.impressions.filter(i => i.source === FM.SOURCE).map(i => i.numero).sort()], [3, 2, ['131', '150']]);
verifier('   la source écrite par l\'outil est dans SOURCES_POSEES_APRES', IP.SOURCES_POSEES_APRES.includes(FM.SOURCE), true);
verifier('   rejouer-impressions.js / corriger-tirage.js lisent la MÊME liste (aucune copie)', [/SOURCES_POSEES_APRES/.test(fs.readFileSync(path.join(__dirname, 'rejouer-impressions.js'), 'utf8')), /require\('\.\/collecte-cartes\/impressions-posees'\)/.test(fs.readFileSync(path.join(__dirname, 'corriger-tirage.js'), 'utf8'))], [true, true]);

(async () => {
    // ── poser-impressions-par-numero.js (nomsSoeurs) saute un set au nom synthétique, sans lire la base ──
    const { nomsSoeurs } = require('./poser-impressions-par-numero');
    const appels = [];
    const col = nom => ({ find: (...a) => { appels.push(nom); return { toArray: async () => [] }; } });
    const faux = { db: { collection: col } };
    const sets = new Map([['Promos', { _id: 'Promos', tirage: 'intl', bulba: { expansion: 'reimpressions/Promos' } }], ['Reel', { _id: 'Reel', tirage: 'intl', bulba: { expansion: 'Brilliant Stars' } }]]);
    appels.length = 0; const a = await nomsSoeurs({ cx: faux, prod: faux, slugs: ['Promos'], setsTous: sets });
    verifier('nomsSoeurs : un set au nom synthétique est SAUTÉ — 0 lecture de la base, 0 résultat', [appels.length, a.size], [0, 0]);
    appels.length = 0; await nomsSoeurs({ cx: faux, prod: faux, slugs: ['Reel'], setsTous: sets });
    verifier('   témoin : un set au vrai nom d\'expansion LIT la base (le banc sait voir la différence)', appels.length > 0, true);

    // ── les autres lecteurs : ils passent par la fonction partagée ──
    const lit = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
    verifier('poser-cartes-tcgdex.js, poser-par-nom-tcgdex.js, poser-numeros-lettre-total.js, poser-impressions-par-numero.js : nomsBulbapedia / estNomSynthetique (garde de lecture du code)', ['poser-cartes-tcgdex.js', 'poser-par-nom-tcgdex.js', 'poser-numeros-lettre-total.js', 'poser-impressions-par-numero.js'].map(f => /nomsBulbapedia\(|estNomSynthetique\(/.test(lit(f))), [true, true, true, true]);

    // ── la COLLECTE : un set au nom synthétique n'est jamais réécrit ──
    verifier('refusDeCollecte : un set au nom synthétique -> un message d\'arrêt qui le nomme ; un set normal ou absent -> null', [/synthétique.*arrêt/.test(NS.refusDeCollecte({ bulba: { expansion: 'reimpressions/Promos' } }, 'Promos')), NS.refusDeCollecte({ bulba: { expansion: 'Brilliant Stars' } }, 'BRS'), NS.refusDeCollecte({ bulba: { expansion: null } }, 'X'), NS.refusDeCollecte(null, 'X')], [true, null, null, null]);
    const ct = lit('collecteur-texte.js');
    verifier('collecteur-texte.js : la garde est AVANT le premier verrou et AVANT les deux $set de `bulba`', [ct.indexOf('refusDeCollecte(') > 0, ct.indexOf('refusDeCollecte(') < ct.indexOf('fabriquerVerrou({ Modele: M.EtatImages'), ct.indexOf('refusDeCollecte(') < ct.indexOf('bulba: { titre: pSet.title')], [true, true, true]);

    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
