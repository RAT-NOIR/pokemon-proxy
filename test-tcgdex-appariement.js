// node test-tcgdex-appariement.js — quelle carte TCGdex est CETTE impression internationale ? Le numéro, et le nom comme
// TÉMOIN (temoinDuNom, la fonction de production) : « 0 ambigu ne veut pas dire 0 faux ». Un illustrateur ou un scan posé
// sur la mauvaise impression est un mensonge au client ; une impression sans réponse est un trou, qui se compte.
const { apparierExpansion } = require('./collecte-cartes/tcgdex-appariement');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const E = 'Evolving Skies';
const carte = (id, nomEn, ...numeros) => ({ _id: id, nomEn, attaques: [], impressions: [{ tirage: 'jp', expansion: 'Eevee Heroes', numero: '001' }, ...numeros.map(numero => ({ tirage: 'intl', expansion: E, numero }))] });
const tcg = (localId, name, illustrator = 'X') => ({ id: `swsh7-${localId}`, localId, name, illustrator, image: `u/${localId}` });
const resume = R => R.map(r => `${r.carte._id}@${r.index}:${r.tcg ? r.tcg.id : r.motif}`);

// 1. le numéro, et le même nom
verifier('numéro et nom concordent', resume(apparierExpansion(E, [carte(1, 'Pinsir', '1')], [tcg('1', 'Pinsir')])), ['1@1:swsh7-1']);
// 2. l'index est celui de l'impression DANS la carte (l'impression jp est à 0) ; deux tirages du même set
verifier('deux impressions du même set, deux réponses', resume(apparierExpansion(E, [carte(2, 'Umbreon VMAX', '95', '215')], [tcg('95', 'Umbreon VMAX'), tcg('215', 'Umbreon VMAX')])), ['2@1:swsh7-95', '2@2:swsh7-215']);
// 3. numéros croisés : le nom de la carte TCGdex désigne l'AUTRE carte du set — refusé des deux côtés
verifier('numéros croisés : contredits par le nom', resume(apparierExpansion(E, [carte(3, 'Black Kyurem-EX', '85'), carte(4, 'White Kyurem-EX', '84')], [tcg('85', 'White Kyurem-EX'), tcg('84', 'Black Kyurem-EX')])), ['3@1:contredite-par-le-nom', '4@1:contredite-par-le-nom']);
// 4. un écart de FORME (le nom ne désigne aucune autre carte du set) : le témoin se tait, la réponse passe
verifier('écart de forme : accepté', resume(apparierExpansion(E, [carte(5, "Professor's Research", '147')], [tcg('147', "Professor's Research (Professor Rowan)")])), ['5@1:swsh7-147']);
// 5. absente de TCGdex
verifier('absente de TCGdex', resume(apparierExpansion(E, [carte(6, 'Hoppip', '2')], [])), ['6@1:absente-de-tcgdex']);
// 6. un numéro porté par deux cartes TCGdex : ambigu, même si les noms concordent
verifier('numéro double chez TCGdex', resume(apparierExpansion(E, [carte(7, 'Eevee', '125')], [tcg('125', 'Eevee'), { ...tcg('125', 'Eevee'), id: 'swsh7-125a' }])), ['7@1:numero-ambigu-chez-tcgdex']);
// 7. un numéro porté par deux de NOS cartes : ambigu (un numéro qui désigne deux cartes ne désigne rien)
verifier('numéro double chez nous', resume(apparierExpansion(E, [carte(8, 'Eevee', '125'), carte(9, 'Flareon', '125')], [tcg('125', 'Eevee')])), ['8@1:numero-ambigu-chez-nous', '9@1:numero-ambigu-chez-nous']);
// 8. le préfixe se garde (cleNumero) : TG01 n'est pas 1
verifier('TG01 ne répond pas au n°1', resume(apparierExpansion(E, [carte(10, 'Pikachu', 'TG01')], [tcg('1', 'Pikachu')])), ['10@1:absente-de-tcgdex']);
// 9. les impressions d'une AUTRE expansion ne sont pas traitées
verifier('seule l\'expansion demandée', apparierExpansion(E, [carte(11, 'Pinsir')], [tcg('1', 'Pinsir')]).length, 0);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
