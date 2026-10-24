// ============================================================
// LA GARDE DE LOT VÉRIFIE LE CONTRAT DE L'API (décision du testeur, 2026-10-19)
// ============================================================
// L'occurrence : un lot a posé sur l'image partagée de Frosmoth (carte 245005, set Sword-Shield n°064) un `tamponNonRepresente`
// de 78 caractères. La garde de lot compare des COMPTES par groupe, aucun compte n'a bougé, le lot est passé. L'API refuse ce champ
// au-delà de 40 caractères (visuels.js : TAMPON_MAX) : elle a refusé 5 entrées à la construction de son archive, 5 produits ont perdu
// leur visuel. « Un champ hors limite bloque l'écriture au lieu de faire perdre un visuel. »
//
// 🔑 ON NE RECOPIE AUCUNE LIMITE (§21 bis, et le motif dominant : la sonde lit la même chose que la production). Cette garde IMPORTE la
// chaîne de l'API — ses PROJECTIONS, sa `decider` (la décision du chargeur), la règle du site qu'elle embarque, sa `lireEntree` — et la
// REJOUE sur les sets que le lot a touchés, avant (la sauvegarde) et après (la base). Si une limite de l'API change demain, c'est son
// code qui bouge, et cette garde le suit sans qu'on la retouche.
//
// 🔑 ÉCRITE PAR CE QU'ELLE AUTORISE : tout ce qui empêche de conclure (API introuvable, règle absente, exception, collection vide) LÈVE
// « garde contrat API : je ne peux pas conclure (…) » — jamais un « tout va bien ».
//
// 🔑 COÛT, MESURÉ (2026-10-19, par le coordinateur, sur des SAUVEGARDES RÉELLES de la base `cartes`) : le verdict se rend en 2,1 s ; le tas monte à ≈ 1 073 Mo avec trois états chargés (la sauvegarde entière,
// l'état « après » relu pour les compteurs, et l'état « après » relu une seconde fois avec les projections de l'API). Le lot ne tourne pas sur Render (512 Mo) mais en local.
// D3.5 (2026-10-24) : la troisième copie était inutile — l'état « après » est maintenant lu UNE seule fois, avec les projections RÉUNIES du site et de l'API (`unionProjections`), et la vue de l'API en est
// dérivée par `projeter` ; l'état « avant » n'est plus gardé en double (la sauvegarde est projetée à chaque verdict, puis relâchée). Les chiffres ci-dessus sont ceux d'AVANT ce retrait.
// Simulation du 2026-10-24 sur la sauvegarde réelle du 2026-10-19 (tas JS, « après » simulé par un nouveau parse puis la projection : ce n'est pas une lecture de la base) : ancien câblage 491 Mo, nouveau 297 Mo ;
// verdict sans changement 1,7 s. À remesurer sur un vrai lot.
// D3.2 (même jour) : la fermeture des sets rejoués s'est élargie. Mesure sur la même sauvegarde, pour un seul set touché : toujours UN set rejoué en entier (ses lignes : 90 à 414), plus 210 à 490 sets en documents seulement
// (les sets des images de ses cartes : leurs lignes ne sont pas jugées) ; verdict de 130 à 250 ms. Rejouer AUSSI les lignes de ces sets portait la fermeture à 200-500 sets et 38 000 lignes : refusé.
//
// ⚠️ metacarte : `decider` exige un catalogue non vide (« catalogue_produits vide : base fausse »). On ne lit pas la production : la Map
// porte UN seul couple sentinelle (idProduct -1), identique avant et après, qui ne correspond à aucune ligne : `idMetacard` vaut alors
// `null` pour tous les produits, ce que `lireEntree` admet. Le contrat testé ne dépend pas de la métacarte.
const fs = require('fs');
const path = require('path');

const DOSSIER_API_PAR_DEFAUT = 'C:/Users/Yung/Desktop/pokemon-proxy-api-v2';
const METACARTE_SENTINELLE = () => new Map([[-1, 1]]);
const refus = (raison) => new Error(`garde contrat API : je ne peux pas conclure (${String(raison).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 300)})`);

