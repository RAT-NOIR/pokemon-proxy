'use strict';
// Lot F4-PRIX — la FIABILITÉ d'un prix du guide (module pur, aucune base, aucun réseau).
// Règle du projet : « tout ce qui donne un chiffre au client se compte dans les faux ». Un prix présenté comme sûr qui ne l'est pas est un faux.
// Deux causes de réserve, écrites par ce qu'elles AUTORISENT (le prix n'est « fiable » que si AUCUNE réserve ne le touche) :
//   · l'écart de la tendance aux moyennes (7 et 30 jours) dépasse ECART_TENDANCE_MAX (30 %) ;
//   · la fiche mélange la version normale et une version tamponnée (prixMelangeTampon, posé par le catalogue).
// Les valeurs de ce banc viennent du cas réel du testeur (Arcanin [G] Lv.60, Supreme Victors 15/147) : live 7,67 / 13,45 / 14,35 ; guide 10,18 / 13,15 / 14,59.
const { v, vrai, bilan } = require('./_harnais');
const F = require('../identifier/fiabilite-prix');

v('le seuil est une constante nommée, de 30 %', F.ECART_TENDANCE_MAX, 0.30);
v('la liste fermée des réserves', [...F.RESERVES], ['ecart-tendance', 'prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons']);
v('l\'unique base du « De » : tous états', F.BASE_DE, 'tous-etats');
vrai('les listes sont gelées', Object.isFrozen(F.RESERVES));

// ── l'écart de la tendance (la mesure) : |tendance − moyenne| / moyenne, sur une moyenne valide seulement
v('écart live du cas réel contre la moyenne 30 j', Math.round(F.ecartTendance(7.67, 13.45) * 1000) / 1000, 0.430);
v('écart live du cas réel contre la moyenne 7 j', Math.round(F.ecartTendance(7.67, 14.35) * 1000) / 1000, 0.466);
v('écart nul', F.ecartTendance(5, 5), 0);
v('moyenne absente : pas de mesure (null, jamais 0)', F.ecartTendance(5, null), null);
v('moyenne nulle : pas de mesure', F.ecartTendance(5, 0), null);
v('tendance absente : pas de mesure', F.ecartTendance(null, 5), null);
v('moyenne négative : pas de mesure', F.ecartTendance(5, -3), null);
v('NaN : pas de mesure', F.ecartTendance(NaN, 5), null);
v('texte : pas de mesure (jamais converti)', F.ecartTendance('5', 5), null);

// ── les réserves
const R = o => F.reservesDe(o);
v('cas réel du guide (10,18 contre 14,59 sur 7 j : −30,2 %) : ecart-tendance', R({ tendance: 10.18, moyenne7: 14.59, moyenne30: 13.15 }), ['ecart-tendance']);
v('cas réel live (7,67 contre 13,45 et 14,35) : ecart-tendance', R({ tendance: 7.67, moyenne7: 14.35, moyenne30: 13.45 }), ['ecart-tendance']);
v('pile 30 % : PAS de réserve (« plus de 30 % »)', R({ tendance: 7, moyenne30: 10 }), []);
v('juste au-delà de 30 % : réserve', R({ tendance: 6.99, moyenne30: 10 }), ['ecart-tendance']);
v('écart vers le HAUT aussi (tendance trop haute)', R({ tendance: 14, moyenne30: 10 }), ['ecart-tendance']);
v('un seul des deux écarts suffit (7 j seul)', R({ tendance: 10, moyenne7: 15, moyenne30: 10 }), ['ecart-tendance']);
v('un seul des deux écarts suffit (30 j seul)', R({ tendance: 10, moyenne7: 10, moyenne30: 15 }), ['ecart-tendance']);
v('tendance proche des deux moyennes : aucune réserve', R({ tendance: 10, moyenne7: 10.5, moyenne30: 9.8 }), []);
v('aucune moyenne : rien à comparer, aucune réserve d\'écart (on ne devine pas)', R({ tendance: 10 }), []);
v('aucune tendance : rien à comparer', R({ moyenne7: 10, moyenne30: 14 }), []);
v('une moyenne seule suffit à juger', R({ tendance: 5, moyenne30: 10 }), ['ecart-tendance']);

