// ============================================================
// PRODUITS QUI MÉLANGENT PLUSIEURS VERSIONS, VARIANTES INDISCERNABLES (décisions du testeur du 2026-11-01) — marqueurs, visuels EMPRUNTÉS, numéro de fiche
// ============================================================
//   node poser-melanges.js --simuler --famille=<f> [--produits=id,id] [--apres-numero-fiche] [--rapport=<f>.json]          (lecture seule : plan, RIEN n'est écrit)
//   node lot-additif.js --quoi="…" --collections=<c> -- node poser-melanges.js --ecrire --famille=<f> --produits=… --attendu=N [--refus=R]
// Familles (une par lot, chacune avec son --attendu) :
//   numero-fiche       cartes_produits.numeroFiche  null -> « 115a » (Guzma BUS), preuve : slug et numéro appris du produit ; ne remplit QUE un null           [--collections=cartes_produits]
//   emprunts           cartes.images : UN visuel EMPRUNTÉ par (carte, set, numéro) de la liste fermée (collecte-cartes/melanges.js::LISTE_EMPRUNTS)           [--collections=cartes]
//   marqueurs-tampons  cartes_produits.marqueurs : produits qui mélangent plusieurs tampons (Guzma : STAFF + CHAMPIONSHIP) ; --produits OBLIGATOIRE pour écrire [--collections=cartes_produits]
//   marqueurs-wcd      cartes_produits.marqueurs : WCD{année} + NON_LEGAL + FINITION_NON_VISIBLE sur les 4 WCD indiscernables                                   [--collections=cartes_produits]
// Toute la décision vit dans collecte-cartes/melanges.js (banc test-melanges.js) ; l'écriture des marqueurs et sa relecture sont CELLES de poser-marqueurs-jumbo.js (relues le 27/10).
// Rien n'est jamais écrasé : marqueurs `$exists:false`, numeroFiche null, $push gardé par (set, numéro).
const MM = require('./collecte-cartes/melanges');
const MQ = require('./collecte-cartes/marqueurs-etiquettes');
const J = require('./poser-marqueurs-jumbo');

const FAMILLES = ['numero-fiche', 'emprunts', 'marqueurs-tampons', 'marqueurs-wcd'];
const compter = (xs, k) => { const o = {}; for (const x of xs) { const c = k(x); o[c] = (o[c] || 0) + 1; } return o; };
const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) ? Object.fromEntries(Object.keys(x).sort().map(c => [c, x[c]])) : x));

async function lire(cx, famille, { produits, apresNumeroFiche }) {
    const db = cx.cartes.db, cp = db.collection('cartes_produits');
    if (famille === 'marqueurs-tampons') return { lignes: await cp.find({ prixMelangeTampon: true }).toArray() };
    if (famille === 'marqueurs-wcd') return { lignes: await cp.find({ idProduct: { $in: Object.keys(MM.FINITION_WCD).map(Number) } }).toArray() };
    if (famille === 'numero-fiche') {
        const ids = Object.keys(MM.NUMEROS_FICHE).map(Number);
        const lignes = await cp.find({ idProduct: { $in: ids } }).toArray();
        const lus = await cx.prod.db.collection('numeros_cartes').find({ idProduct: { $in: ids } }).toArray();
        return { lignes, appris: new Map(lus.map(d => [d.idProduct, { slug: d.slug, numero: d.numero }])) };
    }
    const carteIds = [...new Set(MM.LISTE_EMPRUNTS.map(e => e.carteId))];
    let lignes = await cp.find({ carteId: { $in: carteIds } }).toArray();
    // simulation seulement : l'étape « numero-fiche » est supposée faite (le plan des emprunts de Guzma en dépend)
    if (apresNumeroFiche) lignes = lignes.map(l => (MM.NUMEROS_FICHE[l.idProduct] && l.numeroFiche == null ? { ...l, numeroFiche: MM.NUMEROS_FICHE[l.idProduct].numeroFiche } : l));
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: carteIds } }).toArray()).map(c => [c._id, c]));
    return { lignes, cartes };
}

