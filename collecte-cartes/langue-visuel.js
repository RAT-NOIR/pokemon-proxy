// ============================================================
// LA LANGUE D'UN VISUEL — `langue` sur `images` et sur chaque entrée de `cartes.images` (2026-09-23)
// ============================================================
// 🔴 POURQUOI : Bulbapedia publie le scan de l'impression JAPONAISE sous le nom de fichier ANGLAIS tant que l'anglais
// n'est pas scanné, et ne le remplace pas toujours. « PinsirEvolvingSkies1.jpg » est le Pinsir d'Eevee Heroes ; la
// clé, le set, le sha256 sont justes, et rien dans le wikitext ne le dit. Sans ce champ, le site affiche un mensonge ou
// ne peut pas le détecter (sa garde : `rat-market-site/lib/langueDuVisuel.ts`, qui lit `langue` sur chaque entrée).
//
// 🔑 CE QUI TRANCHE, ET CE QUI NE TRANCHE PAS — mesuré sur nos copies R2, zéro requête :
//   · artofpkm ne sert que le japonais : `ja` par construction (invariant du contrôle transversal : 0 fichier
//     `artofpkm/` sous un set non jp).
//   · Bulbapedia, format du fichier SOURCE (`wOriginal`×`hOriginal`) : 868×1212, 748×1044 et 748×1045 sont les formats
//     du scanner japonais — ceux des scans artofpkm eux-mêmes (9 386, 6 631, 103) — et lus japonais à l'œil sur
//     Bulbapedia (site 9/9, ici 8/8 dont Guardians Rising 748×1045 4/4). Ils PROUVENT le japonais.
//   · 🔴 AUCUN FORMAT NE PROUVE L'ANGLAIS. Marnie (SWSH Black Star Promos, 733×1024) et Collapsed Stadium (Lost
//     Origin, 400×558) sont des scans japonais dans des formats où vivent aussi des scans anglais ; 734×1024 porte 22
//     scans japonais chez artofpkm. Tiré au hasard dans les 34 sets qui portent des formats japonais, hors de ces
//     formats : 9 japonais sur 36. Écrire `en` sur un format serait affirmer sans preuve : ce qui ne se tranche pas
//     vaut `null`, et `null` n'est pas « anglais » — le site l'affiche comme avant, faute de mieux.
// ⚠️ La PREUVE s'écrit à côté du verdict, verdict ou pas : `null` sans raison serait indistinguable d'un oubli.
const { hoteDeLUrl } = require('./hotes-images-ptcgio');
const FORMATS_JAPONAIS = new Map([
    ['868×1212', 'scans artofpkm 9 386 · Bulbapedia lus japonais à l\'œil'],
    ['748×1044', 'scans artofpkm 6 631 · Bulbapedia lus japonais à l\'œil'],
    ['748×1045', 'scans artofpkm 103 · Bulbapedia Guardians Rising lus japonais 4/4']
]);

