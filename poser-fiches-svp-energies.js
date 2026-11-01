// ============================================================
// LES FICHES DES ÉNERGIES DE BASE DES PROMOS JAPONAISES SV-P (règle E-SVP, collecte-cartes/regle-e-svp.js — UN SEUL module pour la simulation et l'écriture)
// ============================================================
//   node poser-fiches-svp-energies.js --tcgdex=<…/tcgdex-clone…/data-asia> [--plan=<fichier>.json]                  (simulation : RIEN n'est écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-fiches-svp-energies.js --tcgdex=… --attendu=N --ecrire
//
// LE CAS : des produits « Basic <Type> Energy » du set SV-P (Cardmarket n° 100-107, 175-182, 202-209, 280-287) n'ont aucune ligne cartes_produits. TCGdex les nomme
// (SV-P/<n>, thirdParty.cardmarket) au numéro appris de Cardmarket, son nom japonais donne le même type, et UNE SEULE carte du même nom porte une impression SV-P.
// CE QUI S'ÉCRIT (ADDITIF strict) :
//  · `cartes_produits` : une ligne par produit (`$setOnInsert`, upsert, preuve `tcgdex-idproduct+numero+type`, numeroFiche = le numéro) ; un produit qui a DÉJÀ une ligne
//    (n'importe quelle carte) est REFUSÉ, au plan comme juste avant l'écriture ;
//  · `cartes` : `$addToSet` de liens.idProduct / liens.idMetacards / sets (liste fermée de regle-r-fiches.js, ajout en FIN : le repère d'adresse du site ne bouge pas) ;
//  · `cartes.impressions` : l'impression SV-P AU NUMÉRO du produit (`$push` gardé par un filtre, jamais deux fois). Le site fait UNE FICHE PAR IMPRESSION du set
//    (exporter-donnees-logos-site.fichesDesProduits) et rattache le produit à la fiche par numeroFiche : sans l'impression au n°100, pas de fiche. Même géométrie et même
//    marque de conservation (`source: 'numero-cardmarket'`) que poser-impressions-energies.js ; ici l'impression du SET existe déjà (037, 079…), c'est le NUMÉRO qui manque,
//    comme pour les lignes déjà jointes de ces cartes (une impression et une ligne par numéro).
// ORDRE : cartes (liens, sets), impressions, PUIS les lignes — une reprise après arrêt rejoue le même plan (les lignes manquent encore, le reste est idempotent).
// GARDES (toutes AVANT la première écriture) : calibration rejouée ici (0 faux, assez de cas jugés) · --attendu = le nombre de lignes du plan · la règle du site IMPORTÉE
// ne perd aucune fiche ni aucun visuel · le repère d'adresse des cartes ne bouge pas · matière spéciale.
const fs = require('fs');
const path = require('path');
const E = require('./collecte-cartes/regle-e-svp');
const R = require('./collecte-cartes/regle-r-fiches');
const { numeroComparable } = require('./mesurer-fiches-melangees');
const { SOURCES_POSEES_APRES } = require('./collecte-cartes/impressions-posees');

const PREUVE = 'tcgdex-idproduct+numero+type';
const SOURCE_IMPRESSION = 'numero-cardmarket';
const SOURCE_NUMERO_FICHE = 'poser-fiches-svp-energies (2026-11-01)';
const ID_EXPANSION = 5212;
const MIN_JUGEES = 15;
if (!SOURCES_POSEES_APRES.includes(SOURCE_IMPRESSION)) throw new Error(`${SOURCE_IMPRESSION} n'est plus une source conservée par impressions-posees.js : un --reparser effacerait ces impressions`);

/**
 * @param {object} o
 * @param {{idProduct:number,name:string}[]} o.produits   les produits de l'expansion 5212 (catalogue_produits)
 * @param {{idProduct:number,carteId:number}[]} o.lignes  TOUTES les lignes cartes_produits de ces produits (quelle que soit la carte)
 * @param {Map<number,string>} o.nums                     numeros_cartes.numero
 * @param {Map<number,{slug?:string,idMetacard?:number}>} o.fiches
 * @param {object[]} o.cartes   les cartes candidates (nomEn, sets, impressions)
 * @param {object} o.setDoc     le document `sets` de SV-P
 * @param {object} o.clone      lireClone() (parProduit)
 * @param {(localId:string)=>string|null} o.nomJa
 */
