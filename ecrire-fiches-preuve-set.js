// ============================================================
// FICHES CHINOISES : PREUVE PAR LE SET — LA SIMULATION PUIS L'ÉCRITURE (2026-10-31)
// ============================================================
//   node ecrire-fiches-preuve-set.js [--simuler] [--dossier=<FICHES-SET>] [--plan=<f>.json] [--resume=<f>.json] [--pret=<f>.json]          (DÉFAUT : simulation, LECTURE SEULE, rien n'est écrit)
//   node lot-additif.js --quoi="Preuve par le set : N fiches (sets …)" --collections=cartes,cartes_produits -- node ecrire-fiches-preuve-set.js --ecrire --seulement=<pret>.json --attendu=N
//   NODE_PATH = node_modules du dépôt principal ; MONGODB_CARTES_LECTURE_URI et MONGODB_LECTURE_URI (simulation) ; la connexion d'écriture est celle de collecte-cartes/garde.js, sous lot-additif seulement.
//
// CE QUE FAIT L'OUTIL : pour chaque set de collecte-cartes/fiches-preuve-set.js::CIBLES, il JUGE (juger : règle sans le numéro Cardmarket, avec lui en témoin, calibration à 0 faux, quatre contrôles
// négatifs qui doivent dire non) ; un set ADMIS fournit ses attributions au planificateur DE PRODUCTION de la voie « deux-sources » (voie-deux-sources.js::planifierVoie : nom + attaques, métacarte,
// niveau, témoin du nom de joindre(), départage par le numéro, impression au numéro Cardmarket via poser-numerotation.planifier) — la seconde source est la preuve par le set (`preuve-par-set`).
// Le numéro Cardmarket du produit reste TÉMOIN : il est le numéro de la concordante, jamais caché. Aucune règle de production n'est recopiée ici.
// ADDITIF PUR : des lignes cartes_produits ABSENTES (planifierVoie refuse un produit qui a déjà une ligne), `liens.idProduct` en $addToSet, une impression `numero-cardmarket` en $push gardé. Aucune fiche existante
// n'est modifiée ni supprimée ; un set non admis n'écrit RIEN ; un refus dans le périmètre de --seulement (la base a bougé depuis la simulation) arrête tout.
// L'ÉCRITURE EXIGE : lot-additif.js (sauvegarde, garde par set, journal), --seulement=<liste prête de la simulation> ET --attendu=<son compte>.
const fs = require('fs');
const path = require('path');
const V = require('./collecte-cartes/voie-deux-sources');
const LOT = require('./collecte-cartes/lot-seulement');
const FPS = require('./collecte-cartes/fiches-preuve-set');
const V5 = require('./poser-fiches-voie-deux-sources');
const TOL = require('./collecte-cartes/tolerance-orthographe');

const DOSSIER = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET';
const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--dossier=.+$/, /^--seulement=.+\.json$/, /^--attendu=\d+$/, /^--plan=.+\.json$/, /^--resume=.+\.json$/, /^--pret=.+\.json$/];
const COMMANDE = 'node lot-additif.js --quoi="Preuve par le set : N fiches (sets …)" --collections=cartes,cartes_produits -- node ecrire-fiches-preuve-set.js --ecrire --seulement=<pret>.json --attendu=N';

