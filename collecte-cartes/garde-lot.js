// ============================================================
// LA GARDE DE LOT : fiches, illustrateurs, images et noms, comparés SET PAR SET avant et après chaque lot (2026-09-24)
// ============================================================
// 🔴 LA RÈGLE DU TESTEUR (2026-09-24), après trois lots dits additifs qui ont effacé à côté de ce qu'ils ajoutaient (§59) :
// « une recollecte réécrit, elle n'est pas additive ». Chaque lot compare donc automatiquement ses compteurs PAR GROUPE ;
// un seul compteur qui baisse sans avoir été annoncé par la simulation arrête le lot, qui se restaure depuis sa sauvegarde
// et le journalise (lot-additif.js). Un TOTAL ne suffit pas : xASC ajoutait 262 fiches et effaçait 1 363 illustrateurs.
//
// 🔑 LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE. Une baisse passe dans deux cas, et deux seulement :
//   1. ANNONCÉE — la simulation du lot l'a comptée, et la baisse réelle ne la dépasse pas ;
//   2. IMAGES d'un set où le WORKER a travaillé pendant la fenêtre du lot — prouvé par `collecte_images_etat`, jamais
//      supposé. Le worker retire puis remet les images d'un set en trois écritures séparées (collecteur-images-tcgdex.js).
// Tout le reste bloque, un groupe qui disparaît compris (baisse jusqu'à 0).
//
// Les compteurs se comptent dans des DOCUMENTS, par une seule fonction : le « avant » dans la sauvegarde elle-même (ce qu'on
// restaurerait), le « après » dans la base, et le banc (test-garde-lot.js) dans des documents fabriqués. Même code partout :
// la sonde ne diverge pas de la production (en tête du catalogue).
const { EJSON } = require('mongodb').BSON;
const { estMatiereSpeciale } = require('./matiere-speciale');

// L'ordre est celui de l'impression ; chaque compteur nomme son groupe.
const COMPTEURS = Object.freeze({
    'fiches': 'produits distincts rattachés à une carte, par expansion Cardmarket (cartes_produits.idExpansion)',
    'cartes': 'cartes membres du set (cartes.sets)',
    'noms-cartes': 'cartes du set qui portent un nomEn',
    // ➕ 2026-10-07 (nuit) : le site lit `categorie` (page de la carte, listes d'espèces) ; une catégorie effacée ne faisait bouger rien
    'categories-cartes': 'cartes du set qui portent une catégorie',
    // ➕ 2026-09-24 : une impression écrite depuis la Setlist (sans illustrateur) qu'une relecture efface ne faisait bouger
    // aucun compteur — « illustrateurs » ne compte que les impressions qui portent le champ.
    'impressions': 'impressions de cartes, toutes, par tirage et expansion',
    'illustrateurs': 'impressions qui portent le champ illustrateur (null compris : il porte sa raison), par tirage et expansion',
    'illustrateurs-nommes': 'impressions dont l\'illustrateur est un nom',
    'images': 'entrées de cartes.images, par set',
    // ➕ 2026-10-08 : un rejeu de jointure a effacé `vignette` de 1 089 entrées sans qu'aucun compteur bouge — (set, cleR2, numero)
    // ne changent pas. Le site lit la vignette (grilles) : une vignette effacée est une baisse. Dispensée seulement dans un set où le
    // worker a écrit pendant la fenêtre (comme les images).
    'vignettes-images': 'entrées de cartes.images qui portent une vignette, UNE CLÉ PAR ENTRÉE (set|carte|numero|cleR2)',
    // ➕ 2026-10-08 (2e relecture) : le NOMBRE de vignettes du set, en plus des clés — un remplacement d'image à compte égal (l'entrée change
    // de cleR2 et perd sa vignette) saute la clé disparue et laisse `images` égal : seul ce nombre le voit. S'annonce aussi : un retrait de
    // masse voulu s'annonce PAR SET (« vignettes-set set:S » : K), qui couvre les K clés perdues et le nombre.
    'vignettes-set': 'nombre d\'entrées de cartes.images qui portent une vignette, par set',
    'nom-affiche': 'le set porte un nomAffichage',
    // ➕ 2026-10-17 (PP-HOLO) : le champ explicite `partageeHoloNonHolo: true` (le scan tamponné sert le produit holo ET le non-holo ; l'API ne tranche jamais le brillant par l'image).
    // Un rejeu qui l'efface laisse `images` et les vignettes intacts : seul ce compteur le voit. Jamais dispensé par le worker (il n'écrit pas ce champ) ; s'annonce (retrait partiel voulu).
    'images-partagees-holo': 'entrées de cartes.images marquées partageeHoloNonHolo: true, par set',
    // ➕ 2026-10-17 (BS-STAFF) : le champ explicite `partageeTamponNonSepare: true` (l'image servie aux deux produits V1/V2 d'une promo Black Star ne montre pas le tampon Staff / Play! Pokémon ; le site
    // affiche « tampon non représenté »). Même raison que le compteur holo, et il ne se confond pas avec lui. Jamais dispensé par le worker ; s'annonce (retrait voulu : marquer-partage-tampon.js --retirer).
    'images-partagees-tampon': 'entrées de cartes.images marquées partageeTamponNonSepare: true, par set'
});

