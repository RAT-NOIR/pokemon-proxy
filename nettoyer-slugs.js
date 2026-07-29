// ============================================================
// NETTOYAGE DES SLUGS + BACKFILL DU numeroUrl — script autonome
// ============================================================
// LE BUG. scraperListeExpansion (live-cardmarket.js) prenait le dernier segment de
// l'attribut href TEL QUEL, query string comprise :
//     href = ".../Singles/Wind-from-the-Sea/Rotom-mC248?language=2"
//     slug      = "Rotom-mC248?language=2"
//     numeroUrl = premier match de /(\d+)$/  ->  "2"      (au lieu de 248)
// Le numéro de secours capturait donc le "2" de `language`, systématiquement.
//
// MESURÉ EN PRODUCTION (avant écriture) :
//   - 9367 documents de `numeros_cartes` ont un slug contenant "?"
//   - le seul paramètre rencontré est `language` — 9367 fois sur 9367. Aucun cas
//     ambigu : la règle de nettoyage est déterministe, on ne perd rien d'utile.
//   - 2513 d'entre eux n'ont AUCUN `numero` de titre pour contredire ce faux numéro :
//     sur ceux-là, numeroUrl fait autorité dans le scoring (voir index.js,
//     `infoNum.numero || infoNum.numeroUrl`). Ce sont 2513 candidats appariables à
//     n'importe quelle carte n°2.
//
// LE SECOND BUG, DÉCOUVERT EN MESURANT LE PREMIER. Réparer le slug ne suffit pas :
// l'extraction elle-même était fausse. Le slug a la forme `Nom[-Lv12][-V2]-CODEnnn`,
// où le code de set et le numéro sont COLLÉS, et /(\d+)$/ avalait les chiffres du code :
//     "Porygon-Z-sI100340"  code sI100  -> 100340   au lieu de 340
//     "Alakazam-B21"        code B2     ->     21   au lieu de 1
//     "Mewtwo-V-UNION-V3"   code SWSH   ->      3   (marqueur de VARIANTE, pas un numéro)
// Mesuré sur les 6854 documents pollués qui portent AUSSI un numéro lu dans le titre —
// lequel fait foi et sert donc d'arbitre gratuit : l'ancienne règle se trompait sur
// 28,4 % d'entre eux. Appliquer le nettoyage avec cette règle-là aurait remplacé un
// "2" grossièrement faux par un numéro PLAUSIBLE et faux, ce qui est bien pire.
// La règle retenue (scoring.numeroDepuisSlug) tombe à 0,2 %, sans AUCUNE régression.
//
// CE QUE FAIT CE SCRIPT :
//   1. slug      -> tout ce qui précède le "?"
//   2. numeroUrl -> recalculé par scoring.numeroDepuisSlug(slug, codeSet), la MÊME
//                   fonction que celle utilisée à la lecture (live-cardmarket.js).
// Rien d'autre n'est touché : `numero`, `codeSet`, `nomFr`, `variante`, `slugSet`,
// `source` et `certitude` restent tels quels. En particulier on ne "réapprend" rien et
// on ne contacte JAMAIS Cardmarket — aucun navigateur, aucune requête HTTP.
//
// L'ABSTENTION EST UN RÉSULTAT. Quand la règle ne sait pas, elle pose null. Un candidat
// sans numéro connu se classe « inconnu » ; un faux numéro crédible, lui, le fait gagner
// contre la bonne carte.
//
// PORTÉE (--portee=) :
//   pollues  (défaut) : les seuls documents dont le slug contient un "?"
//   tout              : tous les documents à slug, car la mesure montre que 13,5 % des
//                       numeroUrl stockés sur slug PROPRE sont faux eux aussi (6505
//                       documents) — même bug de fusion, sans la query string.
//
// IDEMPOTENT : un second passage ne trouve plus rien à changer, puisque la règle est
// déterministe et que le slug ne contient plus de "?". C'est le contrôle de fin.
//
// USAGE (la base doit être NOMMÉE explicitement, le script refuse de la deviner) :
//   node nettoyer-slugs.js --base=test    (SIMULATION : affiche tout, n'écrit rien)
//   node nettoyer-slugs.js --base=test --portee=tout
//   node nettoyer-slugs.js --base=test --portee=tout --tous-les-desaccords
//   node nettoyer-slugs.js --base=test --ecrire --confirmer-production
//
// Le dry-run affiche, avant toute écriture : le taux d'erreur mesuré sur les témoins
// AVANT et APRÈS, les éventuelles régressions, la taille du groupe écrit À L'AVEUGLE
// (sans numéro de titre pour vérifier) et la liste des désaccords résiduels.
//
// ⚠️ "test" est bien la base de PRODUCTION de ce projet. Le bac à sable est
//    "test_scratch". Voir mongo-connexion.js.
// ⚠️ Fais une sauvegarde AVANT :  node backup-collections.js --base=test

