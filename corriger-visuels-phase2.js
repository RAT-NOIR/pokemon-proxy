// ============================================================
// PHASE 2 — TABLE FERMÉE : retirer 2 visuels faux (lot A), marquer 3 images empruntées (lot B) ; le lot C (11 « faux » de la planche des incertains) n'a rien à écrire
// ============================================================
//   node corriger-visuels-phase2.js --lot=A|B|C --essai [--sortie=<dossier>] [--site-lib=<lib du site>]   (À BLANC : lecture seule, rien n'est écrit en base)
//   node lot-additif.js --quoi="PHASE 2 lot A" --collections=images,cartes,cartes_produits --annonce=<annonce-lot-A.json> -- node corriger-visuels-phase2.js --lot=A --ecrire --attendu=2
//   node lot-additif.js --quoi="PHASE 2 lot B" --collections=cartes --annonce=<annonce-lot-B.json> -- node corriger-visuels-phase2.js --lot=B --ecrire --attendu=3
//   node lot-additif.js … -- node corriger-visuels-phase2.js --lot=B --annuler --ecrire --attendu=3      (l'annulation EXACTE du lot B)
// La table (collecte-cartes/phase2-visuels.js) est FERMÉE : les idProduct et les clés d'entrée y sont écrits. Le script LÈVE sur toute cible absente, déjà dans l'état visé, ou dont l'entrée sert un autre produit
// que ceux de la table. Le lot A passe par l'outil EXISTANT retirer-visuels.js (R2 gardé, document `images` à « retire ») ; le lot B pose `imageEmprunteeTirage: true` par un `$set` positionnel borné.
// L'essai rejoue la VRAIE décision de l'API (chaîne importée : garde-contrat-api.js::chargerApi) sur la base entière avant / après, le contrat de l'API, la règle du site et la garde de lot.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ quiet: true });
if (!process.env.MONGODB_CARTES_LECTURE_URI) require('dotenv').config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });
const P = require('./collecte-cartes/phase2-visuels');

const AUTORISES = [/^--lot=[ABC]$/, /^--essai$/, /^--ecrire$/, /^--annuler$/, /^--attendu=\d+$/, /^--sortie=.+$/, /^--site-lib=.+$/];
const val = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const DEFAUT_SORTIE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/PHASE2';
const DEFAUT_SITE_LIB = 'C:/Users/Yung/Desktop/rat-market-site/lib';
const sans = u => String(u ?? '').replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');

/** L'état, lu avec l'utilisateur de LECTURE SEULE (jamais l'URI d'écriture) : sets entiers, cartes et lignes avec les projections RÉUNIES du site et de l'API (comme lot-additif.js). */
async function lireEtat(api) {
    const { jugerLecture } = require('./collecte-cartes/base-banc');
    const j = jugerLecture(process.env, 'cartes');
    if (!j.ok) throw new Error(j.raison);
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(j.uri);
    await client.connect();
    try {
        const db = client.db('cartes');
        const [sets, cartes, cartesProduits] = await Promise.all([db.collection('sets').find({}).toArray(),
            db.collection('cartes').find({}).project({ ...api.projectionsEtat.cartes }).toArray(), db.collection('cartes_produits').find({}).project({ ...api.projectionsEtat.cartesProduits }).toArray()]);
        for (const [n, l] of [['sets', sets], ['cartes', cartes], ['cartes_produits', cartesProduits]]) if (!l.length) throw new Error(`« ${n} » est VIDE : base fausse`);
        const imagesRetirees = async cles => (await db.collection('images').find({ cleR2: { $in: cles } }).project({ cleR2: 1, etat: 1 }).toArray());
        return { sets, cartes, cartesProduits, imagesRetirees };
    } finally { await client.close(); }
}
/** La décision de l'API sur un état (documents bruts → enregistrements compacts, comme le chargeur). */
async function decider(api, { sets, cartes, cartesProduits }) {
    const I = api.interneur();
    return api.decider({ sets: sets.map(s => api.compacterSet(s, I)), docs: cartes.map(d => api.compacterCarte(d, I)), lignes: cartesProduits.map(l => api.compacterLigne(l, I)), metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false });
}
const candidatsDe = (lot, geste) => {
    if (lot === 'A') return [...P.RETRAIT, ...P.ECARTES.filter(x => x.lot === 'A')];
    if (lot === 'B') return [...P.EMPRUNT, ...P.ECARTES.filter(x => x.lot === 'B')];
    return P.ECARTES.filter(x => x.lot === 'C' && x.geste === geste);
};
const gesteDe = lot => (lot === 'A' ? 'A' : 'B');