/** @returns {Map<string, number>} « <compteur> <groupe> » → n */
function compterEtat({ cartes = [], cartesProduits = [], sets = [] }) {
    const m = new Map();
    const inc = k => m.set(k, (m.get(k) || 0) + 1);
    const vus = new Set();
    // 🔴 LOT METAL (correction 1, I1) : les lignes et les liens.idProduct qui portent un produit de la table fermée (matiere-speciale.js, lue, jamais recopiée) sont comptés à part ;
    // `comparer` arrête tout lot qui en FAIT AUGMENTER le compte (une ligne déjà là avant n'est pas le fait du lot).
    // (correction 2, M-1) le compte est PAR LIGNE (_id) et par couple (carte, produit) pour les liens : remplacer la ligne X par la ligne Y sur le même produit (1 → 1) est une hausse de Y
    for (const l of cartesProduits) if (estMatiereSpeciale(l.idProduct)) inc(`matiere-speciale prod:${Number(l.idProduct)} ligne:${l._id ?? `${l.carteId}|${l.idProduct}`}`);
    for (const c of cartes) for (const id of new Set(c.liens?.idProduct || [])) if (estMatiereSpeciale(id)) inc(`matiere-speciale prod:${Number(id)} lien:${c._id}`);
    for (const l of cartesProduits) {
        const k = `${l.idExpansion}|${l.idProduct}`;
        if (vus.has(k)) continue;
        vus.add(k);
        inc(`fiches exp:${l.idExpansion}`);
    }
    for (const c of cartes) {
        for (const s of new Set(c.sets || [])) {
            inc(`cartes set:${s}`);
            if (c.nomEn) inc(`noms-cartes set:${s}`);
            if (c.categorie) inc(`categories-cartes set:${s}`);
        }
        for (const i of c.impressions || []) {
            if (!i) continue;
            const g = `imp:${i.tirage}|${i.expansion}`;
            inc(`impressions ${g}`);
            if ('illustrateur' in i) inc(`illustrateurs ${g}`);
            if (typeof i.illustrateur === 'string' && i.illustrateur) inc(`illustrateurs-nommes ${g}`);
        }
        for (const im of c.images || []) if (im) {
            inc(`images set:${im.set}`);
            if (im.partageeHoloNonHolo === true) inc(`images-partagees-holo set:${im.set}`);
            if (im.partageeTamponNonSepare === true) inc(`images-partagees-tampon set:${im.set}`);
            // une clé PAR ENTRÉE (set|carte|numero|cleR2) : un nombre par set laissait passer « une perdue, une gagnée » (relecture 2026-10-08)
            const g = `set:${im.set}|${c._id}|${im.numero ?? ''}|${im.cleR2 ?? ''}`;
            inc(`entrees-cles ${g}`);   // interne (hors COMPTEURS) : dit si l'entrée existe encore, pour ne pas compter deux fois sa disparition
            if (im.vignette) { inc(`vignettes-images ${g}`); inc(`vignettes-set set:${im.set}`); }
        }
    }
    for (const s of sets) if (s.nomAffichage) inc(`nom-affiche set:${s._id}`);
    return m;
}

const decouper = cle => { const i = cle.indexOf(' '); return [cle.slice(0, i), cle.slice(i + 1)]; };

/**
 * @param {Map} avant @param {Map} apres
 * @param {{annonces?: Object<string, number>, setsDuWorker?: Set<string>}} [o]
 * @returns {{baisses: object[], nonAutorisees: object[], hausses: Object<string, number>, groupes: number, annoncesNonRealisees: object[]}}
 */
function comparer(avant, apres, { annonces = {}, setsDuWorker = new Set() } = {}) {
    const baisses = [], hausses = {};
    const setDe = groupe => groupe.replace(/^set:/, '').split('|')[0];
    // vignettes : l'annonce PAR SET est un budget que consomment les clés perdues ; une clé annoncée ou dispensée « explique » aussi la
    // baisse du nombre de vignettes du set ; une entrée disparue l'explique seulement dans la mesure où `images` du set a réellement baissé
    const budgetSet = new Map(), expliquees = new Map(), disparues = new Map();
    for (const [cle, a] of Object.entries(annonces)) { const [c, g] = decouper(cle); if (c === 'vignettes-set') budgetSet.set(setDe(g), a); }
    const pousse = (m, s, k = 1) => m.set(s, (m.get(s) || 0) + k);
    for (const [cle, n] of avant) {
        const m = apres.get(cle) || 0;
        if (m >= n) continue;
        const [compteur, groupe] = decouper(cle);
        if (compteur === 'entrees-cles' || compteur === 'vignettes-set' || compteur === 'matiere-speciale') continue;   // interne / traité après
        // l'entrée a disparu : c'est une baisse d'IMAGES (comptée par set), pas en plus une baisse de vignette
        if (compteur === 'vignettes-images' && !apres.get(`entrees-cles ${groupe}`)) { pousse(disparues, setDe(groupe), n - m); continue; }
        const baisse = n - m, annonce = annonces[cle] || 0;
        // dispense du worker : même preuve (ses propres dates, sets de la fenêtre) pour les images et leurs vignettes — il réécrit des
        // entrées puis les revignette (collecteur-images.js)
        const setDuGroupe = setDe(groupe);
        let autorisee = baisse <= annonce ? 'annoncée'
            : (compteur === 'images' || compteur === 'vignettes-images') && setsDuWorker.has(setDuGroupe) ? 'worker' : null;
        if (autorisee && compteur === 'vignettes-images') pousse(expliquees, setDuGroupe, baisse);
        if (!autorisee && compteur === 'vignettes-images' && (budgetSet.get(setDuGroupe) || 0) >= baisse) { pousse(budgetSet, setDuGroupe, -baisse); autorisee = 'annoncée'; }
        baisses.push({ cle, compteur, groupe, avant: n, apres: m, baisse, annonce, autorisee });
    }
    for (const [cle, n] of avant) {
        const [compteur, groupe] = decouper(cle);
        if (compteur !== 'vignettes-set') continue;
        const m = apres.get(cle) || 0;
        if (m >= n) continue;
        const s = setDe(groupe), baisse = n - m, annonce = annonces[cle] || 0;
        const imgBaisse = Math.max(0, (avant.get(`images ${groupe}`) || 0) - (apres.get(`images ${groupe}`) || 0));
        const explication = (expliquees.get(s) || 0) + Math.min(disparues.get(s) || 0, imgBaisse);
        const autorisee = baisse <= annonce + explication ? (baisse <= annonce ? 'annoncée' : 'expliquée par les clés')
            : setsDuWorker.has(s) ? 'worker' : null;
        baisses.push({ cle, compteur, groupe, avant: n, apres: m, baisse, annonce, autorisee });
    }
    for (const [cle, m] of apres) {
        const d = m - (avant.get(cle) || 0);
        if (d > 0) {
            const [compteur, groupe] = decouper(cle);
            // LOT METAL : une ligne ou un lien sur un produit en matière spéciale POSÉ par ce lot = ARRÊT (jamais autorisé, jamais annonçable)
            if (compteur === 'matiere-speciale') { baisses.push({ cle, compteur, groupe, avant: avant.get(cle) || 0, apres: m, baisse: 0, annonce: 0, autorisee: null, motif: 'produit en matière spéciale (table fermée) : un trou, jamais la fiche de la carte normale' }); continue; }
            if (compteur !== 'entrees-cles') hausses[compteur] = (hausses[compteur] || 0) + d;
        }
    }
    const annoncesNonRealisees = Object.entries(annonces)
        .map(([cle, a]) => ({ cle, annonce: a, baisse: baisses.find(b => b.cle === cle)?.baisse || 0 }))
        .filter(x => x.baisse !== x.annonce);
    return { baisses, nonAutorisees: baisses.filter(b => !b.autorisee), hausses, groupes: new Set([...avant.keys(), ...apres.keys()]).size, annoncesNonRealisees };
}