require('dotenv').config();
const mongoose = require('mongoose');
const { connecterMongo } = require('./mongo-connexion');
// ⚠️ MÊME FONCTION QUE LA SOURCE (live-cardmarket.js). Une seule définition, dans le
// module pur et testé : c'est ce qui garantit que les documents corrigés par ce script
// et ceux lus demain par le scraper voudront dire la même chose.
const { numeroDepuisSlug, comparerNumeros } = require('./scoring');

const ECRIRE = process.argv.includes('--ecrire');
const LOT = 1000; // taille des paquets de bulkWrite
const argPortee = process.argv.find(a => a.startsWith('--portee='));
const PORTEE = argPortee ? argPortee.slice('--portee='.length).trim() : 'pollues';
if (!['pollues', 'tout'].includes(PORTEE)) {
    console.error(`❌ --portee=${PORTEE} inconnue. Valeurs acceptées : pollues (défaut) | tout`);
    process.exit(1);
}

const NumeroCarte = mongoose.model('NumeroCarte', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
const CodeSet = mongoose.model('CodeSet', new mongoose.Schema({}, { strict: false }), 'codes_set');

const slugPropre = s => String(s).split('?')[0];
const aNumeroDeTitre = d => typeof d.numero === 'string' && d.numero.trim() !== '';

function main() { return lancer(); }

async function lancer() {
    await connecterMongo({ script: 'nettoyer-slugs.js', ecrit: ECRIRE, confirmationProduction: true });
    console.log(ECRIRE
        ? "\n✍️  MODE ÉCRITURE — les documents vont être modifiés.\n"
        : "\n👀 MODE SIMULATION (dry-run) — aucune écriture. Ajoute --ecrire pour appliquer.\n");

    const filtre = PORTEE === 'tout'
        ? { slug: { $type: 'string', $ne: '' } }
        : { slug: /\?/ };
    const docs = await NumeroCarte.find(
        filtre,
        { idProduct: 1, idExpansion: 1, slug: 1, numero: 1, numeroUrl: 1, codeSet: 1, source: 1 }
    ).lean();

    if (docs.length === 0) {
        console.log("✨ Aucun document à traiter — rien à faire (déjà nettoyée ?).\n");
        await mongoose.disconnect();
        return;
    }

    // Le code de set du document, avec repli sur celui de son expansion : il est
    // INDISPENSABLE à l'extraction (c'est lui qu'on détache de la queue du slug), et il
    // manque sur une partie des documents.
    const codesParExpansion = new Map((await CodeSet.find({}, { idExpansion: 1, codeSet: 1 }).lean())
        .map(c => [c.idExpansion, c.codeSet]));
    const codeDe = d => d.codeSet || codesParExpansion.get(d.idExpansion) || null;

    // ---- Analyse, AVANT toute écriture -------------------------------------
    const aEcrire = [];
    let numeroInchange = 0, numeroCorrige = 0, numeroVide = 0;
    let dangereuxCorriges = 0;          // ceux sans `numero` : numeroUrl y fait autorité
    let slugsNettoyes = 0;
    // CONTRÔLE PAR LES TÉMOINS. Les documents qui portent AUSSI un numéro lu dans le
    // TITRE nous donnent un arbitre gratuit : si la valeur extraite le contredit,
    // l'extraction s'est trompée. C'est la seule vérification honnête disponible, et
    // elle doit s'afficher AVANT l'écriture, pas après.
    let temAccordAvant = 0, temDesaccordAvant = 0, temNullAvant = 0;
    let temAccordApres = 0, temDesaccordApres = 0, temNullApres = 0;
    let regressions = 0;
    const exemplesRegression = [];
    const parametres = new Map();
    const exemples = [];
    // ÉCRITURE À L'AVEUGLE. Un document sans numéro de titre n'a aucun arbitre : rien
    // ne permet de vérifier la valeur qu'on lui écrit. C'est le groupe dont il faut
    // connaître la taille AVANT d'appuyer, et il se scinde en deux — poser une valeur
    // (risqué : elle fait autorité au scoring) ou poser null (inoffensif : rang 2).
    let aveugleTotal = 0, aveugleAvecValeur = 0, aveugleVersNull = 0;
    // Les désaccords qui SUBSISTENT après correction. Ce ne sont pas forcément des
    // erreurs d'extraction : Cardmarket lui-même fait diverger le titre et l'URL sur
    // certaines fiches. À juger sur pièces, d'où l'affichage complet possible.
    const desaccordsResiduels = [];

    for (const d of docs) {
        const brut = String(d.slug);
        for (const p of (brut.split('?')[1] || '').split('&')) {
            const k = p.split('=')[0];
            if (k) parametres.set(k, (parametres.get(k) || 0) + 1);
        }

        const propre = slugPropre(brut);
        if (propre !== brut) slugsNettoyes++;
        const nouveau = numeroDepuisSlug(propre, codeDe(d));
        const ancien = d.numeroUrl != null && String(d.numeroUrl) !== '' ? String(d.numeroUrl) : null;
        const change = nouveau !== ancien;

        if (aNumeroDeTitre(d)) {
            const okAvant = ancien !== null ? Boolean(comparerNumeros(d.numero, ancien)) : null;
            const okApres = nouveau !== null ? Boolean(comparerNumeros(d.numero, nouveau)) : null;
            if (okAvant === null) temNullAvant++; else if (okAvant) temAccordAvant++; else temDesaccordAvant++;
            if (okApres === null) temNullApres++; else if (okApres) temAccordApres++; else temDesaccordApres++;
            if (okApres === false) desaccordsResiduels.push({ d, nouveau, ancien });
            // Une régression, c'est une valeur JUSTE remplacée par une valeur FAUSSE.
            // Passer à null n'en est pas une : c'est une abstention assumée.
            if (okAvant === true && okApres === false) {
                regressions++;
                if (exemplesRegression.length < 10) exemplesRegression.push({ d, ancien, nouveau });
            }
        }

        if (!change) { numeroInchange++; if (propre === brut) continue; }
        else if (nouveau === null) numeroVide++;
        else numeroCorrige++;
        if (change && !aNumeroDeTitre(d)) dangereuxCorriges++;

        if (exemples.length < 12 && change) {
            exemples.push({ id: d.idProduct, brut, propre, ancien, nouveau, numero: d.numero ?? null, code: codeDe(d) });
        }
        // Compté sur les documents RÉELLEMENT modifiés, pas sur l'ensemble inspecté.
        if (!aNumeroDeTitre(d)) {
            aveugleTotal++;
            if (nouveau === null) aveugleVersNull++; else aveugleAvecValeur++;
        }
        aEcrire.push({ idProduct: d.idProduct, propre, nouveau });
    }

    const temoinsAvant = temAccordAvant + temDesaccordAvant;
    const temoinsApres = temAccordApres + temDesaccordApres;

    console.log('='.repeat(94));
    console.log(`COLLECTION numeros_cartes — portée "${PORTEE}" — ${docs.length} document(s) inspecté(s)`);
    console.log('='.repeat(94));
    if (parametres.size) {
        console.log(`  slugs à nettoyer : ${slugsNettoyes} — paramètres rencontrés : ${[...parametres.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}`);
    }
    console.log('');
    console.log('  ── CONTRÔLE PAR LES TÉMOINS (documents ayant aussi un numéro de titre) ──');
    console.log(`  AVANT : ${String(temAccordAvant).padStart(6)} justes, ${String(temDesaccordAvant).padStart(5)} FAUX (${temoinsAvant ? (100 * temDesaccordAvant / temoinsAvant).toFixed(1) : '—'} %), ${String(temNullAvant).padStart(5)} sans valeur`);
    console.log(`  APRÈS : ${String(temAccordApres).padStart(6)} justes, ${String(temDesaccordApres).padStart(5)} FAUX (${temoinsApres ? (100 * temDesaccordApres / temoinsApres).toFixed(1) : '—'} %), ${String(temNullApres).padStart(5)} sans valeur`);
    console.log(`  RÉGRESSIONS (juste -> faux) : ${regressions}${regressions ? '   ⚠️ à examiner AVANT d\'écrire' : '   ✅'}`);
    for (const { d, ancien, nouveau } of exemplesRegression) {
        console.log(`     ${String(d.idProduct).padEnd(9)} numero="${d.numero}"  ${ancien} -> ${nouveau}  code=${JSON.stringify(codeDe(d))}  slug="${slugPropre(String(d.slug)).slice(0, 40)}"`);
    }
    console.log('');
    console.log(`  numeroUrl inchangé ........................ ${String(numeroInchange).padStart(6)}`);
    console.log(`  numeroUrl CORRIGÉ (nouvelle valeur) ....... ${String(numeroCorrige).padStart(6)}`);
    console.log(`  numeroUrl VIDÉ (abstention assumée) ....... ${String(numeroVide).padStart(6)}`);
    console.log(`  dont sans "numero" de titre (cas graves) .. ${String(dangereuxCorriges).padStart(6)}  <- numeroUrl y fait autorité au scoring`);
    console.log('');

    // ── (a) ÉCRITURE À L'AVEUGLE ────────────────────────────────────────────
    const partAveugle = aEcrire.length ? (100 * aveugleTotal / aEcrire.length).toFixed(1) : '—';
    console.log('  ── ÉCRITURE À L\'AVEUGLE (aucun numéro de titre pour vérifier) ──');
    console.log(`  sur ${aEcrire.length} documents modifiés, ${aveugleTotal} sans témoin (${partAveugle} %) :`);
    console.log(`     reçoivent une VALEUR ... ${String(aveugleAvecValeur).padStart(6)}   <- non vérifiable, fait autorité au scoring`);
    console.log(`     passent à null ......... ${String(aveugleVersNull).padStart(6)}   <- abstention, se classe "numéro inconnu"`);
    console.log(`  Les ${aEcrire.length - aveugleTotal} autres sont couverts par leur numéro de titre, arbitré ci-dessus.`);
    console.log('');

    // ── (b) DÉSACCORDS RÉSIDUELS ────────────────────────────────────────────
    const TOUT = process.argv.includes('--tous-les-desaccords');
    const aMontrer = TOUT ? desaccordsResiduels : desaccordsResiduels.slice(0, 30);
    // Ventilation : un écart de 1 signe une numérotation décalée côté Cardmarket entre
    // le titre et l'URL (souvent une carte 0 ou un index qui ne démarre pas au même
    // rang), pas une extraction fautive. Le reste demande un coup d'œil.
    let ecartUn = 0;
    for (const { d, nouveau } of desaccordsResiduels) {
        const a = parseInt(String(d.numero).match(/\d+/)?.[0] ?? '', 10);
        const b = parseInt(String(nouveau).match(/\d+/)?.[0] ?? '', 10);
        if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) === 1) ecartUn++;
    }
    console.log(`  ── DÉSACCORDS RÉSIDUELS : ${desaccordsResiduels.length} (${temoinsApres ? (100 * temDesaccordApres / temoinsApres).toFixed(2) : '—'} % des témoins) ──`);
    console.log('  La valeur extraite contredit le numéro du titre. Souvent un écart de');
    console.log('  Cardmarket lui-même entre son titre et son URL, pas une erreur d\'extraction.');
    console.log(`  dont ${ecartUn} à écart de 1 (numérotation décalée côté Cardmarket), ${desaccordsResiduels.length - ecartUn} autres.`);
    console.log('  ⚠️ Tous ces documents ont un numéro de TITRE, qui l\'emporte au scoring.');
    if (!TOUT && desaccordsResiduels.length > aMontrer.length) {
        console.log(`  Affichage des ${aMontrer.length} premiers — ajoute --tous-les-desaccords pour la liste complète.`);
    }
    console.log('   ' + 'idProduct'.padEnd(11) + 'titre'.padEnd(9) + 'extrait'.padEnd(9) + 'code'.padEnd(10) + 'slug');
    console.log('   ' + '-'.repeat(88));
    for (const { d, nouveau } of aMontrer) {
        console.log('   ' + String(d.idProduct).padEnd(11) + String(d.numero).padEnd(9) + String(nouveau).padEnd(9)
            + String(codeDe(d) ?? '—').padEnd(10) + slugPropre(String(d.slug)).slice(0, 44));
    }
    console.log('');
    console.log('  Échantillon (à juger avant écriture) :');
    console.log('   ' + 'idProduct'.padEnd(11) + 'numeroUrl'.padEnd(18) + 'numero'.padEnd(9) + 'code'.padEnd(9) + 'slug');
    console.log('   ' + '-'.repeat(88));
    for (const e of exemples) {
        const mouvement = `${e.ancien ?? 'null'} -> ${e.nouveau ?? 'null'}`;
        console.log(`   ${String(e.id).padEnd(11)}${mouvement.padEnd(18)}${String(e.numero ?? '—').padEnd(9)}${String(e.code ?? '—').padEnd(9)}${e.propre.slice(0, 46)}`);
    }

    if (!ECRIRE) {
        console.log(`\n  (simulation : rien n'a été écrit — ${aEcrire.length} document(s) seraient modifiés)`);
        console.log('='.repeat(94));
        await mongoose.disconnect();
        return;
    }
    // Verrou de sûreté : on n'écrit pas en masse une extraction qui casse des valeurs
    // déjà justes. Le drapeau existe pour le cas où tu aurais examiné les régressions
    // et décidé qu'elles sont acceptables — jamais pour passer outre sans regarder.
    if (regressions > 0 && !process.argv.includes('--accepter-regressions')) {
        console.error(`\n❌ ARRÊT : ${regressions} régression(s) — des numeroUrl JUSTES deviendraient FAUX.`);
        console.error(`   Examine la liste ci-dessus. Pour écrire malgré tout : --accepter-regressions`);
        await mongoose.disconnect();
        process.exit(1);
    }

    // ---- Écriture par paquets ----------------------------------------------
    let modifies = 0;
    for (let i = 0; i < aEcrire.length; i += LOT) {
        const paquet = aEcrire.slice(i, i + LOT);
        const r = await NumeroCarte.bulkWrite(paquet.map(x => ({
            updateOne: {
                filter: { idProduct: x.idProduct },
                // Pas d'upsert : ces documents existent forcément, on vient de les lire.
                update: { $set: { slug: x.propre, numeroUrl: x.nouveau } }
            }
        })), { ordered: false });
        modifies += r.modifiedCount ?? r.nModified ?? 0;
        console.log(`  ✍️  ${Math.min(i + LOT, aEcrire.length)}/${aEcrire.length} traités (${modifies} modifiés)`);
    }

    // ---- Contrôle post-écriture --------------------------------------------
    // Le seul contrôle qui vaille est celui qui relit la base, pas celui qui fait
    // confiance au compteur du driver.
    const restants = await NumeroCarte.countDocuments({ slug: /\?/ });
    // Contrôle de fond : on RELIT les témoins et on recompte les désaccords. Si
    // l'écriture a bien eu lieu, ce taux doit être celui annoncé en "APRÈS" ci-dessus.
    const relus = await NumeroCarte.find(filtre, { numero: 1, numeroUrl: 1 }).lean();
    let fauxRelus = 0, jugesRelus = 0;
    for (const d of relus) {
        if (!aNumeroDeTitre(d) || d.numeroUrl == null || String(d.numeroUrl) === '') continue;
        jugesRelus++;
        if (!comparerNumeros(d.numero, String(d.numeroUrl))) fauxRelus++;
    }
    console.log('');
    console.log(`  ✅ ${modifies} document(s) modifié(s) sur ${aEcrire.length} attendu(s).`);
    console.log(`  ✅ Slugs contenant encore "?" : ${restants} (attendu : 0).`);
    console.log(`  ✅ Témoins relus en base : ${fauxRelus}/${jugesRelus} faux (${jugesRelus ? (100 * fauxRelus / jugesRelus).toFixed(1) : '—'} %) — doit valoir le taux "APRÈS".`);
    if (restants !== 0 || modifies !== aEcrire.length) {
        console.log(`  ⚠️ ÉCART — relance le script : il est idempotent, un second passage finira le travail.`);
    } else {
        console.log(`  ℹ️ Idempotence : relance ce script, il doit annoncer 0 document à modifier.`);
    }
    console.log('='.repeat(94));

    await mongoose.disconnect();
}

main().catch(async e => {
    console.error("❌ Erreur :", e.message);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
