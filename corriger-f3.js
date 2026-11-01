// ============================================================
// LES TROIS MODIFICATIONS DE LA FAMILLE f3 — feu vert NOMMÉ du testeur (2026-11-01) : détacher une ligne fausse, retirer dix numéros faux, corriger un total imprimé
// ============================================================
//   node corriger-f3.js [--hypothese-f3] --annonce=<f>.json --liste=<f>.json --preuves=<f>.json          (simulation : rejoue chaque prémisse, n'écrit RIEN en base)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits,sets --annonce=<f>.json -- node corriger-f3.js --seulement=<liste>.json --attendu=<N> --retour=<f>.json --ecrire
//   node lot-additif.js --quoi="… retour arrière" --collections=cartes,cartes_produits,sets -- node corriger-f3.js --revenir=<retour>.json --ecrire
//
// 🔑 UN FEU VERT AUTORISE UN GESTE, IL NE PROUVE PAS SA PRÉMISSE (§77) : chaque modification de la décision est REJOUÉE sur la base au moment d'écrire, et la seule issue qui écrit est « prête ».
// Une garde s'écrit par ce qu'elle autorise : tout ce qui n'est pas prouvé reste « attend », « sortie », « refus » ou « déjà fait » et n'écrit rien.
//   a. LIGNE `71404|677582` : le nom du produit CONTREDIT la carte jointe, ET une autre carte du set porte ce nom (et la bonne ligne existe déjà).
//   b. TOTAL de Wind-from-the-Sea : la valeur est LUE sur des scans (≥ 2 cartes différentes) — jamais déduite de la Setlist ni du nombre de produits —, et recoupée avec ce que la base porte déjà.
//   c. IMPRESSIONS fausses : le numéro faux est celui d'une AUTRE carte (Setlist ET produit Cardmarket), la BONNE impression est déjà sur la carte (lot f3 poser-trous-setlist.js), et RIEN ne dépend de
//      l'impression retirée : ni image, ni ligne de jointure, ni illustrateur. Une carte dont quelque chose en dépend SORT de la liste (elle s'écrit, elle ne se retire pas).
// L'ancienne valeur est écrite dans un fichier de RETOUR avant la première écriture ; `--revenir=<fichier>` la remet (idempotent).
const fs = require('fs');
const path = require('path');

// ───────────────────────── la décision : une liste fermée ─────────────────────────
const DECISION = '2026-11-01';
const LIGNES = [{ id: '71404|677582', carteId: 71404, idProduct: 677582, slugSet: 'Beat-of-the-Frontier' }];
// faux = l'impression retirée ; vrai = celle que le lot f3 pose (Setlist). slugFaux = le set dont la Setlist range le numéro faux à une AUTRE carte.
const imp = (carteId, nom, slugVrai, slugFaux, tirage, expF, numF, expV, numV) => ({ carteId, nom, slugVrai, slugFaux, faux: { tirage, expansion: expF, numero: numF }, vrai: { tirage, expansion: expV, numero: numV } });
const IMPRESSIONS = [
    imp(29833, 'Energy Restore', 'Base-Expansion-Pack', 'Base-Expansion-Pack', 'jp', 'Base Expansion Pack', '059', 'Base Expansion Pack', '050'),
    imp(339454, 'Wondrous Patch', 'Nihil-Zero', 'Nihil-Zero', 'jp', 'Nihil Zero', '103', 'Nihil Zero', '104'),
    imp(235857, 'Dust Island', 'Double-Blaze', 'Double-Blaze', 'jp', 'Double Blaze', '089', 'Double Blaze', '090'),
    imp(126639, 'Pokémon Catcher', 'Super-Burst-Impact', 'Super-Burst-Impact', 'jp', 'Super-Burst Impact', '080', 'Super-Burst Impact', '081'),
    imp(71404, 'Drifblim FB', 'Beat-of-the-Frontier', 'Beat-of-the-Frontier', 'jp', 'Beat of the Frontier', '038', 'Beat of the Frontier', '050'),
    imp(78774, 'Mothim', 'Advent-of-Arceus', 'Advent-of-Arceus', 'jp', 'Advent of Arceus', '010', 'Advent of Arceus', '012'),
    imp(53664, 'Metagross ex', 'Undone-Seal', 'Undone-Seal', 'jp', 'Undone Seal', '070', 'Undone Seal', '071'),
    imp(200985, 'Probopass', 'Gaia-Volcano', 'Gaia-Volcano', 'jp', 'Gaia Volcano', '046', 'Gaia Volcano', '047'),
    imp(200932, 'Primal Kyogre-EX', 'Tidal-Storm', 'Gaia-Volcano', 'jp', 'Gaia Volcano', '073', 'Tidal Storm', '073'),
    imp(85135, 'Donphan', 'HeartGold-Collection', 'HeartGold-Collection', 'jp', 'HeartGold Collection', '034', 'HeartGold Collection', '046')
];
// b. Trois scans OUVERTS à l'œil le 2026-11-01 (cache local du labo, manifeste.json : clé artofpkm/57/N.webp → fichier ; 593 × 834, langue ja) ; le dénominateur imprimé se lit en bas à droite de la carte.
const DOSSIER_SCANS = 'C:/Users/Yung/Desktop/labo-embedding/cache-visuels/img/';
const TOTAUX = [{
    set: 'Wind-from-the-Sea', avant: 92, lu: 87,
    scans: [
        { cle: 'artofpkm/57/12', carteId: 42307, nom: 'Exeggcute', numero: '012', lu: '012/087', fichier: `${DOSSIER_SCANS}8cc4d917ad628304ef79133caf3a06383210a9c9.webp` },
        { cle: 'artofpkm/57/88', carteId: 27964, nom: 'Nidoking', numero: '088', lu: '088/087', fichier: `${DOSSIER_SCANS}ab9be074c13683add6a9ab7d4b939b8a4744abd4.webp` },
        { cle: 'artofpkm/57/90', carteId: 27962, nom: 'Lugia', numero: '090', lu: '090/087', fichier: `${DOSSIER_SCANS}9ef4a8188fff5beedd138f7cea01d54203e73e5c.webp` }
    ]
}];