/** Une annonce qui nomme un compteur inconnu est une faute de frappe : elle laisserait la vraie baisse non annoncée. */
function validerAnnonces(annonces) {
    const fautes = Object.keys(annonces).filter(k => !(decouper(k)[0] in COMPTEURS) || !(Number.isInteger(annonces[k]) && annonces[k] > 0));
    if (fautes.length) throw new Error(`annonce(s) invalide(s) : ${fautes.join(' · ')} — compteurs connus : ${Object.keys(COMPTEURS).join(', ')} ; valeur = entier > 0`);
}

// Une forme canonique : types BSON explicites (12 n'est pas « 12 », une Date n'est pas sa chaîne), clés triées à toute
// profondeur (l'ordre des champs d'un document n'est pas une différence).
const trier = v => Array.isArray(v) ? v.map(trier)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, trier(v[k])])) : v;
const canon = v => JSON.stringify(trier(EJSON.serialize({ v }, { relaxed: false })));
const cleDoc = id => canon(id);

/**
 * Ce qu'il faut écrire pour ramener `actuels` à `sauves`, sauf les champs `garder(doc)` (ceux du worker), laissés tels
 * qu'ils sont maintenant. @param {Map} sauves @param {Map} actuels — clé : cleDoc(_id)
 */
function planRestauration(sauves, actuels, { garder = () => [], surcharge = null } = {}) {
    const plan = { inserer: [], supprimer: [], remplacer: [], champs: {} };
    for (const [k, d] of sauves) {
        const a = actuels.get(k);
        if (!a) { plan.inserer.push(d); continue; }
        const cible = { ...d };
        for (const f of garder(d, a)) { if (f in a) cible[f] = a[f]; else delete cible[f]; }
        // (tour 2) `surcharge(d, a)` : des champs calculés (le tableau `images` restauré entrée par entrée) posés APRÈS ce qui est gardé
        if (surcharge) Object.assign(cible, surcharge(d, a));
        const differents = [...new Set([...Object.keys(cible), ...Object.keys(a)])].filter(f => canon(cible[f]) !== canon(a[f]));
        if (!differents.length) continue;
        for (const f of differents) plan.champs[f] = (plan.champs[f] || 0) + 1;
        plan.remplacer.push(cible);
    }
    for (const [k, a] of actuels) if (!sauves.has(k)) plan.supprimer.push(a._id);
    return plan;
}

