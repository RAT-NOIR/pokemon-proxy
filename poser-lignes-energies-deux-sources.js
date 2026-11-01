// ============================================================
// DES LIGNES D'ÉNERGIES DE BASE POSÉES SUR DEUX SOURCES DE FAITS (Intro Pack Neo, décision du coordinateur du 2026-11-01)
// ============================================================
//   node poser-lignes-energies-deux-sources.js --liste=<liste>.json                                                          (simulation : rien n'est écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-lignes-energies-deux-sources.js --liste=… --attendu=N --ecrire
//
// POURQUOI : une énergie d'un Intro Pack (« Water Energy » n°5) est une IMPRESSION d'une carte d'énergie de base qui existe déjà dans le set : fiche simple = doublon (la garde de
// poser-fiches-deux-sources.js le refuse à juste titre), ce qui manque est la LIGNE produit → carte. La liste d'entrée est celle de scanner-deux-sources : par produit, les relevés des
// deux sources de faits (codes neutres `ppd`, `tcs`) sur le numéro et le type.
// Ce que l'outil AUTORISE (une garde s'écrit par ce qu'elle autorise ; tout le reste est un refus nommé) : un produit du catalogue de l'expansion du set, de nom « <Type> Energy » (table fermée),
// sans ligne ; jugé par collecte-cartes/deux-sources.js (importé) : set, numéro et type concordent avec LES DEUX sources `ppd` ET `tcs` ; le type désigne UNE seule carte d'énergie de base du set
// (lue en base par son nom exact, jamais en dur) ; la ligne n'est pas détachée (lireInterdits).
// Ce qui s'écrit (ADDITIF, `$setOnInsert`, via ecrireLignes de poser-lignes-ciblees.js) : la ligne (preuve neutre, numeroFiche = le numéro lu) et `liens` de la carte. `cartes.sets` N'EST PAS touché.
// `detail` est interne (aucun contrat site/API ne le lit) ; il ne porte que les codes neutres.
const fs = require('fs');
const { juger } = require('./collecte-cartes/deux-sources');
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const { lireInterdits } = require('./collecte-cartes/lignes-detachees');
const { ecrireLignes } = require('./poser-lignes-ciblees');

