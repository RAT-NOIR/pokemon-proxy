'use strict';
// F1-TAMPON — la DÉCISION de la route : lire le tampon STAFF pour trancher une question dont les candidats sont EXACTEMENT une paire staff / normale séparée par l'étiquette.
// DERRIÈRE DEUX interrupteurs (V2_LECTURE_TAMPON ET V2_EMPREINTE_EXTENSION) et un fournisseur deps.lectureTampon. Éteint, rien n'est appelé, rien n'est noté : la réponse est celle d'avant, octet pour octet.
// Consultée APRÈS l'adaptateur et la seconde lecture, avant la règle G. Elle ne peut que PROMOUVOIR une question en affirmation du produit STAFF quand la preuve est faite ; toute autre issue (non, incertain,
// désaccord, panne, délai, plafond de dépense, deuxième passage, pas de carte valide) laisse la réponse d'AVANT, sans débit ni remboursement de plus. 🔴 Elle n'affirme JAMAIS la version normale : un tampon manqué
// n'est pas un tampon absent. Un JUMBO reste une question (la règle « jumbo par le titre » est RETIRÉE : elle ne se défend pas contre la négation).
// UNE SEULE image : `entree.empreintes[i].carte`, la carte redressée que l'extension joint à son vecteur et que MODELE-VISUEL-API valide (carte-redressee.js : JPEG, 420 x 587, 200 Ko au plus). Pas de photo pleine,
// pas d'octets bruts, pas de géométrie, jamais un téléchargement. Une question sans carte valide ne déclenche rien (0 appel).
// La facturation est celle d'une affirmation (comme le critère A et la désignation).
const LT = require('./lecture-tampon');
const CR = require('./carte-redressee');
const { statuts, lectureDe, CHAMPS } = require('./garde-contradiction');

const DELAI_TAMPON_MS = 20000;
const CRITERE_STAFF = 'tampon (staff) : STAFF lu sur la carte redressée par deux essais indépendants, seule la version Staff de la paire est affirmée';

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
        const paire = LT.paireSeparee({ ids: idsDeLaQuestion(resultat), entree: id => version.entree(id) });
        if (!paire.ok) return null;                                               // aucune autre question ne déclenche la lecture : 0 coût inutile
        if (!produits.has(paire.special) || !produits.has(paire.normale)) return null;
        const carte = await carteValidee(entree);
        if (!carte) return null;                                                  // pas de carte redressée valide : rien n'est lu, rien n'est noté
        if (contredit(c, produits.get(paire.special))) return { trace: { declenchee: false, appels: 0, issue: 'contredit', raison: 'un champ lu sur la photo contredit la version Staff de la paire' } };
        if (!LT.premiereFois(String(scanId))) return { trace: { declenchee: false, appels: 0, issue: 'deja-tentee', raison: 'ce scan a déjà eu sa lecture du tampon' } };
        LT.noter('declenchees');
        const lu = await lire({ fournisseur, deps, carte, scanId, corpsChaine: c, avecBorne, journal });
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

module.exports = { consulterLectureTampon, carteValidee, DELAI_TAMPON_MS, CRITERE_STAFF };
