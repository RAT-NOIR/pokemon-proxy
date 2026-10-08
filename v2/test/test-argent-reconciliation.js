'use strict';
const path = require('path'); const { spawnSync } = require('child_process');
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const R = require('../argent/reconcilier');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
const octroi = (p, poche, delta, type = 'octroi') => db.col('mouvements').insertOne({ ...(p.type === 'compte' ? { compteId: p.id } : { installationId: p.id }), le: t, surface: 'scanner', type, delta, poche, motif: type, scanId: null, etat: 'debite', cleIdempotence: `${type}|${p.id}|${poche}`, expireLe: new Date('2028-01-01') });
(async () => {
    const prefixe = await H.ouvrirBac('test-argent-reconciliation.js'); await M.creerIndex();
    // 1. 100 comptes + 20 installations fabriqués COHÉRENTS (octroi/achat, débits, remboursements) : écart 0
    const porteurs = [];
    for (let i = 0; i < 100; i++) {
        const p = await compte({ solde: { accueil: 25, achete: i % 5 } }); porteurs.push(p);
        await octroi(p, 'accueil', 25); if (i % 5) await octroi(p, 'achete', i % 5, 'achat');
        const nd = 1 + (i % 3);
        for (let k = 0; k < nd; k++) await Lg.debiter(p, { scanId: `s${i}-${k}`, cleIdempotence: `d${i}-${k}`, maintenant: t }, cfg);
        if (i % 4 === 0) { const c = (await db.col('mouvements').findOne({ compteId: p.id, scanId: `s${i}-0` })).credit; await Lg.rembourser(p, c, 'ia-echec', { scanId: `s${i}-0`, maintenant: t }, cfg); }
    }
    for (let i = 0; i < 20; i++) {
        const p = await inst({ essais: 3, achete: 0 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } }); porteurs.push(p);
        for (let k = 0; k < 1 + (i % 3); k++) await Lg.debiter(p, { scanId: `si${i}-${k}`, cleIdempotence: `di${i}-${k}`, maintenant: t }, cfg);
    }
    const rs = []; for (const p of porteurs) rs.push(await R.reconcilier(p, cfg));
    H.v('120 porteurs fabriqués cohérents (100 comptes + 20 installations) : écart 0 partout', [rs.length, rs.filter(r => r.ecarts.length === 0).length], [120, 120]);
    H.v('   chaque porteur a bien été comparé sur au moins une poche (pas un zéro par défaut)', rs.every(r => r.comparees >= 1), true);
    // 2. un décrément fabriqué SANS mouvement : écart -1 imprimé, solde NON corrigé
    const pf = porteurs[1]; const avant = (await lire(pf)).solde;
    await db.col('comptes').updateOne({ _id: pf.id }, { $inc: { 'solde.accueil': -1 } });
    const rf = await R.reconcilier(pf, cfg);
    H.v('décrément sans mouvement : un écart de -1 sur accueil', rf.ecarts.map(e => [e.poche, e.ecart]), [['accueil', -1]]);
    H.v('   le solde n\'a PAS été corrigé', (await lire(pf)).solde.accueil, avant.accueil - 1);
    const pg = porteurs[2]; await db.col('comptes').updateOne({ _id: pg.id }, { $inc: { 'solde.achete': 7 } });
    H.v('   un crédit en trop : écart +7 sur achete', (await R.reconcilier(pg, cfg)).ecarts.map(e => [e.poche, e.ecart]), [['achete', 7]]);
    // installation sans dotation connue : non vérifiable, dit, jamais un faux zéro
    const pu = await inst({ essais: 3 }); const ru = await R.reconcilier(pu, cfg);
    H.v('installation sans essaisInitiaux : essai non vérifiable (listé), pas d\'écart inventé', [ru.ecarts.length, ru.nonVerifiables], [0, ['essai']]);
    // 3. le CLI : tableau, code 1 s'il y a un écart (porteurs[1] et [2] en écart)
    const cli = path.join(__dirname, '..', 'argent', 'reconcilier.js');
    const lance = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
    const r1 = lance('--base=test_scratch', `--prefixe=${prefixe}`);
    H.v('CLI avec écarts : code 1', r1.status, 1);
    H.v('   la sortie imprime un tableau avec son dénominateur', /porteurs? comparés?/.test(r1.stdout) && /accueil/.test(r1.stdout) && /-1/.test(r1.stdout), true);
    await db.col('comptes').updateOne({ _id: pf.id }, { $inc: { 'solde.accueil': 1 } }); await db.col('comptes').updateOne({ _id: pg.id }, { $inc: { 'solde.achete': -7 } });
    const r0 = lance('--base=test_scratch', `--prefixe=${prefixe}`);
    H.v('CLI sans écart : code 0 (les 120 + le non vérifiable ne font pas de faux écart)', r0.status, 0);
    // 4. --base=test sans --confirmer-production : refus AVANT toute connexion
    const rp = lance('--base=test');
    H.v('--base=test sans --confirmer-production : refusé, code 1, aucune base ouverte', [rp.status, /confirmer-production/.test(rp.stderr + rp.stdout), /Base :/.test(rp.stdout)], [1, true, false]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