/** Charge la chaîne de l'API. Rend { dossier, PROJECTIONS, decider, lireEntree, estVariante, normaliserVariante, creerConstructeur, regle, compacterSet, compacterCarte, compacterLigne, interneur }. LÈVE si quoi que ce soit manque. */
async function chargerApi({ dossier } = {}) {
    const dir = path.resolve(dossier || process.env.API_V2_DIR || DOSSIER_API_PAR_DEFAUT);
    try {
        for (const f of ['v2/chargeur/source.js', 'v2/chargeur/decision.js', 'v2/chargeur/version.js', 'v2/chargeur/regle-site/index.js', 'v2/identifier/visuels.js', 'v2/identifier/marques-tampon.js'])
            if (!fs.existsSync(path.join(dir, f))) throw new Error(`${f} introuvable dans le dossier de l'API`);
        const R = f => require(path.join(dir, f));
        const source = R('v2/chargeur/source.js'), decision = R('v2/chargeur/decision.js'), site = R('v2/chargeur/regle-site/index.js');
        const visuels = R('v2/identifier/visuels.js'), marques = R('v2/identifier/marques-tampon.js'), version = R('v2/chargeur/version.js');
        R('exporter-donnees-logos-site.js');                      // decider le charge à l'appel (L()) : qu'il manque, et on ne conclut pas, avant le lot
        const regle = await site.regleEmbarquee();
        decision.verifierRegle(regle);
        // `normaliserVariante` : ce que decider fait de la variante d'une ligne (decision.js : varianteProuvee, varianteHorsListe) ; `creerConstructeur` : le constructeur de l'archive, dont la règle des produits
        // « contradictoires » (version.js) est appliquée telle quelle, jamais recopiée.
        const api = { dossier: dir, PROJECTIONS: source.PROJECTIONS, decider: decision.decider, lireEntree: visuels.lireEntree, estVariante: marques.estVariante, normaliserVariante: marques.normaliserVariante, creerConstructeur: version.creerConstructeur, regle,
            compacterSet: source.compacterSet, compacterCarte: source.compacterCarte, compacterLigne: source.compacterLigne, interneur: source.interneur };
        for (const k of ['decider', 'lireEntree', 'estVariante', 'normaliserVariante', 'creerConstructeur', 'compacterSet', 'compacterCarte', 'compacterLigne', 'interneur']) if (typeof api[k] !== 'function') throw new Error(`${k} absent de l'API`);
        for (const k of ['sets', 'cartes', 'cartes_produits']) if (!api.PROJECTIONS?.[k] || !Object.keys(api.PROJECTIONS[k]).length) throw new Error(`PROJECTIONS.${k} absente de l'API`);
        // (tour de correction 1, point 5) La lecture UNIQUE de l'état « après » (lot-additif.js) réunit les projections du site/des compteurs et celles de l'API. Elle est calculée ICI, au chargement, c'est-à-dire AVANT la
        // sauvegarde : une projection que l'on ne sait pas réunir (exclusion, forme illisible) refuse le lot (code 6) au lieu de lever après l'écriture, sans restauration.
        const L = require('./garde-lot');
        api.projectionsEtat = Object.freeze({ cartes: unionProjections(L.PROJECTION_ETAT.cartes, api.PROJECTIONS.cartes), cartesProduits: unionProjections(L.PROJECTION_ETAT.cartesProduits, api.PROJECTIONS.cartes_produits) });
        return api;
    } catch (e) { throw /^garde contrat API/.test(e.message) ? e : refus(e.message); }
}

// ── LA PROJECTION : la même que celle de l'API (Mongo : un sous-document est projeté champ par champ, un élément de tableau qui n'est pas un document est écarté).
const estDoc = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !v._bsontype;
function arbre(projection) {
    const racine = {};
    for (const chemin of Object.keys(projection)) {
        let n = racine; const parts = chemin.split('.');
        parts.forEach((p, i) => { if (i === parts.length - 1) n[p] = 1; else n = (n[p] && n[p] !== 1) ? n[p] : (n[p] = {}); });
    }
    return racine;
}
function projeterValeur(v, t) {
    if (t === 1) return v;
    if (Array.isArray(v)) return v.filter(estDoc).map(x => projeterValeur(x, t));
    if (!estDoc(v)) return undefined;
    const out = {};
    for (const k of Object.keys(t)) { if (v[k] === undefined) continue; const x = projeterValeur(v[k], t[k]); if (x !== undefined) out[k] = x; }
    return out;
}
/** Les documents de la sauvegarde, projetés comme l'API les lit : avant et après se comparent à forme égale. Idempotente. */
function projeter(docs, projection) {
    const t = arbre(projection);
    return docs.map(d => ({ _id: d._id, ...projeterValeur(d, t) }));
}
/**
 * D3.5 — La RÉUNION de projections d'inclusion : une seule lecture de la base qui sert à la fois les compteurs/sets touchés (garde-lot.js : PROJECTION_ETAT) et le contrat de l'API (ses PROJECTIONS). Mongo refuse
 * un chemin et son parent ensemble (« a » et « a.b » : collision) : un chemin couvert par un ancêtre présent est retiré (l'ancêtre le contient). Une exclusion (0) ne se réunit pas : elle LÈVE.
 */
