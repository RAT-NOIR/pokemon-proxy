'use strict';
// F1-TAMPON — la DÉCISION de la route : lire le tampon STAFF (ou le contexte « jumbo » du titre) pour trancher une question dont les candidats sont EXACTEMENT une paire séparée par l'étiquette.
// DERRIÈRE son interrupteur (V2_LECTURE_TAMPON ET un fournisseur deps.lectureTampon ; le jumbo en plus V2_LECTURE_TAMPON_JUMBO). Éteint, rien n'est appelé, rien n'est noté : la réponse est celle d'avant, octet pour octet.
// Consultée APRÈS l'adaptateur et la seconde lecture, avant la règle G. Elle ne peut que PROMOUVOIR une question en affirmation du produit STAFF (ou jumbo) quand la preuve est faite ; toute autre issue (non, incertain,
// désaccord, panne, délai, deuxième passage, pas d'octets) laisse la réponse d'AVANT, sans débit ni remboursement de plus. 🔴 Elle n'affirme JAMAIS la version normale : un tampon manqué n'est pas un tampon absent.
// La facturation est celle d'une affirmation (comme le critère A et la désignation) : la route règle la question réservée par la chaîne comme une réponse par ce candidat.
// Aucun téléchargement : les OCTETS viennent de l'appelant (entree.imageOctets : la carte redressée que l'extension envoie, ou la photo avec sa géométrie), jamais d'une URL.
const LT = require('./lecture-tampon');
const { statuts, lectureDe, CHAMPS } = require('./garde-contradiction');

const DELAI_TAMPON_MS = 20000;
const CRITERE_STAFF = 'tampon (staff) : STAFF lu sur la photo par deux essais indépendants, seule la version Staff de la paire est affirmée';
const CRITERE_JUMBO = 'tampon (jumbo) : le titre de l\'annonce nomme une carte jumbo, seule la version jumbo de la paire est affirmée';

const idsDeLaQuestion = resultat => { const c = resultat && resultat.analyse && Array.isArray(resultat.analyse.cartes) ? resultat.analyse.cartes[0] : null; return c && Array.isArray(c.candidats) ? c.candidats.map(x => x && x.idProduct) : []; };

/** Aucun champ lu sur la photo ne contredit le produit : la même définition que le critère A et la désignation (garde-contradiction.statuts). Une chaîne qui n'a rien lu (refus) ne contredit rien. */
function contredit(corps, ligne) {
    const lu = lectureDe(corps);
    if (!lu) return false;
    const s = statuts(lu, ligne);
    return CHAMPS.some(k => s[k] === 'ko');
}

/**
 * @param affirmer  (idProduct, produitsSurcharge?, critere) => le résultat d'une AFFIRMATION de ce produit (adaptateur.affirmerParLaRoute), ou lève
 * @param avecBorne (fonction, ms, nom, code) => Promise : la borne de temps de la route
 * @returns null (pas le cas visé : rien d'appelé, rien de noté) | { resultat?, trace } — resultat : l'affirmation, SEULEMENT si la preuve est faite
 */
