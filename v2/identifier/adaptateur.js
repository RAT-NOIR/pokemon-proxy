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
const { garde, candidatUniqueDe, noter, partagesDuFournisseur } = require('./jumeaux');
const { choisirTrois } = require('./jumeaux-nombreux');
const { garderCompatibles } = require('./nom-compatible');
const { contredire } = require('./garde-contradiction');
const { critereA, CRITERE_A } = require('./critere-a');
const LD = require('./langue-decisive');
const DES = require('./designation');

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

// M1 (relecture r1) : une question de la CHAÎNE ne perd jamais le partenaire de partage d'un de ses candidats (l'image ne les sépare pas : la vérité peut être le partenaire). Les partenaires sont ajoutés
// (les candidats d'abord) ; au-delà de 3 produits, jamais une question tronquée : l'introuvable impression-indeterminee, motif compté. Un fournisseur sans partages (banc, archive d'avant) : la question d'avant.
function questionAvecPartenaires(ids, etat, ctx, motifTexte) {
    const tous = [...ids];
    for (const id of ids) for (const q of partagesDuFournisseur(ctx.jumeaux, id)) if (!tous.includes(q)) tous.push(q);
    if (tous.length > ids.length && tous.length > 3) {                    // seulement quand des partenaires ont été AJOUTÉS : une question de la chaîne à 4 candidats reste coupée aux 3 premiers comme avant
        noter('jumeaux-trop-nombreux', ids[0], `(${motifTexte} : ${tous.length} produits avec les partenaires de partage)`);
        return { ...introuvable('impression-indeterminee'), motif: 'jumeaux-trop-nombreux' };
    }
    return question(tous, etat, ctx);
}
function question(ids, etat, ctx) {
    const premiers = ids.slice(0, 3);                                    // l'ordre du classement n'est pas servi : on ne garde que le rang pour couper
    const ordre = choixPour(premiers).map(c => c.idProduct);             // puis ordre idProduct, jamais celui du classement
    const cands = ordre.map(id => construireProduit(source(ctx, id), pctx(ctx)));
    // m8 : des produits qui se partagent la même image (l'un est le partenaire de l'autre) : l'aide de la question isuel ne renvoie pas à l'illustration
    const partages = ordre.some(i => partagesDuFournisseur(ctx.jumeaux, i).some(q => ordre.includes(q)));
    const q = construireQuestion(cands, { langueInterface: ctx.langueInterface, partages });
    return enveloppe('question', carte('a-trancher', { candidats: cands, question: q, etat }), { question: q });
}

