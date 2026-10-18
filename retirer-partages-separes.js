// ============================================================
// PARTAGES-SEPARES — retirer `produitsPartages` des paires Staff / Jumbo séparées par la variante (testeur, 2026-10-18)
// ============================================================
//   node retirer-partages-separes.js                                  (ESSAI À BLANC : le plan, les entrées laissées avec leur raison, l'annonce de lot ; n'écrit rien)
//   node lot-additif.js --quoi="PARTAGES-SEPARES : produitsPartages retiré des 61 paires Staff/Jumbo séparées" --collections=cartes,images -- node retirer-partages-separes.js --ecrire --attendu=61 --sauvegarde=<f>.json
//   node lot-additif.js --quoi="PARTAGES-SEPARES : RESTAURATION" --collections=cartes,images -- node retirer-partages-separes.js --restaurer=<f>.json --ecrire --attendu=61
// Le geste, la garde et le retour en arrière sont dans collecte-cartes/partages-separes.js. JAMAIS de requête réseau. Collections écrites : `cartes`, `images`.
const S = require('./collecte-cartes/partages-separes');

const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--sauvegarde=.+\.json$/, /^--restaurer=.+\.json$/, /^--rapport=.+\.json$/];

/** @param {{cartesDb: object, ecrire?: boolean, attendu?: number, sauvegarde?: string, restaurer?: string, log?: Function}} o */
async function executer({ cartesDb, ecrire = false, attendu, sauvegarde, restaurer, log = console.log }) {
    if (restaurer) {
        const r = await S.restaurer(cartesDb, restaurer, { ecrire, attendu });
        log(ecrire ? `↩️  restauré : ${r.entrees} entrée(s), ${r.documents} document(s) · relu : ${r.relu.entrees} entrée(s) et ${r.relu.documents} document(s) portent de nouveau produitsPartages` : `(essai à blanc — rien n'est écrit : ${r.entrees} entrée(s) et ${r.documents} document(s) seraient restaurés)`);
        if (ecrire && (r.relu.entrees !== r.entrees || r.relu.documents !== r.documents)) { process.exitCode = 1; log('🔴 le relu ne correspond pas à la sauvegarde'); }
        return r;
    }
    const plan = await S.construirePlan({ cartesDb });
    const k = plan.comptes;
    log(`\n════ PARTAGES-SEPARES : ${k.entrees} entrées cartes.images + ${k.documents} documents images à dégager de produitsPartages · par type ${JSON.stringify(k.parType)} · laissées ${k.laissees} · Prize Packs ignorés ${k.holoIgnorees} ════`);
    if (k.laissees) { log(`   laissées par motif : ${JSON.stringify(k.parMotif)}`); for (const l of plan.laissees) log(`      ✗ ${l.set} n° ${l.numero} carte ${l.carteId} « ${l.nom} » [${(l.produitsPartages || []).join('+')}] : ${l.motif}`); }
    const a = await S.annonceDePlan(cartesDb, plan);
    log(`   ANNONCE DE LOT (fonction de la garde) : ${Object.keys(a.annonces).length ? JSON.stringify(a.annonces) : 'aucune annonce nécessaire'} · baisses non autorisées simulées : ${a.baissesNonAutorisees}`);
    const r = await S.appliquer(cartesDb, plan, { ecrire, attendu, sauvegarde });
    if (!ecrire) { log(`\n   (essai à blanc — rien n'est écrit : ${r.entrees} entrée(s) et ${r.documents} document(s) le seraient${r.dejaFait ? ' ; RIEN À ÉCRIRE' : ''})`); return { ...r, plan, annonce: a }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire (idempotent)' : `✅ écrit : ${r.entrees} entrée(s), ${r.documents} document(s)`} · relu : ${r.relu.entrees} entrée(s) et ${r.relu.documents} document(s) portent encore produitsPartages (attendu 0/0)`);
    if (r.relu.entrees || r.relu.documents) { process.exitCode = 1; log('🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'); }
    return { ...r, plan, annonce: a };
}

module.exports = { executer };

if (require.main === module) {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=<N>, --sauvegarde=<f>.json, --restaurer=<f>.json`); process.exit(2); }
    const val = n => process.argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = process.argv.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> : rien n\'est écrit'); process.exit(2); }
    if (ecrire && !val('restaurer') && !val('sauvegarde')) { console.error('❌ --ecrire exige --sauvegarde=<f>.json (les valeurs d\'avant) : rien n\'est écrit'); process.exit(2); }
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        try { await executer({ cartesDb: cartes.db, ecrire, attendu, sauvegarde: val('sauvegarde'), restaurer: val('restaurer') }); }
        finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
