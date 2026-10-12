'use strict';
// COTES-VISUELS — UNE SEULE décision du visuel et du lien fiche → produits, pour le chargeur de l'API ET pour l'exporteur (v2/migrations/exporter-visuels.js) : jamais deux copies (§21 bis).
// Pure : ne lit rien, n'écrit rien, ne connaît ni Mongo ni le réseau — elle reçoit des tableaux. La règle du site (`regle`) est injectée : EMBARQUÉE pour le chargeur
// (v2/chargeur/regle-site), importée du site pour l'outil de comparaison. Le CHOIX du visuel est celui de exporter-donnees-logos-site.js (`choisirVisuel`, partagé avec l'export des logos).
//   · politique v2 : un produit sans fiche du site est écarté ; un substitut sans mention reste sans mention (la validation d'entrée le refusera, rien n'est inventé).
//   · le LIEN : set (slug) → clé de fiche `idInterne|numero` (collectionContrat.ts : cleFiche) → idProducts, avec `fichesDesProduits` du site (produitsDeLaFiche, fichesDuDocument).
// Rend la main à la boucle d'événements entre deux sets (l'API sert pendant le chargement) : async.
const L = () => require('../../exporter-donnees-logos-site');      // paresseux : ce module charge dotenv à l'import
const REGLE_REQUISE = ['fichesDuDocument', 'setParImpression', 'produitsDeLaFiche', 'visuelAdmisPourLaRegion', 'normaliserNumero', 'cardmarketUrl'];

const entier = x => Number.isInteger(x) && x > 0;
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const fichierDe = (cle, w, h) => (typeof cle === 'string' && cle ? { cle, w, h } : null);
const ceder = () => new Promise(r => setImmediate(r));
/** La clé stable d'une fiche, comme lib/collectionContrat.ts::cleFiche (« - » pour une fiche sans numéro). */
const cleFiche = (idInterne, numero) => `${idInterne}|${numero ?? '-'}`;

function verifierRegle(regle) {
    for (const k of REGLE_REQUISE) if (!regle || typeof regle[k] !== 'function') throw new Error(`règle du site absente : ${k} — la décision s'arrête (jamais un repli)`);
}

/**
 * @param sets      documents `sets` (_id, idExpansion, nomAffichage, tirage, region, code, bulba.expansion)
 * @param docs      documents `cartes` (_id, nomEn, sets, impressions, images)
 * @param lignes    documents `cartes_produits` (carteId, idProduct, idExpansion, numeroFiche, slug, slugSet, visuelSubstitut)
 * @param metacarte Map idProduct → idMetacard (le catalogue : sa taille est le dénominateur du catalogue)
 * @param regle     la règle du site (six fonctions) ; @param journal fonction(texte)
 * @returns {Promise<{ entrees: object[], denominateurs: object, liens: Map<string, Map<string, number[]>> }>} — n'écrit rien nulle part.
 */
