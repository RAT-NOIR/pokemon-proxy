// ============================================================
// BS-STAFF (2026-10-17) — « TAMPON NON SÉPARABLE » : l'image servie aux deux produits V1 / V2 d'une promo Black Star ne montre pas leur tampon
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « Image partagée gardée, paire marquée « tampon non séparable » (même champ que les Prize Packs, l'API pose toujours une question ou donne les deux prix).
// CONDITION : le site affiche la mention « tampon non représenté » sur les deux produits de la paire. »
// Chez Cardmarket, une promo Black Star existe en deux produits (V1, V2) : l'un est la carte ordinaire, l'autre porte un tampon (« Staff », ou le logo Play! Pokémon d'un Prize Pack). Les deux produits sont servis par
// la MÊME fiche et la MÊME image, sans tampon : Pokumon publie bien les deux scans, mais rien ne dit lequel des deux produits est le tamponné (V1 / V2 ne se lisent pas sur une image). L'API doit donc
// poser une question, ou donner les deux prix ; le site écrit la mention. Ce module PROUVE chaque paire, puis écrit trois champs, et seulement eux :
//   · `produitsPartages: [V1, V2]` — le MÊME champ que les Prize Packs ;   · `partageeTamponNonSepare: true` — propre au tampon (la mention ne vaut que sur ces paires, « holo » y serait faux) ;
//   · `tamponNonRepresente: 'Staff' | 'Play! Pokémon'` — le libellé de la mention.
// Sur l'entrée `cartes.images` SERVIE (set de la paire, numéro de la fiche) ET sur le document `images` correspondant — sauf si ce document sert aussi une entrée d'un AUTRE set ou d'une autre carte
// (même cleR2) : alors l'entrée seule, et le cas se compte. `partageeHoloNonHolo` n'est jamais posé ici, et une entrée qui le porte déjà n'est jamais écrasée.
//
// ÉCRIT PAR CE QU'IL AUTORISE : une paire n'est marquée que si TOUT ceci est prouvé, par du code, sur l'état réel ; le reste est un refus NOMMÉ (jamais un silence).
const P = require('./pokumon');

const CHAMPS = Object.freeze(['produitsPartages', 'partageeTamponNonSepare', 'tamponNonRepresente']);
// LA LISTE FERMÉE des mots de tampon (testeur / coordinateur) : le mot est en TÊTE du titre Pokumon, avec un seul espace, et rien d'autre ne diffère. Un autre mot (Prerelease, Reverse Holo, Cosmos…) n'est pas ici.
const TAMPONS = Object.freeze({ 'Staff': 'Staff', 'Holofoil Play Pokemon': 'Play! Pokémon' });
const MOT = /^(Staff|Holofoil Play Pokemon) (.+)$/;

const evenements = e => [...(e?.evenements || [])].sort((a, b) => a - b).join();

/**
 * Le COUPLE d'entrées Pokumon d'une paire : exactement deux, l'une portant UN mot de la liste fermée en tête de son titre, l'autre étant le même titre SANS ce mot, au caractère près
 * (donc même nom, même numéro, même texte de set). Les événements : « Staff » exige les mêmes événements ; « Play! » exige que l'événement du tampon soit un Prize Pack Play! Pokémon (c'est le tampon lui-même).
 * @returns {{tampon: string, mot: string, entreeTamponnee: object, entreeSimple: object} | {motif: string}}
 */
function coupleTampon(entrees) {
    if (!Array.isArray(entrees) || entrees.length !== 2) return { motif: 'pokumon-groupe-pas-deux-entrees' };
    const lus = entrees.map(e => { const m = MOT.exec(String(e?.titre ?? '')); return { e, mot: m ? m[1] : null, reste: m ? m[2] : String(e?.titre ?? '') }; });
    const tamponnees = lus.filter(x => x.mot);
    if (tamponnees.length !== 1) return { motif: tamponnees.length ? 'pokumon-deux-entrees-tamponnees' : 'pokumon-sans-mot-de-tampon-de-la-liste' };
    const [t] = tamponnees, s = lus.find(x => x !== t);
    if (MOT.test(t.reste)) return { motif: 'pokumon-mot-de-tampon-double' };
    if (s.e.titre !== t.reste) return { motif: 'pokumon-titres-differents-hors-du-mot' };
    if (t.e.numero !== s.e.numero || t.e.total !== s.e.total || t.e.set !== s.e.set) return { motif: 'pokumon-numero-ou-set-differents' };
    if (!t.e.anglais || !s.e.anglais) return { motif: 'pokumon-langue' };
    if (t.mot === 'Staff') {
        if (t.e.holo || s.e.holo) return { motif: 'pokumon-brillant-different' };
        if (!t.e.evenements?.length || evenements(t.e) !== evenements(s.e)) return { motif: 'pokumon-evenements-differents' };
    } else if (t.mot === 'Holofoil Play Pokemon') {
        if (!t.e.holo || s.e.holo) return { motif: 'pokumon-brillant-different' };
        const pp = Object.values(P.EVENEMENTS);
        if (!t.e.evenements?.length || !t.e.evenements.every(x => pp.includes(x))) return { motif: 'pokumon-evenement-du-tampon-hors-prize-pack' };
    } else return { motif: 'pokumon-mot-hors-liste' };   // deuxième garde : la table TAMPONS, en plus de l'expression qui lit le titre
    return { tampon: TAMPONS[t.mot], mot: t.mot, entreeTamponnee: t.e, entreeSimple: s.e };
}

/** Le rang V d'un produit (V1 = 1) : sa `variante`, à défaut le jeton V<n> du slug (un seul), à défaut 1 (Cardmarket n'écrit pas V1) ; deux jetons ou une forme inconnue : null. */
function rangV(p) {
    const v = /^V(\d+)$/.exec(String(p?.variante ?? ''));
    if (v) return Number(v[1]);
    const jetons = [...String(p?.slugProduit ?? '').matchAll(/(?:^|-)V(\d+)(?=-|$)/g)];
    return jetons.length === 0 ? 1 : jetons.length === 1 ? Number(jetons[0][1]) : null;
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const memes = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Les produits des sets, avec la fiche que le SITE leur donne et l'entrée d'image qu'il sert (règle du site IMPORTÉE : `regle` = exporter-donnees-logos-site.regleDuSite, `site` = pokumon.chargerRegleDuSite). */
async function lireMonde({ cartesDb, prodDb, regle, site, slugs }) {
    const X = require('../exporter-donnees-logos-site');
    const sets = await cartesDb.collection('sets').find({ _id: { $in: slugs } }).toArray();
    const nc = await prodDb.collection('numeros_cartes').find({ slugSet: { $in: slugs } }, { projection: { idProduct: 1, slug: 1, slugSet: 1, numero: 1, variante: 1 } }).toArray();
    const cat = await prodDb.collection('catalogue_produits').find({ idProduct: { $in: nc.map(x => x.idProduct) } }, { projection: { idProduct: 1, name: 1, dateAdded: 1 } }).toArray();
    const catP = new Map(cat.map(c => [c.idProduct, c])), ncp = new Map(nc.map(x => [x.idProduct, x]));
    const produits = [];
    for (const s of sets) {
        const exps = [].concat(s.idExpansion ?? []);
        const parSlug = await cartesDb.collection('cartes_produits').find({ slugSet: s._id }, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1, slug: 1, slugSet: 1, variante: 1 } }).toArray();
        const parExp = exps.length ? await cartesDb.collection('cartes_produits').find({ idExpansion: { $in: exps } }, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1, slug: 1, slugSet: 1, variante: 1 } }).toArray() : [];
        const lignes = [...new Map([...parSlug, ...parExp].map(l => [l._id ?? `${l.carteId}|${l.idProduct}`, l])).values()];
        const docs = (await cartesDb.collection('cartes').find({ sets: s._id }, { projection: { impressions: 1, images: 1, nomEn: 1, sets: 1 } }).toArray()).filter(d => typeof d.nomEn === 'string' && d.nomEn);
        const ids = new Set(docs.map(d => d._id));
        const lig = lignes.filter(x => ids.has(x.carteId) && exps.includes(x.idExpansion));
        const { fiche: ficheDe } = X.fichesDesProduits(regle, s, docs, lig);
        const parDoc = new Map(docs.map(d => [d._id, d]));
        const tir = s.tirage ?? s.region, vus = new Set();
        for (const x of lig) {
            if (vus.has(x.idProduct)) continue; vus.add(x.idProduct);
            const n = ncp.get(x.idProduct); if (!n || n.slugSet !== s._id) continue;
            const f = ficheDe.get(x.idProduct), d = parDoc.get(x.carteId), c = catP.get(x.idProduct);
            let propre = null;
            if (f) { const imgs = (d.images || []).filter(m => m && m.set === s._id && m.cleR2).filter(m => site.visuelAdmisPourLaRegion(m, tir)); propre = site.imageDeLImpression(imgs, f.numero ?? null); }
            produits.push({ idProduct: x.idProduct, carteId: x.carteId, slugSet: s._id, nomCm: c?.name ?? null, slugProduit: n.slug, numero: n.numero ?? null, variante: n.variante ?? null, varianteLigne: x.variante ?? null, dateAdded: c?.dateAdded ?? null,
                fiche: f ? { carteId: f.carteId, numero: f.numero ?? null } : null, propre, carte: d });
        }
    }
    return { sets, produits };
}

