// ============================================================
// UNE FICHE NE DOIT OUVRIR QU'UNE CARTE — les fiches « sans numéro » d'un set de réimpressions qui portent plusieurs tirages d'origine
// (lot MULTI, 2026-10-13 ; demande du site DEMANDE-SERVEUR-DATES.md § 2 : l'Ultra Ball 148517 de `Promos`)
// ============================================================
// LE DÉFAUT : un set de réimpressions (Promos, Professor Program, Prize Packs, Southeast Asia Promos, WCD) n'a ni `bulba.expansion` ni
// impression « du set » ; la fiche d'une carte y est donc UNE fiche sans numéro (fichesDuDocument([]) = une fiche à numéro nul), et une fiche
// sans numéro garde TOUS les produits de la carte (produitsDeLaFiche). Quand la carte est réimprimée à deux numéros d'origine (Brilliant
// Stars n°150, Mega Evolution n°131), les liens Cardmarket des deux cartes tombent sur la même fiche : un lien faux = un mauvais prix.
//
// 🔑 LE GESTE MINIMAL — TROIS AJOUTS, AUCUNE VALEUR MODIFIÉE :
//   1. cartes.impressions : UNE impression par numéro d'origine distinct, lu dans le slug par le décodeur EXISTANT (set-partiel.js
//      decoderOrigine, jamais deviné), au tirage du set et sous le NOM D'EXPANSION que le site lit pour ce set ;
//   2. cartes_produits.numeroFiche sur les lignes de la fiche (seulement s'il est absent ou nul) : sans lui le site lit le slug, et la règle
//      « un numéro qui ne désigne aucune fiche = sans-fiche » ne joue que pour les lignes qui l'ont ;
//   3. sets.bulba.expansion (null -> le nom) : voir ci-dessous. Posé EN DERNIER (c'est l'interrupteur) et seulement s'il y a une fiche à écrire.
//
// 🔴 POURQUOI `bulba.expansion` EST NÉCESSAIRE — il n'existe pas de geste sans lui, mesuré dans le code du site :
//   · lib/cartes.ts:413-421 (trouverImpressionDuSet), lib/entreesDuSet.ts:41-43 (expansionsDuSet), lib/impressionsDuSet.ts:166-173 et 198-203
//     (comptes Mongo), lib/pokemon.ts:145 et exporter-donnees-logos-site.js:96 : une impression appartient à un set ssi
//     `imp.tirage === tirageDuSet(set) && set.bulba.expansion.includes(imp.expansion)`. C'est le SEUL champ lu ; sans lui, le tableau est
//     [] (exporteur) ou [null] (site) : seule une impression à expansion NULLE passerait, et elle s'afficherait dans TOUT set sans nom
//     (incident du 2026-10-06 : 118 impressions écrites ainsi, retirées une heure plus tard — poser-impressions-par-numero.js:232-234).
//   · creer-sets-reimpressions.js:14 écrivait « `bulba.expansion` reste NULL : une expansion déclarée par la carte y ferait naître les fiches du
//     tirage d'ORIGINE sous ce set » — vrai pour un nom que des cartes déclarent déjà. D'où la parade, qui est le contenu de ce module :
//     le nom est SYNTHÉTIQUE (`reimpressions/<slug>`, qu'aucune page de carte de Bulbapedia n'écrit) et l'outil REFUSE le set si une
//     carte, autre que celles qu'il ajoute lui-même, le déclare déjà. Les seules cartes qui déclarent le nom sont celles que cet outil écrit.
//
// 🔑 UNE GARDE SE FORME PAR CE QU'ELLE AUTORISE : une fiche n'est écrite que si TOUTES ses lignes appartiennent au set, se décodent, concordent
// avec l'origine déjà stockée, donnent des numéros distincts (au sens de cleNumero ET de numeroComparable du site), et si la règle du site
// IMPORTÉE (fichesDesProduits), rejouée sur le set entier avant/après, ne perd aucun produit, n'en double aucun, n'en déplace aucun vers
// une autre carte, et range CHAQUE produit de la carte sur la fiche de SON numéro d'origine. Un set qui échoue à l'un de ces contrôles
// n'est pas écrit du tout (le site passe un set « par impression » en bloc, documentAmbigu).
const { isDeepStrictEqual } = require('util');
const { cleNumero } = require('./jointure');
const { decoderOrigine } = require('./set-partiel');
const { numeroComparable } = require('./numero-fiche');
const { expansionSynthetiqueDe } = require('./nom-synthetique');

