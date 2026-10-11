'use strict';
// Ma collection — la FORME d'une clé de fiche (`idInterne|numero`) et d'un slug de set. Le serveur ne peut pas savoir si une clé désigne une fiche réelle (l'API ne lit jamais la base
// `cartes`) : il valide la forme, écrite par ce qu'elle AUTORISE. Le jeu de caractères est DÉRIVÉ des données du site (lecture seule) ; le dénominateur est imprimé.
const H = require('./_harnais');
const fs = require('fs'), path = require('path');
const F = require('../collection/forme');

// ── exemples : ce que le site envoie (lib/collectionContrat.ts : cleFiche = `${idInterne}|${numero ?? '-'}`)
const BONNES = ['895789|001', '1|-', '49569|Recommended Rules No. 2', '12|SWSH155 (Top Left)', '5|!', '5|?', '999999999999|TG01', '7|12/165'.replace('/', '')];
H.v('clés admises', BONNES.filter(c => !F.cleValide(c)), []);
// COLLECTION-COMPACTE, ruling 8 bis : une FICHE SIMPLE a un `_id` NÉGATIF (1 512 cartes à `_id < 0` le 2026-10-11 ; le site met l'`_id` de la carte dans `idInterne`, entreesDuSet.ts:293) → « -N|… »
H.v('fiches simples admises (idInterne négatif)', ['-12|-', '-286142|001', '-1|1', '-999999999999|TG01', '-767568|142'].filter(c => !F.cleValide(c)), []);
H.v('fiches simples : jamais -0, jamais --, jamais de zéro de tête, jamais de « + », jamais un signe seul', ['-0|1', '--1|1', '-01|1', '+1|1', '-|1', '- 1|1', '-1000000000000|1', '−5|1'].filter(c => F.cleValide(c)), []);
const MAUVAISES = ['', 'abc', '0|1', '01|1', '1.5|1', '1|', '1|a|b', '|1', '1|<script>', '1|a\nb', '1|a\u0000b', '1| 1', '1|1 ', '1|' + 'x'.repeat(40), '1000000000000|1', '１|1', '1|é', '1|a/b', '1|a%b', '1|a\\b', '1|"', "1|'", '1|a;b'];
H.v('clés refusées', MAUVAISES.filter(c => F.cleValide(c)), []);
H.v('une clé non-chaîne est refusée', [undefined, null, 5, {}, ['1|1']].filter(c => F.cleValide(c)), []);
const SLUGS_BONS = ['Dragon-Majesty', 'S-P/ID', '151', '30th-Celebration-JP', 'A', 'a'.repeat(80)];
H.v('slugs admis', SLUGS_BONS.filter(s => !F.slugValide(s)), []);
const SLUGS_MAUVAIS = ['', ' ', 'a b', '..', '.', '/', '/a', 'a/', 'a//b', '-a', 'a-', '<x>', 'a%2Fb', 'a\u0000', 'é', 'a.b', 'a'.repeat(81), 'a:b', 'a?b', 'a\\b'];
H.v('slugs refusés', SLUGS_MAUVAIS.filter(s => F.slugValide(s)), []);
H.v('un slug non-chaîne est refusé', [undefined, null, 5, {}].filter(s => F.slugValide(s)), []);
H.vrai('« | » est interdit dans le numéro, « - » seul est le numéro absent', !F.cleValide('1|a|b') && F.cleValide('1|-'));

// ── le contrat publié dit la MÊME forme que le code (deux écritures d'une règle divergent : §21 bis)
{
    const P = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'openapi.v2.json'), 'utf8')).components.parameters;
    H.v('openapi : le motif du slug est celui de forme.js', P.SlugDeSet.schema.pattern, F.SLUG.source);
    H.v('openapi : le motif de la clé est celui de forme.js (idInterne + « | » + numéro)', P.CleDeFiche.schema.pattern, '^-?[1-9][0-9]{0,11}\\|' + F.NUMERO.source.slice(1));
}
// ── dérivation depuis les données du site (lecture seule). Absentes : SAUT DIT.
const SITE = process.env.RM_SITE || 'C:\\Users\\Yung\\Desktop\\rat-market-site';
const fich = path.join(SITE, 'archives', 'CORRECTION-ILLUSTRATEURS.json');
if (!fs.existsSync(fich)) console.log(`   SAUT DIT : ${fich} absent de cette machine — jeu de caractères non confronté aux données du site`);
else {
    const lire = p => JSON.parse(fs.readFileSync(path.join(SITE, p), 'utf8'));
    const cles = new Set(), slugs = new Set();
    for (const x of lire('archives/CORRECTION-ILLUSTRATEURS.json').corrections) { cles.add(`${x.carte}|${x.numero ?? '-'}`); for (const s of x.sets || []) slugs.add(s); }
    for (const k of Object.keys(lire('lib/logos-officiels.json').logos)) slugs.add(k);
    for (const f of lire('LISTE-FICHES-SANS-VISUEL.json').fichesAvecRarete) { slugs.add(f.set); cles.add(`0|${f.numero}`.replace(/^0/, '1')); }
    const refCles = [...cles].filter(c => !F.cleValide(c)), refSlugs = [...slugs].filter(s => !F.slugValide(s));
    console.log(`   ${cles.size} clés et ${slugs.size} slugs examinés (CORRECTION-ILLUSTRATEURS.json, logos-officiels.json, LISTE-FICHES-SANS-VISUEL.json) : ${cles.size - refCles.length} clés et ${slugs.size - refSlugs.length} slugs admis`);
    console.log(`   refusés : clés ${JSON.stringify(refCles)} ; slugs ${JSON.stringify(refSlugs)}`);
    H.vrai('le dénominateur des clés n\'est pas vide (une sonde vide n\'est pas un vert)', cles.size > 1000 && slugs.size > 300);
    // les seuls refus connus sont des numéros CORROMPUS à la source (reste de commentaire wikitext « 102<!-- ») : déclarés, jamais admis
    H.v('les clés refusées sont exactement les numéros corrompus connus (« <!-- »)', refCles.filter(c => !/<!--$/.test(c)), []);
    H.v('aucun slug du site n\'est refusé', refSlugs, []);
    // la forme n'admet RIEN de plus que ce que les données montrent : chaque caractère admis pour un numéro apparaît dans les données (ou est le « / » du slug, admis par décision)
    const vus = new Set(); for (const c of cles) for (const ch of c.slice(c.indexOf('|') + 1)) vus.add(ch);
    const admis = new Set(F.CARACTERES_NUMERO.split(''));
    H.v('signes (hors lettres et chiffres) admis dans un numéro mais jamais vus dans les données', [...admis].filter(ch => !/[A-Za-z0-9]/.test(ch) && !vus.has(ch)).join(''), '');
    H.v('signes vus dans les données (hors lettres, chiffres, « | ») et refusés : seulement « < » (numéros corrompus)', [...vus].filter(ch => !/[A-Za-z0-9]/.test(ch) && !admis.has(ch)).join(''), '<');
}
H.bilan();
