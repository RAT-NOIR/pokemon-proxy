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
//                         (index.js:5127). L'UNION corps + ctx doit donner 2 ou 3 candidats distincts, sinon pas de question (un seul :
//                         pas de choix ; plus de 3 : jamais tronqué) => introuvable « photo-illisible » (nom-contredit-*) ou
//                         « hors-catalogue » (egalite-parfaite sans aucun candidat). nom-contredit-sans-repli IGNORE ces candidats :
//                         pas d'égalité (r.scores vide, index.js:4840), toujours introuvable « photo-illisible ».
const { construireProduit } = require('./produit');
const { construireQuestion } = require('./questions');
const { choixPour } = require('../choix');

const ETATS = Object.freeze(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
const CONFIANCES = Object.freeze(['haute', 'moyenne', 'basse']);
const MOTIFS_ILLISIBLE = Object.freeze(['numero-illisible']);
const MOTIFS_ABSENCE = Object.freeze(['carte-introuvable', 'aucun-candidat', 'aucun-prix']);
const MOTIFS_EGALITE = Object.freeze(['egalite-parfaite', 'nom-contredit-egalite', 'nom-contredit-sans-repli']);
const CODE_CHINOIS = 6;

class Panne extends Error { constructor(code, diagnostic) { super(diagnostic); this.code = code; } }
const panne = (code, diagnostic) => { throw new Panne(code, diagnostic); };

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
const RAISONS = Object.freeze(['photo-illisible', 'pas-une-carte', 'hors-catalogue', 'plusieurs-cartes-non-separees', 'panne-lecture']);
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
            const produit = construireProduit(source(ctx, c.idProduct), pctx(ctx));
            return enveloppe('affirmee', carte('identifiee', { carte: produit, etat, prixLive: prixLiveDe(corps, c.idProduct, etat) }));
        }
        const ids = entiers(corps.candidats);
        if (ids.length < 2) return introuvable('photo-illisible');       // §5 Q32 : ni réserve ni question à un seul choix
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
            const union = [...new Set([...entiers(corps.candidats), ...entiers(ctx.candidatsDeRefus)])];
            if (union.length >= 2 && union.length <= 3) return question(union, etatDe(corps.etat), ctx);
            if (union.length > 3 || motif !== 'egalite-parfaite') return introuvable('photo-illisible');   // on ne sait pas : pas d'absence affirmée
            return introuvable('hors-catalogue');
        }
        panne('SERVEUR', `motif de refus délibéré inconnu : ${motif}`);
    }
    if (nature === 'echec-technique') {
        if (motif === 'ia-echec') panne('IA', motif);
        if (motif === 'tcgdex-injoignable' || MOTIFS_ABSENCE.slice(0, 2).includes(motif)) panne('INDISPONIBLE', `${motif} (absence requalifiée ou source tombée)`);
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
        const diagnostic = e instanceof Panne ? e.message : `exception : ${e && e.message}`;
        console.warn(`⚠️ [adaptateur-v2] panne ${code} : ${diagnostic}`);
        return { issue: 'panne', analyse: null, erreur: { code }, diagnostic };
    }
}
// codeLangueDe / prixLiveDe : exportés pour que /api/identifier/reponse (B1b.5) fabrique le prixLive d'une carte tranchée par la MÊME règle que l'adaptateur (§21 bis : jamais une copie).
module.exports = { adapter, RAISONS, codeLangueDe, prixLiveDe };