/**
 * LE PLAN : chaque groupe d'au moins deux produits d'une promo Black Star (SWSH, SVP, MEP) est PROUVÉ comme paire à tampon, ou REFUSÉ avec son motif. Rien n'est écrit.
 * @returns {{paires: object[], refus: object[], comptes: object}}
 */
async function construirePlan({ cartesDb, prodDb, regle, site, index, lignes = P.LIGNES_AUTRES }) {
    const bsp = lignes.filter(l => l.famille === 'bsp');
    const slugs = [...new Set(bsp.flatMap(l => l.slugs))];
    const { produits } = await lireMonde({ cartesDb, prodDb, regle, site, slugs });
    const ligneDe = slug => bsp.find(l => l.slugs.includes(slug));
    const groupes = new Map();
    for (const p of produits) {
        const l = ligneDe(p.slugSet); const nm = l ? P.REGLES.bsp.produit(p, l) : null;
        if (!nm || !p.nomCm) continue;
        const k = [p.slugSet, p.carteId, nm.n, norm(p.nomCm.replace(/\s*\[.*$/, ''))].join('|');
        (groupes.get(k) || groupes.set(k, []).get(k)).push({ p, l, nm });
    }
    const paires = [], refus = [], candidates = [];
    for (const g of groupes.values()) {
        if (g.length < 2) continue;
        const { p: p0, l, nm } = g[0];
        const base = { set: p0.slugSet, carteId: p0.carteId, numero: p0.numero, nom: p0.nomCm, produits: g.map(x => x.p.idProduct).sort((a, b) => a - b) };
        const non = motif => refus.push({ ...base, motif });
        if (g.length !== 2) { non('produits-pas-deux'); continue; }
        const [a, b] = g.map(x => x.p);
        if (a.nomCm !== b.nomCm) { non('noms-differents'); continue; }
        const [ra, rb] = [rangV(a), rangV(b)];
        if (ra == null || rb == null || ra === rb || Math.min(ra, rb) !== 1) { non('produits-pas-v1-v2'); continue; }
        const [v1, v2] = ra < rb ? [a, b] : [b, a];
        if (!v1.dateAdded || !v2.dateAdded || !(new Date(v1.dateAdded) < new Date(v2.dateAdded))) { non('v1-pas-le-plus-ancien'); continue; }
        const nomP = norm(p0.nomCm.replace(/\s*\[.*$/, ''));
        const entrees = index.filter(e => e.numero && P.cleMesure(e.numero) === nm.n && P.nomPokumon(e) === nomP && P.REGLES.bsp.entree(e, l));
        const couple = coupleTampon(entrees);
        if (couple.motif) { non(couple.motif); continue; }
        if (!a.fiche || !b.fiche || a.fiche.carteId !== b.fiche.carteId || a.fiche.carteId !== a.carteId || a.fiche.numero !== b.fiche.numero) { non('fiche-differente'); continue; }
        // la fiche porte LE numéro du produit : une fiche sans numéro (le site la sert quand même) ne prouve pas que ces deux produits sont cette carte-là
        if (a.fiche.numero == null || P.cleMesure(a.fiche.numero) !== nm.n) { non('fiche-sans-le-numero-du-produit'); continue; }
        const servis = produits.filter(x => x.slugSet === a.slugSet && x.fiche && x.fiche.carteId === a.fiche.carteId && x.fiche.numero === a.fiche.numero).map(x => x.idProduct).sort((x, y) => x - y);
        if (!memes(servis, base.produits)) { non('fiche-sert-d-autres-produits'); continue; }
        if (!a.propre || !b.propre) { non('sans-image-servie'); continue; }
        if (a.propre !== b.propre && !(a.propre.set === b.propre.set && a.propre.cleR2 === b.propre.cleR2)) { non('image-servie-differente'); continue; }
        const e = a.propre, memeCle = (a.carte.images || []).filter(x => x && x.set === e.set && x.cleR2 === e.cleR2);
        if (memeCle.length !== 1) { non('entree-ambigue'); continue; }
        if (e.partageeHoloNonHolo === true) { non('deja-partagee-holo'); continue; }
        // 🔑 MARQUE DE CONSERVATION (18/10, PARTAGES-SEPARES) : une paire SÉPARÉE par la variante (lignes `variante` staff|jumbo + normale, entrée `partageeTamponNonSepare: false`) n'est plus « non séparable ».
        // Le lot retire `produitsPartages` de ces entrées : sans cette garde, ce marquage les y remettrait avec `partageeTamponNonSepare: true`. Écrite par ce qu'elle refuse ICI parce que le marquage ne
        // pose que la valeur `true` : toute trace de séparation (ligne ou entrée) l'arrête.
        if (a.varianteLigne || b.varianteLigne) { non('variante-deja-posee'); continue; }
        if (e.partageeTamponNonSepare === false) { non('deja-separee-par-la-variante'); continue; }
        if (e.produitsPartages !== undefined && e.partageeTamponNonSepare !== true) { non('produitsPartages-deja-pose-hors-tampon'); continue; }
        const produitsPartages = [v1.idProduct, v2.idProduct];
        candidates.push({ ...base, produits: produitsPartages, numero: a.fiche.numero, tampon: couple.tampon, mot: couple.mot, entree: { set: e.set, cleR2: e.cleR2, numero: e.numero ?? null },
            pokumon: { simple: couple.entreeSimple.id, tamponnee: couple.entreeTamponnee.id },
            entreeDeja: e.partageeTamponNonSepare === true && e.tamponNonRepresente === couple.tampon && memes(e.produitsPartages, produitsPartages) });
    }
    // les documents `images` : ceux qui servent UNE seule entrée (la nôtre) sont marqués ; les autres ne le sont pas (et le cas se compte)
    const cles = [...new Set(candidates.map(c => c.entree.cleR2))];
    const docs = cles.length ? await cartesDb.collection('images').find({ cleR2: { $in: cles } }).toArray() : [];
    const portees = cles.length ? await cartesDb.collection('cartes').find({ 'images.cleR2': { $in: cles } }, { projection: { images: 1 } }).toArray() : [];
    let documentsPartages = 0, documentsAbsents = 0;
    for (const c of candidates) {
        const memeCle = docs.filter(d => d.cleR2 === c.entree.cleR2);
        const autres = portees.flatMap(x => (x.images || []).filter(m => m && m.cleR2 === c.entree.cleR2).map(m => ({ carteId: x._id, set: m.set }))).filter(m => !(m.carteId === c.carteId && m.set === c.entree.set));
        let doc = null, docMotif = null, docDeja = false;
        if (!memeCle.length) { docMotif = 'document-absent'; documentsAbsents++; }
        else if (memeCle.length > 1 || autres.length || memeCle[0].set !== c.entree.set || memeCle[0].carteId !== c.carteId) { docMotif = 'document-partage'; documentsPartages++; }
        else {
            doc = { _id: memeCle[0]._id };
            docDeja = memeCle[0].partageeTamponNonSepare === true && memeCle[0].tamponNonRepresente === c.tampon && memes(memeCle[0].produitsPartages, c.produits);
        }
        paires.push({ ...c, doc, docMotif, docDeja });
    }
    paires.sort((x, y) => x.set.localeCompare(y.set) || String(x.numero).localeCompare(String(y.numero)) || x.carteId - y.carteId);
    const parMotif = {};
    for (const r of refus) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { paires, refus, comptes: { groupes: [...groupes.values()].filter(g => g.length >= 2).length, produits: produits.length, paires: paires.length, refus: refus.length, parMotif,
        entreesDeja: paires.filter(p => p.entreeDeja).length, documentsDeja: paires.filter(p => p.doc && p.docDeja).length, documentsPartages, documentsAbsents } };
}

const verifierAttendu = (attendu, n, quoi) => {
    if (attendu !== undefined && attendu !== null && attendu !== n) throw new Error(`--attendu=${attendu} mais ${n} ${quoi} : rien n'est écrit`);
};

/** Pose les trois champs. `ecrire: false` (défaut) : la simulation rend les comptes. `attendu` est OBLIGATOIRE à l'écriture et refuse AVANT toute écriture. Idempotent : ce qui est déjà posé n'est pas réécrit. */
async function appliquer(cartesDb, plan, { ecrire = false, attendu } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre de paires prouvées que l\'éditeur a lu à la simulation) : rien n\'est écrit');
    verifierAttendu(attendu, plan.paires.length, 'paire(s) prouvée(s)');
    const aEcrire = plan.paires.filter(p => !p.entreeDeja), docs = plan.paires.filter(p => p.doc && !p.docDeja);
    const r = { paires: plan.paires.length, entrees: aEcrire.length, documents: docs.length, documentsPartages: plan.paires.filter(p => p.docMotif === 'document-partage').length, dejaFait: !aEcrire.length && !docs.length };
    if (!ecrire) return r;
    const valeurs = p => ({ produitsPartages: p.produits, partageeTamponNonSepare: true, tamponNonRepresente: p.tampon });
    for (const p of aEcrire) {
        const res = await cartesDb.collection('cartes').updateOne({ _id: p.carteId },
            { $set: { 'images.$[e].produitsPartages': p.produits, 'images.$[e].partageeTamponNonSepare': true, 'images.$[e].tamponNonRepresente': p.tampon } },
            { arrayFilters: [{ 'e.set': p.entree.set, 'e.cleR2': p.entree.cleR2 }] });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`entrée introuvable ou inchangée : carte ${p.carteId}, ${p.entree.set}, ${p.entree.cleR2} — arrêt (rejouer : idempotent)`);
    }
    for (const p of docs) {
        const res = await cartesDb.collection('images').updateOne({ _id: p.doc._id }, { $set: valeurs(p) });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`document images introuvable ou inchangé : ${p.doc._id} — arrêt (rejouer : idempotent)`);
    }
    return r;
}

