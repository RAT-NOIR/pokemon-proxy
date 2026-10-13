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
        // (tour 3, M-D) un TÉMOIN de 2 s côté banc : une attente qui n'expire plus fait ÉCHOUER ce banc avec un message, au lieu de le bloquer
        const message = await Promise.race([service.avecDelai(new Promise(() => { }), 40, 'recompte').then(() => 'RÉSOLU sans expirer', e => e.message), new Promise(r => setTimeout(() => r('BLOQUÉ : l\'attente n\'a pas expiré en 2 s'), 2000))]);
        H.vrai(`une attente qui expire LÈVE (message nommant l'attente et le délai) : ${message}`, /recompte/.test(message || '') && /40/.test(message || ''));
        let echec = null; try { await service.avecDelai(Promise.reject(new Error('panne du recompte')), 1000, 'recompte'); } catch (e) { echec = e.message; }
        H.v('   un recompte en ÉCHEC remonte son erreur (pas d\'attente avalée)', echec, 'panne du recompte');
        H.v('   une promesse qui aboutit rend sa valeur', await service.avecDelai(Promise.resolve(7), 1000, 'recompte'), 7);
        // (tour 3, M-C) quand une écriture constate le compteur ABSENT (elle remet l'initialisation à rejouer), pret() ne dit plus « prêt » : il LÈVE, jusqu'à ce que l'écriture suivante ait rejoué le recompte
        {
            // (une clé DÉJÀ dans `hors` n'a pas besoin de catalogue : l'écriture passe la décision et atteint la réservation d'octets, qui constate le compteur absent)
            const ObjectId = require('mongoose').Types.ObjectId, compteId = new ObjectId(), ecrire = () => service.cocher({ compteId, slug: 'S-Pret', cle: '1|1', possedee: true, quantite: 5, cfg });
            await col('collection_fiches').insertOne({ compteId, set: 'S-Pret', hors: ['1|1'], majLe: new Date() });
            await col('compteurs').deleteMany({ cle: 'collection-octets' });
            let ecriture = null; try { await ecrire(); } catch (e) { ecriture = e.message; }
            H.v('   le compteur disparu : l\'écriture échoue (compteur-absent, la suivante rejoue le recompte)', ecriture, 'compteur-absent');
            const attente = await Promise.race([monter.pret(2000).then(() => 'PRÊT', e => `LÈVE : ${e.message}`), new Promise(r => setTimeout(() => r('BLOQUÉ'), 4000))]);
            H.vrai(`   pret() ne dit PAS « prêt » alors que le compteur manque : ${attente}`, /^LÈVE/.test(attente));
            await ecrire();                                                              // la suivante rejoue le recompte
            const apres = await Promise.race([monter.pret(5000).then(() => 'PRÊT', e => `LÈVE : ${e.message}`), new Promise(r => setTimeout(() => r('BLOQUÉ'), 8000))]);
            H.v('   le recompte rejoué : pret() est prêt de nouveau, le compteur existe', [apres, await col('compteurs').countDocuments({ cle: 'collection-octets' })], ['PRÊT', 1]);
        }
        // sans recompte lancé (module neuf), pret() ne bloque pas
        const neuf = require('module').createRequire(__filename)('../collection/service');
        H.vrai('   pret() sans recompte en cours : résolu aussitôt (pas d\'attente inventée)', await Promise.race([neuf.attendreInitialisation(5000).then(() => true), new Promise(r => setTimeout(() => r(false), 2000))]));
    }
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch (_) { } process.exit(1); });