// 🔑 La marque de CONSERVATION (§59) : 'origine-slug' est dans SOURCES_POSEES_APRES (impressions-posees.js), posée dans le MÊME commit que l'écriture —
// sinon toute réécriture de `impressions` (page-de-carte.js, collecteur-texte.js, rejouer-impressions.js) effacerait ces impressions.
const SOURCE = 'origine-slug';
/** La liste FERMÉE des sets de cette forme (DATES-enquete.md § 2, p2-liste-detail.json). */
const SETS_AUTORISES = ['Promos', 'Professor-Program', 'Play-Pokemon-Prize-Pack-Series-Three', 'Play-Pokemon-Prize-Pack-Series-Four', 'Play-Pokemon-Prize-Pack-Series-Five', 'Southeast-Asia-Promos', 'WCD-2008', 'WCD-2011', 'WCD-2012', 'WCD-2022', 'WCD-2023', 'WCD-2025'];
/** Le nom d'expansion synthétique de CE set : aucune page de carte ne l'écrit. */
const expansionDe = expansionSynthetiqueDe;   // UNE fonction pour tous (nom-synthetique.js : estNomSynthetique, nomsBulbapedia, refusDeCollecte)
const clesDe = n => [cleNumero(n), numeroComparable(n)].filter(Boolean);
const vide = v => v == null || String(v).trim() === '';

/**
 * Pur. Le plan d'UNE fiche (une carte dans un set). `lignes` : les lignes cartes_produits de la carte dans l'expansion du set.
 * @returns {{statut: 'ecrire'|'deja'|'hors-forme'|'refus', raison?: string, detail?: string, impressions?: object[], numeros?: Map<string,string>, origines?: object[], produitOrigine?: Map<number,string>}}
 */
