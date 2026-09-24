// ============================================================
// POSER SUR LA CARTE LES IMPRESSIONS QUE LA SETLIST DONNE ET QUE L'URL CARDMARKET CONFIRME (2026-09-24)
// ============================================================
//   node poser-impressions-setlist.js                 (simulation : compte, exemples, contrôle de la garde)
//   node lot-additif.js --quoi="…" --collections=cartes -- node poser-impressions-setlist.js --ecrire
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
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { cleNumero } = require('./collecte-cartes/jointure');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
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

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ buckets: [] });
    const ligneDeSet = new Map();
    for (const l of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (l.slugSet && l.bulba && !ligneDeSet.has(l.slugSet)) ligneDeSet.set(l.slugSet, l);
    const total = await cx.db.collection('cartes_produits').countDocuments({});
    const lignes = await cx.db.collection('cartes_produits').find({ preuve: 'setlist+numero' }).toArray();
    console.log(`\n════ DÉNOMINATEUR : ${lignes.length} lignes « setlist+numero » sur ${total} lignes de jointure ════`);
    const NC = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: [...new Set(lignes.map(l => l.idProduct))] } }, { projection: { idProduct: 1, numero: 1, numeroUrl: 1, slug: 1, codeSet: 1 } }).toArray()).map(n => [n.idProduct, n]));
    const cartes = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, impressions: 1, sets: 1 } }).toArray()).map(c => [c._id, c]));

    const issues = {}, aPoser = new Map();   // carteId → [impressions]
    const note = (cause, ex) => { (issues[cause] || (issues[cause] = { n: 0, ex: [] })).n++; if (issues[cause].ex.length < 3) issues[cause].ex.push(ex); };
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
        const deja = [...(c.impressions || []), ...(aPoser.get(c._id) || [])].some(i => i.tirage === l.tirage && i.expansion === expansion && k(i.numero) === k(numero));
        if (deja) { note('impression déjà sur la carte', ex); continue; }
        (aPoser.get(c._id) || aPoser.set(c._id, []).get(c._id)).push({ tirage: l.tirage, expansion, numero, total: null, deck: null, rarete: null, source: 'setlist' });
        note('À POSER : URL et Setlist concordantes, impression absente de la carte', `${ex} · URL ${url} → n°${numero}`);
    }
    for (const [cause, { n, ex }] of Object.entries(issues).sort((a, b) => b[1].n - a[1].n)) {
        console.log(`\n${String(n).padStart(6)} · ${cause}`);
        for (const e of ex) console.log(`         ${e}`);
    }
    const nPoser = [...aPoser.values()].flat().length;
    const parSet = {}; for (const [id, imps] of aPoser) for (const i of imps) parSet[i.expansion] = (parSet[i.expansion] || 0) + 1;
    console.log(`\n   🔑 ${nPoser} impressions à poser sur ${aPoser.size} cartes · ${Object.keys(parSet).length} expansions : ${Object.entries(parSet).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([e, n]) => `${e} ${n}`).join(' · ')}`);

    // le contrôle de la garde, par SA fonction : un ajout ne fait baisser aucun compteur
    const touchees = [...aPoser.keys()].map(id => cartes.get(id));
    const cmp = comparer(compterEtat({ cartes: touchees }), compterEtat({ cartes: touchees.map(c => ({ ...c, impressions: [...(c.impressions || []), ...aPoser.get(c._id)] })) }));
    console.log(`   garde (simulée) : baisses ${cmp.baisses.length} · hausses ${JSON.stringify(cmp.hausses)}`);
    if (cmp.baisses.length) { console.error('🔴 ARRÊT : un ajout ne doit rien faire baisser.'); await fermer(); process.exit(1); }
    if (!ecrire) { console.log('\n   (simulation — --ecrire pose les impressions, sous lot-additif.js)'); await fermer(); return; }

    let n = 0;
    for (const [id, imps] of aPoser) n += (await cx.db.collection('cartes').updateOne({ _id: id }, { $push: { impressions: { $each: imps } } })).modifiedCount;
    const relues = await cx.db.collection('cartes').aggregate([{ $match: { _id: { $in: [...aPoser.keys()] } } }, { $unwind: '$impressions' }, { $match: { 'impressions.source': 'setlist' } }, { $count: 'n' }]).toArray();
    console.log(`\n   ✅ cartes écrites : ${n}/${aPoser.size} · impressions « setlist » relues sur ces cartes : ${relues[0]?.n ?? 0} (attendu ≥ ${nPoser})`);
    await fermer();
    if (n !== aPoser.size || (relues[0]?.n ?? 0) < nPoser) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
