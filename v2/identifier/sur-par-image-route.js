'use strict';
// SUR-PAR-IMAGE — la DÉCISION de la route : une QUESTION dont les candidats ne sont pas le même dessin devient un sûr quand le vecteur de l'extension désigne nettement un seul d'entre eux (sur-par-image.js, la règle PURE).
// DERRIÈRE DEUX interrupteurs (V2_SUR_PAR_IMAGE ET V2_EMPREINTE_EXTENSION). Éteint, rien n'est lu, rien n'est calculé, rien n'est noté : la réponse est celle d'avant, octet pour octet.
// Consultée APRÈS l'adaptateur, la seconde lecture, la lecture du tampon et la règle G, sur une question seulement (jamais un sûr, un refus, un introuvable ni une panne). Elle ne peut que PROMOUVOIR une question en
// affirmation d'un de ses candidats ; toute autre issue (donnée manquante, doute, exception) laisse la réponse d'AVANT, sans débit ni remboursement de plus. Le vecteur et l'index viennent de la MÊME vérification que la règle G
// (voisins-empreinte.preparerVecteur) ; les clés des candidats, de l'archive EN PLACE ; les jumeaux et les lectures, de la production.
const SPI = require('./sur-par-image');
const { preparerVecteur } = require('./voisins-empreinte');
const { lectureDe } = require('./garde-contradiction');
const { estMentionDAffichage } = require('./emprunt');                  // JUMBO-VISUEL : la mention d'affichage de Base Set n'est pas une marque d'emprunt

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
        // JUMBO-VISUEL : la mention d'AFFICHAGE de Base Set (scan Édition 1 d'une fiche Pokémon) dit que le scan est d'un autre tirage SANS que le dessin change : ce n'est pas une marque d'emprunt oubliée, l'image peut servir
        if (estMentionDAffichage(e.mention)) return false;
        return typeof e.mention === 'string' && e.mention.length > 0 ? true : e.mention === null ? false : null;
    };
}

/** Le critère journalisé de l'affirmation : la raison de la règle, qui NOMME son périmètre. */
const critereImage = d => `sur par l'image : ${d.raison}`;

// VIVIER-IMAGE : le nombre de visuels les plus proches dont les produits entrent au vivier (le top 5 de l'empreinte sur l'index ENTIER), et le critère journalisé qui NOMME ce périmètre élargi.
const K_VIVIER = 5;
/**
 * GARDE DU VIVIER ÉLARGI (écrite par ce qu'elle AUTORISE) : la règle ne juge les rivaux du même dessin que parmi la liste ; un visuel du groupe de dessin du désigné peut rester invisible (hors du top 5, ou sans produit au contexte).
 * Le désigné n'est affirmé que si (a) TOUS les produits de TOUS les membres de son groupe de dessin (ctx.membres) sont dans la liste jugée, et (b) l'écart de cosinus tient aussi contre top[1] de l'index (hors lui-même et son groupe).
 * Tout ce qui ne se prouve pas (contexte illisible, score absent) : silence. @returns null (autorisé) | le motif du silence
 */
