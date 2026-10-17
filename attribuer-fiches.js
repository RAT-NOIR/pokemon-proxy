// ============================================================
// ATTRIBUER LES PRODUITS OCCIDENTAUX SANS FICHE / NON ATTRIBUÉS PAR SET + NUMÉRO + NOM (lot FICHES, 2026-10-17)
// ============================================================
//   node attribuer-fiches.js [--cache=<dossier>]                                  SIMULATION (par défaut) : lecture seule, écrit les listes dans --sortie
//   node lot-additif.js --quoi="FICHES : <N> attributions set+numéro+nom" --collections=cartes_produits,cartes -- node attribuer-fiches.js --ecrire --attendu=<N>
//   node attribuer-fiches.js --retirer --manifeste=<fichier>                      RETRAIT EXACT, d'après le manifeste figé avant l'écriture
//
// La règle est dans collecte-cartes/regle-attribution-fiches.js (pure, écrite par ce qu'elle autorise). Ici : la LECTURE, les CAUSES recalculées avec leur
// dénominateur, la CALIBRATION (§67), le DIFF sous la règle du site importée, le MANIFESTE et l'ÉCRITURE ADDITIVE (lignes neuves en $setOnInsert ;
// numeroFiche posé SEULEMENT là où il est nul ; liens.idProduct/idMetacards en $addToSet, repère d'adresse intact ; jamais un nomEn, une image, un set).
const fs = require('fs');
const path = require('path');
const { preparerSet, calibrer, MOTIFS, PREUVE } = require('./collecte-cartes/regle-attribution-fiches');
const { estCarteCode } = require('./collecte-cartes/jointure');

const ROUTE = 'FICHES-2026-10-17';
const SITE_RACINE = 'C:/Users/Yung/Desktop/pokemon-proxy';   // regleDuSite() lit <racine>/../rat-market-site/lib
const SORTIE_DEFAUT = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/FICHES';

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.surs.length !== attendu) return { ok: false, raison: `le plan compte ${plan.surs.length} cas sûr(s), attendu ${attendu}` };
    return { ok: true };
}

/** Le MANIFESTE, figé AVANT l'écriture : de quoi tout retirer exactement. `lignesAvant`/`cartesAvant` : l'état lu juste avant. */
function construireManifeste({ surs, lignesAvant, cartesAvant, le = new Date() }) {
    const ligneDe = new Map(lignesAvant.map(l => [l._id, l])), carteDe = new Map(cartesAvant.map(c => [c._id, c]));
    const lignesNeuves = [], numerosFiche = [], parCarte = new Map();
    for (const s of surs) {
        const _id = `${s.carteId}|${s.idProduct}`;
        if (s.action === 'ligne-neuve') {
            lignesNeuves.push({ _id, carteId: s.carteId, idProduct: s.idProduct, idExpansion: s.idExpansion, tirage: s.tirage, preuve: s.preuve, detail: s.detail, numeroFiche: s.numeroFiche, slug: s.slug ?? null, slugSet: s.slugSet, verifieLe: le, route: ROUTE });
            const c = carteDe.get(s.carteId);
            const w = parCarte.get(s.carteId) || parCarte.set(s.carteId, { carteId: s.carteId, idProductsAjoutes: [], metasAjoutees: [], repereAvant: c?.liens?.idProduct?.[0] ?? null }).get(s.carteId);
            if (!(c?.liens?.idProduct || []).includes(s.idProduct) && !w.idProductsAjoutes.includes(s.idProduct)) w.idProductsAjoutes.push(s.idProduct);
            if (s.idMetacard != null && !(c?.liens?.idMetacards || []).includes(s.idMetacard) && !w.metasAjoutees.includes(s.idMetacard)) w.metasAjoutees.push(s.idMetacard);
        } else {
            const l = ligneDe.get(_id);
            numerosFiche.push({ _id, avant: l && l.numeroFiche != null ? l.numeroFiche : null, absentAvant: !!l && !('numeroFiche' in l), apres: s.numeroFiche });
        }
    }
    return { route: ROUTE, preuve: PREUVE, le, lignesNeuves, numerosFiche, cartes: [...parCarte.values()], metaDe: surs.filter(s => s.idMetacard != null).map(s => [s.idProduct, s.idMetacard]) };
}

