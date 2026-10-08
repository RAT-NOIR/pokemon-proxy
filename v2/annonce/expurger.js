'use strict';
// Expurgation CÔTÉ SERVEUR des coordonnées d'un vendeur (téléphones, e-mails, liens, pseudos).
// Même règle que l'extension (extension v2/src/commun/vie-privee.js), au moins aussi stricte, SANS casser les numéros de cartes
// ni les listes de lot (« 25 30 45 60 80 101 ») : les préfixes « + », « 00 » et « 0x » sont EXIGÉS pour un téléphone.
// Limite ASSUMÉE : un numéro écrit sans préfixe, ou avec des lettres entre les chiffres, n'est pas reconnu ; le texte reste une
// DONNÉE (jamais une consigne) et la politique de confidentialité le dit.
const MOTIFS = [   // l'ORDRE compte : e-mails et liens avant les pseudos, téléphones avant les blocs de chiffres
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,                                                                          // e-mails
    /\b(?:https?:\/\/|www\.)[^\s]+/gi,                                                                        // liens
    /\b[a-z0-9-]{2,}\.(?:com|fr|net|org|io|me|be|de|es|it|nl|co|uk|eu|shop|store)(?:\/[^\s]*)?\b/gi,         // domaines nus
    /\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){3,6}/g,                                                                // internationaux (le « + » est EXIGÉ)
    /\b00[\s.-]?\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){3,6}/g,                                                       // internationaux en 00
    /\b0[1-9](?:[\s.-]?\d{2}){4}\b/g,                                                                         // français (le « 0 » initial est EXIGÉ)
    /\b\d{9,15}\b/g,                                                                                          // blocs de 9 à 15 chiffres
    /(?<![\w.])@[A-Za-z0-9_.]{3,30}/g,                                                                        // @pseudos
    /\b(?:snap(?:chat)?|insta(?:gram)?|ig|tiktok|telegram|whatsapp|wa|discord|facebook|fb)\s*[:=]\s*@?[A-Za-z0-9_.]{3,30}\b/gi,   // réseaux nommés avec séparateur (« ig 12 » n'est pas un pseudo)
    /\b(?:snapchat|snap|instagram|insta|tiktok|telegram|whatsapp|discord|facebook)\s+@?[A-Za-z0-9_.]{3,30}\b/gi   // réseaux longs sans séparateur, comme l'extension (« insta jean.cartes »)
];
function expurger(brut) {
    if (typeof brut !== 'string') return { texte: '', retraits: 0 };
    let texte = brut.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' '), retraits = 0;
    for (const re of MOTIFS) texte = texte.replace(re, () => { retraits++; return ' '; });
    return { texte: texte.replace(/\s{2,}/g, ' ').trim(), retraits };
}
module.exports = { expurger };
