'use strict';
// ============================================================
// LES COMPTEURS A, B, C — LECTURE SEULE (brief S8/PHASE3A-SUITE, testeur, 2026-10-24)
// ============================================================
//   A. 0 produit sans ligne : tout produit Cardmarket doit pouvoir être identifié par l'API.
//   B. 0 fiche douteuse servie : chaque fiche confirmée par deux sources, sinon « à confirmer » et exclue de l'identification.
//   C. Visuels : le meilleur visuel disponible — un vrai scan, sinon un visuel emprunté avec sa mention, un trou seulement s'il n'existe rien.
// 🔑 CE QUI EST IMPORTÉ, JAMAIS RECOPIÉ : l'état de l'API rejoué par audit-catalogue/etat-api.js (chargerDonnees, rejouerApi, assembler, mesurerSets, controlerTemoin).
//    Ce module ne CLASSE rien lui-même : il COMPTE les classes que l'audit a posées (classement.js), sans classe à seuil (pas d'empreinte, pas de comparaison).
// Écrit par ce qu'il AUTORISE : chaque classe est dans une liste fermée et petite ; une classe inconnue LÈVE (un repli sur « autre » fabriquerait un compte plausible).
// Sorties : S8\COMPTEURS seulement, par garde-ecriture.js::autoriser — jamais S8\AUDIT, que l'outil d'audit écrit.
const fs = require('fs');
const path = require('path');
const { autoriser } = require('../collecte-cartes/garde-ecriture');

const DOSSIER_COMPTEURS = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\COMPTEURS';
const CLASSES_FICHE = Object.freeze(['FICHE_OK', 'FICHE_DOUTEUSE', 'LIGNE_SANS_FICHE', 'SANS_LIGNE']);
// les classes du visuel SANS seuil (classement.js::classerVisuel) : A_COMPARER = un vrai scan servi, ni emprunté ni en basse définition
const CLASSES_VISUEL = Object.freeze(['A_COMPARER', 'BASSE_DEFINITION', 'EMPRUNTE', 'MANQUANT']);
const MOTIF_EMPRUNT_REFUSE = 'emprunt-refuse-par-api';   // même valeur que classement.js::MOTIF_EMPRUNT_REFUSE (importée ci-dessous, vérifiée à l'exécution)
const CLES_RESUME = Object.freeze(['produits', 'sansLigne', 'ligneSansFiche', 'douteuses', 'vraiScan', 'emprunte', 'basseDefinition', 'aucunVisuel']);

const compter = (xs, cle) => { const m = new Map(); for (const x of xs) for (const k of [].concat(cle(x))) m.set(k, (m.get(k) || 0) + 1); return Object.fromEntries([...m].sort((a, b) => b[1] - a[1])); };
const nonVide = x => typeof x === 'string' && x.trim() !== '';

/**
 * @param {{ produits: object[], lignesSet: object[], denominateur: { catalogue: number, cartesCode: number }, rang?: number, controleTemoin?: object }} e
 *   `produits` : ceux d'`assembler` (audit-catalogue/etat-api.js) ; `lignesSet` : `mesurerSets(...).lignesSet` (la famille et le nom de chaque expansion).
 */
