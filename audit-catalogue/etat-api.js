'use strict';
// ============================================================
// L'ÉTAT DU CATALOGUE TEL QUE L'API LE CONSTRUIRAIT — lecture seule, aucune règle recopiée (brief S8/AUDIT, mesures 1 à 3)
// ============================================================
// 🔑 CE QUI EST IMPORTÉ, JAMAIS RECOPIÉ (§21 bis, et le motif dominant : la sonde lit la même chose que la production) :
//   · le prédicat des cartes-code : `estCarteCode` de collecte-cartes/jointure.js (celui de mesure-catalogue.js) ;
//   · la chaîne de l'API : `chargerApi` (garde-contrat-api.js) → `decider` sur TOUS les sets, puis `lireEntree` sur chaque entrée ;
//   · la règle des fiches du site : `fichesDesProduits` (exporter-donnees-logos-site.js), appelée PAR `decider` ; on l'ENVELOPPE pour lire ce qu'elle
//     attribue, on ne la rejoue pas ; même chose pour `choisirVisuel` (le choix du visuel) — l'enveloppe lit les sorties, ne change rien ;
//   · le témoin du nom : `temoinDuNom` de jointure.js (avec l'idExpansion de la ligne, comme `joindre()`).
// Ce que cet outil NE fait PAS : écrire. Ni base, ni R2, ni Cardmarket.
const path = require('path');
const { ouvrirLecture } = require('./lecture-audit');
const { lireMongo, champSur, apparier } = require('../collecte-cartes/lecture-sure');
const { estCarteCode, temoinDuNom, decomposerNomCardmarket } = require('../collecte-cartes/jointure');
const { chargerApi } = require('../collecte-cartes/garde-contrat-api');
const C = require('./classement');

const TIRAGE_FAMILLE = Object.freeze({ intl: 'occidental', jp: 'japonais', 'zh-hans': 'chinois', 'zh-hant': 'chinois', id: 'asie-du-sud-est', th: 'asie-du-sud-est', idth: 'asie-du-sud-est' });
const REGION_CODES = Object.freeze({ occidental: 'intl', japonais: 'jp' });   // codes_set.region → tirage (table-maitresse.mjs:184)

/** Lit tout ce qu'il faut. Chaque lecture passe par lireMongo (un vide sur une population non vide LÈVE). */
async function chargerDonnees({ prod, cartes }, api) {
    const t0 = Date.now();
    const catalogue = await lireMongo(prod.collection('catalogue_produits'), {}, { nom: 'catalogue_produits', projection: { _id: 0, idProduct: 1, name: 1, idExpansion: 1, idMetacard: 1, dateAdded: 1 } });
    champSur(catalogue, 'name', { collection: 'catalogue_produits' }); champSur(catalogue, 'idExpansion', { collection: 'catalogue_produits' });
    const codes = await lireMongo(prod.collection('codes_set'), {}, { nom: 'codes_set', projection: { _id: 0, codeSet: 1, region: 1, idExpansion: 1 } });
    const nc = await lireMongo(prod.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { _id: 0, idProduct: 1, codeSet: 1, slugSet: 1, idExpansion: 1, numero: 1 } });
    const P = api.PROJECTIONS;
    const setsBruts = await lireMongo(cartes.collection('sets'), {}, { nom: 'sets', projection: { ...P.sets, type: 1, reimpressions: 1, nomEn: 1, nomCardmarket: 1 } });
    const cartesBrutes = await lireMongo(cartes.collection('cartes'), {}, { nom: 'cartes', projection: { ...P.cartes, niveau: 1, 'attaques.nom': 1 } });
    const lignesBrutes = await lireMongo(cartes.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { ...P.cartes_produits, preuve: 1 } });
    const I = api.interneur();
    // le témoin du nom lit nomEn, niveau et attaques (les cartes du set, TOUTES) ; `decider` lit les documents COMPACTÉS comme le chargeur de l'API
    const temoinCartes = cartesBrutes.map(d => ({ _id: d._id, nomEn: d.nomEn, niveau: d.niveau, attaques: d.attaques || [], sets: d.sets || [] }));
    const docs = cartesBrutes.map(d => api.compacterCarte(d, I));
    const sets = setsBruts.map(d => api.compacterSet(d, I));
    const lignes = lignesBrutes.map(d => api.compacterLigne(d, I));
    const preuveDe = new Map(lignesBrutes.map(d => [`${d.carteId}|${d.idProduct}`, d.preuve ?? null]));
    // dénominateurs : une jointure entre deux populations non vides ne peut pas être vide (§41)
    const idsCat = new Set(catalogue.map(p => p.idProduct));
    const app = apparier(lignes.map(l => l.idProduct), idsCat, { gauche: 'cartes_produits', droite: 'catalogue_produits', cle: 'idProduct' });
    console.log(`lectures : catalogue ${catalogue.length} · codes_set ${codes.length} · numeros_cartes ${nc.length} · sets ${sets.length} · cartes ${docs.length} · cartes_produits ${lignes.length} (idProduct retrouvés au catalogue : ${app.trouvees.length}/${new Set(lignes.map(l => l.idProduct)).size}) · ${Math.round((Date.now() - t0) / 1000)} s`);
    return { catalogue, codes, nc, setsBruts, sets, docs, lignes, temoinCartes, preuveDe };
}

