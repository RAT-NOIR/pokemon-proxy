'use strict';
// Expurgation CÔTÉ SERVEUR des coordonnées d'un vendeur (téléphones, e-mails, liens, pseudos).
// Même intention que l'extension (extension v2/src/commun/vie-privee.js), au moins aussi stricte.
//
// RÈGLE D'ARBITRAGE (en tête, parce qu'elle décide de tout le reste) :
//   · une suite qui a la forme d'un téléphone ET la forme d'une liste de numéros est AMBIGUË : la vie privée l'emporte, on la RETIRE
//     (« lot 05 10 15 20 25 » = 0 + 4 groupes de 2 chiffres = un numéro français : retiré). Le coût est borné : la description n'est
//     pas envoyée au modèle par défaut (V2_DESCRIPTION_AU_MODELE=0) et n'est pas conservée par défaut (V2_DESCRIPTION_CONSERVEE=0 ; allumée : 90 jours).
//   · ce qui n'a PAS la forme d'un téléphone reste : « 025/165 », « SV-P 143 », « PSA 10 », un prix, une DATE (jj/mm/aaaa n'est jamais un
//     téléphone, même suivie d'un nombre), une liste à TROIS chiffres (« 001 002 003 004 »), une liste commençant par 1-9
//     (« 25 30 45 60 80 101 »), une liste séparée par « , » + espace (« 05, 10, 15 »). Les préfixes « + », « 00 » + indicatif, « 0x » sont EXIGÉS.
//   · séparateur de téléphone : un espace, ou UN symbole non alphanumérique (point, tiret, barre, puce, émoji, étoile, « _ », virgule collée),
//     avec au plus 2 espaces autour.
//   · e-mail : une partie AVANT et un domaine APRÈS sont exigés (« at 12.50€ » n'est pas un e-mail : le premier libellé d'un « at » contient une lettre).
//   · domaine nu : TLD « sûrs » (fr com net org shop store io uk) toujours retirés (dans le doute, retirer : « Dracaufeu.fr », « jean.cartes.fr ») ;
//     TLD qui sont aussi des mots courts (de es it eu me be nl co : « etat.de », « ex.eu ») ne sont retirés que derrière un mot de contact
//     (site, boutique, mail, insta…) ; avec un chemin « / » ils sont retirés dans tous les cas.
//   · réseau + pseudo : avec « : = → ➜ -> » toujours ; avec « - — , » ou un simple espace seulement pour les noms longs, et jamais si le mot
//     suivant est un mot courant (« sur insta ou whatsapp possible », « Snap Ball », « facebook marketplace » restent).
// LIMITES ASSUMÉES : un numéro sans zéro initial, ou écrit en LETTRES (« zéro six douze… »), n'est pas reconnu ; les numéros de certification
// et codes-barres de 9 à 15 chiffres sont retirés (ambigus avec un téléphone) ; « ig jean » sans point ni « _ » reste. Le texte reste une DONNÉE.
//
// TEMPS : tous les quantificateurs sont BORNÉS (aucun imbriqué non borné) et l'entrée est plafonnée AVANT les expressions
// (EXPURGER_MAX). La troncature est DITE : `tronque: true` (preparerAnnonce en fait `expurgeeParServeur: true`).
const EXPURGER_MAX = 5000;     // > titre 300 / description 2000 : tronquer ici ne peut que retirer davantage, jamais fuir

