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
// ⚠️ metacarte : `decider` exige un catalogue non vide (« catalogue_produits vide : base fausse »). On ne lit pas la production : la Map
// porte UN seul couple sentinelle (idProduct -1), identique avant et après, qui ne correspond à aucune ligne : `idMetacard` vaut alors
// `null` pour tous les produits, ce que `lireEntree` admet. Le contrat testé ne dépend pas de la métacarte.
const fs = require('fs');
const path = require('path');

const DOSSIER_API_PAR_DEFAUT = 'C:/Users/Yung/Desktop/pokemon-proxy-api-v2';
const METACARTE_SENTINELLE = () => new Map([[-1, 1]]);
const refus = (raison) => new Error(`garde contrat API : je ne peux pas conclure (${String(raison).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 300)})`);

/** Charge la chaîne de l'API. Rend { dossier, PROJECTIONS, decider, lireEntree, estVariante, regle, compacterSet, compacterCarte, compacterLigne, interneur }. LÈVE si quoi que ce soit manque. */
async function chargerApi({ dossier } = {}) {
    const dir = path.resolve(dossier || process.env.API_V2_DIR || DOSSIER_API_PAR_DEFAUT);
    try {
        for (const f of ['v2/chargeur/source.js', 'v2/chargeur/decision.js', 'v2/chargeur/regle-site/index.js', 'v2/identifier/visuels.js', 'v2/identifier/marques-tampon.js'])
            if (!fs.existsSync(path.join(dir, f))) throw new Error(`${f} introuvable dans le dossier de l'API`);
        const R = f => require(path.join(dir, f));
        const source = R('v2/chargeur/source.js'), decision = R('v2/chargeur/decision.js'), site = R('v2/chargeur/regle-site/index.js');
        const visuels = R('v2/identifier/visuels.js'), marques = R('v2/identifier/marques-tampon.js');
        R('exporter-donnees-logos-site.js');                      // decider le charge à l'appel (L()) : qu'il manque, et on ne conclut pas, avant le lot
        const regle = await site.regleEmbarquee();
        decision.verifierRegle(regle);
        const api = { dossier: dir, PROJECTIONS: source.PROJECTIONS, decider: decision.decider, lireEntree: visuels.lireEntree, estVariante: marques.estVariante, regle,
            compacterSet: source.compacterSet, compacterCarte: source.compacterCarte, compacterLigne: source.compacterLigne, interneur: source.interneur };
        for (const k of ['decider', 'lireEntree', 'estVariante', 'compacterSet', 'compacterCarte', 'compacterLigne', 'interneur']) if (typeof api[k] !== 'function') throw new Error(`${k} absent de l'API`);
        for (const k of ['sets', 'cartes', 'cartes_produits']) if (!api.PROJECTIONS?.[k] || !Object.keys(api.PROJECTIONS[k]).length) throw new Error(`PROJECTIONS.${k} absente de l'API`);
        return api;
    } catch (e) { throw refus(e.message); }
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
    comparer('cartes', d => { for (const s of d.sets || []) touches.add(s); for (const m of d.images || []) if (m?.set) touches.add(m.set); });
    comparer('cartesProduits', l => { if (l.slugSet) touches.add(l.slugSet); for (const s of parExp.get(l.idExpansion) || []) touches.add(s); });
    comparer('sets', s => touches.add(s._id));
    return [...touches].filter(x => typeof x === 'string').sort();
}

// ── LE CONTRAT
/** Une entrée de decider → { ok, motif, variantePerdue }. `varianteLigne` : la variante de la ligne cartes_produits du produit. Une variante non nulle sur la ligne alors que l'entrée validée
 * porte `variante: null` est PERDUE EN SILENCE par l'API (hors liste fermée, ou sans preuve) : lireEntree ne la refuse pas, la garde la compte. */