/** Rejoue `decider` de l'API sur TOUS les sets, en enveloppant (sans les changer) choisirVisuel et fichesDesProduits pour LIRE leurs sorties. */
async function rejouerApi({ api, sets, docs, lignes, catalogue }) {
    const Lg = require(path.join(api.dossier, 'exporter-donnees-logos-site.js'));
    const D = require(path.join(api.dossier, 'v2/chargeur/decision.js'));
    if (D.EXCLURE_BASSE_DEFINITION !== false) throw new Error('decision.js : EXCLURE_BASSE_DEFINITION n\'est plus false — l\'élimination des motifs de MANQUANT de cet outil n\'est plus valable, à revoir');
    for (const k of ['choisirVisuel', 'fichesDesProduits']) if (typeof Lg[k] !== 'function') throw new Error(`exporter-donnees-logos-site.js : ${k} absent — l'enveloppe ne peut rien lire`);
    const traces = new Map();                 // idProduct → [trace par LIGNE ayant atteint choisirVisuel]
    const fichesParSet = new Map();           // setId → Map(idProduct → fiche du site)
    const choisir0 = Lg.choisirVisuel, fiches0 = Lg.fichesDesProduits;
    let appelsChoisir = 0, appelsFiches = 0;
    Lg.choisirVisuel = function (args) {
        const r = choisir0.apply(this, arguments);
        appelsChoisir++;
        const l = args.ligne, im = r.im;
        const t = { carteId: l.carteId, setId: args.set._id, sansFiche: r.sansFiche === true, visuel: r.visuel ?? null,
            fiche: args.fiche ? { carteId: args.fiche.carteId, numero: args.fiche.numero ?? null, rang: args.fiche.rang ?? null } : null,
            im: im ? { cleR2: im.cleR2 ?? null, set: im.set ?? null, source: im.source ?? null, langue: im.langue ?? null, numero: im.numero ?? null, w: im.w ?? null, h: im.h ?? null,
                basseDefinition: im.basseDefinition ?? null, imageEmprunteeTirage: im.imageEmprunteeTirage ?? null, vignette: im.vignette?.cleR2 ?? null } : null,
            refus: im ? D.refusDeRepli({ ligne: l, set: args.set, im, visuel: r.visuel }) : null };
        (traces.get(l.idProduct) || traces.set(l.idProduct, []).get(l.idProduct)).push(t);
        return r;
    };
    Lg.fichesDesProduits = function (regle, set) {
        const r = fiches0.apply(this, arguments);
        appelsFiches++;
        fichesParSet.set(set._id, r.fiche);
        return r;
    };
    try {
        const metacarte = new Map(catalogue.map(p => [p.idProduct, p.idMetacard ?? null]));
        const t0 = Date.now();
        const r = await api.decider({ sets, docs, lignes, metacarte, regle: api.regle, cederLaMain: false });
        console.log(`decider : ${r.entrees.length} entrées · ${appelsFiches} sets à fiches · ${appelsChoisir} choix de visuel · ${Math.round((Date.now() - t0) / 1000)} s`);
        if (!appelsChoisir || !appelsFiches) throw new Error('l\'enveloppe n\'a rien lu (0 appel) : decider n\'appelle plus les fonctions enveloppées — je ne conclus pas');
        if (typeof Lg.tamponProbable !== 'function') throw new Error('exporter-donnees-logos-site.js : tamponProbable absent — le prédicat de tampon ne se recopie pas');
        return { entrees: r.entrees, denominateurs: r.denominateurs, traces, fichesParSet, tamponProbable: Lg.tamponProbable };
    } finally { Lg.choisirVisuel = choisir0; Lg.fichesDesProduits = fiches0; }
}

