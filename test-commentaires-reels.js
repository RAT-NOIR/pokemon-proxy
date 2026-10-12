// TEST — non-régression des commentaires HTML sur deux wikitexts RÉELS archivés (R7, 2026-10-12).
// Oddish SVP 102 (295618) : « cardno=102<!-- » + une impression japonaise fantôme tirée du texte commenté.
// Mega Malamar ex Delta Reign 69 (358758) : un bloc d'impression « Delta Reign XXX/103 » entièrement commenté (31 fantômes
// de ce genre sur 20 cartes de Storm Emeralda en base). Les fixtures sont les pages telles que l'archive R2 les porte.
// Pur : aucune base, aucun réseau.
const fs = require('fs');
const path = require('path');
const W = require('./collecte-cartes/wikitext');
const TI = require('./collecte-cartes/tirage-image');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const fx = nom => fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'r47-fixtures', `${nom}.wikitext`), 'utf8');
const brut = i => `${i.tirage}|${i.expansion}|${i.numero}|${i.total}|${i.rarete ?? ''}`;

// Oddish
const od = fx('oddish-svp-102');
verifier('Oddish : la page archivée porte bien un commentaire', od.includes('<!--'), true);
const fo = W.faitsDeCarte(od, 'Oddish (SVP Promo 102)');
verifier('Oddish : une seule impression, intl, n° 102, sans reste de commentaire', fo.impressions.map(brut), ['intl|SVP Black Star Promos|102|null|']);
verifier('Oddish : aucune impression japonaise', fo.impressions.filter(i => i.tirage === 'jp').length, 0);

// Mega Malamar
const ma = fx('mega-malamar-ex-delta-reign-69');
verifier('Malamar : la page archivée porte bien un commentaire', ma.includes('<!--'), true);
const fm = W.faitsDeCarte(ma, 'Mega Malamar ex (Delta Reign 69)');
verifier('Malamar : seule l\'impression réelle (069/103) est lue, pas la commentée (XXX/103)', fm.impressions.filter(i => i.expansion === 'Delta Reign').map(brut), ['intl|Delta Reign|069|103|Double Rare']);
verifier('Malamar : aucune impression ne porte de marqueur de commentaire ni de numéro XXX', fm.impressions.filter(i => /<!--|-->|XXX/.test(brut(i))).length, 0);
// (le commentaire se ferme AVANT `jpexpansion` : le second bloc japonais, SR 094/076, est hors commentaire et reste lu)
verifier('Malamar : les deux impressions japonaises Storm Emeralda hors commentaire sont conservées', fm.impressions.filter(i => i.tirage === 'jp').map(i => `${i.expansion}|${i.numero}|${i.total}`), ['Storm Emeralda|048|076', 'Storm Emeralda|094|076']);

// L'AUTRE extracteur qui lit le wikitext brut : tirage-image.js (fichiers et paires jp/occidental) découpait avant d'ôter les commentaires.
const jumeaux = TI.pairesJaponaisOccidental(od);
verifier('tirage-image : la paire jp commentée d\'Oddish n\'existe pas', [...jumeaux.keys(), ...jumeaux.jumeaux.keys()], []);
const synth = '{{PokémoncardInfobox\n|cardname=Truc\n|image=TrucA.jpg\n|caption={{TCG|Set A}}<!--\n|reprint1=TrucFantome.jpg\n|recaption1={{TCG|Set A}}-->\n}}\n{{PokémoncardInfobox/Expansion\n|expansion={{TCG|Set A}}\n|cardno=1/10<!--\n|jpexpansion={{TCG|Set J}}\n|jpcardno=7/10-->\n}}';
verifier('tirage-image : un fichier commenté (reprint1) n\'est pas une image de la page', TI.fichiersDeLaPage(synth, [{ tirage: 'intl', expansion: 'Set A', numero: '1' }]).map(f => f.fichier), ['TrucA.jpg']);
verifier('tirage-image : la paire jp commentée ne crée pas de jumeau', [...TI.pairesJaponaisOccidental(synth).jumeaux.keys()], []);

// La garde du commit du worker : tout module que collecteur-images-bulba.js charge, directement ou non, pour lire les commentaires (I1)
const { REGLES } = require('./remettre-en-file');
const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const requisLocaux = f => [...lire(f).matchAll(/require\('\.\/([^']+)'\)/g)].map(m => path.posix.join(path.posix.dirname(f), m[1]).replace(/(\.js)?$/, '.js'));
const fermeture = (f, vus = new Set()) => { for (const d of requisLocaux(f)) if (!vus.has(d) && fs.existsSync(path.join(__dirname, d))) { vus.add(d); fermeture(d, vus); } return vus; };
const chaine = fermeture('collecte-cartes/tirage-image.js');
verifier('REGLES surveille tirage-image.js et toute sa fermeture locale', ['collecte-cartes/tirage-image.js', ...chaine].filter(f => !REGLES.includes(f)), []);
verifier('la fermeture de tirage-image.js contient wikitext.js (sansCommentaires)', chaine.has('collecte-cartes/wikitext.js'), true);

console.log(`${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
