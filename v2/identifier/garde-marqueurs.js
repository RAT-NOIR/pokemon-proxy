'use strict';
// MARQUEURS P4 (CONTRAT-MARQUEURS.md §5) — deux règles de la route, chacune derrière SON drapeau, ÉTEINT par défaut (éteint : rien n'est lu, rien n'est calculé, la réponse est celle d'avant, octet pour octet) :
//   · V2_JUMBO_TITRE : une question dont les candidats sont EXACTEMENT un groupe { produit JUMBO, produit sans JUMBO } (même fiche, même visuel) devient un sûr du produit JUMBO quand le TITRE de l'annonce nomme un terme jumbo
//     ET que chacun de ses mots est dans la LISTE BLANCHE (JUMBO-LB). 🔴 On n'affirme JAMAIS la version normale sur l'absence du mot : sans terme, ou avec un seul mot hors liste (négation, doute, accessoire…), la question reste.
//   · V2_GARDE_MARQUEURS : un sûr dont le produit a, parmi les produits connus de la requête, un RIVAL DE GROUPE (même dessin, marqueurs différents) redevient la question d'avant — SAUF si le critère qui l'a affirmé est un
//     signal réel du marqueur qui les sépare (la lecture des marques pour un tampon, le titre pour le Jumbo). Un marqueur ne se lit JAMAIS dans l'image pour être posé (§5).
// Module PUR : ni base, ni réseau, ni modèle. La route lui prête ses outils (affirmer, marqueursDe, questionDeGroupe) ; il ne construit aucune réponse lui-même.
// 🔑 Écrit par ce qu'il AUTORISE : tout ce qui ne se prouve pas (version illisible, produit sans ligne, groupe de plus de deux pour le Jumbo, exception) laisse la réponse d'AVANT ; seul un groupe PROUVÉ ouvre une des deux règles.
const MQ = require('./marqueurs');

