'use strict';
// MARQUEURS P4 (CONTRAT-MARQUEURS.md §5) — deux règles de la route, chacune derrière SON drapeau, ÉTEINT par défaut (éteint : rien n'est lu, rien n'est calculé, la réponse est celle d'avant, octet pour octet) :
//   · V2_JUMBO_TITRE : une question dont les candidats sont EXACTEMENT un groupe { produit JUMBO, produit sans JUMBO } (même fiche, même visuel) devient un sûr du produit JUMBO quand le TITRE de l'annonce nomme un terme jumbo
//     ET que chacun de ses mots est dans la LISTE BLANCHE (JUMBO-LB). 🔴 On n'affirme JAMAIS la version normale sur l'absence du mot : sans terme, ou avec un seul mot hors liste (négation, doute, accessoire…), la question reste.
//   · V2_GARDE_MARQUEURS : un sûr dont le produit a, parmi les produits connus de la requête, un RIVAL DE GROUPE (même dessin, marqueurs différents) redevient la question d'avant — SAUF si le critère qui l'a affirmé est un
//     signal réel du marqueur qui les sépare (la lecture des marques pour un tampon, le titre pour le Jumbo). Un marqueur ne se lit JAMAIS dans l'image pour être posé (§5).
// Module PUR : ni base, ni réseau, ni modèle. La route lui prête ses outils (affirmer, marqueursDe, questionDeGroupe) ; il ne construit aucune réponse lui-même.
// 🔑 Écrit par ce qu'il AUTORISE : tout ce qui ne se prouve pas (version illisible, produit sans ligne, groupe de plus de deux pour le Jumbo, exception) laisse la réponse d'AVANT ; seul un groupe PROUVÉ ouvre une des deux règles.
const MQ = require('./marqueurs');