// LE PROFIL : tout ce qui distingue un set de l'autre (règle de jugement, expansion, preuve…). Le plan, l'écriture, la relecture et la simulation du site sont UNE seule
// implémentation (poser-fiches-energies-m6a.js importe ces fonctions avec son profil — §21 bis). Le profil SV-P est celui par défaut : comportement inchangé.
const PROFIL_SVP = Object.freeze({
    outil: 'poser-fiches-svp-energies',
    expansion: E.EXPANSION, idExpansion: ID_EXPANSION, preuve: PREUVE, route: 'SV-P', totalParDefaut: 'SV-P', sourceNumeroFiche: SOURCE_NUMERO_FICHE,
    juger: E.juger,
    verifierSet(setDoc) {
        const tirage = setDoc?.tirage ?? setDoc?.region;
        if (tirage !== 'jp') throw new Error(`le set ${setDoc?._id} n'est pas japonais (tirage « ${tirage} ») : l'outil ne vaut que pour SV-P`);
        if (![].concat(setDoc.bulba?.expansion ?? []).includes(E.EXPANSION) || [].concat(setDoc.bulba?.expansion).length !== 1) throw new Error(`le set ${setDoc._id} n'a pas pour unique nom d'expansion « ${E.EXPANSION} »`);
        if (![].concat(setDoc.idExpansion ?? []).includes(ID_EXPANSION)) throw new Error(`le set ${setDoc._id} n'a pas l'expansion Cardmarket ${ID_EXPANSION}`);
    },
    preuveNumero: (p, j) => `Cardmarket idProduct ${p.idProduct} n°${j.numero} (numeros_cartes) ; TCGdex ${j.tcgdex} « ${j.nomJa} » nomme ce produit (thirdParty.cardmarket) au même numéro`,
    detail: (p, j) => `SV-P « ${p.name} » -> carte ${j.carteId} : TCGdex ${j.tcgdex} (thirdParty.cardmarket) nomme le produit au numéro Cardmarket ${j.numero}, nom japonais « ${j.nomJa} » = type ${j.type}, une seule carte « ${p.name} » porte une impression SV-P`
});

function planifier({ produits, lignes, nums, fiches, cartes, setDoc, clone, nomJa }, profil = PROFIL_SVP) {
    profil.verifierSet(setDoc);
    const tirage = setDoc?.tirage ?? setDoc?.region;
    const parId = new Map((cartes || []).map(c => [c._id, c]));
    const avecLigne = new Set((lignes || []).map(l => l.idProduct));
    const retenus = [], refus = [], aImprimer = new Set();
    for (const p of produits) {
        if (avecLigne.has(p.idProduct)) { refus.push({ idProduct: p.idProduct, condition: null, raison: 'a déjà une ligne' }); continue; }
        const j = profil.juger({ produit: p, numeroAppris: nums.get(p.idProduct), nommes: clone.parProduit.get(p.idProduct) || [], nomJa, cartes });
        if (!j.ok) { refus.push({ idProduct: p.idProduct, condition: j.condition, raison: j.raison }); continue; }
        const carte = parId.get(j.carteId);
        const f = fiches.get(p.idProduct) || {};
        const cle = `${j.carteId}|${numeroComparable(j.numero)}`;
        const aDeja = (carte.impressions || []).some(i => i && i.tirage === tirage && i.expansion === profil.expansion && numeroComparable(i.numero) === numeroComparable(j.numero)) || aImprimer.has(cle);
        aImprimer.add(cle);
        const total = (carte.impressions || []).find(i => i && i.expansion === profil.expansion && i.total)?.total ?? profil.totalParDefaut;
        const impression = aDeja ? null : { tirage, expansion: profil.expansion, deck: null, numero: j.numero, total, rarete: null, source: SOURCE_IMPRESSION, preuveNumero: profil.preuveNumero(p, j) };
        retenus.push({
            p, carteId: j.carteId, numero: j.numero, idMetacard: f.idMetacard ?? null, impression, ajouteSet: !(carte.sets || []).includes(setDoc._id), slugSet: setDoc._id,
            ligne: { _id: `${j.carteId}|${p.idProduct}`, carteId: j.carteId, idProduct: p.idProduct, idExpansion: profil.idExpansion, tirage, preuve: profil.preuve, slug: f.slug ?? null, slugSet: setDoc._id, numeroFiche: j.numero,
                numeroFicheSource: profil.sourceNumeroFiche, route: profil.route, detail: profil.detail(p, j) }
        });
    }
    return { retenus, refus };
}