function gardeVivier(d, liste, p, prods) {
    try {
        const ctx = p.courant.index.contexteG, top = p.trouve.top;
        const cle = Array.isArray(top) && top.length ? top[0][0] : null;
        if (!cle || !(ctx.produits instanceof Map) || !(ctx.groupe instanceof Map) || !(ctx.membres instanceof Map) || !(prods instanceof Map)) return 'groupe-incomplet';
        // l'ensemble à couvrir : la clé n°1 ELLE-MÊME (un produit au même fichier visuel est du même dessin) puis, si elle a un groupe, tous ses membres ; un groupe qui ne la contient pas est une donnée incohérente
        let ensemble = [cle];
        if (ctx.groupe.has(cle)) {
            const membres = ctx.membres.get(ctx.groupe.get(cle));
            if (!Array.isArray(membres) || !membres.includes(cle)) return 'groupe-incomplet';
            ensemble = [...new Set([cle, ...membres])];
        }
        for (const k of ensemble) {
            const lesProduits = ctx.produits.get(k);
            if (!Array.isArray(lesProduits)) return 'groupe-incomplet';
            for (const pr of lesProduits) if (!Array.isArray(pr) || !liste.includes(pr[0]) || !prods.has(pr[0])) return 'groupe-incomplet';      // dans la liste ET une ligne de catalogue
        }
        // l'écart contre le 2e visuel de l'index : sans lui (top d'un seul visuel), il ne se contrôle pas : silence explicite
        if (top.length < 2) return 'ecart-index';
        const g0 = ctx.groupe.has(cle) ? ctx.groupe.get(cle) : undefined;
        const second = top.find((t, i) => i > 0 && t[0] !== cle && !(g0 !== undefined && ctx.groupe.get(t[0]) === g0));
        if (second && !(d.cosinus - second[1] >= SPI.MARGE)) return 'ecart-index';
        return null;
    } catch { return 'groupe-incomplet'; }
}
const critereVivier = (d, v) => critereImage({ raison: `${d.raison} ; vivier élargi : la question plus les produits des ${v.k} visuels les plus proches de la photo à l'index (${v.extras} ajoutés)` });
/** Les produits des K premiers visuels du top (index entier), dédoublonnés, qui ne sont pas déjà dans `deja`. L'ordre est celui du top puis celui de l'index. [] si le contexte ne sait pas dire les produits. */
function extrasDuTop(top, contexte, deja, k = K_VIVIER) {
    const vus = new Set(deja), extras = [];
    if (!Array.isArray(top) || !contexte || !(contexte.produits instanceof Map)) return extras;
    for (const t of top.slice(0, k)) for (const pr of (contexte.produits.get(t && t[0]) || [])) { const id = Array.isArray(pr) ? pr[0] : null; if (Number.isInteger(id) && !vus.has(id)) { vus.add(id); extras.push(id); } }
    return extras;
}

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
async function consulterSurParImage({ cfg, entree, resultat, corpsChaine, produits, version, jumeaux, affirmer, charger, marquesLues = null, etat = require('./etat-empreintes'), journal = () => { }, chrono = null }) {
    try {
        if (!(cfg && cfg.surParImage === true && cfg.empreinteExtension === true)) return null;      // les DEUX drapeaux
        if (!resultat || resultat.issue !== 'question' || resultat.motif || resultat.contradiction) return null;
        const elargir = cfg.vivierImage === true;                                                  // VIVIER-IMAGE : le troisième drapeau ; éteint, tout ce qui suit est celui d'avant
        const ids = idsDeLaQuestion(resultat, corpsChaine);
        if (!ids || ids.length < (elargir ? 1 : 2) || !ids.every(Number.isInteger)) return null;
        if (!version || typeof version.entree !== 'function' || !(produits instanceof Map) || typeof affirmer !== 'function') return null;
        const voulu = cfg.modeleEmpreinte && cfg.modeleEmpreinte.id && cfg.modeleEmpreinte.sha256 ? { id: cfg.modeleEmpreinte.id, sha256: cfg.modeleEmpreinte.sha256 } : null;
        const p = preparerVecteur({ entree, voulu, etat, memo: require('./temps-etapes').reglages(cfg).voisinsUneFois, chrono });      // TEMPS-ETAPES : la recherche déjà faite pour la règle G n'est pas refaite (éteint : comme avant)
        if (!p.ok) return null;                                                                   // pas de vecteur exploitable : G l'a déjà dit, la question reste
        const juger = (liste, prods) => {
            const cles = new Map();
            for (const id of liste) { const e = version.entree(id); if (e && e.grande && typeof e.grande.cle === 'string' && e.grande.cle) cles.set(id, e.grande.cle); }
            const ordre = [...new Set(cles.values())];
            const cos = new Map();
            if (ordre.length) { const r = p.courant.index.similarites(p.v.vecteur, ordre); ordre.forEach((c, i) => cos.set(c, r[i])); }
            return SPI.decider({
                ids: liste, cles, cosinus: c => (cos.has(c) ? cos.get(c) : null), top1: p.trouve.top.length ? p.trouve.top[0][0] : null, contexte: p.courant.index.contexteG,
                signaux: signauxDe(version), emprunte: emprunteDe(version), partages: version.colonneMarquages === true && typeof version.partagesDe === 'function' ? id => version.partagesDe(id) : () => null,
                jumeaux: typeof jumeaux === 'function' ? jumeaux : null, produits: prods, lu: lectureDe(corpsChaine), marquesLues: Array.isArray(marquesLues) ? marquesLues : null, redressee: p.e0.redressee === true,
                comparateur: cfg.spiComparateur === true      // SPI-CONTRADICTIONS : le comparateur juste de la condition (6) ; éteint, la définition brute de la production
            });
        };
        // la règle d'avant, d'abord et seule tant qu'elle a deux candidats (une question à un seul n'a jamais été relue par l'image)
        let d = juger(ids, produits);                                                              // un seul candidat : la règle se tait d'elle-même (« candidats ») ; jamais de sûr sur moins de deux
        let liste = ids, prods = produits, vivier = null;
        if (!d.sur && elargir && p.e0.redressee === true) {                                      // une photo non redressée ne conclura de toute façon pas : le catalogue n'est pas lu pour rien
            // REPLI : les produits des K visuels les plus proches de la photo, dans l'index ENTIER, qui ne sont pas déjà candidats ; leurs lignes de catalogue sont lues, puis les MÊMES conditions jugent l'ensemble
            const extras = extrasDuTop(p.trouve.top, p.courant.index.contexteG, ids);
            vivier = { k: K_VIVIER, extras: extras.length, motifAvant: d.motif };
            if (extras.length) {
                let lignes = null;
                const manquants = extras.filter(id => !produits.has(id));
                if (typeof charger === 'function') { try { lignes = manquants.length ? await charger(manquants) : new Map(); } catch (e) { journal('vivier image (catalogue)', e); } }
                if (lignes instanceof Map) {
                    prods = new Map(produits); for (const [k, v] of lignes) prods.set(k, v);
                    liste = [...ids, ...extras];
                    d = juger(liste, prods); vivier.charge = true;
                    if (d.sur) { const m = gardeVivier(d, liste, p, prods); if (m) d = { sur: false, motif: m }; }
                } else { vivier.charge = false; d = { sur: false, motif: 'vivier-indisponible' }; }
            }
        }
        const avecVivier = vivier ? { vivier } : {};
        if (!d.sur) return { trace: { issue: 'se-tait', motif: d.motif, ...(vivier && vivier.extras && liste.length > ids.length ? { candidats: liste } : {}), ...avecVivier } };
        let aff = null;
        const critere = vivier ? critereVivier(d, vivier) : critereImage(d);
        try { aff = affirmer(d.produit, vivier ? prods : undefined, critere); } catch (e) { journal('sur par l\'image (affirmation)', e); }
        if (aff && aff.issue === 'affirmee' && aff.analyse && aff.analyse.cartes[0].carte && aff.analyse.cartes[0].carte.idProduct === d.produit) {
            return { resultat: aff, trace: { issue: 'sur', produit: d.produit, ecart: Math.round(d.ecart * 1e4) / 1e4, cosinus: Math.round(d.cosinus * 1e4) / 1e4, candidats: liste, ...avecVivier } };
        }
        return { trace: { issue: 'non-construite', motif: 'l\'affirmation n\'a pas pu être construite', ...avecVivier } };
    } catch (e) { journal('sur par l\'image', e); return null; }                              // une exception n'est jamais une affirmation : la réponse d'avant
}

module.exports = { gardeVivier, consulterSurParImage, critereImage, signauxDe, emprunteDe };