const idLigne = x => `ligne:${x.id}`;
const idImp = d => `imp:${d.carteId}:${d.faux.tirage}:${d.faux.expansion}:${d.faux.numero}`;
const idTotal = d => `total:${d.set}`;

// ───────────────────────── outils purs ─────────────────────────
const jointure = () => require('./collecte-cartes/jointure');
const cle = n => jointure().cleNumero(String(n));
const memeImp = (i, x) => !!i && i.tirage === x.tirage && i.expansion === x.expansion && i.numero != null && cle(i.numero) === cle(x.numero);

/** Les noms que le produit Cardmarket peut porter chez Bulbapedia : « Electivire [FB] Lv.50 » est la carte « Electivire FB » (même lecture que poser-trous-setlist.js). */
function nomsDuProduit(p) {
    const { decomposerNomCardmarket, normaliserNom } = jointure();
    const d = decomposerNomCardmarket(p.name);
    const g = /\[([A-Z0-9]{1,3})\]/.exec(p.name);
    return [normaliserNom(d.nom), g ? normaliserNom(`${d.nom} ${g[1]}`) : null].filter(Boolean);
}
const nomDeCarte = c => jointure().normaliserNom(c && c.nomEn);

/** « Dust Island (Double Blaze 90) » → { titre, a: 'Double Blaze', b: '90' } */
function entreesDeTitres(titres) {
    const out = [];
    for (const titre of titres || []) { const m = /^(.*) \((.+) (\S+)\)$/.exec(titre); if (m) out.push({ titre, nom: m[1], a: m[2], b: m[3] }); }
    return out;
}

// ───────────────────────── a. la ligne ─────────────────────────
/**
 * @param e { ligne, produit, carte, cartesDuSet, lignesDuProduit, expansions: string[], tirage }
 * @returns {{id, type, statut: 'prete'|'deja-fait'|'refus', raison, preuve}}
 */
function jugerLigne(x, e) {
    const r = { id: idLigne(x), type: 'ligne', statut: null, raison: null, preuve: {} };
    if (!e.ligne) { r.statut = 'deja-fait'; r.raison = `la ligne ${x.id} n'existe plus : rien à détacher`; return r; }
    if (e.ligne.carteId !== x.carteId || e.ligne.idProduct !== x.idProduct) { r.statut = 'refus'; r.raison = `la ligne ${x.id} ne porte pas (carte ${x.carteId}, produit ${x.idProduct})`; return r; }
    if (!e.produit) { r.statut = 'refus'; r.raison = `le produit ${x.idProduct} n'est pas dans le catalogue de l'expansion : le témoin du nom n'a rien à lire`; return r; }
    if (!e.carte || !e.carte.nomEn) { r.statut = 'refus'; r.raison = `la carte ${x.carteId} n'a pas de nom : le témoin du nom n'a rien à lire`; return r; }
    const noms = nomsDuProduit(e.produit);
    if (noms.includes(nomDeCarte(e.carte))) { r.statut = 'refus'; r.raison = `le nom du produit « ${e.produit.name} » concorde avec la carte « ${e.carte.nomEn} » : la ligne n'est pas contredite`; return r; }
    const autres = (e.cartesDuSet || []).filter(c => c._id !== x.carteId && noms.includes(nomDeCarte(c)));
    if (autres.length !== 1) { r.statut = 'refus'; r.raison = `${autres.length} carte(s) du set portent le nom du produit (« ${noms.join(' / ')} ») : il en faut exactement UNE pour dire où il va`; return r; }
    const autre = autres[0];
    const N = e.produit.numero;
    if (N == null || !(autre.impressions || []).some(i => i.tirage === e.tirage && e.expansions.includes(i.expansion) && i.numero != null && cle(i.numero) === cle(N))) {
        r.statut = 'refus'; r.raison = `l'autre carte « ${autre.nomEn} » (${autre._id}) ne porte pas le numéro du produit (${N}) dans ce set`; return r;
    }
    if (!(e.lignesDuProduit || []).some(l => l.carteId === autre._id)) { r.statut = 'refus'; r.raison = `le produit n'a pas de ligne vers « ${autre.nomEn} » (${autre._id}) : détacher le laisserait sans fiche`; return r; }
    r.statut = 'prete';
    r.raison = `le produit « ${e.produit.name} » n'est pas « ${e.carte.nomEn} » ; la carte ${autre._id} « ${autre.nomEn} » porte son n°${N} et reçoit déjà sa ligne`;
    r.preuve = { produit: e.produit.name, numeroProduit: N, carteJointe: e.carte.nomEn, autreCarte: autre._id, autreCarteNom: autre.nomEn, ligne: e.ligne };
    const liens = (e.carte.liens && e.carte.liens.idProduct) || [];
    r.avant = { ligne: e.ligne, liensAvaient: liens.includes(x.idProduct), liensIndex: liens.indexOf(x.idProduct), liensAvant: [...liens] };
    return r;
}