/** La calibration ne s'écrit que si elle a jugé assez de cas ET n'a compté aucun faux : un « 0 faux » sur 3 cas ne prouve rien. */
function garderCalibration(cal, minimum = MIN_JUGEES) {
    if (!cal || !Number.isInteger(cal.jugees)) return { ok: false, raison: 'calibration absente' };
    if (cal.faux !== 0) return { ok: false, raison: `la calibration compte ${cal.faux} faux` };
    if (cal.jugees < minimum) return { ok: false, raison: `la calibration n'a jugé que ${cal.jugees} cas (minimum ${minimum})` };
    return { ok: true };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire (le nombre mesuré en simulation)' };
    if (plan.retenus.length !== attendu) return { ok: false, raison: `le plan compte ${plan.retenus.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

/** parCarte pour regle-r-fiches : carteId -> { ids, metas, sets }. */
function parCarteDuPlan(plan) {
    const m = new Map();
    for (const r of plan.retenus) {
        const w = m.get(r.carteId) || m.set(r.carteId, { ids: [], metas: new Set(), sets: new Set() }).get(r.carteId);
        w.ids.push(r.p.idProduct); if (r.idMetacard != null) w.metas.add(r.idMetacard); w.sets.add(r.slugSet);
    }
    return m;
}

function operationsEcriture(plan, le = new Date()) {
    const cartes = R.operationsCartes(parCarteDuPlan(plan));
    const impressions = plan.retenus.filter(r => r.impression).map(r => ({ updateOne: { filter: { _id: r.carteId, impressions: { $not: { $elemMatch: { tirage: r.impression.tirage, expansion: r.impression.expansion, numero: r.impression.numero } } } }, update: { $push: { impressions: r.impression } } } }));
    const lignes = plan.retenus.map(r => { const { _id, ...reste } = r.ligne; return { updateOne: { filter: { _id }, update: { $setOnInsert: { ...reste, verifieLe: le } }, upsert: true } }; });
    return { cartes, impressions, lignes };
}

/** Écrit dans l'ordre cartes -> impressions -> lignes ; REFUSE (avant toute écriture) si un produit du plan a désormais une ligne. */
async function ecrire(db, plan) {
    if (!plan.retenus.length) return { lignes: 0, impressions: 0, cartes: 0 };
    const ops = operationsEcriture(plan);
    R.garderEcritureSite(ops.cartes);
    const deja = await db.collection('cartes_produits').find({ idProduct: { $in: plan.retenus.map(r => r.p.idProduct) } }, { projection: { idProduct: 1, carteId: 1 } }).toArray();
    if (deja.length) throw new Error(`🔴 ${deja.length} produit(s) du plan ont déjà une ligne (${deja.slice(0, 5).map(l => l.idProduct).join(', ')}) — rien n'est écrit`);
    const c = await db.collection('cartes').bulkWrite(ops.cartes, { ordered: false });
    const i = ops.impressions.length ? await db.collection('cartes').bulkWrite(ops.impressions, { ordered: false }) : { modifiedCount: 0 };
    const l = await db.collection('cartes_produits').bulkWrite(ops.lignes, { ordered: false });
    return { lignes: l.upsertedCount, impressions: i.modifiedCount, cartes: c.modifiedCount };
}

/** Ce que le PLAN attend, comparé à ce qui est en base. */
async function relire(db, plan, profil = PROFIL_SVP) {
    const lignes = new Map((await db.collection('cartes_produits').find({ _id: { $in: plan.retenus.map(r => r.ligne._id) } }, { projection: { preuve: 1, numeroFiche: 1 } }).toArray()).map(l => [l._id, l]));
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(plan.retenus.map(r => r.carteId))] } }, { projection: { sets: 1, liens: 1, impressions: 1 } }).toArray()).map(c => [c._id, c]));
    const lignesOk = plan.retenus.filter(r => { const l = lignes.get(r.ligne._id); return l && l.preuve === profil.preuve && l.numeroFiche === r.numero; }).length;
    const impressionsOk = plan.retenus.filter(r => r.impression).filter(r => (cartes.get(r.carteId)?.impressions || []).some(i => i.expansion === profil.expansion && numeroComparable(i.numero) === numeroComparable(r.numero) && i.source === SOURCE_IMPRESSION)).length;
    const par = parCarteDuPlan(plan);
    const cartesOk = [...par].filter(([id, w]) => { const c = cartes.get(id); return c && w.ids.every(x => (c.liens?.idProduct || []).includes(x)) && [...w.sets].every(s => (c.sets || []).includes(s)); }).length;
    return { lignesOk, impressionsOk, cartesOk, attendu: plan.retenus.length };
}

