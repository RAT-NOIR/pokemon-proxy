// ============================================================
// POSER `cartes_produits.marqueurs` STAFF, WCD (année, joueur) + NON_LEGAL, LEAGUE (+ PLACE) PAR DEUX SOURCES CONCORDANTES (contrat MARQUEURS v1 de l'API ; décision de l'éditeur du 2026-10-27)
// ============================================================
//   node poser-marqueurs-etiquettes.js --simuler [--rapport=<f>.json]                                     (lecture seule : plan, RIEN n'est écrit)
//   node lot-additif.js --quoi="marqueurs STAFF/WCD/LEAGUE : N produits" --collections=cartes_produits -- node poser-marqueurs-etiquettes.js --ecrire --attendu=N --refus=R   (N et R lus à la simulation)
//
// Toute la décision vit dans collecte-cartes/marqueurs-etiquettes.js (banc test-marqueurs-etiquettes.js) ; l'écriture et la relecture sont CELLES de poser-marqueurs-jumbo.js (relues le 27/10) :
// `$set` de `marqueurs` + `marqueursPreuve` sur une ligne qui ne porte pas `marqueurs` (`$exists:false`), rien d'autre ; relu, et aucun autre champ de la ligne ne doit avoir bougé.
// Les refus de PREUVE (une seule source, joueur illisible, ambigu…) sont des trous nommés, imprimés par motif ; les refus d'ÉCRITURE (ligne absente, marqueurs déjà présents…) se laissent passer
// seulement quand leur NOMBRE a été annoncé (--refus=R). AUCUNE requête réseau : le relevé du second marché et les étiquettes sont des fichiers locaux.
const MQ = require('./collecte-cartes/marqueurs-etiquettes');
const J = require('./poser-marqueurs-jumbo');

function planifier(d, lignes) {
    const s = MQ.planStaff(d), w = MQ.planWcd(d), y = MQ.planYellowA({ produits: d.yellowA, tcgTous: d.tcgTous, luLe: d.luLe });
    const cibles = [...s.cibles, ...w.cibles, ...y.cibles], preuve = [...s.refus, ...w.refus, ...y.refus];
    return { cibles, refusPreuve: preuve, ...MQ.planifierEcriture({ cibles, lignes, exportIds: d.exportIds }) };
}
const compter = (xs, k) => { const o = {}; for (const x of xs) { const c = k(x); o[c] = (o[c] || 0) + 1; } return o; };

async function executer({ argv, ouvrirLecture, ouvrirEcriture, donnees, log = console.log, err = console.error, garde, ecrireRapport = null }) {
    const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/, /^--refus=\d+$/, /^--rapport=.+\.json$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const ecrireDemande = argv.includes('--ecrire'), simuler = argv.includes('--simuler');
    if (inconnus.length || ecrireDemande === simuler) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --simuler | --ecrire --attendu=N [--refus=R]`); return 2; }
    const attenduBrut = argv.find(a => a.startsWith('--attendu='))?.slice(10);
    if (ecrireDemande) {
        garde();   // --ecrire hors de lot-additif.js : refusé avant toute connexion
        if (attenduBrut === undefined) { err('❌ ARRÊT : --attendu=N obligatoire pour écrire — rien n\'est écrit'); return 1; }
    }
    const cx = ecrireDemande ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const d = typeof donnees === 'function' ? await donnees(cx) : donnees;
        const db = cx.cartes.db;
        const ids = [...new Set([...MQ.planStaff(d).cibles, ...MQ.planWcd(d).cibles, ...MQ.planYellowA({ produits: d.yellowA, tcgTous: d.tcgTous, luLe: d.luLe }).cibles].map(c => c.idProduct))];
        const lignes = await db.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
        const plan = planifier(d, lignes);
        log(`   CIBLES PROUVÉES (deux sources) : ${plan.cibles.length} ${JSON.stringify(compter(plan.cibles, c => c.famille))} · lignes lues : ${lignes.length}`);
        log(`   REFUS DE PREUVE (trous nommés) : ${plan.refusPreuve.length} ${JSON.stringify(compter(plan.refusPreuve, r => `${r.famille}:${r.raison}`))}`);
        log(`   PLAN : ${plan.ecrire.length} ligne(s) ${JSON.stringify(compter(plan.ecrire, c => c.famille))} · ${plan.refus.length} refus d'écriture ${JSON.stringify(compter(plan.refus, r => r.raison.replace(/\(.*\)|« [^»]* »/g, '…')))} · ${plan.deja.length} déjà`);
        log(`   TYPES : ${JSON.stringify(compter(plan.ecrire.flatMap(c => c.marqueurs), m => m.type))}`);
        const rapport = argv.find(a => a.startsWith('--rapport='))?.slice(10);
        if (rapport && ecrireRapport) ecrireRapport(rapport, { le: new Date().toISOString(), ecrire: plan.ecrire, refus: plan.refus, deja: plan.deja, refusPreuve: plan.refusPreuve });
        if (!ecrireDemande) { log('   (simulation — rien n\'est écrit)'); return 0; }
        const v = J.verifierAttendu(plan, Number(attenduBrut));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const refusAnnonce = argv.find(a => a.startsWith('--refus='))?.slice(8);
        if (plan.refus.length && Number(refusAnnonce) !== plan.refus.length) { err(`❌ ARRÊT : ${plan.refus.length} refus d'écriture au plan, ${refusAnnonce === undefined ? 'non annoncés (--refus=N)' : `${refusAnnonce} annoncés`} — rien n'est écrit`); return 1; }
        const avant = lignes.filter(l => plan.ecrire.some(c => c._id === l._id));
        const r = await J.ecrire(db, plan.ecrire);
        const rl = await J.relire(db, plan.ecrire, avant);
        const bon = r.posees === plan.ecrire.length && rl.ok;
        log(`\n   ${bon ? '✅' : '❌'} posées ${r.posees}/${plan.ecrire.length} · relu : ${rl.presentes}${rl.manques.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}${rl.alteres.length ? ` · AUTRES CHAMPS BOUGÉS ${JSON.stringify(rl.alteres)}` : ''}`);
        return bon ? 0 : 1;
    } finally { await cx.fermer(); }
}