// ── (tour 2, D1) LA RESTAURATION DU TABLEAU `images` ENTRÉE PAR ENTRÉE. Sur un arrêt dû au contrat de l'API, remettre le tableau d'UNE carte fautive laissait les écritures du lot sur les 11 autres entrées marquées
// (lot B du 19/10 : 12 entrées marquées, une seule fautive) pendant que les lignes `cartes_produits` revenaient : un état que l'API refuse. Chaque entrée que le LOT a modifiée revient donc à sa version sauvegardée,
// sur TOUTES les cartes, et ce que le WORKER a écrit pendant la fenêtre reste.
// QUI A ÉCRIT ? Une seule règle, celle de garde-lot : les sets où le worker a travaillé pendant la fenêtre (`setsDuWorker`, prouvé par `collecte_images_etat` dans lot-additif.js). Dans un set sans worker, tout
// changement est le fait du lot. Dans un set du worker, on regarde le CHAMP : les marquages ci-dessous sont posés par les scripts du catalogue, JAMAIS par le worker (garde-lot l'écrit déjà : « Jamais dispensé par le
// worker ») ; ils reviennent, le reste (vignette, taille, source…) est au worker.
// UNE ENTRÉE = (set, cleR2), comparée sur la projection SITE_LIT.images. Ce qui n'est pas décidable (deux entrées de même clé, une entrée sans set ou sans cleR2) est NOMMÉ dans `indecidables` et l'état actuel
// est gardé tel quel : l'appelant sort en code d'échec, jamais « RESTAURÉ » en silence.
// (tour 3, E3) `basseDefinition` n'en fait PAS partie : le worker l'écrit aussi (marqueDe / remplacerBasseDefinition des collecteurs tcgdex et bulba). Dans un set du worker, une entrée de même clé dont ce champ diffère ne se tranche
// pas (AMBIGUS_WORKER) : indécidable nommé, jamais deviné. Hors de ces sets, il revient comme n'importe quelle écriture du lot (l'entrée entière).
const MARQUAGES_DU_LOT = Object.freeze(['partageeHoloNonHolo', 'partageeTamponNonSepare', 'produitsPartages', 'tamponNonRepresente', 'mention', 'noteVariante', 'imageEmprunteeTirage']);
const AMBIGUS_WORKER = Object.freeze(['basseDefinition']);
const cleEntree = m => (m && typeof m.set === 'string' && m.set && typeof m.cleR2 === 'string' && m.cleR2 ? `${m.set}|${m.cleR2}` : null);
// un champ d'entrée d'image tel que la comparaison le lit : la vignette sur sa forme figée (SITE_LIT.formes), le reste tel quel
const champEntree = (m, k) => (k === 'vignette' ? SITE_LIT.formes['images.vignette'].map(f => valeur(m, `vignette.${f}`)) : valeur(m, k));
/** @returns {{images: object[], restaurees: object[], gardees: object[], indecidables: object[]}} — pure : ne modifie ni `sauvees` ni `actuelles` */
function restaurerImages(sauvees, actuelles, { setsDuWorker = new Set() } = {}) {
    const S = (sauvees || []).filter(Boolean), A = (actuelles || []).filter(Boolean);
    const rapport = { images: A, restaurees: [], gardees: [], indecidables: [] };
    const note = (liste, m, raison) => liste.push({ set: m?.set ?? null, cleR2: m?.cleR2 ?? null, raison });
    const champsSite = SITE_LIT.images.filter(k => k !== 'set' && k !== 'cleR2');
    // 0. (tour 3, E2) une carte dont `images` NE DIFFÈRE PAS (sur ce que le site lit) entre la sauvegarde et l'état actuel n'a rien à restaurer : un doublon de clé ou une entrée sans clé sur une carte que le lot n'a pas touchée
    // n'est pas un indécidable (sinon tout arrêt dû au contrat sortait en code 4 à cause d'une carte sans rapport)
    const proj = L => L.map(m => [m.set ?? null, m.cleR2 ?? null, ...champsSite.map(k => champEntree(m, k))]);
    if (signature(proj(S)) === signature(proj(A))) return rapport;
    // 1. l'indécidable d'abord : une clé absente ou en double, d'un côté ou de l'autre
    const vuS = new Map(), vuA = new Map();
    for (const [liste, vu, cote] of [[S, vuS, 'sauvegarde'], [A, vuA, 'état actuel']]) for (const m of liste) {
        const k = cleEntree(m);
        if (!k) { note(rapport.indecidables, m, `entrée sans set ou sans cleR2 (${cote})`); continue; }
        if (vu.has(k)) note(rapport.indecidables, m, `deux entrées de même (set, cleR2) (${cote})`);
        vu.set(k, (vu.get(k) || 0) + 1);
    }
    if (rapport.indecidables.length) return rapport;
    const mapA = new Map(A.map(m => [cleEntree(m), m])), dedans = new Set(S.map(cleEntree));
    const images = [];
    for (const s of S) {
        const k = cleEntree(s), a = mapA.get(k), duWorker = setsDuWorker.has(s.set);
        if (!a) {
            if (duWorker) note(rapport.gardees, s, 'retirée pendant la fenêtre du worker : il retire puis remet, elle reste retirée');
            else { images.push(structuredClone(s)); note(rapport.restaurees, s, 'retirée par le lot : réinsérée'); }
            continue;
        }
        const diff = champsSite.filter(f => signature(champEntree(s, f)) !== signature(champEntree(a, f)));
        if (!diff.length) { images.push(a); continue; }
        if (!duWorker) { images.push(structuredClone(s)); note(rapport.restaurees, s, `modifiée par le lot (${diff.join(', ')}) : version sauvegardée`); continue; }
        const ambigus = diff.filter(f => AMBIGUS_WORKER.includes(f));
        if (ambigus.length) { images.push(a); note(rapport.indecidables, s, `${ambigus.join(', ')} diffère dans un set où le worker a écrit : le lot et le worker l'écrivent tous les deux, rien n'est deviné`); continue; }
        const marq = diff.filter(f => MARQUAGES_DU_LOT.includes(f)), autres = diff.filter(f => !MARQUAGES_DU_LOT.includes(f));
        if (!marq.length) { images.push(a); note(rapport.gardees, s, `écrite par le worker (${autres.join(', ')})`); continue; }
        const fusion = { ...a };
        for (const f of marq) { if (f in s) fusion[f] = structuredClone(s[f]); else delete fusion[f]; }
        images.push(fusion);
        note(rapport.restaurees, s, `marquage du lot (${marq.join(', ')}) remis, set du worker`);
        if (autres.length) note(rapport.gardees, s, `écrite par le worker (${autres.join(', ')})`);
    }
    for (const a of A) {
        const k = cleEntree(a);
        if (dedans.has(k)) continue;
        if (setsDuWorker.has(a.set)) { images.push(a); note(rapport.gardees, a, 'ajoutée par le worker'); }
        else note(rapport.restaurees, a, 'ajoutée par le lot : retirée');
    }
    rapport.images = images;
    return rapport;
}

