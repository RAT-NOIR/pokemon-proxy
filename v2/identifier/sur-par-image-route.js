'use strict';
// SUR-PAR-IMAGE — la DÉCISION de la route : une QUESTION dont les candidats ne sont pas le même dessin devient un sûr quand le vecteur de l'extension désigne nettement un seul d'entre eux (sur-par-image.js, la règle PURE).
// DERRIÈRE DEUX interrupteurs (V2_SUR_PAR_IMAGE ET V2_EMPREINTE_EXTENSION). Éteint, rien n'est lu, rien n'est calculé, rien n'est noté : la réponse est celle d'avant, octet pour octet.
// Consultée APRÈS l'adaptateur, la seconde lecture, la lecture du tampon et la règle G, sur une question seulement (jamais un sûr, un refus, un introuvable ni une panne). Elle ne peut que PROMOUVOIR une question en
// affirmation d'un de ses candidats ; toute autre issue (donnée manquante, doute, exception) laisse la réponse d'AVANT, sans débit ni remboursement de plus. Le vecteur et l'index viennent de la MÊME vérification que la règle G
// (voisins-empreinte.preparerVecteur) ; les clés des candidats, de l'archive EN PLACE ; les jumeaux et les lectures, de la production.
const SPI = require('./sur-par-image');
const { preparerVecteur } = require('./voisins-empreinte');
const { lectureDe } = require('./garde-contradiction');

// (7) LES SIGNAUX D'UN VISUEL SUSPECT, lus dans l'archive EN MÉMOIRE (aucune liste dans le code) :
//   · basse : entree(id).basseDefinition (version.js:107, champ de l'archive ; null = colonne absente -> la règle se tait) ;
//   · partageAutreDessin : un autre produit de l'archive porte le même FICHIER (vignette ou grande) avec une AUTRE métacarte (entree.idMetacard, version.js:159) : une autre carte est un autre dessin. Index fichier -> produits
//     bâti UNE fois par version (WeakMap), à la première demande ; une métacarte inconnue d'un côté = inconnu, donc null (défaut fermé) ;
//   · un visuel emprunté (imageEmprunteeTirage) est refusé à la CONSTRUCTION (decision.js:54-58) et un produit exclu (liste d'exclusion) n'a aucune entrée (calcul.js:6-14) : ni l'un ni l'autre n'a de champ dans l'archive, tous
//     deux se disent par l'ABSENCE d'entrée -> condition (1) de la règle. Une archive qui garderait un jour un champ d'emprunt devra l'ajouter ici : tant qu'il n'existe pas, il n'y a rien à lire.
const FICHIERS = new WeakMap();
function fichiersDe(version) {
    let m = FICHIERS.get(version);
    if (m) return m;
    m = new Map();
    for (const id of version.identifiants()) {
        const e = version.entree(id);
        if (!e) continue;
        for (const f of [e.vignette && e.vignette.cle, e.grande && e.grande.cle]) {
            if (!f) continue;
            let l = m.get(f); if (!l) { l = []; m.set(f, l); }
            l.push([id, e.idMetacard]);
        }
    }
    FICHIERS.set(version, m);
    return m;
}
/** @returns (idProduct) => { basse, partageAutreDessin } | null — null quand la version ne sait pas les dire */
function signauxDe(version) {
    if (!version || typeof version.entree !== 'function' || typeof version.identifiants !== 'function') return () => null;
    return id => {
        const e = version.entree(id);
        if (!e) return null;
        const fichiers = fichiersDe(version);
        let partage = false;
        for (const f of [e.vignette && e.vignette.cle, e.grande && e.grande.cle]) {
            if (!f) continue;
            for (const [autre, mc] of fichiers.get(f) || []) {
                if (autre === id) continue;
                if (e.idMetacard === null || e.idMetacard === undefined || mc === null || mc === undefined) { if (partage === false) partage = null; }
                else if (mc !== e.idMetacard) { partage = true; break; }
            }
            if (partage === true) break;
        }
        // basseDefinition : seul `false` (largeur connue et ≥ 350 px) passe. `null` ne veut PAS dire « non signalé » : decision.js:75 écrit aussi null pour « non mesuré » (relecture 1, I1). Archive du 25/10 : true 11 124, null 56 081, jamais false —
        // tant que le producteur (lot MARQUE-EMPRUNT) n'écrit pas `false`, la règle se tait sur toute question dont un candidat est `null`.
        const basse = e.basseDefinition === true ? true : e.basseDefinition === false ? false : null;
        return { basse, partageAutreDessin: partage };
    };
}

/**
 * 🔌 POINT DE BRANCHEMENT avec le lot MARQUE-EMPRUNT : la version de l'archive expose **`version.empruntDe(idProduct)` -> `true | false | null`** (true : le visuel de l'entrée est celui d'un autre tirage ; false : prouvé propre ;
 * null : inconnu — produit hors archive). Tant que la version n'a pas cette méthode (l'archive d'aujourd'hui ne marque l'emprunt que par le TEXTE de `mention`, lu par personne), `emprunteDe` rend null : la règle se tait sur
 * toute la question (« emprunt-inconnu »). Quand la marque existe, seul `false` passe ; en ceinture, une `mention` non vide sur une entrée dite propre la rend suspecte (`true`) : deux sources en conflit ne donnent pas un sûr.
 * Si le lot nomme sa méthode autrement, c'est CETTE fonction (3 lignes) qu'on raccorde, rien d'autre.
 * @returns ((idProduct) => boolean|null) | null
 */
