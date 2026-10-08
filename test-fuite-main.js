// Banc de verrou/bac.js (vidage de sortie par `drop`) — AUCUNE connexion : une fausse base en mémoire, rien n'est écrit nulle part.
//   node test-fuite-main.js
// 🔴 `deleteMany` vide une collection mais garde son fichier et ses index (verrou/tranche.js). Le 2026-10-08, des collections vides laissées par
// les outils du dépôt ont fait dépasser DEUX fois l'arrêt dur de la grappe de production. Ce module est la défense en profondeur ; la garde
// principale est collecte-cartes/base-banc.js (aucun banc n'ouvre plus la production, voir test-base-banc.js).
const fs = require('fs');
const path = require('path');
const bac = require('./verrou/bac');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };

/** Une fausse base : des collections (avec documents et index), `drop` les retire VRAIMENT, `deleteMany` les vide seulement. */
function fausseBase(databaseName, noms) {
    const colls = new Map(noms.map(c => [c, { docs: 1, index: 1 }]));
    return {
        databaseName, colls,
        listCollections: () => ({ toArray: async () => [...colls.keys()].map(name => ({ name })) }),
        dropCollection: async nom => { if (!colls.delete(nom)) { const e = new Error('ns not found'); e.code = 26; e.codeName = 'NamespaceNotFound'; throw e; } return true; },
        videSansDrop(nom) { colls.get(nom).docs = 0; }
    };
}
const muet = () => { };

(async () => {
    // 1. drop : la collection N'EXISTE PLUS (deleteMany la laisse, avec son index)
    const a = fausseBase('test_scratch', ['credits', 'guide_prix']);
    a.videSansDrop('credits');
    verifier('contraste : après un vidage sans drop la collection existe encore (0 document, un index)', [a.colls.has('credits'), a.colls.get('credits').docs, a.colls.get('credits').index], [true, 0, 1]);
    const r1 = await bac.viderBac(a, { noms: ['credits'], log: muet });
    verifier('viderBac(noms) : la collection N\'EXISTE PLUS, les autres restent', [a.colls.has('credits'), a.colls.has('guide_prix'), r1.droppees], [false, true, ['credits']]);
    const r1b = await bac.viderBac(a, { noms: ['credits'], log: muet });
    verifier('une collection déjà absente n\'est pas une erreur', [r1b.refuse, r1b.droppees], [false, []]);

    // 2. refus hors test_scratch : rien n'est droppé (on n'autorise qu'un nom)
    for (const nom of ['test', 'cartes', 'test_scratch2', undefined]) {
        const f = fausseBase(nom, ['credits']);
        const r = await bac.viderBac(f, { noms: ['credits'], avant: new Set(), log: muet });
        verifier(`refus sur la base « ${nom} » (rien n'est droppé)`, [r.refuse, f.colls.has('credits')], [true, true]);
    }

    // 3. les collections NEUVES depuis l'instantané (celles qu'un serveur lancé par l'outil crée par autoIndex), sauf les rm_t… des bancs v2
    const b = fausseBase('test_scratch', ['preexistante', 'rm_tabc_comptes']);
    const avant = await bac.instantane(b);
    b.colls.set('cardprices', { docs: 0, index: 1 }); b.colls.set('evenements_stripe', { docs: 0, index: 1 }); b.colls.set('rm_tzzz_comptes', { docs: 1, index: 1 });
    const r3 = await bac.viderBac(b, { avant, log: muet });
    verifier('viderBac(avant) : les collections nées pendant l\'outil disparaissent', r3.droppees.sort(), ['cardprices', 'evenements_stripe']);
    verifier('   ... une préexistante et les rm_t… (bancs v2 concurrents) ne sont JAMAIS touchées', [...b.colls.keys()].sort(), ['preexistante', 'rm_tabc_comptes', 'rm_tzzz_comptes']);
    const r3b = await bac.viderBac(b, { noms: ['rm_tabc_comptes'], log: muet });
    verifier('   ... même nommée explicitement, une collection rm_t… n\'est pas touchée', [r3b.droppees, b.colls.has('rm_tabc_comptes')], [[], true]);

    // 4. chaque outil nommé range par le module commun (lecture du code : les faire tourner demanderait une base de banc)
    const OUTILS = ['test-import-catalogue-quotidien.js', 'test-import-guide-quotidien.js', 'test-import-price-guide.js', 'test-identification-locale.js',
        'test-acces.js', 'test-webhook-stripe.js', 'test-remboursement-catch.js', 'test-retour-live.js', 'test-journal-echecs.js', 'capture-reponse.js',
        'smoke-test.js', 'verrou-charges.js', 'verrou-avant-push.js'];
    const sans = OUTILS.filter(f => { const s = fs.readFileSync(path.join(__dirname, f), 'utf8'); return !(/require\('\.\/verrou\/bac'\)/.test(s) && /viderBac\(/.test(s)); });
    verifier(`${OUTILS.length} outils : tous requièrent verrou/bac et appellent viderBac(`, sans, []);
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (aucune connexion)`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
