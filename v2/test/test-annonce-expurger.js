'use strict';
const H = require('./_harnais'); const { expurger } = require('../annonce/expurger');
const retire = [
    ['06 12 34 56 78', 'téléphone FR espacé'], ['0612345678', 'téléphone FR d\'un bloc'], ['06.12.34.56.78', 'téléphone FR à points'],
    ['+33 6 12 34 56 78', 'international FR'], ['+44 7700 900123', 'international UK'], ['0033612345678', '00 33'],
    ['jean.dupont@gmail.com', 'e-mail'], ['https://www.vinted.fr/items/123-pika', 'lien https'], ['www.monsite.fr/boutique', 'lien www'], ['monsite.fr', 'domaine nu'],
    ['@jean_dupont', 'pseudo @'], ['snap: jeandu75', 'réseau nommé sans @'], ['ig: jean.dupont', 'instagram'], ['whatsapp : 0612345678', 'whatsapp'],
    // plus strict que le brief : formats que l'extension retire aussi (même règle des deux côtés)
    ['00 44 7700 900123', '00 international espacé'], ['insta jean.cartes', 'réseau nommé sans séparateur (comme l\'extension)'],
    ['telegram @jean_cartes', 'réseau + @'], ['+1 (415) 555-0132', 'international US à parenthèses']
];
// --- tour de correction 1 (relecture B5-I1/I2/I3) : cas qui PASSAIENT et doivent être retirés ---
retire.push(
    ['06  12  34  56  78', 'double espace'], ['06/12/34/56/78', 'barres'], ['(06) 12 34 56 78', 'indicatif entre parenthèses'],
    ['06​12​34​56​78', 'espaces de largeur nulle'], ['06­12­34­56­78', 'trait d\'union conditionnel'],
    ['06 12 34 56 78', 'espaces insécables'], ['0 6 1 2 3 4 5 6 7 8', 'chiffres isolés'],
    ['07700 900123', 'UK sans +'], ['415 555 0132', 'US'], ['(415) 555-0132', 'US parenthèses'],
    ['jean [at] gmail [dot] com', 'e-mail [at] [dot]'], ['jean(at)gmail.com', 'e-mail (at)'], ['jean at gmail.com', 'e-mail « at »'],
    ['jean arobase gmail point com', 'e-mail arobase/point'], ['jean.dupont @ gmail.com', 'e-mail avec espaces autour de @'],
    ['bit.ly/3abcd', 'lien court bit.ly'], ['t.me/jeancartes', 't.me'], ['discord.gg/abc123', 'discord.gg'], ['linktr.ee/jean', 'linktr.ee'],
    ['ig jean.cartes', 'ig sans séparateur'], ['tg: jeancartes', 'tg:'], ['sc: jeandu75', 'sc:'], ['@jd', 'pseudo de 2 caractères'],
    ['Dracaufeu.fr', 'domaine nu .fr (dans le doute, retirer)'], ['mon site etat.de', 'TLD ambigu derrière « site »'],
    // ambiguïté : forme de téléphone ET de liste => la vie privée l'emporte
    ['05 10 15 20 25', 'AMBIGU : liste en forme de téléphone FR'], ['01 02 03 04 05', 'AMBIGU : 01 02 03 04 05']
);
// --- tour de correction 2 (re-relecture) : ENTRÉES EXACTES de la sonde. Sortie stricte : aucun chiffre / aucun « jean » ne doit survivre ---
const fuiteTel = ['+ 33 6 12 34 56 78', '06•12•34•56•78', '06 • 12 • 34 • 56 • 78', '06📞12📞34📞56📞78', '06*12*34*56*78', '06,12,34,56,78', '06_12_34_56_78',
    '0️⃣6️⃣ 1️⃣2️⃣ 3️⃣4️⃣ 5️⃣6️⃣ 7️⃣8️⃣', '(0)6 12 34 56 78', '0 6 12 34 56 78', 'o6 12 34 56 78', 'O6 12 34 56 78', '+ 44 7700 900123', '00 33 6 12 34 56 78'];