function calculerCompteurs({ produits, lignesSet, denominateur, rang = 20, controleTemoin = null }) {
    if (!Array.isArray(produits) || !produits.length) throw new Error('calculerCompteurs : population vide — un compte sur zéro produit n\'est pas une mesure (§41)');
    const attendu = denominateur.catalogue - denominateur.cartesCode;
    if (attendu !== produits.length) throw new Error(`calculerCompteurs : dénominateur incohérent — catalogue ${denominateur.catalogue} − cartes-code ${denominateur.cartesCode} = ${attendu}, produits reçus ${produits.length}`);
    const exp = new Map(lignesSet.map(l => [l.idExpansion, l]));
    for (const p of produits) {
        if (!CLASSES_FICHE.includes(p.fiche?.classe)) throw new Error(`calculerCompteurs : classe de fiche inconnue « ${p.fiche?.classe} » (produit ${p.idProduct}) — la liste fermée est ${CLASSES_FICHE.join(', ')}`);
        if (!CLASSES_VISUEL.includes(p.visuel?.classe)) throw new Error(`calculerCompteurs : classe de visuel inconnue « ${p.visuel?.classe} » (produit ${p.idProduct}) — ni seuil ni comparaison ici : ${CLASSES_VISUEL.join(', ')}`);
        if (!exp.has(p.idExpansion)) throw new Error(`calculerCompteurs : expansion ${p.idExpansion} (produit ${p.idProduct}) absente de la mesure des sets — la famille ne se devine pas`);
    }
    const N = produits.length;
    const de = cl => produits.filter(p => p.fiche.classe === cl);
    const dv = cl => produits.filter(p => p.visuel.classe === cl);
    // ── A
    const parExp = new Map();
    for (const p of produits) {
        const l = exp.get(p.idExpansion);
        const e = parExp.get(p.idExpansion) || parExp.set(p.idExpansion, { idExpansion: p.idExpansion, codeSet: l.codeSet ?? null, nom: l.nom ?? null, famille: l.famille ?? null, produits: 0, sansLigne: 0, ligneSansFiche: 0 }).get(p.idExpansion);
        e.produits++; if (p.fiche.classe === 'SANS_LIGNE') e.sansLigne++; if (p.fiche.classe === 'LIGNE_SANS_FICHE') e.ligneSansFiche++;
    }
    const parFamille = {};
    for (const e of parExp.values()) {
        const f = parFamille[e.famille] || (parFamille[e.famille] = { produits: 0, sansLigne: 0, ligneSansFiche: 0 });
        f.produits += e.produits; f.sansLigne += e.sansLigne; f.ligneSansFiche += e.ligneSansFiche;
    }
    const classer = cle => [...parExp.values()].filter(e => e[cle] > 0).sort((a, b) => b[cle] - a[cle] || a.idExpansion - b.idExpansion);
    const sl = classer('sansLigne'), lsf = classer('ligneSansFiche');
    const A = { sansLigne: de('SANS_LIGNE').length, ligneSansFiche: de('LIGNE_SANS_FICHE').length, parFamille,
        expansionsConcernees: sl.length, parExpansionSansLigne: sl.slice(0, rang),
        expansionsLigneSansFicheConcernees: lsf.length, parExpansionLigneSansFiche: lsf.slice(0, rang) };
    // ── B : les fiches douteuses SERVIES. Le marquage « à confirmer » et l'exclusion de l'identification n'existent pas encore : on le dit, on ne l'invente pas.
    const dout = de('FICHE_DOUTEUSE');
    const B = { douteuses: dout.length, motifs: compter(dout, p => p.fiche.motifs), motifsParNombre: compter(dout, p => String(p.fiche.motifs.length)),
        marquageAConfirmer: 'inexistant',
        note: 'Aucun marquage « à confirmer » ni exclusion de l\'identification n\'existe aujourd\'hui : ces fiches sont SERVIES telles quelles. Ce compteur dit combien devraient être marquées, pas combien le sont.',
        temoinMuet: produits.filter(p => p.fiche.temoinMuet).length, controleTemoin };
    // ── C
    const emp = dv('EMPRUNTE'), manq = dv('MANQUANT');
    const C = { vraiScan: dv('A_COMPARER').length, emprunte: emp.length, basseDefinition: dv('BASSE_DEFINITION').length, aucunVisuel: manq.length,
        empruntesAvecMention: emp.filter(p => nonVide(p.visuel.entree?.mention)).length, empruntesSansMention: emp.filter(p => !nonVide(p.visuel.entree?.mention)).length,
        empruntesParNature: compter(emp, p => p.visuel.motifs.filter(m => m !== 'basse-definition')),
        aucunVisuelSansLigne: manq.filter(p => p.fiche.classe === 'SANS_LIGNE').length, aucunVisuelAvecLigne: manq.filter(p => p.fiche.classe !== 'SANS_LIGNE').length,
        empruntRefuseParApi: manq.filter(p => p.visuel.motifs.includes(MOTIF_EMPRUNT_REFUSE)).length,
        motifsAucun: compter(manq, p => p.visuel.motifs) };
    const controles = { sommeFiches: A.sansLigne + A.ligneSansFiche + B.douteuses + de('FICHE_OK').length, sommeVisuels: C.vraiScan + C.emprunte + C.basseDefinition + C.aucunVisuel };
    if (controles.sommeFiches !== N || controles.sommeVisuels !== N) throw new Error(`calculerCompteurs : les classes ne somment pas au dénominateur ${N} ${JSON.stringify(controles)}`);
    const resume = { produits: N, sansLigne: A.sansLigne, ligneSansFiche: A.ligneSansFiche, douteuses: B.douteuses, vraiScan: C.vraiScan, emprunte: C.emprunte, basseDefinition: C.basseDefinition, aucunVisuel: C.aucunVisuel };
    return { denominateur: { catalogue: denominateur.catalogue, cartesCode: denominateur.cartesCode, produits: N }, A, B, C, controles, resume };
}

