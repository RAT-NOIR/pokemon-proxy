// TEST — la lecture des entrées de Setlist (collecte-cartes/wikitext.js). Aucune base, aucun réseau.
//   node test-setlist.js      -> code 0 si tout passe
// Les entrées des deux premiers blocs sont RÉELLES, relevées le 2026-09-15 dans le wikitext des pages de set
// archivé sur R2 (certaines aplaties sur une ligne ; le cas du repli est une page synthétique autour d'une
// chaîne réelle). Le bloc « gardes » porte des formes HYPOTHÉTIQUES, tracées par la relecture du 2026-09-15 :
// elles ne sont pas dans le corpus mesuré, elles gardent les blocs à venir. Le défaut d'origine : seul
// `{{TCG ID|A|Nom|B}}` était lu ; les liens `[[Titre (Set N)|…]]{{suffixe}}` et les `{{TCG ID}}` à 4
// paramètres étaient ÉCARTÉS SANS UN MOT — 684 cartes au bloc 1 (+53 par le repli de BXY), 318 aux dix sets
// occidentaux, 9 au vintage.
const { sectionsSetlist, entreesDeLaSetlist, natureIgnoree } = require('./collecte-cartes/wikitext');

let ok = 0, ko = 0;
const verifier = (nom, cond, detail = '') => { if (cond) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); } };
const dansSection = (titre, ...entrees) => `{{Setlist/header|title=${titre}}}\n${entrees.join('\n')}\n{{Setlist/footer}}`;
const seule = (titre, brut) => sectionsSetlist(dansSection(titre, brut))[0];

// Formes réelles, avec leur set d'origine.
const VS_LUE = "{{Setlist/nmentry\n|001/141\n|{{TCG ID|VS|Falkner's Pidgeot|1}}\n|Colorless\n|\n|Common\n}}";
const EXP_NOTE_A_LIEN = "{{Setlist/nmentry\n|2/102\n|{{TCG ID|Base Set|Blastoise|2}}\n|Water\n|\n|\n|{{TCG|Celebrations}} Classic Collection \"[[Pokémon 25th Anniversary]]\" Stamp Holofoil reprint\n}}";
const M2A_TCGID_4 = '{{Setlist/entry |003/193 |I |{{TCG ID|MEGA Dream ex|Yanmega ex|3|Yanmega}}{{ex}} |Grass | |RR }}';
const S11_LIEN = '{{Setlist/entry |029/100 |F |[[Kyurem V (Lost Abyss 29)|Kyurem]]{{TCGV}} |Water | |RR }}';
const CP4_MEGA = '{{Setlist/nmentry |002/131 |{{Mega}}[[M Beedrill-EX (Premium Champion Pack 2)|Beedrill]]{{EX}} |Grass }}';
const BRS_TG = '{{Setlist/entry |TG13/TG30 |D |[[Boltund V (Brilliant Stars TG13)|Boltund]]{{TCGV}} |Lightning | |TGV }}';
const G2_SANS_NUMERO = "{{Setlist/nmentry |None |[[Blaine's Quiz 3 (Challenge from the Darkness)|Blaine's Quiz #3]] |Trainer | |Uncommon }}";
const PCG9_DEUX_LIENS = '{{Setlist/nmentry |015/068 |[[Mew ☆ δ (Offense and Defense of the Furthest Ends 15)|Mew]] {{Star}} [[Mew ☆ δ (Offense and Defense of the Furthest Ends 15)|δ]] |Water | |ShinyRare Holo }}';
const VS_ENERGIE = '{{Setlist/nmentry\n|None\n|{{TCG|Grass Energy}}\n|Energy\n|Grass\n|None\n}}';

console.log('forme déjà lue — ne doit pas bouger');
let s = seule('VS', VS_LUE);
verifier('TCG ID à 3 paramètres : titre « Falkner\'s Pidgeot (VS 1) »', s.entrees.length === 1 && s.entrees[0].titre === "Falkner's Pidgeot (VS 1)" && s.entrees[0].setReconstruit === 'VS 1', JSON.stringify(s.entrees));
s = seule('Base Set', EXP_NOTE_A_LIEN);
verifier('un lien sans parenthèse dans la colonne des notes n\'est pas pris pour la carte', s.entrees.length === 1 && s.entrees[0].titre === 'Blastoise (Base Set 2)', JSON.stringify(s.entrees));