// ───────────────────────── c. l'impression ─────────────────────────
/**
 * @param e { carte, cartesFaux: Map<id, carte>, titres, pages, produits, images (documents `images` de la carte dans le set faux), lignes (lignes de la carte dans l'expansion du set faux), hypothese }
 * @returns {{id, type, statut: 'prete'|'attend'|'sortie'|'refus'|'deja-fait', raison, preuve}}
 */
function jugerImpression(d, e) {
    const r = { id: idImp(d), type: 'impression', carteId: d.carteId, nom: d.nom, statut: null, raison: null, preuve: {} };
    const c = e.carte;
    if (!c) { r.statut = 'refus'; r.raison = `la carte ${d.carteId} est absente`; return r; }
    const imps = c.impressions || [];
    const fauxs = imps.map((i, k) => ({ i, k })).filter(({ i }) => memeImp(i, d.faux));
    if (!fauxs.length) { r.statut = 'deja-fait'; r.raison = `la carte ne porte plus l'impression ${d.faux.expansion} ${d.faux.numero}`; return r; }
    if (fauxs.length > 1) { r.statut = 'refus'; r.raison = `${fauxs.length} impressions identiques (${d.faux.expansion} ${d.faux.numero}) : la décision en nomme une`; return r; }
    const faux = fauxs[0].i;
    if (faux.source) { r.statut = 'refus'; r.raison = `l'impression porte une source (${faux.source}) : posée par un outil, pas déclarée par la page — la décision ne vise pas celles-là`; return r; }
    if (imps.some(i => memeImp(i, d.vrai) && i === faux)) { r.statut = 'refus'; r.raison = 'le faux et le vrai numéro sont le même'; return r; }

    // la prémisse : le numéro faux appartient à une AUTRE carte, par la Setlist ET par Cardmarket
    const entrees = entreesDeTitres(e.titres).filter(x => x.a === d.faux.expansion && cle(x.b) === cle(d.faux.numero));
    if (entrees.length !== 1) { r.statut = 'refus'; r.raison = `la Setlist de ${d.slugFaux} range ${entrees.length} entrée(s) au n°${d.faux.numero} (${d.faux.expansion}) : il en faut exactement une`; return r; }
    const page = (e.pages || []).find(p => p.titre === entrees[0].titre && p.pageid != null);
    if (!page) { r.statut = 'refus'; r.raison = `l'entrée « ${entrees[0].titre} » n'a pas de page : la Setlist ne dit pas quelle carte porte ce numéro`; return r; }
    if (page.pageid === d.carteId) { r.statut = 'refus'; r.raison = `la Setlist range ce numéro à la carte ${d.carteId} elle-même : le numéro n'est pas faux`; return r; }
    const autre = e.cartesFaux && e.cartesFaux.get(page.pageid);
    if (!autre) { r.statut = 'refus'; r.raison = `la carte ${page.pageid} que la Setlist range au n°${d.faux.numero} est absente de la base`; return r; }
    if (!(autre.impressions || []).some(i => memeImp(i, d.faux))) { r.statut = 'refus'; r.raison = `la carte ${autre._id} « ${autre.nomEn} » ne porte pas elle-même le n°${d.faux.numero} (${d.faux.expansion}) : le numéro n'est pas le sien`; return r; }
    const produits = (e.produits || []).filter(p => p.numero != null && cle(p.numero) === cle(d.faux.numero));
    if (!produits.length) { r.statut = 'refus'; r.raison = `aucun produit Cardmarket au n°${d.faux.numero} de ${d.slugFaux} : un seul témoin (la Setlist)`; return r; }
    const discordants = produits.filter(p => !nomsDuProduit(p).includes(nomDeCarte(autre)));
    if (discordants.length) { r.statut = 'refus'; r.raison = `le produit ${discordants[0].idProduct} « ${discordants[0].name} » au n°${d.faux.numero} n'a pas le nom de l'autre carte « ${autre.nomEn} »`; return r; }
    r.preuve = { setlist: entrees[0].titre, autreCarte: autre._id, autreCarteNom: autre.nomEn, produits: produits.map(p => `${p.idProduct} ${p.name}`) };

    // la bonne impression doit être là (lot f3) — sinon la carte ATTEND
    let vraiPresent = imps.some(i => i !== faux && memeImp(i, d.vrai));
    if (!vraiPresent && e.hypothese) { vraiPresent = true; r.hypothese = true; }
    if (!vraiPresent) { r.statut = 'attend'; r.raison = `la bonne impression (${d.vrai.expansion} ${d.vrai.numero}) n'est pas encore sur la carte : le lot f3 (poser-trous-setlist.js) doit passer d'abord`; return r; }

    // rien ne doit dépendre de l'impression retirée
    const dep = [];
    // DÉCISION du 2026-11-01 : un illustrateur lu au numéro faux est lui-même suspect ; il se retire avec l'impression (annoncé), il ne retient plus la carte
    const illus = typeof faux.illustrateur === 'string' && faux.illustrateur.trim() ? faux.illustrateur : null;
    if (illus) r.preuve.illustrateurRetire = illus;
    const imgs = [...(c.images || []).filter(m => m.set === d.slugFaux), ...(e.images || [])].filter(m => m.numero != null && cle(m.numero) === cle(d.faux.numero));
    if (imgs.length) dep.push(`${imgs.length} image(s) du set ${d.slugFaux} au n°${d.faux.numero}`);
    const parId = new Map((e.produits || []).map(p => [p.idProduct, p]));
    const auNumero = (e.lignes || []).filter(l => { const p = parId.get(l.idProduct); return p && p.numero != null && cle(p.numero) === cle(d.faux.numero); });
    // une ligne que CE MÊME lot détache (a.) ne retient pas l'impression : mais l'impression ne s'écrit alors que si cette détache s'écrit aussi (`dependDe`, vérifié par `trancher`)
    const retirees = e.lignesRetirees || new Set();
    const lignes = auNumero.filter(l => !retirees.has(l._id));
    const couvertes = auNumero.filter(l => retirees.has(l._id));
    if (lignes.length) dep.push(`${lignes.length} ligne(s) de jointure au n°${d.faux.numero} (${lignes.map(l => l._id).join(', ')})`);
    if (dep.length) { r.statut = 'sortie'; r.raison = `quelque chose DÉPEND de l'impression retirée : ${dep.join(' ; ')} — la carte sort de la liste`; r.preuve.dependances = dep; return r; }

    if (couvertes.length) r.dependDe = couvertes.map(l => `ligne:${l._id}`);
    r.statut = 'prete';
    r.raison = `${illus ? `[illustrateur lu au numéro faux, retiré avec l'impression : « ${illus} », ${faux.illustrateurPreuve || 'sans preuve écrite'}] ` : ''}${couvertes.length ? `[avec la détache de ${couvertes.map(l => l._id).join(', ')} dans le même lot] ` : ''}le n°${d.faux.numero} de ${d.faux.expansion} est celui de « ${autre.nomEn} » (${autre._id}) — Setlist « ${entrees[0].titre} » et produit(s) Cardmarket au même nom ; la bonne impression ${d.vrai.numero} est présente${r.hypothese ? ' (HYPOTHÈSE : le lot f3 n\'est pas encore écrit)' : ''}`;
    r.avant = { index: fauxs[0].k, impression: faux };
    r.perd = { rarete: faux.rarete ?? null, total: faux.total ?? null, illustrateur: illus, illustrateurPreuve: faux.illustrateurPreuve ?? null };
    return r;
}

// ───────────────────────── b. le total imprimé ─────────────────────────
/** @param e { setDoc, docsImages: Map<cle, doc>, totauxImpressions: {<total>: n}, fichiers: Set<chemin> } */
function jugerTotal(d, e) {
    const r = { id: idTotal(d), type: 'total', statut: null, raison: null, preuve: {} };
    if (!e.setDoc) { r.statut = 'refus'; r.raison = `le set ${d.set} est absent`; return r; }
    if (e.setDoc.totalImprime === d.lu) { r.statut = 'deja-fait'; r.raison = `totalImprime vaut déjà ${d.lu}`; return r; }
    if (e.setDoc.totalImprime !== d.avant) { r.statut = 'refus'; r.raison = `totalImprime vaut ${JSON.stringify(e.setDoc.totalImprime)}, la décision part de ${d.avant} : la base a bougé`; return r; }
    const cartesDistinctes = new Set(d.scans.map(s => s.carteId));
    if (cartesDistinctes.size < 2) { r.statut = 'attend'; r.raison = 'moins de DEUX scans de cartes différentes : une valeur lue sur une seule carte ne se recoupe pas'; return r; }
    const preuves = [];
    for (const s of d.scans) {
        const m = /^(\d+)\/(\d+)$/.exec(s.lu);
        if (!m || Number(m[2]) !== d.lu) { r.statut = 'refus'; r.raison = `le scan ${s.cle} est lu « ${s.lu} » : son dénominateur n'est pas ${d.lu}`; return r; }
        const doc = e.docsImages.get(s.cle);
        if (!doc) { r.statut = 'refus'; r.raison = `le document images ${s.cle} est absent : la source du scan n'est pas retrouvable`; return r; }
        if (doc.set !== d.set || doc.carteId !== s.carteId || cle(doc.numero) !== cle(s.numero)) { r.statut = 'refus'; r.raison = `le document ${s.cle} ne désigne pas (carte ${s.carteId}, n°${s.numero}, ${d.set})`; return r; }
        if (doc.total != null && Number(String(doc.total).replace(/\D/g, '')) !== d.lu) { r.statut = 'refus'; r.raison = `le document ${s.cle} porte le total ${doc.total}, la lecture dit ${d.lu}`; return r; }
        if (!doc.urlOriginal) { r.statut = 'refus'; r.raison = `le document ${s.cle} n'a pas d'urlOriginal : la source d'origine du scan n'est pas écrite`; return r; }
        if (!(e.fichiers && e.fichiers.has(s.fichier))) { r.statut = 'refus'; r.raison = `le fichier local ${s.fichier} n'existe pas : le scan ne peut plus être rouvert`; return r; }
        preuves.push({ carte: s.carteId, nom: s.nom, cle: s.cle, fichier: s.fichier, urlOriginal: doc.urlOriginal, lu: s.lu, langue: doc.langue ?? null });
    }
    // recoupement : la base porte DÉJÀ ce dénominateur sur la quasi-totalité des impressions du set (une donnée que la lecture n'a pas utilisée)
    const tot = Object.entries(e.totauxImpressions || {}).reduce((m, [k, n]) => { const v = Number(String(k).replace(/\D/g, '')) || null; m[v] = (m[v] || 0) + n; return m; }, {});
    const somme = Object.values(tot).reduce((a, b) => a + b, 0);
    const part = somme ? (tot[d.lu] || 0) / somme : 0;
    if (part < 0.9) { r.statut = 'refus'; r.raison = `seulement ${(part * 100).toFixed(0)} % des impressions du set portent le total ${d.lu} (${JSON.stringify(tot)}) : la lecture n'est pas recoupée`; return r; }
    r.statut = 'prete';
    r.raison = `${d.scans.length} scans de cartes différentes lus « /${String(d.lu).padStart(3, '0')} » ; ${(part * 100).toFixed(0)} % des impressions du set portent déjà ce total`;
    r.preuve = { scans: preuves, impressionsParTotal: tot };
    r.avant = { totalImprime: d.avant }; r.apres = { totalImprime: d.lu };
    return r;
}

