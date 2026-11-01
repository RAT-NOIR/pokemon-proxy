// ============================================================
// DES LIGNES DE JOINTURE POSÉES PAR LE NOM SEUL, PRODUIT PAR PRODUIT, SANS REJOUER TOUT LE SET (chasse « fiches » 2, 2026-11-01)
// ============================================================
//   node poser-lignes-nom-seul.js --code=UNP --produits=914410,914411 [--cles=attaques-exactes]                         (simulation : rien n'est écrit)
//   node poser-lignes-nom-seul.js --code=IPNT --nom-seul --produits=654310,654311,...                                      (ligne à Setlist : le mode forcé ne vaut que pour des produits SANS numéro)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-lignes-nom-seul.js --code=UNP --produits=… --attendu=N --ecrire
//
// POURQUOI : `poser-lignes-ciblees.js` refuse les lignes nomSeul / sansPage (son rejeu à blanc ne les couvre pas), et `collecteur-texte.js --reparser` réécrit toute la
// ligne du set. Cet outil rejoue la fonction MÊME de la collecte (collecte-cartes/plan-sans-page.js : joindre() + garde bidirectionnelle du nom seul, calibrée 21 925 justes /
// 0 faux ; clé « nom + attaques exactes » calibrée hors UNP : 39 sets à vérité connue, 209 gardées par la clé, 209 justes, 0 faux) et n'écrit QUE les produits NOMMÉS.
// Ce qu'il autorise (une garde s'écrit par ce qu'elle autorise) : un produit du catalogue de l'expansion, sans ligne, que la garde désigne vers UNE carte ; en mode forcé
// (--nom-seul, pour une ligne à Setlist dont le side deck n'est pas numéroté), seulement un produit SANS numéro appris. Tout le reste est un refus nommé.
// Ce qui s'écrit (ADDITIF, `$setOnInsert`, via ecrireLignes de poser-lignes-ciblees.js) : la ligne, et `liens.idProduct` / `liens.idMetacards` de la carte. L'appartenance
// `cartes.sets` n'est PAS touchée ici : la carte déclare déjà l'impression du set, c'est joindre() qui l'a trouvée par là.
const { planSansPage } = require('./collecte-cartes/plan-sans-page');
const { lireInterdits } = require('./collecte-cartes/lignes-detachees');
const { ecrireLignes } = require('./poser-lignes-ciblees');

const CLES_AUTORISEES = Object.freeze(['attaques-exactes']);
const ARGUMENTS_AUTORISES = [/^--code=[\w.\/-]+$/, /^--produits=\d+(,\d+)*$/, /^--cles=[a-z-]+(,[a-z-]+)*$/, /^--nom-seul$/, /^--attendu=\d+$/, /^--ecrire$/];

