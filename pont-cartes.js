// ============================================================
// LE PONT — notre base `cartes` à la place de TCGdex, sur les sets qu'elle couvre
// ============================================================
// SPEC-PONT.md, câblé le 2026-09-12. UNE fonction, appelée par la route (/api/identifier) ET par
// `apres()` du banc — la même, dans le même commit (règle de symétrie).
//
// LA RÈGLE : la base répond D'ABORD ; si elle rend au moins une carte, TCGdex n'est PAS appelé ; si
// elle rend zéro carte, TCGdex est appelé comme avant. Jamais deux réponses : les deux sources sont
// DISJOINTES par construction. Sur les 28 sets couverts, le pont TCGdex est faux par construction
// (sets-vintage-japonais.js) ou muet ; une réponse TCGdex n'y est pas une seconde opinion, c'est
// l'erreur qu'on remplace. Hors périmètre, la base ne sait rien et le dit : `source: 'aucune'`.
//
// LA GARDE AMONT, EXPLICITE : la base ne porte que 28 sets japonais 1996-2007. Elle n'est interrogée
// que si la région attendue est japonaise ET que le setCode lu ne contredit pas le vintage. C'est
// l'appelant qui la pose (il tient `regionAttendue` et `setCodeCompatibleVintage`) ; ici on la
// VÉRIFIE et on refuse de répondre sans elle — `raison: 'garde-amont'`.
//
// CE QUE LA BASE REND : des PRODUITS Cardmarket (cartes_produits, tirage japonais, expansions des
// 28 sets) — un VIVIER, pas un gagnant. Le scoring et les départages existants décident ensuite.
// Elle ne rend ni `variants` ni `variants_detailed` : sur ces sets ils n'existaient pas (0 idProduct
// sur les cartes japonaises, mesuré le 2026-08-15).

const mongoose = require('mongoose');
const { modeles } = require('./collecte-cartes/schemas');
const { TABLE } = require('./collecte-cartes/table-sets');
const { normaliserNom, chiffresDuNumero, decomposerNomCardmarket } = require('./collecte-cartes/jointure');

const NOMS_COUVERTS = new Set(TABLE.flatMap(l => [].concat(l.bulba.expansion)));
const EXPANSIONS_COUVERTES = new Set(TABLE.map(l => l.exp));
const kana = s => /[぀-ヿ一-鿿]/.test(String(s || ''));

let _cx = null, _M = null, _indisponible = null;
async function modelesCartes() {
    if (_M) return _M;
    if (_indisponible) return null;
    const uri = process.env.MONGODB_CARTES_URI;
    if (!uri || uri === process.env.MONGODB_URI) {
        _indisponible = !uri ? 'MONGODB_CARTES_URI absent' : 'MONGODB_CARTES_URI égal au cluster de production';
        console.error(`⚠️ [pont] base cartes INDISPONIBLE : ${_indisponible}. TCGdex répondra seul — ce n'est pas un état voulu, c'est une panne de configuration.`);
        return null;
    }
    try {
        _cx = await mongoose.createConnection(uri, { dbName: process.env.MONGODB_CARTES_BASE || 'cartes', serverSelectionTimeoutMS: 8000 }).asPromise();
        _M = modeles(_cx);
        console.log(`🌉 [pont] base cartes connectée : ${_cx.db.databaseName} sur ${_cx.host}`);
        return _M;
    } catch (e) {
        _indisponible = e.message;
        console.error(`⚠️ [pont] connexion à la base cartes impossible : ${e.message}`);
        return null;
    }
}

/**
 * Interroge la base sur ce que l'IA a lu.
 * @param {object} lu  { nom, nomBrut, numero, total, setCode, attaqueLue, langue }
 * @param {object} garde  { regionJaponaise: boolean, setCodeCompatible: boolean } — posée par l'appelant
 * @returns {Promise<{source:'base-cartes'|'aucune', cartes:object[], produits:number[], expansions:number[], raison:string}>}
 */