/**
 * Restauration CHIRURGICALE des vignettes (2026-10-08) : pour chaque entrée (carte, set, cleR2) des sets fautifs qui avait une vignette dans
 * la sauvegarde et n'en a plus, remettre CE champ — jamais le tableau `images`, que le worker écrit en même temps. Une entrée qui a une
 * vignette maintenant, ou n'existe plus (remplacée : autre cleR2), n'est pas touchée — ce cas s'arrête sans se restaurer, et la relecture le dit.
 * `jointeLe` n'est PAS remis : date d'audit que ni la garde ni le site ne lisent, et l'ancienne écraserait une valeur plus récente.
 * @returns {{_id, set, cleR2, vignette}[]}
 */
function planVignettes(sauvegardees, actuelles, setsFautifs) {
    const actuel = new Map(actuelles.map(d => [cleDoc(d._id), d]));
    const liste = [];
    for (const a of sauvegardees) {
        const b = actuel.get(cleDoc(a._id)); if (!b) continue;
        const mb = new Map((b.images || []).filter(Boolean).map(e => [`${e.set}|${e.cleR2}`, e]));
        for (const e of a.images || []) {
            if (!e || !e.vignette || !setsFautifs.has(e.set)) continue;
            const n = mb.get(`${e.set}|${e.cleR2}`);
            if (n && !n.vignette) liste.push({ _id: a._id, set: e.set, cleR2: e.cleR2, vignette: e.vignette });
        }
    }
    return liste;
}

// ── LES SETS TOUCHÉS PAR UN LOT (2026-09-25) — ce que la revalidation à la demande du site attend (collecte-cartes/revalider-site.js).
// Les compteurs ne suffisent pas : une date, un numeroFiche, une image remplacée à compte égal n'en font bouger aucun. On compare
// donc les DOCUMENTS, avant (la sauvegarde) et après (la base), sur ce que le site lit — et par la MÊME fonction des deux côtés.
// ⚠️ Pas `canon` : la sauvegarde relue en EJSON « relaxed » rend 12 en double quand la base le rend en int32 ; `canon` y verrait
// une différence de TYPE, donc des sets « touchés » qui ne le sont pas. Ici, une valeur JSON (une Date devient sa chaîne ISO).
const signature = v => JSON.stringify(trier(v ?? null));
// 🔑 D1 (2026-10-24) — CE QUE LE SITE LIT, UNE SEULE LISTE. Le 19/10, deux lots ont modifié des champs existants (la `variante` de 58 lignes, `tamponNonRepresente` de 12 entrées d'image, un champ d'une entrée de
// Frosmoth) ; « 6. sets touchés : 0 », rien n'a été revalidé, il a fallu le faire à la main. La projection comparée ne portait qu'une partie de ce que le site lit : un champ lu par le site et absent d'ici est une
// page qui reste vieille 30 jours, sans erreur. Cette liste est RECOPIÉE du gabarit de lecture du site (rat-market-site lib/lireDonnee.ts : SPEC_CARTE, SPEC_IMAGE_CARTE, SPEC_PRODUIT, lues le 2026-10-24) et
// elle pilote DEUX choses, pour qu'elles ne divergent jamais (§21 bis) : la projection Mongo de l'état « après » (PROJECTION_ETAT, plus bas) ET la comparaison (PROJECTION_CARTES / PROJECTION_LIGNES). Le banc
// (test-garde-lot.js) la confronte au fichier du site quand il existe. Un champ que le site ajoute se reporte ICI, une fois.
// Ce que le site NE lit PAS reste hors de la liste, et c'est voulu (le quota Vercel paie chaque page revalidée, §63) : sha256/urlOriginal/preuve/attribution/page/fmt/jointeLe d'une entrée d'image,
// collecteLe/version/champsNuls/bulba/nomFrSource/liens.idMetacards de la carte, verifieLe/detail/variantePreuve d'une ligne.
// `liens.idProduct` EST lu par le site, mais un lien posé par une jointure accompagne toujours une ligne `cartes_produits` : si une ligne de CETTE carte change dans le même lot, seul le slugSet de la ligne est touché (tour de
// correction 1 ; mesuré sur la sauvegarde d'un lot de jointure réel, FICHES du 17/10 : 11 sets avec « tous les sets de la carte », 2 avec cette règle). Un `liens` qui change SANS ligne changée pour la carte touche tous ses sets.
// `SITE_LIT` est PURE et figée ici ; lot-additif.js la confronte, à chaque lot et avant la sauvegarde, au gabarit de lecture du site importé (garde-site-lu.js).
const SITE_LIT = Object.freeze({
    cartes: Object.freeze(['categorie', 'nomEn', 'nomJa', 'nomFr', 'illustrateur', 'ndex', 'pv', 'type', 'stade', 'faiblesse', 'resistance', 'retraite', 'attaques', 'liens.idProduct', 'liens.idMetacard', 'sets']),
    impressions: Object.freeze(['tirage', 'expansion', 'deck', 'numero', 'total', 'rarete', 'illustrateur']),
    // `partageeHoloNonHolo` : non lu par lireDonnee.ts (« non lu ici »), gardé par prudence — l'avoir en trop coûte une page, l'avoir oublié coûte trente jours
    images: Object.freeze(['set', 'cleR2', 'w', 'h', 'numero', 'langue', 'languePreuve', 'source', 'mention', 'noteVariante', 'vignette', 'basseDefinition', 'partageeTamponNonSepare', 'produitsPartages', 'tamponNonRepresente', 'imageEmprunteeTirage', 'partageeHoloNonHolo']),
    // `preuve` : héritée de l'ancienne projection (le site ne la lit pas), gardée pour ne rien retirer à ce que `setsTouches` rendait
    lignes: Object.freeze(['carteId', 'idProduct', 'idExpansion', 'tirage', 'slug', 'slugSet', 'numeroFiche', 'variante', 'preuve', 'visuelSubstitut.cleR2', 'visuelSubstitut.w', 'visuelSubstitut.h', 'visuelSubstitut.mention']),
    // (tour de correction 1) les champs d'un document `sets` que le site lit (SPEC_SET de lireDonnee.ts), chemins pointés ; un chemin couvre ses sous-champs (`logo` : cleR2, w, h, set, region, langue, preuve, logoGenerique, sha1, vignette).
    sets: Object.freeze(['code', 'nomJa', 'nomAffichage', 'nomFr', 'nomFrSource', 'nomFrPreuve', 'region', 'tirage', 'dateSortieJa', 'dateSortieEn', 'periodeDistribution', 'dateSortieMois', 'totalImprime', 'idExpansion',
        'bulba.expansion', 'bulba.titre', 'bulba.pageid', 'deck', 'logo', 'logoFr', 'logoCompose', 'symbole', 'symbolesIdentification', 'serie']),
    // (tour 2, D3) Les objets que la comparaison lit à FORME FIGÉE : leurs sous-champs sont énumérés ici, et ce sont EXACTEMENT ceux que PROJECTION_CARTES / PROJECTION_SET comparent (elles lisent cette liste, pas une
    // copie). La confrontation au site (garde-site-lu.js) n'accepte sous ces chemins que ces sous-champs : un sous-champ que le site se met à lire REFUSE l'étape 0 ter, au lieu d'être « couvert » par l'ancêtre
    // alors que la comparaison ne le voit pas. (Les autres ancêtres déclarés — `logo`, `attaques`, `periodeDistribution`… — sont comparés EN ENTIER, moins la date `le` : un sous-champ nouveau y est vu.)
    formes: Object.freeze({
        'images.vignette': Object.freeze(['cleR2', 'w', 'h']),
        dateSortieMois: Object.freeze(['iso', 'texte']),
        symbolesIdentification: Object.freeze(['cleR2', 'w', 'h', 'fichier', 'source'])
    })
});
const valeur = (o, chemin) => chemin.split('.').reduce((x, k) => (x === null || x === undefined ? undefined : x[k]), o) ?? null;
// (2026-10-07, nuit) `categorie` : le site la lit (page de la carte, listes d'espèces) — elle se compare comme le nom
// (tour de correction 1) `liens` se compare À PART : il est la conséquence d'une jointure, dont la ligne `cartes_produits` porte déjà son set (voir setsTouches).
const CHAMPS_LIENS = SITE_LIT.cartes.filter(c => c.startsWith('liens.'));
const CHAMPS_AUTRES = SITE_LIT.cartes.filter(c => !['sets', 'nomEn', 'categorie'].includes(c) && !c.startsWith('liens.'));
const PROJECTION_CARTES = c => ({ sets: [...(c.sets || [])].sort(), nomEn: c.nomEn ?? null, categorie: c.categorie ?? null,
    // un `illustrateur` ABSENT n'est pas un `illustrateur: null` (« jamais évalué » / « la source ne tranche pas ») : '∅' les distingue
    impressions: (c.impressions || []).filter(Boolean).map(i => SITE_LIT.impressions.map(k => (k === 'illustrateur' ? ('illustrateur' in i ? i.illustrateur : '∅') : valeur(i, k)))),
    // (2026-10-17, BS-STAFF) le site affiche la mention « tampon non représenté » depuis ces champs ; (D1) le libellé seul (drapeau `false`), la variante de l'image, sa langue… se comparent aussi.
    // Le SET reste en tête de chaque tuple : `setsTouches` l'attribue (m[0]).
    images: (c.images || []).filter(Boolean).map(m => [m.set ?? null, ...SITE_LIT.images.filter(k => k !== 'set').map(k => (champEntree(m, k)))]),
    autres: CHAMPS_AUTRES.map(k => valeur(c, k)), liens: CHAMPS_LIENS.map(k => valeur(c, k)) });
