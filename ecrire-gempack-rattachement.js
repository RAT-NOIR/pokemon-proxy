// ============================================================
// GEM PACK : LE RATTACHEMENT DES RÉIMPRESSIONS AU SET — LA SIMULATION PUIS L'ÉCRITURE (décision de l'éditeur, 2026-10-31)
// ============================================================
//   node ecrire-gempack-rattachement.js [--simuler] [--codes=CBB4C,CBB5C,CBB6C] [--refuser-variantes] [--pret=<f>.json] [--plan=<f>.json] [--resume=<f>.json]      (DÉFAUT : simulation, LECTURE SEULE)
//   node lot-additif.js --quoi="Gem Pack : N fiches rattachées (sets …)" --collections=cartes,cartes_produits,trous_nommes --estimation-mo=1 -- node ecrire-gempack-rattachement.js --ecrire --seulement=<pret>.json --attendu=N
//   NODE_PATH = node_modules du dépôt principal ; MONGODB_CARTES_LECTURE_URI et MONGODB_LECTURE_URI (simulation) ; la connexion d'écriture est celle de collecte-cartes/garde.js, sous lot-additif seulement.
//
// CE QUE FAIT L'OUTIL, ET RIEN D'AUTRE : les trois listes anglaises du cache (SC + PC + ppr) sont croisées, le set est JUGÉ par la preuve par le set (avec, pour une faute d'orthographe seule, la tolérance
// d'orthographe aux quatre conditions) ; pour un set ADMIS, `planifierRattachement` lève le SEUL refus « la carte N n'est pas dans le set (cartes.sets) » là où l'association produit <-> carte <-> numéro de
// groupe est UNIQUE et prouvée, en rejouant TOUTES les preuves de production. Écriture, dans cet ORDRE, chaque étape RELUE avant la suivante :
//   1. l'appartenance au set (`cartes.sets`, $addToSet, liste fermée du site) · 2. l'impression Gem Pack de la carte (`numero-cardmarket`, poser-numerotation.ecrireLot) · 3. la fiche (`cartes_produits`, $setOnInsert)
//   · 4. le trou nommé « variantes-indiscernables » de chaque produit d'un groupe de plusieurs (`trous_nommes`). ADDITIF PUR : aucune fiche existante n'est modifiée, aucune image n'est touchée.
// LES VARIANTES : le numéro posé est le NUMÉRO DE GROUPE que Cardmarket donne ; le rang V1…V7 ne se devine jamais (trou nommé). `--refuser-variantes` : lecture stricte, aucun groupe de plusieurs produits n'est rattaché.
// L'ÉCRITURE EXIGE : lot-additif.js (sauvegarde, garde par set, journal), --seulement=<liste prête de la simulation> ET --attendu=<son compte> ; un refus dans le périmètre de --seulement arrête tout.
const fs = require('fs');
const path = require('path');
const V = require('./collecte-cartes/voie-deux-sources');
const FPS = require('./collecte-cartes/fiches-preuve-set');
const LOT = require('./collecte-cartes/lot-seulement');
const LG = require('./collecte-cartes/listes-gempack');
const RG = require('./collecte-cartes/rattachement-gempack');
const E = require('./ecrire-fiches-preuve-set');
const V5 = require('./poser-fiches-voie-deux-sources');

const DOSSIER_FICHES = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET';
const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--codes=[A-Z0-9,]+$/, /^--refuser-variantes$/, /^--seulement=.+\.json$/, /^--attendu=\d+$/, /^--pret=.+\.json$/, /^--plan=.+\.json$/, /^--resume=.+\.json$/];
const COMMANDE = 'node lot-additif.js --quoi="Gem Pack : N fiches rattachées" --collections=cartes,cartes_produits,trous_nommes --estimation-mo=1 -- node ecrire-gempack-rattachement.js --ecrire --seulement=<pret>.json --attendu=N';
const k = n => require('./collecte-cartes/jointure').cleNumero(String(n ?? ''));

