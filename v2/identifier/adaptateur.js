'use strict';
// B1a.3 — l'adaptateur : la sortie héritée de /api/identifier devient UNE des trois issues du contrat 2, ou une PANNE.
// Écrit par ce qu'il AUTORISE : seules les lignes de la table ci-dessous produisent autre chose qu'une panne SERVEUR.
// Une panne n'est JAMAIS un « introuvable » (CLAUDE.md, clause 3 des refus d'absence, index.js:3576).
// Module PUR : aucune base, aucun réseau. Les lignes de catalogue sont lues par B1b AVANT l'appel (ctx.produits).
//
// FORME D'APPEL EXACTE (à fournir par B1b) : adapter({ statutHttp, corps }, ctx) avec
//   ctx.produits          Map<idProduct, ligne de catalogue> : le gagnant ET TOUS les candidats possibles, sinon panne SERVEUR ;
//   ctx.langueInterface   'fr' | 'en' (autre : anglais) ;  ctx.cfg  la config v2 ;
//   ctx.ficheServie       booléen d'ENTRÉE (le site sert /fr/p/<idProduct> ?) : vrai => liens.fiche renseigné, sinon null ;
//   ctx.candidatsDeRefus  [{ idProduct }] : les 2 ou 3 produits EN ÉGALITÉ, capturés par B1b depuis le vivier. Utile pour
//                         nom-contredit-egalite, dont le corps réel (index.js:4861-4876) n'en porte PAS ; egalite-parfaite en porte
//                         (index.js:5127). L'UNION corps + ctx donne : 2 ou 3 candidats distincts => question de départage ; UN SEUL => (UN-CANDIDAT, D1)
//                         la question « est-ce cette carte ? », après la garde des jumeaux (candidatUnique) ; plus de 3 : jamais tronqué => introuvable
//                         « photo-illisible » (nom-contredit-*) ; aucun => « photo-illisible » ou « hors-catalogue » (egalite-parfaite).
//                         nom-contredit-sans-repli IGNORE ces candidats : pas d'égalité (r.scores vide, index.js:4840), toujours introuvable « photo-illisible ».
//   ctx.jumeaux           JUMEAU-V2 : (idProduct) => { conclu, ids } — les jumeaux du produit (jumeaux.js). ABSENT ou qui ne conclut pas : AUCUNE affirmation (introuvable, motif distinct
//                         rendu en `motif` à la racine du résultat, jamais dans le contrat public) ; le contexte doit aussi porter dans ctx.produits les lignes des jumeaux.
const { construireProduit } = require('./produit');
const { construireQuestion } = require('./questions');
const { choixPour } = require('../choix');
const { garde, candidatUniqueDe, noter } = require('./jumeaux');
const { choisirTrois } = require('./jumeaux-nombreux');
const { garderCompatibles } = require('./nom-compatible');