function jugerEntree(api, e, varianteLigne = null) {
    const r = api.lireEntree(e);
    if (!r.ok) return { ok: false, motif: r.motif, variantePerdue: false, idProduct: e?.idProduct };
    const perdue = varianteLigne !== null && varianteLigne !== undefined && r.doc.variante === null;
    return { ok: true, motif: perdue ? `variante « ${varianteLigne} » perdue : hors de la liste fermée de l'API (ou sans preuve), l'entrée est servie avec variante null` : null, variantePerdue: perdue, idProduct: e.idProduct };
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
    const lignesR = L.filter(l => [...candidats(l)].some(x => setsR.has(x)));
    const cartesLignes = new Set(lignesR.map(l => l.carteId));
    const docsR = D.filter(d => cartesLignes.has(d._id) || (d.sets || []).some(x => setsR.has(x)));
    const setsRL = S.filter(s => setsR.has(s._id));
    if (!setsRL.length || !docsR.length || !lignesR.length) return resultat;
    const r = await api.decider({ sets: setsRL, docs: docsR, lignes: lignesR, metacarte: METACARTE_SENTINELLE(), regle: api.regle, cederLaMain: false });
    const varianteDe = new Map(), setsDe = new Map();
    for (const l of lignesR) {
        if (l.variante !== null && l.variante !== undefined && !varianteDe.has(l.idProduct)) varianteDe.set(l.idProduct, l.variante);
        if (!setsDe.has(l.idProduct)) setsDe.set(l.idProduct, new Set());
        for (const x of candidats(l)) setsDe.get(l.idProduct).add(x);
    }
    const gravite = j => (j.ok ? (j.variantePerdue ? 1 : 0) : 2);
    for (const e of r.entrees) {
        const j = { ...jugerEntree(api, e, varianteDe.get(e.idProduct) ?? null), sets: [...(setsDe.get(e.idProduct) || [])].sort() };
        const deja = resultat.get(e.idProduct);
        if (!deja || gravite(j) > gravite(deja)) resultat.set(e.idProduct, j);       // deux entrées pour un produit : la pire l'emporte
    }
    return resultat;
}

/** PURE. Compare deux Map idProduct → { ok, motif, variantePerdue }.
 *  nouveaux : refusés après sans l'être avant, ou variante perdue après sans l'être avant (BLOQUENT) ·
 *  persistants : refusés avant ET après, ou variante perdue avant ET après (ne bloquent pas, s'impriment) ·
 *  resolus : refusés avant, plus refusés après. */
function comparerContrat(avantMap, apresMap) {
    const nouveaux = [], persistants = [], resolus = [];
    for (const [id, a] of apresMap) {
        const b = avantMap.get(id);
        const refusAvant = Boolean(b) && !b.ok;
        if (!a.ok) { (refusAvant ? persistants : nouveaux).push({ idProduct: id, motif: a.motif, sets: a.sets }); continue; }
        if (refusAvant) resolus.push({ idProduct: id, motif: b.motif });
        if (a.variantePerdue) ((b && b.variantePerdue) ? persistants : nouveaux).push({ idProduct: id, motif: a.motif, sets: a.sets });
    }
    for (const [id, b] of avantMap) if (!b.ok && !apresMap.has(id)) resolus.push({ idProduct: id, motif: b.motif });
    // Information, NE BLOQUE PAS : un produit qui avait une entrée admise et n'en a plus après (decider l'écarte : marquage de partage incohérent, repli refusé…). Un retrait voulu entre ici aussi
    // (il est déjà compté par la garde des comptes, qui exige son annonce) ; c'est au lecteur de juger. On le montre pour qu'un visuel perdu ne soit jamais silencieux.
    const disparus = [];
    for (const [id, b] of avantMap) if (b.ok && !apresMap.has(id)) disparus.push({ idProduct: id, sets: b.sets });
    return { nouveaux, persistants, resolus, disparus };
}

/** Le verdict. @param avant,apres { sets, cartes, cartesProduits } (documents projetés ou bruts : on projette, idempotent). Toute exception est un refus de conclure. */
async function verifierContrat({ api, avant, apres }) {
    try {
        const A = projeterEtat(api, avant), B = projeterEtat(api, apres);
        const slugs = setsTouchesContrat({ avant: A, apres: B });
        const [mAvant, mApres] = [await contratDesSets({ api, sets: A.sets, docs: A.cartes, lignes: A.cartesProduits, slugs }), await contratDesSets({ api, sets: B.sets, docs: B.cartes, lignes: B.cartesProduits, slugs })];
        const c = comparerContrat(mAvant, mApres);
        const setsFautifs = [...new Set(c.nouveaux.flatMap(n => n.sets || []))].filter(s => slugs.includes(s)).sort();
        return { slugs, ...c, setsFautifs, entreesAvant: mAvant.size, entreesApres: mApres.size };
    } catch (e) { throw /^garde contrat API/.test(e.message) ? e : refus(e.stack ? `${e.message}` : e); }
}

/** La ligne imprimée et journalisée. */
const ligneContrat = (v) => `contrat API : ${v.slugs.length} set(s) rejoué(s) · refus nouveaux ${v.nouveaux.length} · persistants ${v.persistants.length} · résolus ${v.resolus.length}${v.disparus?.length ? ` · sans entrée après (information, ne bloque pas) ${v.disparus.length} : ${v.disparus.slice(0, 8).map(d => d.idProduct).join(',')}${v.disparus.length > 8 ? ',…' : ''}` : ''}`;

module.exports = { chargerApi, projeter, projeterEtat, setsTouchesContrat, contratDesSets, comparerContrat, jugerEntree, verifierContrat, ligneContrat, canon };