const SOURCES_REQUISES = Object.freeze(['ppd', 'tcs']);
const TYPES = Object.freeze(['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting']);
const PREUVE = 'deux-sources:faits+numero';
const ARGUMENTS_AUTORISES = [/^--liste=.+\.json$/, /^--attendu=\d+$/, /^--ecrire$/];
const nu = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Le plan, PUR. Ls : Map slug -> { exp, tirage, slugSet, code } ; produitsParExp : Map exp -> [{ idProduct, name, numero, idMetacard }] ; cartesDuSet : Map slug -> cartes ; existants : Set d'idProduct ; interdits : Set de « carteId|idProduct ». */
function planifier({ liste, Ls, produitsParExp, cartesDuSet, existants = new Set(), interdits = new Set() }) {
    const lignes = [], refus = [], deja = [];
    for (const [cle, e] of Object.entries(liste)) {
        const id = Number(cle), non = raison => refus.push({ idProduct: id, raison });
        const L = Ls.get(e.set);
        if (!L) { non(`le set « ${e.set} » n'est pas une ligne connue de l'outil`); continue; }
        const p = (produitsParExp.get(L.exp) || []).find(x => x.idProduct === id);
        if (!p) { non(`le produit ${id} n'est pas dans le catalogue de l'expansion ${L.exp}`); continue; }
        if (existants.has(id)) { deja.push({ idProduct: id }); continue; }
        const nomP = decomposerNomCardmarket(p.name).nom, m = /^(\w+) Energy$/.exec(nomP);
        if (!m || !TYPES.includes(m[1])) { non(`le produit « ${nomP} » n'est pas une énergie de base de la table fermée (${TYPES.join(', ')})`); continue; }
        const j = juger({ set: e.set, numero: p.numero, nom: nomP }, e.concordantes);
        const vues = new Set(j.concordantes.map(c => c.source)), manque = SOURCES_REQUISES.filter(s => !vues.has(s));
        if (manque.length) { non(`seconde source manquante ou discordante : ${manque.join(', ')} ne concorde pas sur le set, le numéro ${p.numero} et le type « ${nomP} »${j.refusees.length ? ` (${j.refusees.map(r => `${r.source}: ${r.raison}`).join(' ; ').slice(0, 160)})` : ''}`); continue; }
        const voulus = [nu(`${m[1]} Energy`), nu(`Basic ${m[1]} Energy`)];
        const cartes = (cartesDuSet.get(e.set) || []).filter(c => !c.ficheSimple && voulus.includes(nu(c.nomEn)));
        if (cartes.length !== 1) { non(`le type ${m[1]} désigne ${cartes.length} carte(s) d'énergie de base dans le set (${cartes.slice(0, 4).map(c => c._id).join(', ')}) : il en faut exactement une`); continue; }
        const carte = cartes[0], lid = `${carte._id}|${id}`;
        if (interdits.has(lid)) { non(`la ligne ${lid} est détachée (décision du testeur) : interdite, jamais reposée`); continue; }
        lignes.push({ _id: lid, carteId: carte._id, idProduct: id, idExpansion: L.exp, tirage: L.tirage, preuve: PREUVE, slug: null, slugSet: L.slugSet, numeroFiche: String(p.numero), code: L.code,
            detail: `énergie de base « ${nomP} » n°${p.numero} : numéro et type confirmés par ${SOURCES_REQUISES.join(' + ')} (+ Cardmarket), carte ${carte._id} unique de ce type dans le set`, verifieLe: new Date(), route: `energies-deux-sources:${L.exp}` });
    }
    return { lignes, refus, deja };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.lignes.length !== attendu) return { ok: false, raison: `le plan compte ${plan.lignes.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

async function executer({ argv, ouvrirConnexions, lireListe = f => JSON.parse(fs.readFileSync(f, 'utf8')), log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !ARGUMENTS_AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    if (inconnus.length || !arg('liste')) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--liste=<fichier>.json obligatoire`); return 2; }
    const ecrire = argv.includes('--ecrire');
    if (ecrire && arg('attendu') === undefined) { err('❌ --ecrire exige --attendu=N — rien n\'est écrit'); return 2; }
    let liste; try { liste = lireListe(arg('liste')); } catch (e) { err(`❌ liste illisible (${e.message}) — rien n'est écrit`); return 2; }
    const { ligne } = require('./collecte-cartes/table-sets');
    const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
    const Ls = new Map();
    for (const code of ['IPNT', 'IPNC']) { const L = ligne(code); if (!L || !L.slugSet || !L.exp) { err(`❌ ${code} : absent de la table`); return 2; } Ls.set(L.slugSet, { exp: L.exp, tirage: L.bulba.tirage || 'jp', slugSet: L.slugSet, code }); }
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    try {
        const produitsParExp = new Map(), cartesDuSet = new Map();
        for (const L of Ls.values()) { produitsParExp.set(L.exp, await produitsDeLExpansion(prod, L.exp)); cartesDuSet.set(L.slugSet, await cx.db.collection('cartes').find({ sets: L.slugSet }).toArray()); }
        const ids = Object.keys(liste).map(Number);
        const existants = new Set((await cx.db.collection('cartes_produits').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1 } }).toArray()).map(l => l.idProduct));
        const plan = planifier({ liste, Ls, produitsParExp, cartesDuSet, existants, interdits: await lireInterdits(cx.db.collection('restes')) });
        log(`   DÉNOMINATEUR : ${ids.length} produits dans la liste · cartes lues ${[...cartesDuSet].map(([s, c]) => `${s} ${c.length}`).join(' · ')}`);
        for (const l of plan.lignes) log(`   + ${l._id} n°${l.numeroFiche} (${l.code}) · ${l.detail.slice(0, 90)}`);
        for (const r of plan.refus) log(`   - REFUS ${r.idProduct} : ${r.raison}`);
        for (const d of plan.deja) log(`   = déjà là ${d.idProduct} : jamais réécrite`);
        log(`\n   PLAN : ${plan.lignes.length} ligne(s) à poser · ${plan.refus.length} refus · ${plan.deja.length} déjà${ecrire ? '' : ' — (simulation)'}`);
        if (!ecrire) return 0;
        const v = verifierAttendu(plan, Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const r = await ecrireLignes(cx.db, plan.lignes, new Map([...produitsParExp.values()].flat().map(p => [p.idProduct, p.idMetacard])));
        const relues = await cx.db.collection('cartes_produits').countDocuments({ _id: { $in: plan.lignes.map(l => l._id) } });
        log(`\n   ✅ lignes posées ${r.lignes}/${plan.lignes.length} · relu : ${relues}/${plan.lignes.length}`);
        return r.lignes === plan.lignes.length && relues === plan.lignes.length ? 0 : 1;
    } finally { await fermer(); }
}

module.exports = { planifier, verifierAttendu, executer, ARGUMENTS_AUTORISES, SOURCES_REQUISES, TYPES, PREUVE };

if (require.main === module) {
    require('dotenv').config();
    executer({ argv: process.argv.slice(2), ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions }).then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
