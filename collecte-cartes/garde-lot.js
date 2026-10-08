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
    'nom-affiche': 'le set porte un nomAffichage'
});

/** @returns {Map<string, number>} « <compteur> <groupe> » → n */
function compterEtat({ cartes = [], cartesProduits = [], sets = [] }) {
    const m = new Map();
    const inc = k => m.set(k, (m.get(k) || 0) + 1);
    const vus = new Set();
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
        if (compteur === 'entrees-cles' || compteur === 'vignettes-set') continue;   // interne / traité après
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
        if (d > 0) { const [compteur] = decouper(cle); if (compteur !== 'entrees-cles') hausses[compteur] = (hausses[compteur] || 0) + d; }
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
function planRestauration(sauves, actuels, { garder = () => [] } = {}) {
    const plan = { inserer: [], supprimer: [], remplacer: [], champs: {} };
    for (const [k, d] of sauves) {
        const a = actuels.get(k);
        if (!a) { plan.inserer.push(d); continue; }
        const cible = { ...d };
        for (const f of garder(d, a)) { if (f in a) cible[f] = a[f]; else delete cible[f]; }
        const differents = [...new Set([...Object.keys(cible), ...Object.keys(a)])].filter(f => canon(cible[f]) !== canon(a[f]));
        if (!differents.length) continue;
        for (const f of differents) plan.champs[f] = (plan.champs[f] || 0) + 1;
        plan.remplacer.push(cible);
    }
    for (const [k, a] of actuels) if (!sauves.has(k)) plan.supprimer.push(a._id);
    return plan;
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
// (2026-10-07, nuit) `categorie` : le site la lit (page de la carte, listes d'espèces) — elle se compare comme le nom
const PROJECTION_CARTES = c => ({ sets: [...(c.sets || [])].sort(), nomEn: c.nomEn ?? null, categorie: c.categorie ?? null,
    impressions: (c.impressions || []).filter(Boolean).map(i => [i.tirage ?? null, i.expansion ?? null, i.numero ?? null, 'illustrateur' in i ? i.illustrateur : '∅']),
    images: (c.images || []).filter(Boolean).map(m => [m.set ?? null, m.cleR2 ?? null, m.numero ?? null, m.vignette?.cleR2 ?? null]) });
const PROJECTION_LIGNES = l => [l.carteId ?? null, l.idProduct ?? null, l.slugSet ?? null, l.numeroFiche ?? null, l.preuve ?? null];
// 🔴 2026-09-26 : un lot de logos a revalidé 156 sets pour 12 changés — le document ENTIER était comparé, et le collecteur réécrivait
// la date `le` de chaque logo et chaque motif de refus (`logoRefus`, que le site ne lit pas). Un set se compare sur les champs que le
// SITE lit : `PROJECTION_SET` de lib/cartes.ts (rat-market-site), recopiée ici — plus `dateSortieMois`, demandé au site le même
// jour — et, du logo, ce qui s'affiche (la date et la preuve n'en font pas partie). Un champ que le site ajoute se reporte ICI.
// (2026-10-07, relecture) recopiée de PROJECTION_SET (rat-market-site lib/cartes.ts, lue le 2026-10-07) : `nomFr` et sa preuve, `serie`,
// `symbolesIdentification` manquaient — un lot de noms français ne revalidait rien, comme les logos.
const CHAMPS_SET_LUS = ['code', 'nomJa', 'nomAffichage', 'nomFr', 'nomFrSource', 'nomFrPreuve', 'region', 'tirage', 'dateSortieJa', 'dateSortieEn',
    'periodeDistribution', 'totalImprime', 'idExpansion', 'symbole', 'serie'];
// (2026-10-07) le site lit TROIS logos, dans cet ordre : logoCompose, logoFr, logo (lib/visuelSet.ts, CHAMPS_LOGO) — la projection ne
// regardait que `logo` : un logoCompose posé ou retiré seul ne revalidait rien.
const sansDate = l => l ? Object.fromEntries(Object.entries(l).filter(([k]) => !['le', 'preuve'].includes(k))) : null;
const PROJECTION_SET = s => !s ? null : {
    ...Object.fromEntries(CHAMPS_SET_LUS.map(k => [k, s[k] ?? null])),
    dateSortieMois: s.dateSortieMois?.iso ?? null,
    symbolesIdentification: (s.symbolesIdentification || []).map(x => ({ cleR2: x?.cleR2 ?? null, w: x?.w ?? null, h: x?.h ?? null, fichier: x?.fichier ?? null, source: x?.source ?? null })),
    bulba: { expansion: s.bulba?.expansion ?? null, titre: s.bulba?.titre ?? null, pageid: s.bulba?.pageid ?? null },
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
        if (!pa || !pb || pa.nomEn !== pb.nomEn || pa.categorie !== pb.categorie || signature(pa.impressions) !== signature(pb.impressions)) { for (const s of tous) if (s) touches.add(s); }
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
            for (const s of attribues.size ? attribues : tous) if (s) touches.add(s);
        }
        if (!pa || !pb || pa.nomEn !== pb.nomEn || signature(pa.sets) !== signature(pb.sets)) { especes = true; catalogue = true; }
        else if (pa.categorie !== pb.categorie) especes = true;   // les listes d'espèces filtrent `categorie: "pokemon"` ; le catalogue ne compte pas les catégories
    }
    const [lA, lB] = [parId(avant.cartesProduits), parId(apres.cartesProduits)];
    for (const k of new Set([...lA.keys(), ...lB.keys()])) {
        const a = lA.get(k), b = lB.get(k);
        if (a && b && signature(PROJECTION_LIGNES(a)) === signature(PROJECTION_LIGNES(b))) continue;
        for (const s of [a?.slugSet, b?.slugSet]) if (s) touches.add(s);
        if (!a || !b) catalogue = true;   // une fiche de plus ou de moins : un compte du catalogue
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

module.exports = { COMPTEURS, compterEtat, comparer, validerAnnonces, planRestauration, planVignettes, cleDoc, canon, setsTouches, PROJECTION_CARTES };