const PROJECTION_LIGNES = l => SITE_LIT.lignes.map(k => valeur(l, k));   // VIGN-SUITE : le substitut sert une image au site ; projection de CHANGEMENT seulement, aucun groupe compté
// 🔴 2026-09-26 : un lot de logos a revalidé 156 sets pour 12 changés — le document ENTIER était comparé, et le collecteur réécrivait
// la date `le` de chaque logo et chaque motif de refus (`logoRefus`, que le site ne lit pas). Un set se compare sur les champs que le
// SITE lit : `PROJECTION_SET` de lib/cartes.ts (rat-market-site), recopiée ici — plus `dateSortieMois`, demandé au site le même
// jour — et, du logo, ce qui s'affiche (la date et la preuve n'en font pas partie). Un champ que le site ajoute se reporte ICI.
// (2026-10-07, relecture) recopiée de PROJECTION_SET (rat-market-site lib/cartes.ts, lue le 2026-10-07) : `nomFr` et sa preuve, `serie`,
// `symbolesIdentification` manquaient — un lot de noms français ne revalidait rien, comme les logos.
// (tour de correction 1) la liste vient de SITE_LIT.sets (une seule, confrontée à SPEC_SET par lot-additif.js) : les champs à comparer tels quels, puis ceux qui ont une forme à eux.
// (D1, 2026-10-24) `deck` : lu par le site depuis le 2026-10-12 (PROJECTION_SET de lib/cartes.ts, lib/impressionDuSet.ts) — un lot qui le posait ne revalidait rien
const SETS_A_FORME = new Set(['bulba.expansion', 'bulba.titre', 'bulba.pageid', 'dateSortieMois', 'logo', 'logoFr', 'logoCompose', 'symbolesIdentification']);
const CHAMPS_SET_LUS = SITE_LIT.sets.filter(k => !SETS_A_FORME.has(k));
// (tour 2, D3) une entrée POINTÉE de SITE_LIT.sets (« a.b ») qui n'a pas de forme à elle (SETS_A_FORME) serait lue par `s['a.b']` : null pour toujours, une comparaison qui ne voit rien. Elle REFUSE : au chargement
// du module, et dans la confrontation au site (garde-site-lu.js). Une entrée simple (sans point) se lit telle quelle et n'a pas besoin de forme.
const entreesSetsSansForme = (siteLit = SITE_LIT) => siteLit.sets.filter(k => k.includes('.') && !SETS_A_FORME.has(k));
{
    const sansForme = entreesSetsSansForme(SITE_LIT);
    if (sansForme.length) throw new Error(`garde-lot : SITE_LIT.sets porte ${sansForme.join(', ')} sans forme dans SETS_A_FORME — une comparaison qui lirait null pour toujours ne revalide rien`);
}
// (2026-10-07) le site lit TROIS logos, dans cet ordre : logoCompose, logoFr, logo (lib/visuelSet.ts, CHAMPS_LOGO) — la projection ne
// regardait que `logo` : un logoCompose posé ou retiré seul ne revalidait rien.
// (tour de correction 1, 2026-10-24) seule la date d'écriture `le` est du bruit : la `preuve` d'un logo EST lue par le site (IMAGE_SET : cleR2, w, h, set, region, langue, preuve…), et `dateSortieMois`
// se compare en entier (SPEC_SET : { iso, texte }).
const sansDate = l => l ? Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'le')) : null;
const PROJECTION_SET = s => !s ? null : {
    ...Object.fromEntries(CHAMPS_SET_LUS.map(k => [k, s[k] ?? null])),
    // les formes figées viennent de SITE_LIT.formes / SITE_LIT.sets : la comparaison lit EXACTEMENT ce que la confrontation au site a vérifié
    dateSortieMois: s.dateSortieMois ? Object.fromEntries(SITE_LIT.formes.dateSortieMois.map(f => [f, s.dateSortieMois[f] ?? null])) : null,
    symbolesIdentification: (s.symbolesIdentification || []).map(x => Object.fromEntries(SITE_LIT.formes.symbolesIdentification.map(f => [f, x?.[f] ?? null]))),
    bulba: Object.fromEntries(SITE_LIT.sets.filter(k => k.startsWith('bulba.')).map(k => [k.slice(6), valeur(s, k)])),
    logo: sansDate(s.logo), logoFr: sansDate(s.logoFr), logoCompose: sansDate(s.logoCompose)
};

