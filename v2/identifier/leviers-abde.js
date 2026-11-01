'use strict';
// LEVIERS-ABDE (ordre n°17, 01/11/2026) — quatre leviers de la reconnaissance, derrière UN drapeau réservé à l'essai (V2_LEVIERS_ABDE, éteint par défaut). Définition exacte : serie-P-verifications.md §8 (mesure hors ligne) et §9 (le tri du pool par c3).
//   a : un POOL de 10 = choix d'avant + 10 du vivier de la lecture non contredits (sur 80 lus) + produits des 10 visuels les plus proches de la photo (index entier), trié par le score c3 AVANT la coupe à 10 (§9, retenu) ;
//   b : l'ADMISSION du probable = le meilleur du classement c3, si son écart au deuxième est >= V2_LEVIERS_ECART (0,1) ET si aucun champ lu ne le contredit (ko = 0). Remplace θ 0,38 / « vecteur exigé » / « tous les autres contredits » ;
//   d : les ALIAS français (nomFr normalisé = le nom lu) entrent au pool ;
//   e : « jumeaux-trop-nombreux » devient une question aux 3 premiers (identifier/adaptateur.js, jeu `jumeauxEnQuestion`).
// c3 = cosinus photo-visuel + 0,05 x (champs lus qui concordent) - 0,25 x (champs lus qui contredisent) ; les poids sont posés a priori (§8.5), non ajustés.
//
// 🔑 CE QUE CE MODULE NE FAIT JAMAIS (invariants de l'ordre) :
//   · changer un SÛR : il ne lit qu'une QUESTION (issue 'question', statut 'a-trancher') ; un sûr, un introuvable, une panne, un lot, une question de GROUPE (marqueurs) passent sans que rien ne bouge ;
//   · fabriquer un sûr : il rend une question (les 3 premiers du classement) et, au plus, un désigné « probable » ; le niveau `probable` porte toujours `aConfirmer: true`, le prix du désigné et sa fiabilité (avecNiveau) ;
//   · désigner un candidat dans un GROUPE de même dessin (I3, comme PROBABLE) ou sans prix de guide (I2) : la question reste, sans probable ;
//   · lever : toute exception, toute donnée illisible rend `null` (la question d'avant), jamais une panne.
// Écrit par ce qu'il AUTORISE : un seul chemin mène à un changement (drapeau + probable allumés + extension >= 2.0.1 + question + vecteur redressé et admis + au moins 2 candidats classables + lignes de catalogue des 3 premiers) ;
// tout le reste rend null et DIT pourquoi (`diag.raison`).
const GC = require('./garde-contradiction');
const P = require('./probable');
const PR = require('./prix-repli');
const { preparerVecteur } = require('./voisins-empreinte');
const { cosinusDesCandidats, dansUnGroupe, estGroupe } = require('./probable-route');
const { questionParLaRoute } = require('./adaptateur');

const POIDS_OK = 0.05, POIDS_KO = 0.25;            // les poids de c3 (a priori, §8.1)
const TAILLE_POOL = 10, VIVIER_LU = 80, VIVIER_RETENU = 10, VOISINS = 10, ALIAS_LONGUEUR_MIN = 4;
const TOLERANCE = 1e-12;                           // « écart >= s » à l'arrondi flottant près (0,5 - 0,4 vaut 0,09999999999999998)
const ALIAS_MAX = 20;                              // au plus 20 produits par nom lu : un nom porté par des centaines de produits (Pikachu, Dracaufeu, énergies) n'envoie pas des centaines de lignes à lire ; ce qui est coupé est ÉCRIT (journal, diag.aliasCoupes)
const NOM_LU_MAX = 120;                            // le nom lu est borné AVANT d'être normalisé (NFKD sur une chaîne sans borne = CPU offert à l'entrée)
// Le signal journalisé d'un probable reste celui de la lecture + image, `A` (les outils qui trient par A / G le voient) ; le levier qui l'a désigné est dit à part (`levier: 'abde'`, routes.js l'écrit dans analyses).
const SIGNAL = 'A', LEVIER = 'abde';