function planFiche({ set, carte, lignes, nom }) {
    if (!lignes || lignes.length < 2) return { statut: 'hors-forme', raison: 'une-seule-ligne' };
    const refus = (raison, detail) => ({ statut: 'refus', raison, detail });
    const tirage = set.tirage ?? set.region;
    const lues = [];
    for (const l of lignes) {
        if (l.slugSet !== set._id) return refus('ligne-hors-du-set', `${l._id} : slugSet « ${l.slugSet} » ≠ « ${set._id} »`);
        const d = decoderOrigine(l.slug, set.code);
        if (!d) return refus('origine-non-decodee', `${l._id} : le slug « ${l.slug} » ne porte pas de code et de numéro d'origine sous « ${set.code} »`);
        if (l.origine && l.origine.code && !(l.origine.code === d.code && cleNumero(l.origine.numero) === cleNumero(d.num)))
            return refus('origine-stockee-en-desaccord', `${l._id} : le slug dit ${d.code} n°${d.num}, la ligne stocke ${l.origine.code} n°${l.origine.numero}`);
        lues.push({ l, ...d });
    }
    const parOrigine = new Map();
    for (const x of lues) {
        const k = `${x.code}|${cleNumero(x.num)}`;
        if (!parOrigine.has(k)) parOrigine.set(k, { code: x.code, num: x.num, lignes: [] });
        parOrigine.get(k).lignes.push(x.l);
    }
    if (parOrigine.size < 2) return { statut: 'hors-forme', raison: 'une-seule-origine' };
    const origines = [...parOrigine.values()];
    for (let i = 0; i < origines.length; i++) for (let j = i + 1; j < origines.length; j++)
        if (clesDe(origines[i].num).some(k => clesDe(origines[j].num).includes(k)))
            return refus('deux-origines-meme-numero', `${origines[i].code} n°${origines[i].num} et ${origines[j].code} n°${origines[j].num} donnent le même numéro de fiche`);
    // l'ordre des impressions : celui de liens.idProduct de la carte (la première apparition d'un produit de l'origine), puis le plus petit idProduct
    const position = id => { const i = (carte.liens?.idProduct || []).indexOf(id); return i < 0 ? Infinity : i; };
    const rang = o => [Math.min(...o.lignes.map(l => position(l.idProduct))), Math.min(...o.lignes.map(l => l.idProduct))];
    origines.sort((a, b) => { const x = rang(a), y = rang(b); return (x[0] === y[0] ? 0 : x[0] < y[0] ? -1 : 1) || x[1] - y[1]; });
    const produitOrigine = new Map(origines.flatMap(o => o.lignes.map(l => [l.idProduct, o.num])));
    const numeros = new Map();
    for (const o of origines) for (const l of o.lignes) {
        if (vide(l.numeroFiche)) numeros.set(l._id, o.num);
        else if (numeroComparable(l.numeroFiche) !== numeroComparable(o.num)) return refus('numeroFiche-contredit', `${l._id} : numeroFiche « ${l.numeroFiche} » ≠ l'origine ${o.code} n°${o.num}`);
    }
    const impressions = origines.map(o => ({ tirage, expansion: nom, deck: null, numero: o.num, total: null, rarete: null, source: SOURCE, preuveNumero: `slug ${o.lignes[0].slug} → tirage d'origine ${o.code} n°${o.num}` }));
    const existantes = (carte.impressions || []).filter(i => i && i.tirage === tirage && i.expansion === nom);
    if (existantes.length) {
        const memes = existantes.length === impressions.length && impressions.every(p => existantes.some(e => numeroComparable(e.numero) === numeroComparable(p.numero)));
        if (memes && !numeros.size) return { statut: 'deja', origines, produitOrigine, impressions: [], numeros };
        return refus('etat-partiel', `${existantes.length} impression(s) « ${nom} » déjà là, ${numeros.size} ligne(s) sans numeroFiche : l'état ne se lit ni comme fait ni comme à faire`);
    }
    return { statut: 'ecrire', impressions, numeros, origines, produitOrigine };
}

/** Pur. Les fiches du site (carteId|rang) qui portent des produits de PLUSIEURS origines distinctes (le contrôle transversal, §32). */
function fichesMultiOrigine(fiche, lignesParId, code) {
    const parFiche = new Map();
    for (const [id, f] of fiche) {
        const l = lignesParId.get(id); if (!l) continue;
        const d = decoderOrigine(l.slug, code); if (!d) continue;
        const k = `${f.carteId}|${f.rang}`;
        if (!parFiche.has(k)) parFiche.set(k, new Set());
        parFiche.get(k).add(`${d.code}|${cleNumero(d.num)}`);
    }
    return [...parFiche].filter(([, s]) => s.size > 1).map(([k]) => k);
}

const SONDE_CARTES = { nomEn: 1, sets: 1, impressions: 1, images: 1, 'liens.idProduct': 1 };

async function lireSet(db, slug) {
    const set = await db.collection('sets').findOne({ _id: slug });
    if (!set) return null;
    const exps = [].concat(set.idExpansion ?? []);
    const cartes = await db.collection('cartes').find({ sets: slug }, { projection: SONDE_CARTES }).toArray();
    const docs = cartes.filter(c => typeof c.nomEn === 'string' && c.nomEn !== '');
    const ids = new Set(docs.map(d => d._id));
    const lignes = (await db.collection('cartes_produits').find({ idExpansion: { $in: exps } }).toArray()).filter(l => ids.has(l.carteId));
    return { set, exps, docs, lignes };
}