// ───────────────────────── l'écriture et le retour arrière ─────────────────────────
/** Le fichier de RETOUR : document `_id`, champ, valeur exacte avant. Écrit AVANT toute écriture, en création exclusive (jamais d'écrasement). */
function construireRetour(plan, retenus, extra = {}) {
    const mods = [];
    for (const r of plan.filter(p => retenus.has(p.id) && p.statut === 'prete')) {
        if (r.type === 'ligne') mods.push({ id: r.id, type: 'ligne', collection: 'cartes_produits', _id: r.avant.ligne._id, carteId: r.avant.ligne.carteId, idProduct: r.avant.ligne.idProduct, document: r.avant.ligne, liensAvaient: r.avant.liensAvaient, liensIndex: r.avant.liensIndex, liensAvant: r.avant.liensAvant });
        else if (r.type === 'impression') mods.push({ id: r.id, type: 'impression', collection: 'cartes', _id: r.carteId, champ: 'impressions', index: r.avant.index, valeur: r.avant.impression });
        else if (r.type === 'total') mods.push({ id: r.id, type: 'total', collection: 'sets', _id: r.id.slice(6), champ: 'totalImprime', avant: r.avant.totalImprime, apres: r.apres.totalImprime });
    }
    return { decision: DECISION, ecritLe: new Date().toISOString(), ...extra, modifications: mods };
}

