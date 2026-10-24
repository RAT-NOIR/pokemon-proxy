// ============================================================
// PHASE 3b, T3 — SÉPARER PAR VARIANTE 5 PRODUITS (2 Toys R Us, 3 Oversized) : le scénario « jeton » de mesure-variantes-phase2.js, écrit
// ============================================================
//   node separer-variantes-phase2.js [--manifeste=<f>.json] [--annonce-vers=<f>.json] [--sortie=<dossier>] [--site-lib=<lib du site>]     (SIMULATION, par défaut : lecture seule, rien n'est écrit)
//   node lot-additif.js --quoi="PHASE 3b : séparation par variante (2 Toys R Us, 3 Oversized)" --collections=cartes,cartes_produits --annonce=<annonce-T3.json> -- node separer-variantes-phase2.js --ecrire --attendu=14 --manifeste=<manifeste-T3.json>
//   node lot-additif.js --quoi="PHASE 3b : retrait EXACT de la séparation par variante" --collections=cartes,cartes_produits --annonce=<annonce-retrait-T3.json> -- node separer-variantes-phase2.js --retirer --ecrire --attendu=14 --manifeste=<manifeste-T3.json>
// Ce qui s'écrit : voir collecte-cartes/phase3b-separation.js. `--attendu` = le nombre de LIGNES du plan (9 justes + 5 cibles à jeton) ; les 9 entrées sont fixées par la table fermée (ATTENDU_TABLE).
// `--ecrire` / `--retirer --ecrire` ne tournent que SOUS lot-additif.js (LOT_ADDITIF_PID), vérifié AVANT toute lecture. Le manifeste est écrit AVANT la première écriture ; `--retirer` ne défait que ce qu'il liste, et seulement
// là où la valeur ÉCRITE est encore en place. Après l'écriture, la RELECTURE se fait par un client OUVERT (collecte-cartes/phase2-lecture.js : tout est lu avant la fermeture — le défaut du lot A, 4e030fc5, ne revient pas).
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/phase2-visuels');
const V = require('./collecte-cartes/phase2-variantes');
const S = require('./collecte-cartes/phase3b-separation');

const AUTORISES = [/^--ecrire$/, /^--retirer$/, /^--attendu=\d+$/, /^--manifeste=.+\.json$/, /^--annonce-vers=.+\.json$/, /^--sortie=.+$/, /^--site-lib=.+$/];
const DEFAUT_SORTIE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/PHASE3B';
const DEFAUT_SITE_LIB = 'C:/Users/Yung/Desktop/rat-market-site/lib';
const sans = u => String(u ?? '').replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');
const trier = l => [...l].sort((a, b) => a - b);

/** La décision de l'API sur un état (documents bruts -> enregistrements compacts, comme le chargeur). */
async function decider(api, { sets, cartes, cartesProduits }) {
    const I = api.interneur();
    return api.decider({ sets: sets.map(s => api.compacterSet(s, I)), docs: cartes.map(d => api.compacterCarte(d, I)), lignes: cartesProduits.map(l => api.compacterLigne(l, I)), metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false });
}

/**
 * @param {object} o
 * @param {string[]} o.argv  @param {object} o.env  @param {number} o.ppid
 * @param {()=>Promise<object>} o.chargerApi  la chaîne de l'API (garde-contrat-api.js::chargerApi)
 * @param {(api: object)=>Promise<{sets, cartes, cartesProduits}>} o.lireEtat  lecture SEULE, tout lu avant la fermeture du client
 * @param {()=>Promise<{db: object, fermer: ()=>Promise}>} o.ouvrirEcriture  la connexion d'écriture (jamais ouverte en simulation)
 * @param {(chemin: string, contenu: string)=>void} o.ecrireFichier  @param {(chemin: string)=>string} o.lireFichier
 * @param {object} [o.contrat]  { verifierContrat, ligneContrat } de garde-contrat-api.js  @param {object} [o.garde]  garde-lot.js
 * @param {()=>Promise<object>|null} [o.regleSite]  la règle du site importée (h-fix-site) ; null = non rejouée
 */
