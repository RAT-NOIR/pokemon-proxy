'use strict';
// F1-TAMPON puis LOT TAMPONS — la DÉCISION de la route : lire les MARQUES (liste fermée, marques-tampon.js) pour trancher une question dont les candidats sont EXACTEMENT une paire « ensemble de marques / normale »
// séparée par l'étiquette. DERRIÈRE DEUX interrupteurs (V2_LECTURE_TAMPON ET V2_EMPREINTE_EXTENSION) et un fournisseur deps.lectureTampon. Éteint, rien n'est appelé, rien n'est noté : la réponse est celle d'avant, octet pour octet.
// Consultée APRÈS l'adaptateur et la seconde lecture, avant la règle G. Elle ne peut que PROMOUVOIR une question en affirmation du produit TAMPONNÉ quand la preuve est faite : deux lectures identiques d'un ensemble
// NON VIDE de marques de la liste, sans `autre`, EXACTEMENT celui de la variante prouvée du produit. Toute autre issue (rien lu, marque hors liste, ensemble différent, incertain, désaccord, panne, délai,
// plafond de dépense, deuxième passage, pas de carte valide) laisse la réponse d'AVANT, sans débit ni remboursement de plus. 🔴 Elle n'affirme JAMAIS la version normale : un tampon manqué n'est pas un tampon absent.
// Un JUMBO reste une question pour cette décision, qui ne lit aucun titre. La règle « jumbo par le titre », retirée le 18/10 faute de garde contre la négation, a été RÉTABLIE le 27/10 (décision de l'éditeur) AVEC cette garde,
// dans identifier/garde-marqueurs.js, derrière V2_JUMBO_TITRE (éteint par défaut) : elle seule lit un titre.
// UNE SEULE image : `entree.empreintes[i].carte`, la carte redressée que l'extension joint à son vecteur et que MODELE-VISUEL-API valide (carte-redressee.js : JPEG, 420 x 587, 200 Ko au plus). Pas de photo pleine,
// pas d'octets bruts, pas de géométrie, jamais un téléchargement. Une question sans carte valide ne déclenche rien (0 appel).
// La facturation est celle d'une affirmation (comme le critère A et la désignation).
const LT = require('./lecture-tampon');
const CR = require('./carte-redressee');
const MT = require('./marques-tampon');
const { statuts, lectureDe, CHAMPS } = require('./garde-contradiction');

const DELAI_TAMPON_MS = 20000;
/** Le critère journalisé de l'affirmation : le jeton de variante lu (la liste fermée), jamais un texte libre. */
const critereMarques = variante => `tampon (${variante}) : marques lues sur la carte redressée par deux essais indépendants, seule la version portant exactement ces marques de la paire est affirmée`;

const idsDeLaQuestion = resultat => { const c = resultat && resultat.analyse && Array.isArray(resultat.analyse.cartes) ? resultat.analyse.cartes[0] : null; return c && Array.isArray(c.candidats) ? c.candidats.map(x => x && x.idProduct) : []; };

/** Aucun champ lu sur la photo ne contredit le produit : la même définition que le critère A et la désignation (garde-contradiction.statuts). Une chaîne qui n'a rien lu (refus) ne contredit rien. */
function contredit(corps, ligne) {
    const lu = lectureDe(corps);
    if (!lu) return false;
    const s = statuts(lu, ligne);
    return CHAMPS.some(k => s[k] === 'ko');
}

/** Les OCTETS de la carte redressée validée (JPEG 420 x 587) de la première entrée d'`empreintes.entrees` qui en porte une ; null sinon. Ne lève jamais. */
async function carteValidee(entree) {
    try {
        const liste = entree && entree.empreintes && Array.isArray(entree.empreintes.entrees) ? entree.empreintes.entrees : [];       // entree.empreintes = { rejet, modele, entrees } (voisins-empreinte.lireEnveloppe)
        for (const e of liste) {
            if (!e || e.invalide === true || typeof e.carte !== 'string') continue;
            const v = await CR.valider(e.carte);                                     // la MÊME validation que la garde des zones ; la carte n'est pas gardée
            if (v.ok) return Buffer.from(e.carte, 'base64');
        }
    } catch { /* aucune carte */ }
    return null;
}

/**
 * @param affirmer  (idProduct, produitsSurcharge?, critere) => le résultat d'une AFFIRMATION de ce produit (adaptateur.affirmerParLaRoute), ou lève
 * @param avecBorne (fonction, ms, nom, code) => Promise : la borne de temps de la route
 * @returns null (pas le cas visé : rien d'appelé, rien de noté) | { resultat?, trace } — resultat : l'affirmation, SEULEMENT si la preuve est faite
 */