/**
 * `setParImpression` du site (impressionsDuSet.ts:244, TOUT OU RIEN par set : un seul document AMBIGU — plusieurs fiches ET une image du set sans
 * numero, `documentAmbigu` — repasse le set ENTIER en « une fiche par document ») pour les documents et le set donnés. Même construction que
 * exporter-donnees-logos-site.js:98-99, dont elle appelle les fonctions du site IMPORTÉES.
 */
function parImpressionDe(regle, set, docs) {
    const tir = set.tirage ?? set.region, noms = [].concat(set.bulba?.expansion ?? []);
    return regle.setParImpression(docs.map(d => ({ fiches: regle.fichesDuDocument((d.impressions || []).filter(i => i && i.tirage === tir && noms.includes(i.expansion))), images: (d.images || []).filter(m => m && m.set === set._id) })));
}

/** La simulation d'UN set : plans, contrôle de l'ensemble par la règle du site importée. */
async function analyserSet({ db, deps, slug }) {
    const L = await lireSet(db, slug);
    if (!L) return { slug, statut: 'absent', aEcrire: 0, deja: 0, horsForme: 0, refus: [] };
    const { set, docs, lignes } = L, nom = expansionDe(slug), { regle, fichesDesProduits } = deps;
    const S = { slug, nom, statut: 'ok', aEcrire: 0, deja: 0, horsForme: 0, refus: [], docs: docs.length, lignes: lignes.length, plans: [], dejaIds: [], L };
    const parCarte = new Map();
    for (const l of lignes) (parCarte.get(l.carteId) || parCarte.set(l.carteId, []).get(l.carteId)).push(l);
    const carteDe = new Map(docs.map(d => [d._id, d]));
    for (const [carteId, ls] of [...parCarte].sort((a, b) => a[0] - b[0])) {
        const p = planFiche({ set, carte: carteDe.get(carteId), lignes: ls, nom });
        if (p.statut === 'hors-forme') S.horsForme++;
        else if (p.statut === 'refus') S.refus.push({ carteId, nomEn: carteDe.get(carteId).nomEn, raison: p.raison, detail: p.detail });
        else if (p.statut === 'deja') { S.deja++; S.dejaIds.push(carteId); }
        else { S.aEcrire++; S.plans.push({ carteId, ...p }); }
    }
    const lignesParId = new Map(lignes.map(l => [l.idProduct, l]));
    const avant = fichesDesProduits(regle, set, docs, lignes);
    S.servisAvant = avant.fiche.size; S.doublesAvant = avant.doubles;
    S.multiAvant = fichesMultiOrigine(avant.fiche, lignesParId, set.code).length;
    if (!S.aEcrire && !S.deja) { S.statut = 'rien'; S.servisApres = S.servisAvant; S.perdus = 0; S.doublesApres = S.doublesAvant; S.autreCarte = 0; S.multiApres = S.multiAvant; S.surLaBonneFiche = 0; S.mauvaiseFiche = 0; return S; }
    const posee = set.bulba?.expansion;
    if (!vide(posee) && posee !== nom) { S.statut = 'refuse-expansion-posee'; S.detail = `bulba.expansion vaut déjà ${JSON.stringify(posee)} : jamais écrasée`; S.aEcrireBrut = S.aEcrire; S.aEcrire = 0; return S; }
    const attendus = new Set([...S.plans.map(p => p.carteId), ...S.dejaIds]);
    const declarants = (await db.collection('cartes').find({ 'impressions.expansion': nom }, { projection: { _id: 1 } }).toArray()).map(c => c._id).filter(id => !attendus.has(id));
    if (declarants.length) { S.statut = 'refuse-nom-declare'; S.detail = `${declarants.length} carte(s) étrangère(s) déclarent déjà « ${nom} » (${declarants.slice(0, 5).join(', ')})`; S.aEcrireBrut = S.aEcrire; S.aEcrire = 0; return S; }
    // l'état d'APRÈS, en mémoire : les impressions ajoutées, les numeroFiche posés, le nom
    const numeros = new Map(S.plans.flatMap(p => [...p.numeros]));
    const docs2 = docs.map(d => { const p = S.plans.find(x => x.carteId === d._id); return p ? { ...d, impressions: [...(d.impressions || []), ...structuredClone(p.impressions)] } : d; });
    const lignes2 = lignes.map(l => (numeros.has(l._id) ? { ...l, numeroFiche: numeros.get(l._id) } : l));
    const set2 = { ...set, bulba: { ...(set.bulba || {}), expansion: nom } };
    const apres = fichesDesProduits(regle, set2, docs2, lignes2);
    S.servisApres = apres.fiche.size; S.doublesApres = apres.doubles;
    S.parImpressionAvant = parImpressionDe(regle, set, docs); S.parImpressionApres = parImpressionDe(regle, set2, docs2);
    S.perdus = [...avant.fiche.keys()].filter(id => !apres.fiche.has(id)).length;
    S.autreCarte = [...avant.fiche].filter(([id, f]) => apres.fiche.has(id) && apres.fiche.get(id).carteId !== f.carteId).length;
    S.multiApres = fichesMultiOrigine(apres.fiche, lignesParId, set.code).length;
    S.surLaBonneFiche = 0; S.mauvaiseFiche = 0;
    for (const p of S.plans) for (const [idProduct, num] of p.produitOrigine) {
        const f = apres.fiche.get(idProduct);
        if (f && f.carteId === p.carteId && numeroComparable(f.numero) === numeroComparable(num)) S.surLaBonneFiche++; else S.mauvaiseFiche++;
    }
    const bascule = S.parImpressionAvant && !S.parImpressionApres;
    if (bascule || S.perdus || S.doublesApres > S.doublesAvant || S.autreCarte || S.mauvaiseFiche) {
        S.statut = 'refuse-simulation';
        S.detail = `la règle du site rejouée : ${bascule ? 'documentAmbigu — le set BASCULERAIT de « une fiche par impression » à « une fiche par document » (un document à plusieurs fiches porte une image du set sans numero) ; ' : ''}`
            + `${S.perdus} produit(s) perdu(s), doubles ${S.doublesAvant}→${S.doublesApres}, ${S.autreCarte} sur la fiche d'une autre carte, ${S.mauvaiseFiche} produit(s) qui ne tombent pas sur la fiche de leur numéro d'origine`;
        S.aEcrireBrut = S.aEcrire; S.aEcrire = 0;
    }
    return S;
}

