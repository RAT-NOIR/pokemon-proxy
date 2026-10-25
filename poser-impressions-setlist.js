// ============================================================
// POSER SUR LA CARTE LES IMPRESSIONS QUE LA SETLIST DONNE ET QUE L'URL CARDMARKET CONFIRME (2026-09-24)
// ============================================================
//   node poser-impressions-setlist.js [--plan=<f>.json]                (simulation : compte, exemples, contrôle de la garde ; --plan écrit le plan pour le scanner et simuler-abc)
//   node poser-impressions-setlist.js --seulement=<liste>.json [--plan=<f>.json]     (le plan RESTREINT aux produits confirmés par deux sources non-Bulbapedia)
//   node lot-additif.js --quoi="…" --collections=cartes -- node poser-impressions-setlist.js --seulement=<liste>.json --attendu=<N> --ecrire
//
// 🔴 LE CONTRE-EXEMPLE DU TESTEUR : Lady-V2-CSM1aC182, vérifiée à l'œil sur Cardmarket, est bien la 182/151 SR. La jointure
// avait raison — V1 → 136, V2 → 182, « setlist+numero », `detail: n°136, 182` —, mais l'impression chinoise n'existait
// que dans la mémoire de la jointure (§42 : « la jointure chinoise est VIRTUELLE ») : la carte ne portait aucune impression
// de Storming Emergence Radiant, et le site montrait une fiche sans numéro pour deux produits.
// 🔑 DEUX SOURCES INDÉPENDANTES, EXIGÉES TOUTES LES DEUX : le numéro de l'URL Cardmarket (appris, `numeroUrl`, ou le jeton qui
// suit le code du set dans le slug) ET la Setlist de Bulbapedia, qui range cette carte à ce numéro (`detail` de la ligne,
// écrit par joindre()). L'une sans l'autre n'écrit rien : « Deino-CSV2C089 » a pour titre 090, la Setlist range Deino au 90
// et Spiritomb au 89 — l'URL se trompe, elle ne pose pas d'impression.
// L'impression est celle que la jointure fabrique (jointure.js, impressionsDepuisSetlist) : même tirage, même nom
// d'expansion, `source: 'setlist'` — la marque qui la fait survivre à une relecture de la page (impressions-posees.js).
// Le numéro est écrit comme Cardmarket l'imprime (le titre, quand titre et URL désignent le même numéro).
//
// (PHASE 3a-SUITE, 2026-10-24) LA RÈGLE DES DEUX SOURCES DU TESTEUR : Bulbapedia ne compte pas. Les deux sources ci-dessus (URL Cardmarket = UNE source, Setlist de Bulbapedia = pas une source) ne suffisent donc
// plus à ÉCRIRE : `--seulement=<liste>.json` (construire-liste-lot.js, d'après scanner-deux-sources.js --plans : Cardmarket + au moins une source indépendante, TPC / artofpkm / PikaQian calibré / TCGdex)
// restreint l'écriture. UNE impression est UN numéro de fiche pour TOUS les produits de cette carte à ce numéro : elle ne s'écrit que si TOUS ses produits sont dans la liste (sinon un produit non confirmé
// recevrait un numéro). `--attendu=<N>` (le nombre d'IMPRESSIONS du plan retenu) est exigé pour écrire.
require('dotenv').config();
const fs = require('fs');
const { cleNumero } = require('./collecte-cartes/jointure');
const LOT = require('./collecte-cartes/lot-seulement');

const k = n => cleNumero(String(n ?? ''));

/** Le numéro que l'URL porte : appris comme tel, ou le jeton qui suit le code du set. Jamais les chiffres d'un nom. */
function numeroDeLUrl(nc, slug) {
    if (nc?.numeroUrl != null && String(nc.numeroUrl).trim() !== '') return String(nc.numeroUrl);
    // le code s'écrit parfois à cheval sur un tiret (« M-P/ID » → « …-M-PID081 ») : on le cherche sur le slug sans ponctuation,
    // ancré en FIN, suivi d'un numéro qui commence par un chiffre
    const code = String(nc?.codeSet || '').replace(/[^A-Za-z0-9]/g, '');
    const plat = String(slug || nc?.slug || '').replace(/[^A-Za-z0-9]/g, '');
    const m = code ? new RegExp(`${code}(\\d[A-Za-z0-9]*)$`, 'i').exec(plat) : null;
    return m ? m[1] : null;
}

