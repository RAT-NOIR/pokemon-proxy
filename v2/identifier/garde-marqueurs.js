'use strict';
// MARQUEURS P4 (CONTRAT-MARQUEURS.md §5) — deux règles de la route, chacune derrière SON drapeau, ÉTEINT par défaut (éteint : rien n'est lu, rien n'est calculé, la réponse est celle d'avant, octet pour octet) :
//   · V2_JUMBO_TITRE : une question dont les candidats sont EXACTEMENT un groupe { produit JUMBO, produit sans JUMBO } (même fiche, même visuel) devient un sûr du produit JUMBO quand le TITRE de l'annonce nomme un terme
//     de la liste fermée SANS négation dans les 3 mots qui précèdent. 🔴 On n'affirme JAMAIS la version normale sur l'absence du mot : sans terme, avec négation ou avec « taille normale », la question reste.
//   · V2_GARDE_MARQUEURS : un sûr dont le produit a, parmi les produits connus de la requête, un RIVAL DE GROUPE (même dessin, marqueurs différents) redevient la question d'avant — SAUF si le critère qui l'a affirmé est un
//     signal réel du marqueur qui les sépare (la lecture des marques pour un tampon, le titre pour le Jumbo). Un marqueur ne se lit JAMAIS dans l'image pour être posé (§5).
// Module PUR : ni base, ni réseau, ni modèle. La route lui prête ses outils (affirmer, marqueursDe, questionDeGroupe) ; il ne construit aucune réponse lui-même.
// 🔑 Écrit par ce qu'il AUTORISE : tout ce qui ne se prouve pas (version illisible, produit sans ligne, groupe de plus de deux pour le Jumbo, exception) laisse la réponse d'AVANT ; seul un groupe PROUVÉ ouvre une des deux règles.
const MQ = require('./marqueurs');