const LABEL = '[\\w-]{1,63}';
const LOC = '[\\w.+-]{1,64}';
const AT = '(?:\\s{0,2}[\\[(]\\s?(?:at|arobase)\\s?[\\])]\\s{0,2}|\\s{0,2}[\\[(]@[\\])]\\s{0,2}|\\s{0,2}@\\s{0,2}|\\s+arobase\\s+|\\s+at\\s+(?=\\d*[a-z_-]))';
const DOT = '(?:\\.|\\s{0,2}[\\[(]\\s?(?:dot|point)\\s?[\\])]\\s{0,2}|\\s+(?:dot|point)\\s+)';
const SEPD = '\\s{0,2}[.,·․]\\s{0,2}';
const TLDS = 'fr|com|net|org|io|me|be|de|es|it|nl|co|uk|eu|shop|store|ch|ca|us|info|biz|app|xyz|live|tv';
const EMAIL = new RegExp(`${LOC}${AT}${LABEL}(?:${DOT}${LABEL}){1,5}`, 'gi');
const EMAIL_PONCTUE = new RegExp(`${LOC}${AT}${LABEL}(?:${SEPD}${LABEL}){0,3}${SEPD}(?:${TLDS})\\b`, 'gi');   // « jean @ gmail . com », « jean@gmail,com », « jean@gmail·com », coupé sur 2 lignes

