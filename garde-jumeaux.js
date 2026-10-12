// ============================================================================
// D2 — GARDE PROVISOIRE CONTRE LES FAUX PRIX DES « JUMEAUX » (chaîne héritée)
// ============================================================================
// LE DÉFAUT. IMG_3237 est une Roaring Moon ex qui imprime PRE 162. Le modèle a lu « PAR 251 » ; la
// clé code+numéro n'a trouvé qu'UN produit (740794) et la chaîne l'a affirmé : 29,84 € au lieu de
// 135,98 €. Les deux produits ont la même métacarte Cardmarket (426438) : la même carte de jeu,
// dans deux créneaux.
//
// LA RÈGLE (R1 de la v2, recopiée). Un JUMEAU de P est un AUTRE produit de même `idMetacard`,
// de même langue de tirage et d'un AUTRE créneau (expansion, ou numéro de fiche normalisé). Les
// variantes d'un même créneau (V1, V2, reverse) ne sont pas des jumeaux.
//
// 🔑 LA GARDE ÉCHOUE FERMÉ. Un champ inconnu ne retire jamais un voisin de la liste :
//   · langue de tirage inconnue (d'un côté ou de l'autre) -> « même langue » : le voisin reste candidat ;
//   · créneau inconnu (numéro d'un produit de la même expansion absent de `numeros_cartes`) -> « autre
//     créneau » : le voisin reste un jumeau. (Le brief dit « un champ inconnu compte comme même » :
//     appliqué au créneau, cela retirerait le voisin ; l'intention écrite — « le voisin reste un
//     jumeau » — gouverne.)
//   · toute recherche en échec (table, régions, numéros, métacarte absente) -> état `echec`, jamais
//     « aucun » : le §41 du dépôt, un vide ne se range pas en absence.
//
// CE QUE LA ROUTE EN FAIT (verdictApresGarde) :
//   aucun   -> rien ne change ;
//   jumeaux -> 1 ou 2 jumeaux (3 produits au plus) : réponse INCERTAINE, jumeaux parmi les candidats ;
//   trop    -> plus de 3 produits : REFUS remboursé (jamais 3 candidats choisis parmi N : la vérité
//              pourrait en être exclue) ;
//   echec   -> incertain avec le seul produit, la cause est journalisée.
//
// COÛT. Aucun index sur `idMetacard` (il a été retiré le 2026-08-30 : 3 Mo, jamais interrogé) et
// aucune création d'index ici (écriture en production). La table (idProduct, idExpansion, idMetacard)
// est donc chargée EN MÉMOIRE, en tableaux typés (16 octets par produit : ~1,2 Mo pour 74 000), puis
// relue après `ttlMs` (6 h par défaut : l'import du catalogue est quotidien). Les régions et les
// numéros se lisent par `$in` sur des clés indexées (codes_set.idExpansion, numeros_cartes.idProduct),
// et seulement pour les voisins de la métacarte du produit gagnant.
const { cleNumero } = require('./collecte-cartes/jointure');   // LA normalisation de numéro de la production

const PLAFOND_PRODUITS = 3;                   // produit gagnant compris
const TTL_MS = 6 * 3600 * 1000;
const REESSAI_MS = 30 * 1000;                 // après une panne de rechargement, pas plus d'une tentative par 30 s

const entierValide = x => Number.isInteger(x) && x > 0 && x <= 2147483647;

function borneInf(tab, cle, lo, hi) {
    while (lo < hi) { const m = (lo + hi) >>> 1; if (tab[m] < cle) lo = m + 1; else hi = m; }
    return lo;
}

