// ============================================================
// IDENTIFICATION LOCALE — sans TCGdex
// ============================================================
// POURQUOI. L'identification est aujourd'hui CONDITIONNÉE à la réussite de TCGdex :
// si trouverCarteTCGdex rend null, la route rembourse et répond « carte non trouvée ».
// Or TCGdex ne connaît pas les e-Series japonaises, et notre propre catalogue, lui, a
// la réponse. Mesuré sur les annonces réelles remontées :
//   Arbok  n°099 -> 2 produits nommés « Arbok »  au n°099 -> 650689 EC1  160,08 €
//   Rhydon n°055 -> 1 seul produit nommé « Rhydon » au n°055 -> 653962 EC4  72,22 €
//   Ledian n°007 -> 2 produits nommés « Ledian » au n°007 -> 653888 EC4  147,94 €
// Le critère région, une fois correct, suffit à trancher : Ledian EC4 japonais marque 95,
// son homonyme XY occidental à 0,23 € marque 30.
//
// ET LE SECOND CAS, PIRE. Quand TCGdex trouve la carte AILLEURS (un Rhydon occidental au
// mauvais numéro), `numeroContredit` déclare le nom suspect et le vivier par nom est
// entièrement SAUTÉ : il ne reste que la recherche dans l'expansion attendue, issue du
// pont total -> set. Sur un total de 088, ce pont désigne « Perfect Order » (2025). Le
// nom était pourtant la meilleure piste disponible.
//
// CE QUE CE CHEMIN N'APPORTE PAS. Sans TCGdex on perd `variantsDetailed`, donc le routage
// des motifs de reverse (jusqu'à x100 d'écart de prix). Tout résultat obtenu ici est donc
// marqué incertain — c'est une identification de repli, pas un chemin nominal.
//
// L'ATOUT DÉCISIF EST `nomFr`. Le champ, appris de Cardmarket, couvre 97,9 % de
// numeros_cartes. C'est lui qui permet d'apparier « Carabaffe » sans passer par la
// traduction de TCGdex — mesuré : il ramène bien les 3 candidats attendus.
//
// ⚠️ AUCUNE requête sur toute la collection : on filtre par NOM d'abord (indexable), le
// numéro ensuite. Charger les 69 598 documents de numeros_cartes à chaque scan serait
// inacceptable sur le chemin critique.

const mongoose = require('mongoose');
const {
    choisirMeilleur, comparerNumeros, prixDeReference, regionDuCodeSet, bilanDesRangs
} = require('./scoring');

// Modèles guardés : ce module est requis par index.js, qui déclare déjà les siens sur les
// mêmes collections. Sans le garde, un second require lèverait OverwriteModelError.
const libre = () => new mongoose.Schema({}, { strict: false });
const NumeroCarte = mongoose.models.NumeroCarte || mongoose.model('NumeroCarteIL', libre(), 'numeros_cartes');
const CatalogueProduit = mongoose.models.CatalogueProduit || mongoose.model('CatalogueProduitIL', libre(), 'catalogue_produits');
const CodeSet = mongoose.models.CodeSet || mongoose.model('CodeSetIL', libre(), 'codes_set');
const GuidePrix = mongoose.models.GuidePrix || mongoose.model('GuidePrixIL', libre(), 'guide_prix');