/** Retire ces trois champs, et seulement eux, des entrées et des documents qui portent `partageeTamponNonSepare: true` — jamais le `produitsPartages` d'un Prize Pack. */
async function retirer(cartesDb, { ecrire = false, attendu } = {}) {
    const cartes = await cartesDb.collection('cartes').find({ 'images.partageeTamponNonSepare': true }, { projection: { images: 1 } }).toArray();
    const docs = await cartesDb.collection('images').find({ partageeTamponNonSepare: true }, { projection: { _id: 1 } }).toArray();
    const nEntrees = cartes.reduce((n, c) => n + (c.images || []).filter(e => e && e.partageeTamponNonSepare === true).length, 0);
    verifierAttendu(attendu, nEntrees, 'entrée(s) marquée(s)');
    const r = { entrees: nEntrees, documents: docs.length, dejaFait: !nEntrees && !docs.length };
    if (!ecrire) return r;
    const retrait = pre => Object.fromEntries(CHAMPS.map(c => [`${pre}${c}`, '']));
    for (const c of cartes) await cartesDb.collection('cartes').updateOne({ _id: c._id }, { $unset: retrait('images.$[e].') }, { arrayFilters: [{ 'e.partageeTamponNonSepare': true }] });
    for (const d of docs) await cartesDb.collection('images').updateOne({ _id: d._id }, { $unset: retrait('') });
    return r;
}

/** L'index Pokumon des familles, DEPUIS LE CACHE (jamais le réseau) : plus de 12 h, ou vide, on s'arrête. */
function lireIndexFamilles(chemin, { maintenant = Date.now(), ageMaxH = 12 } = {}) {
    const v = JSON.parse(require('fs').readFileSync(chemin, 'utf8'));
    const age = (maintenant - Date.parse(v.le)) / 3600000;
    if (!Number.isFinite(age)) throw new Error(`index ${chemin} : date illisible`);
    if (age > ageMaxH) throw new Error(`index Pokumon daté du ${v.le} (${age.toFixed(1)} h) : plus de ${ageMaxH} h — arrêt. Cet outil ne fait aucune requête réseau ; l'index se rafraîchit par la collecte, pas ici.`);
    if (!Array.isArray(v.entrees) || !v.entrees.length) throw new Error(`index ${chemin} : aucune entrée — un index vide ne prouve rien`);
    return v;
}

module.exports = { CHAMPS, TAMPONS, coupleTampon, rangV, lireMonde, construirePlan, appliquer, retirer, lireIndexFamilles };
