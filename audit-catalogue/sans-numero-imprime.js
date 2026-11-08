'use strict';
// ============================================================
// SETS DONT LA CARTE N'IMPRIME AUCUN NUMÉRO DE COLLECTION — table FERMÉE par set (agent catalogue, 2026-11-08)
// ============================================================
// Décision du testeur (2026-11-08) : « le compte des trous doit dire la vérité ». Une fiche japonaise « sans numéro » n'est pas un trou quand la carte
// n'en imprime pas : il n'y a rien à collecter. Mais l'exclusion ne se déduit JAMAIS d'une date ni d'un tirage (« avant l'ère DP ») : un set n'entre ici QUE
// vérifié sur SCANS (planche-scans-set.js : 4 visuels répartis sur toute la liste du set, lus dans R2 en lecture seule, bande basse agrandie), et son entrée
// porte sa preuve (ce qui est imprimé, les cartes regardées, la date). Un set absent d'ici garde ses trous ; un set sans scan consultable (Space-Time-Creation,
// Entry-Pack-08, Bastiodon-the-Defender : 0 visuel en base au 2026-11-08) reste compté et le dit.
// Deux familles (FAMILLES) :
//   « avant-dp » : WotC / Neo / Gym japonais. Le bas de la carte imprime « No. NNN » = le n° de POKÉDEX de l'espèce (Abra No. 063, Poliwhirl No. 061, Tangela
//                  No. 114) ; les Dresseurs n'impriment rien. Ni numéro de collection, ni total « /N ».
//   « dp »       : ère DP (2006-2008). Les Pokémon impriment « DPBP#NNN », une référence Pokédex Battle COMMUNE à tous les sets DP — la même carte garde le même
//                  DPBP# d'un set à l'autre (Pikachu DPBP#026 dans Secret of the Lakes et dans Rampardos the Attacker ; Eevee DPBP#157 dans Dawn Dash et
//                  Moonlit Pursuit : mesuré sur le cache, 3 couples sur 415) : ce n'est PAS un numéro de carte du set. Dresseurs, Énergies, LV.X : rien.
// ⚠️ DPBP# n'est jamais affiché comme numéro : il ne vit que dans `cartes.images[].numero` (414 documents, 7 sets, lu le 2026-11-08), jamais dans
//    `impressions.numero` ni `cartes_produits.numeroFiche` (0 et 0) ; le site ne s'en sert que pour apparier une image à une entrée (imageDeLImpression.ts).
// ⚠️ images.numero numérique d'Expansion-Sheet (31) et de Tamamushi-City-Gym (18/18) : numérotation de la liste artofpkm, PAS imprimée (Kangaskhan imprime
//    No. 115 et porte images.numero 033 ; Tangela imprime No. 114 et porte 011) : ces sets restent admis.
const FAMILLES = Object.freeze(['avant-dp', 'dp']);
const DATE = '2026-11-08';
const AVANT = 'bas de carte « No. NNN » = n° de Pokédex de l\'espèce (Dresseurs : aucun numéro) ; ni numéro de collection ni total « /N »';
const DP = 'bas de carte « DPBP#NNN » = référence Pokédex Battle commune à tous les sets DP (même carte, même DPBP# d\'un set à l\'autre) ; Dresseurs, Énergies, LV.X : rien ; ni numéro de collection ni total';
const e = (famille, cartes, imprime, note) => Object.freeze({ famille, imprime: imprime || (famille === 'dp' ? DP : AVANT), cartes: Object.freeze(cartes), date: DATE, ...(note ? { note } : {}) });

