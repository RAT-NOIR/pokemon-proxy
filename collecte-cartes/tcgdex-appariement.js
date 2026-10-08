// ============================================================
// QUELLE CARTE TCGdex EST CETTE IMPRESSION INTERNATIONALE ? — une définition, pour les scans ET les illustrateurs
// ============================================================
// La clé est le NUMÉRO (`cleNumero`, préfixe gardé : TG01 n'est pas 1) dans le set TCGdex de l'expansion ; le NOM est
// le témoin, par `temoinDuNom` — la fonction de `joindre()`, jamais une copie (§21 bis). « 0 ambigu ne veut pas dire
// 0 faux » : un numéro croisé chez l'une des sources (les Kyurem d'EX Battle Boost) désigne une carte UNIQUE et fausse,
// et seul le nom, qui n'est pas dans la clé, peut le dire. Un écart de FORME (le nom ne désigne aucune autre carte du
// set) laisse le témoin muet : la réponse passe, comme dans la jointure du texte.
// Chaque impression reçoit UNE réponse, ou un MOTIF — jamais un silence : une impression sans scan ni illustrateur est
// un trou, et un trou se compte.
// ➕ 2026-10-08 (A4/A5) — trois précisions, chacune mesurée au rejeu des 173 unités :
//  · un numéro porté par plusieurs de NOS cartes n'est plus toujours ambigu (cleNumero retire les zéros : « 015 » Lunala et « 15 »
//    Venusaur de Celebrations) : le NOM de la carte TCGdex départage quand elle est seule à ce numéro et que EXACTEMENT UNE porteuse
//    lui est compatible ; sinon ambigu comme avant ;
//  · LV.X : TCGdex nomme « Gliscor » notre « Gliscor LV.X » ; le suffixe est repris pour le témoin si NOTRE carte est LV.X ET que la
//    rareté TCGdex le dit (nomPourTemoin) ;
//  · « SWSH160 (Top Right) » : la parenthèse finale est retirée ici (V-UNION), jamais dans cleNumero (clé de la jointure du texte) ;
//  · `peutRecevoir` : les cartes hors slug sont témoins, jamais récipiendaires (voir apparierExpansion).
const { cleNumero: cleNumeroBrute, temoinDuNom, nomJointDe, clesNom } = require('./jointure');
// 🔑 « SWSH160 (Top Right) » : nos impressions V-UNION portent le quart entre parenthèses, TCGdex le localId nu (« SWSH160 »).
// La parenthèse finale est retirée ICI, au point d'appel TCGdex, et pas dans `cleNumero` : cette clé est aussi celle de la
// jointure du TEXTE (cartes_produits), qu'un changement de lecture déplacerait. Les quarts d'une même carte gardent chacun leur
// numéro (SWSH159…162) : aucune clé n'est partagée, et si deux CARTES tombaient sur la même, `parNumNous` les refuse.
const cleNumero = n => cleNumeroBrute(String(n ?? '').replace(/\s*\([^)]*\)\s*$/, ''));
// 🔑 LV.X : TCGdex nomme « Gliscor » la carte dont la rareté est « Rare Holo LV.X » ; nous, « Gliscor LV.X ». Le suffixe n'est repris
// pour le témoin que si NOTRE carte est une LV.X ET que la rareté TCGdex le dit (deux témoins : dp7-SH1 « Drifloon » est étiquetée
// LV.X par TCGdex sans l'être — la rareté seule n'est pas fiable). Sinon le nom est soumis tel quel.
const nomPourTemoin = (t, c) => (/LV\.X\s*$/i.test(nomJointDe(c)) && /LV\.X/i.test(String(t.rarity || '')) && !/LV\.X\s*$/i.test(String(t.name || ''))) ? `${t.name} LV.X` : t.name;

/**
 * @param {string} expansion   nom Bulbapedia de l'expansion (celui des impressions)
 * @param {object[]} cartes    nos cartes ; seules leurs impressions `intl` de cette expansion sont traitées
 * @param {object[]} tcg       cartes du set TCGdex { id, localId, name, illustrator, image }
 * @param {string} [tirage]    le tirage des impressions traitées — `intl` par défaut (l'anglais) ; ➕ 2026-09-29 : `idth`/`id` pour
 *                             le set TCGdex indonésien du même CODE. Le témoin reste le nom : TCGdex indonésien garde le nom anglais
 *                             des Pokémon ; un Dresseur traduit ne désigne aucune autre carte du set, le témoin se tait (écart de forme).
 * @returns {{carte, index, numero, tcg?, motif?, detail?}[]}  `index` = position de l'impression dans `carte.impressions`
 */