function unionProjections(...projections) {
    const chemins = new Set();
    for (const p of projections) for (const [k, v] of Object.entries(p)) {
        if (v !== 1) throw refus(`projection : « ${k}: ${JSON.stringify(v)} » — seules les inclusions (1) se réunissent`);
        chemins.add(k);
    }
    const couvert = k => { const parts = k.split('.'); for (let i = 1; i < parts.length; i++) if (chemins.has(parts.slice(0, i).join('.'))) return true; return false; };
    return Object.fromEntries([...chemins].filter(k => !couvert(k)).sort().map(k => [k, 1]));
}
function projeterEtat(api, { sets, cartes, cartesProduits }) {
    return { sets: projeter(sets, api.PROJECTIONS.sets), cartes: projeter(cartes, api.PROJECTIONS.cartes), cartesProduits: projeter(cartesProduits, api.PROJECTIONS.cartes_produits) };
}

// ── L'ÉGALITÉ PROFONDE STABLE (l'ordre des clés ne compte pas ; undefined = absent)
function canon(v) {
    if (v === undefined || v === null) return 'null';
    if (v instanceof Date) return `d:${v.getTime()}`;
    if (typeof v === 'object' && typeof v._bsontype === 'string') return `b:${v._bsontype}:${typeof v.toHexString === 'function' ? v.toHexString() : String(v)}`;
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
}
const cle = d => canon(d._id);

/**
 * Les slugs des sets que le lot a touchés, comparés sur les documents PROJETÉS (pas sur des compteurs) :
 *  · une carte changée, ajoutée ou retirée → tous ses sets (avant ∪ après) et les sets de ses entrées `images` ;
 *  · une ligne cartes_produits changée → son slugSet (avant ∪ après), et les sets de son idExpansion (decider joint la ligne à un set par l'un ou par l'autre) ;
 *  · (tour de correction 1) toute ligne d'une carte CHANGÉE, changée ou non → ses sets de la même façon, quel que soit `cartes.sets` ;
 *  · un document `sets` changé → son _id.
 * ⚠️ Ne s'appuie PAS sur `setsTouches` de garde-lot.js : celle-ci ne voit pas un changement de champ dans une entrée existante (lot du 2026-10-19 : « aucun set touché »).
 */
function setsTouchesContrat({ avant, apres }) {
    for (const [lib, e] of [['avant', avant], ['après', apres]]) for (const k of ['sets', 'cartes', 'cartesProduits'])
        if (!Array.isArray(e?.[k]) || !e[k].length) throw refus(`la collection « ${k} » est vide ou absente dans l'état « ${lib} » : une comparaison sur du vide ne mesure rien`);
    const touches = new Set();
    const exps = s => [].concat(s.idExpansion ?? []);
    const parExp = new Map();
    for (const s of [...avant.sets, ...apres.sets]) for (const x of exps(s)) { if (!parExp.has(x)) parExp.set(x, new Set()); parExp.get(x).add(s._id); }
    const comparer = (nom, fournir) => {
        const A = new Map(avant[nom].map(d => [cle(d), d])), B = new Map(apres[nom].map(d => [cle(d), d]));
        for (const k of new Set([...A.keys(), ...B.keys()])) {
            const a = A.get(k), b = B.get(k);
            if (a && b && canon(a) === canon(b)) continue;
            for (const d of [a, b]) if (d) fournir(d);
        }
    };
    const cartesChangees = new Set();
    comparer('cartes', d => { cartesChangees.add(cle(d)); for (const s of d.sets || []) touches.add(s); for (const m of d.images || []) if (m?.set) touches.add(m.set); });
    const setsDeLigne = l => { if (l.slugSet) touches.add(l.slugSet); for (const s of parExp.get(l.idExpansion) || []) touches.add(s); };
    comparer('cartesProduits', setsDeLigne);
    // (tour de correction 1, point 6) toute LIGNE d'une carte changée est retenue, avec son set, quel que soit `cartes.sets` : le produit d'une carte dont seule la ligne rattache la carte à un set (cartes.sets vide ou
    // incomplet) serait sinon hors de la fermeture, donc jamais jugé alors que sa fiche vient de changer
    for (const l of [...avant.cartesProduits, ...apres.cartesProduits]) if (cartesChangees.has(canon(l.carteId))) setsDeLigne(l);
    comparer('sets', s => touches.add(s._id));
    return [...touches].filter(x => typeof x === 'string').sort();
}