async function exportIdsDe(cx, ids) {
    const lus = await cx.prod.db.collection('catalogue_produits').find({ idProduct: { $in: ids } }).toArray();
    return new Set(lus.map(d => d.idProduct));
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, log = console.log, err = console.error, garde, ecrireRapport = null, maintenant = new Date() }) {
    const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--famille=[a-z-]+$/, /^--produits=\d+(,\d+)*$/, /^--attendu=\d+$/, /^--refus=\d+$/, /^--apres-numero-fiche$/, /^--rapport=.+\.json$/];
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const ecrireDemande = argv.includes('--ecrire'), simuler = argv.includes('--simuler');
    const famille = arg('famille');
    if (inconnus.length || ecrireDemande === simuler || !FAMILLES.includes(famille)) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --simuler | --ecrire --attendu=N, avec --famille=${FAMILLES.join('|')}`); return 2; }
    const apresNumeroFiche = argv.includes('--apres-numero-fiche');
    if (apresNumeroFiche && ecrireDemande) { err('❌ --apres-numero-fiche est réservé à la simulation : une écriture lit l\'état réel'); return 2; }
    const produits = arg('produits') ? arg('produits').split(',').map(Number) : null;
    const attenduBrut = arg('attendu');
    if (ecrireDemande) {
        garde();   // --ecrire hors de lot-additif.js : refusé avant toute connexion
        if (attenduBrut === undefined) { err('❌ ARRÊT : --attendu=N obligatoire pour écrire — rien n\'est écrit'); return 1; }
        if (famille === 'marqueurs-tampons' && !produits) { err('❌ ARRÊT : --produits=<ids> obligatoire pour écrire des mélanges de tampons (le périmètre est nommé, jamais « tous ») — rien n\'est écrit'); return 1; }
    }
    const cx = ecrireDemande ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const d = await lire(cx, famille, { produits, apresNumeroFiche });
        const db = cx.cartes.db;
        const refusAnnonce = arg('refus');
        const sortie = { le: new Date().toISOString(), famille };
        let aEcrire, refusEcriture = [], refusPreuve = [], ecrireFn, relireFn;
        if (famille === 'numero-fiche') {
            const p = MM.planNumeroFiche(d);
            aEcrire = p.ecrire; refusPreuve = p.refus;
            log(`   NUMÉRO DE FICHE : ${p.ecrire.length} à poser ${JSON.stringify(p.ecrire.map(x => [x.idProduct, x.numeroFiche]))} · ${p.refus.length} refus ${JSON.stringify(compter(p.refus, r => r.raison))}`);
            ecrireFn = async () => { let n = 0; for (const x of aEcrire) n += (await db.collection('cartes_produits').updateOne({ _id: x._id, idProduct: x.idProduct, numeroFiche: null }, { $set: { numeroFiche: x.numeroFiche } })).modifiedCount || 0; return n; };
            relireFn = async avant => { const apres = await db.collection('cartes_produits').find({ _id: { $in: aEcrire.map(x => x._id) } }).toArray(); const av = new Map(avant.map(l => [l._id, l]));
                const sans = l => { const { numeroFiche, ...reste } = l; return reste; };
                const manques = aEcrire.filter(x => apres.find(l => l._id === x._id)?.numeroFiche !== x.numeroFiche).map(x => x._id);
                const alteres = apres.filter(l => av.has(l._id) && stable(sans(l)) !== stable(sans(av.get(l._id)))).map(l => l._id);
                return { ok: !manques.length && !alteres.length, texte: `relu : ${aEcrire.length - manques.length}/${aEcrire.length}${manques.length ? ` · MANQUES ${JSON.stringify(manques)}` : ''}${alteres.length ? ` · AUTRES CHAMPS BOUGÉS ${JSON.stringify(alteres)}` : ''}` }; };
            sortie.ecrire = aEcrire; sortie.refus = refusPreuve;
        } else if (famille === 'emprunts') {
            const p = MM.planEmprunts({ lignes: d.lignes, cartes: d.cartes, maintenant });
            aEcrire = p.ajouts; refusEcriture = p.refus;
            log(`   EMPRUNTS : ${p.ajouts.length} entrée(s) pour ${p.ajouts.reduce((n, a) => n + a.produits.length, 0)} produit(s) ${JSON.stringify(p.ajouts.map(a => [a.set, a.numero, a.produits]))} · ${p.deja.length} déjà couvertes · ${p.refus.length} refus ${JSON.stringify(compter(p.refus, r => r.raison.replace(/\(.*\)/, '')))}`);
            for (const r of p.refus) log(`      REFUS ${r.set} n°${r.numero ?? '—'} (${r.produits.join(', ')}) : ${r.raison}`);
            ecrireFn = async () => { let n = 0; for (const o of MM.operationsEmprunts(p)) n += (await db.collection(o.coll).updateOne(o.filter, o.update)).modifiedCount || 0; return n; };
            relireFn = async () => { const cartes = await db.collection('cartes').find({ _id: { $in: aEcrire.map(a => a.carteId) } }).toArray(); const par = new Map(cartes.map(c => [c._id, c]));
                const manques = aEcrire.filter(a => (par.get(a.carteId)?.images || []).filter(i => i.set === a.set && i.lot === MM.LOT && i.cleR2 === a.entree.cleR2 && i.imageEmprunteeTirage === true && (i.numero ?? null) === (a.numero ?? null)).length !== 1).map(a => `${a.carteId}|${a.set}|${a.numero}`);
                return { ok: !manques.length, texte: `relu : ${aEcrire.length - manques.length}/${aEcrire.length}${manques.length ? ` · MANQUES ${JSON.stringify(manques)}` : ''}` }; };
            sortie.ecrire = aEcrire.map(a => ({ carteId: a.carteId, set: a.set, numero: a.numero, produits: a.produits, cleR2: a.entree.cleR2 })); sortie.refus = refusEcriture; sortie.manifeste = MM.manifeste(p);
        } else {
            const pm = famille === 'marqueurs-tampons' ? MM.planMelangesTampons({ lignes: d.lignes }) : MM.planFinitionWcd({ lignes: d.lignes });
            const cibles = produits ? pm.cibles.filter(c => produits.includes(c.idProduct)) : pm.cibles;
            refusPreuve = produits ? pm.refus.filter(r => produits.includes(r.idProduct)) : pm.refus;
            const horsProduits = produits ? pm.cibles.filter(c => !produits.includes(c.idProduct)) : [];
            for (const id of (produits || []).filter(id => !pm.cibles.some(c => c.idProduct === id) && !pm.refus.some(r => r.idProduct === id))) refusPreuve.push({ idProduct: id, famille, raison: 'produit-hors-de-la-famille' });
            const plan = { ...MQ.planifierEcriture({ cibles, lignes: d.lignes, exportIds: await exportIdsDe(cx, cibles.map(c => c.idProduct)) }) };
            aEcrire = plan.ecrire; refusEcriture = plan.refus;
            log(`   CIBLES PROUVÉES : ${cibles.length} ${JSON.stringify(cibles.map(c => [c.idProduct, c.marqueurs.map(m => m.type), c.libelle?.fr ?? null]))}${horsProduits.length ? ` · ${horsProduits.length} autre(s) cible(s) hors --produits : ${horsProduits.map(c => c.idProduct).join(',')}` : ''}`);
            log(`   REFUS DE PREUVE (trous nommés) : ${refusPreuve.length} ${JSON.stringify(compter(refusPreuve, r => r.raison))}`);
            log(`   PLAN : ${plan.ecrire.length} ligne(s) · ${plan.refus.length} refus d'écriture ${JSON.stringify(compter(plan.refus, r => r.raison.replace(/\(.*\)/, '…')))} · ${plan.deja.length} déjà`);
            ecrireFn = async () => (await J.ecrire(db, plan.ecrire)).posees;
            relireFn = async avant => { const rl = await J.relire(db, plan.ecrire, avant); return { ok: rl.ok, texte: `relu : ${rl.presentes}${rl.manques.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}${rl.alteres.length ? ` · AUTRES CHAMPS BOUGÉS ${JSON.stringify(rl.alteres)}` : ''}` }; };
            sortie.ecrire = plan.ecrire; sortie.refus = plan.refus; sortie.refusPreuve = refusPreuve; sortie.deja = plan.deja;
        }
        const rapport = arg('rapport');
        if (rapport && ecrireRapport) ecrireRapport(rapport, sortie);
        if (!ecrireDemande) { log('   (simulation — rien n\'est écrit)'); return 0; }
        const attendu = Number(attenduBrut);
        if (aEcrire.length !== attendu) { err(`❌ ARRÊT : le plan compte ${aEcrire.length}, attendu ${attendu} — rien n'est écrit`); return 1; }
        if (refusEcriture.length && Number(refusAnnonce) !== refusEcriture.length) { err(`❌ ARRÊT : ${refusEcriture.length} refus d'écriture au plan, ${refusAnnonce === undefined ? 'non annoncés (--refus=N)' : `${refusAnnonce} annoncés`} — rien n'est écrit`); return 1; }
        const idsAvant = aEcrire.map(x => x._id).filter(Boolean);
        const avant = idsAvant.length ? await db.collection('cartes_produits').find({ _id: { $in: idsAvant } }).toArray() : [];
        const posees = await ecrireFn();
        const rl = await relireFn(avant);
        const bon = posees === aEcrire.length && rl.ok;
        log(`\n   ${bon ? '✅' : '❌'} posées ${posees}/${aEcrire.length} · ${rl.texte}`);
        return bon ? 0 : 1;
    } finally { await cx.fermer(); }
}

module.exports = { FAMILLES, executer };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    const fs = require('fs');
    const ouvrirLecture = async () => {
        const { ouvrirLecture: ol } = require('./collecte-cartes/ouvrir-lecture');
        const l = await ol(); if (!l) throw new Error('connexion de lecture seule indisponible (MONGODB_CARTES_LECTURE_URI)');
        const { prod, fermer } = await require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
        return { cartes: l.cartes, prod, fermer: async () => { await l.fermer(); await fermer(); } };
    };
    executer({ argv: process.argv.slice(2), ouvrirLecture,
        ouvrirEcriture: async () => { const o = await require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }); return { cartes: o.cartes, prod: o.prod, fermer: o.fermer }; },
        garde: () => require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid),
        ecrireRapport: (f, x) => fs.writeFileSync(f, JSON.stringify(x, null, 1)) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
