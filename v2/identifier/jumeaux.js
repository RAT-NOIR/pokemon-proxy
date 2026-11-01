'use strict';
// JUMEAU-V2 — la garde « aucune affirmation d'un produit qui a un jumeau ». Module PUR (ni base, ni réseau).
// Un jumeau de P est un AUTRE produit de même métacarte, de même langue de tirage et d'un AUTRE créneau (expansion, numéro) : la lecture du code et du numéro le sépare de P, et c'est cette
// lecture qui se trompe (IMG_3237 : « PAR 251 » lu sur une carte qui imprime « PRE 162 » ; même nom, même métacarte ; prix rendu faux de 106 €). Un champ inconnu compte comme « même ».
// 🔑 La garde est écrite par ce qu'elle AUTORISE : UN seul chemin mène à « affirmer » — un fournisseur de jumeaux qui a CONCLU, sur une colonne à jour, et qui n'en rend AUCUN. Tout le reste :
//   · P et ses jumeaux tiennent en 3 produits ou moins, tous au catalogue de l'API → une QUESTION de départage (le mécanisme existant) ;
//   · plus de 3 produits → action `nombreux` : l'adaptateur pose une QUESTION à 3 (P d'abord, puis l'ordre de jumeaux-nombreux.js) — jamais une affirmation. Si les lignes de catalogue des jumeaux manquent
//     (ou dépassent la borne de chargement), le repli est l'INTROUVABLE `impression-indeterminee` d'avant, motif interne `jumeaux-trop-nombreux` (JUMEAUX-QUESTION, 2026-10-17) ;
//   · la colonne manque, est périmée, ne couvre pas le produit, le fournisseur lève ou rend une forme inconnue, un jumeau n'a pas de ligne au catalogue de l'API → PANNE INDISPONIBLE (c'est
//     NOTRE infrastructure, pas la photo : « une panne n'est jamais un introuvable »), motif interne `jumeaux-indisponibles` / `jumeaux-perimes` / `jumeaux-incomplets`.
// Un refus de la garde est NOTRE refus : il se rembourse SANS plafond (constaté par le serveur, PLAFOND-DECLARE : plus de compteur dédié), une unité par carte (routes.js, lot.js, argent/ledger.js). Chaque refus est COMPTÉ (compteurs()) et journalisé (CLAUDE.md §21).
const MAX_PRODUITS = 3;                         // la limite d'une question : celle de l'adaptateur
const MAX_CHARGE = 60;                          // au plus 60 jumeaux chargés pour choisir les 3 d'une question (au-delà : le repli introuvable d'avant, jamais un chargement sans fin)
const MOTIFS = Object.freeze(['jumeaux-trop-nombreux', 'jumeaux-indisponibles', 'jumeaux-perimes', 'jumeaux-incomplets', 'question-de-jumeaux']);
const MOTIFS_PANNE = Object.freeze(['jumeaux-indisponibles', 'jumeaux-perimes', 'jumeaux-incomplets']);
const compte = Object.fromEntries(MOTIFS.map(m => [m, 0]));
const compteurs = () => ({ ...compte });
function noter(motif, idProduct, detail) {
    compte[motif]++;
    console.warn(`⚠️ [jumeaux-v2] ${motif} produit=${idProduct}${detail ? ` ${detail}` : ''}`);
}
const entiers = xs => Array.isArray(xs) && xs.every(Number.isInteger);
const empreinteValide = e => Boolean(e) && typeof e === 'object' && Number.isInteger(e.n) && e.n > 0 && Number.isInteger(e.max) && e.max > 0;
const NE_CONCLUT_PAS = (motif = null) => () => ({ conclu: false, ids: [], ...(motif ? { motif } : {}) });

/**
 * Le fournisseur de la route : { conclu, ids } pour un produit, lu dans UNE version (celle de la requête). Ne conclut jamais sans colonne.
 * `verdicts` : Map idProduct → 'ok' | 'perime' | 'indisponible', établi AVANT l'adaptation par fournisseurParDefaut (la garde de l'adaptateur est synchrone). La colonne décrit un catalogue plus
 * ancien : un produit PLUS RÉCENT qu'elle, de la MÊME métacarte que le produit affirmé, est peut-être son jumeau qu'elle ne connaît pas → pour CE produit seulement, `jumeaux-perimes`.
 * `undefined` = pas de contrôle (le fournisseur est celui d'un banc ou d'un rejeu) ; une Map : tout produit qui n'y figure pas ne conclut pas (jamais un défaut passant).
 */
