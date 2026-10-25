// ============================================================
// LES LIGNES QUE joindre() DÉSIGNE DÉJÀ — posées une à une, en ajout pur (PHASE 3a-SUITE, paquet 2, accord du coordinateur 2026-10-24)
// ============================================================
//   node poser-lignes-rejeu.js --codes=XY-P,smG --export… (mesure : le plan, rien n'est écrit)
//   node poser-lignes-rejeu.js --codes=… --seulement=<liste>.json [--plan=<f>.json]
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-lignes-rejeu.js --codes=… --seulement=<liste>.json --attendu=XY-P:23,… --ecrire
//
// Pourquoi : `collecteur-texte.js --reparser` réécrit le set ENTIER (ses lignes, les champs de ses cartes depuis l'archive : 6 cartes y perdraient leur `rarete`), donc il ne s'écrit que si TOUTES ses lignes
// nouvelles sont confirmées par deux sources. Or `joindre()` désigne déjà, produit par produit, la carte de beaucoup de produits sans ligne (la carte est arrivée au set après la dernière collecte :
// cause « A » de classer-sans-ligne.js). Cet outil pose SEULEMENT ces lignes-là, pour les produits que la règle des deux sources a confirmés — `joindre()` rejoué par collecte-cartes/rejeu-set.js, la même
// copie que mesurer-sans-ligne.js, avec son témoin du nom et ses lignes détachées.
// ÉCRIT PAR CE QU'IL AUTORISE :
//  · une ligne s'écrit si elle porte la preuve « set+numero » (le numéro du produit EST l'impression que la carte déclare dans ce set) ET un numéro de fiche, pour un produit SANS ligne, joint à UNE seule carte ;
//    « setlist+numero » (impression virtuelle, à écrire d'abord : poser-impressions-setlist.js), les replis par le nom, les produits à plusieurs cartes : refusés et nommés ;
//  · `--seulement=<f>.json` est OBLIGATOIRE pour écrire : la liste des idProduct confirmés (construire-liste-lot.js) ; un idProduct de la liste que le plan ne propose pas refuse TOUT ;
//  · `--attendu=CODE:N` pour chaque code, compté sur le plan RETENU ; sans lui, rien ;
//  · AJOUT PUR : `$setOnInsert` de la ligne (jamais d'écrasement), `$addToSet` de `liens.idProduct`, `liens.idMetacards` et `sets` sur la carte, par la liste fermée de regle-r-fiches.js (ni `nomEn` ni l'ordre de
//    liens.idProduct ne bougent : le repère d'adresse du site est conservé) ; aucun reste remplacé, aucune carte réécrite, aucune image ;
//  · relecture après écriture : ce qui est en base, pas ce que le bulkWrite a rendu.
require('dotenv').config();
const fs = require('fs');
const { creerRejeu } = require('./collecte-cartes/rejeu-set');
const { lireInterdits } = require('./collecte-cartes/lignes-detachees');
const { garderMatiereSpeciale } = require('./collecte-cartes/matiere-speciale');
const LOT = require('./collecte-cartes/lot-seulement');
const R = require('./collecte-cartes/regle-r-fiches');
const { clesNom, nomJointDe } = require('./collecte-cartes/jointure');

const PREUVE_AUTORISEE = 'set+numero';
const AUTORISES = [/^--codes=[\w.,/-]+$/, /^--seulement=.+\.json$/, /^--attendu=[\w.:,/-]+$/, /^--plan=.+\.json$/, /^--ecrire$/];

/**
 * Parmi les lignes de joindre() pour une expansion : celles que l'outil RETIENT, et chaque refus nommé (un par produit).
 */