// ── Échouer FERMÉ ET DIRE : chaque échec du levier (jamais un simple « non applicable ») est compté et journalisé, au plus UNE ligne par cause et par minute, sans jamais écrire le message d'une exception.
const ECHECS = Object.create(null), DERNIER_ECHEC = Object.create(null);
function signaler(cause, detail = '') {
    ECHECS[cause] = (ECHECS[cause] || 0) + 1;
    const t = Date.now();
    if (!(cause in DERNIER_ECHEC) || t - DERNIER_ECHEC[cause] >= 60000) { DERNIER_ECHEC[cause] = t; try { console.warn(`⚠️ [leviers-abde] ${cause}${detail ? ` ${detail}` : ''} (${ECHECS[cause]} depuis le démarrage)`); } catch { /* journal muet */ } }
}
/** Les compteurs d'échecs du levier depuis le démarrage : { cause: nombre }. */
const echecs = () => ({ ...ECHECS });

/** Le score c3 d'un candidat { cos, ok, ko } ; null si son cosinus est inconnu (un candidat sans visuel comparable n'est jamais classé). */
const scoreC3 = c => (c && Number.isFinite(c.cos) ? c.cos + POIDS_OK * (c.ok || 0) - POIDS_KO * (c.ko || 0) : null);
const cosOuBas = c => (c && Number.isFinite(c.cos) ? c.cos : -9);
const c3OuBas = c => (scoreC3(c) === null ? -9 : scoreC3(c));
// Les deux tris du pool, à égalité : le moins contredit, puis le plus concordant ; l'ordre d'insertion est gardé (tri stable) ; un cosinus inconnu est classé après tout cosinus connu.
const parCosinus = (a, b) => (cosOuBas(b) - cosOuBas(a)) || (a.ko - b.ko) || (b.ok - a.ok);
const parC3 = (a, b) => (c3OuBas(b) - c3OuBas(a)) || (a.ko - b.ko) || (b.ok - a.ok);

/** Le pool classé et coupé à TAILLE_POOL. `tri` : 'c3' (retenu, §9) ou 'cosinus' (le point validé d'avant, gardé pour les bancs). */
function classerPool(candidats, tri = 'c3') {
    return [...(Array.isArray(candidats) ? candidats : [])].sort(tri === 'cosinus' ? parCosinus : parC3).slice(0, TAILLE_POOL);
}

/**
 * L'admission (b) et la question (a) sur un pool déjà classé et coupé. @returns { kind: 'rien' } (moins de 2 candidats) | { kind: 'q', top3 } | { kind: 'prob', id, gap, second, top3 }.
 * Le classement de la décision est TOUJOURS le score c3 (seuls les candidats au cosinus connu sont classés) ; le premier n'est désigné que s'il n'est contredit par aucun champ lu.
 */
function decider(pool, ecart) {
    if (!Array.isArray(pool) || pool.length < 2) return { kind: 'rien' };
    const rang = pool.filter(c => scoreC3(c) !== null).sort((a, b) => scoreC3(b) - scoreC3(a));
    const top3 = rang.slice(0, 3).map(c => c.id);
    if (rang.length < 2) return { kind: 'q', top3 };
    const premier = rang[0], second = rang[1], gap = scoreC3(premier) - scoreC3(second);
    if (premier.ko === 0 && gap >= ecart - TOLERANCE) return { kind: 'prob', id: premier.id, gap, second: second.id, top3 };
    return { kind: 'q', top3, gapRefus: gap };
}

/**
 * La composition du pool, dans l'ordre exact du §8 : les choix d'avant, les 10 premiers produits non contredits des 80 premiers du vivier, les produits des visuels voisins (dans l'ordre des voisins), puis les alias.
 * @param ko  (idProduct) => nombre de champs lus qui CONTREDISENT le produit (0 si sa ligne est inconnue : un produit sans ligne ne contredit rien)
 */
function composerPool({ baseIds, vivier, ko, produitsDesVoisins, alias, existe = () => true } = {}) {
    // `existe(id)` : le produit a une ligne de catalogue. Un produit SANS ligne ne se sert à personne (la panne SERVEUR de l'adaptateur) : il n'occupe aucun des 10 créneaux du vivier ni du pool (tour 1, R1-M4 ; le simulateur fait de même).
    const T = new Set((Array.isArray(baseIds) ? baseIds : []).filter(i => Number.isInteger(i) && existe(i)));
    const viv = (Array.isArray(vivier) ? vivier : []).slice(0, VIVIER_LU).filter(Number.isInteger);
    for (const id of viv.filter(i => existe(i) && ko(i) === 0).slice(0, VIVIER_RETENU)) T.add(id);
    for (const liste of (Array.isArray(produitsDesVoisins) ? produitsDesVoisins : [])) for (const id of (Array.isArray(liste) ? liste : [])) if (Number.isInteger(id) && existe(id)) T.add(id);
    for (const id of (Array.isArray(alias) ? alias : [])) if (Number.isInteger(id) && existe(id)) T.add(id);
    return [...T];
}

