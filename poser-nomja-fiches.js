// ============================================================
// nomJa DES FICHES (cartes à _id négatif surtout) — liste FERMÉE, décision datée du testeur, ancienne valeur journalisée
// ============================================================
//   node poser-nomja-fiches.js --decision=2026-11-02 [--sortie=<dossier>]                                   (SIMULATION : lecture seule, écrit un plan lisible)
//   node lot-additif.js --quoi="nomJa de N fiches (decision 2026-11-02)" --collections=cartes -- node poser-nomja-fiches.js --decision=2026-11-02 --ecrire --attendu=<N>
//
// DÉCISION 2026-11-02 (testeur) : « nomJa (null → nom) : FEU VERT pour les noms avec preuve, anciennes valeurs journalisées ».
// La preuve de chaque entrée est la PAGE DU TIRAGE (nom japonais de la page source = scan lu sur planche) ; `concordeAvecAutreCarte` (le nomJa d'une
// autre carte de même nomEn est identique) n'est PAS exigé : il est compté et imprimé, pour information.
// Écrit le SEUL champ `nomJa`, sur une carte où il est ABSENT ou null. Une valeur existante (même identique) est un refus nommé.
// Lectures : lecteur de l'audit (audit-catalogue/lecture-audit.js, utilisateurs de lecture). Écriture : connexion `cartes` de collecte-cartes/garde.js,
// seulement SOUS lot-additif.js (garderSousLot). Le journal des anciennes valeurs est écrit AVANT l'écriture, à côté du plan.
const fs = require('fs');
const path = require('path');

const DOSSIER_PROPOSITIONS = 'C:/Users/Yung/rat-market-travail/catalogue/chasse/d-0211';
// Une liste fermée par décision : le fichier de propositions que la décision a visé.
const DECISIONS = { '2026-11-02': path.join(DOSSIER_PROPOSITIONS, 'nomja-a-poser.json') };

const AUTORISES = [/^--ecrire$/, /^--decision=\d{4}-\d{2}-\d{2}$/, /^--sortie=.+/, /^--attendu=\d+$/, /^--propositions=.+\.json$/];
const args = process.argv.slice(2);
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const ecrire = args.includes('--ecrire');
const DECISION = val('decision');
const attendu = val('attendu') !== undefined ? Number(val('attendu')) : null;
// La ligne de commande est une garde : tout argument inconnu refuse AVANT toute connexion.
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
if (!DECISION || !DECISIONS[DECISION]) { console.error(`❌ --decision=<${Object.keys(DECISIONS).join('|')}> obligatoire (décision inconnue : ${DECISION ?? '—'})`); process.exit(2); }
if (val('propositions') && ecrire) { console.error('❌ --propositions= ne vaut qu\'en simulation : l\'écriture n\'applique QUE la liste fermée de la décision'); process.exit(2); }
if (ecrire) {
    try { require('./collecte-cartes/phase2-visuels').garderSousLot(process.env, process.ppid, `node lot-additif.js --quoi="nomJa de N fiches (decision ${DECISION})" --collections=cartes -- node poser-nomja-fiches.js --decision=${DECISION} --ecrire --attendu=<N>`); }
    catch (e) { console.error(`❌ ${e.message}`); process.exit(2); }
    if (attendu === null) { console.error('❌ --ecrire exige --attendu=<N> (le compte de la simulation) : refus. Rien n\'a été écrit.'); process.exit(2); }
}
if (!ecrire && attendu !== null) { console.error('❌ --attendu ne vaut qu\'avec --ecrire.'); process.exit(2); }
const SORTIE = path.resolve(val('sortie') || path.join(DOSSIER_PROPOSITIONS, 'nomja-fiches'));
const masquer = e => String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');