const fuiteJean = ['jean@gmail.\ncom', 'jean @ gmail . com', 'jean@gmail,com', 'jean@gmail·com', 'jean ＠ gmail ． com', 'jean[@]gmail.com', 'jean.cartes.fr',
    'insta → jean.cartes', 'insta -> jean.cartes', 'insta ➜ jean', 'insta - jean.cartes', 'instagram — jean_cartes', 'tiktok → jean', 'ig → jean', 'telegram → jean',
    'sur insta, jean.cartes', 'Snap⁚jean', 'tg → jean', 'jean (at) gmail (dot) com'];
for (const t of fuiteTel) { const r = expurger(`Pikachu holo, écrivez-moi ${t} merci`); H.vrai(`strict téléphone : ${JSON.stringify(t)} -> ${JSON.stringify(r.texte)}`, !/\d/.test(r.texte) && r.texte.includes('Pikachu holo') && r.retraits >= 1); }
for (const t of fuiteJean) { const r = expurger(`Pikachu holo, écrivez-moi ${t} merci`); H.vrai(`strict pseudo/e-mail : ${JSON.stringify(t)} -> ${JSON.stringify(r.texte)}`, !/jean/i.test(r.texte) && r.texte.includes('Pikachu holo') && r.retraits >= 1); }
// faux positifs (la décision interdit de retirer prix et dates) : sortie IDENTIQUE
const intactes = ['Lot at 5.50 euros, NM at 12.50€', 'Carte mint at 3.5 euros', 'Reçu le 05/10/2026 15 cartes', 'Le 06/10/2026 15 exemplaires restants',
    'sur insta ou whatsapp possible', 'paiement via facebook marketplace', 'je suis en discord avec vous', 'Snap Ball Pokemon Dresseur', 'cartes 05, 10, 15, 20, 25 en lot'];
for (const t of intactes) { const r = expurger(t); H.v(`intact : ${t}`, [r.texte, r.retraits], [t, 0]); }
// les 10 descriptions réalistes du relecteur : 10/10 sans perte
const reelles = [
    'Dracaufeu ex 125/197 Flammes Obsidiennes (EV03), état NM, jamais joué, sous sleeve. Prix 12,50 € ou 20 € les deux. Envoi suivi 4,99 €.',
    'Lot de 50 cartes Pokémon dont 3 holo, 12 reverse. Vendu comme sur photos. Pas d\'échange. Remise en main propre possible à Lyon.',
    'Pikachu Illustrator promo CoroCoro 1998 reproduction, état 9/10. SV-P 143 et SVP 085 aussi disponibles.',
    'PSA 10 Gem Mint - Mew ex 232/091 Destinées de Paldea (SV4.5) - cert 71234567 - 2023 - prix ferme 85 euros',
    'Display Écarlate et Violet 151 (EV3.5) 36 boosters neuf scellé, 2023, 169,90 €. Le 06/10/2026 15 exemplaires restants.',
    'Carte Dracaufeu base set 4/102 édition 1 ombré état LP/MP 150 € - pas de négociation - lot 001 002 003 004 005 dispo',
    'Booster Epée et Bouclier Tempête Argentée SWSH12 x 10 pour 35 euros. Tyranocif VSTAR 3/3 TG 12/30 inclus. NM.',
    'Rayquaza VMAX alt 218/203 CGC 9.5 Pristine. Acheté 2022 pour 400€. Offre à partir de 300€.',
    'ETB Évolutions Prismatiques (SV8.5) 2025, 59,99€ boîte intacte, Pokémon Center Exclusive, carte promo SVP 150 incluse',
    'Collection 25 30 45 60 80 101 cartes numérotées de 001/165 à 165/165, états 8/10 à 9.5/10'];
