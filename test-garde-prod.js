// Banc : la PRODUCTION ne charge jamais base-banc.js. Le worker (collecteur-images*.js via r2.js, garde.js, mongo-connexion.js) ne doit requérir que
// collecte-cartes/garde-banc.js (petit, sans dépendance) : un module de banc qui LÈVE à l'import (pilote mongodb qui change d'exports) ne doit pas
// pouvoir empêcher le worker de démarrer.   node test-garde-prod.js — AUCUNE connexion, AUCUNE variable de banc.
const fs = require('fs');
const path = require('path');
for (const k of ['BANC_ISOLE', 'BANC_HOTES', 'BANC_R2_INTERDITS', 'R2_BUCKET_BANC']) delete process.env[k];

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };

(async () => {
    const r2 = require('./collecte-cartes/r2');
    const garde = require('./collecte-cartes/garde');
    require('./mongo-connexion');
    const charges = Object.keys(require.cache).map(f => path.basename(f));
    verifier('r2.js, garde.js et mongo-connexion.js chargés SANS variable de banc : aucun module de require.cache ne s\'appelle base-banc.js', charges.filter(f => f === 'base-banc.js'), []);
    verifier('   ... et garde-banc.js, lui, est chargé (la production a bien une garde)', charges.includes('garde-banc.js'), true);
    const sources = ['collecte-cartes/r2.js', 'collecte-cartes/garde.js', 'mongo-connexion.js'].map(f => [f, fs.readFileSync(path.join(__dirname, f), 'utf8')]);
    verifier('aucune ligne `require` de ces trois modules ne nomme base-banc', sources.filter(([, s]) => /require\([^)]*base-banc/.test(s.replace(/\/\/.*$/gm, ''))).map(([f]) => f), []);
    // le client S3 gardé est un PASSE-PLAT hors banc : 1 appel pour 1 envoi, arguments inchangés
    const appels = [];
    const faux = { send: async (c, ...r) => { appels.push([c?.constructor?.name, c?.input?.Bucket, r.length]); return 'ok'; } };
    r2._poserClient(faux);
    const c = faux;   // garderClientR2 enrobe `faux.send` sur place : c'est le `send` GARDÉ qu'on appelle
    class PutObjectCommand { constructor(i) { this.input = i; } }
    const rendu = await c.send(new PutObjectCommand({ Bucket: 'b', Key: 'k' }));
    verifier('hors banc, `send` du client gardé est un passe-plat : 1 appel du faux client pour 1 envoi, valeur rendue telle quelle', [appels.length, rendu, appels[0], faux.send.__gardeBanc === true], [1, 'ok', ['PutObjectCommand', 'b', 0], true]);
    // une seule liste des buckets de production
    const G = require('./collecte-cartes/garde-banc');
    verifier('garde-banc.js exporte bucketsDeProduction, hotesDe, cleDeGrappe, verifierHoteBanc, verifierEcritureR2, garderClientR2', ['bucketsDeProduction', 'hotesDe', 'cleDeGrappe', 'verifierHoteBanc', 'verifierEcritureR2', 'garderClientR2'].filter(k => typeof G[k] !== 'function'), []);
    verifier('bucketsDeProduction exclut R2_BUCKET_BANC et les valeurs vides', G.bucketsDeProduction({ R2_BUCKET_IMAGES: 'i', R2_BUCKET_BRUT: 'b', R2_BUCKET_BANC: 'x', R2_BUCKET_VIDE: '', AUTRE: 'z' }), ['i', 'b']);
    const motif = /\^R2_BUCKET_/g;
    const total = ['collecte-cartes/garde-banc.js', 'collecte-cartes/base-banc.js'].reduce((s, f) => { try { return s + (fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '').match(motif) || []).length; } catch (_) { return s + 100; } }, 0);
    verifier('la liste des buckets de production n\'est calculée qu\'à UN endroit (le motif /^R2_BUCKET_/ n\'apparaît qu\'une fois dans garde-banc.js + base-banc.js, hors commentaires)', total, 2);
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (aucune connexion)`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
