// Banc de collecte-cartes/base-banc.js — AUCUNE connexion, AUCUNE écriture : il ne fait que JUGER des URI (les vraies variables de .env y servent
// de cas « production », leur valeur n'est jamais imprimée) et lire le code des bancs câblés.
//   node test-base-banc.js
// Décision du testeur (2026-10-08) : « aucun banc ne doit plus jamais écrire dans la grappe de production ». Une base de banc est
//   (a) mongodb-memory-server si le paquet est installé, (b) sinon MONGODB_TEST_URI — seulement si son hôte n'est PAS celui de MONGODB_URI
//   ni de MONGODB_CARTES_URI, (c) sinon REFUS. Jamais de repli silencieux sur test_scratch de la production.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const B = require('./collecte-cartes/base-banc');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };

(async () => {
    const PROD = process.env.MONGODB_URI, CARTES = process.env.MONGODB_CARTES_URI;
    verifier('précondition : MONGODB_URI et MONGODB_CARTES_URI sont définies dans .env (valeurs jamais imprimées)', [!!PROD, !!CARTES], [true, true]);
    const reel = { MONGODB_URI: PROD, MONGODB_CARTES_URI: CARTES };
    const dit = j => `${j.ok ? 'accepté' : 'refusé'}${j.ok ? '' : /production/.test(j.raison) ? ' (hôte = production)' : ' (autre raison)'}`;

    // ── 1. LA PRODUCTION RÉELLE EST REFUSÉE (hôte comparé, jamais affiché)
    verifier('URI de MONGODB_URI (production, vraie) : hôte = production : refusé', dit(B.jugerUri(PROD, reel)), 'refusé (hôte = production)');
    verifier('URI de MONGODB_CARTES_URI (grappe cartes, vraie) : hôte = production : refusé', dit(B.jugerUri(CARTES, reel)), 'refusé (hôte = production)');
    // la même grappe, écrite autrement (srv contre hôte de shard), sur des valeurs fabriquées
    const fab = { MONGODB_URI: 'mongodb+srv://u:p@cluster0.abcde.mongodb.net/test', MONGODB_CARTES_URI: 'mongodb+srv://u:p@cluster1.fghij.mongodb.net/cartes' };
    verifier('même grappe écrite avec un hôte de shard : refusé', dit(B.jugerUri('mongodb://u:p@cluster0-shard-00-01.abcde.mongodb.net:27017/x?ssl=true', fab)), 'refusé (hôte = production)');
    verifier('même grappe, autre base, autre utilisateur : refusé', dit(B.jugerUri('mongodb+srv://autre:secret@cluster0.abcde.mongodb.net/test_scratch', fab)), 'refusé (hôte = production)');
    verifier('un jeu d\'hôtes dont UN SEUL est la production : refusé', dit(B.jugerUri('mongodb://127.0.0.1:27017,cluster1-shard-00-00.fghij.mongodb.net:27017/x', fab)), 'refusé (hôte = production)');
    verifier('hôte en majuscules : refusé', dit(B.jugerUri('mongodb+srv://u:p@CLUSTER0.ABCDE.MONGODB.NET/x', fab)), 'refusé (hôte = production)');
    verifier('une AUTRE grappe Atlas (autre identifiant) : acceptée', dit(B.jugerUri('mongodb+srv://u:p@cluster0.zzzzz.mongodb.net/x', fab)), 'accepté');

    // ── 2. UNE URI LOCALE FABRIQUÉE EST ACCEPTÉE (sans connexion)
    verifier('mongodb://127.0.0.1:1/x avec les vraies variables : accepté', dit(B.jugerUri('mongodb://127.0.0.1:1/x', reel)), 'accepté');

    // ── 3. LE DOUTE REFUSE
    for (const [nom, uri] of [['vide', ''], ['absente', undefined], ['pas une URI', 'pas une uri'], ['sans hôte', 'mongodb:///x'], ['autre schéma', 'http://127.0.0.1/x']]) {
        verifier(`doute (${nom}) : refusé`, B.jugerUri(uri, reel).ok, false);
    }
    verifier('doute : sans MONGODB_URI ni MONGODB_CARTES_URI, impossible de comparer : refusé', B.jugerUri('mongodb://127.0.0.1:1/x', {}).ok, false);
    verifier('doute : une seule des deux variables de production est définie : refusé', B.jugerUri('mongodb://127.0.0.1:1/x', { MONGODB_URI: PROD }).ok, false);

    // ── 4. LA RÉSOLUTION : mémoire, puis MONGODB_TEST_URI, puis REFUS
    const r0 = B.resoudre({ ...reel }, { memoireDisponible: false });
    verifier('ni paquet ni MONGODB_TEST_URI : REFUS « aucune base de test hors production »', [r0.ok, /aucune base de test hors production/.test(r0.raison || '')], [false, true]);
    const r1 = B.resoudre({ ...reel }, { memoireDisponible: true });
    verifier('paquet présent : mongodb-memory-server', [r1.ok, r1.origine], [true, 'memoire']);
    const r2 = B.resoudre({ ...reel, MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/x' }, { memoireDisponible: false });
    verifier('MONGODB_TEST_URI locale : acceptée, origine nommée', [r2.ok, r2.origine], [true, 'MONGODB_TEST_URI']);
    const r3 = B.resoudre({ ...reel, MONGODB_TEST_URI: PROD }, { memoireDisponible: false });
    verifier('MONGODB_TEST_URI = la production : REFUS, pas de repli', [r3.ok, /production/.test(r3.raison || '')], [false, true]);
    const r4 = B.resoudre({ ...reel, MONGODB_TEST_URI: CARTES }, { memoireDisponible: true });
    verifier('MONGODB_TEST_URI = grappe cartes, même avec le paquet présent : REFUS (une variable mal posée ne se contourne pas en silence)', r4.ok, false);
    verifier('aucun refus ne laisse fuiter une valeur de variable', [r0, r3, r4].some(r => (r.raison || '').includes(PROD) || (r.raison || '').includes(CARTES)), false);

    // ── 5. LE CÂBLAGE : le processus du banc ne voit plus la production
    const env = { ...reel, MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/x' };
    const banc = await B.ouvrirBanc({ env, memoireDisponible: false });
    banc.appliquer();
    verifier('appliquer : MONGODB_URI du banc = la base de banc, MONGODB_CARTES_URI retirée (un banc ne peut pas viser cartes)', [env.MONGODB_URI, env.MONGODB_CARTES_URI], ['mongodb://127.0.0.1:1/x', undefined]);
    let leve = null; try { await B.ouvrirBanc({ env: { ...reel }, memoireDisponible: false }); } catch (e) { leve = e; }
    verifier('ouvrirBanc LÈVE (refus) sans paquet ni MONGODB_TEST_URI — un banc ne démarre pas', [!!leve, /aucune base de test hors production/.test(leve?.message || '')], [true, true]);

    // ── 6. les bancs câblés passent par le module (lecture du code : les faire tourner demanderait une base de banc)
    const CABLES = ['test-import-catalogue-quotidien.js', 'test-import-guide-quotidien.js', 'test-import-price-guide.js', 'test-acces.js'];
    const sans = CABLES.filter(f => { const s = fs.readFileSync(path.join(__dirname, f), 'utf8'); return !(/require\('\.\/collecte-cartes\/base-banc'\)/.test(s) && /ouvrirBanc\(/.test(s) && /\.appliquer\(\)/.test(s)); });
    verifier(`${CABLES.length} bancs câblés : requièrent base-banc, ouvrent, appliquent`, sans, []);
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (aucune connexion, aucune écriture)`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
