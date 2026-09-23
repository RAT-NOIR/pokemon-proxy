// ============================================================
// APPRENDRE UN SET — mémorise le numéro de chaque carte d'une extension
// ============================================================
// Résout LE problème de fond : le catalogue Cardmarket ne contient pas les
// numéros de collection. Sans eux, impossible de savoir lequel des 18 candidats
// "M Kangaskhan EX" est le #79 -> le scoring classe au hasard.
//
// La logique (connexion, modèles, écriture) vit dans apprentissage-commun.js.
// Ce script n'est plus que l'interface en ligne de commande.
//
// USAGE :
//   node apprendre-set.js 6096                   (par idExpansion)
//   node apprendre-set.js Lost-Origin            (par slug, lu dans l'URL Cardmarket)
//   node apprendre-set.js Lost-Origin 6096 DRI   (plusieurs, mélangés)
//
// Le slug se lit dans l'URL du set sur Cardmarket :
//   cardmarket.com/en/Pokemon/Products/Singles/[Lost-Origin]?...

const {
    connecter, fermerProprement, installerArretPropre, apprendreUnSet,
} = require('./apprentissage-commun');

async function main() {
    // les drapeaux (`--base=test`) ne sont pas des cibles : sans ce filtre, « --base=test » était appris comme un slug
    const cibles = process.argv.slice(2).filter(a => a && !a.startsWith('--'));
    if (cibles.length === 0) {
        console.error('Usage : node apprendre-set.js <idExpansion|slug> [autres...]');
        console.error('Exemples :');
        console.error('  node apprendre-set.js 6096');
        console.error('  node apprendre-set.js Lost-Origin');
        process.exit(1);
    }

    installerArretPropre();
    await connecter();
    console.log('(Si Cloudflare demande la case, la fenêtre Chrome apparaîtra.)');

    let total = 0;
    for (const [i, cible] of cibles.entries()) {
        console.log(`\n=== Apprentissage de "${cible}" ===`);
        const { n, cartes, idExpansion, codeSet, arret } = await apprendreUnSet(cible);

        // 🔴 CARDMARKET NOUS LIMITE : LE LOT ENTIER S'ARRÊTE (2026-09-24). Une limite de débit porte sur le client ; passer
        // à l'expansion suivante, c'est frapper encore un serveur qui vient de dire non (cinq fois de suite ce jour-là).
        if (arret) {
            if (n) console.log(`⚠️ ${n} cartes mémorisées pour "${cible}" — liste PARTIELLE.`);
            console.log(`\n🚫 ${arret === '1015' ? 'Cardmarket nous limite (1015)' : 'Cloudflare non franchi'} : arrêt du lot, rien d'autre n'est demandé.`);
            console.log(`   Reprendre plus tard (un produit appris ne se redemande pas, mais la liste d'un set se relit en entier) :`);
            console.log(`     node apprendre-set.js --base=${process.env.MONGODB_BASE || '<base>'} ${cibles.slice(i).join(' ')}`);
            total += n;
            process.exitCode = 3;
            break;
        }
        if (n === 0) {
            console.log(`⚠️ Aucune carte récupérée pour "${cible}" (slug erroné, Cloudflare, ou rate-limit ?).`);
            continue;
        }

        if (idExpansion) console.log(`ℹ️ idExpansion : ${idExpansion}`);
        else console.log('⚠️ idExpansion introuvable (produit absent du catalogue) — numéros mémorisés quand même.');
        if (codeSet && idExpansion) console.log(`🧠 Code set : ${idExpansion} -> ${codeSet}`);

        console.log(`✅ ${n} cartes mémorisées.`);
        cartes.slice(0, 3).forEach(c =>
            console.log(`   ex: ${c.idProduct} -> n°${c.numero} ${c.variante || ''} "${c.nomFr || '?'}"`));
        total += n;
    }

    console.log(`\n🎉 Terminé : ${total} cartes apprises au total.`);
    await fermerProprement();
}

main().catch(async e => {
    console.error('❌ Erreur :', e.message);
    await fermerProprement();
    process.exit(1);
});