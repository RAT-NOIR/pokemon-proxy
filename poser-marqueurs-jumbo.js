// ============================================================
// POSER `cartes_produits.marqueurs` JUMBO (+ NON_LEGAL) SUR LES PRODUITS QUE CARDMARKET ÉTIQUETTE « OVERSIZED » (contrat MARQUEURS v1 de l'API, 2026-10-27)
// ============================================================
//   node poser-marqueurs-jumbo.js --simuler                                                         (lecture seule : plan, RIEN n'est écrit)
//   node lot-additif.js --quoi="marqueurs JUMBO : N produits" --collections=cartes_produits -- node poser-marqueurs-jumbo.js --ecrire --attendu=N --refus=R   (N et R lus à la simulation)
//
// ⛔ N'ÉCRIRE QU'APRÈS L'ANNONCE DE L'API que son module `v2/identifier/marqueurs.js` est en service (CONTRAT-MARQUEURS.md, §4 ; journal du 26/10 23:50 UTC).
// La SOURCE : l'étiquette de Cardmarket lui-même (pastille rouge « Attention: Oversized Card · Not Tournament Legal »), relevée en passif le 2026-10-17 et lue par OCR
// (S7\STAFF-DETECT\inventaire-etiquettes.json, classe « jumbo » ET le texte « Oversized Card » dans l'OCR). « Not Tournament Legal » lu sur la même pastille → NON_LEGAL.
// TÉMOIN (cité, jamais requis) : le clone TCGdex quand une variante `size: "jumbo"` porte le MÊME idProduct (il se trompe parfois d'idProduct : Legendary Collection 274768/362871).
// ADDITIF PUR : `$set` de `marqueurs` et `marqueursPreuve` sur une ligne qui ne porte pas `marqueurs` ; une valeur présente (même `[]` ou `null`) n'est jamais écrasée.
// REFUS NOMMÉS : produit absent de l'export du jour, aucune ligne ou plusieurs lignes, variante prouvée autre que « jumbo » (elle contredit l'étiquette).
const ORDRE = Object.freeze(['JUMBO', 'NON_LEGAL']);   // l'ordre de la table du §3 du contrat
const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) ? Object.fromEntries(Object.keys(x).sort().map(c => [c, x[c]])) : x));
const sansChamps = l => { const { marqueurs: _m, marqueursPreuve: _p, ...reste } = l || {}; return reste; };
const lit = (ocr, re) => (ocr || []).some(t => re.test(String(t)));