/** L'ÉCRITURE ADDITIVE. Les lignes neuves et les liens passent par `ecrireFiches` (poser-fiches-prouvees.js : $setOnInsert, $addToSet en liste fermée) ; le numeroFiche ne se pose que sur un nul. */
async function ecrire(db, surs, manifeste) {
    const { ecrireFiches } = require('./poser-fiches-prouvees');
    const r = await ecrireFiches(db, manifeste.lignesNeuves, new Map(manifeste.metaDe), new Map());
    let n = 0;
    for (const x of manifeste.numerosFiche) {
        n += (await db.collection('cartes_produits').updateOne({ _id: x._id, $or: [{ numeroFiche: null }, { numeroFiche: { $exists: false } }] }, { $set: { numeroFiche: x.apres } })).modifiedCount;
    }
    return { lignes: r.lignes, cartes: r.cartes, numerosFiche: n };
}

/** La RELECTURE après écriture, d'après le manifeste. */
async function relire(db, manifeste) {
    const L = db.collection('cartes_produits');
    const presentes = await L.countDocuments({ _id: { $in: manifeste.lignesNeuves.map(l => l._id) }, route: ROUTE, preuve: PREUVE });
    let nf = 0;
    for (const x of manifeste.numerosFiche) if ((await L.findOne({ _id: x._id }))?.numeroFiche === x.apres) nf++;
    let cb = 0;
    for (const c of manifeste.cartes) {
        const d = await db.collection('cartes').findOne({ _id: c.carteId }, { projection: { liens: 1 } });
        const ids = d?.liens?.idProduct || [];
        if (c.idProductsAjoutes.every(i => ids.includes(i)) && (c.repereAvant == null || ids[0] === c.repereAvant)) cb++;
    }
    const ok = presentes === manifeste.lignesNeuves.length && nf === manifeste.numerosFiche.length && cb === manifeste.cartes.length;
    return { ok, lignes: `${presentes}/${manifeste.lignesNeuves.length}`, numerosFiche: `${nf}/${manifeste.numerosFiche.length}`, cartes: `${cb}/${manifeste.cartes.length}` };
}

/** Le RETRAIT EXACT : ne retire que ce que le manifeste a posé (ligne à NOTRE route, numeroFiche encore égal à celui qu'on a posé, ids que la carte n'avait pas). */
async function retirer(db, manifeste) {
    const L = db.collection('cartes_produits');
    let lignes = 0, nf = 0;
    for (const l of manifeste.lignesNeuves) lignes += (await L.deleteOne({ _id: l._id, route: manifeste.route, preuve: manifeste.preuve })).deletedCount;
    for (const x of manifeste.numerosFiche) {
        nf += (await L.updateOne({ _id: x._id, numeroFiche: x.apres }, x.absentAvant ? { $unset: { numeroFiche: 1 } } : { $set: { numeroFiche: x.avant } })).modifiedCount;
    }
    let cartes = 0;
    for (const c of manifeste.cartes) {
        const pull = {};
        if (c.idProductsAjoutes.length) pull['liens.idProduct'] = { $in: c.idProductsAjoutes };
        if (c.metasAjoutees.length) pull['liens.idMetacards'] = { $in: c.metasAjoutees };
        if (Object.keys(pull).length) cartes += (await db.collection('cartes').updateOne({ _id: c.carteId }, { $pull: pull })).modifiedCount;
    }
    return { lignes, numerosFiche: nf, cartes };
}

// ── LECTURE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function lireTout(cartesDb, prodDb) {
    const L = (db, n, filtre = {}, projection) => db.collection(n).find(filtre, projection ? { projection } : {}).toArray();
    const r = {
        sets: await L(cartesDb, 'sets'),
        cartes: await L(cartesDb, 'cartes', {}, { nomEn: 1, niveau: 1, 'attaques.nom': 1, impressions: 1, sets: 1, liens: 1, 'bulba.titre': 1 }),
        lignes: await L(cartesDb, 'cartes_produits'),
        catalogue: await L(prodDb, 'catalogue_produits', {}, { _id: 0, idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 }),
        numeros: await L(prodDb, 'numeros_cartes', {}, { _id: 0, idProduct: 1, idExpansion: 1, numero: 1, slug: 1, slugSet: 1 }),
    };
    for (const [k, v] of Object.entries(r)) if (!v.length) throw new Error(`lecture vide : « ${k} » (grappe fausse ?)`);
    return r;
}
function lireCache(dossier) {
    const l = n => JSON.parse(fs.readFileSync(path.join(dossier, `${n}.json`), 'utf8'));
    return { sets: l('sets'), cartes: l('cartes'), lignes: l('lignes'), catalogue: l('catalogue'), numeros: l('numeros') };
}

