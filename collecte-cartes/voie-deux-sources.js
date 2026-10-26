// ============================================================
// LA 5e VOIE DES FICHES PROUVÉES — « DEUX SOURCES SANS SETLIST » (V5, 2026-10-26) : le planificateur, pur
// ============================================================
// POURQUOI : 33 produits de la tête de A sont CONFIRMÉS par deux sources (Cardmarket + pikaqian / artofpkm / tpc-asie) et aucune voie ne pouvait poser leur ligne :
//   · A1 — le numéro du produit est HORS de la Setlist de Bulbapedia (promos chinoises SV-P/CS, S-P/CS, CS3aC), ou la Setlist porte les numéros d'un AUTRE tirage (SV-P/CS : « Cleffa (SVP Promo 37) »
//     alors que 037 chinois = Quaxly) : `prouver()` refusait la voie « setlist », et c'était juste — la Setlist n'y prouve rien et ne doit jamais servir de preuve ;
//   · A3 — plusieurs cartes portent le même nom et les mêmes attaques : la vraie + des fiches simples posées pour d'AUTRES numéros. Une fiche simple qui porte le numéro d'un autre produit n'est pas candidate.
// CE QUE FAIT LA VOIE : la seconde source INDÉPENDANTE (deux-sources.js, liste fermée, Bulbapedia exclue) remplace la Setlist. Tout le reste de `prouver()` tourne (nom + attaques, métacarte, niveau, témoin du nom
// de joindre()). La ligne `cartes_produits` s'écrit comme celles des autres voies (poser-fiches-prouvees.js::ecrireFiches, ADDITIF) et nomme ses deux sources ; l'impression manquante au numéro Cardmarket est posée
// comme le fait poser-numerotation.js (même `planifier`, même `ecrireLot`, impression `numero-cardmarket`) — et JAMAIS si la carte porte déjà un AUTRE numéro dans ce set (A2 : fiches mélangées) : le produit
// entier est alors refusé, sans ligne.
// ÉCRIT PAR CE QU'IL AUTORISE : tout ce qui n'est pas prouvé par `prouver()` ET accepté par `planifier()` de poser-numerotation est un refus nommé.
const { decomposerNomCardmarket, cleNumero } = require('./jointure');
const { indexer, candidats } = require('./cle-nom-attaques');
const { prouver, variantesDuProduit, departagerParLeNumero, numerosImprimes } = require('./fiches-prouvees');
const { estMatiereSpeciale } = require('./matiere-speciale');
const NUM = require('../poser-numerotation');

const ROUTE = 'DEUX-SOURCES-2026-10-26';
const OUTIL = 'poser-fiches-voie-deux-sources';
const k = n => cleNumero(String(n ?? ''));
const vide = n => n == null || String(n).trim() === '';

/**
 * @param {object} o
 * @param {Array<{idProduct: number, idExpansion: number, slugSet: string, secondeSource: {concordantes: object[], refusees?: object[]}}>} o.entrees
 * @param {{cartes: object[], sets: Map<string, object>, produits: Map<number, object[]>, NC?: Map<number, {numero: string|null}>, lignes: object[]}} o.lecture
 *        `cartes` : TOUTES les cartes (la clé nom + attaques cherche dans la base entière ; le départage lit les fiches simples) ; `lignes` : TOUTES les lignes cartes_produits
 * @returns {{lignes: object[], impressions: Array<{carteId: number, imp: object}>, refus: Array<{idProduct: number, raison: string}>, R: object, detail: object[]}}
 */