// ── Le titre : LISTE BLANCHE (JUMBO-LB, 27/10). 🔑 Écrite par ce qu'elle AUTORISE : le titre n'affirme le Jumbo que s'il nomme un terme jumbo ET que CHACUN de ses mots appartient à un ensemble FERMÉ — (1) le vocabulaire jumbo des langues
// de Vinted, (2) les mots du produit JUMBO candidat lui-même (nom, nom français, numéro, code et nom de son set — jamais ses attaques), (3) un petit ensemble de mots neutres. Un seul mot hors de ces ensembles, un titre trop long,
// une ponctuation hors de l'ensemble fermé, un tiret qui n'est pas À L'INTÉRIEUR d'un mot admis en entier : PAS de sûr. Une liste de refus ne ferme jamais la classe (deux tours de relecture l'ont montré).
// Termes : ceux qui ne sont pas ambigus (jumbo, oversize, oversized, xxl, les composés Riesenkarte / reuzenkaart) suffisent seuls ; les ADJECTIFS « grand » (géant, gigante, riesig, reuze, obri…) ne comptent comme terme que si le titre
// contient AUSSI le nom « carte » de la MÊME langue. Tout est minuscule et sans accent (ß → ss). Un mot du produit n'entre JAMAIS s'il est une négation, une liaison, la version normale, une contrefaçon, un doute ou un accessoire.
const langue = (seuls, adjectifs, cartes, source) => Object.freeze({ seuls: Object.freeze(seuls), adjectifs: Object.freeze(adjectifs), cartes: Object.freeze(cartes), termes: Object.freeze([...seuls, ...adjectifs]), source });
const TERMES_PAR_LANGUE = Object.freeze({
    fr: langue(['jumbo'], ['geant', 'geante', 'surdimensionne', 'surdimensionnee'], ['carte', 'cartes'], 'contrat §5 du 25/10 (jumbo, géant(e)) ; « carte surdimensionnée » = traduction usuelle d\'« oversized card » (annonces Vinted FR, fiches Cardmarket FR)'),
    en: langue(['jumbo', 'oversize', 'oversized', 'xxl'], [], ['card', 'cards'], 'contrat §5 du 25/10 (jumbo, oversize(d), XXL) ; « Oversized Card » est le libellé de la pastille Cardmarket EN du marqueur JUMBO'),
    de: langue(['jumbo', 'riesenkarte'], ['ubergross', 'ubergrosse', 'uebergross', 'uebergrosse', 'riesig'], ['karte', 'karten'], 'libellés Vinted/Cardmarket DE « Jumbo Karte », « Übergroße Karte » (ü → u ou ue, ß → ss), « Riesenkarte » ; établi le 27/10 sans requête, à valider sur de vrais titres'),
    es: langue(['jumbo'], ['gigante', 'gigantes', 'sobredimensionada', 'sobredimensionado'], ['carta', 'cartas'], 'libellés Vinted/Cardmarket ES « carta jumbo », « carta gigante », « sobredimensionada » ; établi le 27/10 sans requête, à valider sur de vrais titres'),
    it: langue(['jumbo'], ['gigante', 'giganti', 'sovradimensionata', 'sovradimensionato'], ['carta', 'carte'], 'libellés Vinted/Cardmarket IT « carta jumbo », « carta gigante », « sovradimensionata » ; établi le 27/10 sans requête, à valider sur de vrais titres'),
    nl: langue(['jumbo', 'reuzenkaart'], ['reuze'], ['kaart', 'kaarten'], 'libellés Vinted/Cardmarket NL « jumbo kaart », « reuzenkaart » (« oversized » est déjà un terme anglais) ; établi le 27/10 sans requête, à valider sur de vrais titres'),
    pt: langue(['jumbo'], ['gigante', 'gigantes', 'sobredimensionada', 'sobredimensionado'], ['carta', 'cartas'], 'libellés Vinted PT « carta jumbo », « carta gigante », « sobredimensionada » ; établi le 27/10 sans requête, à valider sur de vrais titres'),
    pl: langue(['jumbo'], ['gigantyczna', 'gigantyczny', 'olbrzymia', 'nadwymiarowa'], ['karta', 'karty'], 'libellés Vinted PL « karta jumbo », « gigantyczna », « nadwymiarowa » ; établi le 27/10 sans requête, à valider sur de vrais titres'),
    cs: langue(['jumbo'], ['obri', 'obrovska', 'nadmerna'], ['karta', 'karty'], 'libellés Vinted CZ « jumbo karta », « obří », « obrovská », « nadměrná » (accents retirés) ; établi le 27/10 sans requête, à valider sur de vrais titres')
});
const TERMES_JUMBO = Object.freeze([...new Set(Object.values(TERMES_PAR_LANGUE).flatMap(l => l.termes))]);
const MOTS_NEUTRES = Object.freeze(['pokemon', 'carte', 'cartes', 'card', 'cards', 'karte', 'karten', 'carta', 'cartas', 'kaart', 'kaarten', 'karta', 'karty', 'tcg', 'holo', 'promo', 'de', 'la', 'le', 'un', 'une', 'the', 'der', 'die', 'das', 'el']);        // aucune lettre seule ; l'élision (« l'oversize ») est retirée avant le découpage en mots
// Les listes de GARDE-FOU : un mot du produit qui en fait partie n'entre jamais dans la liste blanche (un nom de produit qui contiendrait « Not » ou « Sans » ne blanchit pas une négation du titre).
const NEGATIONS = Object.freeze(['pas', 'non', 'no', 'nope', 'nein', 'not', 'never', 'jamais', 'sans', 'without', 'aucun', 'aucune', 'false', 'faux', 'ni']);       // + les contractions sans apostrophe (CONTRACTIONS)
const CONTRACTIONS = Object.freeze(['isnt', 'arent', 'dont', 'doesnt', 'wasnt', 'werent', 'cant', 'wont', 'aint']);
const LIAISONS = Object.freeze(['ou', 'or', 'et', 'and', 'vs', 'versus', 'contre', 'nor', 'neither', 'either']);       // choix ou comparaison : le titre cite plusieurs versions
const VERSION_NORMALE = Object.freeze(['normal', 'normale', 'standard', 'regular', 'classique', 'classic', 'ordinaire', 'ordinary', 'petite', 'petit', 'mini', 'small', 'taille', 'size']);       // la version normale ou sa taille citées
const DOUTE_ACCESSOIRE = Object.freeze(['type', 'style', 'like', 'format', 'genre', 'sorte', 'maybe', 'peut', 'etre', 'probably', 'possibly', 'perhaps', 'crois', 'pense', 'surement', 'unsure', 'ish', 'cherche', 'recherche', 'wanted', 'wtb', 'search', 'looking', 'echange', 'trade', 'swap', 'sleeve', 'sleeves', 'classeur', 'binder', 'boite', 'box', 'case', 'pochette', 'toploader', 'protege', 'protection', 'etui', 'support']);      // doute, recherche, échange, accessoire : jamais admis comme mot du produit (« Type: Null » ne blanchit pas « type jumbo »)
const CONTREFACON = Object.freeze(['fake', 'replica', 'replique', 'proxy', 'custom', 'copy', 'copie', 'reproduction', 'repro', 'contrefacon', 'imitation', 'bootleg', 'counterfeit']);
const TITRE_MAX = 200, MOTS_MAX = 12;
const sansAccent = s => String(s).replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SEULS = new Set(Object.values(TERMES_PAR_LANGUE).flatMap(l => l.seuls));
const ADJECTIFS = new Map();       // adjectif → les ensembles de noms « carte » des langues où il existe
for (const l of Object.values(TERMES_PAR_LANGUE)) for (const a of l.adjectifs) ADJECTIFS.set(a, [...(ADJECTIFS.get(a) || []), new Set(l.cartes)]);
const NEUTRES = new Set(MOTS_NEUTRES), VOCABULAIRE = new Set(TERMES_JUMBO);
const INTERDITS = new Set([...NEGATIONS, ...CONTRACTIONS, ...LIAISONS, ...VERSION_NORMALE, ...CONTREFACON, ...DOUTE_ACCESSOIRE].map(sansAccent));
// Normalise un texte : sans accent, apostrophe droite ; les crochets (attaques) ne sont pas lus ici.
const normaliser = t => sansAccent(t).replace(/[’‘`]/g, '\'');
const sansElision = s => s.replace(/(^|[^a-z0-9])[ld]'(?=[a-z])/g, '$1 ');                 // « l'oversize », « d'oversize » : la lettre d'élision n'est pas un mot
const motsDe = t => normaliser(t).match(/[a-z0-9]+/g) || [];
const composesDe = t => (normaliser(t).match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) || []);        // « ho-oh », « s-p » : un tiret À L'INTÉRIEUR d'un mot
const PONCTUATION_ADMISE = /^[a-z0-9\s\-'.,()#]*$/;                                       // après avoir retiré les « 025/165 » : le « / » n'est admis qu'entre deux nombres
const TIRET_HORS_MOT = /(^|[^a-z0-9])-|-($|[^a-z0-9])/;                                   // un tiret en tête ou en fin de mot, ou isolé : « -jumbo », « jumbo- », « - »
/**
 * Les mots que le produit JUMBO candidat permet d'admettre : son nom (Cardmarket et français, SANS les crochets d'attaques), le nom, le slug et le code de son set, son numéro (avec et sans zéros de tête) ; les mots composés
 * (« ho-oh », « s-p ») en entier ; « n/total » seulement s'il est le numéro ET le total du produit. TOUR 2 : aucune lettre seule (« v », « x », « s ») ni aucun nombre autre que le numéro n'est un mot ; les suites de mots du NOM
 * (« pikachu v », « team rocket s dragonite ») sont rendues en entrées « ~mot mot » : une lettre seule ne passe qu'à l'intérieur d'une suite exacte du nom lue dans le titre. @returns string[]
 */
function motsDuProduit(ligne) {
    if (!ligne || typeof ligne !== 'object') return [];
    const s = ligne.set && typeof ligne.set === 'object' ? ligne.set : {};
    const sortie = new Set();
    const ajouter = (brut, { crochets = false, nombres = false, nom = false } = {}) => {
        if (typeof brut !== 'string' && typeof brut !== 'number') return;
        const texte = crochets ? String(brut).replace(/\[[^\]]*\]/g, ' ') : String(brut);            // les attaques (« [Gnaw | Thunder Jolt] ») ne sont pas des mots du produit
        const jetons = motsDe(texte);
        for (const m of jetons) {
            if (INTERDITS.has(m)) continue;
            if (/^\d+$/.test(m)) { if (nombres) { sortie.add(m); if (/^0+\d/.test(m)) sortie.add(m.replace(/^0+/, '')); } continue; }          // un nombre n'est un mot que s'il est le NUMÉRO du produit
            if (m.length >= 2) sortie.add(m);
        }
        for (const c of composesDe(texte)) if (!c.split('-').some(p => INTERDITS.has(p))) sortie.add(c);
        if (nom && jetons.length >= 2 && !jetons.some(m => INTERDITS.has(m))) sortie.add('~' + jetons.join(' '));
    };
    for (const nom of [ligne.nomCardmarket, ligne.nomFr, ligne.nom]) ajouter(nom, { crochets: true, nom: true });
    for (const autre of [s.nom, s.slug, s.code, ligne.total]) ajouter(autre);
    ajouter(ligne.numero, { nombres: true });
    if (typeof ligne.numero === 'string' || typeof ligne.numero === 'number') {
        const n = String(ligne.numero).replace(/^0+(?=\d)/, ''), t = ligne.total === null || ligne.total === undefined ? '' : String(ligne.total).replace(/^0+(?=\d)/, '');
        if (/^\d+$/.test(n) && /^\d+$/.test(t)) sortie.add(`${n}/${t}`);          // « 025/165 » n'est admis que s'il est le numéro ET le total de CE produit (jamais « 50/50 » deux mots admis séparément)
    }
    return [...sortie].sort();
}
/**
 * @param titre le titre de l'annonce ; @param produit les mots du produit JUMBO candidat (motsDuProduit) — un tableau, ou { mots } ; absent : seuls le vocabulaire jumbo et les mots neutres sont admis
 * @returns { oui, terme?, motif, ambigu } — oui SEULEMENT si le titre nomme un terme jumbo ET que chacun de ses mots est admis ; `ambigu` : le titre nomme un terme jumbo sans être admis (la question { normale, jumbo } reste, jamais un sûr).
 * TOUR 2 : chaque mot du produit (nom, numéro, code, set) ne figure qu'UNE fois, et le nom du produit qu'une fois ; un mot répété : pas de sûr.
 */
function lireTitreJumbo(titre, produit) {
    if (typeof titre !== 'string' || !titre.trim()) return { oui: false, ambigu: false, motif: 'pas de titre' };
    const normal = sansElision(normaliser(titre));
    const t = normal.match(/[a-z0-9]+/g) || [];
    const estTerme = m => SEULS.has(m) || (ADJECTIFS.has(m) && ADJECTIFS.get(m).some(cartes => t.some(x => cartes.has(x))));        // un adjectif « grand » ne compte que si le titre a aussi le nom « carte » de sa langue
    const trouves = t.filter(estTerme), ambigu = trouves.length > 0;
    if (titre.length > TITRE_MAX || t.length > MOTS_MAX) return { oui: false, ambigu, motif: 'titre trop long' };
    if (!ambigu) return { oui: false, ambigu: false, motif: 'aucun terme' };
    const propre = normal.replace(/\d+\/\d+/g, ' ');
    const refus = motif => ({ oui: false, ambigu: true, terme: trouves[0], motif });
    if (!PONCTUATION_ADMISE.test(propre)) return refus('ponctuation hors de la liste blanche');
    if (TIRET_HORS_MOT.test(propre)) return refus('tiret hors d\'un mot admis');
    const mots = Array.isArray(produit) ? produit : produit && Array.isArray(produit.mots) ? produit.mots : [];
    const propres = mots.filter(m => typeof m === 'string').map(sansAccent).filter(m => m && !INTERDITS.has(m.replace(/^~/, '')));
    const duProduit = new Set(propres.filter(m => !m.startsWith('~'))), noms = propres.filter(m => m.startsWith('~')).map(m => m.slice(1).split(' '));
    const sansZeros = m => (/^0+\d/.test(m) ? m.replace(/^0+/, '') : m);
    const utilises = [];          // les mots du produit lus dans le titre : chacun UNE fois
    // la suite exacte du nom : une lettre seule ne passe qu'à l'intérieur d'une sous-suite (au moins 2 mots, dans l'ordre) du nom du produit lue dans le titre
    const plats = propre.match(/[a-z0-9]+/g) || [], couverts = new Set();
    for (const nom of noms) for (let i = 0; i < nom.length; i++) for (let j = i + 2; j <= nom.length; j++) {
        const suite = nom.slice(i, j);
        for (let k = 0; k + suite.length <= plats.length; k++) if (suite.every((m, d) => plats[k + d] === m)) for (let d = 0; d < suite.length; d++) couverts.add(k + d);
    }
    let nomEntier = 0;
    for (const nom of noms) for (let k = 0; k + nom.length <= plats.length; k++) if (nom.every((m, d) => plats[k + d] === m)) nomEntier++;
    if (nomEntier > 1) return refus('mot répété');
    const fractions = (normal.match(/\d+\/\d+/g) || []).map(x => x.split('/').map(y => y.replace(/^0+(?=\d)/, '')).join('/'));
    const horsFraction = fractions.find(x => !duProduit.has(x));
    if (horsFraction !== undefined) return { ...refus('mot hors de la liste blanche'), mot: horsFraction };
    for (const x of fractions) utilises.push('n:' + x.split('/')[0]);
    // les mots du titre, un mot composé (« ho-oh ») restant ENTIER : il n'est admis que s'il est tel quel un mot du produit
    let pos = 0;
    for (const w of propre.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []) {
        const n = w.split('-').length, debut = pos; pos += n;
        if (w.includes('-')) { if (!duProduit.has(w)) return { ...refus('mot hors de la liste blanche'), mot: w }; utilises.push(w); continue; }
        if (VOCABULAIRE.has(w) || NEUTRES.has(w)) continue;
        if (w.length === 1 && !/\d/.test(w)) { if (!couverts.has(debut)) return { ...refus('mot hors de la liste blanche'), mot: w }; continue; }
        if (/^\d+$/.test(w)) { if (!duProduit.has(w) && !duProduit.has(sansZeros(w))) return { ...refus('mot hors de la liste blanche'), mot: w }; utilises.push('n:' + sansZeros(w)); continue; }
        if (!duProduit.has(w)) return { ...refus('mot hors de la liste blanche'), mot: w };
        utilises.push(w);
    }
    if (new Set(utilises).size !== utilises.length) return refus('mot répété');
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
