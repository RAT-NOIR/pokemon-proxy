// ============================================================
// COUVERTURE RÉELLE D'index.js — et le cliquet qui l'empêche de reculer
// ============================================================
// POURQUOI. Le 4 août, 33 des 49 fonctions nommées d'index.js n'étaient exécutées par
// AUCUN test — banc compris. Dont `nomPourLeCatalogue`, qui était le correctif de la
// régression de la veille. Ce chiffre est la vraie mesure de ce qu'on sait, et il ne se
// devine pas : il se lit dans la couverture V8 de Node.
//
// LE CLIQUET, ET SA FORME EXACTE. On ne vise PAS 100 %. On interdit le recul :
// une fonction aujourd'hui exécutée par les tests ne doit pas cesser de l'être.
//
// ⚠️ IL PORTE SUR L'ENSEMBLE DES NOMS, PAS SUR LEUR NOMBRE, et la différence est tout le
// mécanisme. Un cliquet sur le COMPTE se satisfait en supprimant ou en FUSIONNANT du code :
// trois fonctions non couvertes réunies en une seule font baisser le compte sans qu'une
// ligne de plus soit testée. Il punirait aussi un bon refactor qui scinde une fonction non
// couverte en trois. Sur l'ensemble des NOMS, les deux problèmes disparaissent : seul
// compte le fait qu'un nom DÉJÀ couvert cesse de l'être, ce qui est toujours une régression.
// Les nouveaux noms non couverts sont signalés, jamais fatals — sinon écrire une fonction
// deviendrait plus coûteux que ne pas l'écrire.
//
// ⚠️ CE QUE LE CLIQUET NE MESURE PAS, et qu'il ne faut pas lui faire dire :
//   1. « exécutée » n'est pas « vérifiée ». Une fonction traversée sans qu'on regarde son
//      résultat compte comme couverte. C'est EXACTEMENT l'erreur des 52 assertions de la
//      table close, vertes sur un appel qui n'existait pas en production. Le cliquet
//      mesure la PORTÉE, jamais le jugement.
//   2. V8 ne rapporte que les fonctions qu'il a instanciées pendant la mesure. Le
//      dénominateur bouge donc d'une exécution à l'autre — raison de plus pour comparer
//      des noms et non des totaux.
//   3. Si une suite échoue à s'exécuter, sa couverture disparaît et le cliquet reculerait
//      pour une mauvaise raison. D'où l'arrêt immédiat sur une suite en échec.
//
// USAGE :
//   node couverture-index.js                 mesure complète (banc inclus), rapport lisible
//   node couverture-index.js --cliquet       suites HORS LIGNE seules, échoue si ça recule
//   node couverture-index.js --poser-plancher  (re)pose la référence du cliquet

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLANCHER = path.join(__dirname, 'verrou', 'couverture-plancher.json');

// ⚠️ LE CLIQUET N'UTILISE QUE LES SUITES HORS LIGNE. Le banc lit la base de PRODUCTION :
// en faire dépendre une barrière avant push rendrait le push impossible dès que le réseau
// tousse, et ferait porter à la barrière la disponibilité d'un service tiers.
const SUITES_HORS_LIGNE = ['smoke-test.js', 'scoring.js', 'test-setcode-numero.js',
    'test-table-vintage.js', 'test-pokedex.js', 'test-acces.js', 'test-journal-echecs.js',
    'test-symbole-departage.js'];
// Le banc est inclus dans la mesure COMPLÈTE : c'est lui qui affichait vert pendant que la
// production était morte, et la question « que couvre l'instrument » n'a de sens que s'il
// est dedans.
const SUITES_TOUTES = [...SUITES_HORS_LIGNE, 'banc-japonais.js'];

const cliquet = process.argv.includes('--cliquet');
const poser = process.argv.includes('--poser-plancher');
// Le plancher se pose sur les MÊMES suites que celles que le cliquet rejouera — sans quoi
// il serait posé trop haut et reculerait dès la première exécution.
const suites = (cliquet || poser) ? SUITES_HORS_LIGNE : SUITES_TOUTES;