for (const t of reelles) { const r = expurger(t); H.v(`description réaliste intacte (${t.slice(0, 30)}…)`, [r.texte, r.retraits], [t, 0]); }
// troncature DITE
{
    const { preparerAnnonce: pa } = require('../annonce/verifier'); const c0 = require('../config').lireConfig({ MONGODB_BASE: 'test_scratch' });
    H.v('expurger dit la troncature', [expurger('a '.repeat(2600)).tronque, expurger('a '.repeat(100)).tronque], [true, false]);
    H.v('description > 5000 car. : expurgeeParServeur vrai', pa({ description: 'Dracaufeu NM. '.repeat(400) }, c0).expurgeeParServeur, true);
    H.v('titre > 5000 car. : expurgeeParServeur vrai', pa({ title: 'x '.repeat(3000) }, c0).expurgeeParServeur, true);
    H.v('description de 4 000 car. (coupée à 2 000 mais pas tronquée à l\'entrée) : drapeau faux', pa({ description: 'Dracaufeu NM. '.repeat(285) }, c0).expurgeeParServeur, false);
}
let n = 0;
for (const [t, nom] of retire) {
    const r = expurger(`Pikachu holo, écrivez-moi ${t} merci`);
    H.vrai(`retire : ${nom}`, r.retraits >= 1 && !r.texte.includes(t) && r.texte.includes('Pikachu holo')); n++;
}
const garde = ['Pikachu 4/102 holo, 1re édition, SV-P 025', 'lot 25 30 45 60 80 101', 'Dracaufeu 006/165 reverse', 'prix 15,50 EUR, envoi 2,99 €',
    'année 2021, set Écarlate et Violet', 'PSA 10 numéro 123456', 'neuf sans étiquette, jamais jouée', 'vendue avec sleeve et toploader', 'Mewtwo-V 072/078 Pokémon GO',
    'Zapdos 1/ 102 – 2 exemplaires', 'carte n° 20 21 22 23 24 25 26', 'ex 1999-2000 1ère édition',
    'SV-P 143', 'vendu le 12/03/2026, état 9.5', 'lot 10 20 30 40 50 60 70',
    // tour de correction 1 : ce qui n'a pas la forme d'un téléphone RESTE
    '001 002 003 004 005', 'n° 001 002 003 004', 'lot 001 002 003', 'ex.eu', 'etat.de', 'carte.es', '+10 20 30 40', 'PSA 9.5/10', 'ratio 1.5/10 soit 4.5/10',
    'lot 25 30 45 60 80 101 120', 'cartes 12 13 14 15 16 17', 'Pikachu at home', 'prix 100 EUR le 2021'];
for (const t of garde) { const r = expurger(t); H.v(`garde intact : ${t}`, [r.texte, r.retraits], [t, 0]); }
console.log(`${retire.length} cas à retirer, ${garde.length} cas à garder`);
const a = expurger('appelez 0612345678 ou jean@x.fr'); H.vrai('retire les deux', a.retraits === 2);
H.v('idempotence', expurger(a.texte).retraits, 0);
H.v('non-texte : chaîne vide', expurger(undefined), { texte: '', retraits: 0 });
H.v('non-texte : nombre', expurger(42), { texte: '', retraits: 0 });
H.vrai('entrée de 100 000 caractères : traitée en moins de 200 ms (pas de motif catastrophique)', (() => { const t0 = Date.now(); expurger('a1 '.repeat(33000) + '0 6 1 2 '.repeat(2000)); return Date.now() - t0 < 200; })());
// I2 : le PIRE cas (suites sans espace) sous 50 ms, par expurger ET par preparerAnnonce (20 000 caractères par champ)
const { preparerAnnonce } = require('../annonce/verifier'); const cfg = require('../config').lireConfig({ MONGODB_BASE: 'test_scratch' });
const pires = { 'lettres': 'a'.repeat(20000), 'lettres 100k': 'a'.repeat(100000), 'ab-': 'ab-'.repeat(7000), 'a.': 'a.'.repeat(10000), 'plus': '+1 '.repeat(7000),
    'chiffres': '1'.repeat(20000), 'zéro-chiffres': '0 1 '.repeat(5000), 'at': 'a at '.repeat(4000), 'arobase': 'x@'.repeat(10000), 'crochets': '[at]'.repeat(5000) };
for (const [nom, t] of Object.entries(pires)) {
    const t0 = process.hrtime.bigint(); expurger(t); preparerAnnonce({ title: t, description: t }, cfg);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6; H.vrai(`pire cas « ${nom} » (${t.length} car.) : ${ms.toFixed(1)} ms < 50`, ms < 50);
}
H.bilan();
