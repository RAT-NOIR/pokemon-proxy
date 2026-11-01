// ============================================================
// POSER LES « VRAIS TROUS » DE LA FAMILLE f3 : le produit Cardmarket existe, la carte aussi, le NUMÉRO que la page de la carte déclare diffère de celui de la Setlist (2026-11-01)
// ============================================================
//   node poser-trous-setlist.js --produits=<id,id,…> [--liste=<f>.json]                      (simulation : ce qui serait joint, produit par produit, avec sa preuve)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-trous-setlist.js --produits=<ids> --seulement=<f>.json --attendu=<N> --ecrire
//
// 🔴 LA CAUSE, MESURÉE SUR 12 PRODUITS (Double Blaze, Super-Burst Impact, Nihil Zero, Gaia Volcano, Tidal Storm…) : la page Bulbapedia d'une carte déclare UN numéro (« 089/095 »)
// qui est parfois celui de sa voisine, ou d'un autre set (Primal Kyogre-EX Tidal Storm 073 déclaré « Gaia Volcano »). `joindre()` ne regarde que les impressions DÉCLARÉES quand
// la carte en a une : le numéro de la Setlist (« Dust Island (Double Blaze 90) »), que Cardmarket partage (« 090 »), n'est jamais essayé. Les impressions « setlist » virtuelles
// n'existent que pour les lignes à `numerosDepuisSetlist` (chinois). Ici on les essaie pour UN produit à la fois, et on ne retient que ce que la production elle-même confirme.
//
// 🔑 LA PREUVE EST CELLE DE LA PRODUCTION, PAS UNE COPIE : l'impression virtuelle vient de `impressionsDepuisSetlist` (jointure.js), la ligne de `joindre()` — donc le TÉMOIN DU NOM
// (`temoinDuNom`, dans joindre) juge chaque couple —, la seconde source de `juger` (deux-sources.js : Cardmarket pour UNE, Bulbapedia ne compte pas, la liste admise est fermée).
// Une garde s'écrit par ce qu'elle autorise : « joignable » est le SEUL état qui écrit, il exige (1) UN seul candidat de Setlist, (2) UNE seule ligne de joindre() vers CE candidat,
// (3) une source indépendante concordante sur le set, le numéro ET le nom. Tout le reste est nommé et n'écrit rien.
// ➕ L'impression « setlist » est ÉCRITE sur la carte (comme poser-impressions-setlist.js, même `source`) : sans elle, un rejeu de joindre() (`--reparser`) ne refabrique pas la ligne.
const fs = require('fs');
const { joindre, impressionsDepuisSetlist, cleNumero, decomposerNomCardmarket, normaliserNom } = require('./collecte-cartes/jointure');
const { juger } = require('./collecte-cartes/deux-sources');

/** « Dust Island (Double Blaze 90) » → { forme:'tcg-id', a:'Double Blaze', b:'90' } : les titres que la collecte a construits depuis les TCG ID de la Setlist. */
function entreesDeTitres(titres) {
    const out = [];
    for (const titre of titres || []) {
        const m = /^(.*) \((.+) (\S+)\)$/.exec(titre);
        if (m) out.push({ titre, forme: 'tcg-id', a: m[2], b: m[3] });
    }
    return out;
}

const memeImpression = (i, cible, N) => {
    const noms = [].concat(cible.expansionBulba);
    return i.tirage === cible.tirage && noms.includes(i.expansion) && (!cible.deck || i.deck === cible.deck) && i.numero != null && cleNumero(String(i.numero)) === cleNumero(String(N));
};

/**
 * PUR : de quoi décider, rend un verdict par produit demandé. Rien n'est lu en base ici.
 * @param {{slugSet: string, cible: object, cartes: object[], produits: object[], titres: string[], pages: object[], images: object[], existantes: Map<number, number[]>, cibles: number[], relevesTcgdex?: Map<number, object[]>, interdites?: Set<string>}} e
 * @returns {object[]} un objet par produit : { idProduct, statut, … } ; `joignable` et `impression-seule` sont les seuls statuts qui écrivent.
 */