async function decider({ sets, docs, lignes, metacarte, regle, journal = () => { }, cederLaMain = true, sink = null }) {
    // `sink` { entree(e), lien(setId, cle, idProducts) } : les résultats sortent UN À UN (le chargeur les range en colonnes sans jamais tenir le tableau des entrées ni la Map des liens) ;
    // sans sink, ils sont rendus en tableau et en Map (les bancs, l'exporteur de comparaison).
    verifierRegle(regle);
    const Lg = L();
    if (!sets.length) throw new Error('aucun document dans `sets` : base fausse (un vide parfait n\'est pas « zéro visuel »)');
    if (!docs.length) throw new Error('aucun document dans `cartes` : base fausse');
    if (!lignes.length) throw new Error('aucune ligne dans `cartes_produits` : base fausse');
    if (!(metacarte instanceof Map) || !metacarte.size) throw new Error('catalogue_produits vide : base fausse');
    const pause = cederLaMain ? ceder : async () => { };
    const setsBase = new Map(sets.map(s => [s._id, s]));
    const carteDe = new Map(docs.map(d => [d._id, d]));
    // un substitut (cartes_produits.visuelSubstitut) nomme son fichier mais ne porte pas de vignette (mesuré : 3 219 sur 3 219) : la vignette est celle
    // de l'entrée cartes.images qui porte CE MÊME fichier (même cleR2 = même objet R2) ; aucune entrée ne le porte → pas de vignette, jamais devinée
    const vignetteDuFichier = new Map();
    for (const d of docs) for (const m of d.images || []) if (m?.cleR2 && m.vignette?.cleR2 && !vignetteDuFichier.has(m.cleR2)) vignetteDuFichier.set(m.cleR2, m.vignette);
    const parSet = new Map();
    for (const d of docs) for (const s of d.sets || []) { if (!parSet.has(s)) parSet.set(s, []); parSet.get(s).push(d); }

    // les candidats de chaque ligne : les sets dont elle porte le slugSet ou l'expansion (comme exporter-donnees-logos-site.js)
    const parExp = new Map(), parSlugSet = new Map();
    const exps = s => [].concat(s.idExpansion ?? []);
    for (const s of sets) for (const e of exps(s)) { if (!parExp.has(e)) parExp.set(e, []); parExp.get(e).push(s); }
    for (const s of sets) parSlugSet.set(s._id, s);
    const candidats = l => { const u = new Map(); for (const s of parExp.get(l.idExpansion) || []) u.set(s._id, s); if (l.slugSet && parSlugSet.has(l.slugSet)) u.set(l.slugSet, parSlugSet.get(l.slugSet)); return [...u.values()]; };

    // la fiche du site de chaque produit, set par set : sur TOUS les documents du set (la fiche par impression se décide sur le set entier)
    const lignesParSet = new Map();
    for (const l of lignes) for (const s of candidats(l)) { if (!lignesParSet.has(s._id)) lignesParSet.set(s._id, []); lignesParSet.get(s._id).push(l); }
    const fiches = new Map(), liens = new Map(), compte = { sets: 0, fiches: 0, produits: 0 };
    let n = 0;
    for (const [id, ls] of lignesParSet) {
        const s = setsBase.get(id), membres = (parSet.get(id) || []).filter(d => typeof d.nomEn === 'string' && d.nomEn !== '');
        const ids = new Set(membres.map(d => d._id));
        const fiche = Lg.fichesDesProduits(regle, s, membres, ls.filter(l => ids.has(l.carteId) && exps(s).includes(l.idExpansion))).fiche;
        fiches.set(id, fiche);
        const parCle = new Map();                                             // clé de fiche → idProducts (triés : une sortie stable)
        for (const [idProduct, f] of fiche) { const cle = cleFiche(f.carteId, f.numero); if (!parCle.has(cle)) parCle.set(cle, []); parCle.get(cle).push(idProduct); }
        for (const v of parCle.values()) v.sort((a, b) => a - b);
        if (parCle.size) {
            compte.sets++; compte.fiches += parCle.size;
            for (const v of parCle.values()) compte.produits += v.length;
            if (sink) { for (const [cle, ids] of parCle) sink.lien(id, cle, ids); } else liens.set(id, parCle);
        }
        if (++n % 20 === 0) await pause();
    }
    journal(`sets : ${sets.length} · cartes : ${docs.length} · cartes_produits : ${lignes.length} · catalogue : ${metacarte.size} · sets à fiches : ${compte.sets}`);
    const choisir = l => {
        const cs = candidats(l).map(s => ({ s, f: fiches.get(s._id)?.get(l.idProduct) }));
        const avec = cs.filter(x => x.f && x.f.carteId === l.carteId);
        return { ...(avec[0] || cs.find(x => exps(x.s).includes(l.idExpansion)) || cs[0] || {}), plusieurs: cs.length > 1 };
    };

    const d = { catalogue: metacarte.size, avecLigne: lignes.length, sansLigne: 0, duSet: 0, substitut: 0, autreTirage: 0, aucun: 0,
        aucunDetail: { 'carte absente': 0, 'aucun set candidat': 0, 'aucun visuel': 0 }, ecrites: 0, sansFicheDuSite: 0, rareteContredite: 0, idMetacardAbsent: 0, plusieursSets: 0,
        setsAvecLiens: compte.sets, fichesLiees: compte.fiches, produitsLies: compte.produits };
    const vus = new Set(lignes.map(l => l.idProduct));
    for (const id of metacarte.keys()) if (!vus.has(id)) d.sansLigne++;
    vus.clear();
    const entrees = [];
    // JUMEAU-V2 : le créneau (expansion, numéro de fiche) et la langue de tirage de CHAQUE produit du catalogue, avec sa métacarte — le producteur de la colonne que la route lit pour ne jamais
    // affirmer un produit qui a un jumeau. Émis AVANT les écartements ci-dessous (un produit sans visuel ou sans fiche du site a quand même des jumeaux). Un produit du catalogue sans ligne :
    // créneau et langue INCONNUS (jamais devinés) ; un champ inconnu reste un jumeau côté route. Sans `sink`, la liste est rendue (les bancs).
    const jumeaux = [], emis = new Set();
    const emettre = j => { if (sink) { if (typeof sink.jumeau === 'function') sink.jumeau(j); } else jumeaux.push(j); };
    const metaDe = id => (entier(metacarte.get(id)) ? metacarte.get(id) : null);
    n = 0;
    for (const l of lignes) {
        if (++n % 2000 === 0) await pause();
        const { s, f, plusieurs } = choisir(l), c = carteDe.get(l.carteId);
        emis.add(l.idProduct);
        emettre({ idProduct: l.idProduct, idMetacard: metaDe(l.idProduct), idExpansion: entier(l.idExpansion) ? l.idExpansion : null,
            numero: l.numeroFiche == null ? null : texte(regle.normaliserNumero(l.numeroFiche)), tirage: s ? texte(s.tirage ?? s.region) : null });
        if (plusieurs) d.plusieursSets++;
        if (!c) { d.aucun++; d.aucunDetail['carte absente']++; continue; }
        if (!s) { d.aucun++; d.aucunDetail['aucun set candidat']++; continue; }
        const tirage = s.tirage ?? s.region, noms = [].concat(s.bulba?.expansion ?? []);
        // LE choix du visuel : la fonction des logos (un seul exemplaire). Politiques : un produit sans fiche du site est écarté, comme chez les logos
        // (le site ne le montre sur aucune fiche : aucun visuel « du set » à lui désigner) ; un substitut sans mention reste sans mention et
        // la validation d'entrée le refuse (elle exige une mention non vide), alors que les logos posent un repli.
        const choix = Lg.choisirVisuel({ ligne: l, carte: c, set: s, fiche: f, regle, setsBase, substitutSansMention: 'refus' });
        if (choix.sansFiche) { d.sansFicheDuSite++; continue; }
        const { im, visuel, mention } = choix;
        if (!im) { d.aucun++; d.aucunDetail['aucun visuel']++; continue; }
        if (visuel === 'du-set') d.duSet++; else if (visuel === 'substitut') d.substitut++; else d.autreTirage++;

        // rareté et total : les impressions de la carte, dans le tirage et l'expansion du set, AU numéro de la fiche
        const cle = x => regle.normaliserNumero(x) ?? '';
        const voulu = l.numeroFiche == null ? '' : cle(l.numeroFiche);
        const au = voulu ? (c.impressions || []).filter(i => i && i.tirage === tirage && noms.includes(i.expansion) && cle(i.numero) === voulu) : [];
        const valeur = champ => { const vs = [...new Set(au.map(i => texte(i[champ])).filter(Boolean))]; return vs.length === 1 ? vs[0] : null; };
        const distincts = champ => new Set(au.map(i => texte(i[champ])).filter(Boolean)).size;
        const rarete = valeur('rarete'), total = valeur('total');
        if (distincts('rarete') > 1 || distincts('total') > 1) d.rareteContredite++;
        const numero = l.numeroFiche == null ? null : String(l.numeroFiche);
        const idMetacard = entier(metacarte.get(l.idProduct)) ? metacarte.get(l.idProduct) : null;
        if (idMetacard === null) d.idMetacardAbsent++;
        const e = { idProduct: l.idProduct, visuel, mention, idMetacard, numero, rarete, total, variante: null, setNom: texte(s.nomAffichage),
            lien: numero && rarete ? regle.cardmarketUrl({ slug: l.slug, slugSet: l.slugSet }) : null,
            grande: entier(im.w) && entier(im.h) ? fichierDe(im.cleR2, im.w, im.h) : null };
        const vs = im.vignette ?? vignetteDuFichier.get(im.cleR2);
        const v = vs && fichierDe(vs.cleR2, vs.w, vs.h);
        if (v) e.vignette = v;
        if (sink) sink.entree(e); else entrees.push(e);
        d.ecrites++;
    }
    for (const id of metacarte.keys()) if (!emis.has(id)) emettre({ idProduct: id, idMetacard: metaDe(id), idExpansion: null, numero: null, tirage: null });
    entrees.sort((a, b) => a.idProduct - b.idProduct);
    return { entrees, denominateurs: d, liens, ...(sink ? {} : { jumeaux }) };
}

module.exports = { decider, verifierRegle, cleFiche, REGLE_REQUISE };
