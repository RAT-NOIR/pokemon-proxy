// ============================================================
// DÉTACHER DES LIGNES DE JOINTURE PROUVÉES FAUSSES — nommées une à une, rejugées au moment d'écrire
// ============================================================
//   node detacher-lignes-prouvees.js --decision=<date> --annonce=<fichier.json>    (simulation : rejuge chaque ligne, écrit l'annonce)
//   node lot-additif.js --quoi="…" --collections=restes --annonce=<fichier.json> -- node detacher-lignes-prouvees.js --decision=<date> --ecrire
//
// UNE LISTE FERMÉE PAR DÉCISION : un outil de détachement ne décide pas ce qui est faux, il applique une décision prise sur une
// preuve. Chaque décision garde sa liste (l'historique se relit) et une exécution n'en applique qu'UNE, nommée.
// · 2026-09-25 (soir) : « détacher uniquement les 3 lignes prouvées (Alolan Sandslash SM18, Volcanion, Exeggutor H10) » et
//   « Aquapolis : détache les 24 homonymes croisés » — Exeggutor H10 est l'un des 24 : 26 lignes en tout.
// · 2026-10-08 : les deux jointures fausses trouvées par l'épreuve de la catégorie (Umbreon ex SV-P143 -> Energy Sticker, Espeon ex
//   SV-P142 -> Double Dragon Energy). ⚠️ Le feu vert disait aussi « retirer l'impression n° 143 d'Energy Sticker » et « le
//   rattachement de Double Dragon Energy à Scarlet-Violet-Promos » : ils sont VRAIS (SV-P 143 et 142/231 chez artofpkm ET TCGdex,
//   produits 761017, 749923, 804761 joints, visuels du set) — ils ne se retirent pas ; seules les deux LIGNES sont fausses.
// 🔑 Et la preuve se REJOUE à l'écriture : si une seule ligne n'est plus contredite par son témoin (la base a bougé depuis la
// mesure), rien n'est écrit. Deux témoins, tous deux indépendants de la clé par le numéro qui a fabriqué la ligne :
//   · `attaques` : les attaques que Cardmarket écrit entre crochets désignent une AUTRE carte (score strictement supérieur) ;
//   · `nom`      : le nom du produit n'est pas le nom de la carte (« Volcanion » joint à Volcanion-EX).
// Les 24 d'Aquapolis ont été écrites le 20/09 par le bonus « jumeau » des sets e-Card japonais, avant que le témoin n'entre
// dans joindre() ; rejoué avec la jointure d'aujourd'hui (2026-09-25), le bonus ne les refait pas (190 lignes justes, 0 croisée).
// Un produit qui garde une autre ligne ne reçoit pas de reste ; un produit qui n'en garde aucune reçoit le reste de sa preuve.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { decomposerNomCardmarket, normaliserNom } = require('./collecte-cartes/jointure');

// `autre` : la carte que le témoin désigne à la place (attaques). Pour Aquapolis, c'est la carte de la ligne juste du même
// produit (slugSet « Aquapolis »), lue en base à l'exécution.
const AQUAPOLIS = ['41765|275087', '42177|275187', '42198|275191', '42499|275161', '42684|275125', '43524|275135', '43556|275137',
    '43558|275139', '48556|275193', '41499|275086', '41938|275165', '42500|275160', '41494|275085', '41517|275092', '41807|275093',
    '41926|275141', '41993|275182', '42269|275117', '42297|275144', '42298|275143', '42497|275159', '42498|275158', '43324|275130',
    '41764|275051'];