const STADE = { 'sans-fiche-du-site': 0, 'aucun-visuel': 1, 'repli-refuse': 2, 'partage-incoherent': 3, 'entree-refusee': 4 };

/** Le motif de MANQUANT d'un produit sans entrée servie : le stade le plus avancé atteint par l'une de ses lignes (decider écarte, dans l'ordre : sans fiche, sans visuel, repli, partage). */
function motifManquant({ lignes, traces, carteExiste, entreeRefusee }) {
    if (!lignes.length) return 'sans-ligne';
    if (entreeRefusee) return `entree-refusee:${entreeRefusee}`;
    let meilleur = null, rang = -1;
    const consider = (motif, r) => { if (r > rang) { rang = r; meilleur = motif; } };
    for (const l of lignes) {
        const ts = (traces || []).filter(t => t.carteId === l.carteId);
        if (!ts.length) { consider(carteExiste(l.carteId) ? 'aucun-set-candidat' : 'carte-absente', -1 + 0.5); continue; }
        for (const t of ts) {
            if (t.sansFiche) consider('sans-fiche-du-site', STADE['sans-fiche-du-site']);
            else if (!t.im) consider('aucun-visuel', STADE['aucun-visuel']);
            else if (t.refus) consider(`repli-refuse:${t.refus}`, STADE['repli-refuse']);
            else consider('partage-incoherent', STADE['partage-incoherent']);
        }
    }
    return meilleur || 'inconnu';
}

