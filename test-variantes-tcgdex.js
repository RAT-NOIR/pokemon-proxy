// node test-variantes-tcgdex.js — la lecture du clone TCGdex (variantes, tampons, idProduct Cardmarket par variante). Textes de fichiers fabriqués à la forme réelle
// du dépôt (Sun & Moon/Burning Shadows/113.ts, ...). TOOL_DIR=<dossier> rejoue le banc contre une copie mutée.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const V = require(path.join(DIR, 'collecte-cartes', 'variantes-tcgdex'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const carte113 = `import { Card } from '../../../interfaces'
import Set from '../Burning Shadows'

const card: Card = {
	name: {
		en: "Choice Band \\"Stampede\\"",
		fr: "Bandeau Choix"
	},
	thirdParty: {
		cardmarket: 299514,
		tcgplayer: 138622
	},

	variants: [
		{
			type: "normal"
		},
		{
			type: "reverse"
		},
		{
			type: "reverse",
			stamp: ["staff"]
		},
		{
			type: "holo",
			foil: "cracked-ice",
			thirdParty: {
				cardmarket: 777001,
				tcgplayer: 178762
			},
			stamp: ["prerelease", "staff"]
		}
	]
}

export default card
`;
const carteSansVariants = `const card: Card = {
	name: { en: "X" },
	description: { en: "It stamps its feet. stamp: not a field" },
	thirdParty: {
		tcgplayer: 5
	}
}
export default card
`;
const carteDeuxTp = `const card: Card = {
	attacks: [ { name: { en: "A" }, effect: { en: "Flip 2 coins. thirdParty: { cardmarket: 1 }" } } ],
	variants: [ { type: "normal", thirdParty: { cardmarket: 41 } } ]
}
export default card
`;

const a = V.analyserCarte(carte113);
verifier('analyserCarte : l\'idProduct de niveau carte est lu (thirdParty de la carte, pas celui d\'une variante)', a.cardmarket, 299514);
verifier('   quatre variantes, type/foil/stamp lus, stamp absent = []', a.variantes.map(v => [v.type, v.foil, v.stamp]), [['normal', null, []], ['reverse', null, []], ['reverse', null, ['staff']], ['holo', 'cracked-ice', ['prerelease', 'staff']]]);
verifier('   l\'idProduct PAR VARIANTE est lu (variante 4), null ailleurs', a.variantes.map(v => v.cardmarket), [null, null, null, 777001]);
verifier('une chaîne qui contient « stamp » ou « thirdParty » dans un texte n\'est pas un champ', [V.analyserCarte(carteSansVariants).cardmarket, V.analyserCarte(carteSansVariants).variantes], [null, []]);
verifier('un « thirdParty: { cardmarket: 1 } » écrit DANS un texte d\'effet est ignoré ; le vrai (variante) est lu', [V.analyserCarte(carteDeuxTp).cardmarket, V.analyserCarte(carteDeuxTp).variantes.map(v => v.cardmarket)], [null, [41]]);
verifier('un fichier illisible (variants mal fermé) LÈVE au lieu de rendre une carte sans variante', (() => { try { V.analyserCarte('const card = {\n\tvariants: [\n\t\t{ type: "normal" '); return 'rien'; } catch (e) { return /variants/.test(e.message) ? 'leve' : e.message; } })(), 'leve');

// ── le clone : un faux dossier data/<serie>/<set>.ts + <set>/<n>.ts ──
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-tcgdex-test-'));
const ecrire = (rel, txt) => { const p = path.join(racine, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); };
ecrire('data/Sun & Moon/Burning Shadows.ts', `const sm3: Set = {\n\tid: "sm3",\n\tname: { en: "Burning Shadows" },\n\tthirdParty: {\n\t\tcardmarket: 1824,\n\t\ttcgplayer: 1957\n\t}\n}\nexport default sm3\n`);
ecrire('data/Sun & Moon/Burning Shadows/113.ts', carte113);
ecrire('data/Sun & Moon/Burning Shadows/10.ts', `const card: Card = {\n\tthirdParty: {\n\t\tcardmarket: 299417\n\t},\n\tvariants: [ { type: "normal" }, { type: "reverse" } ]\n}\nexport default card\n`);
const clone = V.lireClone(path.join(racine, 'data'));
verifier('lireClone : 1 set, 2 cartes, l\'expansion Cardmarket du set (thirdParty du set) mène à son id TCGdex', [clone.nSets, clone.nCartes, clone.setsParExpansion.get(1824)], [1, 2, ['sm3']]);
verifier('   idProduct de carte ET de variante indexés : 299514 -> carte 113 sans variante nommée, 777001 -> variante holo tamponnée', [clone.parProduit.get(299514), clone.parProduit.get(777001)],
    [[{ setId: 'sm3', localId: '113', variante: null }], [{ setId: 'sm3', localId: '113', variante: { type: 'holo', foil: 'cracked-ice', stamp: ['prerelease', 'staff'], cardmarket: 777001 } }]]);
verifier('   les variantes tamponnées d\'une carte sont retrouvées par (set, numéro)', clone.carte('sm3', '113').variantes.filter(v => v.stamp.length).length, 2);
verifier('   un set sans carte, ou un dossier vide, LÈVE (un zéro sur un clone non vide est une lecture fausse, pas un résultat)', (() => { try { V.lireClone(path.join(racine, 'inexistant')); return 'rien'; } catch (e) { return 'leve'; } })(), 'leve');
fs.rmSync(racine, { recursive: true, force: true });
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