/** @param {{etiquettes: object[], lignes: object[], exportIds: Set<number>, tcgdexJumbo: Set<number>, releveLe: string}} e */
function planifier({ etiquettes, lignes, exportIds, tcgdexJumbo, releveLe }) {
    const ecrire = [], refus = [], deja = [];
    const parId = new Map(); for (const l of lignes || []) parId.set(l.idProduct, [...(parId.get(l.idProduct) || []), l]);
    const vus = new Set();
    for (const e of etiquettes || []) {
        if (e.classe !== 'jumbo' || !lit(e.ocr, /oversized card/i)) continue;
        const id = e.idProduct;
        if (vus.has(id)) continue;   // une étiquette relevée deux fois : une seule écriture
        vus.add(id);
        if (!exportIds.has(id)) { refus.push({ idProduct: id, raison: 'absent de l\'export Cardmarket du jour' }); continue; }
        const ls = parId.get(id) || [];
        if (ls.length !== 1) { refus.push({ idProduct: id, raison: ls.length ? `${ls.length} lignes cartes_produits — une seule attendue` : 'aucune ligne cartes_produits' }); continue; }
        const l = ls[0];
        if (l._id === undefined || l._id === null) { refus.push({ idProduct: id, raison: 'ligne cartes_produits sans _id' }); continue; }
        if (l.variante != null && l.variante !== 'jumbo') { refus.push({ idProduct: id, raison: `variante « ${l.variante} » posée sur la ligne : elle contredit l'étiquette « Oversized »` }); continue; }
        const types = ['JUMBO', ...(lit(e.ocr, /not tournament legal/i) ? ['NON_LEGAL'] : [])].sort((a, b) => ORDRE.indexOf(a) - ORDRE.indexOf(b));
        const marqueurs = types.map(type => ({ type, params: {} }));
        if (l.marqueurs !== undefined) {
            if (stable(l.marqueurs) === stable(marqueurs)) deja.push({ idProduct: id, _id: l._id }); else refus.push({ idProduct: id, raison: `marqueurs déjà présents (${JSON.stringify(l.marqueurs)}) — on n'écrase jamais` });
            continue;
        }
        const lu = types.includes('NON_LEGAL') ? '« Oversized Card · Not Tournament Legal »' : '« Oversized Card »';
        const marqueursPreuve = `étiquette Cardmarket du produit (pastille relevée le ${releveLe}, lue par OCR) : ${lu}${tcgdexJumbo.has(id) ? ' ; témoin : TCGdex nomme ce même idProduct en variante jumbo' : ''}`;
        ecrire.push({ idProduct: id, _id: l._id, marqueurs, marqueursPreuve });
    }
    return { ecrire, refus, deja };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.ecrire.length !== attendu) return { ok: false, raison: `le plan compte ${plan.ecrire.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

async function ecrire(db, cibles) {
    let posees = 0;
    for (const c of cibles) posees += (await db.collection('cartes_produits').updateOne({ _id: c._id, marqueurs: { $exists: false } }, { $set: { marqueurs: c.marqueurs, marqueursPreuve: c.marqueursPreuve } })).modifiedCount || 0;
    return { posees };
}

/** Les deux champs sont là, aux valeurs posées, et AUCUN autre champ de la ligne n'a bougé. */
async function relire(db, cibles, avant) {
    const apres = await db.collection('cartes_produits').find({ _id: { $in: cibles.map(c => c._id) } }).toArray();
    const parId = new Map(apres.map(d => [d._id, d])), avantId = new Map(avant.map(d => [d._id, d]));
    const manques = [], alteres = [];
    for (const c of cibles) {
        const d = parId.get(c._id);
        if (!d || stable(d.marqueurs) !== stable(c.marqueurs) || d.marqueursPreuve !== c.marqueursPreuve) { manques.push(c._id); continue; }
        if (stable(sansChamps(d)) !== stable(sansChamps(avantId.get(c._id)))) alteres.push(c._id);
    }
    return { ok: !manques.length && !alteres.length, presentes: `${cibles.length - manques.length}/${cibles.length}`, manques, alteres };
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, donnees, log = console.log, err = console.error, garde }) {
    const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/, /^--refus=\d+$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const ecrireDemande = argv.includes('--ecrire'), simuler = argv.includes('--simuler');
    if (inconnus.length || ecrireDemande === simuler) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --simuler | --ecrire --attendu=N`); return 2; }
    const attenduBrut = argv.find(a => a.startsWith('--attendu='))?.slice(10);
    if (ecrireDemande) {
        garde();   // --ecrire hors de lot-additif.js : refusé avant toute connexion
        if (attenduBrut === undefined) { err('❌ ARRÊT : --attendu=N obligatoire pour écrire — rien n\'est écrit'); return 1; }
    }
    const d = typeof donnees === 'function' ? donnees() : donnees;
    const cx = ecrireDemande ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const db = cx.cartes.db;
        const ids = [...new Set(d.etiquettes.filter(e => e.classe === 'jumbo').map(e => e.idProduct))];
        const lignes = await db.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
        const plan = planifier({ ...d, lignes });
        log(`   ÉTIQUETTES « jumbo » : ${ids.length} produits · lignes lues : ${lignes.length}`);
        const parRaison = {}; for (const r of plan.refus) { const k = r.raison.replace(/\(.*\)|« [^»]* »/g, '…'); parRaison[k] = (parRaison[k] || 0) + 1; }
        log(`   PLAN : ${plan.ecrire.length} ligne(s) · ${plan.refus.length} refus ${JSON.stringify(parRaison)} · ${plan.deja.length} déjà · dont JUMBO+NON_LEGAL ${plan.ecrire.filter(c => c.marqueurs.length === 2).length}, témoin TCGdex ${plan.ecrire.filter(c => /TCGdex/.test(c.marqueursPreuve)).length}`);
        if (!ecrireDemande) { log('   (simulation — rien n\'est écrit)'); return 0; }
        const v = verifierAttendu(plan, Number(attenduBrut));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        // les refus sont des trous nommés, attendus : ils se laissent passer seulement quand leur NOMBRE a été annoncé (--refus=N, lu à la simulation) ; un refus de plus ou de moins arrête tout
        const refusAnnonce = argv.find(a => a.startsWith('--refus='))?.slice(8);
        if (plan.refus.length && Number(refusAnnonce) !== plan.refus.length) { err(`❌ ARRÊT : ${plan.refus.length} refus au plan, ${refusAnnonce === undefined ? 'non annoncés (--refus=N)' : `${refusAnnonce} annoncés`} — rien n'est écrit`); return 1; }
        const avant = lignes.filter(l => plan.ecrire.some(c => c._id === l._id));
        const r = await ecrire(db, plan.ecrire);
        const rl = await relire(db, plan.ecrire, avant);
        const bon = r.posees === plan.ecrire.length && rl.ok;
        log(`\n   ${bon ? '✅' : '❌'} posées ${r.posees}/${plan.ecrire.length} · relu : ${rl.presentes}${rl.manques.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}${rl.alteres.length ? ` · AUTRES CHAMPS BOUGÉS ${JSON.stringify(rl.alteres)}` : ''}`);
        return bon ? 0 : 1;
    } finally { await cx.fermer(); }
}

module.exports = { ORDRE, planifier, verifierAttendu, ecrire, relire, executer };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    const ETIQUETTES = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/STAFF-DETECT/inventaire-etiquettes.json';
    const EXPORT = process.env.EXPORT_CARDMARKET || 'C:/Users/Yung/rat-market-travail/api/v2-catalogue-27/products_singles_6.json';
    const TCGDEX = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/MARQUEURS/jumbos-candidats.json';
    const donnees = () => {
        const fs = require('fs'), lire = f => JSON.parse(fs.readFileSync(f, 'utf8'));
        const I = lire(ETIQUETTES);
        if (!Array.isArray(I.produits) || !I.produits.length) throw new Error(`${ETIQUETTES} : aucun produit — une source vide ne prouve rien`);
        const ex = lire(EXPORT).products; if (!Array.isArray(ex) || !ex.length) throw new Error(`${EXPORT} : export vide`);
        return { etiquettes: I.produits, releveLe: String(I.date).slice(0, 10), exportIds: new Set(ex.map(p => p.idProduct)), tcgdexJumbo: new Set(lire(TCGDEX).concordants.map(c => c.idProduct)) };
    };
    const ouvrirLecture = async () => {
        const { MongoClient } = require('mongodb');
        if (!process.env.MONGODB_CARTES_LECTURE_URI) throw new Error('MONGODB_CARTES_LECTURE_URI obligatoire pour la simulation (lecture seule)');
        const a = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI); await a.connect();
        return { cartes: { db: a.db('cartes') }, fermer: () => a.close() };
    };
    executer({ argv: process.argv.slice(2), ouvrirLecture, donnees,
        ouvrirEcriture: async () => { const o = await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] }); return { cartes: o.cartes, fermer: o.fermer }; },
        garde: () => require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
