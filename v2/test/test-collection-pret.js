'use strict';
// B2b tour 2 (point 3 de la relecture 2) — la PROMESSE d'initialisation de la collection est exposée aux bancs (`monter.pret`), SANS changer la production.
// Le recompte du compteur global d'octets est lancé AU MONTAGE du lot et n'est PAS attendu (le démarrage de l'API n'attend pas un recompte) : `routes()` rend `undefined`, tout de suite. Un banc qui compte
// les documents de la base juste après avoir monté le lot (test-abus-routes.js) peut cependant tomber avant la fin du recompte (« compteurs 0→1 » : le « 85 réussis, 2 échoués ») : il attend `pret()`,
// qui LÈVE si le recompte échoue ou n'aboutit pas dans le délai (plus de sortie silencieuse).
const express = require('express');
const H = require('./_harnais'); const M = require('../modeles'); const { col } = require('../db'); const { lireConfig } = require('../config');
(async () => {
    await H.ouvrirBac('test-collection-pret.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const monter = require('../collection/monter'), service = require('../collection/service');
    H.vrai('le lot monté expose pret() (la promesse du recompte d\'initialisation)', typeof monter.pret === 'function');
    // PRODUCTION INCHANGÉE : le montage ne rend rien et n'attend rien (une promesse rendue serait attendue par qui monte)
    const retour = monter.routes(express.Router(), cfg, {});
    H.v('routes() rend undefined, synchronement : le démarrage n\'attend pas le recompte (production inchangée)', retour, undefined);
    H.vrai('   le recompte est bien LANCÉ au montage (pret() rend une promesse en cours ou faite)', typeof monter.pret === 'function' && typeof monter.pret().then === 'function');
    if (typeof monter.pret === 'function') {
        const n = await monter.pret();
        H.v('pret() résolu : le compteur global existe (clé collection-octets)', [Number.isFinite(n), await col('compteurs').countDocuments({ cle: 'collection-octets' })], [true, 1]);
        // l'attente qui expire LÈVE
        let message = null; try { await service.avecDelai(new Promise(() => { }), 40, 'recompte'); } catch (e) { message = e.message; }
        H.vrai('une attente qui expire LÈVE (message nommant l\'attente et le délai)', /recompte/.test(message || '') && /40/.test(message || ''));
        let echec = null; try { await service.avecDelai(Promise.reject(new Error('panne du recompte')), 1000, 'recompte'); } catch (e) { echec = e.message; }
        H.v('   un recompte en ÉCHEC remonte son erreur (pas d\'attente avalée)', echec, 'panne du recompte');
        H.v('   une promesse qui aboutit rend sa valeur', await service.avecDelai(Promise.resolve(7), 1000, 'recompte'), 7);
        // sans recompte lancé (module neuf), pret() ne bloque pas
        const neuf = require('module').createRequire(__filename)('../collection/service');
        H.vrai('   pret() sans recompte en cours : résolu aussitôt (pas d\'attente inventée)', await Promise.race([neuf.attendreInitialisation(5000).then(() => true), new Promise(r => setTimeout(() => r(false), 2000))]));
    }
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch (_) { } process.exit(1); });