/** L'écriture d'UN set accepté : numeroFiche, impressions (carte par carte), puis le nom du set en dernier. LÈVE au premier compte qui ne colle pas. */
async function ecrireSet(db, S) {
    const nom = S.nom;
    for (const p of S.plans) {
        for (const [id, num] of p.numeros) {
            const r = await db.collection('cartes_produits').updateOne({ _id: id, numeroFiche: null }, { $set: { numeroFiche: num } });
            if (r.modifiedCount !== 1) throw new Error(`la ligne ${id} n'a pas reçu son numeroFiche (modifiées : ${r.modifiedCount}) — la base a bougé depuis la simulation ; arrêt`);
        }
        const r = await db.collection('cartes').updateOne({ _id: p.carteId, 'impressions.expansion': { $ne: nom } }, { $push: { impressions: { $each: p.impressions } } });
        if (r.modifiedCount !== 1) throw new Error(`la carte ${p.carteId} n'a pas reçu ses impressions (modifiées : ${r.modifiedCount}) — arrêt`);
    }
    if (vide(S.L.set.bulba?.expansion)) {
        const r = await db.collection('sets').updateOne({ _id: S.slug, 'bulba.expansion': null }, { $set: { 'bulba.expansion': nom } });
        if (r.modifiedCount !== 1) throw new Error(`le set ${S.slug} n'a pas reçu bulba.expansion (modifiés : ${r.modifiedCount}) — arrêt`);
    }
}