// ── L'HISTORIQUE ET L'ÉCART ──
/** Lit historique.jsonl. Une ligne illisible LÈVE : l'ignorer fausserait « la précédente » sans que rien ne le dise. */
function lireHistorique(texte) {
    const out = [];
    String(texte).split(/\r?\n/).forEach((l, i) => {
        if (!l.trim()) return;
        try { out.push(JSON.parse(l)); } catch { throw new Error(`historique.jsonl : ligne ${i + 1} illisible`); }
    });
    return out;
}
const memeDen = (a, b) => !!a && !!b && a.catalogue === b.catalogue && a.cartesCode === b.cartesCode && a.produits === b.produits;
function ecartAvec(courant, ref) {
    const ecarts = {};
    for (const k of CLES_RESUME) ecarts[k] = courant.resume[k] - ref.resume[k];
    return { fichier: ref.fichier ?? null, le: ref.le ?? null, denominateur: ref.denominateur, memeDenominateur: memeDen(courant.denominateur, ref.denominateur), reference: ref.resume, ecarts };
}
/** L'écart contre la première mesure du JOUR et contre la précédente. Un dénominateur qui a changé est dit : un écart n'est un progrès que sous le même dénominateur. */
function ecartHistorique(courant, historique) {
    const duJour = historique.filter(h => h.jour === courant.jour);
    const premiere = duJour[0] || null, precedente = historique[historique.length - 1] || null;
    return { premiereDuJour: premiere && ecartAvec(courant, premiere), precedente: precedente && ecartAvec(courant, precedente) };
}

// ── L'ÉCRITURE : la garde sur la racine COMPTEURS seule ──
/** Le chemin d'une sortie, après la garde. `racines` vaut [dossier] : jamais un autre dossier (surtout pas S8\AUDIT). */
function sortieSure(dossier, nomRelatif, racines) {
    return autoriser(path.join(dossier, nomRelatif), racines || [dossier]);
}
const deux = n => String(n).padStart(2, '0');
const jourLocal = d => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
/**
 * La liste LÉGÈRE des produits : une entrée par produit, avec les classes de l'audit. Même forme que `audit-produits.json` pour les outils de la phase 3a (mesurer-sans-ligne.js lit
 * idProduct, idExpansion, classeFiche) — le même état, au même instant que les compteurs, jamais une liste vieillie.
 */
function listeLegere(produits) {
    return produits.map(p => ({ idProduct: p.idProduct, idExpansion: p.idExpansion, name: p.name, classeFiche: p.fiche.classe, motifsFiche: p.fiche.motifs, classeVisuel: p.visuel.classe, motifsVisuel: p.visuel.motifs }));
}
/** Écrit abc-AAAA-MM-JJ-HHMM.json (heure locale) et AJOUTE une ligne à historique.jsonl ; avec `produitsLegers`, écrit aussi etat-abc-AAAA-MM-JJ-HHMM.json. */
function ecrireSorties({ dossier = DOSSIER_COMPTEURS, resultat, maintenant = new Date(), produitsLegers = null }) {
    const stamp = `${jourLocal(maintenant)}-${deux(maintenant.getHours())}${deux(maintenant.getMinutes())}`;
    const nom = `abc-${stamp}.json`;
    const fichier = sortieSure(dossier, nom), hist = sortieSure(dossier, 'historique.jsonl');
    const produits = produitsLegers ? sortieSure(dossier, `etat-abc-${stamp}.json`) : null;
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(resultat, null, 1));
    if (produits) fs.writeFileSync(produits, JSON.stringify(produitsLegers));
    const ligne = { le: resultat.le, jour: resultat.jour, denominateur: resultat.denominateur, resume: resultat.resume, fichier: nom };
    fs.appendFileSync(hist, JSON.stringify(ligne) + '\n');
    return { fichier, historique: hist, produits };
}
const lireHistoriqueFichier = (dossier = DOSSIER_COMPTEURS) => {
    const p = path.join(dossier, 'historique.jsonl');
    return fs.existsSync(p) ? lireHistorique(fs.readFileSync(p, 'utf8')) : [];
};

