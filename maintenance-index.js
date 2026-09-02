// ============================================================================
// MAINTENANCE DES INDEX — deux suppressions, deux créations, UNE seule fenêtre
// ============================================================================
// Relevé du 2026-08-30, prouvé par `explain(executionStats)` et par lecture du code :
//
//   À SUPPRIMER
//     catalogue_produits.name_text      14 384 Ko   0 occurrence de `$text` dans le dépôt
//     catalogue_produits.idMetacard_1    3 076 Ko   jamais un critère de requête
//   À CRÉER
//     numeros_cartes.idExpansion_1        ~1 200 Ko  COLLSCAN 69 598 lus / 244 rendus · 71 ms
//     numeros_cartes.setTcgdex_1          ~1 000 Ko  COLLSCAN 69 598 lus / 152 rendus · 42 ms
//
//   SOLDE : environ −15 Mo de place ET −113 ms sur le chemin d'identification.
//
// ════════════════════════════════════════════════════════════════════════════
// 📌 CE QU'IL FAUDRAIT LE JOUR OÙ ON VOUDRAIT DÉSACTIVER `autoIndex` — 2026-09-02
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ DÉCISION PRISE CE JOUR-LÀ : ON N'Y TOUCHE PAS. Écrit ici pour que la question ne se
// rouvre pas sans ses chiffres.
//
// CE QUE ÇA COÛTE VRAIMENT AU DÉMARRAGE — mesuré, contre une affirmation que j'avais
// avancée sans vérifier. J'avais fait d'`autoIndex` le meilleur candidat de l'incident du
// 2026-09-02 (« un createIndex sur 69 598 et 73 188 documents au moment où le premier scan
// arrive »). C'ÉTAIT FAUX, et la vérification tient en une ligne : TOUS LES INDEX DÉCLARÉS
// EXISTENT DÉJÀ EN BASE — `numeros_cartes` porte bien `idProduct_1`, `idExpansion_1` et
// `setTcgdex_1`. Un `createIndex` sur un index existant est une opération de MÉTADONNÉES :
// MongoDB répond « existe déjà » sans balayer un document. Le coût est de l'ordre de
// quelques dizaines de millisecondes, pas d'une reconstruction.
//
// CE QUI SE PASSERAIT SI ON LE DÉSACTIVAIT : rien aujourd'hui, puisque tout est en place.
// 🔑 LE RISQUE EST À L'INVERSE, ET C'EST LUI QUI FAIT RENONCER : un index déclaré PLUS TARD
// ne serait jamais créé. Et un index manquant NE CASSE RIEN — il ralentit tout. C'est la
// dégradation qu'on ne voit pas : aucune erreur, aucun test rouge, juste des COLLSCAN.
// (Mesuré une fois : 69 598 documents balayés là où l'index en rend 135.)
//
// LA GARANTIE À METTRE EN FACE, ET ELLE EST OBLIGATOIRE AVANT DE DÉSACTIVER :
//     un contrôle qui compare les index DÉCLARÉS dans les schémas aux index PRÉSENTS en
//     base, et qui ÉCHOUE — pas qui avertit.
// Un avertissement sur un défaut invisible se lit une fois et s'oublie ; c'est exactement
// le raisonnement des jalons du verrou. Sa place est dans `verrou-avant-push.js`, à côté
// du cliquet de couverture, qui surveille la même chose pour les fonctions.
// ⚠️ CE FICHIER EN EST DÉJÀ LA MOITIÉ : il sait lire les déclarations en source et les
// index en base, et il REFUSE d'agir tant que les deux ne concordent pas. Il lui manque
// le sens inverse — « déclaré mais absent » — et de s'exécuter dans le verrou.
//
// 🔴🔴 SUPPRIMER L'INDEX NE SUFFIT PAS, IL FAUT SUPPRIMER LA LIGNE QUI LE CRÉE.
// Et c'est pire que « au prochain import » : mongoose a `autoIndex: true` PAR DÉFAUT, et
// aucun endroit du dépôt ne le désactive. Les index déclarés dans index.js sont donc
// recréés À CHAQUE DÉMARRAGE DU SERVEUR — c'est-à-dire, sur un plan Render gratuit, à
// chaque réveil après 15 minutes d'inactivité.
//
//   `idMetacard_1`  déclaré DEUX fois : index.js:246 ET import-catalogue.js:30
//                   -> les DEUX lignes doivent partir, sinon il revient au prochain réveil.
//   `name_text`     déclaré UNE fois : import-catalogue.js:28
//                   -> il ne revient qu'au prochain import, mais il revient.
//
// ⚠️ CE SCRIPT NE TOUCHE PAS AU CODE. Il dit ce qu'il ferait, et refuse d'agir tant que
// les lignes sources n'ont pas été retirées — sinon on croirait la place libérée alors
// qu'elle reviendrait toute seule. Un index supprimé qui se recrée est PIRE qu'un index
// gardé : on a perdu la place ET la connaissance qu'on l'a perdue.
//
// USAGE :
//   node maintenance-index.js --base=test                 (SIMULATION, ne touche à rien)
//   node maintenance-index.js --base=test --appliquer     (agit, après ta sauvegarde)
//
// ⚠️ SAUVEGARDE D'ABORD, et elle ne va PAS de soi :
//   node backup-collections.js --base=test --collections=catalogue_produits,numeros_cartes
//   Par défaut `backup-collections.js` n'exporte que `numeros_cartes,codes_set` — PAS
//   `catalogue_produits`. Le défaut a été écrit pour `nettoyer-codeset.js`, pas pour ici.
// ============================================================================
const option = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || '';
const BASE = option('base');
const APPLIQUER = process.argv.includes('--appliquer');
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// ⚠️ Le motif est PROPRE À CHAQUE INDEX. Une regex commune aux deux faisait dire à
// `idMetacard_1` qu'il était déclaré en import-catalogue.js:28 — c'est-à-dire sur la ligne
// de `name_text`. Un contrôle qui accuse la mauvaise ligne envoie corriger au mauvais
// endroit, et le vrai coupable survit.
const A_SUPPRIMER = [
    {
        col: 'catalogue_produits', index: 'name_text', motif: /\.index\(\s*\{\s*name:\s*'text'/,
        sources: [['import-catalogue.js', 28]]
    },
    {
        col: 'catalogue_produits', index: 'idMetacard_1', motif: /\.index\(\s*\{\s*idMetacard\s*:/,
        sources: [['index.js', 246], ['import-catalogue.js', 30]]
    }
];
const A_CREER = [
    { col: 'numeros_cartes', cles: { idExpansion: 1 }, nom: 'idExpansion_1' },
    { col: 'numeros_cartes', cles: { setTcgdex: 1 }, nom: 'setTcgdex_1' }
];
const ko = o => `${(o / 1024).toFixed(0)} Ko`;

// La ligne source existe-t-elle encore ? On lit le FICHIER, on ne fait pas confiance.
function sourceEncorePresente(fichier, ligne, motif) {
    const p = path.join(__dirname, fichier);
    if (!fs.existsSync(p)) return { presente: false, texte: '(fichier absent)' };
    const lignes = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    // On cherche dans une fenêtre autour du numéro : le fichier a pu bouger de quelques
    // lignes. Chercher au numéro EXACT rendrait un faux « c'est retiré » au premier
    // commit qui décale le fichier — exactement le genre de faux négatif rassurant
    // qu'on refuse ici.
    for (let i = Math.max(0, ligne - 12); i < Math.min(lignes.length, ligne + 12); i++) {
        const t = lignes[i];
        if (motif.test(t) && !/^\s*\/\//.test(t)) {
            return { presente: true, texte: `${fichier}:${i + 1}  ${t.trim()}` };
        }
    }
    return { presente: false, texte: `${fichier} — plus de déclaration active` };
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE });
    const db = mongoose.connection.db;
    if (db.databaseName !== BASE) { console.error(`❌ base "${db.databaseName}" ≠ "${BASE}".`); process.exit(1); }
    console.log(`base : ${db.databaseName}${APPLIQUER ? '  🔴 MODE APPLIQUER' : '  (SIMULATION — rien ne sera modifié)'}\n`);

    const avant = await db.command({ dbStats: 1 });
    const facture = a => (a.storageSize ?? 0) + (a.indexSize ?? 0);
    console.log(`facturé avant : ${(facture(avant) / 1e6).toFixed(1)} Mo\n`);

    // ── 1. LES SOURCES SONT-ELLES NETTOYÉES ? ───────────────────────────────
    console.log('═'.repeat(90));
    console.log('1. LES LIGNES QUI RECRÉENT CES INDEX');
    console.log('═'.repeat(90));
    let bloque = false;
    for (const s of A_SUPPRIMER) {
        for (const [f, l] of s.sources) {
            const r = sourceEncorePresente(f, l, s.motif);
            console.log(`   ${s.index.padEnd(16)} ${r.presente ? '🔴 ENCORE DÉCLARÉ' : '✅ retiré'}  ${r.texte}`);
            if (r.presente) bloque = true;
        }
    }
    if (bloque) {
        console.log(`\n   🔴 REFUS D'AGIR. Au moins une déclaration est encore active.`);
        console.log(`      mongoose a autoIndex:true par défaut et rien ne le désactive ici :`);
        console.log(`      l'index reviendrait au prochain démarrage du serveur, ou au prochain`);
        console.log(`      import. Retire les lignes, relance.`);
    }

    // ── 2. CE QUI SERAIT SUPPRIMÉ ───────────────────────────────────────────
    console.log('\n' + '═'.repeat(90));
    console.log('2. SUPPRESSIONS');
    console.log('═'.repeat(90));
    let rendu = 0;
    for (const s of A_SUPPRIMER) {
        const st = await db.command({ collStats: s.col });
        const poids = (st.indexSizes || {})[s.index];
        if (poids == null) { console.log(`   ${s.col}.${s.index} — absent, rien à faire`); continue; }
        rendu += poids;
        console.log(`   ${s.col}.${s.index} — ${ko(poids)}`);
        if (APPLIQUER && !bloque) {
            await db.collection(s.col).dropIndex(s.index);
            console.log(`      ✅ supprimé`);
        }
    }

    // ── 3. CE QUI SERAIT CRÉÉ ───────────────────────────────────────────────
    console.log('\n' + '═'.repeat(90));
    console.log('3. CRÉATIONS — sur numeros_cartes, qui fait deux COLLSCAN par scan');
    console.log('═'.repeat(90));
    for (const c of A_CREER) {
        const dejaLa = (await db.collection(c.col).indexes()).some(i => i.name === c.nom);
        console.log(`   ${c.col}.${c.nom} ${dejaLa ? '— déjà présent' : `sur ${JSON.stringify(c.cles)}`}`);
        if (APPLIQUER && !bloque && !dejaLa) {
            await db.collection(c.col).createIndex(c.cles, { name: c.nom });
            console.log(`      ✅ créé`);
        }
    }

    // ── 4. LA VÉRIFICATION D'APRÈS — sans elle, on n'a rien prouvé ──────────
    if (APPLIQUER && !bloque) {
        console.log('\n' + '═'.repeat(90));
        console.log('4. VÉRIFICATION — les deux requêtes passent-elles vraiment par l\'index ?');
        console.log('═'.repeat(90));
        const NUM = db.collection('numeros_cartes');
        const exp = (await NUM.findOne({ idExpansion: { $ne: null } }))?.idExpansion;
        const stc = (await NUM.findOne({ setTcgdex: { $ne: null, $exists: true } }))?.setTcgdex;
        for (const [titre, q] of [[`idExpansion ${exp}`, { idExpansion: exp }], [`setTcgdex "${stc}"`, { setTcgdex: stc }]]) {
            const e = await NUM.find(q).explain('executionStats');
            const x = e.executionStats || {};
            const noms = [];
            (function creuser(p) {
                if (!p || typeof p !== 'object') return;
                if (p.stage) noms.push(p.indexName ? `${p.stage}(${p.indexName})` : p.stage);
                for (const k of ['inputStage', 'inputStages', 'queryPlan']) {
                    const v = p[k]; if (Array.isArray(v)) v.forEach(creuser); else creuser(v);
                }
            })(e.queryPlanner?.winningPlan);
            const plan = noms.join(' <- ');
            console.log(`   ${titre.padEnd(28)} ${plan.padEnd(34)} ${String(x.totalDocsExamined).padStart(6)} lus / ` +
                `${String(x.nReturned).padStart(4)} rendus · ${x.executionTimeMillis} ms  ` +
                `${/COLLSCAN/.test(plan) ? '🔴 TOUJOURS UN COLLSCAN' : '✅'}`);
        }
        const apres = await db.command({ dbStats: 1 });
        console.log(`\n   facturé après : ${(facture(apres) / 1e6).toFixed(1)} Mo` +
            `   (${((facture(apres) - facture(avant)) / 1e6).toFixed(1)} Mo)`);
        console.log(`   ⚠️ WiredTiger ne rend la place qu'au point de reprise suivant :`);
        console.log(`      un chiffre inchangé juste après ne veut pas dire que rien n'a bougé.`);
    } else {
        console.log(`\n   place qui serait rendue : ${ko(rendu)}  (moins ~2 Mo pour les deux créations)`);
        console.log(`   relance avec --appliquer, APRÈS ta sauvegarde.`);
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch(e => { console.error(e.stack); process.exit(1); });