// REPLI-REIMPRESSIONS : les produits que l'IMAGE ne sépare pas du produit `id` (partageeHoloNonHolo, partageeTamponNonSepare — une paire séparée par l'étiquette compte comme non séparée tant que la lecture du tampon
// n'existe pas — lus dans la colonne des marquages de l'archive). Ce sont des variantes du MÊME créneau (expansion, numéro) : la colonne des jumeaux ne les compte pas, elles sont donc ajoutées ICI, pour que la garde
// ci-dessous (question de départage, critère A, seconde lecture, lot) les traite comme tout produit qu'on ne sait pas séparer. Une archive SANS la colonne (d'avant) ne conclut rien : [] (comportement d'avant).
function partagesDeLaVersion(version, id) {
    if (!version || version.colonneMarquages !== true || typeof version.partagesDe !== 'function') return [];
    const p = version.partagesDe(id);
    return Array.isArray(p) ? p : [];
}

function fournisseurDe(version, verdicts) {
    if (!version || version.colonneJumeaux !== true || typeof version.jumeauxDe !== 'function') return NE_CONCLUT_PAS('jumeaux-indisponibles');
    if (verdicts !== undefined && !(verdicts instanceof Map)) return NE_CONCLUT_PAS('jumeaux-indisponibles');
    const f = id => {
        if (verdicts !== undefined) {
            const v = verdicts.get(id);
            if (v === 'perime') return { conclu: false, ids: [], motif: 'jumeaux-perimes' };
            if (v !== 'ok') return { conclu: false, ids: [], motif: 'jumeaux-indisponibles' };
        }
        const j = version.jumeauxDe(id);
        if (j === null || j === undefined) return { conclu: false, ids: [], motif: 'jumeaux-indisponibles' };
        const partages = partagesDeLaVersion(version, id);
        return { conclu: true, ids: partages.length ? [...new Set([...j, ...partages])].sort((a, b) => a - b) : j, ...(partages.length ? { partages } : {}) };
    };
    // M1 (relecture r1) : les partenaires d'un produit QUELCONQUE (un candidat d'une question de la chaîne n'est pas « affirmé » : le contrôle de péremption ci-dessus ne le couvre pas, la colonne des marquages seule suffit)
    f.partagesDe = id => partagesDeLaVersion(version, id);
    return f;
}
/** Les partenaires de partage d'un produit selon le fournisseur (`partagesDe`), ou [] (fournisseur de banc, archive d'avant). */
function partagesDuFournisseur(f, id) {
    try { const p = f && typeof f.partagesDe === 'function' ? f.partagesDe(id) : []; return entiers(p) ? [...new Set(p)].filter(i => i !== id) : []; } catch { return []; }
}

const idsDe = xs => [...new Set((Array.isArray(xs) ? xs : []).map(c => c && c.idProduct).filter(Number.isInteger))];
const MOTIFS_EGALITE_EN_QUESTION = Object.freeze(['egalite-parfaite', 'nom-contredit-egalite']);     // PAS nom-contredit-sans-repli : le nom y CONTREDIT les candidats, jamais une question

/**
 * UN-CANDIDAT (D1) : le produit UNIQUE qu'une réponse non affirmée désigne — une ambiguë qui n'a qu'un candidat, ou une égalité dont l'UNION (corps + `extra` = ctx.candidatsDeRefus) n'en compte qu'un.
 * C'est lui qui passe par la garde des jumeaux avant de devenir une question « est-ce cette carte ? ». null : pas de candidat unique (0, 2 ou plus, sans-repli, une affirmation, un refus).
 */
function candidatUniqueDe(corps, extra = []) {
    if (!corps || typeof corps !== 'object') return null;
    if (corps.success === true) {
        const c = corps.carte;
        if (!c || typeof c !== 'object' || c.ambigu !== true) return null;
        const ids = idsDe(corps.candidats);
        return ids.length === 1 ? ids[0] : null;
    }
    if (corps.success === false && corps.natureRefus === 'refus-delibere' && MOTIFS_EGALITE_EN_QUESTION.includes(corps.motifRefus)) {
        const union = [...new Set([...idsDe(corps.candidats), ...idsDe(extra)])];
        return union.length === 1 ? union[0] : null;
    }
    return null;
}

/** Les produits qu'une réponse de la chaîne AFFIRME (success et ambigu faux), ou désigne comme CANDIDAT UNIQUE (UN-CANDIDAT) : les seuls pour lesquels la garde est consultée, donc les seuls à vérifier. */
function idsAffirmes(corps) {
    const c = corps && typeof corps === 'object' ? corps.carte : null;
    if (corps && corps.success === true && c && c.ambigu === false && Number.isInteger(c.idProduct)) return [c.idProduct];
    const u = candidatUniqueDe(corps);
    return u === null ? [] : [u];
}