// ── Le titre : LISTE BLANCHE (JUMBO-LB, 27/10). 🔑 Écrite par ce qu'elle AUTORISE : le titre n'affirme le Jumbo que si CHACUN de ses mots appartient à un ensemble FERMÉ — (1) les termes jumbo des langues de Vinted,
// (2) les mots du produit JUMBO candidat lui-même (nom, nom français, set, code, numéro), (3) un petit ensemble de mots neutres. Un seul mot hors de ces ensembles, un titre trop long, une ponctuation hors de l'ensemble
// fermé : PAS de sûr. Une liste de refus (négations, doute, contrefaçon, accessoire…) ne ferme jamais la classe : deux tours de relecture l'ont montré (« nope jumbo », « fake jumbo », « sleeve pour jumbo »…).
// Tout est minuscule et sans accent (ß → ss). Un mot du produit n'entre JAMAIS s'il est une négation, une liaison, la version normale ou une contrefaçon (listes de garde-fou, jamais de décision seules).
const TERMES_PAR_LANGUE = Object.freeze({
    fr: { termes: ['jumbo', 'geant', 'geante', 'surdimensionne', 'surdimensionnee'], source: 'contrat §5 du 25/10 (jumbo, géant(e)) ; « carte surdimensionnée » = traduction usuelle d\'« oversized card » (annonces Vinted FR, fiches Cardmarket FR)' },
    en: { termes: ['jumbo', 'oversize', 'oversized', 'xxl'], source: 'contrat §5 du 25/10 (jumbo, oversize(d), XXL) ; « Oversized Card » est le libellé de la pastille Cardmarket EN du marqueur JUMBO' },
    de: { termes: ['jumbo', 'ubergross', 'ubergrosse', 'uebergross', 'uebergrosse', 'riesig', 'riesenkarte'], source: 'libellés Vinted/Cardmarket DE « Jumbo Karte », « Übergroße Karte » (ü → u ou ue, ß → ss), « Riesenkarte » ; établi le 27/10 sans requête, à valider sur de vrais titres' },
    es: { termes: ['jumbo', 'gigante', 'gigantes', 'sobredimensionada', 'sobredimensionado'], source: 'libellés Vinted/Cardmarket ES « carta jumbo », « carta gigante », « sobredimensionada » ; établi le 27/10 sans requête, à valider sur de vrais titres' },
    it: { termes: ['jumbo', 'gigante', 'giganti', 'sovradimensionata', 'sovradimensionato'], source: 'libellés Vinted/Cardmarket IT « carta jumbo », « carta gigante », « sovradimensionata » ; établi le 27/10 sans requête, à valider sur de vrais titres' },
    nl: { termes: ['jumbo', 'reuzenkaart', 'reuze'], source: 'libellés Vinted/Cardmarket NL « jumbo kaart », « reuzenkaart » (« oversized » est déjà un terme anglais) ; établi le 27/10 sans requête, à valider sur de vrais titres' },
    pt: { termes: ['jumbo', 'gigante', 'gigantes', 'sobredimensionada', 'sobredimensionado'], source: 'libellés Vinted PT « carta jumbo », « carta gigante », « sobredimensionada » ; établi le 27/10 sans requête, à valider sur de vrais titres' },
    pl: { termes: ['jumbo', 'gigantyczna', 'gigantyczny', 'olbrzymia', 'nadwymiarowa'], source: 'libellés Vinted PL « karta jumbo », « gigantyczna », « nadwymiarowa » ; établi le 27/10 sans requête, à valider sur de vrais titres' },
    cs: { termes: ['jumbo', 'obri', 'obrovska', 'nadmerna'], source: 'libellés Vinted CZ « jumbo karta », « obří », « obrovská », « nadměrná » (accents retirés) ; établi le 27/10 sans requête, à valider sur de vrais titres' }
});
const TERMES_JUMBO = Object.freeze([...new Set(Object.values(TERMES_PAR_LANGUE).flatMap(l => l.termes))]);
const MOTS_NEUTRES = Object.freeze(['pokemon', 'carte', 'cartes', 'card', 'cards', 'karte', 'karten', 'carta', 'cartas', 'kaart', 'karta', 'tcg', 'holo', 'promo', 'de', 'la', 'le', 'un', 'une', 'the', 'der', 'die', 'das', 'el', 'l', 'd']);        // courts, sans négation : « l'oversize », « d'oversize » → l, d
// Les listes de GARDE-FOU : un mot du produit qui en fait partie n'entre jamais dans la liste blanche (un nom de produit qui contiendrait « Not » ou « Sans » ne blanchit pas une négation du titre).
const NEGATIONS = Object.freeze(['pas', 'non', 'no', 'nope', 'nein', 'not', 'never', 'jamais', 'sans', 'without', 'aucun', 'aucune', 'false', 'faux', 'ni']);       // + tout mot en « n't » et les contractions sans apostrophe (CONTRACTIONS)
const CONTRACTIONS = Object.freeze(['isnt', 'arent', 'dont', 'doesnt', 'wasnt', 'werent', 'cant', 'wont', 'aint']);
const LIAISONS = Object.freeze(['ou', 'or', 'et', 'and', 'vs', 'versus', 'contre', 'nor', 'neither', 'either']);       // choix ou comparaison : le titre cite plusieurs versions
const VERSION_NORMALE = Object.freeze(['normal', 'normale', 'standard', 'regular', 'classique', 'classic', 'ordinaire', 'ordinary', 'petite', 'petit', 'mini', 'small', 'taille', 'size']);       // la version normale ou sa taille citées
const DOUTE_ACCESSOIRE = Object.freeze(['type', 'style', 'like', 'format', 'genre', 'sorte', 'maybe', 'peut', 'etre', 'probably', 'possibly', 'perhaps', 'crois', 'pense', 'surement', 'unsure', 'ish', 'cherche', 'recherche', 'wanted', 'wtb', 'search', 'looking', 'echange', 'trade', 'swap', 'sleeve', 'sleeves', 'classeur', 'binder', 'boite', 'box', 'case', 'pochette', 'toploader', 'protege', 'protection', 'etui', 'support']);      // doute, recherche, échange, accessoire : jamais admis comme mot du produit (« Type: Null » ne blanchit pas « type jumbo »)
const CONTREFACON = Object.freeze(['fake', 'replica', 'replique', 'proxy', 'custom', 'copy', 'copie', 'reproduction', 'repro', 'contrefacon', 'imitation', 'bootleg', 'counterfeit']);
const TITRE_MAX = 200, MOTS_MAX = 12;
const sansAccent = s => String(s).replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Les mots d'un titre : l'apostrophe typographique devient droite ; toute suite de lettres/chiffres est un mot (« isn't » → isn, t : ni l'un ni l'autre n'est admis).
const motsDe = t => sansAccent(t).replace(/[’‘`]/g, '\'').match(/[a-z0-9]+/g) || [];
const TERMES = new Set(TERMES_JUMBO), NEUTRES = new Set(MOTS_NEUTRES);
const INTERDITS = new Set([...NEGATIONS, ...CONTRACTIONS, ...LIAISONS, ...VERSION_NORMALE, ...CONTREFACON, ...DOUTE_ACCESSOIRE].map(sansAccent));
const PONCTUATION_ADMISE = /^[a-z0-9\s\-'.,()#]*$/;                                       // après avoir retiré les « 025/165 » : le « / » n'est admis qu'entre deux nombres
/** Les mots que le produit JUMBO candidat permet d'admettre : son nom (Cardmarket et français), le nom, le slug et le code de son set, son numéro (avec et sans zéros de tête) et son total. @returns string[] */
function motsDuProduit(ligne) {
    if (!ligne || typeof ligne !== 'object') return [];
    const s = ligne.set && typeof ligne.set === 'object' ? ligne.set : {};
    const sortie = new Set();
    for (const brut of [ligne.nomCardmarket, ligne.nomFr, ligne.nom, s.nom, s.slug, s.code, ligne.numero, ligne.total]) {
        if (typeof brut !== 'string' && typeof brut !== 'number') continue;
        if (/['’‘`]s(?![a-z0-9])/i.test(String(brut))) sortie.add('s');          // le possessif (« Rocket's ») : la lettre qui suit l'apostrophe est un mot du produit
        for (const m of motsDe(String(brut))) {
            if (INTERDITS.has(m)) continue;
            if (m.length >= 2 || /\d/.test(m) || m === 'v' || m === 'x') sortie.add(m);
            if (/^0+\d/.test(m)) sortie.add(m.replace(/^0+/, ''));
        }
    }
    if (typeof ligne.numero === 'string' || typeof ligne.numero === 'number') {
        const n = String(ligne.numero).replace(/^0+(?=\d)/, ''), t = ligne.total === null || ligne.total === undefined ? '' : String(ligne.total).replace(/^0+(?=\d)/, '');
        if (/^\d+$/.test(n) && /^\d+$/.test(t)) sortie.add(`${n}/${t}`);          // « 025/165 » n'est admis que s'il est le numéro ET le total de CE produit (jamais « 50/50 » deux mots admis séparément)
    }
    // le CODE du set s'écrit en lettres seules (« S-P », « SV »…) : ses lettres sont des mots du produit, même d'une lettre (un NOM d'une lettre, lui, n'entre pas)
    if (typeof s.code === 'string') for (const m of motsDe(s.code)) if (!INTERDITS.has(m)) sortie.add(m);
    return [...sortie].sort();
}
/**
 * @param titre le titre de l'annonce ; @param produit les mots du produit JUMBO candidat (motsDuProduit) — un tableau, ou { mots } ; absent : seuls les termes jumbo et les mots neutres sont admis
 * @returns { oui, terme?, motif, ambigu } — oui SEULEMENT si le titre nomme un terme jumbo ET que chacun de ses mots est admis ; `ambigu` : le titre nomme un terme jumbo sans être admis (la question { normale, jumbo } reste, jamais un sûr).
 */
