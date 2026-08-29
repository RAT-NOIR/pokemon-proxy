// ============================================================================
// ÉTAT DE LA COLLECTE D'IMAGES — et ce qu'un nouveau passage a RÉELLEMENT rapporté
// ============================================================================
// À lancer après chaque session d'enregistrement. Il répond à une seule question :
// combien d'idProducts NOUVEAUX sont arrivés depuis la dernière fois ?
//
// ⚠️ POURQUOI CET OUTIL EXISTE. La galerie Cardmarket plafonne à 10 pages / 300 articles,
// et la sélection de ces 300 est DÉTERMINISTE : réenregistrer le même tri rend exactement
// les mêmes fichiers. Sans compteur, un passage stérile est indiscernable d'un passage
// utile — on voit des fichiers se créer, la barre de progression avance, et rien n'a été
// gagné. « Combien de fichiers » ne répond pas : c'est « combien de NOUVEAUX » qui compte.
//
// 🔴🔴 NE MÉLANGE PAS UN TEST DE COLLECTE ET UN IMPORT DE CATALOGUE.
// Cet outil compare LES FICHIERS À LA BASE. Si `catalogue_produits` change entre le
// `--marquer` et la lecture suivante, le compteur de « nouveaux » mêlera deux choses qui
// n'ont rien à voir : les fichiers que tu viens d'enregistrer, et les produits que
// l'import vient d'ajouter. Le nombre serait juste et la conclusion fausse.
//   1. D'ABORD le test de collecte (marquer, enregistrer, relire). Une heure, et il ne
//      dépend pas du catalogue.
//   2. ENSUITE l'import, avec `mesure-diff-catalogue.js` avant, et un nouveau `--marquer`
//      après — le repère d'avant l'import ne vaut plus rien une fois la base changée.
//
// ⚠️ EN VÉRITÉ SEUL LE BLOC « L'ÉTAT » dépend de la base ; le compteur de nouveaux, lui,
// ne compare que des fichiers entre eux. Mais les deux sont lus dans le même écran, et
// c'est l'écran qui trompe. On sépare les opérations plutôt que les colonnes.
//
// 🔴 RÈGLE DURE APPLIQUÉE ICI : LA CLÉ EST L'idProduct DU NOM DE FICHIER, JAMAIS LE NOM
// DE DOSSIER. 41 dossiers portent un nom qui n'est pas le codeSet de leur contenu, CSDC
// contient CS3DC, SV4A mêle deux galeries. Le nom de dossier ne sert ici QU'À rendre une
// ligne lisible ; aucune jointure ne passe par lui.
//
// LECTURE SEULE PAR DÉFAUT. Rien n'est écrit sans `--marquer`, et `--marquer` n'écrit
// qu'un seul fichier d'état, à côté des images, jamais dans le dépôt.
//
// ⚠️ LA BASE SE NOMME, TOUJOURS. `connecterMongo` refuse de deviner — la base de
// production s'appelle « test » et le bac à sable « test_scratch ». Cet outil ne fait que
// LIRE, donc `--base=test` est légitime ici, mais il faut l'écrire.
//
// USAGE :
//   node mesure-collecte-images.js --base=test               état + écart depuis le repère
//   node mesure-collecte-images.js --base=test --marquer     pose le repère (APRÈS lecture)
//   node mesure-collecte-images.js --base=test --set MC      le détail d'un set
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { connecterMongo } = require('./mongo-connexion');
const mongoose = require('mongoose');

const RACINE = process.env.RACINE_IMAGES || 'C:\\Users\\Yung\\Desktop\\CARDMARKET IMAGE';
const REPERE = path.join(RACINE, '_etat-collecte.json');
const EST_CARTE = /^(\d+)\.(jpe?g|png|webp)$/i;
const MARQUER = process.argv.includes('--marquer');
const SET_DEMANDE = (() => { const i = process.argv.indexOf('--set'); return i > 0 ? process.argv[i + 1] : null; })();
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

/** Parcourt l'arborescence et rend les idProducts, avec le dossier où on les a vus. */
function lireDisque(racine) {
    const ou = new Map();   // idProduct -> "dossier"
    (function marche(d) {
        let entrees;
        try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        for (const e of entrees) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { marche(p); continue; }
            const m = EST_CARTE.exec(e.name);
            if (!m) continue;
            const id = Number(m[1]);
            if (!ou.has(id)) ou.set(id, path.relative(racine, d).split(path.sep)[1] ?? '?');
        }
    })(racine);
    return ou;
}