function apparierExpansion(expansion, cartes, tcg, tirage = 'intl', peutRecevoir = null) {
    // 🔑 TÉMOINS ET RÉCIPIENDAIRES (relecture I1) : `cartes` peut contenir des cartes vues HORS du slug de l'unité (Celebrations :
    // Reshiram ; Additionals xASC/xPBL… qui déclarent la même expansion que leur ligne principale). Elles servent de TÉMOIN du nom
    // (`temoin`, `parId`), jamais de récipiendaire : sans `peutRecevoir` toutes reçoivent (illustrateurs, comportement d'avant) ;
    // avec, seules les cartes qu'il accepte ont une réponse. Une carte hors slug reste PORTEUSE du numéro (elle peut contredire ou
    // départager par son nom : Reshiram 002 contre Blastoise 2 ; Professor's Research 024 contre _____'s Pikachu 24) SAUF si elle
    // n'est que le DOUBLE d'une récipiendaire au même numéro (même nom : l'Additional d'une carte principale) — celle-là ne doit ni
    // recevoir le scan ni faire perdre le sien à la principale (`parNumNous`, `porteursDe`).
    const concernees = cartes.filter(c => (c.impressions || []).some(i => i.tirage === tirage && i.expansion === expansion));
    const temoin = temoinDuNom(concernees);
    const parId = new Map(concernees.map(c => [c._id, c]));
    const recoit = c => !peutRecevoir || peutRecevoir(c);
    const parNumTcg = new Map();
    for (const t of tcg) { const k = cleNumero(t.localId); if (k) (parNumTcg.get(k) || parNumTcg.set(k, []).get(k)).push(t); }
    const parNumNous = new Map();
    for (const c of concernees) for (const i of c.impressions) if (i.tirage === tirage && i.expansion === expansion) {
        const k = cleNumero(i.numero); if (k) (parNumNous.get(k) || parNumNous.set(k, new Set()).get(k)).add(c._id);
    }
    const nomsDe = c => c.nomEn ? clesNom(nomJointDe(c)) : [];
    const porteursDe = k => {
        const ids = [...(parNumNous.get(k) || [])];
        if (!peutRecevoir) return ids;
        const recevants = ids.filter(id => recoit(parId.get(id)));
        return ids.filter(id => recoit(parId.get(id)) || !recevants.some(r => nomsDe(parId.get(r)).some(x => nomsDe(parId.get(id)).includes(x))));
    };
    const R = [];
    for (const c of concernees) if (recoit(c)) c.impressions.forEach((i, index) => {
        if (i.tirage !== tirage || i.expansion !== expansion) return;
        const base = { carte: c, index, numero: i.numero };
        const k = cleNumero(i.numero);
        if (!k) return R.push({ ...base, motif: 'impression-sans-numero' });
        const ts = parNumTcg.get(k) || [];
        const porteurs = porteursDe(k);
        if (porteurs.length > 1) {
            // « 015 » (Lunala) et « 15 » (Venusaur) : cleNumero retire les zéros. Le NOM de la carte TCGdex départage — mais seulement
            // quand TCGdex n'a qu'UNE carte à ce numéro et que EXACTEMENT UNE de nos porteuses lui est compatible ; sinon, ambigu.
            const ambigu = { ...base, motif: 'numero-ambigu-chez-nous', detail: `n°${i.numero} porté par ${porteurs.join(', ')}` };
            if (ts.length !== 1) return R.push(ambigu);
            const compatibles = porteurs.filter(id => !temoin(parId.get(id), { nom: nomPourTemoin(ts[0], parId.get(id)), attaques: [] }));
            if (compatibles.length !== 1) return R.push(ambigu);
            if (compatibles[0] !== c._id) return R.push({ ...base, motif: 'contredite-par-le-nom', detail: `${ts[0].id} « ${ts[0].name} » désigne ${compatibles[0]}` });
        }
        if (!ts.length) return R.push({ ...base, motif: 'absente-de-tcgdex' });
        if (ts.length > 1) return R.push({ ...base, motif: 'numero-ambigu-chez-tcgdex', detail: ts.map(t => t.id).join(', ') });
        const t = ts[0];
        const autres = temoin(c, { nom: nomPourTemoin(t, c), attaques: [] });
        if (autres) return R.push({ ...base, motif: 'contredite-par-le-nom', detail: `${t.id} « ${t.name} » désigne ${autres.map(a => `${a._id} « ${a.nomEn} »`).join(', ')}` });
        R.push({ ...base, tcg: t });
    });
    return R;
}

/**
 * 🔑 LES CARTES QUE LE TÉMOIN DOIT VOIR : celles qui portent le slug du set ET celles qui DÉCLARENT l'impression, slug ou non.
 * `M.Carte.find({ sets: slug })` ne voyait pas 43 cartes du tirage principal (Celebrations : Reshiram, Pikachu, Zekrom, Mew,
 * Professor's Research n'ont pas « Celebrations » dans `cartes.sets`) : le témoin ne pouvait donc pas contredire Blastoise n°2
 * (Classic Collection) rattachée par le numéro à cel25-2 = Reshiram, et deux faux visuels ont été servis (2026-10-05).
 * C'est la lecture de construire-illustrateurs.js (toutes les cartes qui déclarent l'impression) — une seule définition.
 */
function filtreCartesDuSet(slugSet, expansions, tirage = 'intl') {
    return { $or: [{ sets: slugSet }, { impressions: { $elemMatch: { tirage, expansion: { $in: [].concat(expansions) } } } }] };
}

/** Les seules cartes qui reçoivent un scan sous le slug d'une unité : celles qui le portent dans `cartes.sets` (`.select(... sets)`). */
const recevantsDuSet = slugSet => c => Array.isArray(c.sets) && c.sets.includes(slugSet);

module.exports = { apparierExpansion, filtreCartesDuSet, recevantsDuSet, nomPourTemoin };