// ── L'EXPLICATION DE L'ÉCART AVEC L'AUDIT DU MATIN, PAR PRODUIT ──
/**
 * Où sont passés les produits sans ligne de l'audit ? `matin` : [{ idProduct, classe }] (état-produits.json de S8\AUDIT, lecture seule) ; `produits` : l'état d'aujourd'hui ;
 * `detaches` : les idProduct dont une ligne a été détachée depuis (phase 2). Un produit entré en SANS_LIGNE est dit détaché (connu), nouveau au catalogue, ou « autre » (à ouvrir).
 */
function expliquerEcartSansLigne({ matin, produits, detaches = [] }) {
    const avant = new Map(matin.map(m => [m.idProduct, m.classe]));
    const apres = new Map(produits.map(p => [p.idProduct, p.fiche.classe]));
    const det = new Set(detaches);
    const sortis = [], restes = [], disparus = [], entresDetaches = [], entresAutres = [], nouveaux = [];
    for (const [id, cl] of avant) {
        if (cl !== 'SANS_LIGNE') continue;
        if (!apres.has(id)) disparus.push(id); else if (apres.get(id) === 'SANS_LIGNE') restes.push(id); else sortis.push(id);
    }
    for (const [id, cl] of apres) {
        if (cl !== 'SANS_LIGNE' || avant.get(id) === 'SANS_LIGNE') continue;
        if (!avant.has(id)) nouveaux.push(id); else if (det.has(id)) entresDetaches.push(id); else entresAutres.push(id);
    }
    const matinN = [...avant.values()].filter(c => c === 'SANS_LIGNE').length;
    const entres = entresDetaches.length + entresAutres.length + nouveaux.length;
    const maintenant = [...apres.values()].filter(c => c === 'SANS_LIGNE').length;
    if (matinN - sortis.length - disparus.length + entres !== maintenant) throw new Error('expliquerEcartSansLigne : le bilan ne retombe pas — un produit est compté deux fois ou jamais');
    return { sortis, restes: restes.length, disparusDuCatalogue: disparus.length, entresDetaches: entresDetaches.length, entresAutres, nouveauxAuCatalogue: nouveaux.length,
        bilan: { matin: matinN, sortis: sortis.length, disparus: disparus.length, entres, maintenant } };
}

/**
 * Les TRANSITIONS par produit contre un état antérieur (l'audit du matin) : écrire des lignes fait aussi bouger B et C, et un compteur qui monte (les fiches douteuses : 3 037 → 3 250 le soir
 * du 24/10) demande d'où viennent ses entrées avant d'être lu comme une régression ou un progrès. `matin` : [{ idProduct, fiche: { classe, motifs }, visuel: { classe } }] (état-produits.json de S8\AUDIT).
 */