function planifier(e) {
    const { slugSet, cible, cartes, produits, titres, pages, images = [], existantes, cibles, relevesTcgdex = new Map(), interdites = new Set() } = e;
    const entrees = entreesDeTitres(titres);
    const V = impressionsDepuisSetlist(entrees, pages, cible);
    const out = [];
    for (const idProduct of cibles) {
        const r = { idProduct, statut: null, raison: null };
        out.push(r);
        const p = produits.find(x => x.idProduct === idProduct);
        if (!p) { r.statut = 'produit-absent'; r.raison = `le produit ${idProduct} n'est pas dans l'expansion ${cible.idExpansion} (catalogue)`; continue; }
        const N = p.numero;
        Object.assign(r, { nom: p.name, numero: N });
        if (N == null || String(N).trim() === '') { r.statut = 'sans-numero'; r.raison = 'le produit Cardmarket n\'a pas de numéro : la Setlist n\'a rien à confirmer'; continue; }
        const dejaLignes = existantes.get(idProduct) || [];
        // les candidats : les cartes que la SETLIST range à ce numéro dans CE set (jeton du set — une réimpression listée ne compte pas)
        const candidats = cartes.filter(c => (V.parCarte.get(c._id) || []).some(i => cleNumero(String(i.numero)) === cleNumero(String(N))));
        r.candidats = candidats.map(c => c._id);
        if (!candidats.length) { r.statut = dejaLignes.length ? 'deja-joint' : 'sans-titre-setlist'; r.raison = dejaLignes.length ? 'déjà joint, la Setlist ne range aucune carte à ce numéro' : `aucune entrée de la Setlist de ${slugSet} au n°${N}`; continue; }
        if (candidats.length > 1) { r.statut = 'setlist-ambigu'; r.raison = `${candidats.length} cartes à ce numéro dans la Setlist (${r.candidats.join(', ')}) : un numéro qui désigne plusieurs cartes ne désigne rien`; continue; }
        const c = candidats[0];
        r.carteId = c._id; r.nomCarte = c.nomEn;
        if ((c.impressions || []).some(i => memeImpression(i, cible, N))) {
            r.statut = dejaLignes.includes(c._id) ? 'deja-joint' : 'impression-deja-presente';
            r.raison = dejaLignes.includes(c._id) ? 'la carte porte déjà ce numéro et la ligne existe' : 'ANOMALIE : la carte porte déjà ce numéro et joindre() ne l\'a pas jointe — à instruire à la main';
            continue;
        }
        if (dejaLignes.length && !dejaLignes.includes(c._id)) { r.statut = 'joint-ailleurs'; r.raison = `le produit est déjà joint à ${dejaLignes.join(', ')}, la Setlist range la carte ${c._id} : désaccord, rien n'est écrit`; continue; }
        // la seconde source : artofpkm (document `images` de CETTE carte dans CE set) + TCGdex local (lien produit direct). Cardmarket = la première.
        const releves = images.filter(d => d.source === 'artofpkm' && d.etat === 'ok' && d.set === slugSet && d.carteId === c._id && d.numero != null)
            .map(d => ({ source: 'artofpkm', set: slugSet, numero: d.numero, nom: d.nomEn ?? null, ref: d._id }));
        for (const t of relevesTcgdex.get(idProduct) || []) releves.push(t);
        const dec = decomposerNomCardmarket(p.name);
        let J2 = juger({ set: slugSet, numero: N, nom: dec.nom }, releves);
        // « Drifblim [FB] Lv.50 [...] » : le groupe [FB] est le SUFFIXE du nom chez Bulbapedia (« Drifblim FB ») — la même lecture que joindre() fait des attaques. Seulement si le produit porte
        // explicitement ce groupe (1 à 3 capitales/chiffres) ET que la carte s'appelle exactement « <nom> <groupe> » : jamais une inclusion (« Mew » / « Mewtwo »).
        if (!J2.ok) {
            const g = /\[([A-Z0-9]{1,3})\]/.exec(p.name);
            if (g && c.nomEn && normaliserNom(c.nomEn) === normaliserNom(`${dec.nom} ${g[1]}`)) J2 = juger({ set: slugSet, numero: N, nom: c.nomEn }, releves);
        }
        r.sources = J2.sources; r.concordantes = J2.concordantes; r.refusees = J2.refusees;
        // l'impression que la Setlist donne à CETTE carte à CE numéro, écrite comme Cardmarket l'imprime
        const impSetlist = (V.parCarte.get(c._id) || []).find(i => cleNumero(String(i.numero)) === cleNumero(String(N)));
        const impression = { tirage: cible.tirage, expansion: [].concat(cible.expansionBulba)[0], numero: String(N), total: null, deck: null, rarete: null, source: 'setlist' };
        r.impression = impression;
        if (!J2.ok) { r.statut = 'une-seule-source'; r.raison = J2.raison; continue; }
        if (dejaLignes.includes(c._id)) { r.statut = 'impression-seule'; r.raison = 'la ligne existe (jointe par le nom) ; seule l\'impression manque sur la carte'; continue; }
        // joindre() de PRODUCTION, la carte candidate seule augmentée de l'impression virtuelle : le témoin du nom juge
        const cartesAug = cartes.map(x => x._id === c._id ? { ...x, impressions: [...(x.impressions || []), { ...impSetlist, source: 'setlist' }] } : x);
        const J = joindre(cartesAug, produits, { ...cible, lignesInterdites: interdites });
        const siennes = J.lignes.filter(l => l.idProduct === idProduct);
        if (!siennes.length) {
            const reste = J.restes.find(x => x.idProduct === idProduct);
            r.statut = 'refuse-par-joindre'; r.raison = reste ? `joindre() refuse : ${reste.type} — ${reste.detail}` : 'joindre() ne propose aucune ligne'; continue;
        }
        if (siennes.some(l => l.carteId !== c._id)) { r.statut = 'contradiction'; r.raison = `joindre() propose ${siennes.map(l => l.carteId).join(', ')}, la Setlist dit ${c._id}`; continue; }
        if (siennes.length > 1) { r.statut = 'plusieurs-lignes'; r.raison = `${siennes.length} lignes proposées pour un produit`; continue; }
        // l'impression ajoutée ne doit déclencher AUCUNE autre ligne que celles qu'on a demandées : un lot annonce ce qu'il écrit
        const derive = J.lignes.filter(l => l.idProduct !== idProduct && !cibles.includes(l.idProduct) && !(existantes.get(l.idProduct) || []).includes(l.carteId)).map(l => l._id);
        if (derive.length) { r.statut = 'derive'; r.derive = derive; r.raison = `l'impression poserait aussi ${derive.length} ligne(s) non demandée(s) : ${derive.slice(0, 4).join(', ')}`; continue; }
        r.statut = 'joignable'; r.ligne = siennes[0];
        r.raison = `Setlist n°${N} → carte ${c._id} « ${c.nomEn} » ; deuxième source : ${J2.concordantes.map(x => x.source).join(', ')} ; témoin du nom muet`;
    }
    return out;
}

