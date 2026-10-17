// node test-confronter-bulba.js — la confrontation des champs d'origine Bulbapedia à d'autres sources (fonction pure, FAUX objets, aucune base).
// Port de la mesure du 2026-10-17 (BULBA-REMPLACEMENT/mesure2.js) en module testable : le « nom » reste un TÉMOIN de la clé (set + numéro), jamais un accord compté.
// `suite(module)` est rejouée contre des mutants par test-mutants-bulba.js.
function suite(M) {
const { confronter } = M;

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; if (require.main === module) console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── sources fabriquées
const pkcCarte = (o) => ({ dossier: 'Serie/AAA', fichier: '1.json', name: 'Alpha', set_full_name: 'Alpha Set', number: '1', set_total: '2', rarity: 'Rare', author: ['Ken Sugimori'], hp: 60, retreat: 1,
    weakness: { type: ['Fire'] }, resistance: { type: [] }, attacks: [{ name: 'Tackle' }], ...o });
const tdxSet = { serie: 'Serie', fichier: 'Alpha Set', nom: 'Alpha Set', date: '2000-01-01', total: 2 };
const tdxCarte = (o) => ({ serie: 'Serie', dossierSet: 'Alpha Set', numero: '1', name: 'Alpha', illustrator: 'Ken Sugimori', rarity: 'Rare', hp: 60, retreat: 1, dexId: 7, attacks: ['Tackle'], weakness: 'Fire', resistance: null, ...o });
const carte = (o) => ({ _id: 1, nomEn: 'Alpha', nomJa: null, pv: 60, retraite: 1, faiblesse: 'Fire', resistance: null, illustrateur: 'Ken Sugimori', ndex: 7, attaques: [{ nom: 'Tackle' }],
    impressions: [{ tirage: 'intl', expansion: 'Alpha Set', numero: '1', total: '2', rarete: 'Rare' }], ...o });
const donnees = (over = {}) => ({
    cartes: [carte()], sets: [],
    sources: { pkc: [pkcCarte(), pkcCarte({ number: '2', fichier: '2.json', name: 'Beta' })], tdx: { sets: [tdxSet], cartes: [tdxCarte(), tdxCarte({ numero: '2', name: 'Beta' })] }, jp: [] },
    alias: null, ...over
});
const ligne = (r, champ, cle = 1) => r.lignes.find(l => l.champ === champ && l.cle === cle);

// 1. accord des deux sources, ligne par champ
let r = confronter(donnees());
verifier('pv : accord des deux sources', [ligne(r, 'carte.pv').parSource.pkc.statut, ligne(r, 'carte.pv').parSource.tdx.statut, ligne(r, 'carte.pv').statut], ['ok', 'ok', 'accord']);
verifier('ndex : pkmncards ne le porte pas (absent), TCGdex concorde', [ligne(r, 'carte.ndex').parSource.pkc?.statut ?? 'sans', ligne(r, 'carte.ndex').parSource.tdx.statut], ['abs', 'ok']);
verifier('apparié : 1 impression intl confirmée', [r.appar.intl.impr, r.appar.intl.cle], [1, 1]);

// 2. désaccord SEUL : toutes les sources contredisent
r = confronter(donnees({ cartes: [carte({ pv: 70 })] }));
verifier('pv 70 contre 60 / 60 : désaccord, valeurs des sources conservées', [ligne(r, 'carte.pv').statut, ligne(r, 'carte.pv').parSource.pkc.valeur, ligne(r, 'carte.pv').parSource.tdx.valeur], ['desaccord', 60, 60]);

// 3. UNE source concorde, l'autre contredit : accord (au moins une)
r = confronter(donnees({ sources: { pkc: [pkcCarte({ hp: 99 })], tdx: { sets: [tdxSet], cartes: [tdxCarte()] }, jp: [] } }));
verifier('une source concorde : « accord »', ligne(r, 'carte.pv').statut, 'accord');

// 4. le NOM est un témoin : numéro et set égaux mais nom différent → pas confirmé, aucune ligne de champ comparée
r = confronter(donnees({ sources: { pkc: [pkcCarte({ name: 'Gamma' })], tdx: { sets: [], cartes: [] }, jp: [] } }));
verifier('nom divergent : impression non confirmée (nomDiff), le champ reste sans remplaçant', [r.appar.intl.nomDiff, r.appar.intl.confirmees, ligne(r, 'carte.pv').statut], [1, 0, 'sans']);

// 4 bis. chaque clé trouvée est rendue avec le verdict du nom, par impression (la provenance du numéro et du nom en dépend)
r = confronter(donnees());
verifier('appariements : (carte, impression, tirage, source, nom concordant)', r.appariements.map(a => [a.carteId, a.idx, a.tirage, a.src, a.nomOk]), [[1, 0, 'intl', 'pkc', true], [1, 0, 'intl', 'tdx', true]]);
r = confronter(donnees({ sources: { pkc: [pkcCarte({ name: 'Gamma' })], tdx: { sets: [], cartes: [] }, jp: [] } }));
verifier('appariements : un nom divergent est rendu nomOk false', r.appariements.map(a => [a.src, a.nomOk]), [['pkc', false]]);

// 5. alias : l'expansion de Bulbapedia n'est pas le nom de la source → sans alias non résolue ; avec alias PROUVÉ résolue
const sansNom = { cartes: [carte({ impressions: [{ tirage: 'intl', expansion: 'Alpha Set (Bulbapedia)', numero: '1', total: '2', rarete: 'Rare' }] })] };
r = confronter(donnees(sansNom));
verifier('sans alias : non résolue', [r.appar.intl.cle, r.appar.intl.non], [0, 1]);
r = confronter(donnees({ ...sansNom, alias: { intl: { alphasetbulbapedia: { pkc: ['Serie/AAA'], tdx: ['Serie/Alpha Set'] } }, jp: {} } }));
verifier('avec alias : résolue, champs comparés', [r.appar.intl.cle, ligne(r, 'carte.pv').statut], [1, 'accord']);

// 6. les deux alias historiques de la mesure (« EX », « Platinum: ») restent en base de comparaison
r = confronter(donnees({ cartes: [carte({ impressions: [{ tirage: 'intl', expansion: 'EX Alpha Set', numero: '1', total: '2', rarete: 'Rare' }] })] }));
verifier('« EX Alpha Set » → « Alpha Set » (alias historique)', r.appar.intl.cle, 1);

// 7. un numéro qui désigne DEUX cartes de la source ne désigne rien (doublon), jamais deviné
r = confronter(donnees({ sources: { pkc: [pkcCarte(), pkcCarte({ fichier: 'b.json' })], tdx: { sets: [], cartes: [] }, jp: [] } }));
verifier('doublon : non confirmé', [r.appar.intl.doublon, r.appar.intl.cle], [1, 0]);

// 8. rareté et total par impression, clé carteId#idx
r = confronter(donnees({ cartes: [carte({ impressions: [{ tirage: 'intl', expansion: 'Alpha Set', numero: '1', total: '2', rarete: 'Rare Holo' }] })] }));
const lr = ligne(r, 'impression.rarete', '1#0');
verifier('rareté : pkmncards (fin) contredit « Rare Holo » par « Rare »', [lr.parSource.pkc.statut, lr.parSource.pkc.valeur, lr.contexte.exp, lr.contexte.numero], ['ko', 'Rare', 'Alpha Set', '1']);
verifier('total « 2 » : accord', ligne(r, 'impression.total', '1#0').statut, 'accord');

// 8 bis. les variantes TCGdex (champ étranger à la rareté) suivent la rareté comme preuve structurelle ; la catégorie suit chaque ligne
r = confronter(donnees({ cartes: [carte({ categorie: 'pokemon', impressions: [{ tirage: 'intl', expansion: 'Alpha Set', numero: '1', total: '2', rarete: 'Rare Holo' }] })],
    sources: { pkc: [pkcCarte()], tdx: { sets: [tdxSet], cartes: [tdxCarte({ variants: ['holo', 'reverse'] })] }, jp: [] } }));
verifier('variantes : extra posé sur TCGdex seulement, catégorie dans le contexte', [ligne(r, 'impression.rarete', '1#0').parSource.tdx.extra, ligne(r, 'impression.rarete', '1#0').parSource.pkc.extra ?? null, ligne(r, 'carte.pv').contexte.categorie], [{ variants: ['holo', 'reverse'] }, null, 'pokemon']);

// 9. japonais : code de set → dossier ; le nom japonais est le témoin
const jpC = (o) => ({ dossier: 'sv1', fichier: '1.json', name: 'アルファ', number: '001', set_total: '010', author: ['A B'], hp: 60, retreat: 1, pokedex_number: 7, attacks: [{ name: 'たいあたり' }], weakness: { type: ['Fire'] }, resistance: { type: [] }, ...o });
const jpDon = (over = {}) => ({ cartes: [carte({ nomJa: 'アルファ', attaques: [{ nom: 'Tackle', nomJa: 'たいあたり' }], impressions: [{ tirage: 'jp', expansion: 'Alpha JP', numero: '1', total: '10' }] })], sets: [{ _id: 'Alpha-JP', code: 'SV1', region: 'jp', bulba: { expansion: 'Alpha JP' } }], sources: { pkc: [], tdx: { sets: [], cartes: [] }, jp: [jpC()] }, alias: null, ...over });
r = confronter(jpDon());
verifier('jp : set → code → dossier, nom japonais concordant', [r.appar.jp.cle, ligne(r, 'carte.pv').parSource.jp.statut, ligne(r, 'carte.ndex').parSource.jp.statut], [1, 'ok', 'ok']);
r = confronter(jpDon({ sets: [] }));
verifier('jp sans set connu : non résolu (sans alias)', [r.appar.jp.cle, r.appar.jp.non], [0, 1]);
r = confronter(jpDon({ sets: [], alias: { intl: {}, jp: { alphajp: ['sv1'] } } }));
verifier('jp avec alias de code prouvé : résolu', r.appar.jp.cle, 1);

// 10. sets : date et total imprimé
r = confronter(donnees({ sets: [{ _id: 'Alpha-Set', region: 'intl', nomEn: 'Alpha Set', dateSortieEn: 'January 1, 2000', totalImprime: 2, bulba: { expansion: 'Alpha Set' } }] }));
verifier('set : date accord, total imprimé accord', [ligne(r, 'set.dateSortieEn', 'Alpha-Set').statut, ligne(r, 'set.totalImprime', 'Alpha-Set').statut], ['accord', 'accord']);
r = confronter(donnees({ sets: [{ _id: 'Alpha-Set', region: 'intl', nomEn: 'Alpha Set', dateSortieEn: 'January 1, 2000', totalImprime: 9, bulba: { expansion: 'Alpha Set' } }] }));
verifier('set : total imprimé contredit par les deux', ligne(r, 'set.totalImprime', 'Alpha-Set').statut, 'desaccord');

// 10 bis. `totalImprime` de Bulbapedia est le NOMBRE DE CARTES du set, secrètes comprises (carte n° 3 d'un set imprimé « /2 » : Bulbapedia 3). Vérifié sur les données
// réelles (89 sets : = décompte de numéros TCGdex pour 71, = dénominateur officiel pour 14) : un comparateur « dénominateur imprimé » fabriquerait des désaccords.
const troisCartes = { pkc: [pkcCarte(), pkcCarte({ number: '2', fichier: '2.json', name: 'Beta' }), pkcCarte({ number: '3', fichier: '3.json', name: 'Secrete' })],
    tdx: { sets: [tdxSet], cartes: [tdxCarte(), tdxCarte({ numero: '2', name: 'Beta' }), tdxCarte({ numero: '3', name: 'Secrete' })] }, jp: [] };
r = confronter(donnees({ sources: troisCartes, sets: [{ _id: 'Alpha-Set', region: 'intl', nomEn: 'Alpha Set', totalImprime: 3, bulba: { expansion: 'Alpha Set' } }] }));
verifier('total du set : 3 numéros (secrète comprise) pour « /2 » imprimé → accord avec le décompte', [ligne(r, 'set.totalImprime', 'Alpha-Set').statut, ligne(r, 'set.totalImprime', 'Alpha-Set').parSource.pkc.valeur, ligne(r, 'set.totalImprime', 'Alpha-Set').parSource.tdx.valeur], ['accord', 3, 3]);

// 11. sans remplaçant : une valeur Bulbapedia sans aucune source = ligne « sans »
r = confronter(donnees({ sources: { pkc: [], tdx: { sets: [], cartes: [] }, jp: [] } }));
verifier('aucune source : « sans », dénominateur compté', [ligne(r, 'carte.pv').statut, r.lignes.filter(l => l.champ === 'carte.pv').length], ['sans', 1]);

return { ok, ko };
}
module.exports = { suite };

if (require.main === module) {
    const { ok, ko } = suite(require('./collecte-cartes/confronter-bulba'));
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exit(1);
}