const DECISIONS = {
    '2026-09-25': [
        { id: '221206|358427', preuve: 'attaques', autre: 228226, type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'Alolan Sandslash SM18 : les attaques du produit désignent le document 228226 (TCGdex smp-SM127), pas 221206' },
        { id: '213157|553958', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Volcanion » joint à Volcanion-EX (TCGdex désigne deux autres documents Volcanion)' },
        ...AQUAPOLIS.map(id => ({ id, preuve: 'attaques', autre: 'aquapolis', type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'homonyme croisé d\'Aquapolis (bonus jumeau du 20/09) : les attaques désignent la carte de la ligne Aquapolis' }))
    ],
    // le nom + les attaques désignent UNE carte (323164, 323159), mais elle ne porte aucune impression jp SV-P, et les n° 143 et 142
    // du tirage SV-P sont Energy Sticker et Double Dragon Energy chez artofpkm ET TCGdex : la FICHE (set, numéro) n'est pas prouvée,
    // le produit reste non joint, la candidate est écrite dans le reste
    '2026-10-08': [
        { id: '286142|825498', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Umbreon ex [Moon Mirage | Onyx] » (SV-P143) joint par le numéro à Energy Sticker ; nom + attaques désignent 323164 (Umbreon ex, Prismatic Evolutions), qui n\'a pas d\'impression jp SV-P — fiche non prouvée, non joint' },
        { id: '203010|825497', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Espeon ex [Psych Out | Amazez] » (SV-P142) joint par le numéro à Double Dragon Energy ; nom + attaques désignent 323159 (Espeon ex, Prismatic Evolutions), qui n\'a pas d\'impression jp SV-P — fiche non prouvée, non joint' }
    ],
    // Lumineon V [Luminous Sign | Aqua Return] (Premium-Trainer-Box-ex n°008), joint par set+numero à Mareep (262554) ; les attaques
    // entre crochets désignent 267492 « Lumineon V » (qui déclare jp « Premium Trainer Box ex » 008) et le nom n'est pas « Mareep ».
    // Les DEUX témoins indépendants du numéro sont rejoués. La ligne juste 267492|692805 n'est PAS ajoutée ici (autre écriture).
    '2026-10-08b': [
        { id: '262554|692805', preuve: 'attaques+nom', autre: 267492, type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'Lumineon V (Premium Trainer Box ex 008) joint à Mareep par set+numero : les attaques désignent 267492 et le nom n\'est pas Mareep' }
    ],
    // FEU VERT NOMMÉ du testeur (2026-10-08) : les 7 jointures du Garchomp SP Half Deck (produits 676469-676474 et 676476) et la ligne
    // doublon Gastly 339431|860026. Chaque produit du kit est joint par set+numero à une carte d'un AUTRE nom dont aucune attaque
    // n'est celle que Cardmarket écrit entre crochets (preuve 'nom+attaques', rejouée). 676475 (Garchomp LV.X, ligne 154845) n'est
    // PAS nommée : elle ne se détache pas. Eldegoss V 481749 : interdit (voir INTERDITS).
    '2026-10-08c': [
        ...[['158470|676469', 'Magikarp'], ['158471|676470', 'Gyarados'], ['157992|676471', 'Electrike'], ['158472|676472', 'Manectric'],
            ['157993|676473', 'Gible'], ['154852|676474', 'Gabite'], ['158473|676476', 'Swablu']].map(([id, carte]) => ({
            id, preuve: 'nom+attaques', type: 'fiche-contredite-par-le-nom',
            pourquoi: `Garchomp SP Half Deck : le produit est joint par set+numero à ${carte}, d'un autre nom, qui ne porte aucune des attaques écrites par Cardmarket` })),
        { id: '339431|860026', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Hole-Digging Shovel » joint à Gastly ; la bonne ligne 338279|860026 existe déjà (doublon par setlist+numero)' }
    ],
    // FEU VERT NOMMÉ du testeur (2026-10-08, tour 2) : « détacher Garchomp LV.X 676475, même preuve et même garde que les 7 autres ». Le produit
    // « Garchomp [C] LV.X [Healing Breath | Dragon Rush] » est joint par set+numero à 154845 « Garchomp » (Dragons Exalted 91 ; attaques Jet Headbutt
    // et Sand Tomb, aucune du produit). ⚠️ La preuve 'nom+attaques' des 7 ne s'applique pas à la lettre : le nom décomposé du produit commence par
    // « Garchomp », la règle du préfixe (pensée pour la rareté « Milotic C ») exempte donc 154845. Les DEUX témoins de 'attaques+nom' tiennent :
    // Dragon Rush est une attaque de 71777 « Garchomp C LV.X » (Supreme Victors 145), 1 contre 0 ; le nom n'est pas « Garchomp ». `autre` = 71777,
    // lu en base le 2026-10-08 (aucune carte ne porte « Healing Breath », un Poké-Power). La ligne juste 71777|676475 n'est PAS ajoutée ici.
    '2026-10-08d': [
        { id: '154845|676475', preuve: 'attaques+nom', autre: 71777, type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'Garchomp LV.X (Garchomp SP Half Deck) joint par set+numero à Garchomp (Dragons Exalted 91) : les attaques écrites par Cardmarket désignent 71777 (Garchomp C LV.X) et le nom n\'est pas « Garchomp »' }
    ],
    // VIGN-AUDIT2 (2026-10-17), famille G : 15 produits servis dont le NOM contredit la carte jointe ET dont le visuel servi, regardé, montre la carte
    // jointe et non le produit. Garchomp SP Half Deck : les 7 produits restants (PtG009-015, dresseurs de l'ère Platine) sont joints aux cartes du
    // deck BW (Ultra Ball, Rare Candy, Giant Cape, Juniper, Cheren…) — même cause que 2026-10-08c ; les dresseurs n'ont pas d'attaque, preuve « nom ».
    // Les autres : Victini ex SV-P051/052 (visuel Arctibax, Bellibolt), Lance's Charizard V S-P123 (visuel Pikachu VMAX), Tornadus GX SM-P (visuel
    // Zoroark), BREAK Starter Pack Water/Grass/Fire Energy (visuels Krabby, Shellder, Cloyster), Magikarp M-P040 (visuel : l'Énergie Combat 040/M-P).
    // PHASE 2 v2 (2026-10-24) — DÉCISION DU TESTEUR : « les 20 « autre dessin » : on DÉTACHE la ligne cartes_produits fausse de chacun ; le produit devient « sans ligne », honnête, et la phase 3
    // lui refera une ligne juste. » Le nom et les attaques du produit sont ceux de la carte jointe (même Pokémon, même texte) : les témoins `nom` et `attaques` ne contredisent RIEN ici. La preuve est
    // VISUELLE (planches faux-*.jpg et incertains de l'audit S8, regardées par le coordinateur et le testeur) : preuve « vu ». Elle se REJOUE à l'écriture sur ce qui peut l'être — le produit est
    // toujours celui qui a été regardé (nom Cardmarket du catalogue) et la carte jointe est toujours celle qui a été regardée (nomEn) — et chaque ligne nomme les produits JUSTES qui partagent la même
    // carte (leur ligne n'est JAMAIS dans la décision, et doit toujours exister sur la même carte). `preuveLigne` : la clé qui avait posé la ligne (« metacarte+freres » = posée parce qu'un frère de
    // la même métacarte est joint ; « set+nom » = le nom seul) : une clé FAIBLE, c'est la cause. Rien d'autre n'est détaché.
    '2026-10-24': [
        ['237806|523095', 'Jirachi GX [Psychic Zone | Star Search | Star Shield GX]', 'Jirachi-GX', [378870], 'metacarte+freres', 'Cardmarket montre la version à illustration PLEINE de Jirachi GX (Unified Minds) ; la ligne le joint au n°79, la version ordinaire (autre illustration), seule servie : juste pour 378870 (V1-UNM79), fausse pour ce produit'],
        ['221742|321171', 'Garbodor [Trashalanche | Acid Spray]', 'Garbodor', [297513], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration de Garbodor (fond gris et rochers) que celle de Guardians Rising n°51 servie ; produit sans slug, ligne posée par un frère de métacarte'],
        ['246144|463079', 'Victory Proof', 'Victory Proof', [463074], 'set+nom', 'Cardmarket montre la 3e PLACE (3位, médaille de bronze) ; la carte jointe et son entrée montrent la 2e place (2位) : V1 = 1re, V2 = 2e, V3 = 3e place sont trois cartes jointes à une seule'],
        ['246144|463069', 'Victory Proof', 'Victory Proof', [463074], 'set+nom', 'Cardmarket montre la 1re PLACE (優勝, couronne dorée) ; la carte jointe et son entrée montrent la 2e place (2位) : trois cartes jointes à une seule'],
        ['318039|824940', 'Eevee [Boosted Evolution | Reckless Charge]', 'Eevee', [824918], 'metacarte+setlist', 'le slug Cardmarket « Eevee-V2-SV-PTH225 » est le n°225 (Eevee endormi) ; la ligne le joint au n°177 (Eevee debout), seul visuel servi : autre illustration'],
        ['224087|311404', 'M Sharpedo EX [Torpedo Dive]', 'M Sharpedo-EX', [311398, 363915], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration de M Sharpedo EX que celle de XY200 servie ; produit sans slug, ligne posée par un frère de métacarte'],
        ['181655|471679', 'Champions Festival [Duckboat]', 'Champions Festival', [468979], 'set+nom', 'Cardmarket montre une autre édition (autre millésime) des Championnats du monde que le visuel servi (WORLD CHAMPIONSHIPS 2017)'],
        ['181655|471684', 'Champions Festival [Duckboat]', 'Champions Festival', [468979], 'set+nom', 'Cardmarket montre une autre édition (autre millésime) des Championnats du monde que le visuel servi (WORLD CHAMPIONSHIPS 2017)'],
        ['223952|665136', 'Kirlia [Smack | Magical Shot]', 'Kirlia', [299494], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration de Kirlia (autre pose) que celle de Burning Shadows n°92 servie'],
        ['220756|449138', 'Choice Band', 'Choice Band', [297573], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration (promotion de championnat, tampon STAFF) que celle de Guardians Rising n°121 servie'],
        ['221788|450308', 'Rescue Stretcher', 'Rescue Stretcher', [297582], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration (promotion Pokémon League, tampon) que celle de Guardians Rising n°130 servie'],
        ['192356|554185', 'Pitch\'s Pikachu [Pika Shoot]', 'Pitch\'s Pikachu', [554180], 'set+nom+attaques', 'Cardmarket montre une AUTRE illustration (Pikachu et ballon de football, promotion du film) que la V1 servie (Pikachu debout)'],
        ['187856|700771', 'Vivillon [Conversion Powder | Colorful Wind]', 'Vivillon', [564498], 'set+numero', 'Cardmarket montre le motif « Japanese Meadow Pattern » de Vivillon ; le visuel servi montre un autre motif (autre produit : V1)'],
        ['220938|471694', 'Victory Decoration', 'Victory Decoration', [471689], 'set+nom', 'Cardmarket montre la médaille de la 1re PLACE (優勝, or) ; la carte jointe et son entrée montrent la 2e place (2位, argent)'],
        ['187856|700737', 'Vivillon [Conversion Powder | Colorful Wind]', 'Vivillon', [281354, 700739, 700740, 700742], 'set+numero', 'Cardmarket montre le motif « English High Plains Pattern » ; le visuel servi montre un autre motif (celui de la V1)'],
        ['224077|311405', 'M Camerupt EX [Magma Eruption]', 'M Camerupt-EX', [311401, 363914], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration de M Camerupt EX (autre lettrage) que celle de XY198 servie ; produit sans slug'],
        ['148517|371643', 'Ultra Ball', 'Ultra Ball', [302205], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration (balle posée sur une table, logo « League Cup ») que celle de Shining Legends n°68 servie'],
        ['221577|468924', 'Alolan Vulpix [Beacon | Icy Snow]', 'Alolan Vulpix', [297485, 319255, 886902], 'metacarte+freres', 'Cardmarket montre une AUTRE illustration de Alolan Vulpix (fond enneigé) que celle de Guardians Rising n°21 servie'],
        ['220938|471699', 'Victory Decoration', 'Victory Decoration', [471689], 'set+nom', 'Cardmarket montre la médaille de la 3e PLACE (3位, bronze) ; la carte jointe et son entrée montrent la 2e place (2位)'],
        ['187856|700744', 'Vivillon [Conversion Powder | Colorful Wind]', 'Vivillon', [281354, 700739, 700740, 700742], 'tcgdex+pont', 'Cardmarket montre le motif « Russian Icy Snow Pattern » (texte russe) ; le visuel servi montre un autre motif (celui de la V1)']
    ].map(([id, nomCm, carteNom, justes, preuveLigne, vu]) => ({ id, preuve: 'vu', type: 'fiche-contredite-par-la-vue', nomCm, carteNom, justes, preuveLigne, vu,
        pourquoi: `PHASE 2 v2 : « ${nomCm} » joint à la carte « ${carteNom} » (ligne posée par ${preuveLigne}) — ${vu}` })),
    '2026-10-17': [
        ['158475|676477', 'Energy Switch', 'Minccino'], ['148517|676478', 'Energy Search', 'Ultra Ball'], ['25165|676479', 'Switch', 'Rare Candy'],
        ['158409|676480', 'Pokédex HANDY910is', 'Giant Cape'], ['120958|676481', 'Poké Ball', 'Professor Juniper'], ['126640|676482', 'Buffer Piece', 'Cheren'],
        ['158418|676483', 'Cynthia\'s Guidance', 'Blend Energy WaterLightningFightingMetal'],
        ['282245|796963', 'Victini ex V1 SV-P051', 'Arctibax'], ['282977|796964', 'Victini ex V2 SV-P052', 'Bellibolt'],
        ['255447|786632', 'Lance\'s Charizard V S-P123', 'Pikachu VMAX'], ['226932|826648', 'Tornadus GX SM-P', 'Zoroark'],
        ['188047|563109', 'Grass Energy (BREAK Starter Pack)', 'Shellder'], ['188048|563110', 'Fire Energy (BREAK Starter Pack)', 'Cloyster'],
        ['196231|563111', 'Water Energy (BREAK Starter Pack)', 'Krabby'], ['13686|885573', 'Magikarp M-P040', 'Basic Fighting Energy']
    ].map(([id, produit, carte]) => ({ id, preuve: 'nom', type: 'fiche-contredite-par-le-nom',
        pourquoi: `VIGN-AUDIT2 : le produit « ${produit} » est joint à « ${carte} », d'un autre nom, et le visuel servi (regardé) est celui de « ${carte} »` }))
};

// Produits dont aucune ligne ne se détache par cet outil, quelle que soit la décision : la preuve n'est pas apportée.
const INTERDITS = [481749]; // Eldegoss V (V-Starter-Decks) — « on n'y touche pas, preuve à apporter » (feu vert du 2026-10-08)
const estInterdite = id => INTERDITS.includes(Number(String(id).split('|')[1]));

// Le rejeu d'une preuve, PUR (testable sans base). Rend { verdict } : une phrase si le témoin contredit encore la ligne, sinon null.
// `contexte.autres` (D2, relecture v2) : le nombre d'AUTRES lignes du même produit, que la preuve « vu » exige à 0 (sinon le produit ne deviendrait pas « sans ligne » : la ligne restante le servirait).
function jugerLigne(x, nomProduit, notre, autre, contexte = {}) {
    if (estInterdite(x.id)) return { verdict: null };
    const d = decomposerNomCardmarket(nomProduit);
    const parAttaques = () => {
        const att = d.attaques.map(normaliserNom).filter(Boolean);
        const score = c => (c?.attaques || []).filter(a => att.includes(normaliserNom(a.nom))).length;
        const [sN, sA] = [score(notre), score(autre)];
        return att.length && autre && sA > sN ? `attaques [${d.attaques.join(' | ')}] : ${x.autre ?? 'autre'} ${sA} contre ${sN}` : null;
    };
    const parNom = () => normaliserNom(d.nom) !== normaliserNom(notre?.nomEn) ? `nom « ${d.nom} » ≠ carte « ${notre?.nomEn} »` : null;
    let verdict;
    if (x.preuve === 'attaques') verdict = parAttaques();
    else if (x.preuve === 'nom') verdict = parNom();
    else if (x.preuve === 'attaques+nom') { const a = parAttaques(), n = parNom(); verdict = a && n ? `${a} ; ${n}` : null; }
    else if (x.preuve === 'nom+attaques') {
        // le nom du produit n'est pas celui de la carte ET aucune des attaques du produit n'est sur la carte (produit sans attaque : refus)
        // le décomposeur laisse la rareté entre crochets dans le nom (« Milotic C ») : le nom de la carte doit être un PRÉFIXE du nom du produit
        const nc = normaliserNom(notre?.nomEn);
        const n = nc && normaliserNom(d.nom).startsWith(nc) ? null : parNom(), att = d.attaques.map(normaliserNom).filter(Boolean);
        const sur = (notre?.attaques || []).filter(a => att.includes(normaliserNom(a.nom))).length;
        verdict = n && att.length && notre && !sur ? `${n} ; aucune des attaques [${d.attaques.join(' | ')}] sur la carte` : null;
    }
    else if (x.preuve === 'vu') {
        // PHASE 2 v2 : la preuve est visuelle, elle ne se rejoue pas par les mots ; ce qui se rejoue, c'est que le produit et la carte sont CEUX QUI ONT ÉTÉ REGARDÉS (écrits dans la décision)
        // D2 : le produit n'a AUCUNE autre ligne (`contexte.autres` = 0, jamais « inconnu »), et la décision nomme AU MOINS UN produit juste qui garde sa ligne sur la même carte
        const sansAutreLigne = contexte.autres === 0;
        const aDesJustes = Array.isArray(x.justes) && x.justes.length >= 1;
        verdict = notre && sansAutreLigne && aDesJustes && typeof x.nomCm === 'string' && x.nomCm && nomProduit === x.nomCm && typeof x.carteNom === 'string' && notre.nomEn === x.carteNom ? `vu à l'œil (planches de l'audit S8) : ${x.vu}` : null;
    }
    else verdict = null;
    return { verdict };
}

/**
 * L'ÉCRITURE du plan, séparée de main() pour être testée sur un mongod local : supprime les lignes nommées, retire le lien de CE produit à sa carte
 * (jamais celui d'un autre produit de la même carte), et nomme le trou (un reste) pour tout produit qui n'a plus aucune ligne.
 * @returns {{supprimees, attendu, encore, restes, complet}} complet = tout est supprimé et plus rien ne reste
 */
async function appliquerPlan({ L, C, R }, plan, DECISION) {
    const r = await L.deleteMany({ _id: { $in: plan.map(p => p.l._id) } });
    for (const p of plan) await C.updateOne({ _id: p.l.carteId }, { $pull: { 'liens.idProduct': p.l.idProduct } });
    let restes = 0;
    for (const p of plan.filter(p => !p.autres)) {
        restes++;
        await R.updateOne({ set: p.l.slugSet, type: p.x.type, idProduct: p.l.idProduct, carteId: p.l.carteId },
            { $set: { detail: `${p.l.idProduct} « ${p.nom} » : joint par ${p.l.preuve} à ${p.l.carteId} — ${p.x.pourquoi} ; ${p.verdict} ; détachée par detacher-lignes-prouvees.js (feu vert du testeur, décision du ${DECISION})`, le: new Date() } }, { upsert: true });
    }
    const encore = await L.countDocuments({ _id: { $in: plan.map(p => p.l._id) } });
    return { supprimees: r.deletedCount, attendu: plan.length, encore, restes, complet: r.deletedCount === plan.length && !encore };
}

async function main() {
    const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/, /^--decision=\d{4}-\d{2}-\d{2}[a-z]?$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    const ecrire = process.argv.includes('--ecrire');
    const annonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
    const DECISION = process.argv.find(a => a.startsWith('--decision='))?.slice(11);
    const LIGNES = DECISIONS[DECISION];
    if (inconnus.length || ecrire === !!annonce || !LIGNES) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}${DECISION && !LIGNES ? `décision inconnue : ${DECISION} — ` : ''}usage : --decision=<${Object.keys(DECISIONS).join('|')}> --annonce=<fichier.json> (simulation) | --decision=<…> --ecrire`); process.exit(2); }

    // D3 (relecture v2) : `--ecrire` ne tourne QUE sous lot-additif.js (sauvegarde, garde avant/après, contrat de l'API, restauration) — avant toute lecture, comme corriger-visuels-phase2.js
    if (ecrire) { try { require('./collecte-cartes/phase2-visuels').garderSousLot(process.env, process.ppid, `node lot-additif.js --quoi="…" --collections=restes --annonce=<annonce.json> -- node detacher-lignes-prouvees.js --decision=${DECISION} --ecrire`); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    const interdites = LIGNES.filter(x => estInterdite(x.id));
    if (interdites.length) { console.error(`❌ ligne(s) interdite(s) (preuve non apportée) : ${interdites.map(x => x.id).join(' ')} — rien n'est lu ni écrit`); process.exit(2); }
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const L = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes');
    const lignes = await L.find({ _id: { $in: LIGNES.map(x => x.id) } }).toArray();
    const parId = new Map(lignes.map(l => [l._id, l]));
    const ids = [...new Set(lignes.map(l => l.idProduct))];
    const nomCat = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
    const toutes = await L.find({ idProduct: { $in: ids } }).toArray();
    console.log(`\n════ ${LIGNES.length} lignes nommées · ${lignes.length} trouvées en base · ${ids.length} produits · ${toutes.length} lignes de ces produits ════`);
    const fautes = [], plan = [];
    // les produits JUSTES nommés par la décision (preuve « vu ») : leur ligne doit exister sur la MÊME carte, et elle n'est jamais détachée
    const nommesJustes = [...new Set(LIGNES.flatMap(x => x.justes || []))];
    const lignesJustes = nommesJustes.length ? await L.find({ idProduct: { $in: nommesJustes } }).project({ idProduct: 1, carteId: 1 }).toArray() : [];
    for (const x of LIGNES) {
        const l = parId.get(x.id);
        if (!l) { fautes.push(`${x.id} : absente de la base`); continue; }
        for (const j of x.justes || []) if (!lignesJustes.some(t => t.idProduct === j && t.carteId === l.carteId)) fautes.push(`${x.id} : le produit juste ${j} n'a plus de ligne sur la carte ${l.carteId} — la décision ne tient plus`);
        if ((x.justes || []).some(j => LIGNES.some(y => y.id.endsWith(`|${j}`)))) fautes.push(`${x.id} : un produit « juste » est aussi dans la décision`);
        const nom = nomCat.get(l.idProduct);
        if (!nom) { fautes.push(`${x.id} : produit ${l.idProduct} absent du catalogue`); continue; }
        const d = decomposerNomCardmarket(nom);
        const notre = await C.findOne({ _id: l.carteId }, { projection: { nomEn: 1, attaques: 1 } });
        let autreId = x.autre;
        if (autreId === 'aquapolis') autreId = toutes.find(t => t.idProduct === l.idProduct && t.slugSet === 'Aquapolis')?.carteId;
        const autres = toutes.filter(t => t.idProduct === l.idProduct && t._id !== l._id);
        const autre = x.preuve !== 'nom' && autreId != null ? await C.findOne({ _id: autreId }, { projection: { nomEn: 1, attaques: 1 } }) : null;
        if (x.preuve === 'vu' && autres.length) fautes.push(`${x.id} : le produit garde ${autres.length} AUTRE(S) ligne(s) (${autres.map(t => t._id).join(', ')}) : il ne deviendrait pas « sans ligne » — la décision ne tient plus`);
        if (x.preuve === 'vu' && !(Array.isArray(x.justes) && x.justes.length >= 1)) fautes.push(`${x.id} : aucun produit juste nommé (justes vide) — la décision n'est pas écrivable`);
        const { verdict } = jugerLigne({ ...x, autre: autreId }, nom, notre, autre, { autres: autres.length });
        if (!verdict) fautes.push(`${x.id} « ${nom} » : le(s) témoin(s) ${x.preuve} ne contredi(sen)t plus la ligne (carte jointe « ${notre?.nomEn} », autre ${autreId ?? '—'})`);
        if (verdict) plan.push({ x, l, nom, verdict, autres: autres.length });
        console.log(`   ${verdict ? '✅' : '🔴'} ${x.id} « ${nom} » exp ${l.idExpansion} ${l.slugSet ?? 'slugSet null'} (${l.preuve}) → ${verdict ?? 'NON CONTREDITE'} · le produit garde ${autres.length} autre(s) ligne(s)`);
    }
    if (fautes.length) { console.error(`\n🔴 ${fautes.length} ligne(s) ne se rejugent pas comme à la mesure — RIEN n'est écrit :\n   ${fautes.join('\n   ')}`); await fermer(); process.exitCode = 1; return; }

    // L'annonce : ce que la garde verra, comptée par SA fonction sur les expansions touchées, avant et après le retrait.
    const exps = [...new Set(lignes.map(l => l.idExpansion))];
    const avant = await L.find({ idExpansion: { $in: exps } }).project({ idExpansion: 1, idProduct: 1 }).toArray();
    const retirees = new Set(plan.map(p => p.l._id));
    const cmp = comparer(compterEtat({ cartesProduits: avant }), compterEtat({ cartesProduits: avant.filter(l => !retirees.has(l._id)) }));
    const baisses = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    console.log(`   baisses que la garde verra : ${Object.entries(baisses).map(([k, v]) => `${k} −${v}`).join(' ; ') || 'aucune'} (un produit qui garde une autre ligne ne fait rien baisser)`);

    if (!ecrire) {
        fs.writeFileSync(path.resolve(annonce), JSON.stringify(baisses, null, 1));
        console.log(`   annonce écrite : ${annonce}\n   (simulation — rien n'est écrit en base)`);
        await fermer(); return;
    }
    const r = await appliquerPlan({ L, C, R: cx.db.collection('restes') }, plan, DECISION);
    console.log(`\n   ✅ détachées : ${r.supprimees} (attendu ${r.attendu}) · encore présentes : ${r.encore} · restes écrits : ${r.restes} (produits restés sans ligne)`);
    await fermer();
    if (!r.complet) process.exitCode = 1;
}
module.exports = { DECISIONS, jugerLigne, estInterdite, appliquerPlan };
if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