function creerGardeJumeaux({ lireCatalogue, lireNumeros, lireRegions, maintenant = Date.now, ttlMs = TTL_MS, reessaiMs = REESSAI_MS, journal = console }) {
    let table = null;               // { ids, exps, metas, parId } triés par (metacarte, idProduct) ; parId = positions triées par idProduct
    let chargeeLe = 0;
    let derniereErreur = null;
    let enCours = null;
    let prochainEssai = 0;

    async function charger() {
        const ids = [], exps = [], metas = [];
        let vus = 0, avecMetacarte = 0;
        for await (const d of lireCatalogue()) {
            vus++;
            if (!entierValide(d?.idProduct)) continue;
            const m = entierValide(d.idMetacard) ? d.idMetacard : 0;
            if (m) avecMetacarte++;
            ids.push(d.idProduct); exps.push(entierValide(d.idExpansion) ? d.idExpansion : 0); metas.push(m);
        }
        // Le dénominateur d'abord : une table vide, ou sans une seule métacarte, n'est pas « aucun jumeau ».
        if (vus === 0 || ids.length === 0) throw new Error('catalogue vide : zéro produit lu');
        if (avecMetacarte === 0) throw new Error(`aucune ligne ne porte idMetacard (${vus} produits lus) : champ absent ou mal nommé`);
        const ordre = Array.from(ids.keys()).sort((a, b) => (metas[a] - metas[b]) || (ids[a] - ids[b]));
        const n = ordre.length;
        const T = { ids: new Int32Array(n), exps: new Int32Array(n), metas: new Int32Array(n), parId: new Int32Array(n) };
        for (let i = 0; i < n; i++) { const k = ordre[i]; T.ids[i] = ids[k]; T.exps[i] = exps[k]; T.metas[i] = metas[k]; }
        T.parId = Int32Array.from(Array.from({ length: n }, (_, i) => i).sort((a, b) => T.ids[a] - T.ids[b]));
        return T;
    }

    async function assurer() {
        const t = maintenant();
        if (table && t - chargeeLe < ttlMs) return;
        if (enCours) { await enCours; if (table && maintenant() - chargeeLe <= 4 * ttlMs) return; throw new Error(derniereErreur || 'table indisponible'); }
        if (t < prochainEssai) {
            // Un rechargement vient d'échouer : on ne martèle pas la base, on sert l'ancienne table tant qu'elle n'est pas périmée.
            if (table && t - chargeeLe <= 4 * ttlMs) return;
            throw new Error(derniereErreur || 'table indisponible');
        }
        enCours = (async () => {
            try {
                table = await charger();
                chargeeLe = maintenant();
                derniereErreur = null;
                prochainEssai = 0;
            } catch (e) {
                derniereErreur = String(e?.message ?? e).slice(0, 200);
                prochainEssai = maintenant() + reessaiMs;
                journal.error?.(`⚠️ [garde-jumeaux] chargement de la table en échec : ${derniereErreur}`);
            }
        })();
        try { await enCours; } finally { enCours = null; }
        if (!table) throw new Error(derniereErreur || 'table indisponible');
        // Table présente mais le rechargement vient d'échouer : l'ancienne sert tant qu'elle a moins de 4 TTL.
        if (maintenant() - chargeeLe > 4 * ttlMs) throw new Error(`table périmée (${Math.round((maintenant() - chargeeLe) / 3600000)} h) et rechargement en échec : ${derniereErreur}`);
    }

    async function chercher(idProduct) {
        const echec = cause => ({ etat: 'echec', jumeaux: [], nbProduits: null, cause: String(cause).slice(0, 200) });
        try {
            if (!entierValide(Number(idProduct))) return echec('idProduct absent ou invalide');
            try { await assurer(); } catch (e) { return echec(`table-indisponible : ${e.message}`); }
            const T = table;
            const id = Number(idProduct);
            // position du produit : recherche binaire sur parId
            let lo = 0, hi = T.parId.length;
            while (lo < hi) { const m = (lo + hi) >>> 1; if (T.ids[T.parId[m]] < id) lo = m + 1; else hi = m; }
            if (lo >= T.parId.length || T.ids[T.parId[lo]] !== id) return echec(`produit ${id} absent de la table`);
            const pos = T.parId[lo];
            const meta = T.metas[pos];
            if (!meta) return echec(`produit ${id} sans metacarte (idMetacard absent ou nul)`);
            const debut = borneInf(T.metas, meta, 0, T.metas.length), fin = borneInf(T.metas, meta + 1, debut, T.metas.length);
            const voisins = [];
            for (let i = debut; i < fin; i++) if (i !== pos) voisins.push({ idProduct: T.ids[i], idExpansion: T.exps[i] });
            if (voisins.length === 0) return { etat: 'aucun', jumeaux: [], nbProduits: 1, voisins: 0, cause: null };

            const expP = T.exps[pos];
            const regions = await lireRegions([expP, ...voisins.map(v => v.idExpansion)].filter(Boolean));
            const regionP = regions.get(expP) ?? null;
            // 1. la langue de tirage : seule une région CONNUE des deux côtés et DIFFÉRENTE écarte un voisin
            const memeLangue = voisins.filter(v => { const r = regions.get(v.idExpansion) ?? null; return !(regionP && r && r !== regionP); });
            // 2. le créneau : une AUTRE expansion connue suffit ; sinon (même expansion, ou expansion inconnue) le numéro tranche
            const jumeaux = [];
            const aVerifier = [];
            for (const v of memeLangue) {
                if (expP && v.idExpansion && v.idExpansion !== expP) jumeaux.push(v.idProduct);
                else aVerifier.push(v.idProduct);
            }
            if (aVerifier.length) {
                const numeros = await lireNumeros([id, ...aVerifier]);
                const cleDe = n => { const brut = n?.numero ?? n?.numeroUrl ?? null; return brut == null || String(brut).trim() === '' ? null : cleNumero(brut); };
                const clePropre = cleDe(numeros.get(id));
                for (const w of aVerifier) {
                    const cw = cleDe(numeros.get(w));
                    // même créneau seulement si les DEUX numéros sont connus et égaux ET l'expansion est la même et connue
                    const memeCreneau = expP && clePropre != null && cw != null && clePropre === cw
                        && voisins.find(v => v.idProduct === w).idExpansion === expP;
                    if (!memeCreneau) jumeaux.push(w);
                }
            }
            jumeaux.sort((a, b) => a - b);
            const nbProduits = 1 + jumeaux.length;
            if (jumeaux.length === 0) return { etat: 'aucun', jumeaux: [], nbProduits: 1, voisins: voisins.length, cause: null };
            if (nbProduits > PLAFOND_PRODUITS) return { etat: 'trop', jumeaux: [], nbProduits, voisins: voisins.length, cause: null };
            return { etat: 'jumeaux', jumeaux, nbProduits, voisins: voisins.length, cause: null };
        } catch (e) {
            return echec(`recherche en échec : ${e?.message ?? e}`);
        }
    }

    function etatTable() {
        return {
            lignes: table ? table.ids.length : 0,
            octets: table ? table.ids.byteLength + table.exps.byteLength + table.metas.byteLength + table.parId.byteLength : 0,
            chargeeLe: table ? chargeeLe : null,
            derniereErreur
        };
    }

    return { chercher, etatTable };
}