function lireTitreJumbo(titre, produit) {
    if (typeof titre !== 'string' || !titre.trim()) return { oui: false, ambigu: false, motif: 'pas de titre' };
    const t = motsDe(titre), trouves = t.filter(m => TERMES.has(m)), ambigu = trouves.length > 0;
    if (titre.length > TITRE_MAX || t.length > MOTS_MAX) return { oui: false, ambigu, motif: 'titre trop long' };
    if (!ambigu) return { oui: false, ambigu: false, motif: 'aucun terme' };
    const normal = sansAccent(titre).replace(/[’‘]/g, '\''), propre = normal.replace(/\d+\/\d+/g, ' ');
    if (!PONCTUATION_ADMISE.test(propre)) return { oui: false, ambigu: true, terme: trouves[0], motif: 'ponctuation hors de la liste blanche' };
    const mots = Array.isArray(produit) ? produit : produit && Array.isArray(produit.mots) ? produit.mots : [];
    const duProduit = new Set(mots.filter(m => typeof m === 'string').map(sansAccent).filter(m => m && !INTERDITS.has(m)));
    const sansZeros = m => (/^0+\d/.test(m) ? m.replace(/^0+/, '') : m);
    const fractions = (normal.match(/\d+\/\d+/g) || []).map(x => x.split('/').map(y => y.replace(/^0+(?=\d)/, '')).join('/')).filter(x => !duProduit.has(x));
    const hors = fractions.length ? fractions[0] : t.find(m => !TERMES.has(m) && !NEUTRES.has(m) && !duProduit.has(m) && !duProduit.has(sansZeros(m)));
    if (hors !== undefined) return { oui: false, ambigu: true, terme: trouves[0], motif: 'mot hors de la liste blanche', mot: hors };
    return { oui: true, terme: trouves[0], motif: 'liste blanche', ambigu: false };
}
/** Le critère journalisé de l'affirmation par le titre : il COMMENCE par CRITERE_JUMBO (la garde des marqueurs le reconnaît). */
const CRITERE_JUMBO = 'jumbo (titre)';
const critereJumbo = terme => `${CRITERE_JUMBO} : le titre de l'annonce nomme « ${terme} » sans négation ; seule la version Jumbo du groupe (même fiche, même visuel) est affirmée`;