/** Assemble, produit par produit (hors cartes-code), la fiche et le visuel. Rend { produits, horsPerimetre }. */
function assembler({ api, donnees, rejeu }) {
    const { catalogue, setsBruts, docs, lignes, temoinCartes, preuveDe, nc } = donnees;
    const { entrees, traces, fichesParSet, tamponProbable } = rejeu;
    const numeroDeProduit = new Map(nc.map(n => [n.idProduct, n.numero]));
    const nonVide = x => x !== null && x !== undefined && String(x).trim() !== '';
    const setDe = new Map(setsBruts.map(s => [s._id, s]));
    const carteExiste = id => carteSet.has(id);
    const carteSet = new Set(docs.map(d => d._id));
    const carteDeTemoin = new Map(temoinCartes.map(c => [c._id, c]));
    const parSetCartes = new Map();
    for (const c of temoinCartes) for (const s of c.sets) (parSetCartes.get(s) || parSetCartes.set(s, []).get(s)).push(c);
    const temoins = new Map();
    const temoinDe = (setId, idExpansion) => { const k = `${setId}|${idExpansion}`; if (!temoins.has(k)) temoins.set(k, temoinDuNom(parSetCartes.get(setId) || [], idExpansion)); return temoins.get(k); };
    const lignesDe = new Map();
    for (const l of lignes) (lignesDe.get(l.idProduct) || lignesDe.set(l.idProduct, []).get(l.idProduct)).push(l);
    const entreesDe = new Map();
    for (const e of entrees) (entreesDe.get(e.idProduct) || entreesDe.set(e.idProduct, []).get(e.idProduct)).push(e);
    const setANumeros = new Map([...fichesParSet].map(([id, m]) => [id, [...m.values()].some(f => f.numero !== null && f.numero !== undefined)]));
    const produits = [], horsPerimetre = [];
    for (const p of catalogue) {
        if (estCarteCode(p.name)) { horsPerimetre.push(p.idProduct); continue; }
        const ls = lignesDe.get(p.idProduct) || [];
        const ts = traces.get(p.idProduct) || [];
        // ── la fiche attribuée par la règle du site : une trace dont la fiche est celle de la carte de la ligne (choisirVisuel : `fiche.carteId === ligne.carteId`)
        const tFiche = ts.find(t => !t.sansFiche) || null;
        const autreCarte = !tFiche && ts.some(t => t.fiche && t.fiche.carteId !== t.carteId);
        const ficheSite = tFiche ? { carteId: tFiche.fiche.carteId, numero: tFiche.fiche.numero, setId: tFiche.setId } : null;
        // ── le témoin du nom, sur la ligne qui porte la fiche (ou, à défaut, sur chaque ligne dont on connaît le set)
        const d = decomposerNomCardmarket(p.name);
        let temoinContredit = false, temoinMuet = false;
        const cibles = ficheSite ? [{ carteId: ficheSite.carteId, setId: ficheSite.setId }] : ts.map(t => ({ carteId: t.carteId, setId: t.setId }));
        for (const c of cibles) {
            const carte = carteDeTemoin.get(c.carteId);
            if (!carte || !carte.nomEn) { temoinMuet = true; continue; }
            const autres = temoinDe(c.setId, p.idExpansion)(carte, { nom: d.nom, attaques: d.attaques });
            if (autres) temoinContredit = true;
        }
        const f = C.classerFiche({ lignes: ls.map(l => ({ carteId: l.carteId, preuve: preuveDe.get(`${l.carteId}|${l.idProduct}`) ?? undefined })), ficheSite,
            temoinContredit, setANumeros: ficheSite ? setANumeros.get(ficheSite.setId) === true : false,
            // le numéro du produit est CONNU : numeros_cartes.numero, ou le numeroFiche d'une de ses lignes (seuils.md : `sans-numero` resserrée)
            numeroConnu: nonVide(numeroDeProduit.get(p.idProduct)) || ls.some(l => nonVide(l.numeroFiche)) });
        // ── le visuel que l'API construirait : decider PUIS lireEntree
        let servi = null, entreeRefusee = null, plusieursEntrees = (entreesDe.get(p.idProduct) || []).length > 1, entree = null;
        for (const e of entreesDe.get(p.idProduct) || []) {
            const j = api.lireEntree(e);
            if (j.ok) { servi = e; break; }
            entreeRefusee = entreeRefusee || j.motif;
        }
        if (servi) {
            const t = ts.find(x => x.im && x.im.cleR2 && x.im.cleR2 === servi.grande?.cleR2) || null;
            entree = { visuel: servi.visuel, mention: servi.mention ?? null, numero: servi.numero ?? null, setNom: servi.setNom ?? null, vignette: servi.vignette ?? null, grande: servi.grande ?? null,
                basseDefinition: servi.basseDefinition ?? null, variante: servi.variante ?? null, tamponNonRepresente: servi.tamponNonRepresente ?? null, partageeHoloNonHolo: servi.partageeHoloNonHolo ?? null, imageEmprunteeTirage: t?.im?.imageEmprunteeTirage ?? null, source: t?.im?.source ?? null, langueVisuel: t?.im?.langue ?? null, setVisuel: t?.im?.set ?? null };
        }
        // ce que l'API a REFUSÉ de servir (repli-réimpressions) : la NATURE du visuel écarté — emprunté (substitut, autre tirage) ou non, pour que « manquant » ne cache pas un emprunt
        // (sous-motif `emprunt-refuse-par-api`, seuils.md : il reste MANQUANT, puisque c'est ce que l'API sert)
        const refuse = !servi ? ts.filter(t => t.refus).map(t => ({ famille: t.refus, nature: t.im?.imageEmprunteeTirage === true ? 'image-empruntee-tirage' : t.visuel })) : [];
        const v = C.classerVisuel({ servi: entree, motifManquant: servi ? undefined : motifManquant({ lignes: ls, traces: ts, carteExiste, entreeRefusee }), refuse: refuse[0] });
        const setId = (ficheSite?.setId) || ts[0]?.setId || ls.find(l => l.slugSet && setDe.has(l.slugSet))?.slugSet || null;
        // ce que l'empreinte ne voit pas : la finition et le tampon, lus dans ce qu'on a déjà (seuils.md) ; le slug est celui de la ligne
        const finition = entree ? C.finitionOuTampon({ nom: p.name, slug: ls.find(l => l.slug)?.slug, variante: entree.variante, tamponNonRepresente: entree.tamponNonRepresente, partageeHoloNonHolo: entree.partageeHoloNonHolo,
            setTamponnee: setDe.get(setId)?.reimpressions ?? null, tamponProbable }) : null;
        produits.push({ idProduct: p.idProduct, idExpansion: p.idExpansion, name: p.name, setId, nLignes: ls.length, preuves: [...new Set(ls.map(l => preuveDe.get(`${l.carteId}|${l.idProduct}`)).filter(Boolean))],
            fiche: { ...f, setId: ficheSite?.setId ?? null, carteId: ficheSite?.carteId ?? null, numero: ficheSite?.numero ?? null, autreCarte: autreCarte || undefined, temoinMuet: temoinMuet || undefined },
            visuel: { ...v, entree, finition, plusieursEntrees: plusieursEntrees || undefined } });
    }
    return { produits, horsPerimetre };
}