// ── LE CONTRAT
/**
 * (tour de correction 1, point 7) La VALEUR fautive d'un refus : un défaut est un motif ET la valeur qui le porte. Un tamponNonRepresente de 78 caractères qui devient un AUTRE texte de 78 caractères a le même
 * motif et n'est pas le même défaut : le lot l'a réécrit. Le champ se lit dans le motif de lireEntree (« champ "X" … », « vignette … », « lien hors … »…) ; un motif que cette table ne sait pas rattacher compare
 * l'entrée ENTIÈRE (fail-closed : au pire un défaut inchangé est jugé nouveau, jamais l'inverse). Rend une chaîne canonique.
 */
const CHAMPS_DU_MOTIF = Object.freeze([
    [/^champ "(\w+)"/, m => [m[1]]],
    [/^(vignette|grande)\b/, m => [m[1]]],
    [/^marquage de partage sans/, () => ['partageeHoloNonHolo', 'partageeTamponNonSepare', 'produitsPartages', 'variante']],
    [/^"produitsPartages" sans marquage/, () => ['partageeHoloNonHolo', 'partageeTamponNonSepare', 'produitsPartages']],
    [/^idMetacard\b/, () => ['idMetacard']], [/^lien hors\b/, () => ['lien']], [/^nature de visuel\b/, () => ['visuel']],
    [/^visuel de substitution sans mention/, () => ['visuel', 'mention']], [/^idProduct non entier/, () => ['idProduct']]
]);
function valeurFautive(e, motif) {
    for (const [re, champs] of CHAMPS_DU_MOTIF) {
        const m = re.exec(String(motif ?? ''));
        if (m) return canon(Object.fromEntries(champs(m).map(c => [c, e?.[c]])));
    }
    return canon(e);
}

/** Une entrée de decider → { ok, motif, variantePerdue }. `varianteLigne` : la variante de la ligne cartes_produits du produit. Une variante non nulle sur la ligne alors que l'entrée validée
 * porte `variante: null` est PERDUE EN SILENCE par l'API (hors liste fermée, ou sans preuve) : lireEntree ne la refuse pas, la garde la compte. */
function jugerEntree(api, e, varianteLigne = null) {
    const r = api.lireEntree(e);
    if (!r.ok) return { ok: false, motif: r.motif, valeur: valeurFautive(e, r.motif), variantePerdue: false, idProduct: e?.idProduct };
    const perdue = varianteLigne !== null && varianteLigne !== undefined && r.doc.variante === null;
    return { ok: true, motif: perdue ? `variante « ${varianteLigne} » perdue : hors de la liste fermée de l'API (ou sans preuve), l'entrée est servie avec variante null` : null, variantePerdue: perdue, idProduct: e.idProduct };
}

/** TOUR 1 — le contrôle PAR LIGNE, indépendant de toute entrée. Une ligne cartes_produits viole le contrat si sa `variante` n'est ni null ni absente et que decider NE SAIT PAS la lire.
 * D3.1 (2026-10-24) : « ne sait pas la lire » = EXACTEMENT ce que decision.js fait (varianteProuvee, varianteHorsListe) : `normaliserVariante(l.variante) === null`, sur la valeur BRUTE de la ligne — pas
 * de trim (decider n'en applique aucun avant de normaliser : « ' staff ' » est perdue), et la forme ancienne « staff-prerelease » est LUE « staff+prerelease » (rien n'est perdu : pas une violation).
 * L'ancien contrôle testait `estVariante` sur la valeur trimmée : il bloquait à tort la forme ancienne et laissait passer la valeur entourée d'espaces. Rend Map idProduct → la variante fautive (texte).
 * Clé : idProduct (un produit servi a UNE variante dans l'archive ; deux lignes d'un même produit, la première violation gagne). */
