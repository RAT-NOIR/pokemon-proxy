'use strict';
// ============================================================
// L'EFFET D'UN LOT SUR LES COMPTEURS A, B, C — SIMULÉ, LECTURE SEULE (PHASE 3a-SUITE)
// ============================================================
//   node audit-catalogue/simuler-abc.js --nom=<lot> --plans=<a>.json[,<b>.json] [--sortie=<dossier>]
// Un lot est jugé sur ce qu'il fait aux TROIS compteurs, pas seulement au nombre de lignes : A (produits sans ligne), B (fiches douteuses servies), C (visuels). Les plans sont les fichiers que les outils
// de pose écrivent avec `--plan=` ; ils sont appliqués EN MÉMOIRE à l'état lu (collecte-cartes/appliquer-plan.js), puis la MESURE DES COMPTEURS (compteurs-abc.js::mesurer) est rejouée — la même
// fonction sur un autre état, jamais une seconde définition. Elle nomme les EFFETS DE BORD : un produit hors plan dont une classe bouge (un set qui reçoit sa première fiche numérotée fait passer ses fiches
// sans numéro en « douteuses » : B monte sans qu'aucune fiche ait été dégradée).
// Rien n'est écrit en base : deux connexions de LECTURE (MONGODB_LECTURE_URI, MONGODB_CARTES_LECTURE_URI). Sortie : S8\PHASE3A-SUITE seulement (garde-ecriture.js::autoriser).
const fs = require('fs');
const path = require('path');
const { autoriser } = require('../collecte-cartes/garde-ecriture');
const { appliquerPlans } = require('../collecte-cartes/appliquer-plan');
const { chargerApi } = require('./etat-api');
const { mesurer, comparerEtats, refusDuLot, CLES_RESUME } = require('./compteurs-abc');

const RACINE_SORTIES = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\PHASE3A-SUITE';
const AUTORISES = [/^--nom=[\w-]+$/, /^--plans=.+\.json(,.+\.json)*$/, /^--sortie=.+$/];
const signe = n => (n > 0 ? `+${n}` : String(n));