/**
 * Pur : de quoi décider, rend ce qui serait posé.
 * @param {{lignes: object[], NC: Map<number, object>, cartes: Map<number, object>, ligneDeSet: Map<string, object>}} e
 * @returns {{aPoser: Map<number, object[]>, issues: object, produits: Map<string, Set<number>>}}  `produits` : (carte|tirage|expansion|numéro) → les idProduct qui demandent cette impression
 */
function planifier({ lignes, NC, cartes, ligneDeSet }) {
    const issues = {}, aPoser = new Map(), produits = new Map();
    const note = (cause, ex) => { (issues[cause] || (issues[cause] = { n: 0, ex: [] })).n++; if (issues[cause].ex.length < 3) issues[cause].ex.push(ex); };
    const cleImp = (carteId, i) => `${carteId}|${i.tirage}|${i.expansion}|${k(i.numero)}`;
    for (const l of lignes) {
        const L = ligneDeSet.get(l.slugSet), nc = NC.get(l.idProduct), c = cartes.get(l.carteId);
        const ex = `${l.slugSet} ${l.idProduct} « ${nc?.slug ?? l.slug} » → ${l.carteId} « ${c?.nomEn} » (${l.detail})`;
        if (!L) { note('set sans ligne de table : nom d\'expansion inconnu', ex); continue; }
        if ((L.bulba.tirage || 'jp') !== l.tirage) { note(`tirage de la ligne de jointure (${l.tirage}) ≠ tirage de la table`, ex); continue; }
        if (!c) { note('carte absente', ex); continue; }
        const url = numeroDeLUrl(nc, l.slug);
        if (!url) { note('aucun numéro d\'URL (chiffres du nom, ou jeton sans le code du set)', ex); continue; }
        const numsSetlist = ((/^n°([^ ]+(?:, [^ ]+)*) dans/.exec(l.detail || '') || [])[1] || '').split(', ').filter(Boolean).map(k);
        if (!numsSetlist.includes(k(url))) { note('le numéro d\'URL n\'est pas un numéro que la Setlist donne à la carte — rien n\'est écrit', `${ex} · URL ${url} · titre ${nc?.numero}`); continue; }
        const expansion = [].concat(L.bulba.expansion)[0];
        const numero = nc?.numero != null && k(nc.numero) === k(url) ? String(nc.numero) : url;
        const meme = i => i.tirage === l.tirage && i.expansion === expansion && k(i.numero) === k(numero);
        if ((c.impressions || []).some(meme)) { note('impression déjà sur la carte', ex); continue; }
        const dejaDuPlan = (aPoser.get(c._id) || []).find(meme);
        const imp = dejaDuPlan || { tirage: l.tirage, expansion, numero, total: null, deck: null, rarete: null, source: 'setlist' };
        if (!dejaDuPlan) (aPoser.get(c._id) || aPoser.set(c._id, []).get(c._id)).push(imp);
        const cle = cleImp(c._id, imp);
        (produits.get(cle) || produits.set(cle, new Set()).get(cle)).add(l.idProduct);
        if (dejaDuPlan) { note('impression déjà au plan (un autre produit de la même carte au même numéro)', ex); continue; }
        note('À POSER : URL et Setlist concordantes, impression absente de la carte', `${ex} · URL ${url} → n°${numero}`);
    }
    return { aPoser, issues, produits };
}

/** @returns {number[]} les idProduct de la liste qu'aucune impression à poser ne porte */
function horsPlan(P, seulement) {
    const vus = new Set(); for (const s of P.produits.values()) for (const id of s) vus.add(id);
    return LOT.horsPlan(seulement, vus);
}