function planifierVoie({ entrees, lecture, le = new Date() }) {
    const refus = [], retenus = [];
    const cartes = new Map(lecture.cartes.map(c => [c._id, c]));
    const index = indexer(lecture.cartes);
    const NC = new Map(lecture.NC || []);
    for (const prods of lecture.produits.values()) for (const p of prods) if (!NC.has(p.idProduct)) NC.set(p.idProduct, { numero: p.numero ?? null });
    const lignesParCarte = new Map(), lignesDuProduit = new Map();
    for (const l of lecture.lignes || []) {
        (lignesParCarte.get(l.carteId) || lignesParCarte.set(l.carteId, []).get(l.carteId)).push(l);
        (lignesDuProduit.get(l.idProduct) || lignesDuProduit.set(l.idProduct, []).get(l.idProduct)).push(l._id);
    }
    // les numéros d'une carte : ses impressions ET ceux de ses lignes (le numéro Cardmarket du produit qu'elle représente) — une fiche simple en a un par ligne
    const numerosDe = c => {
        const s = new Set(numerosImprimes(c));
        for (const l of lignesParCarte.get(c._id) || []) { const n = !vide(l.numeroFiche) ? l.numeroFiche : NC.get(l.idProduct)?.numero; if (!vide(n)) s.add(k(n)); }
        return s;
    };
    for (const e of entrees) {
        const non = raison => refus.push({ idProduct: e.idProduct, raison });
        const p0 = (lecture.produits.get(e.idExpansion) || []).find(p => p.idProduct === e.idProduct);
        if (!p0) { non(`produit ${e.idProduct} absent du catalogue de l'expansion ${e.idExpansion}`); continue; }
        if (estMatiereSpeciale(e.idProduct)) { non('matière spéciale (table fermée) : un trou, jamais la fiche de la carte normale'); continue; }
        const autres = lignesDuProduit.get(e.idProduct) || [];
        if (autres.length) { non(`le produit a déjà ${autres.length} ligne(s) (${autres.slice(0, 3).join(', ')}) : on ne pose que des lignes absentes`); continue; }
        const set = lecture.sets.get(e.slugSet);
        if (!set) { non(`set « ${e.slugSet} » absent de la base`); continue; }
        if (![].concat(set.idExpansion ?? []).includes(e.idExpansion)) { non(`le set ${e.slugSet} ne porte pas l'expansion ${e.idExpansion}`); continue; }
        const tirage = set.tirage ?? set.region;
        const produit = { ...p0, niveau: decomposerNomCardmarket(p0.name).niveau };
        const numero = vide(produit.numero) ? null : String(produit.numero);
        if (numero == null) { non('aucun numéro Cardmarket : une seconde source ne confirme rien sans numéro'); continue; }
        // LA CANDIDATE : la même boucle que prouver() (variantes du nom), puis le départage par le numéro des fiches simples
        let cands = [];
        for (const v of variantesDuProduit(produit)) { cands = candidats(index, v, { forme: 'incluses' }); if (cands.length) break; }
        const restantes = departagerParLeNumero(cands, numero, numerosDe);
        if (restantes.length !== 1) { non(restantes.length ? `${restantes.length} cartes candidates après le départage par le numéro des fiches simples (${restantes.slice(0, 4).map(c => c._id).join(', ')}) — un doute est un refus` : `aucune carte candidate par nom + attaques (${cands.length} avant le départage)`); continue; }
        const carte = restantes[0];
        const entree = { idProduct: e.idProduct, carteId: carte._id, voie: 'deux-sources', tirage, slugSet: e.slugSet, secondeSource: e.secondeSource };
        const cartesDuSet = lecture.cartes.filter(c => (c.sets || []).includes(e.slugSet));
        const r = prouver({ entree, produit, carte, cartesDuSet, cartesPourCle: lecture.cartes, etatSetlist: null, numerosDe });
        if (!r.ok) { non(r.refus.join(' ; ')); continue; }
        retenus.push({ e, p0, produit, carte, tirage, numero, temoins: r.temoins });
    }

    // L'IMPRESSION : poser-numerotation.planifier (production), une ligne virtuelle par produit retenu — tout le GROUPE (carte × tirage × expansion) passe ou rien
    const sets = lecture.sets;
    const declarants = new Map();
    for (const c of lecture.cartes) for (const i of c.impressions || []) if (i && i.expansion != null && !vide(i.numero)) { const kk = `${i.tirage}|${i.expansion}|${k(i.numero)}`; (declarants.get(kk) || declarants.set(kk, new Set()).get(kk)).add(c._id); }
    const virtuelles = retenus.map(x => ({ _id: `${x.carte._id}|${x.e.idProduct}`, carteId: x.carte._id, idProduct: x.e.idProduct, idExpansion: x.e.idExpansion, slugSet: x.e.slugSet, numeroFiche: x.numero }));
    const R = NUM.planifier({ lignes: virtuelles, NC, cartes, sets, declarants, lignesParCarte });
    const acceptes = new Set([...R.groupes.values()].flatMap(g => [...g.produits]));
    const lignes = [], detail = [];
    for (const x of retenus) {
        if (!acceptes.has(x.e.idProduct)) { const m = R.refus.filter(q => q.idProduct === x.e.idProduct).map(q => q.motif); refus.push({ idProduct: x.e.idProduct, raison: `impression non posable : ${m.join(' ; ') || 'refusée par le groupe'}` }); continue; }
        const sources = ['cardmarket', ...new Set(x.e.secondeSource.concordantes.map(c => c.source))];
        const refs = x.e.secondeSource.concordantes.map(c => `${c.source}:${c.ref ?? ''}`);
        lignes.push({
            _id: `${x.carte._id}|${x.e.idProduct}`, carteId: x.carte._id, idProduct: x.e.idProduct, idExpansion: x.e.idExpansion, tirage: x.tirage, preuve: 'fiche-prouvee', slug: x.p0.slug ?? null, slugSet: x.e.slugSet, numeroFiche: x.numero,
            detail: `${x.e.slugSet} n°${x.numero} « ${x.p0.name} » → ${x.carte._id} « ${x.carte.nomEn} » : voie deux-sources (sans Setlist) · confirmé par ${sources.join(' + ')} (${refs.join(' ; ')}) · ${x.temoins.join(' · ')}`,
            verifieLe: le, route: ROUTE, confirmation: { sources, refs, le: le.toISOString().slice(0, 10) }
        });
        detail.push({ idProduct: x.e.idProduct, ok: true, sources, concordantes: refs });
    }
    // les impressions, restreintes aux produits acceptés (R.aPoser vient du groupe : déjà filtré par planifier)
    const impressions = [];
    for (const [carteId, imps] of R.aPoser) for (const imp of imps) impressions.push({ carteId, imp });
    refus.sort((a, b) => a.idProduct - b.idProduct); lignes.sort((a, b) => a.idProduct - b.idProduct);
    return { lignes, impressions, refus, R, detail };
}