// ── LES CAUSES, RECALCULÉES (même définition que couverture\S7\COUV\etat-s7.js : la fiche du SITE décide « attribué ») ───────────────────────────────
async function chargerSite() {
    const { pathToFileURL } = require('url');
    const lire = f => import(pathToFileURL(path.join('C:/Users/Yung/Desktop/rat-market-site/lib', f)).href);
    const [C, A] = await Promise.all([lire('cardmarket.ts'), lire('additionals.ts')]);
    const site = { segmentDuSlug: C.segmentApresLeCode, estAdditionals: A.estAdditionals };
    for (const [k, f] of Object.entries(site)) if (typeof f !== 'function') throw new Error(`${k} absent du site`);
    return site;
}

function structure(D) {
    const setsParId = new Map(D.sets.map(s => [s._id, s]));
    const numParId = new Map(D.numeros.map(n => [n.idProduct, n]));
    const slugsExp = new Map();
    for (const n of D.numeros) if (n.slugSet) { const m = slugsExp.get(n.idExpansion) || slugsExp.set(n.idExpansion, new Map()).get(n.idExpansion); m.set(n.slugSet, (m.get(n.slugSet) || 0) + 1); }
    const slugExp = id => { const m = slugsExp.get(id); return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : null; };
    const produits = D.catalogue.filter(p => !estCarteCode(p.name)).map(p => { const n = numParId.get(p.idProduct); return { ...p, numero: n?.numero ?? null, slug: n?.slug ?? null, slugSet: n?.slugSet ?? null, appris: !!n, setResolu: n?.slugSet || slugExp(p.idExpansion) }; });
    const lignesDe = new Map();
    for (const l of D.lignes) (lignesDe.get(l.idProduct) || lignesDe.set(l.idProduct, []).get(l.idProduct)).push(l);
    const cartesParExp = new Map();
    for (const c of D.cartes) for (const e of new Set((c.impressions || []).map(i => i.expansion))) (cartesParExp.get(e) || cartesParExp.set(e, []).get(e)).push(c);
    return { setsParId, numParId, produits, lignesDe, cartesParExp };
}
const cartesDuSet = (S, set) => { const m = new Map(); for (const n of [].concat(set.bulba?.expansion ?? [])) for (const c of S.cartesParExp.get(n) || []) m.set(c._id, c); return [...m.values()]; };

/** Pour chaque set : la fiche du site (fichesDesProduits) sur les lignes données. Rend Map(setId → { fiche, ids }). */
function fichesDuSite(exporteur, regle, D, S, lignesParProduit) {
    const docsDeSet = new Map();
    for (const c of D.cartes) { if (typeof c.nomEn !== 'string' || c.nomEn === '' || !Array.isArray(c.sets)) continue; for (const sid of new Set(c.sets)) (docsDeSet.get(sid) || docsDeSet.set(sid, []).get(sid)).push(c); }
    const toutes = []; for (const ls of lignesParProduit.values()) toutes.push(...ls);
    const parExp = new Map(); for (const l of toutes) (parExp.get(l.idExpansion) || parExp.set(l.idExpansion, []).get(l.idExpansion)).push(l);
    const passes = new Map();
    for (const s of D.sets) {
        const exps = [].concat(s.idExpansion ?? []), docs = docsDeSet.get(s._id) || [], ids = new Set(docs.map(d => d._id));
        const lignes = exps.flatMap(e => parExp.get(e) || []).filter(l => ids.has(l.carteId));
        passes.set(s._id, { s, exps, ids, ...exporteur.fichesDesProduits(regle, s, docs, lignes) });
    }
    return passes;
}
const attribuee = (passes, setsDeExp, l) => (setsDeExp.get(l.idExpansion) || []).some(sid => { const p = passes.get(sid); const F = p?.ids.has(l.carteId) && p.fiche.get(l.idProduct); return F && F.carteId === l.carteId; });

