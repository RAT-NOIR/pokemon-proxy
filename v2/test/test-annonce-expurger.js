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
let n = 0;
for (const [t, nom] of retire) {
    const r = expurger(`Pikachu holo, écrivez-moi ${t} merci`);
    H.vrai(`retire : ${nom}`, r.retraits >= 1 && !r.texte.includes(t) && r.texte.includes('Pikachu holo')); n++;
}
const garde = ['Pikachu 4/102 holo, 1re édition, SV-P 025', 'lot 25 30 45 60 80 101', 'Dracaufeu 006/165 reverse', 'prix 15,50 EUR, envoi 2,99 €',
    'année 2021, set Écarlate et Violet', 'PSA 10 numéro 123456', 'neuf sans étiquette, jamais jouée', 'vendue avec sleeve et toploader', 'Mewtwo-V 072/078 Pokémon GO',
    'Zapdos 1/ 102 – 2 exemplaires', 'carte n° 20 21 22 23 24 25 26', 'ex 1999-2000 1ère édition',
    'SV-P 143', 'vendu le 12/03/2026, état 9.5', 'lot 10 20 30 40 50 60 70'];
for (const t of garde) { const r = expurger(t); H.v(`garde intact : ${t}`, [r.texte, r.retraits], [t, 0]); }
console.log(`${retire.length} cas à retirer, ${garde.length} cas à garder`);
const a = expurger('appelez 0612345678 ou jean@x.fr'); H.vrai('retire les deux', a.retraits === 2);
H.v('idempotence', expurger(a.texte).retraits, 0);
H.v('non-texte : chaîne vide', expurger(undefined), { texte: '', retraits: 0 });
H.v('non-texte : nombre', expurger(42), { texte: '', retraits: 0 });
H.vrai('entrée de 100 000 caractères : traitée en moins de 200 ms (pas de motif catastrophique)', (() => { const t0 = Date.now(); expurger('a1 '.repeat(33000) + '0 6 1 2 '.repeat(2000)); return Date.now() - t0 < 200; })());
H.vrai('pire cas « + » répété : moins de 200 ms', (() => { const t0 = Date.now(); expurger('+1 '.repeat(30000)); return Date.now() - t0 < 200; })());
H.bilan();
