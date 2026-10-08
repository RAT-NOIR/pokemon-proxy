'use strict';
// Le socle de tous les bancs v2 : l'isolation par préfixe doit EXISTER et SAVOIR REFUSER avant qu'on s'y fie.
const H = require('./_harnais');
const db = require('../db');

(async () => {
    const prefixe = await H.ouvrirBac('test-harnais.js');
    // 1. une collection v2 est préfixée
    await db.col('comptes').insertOne({ x: 1 });
    const noms = (await db.base().listCollections().toArray()).map(c => c.name);
    H.vrai('la collection réelle porte le préfixe', noms.includes(`${prefixe}comptes`));
    // 2. le préfixe est REFUSÉ s'il n'a pas la forme d'un préfixe de test
    let refus = null; try { db.definirPrefixe('prod_'); } catch (e) { refus = e.message; }
    H.vrai('un préfixe quelconque est refusé', /préfixe refusé/.test(refus || ''));
    // 3. le préfixe est REFUSÉ sur toute base autre que test_scratch (la production s'appelle "test")
    const reel = db.base();
    db.brancher({ databaseName: 'test', collection: () => { throw new Error('ne doit pas être atteint'); } });
    let refusProd = null; try { db.col('comptes'); } catch (e) { refusProd = e.message; }
    H.vrai('préfixe de test + base "test" (production) => refus', /refusé sur la base "test"/.test(refusProd || ''));
    db.brancher(reel);
    // 4. viderPrefixe supprime ce que le test a créé, et seulement cela
    await db.viderPrefixe();
    const apres = (await db.base().listCollections().toArray()).map(c => c.name);
    H.vrai('viderPrefixe a supprimé la collection du test', !apres.includes(`${prefixe}comptes`));
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