// ── d : l'alias français. La normalisation est celle de la MESURE (scratchpad combi-bloc.js::norm) : NFKD, marques retirées, minuscules, tout ce qui n'est ni lettre latine, ni chiffre, ni kana, ni idéogramme devient un blanc.
const normaliserAlias = s => String(s || '').slice(0, NOM_LU_MAX).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ').trim();
/** La clé d'alias d'un nom : sa forme normalisée, si elle compte au moins ALIAS_LONGUEUR_MIN caractères ; null sinon (un nom trop court désigne trop de produits). */
function cleAlias(nom) { const k = normaliserAlias(nom); return k.length >= ALIAS_LONGUEUR_MIN ? k : null; }
/** Les produits dont le nomFr normalisé est l'une des formes lues (nom, nom brut) ; `index` : Map<clé, idProduct[]> (catalogue.indexAliasFr). Sans index : []. */
function aliasDe(index, formes, coupes = null) {
    if (!(index instanceof Map)) return [];
    const sortie = [];
    for (const f of (Array.isArray(formes) ? formes : [])) {
        const k = cleAlias(f); if (!k || !index.has(k)) continue;
        const ids = index.get(k);
        if (ids.length > ALIAS_MAX && Array.isArray(coupes)) coupes.push({ cle: k, total: ids.length, gardes: ALIAS_MAX });          // ce qui est coupé est ÉCRIT
        for (const id of ids.slice(0, ALIAS_MAX)) if (!sortie.includes(id)) sortie.push(id);
    }
    return sortie;
}
/** Ajoute une ligne { idProduct, nomFr } à l'index d'alias Map<clé normalisée (>= 4 caractères), idProduct[]> (les lignes sans nom français ou à nom trop court n'y entrent pas). */
function ajouterAlias(index, d) {
    const k = d && Number.isInteger(d.idProduct) ? cleAlias(d.nomFr) : null;
    if (k) { if (!index.has(k)) index.set(k, []); index.get(k).push(d.idProduct); }
}
/** L'index d'alias depuis des lignes { idProduct, nomFr }. Pure. */
function construireIndexAlias(lignes) {
    const index = new Map();
    for (const d of lignes) ajouterAlias(index, d);
    return index;
}

// ── a : les produits de chaque visuel de l'archive (clé de l'image -> idProduct[]), construits UNE fois par version (la version en mémoire est gelée, un rechargement en fait une autre)
const PAR_CLE = new WeakMap();
function produitsParCle(version) {
    if (!version || typeof version.identifiants !== 'function' || typeof version.entree !== 'function') return new Map();
    let m = PAR_CLE.get(version);
    if (m) return m;
    m = new Map();
    for (const id of version.identifiants()) { const e = version.entree(id), c = e && e.grande && e.grande.cle; if (typeof c !== 'string' || !c) continue; if (!m.has(c)) m.set(c, []); m.get(c).push(id); }
    PAR_CLE.set(version, m);
    return m;
}

const meme = (a, b) => a.length === b.length && a.every(x => b.includes(x));

/**
 * L'ÉTAPE de la route, à la place de consulterProbable quand V2_LEVIERS_ABDE est allumé : même point (après les marqueurs), mêmes entrées, plus le catalogue (lignes du pool, index d'alias) et le contexte de l'adaptateur (la question).
 * @param catalogue      { lire(ids) -> Map, indexAliasFr?() -> Promise<Map> } ; un catalogue sans indexAliasFr : le levier d est inerte (dit dans diag.alias)
 * @param ctxQuestion    le contexte de l'adaptateur SANS `produits` (langueInterface, cfg, ficheServie, jumeaux, …) : la question est construite par la même fonction que toute question
 * @returns null (rien ne change : la question d'avant, sans probable) | { resultat: la question aux 3 premiers du classement, ou null si c'est la même, probable: { idProduct, signal, contredits, detail } | null }
 */