// ── Le groupe : même dessin, d'après l'archive EN PLACE.
const entreeDe = (version, id) => { try { const e = version.entree(id); return e && typeof e === 'object' ? e : null; } catch { return null; } };
const fichiers = e => [e.vignette && e.vignette.cle, e.grande && e.grande.cle].filter(f => typeof f === 'string' && f);
const memeVisuel = (ea, eb) => { const b = fichiers(eb); return fichiers(ea).some(f => b.includes(f)); };
/** Même fiche : la colonne des paires de l'archive la dit, ou — sans elle — même métacarte, même numéro, même nom de set (trois égalités, aucune ne vaut seule). */
function memeFiche(version, a, b, ea, eb) {
    if (typeof version.memeFiche === 'function') { try { if (version.memeFiche(a, b) === true) return true; } catch { /* la colonne ne conclut pas */ } }
    return Number.isInteger(ea.idMetacard) && ea.idMetacard === eb.idMetacard && typeof ea.numero === 'string' && ea.numero !== '' && ea.numero === eb.numero && typeof ea.setNom === 'string' && ea.setNom !== '' && ea.setNom === eb.setNom;
}
const empruntDe = (version, id) => { try { return typeof version.empruntDe === 'function' ? version.empruntDe(id) === true : false; } catch { return false; } };
/**
 * a et b sont-ils le MÊME DESSIN ? Même visuel (même fichier) ET (même fiche, OU — `avecEmprunt` — le visuel de l'un est emprunté à l'autre : version.empruntDe). Le Jumbo n'admet pas l'emprunt (il exige la même fiche).
 * Faux dès qu'une entrée manque ou que la version ne sait pas répondre : jamais un groupe deviné.
 */
function memeDessin(version, a, b, { avecEmprunt = false } = {}) {
    if (!version || typeof version.entree !== 'function') return false;
    const ea = entreeDe(version, a), eb = entreeDe(version, b);
    if (!ea || !eb || !memeVisuel(ea, eb)) return false;
    return memeFiche(version, a, b, ea, eb) || (avecEmprunt && (empruntDe(version, a) || empruntDe(version, b)));
}

