'use strict';
// Expurgation CÔTÉ SERVEUR des coordonnées d'un vendeur (téléphones, e-mails, liens, pseudos).
// Même intention que l'extension (extension v2/src/commun/vie-privee.js), au moins aussi stricte.
//
// RÈGLE D'ARBITRAGE (en tête, parce qu'elle décide de tout le reste) :
//   · une suite qui a la forme d'un téléphone ET la forme d'une liste de numéros est AMBIGUË : la vie privée l'emporte, on la RETIRE
//     (« lot 05 10 15 20 25 » = 0 + 4 groupes de 2 chiffres = un numéro français : retiré). Le coût est borné : la description n'est
//     pas envoyée au modèle par défaut (V2_DESCRIPTION_AU_MODELE=0) et n'est conservée que 90 jours.
//   · ce qui n'a PAS la forme d'un téléphone reste : « 025/165 », « SV-P 143 », « PSA 10 », un prix, une date, une liste à TROIS chiffres
//     (« 001 002 003 004 »), une liste de numéros commençant par 1-9 (« 25 30 45 60 80 101 »). Les préfixes « + », « 00 » + indicatif,
//     « 0x » sont EXIGÉS.
//   · domaine nu : TLD « sûrs » (fr com net org shop store io uk) toujours retirés (dans le doute, retirer : « Dracaufeu.fr ») ;
//     TLD qui sont aussi des mots courts (de es it eu me be nl co : « etat.de », « ex.eu ») ne sont retirés que derrière un mot de contact
//     (site, boutique, mail, insta…) ; avec un chemin « / » ils sont retirés dans tous les cas.
// Limite ASSUMÉE : un numéro sans zéro initial, ou écrit en lettres, n'est pas reconnu ; le texte reste une DONNÉE (B5.2).
//
// TEMPS : tous les quantificateurs sont BORNÉS (aucun imbriqué non borné) et l'entrée est plafonnée AVANT les expressions
// (EXPURGER_MAX) : le pire cas (suites sans espace) se traite en quelques ms.
const EXPURGER_MAX = 5000;     // > titre 300 / description 2000 : tronquer ici ne peut que retirer davantage, jamais fuir

const LABEL = '[\\w-]{1,63}';
const AT = '(?:\\s{0,2}[\\[(]\\s?(?:at|arobase)\\s?[\\])]\\s{0,2}|\\s{0,2}@\\s{0,2}|\\s+arobase\\s+|\\s+at\\s+)';
const DOT = '(?:\\.|\\s{0,2}[\\[(]\\s?(?:dot|point)\\s?[\\])]\\s{0,2}|\\s+(?:dot|point)\\s+)';
const EMAIL = new RegExp(`[\\w.+-]{1,64}${AT}${LABEL}(?:${DOT}${LABEL}){1,5}`, 'gi');

const SURS = 'fr|com|net|org|shop|store|io|uk';
const AMBIGUS = 'de|es|it|eu|me|be|nl|co';
const CONTACT = /(?:site|boutique|shop|mail|e-mail|contact|insta|instagram|snap|web|lien|visite[zr]?|voir|sur|via|blog|page)\W{0,3}$/i;
const chiffres = s => s.replace(/\D/g, '').length;

const MOTIFS = [   // [expression, validation optionnelle (match, source, offset) -> true = retirer]
    [EMAIL],
    [/\b(?:https?:\/\/|www\.)[^\s]{0,500}/gi],
    [/\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,3}\.[a-z]{2,24}\/[^\s]{0,200}/gi],                        // hôte quelconque + chemin : bit.ly/x, t.me/x, discord.gg/x, linktr.ee/x
    [new RegExp(`\\b[a-z0-9-]{1,63}\\.(?:${SURS})\\b`, 'gi')],                                           // domaine nu, TLD sûr
    [new RegExp(`\\b[a-z0-9-]{1,63}\\.(?:${AMBIGUS})\\b`, 'gi'), (m, src, off) => CONTACT.test(src.slice(Math.max(0, off - 30), off))],
    [/\+\d{1,3}(?:[\s.-]{0,3}\(?\d{1,4}\)?){3,6}/g, m => chiffres(m) >= 9 && chiffres(m) <= 15],        // internationaux (« + » exigé)
    [/(?<!\d)00[\s.-]?\d{2,3}(?:[\s.-]{0,3}\(?\d{1,4}\)?){3,6}(?!\d)/g, m => chiffres(m) >= 11 && chiffres(m) <= 15],   // 00 + indicatif de 2-3 chiffres (« 001 002 003 » n'en est pas un)
    [/(?<!\d)\(?0[1-9]\)?(?:[\s./-]{0,3}\d{2}){4}(?!\d)/g],                                             // français : espaces multiples, points, tirets, barres, parenthèses
    [/(?<!\d)0(?:\s\d){9}(?!\d)/g],                                                                      // chiffres isolés : « 0 6 1 2 3 4 5 6 7 8 »
    [/(?<!\d)0\d{4}[\s.-]?\d{6}(?!\d)/g],                                                                // britannique sans « + » : 07700 900123
    [/(?<!\d)0\d{3}[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g],                                                      // britannique : 0207 123 4567
    [/(?<!\d)\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g],                                                 // nord-américain : 415 555 0132, (415) 555-0132
    [/(?<!\d)\d{9,15}(?!\d)/g],                                                                          // blocs de 9 à 15 chiffres
    [/(?<![\w.])@[A-Za-z0-9_.]{2,30}/g],                                                                 // @pseudos
    [/\b(?:snap(?:chat)?|sc|insta(?:gram)?|ig|tiktok|tt|telegram|tg|whatsapp|wa|discord|facebook|fb|kik|vinted)\s{0,2}[:=]\s{0,2}@?[A-Za-z0-9_.]{2,30}/gi],   // réseau + séparateur
    [/\b(?:snapchat|snap|instagram|insta|tiktok|telegram|whatsapp|discord|facebook)\s{1,2}@?[A-Za-z0-9_.]{3,30}/gi],   // noms longs sans séparateur
    [/\b(?:ig|tg|sc|fb|wa|tt|kik)\s{1,2}@?[A-Za-z0-9]{1,28}[._][A-Za-z0-9_.]{1,28}/gi]                   // noms courts sans séparateur : le pseudo contient « . » ou « _ » (« ig 12 » n'en est pas un)
];
const INVISIBLES = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

function expurger(brut) {
    if (typeof brut !== 'string') return { texte: '', retraits: 0 };
    let texte = brut.slice(0, EXPURGER_MAX).normalize('NFKC').replace(INVISIBLES, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s/g, ' '), retraits = 0;
    for (const [re, valide] of MOTIFS) {
        const src = texte;
        texte = texte.replace(re, (m, ...r) => {
            if (valide && !valide(m, src, r.find(x => typeof x === 'number'))) return m;
            retraits++; return ' ';
        });
    }
    return { texte: texte.replace(/\s{2,}/g, ' ').trim(), retraits };
}
module.exports = { expurger, EXPURGER_MAX };