async function consulterLectureTampon({ deps, cfg, entree, scanId, resultat, corpsChaine, produits, version, affirmer, avecBorne, journal = () => { } }) {
    try {
        if (!(cfg && cfg.lectureTampon === true && cfg.empreinteExtension === true)) return null;     // les DEUX drapeaux
        const fournisseur = deps && typeof deps.lectureTampon === 'function' ? deps.lectureTampon : null;
        if (!fournisseur || !resultat) return null;
        if (resultat.issue === 'affirmee') return await prixDuTampon({ deps, fournisseur, entree, scanId, resultat, corpsChaine, produits, affirmer, avecBorne, journal });
        if (resultat.issue !== 'question' || resultat.motif || resultat.contradiction) return null;
        if (!version || version.colonneMarquages !== true || typeof version.entree !== 'function') return null;
        const c = corpsChaine && typeof corpsChaine === 'object' ? corpsChaine : null;
        if (!c || !(produits instanceof Map)) return null;
        const paire = LT.paireSeparee({ ids: idsDeLaQuestion(resultat), entree: id => version.entree(id), memeFiche: typeof version.memeFiche === 'function' ? (x, y) => version.memeFiche(x, y) : undefined });
        if (!paire.ok) return null;                                               // aucune autre question ne déclenche la lecture : 0 coût inutile
        if (!produits.has(paire.special) || !produits.has(paire.normale)) return null;
        const carte = await carteValidee(entree);
        if (!carte) return null;                                                  // pas de carte redressée valide : rien n'est lu, rien n'est noté
        if (contredit(c, produits.get(paire.special))) return { trace: { declenchee: false, appels: 0, issue: 'contredit', raison: 'un champ lu sur la photo contredit la version Staff de la paire' } };
        if (!LT.premiereFois(String(scanId))) return { trace: { declenchee: false, appels: 0, issue: 'deja-tentee', raison: 'ce scan a déjà eu sa lecture du tampon' } };
        LT.noter('declenchees');
        const lu = await lire({ fournisseur, deps, carte, scanId, corpsChaine: c, avecBorne, journal });
        // la trace (journal `analyses.lectureTampon`, jamais servie au client) dit ce qui a été LU et si les deux lectures concordent
        const trace = { declenchee: true, appels: lu.appels, type: paire.variante, marques: lu.marques, accord: lu.accord, issue: lu.issue, raison: lu.raison };
        if (lu.issue !== 'oui') return { trace };
        // l'ensemble lu doit être EXACTEMENT celui du produit spécial de la paire (sa variante prouvée) : sinon la question reste, jamais une affirmation d'un produit aux autres marques
        if (MT.jetonDeMarques(lu.marques) !== paire.variante) { LT.noter('nonConfirmees'); LT.noter('marquesSansProduit'); return { trace: { ...trace, issue: 'non-confirmee', raison: `les marques lues (${lu.marques.join('+')}) ne sont pas celles du produit tamponné de la paire (${paire.variante})` } }; }
        let aff = null;
        try { aff = affirmer(paire.special, undefined, critereMarques(paire.variante)); } catch (e) { journal('affirmation', e); }
        if (aff && aff.issue === 'affirmee') { LT.noter('affirmees'); return { resultat: aff, trace: { ...trace, issue: 'confirmee' } }; }
        LT.noter('nonConfirmees');
        return { trace: { ...trace, issue: 'non-confirmee', raison: 'l\'affirmation n\'a pas pu être construite' } };
    } catch (e) { journal('lecture du tampon', e); return null; }                  // une exception n'est jamais une affirmation : la réponse d'avant
}

/**
 * L'appel borné au fournisseur : { issue: 'oui'|'non-confirmee'|'echec'|'delai'|'sans-image'|'rien', appels, raison, marques, accord }. `oui` = deux essais lisent le même ensemble NON VIDE de marques de la liste (`marques`) ;
 * `accord` dit seulement si les essais concordent (au journal). Chaque appel TENTÉ est compté (le coût), qu'il ait réussi ou non.
 */
async function lire({ fournisseur, deps, carte, scanId, corpsChaine, avecBorne, journal }) {
    let appels = 0;
    const compteur = { get appels() { return appels; }, set appels(v) { if (Number.isInteger(v) && v > appels) { LT.noter('appels', v - appels); appels = v; } } };
    const abandon = new AbortController();
    let lu = null;
    try {
        const ms = Number.isFinite(deps && deps.delaiTamponMs) && deps.delaiTamponMs > 0 ? deps.delaiTamponMs : DELAI_TAMPON_MS;      // deps.delaiTamponMs : la surcharge des bancs
        lu = await avecBorne(() => fournisseur({ image: carte, corps: corpsChaine, scanId: String(scanId), compteur, signal: abandon.signal }), ms, 'lecture du tampon', 'TAMPON_DELAI');
    } catch (e) {
        const delai = e && e.code === 'TAMPON_DELAI';
        if (delai) abandon.abort(); else journal('lecture du tampon (fournisseur)', e);
        LT.noter('echecs');
        return { issue: delai ? 'delai' : 'echec', appels, raison: delai ? 'délai dépassé' : 'le fournisseur a levé', marques: [], accord: false };
    }
    if (!lu || typeof lu !== 'object') { LT.noter('nonConfirmees'); return { issue: 'rien', appels, raison: 'le fournisseur n\'a rien rendu', marques: [], accord: false }; }
    if (lu.sansImage === true) { LT.noter('nonFaisables'); return { issue: 'sans-image', appels, raison: 'aucun octet d\'image fourni : pas de lecture du tampon', marques: [], accord: false }; }
    if (lu.echec === true) { LT.noter('echecs'); return { issue: 'echec', appels, raison: String(lu.raison || 'échec de la lecture').slice(0, 200), marques: [], accord: false }; }
    if (!(Array.isArray(lu.essais) && lu.essais.length)) LT.noter('nonFaisables');
    // la décision se refait ICI sur les essais rendus : un fournisseur ne décide jamais à la place du module (ni l'ensemble de marques : c'est celui du module qui compte)
    const d = LT.decider({ essais: Array.isArray(lu.essais) ? lu.essais : [] });
    const accord = d.lecture !== 'desaccord' && Array.isArray(lu.essais) && lu.essais.length >= 2;
    if (d.sur && lu.lecture === 'marques') return { issue: 'oui', appels, raison: d.raison, marques: d.marques, accord };
    LT.noter('nonConfirmees');
    return { issue: 'non-confirmee', appels, raison: d.sur ? 'le fournisseur n\'a pas conclu' : `${d.lecture} : ${d.raison}`, marques: [], accord };
}