async function executer({ argv, env, ppid, chargerApi, lireEtat, ouvrirEcriture, ecrireFichier, lireFichier, contrat, garde, regleSite = null, cibles = null, lu = V.LU, attenduTable = S.ATTENDU_TABLE, minEntrees = 1000, log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const val = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const ECRIRE = argv.includes('--ecrire'), RETIRER = argv.includes('--retirer');
    const ATTENDU = val('attendu') === null ? undefined : Number(val('attendu'));
    const MANIFESTE = val('manifeste');
    if (ECRIRE && !Number.isInteger(ATTENDU)) { err('❌ --ecrire exige --attendu=<N> (le nombre de lignes lu à la simulation) — rien n\'est écrit'); return 2; }
    if ((ECRIRE || RETIRER) && !MANIFESTE) { err(`❌ ${RETIRER ? '--retirer' : '--ecrire'} exige --manifeste=<fichier>.json — rien n'est écrit`); return 2; }
    if (ATTENDU !== undefined && !ECRIRE) { err('❌ --attendu ne vaut qu\'avec --ecrire — rien n\'est écrit'); return 2; }
    // la porte : AVANT toute lecture
    if (ECRIRE) { try { P.garderSousLot(env, ppid, `node lot-additif.js --quoi="PHASE 3b : séparation par variante" --collections=cartes,cartes_produits --annonce=<annonce.json> -- node separer-variantes-phase2.js ${RETIRER ? '--retirer ' : ''}--ecrire --attendu=14 --manifeste=<f>.json`); } catch (e) { err(`❌ ${e.message}`); return 2; } }
    const SORTIE = val('sortie') || DEFAUT_SORTIE;
    const { autoriser } = require('./collecte-cartes/garde-ecriture');
    const ecrire = (chemin, contenu) => { const p = autoriser(chemin, [SORTIE]); ecrireFichier(p, contenu); return p; };
    const dansSortie = f => (path.isAbsolute(f) ? f : path.join(SORTIE, f));

    P.verifierTables();
    const api = await chargerApi();
    const etat = await lireEtat(api);
    const avant = await decider(api, etat);
    const d0 = avant.denominateurs;
    const nbServis = r => new Set(r.entrees.map(e => e.idProduct)).size;
    log(`DÉNOMINATEURS : sets ${etat.sets.length} · cartes ${etat.cartes.length} · cartes_produits ${etat.cartesProduits.length} · produits servis par l'API AVANT : ${nbServis(avant)} (entrées ${d0.ecrites}) · partageIncoherent ${d0.partageIncoherent} · variante sans preuve ${d0.varianteSansPreuve} · variante hors liste ${d0.varianteHorsListe}`);
    if (d0.ecrites < minEntrees) throw new Error(`moins de ${minEntrees} entrées servies : base fausse`);
    const ciblesTable = cibles || P.ECARTES.filter(x => x.geste === 'emprunt');

    // ───────────── LE RETRAIT EXACT ─────────────
    if (RETIRER) {
        const groupes = V.construireGroupes({ cibles: ciblesTable, servisParCle: null, api, lu, verifierServis: false });
        const table = S.tableDesEcritures(groupes, lu);
        const m = JSON.parse(lireFichier(dansSortie(MANIFESTE)));
        S.verifierManifeste(m, table);
        const ecarts = S.ecartsDuRetrait(m, etat);
        log(`\nRETRAIT : manifeste ${MANIFESTE} · ${m.entrees.length} entrées, ${m.lignes.length} lignes · écarts avec l'état courant : ${ecarts.length}`);
        for (const e of ecarts) log(`   ⛔ ${e}`);
        if (ecarts.length) { err('❌ ARRÊT : l\'état courant n\'est pas celui que le manifeste a posé — rien n\'est retiré'); return 1; }
        const ops = S.operationsRetrait(m);
        if (!ECRIRE) { log(`\n(simulation du retrait — ${ops.length} opérations, rien n'est écrit)`); return 0; }
        if (ATTENDU !== m.lignes.length) { err(`❌ --attendu=${ATTENDU} mais le manifeste liste ${m.lignes.length} ligne(s) — rien n'est retiré`); return 1; }
        const o = await ouvrirEcriture();
        try { const r = await S.executerOperations(o.db, ops, { attendu: ops.length, quoi: 'retrait' }); log(`✅ retiré : ${r.modifiees}/${ops.length}`); } finally { await o.fermer(); }
        const relu = await lireEtat(api);      // client ouvert pour la lecture, fermé APRÈS qu'elle est faite
        const apres = await decider(api, relu);
        const plan = S.planifier({ cartes: relu.cartes, cartesProduits: relu.cartesProduits, entreesApi: apres.entrees, groupes, lu });
        const ok = !plan.refus.length && plan.comptes.entreesDeja === 0 && plan.comptes.lignesDeja === 0;
        log(`RELECTURE : ${ok ? '✅' : '🔴'} ${plan.comptes.entreesDeja} entrée(s) et ${plan.comptes.lignesDeja} ligne(s) portent encore l'état écrit · refus ${plan.refus.length} · produits servis par l'API ${nbServis(avant)} → ${nbServis(apres)}`);
        return ok ? 0 : 1;
    }

    // ───────────── LE PLAN ─────────────
    let groupes;
    try { groupes = V.construireGroupes({ cibles: ciblesTable, servisParCle: P.produitsServisParCle(avant.entrees), api, lu }); }
    catch (e) { err(`❌ ARRÊT : ${e.message} — rien n'est écrit`); return 1; }
    const plan = S.planifier({ cartes: etat.cartes, cartesProduits: etat.cartesProduits, entreesApi: avant.entrees, groupes, lu });
    const k = plan.comptes;
    log(`\nLE PLAN : ${k.groupes} groupes (une entrée chacun) · ${k.entrees} entrées à marquer (déjà : ${k.entreesDeja}) · ${k.lignes} lignes à écrire = ${k.justes} justes « normale » + ${k.jetons} cibles à jeton (déjà : ${k.lignesDeja}) · ${k.sansJeton} cibles SANS jeton : rien d'écrit · refus ${k.refus}`);
    for (const g of groupes) log(`   entrée ${g.set} n°${g.numero ?? '-'} (${g.cleR2}) : justes ${g.justes.join(',')} · cibles ${g.cibles.map(c => `${c.idProduct}${c.jeton ? ` « ${c.jeton} »` : ' (aucun jeton)'}`).join(', ')}`);
    for (const r of plan.refus) log(`   ⛔ ${r.set} n°${r.numero ?? '-'} (${r.cleR2}) : ${r.motif}${r.detail ? ` — ${sans(r.detail)}` : ''}`);
    const arret = S.motifDArret(plan, { attendu: ECRIRE ? ATTENDU : k.lignes, attenduTable });
    if (arret) { err(`❌ ARRÊT : ${arret}`); return 1; }

    // ───────────── LA SIMULATION : decider sur la base entière, avant → après ─────────────
    const sim = S.appliquerPlan(etat, plan);
    const etatApres = { ...etat, cartes: sim.cartes, cartesProduits: sim.cartesProduits };
    const apres = await decider(api, etatApres);
    const verdict = verdictApi({ avant, apres, groupes });
    log(`\nSIMULATION DE L'API (decider, base entière) — avant → après`);
    log(`   produits servis ${nbServis(avant)} → ${nbServis(apres)} · entrées ${d0.ecrites} → ${apres.denominateurs.ecrites} · partageIncoherent ${d0.partageIncoherent} → ${apres.denominateurs.partageIncoherent}`);
    log(`   cibles à jeton servies ${verdict.ciblesServies.length}/${verdict.ciblesAttendues.length} (${verdict.ciblesServies.join(',') || '—'}) · variantes servies ${JSON.stringify(verdict.variantes)} · justes perdus ${verdict.justesPerdus.length} · cibles SANS jeton non servies ${verdict.sansJetonPerdues.length}/${verdict.sansJetonAttendues.length} · AUTRES produits perdus ${verdict.autresPerdus.length}${verdict.autresPerdus.length ? ' : ' + verdict.autresPerdus.join(',') : ''} · gagnés ${verdict.gagnes.length} · changés hors décision ${verdict.changesHorsDecision.length}${verdict.changesHorsDecision.length ? ' : ' + verdict.changesHorsDecision.join(',') : ''}`);
    log(`   visuel des justes inchangé : ${verdict.visuelInchange ? '✅' : '🔴'} · même fichier pour chaque cible à jeton et son juste : ${verdict.memeFichier ? '✅' : '🔴'}`);
    log(`   VERDICT : ${verdict.ok ? '✅ exactement ce qui a été accordé' : '🔴 ÉCART : ' + verdict.raisons.join(' ; ')}`);
    const ct = await contrat.verifierContrat({ api, avant: { sets: etat.sets, cartes: etat.cartes, cartesProduits: etat.cartesProduits }, apres: { sets: etatApres.sets, cartes: etatApres.cartes, cartesProduits: etatApres.cartesProduits } });
    log(`   ${contrat.ligneContrat(ct)} · CONTRAT : ${ct.nouveaux.length ? `🔴 ${ct.nouveaux.length} refus nouveau(x) : ${ct.nouveaux.slice(0, 5).map(n => `${n.idProduct} ${sans(n.motif)}`).join(' ; ')}` : '✅ zéro refus nouveau'}`);
    // la garde de lot : ce qu'elle compterait, et l'annonce à passer à lot-additif
    const cm = garde.comparer(garde.compterEtat({ cartes: etat.cartes, cartesProduits: etat.cartesProduits, sets: etat.sets }), garde.compterEtat({ cartes: sim.cartes, cartesProduits: sim.cartesProduits, sets: etat.sets }));
    const annonce = Object.fromEntries(cm.baisses.filter(b => !b.autorisee).map(b => [b.cle, b.baisse]));
    garde.validerAnnonces(annonce);
    log(`   GARDE DE LOT (simulée) : ${cm.baisses.length} baisse(s), ${cm.nonAutorisees.length} non autorisée(s) → annonce ${JSON.stringify(annonce)} · hausses ${JSON.stringify(cm.hausses)}`);
    let siteOk = true;
    if (regleSite) {
        const H = require('./collecte-cartes/h-fix-site');
        const R = await regleSite();
        const sTouches = [...new Set(plan.entrees.map(x => x.set))];
        const setsT = etat.sets.filter(s => sTouches.includes(s._id)), exps = new Set(setsT.flatMap(s => [].concat(s.idExpansion ?? [])));
        const lignesT = etat.cartesProduits.filter(l => exps.has(l.idExpansion));
        const sa = H.servir(R, { sets: setsT, cartes: etat.cartes, lignes: lignesT }), sb = H.servir(R, { sets: setsT, cartes: sim.cartes, lignes: sim.cartesProduits.filter(l => exps.has(l.idExpansion)) }), dif = H.diff(sa, sb);
        siteOk = dif.length === 0;
        log(`   SITE (règle importée, sets ${sTouches.join(', ')}) : ${sa.size} produits rejoués · ${dif.length} différence(s)${dif.length ? ' : ' + dif.slice(0, 8).map(x => `${x.k} ${x.nature}`).join(' ; ') : ''} → ${siteOk ? '✅ le site affiche les mêmes fiches' : '🔴 ÉCART'}`);
    } else log('   SITE : règle du site non rejouée (non demandée)');
    if (!verdict.ok || ct.nouveaux.length || !siteOk) { err('🔴 ARRÊT : la simulation ne tient pas ; rien n\'est écrit.'); return 1; }

    const mf = S.manifeste(plan, { quoi: 'PHASE 3b : séparation par variante (2 Toys R Us, 3 Oversized)' });
    if (!ECRIRE) {
        if (val('annonce-vers')) log(`   annonce → ${ecrire(dansSortie(val('annonce-vers')), JSON.stringify(annonce, null, 1))}`);
        if (MANIFESTE) log(`   manifeste prévu → ${ecrire(dansSortie(MANIFESTE), JSON.stringify(mf, null, 1))}`);
        log(`\n(simulation — rien n'est écrit en base. Écriture : node lot-additif.js --quoi="PHASE 3b : séparation par variante (2 Toys R Us, 3 Oversized)" --collections=cartes,cartes_produits${Object.keys(annonce).length ? ' --annonce=<annonce.json>' : ''} -- node separer-variantes-phase2.js --ecrire --attendu=${k.lignes} --manifeste=<manifeste.json>)`);
        return 0;
    }

    // ───────────── L'ÉCRITURE : le manifeste d'abord, puis exactement le plan simulé ─────────────
    log(`   manifeste → ${ecrire(dansSortie(MANIFESTE), JSON.stringify(mf, null, 1))}`);
    const ops = S.operationsEcriture(plan);
    if (!ops.length) { log('↩️ rien à écrire : tout est déjà dans l\'état visé (idempotent)'); }
    else {
        const o = await ouvrirEcriture();
        try { const r = await S.executerOperations(o.db, ops, { attendu: ops.length, quoi: 'séparation par variante' }); log(`✅ écrit : ${r.modifiees}/${ops.length} (lignes d'abord, entrées ensuite)`); } finally { await o.fermer(); }
    }
    // ───────────── LA RELECTURE : client OUVERT, tout lu avant la fermeture ─────────────
    const relu = await lireEtat(api);
    const apresReel = await decider(api, relu);
    const planRelu = S.planifier({ cartes: relu.cartes, cartesProduits: relu.cartesProduits, entreesApi: apresReel.entrees, groupes, lu });
    const reel = verdictApi({ avant, apres: apresReel, groupes });
    const tout = !planRelu.refus.length && planRelu.comptes.entreesDeja === plan.entrees.length && planRelu.comptes.lignesDeja === plan.lignes.length;
    log(`RELECTURE : ${tout ? '✅' : '🔴'} ${planRelu.comptes.entreesDeja}/${plan.entrees.length} entrées et ${planRelu.comptes.lignesDeja}/${plan.lignes.length} lignes portent l'état écrit · API : cibles à jeton servies ${reel.ciblesServies.length}/${reel.ciblesAttendues.length} · justes perdus ${reel.justesPerdus.length} · autres produits perdus ${reel.autresPerdus.length} · ${reel.ok ? '✅ conforme au plan' : '🔴 ' + reel.raisons.join(' ; ')}`);
    return tout && reel.ok ? 0 : 1;
}

/** Ce que la séparation fait à ce que l'API sert, produit par produit, jugé contre CE QUI A ÉTÉ ACCORDÉ (pas contre « rien ne bouge »). */
function verdictApi({ avant, apres, groupes }) {
    const justes = groupes.flatMap(g => g.justes), avecJeton = groupes.flatMap(g => g.cibles.filter(c => c.jeton)), sansJeton = groupes.flatMap(g => g.cibles.filter(c => !c.jeton)).map(c => c.idProduct);
    const cmp = P.compareEntrees(avant.entrees, apres.entrees, sansJeton);
    const servis = new Set(apres.entrees.map(e => e.idProduct));
    const e1 = id => apres.entrees.find(x => x.idProduct === id), e0 = id => avant.entrees.find(x => x.idProduct === id);
    const ciblesAttendues = avecJeton.map(c => c.idProduct), ciblesServies = ciblesAttendues.filter(id => servis.has(id));
    const variantes = Object.fromEntries(avecJeton.filter(c => servis.has(c.idProduct)).map(c => [c.idProduct, e1(c.idProduct).variante]));
    const justesPerdus = justes.filter(id => !servis.has(id));
    const sansJetonPerdues = sansJeton.filter(id => !servis.has(id));
    const attenduChanges = new Set([...justes, ...ciblesAttendues]);
    const changesHorsDecision = cmp.changes.filter(id => !attenduChanges.has(id));
    const visuelInchange = justes.every(j => { const a = e0(j), b = e1(j); return !!b && a.grande?.cle === b.grande?.cle && a.vignette?.cle === b.vignette?.cle && a.visuel === b.visuel; });
    const memeFichier = groupes.every(g => g.cibles.filter(c => c.jeton).every(c => g.justes.some(j => e1(c.idProduct) && e1(j) && e1(c.idProduct).grande?.cle === e1(j).grande?.cle)));
    const raisons = [];
    if (ciblesServies.length !== ciblesAttendues.length) raisons.push(`cibles à jeton servies ${ciblesServies.length}/${ciblesAttendues.length}`);
    if (avecJeton.some(c => servis.has(c.idProduct) && e1(c.idProduct).variante !== c.jeton)) raisons.push('une cible à jeton est servie avec une autre variante que son jeton');
    if (justes.some(id => servis.has(id) && e1(id).variante !== 'normale')) raisons.push('un produit juste n\'est pas servi avec la variante « normale »');
    if (justesPerdus.length) raisons.push(`justes perdus ${justesPerdus.join(',')}`);
    if (sansJetonPerdues.length !== sansJeton.length) raisons.push(`cibles sans jeton encore servies : ${sansJeton.filter(id => servis.has(id)).join(',')}`);
    if (cmp.autresPerdus.length) raisons.push(`autres produits perdus ${cmp.autresPerdus.join(',')}`);
    if (cmp.gagnes.length) raisons.push(`produits gagnés ${cmp.gagnes.join(',')}`);
    if (changesHorsDecision.length) raisons.push(`produits changés hors décision ${changesHorsDecision.join(',')}`);
    if (!visuelInchange) raisons.push('le visuel d\'un juste a changé');
    if (!memeFichier) raisons.push('une cible à jeton ne partage plus le fichier de son juste');
    return { ok: !raisons.length, raisons, ciblesAttendues, ciblesServies, variantes, justesPerdus, sansJetonAttendues: sansJeton, sansJetonPerdues, autresPerdus: cmp.autresPerdus, gagnes: cmp.gagnes, changesHorsDecision, visuelInchange, memeFichier };
}

module.exports = { executer, verdictApi, AUTORISES };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    if (!process.env.MONGODB_CARTES_LECTURE_URI) require('dotenv').config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });
    (async () => {
        const GC = require('./collecte-cartes/garde-contrat-api');
        const lireEtat = async api => {
            const { jugerLecture } = require('./collecte-cartes/base-banc');
            const j = jugerLecture(process.env, 'cartes');
            if (!j.ok) throw new Error(j.raison);
            return require('./collecte-cartes/phase2-lecture').lireEtat({ uri: j.uri, dbName: 'cartes', projectionsCartes: api.projectionsEtat.cartes, projectionsLignes: api.projectionsEtat.cartesProduits });
        };
        const val = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
        const ouvrirEcriture = async () => { const { ouvrirConnexions } = require('./collecte-cartes/garde'); const o = await ouvrirConnexions({ production: false, buckets: [] }); return { db: o.cartes.db, fermer: o.fermer }; };
        const code = await executer({
            argv: process.argv.slice(2), env: process.env, ppid: process.ppid, chargerApi: () => GC.chargerApi(), lireEtat, ouvrirEcriture,
            ecrireFichier: (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }, lireFichier: p => fs.readFileSync(p, 'utf8'),
            contrat: GC, garde: require('./collecte-cartes/garde-lot'),
            regleSite: () => require('./collecte-cartes/h-fix-site').chargerRegle({ racine: __dirname, siteLib: val('site-lib') || DEFAUT_SITE_LIB })
        });
        process.exitCode = code;
    })().catch(e => { console.error('❌', sans(e.stack || e.message)); process.exitCode = 1; });
}