function transitions({ matin, produits }) {
    const avant = new Map(matin.map(m => [m.idProduct, m]));
    const trier = o => Object.fromEntries(Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
    const fiche = {}, visuel = {}, depuis = {}, motifs = {};
    let nouveaux = 0;
    const vus = new Set();
    for (const p of produits) {
        const m = avant.get(p.idProduct);
        if (!m) { nouveaux++; continue; }
        vus.add(p.idProduct);
        const kf = `${m.fiche.classe}→${p.fiche.classe}`, kv = `${m.visuel.classe}→${p.visuel.classe}`;
        fiche[kf] = (fiche[kf] || 0) + 1; visuel[kv] = (visuel[kv] || 0) + 1;
        if (p.fiche.classe === 'FICHE_DOUTEUSE' && m.fiche.classe !== 'FICHE_DOUTEUSE') {
            depuis[m.fiche.classe] = (depuis[m.fiche.classe] || 0) + 1;
            for (const x of p.fiche.motifs) motifs[x] = (motifs[x] || 0) + 1;
        }
    }
    return { fiche: trier(fiche), visuel: trier(visuel), nouveaux, disparus: matin.filter(m => !vus.has(m.idProduct)).length, entreesDouteuses: { depuis: trier(depuis), motifs: trier(motifs) } };
}

// ── LA SORTIE IMPRIMÉE ──
const pct = (n, N) => `${(100 * n / N).toFixed(1)} %`;
const signe = n => (n > 0 ? `+${n}` : String(n));
function ligneEcart(nom, e) {
    if (!e) return `   écart contre ${nom} : aucune mesure à comparer`;
    const k = e.ecarts;
    return `   écart contre ${nom} (${e.fichier ?? '?'}${e.memeDenominateur ? '' : ' — ⚠️ DÉNOMINATEUR DIFFÉRENT : ' + JSON.stringify(e.denominateur) + ', un écart n\'est pas un progrès'}) : sans ligne ${signe(k.sansLigne)} · ligne sans fiche ${signe(k.ligneSansFiche)} · douteuses ${signe(k.douteuses)} · vrai scan ${signe(k.vraiScan)} · emprunté ${signe(k.emprunte)} · basse déf. ${signe(k.basseDefinition)} · aucun visuel ${signe(k.aucunVisuel)}`;
}
function formater(R, E) {
    const N = R.denominateur.produits, out = [];
    out.push(`DÉNOMINATEUR : catalogue ${R.denominateur.catalogue} − cartes-code ${R.denominateur.cartesCode} = ${N} produits`);
    out.push(`\n══ A — PRODUITS SANS LIGNE (priorité n° 1) : ${R.A.sansLigne} (${pct(R.A.sansLigne, N)}) · à côté, LIGNE_SANS_FICHE : ${R.A.ligneSansFiche} (${pct(R.A.ligneSansFiche, N)})`);
    out.push(`   par famille : ${Object.entries(R.A.parFamille).sort((a, b) => b[1].sansLigne - a[1].sansLigne).map(([f, v]) => `${f} ${v.sansLigne} sans ligne / ${v.ligneSansFiche} sans fiche / ${v.produits}`).join(' · ')}`);
    out.push(`   les ${R.A.parExpansionSansLigne.length} premières expansions sur ${R.A.expansionsConcernees} (sans ligne) :`);
    for (const e of R.A.parExpansionSansLigne) out.push(`     ${String(e.idExpansion).padStart(5)} ${String(e.codeSet ?? '—').padEnd(10)} ${String(e.nom ?? '—').slice(0, 34).padEnd(34)} ${String(e.famille).padEnd(16)} ${String(e.sansLigne).padStart(4)} / ${e.produits}`);
    out.push(`   LIGNE_SANS_FICHE : les ${R.A.parExpansionLigneSansFiche.length} premières expansions sur ${R.A.expansionsLigneSansFicheConcernees} :`);
    for (const e of R.A.parExpansionLigneSansFiche) out.push(`     ${String(e.idExpansion).padStart(5)} ${String(e.codeSet ?? '—').padEnd(10)} ${String(e.nom ?? '—').slice(0, 34).padEnd(34)} ${String(e.famille).padEnd(16)} ${String(e.ligneSansFiche).padStart(4)} / ${e.produits}`);
    out.push(`\n══ B — FICHES DOUTEUSES SERVIES : ${R.B.douteuses} (${pct(R.B.douteuses, N)}) · motifs (non exclusifs) ${JSON.stringify(R.B.motifs)} · par nombre de motifs ${JSON.stringify(R.B.motifsParNombre)}`);
    out.push(`   ⚠️ marquage « à confirmer » : ${R.B.marquageAConfirmer}. ${R.B.note}`);
    if (R.B.controleTemoin) out.push(`   témoin du nom : sur ${R.B.controleTemoin.essais} fiches fabriquées fausses il en contredit ${R.B.controleTemoin.contredits} ; sur ${R.B.controleTemoin.vraiesTestees} vraies il se tait ${R.B.controleTemoin.silenceSurLaVraie} fois · témoin muet sur ${R.B.temoinMuet} produits (zéro « contredite » n'est une mesure que si le témoin SAIT refuser)`);
    out.push(`\n══ C — VISUELS (dénominateur ${N}) : vrai scan servi ${R.C.vraiScan} (${pct(R.C.vraiScan, N)}) · emprunté ${R.C.emprunte} (${pct(R.C.emprunte, N)}) · basse définition ${R.C.basseDefinition} (${pct(R.C.basseDefinition, N)}) · AUCUN visuel ${R.C.aucunVisuel} (${pct(R.C.aucunVisuel, N)})`);
    out.push(`   emprunté : avec mention ${R.C.empruntesAvecMention} · SANS mention ${R.C.empruntesSansMention} · par nature ${JSON.stringify(R.C.empruntesParNature)}`);
    out.push(`   aucun visuel : sans ligne (déjà en A) ${R.C.aucunVisuelSansLigne} · avec ligne ${R.C.aucunVisuelAvecLigne} · dont un emprunt que l'API REFUSE de servir (un visuel existe) ${R.C.empruntRefuseParApi}`);
    out.push(`   motifs de l'aucun visuel : ${JSON.stringify(R.C.motifsAucun)}`);
    out.push(`\n   contrôles : fiches ${R.controles.sommeFiches}/${N} · visuels ${R.controles.sommeVisuels}/${N}`);
    if (E) { out.push(ligneEcart('la PREMIÈRE mesure du jour', E.premiereDuJour)); out.push(ligneEcart('la PRÉCÉDENTE', E.precedente)); }
    return out.join('\n');
}

module.exports = { calculerCompteurs, listeLegere, transitions, lireHistorique, lireHistoriqueFichier, ecartHistorique, ecrireSorties, sortieSure, expliquerEcartSansLigne, formater, jourLocal, DOSSIER_COMPTEURS, CLASSES_FICHE, CLASSES_VISUEL, CLES_RESUME, MOTIF_EMPRUNT_REFUSE };

// ── LANCEMENT : node audit-catalogue/compteurs-abc.js [--sans-ecrire] [--ecart-audit] [--rang=20]
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        const inconnu = args.filter(a => !['--sans-ecrire', '--ecart-audit'].includes(a) && !/^--rang=\d+$/.test(a) && !/^--note=.+$/.test(a));
        if (inconnu.length) throw new Error(`argument inconnu : ${inconnu.join(' ')} (une ligne de commande est une garde : on n'ouvre rien sur un drapeau non reconnu)`);
        const rang = Number((args.find(a => a.startsWith('--rang=')) || '--rang=20').split('=')[1]);
        const { ouvrirLecture, chargerDonnees, rejouerApi, assembler, mesurerSets, controlerTemoin, chargerApi } = require('./etat-api');
        const { rapprocher } = require('./rapprochement');
        const C0 = require('./classement');
        if (C0.MOTIF_EMPRUNT_REFUSE !== MOTIF_EMPRUNT_REFUSE) throw new Error('classement.js::MOTIF_EMPRUNT_REFUSE a changé : le compte « emprunt refusé par l\'API » ne lit plus le bon motif');
        const t0 = Date.now();
        const api = await chargerApi();
        const base = await ouvrirLecture();
        let donnees;
        try { donnees = await chargerDonnees(base, api); } finally { await base.fermer(); }
        const rejeu = await rejouerApi({ api, sets: donnees.sets, docs: donnees.docs, lignes: donnees.lignes, catalogue: donnees.catalogue });
        const rap = rapprocher({ d: rejeu.denominateurs, traces: [...rejeu.traces.values()].flat(), nLignes: donnees.lignes.length, nEntrees: rejeu.entrees.length });
        console.log(`RAPPROCHEMENT decider ✅ ${JSON.stringify(rap.comptes)}`);
        const { produits, horsPerimetre, entreesDuPerimetre } = assembler({ api, donnees, rejeu });
        if (entreesDuPerimetre !== rejeu.entrees.length) throw new Error(`${rejeu.entrees.length - entreesDuPerimetre} entrées de decider portent sur des produits hors du périmètre : le rapprochement ne tient plus`);
        const sets = mesurerSets({ donnees, produits, horsPerimetre });
        const ctl = controlerTemoin({ donnees, produits });
        const maintenant = new Date();
        const R = calculerCompteurs({ produits, lignesSet: sets.lignesSet, denominateur: { catalogue: donnees.catalogue.length, cartesCode: horsPerimetre.length }, rang, controleTemoin: ctl });
        // `--note=` : ce qui est vrai de l'instant de la mesure (file d'images à l'arrêt ou non) — écrit dans le JSON, jamais sous-entendu
        R.note = (args.find(a => a.startsWith('--note=')) || '').slice(7) || null;
        R.le = maintenant.toISOString(); R.jour = jourLocal(maintenant); R.api = api.dossier; R.duree = Math.round((Date.now() - t0) / 1000);
        const E = ecartHistorique(R, lireHistoriqueFichier());
        R.ecart = E;
        console.log('\n' + formater(R, E));
        if (R.note) console.log(`\n   NOTE DE LA MESURE : ${R.note}`);
        if (args.includes('--ecart-audit')) {
            const { DOSSIER_AUDIT } = require('./ecrire');
            const matinComplet = JSON.parse(fs.readFileSync(path.join(DOSSIER_AUDIT, 'etat-produits.json'), 'utf8')).map(p => ({ idProduct: p.idProduct, fiche: { classe: p.fiche.classe, motifs: p.fiche.motifs }, visuel: { classe: p.visuel.classe } }));
            const matin = matinComplet.map(p => ({ idProduct: p.idProduct, classe: p.fiche.classe }));
            const TR = transitions({ matin: matinComplet, produits });
            R.transitionsAudit = TR;
            console.log(`\nTRANSITIONS contre l'audit du matin (dénominateur ${matinComplet.length}) : nouveaux ${TR.nouveaux} · disparus ${TR.disparus}\n   fiche : ${JSON.stringify(TR.fiche)}\n   visuel : ${JSON.stringify(TR.visuel)}\n   entrées en FICHE_DOUTEUSE : depuis ${JSON.stringify(TR.entreesDouteuses.depuis)} · motifs ${JSON.stringify(TR.entreesDouteuses.motifs)}`);
            const resumeMatin = JSON.parse(fs.readFileSync(path.join(DOSSIER_AUDIT, 'resume-etat.json'), 'utf8'));
            const detaches = JSON.parse(fs.readFileSync('C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\PHASE3A\\produits-detaches-phase2.json', 'utf8'));
            const X = expliquerEcartSansLigne({ matin, produits, detaches });
            R.ecartAudit = { audit: resumeMatin.le, denominateurMatin: resumeMatin.denominateur, ...X, entresAutres: X.entresAutres.slice(0, 200), nEntresAutres: X.entresAutres.length, sortis: X.sortis.length, echantillonSortis: X.sortis.slice(0, 50) };
            console.log(`\nÉCART AVEC L'AUDIT DU MATIN (${resumeMatin.le}, dénominateur ${JSON.stringify(resumeMatin.denominateur)}) : sans ligne ${X.bilan.matin} → ${X.bilan.maintenant}\n   sortis (une ligne écrite depuis) ${X.sortis.length} · restés ${X.restes} · disparus du catalogue ${X.disparusDuCatalogue}\n   entrés : détachés (phase 2) ${X.entresDetaches} · nouveaux au catalogue ${X.nouveauxAuCatalogue} · AUTRES (à ouvrir) ${X.entresAutres.length} ${JSON.stringify(X.entresAutres.slice(0, 30))}`);
        }
        if (args.includes('--sans-ecrire')) { console.log('\n(--sans-ecrire : rien n\'est écrit)'); return; }
        const s = ecrireSorties({ resultat: R, maintenant, produitsLegers: listeLegere(produits) });
        console.log(`\n✅ écrit : ${s.fichier} · liste des produits ${s.produits} · ligne ajoutée à ${s.historique} · ${R.duree} s`);
    })().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
}