module.exports = { planifier, executer };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    const fs = require('fs');
    const JT = require('./collecte-cartes/tcgcsv-jointure'), D = require('./collecte-cartes/tcgcsv-donnees');
    const ETIQUETTES = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/STAFF-DETECT/inventaire-etiquettes.json';
    const RELEVE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/PHASE4/TCGCSV/releves-tcs.json';
    const YELLOW_A = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/PRIORITES/yellow-a-base.json';
    const lire = f => JSON.parse(fs.readFileSync(f, 'utf8'));
    const nonVide = (x, f) => { if (!x || (Array.isArray(x) ? !x.length : !Object.keys(x).length)) throw new Error(`${f} : vide — une source vide ne prouve rien`); return x; };
    const donnees = async cx => {
        const I = lire(ETIQUETTES), rel = lire(RELEVE), ya = lire(YELLOW_A).produits;
        nonVide(I.produits, ETIQUETTES); nonVide(rel.listes, RELEVE); nonVide(ya, YELLOW_A);
        const brut = await D.lireCmDepuisBase({ cartes: { db: cx.cartes.db } }, cx.prod.db);
        // le catalogue Cardmarket IMPORTÉ (catalogue_produits, tenu à jour par l'import quotidien) — pas un fichier d'export dont la date ne se lit pas
        const catalogue = new Set(nonVide(brut.cat, 'catalogue_produits').map(c => c.idProduct));
        const cm = D.assemblerCm(brut);
        const groupes = JT.groupesDuReleve(rel);
        const table = JT.construireTable({ groupes, expansions: D.expansionsPourTable(cm), langueDeCategorie: JT.langueDeCategorieDe(rel.categories) });
        const groupesDeExp = new Map();
        for (const li of table.lignes.filter(x => JT.estApparie(x.statut))) for (const e of li.expansions) (groupesDeExp.get(e.idExpansion) || groupesDeExp.set(e.idExpansion, []).get(e.idExpansion)).push(li.groupId);
        const gW = groupes.find(g => g.groupId === JT.GROUPE_WCD);
        if (!gW) throw new Error(`le groupe des decks (${JT.GROUPE_WCD}) est absent du relevé — on ne devine pas`);
        return { etiquettes: I.produits, releveLe: String(I.date).slice(0, 10), cm, groupesDeExp, lusDe: new Map(groupes.map(g => [g.groupId, g.produits.map(JT.lireTcg)])),
            tcgWcd: gW.produits.map(JT.lireWcdTcg).filter(Boolean), tcgTous: groupes.filter(g => g.categoryId === rel.categories.pokemon).flatMap(g => g.produits.map(JT.lireTcg)),
            yellowA: ya.map(y => ({ idProduct: y.idProduct, carte: y.carte, numero: y.numero, tamponProduit: y.tamponProduit })), luLe: '2026-10-27', exportIds: catalogue };
    };
    const ouvrirLecture = async () => {
        const { ouvrirLecture: ol } = require('./collecte-cartes/ouvrir-lecture');
        const l = await ol(); if (!l) throw new Error('connexion de lecture seule indisponible');
        const { prod, fermer } = await require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
        return { cartes: l.cartes, prod, fermer: async () => { await l.fermer(); await fermer(); } };
    };
    executer({ argv: process.argv.slice(2), ouvrirLecture, donnees,
        ouvrirEcriture: async () => { const o = await require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }); return { cartes: o.cartes, prod: o.prod, fermer: o.fermer }; },
        garde: () => require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid),
        ecrireRapport: (f, x) => fs.writeFileSync(f, JSON.stringify(x, null, 1)) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