async function main() {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — usage : --lot=A|B|C (--essai | --ecrire --attendu=N [--annuler])`); process.exit(2); }
    const LOT = val('lot'), ESSAI = process.argv.includes('--essai'), ECRIRE = process.argv.includes('--ecrire'), ANNULER = process.argv.includes('--annuler');
    const ATTENDU = val('attendu') === null ? undefined : Number(val('attendu'));
    if (!LOT || ESSAI === ECRIRE) { console.error('❌ --lot=A|B|C et exactement un de --essai / --ecrire'); process.exit(2); }
    if (ANNULER && (!ECRIRE || LOT !== 'B')) { console.error('❌ --annuler ne vaut qu\'avec --lot=B --ecrire'); process.exit(2); }
    P.verifierTables();
    const SORTIE = val('sortie') || DEFAUT_SORTIE, SITE_LIB = val('site-lib') || DEFAUT_SITE_LIB;
    const { autoriser } = require('./collecte-cartes/garde-ecriture');
    const ecrireFichier = (nom, contenu) => { const p = autoriser(path.join(SORTIE, nom), [SORTIE]); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, contenu); return p; };
    if (ECRIRE) { try { P.garderSousLot(process.env, process.ppid); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    if (ECRIRE && LOT === 'C') { console.error('❌ lot C : aucune cible à écrire (les 11 partagent leur entrée avec un produit juste) — rien n\'est écrit'); process.exit(1); }

    const GC = require('./collecte-cartes/garde-contrat-api');
    const api = await GC.chargerApi();
    const etat = await lireEtat(api);
    const avant = await decider(api, etat);
    const d0 = avant.denominateurs;
    console.log(`DÉNOMINATEURS : sets ${etat.sets.length} · cartes ${etat.cartes.length} · cartes_produits ${etat.cartesProduits.length} · produits servis par l'API AVANT : ${new Set(avant.entrees.map(e => e.idProduct)).size} (entrées ${d0.ecrites}) · refus de famille ${JSON.stringify(d0.repliRefuse.parFamille)} · partageIncoherent ${d0.partageIncoherent}`);
    if (d0.ecrites < 1000) throw new Error('moins de 1000 entrées servies : base fausse');

    if (ANNULER) {
        // l'annulation EXACTE : seulement les entrées que ce lot a marquées (même marque de lot), cibles = la table fermée du lot B
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const o = await ouvrirConnexions({ production: false, buckets: [] });
        try {
            const r = await P.annulerEmprunt(o.cartes.db, P.operationsAnnulation(P.EMPRUNT), { attendu: ATTENDU });
            console.log(`✅ annulées ${r.modifiees}/${P.EMPRUNT.length}`);
        } finally { await o.fermer(); }
        return;
    }
    // ── 1. Chaque lot, chaque candidat, jugé par planifier (le geste de la table, ou celui que le produit appelle pour le lot C)
    const gestes = LOT === 'C' ? ['A', 'B'] : [gesteDe(LOT)];
    const retenues = [], refus = [], parGeste = {};
    for (const g of gestes) {
        const table = candidatsDe(LOT, LOT === 'C' ? (g === 'A' ? 'retrait' : 'emprunt') : null);
        const p = P.planifier({ lot: g, table, cartes: etat.cartes, lignes: etat.cartesProduits, entrees: avant.entrees });
        parGeste[g] = { table, ...p };
        retenues.push(...p.retenues.map(x => ({ ...x, geste: g }))); refus.push(...p.refus.map(x => ({ ...x, geste: g })));
    }
    console.log(`\nLOT ${LOT} : ${retenues.length} cible(s) RETENUE(S), ${refus.length} REFUSÉE(S)`);
    for (const r of retenues) console.log(`   ✅ ${r.idProduct} ${r.nom ?? ''} — entrée ${r.set} n°${r.numero ?? '-'} (${r.cleR2}) : servie à ce seul produit`);
    const tableEcrite = LOT === 'A' ? P.RETRAIT : LOT === 'B' ? P.EMPRUNT : [];
    for (const r of refus) console.log(`   ⛔ ${r.idProduct} (geste ${r.geste === 'A' ? 'retrait' : 'emprunt'}) : ${sans(r.raison)}`);
    // la table fermée doit être EXACTEMENT ce que planifier retient (ni plus, ni moins) : une divergence est une table périmée ou une base qui a bougé
    const attendus = tableEcrite.map(x => x.idProduct).sort((a, b) => a - b), obtenus = retenues.map(x => x.idProduct).sort((a, b) => a - b);
    if (JSON.stringify(attendus) !== JSON.stringify(obtenus)) throw new Error(`la table fermée du lot ${LOT} (${attendus.join(',')}) n'est pas ce que planifier retient (${obtenus.join(',')}) : table périmée ou base changée — rien n'est écrit`);
    const horsListe = refus.filter(r => !P.ECARTES.some(e => e.idProduct === r.idProduct) && !tableEcrite.some(e => e.idProduct === r.idProduct));
    if (horsListe.length) throw new Error(`refus hors table : ${horsListe.map(x => x.idProduct).join(',')}`);
    // un écarté qui deviendrait écrivable serait une nouvelle instruction : il se DIT
    const libres = retenues.filter(r => P.ECARTES.some(e => e.idProduct === r.idProduct));
    if (libres.length) console.log(`   ⚠️ ÉCARTÉ DEVENU ÉCRIVABLE (son entrée n'est plus partagée) : ${libres.map(x => x.idProduct).join(', ')} — à réinstruire, la table n'est pas modifiée par ce script`);

    // ── 2. LA PREUVE PAR LA DÉCISION DE L'API : chaque écarté, son geste essayé SEUL (ce qu'il ferait aux autres produits)
    if (ESSAI) {
        console.log('\nPREUVE DU PIÈGE — le geste de chaque écarté, essayé seul, rejoué sur la base entière (décision réelle de l\'API) :');
        for (const r of refus) {
            const x = P.ECARTES.find(e => e.idProduct === r.idProduct); if (!x) continue;
            const seul = P.appliquer({ cartes: etat.cartes }, r.geste, [x]);
            const apres = await decider(api, { ...etat, cartes: seul.cartes });
            const d = P.compareEntrees(avant.entrees, apres.entrees, [x.idProduct]);
            console.log(`   ${x.idProduct} ${r.geste === 'A' ? 'retrait' : 'emprunt'} seul : autres produits PERDUS ${d.autresPerdus.length ? d.autresPerdus.join(',') : '0'} · CHANGÉS (autre impression servie) ${d.changes.filter(i => i !== x.idProduct).length ? d.changes.filter(i => i !== x.idProduct).join(',') : '0'} · la cible : ${d.perdus.includes(x.idProduct) ? 'perdue' : d.changes.includes(x.idProduct) ? 'changée' : 'inchangée'} · attendu juste (ses partageurs) : ${x.partageAvec.join(',')} ${[...d.autresPerdus, ...d.changes].some(i => x.partageAvec.includes(i)) ? '— un produit JUSTE est touché' : ''}`);
        }
    }

    // ── 3. Le lot écrit : simulation complète (API, contrat, site, garde de lot)
    if (!tableEcrite.length) {
        console.log(`\nLOT ${LOT} : aucune cible à écrire. ${ESSAI ? 'Essai terminé : rien à simuler, rien à écrire.' : ''}`);
        if (ESSAI) ecrireFichier(`essai-lot-${LOT}.json`, JSON.stringify({ lot: LOT, retenues: [], refus: refus.map(r => ({ idProduct: r.idProduct, geste: r.geste, raison: sans(r.raison) })) }, null, 1));
        return;
    }
    const arret = P.motifDArret({ nbRetenues: retenues.length, nbRefus: refus.filter(r => tableEcrite.some(t => t.idProduct === r.idProduct)).length, attendu: ECRIRE ? ATTENDU : retenues.length });
    if (arret) { console.error(`❌ ARRÊT : ${arret}`); process.exitCode = 1; return; }
    const g = gesteDe(LOT);
    const sim = P.appliquer({ cartes: etat.cartes }, g, retenues);
    const etatApres = { ...etat, cartes: sim.cartes };
    const apres = await decider(api, etatApres);
    const cmp = P.compareEntrees(avant.entrees, apres.entrees, retenues.map(x => x.idProduct));
    const servis = es => new Set(es.map(e => e.idProduct)).size;
    console.log(`\nSIMULATION DE L'API (decider, base entière) — avant → après`);
    console.log(`   produits servis ${servis(avant.entrees)} → ${servis(apres.entrees)} · entrées ${d0.ecrites} → ${apres.denominateurs.ecrites}`);
    console.log(`   produits PERDUS : ${cmp.perdus.join(', ') || 'aucun'} (cibles : ${retenues.map(x => x.idProduct).join(', ')}) · autres perdus : ${cmp.autresPerdus.length ? cmp.autresPerdus.join(',') : '0'} · CHANGÉS : ${cmp.changes.length ? cmp.changes.join(',') : '0'} · GAGNÉS : ${cmp.gagnes.length ? cmp.gagnes.join(',') : '0'}`);
    console.log(`   refus de famille : ${JSON.stringify(apres.denominateurs.repliRefuse.parFamille)} (avant : ${JSON.stringify(d0.repliRefuse.parFamille)}) · partageIncoherent ${d0.partageIncoherent} → ${apres.denominateurs.partageIncoherent}`);
    console.log(`   VERDICT : ${cmp.ok ? '✅ exactement les cibles sont retirées de ce que l\'API sert, aucun autre produit ne bouge' : '🔴 ÉCHEC : le geste touche un autre produit'}`);
    const contrat = await GC.verifierContrat({ api, avant: { sets: etat.sets, cartes: etat.cartes, cartesProduits: etat.cartesProduits }, apres: { sets: etatApres.sets, cartes: etatApres.cartes, cartesProduits: etatApres.cartesProduits } });
    console.log(`   ${GC.ligneContrat(contrat)} · sets rejoués : ${contrat.slugs.join(', ')}`);
    console.log(`   CONTRAT : ${contrat.nouveaux.length ? `🔴 ${contrat.nouveaux.length} refus NOUVEAU(X) : ${contrat.nouveaux.map(n => `${n.idProduct} ${sans(n.motif)}`).join(' ; ')}` : '✅ zéro refus nouveau'}`);
    // la règle du site, rejouée sur les sets touchés
    const H = require('./collecte-cartes/h-fix-site');
    const R = await H.chargerRegle({ racine: __dirname, siteLib: SITE_LIB });
    const sTouches = [...new Set(retenues.map(x => x.set))];
    const setsT = etat.sets.filter(s => sTouches.includes(s._id)), exps = new Set(setsT.flatMap(s => [].concat(s.idExpansion ?? [])));
    const lignesT = etat.cartesProduits.filter(l => exps.has(l.idExpansion));
    const servSite = (cartes) => H.servir(R, { sets: setsT, cartes, lignes: lignesT });
    const sa = servSite(etat.cartes), sb = servSite(sim.cartes), dif = H.diff(sa, sb);
    console.log(`   SITE (règle importée, sets ${sTouches.join(', ')}) : ${sa.size} produits rejoués · ${dif.length} différence(s)${dif.length ? ' : ' + dif.map(x => `${x.k} ${x.nature}${x.a?.cleR2 ? ` (${x.a.cleR2} → ${x.b?.cleR2 ?? 'aucun'})` : ''}`).join(' ; ') : ''}`);
    const attenduSite = g === 'A' ? retenues.length : 0;
    const siteOk = dif.length === attenduSite && dif.every(x => x.nature === 'visuel changé' && x.b?.cleR2 == null && retenues.some(r => x.k.endsWith(`|${r.idProduct}|${r.carteId}`)));
    console.log(`   SITE : ${siteOk ? `✅ ${g === 'A' ? 'seul le visuel des cibles disparaît' : 'le site affiche les mêmes images (avec la mention des images empruntées)'}` : '🔴 ÉCART INATTENDU'}`);
    // la garde de lot : ce qu'elle compterait, et l'annonce à passer à lot-additif
    const GL = require('./collecte-cartes/garde-lot');
    const cm = GL.comparer(GL.compterEtat({ cartes: etat.cartes, cartesProduits: etat.cartesProduits, sets: etat.sets }), GL.compterEtat({ cartes: sim.cartes, cartesProduits: etat.cartesProduits, sets: etat.sets }));
    const annonce = Object.fromEntries(cm.baisses.filter(b => !b.autorisee).map(b => [b.cle, b.baisse]));
    GL.validerAnnonces(annonce);
    console.log(`   GARDE DE LOT (simulée) : ${cm.baisses.length} baisse(s), ${cm.nonAutorisees.length} non autorisée(s) → annonce ${JSON.stringify(annonce)} · hausses ${JSON.stringify(cm.hausses)}`);
    if (!cmp.ok || contrat.nouveaux.length || !siteOk) { console.error('🔴 ARRÊT : l\'essai ne tient pas ; rien n\'est écrit.'); process.exitCode = 1; return; }

    if (ESSAI) {
        const f = ecrireFichier(`annonce-lot-${LOT}.json`, JSON.stringify(annonce, null, 1));
        ecrireFichier(`essai-lot-${LOT}.json`, JSON.stringify({ lot: LOT, retenues: retenues.map(x => ({ idProduct: x.idProduct, carteId: x.carteId, set: x.set, numero: x.numero, cleR2: x.cleR2 })), refus: refus.map(r => ({ idProduct: r.idProduct, geste: r.geste, raison: sans(r.raison) })),
            api: { servisAvant: servis(avant.entrees), servisApres: servis(apres.entrees), perdus: cmp.perdus, changes: cmp.changes, gagnes: cmp.gagnes, refusFamilleAvant: d0.repliRefuse.parFamille, refusFamilleApres: apres.denominateurs.repliRefuse.parFamille }, contrat: { nouveaux: contrat.nouveaux.length, persistants: contrat.persistants.length, slugs: contrat.slugs }, site: { differences: dif.length }, annonce }, null, 1));
        console.log(`\n(essai à blanc : annonce écrite dans ${f} ; écriture : ${LOT === 'A'
            ? `node lot-additif.js --quoi="PHASE 2 lot A : retrait de 2 visuels faux" --collections=images,cartes,cartes_produits --annonce=${f} -- node corriger-visuels-phase2.js --lot=A --ecrire --attendu=${retenues.length}`
            : `node lot-additif.js --quoi="PHASE 2 lot B : 3 images empruntées" --collections=cartes -- node corriger-visuels-phase2.js --lot=B --ecrire --attendu=${retenues.length}`})`);
        return;
    }

    // ── 4. L'ÉCRITURE : exactement le lot simulé, sous lot-additif.js
    if (LOT === 'A') {
        const cmd = P.commandeRetrait(retenues);
        console.log(`\nÉCRITURE lot A : node ${cmd[0]} ${cmd.slice(1).map(a => a.startsWith('--motif=') ? '--motif=<motif>' : a).join(' ')}`);
        const c = spawnSync(process.execPath, cmd, { stdio: 'inherit', cwd: __dirname, env: process.env });
        if (c.status !== 0) { console.error(`🔴 retirer-visuels.js a rendu le code ${c.status}`); process.exitCode = 1; }
    } else {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const o = await ouvrirConnexions({ production: false, buckets: [] });
        try {
            const ops = P.operationsEmprunt(retenues);
            const r = await P.ecrireEmprunt(o.cartes.db, ops, { attendu: ATTENDU });
            console.log(`✅ marquées ${r.modifiees}/${ops.length}`);
        } finally { await o.fermer(); }
    }
    // ── 5. RELECTURE (utilisateur de lecture) : le lot est dans l'état visé, rien d'autre n'a bougé côté API
    const relu = await lireEtat(api);
    const apresReel = await decider(api, relu);
    const cmpReel = P.compareEntrees(avant.entrees, apresReel.entrees, retenues.map(x => x.idProduct));
    const entreesRelues = relu.cartes.filter(c => retenues.some(x => x.carteId === c._id)).flatMap(c => c.images || []);
    const etatVise = LOT === 'A' ? retenues.every(x => !relu.cartes.find(c => c._id === x.carteId)?.images?.some(m => m.cleR2 === x.cleR2))
        : retenues.every(x => entreesRelues.some(m => m.cleR2 === x.cleR2 && m.set === x.set && m.imageEmprunteeTirage === true));
    let docsOk = true;
    if (LOT === 'A') { const docs = await relu.imagesRetirees(retenues.map(x => x.cleR2)); docsOk = docs.length === retenues.length && docs.every(d => d.etat === 'retire'); console.log(`   documents images à l'état « retire » : ${docs.filter(d => d.etat === 'retire').length}/${retenues.length}`); }
    console.log(`RELECTURE : ${etatVise && docsOk ? '✅' : '🔴'} cibles dans l'état visé · API : perdus ${cmpReel.perdus.join(',') || 'aucun'} · autres perdus ${cmpReel.autresPerdus.length} · changés ${cmpReel.changes.length} · gagnés ${cmpReel.gagnes.length}`);
    if (!etatVise || !docsOk || !cmpReel.ok) process.exitCode = 1;
}
main().catch(e => { console.error('❌', sans(e.stack || e.message)); process.exitCode = 1; });