const SURS = 'fr|com|net|org|shop|store|io|uk';
const AMBIGUS = 'de|es|it|eu|me|be|nl|co';
const CONTACT = /(?:site|boutique|shop|mail|e-mail|contact|insta|instagram|snap|web|lien|visite[zr]?|voir|sur|via|blog|page)\W{0,3}$/i;
const chiffres = s => s.replace(/\D/g, '').length;
const estDate = m => /^\(?\d\d[/.-]\d\d[/.-](?:19|20)\d\d/.test(m);   // jj/mm/aaaa n'est jamais un téléphone

// séparateur entre groupes de chiffres : espace, ou UN symbole (puce, émoji, *, _, point, tiret, barre, virgule COLLÉE), jamais « , » suivi d'un espace
const SEP = '\\s{0,2}(?:[^\\p{L}\\p{N}\\s,;]|,(?!\\s))?\\s{0,2}';
const LONG = 'snap(?:chat)?|insta(?:gram)?|tiktok|telegram|whatsapp|discord|facebook|vinted';
const COURT = 'sc|ig|tt|tg|wa|fb|kik';
const PS = '@?[A-Za-z0-9_.]';
const MOTS_COURANTS = new Set(['ou', 'et', 'ok', 'oui', 'non', 'possible', 'marketplace', 'ball', 'avec', 'vous', 'pour', 'sur', 'le', 'la', 'les', 'un', 'une', 'de', 'du',
    'des', 'aussi', 'mais', 'si', 'en', 'au', 'aux', 'ce', 'cette', 'uniquement', 'seulement', 'dispo', 'disponible', 'messenger', 'whatsapp', 'insta', 'instagram',
    'snap', 'snapchat', 'tiktok', 'telegram', 'discord', 'facebook', 'vinted', 'ou', 'merci', 'svp', 'ensuite', 'apres', 'après', 'plus', 'moi', 'nous', 'pm', 'mp', 'dm']);
const motSuivantBanal = m => MOTS_COURANTS.has(m.split(/[\s]+/).pop().replace(/^@/, '').replace(/[.]+$/, '').toLowerCase());

const MOTIFS = [   // [expression, validation optionnelle (match, source, offset) -> true = retirer]
    [EMAIL],
    [EMAIL_PONCTUE],
    [/\b(?:https?:\/\/|www\.)[^\s]{0,500}/gi],
    [/\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,3}\.[a-z]{2,24}\/[^\s]{0,200}/gi],                        // hôte quelconque + chemin : bit.ly/x, t.me/x, discord.gg/x, linktr.ee/x
    [new RegExp(`\\b(?:[a-z0-9-]{1,63}\\.){1,3}(?:${SURS})\\b`, 'gi')],                                  // domaine nu, TLD sûr (tous les libellés : « jean.cartes.fr »)
    [new RegExp(`\\b(?:[a-z0-9-]{1,63}\\.){1,3}(?:${AMBIGUS})\\b`, 'gi'), (m, src, off) => CONTACT.test(src.slice(Math.max(0, off - 30), off))],
    [new RegExp(`\\+\\s?\\d{1,3}(?:${SEP}\\(?\\d{1,4}\\)?){3,6}`, 'gu'), m => chiffres(m) >= 9 && chiffres(m) <= 15],       // internationaux (« + » exigé, éventuellement suivi d'un espace)
    [new RegExp(`(?<!\\d)00\\s{0,2}[.-]?\\d{2,3}(?:${SEP}\\(?\\d{1,4}\\)?){3,6}(?!\\d)`, 'gu'), m => chiffres(m) >= 11 && chiffres(m) <= 15],   // 00 + indicatif de 2-3 chiffres
    [new RegExp(`(?<![\\p{L}\\p{N}])\\(?0[1-9]\\)?(?:${SEP}\\d{2}){4}(?!\\d)`, 'gu'), m => !estDate(m)],     // français (sauf une date)
    [new RegExp(`(?<![\\p{L}\\p{N}])[oO][1-9](?:${SEP}\\d{2}){4}(?!\\d)`, 'gu')],                          // « o6 12 34 56 78 » (lettre O pour zéro)
    [new RegExp(`(?<!\\d)\\(0\\)\\s?[1-9](?:${SEP}\\d{2}){4}(?!\\d)`, 'gu')],                              // (0)6 12 34 56 78
    [new RegExp(`(?<!\\d)0\\s[1-9](?:${SEP}\\d{2}){4}(?!\\d)`, 'gu')],                                     // 0 6 12 34 56 78
    [/(?<!\d)0(?:\s\d){9}(?!\d)/g],                                                                      // chiffres isolés : « 0 6 1 2 3 4 5 6 7 8 »
    [/(?<!\d)0\d{4}[\s.-]?\d{6}(?!\d)/g],                                                                // britannique sans « + » : 07700 900123
    [/(?<!\d)0\d{3}[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g],                                                      // britannique : 0207 123 4567
    [/(?<!\d)\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g],                                                 // nord-américain : 415 555 0132, (415) 555-0132
    [/(?<!\d)\d{9,15}(?!\d)/g],                                                                          // blocs de 9 à 15 chiffres
    [/(?<![\w.])@[A-Za-z0-9_.]{2,30}/g],                                                                 // @pseudos
    [new RegExp(`\\b(?:${LONG}|${COURT})\\s{0,2}[:=⁚]\\s{0,2}${PS}{2,30}`, 'gi')],                       // réseau + « : = »
    [new RegExp(`\\b(?:${LONG}|${COURT})\\s{0,2}(?:[→➜➔➡⇒⟶]|[-–—]+>)\\s{0,2}${PS}{2,30}`, 'gi')],       // réseau + flèche
    [new RegExp(`\\b(?:${LONG})\\s{0,2}[-–—,]\\s{0,2}${PS}{3,30}`, 'gi'), m => !motSuivantBanal(m)],      // noms longs + tiret ou virgule
    [new RegExp(`\\b(?:${LONG})\\s{1,2}${PS}{3,30}`, 'gi'), m => !motSuivantBanal(m)],                   // noms longs sans séparateur (sauf mot courant)
    [new RegExp(`\\b(?:${COURT})\\s{1,2}@?[A-Za-z0-9]{1,28}[._][A-Za-z0-9_.]{1,28}`, 'gi')]              // noms courts sans séparateur : le pseudo contient « . » ou « _ »
];
const INVISIBLES = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯⃣ㅤ︀-️﻿ﾠ]/g;

function expurger(brut) {
    if (typeof brut !== 'string') return { texte: '', retraits: 0 };
    const tronque = brut.length > EXPURGER_MAX;
    let texte = brut.slice(0, EXPURGER_MAX).normalize('NFKC').replace(INVISIBLES, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s/g, ' '), retraits = 0;
    for (const [re, valide] of MOTIFS) {
        const src = texte;
        texte = texte.replace(re, (m, ...r) => {
            if (valide && !valide(m, src, r.find(x => typeof x === 'number'))) return m;
            retraits++; return ' ';
        });
    }
    return { texte: texte.replace(/\s{2,}/g, ' ').trim(), retraits, tronque };
}
module.exports = { expurger, EXPURGER_MAX };
