// ============================================================
// LA SOURCE UNIQUE : à quel seau appartient une ligne, et sous quelle clé
// ============================================================
// POURQUOI CE MODULE EXISTE — troisième occurrence du DEUXIÈME PRINCIPE en une semaine.
//
// `banc-japonais.js` et `saisir-verites.js` avaient CHACUN leur copie de `seauDe`. J'ai
// ajouté le quatrième seau (les fenêtres de lot) dans le premier et pas dans le second.
// Résultat mesuré : l'outil de saisie a classé 25 cartes en « holdout » et les a numérotées
// H009..H033, pendant que le banc les classait en « lot » et les numérotait L001..L025.
// 32 vérités saisies une par une, à l'aveugle, sur des URL Cardmarket — ZÉRO lue par le
// banc. Les 25 clés différaient, toutes.
// Et une seconde divergence par-dessus : l'outil de saisie n'excluait pas les lignes HORS
// SERVICE, donc 8 vérités ont été saisies sur des lignes que le banc n'ouvre jamais.
//
//   ⚠️ DEUX DÉFINITIONS DE LA MÊME RÈGLE DANS DEUX FICHIERS DIVERGENT TOUJOURS.
//   Pas « peuvent » : divergent. C'était `LANGUES_ASIATIQUES` défini deux fois, puis
//   l'objet `scoring` fabriqué à la main avec trois fonctions sur quatre, puis ceci.
//   Le correctif n'est jamais de synchroniser les copies — c'est d'en supprimer une.
//
// CE MODULE EST DONC LE SEUL ENDROIT où l'on décide : la frontière d'entraînement, les
// cartes de vérification, les fenêtres de lot, les builds hors service, l'ordre des seaux,
// le dédoublonnage et la numérotation. Tout outil qui a besoin d'une clé de banc l'obtient
// ICI ou nulle part.
//
// ⚠️ LA NUMÉROTATION EST GLOBALE, JAMAIS RELATIVE À UN FILTRE. C'est la propriété qui
// rendait la divergence possible : l'ancien outil de saisie filtrait D'ABORD sur un seau,
// puis numérotait 1..N dans ce sous-ensemble. La même carte changeait donc de clé selon ce
// qu'on avait demandé. Ici, `numeroter()` numérote TOUT le corpus, et le filtre s'applique
// APRÈS. Une clé est une propriété de la ligne, pas de la question posée.

const DATE_HOLDOUT = new Date('2026-08-03T00:00:00Z');

// ── Les fenêtres hors service ────────────────────────────────────────────────
// Le critère complet (échec total attribuable à un défaut nommé, fenêtre énumérée en dur,
// lignes visibles et comptées, exclusion de la fenêtre ENTIÈRE succès compris) est écrit
// dans banc-japonais.js, qui reste le lieu de la doctrine. Ici, seulement la liste.
const FENETRES_HORS_SERVICE = [
    {
        versions: ['fe9f77df0f8f', '746eedf203e5', 'd6c340b39ae7'],
        defaut: 'nomExact reprenait le nom TCGdex dans la langue de la route ; le catalogue anglais était interrogé en japonais',
        corrigePar: '83789c2'
    }
];
const VERSIONS_HORS_SERVICE = new Set(FENETRES_HORS_SERVICE.flatMap(f => f.versions));
const estHorsService = d => d.version != null && VERSIONS_HORS_SERVICE.has(String(d.version));

// ── Les cartes déclarées en vérification (par carte) ─────────────────────────
let VERIFICATION = [];
try {
    VERIFICATION = (require('./banc-verification.json').cartes || [])
        .map(c => ({ ...c, declareLe: new Date(c.declareLe) }));
} catch (_) { /* fichier absent : aucun scan de vérification */ }

function estVerification(d) {
    if (!(d.le instanceof Date)) return null;
    for (const c of VERIFICATION) {
        if (String(d.nom || '').trim() !== String(c.nom).trim()) continue;
        if (String(d.numero ?? '').trim() !== String(c.numero).trim()) continue;
        // La clause qui rend la frontière infalsifiable : déclarée AVANT le scan.
        if (!(d.le >= c.declareLe)) continue;
        return c;
    }
    return null;
}

// ── Les fenêtres de lot (par période) ────────────────────────────────────────
let FENETRES_LOTS = [];
try {
    FENETRES_LOTS = (require('./banc-lots.json').fenetres || []).map(f => ({
        ...f, debut: new Date(f.debut), fin: f.fin ? new Date(f.fin) : null
    }));
} catch (_) { /* fichier absent : aucune fenêtre */ }

/** La fenêtre qui contient ce scan, ou null. Bornes : [debut, fin[ — fin exclusive. */
function fenetreDe(d) {
    if (!(d.le instanceof Date)) return null;
    for (const f of FENETRES_LOTS) {
        if (!(f.debut instanceof Date) || isNaN(f.debut)) continue;
        if (d.le < f.debut) continue;
        if (f.fin && d.le >= f.fin) continue;
        return f;
    }
    return null;
}

// ── L'ORDRE DES SEAUX, du plus SPÉCIFIQUE au plus général ────────────────────
// La déclaration par carte l'emporte sur la fenêtre, qui l'emporte sur le holdout.
// Chacune ne peut que RETIRER du holdout, jamais y ajouter — et rien ne peut atteindre
// l'entraînement, qui est verrouillé par la date.
function seauDe(d) {
    if (!(d.le instanceof Date) || d.le < DATE_HOLDOUT) return 'entrainement';
    if (estVerification(d)) return 'verification';
    if (fenetreDe(d)) return 'lot';
    return 'holdout';
}

const PREFIXE = { entrainement: 'JP', holdout: 'H', verification: 'V', lot: 'L' };