// ── Le titre : liste fermée, mot entier, insensible à la casse et aux accents.
const TERMES_JUMBO = Object.freeze(['jumbo', 'oversize', 'oversized', 'xxl', 'géant', 'geant', 'géante', 'geante']);
const NEGATIONS = Object.freeze(['pas', 'non', 'not', 'no', 'never', 'sans', 'without', 'ni', 'aucun', 'aucune', 'jamais']);       // + tout mot finissant par « n't » (isn't, aren't, doesn't…)
const FENETRE_NEGATION = 3, FENETRE_APRES = 2;                                              // les 3 mots qui précèdent le terme ET les 2 qui le suivent
const VERSION_NORMALE = Object.freeze(['normal', 'normale', 'standard', 'regular', 'classique', 'classic']);       // un titre qui cite la version normale (« taille normale », « normal size », « regular size » compris) ne tranche rien
const estNegation = m => NEGS.has(m) || m.endsWith('n\'t');
// Les mots d'un titre : l'apostrophe typographique devient droite ; un mot en « n't » est gardé entier (c'est une négation), toute autre apostrophe sépare (« l'oversize » → l, oversize).
const motsDe = t => (sansAccent(t).replace(/[’‘`]/g, '\'').match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) || []).flatMap(m => (m.endsWith('n\'t') ? [m] : m.split('\'')));
const sansAccent = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TERMES = new Set(TERMES_JUMBO.map(sansAccent)), NEGS = new Set(NEGATIONS.map(sansAccent));
const NORMALES = new Set(VERSION_NORMALE);
/** @returns { oui: boolean, terme?: string, motif: string } — oui SEULEMENT si un terme est présent et que NI sa fenêtre NI le titre ne nie ; le motif dit le silence. */
function lireTitreJumbo(titre) {
    if (typeof titre !== 'string' || !titre.trim()) return { oui: false, motif: 'pas de titre' };
    const t = motsDe(titre), trouves = [];
    t.forEach((m, i) => { if (TERMES.has(m)) trouves.push(i); });
    if (!trouves.length) return { oui: false, motif: 'aucun terme' };
    if (t.some(m => NORMALES.has(m))) return { oui: false, motif: 'version normale citée' };           // le titre compare ou cite les deux versions
    // écrit par ce qu'il AUTORISE : AUCUNE négation dans les 3 mots avant NI les 2 mots après, pour CHAQUE occurrence (une seule occurrence niée, ou citée avec un autre contexte, suffit à se taire)
    for (const i of trouves) if ([...t.slice(Math.max(0, i - FENETRE_NEGATION), i), ...t.slice(i + 1, i + 1 + FENETRE_APRES)].some(estNegation)) return { oui: false, motif: 'négation', terme: t[i] };
    return { oui: true, terme: t[trouves[0]], motif: 'terme sans négation' };
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
function parJumbo({ resultat, titre, corpsChaine, version, affirmer, marqueursDe, desaccordG, empreinteInfo }) {
    if (!resultat || resultat.issue !== 'question' || resultat.motif || resultat.contradiction) return null;
    if (desaccordG || (empreinteInfo && empreinteInfo.influence)) return null;             // deux sources en conflit ne donnent pas un sûr (comme SUR-PAR-IMAGE)
    const ids = idsDeLaQuestion(resultat, corpsChaine);
    if (!ids || ids.length !== 2 || !ids.every(Number.isInteger) || typeof affirmer !== 'function' || typeof marqueursDe !== 'function') return null;       // EXACTEMENT un groupe de deux
    const [a, b] = ids, ma = marqueursDe(a), mb = marqueursDe(b);
    if (estJumbo(ma) === estJumbo(mb)) return null;                                        // pas { Jumbo, sans Jumbo }
    const jumbo = estJumbo(ma) ? a : b, autre = jumbo === a ? b : a;
    if (!memeDessin(version, jumbo, autre)) return { trace: { regle: 'jumbo-titre', issue: 'se-tait', motif: 'pas le même dessin (fiche et visuel)', produit: jumbo } };
    const t = lireTitreJumbo(titre);
    if (!t.oui) return { trace: { regle: 'jumbo-titre', issue: 'se-tait', motif: t.motif, produit: jumbo } };
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
        if (!signalReel(resultat.critere, e)) bloquants.push(id);
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
function consulterMarqueurs({ cfg, titre, resultat, derniereQuestion = null, corpsChaine = null, desaccordG = null, empreinteInfo = null, produits, version, affirmer, marqueursDe, questionDeGroupe, journal = () => { } }) {
    if (!cfg || (cfg.jumboTitre !== true && cfg.gardeMarqueurs !== true)) return null;
    let courant = resultat, trace = null, remplace = false;
    if (cfg.jumboTitre === true) {
        try {
            const j = parJumbo({ resultat: courant, titre, corpsChaine, version, affirmer, marqueursDe, desaccordG, empreinteInfo });
            if (j) { trace = j.trace; if (j.resultat) { courant = j.resultat; remplace = true; } }
        } catch (e) { journal('jumbo par le titre', e); }
    }
    if (cfg.gardeMarqueurs === true && courant && courant.issue === 'affirmee') {
        try {
            const g = parGarde({ resultat: courant, produits, version, marqueursDe, derniereQuestion, questionDeGroupe });
            if (g) { trace = { ...(trace || {}), garde: g.trace }; if (g.resultat) { courant = g.resultat; remplace = true; } }
        } catch (e) {
            journal('garde des marqueurs', e);
            if (derniereQuestion && derniereQuestion.issue === 'question') { trace = { ...(trace || {}), garde: { regle: 'garde-marqueurs', issue: 'en-erreur', retour: 'question-d-avant' } }; courant = derniereQuestion; remplace = true; }
        }
    }
    return trace || remplace ? { ...(remplace ? { resultat: courant } : {}), trace } : null;
}

module.exports = { consulterMarqueurs, lireTitreJumbo, memeDessin, ecartMarqueurs, signalReel, critereJumbo, CRITERE_JUMBO, TERMES_JUMBO, NEGATIONS, VERSION_NORMALE, FENETRE_NEGATION, FENETRE_APRES };