/** Le plan, PUR. `existants` : Map idProduct -> ligne déjà posée ; `interdits` : Set des _id de lignes détachées. */
function planifier({ cartes, produits, L, visees, existants, interdits = new Set(), forcerNomSeul = false, cles = [] }) {
    for (const c of cles) if (!CLES_AUTORISEES.includes(c)) throw new Error(`clé « ${c} » inconnue (clés autorisées : ${CLES_AUTORISEES.join(', ')})`);
    if (!forcerNomSeul && !L.bulba.nomSeul) throw new Error(`${L.code} : la ligne n'est pas « nomSeul » — passer --nom-seul (produits sans numéro seulement) ou utiliser poser-lignes-ciblees.js`);
    const Lx = JSON.parse(JSON.stringify(L));
    if (forcerNomSeul) { Lx.bulba.nomSeul = true; Lx.bulba.deck = null; }
    Lx.bulba.cles = cles;
    const { J } = planSansPage({ cartesDuSet: cartes, produitsLus: produits, L: Lx, slugCardmarket: L.slugSet || null });
    const parId = new Map(J.lignes.map(l => [l.idProduct, l]));
    const connus = new Map(produits.map(p => [p.idProduct, p]));
    const lignes = [], refus = [], deja = [];
    for (const id of visees) {
        const p = connus.get(id);
        if (!p) { refus.push({ idProduct: id, raison: `produit ${id} absent du catalogue de l'expansion` }); continue; }
        if (existants.has(id)) { deja.push({ idProduct: id, preuve: existants.get(id).preuve }); continue; }
        if (forcerNomSeul && p.numero != null && String(p.numero).trim() !== '') { refus.push({ idProduct: id, raison: `le produit ${id} porte le numéro ${p.numero} : le mode --nom-seul est réservé aux produits SANS numéro (la clé par le numéro existe)` }); continue; }
        const l = parId.get(id);
        if (!l) { const r = J.restes.find(x => String(x.detail || '').startsWith(String(id))); refus.push({ idProduct: id, raison: `la garde du nom seul ne désigne pas le produit ${id} « ${p.name} »${r ? ` (${String(r.detail).replace(/^\d+\s*/, '').slice(0, 140)})` : ''}` }); continue; }
        if (interdits.has(l._id)) { refus.push({ idProduct: id, raison: `la ligne ${l._id} est détachée (décision du testeur) : interdite, jamais reposée` }); continue; }
        lignes.push(l);
    }
    return { lignes, refus, deja };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.lignes.length !== attendu) return { ok: false, raison: `le plan compte ${plan.lignes.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

async function executer({ argv, ouvrirConnexions, log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !ARGUMENTS_AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    if (inconnus.length || !arg('code') || !arg('produits')) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--code=<code de la table> et --produits=<idProduct,…> obligatoires`); return 2; }
    const ecrire = argv.includes('--ecrire');
    const { ligne } = require('./collecte-cartes/table-sets');
    const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
    const L = ligne(arg('code'));
    if (!L || !L.bulba || !L.exp) { err(`❌ ${arg('code')} : absent de la table`); return 2; }
    const TIRAGE = L.bulba.tirage || 'jp', noms = [].concat(L.bulba.expansion);
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    try {
        const cartes = await cx.db.collection('cartes').find({ impressions: { $elemMatch: { tirage: TIRAGE, expansion: { $in: noms } } } }).toArray();
        const produits = await produitsDeLExpansion(prod, L.exp);
        const visees = arg('produits').split(',').map(Number);
        const existants = new Map((await cx.db.collection('cartes_produits').find({ idProduct: { $in: visees } }, { projection: { preuve: 1, idProduct: 1 } }).toArray()).map(l => [l.idProduct, l]));
        const plan = planifier({ cartes, produits, L, visees, existants, interdits: await lireInterdits(cx.db.collection('restes')), forcerNomSeul: argv.includes('--nom-seul'), cles: (arg('cles') || '').split(',').filter(Boolean) });
        log(`   ${L.code} : ${cartes.length} cartes déclarent ${JSON.stringify(noms)} · ${produits.length} produits · ${visees.length} visé(s)`);
        for (const l of plan.lignes) log(`   + ${l._id} carte ${l.carteId} preuve ${l.preuve} · ${String(l.detail || '').slice(0, 110)}`);
        for (const r of plan.refus) log(`   - REFUS ${r.idProduct} : ${r.raison}`);
        for (const d of plan.deja) log(`   = déjà là ${d.idProduct} (${d.preuve}) : jamais réécrite`);
        log(`\n   PLAN : ${plan.lignes.length} ligne(s) à poser · ${plan.refus.length} refus · ${plan.deja.length} déjà`);
        if (!ecrire) { log('   (simulation — lot-additif.js … -- node poser-lignes-nom-seul.js … --attendu=N --ecrire)'); return 0; }
        const v = verifierAttendu(plan, arg('attendu') === undefined ? undefined : Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const r = await ecrireLignes(cx.db, plan.lignes, new Map(produits.map(p => [p.idProduct, p.idMetacard])));
        const relues = await cx.db.collection('cartes_produits').countDocuments({ _id: { $in: plan.lignes.map(l => l._id) } });
        log(`\n   ✅ lignes posées ${r.lignes}/${plan.lignes.length} · relu : ${relues}/${plan.lignes.length}`);
        return r.lignes === plan.lignes.length && relues === plan.lignes.length ? 0 : 1;
    } finally { await fermer(); }
}

module.exports = { planifier, verifierAttendu, executer, ARGUMENTS_AUTORISES, CLES_AUTORISEES };

if (require.main === module) {
    require('dotenv').config();
    executer({ argv: process.argv.slice(2), ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions }).then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