async function appliquerLeviers({ cfg, entree, resultat, corpsChaine, produits, version, traceMarqueurs = null, catalogue, ctxQuestion = {}, etat = require('./etat-empreintes'), memo = false, diag = null } = {}) {
    // `note` dit pourquoi le levier ne change rien (diag, pour les bancs) ; `echec` est un ÉCHEC du levier (une panne, une donnée absente) : compté et journalisé en production, au plus une ligne par cause et par minute.
    const note = r => { if (diag) diag.raison = r; return null; };
    const echec = (r, detail) => { signaler(r, detail); return note(r); };
    try {
        if (!(cfg && cfg.leviersAbde === true && cfg.probable === true) || !entree || !P.versionAuMoins(entree.versionExtension, cfg.versionMinProbable)) return note('inactif');
        if (!resultat || resultat.issue !== 'question') return note('pas-une-question');
        // les exclusions de probable-route.js::consulterProbable (:91) : une question qui porte un motif de refus ou une contradiction n'est jamais travaillée ; la question d'avant reste
        if (resultat.motif || resultat.contradiction) return note('motif-ou-contradiction');
        const cartes = resultat.analyse && Array.isArray(resultat.analyse.cartes) ? resultat.analyse.cartes : null;
        if (!cartes || cartes.length !== 1 || cartes[0].statut !== 'a-trancher' || !Array.isArray(cartes[0].candidats)) return note('pas-une-question');
        const baseIds = cartes[0].candidats.map(x => x && x.idProduct);
        if (baseIds.length < 1 || baseIds.length > 3 || !baseIds.every(Number.isInteger)) return note('candidats');
        const lu = GC.lectureDe(corpsChaine);
        if (!lu || !(produits instanceof Map)) return note('sans-lecture');
        if (estGroupe(traceMarqueurs)) return note('groupe-marqueurs');          // une question de GROUPE (même dessin, marqueur différent) ne se tranche jamais par l'image : intacte
        if (!(cfg.empreinteExtension === true && entree.empreintes && version && typeof version.entree === 'function')) return note('sans-vecteur');
        const voulu = cfg.modeleEmpreinte && cfg.modeleEmpreinte.id && cfg.modeleEmpreinte.sha256 ? { id: cfg.modeleEmpreinte.id, sha256: cfg.modeleEmpreinte.sha256 } : null;
        const p = preparerVecteur({ entree, voulu, etat, memo: true });
        if (!p.ok) return note(`vecteur-${p.code}`);
        if (p.e0.redressee !== true) return note('non-redressee');
        const parCle = produitsParCle(version);
        const produitsDesVoisins = p.trouve.top.slice(0, VOISINS).map(l => parCle.get(l[0]) || []);
        const carte = corpsChaine && corpsChaine.success === true && corpsChaine.carte && typeof corpsChaine.carte === 'object' ? corpsChaine.carte : {};
        // ÉCHOUER FERME : l'index d'alias (d) absent, pas encore prêt ou en panne = AUCUN probable sur cette ligne, la question d'avant reste. Jamais un repli vide : un pool sans ses alias fabrique une marge qui n'existe pas.
        // L'index est lu SANS ATTENTE (préchauffé au démarrage et rafraîchi en arrière-plan par le catalogue) : un scan ne le construit jamais.
        if (!catalogue || typeof catalogue.indexAliasFrSansAttente !== 'function') return echec('alias-absent');
        let indexAlias;
        try { indexAlias = catalogue.indexAliasFrSansAttente(); } catch { return echec('alias-indisponible'); }
        if (!(indexAlias instanceof Map)) return echec('alias-non-pret');
        const coupes = [];
        const alias = aliasDe(indexAlias, [carte.name ?? carte.nom, carte.nomBrut], coupes);
        if (coupes.length) { signaler('alias-tronque', JSON.stringify(coupes)); if (diag) diag.aliasCoupes = coupes; }
        // les lignes de catalogue du pool : celles que la route a déjà lues, plus le reste (une seule lecture) ; une lecture qui échoue laisse la question d'avant
        const lignes = new Map(produits);
        const visés = [...new Set([...baseIds, ...lu.vivierIds.slice(0, VIVIER_LU), ...produitsDesVoisins.flat(), ...alias])];
        const manquants = visés.filter(id => !lignes.has(id));
        if (manquants.length) {
            if (typeof catalogue.lire !== 'function') return echec('sans-catalogue');
            let lues; try { lues = await catalogue.lire(manquants); } catch { return echec('catalogue-en-panne'); }
            if (lues instanceof Map) for (const [id, l] of lues) lignes.set(id, l);
        }
        const statutDe = id => { const l = lignes.get(id), st = l ? GC.statuts(lu, l) : null; let ok = 0, ko = 0; if (st) for (const k of GC.VETOS) { if (st[k] === 'ok') ok++; else if (st[k] === 'ko') ko++; } return { ok, ko }; };
        const T = composerPool({ baseIds, vivier: lu.vivierIds, ko: id => statutDe(id).ko, produitsDesVoisins, alias, existe: id => lignes.has(id) });
        const cosDe = cosinusDesCandidats({ cfg, entree, ids: T, version, etat, memo: true });
        if (!cosDe) return echec('sans-cosinus');
        const candidats = T.map(id => { const s = statutDe(id), c = cosDe(id); return { id, ok: s.ok, ko: s.ko, cos: Number.isFinite(c) ? c : null }; });
        const pool = classerPool(candidats, 'c3');
        const d = decider(pool, cfg.leviersEcart);
        if (diag) { diag.decision = { kind: d.kind, id: d.id ?? null, top3: d.top3 || [] }; diag.base = baseIds; diag.pool = pool.map(c => c.id); diag.candidats = pool; diag.T = T; diag.aliasIds = alias; diag.lignes = lignes; }       // la décision AVANT les gardes de la route (I2, I3) : le banc de parité l'attribue
        if (d.kind === 'rien') return note('pool-trop-petit');
        if (d.top3.length < 2) return note('moins-de-deux-classes');                 // un seul candidat classable : rien à poser
        if (!d.top3.every(id => lignes.has(id))) return echec('sans-ligne');         // (garde de repli : le pool ne retient que des produits à ligne)
        let nouveau = null;
        if (!meme(d.top3, baseIds)) {
            try { nouveau = questionParLaRoute(corpsChaine, d.top3, { ...ctxQuestion, produits: lignes }); } catch { return echec('question-impossible'); }
            if (!nouveau || nouveau.issue !== 'question') return echec('question-impossible');
            if (resultat.langueDecisive !== undefined) nouveau = { ...nouveau, langueDecisive: resultat.langueDecisive };
        }
        let probable = null;
        if (d.kind === 'prob') {
            const q = (nouveau || resultat).analyse.cartes[0];
            const c = q.candidats.find(x => x && x.idProduct === d.id);
            if (baseIds.length < 2) note('un-candidat');                                                                              // consulterProbable (:95) : une confirmation à UN candidat n'est jamais un probable ; la question, elle, suit le classement
            else if (dansUnGroupe(version, d.id, d.top3)) note('groupe-donnees');                                                     // I3 : le désigné est de MÊME DESSIN qu'un autre des 3
            else if (!c || PR.depuisGuide(c.prixGuide, 'tendance-seule') === null) note('sans-prix');                                 // I2 : un probable est affiché AVEC un prix de guide
            else probable = { idProduct: d.id, signal: SIGNAL, levier: LEVIER, contredits: d.top3.filter(i => i !== d.id), detail: { ecart: d.gap, second: d.second, pool: T.length } };
        }
        if (!nouveau && !probable) { if (!(diag && diag.raison)) note('inchangee'); return null; }
        if (diag && !diag.raison) diag.raison = probable ? 'probable' : 'question';
        return { resultat: nouveau, probable };
    } catch (e) { return echec('erreur', e && e.name ? `(${String(e.name).slice(0, 40)})` : ''); }
}

module.exports = { appliquerLeviers, echecs, signaler, classerPool, decider, composerPool, scoreC3, normaliserAlias, cleAlias, aliasDe, ajouterAlias, construireIndexAlias, produitsParCle,
    POIDS_OK, POIDS_KO, TAILLE_POOL, VIVIER_LU, VIVIER_RETENU, VOISINS, ALIAS_LONGUEUR_MIN, ALIAS_MAX, NOM_LU_MAX, SIGNAL, LEVIER };
