// TEST — les commentaires HTML sont retirés AVANT tout découpage (collecte-cartes/wikitext.js). Pur : aucune base, aucun réseau.
// Les deux formes réelles (Oddish SVP, Paradise Resort MEP) sont reproduites en fixtures SYNTHÉTIQUES.
const W = require('./collecte-cartes/wikitext');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const carte = lignes => `{{PokémoncardInfobox\n|cardname=Truc\n|jname=テスト\n|evostage=Basic\n|type=Grass\n|hp=50\n}}\n{{PokémoncardInfobox/Expansion\n|type=Grass\n${lignes}\n}}`;
const intl = f => f.impressions.filter(i => i.tirage === 'intl').map(i => [i.expansion, i.numero, i.total]);
const tous = f => f.impressions.map(i => [i.tirage, i.expansion, i.numero]);

// 1. forme réelle Oddish : le commentaire masque la ligne japonaise ET suit le numéro sans espace
const t1 = carte('|expansion={{TCG|SVP Black Star Promos}}\n|cardno=102<!--\n|jpexpansion={{TCG|SV-P Promotional cards}}\n|jpcardno=???/SV-P-->');
const f1 = W.faitsDeCarte(t1, 'Truc');
verifier('Oddish : numéro propre', intl(f1), [['SVP Black Star Promos', '102', null]]);
verifier('Oddish : aucune impression japonaise fantôme', tous(f1), [['intl', 'SVP Black Star Promos', '102']]);

// 2. forme réelle Paradise Resort : commentaire sans jpcardno
const t2 = carte('|expansion={{TCG|MEP Black Star Promos}}\n|cardno=092<!--\n|jpexpansion={{TCG|M-P Promotional cards}}-->');
const f2 = W.faitsDeCarte(t2, 'Truc');
verifier('Paradise Resort : numéro propre', tous(f2), [['intl', 'MEP Black Star Promos', '092']]);

// 3. commentaire jamais fermé : court jusqu'à la fin du texte (sémantique MediaWiki)
const t3 = carte('|expansion={{TCG|Base Set}}\n|cardno=5/102') + '\n<!-- note jamais fermée {{PokémoncardInfobox/Expansion|expansion={{TCG|Faux}}|cardno=9}}';
verifier('non fermé : le contenu est coupé', W.faitsDeCarte(t3, 'Truc').impressions.map(i => i.expansion), ['Base Set']);
verifier('sansCommentaires non fermé', W.sansCommentaires('a<!--b'), 'a');

// 4. commentaire sans `|`
verifier('sans barre', W.sansCommentaires('x<!-- note -->y'), 'xy');
verifier('non gourmand, plusieurs', W.sansCommentaires('1<!--a-->2<!--b\nc-->3'), '123');
const t4 = carte('|expansion={{TCG|Jungle}}<!-- bof -->\n|cardno=7<!-- ok -->/64');
verifier('commentaire sans barre dans une valeur', intl(W.faitsDeCarte(t4, 'Truc')), [['Jungle', '7', '64']]);

// 5. sans commentaire : inchangé
const t5 = carte('|expansion={{TCG|Fossil}}\n|cardno=12/62');
verifier('sans commentaire : identique', W.sansCommentaires(t5), t5);
verifier('sans commentaire : numéro', intl(W.faitsDeCarte(t5, 'Truc')), [['Fossil', '12', '62']]);

// 6. epurer ne garde rien du commentaire
verifier('épurer : plus de <!--', /<!--|jpexpansion/.test(W.epurer(t1)), false);

// 7. Setlist avec une entrée commentée
const set = `{{Setlist/header|title=Test}}\n{{Setlist/entry|001|{{TCG ID|Test|Alpha|1}}}}\n<!--{{Setlist/entry|002|{{TCG ID|Test|Beta|2}}}}-->\n{{Setlist/entry|003|{{TCG ID|Test|Gamma|3}}}}\n{{Setlist/footer}}`;
verifier('Setlist : entrée commentée absente', W.sectionsSetlist(set).flatMap(s => s.entrees.map(e => e.titre)).sort(), ['Alpha (Test 1)', 'Gamma (Test 3)'].sort());
const r = W.entreesDeLaSetlist(set, { expansion: 'Test' });
verifier('entreesDeLaSetlist : sans la commentée', r.entrees.map(e => e.titre).sort(), ['Alpha (Test 1)', 'Gamma (Test 3)'].sort());
// repli sur tout le wikitext (aucune section) : une référence commentée ne compte pas
const libre = `Texte {{TCG ID|Test|Alpha|1}} <!-- {{TCG ID|Test|Beta|2}} -->`;
verifier('repli : référence commentée absente', W.entreesDeLaSetlist(libre, { expansion: 'Test' }).entrees.map(e => e.titre), ['Alpha (Test 1)']);

console.log(`${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
