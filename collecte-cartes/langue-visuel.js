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