// Ce que la route fait d'un résultat. Écrit par ce qu'il AUTORISE : seul `aucun` (et `non-jouee`,
// quand la réponse était déjà sous réserve) laisse passer ; tout état inconnu ou absent -> réserve.
function verdictApresGarde(r) {
    const etat = r?.etat;
    if (etat === 'aucun') return { incertain: false, refus: false, candidatsExtra: [], raison: null, motifRefus: null, issue: 'aucun' };
    if (etat === 'non-jouee') return { incertain: false, refus: false, candidatsExtra: [], raison: null, motifRefus: null, issue: 'non-jouee' };
    if (etat === 'jumeaux' && Array.isArray(r.jumeaux) && r.jumeaux.length >= 1 && r.jumeaux.length <= PLAFOND_PRODUITS - 1) {
        return { incertain: true, refus: false, candidatsExtra: r.jumeaux.slice(), raison: 'jumeaux-garde', motifRefus: null, issue: 'jumeaux' };
    }
    if (etat === 'trop') return { incertain: false, refus: true, candidatsExtra: [], raison: null, motifRefus: 'jumeaux-trop-nombreux', issue: 'trop' };
    return { incertain: true, refus: false, candidatsExtra: [], raison: 'jumeaux-recherche-echec', motifRefus: null, issue: 'echec' };
}

