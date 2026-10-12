// ============================================================
// CORRIGER LES `numeroFiche` QUI NE DÉSIGNENT AUCUNE IMPRESSION DE LEUR CARTE (T7a, 2026-10-12)
// ============================================================
//   node corriger-numero-fiche.js                      (MESURE : lecture seule, zéro écriture)
//   node lot-additif.js --quoi="T7a : numeroFiche = numéro de l'impression" --collections=cartes_produits -- node corriger-numero-fiche.js --ecrire --attendu=<N>
//
// POURQUOI : le site place un produit par `numeroFiche` (lib/cardmarket.ts, placementParNumeroFiche) ; un numéro qui ne désigne aucune
// impression numérotée de la carte dans le set rend `sans-fiche` : le produit est DÉTACHÉ de sa fiche. creer-sets-sans-page.js
// (ligne `numeroFiche: …`, avant le correctif T7a) recopiait le numéro Cardmarket (« 007L », « G002 ») sur des cartes déclarantes
// dont l'impression porte « 007 » / « 002 ». Le correctif de l'écrivain est dans collecte-cartes/numero-fiche.js ; cet outil répare les lignes déjà écrites.
//
// 🔑 ÉCRIT PAR CE QU'IL AUTORISE. Une ligne n'est réécrite que si TOUT ceci est vrai :
//   1. son numeroFiche ne désigne AUCUNE impression numérotée de sa carte dans son set (règle du site, numeroComparable) ;
//   2. la FORME qui relie le numéro Cardmarket au numéro d'impression est dans la liste fermée (préfixe de lettres, lettre finale de deck)
//      et se CALIBRE sur le set entier : une seule forme pour TOUTES les lignes en défaut du set, sinon le set n'est pas réparé, il est listé ;
//   3. cette forme désigne UNE seule impression de la carte ;
//   4. la jointure existante est indépendante du numéro (preuve ∈ PREUVES_ADMISES : la ligne désignait déjà cette carte) ;
//   5. le nom du produit Cardmarket (catalogue_produits, lecture seule) ne désigne pas une AUTRE carte du set (temoinDuNom de jointure.js).
// Il ne modifie QUE `cartes_produits.numeroFiche`, et refuse d'écrire si le plan ne rend pas --attendu.
const PREUVES_ADMISES = ['carte-declarante', 'metacarte+nom+attaques'];
const T0_COMPTE = 105;   // le relevé de T0 (normaliserNumero, sans la coupure de parenthèse du site) : voir RAPPORT