async function ecrire({ db, plan, retenus, fichierRetour, log = console.log, ecrireFichier = (f, s) => fs.writeFileSync(f, s, { flag: 'wx' }) }) {
    const aEcrire = plan.filter(r => retenus.has(r.id) && r.statut === 'prete');
    const retour = construireRetour(plan, retenus);
    // 1. le RETOUR d'abord : si le fichier ne s'écrit pas, rien ne s'écrit
    ecrireFichier(fichierRetour, JSON.stringify(retour, null, 1));
    let lignes = 0, impressions = 0, totaux = 0;
    for (const m of retour.modifications) {
        if (m.type === 'ligne') {
            const s = await db.collection(m.collection).deleteOne({ _id: m._id });
            if (s.deletedCount !== 1) throw new Error(`${m.id} : ${s.deletedCount} ligne supprimée (attendu 1)`);
            await db.collection('cartes').updateOne({ _id: m.carteId }, { $pull: { 'liens.idProduct': m.idProduct } });
            lignes++;
        } else if (m.type === 'impression') {
            const f = m.valeur;
            const s = await db.collection('cartes').updateOne({ _id: m._id }, { $pull: { impressions: { tirage: f.tirage, expansion: f.expansion, numero: f.numero } } });
            if (s.modifiedCount !== 1) throw new Error(`${m.id} : ${s.modifiedCount} carte modifiée (attendu 1)`);
            impressions++;
        } else if (m.type === 'total') {
            const s = await db.collection('sets').updateOne({ _id: m._id, totalImprime: m.avant }, { $set: { totalImprime: m.apres } });
            if (s.modifiedCount !== 1) throw new Error(`${m.id} : ${s.modifiedCount} set modifié (attendu 1)`);
            totaux++;
        }
    }
    log(`   ÉCRIT : ${lignes} ligne(s) détachée(s) · ${impressions} impression(s) retirée(s) · ${totaux} total(aux) corrigé(s) · ${aEcrire.length} modification(s) · retour : ${fichierRetour}`);
    return { lignes, impressions, totaux, retour };
}