function emprunteDe(version) {
    if (!version || typeof version.empruntDe !== 'function' || typeof version.entree !== 'function') return null;
    return id => {
        const m = version.empruntDe(id);
        if (m === true) return true;
        if (m !== false) return null;
        const e = version.entree(id);
        if (!e) return null;
        return typeof e.mention === 'string' && e.mention.length > 0 ? true : e.mention === null ? false : null;
    };
}

/** Le critère journalisé de l'affirmation : la raison de la règle, qui NOMME son périmètre. */
const critereImage = d => `sur par l'image : ${d.raison}`;

const idsDeLaQuestion = (resultat, corps) => {
    const c = resultat && resultat.analyse && Array.isArray(resultat.analyse.cartes) && resultat.analyse.cartes.length === 1 ? resultat.analyse.cartes[0] : null;
    if (!c || !Array.isArray(c.candidats)) return null;
    const ids = c.candidats.map(x => x && x.idProduct);
    // un candidat que la chaîne a lu et que la question ne montre pas (limite de trois choix) reste un rival : il entre dans le jugement
    const caches = corps && Array.isArray(corps.candidats) ? corps.candidats.map(x => x && x.idProduct).filter(Number.isInteger) : [];
    return [...new Set([...ids, ...caches])];
};

/**
 * @param affirmer  (idProduct, produitsSurcharge?, critere) => le résultat d'une AFFIRMATION de ce produit (adaptateur.affirmerParLaRoute), ou lève
 * @param version   la version de l'archive des visuels EN PLACE (entree(id).grande.cle, partagesDe, colonneMarquages)
 * @param jumeaux   (idProduct) => { conclu, ids } (jumeaux.js) — le fournisseur de la requête
 * @param marquesLues les marques que la lecture du tampon a lues sur cette photo (trace de consulterLectureTampon), ou null
 * @param etat      l'index en place (etat-empreintes.js), injectable en banc
 * @returns null (rien d'appelé, rien de noté) | { resultat?, trace } — resultat : l'affirmation, SEULEMENT si la preuve est faite
 */
async function consulterSurParImage({ cfg, entree, resultat, corpsChaine, produits, version, jumeaux, affirmer, marquesLues = null, etat = require('./etat-empreintes'), journal = () => { }, chrono = null }) {
    try {
        if (!(cfg && cfg.surParImage === true && cfg.empreinteExtension === true)) return null;      // les DEUX drapeaux
        if (!resultat || resultat.issue !== 'question' || resultat.motif || resultat.contradiction) return null;
        const ids = idsDeLaQuestion(resultat, corpsChaine);
        if (!ids || ids.length < 2 || !ids.every(Number.isInteger)) return null;
        if (!version || typeof version.entree !== 'function' || !(produits instanceof Map) || typeof affirmer !== 'function') return null;
        const voulu = cfg.modeleEmpreinte && cfg.modeleEmpreinte.id && cfg.modeleEmpreinte.sha256 ? { id: cfg.modeleEmpreinte.id, sha256: cfg.modeleEmpreinte.sha256 } : null;
        const p = preparerVecteur({ entree, voulu, etat, memo: require('./temps-etapes').reglages(cfg).voisinsUneFois, chrono });      // TEMPS-ETAPES : la recherche déjà faite pour la règle G n'est pas refaite (éteint : comme avant)
        if (!p.ok) return null;                                                                   // pas de vecteur exploitable : G l'a déjà dit, la question reste
        const cles = new Map();
        for (const id of ids) { const e = version.entree(id); if (e && e.grande && typeof e.grande.cle === 'string' && e.grande.cle) cles.set(id, e.grande.cle); }
        const ordre = [...new Set(cles.values())];
        const cos = new Map();
        if (ordre.length) { const r = p.courant.index.similarites(p.v.vecteur, ordre); ordre.forEach((c, i) => cos.set(c, r[i])); }
        const d = SPI.decider({
            ids, cles, cosinus: c => (cos.has(c) ? cos.get(c) : null), top1: p.trouve.top.length ? p.trouve.top[0][0] : null, contexte: p.courant.index.contexteG,
            signaux: signauxDe(version), emprunte: emprunteDe(version), partages: version.colonneMarquages === true && typeof version.partagesDe === 'function' ? id => version.partagesDe(id) : () => null,
            jumeaux: typeof jumeaux === 'function' ? jumeaux : null, produits, lu: lectureDe(corpsChaine), marquesLues: Array.isArray(marquesLues) ? marquesLues : null, redressee: p.e0.redressee === true
        });
        if (!d.sur) return { trace: { issue: 'se-tait', motif: d.motif } };
        let aff = null;
        try { aff = affirmer(d.produit, undefined, critereImage(d)); } catch (e) { journal('sur par l\'image (affirmation)', e); }
        if (aff && aff.issue === 'affirmee' && aff.analyse && aff.analyse.cartes[0].carte && aff.analyse.cartes[0].carte.idProduct === d.produit) {
            return { resultat: aff, trace: { issue: 'sur', produit: d.produit, ecart: Math.round(d.ecart * 1e4) / 1e4, cosinus: Math.round(d.cosinus * 1e4) / 1e4, candidats: ids } };
        }
        return { trace: { issue: 'non-construite', motif: 'l\'affirmation n\'a pas pu être construite' } };
    } catch (e) { journal('sur par l\'image', e); return null; }                              // une exception n'est jamais une affirmation : la réponse d'avant
}

module.exports = { consulterSurParImage, critereImage, signauxDe, emprunteDe };