// Même normalisation de nom que index.js (trouverProduitsLocaux) : le format Cardmarket
// est très irrégulier. Toute divergence entre les deux ferait que le chemin de repli et
// le chemin nominal ne verraient pas les mêmes candidats.
const normaliserNom = n => String(n || '').toLowerCase().replace(/[\s\-'.&]/g, '');
const echapperRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EST_CODE_CARD = /code\s*card/i;

/**
 * Identifie une carte dans le SEUL catalogue local, sans TCGdex.
 *
 * @param {object} lu
 * @param {string} lu.nomLu           nom lu par l'IA (anglais OU français)
 * @param {string} lu.numeroLu        numéro de collection lu — INDISPENSABLE
 * @param {string|null} lu.regionAttendue  'occidental' | 'japonais' | null
 * @param {string|null} lu.setCodeLu
 * @param {string|null} lu.rarete
 * @param {boolean} lu.rareteElevee
 * @param {string|null} lu.total
 * @returns {Promise<null|{produits, scores, gagnant, voie, raison, ecartScore, rangs, incertain}>}
 *   null quand rien d'exploitable. `incertain` est TOUJOURS vrai : voir l'en-tête.
 */
async function identifierEnLocal({
    nomLu, numeroLu, regionAttendue = null, setCodeLu = null,
    rarete = null, rareteElevee = false, total = null
} = {}) {
    if (mongoose.connection.readyState !== 1) return null;
    // Sans numéro, ce chemin n'a pas de discriminant : le nom seul ramène jusqu'à 153
    // produits (mesuré sur « Charmander ») que rien ne départage. On préfère ne rien
    // affirmer — l'appelant traitera ça comme un échec, avec remboursement.
    if (!nomLu || numeroLu == null || String(numeroLu).trim() === '') return null;

    const cible = normaliserNom(nomLu);
    if (!cible) return null;

    // ---- 1. Candidats par le NOM, dans les deux langues -------------------
    // (a) nom ANGLAIS du catalogue. Pré-filtre sur le premier mot significatif, comme
    //     trouverProduitsLocaux, puis égalité normalisée sur la partie avant "[".
    const premierMot = String(nomLu).replace(/^(M|Mega)[\s-]*/i, '').split(/[\s&-]/)[0];
    const parAnglais = premierMot && premierMot.length >= 3
        ? (await CatalogueProduit.find({ name: new RegExp(echapperRegex(premierMot), 'i') }).lean())
            .filter(p => normaliserNom(String(p.name).split('[')[0]) === cible)
        : [];

    // (b) nom FRANÇAIS appris de Cardmarket. C'est ce qui rattrape « Carabaffe ».
    const docsFr = await NumeroCarte.find(
        { nomFr: new RegExp(`^${echapperRegex(nomLu)}$`, 'i') },
        { idProduct: 1 }
    ).lean();
    const parFrancais = docsFr.length
        ? await CatalogueProduit.find({ idProduct: { $in: docsFr.map(d => d.idProduct) } }).lean()
        : [];

    const parId = new Map();
    for (const p of [...parAnglais, ...parFrancais]) {
        if (!EST_CODE_CARD.test(String(p.name || ''))) parId.set(p.idProduct, p);
    }
    const candidatsNom = [...parId.values()];
    if (!candidatsNom.length) return null;

    // ---- 2. Filtre par NUMÉRO, préférence stricte pour l'égalité exacte ---
    // Même règle que trouverProduitsParNumero : les numéros à préfixe (« S19 », « TG09 »)
    // collisionnent avec les numéros nus, donc on ne retombe sur les chiffres qu'à défaut.
    const numeros = new Map((await NumeroCarte.find(
        { idProduct: { $in: candidatsNom.map(p => p.idProduct) } }
    ).lean()).map(d => [d.idProduct, d]));

    const notes = [];
    for (const p of candidatsNom) {
        const d = numeros.get(p.idProduct);
        if (!d) continue;
        const corr = comparerNumeros(numeroLu, d.numero) || comparerNumeros(numeroLu, d.numeroUrl);
        if (corr) notes.push({ p, d, corr });
    }
    if (!notes.length) return null;
    const exactes = notes.filter(n => n.corr === 'exact');
    const retenus = exactes.length ? exactes : notes;

    // ---- 3. Enrichissement et scoring -------------------------------------
    const exps = [...new Set(retenus.map(n => n.p.idExpansion).filter(e => e != null).map(Number))];
    const lignesSet = await CodeSet.find({ idExpansion: { $in: exps } }).lean();
    const codeParExp = new Map(lignesSet.map(l => [Number(l.idExpansion), l.codeSet]));
    // La région DÉRIVÉE fait foi (voir deriver-region.js) ; à défaut, seules les preuves
    // tirées du code lui-même comptent, et « inconnu » laisse le critère neutre.
    const regionParExp = new Map(lignesSet.filter(l => l.region).map(l => [Number(l.idExpansion), l.region]));
    const guides = new Map((await GuidePrix.find(
        { idProduct: { $in: retenus.map(n => n.p.idProduct) } }
    ).lean()).map(g => [Number(g.idProduct), g]));

    const enrichis = retenus.map(({ p, d }) => {
        const code = codeParExp.get(Number(p.idExpansion)) ?? d.codeSet ?? null;
        return {
            idProduct: p.idProduct,
            idExpansion: p.idExpansion,
            numeroCardmarket: d.numero || d.numeroUrl || null,
            certitudeNumero: d.certitude || 'exacte',
            variante: d.variante || null,
            codeSet: code,
            // estReverse=false : sans variantsDetailed on ne sait pas viser une reverse.
            // C'est une des raisons pour lesquelles ce chemin est toujours incertain.
            prix: prixDeReference(guides.get(Number(p.idProduct)), false),
            region: regionDuCodeSet(code, regionParExp.get(Number(p.idExpansion)) ?? null)
        };
    });

    const resultat = choisirMeilleur(enrichis, {
        numero: numeroLu, total, setCode: setCodeLu, rarete, rareteElevee,
        regionAttendue, idExpansionsAttendues: []
    });

    // Écart entre le 1er et le 2e : une égalité au sommet signifie que rien dans nos
    // données ne départage, et il faut le DIRE plutôt que de trancher au hasard. Mesuré
    // sur « Carabaffe 019/029 » : 3 candidats à 95 points, que seul le total 029
    // départagerait — total qu'on ne sait pas dériver (29,6 % de justes, écarté).
    const ecartScore = (resultat.scores.length > 1
        && Number.isFinite(resultat.scores[0]?.score) && Number.isFinite(resultat.scores[1]?.score))
        ? resultat.scores[0].score - resultat.scores[1].score
        : null;

    return {
        produits: retenus.map(n => n.p),
        scores: resultat.scores,
        gagnant: resultat.gagnant,
        voie: exactes.length ? 'local-nom-numero-exact' : 'local-nom-numero-chiffres',
        raison: parAnglais.length ? (parFrancais.length ? 'nom-anglais-et-francais' : 'nom-anglais') : 'nom-francais',
        ecartScore,
        egaliteAuSommet: ecartScore === 0,
        rangs: bilanDesRangs(enrichis, numeroLu, resultat.gagnant?.candidat),
        // TOUJOURS vrai : voir l'en-tête. Perdre variantsDetailed suffit à le justifier.
        incertain: true
    };
}

module.exports = { identifierEnLocal, normaliserNom };