/**
 * JUMEAUX-VERDICTS (drapeau V2_JUMEAUX_PREPARER_TOUS, cfg.jumeauxPreparerTous, éteint par défaut) : les produits dont un VERDICT doit être préparé avant l'adaptation. L'adaptateur retire d'abord les candidats que le nom lu
 * contredit, puis passe par `garde()` le candidat resté seul (candidatUnique) — un candidat que `idsAffirmes` (calculé sur le corps BRUT : 2 candidats = aucun id) n'avait pas préparé, donc « la colonne ne conclut pas » :
 * une panne INDISPONIBLE à tort (3 scans sur 50, essai e833578c).
 * Écrit par ce qu'il AUTORISE : le produit affirmé / candidat unique d'abord (jamais coupé par la borne), puis les candidats d'une réponse que l'adaptateur sait lire (une réussite, ou une égalité délibérée :
 * `extra` = ctx.candidatsDeRefus), et rien d'autre — un refus technique ou une réponse inconnue ne prépare que ce que `idsAffirmes` prépare. BORNES : MAX_PREPARES (10, le pool de la chaîne) ids par RÉPONSE ;
 * pour un LOT, MAX_PREPARES_LOT (40) ids AU TOTAL, toutes cartes confondues (`idsAPreparerLot`) : d'abord l'affirmé de chaque carte, puis les autres candidats carte par carte, à tour de rôle. Un id au-delà de la borne
 * n'est pas préparé : il reste « ne conclut pas » (la panne d'avant), jamais un « ok ».
 */
const MAX_PREPARES = 10;
const MAX_PREPARES_LOT = 40;
const CONCURRENCE_VERDICTS = 4;                  // requêtes de verdict en vol à la fois
const MAX_TIME_MS_VERDICT = 1500;                // côté base, par requête (même valeur que la requête des impressions)
const DELAI_VERDICTS_MS = 3000;                  // côté serveur, pour TOUTE la préparation (même valeur que DELAI_PREPARATION_MS de langue-decisive.js) : au-delà, les ids restants ne concluent pas
function idsAPreparer(corps, extra = []) {
    const base = idsAffirmes(corps);
    if (!corps || typeof corps !== 'object') return base;
    const lisible = corps.success === true || (corps.success === false && corps.natureRefus === 'refus-delibere' && MOTIFS_EGALITE_EN_QUESTION.includes(corps.motifRefus));
    if (!lisible) return base;
    return [...new Set([...base, ...idsDe(corps.candidats), ...(corps.success === false ? idsDe(extra) : [])])].slice(0, MAX_PREPARES);
}
/** Le budget d'un LOT : au plus `budget` ids au total. Ordre : l'affirmé de chaque carte, puis les autres candidats carte par carte à tour de rôle (le 1er de chaque carte, puis le 2e de chaque carte…). */
function idsAPreparerLot(corpsListe, budget = MAX_PREPARES_LOT) {
    const liste = Array.isArray(corpsListe) ? corpsListe : [];
    const bases = liste.map(c => idsAffirmes(c));
    const restes = liste.map((c, i) => idsAPreparer(c).filter(id => !bases[i].includes(id)));
    const sortie = new Set();
    for (const b of bases) for (const id of b) if (sortie.size < budget) sortie.add(id);
    for (let rang = 0; sortie.size < budget && restes.some(r => rang < r.length); rang++) {
        for (const r of restes) if (rang < r.length && sortie.size < budget) sortie.add(r[rang]);
    }
    return [...sortie];
}
const codeSur = e => String((e && (e.code || e.name)) || 'ERREUR').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 40) || 'ERREUR';

/**
 * Le fournisseur de PRODUCTION : la version EN PLACE, et, pour chacun des produits que la chaîne AFFIRME, UNE requête indexée dans le catalogue de la route — « existe-t-il un produit PLUS RÉCENT que
 * l'archive (idProduct > maxArchive) de la même métacarte ? ». Oui → ce produit-là seul ne conclut pas (`jumeaux-perimes`) ; non → la colonne s'applique ; la requête échoue, la méthode manque, la
 * métacarte du produit est inconnue → il ne conclut pas non plus (on échoue fermé). Sans colonne, le catalogue n'est même pas interrogé.
 * opts.tous (drapeau allumé) : requêtes en parallèle (CONCURRENCE_VERDICTS), chacune sous maxTimeMS, le tout sous DELAI_VERDICTS_MS (opts.delaiMs) ; un délai dépassé = « indisponible », jamais « ok » ; UN avertissement
 * agrégé par appel ; opts.deja (Map de verdicts déjà établis pour cette requête) : ces ids ne sont pas redemandés. Éteint (opts absent) : la boucle en série d'avant, sans journal.
 */