/**
 * « SAIT-ELLE REFUSER ? » (§41, §51) : zéro fiche contredite par le témoin du nom est un résultat PLAUSIBLE — et celui d'un témoin qui ne mord sur rien. On le fait donc crier sur des états
 * FABRIQUÉS : pour un échantillon de produits à fiche, on lui présente, à la place de la vraie carte, une AUTRE carte du même set (nom différent). Il doit la contredire.
 * @returns {{ essais: number, contredits: number, silenceSurLaVraie: number, vraiesTestees: number }}
 */
function controlerTemoin({ donnees, produits, pas = 25, plafond = 600 }) {
    const parSet = new Map();
    for (const c of donnees.temoinCartes) for (const s of c.sets) (parSet.get(s) || parSet.set(s, []).get(s)).push(c);
    const carteDe = new Map(donnees.temoinCartes.map(c => [c._id, c]));
    const temoins = new Map();
    const temoinDe = (setId, idExp) => { const k = `${setId}|${idExp}`; if (!temoins.has(k)) temoins.set(k, temoinDuNom(parSet.get(setId) || [], idExp)); return temoins.get(k); };
    let essais = 0, contredits = 0, silenceSurLaVraie = 0, vraiesTestees = 0;
    const candidats = produits.filter(p => p.fiche.carteId != null && p.fiche.setId);
    for (let i = 0; i < candidats.length && essais < plafond; i += pas) {
        const p = candidats[i], vraie = carteDe.get(p.fiche.carteId), cartes = parSet.get(p.fiche.setId) || [];
        if (!vraie?.nomEn) continue;
        const d = decomposerNomCardmarket(p.name);
        vraiesTestees++; if (!temoinDe(p.fiche.setId, p.idExpansion)(vraie, { nom: d.nom, attaques: d.attaques })) silenceSurLaVraie++;
        const autre = cartes.find(c => c._id !== vraie._id && c.nomEn && c.nomEn.toLowerCase() !== vraie.nomEn.toLowerCase() && !String(vraie.nomEn).toLowerCase().includes(String(c.nomEn).toLowerCase()) && !String(c.nomEn).toLowerCase().includes(String(vraie.nomEn).toLowerCase()));
        if (!autre) continue;
        essais++; if (temoinDe(p.fiche.setId, p.idExpansion)(autre, { nom: d.nom, attaques: d.attaques })) contredits++;
    }
    return { essais, contredits, silenceSurLaVraie, vraiesTestees };
}

/** La langue d'un set : son tirage (`tirage ?? region`, la clé du site). */
const tirageDe = s => s?.tirage ?? s?.region ?? null;