/** Une impression ne s'écrit que si TOUS ses produits sont dans la liste. Sans liste (null) rien n'est filtré. @returns {{aPoser: Map, produits: Map, ecartees: Array<{cle: string, motif: string}>}} */
function restreindre(P, seulement) {
    if (!seulement) return { aPoser: P.aPoser, produits: P.produits, ecartees: [] };
    const aPoser = new Map(), produits = new Map(), ecartees = [];
    for (const [carteId, imps] of P.aPoser) for (const i of imps) {
        const cle = `${carteId}|${i.tirage}|${i.expansion}|${k(i.numero)}`, ids = [...P.produits.get(cle)];
        const confirmes = ids.filter(id => seulement.has(id));
        if (confirmes.length !== ids.length) { ecartees.push({ cle, motif: `${confirmes.length ? 'pas tous les produits' : 'aucun produit'} confirmés par deux sources (${confirmes.length}/${ids.length})` }); continue; }
        (aPoser.get(carteId) || aPoser.set(carteId, []).get(carteId)).push(i);
        produits.set(cle, P.produits.get(cle));
    }
    return { aPoser, produits, ecartees };
}

/** Le plan que scanner-deux-sources.js (--plans) et simuler-abc.js lisent : une LIGNE par produit (elle existe déjà : `_id` identique, elle n'est pas ajoutée) + les impressions. */
function construirePlan(R, ligneDeSet, ligneParProduit) {
    const lignes = [], impressions = [];
    for (const [carteId, imps] of R.aPoser) for (const i of imps) {
        impressions.push({ carteId, imp: i });
        for (const id of [...R.produits.get(`${carteId}|${i.tirage}|${i.expansion}|${k(i.numero)}`)].sort((a, b) => a - b)) {
            const l = ligneParProduit.get(id);
            lignes.push({ _id: l._id, carteId, idProduct: id, idExpansion: l.idExpansion, tirage: l.tirage, preuve: l.preuve, slugSet: l.slugSet, numeroFiche: i.numero, code: ligneDeSet.get(l.slugSet)?.code ?? null });
        }
    }
    return { outil: 'poser-impressions-setlist', lignes, impressions };
}

module.exports = { planifier, restreindre, horsPlan, construirePlan, numeroDeLUrl, ecrireImpressions };