/** Le verdict d'un document `images` : { langue: 'ja' | null, preuve }. */
function langueDuVisuel(im) {
    if (im.source === 'artofpkm') return { langue: 'ja', preuve: 'artofpkm ne sert que le japonais' };
    // TCGdex : le scan est pris sous `assets.tcgdex.net/en/…`, la langue est DÉCLARÉE par la source, dans le chemin même.
    // C'est la seule preuve d'anglais du dépôt — un format de fichier n'en est jamais une.
    // ➕ 2026-09-29 : la langue de l'API INDONÉSIENNE (assets.tcgdex.net/id), déclarée de la même façon — par ce qu'elle autorise :
    // une langue source inconnue n'est pas de l'anglais, elle n'a pas de règle (null).
    if (im.source === 'tcgdex' && im.langueSource === 'id') return { langue: 'id', preuve: 'TCGdex, API indonésienne (assets.tcgdex.net/id) : le scan de l\'impression indonésienne' };
    // ➕ 2026-10-03 (testeur : SV7s en thaï ; le site accepte `th` sur un set th ou idth)
    if (im.source === 'tcgdex' && im.langueSource === 'th') return { langue: 'th', preuve: 'TCGdex, API thaïe (assets.tcgdex.net/th) : le scan de l\'impression thaïe' };
    if (im.source === 'tcgdex' && im.langueSource != null && im.langueSource !== 'en') return { langue: null, preuve: `TCGdex, langue source « ${im.langueSource} » sans règle` };
    if (im.source === 'tcgdex') return { langue: 'en', preuve: 'TCGdex, API anglaise (assets.tcgdex.net/en) : le scan de l\'impression anglaise' };
    // ➕ 2026-10-07 (soir) — LES SOURCES OFFICIELLES TPC : la langue est celle du SITE, déclarée par l'adresse (asia.pokemon-card.com/<l>,
    // pokemon-card.com), par ce qu'elle AUTORISE ; une langue de site inconnue n'a pas de règle (null)
    if (im.source === 'tpc-asie') {
        const l = { id: 'id', th: 'th', tw: 'zh-hant' }[im.langueSource];
        return l ? { langue: l, preuve: `TPC Asie, site « ${im.langueSource} » (asia.pokemon-card.com/${im.langueSource}) : le scan de l'impression ${l}` } : { langue: null, preuve: `TPC Asie, site « ${im.langueSource} » sans règle` };
    }
    // ➕ 2026-10-10 — images.pokemontcg.io : un serveur de cartes ANGLAISES (le set est celui d'un tirage occidental, prouvé à l'œil par
    // set, collecte-cartes/ptcgio.js `temoins`) ; la collecte n'écrit que sous un set dont le tirage est `intl`.
    // ➕ 2026-10-17 (SCRYDEX-OCC) : la même source interne s'écrit aussi depuis le second serveur d'images (urlOriginal). Par ce qu'elle AUTORISE : une adresse d'origine qui n'est pas l'un des
    // DEUX hôtes d'images (collecte-cartes/hotes-images-ptcgio.js) n'a pas de règle (null) ; sans adresse (appel historique du collecteur), la règle d'avant. La preuve de langue est PUBLIQUE
    // (le site la lit) : elle ne nomme jamais l'hôte, qui se lit dans `urlOriginal` et dans `preuve` (internes).
    if (im.source === 'pokemontcg.io' && im.urlOriginal != null) {
        const hote = hoteDeLUrl(im.urlOriginal);
        if (!hote) return { langue: null, preuve: 'pokemontcg.io : adresse d\'origine hors des deux hôtes d\'images, sans règle de langue' };
        if (hote !== 'images.pokemontcg.io') return { langue: 'en', preuve: 'pokemontcg.io, second serveur d\'images du même jeu de données : scan de l\'impression anglaise (30 images de la Classic Collection de 30th Celebration ouvertes à l\'œil le 2026-10-17, toutes en anglais)' };
    }
    if (im.source === 'pokemontcg.io') return { langue: 'en', preuve: 'images.pokemontcg.io : scan de l\'impression anglaise (157 témoins écrits dans la table, 166 images ouvertes à l\'œil les 2026-10-08, 2026-10-10, 2026-10-12, 2026-10-13 et 2026-10-17, toutes en anglais)' };
    // ➕ 2026-10-11 — pikaqian.com : des copies des scans officiels CHINOIS (texte en sinogrammes simplifiés lisible sur les 3 images ouvertes à l'œil
    // le 2026-10-10, MESURE-PIKAQIAN.md §5) ; la collecte n'écrit que sous un set au tirage `zh-hans`. Par ce qu'elle autorise : une autre langue source n'a pas de règle.
    if (im.source === 'pikaqian') return im.langueSource === 'zh-hans'
        ? { langue: 'zh-hans', preuve: 'pikaqian.com : scan de la carte chinoise imprimée (sinogrammes simplifiés lisibles sur 3 images ouvertes à l\'œil le 2026-10-10), sous un set au tirage zh-hans' }
        : { langue: null, preuve: `pikaqian, langue source « ${im.langueSource} » sans règle` };
    // ➕ 2026-10-17 — pokumon.com (lot PK-PP, Prize Packs S1-S4) : la langue est DÉCLARÉE par la taxonomie « language » de l'entrée (English, id 1260), que le collecteur ne lit qu'en la
    // portant sur `langueSource: 'en'` ; 17 images ouvertes à l'œil le 2026-10-17, toutes en anglais (S7/PK-PP/img). Par ce qu'elle autorise : toute autre valeur n'a pas de règle (null).
    if (im.source === 'pokumon') return im.langueSource === 'en'
        ? { langue: 'en', preuve: 'pokumon.com : entrée de la taxonomie « language » English (id 1260), carte anglaise tamponnée (17 images ouvertes à l\'œil le 2026-10-17, toutes en anglais)' }
        : { langue: null, preuve: `pokumon, langue source « ${im.langueSource} » sans règle` };
    // ➕ 2026-10-17 (PKMCOM-IMPORT) — pokemon.com (relevés passifs du testeur) : la langue est DÉCLARÉE par le nom du fichier servi (« …_EN_… ») ; l'adresse doit être valable (require paresseux : pas de cycle)
    if (im.source === 'pokemon.com') return require('./pokemoncom').langueDe(im.urlOriginal);
    // ➕ 2026-10-17 (PKMNCARDS) — source « pkc » : des scans de cartes ANGLAISES (le set est celui d'un tirage occidental, vérifié par la table fermée de collecte-cartes/pkmncards.js et par la
    // concordance set + numéro + nom de chaque carte). Par ce qu'elle AUTORISE : l'adresse d'origine doit être valable (require paresseux : pas de cycle) ; la preuve est PUBLIQUE et ne nomme ni la source ni l'hôte.
    if (im.source === 'pkc') return require('./pkmncards').urlImageValide(im.urlOriginal)
        ? { langue: 'en', preuve: 'scan de l\'impression anglaise (carte du tirage occidental, set, numéro et nom concordants avec la fiche)' }
        : { langue: null, preuve: 'adresse d\'origine hors des règles : sans règle de langue' };
    if (im.source === 'pokemon-card-com') return { langue: 'ja', preuve: 'pokemon-card.com (Japon) : le scan de l\'impression japonaise' };
    if (im.source === 'bulbapedia') {
        if (!im.wOriginal || !im.hOriginal) return { langue: null, preuve: 'dimensions du fichier source inconnues' };
        const f = `${im.wOriginal}×${im.hOriginal}`;
        if (FORMATS_JAPONAIS.has(f)) return { langue: 'ja', preuve: `fichier source ${f}, format du scanner japonais (${FORMATS_JAPONAIS.get(f)})` };
        return { langue: null, preuve: `fichier source ${f} : le format ne tranche pas (un format ne prouve jamais l'anglais)` };
    }
    return { langue: null, preuve: `source « ${im.source} » sans règle de langue` };
}

/**
 * Ce que porte l'entrée de `cartes.images` : le verdict POSÉ sur le document `images` quand il existe (un verdict lu à
 * l'œil survit ainsi au rejeu de la jointure), sinon celui du format. Le champ `langue` absent veut dire « jamais
 * évalué » ; présent à `null`, « évalué, la source ne tranche pas » — deux états qu'on ne confond pas.
 */
function langueDeLEntree(im) {
    if (im.langue !== undefined) return { langue: im.langue, languePreuve: im.languePreuve ?? null };
    const v = langueDuVisuel(im);
    return { langue: v.langue, languePreuve: v.preuve };
}

module.exports = { langueDuVisuel, langueDeLEntree, FORMATS_JAPONAIS };