const { numeroComparable, CAS_COMPARABLE, numerosDuSet, enDefaut, calibrerForme, numeroReparé } = require('./collecte-cartes/numero-fiche');
const { temoinDuNom, decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const { CHAMP_DECK } = require('./collecte-cartes/set-deck');
// La projection des sets lus : le DECK en fait partie (T4b fix1) — un set deck ne lit que les numéros de son deck (numerosDuSet), pas ceux des decks frères.
const PROJECTION_SETS = { tirage: 1, region: 1, 'bulba.expansion': 1, [CHAMP_DECK]: 1 };

/**
 * Le PLAN, sans aucune connexion. @param {{lignes, sets: Map, cartes: Map, nomsProduits: Map<number,string>, cartesDuSet: Map<string, object[]>}} o
 * @returns {{denominateur, enDefaut, parSet: object[], reparations: object[], refus: object[]}}
 */
function planifier({ lignes, sets, cartes, nomsProduits, cartesDuSet }) {
    const den = { lignesAvecNumeroFiche: lignes.length, sansImpressionNumerotee: 0, justes: 0, enDefaut: 0 };
    const fautives = new Map();
    for (const l of lignes) {
        const set = sets.get(l.slugSet), carte = cartes.get(l.carteId);
        if (!set || !carte) { den.sansImpressionNumerotee++; continue; }
        const numeros = numerosDuSet(carte.impressions, set);
        if (!numeros.length) { den.sansImpressionNumerotee++; continue; }
        if (!enDefaut(l.numeroFiche, numeros)) { den.justes++; continue; }
        den.enDefaut++;
        (fautives.get(l.slugSet) || fautives.set(l.slugSet, []).get(l.slugSet)).push({ l, carte, numeros });
    }
    if (den.enDefaut === 0) throw new Error(`aucune ligne en défaut sur ${lignes.length} alors que le relevé de T0 en compte ${T0_COMPTE} : un instrument cassé rend zéro (§41) — la sonde est à ouvrir, pas la donnée`);
    const parSet = [], reparations = [], refus = [];
    for (const [slug, ls] of fautives) {
        const { forme, raison } = calibrerForme(ls.map(x => ({ numeroFiche: x.l.numeroFiche, numeros: x.numeros })));
        parSet.push({ slug, enDefaut: ls.length, forme: forme?.id ?? null, raison });
        if (!forme) { for (const x of ls) refus.push({ idProduct: x.l.idProduct, slug, avant: x.l.numeroFiche, raison: `set non réparé : ${raison}` }); continue; }
        const duSet = cartesDuSet.get(slug) || [], temoin = temoinDuNom(duSet), parId = new Map(duSet.map(c => [c._id, c]));
        for (const x of ls) {
            const id = x.l.idProduct, avant = x.l.numeroFiche;
            if (!PREUVES_ADMISES.includes(x.l.preuve)) { refus.push({ idProduct: id, slug, avant, raison: `preuve « ${x.l.preuve} » : la jointure n'est pas indépendante du numéro` }); continue; }
            const apres = numeroReparé(avant, x.numeros, forme);
            if (apres == null) { refus.push({ idProduct: id, slug, avant, raison: 'la forme calibrée ne désigne pas UNE impression de cette carte' }); continue; }
            const name = nomsProduits.get(id);
            if (!name) { refus.push({ idProduct: id, slug, avant, raison: 'nom du produit introuvable au catalogue : le témoin ne peut pas conclure' }); continue; }
            const d = decomposerNomCardmarket(name);
            // le témoin lit le NOM de la carte : on lui donne le document du set (celui qui porte nomEn), jamais la carte projetée sur les seules impressions
            const carteDuSet = parId.get(x.l.carteId);
            if (!carteDuSet || !carteDuSet.nomEn) { refus.push({ idProduct: id, slug, avant, raison: 'la carte n\'est pas dans les cartes du set (ou sans nomEn) : le témoin du nom ne peut pas conclure' }); continue; }
            const autres = temoin(carteDuSet, { nom: d.nom, attaques: d.attaques });
            if (autres) { refus.push({ idProduct: id, slug, avant, raison: `le nom « ${d.nom} » désigne une AUTRE carte du set (${autres.map(c => c._id).join(',')})` }); continue; }
            reparations.push({ _id: x.l._id, idProduct: id, slug, avant, apres, forme: forme.id });
        }
    }
    return { denominateur: den, enDefaut: den.enDefaut, parSet, reparations, refus };
}

/** Écrit. SEUL champ touché : numeroFiche, et seulement si la ligne porte encore `avant`. @returns {Promise<number>} lignes modifiées */
async function appliquer(CP, reparations) {
    let n = 0;
    for (const r of reparations) n += (await CP.updateOne({ _id: r._id, numeroFiche: r.avant }, { $set: { numeroFiche: r.apres } })).modifiedCount;
    return n;
}

module.exports = { planifier, appliquer, PREUVES_ADMISES, PROJECTION_SETS };

if (require.main === module) (async () => {
    const path = require('path'), { pathToFileURL } = require('url');
    require('dotenv').config({ quiet: true });
    const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — usage : [--ecrire --attendu=<N>]`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const ATTENDU = Number((process.argv.find(a => a.startsWith('--attendu=')) || '').slice(10));
    if (ECRIRE && !ATTENDU) { console.error('❌ --ecrire exige --attendu=<N> (le nombre de lignes que la simulation a rendu)'); process.exit(2); }

    // la règle du site, IMPORTÉE et confrontée à la copie : si elles divergent, l'outil s'arrête
    const SITE = process.env.RAT_MARKET_SITE_LIB || 'C:/Users/Yung/Desktop/rat-market-site/lib';
    const C = await import(pathToFileURL(path.join(SITE, 'cardmarket.ts')).href);
    for (const cas of CAS_COMPARABLE) if (C.numeroComparable(cas) !== numeroComparable(cas)) { console.error(`❌ numeroComparable du site ≠ copie pour ${JSON.stringify(cas)} : ${JSON.stringify(C.numeroComparable(cas))} contre ${JSON.stringify(numeroComparable(cas))} — recopier la règle`); process.exit(1); }
    console.log(`règle du site confrontée à la copie sur ${CAS_COMPARABLE.length} cas : identique`);

    // connexions : mesure = utilisateurs de LECTURE ; écriture = la connexion habituelle des outils (sous lot-additif.js)
    let cx, prodDb, fermer;
    if (ECRIRE) { const { ouvrirConnexions } = require('./collecte-cartes/garde'); const o = await ouvrirConnexions({ production: true, buckets: [] }); cx = o.cartes; prodDb = o.prod.db; fermer = o.fermer; }
    else {
        const { MongoClient } = require('mongodb');
        for (const v of ['MONGODB_CARTES_LECTURE_URI', 'MONGODB_LECTURE_URI']) if (!process.env[v]) { console.error(`❌ ${v} absente`); process.exit(2); }
        const a = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI), b = new MongoClient(process.env.MONGODB_LECTURE_URI);
        await a.connect(); await b.connect(); cx = { db: a.db('cartes') }; prodDb = b.db('test'); fermer = async () => { await a.close(); await b.close(); };
        if (!(await cx.db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('base cartes vide : grappe fausse ?');
    }
    const lignes = await cx.db.collection('cartes_produits').find({ numeroFiche: { $ne: null } }, { projection: { carteId: 1, idProduct: 1, slugSet: 1, numeroFiche: 1, preuve: 1 } }).toArray();
    const sets = new Map((await cx.db.collection('sets').find({}, { projection: PROJECTION_SETS }).toArray()).map(s => [s._id, s]));
    const cartes = new Map((await cx.db.collection('cartes').find({}, { projection: { impressions: 1 } }).toArray()).map(c => [c._id, c]));
    console.log(`DÉNOMINATEUR LU : ${lignes.length} lignes à numeroFiche · ${sets.size} sets · ${cartes.size} cartes`);
    if (!lignes.length || !sets.size || !cartes.size) throw new Error('une population de lecture est vide : sonde cassée');
    // l'ensemble des lignes en défaut est connu avant de charger le catalogue et les cartes des sets (lectures ciblées)
    const premier = (() => { try { return planifier({ lignes, sets, cartes, nomsProduits: new Map(), cartesDuSet: new Map() }); } catch (e) { return { erreur: e }; } })();
    if (premier.erreur) throw premier.erreur;
    const slugs = [...new Set(premier.parSet.map(s => s.slug))];
    // le plan sans catalogue refuse tout (nom introuvable) : on charge les noms des produits des sets en défaut, puis on rejoue
    const idsDesSets = lignes.filter(l => slugs.includes(l.slugSet)).map(l => l.idProduct);
    const nomsProduits = new Map((await prodDb.collection('catalogue_produits').find({ idProduct: { $in: idsDesSets } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
    const cartesDuSet = new Map(); for (const s of slugs) cartesDuSet.set(s, await cx.db.collection('cartes').find({ sets: s }, { projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1 } }).toArray());
    console.log(`TÉMOIN : ${nomsProduits.size} noms de produits lus pour ${idsDesSets.length} lignes de ${slugs.length} set(s) · cartes des sets : ${slugs.map(s => `${s} ${cartesDuSet.get(s).length}`).join(', ')}`);
    if (!nomsProduits.size || slugs.some(s => !cartesDuSet.get(s).length)) throw new Error('témoin sans matière (catalogue ou cartes du set vides) : sonde cassée');
    const plan = planifier({ lignes, sets, cartes, nomsProduits, cartesDuSet });

    // le relevé de T0 comptait avec normaliserNumero (sans la coupure « (Top Left) » du site) : on réconcilie
    const normT0 = n => { const s = String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, ''); return s === '' ? null : s; };
    let t0 = 0; for (const l of lignes) { const st = sets.get(l.slugSet), c = cartes.get(l.carteId); if (!st || !c) continue; const nums = numerosDuSet(c.impressions, st); if (nums.length && !nums.some(n => normT0(n) === normT0(l.numeroFiche))) t0++; }
    console.log(`DÉNOMINATEUR : ${JSON.stringify(plan.denominateur)}`);
    console.log(`RÉCONCILIATION : ${t0} lignes « sans impression égale » à la T0 (normaliserNumero) − ${t0 - plan.enDefaut} que le site rapproche quand même (numeroComparable coupe « (Top Left) ») = ${plan.enDefaut} réellement détachées (relevé de T0 : ${T0_COMPTE})`);
    for (const s of plan.parSet) console.log(`SET ${s.slug} : ${s.enDefaut} en défaut · forme calibrée ${s.forme ?? `AUCUNE — ${s.raison}`}`);
    for (const r of plan.reparations) console.log(`   ${r.idProduct} (${r.slug}) ${JSON.stringify(r.avant)} → ${JSON.stringify(r.apres)}  [${r.forme}]`);
    console.log(`REFUS (${plan.refus.length}) :`); for (const r of plan.refus) console.log(`   ✗ ${r.idProduct} (${r.slug}) ${JSON.stringify(r.avant)} — ${r.raison}`);
    console.log(`TOTAL : ${plan.reparations.length} lignes à réparer · ${plan.refus.length} refusées · sets touchés : ${[...new Set(plan.reparations.map(r => r.slug))].join(',') || '—'}`);
    if (!ECRIRE) { console.log('(mesure seule — --ecrire --attendu=<N> sous lot-additif.js)'); await fermer(); return; }
    if (plan.reparations.length !== ATTENDU) { console.error(`❌ ARRÊT : le plan rend ${plan.reparations.length}, attendu ${ATTENDU}`); await fermer(); process.exit(1); }
    const CP = cx.db.collection('cartes_produits');
    const n = await appliquer(CP, plan.reparations);
    const reste = await CP.countDocuments({ $or: plan.reparations.map(r => ({ _id: r._id, numeroFiche: r.avant })) });
    console.log(`${n === plan.reparations.length && !reste ? '✅' : '🔴'} réécrites ${n}/${plan.reparations.length} · relu : ${reste} ligne(s) portent encore l'ancien numéro`);
    await fermer();
    if (n !== plan.reparations.length || reste) process.exitCode = 1;
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