(async () => {
    if (!fs.existsSync(RACINE)) { console.error(`🔴 racine d'images absente : ${RACINE}`); process.exit(1); }
    const ou = lireDisque(RACINE);
    const ids = new Set(ou.keys());

    // ── L'ÉCART DEPUIS LE DERNIER REPÈRE ────────────────────────────────────
    console.log('═'.repeat(88));
    console.log('CE QUE LE DERNIER PASSAGE A RAPPORTÉ');
    console.log('═'.repeat(88));
    let precedent = null;
    if (fs.existsSync(REPERE)) {
        try { precedent = JSON.parse(fs.readFileSync(REPERE, 'utf8')); } catch (_) { precedent = null; }
    }
    if (!precedent) {
        console.log(`   aucun repère (${REPERE}).`);
        console.log(`   Lance --marquer pour en poser un ; le prochain passage sera comparé à celui-ci.`);
    } else {
        const avant = new Set(precedent.ids || []);
        const nouveaux = [...ids].filter(id => !avant.has(id));
        const disparus = [...avant].filter(id => !ids.has(id));
        console.log(`   repère posé le ......... ${precedent.le}`);
        console.log(`   idProducts alors ....... ${avant.size}`);
        console.log(`   idProducts maintenant .. ${ids.size}`);
        console.log(`   🔑 NOUVEAUX ............ ${nouveaux.length}`);
        if (disparus.length) console.log(`   ⚠️ DISPARUS ............ ${disparus.length}  (des fichiers ont été déplacés ou supprimés)`);
        if (nouveaux.length) {
            const parSet = new Map();
            for (const id of nouveaux) { const k = ou.get(id) ?? '?'; parSet.set(k, (parSet.get(k) || 0) + 1); }
            console.log(`   par dossier : ${[...parSet].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
        } else {
            console.log(`   -> 🔴 PASSAGE STÉRILE. Le tri utilisé rend les mêmes 300 : il faut en changer.`);
        }
    }

    // ── L'ÉTAT, PAR JOINTURE SUR L'idProduct ────────────────────────────────
    await connecterMongo({ script: 'mesure-collecte-images.js', ecrit: false });
    const CAT = mongoose.connection.collection('catalogue_produits');
    const NUM = mongoose.connection.collection('numeros_cartes');
    const idsCatalogue = new Set(await CAT.distinct('idProduct'));
    const idsParCode = new Map();
    for (const n of await NUM.find({ codeSet: { $nin: [null, ''] } },
        { projection: { idProduct: 1, codeSet: 1 } }).toArray()) {
        const k = String(n.codeSet).toUpperCase();
        if (!idsParCode.has(k)) idsParCode.set(k, new Set());
        idsParCode.get(k).add(n.idProduct);
    }

    console.log('\n' + '═'.repeat(88));
    console.log('L\'ÉTAT');
    console.log('═'.repeat(88));
    const apparies = [...ids].filter(id => idsCatalogue.has(id)).length;
    console.log(`   fichiers (idProducts distincts) ......... ${ids.size}`);
    console.log(`   appariés au catalogue ................... ${apparies}`);
    console.log(`   sans produit connu (catalogue en retard) . ${ids.size - apparies}`);
    console.log(`   produits du catalogue ................... ${idsCatalogue.size}`);

    const fiches = [];
    for (const [code, attendus] of idsParCode) {
        const presents = [...attendus].filter(id => ids.has(id)).length;
        if (presents === 0) continue;                       // set jamais ouvert
        fiches.push({ code, total: attendus.size, presents, manquants: attendus.size - presents });
    }
    const incomplets = fiches.filter(f => f.manquants > 0).sort((a, b) => b.manquants - a.manquants);
    console.log(`\n   sets ouverts ............................ ${fiches.length}`);
    console.log(`   sets incomplets ......................... ${incomplets.length}`);
    console.log(`   produits manquants ...................... ${incomplets.reduce((t, f) => t + f.manquants, 0)}`);

    if (SET_DEMANDE) {
        const f = fiches.find(x => x.code === SET_DEMANDE.toUpperCase());
        if (!f) console.log(`\n   « ${SET_DEMANDE} » : aucun produit présent sous ce codeSet.`);
        else {
            const attendus = idsParCode.get(f.code);
            const abs = [...attendus].filter(id => !ids.has(id)).sort((a, b) => a - b);
            console.log(`\n   ${f.code} · ${f.presents}/${f.total} (${pc(f.presents, f.total)}) · ${f.manquants} manquants`);
            console.log(`   idProducts manquants : ${abs.slice(0, 60).join(', ')}${abs.length > 60 ? ` … (+${abs.length - 60})` : ''}`);
        }
    } else {
        console.log(`\n   les 15 sets les plus incomplets :`);
        for (const f of incomplets.slice(0, 15))
            console.log(`      ${f.code.padEnd(10)} ${String(f.presents).padStart(5)}/${String(f.total).padEnd(5)} (${pc(f.presents, f.total).padStart(6)}) · ${f.manquants} manquants`);
    }

    if (MARQUER) {
        // ⚠️ Le repère est posé À CÔTÉ DES IMAGES, jamais dans le dépôt : 1,8 Go d'images
        // n'y entrent pas, et leur compteur non plus.
        fs.writeFileSync(REPERE, JSON.stringify({ le: new Date().toISOString(), ids: [...ids] }), 'utf8');
        console.log(`\n   ✅ repère posé : ${REPERE} (${ids.size} idProducts)`);
    } else {
        console.log(`\n   (rien n'a été écrit. --marquer pose le repère pour la prochaine comparaison.)`);
    }
    await mongoose.disconnect();
})().catch(e => { console.error(e.stack); process.exit(1); });
