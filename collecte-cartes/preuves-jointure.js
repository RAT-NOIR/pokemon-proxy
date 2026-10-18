// ============================================================
// CE QU'UNE RÉGÉNÉRATION SAIT REFABRIQUER — liste fermée des `preuve` que joindre() produit (§59, relecture B de SEA-2)
// ============================================================
// `collecteur-texte.js --reparser` effaçait TOUTES les lignes `cartes_produits` des cartes du set (`deleteMany` sans filtre de preuve) puis rejouait
// joindre(). Or d'autres outils posent des lignes que joindre() ne refait pas : `metacarte+setlist`, `metacarte+nom+attaques` (Promos partiel, PWC),
// `wcd+origine+numero`, `fiche-simple`, `carte-declarante`, `nom-carte+numero`… Un rejeu les effaçait sans un mot. Règle (§59) : une régénération ne
// retire que ce qu'elle sait REFABRIQUER, et le filtre s'écrit par ce qu'il AUTORISE — toute autre preuve (et toute ligne sans preuve) est GARDÉE.
// SOURCE DE LA LISTE : jointure.js — `preuve = imps.every(source === 'setlist') ? 'setlist+numero' : 'set+numero'` (l. 352) et
// `${source}+nom${avecAttaques ? '+attaques' : ''}` avec source ∈ {set, setlist} (l. 409) ; énumérée en base le 2026-10-12 (70 028 lignes) : set+numero
// 47 940 · setlist+numero 11 835 · set+nom 873 · set+nom+attaques 1 195 · setlist+nom 212 · setlist+nom+attaques 195 (les valeurs historiques
// comprises). Une preuve neuve que joindre() produirait demain doit être AJOUTÉE ICI, sinon elle survit au rejeu au lieu de se refaire.
const PREUVES_DE_JOINDRE = Object.freeze(['set+numero', 'setlist+numero', 'set+nom', 'set+nom+attaques', 'setlist+nom', 'setlist+nom+attaques']);

/**
 * Les preuves que jointure.js produit et qu'une régénération GARDE explicitement (aucune aujourd'hui). Le banc test-reparser-filtre.js lit jointure.js : toute
 * preuve qu'elle produit doit être classée ICI ou dans PREUVES_DE_JOINDRE, et toute preuve effaçable doit encore être produite (§21 bis).
 */
const PREUVES_GARDEES_PRODUITES = Object.freeze([]);

/**
 * Les preuves posées par d'AUTRES outils d'écriture (poser-fiches-par-setlist.js, poser-fiches-par-freres.js) : joindre() ne les refait pas, le filtre ci-dessous
 * (liste fermée PREUVES_DE_JOINDRE) ne les efface donc jamais — elles sont GARDÉES par construction, et classées ici pour que ce soit écrit. Le banc
 * test-reparser-filtre.js lit la constante `PREUVE` exportée par chaque outil : une preuve d'outil qui ne figure pas ici, ou qui figurerait dans
 * PREUVES_DE_JOINDRE, fait échouer le banc.
 */
const PREUVES_D_OUTILS_GARDEES = Object.freeze(['metacarte+setlist', 'metacarte+freres']);

/** Le filtre d'effacement d'un rejeu : les lignes des cartes du set, de ses expansions, ET d'une preuve que joindre() refabrique. */
// ➕ STAFF-ECRITURE (2026-10-17) : une ligne qui porte `variante` ou `variantePreuve` (posée à la main par poser-variante-staff.js, sur 122 lignes de preuve set+numero) est une MARQUE
// que joindre() ne sait pas refabriquer : elle n'est jamais effacée (la règle : tout ce qu'un outil ne sait pas refaire porte la marque de sa conservation, posée dans le même geste que l'écriture).
// La ligne que joindre() réécrit est un `$set` par champs (ecrire-jointure.js) : il laisse `variante` en place, donc garder suffit — aucun report à recopier.
const filtreDeRegeneration = (idsCartes, expsDeCeSet) => ({ carteId: { $in: idsCartes }, idExpansion: { $in: expsDeCeSet }, preuve: { $in: [...PREUVES_DE_JOINDRE] },
    variante: { $exists: false }, variantePreuve: { $exists: false } });

/**
 * Efface ce que joindre() va réécrire, recompose les liens dénormalisés depuis ce qui RESTE. Les lignes gardées gardent leurs liens : `liens.idMetacards`
 * (posé par d'autres outils pour leurs lignes) n'est vidé que sur une carte qui n'a aucune ligne gardée.
 * @param {{CarteProduit: object, Carte: object}} M  modèles mongoose (ou faux modèles du banc)
 */
async function effacerRefabricables(M, idsCartes, expsDeCeSet) {
    // L'ORDRE de liens.idProduct d'AVANT (tour 1 de M2) : le site lit `liens.idProduct[0]` comme repère d'adresse. La recomposition ci-dessous le réordonne
    // (les lignes gardées d'abord), puis joindre() AJOUTE en fin : `restaurerOrdreLiens` remet l'ordre d'avant une fois la jointure réécrite.
    const ordreAvant = new Map();
    for (const id of idsCartes) { const c = await M.Carte.findOne({ _id: id }).select('liens.idProduct').lean(); if (Array.isArray(c?.liens?.idProduct)) ordreAvant.set(id, [...c.liens.idProduct]); }
    await M.CarteProduit.deleteMany(filtreDeRegeneration(idsCartes, expsDeCeSet));
    let gardees = 0;
    for (const id of idsCartes) {
        const restantes = await M.CarteProduit.find({ carteId: id }).select('idProduct preuve variante variantePreuve').lean();
        const dejaGardees = restantes.filter(x => !PREUVES_DE_JOINDRE.includes(x.preuve) || x.variante !== undefined || x.variantePreuve !== undefined).length;
        gardees += dejaGardees;
        await M.Carte.updateOne({ _id: id }, dejaGardees
            ? { $set: { 'liens.idProduct': restantes.map(x => x.idProduct) } }
            : { $set: { 'liens.idProduct': restantes.map(x => x.idProduct), 'liens.idMetacards': [] }, $unset: { 'liens.idMetacard': 1 } });
    }
    return { gardees, ordreAvant };
}

/**
 * Après la jointure réécrite : l'ordre d'AVANT, restreint à ce qui existe encore (un id que le rejeu ne refait pas disparaît : pas de lien sans ligne), puis
 * les ids neufs dans leur ordre actuel, EN FIN. Ne touche que les cartes dont l'ordre diffère.
 */
async function restaurerOrdreLiens(M, ordreAvant) {
    let remis = 0;
    for (const [id, avant] of ordreAvant) {
        const c = await M.Carte.findOne({ _id: id }).select('liens.idProduct').lean();
        const cur = Array.isArray(c?.liens?.idProduct) ? c.liens.idProduct : [];
        const vus = new Set(cur), dansAvant = new Set(avant);
        const ordre = [...avant.filter(x => vus.has(x)), ...cur.filter(x => !dansAvant.has(x))];
        if (ordre.length === cur.length && ordre.every((x, i) => x === cur[i])) continue;
        await M.Carte.updateOne({ _id: id }, { $set: { 'liens.idProduct': ordre } }); remis++;
    }
    return { remis };
}

module.exports = { PREUVES_DE_JOINDRE, PREUVES_GARDEES_PRODUITES, PREUVES_D_OUTILS_GARDEES, filtreDeRegeneration, effacerRefabricables, restaurerOrdreLiens };