/**
 * @param {{avant: {cartes, cartesProduits, sets}, apres: {cartes, cartesProduits, sets}}} o — documents (projetés ou complets)
 * @returns {{sets: string[], catalogue: boolean, especes: boolean}} sets triés ; `catalogue` : un nom, une date, un compte a pu
 * changer sur /fr/sets ; `especes` : une carte est entrée dans un set ou en est sortie, ou son nom a changé.
 */
function setsTouches({ avant, apres }) {
    const touches = new Set();
    let catalogue = false, especes = false;
    const parId = l => new Map((l || []).map(d => [cleDoc(d._id), d]));
    // (tour de correction 1) les LIGNES d'abord : une carte dont une ligne change dans ce lot (ajoutée, retirée, modifiée) a le changement de ses `liens` expliqué par cette ligne, dont le slugSet est touché
    // (tour 2, D2) … AU PLUS JUSTE : une ligne changée n'explique que le(s) idProduct qu'elle PORTE, et seulement si elle a un slugSet (c'est lui qui est touché). Carte → ensemble des idProduct portés.
    const portes = new Map();
    const [lA, lB] = [parId(avant.cartesProduits), parId(apres.cartesProduits)];
    for (const k of new Set([...lA.keys(), ...lB.keys()])) {
        const a = lA.get(k), b = lB.get(k);
        if (a && b && signature(PROJECTION_LIGNES(a)) === signature(PROJECTION_LIGNES(b))) continue;
        for (const s of [a?.slugSet, b?.slugSet]) if (s) touches.add(s);
        for (const l of [a, b]) if (l && l.slugSet && l.carteId !== undefined && l.carteId !== null && l.idProduct !== undefined && l.idProduct !== null) {
            const c = cleDoc(l.carteId);
            if (!portes.has(c)) portes.set(c, new Set());
            portes.get(c).add(String(l.idProduct));
        }
        if (!a || !b) catalogue = true;   // une fiche de plus ou de moins : un compte du catalogue
    }
    // le changement de `liens` d'une carte est expliqué ssi : tout ce qui n'est pas `liens.idProduct` est identique (liens.idMetacard ne s'explique JAMAIS), et, une fois retirés les idProduct portés par une ligne changée
    // de cette carte, les deux listes d'idProduct sont identiques (donc dans le même ORDRE : le site lit le premier)
    const IDX_ID = CHAMPS_LIENS.indexOf('liens.idProduct');
    const liensExpliques = (pa, pb, k) => {
        const ids = portes.get(k);
        if (!ids || !ids.size || IDX_ID < 0) return false;
        if (signature(pa.liens.filter((_, i) => i !== IDX_ID)) !== signature(pb.liens.filter((_, i) => i !== IDX_ID))) return false;
        // (tour 3, E4) le site lit le PREMIER idProduct de la liste : s'il change (un id porté par une ligne changée placé en tête, un premier retiré, un premier lien posé sur une carte sans lien), rien ne l'explique
        const tete = v => (Array.isArray(v) && v.length ? v[0] : null);
        if (signature(tete(pa.liens[IDX_ID])) !== signature(tete(pb.liens[IDX_ID]))) return false;
        const sans = v => (Array.isArray(v) ? v : []).filter(x => !ids.has(String(x)));
        return signature(sans(pa.liens[IDX_ID])) === signature(sans(pb.liens[IDX_ID]));
    };
    const [cA, cB] = [parId(avant.cartes), parId(apres.cartes)];
    for (const k of new Set([...cA.keys(), ...cB.keys()])) {
        const a = cA.get(k), b = cB.get(k);
        const pa = a ? PROJECTION_CARTES(a) : null, pb = b ? PROJECTION_CARTES(b) : null;
        if (signature(pa) === signature(pb)) continue;
        // 🔴 2026-09-25 (soir) : un lot de 60 sets en a revalidé 336 — toute carte changée faisait revalider TOUTES ses
        // appartenances, et le worker, en posant une image dans UN set d'une promo réimprimée, en touchait vingt. Le set touché
        // est celui de la PARTIE qui a changé : un nom ou une impression (qui ne porte qu'un NOM d'expansion) → tous les sets de
        // la carte ; une appartenance → le set entré ou sorti ; une image → le set de l'entrée ajoutée, retirée ou remplacée.
        const tous = [...(pa?.sets || []), ...(pb?.sets || []), ...(pa?.images || []).map(m => m[0]), ...(pb?.images || []).map(m => m[0])];
        // (D1) un autre champ que le site lit sur la carte (pv, type, attaques, nomFr, liens…) : la fiche de la carte change dans tous ses sets
        // `liens` : sans ligne changée pour CETTE carte, rien n'explique le changement -> tous ses sets ; avec une ligne changée, le slugSet de la ligne (déjà touché) suffit
        const liensInexpliques = pa && pb && signature(pa.liens) !== signature(pb.liens) && !liensExpliques(pa, pb, k);
        if (!pa || !pb || pa.nomEn !== pb.nomEn || pa.categorie !== pb.categorie || signature(pa.impressions) !== signature(pb.impressions) || signature(pa.autres) !== signature(pb.autres) || liensInexpliques) { for (const s of tous) if (s) touches.add(s); }
        else {
            // Ce que CETTE carte attribue — pas la taille de l'ensemble, qu'une autre carte a pu remplir avant elle (le premier
            // correctif comparait la taille globale : 505 sets revalidés pour des images posées dans 3).
            const attribues = new Set();
            const [sa, sb] = [new Set(pa.sets), new Set(pb.sets)];
            for (const s of sa) if (!sb.has(s)) attribues.add(s);
            for (const s of sb) if (!sa.has(s)) attribues.add(s);
            const [ia, ib] = [new Set(pa.images.map(signature)), new Set(pb.images.map(signature))];
            for (const m of pa.images) if (!ib.has(signature(m)) && m[0]) attribues.add(m[0]);
            for (const m of pb.images) if (!ia.has(signature(m)) && m[0]) attribues.add(m[0]);
            // Une différence qu'aucune partie n'attribue (une entrée d'image en double retirée) : repli prudent sur tous les sets.
            // (tour de correction 1) la seule différence est un `liens` expliqué par une ligne changée : le slugSet de la ligne est déjà touché, rien à ajouter
            const seulementLiensExpliques = signature({ ...pa, liens: 0 }) === signature({ ...pb, liens: 0 });
            if (!(seulementLiensExpliques && attribues.size === 0)) for (const s of attribues.size ? attribues : tous) if (s) touches.add(s);
        }
        if (!pa || !pb || pa.nomEn !== pb.nomEn || signature(pa.sets) !== signature(pb.sets)) { especes = true; catalogue = true; }
        else if (pa.categorie !== pb.categorie) especes = true;   // les listes d'espèces filtrent `categorie: "pokemon"` ; le catalogue ne compte pas les catégories
    }
    // (2026-10-07) un champ de SET (nom, date, logo…) vit aussi dans l'entrée `sets-info` du site (30 jours), que les pages régénérées
    // relisent : sans `setsInfo`, 188 logos de decks sont restés composés sur le site après un lot revalidé en HTTP 200.
    let setsInfo = false;
    const [sA, sB] = [parId(avant.sets), parId(apres.sets)];
    for (const k of new Set([...sA.keys(), ...sB.keys()])) {
        const a = sA.get(k), b = sB.get(k);
        if (signature(PROJECTION_SET(a)) === signature(PROJECTION_SET(b))) continue;
        touches.add((a || b)._id); catalogue = true; setsInfo = true;
    }
    return { sets: [...touches].sort(), catalogue, especes, setsInfo };
}

// (correction 2, I-1) LA projection de l'état « après » que lot-additif lit dans la base — UNE constante, lue par lot-additif ET par le banc : ce que compterEtat/setsTouches lisent y figure,
// `liens.idProduct` compris (sans lui, la garde des liens de la table fermée valait toujours 0 en production).
// (D1) DÉRIVÉE de SITE_LIT : ce que le site lit ET ce que compterEtat compte (`liens.idProduct`, `impressions.*`, `images.*` y sont déjà) — une liste, deux usages, aucune chance de diverger.
const PROJECTION_ETAT = Object.freeze({
    cartes: Object.freeze(Object.fromEntries([...SITE_LIT.cartes, ...SITE_LIT.impressions.map(c => `impressions.${c}`), ...SITE_LIT.images.map(c => `images.${c}`)].map(c => [c, 1]))),
    cartesProduits: Object.freeze(Object.fromEntries(SITE_LIT.lignes.map(c => [c, 1]))),
});

module.exports = { SITE_LIT, entreesSetsSansForme, MARQUAGES_DU_LOT, restaurerImages, PROJECTION_ETAT, COMPTEURS, compterEtat, comparer, validerAnnonces, planRestauration, planVignettes, cleDoc, canon, setsTouches, PROJECTION_CARTES };