/** La relecture : l'état attendu AU CHAMP PRÈS, puis la règle du site sur la base écrite. Rend la liste des écarts ([] = juste). */
async function relire(db, deps, S) {
    const e = [], { regle, fichesDesProduits } = deps, nom = S.nom;
    const R = await lireSet(db, S.slug);
    if (!R) return [`${S.slug} : le set a disparu`];
    const numeros = new Map(S.plans.flatMap(p => [...p.numeros]));
    const attSet = structuredClone(S.L.set); attSet.bulba = { ...(attSet.bulba || {}), expansion: nom };
    if (!isDeepStrictEqual(R.set, attSet)) e.push(`${S.slug} : le document du set n'est pas celui d'avant + le seul bulba.expansion`);
    if (R.docs.length !== S.L.docs.length) e.push(`${S.slug} : ${R.docs.length} cartes du set, attendu ${S.L.docs.length}`);
    const apres = new Map(R.docs.map(d => [d._id, d]));
    for (const a of S.L.docs) {
        const p = S.plans.find(x => x.carteId === a._id), d = apres.get(a._id);
        const att = p ? { ...structuredClone(a), impressions: [...(a.impressions || []), ...structuredClone(p.impressions)] } : a;
        if (!d || !isDeepStrictEqual(d, att)) e.push(`${S.slug} : la carte ${a._id} n'est pas celle d'avant${p ? ' + ses impressions à la fin' : ''}`);
    }
    if (R.lignes.length !== S.L.lignes.length) e.push(`${S.slug} : ${R.lignes.length} lignes, attendu ${S.L.lignes.length}`);
    const lap = new Map(R.lignes.map(l => [l._id, l]));
    for (const a of S.L.lignes) {
        const att = numeros.has(a._id) ? { ...a, numeroFiche: numeros.get(a._id) } : a;
        if (!isDeepStrictEqual(lap.get(a._id), att)) e.push(`${S.slug} : la ligne ${a._id} n'est pas celle d'avant${numeros.has(a._id) ? ' + son numeroFiche' : ''}`);
    }
    const declarants = await db.collection('cartes').find({ 'impressions.expansion': nom }, { projection: { _id: 1 } }).toArray();
    if (declarants.length !== S.plans.length + S.deja) e.push(`${S.slug} : ${declarants.length} cartes déclarent « ${nom} », attendu ${S.plans.length + S.deja}`);
    const f = fichesDesProduits(regle, R.set, R.docs, R.lignes);
    if (f.fiche.size !== S.servisApres) e.push(`${S.slug} : ${f.fiche.size} produits servis après écriture, simulé ${S.servisApres}`);
    return e;
}

/**
 * L'outil. `sets` : slugs. `attendu` : le nombre de fiches à écrire de la simulation (exigé par --ecrire). Rend { code, rapport }.
 * Codes : 0 ok · 1 refus (set absent, attendu qui ne colle pas, rien à faire, écriture arrêtée) · 2 usage.
 */