const SANS_NUMERO_IMPRIME = Object.freeze({
    // ── 1996-2001 (WotC / Neo / Gym)
    'Expansion-Pack': e('avant-dp', ['Abra (No. 063)', 'Clefairy Doll (rien)', 'Poliwhirl (No. 061)', 'PlusPower (rien)']),
    'Rocket-Gang': e('avant-dp', ['Dark Golduck (No. 055)', 'Dark Vaporeon (No. 134)', 'Dark Raticate (No. 020)', 'Challenge! (rien)']),
    'Mystery-of-the-Fossils': e('avant-dp', ['Weezing (No. 110)', 'Lapras (No. 131)', 'Hypno (No. 097)', 'Mr. Fuji (rien)']),
    'Pokemon-Jungle': e('avant-dp', ['Paras (No. 046)', 'Flareon (No. 136)', 'Rhyhorn (No. 111)', 'Eevee (No. 133)']),
    'Expansion-Sheet': e('avant-dp', ['Kakuna (No. 014)', 'Raichu (No. 026)', 'Nidorina (No. 030 ; images.numero 002)', 'Kangaskhan (No. 115 ; images.numero 033)'], undefined, 'images.numero de 31 cartes = rang de la liste artofpkm, non imprimé'),
    'Leaders-Stadium': e('avant-dp', ['Brock\'s Rhyhorn (No. 111)', 'Misty\'s Magikarp (No. 129)', 'Lt. Surge\'s Treaty (rien)', 'Brock\'s Golem (No. 076)']),
    'Nivi-City-Gym': e('avant-dp', ['Full Heal (rien)', 'Pokémon Center (rien)', 'Brock\'s Golem (No. 076)', 'Brock\'s Sandslash (No. 028)']),
    'Hanada-City-Gym': e('avant-dp', ['Poké Ball (rien)', 'Misty\'s Wrath (rien)', 'Misty\'s Cloyster (No. 091)', 'Misty\'s Seel (No. 086)']),
    'Tamamushi-City-Gym': e('avant-dp', ['Recycle (rien ; images.numero 025)', 'Erika\'s Tangela (No. 114 ; images.numero 011)', 'Erika\'s Perfume (rien)', 'Erika\'s Gloom (No. 044 ; images.numero 003)'], undefined, 'images.numero 18/18 = rang de la liste artofpkm, non imprimé'),
    'Kuchiba-City-Gym': e('avant-dp', ['Lt. Surge\'s Magneton (No. 082)', 'Secret Mission (rien)', 'Lt. Surge\'s Electabuzz (No. 125)', 'Lt. Surge\'s Raticate (No. 020)']),
    'Challenge-from-the-Darkness': e('avant-dp', ['Sabrina\'s Psyduck (No. 054)', 'Koga\'s Arbok (No. 024)', 'Sabrina (rien)', 'Koga\'s Ditto (No. 132)']),
    'Southern-Islands-JP': e('avant-dp', ['Onix (No. 095)', 'Ledyba (No.)', 'Lapras (No. 131)', 'Lickitung (No. 108)']),
    'Yamabuki-City-Gym': e('avant-dp', ['Sabrina\'s ESP (rien)', 'Saffron City Gym (rien)', 'Master Ball (rien)', 'Sabrina\'s Mr. Mime (No. 122)']),
    'Guren-Town-Gym': e('avant-dp', ['Blaine\'s Ninetales (No. 038)', 'Blaine\'s Gamble (rien)', 'Max Revive (rien)', 'Blaine\'s Quiz #2 (rien)']),
    'Gold-Silver-to-a-New-World': e('avant-dp', ['Quilava (No. 156)', 'Elekid (No. 239)', 'Cleffa (No. 173)', 'Miltank (No. 241)']),
    'Awakening-Legends': e('avant-dp', ['Geodude (No. 074)', 'Unown B (No. 201)', 'Stantler (No. 234)', 'Jynx (No. 124)']),
    'Crossing-the-Ruins': e('avant-dp', ['Kakuna (No. 014)', 'Poliwrath (No. 062)', 'Pupitar (No. 247)', 'Teddiursa (No. 216)']),
    'Darkness-and-to-Light': e('avant-dp', ['Dark Croconaw (No. 159)', 'Light Dewgong (No. 087)', 'Light Dragonite (No. 149)', 'Dark Exeggutor (No. 103)']),
    // ── ère DP (2006-2008)
    'Secret-of-the-Lakes': e('dp', ['Meganium (DPBP#185)', 'Seel (DPBP#094)', 'Ambipom (DPBP#268)', 'Bebe\'s Search (rien)']),
    'Shining-Darkness': e('dp', ['Cloyster (DPBP#099)', 'Voltorb (DPBP#109)', 'Unown N (DPBP#242)', 'Roseanne\'s Research (rien)']),
    'Moonlit-Pursuit': e('dp', ['Porygon2 (DPBP#166)', 'Wailmer (DPBP#373)', 'Drowzee (DPBP#105)', 'Houndoom (DPBP#287)']),
    'Dawn-Dash': e('dp', ['Unown L (DPBP#240)', 'Primeape (DPBP#062)', 'Espeon (DPBP#163)', 'Latias (DPBP#438)']),
    // preuve : planche chasse\soir-0811\N8R2\sorties\planche-12.png (22 bandes basses, scans filigranés : la preuve porte sur ce qui est imprimé), relue par le coordinateur ET par l'implémenteur le 2026-11-08 — « DPBP#101 … DP1 »
    'Space-Time-Creation': e('dp', ['Gastly (DPBP#101)', 'Gengar (DPBP#102)', 'Onix (DPBP#103)', 'Steelix (DPBP#104)', 'Rhyhorn (DPBP#123)', 'Elekid (DPBP#145)', 'Azurill (DPBP#210)', 'Misdreavus (DPBP#227)'],
        undefined, 'preuve : planche-12.png (N8R2), bande basse « DPBP#NNN … DP1 » sur 22 cartes ; aucun visuel du set en base (0), preuve hors cache'),
    'Magmortar-vs-Electivire-Deck-Kit': e('dp', ['Energy Search (rien)', 'Latios (DPBP#439)', 'Floatzel (rien)', 'Ambipom (rien)']),
    'Dialga-LVX-Constructed-Standard-Deck': e('dp', ['Ampharos (DPBP#209)', 'Flaaffy (DPBP#208)', 'Stantler (DPBP#290)', 'Professor Oak\'s Visit (rien)']),
    'Palkia-LVX-Constructed-Standard-Deck': e('dp', ['Palkia LV.X (rien)', 'Ralts (DPBP#330)', 'Spinda (DPBP#380)', 'Roseanne\'s Research (rien)']),
    'Rampardos-the-Attacker': e('dp', ['Pikachu (DPBP#026)', 'Multi Energy (rien)', 'Fossil Excavator (rien)', 'Team Galactic\'s Wager (rien)']),
    '10th-Movie-Commemoration-Set': e('dp', ['Explosive Birth Lugia (ni No. ni DPBP#)', 'Alto Mare\'s Latias (ni No. ni DPBP#)', 'Seven Nights Jirachi (ni No. ni DPBP#)', 'Wave-Guiding Hero Lucario (ni No. ni DPBP#)'],
        'bas de carte : © et marque « 10th » seulement — ni « No. », ni « DPBP# », ni numéro de collection ni total'),
    'Temple-of-Anger': e('dp', ['Registeel (DPBP#437)', 'Metagross (DPBP#434)', 'Tyrogue (DPBP#115)', 'Snowpoint Temple (rien)']),
    'Cry-from-the-Mysterious': e('dp', ['Lanturn (DPBP#201)', 'Camerupt (DPBP#376)', 'Mightyena (DPBP#312)', 'Dragonite (DPBP#180)']),
    'Heatran-vs-Regigigas-Deck-Kit': e('dp', ['Energy Search (rien)', 'Metang (rien)', 'Gliscor (rien)', 'Mewtwo LV.X (rien)']),
});

/** Les sets candidats SANS preuve (aucun visuel en base au 2026-11-08) : comptés, jamais exclus. */
const CANDIDATS_SANS_SCAN = Object.freeze(['Entry-Pack-08', 'Bastiodon-the-Defender']);

/** La famille d'un set de la table, ou null (set hors table : AUCUNE exclusion). */
const familleSansNumero = (setId, table = SANS_NUMERO_IMPRIME) => (Object.prototype.hasOwnProperty.call(table, setId) ? table[setId].famille : null);

module.exports = { SANS_NUMERO_IMPRIME, FAMILLES, CANDIDATS_SANS_SCAN, familleSansNumero };