/** Le jugement de tous les sets (UNE définition pour la simulation et l'écriture). @returns {{verdicts: object[], global: object}} */
function jugerTout({ sources, lecture, cibles = FPS.CIBLES }) {
    const verdicts = [];
    for (const c of cibles) {
        const absents = c.kado.filter(([e]) => !sources.SETS[e]);
        if (absents.length) { verdicts.push({ cible: c, admis: false, raison: `liste de la source absente du cache (${absents.map(x => x[0]).join(', ')}) : trou nommé, la source n'a pas été interrogée plus loin`, motifs: ['liste absente'], attributions: [], source: [], produits: [] }); continue; }
        const source = c.kado.flatMap(([e, pre]) => sources.SETS[e].cartes.map(x => ({ numero: pre + x.numero, nomZh: x.nomZh })));
        const brut = lecture.produits.get(c.exp) || [];
        const produits = brut.map(p => ({ idProduct: p.idProduct, name: p.name, numero: p.numero ?? null }));
        const v = FPS.juger({ source, produits, traduire: sources.traduire, cleProduit: sources.cleProduit, groupeDe: c.groupeDe || null });
        const intraduisibles = [...new Set((v.discordances || []).filter(d => d.type === 'intraduisible').map(d => d.nomZh))];
        const etiquette = c.kado.map(k => k[0]).join(' + ');
        // LA TOLÉRANCE D'ORTHOGRAPHE (décision de l'éditeur, 2026-10-31) : un OPT-IN de la cible (`tolerance: true`), jamais un défaut. Elle ne corrige qu'UNE faute, sous ses quatre conditions
        // (tolerance-orthographe.js) ; le set corrigé repasse ENTIÈREMENT par `juger` (0 faux, quatre contrôles négatifs), et le motif est écrit dans la raison et sur chaque fiche.
        if (!v.admis && c.tolerance === true) {
            const tol = TOL.proposerTolerance({ source, produits, traduire: sources.traduire, cleProduit: sources.cleProduit, groupeDe: c.groupeDe || null });
            if (tol.applicable) {
                const v2 = FPS.juger({ source: tol.source, produits, traduire: sources.traduire, cleProduit: sources.cleProduit, groupeDe: c.groupeDe || null });
                if (v2.admis) { verdicts.push({ ...v2, raison: `${v2.raison} ; ${tol.motif}`, cible: c, source: tol.source, produits, intraduisibles: [], etiquette, tolerance: tol.correction, toleranceMotif: tol.motif }); continue; }
                verdicts.push({ ...v, cible: c, source, produits, intraduisibles, etiquette, toleranceRefusee: `la liste corrigée est refusée par juger : ${v2.raison}` }); continue;
            }
            verdicts.push({ ...v, cible: c, source, produits, intraduisibles, etiquette, toleranceRefusee: tol.raison }); continue;
        }
        verdicts.push({ ...v, cible: c, source, produits, intraduisibles, etiquette });
    }
    // LA RÈGLE ENTIÈRE se tait si UN set montre un faux : 0 faux exigé partout où elle s'applique (sets visés ET sets de calibration)
    const fauxPartout = verdicts.reduce((s, v) => s + (v.calibration ? v.calibration.faux : 0), 0);
    const calibres = verdicts.filter(v => v.calibration && v.calibration.jugees > 0);
    const jugees = calibres.reduce((s, v) => s + v.calibration.jugees, 0);
    const global = { fauxPartout, setsCalibres: calibres.length, produitsJuges: jugees, regleFiable: fauxPartout === 0 && calibres.length > 0 };
    global.message = fauxPartout > 0 ? `la règle montre ${fauxPartout} faux sur un set de calibration : rien n'est admis` : calibres.length === 0 ? 'calibration sur zéro set : elle n\'a rien prouvé, aucun set n\'est admis' : null;
    if (!global.regleFiable) for (const v of verdicts) if (v.admis) { v.admis = false; v.motifs = [...v.motifs, global.message]; v.raison = v.motifs.join(' ; '); v.attributions = []; }
    return { verdicts, global };
}