function causes({ D, S, passes, site, tirageDe }) {
    const setsDeExp = new Map();
    for (const s of D.sets) for (const e of [].concat(s.idExpansion ?? [])) (setsDeExp.get(e) || setsDeExp.set(e, []).get(e)).push(s._id);
    const cibles = [];
    for (const p of S.produits) {
        const doc = p.setResolu ? S.setsParId.get(p.setResolu) : null;
        if (!doc || tirageDe(doc) !== 'intl') continue;
        const ls = S.lignesDe.get(p.idProduct) || [];
        if (!ls.length) { cibles.push({ idProduct: p.idProduct, set: doc._id, cause: 2, sous: p.appris ? 'produit APPRIS, sans ligne cartes_produits' : 'produit JAMAIS APPRIS (absent de numeros_cartes)' }); continue; }
        if (ls.some(l => attribuee(passes, setsDeExp, l))) continue;
        // cause 3 : la plus petite sous-cause parmi les lignes
        const sub = ls.map(l => {
            const ps = (setsDeExp.get(l.idExpansion) || []).map(sid => passes.get(sid)).filter(x => x && x.ids.has(l.carteId));
            if (!ps.length) return 'ligne hors de toute présentation au site (idExpansion sans document du set)';
            if (site.estAdditionals(ps[0].s._id)) return 'set Additionals';
            if (ps.some(x => x.fiche.get(l.idProduct) && x.fiche.get(l.idProduct).carteId !== l.carteId)) return 'fiche attribuée à une AUTRE carte';
            return 'non attribué (ou doublé : non séparable par produit)';
        });
        cibles.push({ idProduct: p.idProduct, set: doc._id, cause: 3, sous: sub[0] });
    }
    return cibles;
}

// ── LA SIMULATION ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const compter = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const parSet = D2 => compter(D2, x => x.set);

function planifier({ D, S, site, cibles }) {
    const parSetCibles = new Map();
    for (const c of cibles) (parSetCibles.get(c.set) || parSetCibles.set(c.set, []).get(c.set)).push(c);
    const surs = [], doutes = [];
    const produitsParSet = new Map();
    for (const p of S.produits) (produitsParSet.get(p.setResolu) || produitsParSet.set(p.setResolu, []).get(p.setResolu)).push(p);
    for (const [sid, cs] of parSetCibles) {
        const set = S.setsParId.get(sid);
        const prods = produitsParSet.get(sid) || [];
        const lignes = prods.flatMap(p => S.lignesDe.get(p.idProduct) || []);
        const ctx = preparerSet({ set, cartes: cartesDuSet(S, set), produits: prods, lignes, segmentDuSlug: site.segmentDuSlug, estAdditionals: site.estAdditionals });
        for (const c of cs) { const r = ctx.evaluer(c.idProduct); r.set = sid; r.cause = c.cause; r.sous = c.sous; (r.verdict === 'sur' ? surs : doutes).push(r); }
    }
    return { surs, doutes };
}

function calibrerTout({ D, S, site, passes, tirageDe }) {
    const setsDeExp = new Map();
    for (const s of D.sets) for (const e of [].concat(s.idExpansion ?? [])) (setsDeExp.get(e) || setsDeExp.set(e, []).get(e)).push(s._id);
    const bilan = { sets: 0, total: 0, justes: 0, faux: [], muets: 0, motifsMuets: {}, numeroFicheDifferent: [], parPreuve: {} };
    const produitsParSet = new Map();
    for (const p of S.produits) (produitsParSet.get(p.setResolu) || produitsParSet.set(p.setResolu, []).get(p.setResolu)).push(p);
    for (const [sid, prods] of produitsParSet) {
        const set = S.setsParId.get(sid);
        if (!set || tirageDe(set) !== 'intl') continue;
        // la vérité : les produits dont une ligne est ATTRIBUÉE par la fiche du site (la règle du site décide « juste »)
        const verite = new Map();
        for (const p of prods) {
            const ls = (S.lignesDe.get(p.idProduct) || []).filter(l => attribuee(passes, setsDeExp, l));
            if (ls.length) verite.set(p.idProduct, ls.map(l => ({ carteId: l.carteId, numeroFiche: l.numeroFiche ?? null, preuve: l.preuve })));
        }
        if (!verite.size) continue;
        const lignes = prods.flatMap(p => S.lignesDe.get(p.idProduct) || []);
        const ctx = preparerSet({ set, cartes: cartesDuSet(S, set), produits: prods, lignes, segmentDuSlug: site.segmentDuSlug, estAdditionals: site.estAdditionals });
        const r = calibrer(ctx, [...verite.keys()], verite);
        bilan.sets++; bilan.total += r.total; bilan.justes += r.justes; bilan.muets += r.muets;
        for (const f of r.faux) bilan.faux.push({ set: sid, ...f });
        for (const x of r.numeroFicheDifferent) bilan.numeroFicheDifferent.push({ set: sid, ...x });
        for (const [m, n] of Object.entries(r.motifsMuets)) bilan.motifsMuets[m] = (bilan.motifsMuets[m] || 0) + n;
        for (const [id, t] of verite) { const k = t[0].preuve; bilan.parPreuve[k] = (bilan.parPreuve[k] || 0) + 1; }
    }
    return bilan;
}