function violationsParLigne(api, lignes) {
    const m = new Map();
    for (const l of lignes) {
        if (l.variante === null || l.variante === undefined) continue;
        if (api.normaliserVariante(l.variante) === null && !m.has(l.idProduct)) m.set(l.idProduct, typeof l.variante === 'string' ? l.variante : JSON.stringify(l.variante));
    }
    return m;
}

/** Rejoue la décision de l'API sur les sets nommés, puis lireEntree sur chaque entrée. @returns Map idProduct → { ok, motif, variantePerdue, sets } */
async function contratDesSets({ api, sets, docs, lignes, slugs }) {
    const resultat = new Map();
    if (!slugs.length) return resultat;
    const I = api.interneur();
    const S = sets.map(s => api.compacterSet(s, I)), D = docs.map(d => api.compacterCarte(d, I)), L = lignes.map(l => api.compacterLigne(l, I));
    const exps = s => [].concat(s.idExpansion ?? []);
    const parExp = new Map(), parId = new Map(S.map(s => [s._id, s]));
    for (const s of S) for (const x of exps(s)) { if (!parExp.has(x)) parExp.set(x, []); parExp.get(x).push(s._id); }
    const candidats = l => { const u = new Set(parExp.get(l.idExpansion) || []); if (l.slugSet && parId.has(l.slugSet)) u.add(l.slugSet); return u; };
    // restriction (un tour de fermeture : les autres sets candidats d'une ligne restreinte entrent aussi, la ligne choisit entre ses candidats comme en production)
    const cible = new Set(slugs);
    const retenues = L.filter(l => [...candidats(l)].some(x => cible.has(x)));
    const setsR = new Set(cible);
    for (const l of retenues) for (const x of candidats(l)) setsR.add(x);
    // D3.2 / D3.3 (2026-10-24) — LA FERMETURE, pour que decider juge ce que la production juge. Trois choses que la restriction par les seuls sets touchés laissait dehors :
    //  · les sets des IMAGES de la carte d'un produit retenu : un set sans visuel propre se sert de l'image d'un autre set (« autre-tirage »), et choisirVisuel classe ces images par le tirage et la région de LEUR set
    //    (setsBase) — sans ces sets, le classement est celui d'un monde amputé et désigne une autre image que la production. Seul leur DOCUMENT entre (`setsEnPlus`) : leurs lignes ne sont pas jugées, elles n'ont rien
    //    changé (mesuré sur la sauvegarde du 2026-10-19 : rejouer aussi leurs lignes portait la fermeture de 1 set à 200-500 sets et de 239 à 38 000 lignes pour un seul set) ;
    //  · les cartes qui portent le FICHIER d'un substitut (la vignette d'un substitut est celle de l'entrée d'une autre carte au même fichier : vignetteDuFichier), leur set d'image et le set du substitut (documents seulement) ;
    //  · les AUTRES lignes du même produit, et leurs sets AVEC leurs lignes : un produit joint à deux cartes émet deux entrées, et deux entrées aux visuels différents le rendent « contradictoire » (version.js) ;
    //    la fiche d'un set se calcule sur toutes ses lignes, donc ce set-là entre en entier.
    const carteDe = new Map(D.map(d => [d._id, d]));
    const lignesDuProduit = new Map();
    for (const l of L) { if (!lignesDuProduit.has(l.idProduct)) lignesDuProduit.set(l.idProduct, []); lignesDuProduit.get(l.idProduct).push(l); }
    const cartesDuFichier = new Map();
    for (const d of D) for (const m of d.images || []) if (m?.cleR2) { if (!cartesDuFichier.has(m.cleR2)) cartesDuFichier.set(m.cleR2, []); cartesDuFichier.get(m.cleR2).push(d); }
    const cartesEnPlus = new Set(), setsEnPlus = new Set();
    for (const l of retenues) {
        for (const autre of lignesDuProduit.get(l.idProduct) || []) for (const x of candidats(autre)) setsR.add(x);
        for (const m of carteDe.get(l.carteId)?.images || []) if (m && typeof m.set === 'string') setsEnPlus.add(m.set);
        const f = l.visuelSubstitut?.cleR2;
        if (f) {
            if (typeof l.visuelSubstitut.set === 'string') setsEnPlus.add(l.visuelSubstitut.set);
            for (const d of cartesDuFichier.get(f) || []) { cartesEnPlus.add(d._id); for (const m of d.images || []) if (m?.cleR2 === f && typeof m.set === 'string') setsEnPlus.add(m.set); }
        }
    }
    const lignesR = L.filter(l => [...candidats(l)].some(x => setsR.has(x)));
    const cartesLignes = new Set(lignesR.map(l => l.carteId));
    const docsR = D.filter(d => cartesLignes.has(d._id) || cartesEnPlus.has(d._id) || (d.sets || []).some(x => setsR.has(x)));
    const setsRL = S.filter(s => setsR.has(s._id) || setsEnPlus.has(s._id));
    if (!setsRL.length || !docsR.length || !lignesR.length) return resultat;
    const r = await api.decider({ sets: setsRL, docs: docsR, lignes: lignesR, metacarte: METACARTE_SENTINELLE(), regle: api.regle, cederLaMain: false });
    const varianteDe = new Map(), setsDe = new Map(), cartesDe = new Map();
    for (const l of lignesR) {
        if (l.variante !== null && l.variante !== undefined && !varianteDe.has(l.idProduct)) varianteDe.set(l.idProduct, l.variante);
        if (!setsDe.has(l.idProduct)) setsDe.set(l.idProduct, new Set());
        for (const x of candidats(l)) setsDe.get(l.idProduct).add(x);
        if (!cartesDe.has(l.idProduct)) cartesDe.set(l.idProduct, new Set());
        cartesDe.get(l.idProduct).add(l.carteId);
        // (tour 2, D1) … et toute carte dont une entrée d'image est LUE pour décider ce produit : celle qui porte le fichier de son substitut (`vignetteDuFichier` de decider)
        const f = l.visuelSubstitut?.cleR2;
        if (f) for (const d of cartesDuFichier.get(f) || []) cartesDe.get(l.idProduct).add(d._id);
    }
    const cartesTriees = id => [...(cartesDe.get(id) || [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const gravite = j => (j.ok ? (j.variantePerdue ? 1 : 0) : 2);
    const entreesDe = new Map(), refusDe = new Map();
    for (const e of r.entrees) {
        const j = { ...jugerEntree(api, e, varianteDe.get(e.idProduct) ?? null), sets: [...(setsDe.get(e.idProduct) || [])].sort(), cartes: cartesTriees(e.idProduct) };
        const deja = resultat.get(e.idProduct);
        if (!deja || gravite(j) > gravite(deja)) resultat.set(e.idProduct, j);       // deux entrées pour un produit : la pire l'emporte
        if (!entreesDe.has(e.idProduct)) entreesDe.set(e.idProduct, []);
        entreesDe.get(e.idProduct).push(e);
        // (tour 2, D5) TOUS les couples (motif, valeur) refusés du produit : « la pire l'emporte » ne garde qu'une entrée, et à égalité la première — l'ordre des entrées ne doit pas décider de la persistance
        if (!j.ok) { if (!refusDe.has(e.idProduct)) refusDe.set(e.idProduct, new Map()); refusDe.get(e.idProduct).set(`${j.motif}\u0000${j.valeur}`, { motif: j.motif, valeur: j.valeur }); }
    }
    for (const [id, m] of refusDe) resultat.get(id).refus = [...m.values()];
    // D3.3a — LE PRODUIT « CONTRADICTOIRE » : deux entrées aux visuels DIFFÉRENTS perdent TOUT visuel dans l'archive (v2/chargeur/version.js, le constructeur : « un visuel absent est honnête, celui d'un autre tirage
    // ne l'est pas »), sans refus ni `disparus`. La règle n'est pas recopiée : les entrées du produit sont passées au VRAI constructeur de l'archive, qui compte ses contradictions.
    for (const [id, es] of entreesDe) {
        if (es.length < 2) continue;
        const b = api.creerConstructeur({ marquages: true });
        for (const e of es) b.entree(e);
        if (b.etat().doublonsContradictoires > 0) resultat.get(id).contradictoire = true;
    }
    // TOUR 1 : le contrôle par ligne, qui ne dépend d'aucune entrée (decider peut écarter l'entrée entière). Un produit sans entrée reçoit une ligne `sansEntree`.
    for (const [id, variante] of violationsParLigne(api, lignesR)) {
        const j = resultat.get(id);
        if (j) j.ligneHorsListe = variante;
        else resultat.set(id, { ok: true, motif: null, variantePerdue: false, ligneHorsListe: variante, sansEntree: true, idProduct: id, sets: [...(setsDe.get(id) || [])].sort(), cartes: cartesTriees(id) });
    }
    return resultat;
}

/** PURE. Compare deux Map idProduct → { ok, motif, variantePerdue }.
 *  nouveaux : refusés après sans l'être avant, ou variante perdue après sans l'être avant (BLOQUENT) ·
 *  persistants : refusés avant ET après, ou variante perdue avant ET après (ne bloquent pas, s'impriment) ·
 *  resolus : refusés avant, plus refusés après. */
const MOTIF_CONTRADICTOIRE = 'deux entrées aux visuels différents : aucun visuel n\'est servi pour ce produit (v2/chargeur/version.js)';
/** Le défaut de variante d'un produit, comme une clé : la valeur de la ligne hors liste, ou le motif de la variante perdue ; null si rien. Deux défauts « identiques » ont la même clé. */
const cleVariante = j => (!j ? null : j.ligneHorsListe !== undefined ? `ligne:${j.ligneHorsListe}` : j.variantePerdue ? `perdue:${j.motif}` : null);
function comparerContrat(avantMap, apresMap) {
    const nouveaux = [], persistants = [], resolus = [];
    for (const [id, a] of apresMap) {
        const b = avantMap.get(id);
        const refusAvant = Boolean(b) && !b.ok;
        // D3.3b : « persistant » = le MÊME défaut avant et après. Un produit refusé avant pour un motif A et après pour un motif B est NOUVEAU (le lot a fabriqué un autre défaut : le masquer derrière l'ancien
        // laisserait passer ce que le lot vient d'écrire).
        // (tour de correction 1, point 7) … et la MÊME valeur fautive : un autre texte tout aussi fautif est un défaut que le lot vient d'écrire
        // (tour 2, D5) … jugée sur l'ENSEMBLE des couples du produit : persistant ssi aucun couple d'après n'est nouveau (un refus de moins n'est pas un défaut de plus)
        const couples = j => (j.refus || [{ motif: j.motif, valeur: j.valeur }]).map(x => `${x.motif}\u0000${x.valeur}`);
        if (!a.ok) { (refusAvant && couples(a).every(x => couples(b).includes(x)) ? persistants : nouveaux).push({ idProduct: id, motif: a.motif, sets: a.sets, cartes: a.cartes }); continue; }
        if (refusAvant) resolus.push({ idProduct: id, motif: b.motif });
        // D3.3a : deux entrées aux visuels différents -> le produit perd tout visuel dans l'archive. Nouveau après le lot = bloquant ; déjà contradictoire avant = persistant.
        if (a.contradictoire === true) (Boolean(b) && b.contradictoire === true ? persistants : nouveaux).push({ idProduct: id, motif: MOTIF_CONTRADICTOIRE, sets: a.sets, cartes: a.cartes });
        // variante interdite : perdue à travers l'entrée, OU hors liste sur la ligne (TOUR 1). Un seul rang par produit, jamais deux pour la même chose ; persistante seulement si c'est la MÊME valeur (D3.3b).
        if (a.variantePerdue || a.ligneHorsListe !== undefined) {
            const motif = a.ligneHorsListe !== undefined ? `variante « ${a.ligneHorsListe} » hors de la liste de l'API (ligne cartes_produits)` : a.motif;
            const avant = cleVariante(b) !== null && cleVariante(b) === cleVariante(a);
            (avant ? persistants : nouveaux).push({ idProduct: id, motif, sets: a.sets, cartes: a.cartes });
        }
    }
    for (const [id, b] of avantMap) if (!b.ok && !apresMap.has(id)) resolus.push({ idProduct: id, motif: b.motif });
    // Information, NE BLOQUE PAS : un produit qui avait une entrée admise et n'en a plus après (decider l'écarte : marquage de partage incohérent, repli refusé…). Un retrait voulu entre ici aussi
    // (il est déjà compté par la garde des comptes, qui exige son annonce) ; c'est au lecteur de juger. On le montre pour qu'un visuel perdu ne soit jamais silencieux.
    const disparus = [];
    for (const [id, b] of avantMap) if (b.ok && !b.sansEntree && (!apresMap.has(id) || apresMap.get(id).sansEntree)) disparus.push({ idProduct: id, sets: b.sets });
    return { nouveaux: dedoublonner(nouveaux), persistants: dedoublonner(persistants), resolus, disparus };
}
/** (tour de correction 1, point 9) Un exemplaire par (idProduct, motif), dans l'ordre : un même défaut compté deux fois n'est pas deux défauts (et s'imprime une fois dans l'arrêt et au journal). */
function dedoublonner(liste) {
    const vus = new Set();
    return liste.filter(x => { const k = `${canon(x.idProduct)}|${x.motif}`; if (vus.has(k)) return false; vus.add(k); return true; });
}

/**
 * (tour 3, E1) Les produits PERDUS par une restauration : servis dans la sauvegarde (état « avant » du verdict) et sans entrée dans l'état relu. Avant l'écriture et sans arrêt, ils restent une INFORMATION (`disparus` : un retrait
 * voulu entre ici, et la garde des comptes exige alors son annonce). APRÈS une restauration, la sauvegarde est la vérité : un produit qui n'y est plus servi n'a pas été restauré. Pure : lit `v.disparus` d'un verdict.
 */
const produitsPerdus = (v) => (Array.isArray(v?.disparus) ? v.disparus.map(d => ({ idProduct: d.idProduct, sets: d.sets || [] })) : []);

/** Le verdict. @param avant,apres { sets, cartes, cartesProduits } (documents projetés ou bruts : on projette, idempotent). Toute exception est un refus de conclure. */
async function verifierContrat({ api, avant, apres }) {
    try {
        const A = projeterEtat(api, avant), B = projeterEtat(api, apres);
        const slugs = setsTouchesContrat({ avant: A, apres: B });
        const [mAvant, mApres] = [await contratDesSets({ api, sets: A.sets, docs: A.cartes, lignes: A.cartesProduits, slugs }), await contratDesSets({ api, sets: B.sets, docs: B.cartes, lignes: B.cartesProduits, slugs })];
        const c = comparerContrat(mAvant, mApres);
        // D3.4 : les sets fautifs sont TOUS les sets touchés des cartes fautives — ceux des lignes du produit (où il est candidat), mais aussi les sets de la carte et de ses images : le visuel fautif peut vivre dans un
        // AUTRE set (autre tirage, substitut). Sans lui, la restauration ne remet pas le tableau `images` de la carte, le refus reste, la relecture crie. Un set non touché n'est jamais fautif (le lot n'y a rien écrit).
        const setsDeCarte = new Map();
        for (const d of [...A.cartes, ...B.cartes]) {
            if (!setsDeCarte.has(d._id)) setsDeCarte.set(d._id, new Set());
            for (const x of d.sets || []) setsDeCarte.get(d._id).add(x);
            for (const m of d.images || []) if (m?.set) setsDeCarte.get(d._id).add(m.set);
        }
        const setsFautifs = [...new Set(c.nouveaux.flatMap(n => [...(n.sets || []), ...(n.cartes || []).flatMap(id => [...(setsDeCarte.get(id) || [])])]))].filter(s => slugs.includes(s)).sort();
        // (tour de correction 1, point 8) la restauration se fait par CARTE fautive : remettre le tableau `images` de toutes les cartes d'un set effacerait ce que le worker a posé sur les autres cartes de ce set
        const cartesFautives = [...new Set(c.nouveaux.flatMap(n => n.cartes || []))].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        return { slugs, ...c, setsFautifs, cartesFautives, entreesAvant: [...mAvant.values()].filter(x => !x.sansEntree).length, entreesApres: [...mApres.values()].filter(x => !x.sansEntree).length };
    } catch (e) { throw /^garde contrat API/.test(e.message) ? e : refus(e.stack ? `${e.message}` : e); }
}

/** La ligne imprimée et journalisée. */
const ligneContrat = (v) => `contrat API : ${v.slugs.length} set(s) rejoué(s) · refus nouveaux ${v.nouveaux.length} · persistants ${v.persistants.length} · résolus ${v.resolus.length}${v.disparus?.length ? ` · sans entrée après (information, ne bloque pas) ${v.disparus.length} : ${v.disparus.slice(0, 8).map(d => d.idProduct).join(',')}${v.disparus.length > 8 ? ',…' : ''}` : ''}`;

module.exports = { chargerApi, projeter, unionProjections, projeterEtat, setsTouchesContrat, contratDesSets, comparerContrat, dedoublonner, produitsPerdus, jugerEntree, violationsParLigne, verifierContrat, ligneContrat, canon };