async function interrogerPont(lu, garde) {
    const vide = raison => ({ source: 'aucune', cartes: [], produits: [], expansions: [], raison });
    if (!garde || garde.regionJaponaise !== true || garde.setCodeCompatible !== true) {
        return vide(`garde-amont : région ${garde?.regionJaponaise === true ? 'japonaise' : 'non japonaise'}, setCode ${garde?.setCodeCompatible === true ? 'compatible' : 'incompatible ou non évalué'}`);
    }
    const M = await modelesCartes();
    if (!M) return vide(`base indisponible : ${_indisponible}`);

    // 1. le nom : kana contre nomJa, sinon nom contre nomEn (LV.X reconstruit depuis `level=X`)
    const ou = [];
    if (kana(lu.nomBrut)) ou.push({ nomJa: String(lu.nomBrut).trim() });
    if (lu.nom) ou.push({ nomEn: new RegExp('^' + String(lu.nom).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
    if (!ou.length) return vide('aucun nom lu');
    let cartes = await M.Carte.find({ $or: ou, sets: { $exists: true, $ne: [] } }).select('nomEn nomJa niveau ndex attaques impressions sets').lean();
    const cle = normaliserNom(lu.nom);
    cartes = cartes.filter(c => (kana(lu.nomBrut) && normaliserNom(c.nomJa) === normaliserNom(lu.nomBrut))
        || normaliserNom(c.nomEn + (String(c.niveau || '').toUpperCase() === 'X' ? ' LV.X' : '')) === cle
        || normaliserNom(String(c.nomEn).replace(/^Basic\s+/i, '')) === cle);
    if (!cartes.length) return vide('aucune carte de ce nom dans les 28 sets');
    let raison = `nom : ${cartes.length} carte(s)`;

    // 2. le numéro, clé V : collection sur un set numéroté ; POKÉDEX sur un set sans numéros.
    //    Le caractère « numéroté » se juge sur les impressions du set COUVERT, pas de la page.
    const num = chiffresDuNumero(lu.numero);
    if (num) {
        const avecNum = cartes.filter(c => {
            const imps = (c.impressions || []).filter(i => i.tirage === 'jp' && NOMS_COUVERTS.has(i.expansion));
            const numerote = imps.some(i => i.numero != null);
            return imps.some(i => chiffresDuNumero(i.numero) === num) || (!numerote && (c.ndex == null || String(c.ndex) === num));
        });
        if (avecNum.length) { cartes = avecNum; raison += ` ; n°${lu.numero} (collection ou Pokédex) : ${cartes.length}`; }
        else raison += ` ; n°${lu.numero} ne restreint pas`;
    }
    // 3. les produits, tirage japonais, expansions couvertes
    const liens = await M.CarteProduit.find({ carteId: { $in: cartes.map(c => c._id) }, tirage: 'jp', idExpansion: { $in: [...EXPANSIONS_COUVERTES] } }).select('carteId idProduct idExpansion').lean();
    let produits = [...new Set(liens.map(l => l.idProduct))];
    if (!produits.length) return vide(raison + ' ; aucun produit joint');
    // 4. l'attaque lue, si elle sépare (sur les crochets Cardmarket, comme departerParAttaque)
    if (lu.attaqueLue && produits.length > 1) {
        const CP = mongoose.connection.db?.collection('catalogue_produits');
        if (CP) {
            const noms = new Map((await CP.find({ idProduct: { $in: produits } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, decomposerNomCardmarket(p.name).attaques]));
            const a = normaliserNom(lu.attaqueLue);
            const avec = produits.filter(p => (noms.get(p) || []).some(x => normaliserNom(x) === a));
            if (avec.length) { produits = avec; raison += ` ; attaque « ${lu.attaqueLue} » : ${produits.length}`; }
        }
    }
    const expansions = [...new Set(liens.filter(l => produits.includes(l.idProduct)).map(l => l.idExpansion))];

    // 5. EXHAUSTIVITÉ — la base ne porte que 28 sets. Si le catalogue Cardmarket connaît d'autres
    //    produits de ce nom dans des expansions JAPONAISES HORS de ces 28, la réponse n'est pas
    //    exhaustive : la vraie carte peut être dehors (Ho-Oh n°250 : la base désigne N3, la vérité
    //    654129 est ailleurs). Un survivant unique d'un ensemble amputé est un RESTE, pas une
    //    désignation (CLAUDE.md §8, §12). La réponse est rendue, mais `exhaustif: false` : l'appelant
    //    ne peut pas l'affirmer, seulement la suggérer.
    let exhaustif = true, horsPerimetre = 0;
    try {
        const CP = mongoose.connection.db?.collection('catalogue_produits');
        const CS = mongoose.connection.db?.collection('codes_set');
        if (CP && CS) {
            const nomsDeBase = [...new Set(cartes.map(c => c.nomEn))];
            const homonymes = await CP.find({ name: { $in: nomsDeBase.flatMap(n => [new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|\\[|$)', 'i')]) } }, { projection: { idProduct: 1, idExpansion: 1 } }).toArray();
            const expsHors = [...new Set(homonymes.map(p => p.idExpansion).filter(e => e != null && !EXPANSIONS_COUVERTES.has(e)))];
            if (expsHors.length) {
                // Région japonaise OU INCONNUE : 229 expansions n'ont pas de région (premier principe,
                // « je ne sais pas » n'est pas « occidentale »). Brock's Rhyhorn et Berry, 2026-09-12 :
                // la vraie carte était dans une expansion sans région, et le pont affirmait.
                const occidentales = new Set((await CS.find({ idExpansion: { $in: expsHors }, region: 'occidental' }, { projection: { idExpansion: 1 } }).toArray()).map(c => c.idExpansion));
                horsPerimetre = expsHors.filter(e => !occidentales.has(e)).length;
                exhaustif = horsPerimetre === 0;
            }
        }
    } catch (e) { exhaustif = false; raison += ` ; exhaustivité non évaluée (${e.message})`; }
    return {
        source: 'base-cartes', cartes, produits, expansions, exhaustif, horsPerimetre,
        raison: raison + ` -> ${produits.length} produit(s), ${expansions.length} expansion(s)` + (exhaustif ? '' : ` ; NON exhaustif : ${horsPerimetre} expansion(s) japonaise(s) hors des 28 portent ce nom`)
    };
}

module.exports = { interrogerPont, EXPANSIONS_COUVERTES, NOMS_COUVERTS };