/**
 * Numérote TOUT le corpus, une fois pour toutes.
 *
 * ⚠️ L'EXCLUSION DES LIGNES HORS SERVICE SE FAIT **AVANT** LE DÉDOUBLONNAGE, et c'est le
 * point qui compte : le dédoublonnage garde la PREMIÈRE ligne vue. Une ligne cassée laissée
 * dans le lot masquerait sa remplaçante — la carte rescannée après correction n'apparaîtrait
 * jamais. Une ligne hors service ne doit ni compter, NI MASQUER SA REMPLAÇANTE.
 *
 * @param {object[]} docs   les lignes de journal, `le` déjà converti en Date
 * @returns {{lignes: {cle,d,seau}[], horsService: object[]}}
 */
function numeroter(docs) {
    const horsService = docs.filter(estHorsService);
    const exploitables = docs.filter(d => !estHorsService(d));

    const vues = new Map();
    for (const d of exploitables) {
        const seau = seauDe(d);
        // ⚠️ LA CLÉ DE DÉDOUBLONNAGE PORTE LE SEAU. Deux scans identiques de part et d'autre
        // d'une frontière sont deux lignes distinctes, et c'est voulu : l'un a servi à
        // dériver un correctif, l'autre le mesure.
        const k = `${seau}|${d.nom ?? ''}|${d.numero ?? ''}|${d.setCode ?? ''}|${d.total ?? ''}`;
        if (!vues.has(k)) vues.set(k, d);
    }

    const compteurs = { entrainement: 0, holdout: 0, verification: 0, lot: 0 };
    const lignes = [...vues.values()].map(d => {
        const s = seauDe(d);
        return { cle: `${PREFIXE[s]}${String(++compteurs[s]).padStart(3, '0')}`, d, seau: s };
    });
    return { lignes, horsService };
}

// ════════════════════════════════════════════════════════════════════════════
// L'IDENTITÉ D'UNE CARTE SCANNÉE — ce à quoi une vérité doit être ACCROCHÉE
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ UNE CLÉ POSITIONNELLE (« L007 ») EST UNE MAUVAISE ANCRE, et c'est la cause profonde
// de l'incident : elle dépend du seau, de l'ordre, du dédoublonnage et du nombre de lignes
// qui précèdent. Changer la règle des seaux — ce qu'on a fait en ajoutant les fenêtres de
// lot — renumérote TOUT et détache silencieusement les vérités déjà saisies.
// L'identité, elle, ne bouge pas : c'est ce que l'IA a lu sur CETTE carte. `saisir-verites`
// l'enregistre déjà, sous le champ `lu`. On s'y accroche, et la clé redevient ce qu'elle
// aurait toujours dû être : une ÉTIQUETTE D'AFFICHAGE.
const identite = (nom, numero, setCode, total) =>
    `${nom ?? ''}|${numero ?? ''}|${setCode ?? ''}|${total ?? ''}`;
const identiteDe = d => identite(d.nom, d.numero, d.setCode, d.total);
const identiteDeVerite = v => v && v.lu ? identite(v.lu.nom, v.lu.numero, v.lu.setCode, v.lu.total) : null;

/**
 * Rattache les vérités saisies aux lignes numérotées, PAR IDENTITÉ.
 *
 * LE CONTRÔLE QUE DEMANDAIT L'INCIDENT : une vérité dont la clé enregistrée ne correspond
 * plus à la clé actuelle de sa ligne est un DÉSACCORD. C'est exactement ce qui venait de
 * se produire — 32 vérités saisies sous H009..H033, 25 lignes numérotées L001..L025, aucune
 * rattachée, et rien pour le dire. Le rattachement, lui, marche quand même : c'est
 * l'intérêt d'une ancre stable. Mais le désaccord est SIGNALÉ, parce qu'il veut dire que la
 * règle des seaux a bougé depuis la saisie.
 *
 * @param {{cle,d,seau}[]} lignes
 * @param {object} verites   le contenu de banc-verites.json (champ `verites`)
 * @returns {{parIdentite: Map, desaccords: object[], orphelines: object[], rattachees: number}}
 */
function rattacherVerites(lignes, verites) {
    const parIdentite = new Map();
    const desaccords = [], orphelines = [];
    const lignesParIdentite = new Map(lignes.map(l => [identiteDe(l.d), l]));

    for (const [cleEnregistree, v] of Object.entries(verites || {})) {
        const ident = identiteDeVerite(v);
        if (!ident) {
            // Vérité antérieure au champ `lu` : elle ne peut être rattachée que par sa clé,
            // ce qui la rend fragile. On la garde, on le dit.
            const parCle = lignes.find(l => l.cle === cleEnregistree);
            if (parCle) parIdentite.set(identiteDe(parCle.d), v);
            else orphelines.push({ cle: cleEnregistree, raison: 'sans champ `lu`, et sa clé ne désigne aucune ligne' });
            continue;
        }
        const ligne = lignesParIdentite.get(ident);
        if (!ligne) {
            orphelines.push({ cle: cleEnregistree, raison: `aucune ligne ne porte l'identité « ${ident} »`, lu: v.lu });
            continue;
        }
        if (ligne.cle !== cleEnregistree) {
            desaccords.push({ enregistree: cleEnregistree, actuelle: ligne.cle, seau: ligne.seau, lu: v.lu });
        }
        parIdentite.set(ident, v);
    }
    return { parIdentite, desaccords, orphelines, rattachees: parIdentite.size };
}

module.exports = {
    DATE_HOLDOUT, PREFIXE,
    FENETRES_HORS_SERVICE, estHorsService,
    VERIFICATION, estVerification,
    FENETRES_LOTS, fenetreDe,
    seauDe, numeroter,
    identiteDe, identiteDeVerite, rattacherVerites
};