/** La mesure 1 : par idExpansion de l'export, avec sa langue. */
function mesurerSets({ donnees, produits, horsPerimetre }) {
    const { catalogue, codes, nc, setsBruts, lignes } = donnees;
    const parExp = new Map();
    for (const p of produits) (parExp.get(p.idExpansion) || parExp.set(p.idExpansion, []).get(p.idExpansion)).push(p);
    const setsParExp = new Map();
    for (const s of setsBruts) for (const x of [].concat(s.idExpansion ?? [])) (setsParExp.get(x) || setsParExp.set(x, []).get(x)).push(s);
    const setParId = new Map(setsBruts.map(s => [s._id, s]));
    const regionDeCode = new Map(codes.map(c => [c.codeSet, c.region]));
    const ncDe = new Map(nc.map(n => [n.idProduct, n]));
    const lignesExp = new Map();       // idExpansion → { lignes, setsParSlug : Set des slugSet qui existent }
    for (const l of lignes) {
        const e = (lignesExp.get(l.idExpansion) || lignesExp.set(l.idExpansion, { n: 0, slugsExistants: new Set() }).get(l.idExpansion));
        e.n++; if (l.slugSet && setParId.has(l.slugSet)) e.slugsExistants.add(l.slugSet);
    }
    const lignesSet = [];
    for (const [idExpansion, ps] of [...parExp].sort((a, b) => a[0] - b[0])) {
        const sets = setsParExp.get(idExpansion) || [];
        const viaLigne = lignesExp.get(idExpansion);
        const slugsViaLignes = viaLigne ? [...viaLigne.slugsExistants] : [];
        const setsEff = sets.length ? sets : slugsViaLignes.map(s => setParId.get(s));
        const ncs = ps.map(p => ncDe.get(p.idProduct)).filter(Boolean);
        const codeSet = ncs.find(n => n.codeSet)?.codeSet ?? null;
        const regionCode = regionDeCode.get(codeSet) ?? null;
        const tirages = [...new Set(setsEff.map(tirageDe).filter(Boolean))];
        let langue, langueSource;
        if (tirages.length === 1) { langue = tirages[0]; langueSource = 'set.tirage??region'; }
        else if (tirages.length > 1) { langue = tirages.sort().join('+'); langueSource = 'sets-discordants'; }
        else if (REGION_CODES[regionCode]) { langue = REGION_CODES[regionCode]; langueSource = 'codes_set.region'; }
        else { langue = 'inconnue'; langueSource = null; }
        const sansLigne = ps.filter(p => p.nLignes === 0).length;
        const fiche = ps.filter(p => p.fiche.classe === 'FICHE_OK' || p.fiche.classe === 'FICHE_DOUTEUSE').length;
        const absente = !sets.length && !slugsViaLignes.length;
        const nomAffiche = (setsEff[0]?.nomAffichage) || null;
        lignesSet.push({ idExpansion, codeSet, nom: nomAffiche, sets: setsEff.map(s => s?._id).filter(Boolean), setsParIdExpansion: sets.length, setsViaLignesSeulement: sets.length ? 0 : slugsViaLignes.length,
            langue, langueSource, famille: tirages.length === 1 ? TIRAGE_FAMILLE[tirages[0]] ?? 'inconnue' : (REGION_CODES[regionCode] ? TIRAGE_FAMILLE[REGION_CODES[regionCode]] : 'inconnue'),
            type: setsEff.map(s => s?.type).find(Boolean) ?? null, tamponnee: setsEff.some(s => s?.reimpressions) ? setsEff.find(s => s?.reimpressions).reimpressions : null,
            produits: ps.length, sansLigne, avecFiche: fiche, ficheDouteuse: ps.filter(p => p.fiche.classe === 'FICHE_DOUTEUSE').length, ligneSansFiche: ps.filter(p => p.fiche.classe === 'LIGNE_SANS_FICHE').length,
            absente, incomplete: !absente && sansLigne > 0, partSansLigne: ps.length ? sansLigne / ps.length : 0 });
    }
    const expTotales = new Set(catalogue.map(p => p.idExpansion));
    const exSeulementCartesCode = [...expTotales].filter(id => !parExp.has(id));
    return { lignesSet, expansionsExport: expTotales.size, expansionsHorsCartesCode: parExp.size, exSeulementCartesCode, produitsHorsPerimetre: horsPerimetre.length };
}

module.exports = { chargerDonnees, rejouerApi, assembler, mesurerSets, controlerTemoin, motifManquant, tirageDe, TIRAGE_FAMILLE, ouvrirLecture, chargerApi };