const ETATS = Object.freeze(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
const CONFIANCES = Object.freeze(['haute', 'moyenne', 'basse']);
const MOTIFS_ILLISIBLE = Object.freeze(['numero-illisible', 'ia-sans-lecture']);       // `ia-sans-lecture` (FREIN-CONSTATES tour 3) : la lecture n'a rien rendu d'exploitable (photo sans carte…) — un introuvable « photo-illisible », jamais une panne IA
const MOTIFS_ABSENCE = Object.freeze(['carte-introuvable', 'aucun-candidat', 'aucun-prix']);
const MOTIFS_EGALITE = Object.freeze(['egalite-parfaite', 'nom-contredit-egalite', 'nom-contredit-sans-repli']);
const CODE_CHINOIS = 6;

class Panne extends Error { constructor(code, diagnostic, motif = null) { super(diagnostic); this.code = code; this.motif = motif; } }
const panne = (code, diagnostic, motif) => { throw new Panne(code, diagnostic, motif); };

const etatValide = x => (ETATS.includes(x) ? x : null);
function etatDe(e) {
    const o = e && typeof e === 'object' ? e : {};
    const defauts = (Array.isArray(o.defautsVus) ? o.defautsVus : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 10).map(x => x.slice(0, 200));
    return { estime: etatValide(o.estimeIA), confiance: CONFIANCES.includes(o.confianceIA) ? o.confianceIA : null, defauts,
             declare: typeof o.declareVendeur === 'string' && o.declareVendeur.trim() ? o.declareVendeur.slice(0, 200) : null, retenu: etatValide(o.retenu) };
}
function codeLangueDe(corps) {
    const c = corps.codeLangue ?? (corps.carte && corps.carte.codeLangue);
    return Number.isInteger(c) && c >= 1 && c <= 10 ? c : null;
}
function prixLiveDe(corps, idProduct, etat) {
    const cl = codeLangueDe(corps);
    if (cl === null) return null;                                       // pas de langue lue : l'extension ne lit rien, on n'invente pas
    return { idProduct, langues: cl === CODE_CHINOIS ? [6, 11] : [cl], reverseHolo: Boolean(corps.reverse && corps.reverse.strategie === 'filtre-url'), etatVise: etat.retenu };
}
function source(ctx, id) {
    const s = ctx.produits instanceof Map ? ctx.produits.get(id) : undefined;
    if (!s) panne('SERVEUR', `idProduct ${id} absent de ctx.produits`);
    return s;
}
const pctx = ctx => ({ langueInterface: ctx.langueInterface, ficheServie: ctx.ficheServie, cfg: ctx.cfg });
const entiers = xs => [...new Set((Array.isArray(xs) ? xs : []).map(c => c && c.idProduct).filter(Number.isInteger))];

function carte(statut, o) {
    return { index: 0, statut, carte: null, candidats: [], question: null, raison: null, etat: null, prixLive: null, zone: null, ...o };
}
function enveloppe(issue, c, extra = {}) {
    return { issue, analyse: { statut: c.statut, cartes: [c], lot: null, raison: c.statut === 'introuvable' ? c.raison : null }, ...extra };
}
// Liste FERMÉE des raisons d'un « introuvable » (PLAN §2) : le contrat publié (v2/openapi) la compare à celle-ci, ensemble pour ensemble.
// L'adaptateur n'en émet que deux ; les trois autres sont posées par B1b (en amont de la chaîne héritée). Une raison hors liste lève.
const RAISONS = Object.freeze(['photo-illisible', 'pas-une-carte', 'hors-catalogue', 'plusieurs-cartes-non-separees', 'panne-lecture', 'impression-indeterminee']);
function introuvable(raison) {
    if (!RAISONS.includes(raison)) throw new Error(`adaptateur : raison d'introuvable hors liste : ${raison}`);
    return enveloppe('introuvable', carte('introuvable', { raison }));
}

function question(ids, etat, ctx) {
    const premiers = ids.slice(0, 3);                                    // l'ordre du classement n'est pas servi : on ne garde que le rang pour couper
    const ordre = choixPour(premiers).map(c => c.idProduct);             // puis ordre idProduct, jamais celui du classement
    const cands = ordre.map(id => construireProduit(source(ctx, id), pctx(ctx)));
    const q = construireQuestion(cands, { langueInterface: ctx.langueInterface });
    return enveloppe('question', carte('a-trancher', { candidats: cands, question: q, etat }), { question: q });
}

// JUMEAU-V2 + UN-CANDIDAT : ce que dit la garde des jumeaux pour un produit P. `affirmer` rend null (l'appelant décide : affirmer P, ou lui poser la question de confirmation) ;
// tout le reste est une SORTIE : question de départage (P et ses jumeaux ; plus de 3 produits : 3 d'entre eux, jumeaux-nombreux.js), introuvable `impression-indeterminee` (repli : une ligne de catalogue d'un jumeau manque), ou PANNE INDISPONIBLE (jamais ni question ni affirmation).
function apresGarde(g, etat, ctx, corps) {
    if (g.action === 'affirmer') return null;
    if (g.action === 'question') return question(g.ids, etat, ctx);
    if (g.action === 'nombreux') {
        // JUMEAUX-QUESTION : plus de 3 produits => une QUESTION à 3 (P d'abord, puis l'ordre nommé de jumeaux-nombreux.js), jamais une affirmation. Une ligne de catalogue manquante : le repli d'avant.
        const trois = choisirTrois({ p: g.ids[0], jumeaux: g.ids.slice(1), corps, produits: ctx.produits });
        // TOUR 1 : le filtre de nom vaut pour P aussi. Aucun candidat ne reste => introuvable photo-illisible (la règle du lot CONFIRMATION-SURE : tous contredits, on ne sait pas) ;
        // UN seul reste, ou une ligne manque => le repli d'avant (jamais une confirmation à 1 candidat dans cette voie) ; 2 ou plus => la question. Seul le repli écrit au journal.
        if (trois && trois.length === 0) return introuvable('photo-illisible');
        if (trois && trois.length >= 2) return question(trois, etat, ctx);
        noter('jumeaux-trop-nombreux', g.ids[0], trois ? '(un seul candidat compatible)' : '(lignes de catalogue incomplètes)');
        return { ...introuvable('impression-indeterminee'), motif: 'jumeaux-trop-nombreux' };
    }
    if (g.action === 'introuvable') return { ...introuvable('impression-indeterminee'), motif: g.motif };     // la carte est reconnue, son impression ne se tranche pas (plus de 3 produits) : on ne ment pas par « photo-illisible »
    return panne('INDISPONIBLE', `jumeaux : ${g.motif || 'indisponibles'}`, g.motif || 'jumeaux-indisponibles');     // notre infrastructure (colonne absente, périmée, incomplète), jamais un introuvable
}
// UN candidat non affirmé P : la source de P est lue d'abord (absent du catalogue de l'API : panne SERVEUR, on n'invente pas), puis la garde ; sans jumeau, une question à UN choix.
function candidatUnique(idProduct, etat, ctx, corps) {
    source(ctx, idProduct);
    return apresGarde(garde(ctx, idProduct), etat, ctx, corps) || question([idProduct], etat, ctx);
}

function traduire(statutHttp, corps, ctx) {
    if (statutHttp !== 200) panne('SERVEUR', `statut HTTP ${statutHttp}`);
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) panne('SERVEUR', 'corps illisible');
    if (corps.success === true) {
        const c = corps.carte;
        if (!c || typeof c !== 'object' || typeof c.ambigu !== 'boolean') panne('SERVEUR', 'succès sans carte.ambigu booléen');
        const etat = etatDe(corps.etat);
        if (c.ambigu === false) {
            if (!Number.isInteger(c.idProduct)) panne('SERVEUR', 'identifiée sans idProduct');
            const premier = entiers(corps.candidats)[0];
            if (premier !== undefined && premier !== c.idProduct) panne('SERVEUR', `carte.idProduct ${c.idProduct} != candidats[0] ${premier}`);
            // JUMEAU-V2 : P n'est affirmé que s'il n'a AUCUN jumeau (jumeaux.js : un seul chemin mène à « affirmer »). Sinon une question de départage entre P et ses jumeaux,
            // ou un introuvable au motif distinct. La source de P est lue d'abord : un P absent du catalogue de l'API reste la panne SERVEUR d'avant.
            const sourceP = source(ctx, c.idProduct);
            const refusGarde = apresGarde(garde(ctx, c.idProduct), etat, ctx, corps);
            if (refusGarde) return refusGarde;
            const produit = construireProduit(sourceP, pctx(ctx));
            return enveloppe('affirmee', carte('identifiee', { carte: produit, etat, prixLive: prixLiveDe(corps, c.idProduct, etat) }));
        }
        // CONFIRMATION-SURE : un candidat dont le nom est CONTREDIT par le nom lu n'est jamais montré (nom-compatible.js) ; il est retiré AVANT la construction de la question.
        const ids = garderCompatibles(entiers(corps.candidats), corps, ctx.produits);
        // UN-CANDIDAT (D1, 2026-10-13) : un seul candidat n'est plus un introuvable (ancien §5 Q32) — « ce qui n'est pas affirmé devient une question ». Il passe par la garde des
        // jumeaux (comme une affirmation) : sans jumeau, la question « est-ce cette carte ? » ; avec jumeaux, la question de départage ; trop de jumeaux, impression-indeterminee.
        const unique = candidatUniqueDe({ ...corps, candidats: ids.map(idProduct => ({ idProduct })) });
        if (unique !== null) return candidatUnique(unique, etat, ctx, corps);
        if (ids.length < 2) return introuvable('photo-illisible');       // aucun candidat : on ne sait rien
        return question(ids, etat, ctx);
    }
    if (corps.success !== false) panne('SERVEUR', 'success ni vrai ni faux');
    const { natureRefus: nature, motifRefus: motif } = corps;
    if (nature === 'refus-delibere') {
        if (MOTIFS_ILLISIBLE.includes(motif)) return introuvable('photo-illisible');
        if (MOTIFS_ABSENCE.includes(motif)) return introuvable('hors-catalogue');
        if (MOTIFS_EGALITE.includes(motif)) {
            // sans-repli : r.scores est VIDE (index.js:4840), il n'y a aucune égalité ; des « candidats » seraient ceux que le nom a déjà
            // contredits, et répondre débiterait l'utilisateur : jamais une question. La lecture est contredite, on ne sait pas.
            if (motif === 'nom-contredit-sans-repli') return introuvable('photo-illisible');
            // Candidats : ceux du corps (egalite-parfaite : index.js:5127), complétés par ctx.candidatsDeRefus. Une question exige 2 ou 3
            // candidats DISTINCTS dans l'UNION ; plus de 3 ne se tronque pas en silence ; un seul ne fait pas une question à choix.
            const brute = [...new Set([...entiers(corps.candidats), ...entiers(ctx.candidatsDeRefus)])];
            const union = garderCompatibles(brute, corps, ctx.produits);           // CONFIRMATION-SURE : les candidats que le nom lu contredit sont retirés d'abord
            if (brute.length > 0 && union.length === 0) return introuvable('photo-illisible');     // tous contredits : on ne sait pas, jamais une absence affirmée (« hors-catalogue »)
            if (union.length === 1) return candidatUnique(union[0], etatDe(corps.etat), ctx, corps);     // UN-CANDIDAT (D1) : la même règle que l'ambiguë à un candidat (sans-repli est sorti plus haut : le nom CONTREDIT)
            if (union.length >= 2 && union.length <= 3) return question(union, etatDe(corps.etat), ctx);
            if (union.length > 3 || motif !== 'egalite-parfaite') return introuvable('photo-illisible');   // on ne sait pas : pas d'absence affirmée
            return introuvable('hors-catalogue');
        }
        panne('SERVEUR', `motif de refus délibéré inconnu : ${motif}`);
    }
    if (nature === 'echec-technique') {
        if (motif === 'ia-echec') panne('IA', motif);
        if (motif === 'tcgdex-injoignable' || MOTIFS_ABSENCE.slice(0, 2).includes(motif)) panne('INDISPONIBLE', `${motif} (absence requalifiée ou source tombée)`);
        if (motif === 'depense-modele-plafond') panne('INDISPONIBLE', motif);          // le plafond de dépense du modèle atteint PENDANT le scan : notre limite, la même panne que la coupure en amont
        if (motif === 'erreur-serveur') panne('SERVEUR', motif);
        panne('SERVEUR', `motif technique inconnu : ${motif}`);
    }
    return panne('SERVEUR', `natureRefus inconnue : ${nature}`);
}

/** @returns { issue: 'affirmee'|'question'|'introuvable'|'panne', analyse, erreur?, question?, diagnostic? } */
function adapter({ statutHttp, corps } = {}, ctx = {}) {
    try {
        return traduire(statutHttp, corps, ctx);
    } catch (e) {
        const code = e instanceof Panne ? e.code : 'SERVEUR';           // un cas non prévu tombe sur le défaut qui n'affirme rien
        const diagnostic = e instanceof Panne ? e.message : `exception : ${(e && (e.code || e.name)) || 'erreur'}`;   // jamais le message d'une exception interne (seule une Panne, phrase fabriquée ici, est dite en entier)
        console.warn(`⚠️ [adaptateur-v2] panne ${code} : ${diagnostic}`);
        return { issue: 'panne', analyse: null, erreur: { code }, diagnostic, ...(e instanceof Panne && e.motif ? { motif: e.motif } : {}) };
    }
}
// codeLangueDe / prixLiveDe : exportés pour que /api/identifier/reponse (B1b.5) fabrique le prixLive d'une carte tranchée par la MÊME règle que l'adaptateur (§21 bis : jamais une copie).
module.exports = { adapter, RAISONS, codeLangueDe, prixLiveDe };
