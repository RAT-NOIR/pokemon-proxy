'use strict';
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons');
(async () => {
    await H.ouvrirBac('test-installations.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();   // B2b point 6 : 2 installations par IP et par JOUR (fenêtre fixe) ; horloge des limiteurs fixée au milieu de l'heure (donc du jour courant)
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '500' });
    const appels = [];
    const fauxArgent = {
        solde: async p => ({ total: p.installation.essais, essai: p.installation.essais }),
        reprendreHeritage: async o => { appels.push(o); return { rendu: 0 }; }
    };
    A.registre.fournir('argent', fauxArgent);
    const srv = await A.demarrer(cfg);
    const poster = (corps, n) => H.appel(srv.url, '/api/installation', { methode: 'POST', corps, entetes: A.ip(n) });

    // 1. cas nominal
    const r1 = await poster({ versionExtension: '2.0.0', libelle: 'Chrome · Windows' }, 1);
    H.v('201 + forme', [r1.statut, r1.json.success, /^[0-9a-f]{32}$/.test(r1.json.installationId), r1.json.jetonInstallation.length, r1.json.solde.essai], [201, true, true, 43, 3]);
    // 2. empreinte seule en base
    const inst = await db.col('installations').findOne({ _id: r1.json.installationId });
    H.v('jetonEmpreinte = SHA-256(jeton)', inst.jetonEmpreinte, J.empreinte(r1.json.jetonInstallation));
    let trouve = 0, total = 0;
    for (const c of ['installations', 'limites', 'comptes', 'sessions', 'mouvements']) for (const d of await db.col(c).find({}).toArray()) { total++; if (JSON.stringify(d).includes(r1.json.jetonInstallation)) trouve++; }
    H.v(`le jeton n'apparaît dans AUCUN document (${total} documents lus)`, trouve, 0);
    H.v('libellé gardé', inst.libelle, 'Chrome · Windows');
    // 3. libellé
    const lib = async (v, n) => { const r = await poster({ versionExtension: '2.0.0', libelle: v }, n); return (await db.col('installations').findOne({ _id: r.json.installationId })).libelle; };
    H.v('61 caractères tronqués à 60', (await lib('a'.repeat(61), 2)).length, 60);
    const net = await lib('<script>alert(1)</script>\u0007x', 3);
    H.vrai(`<script> et contrôles retirés (${JSON.stringify(net)})`, !/[<>\u0000-\u001f]/.test(net));
    H.v('libellé absent', await lib(undefined, 4), 'Navigateur');
    H.v('libellé non-texte', await lib(42, 5), 'Navigateur');
    // 4. 3e création depuis la même IP
    const m1 = await poster({ versionExtension: '2.0.0' }, 50), m2 = await poster({ versionExtension: '2.0.0' }, 50), m3 = await poster({ versionExtension: '2.0.0' }, 50);
    H.v('même IP : 2 permises, la 3e refusée (3 requêtes)', [m1.statut, m2.statut, m3.statut], [201, 201, 429]);
    H.v('429 DEBIT avec reessayerDans', [m3.json.erreur.code, m3.json.erreur.reessayerDans > 0], ['DEBIT', true]);
    H.v('la 3e n\'a rien créé', await db.col('installations').countDocuments({ libelle: 'Navigateur' }) , 4);   // 2 (libellés absent/non-texte) + 2 de la même IP
    // 6. userIdHerite
    appels.length = 0;
    const h1 = await poster({ versionExtension: '2.0.0', userIdHerite: 'user-abc' }, 6);
    H.v('userIdHerite : reprendreHeritage appelé UNE fois avec {userId, installation}', [appels.length, appels[0].userId, appels[0].installation._id === h1.json.installationId], [1, 'user-abc', true]);
    appels.length = 0;
    await poster({ versionExtension: '2.0.0', userIdHerite: 42 }, 7); await poster({ versionExtension: '2.0.0', userIdHerite: 'x'.repeat(81) }, 8);
    H.v('userIdHerite non-texte ou > 80 : ignoré (2 requêtes, 0 appel)', appels.length, 0);
    // 7. entrée invalide
    const e1 = await poster({ versionExtension: 5 }, 9), e2 = await poster({ versionExtension: 'v'.repeat(21) }, 10), e3 = await poster([1], 11);
    H.v('corps non-objet / version > 20 / tableau : 400 ENTREE', [e1.statut, e1.json.erreur.code, e2.statut, e3.statut], [400, 'ENTREE', 400, 400]);
    // 9. jamais de compteId
    const c1 = await poster({ versionExtension: '2.0.0', compteId: 'pirate', essais: 999, role: 'administrateur' }, 12);
    const ic = await db.col('installations').findOne({ _id: c1.json.installationId });
    H.v('compteId/essais du corps ignorés', [ic.compteId, ic.essais], [null, 3]);
    // 8. registre sans argent
    A.registre.vider();
    const avant = await db.col('installations').countDocuments({});
    const s8 = await poster({ versionExtension: '2.0.0' }, 13);
    H.v('sans argent : 503 INDISPONIBLE, aucune installation créée', [s8.statut, s8.json.erreur.code, await db.col('installations').countDocuments({}) - avant], [503, 'INDISPONIBLE', 0]);
    // héritage qui lève => 503
    A.registre.fournir('argent', { solde: fauxArgent.solde, reprendreHeritage: async () => { throw new Error('boum'); } });
    const s9 = await poster({ versionExtension: '2.0.0', userIdHerite: 'u' }, 14);
    H.v('héritage en panne : 503, pas de solde inventé', [s9.statut, s9.json.erreur.code, s9.json.solde], [503, 'INDISPONIBLE', undefined]);
    await srv.fermer();

    // 5. plafond global
    A.registre.fournir('argent', fauxArgent);
    const cfg2 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ESSAIS_GLOBAUX_JOUR: '2' });
    await db.col('limites').deleteMany({});
    const srv2 = await A.demarrer(cfg2);
    const p2 = n => H.appel(srv2.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: A.ip(100 + n) });
    const g = [await p2(1), await p2(2), await p2(3)];
    H.v('plafond global 2 : les deux premières ont 3 essais, la 3e naît à 0 sans être refusée', g.map(x => [x.statut, x.json.solde.essai]), [[201, 3], [201, 3], [201, 0]]);
    H.v('essais en base de la 3e', (await db.col('installations').findOne({ _id: g[2].json.installationId })).essais, 0);
    await srv2.fermer();
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
