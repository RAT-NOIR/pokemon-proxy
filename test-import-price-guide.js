// Banc de import-price-guide.js — base `test_scratch` UNIQUEMENT (refuse toute autre), collections vidées avant et après.
//   node test-import-price-guide.js
process.argv.push('--base=test_scratch');
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const { connecterMongo } = require('./mongo-connexion');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-'));
const guide = (nom, createdAt, lignes) => { const f = path.join(dossier, nom); fs.writeFileSync(f, JSON.stringify({ version: 1, createdAt, priceGuides: lignes })); return f; };
const importer = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'import-price-guide.js'), ...args], { encoding: 'utf8' });

(async () => {
    const base = await connecterMongo({ script: 'test-import-price-guide.js', ecrit: true });
    if (base !== 'test_scratch') { console.error(`❌ banc sur « ${base} » : refusé, test_scratch seulement`); process.exit(1); }
    const db = mongoose.connection.db;
    const vider = async () => { await db.collection('guide_prix').deleteMany({}); await db.collection('guide_prix_meta').deleteMany({}); };
    await vider();
    try {
        const A = guide('price_guide_A.json', '2026-09-01T02:00:00+0200', [{ idProduct: 1, trend: 1.5 }, { idProduct: 2, trend: 20, 'trend-holo': 30 }, { idProduct: 3, trend: 0.1 }]);
        const B = guide('price_guide_B.json', '2026-09-10T02:00:00+0200', [{ idProduct: 1, trend: 1.8 }, { idProduct: 2, trend: 25 }]);
        const C = guide('price_guide_C.json', '2026-08-01T02:00:00+0200', [{ idProduct: 1, trend: 99 }]);
        const G = db.collection('guide_prix'), M = db.collection('guide_prix_meta');
        const rA = importer(A, '--base=test_scratch');
        verifier('guide A : importé', [rA.status, await G.countDocuments({}), (await M.findOne({ _id: 'dernier' }))?.guideDu?.toISOString()], [0, 3, '2026-09-01T00:00:00.000Z']);
        verifier('chaque ligne porte la date du GUIDE (pas celle de l\'import)', await G.countDocuments({ guideDu: new Date('2026-09-01T00:00:00Z') }), 3);
        const rB = importer(B, '--base=test_scratch');
        const p3 = await G.findOne({ idProduct: 3 }), p1 = await G.findOne({ idProduct: 1 });
        verifier('guide B : le produit absent de B garde son prix et sa date (périmé, lisible), les autres à B',
            [rB.status, await G.countDocuments({}), p1.trend, p1.guideDu.toISOString(), p3.trend, p3.guideDu.toISOString(), (await M.findOne({ _id: 'dernier' })).guideDu.toISOString()],
            [0, 3, 1.8, '2026-09-10T00:00:00.000Z', 0.1, '2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z']);
        verifier('le RELU dit combien sont absentes du guide', /1 absentes de ce guide/.test(rB.stdout), true);
        const rC = importer(C, '--base=test_scratch');
        verifier('guide C, plus ANCIEN que celui en base : refusé, rien ne bouge', [rC.status, (await G.findOne({ idProduct: 1 })).trend, /pas plus récent/.test(rC.stderr)], [1, 1.8, true]);
        verifier('un guide DÉJÀ importé (même date) : refusé', importer(B, '--base=test_scratch').status, 1);
        verifier('argument inconnu : refusé avant toute connexion', importer(B, '--base=test_scratch', '--vite').status, 2);
        verifier('sans fichier : refusé', importer('--base=test_scratch').status, 2);
        verifier('une autre base que test / test_scratch : refusée', importer(B, '--base=cartes').status, 2);
        // la base venue de l'ENVIRONNEMENT (MONGODB_BASE), sans --base= : c'est la base connectée qui est contrôlée
        const rEnv = spawnSync(process.execPath, [path.join(__dirname, 'import-price-guide.js'), B], { encoding: 'utf8', env: { ...process.env, MONGODB_BASE: 'cartes' } });
        verifier('MONGODB_BASE=cartes sans --base= : refusé, rien d\'importé', [rEnv.status, /vit dans « test »/.test(rEnv.stderr)], [2, true]);
        // le chemin SANS méta (imports d'avant le 2026-09-28) : la borne est le DERNIER import daté ; un document sans majAt ne l'efface pas
        await vider();
        await G.insertMany([{ idProduct: 1, trend: 5, majAt: new Date('2026-09-05T00:00:00Z') }, { idProduct: 2, trend: 6, majAt: new Date('2026-09-20T00:00:00Z') }, { idProduct: 3, trend: 7 }]);
        verifier('sans méta : un guide antérieur au DERNIER import (20/09) est refusé', [importer(B, '--base=test_scratch').status, (await G.findOne({ idProduct: 1 })).trend], [1, 5]);
        const D = guide('price_guide_D.json', '2026-09-25T02:00:00+0200', [{ idProduct: 1, trend: 8 }]);
        verifier('sans méta : un guide postérieur passe, et pose la méta', [importer(D, '--base=test_scratch').status, (await G.findOne({ idProduct: 1 })).trend, !!(await M.findOne({ _id: 'dernier' }))], [0, 8, true]);
        await vider();
        await G.insertMany([{ idProduct: 1, trend: 5 }]);
        verifier('des lignes sans aucune date (ni méta ni majAt) : refusé — je ne sais pas', importer(D, '--base=test_scratch').status, 1);
    } finally {
        await vider();
        await mongoose.disconnect();
        fs.rmSync(dossier, { recursive: true, force: true });
    }
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (test_scratch vidé)`);
    process.exit(echecs ? 1 : 0);
})().catch(async e => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