/**
 * L'ÉCRITURE — ADDITIVE : l'impression est POUSSÉE (jamais d'une carte qui la porte déjà), la ligne est posée par upsert (`_id` déterministe), les liens de la carte sont AJOUTÉS ($addToSet).
 * Aucun $unset, $pull ni suppression : le banc relève les opérateurs. Ne touche QUE les produits de `retenus` ET au statut qui écrit.
 */
async function ecrire({ db, plan, retenus, log = console.log, err = console.error }) {
    let lignes = 0, impressions = 0, attendues = 0;
    for (const r of plan) {
        if (!retenus.has(r.idProduct) || !['joignable', 'impression-seule'].includes(r.statut)) continue;
        attendues++;
        const i = r.impression;
        const m = await db.collection('cartes').updateOne({ _id: r.carteId, impressions: { $not: { $elemMatch: { tirage: i.tirage, expansion: i.expansion, numero: i.numero } } } }, { $push: { impressions: i } });
        impressions += m.modifiedCount || 0;
        if (r.ligne) {
            await db.collection('cartes_produits').updateOne({ _id: r.ligne._id }, { $setOnInsert: r.ligne }, { upsert: true });
            await db.collection('cartes').updateOne({ _id: r.carteId }, { $addToSet: { 'liens.idProduct': r.idProduct } });
            lignes++;
        }
    }
    log(`   ÉCRIT : ${lignes} ligne(s) · ${impressions} impression(s) « setlist » poussée(s) · ${attendues} produit(s) traité(s)`);
    return { lignes, impressions, traites: attendues };
}