/** Ce que les écritures changeraient pour le SITE, par sa règle IMPORTÉE : fiches et visuels avant / après (docs différents : l'impression ajoutée est dans `apres`). */
function simulerSite({ site, setDoc, docs, lignesAvant, plan }, profil = PROFIL_SVP) {
    const tir = setDoc.tirage ?? setDoc.region;
    const apresDocs = docs.map(d => {
        const ajouts = plan.retenus.filter(r => r.carteId === d._id);
        if (!ajouts.length) return d;
        return { ...d, sets: [...new Set([...(d.sets || []), setDoc._id])], impressions: [...(d.impressions || []), ...ajouts.filter(r => r.impression).map(r => r.impression)] };
    });
    const ajoutees = plan.retenus.map(r => ({ idProduct: r.p.idProduct, carteId: r.carteId, idExpansion: profil.idExpansion, slug: r.ligne.slug, slugSet: r.slugSet, numeroFiche: r.numero }));
    const evaluer = (D, lignes) => {
        const parId = new Map(D.map(d => [d._id, d]));
        const F = site.fichesDesProduits(site.regle, setDoc, D, lignes);
        const fiche = new Map(), servi = new Set();
        for (const l of lignes) {
            const f = F.fiche.get(l.idProduct);
            if (!f || f.carteId !== l.carteId) continue;
            fiche.set(l.idProduct, f);
            const entrees = (parId.get(l.carteId)?.images || []).filter(e => e && e.set === setDoc._id && e.cleR2);
            if (site.imageDeLImpression(entrees.filter(e => site.refusDuVisuel(e, tir) === null), f.numero) !== null) servi.add(l.idProduct);
        }
        return { fiche, servi, doubles: F.doubles };
    };
    const avant = evaluer(docs, lignesAvant), apres = evaluer(apresDocs, [...lignesAvant, ...ajoutees]);
    const ids = ajoutees.map(a => a.idProduct);
    return {
        avant: { fiches: avant.fiche.size, servis: avant.servi.size, doubles: avant.doubles }, apres: { fiches: apres.fiche.size, servis: apres.servi.size, doubles: apres.doubles },
        ajouteesAvecFiche: ids.filter(id => apres.fiche.has(id)).length,
        // la fiche servie est bien celle du NUMÉRO du produit
        ajouteesAuBonNumero: plan.retenus.filter(r => { const f = apres.fiche.get(r.p.idProduct); return f && numeroComparable(f.numero) === numeroComparable(r.numero); }).length,
        ajouteesServies: ids.filter(id => apres.servi.has(id)).length,
        perdusFiche: [...avant.fiche.keys()].filter(id => !apres.fiche.has(id) || apres.fiche.get(id).numero !== avant.fiche.get(id).numero), perdusServi: [...avant.servi].filter(id => !apres.servi.has(id))
    };
}