/** Les doublons transversaux (§32) : produits rattachés à plus d'UNE carte. */
const produitsAPlusieursCartes = lignes => { const m = new Map(); for (const l of lignes) (m.get(l.idProduct) || m.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId); return [...m].filter(([, s]) => s.size > 1).map(([id]) => id); };

async function diff({ cartesDb, D, S, site, surs, exporteur, regle, reglesServis }) {
    const SV = require('./collecte-cartes/simuler-servis');
    const ajouts = surs.filter(s => s.action === 'ligne-neuve').map(s => ({ _id: `${s.carteId}|${s.idProduct}`, carteId: s.carteId, idProduct: s.idProduct, idExpansion: s.idExpansion, slug: s.slug, slugSet: s.slugSet, numeroFiche: s.numeroFiche }));
    const nf = new Map(surs.filter(s => s.action === 'numeroFiche').map(s => [`${s.carteId}|${s.idProduct}`, s.numeroFiche]));
    const lignesApres = D.lignes.map(l => nf.has(l._id) ? { ...l, numeroFiche: nf.get(l._id) } : l);
    const sets = [...new Set(surs.map(s => s.slugSet))];
    const sortie = [];
    for (const sid of sets) {
        const set = S.setsParId.get(sid), exps = [].concat(set.idExpansion ?? []);
        const idsCartes = new Set([...D.cartes.filter(c => (c.sets || []).includes(sid)).map(c => c._id), ...surs.filter(s => s.slugSet === sid).map(s => s.carteId)]);
        const cartes = await cartesDb.collection('cartes').find({ _id: { $in: [...idsCartes] } }, { projection: { nomEn: 1, impressions: 1, sets: 1, images: 1 } }).toArray();
        const avantL = D.lignes.filter(l => exps.includes(l.idExpansion)), apresL = lignesApres.filter(l => exps.includes(l.idExpansion));
        const aj = ajouts.filter(a => a.slugSet === sid);
        const servAvant = await SV.produitsServis({ setsDocs: [set], cartes, lignes: avantL, regles: reglesServis });
        const servApres = await SV.produitsServis({ setsDocs: [set], cartes, lignes: apresL, ajouts: aj, regles: reglesServis });
        // « attribué » (la fiche du site) sans l'image
        const attr = (lignes, ajs) => {
            const docs = cartes.filter(c => typeof c.nomEn === 'string' && c.nomEn !== '' && (c.sets || []).includes(sid));
            const ids = new Set(docs.map(d => d._id));
            const ls = [...lignes, ...ajs].filter(l => exps.includes(l.idExpansion) && ids.has(l.carteId));
            const { fiche } = exporteur.fichesDesProduits(regle, set, docs, ls);
            return new Set(ls.filter(l => fiche.get(l.idProduct)?.carteId === l.carteId).map(l => l.idProduct));
        };
        const aAvant = attr(avantL, []), aApres = attr(apresL, aj);
        sortie.push({ set: sid, attribuesAvant: aAvant.size, attribuesApres: aApres.size, devenusAttribues: [...aApres].filter(x => !aAvant.has(x)), perdusAttribues: [...aAvant].filter(x => !aApres.has(x)), servisAvant: servAvant.size, servisApres: servApres.size, gagnesServis: [...servApres].filter(x => !servAvant.has(x)), perdusServis: [...servAvant].filter(x => !servApres.has(x)) });
    }
    return sortie;
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, log = console.log, err = console.error }) {
    const AUTORISES = [/^--ecrire$/, /^--retirer$/, /^--attendu=\d+$/, /^--manifeste=.+\.json$/, /^--cache=.+$/, /^--sortie=.+$/, /^--sans-diff$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const ecrireM = argv.includes('--ecrire'), retirerM = argv.includes('--retirer');
    if (ecrireM && retirerM) { err('❌ --ecrire et --retirer ne vont pas ensemble'); return 2; }
    const sortie = path.resolve(arg('sortie') || SORTIE_DEFAUT);
    fs.mkdirSync(sortie, { recursive: true });
    if (retirerM) {
        if (!arg('manifeste')) { err('❌ --retirer exige --manifeste=<fichier>'); return 2; }
        const m = JSON.parse(fs.readFileSync(path.resolve(arg('manifeste')), 'utf8'));
        const cx = await ouvrirEcriture();
        try { const r = await retirer(cx.cartes.db, m); log(`   RETRAIT d'après ${arg('manifeste')} : lignes ${r.lignes} · numeroFiche restitués ${r.numerosFiche} · cartes ${r.cartes}`); return 0; } finally { await cx.fermer(); }
    }
    const cx = ecrireM ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const D = arg('cache') ? lireCache(path.resolve(arg('cache'))) : await lireTout(cx.cartes.db, cx.prod.db);
        const site = await chargerSite();
        const exporteur = require('./exporter-donnees-logos-site');
        const regle = await exporteur.regleDuSite(SITE_RACINE);
        const { tirageDe } = require('./collecte-cartes/ventilation-langue');
        const S = structure(D);
        log(`   LU : ${D.sets.length} sets · ${D.cartes.length} cartes · ${D.lignes.length} lignes · ${D.catalogue.length} produits au catalogue (${S.produits.length} hors cartes-code) · ${D.numeros.length} numeros_cartes`);
        const passes = fichesDuSite(exporteur, regle, D, S, S.lignesDe);
        const cibles = causes({ D, S, passes, site, tirageDe });
        log(`\n   CIBLES RECALCULÉES (intl, non attribuées par la fiche du site) : ${cibles.length} · cause 2 (sans ligne) ${cibles.filter(c => c.cause === 2).length} · cause 3 (ligne non attribuée) ${cibles.filter(c => c.cause === 3).length}`);
        for (const [k, n] of Object.entries(compter(cibles, c => `${c.cause} | ${c.sous}`))) log(`      ${n}\t${k}`);
        const plan = planifier({ D, S, site, cibles });
        log(`\n   RÈGLE : ${plan.surs.length} cas sûr(s) · ${plan.doutes.length} doute(s) sur ${cibles.length} cibles (somme ${plan.surs.length + plan.doutes.length})`);
        const motifs = compter(plan.doutes, d => d.motif);
        for (const m of MOTIFS) if (motifs[m]) log(`      doute « ${m} » : ${motifs[m]}`);
        const horsListe = Object.keys(motifs).filter(m => !MOTIFS.includes(m));
        if (horsListe.length) { err(`❌ motif hors de la liste fermée : ${horsListe.join(', ')}`); return 1; }
        log(`      sûrs par action : ${JSON.stringify(compter(plan.surs, s => s.action))} · hors set (non servis sans cartes.sets) : ${plan.surs.filter(s => s.horsSet).length}`);
        const cal = calibrerTout({ D, S, site, passes, tirageDe });
        log(`\n   CALIBRATION (lignes déjà attribuées par le site, cachées puis rejouées) : ${cal.sets} sets · ${cal.total} produits · justes ${cal.justes} · FAUX ${cal.faux.length} · muets ${cal.muets} · numeroFiche différent (carte juste) ${cal.numeroFicheDifferent.length}`);
        log(`      vérité par preuve de la ligne cachée : ${JSON.stringify(cal.parPreuve)}`);
        log(`      muets par motif : ${JSON.stringify(cal.motifsMuets)}`);
        const avantPlus = produitsAPlusieursCartes(D.lignes);
        const apresLignes = [...D.lignes, ...plan.surs.filter(s => s.action === 'ligne-neuve').map(s => ({ idProduct: s.idProduct, carteId: s.carteId }))];
        const apresPlus = produitsAPlusieursCartes(apresLignes);
        log(`\n   CONTRÔLE TRANSVERSAL (§32) : produits rattachés à plusieurs cartes — avant ${avantPlus.length}, après ${apresPlus.length}${apresPlus.length > avantPlus.length ? ' 🔴 HAUSSE' : ''}`);
        let d = [];
        if (!argv.includes('--sans-diff') && plan.surs.length) {
            const SV = require('./collecte-cartes/simuler-servis');
            d = await diff({ cartesDb: cx.cartes.db, D, S, site, surs: plan.surs, exporteur, regle, reglesServis: await SV.reglesDuSite() });
            for (const x of d) log(`   DIFF ${x.set} : attribués ${x.attribuesAvant} → ${x.attribuesApres} (devenus ${JSON.stringify(x.devenusAttribues)}, perdus ${JSON.stringify(x.perdusAttribues)}) · servis ${x.servisAvant} → ${x.servisApres} (gagnés ${JSON.stringify(x.gagnesServis)}, perdus ${JSON.stringify(x.perdusServis)})`);
            log(`   DIFF TOTAL : devenus attribués ${d.reduce((n, x) => n + x.devenusAttribues.length, 0)} · gagnés servis ${d.reduce((n, x) => n + x.gagnesServis.length, 0)} · PERDUS attribués ${d.reduce((n, x) => n + x.perdusAttribues.length, 0)} · PERDUS servis ${d.reduce((n, x) => n + x.perdusServis.length, 0)} · images écrites : 0 (aucune opération sur cartes.images ni R2)`);
        }
        fs.writeFileSync(path.join(sortie, 'fiches-ecritures.json'), JSON.stringify(plan.surs, null, 1));
        fs.writeFileSync(path.join(sortie, 'fiches-doutes.json'), JSON.stringify(plan.doutes, null, 1));
        fs.writeFileSync(path.join(sortie, 'fiches-calibration.json'), JSON.stringify(cal, null, 1));
        fs.writeFileSync(path.join(sortie, 'fiches-diff.json'), JSON.stringify(d, null, 1));
        log(`\n   ÉCRIT dans ${sortie} : fiches-ecritures.json (${plan.surs.length}) · fiches-doutes.json (${plan.doutes.length}) · fiches-calibration.json · fiches-diff.json`);
        if (cal.faux.length) { err(`🔴 CALIBRATION : ${cal.faux.length} FAUX — la règle se resserre avant toute écriture`); if (ecrireM) return 1; }
        if (!ecrireM) { log('   (simulation — rien n\'est écrit. Écriture : lot-additif.js … -- node attribuer-fiches.js --ecrire --attendu=N)'); return cal.faux.length ? 1 : 0; }
        const v = verifierAttendu(plan, arg('attendu') === undefined ? undefined : Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        if (avantPlus.length < apresPlus.length) { err('❌ ARRÊT : le contrôle transversal monterait — rien n\'est écrit'); return 1; }
        const manifeste = construireManifeste({ surs: plan.surs, lignesAvant: D.lignes, cartesAvant: D.cartes });
        const fm = path.join(sortie, `fiches-manifeste-${Date.now()}.json`);
        fs.writeFileSync(fm, JSON.stringify(manifeste, null, 1));   // FIGÉ avant la première écriture
        log(`   MANIFESTE figé : ${fm}`);
        const r = await ecrire(cx.cartes.db, plan.surs, manifeste);
        const rl = await relire(cx.cartes.db, manifeste);
        log(`   ✅ lignes posées ${r.lignes} · numeroFiche posés ${r.numerosFiche} · cartes modifiées ${r.cartes} · relu : lignes ${rl.lignes} · numeroFiche ${rl.numerosFiche} · cartes ${rl.cartes}`);
        return rl.ok && r.lignes === manifeste.lignesNeuves.length && r.numerosFiche === manifeste.numerosFiche.length ? 0 : 1;
    } finally { await cx.fermer(); }
}

async function ouvrirLecture() {
    const { MongoClient } = require('mongodb');
    const u1 = process.env.MONGODB_CARTES_LECTURE_URI, u2 = process.env.MONGODB_LECTURE_URI;
    if (!u1 || !u2) throw new Error('MONGODB_CARTES_LECTURE_URI et MONGODB_LECTURE_URI obligatoires pour la simulation (lecture seule)');
    const a = new MongoClient(u1), b = new MongoClient(u2);
    await Promise.all([a.connect(), b.connect()]);
    const cartes = a.db('cartes'), prod = b.db('test');
    for (const [nom, db] of [['cartes', cartes], ['test', prod]]) if (!(await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error(`base « ${nom} » vide : grappe fausse ?`);
    return { cartes: { db: cartes }, prod: { db: prod }, fermer: async () => { await Promise.allSettled([a.close(), b.close()]); } };
}

module.exports = { verifierAttendu, construireManifeste, ecrire, relire, retirer, executer, ROUTE, planifier, causes, structure };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    executer({ argv: process.argv.slice(2), ouvrirLecture, ouvrirEcriture: () => require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