// ── Les marqueurs d'un produit : `null`/`undefined` = on ne sait pas.
const inconnu = m => m === null || m === undefined;
/** L'écart entre deux ensembles de marqueurs : { different, connu, types }. Deux inconnus ne diffèrent pas (rien ne dit qu'ils diffèrent) ; un inconnu contre un connu DIFFÈRE sans type connu (aucun signal réel ne peut le séparer). */
function ecartMarqueurs(a, b) {
    if (inconnu(a) && inconnu(b)) return { different: false, connu: false, types: [] };
    if (inconnu(a) || inconnu(b)) return { different: true, connu: false, types: [] };
    const ma = new Map(a.map(e => [e.type, JSON.stringify(e.params)])), mb = new Map(b.map(e => [e.type, JSON.stringify(e.params)]));
    const types = [...new Set([...ma.keys(), ...mb.keys()])].filter(t => ma.get(t) !== mb.get(t));
    return { different: types.length > 0, connu: true, types };
}
const TYPES_TAMPON = new Set(Object.values(MQ.TYPE_DE_MARQUE));                          // STAFF… PLACE, enseignes : ce que la lecture des marques sait séparer
const TYPES_JUMBO = new Set(['JUMBO', 'NON_LEGAL']);                                     // ce que le titre sait séparer
/** Le critère qui a affirmé le sûr est-il un signal RÉEL de TOUT ce qui sépare les deux produits ? Un écart non nommé (inconnu d'un côté) n'est jamais couvert. */
function signalReel(critere, ecart) {
    if (typeof critere !== 'string' || !ecart.connu || !ecart.types.length) return false;
    if (/^tampon \(/.test(critere)) return ecart.types.every(t => TYPES_TAMPON.has(t));
    if (critere.startsWith(CRITERE_JUMBO)) return ecart.types.every(t => TYPES_JUMBO.has(t));
    return false;
}
/**
 * TOUR 1 (e) : « jumbo (titre) » EST le signal réel d'un groupe { JUMBO, sans JUMBO } même quand le jumeau normal porte `null` (on ne sait pas) ou `[]` : le titre nomme la version, c'est le seul signal qui sépare ce groupe.
 * Écrit par ce qu'il AUTORISE : le critère est celui du titre ; le sûr `mp` est la version JUMBO et ne porte que JUMBO / NON_LEGAL ; le rival `mr` est null ou vide. Aucun autre critère, aucun autre groupe.
 */
function jumboParTitre(critere, mp, mr) {
    if (typeof critere !== 'string' || !critere.startsWith(CRITERE_JUMBO)) return false;
    return Array.isArray(mp) && estJumbo(mp) && mp.every(e => TYPES_JUMBO.has(e.type)) && (mr === null || mr === undefined || (Array.isArray(mr) && mr.length === 0));
}

const carteDe = r => (r && r.analyse && Array.isArray(r.analyse.cartes) && r.analyse.cartes.length === 1 ? r.analyse.cartes[0] : null);
/** Les candidats de la question, plus ceux que la chaîne a lus sans les montrer (un candidat caché reste un rival) ; null si ce n'est pas une question. */
function idsDeLaQuestion(resultat, corps) {
    const c = carteDe(resultat);
    if (!c || !Array.isArray(c.candidats)) return null;
    const caches = corps && Array.isArray(corps.candidats) ? corps.candidats.map(x => x && x.idProduct).filter(Number.isInteger) : [];
    return [...new Set([...c.candidats.map(x => x && x.idProduct), ...caches])];
}
const estJumbo = m => Array.isArray(m) && m.some(e => e.type === 'JUMBO');

/** V2_JUMBO_TITRE : null (pas le cas visé : rien d'appelé) | { resultat?, trace } — resultat : l'affirmation du produit JUMBO, SEULEMENT si la preuve du titre est faite. */
function parJumbo({ resultat, titre, corpsChaine, version, affirmer, marqueursDe, motsDeProduit, desaccordG, empreinteInfo }) {
    if (!resultat || resultat.issue !== 'question' || resultat.motif || resultat.contradiction) return null;
    if (desaccordG || (empreinteInfo && empreinteInfo.influence)) return null;             // deux sources en conflit ne donnent pas un sûr (comme SUR-PAR-IMAGE)
    const ids = idsDeLaQuestion(resultat, corpsChaine);
    if (!ids || ids.length !== 2 || !ids.every(Number.isInteger) || typeof affirmer !== 'function' || typeof marqueursDe !== 'function') return null;       // EXACTEMENT un groupe de deux
    const [a, b] = ids, ma = marqueursDe(a), mb = marqueursDe(b);
    if (estJumbo(ma) === estJumbo(mb)) return null;                                        // pas { Jumbo, sans Jumbo }
    const jumbo = estJumbo(ma) ? a : b, autre = jumbo === a ? b : a;
    if (!memeDessin(version, jumbo, autre)) return { trace: { regle: 'jumbo-titre', issue: 'se-tait', motif: 'pas le même dessin (fiche et visuel)', produit: jumbo } };
    let mots; try { mots = typeof motsDeProduit === 'function' ? motsDeProduit(jumbo) : undefined; } catch { mots = undefined; }       // les mots du produit JUMBO candidat : un outil muet ou en erreur n'admet rien de plus
    const t = lireTitreJumbo(titre, mots);
    // ambigu (un terme jumbo, mais le titre n'est pas entièrement admis) : jamais de sûr ; la question { normale, jumbo } reste, les deux versions en UN clic
    if (!t.oui) return { trace: { regle: 'jumbo-titre', issue: 'se-tait', motif: t.motif, ...(t.ambigu ? { ambigu: true, proposition: 'deux versions' } : {}), produit: jumbo } };
    const aff = affirmer(jumbo, undefined, critereJumbo(t.terme));
    const c = carteDe(aff);
    if (aff && aff.issue === 'affirmee' && c && c.carte && c.carte.idProduct === jumbo) return { resultat: aff, trace: { regle: 'jumbo-titre', issue: 'sur', motif: t.motif, terme: t.terme, produit: jumbo } };
    return { trace: { regle: 'jumbo-titre', issue: 'non-construite', motif: 'l\'affirmation n\'a pas pu être construite', produit: jumbo } };
}

/** V2_GARDE_MARQUEURS : null (rien à dire) | { resultat?, trace } — resultat : la question (celle d'avant, sinon celle du groupe) qui REMPLACE le sûr. */
function parGarde({ resultat, produits, version, marqueursDe, derniereQuestion, questionDeGroupe }) {
    if (!resultat || resultat.issue !== 'affirmee') return null;
    const c = carteDe(resultat), p = c && c.carte ? c.carte.idProduct : null;
    if (!Number.isInteger(p) || !(produits instanceof Map) || typeof marqueursDe !== 'function') return null;
    const mp = marqueursDe(p);
    if (mp === undefined) return null;                                                     // le produit n'a pas de ligne : rien ne se juge
    const rivaux = [], bloquants = [];
    for (const id of produits.keys()) {
        if (id === p) continue;
        const mr = marqueursDe(id);
        if (mr === undefined || !memeDessin(version, p, id, { avecEmprunt: true })) continue;
        const e = ecartMarqueurs(mp, mr);
        if (!e.different) continue;
        rivaux.push(id);
        if (!signalReel(resultat.critere, e) && !jumboParTitre(resultat.critere, mp, mr)) bloquants.push(id);
    }
    if (!rivaux.length) return null;
    const critere = typeof resultat.critere === 'string' ? resultat.critere.slice(0, 80) : null;
    if (!bloquants.length) return { trace: { regle: 'garde-marqueurs', issue: 'sur-confirme', produit: p, rivaux, critere } };
    // la question d'avant ne revient que si elle OFFRE le produit et tous ses rivaux (une étape tardive — tampon, règle G — a pu changer de produit) ; sinon la question du groupe
    const offerts = derniereQuestion && derniereQuestion.issue === 'question' ? (idsDeLaQuestion(derniereQuestion, null) || []) : [];
    const avant = [p, ...rivaux].every(id => offerts.includes(id));
    const q = avant ? derniereQuestion : questionDeGroupe([p, ...rivaux]);
    return { resultat: q, trace: { regle: 'garde-marqueurs', issue: 'question', produit: p, rivaux, bloquants, critere, retour: avant ? 'question-d-avant' : 'question-du-groupe', ...(q && q.issue !== 'question' ? { issueRendue: q.issue } : {}) } };
}

/**
 * Le point d'entrée de la route, appelé UNE fois, à la fin de la décision d'une carte (après la lecture du tampon, la règle G et SUR-PAR-IMAGE : c'est le seul endroit où tous les sûrs sont passés).
 * @param cfg { jumboTitre, gardeMarqueurs } ; @param titre le titre de l'annonce ; @param resultat le résultat courant ; @param derniereQuestion la dernière question vue par la route (ou null)
 * @param affirmer (idProduct, surcharge, critere) => affirmation ; @param marqueursDe (idProduct) => marqueurs servis | undefined ; @param questionDeGroupe (ids) => question
 * @returns null (rien d'appelé, rien de noté) | { resultat?, trace } — Jamais d'exception : une garde qui ne conclut pas laisse la réponse d'avant, SAUF qu'une garde en erreur rend la question d'avant quand la route en a une.
 */
function consulterMarqueurs({ cfg, titre, resultat, derniereQuestion = null, corpsChaine = null, desaccordG = null, empreinteInfo = null, produits, version, affirmer, marqueursDe, motsDeProduit, questionDeGroupe, journal = () => { } }) {
    if (!cfg || (cfg.jumboTitre !== true && cfg.gardeMarqueurs !== true)) return null;
    let courant = resultat, trace = null, remplace = false;
    if (cfg.jumboTitre === true) {
        try {
            const j = parJumbo({ resultat: courant, titre, corpsChaine, version, affirmer, marqueursDe, motsDeProduit, desaccordG, empreinteInfo });
            if (j) { trace = j.trace; if (j.resultat) { courant = j.resultat; remplace = true; } }
        } catch (e) { journal('jumbo par le titre', e); }
    }
    if (cfg.gardeMarqueurs === true && courant && courant.issue === 'affirmee') {
        try {
            const g = parGarde({ resultat: courant, produits, version, marqueursDe, derniereQuestion, questionDeGroupe });
            if (g) { trace = { ...(trace || {}), garde: g.trace }; if (g.resultat) { courant = g.resultat; remplace = true; } }
        } catch (e) {
            journal('garde des marqueurs', e);
            // TOUR 2 : une garde en erreur rend la question du GROUPE (le produit et les produits connus de même dessin, sans lire un seul marqueur), jamais la question d'avant non contrôlée ; sans groupe, la réponse reste
            try {
                const c = carteDe(courant), p = c && c.carte ? c.carte.idProduct : null;
                const groupe = Number.isInteger(p) && produits instanceof Map ? [...produits.keys()].filter(id => id !== p && memeDessin(version, p, id, { avecEmprunt: true })) : [];
                if (groupe.length && typeof questionDeGroupe === 'function') { courant = questionDeGroupe([p, ...groupe]); trace = { ...(trace || {}), garde: { regle: 'garde-marqueurs', issue: 'en-erreur', retour: 'question-du-groupe', produit: p, rivaux: groupe } }; remplace = true; }
            } catch (e2) { journal('garde des marqueurs (repli)', e2); }
        }
    }
    return trace || remplace ? { ...(remplace ? { resultat: courant } : {}), trace } : null;
}

/**
 * UNE SEULE fonction d'appel pour la route d'une carte ET le lot (I1 de la relecture) : elle construit les outils de la route (l'affirmation, les marqueurs servis, la question du groupe) avec le MÊME contexte que l'adaptateur
 * (produits, jumeaux, langue), puis délègue à consulterMarqueurs. @param c le corps de la chaîne de CETTE carte ; @param lot vrai dans un lot : le titre décrit plusieurs cartes, V2_JUMBO_TITRE n'y agit jamais.
 */
function appliquerMarqueurs({ cfg, titre, resultat, derniereQuestion = null, c, desaccordG = null, empreinteInfo = null, produits, version, langueInterface, jumeaux, lot = false, journal = () => { } }) {
    if (!cfg || (cfg.jumboTitre !== true && cfg.gardeMarqueurs !== true)) return null;
    const { affirmerParLaRoute, questionDeGroupe } = require('./adaptateur'), { construireProduit } = require('./produit');
    const pctx = { langueInterface, cfg, ficheServie: false };
    return consulterMarqueurs({ cfg: lot ? { ...cfg, jumboTitre: false } : cfg, titre, resultat, derniereQuestion, corpsChaine: c, desaccordG, empreinteInfo, produits, version,
        affirmer: (id, surcharge, critere) => affirmerParLaRoute(c, id, { ...pctx, produits: surcharge || produits }, critere),
        marqueursDe: id => (produits instanceof Map && produits.has(id) ? construireProduit(produits.get(id), pctx).marqueurs : undefined),
        motsDeProduit: id => (produits instanceof Map && produits.has(id) ? motsDuProduit(produits.get(id)) : undefined),
        questionDeGroupe: ids => questionDeGroupe(c, ids, { ...pctx, produits, jumeaux }), journal });
}

module.exports = { DOUTE_ACCESSOIRE, consulterMarqueurs, appliquerMarqueurs, lireTitreJumbo, motsDuProduit, memeDessin, ecartMarqueurs, signalReel, critereJumbo, CRITERE_JUMBO, TERMES_JUMBO, TERMES_PAR_LANGUE, MOTS_NEUTRES, NEGATIONS, CONTRACTIONS, LIAISONS, VERSION_NORMALE, CONTREFACON, TITRE_MAX, MOTS_MAX };