function trierLignes({ lignes, dejaJoints, concorde }) {
    // une ligne vue deux fois (deux lignes de table verifiees de la meme expansion) n'est UNE ligne qu'une fois : l'_id la designe
    const vues = new Set(), uniques = [];
    for (const l of lignes) { if (vues.has(l._id)) continue; vues.add(l._id); uniques.push(l); }
    const parProduit = new Map();
    for (const l of uniques) (parProduit.get(l.idProduct) || parProduit.set(l.idProduct, []).get(l.idProduct)).push(l);
    const retenues = [], refus = [];
    for (const [idProduct, ls] of parProduit) {
        if (dejaJoints.has(idProduct)) { refus.push({ idProduct, motif: 'a déjà une ligne (aucun produit qui a une ligne n\'est touché)' }); continue; }
        if (ls.length > 1) { refus.push({ idProduct, motif: `produit joint à plusieurs cartes (${ls.map(l => l.carteId).join(', ')}) : un produit est UNE carte` }); continue; }
        const l = ls[0];
        if (l.preuve !== PREUVE_AUTORISEE) { refus.push({ idProduct, motif: `preuve « ${l.preuve} » : seule « ${PREUVE_AUTORISEE} » s'écrit ici${l.preuve === 'setlist+numero' ? ' (l\'impression est virtuelle : poser-impressions-setlist.js d\'abord)' : ''}` }); continue; }
        if (l.numeroFiche == null || String(l.numeroFiche).trim() === '') { refus.push({ idProduct, motif: 'sans numéro de fiche : la fiche serait mélangée ou douteuse' }); continue; }
        if (!concorde(l)) { refus.push({ idProduct, motif: 'nom discordant : le nom du produit n\'est pas celui de la carte jointe (le témoin de joindre() ne suffit pas ici)' }); continue; }
        retenues.push(l);
    }
    return { retenues, refus };
}

/**
 * @param {object} o
 * @param {string[]} o.argv  @param {object[]} o.table  les lignes de table (code, exp, slugSet, verifie, bulba)
 * @param {()=>Promise<{db: object, fermer: ()=>Promise}>} o.ouvrir  ouvre la base `cartes`
 * @param {(L:object)=>Promise<object[]>} o.produitsDe  les produits décomposés de l'expansion d'une ligne
 * @param {(cleR2:string)=>Promise<string>} o.lireTexte  l'archive R2
 * @returns {Promise<number>} le code de sortie
 */