(async () => {
    const { planifier, construireOps } = require('./collecte-cartes/plan-nomja-fiches');
    const fichier = val('propositions') || DECISIONS[DECISION];
    const entrees = JSON.parse(fs.readFileSync(fichier, 'utf8')).entrees;
    if (!Array.isArray(entrees) || !entrees.length) throw new Error(`aucune entrée dans ${fichier} : rien ne se mesure (§41)`);

    const { ouvrirLecture } = require('./audit-catalogue/lecture-audit');
    const b = await ouvrirLecture();
    let cartes;
    try {
        cartes = await b.cartes.collection('cartes').find({ _id: { $in: [...new Set(entrees.map(x => x.carteId))] } }, { projection: { nomEn: 1, nomJa: 1 } }).toArray();
    } finally { await b.fermer(); }

    const plan = planifier({ entrees, cartes });
    const parMotif = {}; for (const r of plan.refus) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    console.log(`\n════ DÉNOMINATEUR : ${entrees.length} propositions (${fichier}) · ${cartes.length} cartes trouvées en base ════`);
    console.log(`   ✅ posables : ${plan.ecrire.length}  (nomJa absent ${plan.ecrire.filter(x => x.ancienEtat === 'absent').length} · null ${plan.ecrire.filter(x => x.ancienEtat === 'null').length})`);
    console.log(`      dont concordant avec le nomJa d'une autre carte de même nomEn : ${plan.concorde.avecAutreCarte} · sans autre carte pour concorder : ${plan.concorde.sansAutreCarte} (non exigé, la preuve est la page du tirage)`);
    console.log(`   ⚪ refusées : ${plan.refus.length}${Object.keys(parMotif).length ? '  —  ' + Object.entries(parMotif).map(([k, v]) => `${k} ${v}`).join(' · ') : ''}`);
    for (const r of plan.refus.slice(0, 20)) console.log(`      refus ${r.motif} : carte ${r.carteId} « ${r.nomEn} » → « ${r.nomJaPage} »`);
    for (const x of plan.ecrire.slice(0, 10)) console.log(`      exemple : carte ${x.carteId} « ${x.nomEn} » (${x.pcg}) : ${x.ancienEtat} → « ${x.nomJa} »`);

    fs.mkdirSync(SORTIE, { recursive: true });
    const le = new Date();
    const contenu = { le: le.toISOString(), decision: DECISION, fichier, comptes: { propositions: entrees.length, posables: plan.ecrire.length, refusees: plan.refus.length, parMotif }, concorde: plan.concorde, ecrire: plan.ecrire, refus: plan.refus };
    if (!ecrire) {
        fs.writeFileSync(path.join(SORTIE, `PLAN-SIMULATION-${DECISION}.json`), JSON.stringify(contenu, null, 1), 'utf8');
        console.log(`\n   plan écrit : ${path.join(SORTIE, `PLAN-SIMULATION-${DECISION}.json`)}\n   (simulation — rien n'est écrit en base) — pour écrire : lot-additif.js … -- node poser-nomja-fiches.js --decision=${DECISION} --ecrire --attendu=${plan.ecrire.length}`);
        return;
    }

    // ---------- ÉCRITURE (sous lot-additif.js) ----------
    if (plan.refus.length) { console.error(`❌ ${plan.refus.length} refus au plan : la liste fermée doit passer entière (rien n'est écrit). Relancer la simulation.`); process.exitCode = 3; return; }
    if (attendu !== plan.ecrire.length) { console.error(`❌ comptes différents de la simulation (attendu ${attendu} ; recalculé ${plan.ecrire.length}) : la base a bougé. Rien n'a été écrit.`); process.exitCode = 3; return; }
    const fJournal = path.join(SORTIE, `JOURNAL-${DECISION}-${le.toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
    fs.writeFileSync(fJournal, JSON.stringify({ le: le.toISOString(), decision: DECISION, retour: 'pour revenir en arrière : updateOne({_id}, {$unset: {nomJa: ""}}) si ancienEtat "absent", {$set: {nomJa: null}} si "null"',
        entrees: plan.ecrire.map(x => ({ _id: x.carteId, ancien: x.ancien, ancienEtat: x.ancienEtat, nouveau: x.nomJa, nomEn: x.nomEn, pcg: x.pcg })) }, null, 1), 'utf8');
    console.log(`\n   journal des anciennes valeurs : ${fJournal} (${plan.ecrire.length} entrées)`);

    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false });
    try {
        const ops = construireOps({ ecrire: plan.ecrire });
        let m = 0;
        for (let i = 0; i < ops.length; i += 500) m += (await cx.db.collection('cartes').bulkWrite(ops.slice(i, i + 500), { ordered: false })).modifiedCount;
        console.log(`   ÉCRIT : ${m}/${ops.length}`);
        if (m !== ops.length) { console.error('🔴 un écart entre le plan et ce qui a été modifié : la garde de lot et la relecture tranchent.'); process.exitCode = 4; }
    } finally { await fermer(); }
})().catch(e => { console.error('❌', masquer(e)); process.exit(1); });