// ── les prix mélangés : deux mentions fermées (règles 1 et 3 du testeur) ; la règle 2 (tampon vu sur la photo) n'est PAS codée
v('prixMelangeTampon === true : les deux mentions', R({ tendance: 10, moyenne7: 10, moyenne30: 10, prixMelangeTampon: true }), ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons']);
v('prixMelangeTampon + écart : l\'écart d\'abord, puis les deux mentions', R({ tendance: 5, moyenne30: 10, prixMelangeTampon: true }), ['ecart-tendance', 'prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons']);
for (const x of [false, null, undefined, 'true', 1, 'oui']) v(`prixMelangeTampon ${JSON.stringify(x)} (≠ true) : aucune mention`, R({ tendance: 10, prixMelangeTampon: x }), []);
v('le résultat est gelé', Object.isFrozen(R({ tendance: 5, moyenne30: 10 })), true);
v('aucun argument : aucune réserve, sans lever', F.reservesDe(), []);

// ── fiable = aucune réserve (écrit par ce qu'il autorise)
v('fiable : aucune réserve', F.fiable([]), true);
v('non fiable : une réserve', F.fiable(['ecart-tendance']), false);
v('réserve hors liste : non fiable (jamais « tout va bien »)', F.fiable(['inconnue']), false);
v('pas une liste : non fiable', F.fiable(null), false);
v('pas une liste (texte) : non fiable', F.fiable('ecart-tendance'), false);

// ── le badge du set : le code SEUL s'il ne se confond avec aucune série connue, sinon le nom
const B = (code, nom = 'Un Set') => F.badgeDe({ code, nom });
v('SV (Supreme Victors) se confond avec la série Scarlet & Violet : le nom', B('SV', 'Supreme Victors'), { badge: 'Supreme Victors', badgeSource: 'nom' });
v('sv en minuscules : même chose', B('sv', 'Supreme Victors'), { badge: 'Supreme Victors', badgeSource: 'nom' });
v('code sans ambiguïté : le code', B('PRE', 'Prismatic Evolutions'), { badge: 'PRE', badgeSource: 'code' });
v('SV1 est le code de la série elle-même : sans ambiguïté', B('SV1', 'Scarlet & Violet'), { badge: 'SV1', badgeSource: 'code' });
v('code absent : le nom', B(null, 'Magma VS Aqua'), { badge: 'Magma VS Aqua', badgeSource: 'nom' });
v('code vide : le nom', B('  ', 'Magma VS Aqua'), { badge: 'Magma VS Aqua', badgeSource: 'nom' });
v('code espacé : rogné', B(' PRE ', 'Prismatic Evolutions'), { badge: 'PRE', badgeSource: 'code' });
for (const c of ['SV', 'SWSH', 'SM', 'XY', 'BW', 'DP', 'PL', 'HS', 'EX', 'HGSS', 'BS', 'NP', 'SS']) v(`${c} : code d'une série connue, le nom`, B(c, 'Nom du set').badgeSource, 'nom');
v('la liste fermée des préfixes de série (mesurée sur les 783 codes du catalogue : 13 égaux)', [...F.CODES_DE_SERIE], ['SV', 'SWSH', 'SM', 'XY', 'BW', 'DP', 'PL', 'HS', 'EX', 'HGSS', 'BS', 'NP', 'SS']);
v('ni code ni nom : null (on n\'invente rien)', F.badgeDe({ code: null, nom: null }), { badge: null, badgeSource: null });
v('pas un set : null', F.badgeDe(null), { badge: null, badgeSource: null });
v('un code non texte : le nom', F.badgeDe({ code: 12, nom: 'Set' }), { badge: 'Set', badgeSource: 'nom' });

// ── la version Cardmarket (V1, V2…) : ce qui sépare deux produits au même set et au même numéro chez Cardmarket, sans signification
for (const x of ['V1', 'V2', 'V9', 'V10', 'V18', 'V99']) v(`version ${x} gardée (le catalogue va jusqu'à V18)`, F.versionDe(x), x);
for (const x of ['v2', 'V', 'V0', 'V01', 'V100', 'V2 ', ' V2', 'reverse', 'staff', '', null, undefined, 2, {}]) v(`version ${JSON.stringify(x)} → null`, F.versionDe(x), null);

bilan();