(async () => {
    const args = process.argv.slice(2);
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) throw new Error(`argument inconnu : ${inconnus.join(' ')}`);
    const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
    const NOM = arg('nom'), PLANS = (arg('plans') || '').split(',').filter(Boolean), SORTIE = arg('sortie') || RACINE_SORTIES;
    if (!NOM || !PLANS.length) throw new Error('--nom et --plans obligatoires');
    const plans = PLANS.map(f => ({ f, ...JSON.parse(fs.readFileSync(f, 'utf8')) }));
    for (const p of plans) if (!Array.isArray(p.lignes) || !p.lignes.length) throw new Error(`plan vide ou illisible : ${p.f} — une simulation sur du vide ne mesure rien`);
    const api = await chargerApi();
    console.log('── ÉTAT ACTUEL');
    const avant = await mesurer({ api, avecTemoin: false });
    let appliquees = null;
    console.log('── ÉTAT APRÈS LE LOT (plans appliqués en mémoire)');
    const apres = await mesurer({ api, avecTemoin: false, injecter: etat => {
        const r = appliquerPlans(etat, plans);
        if (r.carteAbsente) throw new Error(`${r.carteAbsente} ligne(s) du plan visent une carte absente de la base : le plan ne correspond pas à l'état lu`);
        appliquees = r;
        return { cartes: r.cartes, cartesProduits: r.cartesProduits };
    } });
    const idsDuPlan = new Set(appliquees.ajoutees.map(l => l.idProduct));
    const CE = comparerEtats({ avant: avant.produits, apres: apres.produits, idsDuPlan });
    const ecart = {}; for (const k of CLES_RESUME) ecart[k] = apres.R.resume[k] - avant.R.resume[k];
    const parMotif = {}; for (const e of CE.effetsDeBord) { const k = `${e.fiche ?? '—'} | ${e.visuel ?? '—'} | ${e.motifsFiche.join('+') || '—'}`; parMotif[k] = (parMotif[k] || 0) + 1; }
    const sortie = { nom: NOM, le: new Date().toISOString(), plans: plans.map(p => path.basename(p.f)), lignesAjoutees: appliquees.ajoutees.length, lignesDejaLa: appliquees.dejaLa.length, produitsDuPlan: idsDuPlan.size, avant: avant.R.resume, apres: apres.R.resume, ecart, duPlan: CE.duPlan, effetsDeBord: CE.effetsDeBord, effetsDeBordParTransition: parMotif,
        C: { avant: { emprunte: avant.R.C.empruntesAvecMention, aucunVisuelAvecLigne: avant.R.C.aucunVisuelAvecLigne }, apres: { emprunte: apres.R.C.empruntesAvecMention, aucunVisuelAvecLigne: apres.R.C.aucunVisuelAvecLigne } } };
    console.log(`\n══ LOT « ${NOM} » : ${appliquees.ajoutees.length} lignes ajoutées (${appliquees.dejaLa.length} déjà là) · ${idsDuPlan.size} produits du plan · dénominateur ${avant.R.denominateur.produits} = ${apres.R.denominateur.produits}`);
    console.log(`   A  sans ligne ${avant.R.resume.sansLigne} → ${apres.R.resume.sansLigne} (${signe(ecart.sansLigne)}) · ligne sans fiche ${avant.R.resume.ligneSansFiche} → ${apres.R.resume.ligneSansFiche} (${signe(ecart.ligneSansFiche)})`);
    console.log(`   B  fiches douteuses ${avant.R.resume.douteuses} → ${apres.R.resume.douteuses} (${signe(ecart.douteuses)})`);
    console.log(`   C  vrai scan ${avant.R.resume.vraiScan} → ${apres.R.resume.vraiScan} (${signe(ecart.vraiScan)}) · emprunté ${avant.R.resume.emprunte} → ${apres.R.resume.emprunte} (${signe(ecart.emprunte)}) · basse déf. ${avant.R.resume.basseDefinition} → ${apres.R.resume.basseDefinition} (${signe(ecart.basseDefinition)}) · aucun visuel ${avant.R.resume.aucunVisuel} → ${apres.R.resume.aucunVisuel} (${signe(ecart.aucunVisuel)})`);
    console.log(`   produits DU PLAN, fiche : ${JSON.stringify(CE.duPlan.fiche)}\n   produits DU PLAN, visuel : ${JSON.stringify(CE.duPlan.visuel)}`);
    console.log(`   EFFETS DE BORD (produits hors plan dont une classe bouge) : ${CE.effetsDeBord.length}${CE.effetsDeBord.length ? ' · ' + JSON.stringify(parMotif) + ' · ex. ' + CE.effetsDeBord.slice(0, 8).map(e => e.idProduct).join(', ') : ''}`);
    // un lot qui rendrait FAUSSE une fiche existante est REFUSÉ (code 3) : la liste des fautifs est écrite, le lot ne part pas
    const refus = refusDuLot(CE.effetsDeBord);
    sortie.refusDuLot = refus;
    if (refus.length) { console.log(`\n🔴 LOT REFUSÉ : ${refus.length} produit(s) hors plan dont la fiche deviendrait fausse ou disparaîtrait : ${refus.slice(0, 20).join(', ')}`); process.exitCode = 3; }
    else console.log('\n   aucun produit hors plan ne perd sa fiche ni n\'est contredit par le témoin du nom');
    fs.mkdirSync(SORTIE, { recursive: true });
    const f = autoriser(path.join(SORTIE, `abc-simule-${NOM}.json`), [RACINE_SORTIES]);
    fs.writeFileSync(f, JSON.stringify(sortie, null, 1));
    console.log(`\n✅ écrit : ${f}`);
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