function mesurer(listeSuites, bavard) {
    const dossier = path.join(os.tmpdir(), 'couv-' + Date.now());
    fs.mkdirSync(dossier, { recursive: true });
    for (const s of listeSuites) {
        if (bavard) process.stdout.write(`  ${s} ... `);
        try {
            execFileSync(process.execPath, [s], {
                cwd: __dirname, stdio: 'pipe', timeout: 300000,
                env: { ...process.env, NODE_V8_COVERAGE: dossier }
            });
            if (bavard) console.log('ok');
        } catch (e) {
            // Une suite qui échoue fausse la mesure : on s'arrête au lieu de rapporter
            // une couverture amputée que le cliquet prendrait pour une régression.
            console.log(`\n❌ ${s} a échoué (code ${e.status ?? '?'}) — mesure abandonnée.`);
            console.log('   Répare la suite avant de mesurer la couverture.');
            process.exit(2);
        }
    }

    const compteur = new Map();
    for (const f of fs.readdirSync(dossier)) {
        if (!f.endsWith('.json')) continue;
        let data;
        try { data = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')); } catch (_) { continue; }
        for (const script of data.result || []) {
            // ⚠️ LE FILTRE DOIT ÊTRE EXACT. `endsWith('index.js')` ramasse les centaines
            // d'index.js de node_modules (mongoose, express, stripe) : la première mesure
            // annonçait 688 fonctions et 82 % non couvertes, chiffres dénués de sens.
            const u = String(script.url);
            if (u.includes('node_modules')) continue;
            if (!u.endsWith('/index.js') && !u.endsWith('\\index.js')) continue;
            for (const fn of script.functions || []) {
                const nom = fn.functionName;
                if (!nom || !fn.ranges?.length) continue;
                compteur.set(nom, Math.max(compteur.get(nom) ?? 0, fn.ranges[0].count));
            }
        }
    }
    fs.rmSync(dossier, { recursive: true, force: true });
    return compteur;
}

const compteur = mesurer(suites, !cliquet);
const couvertes = [...compteur.entries()].filter(([, c]) => c > 0).map(([n]) => n).sort();
const jamais = [...compteur.entries()].filter(([, c]) => c === 0).map(([n]) => n).sort();

if (poser) {
    fs.writeFileSync(PLANCHER, JSON.stringify({
        poseLe: new Date().toISOString(),
        suites: SUITES_HORS_LIGNE,
        // On enregistre les COUVERTES : c'est sur elles que porte l'interdiction de recul.
        couvertes
    }, null, 2), 'utf8');
    console.log(`\n📝 plancher posé : ${PLANCHER} — ${couvertes.length} fonction(s) couverte(s), ${jamais.length} non couverte(s)`);
    process.exit(0);
}

if (cliquet) {
    if (!fs.existsSync(PLANCHER)) {
        console.log(`  ⚠️ aucun plancher — pose-le : node couverture-index.js --poser-plancher`);
        process.exit(0);
    }
    const plancher = JSON.parse(fs.readFileSync(PLANCHER, 'utf8'));
    const ensemble = new Set(couvertes);
    const perdues = plancher.couvertes.filter(n => !ensemble.has(n));
    const gagnees = couvertes.filter(n => !plancher.couvertes.includes(n));

    console.log(`  couvertes ${couvertes.length} · jamais exécutées ${jamais.length}  (plancher : ${plancher.couvertes.length} couvertes)`);
    if (gagnees.length) console.log(`  ✅ ${gagnees.length} nouvelle(s) fonction(s) couverte(s) : ${gagnees.join(', ')}`);
    if (perdues.length) {
        console.log(`  ❌ ${perdues.length} fonction(s) NE SONT PLUS couvertes :`);
        for (const n of perdues) console.log(`       ${n}`);
        console.log(`  Si la perte est volontaire (fonction supprimée ou renommée), repose le plancher :`);
        console.log(`     node couverture-index.js --poser-plancher`);
        process.exit(1);
    }
    console.log('  ✅ le cliquet tient');
    process.exit(0);
}

console.log(`\n═══ COUVERTURE D'index.js ═══`);
console.log(`${compteur.size} fonctions nommées observées`);
console.log(`   exécutées au moins une fois : ${couvertes.length}`);
console.log(`   JAMAIS exécutées            : ${jamais.length}  (${(100 * jamais.length / compteur.size).toFixed(0)} %)`);
console.log(`\nles jamais exécutées :`);
for (const n of jamais) console.log(`   ${n}`);