async function executer({ argv, table, ouvrir, produitsDe, lireTexte, lireFichier = f => fs.readFileSync(f, 'utf8'), log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire');
    const CODES = (arg('codes') || '').split(',').filter(Boolean);
    if (!CODES.length) { err('❌ --codes=<CODE>[,…] obligatoire'); return 2; }
    const doublons = CODES.filter((c, i) => CODES.indexOf(c) !== i);
    if (doublons.length) { err(`❌ --codes en doublon : ${[...new Set(doublons)].join(', ')} — rien n'est écrit`); return 2; }
    const ATTENDUS = Object.fromEntries((arg('attendu') || '').split(',').filter(Boolean).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
    const horsCodes = Object.keys(ATTENDUS).filter(c => !CODES.includes(c));
    if (horsCodes.length) { err(`❌ --attendu pour un code non demandé : ${horsCodes.join(', ')} — rien n'est écrit`); return 2; }
    let SEULEMENT = null;
    if (arg('seulement')) { try { SEULEMENT = LOT.lire('--seulement', () => lireFichier(arg('seulement'))); } catch (e) { err(`❌ ${e.message} — rien n'est écrit`); return 2; } }
    if (ecrire) {
        if (!SEULEMENT) { err('❌ --ecrire exige --seulement=<liste>.json : cet outil n\'écrit que ce qu\'une liste de produits CONFIRMÉS autorise — rien n\'est écrit'); return 2; }
        const manquants = CODES.filter(c => !Number.isInteger(ATTENDUS[c]));
        if (manquants.length) { err(`❌ --ecrire exige --attendu=CODE:N pour chaque code (manque : ${manquants.join(', ')}) — rien n'est écrit`); return 2; }
    }
    const lignesDe = code => table.filter(l => l.code === code && l.verifie && l.exp && l.bulba);
    const absents = CODES.filter(c => !lignesDe(c).length);
    if (absents.length) { err(`❌ code(s) absent(s) de la table, ou sans ligne vérifiée : ${absents.join(', ')} — rien n'est écrit`); return 1; }

    const { db, fermer } = await ouvrir();
    try {
        const cartes = await db.collection('cartes').find({}, { projection: { nomEn: 1, niveau: 1, attaques: 1, impressions: 1, sets: 1, 'bulba.titre': 1, 'liens.idProduct': 1, ficheSimple: 1 } }).toArray();
        const sets = await db.collection('sets').find({}, { projection: { bulba: 1 } }).toArray();
        const etats = await db.collection('collecte_etat').find({}, { projection: { pages: 1 } }).toArray();
        const existantes = await db.collection('cartes_produits').find({}, { projection: { idProduct: 1 } }).toArray();
        const lignesInterdites = await lireInterdits(db.collection('restes'));
        for (const [n, l] of [['cartes', cartes], ['sets', sets], ['cartes_produits', existantes]]) if (!l.length) throw new Error(`« ${n} » est VIDE : une jointure rejouée sur du vide ne mesure rien (§41)`);
        const dejaJoints = new Set(existantes.map(l => l.idProduct));
        const avantTotal = existantes.length;
        const rejeu = creerRejeu({ cartes, setParId: new Map(sets.map(s => [s._id, s])), etatPages: new Map(etats.map(e => [e._id, e])), lireTexte });

        const aEcrire = [], vus = new Set(), parCode = {};
        for (const CODE of CODES) {
            // toutes les lignes de table verifiees du code : leurs lignes sont reunies (une ligne vue deux fois n'est qu'une ligne), puis triees UNE fois
            const brutes = [], ligneDe = new Map(), produitDe = new Map();
            for (const L of lignesDe(CODE)) {
                const produits = await produitsDe(L);
                for (const p of produits) produitDe.set(p.idProduct, p);
                const { Jr } = await rejeu.joindreLigne({ l: L, exp: L.exp, produits, lignesInterdites });
                for (const l of Jr.lignes) { brutes.push(l); if (!ligneDe.has(l._id)) ligneDe.set(l._id, L); }
            }
            // le nom du produit est celui de la carte jointe : la meme cle que le temoin de joindre() (clesNom / nomJointDe), lue des deux cotes
            const carteDe = new Map(cartes.map(c => [c._id, c]));
            const concorde = l => { const c = carteDe.get(l.carteId), p = produitDe.get(l.idProduct); if (!c || !p) return false; const cles = clesNom(p.nom ?? p.name); return clesNom(nomJointDe(c)).some(k => cles.includes(k)); };
            const t = trierLignes({ lignes: brutes, dejaJoints, concorde });
            const retenuesCode = t.retenues.map(l => ({ l, L: ligneDe.get(l._id) })), refusCode = t.refus;
            for (const l of t.retenues) vus.add(l.idProduct);            const rs = LOT.restreindre(retenuesCode, SEULEMENT, x => x.l.idProduct);
            parCode[CODE] = { propose: retenuesCode.length, retenues: rs.retenus.length, ecartes: rs.ecartes.length };
            const motifs = {}; for (const r of refusCode) { const m = r.motif.replace(/\(.*?\)/, '(…)').replace(/« [^»]*»/, '« … »'); motifs[m] = (motifs[m] || 0) + 1; }
            log(`\n■ ${CODE} · ${retenuesCode.length} lignes sûres proposées par joindre() · ${rs.retenus.length} retenues${SEULEMENT ? ` (${rs.ecartes.length} écartées : non confirmées)` : ''} · ${refusCode.length} produits refusés${Object.keys(motifs).length ? ' : ' + Object.entries(motifs).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n} × ${m}`).join(' · ') : ''}`);
            for (const x of rs.retenus.slice(0, 8)) log(`   + ${x.l.idProduct} → carte ${x.l.carteId} (n°${x.l.numeroFiche}, ${x.l.preuve})`);
            if (ecrire && ATTENDUS[CODE] !== rs.retenus.length) { err(`❌ ARRÊT : ${CODE} rend ${rs.retenus.length} lignes, attendu ${ATTENDUS[CODE]} — rien n'est écrit`); return 1; }
            for (const x of rs.retenus) aEcrire.push({ ...x, CODE });
        }
        const hors = LOT.horsPlan(SEULEMENT, vus);
        if (hors.length) { err(`❌ ARRÊT : ${hors.length} idProduct de --seulement ne sont proposés par aucun code (${hors.slice(0, 8).join(', ')}) — la liste ne correspond pas à l'état de la base, rien n'est écrit`); return 1; }
        log(`\n   ${aEcrire.length} lignes${ecrire ? '' : ' — (simulation)'}`);
        const fichierPlan = arg('plan');
        if (fichierPlan) fs.writeFileSync(fichierPlan, JSON.stringify({ outil: 'poser-lignes-rejeu', lignes: aEcrire.map(x => ({ _id: x.l._id, carteId: x.l.carteId, idProduct: x.l.idProduct, idExpansion: x.l.idExpansion, tirage: x.l.tirage, preuve: x.l.preuve, slug: x.l.slug, slugSet: x.l.slugSet, numeroFiche: x.l.numeroFiche, code: x.CODE })), cartesSets: aEcrire.map(x => ({ carteId: x.l.carteId, set: x.L.slugSet || x.L.code })) }));
        try { garderMatiereSpeciale(aEcrire.map(x => x.l.idProduct), 'poser-lignes-rejeu'); } catch (e) { err(e.message); return 1; }
        if (!ecrire || !aEcrire.length) return 0;

        // ── l'écriture, en AJOUT PUR ──
        const metaDe = new Map(); for (const x of aEcrire) metaDe.set(x.l.idProduct, null);
        const parCarte = new Map();
        for (const x of aEcrire) { const v = parCarte.get(x.l.carteId) || parCarte.set(x.l.carteId, { ids: [], metas: new Set(), sets: new Set() }).get(x.l.carteId); v.ids.push(x.l.idProduct); v.sets.add(x.L.slugSet || x.L.code); }
        const ops = R.operationsCartes(parCarte); R.garderEcritureSite(ops);
        await db.collection('cartes_produits').bulkWrite(aEcrire.map(x => ({ updateOne: { filter: { _id: x.l._id }, update: { $setOnInsert: x.l }, upsert: true } })), { ordered: false });
        await db.collection('cartes').bulkWrite(ops, { ordered: false });

        // ── la RELECTURE : ce qui est en base ──
        const ids = aEcrire.map(x => x.l._id);
        const relues = await db.collection('cartes_produits').find({ _id: { $in: ids } }, { projection: { preuve: 1, numeroFiche: 1 } }).toArray();
        const lignesOk = relues.filter(l => l.preuve === PREUVE_AUTORISEE && l.numeroFiche != null).length;
        const apresTotal = await db.collection('cartes_produits').countDocuments({});
        const cartesRelues = await db.collection('cartes').find({ _id: { $in: [...parCarte.keys()] } }, { projection: { liens: 1, sets: 1 } }).toArray();
        const parId = new Map(cartesRelues.map(c => [c._id, c]));
        const liensOk = aEcrire.filter(x => (parId.get(x.l.carteId)?.liens?.idProduct || []).includes(x.l.idProduct) && (parId.get(x.l.carteId)?.sets || []).includes(x.L.slugSet || x.L.code)).length;
        log(`\n   RELECTURE : lignes ${lignesOk}/${ids.length} · cartes avec leur lien et leur set ${liensOk}/${ids.length} · cartes_produits ${avantTotal} → ${apresTotal} (attendu ${avantTotal + ids.length})`);
        if (lignesOk !== ids.length || liensOk !== ids.length || apresTotal !== avantTotal + ids.length) { err('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}

module.exports = { executer, trierLignes, PREUVE_AUTORISEE };

if (require.main === module) {
    (async () => {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const r2 = require('./collecte-cartes/r2');
        const J = require('./collecte-cartes/jointure');
        const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
        const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
        await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
        const code = await executer({
            argv: process.argv.slice(2), table: [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE],
            ouvrir: async () => ({ db: cx.db, fermer: async () => { } }),
            produitsDe: L => J.produitsDeLExpansion(prod, L.exp),
            lireTexte: cle => r2.lireTexte(process.env.R2_BUCKET_BRUT, cle)
        });
        await fermer();
        process.exit(code);
    })().catch(e => { console.error(e); process.exit(1); });
}