/** Le clone TCGdex est une SECONDE SOURCE : sans lui la liste se régénère plus courte. Absent, illisible ou vide, il LÈVE (jamais un avertissement). */
function chargerClone(chemin, charger = require) {
    if (!chemin) throw new Error('--clone=<clone.js> est obligatoire (la seconde source TCGdex des Énergies) : sans lui la liste serait plus courte');
    let m;
    try { m = charger(chemin); } catch (x) { throw new Error(`--clone illisible (${x.message})`); }
    if (!m || typeof m.lireClone !== 'function') throw new Error('--clone : le module n\'exporte pas lireClone');
    const c = m.lireClone();
    if (!c || !Array.isArray(c.cartes) || !c.cartes.length) throw new Error('--clone vide : 0 carte lue (clone absent ou mal placé)');
    return c;
}

// (principal est défini plus bas ; exporté en fin de fichier pour le banc)

// ───────────────────────── ligne de commande ─────────────────────────
async function principal(deps = {}) {
    if (!deps.argv) require('dotenv').config();
    const LOT = require('./collecte-cartes/lot-seulement');
    const AUTORISES = [/^--ecrire$/, /^--produits=\d+(,\d+)*$/, /^--seulement=.+\.json$/, /^--liste=.+\.json$/, /^--attendu=\d+$/, /^--clone=.+$/];
    const ARGV = deps.argv || process.argv.slice(2);
    const inconnus = ARGV.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --produits=<ids>, --liste=<f>.json, --seulement=<f>.json, --attendu=<N>, --clone=<clone.js>, --ecrire`); process.exit(2); }
    const arg = n => ARGV.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrireOui = ARGV.includes('--ecrire');
    if (!arg('produits')) { console.error('❌ --produits=<id,id,…> est obligatoire (un lot nomme ses produits)'); process.exit(2); }
    const cibles = arg('produits').split(',').map(Number);
    let SEULEMENT = null;
    if (arg('seulement')) { try { SEULEMENT = LOT.lireFichier('--seulement', arg('seulement')); } catch (x) { console.error(`❌ ${x.message} — rien n'est écrit`); process.exit(2); } }
    if (ecrireOui && (!SEULEMENT || !arg('attendu'))) { console.error('❌ --ecrire exige --seulement=<liste>.json (écrite par la simulation) ET --attendu=<N> — rien n\'est écrit'); process.exit(2); }

    const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
    const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
    const ouvrirLecture = deps.ouvrirLecture || require('./audit-catalogue/lecture-audit').ouvrirLecture;
    const b = await ouvrirLecture();          // LECTURE : utilisateurs de lecture (jamais MONGODB_URI ni MONGODB_CARTES_URI)
    let plan = [];
    const cartesParId = new Map();
    try {
        const nc = await b.prod.collection('catalogue_produits').find({ idProduct: { $in: cibles } }, { projection: { idProduct: 1, idExpansion: 1 } }).toArray();
        const parExp = new Map(); for (const x of nc) (parExp.get(x.idExpansion) || parExp.set(x.idExpansion, []).get(x.idExpansion)).push(x.idProduct);
        const clone = chargerClone(arg('clone'), deps.charger);
        for (const [exp, ids] of parExp) {
            const L = [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE].find(l => l.exp === exp && l.slugSet && l.bulba);
            if (!L) { for (const id of ids) plan.push({ idProduct: id, statut: 'set-sans-ligne', raison: `aucune ligne de table pour l'expansion ${exp}` }); continue; }
            const slugSet = L.slugSet;
            const cible = { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, suffixesParDeck: L.bulba.suffixesParDeck || null, prefixesParDeck: L.bulba.prefixesParDeck || null, prefixesParJeton: L.bulba.prefixesParJeton || null, prefixesParSection: L.bulba.prefixesParSection || null, tirage: L.bulba.tirage || 'jp', slugSet };
            const cartes = await b.cartes.collection('cartes').find({ sets: slugSet }).toArray();
            if (!cartes.length) throw new Error(`${slugSet} : 0 carte (clé fausse ?)`);
            const produits = await produitsDeLExpansion({ db: b.prod }, L.exp);
            const etat = await b.cartes.collection('collecte_etat').findOne({ _id: slugSet });
            if (!etat || !etat.titres || !etat.titres.length) throw new Error(`${slugSet} : collecte_etat sans titres`);
            const images = await b.cartes.collection('images').find({ set: slugSet, source: 'artofpkm' }, { projection: { carteId: 1, numero: 1, nomEn: 1, set: 1, source: 1, etat: 1 } }).toArray();
            const lignes = await b.cartes.collection('cartes_produits').find({ idExpansion: L.exp }, { projection: { carteId: 1, idProduct: 1 } }).toArray();
            const existantes = new Map(); for (const l of lignes) (existantes.get(l.idProduct) || existantes.set(l.idProduct, []).get(l.idProduct)).push(l.carteId);
            const relevesTcgdex = new Map();
            for (const id of ids) {
                const hits = clone.cartes.filter(x => x.cardmarket.includes(id));
                relevesTcgdex.set(id, hits.map(x => ({ source: 'tcgdex', set: slugSet, numero: x.localId, nom: x.noms.en ?? null, ref: `${x.famille}/${x.setId}/${x.localId}`, ja: x.noms.ja ?? null })));
            }
            for (const c of cartes) cartesParId.set(c._id, c);
            console.log(`\n── ${slugSet} (exp ${L.exp}) : ${cartes.length} cartes · ${produits.length} produits · ${etat.titres.length} titres · ${images.length} images artofpkm · ${lignes.length} lignes`);
            plan.push(...planifier({ slugSet, cible, cartes, produits, titres: etat.titres, pages: etat.pages || [], images, existantes, cibles: ids, relevesTcgdex }));
        }
    } finally { await b.fermer(); }

    plan.sort((x, y) => cibles.indexOf(x.idProduct) - cibles.indexOf(y.idProduct));
    for (const r of plan) console.log(`${String(r.statut).padEnd(24)} ${r.idProduct} « ${r.nom ?? ''} » n°${r.numero ?? '—'}${r.carteId ? ` → carte ${r.carteId}` : ''} · ${r.raison ?? ''}`);
    const ecrivables = plan.filter(r => ['joignable', 'impression-seule'].includes(r.statut));
    console.log(`\n   ${ecrivables.length} produit(s) écrivable(s) sur ${plan.length} demandés : ${ecrivables.filter(r => r.statut === 'joignable').length} ligne(s) + impression, ${ecrivables.filter(r => r.statut === 'impression-seule').length} impression(s) seule(s)`);
    // le contrôle de la garde de lot, par SA fonction : un ajout ne fait baisser aucun compteur (comme poser-impressions-setlist.js)
    {
        const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
        const touchees = [...new Set(ecrivables.map(r => r.carteId))].map(id => cartesParId.get(id));
        const apres = touchees.map(c => ({ ...c, impressions: [...(c.impressions || []), ...ecrivables.filter(r => r.carteId === c._id).map(r => r.impression)] }));
        const cmp = comparer(compterEtat({ cartes: touchees }), compterEtat({ cartes: apres }));
        console.log(`   garde (simulée, ${touchees.length} cartes touchées) : baisses ${cmp.baisses.length} · hausses ${JSON.stringify(cmp.hausses)}`);
        if (cmp.baisses.length) { console.error('🔴 ARRÊT : un ajout ne doit rien faire baisser.'); process.exit(1); }
    }
    if (arg('liste')) { fs.writeFileSync(arg('liste'), JSON.stringify(ecrivables.map(r => r.idProduct))); console.log(`   liste écrite : ${arg('liste')}`); }
    if (!ecrireOui) { console.log('\n   (simulation — rien n\'est écrit ; --ecrire, sous lot-additif.js, avec --seulement=<liste> et --attendu=<N>)'); return; }

    const retenus = ecrivables.filter(r => SEULEMENT.has(r.idProduct));
    const hors = [...SEULEMENT].filter(id => !ecrivables.some(r => r.idProduct === id));
    if (hors.length) { console.error(`❌ ARRÊT : ${hors.length} idProduct de --seulement ne sont pas écrivables aujourd'hui (${hors.join(', ')}) — la liste ne correspond plus à l'état de la base, rien n'est écrit`); process.exit(1); }
    const v = LOT.verifierAttendu({ retenus: retenus.length, attendu: Number(arg('attendu')) });
    if (!v.ok) { console.error(`❌ ARRÊT : ${v.motif} — rien n'est écrit`); process.exit(1); }
    const ouvrirConnexions = deps.ouvrirConnexions || require('./collecte-cartes/garde').ouvrirConnexions;
    // 🔴 la FORME RÉELLE de ouvrirConnexions (collecte-cartes/garde.js) : { cartes: <Connection mongoose>, prod, fermer } — la base est `cx.cartes.db`, JAMAIS `cx.db`
    const cx = await ouvrirConnexions({ buckets: [], production: false });
    const dbCartes = cx && cx.cartes && cx.cartes.db;
    if (!dbCartes || typeof dbCartes.collection !== 'function') { if (cx && cx.fermer) await cx.fermer(); throw new Error('ouvrirConnexions n\'a pas rendu { cartes: { db } } — rien n\'est écrit'); }
    try {
        const R = await ecrire({ db: dbCartes, plan, retenus: SEULEMENT });
        // RELECTURE : chaque ligne et chaque impression écrites sont relues sur la base
        let relu = 0;
        for (const r of retenus) {
            const c = await dbCartes.collection('cartes').findOne({ _id: r.carteId }, { projection: { impressions: 1 } });
            const impOk = (c.impressions || []).some(i => i.source === 'setlist' && i.expansion === r.impression.expansion && cleNumero(String(i.numero)) === cleNumero(String(r.numero)));
            const ligOk = !r.ligne || !!(await dbCartes.collection('cartes_produits').findOne({ _id: r.ligne._id }));
            if (impOk && ligOk) relu++;
        }
        console.log(`   RELECTURE : ${relu}/${retenus.length} produits retrouvés (impression + ligne)`);
        if (relu !== retenus.length || R.traites !== retenus.length) { console.error('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); process.exitCode = 1; }
    } finally { await cx.fermer(); }
}
module.exports = { planifier, entreesDeTitres, ecrire, chargerClone, principal };
if (require.main === module) principal().catch(x => { console.error('❌', x.message); process.exit(1); });