// Les candidats à montrer. Hors garde : le top-3 du classement sous réserve, le gagnant seul sinon (comportement d'avant). Sous
// réserve PAR LA GARDE : le gagnant puis ses jumeaux — le top-3 peut ne pas les contenir (IMG_3237 : un vivier d'un seul candidat),
// et ne montre JAMAIS d'autres candidats du classement (3 produits au plus en tout). Recherche en échec : le seul produit. Un jumeau est
// hors vivier : son nom et son prix guide se lisent à part ; une lecture qui échoue laisse `null`, jamais un prix inventé.
async function tetesDesCandidats({ decision, classement, carteAmbigue, lireNoms, lirePrix, journal = console }) {
    const noms = new Map();
    if (decision.issue === 'jumeaux') {
        const tetes = [classement[0]].filter(Boolean);
        try { for (const [id, nom] of await lireNoms(decision.candidatsExtra)) noms.set(Number(id), nom); }
        catch (e) { journal.error?.(`🪞 [garde-jumeaux] noms des jumeaux illisibles : ${e.message}`); }
        for (const id of decision.candidatsExtra) {
            const dejaClasse = classement.find(c => c && c.idProduct === id);
            let prix = Number.isFinite(dejaClasse?.prix) ? dejaClasse.prix : null;
            if (prix == null) { try { prix = await lirePrix(id); } catch (e) { prix = null; } }
            tetes.push({ idProduct: id, prix: Number.isFinite(prix) ? prix : null, idExpansion: dejaClasse?.idExpansion ?? null });
        }
        return { tetes, noms };
    }
    if (decision.issue === 'echec') return { tetes: [classement[0]].filter(Boolean), noms };
    return { tetes: classement.slice(0, carteAmbigue ? 3 : 1).filter(Boolean), noms };
}

// Les trois accès de la production : mêmes collections, mêmes champs que index.js. Ils LÈVENT en cas de
// panne (contrairement à lireNumeros/lireRegions de la route, qui rendent une Map vide — un vide
// plausible que la garde ne doit pas lire comme « aucune région »).
function accesMongoose({ CatalogueProduit, NumeroCarte, CodeSet, mongoose }) {
    const pret = () => { if (mongoose.connection.readyState !== 1) throw new Error('Mongo non connecté'); };
    return {
        lireCatalogue: () => { pret(); return CatalogueProduit.find({}, { idProduct: 1, idExpansion: 1, idMetacard: 1, _id: 0 }).lean().cursor({ batchSize: 5000 }); },
        lireNoms: async ids => {
            pret();
            const docs = await CatalogueProduit.find({ idProduct: { $in: ids } }, { idProduct: 1, name: 1, _id: 0 }).lean();
            return new Map(docs.map(d => [Number(d.idProduct), d.name]));
        },
        lireNumeros: async ids => {
            pret();
            const docs = await NumeroCarte.find({ idProduct: { $in: ids } }, { idProduct: 1, numero: 1, numeroUrl: 1, _id: 0 }).lean();
            return new Map(docs.map(d => [Number(d.idProduct), d]));
        },
        lireRegions: async exps => {
            pret();
            const uniques = [...new Set(exps.filter(Boolean).map(Number))];
            if (uniques.length === 0) return new Map();
            const docs = await CodeSet.find({ idExpansion: { $in: uniques } }, { idExpansion: 1, region: 1, _id: 0 }).lean();
            return new Map(docs.filter(d => d.region).map(d => [Number(d.idExpansion), d.region]));
        }
    };
}

module.exports = { creerGardeJumeaux, verdictApresGarde, tetesDesCandidats, accesMongoose, PLAFOND_PRODUITS, TTL_MS };