/** La ligne de commande, écrite par ce qu'elle AUTORISE. @returns {string|null} la phrase du refus */
function verifierArguments(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return `argument inconnu : ${inconnus.join(' ')}`;
    const ecrire = argv.includes('--ecrire'), simuler = argv.includes('--simuler');
    if (ecrire && simuler) return 'un seul mode (--simuler, défaut | --ecrire)';
    const a = n => argv.some(x => x.startsWith(`--${n}=`));
    if (ecrire && !a('seulement')) return '--ecrire exige --seulement=<liste prête>.json';
    if (ecrire && !a('attendu')) return '--ecrire exige --attendu=<N>';
    if (!ecrire && (a('seulement') || a('attendu'))) return '--seulement et --attendu ne vont qu\'avec --ecrire';
    return null;
}

// ── les écritures réelles (substituables par le banc) ─────────────────────────────────────────────────────────────────────────
const dependancesReelles = {
    /** 1. l'appartenance : $addToSet de la liste fermée du site, puis relue. */
    async ecrireAppartenances(db, ajouts) {
        const R = require('./collecte-cartes/regle-r-fiches');
        const parCarte = new Map([...ajouts].map(([id, slugs]) => [id, { ids: [], metas: new Set(), sets: new Set(slugs) }]));
        const ops = R.operationsCartes(parCarte);
        R.garderEcritureSite(ops);
        if (ops.length) await db.collection('cartes').bulkWrite(ops, { ordered: false });
        const manques = [];
        for (const [id, slugs] of ajouts) { const c = await db.collection('cartes').findOne({ _id: id }, { projection: { sets: 1 } }); for (const s of slugs) if (!(c?.sets || []).includes(s)) manques.push(`${id}:${s}`); }
        return { ok: manques.length === 0, n: ajouts.size, manque: manques.join(', ') };
    },
    /** 2. les impressions : poser-numerotation.ecrireLot (elle relit les siennes). @returns {Promise<number>} 0 si tout est relu */
    async ecrireImpressions(db, plan, nomListe, log, err) {
        if (!plan.R.aPoser.size) { log('   (aucune impression à poser : les cartes déclarent déjà le numéro)'); return 0; }
        const pr = V.preuvesImpressions(plan, nomListe);
        return require('./poser-numerotation').ecrireLot({ db, R: { aPoser: plan.R.aPoser, numerosFiche: [] }, preuveDe: (id, i) => pr.get(`${id}|${i.tirage}|${i.expansion}|${k(i.numero)}`), nomListe, marque: 'ecrire-gempack-rattachement (2026-10-31)', log, err });
    },
    /** 3. les fiches : $setOnInsert, liens/métacartes en $addToSet. */
    ecrireFiches: (db, lignes, metaDe) => require('./poser-fiches-prouvees').ecrireFiches(db, lignes, metaDe, new Map()),
    async relireFiches(db, lignes, metaDe, repereAvant) {
        const rl = await require('./poser-fiches-prouvees').relire(db, lignes, metaDe, new Map(), repereAvant);
        const routees = await db.collection('cartes_produits').countDocuments({ _id: { $in: lignes.map(l => l._id) }, preuve: 'fiche-prouvee', route: V.ROUTE });
        return { ...rl, ok: rl.ok && routees === lignes.length, routees };
    },
    /** 4. les trous nommés. */
    ecrireTrous: async (db, trous, le) => {
        const CO = require('./collecte-cartes/comblement');
        return CO.ecrireTrous(db, trous.map(t => CO.construireTrou({ idProduct: t.idProduct, motif: t.motif, sources: ['preuve-par-set'], preuve: t.preuve, le })), { le });
    }
};

/**
 * L'ÉCRITURE : le plan exact de la simulation, ou rien. Chaque étape est RELUE avant la suivante ; la première qui ne l'est pas arrête tout (le reste n'est pas écrit).
 * @returns {Promise<number>} 0 si tout est relu
 */