// JUMEAU-V2 + UN-CANDIDAT : ce que dit la garde des jumeaux pour un produit P. `affirmer` rend null (l'appelant décide : affirmer P, ou lui poser la question de confirmation) ;
// tout le reste est une SORTIE : question de départage (P et ses jumeaux ; plus de 3 produits : 3 d'entre eux, jumeaux-nombreux.js), introuvable `impression-indeterminee` (repli : une ligne de catalogue d'un jumeau manque), ou PANNE INDISPONIBLE (jamais ni question ni affirmation).
function apresGarde(g, etat, ctx, corps) {
    if (g.action === 'affirmer') return null;
    if (g.action === 'question') return question(g.ids, etat, ctx);
    if (g.action === 'nombreux') {
        // JUMEAUX-QUESTION : plus de 3 produits => une QUESTION à 3 (P d'abord, puis l'ordre nommé de jumeaux-nombreux.js), jamais une affirmation. Une ligne de catalogue manquante : le repli d'avant.
        const trois = choisirTrois({ p: g.ids[0], jumeaux: g.ids.slice(1), partages: g.partages, corps, produits: ctx.produits });     // M1 : P et ses partenaires de partage d'abord ; trop de partenaires : null (introuvable plus bas)
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
// GARDE-CONTRADICTION : un champ lu sur la photo (total, attaque, set TCGdex, numéro, code) contredit P ET désigne un autre candidat du vivier => jamais une affirmation de P, une QUESTION entre P et ce que les champs désignent
// (3 au plus : P d'abord, puis les plus étayés). Le résultat porte `contradiction` (le résumé, pour le journal) ; la seconde lecture ne s'y applique pas (routes.js). null : rien ne contredit P.
// LANGUE-DECISIVE : une QUESTION (de la garde contradiction ou des jumeaux) est réduite par ce que la photo dit (langue certaine R1, illustration R2, attaque R2 bis) ; il ne reste qu'UN candidat et il tient les
// conditions du critère A (numéro concordant, aucun veto, code concordant ou R4) => SÛR (`critere` côté serveur, la réservation éventuelle se règle comme une réponse : routes.js) ; il en reste 2 ou 3 => la question
// ne porte que sur eux ; aucun retrait, ou tous retirés, ou un seul qui ne tient pas => null (la question d'avant, inchangée). Les règles : ctx.langueDecisive (bancs, mesure) sinon les constantes de langue-decisive.js.
function parLangueDecisive(ids, idProduct, etat, ctx, corps) {
    const regles = { ...LD.REGLES, ...(ctx.langueDecisive && typeof ctx.langueDecisive === 'object' ? ctx.langueDecisive : {}) };
    if (!regles.R1 && !regles.R2 && !regles.R2BIS && !regles.R5) return null;
    const r = LD.reduire({ ids, corps, produits: ctx.produits, regles, scoresImage: ctx.scoresImage });
    if (!r.retires.length) return null;
    const regs = [...new Set(r.retires.map(x => x.regle))].join('+');
    if (r.ids.length === 1) {
        // B1 : le candidat seul passe par la MÊME garde des jumeaux que toute affirmation (groupe lu dans la colonne des jumeaux et le catalogue, jamais dans le vivier) ; sans jumeau : groupe vide ;
        // la garde ne conclut pas (colonne absente ou périmée, ligne manquante…) : groupe null, refus.
        const gj = garde(ctx, r.ids[0], true);                          // une SONDE : ni compteur ni journal de la garde des jumeaux (m-2)
        const groupe = gj.action === 'affirmer' ? [] : (gj.action === 'question' || gj.action === 'nombreux') ? gj.ids.filter(i => i !== r.ids[0]) : null;
        const a = LD.affirmableSeul({ corps, id: r.ids[0], produits: ctx.produits, regles, groupe, catalogueExiste: ctx.codeNumeroExiste });
        if (!a.affirme) {
            // un seul candidat qui ne tient pas toutes les conditions : jamais un sûr. La question n'est pas réduite à UN choix (la confirmation « est-ce cette carte ? » n'est pas ce qu'on mesure) ; on garde la
            // réduction de la langue seule (R1) quand elle laisse au moins deux candidats, sinon la question d'avant, inchangée.
            const r1 = LD.reduire({ ids, corps, produits: ctx.produits, regles: { ...regles, R2: false, R2BIS: false, R5: false } });
            return r1.retires.length && r1.ids.length >= 2 && r1.ids.length <= 3 ? { ...question(r1.ids, etat, ctx), langueDecisive: 'R1' } : null;
        }
        console.warn(`ℹ️ [langue-decisive-v2] affirmation produit=${r.ids[0]} retires=${r.retires.map(x => `${x.id}:${x.regle}`).join(',')}`);
        return affirmer(r.ids[0], etat, ctx, corps, `langue décisive (${regs}) : ${a.raison}`);
    }
    if (r.ids.length >= 2 && r.ids.length <= 3) return { ...question(r.ids, etat, ctx), langueDecisive: regs };
    return null;
}
function parContradiction(idProduct, etat, ctx, corps) {
    const g = contredire({ corps, gagnant: idProduct, produits: ctx.produits });
    if (!g) return null;
    console.warn(`⚠️ [garde-contradiction-v2] produit=${idProduct} ${g.resume}`);
    // M1 : les partenaires de partage de P et du candidat désigné entrent dans la question (l'image ne les sépare pas) ; au-delà de 3 produits : jamais tronquée, impression-indeterminee
    const designes = g.designe.length ? [g.gagnant, ...g.designe.map(d => d.idProduct)] : [];
    const ajoutes = designes.flatMap(i => partagesDuFournisseur(ctx.jumeaux, i)).filter((x, k, a) => !designes.includes(x) && a.indexOf(x) === k);
    const avecPart = designes.length ? [...designes, ...ajoutes] : [];
    if (ajoutes.length && avecPart.length > 3) {
        noter('jumeaux-trop-nombreux', idProduct, `(contradiction : ${avecPart.length} produits avec les partenaires de partage)`);
        return { ...introuvable('impression-indeterminee'), motif: 'jumeaux-trop-nombreux', contradiction: g.resume };
    }
    if (designes.length) {
        const ld = parLangueDecisive(avecPart, idProduct, etat, ctx, corps);
        if (ld) return { ...ld, contradiction: g.resume };
    }
    // Un candidat DÉSIGNÉ : la question entre P et lui. Numéro ou total seul (personne de désigné) : l'issue la plus prudente existante, la question de confirmation « est-ce cette carte ? » à UN candidat — après la garde
    // des jumeaux (si P a des jumeaux, leur question ou leur refus passe d'abord) — jamais une affirmation.
    const r = designes.length ? question(avecPart, etat, ctx) : (apresGarde(garde(ctx, idProduct), etat, ctx, corps) || question([idProduct], etat, ctx));
    return { ...r, contradiction: g.resume };
}
// CRITÈRE A (2026-10-17) : la garde des jumeaux refuse d'affirmer P (question de départage ou plus de 3 produits) ; si le code ET le numéro lus le désignent SEUL (critere-a.js : après la garde
// contradiction, qui est passée AVANT), P est affirmé à la place. Le lieu : ici, là où la garde des jumeaux refuse — il couvre d'un seul endroit la route d'une carte, le lot (qui passe par adapter())
// et le candidat unique ; la règle G et la seconde lecture ne voient qu'un résultat. Aucune règle recopiée : critere-a.js appelle les fonctions de production.
function parCritereA(g, idProduct, ctx, corps) {
    if (g.action !== 'question' && g.action !== 'nombreux') return null;
    const r = critereA({ corps, gagnant: idProduct, jumeaux: g.ids.slice(1), produits: ctx.produits, actif: ctx.critereA === undefined ? CRITERE_A : ctx.critereA,
        r4: ctx.langueDecisive && ctx.langueDecisive.R4 !== undefined ? ctx.langueDecisive.R4 === true : LD.REGLES.R4, catalogueExiste: ctx.codeNumeroExiste });
    return r.affirme ? r.raison : null;
}
function parLangueDesJumeaux(g, idProduct, etat, ctx, corps) {
    return g.action === 'question' || g.action === 'nombreux' ? parLangueDecisive(g.ids, idProduct, etat, ctx, corps) : null;
}
function affirmer(idProduct, etat, ctx, corps, critere = null) {
    const produit = construireProduit(source(ctx, idProduct), pctx(ctx));
    const r = enveloppe('affirmee', carte('identifiee', { carte: produit, etat, prixLive: prixLiveDe(corps, idProduct, etat) }));
    return critere ? { ...r, critere } : r;
}
// UN candidat non affirmé P : la source de P est lue d'abord (absent du catalogue de l'API : panne SERVEUR, on n'invente pas), puis la contradiction, puis la garde ; sans jumeau, une question à UN choix.
function candidatUnique(idProduct, etat, ctx, corps) {
    source(ctx, idProduct);
    const parChamp = parContradiction(idProduct, etat, ctx, corps);
    if (parChamp) return parChamp;
    const g = garde(ctx, idProduct);
    const critere = parCritereA(g, idProduct, ctx, corps);
    if (critere) return affirmer(idProduct, etat, ctx, corps, critere);
    return parLangueDesJumeaux(g, idProduct, etat, ctx, corps) || apresGarde(g, etat, ctx, corps) || question([idProduct], etat, ctx);
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
            source(ctx, c.idProduct);
            const parChamp = parContradiction(c.idProduct, etat, ctx, corps);              // GARDE-CONTRADICTION : avant celle des jumeaux (la lecture désigne un AUTRE candidat que P, pas un jumeau)
            if (parChamp) return parChamp;
            const gJumeaux = garde(ctx, c.idProduct);
            const critere = parCritereA(gJumeaux, c.idProduct, ctx, corps);                // CRITÈRE A : après la contradiction (ci-dessus), à la place du refus de la garde des jumeaux
            if (critere) return affirmer(c.idProduct, etat, ctx, corps, critere);
            const parLangue = parLangueDesJumeaux(gJumeaux, c.idProduct, etat, ctx, corps);   // LANGUE-DECISIVE : la question des jumeaux réduite par la photo
            if (parLangue) return parLangue;
            const refusGarde = apresGarde(gJumeaux, etat, ctx, corps);
            if (refusGarde) return refusGarde;
            return affirmer(c.idProduct, etat, ctx, corps);
        }
        // CONFIRMATION-SURE : un candidat dont le nom est CONTREDIT par le nom lu n'est jamais montré (nom-compatible.js) ; il est retiré AVANT la construction de la question.
        const ids = garderCompatibles(entiers(corps.candidats), corps, ctx.produits);
        // UN-CANDIDAT (D1, 2026-10-13) : un seul candidat n'est plus un introuvable (ancien §5 Q32) — « ce qui n'est pas affirmé devient une question ». Il passe par la garde des
        // jumeaux (comme une affirmation) : sans jumeau, la question « est-ce cette carte ? » ; avec jumeaux, la question de départage ; trop de jumeaux, impression-indeterminee.
        const unique = candidatUniqueDe({ ...corps, candidats: ids.map(idProduct => ({ idProduct })) });
        if (unique !== null) return candidatUnique(unique, etat, ctx, corps);
        if (ids.length < 2) return introuvable('photo-illisible');       // aucun candidat : on ne sait rien
        return questionAvecPartenaires(ids, etat, ctx, 'question de la chaîne');
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
            if (union.length >= 2 && union.length <= 3) return questionAvecPartenaires(union, etatDe(corps.etat), ctx, 'égalité de la chaîne');
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

// DESIGNATION (2026-10-18) : APRÈS le critère A et LANGUE-DECISIVE (déjà passés dans traduire), une QUESTION que rien n'a tranchée est relue : si les champs déjà lus ne satisfont que l'un de ses candidats (designation.js : seule la
// règle `numero` est allumée), il est affirmé à la place. Une désignation qui échoue ne change rien : la question d'avant, jamais une panne.
function parDesignation(r, corps, ctx) {
    if (!r || r.issue !== 'question') return r;
    const regles = DES.reglesDe({ ...DES.REGLES_DESIGNATION, ...(ctx.designation && typeof ctx.designation === 'object' ? ctx.designation : {}) });
    if (!DES.actives(regles).length) return r;
    try {
        const c = r.analyse.cartes[0];
        const d = DES.designer({ ids: c.candidats.map(x => x.idProduct), corps, produits: ctx.produits, jumeaux: ctx.jumeaux, regles, catalogueExiste: ctx.codeNumeroExiste });
        return d ? affirmer(d.id, c.etat, ctx, corps, d.critere) : r;
    } catch { return r; }
}

/** @returns { issue: 'affirmee'|'question'|'introuvable'|'panne', analyse, erreur?, question?, diagnostic? } */
function adapter({ statutHttp, corps } = {}, ctx = {}) {
    try {
        return parDesignation(traduire(statutHttp, corps, ctx), corps, ctx);
    } catch (e) {
        const code = e instanceof Panne ? e.code : 'SERVEUR';           // un cas non prévu tombe sur le défaut qui n'affirme rien
        const diagnostic = e instanceof Panne ? e.message : `exception : ${(e && (e.code || e.name)) || 'erreur'}`;   // jamais le message d'une exception interne (seule une Panne, phrase fabriquée ici, est dite en entier)
        console.warn(`⚠️ [adaptateur-v2] panne ${code} : ${diagnostic}`);
        return { issue: 'panne', analyse: null, erreur: { code }, diagnostic, ...(e instanceof Panne && e.motif ? { motif: e.motif } : {}) };
    }
}
/** F1-TAMPON : l'affirmation d'un produit CHOISI par la route (STAFF lu deux fois), construite par la MÊME fonction que toute affirmation. Le produit doit être dans ctx.produits (sinon la panne SERVEUR d'avant). */
function affirmerParLaRoute(corps, idProduct, ctx, critere) {
    source(ctx, idProduct);
    return affirmer(idProduct, etatDe(corps && corps.etat), ctx, corps || {}, critere);
}
// codeLangueDe / prixLiveDe : exportés pour que /api/identifier/reponse (B1b.5) fabrique le prixLive d'une carte tranchée par la MÊME règle que l'adaptateur (§21 bis : jamais une copie).
module.exports = { adapter, RAISONS, codeLangueDe, prixLiveDe, affirmerParLaRoute };
