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

/** Le filtre d'effacement d'un rejeu : les lignes des cartes du set, de ses expansions, ET d'une preuve que joindre() refabrique. */
const filtreDeRegeneration = (idsCartes, expsDeCeSet) => ({ carteId: { $in: idsCartes }, idExpansion: { $in: expsDeCeSet }, preuve: { $in: [...PREUVES_DE_JOINDRE] } });

/**
 * Efface ce que joindre() va réécrire, recompose les liens dénormalisés depuis ce qui RESTE. Les lignes gardées gardent leurs liens : `liens.idMetacards`
 * (posé par d'autres outils pour leurs lignes) n'est vidé que sur une carte qui n'a aucune ligne gardée.
 * @param {{CarteProduit: object, Carte: object}} M  modèles mongoose (ou faux modèles du banc)
 */
async function effacerRefabricables(M, idsCartes, expsDeCeSet) {
    await M.CarteProduit.deleteMany(filtreDeRegeneration(idsCartes, expsDeCeSet));
    let gardees = 0;
    for (const id of idsCartes) {
        const restantes = await M.CarteProduit.find({ carteId: id }).select('idProduct preuve').lean();
        const dejaGardees = restantes.filter(x => !PREUVES_DE_JOINDRE.includes(x.preuve)).length;
        gardees += dejaGardees;
        await M.Carte.updateOne({ _id: id }, dejaGardees
            ? { $set: { 'liens.idProduct': restantes.map(x => x.idProduct) } }
            : { $set: { 'liens.idProduct': restantes.map(x => x.idProduct), 'liens.idMetacards': [] }, $unset: { 'liens.idMetacard': 1 } });
    }
    return { gardees };
}

module.exports = { PREUVES_DE_JOINDRE, PREUVES_GARDEES_PRODUITES, filtreDeRegeneration, effacerRefabricables };