console.log('\nformes écartées jusqu\'ici');
s = seule('MEGA Dream ex', M2A_TCGID_4);
verifier('TCG ID à 4 paramètres (affichage) : « Yanmega ex (MEGA Dream ex 3) »', s.entrees.length === 1 && s.entrees[0].titre === 'Yanmega ex (MEGA Dream ex 3)' && s.entrees[0].setReconstruit === 'MEGA Dream ex 3', JSON.stringify(s.entrees));
s = seule('Lost Abyss', S11_LIEN);
verifier('lien + {{TCGV}} : titre, nom, set et numéro', s.entrees.length === 1 && s.entrees[0].titre === 'Kyurem V (Lost Abyss 29)' && s.entrees[0].nom === 'Kyurem V' && s.entrees[0].a === 'Lost Abyss' && s.entrees[0].b === '29' && s.entrees[0].setReconstruit === 'Lost Abyss 29', JSON.stringify(s.entrees));
s = seule('Premium Champion Pack', CP4_MEGA);
verifier('lien précédé de {{Mega}} : « M Beedrill-EX (Premium Champion Pack 2) »', s.entrees.length === 1 && s.entrees[0].titre === 'M Beedrill-EX (Premium Champion Pack 2)', JSON.stringify(s.entrees));
s = seule('Brilliant Stars Trainer Gallery', BRS_TG);
verifier('numéro alphanumérique TG13 : b = « TG13 »', s.entrees.length === 1 && s.entrees[0].titre === 'Boltund V (Brilliant Stars TG13)' && s.entrees[0].b === 'TG13' && s.entrees[0].setReconstruit === 'Brilliant Stars TG13', JSON.stringify(s.entrees));
s = seule('Challenge from the Darkness', G2_SANS_NUMERO);
verifier('lien sans numéro : b nul, set = la parenthèse', s.entrees.length === 1 && s.entrees[0].titre === "Blaine's Quiz 3 (Challenge from the Darkness)" && s.entrees[0].b === null && s.entrees[0].setReconstruit === 'Challenge from the Darkness', JSON.stringify(s.entrees));
s = seule('Offense and Defense of the Furthest Ends', PCG9_DEUX_LIENS);
verifier('deux liens vers le même titre : UNE entrée', s.entrees.length === 1 && s.entrees[0].titre === 'Mew ☆ δ (Offense and Defense of the Furthest Ends 15)', JSON.stringify(s.entrees));

console.log('\nce qui n\'est pas une carte se COMPTE, il ne disparaît pas');
s = seule('VS', VS_ENERGIE);
verifier('énergie de base {{TCG|Grass Energy}} : aucune entrée', s.entrees.length === 0, JSON.stringify(s.entrees));
verifier('… et elle est comptée dans `ignorees`, avec son brut', Array.isArray(s.ignorees) && s.ignorees.length === 1 && s.ignorees[0].includes('Grass Energy'), JSON.stringify(s.ignorees));
const mixte = sectionsSetlist(dansSection('Lost Abyss', S11_LIEN, VS_LUE, VS_ENERGIE))[0];
verifier('section mixte : 2 entrées + 1 ignorée = 3 gabarits', mixte.entrees.length === 2 && mixte.ignorees?.length === 1, `entrées ${mixte.entrees.length}, ignorées ${mixte.ignorees?.length}`);

console.log('\nsymétrie (§21 bis) : le repli sur tout le wikitext lit les mêmes TCG ID');
const r = entreesDeLaSetlist("Page sans gabarit Setlist.\n* {{TCG ID|MEGA Dream ex|Yanmega ex|3|Yanmega}}{{ex}}\n", { expansion: 'MEGA Dream ex' });
verifier('repli : TCG ID à 4 paramètres lu', r.surToutLeWikitext && r.entrees.length === 1 && r.entrees[0].titre === 'Yanmega ex (MEGA Dream ex 3)', JSON.stringify(r));

console.log('\ngardes — formes hypothétiques (relecture du 2026-09-15)');
s = seule('Base Set', "{{Setlist/nmentry |4/102 |{{TCG ID|Base Set|Charizard|4}} |Fire | | |Reprint in [[Charizard (Base Set 2 4)|Base Set 2]] }}");
verifier('TCG ID dans la colonne du nom + lien de tirage dans les notes : le TCG ID gagne', s.entrees.length === 1 && s.entrees[0].titre === 'Charizard (Base Set 4)', JSON.stringify(s.entrees));
s = seule('Lost Abyss', "{{Setlist/entry |029/100 |F |[[Kyurem V (Lost Abyss 29)|Kyurem]]{{TCGV}} |Water | |RR |Reprint of {{TCG ID|Lost Origin|Kyurem V|48}} }}");
verifier('lien dans la colonne du nom + TCG ID dans les notes : le lien gagne', s.entrees.length === 1 && s.entrees[0].titre === 'Kyurem V (Lost Abyss 29)', JSON.stringify(s.entrees));
s = seule('Team Rocket', "{{Setlist/nmentry |4/82 |[[Dark Pokémon (TCG)|Dark]] {{TCG ID|Team Rocket|Dark Charizard|4}} |Fire | |Rare Holo }}");
verifier('un lien générique « (TCG) » avant la carte n\'est pas une carte : Dark Charizard', s.entrees.length === 1 && s.entrees[0].titre === 'Dark Charizard (Team Rocket 4)', JSON.stringify(s.entrees));
s = seule('Base Set', "{{Setlist/nmentry |None |[[Grass Energy (TCG)|Grass Energy]] |Energy | |None }}");
verifier('énergie de base en lien développé « (TCG) » : ignorée, pas une entrée', s.entrees.length === 0 && s.ignorees.length === 1, JSON.stringify(s));
s = seule('Base Set', "{{Setlist/nmentry |58/102 |{{TCG ID|Base Set|Pikachu|{{tt|58|holo}}}} |Lightning | |Common }}");
verifier('paramètre imbriqué {{tt|…}} : aucun titre contenant « {{ », entrée ignorée et comptée', s.entrees.every(e => !e.titre.includes('{{')) && s.ignorees.length === 1, JSON.stringify(s));
const avantEnTete = sectionsSetlist(`${VS_ENERGIE}\n{{Setlist/header|title=VS}}\n${VS_LUE}\n{{Setlist/footer}}`);
verifier('entrée illisible AVANT tout en-tête : section sans titre, ignorée comptée', avantEnTete[0].titre === '' && avantEnTete[0].entrees.length === 0 && avantEnTete[0].ignorees.length === 1 && avantEnTete[1].entrees.length === 1, JSON.stringify(avantEnTete.map(x => [x.titre, x.entrees.length, x.ignorees.length])));