async function consulterLectureTampon({ deps, cfg, entree, scanId, resultat, corpsChaine, produits, version, titre, affirmer, avecBorne, journal = () => { } }) {
    try {
        if (!(cfg && cfg.lectureTampon === true)) return null;
        const fournisseur = deps && typeof deps.lectureTampon === 'function' ? deps.lectureTampon : null;
        const jumboPermis = cfg.lectureTamponJumbo === true;
        if (!fournisseur && !jumboPermis) return null;
        if (!resultat) return null;
        if (resultat.issue === 'affirmee') return await prixDuTampon({ deps, fournisseur, entree, scanId, resultat, corpsChaine, produits, affirmer, avecBorne, journal });
        if (resultat.issue !== 'question' || resultat.motif || resultat.contradiction) return null;
        if (!version || version.colonneMarquages !== true || typeof version.entree !== 'function') return null;
        const c = corpsChaine && typeof corpsChaine === 'object' ? corpsChaine : null;
        if (!c || !(produits instanceof Map)) return null;
        const paire = LT.paireSeparee({ ids: idsDeLaQuestion(resultat), entree: id => version.entree(id) });
        if (!paire.ok) return null;                                               // aucune autre question ne déclenche la lecture : 0 coût inutile
        if (paire.type === 'jumbo' ? !jumboPermis : !fournisseur) return null;
        if (!produits.has(paire.special) || !produits.has(paire.normale)) return null;
        if (contredit(c, produits.get(paire.special))) return { trace: { declenchee: false, appels: 0, issue: 'contredit', raison: 'un champ lu sur la photo contredit la version spéciale de la paire' } };
        if (!LT.premiereFois(String(scanId))) return { trace: { declenchee: false, appels: 0, issue: 'deja-tentee', raison: 'ce scan a déjà eu sa lecture du tampon' } };
        LT.noter('declenchees');
        if (paire.type === 'jumbo') {                                             // le contexte du titre : AUCUN appel au modèle, la liste fermée de mots entiers
            const trace = { declenchee: true, appels: 0, type: 'jumbo', issue: null, raison: null };
            if (!LT.titreJumbo(titre)) { LT.noter('nonConfirmees'); return { trace: { ...trace, issue: 'non-confirmee', raison: 'le titre ne nomme pas une carte jumbo' } }; }
            const aff = affirmer(paire.special, undefined, CRITERE_JUMBO);
            if (aff && aff.issue === 'affirmee') { LT.noter('jumbo'); return { resultat: aff, trace: { ...trace, issue: 'confirmee', raison: 'titre jumbo + paire jumbo / normale' } }; }
            LT.noter('nonConfirmees'); return { trace: { ...trace, issue: 'non-confirmee', raison: 'l\'affirmation n\'a pas pu être construite' } };
        }
        const lu = await lire({ fournisseur, deps, entree, scanId, corpsChaine: c, avecBorne, journal });
        const trace = { declenchee: true, appels: lu.appels, type: 'staff', issue: lu.issue, raison: lu.raison };
        if (lu.issue !== 'oui') return { trace };
        let aff = null;
        try { aff = affirmer(paire.special, undefined, CRITERE_STAFF); } catch (e) { journal('affirmation', e); }
        if (aff && aff.issue === 'affirmee') { LT.noter('affirmees'); return { resultat: aff, trace: { ...trace, issue: 'confirmee' } }; }
        LT.noter('nonConfirmees');
        return { trace: { ...trace, issue: 'non-confirmee', raison: 'l\'affirmation n\'a pas pu être construite' } };
    } catch (e) { journal('lecture du tampon', e); return null; }                  // une exception n'est jamais une affirmation : la réponse d'avant
}