/** `--revenir` : remet l'ancienne valeur. Idempotent : ce qui est déjà revenu n'est pas refait. */
async function revenir({ db, retour, log = console.log }) {
    let n = 0, deja = 0;
    for (const m of [...retour.modifications].reverse()) {
        if (m.type === 'ligne') {
            const r = await db.collection('cartes_produits').replaceOne({ _id: m._id }, m.document, { upsert: true });
            if (m.liensAvaient) {
                // le lien revient à sa POSITION d'origine (jamais en fin de tableau), et une seule fois
                const c = await db.collection('cartes').findOne({ _id: m.carteId });
                const actuels = (c && c.liens && c.liens.idProduct) || [];
                if (c && !actuels.includes(m.idProduct)) await db.collection('cartes').updateOne({ _id: m.carteId }, { $push: { 'liens.idProduct': { $each: [m.idProduct], $position: Math.max(0, Math.min(m.liensIndex ?? actuels.length, actuels.length)) } } });
            }
            (r.upsertedCount ? n++ : deja++);
        } else if (m.type === 'impression') {
            const f = m.valeur;
            const c = await db.collection('cartes').findOne({ _id: m._id });
            if (c && (c.impressions || []).some(i => memeImp(i, f))) { deja++; continue; }
            await db.collection('cartes').updateOne({ _id: m._id }, { $push: { impressions: { $each: [f], $position: Math.min(m.index, (c && c.impressions || []).length) } } });
            n++;
        } else if (m.type === 'total') {
            const r = await db.collection('sets').updateOne({ _id: m._id, totalImprime: m.apres }, { $set: { totalImprime: m.avant } });
            (r.modifiedCount ? n++ : deja++);
        }
    }
    log(`   RETOUR : ${n} valeur(s) remise(s), ${deja} déjà en place`);
    return { remises: n, deja };
}

/**
 * Le chemin d'ÉCRITURE réel, séparé de principal() pour être banqué avec une connexion de la VRAIE forme : `ouvrirConnexions` (collecte-cartes/garde.js)
 * rend { cartes, prod, fermer } ; la base native vit sur `cartes.db` (il n'y a pas de `cx.db`).
 */
async function lancerEcriture({ ouvrir, plan, liste, attendu, fichierRetour, log = console.log, err = console.error }) {
    const t = trancher({ plan, liste, attendu });
    if (t.motif) throw new Error(`ARRÊT : ${t.motif} — rien n'est écrit`);
    const cx = await ouvrir();
    try {
        const db = cx.cartes.db;
        const R = await ecrire({ db, plan, retenus: t.retenus, fichierRetour, log });
        let relu = 0;
        for (const m of R.retour.modifications) {
            if (m.type === 'ligne') {
                const liens = ((await db.collection('cartes').findOne({ _id: m.carteId })) || {}).liens;
                relu += !(await db.collection('cartes_produits').findOne({ _id: m._id })) && !((liens && liens.idProduct) || []).includes(m.idProduct) ? 1 : 0;
            } else if (m.type === 'impression') {
                const c = await db.collection('cartes').findOne({ _id: m._id }); const d = IMPRESSIONS.find(x => idImp(x) === m.id);
                relu += !(c.impressions || []).some(i => memeImp(i, d.faux)) && (c.impressions || []).some(i => memeImp(i, d.vrai)) ? 1 : 0;
            } else if (m.type === 'total') relu += (await db.collection('sets').findOne({ _id: m._id })).totalImprime === m.apres ? 1 : 0;
        }
        log(`   RELECTURE : ${relu}/${R.retour.modifications.length} modifications retrouvées`);
        if (relu !== R.retour.modifications.length) err('❌ la relecture ne retrouve pas tout ce qui devait être écrit');
        return { relu, attendu: R.retour.modifications.length };
    } finally { await cx.fermer(); }
}
async function lancerRetour({ ouvrir, retour, log = console.log }) {
    const cx = await ouvrir();
    try { return await revenir({ db: cx.cartes.db, retour, log }); } finally { await cx.fermer(); }
}

/** La liste d'un lot : un tableau NON VIDE d'identifiants (chaînes) sans doublon. */
function lireListe(texte, option = '--seulement') {
    let a; try { a = JSON.parse(texte); } catch (e) { throw new Error(`${option} : fichier illisible (${String(e.message).slice(0, 100)})`); }
    if (!Array.isArray(a) || !a.length || !a.every(x => typeof x === 'string')) throw new Error(`${option} : le fichier doit être un tableau NON VIDE d'identifiants (un fichier vide ou mal formé ne protège rien)`);
    const dbl = a.filter((x, i) => a.indexOf(x) !== i);
    if (dbl.length) throw new Error(`${option} : doublon(s) (${[...new Set(dbl)].join(', ')})`);
    return new Set(a);
}

/** Décide ce qui s'écrit : exactement les « prête » de la liste. Rend { retenus, motif } — motif non nul = ARRÊT. */
function trancher({ plan, liste, attendu }) {
    const prets = new Set(plan.filter(r => r.statut === 'prete' && !r.hypothese).map(r => r.id));
    const hors = [...liste].filter(id => !prets.has(id));
    if (hors.length) return { retenus: null, motif: `${hors.length} identifiant(s) de la liste ne sont pas « prête » aujourd'hui (${hors.join(', ')}) — la liste ne correspond plus à l'état de la base` };
    const orphelines = plan.filter(r => liste.has(r.id) && (r.dependDe || []).some(id => !liste.has(id)));
    if (orphelines.length) return { retenus: null, motif: `${orphelines.map(r => r.id).join(', ')} dépend(ent) de la détache d'une ligne qui n'est pas dans la liste (${[...new Set(orphelines.flatMap(r => r.dependDe))].join(', ')}) : les deux s'écrivent ensemble ou aucune` };
    if (!Number.isInteger(attendu) || attendu !== liste.size) return { retenus: null, motif: `${liste.size} modification(s) prête(s) retenue(s), attendu ${attendu}` };
    return { retenus: liste, motif: null };
}

