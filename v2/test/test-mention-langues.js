'use strict';
// MENTION-LANGUES (GUICHET, 01/11, à la demande de l'extension et du coordinateur) — le champ ADDITIF `visuelMentionLangues: { fr, en }` du Produit, pour les extensions qui le DÉCLARENT.
// Module pur (construireProduit) : aucune base, aucun réseau. `ctx.mentionLangues === true` est posé par la route SI la requête déclare la capacité « mention-langues-1 » (câblage dans routes.js, hors de ce lot).
//   · non déclaré : le Produit est celui d'avant, OCTET POUR OCTET (aucune clé de plus) ;
//   · déclaré : `visuelMentionLangues` = { fr, en } — jamais une langue pour une autre : une chaîne seule inconnue est le français, l'anglais reste null ;
//   · `visuelMention` (la chaîne résolue par la langue de l'interface) ne change JAMAIS.
const { v, vrai, bilan } = require('./_harnais');
const { construireProduit } = require('../identifier/produit');
const { MENTION_EDITION_1 } = require('../identifier/emprunt');

const BON = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/v/357044.webp';
const vis = { url: BON, w: 270, h: 378 };
const base = (o = {}) => ({
    idProduct: 357044, nomCardmarket: 'Lapras', nomFr: 'Lokhlass',
    set: { slug: '30th-Celebration', nom: '30th Celebration', code: '30C', tirage: 'intl', annee: 2026 },
    numero: '017', total: '128', langue: 'EN', variante: 'normale', rarete: 'Common',
    lienCardmarket: 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/30th-Celebration/Lapras-30C017',
    ...o
});
const decl = { langueInterface: 'fr', mentionLangues: true };
const P = (o, ctx = decl) => construireProduit(base(o), ctx);

// ── non déclaré : le Produit d'avant ────────────────────────────────────────────────────────
const sans = P({ visuel: vis, visuelMention: MENTION_EDITION_1 }, { langueInterface: 'fr' });
v('M1. non déclaré : aucune clé `visuelMentionLangues`', 'visuelMentionLangues' in sans, false);
v('M1b. déclaré faux, absent, « true » chaîne, 1 : aucune clé de plus (seul le booléen true déclare)', [false, undefined, 'true', 1].map(x => 'visuelMentionLangues' in P({ visuel: vis, visuelMention: MENTION_EDITION_1 }, { langueInterface: 'fr', mentionLangues: x })), [false, false, false, false]);
// M1c (tour 1, relecture) : l'ancienne assertion comparait deux constructions SANS clé entre elles (tautologique). Celle-ci peut ÉCHOUER : le jeu de clés du Produit non déclaré est EXACTEMENT celui d'avant (les 17 clés de test-identifier-produit.js), dans l'ordre.
const CLES_AVANT = ['idProduct', 'nom', 'nomCardmarket', 'set', 'numero', 'total', 'langue', 'variante', 'marques', 'marqueurs', 'version', 'rarete', 'visuel', 'visuelMention', 'prixGuide', 'liens', 'impressions'];
v('M1c. non déclaré : les clés du Produit sont EXACTEMENT les 17 d\'avant, dans l\'ordre (aucune clé de plus, aucune de moins), avec ou sans mention', [Object.keys(sans), Object.keys(P({ visuel: vis }, { langueInterface: 'en' })), Object.keys(P({ visuelMention: MENTION_EDITION_1 }, { langueInterface: 'fr' }))], [CLES_AVANT, CLES_AVANT, CLES_AVANT]);

