'use strict';
// BREVO — le plafond quotidien de courriels (offre gratuite de Brevo : 300 par jour ; défaut côté API V2_COURRIELS_JOUR = 250). Base de banc seulement.
// Les courriels de sécurité (vérification, mot de passe) passent avant les avertissements : ceux-ci s'arrêtent à `max - réserve`, ceux-là vont jusqu'à `max`.
const H = require('./_harnais'); const db = require('../db');
const { lireConfig } = require('../config');
const { creerPlafondJour, jourDeParis } = require('../comptes/plafond-courriels');
(async () => {
    await H.ouvrirBac('test-plafond-courriels.js');
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    H.v('la configuration porte le plafond : 250 par défaut', cfg.courriels.jour, 250);
    H.v('   V2_COURRIELS_JOUR le règle', lireConfig({ MONGODB_BASE: 'test_scratch', V2_COURRIELS_JOUR: '120' }).courriels.jour, 120);
    let invalide = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_COURRIELS_JOUR: '0' }); } catch (e) { invalide = /V2_COURRIELS_JOUR/.test(e.message); }
    H.v('   0 ou illisible : configuration invalide, qui nomme la variable', invalide, true);
    let trop = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_COURRIELS_JOUR: '301' }); } catch (e) { trop = /V2_COURRIELS_JOUR/.test(e.message); }
    H.v('   plus de 300 (le plafond de l\'offre gratuite) : configuration invalide', trop, true);

    let maintenant = new Date('2026-11-10T09:00:00Z');
    const P = creerPlafondJour({ max: 10, reserveSecurite: 3, maintenant: () => maintenant });
    const avert = []; for (let i = 0; i < 12; i++) avert.push(await P.reserver('avertissement'));
    H.v('les avertissements s\'arrêtent à max − réserve (7 sur 10)', [avert.filter(Boolean).length, avert.indexOf(false)], [7, 7]);
    const secu = []; for (let i = 0; i < 6; i++) secu.push(await P.reserver('securite'));
    H.v('la sécurité passe encore jusqu\'à max (3 de plus), puis le plafond tient', secu, [true, true, true, false, false, false]);
    H.v('   le compteur du jour est exactement max, jamais au-delà', (await db.col('courriels_jour').findOne({ _id: jourDeParis(maintenant) })).n, 10);

    // concurrence : 40 demandes simultanées sur un jour neuf, max 10 → exactement 10 vraies
    maintenant = new Date('2026-11-11T09:00:00Z');
    const rafale = await Promise.all(Array.from({ length: 40 }, () => P.reserver('securite')));
    H.v('40 demandes simultanées : exactement 10 acceptées', rafale.filter(Boolean).length, 10);

    // un autre jour repart de zéro ; le jour est celui de Paris (23 h UTC l'hiver = le lendemain à Paris)
    maintenant = new Date('2026-11-12T09:00:00Z');
    H.v('un nouveau jour repart de zéro', await P.reserver('avertissement'), true);
    H.v('le jour est celui de Paris', [jourDeParis(new Date('2026-11-12T22:30:00Z')), jourDeParis(new Date('2026-07-12T22:30:00Z'))], ['2026-11-12', '2026-07-13']);
    // des paramètres absurdes sont refusés à la construction
    const refus = [{ max: 0, reserveSecurite: 0 }, { max: 10, reserveSecurite: 10 }, { max: 10, reserveSecurite: -1 }, { max: 'x', reserveSecurite: 1 }].map(o => { try { creerPlafondJour(o); return 'accepté'; } catch { return 'refusé'; } });
    H.v('plafond ≤ 0, réserve ≥ plafond ou négative, texte : refusés', refus, ['refusé', 'refusé', 'refusé', 'refusé']);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