/** Le plan que simuler-abc.js (--plans) et simuler-lot-api.js lisent : le format de poser-numerotation.construirePlan (lignes, impressions) + cartesSets vide. */
function planJson(plan, codeParProduit = new Map()) {
    return {
        outil: OUTIL,
        lignes: plan.lignes.map(l => ({ _id: l._id, carteId: l.carteId, idProduct: l.idProduct, idExpansion: l.idExpansion, tirage: l.tirage, preuve: l.preuve, slug: l.slug, slugSet: l.slugSet, numeroFiche: l.numeroFiche, code: codeParProduit.get(l.idProduct) ?? null })),
        cartesSets: [],
        impressions: plan.impressions.map(x => ({ carteId: x.carteId, imp: x.imp }))
    };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.refus && plan.refus.length) return { ok: false, raison: `${plan.refus.length} refus dans le plan : la liste --seulement doit être EXACTEMENT celle de la simulation` };
    if (plan.lignes.length !== attendu) return { ok: false, raison: `le plan compte ${plan.lignes.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

/** La preuve TRAÇABLE de chaque impression (poser-numerotation.preuves) : produits, numéro, sources et références, liste. Clé `${carteId}|${tirage}|${expansion}|${cleNumero}`. */
function preuvesImpressions(plan, nomListe) {
    return NUM.preuves(plan.R, plan.detail, nomListe);
}

/**
 * L'ÉCRITURE : les LIGNES d'abord (poser-fiches-prouvees.ecrireFiches, `$setOnInsert`, liens/métacartes en `$addToSet`) et leur relecture ; seulement si tout est relu, les IMPRESSIONS (poser-numerotation.ecrireLot, qui
 * relit les siennes). `dep` injecte ces fonctions pour le banc. @returns {Promise<number>} 0 si tout est relu
 */
async function ecrire({ db, plan, attendu, nomListe, metaDe, repereAvant, dep = {}, log = console.log, err = console.error }) {
    const PF = dep.ecrireFiches ? null : require('../poser-fiches-prouvees');
    const ecrireFiches = dep.ecrireFiches || PF.ecrireFiches, relire = dep.relire || PF.relire, ecrireLot = dep.ecrireLot || NUM.ecrireLot;
    const v = verifierAttendu(plan, attendu);
    if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
    const r = await ecrireFiches(db, plan.lignes, metaDe, new Map());
    const rl = await relire(db, plan.lignes, metaDe, new Map(), repereAvant);
    const routees = db.collection ? await db.collection('cartes_produits').countDocuments({ _id: { $in: plan.lignes.map(l => l._id) }, preuve: 'fiche-prouvee', route: ROUTE }) : plan.lignes.length;
    log(`   ✅ lignes posées ${r.lignes}/${plan.lignes.length} · cartes modifiées ${r.cartes} · relu : lignes ${rl.lignes} (à notre route ${routees}) · cartes ${rl.cartes} · repères d'adresse bougés ${JSON.stringify(rl.reperesBouges)}${rl.manques.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}`);
    if (!(r.lignes === plan.lignes.length && rl.ok && routees === plan.lignes.length)) { err('❌ la relecture des lignes ne retrouve pas tout ce qui devait être écrit — les impressions ne sont PAS posées'); return 1; }
    if (!plan.R.aPoser.size) { log('   (aucune impression à poser : les cartes déclarent déjà le numéro)'); return 0; }
    const pr = preuvesImpressions(plan, nomListe);
    return ecrireLot({ db, R: { aPoser: plan.R.aPoser, numerosFiche: [] }, preuveDe: (id, i) => pr.get(`${id}|${i.tirage}|${i.expansion}|${k(i.numero)}`), nomListe, marque: 'poser-fiches-voie-deux-sources (2026-10-26)', log, err });
}

module.exports = { planifierVoie, planJson, verifierAttendu, preuvesImpressions, ecrire, ROUTE, OUTIL };