// ── déclaré ─────────────────────────────────────────────────────────────────────────────────
const d1 = P({ visuel: vis, visuelMention: MENTION_EDITION_1 });
v('M2. la mention des emprunts : { fr, en } toutes deux écrites, la chaîne française est celle de la constante', [d1.visuelMentionLangues.fr, typeof d1.visuelMentionLangues.en, d1.visuelMentionLangues.en.length > 0], [MENTION_EDITION_1, 'string', true]);
v('M2b. chaque texte tient dans 1 à 40 caractères (le lecteur fermé de l\'extension)', [d1.visuelMentionLangues.fr.length, d1.visuelMentionLangues.en.length].every(n => n >= 1 && n <= 40), true);
v('M3. `visuelMention` ne change pas : la chaîne résolue par la langue de l\'interface (fr puis en)', [d1.visuelMention, P({ visuel: vis, visuelMention: MENTION_EDITION_1 }, { langueInterface: 'en', mentionLangues: true }).visuelMention], [MENTION_EDITION_1, MENTION_EDITION_1]);
v('M3b. le champ ne dépend PAS de la langue de l\'interface', JSON.stringify(P({ visuel: vis, visuelMention: MENTION_EDITION_1 }, { langueInterface: 'en', mentionLangues: true }).visuelMentionLangues), JSON.stringify(d1.visuelMentionLangues));
v('M4. une chaîne seule INCONNUE : le français tel quel, l\'anglais null (jamais une langue pour une autre)', P({ visuel: vis, visuelMention: 'Visuel de la carte d\'origine (Set B)' }).visuelMentionLangues, { fr: 'Visuel de la carte d\'origine (Set B)', en: null });
v('M5. un objet { fr, en } (la forme future de l\'archive) : repris, chaque côté nettoyé', P({ visuel: vis, visuelMention: { fr: 'Autre tirage', en: 'Other print' } }).visuelMentionLangues, { fr: 'Autre tirage', en: 'Other print' });
v('M5b. un objet incomplet : le côté absent est null', [P({ visuel: vis, visuelMention: { fr: 'Autre tirage' } }).visuelMentionLangues, P({ visuel: vis, visuelMention: { en: 'Other print' } }).visuelMentionLangues], [{ fr: 'Autre tirage', en: null }, { fr: null, en: 'Other print' }]);
v('M6. pas de visuel servi : null (une mention n\'accompagne qu\'un visuel)', [P({ visuelMention: MENTION_EDITION_1 }).visuelMentionLangues, P({ visuel: { url: 'https://evil.example/x.png', w: 1, h: 1 }, visuelMention: MENTION_EDITION_1 }).visuelMentionLangues], [null, null]);
v('M7. pas de mention : null', [P({ visuel: vis }).visuelMentionLangues, P({ visuel: vis, visuelMention: '  ' }).visuelMentionLangues, P({ visuel: vis, visuelMention: 42 }).visuelMentionLangues], [null, null, null]);
v('M8. une valeur qui n\'est pas un texte dans l\'objet est ignorée (null), jamais convertie', P({ visuel: vis, visuelMention: { fr: 7, en: ['x'] } }).visuelMentionLangues, null);
v('M9. déclaré : seule la clé `visuelMentionLangues` s\'ajoute (les autres clés du Produit sont celles d\'avant)', Object.keys(d1).filter(k => !Object.keys(sans).includes(k)), ['visuelMentionLangues']);
// ── tour 1 (relecture) : la borne « 1 à 40 caractères » est APPLIQUÉE à chaque côté, sur une entrée d'archive aussi ──────────────
const n = k => 'x'.repeat(k);
v('M10. une chaîne d\'archive de 41 caractères : hors borne, rien de servi (null) — ni le français tronqué, ni une langue pour une autre', P({ visuel: vis, visuelMention: n(41) }).visuelMentionLangues, null);
v('M10b. 40 caractères passent, 1 caractère passe, 0 (vide) et blancs : null', [P({ visuel: vis, visuelMention: n(40) }).visuelMentionLangues, P({ visuel: vis, visuelMention: 'x' }).visuelMentionLangues, P({ visuel: vis, visuelMention: '' }).visuelMentionLangues, P({ visuel: vis, visuelMention: '   ' }).visuelMentionLangues], [{ fr: n(40), en: null }, { fr: 'x', en: null }, null, null]);
v('M10c. la borne compte les caractères, pas les octets : 40 « é » passent, 41 non', [P({ visuel: vis, visuelMention: 'é'.repeat(40) }).visuelMentionLangues, P({ visuel: vis, visuelMention: 'é'.repeat(41) }).visuelMentionLangues], [{ fr: 'é'.repeat(40), en: null }, null]);
v('M10d. un côté d\'objet hors borne est écarté SEUL : l\'anglais trop long -> { fr, en: null } (retombée sur le français) ; le français trop long -> { fr: null, en }', [P({ visuel: vis, visuelMention: { fr: 'Autre tirage', en: n(41) } }).visuelMentionLangues, P({ visuel: vis, visuelMention: { fr: n(41), en: 'Other print' } }).visuelMentionLangues], [{ fr: 'Autre tirage', en: null }, { fr: null, en: 'Other print' }]);
v('M10e. les deux côtés hors borne : null', P({ visuel: vis, visuelMention: { fr: n(41), en: n(99) } }).visuelMentionLangues, null);
v('M10f. un texte avec des blancs autour est servi nettoyé (comme le lecteur de l\'extension)', P({ visuel: vis, visuelMention: '  Autre tirage  ' }).visuelMentionLangues, { fr: 'Autre tirage', en: null });
v('M10g. `visuelMention` (la chaîne de l\'interface) n\'est PAS touchée par la borne : une chaîne de 41 caractères reste servie là, comme avant', P({ visuel: vis, visuelMention: n(41) }).visuelMention, n(41));
bilan();