/** Les entrées du planificateur pour les sets ADMIS de rôle « vise » ; un set sans UNE ligne `sets` pour son expansion donne des refus nommés. */
function entreesDesSetsAdmis({ verdicts, lecture }) {
    const entrees = [], refus = [];
    for (const v of verdicts) {
        if (!v.admis || v.cible.role !== 'vise') continue;
        const slugs = [...lecture.sets.values()].filter(s => [].concat(s.idExpansion ?? []).includes(v.cible.exp)).map(s => s._id);
        if (slugs.length !== 1) { for (const a of v.attributions) refus.push({ idProduct: a.idProduct, raison: `l'expansion ${v.cible.exp} est portée par ${slugs.length} set(s) (${slugs.join(', ') || 'aucun'}) : le set ne se désigne pas, un doute est un refus` }); continue; }
        entrees.push(...FPS.entreesDuSet({ verdict: v, source: v.source, produits: v.produits, exp: v.cible.exp, slugSet: slugs[0], etiquette: v.cible.etiquetteRef ?? `kado.hk:${v.etiquette}` }));   // une cible peut nommer sa propre référence (listes anglaises : aucun nom de source dans ce qui s'écrit)
    }
    return { entrees, refus };
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, cibles = FPS.CIBLES, chargerSources = FPS.chargerSources, lireListe = f => JSON.parse(fs.readFileSync(f, 'utf8')), ecrireFichier = (f, t) => fs.writeFileSync(f, t), log = console.log, err = console.error, env = process.env, ppid = process.ppid }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire'), simuler = argv.includes('--simuler') || !ecrire;
    if (inconnus.length || (ecrire && argv.includes('--simuler'))) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}un seul mode (--simuler, défaut | --ecrire) — rien n'est écrit`); return 2; }
    if (ecrire) {
        try { require('./collecte-cartes/phase2-visuels').garderSousLot(env, ppid, COMMANDE); } catch (e) { err(`❌ ${e.message}`); return 2; }
        if (!arg('seulement') || arg('attendu') === undefined) { err('❌ --ecrire exige --seulement=<liste prête>.json ET --attendu=<N> — rien n\'est écrit'); return 2; }
    }
    let seulement = null;
    if (arg('seulement')) { try { seulement = LOT.lire('--seulement', () => JSON.stringify(lireListe(arg('seulement')))); } catch (e) { err(`❌ ${e.message} — rien n'est écrit`); return 2; } }
    let sources;
    try { sources = chargerSources(arg('dossier') || DOSSIER); } catch (e) { err(`❌ sources illisibles (${String(e.message).slice(0, 160)}) — rien n'est écrit`); return 2; }
    for (const l of sources.journal || []) log(l);
    const cx = ecrire ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const cartesDb = cx.cartes.db, prodDb = cx.prod.db;
        const lecture = await V5.lire({ cartesDb, prodDb, expansions: [...new Set(cibles.map(c => c.exp))] });
        const { verdicts, global } = jugerTout({ sources, lecture, cibles });
        log(`   DÉNOMINATEURS : ${verdicts.length} sets jugés · ${lecture.cartes.length} cartes · ${lecture.sets.size} sets · ${lecture.lignes.length} lignes cartes_produits · calibration : ${global.setsCalibres} set(s) calibré(s), ${global.produitsJuges} produits jugés, ${global.fauxPartout} faux`);
        if (global.message) log(`   ⚠️ ${global.message}`);
        for (const v of verdicts) {
            log(`\n■ ${v.cible.nom} · exp ${v.cible.exp} · rôle ${v.cible.role} · source ${v.source.length} entrées · produits ${v.produits.length} → ${v.admis ? 'ADMIS' : 'TOMBÉ'}`);
            log(`   ${v.raison}`);
            if (v.toleranceMotif) log(`   ✎ ${v.toleranceMotif}`);
            if (v.toleranceRefusee) log(`   (tolérance d'orthographe demandée, REFUSÉE : ${v.toleranceRefusee})`);
            if (!v.admis && v.intraduisibles && v.intraduisibles.length) log(`   noms intraduisibles (${v.intraduisibles.length}) : ${v.intraduisibles.slice(0, 20).join(', ')}`);
            if (v.negatifs) log(`   contrôles négatifs (tous false = la calibration sait dire non) : ${JSON.stringify(v.negatifs)}`);
        }
        const { entrees, refus: refusSets } = entreesDesSetsAdmis({ verdicts, lecture });
        let aEcrire = entrees;
        if (seulement) {
            const connus = new Set(entrees.map(e => e.idProduct));
            const absents = [...seulement].filter(id => !connus.has(id));
            if (absents.length) { err(`❌ ARRÊT : ${absents.length} idProduct de --seulement ne sont plus attribués par un set admis (${absents.slice(0, 8).join(', ')}) — rien n'est écrit`); return 1; }
            aEcrire = entrees.filter(e => seulement.has(e.idProduct));
        }
        const plan = V.planifierVoie({ entrees: aEcrire, lecture });
        plan.refus = [...refusSets, ...plan.refus].sort((a, b) => a.idProduct - b.idProduct);
        for (const l of plan.lignes.slice(0, 40)) log(`   + ${l._id} (${l.slugSet}, numeroFiche ${l.numeroFiche}) ${l.detail}`);
        if (plan.lignes.length > 40) log(`   … ${plan.lignes.length - 40} autres lignes`);
        const causes = {}; for (const r of plan.refus) { const c = r.raison.replace(/\(.*?\)/g, '(…)').replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#').slice(0, 130); causes[c] = (causes[c] || 0) + 1; }
        const admis = verdicts.filter(v => v.admis && v.cible.role === 'vise'), tombes = verdicts.filter(v => !(v.admis && v.cible.role === 'vise'));
        log(`\n   BILAN : ${admis.length} set(s) admis [${admis.map(v => v.cible.nom).join(' ; ') || '—'}] · ${tombes.length} tombé(s) ou de calibration seulement [${tombes.map(v => v.cible.nom).join(' ; ')}]`);
        log(`   PLAN : ${plan.lignes.length} fiche(s) neuve(s) · ${plan.impressions.length} impression(s) numero-cardmarket à poser sur ${new Set(plan.impressions.map(x => x.carteId)).size} carte(s) · ${plan.refus.length} refus du planificateur`);
        for (const [c, n] of Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 12)) log(`      ${String(n).padStart(4)} · ${c}`);
        if (arg('plan')) ecrireFichier(arg('plan'), JSON.stringify(V.planJson(plan, new Map([...lecture.NC].map(([id, n]) => [id, n.codeSet ?? null])))));
        if (arg('pret')) ecrireFichier(arg('pret'), JSON.stringify(plan.lignes.map(l => l.idProduct)));
        if (arg('resume')) ecrireFichier(arg('resume'), JSON.stringify({ global, sets: verdicts.map(v => ({ nom: v.cible.nom, exp: v.cible.exp, role: v.cible.role, admis: v.admis, raison: v.raison, calibration: v.calibration || null, negatifs: v.negatifs || null })), lignes: plan.lignes.map(l => ({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche, sources: l.confirmation.sources, refs: l.confirmation.refs })), impressions: plan.impressions, refus: plan.refus }, null, 1));
        if (simuler) { log('   (simulation — rien n\'est écrit ; l\'écriture exige lot-additif.js, --seulement=<liste prête> et --attendu)'); return 0; }
        const metaDe = new Map([...lecture.produits.values()].flat().map(p => [p.idProduct, p.idMetacard]));
        const parId = new Map(lecture.cartes.map(c => [c._id, c]));
        const repereAvant = new Map(plan.lignes.map(l => [l.carteId, parId.get(l.carteId)?.liens?.idProduct?.[0]]).filter(([, v]) => v !== undefined));
        return await V.ecrire({ db: cartesDb, plan, attendu: Number(arg('attendu')), nomListe: path.basename(arg('seulement')), metaDe, repereAvant, log, err });
    } finally { await cx.fermer(); }
}

module.exports = { executer, jugerTout, entreesDesSetsAdmis, AUTORISES };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    executer({ argv: process.argv.slice(2), ouvrirLecture: V5.ouvrirLecture, ouvrirEcriture: () => require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