async function fournisseurParDefaut(catalogue, version, idsAffirmes, opts = {}) {
    if (!version || version.colonneJumeaux !== true || typeof version.empreinteJumeaux !== 'function' || typeof version.metacarteJumeaux !== 'function') return NE_CONCLUT_PAS('jumeaux-indisponibles');
    const verdicts = new Map();
    const emp = version.empreinteJumeaux();
    const ids = [...new Set(Array.isArray(idsAffirmes) ? idsAffirmes : [])];
    if (opts && opts.tous === true) return fournisseurParallele(catalogue, version, ids, emp, verdicts, opts);
    for (const id of ids) {
        const meta = version.metacarteJumeaux(id);
        if (!empreinteValide(emp) || meta === null || !catalogue || typeof catalogue.plusRecentDansMetacarte !== 'function') { verdicts.set(id, 'indisponible'); continue; }
        try { const r = await catalogue.plusRecentDansMetacarte(emp.max, meta); verdicts.set(id, r === false ? 'ok' : r === true ? 'perime' : 'indisponible'); }   // « ok » seulement sur un FAUX franc
        catch { verdicts.set(id, 'indisponible'); }
    }
    return fournisseurDe(version, verdicts);
}
async function fournisseurParallele(catalogue, version, ids, emp, verdicts, opts) {
    const deja = opts.deja instanceof Map ? opts.deja : new Map();
    const delai = Number.isInteger(opts.delaiMs) && opts.delaiMs > 0 ? opts.delaiMs : DELAI_VERDICTS_MS;
    const concurrence = Number.isInteger(opts.concurrence) && opts.concurrence > 0 ? opts.concurrence : CONCURRENCE_VERDICTS;
    const reste = [];
    for (const [k, v] of deja) verdicts.set(k, v);                                                // TOUS les verdicts déjà établis pour cette requête sont reportés (ceux des candidats comme ceux de l'affirmé)
    for (const id of ids) {
        if (deja.has(id)) continue;                                                               // déjà établi : jamais redemandé (un « indisponible » reste fermé)
        const meta = version.metacarteJumeaux(id);
        if (!empreinteValide(emp) || meta === null || !catalogue || typeof catalogue.plusRecentDansMetacarte !== 'function') { verdicts.set(id, 'indisponible'); continue; }
        reste.push({ id, meta });
    }
    const echecs = []; let clos = false, minuterie = null, suivant = 0;
    const travailleur = async () => {
        while (!clos && suivant < reste.length) {
            const { id, meta } = reste[suivant++];
            let v = 'indisponible';
            try { const r = await catalogue.plusRecentDansMetacarte(emp.max, meta, { maxTimeMS: MAX_TIME_MS_VERDICT }); v = r === false ? 'ok' : r === true ? 'perime' : 'indisponible'; }
            catch (err) { echecs.push(codeSur(err)); }
            if (!clos) verdicts.set(id, v);                                                       // un résultat arrivé APRÈS le délai est ignoré : l'id reste « indisponible »
        }
    };
    if (reste.length) {
        const delaiGlobal = new Promise(res => { minuterie = setTimeout(() => res('delai'), delai); });
        const fini = Promise.all(Array.from({ length: Math.min(concurrence, reste.length) }, travailleur)).then(() => 'fini');
        const issue = await Promise.race([fini, delaiGlobal]);
        clos = true; if (minuterie) clearTimeout(minuterie);
        for (const { id } of reste) if (!verdicts.has(id)) { verdicts.set(id, 'indisponible'); if (issue === 'delai') echecs.push('DELAI'); }
    }
    if (echecs.length) console.warn(`⚠️ [jumeaux-v2] verdicts impossibles : ${echecs.length} sur ${ids.length} (codes : ${[...new Set(echecs)].slice(0, 5).join(',')})`);
    const f = fournisseurDe(version, verdicts);
    f.verdicts = verdicts;                                                                          // pour que la préparation de LANGUE-DECISIVE réutilise ces verdicts au lieu de refaire les requêtes
    return f;
}

