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
