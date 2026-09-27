// ============================================================
// REMPLIR LA FILE MAINTENANT, PAR LE MANQUE RÉEL — le geste de l'alimentateur du worker, lancé à la main (2026-09-26, soir)
// ============================================================
//   node alimenter-maintenant.js              (mesure : ce qui serait enfilé, et pourquoi — rien d'écrit)
//   node alimenter-maintenant.js --ecrire     (enfile, SEULEMENT si la garde du commit du worker passe)
//   [--max=N]                                 (plafond d'unités, 40 par défaut)
//
// Pourquoi à la main : l'alimentateur du worker ne connaîtra le manque réel (collecte-cartes/manque-reel.js) qu'après un
// push et un redéploiement. Ce qu'il enfilerait, on l'enfile d'ici par la MÊME fonction (`alimenter`, jamais une copie) —
// et c'est le worker ACTUEL qui l'exécute : la garde du commit (`etatDuWorker`) doit donc dire qu'il porte les règles dont
// ses unités dépendent. Une remise en file est une écriture ADDITIVE (feu vert permanent, 2026-09-24) ; chaque unité porte
// son motif.
require('dotenv').config();
const AUTORISES = [/^--ecrire$/, /^--max=\d+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --max=N`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { alimenter } = require('./collecte-cartes/alimentateur');
const { etatDuWorker, REGLES } = require('./remettre-en-file');
const { ligne } = require('./collecte-cartes/table-sets');
const { tablesDuCommit, fabriquerJuge, reglesDifferentes, dependancesLocales } = require('./collecte-cartes/tables-du-commit');

// 🔴 troisième relecture : collecteur-images-tcgdex.js (chargé par la mesure) pose un écouteur SIGINT pour l'arrêt propre du worker —
// et un écouteur supprime la sortie par défaut : Ctrl+C après la simulation laissait partir l'écriture. Ici, Ctrl+C ARRÊTE.
process.on('SIGINT', () => { console.error('\n⛔ interrompu (Ctrl+C) — rien de plus ne sera écrit ; les unités déjà écrites le sont, chacune entière.'); process.exit(130); });

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const max = Number((process.argv.find(a => a.startsWith('--max=')) || '--max=40').slice(6));
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx), db = cx.db;
    const W = await etatDuWorker(cx);
    console.log(`\n════ LE COMMIT DU WORKER ════\n   ${W.phrase}`);
    const F = db.collection('file_images');
    const avant = await F.countDocuments({ etat: { $in: ['attente', 'en-cours'] } });
    // 🔴 la garde ne voit que l'histoire COMMITÉE : une ligne ajoutée dans l'arbre de travail la passerait, et le worker
    // refuserait l'unité pour toujours. Chaque unité est donc jugée sur la ligne que le WORKER lira (tables de son commit).
    let unitePermise = null, differentes = null, SURVEILLES = [];
    if (W.commit) {
        const T = tablesDuCommit(W.commit);
        unitePermise = fabriquerJuge(ligne, T.ligne, W.commit);
        console.log(`   tables relues depuis le commit du worker ${W.commit.slice(0, 12)} (supprimées après lecture)`);
        // 🔴 revue du 2026-09-26 (GRAVE) : le juge ne compare que les LIGNES. La mesure, elle, tourne avec le code de l'arbre de
        // travail (planifier, préfixes « Platinum: », compagnons, filtre exact) : si ce code diffère de celui du worker, j'enfile
        // ce que MON code voit à faire et le worker exécute avec le SIEN. Toute règle surveillée qui diffère bloque l'écriture.
        // les règles surveillées + TOUT le code que chargent le worker et la mesure, calculé (jamais une liste à la main : la
        // première version oubliait jointure.js) — manque-reel.js y est : il définit l'identifiant d'image cherché et écrit
        SURVEILLES = [...new Set([...REGLES, ...dependancesLocales(['collecteur-images.js', 'collecte-cartes/alimentateur.js'])])].sort();
        differentes = reglesDifferentes(W.commit, SURVEILLES);
        console.log(differentes.length ? `   🔴 ${differentes.length} fichier(s) sur ${SURVEILLES.length} diffèrent entre l'arbre de travail et le commit du worker : ${differentes.join(', ')}` : `   ✅ les ${SURVEILLES.length} fichiers surveillés sont identiques dans l'arbre de travail et chez le worker`);
    } else console.log('   ⚠️ commit du worker inconnu : les lignes ne peuvent pas être comparées — l\'écriture sera refusée');
    // simulation d'abord, toujours : ce qui serait enfilé s'imprime AVANT toute écriture (§31)
    const S = await alimenter(db, { simuler: true, M, seuil: Number.MAX_SAFE_INTEGER, max, forcerManque: true, journal: console, unitePermise, version: W.commit || 'inconnue' });
    if (S.erreurManque) { console.error(`\n❌ le manque réel n'a pas pu se mesurer : ${S.erreurManque}`); await fermer(); process.exit(1); }
    const m = S.manqueReel;
    console.log(`\n════ MANQUE RÉEL TCGdex ════\n   DÉNOMINATEUR : ${m.examinees} lignes occidentales (une par slug) · ${m.avecSet} nomment un set TCGdex · ${m.lues} de ces sets lus en cache`);
    console.log(`   ${m.manques.length} set(s) avec un manque · ${m.manques.reduce((s, x) => s + x.n, 0)} impression(s) jamais tentée(s) · ${m.manques.filter(x => x.nonLu).length} set(s) TCGdex jamais lu(s)`);
    for (const x of [...m.manques].sort((a, b) => b.n - a.n)) console.log(`      ${x.code.padEnd(8)} ${x.slug.padEnd(34)} ${x.nonLu ? 'set jamais lu' : `${x.n} jamais tentée(s)`}${x.nonLus?.length ? ` + galerie(s) jamais lue(s) ${x.nonLus.join(', ')}` : ''} → ${x.tcgdexSet} ${x.exemples?.length ? `(${x.exemples[0]}…)` : ''}`);
    console.log(`\n════ CE QUI SERAIT ENFILÉ (plafond ${max}) ════`);
    console.log(`   règle par set : insérer ${S.inserer.length} · reprendre ${S.reprendre.length}`);
    for (const u of [...S.inserer, ...S.reprendre]) console.log(`      ${u._id} (${u.source}) ${u.slug} · ${u.cause || `${u.sans} carte(s) sans visuel`}`);
    console.log(`   manque réel : insérer ${S.choixManqueReel.inserer.length} · reprendre ${S.choixManqueReel.reprendre.length} · écartés ${S.choixManqueReel.ecartes.length}`);
    for (const u of [...S.choixManqueReel.inserer, ...S.choixManqueReel.reprendre]) console.log(`      ${u._id} ${u.slug} · ${u.cause || u.ajouteMotif}`);
    for (const e of S.choixManqueReel.ecartes) console.log(`      ⚪ ${e.slug} : ${e.raison}`);
    console.log(`   écartées parce que le worker n'a pas la même ligne : ${S.refusees.length}`);
    for (const e of S.refusees) console.log(`      🔴 ${e._id} ${e.slug ?? ''} : ${e.raison}`);
    if (!ecrire) { console.log('\n   (mesure seule — --ecrire enfile, si la garde du commit passe)'); await fermer(); return; }
    // une seule issue autorise l'écriture : garde verte, lignes du worker lues, AUCUNE règle différente (§51)
    if (W.bloque || !unitePermise || !differentes || differentes.length) { console.error(`\n❌ ÉCRITURE REFUSÉE : ${W.bloque ? 'la garde du commit bloque' : !unitePermise ? 'les lignes du worker ne sont pas lisibles' : `le worker ne tourne pas le code de cette mesure (${differentes.length} règle(s) différente(s))`}.`); await fermer(); process.exit(1); }
    // la mesure a pris ~10 min : la garde se RELIT juste avant d'écrire (un redéploiement, une édition de l'arbre de travail
    // pendant la mesure) — un seul chemin autorise encore : même commit, garde verte, aucune différence (revue du 2026-09-26)
    const W2 = await etatDuWorker(cx);
    const differentes2 = W2.commit ? reglesDifferentes(W2.commit, SURVEILLES) : null;
    if (W2.bloque || W2.commit !== W.commit || !differentes2 || differentes2.length) { console.error(`\n❌ ÉCRITURE REFUSÉE : la garde a changé pendant la mesure (commit ${W.commit} → ${W2.commit ?? 'inconnu'}${differentes2?.length ? `, ${differentes2.length} fichier(s) différent(s)` : ''}).`); await fermer(); process.exit(1); }
    // ce qui est écrit est ce qui a été IMPRIMÉ (§31) : le plan de la simulation, sans seconde mesure — la garde vient d'être relue
    const R = await alimenter(db, { plan: S, seuil: Number.MAX_SAFE_INTEGER, journal: console, version: W.commit });
    const apres = await F.countDocuments({ etat: { $in: ['attente', 'en-cours'] } });
    console.log(`\n   ✅ insérées ${R.inseres} · reprises ${R.repris} · RELU : file ${avant} → ${apres} unité(s) en attente ou en cours`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