console.log('\nla nature de ce qui est ignoré : une énergie SPÉCIALE a un tirage, elle ne se range pas avec les énergies de base');
verifier('{{TCG|Grass Energy}} : énergie de base', natureIgnoree(VS_ENERGIE) === 'energie-base', natureIgnoree(VS_ENERGIE));
verifier('{{OBP|Darkness Energy|Basic}} (s12a, réel) : énergie de base', natureIgnoree('{{Setlist/entry |257/172 |— |{{OBP|Darkness Energy|Basic}} |Energy |Darkness |SR }}') === 'energie-base');
verifier('{{OBP|Darkness Energy|Special}} (VS, réel) : énergie SPÉCIALE', natureIgnoree('{{Setlist/nmentry |None |{{OBP|Darkness Energy|Special}} |Energy |Darkness |None }}') === 'energie-speciale');
verifier('{{TCG|Double Colorless Energy}} : énergie SPÉCIALE', natureIgnoree('{{Setlist/nmentry |96/102 |{{TCG|Double Colorless Energy}} |Energy | |Uncommon }}') === 'energie-speciale');
verifier('autre chose : « autre »', natureIgnoree('{{Setlist/nmentry |None |Unknown |Trainer | |None }}') === 'autre');

console.log('\nsymétrie (§21 bis) : le repli sur tout le wikitext lit aussi les liens, sous le même filtre de nom');
const r2 = entreesDeLaSetlist("Page sans gabarit Setlist.\n* [[Kyurem V (Lost Abyss 29)|Kyurem]]{{TCGV}}\n* [[Lost Origin (TCG)|Lost Origin]]\n", { expansion: 'Lost Abyss' });
verifier('repli : le lien de tirage lu, le lien de set non', r2.surToutLeWikitext && r2.entrees.length === 1 && r2.entrees[0].titre === 'Kyurem V (Lost Abyss 29)', JSON.stringify(r2.entrees));
verifier('repli : « lues » compte les candidats AVANT le filtre de nom', r2.lues === 1 || r2.lues === 2, `lues ${r2.lues}`);

console.log('\nle compteur « hors set » : une entrée lue dans une section retenue dont le tirage n\'est pas ce set');
const h = entreesDeLaSetlist(dansSection('Lost Abyss', S11_LIEN, '{{Setlist/entry |017/100 |F |[[Delphox V (Lost Abyss 17)|Delphox]]{{TCGV}} |Fire | |RR }}', '{{Setlist/entry |098/100 |F |[[Collapsed Stadium (Star Birth 98)|Collapsed Stadium]] |Trainer | |U }}'), { expansion: 'Lost Abyss' });
verifier('section retenue : 3 entrées, 1 hors set nommée (réimpression sous le lien de son premier tirage, s11)', h.entrees.length === 3 && Array.isArray(h.horsSet) && h.horsSet.length === 1 && h.horsSet[0] === 'Collapsed Stadium (Star Birth 98)', JSON.stringify({ n: h.entrees.length, horsSet: h.horsSet }));
// VS, réel : section « Pokémon Card★VS », expansion « Pokémon VS », jeton des TCG ID « VS ». Le compteur criait sur
// les 142 entrées (second rejeu du 2026-09-15) — un contrôle qui crie sur un cas normal est contourné (§25).
const VS_FEAROW = "{{Setlist/nmentry\n|002/141\n|{{TCG ID|VS|Falkner's Fearow|2}}\n|Colorless\n|\n|Common\n}}";
const hv = entreesDeLaSetlist(dansSection('Pokémon Card★VS', VS_LUE, VS_FEAROW), { setlist: ['Pokémon Card★VS'], expansion: 'Pokémon VS' });
verifier('le jeton DOMINANT de la section vaut nom de set : VS, 0 hors set', hv.entrees.length === 2 && hv.horsSet.length === 0, JSON.stringify({ n: hv.entrees.length, horsSet: hv.horsSet }));

console.log(`\n${ok} / ${ok + ko} vérifications`);
process.exit(ko ? 1 : 0);