/** L'appel borné au fournisseur : { issue: 'oui'|'non-confirmee'|'echec'|'delai'|'sans-image', appels, raison }. Chaque appel TENTÉ est compté (le coût), qu'il ait réussi ou non. */
async function lire({ fournisseur, deps, entree, scanId, corpsChaine, avecBorne, journal }) {
    let appels = 0;
    const compteur = { get appels() { return appels; }, set appels(v) { if (Number.isInteger(v) && v > appels) { LT.noter('appels', v - appels); appels = v; } } };
    const abandon = new AbortController();
    let lu = null;
    try {
        const ms = Number.isFinite(deps && deps.delaiTamponMs) && deps.delaiTamponMs > 0 ? deps.delaiTamponMs : DELAI_TAMPON_MS;      // deps.delaiTamponMs : la surcharge des bancs
        lu = await avecBorne(() => fournisseur({ image: entree && entree.imageOctets, corps: corpsChaine, scanId: String(scanId), compteur, signal: abandon.signal }), ms, 'lecture du tampon', 'TAMPON_DELAI');
    } catch (e) {
        const delai = e && e.code === 'TAMPON_DELAI';
        if (delai) abandon.abort(); else journal('lecture du tampon (fournisseur)', e);
        LT.noter('echecs');
        return { issue: delai ? 'delai' : 'echec', appels, raison: delai ? 'délai dépassé' : 'le fournisseur a levé' };
    }
    if (!lu || typeof lu !== 'object') { LT.noter('nonConfirmees'); return { issue: 'rien', appels, raison: 'le fournisseur n\'a rien rendu' }; }
    if (lu.sansImage === true) { LT.noter('nonFaisables'); return { issue: 'sans-image', appels, raison: 'aucun octet d\'image fourni : pas de lecture du tampon' }; }
    if (lu.echec === true) { LT.noter('echecs'); return { issue: 'echec', appels, raison: String(lu.raison || 'échec de la lecture').slice(0, 200) }; }
    if (!(Array.isArray(lu.essais) && lu.essais.length)) LT.noter('nonFaisables');
    // la décision se refait ICI sur les essais rendus : un fournisseur ne décide jamais à la place du module
    const d = LT.decider({ essais: Array.isArray(lu.essais) ? lu.essais : [] });
    if (d.staff && lu.lecture === 'oui') return { issue: 'oui', appels, raison: d.raison };
    LT.noter('nonConfirmees');
    return { issue: 'non-confirmee', appels, raison: d.staff ? 'le fournisseur n\'a pas conclu' : `${d.lecture} : ${d.raison}` };
}

/**
 * Règle 2 des prix (F4) : une fiche à produit UNIQUE marquée `prixMelangeTampon`, déjà affirmée. STAFF lu deux fois => la mention « version tamponnée : le prix Cardmarket sous-estime sa valeur » remplace la règle 3.
 * Le verdict ne change pas (même idProduct) ; seule la mention change. Sans la lecture, rien ne bouge (la règle 3 reste). INERTE tant que le catalogue ne marque aucune fiche.
 */
async function prixDuTampon({ deps, fournisseur, entree, scanId, resultat, corpsChaine, produits, affirmer, avecBorne, journal }) {
    if (!fournisseur || !(produits instanceof Map)) return null;
    const c0 = resultat.analyse && Array.isArray(resultat.analyse.cartes) ? resultat.analyse.cartes[0] : null;
    const id = c0 && c0.carte ? c0.carte.idProduct : null;
    const ligne = Number.isInteger(id) ? produits.get(id) : null;
    if (!ligne || ligne.prixMelangeTampon !== true) return null;                   // === true seulement
    if (!LT.premiereFois(String(scanId))) return { trace: { declenchee: false, appels: 0, issue: 'deja-tentee', raison: 'ce scan a déjà eu sa lecture du tampon' } };
    LT.noter('declenchees');
    const lu = await lire({ fournisseur, deps, entree, scanId, corpsChaine, avecBorne, journal });
    const trace = { declenchee: true, appels: lu.appels, type: 'prix', issue: lu.issue, raison: lu.raison };
    if (lu.issue !== 'oui') return { trace };
    const marquee = { ...ligne, tamponStaffLu: true, impressions: Array.isArray(ligne.impressions) ? ligne.impressions.map(i => (i && i.idProduct === id ? { ...i, tamponStaffLu: true } : i)) : ligne.impressions };
    const surcharge = new Map(produits); surcharge.set(id, marquee);
    let aff = null;
    try { aff = affirmer(id, surcharge, resultat.critere || null); } catch (e) { journal('mention du tampon', e); }
    if (aff && aff.issue === 'affirmee' && aff.analyse.cartes[0].carte && aff.analyse.cartes[0].carte.idProduct === id) { LT.noter('affirmees'); return { resultat: aff, trace: { ...trace, issue: 'confirmee' } }; }
    LT.noter('nonConfirmees');
    return { trace: { ...trace, issue: 'non-confirmee', raison: 'la mention n\'a pas pu être construite' } };
}

module.exports = { consulterLectureTampon, DELAI_TAMPON_MS, CRITERE_STAFF, CRITERE_JUMBO };