module.exports = { lancerEcriture, lancerRetour, DECISION, LIGNES, IMPRESSIONS, TOTAUX, idLigne, idImp, idTotal, jugerLigne, jugerImpression, jugerTotal, construireRetour, ecrire, revenir, lireListe, trancher, nomsDuProduit, entreesDeTitres };

// ───────────────────────── ligne de commande ─────────────────────────
async function principal() {
    const AUTORISES = [/^--ecrire$/, /^--hypothese-f3$/, /^--annonce=.+\.json$/, /^--liste=.+\.json$/, /^--preuves=.+\.json$/, /^--seulement=.+\.json$/, /^--attendu=\d+$/, /^--retour=.+\.json$/, /^--revenir=.+\.json$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrireOui = process.argv.includes('--ecrire'), hypothese = process.argv.includes('--hypothese-f3');
    const usage = '--annonce=<f>.json --liste=<f>.json --preuves=<f>.json [--hypothese-f3] (simulation) | --ecrire --seulement=<liste>.json --attendu=<N> --retour=<f>.json | --revenir=<retour>.json --ecrire';
    if (inconnus.length || (ecrireOui && hypothese) || (ecrireOui && !arg('revenir') && !(arg('seulement') && arg('attendu') && arg('retour'))) || (!ecrireOui && (arg('revenir') || !arg('annonce') || !arg('liste') || !arg('preuves')))) {
        console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}${ecrireOui && hypothese ? '--hypothese-f3 ne s\'écrit jamais — ' : ''}usage : ${usage}`); process.exit(2);
    }
    if (ecrireOui) { try { require('./collecte-cartes/phase2-visuels').garderSousLot(process.env, process.ppid, 'node lot-additif.js --quoi="…" --collections=cartes,cartes_produits,sets -- node corriger-f3.js … --ecrire'); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    require('dotenv').config();

    if (arg('revenir')) {
        const retour = JSON.parse(fs.readFileSync(arg('revenir'), 'utf8'));
        if (!retour || !Array.isArray(retour.modifications) || !retour.modifications.length) { console.error('❌ fichier de retour vide ou mal formé — rien n\'est écrit'); process.exit(2); }
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        await lancerRetour({ ouvrir: () => ouvrirConnexions({ buckets: [], production: false }), retour });
        return;
    }

    const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
    const { produitsDeLExpansion } = jointure();
    const { ouvrirLecture } = require('./audit-catalogue/lecture-audit');
    const b = await ouvrirLecture();
    const plan = [], cartesTouchees = new Map(), lignesExp = new Map();
    const ligneDeTable = slug => [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE].find(l => l.slugSet === slug && l.bulba);
    try {
        const cart = b.cartes.collection('cartes');
        const PROJ = { nomEn: 1, impressions: 1, sets: 1, images: 1, liens: 1, categorie: 1 };
        // a. la ligne
        for (const x of LIGNES) {
            const L = ligneDeTable(x.slugSet);
            if (!L) throw new Error(`${x.slugSet} : aucune ligne de table`);
            const produits = await produitsDeLExpansion({ db: b.prod }, L.exp);
            const carte = await cart.findOne({ _id: x.carteId }, { projection: PROJ });
            const lignesDuProduit = await b.cartes.collection('cartes_produits').find({ idProduct: x.idProduct }).toArray();
            plan.push(jugerLigne(x, {
                ligne: await b.cartes.collection('cartes_produits').findOne({ _id: x.id }), produit: produits.find(p => p.idProduct === x.idProduct), carte,
                cartesDuSet: await cart.find({ sets: x.slugSet }, { projection: { nomEn: 1, impressions: 1 } }).toArray(), lignesDuProduit,
                expansions: [].concat(L.bulba.expansion), tirage: L.bulba.tirage || 'jp'
            }));
            cartesTouchees.set(x.carteId, carte);
            lignesExp.set(L.exp, await b.cartes.collection('cartes_produits').find({ idExpansion: L.exp }).toArray());
        }
        // c. les impressions
        for (const d of IMPRESSIONS) {
            const L = ligneDeTable(d.slugFaux);
            if (!L || ![].concat(L.bulba.expansion).includes(d.faux.expansion) || (L.bulba.tirage || 'jp') !== d.faux.tirage) throw new Error(`${d.slugFaux} : la table ne dit pas « ${d.faux.expansion} » (${d.faux.tirage}) — décision incohérente avec la table`);
            const carte = await cart.findOne({ _id: d.carteId }, { projection: PROJ });
            const etat = await b.cartes.collection('collecte_etat').findOne({ _id: d.slugFaux });
            if (!etat || !(etat.titres || []).length) throw new Error(`${d.slugFaux} : collecte_etat sans titres`);
            const cartesFaux = new Map((await cart.find({ sets: d.slugFaux }, { projection: { nomEn: 1, impressions: 1 } }).toArray()).map(c => [c._id, c]));
            const produits = await produitsDeLExpansion({ db: b.prod }, L.exp);
            const images = await b.cartes.collection('images').find({ carteId: d.carteId, set: d.slugFaux }, { projection: { numero: 1, set: 1, carteId: 1 } }).toArray();
            const lignes = await b.cartes.collection('cartes_produits').find({ carteId: d.carteId, idExpansion: L.exp }).toArray();
            const lignesRetirees = new Set(plan.filter(r => r.type === 'ligne' && r.statut === 'prete').map(r => r.avant.ligne._id));
            plan.push(jugerImpression(d, { carte, cartesFaux, titres: etat.titres, pages: etat.pages || [], produits, images, lignes, hypothese, lignesRetirees }));
            cartesTouchees.set(d.carteId, carte);
        }
        // b. le total
        for (const d of TOTAUX) {
            const setDoc = await b.cartes.collection('sets').findOne({ _id: d.set }, { projection: { totalImprime: 1 } });
            const docsImages = new Map();
            for (const s of d.scans) { const doc = await b.cartes.collection('images').findOne({ _id: s.cle }, { projection: { set: 1, carteId: 1, numero: 1, total: 1, urlOriginal: 1, langue: 1 } }); if (doc) docsImages.set(s.cle, doc); }
            const totauxImpressions = {};
            for await (const c of cart.find({ sets: d.set }, { projection: { impressions: 1 } })) for (const i of c.impressions || []) if (i.tirage === 'jp' && i.expansion === 'Wind from the Sea') totauxImpressions[i.total] = (totauxImpressions[i.total] || 0) + 1;
            plan.push(jugerTotal(d, { setDoc, docsImages, totauxImpressions, fichiers: new Set(d.scans.filter(s => fs.existsSync(s.fichier) && fs.statSync(s.fichier).size > 0).map(s => s.fichier)) }));
        }
    } finally { await b.fermer(); }

    for (const r of plan) console.log(`${String(r.statut).padEnd(10)} ${r.id}${r.nom ? ` « ${r.nom} »` : ''}${r.hypothese ? ' [hypothèse f3]' : ''} · ${r.raison}`);
    const prets = plan.filter(r => r.statut === 'prete');
    const par = s => plan.filter(r => r.statut === s).length;
    console.log(`\n   ${prets.length} prête(s) sur ${plan.length} : ${['prete', 'attend', 'sortie', 'refus', 'deja-fait'].map(s => `${s} ${par(s)}`).join(' · ')}`);
    if (!ecrireOui) {
        // l'annonce : calculée par la fonction de la garde de lot, sur les documents avant / après
        const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
        const retenus = new Set(prets.map(r => r.id));
        const virt = (c, vrais) => ({ ...c, impressions: [...(c.impressions || []), ...vrais] });
        const avantCartes = [], apresCartes = [];
        for (const [id, c] of cartesTouchees) {
            const mods = plan.filter(r => r.carteId === id && r.type === 'impression' && retenus.has(r.id));
            const defs = IMPRESSIONS.filter(d => d.carteId === id);
            const vrais = hypothese ? defs.filter(d => mods.some(m => m.id === idImp(d)) && !(c.impressions || []).some(i => memeImp(i, d.vrai))).map(d => ({ tirage: d.vrai.tirage, expansion: d.vrai.expansion, numero: d.vrai.numero, total: null, deck: null, rarete: null, source: 'setlist' })) : [];
            const av = virt(c, vrais);
            const retire = mods.map(m => m.avant.impression);
            const ap = { ...av, impressions: av.impressions.filter(i => !retire.some(f => memeImp(i, f))) };
            avantCartes.push(av); apresCartes.push(ap);
        }
        const retiresLignes = new Set(prets.filter(r => r.type === 'ligne').map(r => r.avant.ligne._id));
        const toutesAvant = [...lignesExp.values()].flat();
        const cmp = comparer(compterEtat({ cartes: avantCartes, cartesProduits: toutesAvant }), compterEtat({ cartes: apresCartes, cartesProduits: toutesAvant.filter(l => !retiresLignes.has(l._id)) }));
        const annonce = Object.fromEntries(cmp.baisses.map(x => [x.cle, x.baisse]));
        fs.writeFileSync(arg('annonce'), JSON.stringify(annonce, null, 1));
        fs.writeFileSync(arg('liste'), JSON.stringify(prets.filter(r => !r.hypothese).map(r => r.id)));
        fs.writeFileSync(arg('preuves'), JSON.stringify({ decision: DECISION, hypotheseF3: hypothese, luLe: new Date().toISOString(), plan }, null, 1));
        console.log(`   annonce (baisses que la garde verra) : ${JSON.stringify(annonce)} · hausses ${JSON.stringify(cmp.hausses)}\n   annonce : ${arg('annonce')}\n   liste (prêtes, hors hypothèse) : ${arg('liste')}\n   preuves : ${arg('preuves')}\n   (simulation — rien n'est écrit en base)`);
        return;
    }
    const liste = lireListe(fs.readFileSync(arg('seulement'), 'utf8'));
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    try {
        const R = await lancerEcriture({ ouvrir: () => ouvrirConnexions({ buckets: [], production: false }), plan, liste, attendu: Number(arg('attendu')), fichierRetour: arg('retour') });
        if (R.relu !== R.attendu) process.exitCode = 1;
    } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
}
if (require.main === module) principal().catch(x => { console.error('❌', String(x.message || x).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
