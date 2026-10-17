// node test-alias-sets-bulba.js — la table FERMÉE d'alias de sets (Bulbapedia ↔ pkmncards / TCGdex / pokemon-card.com) : chaque alias est PROUVÉ par le recouvrement
// (numéro, nom) du set ENTIER, dans les deux sens, jamais deviné. Fonctions pures, faux objets.
// Le fichier exporte `suite(module)` : test-mutants-bulba.js rejoue la même suite contre des modules volontairement cassés.
function suite(M) {
    let ok = 0, ko = 0;
    const verifier = (nom, obtenu, attendu) => {
        const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
        if (a === b) { ok++; if (require.main === module) console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
    };
    const { indexerExternes, prouverAlias, verifierTable, versTableConfronter } = M;
    // un set de n cartes « Nom<i> », numéros 1..n, décalable
    const set = (n, depart = 1, prefixe = 'Nom') => Array.from({ length: n }, (_, i) => ({ numero: String(depart + i).padStart(3, '0'), nom: prefixe + (depart + i) }));
    const ids = r => r.retenus.map(x => x.cle).sort();

    // 1. PROUVÉ : mêmes (numéro, nom) sur tout le set
    let idx = indexerExternes([{ cle: 'AAA', cartes: set(10) }, { cle: 'ZZZ', cartes: set(10, 1, 'Autre') }]);
    let r = prouverAlias(set(10), idx);
    verifier('alias prouvé : 10/10 paires, un seul set', [ids(r), r.refus, r.retenus[0].couvBulba, r.retenus[0].couvExterne], [['AAA'], null, 1, 1]);

    // 2. LE PIÈGE DES PETITS ENTIERS (§31) : mêmes numéros, noms différents → rien (le numéro seul ne prouve rien)
    idx = indexerExternes([{ cle: 'AAA', cartes: set(10, 1, 'Autre') }]);
    r = prouverAlias(set(10), idx);
    verifier('numéros identiques, noms différents : refusé', [ids(r), r.refus], [[], 'aucun-candidat']);

    // 3. une expansion contenue dans un très grand set ne prouve rien (peu de noms en commun sur des plages denses)
    idx = indexerExternes([{ cle: 'GROS', cartes: [...set(3), ...set(197, 4, 'Autre')] }]);
    r = prouverAlias(set(20), idx);
    verifier('3 paires seulement sur 200 : refusé', [ids(r), r.refus], [[], 'aucun-candidat']);

    // 4. deux sets externes IDENTIQUES : ambigu, aucun n'est choisi
    idx = indexerExternes([{ cle: 'AAA', cartes: set(10) }, { cle: 'BBB', cartes: set(10) }]);
    r = prouverAlias(set(10), idx);
    verifier('deux candidats identiques : ambigu, aucun choisi', [ids(r), r.refus], [[], 'ambigu']);

    // 5. UNION : le set de Bulbapedia est la réunion de deux sets externes DISJOINTS (ex. Hidden Fates + Shiny Vault)
    //    (relecture 1 : une partie ne passe par la seule règle « source contenue » qu'avec ≥ 20 paires dont le nom concorde ; en dessous, c'est une inclusion à sens unique)
    idx = indexerExternes([{ cle: 'PRINC', cartes: set(25) }, { cle: 'VAULT', cartes: set(20, 26) }]);
    r = prouverAlias(set(45), idx);
    verifier('réunion de deux sets disjoints de 25 et 20 paires : les deux retenus', [ids(r), r.refus], [['PRINC', 'VAULT'], null]);
    idx = indexerExternes([{ cle: 'PRINC', cartes: set(10) }, { cle: 'VAULT', cartes: set(5, 11) }]);
    r = prouverAlias(set(15), idx);
    verifier('mêmes parties à 10 et 5 paires : inclusions à sens unique, refusées et motivées', [ids(r), r.refus], [[], 'inclusion-a-sens-unique']);
    // 5 bis. UNE PETITE SOURCE « contenue » dans une grande liste (Extra Regulation Box → bw : 12 paires, couverture Bulbapedia 0,255) ne prouve rien (§31)
    idx = indexerExternes([{ cle: 'bw', cartes: set(12) }]);
    r = prouverAlias(set(47), idx);
    verifier('12 paires contenues dans 47 cartes : inclusion à sens unique, refusée', [ids(r), r.refus], [[], 'inclusion-a-sens-unique']);
    verifier('la même inclusion à 20 paires (nom concordant) est admise', ids(prouverAlias(set(80), indexerExternes([{ cle: 'bw', cartes: set(20) }]))), ['bw']);

    // 5 ter. (relecture 2, M2) la « règle 1 » (Bulbapedia ≥ 0,8 ET source ≥ 0,5) ne suffit plus seule : ≥ 0,8 dans les DEUX sens, ou ≥ 20 paires dont le nom concorde
    //        McDonald's Collection / MCD11 : 7 paires, couvertures 1 / 0,583 · exstarter… / svc : 15 paires, 0,938 / 0,714
    idx = indexerExternes([{ cle: 'MCD11', cartes: set(12) }]);
    r = prouverAlias(set(7), idx);
    verifier('7 paires, couvertures 1 / 0,583 : refus motivé (plus un alias)', [ids(r), r.refus, r.evalues[0].couvExterne], [[], 'inclusion-a-sens-unique', 0.583]);
    idx = indexerExternes([{ cle: 'svc', cartes: set(21) }]);
    r = prouverAlias(set(16), idx);
    verifier('15 paires, couvertures 0,938 / 0,714 : refus motivé', [ids(r), r.refus], [[], 'inclusion-a-sens-unique']);
    verifier('20 paires, couvertures 0,8 / 0,5 : admis (≥ 20 paires dont le nom concorde)', ids(prouverAlias(set(25), indexerExternes([{ cle: 'ok20', cartes: set(40) }]))), ['ok20']);
    verifier('table : 7 paires 1 / 0,583 rejetée', verifierTable({ intl: { alpha: { expansion: 'A', pkc: [{ cle: 'MCD11', paires: 7, couvBulba: 1, couvExterne: 0.583 }] } }, jp: {} }).length, 1);
    verifier('table : 20 paires 0,85 / 0,6 admise', verifierTable({ intl: { alpha: { expansion: 'A', pkc: [{ cle: 'x', paires: 20, couvBulba: 0.85, couvExterne: 0.6 }] } }, jp: {} }), []);

    // 6. trop peu de cartes pour prouver
    idx = indexerExternes([{ cle: 'PETIT', cartes: set(3) }]);
    r = prouverAlias(set(3), idx);
    verifier('3 cartes : preuve insuffisante', [ids(r), r.refus], [[], 'trop-peu']);

    // 7. le candidat contient le set de Bulbapedia mais est bien plus grand (couvB 1, couvE faible) : refusé
    idx = indexerExternes([{ cle: 'GRAND', cartes: [...set(10), ...set(40, 11, 'Autre')] }]);
    r = prouverAlias(set(10), idx);
    verifier('set externe 5 fois plus grand : refusé', [ids(r), r.refus], [[], 'aucun-candidat']);

    // 8. rival chevauchant mais plus faible : ignoré, le meilleur est retenu
    idx = indexerExternes([{ cle: 'BON', cartes: set(20) }, { cle: 'PETITRIVAL', cartes: set(6) }]);
    r = prouverAlias(set(20), idx);
    verifier('rival petit chevauchant (6 sur 20) : le meilleur seul', [ids(r), r.refus], [['BON'], null]);
    // 8 bis. rival chevauchant d'une taille comparable (12 sur 20) : on ne sait pas lequel est le bon → ambigu
    idx = indexerExternes([{ cle: 'BON', cartes: set(20) }, { cle: 'RIVAL', cartes: set(12) }]);
    r = prouverAlias(set(20), idx);
    verifier('rival chevauchant de taille comparable : ambigu', [ids(r), r.refus], [[], 'ambigu']);

    // 9. LA TABLE EST FERMÉE : chaque entrée porte sa preuve, au niveau des seuils
    const entree = (o = {}) => ({ expansion: 'Alpha', pkc: [{ cle: 'AAA', paires: 10, couvBulba: 1, couvExterne: 1 }], ...o });
    verifier('table valide', verifierTable({ intl: { alpha: entree() }, jp: {} }), []);
    verifier('entrée sans preuve : rejetée', verifierTable({ intl: { alpha: { expansion: 'Alpha', pkc: [{ cle: 'AAA' }] } }, jp: {} }).length, 1);
    verifier('preuve sous le seuil : rejetée', verifierTable({ intl: { alpha: entree({ pkc: [{ cle: 'AAA', paires: 2, couvBulba: 1, couvExterne: 1 }] }) }, jp: {} }).length, 1);
    verifier('table : inclusion à sens unique sous 20 paires (12 paires, couvertures 0,255 / 1) : rejetée', verifierTable({ intl: { alpha: entree({ pkc: [{ cle: 'bw', paires: 12, couvBulba: 0.255, couvExterne: 1 }] }) }, jp: {} }).length, 1);
    verifier('table : inclusion à sens unique à 25 paires : admise', verifierTable({ intl: { alpha: entree({ pkc: [{ cle: 'bw', paires: 25, couvBulba: 0.5, couvExterne: 1 }] }) }, jp: {} }), []);
    verifier('couverture faible dans les deux sens : rejetée', verifierTable({ intl: { alpha: entree({ pkc: [{ cle: 'AAA', paires: 10, couvBulba: 0.3, couvExterne: 0.3 }] }) }, jp: {} }).length, 1);
    verifier('jp : même exigence', verifierTable({ intl: {}, jp: { beta: { expansion: 'Beta', dossiers: [{ cle: 'sv1', paires: 9, couvBulba: 0.9, couvExterne: 0.9 }] } } }), []);
    verifier('conversion pour la confrontation', versTableConfronter({ intl: { alpha: entree({ tdx: [{ cle: 'S/Alpha', paires: 10, couvBulba: 1, couvExterne: 1 }] }) }, jp: { beta: { expansion: 'Beta', dossiers: [{ cle: 'sv1', paires: 9, couvBulba: 0.9, couvExterne: 0.9 }] } } }),
        { intl: { alpha: { pkc: ['AAA'], tdx: ['S/Alpha'] } }, jp: { beta: ['sv1'] } });
    return { ok, ko };
}
module.exports = { suite };

if (require.main === module) {
    const { ok, ko } = suite(require('./collecte-cartes/alias-sets-bulba'));
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exit(1);
}