async function principal() {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
    const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
    const AUTORISES = [/^--ecrire$/, /^--seulement=.+\.json$/, /^--plan=.+\.json$/, /^--attendu=\d+$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire, --seulement=<f>.json, --plan=<f>.json, --attendu=<N>`); process.exit(2); }
    const arg = n => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = process.argv.includes('--ecrire');
    let SEULEMENT = null;
    if (arg('seulement')) { try { SEULEMENT = LOT.lireFichier('--seulement', arg('seulement')); } catch (e) { console.error(`❌ ${e.message} — rien n'est écrit`); process.exit(2); } }
    if (ecrire && (!SEULEMENT || !arg('attendu'))) { console.error('❌ --ecrire exige --seulement=<liste>.json ET --attendu=<N> : Bulbapedia ne compte pas comme seconde source, seule la liste des produits confirmés autorise — rien n\'est écrit'); process.exit(2); }

    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ buckets: [] });
    const ligneDeSet = new Map();
    for (const l of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (l.slugSet && l.bulba && !ligneDeSet.has(l.slugSet)) ligneDeSet.set(l.slugSet, l);
    const total = await cx.db.collection('cartes_produits').countDocuments({});
    const lignes = await cx.db.collection('cartes_produits').find({ preuve: 'setlist+numero' }).toArray();
    console.log(`\n════ DÉNOMINATEUR : ${lignes.length} lignes « setlist+numero » sur ${total} lignes de jointure ════`);
    const NC = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: [...new Set(lignes.map(l => l.idProduct))] } }, { projection: { idProduct: 1, numero: 1, numeroUrl: 1, slug: 1, codeSet: 1 } }).toArray()).map(n => [n.idProduct, n]));
    const cartes = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, impressions: 1, sets: 1 } }).toArray()).map(c => [c._id, c]));

    const P = planifier({ lignes, NC, cartes, ligneDeSet });
    for (const [cause, { n, ex }] of Object.entries(P.issues).sort((a, b) => b[1].n - a[1].n)) {
        console.log(`\n${String(n).padStart(6)} · ${cause}`);
        for (const e of ex) console.log(`         ${e}`);
    }
    const nBrut = [...P.aPoser.values()].flat().length;
    const hors = horsPlan(P, SEULEMENT);
    if (hors.length) { console.error(`❌ ARRÊT : ${hors.length} idProduct de --seulement ne demandent aucune impression (${hors.slice(0, 8).join(', ')}) — la liste ne correspond pas à l'état de la base, rien n'est écrit`); await fermer(); process.exit(1); }
    const R = restreindre(P, SEULEMENT);
    const nPoser = [...R.aPoser.values()].flat().length;
    const parSet = {}; for (const [id, imps] of R.aPoser) for (const i of imps) parSet[i.expansion] = (parSet[i.expansion] || 0) + 1;
    console.log(`\n   🔑 plan brut : ${nBrut} impressions${SEULEMENT ? ` · retenues par la liste (deux sources non-Bulbapedia) : ${nPoser} · écartées : ${R.ecartees.length} (${[...new Set(R.ecartees.map(e => e.motif.replace(/\(.*\)/, '')))].join(' ; ')})` : ' (aucune liste : tout, ne s\'écrit pas)'}`);
    console.log(`   ${nPoser} impressions à poser sur ${R.aPoser.size} cartes · ${Object.keys(parSet).length} expansions : ${Object.entries(parSet).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([e, n]) => `${e} ${n}`).join(' · ')}`);

    // le contrôle de la garde, par SA fonction : un ajout ne fait baisser aucun compteur
    const touchees = [...R.aPoser.keys()].map(id => cartes.get(id));
    const cmp = comparer(compterEtat({ cartes: touchees }), compterEtat({ cartes: touchees.map(c => ({ ...c, impressions: [...(c.impressions || []), ...R.aPoser.get(c._id)] })) }));
    console.log(`   garde (simulée) : baisses ${cmp.baisses.length} · hausses ${JSON.stringify(cmp.hausses)}`);
    if (cmp.baisses.length) { console.error('🔴 ARRÊT : un ajout ne doit rien faire baisser.'); await fermer(); process.exit(1); }
    if (arg('plan')) fs.writeFileSync(arg('plan'), JSON.stringify(construirePlan(R, ligneDeSet, new Map(lignes.map(l => [l.idProduct, l])))));
    if (!ecrire) { console.log('\n   (simulation — --ecrire pose les impressions, sous lot-additif.js)'); await fermer(); return; }
    const v = LOT.verifierAttendu({ retenus: nPoser, attendu: Number(arg('attendu')) });
    if (!v.ok) { console.error(`❌ ARRÊT : ${v.motif} — rien n'est écrit`); await fermer(); process.exit(1); }

    const code = await ecrireImpressions({ db: cx.db, aPoser: R.aPoser });
    await fermer();
    if (code) process.exit(code);
}

/** L'ÉCRITURE et sa RELECTURE (testable sur une fausse base, relecture 2 D5) : une impression à la fois, refusée par le filtre si la carte la porte déjà ; puis ce qui est en base est relu. @returns {Promise<number>} 0 si tout est relu */
async function ecrireImpressions({ db, aPoser, log = console.log, err = console.error }) {
    let n = 0, total = 0;
    for (const [id, imps] of aPoser) for (const i of imps) {
        total++;
        n += (await db.collection('cartes').updateOne({ _id: id, impressions: { $not: { $elemMatch: { tirage: i.tirage, expansion: i.expansion, numero: i.numero } } } }, { $push: { impressions: { $each: [i] } } })).modifiedCount;
    }
    const cartes = aPoser.size ? await db.collection('cartes').find({ _id: { $in: [...aPoser.keys()] } }).toArray() : [];
    let relues = 0;
    for (const [id, imps] of aPoser) { const c = cartes.find(x => x._id === id); for (const i of imps) if ((c?.impressions || []).some(x => x.source === 'setlist' && x.tirage === i.tirage && x.expansion === i.expansion && x.numero === i.numero)) relues++; }
    log(`\n   RELECTURE : impressions « setlist » écrites ${n}/${total} · relues sur leurs cartes ${relues}/${total}`);
    if (n !== total || relues < total) { err('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); return 1; }
    log('   ✅ écrit et relu');
    return 0;
}
if (require.main === module) principal().catch(e => { console.error('❌', e.message); process.exit(1); });