/**
 * Règle 2 des prix (F4) : une fiche à produit UNIQUE marquée `prixMelangeTampon`, déjà affirmée. Un ensemble NON VIDE de marques de la liste lu deux fois à l'identique (la photo montre un tampon) => la mention
 * « version tamponnée : le prix Cardmarket sous-estime sa valeur » remplace la règle 3. Le verdict ne change pas (même idProduct) ; seule la mention change. TOUR 1 (I3) : la mention exige la MÊME preuve qu'un sûr — l'ensemble lu est exactement la
 * variante prouvée d'un produit de la fiche ; sinon aucune mention (la règle 3 reste). Sans la lecture, rien ne bouge.
 */
async function prixDuTampon({ deps, fournisseur, entree, scanId, resultat, corpsChaine, produits, affirmer, avecBorne, journal }) {
    if (!(produits instanceof Map)) return null;
    const c0 = resultat.analyse && Array.isArray(resultat.analyse.cartes) ? resultat.analyse.cartes[0] : null;
    const id = c0 && c0.carte ? c0.carte.idProduct : null;
    const ligne = Number.isInteger(id) ? produits.get(id) : null;
    if (!ligne || ligne.prixMelangeTampon !== true) return null;                   // === true seulement
    const carte = await carteValidee(entree);
    if (!carte) return null;
    if (!LT.premiereFois(String(scanId))) return { trace: { declenchee: false, appels: 0, issue: 'deja-tentee', raison: 'ce scan a déjà eu sa lecture du tampon' } };
    LT.noter('declenchees');
    const lu = await lire({ fournisseur, deps, carte, scanId, corpsChaine, avecBorne, journal });
    const trace = { declenchee: true, appels: lu.appels, type: 'prix', marques: lu.marques, accord: lu.accord, issue: lu.issue, raison: lu.raison };
    if (lu.issue !== 'oui') return { trace };
    // I3 (tour 1) : la MÊME preuve qu'un sûr — l'ensemble lu doit être EXACTEMENT une variante PROUVÉE d'un produit de la fiche (le produit lui-même ou une impression de sa métacarte). Sinon aucune mention :
    // un faux positif de lecture (brillant holo lu « cosmo », logo imprimé sur toutes les copies) n'affiche jamais « version tamponnée ».
    const jeton = MT.jetonDeMarques(lu.marques);
    const prouvees = [ligne.marques, ...(Array.isArray(ligne.impressions) ? ligne.impressions.map(i => i && i.marques) : [])].filter(m => Array.isArray(m) && m.length).map(m => MT.jetonDeMarques(m));
    if (jeton === null || !prouvees.includes(jeton)) { LT.noter('nonConfirmees'); LT.noter('marquesSansProduit'); return { trace: { ...trace, issue: 'non-confirmee', raison: `les marques lues (${lu.marques.join('+')}) ne sont une variante prouvée d'aucun produit de la fiche : aucune mention` } }; }
    const marquee = { ...ligne, tamponLu: true, impressions: Array.isArray(ligne.impressions) ? ligne.impressions.map(i => (i && i.idProduct === id ? { ...i, tamponLu: true } : i)) : ligne.impressions };
    const surcharge = new Map(produits); surcharge.set(id, marquee);
    let aff = null;
    try { aff = affirmer(id, surcharge, resultat.critere || null); } catch (e) { journal('mention du tampon', e); }
    if (aff && aff.issue === 'affirmee' && aff.analyse.cartes[0].carte && aff.analyse.cartes[0].carte.idProduct === id) { LT.noter('affirmees'); return { resultat: aff, trace: { ...trace, issue: 'confirmee' } }; }
    LT.noter('nonConfirmees');
    return { trace: { ...trace, issue: 'non-confirmee', raison: 'la mention n\'a pas pu être construite' } };
}

module.exports = { consulterLectureTampon, carteValidee, DELAI_TAMPON_MS, critereMarques };
