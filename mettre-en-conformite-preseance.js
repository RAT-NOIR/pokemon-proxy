// ============================================================
// MISE EN CONFORMITÉ — les doublons EXISTANTS de la préséance de résolution (décision 4 du testeur, 2026-10-13)
// ============================================================
//   node mettre-en-conformite-preseance.js [--attendu=<N>]                                  SIMULATION (le défaut) : rien n'est écrit, lecture seule
//   node lot-additif.js --quoi="…" --collections=cartes,images --annonce=<annonce.json> -- node mettre-en-conformite-preseance.js --attendu=<N> --ecrire
//
// La règle est UNE seule fois (collecte-cartes/preseance-images.js) : cet outil la lit, il n'en copie rien. Pour chaque carte à deux entrées ou plus, la
// perdante de chaque (set, numéro, langue) est retirée de `cartes.images`, et son document `images` passe à l'état « retire » (motif « préséance de
// résolution ») pour que ni rejeu ni recollecte ne la reprenne — par retirer-visuels.js, qui fait déjà exactement cela : UNE implémentation du retrait
// (§21 bis), appelée avec les clés R2 du plan. Aucun fichier R2 n'est effacé.
//
// 🔑 LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : `--attendu=<N>` est le compte que le coordinateur a mesuré ; si le plan en trouve un autre, RIEN n'est écrit (code 1).
// `--ecrire` sans `--attendu` est refusé avant toute connexion. L'ANNONCE de la garde de lot est calculée par garde-lot.js (la même fonction que lot-additif.js) :
// images du set, avant → après ; elle est validée avant d'être imprimée.
const { compterEtat, comparer, validerAnnonces } = require('./collecte-cartes/garde-lot');
const preseance = require('./collecte-cartes/preseance-images');

const MOTIF = preseance.MOTIF;
const MOTIF_RETRAIT = `${MOTIF} (décision 4 du testeur, 2026-10-13 : la plus grande résolution ; à égalité, TCGdex)`;

/** Le plan, pur : `cartes` = des documents { _id, nomEn, sets, images }. */
function planifier(cartes) {
    const retraits = [];
    for (const c of cartes || []) for (const x of preseance.perdantesDeLaCarte(c.images)) {
        retraits.push({ carteId: c._id, nom: c.nomEn ?? null, set: x.perdante.set, numero: x.perdante.numero, perdante: x.perdante, gagnante: x.gagnante, motif: x.motif });
    }
    const cles = retraits.map(r => r.perdante.cleR2);
    const annonce = annonceDe(cartes, retraits);
    const plan = { retraits, cles, annonce };
    plan.garde = verifierAnnonce(cartes, plan, annonce);
    return plan;
}

/** Les cartes APRÈS le plan : les entrées perdantes en moins. */
function cartesApres(cartes, retraits) {
    const sorties = new Set(retraits.map(r => `${r.carteId}|${r.perdante.cleR2}`));
    return (cartes || []).map(c => ({ ...c, images: (c.images || []).filter(e => !sorties.has(`${c._id}|${e?.cleR2}`)) }));
}

/** L'annonce de la garde de lot : chaque compteur d'images qui BAISSE, par set — calculée par garde-lot.js (même fonction qu'à l'exécution). */
function annonceDe(cartes, retraits) {
    const avant = compterEtat({ cartes }), apres = compterEtat({ cartes: cartesApres(cartes, retraits) });
    const annonce = {};
    for (const [cle, n] of avant) if (cle.startsWith('images ')) { const m = apres.get(cle) || 0; if (m < n) annonce[cle] = n - m; }
    if (Object.keys(annonce).length) validerAnnonces(annonce);
    return annonce;
}

/** La garde de lot rejouée sur le plan : `annonces` couvre-t-il toute la baisse ? @returns {ReturnType<typeof comparer>} */
function verifierAnnonce(cartes, plan, annonces) {
    return comparer(compterEtat({ cartes }), compterEtat({ cartes: cartesApres(cartes, plan.retraits) }), { annonces });
}