async function executer({ argv, ouvrir, lireClone, chargerSite, log = console.log, err = console.error }) {
    const AUTORISES = [/^--tcgdex=.+$/, /^--attendu=\d+$/, /^--plan=.+\.json$/, /^--ecrire$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrireOk = argv.includes('--ecrire');
    if (!arg('tcgdex')) { err('❌ --tcgdex=<dossier data-asia du clone> obligatoire'); return 2; }
    if (ecrireOk && arg('attendu') === undefined) { err('❌ --ecrire exige --attendu=N (le nombre mesuré en simulation) — rien n\'est écrit'); return 2; }
    const clone = lireClone(arg('tcgdex'));
    const nomJa = n => { const f = path.join(arg('tcgdex'), 'SV', 'SV-P', `${n}.ts`); return fs.existsSync(f) ? E.nomJaDuTexte(fs.readFileSync(f, 'utf8')) : null; };
    log(`   clone TCGdex : ${clone.nSets} sets, ${clone.nCartes} cartes, ${clone.parProduit.size} idProduct Cardmarket nommés`);
    const { cartes: dbC, prod, fermer } = await ouvrir({ ecriture: ecrireOk });
    try {
        const sets = await dbC.collection('sets').find({ code: 'SV-P' }).project({ code: 1, region: 1, tirage: 1, idExpansion: 1, bulba: 1 }).toArray();
        if (sets.length !== 1) { err(`❌ ${sets.length} set(s) de code SV-P (il en faut exactement un) — rien n'est écrit`); return 1; }
        const setDoc = sets[0];
        const produits = await prod.collection('catalogue_produits').find({ idExpansion: ID_EXPANSION }).project({ _id: 0, idProduct: 1, name: 1, idMetacard: 1 }).toArray();
        if (!produits.length) { err(`❌ aucun produit pour l'expansion ${ID_EXPANSION} (instrument muet, §41) — rien n'est écrit`); return 1; }
        const ids = produits.map(p => p.idProduct);
        const numRows = await prod.collection('numeros_cartes').find({ idProduct: { $in: ids } }).project({ _id: 0, idProduct: 1, numero: 1, slug: 1 }).toArray();
        const nums = new Map(numRows.map(n => [n.idProduct, n.numero == null ? null : String(n.numero)]));
        const fiches = new Map(produits.map(p => [p.idProduct, { slug: numRows.find(n => n.idProduct === p.idProduct)?.slug ?? null, idMetacard: p.idMetacard ?? null }]));
        const lignes = await dbC.collection('cartes_produits').find({ idProduct: { $in: ids } }).project({ idProduct: 1, carteId: 1, preuve: 1, idExpansion: 1, slugSet: 1, numeroFiche: 1, slug: 1 }).toArray();
        const energies = await dbC.collection('cartes').find({ nomEn: /^Basic \w+ Energy$/, 'impressions.expansion': E.EXPANSION }).project({ nomEn: 1, sets: 1, impressions: 1, liens: 1 }).toArray();
        log(`\n■ SV-P (${setDoc._id}, exp ${ID_EXPANSION}) · DÉNOMINATEUR ${produits.length} produits, ${new Set(lignes.map(l => l.idProduct)).size} avec une ligne, ${produits.length - new Set(lignes.map(l => l.idProduct)).size} sans ligne · ${energies.length} cartes « Basic … Energy » portant une impression SV-P`);

        // ── la calibration, rejouée ici (ligne cachée)
        const cal = E.calibrer({ produits, lignes, nums, clone, nomJa, cartes: energies });
        log(`   CALIBRATION (produits Basic Energy SV-P déjà joints, ligne cachée) : ${cal.jugees} jugés · ${cal.justes} justes · ${cal.faux} faux · ${cal.refus} refus de la règle`);
        const gc = garderCalibration(cal);
        log(gc.ok ? '   ✅ calibration : 0 faux, assez de cas jugés' : `   🔴 CALIBRATION INSUFFISANTE : ${gc.raison}`);
        if (!gc.ok && ecrireOk) { err('❌ ARRÊT : la garde de calibration refuse — rien n\'est écrit'); return 1; }

        // ── l'ÉPREUVE sur TOUS les produits SV-P déjà joints (pas seulement les énergies), ligne cachée
        const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
        const joints = produits.filter(p => lignes.some(l => l.idProduct === p.idProduct));
        const noms = [...new Set(joints.map(p => decomposerNomCardmarket(p.name).nom))];
        const tous = await dbC.collection('cartes').find({ nomEn: { $in: noms }, 'impressions.expansion': E.EXPANSION }).project({ nomEn: 1, impressions: 1 }).toArray();
        const rj = joints.reduce((o, p) => { const j = E.juger({ produit: p, numeroAppris: nums.get(p.idProduct), nommes: clone.parProduit.get(p.idProduct) || [], nomJa, cartes: tous }); const l = lignes.find(x => x.idProduct === p.idProduct); if (j.ok) { o.jugees++; if (j.carteId === l.carteId) o.justes++; else o.faux++; } else o.refus++; return o; }, { jugees: 0, justes: 0, faux: 0, refus: 0 });
        const so = E.sonder({ produits, lignes, nums, clone, cartes: tous });
        log(`   ÉPREUVE sur les ${joints.length} produits SV-P déjà joints (énergies ou non), ligne cachée, ${tous.length} cartes de mêmes noms portant une impression SV-P :`);
        log(`      règle complète E-SVP : ${rj.jugees} jugés · ${rj.justes} justes · ${rj.faux} faux · ${rj.refus} refus (hors énergies : condition 0)`);
        log(`      sonde d'unicité seule (conditions 1, 2, 4 sans le type) : ${so.passent12} passent 1-2 · ${so.ambigus} AMBIGUS refusés (dont ${so.ambigusAvecVerite} avec la vérité parmi les candidats) · ${so.uniques} uniques (${so.uniquesJustes} justes, ${so.uniquesFaux} FAUX) · ${so.aucun} sans candidat`);
        if (so.fauxListe.length) log(`      uniques FAUX (l'unicité seule ne suffit pas, d'où les conditions 1-3 et la limite aux énergies) : ${so.fauxListe.slice(0, 8).map(f => `${f.idProduct}: règle ${f.regle} ≠ ligne ${f.ligne}`).join(' ; ')}`);
        if (rj.faux) { err('❌ la règle complète désigne une carte fausse sur un produit déjà joint — rien n\'est écrit'); return 1; }

        // ── le plan
        const plan =planifier({ produits, lignes, nums, fiches, cartes: energies, setDoc, clone, nomJa });
        const parRaison = {}; for (const r of plan.refus) { const k = r.raison.replace(/\d+ cartes candidates/, 'N cartes candidates').replace(/^numéro .*/, 'numéro Cardmarket ≠ TCGdex').replace(/^type japonais .*/, 'type japonais ≠ type du produit'); parRaison[k] = (parRaison[k] || 0) + 1; }
        log(`   PLAN : ${plan.retenus.length} lignes sur ${new Set(plan.retenus.map(r => r.carteId)).size} cartes · ${plan.retenus.filter(r => r.impression).length} impressions SV-P à poser · ${plan.retenus.filter(r => r.ajouteSet).length} appartenances (cartes.sets) à ajouter · ${plan.refus.length} refusés`);
        for (const [k, n] of Object.entries(parRaison).sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(4)} refusés · ${k}`);
        log(`   numéros : ${plan.retenus.map(r => `${r.numero}=${r.carteId}`).join(' ')}`);
        if (arg('plan')) fs.writeFileSync(arg('plan'), JSON.stringify({ outil: 'poser-fiches-svp-energies', preuve: PREUVE, lignes: plan.retenus.map(r => r.ligne), impressions: plan.retenus.filter(r => r.impression).map(r => ({ carteId: r.carteId, ...r.impression })) }, null, 1));

        // ── les gardes qui ne se jouent que sur le plan : matière spéciale, repère d'adresse, règle du site
        try { require('./collecte-cartes/matiere-speciale').garderMatiereSpeciale(plan.retenus.map(r => r.p.idProduct), 'poser-fiches-svp-energies'); } catch (e) { err(e.message); return 1; }
        const ctl = R.controlerRepere(energies, parCarteDuPlan(plan));
        log(`   REPÈRES D'ADRESSE : ${ctl.cartes} cartes touchées · repère ET ordre conservés ${ctl.repereConserve}/${ctl.avecRepere} · déplacés ${ctl.deplaces.length} · liens.idProduct vide ${ctl.sansRepere.length}`);
        if (ctl.deplaces.length || ctl.sansRepere.length) { err(`❌ le repère d'adresse de ${ctl.deplaces.length + ctl.sansRepere.length} carte(s) bougerait — rien n'est écrit`); if (ecrireOk) return 1; }
        let siteOk = false;
        try {
            const site = await chargerSite();
            const docs = await dbC.collection('cartes').find({ sets: setDoc._id }).project({ nomEn: 1, sets: 1, impressions: 1, images: 1 }).toArray();
            const voulus = new Set(plan.retenus.map(r => r.carteId));
            const presents = new Set(docs.map(d => d._id));
            for (const c of energies) if (voulus.has(c._id) && !presents.has(c._id)) docs.push({ ...c, images: [] });
            const idsDocs = new Set(docs.map(d => d._id));
            const lignesAvant = await dbC.collection('cartes_produits').find({ idExpansion: ID_EXPANSION }).project({ idProduct: 1, carteId: 1, idExpansion: 1, slug: 1, slugSet: 1, numeroFiche: 1 }).toArray();
            const S = simulerSite({ site, setDoc, docs, lignesAvant: lignesAvant.filter(l => idsDocs.has(l.carteId)), plan });
            log(`   SITE (règle importée) : fiches ${S.avant.fiches} -> ${S.apres.fiches} · visuels servis ${S.avant.servis} -> ${S.apres.servis} (dont ${S.ajouteesServies} des lignes ajoutées) · lignes ajoutées avec fiche ${S.ajouteesAvecFiche}/${plan.retenus.length} dont au bon numéro ${S.ajouteesAuBonNumero} · PERDUS fiches ${S.perdusFiche.length}, visuels ${S.perdusServi.length} · produits doublés ${S.avant.doubles} -> ${S.apres.doubles}`);
            if (S.perdusFiche.length || S.perdusServi.length || S.apres.doubles > S.avant.doubles) { err(`❌ la règle du site perdrait ${S.perdusFiche.length} fiche(s), ${S.perdusServi.length} visuel(s) ou doublerait des produits — rien n'est écrit`); if (ecrireOk) return 1; }
            else if (S.ajouteesAvecFiche !== plan.retenus.length || S.ajouteesAuBonNumero !== plan.retenus.length) { err(`❌ ${plan.retenus.length - S.ajouteesAuBonNumero} ligne(s) n'auraient pas leur fiche au bon numéro sur le site — rien n'est écrit`); if (ecrireOk) return 1; }
            else siteOk = true;
        } catch (e) { err(`❌ la règle du site n'a pas pu être rejouée (${e.message}) — « je ne sais pas » bloque`); if (ecrireOk) return 1; }

        if (!ecrireOk) { log(`\n   (simulation — rien n'est écrit)  ${siteOk ? '' : '⚠️ la simulation du site n\'est pas concluante'}`); return 0; }
        const v = verifierAttendu(plan, Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const r = await ecrire(dbC, plan);
        log(`\n   ÉCRIT : lignes ${r.lignes}/${plan.retenus.length} · impressions ${r.impressions}/${plan.retenus.filter(x => x.impression).length} · cartes modifiées ${r.cartes}`);
        const rel = await relire(dbC, plan);
        log(`   RELECTURE : lignes ${rel.lignesOk}/${rel.attendu} · impressions ${rel.impressionsOk}/${plan.retenus.filter(x => x.impression).length} · cartes ${rel.cartesOk}/${parCarteDuPlan(plan).size}`);
        if (rel.lignesOk !== rel.attendu || rel.impressionsOk !== plan.retenus.filter(x => x.impression).length || rel.cartesOk !== parCarteDuPlan(plan).size) { err('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}

module.exports = { planifier, garderCalibration, verifierAttendu, operationsEcriture, ecrire, relire, simulerSite, parCarteDuPlan, executer, PREUVE, SOURCE_IMPRESSION, ID_EXPANSION, PROFIL_SVP };

if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const { pathToFileURL } = require('url');
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { lireClone } = require('./collecte-cartes/variantes-tcgdex');
        const exporteur = require('./exporter-donnees-logos-site');
        const SITE_LIB = process.env.SITE_LIB || 'C:/Users/Yung/Desktop/rat-market-site/lib';
        const chargerSite = async () => {
            const lire = f => import(pathToFileURL(path.join(SITE_LIB, f)).href);
            const [L, I] = await Promise.all([lire('langueDuVisuel.ts'), lire('imageDeLImpression.ts')]);
            const site = { regle: await exporteur.regleDuSite(__dirname, SITE_LIB), fichesDesProduits: exporteur.fichesDesProduits, refusDuVisuel: L.refusDuVisuel, imageDeLImpression: I.imageDeLImpression };
            for (const [k, f] of Object.entries(site)) if (k !== 'regle' && typeof f !== 'function') throw new Error(`${k} absent de ${SITE_LIB}`);
            return site;
        };
        let cx;
        const code = await executer({ argv: process.argv.slice(2), lireClone, chargerSite, ouvrir: async ({ ecriture }) => {
            cx = await ouvrirConnexions({ production: true, buckets: [], ...(ecriture ? {} : { lectureSeule: true }) });
            return { cartes: cx.cartes.db, prod: cx.prod.db, fermer: async () => cx.fermer() };
        } });
        process.exit(code);
    })().catch(e => { console.error(e); process.exit(1); });
}