async function ecrireRattachement({ db, plan, attendu, nomListe, metaDe, repereAvant, dep = {}, le = new Date(), log = console.log, err = console.error }) {
    const D = { ...dependancesReelles, ...dep };
    if (!Number.isInteger(attendu)) { err('❌ ARRÊT : --attendu=N obligatoire pour écrire — rien n\'est écrit'); return 1; }
    if (plan.refus && plan.refus.length) { err(`❌ ARRÊT : ${plan.refus.length} refus dans le plan : la liste --seulement doit être EXACTEMENT celle de la simulation — rien n'est écrit`); return 1; }
    if (plan.lignes.length !== attendu) { err(`❌ ARRÊT : le plan compte ${plan.lignes.length} ligne(s), attendu ${attendu} — rien n'est écrit`); return 1; }
    if (plan.ajoutsSets.size) {
        const a = await D.ecrireAppartenances(db, plan.ajoutsSets);
        log(`   ${a.ok ? '✅' : '❌'} 1. appartenance (cartes.sets) : ${a.n} carte(s)${a.ok ? ', relue' : ` — NON relue (${a.manque})`}`);
        if (!a.ok) { err('❌ l\'appartenance n\'est pas relue — ni l\'impression ni la fiche ne sont écrites'); return 1; }
    } else log('   1. appartenance : aucune à poser (les cartes sont déjà membres)');
    const ci = await D.ecrireImpressions(db, plan, nomListe, log, err);
    if (ci !== 0) { err('❌ les impressions ne sont pas toutes relues — la fiche n\'est PAS écrite'); return 1; }
    const r = await D.ecrireFiches(db, plan.lignes, metaDe);
    const rl = await D.relireFiches(db, plan.lignes, metaDe, repereAvant);
    log(`   ${rl.ok && r.lignes === plan.lignes.length ? '✅' : '❌'} 3. fiches : posées ${r.lignes}/${plan.lignes.length} · cartes modifiées ${r.cartes} · relu : lignes ${rl.lignes} · cartes ${rl.cartes} · repères d'adresse bougés ${JSON.stringify(rl.reperesBouges)}${rl.manques?.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}`);
    if (!(r.lignes === plan.lignes.length && rl.ok)) { err('❌ la relecture des fiches ne retrouve pas tout — les trous ne sont PAS écrits'); return 1; }
    if (plan.trous.length) {
        const t = await D.ecrireTrous(db, plan.trous, le);
        log(`   ✅ 4. trous « variantes-indiscernables » : nouveaux ${t.nouveaux} · changés ${t.changes} · inchangés ${t.inchanges}`);
    } else log('   4. trous : aucun (aucun groupe de plusieurs produits)');
    return 0;
}