/** Le compte annoncé par le coordinateur contre celui du plan. */
function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu) || attendu < 0) return { ok: false, raison: `--attendu absent ou invalide (« ${attendu} ») : le compte mesuré doit être donné` };
    const n = plan.retraits.length;
    return n === attendu ? { ok: true, raison: `${n} retrait(s), comme attendu` } : { ok: false, raison: `le plan trouve ${n} retrait(s), le coordinateur en attend ${attendu} : rien n'est écrit` };
}

module.exports = { MOTIF, MOTIF_RETRAIT, planifier, cartesApres, annonceDe, verifierAnnonce, verifierAttendu };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

// La ligne de commande s'écrit par ce qu'elle AUTORISE : un argument inconnu refuse avant toute connexion ; `--ecrire` exige `--attendu=`.
const AUTORISES = [/^--attendu=\d+$/, /^--ecrire$/, /^--lecture-via-ecriture$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const ATTENDU = args.find(a => a.startsWith('--attendu=')) ? Number(args.find(a => a.startsWith('--attendu=')).slice(10)) : undefined;
if (inconnus.length || (args.includes('--ecrire') && ATTENDU === undefined)) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}autorisés : [--attendu=<N>] [--ecrire (exige --attendu)] [--lecture-via-ecriture]. Sans --ecrire : simulation.`);
    process.exit(2);
}
require('dotenv').config();
(async () => {
    const ECRIRE = args.includes('--ecrire');
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = ECRIRE ? await ouvrirConnexions({ production: false, buckets: [] })
        : await require('./collecte-cartes/ouvrir-lecture').ouvrirSimulation({ viaEcriture: args.includes('--lecture-via-ecriture'), ouvrirConnexions });
    try {
        const cartes = await cx.cartes.db.collection('cartes').find({ 'images.1': { $exists: true } }, { projection: { nomEn: 1, sets: 1, images: 1 } }).toArray();
        const plan = planifier(cartes);
        console.log(`DÉNOMINATEUR : ${cartes.length} cartes à deux entrées images ou plus ; ${plan.retraits.length} entrée(s) perdante(s) par la préséance de résolution`);
        for (const r of plan.retraits) console.log(`   ${r.set} #${r.numero} ${r.nom} (${r.carteId}) : retire ${r.perdante.source} ${r.perdante.w}×${r.perdante.h} (${r.perdante.cleR2}) — garde ${r.gagnante.source} ${r.gagnante.w}×${r.gagnante.h}`);
        console.log(`ANNONCE (pour lot-additif --annonce) : ${JSON.stringify(plan.annonce)}`);
        console.log(`GARDE rejouée sur le plan : ${plan.garde.nonAutorisees.length} baisse(s) non autorisée(s), ${plan.garde.annoncesNonRealisees.length} annonce(s) non réalisée(s)`);
        if (plan.garde.nonAutorisees.length || plan.garde.annoncesNonRealisees.length) { console.error('❌ l\'annonce calculée ne couvre pas exactement la baisse : rien n\'est écrit'); process.exitCode = 1; return; }
        if (ATTENDU !== undefined) {
            const a = verifierAttendu(plan, ATTENDU);
            console.log(`${a.ok ? '✅' : '❌'} ${a.raison}`);
            if (!a.ok) { process.exitCode = 1; return; }
        }
        if (!ECRIRE) { console.log('(simulation seule — --ecrire sous lot-additif.js, avec --attendu)'); return; }
        if (!plan.cles.length) { console.log('rien à retirer'); return; }
        // l'écriture : retirer-visuels.js (UNE implémentation du retrait), mêmes clés, même motif — il refuse si une clé n'est pas portée par exactement une entrée et un document
        const { spawnSync } = require('child_process');
        const r = spawnSync(process.execPath, [require('path').join(__dirname, 'retirer-visuels.js'), `--cles=${plan.cles.join(',')}`, `--motif=${MOTIF_RETRAIT}`, '--ecrire'], { stdio: 'inherit' });
        process.exitCode = r.status ?? 1;
    } finally { await cx.fermer(); }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
