// ============================================================
// LE NOM SEUL, REJOUÉ SUR CE QUI MARCHE — le contrôle d'admission des expansions SANS numéro
// ============================================================
//   node rejouer-nom-seul.js
// Lecture seule. Rend, sur les jointures faites par le NUMÉRO, ce que la jointure de PRODUCTION aurait fait
// si les numéros n'existaient pas — des deux côtés : les impressions des cartes ET les produits Cardmarket.
//
// 🔑 POURQUOI `joindre()` ET PAS UNE CLÉ RÉÉCRITE : la calibration du 2026-09-21 (§48, 82 faux, 99,72 %)
// lisait le nom Cardmarket dans `numeros_cartes.nomEn`, quand la production le lit dans
// `catalogue_produits.name` passé par `decomposerNomCardmarket` — et elle n'appliquait NI le départage par
// les attaques, NI la garde « un nom qui désigne plusieurs cartes ne désigne rien ». Une sonde qui lit
// autre chose que la production fabrique le défaut qu'elle mesure (en tête du catalogue). Ici, la
// production elle-même tourne, numéros masqués : c'est EXACTEMENT la situation d'un set sans numéro.
//
// PUIS DEUX FILTRES, ÉNONCÉS AVANT D'AVOIR VU LE RÉSULTAT (règle du testeur, 2026-09-23) :
//   1. la garde BIDIRECTIONNELLE, multiplicités COMPTÉES (§34, jamais de `Set`) : une ligne n'est gardée
//      que si son produit est le SEUL produit de l'expansion à porter ce nom, ET sa carte la SEULE carte
//      du set à le porter ;
//   2. les sets de RÉIMPRESSIONS exclus. Définition posée d'avance, structurelle, sans seuil réglable :
//      un set dont la MAJORITÉ des cartes porte une impression du MÊME tirage dans une AUTRE expansion.
//      « La majorité » est le constat de structure du §31 (LED), pas un réglage — on ne le bouge pas.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { joindre, produitsDeLExpansion } = require('./collecte-cartes/jointure');
const { gardeNomSeul } = require('./collecte-cartes/garde-nom-seul');
const { ligne } = require('./collecte-cartes/table-sets');
const pad = (v, n) => String(v).padStart(n);

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const verite = await lireMongo(cx.db.collection('cartes_produits'), { preuve: { $in: ['set+numero', 'setlist+numero'] } },
        { nom: 'cartes_produits (par le numéro)', projection: { idProduct: 1, carteId: 1, slugSet: 1, idExpansion: 1 } });
    champSur(verite, 'idExpansion', { collection: 'cartes_produits' });
    // la vérité par produit — un produit rattaché à plusieurs cartes n'est pas une vérité (§32), il sort
    const cartesDuProduit = new Map();
    for (const l of verite) (cartesDuProduit.get(l.idProduct) || cartesDuProduit.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);
    const vraie = new Map([...cartesDuProduit].filter(([, s]) => s.size === 1).map(([p, s]) => [p, [...s][0]]));
    const setsAvecVerite = [...new Set(verite.map(l => l.slugSet).filter(Boolean))];

    const sets = await lireMongo(cx.db.collection('sets'), { _id: { $in: setsAvecVerite } }, { nom: 'sets', projection: { code: 1 } });
    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, attaques: 1, impressions: 1, sets: 1 } });
    const parId = new Map(cartes.map(c => [c._id, c]));
    console.log(`\n════ DÉNOMINATEUR : ${verite.length} lignes jointes par le numéro · ${vraie.size} produits à une seule carte (la vérité) · ${sets.length} sets ════`);

    const bruit = console.log;
    const T = { justes: 0, fausses: 0, muettes: 0, gardeRefuse: 0, justesGardees: 0, faussesGardees: 0, exclusReimpr: 0 };
    const fausses = [], exclus = [], parSetFaux = new Map();
    for (const S of sets) {
        const L = ligne(S.code);
        if (!L || !L.exp) continue;
        const tirage = L.bulba?.tirage || 'jp';
        const noms = [].concat(L.bulba?.expansion || []);
        // les cartes du set : celles que la collecte a amenées (cartes.sets), comme en production
        const duSet = cartes.filter(c => (c.sets || []).includes(S._id));
        if (!duSet.length) continue;
        // ── RÉIMPRESSIONS : la majorité des cartes porte une impression du même tirage ailleurs
        const reimpr = duSet.filter(c => (c.impressions || []).some(i => i.tirage === tirage && !noms.includes(i.expansion))).length;
        const estReimpr = reimpr * 2 > duSet.length;
        console.log = () => {};
        let produits;
        try { produits = await produitsDeLExpansion(prod, L.exp); } finally { console.log = bruit; }
        // ── LES NUMÉROS MASQUÉS, des deux côtés
        const cartesSansNum = duSet.map(c => ({ ...c, impressions: (c.impressions || []).map(i => (i.tirage === tirage && noms.includes(i.expansion)) ? { ...i, numero: null } : i) }));
        const produitsSansNum = produits.map(p => ({ ...p, numero: null }));
        console.log = () => {};
        let J;
        try { J = joindre(cartesSansNum, produitsSansNum, { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, suffixesParDeck: L.bulba.suffixesParDeck || null, prefixesParDeck: L.bulba.prefixesParDeck || null, prefixesParJeton: L.bulba.prefixesParJeton || null, prefixesParSection: L.bulba.prefixesParSection || null, tirage, slugSet: S._id }); }
        finally { console.log = bruit; }
        // ── multiplicités COMPTÉES, des deux côtés : la garde de la collecte, la même fonction (collecte-cartes/garde-nom-seul.js)
        const gardes = new Set(gardeNomSeul({ lignes: J.lignes, produits, cartes: duSet }).gardees.map(l => l.idProduct));
        const parProduit = new Map();
        for (const l of J.lignes) (parProduit.get(l.idProduct) || parProduit.set(l.idProduct, []).get(l.idProduct)).push(l.carteId);
        const dansVerite = produits.filter(p => vraie.has(p.idProduct));
        for (const p of dansVerite) {
            const v = vraie.get(p.idProduct);
            const rendus = parProduit.get(p.idProduct) || [];
            if (!rendus.length) { T.muettes++; continue; }
            const juste = rendus.length === 1 && rendus[0] === v;
            if (juste) T.justes++; else T.fausses++;
            const c = parId.get(rendus[0]);
            const bidir = gardes.has(p.idProduct);
            if (!bidir) { T.gardeRefuse++; continue; }
            if (estReimpr) { T.exclusReimpr++; continue; }
            if (juste) T.justesGardees++;
            else {
                T.faussesGardees++;
                parSetFaux.set(S._id, (parSetFaux.get(S._id) || 0) + 1);
                if (fausses.length < 40) fausses.push(`${S._id} · produit ${p.idProduct} « ${p.nom} »${p.attaques?.length ? ' [' + p.attaques.join(' | ') + ']' : ''} → carte ${rendus[0]} « ${c?.nomEn} » · le numéro disait ${v} « ${parId.get(v)?.nomEn} »`);
            }
        }
        if (estReimpr) exclus.push(`${S._id} (${reimpr}/${duSet.length})`);
    }
    const parle = T.justes + T.fausses;
    console.log(`\n════ LA JOINTURE DE PRODUCTION, NUMÉROS MASQUÉS ════`);
    console.log(`   parle ${parle} fois : ${T.justes} justes · 🔴 ${T.fausses} fausses (précision ${(100 * T.justes / (parle || 1)).toFixed(2)} %) · se tait ${T.muettes} fois`);
    console.log(`\n════ PUIS LA GARDE BIDIRECTIONNELLE (multiplicités comptées) ET L'EXCLUSION DES RÉIMPRESSIONS ════`);
    console.log(`   refusées par la garde bidirectionnelle : ${T.gardeRefuse}`);
    console.log(`   écartées comme set de réimpressions    : ${T.exclusReimpr} — ${exclus.length} sets : ${exclus.slice(0, 30).join(' · ')}${exclus.length > 30 ? ' …' : ''}`);
    console.log(`   ✅ gardées JUSTES : ${T.justesGardees}`);
    console.log(`   🔴 gardées FAUSSES : ${T.faussesGardees}${T.faussesGardees ? '' : '  — ZÉRO faux affirmé'}`);
    if (T.faussesGardees) {
        console.log(`   par set : ${[...parSetFaux].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
        for (const f of fausses) console.log(`      ${f}`);
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