async function executer({ db, deps, sets, attendu = null, ecrire = false, log = console.log, err = console.error }) {
    const rapport = { sets: [], totalAEcrire: 0, ecarts: [], erreur: null };
    if (ecrire && !Number.isInteger(attendu)) { err('❌ --ecrire exige --attendu=N (le nombre de fiches à écrire de la simulation)'); return { code: 2, rapport }; }
    for (const slug of sets) rapport.sets.push(await analyserSet({ db, deps, slug }));
    let absent = false;
    for (const S of rapport.sets) {
        if (S.statut === 'absent') { absent = true; err(`❌ le set « ${S.slug} » n'existe pas`); continue; }
        log(`\n── ${S.slug} (${S.nom}) : ${S.docs} cartes, ${S.lignes} lignes · statut ${S.statut}${S.detail ? ` — ${S.detail}` : ''}`);
        log(`   fiches de la forme : à écrire ${S.aEcrire}${S.aEcrireBrut != null ? ` (${S.aEcrireBrut} refusées avec le set)` : ''} · déjà faites ${S.deja} · hors forme ${S.horsForme} · refusées ${S.refus.length}`);
        for (const r of S.refus) log(`   refus [${r.raison}] carte ${r.carteId} « ${r.nomEn} » : ${r.detail}`);
        if (S.servisApres != null) {
            log(`   la règle du site (importée) : produits servis ${S.servisAvant} → ${S.servisApres} · perdus ${S.perdus} · doublés ${S.doublesAvant} → ${S.doublesApres} · sur la fiche d'une autre carte ${S.autreCarte} · produits de la forme sur la fiche de leur numéro d'origine ${S.surLaBonneFiche} (hors place ${S.mauvaiseFiche})`);
            log(`   documentAmbigu (site, tout ou rien par set) : « une fiche par impression » ${S.parImpressionAvant} → ${S.parImpressionApres}${S.parImpressionAvant && !S.parImpressionApres ? ' — BASCULE, set refusé' : ''}`);
            log(`   CONTRÔLE TRANSVERSAL (§32) « aucune fiche n'ouvre deux cartes d'origine » : fiches qui en ouvrent plusieurs ${S.multiAvant} → ${S.multiApres}`);
        } else log(`   (avant : produits servis ${S.servisAvant}, fiches multi-origine ${S.multiAvant} — la simulation d'après n'est pas faite pour un set refusé avant elle)`);
        for (const p of S.plans) log(`   + carte ${p.carteId} : ${p.impressions.map(i => i.numero).join(' + ')} (${p.numeros.size} ligne(s) reçoivent numeroFiche)`);
        rapport.totalAEcrire += S.aEcrire;
    }
    log(`\nTOTAL : ${rapport.totalAEcrire} fiche(s) à écrire sur ${rapport.sets.filter(S => S.statut === 'ok').length} set(s) acceptés (${rapport.sets.filter(S => !['ok', 'rien', 'absent'].includes(S.statut)).length} refusé(s) par la simulation)`);
    if (absent) return { code: 1, rapport };
    if (attendu != null && attendu !== rapport.totalAEcrire) { err(`❌ ${rapport.totalAEcrire} fiche(s) à écrire, ${attendu} attendue(s) (--attendu=${attendu}) : le plan diffère, RIEN ne s'écrit`); return { code: 1, rapport }; }
    if (!rapport.totalAEcrire) {
        if (rapport.sets.some(S => S.deja)) { log('déjà fait : rien à écrire'); return { code: 0, rapport }; }
        err('❌ aucune fiche de la forme à écrire'); return { code: 1, rapport };
    }
    if (!ecrire) { log(`(simulation — rien n'est écrit ; relancer avec --attendu=${rapport.totalAEcrire} --ecrire, sous lot-additif.js)`); return { code: 0, rapport }; }
    try {
        for (const S of rapport.sets.filter(x => x.statut === 'ok' && x.aEcrire)) {
            await ecrireSet(db, S);
            const ecarts = await relire(db, deps, S);
            rapport.ecarts.push(...ecarts);
            log(`   ${S.slug} : écrit · RELECTURE ${ecarts.length ? '🔴 ' + ecarts.join(' ; ') : '✅ comme attendu'}`);
            if (ecarts.length) break;
        }
    } catch (e) { rapport.erreur = e.message; err(`❌ ${e.message}`); return { code: 1, rapport }; }
    if (rapport.ecarts.length) { err('❌ la relecture ne retrouve pas l\'état attendu'); return { code: 1, rapport }; }
    log(`✅ écrit et relu : ${rapport.totalAEcrire} fiche(s)`);
    return { code: 0, rapport };
}

module.exports = { SOURCE, SETS_AUTORISES, expansionDe, planFiche, fichesMultiOrigine, analyserSet, ecrireSet, relire, executer };