/** Les produits à charger EN PLUS pour que l'adaptateur puisse poser la question d'une affirmation : ses jumeaux (au plus MAX_CHARGE) — au plus 2 tiennent dans la question, au-delà le choix des 3 a besoin de leurs lignes. */
function idsACharger(corps, fournisseur) {
    if (typeof fournisseur !== 'function') return [];
    // M1 : les partenaires de partage de CHAQUE candidat d'une question de la chaîne (sans leur ligne, la question ne pourrait pas les montrer)
    const candidats = corps && typeof corps === 'object' && Array.isArray(corps.candidats) ? idsDe(corps.candidats) : [];
    const partenaires = candidats.flatMap(c => partagesDuFournisseur(fournisseur, c)).filter(i => !candidats.includes(i));
    const p = idsAffirmes(corps)[0];                                    // le produit affirmé, ou le candidat UNIQUE (UN-CANDIDAT)
    let ids = [];
    if (p !== undefined) {
        try {
            const r = fournisseur(p);
            if (r && r.conclu === true && entiers(r.ids)) { const x = [...new Set(r.ids)].filter(i => i !== p); if (x.length >= 1 && x.length <= MAX_CHARGE) ids = x; }
        } catch { ids = []; }
    }
    return [...new Set([...ids, ...partenaires])];
}

/**
 * La décision pour UNE affirmation de la chaîne.
 * @returns {{ action: 'affirmer' } | { action: 'question', ids: number[] } | { action: 'nombreux', ids: number[] } | { action: 'panne', motif: string }}   (`nombreux` : P d'abord puis tous ses jumeaux, plus de 3 produits)
 * ctx : { jumeaux: (idProduct) => { conclu, ids, motif? }, produits: Map<idProduct, ligne> }
 */
function garde(ctx, idProduct, sonde = false) {                       // sonde : un candidat que la résolution de LANGUE-DECISIVE interroge sans qu'il soit affirmé — ni compteur ni journal (m-2)
    const noterGarde = sonde ? () => { } : noter;
    const introuvable = (motif, detail) => { noterGarde(motif, idProduct, detail); return { action: 'introuvable', motif }; };
    const panne = (motif, detail) => { noterGarde(motif, idProduct, detail); return { action: 'panne', motif }; };
    const f = ctx && ctx.jumeaux;
    if (typeof f !== 'function') return panne('jumeaux-indisponibles', '(aucun fournisseur)');
    let r;
    try { r = f(idProduct); } catch { return panne('jumeaux-indisponibles', '(fournisseur en erreur)'); }
    if (!r || typeof r !== 'object') return panne('jumeaux-indisponibles', '(forme inconnue)');
    if (r.conclu === false) return panne(MOTIFS_PANNE.includes(r.motif) ? r.motif : 'jumeaux-indisponibles', '(la colonne ne conclut pas)');
    if (r.conclu !== true || !entiers(r.ids)) return panne('jumeaux-indisponibles', '(forme inconnue)');
    const jumeaux = [...new Set(r.ids)].filter(i => i !== idProduct);
    if (!jumeaux.length) return { action: 'affirmer' };
    // M1 : les partenaires de partage (l'image ne les sépare pas de P) : ils ne sont JAMAIS coupés d'une question ; l'adaptateur les met en premier
    const partages = entiers(r.partages) ? [...new Set(r.partages)].filter(i => i !== idProduct && jumeaux.includes(i)) : [];
    if (1 + jumeaux.length > MAX_PRODUITS) return { action: 'nombreux', ids: [idProduct, ...jumeaux], partages };     // l'adaptateur choisit les 3 (ou retombe sur l'introuvable, et COMPTE alors jumeaux-trop-nombreux)
    const produits = ctx.produits instanceof Map ? ctx.produits : new Map();
    if (!produits.has(idProduct) || jumeaux.some(i => !produits.has(i))) return panne('jumeaux-incomplets', '(un produit sans ligne au catalogue de l\'API)');
    noterGarde('question-de-jumeaux', idProduct, `(${1 + jumeaux.length} produits)`);
    return { action: 'question', ids: [idProduct, ...jumeaux], partages };
}

module.exports = { garde, fournisseurDe, partagesDeLaVersion, partagesDuFournisseur, fournisseurParDefaut, idsAffirmes, idsAPreparer, idsAPreparerLot, idsACharger, candidatUniqueDe, compteurs, noter, MOTIFS, MOTIFS_PANNE, MAX_PRODUITS, MAX_CHARGE, MAX_PREPARES, MAX_PREPARES_LOT, CONCURRENCE_VERDICTS, MAX_TIME_MS_VERDICT, DELAI_VERDICTS_MS };
