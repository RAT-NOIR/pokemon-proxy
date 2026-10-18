'use strict';
// LOT TEMPS-CHAINE — la décomposition du journal (rm_essai.journal_scans, LECTURE SEULE) et le p95 PROJETÉ avec les changements retenus.
//   node v2/mesures/projeter-p95.js --env=<.env d'api-v2> [--gain-ia=<ms>] [--cat-apres=<ms>]
// Un chiffre PROJETÉ n'est pas un chiffre mesuré : chaque règle de projection est imprimée avec ce qu'elle suppose. Le journal ne porte que msIA + msCatalogue + imageMs (le gestionnaire hérité) :
// la part de la route v2 AVANT et APRÈS ce gestionnaire (débit, marque, catalogue v2, journal analyses) n'y est pas ; elle est dite « non mesurée », jamais comptée zéro en silence.
const fs = require('fs');
const path = require('path');
const arg = (nom, d) => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : d; };
const pct = (v, p) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]) : null; };

function chargerUri(fichier, nom) {
    for (const l of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) { const m = l.match(new RegExp(`^\\s*${nom}\\s*=\\s*(.*)\\s*$`)); if (m) return m[1].replace(/^["']|["']$/g, ''); }
    return null;
}
/** Les règles de projection (pures, testées) : chaque ligne du journal -> sa chaîne projetée. */
function projeter(ligne, { gainIaMs = 0, catApresMs = null, seuilCatMs = 8000 } = {}) {
    let ia = ligne.msIA, cat = ligne.msCatalogue, img = ligne.imageMs;
    // R1 — le pré-filtre du numéro : un scan qui a passé plus de 8 s dans le catalogue les a passés dans la lecture complète de numeros_cartes ; il retombe à la valeur typique
    if (cat >= seuilCatMs && catApresMs !== null) cat = catApresMs;
    // R2 — l'image non calculée quand le symbole ou l'attaque a décidé
    if (/^abstention-(symbole|attaque)-prioritaire$/.test(ligne.imageStatut || '')) img = 0;
    // R3 — un gain de l'appel au modèle (mesuré ailleurs), jamais en dessous de 1 s, et pas sur un incident de fournisseur (> 8 s : hors de portée)
    if (gainIaMs > 0 && ia <= 8000) ia = Math.max(1000, ia - gainIaMs);
    return { ia, cat, img, total: ia + cat + img };
}
module.exports = { projeter, pct };

async function principal() {
    const uri = chargerUri(arg('env', 'C:/Users/Yung/Desktop/pokemon-proxy-api-v2/.env'), 'MONGODB_ESSAI_LECTURE_URI');
    if (!uri) throw new Error('MONGODB_ESSAI_LECTURE_URI absente');
    const { MongoClient } = require(path.join(__dirname, '..', '..', 'node_modules', 'mongodb'));
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
    await c.connect();
    const lignes = (await c.db('rm_essai').collection('journal_scans').find({}, { projection: { msIA: 1, msCatalogue: 1, imageMs: 1, nbPhotos: 1, imageStatut: 1, voieCatalogue: 1 } }).toArray())
        .filter(l => [l.msIA, l.msCatalogue, l.imageMs].every(Number.isFinite));
    await c.close();
    const gain = Number(arg('gain-ia', '0')), catApres = arg('cat-apres', null) === null ? null : Number(arg('cat-apres'));
    const typ = pct(lignes.filter(l => l.msCatalogue < 8000).map(l => l.msCatalogue), .5);
    console.log(`journal_scans : ${lignes.length} lignes portant les trois durées (dénominateur) · catalogue typique (médiane hors > 8 s) ${typ} ms`);
    const avant = lignes.map(l => ({ ...l, ...{ total: l.msIA + l.msCatalogue + l.imageMs } }));
    const apres = lignes.map(l => ({ ...l, ...projeter(l, { gainIaMs: gain, catApresMs: catApres })}));
    const decrire = (nom, tab, fn = () => true) => {
        const x = tab.filter(fn).map(l => l.total);
        console.log(`  ${nom.padEnd(26)} n=${String(x.length).padStart(3)} · p50 ${pct(x, .5)} · p90 ${pct(x, .9)} · p95 ${pct(x, .95)} · max ${Math.max(...x)} · > 5 s : ${x.filter(t => t > 5000).length} (${(100 * x.filter(t => t > 5000).length / x.length).toFixed(1)} %)`);
    };
    console.log('\nAVANT (mesuré) :'); decrire('toutes les lignes', avant); decrire('1 photo', avant, l => l.nbPhotos === 1); decrire('2 photos', avant, l => l.nbPhotos === 2); decrire('3 photos ou plus', avant, l => l.nbPhotos >= 3);
    console.log(`\nAPRÈS (PROJETÉ : R1 catalogue > 8 s -> ${catApres === null ? 'inchangé' : catApres + ' ms'} · R2 image prioritaire -> 0 · R3 gain d'appel -${gain} ms hors incidents) :`);
    decrire('toutes les lignes', apres); decrire('1 photo', apres, l => l.nbPhotos === 1); decrire('2 photos', apres, l => l.nbPhotos === 2); decrire('3 photos ou plus', apres, l => l.nbPhotos >= 3);
    const reste = apres.filter(l => l.total > 5000).sort((a, b) => b.total - a.total);
    console.log(`\nce qui reste au-dessus de 5 s après projection : ${reste.length} lignes ; dont incident de fournisseur (appel > 8 s) : ${reste.filter(l => l.ia > 8000).length} ; catalogue > 2 s : ${reste.filter(l => l.cat > 2000).length} ; image > 2 s : ${reste.filter(l => l.img > 2000).length}`);
    console.log('NON MESURÉ dans le journal : la part de la route v2 avant et après le gestionnaire hérité (débit, marque de livraison, catalogue v2, solde, offre, écriture de l\'analyse).');
}
if (require.main === module) principal().catch(e => { console.error('❌', e.message); process.exit(1); });