// ── la ligne de commande ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function executer({ argv, ouvrirLecture, ouvrirEcriture, chargerBase = () => FPS.chargerSources(DOSSIER_FICHES), lireListe = f => JSON.parse(fs.readFileSync(f, 'utf8')), ecrireFichier = (f, t) => fs.writeFileSync(f, t), log = console.log, err = console.error, env = process.env, ppid = process.ppid }) {
    const refus = verifierArguments(argv);
    if (refus) { err(`❌ ${refus} — rien n'est écrit`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire');
    if (ecrire) { try { require('./collecte-cartes/phase2-visuels').garderSousLot(env, ppid, COMMANDE); } catch (e) { err(`❌ ${e.message}`); return 2; } }
    let seulement = null;
    if (arg('seulement')) { try { seulement = LOT.lire('--seulement', () => JSON.stringify(lireListe(arg('seulement')))); } catch (e) { err(`❌ ${e.message} — rien n'est écrit`); return 2; } }
    const codes = (arg('codes') || LG.SETS.map(s => s.code).join(',')).split(',');
    const inconnus = codes.filter(c => !LG.SETS.some(s => s.code === c));
    if (inconnus.length) { err(`❌ code(s) inconnu(s) : ${inconnus.join(', ')} (connus : ${LG.SETS.map(s => s.code).join(', ')})`); return 2; }
    const exps = LG.SETS.filter(s => codes.includes(s.code)).map(s => s.exp);
    let base;
    try { base = chargerBase(); } catch (e) { err(`❌ sources illisibles (${String(e.message).slice(0, 160)}) — rien n'est écrit`); return 2; }
    for (const l of base.journal || []) log(l);
    const cx = ecrire ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const cartesDb = cx.cartes.db, prodDb = cx.prod.db;
        const lecture = await V5.lire({ cartesDb, prodDb, expansions: exps });
        const { cibles, SETSL, parSet } = LG.preparerListes({ codes, produitsDe: exp => lecture.produits.get(exp) || [], base });
        for (const p of parSet) log(`   ${p.nom} · exp ${p.exp} · produits ${p.produits} · croisement ${p.croisement ? (p.croisement.ok ? 'OK' : 'DISCORDANT') : '—'}${p.verdict ? ` → ${p.verdict} : ${p.motif}` : ''}`);
        const { verdicts, global } = E.jugerTout({ sources: { ...base, SETS: { ...base.SETS, ...SETSL } }, lecture, cibles });
        log(`   DÉNOMINATEURS : ${verdicts.length} set(s) jugé(s) · ${lecture.cartes.length} cartes · ${lecture.sets.size} sets · ${lecture.lignes.length} lignes cartes_produits · calibration : ${global.setsCalibres} set(s), ${global.produitsJuges} produits jugés, ${global.fauxPartout} faux`);
        for (const v of verdicts) {
            log(`\n■ ${v.cible.nom} · exp ${v.cible.exp} → ${v.admis ? 'ADMIS' : 'TOMBÉ'}`);
            log(`   ${v.raison}`);
            if (v.toleranceMotif) log(`   ✎ ${v.toleranceMotif}`);
            if (v.toleranceRefusee) log(`   (tolérance demandée, REFUSÉE : ${v.toleranceRefusee})`);
        }
        const { entrees, refus: refusSets } = E.entreesDesSetsAdmis({ verdicts, lecture });
        let aPlanifier = entrees;
        if (seulement) {
            const connus = new Set(entrees.map(e => e.idProduct)), absents = [...seulement].filter(id => !connus.has(id));
            if (absents.length) { err(`❌ ARRÊT : ${absents.length} idProduct de --seulement ne sont plus attribués par un set admis (${absents.slice(0, 8).join(', ')}) — rien n'est écrit`); return 1; }
            aPlanifier = entrees.filter(e => seulement.has(e.idProduct));
        }
        const plan = RG.planifierRattachement({ entrees: aPlanifier, lecture, variantes: argv.includes('--refuser-variantes') ? 'refuser' : 'groupe' });
        plan.refus = [...refusSets.filter(r => !seulement || seulement.has(r.idProduct)).map(r => ({ ...r, categorie: 'set' })), ...plan.refus];
        // le périmètre : SEULES les lignes que le rattachement a rendues posables s'écrivent ici (les lignes de la voie ordinaire relèvent de ecrire-fiches-preuve-set.js)
        const hors = plan.lignes.filter(l => !plan.rattaches.includes(l.idProduct));
        if (ecrire && hors.length) { err(`❌ ARRÊT : ${hors.length} ligne(s) du plan ne sont pas des rattachements (voie ordinaire : ecrire-fiches-preuve-set.js) — rien n'est écrit`); return 1; }
        const lignesRatt = plan.lignes.filter(l => plan.rattaches.includes(l.idProduct));
        // dénominateur PAR SET
        for (const s of LG.SETS.filter(x => codes.includes(x.code))) {
            const ids = new Set(entrees.filter(e => e.idExpansion === s.exp).map(e => e.idProduct));
            const lg = lignesRatt.filter(l => l.idExpansion === s.exp), tr = plan.trous.filter(x => lg.some(l => l.idProduct === x.idProduct)), rf = plan.refus.filter(r => ids.has(r.idProduct));
            const causes = {}; for (const r of rf) { const c = r.raison.replace(/\(.*?\)/g, '(…)').replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#').slice(0, 110); causes[c] = (causes[c] || 0) + 1; }
            log(`\n   ${s.nom} : produits admis ${ids.size} · déjà fichés ${plan.dejaPoses.length >= 0 ? entrees.filter(e => e.idExpansion === s.exp && lecture.lignes.some(l => l.idProduct === e.idProduct)).length : 0} · À RATTACHER ET POSABLES ${lg.length} (uniques ${lg.length - tr.length}, variantes indiscernables ${tr.length}) · refusés ${rf.length}`);
            for (const [c, n] of Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 8)) log(`      ${String(n).padStart(4)} · ${c}`);
        }
        const d = plan.denominateurs;
        log(`\n   BILAN : produits ${d.produits} · déjà fichés ${d.dejaFichees} · à rattacher (refus d'appartenance seul) ${d.aRattacher} · posables ${lignesRatt.length} (uniques ${lignesRatt.length - plan.trous.length}, variantes indiscernables ${plan.trous.length}) · refusés ${d.refuses}`);
        log(`   APPARTENANCES à poser : ${plan.ajoutsSets.size} carte(s) · IMPRESSIONS Gem Pack : ${plan.impressions.length} sur ${new Set(plan.impressions.map(x => x.carteId)).size} carte(s) · TROUS « variantes-indiscernables » : ${plan.trous.length}`);
        for (const l of lignesRatt.slice(0, 12)) log(`   + ${l._id} (${l.slugSet}, numeroFiche ${l.numeroFiche}) ${String(l.detail).slice(0, 200)}`);
        if (lignesRatt.length > 12) log(`   … ${lignesRatt.length - 12} autres lignes`);
        const planEcriture = { ...plan, lignes: lignesRatt };
        if (arg('pret')) ecrireFichier(arg('pret'), JSON.stringify(lignesRatt.map(l => l.idProduct)));
        if (arg('plan')) ecrireFichier(arg('plan'), JSON.stringify(V.planJson(planEcriture, new Map())));
        if (arg('resume')) ecrireFichier(arg('resume'), JSON.stringify({ le: new Date().toISOString(), variantes: argv.includes('--refuser-variantes') ? 'refuser' : 'groupe', denominateurs: d, verdicts: verdicts.map(v => ({ nom: v.cible.nom, exp: v.cible.exp, admis: v.admis, raison: v.raison, tolerance: v.tolerance ?? null, toleranceMotif: v.toleranceMotif ?? null, toleranceRefusee: v.toleranceRefusee ?? null })), lignes: lignesRatt.map(l => ({ idProduct: l.idProduct, carteId: l.carteId, idExpansion: l.idExpansion, slugSet: l.slugSet, numeroFiche: l.numeroFiche })), appartenances: [...plan.ajoutsSets].map(([carteId, slugs]) => ({ carteId, slugs })), impressions: plan.impressions, trous: plan.trous.map(x => ({ idProduct: x.idProduct, groupe: x.groupe, produitsDuGroupe: x.produitsDuGroupe })), refus: plan.refus }, null, 1));
        if (!ecrire) { log('   (simulation — rien n\'est écrit ; l\'écriture exige lot-additif.js, --seulement=<liste prête> et --attendu)'); return 0; }
        const metaDe = new Map([...lecture.produits.values()].flat().map(p => [p.idProduct, p.idMetacard]));
        const parId = new Map(lecture.cartes.map(c => [c._id, c]));
        const repereAvant = new Map(lignesRatt.map(l => [l.carteId, parId.get(l.carteId)?.liens?.idProduct?.[0]]).filter(([, v]) => v !== undefined));
        return await ecrireRattachement({ db: cartesDb, plan: planEcriture, attendu: Number(arg('attendu')), nomListe: path.basename(arg('seulement')), metaDe, repereAvant, log, err });
    } finally { await cx.fermer(); }
}

module.exports = { executer, ecrireRattachement, verifierArguments, dependancesReelles, AUTORISES };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    executer({ argv: process.argv.slice(2), ouvrirLecture: V5.ouvrirLecture, ouvrirEcriture: () => require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
