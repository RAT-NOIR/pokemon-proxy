// ============================================================
// TESTS — départage d'une égalité parfaite par le symbole du set
// ============================================================
// ⚠️ ON PASSE LE MODULE scoring ENTIER, jamais un extrait fabriqué à la main. C'est ce
// qui a tué la production le 4 août : index.js passait { normaliserCodeSet, ALIAS,
// codesApparentes } à une fonction qui en déstructurait quatre, et 52 assertions vertes
// certifiaient un appel qui n'existait nulle part. Un test qui construit son propre objet
// à la place de celui de la production ne teste pas la production.
const S = require('./scoring');
const { departagerParSymbole, SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');

let echecs = 0;
function verifier(libelle, obtenu, attendu) {
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) { echecs++; console.log(`  ❌ ${libelle} : obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`); }
    else console.log(`  ✅ ${libelle}`);
}
const gagne = (sym, cands) => {
    const r = departagerParSymbole(sym, cands, S);
    return r.gagnant ? r.gagnant.idProduct : null;
};

// Les codes viennent de la table close elle-même — aucune valeur inventée.
const N3 = { idProduct: 606726, codeSet: 'N3' };    // couronne, fiable
const EC2 = { idProduct: 651967, codeSet: 'EC2' };   // e2, fiable
const EC2b = { idProduct: 651968, codeSet: 'EC2' };   // e2, fiable — même set
const N2 = { idProduct: 606579, codeSet: 'N2' };    // ruines, fiable
const G2 = { idProduct: 605387, codeSet: 'G2' };    // gym, NON fiable
const G1 = { idProduct: 999001, codeSet: 'G1' };    // gym, NON fiable
const EXP = { idProduct: 557645, codeSet: 'EXP' };   // logo-tcg, NON fiable
const DP5c = { idProduct: 698502, codeSet: 'DP5c' };  // symbole NON RELEVÉ (null)
const HORS = { idProduct: 794609, codeSet: 'SSP' };   // hors table close

console.log('--- 1. Le cas nominal : un seul ex aequo porte le symbole lu ---');
verifier('couronne départage N3 contre EC2', gagne('couronne', [EC2, N3]), 606726);
verifier('e2 départage EC2 contre N3', gagne('e2', [EC2, N3]), 651967);
verifier('ruines départage N2 contre EC2', gagne('ruines', [EC2, N2]), 606579);

console.log('\n--- 2. VERROU 1 : rien sans lecture explicite ---');
verifier('champ absent -> aucun départage', gagne(null, [EC2, N3]), null);
verifier('champ vide -> aucun départage', gagne('', [EC2, N3]), null);
verifier('espaces seuls -> aucun départage', gagne('   ', [EC2, N3]), null);
verifier('« illisible » -> aucun départage', gagne('illisible', [EC2, N3]), null);
verifier('« Illisible » majuscule -> aucun départage', gagne('Illisible', [EC2, N3]), null);
// « aucun » est une VRAIE réponse de l'énumération, mais aucun set de la table close ne la
// déclare : elle ne peut donc désigner personne. Inerte par construction, pas par garde.
verifier('« aucun » ne désigne aucun set de la table', gagne('aucun', [EC2, N3]), null);

console.log('\n--- 3. VERROU 2 : jamais un symbole marqué NON FIABLE ---');
// « gym » est porté par G1 ET G2 : il ne DÉSIGNE rien. Même seul face à un autre set.
verifier('gym ne départage pas, même seul candidat à le porter', gagne('gym', [G2, N3]), null);
verifier('gym ne départage pas entre G1 et G2', gagne('gym', [G1, G2]), null);
verifier('logo-tcg ne départage pas (EXP et WEB le partagent)', gagne('logo-tcg', [EXP, N3]), null);
// ⚠️ Ce cas est celui qui a été lu JUSTE une fois en production (Sabrina's Jynx, G2).
// Une lecture juste ne rachète pas un symbole qui ne désigne pas.
verifier('un gym lu JUSTE une fois ne le rend pas utilisable', gagne('gym', [G2, EC2]), null);

console.log('\n--- 4. VERROU 3 : exactement UN candidat, sinon on se tait ---');
verifier('deux ex aequo du MÊME set -> aucun départage', gagne('e2', [EC2, EC2b]), null);
verifier('deux ex aequo du même set + un autre -> aucun départage', gagne('e2', [EC2, EC2b, N3]), null);
verifier('aucun ex aequo ne porte le symbole lu', gagne('fossile', [EC2, N3]), null);
verifier('liste vide', gagne('couronne', []), null);

console.log('\n--- 5. VERROU 4 : `symbole: null` n\'est pas une correspondance ---');
// DP5c et ADVex1 ont symbole: null — NON RELEVÉ, pas « aucun ». L'absence de donnée ne
// peut ni gagner ni perdre. Voir le premier principe : une source perdue propage
// l'incertitude, elle ne la réduit pas.
verifier('un set au symbole non relevé ne gagne jamais', gagne('couronne', [DP5c, N3]), 606726);
verifier('... et ne bloque pas non plus le départage', gagne('ruines', [DP5c, N2]), 606579);
verifier('deux non relevés -> personne', gagne('croix', [DP5c, DP5c]), null);

console.log('\n--- 6. Un set hors table close ne porte aucun symbole déclaré ---');
verifier('SSP (moderne) ne peut pas correspondre', gagne('couronne', [HORS, N3]), 606726);
verifier('... et deux sets hors table -> personne', gagne('couronne', [HORS, HORS]), null);
verifier('codeSet null toléré', gagne('couronne', [{ idProduct: 1, codeSet: null }, N3]), 606726);

console.log('\n--- 7. La raison est toujours donnée, même sans gagnant ---');
verifier('raison présente sans lecture', typeof departagerParSymbole(null, [N3], S).raison, 'string');
verifier('raison présente sans correspondance', typeof departagerParSymbole('croix', [N3], S).raison, 'string');
verifier('raison présente avec ambiguïté', typeof departagerParSymbole('e2', [EC2, EC2b], S).raison, 'string');

console.log('\n--- 8. Cohérence de la table elle-même ---');
// Tout symbole DÉCLARÉ FIABLE doit être porté par UN SEUL set : sinon il ne départage
// rien et il est mal étiqueté. C'est ce contrôle qui a rendu « gym » et « logo-tcg »
// non fiables — il doit rester vrai à chaque ajout dans la table.
const parSymbole = new Map();
for (const s of SETS_VINTAGE_JAPONAIS) {
    if (s.symbole == null || s.symboleFiable === false) continue;
    if (!parSymbole.has(s.symbole)) parSymbole.set(s.symbole, []);
    parSymbole.get(s.symbole).push(s.code);
}
const partages = [...parSymbole.entries()].filter(([, v]) => v.length > 1);
verifier('aucun symbole FIABLE n\'est porté par deux sets', partages.map(([s, v]) => `${s}: ${v.join('/')}`), []);

console.log(echecs === 0 ? `\n🎉 ${'Tous les tests passent.'}` : `\n❌ ${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
